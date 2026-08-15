# Tests

```bash
node --test "tests/*.test.mjs"      # everything
node --test tests/player.test.mjs   # one file
```

Requires **Node 22.7+** (developed on 24.15.0). Nothing else — no `npm install`,
no `package.json`, no `node_modules`.

## Why there is no package.json

Node 22.7+ detects ES module syntax in `.js` files automatically, so
`import { Voice } from '../src/audio/Voice.js'` works from a `.mjs` test with
no configuration. Adding a `package.json` would make `npm install` look like a
required step and break the project's zero-dependency promise for no benefit.

Test files are `.mjs` (unconditionally ESM). Source files stay `.js` so the
browser is unaffected.

## Fakes

`fakes.mjs` provides `FakeAudioContext` (manually-driven `currentTime`, param
event recording) and `FakeTimers` (deterministic `setTimeout`/`rAF`, with
`freeze()` to model a backgrounded tab). Time never advances on its own — call
`ctx.advance()` and `timers.runUntil()` explicitly, so timing assertions are
exact rather than flaky.
