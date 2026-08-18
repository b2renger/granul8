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
const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');

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
