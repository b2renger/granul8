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

test('startCountIn on a fresh instance places the first click on the next bar line, beat 0', () => {
    // Updated for Task 9: startCountIn no longer moves the epoch, so the count-in
    // starts on the NEXT bar line rather than at `now`. It was at t=0 here only
    // because `now` (0) already happened to be on a bar boundary in the old test —
    // this harness starts the fake clock's epoch at 0 and calls startCountIn
    // before advancing time, so `now` is 0 and the next bar line is 2.0s.
    const { timers, ctx, clock, met, restore } = harness(120);
    try {
        const beats = [];
        met.onBeat = (idx) => beats.push(idx);
        let completedAt = null;
        let completions = 0;
        met.startCountIn((at) => { completedAt = at; completions++; });
        const barStart = clock.getNextBarTime(ctx.currentTime); // 2.0
        advance(ctx, timers, 4.5);              // through the bar line, the count-in bar, + margin

        const times = clickTimes(ctx);
        assert.equal(times[0], barStart, `expected the first click at the next bar line (${barStart}), got ${times[0]}`);
        assert.equal(beats[0], 0, `expected the first beat index to be 0 (the accent), got ${beats[0]}`);
        // 4/4: the count-in is one full bar, so indices run 0,1,2,3.
        assert.deepEqual(beats.slice(0, 4), [0, 1, 2, 3], `expected the count-in to cycle 0..3, got ${beats.slice(0, 4)}`);

        assert.equal(completions, 1, `expected the completion callback exactly once, got ${completions}`);
        assert.equal(completedAt, barStart + clock.getBarDuration(), `expected completion one bar after ${barStart}, got ${completedAt}`);
        assert.equal(clock._epoch, 0, 'the epoch must not have moved');
        met.stop();
    } finally { restore(); }
});

test('startCountIn while already running does not defer the first beat to a later tick', () => {
    // Updated for Task 9: the count-in no longer pins the first beat to `now` —
    // it waits for the next bar line, discarding whatever regular beat was
    // pending before it, but still fires that bar-line beat synchronously rather
    // than deferring it to the next look-ahead tick.
    const { timers, ctx, clock, met, restore } = harness(120);
    try {
        met.start();
        advance(ctx, timers, 3.3);               // arbitrary mid-beat running time
        const beats = [];
        met.onBeat = (idx) => beats.push(idx);
        const before = clickTimes(ctx).length;
        let completedAt = null;
        let completions = 0;
        met.startCountIn((at) => { completedAt = at; completions++; });
        const barStart = clock.getNextBarTime(ctx.currentTime); // 4.0
        advance(ctx, timers, 3.0);               // through the bar line, count-in bar, + margin

        const added = clickTimes(ctx).slice(before);
        assert.equal(added[0], barStart, `expected the first count-in click at the next bar line (${barStart}), got ${added[0]}`);
        assert.equal(beats[0], 0, `expected the first beat index to be 0 (the accent), got ${beats[0]}`);

        assert.equal(completions, 1, `expected the completion callback exactly once, got ${completions}`);
        assert.equal(completedAt, barStart + clock.getBarDuration(), `expected completion one bar after ${barStart}, got ${completedAt}`);
        assert.equal(clock._epoch, 0, 'the epoch must not have moved');
        met.stop();
    } finally { restore(); }
});

test('startCountIn while already running schedules the bar-line click synchronously after a stall, with no duplicate', () => {
    // The test above has the bar line ~0.7s away when startCountIn is called —
    // outside the 100ms look-ahead — so it never proves the synchronous _tick()
    // call does anything on the already-running path (an async tick would give
    // the same result). Landing inside the window while already running turns
    // out to usually be claimed by the metronome's OWN background loop first:
    // it uses the same 100ms window on a 25ms timer, so by the time a caller's
    // `now` is inside the window, a background tick has very often already
    // fired within the preceding <=25ms and scheduled the click. A swept check
    // (T = 3.85..3.95 in 5ms steps, same setup as below) confirms this
    // structurally: the transition happens exactly when a periodic tick lands
    // past the `now + 0.1 >= barStart` threshold, independent of the specific
    // instant chosen — so a smooth advance() up to the window essentially never
    // leaves anything for the synchronous tick to do here.
    //
    // The only way to reliably exercise the already-running branch's own
    // synchronous scheduling is to deny the background loop a tick near the
    // boundary first — e.g. a stalled/backgrounded tab, the same scenario (and
    // the same technique: jump ctx.currentTime directly, bypassing the timer
    // queue) as "a stall does not replay every missed beat" above.
    const { timers, ctx, clock, met, restore } = harness(120);   // bar = 2.0s
    try {
        met.start();
        advance(ctx, timers, 1.0);               // run normally for a while
        ctx.currentTime = 1.95;                  // stall, then resume: next bar
                                                   // (2.0) is 50ms out; nothing has
                                                   // ticked since the jump
        const beats = [];
        met.onBeat = (idx) => beats.push(idx);
        const before = ctx.oscillators.length;
        let completedAt = null;
        met.startCountIn((at) => { completedAt = at; });

        // No advance()/runUntil between the call and this check: only the
        // synchronous tick inside startCountIn could have scheduled anything yet.
        const scheduled = ctx.oscillators.slice(before);
        assert.equal(scheduled.length, 1,
            'expected exactly one click scheduled synchronously, before any timer fired');
        assert.equal(scheduled[0].started, 2.0,
            `expected the click at the bar line (2.0), got ${scheduled[0].started}`);

        advance(ctx, timers, 3.0);
        const times = ctx.oscillators.map(o => o.started).filter(t => t >= 1.5 && t <= 4.5);
        assert.deepEqual(times, [2, 2.5, 3, 3.5, 4, 4.5],
            `expected a clean grid from the bar line with no gap or duplicate, got ${times}`);
        assert.equal(beats[0], 0, 'expected the first beat index to be 0 (the accent)');
        assert.equal(completedAt, 4.0, `expected completion one bar after the bar line, got ${completedAt}`);
        met.stop();
    } finally { restore(); }
});

test('startCountIn while already running does not duplicate a click the background loop already scheduled', () => {
    // Companion to the test above: this is the common case it could NOT cover —
    // metronome running normally, no stall, and the bar line enters the 100ms
    // window while the background loop is still ticking every 25ms. As the
    // comment above found, the background loop almost always schedules that
    // click itself before startCountIn is ever called. This test settles the
    // question the investigation raised: does Math.max(_nextBeatTime, barStart)
    // then re-schedule a duplicate, or silently drop something? Answer: neither
    // — asserted explicitly here rather than left to argument. (It cannot be
    // used to prove the synchronous tick fires, since — as shown above — there
    // is usually nothing left for it to do in this exact regime; that is
    // covered by the stall-based test instead.)
    const { timers, ctx, clock, met, restore } = harness(120);   // bar = 2.0s
    try {
        met.start();
        advance(ctx, timers, 3.95);              // running normally; bar 4.0 is
                                                   // 50ms out and, per the sweep
                                                   // above, already claimed by the
                                                   // background loop by this point
        assert.equal(ctx.oscillators.filter(o => o.started === 4).length, 1,
            'sanity: the running loop should have already scheduled the bar-line click');

        met.startCountIn(() => {});
        assert.equal(ctx.oscillators.filter(o => o.started === 4).length, 1,
            'startCountIn must not schedule a duplicate click at a bar line the running loop already claimed');

        advance(ctx, timers, 3.0);
        const times = ctx.oscillators.map(o => o.started).filter(t => t >= 3.5 && t <= 6.5);
        assert.deepEqual(times, [3.5, 4, 4.5, 5, 5.5, 6, 6.5],
            `expected an unbroken half-beat grid with no gap or duplicate, got ${times}`);
        met.stop();
    } finally { restore(); }
});

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

test('startCountIn schedules the first click synchronously when the bar line is inside the look-ahead window', () => {
    // The other count-in tests all call startCountIn when the bar line is well
    // outside the 100ms _scheduleAhead window, so a later async tick would have
    // produced the same result — they don't actually exercise the synchronous
    // _tick() call. This one puts the bar line 50ms out, inside the window, and
    // checks ctx.oscillators immediately after startCountIn returns, with no
    // runUntil/advance in between: only the synchronous tick could have
    // scheduled anything yet.
    const { ctx, clock, met, restore } = harness(120);   // bar = 2.0 s
    try {
        ctx.currentTime = 1.95;                 // next bar (2.0) is 50ms out
        const before = ctx.oscillators.length;
        met.startCountIn(() => {});
        const scheduled = ctx.oscillators.slice(before);
        assert.equal(scheduled.length, 1,
            'expected the first count-in click to be scheduled synchronously, before any timer fired');
        assert.equal(scheduled[0].started, 2.0,
            `expected the click scheduled at the bar line (2.0), got ${scheduled[0].started}`);
        met.stop();
    } finally { restore(); }
});

test('ensureEpoch is idempotent', () => {
    // Deliberately NOT using harness(): it calls clock.setEpoch(0) internally to
    // give every other test a known grid, which pre-anchors the epoch and makes
    // the "first call actually sets it" half of this test untestable. A fresh,
    // unanchored clock is needed here instead.
    const ctx = new FakeAudioContext();
    const clock = new MasterClock(ctx);
    assert.equal(clock.isAnchored, false, 'a fresh clock must start unanchored');
    ctx.currentTime = 5;
    clock.ensureEpoch();
    assert.equal(clock._epoch, 5);
    ctx.currentTime = 99;
    clock.ensureEpoch();
    assert.equal(clock._epoch, 5, 'a second call must not move the epoch');
    assert.equal(clock.isAnchored, true);
});
