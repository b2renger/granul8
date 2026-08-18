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
    const cards = walk(html, (n) => n.cls.includes('param-group'));
    assert.ok(cards.length >= 15, `sanity: found ${cards.length} param-groups`);
    const orphans = cards
        .filter((n) => !(n.parent && n.parent.cls.includes('section-content')))
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
