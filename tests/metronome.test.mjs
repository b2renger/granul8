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
const clickTimes = (ctx) => ctx.oscillators.map(o => o.started);

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

test('startCountIn on a fresh instance places the first click at now on beat 0', () => {
    const { timers, ctx, clock, met, restore } = harness(120);
    try {
        const beats = [];
        met.onBeat = (idx) => beats.push(idx);
        let completedAt = null;
        let completions = 0;
        met.startCountIn((at) => { completedAt = at; completions++; });
        advance(ctx, timers, 2.5);              // 1 bar (2.0 s) + margin

        const times = clickTimes(ctx);
        assert.equal(times[0], 0, `expected the first click at t=0, got ${times[0]}`);
        assert.equal(beats[0], 0, `expected the first beat index to be 0 (the accent), got ${beats[0]}`);
        // 4/4: the count-in is one full bar, so indices run 0,1,2,3.
        assert.deepEqual(beats.slice(0, 4), [0, 1, 2, 3], `expected the count-in to cycle 0..3, got ${beats.slice(0, 4)}`);

        assert.equal(completions, 1, `expected the completion callback exactly once, got ${completions}`);
        assert.equal(completedAt, clock.getBarDuration(), `expected completion at the bar boundary, got ${completedAt}`);
        met.stop();
    } finally { restore(); }
});

test('startCountIn while already running does not defer the first beat to a later tick', () => {
    const { timers, ctx, clock, met, restore } = harness(120);
    try {
        met.start();
        advance(ctx, timers, 3.3);               // arbitrary mid-beat running time
        const beats = [];
        met.onBeat = (idx) => beats.push(idx);
        const before = clickTimes(ctx).length;
        const startTime = ctx.currentTime;
        let completedAt = null;
        let completions = 0;
        met.startCountIn((at) => { completedAt = at; completions++; });
        advance(ctx, timers, 2.5);               // 1 bar (2.0 s) + margin

        const added = clickTimes(ctx).slice(before);
        assert.equal(added[0], startTime, `expected the first click at ${startTime} (the moment startCountIn was called), got ${added[0]}`);
        assert.equal(beats[0], 0, `expected the first beat index to be 0 (the accent), got ${beats[0]}`);

        assert.equal(completions, 1, `expected the completion callback exactly once, got ${completions}`);
        assert.equal(completedAt, startTime + clock.getBarDuration(), `expected completion one bar after ${startTime}, got ${completedAt}`);
        met.stop();
    } finally { restore(); }
});
