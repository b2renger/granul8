// GrainScheduler.js — Look-ahead timer that spawns grains on schedule

import { getSubdivisionSeconds } from '../utils/musicalQuantizer.js';
import { expMap } from '../utils/math.js';

/**
 * Hard cap on grains scheduled in a single tick. The clamp below already drops
 * missed grains, so this only bounds pathological cases (a stall arriving mid-tick).
 */
const MAX_GRAINS_PER_TICK = 256;

export class GrainScheduler {
    /**
     * @param {AudioContext} audioContext
     * @param {(when: number) => void} onScheduleGrain - Called for each grain to schedule
     */
    constructor(audioContext, onScheduleGrain) {
        this.audioContext = audioContext;
        this.onScheduleGrain = onScheduleGrain;

        /** How far ahead to schedule grains (seconds) */
        this.scheduleAhead = 0.1;

        /** How often the timer fires (ms) */
        this.timerInterval = 25;

        /** Inter-onset time between grains (seconds) */
        this.interOnset = 0.030;

        /** Random inter-onset range [min, max] in normalized 0–1 space, or null for fixed. */
        this.interOnsetRange = null;

        /** BPM for per-grain inter-onset quantization, or null for continuous. */
        this.quantizeBpm = null;
        /** Subdivision divisor for per-grain inter-onset quantization. */
        this.quantizeDivisor = null;

        /** @type {number} audioContext.currentTime of the next grain */
        this.nextGrainTime = 0;

        /** @type {number|null} setTimeout ID */
        this._timerId = null;

        this._running = false;
    }

    /**
     * Start scheduling grains.
     */
    start() {
        if (this._running) return;
        this._running = true;
        this.nextGrainTime = this.audioContext.currentTime;
        this._tick();
    }

    /**
     * Stop scheduling grains.
     */
    stop() {
        this._running = false;
        if (this._timerId !== null) {
            clearTimeout(this._timerId);
            this._timerId = null;
        }
    }

    /**
     * Update the inter-onset time (density). Clears any jitter range.
     * @param {number} ms - Inter-onset time in milliseconds
     */
    setInterOnset(ms) {
        this.interOnset = ms / 1000;
        this.interOnsetRange = null;
    }

    /**
     * Set a random inter-onset range for per-grain jitter.
     * Values are in normalized slider space (0–1); the actual mapping
     * (expMap or subdivision lookup) is applied per grain in _tick().
     * @param {number} min - Normalized minimum (0–1)
     * @param {number} max - Normalized maximum (0–1)
     */
    setInterOnsetRange(min, max) {
        this.interOnsetRange = [min, max];
    }

    /**
     * Internal tick — schedules grains into the look-ahead window,
     * then re-arms the timer.
     */
    _tick() {
        if (!this._running) return;

        const now = this.audioContext.currentTime;

        // Re-anchor after a timer stall. setTimeout is throttled to >=1 s in a
        // hidden tab and blocked outright by decodeAudioData, GC or a session
        // import, while audioContext.currentTime keeps running. Without this the
        // loop below would run (stall / interOnset) times with `when` in the past,
        // and source.start(when < currentTime) starts immediately — so every
        // missed grain fires in the same render quantum.
        // Missed grains are dropped, not replayed.
        if (this.nextGrainTime < now) this.nextGrainTime = now;

        const deadline = now + this.scheduleAhead;

        try {
            let budget = MAX_GRAINS_PER_TICK;
            while (this.nextGrainTime < deadline && budget-- > 0) {
                this.onScheduleGrain(this.nextGrainTime);

                let iot;
                if (this.interOnsetRange) {
                    // Random jitter: pick in normalized space, then map per grain
                    const norm = this.interOnsetRange[0]
                        + Math.random() * (this.interOnsetRange[1] - this.interOnsetRange[0]);
                    if (this.quantizeBpm !== null && this.quantizeDivisor !== null) {
                        // Quantized: use explicit subdivision divisor
                        iot = getSubdivisionSeconds(this.quantizeBpm, this.quantizeDivisor);
                    } else {
                        // Free: exponential mapping for perceptually uniform distribution
                        iot = expMap(norm, 0.005, 0.5);
                    }
                } else {
                    iot = this.interOnset;
                }

                this.nextGrainTime += iot;
            }
        } catch (err) {
            // Never let one bad grain kill the voice's scheduler permanently:
            // the timer re-arm below is outside this block.
            console.error('Grain scheduling failed:', err);
            this.nextGrainTime = this.audioContext.currentTime + this.scheduleAhead;
        }

        this._timerId = setTimeout(() => this._tick(), this.timerInterval);
    }
}
