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

test('a non-loop-station player with a trimmed loop range begins dispatching in-range events promptly, not after a loopStart-length freeze', () => {
    // Regression test: setLoopRange(1.0, 3.0) on a NON-loop-station player (e.g. via the
    // waveform loop-trim UI, which is not gated on loop-station mode). The pre-roll guard
    // added for loop-station phase-locking must not stall a plain player for `_loopStart`
    // seconds of dead air before it starts, nor cause in-range events to be missed as a
    // result of that stall.
    const { timers, ctx, p, dispatched, restore } = harness();
    try {
        const l = lane([
            { time: 0.1, voiceIndex: 0, type: 'start', params: P('pre-a') },
            { time: 0.5, voiceIndex: 0, type: 'stop' },
            { time: 1.2, voiceIndex: 1, type: 'start', params: P('in-a') },
            { time: 1.8, voiceIndex: 1, type: 'stop' },
            { time: 2.4, voiceIndex: 2, type: 'start', params: P('in-b') },
        ]);
        p.setLoopRange(1.0, 3.0);
        p.play(l, true);                 // loop-station mode is NOT enabled
        advance(ctx, timers, 1.5);        // stays within the first pass (loop wraps at elapsed 3.0);
                                           // long enough to reach both in-range events under a
                                           // correctly-anchored player, too short to reach them
                                           // under the buggy anchor's loopStart-length freeze

        const inRangeStarts = dispatched.filter(d => d.type === 'start' && (d.tag === 'in-a' || d.tag === 'in-b'));
        assert.equal(inRangeStarts.length, 2,
            `expected both in-range events (1.2, 2.4) to be dispatched within 1.5s, got ${inRangeStarts.length}: ${JSON.stringify(dispatched)}`);
        assert.ok(dispatched.length > 0, 'nothing was dispatched at all');
        assert.ok(dispatched[0].at < 0.5,
            `first dispatch should happen promptly (near the play() call), not after a loopStart-length freeze: first dispatch at ${dispatched[0].at}`);
        p.stop();
    } finally { restore(); }
});

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

        advance(ctx, timers, 10.0);
        const before = wraps.length;
        assert.ok(before >= 2, 'looping at 120 bpm');

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

test('retime() preserves the loop fraction on a MID-loop tempo change, not just at a wrap boundary', () => {
    // The brief's own retime test changes the BPM at t=10.0, which happens to land
    // exactly ON a wrap boundary (the loop fraction is 0 either way at that instant).
    // Because _resolveLoop() is re-read fresh every tick regardless of retime(), that
    // test passes identically whether retime() actually re-anchors _startTime or is a
    // complete no-op -- verified by running the harness both ways. This test moves the
    // tempo change to mid-iteration (fraction 0.25), where retime()'s re-anchoring is
    // the only thing keeping the playhead's *position within the loop* continuous
    // instead of jumping.
    const { timers, ctx, p, restore } = harness();
    try {
        const clock = new MasterClock(ctx);
        clock.bpm = 120;                       // bar = 2.0 s, 2 bars = 4.0 s
        clock.setEpoch(0);
        p.setLoopStationMode(true, clock);
        p.setLoopBars(0, 2);
        p.play(lane([{ time: 3.9, voiceIndex: 0, type: 'stop' }]), true);

        advance(ctx, timers, 3.0);             // 1.0s into the 4.0s loop => fraction 0.25

        const wraps = [];
        p.onLoopWrap = () => wraps.push(ctx.currentTime);
        clock.bpm = 140;                       // bar = 1.7143 s, 2 bars = 3.4286 s
        p.retime();
        advance(ctx, timers, 5.0);

        assert.equal(wraps.length, 1, `expected exactly one wrap, got ${wraps.length}`);
        // Remaining time to the wrap should be (1 - fraction) * newLoopLen, measured
        // from the moment of the tempo change (ctx.currentTime === 3.0).
        const expectedWrapAt = 3.0 + 0.75 * 3.4286;
        assert.ok(Math.abs(wraps[0] - expectedWrapAt) < 0.06,
            `wrap at ${wraps[0].toFixed(4)}, expected near ${expectedWrapAt.toFixed(4)} (fraction preserved)`);
        p.stop();
    } finally { restore(); }
});

test('the pre-roll guard compares elapsed against the resolved loop start, not the raw seconds field', () => {
    // With setLoopBars(startBars > 0, ...) the resolved start (bar 1 = 2.0 s at 120 bpm)
    // differs from the raw _loopStart field, which stays 0 -- setLoopRange() is never
    // called for a bar-based loop. If the pre-roll guard compares elapsed against the
    // raw field instead of the resolved start, it stops firing: onFrame runs all the
    // way through the pre-roll window and the transport counts time forward while
    // nothing is musically due to play yet.
    const { timers, ctx, p, restore } = harness();
    try {
        const clock = new MasterClock(ctx);
        clock.bpm = 120;                       // bar = 2.0 s
        clock.setEpoch(0);
        p.setLoopStationMode(true, clock);
        p.setLoopBars(1, 2);                   // resolved start = bar 1 = 2.0 s

        const frames = [];
        p.onFrame = (e) => frames.push(e);
        p.play(lane([{ time: 2.1, voiceIndex: 0, type: 'stop' }]), true);

        advance(ctx, timers, 1.0);             // still short of the resolved 2.0 s start
        assert.equal(frames.length, 0,
            `onFrame fired ${frames.length} time(s) during the pre-roll window before the resolved loop start (2.0 s) arrived`);
        p.stop();
    } finally { restore(); }
});
