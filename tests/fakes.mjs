// fakes.mjs — Hand-written test doubles for the Web Audio API and browser timers.
// No dependencies. Time is driven manually so timing assertions are exact.

/** Records every scheduled AudioParam event so tests can assert on the timeline. */
class FakeParam {
    constructor(ctx, name, value = 0) {
        this._ctx = ctx;
        this.name = name;
        this.value = value;
        /** @type {Array<{method:string, args:number[], at:number}>} */
        this.events = [];
    }
    _rec(method, args) {
        this.events.push({ method, args, at: this._ctx.currentTime });
        return this;
    }
    setValueAtTime(v, t) { this.value = v; return this._rec('setValueAtTime', [v, t]); }
    linearRampToValueAtTime(v, t) { this.value = v; return this._rec('linearRampToValueAtTime', [v, t]); }
    exponentialRampToValueAtTime(v, t) { this.value = v; return this._rec('exponentialRampToValueAtTime', [v, t]); }
    setValueCurveAtTime(curve, t, dur) { return this._rec('setValueCurveAtTime', [curve, t, dur]); }
    cancelScheduledValues(t) { return this._rec('cancelScheduledValues', [t]); }
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
        const live = [];
        for (const e of this.events) {
            if (e.method === 'cancelScheduledValues') {
                const from = e.args[0];
                for (let i = live.length - 1; i >= 0; i--) {
                    if (live[i].args[1] >= from) live.splice(i, 1);
                }
                continue;
            }
            // args[1] is the time for every scheduling method, including
            // setValueCurveAtTime(curve, startTime, duration).
            if (e.args[1] !== undefined) live.push(e);
        }
        return live.filter(e => e.args[1] >= t);
    }
}

class FakeNode {
    constructor(ctx, type) {
        this._ctx = ctx;
        this.type = type;
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
    get sources() { return this.nodes.filter(n => n.type === 'bufferSource'); }
    get gains() { return this.nodes.filter(n => n.type === 'gain'); }
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
