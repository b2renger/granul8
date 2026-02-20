// Voice.js — One independent grain stream with its own gain/pan

import { GrainScheduler } from './GrainScheduler.js';
import { createGrain } from './grainFactory.js';
import { quantizePitch, rateToSemitones, semitonesToRate, getSubdivisionSeconds } from '../utils/musicalQuantizer.js';
import { expMap } from '../utils/math.js';

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
            adsr: null,         // per-instance ADSR params {a, d, s, r} (used when envelope === 'custom')
        };

        /**
         * Per-grain randomization ranges (null entries = no randomization).
         * @type {{ grainSize: [number,number]|null, pitch: [number,number]|null, pan: [number,number]|null }}
         */
        this.randomize = { grainSize: null, pitch: null, pan: null };

        /**
         * Grain size quantization config for per-grain snapping (null = disabled).
         * @type {{ bpm: number }|null}
         */
        this.grainSizeQuantize = null;

        /**
         * Pitch quantization config for per-grain snapping (null = disabled).
         * When a noteTable is present, arpeggiator patterns are used.
         * @type {{ scale: number[], rootNote: number, pattern?: string, noteTable?: number[] }|null}
         */
        this.pitchQuantize = null;

        // Arpeggiator state (used when pitchQuantize.noteTable is present)
        /** @type {number} Current index in the note table */
        this.arpIndex = 0;
        /** @type {1|-1} Direction for up-down pattern */
        this.arpDirection = 1;

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
        this.arpIndex = 0;
        this.arpDirection = 1;
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
        if (params.adsr !== undefined)      this.params.adsr = params.adsr;

        if (params.interOnset !== undefined) {
            this.params.interOnset = params.interOnset;
        }

        // Density scheduling: jitter range (normalized 0–1) takes priority over fixed interOnset
        if (params.interOnsetRange) {
            this.scheduler.setInterOnsetRange(
                params.interOnsetRange[0],
                params.interOnsetRange[1]
            );
        } else if (params.interOnset !== undefined) {
            this.scheduler.setInterOnset(params.interOnset * 1000);
        }

        // Inter-onset quantization: pass BPM + divisor to scheduler for per-grain snapping
        if (params.interOnsetQuantize !== undefined) {
            if (params.interOnsetQuantize) {
                this.scheduler.quantizeBpm = params.interOnsetQuantize.bpm;
                this.scheduler.quantizeDivisor = params.interOnsetQuantize.divisor;
            } else {
                this.scheduler.quantizeBpm = null;
                this.scheduler.quantizeDivisor = null;
            }
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
     * Release the voice — stop scheduling new grains but let existing
     * pre-scheduled grains play out naturally through their envelopes.
     * Does NOT fade the voice gain to zero.
     * Used for crossfade overlap at loop boundaries in the Player.
     */
    release() {
        this.active = false;
        this.scheduler.stop();
        // Gain node is left at its current value.
        // Pre-scheduled grains (up to 100ms look-ahead) continue through
        // their envelopes and fade naturally. After the look-ahead window
        // expires, the voice goes silent as the last grains finish.
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

        // Per-grain grain size randomization (range is normalized 0–1)
        const rnd = this.randomize;
        if (rnd.grainSize) {
            const norm = rnd.grainSize[0] + Math.random() * (rnd.grainSize[1] - rnd.grainSize[0]);
            if (this.grainSizeQuantize) {
                // Quantized: use explicit subdivision divisor
                duration = getSubdivisionSeconds(this.grainSizeQuantize.bpm, this.grainSizeQuantize.divisor);
            } else {
                // Free: apply exponential mapping per grain
                duration = expMap(norm, 0.001, 1.0);
            }
        }

        // Per-grain pitch selection
        if (this.pitchQuantize && this.pitchQuantize.arpSequence) {
            // Permutation arpeggiator: walk arpSequence cyclically into arpNotes
            const { arpNotes, arpSequence } = this.pitchQuantize;
            const stepIdx = arpSequence[this.arpIndex % arpSequence.length];
            this.arpIndex++;
            if (stepIdx === null) return; // muted step: skip grain
            const semitones = arpNotes[stepIdx % arpNotes.length];
            pitch = semitonesToRate(semitones);
        } else if (this.pitchQuantize && this.pitchQuantize.noteTable) {
            // Random mode: pick random note from the full table
            const table = this.pitchQuantize.noteTable;
            const semitones = table[Math.floor(Math.random() * table.length)];
            pitch = semitonesToRate(semitones);
        } else {
            // No note table: original behavior
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
        }

        // Per-grain pan randomization
        let pan = this.params.pan;
        if (rnd.pan) {
            pan = rnd.pan[0] + Math.random() * (rnd.pan[1] - rnd.pan[0]);
            pan = Math.max(-1, Math.min(1, pan));
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
                pan,
                envelope: this.params.envelope,
                adsr: this.params.adsr,
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
