// MasterClock.js — Passive timing calculator anchored to AudioContext.currentTime.
// Provides beat/bar queries and quantization for the loop station system.

export class MasterClock {
    /**
     * @param {AudioContext} audioContext
     */
    constructor(audioContext) {
        this._ctx = audioContext;

        // Musical properties
        this._bpm = 120;
        this._numerator = 4;    // beats per bar (2–12)
        this._denominator = 4;  // beat unit: 4 = quarter, 8 = eighth, 16 = sixteenth

        // Epoch: the AudioContext.currentTime at which beat 0 / bar 0 occurs.
        // Set explicitly via setEpoch() when playback or recording begins.
        this._epoch = 0;
    }

    // --- Property getters/setters ---

    get bpm() { return this._bpm; }
    set bpm(value) { this._bpm = Math.max(40, Math.min(300, value)); }

    get numerator() { return this._numerator; }
    set numerator(value) { this._numerator = Math.max(2, Math.min(12, value)); }

    get denominator() { return this._denominator; }
    set denominator(value) {
        if ([4, 8, 16].includes(value)) this._denominator = value;
    }

    // --- Derived durations ---

    /**
     * Duration of one beat in seconds.
     * Accounts for denominator: beat = (60/bpm) * (4/denominator).
     * 4/4 at 120bpm → 0.5s per beat.
     * 6/8 at 120bpm → 0.25s per beat (eighth-note beats).
     */
    getBeatDuration() {
        return (60 / this._bpm) * (4 / this._denominator);
    }

    /**
     * Duration of one bar in seconds.
     */
    getBarDuration() {
        return this.getBeatDuration() * this._numerator;
    }

    // --- Epoch management ---

    /**
     * Set the epoch (beat 0 / bar 0 reference time).
     * @param {number} [time] - AudioContext.currentTime value. Defaults to now.
     */
    setEpoch(time) {
        this._epoch = time ?? this._ctx.currentTime;
    }

    /**
     * Get time elapsed since epoch.
     * @param {number} [now] - Optional AudioContext.currentTime override.
     * @returns {number} Seconds elapsed.
     */
    getElapsed(now) {
        return (now ?? this._ctx.currentTime) - this._epoch;
    }

    // --- Beat/bar queries ---

    /**
     * Get the current beat phase (0.0–1.0 fraction through the current beat).
     * Useful for visual pulse animations.
     * @param {number} [now]
     * @returns {number}
     */
    getBeatPhase(now) {
        const elapsed = this.getElapsed(now);
        if (elapsed < 0) return 0;
        const beatDur = this.getBeatDuration();
        return (elapsed % beatDur) / beatDur;
    }

    /**
     * Get the current beat index within the current bar (0-based).
     * @param {number} [now]
     * @returns {number} 0 to (numerator - 1).
     */
    getBeatInBar(now) {
        const elapsed = this.getElapsed(now);
        if (elapsed < 0) return 0;
        const beatDur = this.getBeatDuration();
        const beatIndex = Math.floor(elapsed / beatDur);
        return beatIndex % this._numerator;
    }

    /**
     * Get the absolute beat number since epoch.
     * @param {number} [now]
     * @returns {number}
     */
    getCurrentBeat(now) {
        const elapsed = this.getElapsed(now);
        if (elapsed < 0) return 0;
        return Math.floor(elapsed / this.getBeatDuration());
    }

    /**
     * Get the absolute bar number since epoch.
     * @param {number} [now]
     * @returns {number}
     */
    getCurrentBar(now) {
        const elapsed = this.getElapsed(now);
        if (elapsed < 0) return 0;
        return Math.floor(elapsed / this.getBarDuration());
    }

    // --- Future boundary queries ---

    /**
     * Get the AudioContext.currentTime of the next beat boundary.
     * @param {number} [now]
     * @returns {number}
     */
    getNextBeatTime(now) {
        now = now ?? this._ctx.currentTime;
        const elapsed = now - this._epoch;
        const beatDur = this.getBeatDuration();
        const currentBeat = Math.floor(elapsed / beatDur);
        return this._epoch + (currentBeat + 1) * beatDur;
    }

    /**
     * Get the AudioContext.currentTime of the next bar boundary.
     * @param {number} [now]
     * @returns {number}
     */
    getNextBarTime(now) {
        now = now ?? this._ctx.currentTime;
        const elapsed = now - this._epoch;
        const barDur = this.getBarDuration();
        const currentBar = Math.floor(elapsed / barDur);
        return this._epoch + (currentBar + 1) * barDur;
    }

    // --- Quantization ---

    /**
     * Snap a time value to the nearest bar boundary.
     * @param {number} time - AudioContext.currentTime value.
     * @returns {number}
     */
    quantizeToBar(time) {
        const barDur = this.getBarDuration();
        const elapsed = time - this._epoch;
        return this._epoch + Math.round(elapsed / barDur) * barDur;
    }

    /**
     * Snap a time value to the nearest beat boundary.
     * @param {number} time - AudioContext.currentTime value.
     * @returns {number}
     */
    quantizeToBeat(time) {
        const beatDur = this.getBeatDuration();
        const elapsed = time - this._epoch;
        return this._epoch + Math.round(elapsed / beatDur) * beatDur;
    }

    /**
     * Snap a duration (in seconds) to the nearest bar boundary.
     * Useful for snapping recording duration to whole bars.
     * @param {number} duration - Duration in seconds.
     * @returns {number} Snapped duration (minimum 1 bar).
     */
    quantizeDurationToBar(duration) {
        const barDur = this.getBarDuration();
        const bars = Math.max(1, Math.round(duration / barDur));
        return bars * barDur;
    }

    /**
     * Get the duration of N bars in seconds.
     * @param {number} numBars
     * @returns {number}
     */
    getBarsDuration(numBars) {
        return this.getBarDuration() * numBars;
    }
}
