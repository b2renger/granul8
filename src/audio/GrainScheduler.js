// GrainScheduler.js — Look-ahead timer that spawns grains on schedule

import { quantizeDensity } from '../utils/musicalQuantizer.js';

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

        /** Random inter-onset range [min, max] in seconds, or null for fixed. */
        this.interOnsetRange = null;

        /** BPM for per-grain inter-onset quantization, or null for continuous. */
        this.quantizeBpm = null;

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
     * Each grain picks a random value between min and max.
     * @param {number} minMs - Minimum inter-onset in milliseconds
     * @param {number} maxMs - Maximum inter-onset in milliseconds
     */
    setInterOnsetRange(minMs, maxMs) {
        this.interOnsetRange = [minMs / 1000, maxMs / 1000];
    }

    /**
     * Internal tick — schedules grains into the look-ahead window,
     * then re-arms the timer.
     */
    _tick() {
        if (!this._running) return;

        const deadline = this.audioContext.currentTime + this.scheduleAhead;

        while (this.nextGrainTime < deadline) {
            this.onScheduleGrain(this.nextGrainTime);
            // Use random jitter range if set, otherwise fixed interOnset
            let iot = this.interOnsetRange
                ? this.interOnsetRange[0] + Math.random() * (this.interOnsetRange[1] - this.interOnsetRange[0])
                : this.interOnset;
            // Snap to nearest BPM subdivision when quantization is active
            if (this.quantizeBpm !== null && this.interOnsetRange) {
                iot = quantizeDensity(iot, this.quantizeBpm).seconds;
            }
            this.nextGrainTime += iot;
        }

        this._timerId = setTimeout(() => this._tick(), this.timerInterval);
    }
}
