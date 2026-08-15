// Player.js — Replays recorded automation events through the engine.
// Driven by a setTimeout look-ahead tick, not requestAnimationFrame: rAF is
// suspended entirely in a hidden tab, which would let voices drone silently
// (or drop stops) while a backgrounded tab is away.
//
// Crossfade looping: alternates between two synthetic ID ranges (A/B).
// When approaching the loop end, pre-starts the next iteration's voices
// from loopStart while the current iteration's grains play out naturally.
// This eliminates the audible gap at loop boundaries.

const SYNTHETIC_POINTER_BASE_A = 1000;
const SYNTHETIC_POINTER_BASE_B = 2000;

/** Pre-start window: start next iteration this many seconds before loop end. */
const CROSSFADE_WINDOW = 0.050; // 50ms

/**
 * Transport tick interval (ms). Matches GrainScheduler's timer so both run on
 * the same cadence. rAF is not usable here: browsers suspend it entirely in a
 * hidden tab, while grain production runs on setTimeout and keeps going — so an
 * rAF-driven transport lets voices drone for as long as the tab is away and then
 * drops whole loop iterations on return.
 */
const TICK_MS = 25;

export class Player {
    /**
     * @param {AudioContext} audioContext - For timing reference
     */
    constructor(audioContext) {
        this._audioContext = audioContext;

        /** @type {boolean} */
        this.isPlaying = false;

        /** @type {import('./AutomationLane.js').AutomationLane|null} */
        this._lane = null;

        /** @type {boolean} */
        this._loop = false;

        /** @type {number} Loop start time (seconds within recording, 0 = beginning) */
        this._loopStart = 0;

        /** @type {number} Loop end time (seconds, 0 = use full duration) */
        this._loopEnd = 0;

        /** @type {number} */
        this._startTime = 0;

        /** @type {number} */
        this._lastProcessedTime = 0;

        /** @type {number} */
        this._duration = 0;

        // --- Crossfade iteration tracking ---
        /** @type {'A'|'B'} */
        this._currentIteration = 'A';

        /** @type {Set<number>} Active synthetic IDs for iteration A */
        this._activeVoicesA = new Set();

        /** @type {Set<number>} Active synthetic IDs for iteration B */
        this._activeVoicesB = new Set();

        /** @type {boolean} True when we've pre-started the next iteration */
        this._crossfadeStarted = false;

        // --- Loop station mode ---
        this._loopStationMode = false;

        /** @type {import('../audio/MasterClock.js').MasterClock|null} */
        this._clock = null;

        /** @type {number|null} setTimeout id for the transport tick */
        this._timerId = null;

        // --- Callbacks ---

        /**
         * Called to dispatch a voice action on the engine (start/move/stop).
         * @type {((type: 'start'|'move'|'stop', syntheticPointerId: number, params?: Object) => void)|null}
         */
        this.onDispatch = null;

        /**
         * Called to release a voice (scheduler stops, grains play out).
         * Used at loop boundaries for seamless crossfade.
         * @type {((syntheticPointerId: number) => void)|null}
         */
        this.onRelease = null;

        /**
         * Called each frame with elapsed time and progress fraction.
         * @type {((elapsed: number, progress: number) => void)|null}
         */
        this.onFrame = null;

        /**
         * Called when playback finishes (non-looping).
         * @type {(() => void)|null}
         */
        this.onComplete = null;

        /**
         * Called at each loop boundary when looping wraps around.
         * Used for loop-station overdub: commit overdub and restart with merged lane.
         * @type {(() => void)|null}
         */
        this.onLoopWrap = null;

        this._tick = this._tick.bind(this);
    }

    /**
     * Enable/disable loop station mode (bar-grid aligned looping).
     * @param {boolean} enabled
     * @param {import('../audio/MasterClock.js').MasterClock|null} clock
     */
    setLoopStationMode(enabled, clock) {
        this._loopStationMode = enabled;
        this._clock = clock || null;
    }

    /**
     * Start playback of an automation lane.
     * @param {import('./AutomationLane.js').AutomationLane} lane
     * @param {boolean} loop
     */
    play(lane, loop) {
        if (this.isPlaying) this.stop();

        this._lane = lane;
        this._loop = loop;
        this._duration = lane.getDuration();

        if (this._duration === 0) return;

        this._startTime = this._audioContext.currentTime;
        this._lastProcessedTime = 0;
        this._currentIteration = 'A';
        this._activeVoicesA.clear();
        this._activeVoicesB.clear();
        this._crossfadeStarted = false;
        this.isPlaying = true;
        this._timerId = setTimeout(this._tick, TICK_MS);
        this._tick();
    }

    /**
     * Stop playback and release all playback voices.
     */
    stop() {
        this.isPlaying = false;
        if (this._timerId !== null) {
            clearTimeout(this._timerId);
            this._timerId = null;
        }
        this._stopIterationVoices('A');
        this._stopIterationVoices('B');
        this._lane = null;
    }

    /**
     * Hot-swap the lane during playback (e.g. after overdub merge).
     * Playback continues seamlessly with the new lane data.
     * @param {import('./AutomationLane.js').AutomationLane} lane
     */
    setLane(lane) {
        this._lane = lane;
        this._duration = lane.getDuration();
    }

    /**
     * Update loop state (can be toggled during playback).
     * @param {boolean} loop
     */
    setLoop(loop) {
        this._loop = loop;
    }

    /**
     * Set loop start/end points (seconds within the recording).
     * Use 0/0 to loop the full recording.
     * @param {number} start - Loop start time (seconds)
     * @param {number} end - Loop end time (seconds, 0 = use full duration)
     */
    setLoopRange(start, end) {
        this._loopStart = start;
        this._loopEnd = end;
    }

    /**
     * Get the effective loop range.
     * @returns {{ start: number, end: number }}
     */
    getLoopRange() {
        return {
            start: this._loopStart,
            end: this._loopEnd > 0 ? this._loopEnd : this._duration,
        };
    }

    /**
     * Get current playback elapsed time.
     * @returns {number}
     */
    getElapsedTime() {
        if (!this.isPlaying) return 0;
        return this._audioContext.currentTime - this._startTime;
    }

    // --- Iteration helpers ---

    /** @private */
    _getCurrentBase() {
        return this._currentIteration === 'A' ? SYNTHETIC_POINTER_BASE_A : SYNTHETIC_POINTER_BASE_B;
    }

    /** @private */
    _getNextBase() {
        return this._currentIteration === 'A' ? SYNTHETIC_POINTER_BASE_B : SYNTHETIC_POINTER_BASE_A;
    }

    /** @private */
    _getCurrentActiveVoices() {
        return this._currentIteration === 'A' ? this._activeVoicesA : this._activeVoicesB;
    }

    /** @private */
    _getNextActiveVoices() {
        return this._currentIteration === 'A' ? this._activeVoicesB : this._activeVoicesA;
    }

    // --- Main tick ---

    /** @private */
    _tick() {
        if (this._timerId !== null) { clearTimeout(this._timerId); this._timerId = null; }
        if (!this.isPlaying || !this._lane) return;

        const elapsed = this._audioContext.currentTime - this._startTime;
        const loopEnd = this._loopEnd > 0 ? this._loopEnd : this._duration;

        // === CROSSFADE PRE-START ===
        // When within CROSSFADE_WINDOW of loop end, pre-start next iteration
        if (this._loop && !this._crossfadeStarted && elapsed >= (loopEnd - CROSSFADE_WINDOW)) {
            this._crossfadeStarted = true;
            this._preStartNextIteration();
        }

        // === LOOP BOUNDARY ===
        if (elapsed >= loopEnd) {
            if (this._loop) {
                const loopLen = loopEnd - this._loopStart;
                if (loopLen <= 0) { this._timerId = setTimeout(this._tick, TICK_MS); return; }

                const didCrossfade = this._crossfadeStarted;

                // Release old iteration voices (grains play out naturally)
                this._releaseIterationVoices(this._currentIteration);

                // Swap iterations
                this._currentIteration = this._currentIteration === 'A' ? 'B' : 'A';

                // Advance the anchor by whole loop lengths rather than resetting it
                // to `now`. Resetting discarded the frame overshoot, making every
                // iteration one tick too long — unbounded drift. A long stall can
                // span several iterations, so consume them all.
                let overshoot = elapsed - loopEnd;
                this._startTime += loopLen;
                while (overshoot >= loopLen) {
                    this._startTime += loopLen;
                    overshoot -= loopLen;
                }

                // _preStartNextIteration already dispatched
                // [loopStart, loopStart + CROSSFADE_WINDOW) on the incoming voices.
                // Resume after that window so those events do not fire a second time.
                const alreadySent = didCrossfade ? CROSSFADE_WINDOW : 0;
                this._lastProcessedTime = this._loopStart + Math.max(alreadySent, overshoot);

                this._crossfadeStarted = false;

                // Notify loop wrap (used for overdub auto-commit)
                if (this.onLoopWrap) this.onLoopWrap();
            } else {
                // Non-looping: playback complete
                this._stopIterationVoices('A');
                this._stopIterationVoices('B');
                this.isPlaying = false;
                if (this._timerId !== null) { clearTimeout(this._timerId); this._timerId = null; }
                if (this.onFrame) this.onFrame(this._duration, 1);
                if (this.onComplete) this.onComplete();
                return;
            }
        }

        // === NORMAL EVENT DISPATCH ===
        const currentElapsed = this._audioContext.currentTime - this._startTime;
        const events = this._lane.getEventsInRange(this._lastProcessedTime, currentElapsed);
        const base = this._getCurrentBase();
        const activeVoices = this._getCurrentActiveVoices();

        for (const event of events) {
            const syntheticId = base + event.voiceIndex;

            switch (event.type) {
                case 'start':
                    activeVoices.add(syntheticId);
                    if (this.onDispatch) {
                        this.onDispatch('start', syntheticId, event.params);
                    }
                    break;

                case 'move':
                    if (this.onDispatch) {
                        this.onDispatch('move', syntheticId, event.params);
                    }
                    break;

                case 'stop':
                    activeVoices.delete(syntheticId);
                    if (this.onDispatch) {
                        this.onDispatch('stop', syntheticId);
                    }
                    break;
            }
        }

        // Monotonic: on a boundary tick the block above may have jumped
        // _lastProcessedTime past the crossfade window (or, with a stall,
        // past several loop lengths) to a point ahead of currentElapsed —
        // never let this fall back below that.
        this._lastProcessedTime = Math.max(this._lastProcessedTime, currentElapsed);

        // Report frame progress
        if (this.onFrame) {
            this.onFrame(currentElapsed, currentElapsed / this._duration);
        }

        this._timerId = setTimeout(this._tick, TICK_MS);
    }

    /**
     * Pre-start the next iteration by dispatching events from the loop start
     * region using the next iteration's synthetic IDs. This creates the
     * crossfade overlap: new voices start producing grains while old voices'
     * pre-scheduled grains play out.
     * @private
     */
    _preStartNextIteration() {
        if (!this._lane) return;

        const nextBase = this._getNextBase();
        const nextVoices = this._getNextActiveVoices();
        nextVoices.clear();

        // Dispatch events from the first CROSSFADE_WINDOW of the loop
        const windowEnd = this._loopStart + CROSSFADE_WINDOW;
        const events = this._lane.getEventsInRange(this._loopStart, windowEnd);

        for (const event of events) {
            const syntheticId = nextBase + event.voiceIndex;

            switch (event.type) {
                case 'start':
                    nextVoices.add(syntheticId);
                    if (this.onDispatch) {
                        this.onDispatch('start', syntheticId, event.params);
                    }
                    break;

                case 'move':
                    if (this.onDispatch) {
                        this.onDispatch('move', syntheticId, event.params);
                    }
                    break;

                case 'stop':
                    nextVoices.delete(syntheticId);
                    if (this.onDispatch) {
                        this.onDispatch('stop', syntheticId);
                    }
                    break;
            }
        }
    }

    /**
     * Release voices for an iteration — stops schedulers but lets pre-scheduled
     * grains play out naturally. Used at loop boundaries for seamless crossfade.
     * @param {'A'|'B'} iteration
     * @private
     */
    _releaseIterationVoices(iteration) {
        const voices = iteration === 'A' ? this._activeVoicesA : this._activeVoicesB;
        if (this.onRelease) {
            for (const syntheticId of voices) {
                this.onRelease(syntheticId);
            }
        } else if (this.onDispatch) {
            // Fallback: hard-stop if onRelease is not wired
            for (const syntheticId of voices) {
                this.onDispatch('stop', syntheticId);
            }
        }
        voices.clear();
    }

    /**
     * Hard-stop voices for an iteration (with gain fade).
     * Used when stopping playback entirely.
     * @param {'A'|'B'} iteration
     * @private
     */
    _stopIterationVoices(iteration) {
        const voices = iteration === 'A' ? this._activeVoicesA : this._activeVoicesB;
        if (this.onDispatch) {
            for (const syntheticId of voices) {
                this.onDispatch('stop', syntheticId);
            }
        }
        voices.clear();
    }
}
