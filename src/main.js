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
    getSubdivisionSeconds, buildNoteTable,
    selectArpNotes, getPermutations, applyArpType, quantizeTimeToGrid,
} from './utils/musicalQuantizer.js';
import {
    fractionsToBarLoop,
    barLoopToFractions,
    fractionsToSecondsLoop,
    secondsLoopToFractions,
    resolveTakeDuration,
} from './utils/loopHandleMath.js';

// --- Theme toggle (light/dark) ---

const themeToggle = document.getElementById('theme-toggle');

/**
 * localStorage throws on access (not just on write) in Safari private mode and
 * when site data is blocked. This is module top-level code, so an unguarded throw
 * kills the entire app before anything renders.
 */
const safeStorage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* quota or blocked */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* blocked */ } },
};

function applyTheme(theme) {
    if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    safeStorage.set('granul8-theme', theme);
}

// Restore saved theme
const savedTheme = safeStorage.get('granul8-theme') || 'dark';
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
    masterBus.clock.bpm = parseInt(bpmSlider.value, 10);
    // Bar-based loops derive their length from the clock, so every playing layer
    // must re-anchor or it would jump to a new position within the resized loop.
    for (const [, entry] of instanceManager.instances) {
        entry.player.retime();
    }
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
        masterBus.clock.bpm = clamped;
        // Bar-based loops derive their length from the clock, so every playing layer
        // must re-anchor or it would jump to a new position within the resized loop.
        for (const [, entry] of instanceManager.instances) {
            entry.player.retime();
        }
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

/** Target recording duration in seconds, or null for free-form recording. */
let fixedRecordDuration = null;

// --- Level meter (reads combined output from all instances) ---

const levelMeter = new LevelMeter(
    document.getElementById('level-meter'),
    masterBus.analyser
);

// --- Waveform display ---

const waveform = new WaveformDisplay(canvas);

// --- iOS / Safari audio unlock overlay ---

const unlockOverlay = document.getElementById('audio-unlock-overlay');
const unlockBtn = document.getElementById('unlock-btn');
const appEl = document.getElementById('app');

let unlocked = false;

function dismissUnlockOverlay() {
    // The button's click and the document-wide pointerdown fallback below both
    // fire for a single tap, because pointerdown precedes click. Every step here
    // happens to be idempotent today; the guard means that stays true if one of
    // them stops being.
    if (unlocked) return;
    unlocked = true;

    masterBus.resume();
    // Anchor the shared musical grid the first time audio starts. Everything —
    // metronome, every Player's bar alignment — derives from this instant.
    masterBus.clock.ensureEpoch();

    appEl?.removeAttribute('inert');
    if (unlockOverlay) {
        unlockOverlay.style.opacity = '0';
        unlockOverlay.style.pointerEvents = 'none';
        unlockOverlay.style.transition = 'opacity 0.3s';
        setTimeout(() => unlockOverlay.remove(), 400);
    }
    // Move focus off the disappearing dialog. Deliberately NOT the pad canvas:
    // it has no tabindex and must not get one — this is a touch instrument with
    // no keyboard play mode, so a focus ring there would advertise an
    // interaction that does not exist.
    appEl?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus();
}

if (masterBus.audioContext.state === 'running') {
    // No gesture needed, so nothing will call dismissUnlockOverlay(). Anchor the
    // epoch here so both startup paths anchor at the moment audio becomes
    // available rather than leaving this one to whatever plays first.
    unlocked = true;
    masterBus.clock.ensureEpoch();
    unlockOverlay?.remove();
} else {
    // `inert` keeps focus out of the controls behind the blurred, click-blocking
    // overlay — without it Tab walks through sliders the user cannot see.
    appEl?.setAttribute('inert', '');
    // 'click', not 'pointerdown', so Enter and Space work for keyboard users.
    unlockBtn?.addEventListener('click', dismissUnlockOverlay, { once: true });
    unlockBtn?.focus();
    // Any pointer anywhere still unlocks, matching the previous behaviour.
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
        grainSize = getSubdivisionSeconds(bpm, m.subdivGrainSize);
    }

    if (m.quantizeDensity && !m.randomDensity) {
        interOnset = getSubdivisionSeconds(bpm, m.subdivDensity);
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
        ? { bpm, divisor: m.subdivGrainSize }
        : null;

    const interOnsetQuantize = (m.quantizeDensity && m.randomDensity)
        ? { bpm, divisor: m.subdivDensity }
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
            active.ghostRenderer.recording = true;
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

            // Update sample display and loop station UI
            if (active) {
                sampleNameEl.textContent = sampleLabel(active.state);
                sampleSelect.value = active.state.sampleUrl || '';
                applyLoopStationUI(active.state.loopStationMode);
            }

            // Loop handles are global UI state but loop ranges are per-instance —
            // without this the handles keep showing the previous tab's positions.
            if (active) {
                const bars = active.player.getLoopBars();
                if (bars) {
                    // The denominator must be the take's STABLE total length in
                    // bars, not the loop window's own span — a loop that does not
                    // cover the whole take must not render its end handle pinned
                    // at 100%.
                    const totalBars = resolveTakeBars(active);
                    const { startFrac, endFrac } = barLoopToFractions(bars.startBars, bars.lengthBars, totalBars);
                    transport.setLoopRange(startFrac, endFrac);
                } else {
                    // Same denominator the drag maps through (resolveTakeDuration),
                    // so the handles come back exactly where the user left them.
                    // This branch used to divide by recorder.getElapsedTime() while
                    // the drag divided by getLoopableDuration() — two denominators
                    // for one mapping, so the handles jumped on every tab switch.
                    const range = active.player.getLoopRange();
                    const { startFrac, endFrac } =
                        secondsLoopToFractions(range.start, range.end, resolveTakeDuration(active.player, active.recorder));
                    transport.setLoopRange(startFrac, endFrac);
                }
            }
        },
        onClose(id) {
            instanceManager.removeInstance(id);
            // Update sample display after potential tab switch
            const active = instanceManager.getActive();
            if (active) {
                sampleNameEl.textContent = sampleLabel(active.state);
                sampleSelect.value = active.state.sampleUrl || '';
            }
        },
        onRename(id, name) {
            instanceManager.renameInstance(id, name);
        },
        onAdd() {
            const id = instanceManager.createInstance();
            // Apply per-instance loop station mode to the new instance's player
            const entry = instanceManager.instances.get(id);
            if (entry) {
                entry.player.setLoopStationMode(entry.state.loopStationMode, masterBus.clock);
                applyLoopStationUI(entry.state.loopStationMode);
            }
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
        // console.error is invisible to someone playing an instrument, and the
        // old sample-name string ("Error loading file") stayed there afterwards
        // giving no reason and no way back. Say what failed, in the same
        // notification channel every other failure in this app uses.
        console.error('Failed to decode audio file:', err);
        sampleNameEl.textContent = sampleLabel(active.state);
        showNotification(`Could not read ${file.name}. It may not be an audio file this browser can decode.`, true);
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
        sampleNameEl.textContent = sampleLabel(active.state);
        showNotification(`Could not load ${displayName}. Check the file is still there.`, true);
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

/** Gather current global loop station state for session serialization. */
function getLoopStationState() {
    return {
        timeSignature: {
            numerator: masterBus.clock.numerator,
            denominator: masterBus.clock.denominator,
        },
        metronome: {
            enabled: metronomeEnabled,
            volume: masterBus.metronome.volume,
            muted: masterBus.metronome.muted,
        },
        // loopStationMode is now per-instance (in InstanceState), not global
    };
}

persistence = new SessionPersistence(
    () => serializeSession(instanceManager, params, getMasterBpm(), parseFloat(masterVolumeSlider.value), getLoopStationState())
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
            state.sampleMissing = false;
            if (instanceManager.activeId === state.id) {
                waveform.setBuffer(buffer);
                sampleNameEl.textContent = sampleLabel(state);
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

/** Display label for an instance's sample, flagging a sample that could not be reloaded. */
function sampleLabel(state) {
    return state.sampleMissing
        ? `\u26A0 ${state.sampleDisplayName} (missing)`
        : state.sampleDisplayName;
}

function markSampleMissing(state, entry) {
    // Persist the fact, not the formatting \u2014 mutating sampleDisplayName used to
    // accumulate a fresh "\u26A0 \u2026 (missing)" wrapper on every reload. Every redisplay
    // site now derives the label from this flag via sampleLabel(), so the marker
    // survives a tab switch instead of only showing at the instant this runs.
    state.sampleMissing = true;
    entry.buffer = null;
    if (instanceManager.activeId === state.id) {
        waveform.setBuffer(null);
        sampleNameEl.textContent = sampleLabel(state);
        sampleSelect.value = '';
    }
}

/**
 * Restore global loop station state (time signature, metronome) from session data.
 * Loop station mode is now per-instance (stored in InstanceState).
 * Must be called after all module-level variables are initialized (i.e., after an await in async init).
 * @param {Object} data - Validated session data
 */
function restoreLoopStationState(data) {
    // Restore time signature (default 4/4 for backward compatibility)
    const ts = data.timeSignature || { numerator: 4, denominator: 4 };
    masterBus.clock.numerator = ts.numerator;
    masterBus.clock.denominator = ts.denominator;
    timeSigNum.value = ts.numerator;
    timeSigDen.value = ts.denominator;
    transport.updateBeatIndicator(ts.numerator);

    // Restore metronome state (default off for backward compatibility)
    const met = data.metronome || { enabled: false, volume: 0.5, muted: false };
    metronomeEnabled = met.enabled;
    metronomeBtn.classList.toggle('active', metronomeEnabled);
    masterBus.metronome.setVolume(met.volume ?? 0.5);
    metronomeVolSlider.value = met.volume ?? 0.5;
    masterBus.metronome.setMuted(false);

    // loopStationMode is now per-instance — restored via InstanceState.fromJSON()
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
            masterBus.clock.bpm = savedBpm;

            // Restore master volume from session (default 0.7 for backward compatibility)
            const savedMasterVol = validation.data.masterVolume ?? 0.7;
            masterVolumeSlider.value = savedMasterVol;
            masterVolumeDisplay.textContent = savedMasterVol.toFixed(2);
            masterBus.setMasterVolume(savedMasterVol);

            await instanceManager.restoreFromSession(validation.data, restoreSampleForInstance);
            tabBar.render(instanceManager.getTabList());

            // Restore global state (after await so all module vars are initialized)
            restoreLoopStationState(validation.data);

            // Apply per-instance loop station mode to all restored players
            for (const [, entry] of instanceManager.instances) {
                entry.player.setLoopStationMode(entry.state.loopStationMode, masterBus.clock);
            }

            const active = instanceManager.getActive();
            if (active) {
                sampleNameEl.textContent = sampleLabel(active.state);
                sampleSelect.value = active.state.sampleUrl || '';
                applyLoopStationUI(active.state.loopStationMode);
                transport.setHasRecording(active.recorder.getRecording().length > 0);
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
    const session = serializeSession(instanceManager, params, getMasterBpm(), parseFloat(masterVolumeSlider.value), getLoopStationState());
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
        masterBus.clock.bpm = importedBpm;

        // Restore master volume from imported session
        const importedMasterVol = validation.data.masterVolume ?? 0.7;
        masterVolumeSlider.value = importedMasterVol;
        masterVolumeDisplay.textContent = importedMasterVol.toFixed(2);
        masterBus.setMasterVolume(importedMasterVol);

        await instanceManager.restoreFromSession(validation.data, restoreSampleForInstance);
        tabBar.render(instanceManager.getTabList());

        // Restore global state (time signature, metronome)
        restoreLoopStationState(validation.data);

        // Apply per-instance loop station mode to all restored players
        for (const [, entry] of instanceManager.instances) {
            entry.player.setLoopStationMode(entry.state.loopStationMode, masterBus.clock);
        }

        const active = instanceManager.getActive();
        if (active) {
            sampleNameEl.textContent = sampleLabel(active.state);
            sampleSelect.value = active.state.sampleUrl || '';
            applyLoopStationUI(active.state.loopStationMode);
            transport.setHasRecording(active.recorder.getRecording().length > 0);
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

// --- Backgrounded tab: silence live voices ---
// Grain production runs on setTimeout, which survives a hidden tab. Pointer
// voices have no recorded stop event to end them, so without this they drone
// until the tab is focused again. Automation playback is left running — it is
// transport-driven and now delivers its own stops (Player uses setTimeout).
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    for (const [, entry] of instanceManager.instances) {
        for (const [pointerId] of pointer.pointers) {
            entry.engine.stopVoice(pointerId);
        }
    }
    pointer.pointers.clear();
    pointer._fading = [];
    params.hideGestureIndicators();
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

/**
 * Report whether a gesture dimension is real on this device.
 * Stays at "checking…" until the pad has actually been touched, because until
 * then neither answer is known; after that it commits either way.
 * @param {HTMLElement} el
 * @param {boolean} supported
 */
function setGestureStatus(el, supported) {
    if (!el) return;
    const touched = pointer.hasSeenPointer || pointer.pointers.size > 0;
    const text = !touched ? 'checking…' : (supported ? 'supported' : 'not on this device');
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('active', touched && supported);
}

/**
 * Keep the pad legend honest. Y sets pitch only while Randomize (pitch) is off —
 * with it on, Voice picks each grain's note from a table and the Y axis is
 * ignored, so a permanent "Pitch +/-2 oct" is a promise the instrument stops
 * keeping the moment that switch is flipped.
 */
function updatePadLegend() {
    const el = document.getElementById('pad-legend-pitch');
    if (!el) return;
    const random = params.getMusicalParams().randomPitch;
    const text = random ? 'Pitch set by Randomize' : 'Pitch ±2 oct';
    if (el.textContent !== text) el.textContent = text;
}

function updateGestureMeters() {
    const live = pointer.liveGesture;
    const caps = pointer.capabilities;
    const hasPointers = pointer.pointers.size > 0;

    // Two states, two words, and BOTH reachable. Previously this only ever wrote
    // in the supported direction, so on a mouse-only laptop the badge sat on its
    // initial string for ever — telling the user to run a test whose failure
    // state was indistinguishable from not having run it. Once the pad has been
    // touched, absence of the capability is a real answer and gets said.
    gestureMeterEls.pressure.style.width = hasPointers ? `${live.pressure * 100}%` : '0%';
    setGestureStatus(gestureStatusEls.pressure, caps.pressure);

    gestureMeterEls.contactSize.style.width = hasPointers ? `${live.contactSize * 100}%` : '0%';
    setGestureStatus(gestureStatusEls.contactSize, caps.contactSize);
    // Velocity too. Its badge was hardcoded to "supported" in the HTML and its
    // JS handle never used, so it read as an earned answer in accent while the
    // two rows above it still said "checking…" — three rows, two epistemic
    // states, only one of them actually established.
    setGestureStatus(gestureStatusEls.velocity, caps.velocity);

    gestureMeterEls.velocity.style.width = hasPointers ? `${live.velocity * 100}%` : '0%';
}

// --- Transport controls ---

const transport = new TransportBar({
    recordBtn:   document.getElementById('btn-record'),
    overdubBtn:  document.getElementById('btn-overdub'),
    playBtn:     document.getElementById('btn-play'),
    stopBtn:     document.getElementById('btn-stop'),
    loopBtn:     document.getElementById('btn-loop'),
    timeDisplay: document.getElementById('time-display'),
    progressBar: document.getElementById('transport-progress-fill'),
});

/**
 * Begin fixed-length recording after count-in completes.
 * @private
 */
function beginFixedRecording(atTime) {
    const stillActive = instanceManager.getActive();
    if (!stillActive || transport.state !== 'count-in') return;

    const barCount = stillActive.state.recordBarCount || 4;
    fixedRecordDuration = barCount * masterBus.clock.getBarDuration();

    stillActive.recorder.startRecording(atTime);
    stillActive.ghostRenderer.recording = true;
    transport.setState('recording');
    transport.clearSpecialDisplay();
}

/**
 * Finish recording: stop, set loop range, auto-play in loop station mode.
 * Called on auto-stop (fixed duration) or manual early stop.
 * @param {Object} active - The active instance entry
 * @private
 */
function finishRecording(active) {
    active.recorder.stopRecording();
    active.ghostRenderer.recording = false;
    recorderPointerMap.clear();

    // Use fixed duration for loop range (or snap to bar for free-form)
    if (active.state.loopStationMode) {
        const bars = fixedRecordDuration
            ? (active.state.recordBarCount || 4)
            : Math.max(1, Math.round(active.recorder.getElapsedTime() / masterBus.clock.getBarDuration()));
        // Musical, not seconds: a later tempo change must retime the loop rather
        // than cut its tail off.
        active.player.setLoopBars(0, bars);
        // The take's total length — the STABLE denominator loop-handle fractions
        // convert against. Distinct from the loop window itself, which narrows
        // as the handles are dragged.
        active.player.setTakeBars(bars);
        transport.setLoopRange(0, 1);
    }

    // Keep metronome running for playback if enabled; otherwise stop the timing-only instance
    if (!metronomeEnabled && masterBus.metronome.running) {
        masterBus.metronome.stop();
    }
    transport.clearBeatIndicator();
    transport.clearSpecialDisplay();
    fixedRecordDuration = null;

    transport.setState('idle');
    transport.setHasRecording(active.recorder.getRecording().length > 0);

    // Auto-play the recorded loop in loop station mode
    if (active.state.loopStationMode && active.recorder.getRecording().length > 0) {
        transport.looping = true;
        active.ghostRenderer.active = true;
        const lane = active.recorder.getRecording();
        active.player.play(lane, true);
        transport.setState('playing');
        if (metronomeEnabled && !masterBus.metronome.running) {
            masterBus.clock.ensureEpoch();
            masterBus.metronome.start();
        }
    }
}

/**
 * Cancel arm or count-in state and return to idle.
 * @private
 */
function cancelRecordArm() {
    masterBus.metronome.setMuted(false); // Reverse muted state from count-in
    if (masterBus.metronome.running && !metronomeEnabled) {
        masterBus.metronome.stop();
    }
    transport.clearBeatIndicator();
    transport.clearSpecialDisplay();
    fixedRecordDuration = null;
    transport.setState('idle');
    const active = instanceManager.getActive();
    if (active) transport.setHasRecording(active.recorder.getRecording().length > 0);
}

transport.onRecord = () => {
    const active = instanceManager.getActive();
    if (!active) return;

    if (active.recorder.isRecording) {
        // Stop recording (early stop or manual)
        finishRecording(active);
    } else if (transport.state === 'armed' || transport.state === 'count-in') {
        // Cancel arm or count-in
        cancelRecordArm();
    } else {
        // Start recording flow
        if (active.player.isPlaying) active.player.stop();

        // A previous take's loop range would otherwise still be in force.
        active.player.setLoopBars(0, 0);
        active.player.setLoopRange(0, 0);
        active.player.setTakeBars(0);
        transport.resetLoopRange();

        if (active.state.loopStationMode) {
            // Always count-in in loop station mode
            masterBus.resume();
            transport.setState('count-in');

            if (!metronomeEnabled) {
                // Start metronome muted for timing-only count-in
                masterBus.metronome.setMuted(true);
                masterBus.metronome.startCountIn((at) => {
                    masterBus.metronome.setMuted(false);
                    beginFixedRecording(at);
                });
            } else {
                masterBus.metronome.startCountIn((at) => beginFixedRecording(at));
            }
        } else {
            // Free-form mode: traditional arm (start on first touch)
            transport.setState('armed');
        }
    }
};

transport.onPlay = () => {
    const active = instanceManager.getActive();
    if (!active || active.recorder.isRecording) return;
    const lane = active.recorder.getRecording();
    if (lane.length === 0) return;
    masterBus.resume();
    // In loop station mode, always play with loop enabled
    if (active.state.loopStationMode) transport.looping = true;
    active.ghostRenderer.active = true;
    active.player.play(lane, transport.looping);
    transport.setState('playing');
    // Start metronome during playback if enabled
    if (metronomeEnabled && active.state.loopStationMode && !masterBus.metronome.running) {
        masterBus.clock.ensureEpoch();
        masterBus.metronome.start();
    }
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
    if (active) {
        active.ghostRenderer.clear();
        active.ghostRenderer.recording = false;
    }
    // Stop metronome unless the toggle is on (free-running metronome)
    if (masterBus.metronome.running && !metronomeEnabled) {
        masterBus.metronome.stop();
        transport.clearBeatIndicator();
    }
    fixedRecordDuration = null;
    transport.clearSpecialDisplay();
    transport.setState('idle');
    transport.setHasRecording(active?.recorder.getRecording().length > 0);
    transport.setProgress(0);
};

transport.onLoopToggle = (looping) => {
    const active = instanceManager.getActive();
    if (active?.player) active.player.setLoop(looping);
};

transport.onOverdub = () => {
    const active = instanceManager.getActive();
    if (!active) return;
    // Refuse only the states where overdub genuinely cannot start. The old guard
    // allowed ONLY 'playing' and 'overdubbing' — but TransportBar enables this
    // button at idle whenever a recording exists, so pressing it there was a lit,
    // hover-highlighted, 44px no-op. Starting playback first is what the user
    // meant, and the branch below already does it.
    if (transport.state === 'recording' || transport.state === 'count-in'
        || transport.state === 'armed') return;
    if (!active.recorder.getRecording().length) return;

    if (active.recorder.isOverdubbing) {
        // Stop overdub — merge happens inside stopRecording()
        active.recorder.stopRecording();
        active.ghostRenderer.recording = false;
        recorderPointerMap.clear();
        // Keep playing after overdub stops
        transport.setState('playing');
        transport.setHasRecording(true);
    } else {
        // Start overdub — requires an existing recording
        const lane = active.recorder.getRecording();
        if (lane.length === 0) return;
        masterBus.resume();

        // If not already playing, start playback
        if (!active.player.isPlaying) {
            if (active.state.loopStationMode) transport.looping = true;
            active.ghostRenderer.active = true;
            active.player.play(lane, transport.looping);
        }

        // Start overdub recording aligned to playback start time
        active.recorder.startOverdub(active.player._startTime);
        active.ghostRenderer.recording = true;
        transport.setState('overdubbing');

        // Start metronome if enabled in loop station mode
        if (metronomeEnabled && active.state.loopStationMode && !masterBus.metronome.running) {
            masterBus.clock.ensureEpoch();
            masterBus.metronome.start();
        }
    }
};

// --- Loop snap-to-grid toggle ---
let loopSnapToGrid = false;
// --- Undo ---
// The recorder could already undo, but only from Ctrl+Z — which does not exist
// on a tablet, the device this instrument is built for. Recording over a
// multi-pass loop is the most destructive thing the transport does and it had no
// reachable way back.
const undoBtn = document.getElementById('btn-undo');

/**
 * Keep the tabs' playing/recording dots current.
 *
 * tabBar.render() only runs on add, remove, rename and switch, so dots rendered
 * from it would show whatever was true the last time a tab was created — exactly
 * wrong for a state that changes on every transport press. Rather than re-render
 * the strip every frame (it rebuilds every button, which would fight focus and
 * any in-flight rename), this toggles the two classes in place and only when the
 * answer has changed.
 */
let _tabActivity = '';
function refreshTabActivity() {
    const tabs = instanceManager.getTabList();
    const signature = tabs.map(t => `${t.id}:${t.isRecording ? 'r' : t.isPlaying ? 'p' : '-'}`).join('|');
    if (signature === _tabActivity) return;
    _tabActivity = signature;
    tabBar.render(tabs);
}

/**
 * Enable Undo only when there is something to go back to and it is safe.
 * Driven from the render loop rather than from each of the six places that can
 * change the answer (finish a take, stop, overdub, switch tab, restore a
 * session, undo itself) — enumerating those is how one gets missed and the
 * button goes stale. The write is guarded so it only touches the DOM on a real
 * change.
 */
function refreshUndoButton() {
    const active = instanceManager.getActive();
    const disabled = !active?.recorder.canUndo
        || active.recorder.isRecording
        || active.player.isPlaying;
    if (undoBtn.disabled !== disabled) undoBtn.disabled = disabled;
}

function performUndo() {
    const active = instanceManager.getActive();
    if (!active || !active.recorder.canUndo) return;
    // Not mid-take and not mid-playback: swapping the lane underneath either one
    // would leave the Player dispatching from a lane that no longer exists.
    if (active.recorder.isRecording || active.player.isPlaying) return;
    active.recorder.undo();
    transport.setHasRecording(active.recorder.getRecording().length > 0);
    refreshUndoButton();
    showNotification('Undid last take');
}

undoBtn.addEventListener('click', performUndo);

const snapBtn = document.getElementById('btn-snap-grid');
snapBtn.addEventListener('click', () => {
    loopSnapToGrid = !loopSnapToGrid;
    snapBtn.classList.toggle('snap-active', loopSnapToGrid);
});

// --- Loop station mode toggle (per-tab) ---
const loopStationBtn = document.getElementById('btn-loop-station');
const loopBtn = document.getElementById('btn-loop');

/**
 * Update UI to reflect the active tab's loop station mode.
 * Forces loop ON and snap locked when in loop station mode.
 * @param {boolean} enabled
 */
// --- Bar-count selector (fixed-length recording in loop station mode) ---
const barCountSelector = document.getElementById('bar-count-selector');
const barCountBtns = barCountSelector.querySelectorAll('.bar-count-btn');

barCountBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const active = instanceManager.getActive();
        if (!active) return;
        const bars = parseInt(btn.dataset.bars, 10);
        active.state.recordBarCount = bars;
        barCountBtns.forEach(b => b.classList.toggle('active', b === btn));
        if (persistence) persistence.scheduleSave();
    });
});

function applyLoopStationUI(enabled) {
    loopStationBtn.classList.toggle('active', enabled);
    barCountSelector.classList.toggle('visible', enabled);

    if (enabled) {
        // Sync bar-count selector to current instance
        const active = instanceManager.getActive();
        const count = active?.state.recordBarCount ?? 4;
        barCountBtns.forEach(b =>
            b.classList.toggle('active', parseInt(b.dataset.bars, 10) === count)
        );

        // Force loop ON and lock the button
        transport.looping = true;
        transport._updateLoopVisual();
        loopBtn.disabled = true;
        loopBtn.title = 'Looping is on and locked by loop station mode';

        // Force snap on AND say so. The button was disabled and left showing its
        // OFF state while snapping was in force — the control lying about the
        // thing it exists to report. (.snap-forced was also dead: main.js sets
        // the real disabled attribute, and #transport-bar button:disabled
        // outranks a bare class.)
        loopSnapToGrid = true;
        snapBtn.disabled = true;
        snapBtn.classList.add('snap-active');
        snapBtn.title = 'Snap is on and locked by loop station mode';
    } else {
        // Unlock loop button
        loopBtn.title = 'Loop';
        transport._updateButtons(); // re-evaluates disabled state

        // Unlock snap, and restore the visual to whatever the user last chose
        // rather than leaving it stuck on from the forced state.
        snapBtn.disabled = false;
        snapBtn.classList.toggle('snap-active', loopSnapToGrid);
        snapBtn.title = 'Snap loop to BPM grid';
    }
}

loopStationBtn.addEventListener('click', () => {
    const active = instanceManager.getActive();
    if (!active) return;
    active.state.loopStationMode = !active.state.loopStationMode;
    active.player.setLoopStationMode(active.state.loopStationMode, masterBus.clock);
    applyLoopStationUI(active.state.loopStationMode);
    if (persistence) persistence.scheduleSave();
});

// Apply initial loop station UI for the active tab (handles default session + async restore)
{
    const active = instanceManager.getActive();
    if (active) {
        active.player.setLoopStationMode(active.state.loopStationMode, masterBus.clock);
        applyLoopStationUI(active.state.loopStationMode);
    }
}

// --- Time signature controls ---
const timeSigNum = document.getElementById('time-sig-num');
const timeSigDen = document.getElementById('time-sig-den');

timeSigNum.addEventListener('change', () => {
    const num = parseInt(timeSigNum.value, 10);
    masterBus.clock.numerator = num;
    transport.updateBeatIndicator(num);
    if (persistence) persistence.scheduleSave();
});

timeSigDen.addEventListener('change', () => {
    masterBus.clock.denominator = parseInt(timeSigDen.value, 10);
    if (persistence) persistence.scheduleSave();
});

// Initialize beat indicator with default time signature
transport.updateBeatIndicator(masterBus.clock.numerator);

// --- Metronome controls ---
let metronomeEnabled = false;
const metronomeBtn = document.getElementById('btn-metronome');
const metronomeVolSlider = document.getElementById('metronome-volume');

metronomeBtn.addEventListener('click', () => {
    metronomeEnabled = !metronomeEnabled;
    metronomeBtn.classList.toggle('active', metronomeEnabled);
    if (metronomeEnabled) {
        masterBus.resume();
        if (!masterBus.metronome.running) {
            masterBus.clock.ensureEpoch();
            masterBus.metronome.start();
        }
    } else {
        // Only stop metronome if not currently recording or in count-in
        if (transport.state !== 'recording' && transport.state !== 'count-in') {
            masterBus.metronome.stop();
            transport.clearBeatIndicator();
        }
    }
    if (persistence) persistence.scheduleSave();
});

metronomeVolSlider.addEventListener('input', () => {
    masterBus.metronome.setVolume(parseFloat(metronomeVolSlider.value));
    if (persistence) persistence.scheduleSave();
});

// Visual beat callback (extended for count-in countdown)
masterBus.metronome.onBeat = (beatIndex, isDownbeat) => {
    transport.highlightBeat(beatIndex);

    // During count-in, show beats-left countdown in the time display
    if (transport.state === 'count-in') {
        const numBeats = masterBus.clock.numerator;
        const beatsLeft = numBeats - beatIndex;
        transport.setCountInDisplay(beatsLeft);
    }
};

/**
 * Resolve the take's total length in bars — the STABLE denominator loop-handle
 * fractions must be converted against in loop-station mode. Prefers
 * Player.getTakeBars() (set once in finishRecording / restored from session);
 * falls back to the current loop window's own span, then to the loop-window
 * duration, only for instances that predate getTakeBars() being set.
 * @private
 */
function resolveTakeBars(active) {
    const takeBars = active.player.getTakeBars();
    if (takeBars) return takeBars;
    const bars = active.player.getLoopBars();
    if (bars) return bars.startBars + bars.lengthBars;
    const barDur = masterBus.clock.getBarDuration();
    const duration = active.player.getLoopableDuration() || active.recorder.getElapsedTime();
    return Math.max(1, Math.round(duration / barDur));
}

// resolveTakeDuration — the STABLE seconds denominator the loop handles map onto,
// and the one the tab-switch redisplay must invert through — now lives in
// utils/loopHandleMath.js, next to the conversions it feeds and, unlike this
// file, reachable from the test suite. Its comment there carries the reasoning:
// the recorded lane's own duration, never getLoopableDuration(), which reports
// the current loop WINDOW that the drag overwrites on every pointermove.

transport.onLoopRangeChange = (startFrac, endFrac) => {
    const active = instanceManager.getActive();
    if (!active?.player) return;

    if (active.state.loopStationMode) {
        // Bar-quantized: convert fractions to whole bars against the take's
        // STABLE total length, never the current (possibly already-narrowed)
        // loop window — see loopHandleMath.js for why that distinction matters.
        const totalBars = resolveTakeBars(active);
        const { startBar, lengthBars } = fractionsToBarLoop(startFrac, endFrac, totalBars);
        active.player.setLoopBars(startBar, lengthBars);
        const snapped = barLoopToFractions(startBar, lengthBars, totalBars);
        transport.setLoopRange(snapped.startFrac, snapped.endFrac);
        return;
    }

    // Map onto the take's STABLE length. The bar-quantized objection that used to
    // sit here — that Recorder.getElapsedTime() stops at the last event, short of
    // the bar line — applies to a MUSICAL loop, and musical loops now leave
    // through the branch above. What is left here is a plain seconds take whose
    // length simply is its lane's duration; and unlike getLoopableDuration() it is
    // not the value setLoopRange() below overwrites, so it cannot feed itself.
    const duration = resolveTakeDuration(active.player, active.recorder);
    if (duration <= 0) return;

    let { loopStart, loopEnd } = fractionsToSecondsLoop(startFrac, endFrac, duration);

    if (loopSnapToGrid) {
        const bpm = getMasterBpm();
        loopStart = quantizeTimeToGrid(loopStart, bpm);
        loopEnd = quantizeTimeToGrid(loopEnd, bpm);
        if (loopEnd <= loopStart) loopEnd = loopStart + (60 / bpm);
        // Same denominator, and clamped: the beat-length floor above can push
        // loopEnd past the take, which would drive the handle off the bar.
        const snapped = secondsLoopToFractions(loopStart, loopEnd, duration);
        transport.setLoopRange(snapped.startFrac, snapped.endFrac);
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
    // Ctrl/Cmd+Z: the same path as the button, so the two cannot drift apart.
    // `e.key === 'z'` missed with CapsLock on, where the key reports as 'Z'.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        performUndo();
    }
});

// --- Player callbacks routed through InstanceManager ---

instanceManager.onPlayerFrame = (elapsed, progress) => {
    transport.setTime(elapsed);
    transport.setProgress(progress);
};

instanceManager.onPlayerComplete = () => {
    const active = instanceManager.getActive();
    // If overdubbing when playback ends, stop the overdub (merge)
    if (active?.recorder.isOverdubbing) {
        active.recorder.stopRecording();
        active.ghostRenderer.recording = false;
        recorderPointerMap.clear();
    }
    transport.setState('idle');
    transport.setHasRecording(true);
    transport.setProgress(0);
    if (active) transport.setTime(active.recorder.getRecording().getDuration());
};

/**
 * Loop-station overdub auto-commit: at each loop boundary, merge the overdub
 * into the main lane so the new content plays on the next iteration.
 * Then start a fresh overdub pass so the user can keep layering.
 */
instanceManager.onPlayerLoopWrap = (instanceId) => {
    const inst = instanceManager.instances.get(instanceId);
    if (!inst || !inst.recorder.isOverdubbing) return;

    // 1. Commit current overdub (merge into main lane)
    inst.recorder.stopRecording();

    // 2. Hot-swap the player's lane so the merged content plays immediately
    inst.player.setLane(inst.recorder.getRecording());

    // 3. Start a fresh overdub pass for continuous layering
    inst.recorder.startOverdub(inst.player._startTime);

    // 4. Persist the merged state
    if (persistence) persistence.scheduleSave();
};

// --- Render loop ---

function render() {
    waveform.draw();

    // Grain overlay and ghost visualization for the active instance
    const active = instanceManager.getActive();
    if (active) {
        active.ghostRenderer.draw(waveform.ctx, canvas.width, canvas.height);
        active.grainOverlay.draw(waveform.ctx, canvas.width, canvas.height, masterBus.audioContext.currentTime);
    }

    pointer.drawIndicator(waveform.ctx, canvas.width, canvas.height);
    levelMeter.update();
    updateGestureMeters();
    params.updateRandomIndicators(params.getMusicalParams());
    params.updateParamRelevance();
    updatePadLegend();
    refreshUndoButton();
    refreshTabActivity();

    // Update transport display during recording
    if (active?.recorder.isRecording) {
        const elapsed = active.recorder.getElapsedTime();

        if (fixedRecordDuration !== null) {
            // Fixed-length recording: show bar progress and auto-stop
            const barDur = masterBus.clock.getBarDuration();
            const totalBars = active.state.recordBarCount || 4;
            const currentBar = Math.min(Math.floor(elapsed / barDur) + 1, totalBars);
            transport.setBarProgressDisplay(currentBar, totalBars);
            transport.setRecordingProgress(elapsed / fixedRecordDuration);

            // Auto-stop when target duration reached
            if (elapsed >= fixedRecordDuration) {
                finishRecording(active);
            }
        } else {
            // Free-form recording: show elapsed time
            transport.setTime(elapsed);
        }
    }

    requestAnimationFrame(render);
}

requestAnimationFrame(render);
