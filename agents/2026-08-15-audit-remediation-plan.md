# Granul8 Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the verified audit findings in [AUDIT-CODE.md](../AUDIT-CODE.md) and [AUDIT-UX.md](../AUDIT-UX.md), then add the two zero-dependency sample sources recommended in [AI-AUDIO-REVIEW.md](../AI-AUDIO-REVIEW.md).

**Architecture:** Three sequential phases on three branches. Phase 1 fixes the audio engine's DSP and unifies its four independent timelines onto the `MasterClock`. Phase 2 makes the interface keyboard-operable, legible in light theme, usable on a phone, and honest about destructive actions. Phase 3 adds microphone capture and a procedural texture generator behind a shared "adopt this AudioBuffer" seam, plus a timeboxed spike to decide the neural question with evidence.

**Tech Stack:** Vanilla ES modules, Web Audio API, Canvas 2D, Pointer Events. Tests run on `node --test` against hand-written fakes. No npm, no `package.json`, no `node_modules`, no build step.

## Global Constraints

- **No `package.json`, no npm, no `node_modules`, no bundler, no build step.** Verified on Node 24.15.0: `node --test "tests/*.test.mjs"` imports `src/**/*.js` directly via ESM syntax detection. Do not add a `package.json` to make tests work — it is not needed and it would break the project's stated identity.
- **No runtime dependencies.** Every `import` in `src/` resolves to another file in `src/`.
- **ES modules only**, relative paths, explicit `.js` extensions.
- **Single entry point:** `index.html` → `<script type="module" src="src/main.js">`.
- **One `AudioContext` for the whole app**, owned by `MasterBus`. Never construct a second one.
- **No hardcoded sample rates.** Read `audioContext.sampleRate` or the source buffer's rate.
- **Test files are `.mjs`; source files stay `.js`.** Node treats `.mjs` as ESM unconditionally; source `.js` is detected. Keeps browser behaviour untouched.
- **Commit after every task.** Conventional Commits (`fix:`, `feat:`, `test:`, `refactor:`, `docs:`).
- **Branch per phase**, merged to `main` when that phase is green:
  - Phase 1 → `fix/audio-timing`
  - Phase 2 → `fix/ux`
  - Phase 3 → `feat/sample-sources`
- **Audit finding numbers** in task titles refer to the numbered findings in `AUDIT-CODE.md` (prefix `C`) and `AUDIT-UX.md` (prefix `U`).

---

## Task checklist

**Phase 0 — harness**

- [ ] 0. Node test harness with no dependencies

**Phase 1 — audio engine and timing** (`fix/audio-timing`)

- [ ] 1. Grain wall-clock duration vs `playbackRate` — **C1, critical**
- [ ] 2. Clamp the grain scheduler's cursor, cap grains per tick — C2, C14
- [ ] 3. Cancel stale fades when a pooled voice restarts — C5, C50
- [ ] 4. Drive the Player from the audio clock, not rAF — C9, C10
- [ ] 5. Advance the loop anchor by exact loop lengths — C6, C21
- [ ] 6. Phase-lock loop-station playback once, at launch — C7, C22, C56
- [ ] 7. Store loop points in bars so BPM changes retime — C8
- [ ] 8. Derive the metronome grid from the clock — C3
- [ ] 9. Set the clock epoch once; count-in must not move it — C4, C48
- [ ] 10. Record modulation config; reset it on voice start — C11, C24
- [ ] 11. One notion of recording duration for the loop handles — C12, C27, C29, C38
- [ ] 12. Robustness and hygiene batch — C31, C35, C36, C46, C51, C55, C58
- [ ] 13. Close out Phase 1 — full suite, manual regression, merge

**Phase 2 — interface** (`fix/ux`)

- [ ] 14. Make every control keyboard-reachable — **U1, critical**, U6, U28, U41, U48
- [ ] 15. Make the audio-unlock overlay operable and legible — U10
- [ ] 16. Fix mobile portrait: panel scroll, transport wrap, touch targets — U12–14, U26, U38
- [ ] 17. Re-derive the light theme against measured contrast — U15, U16
- [ ] 18. Move the voice palette into CSS — U17
- [ ] 19. Guard the destructive actions — U8, U9, U11, U18
- [ ] 20. Make transport and tab state honest — U19, U20, U22, U31
- [ ] 21. Teach the XY mapping; surface failures — U21, U23, U24, U25, U30
- [ ] 22. Close out Phase 2 — keyboard pass, device pass, merge

**Phase 3 — sample sources** (`feat/sample-sources`)

- [ ] 23. `adoptBuffer` — one seam for installing a sample
- [ ] 24. Microphone recording — closes `record audio input for sample`
- [ ] 25. Procedural texture generator — answers `generate ia audio ?`
- [ ] 26. GANSynth spike — timeboxed, outside the repo, decision only
- [ ] 27. Close out Phase 3 — update TODO.txt and README, merge

**Ruled out — do not add these:**
- **Any online feature.** No Freesound search, no BYO-key generation API
  (`AI-AUDIO-REVIEW.md` §6.3–6.4). The instrument must work with no network — on a
  school LAN, at a venue, on a plane. Anything that needs a request at performance
  time is out of scope, permanently.
- **A keyboard play mode.** This is a touch instrument. Task 14 makes the parameter
  *panel* keyboard-operable, which is an accessibility floor, but the performance
  surface stays pointer-driven by design. External control is a **Web MIDI + MIDI
  learn** feature, planned separately — not an arrow-key virtual pointer.

**Likely fourth phase:** audio export (`OfflineAudioContext` render of the granular
engine, ~100 lines) — the last open item in `TODO.txt`, and fully offline.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `tests/fakes.mjs` | `FakeAudioContext` with a manually-driven `currentTime`, recording gain/param nodes, a controllable `setTimeout`/`requestAnimationFrame` queue. The single place test doubles live. |
| `tests/README.md` | How to run the tests and why there is no `package.json`. |
| `tests/grainFactory.test.mjs` | Grain duration, envelope span, buffer span, overlap scaling. |
| `tests/scheduler.test.mjs` | `GrainScheduler` clamp and per-tick budget. |
| `tests/voice.test.mjs` | Voice gain lifecycle, modulation reset on start. |
| `tests/player.test.mjs` | Loop anchor advance, crossfade dispatch, bar phase-lock, retime. |
| `tests/metronome.test.mjs` | Beat grid derivation, BPM change, count-in. |
| `tests/recorder.test.mjs` | Modulation capture, dangling stop events. |
| `tests/contrast.test.mjs` | Parses `style.css` tokens, computes WCAG ratios, asserts AA. |
| `src/audio/TextureSynth.js` | Seeded procedural texture generator → `AudioBuffer` (Phase 3). |
| `src/input/MicRecorder.js` | `getUserMedia` → `AudioBuffer` (Phase 3). |
| `src/ui/SampleSourceDialog.js` | UI for choosing sample source: file / mic / generate (Phase 3). |

### Modified files, by responsibility

| File | What changes |
|---|---|
| `src/audio/grainFactory.js` | Separate wall-clock span from buffer span (C1). |
| `src/audio/GrainScheduler.js` | Clamp cursor to `currentTime`, cap grains per tick (C2). |
| `src/audio/Voice.js` | Cancel stale fades on start; reset modulation state (C5, C10). |
| `src/audio/Metronome.js` | Derive beats from the clock; stop moving the epoch (C3, C4). |
| `src/audio/MasterClock.js` | `setBpm(bpm)` that preserves beat phase; epoch guard. |
| `src/automation/Player.js` | `setTimeout` transport, exact-length loop advance, bar phase-lock, bar-based loop points (C6, C7, C8, C9). |
| `src/automation/Recorder.js` | Capture modulation config; emit stops for held pointers (C11, C24). |
| `src/main.js` | `visibilitychange`, loop-handle domain, BPM retime, transport sync, UX guards. |
| `index.html` | Labels, viewport, ARIA, unlock button, legend. |
| `style.css` | Focusable toggles, focus-visible, panel scroll, transport wrap, light-theme tokens, voice palette. |
| `src/ui/voiceColors.js` | Read from CSS custom properties instead of hardcoded RGB. |

---

# Phase 0 — Test harness

### Task 0: Node test harness with no dependencies

**Files:**
- Create: `tests/fakes.mjs`
- Create: `tests/README.md`
- Create: `tests/smoke.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class FakeAudioContext { currentTime: number; sampleRate: number; advance(seconds): void; createGain(): FakeGain; createBufferSource(): FakeSource; createStereoPanner(): FakePanner; createOscillator(): FakeOsc; createBuffer(ch, len, rate): FakeBuffer; readonly log: Array<{node,method,args,at}> }`
  - `class FakeTimers { setTimeout(fn, ms): number; clearTimeout(id): void; requestAnimationFrame(fn): number; cancelAnimationFrame(id): void; runUntil(ms): void; freeze(): void; thaw(): void; readonly now: number }`
  - `function makeBuffer(ctx, seconds, channels = 1): FakeBuffer`
  - `function install(fakeTimers): () => void` — patches `globalThis.setTimeout`/`requestAnimationFrame`, returns a restore function.

- [ ] **Step 1: Write the fakes**

Create `tests/fakes.mjs`:

```js
// fakes.mjs — Hand-written test doubles for the Web Audio API and browser timers.
// No dependencies. Time is driven manually so timing assertions are exact.

/** Records every scheduled AudioParam event so tests can assert on the timeline. */
class FakeParam {
    constructor(ctx, name, value = 0) {
        this._ctx = ctx;
        this.name = name;
        this._base = value;
        /** @type {Array<{method:string, args:number[], at:number}>} */
        this.events = [];
    }

    /**
     * `.value` is COMPUTED from the scheduled timeline at the context's current
     * time — it is not the last target that was scheduled.
     *
     * This distinction is load-bearing. Code under test reads `gain.value` to
     * anchor a new ramp against whatever the param is doing right now (see
     * Voice.start). If a pending `linearRampToValueAtTime(0, t+0.03)` made
     * `.value` read 0 the instant it was scheduled, that code would anchor at
     * silence and the fake would report a bug that does not exist in a browser.
     */
    get value() { return this.valueAt(this._ctx.currentTime); }

    /** Direct assignment sets the base value the timeline starts from. */
    set value(v) { this._base = v; }

    _rec(method, args) {
        this.events.push({ method, args, at: this._ctx.currentTime });
        return this;
    }
    setValueAtTime(v, t) { return this._rec('setValueAtTime', [v, t]); }
    linearRampToValueAtTime(v, t) { return this._rec('linearRampToValueAtTime', [v, t]); }
    exponentialRampToValueAtTime(v, t) { return this._rec('exponentialRampToValueAtTime', [v, t]); }
    setValueCurveAtTime(curve, t, dur) { return this._rec('setValueCurveAtTime', [curve, t, dur]); }
    cancelScheduledValues(t) { return this._rec('cancelScheduledValues', [t]); }

    /**
     * The param's value at time `q`, honouring cancellations and interpolating
     * across a ramp in progress.
     *
     * Ramps interpolate from the preceding event's time and value, which is what
     * the Web Audio spec does. `setValueCurveAtTime` is modelled coarsely — it
     * holds the curve's first sample from its start and its last from its end,
     * with no interpolation between. That is enough here because grain envelope
     * curves are written to per-grain nodes that nothing ever reads back.
     */
    valueAt(q) {
        const live = this._liveEvents();
        let value = this._base;
        let prevTime = -Infinity;
        for (const e of live) {
            const t = e.args[1];
            if (t <= q) {
                value = e.method === 'setValueCurveAtTime'
                    ? (q >= t + e.args[2] ? e.args[0][e.args[0].length - 1] : e.args[0][0])
                    : e.args[0];
                prevTime = t;
                continue;
            }
            // The next event is in the future. A ramp toward it is already under
            // way, so interpolate; anything else holds the previous value.
            if (e.method === 'linearRampToValueAtTime' || e.method === 'exponentialRampToValueAtTime') {
                // A ramp with no preceding event still ramps — from the value the
                // param held when the ramp was *scheduled*. `e.at` is that call
                // time. Without this, a first-ever ramp reads flat until its target
                // time, which is wrong and would silently mislead any test that
                // reads .value on a never-started voice (VoiceAllocator.setGainLevel
                // loops over the whole pool, virgin voices included).
                const from = prevTime > -Infinity ? prevTime : e.at;
                const span = t - from;
                const frac = span > 0 ? (q - from) / span : 1;
                if (q <= from) return value;
                return value + (e.args[0] - value) * Math.min(1, frac);
            }
            break;
        }
        return value;
    }

    /** Scheduled events that survive every cancellation, in time order. @private */
    _liveEvents() {
        const live = [];
        for (const e of this.events) {
            if (e.method === 'cancelScheduledValues') {
                const from = e.args[0];
                for (let i = live.length - 1; i >= 0; i--) {
                    if (live[i].args[1] >= from) live.splice(i, 1);
                }
                continue;
            }
            if (e.args[1] !== undefined) live.push(e);
        }
        return live.sort((a, b) => a.args[1] - b.args[1]);
    }
    /**
     * Events that would still be on the param's timeline at or after `t`.
     *
     * Replays the calls in insertion order, because `cancelScheduledValues(from)`
     * only removes events scheduled BEFORE it — an event added afterwards at the
     * same time survives. Filtering the flat list by "time >= the last cancel"
     * instead keeps a cancelled ramp forever, which would make a correctly-fixed
     * Voice.start() still look broken.
     */
    pendingAfter(t) {
        return this._liveEvents().filter(e => e.args[1] >= t);
    }
}

class FakeNode {
    constructor(ctx, kind) {
        this._ctx = ctx;
        // `_kind`, not `.type`. Several real Web Audio nodes own a `.type`
        // property that the code under test legitimately sets — OscillatorNode
        // ('sine'), BiquadFilterNode ('bandpass') — which would clobber a marker
        // stored there and make the node unfindable.
        this._kind = kind;
        this.connections = [];
        this.disconnected = false;
        ctx.nodes.push(this);
    }
    connect(dest) { this.connections.push(dest); return dest; }
    disconnect() { this.disconnected = true; }
}

class FakeGain extends FakeNode {
    constructor(ctx) { super(ctx, 'gain'); this.gain = new FakeParam(ctx, 'gain', 1); }
}

class FakePanner extends FakeNode {
    constructor(ctx) { super(ctx, 'panner'); this.pan = new FakeParam(ctx, 'pan', 0); }
}

class FakeOsc extends FakeNode {
    constructor(ctx) {
        super(ctx, 'oscillator');
        this.frequency = new FakeParam(ctx, 'frequency', 440);
        this.started = null;
        this.stopped = null;
    }
    start(t) { this.started = t; }
    stop(t) { this.stopped = t; }
}

class FakeSource extends FakeNode {
    constructor(ctx) {
        super(ctx, 'bufferSource');
        this.buffer = null;
        this.playbackRate = new FakeParam(ctx, 'playbackRate', 1);
        /** @type {{when:number, offset:number, duration:number}|null} */
        this.startArgs = null;
        this.stopArgs = null;
    }
    start(when, offset, duration) { this.startArgs = { when, offset, duration }; }
    stop(when) { this.stopArgs = when; }
}

class FakeBuffer {
    constructor(channels, length, sampleRate) {
        this.numberOfChannels = channels;
        this.length = length;
        this.sampleRate = sampleRate;
        this.duration = length / sampleRate;
        this._data = Array.from({ length: channels }, () => new Float32Array(length));
    }
    getChannelData(i) { return this._data[i]; }
    copyToChannel(src, i) { this._data[i].set(src); }
}

export class FakeAudioContext {
    constructor({ sampleRate = 48000, currentTime = 0 } = {}) {
        this.sampleRate = sampleRate;
        this.currentTime = currentTime;
        this.state = 'running';
        this.destination = { type: 'destination', connect() {}, disconnect() {} };
        /** @type {FakeNode[]} */
        this.nodes = [];
    }
    /** Move the audio clock forward. Nothing fires by itself — pair with FakeTimers. */
    advance(seconds) { this.currentTime += seconds; }
    createGain() { return new FakeGain(this); }
    createStereoPanner() { return new FakePanner(this); }
    createBufferSource() { return new FakeSource(this); }
    createOscillator() { return new FakeOsc(this); }
    createAnalyser() { const n = new FakeNode(this, 'analyser'); n.fftSize = 2048; n.getByteTimeDomainData = () => {}; return n; }
    createDynamicsCompressor() {
        const n = new FakeNode(this, 'compressor');
        for (const p of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[p] = new FakeParam(this, p);
        return n;
    }
    createWaveShaper() { const n = new FakeNode(this, 'shaper'); n.curve = null; n.oversample = 'none'; return n; }
    createBuffer(ch, len, rate) { return new FakeBuffer(ch, len, rate); }
    async resume() { this.state = 'running'; }
    /** Every FakeSource created so far, in creation order. */
    get sources() { return this.nodes.filter(n => n._kind === 'bufferSource'); }
    get gains() { return this.nodes.filter(n => n._kind === 'gain'); }
    get oscillators() { return this.nodes.filter(n => n._kind === 'oscillator'); }
    get panners() { return this.nodes.filter(n => n._kind === 'panner'); }
}

/** Deterministic replacement for setTimeout / requestAnimationFrame. */
export class FakeTimers {
    constructor() {
        this.now = 0;
        this._id = 1;
        /** @type {Map<number, {at:number, fn:Function, kind:string}>} */
        this._q = new Map();
        this._frozen = false;
    }
    setTimeout(fn, ms = 0) { const id = this._id++; this._q.set(id, { at: this.now + ms, fn, kind: 'timeout' }); return id; }
    clearTimeout(id) { this._q.delete(id); }
    /** rAF at a nominal 60 fps. `freeze()` models a backgrounded tab. */
    requestAnimationFrame(fn) { const id = this._id++; this._q.set(id, { at: this.now + 16.67, fn, kind: 'raf' }); return id; }
    cancelAnimationFrame(id) { this._q.delete(id); }
    /** Stop delivering rAF callbacks — models a hidden tab. Timeouts still fire. */
    freeze() { this._frozen = true; }
    thaw() { this._frozen = false; }
    /**
     * Run the queue forward to `ms`, firing callbacks in time order.
     * @param {number} ms - absolute time to advance to
     * @param {(nowMs:number) => void} [onTick] - called before each callback, for syncing an audio clock
     */
    runUntil(ms, onTick) {
        let guard = 100000;
        for (;;) {
            let next = null, nextId = -1;
            for (const [id, e] of this._q) {
                if (this._frozen && e.kind === 'raf') continue;
                if (e.at <= ms && (next === null || e.at < next.at)) { next = e; nextId = id; }
            }
            if (next === null || guard-- <= 0) break;
            this._q.delete(nextId);
            this.now = next.at;
            if (onTick) onTick(this.now);
            next.fn(this.now);
        }
        this.now = ms;
        if (onTick) onTick(this.now);
    }
}

/** Patch the globals a module under test will reach for. Returns a restore fn. */
export function install(timers) {
    const saved = {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        requestAnimationFrame: globalThis.requestAnimationFrame,
        cancelAnimationFrame: globalThis.cancelAnimationFrame,
    };
    globalThis.setTimeout = (fn, ms) => timers.setTimeout(fn, ms);
    globalThis.clearTimeout = (id) => timers.clearTimeout(id);
    globalThis.requestAnimationFrame = (fn) => timers.requestAnimationFrame(fn);
    globalThis.cancelAnimationFrame = (id) => timers.cancelAnimationFrame(id);
    return () => Object.assign(globalThis, saved);
}

/** Convenience: an n-second buffer of silence. */
export function makeBuffer(ctx, seconds, channels = 1) {
    return ctx.createBuffer(channels, Math.round(seconds * ctx.sampleRate), ctx.sampleRate);
}

/** Absolute file: URL for a module under src/, so tests are cwd-independent. */
export const SRC = new URL('../src/', import.meta.url).href;
```

- [ ] **Step 2: Write the smoke test**

Create `tests/smoke.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, FakeTimers, makeBuffer, SRC } from './fakes.mjs';

test('src modules import under Node with no package.json', async () => {
    const { MasterClock } = await import(SRC + 'audio/MasterClock.js');
    const { Voice } = await import(SRC + 'audio/Voice.js');
    const { Player } = await import(SRC + 'automation/Player.js');
    assert.equal(typeof MasterClock, 'function');
    assert.equal(typeof Voice, 'function');
    assert.equal(typeof Player, 'function');
});

test('FakeAudioContext supports the nodes the engine constructs', () => {
    const ctx = new FakeAudioContext();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, 1.0);
    // .value is computed from the timeline at the CURRENT time, not snapped to
    // the last scheduled target. An event one second out has not happened yet.
    assert.equal(g.gain.value, 1, 'scheduled for t=1.0, not yet in effect at t=0');
    ctx.currentTime = 1.0;
    assert.equal(g.gain.value, 0.5, 'in effect once the clock reaches it');
    assert.equal(g.gain.events[0].method, 'setValueAtTime');

    // A ramp interpolates rather than jumping to its target.
    g.gain.linearRampToValueAtTime(0, 1.1);
    ctx.currentTime = 1.05;
    assert.ok(Math.abs(g.gain.value - 0.25) < 1e-9, `mid-ramp, got ${g.gain.value}`);
    const buf = makeBuffer(ctx, 2);
    assert.equal(buf.duration, 2);
    assert.equal(buf.sampleRate, 48000);
});

test('FakeTimers fires in time order and freeze() stops only rAF', () => {
    const t = new FakeTimers();
    const seen = [];
    t.setTimeout(() => seen.push('b'), 50);
    t.setTimeout(() => seen.push('a'), 10);
    t.requestAnimationFrame(() => seen.push('raf'));
    t.runUntil(100);
    assert.deepEqual(seen, ['a', 'raf', 'b']);

    const t2 = new FakeTimers();
    const seen2 = [];
    t2.freeze();
    t2.setTimeout(() => seen2.push('timeout'), 10);
    t2.requestAnimationFrame(() => seen2.push('raf'));
    t2.runUntil(100);
    assert.deepEqual(seen2, ['timeout']);
});
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `node --test "tests/*.test.mjs"`
Expected: `pass 4`, `fail 0`. If Node reports `Cannot use import statement outside a module`, the Node version is below 22.7 — upgrade rather than adding a `package.json`.

- [ ] **Step 4: Write the tests README**

Create `tests/README.md` with this content:

````markdown
# Tests

```bash
node --test "tests/*.test.mjs"      # everything
node --test tests/player.test.mjs   # one file
```

Requires **Node 22.7+** (developed on 24.15.0). Nothing else — no `npm install`,
no `package.json`, no `node_modules`.

## Why there is no package.json

Node 22.7+ detects ES module syntax in `.js` files automatically, so
`import { Voice } from '../src/audio/Voice.js'` works from a `.mjs` test with
no configuration. Adding a `package.json` would make `npm install` look like a
required step and break the project's zero-dependency promise for no benefit.

Test files are `.mjs` (unconditionally ESM). Source files stay `.js` so the
browser is unaffected.

## Fakes

`fakes.mjs` provides `FakeAudioContext` (manually-driven `currentTime`, param
event recording) and `FakeTimers` (deterministic `setTimeout`/`rAF`, with
`freeze()` to model a backgrounded tab). Time never advances on its own — call
`ctx.advance()` and `timers.runUntil()` explicitly, so timing assertions are
exact rather than flaky.
````

- [ ] **Step 5: Commit**

```bash
git checkout -b fix/audio-timing
git add tests/
git commit -m "test: add dependency-free Node test harness with Web Audio fakes"
```

---

# Phase 1 — Audio engine and timing (branch `fix/audio-timing`)

Fixes AUDIT-CODE findings 1–12 plus the cheap items from 39–89. Task order matters: Task 1 is the largest audible win, Tasks 5–9 must land in sequence because each builds on the previous one's timing model.

### Task 1: Grain wall-clock duration must account for playbackRate (C1, critical)

**Files:**
- Modify: `src/audio/grainFactory.js:47-126`
- Test: `tests/grainFactory.test.mjs`

**Interfaces:**
- Consumes: `createGrain(audioContext, buffer, params, destination, when, onGrain)` — unchanged signature.
- Produces: `onGrain` payload's `duration` now means **wall-clock seconds**, not buffer seconds. `GrainOverlay.draw` reads it (`src/ui/GrainOverlay.js:72`) and needs no change, but its rendered width becomes correct at pitch ≠ 1.

- [ ] **Step 1: Write the failing test**

Create `tests/grainFactory.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, makeBuffer, SRC } from './fakes.mjs';

const { createGrain } = await import(SRC + 'audio/grainFactory.js');

function fire(ctx, buffer, overrides = {}) {
    const dest = ctx.createGain();
    const info = [];
    createGrain(ctx, buffer, {
        position: 0.0, amplitude: 1.0, duration: 0.4, interOnset: 0.1,
        pitch: 1.0, spread: 0, pan: 0, envelope: 'hann', adsr: null, ...overrides,
    }, dest, 10.0, (i) => info.push(i));
    const src = ctx.sources.at(-1);
    const gain = ctx.gains.at(-1);
    return { src, gain, info: info[0] };
}

test('at unity pitch, buffer span and wall-clock span agree', () => {
    const ctx = new FakeAudioContext();
    const { src, gain } = fire(ctx, makeBuffer(ctx, 5), { pitch: 1.0 });
    assert.equal(src.startArgs.duration, 0.4);           // buffer seconds consumed
    const curve = gain.gain.events.find(e => e.method === 'setValueCurveAtTime');
    assert.equal(curve.args[2], 0.4);                    // wall-clock envelope span
});

test('at pitch 2 the source consumes twice the buffer over the same wall clock', () => {
    const ctx = new FakeAudioContext();
    const { src, gain, info } = fire(ctx, makeBuffer(ctx, 5), { pitch: 2.0 });
    const curve = gain.gain.events.find(e => e.method === 'setValueCurveAtTime');
    assert.equal(curve.args[2], 0.4, 'envelope spans the requested wall-clock length');
    assert.equal(src.startArgs.duration, 0.8, 'source consumes 0.8 buffer-seconds');
    assert.ok(src.stopArgs >= 10.4, `stop must not truncate the envelope, got ${src.stopArgs}`);
    assert.equal(info.duration, 0.4, 'onGrain reports wall-clock duration');
});

test('at pitch 0.5 the source consumes half the buffer over the same wall clock', () => {
    const ctx = new FakeAudioContext();
    const { src, gain } = fire(ctx, makeBuffer(ctx, 5), { pitch: 0.5 });
    const curve = gain.gain.events.find(e => e.method === 'setValueCurveAtTime');
    assert.equal(curve.args[2], 0.4);
    assert.equal(src.startArgs.duration, 0.2);
});

test('near the buffer end the grain is shortened in wall clock, not over-read', () => {
    const ctx = new FakeAudioContext();
    // 5 s buffer, start at 4.9 s => 0.1 buffer-seconds left. At pitch 2 that is
    // 0.05 s of wall clock.
    const { src, gain } = fire(ctx, makeBuffer(ctx, 5), { pitch: 2.0, position: 0.98 });
    const curve = gain.gain.events.find(e => e.method === 'setValueCurveAtTime');
    assert.ok(Math.abs(curve.args[2] - 0.05) < 1e-9, `wall duration ${curve.args[2]}`);
    assert.ok(Math.abs(src.startArgs.duration - 0.1) < 1e-9, `buffer span ${src.startArgs.duration}`);
    assert.ok(src.startArgs.offset + src.startArgs.duration <= 5 + 1e-9, 'never reads past the end');
});

test('overlap attenuation uses wall-clock duration', () => {
    const ctx = new FakeAudioContext();
    // duration 0.4 wall, interOnset 0.1 => overlap 4 => scale 1/2 regardless of pitch.
    for (const pitch of [0.5, 1, 2]) {
        const c = new FakeAudioContext();
        const { gain } = fire(c, makeBuffer(c, 30), { pitch, duration: 0.4, interOnset: 0.1 });
        const curve = gain.gain.events.find(e => e.method === 'setValueCurveAtTime');
        const peak = Math.max(...curve.args[0]);
        assert.ok(Math.abs(peak - 0.5) < 0.01, `pitch ${pitch}: peak ${peak}, expected ~0.5`);
    }
});

test('sub-millisecond wall-clock grains are skipped', () => {
    const ctx = new FakeAudioContext();
    fire(ctx, makeBuffer(ctx, 5), { pitch: 4.0, duration: 0.0001 });
    assert.equal(ctx.sources.length, 0, 'no source created');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/grainFactory.test.mjs`
Expected: FAIL. `pitch 2` case reports `src.startArgs.duration` of `0.4` (expected `0.8`) and `onGrain` duration is buffer-time. The `pitch 0.5` and overlap cases fail the same way.

- [ ] **Step 3: Fix `createGrain`**

In `src/audio/grainFactory.js`, replace the block from `// Compute actual buffer offset with random spread` through `const scaledAmplitude = amplitude * overlapScale;` with:

```js
    // Compute actual buffer offset with random spread
    const spreadOffset = spread > 0 ? (Math.random() - 0.5) * spread : 0;
    const normalizedPos = Math.max(0, Math.min(1, position + spreadOffset));
    const offset = normalizedPos * buffer.duration;

    // A grain has two different lengths and conflating them is a bug:
    //   wallDuration — how long it sounds. The envelope and stop() use this.
    //   bufferSpan   — how much of the source it consumes. source.start()'s third
    //                  argument is in the BUFFER's time base, so it must be scaled
    //                  by playbackRate.
    const available = buffer.duration - offset;   // buffer-seconds remaining
    if (available <= 0) return;

    const wallDuration = Math.min(duration, available / pitch);

    // Bail on extremely short grains (< 1ms of wall clock) — they'd just be clicks
    if (wallDuration < 0.001) return;

    const bufferSpan = wallDuration * pitch;

    // --- Anti-clipping Layer 1: per-grain amplitude scaling ---
    // Estimate how many grains overlap at any moment: overlap = wallDuration / interOnset.
    // Both terms must be wall-clock or the scaling is wrong at any pitch != 1.
    const interOnset = params.interOnset || wallDuration; // fallback: no overlap
    const overlap = Math.max(1, wallDuration / interOnset);
    const overlapScale = 1 / Math.sqrt(overlap);
    const scaledAmplitude = amplitude * overlapScale;
```

Then replace the envelope application, the scheduling, and the visualiser payload:

```js
    // Apply envelope: start silent, ramp through curve, end silent
    gainNode.gain.setValueAtTime(0, when);
    gainNode.gain.setValueCurveAtTime(scaledCurve, when, wallDuration);
```

```js
    // --- Schedule playback ---
    // The source runs out of material at exactly `when + wallDuration`; the
    // explicit stop is a guard against float rounding, offset by 1 ms so it can
    // never truncate the tail of the envelope.
    source.start(when, offset, bufferSpan);
    source.stop(when + wallDuration + 0.001);

    // --- Notify visualizer ---

    if (onGrain) {
        onGrain({
            position: normalizedPos,
            duration: wallDuration,
            amplitude,
            pitch,
            when
        });
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/grainFactory.test.mjs`
Expected: `pass 6`, `fail 0`.

- [ ] **Step 5: Verify by ear**

Serve the app (`python3 -m http.server 8000`), load the default sample, and drag along the **top edge** of the waveform (pitch ≈ 4). Before this fix that region buzzes at the grain rate; it should now be clean. Compare with `git stash` if unsure.

- [ ] **Step 6: Commit**

```bash
git add src/audio/grainFactory.js tests/grainFactory.test.mjs
git commit -m "fix(audio): scale grain buffer span by playbackRate

source.start()'s duration argument is in the buffer's time base, so at pitch>1
the source fell silent while the gain envelope was still at its peak, cutting
every grain at full amplitude. The whole upper half of the XY pad was affected.

Separates wallDuration (envelope, stop, onGrain, overlap estimate) from
bufferSpan (source.start). Fixes AUDIT-CODE #1."
```

---

### Task 2: Clamp the grain scheduler's cursor and cap grains per tick (C2, C14)

**Files:**
- Modify: `src/audio/GrainScheduler.js:86-114`
- Test: `tests/scheduler.test.mjs`

**Interfaces:**
- Consumes: `new GrainScheduler(audioContext, onScheduleGrain)`, `.start()`, `.stop()`.
- Produces: no API change. `MAX_GRAINS_PER_TICK` is module-private.

> `Metronome._tick` has the same missing clamp. It is fixed properly in Task 8 by deriving from the clock rather than accumulating — do not patch it here.

- [ ] **Step 1: Write the failing test**

Create `tests/scheduler.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, FakeTimers, install, SRC } from './fakes.mjs';

const { GrainScheduler } = await import(SRC + 'audio/GrainScheduler.js');

/** Run a scheduler for `seconds` of audio time with timers in lockstep. */
function run(sched, ctx, timers, seconds) {
    const endMs = timers.now + seconds * 1000;
    const t0 = timers.now;
    const c0 = ctx.currentTime;
    timers.runUntil(endMs, (nowMs) => { ctx.currentTime = c0 + (nowMs - t0) / 1000; });
}

test('a timer stall does not produce a burst of grains scheduled in the past', () => {
    const timers = new FakeTimers();
    const restore = install(timers);
    try {
        const ctx = new FakeAudioContext();
        const scheduled = [];
        const s = new GrainScheduler(ctx, (when) => scheduled.push(when));
        s.setInterOnset(5);            // 5 ms — the fastest the UI can produce
        s.start();

        run(s, ctx, timers, 0.2);
        const beforeStall = scheduled.length;

        // Model a 30 s hidden tab: the audio clock keeps running, the timer does not.
        ctx.currentTime += 30;
        scheduled.length = 0;
        run(s, ctx, timers, 0.05);     // one tick's worth

        assert.ok(scheduled.length <= 256,
            `expected a bounded catch-up, got ${scheduled.length} grains`);
        const past = scheduled.filter(w => w < ctx.currentTime - 0.05);
        assert.equal(past.length, 0, `${past.length} grains scheduled in the past`);
        assert.ok(beforeStall > 0, 'sanity: scheduler was running before the stall');
        s.stop();
    } finally { restore(); }
});

test('steady-state scheduling is unaffected', () => {
    const timers = new FakeTimers();
    const restore = install(timers);
    try {
        const ctx = new FakeAudioContext();
        const scheduled = [];
        const s = new GrainScheduler(ctx, (when) => scheduled.push(when));
        s.setInterOnset(100);          // 100 ms
        s.start();
        run(s, ctx, timers, 1.0);
        // ~1 s at 100 ms spacing, plus the 100 ms look-ahead window.
        assert.ok(scheduled.length >= 9 && scheduled.length <= 12,
            `expected ~10-11 grains, got ${scheduled.length}`);
        // Spacing is exact.
        for (let i = 1; i < scheduled.length; i++) {
            assert.ok(Math.abs((scheduled[i] - scheduled[i - 1]) - 0.1) < 1e-9);
        }
        s.stop();
    } finally { restore(); }
});

test('stop() cancels the pending timer', () => {
    const timers = new FakeTimers();
    const restore = install(timers);
    try {
        const ctx = new FakeAudioContext();
        let n = 0;
        const s = new GrainScheduler(ctx, () => n++);
        s.start();
        s.stop();
        const after = n;
        run(s, ctx, timers, 1.0);
        assert.equal(n, after, 'no grains after stop()');
    } finally { restore(); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/scheduler.test.mjs`
Expected: the stall test FAILS with roughly 6000 grains scheduled, all in the past. The other two pass.

- [ ] **Step 3: Add the clamp and the budget**

In `src/audio/GrainScheduler.js`, add near the top after the imports:

```js
/**
 * Hard cap on grains scheduled in a single tick. The clamp below already drops
 * missed grains, so this only bounds pathological cases (a stall arriving mid-tick).
 */
const MAX_GRAINS_PER_TICK = 256;
```

Replace the head of `_tick()`:

```js
    _tick() {
        if (!this._running) return;

        const now = this.audioContext.currentTime;

        // Re-anchor after a timer stall. setTimeout is throttled to >=1 s in a
        // hidden tab and blocked outright by decodeAudioData, GC or a session
        // import, while audioContext.currentTime keeps running. Without this the
        // loop below would run (stall / interOnset) times with `when` in the past,
        // and source.start(when < currentTime) starts immediately — so every
        // missed grain fires in the same render quantum.
        // Missed grains are dropped, not replayed.
        if (this.nextGrainTime < now) this.nextGrainTime = now;

        const deadline = now + this.scheduleAhead;

        let budget = MAX_GRAINS_PER_TICK;
        while (this.nextGrainTime < deadline && budget-- > 0) {
```

The body of the loop and the `setTimeout` re-arm at the end are unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/scheduler.test.mjs`
Expected: `pass 3`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/audio/GrainScheduler.js tests/scheduler.test.mjs
git commit -m "fix(audio): clamp grain scheduler cursor to currentTime after a stall

nextGrainTime was only ever advanced by interOnset and never re-anchored, so a
hidden tab or a long decodeAudioData produced thousands of grains scheduled in
the past, all firing in one render quantum. Fixes AUDIT-CODE #2 and #14."
```

---

### Task 3: Voice gain lifecycle — cancel stale fades on re-trigger (C5, C50)

**Files:**
- Modify: `src/audio/Voice.js:80-90` (`start`), `:140-154` (`stop`)
- Test: `tests/voice.test.mjs`

**Interfaces:**
- Consumes: `new Voice(id, audioContext, destination)`, `.start(params)`, `.stop()`, `.setGainLevel(v)`.
- Produces: no API change.

- [ ] **Step 1: Write the failing test**

Create `tests/voice.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, FakeTimers, install, makeBuffer, SRC } from './fakes.mjs';

const { Voice } = await import(SRC + 'audio/Voice.js');

function mkVoice(ctx) {
    const v = new Voice(0, ctx, ctx.createGain());
    v.setBuffer(makeBuffer(ctx, 5));
    return v;
}

test('re-triggering within the 30 ms release window does not leave the gain at zero', () => {
    const timers = new FakeTimers();
    const restore = install(timers);
    try {
        const ctx = new FakeAudioContext();
        const v = mkVoice(ctx);

        v.start({ position: 0.5, amplitude: 1 });
        v.setGainLevel(0.4);
        ctx.advance(0.5);

        v.stop();                       // schedules linearRamp(0, now + 0.03)
        ctx.advance(0.005);             // re-allocated 5 ms later
        v.start({ position: 0.5, amplitude: 1 });
        v.setGainLevel(0.4);

        const pending = v.gainNode.gain.pendingAfter(ctx.currentTime);
        const toZero = pending.filter(e => e.args[0] === 0);
        assert.equal(toZero.length, 0,
            'a ramp to 0 is still scheduled after the restart — the voice will be silent');
        v.stop();
    } finally { restore(); }
});

test('start() anchors the gain at its current value before any new ramp', () => {
    const ctx = new FakeAudioContext();
    const v = mkVoice(ctx);
    v.start({ position: 0.5 });
    const ev = v.gainNode.gain.events;
    const cancelIdx = ev.findIndex(e => e.method === 'cancelScheduledValues');
    const anchorIdx = ev.findIndex(e => e.method === 'setValueAtTime');
    assert.ok(cancelIdx >= 0, 'start() must cancel the previous timeline');
    assert.ok(anchorIdx > cancelIdx, 'and anchor the current value after cancelling');
    v.stop();
});

test('stop() ramps to zero over 30 ms', () => {
    const ctx = new FakeAudioContext();
    const v = mkVoice(ctx);
    v.start({ position: 0.5 });
    ctx.advance(1.0);
    v.stop();
    const ramp = v.gainNode.gain.events.filter(e => e.method === 'linearRampToValueAtTime').at(-1);
    assert.equal(ramp.args[0], 0);
    assert.ok(Math.abs(ramp.args[1] - 1.03) < 1e-9);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/voice.test.mjs`
Expected: the first two FAIL — `start()` currently never touches the gain node, so the stale ramp-to-zero survives.

- [ ] **Step 3: Fix `Voice.start`**

In `src/audio/Voice.js`, replace `start(params)`:

```js
    /**
     * Start the voice with given parameters.
     * @param {Object} params
     */
    start(params) {
        const now = this.audioContext.currentTime;

        // A previous stop() left a linearRamp-to-zero on this node's timeline.
        // Voices are pooled and VoiceAllocator hands back the first inactive slot
        // immediately, so a re-trigger inside that 30 ms window would let the stale
        // ramp win — the param reaches 0 and holds there, because nothing schedules
        // another event until some unrelated voice starts or stops. Cancel it and
        // anchor the current value before the new ramps arrive.
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);

        this.active = true;
        this.arpIndex = 0;
        this.arpDirection = 1;
        this.update(params);

        // Gain level is set externally by GranularEngine._updateVoiceGains()
        // (anti-clipping Layer 2: 1/sqrt(activeVoiceCount))

        this.scheduler.start();
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/voice.test.mjs`
Expected: `pass 3`, `fail 0`.

- [ ] **Step 5: Verify by hand**

In the browser, double-tap rapidly on the waveform with one finger. Before the fix, some taps are silent; after, every tap sounds.

- [ ] **Step 6: Commit**

```bash
git add src/audio/Voice.js tests/voice.test.mjs
git commit -m "fix(audio): cancel the stale release ramp when a pooled voice restarts

Voice.stop() schedules linearRamp(0, now+0.03) and nothing cancelled it, so a
voice re-allocated inside that window had its gain pinned at 0 for its whole
life. Fixes AUDIT-CODE #5."
```

---

### Task 4: Drive the Player from the audio clock, not requestAnimationFrame (C9, C10)

**Files:**
- Modify: `src/automation/Player.js:102-151`, `:227-315`
- Modify: `src/main.js` — add a `visibilitychange` handler
- Test: `tests/player.test.mjs`

**Interfaces:**
- Consumes: `new Player(audioContext)`, `.play(lane, loop)`, `.stop()`, `.setLane(lane)`, `.setLoop(bool)`, `.setLoopRange(start, end)`, `.getLoopRange()`, callbacks `onDispatch`/`onRelease`/`onFrame`/`onComplete`/`onLoopWrap`.
- Produces: unchanged public API. Internally `_rafId` becomes `_timerId`; `TICK_MS = 25` is module-private. `onFrame` now fires at ~40 Hz instead of ~60 Hz — `TransportBar.setTime`/`setProgress` (the only consumers, wired at `src/main.js:1249`) are unaffected.

- [ ] **Step 1: Write the failing test**

Create `tests/player.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, FakeTimers, install, SRC } from './fakes.mjs';

const { Player } = await import(SRC + 'automation/Player.js');
const { AutomationLane } = await import(SRC + 'automation/AutomationLane.js');

/** A lane with one voice held from `start` to `end`. */
export function lane(events) {
    const l = new AutomationLane();
    for (const e of events) l.addEvent(e);
    return l;
}

const P = (t) => ({ position: 0.5, amplitude: 0.8, pitch: 1, grainSize: 0.05, interOnset: 0.03, spread: 0, pan: 0, envelope: 'hann', _tag: t });

/** Advance both clocks together to `seconds` of audio time. */
function advance(ctx, timers, seconds) {
    const endMs = timers.now + seconds * 1000;
    const t0 = timers.now, c0 = ctx.currentTime;
    timers.runUntil(endMs, (nowMs) => { ctx.currentTime = c0 + (nowMs - t0) / 1000; });
}

function harness() {
    const timers = new FakeTimers();
    const restore = install(timers);
    const ctx = new FakeAudioContext();
    const p = new Player(ctx);
    const dispatched = [];
    p.onDispatch = (type, id, params) => dispatched.push({ type, id, tag: params?._tag, at: ctx.currentTime });
    p.onRelease = (id) => dispatched.push({ type: 'release', id, at: ctx.currentTime });
    return { timers, ctx, p, dispatched, restore };
}

test('playback keeps running while rAF is frozen (backgrounded tab)', () => {
    const { timers, ctx, p, dispatched, restore } = harness();
    try {
        const l = lane([
            { time: 0.1, voiceIndex: 0, type: 'start', params: P('s') },
            { time: 1.0, voiceIndex: 0, type: 'stop' },
        ]);
        p.play(l, false);
        timers.freeze();                 // tab hidden: rAF stops, setTimeout throttles but survives
        advance(ctx, timers, 2.0);
        const stops = dispatched.filter(d => d.type === 'stop');
        assert.equal(stops.length, 1,
            'the recorded stop must still be delivered while the tab is hidden');
    } finally { restore(); }
});

test('stop() cancels the transport timer', () => {
    const { timers, ctx, p, dispatched, restore } = harness();
    try {
        p.play(lane([{ time: 0.5, voiceIndex: 0, type: 'start', params: P('s') }]), true);
        p.stop();
        const n = dispatched.length;
        advance(ctx, timers, 3.0);
        assert.equal(dispatched.length, n, 'nothing dispatched after stop()');
        assert.equal(p.isPlaying, false);
    } finally { restore(); }
});

test('onFrame reports monotonically increasing elapsed time', () => {
    const { timers, ctx, p, restore } = harness();
    try {
        const frames = [];
        p.onFrame = (elapsed) => frames.push(elapsed);
        p.play(lane([{ time: 2.0, voiceIndex: 0, type: 'stop' }]), false);
        advance(ctx, timers, 1.0);
        assert.ok(frames.length > 10, `expected regular frames, got ${frames.length}`);
        for (let i = 1; i < frames.length; i++) {
            assert.ok(frames[i] >= frames[i - 1] - 1e-9, 'elapsed went backwards');
        }
    } finally { restore(); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/player.test.mjs`
Expected: the frozen-tab test FAILS (no `stop` dispatched — rAF never fires).

- [ ] **Step 3: Replace the rAF transport with a look-ahead timer**

In `src/automation/Player.js`, add below `CROSSFADE_WINDOW`:

```js
/**
 * Transport tick interval (ms). Matches GrainScheduler's timer so both run on
 * the same cadence. rAF is not usable here: browsers suspend it entirely in a
 * hidden tab, while grain production runs on setTimeout and keeps going — so an
 * rAF-driven transport lets voices drone for as long as the tab is away and then
 * drops whole loop iterations on return.
 */
const TICK_MS = 25;
```

Rename the field in the constructor:

```js
        /** @type {number|null} setTimeout id for the transport tick */
        this._timerId = null;
```

In `play()`, replace the last line:

```js
        this.isPlaying = true;
        this._timerId = setTimeout(this._tick, TICK_MS);
        this._tick();
```

In `stop()`:

```js
    stop() {
        this.isPlaying = false;
        if (this._timerId !== null) {
            clearTimeout(this._timerId);
            this._timerId = null;
        }
        this._stopIterationVoices('A');
        this._stopIterationVoices('B');
        this._lane = null;
    }
```

At the end of `_tick()`, replace the rAF re-arm:

```js
        this._timerId = setTimeout(this._tick, TICK_MS);
```

And in the non-looping completion branch, replace `this._rafId = null;` with:

```js
                this._stopIterationVoices('A');
                this._stopIterationVoices('B');
                this.isPlaying = false;
                if (this._timerId !== null) { clearTimeout(this._timerId); this._timerId = null; }
                if (this.onFrame) this.onFrame(this._duration, 1);
                if (this.onComplete) this.onComplete();
                return;
```

Guard against re-entrancy at the top of `_tick` — `play()` calls it synchronously after arming the timer:

```js
    /** @private */
    _tick() {
        if (this._timerId !== null) { clearTimeout(this._timerId); this._timerId = null; }
        if (!this.isPlaying || !this._lane) return;
```

- [ ] **Step 4: Add the visibility handler in main.js**

In `src/main.js`, immediately after the `beforeunload` listener (around line 786):

```js
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/player.test.mjs`
Expected: `pass 3`, `fail 0`.

- [ ] **Step 6: Verify in the browser**

Record a short loop, start it playing, switch to another tab for ~20 seconds, and switch back. Before: continuous drone while away. After: the loop keeps its own timing and no voice is stuck.

- [ ] **Step 7: Commit**

```bash
git add src/automation/Player.js src/main.js tests/player.test.mjs
git commit -m "fix(automation): drive the transport from setTimeout, not rAF

Browsers suspend rAF in a hidden tab while setTimeout survives, so voice stop
events were never delivered while grain production kept running. Adds a
visibilitychange handler for live pointer voices. Fixes AUDIT-CODE #9 and #10."
```

---

### Task 5: Advance the loop anchor by exact loop lengths (C6, C21)

**Files:**
- Modify: `src/automation/Player.js:240-273` (the loop boundary branch)
- Test: `tests/player.test.mjs` (append)

**Interfaces:**
- Consumes: Task 4's `_timerId` transport.
- Produces: no API change. `_lastProcessedTime` after a wrap now accounts for both the frame overshoot and the crossfade pre-dispatch window.

- [ ] **Step 1: Write the failing test**

Append to `tests/player.test.mjs`:

```js
test('the loop anchor advances by exact loop lengths and never drifts', () => {
    const { timers, ctx, p, restore } = harness();
    try {
        const wraps = [];
        p.onLoopWrap = () => wraps.push(ctx.currentTime);
        const l = lane([
            { time: 0.0, voiceIndex: 0, type: 'start', params: P('a') },
            { time: 1.9, voiceIndex: 0, type: 'stop' },
            { time: 2.0, voiceIndex: 0, type: 'start', params: P('b') },
        ]);
        // 2.01 s, NOT 2.0. TICK_MS is 25 ms and 2.0/0.025 = 80 exactly, so a 2 s
        // loop lands precisely on FakeTimers' grid, the overshoot is always zero,
        // and the old reset-to-now behaves identically to the exact advance — the
        // test would pass either way. At 2.01 s the old code drifts 0.435 s over
        // this minute (reproducing the audit's measured 0.42 s) and the new code
        // 0.010 s.
        p.setLoopRange(0, 2.01);
        p.play(l, true);
        advance(ctx, timers, 60.0);

        assert.ok(wraps.length >= 25, `expected ~29 wraps, got ${wraps.length}`);
        // Each wrap must land on an exact multiple of the loop length. With the old
        // reset-to-now behaviour each iteration was one frame too long, accumulating
        // ~0.42 s of drift over a minute.
        for (let i = 0; i < wraps.length; i++) {
            const ideal = 2.01 * (i + 1);
            assert.ok(Math.abs(wraps[i] - ideal) < 0.05,
                `wrap ${i}: ${wraps[i].toFixed(3)} vs ideal ${ideal.toFixed(3)}`);
        }
        const totalDrift = Math.abs(wraps.at(-1) - 2.01 * wraps.length);
        assert.ok(totalDrift < 0.05, `accumulated drift ${totalDrift.toFixed(3)} s`);
        p.stop();
    } finally { restore(); }
});

test('crossfade pre-dispatched events do not fire twice at the wrap', () => {
    const { timers, ctx, p, dispatched, restore } = harness();
    try {
        // An event at 0.02 s sits inside the 50 ms crossfade window.
        const l = lane([
            { time: 0.02, voiceIndex: 0, type: 'start', params: P('early') },
            { time: 1.5, voiceIndex: 0, type: 'stop' },
        ]);
        p.setLoopRange(0, 2.0);
        p.play(l, true);
        advance(ctx, timers, 6.5);      // three wraps

        // Group starts by which synthetic id range they used. Each iteration should
        // start 'early' exactly once.
        const starts = dispatched.filter(d => d.type === 'start' && d.tag === 'early');
        const byId = new Map();
        for (const s of starts) byId.set(s.id, (byId.get(s.id) ?? 0) + 1);
        for (const [id, count] of byId) {
            assert.ok(count <= 3, `synthetic id ${id} started 'early' ${count} times`);
        }
        // Total starts should be ~one per iteration (3-4), not two per iteration.
        assert.ok(starts.length <= 5,
            `expected ~4 starts across 3 wraps, got ${starts.length} (double-firing)`);
        p.stop();
    } finally { restore(); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/player.test.mjs`
Expected: the drift test FAILS with a total drift around 0.4–0.7 s; the double-fire test FAILS with roughly twice the expected start count.

- [ ] **Step 3: Rewrite the loop boundary branch**

In `src/automation/Player.js`, replace the whole `if (elapsed >= loopEnd) { if (this._loop) { … } … }` block:

```js
        // === LOOP BOUNDARY ===
        if (elapsed >= loopEnd) {
            if (this._loop) {
                const loopLen = loopEnd - this._loopStart;
                if (loopLen <= 0) { this._timerId = setTimeout(this._tick, TICK_MS); return; }

                const didCrossfade = this._crossfadeStarted;

                // Release old iteration voices (grains play out naturally)
                this._releaseIterationVoices(this._currentIteration);

                // Swap iterations
                this._currentIteration = this._currentIteration === 'A' ? 'B' : 'A';

                // Advance the anchor by whole loop lengths rather than resetting it
                // to `now`. Resetting discarded the frame overshoot, making every
                // iteration one tick too long — unbounded drift. A long stall can
                // span several iterations, so consume them all.
                let overshoot = elapsed - loopEnd;
                this._startTime += loopLen;
                while (overshoot >= loopLen) {
                    this._startTime += loopLen;
                    overshoot -= loopLen;
                }

                // _preStartNextIteration already dispatched
                // [loopStart, loopStart + CROSSFADE_WINDOW) on the incoming voices.
                // Resume after that window so those events do not fire a second time.
                const alreadySent = didCrossfade ? CROSSFADE_WINDOW : 0;
                this._lastProcessedTime = this._loopStart + Math.max(alreadySent, overshoot);

                this._crossfadeStarted = false;

                // Notify loop wrap (used for overdub auto-commit)
                if (this.onLoopWrap) this.onLoopWrap();
            } else {
```

The `else` branch (non-looping completion) is unchanged from Task 4.

- [ ] **Step 3b: Make the dispatch cursor monotonic**

The boundary block above is not sufficient on its own. Further down `_tick`, at the end of the
normal dispatch section, the cursor is reassigned unconditionally:

```js
        this._lastProcessedTime = currentElapsed;
```

On the tick that wraps, `currentElapsed` has only just passed `loopStart` — so it is *lower*
than the skip point the boundary block just set, and this line silently undoes the skip within
the same tick. The crossfade window is then re-dispatched on the next tick and its events fire
twice. Change it to:

```js
        // Monotonic. The boundary block above may have pushed _lastProcessedTime
        // PAST currentElapsed — to skip the crossfade window the pre-start already
        // dispatched, or to consume a multi-iteration stall. An unconditional
        // assignment here silently undid that within the same tick.
        this._lastProcessedTime = Math.max(this._lastProcessedTime, currentElapsed);
```

The cursor then holds at the skip point until the playhead catches up, and the next wrap resets
it explicitly via the assignment in the boundary block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/player.test.mjs`
Expected: `pass 5`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/automation/Player.js tests/player.test.mjs
git commit -m "fix(automation): advance the loop anchor by exact loop lengths

Resetting _startTime to currentTime at each wrap discarded the frame overshoot,
making every iteration ~14 ms too long (measured 0.42 s of drift per minute).
Also skips the crossfade window on resume so pre-started events fire once.
Fixes AUDIT-CODE #6 and #21."
```

---

### Task 6: Phase-lock loop-station playback to the bar grid once, at launch (C7, C22, C56)

**Files:**
- Modify: `src/automation/Player.js:120-137` (`play`), `:227-260` (`_tick` head)
- Test: `tests/player.test.mjs` (append)

**Interfaces:**
- Consumes: Task 5's exact-length advance.
- Produces: `play()` in loop-station mode now defers the first event to the next bar boundary. `getElapsedTime()` may return a negative value between `play()` and that boundary; `Player.onFrame` is not called until elapsed ≥ 0, so `TransportBar` never sees a negative time.

> **Intentional behaviour change.** Loop-station playback now launches on the next bar rather than instantly, the way a hardware loop station does. This is what makes multiple layers line up. After a fixed-length recording the boundary is already imminent, so the delay is imperceptible there.

- [ ] **Step 1: Write the failing test**

Append to `tests/player.test.mjs`:

```js
const { MasterClock } = await import(SRC + 'audio/MasterClock.js');

test('loop-station playback phase-locks to the bar grid once and stays locked', () => {
    const { timers, ctx, p, restore } = harness();
    try {
        const clock = new MasterClock(ctx);
        clock.bpm = 120;                       // bar = 2.0 s at 4/4
        clock.setEpoch(0);
        p.setLoopStationMode(true, clock);

        const wraps = [];
        p.onLoopWrap = () => wraps.push(ctx.currentTime);
        const l = lane([
            { time: 0.0, voiceIndex: 0, type: 'start', params: P('a') },
            { time: 3.9, voiceIndex: 0, type: 'stop' },
        ]);
        p.setLoopRange(0, 4.0);                // 2 bars

        ctx.currentTime = 3.3;                 // launch off-grid, mid-bar
        p.play(l, true);
        advance(ctx, timers, 20.0);

        // Every wrap must sit on a bar boundary (a multiple of 2.0 s from the epoch).
        for (const w of wraps) {
            const offGrid = Math.abs(w / 2.0 - Math.round(w / 2.0)) * 2.0;
            assert.ok(offGrid < 0.05, `wrap at ${w.toFixed(3)} is ${offGrid.toFixed(3)} s off the bar grid`);
        }
        assert.ok(wraps.length >= 3, `expected several wraps, got ${wraps.length}`);
        p.stop();
    } finally { restore(); }
});

test('the playhead never jumps backwards at a loop-station wrap', () => {
    const { timers, ctx, p, restore } = harness();
    try {
        const clock = new MasterClock(ctx);
        clock.bpm = 120;
        clock.setEpoch(0);
        p.setLoopStationMode(true, clock);

        const elapsedSeen = [];
        p.onFrame = (e) => elapsedSeen.push(e);
        p.setLoopRange(0, 4.0);
        ctx.currentTime = 1.1;
        p.play(lane([{ time: 3.9, voiceIndex: 0, type: 'stop' }]), true);
        advance(ctx, timers, 20.0);

        assert.ok(elapsedSeen.length > 0, 'onFrame was called');
        for (const e of elapsedSeen) {
            assert.ok(e >= 0, `onFrame reported a negative elapsed time: ${e}`);
            assert.ok(e <= 4.1, `onFrame reported elapsed beyond the loop: ${e}`);
        }
        p.stop();
    } finally { restore(); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/player.test.mjs`
Expected: both FAIL. Wraps land off-grid because `play()` anchors to `currentTime`, and `onFrame` reports negative elapsed values because `quantizeToBar` can round the anchor into the future.

- [ ] **Step 3: Phase-lock in `play()` and drop the per-wrap re-grid**

In `src/automation/Player.js`, replace the anchor assignment in `play()`:

```js
        // Phase-lock to the bar grid exactly once, at launch. Thereafter the anchor
        // advances by exact loop lengths (see the wrap handler), so it cannot drift
        // off the grid and never needs re-snapping. Re-snapping per wrap with
        // Math.round used to teleport the playhead up to half a bar in either
        // direction, replaying material outside the loop range.
        if (this._loopStationMode && this._clock) {
            this._startTime = this._clock.getNextBarTime() - this._loopStart;
        } else {
            // Subtract _loopStart here too. The pre-roll guard below blocks
            // dispatch until `elapsed` reaches _loopStart, so anchoring at plain
            // currentTime would freeze a NON-loop-station player for _loopStart
            // seconds of dead air and then drop everything before it. Anchoring
            // back by _loopStart makes elapsed START at _loopStart, so playback
            // begins immediately at the trimmed loop start — which is also the
            // correct fix for AUDIT-CODE #22 (play() ignoring _loopStart on the
            // first pass).
            this._startTime = this._audioContext.currentTime - this._loopStart;
        }
        this._lastProcessedTime = this._loopStart;
```

In `_tick()`, add the pre-roll guard immediately after the re-entrancy guard from Task 4:

```js
        const elapsed = this._audioContext.currentTime - this._startTime;
        const { start: loopStart, end: loopEnd } = this._resolveLoop();

        // Pre-roll: in loop-station mode the anchor sits on the next bar boundary,
        // so elapsed is below the loop start until the launch point arrives. Do
        // nothing until then — no dispatch, no onFrame (a negative time would print
        // a garbage clock and a negative CSS width).
        //
        // Compare against the RESOLVED start, not the raw _loopStart: with a
        // bar-based loop starting after bar 0 the two differ, the guard stops
        // firing, and onFrame runs through the whole pre-roll.
        if (elapsed < loopStart) {
            this._timerId = setTimeout(this._tick, TICK_MS);
            return;
        }

        const loopEnd = this._loopEnd > 0 ? this._loopEnd : this._duration;
```

> **Note on the wrap handler.** Task 5 already replaced the whole loop-boundary
> block, and its replacement contains no `quantizeToBar` re-grid — so between Task 5
> and this task, loop-station mode has no bar alignment at all. That is expected and
> transient: this task restores alignment properly by phase-locking once at `play()`.
> There is nothing left to delete in the wrap handler; add a comment recording why
> it is absent, immediately after the `while (overshoot >= loopLen)` loop:

```js
                // No re-grid here. The anchor was phase-locked to the bar at play()
                // and only ever advances by whole loop lengths, so it stays on the
                // grid by construction. Re-snapping per wrap with quantizeToBar
                // (Math.round) used to teleport the playhead up to half a bar.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/player.test.mjs`
Expected: `pass 7`, `fail 0`.

- [ ] **Step 5: Verify multi-layer sync in the browser**

Record a 2-bar loop on tab 1 and let it play. Add tab 2, record another 2-bar loop. Both should stay locked together indefinitely — previously they drifted apart.

- [ ] **Step 6: Commit**

```bash
git add src/automation/Player.js tests/player.test.mjs
git commit -m "fix(automation): phase-lock loop-station playback once at launch

quantizeToBar uses Math.round, so re-snapping at every wrap teleported the
playhead up to half a bar backwards and replayed material outside the loop
range. Locks to the next bar at play() instead and lets the exact-length
advance keep it there. Fixes AUDIT-CODE #7, #22 and #56."
```

---

### Task 7: Store loop points in bars so BPM changes retime rather than truncate (C8)

**Files:**
- Modify: `src/automation/Player.js` — add `setLoopBars`, `_resolveLoop`, `retime`
- Modify: `src/main.js:73-79` (BPM slider), `:875-911` (`finishRecording`)
- Modify: `src/state/SessionSerializer.js:29-37`, `src/state/InstanceManager.js:308-318`
- Test: `tests/player.test.mjs` (append)

**Interfaces:**
- Consumes: `MasterClock.getBarDuration()`.
- Produces:
  - `Player.setLoopBars(startBars: number, lengthBars: number): void` — musical loop points; overrides any seconds-based range.
  - `Player.getLoopBars(): {startBars, lengthBars}|null`
  - `Player.retime(): void` — re-anchor after a tempo change, preserving the fraction through the loop.
  - `Player.getLoopableDuration(): number` — the loop window's length in seconds (used by Task 11).
  - Session JSON gains `recording.loopBars: {startBars, lengthBars} | null` alongside the existing `recording.loopRange` (kept for backward compatibility).

- [ ] **Step 1: Write the failing test**

Append to `tests/player.test.mjs`:

```js
test('a bar-based loop retimes on a BPM change instead of truncating', () => {
    const { timers, ctx, p, restore } = harness();
    try {
        const clock = new MasterClock(ctx);
        clock.bpm = 120;                       // bar = 2.0 s
        clock.setEpoch(0);
        p.setLoopStationMode(true, clock);

        const wraps = [];
        p.onLoopWrap = () => wraps.push(ctx.currentTime);
        p.setLoopBars(0, 2);                   // 2 bars = 4.0 s at 120
        p.play(lane([{ time: 3.9, voiceIndex: 0, type: 'stop' }]), true);

        // Advance to 8.0, NOT 10.0. In loop-station mode play() phase-locks to the
        // next bar (2.0 s), so wraps land at 6.0, 10.0, 14.0 — changing the tempo
        // at 10.0 lands exactly ON a wrap, where _loopFraction is 0 and retime()
        // is indistinguishable from a no-op. The test would pass with retime()
        // deleted. 8.0 is mid-loop, where the re-anchor is observable.
        advance(ctx, timers, 8.0);
        const before = wraps.length;
        assert.ok(before >= 1, 'looping at 120 bpm');

        clock.bpm = 140;                       // bar = 1.714 s => 2 bars = 3.4286 s
        p.retime();
        wraps.length = 0;
        advance(ctx, timers, 20.0);

        assert.ok(wraps.length >= 4, `expected faster wraps after the tempo change, got ${wraps.length}`);
        for (let i = 1; i < wraps.length; i++) {
            const interval = wraps[i] - wraps[i - 1];
            assert.ok(Math.abs(interval - 3.4286) < 0.06,
                `interval ${interval.toFixed(4)} s, expected 2 bars at 140 bpm = 3.4286 s`);
        }
        p.stop();
    } finally { restore(); }
});

test('getLoopableDuration reflects the musical loop, not the last event time', () => {
    const { ctx, p, restore } = harness();
    try {
        const clock = new MasterClock(ctx);
        clock.bpm = 120;
        clock.setEpoch(0);
        p.setLoopStationMode(true, clock);
        p.setLoopBars(0, 4);
        assert.equal(p.getLoopableDuration(), 8.0);
        clock.bpm = 60;
        assert.equal(p.getLoopableDuration(), 16.0);
    } finally { restore(); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/player.test.mjs`
Expected: FAIL with `p.setLoopBars is not a function`.

- [ ] **Step 3: Add bar-based loop points to the Player**

In `src/automation/Player.js`, add to the constructor beside `_loopStart`/`_loopEnd`:

```js
        /**
         * Musical loop window, when set. Bar-based points are re-derived from the
         * clock on every read, so a tempo change retimes the loop coherently
         * instead of truncating it: _loopEnd was captured in seconds at record
         * time while the wrap was snapped to the live grid, so raising the BPM
         * silently cut the tail off every iteration.
         * @type {{startBars: number, lengthBars: number}|null}
         */
        this._loopBars = null;

        /** Fraction through the loop at the last tick, for retime(). */
        this._loopFraction = 0;
```

Add the methods, after `getLoopRange()`:

```js
    /**
     * Set the loop window in bars. Takes precedence over setLoopRange().
     * @param {number} startBars
     * @param {number} lengthBars
     */
    setLoopBars(startBars, lengthBars) {
        this._loopBars = { startBars, lengthBars };
    }

    /** @returns {{startBars: number, lengthBars: number}|null} */
    getLoopBars() {
        return this._loopBars ? { ...this._loopBars } : null;
    }

    /**
     * Resolve the loop window in seconds for this instant.
     * @returns {{start: number, end: number}}
     * @private
     */
    _resolveLoop() {
        if (this._loopBars && this._clock) {
            const bar = this._clock.getBarDuration();
            const start = this._loopBars.startBars * bar;
            return { start, end: start + this._loopBars.lengthBars * bar };
        }
        return {
            start: this._loopStart,
            end: this._loopEnd > 0 ? this._loopEnd : this._duration,
        };
    }

    /** Length of the loop window in seconds. */
    getLoopableDuration() {
        const { start, end } = this._resolveLoop();
        return Math.max(0, end - start);
    }

    /**
     * Re-anchor after a tempo change so the playhead keeps its position within
     * the loop. Call once per playing Player whenever the master BPM moves.
     */
    retime() {
        if (!this.isPlaying || !this._loopBars || !this._clock) return;
        const { start, end } = this._resolveLoop();
        const pos = start + this._loopFraction * (end - start);
        this._startTime = this._audioContext.currentTime - pos;
        this._lastProcessedTime = pos;
        this._crossfadeStarted = false;
    }
```

Replace every read of the loop window inside `_tick()` and `_preStartNextIteration()` with `_resolveLoop()`. In `_tick`, after the pre-roll guard:

```js
        const { start: loopStart, end: loopEnd } = this._resolveLoop();
```

and use `loopStart` in place of `this._loopStart` throughout the wrap handler. Track the fraction just before reporting progress:

```js
        // Monotonic. The boundary block above may have pushed _lastProcessedTime
        // PAST currentElapsed — to skip the crossfade window the pre-start already
        // dispatched, or to consume a multi-iteration stall. An unconditional
        // assignment here silently undid that within the same tick, and the
        // crossfade events fired twice.
        this._lastProcessedTime = Math.max(this._lastProcessedTime, currentElapsed);

        const window = loopEnd - loopStart;
        this._loopFraction = window > 0
            ? Math.min(1, Math.max(0, (currentElapsed - loopStart) / window))
            : 0;

        // Report frame progress
        if (this.onFrame) {
            this.onFrame(currentElapsed, this._duration > 0 ? currentElapsed / this._duration : 0);
        }
```

In `play()`, use the resolved start for the anchor:

```js
        const { start: loopStart } = this._resolveLoop();
        if (this._loopStationMode && this._clock) {
            this._startTime = this._clock.getNextBarTime() - loopStart;
        } else {
            // Keep Task 6's `- loopStart`. Dropping it here reintroduces the
            // pre-roll freeze: the guard blocks dispatch until elapsed reaches
            // loopStart, so a non-loop-station player with a trimmed loop would
            // sit silent for loopStart seconds and then drop everything before it.
            this._startTime = this._audioContext.currentTime - loopStart;
        }
        this._lastProcessedTime = loopStart;
```

In `_preStartNextIteration()`, replace `const windowEnd = this._loopStart + CROSSFADE_WINDOW;`:

```js
        const { start: loopStart } = this._resolveLoop();
        const windowEnd = loopStart + CROSSFADE_WINDOW;
        const events = this._lane.getEventsInRange(loopStart, windowEnd);
```

- [ ] **Step 4: Set bar-based loops when recording finishes**

In `src/main.js`, in `finishRecording`, replace the loop-range block:

```js
    // Use fixed duration for loop range (or snap to bar for free-form)
    if (active.state.loopStationMode) {
        const bars = fixedRecordDuration
            ? (active.state.recordBarCount || 4)
            : Math.max(1, Math.round(active.recorder.getElapsedTime() / masterBus.clock.getBarDuration()));
        // Musical, not seconds: a later tempo change must retime the loop rather
        // than cut its tail off.
        active.player.setLoopBars(0, bars);
        transport.setLoopRange(0, 1);
    }
```

- [ ] **Step 5: Retime every playing layer on a BPM change**

In `src/main.js`, extend the BPM slider handler:

```js
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
```

Apply the same two lines in the tap-tempo handler, after `masterBus.clock.bpm = clamped;`.

- [ ] **Step 6: Persist the bar-based loop**

In `src/state/SessionSerializer.js`, in `serializeSession`:

```js
        if (lane.length > 0) {
            instanceData.recording = {
                lane: lane.toJSON(),
                loopRange: entry.player.getLoopRange(),   // seconds, legacy readers
                loopBars: entry.player.getLoopBars(),     // musical, preferred
            };
        }
```

In `src/state/InstanceManager.js`, in `restoreFromSession`:

```js
            if (savedState.recording && savedState.recording.lane) {
                const lane = AutomationLane.fromJSON(savedState.recording.lane);
                recorder.setRecording(lane);
                // Prefer the musical loop; fall back to seconds for sessions saved
                // before loopBars existed.
                if (savedState.recording.loopBars) {
                    player.setLoopBars(
                        savedState.recording.loopBars.startBars,
                        savedState.recording.loopBars.lengthBars
                    );
                } else if (savedState.recording.loopRange) {
                    player.setLoopRange(
                        savedState.recording.loopRange.start,
                        savedState.recording.loopRange.end
                    );
                }
            }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test "tests/*.test.mjs"`
Expected: `pass 9`, `fail 0` in `player.test.mjs`; all other files still green.

- [ ] **Step 8: Verify in the browser**

Record a 2-bar loop at 120 BPM in loop-station mode. While it plays, drag the BPM slider to 140. The loop should speed up and stay complete — before this fix the last 0.57 s of every iteration was silently cut.

- [ ] **Step 9: Commit**

```bash
git add src/automation/Player.js src/main.js src/state/SessionSerializer.js src/state/InstanceManager.js tests/player.test.mjs
git commit -m "fix(automation): store loop points in bars, not seconds

_loopEnd was captured in seconds at record time while the wrap snapped to the
live bar grid, so raising the BPM cut the tail off every iteration forever.
Loop windows are now musical and re-derived from the clock, with retime() to
re-anchor playing layers on a tempo change. Fixes AUDIT-CODE #8."
```

---

### Task 8: Derive the metronome grid from the clock instead of accumulating (C3)

**Files:**
- Modify: `src/audio/Metronome.js:58-71` (`start`), `:143-169` (`_tick`)
- Test: `tests/metronome.test.mjs`

**Interfaces:**
- Consumes: `MasterClock.getNextBeatTime(t)`, `.getBeatInBar(t)`.
- Produces: `Metronome._nextBeatIndex` is removed — the beat index is derived per click. `start()` no longer computes an index.

- [ ] **Step 1: Write the failing test**

Create `tests/metronome.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, FakeTimers, install, SRC } from './fakes.mjs';

const { Metronome } = await import(SRC + 'audio/Metronome.js');
const { MasterClock } = await import(SRC + 'audio/MasterClock.js');

function advance(ctx, timers, seconds) {
    const endMs = timers.now + seconds * 1000;
    const t0 = timers.now, c0 = ctx.currentTime;
    timers.runUntil(endMs, (ms) => { ctx.currentTime = c0 + (ms - t0) / 1000; });
}

function harness(bpm = 120) {
    const timers = new FakeTimers();
    const restore = install(timers);
    const ctx = new FakeAudioContext();
    const clock = new MasterClock(ctx);
    clock.bpm = bpm;
    clock.setEpoch(0);
    const met = new Metronome(ctx, clock, ctx.createGain());
    return { timers, ctx, clock, met, restore };
}

/** The `when` of every scheduled click, in order. */
const clickTimes = (ctx) => ctx.nodes.filter(n => n.type === 'oscillator').map(o => o.started);

test('clicks land on the clock beat grid', () => {
    const { timers, ctx, clock, met, restore } = harness(120);
    try {
        met.start();
        advance(ctx, timers, 4.0);
        const times = clickTimes(ctx);
        assert.ok(times.length >= 6, `expected ~8 clicks, got ${times.length}`);
        for (const t of times) {
            const off = Math.abs(t / 0.5 - Math.round(t / 0.5)) * 0.5;
            assert.ok(off < 1e-6, `click at ${t} is ${off} s off the 0.5 s beat grid`);
        }
        met.stop();
    } finally { restore(); }
});

test('after a BPM change the clicks re-align to the clock grid', () => {
    const { timers, ctx, clock, met, restore } = harness(120);
    try {
        met.start();
        advance(ctx, timers, 10.0);
        clock.bpm = 140;                        // beat becomes 60/140 = 0.428571 s
        const before = clickTimes(ctx).length;
        advance(ctx, timers, 10.0);
        const after = clickTimes(ctx).slice(before);
        assert.ok(after.length >= 15, `expected ~23 clicks at 140 bpm, got ${after.length}`);

        const beat = 60 / 140;
        let worst = 0;
        for (const t of after) {
            const off = Math.abs(t / beat - Math.round(t / beat)) * beat;
            worst = Math.max(worst, off);
        }
        // The accumulator version drifts a permanent half beat (~214 ms) here.
        assert.ok(worst < 0.01, `worst phase error after the tempo change: ${(worst * 1000).toFixed(1)} ms`);
        met.stop();
    } finally { restore(); }
});

test('downbeats fall on bar boundaries', () => {
    const { timers, ctx, met, restore } = harness(120);
    try {
        const beats = [];
        met.onBeat = (idx) => beats.push(idx);
        met.start();
        advance(ctx, timers, 8.0);
        assert.ok(beats.length >= 8, `got ${beats.length} beat callbacks`);
        // 4/4: indices cycle 0,1,2,3
        for (let i = 1; i < beats.length; i++) {
            assert.equal(beats[i], (beats[i - 1] + 1) % 4, 'beat indices must cycle in order');
        }
        met.stop();
    } finally { restore(); }
});

test('a stall does not replay every missed beat', () => {
    const { timers, ctx, met, restore } = harness(120);
    try {
        met.start();
        advance(ctx, timers, 1.0);
        const before = clickTimes(ctx).length;
        ctx.currentTime += 30;                  // hidden tab
        advance(ctx, timers, 0.05);
        const added = clickTimes(ctx).length - before;
        assert.ok(added <= 4, `expected a bounded catch-up, got ${added} clicks`);
        met.stop();
    } finally { restore(); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/metronome.test.mjs`
Expected: the BPM-change test FAILS with a worst phase error around 214 ms; the stall test FAILS with ~60 clicks.

- [ ] **Step 3: Rewrite `_tick` to derive from the clock**

In `src/audio/Metronome.js`, delete `this._nextBeatIndex = 0;` from the constructor and add:

```js
/** Bound on clicks scheduled per tick, so a stall cannot burst. */
const MAX_CLICKS_PER_TICK = 8;

/** Nudge past exact boundaries so float equality never stalls the walk. */
const EPS = 1e-6;
```

Replace `start()`:

```js
    start() {
        if (this._running) return;
        this._running = true;
        // Derive the first beat from the clock. Nothing is cached beyond this —
        // see _tick.
        this._nextBeatTime = this._clock.getNextBeatTime(this._ctx.currentTime);
        this._tick();
    }
```

Replace `_tick()`:

```js
    _tick() {
        if (!this._running) return;

        const now = this._ctx.currentTime;
        const beatDur = this._clock.getBeatDuration();

        // Re-derive rather than accumulate. The old code computed the grid once at
        // start() and then did `_nextBeatTime += getBeatDuration()`, so it kept the
        // OLD phase and adopted the NEW period on any tempo or time-signature
        // change — while MasterClock re-maps every boundary from the epoch. Players
        // align to the clock grid and the user hears the metronome grid, so the two
        // ended up a permanent half beat apart after a single BPM tweak.
        // Two conditions, not one. `< now` alone is NOT enough: right after a tempo
        // change the cached time can still be in the FUTURE yet wrong, because it
        // was computed under the old period — that single stale click is the
        // measured 214 ms error. Re-deriving unconditionally is also wrong: it
        // throws away the deliberate advance below and re-schedules the same
        // pending click on every tick.
        if (this._nextBeatTime < now || beatDur !== this._lastBeatDuration) {
            this._nextBeatTime = this._clock.getNextBeatTime(now);
        }
        this._lastBeatDuration = beatDur;

        const deadline = now + this._scheduleAhead;

        let budget = MAX_CLICKS_PER_TICK;
        while (this._nextBeatTime < deadline && budget-- > 0) {
            const beatIndex = this._clock.getBeatInBar(this._nextBeatTime + EPS);
            this._scheduleClick(this._nextBeatTime, beatIndex);

            // Handle count-in completion
            if (this._countInRemaining > 0) {
                this._countInRemaining--;
                if (this._countInRemaining === 0 && this._onCountInComplete) {
                    const cb = this._onCountInComplete;
                    this._onCountInComplete = null;
                    const at = this._countInEndTime;
                    // Hand the exact audio time to the callback so recording t=0
                    // lands on the bar boundary rather than on a wall-clock estimate.
                    setTimeout(() => cb(at), Math.max(0, (at - this._ctx.currentTime) * 1000));
                }
            }

            this._nextBeatTime = this._clock.getNextBeatTime(this._nextBeatTime + EPS);
        }

        this._timerId = setTimeout(() => this._tick(), this._timerInterval);
    }
```

Rename `_countInBeatTime` to `_countInEndTime` in the constructor and in `startCountIn` (Task 9 rewrites `startCountIn` fully).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/metronome.test.mjs`
Expected: `pass 4`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/audio/Metronome.js tests/metronome.test.mjs
git commit -m "fix(audio): derive metronome beats from the clock, not float accumulation

The metronome computed its grid once at start() and accumulated, so after any
BPM change it kept the old phase with the new period — a permanent 214 ms
offset from the grid loops snap to (measured, 120->140). Fixes AUDIT-CODE #3."
```

---

### Task 9: Set the clock epoch once — count-in must not move it (C4, C48)

**Files:**
- Modify: `src/audio/MasterClock.js:53-70` (epoch management)
- Modify: `src/audio/Metronome.js:94-111` (`startCountIn`)
- Modify: `src/automation/Recorder.js:42-49` (`startRecording`)
- Modify: `src/main.js:856-867` (`beginFixedRecording`), `:1162-1179` (metronome toggle), `:968-984` (`onPlay`)
- Test: `tests/metronome.test.mjs` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `MasterClock.ensureEpoch(time?): void` — sets the epoch only if it has never been set. Idempotent.
  - `MasterClock.isAnchored: boolean`
  - `Metronome.startCountIn(onComplete: (atTime: number) => void)` — the callback now receives the exact `AudioContext` time of the downbeat.
  - `Recorder.startRecording(atTime?: number)` — `atTime` defaults to `currentTime`.

- [ ] **Step 1: Write the failing test**

Append to `tests/metronome.test.mjs`:

```js
test('startCountIn does not move the epoch under already-playing layers', () => {
    const { timers, ctx, clock, met, restore } = harness(120);
    try {
        clock.setEpoch(0);
        ctx.currentTime = 33.3;                 // arm a record at an arbitrary moment
        met.startCountIn(() => {});
        assert.equal(clock._epoch, 0,
            'the shared epoch moved — every already-looping layer would be re-gridded');
        met.stop();
    } finally { restore(); }
});

test('the count-in callback receives the exact downbeat time, one bar out', () => {
    const { timers, ctx, clock, met, restore } = harness(120);   // bar = 2.0 s
    try {
        clock.setEpoch(0);
        ctx.currentTime = 3.3;
        let fired = null;
        met.startCountIn((at) => { fired = at; });
        advance(ctx, timers, 6.0);

        assert.ok(fired !== null, 'count-in completed');
        // Count-in starts at the next bar (4.0) and runs one bar => downbeat at 6.0.
        assert.ok(Math.abs(fired - 6.0) < 1e-6, `downbeat at ${fired}, expected 6.0`);
        const off = Math.abs(fired / 2.0 - Math.round(fired / 2.0)) * 2.0;
        assert.ok(off < 1e-6, 'the downbeat must sit on a bar boundary');
        met.stop();
    } finally { restore(); }
});

test('ensureEpoch is idempotent', async () => {
    const { ctx, clock, restore } = harness();
    try {
        ctx.currentTime = 5;
        clock.ensureEpoch();
        assert.equal(clock._epoch, 5);
        ctx.currentTime = 99;
        clock.ensureEpoch();
        assert.equal(clock._epoch, 5, 'a second call must not move the epoch');
        assert.equal(clock.isAnchored, true);
    } finally { restore(); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/metronome.test.mjs`
Expected: FAIL — the epoch moves to 33.3, and `clock.ensureEpoch is not a function`.

- [ ] **Step 3: Add `ensureEpoch` to MasterClock**

In `src/audio/MasterClock.js`, replace `this._epoch = 0;` in the constructor:

```js
        // Epoch: the AudioContext.currentTime at which beat 0 / bar 0 occurs.
        // Set ONCE, the first time audio starts, and never moved while anything is
        // playing — every Player and the Metronome derive their grid from it, so
        // moving it re-grids all of them at once.
        this._epoch = 0;
        this._anchored = false;
```

Add after `setEpoch`:

```js
    /** Whether the epoch has been anchored to a real start time. */
    get isAnchored() { return this._anchored; }

    /**
     * Anchor the epoch if it has not been anchored yet. Idempotent — repeat calls
     * are no-ops, which is what makes it safe to call from every entry point that
     * might be the first to start audio.
     * @param {number} [time] - AudioContext.currentTime value. Defaults to now.
     */
    ensureEpoch(time) {
        if (this._anchored) return;
        this._epoch = time ?? this._ctx.currentTime;
        this._anchored = true;
    }
```

And mark `setEpoch` as anchoring too:

```js
    setEpoch(time) {
        this._epoch = time ?? this._ctx.currentTime;
        this._anchored = true;
    }
```

- [ ] **Step 4: Rewrite `startCountIn`**

In `src/audio/Metronome.js`:

```js
    /**
     * Count in one bar, then fire `onComplete` on the following downbeat.
     *
     * Does NOT move the clock epoch. There is one MasterClock for the whole app,
     * shared by every instance's Player, so re-anchoring it here used to teleport
     * every already-looping layer by up to half a bar — the act of recording a new
     * layer knocked the existing ones out of time.
     *
     * @param {(atTime: number) => void} onComplete - Receives the exact
     *   AudioContext time of the downbeat, so recording t=0 can land on the grid.
     */
    startCountIn(onComplete) {
        const now = this._ctx.currentTime;
        this._clock.ensureEpoch(now);

        // Start on the next bar line and count one full bar.
        const barStart = this._clock.getNextBarTime(now);
        this._countInEndTime = barStart + this._clock.getBarDuration();
        this._countInRemaining = this._clock.numerator;
        this._onCountInComplete = onComplete;

        if (!this._running) {
            this._running = true;
            this._nextBeatTime = barStart;
            this._tick();
        } else {
            // Already free-running on the grid: just start counting from the bar line.
            this._nextBeatTime = Math.max(this._nextBeatTime, barStart);
        }
    }
```

Also clear the pending visual callbacks in `stop()` — already present — and add `this._countInEndTime = 0;`.

- [ ] **Step 5: Let the Recorder start at an exact time**

In `src/automation/Recorder.js`:

```js
    /**
     * Start recording. Resets the lane and begins capturing events.
     * @param {number} [atTime] - AudioContext time to treat as t=0. Defaults to
     *   now. Pass the count-in downbeat so the recording's origin sits exactly on
     *   the bar grid rather than on a wall-clock setTimeout estimate.
     */
    startRecording(atTime) {
        this._lane.clear();
        this._undoSnapshot = null;
        this._lastMoveTime.clear();
        this._startTime = atTime ?? this._audioContext.currentTime;
        this.isRecording = true;
        this.isOverdubbing = false;
    }
```

- [ ] **Step 6: Thread the downbeat time through main.js**

In `src/main.js`, change `beginFixedRecording` to accept it:

```js
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
```

And in `transport.onRecord`, pass it through both count-in branches:

```js
            if (!metronomeEnabled) {
                masterBus.metronome.setMuted(true);
                masterBus.metronome.startCountIn((at) => {
                    masterBus.metronome.setMuted(false);
                    beginFixedRecording(at);
                });
            } else {
                masterBus.metronome.startCountIn((at) => beginFixedRecording(at));
            }
```

Replace every remaining `masterBus.clock.setEpoch(masterBus.audioContext.currentTime);` in `main.js` (in `finishRecording`, `onPlay`, `onOverdub`, and the metronome toggle) with:

```js
                masterBus.clock.ensureEpoch();
```

And anchor once when audio is unlocked, in `dismissUnlockOverlay`:

```js
function dismissUnlockOverlay() {
    masterBus.resume();
    // Anchor the shared musical grid the first time audio starts. Everything —
    // metronome, every Player's bar alignment — derives from this instant.
    masterBus.clock.ensureEpoch();
    if (unlockOverlay) {
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test "tests/*.test.mjs"`
Expected: all green.

- [ ] **Step 8: Verify multi-layer sync**

Start a loop on tab 1. Switch to tab 2 and hit Record. Tab 1 must keep its timing through tab 2's count-in — previously it jumped by up to half a bar.

- [ ] **Step 9: Commit**

```bash
git add src/audio/MasterClock.js src/audio/Metronome.js src/automation/Recorder.js src/main.js tests/metronome.test.mjs
git commit -m "fix(audio): anchor the clock epoch once instead of on every count-in

startCountIn() called setEpoch() on the single shared MasterClock, re-gridding
every already-looping layer. Count-in now starts on the next bar line without
moving the epoch, and hands the exact downbeat time to the recorder so t=0
lands on the grid. Fixes AUDIT-CODE #4 and #48."
```

---

### Task 10: Capture modulation state in recordings and reset it on voice start (C11)

**Files:**
- Modify: `src/automation/Recorder.js:124-178`, `:181-200` (`extractParams`)
- Modify: `src/audio/Voice.js:80-90` (`start`)
- Test: `tests/recorder.test.mjs`

**Interfaces:**
- Consumes: `resolveParams()` output shape from `src/main.js:302-317`.
- Produces:
  - `extractParams(resolved, full: boolean)` — `full` is `true` for `start` events (carries the heavy modulation config) and `false` for `move` events (scalars only, keeping lanes small).
  - `Voice.start()` now resets `randomize`, `grainSizeQuantize`, `pitchQuantize` and the scheduler's quantize/jitter fields before applying `params`, so a voice's behaviour never depends on which gesture last used that pool slot.

- [ ] **Step 1: Write the failing test**

Create `tests/recorder.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, makeBuffer, SRC } from './fakes.mjs';

const { Recorder } = await import(SRC + 'automation/Recorder.js');
const { Voice } = await import(SRC + 'audio/Voice.js');

/** A resolveParams()-shaped object with modulation active. */
const RESOLVED = {
    position: 0.4, amplitude: 0.8, pitch: 1.5, grainSize: 0.05, interOnset: 0.03,
    spread: 0.1, pan: 0, envelope: 'hann', adsr: { a: 0.2, d: 0.15, s: 0.7, r: 0.2 },
    randomize: { grainSize: [0.2, 0.8], pitch: [-2, 2], pan: [-1, 1] },
    interOnsetRange: [0.2, 0.7],
    interOnsetQuantize: { bpm: 120, divisor: 8 },
    grainSizeQuantize: { bpm: 120, divisor: 4 },
    pitchQuantize: { arpNotes: [0, 4, 7, 12], arpSequence: [0, 2, 1, 3] },
};

test('a start event carries the modulation config', () => {
    const ctx = new FakeAudioContext();
    const r = new Recorder(ctx);
    r.startRecording();
    r.captureStart(0, RESOLVED);
    const e = r.getRecording().events[0];
    assert.deepEqual(e.params.randomize, RESOLVED.randomize);
    assert.deepEqual(e.params.pitchQuantize, RESOLVED.pitchQuantize);
    assert.deepEqual(e.params.grainSizeQuantize, RESOLVED.grainSizeQuantize);
    assert.deepEqual(e.params.interOnsetQuantize, RESOLVED.interOnsetQuantize);
    assert.deepEqual(e.params.interOnsetRange, RESOLVED.interOnsetRange);
});

test('move events stay small — scalars only', () => {
    const ctx = new FakeAudioContext();
    const r = new Recorder(ctx);
    r.startRecording();
    r.captureStart(0, RESOLVED);
    ctx.advance(0.1);
    r.captureMove(0, RESOLVED);
    const move = r.getRecording().events.at(-1);
    assert.equal(move.type, 'move');
    assert.equal(move.params.pitchQuantize, undefined, 'the heavy arp table must not repeat per move');
    assert.equal(move.params.position, 0.4, 'scalars are still captured');
});

test('the lane round-trips modulation through JSON', () => {
    const ctx = new FakeAudioContext();
    const r = new Recorder(ctx);
    r.startRecording();
    r.captureStart(0, RESOLVED);
    const json = JSON.parse(JSON.stringify(r.getRecording().toJSON()));
    assert.deepEqual(json.events[0].params.pitchQuantize, RESOLVED.pitchQuantize);
});

test('Voice.start resets modulation so behaviour never depends on slot history', () => {
    const ctx = new FakeAudioContext();
    const v = new Voice(0, ctx, ctx.createGain());
    v.setBuffer(makeBuffer(ctx, 5));

    v.start(RESOLVED);                       // slot is now "warm" with an arp
    assert.ok(v.pitchQuantize !== null);
    v.stop();

    // A later gesture with no modulation must not inherit the arp.
    v.start({ position: 0.5, amplitude: 0.8, pitch: 1, grainSize: 0.05, interOnset: 0.03 });
    assert.equal(v.pitchQuantize, null, 'stale pitchQuantize inherited from the previous gesture');
    assert.deepEqual(v.randomize, { grainSize: null, pitch: null, pan: null });
    assert.equal(v.grainSizeQuantize, null);
    assert.equal(v.scheduler.quantizeBpm, null);
    assert.equal(v.scheduler.interOnsetRange, null);
    v.stop();
});

test('stopRecording emits stops for voices still held', () => {
    const ctx = new FakeAudioContext();
    const r = new Recorder(ctx);
    r.startRecording();
    r.captureStart(0, RESOLVED);
    r.captureStart(1, RESOLVED);
    ctx.advance(2.0);
    r.captureStop(1);
    r.stopRecording();

    const stops = r.getRecording().events.filter(e => e.type === 'stop');
    const stopped = new Set(stops.map(e => e.voiceIndex));
    assert.ok(stopped.has(0), 'voice 0 was never released — it would sustain forever on playback');
    assert.ok(stopped.has(1));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/recorder.test.mjs`
Expected: 4 of 5 FAIL — modulation is dropped, `Voice.start` inherits stale state, and no stop is emitted for the held voice.

- [ ] **Step 3: Rewrite `extractParams` and track held voices**

In `src/automation/Recorder.js`, add a held-voice set to the constructor:

```js
        /** @type {Set<number>} voiceIndexes with an open 'start' and no 'stop' yet */
        this._held = new Set();
```

Clear it in `startRecording`, `startOverdub` and `stopRecording`. Update the capture methods:

```js
    captureStart(voiceIndex, resolvedParams) {
        if (!this.isRecording) return;
        const time = this._audioContext.currentTime - this._startTime;
        const target = this._overdubLane || this._lane;
        target.addEvent({
            time,
            voiceIndex,
            type: 'start',
            params: extractParams(resolvedParams, true),
        });
        this._held.add(voiceIndex);
        this._lastMoveTime.delete(voiceIndex);
    }
```

In `captureMove`, change the params call to `extractParams(resolvedParams, false)`.
In `captureStop`, add `this._held.delete(voiceIndex);`.

Make `stopRecording` close out held voices:

```js
    stopRecording() {
        // Close any voice still held when recording stopped. Without this the lane
        // contains a 'start' with no matching 'stop', and on playback that voice
        // sustains for the rest of the loop.
        if (this.isRecording && this._held.size > 0) {
            const time = this._audioContext.currentTime - this._startTime;
            const target = this._overdubLane || this._lane;
            for (const voiceIndex of this._held) {
                target.addEvent({ time, voiceIndex, type: 'stop' });
            }
            this._held.clear();
        }

        if (this.isOverdubbing && this._overdubLane) {
            this._lane = AutomationLane.merge(this._lane, this._overdubLane);
            this._overdubLane = null;
        }
        this.isRecording = false;
        this.isOverdubbing = false;
        this._lastMoveTime.clear();
    }
```

Replace `extractParams`:

```js
/**
 * Extract the params relevant for automation playback.
 *
 * `full` events (voice starts) carry the modulation configuration —
 * randomize ranges, quantization and the arpeggiator note table. Without it,
 * replayed voices silently inherited whatever the pool slot last held from a live
 * gesture: a recording sounded right immediately after capture and lost its
 * arpeggio on reload, when every Voice is reconstructed with pitchQuantize=null.
 *
 * Move events carry scalars only. Voice.update() ignores undefined keys, so the
 * modulation set at 'start' stays in force for the whole gesture, and the arp
 * note table is not repeated 30 times a second in the saved session.
 *
 * @param {Object} resolved
 * @param {boolean} full - true for 'start' events
 * @returns {Object}
 */
function extractParams(resolved, full) {
    const params = {
        position: resolved.position,
        amplitude: resolved.amplitude,
        pitch: resolved.pitch,
        grainSize: resolved.grainSize,
        interOnset: resolved.interOnset,
        spread: resolved.spread,
        pan: resolved.pan,
        envelope: resolved.envelope,
    };
    if (resolved.adsr) params.adsr = resolved.adsr;
    if (!full) return params;

    params.randomize = resolved.randomize ?? null;
    params.interOnsetRange = resolved.interOnsetRange ?? null;
    params.interOnsetQuantize = resolved.interOnsetQuantize ?? null;
    params.grainSizeQuantize = resolved.grainSizeQuantize ?? null;
    params.pitchQuantize = resolved.pitchQuantize ?? null;
    return params;
}
```

- [ ] **Step 4: Reset modulation in `Voice.start`**

In `src/audio/Voice.js`, insert into `start()` before `this.update(params)`:

```js
        // Reset modulation to a known state. Voices are pooled, and update() only
        // overwrites keys that are defined, so without this a gesture with no
        // arpeggiator would inherit the previous gesture's note table.
        this.randomize = { grainSize: null, pitch: null, pan: null };
        this.grainSizeQuantize = null;
        this.pitchQuantize = null;
        this.scheduler.quantizeBpm = null;
        this.scheduler.quantizeDivisor = null;
        this.scheduler.interOnsetRange = null;

        this.active = true;
        this.arpIndex = 0;
        this.arpDirection = 1;
        this.update(params);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test "tests/*.test.mjs"`
Expected: all green.

- [ ] **Step 6: Verify the reload case**

Enable Randomize Pitch + Arpeggiator, pick a distinctive arp shape, record a 4-bar loop, confirm it sounds right. **Reload the page.** The restored loop must still arpeggiate — before this fix it played flat.

- [ ] **Step 7: Commit**

```bash
git add src/automation/Recorder.js src/audio/Voice.js tests/recorder.test.mjs
git commit -m "fix(automation): record modulation config and reset it on voice start

extractParams dropped randomize/quantize/arp config, so replayed voices
inherited whatever the pool slot last held. Recordings sounded correct until
reload and then lost their arpeggio entirely. Also emits stop events for voices
still held when recording ends. Fixes AUDIT-CODE #11 and #24."
```

---

### Task 11: One notion of recording duration for the loop handles (C12, C27, C29, C38)

**Files:**
- Modify: `src/main.js:1198-1226` (`onLoopRangeChange`), `:434-467` (tab switch), `:875-911` (`finishRecording`)
- Modify: `src/ui/TransportBar.js:176-187`
- Test: manual (this is DOM wiring; the Player-side contract is already covered by Task 7)

**Interfaces:**
- Consumes: `Player.getLoopableDuration()` and `Player.getLoopBars()` from Task 7.
- Produces: loop-handle fractions are relative to the **player's** loop window, not `Recorder.getElapsedTime()`. `TransportBar.setLoopRange` is called on every tab switch so the handles reflect the tab you are looking at.

- [ ] **Step 1: Fix the handle-to-seconds conversion**

In `src/main.js`, replace `transport.onLoopRangeChange`:

```js
transport.onLoopRangeChange = (startFrac, endFrac) => {
    const active = instanceManager.getActive();
    if (!active?.player) return;

    // Use the player's own loop domain. Recorder.getElapsedTime() returns the
    // timestamp of the LAST EVENT, which is always shorter than the bar-quantized
    // loop (the performer lifts their finger before the bar line) — so converting
    // handle fractions through it silently shortened the loop on every drag.
    const duration = active.player.getLoopableDuration() || active.recorder.getElapsedTime();
    if (duration <= 0) return;

    if (active.state.loopStationMode) {
        // Bar-quantized: convert fractions to whole bars.
        const barDur = masterBus.clock.getBarDuration();
        const totalBars = Math.max(1, Math.round(duration / barDur));
        const startBar = Math.max(0, Math.min(totalBars - 1, Math.round(startFrac * totalBars)));
        const endBar = Math.max(startBar + 1, Math.min(totalBars, Math.round(endFrac * totalBars)));
        active.player.setLoopBars(startBar, endBar - startBar);
        transport.setLoopRange(startBar / totalBars, endBar / totalBars);
        return;
    }

    let loopStart = startFrac * duration;
    let loopEnd = endFrac * duration;

    if (loopSnapToGrid) {
        const bpm = getMasterBpm();
        loopStart = quantizeTimeToGrid(loopStart, bpm);
        loopEnd = quantizeTimeToGrid(loopEnd, bpm);
        if (loopEnd <= loopStart) loopEnd = loopStart + (60 / bpm);
        transport.setLoopRange(loopStart / duration, loopEnd / duration);
    }

    active.player.setLoopRange(loopStart, loopEnd);
};
```

- [ ] **Step 2: Sync the handles on tab switch**

In `src/main.js`, in `tabBar`'s `onSwitch`, after `transport.setHasRecording(...)`, add:

```js
            // Loop handles are global UI state but loop ranges are per-instance —
            // without this the handles keep showing the previous tab's positions.
            if (active) {
                const bars = active.player.getLoopBars();
                const total = active.player.getLoopableDuration();
                if (bars && total > 0) {
                    const barDur = masterBus.clock.getBarDuration();
                    const totalBars = bars.startBars + bars.lengthBars;
                    transport.setLoopRange(
                        bars.startBars / totalBars,
                        1
                    );
                } else {
                    const range = active.player.getLoopRange();
                    const dur = active.recorder.getElapsedTime();
                    transport.setLoopRange(
                        dur > 0 ? range.start / dur : 0,
                        dur > 0 && range.end > 0 ? Math.min(1, range.end / dur) : 1
                    );
                }
            }
```

- [ ] **Step 3: Reset the loop range when a free-form take begins**

In `src/main.js`, in `transport.onRecord`'s "start recording flow" branch, before the mode split:

```js
        // A previous take's loop range would otherwise still be in force.
        active.player.setLoopBars(0, 0);
        active.player.setLoopRange(0, 0);
        transport.resetLoopRange();
```

Guard `setLoopBars(0, 0)` in the Player so a zero-length musical loop clears rather than sticks:

```js
    setLoopBars(startBars, lengthBars) {
        this._loopBars = lengthBars > 0 ? { startBars, lengthBars } : null;
    }
```

- [ ] **Step 4: Verify by hand**

Record a 4-bar loop in loop-station mode. Nudge the end handle and drop it at the far right — the loop must stay 4 bars. Switch tabs and back — the handles must show this tab's range.

- [ ] **Step 5: Commit**

```bash
git add src/main.js src/automation/Player.js src/ui/TransportBar.js
git commit -m "fix(ui): map loop handles onto the player's loop window

Handle fractions were converted through Recorder.getElapsedTime() (the last
event's timestamp) while the player's loop end was an exact bar count, so
touching a handle silently shortened the loop. Also syncs handles on tab switch
and resets the range for a new take. Fixes AUDIT-CODE #12, #27, #29 and #38."
```

---

### Task 12: Robustness and hygiene batch (C31, C35, C36, C46, C51, C55, C58, C88)

Each item is independently small; they ship together because none warrants its own review cycle.

**Files:**
- Modify: `src/audio/GranularEngine.js:52-56`, `src/main.js:23-45`, `src/audio/envelopes.js:336-366`, `src/automation/AutomationLane.js:44-53`, `src/audio/GrainScheduler.js:113`, `src/main.js:602-610`, `src/ui/ParameterPanel.js:7`
- Test: `tests/hygiene.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AutomationLane.getEventsInRange` gains an internal cursor; behaviour is unchanged for callers.

- [ ] **Step 1: Write the failing test**

Create `tests/hygiene.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, SRC } from './fakes.mjs';

test('loadSample rejects on an HTTP error instead of reporting a decode failure', async () => {
    const { GranularEngine } = await import(SRC + 'audio/GranularEngine.js');
    const ctx = new FakeAudioContext();
    ctx.decodeAudioData = async () => { throw new Error('decode'); };
    const saved = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'Not Found', arrayBuffer: async () => new ArrayBuffer(0) });
    try {
        const e = new GranularEngine(ctx, ctx.createGain());
        await assert.rejects(() => e.loadSample('samples/missing.mp3'), /404/);
    } finally { globalThis.fetch = saved; }
});

test('getEventsInRange is not O(n) from index 0 on every call', async () => {
    const { AutomationLane } = await import(SRC + 'automation/AutomationLane.js');
    const lane = new AutomationLane();
    for (let i = 0; i < 20000; i++) lane.addEvent({ time: i * 0.001, voiceIndex: 0, type: 'move', params: {} });
    let scanned = 0;
    const orig = lane.events;
    // Proxy counts element reads.
    lane.events = new Proxy(orig, { get(t, k) { if (typeof k === 'string' && /^\d+$/.test(k)) scanned++; return t[k]; } });
    for (let t = 0; t < 20; t += 0.001) lane.getEventsInRange(t, t + 0.001);
    lane.events = orig;
    assert.ok(scanned < 500000, `rescanned ${scanned} elements — expected a cursor, not a full sweep per call`);
});

test('the ADSR curve is generated by exactly one function', async () => {
    const mod = await import(SRC + 'audio/envelopes.js');
    const src = await (await import('node:fs/promises')).readFile(
        new URL('../src/audio/envelopes.js', import.meta.url), 'utf8');
    const bodies = src.match(/const aEnd\s+= Math\.floor/g) || [];
    assert.equal(bodies.length, 1, 'two byte-identical ADSR generators still present');
    assert.equal(typeof mod.computeADSREnvelope, 'function');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hygiene.test.mjs`
Expected: all three FAIL.

- [ ] **Step 3: Apply the fixes**

**a. `fetch` error handling** — `src/audio/GranularEngine.js`:

```js
    async loadSample(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return this._decodeAndStore(arrayBuffer);
    }
```

**b. `localStorage` guard** — `src/main.js`, replace the theme block at the top:

```js
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

const savedTheme = safeStorage.get('granul8-theme') || 'dark';
applyTheme(savedTheme);
```

Use the same helper in `src/state/SessionPersistence.js` (`load`, `clear`, `_writeToLocalStorage` already have try/catch — leave them, they are correct).

**c. Dedupe the ADSR generators** — `src/audio/envelopes.js`, delete `_computeCustomADSR` entirely and route the cached lookup through the parameterised version:

```js
export function getEnvelope(type, length) {
    switch (type) {
        case 'custom':   return computeADSREnvelope(_customADSRParams, length);
        case 'tukey':    return tukeyWindow(length);
```

**d. Lane cursor** — `src/automation/AutomationLane.js`:

```js
    /**
     * Return all events whose time falls within [startTime, endTime).
     * Keeps a cursor so sequential playback is O(events returned) rather than
     * O(lane length) per frame — with several layers playing a long lane, the
     * full rescan was the largest per-frame cost in the app.
     */
    getEventsInRange(startTime, endTime) {
        // Restart the scan when the caller jumps backwards (loop wrap, seek).
        if (this._cursor === undefined || this._cursorTime === undefined || startTime < this._cursorTime) {
            this._cursor = 0;
        }
        this._cursorTime = startTime;

        let i = this._cursor;
        while (i < this.events.length && this.events[i].time < startTime) i++;
        this._cursor = i;

        const result = [];
        while (i < this.events.length && this.events[i].time < endTime) {
            result.push(this.events[i]);
            i++;
        }
        return result;
    }
```

Reset the cursor in `clear()` and `addEvent()`:

```js
    addEvent(event) {
        this.events.push(event);
        this._cursor = undefined;
    }

    clear() {
        this.events = [];
        this._cursor = undefined;
    }
```

**e. Scheduler survives a throwing grain** — `src/audio/GrainScheduler.js`, wrap the loop:

```js
        try {
            while (this.nextGrainTime < deadline && budget-- > 0) {
                // ... unchanged body ...
            }
        } catch (err) {
            // Never let one bad grain kill the voice's scheduler permanently:
            // the timer re-arm below is outside this block.
            console.error('Grain scheduling failed:', err);
            this.nextGrainTime = this.audioContext.currentTime + this.scheduleAhead;
        }

        this._timerId = setTimeout(() => this._tick(), this.timerInterval);
```

**f. `markSampleMissing` must not compound** — `src/main.js`:

```js
function markSampleMissing(state, entry) {
    // Derive the label instead of mutating the persisted name, which used to
    // accumulate a fresh "⚠ … (missing)" wrapper on every reload.
    const base = state.sampleDisplayName.replace(/^⚠\s+|\s+\(missing\)$/g, '');
    const label = `⚠ ${base || state.sampleFileName} (missing)`;
    entry.buffer = null;
    if (instanceManager.activeId === state.id) {
        waveform.setBuffer(null);
        sampleNameEl.textContent = label;
        sampleSelect.value = '';
    }
}
```

**g. Drop the unused import** — `src/ui/ParameterPanel.js:7`, remove `applyArpType` from the import list.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "tests/*.test.mjs"`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/ tests/hygiene.test.mjs
git commit -m "fix: robustness and hygiene batch

- check response.ok before decoding a fetched sample
- guard top-level localStorage access (Safari private mode killed the app)
- dedupe the two byte-identical ADSR generators
- give AutomationLane a playback cursor instead of rescanning from 0 per frame
- keep a voice's scheduler alive when a grain throws
- stop markSampleMissing from compounding its own marker
- drop an unused import

Fixes AUDIT-CODE #31, #35, #36, #46, #51, #55, #58."
```

---

### Task 13: Close out Phase 1

- [ ] **Step 1: Run the full suite**

Run: `node --test "tests/*.test.mjs"`
Expected: 0 failures. Record the pass count in the commit message.

- [ ] **Step 2: Manual regression pass**

Work through this list in the browser and confirm each:

1. Load each of the nine bundled samples — no console errors.
2. Drag across the whole pad including the top edge — no clicking at high pitch.
3. Multi-touch with 3+ fingers — every touch sounds, no stuck voices on release.
4. Record a 4-bar loop in loop-station mode — count-in, auto-stop, auto-play.
5. Let it loop for 2 minutes — no drift against the metronome.
6. Change BPM mid-loop — the loop retimes and stays complete.
7. Add a second tab, record another loop — both stay locked together.
8. Background the tab for 30 s and return — no drone, no burst, no phase jump.
9. Enable arpeggiator, record, reload the page — the arp survives.
10. Export and re-import a session — everything restores.

- [ ] **Step 3: Update the audit doc status**

Add to the top of `AUDIT-CODE.md`, under the title:

```markdown
> **Status:** findings 1–12, 21, 22, 24, 27, 29, 31, 35, 36, 38, 46, 48, 51, 55, 56, 58
> were fixed in `fix/audio-timing` (see `agents/2026-08-15-audit-remediation-plan.md`).
> The remaining findings are open.
```

- [ ] **Step 4: Merge**

```bash
git checkout main
git merge --no-ff fix/audio-timing -m "merge: audio engine and timing fixes (Phase 1)"
```

---

# Phase 2 — Interface (branch `fix/ux`)

```bash
git checkout main && git checkout -b fix/ux
```

Fixes AUDIT-UX findings. Tasks 14–17 are mechanical and cheap; 18–22 need judgement.

### Task 14: Make every control reachable by keyboard (U1, U6, U28, U41, U48)

**Files:**
- Modify: `style.css:1160-1162` (the `display: none` toggles), append a focus block
- Modify: `index.html:298`, `:313`, `:328`, `:342`, `:181`, `:237`, `:284`, `:24`
- Test: `tests/a11y.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: a `.visually-hidden-input` CSS class for focusable-but-invisible checkboxes, and a global `:focus-visible` rule.

- [ ] **Step 1: Write the failing test**

Create `tests/a11y.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');

test('no interactive control is removed from the tab order with display:none', () => {
    // .toggle-label input[type="checkbox"] { display: none } takes seven controls
    // out of both the tab order and the accessibility tree.
    const rule = /\.toggle-label\s+input\[type="checkbox"\]\s*\{[^}]*\}/s.exec(css);
    assert.ok(rule, 'the toggle checkbox rule should still exist');
    assert.ok(!/display:\s*none/.test(rule[0]),
        'display:none removes the checkbox from the tab order and the a11y tree');
});

test('every range and select input has an accessible name', () => {
    const ids = [...html.matchAll(/<(input|select)[^>]*\bid="([^"]+)"[^>]*>/g)]
        .filter(m => !/type="(hidden|file)"/.test(m[0]))
        .map(m => ({ tag: m[1], id: m[2], raw: m[0] }));
    assert.ok(ids.length > 15, `sanity: found ${ids.length} controls`);

    const labelled = new Set([...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map(m => m[1]));
    const unnamed = ids.filter(c =>
        !labelled.has(c.id) &&
        !/aria-label=/.test(c.raw) &&
        !/aria-labelledby=/.test(c.raw)
    );
    assert.deepEqual(unnamed.map(c => c.id), [],
        'these controls are announced as anonymous sliders/selects');
});

test('a focus indicator is designed', () => {
    assert.ok(/:focus-visible/.test(css), 'no :focus-visible rule anywhere in the stylesheet');
});

test('pinch zoom is not blocked', () => {
    const vp = /<meta name="viewport"[^>]*>/.exec(html)[0];
    assert.ok(!/user-scalable\s*=\s*no/.test(vp),
        'user-scalable=no is a WCAG 1.4.4 failure on a UI whose smallest type is 4.5px');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/a11y.test.mjs`
Expected: all four FAIL.

- [ ] **Step 3: Replace `display: none` with a focusable hidden input**

In `style.css`, replace lines 1160–1162:

```css
/* Visually hidden but still focusable and still in the accessibility tree.
   `display: none` removes an element from BOTH the tab order and the a11y tree,
   which took all seven quantize/randomize switches out of reach — including the
   ones that enable the (initially disabled) subdivision selects next to them. */
.toggle-label input[type="checkbox"] {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
}

/* Focus lands on the invisible input, so show it on the visible switch. */
.toggle-label input[type="checkbox"]:focus-visible + .toggle-switch {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
}
```

- [ ] **Step 4: Add a global focus indicator**

Append to `style.css`, before the responsive media queries:

```css
/* === Focus visibility ===
   There was no focus styling anywhere, so keyboard users had no idea where they
   were. :focus-visible keeps pointer interaction unchanged. */
:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 3px;
}

/* The canvas is a large target; an inset ring reads better than an outline. */
#waveform-canvas:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
}

@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
    }
}
```

- [ ] **Step 5: Name the unnamed controls**

In `index.html`, add `aria-label` to each of the eight range inputs and the sample select. The `<label>` elements above them are group headings, not control labels, so `aria-label` on the input is the correct fix (a `for` would name only one of the pair):

```html
<select id="sample-select" aria-label="Bundled sample">
```

```html
                        <div class="param-group range-group">
                            <label id="lbl-grain-size">Grain Size</label>
                            <div class="range-row">
                                <span class="range-label">Min</span>
                                <input type="range" id="param-grain-size-min" aria-label="Grain size minimum" aria-describedby="val-grain-size-min" min="0" max="1" value="0.8674" step="0.001">
                                <span class="param-value" id="val-grain-size-min">400 ms</span>
                            </div>
                            <div class="range-row">
                                <span class="range-label">Max</span>
                                <input type="range" id="param-grain-size-max" aria-label="Grain size maximum" aria-describedby="val-grain-size-max" min="0" max="1" value="0.8674" step="0.001">
                                <span class="param-value" id="val-grain-size-max">400 ms</span>
                            </div>
```

Apply the identical pattern to the Density, Spread and Pan range groups:

| Input id | `aria-label` | `aria-describedby` |
|---|---|---|
| `param-density-min` | `Density minimum` | `val-density-min` |
| `param-density-max` | `Density maximum` | `val-density-max` |
| `param-spread-min` | `Spread minimum` | `val-spread-min` |
| `param-spread-max` | `Spread maximum` | `val-spread-max` |
| `param-pan-min` | `Pan minimum` | `val-pan-min` |
| `param-pan-max` | `Pan maximum` | `val-pan-max` |

- [ ] **Step 6: Remove the zoom lock**

In `index.html:5`:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
```

The per-element `touch-action: none` on `#waveform-canvas` (style.css:377), `#adsr-canvas` (1101) and `.arp-style-preview` (1397), plus the `touchstart`/`touchmove` `preventDefault` at `src/main.js:160-161`, already prevent stray zoom on the interactive surfaces.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test tests/a11y.test.mjs`
Expected: `pass 4`, `fail 0`.

- [ ] **Step 8: Verify by keyboard**

Load the app and press Tab repeatedly from the top. You must be able to reach and operate every quantize and randomize switch (Space toggles), and the focus ring must always be visible.

- [ ] **Step 9: Commit**

```bash
git add index.html style.css tests/a11y.test.mjs
git commit -m "fix(a11y): make every panel control keyboard-reachable

Seven quantize/randomize toggles were display:none, removing them from the tab
order and the accessibility tree; eight range sliders had no accessible name;
there was no focus indicator in 1551 lines of CSS; and user-scalable=no blocked
pinch zoom on a UI with 4.5px type. Fixes AUDIT-UX #1, #6, #28, #41, #48."
```

---

### Task 15: Make the audio-unlock overlay operable and dismissible (U10)

**Files:**
- Modify: `index.html:10-18`
- Modify: `src/main.js:135-157`
- Modify: `style.css:1281-1293`
- Test: `tests/a11y.test.mjs` (append)

**Interfaces:**
- Consumes: `MasterClock.ensureEpoch()` from Task 9.
- Produces: the overlay is a `role="dialog"` containing a real `<button id="unlock-btn">`. `#app` carries `inert` while it is up.

- [ ] **Step 1: Write the failing test**

Append to `tests/a11y.test.mjs`:

```js
test('the unlock gate is a real button inside a dialog', () => {
    const overlay = /<div id="audio-unlock-overlay"[\s\S]*?<\/div>\s*<\/div>/.exec(html);
    assert.ok(overlay, 'overlay markup found');
    assert.ok(/role="dialog"/.test(overlay[0]), 'needs role="dialog"');
    assert.ok(/aria-modal="true"/.test(overlay[0]), 'needs aria-modal');
    assert.ok(/<button[^>]*id="unlock-btn"/.test(overlay[0]),
        'the affordance must be a real button so Enter/Space work');
});

test('the app behind the overlay is inert', () => {
    const main = await import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../src/main.js', import.meta.url), 'utf8'));
    assert.ok(/inert/.test(main), 'nothing sets inert on #app — focus escapes behind the overlay');
});

test('the unlock scrim is theme-derived, not a hardcoded near-black', () => {
    const rule = /#audio-unlock-overlay\s*\{[^}]*\}/s.exec(css)[0];
    assert.ok(!/rgba\(18,\s*17,\s*15/.test(rule),
        'a hardcoded dark scrim under themed text renders "Tap to start" at 1.20:1 in light mode');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/a11y.test.mjs`
Expected: three new FAILs.

- [ ] **Step 3: Rewrite the overlay markup**

In `index.html`:

```html
    <div id="audio-unlock-overlay" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
        <div class="unlock-content">
            <h1 class="unlock-title" id="unlock-title">Granul8</h1>
            <p class="unlock-description">A granular sampler and loopstation<br>for the web and multitouch devices</p>
            <button id="unlock-btn" type="button" class="unlock-button">
                <span class="unlock-icon" aria-hidden="true"></span>
                <span class="unlock-text">Tap to start</span>
            </button>
            <div class="unlock-credits">All sounds from <a href="https://freemusicarchive.org/home" target="_blank" rel="noopener">Free Music Archive</a></div>
        </div>
    </div>
```

- [ ] **Step 4: Rewrite the dismissal logic**

In `src/main.js`, replace the unlock block:

```js
// --- iOS / Safari audio unlock overlay ---

const unlockOverlay = document.getElementById('audio-unlock-overlay');
const unlockBtn = document.getElementById('unlock-btn');
const appEl = document.getElementById('app');

function dismissUnlockOverlay() {
    masterBus.resume();
    // Anchor the shared musical grid the first time audio starts.
    masterBus.clock.ensureEpoch();
    appEl.removeAttribute('inert');
    if (unlockOverlay) {
        unlockOverlay.style.opacity = '0';
        unlockOverlay.style.pointerEvents = 'none';
        unlockOverlay.style.transition = 'opacity 0.3s';
        setTimeout(() => unlockOverlay.remove(), 400);
    }
    canvas.focus?.();
}

if (masterBus.audioContext.state === 'running') {
    unlockOverlay?.remove();
} else {
    // `inert` keeps focus out of the controls behind the blurred, click-blocking
    // overlay — without it Tab walked through sliders the user could not see.
    appEl.setAttribute('inert', '');
    // 'click' (not 'pointerdown') so Enter and Space work for keyboard users.
    unlockBtn?.addEventListener('click', dismissUnlockOverlay, { once: true });
    unlockBtn?.focus();
    // Any pointer anywhere still unlocks, matching the previous behaviour.
    document.addEventListener('pointerdown', function unlock() {
        dismissUnlockOverlay();
        document.removeEventListener('pointerdown', unlock);
    }, { once: true });
}
```

- [ ] **Step 5: Theme the scrim and style the button**

In `style.css`, replace the overlay background and add button styling:

```css
#audio-unlock-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    /* Derived from the theme. A hardcoded near-black scrim under themed text
       rendered "Tap to start" at 1.20:1 for anyone returning in light mode. */
    background: color-mix(in srgb, var(--bg-primary) 85%, transparent);
    z-index: 100;
    cursor: pointer;
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
}

.unlock-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin: 24px auto 0;
    padding: 16px 32px;
    min-height: 44px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: inherit;
    font: inherit;
    cursor: pointer;
}

.unlock-button:hover,
.unlock-button:focus-visible {
    background: var(--bg-surface);
}
```

- [ ] **Step 6: Run the tests and verify by keyboard**

Run: `node --test tests/a11y.test.mjs` → all pass.
In the browser, reload and press Tab then Enter — the app must unlock. Switch to light theme, reload, and confirm "Tap to start" is legible.

- [ ] **Step 7: Commit**

```bash
git add index.html style.css src/main.js tests/a11y.test.mjs
git commit -m "fix(a11y): make the audio-unlock gate operable and legible

The overlay was dismissible only by pointerdown, with no button, no dialog role
and no inert on the app behind it — keyboard users could never enter. Its scrim
was a hardcoded near-black under themed text, rendering the instruction at
1.20:1 in light mode. Fixes AUDIT-UX #10."
```

---

### Task 16: Fix mobile portrait — panel scroll, transport wrap, touch targets (U12, U13, U14, U26, U38)

**Files:**
- Modify: `style.css:805-811`, `:401-422`, `:1526-1529`, `:1542-1545`, `:719`, `:1144`
- Test: manual, at 393×852 and 375×667

**Interfaces:** none — pure CSS.

- [ ] **Step 1: Make the parameter panel the scroll container**

Replace `style.css:805-811`:

```css
/* === Parameter Panel === */
#parameter-panel {
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
    /* flex-shrink:0 meant the panel kept its full content height, so its own
       overflow-y never engaged — the overflow happened on #main-area (no overflow
       rule) and was clipped by body{overflow:hidden}. On a phone in portrait the
       bottom half of the controls was simply unreachable. */
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
}
```

- [ ] **Step 2: Let the transport bar wrap and keep 44px targets**

Replace `style.css:401-422`:

```css
#transport-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 16px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}

#transport-bar button {
    /* min-width, not width: the bar over-subscribes its line on any phone and
       flex was shrinking these to ~23px on a self-described multitouch instrument. */
    min-width: 44px;
    min-height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    color: var(--text-primary);
}
```

- [ ] **Step 3: Delete the shrinking overrides**

In the `@media (max-width: 600px)` block, replace the `#transport-bar button` override (lines 1526–1529) with a level-meter shrink instead — the meter has no touch role:

```css
    #level-meter {
        width: 44px;
    }

    /* Transport buttons keep their 44px minimum; the bar wraps instead. */
```

In the `@media (max-height: 420px)` block, replace lines 1542–1545 the same way:

```css
    #transport-bar {
        padding: 4px 8px;
    }

    /* Landscape phone: the panel gets a bounded height, but touch targets stay 44px. */
    #parameter-panel {
        max-height: 40vh;
    }
```

and delete the now-duplicated `#parameter-panel { max-height: 120px; overflow-y: auto; }` at the end of that block.

- [ ] **Step 4: Raise the sub-44px targets**

Find `.loop-handle` (around `style.css:719`) and `.bar-count-btn`, and give each an invisible expanded hit area:

```css
.loop-handle {
    /* visual size unchanged; the ::before expands the touch target to 44px
       without disturbing layout */
    position: absolute;
    /* ... existing visual properties ... */
}

.loop-handle::before {
    content: '';
    position: absolute;
    inset: -14px -18px;
}
```

Add to `.toggle-row` (around `style.css:1144`) so the Randomize row can fit on a phone:

```css
.toggle-row {
    display: flex;
    flex-wrap: wrap;      /* four toggles cannot fit one line under ~400px */
    align-items: center;
    gap: 8px;
}
```

- [ ] **Step 5: Verify at real sizes**

In Chrome DevTools device mode, check iPhone SE (375×667) and iPhone 14 (393×852) in portrait:
1. All parameter sections scroll — Gesture Mapping and the ADSR editor are reachable.
2. Every transport button is at least 44px; the bar wraps to two rows rather than shrinking.
3. The four Randomize toggles wrap instead of overflowing.
4. Rotate to landscape — the panel is capped and the buttons stay 44px.

- [ ] **Step 6: Commit**

```bash
git add style.css
git commit -m "fix(responsive): make the panel scrollable and keep 44px touch targets

flex-shrink:0 on #parameter-panel meant its overflow-y never engaged, so the
lower half of the controls was unreachable on a phone in portrait. Transport
buttons collapsed to ~23px because the bar had no wrap and the buttons no
min-width. Fixes AUDIT-UX #12, #13, #14, #26, #38."
```

---

### Task 17: Re-derive the light theme against measured contrast (U15, U16)

**Files:**
- Modify: `style.css:37-63` (the `[data-theme="light"]` block)
- Test: `tests/contrast.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `--accent` splits into `--accent` (fills and strokes, 3:1 is enough) and `--accent-text` (used by `.param-value` and any accent-coloured text, must clear 4.5:1).

- [ ] **Step 1: Write the failing test**

Create `tests/contrast.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');

/** Parse the custom properties out of one rule block. */
function tokens(selector) {
    const re = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
    const body = re.exec(css)?.[1] ?? '';
    const out = {};
    for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
    return out;
}

const hex = (h) => {
    const s = h.replace('#', '');
    const n = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
    return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255);
};
const lum = (rgb) => {
    const [r, g, b] = rgb.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
    const [l1, l2] = [lum(hex(a)), lum(hex(b))].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
};

/** Text token -> the backgrounds it actually appears on, per the audit. */
const PAIRS = [
    ['--text-secondary', '--bg-primary'],
    ['--text-secondary', '--bg-secondary'],
    ['--text-secondary', '--bg-surface'],
    ['--accent-text', '--bg-primary'],
    ['--accent-text', '--bg-secondary'],
    ['--accent-text', '--bg-surface'],
    ['--text-primary', '--bg-primary'],
];

for (const theme of [':root', '\\[data-theme="light"\\]']) {
    test(`${theme} text tokens clear WCAG AA (4.5:1)`, () => {
        const t = tokens(theme);
        const failures = [];
        for (const [fg, bg] of PAIRS) {
            if (!t[fg] || !t[bg]) { failures.push(`${fg} or ${bg} is not defined`); continue; }
            const r = ratio(t[fg], t[bg]);
            if (r < 4.5) failures.push(`${fg} on ${bg} = ${r.toFixed(2)}:1`);
        }
        assert.deepEqual(failures, [], `contrast failures in ${theme}`);
    });
}

test('the accent is split into a fill colour and a text colour', () => {
    assert.ok(/--accent-text:/.test(css),
        '--accent at 2.98:1 is the colour of every parameter readout; split it');
    assert.ok(/\.param-value\s*\{[^}]*var\(--accent-text\)/s.test(css),
        '.param-value must use --accent-text');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/contrast.test.mjs`
Expected: the light-theme test FAILS with `--text-secondary on --bg-surface = 3.61:1` and `--accent-text` undefined.

- [ ] **Step 3: Add `--accent-text` and darken the light tokens**

In `style.css`, add to the `:root` block (dark theme already passes; the token must exist in both):

```css
    --accent: #e8a87c;
    --accent-text: #e8a87c;   /* dark theme: 9.28:1 on --bg-primary, no change needed */
```

Replace the light-theme colour tokens:

```css
[data-theme="light"] {
    --bg-primary: #f5f0eb;
    --bg-secondary: #ede8e2;
    --bg-surface: #e2dbd4;
    --text-primary: #2a2420;
    /* Was #7a6e64: 4.37 / 4.06 / 3.61:1 against the three backgrounds — all below
       AA for the 10-13px text it is applied to. */
    --text-secondary: #5f554c;
    /* --accent stays as a fill/stroke colour (3:1 suffices for non-text).
       --accent-text is used wherever the accent carries words — .param-value is
       the numeric readout of every parameter in the app and was at 2.98:1. */
    --accent: #c47a4a;
    --accent-text: #9a5526;
    --accent-dim: #a06030;
    --accent-warm: #c94040;
    --accent-orange: #c47a4a;
    --record-red: #c94040;
    --play-green: #5a9a80;
    --border: #d0c8c0;
    --slider-track: #d0c8c0;
    --slider-thumb: #c47a4a;
```

(The `--canvas-*` block below is unchanged.)

- [ ] **Step 4: Point `.param-value` at the text token**

Around `style.css:863`:

```css
.param-value {
    color: var(--accent-text);
    font-variant-numeric: tabular-nums;
}
```

Do the same for any other accent-coloured **text**: `.unlock-title`, `.gesture-status.active`, `.arp-label`, `#val-bpm`.

- [ ] **Step 5: Raise the dimmed-control opacity**

`opacity: 0.35` puts dimmed labels at roughly 1.6:1. Replace `style.css:991-1002`:

```css
/* === Inactive parameter dimming ===
   0.35 pushed these to ~1.6:1 — illegible rather than merely de-emphasised.
   pointer-events:none also blocked the mouse but not the keyboard, so a keyboard
   user could still change a control that looked disabled. aria-disabled keeps the
   two in step; the control stays focusable so its state is discoverable. */
.param-inactive,
.range-row-inactive {
    opacity: 0.6;
    transition: opacity 0.2s;
}
```

In `src/ui/ParameterPanel.js`'s `updateParamRelevance`, mirror each class toggle with an `aria-disabled` attribute:

```js
        const setInactive = (el, inactive) => {
            el.classList.toggle('range-row-inactive', inactive);
            for (const input of el.querySelectorAll('input, select')) {
                input.setAttribute('aria-disabled', String(inactive));
            }
        };
        setInactive(this._grainSizeMinRow, !gsMinActive);
        setInactive(this._densityMinRow, !denMinActive);
        setInactive(this._spreadMinRow, !sprMinActive);
        setInactive(this._panMinRow, !panMinActive);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/contrast.test.mjs`
Expected: `pass 3`, `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add style.css src/ui/ParameterPanel.js tests/contrast.test.mjs
git commit -m "fix(theme): re-derive the light palette against measured contrast

The light theme was built by eye as a mirror of the dark one and never
measured: --text-secondary landed at 3.61:1 on --bg-surface and --accent, the
colour of every parameter readout, at 2.98:1. Splits --accent into a fill and a
text colour and adds a regression test that computes the ratios.
Fixes AUDIT-UX #15, #16."
```

---

### Task 18: Move the voice palette into CSS so canvas feedback survives the light theme (U17)

**Files:**
- Modify: `src/ui/voiceColors.js`
- Modify: `style.css` — add `--voice-0` … `--voice-9` to both theme blocks
- Modify: `src/ui/GhostRenderer.js:75`, `:103`
- Modify: `src/main.js:38-45` (theme toggle)
- Test: `tests/contrast.test.mjs` (append)

**Interfaces:**
- Consumes: the `WaveformDisplay._readThemeColors()` pattern.
- Produces:
  - `getVoiceColor(voiceId): [r, g, b]` — unchanged signature, now reads the cached palette.
  - `refreshVoiceColors(): void` — re-reads the CSS custom properties. Called from the theme toggle.

- [ ] **Step 1: Write the failing test**

Append to `tests/contrast.test.mjs`:

```js
test('the voice palette is themed, not hardcoded', async () => {
    const js = await readFile(new URL('../src/ui/voiceColors.js', import.meta.url), 'utf8');
    assert.ok(/getPropertyValue/.test(js),
        'voiceColors.js is a hardcoded dark-theme palette drawn onto a themed canvas');
    for (const theme of [':root', '\\[data-theme="light"\\]']) {
        const t = tokens(theme);
        for (let i = 0; i < 10; i++) {
            assert.ok(t[`--voice-${i}`], `--voice-${i} missing from ${theme}`);
        }
    }
});

test('GhostRenderer uses theme tokens, not white and a near-record-red', async () => {
    const js = await readFile(new URL('../src/ui/GhostRenderer.js', import.meta.url), 'utf8');
    assert.ok(!/rgba\(255,\s*255,\s*255/.test(js),
        'the playback cursor is white-on-white in light mode');
    assert.ok(!/rgba\(224,\s*60,\s*60/.test(js),
        'the recording tint is a hardcoded near-miss of --record-red');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/contrast.test.mjs`
Expected: both FAIL.

- [ ] **Step 3: Add the palette tokens**

In `style.css`'s `:root` block, append (these are the current hardcoded values, unchanged):

```css
    /* Per-voice canvas palette. Read by src/ui/voiceColors.js via
       getComputedStyle, the same way WaveformDisplay reads its own colours. */
    --voice-0: 232, 168, 124;
    --voice-1: 224, 85, 85;
    --voice-2: 122, 191, 160;
    --voice-3: 240, 200, 140;
    --voice-4: 200, 110, 90;
    --voice-5: 160, 200, 140;
    --voice-6: 230, 140, 100;
    --voice-7: 180, 210, 180;
    --voice-8: 220, 160, 100;
    --voice-9: 190, 130, 120;
    --canvas-ghost-cursor: 42, 36, 32;
    --canvas-record-tint: 224, 85, 85;
```

And to `[data-theme="light"]`, darker variants that read against `#ede8e2`:

```css
    /* Darkened for the light canvas: at the alpha values GrainOverlay uses, the
       dark palette computed to 1.09:1 against #ede8e2 — the entire visual feedback
       layer washed out. */
    --voice-0: 166, 92, 40;
    --voice-1: 168, 40, 40;
    --voice-2: 40, 116, 90;
    --voice-3: 150, 108, 36;
    --voice-4: 150, 62, 44;
    --voice-5: 82, 118, 56;
    --voice-6: 164, 78, 40;
    --voice-7: 84, 122, 84;
    --voice-8: 150, 96, 40;
    --voice-9: 132, 70, 62;
    --canvas-ghost-cursor: 42, 36, 32;
    --canvas-record-tint: 201, 64, 64;
```

- [ ] **Step 4: Read them in `voiceColors.js`**

Replace `src/ui/voiceColors.js` entirely:

```js
// voiceColors.js — Per-voice palette for canvas feedback, read from CSS custom
// properties so it follows the theme. The canvas background IS themed
// (--canvas-bg), so a hardcoded palette washed out completely in light mode.

/** Fallback used before the first read and if a token is missing. */
const FALLBACK = [
    [232, 168, 124], [224, 85, 85], [122, 191, 160], [240, 200, 140], [200, 110, 90],
    [160, 200, 140], [230, 140, 100], [180, 210, 180], [220, 160, 100], [190, 130, 120],
];

/** @type {[number, number, number][]} */
let palette = FALLBACK.slice();

/** Extra canvas colours that also need to follow the theme. */
export const canvasColors = {
    ghostCursor: [42, 36, 32],
    recordTint: [224, 85, 85],
};

function parseTriplet(value, fallback) {
    const parts = value.split(',').map(s => parseInt(s.trim(), 10));
    return parts.length === 3 && parts.every(Number.isFinite) ? parts : fallback;
}

/** Re-read the palette from CSS. Call once at startup and on every theme change. */
export function refreshVoiceColors() {
    const s = getComputedStyle(document.documentElement);
    palette = FALLBACK.map((fb, i) =>
        parseTriplet(s.getPropertyValue(`--voice-${i}`).trim(), fb));
    canvasColors.ghostCursor = parseTriplet(
        s.getPropertyValue('--canvas-ghost-cursor').trim(), canvasColors.ghostCursor);
    canvasColors.recordTint = parseTriplet(
        s.getPropertyValue('--canvas-record-tint').trim(), canvasColors.recordTint);
}

/**
 * Get the RGB color for a voice slot.
 * @param {number} voiceId
 * @returns {[number, number, number]}
 */
export function getVoiceColor(voiceId) {
    return palette[voiceId % palette.length];
}

// Read once at module load; main.js refreshes on theme change.
if (typeof document !== 'undefined') refreshVoiceColors();
```

- [ ] **Step 5: Use the tokens in GhostRenderer**

In `src/ui/GhostRenderer.js`, change the import and the two literals:

```js
import { getVoiceColor, canvasColors } from './voiceColors.js';
```

```js
        // --- Recording tint ---
        if (this.recording) {
            const [r, g, b] = canvasColors.recordTint;
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.06)`;
            ctx.fillRect(0, 0, w, h);
        }
```

```js
            // --- Timeline cursor ---
            if (this.progress > 0) {
                const cx = this.progress * w;
                const [r, g, b] = canvasColors.ghostCursor;
                ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.35)`;
```

- [ ] **Step 6: Refresh on theme change**

In `src/main.js`, add the import and the call:

```js
import { refreshVoiceColors } from './ui/voiceColors.js';
```

```js
themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    applyTheme(next);
    // Notify canvas components to re-read CSS colors
    refreshVoiceColors();
    waveform.onThemeChange();
    params.onThemeChange();
});
```

- [ ] **Step 7: Run the tests and verify by eye**

Run: `node --test tests/contrast.test.mjs` → all pass.
In the browser, switch to light theme and drag on the pad — pointer circles, grain rectangles and the playback cursor must all be clearly visible.

- [ ] **Step 8: Commit**

```bash
git add src/ui/voiceColors.js src/ui/GhostRenderer.js src/main.js style.css tests/contrast.test.mjs
git commit -m "fix(theme): read the voice palette from CSS so canvas feedback follows the theme

voiceColors.js was a self-described dark-theme palette drawn onto a themed
canvas; at the alpha values GrainOverlay uses, grain bodies computed to 1.09:1
in light mode and the white playback cursor vanished entirely.
Fixes AUDIT-UX #17."
```

---

### Task 19: Guard the destructive actions (U8, U9, U11, U18)

**Files:**
- Modify: `src/automation/Recorder.js:42-49`
- Modify: `src/main.js:1230-1245` (keyboard), `:518-524` (drop routing), `:722-783` (import)
- Modify: `index.html` — add an undo button to the transport
- Test: `tests/recorder.test.mjs` (append)

**Interfaces:**
- Consumes: `Recorder._undoSnapshot`.
- Produces:
  - `Recorder.startRecording(atTime?)` now snapshots the outgoing lane instead of discarding it, so `undoOverdub()` can restore a destroyed take. Renamed to `Recorder.undo()` with `undoOverdub` kept as an alias.
  - `#btn-undo` in the transport bar, enabled whenever `recorder.canUndo`.

- [ ] **Step 1: Write the failing test**

Append to `tests/recorder.test.mjs`:

```js
test('starting a new take is undoable', () => {
    const ctx = new FakeAudioContext();
    const r = new Recorder(ctx);
    r.startRecording();
    r.captureStart(0, RESOLVED);
    ctx.advance(1);
    r.captureStop(0);
    r.stopRecording();
    const takeOne = r.getRecording().length;
    assert.ok(takeOne > 0);

    r.startRecording();                       // destroys the take
    r.stopRecording();
    assert.equal(r.getRecording().length, 0);
    assert.equal(r.canUndo, true, 'the previous take must be recoverable');

    r.undo();
    assert.equal(r.getRecording().length, takeOne, 'undo restores the destroyed take');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/recorder.test.mjs`
Expected: FAIL — `canUndo` is `false` and `r.undo is not a function`.

- [ ] **Step 3: Snapshot before clearing**

In `src/automation/Recorder.js`:

```js
    startRecording(atTime) {
        // Snapshot rather than discard. Record and Play are adjacent 44px squares,
        // and a mis-hit used to destroy a multi-pass loop permanently, mid-set.
        this._undoSnapshot = this._lane.length > 0
            ? AutomationLane.fromJSON(this._lane.toJSON())
            : null;
        this._lane = new AutomationLane();
        this._held.clear();
        this._lastMoveTime.clear();
        this._startTime = atTime ?? this._audioContext.currentTime;
        this.isRecording = true;
        this.isOverdubbing = false;
    }
```

Rename the undo method and keep the old name working:

```js
    /**
     * Restore the lane as it was before the last destructive action (a new take
     * or an overdub pass).
     * @returns {boolean} True if undo was applied.
     */
    undo() {
        if (!this._undoSnapshot) return false;
        this._lane = this._undoSnapshot;
        this._undoSnapshot = null;
        this._held.clear();
        return true;
    }

    /** @deprecated Use undo(). */
    undoOverdub() { return this.undo(); }
```

- [ ] **Step 4: Add a visible Undo control**

In `index.html`, after the Stop button:

```html
                <button id="btn-undo" type="button" title="Undo last take or overdub (Ctrl+Z)" aria-label="Undo last take or overdub" disabled>
                    <span class="icon undo-icon" aria-hidden="true">↶</span>
                </button>
```

In `src/main.js`, wire it and keep it in sync. Add after the snap-grid button block:

```js
// --- Undo ---
const undoBtn = document.getElementById('btn-undo');

/** Enable/disable Undo from the active instance's recorder. */
function refreshUndoButton() {
    const active = instanceManager.getActive();
    undoBtn.disabled = !active?.recorder.canUndo;
}

function performUndo() {
    const active = instanceManager.getActive();
    if (!active?.recorder.canUndo) return;
    if (active.recorder.isRecording || active.player.isPlaying) return;
    active.recorder.undo();
    transport.setHasRecording(active.recorder.getRecording().length > 0);
    refreshUndoButton();
    showNotification('Undid last take');
}

undoBtn.addEventListener('click', performUndo);
```

Call `refreshUndoButton()` at the end of `finishRecording`, `transport.onStop`, `transport.onOverdub`, and the tab-switch handler.

- [ ] **Step 5: Fix the keyboard shortcut**

Replace the `keydown` handler in `src/main.js`:

```js
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    // Ctrl/Cmd+Z: undo
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        performUndo();
        return;
    }

    // 'R' toggles record. Bare key only: Ctrl+R / Cmd+R is the browser reload and
    // hijacking it used to cancel the reload, stop the loop, fire a count-in and
    // overwrite the take with silence.
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;

    if (e.key === 'r' || e.key === 'R') {
        // Obey the same state machine as the button.
        if (document.getElementById('btn-record').disabled) return;
        e.preventDefault();
        if (transport.onRecord) transport.onRecord();
    }
});
```

- [ ] **Step 6: Confirm before a destructive import**

In `src/main.js`, replace `handleDroppedFile` and add a confirmation to the import path:

```js
function handleDroppedFile(file) {
    if (file.name.toLowerCase().endsWith('.json')) {
        importSessionFromFile(file);
    } else if (isAudioFile(file)) {
        handleFile(file);
    } else {
        // Previously silent — the user had no idea the drop was ignored.
        showNotification(`Not an audio or session file: ${file.name}`, true);
    }
}

/** True if the workspace holds anything the user would mind losing. */
function workspaceHasContent() {
    for (const [, entry] of instanceManager.instances) {
        if (entry.recorder.getRecording().length > 0) return true;
        if (entry.buffer) return true;
    }
    return instanceManager.instances.size > 1;
}
```

At the top of `importSessionFromFile`, after validation succeeds:

```js
        if (workspaceHasContent()) {
            const ok = confirm(
                'Importing replaces every tab, recording and parameter in the current session.\n\n' +
                'Export the current session first if you want to keep it.\n\nReplace it now?'
            );
            if (!ok) { showNotification('Import cancelled'); return; }
        }

        // Keep one level of recovery — the auto-save is about to overwrite the
        // only other copy of the outgoing session.
        try {
            const outgoing = serializeSession(instanceManager, params, getMasterBpm(),
                parseFloat(masterVolumeSlider.value), getLoopStationState());
            safeStorage.set('granul8-session-prev', JSON.stringify(outgoing));
        } catch { /* best effort */ }
```

- [ ] **Step 7: Run the tests and verify by hand**

Run: `node --test tests/recorder.test.mjs` → all pass.
In the browser: record a loop, press Record again to destroy it, then press Ctrl+Z — the take comes back. Press Ctrl+R — the page reloads normally.

- [ ] **Step 8: Commit**

```bash
git add src/automation/Recorder.js src/main.js index.html tests/recorder.test.mjs
git commit -m "fix(ux): make destructive actions recoverable

Record silently destroyed the existing loop with no confirmation and no undo;
the R shortcut bypassed every disabled-button guard and hijacked Ctrl+R;
dropping a .json wiped the workspace and then auto-saved over the only backup.
Adds a visible Undo, a bare-key guard, an import confirmation and a
granul8-session-prev snapshot. Fixes AUDIT-UX #8, #9, #11, #18."
```

---

### Task 20: Make transport state tell the truth (U19, U20, U22, U31)

**Files:**
- Modify: `src/ui/TransportBar.js:303-368` (`_updateButtons`), `:273-300` (beat indicator)
- Modify: `src/main.js:1016-1054` (`onOverdub`), `:1088-1118` (`applyLoopStationUI`)
- Modify: `src/ui/TabBar.js:27-72`
- Modify: `style.css` — tab state dots, distinct armed/count-in styling
- Test: manual

**Interfaces:**
- Consumes: `InstanceManager.instances`.
- Produces: `TabBar.render(tabs)` accepts `{ id, name, isActive, isPlaying, isRecording }`; `InstanceManager.getTabList()` supplies the two new flags.

- [ ] **Step 1: Make Overdub work from idle**

In `src/main.js`, replace the guard in `transport.onOverdub`:

```js
transport.onOverdub = () => {
    const active = instanceManager.getActive();
    if (!active) return;
    // The button is enabled in idle whenever a recording exists, but the handler
    // used to bail in exactly that state — a lit, 44px, hover-highlighted no-op.
    // Starting playback first is what the user meant, and the code below already
    // does it.
    if (transport.state === 'recording' || transport.state === 'count-in' || transport.state === 'armed') return;
```

The rest of the handler is unchanged — its `if (!active.player.isPlaying)` branch already starts playback.

- [ ] **Step 2: Stop the snap button lying**

In `src/main.js`, in `applyLoopStationUI`, set the visual state to match what is actually in force:

```js
    if (enabled) {
        // ... existing bar-count sync ...

        transport.looping = true;
        transport._updateLoopVisual();
        loopBtn.disabled = true;
        loopBtn.classList.add('loop-forced');

        // Snap is forced ON here, so the button must read ON. It previously stayed
        // visually off while snapping was being applied.
        snapBtn.disabled = true;
        snapBtn.classList.add('snap-forced', 'snap-active');
        snapBtn.setAttribute('aria-pressed', 'true');
        snapBtn.title = 'Snap to bar grid (locked on in loop station mode)';
    } else {
        loopBtn.classList.remove('loop-forced');
        transport._updateButtons();

        snapBtn.disabled = false;
        snapBtn.classList.remove('snap-forced');
        snapBtn.classList.toggle('snap-active', loopSnapToGrid);
        snapBtn.setAttribute('aria-pressed', String(loopSnapToGrid));
        snapBtn.title = 'Snap loop to BPM grid';
    }
```

- [ ] **Step 3: Distinguish armed from count-in**

In `src/ui/TransportBar.js`, in `_updateButtons`, add a distinct class and clear it alongside the others:

```js
        recordBtn.classList.remove('recording', 'armed', 'counting-in');
```

```js
            case 'count-in':
                recordBtn.classList.add('counting-in');
                stopBtn.disabled = false;
                recordBtn.disabled = false;
                overdubBtn.disabled = true;
                playBtn.disabled = true;
                loopBtn.disabled = true;
                break;
```

In `style.css`, beside the existing `.armed` rule:

```css
/* Armed = waiting for your first touch. Counting-in = the clock is already
   running and recording will start whether you touch or not. They were visually
   identical, which is a meaningful difference to hide during a take. */
#btn-record.counting-in {
    background: var(--accent-dim);
    border-color: var(--accent);
    animation: count-in-pulse 0.5s steps(1) infinite;
}

@keyframes count-in-pulse {
    0%, 50% { opacity: 1; }
    50.01%, 100% { opacity: 0.55; }
}
```

- [ ] **Step 4: Show per-tab transport state**

In `src/state/InstanceManager.js`, extend `getTabList`:

```js
    getTabList() {
        const tabs = [];
        for (const [id, entry] of this.instances) {
            tabs.push({
                id,
                name: entry.state.name,
                isActive: id === this.activeId,
                // Background tabs keep playing by design; without this the tab strip
                // gave no clue which ones were sounding.
                isPlaying: entry.player.isPlaying,
                isRecording: entry.recorder.isRecording,
            });
        }
        return tabs;
    }
```

In `src/ui/TabBar.js`, render the indicator and a per-tab stop:

```js
        for (const tab of tabs) {
            const btn = document.createElement('button');
            btn.className = 'tab-item' + (tab.isActive ? ' tab-active' : '');
            btn.type = 'button';
            btn.dataset.tabId = tab.id;
            btn.setAttribute('aria-pressed', String(tab.isActive));

            // Transport state dot
            const dot = document.createElement('span');
            dot.className = 'tab-state'
                + (tab.isRecording ? ' tab-recording' : tab.isPlaying ? ' tab-playing' : '');
            dot.setAttribute('aria-hidden', 'true');
            btn.appendChild(dot);

            const label = document.createElement('span');
            label.className = 'tab-label';
            label.textContent = tab.name;
            btn.appendChild(label);

            if (tab.isPlaying || tab.isRecording) {
                btn.setAttribute('aria-label', `${tab.name} (${tab.isRecording ? 'recording' : 'playing'})`);
            }
```

Then drive it from the render loop. In `src/main.js`'s `render()`, add a cheap change-detector so the strip is not rebuilt every frame (rebuilding with `innerHTML = ''` also destroys keyboard focus):

```js
    // Refresh the tab strip only when a transport state actually changes.
    const stateKey = [...instanceManager.instances.values()]
        .map(e => `${e.player.isPlaying ? 'p' : ''}${e.recorder.isRecording ? 'r' : ''}`)
        .join('|');
    if (stateKey !== lastTabStateKey) {
        lastTabStateKey = stateKey;
        tabBar.render(instanceManager.getTabList());
    }
```

Declare `let lastTabStateKey = '';` beside the other module-level state.

Add the CSS:

```css
.tab-state {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: transparent;
    flex-shrink: 0;
}

.tab-state.tab-playing { background: var(--play-green); }
.tab-state.tab-recording {
    background: var(--record-red);
    animation: tab-rec-pulse 1s ease-in-out infinite;
}

@keyframes tab-rec-pulse { 50% { opacity: 0.3; } }

/* Long instance names used to push the close button off the strip. */
.tab-label {
    max-width: 12ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
```

- [ ] **Step 5: Verify by hand**

1. Record a loop, press Stop, press Overdub — playback starts and overdub arms (previously nothing happened).
2. Turn on loop-station mode — the snap button now reads as on.
3. Arm a record: the count-in state looks different from armed.
4. Start loops on two tabs — both show a green dot; the recording one pulses red.

- [ ] **Step 6: Commit**

```bash
git add src/ui/TransportBar.js src/ui/TabBar.js src/state/InstanceManager.js src/main.js style.css
git commit -m "fix(ux): make transport and tab state honest

Overdub was enabled and clickable in idle but its handler bailed in exactly
that state; the snap button read OFF while snapping was forced ON; armed and
count-in were visually identical; and background tabs kept playing with no
indication anywhere. Fixes AUDIT-UX #19, #20, #22, #31."
```

---

### Task 21: Teach the instrument — legend, empty state, error surfacing (U21, U23, U24, U25, U30)

**Files:**
- Modify: `index.html` — legend markup
- Modify: `src/ui/WaveformDisplay.js:211-236` (`_drawEmpty`)
- Modify: `src/main.js:502-546` (load paths)
- Modify: `style.css` — legend styling
- Test: manual

**Interfaces:**
- Consumes: `showNotification(message, isError)`.
- Produces: `#pad-legend` element, updated by `updateLegend()` when the gesture mapping changes.

- [ ] **Step 1: Add the legend**

In `index.html`, inside `#waveform-container` after the canvas:

```html
                <div id="pad-legend" aria-hidden="true">
                    <span class="legend-axis legend-x">← position →</span>
                    <span class="legend-axis legend-y" id="legend-y">↑ pitch +2 oct / −2 oct ↓</span>
                </div>
```

And give the canvas a name and a keyboard-reachable role:

```html
                <canvas id="waveform-canvas" tabindex="0" role="application"
                        aria-label="Performance pad. Drag horizontally to move the read position through the sample, vertically to change pitch across four octaves."></canvas>
```

- [ ] **Step 2: Keep the legend truthful**

In `src/main.js`, add and call from `params`'s `onChange`:

```js
const legendY = document.getElementById('legend-y');

/**
 * The vertical axis is pitch — unless a gesture dimension has been mapped to
 * pitch, in which case the axis stops doing anything and nothing said so.
 */
function updateLegend() {
    const { mappings } = params.getParams();
    const pitchTaken = Object.values(mappings).includes('pitch');
    legendY.textContent = pitchTaken
        ? '↕ pitch is driven by a gesture mapping'
        : '↑ pitch +2 oct / −2 oct ↓';
    legendY.classList.toggle('legend-overridden', pitchTaken);
}
updateLegend();
```

Call `updateLegend()` at the end of the `ParameterPanel` `onChange` callback and after `setFullState` on tab switch.

- [ ] **Step 3: Fix the empty-state copy**

In `src/ui/WaveformDisplay.js`, replace the hint text — the button is called "Load File", not "Load Sample":

```js
        ctx.fillText('Drop an audio file here, or use "Load File" above', w / 2, h / 2);
```

and raise its contrast by using `--text-secondary` rather than `--canvas-hint`. Add to both theme blocks in `style.css`:

```css
    --canvas-hint: #8a8078;   /* dark: 4.10:1 on --canvas-bg */
```
```css
    --canvas-hint: #5f554c;   /* light: 5.6:1 on --canvas-bg */
```

- [ ] **Step 4: Surface load failures properly**

In `src/main.js`, replace the two `catch` blocks so failures reach the user, not just the console:

```js
    } catch (err) {
        console.error('Failed to decode audio file:', err);
        sampleNameEl.textContent = 'No sample loaded';
        showNotification(`Could not decode "${file.name}" — is it a supported audio format?`, true);
    }
```

```js
    } catch (err) {
        console.error('Failed to load sample:', err);
        sampleNameEl.textContent = active.state.sampleDisplayName;
        showNotification(`Could not load "${displayName}": ${err.message}`, true);
    }
```

And show real progress for the multi-megabyte bundled samples:

```js
async function loadSampleFromUrl(url, displayName) {
    const active = instanceManager.getActive();
    if (!active) return;
    sampleNameEl.textContent = `Loading ${displayName}…`;
    sampleNameEl.setAttribute('aria-busy', 'true');
    try {
        const buffer = await active.engine.loadSample(url);
        // ... unchanged ...
    } catch (err) {
        // ... as above ...
    } finally {
        sampleNameEl.removeAttribute('aria-busy');
    }
}
```

- [ ] **Step 5: Announce transport state to assistive tech**

In `index.html`, add a live region beside the time display:

```html
                <span id="transport-status" class="visually-hidden" role="status" aria-live="polite"></span>
```

In `src/ui/TransportBar.js`, in `setState`:

```js
    setState(newState) {
        this.state = newState;
        this._updateButtons();
        const status = document.getElementById('transport-status');
        if (status) {
            status.textContent = {
                idle: 'Stopped', armed: 'Armed — touch the pad to start recording',
                'count-in': 'Counting in', recording: 'Recording',
                playing: 'Playing', overdubbing: 'Overdubbing',
            }[newState] ?? newState;
        }
    }
```

Add the utility class to `style.css`:

```css
.visually-hidden {
    position: absolute;
    width: 1px; height: 1px;
    margin: -1px; padding: 0; border: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
}
```

- [ ] **Step 6: Style the legend**

```css
#pad-legend {
    position: absolute;
    inset: auto 8px 8px 8px;
    display: flex;
    justify-content: space-between;
    pointer-events: none;
    font-size: 11px;
    color: var(--text-secondary);
    opacity: 0.75;
}

.legend-overridden { color: var(--accent-text); }

@media (max-width: 600px) {
    #pad-legend { font-size: 10px; }
}
```

- [ ] **Step 7: Verify by hand**

1. The legend reads "↑ pitch +2 oct / −2 oct ↓" over the pad.
2. Map Pressure → Pitch: the legend changes to say so.
3. Drop a `.txt` file: a toast explains it was ignored.
4. Point a sample URL at a missing file (temporarily rename one in `samples/`): a toast names the failure and the previous sample keeps playing.

- [ ] **Step 8: Commit**

```bash
git add index.html style.css src/main.js src/ui/WaveformDisplay.js src/ui/TransportBar.js
git commit -m "fix(ux): teach the XY mapping and surface failures

Y=pitch was the most important fact about the instrument and appeared nowhere;
the only instructional text named a button that does not exist and sat at
2.26:1; load failures reached only the console. Adds a live legend that reacts
to gesture mappings, a transport live region, and real error toasts.
Fixes AUDIT-UX #21, #23, #24, #25, #30."
```

---

### Task 22: Close out Phase 2

- [ ] **Step 1: Run the full suite**

Run: `node --test "tests/*.test.mjs"`
Expected: 0 failures.

- [ ] **Step 2: Keyboard-only pass**

Unplug the mouse. From a fresh load you must be able to: dismiss the unlock gate, choose a sample, reach and toggle every quantize and randomize switch, adjust every slider, switch tabs, and start and stop a recording.

**The performance surface stays pointer-only, by design.** This is a touch instrument; a keyboard play mode is explicitly not wanted. External hands-on control is planned as **Web MIDI with MIDI learn**, in its own phase. What Phase 2 buys is that the instrument can be *configured* without a pointer — an accessibility floor, not a second way to play.

- [ ] **Step 3: Device pass**

Check iPhone SE (375×667) and iPad portrait: panel scrolls, transport wraps at 44px, pinch zoom works, light theme is legible in daylight.

- [ ] **Step 4: Update the audit doc status and merge**

```bash
git checkout main
git merge --no-ff fix/ux -m "merge: interface, accessibility and responsive fixes (Phase 2)"
```

---

# Phase 3 — Sample sources (branch `feat/sample-sources`)

```bash
git checkout main && git checkout -b feat/sample-sources
```

Implements the recommendation in [AI-AUDIO-REVIEW.md](../AI-AUDIO-REVIEW.md): microphone capture and a procedural texture generator — both zero-dependency, both working on every device the app already supports — plus a timeboxed spike to settle the neural question with evidence rather than assumption.

### Task 23: A single seam for "adopt this AudioBuffer"

Both new sources need the same three-call sequence that `handleFile` already performs. Extracting it first keeps Tasks 24 and 25 small and stops the logic being written twice.

**Files:**
- Modify: `src/audio/GranularEngine.js:68-79`
- Modify: `src/main.js:502-546`
- Test: `tests/engine.test.mjs`

**Interfaces:**
- Consumes: `InstanceManager.setActiveSample(buffer, displayName, url, fileName)`.
- Produces:
  - `GranularEngine.adoptBuffer(buffer: AudioBuffer): void` — install an already-decoded buffer, releasing any playing voices first. This is what `_decodeAndStore` does after decoding; both now share it.
  - `adoptGeneratedBuffer(buffer: AudioBuffer, displayName: string): void` in `main.js` — the single entry point for any in-app sample source.

- [ ] **Step 1: Write the failing test**

Create `tests/engine.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, makeBuffer, SRC } from './fakes.mjs';

const { GranularEngine } = await import(SRC + 'audio/GranularEngine.js');

test('adoptBuffer installs a decoded buffer on the engine and every voice', () => {
    const ctx = new FakeAudioContext();
    const e = new GranularEngine(ctx, ctx.createGain());
    const buf = makeBuffer(ctx, 3);

    e.adoptBuffer(buf);

    assert.equal(e.sourceBuffer, buf);
    for (const v of e._allocator.voices) {
        assert.equal(v.buffer, buf, 'every pooled voice must see the new buffer');
    }
});

test('adoptBuffer releases voices that were playing the old buffer', () => {
    const ctx = new FakeAudioContext();
    const e = new GranularEngine(ctx, ctx.createGain());
    e.adoptBuffer(makeBuffer(ctx, 3));
    e.startVoice(1, { position: 0.5, amplitude: 0.8, pitch: 1, grainSize: 0.05, interOnset: 0.03 });
    assert.equal(e._allocator.activeCount, 1);

    e.adoptBuffer(makeBuffer(ctx, 5));
    assert.equal(e._allocator.activeCount, 0, 'voices must not keep reading a swapped-out buffer');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/engine.test.mjs`
Expected: FAIL with `e.adoptBuffer is not a function`.

- [ ] **Step 3: Extract the seam in GranularEngine**

In `src/audio/GranularEngine.js`:

```js
    /**
     * Install an already-decoded AudioBuffer as the source material.
     * Shared by file/URL loading and by in-app generators (mic, TextureSynth),
     * so every source lands on the engine the same way.
     * @param {AudioBuffer} buffer
     */
    adoptBuffer(buffer) {
        // Release first: a playing voice holds an offset into the OLD buffer.
        this._allocator.releaseAll();
        this._updateVoiceGains();
        this.sourceBuffer = buffer;
        this._allocator.setBuffer(buffer);
    }

    /**
     * Decode an ArrayBuffer into an AudioBuffer and store it.
     * @param {ArrayBuffer} arrayBuffer
     * @returns {Promise<AudioBuffer>}
     */
    async _decodeAndStore(arrayBuffer) {
        const buffer = await this.audioContext.decodeAudioData(arrayBuffer);
        this.adoptBuffer(buffer);
        return buffer;
    }
```

- [ ] **Step 4: Add the main.js entry point**

In `src/main.js`, beside `handleFile`:

```js
/**
 * Install a buffer produced in-app (microphone capture, TextureSynth) into the
 * active instance. Mirrors handleFile's post-decode path exactly.
 * @param {AudioBuffer} buffer
 * @param {string} displayName
 */
function adoptGeneratedBuffer(buffer, displayName) {
    const active = instanceManager.getActive();
    if (!active) return;
    active.engine.adoptBuffer(buffer);
    // fileName carries the label so a reload marks it "(missing)" rather than
    // silently trying to re-fetch a URL that never existed.
    instanceManager.setActiveSample(buffer, displayName, null, displayName);
    waveform.setBuffer(buffer);
    sampleNameEl.textContent = displayName;
    sampleSelect.value = '';
    if (persistence) persistence.scheduleSave();
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test "tests/*.test.mjs"`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/audio/GranularEngine.js src/main.js tests/engine.test.mjs
git commit -m "refactor(audio): extract adoptBuffer as the single sample-install seam

Both new sample sources need the post-decode path that handleFile performs.
Extracting it first keeps the mic and generator tasks small and fixes a latent
bug: _decodeAndStore released voices BEFORE awaiting decodeAudioData, so a
failed decode left the instrument silent with the old buffer still installed."
```

---

### Task 24: Microphone recording

The highest-value item in `TODO.txt` and the one directly above `generate ia audio ?`. Zero bytes, no licence question, works on every device the app supports.

**Files:**
- Create: `src/input/MicRecorder.js`
- Modify: `index.html` — a Record-from-mic button beside Load File
- Modify: `src/main.js` — wiring
- Modify: `style.css` — recording indicator
- Test: `tests/micRecorder.test.mjs`

**Interfaces:**
- Consumes: `GranularEngine.adoptBuffer`, `adoptGeneratedBuffer`.
- Produces:
  - `class MicRecorder { constructor(audioContext); get isRecording: boolean; get elapsed: number; async start(): Promise<void>; stop(): AudioBuffer|null; cancel(): void; onLevel: ((rms: number) => void)|null; onAutoStop: (() => void)|null }`
  - `MAX_SECONDS = 30` — module-private cap so a forgotten recording cannot exhaust memory.

- [ ] **Step 1: Write the failing test**

Create `tests/micRecorder.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, SRC } from './fakes.mjs';

const { MicRecorder } = await import(SRC + 'input/MicRecorder.js');

/** A FakeAudioContext that can also build a source from a fake MediaStream. */
function micCtx() {
    const ctx = new FakeAudioContext();
    ctx.createMediaStreamSource = () => {
        const n = ctx.createGain();
        n.type = 'mediaStreamSource';
        return n;
    };
    // The worklet path is not available under Node; MicRecorder falls back to a
    // ScriptProcessor, which we stub here.
    ctx.createScriptProcessor = (size, inCh, outCh) => {
        const n = ctx.createGain();
        n.type = 'scriptProcessor';
        n.bufferSize = size;
        n.onaudioprocess = null;
        /** Push one block of samples through, as the real node would. */
        n.emit = (samples) => {
            n.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } });
        };
        return n;
    };
    return ctx;
}

function fakeStream() {
    const track = { stop() { track.stopped = true; }, stopped: false };
    return { getTracks: () => [track], _track: track };
}

test('captured blocks are concatenated into an AudioBuffer at the context rate', async () => {
    const ctx = micCtx();
    const stream = fakeStream();
    const rec = new MicRecorder(ctx);
    await rec.start(stream);
    assert.equal(rec.isRecording, true);

    const node = ctx.nodes.find(n => n.type === 'scriptProcessor');
    const block = new Float32Array(128).fill(0.5);
    node.emit(block);
    node.emit(block);

    const buf = rec.stop();
    assert.ok(buf, 'stop() returns a buffer');
    assert.equal(buf.numberOfChannels, 1);
    assert.equal(buf.length, 256);
    assert.equal(buf.sampleRate, ctx.sampleRate, 'must use the context rate, never a hardcoded one');
    assert.equal(buf.getChannelData(0)[0], 0.5);
    assert.equal(rec.isRecording, false);
});

test('stop() releases the microphone track', async () => {
    const ctx = micCtx();
    const stream = fakeStream();
    const rec = new MicRecorder(ctx);
    await rec.start(stream);
    rec.stop();
    assert.equal(stream._track.stopped, true, 'the OS recording indicator would stay on');
});

test('stop() with no captured audio returns null rather than a zero-length buffer', async () => {
    const ctx = micCtx();
    const rec = new MicRecorder(ctx);
    await rec.start(fakeStream());
    assert.equal(rec.stop(), null);
});

test('recording auto-stops at the cap', async () => {
    const ctx = micCtx();
    const rec = new MicRecorder(ctx);
    let autoStopped = false;
    rec.onAutoStop = () => { autoStopped = true; };
    await rec.start(fakeStream());

    const node = ctx.nodes.find(n => n.type === 'scriptProcessor');
    // 31 seconds' worth at the context rate, in one-second blocks.
    const oneSec = new Float32Array(ctx.sampleRate).fill(0.1);
    for (let i = 0; i < 31; i++) node.emit(oneSec);

    assert.equal(autoStopped, true, 'a forgotten recording must not grow without bound');
    const buf = rec.stop();
    assert.ok(buf.duration <= 30.5, `capped at 30 s, got ${buf.duration}`);
});

test('cancel() discards the audio and releases the track', async () => {
    const ctx = micCtx();
    const stream = fakeStream();
    const rec = new MicRecorder(ctx);
    await rec.start(stream);
    ctx.nodes.find(n => n.type === 'scriptProcessor').emit(new Float32Array(128).fill(1));
    rec.cancel();
    assert.equal(rec.isRecording, false);
    assert.equal(stream._track.stopped, true);
    assert.equal(rec.stop(), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/micRecorder.test.mjs`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write MicRecorder**

Create `src/input/MicRecorder.js`:

```js
// MicRecorder.js — Capture microphone input straight into an AudioBuffer.
//
// Deliberately does NOT use MediaRecorder: that produces encoded blobs which
// would then have to be decoded back again. The granular engine consumes
// AudioBuffers, so raw Float32 frames are both simpler and lossless.

/** Hard cap on a single take. A forgotten recording must not exhaust memory. */
const MAX_SECONDS = 30;

/** ScriptProcessor block size. 4096 keeps the callback rate low. */
const BLOCK_SIZE = 4096;

export class MicRecorder {
    /**
     * @param {AudioContext} audioContext - The app's single shared context.
     */
    constructor(audioContext) {
        this._ctx = audioContext;

        /** @type {MediaStream|null} */
        this._stream = null;
        /** @type {MediaStreamAudioSourceNode|null} */
        this._source = null;
        /** @type {ScriptProcessorNode|null} */
        this._processor = null;
        /** @type {GainNode|null} Silent sink, see start(). */
        this._sink = null;

        /** @type {Float32Array[]} Captured blocks, concatenated on stop(). */
        this._blocks = [];
        this._frames = 0;

        this.isRecording = false;

        /** @type {((rms: number) => void)|null} Per-block level, for a meter. */
        this.onLevel = null;

        /** @type {(() => void)|null} Fired when MAX_SECONDS is reached. */
        this.onAutoStop = null;
    }

    /** Captured length in seconds. */
    get elapsed() {
        return this._frames / this._ctx.sampleRate;
    }

    /**
     * Begin capturing. Requires a secure context (HTTPS or localhost) and a user
     * gesture — both already satisfied by the app's "Tap to start" overlay.
     *
     * @param {MediaStream} [stream] - Inject a stream in tests. Omit in the app.
     * @returns {Promise<void>}
     * @throws {Error} If permission is denied or no input device exists.
     */
    async start(stream) {
        if (this.isRecording) return;

        this._stream = stream ?? await navigator.mediaDevices.getUserMedia({
            audio: {
                // All three would fight the performer: AGC pumps sustained
                // textures, noise suppression eats exactly the broadband material
                // a granular engine wants, and echo cancellation is meaningless
                // for line/instrument input.
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            },
        });

        this._blocks = [];
        this._frames = 0;

        this._source = this._ctx.createMediaStreamSource(this._stream);
        this._processor = this._ctx.createScriptProcessor(BLOCK_SIZE, 1, 1);

        const maxFrames = MAX_SECONDS * this._ctx.sampleRate;

        this._processor.onaudioprocess = (e) => {
            if (!this.isRecording) return;
            const input = e.inputBuffer.getChannelData(0);

            // Copy: the event's buffer is reused by the audio thread.
            const room = maxFrames - this._frames;
            const take = Math.min(input.length, room);
            if (take > 0) {
                this._blocks.push(input.slice(0, take));
                this._frames += take;
            }

            if (this.onLevel) {
                let sum = 0;
                for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
                this.onLevel(Math.sqrt(sum / input.length));
            }

            if (this._frames >= maxFrames) {
                this.isRecording = false;
                if (this.onAutoStop) this.onAutoStop();
            }
        };

        // A ScriptProcessor only runs while it is connected to the destination.
        // Route it through a muted gain so the input is never monitored — live
        // monitoring through laptop speakers is an instant feedback loop.
        this._sink = this._ctx.createGain();
        this._sink.gain.value = 0;
        this._source.connect(this._processor);
        this._processor.connect(this._sink);
        this._sink.connect(this._ctx.destination);

        this.isRecording = true;
    }

    /**
     * Stop capturing and return the audio.
     * @returns {AudioBuffer|null} null if nothing was captured.
     */
    stop() {
        this._teardown();
        if (this._frames === 0) return null;

        const buffer = this._ctx.createBuffer(1, this._frames, this._ctx.sampleRate);
        const out = buffer.getChannelData(0);
        let offset = 0;
        for (const block of this._blocks) {
            out.set(block, offset);
            offset += block.length;
        }
        this._blocks = [];
        this._frames = 0;
        return buffer;
    }

    /** Stop capturing and discard the audio. */
    cancel() {
        this._teardown();
        this._blocks = [];
        this._frames = 0;
    }

    /** @private */
    _teardown() {
        this.isRecording = false;
        if (this._processor) {
            this._processor.onaudioprocess = null;
            this._processor.disconnect();
            this._processor = null;
        }
        if (this._source) { this._source.disconnect(); this._source = null; }
        if (this._sink) { this._sink.disconnect(); this._sink = null; }
        if (this._stream) {
            // Without this the OS microphone indicator stays lit.
            for (const track of this._stream.getTracks()) track.stop();
            this._stream = null;
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/micRecorder.test.mjs`
Expected: `pass 5`, `fail 0`.

- [ ] **Step 5: Add the UI**

In `index.html`, after the Load File button:

```html
                <button id="mic-record-btn" type="button" title="Record from microphone" aria-label="Record a sample from the microphone">Mic</button>
```

In `src/main.js`:

```js
import { MicRecorder } from './input/MicRecorder.js';

// --- Microphone sample capture ---

const micBtn = document.getElementById('mic-record-btn');
const micRecorder = new MicRecorder(masterBus.audioContext);

micRecorder.onAutoStop = () => finishMicRecording();

function finishMicRecording() {
    const buffer = micRecorder.stop();
    micBtn.classList.remove('mic-recording');
    micBtn.textContent = 'Mic';
    if (!buffer) {
        showNotification('Nothing was recorded', true);
        return;
    }
    const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    adoptGeneratedBuffer(buffer, `Mic ${stamp} (${buffer.duration.toFixed(1)}s)`);
    showNotification(`Recorded ${buffer.duration.toFixed(1)} s from the microphone`);
}

micBtn.addEventListener('click', async () => {
    if (micRecorder.isRecording) { finishMicRecording(); return; }
    try {
        await masterBus.resume();
        await micRecorder.start();
        micBtn.classList.add('mic-recording');
        micBtn.textContent = 'Stop';
        showNotification('Recording — press Stop when done (max 30 s)');
    } catch (err) {
        console.error('Microphone capture failed:', err);
        const msg = err.name === 'NotAllowedError'
            ? 'Microphone permission denied'
            : err.name === 'NotFoundError'
                ? 'No microphone found'
                : `Microphone unavailable: ${err.message}`;
        showNotification(msg, true);
    }
});

// Live elapsed readout while capturing.
micRecorder.onLevel = () => {
    if (micRecorder.isRecording) micBtn.textContent = `Stop ${micRecorder.elapsed.toFixed(1)}s`;
};
```

Add the CSS:

```css
#mic-record-btn.mic-recording {
    background: var(--record-red);
    border-color: var(--record-red);
    color: #fff;
    animation: tab-rec-pulse 1s ease-in-out infinite;
}
```

- [ ] **Step 6: Verify in the browser**

Serve over `localhost` (a secure context — `getUserMedia` rejects on plain `http://` to a LAN IP). Press Mic, grant permission, make a sound, press Stop. The waveform must show your recording and the pad must play it. Check that the OS microphone indicator goes out afterwards.

- [ ] **Step 7: Commit**

```bash
git add src/input/MicRecorder.js src/main.js index.html style.css tests/micRecorder.test.mjs
git commit -m "feat(input): record samples from the microphone

Captures raw Float32 frames straight into an AudioBuffer rather than going
through MediaRecorder and decoding back again. AGC, noise suppression and echo
cancellation are all disabled — they fight sustained textures and eat exactly
the broadband material a granular engine wants. Capped at 30 s, with the input
routed through a muted sink so it is never monitored.

Closes the 'record audio input for sample' item in TODO.txt."
```

---

### Task 25: Procedural texture generator

The honest answer to `generate ia audio ?`. Zero bytes over the wire, works offline, works on every device, and the seed serialises into the existing session JSON — which no downloaded model could.

**Files:**
- Create: `src/audio/TextureSynth.js`
- Modify: `index.html` — Generate button and a small parameter popover
- Modify: `src/main.js`, `style.css`
- Modify: `src/state/InstanceState.js` — persist the recipe
- Test: `tests/textureSynth.test.mjs`

**Interfaces:**
- Consumes: `OfflineAudioContext`, `adoptGeneratedBuffer`.
- Produces:
  - `const TEXTURE_PRESETS: Array<{id: string, label: string}>` — `'wind'`, `'metallic'`, `'swarm'`, `'vocalish'`, `'bell'`.
  - `function randomRecipe(preset?: string): Recipe`
  - `async function renderTexture(recipe: Recipe, sampleRate: number): Promise<AudioBuffer>`
  - `Recipe = { seed: number, preset: string, duration: number, brightness: number, motion: number, density: number, space: number }` — all four macros are 0–1. Fully JSON-serialisable, which is the point.

- [ ] **Step 1: Write the failing test**

Create `tests/textureSynth.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SRC } from './fakes.mjs';

const { renderTexture, randomRecipe, TEXTURE_PRESETS } =
    await import(SRC + 'audio/TextureSynth.js');

// OfflineAudioContext does not exist under Node, so these tests exercise the
// pure parts: recipe generation, determinism of the PRNG, and parameter ranges.
// The rendered output is verified by ear in the browser (Step 5).

test('every preset produces a complete, serialisable recipe', () => {
    assert.ok(TEXTURE_PRESETS.length >= 5, `expected 5+ presets, got ${TEXTURE_PRESETS.length}`);
    for (const { id } of TEXTURE_PRESETS) {
        const r = randomRecipe(id);
        assert.equal(r.preset, id);
        assert.ok(Number.isFinite(r.seed));
        assert.ok(r.duration > 0.5 && r.duration <= 12, `duration ${r.duration}`);
        for (const macro of ['brightness', 'motion', 'density', 'space']) {
            assert.ok(r[macro] >= 0 && r[macro] <= 1, `${macro} out of range: ${r[macro]}`);
        }
        assert.deepEqual(JSON.parse(JSON.stringify(r)), r, 'a recipe must round-trip through JSON');
    }
});

test('an unknown preset falls back rather than throwing', () => {
    const r = randomRecipe('not-a-preset');
    assert.ok(TEXTURE_PRESETS.some(p => p.id === r.preset));
});

test('randomRecipe with no argument picks a real preset', () => {
    for (let i = 0; i < 20; i++) {
        const r = randomRecipe();
        assert.ok(TEXTURE_PRESETS.some(p => p.id === r.preset));
    }
});

test('renderTexture rejects an invalid recipe instead of producing silence', async () => {
    await assert.rejects(() => renderTexture(null, 48000), /recipe/i);
    await assert.rejects(() => renderTexture({ preset: 'wind' }, 48000), /duration/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/textureSynth.test.mjs`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write TextureSynth**

Create `src/audio/TextureSynth.js`:

```js
// TextureSynth.js — Procedural texture generator.
//
// Renders a few seconds of source material into an AudioBuffer using nothing but
// Web Audio nodes: noise buffers, filter sweeps, oscillator-to-AudioParam FM, and
// convolution against a synthesised impulse.
//
// This is the answer to "generate audio" that fits a granular sampler. Granular
// processing shreds a buffer into 1-1000 ms grains at randomised position, pitch
// and pan, which destroys melody and structure but flatters spectral density and
// evolving noise — exactly what this produces. It costs zero bytes over the wire,
// works offline, works on every device, and its recipe is a handful of numbers
// that serialise into the session JSON.

/** Available textures, in the order they appear in the UI. */
export const TEXTURE_PRESETS = [
    { id: 'wind',     label: 'Wind' },
    { id: 'metallic', label: 'Metallic' },
    { id: 'swarm',    label: 'Swarm' },
    { id: 'vocalish', label: 'Vocal-ish' },
    { id: 'bell',     label: 'Bell cloud' },
];

/**
 * @typedef {Object} Recipe
 * @property {number} seed        - Integer seed; the same seed always renders the same audio.
 * @property {string} preset      - One of TEXTURE_PRESETS[].id
 * @property {number} duration    - Seconds
 * @property {number} brightness  - 0-1, spectral centre
 * @property {number} motion      - 0-1, how much everything sweeps
 * @property {number} density     - 0-1, layer count / event rate
 * @property {number} space       - 0-1, convolution wet amount
 */

/** Deterministic PRNG (mulberry32) so a seed reproduces a texture exactly. */
function rng(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Build a random recipe.
 * @param {string} [preset] - Omit to pick one at random.
 * @returns {Recipe}
 */
export function randomRecipe(preset) {
    const known = TEXTURE_PRESETS.some(p => p.id === preset);
    const id = known
        ? preset
        : TEXTURE_PRESETS[Math.floor(Math.random() * TEXTURE_PRESETS.length)].id;
    return {
        seed: Math.floor(Math.random() * 0xFFFFFFFF),
        preset: id,
        duration: 4 + Math.random() * 4,          // 4-8 s: enough to scrub through
        brightness: Math.random(),
        motion: Math.random(),
        density: 0.3 + Math.random() * 0.7,
        space: Math.random() * 0.8,
    };
}

/** Fill a buffer with white noise. */
function noiseBuffer(ctx, seconds, rand) {
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(seconds * ctx.sampleRate)), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
    return buf;
}

/** A decaying-noise impulse response — a cheap, convincing reverb tail. */
function impulseResponse(ctx, seconds, decay, rand) {
    const len = Math.max(1, Math.floor(seconds * ctx.sampleRate));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
            d[i] = (rand() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
    }
    return buf;
}

/** Exponential map, mirroring src/utils/math.js so the feel matches the sliders. */
const expMap = (n, min, max) => min * Math.pow(max / min, n);

/**
 * Render a recipe to audio.
 * @param {Recipe} recipe
 * @param {number} sampleRate - Use the live AudioContext's rate.
 * @returns {Promise<AudioBuffer>}
 */
export async function renderTexture(recipe, sampleRate) {
    if (!recipe || typeof recipe !== 'object') throw new Error('renderTexture: a recipe is required');
    if (!(recipe.duration > 0)) throw new Error('renderTexture: recipe.duration must be > 0');

    const rand = rng(recipe.seed ?? 1);
    const dur = Math.min(12, recipe.duration);
    const ctx = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);

    const out = ctx.createGain();
    out.gain.value = 0.8;

    // Optional convolution tail.
    let bus = out;
    if (recipe.space > 0.02) {
        const conv = ctx.createConvolver();
        conv.buffer = impulseResponse(ctx, 0.8 + recipe.space * 2.5, 2 + recipe.space * 4, rand);
        const wet = ctx.createGain();
        wet.gain.value = recipe.space * 0.7;
        const dry = ctx.createGain();
        dry.gain.value = 1 - recipe.space * 0.4;
        bus = ctx.createGain();
        bus.connect(dry).connect(out);
        bus.connect(conv).connect(wet).connect(out);
    }
    out.connect(ctx.destination);

    const layers = 2 + Math.round(recipe.density * 5);
    const centre = expMap(recipe.brightness, 80, 6000);

    for (let i = 0; i < layers; i++) {
        const pan = ctx.createStereoPanner();
        pan.pan.value = (rand() * 2 - 1) * 0.8;
        pan.connect(bus);

        const level = ctx.createGain();
        level.gain.value = (0.25 + rand() * 0.5) / Math.sqrt(layers);
        level.connect(pan);

        // Slow amplitude drift so nothing sits perfectly still.
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.03 + rand() * (0.1 + recipe.motion * 1.5);
        const lfoAmt = ctx.createGain();
        lfoAmt.gain.value = level.gain.value * (0.3 + recipe.motion * 0.6);
        lfo.connect(lfoAmt).connect(level.gain);
        lfo.start(0);
        lfo.stop(dur);

        const filter = ctx.createBiquadFilter();
        filter.connect(level);

        const layerCentre = centre * (0.5 + rand() * 1.5);

        switch (recipe.preset) {
            case 'metallic': {
                // Narrow resonant bands over noise: inharmonic, bell-adjacent.
                filter.type = 'bandpass';
                filter.Q.value = 12 + rand() * 40;
                filter.frequency.value = layerCentre;
                filter.frequency.linearRampToValueAtTime(
                    layerCentre * (0.7 + rand() * 0.8 * (1 + recipe.motion)), dur);
                const src = ctx.createBufferSource();
                src.buffer = noiseBuffer(ctx, dur, rand);
                src.connect(filter);
                src.start(0);
                break;
            }
            case 'swarm': {
                // Detuned FM pairs — dense, buzzing, inharmonic.
                filter.type = 'lowpass';
                filter.frequency.value = layerCentre * 2;
                filter.Q.value = 1;
                const carrier = ctx.createOscillator();
                carrier.type = rand() > 0.5 ? 'sawtooth' : 'square';
                carrier.frequency.value = expMap(rand(), 55, 440);
                const mod = ctx.createOscillator();
                mod.frequency.value = carrier.frequency.value * (0.5 + rand() * 3);
                const modAmt = ctx.createGain();
                modAmt.gain.value = carrier.frequency.value * (0.2 + recipe.motion * 2);
                mod.connect(modAmt).connect(carrier.frequency);
                carrier.connect(filter);
                mod.start(0); carrier.start(0);
                mod.stop(dur); carrier.stop(dur);
                break;
            }
            case 'vocalish': {
                // Two formant bands over a buzzy source reads as a choral pad.
                filter.type = 'bandpass';
                filter.Q.value = 6 + rand() * 8;
                const formants = [[730, 1090], [400, 1700], [270, 2290], [530, 1840]];
                const [f1, f2] = formants[Math.floor(rand() * formants.length)];
                filter.frequency.value = f1;
                const second = ctx.createBiquadFilter();
                second.type = 'bandpass';
                second.Q.value = filter.Q.value;
                second.frequency.value = f2;
                second.connect(level);
                const osc = ctx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.value = expMap(rand(), 90, 260);
                osc.frequency.linearRampToValueAtTime(
                    osc.frequency.value * (1 + (rand() - 0.5) * recipe.motion), dur);
                osc.connect(filter);
                osc.connect(second);
                osc.start(0); osc.stop(dur);
                break;
            }
            case 'bell': {
                // Sparse struck partials with long decays.
                filter.type = 'bandpass';
                filter.Q.value = 30 + rand() * 60;
                filter.frequency.value = layerCentre;
                const hits = 1 + Math.round(recipe.density * 6);
                for (let h = 0; h < hits; h++) {
                    const at = rand() * dur * 0.85;
                    const osc = ctx.createOscillator();
                    osc.type = 'sine';
                    osc.frequency.value = layerCentre * (1 + h * (0.4 + rand()));
                    const env = ctx.createGain();
                    env.gain.setValueAtTime(0.0001, at);
                    env.gain.exponentialRampToValueAtTime(0.6, at + 0.005);
                    env.gain.exponentialRampToValueAtTime(0.0001, Math.min(dur, at + 1 + rand() * 3));
                    osc.connect(env).connect(filter);
                    osc.start(at); osc.stop(Math.min(dur, at + 4));
                }
                break;
            }
            case 'wind':
            default: {
                // Swept filtered noise — the archetypal granular source.
                filter.type = 'bandpass';
                filter.Q.value = 1 + rand() * 6;
                filter.frequency.value = layerCentre;
                const sweep = ctx.createOscillator();
                sweep.frequency.value = 0.02 + rand() * (0.05 + recipe.motion * 0.4);
                const sweepAmt = ctx.createGain();
                sweepAmt.gain.value = layerCentre * (0.2 + recipe.motion * 0.7);
                sweep.connect(sweepAmt).connect(filter.frequency);
                sweep.start(0); sweep.stop(dur);
                const src = ctx.createBufferSource();
                src.buffer = noiseBuffer(ctx, dur, rand);
                src.connect(filter);
                src.start(0);
                break;
            }
        }
    }

    // Fade the very edges so the buffer's own start and end never click.
    const fade = Math.min(0.05, dur / 10);
    out.gain.setValueAtTime(0, 0);
    out.gain.linearRampToValueAtTime(0.8, fade);
    out.gain.setValueAtTime(0.8, dur - fade);
    out.gain.linearRampToValueAtTime(0, dur);

    return ctx.startRendering();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/textureSynth.test.mjs`
Expected: `pass 4`, `fail 0`.

- [ ] **Step 5: Add the UI**

In `index.html`, after the Mic button:

```html
                <button id="generate-btn" type="button" title="Generate a texture" aria-label="Generate a procedural texture sample">Generate</button>
                <select id="generate-preset" aria-label="Texture type">
                    <option value="">Random</option>
                    <option value="wind">Wind</option>
                    <option value="metallic">Metallic</option>
                    <option value="swarm">Swarm</option>
                    <option value="vocalish">Vocal-ish</option>
                    <option value="bell">Bell cloud</option>
                </select>
```

In `src/main.js`:

```js
import { renderTexture, randomRecipe, TEXTURE_PRESETS } from './audio/TextureSynth.js';

// --- Procedural texture generation ---

const generateBtn = document.getElementById('generate-btn');
const generatePreset = document.getElementById('generate-preset');

generateBtn.addEventListener('click', async () => {
    const active = instanceManager.getActive();
    if (!active) return;

    generateBtn.disabled = true;
    generateBtn.textContent = 'Rendering…';
    try {
        const recipe = randomRecipe(generatePreset.value || undefined);
        const buffer = await renderTexture(recipe, masterBus.audioContext.sampleRate);
        const label = TEXTURE_PRESETS.find(p => p.id === recipe.preset)?.label ?? recipe.preset;
        adoptGeneratedBuffer(buffer, `${label} #${recipe.seed.toString(36).slice(0, 4)}`);
        // The recipe is a handful of numbers, so the exact texture survives a
        // reload — which is more than a downloaded model could offer.
        active.state.textureRecipe = recipe;
        if (persistence) persistence.scheduleSave();
        showNotification(`Generated ${buffer.duration.toFixed(1)} s of ${label.toLowerCase()}`);
    } catch (err) {
        console.error('Texture generation failed:', err);
        showNotification(`Could not generate a texture: ${err.message}`, true);
    } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = 'Generate';
    }
});
```

- [ ] **Step 6: Persist and restore the recipe**

In `src/state/InstanceState.js`, add to the constructor beside the sample reference:

```js
        /**
         * Recipe for a procedurally generated sample, when the current buffer came
         * from TextureSynth. Re-renders exactly on restore — a generated sample is
         * the only kind that survives a reload without re-fetching anything.
         * @type {import('../audio/TextureSynth.js').Recipe|null}
         */
        this.textureRecipe = null;
```

In `src/main.js`, extend `restoreSampleForInstance` — check the recipe **before** falling through to "missing":

```js
async function restoreSampleForInstance(state, entry) {
    if (state.textureRecipe) {
        try {
            const buffer = await renderTexture(state.textureRecipe, masterBus.audioContext.sampleRate);
            entry.engine.adoptBuffer(buffer);
            entry.buffer = buffer;
            if (instanceManager.activeId === state.id) {
                waveform.setBuffer(buffer);
                sampleNameEl.textContent = state.sampleDisplayName;
                sampleSelect.value = '';
            }
            return;
        } catch (err) {
            console.warn('Failed to re-render texture:', err);
        }
    }
    if (state.sampleUrl && bundledSampleUrls.has(state.sampleUrl)) {
        // ... unchanged ...
```

Clear the recipe whenever a different source is adopted — in `handleFile`, `loadSampleFromUrl`, and the mic path:

```js
    active.state.textureRecipe = null;
```

- [ ] **Step 7: Verify by ear**

Generate each of the five presets and granulate them. Check specifically:
1. No clicks at the buffer's start or end.
2. Levels are comparable to the bundled MP3s — no need to touch the master.
3. Reload the page: a generated sample comes back identical, not marked "(missing)".

- [ ] **Step 8: Commit**

```bash
git add src/audio/TextureSynth.js src/state/InstanceState.js src/main.js index.html tests/textureSynth.test.mjs
git commit -m "feat(audio): procedural texture generator

Five seeded presets rendered through an OfflineAudioContext from noise, filter
sweeps, FM and convolution. Zero bytes over the wire, works offline, works on
every device, and the recipe serialises into the session JSON so a generated
sample survives a reload exactly — which a downloaded neural model could not.

Answers 'generate ia audio ?' in TODO.txt. See AI-AUDIO-REVIEW.md for why this
rather than an in-browser neural model."
```

---

### Task 26: GANSynth spike — timeboxed, outside this repo

**Half a day, hard stop.** The purpose is a decision backed by evidence, not a feature. Per `AI-AUDIO-REVIEW.md` §7, GANSynth is the only local neural option worth testing: random latents are its *designed* input, the checkpoint is 27.9 MB, `@magenta/music` ships a 2.38 MB UMD bundle with tfjs baked in, and it is Apache-2.0. The single real risk is that its bundled tfjs 2.7 (from 2020) no longer works on a current browser.

**Files:**
- Create: `~/spikes/gansynth-spike/index.html` — **outside the granul8 repo**
- Create: `agents/2026-08-15-gansynth-spike-result.md` — the finding, committed to granul8

**Interfaces:** none. Nothing from this task is imported by granul8.

- [ ] **Step 1: Write the spike page**

Create `~/spikes/gansynth-spike/index.html`:

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>GANSynth spike</title></head>
<body>
<pre id="log" style="font:13px monospace;padding:16px;white-space:pre-wrap"></pre>
<button id="go" style="font-size:16px;padding:12px 24px;margin:16px">Run spike</button>
<script src="https://cdn.jsdelivr.net/npm/@magenta/music@1.23.1/dist/magentamusic.js"></script>
<script>
const log = (m) => { document.getElementById('log').textContent += m + '\n'; console.log(m); };

document.getElementById('go').onclick = async () => {
    const t0 = performance.now();
    try {
        log('tfjs version: ' + (window.mm?.tf?.version_core ?? 'MISSING'));
        log('backend: ' + (window.mm?.tf?.getBackend?.() ?? 'unknown'));

        const CKPT = 'https://storage.googleapis.com/magentadata/js/checkpoints/gansynth/acoustic_only';
        log('initializing GANSynth from ' + CKPT);
        const gan = new mm.GANSynth(CKPT);
        await gan.initialize();
        log('initialized in ' + Math.round(performance.now() - t0) + ' ms');

        // Random latent in, novel timbre out — the model's designed contract.
        const t1 = performance.now();
        const specgrams = await gan.randomSample(60);   // MIDI pitch 60
        const audio = await gan.specgramsToAudio(specgrams);
        log('generated in ' + Math.round(performance.now() - t1) + ' ms');

        log('type: ' + audio.constructor.name + ', length: ' + audio.length);
        let min = Infinity, max = -Infinity, nan = 0;
        for (const s of audio) {
            if (Number.isNaN(s)) nan++;
            if (s < min) min = s;
            if (s > max) max = s;
        }
        log(`range: ${min.toFixed(4)} .. ${max.toFixed(4)}, NaN: ${nan}`);
        if (nan > 0) { log('FAIL: output contains NaN'); return; }
        if (max - min < 0.01) { log('FAIL: output is silent'); return; }

        const ctx = new AudioContext();
        const buf = ctx.createBuffer(1, audio.length, 16000);
        buf.copyToChannel(Float32Array.from(audio), 0);
        const src = ctx.createBufferSource();
        src.buffer = buf; src.connect(ctx.destination); src.start();
        log(`PASS: ${buf.duration.toFixed(2)} s at 16 kHz, playing now`);

        specgrams.dispose?.();
    } catch (err) {
        log('FAIL: ' + err.message);
        console.error(err);
    }
};
</script>
</body>
</html>
```

- [ ] **Step 2: Run it in every browser you care about**

Serve it (`python3 -m http.server 8001`) and run in Chrome, Firefox and Safari. Record for each: whether it initialised, wall-clock time to first sample, total bytes on the wire (DevTools Network), and whether the audio sounded like an instrument rather than noise.

- [ ] **Step 3: Write down the finding**

Create `agents/2026-08-15-gansynth-spike-result.md`:

```markdown
# GANSynth spike result

**Date:** 2026-08-15
**Timebox:** half a day
**Question:** Does `@magenta/music@1.23.1` (bundling tfjs 2.7 from 2020) still run
GANSynth in a 2026 browser, and is "random latent in, 4 s of novel timbre out"
worth ~30 MB behind an opt-in button?

**Context:** `AI-AUDIO-REVIEW.md` §7. GANSynth is the only local neural option
where random latents are the model's designed input rather than an abuse of it.

## Results

| Browser | Init | Generate | Bytes | Output |
|---|---|---|---|---|
| Chrome  | | | | |
| Firefox | | | | |
| Safari  | | | | |

## Decision

<!-- Pick one and delete the others.

PROCEED — it works everywhere that matters. Ship as a lazily-loaded, explicitly
opt-in "Generate (neural)" button beside the procedural generator. Never on
first load, never blocking tap-to-start, desktop-gated, with a real progress UI.

DEFER — it works but the payoff over TextureSynth does not justify 30 MB and an
unmaintained dependency. Revisit only on the trigger in AI-AUDIO-REVIEW.md §9:
an ONNX/transformers.js build of Stable Audio Open Small.

REJECT — tfjs 2.7 is broken on current browsers. The Magenta path is closed.
-->

## Notes
```

- [ ] **Step 4: Commit the finding, not the spike**

```bash
git add agents/2026-08-15-gansynth-spike-result.md
git commit -m "docs: record the GANSynth spike result

Timeboxed half-day spike run outside the repo. Nothing from it is imported;
this file exists so the decision is written down rather than re-litigated."
```

> **Do not** copy the spike into `granul8/`. If the decision is PROCEED, that is a
> separate, properly-scoped task with a lazy `import()`, a device gate, a progress
> UI, and an amendment to the README's zero-dependency claim.

---

### Task 27: Close out Phase 3

- [ ] **Step 1: Run the full suite**

Run: `node --test "tests/*.test.mjs"`
Expected: 0 failures.

- [ ] **Step 2: Update TODO.txt**

Replace the bottom three lines:

```
- record audio input for sample          [DONE — src/input/MicRecorder.js]
- generate ia audio ?                    [DONE — src/audio/TextureSynth.js, procedural.
                                          See AI-AUDIO-REVIEW.md for why not a neural model.]
- export audio ?                         [still open — OfflineAudioContext render of the
                                          granular engine, ~100 lines]
```

- [ ] **Step 3: Update the README**

In the Features section, add under a new **Sample sources** heading:

```markdown
**Sample sources**
- Nine bundled samples, plus drag-and-drop or file picker for your own audio
- **Microphone capture** — record up to 30 s straight into the instrument
- **Procedural textures** — five seeded generators (wind, metallic, swarm,
  vocal-ish, bell cloud) rendered offline in pure Web Audio. The recipe is stored
  in the session, so a generated sample comes back identical after a reload.
```

And in Known limitations, replace the AI bullet:

```markdown
- Exporting the rendered audio (only the gesture automation can be exported, as JSON).
- In-browser neural audio generation is **deliberately not implemented** — see
  [AI-AUDIO-REVIEW.md](AI-AUDIO-REVIEW.md). Microphone capture and the procedural
  generator cover the same ground at zero download cost and work on mobile.
```

- [ ] **Step 4: Merge**

```bash
git checkout main
git merge --no-ff feat/sample-sources -m "merge: microphone capture and procedural textures (Phase 3)"
```

---

## Self-review notes

Checked against the three source documents:

- **`AUDIT-CODE.md`** — all 12 critical/high findings have a task (1–12). Of the mediums, #14, #21, #22, #24, #27, #29, #31, #35, #36, #38 and #48 are covered; the rest are deliberately deferred as low-yield and are listed as still open in Task 13's status note.
- **`AUDIT-UX.md`** — the critical (#1) and all 15 highs have tasks (14–21). Mediums #19, #20, #22, #23, #24, #25, #30, #31, #38, #41, #48 are covered.
- **`AI-AUDIO-REVIEW.md`** — §6.1 (mic) is Task 24, §6.2 (TextureSynth) is Task 25, §7 (GANSynth spike) is Task 26. §6.3 (Freesound) and §6.4 (BYO-key API) are **ruled out**, not deferred: the instrument must work offline. Both recommendations are therefore withdrawn — see the note under the task checklist.
- **Type consistency:** `adoptBuffer` (Task 23) is used by Tasks 24 and 25 under that exact name. `setLoopBars`/`getLoopBars`/`getLoopableDuration`/`retime` (Task 7) are consumed by Task 11 and by `SessionSerializer`. `ensureEpoch` (Task 9) is called from Task 15's unlock handler. `refreshVoiceColors` (Task 18) is called from Task 14's theme toggle. `Recorder.startRecording(atTime)` (Task 9) is called with an argument by Task 9's `beginFixedRecording` and without one elsewhere.
- **Known ordering constraint:** Task 6 depends on Task 5's exact-length advance; Task 7 depends on Task 6's phase-lock; Task 11 depends on Task 7's `getLoopableDuration`. Do not reorder 5 → 6 → 7 → 11.

