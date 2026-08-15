import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, FakeTimers, makeBuffer, SRC } from './fakes.mjs';

test('src modules import under Node with no package.json', async () => {
    const { MasterClock } = await import(SRC + 'audio/MasterClock.js');
    const { Voice } = await import(SRC + 'audio/Voice.js');
    const { Player } = await import(SRC + 'automation/Player.js');
    assert.equal(typeof MasterClock, 'function');
    assert.equal(typeof Voice, 'function');
    assert.equal(typeof Player, 'function');
});

test('FakeAudioContext supports the nodes the engine constructs', () => {
    const ctx = new FakeAudioContext();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, 1.0);
    // .value is computed from the timeline at the CURRENT time, not snapped to
    // the last scheduled target. An event one second out has not happened yet.
    assert.equal(g.gain.value, 1, 'scheduled for t=1.0, not yet in effect at t=0');
    ctx.currentTime = 1.0;
    assert.equal(g.gain.value, 0.5, 'in effect once the clock reaches it');
    assert.equal(g.gain.events[0].method, 'setValueAtTime');

    // A ramp interpolates rather than jumping to its target.
    g.gain.linearRampToValueAtTime(0, 1.1);
    ctx.currentTime = 1.05;
    assert.ok(Math.abs(g.gain.value - 0.25) < 1e-9, `mid-ramp, got ${g.gain.value}`);
    const buf = makeBuffer(ctx, 2);
    assert.equal(buf.duration, 2);
    assert.equal(buf.sampleRate, 48000);
});

test('FakeTimers fires in time order and freeze() stops only rAF', () => {
    const t = new FakeTimers();
    const seen = [];
    t.setTimeout(() => seen.push('b'), 50);
    t.setTimeout(() => seen.push('a'), 10);
    t.requestAnimationFrame(() => seen.push('raf'));
    t.runUntil(100);
    assert.deepEqual(seen, ['a', 'raf', 'b']);

    const t2 = new FakeTimers();
    const seen2 = [];
    t2.freeze();
    t2.setTimeout(() => seen2.push('timeout'), 10);
    t2.requestAnimationFrame(() => seen2.push('raf'));
    t2.runUntil(100);
    assert.deepEqual(seen2, ['timeout']);
});
