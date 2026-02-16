// PointerHandler.js — Maps pointer events on the waveform canvas to voice control.
// Supports multiple simultaneous pointers (multi-touch) with per-voice colors.

import { clamp } from '../utils/math.js';
import { getVoiceColor } from '../ui/voiceColors.js';

/** Maximum tracked pointers (matches VoiceAllocator pool size). */
const MAX_POINTERS = 10;

/** Fade-out duration in seconds after pointer release. */
const FADE_OUT_DURATION = 0.3;

export class PointerHandler {
    /**
     * @param {HTMLCanvasElement} canvas - The waveform canvas element
     * @param {object} callbacks
     * @param {(params: {pointerId: number, position: number, amplitude: number}) => number|undefined} callbacks.onStart
     *        Should return the voiceId (slot index) allocated, or undefined if none.
     * @param {(params: {pointerId: number, position: number, amplitude: number}) => void} callbacks.onMove
     * @param {(params: {pointerId: number}) => void} callbacks.onStop
     */
    constructor(canvas, callbacks) {
        this.canvas = canvas;
        this.callbacks = callbacks;

        /**
         * Active pointers: pointerId → { position, amplitude, voiceId }
         * @type {Map<number, {position: number, amplitude: number, voiceId: number}>}
         */
        this.pointers = new Map();

        /**
         * Recently released pointers, fading out.
         * @type {Array<{position: number, amplitude: number, voiceId: number, releasedAt: number}>}
         */
        this._fading = [];

        // Bind listeners
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);

        canvas.addEventListener('pointerdown', this._onPointerDown);
        canvas.addEventListener('pointermove', this._onPointerMove);
        canvas.addEventListener('pointerup', this._onPointerUp);
        canvas.addEventListener('pointercancel', this._onPointerUp);
    }

    /**
     * Compute normalized X/Y from a pointer event.
     * X → position (0–1), Y → amplitude (0–1, top=0 bottom=1).
     * @param {PointerEvent} e
     * @returns {{position: number, amplitude: number}}
     */
    _normalizePointer(e) {
        const rect = this.canvas.getBoundingClientRect();
        const position = clamp((e.clientX - rect.left) / rect.width, 0, 1);
        const amplitude = clamp((e.clientY - rect.top) / rect.height, 0, 1);
        return { position, amplitude };
    }

    /** @param {PointerEvent} e */
    _onPointerDown(e) {
        e.preventDefault();

        // Ignore if we've hit the max
        if (this.pointers.size >= MAX_POINTERS) return;

        this.canvas.setPointerCapture(e.pointerId);

        const { position, amplitude } = this._normalizePointer(e);

        // onStart returns the allocated voiceId (or undefined if allocation failed)
        const voiceId = this.callbacks.onStart({ pointerId: e.pointerId, position, amplitude });

        if (voiceId != null) {
            this.pointers.set(e.pointerId, { position, amplitude, voiceId });
        }
    }

    /** @param {PointerEvent} e */
    _onPointerMove(e) {
        const entry = this.pointers.get(e.pointerId);
        if (!entry) return;
        e.preventDefault();

        const { position, amplitude } = this._normalizePointer(e);
        entry.position = position;
        entry.amplitude = amplitude;

        this.callbacks.onMove({ pointerId: e.pointerId, position, amplitude });
    }

    /** @param {PointerEvent} e */
    _onPointerUp(e) {
        const entry = this.pointers.get(e.pointerId);
        if (!entry) return;

        // Move to fading list for visual fade-out
        this._fading.push({
            position: entry.position,
            amplitude: entry.amplitude,
            voiceId: entry.voiceId,
            releasedAt: performance.now() / 1000,
        });

        this.pointers.delete(e.pointerId);
        this.callbacks.onStop({ pointerId: e.pointerId });
    }

    /**
     * Draw pointer indicators for all active + fading pointers.
     * Call this from the render loop after the waveform is drawn.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} canvasWidth
     * @param {number} canvasHeight
     */
    drawIndicator(ctx, canvasWidth, canvasHeight) {
        const now = performance.now() / 1000;

        // Draw active pointers
        for (const [, { position, amplitude, voiceId }] of this.pointers) {
            this._drawPointer(ctx, canvasWidth, canvasHeight, position, amplitude, voiceId, 1.0, now);
        }

        // Draw fading pointers (recently released)
        for (let i = this._fading.length - 1; i >= 0; i--) {
            const f = this._fading[i];
            const elapsed = now - f.releasedAt;
            if (elapsed > FADE_OUT_DURATION) {
                this._fading.splice(i, 1);
                continue;
            }
            const alpha = 1 - elapsed / FADE_OUT_DURATION;
            this._drawPointer(ctx, canvasWidth, canvasHeight, f.position, f.amplitude, f.voiceId, alpha, now);
        }
    }

    /**
     * Draw a single pointer indicator with voice color, pulse, and opacity.
     * @private
     */
    _drawPointer(ctx, canvasWidth, canvasHeight, position, amplitude, voiceId, alpha, now) {
        const x = position * canvasWidth;
        const y = amplitude * canvasHeight;
        const [r, g, b] = getVoiceColor(voiceId);

        // Subtle pulse: radius oscillates ±2px at ~3Hz
        const pulse = 1 + 0.12 * Math.sin(now * 6 * Math.PI);
        const radius = 14 * devicePixelRatio * pulse;

        // Vertical position line
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.3 * alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasHeight);
        ctx.stroke();

        // Outer glow circle
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.1 * alpha})`;
        ctx.fill();

        // Main circle
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.25 * alpha})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.8 * alpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Center dot
        ctx.beginPath();
        ctx.arc(x, y, 3 * devicePixelRatio, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.fill();
    }

    /**
     * Remove all event listeners.
     */
    dispose() {
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
        this.canvas.removeEventListener('pointermove', this._onPointerMove);
        this.canvas.removeEventListener('pointerup', this._onPointerUp);
        this.canvas.removeEventListener('pointercancel', this._onPointerUp);
    }
}
