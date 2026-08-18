import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, FakeTimers, install, makeBuffer, SRC } from './fakes.mjs';

const { Voice } = await import(SRC + 'audio/Voice.js');

function mkVoice(ctx) {
    const v = new Voice(0, ctx, ctx.createGain());
    v.setBuffer(makeBuffer(ctx, 5));
    return v;
}

test('re-triggering within the 30 ms release window does not leave the gain at zero', () => {
    const timers = new FakeTimers();
    const restore = install(timers);
    try {
        const ctx = new FakeAudioContext();
        const v = mkVoice(ctx);

        v.start({ position: 0.5, amplitude: 1 });
        v.setGainLevel(0.4);
        ctx.advance(0.5);

        v.stop();                       // schedules linearRamp(0, now + 0.03)
        ctx.advance(0.005);             // re-allocated 5 ms later
        v.start({ position: 0.5, amplitude: 1 });
        v.setGainLevel(0.4);

        const pending = v.gainNode.gain.pendingAfter(ctx.currentTime);
        const toZero = pending.filter(e => e.args[0] === 0);
        assert.equal(toZero.length, 0,
            'a ramp to 0 is still scheduled after the restart — the voice will be silent');
        v.stop();
    } finally { restore(); }
});

test('start() anchors the gain at its current value before any new ramp', () => {
    const ctx = new FakeAudioContext();
    const v = mkVoice(ctx);
    v.start({ position: 0.5 });
    const ev = v.gainNode.gain.events;
    const cancelIdx = ev.findIndex(e => e.method === 'cancelScheduledValues');
    const anchorIdx = ev.findIndex(e => e.method === 'setValueAtTime');
    assert.ok(cancelIdx >= 0, 'start() must cancel the previous timeline');
    assert.ok(anchorIdx > cancelIdx, 'and anchor the current value after cancelling');
    v.stop();
});

test('stop() ramps to zero over 30 ms', () => {
    const ctx = new FakeAudioContext();
    const v = mkVoice(ctx);
    v.start({ position: 0.5 });
    ctx.advance(1.0);
    v.stop();
    const ramp = v.gainNode.gain.events.filter(e => e.method === 'linearRampToValueAtTime').at(-1);
    assert.equal(ramp.args[0], 0);
    assert.ok(Math.abs(ramp.args[1] - 1.03) < 1e-9);
});
