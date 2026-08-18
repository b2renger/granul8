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
