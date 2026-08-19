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
    // Not anchored on `}`: that made the same selector invisible inside any
    // @media block, where a nested rule follows `{` instead.
    assert.ok(!/(^|[{};])\s*\.param-group label\s*[,{]/.test(css),
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
        // `idx === -1 || ...` used to sit here, which meant DELETING the rule
        // passed the test: the thing it guards is that these states render at
        // all, so absence has to fail, not short-circuit to success.
        const idx = css.indexOf(state);
        assert.notEqual(idx, -1, `${state} has no rule at all, so the state cannot render`);
        const selector = css.slice(css.lastIndexOf('}', idx) + 1, idx);
        const scoped = selector.includes('#');
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
    // EVERY .param-inactive rule, not just the first. Reading only the first let
    // a later duplicate reintroduce the ancestor opacity — which is precisely the
    // bug that shipped here once already.
    let found = 0, dims = 0;
    for (let at = css.indexOf('.param-inactive'); at !== -1; at = css.indexOf('.param-inactive', at + 1)) {
        const block = css.slice(css.lastIndexOf('}', at) + 1, css.indexOf('}', at));
        const selector = block.slice(0, block.indexOf('{'));
        if (!selector.includes('.param-inactive')) continue;
        found++;
        if (!/opacity/.test(block)) continue;
        dims++;
        assert.ok(selector.includes('>'),
            `an .param-inactive rule sets opacity on the card itself (${selector.trim()}). ` +
            'Ancestor opacity is the one mechanism a descendant cannot opt out of, ' +
            'and .param-note has to stay readable — target the controls, not their ' +
            'container');
    }
    assert.ok(found > 0, '.param-inactive rule not found');
    assert.ok(dims > 0, 'sanity: .param-inactive should still dim something');
});

test('no breakpoint shrinks a transport button below the 44px touch floor', () => {
    // The base rule set 44x44 correctly, and then two media queries overrode it:
    // 40x40 under 380px and 36x36 under 420px tall. So the narrower or shorter
    // the viewport — the more likely a phone in one hand — the SMALLER the
    // target. Both broke a rule the stylesheet had already satisfied, in a file
    // that holds 44px everywhere else.
    // Scans every rule whose SELECTOR mentions #transport-bar, not the literal
    // substring "#transport-bar button". That literal missed
    // `#transport-bar .bar-count-btn`, which is (1,1,0) and therefore beat the
    // 44px base rule at (1,0,1) — so four buttons rendered 36x36 at every
    // viewport while the commit that added this test asserted the file "holds
    // 44px everywhere else". A child combinator or a non-px unit walked past it
    // too.
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
    const offenders = [];
    let from = 0;
    for (;;) {
        const at = css.indexOf('#transport-bar', from);
        if (at === -1) break;
        from = at + 1;
        const open = css.indexOf('{', at);
        if (open === -1) break;
        const selector = css.slice(css.lastIndexOf('}', at) + 1, open);
        // The bar itself, and anything that is not a control, are not targets.
        if (!/button|\.bar-count-btn|\.snap-btn|\.loop-station-btn/.test(selector)) continue;
        const rule = css.slice(open, css.indexOf('}', open));
        for (const m of rule.matchAll(/(?:^|[;{])\s*(width|height):\s*([\d.]+)(px|rem|em)/g)) {
            const px = m[3] === 'px' ? Number(m[2]) : Number(m[2]) * 16;
            if (px < 44) offenders.push(`${selector.trim()} { ${m[1]}: ${m[2]}${m[3]} }`);
        }
    }
    assert.deepEqual(offenders, [],
        'a transport button is sized below 44px somewhere; shrink the level meter ' +
        'or wrap the bar instead — the buttons are the instrument');
});

test('the loop handles have a real touch target', () => {
    // 6x16 with cursor: ew-resize and a :hover state — designed mouse-first, and
    // roughly seven times under the guideline on the control the loop is dragged
    // by. A ::before expands the hit area without moving the visual handle.
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
    const at = css.indexOf('.loop-handle::before');
    assert.ok(at !== -1, '.loop-handle has no expanded hit area');
    const rule = css.slice(at, css.indexOf('}', at));
    const m = /inset:\s*(-?\d+)px\s+(-?\d+)px/.exec(rule);
    assert.ok(m, '.loop-handle::before does not set a symmetric inset');
    // Read the handle's real size rather than hardcoding 6x16: with the numbers
    // baked in, shrinking .loop-handle to 2x4px left this green while the target
    // it computes collapsed with it.
    const hAt = css.indexOf('.loop-handle {');
    assert.notEqual(hAt, -1, '.loop-handle rule not found');
    const hRule = css.slice(hAt, css.indexOf('}', hAt));
    const hw = /width:\s*(\d+)px/.exec(hRule);
    const hh = /height:\s*(\d+)px/.exec(hRule);
    assert.ok(hw && hh, '.loop-handle declares no explicit size');
    const [, y, x] = m.map(Number);
    const width = Number(hw[1]) + 2 * Math.abs(x);
    const height = Number(hh[1]) + 2 * Math.abs(y);
    assert.ok(width >= 44 && height >= 44,
        `the handle's touch target is ${width}x${height}, under the 44x44 floor`);
});

test('a focus ring inside a scroll container is inset, not clipped', () => {
    // Setting one overflow axis to a non-visible value computes the OTHER to
    // auto, so #tab-bar (overflow-x) clips vertically and #parameter-panel
    // (overflow-y) clips horizontally. Outlines are not scrollable overflow, so
    // an outset ring is cut off rather than reachable. The tabs stretch to the
    // container's full content height — 0px of slack against the 4px a ring
    // needs — so keyboard focus showed two vertical ticks and no top or bottom.
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const sel of ['.tab-item:focus-visible', '#tab-add:focus-visible',
                       'summary:focus-visible']) {
        const at = css.indexOf(sel);
        assert.notEqual(at, -1, `${sel} has no rule, so it inherits the outset global ring`);
        const rule = css.slice(css.indexOf('{', at), css.indexOf('}', at));
        assert.match(rule, /outline-offset:\s*-/,
            `${sel} uses an outset ring inside a container that clips it`);
    }
});

test('no at-rule is nested inside another at-rule', () => {
    // The brace-balance test above counts DEPTH, so it cannot see a MISPLACED
    // brace. Delete the `}` closing one @media and append one at EOF: the count
    // still balances, the suite stays green, and every rule in the following
    // @media is now gated on the previous one's condition as well. Verified —
    // moving the brace that closes @media (max-width: 380px) silently nested
    // @media (max-height: 420px) inside it, putting every landscape-phone rule
    // behind "and width <= 380px", with nothing reporting it.
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
    const stack = [];
    const bad = [];
    const re = /@media[^{]*\{|\{|\}/g;
    let m;
    while ((m = re.exec(css)) !== null) {
        if (m[0].startsWith('@media')) {
            if (stack.some(x => x.at)) {
                bad.push(`${m[0].trim().slice(0, 40)} at index ${m.index}`);
            }
            stack.push({ at: true });
        } else if (m[0] === '{') {
            stack.push({ at: false });
        } else {
            stack.pop();
        }
    }
    assert.deepEqual(bad, [],
        'these @media blocks are nested inside another one, so their rules carry ' +
        'both conditions — almost always a brace in the wrong place rather than intent');
});

test('no media query condition is declared twice', () => {
    // Two @media (max-width: 600px) blocks between them re-declared #top-bar,
    // #parameter-panel, #level-meter and #transport-bar. Same specificity, so the
    // later silently won — and a 24-line comment justified a 38vh panel cap that
    // never rendered because the other block set 44vh. Duplicated at-rule blocks
    // are how equal-specificity overrides hide in plain sight: nothing in either
    // block looks wrong on its own.
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
    const seen = new Map();
    for (const m of css.matchAll(/@media([^{]+)\{/g)) {
        const cond = m[1].replace(/\s+/g, ' ').trim();
        seen.set(cond, (seen.get(cond) || 0) + 1);
    }
    const dupes = [...seen].filter(([, n]) => n > 1).map(([c, n]) => `${c} x${n}`);
    assert.deepEqual(dupes, [],
        'merge these — a second block with the same condition overrides the first ' +
        'wherever they touch the same selector, invisibly');
});
