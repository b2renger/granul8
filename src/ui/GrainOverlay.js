// GrainOverlay.js — Visualizes individual grains as fading rectangles on the waveform canvas.
// Maintains a ring buffer of recent grain events and draws them each frame.

import { getVoiceColor } from './voiceColors.js';

/** Maximum number of grains stored (ring buffer capacity) */
const MAX_GRAINS = 100;

/** How long a grain visual stays fully visible (seconds) */
const VISIBLE_DURATION = 0.15;

/** How long it takes to fade out after the visible period (seconds) */
const FADE_DURATION = 0.35;

/** Total lifespan before a grain visual is discarded */
const TOTAL_LIFESPAN = VISIBLE_DURATION + FADE_DURATION;

export class GrainOverlay {
    constructor() {
        /** Ring buffer of grain events */
        this._grains = [];

        /** Write index for ring buffer */
        this._writeIndex = 0;
    }

    /**
     * Record a grain event. Call this from the engine's onGrain callback.
     * @param {{voiceId: number, position: number, duration: number, amplitude: number, pitch: number, when: number}} info
     */
    addGrain(info) {
        if (this._grains.length < MAX_GRAINS) {
            this._grains.push(info);
        } else {
            this._grains[this._writeIndex] = info;
        }
        this._writeIndex = (this._writeIndex + 1) % MAX_GRAINS;
    }

    /**
     * Draw grain visuals onto the canvas.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} canvasWidth
     * @param {number} canvasHeight
     * @param {number} currentTime - audioContext.currentTime
     */
    draw(ctx, canvasWidth, canvasHeight, currentTime) {
        for (let i = 0; i < this._grains.length; i++) {
            const g = this._grains[i];
            const age = currentTime - g.when;

            // Skip grains that haven't started yet or have fully faded
            if (age < 0 || age > TOTAL_LIFESPAN) continue;

            // Compute opacity: full during visible phase, then linear fade
            let opacity;
            if (age <= VISIBLE_DURATION) {
                opacity = 1;
            } else {
                opacity = 1 - (age - VISIBLE_DURATION) / FADE_DURATION;
            }

            // Scale opacity by grain amplitude for visual loudness feedback
            opacity *= g.amplitude * 0.7;

            if (opacity <= 0) continue;

            // X position and width based on grain position and duration in the buffer
            const x = g.position * canvasWidth;
            // Width represents grain duration relative to the full buffer
            // Use a minimum width so short grains are still visible
            const w = Math.max(3, g.duration * canvasWidth * 0.1);

            // Y position based on pitch (log2 scale):
            // pitch=1.0 (unity) → center, +2oct (4×) → top, −2oct (0.25×) → bottom
            const pitchLog = g.pitch ? Math.log2(g.pitch) : 0; // semitone-ish
            const pitchNorm = pitchLog / 4; // ±2 oct → ±0.5
            const yCenter = canvasHeight / 2 - pitchNorm * canvasHeight;
            const grainH = canvasHeight * 0.28;

            // Color by voice
            const color = getVoiceColor(g.voiceId);

            // Draw grain rectangle (centered on pitch-derived Y)
            ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${opacity * 0.3})`;
            ctx.fillRect(x - w / 2, yCenter - grainH / 2, w, grainH);

            // Draw a brighter core stripe at the center
            const coreW = Math.max(2, w * 0.3);
            const coreH = grainH * 0.4;
            ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${opacity * 0.6})`;
            ctx.fillRect(x - coreW / 2, yCenter - coreH / 2, coreW, coreH);
        }
    }
}
