// LevelMeter.js — Horizontal RMS level meter driven by an AnalyserNode.
// Uses a simple div-width approach (no canvas) for the transport bar.

export class LevelMeter {
    /**
     * @param {HTMLElement} container - The #level-meter element
     * @param {AnalyserNode} analyser
     */
    constructor(container, analyser) {
        this.analyser = analyser;
        this.fill = container.querySelector('.level-meter-fill');

        // Reuse a single buffer across frames (no GC pressure)
        this._data = new Uint8Array(analyser.fftSize);

        this._smoothed = 0;
    }

    /** Call once per animation frame. */
    update() {
        this.analyser.getByteTimeDomainData(this._data);

        // Compute RMS from time-domain bytes (128 = silence)
        let sum = 0;
        for (let i = 0; i < this._data.length; i++) {
            const s = (this._data[i] - 128) / 128;
            sum += s * s;
        }
        const rms = Math.sqrt(sum / this._data.length);

        // Map to 0–1 via dB scale (-60 dB → 0, 0 dB → 1)
        const db = 20 * Math.log10(Math.max(rms, 1e-6));
        const level = Math.max(0, Math.min(1, (db + 60) / 60));

        // Asymmetric smoothing: fast attack, slow release
        const k = level > this._smoothed ? 0.8 : 0.05;
        this._smoothed += (level - this._smoothed) * k;

        // Update fill width
        this.fill.style.width = `${this._smoothed * 100}%`;

        // Color: sage → amber → warm red (uses CSS variables for theme support)
        if (this._smoothed > 0.9) {
            this.fill.style.background = 'var(--accent-warm)';
        } else if (this._smoothed > 0.7) {
            this.fill.style.background = 'var(--accent)';
        } else {
            this.fill.style.background = 'var(--play-green)';
        }
    }
}
