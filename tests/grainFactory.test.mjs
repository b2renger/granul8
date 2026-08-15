import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, makeBuffer, SRC } from './fakes.mjs';

const { createGrain } = await import(SRC + 'audio/grainFactory.js');

function fire(ctx, buffer, overrides = {}) {
    const dest = ctx.createGain();
    const info = [];
    createGrain(ctx, buffer, {
        position: 0.0, amplitude: 1.0, duration: 0.4, interOnset: 0.1,
        pitch: 1.0, spread: 0, pan: 0, envelope: 'hann', adsr: null, ...overrides,
    }, dest, 10.0, (i) => info.push(i));
    const src = ctx.sources.at(-1);
    const gain = ctx.gains.at(-1);
    return { src, gain, info: info[0] };
}

test('at unity pitch, buffer span and wall-clock span agree', () => {
    const ctx = new FakeAudioContext();
    const { src, gain } = fire(ctx, makeBuffer(ctx, 5), { pitch: 1.0 });
    assert.equal(src.startArgs.duration, 0.4);           // buffer seconds consumed
    const curve = gain.gain.events.find(e => e.method === 'setValueCurveAtTime');
    assert.equal(curve.args[2], 0.4);                    // wall-clock envelope span
});

test('at pitch 2 the source consumes twice the buffer over the same wall clock', () => {
    const ctx = new FakeAudioContext();
    const { src, gain, info } = fire(ctx, makeBuffer(ctx, 5), { pitch: 2.0 });
    const curve = gain.gain.events.find(e => e.method === 'setValueCurveAtTime');
    assert.equal(curve.args[2], 0.4, 'envelope spans the requested wall-clock length');
    assert.equal(src.startArgs.duration, 0.8, 'source consumes 0.8 buffer-seconds');
    assert.ok(src.stopArgs >= 10.4, `stop must not truncate the envelope, got ${src.stopArgs}`);
    assert.equal(info.duration, 0.4, 'onGrain reports wall-clock duration');
});

test('at pitch 0.5 the source consumes half the buffer over the same wall clock', () => {
    const ctx = new FakeAudioContext();
    const { src, gain } = fire(ctx, makeBuffer(ctx, 5), { pitch: 0.5 });
    const curve = gain.gain.events.find(e => e.method === 'setValueCurveAtTime');
    assert.equal(curve.args[2], 0.4);
    assert.equal(src.startArgs.duration, 0.2);
});

test('near the buffer end the grain is shortened in wall clock, not over-read', () => {
    const ctx = new FakeAudioContext();
    // 5 s buffer, start at 4.9 s => 0.1 buffer-seconds left. At pitch 2 that is
    // 0.05 s of wall clock.
    const { src, gain } = fire(ctx, makeBuffer(ctx, 5), { pitch: 2.0, position: 0.98 });
    const curve = gain.gain.events.find(e => e.method === 'setValueCurveAtTime');
    assert.ok(Math.abs(curve.args[2] - 0.05) < 1e-9, `wall duration ${curve.args[2]}`);
    assert.ok(Math.abs(src.startArgs.duration - 0.1) < 1e-9, `buffer span ${src.startArgs.duration}`);
    assert.ok(src.startArgs.offset + src.startArgs.duration <= 5 + 1e-9, 'never reads past the end');
});

test('overlap attenuation uses wall-clock duration', () => {
    const ctx = new FakeAudioContext();
    // duration 0.4 wall, interOnset 0.1 => overlap 4 => scale 1/2 regardless of pitch.
    for (const pitch of [0.5, 1, 2]) {
        const c = new FakeAudioContext();
        const { gain } = fire(c, makeBuffer(c, 30), { pitch, duration: 0.4, interOnset: 0.1 });
        const curve = gain.gain.events.find(e => e.method === 'setValueCurveAtTime');
        const peak = Math.max(...curve.args[0]);
        assert.ok(Math.abs(peak - 0.5) < 0.01, `pitch ${pitch}: peak ${peak}, expected ~0.5`);
    }
});

test('sub-millisecond wall-clock grains are skipped', () => {
    const ctx = new FakeAudioContext();
    fire(ctx, makeBuffer(ctx, 5), { pitch: 4.0, duration: 0.0001 });
    assert.equal(ctx.sources.length, 0, 'no source created');
});
