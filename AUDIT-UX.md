# Granul8 — UI / UX Audit


> **Method.** Three independent critic agents with no prior context, each given one lens
> (interaction design and the performance experience · visual design, layout and responsive
> behaviour · accessibility, error states and robustness). None could run the app, so each
> reconstructed the interface by reading `index.html`, all 1551 lines of `style.css`, every
> module in `src/ui/`, and the wiring in `src/main.js`. Their findings then went through
> adversarial verification with instructions to refute by default.
>
> **Every contrast ratio in this document was computed**, not estimated — sRGB relative
> luminance per WCAG 2.x, with alpha compositing where the CSS uses `rgba`. The touch-target
> and type-scale inventories are exhaustive counts, not samples.

## Credit first

The markup is not div soup. There is a real `<header>` and `<main>`, `<details>/<summary>`
for the collapsible sections, `<button type="button">` for every clickable control, real
`<input type="range">` and `<select>` for parameters, `<optgroup>` on the subdivision
selects, and correct `for`/`id` label pairs on `#master-volume` and `#param-bpm`. The theme
system is properly tokenised — all 21 hex literals live in the two `:root` blocks. Canvas
components read their colours back out of CSS custom properties and re-read them on theme
change, which is more discipline than most projects manage. `touch-action: none` is set on
every interactive canvas, and `pointercancel` is handled.

The bones are sound. The problems are in three layers built on top of them.

## The headline

### 1. The instrument cannot be played without a pointer — and half the panel cannot be reached without one either

The entire performance surface is bound exclusively to pointer events. The canvas has no
`tabindex`, no `role`, no `aria-label`, and no keyboard path into `onStart`. A grep across
`index.html`, `style.css` and all of `src/` returns **zero** occurrences of `aria`, `role=`
or `tabindex`. The one documented shortcut, `R`, merely *arms* recording — capture still
requires a real pointer, so even that is a dead end.

That much is a design gap that needs new interaction work. What is a plain bug is everything
around it:

- **All seven quantize/randomize toggles are `display: none` checkboxes** (`style.css:1160`).
  `display: none` removes an element from the tab order *and* from the accessibility tree.
  These are not decorative — they are the switches that enable the subdivision selects
  beside them, which ship `disabled`. So a keyboard user cannot turn quantisation on at all,
  and a screen reader is told the section contains three plain selects and no checkboxes.
- **The audio-unlock splash is dismissible only by `pointerdown`.** No button, no
  `role="dialog"`, no `keydown` handler, and nothing sets `inert` on `#app` behind it — so
  focus travels to controls the user cannot see or click, behind a blurred, click-blocking
  overlay, with no reachable way out. For a keyboard-only user the app is not degraded, it is
  **unenterable**.
- **Eight of the most-used sliders have no accessible name.** `<label>Grain Size</label>` and
  friends have no `for` and do not wrap their inputs. A screen reader announces six identical
  anonymous sliders in a row. The correct pattern is used two elements away on
  `#master-volume`, so this is oversight, not ignorance.
- `user-scalable=no` blocks pinch zoom on an app whose smallest type is **4.5px**. The
  per-element `touch-action: none` already does the job this meta was reaching for, so the
  zoom lock costs the user their only remedy and buys nothing.

### 2. The light theme was never measured

`--text-secondary` on `--bg-primary` is **4.37:1**; on `--bg-surface` it is **3.61:1** — both
below AA for the 10–13px text they are applied to. Worse, `--accent` at **2.98:1** is the
colour of `.param-value`: the numeric readout of *every* parameter in the app. The dark theme
scrapes by at 4.89 / 4.10 / 9.28:1, which is presumably why this went unnoticed — the light
palette was built by eye as a mirror image and never re-measured.

Two consequences compound it:

- **`voiceColors.js` is a hardcoded dark-theme palette** — its own comment says so. It drives
  pointer indicators, grain rectangles and playback ghosts, all drawn onto a canvas whose
  background *is* themed. At the alpha values actually used, a grain body computes to
  **1.09:1** on the light canvas. The entire visual feedback layer — the thing that tells a
  performer which finger drives which voice — washes out to nothing.
- **The unlock splash hardcodes a near-black scrim but themes its text.** A returning
  light-theme user sees "Tap to start" at **1.20:1** — invisible — on a dark rectangle, with
  no indication that a tap is required. The app looks hung.

### 3. Mobile portrait is broken, on the device class the product page names

The splash reads *"A granular sampler and loopstation for the web and multitouch devices."*
On an iPhone in portrait:

- **The parameter panel overflows the viewport with no scrollbar.** `flex-shrink: 0` plus
  auto height inside a `min-height: 0` column flex container, under `body { overflow:
  hidden }` — the panel's own `overflow-y: auto` never engages because the overflow happens
  on its parent. Spread, Pan, Volume, the ADSR editor and the whole Gesture Mapping section
  sit below the fold. (Collapsing a `<details>` section reveals them, so this is a serious
  usability failure rather than a hard lockout.)
- **The 44px transport buttons collapse to ~23px wide.** No `flex-wrap`, no `min-width`.
  And the bar-count selector — visible by default, since `loopStationMode` defaults to
  `true` — renders at 44×44 rather than its intended 24×24, because
  `#transport-bar button` (specificity 1-0-1) beats `.bar-count-btn` (0-1-0) regardless of
  source order. Hitting Stop mid-take becomes a coin flip.
- Nine interactive controls sit between 16px and 36px against a 44px design target the
  project's own plan document specifies.

### 4. Destructive actions have no guard, and state is invisible

- **Record silently destroys the existing loop.** No confirmation, no undo. Record and Play
  are adjacent 44px squares. In loop-station mode you get one bar of grace; in free-form
  mode the loss is immediate. Meanwhile `Ctrl+Z` *does* exist, is single-level, idle-only,
  keyboard-only, and completely invisible in the UI.
- **`R` bypasses every disabled-button guard and hijacks `Ctrl+R`.** A performer reaching for
  a page reload after a glitch cancels the reload, stops the loop, triggers a count-in, and
  eight seconds later has overwritten their take with silence.
- **Dropping a `.json` file on the pad wipes the entire workspace** — every tab, every loop —
  then auto-saves over the localStorage backup that was the only other copy.
- **Background tabs keep playing with zero indication.** `switchTo` deliberately leaves other
  instances running, but `TabBar.render` draws only a label and a close ×. To silence a
  drifting layer you must guess which tab it is and switch to it, losing your edit context.
- **The Overdub button is enabled and clickable in idle, and does nothing** — the handler
  bails on exactly that state. The code to make it work correctly is already there, three
  lines below the guard that makes it unreachable.

### 5. The core mapping is never taught

Y = pitch, ±2 octaves, exponential. That is the single most important thing to know about
this instrument and it appears nowhere in the interface. The only instructional text in the
app is the canvas empty state — which names a button that does not exist ("Load Sample" vs
the actual "Load File"), sits at **2.26:1**, and is unreachable on the default path because a
sample auto-loads. Mapping any gesture dimension to Pitch silently disables the vertical axis
with no visual change. The Min sliders and the Pan range are dead controls until something
enables them, and nothing says what.

## Suggested order of work

**Cheap and high-impact — a single afternoon:**

1. Swap `display: none` on the seven toggles for a visually-hidden-but-focusable pattern.
2. Add `for`/`aria-label` to the eight unnamed sliders and `#sample-select`.
3. Make the unlock overlay a real `<button>`, dismiss on `click`, set `inert` on `#app`.
4. Drop `user-scalable=no`.
5. `#parameter-panel`: `flex-shrink: 1; min-height: 0`.
6. `#transport-bar`: `flex-wrap: wrap`; buttons get `min-width: 44px; flex-shrink: 0`.
7. Guard the `R` shortcut with `if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;`.
8. Disable Overdub in idle — or better, delete the guard and let it start playback, which the
   existing code already does correctly.
9. Add a focus-visible style. There is currently not one in 1551 lines of CSS.

**Needs a measurement pass:**

10. Re-derive the light-theme tokens against real ratios; split `--accent` into a fill colour
    and a text colour.
11. Move the voice palette into CSS custom properties with light and dark variants, and read
    it the way `WaveformDisplay` already reads its own.

**Needs design work:**

12. Snapshot the lane before Record so Ctrl+Z can undo a destroyed take; surface undo in the
    UI.
13. Confirm before any import that would replace existing work.
14. Per-tab playing/recording indicators in the tab strip.
15. A keyboard path into the instrument, and an in-app legend for the XY mapping.


## Severity summary

| Severity | Count | Meaning |
|---|---:|---|
| **Critical** | 1 | Broken for every user on the default path |
| **High** | 15 | Breaks a core workflow, loses work, or locks out a class of users |
| **Medium** | 35 | Wrong, confusing, or fragile under normal use |
| **Low** | 11 | Real but narrow — polish, drift, or a bounded edge case |
| **Nit** | 1 | Cosmetic or documentation-only |
| | **63** | |

## Index

| # | Sev | Location | Finding |
|---:|---|---|---|
| [1](#u-1) | Critical | [style.css:1160](style.css#L1160) | All seven quantize/randomize toggles are `display: none` checkboxes — unreachable by keyboard and absent from the accessibility tree |
| [2](#u-2) | High | [index.html:298](index.html#L298) | Eight of the most-used sliders have no accessible name — the `<label>` elements are orphans |
| [3](#u-3) | High | [index.html:5](index.html#L5) | user-scalable=no blocks pinch zoom (WCAG 1.4.4 failure) on an app whose smallest type is 4.5px |
| [4](#u-4) | High | [Recorder.js:42](src/automation/Recorder.js#L42) | Record silently destroys the existing loop with no confirmation and no possible undo |
| [5](#u-5) | High | [PointerHandler.js:74](src/input/PointerHandler.js#L74) | The instrument cannot be played at all without a pointer, and the playing surface is invisible to assistive tech |
| [6](#u-6) | High | [main.js:1230](src/main.js#L1230) | The 'R' shortcut bypasses every disabled-button guard and hijacks Ctrl+R / Cmd+R (browser reload) |
| [7](#u-7) | High | [main.js:518](src/main.js#L518) | Dropping a .json file on the waveform wipes the entire workspace with no confirmation and no undo |
| [8](#u-8) | High | [main.js:152](src/main.js#L152) | The audio-unlock splash can only be dismissed by pointerdown — keyboard users can never enter the app |
| [9](#u-9) | High | [InstanceManager.js:128](src/state/InstanceManager.js#L128) | Background tabs keep playing with zero indication in the tab bar |
| [10](#u-10) | High | [TransportBar.js:319](src/ui/TransportBar.js#L319) | Overdub button is enabled and clickable in idle, but clicking it does nothing at all |
| [11](#u-11) | High | [voiceColors.js:6](src/ui/voiceColors.js#L6) | voiceColors.js is a hardcoded dark-theme palette — grain and pointer feedback is invisible on the light canvas |
| [12](#u-12) | High | [style.css:805](style.css#L805) | On a phone in portrait the parameter panel overflows the viewport and is permanently unreachable — no scrollbar |
| [13](#u-13) | High | [style.css:805](style.css#L805) | Parameter panel overflows the viewport and cannot be scrolled — bottom half of the controls is unreachable on a phone in portrait _(dup of #12)_ |
| [14](#u-14) | High | [style.css:411](style.css#L411) | 44px transport buttons silently collapse to ~23px wide on any phone — the transport bar has no wrap and the buttons have no min-width |
| [15](#u-15) | High | [style.css:37](style.css#L37) | Light theme fails WCAG AA on essentially every label and every parameter readout |
| [16](#u-16) | High | [style.css:1288](style.css#L1288) | Audio unlock splash hardcodes a near-black backdrop but themes its text — "Tap to start" renders at 1.20:1 in light mode |
| [17](#u-17) | Medium | [index.html:5](index.html#L5) | `user-scalable=no` blocks pinch-zoom _(dup of #3)_ |
| [18](#u-18) | Medium | [GranularEngine.js:52](src/audio/GranularEngine.js#L52) | `fetch` has no `response.ok` check — a 404 becomes a generic decode error |
| [19](#u-19) | Medium | [main.js:176](src/main.js#L176) | The core XY mapping (Y = pitch) is never communicated, and the surface actively suggests the wrong meaning |
| [20](#u-20) | Medium | [main.js:1107](src/main.js#L1107) | Snap-to-grid button reads OFF while snapping is being forced ON in loop-station mode |
| [21](#u-21) | Medium | [main.js:949](src/main.js#L949) | Default loop-station mode gives a completely silent count-in, so the first bar of the performance is lost |
| [22](#u-22) | Medium | [main.js:1236](src/main.js#L1236) | Undo exists but is invisible, keyboard-only, idle-only, single-level, and gives no confirmation |
| [23](#u-23) | Medium | [main.js:512](src/main.js#L512) | Sample-load failures and ignored drops are reported almost invisibly, while trivial session events get toasts |
| [24](#u-24) | Medium | [main.js:602](src/main.js#L602) | After a reload, a session built on a user's own file becomes a dead, non-responsive pad |
| [25](#u-25) | Medium | [main.js:219](src/main.js#L219) | Mapping any gesture dimension to Pitch silently makes the entire vertical axis of the pad inert |
| [26](#u-26) | Medium | [main.js:35](src/main.js#L35) | Unguarded top-level `localStorage` access kills the entire module — the app dies to a dead screen with no message |
| [27](#u-27) | Medium | [main.js:512](src/main.js#L512) | Load failures surface only as truncated grey text in a 200px span, and leave the previous sample audibly playing under a label that says 'Error' _(dup of #23)_ |
| [28](#u-28) | Medium | [main.js:518](src/main.js#L518) | Dropping a non-audio file does nothing at all — no message, no console output |
| [29](#u-29) | Medium | [main.js:1321](src/main.js#L1321) | Fixed-length recording auto-stop lives in the rAF loop — backgrounding the tab breaks it |
| [30](#u-30) | Medium | [main.js:535](src/main.js#L535) | Multi-megabyte bundled samples load behind a single grey 'Loading...' string, and session restore fetches them serially |
| [31](#u-31) | Medium | [main.js:140](src/main.js#L140) | AudioContext failures are invisible: `resume()` is fire-and-forget, `'interrupted'` is never handled, and construction is unguarded |
| [32](#u-32) | Medium | [GhostRenderer.js:100](src/ui/GhostRenderer.js#L100) | The transport metaphor claims to be a sample player; it is actually a gesture-automation player |
| [33](#u-33) | Medium | [ParameterPanel.js:868](src/ui/ParameterPanel.js#L868) | Min sliders and the Pan range are dead controls with no explanation of what would activate them |
| [34](#u-34) | Medium | [TabBar.js:49](src/ui/TabBar.js#L49) | Closing a tab destroys the instance and its recording with no confirmation; the × is permanently visible on touch |
| [35](#u-35) | Medium | [TabBar.js:62](src/ui/TabBar.js#L62) | Renaming a tab calls window.prompt(), which blocks the timer-driven grain and metronome schedulers |
| [36](#u-36) | Medium | [TabBar.js:45](src/ui/TabBar.js#L45) | Tab close is a click-only `<span>` nested inside a `<button>`, invisible until hover — tabs cannot be closed or renamed by keyboard |
| [37](#u-37) | Medium | [TabBar.js:29](src/ui/TabBar.js#L29) | Rebuilding the tab strip with `innerHTML = ''` destroys keyboard focus on every switch |
| [38](#u-38) | Medium | [TransportBar.js:303](src/ui/TransportBar.js#L303) | No live regions: transport state, count-in, and every toast are silent to assistive tech |
| [39](#u-39) | Medium | [TransportBar.js:317](src/ui/TransportBar.js#L317) | Record is enabled with no sample loaded and leads to a silent dead end |
| [40](#u-40) | Medium | [WaveformDisplay.js:231](src/ui/WaveformDisplay.js#L231) | The app's only onboarding text sits at 2.26:1 (dark) / 2.43:1 (light) and names a button that does not exist |
| [41](#u-41) | Medium | [fileLoader.js:11](src/utils/fileLoader.js#L11) | No global drag guard — a near-miss file drop navigates the browser away from the running instrument |
| [42](#u-42) | Medium | [style.css:719](style.css#L719) | Loop handles and bar-count buttons are far below touch size on a self-described multitouch instrument |
| [43](#u-43) | Medium | [style.css:495](style.css#L495) | No `prefers-reduced-motion` support anywhere; several animations run infinitely |
| [44](#u-44) | Medium | [style.css:719](style.css#L719) | Touch targets fall well below the 44px the design doc claims, and below the 24px WCAG floor _(dup of #42)_ |
| [45](#u-45) | Medium | [style.css:1](style.css#L1) | Zero focus styling anywhere in 1551 lines of CSS |
| [46](#u-46) | Medium | [style.css:302](style.css#L302) | Touch-target audit: nine interactive controls sit between 16px and 36px, against a documented 44px requirement |
| [47](#u-47) | Medium | [style.css:1144](style.css#L1144) | The Randomize toggle row cannot fit on any phone — `.toggle-row` is a non-wrapping flex row of four switches |
| [48](#u-48) | Medium | [style.css:1407](style.css#L1407) | Type scale bottoms out below legibility: a 4.5px SVG label, a 9px status badge, and 10px uppercase labels |
| [49](#u-49) | Medium | [style.css:992](style.css#L992) | Half the Sound Engine panel is dimmed to 1.62:1 and click-blocked by default with no explanation |
| [50](#u-50) | Medium | [style.css:179](style.css#L179) | Top-bar sliders use native OS rendering while panel sliders are fully custom — two visual languages in one screen |
| [51](#u-51) | Medium | [style.css:54](style.css#L54) | Colour system has 32 literals with ad-hoc one-offs that bypass the token layer |
| [52](#u-52) | Low | [granular-sampler-implementation-plan.md:303](agents/granular-sampler-implementation-plan.md#L303) | Design-doc drift: the promised side-by-side wide-screen layout was never built, and the palette exceeded its spec |
| [53](#u-53) | Low | [index.html:440](index.html#L440) | No `<noscript>` and no module fallback: a load failure leaves a complete-looking but entirely dead UI |
| [54](#u-54) | Low | [GrainScheduler.js:16](src/audio/GrainScheduler.js#L16) | Parameter changes are heard up to a grain-length later with no pending feedback |
| [55](#u-55) | Low | [TransportBar.js:105](src/ui/TransportBar.js#L105) | The progress rail looks like a scrubber but cannot be seeked or clicked |
| [56](#u-56) | Low | [TransportBar.js:324](src/ui/TransportBar.js#L324) | Armed and count-in states are visually identical, and neither is visible on the performance surface |
| [57](#u-57) | Low | [WaveformDisplay.js:235](src/ui/WaveformDisplay.js#L235) | The only instructional text in the app is wrong and is unreachable in the default flow |
| [58](#u-58) | Low | [style.css:274](style.css#L274) | No focus indicator is designed anywhere in the stylesheet |
| [59](#u-59) | Low | [style.css:983](style.css#L983) | Quantized value labels starve the slider they annotate — `min-width: 52px` + `nowrap` + `flex-shrink: 0` against `flex: 1` |
| [60](#u-60) | Low | [style.css:168](style.css#L168) | Two competing `margin-left: auto` in the header split the free space, so the tempo cluster floats mid-bar instead of right-aligning |
| [61](#u-61) | Low | [style.css:274](style.css#L274) | Tab labels have no max-width or ellipsis, and the tab strip's scrollbar is hidden with no affordance |
| [62](#u-62) | Low | [style.css:842](style.css#L842) | `auto-fill` leaves empty grid tracks on wide screens, shrinking each control to a seventh of the panel |
| [63](#u-63) | Nit | [style.css:810](style.css#L810) | Dead and inert CSS: an overflow that never triggers, padding on fixed-size buttons, a fallback that can't fire |

---

# Critical (1)

<a id="u-1"></a>
### 1. All seven quantize/randomize toggles are `display: none` checkboxes — unreachable by keyboard and absent from the accessibility tree

**Critical** · `accessibility` · [style.css:1160](style.css#L1160)

`.toggle-label input[type="checkbox"] { display: none; }` (style.css:1160-1162). `display: none` removes an element from the tab order *and* from the accessibility tree. The visual switch is a sibling `<span class="toggle-switch">` styled off `input:checked +` (style.css:1186-1193), which is a decorative span with no role and no state. This affects `#quantize-grain-size`, `#quantize-density`, `#quantize-pitch`, `#random-grain-size`, `#random-density`, `#random-pitch`, `#random-pan` (index.html:184, 207, 230, 240, 245, 250, 255) — every rhythm/harmony toggle in the app.

**How it fails**

> A keyboard user tabs through the Rhythm and Harmony section: focus jumps from the Scale select straight to the `#subdiv-grain-size` select, skipping the Grain Size quantize toggle that *enables* that select. Since `_quantizeGrainSize.checked` is false and the subdiv select is `disabled` (index.html:188), the user can reach nothing in that row and can never turn quantization on. A screen-reader user is told the section contains three plain selects and no checkboxes at all.

**Suggested fix**

Replace `display: none` with a visually-hidden but focusable pattern: `position: absolute; opacity: 0; width: 1px; height: 1px;` (or `appearance: none` and style the input directly), and add `:focus-visible` styling on the adjacent `.toggle-switch` so the focus position is visible.

---

# High (15)

<a id="u-2"></a>
### 2. Eight of the most-used sliders have no accessible name — the `<label>` elements are orphans

**High** · `accessibility` · [index.html:298](index.html#L298)

`<label>Grain Size</label>` (index.html:298), `<label>Density</label>` (313), `<label>Spread</label>` (328), `<label>Pan</label>` (342), `<label>Quantize</label>` (181), `<label>Randomize</label>` (237), `<label>Arp Shape ...</label>` (284) all lack a `for` attribute and do not wrap their controls. The `<span class="range-label">Min</span>` / `Max` markers (index.html:300, 305) are plain spans, not labels. So `#param-grain-size-min`, `#param-grain-size-max`, `#param-density-min/max`, `#param-spread-min/max`, `#param-pan-min/max` — eight range inputs — have no programmatic name whatsoever. Contrast with `#master-volume` (index.html:45) and `#param-bpm` (51), which do have correct `for`/`id` pairs, so the pattern was known and just not applied here. `#sample-select` (index.html:24) has neither a label nor even a `title`.

**How it fails**

> A screen-reader user tabs into the Sound Engine section and hears 'slider, 0.87', 'slider, 0.87', 'slider, 0.65', 'slider, 0.65', 'slider, 0', 'slider, 0' — six identical anonymous sliders in a row, with no way to tell Grain Size from Density, or Min from Max. The visible '400 ms' readout in `#val-grain-size-min` is also unassociated, so the value is announced as a raw 0–1 normal that means nothing.

**Suggested fix**

Give each range-group label an `id` and put `aria-labelledby="grainsize-label grainsize-min-label"` on each slider (or simply `aria-label="Grain size minimum"`). Add `aria-describedby` pointing at the `.param-value` span so the human-readable '400 ms' is announced instead of 0.8674. Add a label to `#sample-select`.

<a id="u-3"></a>
### 3. user-scalable=no blocks pinch zoom (WCAG 1.4.4 failure) on an app whose smallest type is 4.5px

**High** · `accessibility` · [index.html:5](index.html#L5)

`<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">` (index.html:5). This is a common reflex for canvas/touch apps, but the correct fix for stray double-tap zoom is `touch-action: none`, which the code already applies where it matters — `#waveform-canvas { touch-action: none }` (style.css:377), `#adsr-canvas` (1101), `.arp-style-preview` (1397) — plus the `touchstart`/`touchmove` preventDefault at main.js:160-161. So the zoom lock buys nothing and costs the user their only remedy for the sub-legible type this UI ships: 4.5px SVG labels, 9px status badges, 10px range labels.

**How it fails**

> A user who cannot read the 9px `.gesture-status` badges or the arp note names pinches to zoom on iOS/Android and nothing happens; there is no in-app text-size control either.

**Suggested fix**

Drop `user-scalable=no` from the viewport meta. The existing per-element `touch-action: none` already prevents zoom on the interactive canvases.

<a id="u-4"></a>
### 4. Record silently destroys the existing loop with no confirmation and no possible undo

**High** · `mistake-recovery` · [Recorder.js:42](src/automation/Recorder.js#L42)

Unchanged in substance. Correction: in the default loop-station mode the destructive `_lane.clear()` is deferred until the count-in completes (main.js:856-866), and pressing record again during count-in cancels harmlessly, so the user has roughly one bar of grace. In free-form mode and after the count-in elapses, the loss is immediate and unrecoverable exactly as described.

**How it fails**

> A performer has built a good 4-bar loop over several overdub passes. They press Stop to breathe, then reach for Play and hit Record instead (the two buttons are adjacent 44px squares, index.html:109-120). One bar of count-in later the lane is empty and the entire layered performance is gone permanently, mid-set.

**Suggested fix**

Snapshot the lane into `_undoSnapshot` in `startRecording()` instead of nulling it, so Ctrl+Z / an Undo button can restore the previous take. Additionally, when `getRecording().length > 0`, require a confirming second press (record button flashes "replace?") or route the destructive path through an explicit "New take" control.

<a id="u-5"></a>
### 5. The instrument cannot be played at all without a pointer, and the playing surface is invisible to assistive tech

**High** · `accessibility` · [PointerHandler.js:74](src/input/PointerHandler.js#L74)

The entire performance surface is bound exclusively to pointer events: `canvas.addEventListener('pointerdown', ...)` / `'pointermove'` / `'pointerup'` / `'pointercancel'` (PointerHandler.js:74-77). There is no `keydown` path into `callbacks.onStart`. The canvas itself is `<canvas id="waveform-canvas"></canvas>` (index.html:98) — empty element content, no `tabindex`, no `role`, no `aria-label`, no fallback children. A grep across index.html, style.css and all of src/ returns zero occurrences of `aria`, `role=` or `tabindex`. So the canvas is neither focusable nor named nor described: a screen reader announces nothing at all where the instrument lives, and a keyboard user has no way to start a single grain voice. The only keyboard bindings in the whole app are `r` and `Ctrl/Cmd+Z` (src/main.js:1230-1245), and `r` merely *arms* recording — actual capture still requires `onStart` from a real pointer (src/main.js:376-381), so even the one documented shortcut is a dead end without a mouse.

**How it fails**

> A keyboard-only or screen-reader user loads the app, tabs to the waveform area — focus skips straight over it to the transport buttons. Nothing is announced. Pressing R arms recording; the record button pulses red forever because `transport.state === 'armed'` only advances inside `pointer.onStart`. The user can configure every parameter but can never produce sound.

**Suggested fix**

Give the canvas `tabindex="0"`, `role="application"` (or `img` + description when idle) and an `aria-label` describing the sample and the X=position / Y=pitch mapping. Add a keyboard path: arrow keys to move a virtual pointer, Space/Enter to start and stop a voice, routed through the same `callbacks.onStart/onMove/onStop` contract PointerHandler already exposes. At minimum add a visible non-canvas fallback (two sliders for position/pitch plus a play/hold button) so the instrument is operable without a pointer.

<a id="u-6"></a>
### 6. The 'R' shortcut bypasses every disabled-button guard and hijacks Ctrl+R / Cmd+R (browser reload)

**High** · `mistake-recovery` · [main.js:1230](src/main.js#L1230)

Confirmed as written. Severity adjusted from critical to high only because reaching the destructive outcome still requires the count-in to elapse in the default loop-station mode (see the record-clears-lane finding); the browser-reload hijack itself is unconditional.

**How it fails**

> A performer with a loop running wants to reload the page after a glitch and presses Ctrl+R. The reload is cancelled by `e.preventDefault()`, the loop stops, a count-in fires, and eight seconds later the loop has been overwritten with silence. The same happens if they type 'r' anywhere outside a form control.

**Suggested fix**

Add `if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;` before the 'r' branch, and gate the shortcut on `!recordBtn.disabled` so the keyboard and the mouse obey the same state machine. Surface the shortcut in a help/legend overlay.

<a id="u-7"></a>
### 7. Dropping a .json file on the waveform wipes the entire workspace with no confirmation and no undo

**High** · `mistake-recovery` · [main.js:518](src/main.js#L518)

`handleDroppedFile` routes on the extension: `if (file.name.toLowerCase().endsWith('.json')) { importSessionFromFile(file); }` (src/main.js:519-520). `importSessionFromFile` calls `instanceManager.restoreFromSession(...)` which destroys everything first — `for (const [, entry] of this.instances) { ... entry.engine.dispose(); } this.instances.clear();` (src/state/InstanceManager.js:251-257) — then overwrites localStorage via `persistence.scheduleSave()` (src/main.js:776). There is no confirm step, no diff, and no way back: the previous session's only copy was the localStorage entry that has just been overwritten. The same destruction is one click behind the `Import` button (index.html:41), which sits directly beside `Export` with identical styling (style.css:146-161).

**How it fails**

> A user drags what they think is an audio file onto the pad but grabs the session JSON sitting next to it in the folder. Every tab, every recorded loop and every parameter in the current set is replaced instantly, and the auto-save then destroys the localStorage backup.

**Suggested fix**

Require an explicit confirmation for any import that would replace existing instances or recordings, and snapshot the outgoing session (to a `granul8-session-prev` key) so the toast can offer "Undo import".

<a id="u-8"></a>
### 8. The audio-unlock splash can only be dismissed by pointerdown — keyboard users can never enter the app

**High** · `accessibility` · [main.js:152](src/main.js#L152)

`unlockOverlay?.addEventListener('pointerdown', dismissUnlockOverlay, { once: true })` plus a document-level `pointerdown` listener (src/main.js:152-156) are the only ways to dismiss the full-screen gate. The overlay is a `<div id="audio-unlock-overlay">` (index.html:10) with no `tabindex`, no `role="dialog"`, no `aria-modal`, no button element, and no `keydown` handler. It is `position: fixed; inset: 0; z-index: 100` with `backdrop-filter: blur(6px)` (style.css:1282-1293). Nothing sets `inert` or `aria-hidden` on `#app`, so all controls behind the blurred, click-blocking overlay remain in the tab order — the inverse of a focus trap: focus goes places the user cannot see or click.

**How it fails**

> A keyboard-only user loads the page in Safari or any browser where `audioContext.state !== 'running'`. They press Tab repeatedly: focus lands on the sample select, Load File, Export, sliders — all behind an opaque blurred overlay. Enter/Space anywhere does nothing to the overlay. There is no reachable control to dismiss it, so the app is permanently unusable.

**Suggested fix**

Make the unlock affordance a real `<button>` with `role="dialog"`/`aria-modal="true"` on the container, move focus to it on load, dismiss on `click` (which fires for Enter/Space) rather than `pointerdown`, and set `inert` on `#app` while the overlay is up.

<a id="u-9"></a>
### 9. Background tabs keep playing with zero indication in the tab bar

**High** · `state-visibility` · [InstanceManager.js:128](src/state/InstanceManager.js#L128)

`switchTo` deliberately leaves other instances running — "Stop any active recording on the old tab (playback continues in background)" (src/state/InstanceManager.js:128-131) — and the player/frame callbacks are gated on the active tab (`if (this.activeId === instanceId && this.onPlayerFrame)`, src/state/InstanceManager.js:79). But `TabBar.render` draws only a label and a close × (src/ui/TabBar.js:31-54): no playing indicator, no level, no record dot. The transport bar likewise only ever reflects the active tab (`transport.setState(...)` from `active?.player.isPlaying`, src/main.js:452-457). The only global feedback that anything else is sounding is the shared output meter, which is fed by `masterBus.analyser` for everything at once (src/main.js:126-129).

**How it fails**

> A performer stacks three sampler tabs into a layered loop, then switches to tab 1 to tweak it. Tab 3 has drifted or is too loud, but the tab strip looks identical for all three, and Stop only affects tab 1. To silence tab 3 they must guess which tab it is, switch to it (killing their edit context), and press Stop — several seconds of fumbling in front of an audience.

**Suggested fix**

Render per-tab transport state in the tab strip (a pulsing dot for playing, red for recording, plus a per-tab mute/stop button), so a multi-instance set can be managed without switching context.

<a id="u-10"></a>
### 10. Overdub button is enabled and clickable in idle, but clicking it does nothing at all

**High** · `feedback` · [TransportBar.js:319](src/ui/TransportBar.js#L319)

In the idle state the button is enabled whenever a recording exists: `case 'idle': ... overdubBtn.disabled = !this._hasRecording;` (src/ui/TransportBar.js:319). But the handler immediately bails in that state: `if (transport.state !== 'playing' && transport.state !== 'overdubbing') return;` (src/main.js:1020). So a lit, hover-highlighted, 44px button with `title="Overdub — layer new gestures on existing recording"` (index.html:112) is a no-op in the exact state a user is most likely to press it from — after recording a loop and stopping.

**How it fails**

> User records a loop, presses Stop, then presses Overdub to add a layer. Nothing happens — no sound, no state change, no message. They press it three more times, conclude overdub is broken, and give up on the feature.

**Suggested fix**

Either disable the button in idle (`overdubBtn.disabled = true` in the idle case) or, better, make `onOverdub` start playback first when idle with a recording present — the code to do that already exists at src/main.js:1037-1041 and is simply unreachable because of the guard.

<a id="u-11"></a>
### 11. voiceColors.js is a hardcoded dark-theme palette — grain and pointer feedback is invisible on the light canvas

**High** · `theming` · [voiceColors.js:6](src/ui/voiceColors.js#L6)

`VOICE_COLORS` (voiceColors.js:6-17) is ten literal RGB triplets, with the file comment stating "10 distinct, high-contrast colors on a warm dark background". They are consumed by `PointerHandler._drawPointer` (PointerHandler.js:240-273), `GrainOverlay.draw` (GrainOverlay.js:82-92) and `GhostRenderer._drawGhost` (GhostRenderer.js:120-159), all of which draw onto the waveform canvas whose background *is* themed (`--canvas-bg`, style.css:29/53, read at WaveformDisplay.js:38). At full opacity on the light canvas `#ede8e2` these colours measure 1.29:1 (voice 3 `#f0c88c`), 1.35:1 (voice 7), 1.55:1, 1.67:1 (voice 0) — versus 8.70-11.25:1 on the dark canvas. At the alpha values actually used — `opacity *= g.amplitude * 0.7` then `* 0.3` for the body and `* 0.6` for the core (GrainOverlay.js:64, 85, 91), i.e. 0.168/0.336 at the default amplitude 0.8 from main.js:190 — the grain body computes to **1.09:1** and the core to **1.18:1** on light, versus 1.39/2.09:1 on dark. Separately, `GhostRenderer` adds two more non-themed literals: the recording tint `rgba(224, 60, 60, 0.06)` (GhostRenderer.js:75), which is not even `--record-red` `rgb(224,85,85)`, and the playback cursor `rgba(255, 255, 255, 0.25)` (GhostRenderer.js:103) — white-on-white in light mode.

**How it fails**

> In light theme the entire visual feedback layer — the thing that tells a performer which finger drives which voice and where grains are firing — washes out to a barely-perceptible haze; the automation playback cursor disappears entirely against `#ede8e2`.

**Suggested fix**

Emit the palette as CSS custom properties (`--voice-0`…`--voice-9`) with light and dark variants, and read them the way `WaveformDisplay._readThemeColors()` already does (WaveformDisplay.js:36-43), re-reading on `onThemeChange`. Replace the two literals in GhostRenderer.js:75 and 103 with `--record-red` and `--text-primary` derived values.

<a id="u-12"></a>
### 12. On a phone in portrait the parameter panel overflows the viewport and is permanently unreachable — no scrollbar

**High** · `robustness` · [style.css:805](style.css#L805)

`#parameter-panel { flex-shrink: 0; overflow-y: auto; }` (style.css:805-811) inside `#main-area { display: flex; flex-direction: column; flex: 1; min-height: 0 }` (style.css:357-362), under `html, body { height: 100%; overflow: hidden }` (style.css:65-72). With `flex-shrink: 0` the panel keeps its full content height, so its own `overflow-y: auto` never engages — the overflow happens on `#main-area`, which has no overflow rule, and is then clipped by `body { overflow: hidden }`. `#waveform-container` has `min-height: 150px` (style.css:368) so it cannot absorb the excess. Both `<details>` sections ship `open` (index.html:141, 294), and at ≤600px `.section-content` becomes a 2-column grid (style.css:1496-1500), which makes the panel taller, not shorter. The only mitigation is `@media (max-height: 420px) { #parameter-panel { max-height: 120px } }` (style.css:1533-1551), which only fires in landscape.

**How it fails**

> iPhone in portrait (375×667). Top bar wraps to ~3 rows, tab bar ~30px, waveform pinned at 150px, transport ~56px, then Rhythm-and-Harmony plus Sound Engine stacked at full content height (~600px). Total far exceeds 667px. The Gesture Mapping section, the Envelope/ADSR editor and the Volume slider sit below the fold with no scrollbar and no way to scroll to them — on the exact device class the README markets ('for the web and multitouch devices', index.html:13).

**Suggested fix**

Let the panel be the scroll container: give `#parameter-panel` `flex: 1 1 auto; min-height: 0;` (or `overflow-y: auto` on `#main-area` with `min-height: 0`), and drop `flex-shrink: 0`. Verify with all `<details>` open at 375×667.

<a id="u-13"></a>
### 13. Parameter panel overflows the viewport and cannot be scrolled — bottom half of the controls is unreachable on a phone in portrait

**High** · `responsive-layout` · [style.css:805](style.css#L805)

> **Same defect as [#12](#u-12)**, found independently by the `ux-a11y-robustness` lens. Kept because it adds detail the other report does not have — fix them together.

Confirmed mechanism and CSS. Two corrections to the consequence: (1) the user is not trapped — both panel sections are <details> with their <summary> at the top of the panel (index.html:141, 294), so collapsing 'Rhythm and Harmony' reveals the rest, which makes this a serious usability failure rather than a total lockout; (2) below 380px the grid collapses to a single column (style.css:1511-1514) rather than staying at two, so the panel is taller than the report's estimate on the narrowest devices. Fix as suggested: flex-shrink:1 + min-height:0 on #parameter-panel.

**How it fails**

> iPhone 14 (393x852) in portrait, fresh load with default markup: the user can see the Grain Size and Density sliders but everything below (Spread, Pan, Volume, Envelope/ADSR, and the entire Gesture Mapping section) is clipped off-screen with no scrollbar and no scroll gesture available — `body` is `overflow:hidden` and the panel's own `overflow-y:auto` is inert.

**Suggested fix**

Give the panel a real scroll box: replace `flex-shrink: 0` with `flex-shrink: 1` plus `min-height: 0` (and optionally `max-height: 45vh`), so the flex algorithm constrains its height and `overflow-y: auto` actually engages. Keep `#waveform-container` at `flex: 1 1 auto; min-height: 150px` so the instrument surface keeps priority.

<a id="u-14"></a>
### 14. 44px transport buttons silently collapse to ~23px wide on any phone — the transport bar has no wrap and the buttons have no min-width

**High** · `touch-targets` · [style.css:411](style.css#L411)

Confirmed. One correction that makes it worse, not better: the four .bar-count-btn buttons render at 44x44, not 24x24 — `#transport-bar button { width:44px; height:44px }` (style.css:411-412, specificity 1-0-1) overrides `.bar-count-btn { width:24px; height:24px }` (0-1-0) regardless of source order — and the selector is visible by default since InstanceState.js:53 defaults loopStationMode to true. The over-subscription at 393px is therefore roughly 175px worse than the report's estimate.

**How it fails**

> Any phone under ~560px of transport-bar width (i.e. every phone in portrait): Record/Overdub/Play/Stop/Loop/Snap/LS render as ~23px-wide slivers. On a device whose entire premise is multitouch performance, hitting Stop mid-take becomes a coin flip, and the two media queries guarantee even the uncrowded case is 40px or 36px.

**Suggested fix**

Use `min-width: 44px; min-height: 44px; flex-shrink: 0` on `#transport-bar button`, add `flex-wrap: wrap` to `#transport-bar`, and delete the 40x40 / 36x36 overrides at style.css:1526 and 1542 (shrink the level meter and time display instead — those have no touch role).

<a id="u-15"></a>
### 15. Light theme fails WCAG AA on essentially every label and every parameter readout

**High** · `contrast` · [style.css:37](style.css#L37)

Computed ratios for the exact pairs declared in `[data-theme="light"]` (style.css:37-63). `--text-secondary: #7a6e64` is the colour of `.param-group label` (855-861), `.tab-item` (281), `.tempo-bpm label` (206), `#sample-name` (132), `#time-display` (800), `.range-label` (935), `.toggle-label` (1155): on `--bg-primary #f5f0eb` = **4.37:1**, on `--bg-secondary #ede8e2` = **4.06:1**, on `--bg-surface #e2dbd4` (`#tap-tempo` 1119-1121, `.bar-count-btn` 566-568, `.arp-style-nav button` 1376-1377) = **3.61:1**. All are below the 4.5:1 AA threshold for the 10-13px text they are applied to. Worse, `--accent: #c47a4a` on `--bg-primary` = **2.98:1**, and `.param-value { color: var(--accent) }` (863-866) is the *numeric readout of every single parameter* — grain size in ms, density, pan, volume, BPM, arp index. Same accent on `--bg-surface` = **2.46:1**. The dark theme scrapes by (4.89 / 4.59 / 4.10 / 9.28:1) which is presumably why this went unnoticed; the light palette was built by eye as a mirror image, not re-measured.

**How it fails**

> User taps `#theme-toggle` (index.html:83) in a bright room — the exact condition light mode exists for — and every parameter value (`400 ms`, `0.70`, `120`) drops to 2.98:1 against the panel, roughly the legibility of light-grey-on-white. `#tap-tempo` and the bar-count buttons land at 3.61:1 at 10-11px.

**Suggested fix**

Darken the light-theme tokens: `--text-secondary` to about `#5f554c` (≈6.0:1 on `--bg-primary`) and `--accent` to about `#9a5526` (≈4.6:1) — or split the accent into `--accent` (for fills/strokes, where 3:1 suffices) and `--accent-text` (for `.param-value` and any accent-coloured text).

<a id="u-16"></a>
### 16. Audio unlock splash hardcodes a near-black backdrop but themes its text — "Tap to start" renders at 1.20:1 in light mode

**High** · `contrast` · [style.css:1288](style.css#L1288)

`#audio-unlock-overlay { background: rgba(18, 17, 15, 0.85); ... backdrop-filter: blur(6px) }` (style.css:1282-1293) is the dark `--bg-primary` baked in as a literal, but its children use theme variables: `.unlock-content { color: var(--text-primary) }` (1296-1297), `.unlock-title { color: var(--accent) }` (1306), `.unlock-description { color: var(--text-secondary) }` (1312). `main.js:35-36` applies the saved theme (`localStorage 'granul8-theme'`) *before* the overlay is dismissed, so a returning light-theme user gets light-theme text on a hardcoded near-black scrim. Composited (0.85 over `#f5f0eb` → `#34322f`): `.unlock-text` "Tap to start" (`var(--text-primary) #2a2420`, 20px, style.css:1338-1342) = **1.20:1**; the `.unlock-title` "Granul8" = 3.79:1. In dark mode the same text is 15.49:1, so the bug is invisible to anyone testing only the default theme.

**How it fails**

> User sets light theme, reloads. `masterBus.audioContext.state !== 'running'` so the overlay stays (main.js:149-157). They see a dark blurred rectangle with a dim orange "Granul8" and an invisible instruction, plus an `.unlock-icon` play triangle in `--accent` (1327-1336). No indication that a tap is required — the app looks hung.

**Suggested fix**

Derive the scrim from the theme: `background: color-mix(in srgb, var(--bg-primary) 85%, transparent)`, which already has a precedent in this file (style.css:480, 502, 585).

---

# Medium (35)

<a id="u-17"></a>
### 17. `user-scalable=no` blocks pinch-zoom

**Medium** · `accessibility` · [index.html:5](index.html#L5)

> **Same defect as [#3](#u-3)**, found independently by the `ux-visual` lens. Kept because it adds detail the other report does not have — fix them together.

`<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">` (index.html:5). This is a direct WCAG 2.1 SC 1.4.4 (Resize Text) failure. It matters more than usual here because the interface leans on very small type: `.gesture-status` at `font-size: 9px` with `opacity: 0.7` (style.css:1060-1070), `.range-label` at 10px (style.css:933), `.arp-label` at 4.5px inside the SVG (style.css:1409), `#tap-tempo` at 10px (style.css:1116), and `.range-row .param-value` at 11px (style.css:984). iOS Safari ignores the directive, but Android Chrome and desktop Chrome honour it.

**How it fails**

> A low-vision user on an Android tablet cannot pinch-zoom to read the 9px 'not detected' gesture-capability badges or the 4.5px note names in the arpeggiator SVG. There is no in-app text-size control to compensate.

**Suggested fix**

Drop `user-scalable=no` (touch-action: none on the canvas and #adsr-canvas already prevents the gesture conflicts it was presumably added for), and raise the sub-11px type to at least 11–12px.

<a id="u-18"></a>
### 18. `fetch` has no `response.ok` check — a 404 becomes a generic decode error

**Medium** · `error-states` · [GranularEngine.js:52](src/audio/GranularEngine.js#L52)

`async loadSample(url) { const response = await fetch(url); const arrayBuffer = await response.arrayBuffer(); return this._decodeAndStore(arrayBuffer); }` (GranularEngine.js:52-56). A 404/403/500 resolves the promise normally; the HTML error body is passed to `decodeAudioData`, which throws `EncodingError`. This matters here because every bundled sample path contains spaces and apostrophes (e.g. `samples/Slaveya Women's Vocal Ensemble - Hey Petrunka.mp3`, index.html:28) — exactly the paths most likely to 404 behind a mis-configured static host or a sub-path deployment.

**How it fails**

> The app is deployed under a sub-path, or on a host that rejects unencoded spaces. Every sample in the dropdown 404s. The user sees 'Error loading sample' with no distinction between 'file not found' and 'this codec is unsupported', and the console shows a misleading `EncodingError` rather than the 404.

**Suggested fix**

`if (!response.ok) throw new Error(`HTTP ${response.status} loading ${url}`);` before `arrayBuffer()`, and pass the message through to the toast so network and codec failures are distinguishable.

<a id="u-19"></a>
### 19. The core XY mapping (Y = pitch) is never communicated, and the surface actively suggests the wrong meaning

**Medium** · `discoverability` · [main.js:176](src/main.js#L176)

Same defect, but note the mitigating feedback the report omits: GrainOverlay.draw (src/ui/GrainOverlay.js:74-78) positions grain rectangles on a pitch-derived Y axis that coincides with the finger's Y, so the mapping is implicitly demonstrated even though it is never labelled. The genuine, verified problems are (a) no axis labels, gridlines or legend on the canvas, (b) the code and jsdoc still call the Y value `amplitude` (PointerHandler.js:83, :91; main.js:190) while grain amplitude is the constant 0.8 (main.js:189), and (c) agents/CLAUDE.md:157 contradicts both the implementation and README.md:132.

**How it fails**

> A musician opens the app, sees a waveform, and presses near the top of the display because that is where the waveform is loud. Instead of getting a loud grain they get a grain two octaves up. They slide down to "get quieter" and the pitch drops an octave. Because grain amplitude is pinned at 0.8 regardless of Y, no vertical movement ever changes loudness, so the model they built in the first ten seconds is wrong and never self-corrects.

**Suggested fix**

Draw the axis semantics onto the canvas itself: faint horizontal gridlines at −2/−1/0/+1/+2 octaves with labels, and an X-axis label ("read position"). Rename `amplitude` to `pitchY` (or `y`) through PointerHandler/main so the code stops lying. Fix agents/CLAUDE.md:157 to match the implementation.

<a id="u-20"></a>
### 20. Snap-to-grid button reads OFF while snapping is being forced ON in loop-station mode

**Medium** · `state-visibility` · [main.js:1107](src/main.js#L1107)

Same defect, one detail corrected: the forced state is not pixel-identical to plain-off. `#transport-bar button:disabled { opacity: 0.35 }` (style.css:428-431) wins on specificity over `.snap-forced { opacity: 0.5 }` (style.css:546-550), so the force-locked snap button renders at 0.35 opacity — dimmer than the plain off state (0.5), i.e. it reads as 'unavailable' rather than 'on and locked'. The core problem stands: snapping is behaviourally forced on (main.js:1206-1213) while `.snap-active` is never applied to anything in the codebase.

**How it fails**

> A user in loop-station mode drags the loop-end handle to a musically interesting off-grid point. The handle visibly jumps back to a bar line. They look at the snap button, see it dimmed like every other off toggle, and cannot work out what is moving their loop points.

**Suggested fix**

When a control is force-locked by a mode, show it in its true state and mark it as locked (e.g. apply `.snap-active` plus a lock affordance and a `title` explaining "forced on by Loop Station mode"), rather than reusing the dimmed/off styling for "locked".

<a id="u-21"></a>
### 21. Default loop-station mode gives a completely silent count-in, so the first bar of the performance is lost

**Medium** · `feedback` · [main.js:949](src/main.js#L949)

Same defect (a count-in whose clicks are muted by default), with one correction: the countdown is not rendered in ordinary 14px monospace — TransportBar.setCountInDisplay adds `.count-in-display`, which restyles #time-display to 16px/700 weight in the accent colour (style.css:588-593). The valid complaint is that all count-in feedback is confined to the header (beat dots + time display) and none of it appears on the waveform canvas where the performer's attention is, and the clicks are silent unless the metronome toggle happens to be on.

**How it fails**

> First-time user presses Record at 120 BPM, hears nothing for two seconds, assumes the button did not register, and starts playing immediately. Their first two seconds are discarded; recording begins mid-phrase and the resulting loop starts on a bar line that has nothing to do with what they played.

**Suggested fix**

Render the count-in on the performance surface itself (a full-canvas beat number / flashing border via GhostRenderer, which already owns a canvas-wide tint at src/ui/GhostRenderer.js:74-77), and audition the count-in clicks even when the metronome toggle is off — a count-in whose entire purpose is timing should never be silent.

<a id="u-22"></a>
### 22. Undo exists but is invisible, keyboard-only, idle-only, single-level, and gives no confirmation

**Medium** · `mistake-recovery` · [main.js:1236](src/main.js#L1236)

Confirmed as written. Nuance: pressing Stop moves the transport to idle, at which point Ctrl+Z does recover the last pre-overdub snapshot — so on a desktop the loss is one pass, not the whole loop. On the stated touch target there is genuinely no undo affordance of any kind, which is the substance of the finding.

**How it fails**

> On an iPad, a performer fumbles a 4-bar overdub pass. The loop wraps, `onPlayerLoopWrap` merges the fumble permanently into the lane and starts a new pass, and there is no gesture, button or menu anywhere on the device that can remove it. Their only option is Record, which erases the whole loop.

**Suggested fix**

Add a visible Undo button to the transport bar, enabled whenever `recorder.canUndo`, working from `overdubbing` as well as `idle`, with a toast confirming what was undone. Consider keeping a small stack of pre-overdub snapshots rather than one.

<a id="u-23"></a>
### 23. Sample-load failures and ignored drops are reported almost invisibly, while trivial session events get toasts

**Medium** · `feedback` · [main.js:512](src/main.js#L512)

Confirmed. Correction to the example: isAudioFile (src/utils/fileLoader.js:64-69) accepts anything whose MIME type starts with 'audio/', so an .aiff typed 'audio/x-aiff' is accepted; the silent-drop path is reached only when the browser reports an empty/non-audio type AND the extension is outside the wav/mp3/ogg/aac/flac/webm/m4a allowlist. The core defect — no else branch in handleDroppedFile (main.js:518-524) and all load errors reported only as text in a 200px truncating span — is verified.

**How it fails**

> A user drags a .aiff (not in the extension allowlist at src/utils/fileLoader.js:69 and often typed as `audio/x-aiff`... or as an empty type) onto the pad. The drop overlay hides, nothing loads, nothing is said, and the previous sample keeps playing. They try twice more before concluding drag-and-drop is broken.

**Suggested fix**

Route all sample-load outcomes through `showNotification()` (error variant for failures, including an explicit "Unsupported file type" for rejected drops), and show a real loading indicator over the waveform rather than a word in a 200px span.

<a id="u-24"></a>
### 24. After a reload, a session built on a user's own file becomes a dead, non-responsive pad

**Medium** · `feedback` · [main.js:602](src/main.js#L602)

User-loaded files cannot be re-fetched, so restore marks them missing: `state.sampleDisplayName = \`⚠ ${state.sampleDisplayName || state.sampleFileName} (missing)\`; entry.buffer = null; ... waveform.setBuffer(null);` (src/main.js:602-610). The recorded automation lane survives (restored at src/state/InstanceManager.js:309-318) but is inaudible, because every voice start bails without a buffer: `startVoice(pointerId, params) { if (!this.sourceBuffer) return undefined; ...}` (src/audio/GranularEngine.js:87-88). Live touch is equally dead — `onStart` returns early (`if (!active || !active.engine.sourceBuffer) return undefined;` src/main.js:373) and PointerHandler only registers the pointer `if (voiceId != null)` (src/input/PointerHandler.js:140), so not even the pointer circle draws. The only signal is the warning glyph inside the truncating 200px `#sample-name` span, and there is no "relink file" affordance.

**How it fails**

> A performer builds a set on their own drum loop, closes the laptop, reopens the page before the gig. The waveform is blank, touching it does absolutely nothing (no sound, no visual), Play runs the transport silently, and the only clue is a clipped "⚠ mydrums.wav (mi…" in the header.

**Suggested fix**

When a restored instance has `sampleFileName` but no buffer, draw an explicit re-link prompt on the canvas ("mydrums.wav is missing — tap to relocate") wired to the file picker, and disable/annotate the transport for that instance instead of letting it run silently.

<a id="u-25"></a>
### 25. Mapping any gesture dimension to Pitch silently makes the entire vertical axis of the pad inert

**Medium** · `interaction-design` · [main.js:219](src/main.js#L219)

`resolveParams` seeds pitch from Y (`let pitch = yToPitch(g.amplitude);` src/main.js:190) and then unconditionally overwrites it if any gesture dimension targets pitch: `case 'pitch': pitch = Math.pow(2, lerp(-2, 2, effectiveGv)); break;` (src/main.js:219-221). Since Y feeds nothing else (grain amplitude is the constant 0.8 at src/main.js:189), the vertical axis then controls nothing whatsoever. The UI never says so: the pointer indicator still tracks Y (`const y = amplitude * canvasHeight;` src/input/PointerHandler.js:239), and `updateGestureIndicators` only draws indicators for grainSize/density/spread/pan (src/ui/ParameterPanel.js:771-801) — pitch has no indicator at all.

**How it fails**

> A user with a stylus sets Pressure → Pitch in the Gesture Mapping panel to get expressive pitch bends. Back on the pad, sliding up and down now does nothing audible even though the coloured circle still tracks the finger. Nothing connects the two facts, and the pad feels half-broken.

**Suggested fix**

When a gesture dimension is mapped to pitch, visibly retire the Y axis on the canvas (dim the vertical gridlines, collapse the pointer indicator to a vertical bar) and note the takeover in the mapping row, so the axis handoff is legible.

<a id="u-26"></a>
### 26. Unguarded top-level `localStorage` access kills the entire module — the app dies to a dead screen with no message

**Medium** · `robustness` · [main.js:35](src/main.js#L35)

main.js:35 reads and main.js:31 writes localStorage at module top level with no try/catch, so a SecurityError aborts the whole ES module — no MasterBus, no render loop, and the unlock overlay is never wired or removed, giving a dead splash with no message. persistence.clear() (main.js:689) is unguarded too. Realistic triggers are Chrome with all cookies blocked and sandboxed iframes lacking allow-same-origin (not modern Safari Private Browsing, which no longer throws). SessionPersistence's own quota failures are also swallowed as console.warn.

**How it fails**

> User opens the app in a Safari private window. `localStorage.getItem` throws at line 35. The module never finishes evaluating, so `unlockOverlay` is never wired and never removed. The user sees the Granul8 splash with 'Tap to start', taps repeatedly, and nothing ever happens. No error, no fallback, no console message they will see.

**Suggested fix**

Wrap all direct localStorage access in a small `safeStorage` helper that try/catches get/set/remove and degrades to an in-memory Map. Surface a one-time toast — 'Session saving unavailable in this browser mode' — instead of failing silently, and surface `QuotaExceededError` from `_writeToLocalStorage` to the user too.

<a id="u-27"></a>
### 27. Load failures surface only as truncated grey text in a 200px span, and leave the previous sample audibly playing under a label that says 'Error'

**Medium** · `error-states` · [main.js:512](src/main.js#L512)

> **Same defect as [#23](#u-23)**, found independently by the `ux-visual` lens. Kept because it adds detail the other report does not have — fix them together.

`handleFile`'s catch does `console.error(...)` then `sampleNameEl.textContent = 'Error loading file'` (src/main.js:512-515); `loadSampleFromUrl`'s catch is identical with 'Error loading sample' (src/main.js:542-545). `#sample-name` is `font-size: 13px; color: var(--text-secondary); max-width: 200px; text-overflow: ellipsis` (style.css:130-137) — the same muted grey used for the normal sample title, with no error colour, no icon, no toast, and no `role="alert"`, even though a working toast system exists two functions away (`showNotification`, src/main.js:792). Worse, `_decodeAndStore` (GranularEngine.js:73-79) calls `_allocator.releaseAll()` *before* `decodeAudioData` but never clears `this.sourceBuffer` on failure, and `setActiveSample` is never reached — so the previously loaded sample stays loaded and fully playable while the UI claims an error. `markSampleMissing` has the same truncation problem: it writes `⚠ {name} (missing)` (src/main.js:603) into that same 200px ellipsised span, so on any realistic sample name the '(missing)' is clipped off.

**How it fails**

> User drags in a .flac that Chrome cannot decode. The label flips to 'Error loading file' in the same grey as before, easily missed. They keep playing and hear the *old* sample — the app is now lying about what is loaded. On restore of a session whose bundled sample 404s, they see '⚠ Real Vocal String Quartet — …' with the '(missing)' marker truncated away.

**Suggested fix**

Route all load failures through `showNotification(msg, true)` with the actual reason (decode error vs network error), set `sourceBuffer = null` and `waveform.setBuffer(null)` so the UI state matches the audio state, and give `#sample-name` an error modifier class with `--accent-warm` plus a `title` carrying the full untruncated text.

<a id="u-28"></a>
### 28. Dropping a non-audio file does nothing at all — no message, no console output

**Medium** · `error-states` · [main.js:518](src/main.js#L518)

`handleDroppedFile` (src/main.js:518-524) has exactly two branches — `.json` and `isAudioFile(file)` — and no `else`. `isAudioFile` (fileLoader.js:65-70) requires `type.startsWith('audio/')` or one of seven extensions, so a `.aiff`, `.opus`, `.mp4`, an image, or an audio file the OS reports with an empty MIME type falls through silently. The drop handler also reads only `e.dataTransfer.files[0]` (fileLoader.js:33), so a multi-file drop silently discards the rest, and the overlay hides on drop (fileLoader.js:31) making it look like something happened.

**How it fails**

> User drags three .aiff files onto the waveform. The dashed drop overlay appears and disappears exactly as it does on success. Nothing loads, nothing is said, nothing is logged. The user assumes the app froze.

**Suggested fix**

Add an `else showNotification(`Unsupported file: ${file.name}`, true)` branch, extend the extension allow-list (aiff, opus, mp4, m4b), and when `files.length > 1` tell the user only the first was used.

<a id="u-29"></a>
### 29. Fixed-length recording auto-stop lives in the rAF loop — backgrounding the tab breaks it

**Medium** · `robustness` · [main.js:1321](src/main.js#L1321)

The auto-stop for bar-count recording is `if (elapsed >= fixedRecordDuration) finishRecording(active);` inside `render()` (src/main.js:1321-1323), which is driven by `requestAnimationFrame(render)` (src/main.js:1330). Browsers throttle rAF to ~1fps or pause it entirely in background tabs and on hidden documents. There is no `visibilitychange` handler anywhere in the codebase (grep returns zero hits) and no audio-clock-based fallback, even though `masterBus.audioContext.currentTime` and `recorder.getElapsedTime()` are both available and unaffected by tab visibility.

**How it fails**

> User starts a 4-bar loop-station recording, then switches to another browser tab to read the sample credits. rAF stops. The recorder keeps running against the audio clock. They come back 30 seconds later to a recording that never stopped, a lane far longer than 4 bars, and a loop that no longer matches the bar grid.

**Suggested fix**

Schedule the auto-stop off the audio clock (a `setTimeout` armed at `startRecording` for `fixedRecordDuration`, re-verified against `recorder.getElapsedTime()`), and treat the rAF check as display-only. Add a `visibilitychange` handler that reconciles transport state on return.

<a id="u-30"></a>
### 30. Multi-megabyte bundled samples load behind a single grey 'Loading...' string, and session restore fetches them serially

**Medium** · `loading-states` · [main.js:535](src/main.js#L535)

As reported, except that handleFile does set feedback before its awaits — sampleNameEl.textContent = file.name at main.js:505 — so it is not 'no loading state at all', merely a name with no in-flight indication. The remaining claims (single grey 'Loading...' at 535, 2.0–11.5 MB bundled MP3s, no progress/spinner/cancel, unguarded racing loads, serial restore at InstanceManager.js:341-345) all verify.

**How it fails**

> On a mobile connection a user restores a four-tab session, three of which use the 11.5 MB Tibetan Monks sample. That is ~35 MB fetched one after another. For a minute or more the app shows an empty waveform with 'Drop an audio file here…', no progress, no toast, and every tab visually present but silent. Nothing distinguishes this from a crash.

**Suggested fix**

Draw a determinate loading state on the canvas itself (bytes received via a streaming `fetch` reader, or at minimum an indeterminate bar), disable `#sample-select` and `#load-sample-btn` while a load is in flight, guard against out-of-order responses with a request token, and load restored instances in parallel with `Promise.all` — or lazily, on first tab activation.

<a id="u-31"></a>
### 31. AudioContext failures are invisible: `resume()` is fire-and-forget, `'interrupted'` is never handled, and construction is unguarded

**Medium** · `error-states` · [main.js:140](src/main.js#L140)

`dismissUnlockOverlay()` calls `masterBus.resume()` and immediately tears down the overlay (src/main.js:139-147) without awaiting the promise or re-checking `audioContext.state`. `MasterBus.resume()` only acts `if (this.audioContext.state === 'suspended')` (MasterBus.js:49-53), so Safari's non-standard `'interrupted'` state (phone call, Siri, other app taking the session) is never recovered from. There is no `audioContext.onstatechange` listener anywhere in src/ (grep: zero hits). `new AudioContext()` (MasterBus.js:10) is unguarded and there is no `webkitAudioContext` fallback, so on a browser lacking it the constructor throws inside the module graph and takes down all of main.js — the same dead-splash failure mode as the localStorage issue. The README acknowledges 'no feature detection or fallback' (README.md:436-437), so this is a known choice, but the *user-facing* result is an app that looks alive and does nothing.

**How it fails**

> An iPhone user takes a call mid-session. The context enters `'interrupted'`. On return, `resume()` is never called because the state is not `'suspended'`, the transport UI keeps animating, the level meter keeps reading the analyser (all zeros), and the app is permanently silent with no indication that audio has stopped.

**Suggested fix**

`await masterBus.resume()` and verify `state === 'running'` before removing the overlay; if it is not, keep the overlay and show 'Audio is blocked — tap again'. Register `audioContext.onstatechange` to catch `'interrupted'`/`'suspended'` and surface a persistent 'Audio suspended, tap to resume' banner. Wrap the AudioContext construction in a try/catch that renders a plain-HTML unsupported-browser message instead of dying silently.

<a id="u-32"></a>
### 32. The transport metaphor claims to be a sample player; it is actually a gesture-automation player

**Medium** · `conceptual-model` · [GhostRenderer.js:100](src/ui/GhostRenderer.js#L100)

The real, verified defect is the axis collision: GhostRenderer's playback cursor sweeps X as automation-lane progress (GhostRenderer.js:100-108) across a canvas where X means buffer read position for grains (GrainOverlay.js:69) and pointers (PointerHandler.js:238). The report's 'press Play and get silence' scenario does not occur — the Play button is disabled whenever there is no recording (TransportBar.js:320), so the misleading-transport-vocabulary argument rests entirely on the cursor, not on a dead Play button.

**How it fails**

> A user loads a 3-minute track, presses Play expecting to hear the track, and gets silence (there is no recording yet, so `onPlay` returns at src/main.js:972). Later, during loop playback, they read the sweeping line as "we are 40% through the sample" and cannot understand why grains are firing at the far right while the cursor is at the left.

**Suggested fix**

Move the playback cursor out of the buffer-position axis — draw it as a thin horizontal timeline strip above or below the waveform rather than as a vertical line across it — and label the transport ("Gesture loop") so Play is not read as "play the sample".

<a id="u-33"></a>
### 33. Min sliders and the Pan range are dead controls with no explanation of what would activate them

**Medium** · `discoverability` · [ParameterPanel.js:868](src/ui/ParameterPanel.js#L868)

Confirmed, and worse than stated: 'pan' is not an option in any gesture-mapping select (index.html:369-374, 390-395, 411-416) and resolveParams has no 'pan' case, so `hasMapping('pan')` in ParameterPanel.js:873 is always false — the Pan Min row is unlockable only via the Randomize Pan checkbox. Everything else in the finding (inert Min rows with no stated precondition, `pan: p.panMax` at main.js:311 making 'Max' the de-facto value control) is verified.

**How it fails**

> A user wants to pan the instrument left. They drag the Pan "Min" slider to −1 and nothing moves — it is dimmed and swallows the gesture. They eventually drag "Max" to −1, which pans left, and are left with a mental model where "Max" means "the value".

**Suggested fix**

Label the inactive rows with the unlock condition (e.g. a small "enable Randomize or map a gesture" hint on the dimmed row, or a tooltip on the dimmed control), and when a range is collapsed to a single value show one slider labelled with the parameter name rather than a Min/Max pair where Max silently means "value".

<a id="u-34"></a>
### 34. Closing a tab destroys the instance and its recording with no confirmation; the × is permanently visible on touch

**Medium** · `mistake-recovery` · [TabBar.js:49](src/ui/TabBar.js#L49)

Confirmed as written, with the caveat that the close affordance is only rendered when `tabs.length > 1` (TabBar.js:43), so a single-instance session cannot hit this. The real defect is the absence of any confirm or reopen-closed-tab path for an action that permanently discards a recorded automation lane.

**How it fails**

> On a tablet the performer taps to switch from "Drums" to "Pads" during a set, lands a few pixels right of centre on the always-visible ×, and the drum loop they spent five minutes building disappears instantly with no dialog and no recovery.

**Suggested fix**

Confirm before closing any instance that has a non-empty recording, or implement a short-lived closed-tab stash ("Reopen closed sampler") shown in the toast. On coarse pointers, require a long-press or a secondary confirm rather than a 16px tap target.

<a id="u-35"></a>
### 35. Renaming a tab calls window.prompt(), which blocks the timer-driven grain and metronome schedulers

**Medium** · `interaction-design` · [TabBar.js:62](src/ui/TabBar.js#L62)

Rename is `btn.addEventListener('dblclick', (e) => { ... const newName = prompt('Rename instance:', tab.name); ... })` (src/ui/TabBar.js:62-68). `prompt()` blocks the main thread for as long as the dialog is open. Both audio schedulers are main-thread `setTimeout` loops with only a 100ms look-ahead: `this._timerId = setTimeout(() => this._tick(), this.timerInterval);` with `scheduleAhead = 0.1` (src/audio/GrainScheduler.js:16, 113) and the same in `Metronome._tick` (src/audio/Metronome.js:146, 168). The rAF render loop (src/main.js:1292-1333) and `Player._tick` (src/automation/Player.js:314) also stall. The gesture is undiscoverable too — nothing in the UI hints that double-click renames.

**How it fails**

> Mid-loop, the performer double-clicks a tab to relabel it. Roughly 100ms after the dialog appears the granular texture and the click track both cut out, the canvas freezes, and playback resumes with a hole in it when they dismiss the prompt.

**Suggested fix**

Replace `prompt()` with inline `contenteditable` editing of the tab label (or a non-blocking in-page dialog), and add a visible rename affordance (long-press on touch, context menu on desktop).

<a id="u-36"></a>
### 36. Tab close is a click-only `<span>` nested inside a `<button>`, invisible until hover — tabs cannot be closed or renamed by keyboard

**Medium** · `accessibility` · [TabBar.js:45](src/ui/TabBar.js#L45)

`const close = document.createElement('span'); close.className = 'tab-close'; ... close.addEventListener('click', ...)` (TabBar.js:45-53) appends an interactive span *inside* `btn` (TabBar.js:32, 53) — invalid HTML (interactive content inside a button), not focusable, no role, accessible name only from `title="Close"`. CSS makes it `opacity: 0` until `:hover` (style.css:314, 320-323), with a `@media (pointer: coarse)` override for touch (style.css:350-354) but nothing for `:focus-within`. Renaming is bound to `dblclick` only (TabBar.js:62-68) and uses a blocking `prompt()`. The tab strip itself is `<div id="tab-bar"><div id="tab-list">` (index.html:91-92) with no `role="tablist"`/`"tab"` and no `aria-selected` — the active tab is signalled purely by `color` and a 2px `border-bottom-color` (style.css:296-299).

**How it fails**

> A keyboard user has four sampler tabs open and wants to close one. Tabbing reaches each `.tab-item` button; Enter switches to it. The × is never focusable and never rendered (opacity 0 without hover). There is no other close affordance anywhere in the UI, so tabs can be created (`#tab-add`) but never destroyed without a mouse. Renaming, being dblclick-only, is equally impossible.

**Suggested fix**

Make the close control a sibling `<button type="button" aria-label={`Close ${tab.name}`}>` outside the tab button, revealed on `:hover, :focus-within`. Add `role="tablist"`/`role="tab"`/`aria-selected` and arrow-key roving focus. Bind rename to a keyboard-reachable action (F2, or a context button) and replace `prompt()` with an inline text input — `prompt()` is blocked outright in sandboxed and cross-origin iframes.

<a id="u-37"></a>
### 37. Rebuilding the tab strip with `innerHTML = ''` destroys keyboard focus on every switch

**Medium** · `accessibility` · [TabBar.js:29](src/ui/TabBar.js#L29)

`render(tabs)` starts with `this._listEl.innerHTML = '';` (TabBar.js:29) and recreates every tab button from scratch. `onSwitch` → `instanceManager.switchTo(id)` → `onTabsChanged` → `tabBar.render(...)` (src/main.js:495-498), so *activating a tab always destroys the element that was just activated*. Removing the focused element resets `document.activeElement` to `<body>`. The same wipe happens on add, close, and rename. `TransportBar.updateBeatIndicator` uses the same pattern (TransportBar.js:275) but contains no focusables, so only the tab strip is affected.

**How it fails**

> A keyboard user tabs six times to reach 'Sampler 3' and presses Enter. The tab switches — and focus is thrown back to the top of the document. To reach 'Sampler 4' they must tab all six positions again. Screen readers additionally lose their reading position and announce nothing about the switch.

**Suggested fix**

Diff and reuse existing tab elements instead of wiping, or capture `document.activeElement`'s `data-tabId` before the wipe and restore focus to the corresponding new element after re-render.

<a id="u-38"></a>
### 38. No live regions: transport state, count-in, and every toast are silent to assistive tech

**Medium** · `accessibility` · [TransportBar.js:303](src/ui/TransportBar.js#L303)

`_updateButtons()` (TransportBar.js:303-368) communicates every transport state change purely by CSS class — `recordBtn.classList.add('recording')`, `playBtn.classList.add('playing')` — rendered as colour plus a `record-pulse` animation (style.css:487-498). The count-in countdown writes to `#time-display` via `setCountInDisplay` (TransportBar.js:237-240) and bar progress via `setBarProgressDisplay` (247-250), both plain spans with no `aria-live`. `showNotification` (src/main.js:792-804) creates a `div.session-toast` with `pointer-events: none` (style.css:238) and no `role="status"`/`"alert"`, then removes it after 2s. None of the toggle buttons (`#btn-metronome`, `#btn-snap-grid`, `#btn-loop-station`, `#btn-loop`, `.bar-count-btn`) carry `aria-pressed`; state is `classList.toggle('active', ...)` only (src/main.js:1061, 1089, 1164).

**How it fails**

> A screen-reader user presses Record in loop-station mode. A 4-beat count-in runs (`- 4 -`, `- 3 -` … in `#time-display`), then recording starts and runs for 4 bars, then auto-stops and begins looping. Not one of those transitions is announced. The user cannot tell whether they are armed, counting in, recording, or playing. Likewise 'Import failed: …' (src/main.js:781) appears and vanishes with no announcement.

**Suggested fix**

Add a visually-hidden `<div aria-live="polite">` for transport transitions (write 'Count-in, 4 beats' / 'Recording, bar 1 of 4' / 'Playing, looping' / 'Stopped' once per transition, not per frame), give the toast container `role="status"` (and `role="alert"` for the error variant), and add `aria-pressed` to every toggle button so state is exposed rather than painted.

<a id="u-39"></a>
### 39. Record is enabled with no sample loaded and leads to a silent dead end

**Medium** · `error-states` · [TransportBar.js:317](src/ui/TransportBar.js#L317)

In the `'idle'` case `_updateButtons()` sets `recordBtn.disabled = false` unconditionally (TransportBar.js:317) — nothing gates the transport on whether `engine.sourceBuffer` exists. Meanwhile `pointer.onStart` bails out with `if (!active || !active.engine.sourceBuffer) return undefined;` (src/main.js:373), silently swallowing every touch. In free-form mode `transport.onRecord` just sets `'armed'` (src/main.js:963) and waits for a first touch that can never register. In loop-station mode it runs a full metronome count-in and `beginFixedRecording()` (src/main.js:856-867) starts a recorder with no buffer, plays out N bars of 'Bar 1 / 4' progress, then `finishRecording` finds `getRecording().length === 0` and quietly returns to idle. No message is shown in either path.

**How it fails**

> User adds a second tab via `#tab-add` — `onAdd` sets `sampleNameEl.textContent = 'No sample loaded'` (src/main.js:489) — then presses Record. In free-form the button pulses red indefinitely and touching the waveform does nothing at all. In loop-station mode they sit through a count-in and four bars of recording UI and end up with an empty lane, Play still disabled, and zero explanation.

**Suggested fix**

Disable Record (and Overdub/Play) whenever the active instance has no `sourceBuffer`, and add a `title`/`aria-describedby` explaining why. Better: show an inline empty-state message on the canvas and a toast — 'Load a sample before recording' — when Record is pressed with no buffer.

<a id="u-40"></a>
### 40. The app's only onboarding text sits at 2.26:1 (dark) / 2.43:1 (light) and names a button that does not exist

**Medium** · `contrast` · [WaveformDisplay.js:231](src/ui/WaveformDisplay.js#L231)

`WaveformDisplay._drawEmpty()` paints the empty-state instruction with `ctx.fillStyle = this._hintColor` (WaveformDisplay.js:231), i.e. `--canvas-hint` — `#5a5048` dark (style.css:29) and `#a09488` light (57) — over `--canvas-bg` `#1a1816` / `#ede8e2`. Measured: **2.26:1** dark, **2.43:1** light, against a 4.5:1 requirement for the 14px text used (`${14 * devicePixelRatio}px`, WaveformDisplay.js:232). The string is `'Drop an audio file here or click "Load Sample"'` (line 235) but the button in the markup is labelled **"Load File"** (index.html:36); "Load Sample" is instead the label pattern of the `<select id="sample-select">` placeholder ("— Select a sample —", index.html:25). The same 45-character string is drawn at a fixed 14px regardless of canvas width, so at 320px it measures ~300px wide and touches both edges. Note also `<title>Granular Sampler</title>` (index.html:6) versus the `<h1>Granul8</h1>` (index.html:22) — the browser tab and any bookmark carry a different product name than the UI.

**How it fails**

> A first-time user with no sample loaded sees a nearly-illegible line of grey text, squints at it, and then looks for a "Load Sample" button that is not on screen.

**Suggested fix**

Move `--canvas-hint` to `#8a8078` dark / `#6b6058` light (matching `--text-secondary`, 4.6-5.6:1), change the string to match the actual button label, and either wrap the text or scale it down below ~400px canvas width.

<a id="u-41"></a>
### 41. No global drag guard — a near-miss file drop navigates the browser away from the running instrument

**Medium** · `mistake-recovery` · [fileLoader.js:11](src/utils/fileLoader.js#L11)

Confirmed exactly as described. Impact is a lost AudioContext and interrupted set rather than data loss — the session persists in localStorage and is restored on return — which is why this is medium rather than high.

**How it fails**

> Mid-set the performer drags a new sample toward the pad, releases 20px low over the transport bar, and the browser navigates to the raw mp3. The AudioContext is gone, all voices stop, and they have to go back and wait for the session to reload.

**Suggested fix**

Add `document.addEventListener('dragover', e => e.preventDefault())` and a `document`-level `drop` handler that either forwards the file to `handleDroppedFile` or is a no-op — never allow the default navigation.

<a id="u-42"></a>
### 42. Loop handles and bar-count buttons are far below touch size on a self-described multitouch instrument

**Medium** · `touch-ergonomics` · [style.css:719](style.css#L719)

The loop handles are the real defect: `.loop-handle { width:6px; height:16px }` (style.css:719-730) on a `height:4px` rail (style.css:687-694), with no click-to-seek fallback. `#tap-tempo` (28px), `.subdiv-select` (~20px) and the 40px/36px transport overrides at style.css:1526 and 1542 also hold. Remove the bar-count claim: `.bar-count-btn`'s 24x24 declaration is overridden by `#transport-bar button { width:44px; height:44px }` on specificity, so those buttons are actually 44x44.

**How it fails**

> On a tablet the performer tries to shorten the loop by dragging the end handle. A fingertip covers roughly 40px, so they repeatedly grab the wrong handle or miss the rail entirely; because the rail has no click-to-seek there is no fallback, and the loop stays wrong for the rest of the take.

**Suggested fix**

Give the loop handles an invisible expanded hit area (a ::before of 44×44px), raise the progress rail hit region on coarse pointers, and bump `.bar-count-btn` to at least 36–44px under `@media (pointer: coarse)`.

<a id="u-43"></a>
### 43. No `prefers-reduced-motion` support anywhere; several animations run infinitely

**Medium** · `accessibility` · [style.css:495](style.css#L495)

Zero occurrences of `prefers-reduced-motion` in style.css. Continuously looping animations: `@keyframes record-pulse` at `1s ease-in-out infinite` on the armed and recording states (style.css:484, 492, 495-498), `@keyframes random-pulse` at `1.2s ease-in-out infinite` on every active `.random-range-bar` (style.css:1034, 1037-1040) — up to three of these pulse simultaneously — plus the per-frame sinusoidal pulse drawn on every pointer indicator (`const pulse = 1 + 0.12 * Math.sin(now * 6 * Math.PI)`, PointerHandler.js:243) and the unconditional `requestAnimationFrame` loop (src/main.js:1330) that repaints the canvas forever whether or not anything changed.

**How it fails**

> A user with vestibular sensitivity or migraine triggers enables Reduce Motion at the OS level. Granul8 ignores it: arming record produces a 1Hz full-button flash, enabling two randomize toggles adds two more out-of-phase pulsing bars, and every touch point breathes at 3Hz. Nothing can be turned off.

**Suggested fix**

Add `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important } }` and replace the pulse with a static state colour. Read the same query in JS (`matchMedia('(prefers-reduced-motion: reduce)').matches`) to flatten the pointer-indicator pulse in PointerHandler._drawPointer.

<a id="u-44"></a>
### 44. Touch targets fall well below the 44px the design doc claims, and below the 24px WCAG floor

**Medium** · `accessibility` · [style.css:719](style.css#L719)

> **Same defect as [#42](#u-42)**, found independently by the `ux-visual` lens. Kept because it adds detail the other report does not have — fix them together.

Same as reported minus .snap-btn: #btn-snap-grid is a #transport-bar child (index.html:124) and therefore is a full 44x44 target — only .metronome-btn (header, index.html:78) is undersized by that mechanism. Verified undersized: .loop-handle 6x16 (style.css:719-730), .tab-close 16x16 (303-305), .bar-count-btn 24x24 (563-565), #tap-tempo 28px tall (1126), #theme-toggle 36x36 (1212-1214), plus transport buttons dropping to 40px/36px in the narrow and short viewports (1526-1529, 1542-1545). Note also that agents/CLAUDE.md:263 is a roadmap table with no status column; the '[DONE]' claim for Step 2.5 actually lives at agents/granular-sampler-implementation-plan.md:298.

**How it fails**

> On a tablet — the stated target platform — a performer tries to drag the loop-end handle mid-set. It is a 6px-wide sliver on a 4px-tall progress bar; a fingertip covers it entirely and the grab usually misses, hitting nothing (the bar has no click-to-seek fallback). Closing a tab means hitting a 16px ×.

**Suggested fix**

Give `.loop-handle` a transparent expanded hit area (`::before { inset: -14px -10px }`) while keeping the 6px visual, raise `.tab-close` and `.bar-count-btn` to at least 24px, and give the header toggle buttons explicit 36–44px boxes. Then correct the claim in agents/CLAUDE.md:263.

<a id="u-45"></a>
### 45. Zero focus styling anywhere in 1551 lines of CSS

**Medium** · `accessibility` · [style.css:1](style.css#L1)

The load-bearing defect is `.toggle-label input[type="checkbox"] { display: none }` (style.css:1160-1162), which makes all eleven Quantize/Randomize toggles unreachable by keyboard and invisible to assistive tech; combined with zero aria attributes in index.html, the icon-only transport buttons expose only a `title`. The secondary claim is overstated: no rule in style.css removes the UA focus ring, so buttons, tabs and <summary> still receive the browser default :focus-visible outline — the gap is that no theme-tuned focus style is defined, not that focus is invisible.

**How it fails**

> A keyboard user tabs through the app: on the default UA ring-suppressing paths there is no visible indication of position on the transport buttons, tabs, or `<summary>` elements, and the eleven toggle switches never receive focus at all because their inputs are `display:none`.

**Suggested fix**

Add a global `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }` plus a `.toggle-label input:focus-visible + .toggle-switch` variant, and swap `display:none` on the checkboxes for a visually-hidden pattern (`position:absolute; opacity:0; width:1px; height:1px`) so they stay focusable.

<a id="u-46"></a>
### 46. Touch-target audit: nine interactive controls sit between 16px and 36px, against a documented 44px requirement

**Medium** · `touch-targets` · [style.css:302](style.css#L302)

Same audit minus one entry: remove `.bar-count-btn` — `#transport-bar button { width:44px; height:44px }` (style.css:411-412) wins on specificity over `.bar-count-btn { width:24px; height:24px }` (style.css:563-565), so those buttons are already 44x44. The remaining eight measurements are verified, with .tab-close (16x16, the only way to delete an instance) and .loop-handle (6px wide) the worst offenders.

**How it fails**

> On a tablet — the stated target device — closing a tab requires hitting a 16x16px x, and dragging a loop point requires grabbing a 6px-wide handle; both are well under the ~44px (≈9mm) finger contact patch, and the loop handle is 7x narrower.

**Suggested fix**

Set `min-width/min-height: 44px` on `.tab-close`, `.bar-count-btn`, `#tab-add`, `#tap-tempo`, `#theme-toggle` and the two time-sig selects (use a transparent padded hit area if the visual should stay small), and give `.loop-handle` a `::before` pseudo-element expanding the hit region to 44x44 while keeping the 6px visual.

<a id="u-47"></a>
### 47. The Randomize toggle row cannot fit on any phone — `.toggle-row` is a non-wrapping flex row of four switches

**Medium** · `responsive-layout` · [style.css:1144](style.css#L1144)

`.toggle-row { display: flex; gap: 6px; align-items: center }` (style.css:1144-1148) has no `flex-wrap`. The Randomize group (index.html:236-260) puts four `.toggle-label`s in a single such row: Grain Size, Density, Pitch, Pan. Each is a 32px `.toggle-switch` + 6px gap + 12px label text (`.toggle-label`, 1150-1158) — "Grain Size" alone is ~58px — giving roughly 90 + 65 + 50 + 45 + 18px of gaps ≈ **270px minimum**, and `.quantize-toggles { grid-column: 1 / -1 }` (1140-1142) means the available width is the panel width minus padding: 373px at 393px viewport, but only **300px at 320px** (`padding: 0 10px 8px`, 1498). Because `#parameter-panel` combines `overflow-y: auto` with a `visible` overflow-x, the used overflow-x computes to `auto` — so this becomes a horizontal scroll region inside a vertically-scrolling panel.

**How it fails**

> iPhone SE (375px) or any 320px device: the "Pan" randomize toggle is pushed outside the panel's content box and is reachable only via an unexpected horizontal scroll nested inside the parameter panel.

**Suggested fix**

Add `flex-wrap: wrap; row-gap: 8px` to `.toggle-row`.

<a id="u-48"></a>
### 48. Type scale bottoms out below legibility: a 4.5px SVG label, a 9px status badge, and 10px uppercase labels

**Medium** · `typography` · [style.css:1407](style.css#L1407)

Same as reported, with one correction: .gesture-status measures ~2.9:1 on dark, not 4.27:1 — opacity:0.7 dims the badge background too, so the real contrast is worse than the finding states. The mitigating context is that the 4.5px .arp-label only renders when the arpeggiator UI is unhidden (#arp-style-group ships style='display:none', index.html:283).

**How it fails**

> A user enabling the arpeggiator sees the pitch-axis note names at ~7px — sub-pixel-hinted glyphs where C#4 and C#5 are indistinguishable — and cannot pinch to zoom because of `user-scalable=no` (index.html:5).

**Suggested fix**

Define a token scale (e.g. `--fs-xs:11px; --fs-sm:12px; --fs-md:13px; --fs-lg:16px`) and map roles to it; raise `.gesture-status` to 11px and `.arp-label` to at least 8 SVG units (≈12.8px rendered) or render the labels as HTML beside the SVG.

<a id="u-49"></a>
### 49. Half the Sound Engine panel is dimmed to 1.62:1 and click-blocked by default with no explanation

**Medium** · `visual-hierarchy` · [style.css:992](style.css#L992)

Accurate, but the title overstates the scope: it is the four Min rows of the Sound Engine section (not 'half the panel'), and Root Note / Scale are in the *Rhythm and Harmony* section, not Sound Engine. Everything else — 0.35 opacity (~1.5:1 composited), pointer-events:none with no disabled attribute, active by default on a fresh session — is verified.

**How it fails**

> First-run user opens the Sound Engine section and sees each parameter with a visible Max row and a ghost row above it that cannot be clicked; nothing on screen connects that state to the Randomize toggles two sections above, so the Min/Max range concept — the core of the instrument's expressive model — reads as broken UI.

**Suggested fix**

Raise the dim to ~0.55 (≈2.6:1) and use the real `disabled` attribute so keyboard and pointer agree; add a one-line hint on the range group ("Min applies when randomized or gesture-mapped") or hide the Min row entirely rather than showing a dead one.

<a id="u-50"></a>
### 50. Top-bar sliders use native OS rendering while panel sliders are fully custom — two visual languages in one screen

**Medium** · `visual-consistency` · [style.css:179](style.css#L179)

Three sliders are styled only with `accent-color`: `#master-volume { width: 80px; accent-color: var(--accent) }` (style.css:179-182), `.tempo-bpm input[type="range"] { width: 80px; accent-color: var(--accent) }` (211-214) and `#metronome-volume { width: 50px; accent-color: var(--accent) }` (652-655). Every slider inside the panel gets the full custom treatment — `-webkit-appearance: none`, a 4px track and an 18px round thumb at 44px total height (869-908), or 14px/32px in range rows (942-981). So the header shows platform-native slider chrome (Windows/macOS/Android each different, ~16-20px tall, square or capsule thumbs) inches away from the app's own round-thumb-on-thin-track language. The height gap is also a touch problem: the `height: 44px` rule is scoped to `.param-group input[type="range"]`, and none of these three sliders is inside a `.param-group`, so they keep the UA default of roughly 16-20px. `#metronome-volume` at 50px wide with `step="0.01"` (index.html:79) gives 0.5px of travel per step.

**How it fails**

> On Android Chrome the header BPM and volume sliders render with Material-style thumbs and ripple while the panel sliders below render as flat amber circles — and both header sliders are ~18px tall, unusable with a fingertip.

**Suggested fix**

Extract the custom slider rules into a `.slider` class applied to all `input[type=range]` regardless of container, and give the header sliders the same 44px hit height (with a smaller visual track if vertical space is tight).

<a id="u-51"></a>
### 51. Colour system has 32 literals with ad-hoc one-offs that bypass the token layer

**Medium** · `color-system` · [style.css:54](style.css#L54)

The stylesheet contains 21 distinct hex values and 11 distinct rgb/rgba literals. The 21 hexes are all inside the two `:root`/`[data-theme]` blocks (8-63) — that part is disciplined. The rgba literals are where it leaks: **six** hardcode accent RGB rather than deriving it — `rgba(232, 168, 124, 0.08)` on `#drop-overlay` (387) and `rgba(232, 168, 124, 0.15)` on `.gesture-status.active` (1073) stay orange-dark even in light theme; **two** hardcode white — `.gesture-status { background: rgba(255,255,255,0.06) }` (1067) and `.tab-close:hover { background: rgba(255,255,255,0.1) }` (327), both of which brighten *toward* the background in light mode and so vanish; and `rgba(18,17,15,0.85)` on the unlock overlay (1288). Most telling, the light-theme canvas tokens introduce a **fourth orange that exists nowhere else in the palette**: `--canvas-waveform: rgba(180, 110, 60, 0.7)` and `--canvas-waveform-fill: rgba(180, 110, 60, 0.15)` (54-55) — `rgb(180,110,60)` is `#b46e3c`, while the light accent is `#c47a4a` and `--canvas-adsr-stroke` is `#c47a4a` (60). In dark theme the equivalent `rgba(232,168,124,…)` (26-27) matches `--accent` exactly, so the waveform and the ADSR curve are the same hue in dark mode and different hues in light mode. Add `voiceColors.js:6-17` and the palette grows by ten more triplets, of which three duplicate existing tokens exactly (voice 0 = `--accent` dark, voice 1 = `--record-red` dark, voice 2 = `--play-green` dark) and seven are new.

**How it fails**

> Switch to light theme: the waveform draws in `#b46e3c` while the ADSR curve directly below draws in `#c47a4a` and the `.param-value` numbers in `#c47a4a` — three near-but-not-equal oranges in one viewport; the drop-target overlay and the "available" gesture badge keep their dark-theme orange tint; the tab close-button hover highlight disappears.

**Suggested fix**

Replace the accent rgba literals with `color-mix(in srgb, var(--accent) 8%, transparent)` (the file already uses `color-mix` at 480, 502, 585), introduce a `--overlay-hover` token instead of the two white rgbas, and set `--canvas-waveform` from the light `--accent` `#c47a4a` so the canvas and DOM share one hue.

---

# Low (11)

<a id="u-52"></a>
### 52. Design-doc drift: the promised side-by-side wide-screen layout was never built, and the palette exceeded its spec

**Low** · `doc-drift` · [granular-sampler-implementation-plan.md:303](agents/granular-sampler-implementation-plan.md#L303)

The plan states "**Responsive layout**: on narrow screens (< 768px), stack the control panel below the waveform. On wide screens, panel can sit to the right" (agents/granular-sampler-implementation-plan.md:303). The stylesheet contains no `min-width` media query at all — only `@media (pointer:coarse)` (350), `max-width: 768px` (1449), `max-width: 600px` (1476), `max-width: 380px` (1517) and `max-height: 420px` (1533). `#main-area { flex-direction: column }` (357-362) is unconditional, so a 2560px desktop gets exactly the same stacked layout as a phone, with the parameter grid simply fanning out to 7+ columns. Related drift: plan.md:263 specifies "a palette of 6–8 distinct, high-contrast colors" while `voiceColors.js:6-17` ships 10 (matching `MAX_POINTERS = 10`, PointerHandler.js:9); plan.md:304 and :171 require 44px touch targets across all sliders and buttons, honoured only for `#transport-bar button` and `.param-group` controls (see findings above); and CLAUDE.md:263 lists task 2.5 "Mobile/tablet polish: responsive layout, 44px touch targets, orientation" as scoped work whose outcome the code does not reflect.

**How it fails**

> Not a runtime failure. A contributor reading the plan expects a `min-width: 1024px` two-column rule to exist and will look for it; the wide-screen experience is also demonstrably worse than intended, since a 1440px display wastes its width on a 7-column parameter grid while the waveform — the instrument — is confined to whatever height the unbounded panel leaves it.

**Suggested fix**

Either implement the documented `@media (min-width: 1024px) { #main-area { flex-direction: row } }` variant with the panel as a fixed-width right rail, or update plan.md:303 and 263 to describe what was actually built.

<a id="u-53"></a>
### 53. No `<noscript>` and no module fallback: a load failure leaves a complete-looking but entirely dead UI

**Low** · `robustness` · [index.html:440](index.html#L440)

`<script type="module" src="src/main.js"></script>` (index.html:440) is the only script, and there is no `<noscript>` block anywhere in the document. Because the entire interface — header, tab bar, transport, all three parameter sections with every slider and select — is authored as static HTML (index.html:20-437), a browser with JS disabled, a browser that ignores `type="module"`, a CSP that blocks the module, or any top-level throw in main.js (see the localStorage and AudioContext findings) all produce the same result: a fully rendered, visually correct, completely inert application sitting behind the unlock splash.

**How it fails**

> A corporate-managed browser blocks the ES-module import. The user sees the Granul8 splash screen, taps 'Tap to start', and nothing happens — no error, no console message they will see, no hint that anything is wrong. They conclude the site is broken but cannot say how.

**Suggested fix**

Add a `<noscript>` explaining the requirement, and wrap the top of main.js in a try/catch (or add a `window.onerror` handler registered inline in `<head>`) that replaces the unlock overlay content with a readable failure message naming the missing capability.

<a id="u-54"></a>
### 54. Parameter changes are heard up to a grain-length later with no pending feedback

**Low** · `feedback` · [GrainScheduler.js:16](src/audio/GrainScheduler.js#L16)

Slider input updates the numeric readout and the voice synchronously (`this._updateRangeDisplay(rp.name); this.callbacks.onChange(this.getParams());` src/ui/ParameterPanel.js:87-88 → `active.engine.updateVoice(pointerId, resolved)` src/main.js:353), but `Voice.update` is documented as "Takes effect on the next scheduled grain" (src/audio/Voice.js:93) and the scheduler has already committed up to `this.scheduleAhead = 0.1` seconds of grains (src/audio/GrainScheduler.js:16, filled in the while loop at 91-111). Grains already sounding run to completion — up to `expMap(1, 1, 1000)` = 1000ms with the shipped slider range (src/ui/ParameterPanel.js:30), and 400ms at the default (index.html:301-308). So a change can take 0.5–1.4s to be fully audible while the number on screen has already snapped to the new value.

**How it fails**

> With the default 400ms grain size, a user nudges Grain Size while holding a note, hears no change for half a second, over-corrects, then hears both changes arrive at once and overshoots — the classic feedback-lag oscillation.

**Suggested fix**

Ramp the displayed value (or show a brief 'pending' tint on the slider) for the duration of `scheduleAhead + grainSize`, and consider re-arming `nextGrainTime` on large density changes so the new setting takes effect at the next grain boundary rather than after the look-ahead queue drains.

<a id="u-55"></a>
### 55. The progress rail looks like a scrubber but cannot be seeked or clicked

**Low** · `interaction-design` · [TransportBar.js:105](src/ui/TransportBar.js#L105)

Confirmed as written; downgraded to low because the consequence is an unavailable convenience (jump within the loop) rather than a failure or loss. Note also that before a recording exists the rail carries no handles and no fill motion, so the scrubber read is weakest exactly when seeking would be meaningless.

**How it fails**

> During a rehearsal the performer wants to jump to the second half of an 8-second loop to check a transition. They tap the middle of the rail — the universal gesture for that — and nothing happens, twice. There is no other way to move the playhead, so they have to let the loop run round.

**Suggested fix**

Either implement click/drag-to-seek on the rail (add a `seek(time)` to Player that resets `_startTime` and `_lastProcessedTime`), or stop styling it like a scrubber — render it as a passive progress meter with no handles-like affordances until looping is enabled.

<a id="u-56"></a>
### 56. Armed and count-in states are visually identical, and neither is visible on the performance surface

**Low** · `state-visibility` · [TransportBar.js:324](src/ui/TransportBar.js#L324)

`case 'armed'` and `case 'count-in'` both do exactly `recordBtn.classList.add('armed')` with identical button-disable sets (src/ui/TransportBar.js:324-340), so the pulsing dot (`#btn-record.armed .record-icon { animation: record-pulse 1.5s ...}` style.css:483-485) means either "waiting for your first touch" or "recording begins in N beats" — two states with opposite implications for when to start playing. Neither is drawn on the canvas: GhostRenderer's red tint only appears once `this.recording` is set (src/ui/GhostRenderer.js:74-77), which happens after recording actually begins (src/main.js:377, 864). All arm/count-in feedback therefore lives in a 44px button and a header-mounted time display, away from where the performer is looking.

**How it fails**

> In free-form mode the user presses Record, looks at the waveform, and waits for something to happen. Nothing does — the arm state only resolves on first touch (src/main.js:375-379) — so they press Record again, which cancels the arm (src/main.js:937-939), and conclude the transport is unresponsive.

**Suggested fix**

Give the two states distinct visuals (steady red ring for armed with an on-canvas "touch to start" prompt; numeric countdown for count-in), and render both on the waveform canvas rather than only in the transport bar.

<a id="u-57"></a>
### 57. The only instructional text in the app is wrong and is unreachable in the default flow

**Low** · `onboarding` · [WaveformDisplay.js:235](src/ui/WaveformDisplay.js#L235)

The empty-state hint reads `ctx.fillText('Drop an audio file here or click "Load Sample"', w / 2, h / 2);` (src/ui/WaveformDisplay.js:235) but the button is labelled `Load File` (index.html:36). It is also almost never seen: the default sample option is pre-selected (`... selected>Danzi Wind Quintet — Allegretto</option>` index.html:26) and `createDefaultSession()` loads it immediately (`if (sampleSelect.value) { ... loadSampleFromUrl(...) }` src/main.js:641-644), so a first-run user goes straight from the unlock overlay to a loaded waveform. That unlock overlay carries no instructions either — just a title, "A granular sampler and loopstation", "Tap to start" and a credits line (index.html:11-17). There is no help button, no legend, no first-run tour, and the two keyboard shortcuts ('R', Ctrl+Z at src/main.js:1232, 1237) appear nowhere in the interface.

**How it fails**

> A new user taps to start, is dropped into a dense interface of ~50 controls (BPM, time signature, metronome, LS, snap, bar count, 14 scales, arpeggiator permutations) with a waveform and no statement of what to do, and never discovers that the primary interaction is dragging on the waveform — the one thing the app is for.

**Suggested fix**

Fix the string to match the button, and add a dismissible first-run layer on the canvas that states the two axes and the primary gesture ("drag here — left/right = position, up/down = pitch, use several fingers"), plus a persistent "?" in the header listing shortcuts.

<a id="u-58"></a>
### 58. No focus indicator is designed anywhere in the stylesheet

**Low** · `accessibility` · [style.css:274](style.css#L274)

Zero occurrences of `focus`, `:focus`, `:focus-visible` or `outline` in style.css. Nothing calls `outline: none`, so UA defaults survive — but several controls are styled to be background-less and border-less, which makes the default ring unreliable: `.tab-item { background: transparent; border: none; border-bottom: 2px solid transparent }` (style.css:274-290), `#tab-add { background: transparent; border: none }` (style.css:330-343), and the hover affordance for all of them is a colour change only (`.tab-item:hover { color: var(--text-primary) }`). Custom-drawn surfaces — `#waveform-canvas`, `#adsr-canvas`, `#arp-style-svg`, `#transport-progress` and its handles — are not focusable at all, so there is nothing to indicate.

**How it fails**

> A sighted keyboard user tabs across the tab strip and top bar. Against `--bg-secondary: #1a1816` the default Chrome focus ring on a transparent borderless tab is easy to lose, and because `TabBar.render` wipes focus on activation (see separate finding) they have no positional anchor to recover from.

**Suggested fix**

Add an explicit, high-contrast `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }` rule covering buttons, inputs, selects and summaries, and extend it to the custom widgets once they are made focusable.

<a id="u-59"></a>
### 59. Quantized value labels starve the slider they annotate — `min-width: 52px` + `nowrap` + `flex-shrink: 0` against `flex: 1`

**Low** · `layout` · [style.css:983](style.css#L983)

Confirmed as written; downgraded to low because it requires the Quantize + ternary-subdivision configuration on a <=600px viewport to bite, and the outcome is a coarse-but-usable slider rather than an unreachable control.

**How it fails**

> User enables Quantize → Grain Size with a ternary subdivision on a 390px phone: the label expands to `1/16T (125ms)` and the Min/Max sliders it describes collapse to ~55px — about 12 usable pixels per 0.1 of normalized range.

**Suggested fix**

Give `.range-row .param-value` a `max-width` with `overflow:hidden; text-overflow:ellipsis`, or move the value under the slider (`.range-row { flex-wrap: wrap }`), and drop `min-width` in favour of `width: 6ch` so the reserved space is font-relative.

<a id="u-60"></a>
### 60. Two competing `margin-left: auto` in the header split the free space, so the tempo cluster floats mid-bar instead of right-aligning

**Low** · `layout` · [style.css:168](style.css#L168)

Both #master-volume-control (style.css:168) and #theme-toggle (style.css:1223) declare margin-left:auto inside the same flex container, so free space is split equally and an equal-sized gap opens on each side of the volume/tempo cluster instead of one gap pushing it right. #level-meter's margin-left:auto (786) is separately inert because #transport-progress { flex: 1 } (687) already absorbs the free space. Cosmetic only — the theme button still sits at the right edge.

**How it fails**

> On a 1920px desktop the header reads: title, file controls, a large gap, volume/tempo/metronome, another equally large gap, theme toggle — the theme button appears detached and the tempo group looks accidentally centred rather than anchored right.

**Suggested fix**

Keep `margin-left: auto` on `#master-volume-control` only and delete it from `#theme-toggle` (1223) and `#level-meter` (786).

<a id="u-61"></a>
### 61. Tab labels have no max-width or ellipsis, and the tab strip's scrollbar is hidden with no affordance

**Low** · `layout` · [style.css:274](style.css#L274)

`.tab-item { padding: 6px 12px; white-space: nowrap; min-width: 80px }` (style.css:274-290) sets a minimum but no maximum, and there is no `overflow: hidden`/`text-overflow: ellipsis` on `.tab-label` (created at TabBar.js:38-41). Names come from `prompt('Rename instance:', tab.name)` (TabBar.js:64) with no length cap — only `newName.trim()` is checked. `#tab-bar { overflow-x: auto; scrollbar-width: none }` plus `#tab-bar::-webkit-scrollbar { display: none }` (252-264) hides all scroll affordance, and `#tab-add` (330-343) is a flex child of that same scrolling container, so once tabs overflow the "+" button scrolls out of view along with them.

**How it fails**

> User renames an instance to something long; that tab expands to its full text width, pushing the other tabs and the "+" button off the right edge of a strip with no visible scrollbar and no visual hint that horizontal scrolling exists.

**Suggested fix**

Add `max-width: 160px` to `.tab-item` with `overflow:hidden; text-overflow:ellipsis` on `.tab-label`, and move `#tab-add` out of the scrolling container (or `position: sticky; right: 0`).

<a id="u-62"></a>
### 62. `auto-fill` leaves empty grid tracks on wide screens, shrinking each control to a seventh of the panel

**Low** · `layout` · [style.css:842](style.css#L842)

`.section-content { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px }` (style.css:842-847) and `.musical-content { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)) }` (1110-1112). `auto-fill` creates the maximum number of tracks that fit and *keeps the empty ones*, each at `1fr`. On a 1600px panel that is 7 tracks of ~200px. The Gesture Mapping section holds exactly three `.param-group`s (index.html:383-433), so three tracks are used and four (~800px, half the panel) stay blank. `auto-fit` would collapse the empty tracks and let the three groups stretch.

**How it fails**

> On a 1920px desktop the Gesture Mapping section shows three narrow 200px columns hugging the left edge with a wide empty band to the right, reading as a rendering bug rather than a layout choice.

**Suggested fix**

Change `auto-fill` to `auto-fit` in both rules (842 and 1111).

---

# Nit (1)

<a id="u-63"></a>
### 63. Dead and inert CSS: an overflow that never triggers, padding on fixed-size buttons, a fallback that can't fire

**Nit** · `dead-code` · [style.css:810](style.css#L810)

Genuinely inert CSS: #parameter-panel's overflow-y:auto (810) can never engage while flex-shrink:0 (809) holds it at content height; #level-meter's margin-left:auto (786) is dead behind #transport-progress { flex: 1 } (687); .snap-btn (521) and .loop-station-btn (534) padding is absorbed by the fixed 44x44 #transport-bar button box (411-422); the var(--accent-warm, var(--accent)) fallback (682-683) is unreachable; .snap-forced/.loop-forced pointer-events (546-550) duplicate the disabled property set alongside them (main.js:1103, 1107). NOT dead: .metronome-btn's padding (643) — that button is in the header #tempo-control (index.html:78), never gets the 44x44 rule, and its padding is its only sizing.

**How it fails**

> Not a runtime failure — but the inert `overflow-y: auto` at 810 is the specific line that makes the panel *look* like it was made scrollable, which is likely why the portrait clipping bug (finding 1) was never caught.

**Suggested fix**

Delete 786, 521's padding, 643's padding, 534's padding, the fallback in 682-683, and 546-550's `pointer-events`; fix 809-810 as described in finding 1.

---

# Appendix A — Findings raised and then rejected (3)

These were reported by a finder agent and killed by the verification pass. They are listed so nobody re-raises them.

**Parameter panel never shrinks, so on phone-height viewports the lower controls are clipped and unreachable** — `style.css`

> Duplicate. This is the same CSS defect as the ux-visual finding 'Parameter panel overflows the viewport and cannot be scrolled', citing the identical rule at style.css:805-811 with the identical mechanism (flex-shrink:0 + auto height inside a min-height:0 column flex container, clipped by html,body overflow:hidden). The other report states the mechanism more precisely and quantifies it; keeping both double-counts one bug. This restatement also overstates the consequence — it claims the lower controls are 'permanently inaccessible until they rotate the device', but both panel sections are <details> elements whose <summary> rows sit at the top of the panel (index.html:141, 294), so collapsing 'Rhythm and Harmony' brings 'Sound Engine' and Gesture Mapping into view without rotating.

**`.range-row-inactive` / `.param-inactive` block the mouse but not the keyboard — 'disabled' controls remain operable** — `style.css`

> Duplicate. This is the same rule (style.css:992-1002), the same toggling code (ParameterPanel.js:860-886) and the same fix as the earlier 'Half the Sound Engine panel is dimmed to 1.62:1 and click-blocked by default' finding, which already states both halves of the claim — the sub-4.5:1 dimming AND that 'the sliders and selects remain in the tab order and keyboard-operable, but pointer-events: none blocks the mouse — inconsistent input behaviour for the same control' — and already recommends using the real disabled attribute. Two lenses reported one defect; the technical content here adds only that a keyboard-changed value is persisted.

**ADSR editor renders half its intended height — `aspect-ratio: 2/1` is overridden by `align-items: stretch`** — `style.css`

> The flex cross-size reasoning is wrong. In `.envelope-inline { display:flex; align-items:stretch }` (style.css:1083-1087) the line's cross size is computed from the items' hypothetical cross sizes before any stretching. #adsr-canvas has a definite main size (width:160px) and `height: auto`, so its hypothetical cross size resolves through `aspect-ratio: 2 / 1` to 80px; the sibling select is 44px (style.css:911-920). The line cross size is therefore max(80, 44) = 80px, and stretching the canvas to the line size yields exactly the 160x80 the aspect ratio intended — identical to .arp-style-preview under align-items:center. Nothing constrains .envelope-inline's height from outside either: its parent .param-group is a column flex container (style.css:846-850) with auto height, and the panel section is not height-limited. So the canvas is not 160x44, ADSRWidget.resize() reads clientHeight of 80px, the A label at y-8 is not clipped, and the 14px HIT_RADIUS does not overlap across an 80px column. The claimed inconsistency between the two 160px/2:1 widgets does not exist.

---

# Appendix B — What was checked and found clean

Verbatim notes from the finder agents. Useful mainly so these areas are not re-audited.

## Lens: `ux-interaction`

Scope: index.html, style.css, all of src/ui/*, src/main.js wiring, plus src/input/PointerHandler.js, src/automation/{Recorder,Player}.js, src/state/{InstanceManager,InstanceState,SessionPersistence}.js, src/audio/{GrainScheduler,Voice,GranularEngine,Metronome}.js and src/utils/{fileLoader,math}.js, read in full. I could not run the app; every claim above is grounded in quoted source.

Structural observations that are not discrete findings:

1. Doc drift is real and one-sided. agents/CLAUDE.md is stale on the central interaction (line 141 "Amplitude ... (Y-axis on waveform)", line 157 "Y-axis → Amplitude: 0 at top, 1 at bottom (push down = louder)", line 250 "X=position, Y=amplitude", line 262 "pressure → amplitude, contact size → spread, velocity → density" as fixed mappings, whereas the shipped version is user-routable selects at index.html:388-429). README.md, by contrast, is accurate and current (lines 129-135 correctly document Y→pitch as 2^(2−4y), line 110 matches the 1/2/3/4-bar selector, VoiceAllocator MAX_VOICES=14 matches README line 85). So README is a usable ground truth; agents/CLAUDE.md is not. The stale doc's vocabulary has leaked into the code — `amplitude` is used throughout PointerHandler/Recorder/GhostRenderer for what is really the pitch axis — which is the root of the biggest UX problem here.

2. The state machine is split across two files and they disagree. TransportBar._updateButtons() owns enable/disable per state (src/ui/TransportBar.js:303-367) while the actual legality of each action is re-checked in main.js handlers (`if (transport.state !== 'playing' && ...) return;` src/main.js:1020; `if (!active || active.recorder.isRecording) return;` src/main.js:970). Every place the two drift produces a dead or dangerous control — the enabled-but-inert Overdub button and the keyboard path that ignores `disabled` are both instances of this. A single authoritative `canRecord()/canPlay()/canOverdub()` consulted by both the renderer and the handlers would remove that whole class of bug.

3. Mode-forced controls have no visual vocabulary. Loop-station mode force-locks Loop and Snap by combining `disabled` with a 0.5-opacity class (src/main.js:1102-1108, style.css:546-550), which collides with the existing meaning of dimming ("off" for `.snap-btn`/`.metronome-btn`, style.css:517-521, 640-644, and "inactive" for `.param-inactive`/`.range-row-inactive`, style.css:991-1002). Four different semantics — off, unavailable, irrelevant, forced-on — currently share one visual treatment.

4. Destructive actions have no shared safety layer. Record (clears the lane), tab close, session import and JSON drop all destroy irreplaceable work with no confirm and no undo, while purely informational events (export succeeded, session restored) do get toasts. The affordance budget is inverted.

5. `loopSnapToGrid` (src/main.js:1057) is module-global while loop-station mode is per-instance (src/state/InstanceState.js:53), and it is absent from getLoopStationState() (src/main.js:560-573) so it is never persisted — a small consistency gap in an otherwise carefully per-instance state model.

## Lens: `ux-visual`

Structural observations that are not discrete defects:

CREDIT WHERE DUE — the markup is not pure div-soup. `<header>`, `<main>`, `<details>/<summary>` for the three collapsible panel sections (index.html:141, 294, 380), real `<button type=\"button\">` for every clickable control, real `<input type=\"range\">`/`<select>` for parameters (as the research doc recommended at agents/granular-sampler-research.md:131), `<optgroup>` on the subdivision selects, and correct `<label for>` on `#master-volume` and `#param-bpm`. The bones are sound; what is missing is the ARIA layer over the custom widgets and any keyboard path into the canvas/SVG/drag surfaces. Fixing the labelled-control gaps and the `display:none` checkboxes would move the app most of the way to keyboard-configurable — leaving only the performance surface itself, which needs new interaction design, not attributes.

SCOPE OF THE GAP — a grep for `aria`, `role=`, `tabindex`, `:focus`, `outline` and `prefers-reduced-motion` across index.html, style.css and all of src/ returns zero real hits (the few `aria` matches are substrings of `variable`). So this is not partial ARIA that drifted; it was never started. Five distinct custom widgets are pointer-only with no keyboard or AT surface: the waveform canvas (PointerHandler.js:74-77), the ADSR canvas (ADSRWidget.js:36-39), the arpeggiator SVG editor (ParameterPanel.js:267-270), the loop start/end handles (TransportBar.js:105-112), and the level meter (LevelMeter.js — a div width with no role).

DOC DRIFT worth flagging to the team, beyond the two I filed as findings (44px touch targets at agents/CLAUDE.md:263; 'Load Sample' vs 'Load File'): README.md:468 states 'the performance surface has no keyboard equivalent' and README.md:436-437 states 'There is no feature detection or fallback — a browser missing any of these will fail at load.' Both are accurate self-assessments. I have still filed the underlying issues because documenting a hard-fail does not make the hard-fail acceptable — the specific problem is that failure is *silent* (dead splash screen, no message), which is a fixable UX defect independent of the feature-detection decision.

NOT FILED, considered and rejected: the default UA focus ring is intact (nothing sets `outline: none`), so I filed the focus issue as 'no designed indicator' rather than 'focus removed'. `--text-secondary` #8a8078 on `--bg-secondary` #1a1816 computes to ~4.59:1, which passes AA for normal text; I only flagged the places where opacity multipliers (0.35 on inactive rows, 0.7 on `.gesture-status`) push it below threshold. The `<details>` sections remain fully keyboard-operable despite the hidden disclosure marker (`list-style: none` + a CSS `::before` triangle, style.css:827-840) — that is a correct implementation.

## Lens: `ux-a11y-robustness`

METHOD: read index.html (442 lines) and style.css (1551 lines) in full, plus all of src/ui/*.js, src/input/PointerHandler.js and src/main.js. All contrast ratios were computed numerically (sRGB relative luminance per WCAG 2.x, with alpha compositing where the CSS uses rgba/opacity) rather than estimated — the script lives at the scratchpad path C:\\Users\\B2CEA~1.REC\\AppData\\Local\\Temp\\claude\\...\\scratchpad\\wcag.mjs.

PALETTE INVENTORY (raw counts): 21 distinct hex literals + 11 distinct rgb/rgba literals in style.css, plus 10 RGB triplets in src/ui/voiceColors.js and 2 more literals in src/ui/GhostRenderer.js (lines 75, 103) = 44 colour values total. The hex literals are all correctly confined to the two token blocks (style.css:8-63); the leakage is entirely in the rgba literals.

TYPE / SPACING INVENTORY: 11 distinct font-size values (4.5, 9, 10, 11, 12, 13, 14, 16, 18, 20, 48px); 6 border-radius values (1, 2, 3, 4, 6, 9px); 9 gap/padding values (1, 2, 3, 4, 6, 8, 10, 12, 16px). No token layer for any of these — every value is a literal at its use site.

WHAT THE DARK THEME GETS RIGHT (so the report is not read as uniformly negative): the dark palette is genuinely coherent — a warm near-black ramp (#12110f → #1a1816 → #252220) with a single amber accent, and the four canvas-drawn components correctly read their colours from CSS custom properties via getComputedStyle and re-read them on theme change (WaveformDisplay.js:36-51, ADSRWidget.js:50-63, wired at main.js:38-45). That mechanism is the right architecture; it is simply not extended to voiceColors.js or the two GhostRenderer literals. Dark-theme text contrast passes AA everywhere it matters (4.59-9.28:1). The `.gesture-indicator` / `.random-range-bar` overlays on the range sliders are a genuinely good piece of feedback design.

TWO THINGS I COULD NOT VERIFY WITHOUT RUNNING THE APP: (1) the exact rendered height of the wrapped top bar on a phone — my ~230px figure is reconstructed from the declared paddings, font sizes and intrinsic control widths, so the precise overflow amount in finding 1 could differ by ±60px, though the direction and the fact of the overflow are certain from the flex-shrink:0 / overflow:hidden combination alone; (2) whether `align-items: stretch` overriding `aspect-ratio` (finding 11) behaves identically across Safari and Firefox — the CSS sizing spec is clear that a stretched cross size is not `auto` and therefore suppresses the ratio, and Chrome/Safari/Firefox all implement this, but the 160x44-vs-160x80 discrepancy between the two otherwise-identical canvases is worth confirming visually.

PERFORMANCE NOTE (adjacent to my lens, not filed as a finding): main.js:1305-1306 calls params.updateRandomIndicators() and params.updateParamRelevance() on every animation frame. updateParamRelevance() re-reads ~25 DOM control values per frame via getParams()/getMusicalParams(), and updateRandomIndicators() reads offsetLeft/offsetWidth/offsetTop/offsetHeight (ParameterPanel.js:830-848) whenever any Randomize toggle is on, forcing a synchronous layout 60x/second. Neither is incorrect, but on a mid-range phone this is exactly the kind of per-frame layout thrash that shows up as visible jank in the pointer indicators — which is the one thing in this UI that must feel immediate.
