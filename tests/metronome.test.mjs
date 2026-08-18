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

/**
 * The `when` of every scheduled click, in order.
 *
 * Filtered by `'started' in n` rather than `n.type === 'oscillator'`: FakeNode uses `.type`
 * as its node-kind marker, but OscillatorNode.type is also a real Web Audio property (the
 * waveform shape), and Metronome._scheduleClick legitimately sets `osc.type = 'sine'` —
 * overwriting the marker before any test ever reads it. `started` is unique to FakeOsc among
 * the fakes (FakeSource uses `startArgs` instead), so it survives that overwrite. Filtering on
 * `n.type` as originally written matches zero nodes, in both the buggy and the fixed code —
 * a defect in the test helper, not in Metronome.
 */
const clickTimes = (ctx) => ctx.nodes.filter(n => 'started' in n).map(o => o.started);

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
