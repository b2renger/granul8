// main.js — Entry point, wires everything together

import { GranularEngine } from './audio/GranularEngine.js';
import { WaveformDisplay } from './ui/WaveformDisplay.js';
import { GrainOverlay } from './ui/GrainOverlay.js';
import { ParameterPanel } from './ui/ParameterPanel.js';
import { PointerHandler } from './input/PointerHandler.js';
import { setupDragAndDrop, setupFilePicker } from './utils/fileLoader.js';

// --- DOM references ---

const canvas = document.getElementById('waveform-canvas');
const container = document.getElementById('waveform-container');
const loadBtn = document.getElementById('load-sample-btn');
const fileInput = document.getElementById('file-input');
const sampleNameEl = document.getElementById('sample-name');
const dropOverlay = document.getElementById('drop-overlay');

// --- Engine ---

const engine = new GranularEngine();

// --- Grain overlay (visualization of individual grains) ---

const grainOverlay = new GrainOverlay();
engine.onGrain = (info) => grainOverlay.addGrain(info);

// --- Waveform display ---

const waveform = new WaveformDisplay(canvas);

// --- iOS / Safari audio unlock ---
// Resume AudioContext on first user gesture if suspended

document.addEventListener('pointerdown', function unlock() {
    engine.resume();
    document.removeEventListener('pointerdown', unlock);
}, { once: true });

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

// Auto-load demo sample (if available)
const DEMO_SAMPLE_PATH = 'samples/Soni_Ventorum_Wind_Quintet_-_08_-_Danzi_Wind_Quintet_Op_67_No_3_In_E-Flat_Major_4_Allegretto.mp3';
const DEMO_SAMPLE_NAME = 'Danzi Wind Quintet Op.67 No.3 — Allegretto';

async function loadDemoSample() {
    try {
        const buffer = await engine.loadSample(DEMO_SAMPLE_PATH);
        waveform.setBuffer(buffer);
        sampleNameEl.textContent = DEMO_SAMPLE_NAME;
        console.log(`Demo loaded: ${buffer.duration.toFixed(2)}s, ${buffer.sampleRate}Hz`);
    } catch (err) {
        // No demo sample available — that's fine, user will load their own
        console.log('No demo sample found — drag or pick an audio file.');
    }
}

loadDemoSample();

// --- Parameter panel ---

const params = new ParameterPanel(document.getElementById('parameter-panel'), {
    onChange(p) { engine.updateVoice(p); },
    onVolumeChange(v) { engine.setMasterVolume(v); },
});

// --- Pointer interaction via PointerHandler ---
// Single pointer for now (Phase 2 adds multi-touch via VoiceAllocator)

/** Convert normalized Y (0=top, 1=bottom) to playback rate via octaves. */
function yToPitch(y) {
    // top → +2 octaves (4×), center → 0 (1×), bottom → −2 octaves (0.25×)
    const octaves = 2 - 4 * y;
    return Math.pow(2, octaves);
}

const pointer = new PointerHandler(canvas, {
    onStart({ position, amplitude: y }) {
        if (!engine.sourceBuffer) return;
        engine.resume();
        engine.startVoice({ position, pitch: yToPitch(y), amplitude: 0.8, ...params.getParams() });
    },
    onMove({ position, amplitude: y }) {
        engine.updateVoice({ position, pitch: yToPitch(y) });
    },
    onStop() {
        engine.stopVoice();
    },
});

// --- Render loop ---

function render() {
    // Waveform draws its own background + cached waveform image
    waveform.draw();

    // Grain overlay (fading rectangles showing individual grains)
    grainOverlay.draw(waveform.ctx, canvas.width, canvas.height, engine.audioContext.currentTime);

    // Pointer indicator (circle + vertical line at touch/click position)
    pointer.drawIndicator(waveform.ctx, canvas.width, canvas.height);

    requestAnimationFrame(render);
}

requestAnimationFrame(render);
