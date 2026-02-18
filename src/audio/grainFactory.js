// grainFactory.js — Creates a single grain (BufferSource + GainNode envelope)
// Each grain is ephemeral: fire-and-forget nodes that self-destruct after playback.

import { getEnvelope } from './envelopes.js';

/**
 * @typedef {Object} GrainParams
 * @property {number} position    - 0–1 normalized position in the buffer
 * @property {number} amplitude   - 0–1 peak grain amplitude
 * @property {number} duration    - grain duration in seconds
 * @property {number} pitch       - playback rate (0.25–4.0)
 * @property {number} pan         - stereo pan (-1 to 1)
 * @property {number} spread      - random offset added to position (0–1)
 * @property {number} interOnset  - inter-onset time in seconds (for overlap scaling)
 * @property {'hann'|'tukey'|'triangle'} envelope - window function type
 */

/** Number of samples in the envelope curve */
const ENVELOPE_LENGTH = 128;

/**
 * Create and schedule a single grain. Nodes are connected, started, and
 * left to be garbage-collected after playback — no cleanup required.
 *
 * Anti-clipping Layer 1: each grain's amplitude is scaled by 1/sqrt(overlap),
 * where overlap = grainDuration / interOnset. This compensates for the RMS
 * addition of uncorrelated overlapping grains.
 *
 * @param {AudioContext} audioContext
 * @param {AudioBuffer} buffer - The source audio buffer
 * @param {GrainParams} params
 * @param {AudioNode} destination - Where to connect (typically the Voice gainNode)
 * @param {number} when - audioContext.currentTime to start the grain
 * @param {Function} [onGrain] - Optional callback for visualization: ({position, duration, amplitude, when})
 */
export function createGrain(audioContext, buffer, params, destination, when, onGrain) {
    const {
        position,
        amplitude,
        duration,
        pitch,
        pan,
        spread,
        envelope
    } = params;

    // Compute actual buffer offset with random spread
    const spreadOffset = spread > 0 ? (Math.random() - 0.5) * spread : 0;
    const normalizedPos = Math.max(0, Math.min(1, position + spreadOffset));
    const offset = normalizedPos * buffer.duration;

    // Clamp duration so we don't read past the buffer end
    const maxDuration = buffer.duration - offset;
    if (maxDuration <= 0) return;
    const grainDuration = Math.min(duration, maxDuration);

    // Bail on extremely short grains (< 1ms) — they'd just be clicks
    if (grainDuration < 0.001) return;

    // --- Anti-clipping Layer 1: per-grain amplitude scaling ---
    // Estimate how many grains overlap at any moment: overlap = duration / interOnset
    // Scale amplitude by 1/sqrt(overlap) to compensate for RMS summing.
    const interOnset = params.interOnset || grainDuration; // fallback: no overlap
    const overlap = Math.max(1, grainDuration / interOnset);
    const overlapScale = 1 / Math.sqrt(overlap);
    const scaledAmplitude = amplitude * overlapScale;

    // --- Create nodes ---

    // Source
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = pitch;

    // Envelope gain
    const gainNode = audioContext.createGain();

    // Build the amplitude-scaled envelope curve
    const baseCurve = getEnvelope(envelope, ENVELOPE_LENGTH);
    const scaledCurve = new Float32Array(ENVELOPE_LENGTH);
    for (let i = 0; i < ENVELOPE_LENGTH; i++) {
        scaledCurve[i] = baseCurve[i] * scaledAmplitude;
    }

    // Apply envelope: start silent, ramp through curve, end silent
    gainNode.gain.setValueAtTime(0, when);
    gainNode.gain.setValueCurveAtTime(scaledCurve, when, grainDuration);

    // --- Connect chain: source → gain → (pan) → destination ---

    source.connect(gainNode);

    if (pan !== 0) {
        const panNode = audioContext.createStereoPanner();
        // Add random pan variation based on spread
        const panVariation = spread > 0 ? (Math.random() - 0.5) * spread * 0.5 : 0;
        panNode.pan.setValueAtTime(
            Math.max(-1, Math.min(1, pan + panVariation)),
            when
        );
        gainNode.connect(panNode);
        panNode.connect(destination);
    } else {
        gainNode.connect(destination);
    }

    // --- Schedule playback ---

    source.start(when, offset, grainDuration);
    source.stop(when + grainDuration);

    // --- Notify visualizer ---

    if (onGrain) {
        onGrain({
            position: normalizedPos,
            duration: grainDuration,
            amplitude,
            pitch,
            when
        });
    }
}
