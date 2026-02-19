// Recorder.js — Captures live pointer gestures into an AutomationLane.
// The recorder hooks into PointerHandler callbacks and captures start/move/stop
// events with full voice state. Pointermove events are throttled to 30 per second
// per pointer to keep recordings compact.

import { AutomationLane } from './AutomationLane.js';

const THROTTLE_INTERVAL = 1 / 30; // ~33ms between move events per pointer

export class Recorder {
    /**
     * @param {AudioContext} audioContext - For timing reference
     */
    constructor(audioContext) {
        this._audioContext = audioContext;

        /** @type {boolean} */
        this.isRecording = false;

        /** @type {AutomationLane} */
        this._lane = new AutomationLane();

        /** @type {number} */
        this._startTime = 0;

        /** @type {Map<number, number>} pointerId → last capture time (seconds) */
        this._lastMoveTime = new Map();
    }

    /**
     * Start recording. Resets the lane and begins capturing events.
     */
    startRecording() {
        this._lane.clear();
        this._lastMoveTime.clear();
        this._startTime = this._audioContext.currentTime;
        this.isRecording = true;
    }

    /**
     * Stop recording.
     */
    stopRecording() {
        this.isRecording = false;
        this._lastMoveTime.clear();
    }

    /**
     * Get the recorded automation lane.
     * @returns {AutomationLane}
     */
    getRecording() {
        return this._lane;
    }

    /**
     * Get elapsed recording time in seconds.
     * @returns {number}
     */
    getElapsedTime() {
        if (!this.isRecording) return this._lane.getDuration();
        return this._audioContext.currentTime - this._startTime;
    }

    /**
     * Capture a voice start event.
     * @param {number} voiceIndex - The allocated voice slot (0-based)
     * @param {Object} resolvedParams - The resolved engine params
     */
    captureStart(voiceIndex, resolvedParams) {
        if (!this.isRecording) return;
        const time = this._audioContext.currentTime - this._startTime;
        this._lane.addEvent({
            time,
            voiceIndex,
            type: 'start',
            params: extractParams(resolvedParams),
        });
        // Reset throttle timer for this pointer so the first move after start is captured
        this._lastMoveTime.delete(voiceIndex);
    }

    /**
     * Capture a voice move event (throttled to 30/sec per pointer).
     * @param {number} voiceIndex - The voice slot being updated
     * @param {Object} resolvedParams - The resolved engine params
     */
    captureMove(voiceIndex, resolvedParams) {
        if (!this.isRecording) return;
        const now = this._audioContext.currentTime;
        const time = now - this._startTime;

        // Throttle: skip if the last capture for this voice was too recent
        const lastTime = this._lastMoveTime.get(voiceIndex);
        if (lastTime !== undefined && (now - lastTime) < THROTTLE_INTERVAL) {
            return;
        }
        this._lastMoveTime.set(voiceIndex, now);

        this._lane.addEvent({
            time,
            voiceIndex,
            type: 'move',
            params: extractParams(resolvedParams),
        });
    }

    /**
     * Capture a voice stop event.
     * @param {number} voiceIndex - The voice slot being released
     */
    captureStop(voiceIndex) {
        if (!this.isRecording) return;
        const time = this._audioContext.currentTime - this._startTime;
        this._lane.addEvent({
            time,
            voiceIndex,
            type: 'stop',
        });
        this._lastMoveTime.delete(voiceIndex);
    }
}

/**
 * Extract the subset of resolved params relevant for automation playback.
 * @param {Object} resolved
 * @returns {Object}
 */
function extractParams(resolved) {
    return {
        position: resolved.position,
        amplitude: resolved.amplitude,
        pitch: resolved.pitch,
        grainSize: resolved.grainSize,
        interOnset: resolved.interOnset,
        spread: resolved.spread,
        pan: resolved.pan,
        envelope: resolved.envelope,
    };
}
