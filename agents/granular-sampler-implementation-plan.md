# Web Audio Granular Sampler — Implementation Plan

## Overview

This plan breaks the project into three sequential phases, each building on the previous one. Every phase ends with a working, testable deliverable. Estimated total duration: **7–8 weeks** of focused development.

---

## Phase 1 — Core Engine & Single-Pointer Interaction

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

### Step 1.5 — Grain Scheduler & Voice

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

### Step 1.6 — Anti-Clipping Chain

Wire up the multi-layer protection against clipping.

**Tasks**:
- In `GranularEngine`, build the signal chain: Voice(s) → Master GainNode → DynamicsCompressorNode (limiter) → AnalyserNode → destination.
- Configure the compressor as a brickwall limiter: threshold -3 dB, knee 0, ratio 20, attack 0.001s, release 0.05s.
- In `grainFactory.js`, scale each grain's amplitude by `params.amplitude * voiceGainFactor`. Initially `voiceGainFactor = 0.5` as a conservative default.
- Add an `AnalyserNode` after the limiter for visualization (Phase 1: just for debugging; later for a level meter).
- Test with extreme settings: maximum density, maximum amplitude, multiple short grains — verify no harsh clipping reaches the speakers. Listen critically on headphones.

**Deliverable**: Even with aggressive parameter settings, the output stays clean. The limiter catches peaks, the per-grain scaling prevents most of them from occurring in the first place.

---

### Step 1.7 — Pointer Input (Single Touch/Mouse)

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

### Step 1.8 — Parameter Controls

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

### Step 1.9 — Grain Visualization

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

### Step 1.10 — Integration Testing & Polish

Final Phase 1 pass: test everything together, fix edge cases, polish the experience.

**Tasks**:
- Test with various audio files: short percussive samples, long ambient pads, speech, music loops. Verify the engine handles all gracefully.
- Test edge cases: very short grain size + very high density, very long grain size + very low density, pitch at extremes (0.25 and 4.0), position at buffer boundaries (0.0 and 1.0).
- Ensure that stopping and restarting voices doesn't leave orphaned nodes or cause pops.
- Verify that loading a new sample while playing stops the current voice cleanly.
- Add a simple level meter (horizontal bar) driven by the `AnalyserNode` to give the user feedback on output level.
- Performance check: open DevTools Performance tab, verify no excessive GC pauses or dropped frames during normal use.
- Responsive check: test on a narrow viewport (phone-width) — controls should stack vertically, canvas should fill available width.

**Deliverable**: A solid, reliable single-voice granular sampler. Clean sound, responsive UI, no crashes or audio glitches under normal use. This is the foundation for everything that follows.

---

## Phase 2 — Multi-Touch & Voice Management

**Goal**: Support multiple simultaneous touch points, each controlling an independent grain voice. Polish the mobile/tablet experience. Make the instrument feel expressive and alive.

**Duration**: ~2 weeks

---

### Step 2.1 — Voice Pool & Allocator

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

### Step 2.2 — Multi-Touch Pointer Handling

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

### Step 2.3 — Per-Voice Visual Feedback

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

### Step 2.4 — Extended Gesture Dimensions

Map additional pointer data to audio parameters where supported.

**Tasks**:
- **Pressure** (`event.pressure`): if the device reports non-zero pressure (value > 0 and not the default 0.5 for mouse), map it to grain amplitude as a multiplier on top of the Y-axis mapping. On devices without pressure, fall back to Y-axis only. This gives touch-screen users a third control dimension.
- **Contact size** (`event.width`, `event.height`): if available, map the average contact area to grain spread. A fat finger press spreads grains across a wider buffer region; a precise fingertip focuses them. Normalize by typical ranges (most devices report 20–50px for finger width).
- **Velocity** (computed from pointer movement speed between frames): map to grain density modulation — fast movement increases inter-onset time (fewer grains, more "scrubby"), slow movement decreases it (denser cloud, more sustained). This makes the instrument feel physically responsive.
- All mappings should be optional and configurable, with sensible defaults and smooth interpolation (don't jump — lerp toward the new value over a few frames).

**Deliverable**: On supported devices (iPads, Android tablets), the instrument responds to nuanced touch: pressure controls intensity, finger size controls texture width, movement speed controls grain density. On desktop mouse, it degrades gracefully to X/Y only.

---

### Step 2.5 — Mobile & Tablet Polish

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

### Step 2.6 — Phase 2 Integration Testing

**Tasks**:
- Test with 1, 2, 3, 4, 5, and 6 simultaneous touches. Verify voice allocation and deallocation is clean.
- Test rapid touch sequences: tap-lift-tap-lift quickly on different positions. No orphaned voices, no stuck sounds.
- Test pointer capture edge cases: what happens if a finger slides off the canvas edge? (`pointercancel` should fire and release the voice.)
- Listen critically to the mix with multiple voices at high density. Adjust the limiter settings if needed.
- Cross-browser check: Chrome, Firefox, Safari on desktop; Safari on iOS; Chrome on Android.

**Deliverable**: Robust multi-touch granular instrument ready for expressive performance.

---

## Phase 3 — Gesture Recording & Automation Playback

**Goal**: Let users record their multi-touch performances and play them back as automation, enabling composition and layering. Think of it as recording automation lanes in a DAW, but for gestural parameters.

**Duration**: ~2.5 weeks

---

### Step 3.1 — Automation Data Model

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

### Step 3.2 — Gesture Recorder

Capture live gestures into an automation lane.

**Tasks**:
- Create `src/automation/Recorder.js`:
  - `startRecording()` — records the current `audioContext.currentTime` as the reference start time. Sets `isRecording = true`.
  - Hook into `PointerHandler`: when recording is active, every `pointerdown` / `pointermove` / `pointerup` event is captured as an `AutomationEvent` with `time = audioContext.currentTime - recordingStartTime`.
  - Throttle `pointermove` capture to **30 events per second per pointer** using a simple time-since-last-event check. This keeps recordings compact without losing gestural nuance.
  - Also capture global parameter changes (if the user moves a slider during recording): store as a special event type `'param'` with the parameter name and value.
  - `stopRecording()` — sets `isRecording = false`, finalizes the automation lane.
  - `getRecording()` — returns the `AutomationLane`.
- The recorder does not interfere with live audio — while recording, the user hears their gestures in real time as normal.

**Deliverable**: User presses Record, performs gestures, presses Stop. The recording is stored in memory as a structured event array.

---

### Step 3.3 — Transport Controls UI

Build the record/play/stop bar.

**Tasks**:
- Create `src/ui/TransportBar.js`:
  - Three buttons: **Record** (red circle), **Play** (green triangle), **Stop** (gray square).
  - A **time display** showing current position in `MM:SS.ms` format.
  - A **progress bar** showing playback position relative to recording duration (thin horizontal bar below the waveform, or integrated into the waveform canvas as a horizontal line).
  - Visual states:
    - Idle: Play is enabled only if a recording exists. Record is always available.
    - Recording: Record button pulses red. Time display counts up. Stop is available.
    - Playing: Play button is highlighted. Progress bar advances. Stop is available.
  - A **Loop toggle** button (cycle icon) that enables/disables loop playback.
- Wire buttons to the Recorder and Player (next step).

**Deliverable**: A clean transport bar with clear visual states for idle, recording, and playback modes.

---

### Step 3.4 — Automation Player

Replay recorded gestures through the engine.

**Tasks**:
- Create `src/automation/Player.js`:
  - `play(automationLane, loop)` — starts playback from the beginning.
  - Uses a `requestAnimationFrame` loop (not `setTimeout` — we want frame-accurate event dispatch, and the events themselves schedule audio ahead anyway).
  - Each frame, compute `elapsedTime = audioContext.currentTime - playbackStartTime`.
  - Fetch all events between `lastProcessedTime` and `elapsedTime` from the lane.
  - For each event, dispatch the corresponding action on the engine:
    - `'start'` → `engine.startVoice(event.voiceIndex, event.params)` (use a synthetic pointer ID space distinct from real pointers, e.g., `pointerId = 1000 + voiceIndex`).
    - `'move'` → `engine.updateVoice(syntheticPointerId, event.params)`.
    - `'stop'` → `engine.stopVoice(syntheticPointerId)`.
  - On loop: when `elapsedTime > lane.getDuration()`, stop all active playback voices and restart from 0.
  - `stop()` — halts playback, stops all playback-originated voices.
  - `pause()` / `resume()` — freeze and continue from the paused position.
- Ensure that playback voices and live touch voices can coexist. Reserve voice slots 0–2 for playback and 3–5 for live input, or use the allocator with a priority system.

**Deliverable**: User presses Play and hears their recorded gestures reproduced exactly, with grain positions, amplitudes, and timings matching the original performance.

---

### Step 3.5 — Ghost Visualization

Show recorded gestures as visual traces during playback.

**Tasks**:
- During playback, the Player emits the same visual events that live pointers do (position, voice color, grain events).
- Draw "ghost" pointer circles on the waveform canvas — same shape as live pointers but with reduced opacity (e.g., 40%) and a slightly different outline style (dashed or with a glow).
- Ghost grain overlays also appear at reduced opacity.
- During recording, show a subtle red tint on the waveform background to indicate recording is active.
- During playback, show a timeline cursor (vertical line or thin bar) sweeping across the bottom of the canvas at the playback rate.

**Deliverable**: During playback, the user sees ghost fingers moving across the waveform, recreating their performance visually. Clear distinction between live interaction and recorded playback.

---

### Step 3.6 — Overdub Mode

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

### Step 3.7 — Save & Load Recordings

Persist recordings for later use.

**Tasks**:
- **Export**: serialize the `AutomationLane` to JSON. Trigger a browser download of the JSON file (using `URL.createObjectURL` + `<a download>`). Filename format: `granular-recording-YYYY-MM-DD-HHMMSS.json`.
- **Import**: add a "Load Recording" button (or accept `.json` files via drag-and-drop alongside audio files). Parse the JSON, create an `AutomationLane` from the data, enable the Play button.
- The JSON file also stores metadata: source sample name (not the audio data itself — that would be too large), recording duration, date, number of voices used.
- On import, if the current sample doesn't match the recording's metadata, show a warning but allow playback anyway (the positions are normalized 0–1 so they work with any sample).

**Deliverable**: Recordings survive page reloads. Users can share their gesture compositions as lightweight JSON files.

---

### Step 3.8 — Phase 3 Integration Testing & Final Polish

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

| Phase | Steps | Key Deliverable | Duration |
|---|---|---|---|
| **Phase 1** | 1.1 – 1.10 | Single-voice granular sampler with waveform display, parameter controls, clean audio | ~3 weeks |
| **Phase 2** | 2.1 – 2.6 | Multi-touch support (6 voices), per-voice visuals, mobile polish | ~2 weeks |
| **Phase 3** | 3.1 – 3.8 | Gesture recording, playback, overdub, ghost visualization, save/load | ~2.5 weeks |

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
