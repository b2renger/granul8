import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SRC } from './fakes.mjs';

const { fractionsToBarLoop, barLoopToFractions } = await import(SRC + 'utils/loopHandleMath.js');

test('fractionsToBarLoop converts fractions to whole bars against the given total', () => {
    assert.deepEqual(fractionsToBarLoop(0, 0.5, 4), { startBar: 0, lengthBars: 2 });
    assert.deepEqual(fractionsToBarLoop(0.5, 1, 4), { startBar: 2, lengthBars: 2 });
});

test('fractionsToBarLoop never produces a zero-length or inverted loop', () => {
    // Both handles dragged to (nearly) the same fraction.
    const { startBar, lengthBars } = fractionsToBarLoop(0.5, 0.5, 4);
    assert.ok(lengthBars >= 1, `lengthBars must be at least 1 bar, got ${lengthBars}`);
    assert.ok(startBar >= 0 && startBar + lengthBars <= 4, 'loop window must stay within the take');
});

test('barLoopToFractions is the inverse of fractionsToBarLoop for an in-range window', () => {
    const totalBars = 8;
    const { startFrac, endFrac } = barLoopToFractions(2, 3, totalBars);
    assert.equal(startFrac, 2 / 8);
    assert.equal(endFrac, 5 / 8);
});

test('a loop that does not span the whole take does not render its end handle pinned at 100%', () => {
    // Critical 2 (tab-switch sync): endFrac must reflect (startBars + lengthBars) /
    // takeBars, not be hardcoded to 1 -- a 4-bar loop inside an 8-bar take must show
    // its end handle at 50%, not 100%.
    const { startFrac, endFrac } = barLoopToFractions(0, 4, 8);
    assert.equal(startFrac, 0);
    assert.equal(endFrac, 0.5, `expected the end handle at 50% of an 8-bar take, got ${endFrac * 100}%`);
});

test('regression: deriving the fraction denominator from the CURRENT loop window collapses the loop toward the 1-bar floor', () => {
    // This reproduces the bug the original Task 11 brief introduced (Critical 2):
    // using the just-narrowed loop window's own length as the next conversion's
    // "total" feeds each call's OUTPUT back in as the NEXT call's denominator.
    // TransportBar fires onLoopRangeChange on every pointermove, so a real drag
    // does this dozens of times per gesture -- two calls are enough to show the
    // collapse toward the floor.
    let totalBars = 4;                                    // starting take length
    let result = fractionsToBarLoop(0, 0.55, totalBars);
    assert.equal(result.lengthBars, 2, 'sanity: first conversion at ~half the take');

    totalBars = result.lengthBars;                         // <- the bug: reusing the
                                                            //    shrunk window as the
                                                            //    next call's total
    result = fractionsToBarLoop(0, 0.55, totalBars);
    assert.equal(result.lengthBars, 1, 'the buggy denominator has already collapsed to the 1-bar floor');

    totalBars = result.lengthBars;
    result = fractionsToBarLoop(0, 0.55, totalBars);
    assert.equal(result.lengthBars, 1, 'and stays pinned there for the rest of the drag');
});

test('fix: a STABLE take-length denominator does not shrink across repeated drag events at the same fraction', () => {
    // Contrast with the regression above: main.js's onLoopRangeChange must derive
    // `totalBars` from Player.getTakeBars() (fixed for the whole take), never from
    // the current loop window. Simulating dozens of pointermove events at the same
    // fraction -- as a real drag would fire -- against a denominator that never
    // changes must leave the result unchanged every time.
    const takeBars = 4;
    let result;
    for (let i = 0; i < 20; i++) {
        result = fractionsToBarLoop(0, 0.55, takeBars);
    }
    assert.equal(result.lengthBars, 2, 'the loop length must stay derived from the stable take length');
});

// --- Seconds-based (non-loop-station) path ---------------------------------
//
// The bar path above got a stable denominator in task 11; the seconds path went
// on feeding `Player.getLoopableDuration()` -- the CURRENT loop window -- back
// into itself, and it is the worse of the two. In the bar path the snapped
// fractions are written back to the handles on every event, so the collapse is
// at least visible; in the seconds path `transport.setLoopRange` is only called
// inside the snap-to-grid branch, so with snap off the handles stay under the
// pointer while the loop silently collapses.

const { FakeAudioContext } = await import('./fakes.mjs');
const { Player } = await import(SRC + 'automation/Player.js');
const { Recorder } = await import(SRC + 'automation/Recorder.js');
const { AutomationLane } = await import(SRC + 'automation/AutomationLane.js');
const { fractionsToSecondsLoop, secondsLoopToFractions } = await import(SRC + 'utils/loopHandleMath.js');

/** One pointermove, as main.js's onLoopRangeChange seconds branch handles it. */
function dragEvent(player, startFrac, endFrac, duration) {
    if (duration <= 0) return;
    const { loopStart, loopEnd } = fractionsToSecondsLoop(startFrac, endFrac, duration);
    player.setLoopRange(loopStart, loopEnd);
}

/** A recorder holding an `n`-second take. */
function takeOf(ctx, seconds) {
    const rec = new Recorder(ctx);
    const l = new AutomationLane();
    l.addEvent({ time: 0, voiceIndex: 0, type: 'start', params: {} });
    l.addEvent({ time: seconds, voiceIndex: 0, type: 'stop' });
    rec.setRecording(l);
    return rec;
}

test('regression: using the CURRENT loop window as the seconds denominator collapses the loop under a stationary pointer', () => {
    // Reproduces main.js's pre-fix seconds branch verbatim against a real Player:
    //     const duration = player.getLoopableDuration() || recorder.getElapsedTime();
    //     player.setLoopRange(startFrac * duration, endFrac * duration);
    // TransportBar fires onLoopRangeChange on every pointermove with take-relative
    // fractions, so each event's OUTPUT became the next event's DENOMINATOR. A real
    // drag fires dozens; three are enough to show the direction of travel, and
    // endFrac = 1 / startFrac = 0 is the only fixed point, so it never widens back.
    const p = new Player(new FakeAudioContext());
    p.setLoopRange(0, 8.0);                       // an 8 s take, loop spanning it
    const ends = [];
    for (let i = 0; i < 3; i++) {
        const duration = p.getLoopableDuration(); // <- the self-feeding denominator
        dragEvent(p, 0, 0.75, duration);
        ends.push(+p.getLoopRange().end.toFixed(4));
    }
    assert.deepEqual(ends, [6, 4.5, 3.375],
        'the loop must be seen to collapse monotonically with the buggy denominator');
});

test('fix: the recorded take length is invariant under the drag it feeds, the loop window is not', () => {
    // This is the whole substance of the fix, stated against the two real objects
    // main.js reads: Recorder.getElapsedTime() (the take's own length, which
    // setLoopRange never touches) versus Player.getLoopableDuration() (the loop
    // window, which setLoopRange overwrites -- so it can never be a denominator).
    const ctx = new FakeAudioContext();
    const rec = takeOf(ctx, 8.0);
    const p = new Player(ctx);
    p.setLoopRange(0, 8.0);
    assert.equal(rec.getElapsedTime(), 8.0, 'sanity: an 8 s take');

    dragEvent(p, 0, 0.75, rec.getElapsedTime());
    assert.equal(rec.getElapsedTime(), 8.0,
        'the take length must survive the drag it just fed');
    assert.equal(p.getLoopableDuration(), 6.0,
        'while the loop window HAS moved — which is exactly why it cannot be the denominator');
});

test('fix: a stable take-length denominator holds the loop still for a whole drag', () => {
    const ctx = new FakeAudioContext();
    const rec = takeOf(ctx, 8.0);
    const p = new Player(ctx);
    p.setLoopRange(0, 8.0);
    // 40 pointermoves at one pointer position, as a real drag-and-hold produces.
    for (let i = 0; i < 40; i++) dragEvent(p, 0, 0.75, rec.getElapsedTime());
    assert.deepEqual(p.getLoopRange(), { start: 0, end: 6.0 },
        'the loop must stay where the pointer put it across the whole drag');
});

test('the drag mapping and the tab-switch redisplay are exact inverses through the one denominator', () => {
    // main.js:1324 divided by getLoopableDuration() while main.js:508 divided by
    // recorder.getElapsedTime(): two denominators for one mapping, so the handles
    // jumped on a tab switch even when the loop had not moved. Routing both through
    // one helper makes the round trip exact.
    const takeDuration = 8.0;
    const { loopStart, loopEnd } = fractionsToSecondsLoop(0.25, 0.75, takeDuration);
    assert.deepEqual({ loopStart, loopEnd }, { loopStart: 2.0, loopEnd: 6.0 });
    assert.deepEqual(secondsLoopToFractions(loopStart, loopEnd, takeDuration),
        { startFrac: 0.25, endFrac: 0.75 },
        'a tab switch must redraw the handles exactly where the drag left them');
});

test('secondsLoopToFractions treats an unset loop end as "the whole take" and clamps the rest', () => {
    // Player.setLoopRange(0, 0) means "loop the full recording"; the end handle
    // belongs at 100%, not at 0%. (Preserves the behaviour of the inline
    // expression this replaced.)
    assert.deepEqual(secondsLoopToFractions(0, 0, 8.0), { startFrac: 0, endFrac: 1 });
    // No take yet: extremes rather than NaN.
    assert.deepEqual(secondsLoopToFractions(0, 4, 0), { startFrac: 0, endFrac: 1 });
    // A loop end beyond the take must not push the handle off the end of the bar.
    assert.deepEqual(secondsLoopToFractions(0, 99, 8.0), { startFrac: 0, endFrac: 1 });
});
