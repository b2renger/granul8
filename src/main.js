// main.js — Entry point, wires everything together

import { GranularEngine } from './audio/GranularEngine.js';
import { WaveformDisplay } from './ui/WaveformDisplay.js';
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
async function loadDemoSample() {
    try {
        const buffer = await engine.loadSample('samples/texture_pad.wav');
        waveform.setBuffer(buffer);
        sampleNameEl.textContent = 'texture_pad.wav';
        console.log(`Demo loaded: ${buffer.duration.toFixed(2)}s, ${buffer.sampleRate}Hz`);
    } catch (err) {
        // No demo sample available — that's fine, user will load their own
        console.log('No demo sample found at samples/texture_pad.wav — drag or pick an audio file.');
    }
}

loadDemoSample();

// --- Helper: read current global params from sliders ---

function getSliderParams() {
    return {
        grainSize: parseFloat(document.getElementById('param-grain-size').value) / 1000,
        interOnset: parseFloat(document.getElementById('param-density').value) / 1000,
        pitch: parseFloat(document.getElementById('param-pitch').value),
        spread: parseFloat(document.getElementById('param-spread').value),
        pan: parseFloat(document.getElementById('param-pan').value),
        envelope: document.getElementById('param-envelope').value,
    };
}

// --- Parameter sliders ---

const paramSliders = [
    { id: 'param-grain-size', valId: 'val-grain-size', format: v => `${v} ms` },
    { id: 'param-density', valId: 'val-density', format: v => `${v} ms` },
    { id: 'param-pitch', valId: 'val-pitch', format: v => parseFloat(v).toFixed(2) },
    { id: 'param-spread', valId: 'val-spread', format: v => parseFloat(v).toFixed(2) },
    { id: 'param-pan', valId: 'val-pan', format: v => parseFloat(v).toFixed(2) },
    { id: 'param-volume', valId: 'val-volume', format: v => parseFloat(v).toFixed(2) },
];

for (const { id, valId, format } of paramSliders) {
    const slider = document.getElementById(id);
    const display = document.getElementById(valId);
    slider.addEventListener('input', () => {
        display.textContent = format(slider.value);

        // Master volume is wired directly to the engine
        if (id === 'param-volume') {
            engine.setMasterVolume(parseFloat(slider.value));
        }

        // Forward slider changes to active voice in real time
        engine.updateVoice(getSliderParams());
    });
}

// --- Pointer interaction: pointerdown/move/up → voice start/update/stop ---
// Single pointer for now (Phase 2 adds multi-touch via VoiceAllocator)

canvas.addEventListener('pointerdown', (e) => {
    if (!engine.sourceBuffer) return;

    engine.resume();
    canvas.setPointerCapture(e.pointerId);

    const rect = canvas.getBoundingClientRect();
    const position = (e.clientX - rect.left) / rect.width;
    const amplitude = (e.clientY - rect.top) / rect.height; // push down = louder

    engine.startVoice({
        position,
        amplitude,
        ...getSliderParams(),
    });
});

canvas.addEventListener('pointermove', (e) => {
    if (!canvas.hasPointerCapture(e.pointerId)) return;

    const rect = canvas.getBoundingClientRect();
    const position = (e.clientX - rect.left) / rect.width;
    const amplitude = (e.clientY - rect.top) / rect.height;

    engine.updateVoice({ position, amplitude });
});

canvas.addEventListener('pointerup', (e) => {
    engine.stopVoice();
});

canvas.addEventListener('pointercancel', (e) => {
    engine.stopVoice();
});

// --- Render loop ---

function render() {
    // Waveform draws its own background + cached waveform image
    waveform.draw();

    // TODO (Step 1.9): draw grain overlay
    // TODO (Step 1.7): draw pointer indicators

    requestAnimationFrame(render);
}

requestAnimationFrame(render);
