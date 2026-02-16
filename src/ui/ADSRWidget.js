// ADSRWidget.js — Interactive canvas ADSR envelope editor.
// Draws a 5-point polyline with 3 draggable control points (A, D/S, R).

import { clamp } from '../utils/math.js';
import { setCustomADSR, getCustomADSR } from '../audio/envelopes.js';

/** Hit-test radius in CSS pixels (generous for touch). */
const HIT_RADIUS = 14;

/** Visual point radius in CSS pixels. */
const POINT_RADIUS = 5;

export class ADSRWidget {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {{ onChange?: () => void }} [callbacks]
     */
    constructor(canvas, callbacks = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.callbacks = callbacks;

        const init = getCustomADSR();
        this.a = init.a;
        this.d = init.d;
        this.s = init.s;
        this.r = init.r;

        /** @type {'A'|'D'|'R'|null} */
        this._dragPoint = null;

        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp   = this._onPointerUp.bind(this);

        canvas.addEventListener('pointerdown', this._onPointerDown);
        canvas.addEventListener('pointermove', this._onPointerMove);
        canvas.addEventListener('pointerup',   this._onPointerUp);
        canvas.addEventListener('pointercancel', this._onPointerUp);

        this._resizeObserver = new ResizeObserver(() => this.resize());
        this._resizeObserver.observe(canvas);

        this.resize();
    }

    /** Sync canvas buffer size with CSS size (HiDPI-aware), then redraw. */
    resize() {
        const dpr = devicePixelRatio;
        this.canvas.width  = this.canvas.clientWidth  * dpr;
        this.canvas.height = this.canvas.clientHeight * dpr;
        this._draw();
    }

    // --- Pointer events ---

    /** @param {PointerEvent} e */
    _onPointerDown(e) {
        const { x, y } = this._cssCoords(e);
        this._dragPoint = this._hitTest(x, y);
        if (this._dragPoint) {
            this.canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
        }
    }

    /** @param {PointerEvent} e */
    _onPointerMove(e) {
        if (!this._dragPoint) return;
        e.preventDefault();
        const { x, y } = this._cssCoords(e);
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;

        switch (this._dragPoint) {
            case 'A':
                this.a = clamp(x / w, 0.01, 0.5);
                break;
            case 'D': {
                const rawD = clamp(x / w - this.a, 0.01, 0.5);
                this.d = rawD;
                this.s = clamp(1 - y / h, 0, 1);
                break;
            }
            case 'R':
                this.r = clamp(1 - x / w, 0.01, 0.5);
                break;
        }

        this._sync();
    }

    /** @param {PointerEvent} e */
    _onPointerUp(e) {
        if (this._dragPoint) {
            this.canvas.releasePointerCapture(e.pointerId);
            this._dragPoint = null;
        }
    }

    // --- Coordinate helpers ---

    /** Convert pointer event to CSS-pixel coordinates relative to the canvas. */
    _cssCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    /**
     * Return the 5 polyline points in CSS-pixel coordinates.
     * P0=start, P1=attack peak, P2=decay/sustain, P3=release start, P4=end.
     */
    _getPoints() {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        const pad = 2; // tiny inset so lines aren't clipped at edges
        const top = pad;
        const bot = h - pad;
        const range = bot - top;

        return [
            { x: 0,                     y: bot },                        // P0: start
            { x: this.a * w,            y: top },                        // P1: attack peak
            { x: (this.a + this.d) * w, y: bot - this.s * range },       // P2: decay → sustain
            { x: (1 - this.r) * w,      y: bot - this.s * range },       // P3: release start
            { x: w,                      y: bot },                        // P4: end
        ];
    }

    /**
     * Hit-test draggable points (P1=A, P2=D, P3=R).
     * @returns {'A'|'D'|'R'|null}
     */
    _hitTest(cx, cy) {
        const pts = this._getPoints();
        const draggable = [
            { key: 'A', pt: pts[1] },
            { key: 'D', pt: pts[2] },
            { key: 'R', pt: pts[3] },
        ];
        for (const { key, pt } of draggable) {
            const dx = cx - pt.x;
            const dy = cy - pt.y;
            if (dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS) return key;
        }
        return null;
    }

    // --- Sync & draw ---

    _sync() {
        setCustomADSR(this.a, this.d, this.s, this.r);
        this._draw();
        if (this.callbacks.onChange) this.callbacks.onChange();
    }

    _draw() {
        const ctx = this.ctx;
        const dpr = devicePixelRatio;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        ctx.clearRect(0, 0, cw, ch);

        // Background
        ctx.fillStyle = '#22222e';
        ctx.fillRect(0, 0, cw, ch);

        const pts = this._getPoints();

        // Scale CSS points to canvas pixels
        const scaled = pts.map(p => ({ x: p.x * dpr, y: p.y * dpr }));

        // Filled area under polyline
        ctx.beginPath();
        ctx.moveTo(scaled[0].x, scaled[0].y);
        for (let i = 1; i < scaled.length; i++) {
            ctx.lineTo(scaled[i].x, scaled[i].y);
        }
        ctx.lineTo(cw, ch);
        ctx.lineTo(0, ch);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0, 200, 255, 0.1)';
        ctx.fill();

        // Polyline stroke
        ctx.beginPath();
        ctx.moveTo(scaled[0].x, scaled[0].y);
        for (let i = 1; i < scaled.length; i++) {
            ctx.lineTo(scaled[i].x, scaled[i].y);
        }
        ctx.strokeStyle = '#00c8ff';
        ctx.lineWidth = 2 * dpr;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Draggable control points (P1, P2, P3)
        const labels = ['A', 'D', 'R'];
        for (let i = 0; i < 3; i++) {
            const p = scaled[i + 1];
            const r = POINT_RADIUS * dpr;

            // Outer circle
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fillStyle = '#00c8ff';
            ctx.fill();

            // Inner dot
            ctx.beginPath();
            ctx.arc(p.x, p.y, r * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = '#111117';
            ctx.fill();

            // Label
            ctx.font = `${10 * dpr}px -apple-system, BlinkMacSystemFont, sans-serif`;
            ctx.fillStyle = '#888899';
            ctx.textAlign = 'center';
            ctx.fillText(labels[i], p.x, p.y - r - 3 * dpr);
        }

        // Sustain level label
        const sP = scaled[2];
        ctx.font = `${9 * dpr}px monospace`;
        ctx.fillStyle = '#888899';
        ctx.textAlign = 'left';
        ctx.fillText(`S:${this.s.toFixed(2)}`, sP.x + 8 * dpr, sP.y - 2 * dpr);
    }

    dispose() {
        this._resizeObserver.disconnect();
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
        this.canvas.removeEventListener('pointermove', this._onPointerMove);
        this.canvas.removeEventListener('pointerup',   this._onPointerUp);
        this.canvas.removeEventListener('pointercancel', this._onPointerUp);
    }
}
