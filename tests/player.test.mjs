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
