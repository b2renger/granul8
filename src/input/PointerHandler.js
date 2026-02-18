// PointerHandler.js — Maps pointer events on the waveform canvas to voice control.
// Supports multiple simultaneous pointers (multi-touch) with per-voice colors.
// Extracts extended gesture dimensions: pressure, contact size, velocity.

import { clamp, lerp } from '../utils/math.js';
import { getVoiceColor } from '../ui/voiceColors.js';

/** Maximum tracked pointers (matches VoiceAllocator pool size). */
const MAX_POINTERS = 10;

/** Fade-out duration in seconds after pointer release. */
const FADE_OUT_DURATION = 0.3;

/** Speed (in normalized canvas-units/sec) that maps to velocity = 1. */
const VELOCITY_MAX = 3;

/** Exponential moving average factor for velocity smoothing (0–1, higher = less smooth). */
const VELOCITY_SMOOTH = 0.3;

/** CSS pixels of contact size that maps to contactSize = 1. */
const CONTACT_SIZE_MAX = 50;

export class PointerHandler {
    /**
     * @param {HTMLCanvasElement} canvas - The waveform canvas element
     * @param {object} callbacks
     * @param {(params: {pointerId: number, position: number, amplitude: number, pressure: number, contactSize: number, velocity: number}) => number|undefined} callbacks.onStart
     *        Should return the voiceId (slot index) allocated, or undefined if none.
     * @param {(params: {pointerId: number, position: number, amplitude: number, pressure: number, contactSize: number, velocity: number}) => void} callbacks.onMove
     * @param {(params: {pointerId: number}) => void} callbacks.onStop
     */
    constructor(canvas, callbacks) {
        this.canvas = canvas;
        this.callbacks = callbacks;

        /**
         * Active pointers: pointerId → { position, amplitude, pressure, contactSize, velocity, voiceId }
         * @type {Map<number, {position: number, amplitude: number, pressure: number, contactSize: number, velocity: number, voiceId: number, _lastTime: number}>}
         */
        this.pointers = new Map();

        /**
         * Recently released pointers, fading out.
         * @type {Array<{position: number, amplitude: number, voiceId: number, releasedAt: number}>}
         */
        this._fading = [];

        /**
         * Device capability detection — set to true once we observe real values.
         * Pressure: mouse always reports 0.5, pen/touch report variable values.
         * ContactSize: mouse reports width=1/height=1, touch reports real area.
         */
        this.capabilities = {
            pressure: false,
            contactSize: false,
            velocity: true, // always available (computed)
        };

        /**
         * Latest raw gesture values (for live feedback display).
         * Updated on every pointer event, even when no voice is active.
         */
        this.liveGesture = {
            pressure: 0,
            contactSize: 0,
            velocity: 0,
        };

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
     * Compute normalized X/Y and extract gesture dimensions from a pointer event.
     * X → position (0–1), Y → amplitude (0–1, top=0 bottom=1).
     * Pressure: 0–1 (0.5 default for mouse/trackpad).
     * Contact size: max(width, height) normalized to 0–1.
     * @param {PointerEvent} e
     * @returns {{position: number, amplitude: number, pressure: number, contactSize: number}}
     */
    _normalizePointer(e) {
        const rect = this.canvas.getBoundingClientRect();
        const position = clamp((e.clientX - rect.left) / rect.width, 0, 1);
        const amplitude = clamp((e.clientY - rect.top) / rect.height, 0, 1);
        const pressure = clamp(e.pressure, 0, 1);
        const contactSize = clamp(
            Math.max(e.width || 0, e.height || 0) / CONTACT_SIZE_MAX,
            0, 1
        );

        // Detect real device capabilities:
        // Pressure: mouse/trackpad always reports exactly 0.5 (or 0 when not pressed).
        // Real pressure devices (stylus, touch) report variable values.
        if (!this.capabilities.pressure && e.pressure > 0 && e.pressure !== 0.5) {
            this.capabilities.pressure = true;
        }
        // Contact size: mouse reports width=1, height=1 (or 0).
        // Real touch reports actual contact area > 1.
        if (!this.capabilities.contactSize) {
            const rawSize = Math.max(e.width || 0, e.height || 0);
            if (rawSize > 1) {
                this.capabilities.contactSize = true;
            }
        }

        return { position, amplitude, pressure, contactSize };
    }

    /** @param {PointerEvent} e */
    _onPointerDown(e) {
        e.preventDefault();

        // Ignore if we've hit the max
        if (this.pointers.size >= MAX_POINTERS) return;

        this.canvas.setPointerCapture(e.pointerId);

        const { position, amplitude, pressure, contactSize } = this._normalizePointer(e);

        // onStart returns the allocated voiceId (or undefined if allocation failed)
        const voiceId = this.callbacks.onStart({
            pointerId: e.pointerId,
            position, amplitude,
            pressure, contactSize,
            velocity: 0,
        });

        // Update live gesture feedback (always, even if allocation fails)
        this.liveGesture.pressure = pressure;
        this.liveGesture.contactSize = contactSize;
        this.liveGesture.velocity = 0;

        if (voiceId != null) {
            this.pointers.set(e.pointerId, {
                position, amplitude,
                pressure, contactSize,
                velocity: 0,
                voiceId,
                _lastTime: e.timeStamp,
            });
        }
    }

    /** @param {PointerEvent} e */
    _onPointerMove(e) {
        const entry = this.pointers.get(e.pointerId);
        if (!entry) return;
        e.preventDefault();

        const { position, amplitude, pressure, contactSize } = this._normalizePointer(e);

        // Compute velocity from position delta between frames
        const dt = Math.max(e.timeStamp - entry._lastTime, 1) / 1000;
        const dx = position - entry.position;
        const dy = amplitude - entry.amplitude;
        const speed = Math.sqrt(dx * dx + dy * dy) / dt;
        const rawVelocity = clamp(speed / VELOCITY_MAX, 0, 1);
        const velocity = lerp(entry.velocity, rawVelocity, VELOCITY_SMOOTH);

        // Update stored state
        entry.position = position;
        entry.amplitude = amplitude;
        entry.pressure = pressure;
        entry.contactSize = contactSize;
        entry.velocity = velocity;
        entry._lastTime = e.timeStamp;

        // Update live gesture feedback
        this.liveGesture.pressure = pressure;
        this.liveGesture.contactSize = contactSize;
        this.liveGesture.velocity = velocity;

        this.callbacks.onMove({
            pointerId: e.pointerId,
            position, amplitude,
            pressure, contactSize,
            velocity,
        });
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
