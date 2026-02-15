// GranularEngine.js — Top-level: AudioContext, master bus, limiter, voice pool

import { Voice } from './Voice.js';

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

        // --- Voice (single for now — Phase 2 adds pool of 6) ---
        this._voice = new Voice(0, this.audioContext, this.masterGain);

        /** Number of currently active voices (for gain scaling) */
        this._activeVoiceCount = 0;

        // Grain event callback (forwarded from voice, for visualization)
        /** @type {((info: {voiceId: number, position: number, duration: number, amplitude: number, when: number}) => void)|null} */
        this.onGrain = null;

        this._voice.onGrain = (info) => {
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
        const baseLevel = 0.4;
        const scale = this._activeVoiceCount > 0
            ? baseLevel / Math.sqrt(this._activeVoiceCount)
            : 0;
        this._voice.setGainLevel(scale);
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
        // Stop any active voice before replacing the buffer
        this.stopVoice();

        const buffer = await this.audioContext.decodeAudioData(arrayBuffer);
        this.sourceBuffer = buffer;
        this._voice.setBuffer(buffer);

        return buffer;
    }

    /**
     * Start the voice with given parameters.
     * @param {Object} params - { position, amplitude, grainSize, interOnset, pitch, spread, pan, envelope }
     */
    startVoice(params) {
        if (!this.sourceBuffer) return;
        this._activeVoiceCount++;
        this._updateVoiceGains();
        this._voice.start(params);
    }

    /**
     * Update the active voice parameters.
     * @param {Object} params - Partial params to merge
     */
    updateVoice(params) {
        if (!this._voice.active) return;
        this._voice.update(params);
    }

    /**
     * Stop the active voice.
     */
    stopVoice() {
        if (this._voice.active) {
            this._activeVoiceCount = Math.max(0, this._activeVoiceCount - 1);
            this._updateVoiceGains();
        }
        this._voice.stop();
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
        this._voice.dispose();
        this.audioContext.close();
    }
}
