// ParameterPanel.js — Reads grain parameter range sliders, gesture mapping selects,
// and single-value controls. All range parameters are normalized 0–1.

import { ADSRWidget } from './ADSRWidget.js';
import { expMap } from '../utils/math.js';
import {
    SUBDIVISIONS, getSubdivisionSeconds, ARP_MODES, buildArpSequence, applyPingPong,
    buildNoteTable, selectArpNotes, semitonesToNoteName, SCALES,
} from '../utils/musicalQuantizer.js';

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
        // A fraction of the whole buffer, so a percentage says what it is. Note it
        // ALSO widens pan by spread * 0.5 (grainFactory.js), which nothing on
        // screen states; the card name covers only the position half.
        display: n => `${Math.round(parseFloat(n) * 100)}% of sample`,
    },
    {
        name: 'pan',
        minId: 'param-pan-min', minValId: 'val-pan-min',
        maxId: 'param-pan-max', maxValId: 'val-pan-max',
        // "-0.40" says nothing about which side that is. Every other readout in
        // the panel carries its unit; this one carried a bare signed number.
        display: (n) => {
            const v = parseFloat(n);
            if (Math.abs(v) < 0.005) return 'centre';
            return `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'L' : 'R'}`;
        },
    },
];

/** Simple slider descriptors. */
const SIMPLE_SLIDERS = [
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
        for (const name of ['grainSize', 'density', 'pan']) {
            this._randomBars[name] = panelEl.querySelector(
                `.random-range-bar[data-param="${name}"]`
            );
        }

        // --- Musical section (root note, scale, quantize toggles) ---
        // Note: BPM slider is owned by main.js (global master tempo), not ParameterPanel.
        this._rootNoteSelect = document.getElementById('param-root-note');
        this._scaleSelect = document.getElementById('param-scale');
        this._quantizeGrainSize = document.getElementById('quantize-grain-size');
        this._quantizeDensity = document.getElementById('quantize-density');
        this._quantizePitch = document.getElementById('quantize-pitch');
        this._subdivGrainSize = document.getElementById('subdiv-grain-size');
        this._subdivDensity = document.getElementById('subdiv-density');

        this._rootNoteSelect.addEventListener('change', () => {
            this._redrawArpSvg();
            this.callbacks.onChange(this.getParams());
        });

        this._scaleSelect.addEventListener('change', () => {
            this._redrawArpSvg();
            this.callbacks.onChange(this.getParams());
        });

        this._quantizeGrainSize.addEventListener('change', () => {
            this._subdivGrainSize.disabled = !this._quantizeGrainSize.checked;
            this._refreshGrainSizeDisplay();
            this.callbacks.onChange(this.getParams());
        });

        this._quantizeDensity.addEventListener('change', () => {
            this._subdivDensity.disabled = !this._quantizeDensity.checked;
            this._refreshDensityDisplay();
            this.callbacks.onChange(this.getParams());
        });

        this._quantizePitch.addEventListener('change', () => {
            this.callbacks.onChange(this.getParams());
        });

        this._subdivGrainSize.addEventListener('change', () => {
            this._refreshGrainSizeDisplay();
            this.callbacks.onChange(this.getParams());
        });

        this._subdivDensity.addEventListener('change', () => {
            this._refreshDensityDisplay();
            this.callbacks.onChange(this.getParams());
        });

        // --- Randomize toggles ---
        this._randomGrainSize = document.getElementById('random-grain-size');
        this._randomDensity = document.getElementById('random-density');
        this._randomPitch = document.getElementById('random-pitch');
        this._randomPan = document.getElementById('random-pan');

        for (const el of [this._randomGrainSize, this._randomDensity, this._randomPitch, this._randomPan]) {
            el.addEventListener('change', () => {
                this._updateArpVisibility();
                this.callbacks.onChange(this.getParams());
            });
        }

        // --- Arp mode select (visible when randomize pitch is active) ---
        this._arpModeGroup = document.getElementById('arp-mode-group');
        this._arpPatternSelect = document.getElementById('param-arp-pattern');
        this._arpPatternSelect.addEventListener('change', () => {
            this._updateArpVisibility();
            this.callbacks.onChange(this.getParams());
        });

        // --- Arp steps slider (visible when mode is 'arpeggiator') ---
        this._arpStepsGroup = document.getElementById('arp-steps-group');
        this._arpStepsSlider = document.getElementById('param-arp-steps');
        this._arpStepsDisplay = document.getElementById('val-arp-steps');
        this._arpStepsSlider.addEventListener('input', () => {
            this._arpStepsDisplay.textContent = this._arpStepsSlider.value;
            // Reset style to 0 when steps change (permutation count changes)
            this._currentPattern = null;
            this._mutedSteps = null;
            this._updateArpStyleDisplay();
            this.callbacks.onChange(this.getParams());
        });

        // --- Arp type select (visible when mode is 'arpeggiator') ---
        this._arpTypeGroup = document.getElementById('arp-type-group');
        this._arpTypeSelect = document.getElementById('param-arp-type');
        this._arpTypeSelect.addEventListener('change', () => {
            // Drop any edit: the player just asked for a different named order,
            // so keeping their old drawing would make the select look inert.
            this._currentPattern = null;
            this._mutedSteps = null;
            this._updateArpStyleDisplay();
            this.callbacks.onChange(this.getParams());
        });

        // --- Arp style prev/next + SVG preview ---
        this._arpStyleGroup = document.getElementById('arp-style-group');
        this._arpStyleSvg = document.getElementById('arp-style-svg');
        this._arpStyleDisplay = document.getElementById('val-arp-style');
        this._currentPattern = null;  // mutable values array for editing
        this._mutedSteps = null;      // boolean array — true = step is muted
        this._dragStepIdx = null;     // which step index is being dragged
        this._dragMoved = false;      // did pointer move during drag? (for tap vs drag detection)

        // --- Loop back down ---
        this._arpPingPong = document.getElementById('arp-pingpong');
        this._arpPingPong.addEventListener('change', () => {
            this._updateArpStyleDisplay();
            this.callbacks.onChange(this.getParams());
        });

        // --- Note chance (the probability gate) ---
        this._arpChanceGroup = document.getElementById('arp-chance-group');
        this._arpChanceSlider = document.getElementById('param-arp-chance');
        this._arpChanceDisplay = document.getElementById('val-arp-chance');
        this._arpChanceSlider.addEventListener('input', () => {
            this._refreshArpChanceDisplay();
            this.callbacks.onChange(this.getParams());
        });

        // --- Reset a hand-edited shape back to the play mode's own ---
        // The prev/next buttons that used to live here stepped through every
        // permutation of N steps ("Pattern 17 of 24"), which is exhaustive but
        // unnameable. The named play modes replaced them; this is the way back
        // from an edit, which those buttons used to provide by accident.
        document.getElementById('arp-style-reset').addEventListener('click', () => {
            this._currentPattern = null;
            this._mutedSteps = null;
            this._updateArpStyleDisplay();
            this.callbacks.onChange(this.getParams());
        });

        this._refreshArpChanceDisplay();

        // --- SVG drag interaction for pattern editing ---
        this._arpStyleSvg.addEventListener('pointerdown', (e) => this._onArpSvgPointerDown(e));
        this._arpStyleSvg.addEventListener('pointermove', (e) => this._onArpSvgPointerMove(e));
        this._arpStyleSvg.addEventListener('pointerup', (e) => this._onArpSvgPointerUp(e));
        this._arpStyleSvg.addEventListener('pointercancel', (e) => this._onArpSvgPointerUp(e));

        // --- Pitch range slider (visible when randomize pitch is active) ---
        this._pitchRangeGroup = document.getElementById('pitch-range-group');
        this._pitchChain = document.getElementById('pitch-chain');
        this._pitchRangeSlider = document.getElementById('param-pitch-range');
        this._pitchRangeDisplay = document.getElementById('val-pitch-range');
        this._pitchRangeSlider.addEventListener('input', () => {
            this._pitchRangeDisplay.textContent = `\u00B1${this._pitchRangeSlider.value} oct`;
            this._redrawArpSvg();
            this.callbacks.onChange(this.getParams());
        });

        // --- DOM references for param-relevance dimming ---
        // Min range rows (dimmed when no randomization or gesture targets the param)
        this._grainSizeMinRow = this._ranges.grainSize.minSlider.closest('.range-row');
        this._densityMinRow   = this._ranges.density.minSlider.closest('.range-row');
        this._spreadMinRow    = this._ranges.spread.minSlider.closest('.range-row');
        this._panMinRow       = this._ranges.pan.minSlider.closest('.range-row');
        // Max rows cached too: updateParamRelevance runs from main.js's render
        // loop, so a closest() per parameter per frame is 240 DOM walks a second
        // in an app whose whole point is not stalling the audio thread's feeder.
        this._notes = Object.fromEntries(
            [...document.querySelectorAll('[data-note]')].map(el => [el.dataset.note, el]));
        this._maxRows = {
            grainSize: this._ranges.grainSize.maxSlider.closest('.range-row'),
            density:   this._ranges.density.maxSlider.closest('.range-row'),
            spread:    this._ranges.spread.maxSlider.closest('.range-row'),
            pan:       this._ranges.pan.maxSlider.closest('.range-row'),
        };
        // Param groups for musical controls
        this._rootNoteGroup = this._rootNoteSelect.closest('.param-group');
        this._scaleGroup    = this._scaleSelect.closest('.param-group');
    }

    /**
     * Write (or clear) the one-line reason a card's control is unavailable.
     * @param {string} key - the data-note value on the target <p>
     * @param {string|null} text - null clears and hides the line
     * @private
     */
    _setNote(key, text) {
        const el = this._notes[key];
        if (!el) return;
        if (el.textContent !== (text || '')) el.textContent = text || '';
        el.hidden = !text;
    }

    /**
     * The gate reads as a percentage. "0.35" states a number without saying what
     * it does; "35%" says how often a step sounds.
     * @private
     */
    _refreshArpChanceDisplay() {
        const pct = Math.round(parseFloat(this._arpChanceSlider.value) * 100);
        this._arpChanceDisplay.textContent = `${pct}%`;
    }

    /** Show/hide arp controls based on randomize pitch toggle and arp mode. */
    _updateArpVisibility() {
        const showPitch = this._randomPitch.checked;
        const isArpeggiator = this._arpPatternSelect.value === 'arpeggiator';
        const showArpControls = showPitch && isArpeggiator;

        // The wrapper carries the whole chain's visibility. Without this it would
        // still occupy a grid row when every child inside it is display:none —
        // an empty band of row-gap between Scale and the Sound Engine heading.
        if (this._pitchChain) this._pitchChain.hidden = !showPitch;

        this._arpModeGroup.style.display = showPitch ? '' : 'none';
        this._pitchRangeGroup.style.display = showPitch ? '' : 'none';
        this._arpStepsGroup.style.display = showArpControls ? '' : 'none';
        this._arpTypeGroup.style.display = showArpControls ? '' : 'none';
        this._arpChanceGroup.style.display = showArpControls ? '' : 'none';
        this._arpStyleGroup.style.display = showArpControls ? '' : 'none';

        // "Loop back down" is meaningless in Random: there is no order to come
        // back along, because the choice is made per grain. Hidden rather than
        // disabled — the panel's rule is that a control which cannot mean
        // anything in the current mode goes away, and one that needs a
        // prerequisite is disabled.
        const isRandom = this._arpTypeSelect.value === 'random';
        this._arpPingPong.closest('.param-modifiers').hidden = isRandom;

        if (showArpControls) {
            // If custom pattern already loaded (e.g. from setFullState), just redraw
            if (this._currentPattern && this._currentPattern.length === parseInt(this._arpStepsSlider.value, 10)) {
                this._updateArpCounter();
                this._redrawArpSvg();
            } else {
                this._updateArpStyleDisplay();
            }
        }
    }

    /**
     * Rebuild the previewed shape from the current play mode, unless the player
     * has edited it — an edit is more specific than a named ordering, so it wins
     * until Reset is pressed.
     * @private
     */
    _updateArpStyleDisplay() {
        const steps = parseInt(this._arpStepsSlider.value, 10);
        const mode = this._arpTypeSelect.value;
        const label = (ARP_MODES.find(m => m.value === mode) || ARP_MODES[0]).label;

        if (!this._currentPattern) {
            // `random` has no fixed order to draw, so preview the notes in pitch
            // order and let the label carry the fact that playback is shuffled.
            const base = buildArpSequence(steps, mode) || buildArpSequence(steps, 'up');
            this._currentPattern = this._arpPingPong.checked ? applyPingPong(base) : [...base];
            this._mutedSteps = new Array(this._currentPattern.length).fill(false);
        }

        const edited = this._isCustomPattern();
        this._arpStyleDisplay.textContent = edited ? 'Edited' : label;
        this._redrawArpSvg();
    }

    /**
     * True when the drawn shape no longer matches what the play mode would give.
     * @private
     */
    _isCustomPattern() {
        if (!this._currentPattern) return false;
        if (this._mutedSteps && this._mutedSteps.some(m => m)) return true;
        const steps = parseInt(this._arpStepsSlider.value, 10);
        const base = buildArpSequence(steps, this._arpTypeSelect.value)
            || buildArpSequence(steps, 'up');
        const expected = this._arpPingPong.checked ? applyPingPong(base) : base;
        if (expected.length !== this._currentPattern.length) return true;
        return !expected.every((v, i) => v === this._currentPattern[i]);
    }

    /** Compute the arp note names for current musical params (for Y-axis labels). */
    _computeArpNotes() {
        const scale = this._scaleSelect.value;
        const rootNote = parseInt(this._rootNoteSelect.value, 10);
        const pitchRange = parseInt(this._pitchRangeSlider.value, 10);
        const steps = parseInt(this._arpStepsSlider.value, 10);
        const scaleIntervals = SCALES[scale] || SCALES.chromatic;
        const range = pitchRange * 12;
        const fullTable = buildNoteTable(scaleIntervals, rootNote, -range, range);
        return selectArpNotes(fullTable, steps);
    }

    /** SVG layout constants. */
    static _SVG = { w: 100, h: 50, labelX: 16, plotL: 20, plotR: 96, padY: 7 };

    /** Render the SVG: grid lines, Y-axis labels, polyline, draggable circles. */
    _redrawArpSvg() {
        const pattern = this._currentPattern;
        if (!pattern) return;

        const svg = this._arpStyleSvg;
        const steps = pattern.length;
        const maxVal = steps - 1;
        const { h, labelX, plotL, plotR, padY } = ParameterPanel._SVG;
        const plotH = h - 2 * padY;

        // Compute actual note names for labels
        const arpNotes = this._computeArpNotes();

        // Y position for a given step value (0=bottom, maxVal=top)
        const yOf = (val) => padY + (1 - val / maxVal) * plotH;

        let content = '';

        // Horizontal grid lines + Y-axis labels
        for (let v = 0; v <= maxVal; v++) {
            const y = yOf(v);
            content += `<line x1="${plotL}" y1="${y.toFixed(1)}" x2="${plotR}" y2="${y.toFixed(1)}" class="arp-grid-line"/>`;
            const label = v < arpNotes.length ? semitonesToNoteName(arpNotes[v]) : v;
            content += `<text x="${labelX}" y="${(y + 1.5).toFixed(1)}" text-anchor="end" class="arp-label">${label}</text>`;
        }

        // Polyline connecting all points (breaks at muted steps with dashed style)
        const pts = pattern.map((val, i) => ({
            x: plotL + (i / (steps - 1)) * (plotR - plotL),
            y: yOf(val),
        }));

        // Build segments: solid between active, dashed to/from muted
        let segments = '';
        for (let i = 0; i < steps - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            const muted = this._mutedSteps[i] || this._mutedSteps[i + 1];
            if (muted) {
                segments += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="var(--text-secondary)" stroke-width="1" stroke-dasharray="3 2" opacity="0.4"/>`;
            } else {
                segments += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>`;
            }
        }
        content += segments;

        // Circles for each step
        for (let i = 0; i < steps; i++) {
            const p = pts[i];
            const isMuted = this._mutedSteps[i];
            const isDragging = i === this._dragStepIdx;
            let cls = isMuted ? 'arp-point-muted' : (isDragging ? 'arp-point dragging' : 'arp-point');
            content += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" class="${cls}"/>`;
        }

        svg.innerHTML = content;
    }

    /** Convert a pointer event to SVG viewBox coordinates. */
    _svgCoords(e) {
        const rect = this._arpStyleSvg.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / rect.width * 100,
            y: (e.clientY - rect.top) / rect.height * 50,
        };
    }

    /** @param {PointerEvent} e */
    _onArpSvgPointerDown(e) {
        if (!this._currentPattern) return;

        const { x, y } = this._svgCoords(e);
        const steps = this._currentPattern.length;
        const maxVal = steps - 1;
        const { plotL, plotR, padY } = ParameterPanel._SVG;
        const plotH = 50 - 2 * padY;

        // Find nearest point within hit radius
        let bestDist = 12;
        let bestIdx = -1;
        for (let i = 0; i < steps; i++) {
            const px = plotL + (i / (steps - 1)) * (plotR - plotL);
            const py = padY + (1 - this._currentPattern[i] / maxVal) * plotH;
            const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = i;
            }
        }

        if (bestIdx >= 0) {
            e.preventDefault();
            this._dragStepIdx = bestIdx;
            this._dragMoved = false;
            this._arpStyleSvg.setPointerCapture(e.pointerId);
            this._redrawArpSvg();
        }
    }

    /** @param {PointerEvent} e */
    _onArpSvgPointerMove(e) {
        if (this._dragStepIdx === null) return;
        e.preventDefault();

        const { y } = this._svgCoords(e);
        const steps = this._currentPattern.length;
        const maxVal = steps - 1;
        const padY = ParameterPanel._SVG.padY;
        const plotH = 50 - 2 * padY;

        // Map Y to value (top = max, bottom = 0) — allow duplicates, no swap
        const rawVal = (1 - (y - padY) / plotH) * maxVal;
        const newVal = Math.max(0, Math.min(maxVal, Math.round(rawVal)));

        if (newVal !== this._currentPattern[this._dragStepIdx]) {
            this._currentPattern[this._dragStepIdx] = newVal;
            this._dragMoved = true;
            this._redrawArpSvg();
        } else if (!this._dragMoved) {
            // Check if pointer moved far enough to count as a drag
            const { x: sx } = this._svgCoords(e);
            const steps2 = this._currentPattern.length;
            const { plotL, plotR } = ParameterPanel._SVG;
            const px = plotL + (this._dragStepIdx / (steps2 - 1)) * (plotR - plotL);
            const py = padY + (1 - this._currentPattern[this._dragStepIdx] / maxVal) * plotH;
            if (Math.sqrt((sx - px) ** 2 + (y - py) ** 2) > 4) {
                this._dragMoved = true;
            }
        }
    }

    /** @param {PointerEvent} e */
    _onArpSvgPointerUp(e) {
        if (this._dragStepIdx === null) return;

        const stepIdx = this._dragStepIdx;
        this._arpStyleSvg.releasePointerCapture(e.pointerId);
        this._dragStepIdx = null;

        if (!this._dragMoved) {
            // Tap (no drag): toggle mute
            this._mutedSteps[stepIdx] = !this._mutedSteps[stepIdx];
        }

        // Update counter: show "custom" or permutation index
        this._updateArpCounter();
        this._redrawArpSvg();
        this.callbacks.onChange(this.getParams());
    }

    /**
     * Name the shape currently drawn: the play mode, or "Edited" once the player
     * has changed it. ("custom" / "17 of 24" was the old permutation vocabulary.)
     * @private
     */
    _updateArpCounter() {
        const mode = this._arpTypeSelect.value;
        const label = (ARP_MODES.find(m => m.value === mode) || ARP_MODES[0]).label;
        this._arpStyleDisplay.textContent = this._isCustomPattern() ? 'Edited' : label;
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
        const envelope = this._envelopeSelect.value;
        return {
            grainSizeMin: parseFloat(this._ranges.grainSize.minSlider.value),
            grainSizeMax: parseFloat(this._ranges.grainSize.maxSlider.value),
            densityMin:   parseFloat(this._ranges.density.minSlider.value),
            densityMax:   parseFloat(this._ranges.density.maxSlider.value),
            spreadMin:    parseFloat(this._ranges.spread.minSlider.value),
            spreadMax:    parseFloat(this._ranges.spread.maxSlider.value),
            panMin:       parseFloat(this._ranges.pan.minSlider.value),
            panMax:       parseFloat(this._ranges.pan.maxSlider.value),
            envelope,
            // Per-instance ADSR values (used when envelope === 'custom')
            adsr: (envelope === 'custom' && this._adsrWidget)
                ? this._adsrWidget.getState()
                : null,
            mappings: {
                pressure:    this._mappingSelects.pressure.value,
                contactSize: this._mappingSelects.contactSize.value,
                velocity:    this._mappingSelects.velocity.value,
            },
        };
    }

    /**
     * Read current musical quantization settings.
     * Note: BPM is not included — it is a global master tempo, read directly in main.js.
     * @returns {{ rootNote: number, scale: string, quantizeDensity: boolean, quantizePitch: boolean }}
     */
    getMusicalParams() {
        return {
            rootNote: parseInt(this._rootNoteSelect.value, 10),
            scale: this._scaleSelect.value,
            quantizeGrainSize: this._quantizeGrainSize.checked,
            quantizeDensity: this._quantizeDensity.checked,
            quantizePitch: this._quantizePitch.checked,
            subdivGrainSize: parseInt(this._subdivGrainSize.value, 10),
            subdivDensity: parseInt(this._subdivDensity.value, 10),
            randomGrainSize: this._randomGrainSize.checked,
            randomDensity: this._randomDensity.checked,
            randomPitch: this._randomPitch.checked,
            randomPan: this._randomPan.checked,
            arpPattern: this._arpPatternSelect.value,
            arpSteps: parseInt(this._arpStepsSlider.value, 10),
            // arpMode replaces the old arpType ('straight'/'looped') and arpStyle
            // (a permutation index). The bounce it used to encode is arpPingPong.
            arpMode: this._arpTypeSelect.value,
            arpPingPong: this._arpPingPong.checked,
            arpProbability: parseFloat(this._arpChanceSlider.value),
            arpCustomPattern: this._isCustomPattern() && this._currentPattern
                ? { values: [...this._currentPattern], muted: [...this._mutedSteps] }
                : null,
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
        // Pan range (backward compat: old sessions have single `pan` value)
        const panMin = state.panMin ?? state.pan ?? 0;
        const panMax = state.panMax ?? state.pan ?? 0;
        this._ranges.pan.minSlider.value = panMin;
        this._ranges.pan.maxSlider.value = panMax;

        // --- Simple sliders ---
        this._sliders['param-volume'].slider.value = state.volume;
        this._sliders['param-volume'].display.textContent = parseFloat(state.volume).toFixed(2);

        // --- Envelope ---
        this._envelopeSelect.value = state.envelope;

        // --- Musical params (BPM is global, not restored per-instance) ---
        this._rootNoteSelect.value = state.rootNote;
        this._scaleSelect.value = state.scale;

        // --- Quantize toggles + subdivision selects ---
        this._quantizeGrainSize.checked = state.quantizeGrainSize;
        this._quantizeDensity.checked = state.quantizeDensity;
        this._quantizePitch.checked = state.quantizePitch;
        this._subdivGrainSize.value = state.subdivGrainSize || 4;
        this._subdivDensity.value = state.subdivDensity || 4;
        this._subdivGrainSize.disabled = !state.quantizeGrainSize;
        this._subdivDensity.disabled = !state.quantizeDensity;

        // --- Randomize toggles ---
        this._randomGrainSize.checked = state.randomGrainSize;
        this._randomDensity.checked = state.randomDensity;
        this._randomPitch.checked = state.randomPitch;
        this._randomPan.checked = state.randomPan || false;

        // --- Arp + pitch range ---
        // Handle legacy arpPattern values (up/down/updown → arpeggiator)
        const arpPattern = state.arpPattern;
        if (arpPattern === 'up' || arpPattern === 'down' || arpPattern === 'updown') {
            this._arpPatternSelect.value = 'arpeggiator';
        } else {
            this._arpPatternSelect.value = arpPattern || 'random';
        }
        this._arpStepsSlider.value = state.arpSteps || 4;
        this._arpStepsDisplay.textContent = state.arpSteps || 4;
        // Sessions saved before the play modes carry arpType 'straight'/'looped'
        // and an arpStyle permutation index. Neither survives translation — a
        // permutation is not one of the five named orders — so those load as Up,
        // with the bounce preserved because it maps exactly onto ping-pong.
        this._arpTypeSelect.value = ARP_MODES.some(m => m.value === state.arpMode)
            ? state.arpMode : 'up';
        this._arpPingPong.checked = state.arpPingPong !== undefined
            ? !!state.arpPingPong
            : state.arpType === 'looped';
        this._arpChanceSlider.value = state.arpProbability === undefined
            ? 1 : state.arpProbability;
        this._refreshArpChanceDisplay();
        // Restore custom pattern (if any) after loading the base shape
        if (state.arpCustomPattern) {
            this._currentPattern = [...state.arpCustomPattern.values];
            this._mutedSteps = [...state.arpCustomPattern.muted];
        } else {
            this._currentPattern = null;
            this._mutedSteps = null;
        }
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
        this._updateRangeDisplay('pan');
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
            const bpm = parseInt(document.getElementById('param-bpm').value, 10);
            const divisor = parseInt(this._subdivDensity.value, 10);
            const ms = Math.round(getSubdivisionSeconds(bpm, divisor) * 1000);
            const label = SUBDIVISIONS.find(s => s.divisor === divisor)?.label || '?';
            r.minDisplay.textContent = `${label} (${ms}ms)`;
            r.maxDisplay.textContent = `${label} (${ms}ms)`;
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
            const bpm = parseInt(document.getElementById('param-bpm').value, 10);
            const divisor = parseInt(this._subdivGrainSize.value, 10);
            const ms = Math.round(getSubdivisionSeconds(bpm, divisor) * 1000);
            const label = SUBDIVISIONS.find(s => s.divisor === divisor)?.label || '?';
            r.minDisplay.textContent = `${label} (${ms}ms)`;
            r.maxDisplay.textContent = `${label} (${ms}ms)`;
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

            // The MIN row can be hidden (updateParamRelevance), and every number
            // below comes out of it: offsetLeft/offsetWidth/offsetTop are all 0
            // for a display:none element, so trackWidth became 0 - 14 = -14 and
            // the marker ran BACKWARDS from 7px to -7px, off the card's left
            // edge, spanning the full card height across the parameter's title.
            //
            // Hiding the indicator is the right answer rather than re-deriving
            // the geometry from the visible row: the only way MIN is hidden while
            // a gesture is still mapped is `derived` (quantized, not randomized),
            // and in that state resolveParams overrides the gesture with the
            // subdivision — so the marker was reporting a gesture that changes
            // nothing. offsetParent is null exactly when the element is not
            // rendered, whichever rule did the hiding.
            if (slider.offsetParent === null) {
                indicator.style.opacity = '0';
                continue;
            }

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
            pan: musicalParams.randomPan,
        };

        for (const name of ['grainSize', 'density', 'pan']) {
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
            // Same guard as updateGestureIndicators: every measurement below is
            // 0 for a display:none element, which turns trackWidth negative and
            // draws the bar backwards across the card. Unreachable today (the bar
            // only shows when randomize is on, and that is exactly when the MIN
            // row is visible) — but the two functions share the arithmetic, so
            // they should not drift apart on the assumption.
            if (slider.offsetParent === null) { bar.style.opacity = '0'; continue; }
            const thumbHalf = 7; // half of 14px thumb
            const trackStart = slider.offsetLeft + thumbHalf;
            const trackWidth = slider.offsetWidth - thumbHalf * 2;

            // Normalize values to 0–1 position on the track
            // (handles both 0–1 range params and -1 to 1 pan range)
            const sliderMin = parseFloat(r.minSlider.min);
            const sliderMax = parseFloat(r.minSlider.max);
            const sliderRange = sliderMax - sliderMin;
            const minVal = (parseFloat(r.minSlider.value) - sliderMin) / sliderRange;
            const maxVal = (parseFloat(r.maxSlider.value) - sliderMin) / sliderRange;

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

        // Not `|| hasMapping('pan')`: no gesture select offers value="pan" (the
        // options are grainSize / density / spread / amplitude / pitch), so that
        // half was unreachable and would read as working code to whoever next
        // wonders why mapping a gesture to Pan reveals nothing.
        const panMinActive = m.randomPan;

        // A range needs two ends; a single value does not. With randomize off and
        // no gesture mapped, MIN is not a control the user can use for anything,
        // and every Sound Engine card shipped in that state — so the instrument's
        // PRIMARY sound control was the slider labelled "MAX", sitting under a
        // greyed twin showing the same number. That reads as a broken card.
        //
        // Dimming it was worse than useless: opacity 0.35 over --card-bg puts the
        // MIN tag at 1.71:1 and its value at 2.15:1, well under the 3:1 floor, so
        // it was not a dimmed row but a smear. Hide the row instead — the idiom
        // this panel already uses for a control that means nothing right now —
        // and drop the MAX tag with it, because with one row there is no min and
        // max to tell apart: the card's own name is the label.
        // Quantized means the value is derived from BPM and the subdivision, so
        // the sliders contribute nothing to it. They were left live and
        // draggable while BOTH readouts were overwritten with one identical
        // string (see _refreshGrainSizeDisplay) — two sliders you could drag
        // across their whole travel while the numbers never moved and never
        // differed. Nothing on screen said whether the control or the user was
        // at fault. Disable them and let the subdivision select be the control.
        // `quantized` alone is NOT the condition. main.js:290 substitutes the
        // subdivision only when quantize is on AND randomize is off; with both on,
        // the min/max pair is live — it is the random range, which is then snapped
        // to the grid. Disabling on `quantized` alone locked the user out (by the
        // disabled attribute, so keyboard too) of the exact two sliders shaping
        // what they were hearing, and overwrote both readouts with one static
        // string that was not what the engine was producing.
        const setRows = (minRow, key, active, quantized, randomized) => {
            const r = this._ranges[key];
            const maxRow = this._maxRows[key];
            const derived = quantized && !randomized;
            const showMin = active && !derived;
            minRow.hidden = !showMin;
            r.minSlider.disabled = !showMin;
            maxRow.classList.toggle('range-row-solo', !showMin);
            r.maxSlider.disabled = derived;
            maxRow.classList.toggle('range-row-derived', derived);
            return derived;
        };
        const gsDerived = setRows(this._grainSizeMinRow, 'grainSize', gsMinActive,
            this._quantizeGrainSize.checked, m.randomGrainSize);
        const denDerived = setRows(this._densityMinRow, 'density', denMinActive,
            this._quantizeDensity.checked, m.randomDensity);
        setRows(this._spreadMinRow, 'spread', sprMinActive, false, false);
        setRows(this._panMinRow, 'pan', panMinActive, false, m.randomPan);

        // Say WHY a control is unavailable, in place of the control. Greying
        // something out states that it is off and nothing else; the user is left
        // to discover the switch that wakes it. These are the only dead controls
        // a musician meets in the first ten seconds.
        this._setNote('grain-size', gsDerived ? 'Set by Quantize' : null);
        this._setNote('density', denDerived ? 'Set by Quantize' : null);

        // --- Root Note & Scale: active when quantize pitch, or arp pattern ≠ random ---
        const arpPattern = m.arpPattern || 'random';
        const noteActive = m.quantizePitch
            || (m.randomPitch && arpPattern !== 'random');
        this._rootNoteGroup.classList.toggle('param-inactive', !noteActive);
        this._scaleGroup.classList.toggle('param-inactive', !noteActive);
        // Same reasoning as the rows above: dim AND disable. Root Note and Scale
        // do nothing unless pitch is being snapped to a scale, and a keyboard user
        // could previously change both while they read as inactive.
        this._rootNoteSelect.disabled = !noteActive;
        this._scaleSelect.disabled = !noteActive;
        // Names only what is on screen right now. The previous wording pointed at
        // "Pitch Motion", a card that is display:none in exactly the state that
        // shows this note — so half the instruction referred to a control the
        // reader could not see. It also used an arrow, which reads as a menu path
        // in an interface that has no menus.
        const why = noteActive ? null : 'Turn on Quantize in the Pitch card to use this';
        this._setNote('root-note', why);
        this._setNote('scale', why);
    }

    /**
     * Refresh quantized display labels (grain size + density) when master BPM changes.
     * Called from main.js since BPM is a global control, not owned by ParameterPanel.
     */
    refreshQuantizedDisplays() {
        this._refreshGrainSizeDisplay();
        this._refreshDensityDisplay();
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
