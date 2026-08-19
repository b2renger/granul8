import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, makeBuffer, SRC } from './fakes.mjs';

const { Recorder } = await import(SRC + 'automation/Recorder.js');
const { Voice } = await import(SRC + 'audio/Voice.js');

/** A resolveParams()-shaped object with modulation active. */
const RESOLVED = {
    position: 0.4, amplitude: 0.8, pitch: 1.5, grainSize: 0.05, interOnset: 0.03,
    spread: 0.1, pan: 0, envelope: 'hann', adsr: { a: 0.2, d: 0.15, s: 0.7, r: 0.2 },
    randomize: { grainSize: [0.2, 0.8], pitch: [-2, 2], pan: [-1, 1] },
    interOnsetRange: [0.2, 0.7],
    interOnsetQuantize: { bpm: 120, divisor: 8 },
    grainSizeQuantize: { bpm: 120, divisor: 4 },
    pitchQuantize: { arpNotes: [0, 4, 7, 12], arpSequence: [0, 2, 1, 3] },
};

test('a start event carries the modulation config', () => {
    const ctx = new FakeAudioContext();
    const r = new Recorder(ctx);
    r.startRecording();
    r.captureStart(0, RESOLVED);
    const e = r.getRecording().events[0];
    assert.deepEqual(e.params.randomize, RESOLVED.randomize);
    assert.deepEqual(e.params.pitchQuantize, RESOLVED.pitchQuantize);
    assert.deepEqual(e.params.grainSizeQuantize, RESOLVED.grainSizeQuantize);
    assert.deepEqual(e.params.interOnsetQuantize, RESOLVED.interOnsetQuantize);
    assert.deepEqual(e.params.interOnsetRange, RESOLVED.interOnsetRange);
});

test('move events stay small — scalars only', () => {
    const ctx = new FakeAudioContext();
    const r = new Recorder(ctx);
    r.startRecording();
    r.captureStart(0, RESOLVED);
    ctx.advance(0.1);
    r.captureMove(0, RESOLVED);
    const move = r.getRecording().events.at(-1);
    assert.equal(move.type, 'move');
    assert.equal(move.params.pitchQuantize, undefined, 'the heavy arp table must not repeat per move');
    assert.equal(move.params.position, 0.4, 'scalars are still captured');
});

test('the lane round-trips modulation through JSON', () => {
    const ctx = new FakeAudioContext();
    const r = new Recorder(ctx);
    r.startRecording();
    r.captureStart(0, RESOLVED);
    const json = JSON.parse(JSON.stringify(r.getRecording().toJSON()));
    assert.deepEqual(json.events[0].params.pitchQuantize, RESOLVED.pitchQuantize);
});

test('Voice.start resets modulation so behaviour never depends on slot history', () => {
    const ctx = new FakeAudioContext();
    const v = new Voice(0, ctx, ctx.createGain());
    v.setBuffer(makeBuffer(ctx, 5));

    v.start(RESOLVED);                       // slot is now "warm" with an arp
    assert.ok(v.pitchQuantize !== null);
    v.stop();

    // A later gesture with no modulation must not inherit the arp. `interOnset` is
    // deliberately omitted here: Voice.update() calls scheduler.setInterOnset()
    // whenever `interOnset` is defined, and that method clears interOnsetRange as a
    // side effect — which would mask whether Voice.start()'s own reset line ever
    // ran. Omitting it means the reset line is the only thing that can clear
    // scheduler.interOnsetRange in this test.
    v.start({ position: 0.5, amplitude: 0.8, pitch: 1, grainSize: 0.05 });
    assert.equal(v.pitchQuantize, null, 'stale pitchQuantize inherited from the previous gesture');
    assert.deepEqual(v.randomize, { grainSize: null, pitch: null, pan: null });
    assert.equal(v.grainSizeQuantize, null);
    assert.equal(v.scheduler.quantizeBpm, null);
    assert.equal(v.scheduler.quantizeDivisor, null);
    assert.equal(v.scheduler.interOnsetRange, null, 'stale interOnsetRange inherited from the previous gesture');
    v.stop();
});

test('stopRecording during overdub closes out a held voice with the correct merged voice index', () => {
    const ctx = new FakeAudioContext();
    const r = new Recorder(ctx);

    // Base pass: voice 0 starts and stops cleanly.
    r.startRecording();
    r.captureStart(0, RESOLVED);
    ctx.advance(1.0);
    r.captureStop(0);
    r.stopRecording();

    // Overdub pass: voice 0 within the overdub lane is left held when overdub
    // recording stops. stopRecording() must synthesize its stop into the overdub
    // lane *before* AutomationLane.merge() offsets overdub voice indexes past the
    // base lane's highest index — otherwise the synthesized stop targets the wrong
    // voice (or the pre-offset one) after merge.
    r.startOverdub(ctx.currentTime);
    r.captureStart(0, RESOLVED);
    ctx.advance(0.5);
    r.stopRecording();

    const merged = r.getRecording().events;
    const heldVoiceStop = merged.find(e => e.type === 'stop' && Math.abs(e.time - 0.5) < 1e-9);
    assert.ok(heldVoiceStop, 'the held overdub voice never got a synthesized stop after merge');
    assert.equal(heldVoiceStop.voiceIndex, 1,
        'synthesized stop must carry the post-merge voice index (1), not the pre-merge overdub index (0)');
});

test('stopRecording emits stops for voices still held', () => {
    const ctx = new FakeAudioContext();
    const r = new Recorder(ctx);
    r.startRecording();
    r.captureStart(0, RESOLVED);
    r.captureStart(1, RESOLVED);
    ctx.advance(2.0);
    r.captureStop(1);
    r.stopRecording();

    const stops = r.getRecording().events.filter(e => e.type === 'stop');
    const stopped = new Set(stops.map(e => e.voiceIndex));
    assert.ok(stopped.has(0), 'voice 0 was never released — it would sustain forever on playback');
    assert.ok(stopped.has(1));
});

test('starting a new take does not destroy the previous one', () => {
    // Record and Play are adjacent 44px squares in the transport. startRecording
    // cleared the lane AND cleared _undoSnapshot, so a mis-hit destroyed a
    // multi-pass loop permanently, mid-set, with no way back. Overdub already
    // snapshotted; a new take is the more destructive of the two and did not.
    const ctx = new FakeAudioContext();
    const r = new Recorder(ctx);
    r.startRecording();
    r.captureStart(0, RESOLVED);
    ctx.advance(1);
    r.captureStop(0);
    r.stopRecording();
    const takeOne = r.getRecording().length;
    assert.ok(takeOne > 0, `sanity: the first take recorded ${takeOne} events`);

    r.startRecording();
    r.stopRecording();
    assert.equal(r.getRecording().length, 0, 'sanity: the new take is empty');
    assert.equal(r.canUndo, true, 'the destroyed take must be recoverable');

    assert.ok(r.undo(), 'undo reports success by returning the caller context');
    assert.equal(r.getRecording().length, takeOne, 'undo restores the destroyed take');
});

test('undo on a first take with nothing behind it is a no-op, not a crash', () => {
    const ctx = new FakeAudioContext();
    const r = new Recorder(ctx);
    r.startRecording();
    assert.equal(r.canUndo, false, 'there is nothing to go back to');
    assert.equal(r.undo(), null, 'null distinguishes "nothing to undo" from a context of {}');
});

test('undo is available after an overdub too, and undoOverdub still works', () => {
    // undoOverdub is the existing public name; renaming it outright would break
    // any caller that has not been updated in the same commit.
    const ctx = new FakeAudioContext();
    const r = new Recorder(ctx);
    r.startRecording();
    r.captureStart(0, RESOLVED);
    ctx.advance(1);
    r.captureStop(0);
    r.stopRecording();
    const before = r.getRecording().length;

    r.startOverdub(ctx.currentTime);
    r.captureStart(1, RESOLVED);
    ctx.advance(0.5);
    r.captureStop(1);
    r.stopRecording();
    assert.ok(r.getRecording().length > before, 'sanity: the overdub added events');

    assert.equal(r.canUndo, true);
    assert.ok(r.undoOverdub(), 'the old name must keep working');
    assert.equal(r.getRecording().length, before);
});

test('undo hands back the context the caller stored with the take', () => {
    // Loop geometry lives on the Player, not here, so restoring the lane alone
    // left a recovered 4-bar take looping over the 2 bars of the take that
    // replaced it — bars 3 and 4 silently never heard. The caller threads its own
    // state through the same snapshot rather than keeping a second one in sync.
    const ctx = new FakeAudioContext();
    const r = new Recorder(ctx);
    r.startRecording();
    r.captureStart(0, RESOLVED);
    ctx.advance(1);
    r.captureStop(0);
    r.stopRecording();

    // The second take replaces the first, and says what the first was set up as.
    r.startRecording(undefined, { loopBars: { startBars: 0, lengthBars: 4 }, takeBars: 4 });
    r.stopRecording();

    const restored = r.undo();
    assert.deepEqual(restored, { loopBars: { startBars: 0, lengthBars: 4 }, takeBars: 4 },
        'the geometry of the take being restored comes back with it');
});

test('a take recorded without a context still undoes cleanly', () => {
    const ctx = new FakeAudioContext();
    const r = new Recorder(ctx);
    r.startRecording();
    r.captureStart(0, RESOLVED);
    ctx.advance(1);
    r.captureStop(0);
    r.stopRecording();
    const n = r.getRecording().length;

    r.startRecording();
    r.stopRecording();
    assert.deepEqual(r.undo(), {}, 'no context given, so an empty one comes back — not null');
    assert.equal(r.getRecording().length, n);
});
