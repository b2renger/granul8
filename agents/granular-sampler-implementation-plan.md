# Web Audio Granular Sampler — Implementation Plan

## Overview

This plan breaks the project into three sequential phases, each building on the previous one. Every phase ends with a working, testable deliverable. Estimated total duration: **7–8 weeks** of focused development.

---

## Phase 1 — Core Engine & Single-Pointer Interaction [COMPLETE]

**Goal**: A fully functional single-voice granular sampler with waveform display, parameter controls, and clean audio output. This phase establishes the entire foundation — audio engine, rendering pipeline, UI scaffolding — so that Phases 2 and 3 are incremental additions rather than refactors.

**Duration**: ~3 weeks

---

### Step 1.1 — Project Scaffolding [DONE]

Set up the project as a plain static file structure. No bundler, no npm, no build step. The browser loads ES modules natively via `<script type="module">`.

**Tasks**:
- Create the folder structure manually:
  ```
  granular-sampler/
  ├── index.html
  ├── style.css
  ├── src/
  │   ├── main.js
  │   ├── audio/
  │   ├── ui/
  │   ├── input/
  │   ├── automation/
  │   └── utils/
  └── samples/
      └── texture_pad.wav
  ```
- Write `index.html`: a single HTML file that loads `style.css` and `<script type="module" src="src/main.js"></script>`. All JS imports use relative paths with `.js` extensions (mandatory for native ES modules — `import { Voice } from './audio/Voice.js'`).
- Set up the main layout in HTML: a full-width `<canvas>` for the waveform, a `<div>` control panel below it, and a top bar for file loading and transport.
- Write `style.css` with a dark theme, `touch-action: none` on the canvas, responsive sizing using CSS Grid or Flexbox.
- Add a demo sample (`samples/texture_pad.wav` — a sustained, harmonically rich sound, 5–10 seconds long).
- For local development, serve the folder with any static server: `python3 -m http.server 8000`, the VS Code Live Server extension, or `npx serve .`. A static server is required because ES modules and `fetch()` don't work over `file://` due to CORS restrictions. This is not a build tool — it's just a file server.
- Verify the page loads, all module imports resolve, and the canvas resizes correctly.

**Deliverable**: Empty project shell that loads in the browser with a styled layout and a blank canvas. Zero dependencies, zero build steps.

---

### Step 1.2 — Audio Context & Sample Loading [DONE]

Build the sample loading pipeline and verify audio playback at the most basic level.

**Tasks**:
- Create `src/audio/GranularEngine.js` — constructor creates an `AudioContext`, a master `GainNode`, and connects to `destination`.
- Implement `loadSample(url)` — fetches the audio file, calls `decodeAudioData()`, stores the resulting `AudioBuffer`.
- Implement `loadSampleFromFile(file)` — reads a `File` object via `FileReader.readAsArrayBuffer()`, then decodes.
- Create `src/utils/fileLoader.js` — a drag-and-drop handler on the canvas area that calls `loadSampleFromFile()`. Also wire up a hidden `<input type="file" accept="audio/*">` triggered by a "Load Sample" button.
- Add iOS/Safari audio unlock: on first `pointerdown` anywhere on the page, call `audioContext.resume()` if state is `'suspended'`.
- Sanity test: after loading, play the entire buffer once using a temporary `AudioBufferSourceNode` to confirm decoding works.

**Deliverable**: User can drag an audio file onto the page (or click a button to pick one) and hear it play back once. The bundled demo sample auto-loads on page init.

---

### Step 1.3 — Waveform Display [DONE]

Render the loaded sample as a waveform on the canvas.

**Tasks**:
- Create `src/ui/WaveformDisplay.js` — a class that takes a `<canvas>` element and an `AudioBuffer`.
- On sample load, compute the waveform data: iterate over the buffer's channel data, downsample to one value per pixel (using min/max pairs per pixel column for a proper waveform shape, not just averages).
- Render the waveform to an **offscreen canvas** (`OffscreenCanvas` or a second hidden `<canvas>`). This cached image is the static background — we never recompute it unless the sample changes or the canvas resizes.
- In the main render loop (`requestAnimationFrame`), draw the cached waveform, then overlay dynamic elements (cursor, grains) on top.
- Handle canvas resize (window resize, orientation change): recompute the waveform cache at the new resolution.
- Style: waveform in a semi-transparent color (e.g., soft cyan on dark background), centered vertically with a zero-crossing line.

**Deliverable**: The loaded sample is displayed as a clean waveform filling the canvas. Resizing the window re-renders correctly.

---

### Step 1.4 — Grain Factory & Envelope [DONE]

Build the core grain creation function and the envelope system, independently testable before hooking up interaction.

**Tasks**:
- Create `src/audio/envelopes.js` — functions that return `Float32Array` curves:
  - `hannWindow(length)` — raised cosine, the default.
  - `tukeyWindow(length, alpha)` — tapered cosine with configurable flat portion.
  - `triangleWindow(length)` — linear ramp up/down.
  - Pre-compute and cache a few common lengths (64, 128, 256 samples) to avoid allocating on every grain.
- Create `src/audio/grainFactory.js` — a function `createGrain(audioContext, buffer, params, destination, when)`:
  - Creates an `AudioBufferSourceNode`, sets `buffer` and `playbackRate`.
  - Creates a `GainNode`, applies the envelope curve via `gain.setValueCurveAtTime(curve, when, duration)`.
  - Optionally creates a `StereoPannerNode` if `params.pan !== 0`.
  - Connects the chain: source → gain → (pan) → destination.
  - Calls `source.start(when, offset, duration)` and `source.stop(when + duration)`.
  - Returns nothing — the nodes are fire-and-forget, garbage collected after playback.
- Unit test (manual): call `createGrain()` directly with hardcoded params and verify you hear a short, click-free grain with a smooth amplitude envelope.

**Deliverable**: A tested function that plays a single windowed grain at a given position, pitch, and amplitude with no clicks.

---

### Step 1.5 — Grain Scheduler & Voice [DONE]

Implement the continuous grain stream and the Voice abstraction.

**Tasks**:
- Create `src/audio/GrainScheduler.js`:
  - Constructor takes a callback function (`onScheduleGrain(when)`), a `scheduleAhead` time (default 0.1s), and a `timerInterval` (default 25ms).
  - `start()` — begins a `setTimeout` loop. Each tick, it checks if `nextGrainTime < audioContext.currentTime + scheduleAhead`. If yes, it calls `onScheduleGrain(nextGrainTime)`, then advances `nextGrainTime` by `interOnsetTime`. Repeats until the look-ahead window is filled.
  - `stop()` — clears the timeout, resets state.
  - `setInterOnset(ms)` — updates the interval between grains.
- Create `src/audio/Voice.js`:
  - Constructor takes `audioContext`, `sourceBuffer`, and a `destinationNode`.
  - Owns a `GainNode` (voice level), a `StereoPannerNode` (voice pan), and a `GrainScheduler`.
  - Stores current `params`: `{ position, amplitude, pitch, grainSize, interOnset, spread, pan, envelope }`.
  - `start(params)` — sets params, starts the scheduler. The scheduler's callback calls `createGrain()` with the current params (plus random spread offset on position).
  - `update(params)` — updates the stored params. Next scheduled grain picks up the new values. This is how pointer movement modulates the sound in real time.
  - `stop()` — stops the scheduler, ramps voice gain to 0 over ~30ms to avoid a click on release.
- Wire up in `GranularEngine`:
  - Create a single `Voice` instance (we'll add multi-voice in Phase 2).
  - Expose `startVoice(params)`, `updateVoice(params)`, `stopVoice()`.

**Deliverable**: Calling `engine.startVoice({position: 0.5, amplitude: 0.8, ...})` produces a continuous stream of overlapping grains. Calling `updateVoice()` smoothly changes the grain parameters. `stopVoice()` fades out cleanly.

---

### Step 1.6 — Anti-Clipping Chain [DONE]

Wire up the multi-layer protection against clipping.

**Tasks**:
- In `GranularEngine`, build the signal chain: Voice(s) → Master GainNode → DynamicsCompressorNode (limiter) → AnalyserNode → destination.
- Configure the compressor as a brickwall limiter: threshold -3 dB, knee 0, ratio 20, attack 0.001s, release 0.05s.
- In `grainFactory.js`, scale each grain's amplitude by `params.amplitude * voiceGainFactor`. Initially `voiceGainFactor = 0.5` as a conservative default.
- Add an `AnalyserNode` after the limiter for visualization (Phase 1: just for debugging; later for a level meter).
- Test with extreme settings: maximum density, maximum amplitude, multiple short grains — verify no harsh clipping reaches the speakers. Listen critically on headphones.

**Deliverable**: Even with aggressive parameter settings, the output stays clean. The limiter catches peaks, the per-grain scaling prevents most of them from occurring in the first place.

---

### Step 1.7 — Pointer Input (Single Touch/Mouse) [DONE]

Connect pointer interaction to the voice.

**Tasks**:
- Create `src/input/PointerHandler.js`:
  - Attaches `pointerdown`, `pointermove`, `pointerup`, `pointercancel` listeners to the waveform canvas.
  - On `pointerdown`: computes normalized X (0–1 across canvas width → grain position) and normalized Y (0–1 → amplitude, inverted so bottom = 0, top = 1). Calls `engine.startVoice({position, amplitude, ...global params})`.
  - On `pointermove`: recomputes X/Y, calls `engine.updateVoice({position, amplitude})`.
  - On `pointerup` / `pointercancel`: calls `engine.stopVoice()`.
- Create `src/utils/math.js` with helpers: `clamp(val, min, max)`, `mapRange(val, inMin, inMax, outMin, outMax)`, `lerp(a, b, t)`.
- In the render loop, draw a circle at the current pointer position on the waveform to give visual feedback.

**Deliverable**: User touches/clicks the waveform and hears grains from that position. Moving the pointer scrubs through the buffer. Lifting the finger/mouse stops the sound.

---

### Step 1.8 — Parameter Controls [DONE]

Build the UI panel for global grain parameters.

**Tasks**:
- Create `src/ui/ParameterPanel.js`:
  - Generates labeled `<input type="range">` sliders for: Grain Size (1–500ms), Density/Inter-onset (5–200ms), Pitch (0.25–4.0, step 0.01), Spread (0–1), Pan Range (-1 to 1), Master Volume (0–1).
  - A `<select>` dropdown for envelope shape (Hann, Tukey, Triangle).
  - Each control dispatches a custom event or calls a callback when changed.
- Wire the panel to `GranularEngine` / `Voice`: when a slider moves, update the corresponding parameter. The voice picks up the new value on the next grain.
- Display current values next to each slider (or as a tooltip).
- Ensure sliders are large enough for comfortable touch interaction (min height ~44px tap target).

**Deliverable**: User can adjust grain size, density, pitch, spread, and volume in real time while playing. Changes are audible immediately.

---

### Step 1.9 — Grain Visualization [DONE]

Add visual feedback showing individual grains on the waveform.

**Tasks**:
- Create `src/ui/GrainOverlay.js`:
  - Maintains a ring buffer of recent grain events (position, time, duration, amplitude).
  - The grain factory emits a lightweight event (or calls a callback) each time a grain is created, passing `{ position, duration, amplitude, when }`.
  - In the render loop, iterate over recent grains. For each, draw a translucent rectangle (or arc) on the waveform at the corresponding X position, with width proportional to grain duration and opacity fading based on age (e.g., fully visible for 200ms, then fades over 300ms).
  - Color-code by voice (preparation for Phase 2 — for now, single color).
- Keep the grain event buffer small (last 100 grains max) to avoid memory growth.

**Deliverable**: As the user plays, small glowing rectangles appear on the waveform at each grain's position, creating a visual cloud that tracks the sound. Grains fade out after a short time.

---

### Step 1.10 — Integration Testing & Polish [DONE]

Final Phase 1 pass: test everything together, fix edge cases, polish the experience.

**Tasks**:
- Test with various audio files: short percussive samples, long ambient pads, speech, music loops. Verify the engine handles all gracefully.
- Test edge cases: very short grain size + very high density, very long grain size + very low density, pitch at extremes (0.25 and 4.0), position at buffer boundaries (0.0 and 1.0).
- Ensure that stopping and restarting voices doesn't leave orphaned nodes or cause pops.
- Verify that loading a new sample while playing stops the current voice cleanly.
- Add a simple level meter (horizontal bar) driven by the `AnalyserNode` to give the user feedback on output level.
- Performance check: open DevTools Performance tab, verify no excessive GC pauses or dropped frames during normal use.
- Responsive check: test on a narrow viewport (phone-width) — controls should stack vertically, canvas should fill available width.
- **Experiment: custom ADSR envelope widget** — Replace the envelope dropdown with an interactive ADSR editor. A small canvas or SVG widget where the user can drag control points to shape Attack, Decay, Sustain level, and Release visually. The widget generates a `Float32Array` curve that is passed to the grain factory in place of the preset window functions. This allows fine-grained control over grain shape beyond the built-in presets (Hann, Gaussian, Sigmoid, etc.). Start with a simple 4-point polyline (A/D/S/R), evaluate whether curves (bezier segments) or additional breakpoints are needed.

**Deliverable**: A solid, reliable single-voice granular sampler. Clean sound, responsive UI, no crashes or audio glitches under normal use. Custom ADSR widget prototype for envelope shaping. This is the foundation for everything that follows.

---

## Phase 2 — Multi-Touch & Voice Management [COMPLETE]

**Goal**: Support multiple simultaneous touch points, each controlling an independent grain voice. Polish the mobile/tablet experience. Make the instrument feel expressive and alive.

**Duration**: ~2 weeks

---

### Step 2.1 — Voice Pool & Allocator [DONE]

Expand from one voice to a managed pool.

**Tasks**:
- Create `src/input/VoiceAllocator.js`:
  - Constructor takes `maxVoices` (default: 6). Creates an array of `Voice` instances, all initially inactive.
  - `allocate(pointerId)` — finds the first inactive voice, marks it active, maps it to the pointer ID, returns the voice. Returns `null` if all voices are busy.
  - `release(pointerId)` — stops the mapped voice, marks it inactive, removes the mapping.
  - `getVoice(pointerId)` — returns the voice currently mapped to a pointer, or `null`.
  - `releaseAll()` — stops all voices (used when loading a new sample or on emergency stop).
- Modify `GranularEngine`:
  - Replace the single voice with the allocator.
  - Update the signal chain: all voices connect to a shared summing `GainNode` (voice bus) before the master gain and limiter.
  - Expose `startVoice(pointerId, params)`, `updateVoice(pointerId, params)`, `stopVoice(pointerId)`.
- Adjust per-voice gain: when a new voice starts, scale all active voice gains by `1 / sqrt(activeVoiceCount)` to prevent summing overload. Use a short ramp (20ms) to avoid clicks when the gain changes.

**Deliverable**: The engine can run up to 6 simultaneous, independent grain streams. Starting/stopping voices dynamically adjusts gain levels.

---

### Step 2.2 — Multi-Touch Pointer Handling [DONE]

Upgrade `PointerHandler` to track multiple pointers.

**Tasks**:
- Refactor `PointerHandler.js`:
  - Maintain a `Map<pointerId, {voiceId, lastX, lastY}>` for all active pointers.
  - On `pointerdown`: call `setPointerCapture(e.pointerId)` on the canvas, allocate a voice via the allocator, compute initial params from X/Y, start the voice.
  - On `pointermove`: look up the pointer in the map, compute new X/Y, update the voice params.
  - On `pointerup` / `pointercancel`: release the voice, delete the pointer from the map.
  - Handle the case where allocation returns `null` (all voices busy): ignore the pointer, or display a brief visual indicator that the max has been reached.
- Ensure `touch-action: none` is set on the canvas in CSS (prevents browser scroll/zoom hijacking).
- Prevent default on all pointer events to stop browser gesture interference.

**Deliverable**: User can place multiple fingers on the waveform simultaneously, each producing an independent grain stream at its own position/amplitude. Lifting a finger stops only that voice.

---

### Step 2.3 — Per-Voice Visual Feedback [DONE]

Give each voice a distinct visual identity.

**Tasks**:
- Assign a color to each voice slot (from a palette of 6–8 distinct, high-contrast colors on the dark background).
- In the render loop:
  - Draw a filled circle at each active pointer position, colored by voice.
  - Draw a vertical line (playback cursor) at each voice's current grain position.
  - Grain overlay rectangles use the same voice color with reduced opacity.
- Add a subtle pulsing animation on the pointer circles (scale oscillates slightly, synced loosely to grain density) to convey liveness.
- When a voice stops, its visual elements fade out over ~300ms rather than disappearing instantly.

**Deliverable**: Each finger on the waveform has a clearly identifiable color. The grain cloud shows which voice is producing which grains. The visual is both informative and aesthetically engaging.

---

### Step 2.4 — Extended Gesture Dimensions [DONE]

Map additional pointer data to audio parameters where supported.

**Tasks**:
- **Pressure** (`event.pressure`): if the device reports non-zero pressure (value > 0 and not the default 0.5 for mouse), map it to grain amplitude as a multiplier on top of the Y-axis mapping. On devices without pressure, fall back to Y-axis only. This gives touch-screen users a third control dimension.
- **Contact size** (`event.width`, `event.height`): if available, map the average contact area to grain spread. A fat finger press spreads grains across a wider buffer region; a precise fingertip focuses them. Normalize by typical ranges (most devices report 20–50px for finger width).
- **Velocity** (computed from pointer movement speed between frames): map to grain density modulation — fast movement increases inter-onset time (fewer grains, more "scrubby"), slow movement decreases it (denser cloud, more sustained). This makes the instrument feel physically responsive.
- All mappings should be optional and configurable, with sensible defaults and smooth interpolation (don't jump — lerp toward the new value over a few frames).
- **Device capability detection**: detect whether the device reports real pressure (not mouse default 0.5) and real contact size (width/height > 1). Show live value meters and "available" / "not detected" badges in the Gesture Mapping UI.
- **Sample selector dropdown**: added in top bar for switching between bundled demo samples.

**Deliverable**: On supported devices (iPads, Android tablets), the instrument responds to nuanced touch: pressure controls intensity, finger size controls texture width, movement speed controls grain density. On desktop mouse, it degrades gracefully to X/Y only.

**Future refinements** (to revisit later):
- Fine-tune gesture mapping curves and sensitivity per device type
- Test and calibrate pressure/contact size ranges on real tablets (iPad, Android)
- Consider per-voice gesture mappings (different mapping per finger)
- Explore two-finger distance (pinch/spread) as an additional gesture dimension
- Add visual feedback of gesture values directly on the waveform canvas (not just in the panel)

---

### Step 2.5 — Mobile & Tablet Polish [DONE]

Optimize the experience for touch-first devices.

**Tasks**:
- **Responsive layout**: on narrow screens (< 768px), stack the control panel below the waveform. On wide screens, panel can sit to the right. The waveform canvas always takes maximum available width.
- **Control sizing**: ensure all sliders and buttons have a minimum 44×44px touch target. Use large, clear labels.
- **Orientation**: handle both portrait and landscape. In landscape on a tablet, the waveform can be much wider — ideal for granular exploration. Listen for `resize` events and recompute the waveform cache.
- **AudioContext resume**: ensure the iOS audio unlock fires on the first `pointerdown`, before any attempt to start a voice. Show a "Tap to start" overlay if the context is suspended.
- **Performance on mobile**: test on mid-range devices. If frame rate drops below 30fps, reduce grain overlay complexity (fewer stored grains, simpler shapes). If audio stutters, increase `scheduleAhead` or reduce max voices.
- **Prevent accidental page navigation**: ensure no swipe gestures on the canvas trigger browser back/forward.

**Deliverable**: The sampler works smoothly on iPad Safari and Android Chrome tablets. Touch interaction feels native and responsive. No audio glitches on mid-range hardware.

---

### Step 2.6 — Phase 2 Integration Testing [DONE]

**Tasks**:
- Test with 1, 2, 3, 4, 5, and 6 simultaneous touches. Verify voice allocation and deallocation is clean.
- Test rapid touch sequences: tap-lift-tap-lift quickly on different positions. No orphaned voices, no stuck sounds.
- Test pointer capture edge cases: what happens if a finger slides off the canvas edge? (`pointercancel` should fire and release the voice.)
- Listen critically to the mix with multiple voices at high density. Adjust the limiter settings if needed.
- Cross-browser check: Chrome, Firefox, Safari on desktop; Safari on iOS; Chrome on Android.

**Deliverable**: Robust multi-touch granular instrument ready for expressive performance.

---

### Step 2.7 — Musical Quantization, Randomization & Visual Feedback [DONE]

Make granular parameters musically meaningful by adding optional quantization and randomization modes tied to a global BPM and musical scale system. Each of the three core parameters (grain size, density, pitch) can independently operate in any combination of **free/quantized** and **fixed/randomized** modes. When both quantize and randomize are active on the same parameter, randomization happens per-grain and each random value is snapped to the musical grid.

**Global controls:**

- **BPM** (default 120): a single global tempo reference shared by all quantized parameters. Displayed as a range slider (40–300) with a tap-tempo button (averages the last 4 tap intervals).
- **Root note** (default C): selectable from C through B (12 options). Used as the tonal center for pitch quantization.
- **Scale** (default chromatic): selectable from chromatic, major, minor, pentatonic. Determines which pitch degrees are available when pitch quantization is active.

**Per-parameter quantization & randomization (all three follow the same pattern):**

Each parameter supports four independent modes via two toggle checkboxes (Quantize + Randomize):

| Quantize | Randomize | Behavior |
|----------|-----------|----------|
| off | off | Continuous value from slider (or gesture mapping) — original behavior |
| on | off | Snapped to musical grid in `resolveParams()` — one fixed quantized value |
| off | on | Per-grain continuous random between min/max range — true per-grain jitter |
| on | on | Per-grain random between min/max, then snapped to nearest grid value — quantized randomization |

1. **Grain Size → BPM subdivisions**
   - **Free mode**: exponential slider 1–1000ms, continuous.
   - **Quantized mode**: slider maps to BPM subdivisions via `normalizedToSubdivision()`. Display shows "1/8 (250ms)" format.
   - **Randomized mode**: each grain picks a random duration between the min/max slider range.
   - **Quantized + Randomized**: each grain picks a random duration, then snaps to the nearest BPM subdivision. Handled per-grain in `Voice._onScheduleGrain()` via `quantizeDensity()`.
   - Slider labels refresh when BPM changes (slider, tap tempo).

2. **Density (inter-onset time) → BPM subdivisions**
   - **Free mode**: exponential slider 5–500ms, continuous.
   - **Quantized mode**: slider maps to subdivisions. Display shows "1/8 (250ms)".
   - **Randomized mode**: scheduler picks random inter-onset per grain via `GrainScheduler.interOnsetRange`.
   - **Quantized + Randomized**: scheduler picks random inter-onset, then snaps to nearest subdivision via `GrainScheduler.quantizeBpm` property and `quantizeDensity()`.
   - Available subdivisions (10 total, including triplets): 1/1, 1/2, 1/2T, 1/4, 1/4T, 1/8, 1/8T, 1/16, 1/16T, 1/32.

3. **Pitch → Musical scale degrees**
   - **Free mode**: Y-axis maps to ±2 octaves continuously.
   - **Quantized mode**: snapped to nearest scale degree via `quantizePitch()` in `resolveParams()`.
   - **Randomized mode**: each grain picks a random pitch in log2 space (±2 octaves).
   - **Quantized + Randomized**: each grain picks a random pitch, then snaps to the nearest scale degree. Handled per-grain in `Voice._onScheduleGrain()` via `pitchQuantize` config.
   - Scale intervals (semitones from root): Chromatic [0–11], Major [0,2,4,5,7,9,11], Minor [0,2,3,5,7,8,10], Pentatonic [0,2,4,7,9].

**Per-grain randomization architecture:**

Randomization runs at the engine level (per-grain), not in `resolveParams()` (per-pointer-event). This ensures grains vary even when the user holds their finger still. `resolveParams()` computes min/max ranges in engine units and passes them to the Voice/Scheduler:

- `randomize.grainSize`: `[min, max]` in seconds, or `null` → Voice picks per-grain
- `randomize.pitch`: `[-2, 2]` in log2 space, or `null` → Voice picks per-grain
- `interOnsetRange`: `[min, max]` in seconds, or `null` → Scheduler picks per-grain
- `grainSizeQuantize`: `{ bpm }` or `null` → Voice snaps after randomization
- `interOnsetQuantize`: `{ bpm }` or `null` → Scheduler snaps after randomization
- `pitchQuantize`: `{ scale, rootNote }` or `null` → Voice snaps after randomization

**Visual feedback:**

1. **Canvas (GrainOverlay):** Grains are positioned vertically by pitch (log2 scale: center = unity, top = +2 oct, bottom = −2 oct). Pitch randomization visually scatters grains vertically; quantized pitch clusters them at discrete Y positions (scale degrees). Grain width reflects duration. Voice color coding.

2. **Slider pane (random-range-bar):** When randomization is active on grain size or density, a pulsing bar (CSS `random-pulse` animation, 1.2s cycle, opacity 0.25–0.55) appears between the min and max slider thumbs, showing the randomization range. Positioned dynamically via `ParameterPanel.updateRandomIndicators()` called each frame.

**UI layout:**

- Collapsible `<details>` section titled "Rhythm and Harmony" before "Sound Engine" and "Gesture Mapping".
- Contents: BPM slider + tap-tempo button, Root Note dropdown, Scale dropdown.
- Quantize toggles row: three checkboxes for Grain Size, Density, Pitch.
- Randomize toggles row: three checkboxes for Grain Size, Density, Pitch.

**Key files:**

- `src/utils/musicalQuantizer.js` — `SCALES`, `SUBDIVISIONS` (10 entries with triplets), `quantizePitch()`, `quantizeDensity()`, `rateToSemitones()`/`semitonesToRate()`, `normalizedToSubdivision()`, `getSubdivisionSeconds()`
- `src/ui/ParameterPanel.js` — `getMusicalParams()` returns `{ bpm, rootNote, scale, quantizeGrainSize, quantizeDensity, quantizePitch, randomGrainSize, randomDensity, randomPitch }`. Slider display refresh methods for grain size and density. Random-range-bar indicator logic.
- `src/main.js` — `resolveParams()` handles all mode combinations, defers per-grain work to engine
- `src/audio/Voice.js` — `_onScheduleGrain()` applies per-grain grain size randomization + quantization, per-grain pitch randomization + quantization
- `src/audio/GrainScheduler.js` — `_tick()` applies per-grain density randomization + quantization via `quantizeBpm`
- `src/audio/grainFactory.js` — `onGrain` callback includes `pitch` for overlay visualization
- `src/ui/GrainOverlay.js` — pitch-based Y positioning for grain rectangles

**Deliverable**: All three core parameters (grain size, density, pitch) can independently be quantized to a BPM grid or musical scale, randomized per-grain, or both. When combined, randomization picks from the quantized grid. Visual feedback on both the canvas (pitch-as-Y scatter) and the slider pane (pulsing range bars) makes the behavior immediately understandable.

---

### Step 2.8 — Fix Quantized Slider Directions, Arpeggiator Patterns & Randomization Distribution

Three issues to address in the quantization/randomization system before moving to Phase 3.

#### 2.8a — Fix reversed slider direction in quantized mode

**Problem:** The slider direction flips when switching between free and quantized modes, which is disorienting.

- **Grain size free mode:** `expMap(0, 0.001, 1.0)` = 1ms (short) → `expMap(1, 0.001, 1.0)` = 1000ms (long). Slider: **left = short, right = long**.
- **Grain size quantized mode:** `normalizedToSubdivision(0)` → 1/1 = 2000ms (long) → `normalizedToSubdivision(1)` → 1/32 = 62.5ms (short). Slider: **left = long, right = short**. **Reversed!**
- **Density free mode:** `expMap(0, 0.005, 0.5)` = 5ms (dense) → `expMap(1, 0.005, 0.5)` = 500ms (sparse). Slider: **left = dense, right = sparse**.
- **Density quantized mode:** `normalizedToSubdivision(0)` → 1/1 = 2000ms (sparse) → `normalizedToSubdivision(1)` → 1/32 = 62.5ms (dense). Slider: **left = sparse, right = dense**. **Reversed!**

**Fix:** Invert the normalized value before the subdivision lookup when used for grain size and density: use `normalizedToSubdivision(1 - norm)` instead of `normalizedToSubdivision(norm)`. This way slider-left stays "small/fast" and slider-right stays "large/slow", matching the free mode direction.

**Files to modify:**
- `src/main.js` — `resolveParams()`: all `normalizedToSubdivision()` calls for grain size and density (both the direct snap and the min/max bounds for randomization)
- `src/ui/ParameterPanel.js` — `_refreshGrainSizeDisplay()` and `_refreshDensityDisplay()`: invert when computing subdivision labels

#### 2.8b — Arpeggiator patterns for pitch randomization

**Concept:** When pitch randomization is active with quantization, instead of pure random scale-degree selection, offer pattern modes that cycle through notes musically:

**Pattern modes:**
| Pattern | Behavior |
|---------|----------|
| Random | Current behavior — each grain picks a random scale degree in range |
| Up | Ascend through scale degrees in range, wrap to bottom when reaching top |
| Down | Descend through scale degrees, wrap to top when reaching bottom |
| Up-Down | Ping-pong — ascend then descend, reversing at boundaries |

**Implementation:**

1. **Pre-compute the note table:** Given a scale, root note, and ±2 octave range, enumerate all valid MIDI-like semitone values. For example, C minor pentatonic over ±2 octaves = ~20 discrete pitches. Store as a sorted array of semitone values.

2. **Arpeggiator state per voice (`Voice.js`):**
   - `arpIndex`: current position in the note table (integer)
   - `arpDirection`: +1 (ascending) or −1 (descending), used for up-down mode
   - Reset `arpIndex` to 0 (or nearest note to current pitch) on voice start
   - Advance `arpIndex` per grain in `_onScheduleGrain()`

3. **Pattern logic in `_onScheduleGrain()`:**
   - **Random:** pick `noteTable[Math.floor(Math.random() * noteTable.length)]` (current behavior, but now from pre-computed table instead of continuous random + snap)
   - **Up:** `pitch = noteTable[arpIndex % noteTable.length]; arpIndex++`
   - **Down:** `pitch = noteTable[noteTable.length - 1 - (arpIndex % noteTable.length)]; arpIndex++`
   - **Up-Down:** advance `arpIndex` by `arpDirection`; reverse direction at boundaries

4. **UI:** Add a `<select>` dropdown for arp pattern (Random / Up / Down / Up-Down) in the Musical section, visible when "Randomize Pitch" is checked. Alternatively, always visible next to the pitch randomize toggle.

5. **Config flow:** `resolveParams()` passes `pitchQuantize.pattern` and `pitchQuantize.noteTable` (pre-computed). Voice stores the arp state and steps through the table per grain.

**Files to modify:**
- `src/utils/musicalQuantizer.js` — add `buildNoteTable(scale, rootNote, minSemitones, maxSemitones)` → sorted array of valid semitone values
- `src/audio/Voice.js` — arpeggiator state (`arpIndex`, `arpDirection`), pattern logic in `_onScheduleGrain()`
- `src/main.js` — `resolveParams()` passes pattern mode + note table
- `src/ui/ParameterPanel.js` — new `<select>` for arp pattern, exposed in `getMusicalParams()`
- `index.html` — arp pattern dropdown element
- `style.css` — optional styling for conditional visibility

#### 2.8c — Review randomization distribution for grain size and density

**Problem:** Randomization picks uniformly in **linear seconds** space, but the parameter mappings are exponential (`expMap`). This creates a perceptual bias: longer durations (which span larger absolute ranges) are overrepresented, while short durations (where the perceptual detail lives) are underrepresented.

Example at a grain size range of 10ms–500ms:
- A uniform random in [0.01, 0.5] seconds lands in [250ms, 500ms] **half the time** — that's only the top 50% of the value range but only the last octave of a ~5.6 octave span.
- The bottom octave (10ms–20ms) only has a 2% chance of being picked.

**Same issue for density:** `interOnsetRange` is in linear seconds, so sparse values (long inter-onset) dominate.

**When quantized + randomized:** Even worse — the quantization snap makes subdivision selection uneven because subdivisions are spaced exponentially (each doubles in rate), but the random input is linear. Subdivisions near the "long" end of the range attract more random hits.

**Fix — randomize in normalized space, apply mapping per grain:**

Instead of pre-computing min/max in engine units and randomizing between them, pass the normalized slider range to the engine and apply `expMap` (or subdivision lookup) per grain:

1. `resolveParams()` passes `randomize.grainSize = [normMin, normMax]` (normalized 0–1) instead of `[expMap(min), expMap(max)]`.
2. `Voice._onScheduleGrain()` picks `norm = lerp(normMin, normMax, Math.random())`, then applies `duration = expMap(norm, 0.001, 1.0)`. This gives perceptually uniform distribution across the slider range.
3. Same for density: `interOnsetRange` passes normalized values; `GrainScheduler._tick()` applies `expMap(norm, 0.005, 0.5)` per grain.
4. **For quantized + randomized:** pick a random normalized value in `[normMin, normMax]`, then call `normalizedToSubdivision(1 - norm)` → `getSubdivisionSeconds(bpm, divisor)`. Since subdivisions are evenly spaced in normalized slider space (linearly indexed), each subdivision has an equal probability of being selected. This is musically fair.

**Alternative (simpler, for quantized only):** Enumerate all valid subdivisions between min and max indices, pick uniformly from the list. This guarantees exactly equal probability per subdivision regardless of their duration ratio.

**Files to modify:**
- `src/main.js` — `resolveParams()`: pass normalized ranges instead of engine-unit ranges
- `src/audio/Voice.js` — `_onScheduleGrain()`: apply expMap or subdivision lookup per grain
- `src/audio/GrainScheduler.js` — `_tick()`: apply expMap or subdivision lookup per grain for density
- `src/utils/math.js` — may need to export `expMap` for use in Voice/Scheduler (already exported)

**Deliverable:** Slider directions are consistent between free and quantized modes. Pitch randomization supports musical arpeggiator patterns (up, down, up-down, random). Grain size and density randomization use perceptually uniform distribution that treats each region of the slider equally.

---

### Step 2.9 — Context-Aware Parameter Relevance (Dim/Disable Inactive Controls)

**Goal:** Make the UI self-documenting by visually indicating which controls actually affect the current audio output. When a parameter has no effect given the current mode configuration, dim or disable it so the user immediately understands what matters and what doesn't.

**Problem:** The panel currently shows all parameters at full visibility regardless of mode. A user can spend time adjusting a slider that does nothing in the active configuration. Examples:

- Min sliders for grain size, density, and spread do nothing unless a gesture dimension is mapped to that parameter or randomization is active — without those, only the Max value is used.
- BPM slider has no effect unless at least one of the three quantize toggles is checked.
- Root Note and Scale dropdowns have no audible effect unless Quantize Pitch is on (or an arp pattern other than Random is selected with Randomize Pitch).
- The Arp Pattern and Pitch Range controls only matter when Randomize Pitch is on (already handled via visibility toggle).
- Gesture mapping dropdowns for Pressure and Contact Size show "not detected" badges, which is sufficient — they stay always visible and interactive.

**Approach — CSS class `param-inactive` toggled by JS:**

Each control group (`<div class="param-group">`) gets a CSS class `param-inactive` when its contents have no effect. The class applies:
- `opacity: 0.35` on the group (dims labels, sliders, values)
- `pointer-events: none` on inputs (prevents interaction)
- A subtle transition (`opacity 0.2s`) for smooth visual feedback

A method `ParameterPanel.updateParamRelevance(musicalParams)` (called each frame from the render loop, or on change events) evaluates the current configuration and toggles the class.

**Rules for each control:**

| Control | Active when... |
|---------|---------------|
| Grain Size **Min** slider | Randomize Grain Size is on, OR a gesture dimension is mapped to `grainSize` |
| Density **Min** slider | Randomize Density is on, OR a gesture dimension is mapped to `density` |
| Spread **Min** slider | A gesture dimension is mapped to `spread` |
| BPM slider + Tap Tempo | At least one Quantize toggle is checked (grain size, density, or pitch) |
| Root Note dropdown | Quantize Pitch is on, OR Randomize Pitch is on with arp pattern ≠ Random |
| Scale dropdown | Same as Root Note |
| Quantize Grain Size toggle | Always active (it's a mode switch) |
| Quantize Density toggle | Always active |
| Quantize Pitch toggle | Always active |
| Randomize toggles | Always active |
| Arp Pattern | Randomize Pitch is on (already visibility-toggled) |
| Pitch Range | Randomize Pitch is on (already visibility-toggled) |
| Pressure mapping | Always visible (badge shows detection status) |
| Contact Size mapping | Always visible (badge shows detection status) |
| Velocity mapping | Always active |

**Implementation outline:**

1. **CSS**: Add `.param-inactive` and `.range-row-inactive` styles:
   ```css
   .param-inactive {
       opacity: 0.35;
       pointer-events: none;
       transition: opacity 0.2s;
   }
   .range-row-inactive {
       opacity: 0.35;
       pointer-events: none;
       transition: opacity 0.2s;
   }
   ```
   Use `.range-row-inactive` for individual min rows within a range-group (dimming just the min row, not the whole group).

2. **ParameterPanel.js**: Add `updateParamRelevance(musicalParams, gestureCapabilities)` method:
   - Receives current musical params and device capability flags.
   - For each control, evaluates the rule above and toggles the CSS class.
   - For min sliders specifically: check if any gesture mapping targets that parameter OR if the corresponding randomize toggle is on. If neither, add `range-row-inactive` to the min row.

3. **main.js render loop**: Call `params.updateParamRelevance(params.getMusicalParams(), pointer.capabilities)` each frame (lightweight — just class toggling, no DOM layout changes).

**Edge cases:**
- When a control transitions from inactive → active (e.g., user checks Quantize Density), the BPM slider smoothly fades in. Any value previously set remains — we don't reset dimmed controls.
- `pointer-events: none` prevents accidental changes to dimmed controls but doesn't affect programmatic updates.
- On mobile, dimmed controls shouldn't interfere with touch events on adjacent active controls (the `pointer-events: none` handles this).

**Files to modify:**
- `style.css` — `.param-inactive`, `.range-row-inactive` rules
- `src/ui/ParameterPanel.js` — `updateParamRelevance()` method, DOM references for each control group
- `src/main.js` — call `updateParamRelevance()` in the render loop

**Deliverable:** Inactive parameters are visually dimmed and non-interactive. The user can instantly see which controls affect the current sound. The UI feels more intentional and less overwhelming, especially for new users.

---

## Phase 3 — Multi-Instance Architecture with Tab UI [COMPLETE]

**Goal**: Refactor the app so each tab is an independent granular instrument with its own sample, parameters, and (eventually) automation. All instances share a single AudioContext and master output chain. Multi-touch resolves to the active tab only. One set of DOM controls, state swapped on tab switch (DAW channel strip pattern).

**Duration**: ~2 weeks

---

### Step 3.1 — Refactor GranularEngine for Dependency Injection [DONE]

**Goal:** Extract the master output chain so multiple engines can share one AudioContext.

**Tasks:**
- Create `src/audio/MasterBus.js` — owns `AudioContext`, builds the master chain: `masterGain → limiter → softClipper → analyser → destination`. Exposes `resume()`, `setMasterVolume()`, `audioContext`, `masterGain` (as connection point for engine instances), and `analyser` (for LevelMeter).
- Modify `src/audio/GranularEngine.js` — constructor becomes `constructor(audioContext, destination)`. Creates only `instanceGain` (GainNode) + `VoiceAllocator`. Remove AudioContext creation, master chain nodes, and `resume()`. Rename `setMasterVolume()` → `setInstanceVolume()`.
- `_updateVoiceGains()` anti-clipping logic stays in the engine (per-instance voice count scaling).

**Files:** Create `src/audio/MasterBus.js`, modify `src/audio/GranularEngine.js`

**Deliverable:** Multiple `GranularEngine` instances can be created against the same AudioContext, each feeding into the shared master bus.

---

### Step 3.2 — Instance State Model [DONE]

**Goal:** Define a serializable state snapshot capturing everything about one sampler instance.

**Tasks:**
- Create `src/state/InstanceState.js` — holds: `id`, `name`, all grain param values (grainSize min/max, density min/max, spread min/max, pan, volume, envelope, mappings), all musical params (bpm, rootNote, scale, quantize/random toggles, arpPattern, pitchRange), ADSR state `{a, d, s, r}`, and sample reference (url, fileName, displayName).
- Defaults match the current HTML attribute values.
- `toJSON()` / `fromJSON()` for serialization.
- The `AudioBuffer` is **not** serialized (too large, non-serializable). Only the sample URL/filename is stored.

**Files:** Create `src/state/InstanceState.js`

**Deliverable:** A complete, serializable state snapshot that can be saved/restored on tab switch.

---

### Step 3.3 — ParameterPanel Save/Restore [DONE]

**Goal:** Add `getFullState()` and `setFullState(state)` methods so the single set of DOM controls can be swapped to reflect any instance's parameters.

**Tasks:**
- Add `getFullState()` to `ParameterPanel` — returns combined `getParams()` + `getMusicalParams()` + volume slider value + ADSR state.
- Add `setFullState(state)` to `ParameterPanel` — programmatically sets all slider `.value`, select `.value`, checkbox `.checked` properties. Refreshes all display labels. Restores ADSR widget state. Calls `_updateADSRVisibility()` and `_updateArpVisibility()`. Does **not** fire onChange/onVolumeChange callbacks.
- Add `getState()` / `setState({a, d, s, r})` to `ADSRWidget` — updates internal state, calls `setCustomADSR()` from `envelopes.js`, and redraws.

**Files:** Modify `src/ui/ParameterPanel.js`, modify `src/ui/ADSRWidget.js`

**Deliverable:** `panel.setFullState(savedState)` instantly updates all DOM controls without triggering change callbacks.

---

### Step 3.4 — InstanceManager [DONE]

**Goal:** Central orchestrator for instance lifecycle: create, destroy, switch, route audio.

**Tasks:**
- Create `src/state/InstanceManager.js` with:
  - `createInstance(name)` — creates `GranularEngine`, `GrainOverlay`, `InstanceState`. Stores in `Map<id, {state, engine, grainOverlay, buffer}>`. Auto-switches if first instance.
  - `switchTo(id)` — saves current panel state to current instance, restores target instance's state into the panel, swaps waveform buffer, updates `onGrain` callback, calls `onTabsChanged`.
  - `removeInstance(id)` — stops voices, disconnects engine, removes. Can't remove last instance.
  - `getActive()` — returns `{state, engine, grainOverlay, buffer}` of active instance.
  - `getTabList()` — returns `[{id, name, isActive}]` for tab bar rendering.
  - `renameInstance(id, name)`.
  - `onTabsChanged` — callback for the tab bar to re-render.

**Files:** Create `src/state/InstanceManager.js`

**Deliverable:** InstanceManager can create multiple instances, switch between them with full state preservation, and remove instances cleanly.

---

### Step 3.5 — Tab Bar UI [DONE]

**Goal:** Horizontal tab strip for creating, switching, renaming, and closing instances.

**Tasks:**
- Add `<div id="tab-bar"><div id="tab-list"></div><button id="tab-add">+</button></div>` to `index.html` between `#top-bar` and `#main-area`.
- Create `src/ui/TabBar.js`:
  - `render(tabs)` — dynamically creates tab buttons from `[{id, name, isActive}]`.
  - Active tab gets `.tab-active` class (accent border, brighter text).
  - Close button (×) on each tab, hidden when only one tab exists.
  - Double-click tab label to rename.
  - "+" button always at the end.
- Add CSS: flex row, scrollable overflow, accent styling for active tab, close button on hover.

**Files:** Create `src/ui/TabBar.js`, modify `index.html`, modify `style.css`

**Deliverable:** Functional tab bar that renders dynamically and fires callbacks for switch, close, rename, add.

---

### Step 3.6 — Wire main.js to InstanceManager [DONE]

**Goal:** Replace global singletons with InstanceManager routing.

**Tasks:**
- Replace `new GranularEngine()` with `new MasterBus()` + `new InstanceManager(...)`.
- `LevelMeter` uses `masterBus.analyser`.
- Audio unlock uses `masterBus.resume()`.
- Pointer callbacks route to `instanceManager.getActive().engine`.
- `onChange` callback updates voices on the active engine.
- Sample loading stores buffer + metadata in the active instance.
- Render loop draws the active instance's `grainOverlay`.
- Tab switch: force-stop all active pointer voices before switching, save/restore state, swap waveform buffer, update sample name display and sample selector dropdown.
- Wire `TabBar` callbacks to `InstanceManager` methods.
- Create initial default instance on startup, auto-load the selected sample into it.

**Files:** Modify `src/main.js` (major rewrite of initialization and callback wiring)

**Deliverable:** The app initializes with one tab and works identically to before. Users can add tabs, switch between them, and each tab is fully independent.

---

### Step 3.7 — Integration Testing [DONE]

**Tasks:**
- Create 3 tabs with different samples and parameters, verify full independence.
- Switch tabs: sliders snap to correct values, waveform changes, ADSR updates, sample name updates.
- Multi-touch during tab switch: voices stop cleanly, no orphaned audio.
- Close active tab: switches to adjacent, no crashes.
- Close non-active tab: active tab unaffected.
- Rapid tab switching: no race conditions.
- Performance: 5 instances loaded, no audio glitches.

**Deliverable:** All scenarios pass. Architecture is ready for Phase 4 automation.

---

### Step 3.8 — Arpeggiator Enhancement [DONE]

**Goal**: Replace the limited 4-pattern arpeggiator (up, down, updown, random) with a permutation-based system inspired by [CodePen jak_e/qNrZyw](https://codepen.io/jak_e/pen/qNrZyw). Expand from 4 scales to 14. Add arp steps, type (straight/looped), and shape (permutation selection with SVG preview).

#### 3.8a — Expand scales + add permutation functions (`musicalQuantizer.js`)

Pure utility additions, no side effects.

- Expand `SCALES` object with: dorian, phrygian, lydian, mixolydian, locrian, harmonicMinor, melodicMinor, blues, wholeTone, minorPentatonic
- Add `generatePermutations(n)` — Heap's algorithm, returns all permutations of [0..n-1]
- Add `getPermutations(n)` — cached wrapper (avoids recomputing 720 arrays)
- Add `selectArpNotes(noteTable, steps)` — picks N evenly spaced notes from full note table
- Add `applyArpType(pattern, type)` — 'straight' returns as-is, 'looped' returns palindrome minus endpoints

#### 3.8b — Add state fields (`InstanceState.js`)

- Add `arpSteps: 4`, `arpType: 'straight'`, `arpStyle: 0`
- Change `arpPattern` default semantics: 'random' or 'arpeggiator' (old 'up'/'down'/'updown' deprecated)

#### 3.8c — Update Voice arp logic (`Voice.js`)

In `_onScheduleGrain()`, add a new branch before the existing noteTable logic. The Voice walks `arpSequence` cyclically, using each value as an index into `arpNotes`.

#### 3.8d — Update resolveParams (`main.js`)

- Import new functions: `selectArpNotes`, `getPermutations`, `applyArpType`
- When `arpPattern === 'arpeggiator'`: build `arpNotes` + `arpSequence` from steps/type/style
- When `arpPattern === 'random'`: use existing noteTable path

#### 3.8e — UI: HTML + ParameterPanel + CSS

**index.html:** Expand scale `<select>` with 14 options. Replace arp-pattern-group: Arp Mode (random/arpeggiator), Arp Steps (range 3–6), Arp Type (straight/looped), Arp Shape (prev/next buttons + SVG polyline + counter). Controls hidden by default, shown when randomPitch on + mode is arpeggiator.

**ParameterPanel.js:** Import `getPermutations`, `applyArpType`. Wire new DOM elements. Add `_updateArpStyleDisplay()` to draw SVG polyline. Update visibility, `getMusicalParams()`, `setFullState()`.

**style.css:** `.arp-style-nav` flex row, `.arp-style-preview` inline SVG, `.arp-style-group` full grid width.

**Deliverable:** Permutation-based arpeggiator with 14 scales, configurable steps/type/shape, SVG pattern preview, full tab persistence.

---

### Step 3.9 — Session Persistence [DONE]

**Goal:** Auto-save the entire workspace to localStorage (survives page reloads) and support JSON file export/import for sharing and backup.

**Design decisions:**
- **Session scope only** — saves/loads the entire workspace (all tabs), no per-instance presets.
- **Sample references only** — stores `sampleUrl`/`sampleFileName`, not audio data. Bundled samples auto-reload by URL. User-uploaded files are marked as missing with a ⚠ warning indicator.
- **Debounced auto-save (500ms)** — avoids excessive writes during slider drags.
- **`beforeunload` flush** — catches final state on tab close.
- **Version field** — `version: 1` in JSON envelope for future migration.
- **`granul8: true` marker** — cheap validation to reject non-Granul8 JSON files.

**Session JSON schema:**
```json
{
    "granul8": true,
    "version": 1,
    "savedAt": "2026-02-19T14:30:00Z",
    "activeInstanceId": "abc-123",
    "instances": [
        { /* InstanceState.toJSON() output for each tab */ }
    ]
}
```

**Implementation:**

- **`src/state/SessionSerializer.js`** (new) — `serializeSession(instanceManager, panel)`, `validateSession(json)`, `getBundledSampleUrls(sampleSelectEl)`.
- **`src/state/SessionPersistence.js`** (new) — `SessionPersistence` class with debounced save, `saveNow()`, `load()`, `disable()`/`enable()`. Plus `exportSessionFile(session)` and `readSessionFile(file)` utilities.
- **`src/state/InstanceManager.js`** (modified) — Added `restoreFromSession(sessionData, onInstanceCreated)` method.
- **`src/utils/fileLoader.js`** (modified) — Exported `isAudioFile`, removed audio filter from drop handler to allow JSON routing.
- **`index.html`** (modified) — Added Export/Import buttons + hidden file input in `#file-controls`.
- **`style.css`** (modified) — Button styles, `.file-controls-sep` divider, `.session-toast` notification.
- **`src/main.js`** (modified) — Session init, auto-save triggers in all change callbacks, `beforeunload` handler, restore-or-create on startup, export/import wiring, drag-and-drop file routing (`.json` → import, audio → load), `showNotification()` toast helper.

**Deliverable:** Session state auto-persists across page reloads. Users can export/import sessions as JSON files. Drag-and-drop routes `.json` files to session import and audio files to sample loading.

---

## Phase 4 — Gesture Recording & Automation Playback

**Goal**: Let users record their multi-touch performances and play them back as automation, enabling composition and layering. Think of it as recording automation lanes in a DAW, but for gestural parameters.

**Duration**: ~2.5 weeks

---

### Step 4.1 — Automation Data Model [DONE]

Define the data structures for recording and playback.

**Tasks**:
- Create `src/automation/AutomationLane.js`:
  - Stores an array of `AutomationEvent` objects:
    ```
    {
        time: number,          // seconds since recording start
        voiceIndex: number,    // 0-based voice slot
        type: 'start' | 'move' | 'stop',
        params: {
            position: number,
            amplitude: number,
            pitch: number,      // snapshot of current global pitch
            grainSize: number,  // snapshot of current grain size
            spread: number,
            pan: number
        }
    }
    ```
  - `addEvent(event)` — appends to the array.
  - `getEventsInRange(startTime, endTime)` — returns events within a time window (for playback).
  - `getDuration()` — returns the timestamp of the last event.
  - `clear()` — empties the lane.
  - `toJSON()` / `fromJSON(data)` — serialization for save/load.
- The lane captures complete voice state at each event, not deltas. This makes playback self-contained and random-access friendly.

**Deliverable**: A clean data structure for automation events with serialization support.

---

### Step 4.2 — Gesture Recorder [DONE]

Capture live gestures into an automation lane.

**Tasks**:
- Created `src/automation/Recorder.js`:
  - `startRecording()` — records the current `audioContext.currentTime` as the reference start time. Sets `isRecording = true`.
  - Hooks into `PointerHandler`: when recording is active, every `pointerdown` / `pointermove` / `pointerup` event is captured as an `AutomationEvent` with `time = audioContext.currentTime - recordingStartTime`.
  - Throttle `pointermove` capture to **30 events per second per pointer** using a simple time-since-last-event check. This keeps recordings compact without losing gestural nuance.
  - `stopRecording()` — sets `isRecording = false`, finalizes the automation lane.
  - `getRecording()` — returns the `AutomationLane`.
  - Captures 8 params: position, amplitude, pitch, grainSize, interOnset, spread, pan, envelope.

**Deliverable**: Recording is stored in memory as a structured event array.

---

### Step 4.3 — Transport Controls UI [DONE]

Build the record/play/stop bar.

**Tasks**:
- Created `src/ui/TransportBar.js`:
  - Four buttons: **Record**, **Play**, **Stop**, **Loop**.
  - Time display (`MM:SS.mmm`) and progress bar.
  - Four states: `idle`, `armed`, `recording`, `playing`.
  - Visual feedback: `.recording` pulse, `.playing` accent, `.loop-active` accent.
  - Callbacks: `onRecord`, `onPlay`, `onStop`, `onLoopToggle`.

**Deliverable**: Transport bar with clear visual states.

---

### Step 4.4 — Automation Player [DONE]

Replay recorded gestures through the engine.

**Tasks**:
- Created `src/automation/Player.js`:
  - `play(lane, loop)` — starts playback using `requestAnimationFrame` loop.
  - Synthetic pointer IDs (`1000 + voiceIndex`) to avoid collision with live pointers.
  - Per-frame event dispatch from `AutomationLane.getEventsInRange()`.
  - Loop: stops all voices, restarts from 0. Non-loop: calls `onComplete`.
  - Callbacks: `onDispatch`, `onFrame`, `onComplete`.
- Wired into main.js: player dispatches to active engine, transport bar reflects playback state.

**Deliverable**: Recorded gestures reproduce exactly through the engine.

---

### Step 4.4b — Automation Architecture Refactoring [DONE]

Refactored the automation system for production use with three architectural changes:

**R1 — Master BPM (global, not per-instance)**:
- Removed `bpm` field from `InstanceState` constructor and serialization.
- Moved BPM slider and tap-tempo ownership from `ParameterPanel` to `main.js`. Added `getMasterBpm()` global function.
- `ParameterPanel.getMusicalParams()` no longer returns `bpm`. `setFullState()` no longer writes BPM.
- `ParameterPanel` keeps `_bpmGroup` DOM ref for dimming in `updateParamRelevance()` only; new `refreshQuantizedDisplays()` public method called from `main.js` when BPM changes.
- `resolveParams()` in `main.js` reads BPM from the global slider. Voice `grainSizeQuantize` and `interOnsetQuantize` use the global BPM.
- `SessionSerializer.serializeSession()` takes a `masterBpm` parameter, stores it at the root level of the session JSON. Startup/import restores BPM slider from session data (defaults to 120 for backward compatibility).

**R2 — Per-tab Recorder & Player**:
- Each `InstanceManager` entry now holds `{ state, engine, grainOverlay, buffer, recorder, player }`.
- `createInstance()` creates a `Recorder` and `Player` per instance. Player `onDispatch` routes to its own engine via closure (not `getActive()`).
- Player `onFrame`/`onComplete` callbacks have active-tab guards: only update transport when the player's instance is the active tab.
- `switchTo()` stops recording on old tab. `removeInstance()` and `restoreFromSession()` handle recorder/player lifecycle.
- Global `recorder`/`player` singletons removed from `main.js`. All references go through `instanceManager.getActive().recorder`/`.player`.
- `recorderPointerMap` stays global (maps live pointers for the active tab).
- `instanceManager.onPlayerFrame`/`onPlayerComplete` callbacks route player events to the transport bar.

**R3 — Arm-to-Record**:
- Added `'armed'` transport state to `TransportBar`. Record button arms recording; first pointer touch on waveform starts actual recording; clicking Record again while armed disarms (toggle).
- `TransportBar._updateButtons()` handles `'armed'` case: `.armed` CSS class, stop enabled, play/loop disabled.
- `style.css` adds armed visual: accent border, slow 1.5s pulse animation (visually distinct from recording's faster pulse).
- Pointer `onStart` in `main.js` checks `transport.state === 'armed'` to trigger `recorder.startRecording()`.
- Stop callback handles all states (armed, recording, playing).

**Files**: `InstanceState.js`, `ParameterPanel.js`, `InstanceManager.js`, `TransportBar.js`, `SessionSerializer.js`, `style.css`, `main.js`

**Deliverable**: Per-tab automation with arm-to-record and synchronized master BPM.

---

### Step 4.4c — Keyboard Shortcut 'R' for Record [DONE]

Add keyboard shortcut so pressing 'R' triggers the same behavior as clicking the record button (arm, disarm, or stop recording).

**Tasks**:
- Add a `keydown` listener on `document` in `main.js`.
- Guard against firing when focus is in an `INPUT`, `TEXTAREA`, or `SELECT` element.
- Call `transport.onRecord()` to reuse the existing arm/disarm/stop-recording logic.

**Files**: `main.js`

**Deliverable**: 'R' key toggles record arm/disarm/stop, identical to clicking the record button.

---

### Step 4.4d — Background Playback on Tab Switch [DONE]

Allow playback to continue in the background when the user switches tabs. Only recording stops on tab switch.

**Tasks**:
- Remove `current.player.stop()` from `InstanceManager.switchTo()` (keep `current.recorder.stopRecording()`).
- In `main.js` tab `onSwitch`, check the target tab's player state: if playing, set transport to `'playing'`; if idle, set to `'idle'`. Don't reset the display if the target tab is playing.
- Player already dispatches to its own engine via closure, so audio continues automatically in the background.
- Player `onFrame`/`onComplete` already have active-tab guards, so transport only updates when viewing the playing tab.

**Edge cases**: Tab switch while target is playing (transport catches up on next frame). Close a tab with background playback (`removeInstance()` stops the player). Stop button only affects the active tab's player.

**Files**: `InstanceManager.js`, `main.js`

**Deliverable**: Playback continues across tab switches. Transport reflects the active tab's playback state.

---

### Step 4.5a — Per-Instance Volume (Layer Volume) [DONE]

Each instance/layer should have its own volume control that affects only its audio output. Previously the volume slider controlled `masterBus.setMasterVolume()` which affected ALL instances simultaneously.

**What was implemented:**
- `GranularEngine.setInstanceVolume(value)` — new method that ramps `instanceGain.gain` with a 20ms `linearRampToValueAtTime`. The `instanceGain` GainNode (which was always 1.0) now carries the per-instance volume.
- `main.js` `onVolumeChange` — changed from `masterBus.setMasterVolume(v)` to `active.engine.setInstanceVolume(v)`.
- `InstanceManager.switchTo()` — changed from `this.masterBus.setMasterVolume(target.state.volume)` to `target.engine.setInstanceVolume(target.state.volume)`. Master volume stays untouched across tab switches.
- `InstanceManager.createInstance()` — applies `engine.setInstanceVolume(state.volume)` on new instances so they start at the correct level.
- `InstanceManager.restoreFromSession()` — applies `engine.setInstanceVolume(state.volume)` for each restored instance (was using `masterBus.setMasterVolume` before). The active instance line also updated.
- New **master volume control** (`#master-volume`) added to the top bar in `index.html` with label, range slider (0–1, default 0.7), and value display. Wired in `main.js` to `masterBus.setMasterVolume()`.
- `SessionSerializer.serializeSession()` — new `masterVolume` parameter. Serialized alongside `masterBpm`.
- Session restore (`initializeSession`, `importSessionFromFile`) — restores master volume from session data with backward-compatible default of 0.7.
- Export button passes `masterVolume` to `serializeSession()`.

**CSS:** `#master-volume-control` styles in `style.css` — flex layout with gap, 80px slider, 11px value display, `margin-left: auto` to push it right before the theme toggle.

**Signal flow (after):**
```
Per-instance volume slider → engine.instanceGain (per-layer)
Master volume slider → masterBus.masterGain (global)
instanceGain → masterGain → limiter → softClipper → analyser → destination
```

**Files:** `GranularEngine.js`, `main.js`, `InstanceManager.js`, `SessionSerializer.js`, `index.html`, `style.css`

**Deliverable:** Each tab has independent volume. A master volume in the top bar controls the overall output level across all layers.

---

### Step 4.5b — Wire ADSR Envelope to Grain Generation [DONE]

The ADSR widget updated `InstanceState.adsr` and the `ADSRWidget` drew the envelope shape, but the custom ADSR curve was **never passed to `grainFactory.createGrain()`**. Grains always used the preset window functions (Hann/Tukey/Triangle). Additionally, the old approach used a global `setCustomADSR()` module variable, so background instances playing with `envelope: 'custom'` would use the active tab's ADSR, not their own.

**What was implemented:**

The fix passes ADSR values explicitly through the grain params chain, avoiding the global entirely for per-instance correctness:

1. **`envelopes.js`** — New export `computeADSREnvelope(adsr, length)`:
   - Accepts explicit `{ a, d, s, r }` params (not the global).
   - Uses a cache keyed by rounded ADSR values (`adsr:0.200:0.150:0.700:0.200:128`) for performance.
   - Delegates to `_computeADSRFromParams(a, d, s, r, length)` — a standalone ADSR polyline generator.
   - The global `setCustomADSR()` / `getCustomADSR()` remain for the `ADSRWidget` UI preview but are no longer used for grain generation.

2. **`grainFactory.js`** — Updated `createGrain()`:
   - Imports `computeADSREnvelope` from `envelopes.js`.
   - When `envelope === 'custom' && params.adsr`, uses `computeADSREnvelope(params.adsr, ENVELOPE_LENGTH)` instead of `getEnvelope('custom', ...)`.
   - Falls back to the old `getEnvelope()` path if no ADSR params are provided (backward compat).

3. **`Voice.js`** — Added `adsr` to the params chain:
   - `this.params.adsr = null` default in constructor.
   - `update()` stores `params.adsr` when provided.
   - `_onScheduleGrain()` passes `adsr: this.params.adsr` in the grain params object.

4. **`ParameterPanel.getParams()`** — Now includes `adsr` when `envelope === 'custom'`:
   - Returns `this._adsrWidget.getState()` (or `null` if not custom).

5. **`main.js` `resolveParams()`** — Passes `adsr: p.adsr` through to the engine.

6. **`Recorder.js` `extractParams()`** — Captures `resolved.adsr` in automation events so playback reproduces the correct ADSR shape.

**Data flow:**
```
ParameterPanel.getParams() → resolveParams() → Voice.update() →
Voice._onScheduleGrain() → createGrain() → computeADSREnvelope()
```

**Files:** `envelopes.js`, `grainFactory.js`, `Voice.js`, `ParameterPanel.js`, `main.js`, `Recorder.js`

**Deliverable:** The ADSR widget shapes the grain envelope per-instance. Dragging the ADSR control points audibly changes the grain character. Background instances use their own ADSR, not the active tab's.

---

### Step 4.5c — Pan Randomization [DONE]

Grain size, density, and pitch all supported per-grain randomization with optional quantization. Pan did not — it was a single fixed value per instance.

**What was implemented:**

Pan was converted from a single slider to a min/max range following the same pattern as grain size, density, and spread:

1. **`InstanceState.js`** — Replaced `pan` with `panMin: 0` and `panMax: 0`. Added `randomPan: false`. Added backward compat in `fromJSON()`: if old session data has `pan` but no `panMin`, migrates `pan → panMin/panMax`.

2. **`index.html`** — Pan section converted from a single `<input type="range">` to a `.range-group` with Min/Max range rows (matching grainSize/density/spread pattern). Range is -1 to 1 with step 0.01. Added gesture indicator and random-range-bar divs. Added "Pan" toggle label in the Randomize toggles row (`#random-pan`).

3. **`ParameterPanel.js`** — Pan added to `RANGE_PARAMS` array (with display `n => parseFloat(n).toFixed(2)`). Removed `param-pan` from `SIMPLE_SLIDERS`. All range infrastructure (min≤max constraint, display update, gesture indicator, random bar) now handles pan automatically. Specific changes:
   - `_randomPan` element reference and event listener added.
   - `_randomBars` and `_randomBars` loop now includes `'pan'`.
   - `_panMinRow` dimming reference for `updateParamRelevance()`.
   - `getParams()` returns `panMin` and `panMax` (not `pan`).
   - `getMusicalParams()` returns `randomPan`.
   - `setFullState()` restores pan range with backward compat (`state.panMin ?? state.pan ?? 0`).
   - `updateRandomIndicators()` handles pan with normalized position calculation accounting for the -1 to 1 slider range (normalizes using `sliderMin`/`sliderMax` attributes instead of assuming 0–1).
   - `updateParamRelevance()` dims pan min row when `!randomPan && !hasMapping('pan')`.

4. **`main.js` `resolveParams()`** — `randomize.pan` set to `[p.panMin, p.panMax]` when `m.randomPan` is true. Return value uses `pan: p.panMax` (max slider is the "primary" value when not randomizing, matching grainSize/density behavior).

5. **`Voice.js`** — `randomize` type updated to include `pan: [number,number]|null`. In `_onScheduleGrain()`, per-grain random pan computed: `rnd.pan[0] + Math.random() * (rnd.pan[1] - rnd.pan[0])`, clamped to [-1, 1]. The resolved `pan` value is passed to `createGrain()` (which already creates a `StereoPannerNode` when pan ≠ 0).

6. **`grainFactory.js`** — No changes needed. The existing spread-based pan variation (`panVariation = spread * 0.5 * random`) is kept as a subtle secondary spatial effect. The explicit per-grain random pan from Voice is the primary pan value.

**Files:** `InstanceState.js`, `ParameterPanel.js`, `main.js`, `Voice.js`, `index.html`

**Deliverable:** Per-grain random panning creates a spatial texture. Grains scatter across the stereo field within the specified pan range. Pan min row dims when not randomizing.

---

### Step 4.5d — Loop Point Editing (Start/End Markers) [DONE]

The Player looped the entire recording from 0 to duration with no way to set a sub-range.

**What was implemented:**

1. **`Player.js`** — Added configurable loop range:
   - New properties: `_loopStart = 0`, `_loopEnd = 0` (0 means "use full duration").
   - `setLoopRange(start, end)` — sets the loop boundaries in seconds.
   - `getLoopRange()` — returns `{ start, end }`, with `end` resolved to `_duration` when 0.
   - `_tick()` modified: computes `loopEnd = this._loopEnd > 0 ? this._loopEnd : this._duration`. When `elapsed >= loopEnd` and looping, restarts from `_loopStart` by setting `_startTime = currentTime - _loopStart` and `_lastProcessedTime = _loopStart`. Non-looping playback plays the full recording regardless of loop range.

2. **`TransportBar.js`** — Loop handle UI with drag interaction:
   - New DOM references: `_progressContainer` (parent of progress bar), `_loopRegion`, `_loopStartHandle`, `_loopEndHandle` (from `index.html` elements).
   - New state: `_loopStartFrac = 0`, `_loopEndFrac = 1`, `_draggingHandle = null`.
   - New callback: `onLoopRangeChange(startFrac, endFrac)` — fired during handle drag.
   - Drag methods: `_beginDrag(e)` captures pointer, `_onHandlePointerMove(e)` computes fraction from pointer X relative to progress container width, enforces min 1% gap between handles, updates positions and fires callback. `_onHandlePointerUp()` cleans up.
   - `_updateLoopHandlePositions()` — sets CSS `left` percentage on handles and `left`/`width` on the loop region overlay.
   - `getLoopRange()` / `setLoopRange(startFrac, endFrac)` / `resetLoopRange()` — public API for external control (e.g., snap-to-grid adjusting handle positions).
   - `_updateButtons()` — toggles `loop-handles-visible` class on the progress container when `_hasRecording && looping`.

3. **`index.html`** — Added loop overlay elements inside `#transport-progress`:
   - `<div id="loop-region">` — colored background showing the active loop range.
   - `<div id="loop-start-handle" class="loop-handle">` and `<div id="loop-end-handle" class="loop-handle">` — draggable vertical markers.

4. **`style.css`** — Loop handle and region styles:
   - `#loop-region`: absolute positioned, accent-dim background at 30% opacity, pointer-events none.
   - `.loop-handle`: 6px wide, 16px tall, `ew-resize` cursor, z-index 3, accent color background with rounded corners.
   - `.loop-handles-visible` class: shows handles and region (hidden by default via `display: none`).

5. **`main.js`** — Wired `transport.onLoopRangeChange`:
   - Converts fractional positions to seconds using recording duration.
   - Calls `active.player.setLoopRange(loopStart, loopEnd)`.
   - Integrates with snap-to-grid logic (see 4.5f).

**Files:** `Player.js`, `TransportBar.js`, `main.js`, `index.html`, `style.css`

**Deliverable:** User can select a sub-range of their recording to loop via draggable handles on the transport bar. The loop region is visually highlighted. Player respects the configured range.

---

### Step 4.5e — BPM Sync Across Layers (Review & Document) [DONE]

**Decision:** Playback keeps absolute timing — recorded params are replayed as-is. BPM changes only affect new live gestures, not existing recordings. This is simpler and predictable: each recording is a faithful reproduction of the original performance.

**What was implemented:**

This was a design review and documentation step, not a code change. The verification confirmed:

1. **Automation events store absolute values** — `Recorder.extractParams()` captures `grainSize` in seconds, `interOnset` in seconds, `pitch` as a playback rate. No BPM-relative values are stored. Changing BPM after recording has no effect on playback.

2. **Loop quantization uses current BPM** — The snap-to-grid logic in `main.js` `onLoopRangeChange` calls `quantizeTimeToGrid(time, getMasterBpm())`, reading the live global BPM at the moment of adjustment, not a stored per-recording BPM.

3. **`agents/CLAUDE.md`** updated with a "BPM & Playback Sync" section documenting:
   - Automation events use absolute timing (seconds, not beats).
   - BPM changes affect only new live gestures, not playback.
   - Loop quantization (4.5f) uses the current global BPM for snap calculations.
   - Player.js description updated to mention configurable `_loopStart`/`_loopEnd`.

**Files:** `agents/CLAUDE.md`

**Deliverable:** BPM sync behavior is documented. Absolute timing is the correct design for a gestural instrument where recordings are performance snapshots, not MIDI-like beat sequences.

---

### Step 4.5f — Loop Quantization to BPM Grid [DONE]

Loop points are arbitrary time positions. If multiple layers loop independently at slightly different durations, they drift apart over time. Quantizing loop boundaries to the BPM grid ensures rhythmic sync.

**What was implemented:**

1. **`musicalQuantizer.js`** — New export `quantizeTimeToGrid(time, bpm, divisor = 4)`:
   - Computes grid size: `(60 / bpm) * (4 / divisor)` — default divisor 4 gives quarter-note grid.
   - Rounds to nearest grid line: `Math.round(time / gridSize) * gridSize`.
   - Example: at 120 BPM, quarter-note grid = 0.5s. A time of 3.37s snaps to 3.5s.

2. **`index.html`** — Added snap-to-grid toggle button (`#btn-snap-grid`) in the transport bar, next to the loop button. Label: "⊞" (grid icon).

3. **`style.css`** — `.snap-btn` base style (matches transport button sizing) and `.snap-btn.snap-active` accent state (matching `.loop-active` pattern).

4. **`main.js`** — Snap-to-grid wiring:
   - `loopSnapToGrid` boolean state, toggled by snap button click.
   - Button click toggles `snap-active` CSS class.
   - `transport.onLoopRangeChange` integrates snap logic:
     ```
     if (loopSnapToGrid) {
         loopStart = quantizeTimeToGrid(loopStart, getMasterBpm());
         loopEnd = quantizeTimeToGrid(loopEnd, getMasterBpm());
         if (loopEnd <= loopStart) loopEnd = loopStart + (60 / bpm);  // min 1 beat
         transport.setLoopRange(loopStart / duration, loopEnd / duration);  // update handle positions
     }
     ```
   - When snap is active, dragging loop handles causes them to "jump" to the nearest beat boundary, and the transport handle positions are updated to reflect the snapped values.
   - Uses `getMasterBpm()` for the current global BPM (not a per-recording value), as decided in 4.5e.

**Multi-layer sync principle:** When all layers have snap-to-grid enabled, their loop lengths become exact multiples of the beat period. At 120 BPM, loops can be 2s (1 bar), 4s (2 bars), 8s (4 bars), etc. — all of which divide evenly, so layers stay in phase indefinitely.

**Files:** `musicalQuantizer.js`, `main.js`, `index.html`, `style.css`

**Deliverable:** Loop boundaries snap to BPM grid when snap-to-grid is active. Handle positions update visually to show the snapped positions. Multi-layer rhythmic sync is achieved through quantized loop lengths.

---

### Step 4.5g — Professional Loop Station System [DONE]

Steps 4.5d-f provided basic loop editing and BPM snap, but had critical limitations for professional loop station use:

1. **Audible gap at loop boundary** — Player hard-stopped all voices (`_stopAllPlaybackVoices()`) with a 30ms fade, then restarted from `loopStart` on the next RAF tick (~16ms later), creating a ~46ms audible gap.
2. **No master clock** — Each tab looped independently with no shared timing reference. Layers drifted.
3. **No metronome** — No audible or visual timing reference for recording.
4. **No quantized transport** — Recording started/stopped at arbitrary times, not on beat/bar boundaries.
5. **No time signature support** — Snap-to-grid assumed quarter-note grid only.

This step replaces/enhances 4.5d-f with a professional-grade loop station system supporting hybrid free-form and loop station modes.

#### 4.5g.1 — MasterClock (`src/audio/MasterClock.js`) [DONE]

**Created** a passive timing calculator anchored to `AudioContext.currentTime`. Does not generate events — provides timing queries.

- Properties: `bpm` (40–300), `numerator` (2–12, beats per bar), `denominator` (4/8/16, beat unit)
- `_epoch`: reference time marking beat 0 / bar 0 (set when playback or recording begins)
- Key methods:
  - `getBeatDuration()` — `(60/bpm) * (4/denominator)` seconds (accounts for different beat units: 4/4 vs 6/8)
  - `getBarDuration()` — `getBeatDuration() * numerator` seconds
  - `setEpoch(time)` — anchor the clock
  - `getBeatPhase(now)` — 0.0–1.0 fraction through current beat (for visual pulse)
  - `getBeatInBar(now)` — 0-based beat index within bar
  - `getNextBeatTime(now)` / `getNextBarTime(now)` — next boundary as AudioContext time
  - `quantizeToBar(time)` / `quantizeToBeat(time)` — snap a time value to grid
  - `quantizeDurationToBar(duration)` — snap a duration to nearest bar multiple (min 1 bar)

**Modified** `MasterBus.js` — Added `this.clock = new MasterClock(this.audioContext)` in constructor.

**Files:** Created `src/audio/MasterClock.js`, modified `src/audio/MasterBus.js`, `src/main.js`

#### 4.5g.2 — Metronome (`src/audio/Metronome.js`) [DONE]

**Created** an audible click track with count-in support. Uses the same look-ahead scheduling pattern as `GrainScheduler` (100ms ahead, 25ms timer interval) for sample-accurate timing.

- **Audio:** Short oscillator sine bursts (~10ms). Downbeat (beat 0): 1000Hz, amplitude 0.8. Other beats: 800Hz, amplitude 0.4.
- **Routing:** Dedicated `GainNode` → `masterBus.masterGain`. Own volume (0–1) and mute toggle. Mute silences audio but keeps timer running (visual beat still works).
- **Count-in:** `startCountIn(callback)` — sets clock epoch to now, plays exactly 1 bar of clicks, then fires callback on the downbeat of the next bar (when recording actually starts).
- **Visual:** `onBeat(beatIndex, isDownbeat)` callback fires (approximately) on each beat via setTimeout. Transport shows beat dots.

**Modified** `MasterBus.js` — Added `this.metronome = new Metronome(this.audioContext, this.clock, this.masterGain)`.

**Files:** Created `src/audio/Metronome.js`, modified `src/audio/MasterBus.js`

#### 4.5g.3 — Voice Release + Pool Increase [DONE]

**Voice.release()** — New method on `Voice.js` that stops the grain scheduler and sets `active = false`, but does NOT fade the voice gain node. Pre-scheduled grains (up to 100ms look-ahead) continue playing out naturally via their envelopes. This enables seamless crossfade at loop boundaries.

**Pool increase** — `VoiceAllocator.MAX_VOICES` changed from 10 to 14. Accommodates both loop iterations during the ~50ms crossfade overlap window. Most recordings use 3–5 voices, so 14 provides ample headroom.

**Engine release method** — New `GranularEngine.releaseVoice(pointerId)` calls `voice.release()` (scheduler stops, no gain fade) + removes from allocator map + updates voice gains.

**Files:** Modified `src/audio/Voice.js`, `src/input/VoiceAllocator.js`, `src/audio/GranularEngine.js`

#### 4.5g.4 — Player Crossfade Rewrite (`src/automation/Player.js`) [DONE]

Major rewrite of loop boundary logic to eliminate the audible gap.

**Crossfade mechanism — Ping-pong A/B iterations:**
- Two alternating synthetic ID ranges: Iteration A uses IDs 1000–1013, Iteration B uses IDs 2000–2013.
- Crossfade window: 50ms before loop end.

**Flow:**
1. Normal playback dispatches events using the current iteration's IDs.
2. When `elapsed >= loopEnd - 50ms` and not already crossfading:
   - Set `_crossfadeStarted = true`.
   - Call `_preStartNextIteration(loopStart)` — dispatches 'start' events from the first 50ms of the loop using the NEXT iteration's IDs. New voices begin scheduling grains immediately.
3. When `elapsed >= loopEnd`:
   - Call `_releaseIterationVoices(currentIteration)` — calls `engine.releaseVoice()` (not `stopVoice()`) on all old iteration voices. Schedulers stop, but pre-scheduled grains play out naturally.
   - Swap `_currentIteration` ('A' ↔ 'B').
   - Reset `_startTime` and `_lastProcessedTime` to `loopStart`.
   - Clear `_crossfadeStarted`.
4. Next frame: normal event dispatch continues with the new iteration.

**Result:** During the 50ms overlap, both old grains (playing out their envelopes) and new grains (freshly scheduled) coexist. No audible gap.

**Loop station mode sync:** New `setLoopStationMode(enabled, clock)` method. When enabled + looping, loop restart aligns `_startTime` to the master clock's bar grid via `clock.quantizeToBar()`, ensuring all layers restart on the same global bar boundary.

**New callback:** `onRelease(syntheticId)` — for releasing voices without gain fade (wired to `engine.releaseVoice()`).

**Files:** Modified `src/automation/Player.js`, `src/state/InstanceManager.js` (wired `player.onRelease` in `createInstance()` and `restoreFromSession()`)

#### 4.5g.5 — Transport UI Additions [DONE]

**Modified `index.html`** — Added to transport area:
- **Loop station toggle button** (`#btn-loop-station`) — "LS" label, accent color when active.
- **Time signature controls** — Two `<select>` dropdowns: numerator (2–12, default 4) and denominator (4/8/16, default 4).
- **Metronome controls** — Toggle button, volume slider (0–1), mute button.
- **Beat indicator** (`#beat-indicator`) — Container for beat dots, populated by JS based on numerator.

**Modified `TransportBar.js`:**
- New transport state: `'count-in'` (between armed and recording).
- `updateBeatIndicator(numBeats)` — creates N dot divs, first dot marked as downbeat.
- `highlightBeat(beatIndex)` — toggles `.active` class on the correct dot.
- `clearBeatIndicator()` — removes all `.active` classes.
- `_updateButtons()` handles `'count-in'` state (same visual as armed).

**Modified `style.css`:** Styles for `.loop-station-btn`, `.time-sig-control`, `.metronome-control`, `.metronome-btn`, `.metronome-mute-btn`, `.beat-indicator`, `.beat-dot`.

**Files:** Modified `index.html`, `src/ui/TransportBar.js`, `style.css`

#### 4.5g.6 — Main.js Wiring (All Components) [DONE]

Central integration of all new loop station components in `main.js`:

- **BPM sync:** BPM slider and tap tempo now also set `masterBus.clock.bpm`.
- **Time signature:** `#time-sig-num` and `#time-sig-den` change events set `masterBus.clock.numerator/denominator` and update beat indicator.
- **Metronome:** Toggle, mute, and volume controls wired to `masterBus.metronome`. `onBeat` callback fires `transport.highlightBeat()`.
- **Loop station mode toggle:** `loopStationMode` boolean state. On toggle: updates all instance players via `player.setLoopStationMode(enabled, masterBus.clock)`.
- **Modified record flow:**
  - Loop station + metronome enabled: Click Record → `transport.setState('count-in')` → `masterBus.metronome.startCountIn(callback)` → callback fires on downbeat → `recorder.startRecording()` → `transport.setState('recording')`.
  - Loop station + metronome disabled: Click Record → set epoch, `transport.setState('armed')` → first touch starts recording.
  - Free mode (no loop station): Unchanged arm-to-record flow.
- **Modified stop-recording flow:** In loop station mode, snaps recording duration to nearest bar boundary via `masterBus.clock.quantizeDurationToBar()`, auto-sets loop range to `[0, snappedDuration]`.
- **Enhanced loop snap:** `transport.onLoopRangeChange` now snaps to bar boundaries (using `masterBus.clock.getBarDuration()`) in loop station mode, and to beat-level grid in free mode with snap.
- **New instances** receive loop station mode configuration.

**Files:** Modified `src/main.js`

#### 4.5g.7 — Session Serialization (Loop Station State) [DONE]

**Modified `SessionSerializer.js`:**
- Session version bumped to 2.
- New fields: `timeSignature: {numerator, denominator}`, `metronome: {enabled, volume, muted}`, `loopStationMode`.
- Backward compatible: missing fields default to 4/4, metronome off, loop station off.

**Modified `main.js`:**
- New `getLoopStationState()` helper gathers current loop station state for serialization.
- Both `serializeSession()` calls (auto-save and export) pass loop station state.
- New `restoreLoopStationState(data)` function restores time signature (clock + UI selects + beat indicator), metronome state (enabled flag + button classes + volume + mute), and loop station mode (flag + button class).
- Both `initializeSession()` and `importSessionFromFile()` call `restoreLoopStationState()` after await (to avoid TDZ issues) and apply loop station mode to all restored players.
- BPM now syncs to `masterBus.clock.bpm` on both session restore and import.

**Files:** Modified `src/state/SessionSerializer.js`, `src/main.js`

#### Loop Station Files Summary

| File | Action | Sub-step |
|------|--------|----------|
| `src/audio/MasterClock.js` | Created | 4.5g.1 |
| `src/audio/Metronome.js` | Created | 4.5g.2 |
| `src/audio/MasterBus.js` | Modified (added clock + metronome) | 4.5g.1, 4.5g.2 |
| `src/audio/Voice.js` | Modified (added `release()`) | 4.5g.3 |
| `src/input/VoiceAllocator.js` | Modified (10 → 14 voices) | 4.5g.3 |
| `src/audio/GranularEngine.js` | Modified (added `releaseVoice()`) | 4.5g.3 |
| `src/automation/Player.js` | Modified (crossfade rewrite) | 4.5g.4 |
| `src/state/InstanceManager.js` | Modified (wired `onRelease`) | 4.5g.4 |
| `src/ui/TransportBar.js` | Modified (count-in state, beat indicator) | 4.5g.5 |
| `index.html` | Modified (loop station UI elements) | 4.5g.5 |
| `style.css` | Modified (loop station styles) | 4.5g.5 |
| `src/main.js` | Modified (central wiring + session restore) | 4.5g.6, 4.5g.7 |
| `src/state/SessionSerializer.js` | Modified (version 2, new fields) | 4.5g.7 |

#### Signal Flow (Loop Station)

```
Metronome (count-in clicks)
    ↓ (GainNode with mute)
    ↓
MasterClock (passive timing) ← BPM slider / tap tempo / time sig selects
    ↓ (provides timing queries)
    ↓
Player (crossfade A/B iterations)
    ↓ onRelease → engine.releaseVoice() (scheduler stops, grains play out)
    ↓ onDispatch → engine.startVoice() / updateVoice() / stopVoice()
    ↓
GranularEngine → instanceGain → masterGain → limiter → destination
```

**Deliverable:** Seamless gapless looping via 50ms crossfade overlap. Master clock keeps all layers in phase. Metronome with count-in provides timing reference. Configurable time signature (2–12 / 4/8/16). Loop boundaries snap to bar grid. Full session persistence of loop station state.

---

### Step 4.5h — Per-Tab Loop Station Mode with Forced Sync [DONE]

Loop station mode was a global boolean applied to all tabs simultaneously. This was wrong — each tab should independently be either a loop station layer or a free-form instrument. The default should be loop station mode (not free), and when in loop station mode, sync must be forced.

**What was implemented:**

1. **Per-instance state** — Added `loopStationMode = true` to `InstanceState.js` constructor. Default is loop station ON. Serialized per-instance via `toJSON()`. Old sessions without the field get the new default `true` via `Object.assign` in `fromJSON()`.

2. **Removed global variable** — Deleted `let loopStationMode = false` from `main.js`. All ~10 references replaced with `active.state.loopStationMode` or `entry.state.loopStationMode`.

3. **Per-tab LS button** — The `#btn-loop-station` now toggles only the active tab's `state.loopStationMode` and calls `player.setLoopStationMode()` on that tab's player only.

4. **`applyLoopStationUI(enabled)` helper** — Central function that updates all mode-dependent UI:
   - When enabled (loop station): forces `transport.looping = true`, locks loop button (`loopBtn.disabled = true`, `.loop-forced` class), locks snap button (`.snap-forced` class).
   - When disabled (free mode): unlocks loop and snap buttons, re-evaluates transport button states.
   - Called on: LS button toggle, tab switch, tab add, session restore, session import, initial module load.

5. **Tab-aware switching** — `onSwitch` callback calls `applyLoopStationUI(active.state.loopStationMode)` after switching. `onAdd` applies per-instance mode to the new tab's player.

6. **Force sync in loop station mode**:
   - Loop is always ON (button locked, can't be toggled off).
   - Bar-aligned snapping is always active (snap button locked).
   - Play flow forces `transport.looping = true` before starting playback.
   - Recording auto-snaps to bar duration on stop.
   - Count-in with metronome if enabled.

7. **Session serialization updated** — Removed `loopStationMode` from session-level output in `SessionSerializer.js`. It's now per-instance via `InstanceState.toJSON()`. Backward compatible: old sessions without per-instance field get constructor default `true`.

8. **CSS** — Added `.loop-forced` and `.snap-forced` styles (`opacity: 0.5; pointer-events: none`) to dim and lock buttons when loop station mode forces them on.

**Files:** `src/state/InstanceState.js`, `src/main.js`, `src/state/SessionSerializer.js`, `style.css`

**Deliverable:** Each tab independently toggles between loop station mode (default, with forced sync) and free mode. Loop station tabs have loop always on and bar snap always active. Free mode tabs have full control over loop and snap toggles.

---

### Step 4.6 — Ghost Visualization [DONE]

Show recorded gestures as visual traces during playback.

**Implementation:**

1. **Created `src/ui/GhostRenderer.js`** — New class that tracks ghost pointer positions from Player dispatch events and draws them with distinct visual style:
   - Ghost pointers use **dashed circle outlines** (4px dash pattern) to distinguish from live pointers' solid outlines.
   - Opacity reduced to ~40% of live pointers.
   - Slower pulse animation (half speed of live pointers).
   - Fainter vertical position lines.
   - Fade-out on voice stop (0.4s duration).

2. **Wired GhostRenderer to Player events in `InstanceManager.js`** — Each instance gets its own `GhostRenderer`. The Player's `onDispatch` callback feeds both the GranularEngine (for audio) and the GhostRenderer (for visuals). `onFrame` updates ghost progress, `onComplete` clears ghost state.

3. **Recording tint** — When `ghostRenderer.recording = true`, draws a subtle semi-transparent red overlay (`rgba(224, 60, 60, 0.06)`) over the entire waveform canvas.

4. **Timeline cursor** — During playback, draws a vertical white line (`rgba(255, 255, 255, 0.25)`) at the current playback progress position, sweeping across the canvas.

5. **Render loop order** (bottom to top):
   - Waveform background (cached)
   - Ghost renderer (recording tint → ghost pointers → timeline cursor)
   - Grain overlay (grain rectangles from both live and playback)
   - Live pointer indicators (solid circles)

6. **State management in `main.js`** — `ghostRenderer.recording` set/cleared on recording start/stop transitions. `ghostRenderer.active` set on play, `ghostRenderer.clear()` on stop.

**Files:** `src/ui/GhostRenderer.js` (new), `src/state/InstanceManager.js`, `src/main.js`

**Deliverable**: During playback, ghost fingers with dashed outlines move across the waveform, recreating the performance visually. Red tint during recording. Timeline cursor during playback. Clear visual distinction between live and recorded interaction.

---

### Step 4.7 — Overdub Mode [DONE]

Allow layering new gestures on top of an existing recording.

**Implementation:**

1. **`AutomationLane.merge(laneA, laneB)`** — New static method that interleaves two lanes by time. Voice indices in laneB are offset by `max(laneA voiceIndex) + 1` to avoid collisions. Uses a standard merge-sort merge on the time-sorted event arrays.

2. **Recorder overdub support** — New methods:
   - `startOverdub(startTime)` — Saves a pre-overdub snapshot (`_undoSnapshot`), creates a temp `_overdubLane`, and begins capturing events into it (aligned to playback timing).
   - `stopRecording()` — Updated to detect overdub and call `AutomationLane.merge()` to combine the original lane with the overdub lane.
   - `undoOverdub()` — Reverts `_lane` to the pre-overdub snapshot.
   - `canUndo` getter — Returns `true` if an undo snapshot exists.
   - Capture methods (`captureStart/Move/Stop`) — Now write to `_overdubLane` when overdubbing, `_lane` when normal recording.

3. **Overdub button** — New `#btn-overdub` button in HTML (circle outline with "+" icon, red themed). Placed between Record and Play buttons. CSS: `.overdub-icon` with `::after` for the "+" symbol, `.overdubbing` class for active state.

4. **TransportBar** — New `overdubbing` state added to the state machine. New `onOverdub` callback. Button states updated:
   - Overdub enabled when idle with a recording, or during playback
   - During overdub: stop button and overdub toggle enabled, other buttons disabled
   - Clicking overdub again stops overdub (merge), returns to playing state

5. **Overdub flow in main.js** — `transport.onOverdub`:
   - If not overdubbing: starts playback (if not already playing), then starts overdub recording aligned to player's start time. Sets ghost renderer states.
   - If overdubbing: stops recording (merge happens inside `stopRecording()`), clears overdub state, returns to playing.
   - Stop button during overdub: stops both recording and playback.
   - `onPlayerComplete` during overdub: auto-stops the overdub (non-looping case).

6. **Undo** — Ctrl+Z / Cmd+Z in idle state reverts the last overdub via `recorder.undoOverdub()`.

**Files:** `src/automation/AutomationLane.js`, `src/automation/Recorder.js`, `src/ui/TransportBar.js`, `src/main.js`, `index.html`, `style.css`

**Deliverable**: User can build up complex multi-voice compositions by layering gesture recordings one pass at a time. Ctrl+Z undoes the last overdub.

---

### Step 4.7b — Master BPM/Metronome to Top Bar + Per-Instance Subdivisions [DONE]

Moved global tempo/metronome controls out of the parameter panel and transport bar into the top bar, and replaced slider-to-subdivision mapping with explicit per-instance subdivision dropdowns.

**Changes**:
- **`index.html`**: Moved BPM slider + TAP tempo, time signature selects, metronome controls (toggle/volume/mute), and beat indicator into a new `#tempo-control` group in `#top-bar` (between master volume and theme toggle). Removed BPM `param-group` from the "Rhythm and Harmony" section. Added `<select id="subdiv-grain-size">` and `<select id="subdiv-density">` dropdown menus next to each quantize checkbox (grain size and density). Each select lists all subdivisions from 1/1 to 1/32 including triplets, with value = divisor integer. Selects are `disabled` when the corresponding quantize checkbox is unchecked.
- **`style.css`**: Added `#tempo-control`, `.tempo-bpm` styles for top bar layout. Added `.subdiv-select` and `.subdiv-select:disabled` styles. Removed `.bpm-row` styles (no longer needed).
- **`src/state/InstanceState.js`**: Added `subdivGrainSize = 4` and `subdivDensity = 4` (defaults to quarter note). These are per-instance, serialized via spread in `toJSON()`, restored via `Object.assign` in `fromJSON()` (backward-compatible: old sessions default to 4).
- **`src/ui/ParameterPanel.js`**: Added `_subdivGrainSize` and `_subdivDensity` select references. Quantize checkbox listeners now enable/disable the corresponding subdivision select. Subdivision select `change` events refresh display labels. `getMusicalParams()` includes `subdivGrainSize` and `subdivDensity`. `setFullState()` restores subdivision values and select enabled state. `_refreshGrainSizeDisplay()` and `_refreshDensityDisplay()` use the explicit subdivision divisor + `SUBDIVISIONS` array for labels instead of `normalizedToSubdivision()`. Removed `_bpmGroup` reference and BPM dimming logic from `updateParamRelevance()`.
- **`src/main.js`**: `resolveParams()` now uses `m.subdivGrainSize` and `m.subdivDensity` directly instead of `normalizedToSubdivision(1 - norm)`. The `grainSizeQuantize` and `interOnsetQuantize` objects now include `divisor` alongside `bpm`. Removed `normalizedToSubdivision` from imports.
- **`src/audio/Voice.js`**: Grain size quantization uses explicit `this.grainSizeQuantize.divisor` instead of mapping from normalized value. Passes both `quantizeBpm` and `quantizeDivisor` to scheduler. Removed `normalizedToSubdivision` import.
- **`src/audio/GrainScheduler.js`**: Added `quantizeDivisor` field. Inter-onset quantization uses explicit `this.quantizeDivisor` instead of `normalizedToSubdivision`. Removed `normalizedToSubdivision` import.

**Backward compatibility**: Old sessions without `subdivGrainSize`/`subdivDensity` fields default to divisor 4 (quarter note) via `InstanceState` constructor defaults and `|| 4` fallbacks in `setFullState()`.

---

### Step 4.7c — Fixed-Length Bar-Count Recording with Count-In [DONE]

Standard loop station recording workflow: choose bar count, count-in, fixed-length recording, auto-play.

**Changes**:
- **`src/state/InstanceState.js`**: Added `recordBarCount = 4` (per-instance, 1-4 bars, backward-compatible default).
- **`index.html`**: Added `#bar-count-selector` div with 4 buttons (1, 2, 3, 4) before `#btn-record` in the transport bar. Hidden by default, shown via `.visible` class when loop station mode is active.
- **`style.css`**: Added `.bar-count-selector`, `.bar-count-btn` styles (compact 24px buttons, accent highlight for active). Added `#time-display.count-in-display` (accent color, large font for beat countdown), `#time-display.bar-progress-display` (record red for bar progress), `#transport-progress-fill.recording-progress` (red progress bar during recording).
- **`src/ui/TransportBar.js`**: Added `setCountInDisplay(beatsLeft)` (shows "- 3 -" countdown), `setBarProgressDisplay(currentBar, totalBars)` (shows "Bar 2 / 4"), `setRecordingProgress(fraction)` (fills progress bar with recording color), `clearSpecialDisplay()` (removes all special CSS classes).
- **`src/main.js`**:
  - Added `fixedRecordDuration` module-level variable (null for free-form, seconds for fixed-length).
  - Added `beginFixedRecording()`: called when count-in completes, computes `barCount * barDuration`, starts recorder.
  - Added `finishRecording(active)`: stops recording, sets loop range to `fixedRecordDuration`, auto-plays the recorded loop. Handles metronome cleanup.
  - Added `cancelRecordArm()`: cancels count-in/armed state, cleans up metronome and display.
  - Rewrote `transport.onRecord`: in loop station mode, **always** does count-in (even with metronome disabled — starts muted metronome for timing). In free-form mode, uses traditional armed state.
  - Updated `transport.onStop`: clears `fixedRecordDuration` and special display.
  - Updated `masterBus.metronome.onBeat`: during count-in, shows beats-left countdown via `transport.setCountInDisplay()`.
  - Updated render loop: during fixed-length recording, shows bar progress and recording progress; auto-stops when elapsed >= target duration.
  - Added `barCountSelector` + `barCountBtns` wiring with click handlers to update `active.state.recordBarCount`.
  - Updated `applyLoopStationUI()`: shows/hides bar-count selector, syncs active button to current instance's `recordBarCount`.

---

### Step 4.7d — Overdub Auto-Commit at Loop Boundary (Classic Loop Station) [DONE]

Fixed overdub to behave like a classic loop station: overdubbed content plays back on the very next loop iteration instead of requiring manual stop.

**Changes**:
- **`src/automation/Player.js`**:
  - Added `onLoopWrap` callback, fired at each loop boundary when looping wraps around.
  - Added `setLane(lane)` method for hot-swapping the automation lane during playback without stopping (used after overdub merge).
- **`src/state/InstanceManager.js`**: Added `onPlayerLoopWrap` callback. Wired `player.onLoopWrap` in both `createInstance()` and `restoreSession()` to forward loop-wrap events with the instance ID.
- **`src/main.js`**: Added `instanceManager.onPlayerLoopWrap` handler that implements the classic loop station overdub cycle:
  1. **Commit**: stops overdub recording, merging the overdub lane into the main lane.
  2. **Hot-swap**: calls `player.setLane()` so the merged content plays on the next iteration.
  3. **Re-arm**: starts a fresh overdub pass (`recorder.startOverdub()`) so the user can keep layering continuously.
  4. The cycle repeats each loop boundary until the user presses overdub to stop.

---

### Step 4.7e — UI Polish & Metronome Free-Run [DONE]

Small UX improvements across the transport bar and parameter panel.

**Changes**:
- **Metronome free-run** (`src/main.js`): Metronome now starts immediately when toggled on, even without recording armed. Toggling off only stops the metronome if not currently recording/counting-in. The `transport.onStop` handler preserves the metronome when the toggle is enabled.
- **Master volume label** (`index.html`): Changed label from "Master" to "Main Volume" in the top bar.
- **Bar-count button highlight** (`style.css`): Made `.bar-count-btn.active` more prominent — solid `var(--accent)` background, white text, and a subtle glow via `color-mix()` box-shadow.

---

### Step 4.7f — Subdivision Dropdown UX (Ternary Grouping & Positioning) [DONE]

Improved the quantize subdivision dropdowns for discoverability and layout.

**Changes**:
- **`index.html`**: Reorganized both `#subdiv-grain-size` and `#subdiv-density` dropdowns with `<optgroup>` labels — **Binary** (1/1, 1/2, 1/4, 1/8, 1/16, 1/32) and **Ternary** (1/2T, 1/4T, 1/8T, 1/16T). Triplet subdivisions were already present but now clearly separated.
- **`style.css`**: Fixed `.toggle-row` gap from `16px` to `6px`. Changed `.subdiv-select` from `margin-left: auto` (pushed to far right) to `margin-left: 4px` so the dropdown sits right next to its toggle label.

---

### Step 4.8 — Save & Load Recordings [DONE]

Recordings now persist across page reloads and are included in session export/import files.

**Changes**:
- **`src/automation/Recorder.js`**: Added `setRecording(lane)` method to replace the internal lane with a pre-existing one (used during session restore).
- **`src/state/SessionSerializer.js`**: `serializeSession()` now includes recording data per instance. For each instance with a non-empty recording, the serialized data includes `recording: { lane: lane.toJSON(), loopRange: { start, end } }`.
- **`src/state/InstanceManager.js`**: Added `AutomationLane` import. `restoreFromSession()` now checks each saved instance for `recording` data and restores the `AutomationLane` via `recorder.setRecording()` and the loop range via `player.setLoopRange()`.
- **`src/main.js`**: Both `initializeSession()` and `importSessionFromFile()` now call `transport.setHasRecording()` after restore so the play/overdub buttons are correctly enabled when a recording exists.

**How it works**:
- **Auto-save**: Recordings are included in the debounced localStorage auto-save. Page reload restores them automatically.
- **Session export**: The JSON file contains all recording events alongside instance parameters. Recordings are lightweight (events store only position, amplitude, pitch, grain params — no audio data).
- **Session import**: Imported sessions restore recordings and loop ranges, enabling immediate playback.
- **Tab switching**: Already handled — `transport.setHasRecording()` on tab switch reflects the active instance's recording state.

---

### Step 4.9 — Phase 4 Integration Testing & Final Polish

**Tasks**:
- Record a complex multi-touch performance (3+ voices, 15+ seconds). Play it back. Verify timing accuracy — grains should land at the same positions and the overall rhythm should feel identical.
- Test overdub: record a pass, overdub a second pass, play back. Verify both layers are present and correctly timed.
- Test loop mode: verify the loop point is seamless (all voices stop and restart cleanly).
- Test save/load: export a recording, reload the page, import it, play it back.
- Test with a different sample loaded: import a recording made with sample A while sample B is loaded. It should still play (just sounds different).
- Final audio quality check on headphones: no clicks, no clipping, no timing drift over long playback sessions.
- Final visual polish: consistent colors, smooth animations, no visual artifacts.
- Write a brief in-app help text or tooltip set explaining the controls.

**Deliverable**: A complete, polished web-based multi-touch granular sampler with gesture recording and playback. Ready for public use.

---

## Summary Table

| Phase | Steps | Key Deliverable | Status |
|---|---|---|---|
| **Phase 1** | 1.1 – 1.10 | Single-voice granular sampler with waveform display, parameter controls, clean audio | COMPLETE |
| **Phase 2** | 2.1 – 2.9 | Multi-touch support (10 voices), per-voice visuals, musical quantization, mobile polish | COMPLETE |
| **Phase 3** | 3.1 – 3.9 | Multi-instance architecture with tab UI, arpeggiator, session persistence | COMPLETE |
| **Phase 4** | 4.1 – 4.9 | Gesture recording, per-instance isolation, loop editing, loop station, playback, overdub, ghost visualization, BPM/subdivision reorganization, fixed-length recording, save/load | **IN PROGRESS** (4.1–4.8 done, 4.9 next) |

---

## Dependencies & Tooling Summary

| Tool | Purpose |
|---|---|
| **No framework, no bundler** | Vanilla JS + native ES Modules (`<script type="module">`) |
| **Web Audio API** | All audio processing — native browser API |
| **Canvas 2D** | Waveform + grain visualization — native browser API |
| **Pointer Events API** | Multi-touch input — native browser API |
| **Any static file server** | Local dev only (`python3 -m http.server`, VS Code Live Server, etc.) |

Zero dependencies. No `package.json`, no `node_modules`, no build step. The project is a folder of `.html`, `.css`, `.js`, and `.wav` files that runs directly in the browser.

---

*Implementation plan — February 2026*
