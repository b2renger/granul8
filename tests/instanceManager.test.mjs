// instanceManager.test.mjs — Session-restore fallback for loop points.
// Covers Task 7 (C8): sessions saved before `loopBars` existed must keep working
// via the seconds-based `loopRange`, while newer sessions prefer the musical
// `loopBars` so a BPM change retimes rather than truncates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, SRC } from './fakes.mjs';

const { InstanceManager } = await import(SRC + 'state/InstanceManager.js');
const { AutomationLane } = await import(SRC + 'automation/AutomationLane.js');

function harness() {
    const ctx = new FakeAudioContext();
    const masterBus = { audioContext: ctx, masterGain: ctx.createGain(), clock: {} };
    const panel = { setFullState() {} };
    const waveform = {};
    const im = new InstanceManager(masterBus, panel, waveform);
    return { im };
}

/** A minimal valid session with one instance carrying the given `recording` fields. */
function sessionWith(recordingExtra) {
    const lane = new AutomationLane();
    lane.addEvent({ time: 0, voiceIndex: 0, type: 'start', params: { position: 0.5 } });
    lane.addEvent({ time: 1, voiceIndex: 0, type: 'stop' });
    return {
        granul8: true,
        version: 2,
        masterBpm: 120,
        activeInstanceId: 'inst-1',
        instances: [{
            id: 'inst-1',
            name: 'Sampler 1',
            recording: { lane: lane.toJSON(), ...recordingExtra },
        }],
    };
}

test('restoreFromSession prefers loopBars over loopRange when a session has both', async () => {
    const { im } = harness();
    const session = sessionWith({
        loopBars: { startBars: 0, lengthBars: 2 },
        loopRange: { start: 0, end: 4.0 },   // stale seconds value from before a BPM change
    });
    await im.restoreFromSession(session, null);
    const entry = im.instances.get('inst-1');
    assert.deepEqual(entry.player.getLoopBars(), { startBars: 0, lengthBars: 2 },
        'musical loop should win over the legacy seconds range');
});

test('restoreFromSession falls back to loopRange for sessions saved before loopBars existed', async () => {
    const { im } = harness();
    // Older sessions never wrote a `loopBars` key at all -- not present, not null.
    const session = sessionWith({ loopRange: { start: 0.5, end: 3.5 } });
    await im.restoreFromSession(session, null);
    const entry = im.instances.get('inst-1');
    assert.equal(entry.player.getLoopBars(), null,
        'no musical loop should be set from a legacy session');
    assert.deepEqual(entry.player.getLoopRange(), { start: 0.5, end: 3.5 },
        'the seconds-based loop must still be restored so the user does not lose their loop');
});

test('restoreFromSession restores takeBars — the stable denominator loop handles convert against', async () => {
    const { im } = harness();
    const session = sessionWith({
        loopBars: { startBars: 0, lengthBars: 2 },
        takeBars: 4,   // the take is 4 bars; the loop only covers the first 2
    });
    await im.restoreFromSession(session, null);
    const entry = im.instances.get('inst-1');
    assert.equal(entry.player.getTakeBars(), 4,
        'takeBars must round-trip independently of the (possibly narrower) loop window');
});

test('restoreFromSession falls back to loopBars\' own span for sessions saved before takeBars existed', async () => {
    const { im } = harness();
    // A session saved between Task 11's loopBars support and the takeBars fix: the
    // loop happened to span the whole take, so summing loopBars is the correct
    // fallback (per the task-11 fix report).
    const session = sessionWith({ loopBars: { startBars: 0, lengthBars: 3 } });
    await im.restoreFromSession(session, null);
    const entry = im.instances.get('inst-1');
    assert.equal(entry.player.getTakeBars(), 3,
        'takeBars should fall back to startBars + lengthBars when not separately saved');
});
