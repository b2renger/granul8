// main.js — Entry point, wires everything together

import { MasterBus } from './audio/MasterBus.js';
import { InstanceManager } from './state/InstanceManager.js';
import { WaveformDisplay } from './ui/WaveformDisplay.js';
import { ParameterPanel } from './ui/ParameterPanel.js';
import { TabBar } from './ui/TabBar.js';
import { PointerHandler } from './input/PointerHandler.js';
import { LevelMeter } from './ui/LevelMeter.js';
import { setupDragAndDrop, setupFilePicker, isAudioFile } from './utils/fileLoader.js';
import { serializeSession, validateSession, getBundledSampleUrls } from './state/SessionSerializer.js';
import { SessionPersistence, exportSessionFile, readSessionFile } from './state/SessionPersistence.js';
import { expMap, lerp } from './utils/math.js';
import {
    SCALES, quantizePitch, rateToSemitones, semitonesToRate,
    normalizedToSubdivision, getSubdivisionSeconds, buildNoteTable,
    selectArpNotes, getPermutations, applyArpType,
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

// --- Shared audio bus ---

const masterBus = new MasterBus();

// --- Level meter (reads combined output from all instances) ---

const levelMeter = new LevelMeter(
    document.getElementById('level-meter'),
    masterBus.analyser
);

// --- Waveform display ---

const waveform = new WaveformDisplay(canvas);

// --- iOS / Safari audio unlock overlay ---

const unlockOverlay = document.getElementById('audio-unlock-overlay');

function dismissUnlockOverlay() {
    masterBus.resume();
    if (unlockOverlay) {
        unlockOverlay.style.opacity = '0';
        unlockOverlay.style.pointerEvents = 'none';
        unlockOverlay.style.transition = 'opacity 0.3s';
        setTimeout(() => unlockOverlay.remove(), 400);
    }
}

if (masterBus.audioContext.state === 'running') {
    unlockOverlay?.remove();
} else {
    unlockOverlay?.addEventListener('pointerdown', dismissUnlockOverlay, { once: true });
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

// --- Gesture modulation resolution ---

/** Convert normalized Y (0=top, 1=bottom) to playback rate via octaves. */
function yToPitch(y) {
    const octaves = 2 - 4 * y;
    return Math.pow(2, octaves);
}

/**
 * Resolve panel parameters + gesture data into engine-ready parameters.
 */
function resolveParams(p, g, m) {
    const { mappings } = p;

    let grainSizeNorm = p.grainSizeMax;
    let densityNorm   = p.densityMax;
    let spreadNorm    = p.spreadMax;
    let amplitude     = 0.8;
    let pitch         = yToPitch(g.amplitude);

    const gestureDims = {
        pressure:    g.pressure,
        contactSize: g.contactSize,
        velocity:    g.velocity,
    };

    for (const [dim, target] of Object.entries(mappings)) {
        if (target === 'none') continue;
        const gv = gestureDims[dim];
        if (gv === undefined) continue;
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
                pitch = Math.pow(2, lerp(-2, 2, effectiveGv));
                break;
        }
    }

    let grainSize = expMap(grainSizeNorm, 0.001, 1.0);
    let interOnset = expMap(densityNorm, 0.005, 0.5);

    if (m.quantizeGrainSize && !m.randomGrainSize) {
        const sub = normalizedToSubdivision(1 - grainSizeNorm);
        grainSize = getSubdivisionSeconds(m.bpm, sub.divisor);
    }

    if (m.quantizeDensity && !m.randomDensity) {
        const sub = normalizedToSubdivision(1 - densityNorm);
        interOnset = getSubdivisionSeconds(m.bpm, sub.divisor);
    }

    if (m.quantizePitch && !m.randomPitch) {
        const semitones = rateToSemitones(pitch);
        const scaleIntervals = SCALES[m.scale] || SCALES.chromatic;
        const snapped = quantizePitch(semitones, scaleIntervals, m.rootNote);
        pitch = semitonesToRate(snapped);
    }

    const randomize = {
        grainSize: m.randomGrainSize
            ? [p.grainSizeMin, p.grainSizeMax]
            : null,
        pitch: m.randomPitch
            ? [-(m.pitchRange || 2), m.pitchRange || 2]
            : null,
    };

    const interOnsetRange = m.randomDensity
        ? [p.densityMin, p.densityMax]
        : null;

    const grainSizeQuantize = (m.quantizeGrainSize && m.randomGrainSize)
        ? { bpm: m.bpm }
        : null;

    const interOnsetQuantize = (m.quantizeDensity && m.randomDensity)
        ? { bpm: m.bpm }
        : null;

    const arpPattern = m.arpPattern || 'random';
    const scaleIntervals = SCALES[m.scale] || SCALES.chromatic;
    const range = (m.pitchRange || 2) * 12;
    let pitchQuantize = null;

    if (m.randomPitch && arpPattern === 'arpeggiator') {
        // Permutation arpeggiator: build arpNotes + arpSequence
        const fullTable = buildNoteTable(scaleIntervals, m.rootNote, -range, range);
        const steps = m.arpSteps || 4;
        const arpNotes = selectArpNotes(fullTable, steps);
        let pattern;
        if (m.arpCustomPattern) {
            // Custom edited pattern: values array with possible nulls for muted steps
            pattern = m.arpCustomPattern.values.map((v, i) =>
                m.arpCustomPattern.muted[i] ? null : v
            );
        } else {
            const perms = getPermutations(steps);
            const styleIdx = Math.min(m.arpStyle || 0, perms.length - 1);
            pattern = perms[styleIdx];
        }
        const arpSequence = applyArpType(pattern, m.arpType || 'straight');
        pitchQuantize = { arpNotes, arpSequence };
    } else if (m.randomPitch && m.quantizePitch) {
        // Random pitch with scale quantization (no arpeggiator)
        const noteTable = buildNoteTable(scaleIntervals, m.rootNote, -range, range);
        pitchQuantize = { scale: scaleIntervals, rootNote: m.rootNote, noteTable };
    } else if (m.randomPitch) {
        // Random pitch, no quantization — noteTable for random selection
        const noteTable = buildNoteTable(scaleIntervals, m.rootNote, -range, range);
        pitchQuantize = { noteTable };
    }

    return {
        position:   g.position,
        grainSize,
        interOnset,
        interOnsetRange,
        interOnsetQuantize,
        spread:     spreadNorm,
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
 * Compute resolved normalized values for range params with active gesture mappings.
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

// --- Session persistence (late-binding, initialized after InstanceManager) ---

let persistence = null;

// --- Parameter panel ---

const params = new ParameterPanel(document.getElementById('parameter-panel'), {
    onChange(p) {
        const active = instanceManager.getActive();
        if (!active) return;
        const m = params.getMusicalParams();
        for (const [pointerId, entry] of pointer.pointers) {
            const resolved = resolveParams(p, entry, m);
            active.engine.updateVoice(pointerId, resolved);
        }
        if (persistence) persistence.scheduleSave();
    },
    onVolumeChange(v) {
        masterBus.setMasterVolume(v);
        if (persistence) persistence.scheduleSave();
    },
});

// --- Instance manager ---

const instanceManager = new InstanceManager(masterBus, params, waveform);

// --- Pointer interaction ---

const pointer = new PointerHandler(canvas, {
    onStart({ pointerId, position, amplitude, pressure, contactSize, velocity }) {
        const active = instanceManager.getActive();
        if (!active || !active.engine.sourceBuffer) return undefined;
        masterBus.resume();
        const gesture = { position, amplitude, pressure, contactSize, velocity };
        const p = params.getParams();
        const m = params.getMusicalParams();
        const resolved = resolveParams(p, gesture, m);
        params.updateGestureIndicators(getResolvedNormals(p, gesture));
        return active.engine.startVoice(pointerId, resolved);
    },
    onMove({ pointerId, position, amplitude, pressure, contactSize, velocity }) {
        const active = instanceManager.getActive();
        if (!active) return;
        const gesture = { position, amplitude, pressure, contactSize, velocity };
        const p = params.getParams();
        const m = params.getMusicalParams();
        const resolved = resolveParams(p, gesture, m);
        active.engine.updateVoice(pointerId, resolved);
        params.updateGestureIndicators(getResolvedNormals(p, gesture));
    },
    onStop({ pointerId }) {
        const active = instanceManager.getActive();
        if (active) active.engine.stopVoice(pointerId);
        if (pointer.pointers.size === 0) {
            params.hideGestureIndicators();
        }
    },
});

// --- Tab bar ---

const tabBar = new TabBar(
    document.getElementById('tab-list'),
    document.getElementById('tab-add'),
    {
        onSwitch(id) {
            // Force-stop all active pointer voices before switching
            const current = instanceManager.getActive();
            if (current) {
                for (const [pointerId] of pointer.pointers) {
                    current.engine.stopVoice(pointerId);
                }
            }
            pointer.pointers.clear();
            pointer._fading = [];
            params.hideGestureIndicators();

            instanceManager.switchTo(id);

            // Update sample display
            const active = instanceManager.getActive();
            if (active) {
                sampleNameEl.textContent = active.state.sampleDisplayName;
                sampleSelect.value = active.state.sampleUrl || '';
            }
        },
        onClose(id) {
            instanceManager.removeInstance(id);
            // Update sample display after potential tab switch
            const active = instanceManager.getActive();
            if (active) {
                sampleNameEl.textContent = active.state.sampleDisplayName;
                sampleSelect.value = active.state.sampleUrl || '';
            }
        },
        onRename(id, name) {
            instanceManager.renameInstance(id, name);
        },
        onAdd() {
            const id = instanceManager.createInstance();
            instanceManager.switchTo(id);
            sampleNameEl.textContent = 'No sample loaded';
            sampleSelect.value = '';
        },
    }
);

instanceManager.onTabsChanged = () => {
    tabBar.render(instanceManager.getTabList());
    if (persistence) persistence.scheduleSave();
};

// --- Sample loading ---

async function handleFile(file) {
    const active = instanceManager.getActive();
    if (!active) return;
    sampleNameEl.textContent = file.name;
    try {
        const buffer = await active.engine.loadSampleFromFile(file);
        instanceManager.setActiveSample(buffer, file.name, null, file.name);
        waveform.setBuffer(buffer);
        console.log(`Loaded: ${file.name} (${buffer.duration.toFixed(2)}s, ${buffer.sampleRate}Hz, ${buffer.numberOfChannels}ch)`);
        if (persistence) persistence.scheduleSave();
    } catch (err) {
        console.error('Failed to decode audio file:', err);
        sampleNameEl.textContent = 'Error loading file';
    }
}

function handleDroppedFile(file) {
    if (file.name.toLowerCase().endsWith('.json')) {
        importSessionFromFile(file);
    } else if (isAudioFile(file)) {
        handleFile(file);
    }
}

setupDragAndDrop(container, dropOverlay, handleDroppedFile);
setupFilePicker(loadBtn, fileInput, handleFile);

// --- Sample selector dropdown ---

async function loadSampleFromUrl(url, displayName) {
    const active = instanceManager.getActive();
    if (!active) return;
    try {
        sampleNameEl.textContent = 'Loading...';
        const buffer = await active.engine.loadSample(url);
        instanceManager.setActiveSample(buffer, displayName, url, null);
        waveform.setBuffer(buffer);
        sampleNameEl.textContent = displayName;
        console.log(`Loaded: ${displayName} (${buffer.duration.toFixed(2)}s, ${buffer.sampleRate}Hz)`);
        if (persistence) persistence.scheduleSave();
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

// --- Session persistence initialization ---

const bundledSampleUrls = getBundledSampleUrls(sampleSelect);

persistence = new SessionPersistence(
    () => serializeSession(instanceManager, params)
);

/**
 * Load a sample for a restored instance.
 * Bundled samples auto-fetch; user files are marked as missing.
 */
async function restoreSampleForInstance(state, entry) {
    if (state.sampleUrl && bundledSampleUrls.has(state.sampleUrl)) {
        try {
            const buffer = await entry.engine.loadSample(state.sampleUrl);
            entry.buffer = buffer;
            if (instanceManager.activeId === state.id) {
                waveform.setBuffer(buffer);
                sampleNameEl.textContent = state.sampleDisplayName;
                sampleSelect.value = state.sampleUrl;
            }
        } catch (err) {
            console.warn(`Failed to reload bundled sample: ${state.sampleUrl}`, err);
            markSampleMissing(state, entry);
        }
    } else if (state.sampleFileName) {
        markSampleMissing(state, entry);
    }
}

function markSampleMissing(state, entry) {
    state.sampleDisplayName = `\u26A0 ${state.sampleDisplayName || state.sampleFileName} (missing)`;
    entry.buffer = null;
    if (instanceManager.activeId === state.id) {
        waveform.setBuffer(null);
        sampleNameEl.textContent = state.sampleDisplayName;
        sampleSelect.value = '';
    }
}

function createDefaultSession() {
    instanceManager.createInstance('Sampler 1');
    tabBar.render(instanceManager.getTabList());
    if (sampleSelect.value) {
        const displayName = sampleSelect.options[sampleSelect.selectedIndex].textContent;
        loadSampleFromUrl(sampleSelect.value, displayName);
    }
}

async function initializeSession() {
    persistence.disable();

    const savedSession = persistence.load();
    const validation = savedSession ? validateSession(savedSession) : { valid: false };

    if (validation.valid) {
        try {
            await instanceManager.restoreFromSession(validation.data, restoreSampleForInstance);
            tabBar.render(instanceManager.getTabList());

            const active = instanceManager.getActive();
            if (active) {
                sampleNameEl.textContent = active.state.sampleDisplayName;
                sampleSelect.value = active.state.sampleUrl || '';
            }

            showNotification('Session restored');
        } catch (err) {
            console.error('Session restore failed, starting fresh:', err);
            persistence.clear();
            createDefaultSession();
        }
    } else {
        createDefaultSession();
    }

    persistence.enable();
}

initializeSession();

// --- Session export / import ---

const exportBtn = document.getElementById('session-export-btn');
const importBtn = document.getElementById('session-import-btn');
const importInput = document.getElementById('session-import-input');

exportBtn.addEventListener('click', () => {
    const session = serializeSession(instanceManager, params);
    exportSessionFile(session);
    showNotification('Session exported');
});

importBtn.addEventListener('click', () => importInput.click());

importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    if (!file) return;
    importInput.value = '';
    importSessionFromFile(file);
});

async function importSessionFromFile(file) {
    try {
        const json = await readSessionFile(file);
        const validation = validateSession(json);
        if (!validation.valid) {
            showNotification(`Invalid session: ${validation.error}`, true);
            return;
        }

        // Stop all active pointer voices before import
        const current = instanceManager.getActive();
        if (current) {
            for (const [pointerId] of pointer.pointers) {
                current.engine.stopVoice(pointerId);
            }
        }
        pointer.pointers.clear();
        pointer._fading = [];
        params.hideGestureIndicators();

        persistence.disable();

        await instanceManager.restoreFromSession(validation.data, restoreSampleForInstance);
        tabBar.render(instanceManager.getTabList());

        const active = instanceManager.getActive();
        if (active) {
            sampleNameEl.textContent = active.state.sampleDisplayName;
            sampleSelect.value = active.state.sampleUrl || '';
        }

        persistence.enable();
        persistence.scheduleSave();
        showNotification('Session imported');
    } catch (err) {
        console.error('Session import failed:', err);
        persistence.enable();
        showNotification('Import failed: ' + err.message, true);
    }
}

// Save on page unload to catch pending debounce
window.addEventListener('beforeunload', () => {
    persistence.saveNow();
});

// --- Toast notification ---

function showNotification(message, isError = false) {
    const el = document.createElement('div');
    el.className = 'session-toast' + (isError ? ' session-toast-error' : '');
    el.textContent = message;
    document.body.appendChild(el);
    // Trigger reflow for CSS transition
    el.offsetHeight; // eslint-disable-line no-unused-expressions
    el.classList.add('session-toast-visible');
    setTimeout(() => {
        el.classList.remove('session-toast-visible');
        setTimeout(() => el.remove(), 300);
    }, 2000);
}

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

function updateGestureMeters() {
    const live = pointer.liveGesture;
    const caps = pointer.capabilities;
    const hasPointers = pointer.pointers.size > 0;

    gestureMeterEls.pressure.style.width = hasPointers ? `${live.pressure * 100}%` : '0%';
    if (caps.pressure && !gestureStatusEls.pressure.classList.contains('active')) {
        gestureStatusEls.pressure.textContent = 'available';
        gestureStatusEls.pressure.classList.add('active');
    }

    gestureMeterEls.contactSize.style.width = hasPointers ? `${live.contactSize * 100}%` : '0%';
    if (caps.contactSize && !gestureStatusEls.contactSize.classList.contains('active')) {
        gestureStatusEls.contactSize.textContent = 'available';
        gestureStatusEls.contactSize.classList.add('active');
    }

    gestureMeterEls.velocity.style.width = hasPointers ? `${live.velocity * 100}%` : '0%';
}

// --- Render loop ---

function render() {
    waveform.draw();

    // Grain overlay for the active instance
    const active = instanceManager.getActive();
    if (active) {
        active.grainOverlay.draw(waveform.ctx, canvas.width, canvas.height, masterBus.audioContext.currentTime);
    }

    pointer.drawIndicator(waveform.ctx, canvas.width, canvas.height);
    levelMeter.update();
    updateGestureMeters();
    params.updateRandomIndicators(params.getMusicalParams());
    params.updateParamRelevance();

    requestAnimationFrame(render);
}

requestAnimationFrame(render);
