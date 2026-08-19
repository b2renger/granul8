// arpeggiator.test.mjs — The five play modes, the ping-pong tail, and the gate.
//
// These are pure index maths over a step count, which is the whole reason they
// live in musicalQuantizer rather than in Voice: the ordering is the part worth
// pinning, and it is testable without an AudioContext.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SRC } from './fakes.mjs';

const { buildArpSequence, applyPingPong, ARP_MODES } =
    await import(SRC + 'utils/musicalQuantizer.js');

test('up walks the notes low to high', () => {
    assert.deepEqual(buildArpSequence(4, 'up'), [0, 1, 2, 3]);
    assert.deepEqual(buildArpSequence(3, 'up'), [0, 1, 2]);
});

test('down walks them high to low', () => {
    assert.deepEqual(buildArpSequence(4, 'down'), [3, 2, 1, 0]);
    assert.deepEqual(buildArpSequence(5, 'down'), [4, 3, 2, 1, 0]);
});

test('outside-in alternates the extremes, closing on the middle', () => {
    assert.deepEqual(buildArpSequence(4, 'outsideIn'), [0, 3, 1, 2]);
    // Odd counts finish on the true centre rather than doubling it.
    assert.deepEqual(buildArpSequence(5, 'outsideIn'), [0, 4, 1, 3, 2]);
});

test('inside-out is outside-in reversed, opening from the middle', () => {
    assert.deepEqual(buildArpSequence(4, 'insideOut'), [2, 1, 3, 0]);
    assert.deepEqual(buildArpSequence(5, 'insideOut'), [2, 3, 1, 4, 0]);
});

test('every mode visits every step exactly once', () => {
    // The property that makes these arpeggios rather than arbitrary walks: an
    // ordering, not a selection. A mode that dropped or repeated a note would
    // still "work" and would quietly change which notes you hear.
    for (const mode of ARP_MODES.map(m => m.value)) {
        if (mode === 'random') continue;      // random is a per-step choice, not an ordering
        for (const n of [2, 3, 4, 5, 6]) {
            const seq = buildArpSequence(n, mode);
            assert.equal(seq.length, n, `${mode} at ${n} steps produced ${seq.length}`);
            assert.deepEqual([...seq].sort((a, b) => a - b), [...Array(n).keys()],
                `${mode} at ${n} steps is not a permutation of 0..${n - 1}`);
        }
    }
});

test('random is reported as a per-step choice, not a fixed order', () => {
    // Voice picks per grain for this mode; returning a shuffled array would fix
    // one order for the life of the take, which is not what "random" means here.
    assert.equal(buildArpSequence(4, 'random'), null);
});

test('an unknown mode falls back to up rather than emptying the sequence', () => {
    // A sequence of [] would silence the arpeggiator outright, which is a much
    // worse failure than the wrong order for a value that should not occur.
    assert.deepEqual(buildArpSequence(4, 'nonsense'), [0, 1, 2, 3]);
});

test('ping-pong comes back down without repeating either endpoint', () => {
    // [0,1,2,3] -> up then back: 3 and 0 must not sound twice in a row across
    // the cycle boundary, or the turnaround stutters.
    assert.deepEqual(applyPingPong([0, 1, 2, 3]), [0, 1, 2, 3, 2, 1]);
    assert.deepEqual(applyPingPong([0, 1, 2]), [0, 1, 2, 1]);
});

test('ping-pong on a one or two note sequence is a no-op', () => {
    // Nothing to bounce between: [0,1] would become [0,1] anyway, and returning
    // [0,1,0] would double the low note every cycle.
    assert.deepEqual(applyPingPong([0]), [0]);
    assert.deepEqual(applyPingPong([0, 1]), [0, 1]);
});

test('ping-pong preserves the mode it is applied to', () => {
    assert.deepEqual(applyPingPong(buildArpSequence(4, 'down')), [3, 2, 1, 0, 1, 2]);
    assert.deepEqual(applyPingPong(buildArpSequence(4, 'outsideIn')), [0, 3, 1, 2, 1, 3]);
});

test('ARP_MODES lists exactly the five modes, each with a label', () => {
    assert.deepEqual(ARP_MODES.map(m => m.value),
        ['up', 'down', 'outsideIn', 'insideOut', 'random']);
    for (const m of ARP_MODES) {
        assert.ok(m.label && m.label.length > 0, `${m.value} has no label`);
    }
});

// --- The gate and random mode, as Voice actually applies them ----------------

const { FakeAudioContext, FakeTimers, install, makeBuffer } = await import('./fakes.mjs');
const { Voice } = await import(SRC + 'audio/Voice.js');

/**
 * Fire `n` grains and return the playbackRate each one was given.
 *
 * Fake timers are installed for the duration: Voice.start() arms a real
 * setTimeout for its scheduler, which keeps Node's event loop alive after the
 * assertions pass and hangs the run rather than failing it.
 */
function grainRates(pitchQuantize, n) {
    const timers = new FakeTimers();
    const restore = install(timers);
    try {
        const ctx = new FakeAudioContext();
        const v = new Voice(0, ctx, ctx.createGain());
        v.setBuffer(makeBuffer(ctx, 5));
        v.start({ position: 0.5, amplitude: 0.8, pitch: 1, grainSize: 0.05,
                  interOnset: 0.03, spread: 0, pan: 0, envelope: 'hann', pitchQuantize });
        const before = ctx.sources.length;
        for (let i = 0; i < n; i++) v._onScheduleGrain(ctx.currentTime + 0.01 * i);
        const rates = ctx.sources.slice(before).map(s => s.playbackRate.value);
        v.stop();
        return rates;
    } finally { restore(); }
}

const NOTES = [0, 4, 7, 12];   // semitones; distinct rates, so order is readable

test('the arpeggiator walks its sequence and repeats it', () => {
    const rates = grainRates({ arpNotes: NOTES, arpSequence: [0, 1, 2, 3] }, 8);
    assert.equal(rates.length, 8, 'every step should sound with no gate set');
    assert.deepEqual(rates.slice(4), rates.slice(0, 4), 'the cycle repeats');
});

test('probability 1 plays every step — the default must not thin anything', () => {
    const rates = grainRates({ arpNotes: NOTES, arpSequence: [0, 1, 2, 3], arpProbability: 1 }, 40);
    assert.equal(rates.length, 40);
});

test('probability 0 silences every step without stopping the voice', () => {
    const rates = grainRates({ arpNotes: NOTES, arpSequence: [0, 1, 2, 3], arpProbability: 0 }, 20);
    assert.equal(rates.length, 0);
});

test('a gated step is skipped, not delayed — the pattern keeps its phase', () => {
    // The step counter must advance even when the gate silences the grain. If it
    // did not, gating would not thin the pattern, it would SLOW it: the same
    // notes in the same order, just further apart. Forced deterministic by
    // stubbing Math.random to gate exactly the even steps.
    const realRandom = Math.random;
    let call = 0;
    // First call per grain is the gate; alternate pass/fail.
    Math.random = () => (call++ % 2 === 0 ? 0.99 : 0.0);
    try {
        const rates = grainRates(
            { arpNotes: NOTES, arpSequence: [0, 1, 2, 3], arpProbability: 0.5 }, 8);
        // Gate fails on steps 0, 2, 4, 6 (random 0.99 >= 0.5), so steps 1, 3, 5, 7
        // sound — which is sequence positions 1, 3, 1, 3, i.e. notes 4 and 12.
        assert.deepEqual(rates.length, 4, `expected 4 of 8 steps to sound, got ${rates.length}`);
        const semitoneOf = (rate) => Math.round(12 * Math.log2(rate));
        assert.deepEqual(rates.map(semitoneOf), [4, 12, 4, 12],
            'the surviving steps must be the ones the sequence would have reached ' +
            'at those positions — proof the counter advanced through the silences');
    } finally { Math.random = realRandom; }
});

test('random mode picks per grain instead of walking a fixed order', () => {
    // A null sequence is the signal. Over many grains every note should appear;
    // a fixed shuffle would produce a repeating cycle instead.
    const rates = grainRates({ arpNotes: NOTES, arpSequence: null }, 200);
    assert.equal(rates.length, 200, 'random mode must not gate anything by itself');
    const distinct = new Set(rates.map(r => Math.round(12 * Math.log2(r))));
    assert.deepEqual([...distinct].sort((a, b) => a - b), NOTES,
        'every note should be reachable');
    const firstCycle = rates.slice(0, 4).join();
    const repeats = [1, 2, 3, 4].every(k => rates.slice(k * 4, k * 4 + 4).join() === firstCycle);
    assert.ok(!repeats, 'random mode produced a repeating 4-step cycle');
});

test('random mode is still gated by probability', () => {
    const rates = grainRates({ arpNotes: NOTES, arpSequence: null, arpProbability: 0 }, 20);
    assert.equal(rates.length, 0);
});

// --- Session round trip -----------------------------------------------------

const { InstanceState } = await import(SRC + 'state/InstanceState.js');

test('the arp settings survive a session round trip', () => {
    const st = new InstanceState('a', 'Sampler 1');
    st.arpMode = 'outsideIn';
    st.arpPingPong = true;
    st.arpProbability = 0.4;

    const back = InstanceState.fromJSON(JSON.parse(JSON.stringify(st.toJSON())));
    assert.equal(back.arpMode, 'outsideIn');
    assert.equal(back.arpPingPong, true);
    assert.equal(back.arpProbability, 0.4);
});

test('a fresh instance plays every note in order — the defaults are not a filter', () => {
    // A gate defaulting to anything below 1, or a mode defaulting to random,
    // would mean switching the arpeggiator on quietly started dropping or
    // reordering notes with nothing on screen having asked for it.
    const st = new InstanceState('a', 'Sampler 1');
    assert.equal(st.arpProbability, 1);
    assert.equal(st.arpMode, 'up');
    assert.equal(st.arpPingPong, false);
});
