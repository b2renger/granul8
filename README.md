# Granul8

**A granular sampler and loopstation for the web and multitouch devices.**

Granul8 turns any audio file into a playable instrument. You drag your fingers across a
waveform and each contact point becomes an independent stream of grains — tiny slices of
the sample re-triggered dozens of times per second. Horizontal position picks *where* in
the sample you read from; vertical position sets pitch. Gestures can be recorded, looped
in time with a master clock, and layered across multiple independent sampler instances.

Zero dependencies. No build step. No npm, no bundler, no framework — just ES modules, the
Web Audio API, Canvas 2D and Pointer Events, served as static files.

---

## Table of contents

- [Running it](#running-it)
- [Quick start](#quick-start)
- [Features](#features)
- [The interaction model](#the-interaction-model)
- [Parameters](#parameters)
- [Transport, loop station and recording](#transport-loop-station-and-recording)
- [Instances (tabs)](#instances-tabs)
- [Sessions](#sessions)
- [Architecture](#architecture)
- [Signal flow](#signal-flow)
- [Project layout](#project-layout)
- [Browser support](#browser-support)
- [Known limitations and roadmap](#known-limitations-and-roadmap)
- [Credits and licence](#credits-and-licence)

---

## Running it

ES modules and `fetch()` require a real HTTP origin — opening `index.html` from the
filesystem will not work. Serve the folder with any static server:

```bash
# Python
python3 -m http.server 8000

# Node
npx serve .

# PHP
php -S localhost:8000
```

Then open <http://localhost:8000>.

There is nothing to install and nothing to build. `index.html` loads
[src/main.js](src/main.js) as `<script type="module">` and everything else follows from
relative imports.

To test on a phone or tablet on the same network, serve on `0.0.0.0` and browse to your
machine's LAN address. Note that **iOS Safari requires HTTPS** for some features and
always requires a user gesture before audio starts — the app's "Tap to start" overlay
handles the gesture requirement.

---

## Quick start

1. Open the app and tap **Tap to start** (this unlocks the `AudioContext`).
2. A demo sample is loaded automatically. Pick another from the dropdown, click
   **Load File**, or drag an audio file onto the waveform.
3. Press and drag on the waveform. Move left/right to scrub the read position; move
   up/down to change pitch (up = higher, ±2 octaves).
4. Use multiple fingers — each one is an independent voice with its own colour.
5. Open **Sound Engine** in the parameter panel and try **Grain Size** and **Density**.
6. Hit **Record** (or press `R`). In loop-station mode you get a one-bar count-in, then
   a fixed 4-bar recording that auto-loops when it completes.
7. Hit **Overdub** to layer more gestures on top of the loop.
8. Press **+** in the tab bar to add a second sampler with its own sample and its own
   loop, playing simultaneously.

---

## Features

**Granular engine**
- Look-ahead grain scheduling (100 ms ahead, 25 ms timer) decoupled from JS timer jitter
- Up to 14 concurrent voices per instance, allocated per pointer
- 9 grain envelopes: Hann, Tukey, Triangle, Gaussian, Sigmoid, Blackman, Expo Decay,
  Reverse Expo, plus a draggable **custom ADSR** editor
- Per-grain randomisation of grain size, pitch and pan, with min/max range sliders
- Four-layer anti-clipping: per-grain overlap compensation, per-voice `1/√N` scaling,
  a brickwall `DynamicsCompressor` limiter, and a `tanh` soft-clip waveshaper

**Musical control**
- Master BPM (40–300) with tap tempo, time signature (2–12 over 4/8/16), metronome
- 14 scales (chromatic, modes, pentatonics, blues, whole tone) with selectable root
- Optional quantisation of grain size, density and pitch to the tempo grid / scale
- Permutation **arpeggiator** with 3–6 steps, straight or bounced playback, an editable
  SVG pattern grid (drag a point to change its note, tap to mute the step), and note-name
  labels derived from the active scale

**Performance and gesture**
- Multi-touch via Pointer Events with `setPointerCapture`
- Extended gesture dimensions — **pressure**, **contact size**, **velocity** — each
  routable to grain size, density, spread, amplitude or pitch, with live meters and
  automatic device-capability detection
- Live visual feedback: colour-coded pointer indicators, fading grain rectangles
  positioned by pitch, and gesture indicators drawn onto the parameter sliders

**Recording and looping**
- Gesture automation recorder (moves throttled to 30 events/s/voice)
- Loop-station mode: count-in, fixed-length 1/2/3/4-bar recording, bar-aligned looping
- Crossfaded loop boundaries — the next iteration pre-starts 50 ms early on a second
  synthetic voice range so there is no gap at the wrap
- Overdub with automatic commit at each loop boundary, plus `Ctrl+Z` undo
- Free-form mode: arm on Record, start on first touch, draggable loop start/end handles
  with optional snap-to-grid

**Workspace**
- Multiple sampler **instances** as tabs, each with its own sample, parameters, recording
  and loop, all mixed through a shared master bus
- Session auto-save to `localStorage` (debounced 500 ms) plus JSON export/import
- Light and dark themes; canvas colours are read from CSS custom properties

---

## The interaction model

The waveform is an XY pad.

| Axis | Maps to | Range |
|---|---|---|
| **X** (left → right) | Read position in the buffer | 0 → 1 (start → end) |
| **Y** (top → bottom) | Pitch, as playback rate | +2 oct → −2 oct |

Y-to-pitch is exponential: `pitch = 2^(2 − 4y)`, so the vertical centre is unity rate and
the extremes are ×4 and ×0.25.

Each `pointerdown` allocates a voice from the pool and starts its grain scheduler; each
`pointermove` updates that voice's parameters; `pointerup` / `pointercancel` fades it out
over 30 ms. Up to 10 pointers are tracked simultaneously
([PointerHandler.js:9](src/input/PointerHandler.js#L9)) against a pool of 14 voices
([VoiceAllocator.js:9](src/input/VoiceAllocator.js#L9)) — the extra voices exist so that
two loop iterations can briefly overlap during a crossfade.

Gesture dimensions beyond X/Y are extracted from the pointer event and normalised:

- **Pressure** — `PointerEvent.pressure`. Mice always report exactly `0.5`, so the app
  marks the dimension "available" only once it sees a value that is neither 0 nor 0.5.
- **Contact size** — `max(event.width, event.height)` normalised against 50 CSS px.
  Mice report 1×1, so anything larger flags real touch hardware.
- **Velocity** — computed from the normalised position delta per frame, smoothed with an
  exponential moving average, saturating at 3 canvas-units/second.

Each dimension can be routed to one engine parameter in the **Gesture Mapping** section.
When a dimension is mapped, that parameter interpolates between its **Min** and **Max**
sliders instead of sitting at Max — which is why the Min row is dimmed until something
actually drives it.

---

## Parameters

All range parameters are stored normalised 0–1 in the UI and mapped to engine units
exponentially, so the low end of each slider has more resolution.

| Parameter | UI range | Engine range | Notes |
|---|---|---|---|
| Grain Size | 0–1 (min/max pair) | 1–1000 ms | `expMap`; quantisable to a note subdivision |
| Density (inter-onset) | 0–1 (min/max pair) | 5–500 ms | `expMap`; quantisable to a note subdivision |
| Spread | 0–1 (min/max pair) | ±spread/2 of buffer | Random position offset per grain |
| Pan | −1 to 1 (min/max pair) | `StereoPanner` | Max is the fixed value; the pair is used when Randomize Pan is on |
| Volume | 0–1 | per-instance gain | Ramped over 20 ms |
| Envelope | 9 options | `setValueCurveAtTime` | 128-sample curve, cached |
| Pitch Range | 1–4 | ± octaves | Bounds the random/arp note table |

> **Note on the min/max pairs.** The Max slider is the value the engine uses by default.
> The Min slider only takes effect when the parameter is randomised (grain size, density,
> pan) or gesture-mapped. Sliders are mutually constrained so Min never exceeds Max.

**Quantisation** replaces the continuous value with a tempo subdivision:
`interOnset = (60 / bpm) × (4 / divisor)`, with divisors covering 1/1 down to 1/32 plus
the ternary set (1/2T, 1/4T, 1/8T, 1/16T). **Randomize** picks a fresh value inside the
min/max range for every single grain. The two can be combined — quantised randomisation
snaps each random pick to the grid.

**Pitch randomisation** builds a note table from the selected scale and root across the
chosen octave range, then either picks from it at random or walks it with the arpeggiator.
The arpeggiator uses permutations of `[0..n-1]` (Heap's algorithm, cached), so with 4 steps
you get 24 shapes to page through, 5 steps gives 120, 6 gives 720.

---

## Transport, loop station and recording

Transport states: `idle` → `armed` / `count-in` → `recording` → `idle` → `playing` /
`overdubbing`.

**Loop-station mode** (the `LS` button, per-instance, **on by default**) is the tempo-locked
workflow:

1. Press **Record**. A one-bar metronome count-in runs (audible if the metronome is on,
   silent-but-timed if it isn't). The time display counts the beats down.
2. On the downbeat, recording starts with a fixed duration of `barCount × barDuration`.
   The display switches to `Bar 2 / 4` and the progress bar fills.
3. At the end of the last bar, recording stops automatically, the loop range is set, and
   playback starts immediately, looping.
4. Loop and snap are forced on and their buttons are locked while `LS` is active.

**Free-form mode** is the looser workflow: Record arms the transport, and the recording
actually starts on your first touch. Duration is whatever you play. Loop start/end handles
on the progress bar are draggable, with an optional beat-grid snap (`⊞`).

**Overdub** requires an existing recording and a running playback. New gestures go into a
temporary lane; at every loop boundary that lane is merged into the main lane (voice
indices offset so they don't collide) and the player's lane is hot-swapped so the new
material is audible on the very next pass. A pre-overdub snapshot is kept for `Ctrl+Z`.

**Loop crossfade.** 50 ms before the loop end, the player pre-starts the next iteration on
a second synthetic pointer-ID range (`2000+` instead of `1000+`). The outgoing voices are
*released* rather than stopped — their schedulers halt but the grains already queued in the
look-ahead window play out through their envelopes. This is what removes the click at the
seam, and it is why the voice pool is 14 rather than 7.

Keyboard: `R` toggles record, `Ctrl/Cmd+Z` undoes the last overdub (when idle).

---

## Instances (tabs)

Each tab is a complete sampler: its own `GranularEngine` (voice pool + instance gain), its
own `AudioBuffer`, its own recorder, player, grain overlay and ghost renderer, and its own
serialisable `InstanceState`.

What is **per-instance**: sample, all grain parameters, envelope and ADSR, gesture
mappings, scale/root, quantise and randomise toggles, arpeggiator settings, volume, loop
station mode, bar count, recording and loop range.

What is **global**: master BPM, master volume, time signature, metronome, theme.

There is a single `ParameterPanel` shared by all tabs. Switching tabs writes the panel's
current values into the outgoing instance's state (`panel.getFullState()`) and loads the
incoming one (`panel.setFullState()`). Recording stops on the outgoing tab; **playback
does not** — that is what lets several loops run at once.

Double-click a tab to rename it. The last tab cannot be closed.

---

## Sessions

State is auto-saved to `localStorage` under the key `granul8-session`, debounced to 500 ms
and flushed on `beforeunload`. **Export** downloads the same structure as
`granul8-session-<timestamp>.json`; **Import** accepts that file via the button or by
dropping it on the waveform.

```jsonc
{
  "granul8": true,
  "version": 2,
  "masterBpm": 120,
  "masterVolume": 0.7,
  "timeSignature": { "numerator": 4, "denominator": 4 },
  "metronome": { "enabled": false, "volume": 0.5, "muted": false },
  "savedAt": "2026-01-01T12:00:00.000Z",
  "activeInstanceId": "…uuid…",
  "instances": [
    {
      "id": "…uuid…", "name": "Sampler 1",
      "sampleUrl": "samples/…mp3", "sampleFileName": null,
      "grainSizeMin": 0.8674, "grainSizeMax": 0.8674,
      "densityMin": 0.651,   "densityMax": 0.651,
      "adsr": { "a": 0.2, "d": 0.15, "s": 0.7, "r": 0.2 },
      "recording": {
        "lane": { "events": [ { "time": 0.12, "voiceIndex": 0, "type": "start", "params": { } } ] },
        "loopRange": { "start": 0, "end": 8 }
      }
    }
  ]
}
```

**Audio is never stored.** Only a reference is. Bundled samples (anything under
`samples/`) are re-fetched automatically on restore. User-loaded files cannot be —
the instance comes back with its parameters and recording intact but the sample name
prefixed `⚠ … (missing)`, waiting for you to reload the file.

Automation events store **absolute** values — grain size in seconds, inter-onset in
seconds. A recording is therefore a BPM-independent snapshot: changing the master BPM
after recording does not retime an existing loop, it only affects new live gestures.

---

## Architecture

Every module is a plain ES class with no dependencies beyond other modules in `src/`.
There is no state-management library and no virtual DOM — `main.js` wires DOM elements to
class instances with callbacks, and a single `requestAnimationFrame` loop drives all
canvas rendering.

```
main.js
├── MasterBus ────────── AudioContext, master gain, limiter, soft clip, analyser
│   ├── MasterClock ──── passive beat/bar maths anchored to currentTime
│   └── Metronome ────── look-ahead click scheduler + count-in
├── InstanceManager ──── Map<id, {state, engine, recorder, player, overlays, buffer}>
│   └── per instance:
│       ├── GranularEngine → VoiceAllocator → Voice[14] → GrainScheduler → grainFactory
│       ├── Recorder ────── captures pointer gestures into an AutomationLane
│       ├── Player ─────── replays a lane via rAF, with A/B crossfade at loop points
│       ├── GrainOverlay ─ ring buffer of the last 100 grains, drawn fading
│       └── GhostRenderer  dashed low-opacity playback pointers
├── ParameterPanel ────── all sliders/selects/toggles + ADSRWidget + arp SVG editor
├── TabBar, TransportBar, WaveformDisplay, LevelMeter
└── PointerHandler ────── pointer events → normalised gesture → voice control
```

**Key design decisions**

- **Look-ahead scheduling.** A `setTimeout` loop every 25 ms schedules grains up to 100 ms
  into the future against `audioContext.currentTime`. JS timer jitter never reaches the
  audio thread. The metronome uses the identical pattern.
- **One `AudioBufferSourceNode` per grain.** Nodes are cheap and fire-and-forget: create,
  connect, `start(when, offset, duration)`, `stop()`, and let GC collect them. No pooling.
- **Envelopes via `setValueCurveAtTime`.** The 128-point curve runs entirely on the audio
  thread. Curves are cached by `type:length` (and by rounded ADSR values), so the common
  path allocates one scaled `Float32Array` per grain and nothing else.
- **Canvas 2D over WebGL.** The rendering is lines and rectangles; WebGL would add
  complexity for no gain.
- **`MasterClock` is passive.** It holds only BPM, time signature and an epoch, and answers
  questions (`getNextBarTime`, `quantizeToBar`). It runs no timer of its own — the
  metronome and the player each derive their own timing from it.
- **Parameters resolve in one place.** `resolveParams()` in
  [main.js:185](src/main.js#L185) is the single function that folds panel values, musical
  settings and live gesture data into the flat object the engine consumes. Everything
  downstream — voices, recorder, player — speaks that one shape.

---

## Signal flow

```
                     ┌─ grain: AudioBufferSourceNode
                     │         → GainNode (envelope curve × amplitude × 1/√overlap)
                     │         → StereoPannerNode (only when pan ≠ 0)
                     ▼
Voice.gainNode (per-voice level, 0.4/√activeVoices)
    │  × up to 14 voices
    ▼
GranularEngine.instanceGain (per-tab volume)
    │  × N instances                        Metronome.gainNode ──┐
    ▼                                                            │
MasterBus.masterGain (master volume) ◄───────────────────────────┘
    ▼
DynamicsCompressorNode  (threshold −3 dB, knee 0, ratio 20, attack 1 ms, release 50 ms)
    ▼
WaveShaperNode          (tanh curve, 8192 points, 2× oversample)
    ▼
AnalyserNode            (fftSize 2048 → level meter)
    ▼
AudioContext.destination
```

Anti-clipping happens at four points: each grain is scaled by `1/√(duration/interOnset)`
to compensate for overlapping grains summing incoherently; each voice is scaled by
`0.4/√(activeVoices)`; the limiter catches transients; the soft clipper rounds off
whatever is left.

---

## Project layout

```
granul8/
├── index.html                  Single entry point — all markup and control IDs
├── style.css                   Full stylesheet; CSS custom properties drive both themes
├── test-modules.html           Smoke test: imports every core module, constructs a MasterBus
├── src/
│   ├── main.js                 Wiring, resolveParams(), transport logic, render loop
│   ├── audio/
│   │   ├── MasterBus.js        Shared AudioContext + master chain
│   │   ├── MasterClock.js      BPM / time signature / bar-beat maths
│   │   ├── Metronome.js        Look-ahead click track with count-in
│   │   ├── GranularEngine.js   Per-instance voice pool + instance gain
│   │   ├── Voice.js            One grain stream; per-grain randomisation and arp walk
│   │   ├── GrainScheduler.js   Look-ahead timer
│   │   ├── grainFactory.js     Creates and schedules a single grain
│   │   └── envelopes.js        9 window functions + ADSR, all cached
│   ├── automation/
│   │   ├── AutomationLane.js   Event list, range query, merge, (de)serialise
│   │   ├── Recorder.js         Gesture capture, throttling, overdub, undo
│   │   └── Player.js           rAF replay with A/B crossfade looping
│   ├── input/
│   │   ├── PointerHandler.js   Pointer events → gestures; draws pointer indicators
│   │   └── VoiceAllocator.js   pointerId → Voice from a pool of 14
│   ├── state/
│   │   ├── InstanceState.js    Serialisable per-instance snapshot (also the defaults)
│   │   ├── InstanceManager.js  Create / switch / remove / restore instances
│   │   ├── SessionSerializer.js  serializeSession, validateSession
│   │   └── SessionPersistence.js localStorage + file export/import
│   ├── ui/
│   │   ├── WaveformDisplay.js  Min/max downsample to an offscreen cache
│   │   ├── GrainOverlay.js     Fading grain rectangles, positioned by pitch
│   │   ├── GhostRenderer.js    Playback ghosts + recording tint
│   │   ├── ParameterPanel.js   Every control in the right-hand panel
│   │   ├── ADSRWidget.js       Draggable 5-point envelope editor
│   │   ├── TransportBar.js     Button states, time display, loop handles
│   │   ├── TabBar.js           Instance tabs
│   │   ├── LevelMeter.js       RMS meter from the analyser
│   │   └── voiceColors.js      10-colour palette shared by all canvas drawing
│   └── utils/
│       ├── math.js             clamp, lerp, mapRange, expMap
│       ├── musicalQuantizer.js Scales, subdivisions, note tables, permutations
│       └── fileLoader.js       Drag-and-drop and file picker
├── samples/                    9 bundled MP3s from the Free Music Archive
└── agents/                     Design docs written before implementation (see caveat below)
```

> `agents/CLAUDE.md` and `agents/granular-sampler-*.md` are the original planning
> documents. They describe the intended design, not the shipped one, and have drifted in
> places (voice-pool size, bundled sample name, file list). Treat `src/` as the source of
> truth.

---

## Browser support

| Browser | Status |
|---|---|
| Chrome / Edge desktop | Primary target |
| Firefox desktop | Works |
| Safari desktop | Works; requires the unlock gesture |
| iOS Safari | Works; requires the unlock gesture. Pressure and contact size are reported |
| Android Chrome | Works; multi-touch and contact size reported |

Required APIs: Web Audio (`AudioContext`, `StereoPannerNode`, `DynamicsCompressorNode`,
`WaveShaperNode`, `AnalyserNode`), Pointer Events with `setPointerCapture`, Canvas 2D,
`ResizeObserver`, ES modules, `localStorage`. There is no feature detection or fallback —
a browser missing any of these will fail at load.

---

## Known limitations and roadmap

> Two blind audits of this codebase are in [AUDIT-CODE.md](AUDIT-CODE.md) (89 verified
> findings, 1 critical) and [AUDIT-UX.md](AUDIT-UX.md) (63 verified findings, 1 critical).
> Both were produced by critic agents given no context and then adversarially verified.
> The summary below is the roadmap view; the audits are the detail.

Current [TODO.txt](TODO.txt), plus what the code shows:

**Timing and sync**
- BPM sync across instances is not phase-locked. Each player derives its own timing from
  `audioContext.currentTime` and only re-aligns to the bar grid at its own loop wrap, so
  two loops started at different moments can drift apart perceptually even at the same BPM.
- Loop points and quantisation need review so that layers stay in rhythm over long runs.
- Loop start/end handle editing exists in free-form mode but is locked out in loop-station
  mode, where the range is derived from the bar count.

**Mixing**
- There is no per-layer master fader separate from the per-instance grain volume.
- Pan is implemented per grain but there is no dedicated pan-randomisation width control
  beyond the min/max pair.

**Not yet implemented**
- Recording audio input from a microphone as a sample source.
- Exporting the rendered audio (only the gesture automation can be exported, as JSON).
- AI / generative sample synthesis — see [AI-AUDIO-REVIEW.md](AI-AUDIO-REVIEW.md) for a
  researched assessment of the client-side options and why the recommendation is mic input
  and a procedural texture generator rather than an in-browser neural model.

**Structural notes**
- Playback continues on inactive tabs, but the grain overlay and ghost renderer only draw
  for the active tab, so background loops are audible but invisible.
- Every sampler instance allocates its own pool of 14 `Voice` objects (each with a
  `GainNode`) at construction, whether or not they are ever used.
- The app is pointer-driven throughout; the performance surface has no keyboard equivalent.

---

## Credits and licence

All bundled samples come from the [Free Music Archive](https://freemusicarchive.org/home)
and remain under their own licences — check each artist's page before redistributing:
Soni Ventorum Wind Quintet, Real Vocal String Quartet, Slaveya Women's Vocal Ensemble,
PulseBox, Jangwa, The Derek Piotr Fieldwork Archive, Ketsa, Samuel Corwin, Veena Kinhal.

Code is MIT licensed — see [LICENSE](LICENSE). © 2026 b2renger.
