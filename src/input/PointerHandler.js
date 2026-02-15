// PointerHandler.js — Maps pointer events on the waveform canvas to voice control
// Single-pointer for Phase 1. Phase 2 extends this to multi-touch via VoiceAllocator.

import { clamp } from '../utils/math.js';

export class PointerHandler {
    /**
     * @param {HTMLCanvasElement} canvas - The waveform canvas element
     * @param {object} callbacks
     * @param {(params: {position: number, amplitude: number}) => void} callbacks.onStart
     * @param {(params: {position: number, amplitude: number}) => void} callbacks.onMove
     * @param {() => void} callbacks.onStop
     */
    constructor(canvas, callbacks) {
        this.canvas = canvas;
        this.callbacks = callbacks;

        /** Whether a pointer is currently active */
        this.active = false;

        /** Current normalized pointer position (0–1, left to right) */
        this.position = 0;

        /** Current normalized amplitude (0–1, top to bottom) */
        this.amplitude = 0;

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
        this.canvas.setPointerCapture(e.pointerId);
        this.active = true;

        const { position, amplitude } = this._normalizePointer(e);
        this.position = position;
        this.amplitude = amplitude;

        this.callbacks.onStart({ position, amplitude });
    }

    /** @param {PointerEvent} e */
    _onPointerMove(e) {
        if (!this.active) return;

        const { position, amplitude } = this._normalizePointer(e);
        this.position = position;
        this.amplitude = amplitude;

        this.callbacks.onMove({ position, amplitude });
    }

    /** @param {PointerEvent} e */
    _onPointerUp(e) {
        if (!this.active) return;
        this.active = false;
        this.callbacks.onStop();
    }

    /**
     * Draw pointer indicator on the canvas context.
     * Call this from the render loop after the waveform is drawn.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} canvasWidth
     * @param {number} canvasHeight
     */
    drawIndicator(ctx, canvasWidth, canvasHeight) {
        if (!this.active) return;

        const x = this.position * canvasWidth;
        const y = this.amplitude * canvasHeight;
        const radius = 14 * devicePixelRatio;

        // Vertical position line
        ctx.strokeStyle = 'rgba(0, 200, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasHeight);
        ctx.stroke();

        // Outer glow circle
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 200, 255, 0.1)';
        ctx.fill();

        // Main circle
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 200, 255, 0.25)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 200, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Center dot
        ctx.beginPath();
        ctx.arc(x, y, 3 * devicePixelRatio, 0, Math.PI * 2);
        ctx.fillStyle = '#00c8ff';
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
