// main.js — Entry point, wires everything together

import { GranularEngine } from './audio/GranularEngine.js';
import { WaveformDisplay } from './ui/WaveformDisplay.js';
import { GrainOverlay } from './ui/GrainOverlay.js';
import { ParameterPanel } from './ui/ParameterPanel.js';
import { PointerHandler } from './input/PointerHandler.js';
import { LevelMeter } from './ui/LevelMeter.js';
import { setupDragAndDrop, setupFilePicker } from './utils/fileLoader.js';
import { expMap, lerp } from './utils/math.js';
import {
    SCALES, quantizePitch, rateToSemitones, semitonesToRate,
    normalizedToSubdivision, getSubdivisionSeconds,
} from './utils/musicalQuantizer.js';

// --- Theme toggle (light/dark) ---

const themeToggle = document.getElementById('theme-toggle');

function applyTheme(theme) {
    if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    localStorage.setItem('granul8-theme', theme);
}

// Restore saved theme
const savedTheme = localStorage.getItem('granul8-theme') || 'dark';
applyTheme(savedTheme);

themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    applyTheme(next);
    // Notify canvas components to re-read CSS colors
    waveform.onThemeChange();
    params.onThemeChange();
});

// --- DOM references ---

const canvas = document.getElementById('waveform-canvas');
const container = document.getElementById('waveform-container');
const loadBtn = document.getElementById('load-sample-btn');
const fileInput = document.getElementById('file-input');
const sampleNameEl = document.getElementById('sample-name');
const sampleSelect = document.getElementById('sample-select');
const dropOverlay = document.getElementById('drop-overlay');

// --- Engine ---

const engine = new GranularEngine();

// --- Grain overlay (visualization of individual grains) ---

const grainOverlay = new GrainOverlay();
engine.onGrain = (info) => grainOverlay.addGrain(info);

// --- Level meter ---

const levelMeter = new LevelMeter(
    document.getElementById('level-meter'),
    engine.analyser
);

// --- Waveform display ---

const waveform = new WaveformDisplay(canvas);

// --- iOS / Safari audio unlock overlay ---
// Show a "Tap to start" overlay if AudioContext is suspended.
// On first user gesture, resume audio and dismiss the overlay.

const unlockOverlay = document.getElementById('audio-unlock-overlay');

function dismissUnlockOverlay() {
    engine.resume();
    if (unlockOverlay) {
        unlockOverlay.style.opacity = '0';
        unlockOverlay.style.pointerEvents = 'none';
        unlockOverlay.style.transition = 'opacity 0.3s';
        setTimeout(() => unlockOverlay.remove(), 400);
    }
}

// If audio context is already running (desktop autoplay allowed), hide immediately
if (engine.audioContext.state === 'running') {
    unlockOverlay?.remove();
} else {
    unlockOverlay?.addEventListener('pointerdown', dismissUnlockOverlay, { once: true });
    // Also listen globally as a fallback
    document.addEventListener('pointerdown', function unlock() {
        dismissUnlockOverlay();
        document.removeEventListener('pointerdown', unlock);
    }, { once: true });
}

// --- Prevent accidental swipe navigation on canvas ---
canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

// --- Canvas resize (HiDPI-aware) ---

function resizeCanvas() {
    canvas.width = container.clientWidth * devicePixelRatio;
    canvas.height = container.clientHeight * devicePixelRatio;
    waveform.resize();
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// --- Sample loading ---

async function handleFile(file) {
    sampleNameEl.textContent = file.name;
    try {
        const buffer = await engine.loadSampleFromFile(file);
        waveform.setBuffer(buffer);
        console.log(`Loaded: ${file.name} (${buffer.duration.toFixed(2)}s, ${buffer.sampleRate}Hz, ${buffer.numberOfChannels}ch)`);
    } catch (err) {
        console.error('Failed to decode audio file:', err);
        sampleNameEl.textContent = 'Error loading file';
    }
}

// Wire drag-and-drop
setupDragAndDrop(container, dropOverlay, handleFile);

// Wire file picker
setupFilePicker(loadBtn, fileInput, handleFile);

// --- Sample selector dropdown ---

async function loadSampleFromUrl(url, displayName) {
    try {
        sampleNameEl.textContent = 'Loading...';
        const buffer = await engine.loadSample(url);
        waveform.setBuffer(buffer);
        sampleNameEl.textContent = displayName;
        console.log(`Loaded: ${displayName} (${buffer.duration.toFixed(2)}s, ${buffer.sampleRate}Hz)`);
    } catch (err) {
        console.error('Failed to load sample:', err);
        sampleNameEl.textContent = 'Error loading sample';
    }
}

sampleSelect.addEventListener('change', () => {
    const url = sampleSelect.value;
    if (!url) return;
    const displayName = sampleSelect.options[sampleSelect.selectedIndex].textContent;
    loadSampleFromUrl(url, displayName);
});

// Auto-load the initially selected sample
if (sampleSelect.value) {
    const displayName = sampleSelect.options[sampleSelect.selectedIndex].textContent;
    loadSampleFromUrl(sampleSelect.value, displayName);
}

// --- Gesture modulation resolution ---

/** Convert normalized Y (0=top, 1=bottom) to playback rate via octaves. */
function yToPitch(y) {
    // top → +2 octaves (4×), center → 0 (1×), bottom → −2 octaves (0.25×)
    const octaves = 2 - 4 * y;
    return Math.pow(2, octaves);
}

/**
 * Resolve panel parameters (normalized ranges + mappings) and gesture data
 * into engine-ready parameters.
 *
 * For each range parameter (grainSize, density, spread):
 *   - If a gesture dimension is mapped to it → interpolate min–max using gesture value
 *   - Otherwise → use the max value (behaves like a single slider)
 *
 * Musical quantization (optional):
 *   - Density: snap interOnset to nearest BPM subdivision
 *   - Pitch: snap to nearest scale degree
 *
 * @param {object} p   - Panel params from ParameterPanel.getParams()
 * @param {object} g   - Gesture data { position, amplitude, pressure, contactSize, velocity }
 * @param {object} m   - Musical params from ParameterPanel.getMusicalParams()
 * @returns {object}    Engine-ready params
 */
function resolveParams(p, g, m) {
    const { mappings } = p;

    // Start with max values (default when no gesture is mapped)
    let grainSizeNorm = p.grainSizeMax;
    let densityNorm   = p.densityMax;
    let spreadNorm    = p.spreadMax;
    let amplitude     = 0.8;
    let pitch         = yToPitch(g.amplitude);

    // Apply gesture mappings
    const gestureDims = {
        pressure:    g.pressure,
        contactSize: g.contactSize,
        velocity:    g.velocity,
    };

    for (const [dim, target] of Object.entries(mappings)) {
        if (target === 'none') continue;
        const gv = gestureDims[dim];
        if (gv === undefined) continue;

        // Invert velocity for density: fast movement → short inter-onset (denser)
        const effectiveGv = (dim === 'velocity' && target === 'density') ? 1 - gv : gv;

        switch (target) {
            case 'grainSize':
                grainSizeNorm = lerp(p.grainSizeMin, p.grainSizeMax, effectiveGv);
                break;
            case 'density':
                densityNorm = lerp(p.densityMin, p.densityMax, effectiveGv);
                break;
            case 'spread':
                spreadNorm = lerp(p.spreadMin, p.spreadMax, effectiveGv);
                break;
            case 'amplitude':
                amplitude = effectiveGv;
                break;
            case 'pitch':
                // 0 → −2 octaves (0.25×), 1 → +2 octaves (4×)
                pitch = Math.pow(2, lerp(-2, 2, effectiveGv));
                break;
        }
    }

    // Convert normalized values to engine units
    let grainSize = expMap(grainSizeNorm, 0.001, 1.0);   // 1 ms – 1000 ms
    let interOnset = expMap(densityNorm, 0.005, 0.5);     // 5 ms – 500 ms

    // Apply grain size quantization: snap to nearest BPM subdivision
    // (only when not randomized; per-grain snapping handled in Voice when randomized)
    if (m.quantizeGrainSize && !m.randomGrainSize) {
        const sub = normalizedToSubdivision(grainSizeNorm);
        grainSize = getSubdivisionSeconds(m.bpm, sub.divisor);
    }

    // Apply density quantization: snap to nearest BPM subdivision
    if (m.quantizeDensity && !m.randomDensity) {
        const sub = normalizedToSubdivision(densityNorm);
        interOnset = getSubdivisionSeconds(m.bpm, sub.divisor);
    }

    // Apply pitch quantization (for non-randomized pitch only; per-grain pitch
    // quantization is handled in Voice._onScheduleGrain when randomized)
    if (m.quantizePitch && !m.randomPitch) {
        const semitones = rateToSemitones(pitch);
        const scaleIntervals = SCALES[m.scale] || SCALES.chromatic;
        const snapped = quantizePitch(semitones, scaleIntervals, m.rootNote);
        pitch = semitonesToRate(snapped);
    }

    // Build per-grain randomization ranges (null = no randomization)
    const randomize = {
        grainSize: m.randomGrainSize
            ? [expMap(p.grainSizeMin, 0.001, 1.0), expMap(p.grainSizeMax, 0.001, 1.0)]
            : null,
        pitch: m.randomPitch
            ? [-2, 2]  // log2 space: ±2 octaves
            : null,
    };

    // Density randomization: compute interOnset range for scheduler jitter
    let interOnsetRange = null;
    if (m.randomDensity) {
        if (m.quantizeDensity) {
            // Quantized: jitter between first and last subdivision bounds
            const minSub = normalizedToSubdivision(p.densityMin);
            const maxSub = normalizedToSubdivision(p.densityMax);
            const iotA = getSubdivisionSeconds(m.bpm, minSub.divisor);
            const iotB = getSubdivisionSeconds(m.bpm, maxSub.divisor);
            interOnsetRange = [Math.min(iotA, iotB), Math.max(iotA, iotB)];
        } else {
            const iotMin = expMap(p.densityMin, 0.005, 0.5);
            const iotMax = expMap(p.densityMax, 0.005, 0.5);
            interOnsetRange = [Math.min(iotMin, iotMax), Math.max(iotMin, iotMax)];
        }
    }

    // Grain size quantization info for per-grain snapping (when grain size is randomized)
    const grainSizeQuantize = (m.quantizeGrainSize && m.randomGrainSize)
        ? { bpm: m.bpm }
        : null;

    // Density quantization info for per-grain snapping (when density is randomized)
    const interOnsetQuantize = (m.quantizeDensity && m.randomDensity)
        ? { bpm: m.bpm }
        : null;

    // Pitch quantization info for per-grain snapping (when pitch is randomized)
    const pitchQuantize = (m.quantizePitch && m.randomPitch)
        ? { scale: SCALES[m.scale] || SCALES.chromatic, rootNote: m.rootNote }
        : null;

    return {
        position:   g.position,
        grainSize,
        interOnset,
        interOnsetRange,
        interOnsetQuantize,
        spread:     spreadNorm,                           // 0–1
        amplitude,
        pitch,
        pan:        p.pan,
        envelope:   p.envelope,
        randomize,
        grainSizeQuantize,
        pitchQuantize,
    };
}

/**
 * Compute the resolved normalized values for range params that have active gesture mappings.
 * Returns only keys with active mappings (used for visual indicator feedback).
 */
function getResolvedNormals(p, g) {
    const { mappings } = p;
    const normals = {};
    const gestureDims = { pressure: g.pressure, contactSize: g.contactSize, velocity: g.velocity };

    for (const [dim, target] of Object.entries(mappings)) {
        if (target === 'none') continue;
        const gv = gestureDims[dim];
        if (gv === undefined) continue;
        const ev = (dim === 'velocity' && target === 'density') ? 1 - gv : gv;
        if (target === 'grainSize') normals.grainSize = lerp(p.grainSizeMin, p.grainSizeMax, ev);
        else if (target === 'density') normals.density = lerp(p.densityMin, p.densityMax, ev);
        else if (target === 'spread') normals.spread = lerp(p.spreadMin, p.spreadMax, ev);
    }
    return normals;
}

// --- Parameter panel ---

const params = new ParameterPanel(document.getElementById('parameter-panel'), {
    onChange(p) {
        // Re-resolve all active voices with updated panel params + their current gesture data
        const m = params.getMusicalParams();
        for (const [pointerId, entry] of pointer.pointers) {
            const resolved = resolveParams(p, entry, m);
            engine.updateVoice(pointerId, resolved);
        }
    },
    onVolumeChange(v) { engine.setMasterVolume(v); },
});

// --- Pointer interaction via PointerHandler ---
// Multi-touch: each pointer allocates a voice from the pool (up to 10)
// Extended gestures (pressure, contact size, velocity) modulate parameters via mappings

const pointer = new PointerHandler(canvas, {
    onStart({ pointerId, position, amplitude, pressure, contactSize, velocity }) {
        if (!engine.sourceBuffer) return undefined;
        engine.resume();
        const gesture = { position, amplitude, pressure, contactSize, velocity };
        const p = params.getParams();
        const m = params.getMusicalParams();
        const resolved = resolveParams(p, gesture, m);
        params.updateGestureIndicators(getResolvedNormals(p, gesture));
        return engine.startVoice(pointerId, resolved);
    },
    onMove({ pointerId, position, amplitude, pressure, contactSize, velocity }) {
        const gesture = { position, amplitude, pressure, contactSize, velocity };
        const p = params.getParams();
        const m = params.getMusicalParams();
        const resolved = resolveParams(p, gesture, m);
        engine.updateVoice(pointerId, resolved);
        params.updateGestureIndicators(getResolvedNormals(p, gesture));
    },
    onStop({ pointerId }) {
        engine.stopVoice(pointerId);
        if (pointer.pointers.size === 0) {
            params.hideGestureIndicators();
        }
    },
});

// --- Gesture live meters ---

const gestureMeterEls = {
    pressure:    document.getElementById('meter-pressure'),
    contactSize: document.getElementById('meter-contact-size'),
    velocity:    document.getElementById('meter-velocity'),
};

const gestureStatusEls = {
    pressure:    document.getElementById('status-pressure'),
    contactSize: document.getElementById('status-contact-size'),
    velocity:    document.getElementById('status-velocity'),
};

/** Update gesture meter fills + capability badges. Called each frame. */
function updateGestureMeters() {
    const live = pointer.liveGesture;
    const caps = pointer.capabilities;
    const hasPointers = pointer.pointers.size > 0;

    // Pressure
    gestureMeterEls.pressure.style.width = hasPointers ? `${live.pressure * 100}%` : '0%';
    if (caps.pressure && !gestureStatusEls.pressure.classList.contains('active')) {
        gestureStatusEls.pressure.textContent = 'available';
        gestureStatusEls.pressure.classList.add('active');
    }

    // Contact size
    gestureMeterEls.contactSize.style.width = hasPointers ? `${live.contactSize * 100}%` : '0%';
    if (caps.contactSize && !gestureStatusEls.contactSize.classList.contains('active')) {
        gestureStatusEls.contactSize.textContent = 'available';
        gestureStatusEls.contactSize.classList.add('active');
    }

    // Velocity (always available)
    gestureMeterEls.velocity.style.width = hasPointers ? `${live.velocity * 100}%` : '0%';
}

// --- Render loop ---

function render() {
    // Waveform draws its own background + cached waveform image
    waveform.draw();

    // Grain overlay (fading rectangles showing individual grains)
    grainOverlay.draw(waveform.ctx, canvas.width, canvas.height, engine.audioContext.currentTime);

    // Pointer indicator (circle + vertical line at touch/click position)
    pointer.drawIndicator(waveform.ctx, canvas.width, canvas.height);

    // Level meter
    levelMeter.update();

    // Gesture live meters
    updateGestureMeters();

    // Randomization range indicators on sliders
    params.updateRandomIndicators(params.getMusicalParams());

    requestAnimationFrame(render);
}

requestAnimationFrame(render);
