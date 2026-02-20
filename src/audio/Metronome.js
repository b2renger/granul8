// Metronome.js — Audible click track with count-in support.
// Uses look-ahead scheduling (same pattern as GrainScheduler) for sample-accurate timing.

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
        this._nextBeatIndex = 0;  // 0-based beat within bar

        // Look-ahead parameters (same as GrainScheduler)
        this._scheduleAhead = 0.1;  // 100ms
        this._timerInterval = 25;   // 25ms

        // Count-in state
        this._countInRemaining = 0;
        this._onCountInComplete = null;
        this._countInBeatTime = 0;  // the time the count-in will complete (downbeat)

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

        const now = this._ctx.currentTime;
        this._nextBeatTime = this._clock.getNextBeatTime(now);

        // Determine which beat index we're starting on
        const elapsed = this._nextBeatTime - this._clock._epoch;
        const beatDur = this._clock.getBeatDuration();
        this._nextBeatIndex = Math.round(elapsed / beatDur) % this._clock.numerator;

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
    }

    /**
     * Start a count-in of exactly 1 bar, then fire callback on the downbeat.
     * Sets the clock epoch so the count-in bar is bar -1 and recording starts at bar 0.
     * @param {() => void} onComplete - Called when count-in finishes (on the next downbeat).
     */
    startCountIn(onComplete) {
        this._countInRemaining = this._clock.numerator;
        this._onCountInComplete = onComplete;

        // Set epoch so the count-in starts now
        const now = this._ctx.currentTime;
        this._clock.setEpoch(now);
        this._nextBeatTime = now;
        this._nextBeatIndex = 0;

        // Pre-compute when the count-in completes (= 1 bar from now)
        this._countInBeatTime = now + this._clock.getBarDuration();

        if (!this._running) {
            this._running = true;
            this._tick();
        }
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

        const deadline = this._ctx.currentTime + this._scheduleAhead;

        while (this._nextBeatTime < deadline) {
            this._scheduleClick(this._nextBeatTime, this._nextBeatIndex);

            // Handle count-in completion
            if (this._countInRemaining > 0) {
                this._countInRemaining--;
                if (this._countInRemaining === 0 && this._onCountInComplete) {
                    // Fire the callback aligned to the downbeat after the count-in
                    const cb = this._onCountInComplete;
                    this._onCountInComplete = null;
                    const delay = Math.max(0, (this._countInBeatTime - this._ctx.currentTime) * 1000);
                    setTimeout(() => cb(), delay);
                }
            }

            // Advance to next beat
            this._nextBeatTime += this._clock.getBeatDuration();
            this._nextBeatIndex = (this._nextBeatIndex + 1) % this._clock.numerator;
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
