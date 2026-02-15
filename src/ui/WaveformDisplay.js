// WaveformDisplay.js — Canvas waveform renderer (cached offscreen)

export class WaveformDisplay {
    /**
     * @param {HTMLCanvasElement} canvas - The visible canvas element
     */
    constructor(canvas) {
        /** @type {HTMLCanvasElement} */
        this.canvas = canvas;

        /** @type {CanvasRenderingContext2D} */
        this.ctx = canvas.getContext('2d');

        /** @type {AudioBuffer|null} */
        this.buffer = null;

        // Offscreen cache canvas for the static waveform image
        /** @type {HTMLCanvasElement} */
        this.cacheCanvas = document.createElement('canvas');

        /** @type {CanvasRenderingContext2D} */
        this.cacheCtx = this.cacheCanvas.getContext('2d');

        // Pre-computed min/max waveform data (one pair per pixel column)
        /** @type {Float32Array|null} */
        this.waveformMin = null;

        /** @type {Float32Array|null} */
        this.waveformMax = null;

        // Style
        this.waveformColor = 'rgba(0, 200, 255, 0.6)';
        this.waveformFillColor = 'rgba(0, 200, 255, 0.15)';
        this.centerLineColor = '#333344';
        this.backgroundColor = '#1a1a24';
    }

    /**
     * Set a new AudioBuffer and recompute the waveform.
     * @param {AudioBuffer} buffer
     */
    setBuffer(buffer) {
        this.buffer = buffer;
        this._computeWaveform();
        this._renderCache();
    }

    /**
     * Call when the canvas is resized — recompute and re-render the cache.
     */
    resize() {
        if (this.buffer && this.canvas.width > 0 && this.canvas.height > 0) {
            this._computeWaveform();
            this._renderCache();
        }
    }

    /**
     * Draw the cached waveform onto the main canvas.
     * Called every frame from the render loop.
     */
    draw() {
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Always clear before drawing to prevent stale content
        this.ctx.clearRect(0, 0, w, h);

        if (!this.buffer) {
            this._drawEmpty();
            return;
        }

        // Blit the cached waveform image (stretch to fill if size differs)
        this.ctx.drawImage(this.cacheCanvas, 0, 0, w, h);
    }

    // --- Private methods ---

    /**
     * Downsample the AudioBuffer to min/max pairs, one per pixel column.
     * Mixes all channels to mono for display.
     */
    _computeWaveform() {
        const width = this.canvas.width;
        if (width === 0 || !this.buffer) return;

        const numChannels = this.buffer.numberOfChannels;
        const length = this.buffer.length;
        const samplesPerPixel = length / width;

        this.waveformMin = new Float32Array(width);
        this.waveformMax = new Float32Array(width);

        // Get channel data (mix to mono by averaging)
        const channels = [];
        for (let ch = 0; ch < numChannels; ch++) {
            channels.push(this.buffer.getChannelData(ch));
        }

        for (let px = 0; px < width; px++) {
            const startSample = Math.floor(px * samplesPerPixel);
            const endSample = Math.min(Math.floor((px + 1) * samplesPerPixel), length);

            let min = 1.0;
            let max = -1.0;

            for (let i = startSample; i < endSample; i++) {
                // Average across channels
                let sample = 0;
                for (let ch = 0; ch < numChannels; ch++) {
                    sample += channels[ch][i];
                }
                sample /= numChannels;

                if (sample < min) min = sample;
                if (sample > max) max = sample;
            }

            this.waveformMin[px] = min;
            this.waveformMax[px] = max;
        }
    }

    /**
     * Render the waveform to the offscreen cache canvas.
     */
    _renderCache() {
        const w = this.canvas.width;
        const h = this.canvas.height;

        this.cacheCanvas.width = w;
        this.cacheCanvas.height = h;

        const ctx = this.cacheCtx;
        const centerY = h / 2;

        // Background
        ctx.fillStyle = this.backgroundColor;
        ctx.fillRect(0, 0, w, h);

        // Center line
        ctx.strokeStyle = this.centerLineColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(w, centerY);
        ctx.stroke();

        if (!this.waveformMin || !this.waveformMax) return;

        // Filled waveform area
        ctx.fillStyle = this.waveformFillColor;
        ctx.beginPath();
        // Top edge (max values) left to right
        for (let px = 0; px < w; px++) {
            const y = centerY - this.waveformMax[px] * centerY;
            if (px === 0) ctx.moveTo(px, y);
            else ctx.lineTo(px, y);
        }
        // Bottom edge (min values) right to left
        for (let px = w - 1; px >= 0; px--) {
            const y = centerY - this.waveformMin[px] * centerY;
            ctx.lineTo(px, y);
        }
        ctx.closePath();
        ctx.fill();

        // Waveform outline (top and bottom strokes)
        ctx.strokeStyle = this.waveformColor;
        ctx.lineWidth = 1;

        // Top edge (max)
        ctx.beginPath();
        for (let px = 0; px < w; px++) {
            const y = centerY - this.waveformMax[px] * centerY;
            if (px === 0) ctx.moveTo(px, y);
            else ctx.lineTo(px, y);
        }
        ctx.stroke();

        // Bottom edge (min)
        ctx.beginPath();
        for (let px = 0; px < w; px++) {
            const y = centerY - this.waveformMin[px] * centerY;
            if (px === 0) ctx.moveTo(px, y);
            else ctx.lineTo(px, y);
        }
        ctx.stroke();
    }

    /**
     * Draw an empty state when no buffer is loaded.
     */
    _drawEmpty() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const ctx = this.ctx;

        ctx.fillStyle = this.backgroundColor;
        ctx.fillRect(0, 0, w, h);

        // Center line
        ctx.strokeStyle = this.centerLineColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // Hint text
        ctx.fillStyle = '#555566';
        ctx.font = `${14 * devicePixelRatio}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Drop an audio file here or click "Load Sample"', w / 2, h / 2);
    }
}
