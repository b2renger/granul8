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
