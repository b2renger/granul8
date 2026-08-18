// Metronome.js — Audible click track with count-in support.
// Uses look-ahead scheduling (same pattern as GrainScheduler) for sample-accurate timing.

/** Bound on clicks scheduled per tick, so a stall cannot burst. */
const MAX_CLICKS_PER_TICK = 8;

/** Nudge past exact boundaries so float equality never stalls the walk. */
const EPS = 1e-6;

export class Metronome {
    /**
     * @param {AudioContext} audioContext
     * @param {import('./MasterClock.js').MasterClock} clock
     * @param {AudioNode} destination - Where to connect (e.g. masterBus.masterGain)
     */
    constructor(audioContext, clock, destination) {
        this._ctx = audioContext;
        this._clock = clock;

        // Dedicated gain node for independent volume/mute control
        this.gainNode = audioContext.createGain();
        this.gainNode.gain.value = 0.5;
        this.gainNode.connect(destination);

        // Volume state (remembered separately from mute)
        this._volume = 0.5;
        this._muted = false;

        // Scheduling state
        this._running = false;
        this._timerId = null;
        this._nextBeatTime = 0;
        // Beat duration as of the last tick, so a tempo/signature change can be
        // detected even while `_nextBeatTime` is still ahead of `now` — see _tick.
        this._lastBeatDuration = 0;

        // Look-ahead parameters (same as GrainScheduler)
        this._scheduleAhead = 0.1;  // 100ms
        this._timerInterval = 25;   // 25ms

        // Count-in state
        this._countInRemaining = 0;
        this._onCountInComplete = null;
        this._countInEndTime = 0;  // the time the count-in will complete (downbeat)

        /** @type {number[]} Pending visual callback timeout IDs */
        this._beatTimeoutIds = [];

        // Visual beat callback
        /** @type {((beatIndex: number, isDownbeat: boolean) => void)|null} */
        this.onBeat = null;
    }

    /** Whether the metronome is currently running. */
    get running() { return this._running; }

    /** Whether the metronome is muted. */
    get muted() { return this._muted; }

    /** Current volume (0–1). */
    get volume() { return this._volume; }

    /**
     * Start the metronome, aligned to the clock's epoch.
     */
    start() {
        if (this._running) return;
        this._running = true;
        // Derive the first beat from the clock. Nothing is cached beyond this —
        // see _tick.
        this._nextBeatTime = this._clock.getNextBeatTime(this._ctx.currentTime);
        this._tick();
    }

    /**
     * Stop the metronome.
     */
    stop() {
        this._running = false;
        if (this._timerId !== null) {
            clearTimeout(this._timerId);
            this._timerId = null;
        }
        // Clear pending visual beat callbacks
        for (const tid of this._beatTimeoutIds) clearTimeout(tid);
        this._beatTimeoutIds = [];
        this._countInRemaining = 0;
        this._onCountInComplete = null;
        this._countInEndTime = 0;
    }

    /**
     * Count in one bar, then fire `onComplete` on the following downbeat.
     *
     * Does NOT move the clock epoch. There is one MasterClock for the whole app,
     * shared by every instance's Player, so re-anchoring it here used to teleport
     * every already-looping layer by up to half a bar — the act of recording a new
     * layer knocked the existing ones out of time. Instead the count-in is anchored
     * to the next bar line: a bar line is already a downbeat, so the accented click
     * still comes first, but the shared grid never moves.
     *
     * @param {(atTime: number) => void} onComplete - Called when count-in finishes.
     *   Receives the exact AudioContext time of the downbeat, so recording t=0 can
     *   land on the grid rather than on a wall-clock setTimeout estimate.
     */
    startCountIn(onComplete) {
        const now = this._ctx.currentTime;
        // Anchor the shared epoch if nothing has yet — a no-op if something already
        // has (e.g. another instance's playback, or the metronome toggle).
        this._clock.ensureEpoch(now);

        // Start on the next bar line and count one full bar.
        const barStart = this._clock.getNextBarTime(now);
        this._countInEndTime = barStart + this._clock.getBarDuration();
        this._countInRemaining = this._clock.numerator;
        this._onCountInComplete = onComplete;

        // Seed _lastBeatDuration so _tick's guard doesn't mistake this deliberate
        // placement for a stale/changed grid and re-derive past it (see _tick).
        this._lastBeatDuration = this._clock.getBeatDuration();

        if (!this._running) {
            this._nextBeatTime = barStart;
        } else {
            // Already free-running on the grid: just start counting from the bar
            // line, discarding whatever regular beat was pending before it.
            this._nextBeatTime = Math.max(this._nextBeatTime, barStart);
        }

        // Drive the first tick synchronously, on both the fresh-instance and
        // already-running paths. _tick's re-derive guard assumes any call to it is
        // asynchronous relative to when _nextBeatTime was last set — true for the
        // normal look-ahead loop, but not here: _nextBeatTime was just pinned to
        // the bar line on purpose, for beat 0 (the accent). A pending tick from
        // before this call would fire up to _timerInterval later, by which point
        // `now` has moved on and the guard's staleness check would re-derive past
        // this beat. Ticking synchronously closes that window; clearing any pending
        // timer first avoids scheduling the same beat twice.
        if (this._timerId !== null) {
            clearTimeout(this._timerId);
            this._timerId = null;
        }
        this._running = true;
        this._tick();
    }

    /**
     * Set metronome volume (0–1). Remembered even when muted.
     * @param {number} value
     */
    setVolume(value) {
        this._volume = Math.max(0, Math.min(1, value));
        if (!this._muted) {
            this.gainNode.gain.linearRampToValueAtTime(
                this._volume,
                this._ctx.currentTime + 0.02
            );
        }
    }

    /**
     * Toggle mute. Silences audio but keeps timer running (visual still works).
     * @param {boolean} muted
     */
    setMuted(muted) {
        this._muted = muted;
        this.gainNode.gain.linearRampToValueAtTime(
            muted ? 0 : this._volume,
            this._ctx.currentTime + 0.02
        );
    }

    /**
     * Look-ahead scheduling tick. Schedules clicks into the future.
     * @private
     */
    _tick() {
        if (!this._running) return;

        const now = this._ctx.currentTime;
        const beatDur = this._clock.getBeatDuration();

        // Re-derive rather than accumulate. The old code computed the grid once at
        // start() and then did `_nextBeatTime += getBeatDuration()`, so it kept the
        // OLD phase and adopted the NEW period on any tempo or time-signature
        // change — while MasterClock re-maps every boundary from the epoch. Players
        // align to the clock grid and the user hears the metronome grid, so the two
        // ended up a permanent half beat apart after a single BPM tweak.
        //
        // Re-deriving must not be unconditional: `_nextBeatTime` is deliberately
        // advanced past each click as it's scheduled (below) so the same click isn't
        // scheduled twice while it sits inside the look-ahead window across several
        // ticks. Re-deriving from `now` on every tick throws that progress away and
        // re-schedules the same upcoming click repeatedly.
        //
        // So re-derive on two conditions only: the cached time has already passed
        // (`< now`, e.g. after a stall — Test 4), or the grid itself moved out from
        // under it (a tempo/signature change since the last tick — Test 2). A plain
        // `< now` check misses the second case: right after a BPM change, the
        // previously-cached time can still be in the future yet wrong, because it
        // was computed under the old period.
        if (this._nextBeatTime < now || beatDur !== this._lastBeatDuration) {
            this._nextBeatTime = this._clock.getNextBeatTime(now);
        }
        this._lastBeatDuration = beatDur;

        const deadline = now + this._scheduleAhead;

        let budget = MAX_CLICKS_PER_TICK;
        while (this._nextBeatTime < deadline && budget-- > 0) {
            const beatIndex = this._clock.getBeatInBar(this._nextBeatTime + EPS);
            this._scheduleClick(this._nextBeatTime, beatIndex);

            // Handle count-in completion
            if (this._countInRemaining > 0) {
                this._countInRemaining--;
                if (this._countInRemaining === 0 && this._onCountInComplete) {
                    const cb = this._onCountInComplete;
                    this._onCountInComplete = null;
                    const at = this._countInEndTime;
                    // Hand the exact audio time to the callback so recording t=0
                    // lands on the bar boundary rather than on a wall-clock estimate.
                    setTimeout(() => cb(at), Math.max(0, (at - this._ctx.currentTime) * 1000));
                }
            }

            this._nextBeatTime = this._clock.getNextBeatTime(this._nextBeatTime + EPS);
        }

        this._timerId = setTimeout(() => this._tick(), this._timerInterval);
    }

    /**
     * Schedule an oscillator click at the given time.
     * Downbeat (beat 0): high-pitched accented click. Other beats: softer, lower click.
     * @param {number} when - AudioContext.currentTime to start the click.
     * @param {number} beatIndex - 0-based beat within bar.
     * @private
     */
    _scheduleClick(when, beatIndex) {
        const isDownbeat = beatIndex === 0;
        const freq = isDownbeat ? 1500 : 800;
        const amp = isDownbeat ? 1.0 : 0.35;
        const clickDuration = isDownbeat ? 0.03 : 0.015; // accent is longer for tonal clarity

        const osc = this._ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, when);
        // Pitch drop on the accent for a snappier "tick" character
        if (isDownbeat) {
            osc.frequency.exponentialRampToValueAtTime(900, when + clickDuration);
        }

        const clickGain = this._ctx.createGain();
        clickGain.gain.setValueAtTime(amp, when);
        clickGain.gain.exponentialRampToValueAtTime(0.001, when + clickDuration);

        osc.connect(clickGain);
        clickGain.connect(this.gainNode);

        osc.start(when);
        osc.stop(when + clickDuration + 0.01);

        // Fire visual beat callback (approximately timed via setTimeout)
        if (this.onBeat) {
            const delay = Math.max(0, (when - this._ctx.currentTime) * 1000);
            const idx = beatIndex;
            const down = isDownbeat;
            const tid = setTimeout(() => {
                if (this.onBeat) this.onBeat(idx, down);
            }, delay);
            this._beatTimeoutIds.push(tid);
            // Prevent unbounded growth: trim already-fired entries
            if (this._beatTimeoutIds.length > 32) {
                this._beatTimeoutIds = this._beatTimeoutIds.slice(-16);
            }
        }
    }
}
