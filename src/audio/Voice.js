// Voice.js — One independent grain stream with its own gain/pan

import { GrainScheduler } from './GrainScheduler.js';
import { createGrain } from './grainFactory.js';

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
            this.scheduler.setInterOnset(params.interOnset * 1000);
        }
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
     * @param {number} when - audioContext.currentTime to start
     */
    _onScheduleGrain(when) {
        if (!this.buffer || !this.active) return;

        createGrain(
            this.audioContext,
            this.buffer,
            {
                position: this.params.position,
                amplitude: this.params.amplitude,
                duration: this.params.grainSize,
                interOnset: this.params.interOnset,
                pitch: this.params.pitch,
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
