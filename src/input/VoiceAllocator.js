// VoiceAllocator.js — Maps pointer IDs to Voice instances from a fixed pool.
// Handles allocation, release, and lookup of voices for multi-touch support.

import { Voice } from '../audio/Voice.js';

/** Default maximum simultaneous voices.
 *  14 accommodates crossfade overlap at loop boundaries
 *  (two iterations of up to ~7 voices can coexist briefly). */
const MAX_VOICES = 14;

export class VoiceAllocator {
    /**
     * @param {AudioContext} audioContext
     * @param {AudioNode} destination - Where all voices connect (master gain bus)
     * @param {number} [maxVoices=6]
     */
    constructor(audioContext, destination, maxVoices = MAX_VOICES) {
        this.audioContext = audioContext;
        this.maxVoices = maxVoices;

        /** @type {Voice[]} */
        this.voices = [];
        for (let i = 0; i < maxVoices; i++) {
            this.voices.push(new Voice(i, audioContext, destination));
        }

        /** Maps pointerId → Voice */
        this._pointerMap = new Map();

        /** Grain event callback, forwarded from all voices */
        this.onGrain = null;

        for (const voice of this.voices) {
            voice.onGrain = (info) => {
                if (this.onGrain) this.onGrain(info);
            };
        }
    }

    /** Number of currently active (playing) voices. */
    get activeCount() {
        let n = 0;
        for (const v of this.voices) {
            if (v.active) n++;
        }
        return n;
    }

    /**
     * Allocate a voice for the given pointer ID.
     * @param {number} pointerId
     * @returns {Voice|null} The allocated voice, or null if all are busy.
     */
    allocate(pointerId) {
        // Don't double-allocate
        if (this._pointerMap.has(pointerId)) {
            return this._pointerMap.get(pointerId);
        }

        // Find the first inactive voice
        for (const voice of this.voices) {
            if (!voice.active) {
                this._pointerMap.set(pointerId, voice);
                return voice;
            }
        }

        return null; // all busy
    }

    /**
     * Get the voice currently mapped to a pointer.
     * @param {number} pointerId
     * @returns {Voice|null}
     */
    getVoice(pointerId) {
        return this._pointerMap.get(pointerId) || null;
    }

    /**
     * Release the voice mapped to a pointer.
     * @param {number} pointerId
     */
    release(pointerId) {
        const voice = this._pointerMap.get(pointerId);
        if (voice) {
            voice.stop();
            this._pointerMap.delete(pointerId);
        }
    }

    /**
     * Stop all voices and clear all pointer mappings.
     */
    releaseAll() {
        for (const voice of this.voices) {
            voice.stop();
        }
        this._pointerMap.clear();
    }

    /**
     * Set the audio buffer on all voices.
     * @param {AudioBuffer} buffer
     */
    setBuffer(buffer) {
        for (const voice of this.voices) {
            voice.setBuffer(buffer);
        }
    }

    /**
     * Set gain level on all voices (for anti-clipping scaling).
     * @param {number} value
     */
    setGainLevel(value) {
        for (const voice of this.voices) {
            voice.setGainLevel(value);
        }
    }

    /**
     * Clean up all voices.
     */
    dispose() {
        this.releaseAll();
        for (const voice of this.voices) {
            voice.dispose();
        }
    }
}
