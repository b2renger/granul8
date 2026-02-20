// GhostRenderer.js — Draws ghost pointer indicators and overlays during automation playback.
// Ghost pointers mirror the visual style of live pointers (PointerHandler._drawPointer)
// but with dashed outlines and reduced opacity to distinguish playback from live input.

import { getVoiceColor } from './voiceColors.js';

/** How long a ghost pointer lingers after its voice stops (seconds) */
const FADE_OUT_DURATION = 0.4;

export class GhostRenderer {
    constructor() {
        /** Active ghost pointers: syntheticId → { position, amplitude, voiceIndex } */
        this._pointers = new Map();

        /** Fading ghost pointers after voice stop */
        this._fading = [];

        /** Whether ghost rendering is active (playback in progress) */
        this.active = false;

        /** Playback progress (0–1) for timeline cursor */
        this.progress = 0;

        /** Whether recording is active (for red tint) */
        this.recording = false;
    }

    /**
     * Feed a Player dispatch event to track ghost pointer positions.
     * @param {'start'|'move'|'stop'} type
     * @param {number} syntheticId
     * @param {Object} [params] - Voice params with position, amplitude
     */
    dispatch(type, syntheticId, params) {
        switch (type) {
            case 'start':
            case 'move':
                this._pointers.set(syntheticId, {
                    position: params.position,
                    amplitude: params.amplitude,
                    voiceIndex: params._voiceIndex ?? (syntheticId % 10),
                });
                break;
            case 'stop': {
                const p = this._pointers.get(syntheticId);
                if (p) {
                    this._fading.push({
                        ...p,
                        releasedAt: performance.now() / 1000,
                    });
                    this._pointers.delete(syntheticId);
                }
                break;
            }
        }
    }

    /** Clear all ghost pointers (call on playback stop). */
    clear() {
        this._pointers.clear();
        this._fading.length = 0;
        this.active = false;
        this.progress = 0;
    }

    /**
     * Draw ghost pointers, recording tint, and timeline cursor.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} w - Canvas width
     * @param {number} h - Canvas height
     */
    draw(ctx, w, h) {
        // --- Recording tint ---
        if (this.recording) {
            ctx.fillStyle = 'rgba(224, 60, 60, 0.06)';
            ctx.fillRect(0, 0, w, h);
        }

        // --- Ghost pointers ---
        if (this.active) {
            const now = performance.now() / 1000;

            // Active ghost pointers
            for (const [, p] of this._pointers) {
                this._drawGhost(ctx, w, h, p.position, p.amplitude, p.voiceIndex, 1.0, now);
            }

            // Fading ghost pointers
            for (let i = this._fading.length - 1; i >= 0; i--) {
                const f = this._fading[i];
                const elapsed = now - f.releasedAt;
                if (elapsed > FADE_OUT_DURATION) {
                    this._fading.splice(i, 1);
                    continue;
                }
                const alpha = 1 - elapsed / FADE_OUT_DURATION;
                this._drawGhost(ctx, w, h, f.position, f.amplitude, f.voiceIndex, alpha, now);
            }

            // --- Timeline cursor ---
            if (this.progress > 0) {
                const cx = this.progress * w;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(cx, 0);
                ctx.lineTo(cx, h);
                ctx.stroke();
            }
        }
    }

    /**
     * Draw a single ghost pointer — dashed outline, reduced opacity.
     * @private
     */
    _drawGhost(ctx, canvasWidth, canvasHeight, position, amplitude, voiceIndex, alpha, now) {
        const x = position * canvasWidth;
        const y = amplitude * canvasHeight;
        const [r, g, b] = getVoiceColor(voiceIndex);

        // Ghost opacity is reduced compared to live pointers
        const ghostAlpha = alpha * 0.4;

        // Slow pulse (half speed of live pointers)
        const pulse = 1 + 0.08 * Math.sin(now * 3 * Math.PI);
        const radius = 14 * devicePixelRatio * pulse;

        // Vertical position line (very faint)
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.12 * alpha})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasHeight);
        ctx.stroke();

        // Outer glow
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.05 * alpha})`;
        ctx.fill();

        // Main circle — dashed outline to distinguish from live
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.1 * ghostAlpha})`;
        ctx.fill();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.6 * alpha})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);

        // Center dot
        ctx.beginPath();
        ctx.arc(x, y, 2.5 * devicePixelRatio, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.7 * alpha})`;
        ctx.fill();
    }
}
