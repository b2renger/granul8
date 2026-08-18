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
