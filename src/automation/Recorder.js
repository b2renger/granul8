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

        /** @type {boolean} */
        this.isOverdubbing = false;

        /** @type {AutomationLane} */
        this._lane = new AutomationLane();

        /** @type {AutomationLane|null} Temp lane during overdub */
        this._overdubLane = null;

        /** @type {AutomationLane|null} Pre-overdub snapshot for undo */
        this._undoSnapshot = null;

        /** @type {number} */
        this._startTime = 0;

        /** @type {Map<number, number>} pointerId → last capture time (seconds) */
        this._lastMoveTime = new Map();

        /** @type {Set<number>} voiceIndexes with an open 'start' and no 'stop' yet */
        this._held = new Set();
    }

    /**
     * Start recording. Resets the lane and begins capturing events.
     * @param {number} [atTime] - AudioContext time to treat as t=0. Defaults to
     *   now. Pass the count-in downbeat so the recording's origin sits exactly on
     *   the bar grid rather than on a wall-clock setTimeout estimate.
     */
    startRecording(atTime) {
        // Snapshot rather than discard. Record and Play are adjacent 44px squares
        // in the transport, and this used to clear the lane AND clear the
        // snapshot — so a mis-hit destroyed a multi-pass loop permanently,
        // mid-set, with nothing to go back to. Overdub already snapshotted; a new
        // take is the more destructive of the two and did not.
        this._undoSnapshot = this._lane.length > 0
            ? AutomationLane.fromJSON(this._lane.toJSON())
            : null;
        this._lane = new AutomationLane();
        this._lastMoveTime.clear();
        this._held.clear();
        this._startTime = atTime ?? this._audioContext.currentTime;
        this.isRecording = true;
        this.isOverdubbing = false;
    }

    /**
     * Start overdub recording. Captures into a temp lane while the original plays.
     * @param {number} startTime - AudioContext.currentTime when playback started
     */
    startOverdub(startTime) {
        this._undoSnapshot = AutomationLane.fromJSON(this._lane.toJSON());
        this._overdubLane = new AutomationLane();
        this._lastMoveTime.clear();
        this._held.clear();
        this._startTime = startTime;
        this.isRecording = true;
        this.isOverdubbing = true;
    }

    /**
     * Stop recording. If overdubbing, merge the temp lane into the main lane.
     */
    stopRecording() {
        // Close any voice still held when recording stopped. Without this the lane
        // contains a 'start' with no matching 'stop', and on playback that voice
        // sustains for the rest of the loop.
        if (this.isRecording && this._held.size > 0) {
            const time = this._audioContext.currentTime - this._startTime;
            const target = this._overdubLane || this._lane;
            for (const voiceIndex of this._held) {
                target.addEvent({ time, voiceIndex, type: 'stop' });
            }
            this._held.clear();
        }

        if (this.isOverdubbing && this._overdubLane) {
            this._lane = AutomationLane.merge(this._lane, this._overdubLane);
            this._overdubLane = null;
        }
        this.isRecording = false;
        this.isOverdubbing = false;
        this._lastMoveTime.clear();
    }

    /**
     * Undo the last overdub — revert to the pre-overdub snapshot.
     * @returns {boolean} True if undo was applied.
     */
    undo() {
        if (!this._undoSnapshot) return false;
        this._lane = this._undoSnapshot;
        this._undoSnapshot = null;
        return true;
    }

    /**
     * @deprecated Use undo(). Kept because callers outside this file still use
     * the old name, and it now covers new takes as well as overdub passes.
     * @returns {boolean}
     */
    undoOverdub() { return this.undo(); }

    /** @returns {boolean} Whether an undo snapshot exists. */
    get canUndo() {
        return this._undoSnapshot !== null;
    }

    /**
     * Get the recorded automation lane.
     * @returns {AutomationLane}
     */
    getRecording() {
        return this._lane;
    }

    /**
     * Replace the current lane with a pre-existing one (e.g. restored from session).
     * @param {AutomationLane} lane
     */
    setRecording(lane) {
        this._lane = lane;
        this._undoSnapshot = null;
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
        const target = this._overdubLane || this._lane;
        target.addEvent({
            time,
            voiceIndex,
            type: 'start',
            params: extractParams(resolvedParams, true),
        });
        this._held.add(voiceIndex);
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

        const target = this._overdubLane || this._lane;
        target.addEvent({
            time,
            voiceIndex,
            type: 'move',
            params: extractParams(resolvedParams, false),
        });
    }

    /**
     * Capture a voice stop event.
     * @param {number} voiceIndex - The voice slot being released
     */
    captureStop(voiceIndex) {
        if (!this.isRecording) return;
        const time = this._audioContext.currentTime - this._startTime;
        const target = this._overdubLane || this._lane;
        target.addEvent({
            time,
            voiceIndex,
            type: 'stop',
        });
        this._held.delete(voiceIndex);
        this._lastMoveTime.delete(voiceIndex);
    }
}

/**
 * Extract the params relevant for automation playback.
 *
 * `full` events (voice starts) carry the modulation configuration —
 * randomize ranges, quantization and the arpeggiator note table. Without it,
 * replayed voices silently inherited whatever the pool slot last held from a live
 * gesture: a recording sounded right immediately after capture and lost its
 * arpeggio on reload, when every Voice is reconstructed with pitchQuantize=null.
 *
 * Move events carry scalars only. Voice.update() ignores undefined keys, so the
 * modulation set at 'start' stays in force for the whole gesture, and the arp
 * note table is not repeated 30 times a second in the saved session.
 *
 * @param {Object} resolved
 * @param {boolean} full - true for 'start' events
 * @returns {Object}
 */
function extractParams(resolved, full) {
    const params = {
        position: resolved.position,
        amplitude: resolved.amplitude,
        pitch: resolved.pitch,
        grainSize: resolved.grainSize,
        interOnset: resolved.interOnset,
        spread: resolved.spread,
        pan: resolved.pan,
        envelope: resolved.envelope,
    };
    // Include per-instance ADSR so playback uses the correct envelope shape
    if (resolved.adsr) params.adsr = resolved.adsr;
    if (!full) return params;

    params.randomize = resolved.randomize ?? null;
    params.interOnsetRange = resolved.interOnsetRange ?? null;
    params.interOnsetQuantize = resolved.interOnsetQuantize ?? null;
    params.grainSizeQuantize = resolved.grainSizeQuantize ?? null;
    params.pitchQuantize = resolved.pitchQuantize ?? null;
    return params;
}
