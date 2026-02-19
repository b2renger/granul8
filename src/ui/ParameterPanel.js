// ParameterPanel.js — Reads grain parameter range sliders, gesture mapping selects,
// and single-value controls. All range parameters are normalized 0–1.

import { ADSRWidget } from './ADSRWidget.js';
import { expMap } from '../utils/math.js';
import { normalizedToSubdivision, getSubdivisionSeconds } from '../utils/musicalQuantizer.js';

/**
 * @typedef {Object} GrainParams
 * @property {number} grainSizeMin  - Normalized 0–1
 * @property {number} grainSizeMax  - Normalized 0–1
 * @property {number} densityMin    - Normalized 0–1
 * @property {number} densityMax    - Normalized 0–1
 * @property {number} spreadMin     - Normalized 0–1
 * @property {number} spreadMax     - Normalized 0–1
 * @property {number} pan           - Stereo pan (-1 to 1)
 * @property {string} envelope      - Window function name
 * @property {Object} mappings      - Gesture → parameter target mappings
 */

/** Range parameter descriptors (min/max sliders, normalized 0–1). */
const RANGE_PARAMS = [
    {
        name: 'grainSize',
        minId: 'param-grain-size-min', minValId: 'val-grain-size-min',
        maxId: 'param-grain-size-max', maxValId: 'val-grain-size-max',
        display: n => `${Math.round(expMap(n, 1, 1000))} ms`,
    },
    {
        name: 'density',
        minId: 'param-density-min', minValId: 'val-density-min',
        maxId: 'param-density-max', maxValId: 'val-density-max',
        display: n => `${Math.round(expMap(n, 5, 500))} ms`,
    },
    {
        name: 'spread',
        minId: 'param-spread-min', minValId: 'val-spread-min',
        maxId: 'param-spread-max', maxValId: 'val-spread-max',
        display: n => parseFloat(n).toFixed(2),
    },
];

/** Simple slider descriptors (unchanged from before). */
const SIMPLE_SLIDERS = [
    { id: 'param-pan',    valId: 'val-pan',    format: v => parseFloat(v).toFixed(2) },
    { id: 'param-volume', valId: 'val-volume', format: v => parseFloat(v).toFixed(2) },
];

/** Gesture mapping select element IDs and their keys. */
const MAPPING_IDS   = ['map-pressure', 'map-contact-size', 'map-velocity'];
const MAPPING_KEYS  = ['pressure',     'contactSize',      'velocity'];

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

        // --- Range parameters (min/max pairs, normalized 0–1) ---
        this._ranges = {};
        for (const rp of RANGE_PARAMS) {
            const minSlider  = document.getElementById(rp.minId);
            const minDisplay = document.getElementById(rp.minValId);
            const maxSlider  = document.getElementById(rp.maxId);
            const maxDisplay = document.getElementById(rp.maxValId);

            this._ranges[rp.name] = { minSlider, minDisplay, maxSlider, maxDisplay, display: rp.display };

            // Constrain: min ≤ max
            minSlider.addEventListener('input', () => {
                if (parseFloat(minSlider.value) > parseFloat(maxSlider.value)) {
                    maxSlider.value = minSlider.value;
                }
                this._updateRangeDisplay(rp.name);
                this.callbacks.onChange(this.getParams());
            });

            maxSlider.addEventListener('input', () => {
                if (parseFloat(maxSlider.value) < parseFloat(minSlider.value)) {
                    minSlider.value = maxSlider.value;
                }
                this._updateRangeDisplay(rp.name);
                this.callbacks.onChange(this.getParams());
            });
        }

        // --- Simple sliders (pan, volume) ---
        this._sliders = {};
        for (const { id, valId, format } of SIMPLE_SLIDERS) {
            const slider  = document.getElementById(id);
            const display = document.getElementById(valId);
            this._sliders[id] = { slider, display, format };

            slider.addEventListener('input', () => {
                display.textContent = format(slider.value);
                this._handleChange(id);
            });
        }

        // --- Envelope select ---
        this._envelopeSelect = document.getElementById('param-envelope');
        this._adsrCanvas     = document.getElementById('adsr-canvas');
        /** @type {ADSRWidget|null} */
        this._adsrWidget = null;

        this._envelopeSelect.addEventListener('change', () => {
            this._updateADSRVisibility();
            this.callbacks.onChange(this.getParams());
        });

        // Initialize ADSR widget if custom envelope is the default
        this._updateADSRVisibility();

        // --- Gesture mapping selects ---
        this._mappingSelects = {};
        for (let i = 0; i < MAPPING_IDS.length; i++) {
            const select = document.getElementById(MAPPING_IDS[i]);
            this._mappingSelects[MAPPING_KEYS[i]] = select;
            select.addEventListener('change', () => {
                this.callbacks.onChange(this.getParams());
            });
        }

        // --- Gesture indicators (visual feedback on range sliders) ---
        this._indicators = {};
        for (const rp of RANGE_PARAMS) {
            this._indicators[rp.name] = panelEl.querySelector(
                `.gesture-indicator[data-param="${rp.name}"]`
            );
        }

        // --- Randomization range bars (pulsing highlight between min/max) ---
        this._randomBars = {};
        for (const name of ['grainSize', 'density']) {
            this._randomBars[name] = panelEl.querySelector(
                `.random-range-bar[data-param="${name}"]`
            );
        }

        // --- Musical section (BPM, root note, scale, quantize toggles) ---
        this._bpmSlider = document.getElementById('param-bpm');
        this._bpmDisplay = document.getElementById('val-bpm');
        this._tapTempoBtn = document.getElementById('tap-tempo');
        this._rootNoteSelect = document.getElementById('param-root-note');
        this._scaleSelect = document.getElementById('param-scale');
        this._quantizeGrainSize = document.getElementById('quantize-grain-size');
        this._quantizeDensity = document.getElementById('quantize-density');
        this._quantizePitch = document.getElementById('quantize-pitch');

        this._bpmSlider.addEventListener('input', () => {
            this._bpmDisplay.textContent = this._bpmSlider.value;
            this._refreshGrainSizeDisplay();
            this._refreshDensityDisplay();
            this.callbacks.onChange(this.getParams());
        });

        this._rootNoteSelect.addEventListener('change', () => {
            this.callbacks.onChange(this.getParams());
        });

        this._scaleSelect.addEventListener('change', () => {
            this.callbacks.onChange(this.getParams());
        });

        this._quantizeGrainSize.addEventListener('change', () => {
            this._refreshGrainSizeDisplay();
            this.callbacks.onChange(this.getParams());
        });

        this._quantizeDensity.addEventListener('change', () => {
            this._refreshDensityDisplay();
            this.callbacks.onChange(this.getParams());
        });

        this._quantizePitch.addEventListener('change', () => {
            this.callbacks.onChange(this.getParams());
        });

        // --- Randomize toggles ---
        this._randomGrainSize = document.getElementById('random-grain-size');
        this._randomDensity = document.getElementById('random-density');
        this._randomPitch = document.getElementById('random-pitch');

        for (const el of [this._randomGrainSize, this._randomDensity, this._randomPitch]) {
            el.addEventListener('change', () => {
                this._updateArpVisibility();
                this.callbacks.onChange(this.getParams());
            });
        }

        // --- Arp pattern select (visible when randomize pitch is active) ---
        this._arpPatternGroup = document.getElementById('arp-pattern-group');
        this._arpPatternSelect = document.getElementById('param-arp-pattern');
        this._arpPatternSelect.addEventListener('change', () => {
            this.callbacks.onChange(this.getParams());
        });

        // --- Pitch range slider (visible when randomize pitch is active) ---
        this._pitchRangeGroup = document.getElementById('pitch-range-group');
        this._pitchRangeSlider = document.getElementById('param-pitch-range');
        this._pitchRangeDisplay = document.getElementById('val-pitch-range');
        this._pitchRangeSlider.addEventListener('input', () => {
            this._pitchRangeDisplay.textContent = `\u00B1${this._pitchRangeSlider.value} oct`;
            this.callbacks.onChange(this.getParams());
        });

        // --- DOM references for param-relevance dimming ---
        // Min range rows (dimmed when no randomization or gesture targets the param)
        this._grainSizeMinRow = this._ranges.grainSize.minSlider.closest('.range-row');
        this._densityMinRow   = this._ranges.density.minSlider.closest('.range-row');
        this._spreadMinRow    = this._ranges.spread.minSlider.closest('.range-row');
        // Param groups for musical controls
        this._bpmGroup      = this._bpmSlider.closest('.param-group');
        this._rootNoteGroup = this._rootNoteSelect.closest('.param-group');
        this._scaleGroup    = this._scaleSelect.closest('.param-group');

        // --- Tap tempo ---
        this._tapTimes = [];
        this._tapTempoBtn.addEventListener('click', () => {
            const now = performance.now();
            // Reset if too slow (> 2s since last tap)
            if (this._tapTimes.length > 0 && now - this._tapTimes[this._tapTimes.length - 1] > 2000) {
                this._tapTimes = [];
            }
            this._tapTimes.push(now);
            // Keep only the last 4 taps
            if (this._tapTimes.length > 4) this._tapTimes.shift();
            if (this._tapTimes.length >= 2) {
                // Average interval between taps
                let sum = 0;
                for (let i = 1; i < this._tapTimes.length; i++) {
                    sum += this._tapTimes[i] - this._tapTimes[i - 1];
                }
                const avgMs = sum / (this._tapTimes.length - 1);
                const bpm = Math.round(60000 / avgMs);
                const clamped = Math.max(40, Math.min(300, bpm));
                this._bpmSlider.value = clamped;
                this._bpmDisplay.textContent = clamped;
                this._refreshGrainSizeDisplay();
                this._refreshDensityDisplay();
                this.callbacks.onChange(this.getParams());
            }
        });
    }

    /** Show/hide arp pattern + pitch range controls based on randomize pitch toggle. */
    _updateArpVisibility() {
        const show = this._randomPitch.checked;
        if (this._arpPatternGroup) {
            this._arpPatternGroup.style.display = show ? '' : 'none';
        }
        if (this._pitchRangeGroup) {
            this._pitchRangeGroup.style.display = show ? '' : 'none';
        }
    }

    /** Show/hide the ADSR canvas editor based on envelope selection. */
    _updateADSRVisibility() {
        const isCustom = this._envelopeSelect.value === 'custom';
        this._adsrCanvas.classList.toggle('adsr-hidden', !isCustom);

        if (isCustom && !this._adsrWidget) {
            this._adsrWidget = new ADSRWidget(this._adsrCanvas, {
                onChange: () => this.callbacks.onChange(this.getParams()),
            });
        }
    }

    /**
     * Read current grain parameters from all controls.
     * Range values are normalized 0–1 (conversion to engine units is external).
     * @returns {GrainParams}
     */
    getParams() {
        return {
            grainSizeMin: parseFloat(this._ranges.grainSize.minSlider.value),
            grainSizeMax: parseFloat(this._ranges.grainSize.maxSlider.value),
            densityMin:   parseFloat(this._ranges.density.minSlider.value),
            densityMax:   parseFloat(this._ranges.density.maxSlider.value),
            spreadMin:    parseFloat(this._ranges.spread.minSlider.value),
            spreadMax:    parseFloat(this._ranges.spread.maxSlider.value),
            pan:          parseFloat(this._sliders['param-pan'].slider.value),
            envelope:     this._envelopeSelect.value,
            mappings: {
                pressure:    this._mappingSelects.pressure.value,
                contactSize: this._mappingSelects.contactSize.value,
                velocity:    this._mappingSelects.velocity.value,
            },
        };
    }

    /**
     * Read current musical quantization settings.
     * @returns {{ bpm: number, rootNote: number, scale: string, quantizeDensity: boolean, quantizePitch: boolean }}
     */
    getMusicalParams() {
        return {
            bpm: parseInt(this._bpmSlider.value, 10),
            rootNote: parseInt(this._rootNoteSelect.value, 10),
            scale: this._scaleSelect.value,
            quantizeGrainSize: this._quantizeGrainSize.checked,
            quantizeDensity: this._quantizeDensity.checked,
            quantizePitch: this._quantizePitch.checked,
            randomGrainSize: this._randomGrainSize.checked,
            randomDensity: this._randomDensity.checked,
            randomPitch: this._randomPitch.checked,
            arpPattern: this._arpPatternSelect.value,
            pitchRange: parseInt(this._pitchRangeSlider.value, 10),
        };
    }

    /**
     * Return a complete state snapshot of all panel controls.
     * Used by InstanceManager to save state before switching tabs.
     * @returns {Object}
     */
    getFullState() {
        const p = this.getParams();
        const m = this.getMusicalParams();
        const adsr = this._adsrWidget ? this._adsrWidget.getState() : { a: 0.2, d: 0.15, s: 0.7, r: 0.2 };
        return {
            ...p,
            ...m,
            volume: parseFloat(this._sliders['param-volume'].slider.value),
            adsr,
        };
    }

    /**
     * Restore all panel controls from a state snapshot.
     * Does NOT fire onChange/onVolumeChange callbacks — the caller handles side effects.
     * @param {Object} state
     */
    setFullState(state) {
        // --- Range sliders ---
        this._ranges.grainSize.minSlider.value = state.grainSizeMin;
        this._ranges.grainSize.maxSlider.value = state.grainSizeMax;
        this._ranges.density.minSlider.value = state.densityMin;
        this._ranges.density.maxSlider.value = state.densityMax;
        this._ranges.spread.minSlider.value = state.spreadMin;
        this._ranges.spread.maxSlider.value = state.spreadMax;

        // --- Simple sliders ---
        this._sliders['param-pan'].slider.value = state.pan;
        this._sliders['param-pan'].display.textContent = parseFloat(state.pan).toFixed(2);
        this._sliders['param-volume'].slider.value = state.volume;
        this._sliders['param-volume'].display.textContent = parseFloat(state.volume).toFixed(2);

        // --- Envelope ---
        this._envelopeSelect.value = state.envelope;

        // --- Musical params ---
        this._bpmSlider.value = state.bpm;
        this._bpmDisplay.textContent = state.bpm;
        this._rootNoteSelect.value = state.rootNote;
        this._scaleSelect.value = state.scale;

        // --- Quantize toggles ---
        this._quantizeGrainSize.checked = state.quantizeGrainSize;
        this._quantizeDensity.checked = state.quantizeDensity;
        this._quantizePitch.checked = state.quantizePitch;

        // --- Randomize toggles ---
        this._randomGrainSize.checked = state.randomGrainSize;
        this._randomDensity.checked = state.randomDensity;
        this._randomPitch.checked = state.randomPitch;

        // --- Arp + pitch range ---
        this._arpPatternSelect.value = state.arpPattern;
        this._pitchRangeSlider.value = state.pitchRange;
        this._pitchRangeDisplay.textContent = `\u00B1${state.pitchRange} oct`;

        // --- Gesture mappings ---
        if (state.mappings) {
            this._mappingSelects.pressure.value = state.mappings.pressure;
            this._mappingSelects.contactSize.value = state.mappings.contactSize;
            this._mappingSelects.velocity.value = state.mappings.velocity;
        }

        // --- Update visibility states (must happen before ADSR restore
        //     so the widget is created if switching to custom envelope) ---
        this._updateADSRVisibility();
        this._updateArpVisibility();

        // --- ADSR widget ---
        if (state.adsr && this._adsrWidget) {
            this._adsrWidget.setState(state.adsr);
        }

        // --- Refresh all display labels ---
        this._updateRangeDisplay('grainSize');
        this._updateRangeDisplay('density');
        this._updateRangeDisplay('spread');
    }

    /**
     * Update display labels for a range parameter.
     * Density uses subdivision labels when quantized.
     * @param {string} name - Range parameter name
     * @private
     */
    _updateRangeDisplay(name) {
        if (name === 'grainSize' && this._quantizeGrainSize && this._quantizeGrainSize.checked) {
            this._refreshGrainSizeDisplay();
        } else if (name === 'density' && this._quantizeDensity && this._quantizeDensity.checked) {
            this._refreshDensityDisplay();
        } else {
            const r = this._ranges[name];
            r.minDisplay.textContent = r.display(r.minSlider.value);
            r.maxDisplay.textContent = r.display(r.maxSlider.value);
        }
    }

    /**
     * Refresh density slider display labels to show either ms or subdivision.
     * @private
     */
    _refreshDensityDisplay() {
        const r = this._ranges.density;
        if (this._quantizeDensity.checked) {
            const bpm = parseInt(this._bpmSlider.value, 10);
            const minSub = normalizedToSubdivision(1 - parseFloat(r.minSlider.value));
            const maxSub = normalizedToSubdivision(1 - parseFloat(r.maxSlider.value));
            const minMs = Math.round(getSubdivisionSeconds(bpm, minSub.divisor) * 1000);
            const maxMs = Math.round(getSubdivisionSeconds(bpm, maxSub.divisor) * 1000);
            r.minDisplay.textContent = `${minSub.label} (${minMs}ms)`;
            r.maxDisplay.textContent = `${maxSub.label} (${maxMs}ms)`;
        } else {
            r.minDisplay.textContent = r.display(r.minSlider.value);
            r.maxDisplay.textContent = r.display(r.maxSlider.value);
        }
    }

    /**
     * Refresh grain size slider display labels to show either ms or subdivision.
     * @private
     */
    _refreshGrainSizeDisplay() {
        const r = this._ranges.grainSize;
        if (this._quantizeGrainSize.checked) {
            const bpm = parseInt(this._bpmSlider.value, 10);
            const minSub = normalizedToSubdivision(1 - parseFloat(r.minSlider.value));
            const maxSub = normalizedToSubdivision(1 - parseFloat(r.maxSlider.value));
            const minMs = Math.round(getSubdivisionSeconds(bpm, minSub.divisor) * 1000);
            const maxMs = Math.round(getSubdivisionSeconds(bpm, maxSub.divisor) * 1000);
            r.minDisplay.textContent = `${minSub.label} (${minMs}ms)`;
            r.maxDisplay.textContent = `${maxSub.label} (${maxMs}ms)`;
        } else {
            r.minDisplay.textContent = r.display(r.minSlider.value);
            r.maxDisplay.textContent = r.display(r.maxSlider.value);
        }
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

    /**
     * Update gesture indicator positions on range sliders.
     * @param {Object} resolvedNormals - e.g. { grainSize: 0.65, density: 0.4 }
     *        Only keys with active gesture mappings are present.
     */
    updateGestureIndicators(resolvedNormals) {
        for (const rp of RANGE_PARAMS) {
            const indicator = this._indicators[rp.name];
            if (!indicator) continue;

            const normValue = resolvedNormals[rp.name];
            if (normValue === undefined) {
                indicator.style.opacity = '0';
                continue;
            }

            // Position relative to the slider track within the range-group
            const slider = this._ranges[rp.name].minSlider;
            const thumbHalf = 7; // half of 14px thumb
            const trackStart = slider.offsetLeft + thumbHalf;
            const trackWidth = slider.offsetWidth - thumbHalf * 2;
            const leftPx = trackStart + trackWidth * normValue;

            // Span both range-rows vertically
            const minRow = slider.closest('.range-row');
            const maxSlider = this._ranges[rp.name].maxSlider;
            const maxRow = maxSlider.closest('.range-row');
            const top = minRow.offsetTop;
            const bottom = maxRow.offsetTop + maxRow.offsetHeight;

            indicator.style.left = `${leftPx}px`;
            indicator.style.top = `${top}px`;
            indicator.style.height = `${bottom - top}px`;
            indicator.style.opacity = '0.8';
        }
    }

    /**
     * Update randomization range bar positions and visibility.
     * Shows a pulsing bar between min/max slider positions when randomization is active.
     * @param {object} musicalParams - From getMusicalParams()
     */
    updateRandomIndicators(musicalParams) {
        const flags = {
            grainSize: musicalParams.randomGrainSize,
            density: musicalParams.randomDensity,
        };

        for (const name of ['grainSize', 'density']) {
            const bar = this._randomBars[name];
            if (!bar) continue;

            if (!flags[name]) {
                bar.classList.remove('active');
                continue;
            }

            bar.classList.add('active');

            // Position the bar between min and max thumb positions on the slider track
            const r = this._ranges[name];
            const slider = r.minSlider;
            const thumbHalf = 7; // half of 14px thumb
            const trackStart = slider.offsetLeft + thumbHalf;
            const trackWidth = slider.offsetWidth - thumbHalf * 2;

            const minVal = parseFloat(r.minSlider.value);
            const maxVal = parseFloat(r.maxSlider.value);

            const leftPx = trackStart + trackWidth * minVal;
            const rightPx = trackStart + trackWidth * maxVal;
            const barWidth = Math.max(4, rightPx - leftPx);

            // Vertically center between the two range rows
            const minRow = slider.closest('.range-row');
            const maxRow = r.maxSlider.closest('.range-row');
            const topPx = minRow.offsetTop + minRow.offsetHeight;

            bar.style.left = `${leftPx}px`;
            bar.style.width = `${barWidth}px`;
            bar.style.top = `${topPx - 3}px`;
        }
    }

    /**
     * Evaluate which controls are relevant given the current mode and toggle
     * CSS dimming classes accordingly. Call from the render loop or on change.
     */
    updateParamRelevance() {
        const m = this.getMusicalParams();
        const mappings = this.getParams().mappings;

        /** True if any gesture dimension is mapped to the given target. */
        const hasMapping = (target) =>
            Object.values(mappings).some(t => t === target);

        // --- Min range rows: active when randomized OR gesture-mapped ---
        const gsMinActive  = m.randomGrainSize || hasMapping('grainSize');
        const denMinActive = m.randomDensity   || hasMapping('density');
        const sprMinActive = hasMapping('spread');

        this._grainSizeMinRow.classList.toggle('range-row-inactive', !gsMinActive);
        this._densityMinRow.classList.toggle('range-row-inactive', !denMinActive);
        this._spreadMinRow.classList.toggle('range-row-inactive', !sprMinActive);

        // --- BPM + Tap Tempo: active when any quantize toggle is checked ---
        const bpmActive = m.quantizeGrainSize || m.quantizeDensity || m.quantizePitch;
        this._bpmGroup.classList.toggle('param-inactive', !bpmActive);

        // --- Root Note & Scale: active when quantize pitch, or arp pattern ≠ random ---
        const arpPattern = m.arpPattern || 'random';
        const noteActive = m.quantizePitch
            || (m.randomPitch && arpPattern !== 'random');
        this._rootNoteGroup.classList.toggle('param-inactive', !noteActive);
        this._scaleGroup.classList.toggle('param-inactive', !noteActive);
    }

    /** Notify canvas sub-widgets of a theme change. */
    onThemeChange() {
        if (this._adsrWidget) this._adsrWidget.onThemeChange();
    }

    /** Hide all gesture indicators (e.g. when no pointers are active). */
    hideGestureIndicators() {
        for (const name in this._indicators) {
            if (this._indicators[name]) {
                this._indicators[name].style.opacity = '0';
            }
        }
    }
}
