// Voice.js — One independent grain stream with its own gain/pan

import { GrainScheduler } from './GrainScheduler.js';
import { createGrain } from './grainFactory.js';
import { quantizePitch, rateToSemitones, semitonesToRate, quantizeDensity } from '../utils/musicalQuantizer.js';

export class Voice {
    /**
     * @param {number} id - Voice slot index
     * @param {AudioContext} audioContext
     * @param {AudioNode} destination - Where to connect (master gain bus)
     */
    constructor(id, audioContext, destination) {
        this.id = id;
        this.audioContext = audioContext;
        this.active = false;

        /** @type {AudioBuffer|null} */
        this.buffer = null;

        // Per-voice gain (for voice-level amplitude control and anti-clipping)
        this.gainNode = audioContext.createGain();
        this.gainNode.gain.value = 0;
        this.gainNode.connect(destination);

        // Current grain parameters
        this.params = {
            position: 0.5,
            amplitude: 0.5,
            grainSize: 0.050,   // seconds
            interOnset: 0.030,  // seconds
            pitch: 1.0,
            spread: 0.0,
            pan: 0.0,
            envelope: 'hann',
        };

        /**
         * Per-grain randomization ranges (null entries = no randomization).
         * @type {{ grainSize: [number,number]|null, pitch: [number,number]|null }}
         */
        this.randomize = { grainSize: null, pitch: null };

        /**
         * Grain size quantization config for per-grain snapping (null = disabled).
         * @type {{ bpm: number }|null}
         */
        this.grainSizeQuantize = null;

        /**
         * Pitch quantization config for per-grain snapping (null = disabled).
         * @type {{ scale: number[], rootNote: number }|null}
         */
        this.pitchQuantize = null;

        // Grain scheduler
        this.scheduler = new GrainScheduler(
            audioContext,
            (when) => this._onScheduleGrain(when)
        );

        // Grain event callback for visualization
        /** @type {((info: {voiceId: number, position: number, duration: number, amplitude: number, when: number}) => void)|null} */
        this.onGrain = null;
    }

    /**
     * Start the voice with given parameters.
     * @param {Object} params
     */
    start(params) {
        this.active = true;
        this.update(params);

        // Gain level is set externally by GranularEngine._updateVoiceGains()
        // (anti-clipping Layer 2: 1/sqrt(activeVoiceCount))

        this.scheduler.start();
    }

    /**
     * Update voice parameters. Takes effect on the next scheduled grain.
     * @param {Object} params - Partial params to merge
     */
    update(params) {
        if (params.position !== undefined)  this.params.position = params.position;
        if (params.amplitude !== undefined) this.params.amplitude = params.amplitude;
        if (params.grainSize !== undefined) this.params.grainSize = params.grainSize;
        if (params.pitch !== undefined)     this.params.pitch = params.pitch;
        if (params.spread !== undefined)    this.params.spread = params.spread;
        if (params.pan !== undefined)       this.params.pan = params.pan;
        if (params.envelope !== undefined)  this.params.envelope = params.envelope;

        if (params.interOnset !== undefined) {
            this.params.interOnset = params.interOnset;
        }

        // Density scheduling: jitter range takes priority over fixed interOnset
        if (params.interOnsetRange) {
            this.scheduler.setInterOnsetRange(
                params.interOnsetRange[0] * 1000,
                params.interOnsetRange[1] * 1000
            );
        } else if (params.interOnset !== undefined) {
            this.scheduler.setInterOnset(params.interOnset * 1000);
        }

        // Inter-onset quantization: pass BPM to scheduler for per-grain snapping
        if (params.interOnsetQuantize !== undefined) {
            this.scheduler.quantizeBpm = params.interOnsetQuantize
                ? params.interOnsetQuantize.bpm : null;
        }

        // Per-grain randomization ranges
        if (params.randomize !== undefined) this.randomize = params.randomize;
        if (params.grainSizeQuantize !== undefined) this.grainSizeQuantize = params.grainSizeQuantize;
        if (params.pitchQuantize !== undefined) this.pitchQuantize = params.pitchQuantize;
    }

    /**
     * Stop the voice — fade out and stop scheduling.
     */
    stop() {
        this.active = false;
        this.scheduler.stop();

        // Ramp gain to 0 over 30ms to avoid click on release
        this.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
        this.gainNode.gain.setValueAtTime(
            this.gainNode.gain.value,
            this.audioContext.currentTime
        );
        this.gainNode.gain.linearRampToValueAtTime(
            0,
            this.audioContext.currentTime + 0.03
        );
    }

    /**
     * Set the source AudioBuffer.
     * @param {AudioBuffer} buffer
     */
    setBuffer(buffer) {
        this.buffer = buffer;
    }

    /**
     * Set the per-voice gain level (for anti-clipping scaling).
     * @param {number} value
     */
    setGainLevel(value) {
        this.gainNode.gain.linearRampToValueAtTime(
            value,
            this.audioContext.currentTime + 0.02
        );
    }

    /**
     * Called by the scheduler for each grain to create.
     * Applies per-grain randomization before creating the grain.
     * @param {number} when - audioContext.currentTime to start
     */
    _onScheduleGrain(when) {
        if (!this.buffer || !this.active) return;

        // Start from current params
        let duration = this.params.grainSize;
        let pitch = this.params.pitch;

        // Per-grain randomization
        const rnd = this.randomize;
        if (rnd.grainSize) {
            duration = rnd.grainSize[0] + Math.random() * (rnd.grainSize[1] - rnd.grainSize[0]);
        }

        // Apply grain size quantization (snap to nearest BPM subdivision)
        if (this.grainSizeQuantize) {
            duration = quantizeDensity(duration, this.grainSizeQuantize.bpm).seconds;
        }

        if (rnd.pitch) {
            // Random pitch in log space: ±2 octaves
            pitch = Math.pow(2, rnd.pitch[0] + Math.random() * (rnd.pitch[1] - rnd.pitch[0]));
        }

        // Apply pitch quantization (snap to scale degree)
        if (this.pitchQuantize) {
            const semitones = rateToSemitones(pitch);
            const snapped = quantizePitch(semitones, this.pitchQuantize.scale, this.pitchQuantize.rootNote);
            pitch = semitonesToRate(snapped);
        }

        createGrain(
            this.audioContext,
            this.buffer,
            {
                position: this.params.position,
                amplitude: this.params.amplitude,
                duration,
                interOnset: this.params.interOnset,
                pitch,
                spread: this.params.spread,
                pan: this.params.pan,
                envelope: this.params.envelope,
            },
            this.gainNode,
            when,
            this.onGrain ? (info) => {
                this.onGrain({ voiceId: this.id, ...info });
            } : null
        );
    }

    /**
     * Clean up.
     */
    dispose() {
        this.stop();
        this.gainNode.disconnect();
    }
}
