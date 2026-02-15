// ParameterPanel.js — Reads grain parameter sliders and envelope select,
// dispatches onChange callback when any value changes.

/**
 * @typedef {Object} GrainParams
 * @property {number} grainSize  - Grain duration in seconds
 * @property {number} interOnset - Inter-onset time in seconds
 * @property {number} spread     - Random position offset (0–1)
 * @property {number} pan        - Stereo pan (-1 to 1)
 * @property {string} envelope   - Window function name
 */

/** Slider descriptors: DOM ids, value display formatter, and conversion to engine units */
const SLIDERS = [
    { id: 'param-grain-size', valId: 'val-grain-size', format: v => `${v} ms` },
    { id: 'param-density',    valId: 'val-density',    format: v => `${v} ms` },
    { id: 'param-spread',     valId: 'val-spread',     format: v => parseFloat(v).toFixed(2) },
    { id: 'param-pan',        valId: 'val-pan',        format: v => parseFloat(v).toFixed(2) },
    { id: 'param-volume',     valId: 'val-volume',     format: v => parseFloat(v).toFixed(2) },
];

export class ParameterPanel {
    /**
     * @param {HTMLElement} panelEl - The #parameter-panel container
     * @param {object} callbacks
     * @param {(params: GrainParams) => void} callbacks.onChange - Called when any grain param changes
     * @param {(volume: number) => void} callbacks.onVolumeChange - Called when master volume changes
     */
    constructor(panelEl, callbacks) {
        this.panelEl = panelEl;
        this.callbacks = callbacks;

        // Cache slider + display DOM references
        this._sliders = {};
        for (const { id, valId, format } of SLIDERS) {
            const slider = document.getElementById(id);
            const display = document.getElementById(valId);
            this._sliders[id] = { slider, display, format };

            slider.addEventListener('input', () => {
                display.textContent = format(slider.value);
                this._handleChange(id);
            });
        }

        // Envelope select
        this._envelopeSelect = document.getElementById('param-envelope');
        this._envelopeSelect.addEventListener('change', () => {
            this.callbacks.onChange(this.getParams());
        });
    }

    /**
     * Read current grain parameters from all sliders + envelope select.
     * @returns {GrainParams}
     */
    getParams() {
        return {
            grainSize:  parseFloat(this._sliders['param-grain-size'].slider.value) / 1000,
            interOnset: parseFloat(this._sliders['param-density'].slider.value) / 1000,
            spread:     parseFloat(this._sliders['param-spread'].slider.value),
            pan:        parseFloat(this._sliders['param-pan'].slider.value),
            envelope:   this._envelopeSelect.value,
        };
    }

    /**
     * Handle a slider input event.
     * Volume goes through a separate callback; all others fire onChange.
     * @param {string} sliderId
     * @private
     */
    _handleChange(sliderId) {
        if (sliderId === 'param-volume') {
            this.callbacks.onVolumeChange(
                parseFloat(this._sliders['param-volume'].slider.value)
            );
        }
        this.callbacks.onChange(this.getParams());
    }
}
