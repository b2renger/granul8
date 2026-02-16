// GranularEngine.js — Top-level: AudioContext, master bus, limiter, voice pool

import { VoiceAllocator } from '../input/VoiceAllocator.js';

export class GranularEngine {
    constructor() {
        /** @type {AudioContext} */
        this.audioContext = new AudioContext();

        /** @type {AudioBuffer|null} */
        this.sourceBuffer = null;

        // --- Signal chain ---
        // voices → masterGain → limiter → softClipper → analyser → destination

        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 0.7;

        // Anti-clipping Layer 3: Brickwall limiter (DynamicsCompressor)
        this.limiter = this.audioContext.createDynamicsCompressor();
        this.limiter.threshold.setValueAtTime(-3, this.audioContext.currentTime);
        this.limiter.knee.setValueAtTime(0, this.audioContext.currentTime);
        this.limiter.ratio.setValueAtTime(20, this.audioContext.currentTime);
        this.limiter.attack.setValueAtTime(0.001, this.audioContext.currentTime);
        this.limiter.release.setValueAtTime(0.05, this.audioContext.currentTime);

        // Anti-clipping Layer 4: Soft clipper (tanh waveshaper)
        // Gentle saturation that prevents harsh digital clipping artifacts.
        this.softClipper = this._createSoftClipper();

        // Analyser for visualization (level meter, FFT)
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;

        // Connect chain
        this.masterGain.connect(this.limiter);
        this.limiter.connect(this.softClipper);
        this.softClipper.connect(this.analyser);
        this.analyser.connect(this.audioContext.destination);

        // --- Voice pool (6 voices, mapped by pointer ID) ---
        this._allocator = new VoiceAllocator(this.audioContext, this.masterGain);

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
     * Conservative base level of 0.4 is applied on top.
     * @private
     */
    _updateVoiceGains() {
        const count = this._allocator.activeCount;
        const baseLevel = 0.4;
        const scale = count > 0 ? baseLevel / Math.sqrt(count) : 0;
        this._allocator.setGainLevel(scale);
    }

    /**
     * Load a sample from a URL (e.g. the bundled demo sample).
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
        // Stop all active voices before replacing the buffer
        this._allocator.releaseAll();

        const buffer = await this.audioContext.decodeAudioData(arrayBuffer);
        this.sourceBuffer = buffer;
        this._allocator.setBuffer(buffer);

        return buffer;
    }

    /**
     * Start a voice for the given pointer ID.
     * @param {number} pointerId
     * @param {Object} params - { position, amplitude, grainSize, interOnset, pitch, spread, pan, envelope }
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
     * @param {Object} params - Partial params to merge
     */
    updateVoice(pointerId, params) {
        const voice = this._allocator.getVoice(pointerId);
        if (voice && voice.active) {
            voice.update(params);
        }
    }

    /**
     * Update all active voices (e.g. when a global parameter like envelope changes).
     * @param {Object} params - Partial params to merge
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
     * Resume the AudioContext (required after user gesture on iOS/Safari).
     */
    async resume() {
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    /**
     * Set master volume (0–1).
     * @param {number} value
     */
    setMasterVolume(value) {
        this.masterGain.gain.linearRampToValueAtTime(
            value,
            this.audioContext.currentTime + 0.02
        );
    }

    /**
     * Create a WaveShaperNode with a tanh transfer curve for soft clipping.
     * This gently saturates signals that exceed ~±0.8, preventing harsh
     * digital clipping while adding minimal coloration.
     * @returns {WaveShaperNode}
     * @private
     */
    _createSoftClipper() {
        const shaper = this.audioContext.createWaveShaper();
        const numSamples = 8192;
        const curve = new Float32Array(numSamples);

        for (let i = 0; i < numSamples; i++) {
            // Map i from [0, numSamples-1] to [-1, 1]
            const x = (2 * i / (numSamples - 1)) - 1;
            // tanh provides smooth saturation: linear near 0, compresses toward ±1
            curve[i] = Math.tanh(x);
        }

        shaper.curve = curve;
        shaper.oversample = '2x'; // Reduce aliasing from the nonlinear transfer
        return shaper;
    }

    /**
     * Clean up all resources.
     */
    dispose() {
        this._allocator.dispose();
        this.audioContext.close();
    }
}
