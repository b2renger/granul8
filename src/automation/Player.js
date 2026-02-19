// Player.js — Replays recorded automation events through the engine.
// Uses requestAnimationFrame for frame-accurate event dispatch.
// Synthetic pointer IDs (1000 + voiceIndex) keep playback voices separate
// from live touch voices in the VoiceAllocator.

const SYNTHETIC_POINTER_BASE = 1000;

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

        /** @type {number} */
        this._startTime = 0;

        /** @type {number} */
        this._lastProcessedTime = 0;

        /** @type {number} */
        this._duration = 0;

        /** @type {Set<number>} Active synthetic pointer IDs */
        this._activeVoices = new Set();

        /** @type {number|null} */
        this._rafId = null;

        // --- Callbacks (set by main.js) ---

        /**
         * Called to dispatch a voice action on the engine.
         * @type {((type: 'start'|'move'|'stop', syntheticPointerId: number, params?: Object) => void)|null}
         */
        this.onDispatch = null;

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

        this._tick = this._tick.bind(this);
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
        this.isPlaying = true;
        this._rafId = requestAnimationFrame(this._tick);
    }

    /**
     * Stop playback and release all playback voices.
     */
    stop() {
        this.isPlaying = false;
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        this._stopAllPlaybackVoices();
        this._lane = null;
    }

    /**
     * Update loop state (can be toggled during playback).
     * @param {boolean} loop
     */
    setLoop(loop) {
        this._loop = loop;
    }

    /**
     * Get current playback elapsed time.
     * @returns {number}
     */
    getElapsedTime() {
        if (!this.isPlaying) return 0;
        return this._audioContext.currentTime - this._startTime;
    }

    /** @private */
    _tick() {
        if (!this.isPlaying || !this._lane) return;

        const elapsed = this._audioContext.currentTime - this._startTime;

        // Check if playback has reached the end
        if (elapsed >= this._duration) {
            if (this._loop) {
                // Stop all active voices, restart from beginning
                this._stopAllPlaybackVoices();
                this._startTime = this._audioContext.currentTime;
                this._lastProcessedTime = 0;
            } else {
                // Playback complete
                this._stopAllPlaybackVoices();
                this.isPlaying = false;
                this._rafId = null;
                if (this.onFrame) this.onFrame(this._duration, 1);
                if (this.onComplete) this.onComplete();
                return;
            }
        }

        // Process events in the window [lastProcessedTime, currentElapsed)
        const currentElapsed = this._audioContext.currentTime - this._startTime;
        const events = this._lane.getEventsInRange(this._lastProcessedTime, currentElapsed);

        for (const event of events) {
            const syntheticId = SYNTHETIC_POINTER_BASE + event.voiceIndex;

            switch (event.type) {
                case 'start':
                    this._activeVoices.add(syntheticId);
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
                    this._activeVoices.delete(syntheticId);
                    if (this.onDispatch) {
                        this.onDispatch('stop', syntheticId);
                    }
                    break;
            }
        }

        this._lastProcessedTime = currentElapsed;

        // Report frame progress
        if (this.onFrame) {
            this.onFrame(currentElapsed, currentElapsed / this._duration);
        }

        this._rafId = requestAnimationFrame(this._tick);
    }

    /** @private */
    _stopAllPlaybackVoices() {
        if (this.onDispatch) {
            for (const syntheticId of this._activeVoices) {
                this.onDispatch('stop', syntheticId);
            }
        }
        this._activeVoices.clear();
    }
}
