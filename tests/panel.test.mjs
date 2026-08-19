// panel.test.mjs — Structure of the parameter panel.
//
// The panel was reorganised so each parameter owns its modifiers: a parameter's
// range sliders, its quantize toggle and subdivision, and its randomize toggle
// now sit in ONE .param-group. Before that, Grain Size had its range in "Sound
// Engine" and its quantize + subdivision + randomize up in "Rhythm and Harmony",
// so working on one parameter meant scrolling between two sections. Pan's
// randomize toggle lived under "Rhythm and Harmony" despite pan being neither.
//
// These are static assertions over index.html and style.css. They cannot prove a
// browser lays the panel out correctly; what they pin is that the grouping does
// not silently come apart again, and that no element id is lost in a move.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const cssRaw = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

const SOURCE_PATHS = [
    '../src/main.js',
    '../src/audio/GrainScheduler.js',
    '../src/audio/GranularEngine.js',
    '../src/audio/MasterBus.js',
    '../src/audio/MasterClock.js',
    '../src/audio/Metronome.js',
    '../src/audio/Voice.js',
    '../src/audio/envelopes.js',
    '../src/audio/grainFactory.js',
    '../src/automation/AutomationLane.js',
    '../src/automation/Player.js',
    '../src/automation/Recorder.js',
    '../src/input/PointerHandler.js',
    '../src/input/VoiceAllocator.js',
    '../src/state/InstanceManager.js',
    '../src/state/InstanceState.js',
    '../src/state/SessionPersistence.js',
    '../src/state/SessionSerializer.js',
    '../src/ui/ADSRWidget.js',
    '../src/ui/GhostRenderer.js',
    '../src/ui/GrainOverlay.js',
    '../src/ui/LevelMeter.js',
    '../src/ui/ParameterPanel.js',
    '../src/ui/TabBar.js',
    '../src/ui/TransportBar.js',
    '../src/ui/WaveformDisplay.js',
    '../src/ui/voiceColors.js',
    '../src/utils/fileLoader.js',
    '../src/utils/loopHandleMath.js',
    '../src/utils/math.js',
    '../src/utils/musicalQuantizer.js',
];
const SOURCES = await Promise.all(SOURCE_PATHS.map(async (rel) => ({
    rel,
    text: await readFile(new URL(rel, import.meta.url), 'utf8'),
})));
const panelSrc = await readFile(new URL('../src/ui/ParameterPanel.js', import.meta.url), 'utf8');

/** Every id in the document. A move must not drop one. */
function ids(doc) {
    return [...doc.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]).sort();
}

// Captured from the tree before the reorganisation. main.js and ParameterPanel.js
// reach for these by getElementById, and SessionSerializer persists values keyed
// off them, so a dropped or renamed id is a silent runtime break rather than a
// layout problem. 108 ids; the reorganisation moves markup and adds containers,
// so ids may be ADDED but never removed.
const IDS_BEFORE = `
adsr-canvas app arp-mode-group arp-steps-group arp-style-group arp-style-next
arp-style-prev arp-style-svg arp-type-group audio-unlock-overlay bar-count-selector beat-indicator
btn-loop btn-loop-station btn-metronome btn-overdub btn-play btn-record
btn-snap-grid btn-stop drop-overlay envelope-row file-controls file-input
level-meter load-sample-btn loop-end-handle loop-region loop-start-handle main-area
map-contact-size map-pressure map-velocity master-volume master-volume-control meter-contact-size
meter-pressure meter-velocity metronome-control metronome-volume param-arp-pattern param-arp-steps
param-arp-type param-bpm param-density-max param-density-min param-envelope param-grain-size-max
param-grain-size-min param-pan-max param-pan-min param-pitch-range param-root-note param-scale
param-spread-max param-spread-min param-volume parameter-panel pitch-range-group quantize-density
quantize-grain-size quantize-pitch random-density random-grain-size random-pan random-pitch
sample-name sample-select session-export-btn session-import-btn session-import-input status-contact-size
status-pressure status-velocity subdiv-density subdiv-grain-size tab-add tab-bar
tab-list tap-tempo tempo-control theme-toggle time-display time-sig-control
time-sig-den time-sig-num top-bar transport-bar transport-progress transport-progress-fill
unlock-btn unlock-title val-arp-steps val-arp-style val-bpm val-density-max
val-density-min val-grain-size-max val-grain-size-min val-master-volume val-pan-max val-pan-min
val-pitch-range val-spread-max val-spread-min val-volume waveform-canvas waveform-container
`.split(/\s+/).filter(Boolean);

test('no element id was lost in the reorganisation', () => {
    const present = new Set(ids(html));
    const missing = IDS_BEFORE.filter(id => !present.has(id));
    assert.deepEqual(missing, [],
        'these ids are reached by getElementById or persisted in sessions');
});

/** The innermost .param-group containing `id`, as raw markup. */
function groupContaining(id) {
    const at = html.indexOf(`id="${id}"`);
    if (at === -1) return null;
    // Walk back to the nearest opening .param-group tag...
    const before = html.slice(0, at);
    const open = before.lastIndexOf('<div class="param-group');
    if (open === -1) return null;
    // ...then forward, balancing <div> nesting, to its close.
    let depth = 0, i = open;
    const tag = /<\/?div\b/g;
    tag.lastIndex = open;
    let m;
    while ((m = tag.exec(html)) !== null) {
        depth += m[0] === '</div' ? -1 : 1;
        if (depth === 0) { i = m.index; break; }
    }
    return html.slice(open, i);
}

const OWNS = [
    ['grain-size', 'param-grain-size-min', ['quantize-grain-size', 'subdiv-grain-size', 'random-grain-size']],
    ['density',    'param-density-min',    ['quantize-density', 'subdiv-density', 'random-density']],
    ['pan',        'param-pan-min',        ['random-pan']],
];

for (const [name, anchor, modifiers] of OWNS) {
    test(`${name}'s modifiers live in the same group as its sliders`, () => {
        const group = groupContaining(anchor);
        assert.ok(group, `no .param-group found around ${anchor}`);
        for (const mod of modifiers) {
            assert.ok(group.includes(`id="${mod}"`),
                `${mod} is outside ${name}'s group — this is the split that made you ` +
                `scroll between two sections to adjust one parameter`);
        }
    });
}

test('pitch keeps its modifiers too, and they stay out of the engine groups', () => {
    const group = groupContaining('quantize-pitch');
    assert.ok(group, 'no .param-group around quantize-pitch');
    assert.ok(group.includes('id="random-pitch"'),
        'quantize and randomize pitch belong together');
    // Pitch has no min/max range: it comes from the pad's Y axis.
    assert.ok(!/param-pitch-(min|max)/.test(html),
        'pitch has no range sliders; it is the Y axis');
});

test('an irrelevant control is disabled, never merely un-clickable', () => {
    // param-inactive and range-row-inactive were `opacity: 0.35; pointer-events:
    // none`. That is mouse-only: a dimmed Root Note stayed in the tab order,
    // focusable, announced as active, and changeable with the arrow keys. The
    // dimming may stay; blocking interaction must go through the disabled
    // attribute so keyboard and screen readers agree with what is on screen.
    // range-row-inactive is gone: the MIN row is hidden rather than dimmed, so
    // nothing applied it any more and a rule nobody applies is a rule the next
    // reader has to disprove.
    // Every matching rule, not just the first: slicing only the first let a
    // duplicate selector carrying pointer-events: none straight through. And the
    // test is named for `disabled`, so it now actually asserts that the source
    // sets it rather than only that the CSS does not block the mouse.
    let checked = 0;
    for (let at = css.indexOf('.param-inactive'); at !== -1; at = css.indexOf('.param-inactive', at + 1)) {
        const block = css.slice(css.lastIndexOf('}', at) + 1, css.indexOf('}', at) + 1);
        if (!block.includes('.param-inactive')) continue;
        checked++;
        assert.ok(!/pointer-events:\s*none/.test(block),
            'a .param-inactive rule uses pointer-events: none, which blocks the ' +
            'mouse and nothing else — the control stays operable by keyboard ' +
            'while looking inert');
    }
    assert.ok(checked > 0, 'no .param-inactive rule found');

    const rowAt = css.indexOf('.range-row-solo');
    assert.notEqual(rowAt, -1, 'the solo-row rule is gone; the MIN row hiding has changed');

    // The mechanism that actually takes the control out of reach.
    assert.match(panelSrc, /\.disabled = /,
        'ParameterPanel never sets .disabled, so nothing but opacity conveys inactive');
});

test('every id the source reaches for by getElementById exists in the markup', () => {
    // The strongest guard on a markup move. The id-snapshot test above catches a
    // DELETED id; this catches the other direction — code asking for something the
    // markup never had, or had under another name. Together they pin the contract
    // between index.html and the modules that query it.
    const present = new Set(ids(html));
    const wanted = new Set();
    for (const file of SOURCES) {
        for (const m of file.text.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) {
            wanted.add(m[1]);
        }
    }
    assert.ok(wanted.size > 50, `sanity: only ${wanted.size} ids queried`);
    const dangling = [...wanted].filter(id => !present.has(id)).sort();
    assert.deepEqual(dangling, [],
        'these are queried by getElementById but do not exist in index.html');
});

test('the stylesheet carries no rule for a class the markup no longer uses', () => {
    // Scoped to the classes this reorganisation retired, not the whole stylesheet:
    // a general dead-class sweep would flag classes applied from JS by classList,
    // and would fail for the wrong reason.
    for (const cls of ['quantize-toggles', 'toggle-row']) {
        assert.ok(!html.includes(`class="${cls}`) && !html.includes(` ${cls}"`),
            `${cls} is still used in the markup — this test has the wrong premise`);
        assert.ok(!new RegExp('\\.' + cls + '\\s*\\{').test(css),
            `.${cls} still has a rule but nothing uses the class any more`);
    }
});
