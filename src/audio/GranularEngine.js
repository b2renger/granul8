// GranularEngine.js — Per-instance audio subgraph: voice pool + instance gain.
// Connects to an external destination (typically MasterBus.masterGain).

import { VoiceAllocator } from '../input/VoiceAllocator.js';

export class GranularEngine {
    /**
     * @param {AudioContext} audioContext - Shared AudioContext from MasterBus
     * @param {AudioNode} destination - Where to connect instanceGain (e.g. masterBus.masterGain)
     */
    constructor(audioContext, destination) {
        /** @type {AudioContext} */
        this.audioContext = audioContext;

        /** @type {AudioBuffer|null} */
        this.sourceBuffer = null;

        // Per-instance gain node (volume + anti-clip scaling)
        this.instanceGain = audioContext.createGain();
        this.instanceGain.gain.value = 1.0;
        this.instanceGain.connect(destination);

        // Voice pool (10 voices, mapped by pointer ID)
        this._allocator = new VoiceAllocator(audioContext, this.instanceGain);

        // Grain event callback (forwarded from all voices, for visualization)
        /** @type {((info: {voiceId: number, position: number, duration: number, amplitude: number, when: number}) => void)|null} */
        this.onGrain = null;

        this._allocator.onGrain = (info) => {
            if (this.onGrain) this.onGrain(info);
        };
    }

    /**
     * Anti-clipping Layer 2: recalculate per-voice gain based on active voice count.
     * Each voice gets 1/sqrt(N) to compensate for RMS summing of uncorrelated voices.
     * @private
     */
    _updateVoiceGains() {
        const count = this._allocator.activeCount;
        const baseLevel = 0.4;
        const scale = count > 0 ? baseLevel / Math.sqrt(count) : 0;
        this._allocator.setGainLevel(scale);
    }

    /**
     * Load a sample from a URL.
     * @param {string} url
     * @returns {Promise<AudioBuffer>}
     */
    async loadSample(url) {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        return this._decodeAndStore(arrayBuffer);
    }

    /**
     * Load a sample from a File object (drag-and-drop or file picker).
     * @param {File} file
     * @returns {Promise<AudioBuffer>}
     */
    async loadSampleFromFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        return this._decodeAndStore(arrayBuffer);
    }

    /**
     * Decode an ArrayBuffer into an AudioBuffer and store it.
     * @param {ArrayBuffer} arrayBuffer
     * @returns {Promise<AudioBuffer>}
     */
    async _decodeAndStore(arrayBuffer) {
        this._allocator.releaseAll();
        const buffer = await this.audioContext.decodeAudioData(arrayBuffer);
        this.sourceBuffer = buffer;
        this._allocator.setBuffer(buffer);
        return buffer;
    }

    /**
     * Start a voice for the given pointer ID.
     * @param {number} pointerId
     * @param {Object} params
     * @returns {number|undefined} The voice slot id, or undefined if allocation failed.
     */
    startVoice(pointerId, params) {
        if (!this.sourceBuffer) return undefined;
        const voice = this._allocator.allocate(pointerId);
        if (!voice) return undefined;
        voice.start(params);
        this._updateVoiceGains();
        return voice.id;
    }

    /**
     * Update the voice mapped to the given pointer ID.
     * @param {number} pointerId
     * @param {Object} params
     */
    updateVoice(pointerId, params) {
        const voice = this._allocator.getVoice(pointerId);
        if (voice && voice.active) {
            voice.update(params);
        }
    }

    /**
     * Update all active voices.
     * @param {Object} params
     */
    updateAllVoices(params) {
        for (const voice of this._allocator.voices) {
            if (voice.active) voice.update(params);
        }
    }

    /**
     * Stop the voice mapped to the given pointer ID.
     * @param {number} pointerId
     */
    stopVoice(pointerId) {
        this._allocator.release(pointerId);
        this._updateVoiceGains();
    }

    /**
     * Stop all active voices.
     */
    stopAllVoices() {
        this._allocator.releaseAll();
        this._updateVoiceGains();
    }

    /**
     * Clean up: disconnect instance gain, dispose allocator.
     */
    dispose() {
        this._allocator.dispose();
        this.instanceGain.disconnect();
    }
}
