// structure.test.mjs — Does the CSS parse, and is the HTML nested the way the
// selectors assume?
//
// Both of these were written after each caught a real, shipped bug that every
// other test in this suite was blind to:
//
//   1. A dropped `}` in one rule swallowed the following 276 lines of style.css
//      into that block, where the browser discarded them. Gone: the focus ring,
//      all four responsive breakpoints, and the whole modifier strip. The suite
//      stayed green because its CSS assertions are substring and regex matches
//      over the file's TEXT — a rule that is present in the file but dead in the
//      browser reads identically to a rule that works.
//
//   2. A closing </div> landed one card too early, so four of the six Sound
//      Engine parameters became children of <details> instead of the grid. Every
//      tag was still balanced, so a balance check passed; they were simply in the
//      wrong parent. They rendered full-window-width next to a 360px sibling.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const cssRaw = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('style.css has no unclosed block', () => {
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0, line = 1, openedAt = [];
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (c === '\n') line++;
        else if (c === '{') { depth++; openedAt.push(line); }
        else if (c === '}') {
            depth--;
            openedAt.pop();
            assert.ok(depth >= 0, `stray } at line ${line}`);
        }
    }
    assert.equal(depth, 0,
        `${depth} block(s) left open — everything after the one opened near line ` +
        `${openedAt[0]} is swallowed and discarded by the browser`);
});

/** Walk the document, returning [{tag, cls, line, parents}] for matching nodes. */
function walk(doc, predicate) {
    const VOID = new Set(['input','img','br','meta','link','hr','source','path',
        'use','circle','rect','line','polyline','polygon','ellipse']);
    const out = [], stack = [];
    const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
    let m;
    while ((m = re.exec(doc)) !== null) {
        const [, slash, tag, attrs] = m;
        const name = tag.toLowerCase();
        if (VOID.has(name) || attrs.trimEnd().endsWith('/') || name === '!doctype') continue;
        if (slash) {
            const top = stack.pop();
            assert.ok(top, `stray </${name}>`);
            assert.equal(top.name, name,
                `</${name}> closes <${top.name}> opened on line ${top.line}`);
            continue;
        }
        const cls = (/class="([^"]*)"/.exec(attrs) || [, ''])[1].split(/\s+/).filter(Boolean);
        const node = { name, cls, line: doc.slice(0, m.index).split('\n').length,
                       parents: stack.map(x => x.cls).flat() ,
                       parent: stack[stack.length - 1] };
        if (predicate(node)) out.push(node);
        stack.push(node);
    }
    assert.deepEqual(stack.map(x => `<${x.name}> line ${x.line}`), [], 'unclosed tags');
    return out;
}

test('index.html tags are balanced and correctly nested', () => {
    const all = walk(html, () => true);
    assert.ok(all.length > 100, `sanity: walked only ${all.length} elements`);
});

test('every parameter card is a direct child of a grid container', () => {
    // .param-group is styled as a card and .section-content is the grid that
    // sizes it. A card outside the grid keeps the card styling and loses the
    // column sizing, the 24px side inset and the 18px gap — so it renders at the
    // full panel width, flush to both edges, butted against its neighbour with
    // zero space. Four parameters shipped like that.
    //
    // A card may also sit inside a nested grid — .pitch-chain groups the five
    // pitch cards onto one row. That is allowed only because the class really is
    // a grid container, which is asserted below rather than assumed: exempting a
    // parent by name would let the next wrapper through without one.
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
    const GRID_PARENTS = ['section-content', 'pitch-chain'];
    for (const cls of GRID_PARENTS) {
        const at = css.indexOf('.' + cls + ' {');
        assert.ok(at !== -1, `.${cls} has no rule, so it cannot be sizing anything`);
        const rule = css.slice(at, css.indexOf('}', at));
        assert.ok(/display:\s*grid/.test(rule),
            `.${cls} is treated as a grid parent here but does not declare display: grid`);
    }

    const cards = walk(html, (n) => n.cls.includes('param-group'));
    assert.ok(cards.length >= 15, `sanity: found ${cards.length} param-groups`);
    const orphans = cards
        .filter((n) => !(n.parent && n.parent.cls.some((c) => GRID_PARENTS.includes(c))))
        .map((n) => `line ${n.line} (parent <${n.parent?.name} class="${n.parent?.cls.join(' ')}">)`);
    assert.deepEqual(orphans, [],
        'these parameter cards are outside the grid that is supposed to size them');
});

test('a switch and the word naming it are never spread apart', () => {
    // `.param-group label { justify-content: space-between }` also matched every
    // .toggle-label nested inside, pinning the switch to one edge of the card and
    // its word to the other — around 1800px apart in a full-width card. The
    // parameter-name rule must be a CHILD selector so it cannot reach them.
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/(^|\})\s*\.param-group label\s*\{/.test(css),
        '`.param-group label` is a descendant selector: it reaches .toggle-label ' +
        'inside .param-modifiers. Use `.param-group > label`.');
    const at = css.indexOf('.toggle-label {');
    assert.ok(at !== -1, '.toggle-label rule not found');
    const rule = css.slice(at, css.indexOf('}', at));
    assert.ok(/justify-content:\s*flex-start/.test(rule),
        '.toggle-label does not pin its own justify-content, so any parent rule ' +
        'setting space-between will pull the switch away from its label');
});

test('the hidden attribute actually hides', () => {
    // The UA stylesheet implements `hidden` as a plain [hidden]{display:none},
    // which loses to ANY author display declaration. `.range-row { display:flex }`
    // therefore kept four rows that JS had set hidden = true fully on screen —
    // disabled, styled identically to the live slider beside them, and carrying
    // the only visible label. The "fix" that set .hidden was inoperative.
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
    const at = css.indexOf('[hidden]');
    assert.ok(at !== -1, 'no author [hidden] rule: the attribute is unreliable here');
    const rule = css.slice(at, css.indexOf('}', at));
    assert.ok(/display:\s*none\s*!important/.test(rule),
        'an author [hidden] rule must be !important, or a later author display ' +
        'declaration on the same element silently un-hides it');
});

test('a parameter name and its own value are not flung to opposite edges', () => {
    // `justify-content: space-between` on the card's name row put "Volume" at one
    // edge and "0.70" at the other: 255px apart at 1920px, 374px at 1024px. The
    // identical bug was fixed on .toggle-label and left here, on the pairing that
    // matters more.
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
    const at = css.indexOf('.param-group > label,');
    assert.ok(at !== -1, '.param-group > label rule not found');
    const rule = css.slice(at, css.indexOf('}', at));
    assert.ok(!/justify-content:\s*space-between/.test(rule),
        'the parameter name row uses space-between, so a value sits hundreds of ' +
        'pixels from the name it belongs to');
});

test('a toggle state rule can out-specify the base rule it overrides', () => {
    // `#transport-bar button` is (1,0,1). An ID beats any number of classes, so
    // `.snap-btn.snap-active` at (0,2,0) lost every declaration it made — Snap on
    // rendered pixel-identical to Snap off, likewise Loop station, likewise all
    // four bar-count buttons, so you could not see which bar count you were about
    // to record. Nothing in the file's text hints at it; only the cascade does.
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const state of ['.snap-btn.snap-active', '.loop-station-btn.active',
                         '.bar-count-btn.active']) {
        // Scanned by index, not by a built regex. The first version of this line
        // was `new RegExp('(^|\})\s*' + ...)` written through a shell heredoc,
        // which ate a backslash level and left `\s` meaning a literal "s" — so the
        // test could not fail. Same trap as the one in panel.test.mjs.
        // Everything between the previous rule's closing brace and this match is
        // the selector text. If it contains a '#', the rule is id-scoped and can
        // win. No newline literal and no built regex here on purpose: both have
        // now been mangled by escaping in this file, each time producing a test
        // that silently could not fail.
        const idx = css.indexOf(state);
        const selector = idx === -1 ? '' : css.slice(css.lastIndexOf('}', idx) + 1, idx);
        const scoped = idx === -1 || selector.includes('#');
        assert.ok(scoped,
            `${state} is declared without an id scope, so #transport-bar button ` +
            `(1,0,1) outranks it and none of its declarations render`);
    }
});

test('the inactive dimming is never applied to an ancestor of the reason line', () => {
    // This test previously asserted that `.param-inactive .param-note` existed —
    // i.e. that a child had opted out with opacity: 1. It cannot. Ancestor
    // opacity composites the whole subtree as one group, and `opacity: 1` on a
    // descendant only means "do not dim me FURTHER". So the rule was present, the
    // test passed, and the sentence naming the switch that wakes a dead card
    // still rendered at 2.29:1 while a comment insisted it had been exempted.
    // Assert the mechanism instead: .param-inactive must dim the card's controls,
    // never the card.
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
    const at = css.indexOf('.param-inactive');
    assert.ok(at !== -1, '.param-inactive rule not found');
    const selectorStart = css.lastIndexOf('}', at) + 1;
    const block = css.slice(selectorStart, css.indexOf('}', at));
    const selector = block.slice(0, block.indexOf('{'));
    assert.ok(/opacity/.test(block), 'sanity: .param-inactive should still dim something');
    assert.ok(selector.includes('>'),
        'the .param-inactive opacity applies to the whole card. Ancestor opacity ' +
        'is the one mechanism a descendant cannot opt out of, and .param-note has ' +
        'to stay readable — target the controls, not their container');
});
