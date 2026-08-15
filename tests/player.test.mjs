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
