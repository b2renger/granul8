// MasterBus.js — Shared AudioContext and master output chain.
// All engine instances connect their output to masterBus.masterGain.

import { MasterClock } from './MasterClock.js';
import { Metronome } from './Metronome.js';

export class MasterBus {
    constructor() {
        /** @type {AudioContext} */
        this.audioContext = new AudioContext();

        // --- Master output chain ---
        // instanceGains → masterGain → limiter → softClipper → analyser → destination

        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 0.7;

        // Anti-clipping: Brickwall limiter (DynamicsCompressor)
        this.limiter = this.audioContext.createDynamicsCompressor();
        this.limiter.threshold.setValueAtTime(-3, this.audioContext.currentTime);
        this.limiter.knee.setValueAtTime(0, this.audioContext.currentTime);
        this.limiter.ratio.setValueAtTime(20, this.audioContext.currentTime);
        this.limiter.attack.setValueAtTime(0.001, this.audioContext.currentTime);
        this.limiter.release.setValueAtTime(0.05, this.audioContext.currentTime);

        // Anti-clipping: Soft clipper (tanh waveshaper)
        this.softClipper = this._createSoftClipper();

        // Analyser for level meter visualization
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;

        // Connect chain
        this.masterGain.connect(this.limiter);
        this.limiter.connect(this.softClipper);
        this.softClipper.connect(this.analyser);
        this.analyser.connect(this.audioContext.destination);

        // Master clock for loop station timing
        this.clock = new MasterClock(this.audioContext);

        // Metronome with dedicated gain (separate volume/mute)
        this.metronome = new Metronome(this.audioContext, this.clock, this.masterGain);
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
     * @returns {WaveShaperNode}
     * @private
     */
    _createSoftClipper() {
        const shaper = this.audioContext.createWaveShaper();
        const numSamples = 8192;
        const curve = new Float32Array(numSamples);

        for (let i = 0; i < numSamples; i++) {
            const x = (2 * i / (numSamples - 1)) - 1;
            curve[i] = Math.tanh(x);
        }

        shaper.curve = curve;
        shaper.oversample = '2x';
        return shaper;
    }

    /**
     * Clean up all resources.
     */
    dispose() {
        this.audioContext.close();
    }
}
