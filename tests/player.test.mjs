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
        // LOWER BOUND. Without it this test — the only coverage the crossfade
        // mechanism has — cannot detect the crossfade being removed outright.
        // Delete `this._preStartNextIteration();` (Player._tick, in the CROSSFADE
        // PRE-START block) and starts.length falls from 4 to 1: `_crossfadeStarted`
        // is still set, so the wrap still skips [loopStart, loopStart + 50 ms) as
        // "already sent" while nothing ever sent it. Every assertion above still
        // passes. 4 starts are observed across the 4 iterations of this run.
        assert.ok(starts.length >= 3,
            `expected ~one start per iteration, got ${starts.length} — the crossfade pre-start is not dispatching`);
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

test('the playhead never jumps backwards at a loop-station wrap: it rewinds only on a wrap tick, and only to the loop start', () => {
    // RETITLED AND STRENGTHENED. The previous title promised a monotonicity
    // assertion the body did not contain — it only range-checked each frame, so
    // an anchor that teleported the playhead to an arbitrary interior point
    // (which the removed per-wrap `quantizeToBar` re-snap did, by up to half a
    // bar in either direction) passed unnoticed as long as it stayed in range.
    // The claim is now explicit and testable in three parts:
    //   1. within an iteration the reported elapsed never decreases;
    //   2. it decreases ONLY on the tick that fires onLoopWrap, and lands back
    //      within one transport tick of the loop start — not part-way in;
    //   3. a stall spanning several iterations is fully consumed, so the first
    //      frame after it is inside the loop rather than several loops past it.
    //
    // The loop is 4.01 s, not 4.0: TICK_MS is 25 and 4.0 / 0.025 = 160 exactly,
    // so a 4.0 s loop lands precisely on FakeTimers' grid, every overshoot is
    // zero and every post-wrap frame reads exactly 0 — parts 1 and 2 would hold
    // for free. At 4.01 s the observed overshoots are 15/5/20/10 ms.
    const { timers, ctx, p, restore } = harness();
    try {
        const clock = new MasterClock(ctx);
        clock.bpm = 120;
        clock.setEpoch(0);
        p.setLoopStationMode(true, clock);

        const LOOP = 4.01;
        const TICK = 0.025;                    // Player's TICK_MS, in seconds
        const elapsedSeen = [];
        let wrapPending = false;
        // onLoopWrap fires inside _tick's boundary block, onFrame at the end of
        // the same tick — so a frame flagged here is the wrap's own frame.
        p.onLoopWrap = () => { wrapPending = true; };
        p.onFrame = (e) => { elapsedSeen.push({ e, afterWrap: wrapPending }); wrapPending = false; };
        p.setLoopRange(0, LOOP);
        ctx.currentTime = 1.1;
        p.play(lane([{ time: 3.9, voiceIndex: 0, type: 'stop' }]), true);
        advance(ctx, timers, 20.0);

        assert.ok(elapsedSeen.length > 0, 'onFrame was called');
        for (const { e } of elapsedSeen) {
            assert.ok(e >= 0, `onFrame reported a negative elapsed time: ${e}`);
            assert.ok(e <= LOOP + 0.1, `onFrame reported elapsed beyond the loop: ${e}`);
        }

        // (1) and (2). Deleting `this._startTime += loopLen;` from _tick's loop
        // boundary block makes the post-wrap frame report ~loopEnd instead of
        // ~loopStart, failing the second branch below.
        let wrapFrames = 0;
        for (let i = 1; i < elapsedSeen.length; i++) {
            const prev = elapsedSeen[i - 1].e, cur = elapsedSeen[i];
            if (!cur.afterWrap) {
                assert.ok(cur.e >= prev - 1e-9,
                    `playhead went backwards without a wrap: ${prev} -> ${cur.e}`);
            } else {
                wrapFrames++;
                assert.ok(cur.e >= 0 && cur.e <= TICK + 0.005,
                    `a wrap must rewind to the loop start (within one ${TICK}s tick), got ${cur.e}`);
            }
        }
        assert.ok(wrapFrames >= 3, `expected several wraps in 20 s of a ${LOOP} s loop, got ${wrapFrames}`);

        // (3) Multi-iteration stall. The audio clock jumps 10 s (~2.5 iterations)
        // while the transport timer is blocked, exactly as a hidden tab or a long
        // decodeAudioData does. _tick's `while (overshoot >= loopLen)` catch-up
        // must consume every missed iteration in one go. Deleting the
        // `this._startTime += loopLen;` INSIDE that while loop advances the anchor
        // by a single loop length only, and the frame below reports ~9 s instead
        // of ~1 s — nothing else in the suite covers that line.
        const before = elapsedSeen.length;
        ctx.currentTime += 10;
        advance(ctx, timers, 0.05);
        const afterStall = elapsedSeen.slice(before);
        assert.ok(afterStall.length >= 1, 'the transport must keep ticking after a stall');
        for (const { e } of afterStall) {
            assert.ok(e >= 0 && e <= LOOP,
                `after a 10 s stall the playhead must land back inside the loop, got ${e}`);
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

test('retime() keeps the loop anchored to the bar grid across a MID-loop tempo change', () => {
    // History of this test. It was first written with the tempo change at t=10.0,
    // which lands exactly ON a wrap boundary: the loop fraction is 0 either way
    // there, so it passed identically whether retime() re-anchored or was a
    // complete no-op. Task 7 moved it to mid-iteration (fraction 0.25), where a
    // no-op retime() is distinguishable.
    //
    // It then asserted the wrap at 3.0 + 0.75 * 3.4286 = 5.5715 -- the
    // fraction-preserving position, which is 5.5715 / 1.714286 = 3.25 bars from
    // the epoch: exactly one beat off the bar grid, permanently. That is the
    // asserted value that exposed the bug. play()'s own comment claims "phase-lock
    // to the bar grid exactly once, at launch. Thereafter the anchor advances by
    // exact loop lengths ... so it cannot drift off the grid", and retime()
    // re-anchored to an arbitrary wall-clock instant, breaking it -- while
    // Metronome._tick re-derives absolutely from the epoch on the same BPM change,
    // so the click ends up permanently out of phase with the layers and any layer
    // recorded afterwards lands out of phase with the existing ones.
    //
    // The claim is now grid alignment, with continuity kept as a bound rather than
    // an equality: the epoch is fixed and the bar length has just changed, so
    // `now`'s phase in the new grid is not the phase the old anchor had. Something
    // must move; the nearest-bar snap moves the playhead by at most half a bar.
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

        const bar = clock.getBarDuration();    // 1.714286
        const bars = (wraps[0] - clock._epoch) / bar;
        assert.ok(Math.abs(bars - Math.round(bars)) * bar < 0.01,
            `wrap at ${wraps[0].toFixed(4)} is ${bars.toFixed(4)} bars from the epoch — off the 140 bpm grid`);

        // Continuity bound. A grid-aligned anchor that ignored the playhead
        // entirely could satisfy the assertion above; this one cannot move the
        // wrap more than half a bar from where preserving the fraction exactly
        // would have put it. (Measured: 5.1429 against 5.5715, a quarter bar.)
        const fractionPreserving = 3.0 + 0.75 * 3.428571;
        assert.ok(Math.abs(wraps[0] - fractionPreserving) <= bar / 2 + 1e-9,
            `wrap at ${wraps[0].toFixed(4)} moved more than half a bar from the fraction-preserving ${fractionPreserving.toFixed(4)}`);
        p.stop();
    } finally { restore(); }
});

test('touching the tempo during the pre-roll re-phase-locks the launch instead of releasing it', () => {
    // retime()'s guard is satisfied during the pre-roll, where _loopFraction is
    // still 0 -- so `pos` equalled the loop start, the anchor landed on `now`, and
    // the pre-roll guard released immediately. Nudging the BPM slider in the window
    // between pressing Play and the layer launching cancelled the phase-lock
    // outright, which is the one thing loop-station mode exists to provide.
    //
    // Nothing has sounded yet at that point, so there is no continuity to preserve
    // and the launch is simply re-phase-locked, exactly as play() does it.
    const { timers, ctx, p, restore } = harness();
    try {
        const clock = new MasterClock(ctx);
        clock.bpm = 120;                       // bar = 2.0 s
        clock.setEpoch(0);
        p.setLoopStationMode(true, clock);
        p.setLoopBars(0, 2);

        ctx.currentTime = 0.3;
        const frames = [];
        p.onFrame = (e) => frames.push({ e, at: ctx.currentTime });
        p.play(lane([{ time: 3.9, voiceIndex: 0, type: 'stop' }]), true);
        assert.equal(frames.length, 0, 'sanity: the layer is in its pre-roll, nothing sounding');

        ctx.currentTime = 0.5;
        clock.bpm = 90;                        // bar becomes (60/90)*4 = 2.66667 s
        p.retime();

        advance(ctx, timers, 6.0);
        assert.ok(frames.length > 0, 'the layer must still launch');
        const bar = clock.getBarDuration();
        const launchedAt = frames[0].at;
        assert.ok(launchedAt >= 2.0,
            `the layer launched at ${launchedAt.toFixed(4)} — retime() released the pre-roll instead of re-locking it`);
        const bars = (launchedAt - clock._epoch) / bar;
        assert.ok(Math.abs(bars - Math.round(bars)) * bar < 0.03,
            `launch at ${launchedAt.toFixed(4)} is ${bars.toFixed(4)} bars from the epoch — off the 90 bpm grid`);
        p.stop();
    } finally { restore(); }
});

test('setLoopBars(0, 0) clears the musical loop instead of sticking at zero length', () => {
    // Task 7's setLoopBars() assigned unconditionally: setLoopBars(0, 0) stored
    // { startBars: 0, lengthBars: 0 } rather than clearing. Task 11 resets a
    // fresh take via setLoopBars(0, 0), so an unguarded assignment here freezes
    // playback (see the next test) rather than falling back to the seconds range.
    const { ctx, p, restore } = harness();
    try {
        const clock = new MasterClock(ctx);
        clock.bpm = 120;
        clock.setEpoch(0);
        p.setLoopStationMode(true, clock);
        p.setLoopBars(0, 2);
        assert.deepEqual(p.getLoopBars(), { startBars: 0, lengthBars: 2 });

        p.setLoopBars(0, 0);
        assert.equal(p.getLoopBars(), null,
            'setLoopBars(0, 0) must clear the musical loop (getLoopBars() -> null), not stick at zero length');
    } finally { restore(); }
});

test('after setLoopBars(0, 0) clears the musical loop, playback resumes using the seconds-based range instead of freezing', () => {
    // Loop-station mode and the clock stay ATTACHED throughout this test -- that is
    // what makes it actually exercise the guard. _resolveLoop()'s bar branch is
    // gated on `this._loopBars && this._clock`. If the clock were detached (e.g.
    // via setLoopStationMode(false, null)) it would gate the branch closed on its
    // own, so an unconditional `setLoopBars` assignment (the un-guarded bug) and
    // the guarded fix would both fall through to the seconds branch identically --
    // the test would pass either way and prove nothing about the guard. With the
    // clock attached, an unguarded assignment leaves _loopBars at
    // { startBars: 0, lengthBars: 0 }, the bar branch resolves a genuine
    // zero-length loop, and _tick()'s `loopLen <= 0` guard freezes the transport
    // forever: zero wraps.
    const { timers, ctx, p, restore } = harness();
    try {
        const clock = new MasterClock(ctx);
        clock.bpm = 120;                       // bar = 2.0 s
        clock.setEpoch(0);
        p.setLoopStationMode(true, clock);
        p.setLoopBars(0, 2);                   // a previous take's 2-bar (4.0 s) musical loop

        // Reset for a new take, as Task 11's onRecord handler does. Loop-station
        // mode and the clock are left exactly as a live loop-station instance would
        // have them -- only the musical loop itself is cleared.
        p.setLoopBars(0, 0);
        p.setLoopRange(0, 2.0);                // seconds-based range for the new take

        const wraps = [];
        p.onLoopWrap = () => wraps.push(ctx.currentTime);
        p.play(lane([{ time: 1.9, voiceIndex: 0, type: 'stop' }]), true);
        advance(ctx, timers, 10.0);

        assert.ok(wraps.length >= 3, `expected several wraps on the 2.0 s seconds-based loop, got ${wraps.length}`);
        // The loop-station phase-lock anchors play() to the next bar boundary (see
        // "loop-station playback phase-locks to the bar grid" above), so the FIRST
        // wrap may land up to one bar late. Assert on the INTERVAL between wraps
        // (the resolved loop length) rather than their absolute time from t=0.
        for (let i = 1; i < wraps.length; i++) {
            const interval = wraps[i] - wraps[i - 1];
            assert.ok(Math.abs(interval - 2.0) < 0.05,
                `wrap ${i} interval ${interval.toFixed(3)} s, expected the 2.0 s seconds-based loop length`);
        }
        p.stop();
    } finally { restore(); }
});

test('setTakeBars stores the take length; setTakeBars(0) clears it like setLoopBars(0, 0) does', () => {
    // getTakeBars() is the STABLE denominator loop-handle fractions convert
    // against (see loopHandleMath.js / Critical 2 in the task-11 fix report). It
    // must be independently settable/clearable from the loop WINDOW (_loopBars),
    // and default to null so callers fall back correctly when no take exists yet.
    const { p, restore } = harness();
    try {
        assert.equal(p.getTakeBars(), null, 'no take recorded yet');

        p.setTakeBars(4);
        assert.equal(p.getTakeBars(), 4);

        p.setTakeBars(0);
        assert.equal(p.getTakeBars(), null, 'setTakeBars(0) must clear the take length, not store 0');
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

test('the dispatch cursor never leaves the loop window, even for a loop shorter than the crossfade', () => {
    // A 20 ms loop is reachable: TransportBar only enforces endFrac >= startFrac
    // + 0.01, so 1% of a 2 s take is 20 ms, and with the seconds denominator fixed
    // that stays where the user put it. loopLen (0.020) is then below
    // CROSSFADE_WINDOW (0.050), and the wrap block credited the pre-start with
    // having dispatched a full 50 ms of a 20 ms loop: _lastProcessedTime was set
    // to loopStart + 0.050, i.e. PAST loopEnd. getEventsInRange() returns nothing
    // for an inverted range and the tail's Math.max() pins the cursor there, so
    // the normal dispatch path is inert for the rest of that iteration.
    //
    // Measured scope, stated honestly: in this regime _preStartNextIteration()'s
    // window covers the WHOLE loop, so nothing is lost either way -- 160 dispatches
    // across 80 wraps (every event, every iteration) both before and after this
    // clamp. What the clamp restores is the invariant that the dispatch cursor
    // stays inside the loop window, which the rest of _tick() assumes.
    const { timers, ctx, p, dispatched, restore } = harness();
    try {
        const LOOP_END = 0.02;
        const l = lane([
            { time: 0.005, voiceIndex: 0, type: 'start', params: P('tiny') },
            { time: 0.015, voiceIndex: 0, type: 'stop' },
            { time: 1.0, voiceIndex: 1, type: 'stop' },   // gives the lane a real duration
        ]);
        p.setLoopRange(0, LOOP_END);
        let wraps = 0;
        p.onLoopWrap = () => wraps++;
        p.play(l, true);
        advance(ctx, timers, 2.0);

        assert.ok(wraps >= 50, `expected the 20 ms loop to keep wrapping, got ${wraps}`);
        assert.ok(dispatched.length > 0, 'the loop must still produce voices');
        assert.ok(p._lastProcessedTime >= 0,
            `dispatch cursor ${p._lastProcessedTime} is before the loop start`);
        assert.ok(p._lastProcessedTime <= LOOP_END + 1e-9,
            `dispatch cursor ${p._lastProcessedTime} is past loopEnd (${LOOP_END}) — it can never come back inside this iteration`);
        p.stop();
    } finally { restore(); }
});

test('play() anchors the clock epoch before it reads the bar grid', () => {
    // main.js removes the unlock overlay outright when audioContext.state is
    // already 'running' at load, so dismissUnlockOverlay() -- the only
    // unconditional load-time anchor -- never runs on a warm context. Restore a
    // session, press Play with the metronome off, and play() reaches
    // getNextBarTime() against an unanchored _epoch of 0. The handler's own
    // ensureEpoch() sits AFTER play() and is gated on the metronome, so the first
    // thing that does anchor -- switching the metronome on -- moves the epoch to
    // that instant and the whole bar grid jumps under the already-playing layer.
    const { timers, ctx, p, restore } = harness();
    try {
        const clock = new MasterClock(ctx);     // deliberately NOT anchored
        clock.bpm = 120;                        // bar = 2.0 s
        assert.equal(clock.isAnchored, false, 'sanity: nothing has anchored the grid yet');
        p.setLoopStationMode(true, clock);
        p.setLoopBars(0, 2);                    // 2 bars = 4.0 s

        ctx.currentTime = 3.3;                  // audio has been running for a while
        const wraps = [];
        p.onLoopWrap = () => wraps.push(ctx.currentTime);
        p.play(lane([{ time: 3.9, voiceIndex: 0, type: 'stop' }]), true);

        assert.equal(clock.isAnchored, true,
            'play() phase-locks to getNextBarTime(), so it must anchor the epoch first');
        const anchoredAt = clock._epoch;

        advance(ctx, timers, 6.0);
        // Now the user switches the metronome on. ensureEpoch() must find the grid
        // already anchored and leave it exactly where the layer locked to it.
        clock.ensureEpoch();
        assert.equal(clock._epoch, anchoredAt,
            `enabling the metronome moved the epoch from ${anchoredAt} to ${clock._epoch} — the grid jumped under a playing layer`);

        advance(ctx, timers, 14.0);
        const bar = clock.getBarDuration();
        assert.ok(wraps.length >= 3, `expected several wraps, got ${wraps.length}`);
        for (const w of wraps) {
            const beats = (w - clock._epoch) / bar;
            const off = Math.abs(beats - Math.round(beats)) * bar;
            assert.ok(off < 0.05,
                `wrap at ${w.toFixed(3)} is ${off.toFixed(3)} s off the metronome's bar grid`);
        }
        p.stop();
    } finally { restore(); }
});

test('a retime whose nearest bar line lands ahead of now holds for that line and restarts the loop from its top', () => {
    // The nearest-bar snap can put the anchor slightly AHEAD of `now` — only in
    // the early part of a loop, and by at most half a bar. `elapsed` is then below
    // the loop start, the pre-roll guard holds dispatch, and the loop restarts on
    // the downbeat. That is deliberate: forcing the anchor into the past instead
    // (anchor -= bar whenever it lands ahead) would cost a forward jump of up to
    // one and a half bars, which is worse than a bounded wait that lands the loop
    // on a bar line.
    //
    // 120 -> 100 bpm at t = 2.1 with the playhead 0.1 s into the loop hits it:
    // pos = 0.025 * 4.8 = 0.12, so the raw anchor is 1.98 and the nearest 2.4 s
    // bar line is 2.4 — 0.3 s ahead of now, an eighth of a bar.
    const { timers, ctx, p, dispatched, restore } = harness();
    try {
        const clock = new MasterClock(ctx);
        clock.bpm = 120;                       // bar = 2.0 s, 2 bars = 4.0 s
        clock.setEpoch(0);
        p.setLoopStationMode(true, clock);
        p.setLoopBars(0, 2);

        const frames = [];
        p.onFrame = (e) => frames.push({ e, at: ctx.currentTime });
        p.play(lane([
            { time: 0.05, voiceIndex: 0, type: 'start', params: P('top') },
            { time: 3.9, voiceIndex: 0, type: 'stop' },
        ]), true);
        advance(ctx, timers, 2.1);             // 0.1 s into the loop, fraction 0.025

        const n = frames.length;
        const dispatchedBefore = dispatched.length;
        clock.bpm = 100;                       // bar becomes 2.4 s, 2 bars = 4.8 s
        p.retime();
        advance(ctx, timers, 3.0);

        const resumed = frames.slice(n);
        assert.ok(resumed.length > 0, 'the layer must resume, not freeze for good');
        assert.equal(resumed[0].at, 2.4,
            `expected the layer to resume on the 100 bpm bar line at 2.4, got ${resumed[0].at}`);
        assert.ok(resumed[0].at - 2.1 <= clock.getBarDuration() / 2 + 1e-9,
            'the wait must be bounded by half a bar');
        assert.ok(resumed[0].e < 0.03,
            `the loop must restart from its top, got elapsed ${resumed[0].e}`);
        const restarts = dispatched.slice(dispatchedBefore).filter(d => d.tag === 'top');
        assert.ok(restarts.length >= 1,
            'the events at the top of the loop must be dispatched again after the restart');
        p.stop();
    } finally { restore(); }
});

test('leaving loop-station mode clears the musical loop, so the seconds handles take effect again', () => {
    // main.js passes masterBus.clock to setLoopStationMode() unconditionally,
    // including when toggling loop-station mode OFF, and _loopBars was only ever
    // cleared by setLoopBars(0, 0) when starting a new take. So an instance with a
    // bar-based take that was toggled out of loop-station mode kept BOTH _loopBars
    // and _clock, _resolveLoop()'s bar branch went on winning, and the loop handles
    // — now on the seconds path — called setLoopRange(), which that branch ignores.
    // The handles moved and the loop did not.
    const { timers, ctx, p, restore } = harness();
    try {
        const clock = new MasterClock(ctx);
        clock.bpm = 120;                       // bar = 2.0 s
        clock.setEpoch(0);
        p.setLoopStationMode(true, clock);
        p.setLoopBars(0, 2);                   // a 2-bar (4.0 s) musical loop
        assert.deepEqual(p.getLoopBars(), { startBars: 0, lengthBars: 2 }, 'sanity');

        p.setLoopStationMode(false, clock);    // the clock is still passed — as main.js does
        assert.equal(p.getLoopBars(), null,
            'the musical loop must not outlive loop-station mode');

        // And the seconds range must now actually drive playback.
        p.setLoopRange(0, 2.0);
        const wraps = [];
        p.onLoopWrap = () => wraps.push(ctx.currentTime);
        p.play(lane([{ time: 1.9, voiceIndex: 0, type: 'stop' }]), true);
        advance(ctx, timers, 10.0);
        assert.ok(wraps.length >= 3, `expected wraps on the 2.0 s seconds loop, got ${wraps.length}`);
        for (let i = 1; i < wraps.length; i++) {
            const interval = wraps[i] - wraps[i - 1];
            assert.ok(Math.abs(interval - 2.0) < 0.05,
                `wrap interval ${interval.toFixed(3)} s — the stale 4.0 s bar loop is still winning`);
        }
        p.stop();
    } finally { restore(); }
});

test('getLoopRange() reports the window playback actually uses, including a bar-based one', () => {
    // getLoopRange() read the raw seconds fields while _resolveLoop() preferred
    // _loopBars: two getters for one concept, giving different answers. That is how
    // SessionSerializer came to persist a `loopRange` of {0, 0} for a live 2-bar
    // loop — harmless while restore prefers loopBars, but a trap for any reader
    // that does not.
    const { ctx, p, restore } = harness();
    try {
        const clock = new MasterClock(ctx);
        clock.bpm = 120;                       // bar = 2.0 s
        clock.setEpoch(0);
        p.setLoopStationMode(true, clock);
        p.setLoopBars(1, 2);                   // bar 1 .. bar 3 => 2.0 s .. 6.0 s
        assert.deepEqual(p.getLoopRange(), { start: 2.0, end: 6.0 },
            'a bar-based loop must report its resolved seconds, not the untouched seconds fields');

        clock.bpm = 60;                        // bar = 4.0 s
        assert.deepEqual(p.getLoopRange(), { start: 4.0, end: 12.0 },
            'and it must retime with the tempo, exactly as the loop itself does');

        // The seconds path is unchanged.
        p.setLoopStationMode(false, clock);
        p.setLoopRange(0.5, 3.5);
        assert.deepEqual(p.getLoopRange(), { start: 0.5, end: 3.5 });
    } finally { restore(); }
});
