# CLAUDE.md — Web Audio Granular Sampler

## Project Summary

A browser-based multi-touch granular sampler built with **zero dependencies** — vanilla JS, native ES modules, Web Audio API, Canvas 2D, and Pointer Events. No React, no framework, no bundler, no build step, no npm.

The project is a folder of `.html`, `.css`, `.js`, and `.wav` files served by any static file server.

---

## Constraints

- **No build system**: no Vite, no Webpack, no Rollup, no npm, no `package.json`, no `node_modules`.
- **No framework**: no React, no Vue, no Svelte, no p5.js, no Three.js.
- **No external runtime dependencies**: everything uses browser-native APIs.
- **ES Modules only**: all imports use relative paths with explicit `.js` extensions (`import { Voice } from './audio/Voice.js'`).
- **Single `index.html`** entry point with `<script type="module" src="src/main.js"></script>`.
- **Local dev**: serve with `python3 -m http.server 8000` or any static server (required for ES modules and `fetch()`).

---

## Folder Structure

```
granular-sampler/
├── index.html
├── style.css
├── src/
│   ├── main.js                 # Entry point, wires everything together
│   ├── audio/
│   │   ├── GranularEngine.js   # Top-level: AudioContext, master bus, limiter, voice pool
│   │   ├── Voice.js            # One independent grain stream with its own gain/pan
│   │   ├── GrainScheduler.js   # Look-ahead timer that spawns grains on schedule
│   │   ├── grainFactory.js     # Creates a single grain (BufferSource + GainNode envelope)
│   │   └── envelopes.js        # Window functions: Hann, Tukey, Triangle
│   ├── ui/
│   │   ├── WaveformDisplay.js  # Canvas waveform renderer (cached offscreen)
│   │   ├── GrainOverlay.js     # Draws recent grains as fading rectangles on the waveform
│   │   ├── ParameterPanel.js   # HTML range sliders for grain size, density, pitch, etc.
│   │   └── TransportBar.js     # Record / Play / Stop / Loop buttons
│   ├── input/
│   │   ├── PointerHandler.js   # pointerdown/move/up → voice start/update/stop
│   │   └── VoiceAllocator.js   # Maps pointerId → free Voice from pool
│   ├── automation/
│   │   ├── Recorder.js         # Captures pointer events as timestamped automation data
│   │   ├── Player.js           # Replays automation events through the engine
│   │   └── AutomationLane.js   # Data model: array of {time, voiceIndex, type, params}
│   └── utils/
│       ├── math.js             # clamp, mapRange, lerp
│       └── fileLoader.js       # Drag-and-drop + file picker → AudioBuffer
├── samples/
│   └── texture_pad.wav         # Bundled demo sample (5-10s, sustained, harmonically rich)
└── CLAUDE.md                   # This file
```

---

## Audio Engine Architecture

### Signal Flow

```
[Source AudioBuffer]
        │
        ▼
  GrainScheduler (per voice)
  creates grains at inter-onset intervals
        │
        ▼
  For each grain:
    AudioBufferSourceNode
        → GainNode (Hann envelope via setValueCurveAtTime)
        → StereoPannerNode (optional, if pan ≠ 0)
        → Voice GainNode (per-voice level)
        │
        ▼  (× N active voices)
  Master GainNode (master volume)
        │
        ▼
  DynamicsCompressorNode (brickwall limiter)
        │
        ▼
  AnalyserNode (for visualization)
        │
        ▼
  AudioContext.destination
```

### Grain Creation (`grainFactory.js`)

Each grain is ephemeral — fire-and-forget nodes that self-destruct after playback:

1. Create `AudioBufferSourceNode`, set `buffer` and `playbackRate`.
2. Create `GainNode`, apply Hann envelope curve via `gain.setValueCurveAtTime(curve, when, duration)`.
3. Optionally create `StereoPannerNode`.
4. Connect chain: source → gain → (pan) → voice destination.
5. `source.start(when, offset, duration)` and `source.stop(when + duration)`.
6. No cleanup needed — nodes are garbage collected after they finish.

### Grain Envelope (`envelopes.js`)

Default is **Hann window** (raised cosine):
```
w(t) = 0.5 * (1 - cos(2πt / N))
```
Returns a `Float32Array` of the specified length. Pre-cache common lengths (64, 128, 256) to avoid allocating every grain.

Also implement Tukey (tapered cosine with configurable flat ratio) and Triangle.

### Look-Ahead Scheduling (`GrainScheduler.js`)

A `setTimeout` loop runs every **25ms** and schedules grains up to **100ms** into the future using `audioContext.currentTime`. This decouples JS timer jitter from audio precision:

```
_tick():
  while nextGrainTime < audioContext.currentTime + scheduleAhead:
    call onScheduleGrain(nextGrainTime)
    nextGrainTime += interOnsetTime
  setTimeout(_tick, timerInterval)
```

### Anti-Clipping (4 layers)

1. **Per-grain**: scale amplitude by `1 / sqrt(activeGrainCount)`.
2. **Per-voice**: `GainNode` at conservative level (0.3–0.5), adjusted dynamically with `1 / sqrt(activeVoiceCount)`.
3. **Master limiter**: `DynamicsCompressorNode` configured as brickwall:
   - threshold: -3 dB
   - knee: 0
   - ratio: 20
   - attack: 0.001s
   - release: 0.05s
4. **Optional soft clip**: `WaveShaperNode` with `tanh` curve before destination.

---

## Grain Parameters

| Parameter | Range | Maps To |
|---|---|---|
| **Position** | 0.0 – 1.0 | Where in the buffer the grain starts (X-axis on waveform) |
| **Amplitude** | 0.0 – 1.0 | Peak grain amplitude (Y-axis on waveform) |
| **Grain Size** | 1 – 500 ms | Duration of each grain |
| **Density / Inter-onset** | 5 – 200 ms | Time between successive grain starts |
| **Pitch** | 0.25 – 4.0 | `playbackRate` on `AudioBufferSourceNode` |
| **Spread** | 0.0 – 1.0 | Random offset added to position each grain |
| **Pan** | -1.0 – 1.0 | `StereoPannerNode` value |
| **Envelope** | Hann / Tukey / Triangle | Window function shape |
| **Master Volume** | 0.0 – 1.0 | Master `GainNode` level |

---

## Interaction Model

### XY Pad (waveform canvas)

- **X-axis → Position**: normalized 0–1 across the buffer.
- **Y-axis → Amplitude**: 0 at top, 1 at bottom (push down = louder).
- Each active pointer (finger/mouse) spawns an independent voice.

### Multi-Touch (Phase 2)

- Pointer Events API: `pointerdown`, `pointermove`, `pointerup`, `pointercancel`.
- `setPointerCapture(pointerId)` on the canvas for reliable tracking.
- `touch-action: none` in CSS to prevent browser scroll/zoom.
- `VoiceAllocator` maps `pointerId → Voice` from a pool of max 6.
- Extended dimensions (if device supports): pressure → amplitude multiplier, contact size → spread, movement speed → density modulation.

### iOS Audio Unlock

On first `pointerdown` anywhere, call `audioContext.resume()` if state is `'suspended'`.

---

## Waveform Rendering (`WaveformDisplay.js`)

- On sample load, compute min/max pairs per pixel column from the `AudioBuffer` channel data.
- Render to an **offscreen canvas** (cached). Recompute only on sample change or canvas resize.
- Each frame (`requestAnimationFrame`), composite:
  1. Cached waveform background.
  2. Vertical cursor lines at each active voice's grain position.
  3. Grain overlay: fading rectangles at recent grain positions (from `GrainOverlay.js`).
  4. Pointer indicators: colored circles at each active touch point.

---

## Automation System (Phase 3)

### Data Model (`AutomationLane.js`)

```javascript
// Single event
{
    time: number,           // seconds since recording start
    voiceIndex: number,     // 0-based voice slot
    type: 'start' | 'move' | 'stop',
    params: {
        position: number,
        amplitude: number,
        pitch: number,
        grainSize: number,
        spread: number,
        pan: number
    }
}
```

An `AutomationLane` is an array of these events sorted by time, with `toJSON()` / `fromJSON()` for save/load.

### Recording (`Recorder.js`)

- On Record: capture `audioContext.currentTime` as start reference.
- Each pointer event while recording → push an `AutomationEvent` with `time = now - startTime`.
- Throttle `pointermove` events to **30 per second per pointer**.
- Also capture global parameter changes as a `'param'` event type.

### Playback (`Player.js`)

- Uses `requestAnimationFrame` loop.
- Each frame, compute elapsed time, fetch events in range, dispatch to engine.
- Playback voices use synthetic pointer IDs (`1000 + voiceIndex`) to coexist with live touches.
- Supports loop mode (restart from 0 at end) and overdub (merge new events into existing lane).

### Ghost Visualization

- During playback, draw pointer circles and grain overlays at reduced opacity (40%) with dashed outlines.
- During recording, red tint on waveform background.

---

## Implementation Phases

### Phase 1 — Core Engine & Single Pointer (~3 weeks)

| Step | What | Key Files |
|---|---|---|
| 1.1 | Project scaffolding: `index.html`, `style.css`, folder structure, dark theme layout | `index.html`, `style.css` |
| 1.2 | AudioContext, sample loading (fetch + `decodeAudioData`), drag-and-drop, iOS unlock | `GranularEngine.js`, `fileLoader.js` |
| 1.3 | Waveform display: downsample to min/max, render to offscreen cache, resize handling | `WaveformDisplay.js` |
| 1.4 | Grain factory + envelopes: single grain with Hann window, click-free playback | `grainFactory.js`, `envelopes.js` |
| 1.5 | GrainScheduler (look-ahead loop) + Voice class: continuous grain stream | `GrainScheduler.js`, `Voice.js` |
| 1.6 | Anti-clipping chain: per-grain scaling, voice gain, DynamicsCompressor limiter | `GranularEngine.js` |
| 1.7 | Single pointer input: pointerdown/move/up → X=position, Y=amplitude | `PointerHandler.js`, `math.js` |
| 1.8 | Parameter sliders: grain size, density, pitch, spread, pan, volume, envelope select | `ParameterPanel.js` |
| 1.9 | Grain visualization: recent grains as fading rectangles on the waveform | `GrainOverlay.js` |
| 1.10 | Integration testing: edge cases, various samples, performance check, level meter | All files |

### Phase 2 — Multi-Touch & Mobile Polish (~2 weeks)

| Step | What | Key Files |
|---|---|---|
| 2.1 | Voice pool (6 voices) + VoiceAllocator: pointerId → Voice mapping | `VoiceAllocator.js`, `GranularEngine.js` |
| 2.2 | Multi-pointer handling: `setPointerCapture`, per-pointer tracking in a Map | `PointerHandler.js` |
| 2.3 | Per-voice colors: colored circles + cursors + grain overlays per voice | `WaveformDisplay.js`, `GrainOverlay.js` |
| 2.4 | Extended gestures: pressure → amplitude, contact size → spread, velocity → density | `PointerHandler.js` |
| 2.5 | Mobile/tablet polish: responsive layout, 44px touch targets, orientation, AudioContext resume | `style.css`, `main.js` |
| 2.6 | Cross-browser integration testing: Chrome, Firefox, Safari desktop + iOS + Android | All files |

### Phase 3 — Gesture Recording & Playback (~2.5 weeks)

| Step | What | Key Files |
|---|---|---|
| 3.1 | AutomationLane data model with serialization | `AutomationLane.js` |
| 3.2 | Recorder: capture pointer events while playing, throttle to 30/s/pointer | `Recorder.js` |
| 3.3 | Transport bar UI: Record / Play / Stop / Loop buttons, time display, progress bar | `TransportBar.js` |
| 3.4 | Player: replay events through engine, synthetic pointer IDs, loop support | `Player.js` |
| 3.5 | Ghost visualization: reduced-opacity replayed gestures on waveform | `GrainOverlay.js`, `WaveformDisplay.js` |
| 3.6 | Overdub mode: layer new gestures on top of existing recording | `Recorder.js`, `Player.js` |
| 3.7 | Save/load recordings: export as JSON download, import via drag-and-drop or file picker | `AutomationLane.js`, `fileLoader.js` |
| 3.8 | Final integration testing and polish | All files |

---

## Key Technical Decisions

- **Canvas 2D over Three.js/p5.js**: waveform rendering is 2D lines and rectangles — WebGL overhead is unjustified. Canvas 2D is zero-dependency, performant, and simple.
- **AudioBufferSourceNode per grain**: nodes are cheap, fire-and-forget, and garbage collected. No object pooling needed below ~150 grains/second.
- **GainNode.setValueCurveAtTime for envelopes**: runs on the audio thread, no main-thread involvement per grain, allows dynamic parameter changes.
- **Look-ahead scheduling (100ms ahead, 25ms timer)**: the standard pattern for Web Audio timing — decouples JS jitter from audio precision.
- **DynamicsCompressorNode as limiter**: not true look-ahead, but good enough for this use case. A custom AudioWorklet brickwall limiter is a future optimization.
- **Pointer Events over Touch Events**: unified API for mouse, touch, and pen. Each pointer gets a unique `pointerId` for multi-touch tracking.
- **No state management library**: plain JS objects and class instances. State is small and localized (voice params, recording events, UI values).

---

## Reference: Useful Web Audio Patterns

### iOS Audio Unlock
```javascript
document.addEventListener('pointerdown', function unlock() {
    if (audioContext.state === 'suspended') audioContext.resume();
    document.removeEventListener('pointerdown', unlock);
}, { once: true });
```

### Limiter Configuration
```javascript
const limiter = audioContext.createDynamicsCompressor();
limiter.threshold.setValueAtTime(-3, audioContext.currentTime);
limiter.knee.setValueAtTime(0, audioContext.currentTime);
limiter.ratio.setValueAtTime(20, audioContext.currentTime);
limiter.attack.setValueAtTime(0.001, audioContext.currentTime);
limiter.release.setValueAtTime(0.05, audioContext.currentTime);
```

### Hann Window
```javascript
function hannWindow(length) {
    const curve = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        curve[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (length - 1)));
    }
    return curve;
}
```

### Voice Gain Scaling
```javascript
// When voice count changes, ramp all active voice gains:
const scale = 1 / Math.sqrt(activeVoiceCount);
voice.gainNode.gain.linearRampToValueAtTime(scale, audioContext.currentTime + 0.02);
```
