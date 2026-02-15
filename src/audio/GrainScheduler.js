// GrainScheduler.js — Look-ahead timer that spawns grains on schedule

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
     * Update the inter-onset time (density).
     * @param {number} ms - Inter-onset time in milliseconds
     */
    setInterOnset(ms) {
        this.interOnset = ms / 1000;
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
            this.nextGrainTime += this.interOnset;
        }

        this._timerId = setTimeout(() => this._tick(), this.timerInterval);
    }
}
