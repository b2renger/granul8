// a11y.test.mjs — Static assertions over index.html and style.css.
//
// These read the shipped markup and stylesheet as text. That is a real limit:
// they prove a rule EXISTS, not that a browser applies it to the element you
// meant. The keyboard walk itself is a human check (see the task report). What
// they do catch is the whole class of regression where somebody reinstates
// `display: none` on a control or adds a slider with no accessible name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

// Comments are stripped before anything is matched. Several assertions here are
// about the ABSENCE of a declaration, and a comment recording what was removed
// ("the rgba(18,17,15) that was here...") would otherwise fail the very test
// that motivated writing it down. A comment is not a declaration.
const cssRaw = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

test('no interactive control is removed from the tab order with display:none', () => {
    // .toggle-label input[type="checkbox"] { display: none } took seven
    // quantize/randomize switches out of both the tab order and the
    // accessibility tree -- including the ones that enable the initially
    // disabled subdivision selects beside them, so those were unreachable too.
    const rule = /\.toggle-label\s+input\[type="checkbox"\]\s*\{[^}]*\}/s.exec(css);
    assert.ok(rule, 'the toggle checkbox rule should still exist');
    assert.ok(!/display:\s*none/.test(rule[0]),
        'display:none removes the checkbox from the tab order and the a11y tree; ' +
        'clip it instead so it stays focusable');
});

/** Spans of every `<label ...>...</label>` in the document, for implicit naming. */
function labelSpans(doc) {
    const spans = [];
    const re = /<label\b[^>]*>/g;
    let m;
    while ((m = re.exec(doc)) !== null) {
        const close = doc.indexOf('</label>', m.index);
        if (close !== -1) spans.push([m.index, close]);
    }
    return spans;
}

test('every range and select input has an accessible name', () => {
    // A control wrapped in <label>text</label> is named implicitly and needs no
    // `for` and no aria-label -- which is how the seven checkboxes are written.
    // Checking only for <label for="..."> would flag all seven as anonymous and
    // send someone off to "fix" markup that is already correct.
    const spans = labelSpans(html);
    const wrapped = (at) => spans.some(([s, e]) => at > s && at < e);

    const controls = [...html.matchAll(/<(input|select)\b[^>]*\bid="([^"]+)"[^>]*>/g)]
        .filter(m => !/type="(hidden|file)"/.test(m[0]) && !/\bhidden\b/.test(m[0]))
        .map(m => ({ tag: m[1], id: m[2], raw: m[0], at: m.index }));
    assert.ok(controls.length > 15, `sanity: found only ${controls.length} controls`);

    const forAttr = new Set([...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map(m => m[1]));
    const unnamed = controls.filter(c =>
        !forAttr.has(c.id) &&
        !/aria-label=/.test(c.raw) &&
        !/aria-labelledby=/.test(c.raw) &&
        !wrapped(c.at)
    );
    assert.deepEqual(unnamed.map(c => c.id), [],
        'these controls are announced as anonymous sliders/selects');
});

test('a focus indicator is designed', () => {
    assert.ok(/:focus-visible/.test(css), 'no :focus-visible rule anywhere in the stylesheet');
});

test('pinch zoom is not blocked', () => {
    const vp = /<meta name="viewport"[^>]*>/.exec(html)[0];
    assert.ok(!/user-scalable\s*=\s*no/.test(vp),
        'user-scalable=no is a WCAG 1.4.4 failure on a UI whose smallest type is 4.5px');
});

// --- The focus ring has to be visible in BOTH themes -----------------------
//
// This assertion is here because the plan's own proposal failed it. Both of its
// focus rules used var(--accent), and the light theme's accent (#c47a4a) reaches
// only 2.46:1 against --bg-surface -- below the 3:1 that WCAG 1.4.11 requires of
// a non-text UI indicator. A focus ring nobody can see is the bug this task
// exists to fix, reintroduced by its own fix.

const srgb = (h) => {
    h = h.trim().replace('#', '');
    if (h.length === 3) h = [...h].map(c => c + c).join('');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
};
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
    const [r, g, b] = srgb(hex).map(lin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

/** Read a custom property out of one CSS block. */
function cssVar(block, name) {
    const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
    return m ? m[1].trim() : null;
}
function themeBlock(selector) {
    const i = css.indexOf(selector);
    assert.ok(i !== -1, `${selector} block not found in style.css`);
    return css.slice(i, css.indexOf('}', i));
}

test('the focus ring reaches 3:1 against every background in both themes', () => {
    const BGS = ['bg-primary', 'bg-secondary', 'bg-surface'];
    for (const [label, selector] of [['dark', ':root'], ['light', '[data-theme="light"]']]) {
        const block = themeBlock(selector);
        const ring = cssVar(block, 'focus-ring');
        assert.ok(ring, `${label} theme defines no --focus-ring`);
        for (const bg of BGS) {
            const bgVal = cssVar(block, bg);
            assert.ok(bgVal, `${label} theme defines no --${bg}`);
            const r = contrast(ring, bgVal);
            assert.ok(r >= 3.0,
                `${label} --focus-ring ${ring} on --${bg} ${bgVal} is ${r.toFixed(2)}:1, ` +
                `below the 3:1 WCAG 1.4.11 floor for a non-text UI indicator`);
        }
    }
});

test('the focus rules use the dedicated ring token, not the accent', () => {
    // Guards the specific regression: someone simplifying --focus-ring back to
    // --accent would pass the contrast test above (it only reads the token) while
    // making the ring invisible in the light theme.
    const rules = [...css.matchAll(/[^{}]*:focus-visible[^{}]*\{[^}]*\}/g)].map(m => m[0]);
    assert.ok(rules.length >= 2, `expected several :focus-visible rules, found ${rules.length}`);
    const outlined = rules.filter(r => /outline:/.test(r));
    assert.ok(outlined.length >= 2, 'focus rules should draw an outline');
    for (const r of outlined) {
        const outline = /outline:\s*([^;]+);/.exec(r)[1];
        assert.ok(/var\(--focus-ring\)/.test(outline),
            `a focus outline uses ${outline.trim()} instead of var(--focus-ring); ` +
            `--accent is 2.46:1 in the light theme`);
    }
});

// --- The audio-unlock gate --------------------------------------------------

const mainJs = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('the unlock gate is a real button inside a dialog', () => {
    const overlay = /<div id="audio-unlock-overlay"[\s\S]*?<\/div>\s*<\/div>/.exec(html);
    assert.ok(overlay, 'overlay markup found');
    assert.ok(/role="dialog"/.test(overlay[0]), 'needs role="dialog"');
    assert.ok(/aria-modal="true"/.test(overlay[0]), 'needs aria-modal');
    assert.ok(/<button[^>]*id="unlock-btn"/.test(overlay[0]),
        'the affordance must be a real button so Enter and Space work — a <div> is ' +
        'unreachable, so a keyboard user could never start the audio at all');
});

test('the app behind the overlay is made inert', () => {
    // Without this, Tab walks through sliders that sit behind a blurred,
    // click-blocking overlay: focus is somewhere the user cannot see or operate.
    //
    // Matches the attribute CALLS, not the word "inert" — the source comment
    // explaining the mechanism contains that word, so a bare /inert/ test
    // passed with both calls deleted. Found by trying to falsify it.
    assert.match(mainJs, /setAttribute\(\s*'inert'/,
        'nothing sets inert on #app - focus escapes behind the overlay');
    assert.match(mainJs, /removeAttribute\(\s*'inert'/,
        'inert is set but never cleared - the app stays unusable after unlocking');
});

test('dismissing the unlock gate cannot run twice', () => {
    // The button's click and the document-wide pointerdown fallback both fire for
    // one tap (pointerdown precedes click). Every step happens to be idempotent
    // today, which is exactly why an explicit guard belongs here rather than a
    // comment promising it stays that way.
    const fn = /function dismissUnlockOverlay\(\)\s*\{[\s\S]*?\n\}/.exec(mainJs);
    assert.ok(fn, 'dismissUnlockOverlay not found');
    // Deliberately narrow: an `|| return;` alternative here would let ANY early
    // return in the function satisfy the assertion, which is how a test ends up
    // passing for a reason that has nothing to do with what it claims.
    assert.match(fn[0], /if \(\s*unlocked\s*\)\s*return;/,
        'dismissUnlockOverlay has no `if (unlocked) return;` re-entry guard');
});

test('the unlock scrim is theme-derived, not a hardcoded near-black', () => {
    const rule = /#audio-unlock-overlay\s*\{[^}]*\}/s.exec(css)[0];
    assert.ok(!/rgba\(18,\s*17,\s*15/.test(rule),
        'a hardcoded dark scrim under themed text renders "Tap to start" at 1.21:1 ' +
        'in light mode (measured: text #2a2420 on the composited rgb(52,50,48))');
    assert.ok(/var\(--bg-primary\)/.test(rule),
        'the scrim should derive from the theme background');
});

test('the unlock credits are not dimmed below legibility', () => {
    // opacity: 0.6 on --text-secondary put the credits at 2.22:1 (light) and
    // 2.52:1 (dark) — failing in BOTH themes, which the plan did not mention.
    const rule = /#audio-unlock-overlay \.unlock-credits\s*\{[^}]*\}/s.exec(css);
    assert.ok(rule, '.unlock-credits rule not found');
    const op = /opacity:\s*([\d.]+)/.exec(rule[0]);
    assert.ok(!op || parseFloat(op[1]) >= 0.9,
        `opacity ${op && op[1]} multiplies against an already-dim --text-secondary; ` +
        `measured 2.22:1 in light and 2.52:1 in dark, both below the 4.5:1 floor`);
});

test('no focus rule targets an element that cannot receive focus', () => {
    // #waveform-canvas has no tabindex and must not get one: this is a touch
    // instrument with no keyboard play mode, so a focus ring on the pad would
    // advertise an interaction that does not exist. The rule styling it was
    // therefore dead CSS. If the pad ever becomes operable, add tabindex FIRST.
    const canvasFocus = /#waveform-canvas:focus-visible/.test(css);
    const canvasTabbable = /<canvas[^>]*id="waveform-canvas"[^>]*tabindex/.test(html);
    assert.ok(!canvasFocus || canvasTabbable,
        'style.css styles #waveform-canvas:focus-visible but the canvas has no tabindex');
});
