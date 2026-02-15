# Web Audio Granular Sampler — Research & Architecture Document

## 1. Project Overview

This document lays out the research, architecture, and implementation plan for building a browser-based **multi-touch granular sampler** using vanilla web technologies (no React). The project unfolds in three phases:

1. **Phase 1** — Reproduce and modernize the original p5.js granular sampler prototype with a clean multi-voice audio engine.
2. **Phase 2** — Add multi-touch gesture support with per-finger voice assignment.
3. **Phase 3** — Implement gesture recording and playback (automation lanes).

The target platforms are desktop browsers (Chrome, Firefox, Safari) and touch-enabled tablets (iPad, Android tablets). The app must work offline once loaded — no server-side processing.

---

## 2. Prior Art & Reference Implementations

### 2.1 The Original Prototype (b2renger/p5.js-sound, ~2014)

The original sketch was built as a contribution to the p5.js-sound library. It used the p5.sound `GranularSample` class, which internally schedules `AudioBufferSourceNode` instances at timed intervals. Key characteristics of that prototype:

- A single loaded audio buffer sliced into grains on-the-fly.
- Mouse X mapped to grain position within the buffer, mouse Y mapped to grain amplitude.
- Grain duration and inter-onset time controlled via global variables.
- Built with the p5.js draw loop driving both the visual canvas and grain scheduling — tightly coupling rendering and audio timing.
- No envelope windowing on individual grains, leading to audible clicks at grain boundaries.

The prototype was important as a proof-of-concept but had several limitations: no multi-touch, no per-grain envelope, tightly coupled rendering/audio, and clipping issues when many grains overlap.

### 2.2 ZYA — Multi-Touch Granular Synthesiser

The ZYA granular synthesiser (zya.github.io/granular) is a well-known HTML5 reference. It uses Web Audio API for audio and Processing.js for graphics. Key features:

- Multi-touch support for up to **three simultaneous voices**.
- X-axis maps to buffer position, Y-axis maps to grain amplitude.
- jQuery Knob widgets for global parameters (grain size, speed, pitch).
- Runs on Chrome, Safari, Firefox (desktop and iOS).

Takeaways: the three-voice limit is a deliberate design choice to avoid CPU overload and clipping. Using Processing.js is now outdated — we should use Canvas 2D or a lightweight WebGL approach.

### 2.3 granular-js (philippfromme)

A more recent vanilla JS library providing a clean API: `envelope` (attack/decay), `density`, `spread`, `pitch` as top-level parameters. It emits events for each grain creation, which is useful for visualization. This is the closest to the architecture we want for the audio engine, though we'll build our own for full control.

### 2.4 Tone.js GrainPlayer

Tone.js provides a `GrainPlayer` class that decouples pitch and playback rate. It exposes `grainSize` and `overlap` as the main parameters. It handles scheduling internally using Tone's Transport system. We could use Tone.js as a dependency, but its footprint is significant (~150 KB minified). For maximum control over grain scheduling, enveloping, and voice management, building directly on the Web Audio API is preferable — but Tone.js remains a good fallback or reference for tricky scheduling edge cases.

---

## 3. Granular Synthesis — Core Concepts

### 3.1 What Is a Grain?

A grain is a tiny fragment of audio, typically between **1 ms and 500 ms** in duration. It consists of two components:

- **Content**: a slice of an audio buffer (or a synthesized waveform).
- **Envelope (window)**: an amplitude shape applied to the slice to avoid discontinuities at the edges. Without an envelope, you get clicks and pops at each grain boundary.

The envelope multiplied by the content produces the final grain signal. A stream of overlapping grains creates the characteristic granular texture — anything from smooth time-stretched pads to glitchy stutter effects.

### 3.2 Grain Parameters

| Parameter | Range | Description |
|---|---|---|
| **Position** | 0.0 – 1.0 (normalized) | Where in the source buffer the grain starts |
| **Duration / Grain Size** | 1 ms – 500 ms | Length of each grain |
| **Pitch / Playback Rate** | 0.25 – 4.0 | Speed at which the grain is played (`playbackRate` on `AudioBufferSourceNode`) |
| **Density / Inter-onset** | 1 ms – 200 ms | Time between successive grain onsets |
| **Spread / Scatter** | 0.0 – 1.0 | Random deviation added to the position |
| **Amplitude** | 0.0 – 1.0 | Peak amplitude of the grain |
| **Pan** | -1.0 – 1.0 | Stereo placement |
| **Envelope shape** | Hann, Tukey, Triangle, Trapezoid | Window function applied to the grain |

### 3.3 Envelope / Window Functions

The window function is critical for clean output. Here are the main choices:

**Hann (raised cosine)**: `w(t) = 0.5 * (1 - cos(2πt/N))`. The most commonly used window for granular synthesis. It produces smooth attack and decay with no discontinuities, minimizing spectral leakage.

**Tukey (tapered cosine)**: a flat top with cosine tapers on both sides. Allows a configurable ratio between the flat portion and the tapered edges. Useful when you want more of the original content to be heard at full amplitude.

**Triangle**: linear ramp up, then linear ramp down. Simpler to compute but has sharper spectral characteristics than Hann.

**Trapezoid**: configurable attack, sustain, and decay segments. Most flexible but requires more parameters.

For this project, the **Hann window is the default**, with Tukey as an alternative for users who want a more "present" grain sound. The window is applied by scheduling `GainNode` amplitude automation using `setValueCurveAtTime()` or by multiplying the buffer data directly.

### 3.4 The Time-Frequency Trade-off

Grain duration directly affects the spectral character of the output. Short grains (< 10 ms) approach individual samples and sound noisy/clicky. Longer grains (> 100 ms) preserve more of the source's tonal character but reduce the ability to create dense textures. The sweet spot for most musical applications is 20–80 ms.

This is expressed by the uncertainty relation: `Δf ≈ 1/Δt`. A 50 ms grain has a frequency resolution of about 20 Hz — enough to preserve pitch information while still allowing dense layering.

---

## 4. Technology Stack

### 4.1 Audio Engine — Web Audio API (native)

The Web Audio API provides everything we need:

- `AudioContext` — the central hub. One per application. Sample rate typically 44100 or 48000 Hz.
- `AudioBufferSourceNode` — a one-shot node that plays back a slice of an `AudioBuffer`. Created and destroyed per grain. This is the fundamental building block.
- `GainNode` — used for per-grain amplitude envelopes and per-voice master gain.
- `StereoPannerNode` — simple left/right panning per grain.
- `DynamicsCompressorNode` — final-stage safety limiter to prevent clipping.
- `AnalyserNode` — for FFT and waveform visualization data.

We will **not** use `AudioWorklet` for grain scheduling in Phase 1. The main-thread scheduling approach (using `setTimeout` or `requestAnimationFrame` with `audioContext.currentTime`) is sufficient for moderate grain densities (< 100 grains/second per voice). AudioWorklet would only be needed if we push to extreme densities or need sample-accurate custom envelopes, which is a potential Phase 4 optimization.

### 4.2 Visualization — Canvas 2D

For waveform display, grain visualization, and UI, **Canvas 2D** is the best trade-off between simplicity and performance:

- Native browser API, zero dependencies.
- Excellent for 2D drawing: waveforms, playback cursors, grain overlay rectangles.
- Performs well at 60fps for the kind of rendering we need (not thousands of particles).
- Easy to integrate touch/pointer events since the canvas is a single DOM element.

**Why not Three.js or p5.js?**

- **Three.js** is overkill for 2D waveform rendering. It adds ~600 KB of code, requires WebGL context management, and the shader pipeline is unnecessary overhead for what is essentially a line graph and some rectangles. However, Three.js could be interesting in a future phase if we want 3D grain cloud visualization or spectral landscapes.
- **p5.js** (~800 KB) is convenient but brings its own event loop and rendering pipeline that competes with our audio scheduling. The coupling between p5's `draw()` loop and audio timing was a weakness of the original prototype. Using vanilla Canvas 2D gives us explicit control over when and how we render.

If we want a helper library for canvas drawing without the weight of p5 or Three.js, **Canvas-sketch** (by Matt DesLauriers) or simply writing our own thin abstraction layer is the way to go.

### 4.3 UI Controls

For parameter controls (sliders, knobs), we have several options:

- **Native HTML `<input type="range">`** — works out of the box, fully accessible, supports touch. Can be styled with CSS. This is the simplest approach and should be the default.
- **dat.GUI** — lightweight parameter panel popular in creative coding. Quick to set up but limited in mobile UX.
- **Custom Canvas/SVG knobs** — if we want a more "instrument" feel. More work but gives total control over look and behavior.

Recommendation: start with native range inputs for Phase 1, then consider custom knobs for the final UI polish.

### 4.4 No Build System

The project uses **no bundler, no transpiler, no build step**. Modern browsers support ES modules natively via `<script type="module">`. All imports use relative paths with explicit `.js` extensions:

```javascript
import { Voice } from './audio/Voice.js';
import { createGrain } from './audio/grainFactory.js';
```

This keeps the project simple, debuggable (source files in DevTools match actual files), and free of tooling churn. The only requirement for local development is a static file server (e.g., `python3 -m http.server`) because ES modules and `fetch()` don't work over the `file://` protocol.

For deployment, the folder is uploaded as-is to any static host (GitHub Pages, Netlify, a simple Apache/Nginx server). No compilation needed.

---

## 5. Audio Engine Architecture

### 5.1 High-Level Signal Flow

```
[Source AudioBuffer]
        │
        ▼
┌─────────────────────┐
│   GrainScheduler    │  (per voice, creates grains at inter-onset intervals)
│  ┌───────────────┐  │
│  │ Grain N       │  │
│  │ BufferSource  │──┼──▶ GainNode (envelope) ──▶ StereoPannerNode
│  └───────────────┘  │                                    │
│  ┌───────────────┐  │                                    │
│  │ Grain N+1     │  │                                    │
│  │ BufferSource  │──┼──▶ GainNode (envelope) ──▶ StereoPannerNode
│  └───────────────┘  │                                    │
└─────────────────────┘                                    │
                                                           ▼
                                                    ┌─────────────┐
                                              ×N    │ Voice Mixer  │
                                              voices│  GainNode    │
                                                    └──────┬──────┘
                                                           │
                                                           ▼
                                                    ┌─────────────┐
                                                    │  Master Bus  │
                                                    │  GainNode    │
                                                    └──────┬──────┘
                                                           │
                                                           ▼
                                                   ┌──────────────┐
                                                   │  Limiter     │
                                                   │  Compressor  │
                                                   └──────┬───────┘
                                                          │
                                                          ▼
                                                   ┌──────────────┐
                                                   │  Analyser    │
                                                   │  (for viz)   │
                                                   └──────┬───────┘
                                                          │
                                                          ▼
                                                   AudioContext
                                                   .destination
```

### 5.2 Core Classes

#### `GranularEngine`

Top-level class. Owns the `AudioContext`, the source `AudioBuffer`, the master bus, the limiter, and the array of `Voice` instances.

```
GranularEngine
├── audioContext: AudioContext
├── sourceBuffer: AudioBuffer
├── masterGain: GainNode
├── limiter: DynamicsCompressorNode
├── analyser: AnalyserNode
├── voices: Voice[]  (max 5–8)
├── loadSample(url | File): Promise<void>
├── startVoice(id, params): void
├── updateVoice(id, params): void
├── stopVoice(id): void
└── dispose(): void
```

#### `Voice`

Represents one independently controllable grain stream. Each voice has its own grain scheduler, mixer gain, and parameter set. A voice is activated by a pointer (touch finger or mouse) and deactivated when the pointer lifts.

```
Voice
├── id: number
├── active: boolean
├── params: GrainParams
├── gainNode: GainNode
├── panNode: StereoPannerNode
├── scheduler: GrainScheduler
├── start(params): void
├── update(params): void
├── stop(): void
└── dispose(): void
```

#### `GrainScheduler`

Responsible for spawning grains at the correct intervals. It uses a **look-ahead scheduling** pattern: a `setInterval` (or `setTimeout` loop) runs at ~25 ms intervals and schedules grains into the future using `audioContext.currentTime`. This decouples the JavaScript timer from the audio clock, giving us sample-accurate scheduling even when the main thread is busy.

```
GrainScheduler
├── scheduleAhead: number  (how far ahead to schedule, e.g. 0.1s)
├── timerInterval: number  (how often the timer fires, e.g. 25ms)
├── nextGrainTime: number  (audioContext.currentTime of next grain)
├── start(): void
├── stop(): void
└── _tick(): void  (called by timer, schedules grains until scheduleAhead is filled)
```

#### `Grain` (ephemeral)

Not a persistent object. Each grain is a function call that:

1. Creates an `AudioBufferSourceNode`.
2. Sets its `buffer`, `playbackRate`, start offset, and duration.
3. Creates a `GainNode` for the amplitude envelope.
4. Applies the Hann window via `gain.setValueCurveAtTime()`.
5. Connects source → gain → voice pan → voice gain.
6. Calls `source.start(when, offset, duration)`.
7. The nodes are automatically garbage-collected after playback.

### 5.3 Preventing Clipping — Multi-Strategy Approach

Clipping is the main audio quality challenge in granular synthesis. When many grains overlap, their amplitudes sum and can exceed 0 dBFS, causing harsh digital distortion. We use a layered defense:

**Layer 1 — Per-grain amplitude scaling using `1/sqrt(N)`**:
Scale each grain's peak amplitude by `1 / sqrt(activeGrainCount)`. This is more natural than `1/N` because audio signals are not perfectly correlated — the RMS addition of uncorrelated signals grows as the square root.

**Layer 2 — Per-voice gain stage**:
Each voice has a `GainNode` that can be set to a conservative level (e.g., 0.3–0.5). The total number of active voices is known, so we can adjust dynamically.

**Layer 3 — Master bus limiter using `DynamicsCompressorNode`**:
Set as a brickwall limiter:
```javascript
const limiter = audioContext.createDynamicsCompressor();
limiter.threshold.setValueAtTime(-3, audioContext.currentTime);  // dBFS
limiter.knee.setValueAtTime(0, audioContext.currentTime);        // hard knee
limiter.ratio.setValueAtTime(20, audioContext.currentTime);      // near-infinite ratio
limiter.attack.setValueAtTime(0.001, audioContext.currentTime);  // fast attack
limiter.release.setValueAtTime(0.05, audioContext.currentTime);  // moderate release
```
Note: the built-in `DynamicsCompressorNode` does not have true look-ahead, so some transient peaks may pass through. For truly transparent limiting, a custom `AudioWorklet` brickwall limiter (with a small delay buffer for look-ahead) could be implemented in Phase 4.

**Layer 4 — Soft clipping via waveshaping (optional)**:
A `WaveShaperNode` with a `tanh` curve can be inserted before the destination as a gentle saturation stage. This colors the sound slightly but prevents harsh digital clipping artifacts.

### 5.4 Grain Envelope Implementation

Two approaches for applying the amplitude envelope:

**Approach A — GainNode automation (recommended)**:
```javascript
function createGrain(ctx, buffer, params, destination, when) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = params.pitch;
    
    const gain = ctx.createGain();
    
    // Generate Hann window curve
    const steps = 128;
    const curve = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
        curve[i] = params.amplitude * 0.5 * (1 - Math.cos(2 * Math.PI * i / (steps - 1)));
    }
    
    gain.gain.setValueAtTime(0, when);
    gain.gain.setValueCurveAtTime(curve, when, params.duration);
    
    source.connect(gain);
    gain.connect(destination);
    
    const offset = params.position * buffer.duration;
    source.start(when, offset, params.duration);
    source.stop(when + params.duration);
}
```

**Approach B — Pre-computed windowed buffers**:
Create a new `AudioBuffer` for each grain by multiplying the source samples with the window function sample-by-sample. More CPU work upfront but guarantees perfect envelope application. Less suited for real-time parameter changes.

Approach A is preferred because it leverages the Web Audio API's native parameter automation, runs on the audio thread, and allows dynamic changes to grain parameters without re-computing buffers.

---

## 6. User Interface & Parameter Mapping

### 6.1 The XY Pad (Main Interaction Surface)

The primary interaction is through a large canvas area displaying the waveform:

- **X-axis → Grain Position** (0.0 to 1.0, normalized across the buffer duration)
- **Y-axis → Grain Amplitude** (0.0 at the top to 1.0 at the bottom, or inverted for intuitive "push down = louder")

This follows the convention established by both the original prototype and the ZYA synthesiser. Each active touch/pointer is visualized as a pulsing circle or grain cloud overlay on the waveform.

### 6.2 Parameter Controls Panel

Below or beside the waveform, a panel of controls for global parameters:

| Control | Type | Maps To | Default |
|---|---|---|---|
| Grain Size | Slider (1–500ms) | `grain.duration` | 50 ms |
| Density | Slider (1–200ms) | `grain.interOnset` | 30 ms |
| Pitch | Slider (0.25–4.0) | `source.playbackRate` | 1.0 |
| Spread | Slider (0–1) | Random offset on position | 0.0 |
| Pan Range | Slider (-1 to 1) | Random pan per grain | 0.0 |
| Envelope | Select | Window function | Hann |
| Master Volume | Slider (0–1) | `masterGain.gain` | 0.7 |

In Phase 2, some of these parameters can become per-voice (controlled by additional gesture dimensions like pressure or multi-finger distance).

### 6.3 Waveform Display

The waveform should be rendered once when a sample is loaded, then cached as an off-screen canvas or `ImageData`. At runtime, the main canvas composites:

1. The cached waveform background.
2. A playback position indicator (vertical line) for each active voice.
3. Grain overlay: small rectangles or arcs showing the position and duration of recently played grains, fading out over time.
4. Touch point indicators: circles at each active pointer position.

This layered approach keeps rendering cheap — we only redraw the dynamic elements each frame.

---

## 7. Multi-Touch Gesture Support (Phase 2)

### 7.1 Pointer Events API

The `PointerEvent` API is the modern standard for handling mouse, touch, and pen input through a single unified interface. Each pointer has a unique `pointerId`, allowing us to track multiple simultaneous contacts.

Key events: `pointerdown`, `pointermove`, `pointerup`, `pointercancel`.

Critical implementation details:

- Call `element.setPointerCapture(event.pointerId)` on `pointerdown` to ensure all subsequent events for that pointer come to our element, even if the finger moves outside it.
- Set `touch-action: none` in CSS on the interaction surface to prevent the browser from intercepting touches for scrolling or zooming.
- Track active pointers in a `Map<pointerId, Voice>` — when a pointer goes down, assign it a free voice; when it goes up, release the voice.

### 7.2 Voice Allocation

With a maximum of 5–8 voices, allocation is straightforward:

```javascript
class VoiceAllocator {
    constructor(maxVoices) {
        this.voices = Array.from({length: maxVoices}, (_, i) => new Voice(i));
        this.pointerMap = new Map();  // pointerId → Voice
    }
    
    allocate(pointerId) {
        const free = this.voices.find(v => !v.active);
        if (!free) return null;  // all voices busy
        free.start();
        this.pointerMap.set(pointerId, free);
        return free;
    }
    
    release(pointerId) {
        const voice = this.pointerMap.get(pointerId);
        if (voice) {
            voice.stop();
            this.pointerMap.delete(pointerId);
        }
    }
    
    getVoice(pointerId) {
        return this.pointerMap.get(pointerId);
    }
}
```

### 7.3 Extended Gesture Dimensions

Beyond X/Y position, touch inputs provide additional dimensions:

- **Pressure** (`event.pressure`, 0.0–1.0): map to grain amplitude or filter cutoff. Note: not all devices support pressure; fallback to Y-axis if unavailable.
- **Width/Height** (`event.width`, `event.height`): the contact area of the touch. Can be mapped to grain spread or size.
- **Tilt** (`event.tiltX`, `event.tiltY`): for stylus input, could map to pan or pitch modulation.
- **Two-finger distance** (computed from two active pointers): map to grain size or density — a "pinch" gesture could shrink grains, a "spread" gesture could expand them.

### 7.4 iOS Audio Context Restrictions

iOS Safari requires a user gesture (tap) to create or resume an `AudioContext`. The standard pattern:

```javascript
document.addEventListener('pointerdown', function initAudio() {
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    document.removeEventListener('pointerdown', initAudio);
}, { once: true });
```

---

## 8. Gesture Recording & Playback (Phase 3)

### 8.1 Data Model

A gesture recording captures the evolution of all voice parameters over time. The data structure:

```javascript
// A single automation event
{
    time: number,          // seconds since recording start
    voiceId: number,       // which voice
    type: 'start' | 'move' | 'stop',
    params: {
        position: number,  // 0–1
        amplitude: number, // 0–1
        // any other per-voice params at this moment
    }
}
```

A complete recording is an array of these events, sorted by time. This is essentially a MIDI-like event stream but for granular parameters.

### 8.2 Recording

During recording mode:

1. Start a timer when the user presses "Record" (reference: `performance.now()` or `audioContext.currentTime`).
2. On each `pointerdown`, `pointermove`, and `pointerup`, push an event to the recording array with the current timestamp and normalized parameters.
3. `pointermove` events can fire very frequently (>60 Hz per finger). Throttle to ~30 Hz per voice to keep recordings manageable — or record everything and downsample later.
4. Stop recording on button press.

### 8.3 Playback

Playback replays the event stream:

1. Sort events by time.
2. Use a `requestAnimationFrame` loop (or a scheduled `setTimeout` chain) to walk through the events.
3. At each event's timestamp, call the corresponding `startVoice()`, `updateVoice()`, or `stopVoice()` on the engine.
4. Visualize the replayed gestures on the waveform canvas (ghost cursors).

### 8.4 Looping & Overdub

For automation lanes like a DAW:

- **Loop mode**: when playback reaches the end, jump back to the start.
- **Overdub mode**: record new gestures while the existing recording plays back. Merge the new events into the existing array.
- **Erase mode**: during overdub, touching the waveform erases existing events in that time window instead of adding new ones.

### 8.5 Storage Format

Recordings can be serialized to JSON for save/load. A 30-second recording at 30 events/second with 3 voices is approximately 2700 events × ~50 bytes = ~135 KB of JSON. Very manageable. Could also be compressed with a simple delta encoding (store only changes from the previous event).

---

## 9. Performance Considerations

### 9.1 AudioBufferSourceNode Churn

Each grain creates a new `AudioBufferSourceNode` and `GainNode`. These are lightweight native objects, but at high densities (e.g., 5 voices × 30 grains/second = 150 nodes/second) we need to ensure garbage collection doesn't cause audio glitches.

Mitigation: nodes auto-disconnect after their `stop()` time. We don't need to manually clean up. The Web Audio spec guarantees that ended source nodes are collected. However, avoid retaining JavaScript references to expired nodes — let them fall out of scope.

### 9.2 Timer Precision

`setTimeout` and `setInterval` have a minimum resolution of ~4 ms in most browsers (and can be throttled to 1000 ms in background tabs). Our scheduling approach uses a look-ahead buffer: the timer fires every 25 ms but schedules grains up to 100 ms into the future. This gives the audio thread smooth, uninterrupted scheduling even if the JS timer jitters.

If the tab is in the background, audio will degrade. This is acceptable for an interactive instrument — the user is expected to be actively engaging with it.

### 9.3 Canvas Rendering

At 60 fps with 5 active voices and their grain overlays, the canvas workload is modest. The waveform itself is a static cached image. Only the dynamic overlays (grain rects, pointer indicators, automation cursor) need to be drawn each frame. Use `requestAnimationFrame` and avoid any canvas operations that trigger compositing or reflow on the rest of the page.

### 9.4 Memory

A stereo 44.1 kHz audio buffer of 30 seconds is `44100 × 2 × 4 × 30 ≈ 10.6 MB` of Float32 data. This is fine. For longer samples (> 2 minutes), consider downsampling to mono or prompting the user.

---

## 10. File & Sample Loading

### 10.1 Supported Formats

The `AudioContext.decodeAudioData()` method handles format decoding natively. Supported formats vary by browser but WAV, MP3, OGG, and AAC are universally covered.

### 10.2 Loading Flow

```
User drags file onto waveform area
        │
        ▼
FileReader reads as ArrayBuffer
        │
        ▼
audioContext.decodeAudioData(arrayBuffer)
        │
        ▼
Store resulting AudioBuffer
        │
        ▼
Render waveform to cache canvas
        │
        ▼
Ready to play
```

Also support a URL-based loader for bundled demo samples.

### 10.3 Microphone Input (stretch goal)

Use `navigator.mediaDevices.getUserMedia({ audio: true })` to capture live audio into a buffer using a `MediaStreamAudioSourceNode` → `ScriptProcessorNode` (deprecated) or `AudioWorkletNode` that records into a ring buffer. The user could then granulate their own voice or ambient sound.

---

## 11. Project Structure

```
granular-sampler/
├── index.html
├── style.css
├── src/
│   ├── main.js                 # Entry point, UI wiring
│   ├── audio/
│   │   ├── GranularEngine.js   # Top-level audio engine
│   │   ├── Voice.js            # Per-voice grain stream
│   │   ├── GrainScheduler.js   # Look-ahead grain timing
│   │   ├── grainFactory.js     # Creates individual grains (nodes)
│   │   └── envelopes.js        # Window function generators
│   ├── ui/
│   │   ├── WaveformDisplay.js  # Canvas waveform renderer
│   │   ├── GrainOverlay.js     # Grain visualization layer
│   │   ├── ParameterPanel.js   # Sliders / controls
│   │   └── TransportBar.js     # Play/stop/record buttons
│   ├── input/
│   │   ├── PointerHandler.js   # Multi-touch → voice mapping
│   │   └── VoiceAllocator.js   # Free voice pool
│   ├── automation/
│   │   ├── Recorder.js         # Gesture event capture
│   │   ├── Player.js           # Gesture event playback
│   │   └── AutomationLane.js   # Data model for recorded gestures
│   └── utils/
│       ├── math.js             # lerp, clamp, map
│       └── fileLoader.js       # Drag-and-drop, file picker
├── samples/                    # Bundled demo audio files
│   └── texture_pad.wav
└── README.md
```

---

## 12. Implementation Roadmap

### Phase 1 — Core Engine + Single-Touch (Weeks 1–3)

- Set up Vite project with vanilla JS.
- Implement `GranularEngine`, `Voice`, `GrainScheduler`, and grain factory.
- Implement Hann window envelope.
- Build waveform display with Canvas 2D (load sample, render waveform, cache).
- Wire mouse/single-pointer interaction: X → position, Y → amplitude.
- Add parameter sliders: grain size, density, pitch, spread, master volume.
- Implement the multi-layer anti-clipping chain (per-grain scaling, per-voice gain, master limiter).
- Test with several audio sources (speech, music, textures, percussive).

### Phase 2 — Multi-Touch & Polish (Weeks 4–5)

- Replace mouse listeners with PointerEvent-based multi-touch handler.
- Implement `VoiceAllocator` for up to 5 simultaneous voices.
- Add per-voice visual indicators on the waveform canvas (colored circles, grain clouds).
- Explore additional gesture dimensions (pressure → amplitude, contact size → spread).
- Add drag-and-drop sample loading.
- iOS/mobile testing and AudioContext resume handling.
- UI polish: responsive layout, touch-friendly control sizing.

### Phase 3 — Automation Recording & Playback (Weeks 6–7)

- Implement `Recorder` to capture pointer events as timestamped automation data.
- Implement `Player` to replay automation events against the engine.
- Add transport controls (Record, Play, Stop, Loop).
- Visualize recorded gestures as ghost trails on the waveform.
- Add overdub mode.
- Export/import recordings as JSON.

### Future Ideas (Phase 4+)

- AudioWorklet-based grain engine for higher density and custom DSP.
- Brickwall limiter AudioWorklet with look-ahead for transparent peak limiting.
- Live microphone input as a granulatable source.
- 3D grain visualization using Three.js or WebGPU.
- MIDI controller mapping.
- Spectral display (FFT waterfall) alongside the waveform.
- Multiple sample slots with crossfading.
- Reverb and delay send effects.

---

## 13. Key References & Resources

**Web Audio API**:
- MDN Web Audio API documentation: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- W3C Web Audio API 1.1 spec (2024 working draft)
- `AudioBufferSourceNode` reference: https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode
- `DynamicsCompressorNode` reference: https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode

**Granular Synthesis Theory**:
- granularsynthesis.com — comprehensive academic resource on grain envelopes, density, and parameter relationships
- Curtis Roads, *Microsound* (MIT Press, 2001) — the definitive reference on granular and particle synthesis

**Existing Web Implementations**:
- ZYA Granular Synthesiser: https://zya.github.io/granular/ (multi-touch, Processing.js + Web Audio)
- granular-js by philippfromme: https://github.com/philippfromme/granular-js (clean vanilla JS API)
- Tone.js GrainPlayer: https://tonejs.github.io/docs/15.0.4/classes/GrainPlayer.html

**Multi-Touch & Pointer Events**:
- MDN Pointer Events multi-touch guide: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Multi-touch_interaction
- MDN Touch Events guide: https://developer.mozilla.org/en-US/docs/Web/API/Touch_events/Using_Touch_Events

**Anti-Clipping Discussion**:
- Cycling '74 forum thread on clipping prevention in granular synthesis
- "Should your web audio app have a limiter?" by webaudiotech.com — analysis of DynamicsCompressorNode limitations and brickwall limiter alternatives

---

*Document prepared for project planning — February 2026.*
