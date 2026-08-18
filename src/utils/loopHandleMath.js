// loopHandleMath.js — Pure fraction <-> whole-bar conversions for the loop-handle UI.
//
// Both transport.onLoopRangeChange (drag) and the tab-switch handle sync need to
// convert between drag-handle fractions (0..1 across the visible progress bar)
// and a whole-bar loop window. The denominator passed in as `totalBars` MUST be
// the take's total length in bars (Player.getTakeBars()) -- a value that stays
// fixed for the whole take -- and never the CURRENT loop window's length
// (Player.getLoopableDuration() / getLoopBars()). The window shrinks every time
// the loop is narrowed, and TransportBar fires onLoopRangeChange on every
// pointermove during a drag: feeding the shrunk window back in as the next
// call's total collapses the loop toward the 1-bar floor after a handful of
// events, silently reintroducing the bug Task 11 exists to fix.

/**
 * Convert loop-handle fractions to a whole-bar loop window.
 * @param {number} startFrac
 * @param {number} endFrac
 * @param {number} totalBars - The take's total length in bars (STABLE denominator).
 * @returns {{ startBar: number, lengthBars: number }}
 */
export function fractionsToBarLoop(startFrac, endFrac, totalBars) {
    const bars = Math.max(1, totalBars);
    const startBar = Math.max(0, Math.min(bars - 1, Math.round(startFrac * bars)));
    const endBar = Math.max(startBar + 1, Math.min(bars, Math.round(endFrac * bars)));
    return { startBar, lengthBars: endBar - startBar };
}

/**
 * Convert a whole-bar loop window back to handle fractions.
 * @param {number} startBar
 * @param {number} lengthBars
 * @param {number} totalBars - The take's total length in bars (STABLE denominator).
 * @returns {{ startFrac: number, endFrac: number }}
 */
export function barLoopToFractions(startBar, lengthBars, totalBars) {
    const bars = Math.max(1, totalBars);
    return {
        startFrac: startBar / bars,
        endFrac: (startBar + lengthBars) / bars,
    };
}

// --- Seconds-based (non-loop-station) loop windows --------------------------
//
// Same rule, same reason: `takeDuration` MUST be the recorded take's own length
// (Recorder.getElapsedTime(), which is the lane's duration once recording has
// stopped and which setLoopRange() never touches) and never
// Player.getLoopableDuration(). getLoopableDuration() reports the CURRENT loop
// window, and the loop-handle drag writes that window back via setLoopRange()
// on every pointermove -- so using it makes each event's output the next event's
// denominator, and an 8 s loop held at endFrac 0.75 collapses 8 -> 6 -> 4.5 ->
// 3.375 -> ... monotonically. endFrac = 1 with startFrac = 0 is the only fixed
// point, so it can never widen back. It is worse than the bar-path variant: the
// seconds path only writes the handles back inside the snap-to-grid branch, so
// with snap off the handles sit still under the pointer while the loop collapses.

/**
 * Convert loop-handle fractions to a seconds loop window.
 * @param {number} startFrac
 * @param {number} endFrac
 * @param {number} takeDuration - The take's total length in seconds (STABLE).
 * @returns {{ loopStart: number, loopEnd: number }}
 */
export function fractionsToSecondsLoop(startFrac, endFrac, takeDuration) {
    const total = Math.max(0, takeDuration);
    return { loopStart: startFrac * total, loopEnd: endFrac * total };
}

/**
 * Convert a seconds loop window back to handle fractions — the inverse the
 * tab-switch redisplay needs. Must be fed the same `takeDuration` the drag used,
 * or the handles jump when the user switches tabs.
 * @param {number} loopStart
 * @param {number} loopEnd - 0 means "the whole take" (Player.setLoopRange(0, 0)).
 * @param {number} takeDuration - The take's total length in seconds (STABLE).
 * @returns {{ startFrac: number, endFrac: number }}
 */
export function secondsLoopToFractions(loopStart, loopEnd, takeDuration) {
    if (!(takeDuration > 0)) return { startFrac: 0, endFrac: 1 };
    const clamp = (v) => Math.max(0, Math.min(1, v));
    return {
        startFrac: clamp(loopStart / takeDuration),
        endFrac: loopEnd > 0 ? clamp(loopEnd / takeDuration) : 1,
    };
}
