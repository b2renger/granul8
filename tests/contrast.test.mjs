// contrast.test.mjs — WCAG contrast, computed from the real tokens in style.css.
//
// Reads the custom properties out of the two theme blocks rather than restating
// them, so the numbers cannot drift from what ships. A hand-maintained copy of
// the palette was measuring the OLD values after the tokens had been changed and
// reporting failures that were already fixed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = (await readFile(new URL('../style.css', import.meta.url), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '');

const srgb = (h) => {
    h = h.trim().replace('#', '');
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
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

function themeTokens(selector) {
    const i = css.indexOf(selector);
    assert.ok(i !== -1, `${selector} not found in style.css`);
    const block = css.slice(i, css.indexOf('}', i));
    const out = {};
    for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[m[1]] = m[2];
    return out;
}

const THEMES = { dark: themeTokens(':root'), light: themeTokens('[data-theme="light"]') };
/* Each token is checked against the grounds it ACTUALLY appears on, not against
   every ground in the palette. Both directions of that matter:
   - Too narrow and you certify a colour that fails where it is used. The first
     audit here covered only the three bg-* tokens, so --text-secondary was
     signed off at 4.87:1 while the modifier words — which sit on --card-shelf
     and nowhere else — were at 3.87:1.
   - Too broad and you darken a colour to satisfy a pairing that never renders.
     --accent is 3.76:1 on --card-shelf, and it is never drawn there. */
const TEXT_TOKENS = [
    ['text-primary', ['bg-primary', 'bg-secondary', 'bg-surface', 'card-bg'],
        'parameter names, values, headings'],
    ['text-secondary', ['bg-primary', 'bg-secondary', 'bg-surface', 'card-bg', 'card-shelf'],
        'MIN/MAX tags, modifier words on the shelf, reason lines on the card'],
    ['accent', ['bg-primary', 'bg-secondary', 'card-bg'],
        'section headings at 15px and value readouts at 11px'],
];

/** Tokens used as non-text UI: the 3:1 floor of WCAG 1.4.11 applies.
 *  NOT --border or --card-edge. 1.4.11 covers what is "required to identify" a
 *  control; a divider that groups is decoration, and forcing it to 3:1 would make
 *  the panel harsh for no accessibility gain. Their job is measured below instead. */
const UI_TOKENS = [
    ['focus-ring', ['bg-primary', 'bg-secondary', 'bg-surface', 'card-bg', 'card-shelf'],
        'the keyboard focus indicator — it must be findable on every surface a ' +
        'control can sit on, including the modifier shelf'],
];

for (const [theme, tokens] of Object.entries(THEMES)) {
    for (const [token, grounds, used] of TEXT_TOKENS) {
        test(`${theme}: --${token} reaches 4.5:1 where it is used (${used})`, () => {
            assert.ok(tokens[token], `${theme} defines no --${token}`);
            for (const g of grounds) {
                const r = contrast(tokens[token], tokens[g]);
                assert.ok(r >= 4.5,
                    `--${token} ${tokens[token]} on --${g} ${tokens[g]} is ${r.toFixed(2)}:1`);
            }
        });
    }
    for (const [token, grounds, used] of UI_TOKENS) {
        test(`${theme}: --${token} reaches 3:1 where it is used (${used})`, () => {
            assert.ok(tokens[token], `${theme} defines no --${token}`);
            for (const g of grounds) {
                const r = contrast(tokens[token], tokens[g]);
                assert.ok(r >= 3.0,
                    `--${token} ${tokens[token]} on --${g} ${tokens[g]} is ${r.toFixed(2)}:1`);
            }
        });
    }
}

test('the two themes are actually different palettes, not one copied', () => {
    // Guards the failure mode that produced the original light theme: keep the
    // dark structure, lighten only the backgrounds, leave the foregrounds put.
    const shared = Object.keys(THEMES.dark).filter(
        (k) => THEMES.light[k] && THEMES.light[k] === THEMES.dark[k]);
    assert.deepEqual(shared, [],
        'these tokens are identical in both themes, so one of the two is unconsidered');
});

test('a parameter card is actually distinguishable from the panel behind it', () => {
    // The card carries the grouping that makes a label obviously belong to its
    // controls, so it has to be visible. The first attempt filled it with
    // --bg-secondary, which is 1.07:1 against --bg-primary: no card at all, just
    // a hairline. Two devices are checked because near-black and near-white
    // grounds both compress fill ratios, and the edge is what survives that.
    for (const [theme, t] of Object.entries(THEMES)) {
        const fill = contrast(t['card-bg'], t['bg-primary']);
        const edge = contrast(t['card-edge'], t['card-bg']);
        assert.ok(fill >= 1.15,
            `${theme}: --card-bg ${t['card-bg']} is ${fill.toFixed(2)}:1 against the page — invisible`);
        assert.ok(edge >= 1.45,
            `${theme}: --card-edge ${t['card-edge']} is ${edge.toFixed(2)}:1 against the card — no delineation`);
    }
});

test('the modifier shelf still reads as a step down from the card face', () => {
    // It has two jobs that pull against each other: enough contrast with the card
    // to look like a shelf rather than a hole, and a light enough ground for
    // --text-secondary to clear 4.5:1 on it. Fixing one alone broke the other
    // twice — first --bg-primary (1.07:1, a hole), then a lighter shelf (text
    // fine, 1.07:1 again).
    for (const [theme, t] of Object.entries(THEMES)) {
        const step = contrast(t['card-shelf'], t['card-bg']);
        assert.ok(step >= 1.12,
            `${theme}: --card-shelf ${t['card-shelf']} is ${step.toFixed(2)}:1 against ` +
            `--card-bg — the modifier strip reads as a hole in the card, not a shelf`);
    }
});
