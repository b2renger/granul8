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
import { TransportBar } from './ui/TransportBar.js';
import { expMap, lerp } from './utils/math.js';
import {
    SCALES, quantizePitch, rateToSemitones, semitonesToRate,
    normalizedToSubdivision, getSubdivisionSeconds, buildNoteTable,
    selectArpNotes, getPermutations, applyArpType, quantizeTimeToGrid,
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

// --- Master BPM (global, not per-instance) ---

const bpmSlider = document.getElementById('param-bpm');
const bpmDisplay = document.getElementById('val-bpm');
const tapTempoBtn = document.getElementById('tap-tempo');
let tapTimes = [];

/** Read the current master BPM from the slider. */
function getMasterBpm() {
    return parseInt(bpmSlider.value, 10);
}

bpmSlider.addEventListener('input', () => {
    bpmDisplay.textContent = bpmSlider.value;
    // Refresh quantized displays in the panel
    params.refreshQuantizedDisplays();
    if (persistence) persistence.scheduleSave();
});

tapTempoBtn.addEventListener('click', () => {
    const now = performance.now();
    if (tapTimes.length > 0 && now - tapTimes[tapTimes.length - 1] > 2000) {
        tapTimes = [];
    }
    tapTimes.push(now);
    if (tapTimes.length > 4) tapTimes.shift();
    if (tapTimes.length >= 2) {
        let sum = 0;
        for (let i = 1; i < tapTimes.length; i++) {
            sum += tapTimes[i] - tapTimes[i - 1];
        }
        const avgMs = sum / (tapTimes.length - 1);
        const bpm = Math.round(60000 / avgMs);
        const clamped = Math.max(40, Math.min(300, bpm));
        bpmSlider.value = clamped;
        bpmDisplay.textContent = clamped;
        params.refreshQuantizedDisplays();
        if (persistence) persistence.scheduleSave();
    }
});

// --- Master volume control (global, affects all instances) ---

const masterVolumeSlider = document.getElementById('master-volume');
const masterVolumeDisplay = document.getElementById('val-master-volume');

masterVolumeSlider.addEventListener('input', () => {
    const v = parseFloat(masterVolumeSlider.value);
    masterBus.setMasterVolume(v);
    masterVolumeDisplay.textContent = v.toFixed(2);
    if (persistence) persistence.scheduleSave();
});

// --- Per-tab automation (recorder & player owned by each instance in InstanceManager) ---

/** @type {Map<number, number>} pointerId → voiceIndex for active recording on current tab */
const recorderPointerMap = new Map();

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

    const bpm = getMasterBpm();

    if (m.quantizeGrainSize && !m.randomGrainSize) {
        const sub = normalizedToSubdivision(1 - grainSizeNorm);
        grainSize = getSubdivisionSeconds(bpm, sub.divisor);
    }

    if (m.quantizeDensity && !m.randomDensity) {
        const sub = normalizedToSubdivision(1 - densityNorm);
        interOnset = getSubdivisionSeconds(bpm, sub.divisor);
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
        pan: m.randomPan
            ? [p.panMin, p.panMax]
            : null,
    };

    const interOnsetRange = m.randomDensity
        ? [p.densityMin, p.densityMax]
        : null;

    const grainSizeQuantize = (m.quantizeGrainSize && m.randomGrainSize)
        ? { bpm }
        : null;

    const interOnsetQuantize = (m.quantizeDensity && m.randomDensity)
        ? { bpm }
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
        pan:        p.panMax,
        envelope:   p.envelope,
        adsr:       p.adsr,
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
        const active = instanceManager.getActive();
        if (active) active.engine.setInstanceVolume(v);
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

        // If armed, start actual recording on first touch
        if (transport.state === 'armed') {
            active.recorder.startRecording();
            transport.setState('recording');
        }

        const gesture = { position, amplitude, pressure, contactSize, velocity };
        const p = params.getParams();
        const m = params.getMusicalParams();
        const resolved = resolveParams(p, gesture, m);
        params.updateGestureIndicators(getResolvedNormals(p, gesture));
        const voiceId = active.engine.startVoice(pointerId, resolved);
        if (voiceId !== undefined && active.recorder.isRecording) {
            recorderPointerMap.set(pointerId, voiceId);
            active.recorder.captureStart(voiceId, resolved);
        }
        return voiceId;
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
        if (active.recorder.isRecording) {
            const voiceId = recorderPointerMap.get(pointerId);
            if (voiceId !== undefined) {
                active.recorder.captureMove(voiceId, resolved);
            }
        }
    },
    onStop({ pointerId }) {
        const active = instanceManager.getActive();
        if (active) active.engine.stopVoice(pointerId);
        if (active?.recorder.isRecording) {
            const voiceId = recorderPointerMap.get(pointerId);
            if (voiceId !== undefined) {
                active.recorder.captureStop(voiceId);
                recorderPointerMap.delete(pointerId);
            }
        }
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
            recorderPointerMap.clear();
            params.hideGestureIndicators();

            // switchTo() stops recording/playback on the old tab
            instanceManager.switchTo(id);

            // Update transport bar to reflect new tab's state
            const active = instanceManager.getActive();
            if (active?.player.isPlaying) {
                transport.setState('playing');
            } else {
                transport.setState('idle');
            }
            transport.setHasRecording(active?.recorder.getRecording().length > 0);
            if (!active?.player.isPlaying) {
                transport.resetDisplay();
            }

            // Update sample display
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
    () => serializeSession(instanceManager, params, getMasterBpm(), parseFloat(masterVolumeSlider.value))
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
            // Restore master BPM from session (default 120 for backward compatibility)
            const savedBpm = validation.data.masterBpm || 120;
            bpmSlider.value = savedBpm;
            bpmDisplay.textContent = savedBpm;

            // Restore master volume from session (default 0.7 for backward compatibility)
            const savedMasterVol = validation.data.masterVolume ?? 0.7;
            masterVolumeSlider.value = savedMasterVol;
            masterVolumeDisplay.textContent = savedMasterVol.toFixed(2);
            masterBus.setMasterVolume(savedMasterVol);

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
    const session = serializeSession(instanceManager, params, getMasterBpm(), parseFloat(masterVolumeSlider.value));
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

        // Restore master BPM from imported session
        const importedBpm = validation.data.masterBpm || 120;
        bpmSlider.value = importedBpm;
        bpmDisplay.textContent = importedBpm;

        // Restore master volume from imported session
        const importedMasterVol = validation.data.masterVolume ?? 0.7;
        masterVolumeSlider.value = importedMasterVol;
        masterVolumeDisplay.textContent = importedMasterVol.toFixed(2);
        masterBus.setMasterVolume(importedMasterVol);

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

// --- Transport controls ---

const transport = new TransportBar({
    recordBtn:   document.getElementById('btn-record'),
    playBtn:     document.getElementById('btn-play'),
    stopBtn:     document.getElementById('btn-stop'),
    loopBtn:     document.getElementById('btn-loop'),
    timeDisplay: document.getElementById('time-display'),
    progressBar: document.getElementById('transport-progress-fill'),
});

transport.onRecord = () => {
    const active = instanceManager.getActive();
    if (!active) return;

    if (active.recorder.isRecording) {
        // Stop recording
        active.recorder.stopRecording();
        recorderPointerMap.clear();
        transport.setState('idle');
        transport.setHasRecording(active.recorder.getRecording().length > 0);
    } else if (transport.state === 'armed') {
        // Disarm (toggle off)
        transport.setState('idle');
        transport.setHasRecording(active.recorder.getRecording().length > 0);
    } else {
        // Arm recording — actual recording starts on first touch
        if (active.player.isPlaying) active.player.stop();
        transport.setState('armed');
    }
};

transport.onPlay = () => {
    const active = instanceManager.getActive();
    if (!active) return;
    const lane = active.recorder.getRecording();
    if (lane.length === 0) return;
    masterBus.resume();
    active.player.play(lane, transport.looping);
    transport.setState('playing');
};

transport.onStop = () => {
    const active = instanceManager.getActive();
    if (active?.recorder.isRecording) {
        active.recorder.stopRecording();
        recorderPointerMap.clear();
    }
    if (active?.player.isPlaying) {
        active.player.stop();
    }
    transport.setState('idle');
    transport.setHasRecording(active?.recorder.getRecording().length > 0);
    transport.setProgress(0);
};

transport.onLoopToggle = (looping) => {
    const active = instanceManager.getActive();
    if (active?.player) active.player.setLoop(looping);
};

// --- Loop snap-to-grid toggle ---
let loopSnapToGrid = false;
const snapBtn = document.getElementById('btn-snap-grid');
snapBtn.addEventListener('click', () => {
    loopSnapToGrid = !loopSnapToGrid;
    snapBtn.classList.toggle('snap-active', loopSnapToGrid);
});

transport.onLoopRangeChange = (startFrac, endFrac) => {
    const active = instanceManager.getActive();
    if (!active?.player) return;
    const duration = active.recorder.getElapsedTime();
    if (duration <= 0) return;

    let loopStart = startFrac * duration;
    let loopEnd = endFrac * duration;

    // Snap to BPM grid when enabled
    if (loopSnapToGrid) {
        const bpm = getMasterBpm();
        loopStart = quantizeTimeToGrid(loopStart, bpm);
        loopEnd = quantizeTimeToGrid(loopEnd, bpm);
        // Ensure minimum loop length of one beat
        if (loopEnd <= loopStart) {
            loopEnd = loopStart + (60 / bpm);
        }
        // Update handle positions to reflect snapped values
        transport.setLoopRange(loopStart / duration, loopEnd / duration);
    }

    active.player.setLoopRange(loopStart, loopEnd);
};

// --- Keyboard shortcut: 'R' to arm/disarm/stop recording ---

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (transport.onRecord) transport.onRecord();
    }
});

// --- Player callbacks routed through InstanceManager ---

instanceManager.onPlayerFrame = (elapsed, progress) => {
    transport.setTime(elapsed);
    transport.setProgress(progress);
};

instanceManager.onPlayerComplete = () => {
    const active = instanceManager.getActive();
    transport.setState('idle');
    transport.setHasRecording(true);
    transport.setProgress(0);
    if (active) transport.setTime(active.recorder.getRecording().getDuration());
};

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

    // Update transport time display during recording
    if (active?.recorder.isRecording) {
        transport.setTime(active.recorder.getElapsedTime());
    }

    requestAnimationFrame(render);
}

requestAnimationFrame(render);
