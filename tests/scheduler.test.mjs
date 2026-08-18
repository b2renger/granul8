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

        // LOWER BOUND. Every assertion above is an upper bound, and a scheduler
        // that DIES at the stall satisfies all of them: `scheduled` is empty, so
        // `<= 256` holds, no grain is in the past, and `beforeStall > 0` was
        // measured before the stall ever happened. Delete GrainScheduler._tick's
        // closing `this._timerId = setTimeout(() => this._tick(), this.timerInterval);`
        // to see it — start() still drives one synchronous tick, so beforeStall
        // stays healthy while nothing at all is scheduled afterwards.
        // At 5 ms inter-onset the first tick after the stall fills the 100 ms
        // look-ahead window on its own (0.1 / 0.005 = 20 grains); 26 are observed
        // across the 50 ms run.
        assert.ok(scheduled.length >= 10,
            `the scheduler must resume after the stall, got ${scheduled.length} grains`);
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
