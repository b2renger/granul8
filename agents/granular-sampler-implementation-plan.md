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

### Step 4.6 — Ghost Visualization

Show recorded gestures as visual traces during playback.

**Tasks**:
- During playback, the Player emits the same visual events that live pointers do (position, voice color, grain events).
- Draw "ghost" pointer circles on the waveform canvas — same shape as live pointers but with reduced opacity (e.g., 40%) and a slightly different outline style (dashed or with a glow).
- Ghost grain overlays also appear at reduced opacity.
- During recording, show a subtle red tint on the waveform background to indicate recording is active.
- During playback, show a timeline cursor (vertical line or thin bar) sweeping across the bottom of the canvas at the playback rate.

**Deliverable**: During playback, the user sees ghost fingers moving across the waveform, recreating their performance visually. Clear distinction between live interaction and recorded playback.

---

### Step 4.7 — Overdub Mode

Allow layering new gestures on top of an existing recording.

**Tasks**:
- Add an **Overdub** mode (button or toggle on the transport bar).
- When Overdub is active and the user presses Record:
  - Existing recording plays back (with ghost visuals).
  - New live gestures are captured and appended to the automation lane (with the same time reference).
  - The result is a merged recording containing both the original and new events.
- Implementation detail: don't modify the original lane during overdub. Instead, record into a new temporary lane, then merge the two lanes (interleave events by time, sort) when overdub stops.
- A simple **Undo** for overdub: keep the pre-overdub lane as a snapshot. If the user doesn't like the result, revert to the snapshot.

**Deliverable**: User can build up complex multi-voice compositions by layering gesture recordings one pass at a time.

---

### Step 4.8 — Save & Load Recordings

Persist recordings for later use.

**Tasks**:
- **Export**: serialize the `AutomationLane` to JSON. Trigger a browser download of the JSON file (using `URL.createObjectURL` + `<a download>`). Filename format: `granular-recording-YYYY-MM-DD-HHMMSS.json`.
- **Import**: add a "Load Recording" button (or accept `.json` files via drag-and-drop alongside audio files). Parse the JSON, create an `AutomationLane` from the data, enable the Play button.
- The JSON file also stores metadata: source sample name (not the audio data itself — that would be too large), recording duration, date, number of voices used.
- On import, if the current sample doesn't match the recording's metadata, show a warning but allow playback anyway (the positions are normalized 0–1 so they work with any sample).

**Deliverable**: Recordings survive page reloads. Users can share their gesture compositions as lightweight JSON files.

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
| **Phase 4** | 4.1 – 4.9 | Gesture recording, per-instance isolation, loop editing, playback, overdub, ghost visualization, save/load | **IN PROGRESS** (4.1–4.5f done, 4.6 next) |

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
