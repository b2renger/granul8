# Granul8 — Code Audit

> **Status — Phase 1 complete (branch `fix/audio-timing`, 26 commits, 63 tests).**
> Findings **1–12** (the critical and all highs) are fixed, plus **14, 21, 22, 24, 27, 29, 31,
> 35, 36, 38, 46, 48, 50, 51, 55, 56, 58**. Every task was implemented against a failing test
> first and reviewed by an independent agent; twelve defects in the implementation plan itself
> were caught and corrected during execution. See
> `agents/2026-08-15-audit-remediation-plan.md` for the plan and
> `.superpowers/sdd/2026-08-15-audit-remediation-plan/progress.md` for the full execution record.
>
> The remaining findings are open. Phase 2 (interface) and Phase 3 (sample sources) are planned
> but not started.


> **Method.** Five independent critic agents, each given no prior context beyond the
> repository path and one lens (Web Audio correctness · musical timing and BPM sync ·
> state and persistence · input lifecycle · cross-cutting consistency). Each was told
> explicitly *not* to trust `agents/*.md` as ground truth. Their 89 surviving findings were
> then handed to adversarial verifiers instructed to **refute by default** — to open the
> cited file, read the surrounding code, and kill anything that could not be proved from
> the source as written. 8 findings were rejected as misreadings or duplicates
> (Appendix A); the rest were confirmed, several with corrected severity.
>
> The timing lens went further and ran the real `Player`, `AutomationLane`, `MasterClock`
> and `Metronome` modules under Node against a fake `AudioContext` whose `currentTime` it
> drove manually. **Every number quoted in the timing findings is machine output, not an
> estimate.** The accessibility figures in the companion [UX audit](AUDIT-UX.md) were
> likewise computed, not eyeballed.

## What this audit is not

It is not a verdict on the project. The codebase is genuinely well built for what it is: a
zero-dependency instrument with a clean module boundary per concern, no shared-mutable-state
aliasing between instances, correctly bounded ring buffers, `pointercancel` handled,
`touch-action` set, and no hardcoded sample rate anywhere. The finder agents went looking
for the usual suspects and came back empty on most of them — see
[Appendix B](#appendix-b--what-was-checked-and-found-clean), which is worth reading
precisely because it says what *isn't* broken.

What follows is what they did find.

## The headline

**One critical DSP bug, and one architectural root cause that produces most of the rest.**

### The critical: pitch is missing from the grain duration math

[grainFactory.js:113](src/audio/grainFactory.js#L113) passes the grain length to
`source.start(when, offset, grainDuration)`. Per spec that third argument is measured in the
**buffer's** time base, so at `playbackRate = 2` the source falls silent after
`grainDuration / 2` seconds of wall clock — while the Hann envelope, stretched over
`grainDuration` of wall clock, is still sitting at its **peak**. Every grain is truncated at
full amplitude, producing a step discontinuity and an audible buzz at the grain rate.

This is not an edge case. `yToPitch()` maps the entire upper half of the performance surface
to pitch > 1. Half the instrument clicks. Two secondary bugs fall out of the same mistake:
the anti-clipping overlap estimate and the `onGrain` visualisation payload both use
buffer-time rather than wall-clock duration, so gain staging and grain width are wrong at any
pitch ≠ 1. **Fix this one first** — it is ~6 lines and it is the largest single audible
improvement available.

### The root cause: three timelines that are never reconciled

The app has four independent notions of "now" and reconciles none of them:

| Timeline | Anchored to | Advances by |
|---|---|---|
| `MasterClock` | an epoch + `currentTime` | recomputed from the epoch on every query |
| `Metronome` | `currentTime` at `start()` | **float accumulation** of `getBeatDuration()` |
| `Player` | `_startTime`, reset at each wrap | `requestAnimationFrame` |
| `GrainScheduler` | `currentTime` at `start()` | **float accumulation** of `interOnset` |

Only the first is self-correcting. The consequences are findings 2 through 11:

- **The metronome drifts off its own grid.** Change BPM once from 120 to 140 and the click
  track sits a permanent, measured **214 ms** away from the bar grid the loops snap to. It
  never recovers, because the metronome kept the old phase and adopted the new period.
- **Recording knocks existing layers out of time.** `startCountIn()` calls
  `clock.setEpoch(now)` on the single shared clock, so arming a record on tab 2 re-anchors
  the bar grid under every layer already looping on tabs 1 and 3.
- **Loops drift, or teleport, depending on mode.** Free-form looping discards the
  frame overshoot at every wrap, so each iteration is ~14 ms long at 60 fps and the error is
  unbounded — measured at **0.42 s after one minute**. Loop-station mode avoids that by
  re-gridding, but uses `Math.round`, so the playhead can jump up to half a bar *backwards*
  and replay material the user explicitly excluded from the loop range.
- **A background tab is a drone.** Voice *stop* is delivered only from the rAF-driven
  `Player._tick`; grain *production* runs on `setTimeout`. Browsers suspend rAF for hidden
  tabs but only throttle `setTimeout`. There is no `visibilitychange` handler anywhere in
  `src/`. Switch tabs mid-loop and the sampler plays continuously — for as long as you are
  away — while the transport is frozen. Return, and the layer is up to a full loop out of
  phase.
- **A single main-thread stall becomes a full-scale transient.** No look-ahead loop clamps
  its cursor to `currentTime`. After a 30 s hidden period, `GrainScheduler._tick` schedules
  ~6,000 grains with `when` in the past — and `source.start(when)` with `when < currentTime`
  starts *immediately*, so they all fire in the same render quantum.

TODO.txt already says *"we need to review the bpm sync across layers"* and *"review the loop
points and the quantization so that everything stays in rhythm over time."* This is the
answer to why: the layers were never phase-locked to anything in the first place.

### The third theme: recordings are not reproducible

`extractParams()` captures eight scalars and drops `randomize`, `interOnsetRange`,
`interOnsetQuantize`, `grainSizeQuantize` and `pitchQuantize` — the five fields that carry
the arpeggiator, the per-grain randomisation and the tempo quantisation. Because
`Voice.update()` only overwrites keys that are `!== undefined`, replayed events silently
inherit whatever the voice slot happened to hold from the last live gesture. So a recording
sounds correct immediately after you make it, and **loses its arpeggio on reload**, when
every `Voice` is reconstructed with `pitchQuantize = null`. This directly contradicts
`agents/CLAUDE.md:229` ("each recording faithfully reproduces the original performance").

## Suggested order of work

1. **Grain duration vs playbackRate** (finding 1) — smallest fix, biggest audible win.
2. **Clamp the look-ahead cursors** in `GrainScheduler._tick` and `Metronome._tick`
   (findings 2, 30) — 3 lines each, removes the glitch-on-return class entirely.
3. **Cancel the stale fade in `Voice.start()`** (finding 5) — 3 lines, fixes silent voices
   on fast re-trigger.
4. **Move `Player` off rAF** onto the same look-ahead `setTimeout` pattern the rest of the
   audio code already uses, and add a `visibilitychange` handler (findings 8, 10). This kills
   the drone, the dropped iterations, and the record-overshoot bug together.
5. **Make the timelines one timeline**: derive the metronome's next beat from the clock
   instead of accumulating; advance `Player._startTime` by exact loop lengths instead of
   resetting it; never move the epoch while anything is playing (findings 3, 4, 6, 7).
6. **Store loop points as bars, not seconds** (findings 7, 11) — this is the structural fix
   TODO.txt is asking for, and it makes BPM changes coherent instead of destructive.
7. Everything else, at leisure.

Findings 12 onward are individually smaller but several are cheap: the `fetch` with no
`response.ok` check, the unguarded top-level `localStorage` access that kills the whole
module in private-mode Safari, and the two byte-identical ADSR generators are all one-line
or delete-only.


## Severity summary

| Severity | Count | Meaning |
|---|---:|---|
| **Critical** | 1 | Broken for every user on the default path |
| **High** | 11 | Breaks a core workflow, loses work, or locks out a class of users |
| **Medium** | 26 | Wrong, confusing, or fragile under normal use |
| **Low** | 45 | Real but narrow — polish, drift, or a bounded edge case |
| **Nit** | 6 | Cosmetic or documentation-only |
| | **89** | |

## Index

| # | Sev | Location | Finding |
|---:|---|---|---|
| [1](#c-1) | Critical | [grainFactory.js:113](src/audio/grainFactory.js#L113) | playbackRate is ignored in grain duration math: source ends mid-envelope at any pitch > 1, clicking on every grain |
| [2](#c-2) | High | [GrainScheduler.js:91](src/audio/GrainScheduler.js#L91) | GrainScheduler never clamps nextGrainTime to currentTime: a single main-thread stall schedules hundreds of grains in the past, all firing simultaneously |
| [3](#c-3) | High | [Metronome.js:164](src/audio/Metronome.js#L164) | Metronome beat grid free-runs by float accumulation and is never re-derived from the clock epoch — after any BPM change the click is up to half a beat off the grid the loops snap to |
| [4](#c-4) | High | [Metronome.js:100](src/audio/Metronome.js#L100) | startCountIn() resets the global clock epoch, re-anchoring the bar grid under every already-looping layer |
| [5](#c-5) | High | [Voice.js:140](src/audio/Voice.js#L140) | Re-triggering a voice within 30 ms of releasing it leaves its gain pinned at 0 — the voice is silent for its whole life |
| [6](#c-6) | High | [Player.js:256](src/automation/Player.js#L256) | Loop wrap discards the frame overshoot, so every loop iteration is one frame too long — unbounded drift |
| [7](#c-7) | High | [Player.js:253](src/automation/Player.js#L253) | Loop-station wrap snaps to the NEAREST bar, teleporting the playhead up to half a bar and replaying events outside the loop range |
| [8](#c-8) | High | [Player.js:253](src/automation/Player.js#L253) | Loop length is stored in seconds but the wrap is snapped to the live bar grid, so a mid-playback BPM change truncates or stretches every loop |
| [9](#c-9) | High | [Player.js:314](src/automation/Player.js#L314) | Playback is rAF-driven, so a backgrounded tab drops entire loop iterations and leaves the layer permanently offset |
| [10](#c-10) | High | [Player.js:314](src/automation/Player.js#L314) | Automation-playback voices drone for the entire time the tab is backgrounded (rAF-driven stop, setTimeout-driven grains) |
| [11](#c-11) | High | [Recorder.js:186](src/automation/Recorder.js#L186) | Automation recording drops all randomization/arp/quantization config, so playback is not reproducible after a session reload |
| [12](#c-12) | High | [main.js:1201](src/main.js#L1201) | Loop handles map fractions onto the lane's last-event time while the player's loop end is an exact bar count — dragging a handle silently shortens the loop |
| [13](#c-13) | Medium | [GrainScheduler.js:47](src/audio/GrainScheduler.js#L47) | Nothing phase-locks playback start or grain onsets to the master clock — quantized densities have correct interval but arbitrary phase |
| [14](#c-14) | Medium | [GrainScheduler.js:91](src/audio/GrainScheduler.js#L91) | GrainScheduler never clamps nextGrainTime to currentTime — any main-thread stall produces a synchronous burst of hundreds of grains scheduled in the past _(dup of #2)_ |
| [15](#c-15) | Medium | [GranularEngine.js:137](src/audio/GranularEngine.js#L137) | GranularEngine.releaseVoice() zeroes the gain of the voice it just released, defeating the loop crossfade it exists to implement |
| [16](#c-16) | Medium | [GranularEngine.js:40](src/audio/GranularEngine.js#L40) | Loop crossfade double-counts voices, producing a 3 dB level dip at every loop boundary |
| [17](#c-17) | Medium | [MasterBus.js:43](src/audio/MasterBus.js#L43) | Metronome is routed pre-limiter, so every click ducks the entire mix |
| [18](#c-18) | Medium | [Voice.js:184](src/audio/Voice.js#L184) | linearRampToValueAtTime is used without cancelling/anchoring, so every gain change is a step discontinuity rather than a ramp |
| [19](#c-19) | Medium | [envelopes.js:311](src/audio/envelopes.js#L311) | Custom ADSR envelope produces a mid-grain step, or ends at non-zero gain, whenever a + d + r > 1 |
| [20](#c-20) | Medium | [grainFactory.js:63](src/audio/grainFactory.js#L63) | Anti-clipping overlap estimate uses the slowest possible inter-onset when density jitter is enabled, so attenuation is effectively disabled at high grain density |
| [21](#c-21) | Medium | [Player.js:277](src/automation/Player.js#L277) | Crossfade pre-start makes every event in the first 50 ms of the loop fire twice |
| [22](#c-22) | Medium | [Player.js:129](src/automation/Player.js#L129) | play() ignores _loopStart on the first pass, so the first iteration plays material outside the loop range |
| [23](#c-23) | Medium | [Player.js:371](src/automation/Player.js#L371) | Loop-boundary voice release bypasses GhostRenderer, leaving ghost pointers frozen on the canvas |
| [24](#c-24) | Medium | [Recorder.js:67](src/automation/Recorder.js#L67) | Recording stop never emits captureStop for pointers still held down — dangling start events sustain on playback |
| [25](#c-25) | Medium | [Recorder.js:55](src/automation/Recorder.js#L55) | `Ctrl+Z` can only undo the last loop iteration of an overdub, not the overdub session |
| [26](#c-26) | Medium | [VoiceAllocator.js:68](src/input/VoiceAllocator.js#L68) | Live touches and automation playback share one 14-voice pool with no stealing policy; exhausted allocation silently drops the touch with zero feedback |
| [27](#c-27) | Medium | [main.js:1201](src/main.js#L1201) | Three different notions of "recording duration" — progress bar can exceed 100% and loop handles map to the wrong timebase |
| [28](#c-28) | Medium | [main.js:122](src/main.js#L122) | fixedRecordDuration is a module-level global while recorders are per-instance — switching tabs mid-record leaks the auto-stop into another tab |
| [29](#c-29) | Medium | [main.js:881](src/main.js#L881) | Free-form recordings never reset the player's stale loop range from a previous take |
| [30](#c-30) | Medium | [main.js:165](src/main.js#L165) | resizeCanvas is undebounced and triggers a full O(buffer-length) waveform recompute on every resize event |
| [31](#c-31) | Medium | [main.js:603](src/main.js#L603) | markSampleMissing() mutates the persisted display name, so the "(missing)" marker compounds on every reload |
| [32](#c-32) | Medium | [main.js:122](src/main.js#L122) | `fixedRecordDuration` is a module-level global that survives tab switches and silently truncates the next recording _(dup of #28)_ |
| [33](#c-33) | Medium | [main.js:468](src/main.js#L468) | Closing the active tab leaves the loop-station and transport UI showing the closed tab's state |
| [34](#c-34) | Medium | [main.js:486](src/main.js#L486) | `onAdd` applies the loop-station UI before switching, so the bar-count selector is populated from the outgoing instance |
| [35](#c-35) | Medium | [InstanceManager.js:249](src/state/InstanceManager.js#L249) | A throw during restore/import destroys every instance and leaves InstanceManager with `activeId === null` (dead app) |
| [36](#c-36) | Medium | [SessionPersistence.js:67](src/state/SessionPersistence.js#L67) | localStorage auto-save serializes every automation lane on every change and swallows quota failures silently |
| [37](#c-37) | Medium | [ParameterPanel.js:882](src/ui/ParameterPanel.js#L882) | Root Note / Scale are dimmed and made non-interactive while they still shape every grain |
| [38](#c-38) | Medium | [TransportBar.js:48](src/ui/TransportBar.js#L48) | Transport loop-handle positions are global UI state, never per-instance and never restored from the persisted loopRange |
| [39](#c-39) | Low | [TODO.txt:1](TODO.txt#L1) | TODO.txt lists six items the plan marks [DONE] |
| [40](#c-40) | Low | [CLAUDE.md:143](agents/CLAUDE.md#L143) | agents/CLAUDE.md parameter table contradicts the actual ranges in code |
| [41](#c-41) | Low | [CLAUDE.md:52](agents/CLAUDE.md#L52) | agents/CLAUDE.md folder tree omits 13 shipped modules and lists a sample file that does not exist |
| [42](#c-42) | Low | [CLAUDE.md:266](agents/CLAUDE.md#L266) | agents/CLAUDE.md numbers phases differently than the plan and predates the entire multi-instance / loop-station architecture |
| [43](#c-43) | Low | [CLAUDE.md:227](agents/CLAUDE.md#L227) | Design docs describe timing behaviour the code does not implement |
| [44](#c-44) | Low | [granular-sampler-implementation-plan.md:1193](agents/granular-sampler-implementation-plan.md#L1193) | Metronome click spec in the plan does not match the shipped oscillator |
| [45](#c-45) | Low | [GrainScheduler.js:96](src/audio/GrainScheduler.js#L96) | Per-grain randomization is silently discarded whenever quantization is also enabled |
| [46](#c-46) | Low | [GrainScheduler.js:113](src/audio/GrainScheduler.js#L113) | An exception thrown while creating a grain permanently kills that voice's scheduler (the timer re-arm is outside any try/finally) |
| [47](#c-47) | Low | [MasterBus.js:71](src/audio/MasterBus.js#L71) | The "soft clipper" hard-clips: the tanh curve only spans input [-1, 1], so anything louder is flat-topped at 0.7616 |
| [48](#c-48) | Low | [Metronome.js:158](src/audio/Metronome.js#L158) | Count-in hands off to the recorder via wall-clock setTimeout, so recording t=0 never lands on the audio-clock bar boundary |
| [49](#c-49) | Low | [Voice.js:231](src/audio/Voice.js#L231) | `randomize.pitch` is computed and stored but can never be read — Voice's scale-snap path is unreachable |
| [50](#c-50) | Low | [Voice.js:150](src/audio/Voice.js#L150) | Voice.stop()'s declick ramp is immediately overtaken by _updateVoiceGains(), producing an upward level bump and parking inactive voices at non-zero gain |
| [51](#c-51) | Low | [envelopes.js:342](src/audio/envelopes.js#L342) | Two byte-identical ADSR curve generators live side by side in envelopes.js |
| [52](#c-52) | Low | [envelopes.js:229](src/audio/envelopes.js#L229) | expodec / rexpodec / gaussian windows start or end at non-zero gain, clicking at every grain boundary |
| [53](#c-53) | Low | [envelopes.js:290](src/audio/envelopes.js#L290) | Envelope cache is unbounded and keyed by continuous ADSR values |
| [54](#c-54) | Low | [grainFactory.js:97](src/audio/grainFactory.js#L97) | StereoPanner is bypassed at exactly pan === 0, causing a 3 dB level jump and disabling spread-based pan variation |
| [55](#c-55) | Low | [AutomationLane.js:44](src/automation/AutomationLane.js#L44) | getEventsInRange rescans the lane from index 0 every frame for every playing layer |
| [56](#c-56) | Low | [Player.js:311](src/automation/Player.js#L311) | Loop-station wrap can produce negative elapsed time, printing a garbage clock and a negative CSS width |
| [57](#c-57) | Low | [Player.js:241](src/automation/Player.js#L241) | Loop-station mode silently stretches non-integer-bar loops to whole bars, hanging the playhead on empty time |
| [58](#c-58) | Low | [Recorder.js:35](src/automation/Recorder.js#L35) | Recorder throttle map is keyed by voiceIndex, not pointerId as its JSDoc and CLAUDE.md state |
| [59](#c-59) | Low | [PointerHandler.js:9](src/input/PointerHandler.js#L9) | MAX_POINTERS (10), MAX_VOICES (14) and the design doc (6) all disagree; the constant's own comment is wrong |
| [60](#c-60) | Low | [VoiceAllocator.js:15](src/input/VoiceAllocator.js#L15) | Voice pool size is documented as 6, commented as 10, and actually 14 |
| [61](#c-61) | Low | [main.js:296](src/main.js#L296) | "Randomize pitch without quantize" is scale-snapped, contradicting the documented mode table |
| [62](#c-62) | Low | [main.js:633](src/main.js#L633) | Metronome mute state is serialized but never restored, and the documented mute button does not exist |
| [63](#c-63) | Low | [main.js:204](src/main.js#L204) | One concept, three names, inverted semantics: "Density" is actually inter-onset time |
| [64](#c-64) | Low | [main.js:225](src/main.js#L225) | expMap bounds for grain size and density are hardcoded in three files each and can drift silently |
| [65](#c-65) | Low | [main.js:883](src/main.js#L883) | finishRecording reads the recorder's duration after stopping it, so free-form bar-quantization uses the last-event time instead of the recording length |
| [66](#c-66) | Low | [main.js:172](src/main.js#L172) | No ResizeObserver on the waveform container — panel layout changes resize the canvas box with no resize event, leaving a stale backing store |
| [67](#c-67) | Low | [main.js:1330](src/main.js#L1330) | render() re-arms rAF as its last statement with no try/catch — one throw permanently kills all rendering and the fixed-length record auto-stop |
| [68](#c-68) | Low | [main.js:1273](src/main.js#L1273) | Loop-station overdub re-copies and re-serializes the entire lane on every loop wrap, and grows voiceIndex without bound |
| [69](#c-69) | Low | [InstanceState.js:62](src/state/InstanceState.js#L62) | `InstanceState.toJSON()` blind-spreads `...this`, re-emitting non-schema fields injected by `fromJSON` |
| [70](#c-70) | Low | [SessionPersistence.js:38](src/state/SessionPersistence.js#L38) | `saveNow()` bypasses the `_enabled` guard that `scheduleSave()` respects |
| [71](#c-71) | Low | [SessionSerializer.js:42](src/state/SessionSerializer.js#L42) | Session `version` is written but never branched on; there is no migration path and future/older schemas are accepted blindly |
| [72](#c-72) | Low | [ADSRWidget.js:78](src/ui/ADSRWidget.js#L78) | ADSRWidget drag state is a single global — a second touch hijacks or silently kills an in-progress drag |
| [73](#c-73) | Low | [GhostRenderer.js:41](src/ui/GhostRenderer.js#L41) | Assorted unreachable/unread members: dead ghost-color branch, write-only counter, uncalled public API |
| [74](#c-74) | Low | [GhostRenderer.js:47](src/ui/GhostRenderer.js#L47) | GhostRenderer._fading grows without bound for instances that are not the active tab |
| [75](#c-75) | Low | [GrainOverlay.js:77](src/ui/GrainOverlay.js#L77) | GrainOverlay hardcodes ±2 octaves while the Pitch Range control allows ±4 — grains render off-canvas |
| [76](#c-76) | Low | [ParameterPanel.js:873](src/ui/ParameterPanel.js#L873) | Pan is wired into the gesture-mapping machinery but 'pan' is not an option in any mapping dropdown |
| [77](#c-77) | Low | [ParameterPanel.js:19](src/ui/ParameterPanel.js#L19) | ParameterPanel JSDoc no longer matches its own return shapes |
| [78](#c-78) | Low | [ParameterPanel.js:830](src/ui/ParameterPanel.js#L830) | Per-frame forced layout thrash: updateRandomIndicators interleaves offset* reads with style writes inside the render loop |
| [79](#c-79) | Low | [ParameterPanel.js:594](src/ui/ParameterPanel.js#L594) | ADSR default `{a:0.2, d:0.15, s:0.7, r:0.2}` is duplicated in three modules |
| [80](#c-80) | Low | [TransportBar.js:118](src/ui/TransportBar.js#L118) | TransportBar loop-handle drag ignores pointercancel and does not filter by pointerId — stuck drag on multi-touch |
| [81](#c-81) | Low | [musicalQuantizer.js:158](src/utils/musicalQuantizer.js#L158) | Seven unreferenced exports across utils, including two superseded quantization helpers |
| [82](#c-82) | Low | [musicalQuantizer.js:285](src/utils/musicalQuantizer.js#L285) | quantizeTimeToGrid ignores the time signature denominator, so the snap-to-grid button uses a different grid than loop-station mode |
| [83](#c-83) | Low | [test-modules.html:31](test-modules.html#L31) | test-modules.html covers 5 of 26 modules and overstates what it verifies |
| [84](#c-84) | Nit | [granular-sampler-implementation-plan.md:407](agents/granular-sampler-implementation-plan.md#L407) | Plan status tags are inconsistent — implemented steps 2.8/2.9 carry no [DONE] marker |
| [85](#c-85) | Nit | [main.js:1068](src/main.js#L1068) | Orphaned JSDoc block sits above an unrelated section, 15 lines from the function it documents |
| [86](#c-86) | Nit | [main.js:633](src/main.js#L633) | `metronome.muted` is serialized but the restore path hardcodes `false` _(dup of #62)_ |
| [87](#c-87) | Nit | [ParameterPanel.js:7](src/ui/ParameterPanel.js#L7) | Unused import of applyArpType in ParameterPanel |
| [88](#c-88) | Nit | [ParameterPanel.js:873](src/ui/ParameterPanel.js#L873) | `hasMapping('pan')` in updateParamRelevance can never be true — no gesture select offers `pan` _(dup of #76)_ |
| [89](#c-89) | Nit | [WaveformDisplay.js:235](src/ui/WaveformDisplay.js#L235) | UI copy drift: canvas hint names a button that does not exist, page title is not the product name |

---

# Critical (1)

<a id="c-1"></a>
### 1. playbackRate is ignored in grain duration math: source ends mid-envelope at any pitch > 1, clicking on every grain

**Critical** · `dsp-correctness` · [grainFactory.js:113](src/audio/grainFactory.js#L113)

`source.start(when, offset, grainDuration)` passes the grain length as the AudioBufferSourceNode `duration` argument, which per the Web Audio spec is measured in the *buffer's* time base — the source stops after `grainDuration` buffer-seconds have been consumed, i.e. after `grainDuration / playbackRate` seconds of wall clock. But the envelope is stretched over wall clock: `gainNode.gain.setValueCurveAtTime(scaledCurve, when, grainDuration)` (grainFactory.js:91), and the stop is scheduled in wall clock too: `source.stop(when + grainDuration)` (grainFactory.js:114). `pitch` is only applied at grainFactory.js:73 (`source.playbackRate.value = pitch`) and never enters the duration math.

Consequence for pitch > 1: the source falls silent while the gain curve is still high, so the waveform is truncated at a non-zero amplitude. For pitch = 2 the Hann window is at index 64/128 when the source stops — `0.5*(1-cos(2π*64/127)) ≈ 0.9998`, i.e. the *peak* of the window. The grain is cut off at full amplitude.

This is not an edge case: the default Y-axis gesture mapping is `yToPitch(y) = Math.pow(2, 2 - 4*y)` (src/main.js:177-180), so the entire top half of the canvas produces pitch > 1, up to 4.0 at the top edge (envelope cut at ~0.5 of the Hann window).

For pitch < 1 there is no click (the envelope has already returned to 0 when `source.stop()` fires) but only `1/pitch` of the requested material is heard, so the grain reads less of the buffer than the UI implies.

Two secondary consequences follow from the same mistake: the anti-clipping overlap estimate `grainDuration / interOnset` (grainFactory.js:64) uses buffer-time duration rather than actual wall-clock grain length, so it over-attenuates at pitch > 1 and under-attenuates at pitch < 1; and `onGrain({duration: grainDuration})` (grainFactory.js:122) reports buffer-time duration, so GrainOverlay draws the wrong grain width for any pitch ≠ 1.

**How it fails**

> Load any sample, touch the upper half of the canvas so `yToPitch` returns 2.0, leave the default Hann envelope and default grain size (0.4 s from `grainSizeMax = 0.8674` → `expMap(0.8674, 0.001, 1.0)`). Every grain plays 0.2 s of wall clock, is cut off exactly at the Hann peak, and produces a full-amplitude step discontinuity → a buzzy click at the grain rate (10 Hz at the default 0.1 s inter-onset, rising to 200 Hz at minimum inter-onset).

**Suggested fix**

Separate buffer span from wall-clock span:
```js
const wallDuration = Math.min(duration, (buffer.duration - offset) / pitch);
if (wallDuration < 0.001) return;
const bufferSpan = wallDuration * pitch;   // seconds of source consumed
...
gainNode.gain.setValueCurveAtTime(scaledCurve, when, wallDuration);
source.start(when, offset, bufferSpan);
source.stop(when + wallDuration + 0.001);
```
Use `wallDuration` for the overlap estimate and for the `onGrain` payload as well.

---

# High (11)

<a id="c-2"></a>
### 2. GrainScheduler never clamps nextGrainTime to currentTime: a single main-thread stall schedules hundreds of grains in the past, all firing simultaneously

**High** · `scheduling` · [GrainScheduler.js:91](src/audio/GrainScheduler.js#L91)

`_tick()` fills the look-ahead window with `while (this.nextGrainTime < deadline) { this.onScheduleGrain(this.nextGrainTime); ... this.nextGrainTime += iot; }` (GrainScheduler.js:91-111). `nextGrainTime` is only ever advanced by `iot`; it is never re-anchored to `audioContext.currentTime`. The look-ahead pattern only works if the timer fires more often than `scheduleAhead`; the code assumes `setTimeout(…, 25)` always does.

It does not. `setTimeout` in a hidden tab is throttled to ≥1000 ms (and to ~1/min under Chrome's intensive throttling after 5 minutes hidden), and any main-thread stall — `decodeAudioData` on a large file (src/audio/GranularEngine.js:75), a session import, GC, canvas resize — blocks the timer for the same reason. When `_tick` finally runs, `nextGrainTime` lags `currentTime` by the whole stall, and the loop runs `(stall + 0.1) / iot` iterations, every one of them calling `createGrain` with a `when` in the past. `source.start(when)` with `when < currentTime` starts the source *immediately*, so all of them fire in the same render quantum.

At the fastest inter-onset the code can produce (`expMap(0, 0.005, 0.5)` = 5 ms, src/main.js:226) a 1 s throttle yields ~220 simultaneous grains from one voice; a 60 s hidden period yields ~12,000 — each with its own BufferSource + GainNode (+ StereoPanner when panning), all summing coherently at the same instant. Multiply by up to 14 voices (src/input/VoiceAllocator.js:9) and by the number of tabs.

The same missing clamp also affects the very first grain of every voice: `start()` sets `this.nextGrainTime = this.audioContext.currentTime` (GrainScheduler.js:47) and calls `_tick()` synchronously, so grain 0 is scheduled at exactly `currentTime` — already in the past by the time the audio thread reaches it, meaning its `setValueCurveAtTime` starts partway up the window and the note onset clicks.

Metronome._tick (src/audio/Metronome.js:148-166) has the identical structure and the identical missing clamp.

**How it fails**

> Hold a finger on the canvas (or start loop playback), switch to another browser tab for 30 seconds, switch back. `nextGrainTime` is ~30 s behind `currentTime`; the next `_tick` schedules ~6,000 grains (at 5 ms inter-onset) with `when` in the past, all of which start in the same render quantum → a full-scale transient, an audible glitch/dropout, and a CPU spike from ~12,000 simultaneously-created audio nodes.

**Suggested fix**

Re-anchor and bound the loop at the top of `_tick`:
```js
const now = this.audioContext.currentTime;
if (this.nextGrainTime < now) this.nextGrainTime = now;   // drop missed grains
const deadline = now + this.scheduleAhead;
let budget = 256;                                          // hard cap per tick
while (this.nextGrainTime < deadline && budget-- > 0) { … }
```
Apply the same clamp in `Metronome._tick`. Optionally pause scheduling entirely when `document.hidden` or when `audioContext.state !== 'running'`.

<a id="c-3"></a>
### 3. Metronome beat grid free-runs by float accumulation and is never re-derived from the clock epoch — after any BPM change the click is up to half a beat off the grid the loops snap to

**High** · `bpm-sync` · [Metronome.js:164](src/audio/Metronome.js#L164)

`Metronome` computes its grid once at `start()` (`this._nextBeatTime = this._clock.getNextBeatTime(now)`, :63) and thereafter only accumulates:

```js
this._nextBeatTime += this._clock.getBeatDuration();                 // :164
this._nextBeatIndex = (this._nextBeatIndex + 1) % this._clock.numerator; // :165
```

`MasterClock`, by contrast, recomputes everything from the epoch on demand (`quantizeToBar` = `epoch + round(elapsed/barDur)*barDur`, MasterClock.js:157-161). The two agree only while BPM, numerator and denominator are constant. As soon as any of them changes mid-flight the metronome keeps the *old* phase and adopts the *new* period, while the clock re-maps every boundary relative to the epoch.

Measured with the real `Metronome` + `MasterClock` (epoch 0, 120 BPM for 10 s, then `clock.bpm = 140`):
```
metronome clicks:  10.5000, 10.9286, 11.3571, 11.7857, ...
clock beat grid :  10.2857, 10.7143, 11.1429, 11.5714, ...
phase error: -0.5000 beats = -214.3 ms   (permanent)
```

Players in loop-station mode align to the *clock* grid (Player.js:253) while the user hears the *metronome* grid. So after one BPM tweak the loops are audibly ~half a beat off the click, and no amount of waiting corrects it. The same divergence happens on a time-signature change (main.js:1142-1152 mutates `numerator`/`denominator` while `_nextBeatIndex` keeps counting modulo the new value from an arbitrary phase).

**How it fails**

> Turn the metronome on, start a loop-station loop, then move the BPM slider one notch. The click track and the looped material are now permanently ~214 ms apart at 120→140; the beat-dot indicator (driven from `_nextBeatIndex`, main.js:1187) also stops marking the clock's real downbeat.

**Suggested fix**

Make the metronome stateless with respect to phase: each tick, derive the next beat from the clock (`this._nextBeatTime = this._clock.getNextBeatTime(this._nextBeatTime)` / recompute `beatIndex = clock.getBeatInBar(this._nextBeatTime)`) instead of accumulating. Add a `MasterClock.setBpm(newBpm, atTime)` that re-anchors the epoch so the current beat phase is preserved across tempo changes, and have all consumers go through it.

<a id="c-4"></a>
### 4. startCountIn() resets the global clock epoch, re-anchoring the bar grid under every already-looping layer

**High** · `bpm-sync` · [Metronome.js:100](src/audio/Metronome.js#L100)

There is exactly one `MasterClock` for the whole app (`MasterBus.js:40`), shared by every instance's `Player` (main.js:485, 675, 764, 1124). `startCountIn` unconditionally moves its origin:

```js
const now = this._ctx.currentTime;
this._clock.setEpoch(now);      // Metronome.js:100
this._nextBeatTime = now;       // :101
this._nextBeatIndex = 0;        // :102
```

and `main.js:944-960` calls `startCountIn` every time the user arms a record in loop-station mode — on *any* tab. Every other layer that is mid-loop is anchored to `_startTime` values derived from the OLD grid, and will bar-snap against the NEW grid at its next wrap (Player.js:253), teleporting by the epoch shift.

Verified against the real classes: with a 2.0 s bar, `met.startCountIn()` at t = 33.3 moves the epoch from 0 to 33.3, i.e. the whole grid shifts by `33.3 % 2.0 = 0.7286 s`.

Two further problems in the same method: when the metronome is *already* running (`metronomeEnabled` free-run), `_nextBeatTime = now` yanks the click grid mid-beat while a click scheduled up to 100 ms ahead has already been committed to the audio graph (`osc.start(when)`, :199) — you get a double click; and the pending visual callbacks in `_beatTimeoutIds` are not cleared, so the beat dots flash on the stale grid for another ~100 ms.

**How it fails**

> Layer 1 is looping in loop-station mode. Switch to tab 2 and hit Record. The count-in re-anchors the epoch to that arbitrary moment; at layer 1's next wrap `quantizeToBar` snaps it to the new grid and layer 1 audibly jumps by up to half a bar — the act of recording a new layer knocks the existing layers out of time.

**Suggested fix**

Set the epoch exactly once (at AudioContext start, or the first time the transport engages) and never move it while any player `isPlaying` or the metronome `running`. For count-in, don't move the epoch — compute the count-in start as `clock.getNextBarTime()` and count down to it.

<a id="c-5"></a>
### 5. Re-triggering a voice within 30 ms of releasing it leaves its gain pinned at 0 — the voice is silent for its whole life

**High** · `correctness` · [Voice.js:140](src/audio/Voice.js#L140)

`Voice.stop()` schedules a fade-out on the shared per-voice gain node: `cancelScheduledValues(now)` / `setValueAtTime(gain.value, now)` / `linearRampToValueAtTime(0, now + 0.03)` (Voice.js:145-153). Nothing ever cancels that trailing ramp-to-zero. `Voice.start()` (Voice.js:80-90) deliberately does not touch the gain node — the comment at Voice.js:86-87 says "Gain level is set externally by GranularEngine._updateVoiceGains()" — and `setGainLevel` only appends `linearRampToValueAtTime(value, now + 0.02)` (Voice.js:184-188).

Meanwhile `VoiceAllocator.allocate()` hands back the *first inactive* voice (src/input/VoiceAllocator.js:61-66), and `Voice.stop()` sets `active = false` immediately, so the slot is reusable the instant it is released.

So if a voice is re-allocated less than 30 ms after being stopped, the AudioParam timeline ends up as:
`setValueAtTime(v, t0)` → `linearRamp(scale, t0+0.02)` (from stopVoice's `_updateVoiceGains`) → `linearRamp(scale2, t0+0.025)` (from the new startVoice's `_updateVoiceGains`) → `linearRamp(0, t0+0.03)` (the leftover fade-out).
Events are ordered by time, so the ramp to 0 is last: the param reaches 0 at `t0+0.03` and **holds 0 indefinitely**, because nothing schedules another event on that node until some *other* voice starts or stops. The freshly-started voice keeps generating grains into a gain node stuck at zero.

**How it fails**

> Single finger, quick double-tap (release and re-press within ~30 ms) — or a recorded automation lane containing a `stop` and a `start` for the same `voiceIndex` less than 30 ms apart, replayed via `Player.onDispatch` (src/state/InstanceManager.js:61-68). The second tap allocates the same pool slot (index 0), its gain hits 0 at t0+30 ms and stays there, so the note is completely inaudible until an unrelated voice start/stop happens to re-ramp every voice via `_updateVoiceGains`.

**Suggested fix**

Cancel the stale fade at the top of `Voice.start()`:
```js
start(params) {
    const now = this.audioContext.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    this.active = true;
    …
}
```
Also consider having `VoiceAllocator.allocate()` prefer the least-recently-released slot instead of always the first inactive one.

<a id="c-6"></a>
### 6. Loop wrap discards the frame overshoot, so every loop iteration is one frame too long — unbounded drift

**High** · `timing-drift` · [Player.js:256](src/automation/Player.js#L256)

Player._tick's non-loop-station wrap (Player.js:241-256) re-anchors _startTime to currentTime instead of advancing it by an exact loop length, discarding the up-to-one-frame overshoot; each iteration is therefore ~14 ms long at 60 fps (~22 ms at 30 fps) and the error accumulates without bound because nothing re-references an absolute grid on this path. Applies when loop-station mode is off (the loop-station branch at :250-254 re-grids each wrap, at the cost of its own teleport bug); loopStationMode defaults to true, so this is the free-form-looping path. Fix: `_startTime += (loopEnd - _loopStart)` and carry the overshoot into _lastProcessedTime, with a while-loop for multi-iteration overshoot.

**How it fails**

> Record a 2 s loop on layer A and an identical 2 s loop on layer B, start both, walk away. After ~1 minute at 60 fps each layer is ~0.42 s behind the grid; if one tab renders at 30 fps while the other renders at 60 fps the two layers are ~0.2 s apart from each other and the gap keeps widening. Nothing ever pulls them back.

**Suggested fix**

Advance the anchor by an exact loop length instead of resetting it to `currentTime`: `this._startTime += (loopEnd - this._loopStart);` and set `this._lastProcessedTime = this._loopStart + (elapsed - loopEnd)` so the overshoot is consumed by the new iteration rather than discarded. Guard against pathological overshoot (`elapsed - loopEnd > loopLen`) by fast-forwarding whole iterations in a `while` loop instead of a single `if`.

<a id="c-7"></a>
### 7. Loop-station wrap snaps to the NEAREST bar, teleporting the playhead up to half a bar and replaying events outside the loop range

**High** · `correctness` · [Player.js:253](src/automation/Player.js#L253)

At a loop-station wrap:

```js
const barAligned = this._clock.quantizeToBar(now);   // :253
this._startTime = barAligned - this._loopStart;      // :254
this._lastProcessedTime = this._loopStart;           // :258
```

`MasterClock.quantizeToBar` (MasterClock.js:157-161) uses `Math.round`, so `barAligned` can be up to **half a bar in the past or in the future** relative to `now`.

- Rounds **down**: `currentElapsed = now - _startTime` immediately jumps to `_loopStart + (now - barAligned)`. The whole `[loopStart, currentElapsed)` slice is then dispatched in a single frame at :277 — up to half a bar of gesture is compressed into one frame.
- Rounds **up**: `_startTime > now`, so `currentElapsed < _loopStart`. `getEventsInRange(_loopStart, currentElapsed)` returns empty (endTime < startTime), but line 307 still writes `this._lastProcessedTime = currentElapsed` — now *before* `_loopStart`. On the following frames the window `[currentElapsed, …)` sweeps over material that lies outside the user's loop range and dispatches it.

Reproduced with the real class (bar = 2.0 s @120 BPM, `setLoopRange(1.0, 3.0)`, lane has events at 0.10/0.50/0.90 marked PRE-LOOP and 1.0/2.0/2.95 marked IN-LOOP):
```
2.967 start id=2001 IN-LOOP     <- crossfade pre-start
2.967 stop  id=1001
3.117 start id=2000 PRE-LOOP    <- outside the loop range, replayed
3.517 move  id=2000 PRE-LOOP
3.917 stop  id=2000
4.017 start id=2001 IN-LOOP     <- 2001 started a second time, never stopped
```

**How it fails**

> Loop-station mode, 4/4 @120 (bar = 2 s). Set the loop handles to 1.0–3.0 s and start playback. At the first wrap the bar-snap rounds up to 4.0 s, `_lastProcessedTime` is left at 0.017 s, and the next second of playback replays the gesture recorded at 0.1–0.9 s — material the user explicitly excluded from the loop — before jumping back into the loop.

**Suggested fix**

Never snap the wrap to the nearest bar. Phase-lock once at `play()` (align `_startTime` to `clock.getNextBarTime()`), then advance `_startTime` by exact loop lengths. If a re-grid is still wanted, use a forward-only boundary (`getNextBarTime`) and clamp: `this._lastProcessedTime = Math.max(this._loopStart, currentElapsed)`.

<a id="c-8"></a>
### 8. Loop length is stored in seconds but the wrap is snapped to the live bar grid, so a mid-playback BPM change truncates or stretches every loop

**High** · `bpm-sync` · [Player.js:253](src/automation/Player.js#L253)

> **Related to [#7](#c-7)** — same code, different failure. Read both before fixing either.

`_loopEnd` is an absolute number of seconds captured at record time (`main.js:861 fixedRecordDuration = barCount * masterBus.clock.getBarDuration()`, then `main.js:884 active.player.setLoopRange(0, loopDuration)`). The wrap, however, re-snaps to `this._clock.quantizeToBar(now)` (Player.js:253), which reads the **current** BPM. The BPM slider mutates the shared clock live with no re-derivation of any loop range:

```js
bpmSlider.addEventListener('input', () => { masterBus.clock.bpm = parseInt(bpmSlider.value, 10); ... });  // main.js:73-79
```

Measured with the real `Player` + `MasterClock` (loop = 4.000 s = exactly 2 bars @120):
```
wrap times: 4.017, 8.017, 12.000, 16.000, 19.433, 22.867, 26.300, 29.717
intervals : 4.000, 3.983, 4.000, 3.433, 3.433, 3.433, 3.417   <- BPM 120->140 at t=10
```
After the tempo nudge the loop wraps every 3.433 s (2 bars @140) while the recorded content is still 4.000 s long — 0.57 s of every iteration is silently cut off, forever.

This also contradicts the design doc, which is stale: `agents/CLAUDE.md:227` states "**BPM changes do NOT affect playback.** If you record at 120 BPM … then change BPM to 140, playback still uses the original 120 BPM timing." In loop-station mode BPM changes very much affect playback — just not in a musically coherent way.

**How it fails**

> Record a 2-bar loop at 120 BPM in loop-station mode, let it play, then tap tempo to 140. Every subsequent iteration drops the last 0.57 s of the recording. Reloading a saved session at a different BPM has the same effect, since `SessionSerializer.js:33` persists `loopRange` in seconds.

**Suggested fix**

Store loop points as musical positions (bars/beats), not seconds: keep `loopStartBars`/`loopLengthBars` on the Player and derive seconds from `clock.getBarDuration()` on every read. Equivalently, on BPM change, rescale every player's `_loopStart`/`_loopEnd`/`_startTime` by `oldBarDur/newBarDur` and re-anchor to the grid.

<a id="c-9"></a>
### 9. Playback is rAF-driven, so a backgrounded tab drops entire loop iterations and leaves the layer permanently offset

**High** · `correctness` · [Player.js:314](src/automation/Player.js#L314)

`_tick()` re-arms with `this._rafId = requestAnimationFrame(this._tick)` (:314) and the dispatch window is `[_lastProcessedTime, currentElapsed)` (:277). Browsers throttle rAF to ~1 Hz or stop it entirely in a background tab, while `audioContext.currentTime` keeps running. Every event that falls inside the stalled span is enumerated in one giant window and dispatched in a single frame — and any span longer than one loop is lost outright because the boundary handler at :241 is a single `if`, not a `while`.

Reproduced with the real class (loop 0–2.0 s, one 5 s rAF stall at t = 0.5):
```
0.017 start id=1000
0.033 move  id=1000
5.500 start id=2000    <- 'move'@0.5 and 'stop'@1.9 never dispatched
5.500 move  id=2000
5.500 RELEASE id=1000
```
Two and a half loop iterations vanished, the recorded `stop` for voice 1000 never ran, and `_startTime` was reset to 5.5 — the layer is now 1.5 s (3/4 of a loop) out of phase with any layer that stayed in the foreground.

Note the same fragility applies to `main.js`'s render loop, which owns the fixed-length record auto-stop (`main.js:1321 if (elapsed >= fixedRecordDuration) finishRecording(active)`): a stalled tab overshoots the recording length by the whole stall.

**How it fails**

> Two layers looping; the user switches to another browser tab for 5 seconds. On return the layers are out of phase by up to a full loop and stay that way.

**Suggested fix**

Drive the Player from the same look-ahead pattern already used by `GrainScheduler`/`Metronome` — a `setTimeout(…, 25)` loop scheduling against `audioContext.currentTime` — rather than rAF (background `setTimeout` is throttled to 1 Hz but never stops, and the look-ahead window makes the schedule sample-accurate). Keep rAF only for the visual `onFrame` callback. Also make the boundary handler a `while` loop so multi-iteration overshoot is consumed rather than dropped.

<a id="c-10"></a>
### 10. Automation-playback voices drone for the entire time the tab is backgrounded (rAF-driven stop, setTimeout-driven grains)

**High** · `lifecycle` · [Player.js:314](src/automation/Player.js#L314)

> **Related to [#9](#c-9)** — same code, different failure. Read both before fixing either.

Voice *stop* is delivered only from `Player._tick`, which is driven by rAF: `this._rafId = requestAnimationFrame(this._tick)` (Player.js:314, started at :136). Grain production, however, runs on `setTimeout`: `this._timerId = setTimeout(() => this._tick(), this.timerInterval)` (GrainScheduler.js:113). Browsers suspend rAF for hidden tabs but only *throttle* setTimeout to ~1 Hz, and the AudioContext keeps running. There is no `visibilitychange`, `blur`, or `pagehide` handler anywhere in the codebase (grep over src/ shows only `resize`, `beforeunload`, pointer and click listeners). So every voice that was live when the tab was hidden keeps calling `Voice._onScheduleGrain` forever, and the `stop`/`loop-wrap`/`complete` paths in `_tick` (Player.js:241-273) never run. Metronome has the same split (Metronome.js:168 uses setTimeout), so it keeps clicking while playback is frozen — they return desynced.

**How it fails**

> Start loop-station playback of a recording, switch browser tabs (or lock the phone). rAF halts; the Player never dispatches the recorded `stop` events; each already-started `Voice`'s `GrainScheduler` keeps firing on throttled setTimeout. The sampler drones continuously (and burns CPU creating nodes) for the whole time the tab is hidden — minutes or hours — and only recovers when the tab is focused again and `_tick` resumes.

**Suggested fix**

Add a `visibilitychange` handler in main.js that, when `document.hidden`, either suspends the AudioContext or calls `player.stop()` / `engine.stopAllVoices()` for every instance and records the intent to resume. At minimum, drive `Player._tick` from a `setTimeout`/`setInterval` clock (or the audio clock) rather than rAF, so stop events are still delivered when rAF is suspended, and keep rAF strictly for drawing.

<a id="c-11"></a>
### 11. Automation recording drops all randomization/arp/quantization config, so playback is not reproducible after a session reload

**High** · `serialization-fidelity` · [Recorder.js:186](src/automation/Recorder.js#L186)

`extractParams` keeps only scalar params:
```js
const params = { position, amplitude, pitch, grainSize, interOnset, spread, pan, envelope };
if (resolved.adsr) params.adsr = resolved.adsr;
```
(src/automation/Recorder.js:186-200)

But `resolveParams` produces five more fields that drive the actual sound — `randomize`, `interOnsetRange`, `interOnsetQuantize`, `grainSizeQuantize`, `pitchQuantize` (src/main.js:302-317). `Voice.update` only overwrites keys that are `!== undefined`:
```js
if (params.randomize !== undefined) this.randomize = params.randomize;
if (params.grainSizeQuantize !== undefined) this.grainSizeQuantize = params.grainSizeQuantize;
if (params.pitchQuantize !== undefined) this.pitchQuantize = params.pitchQuantize;
```
(src/audio/Voice.js:132-134)

So replayed events inherit whatever the voice slot last held from a live gesture. Immediately after recording it *sounds* right (the slot is warm); after a reload every `Voice` is freshly constructed with `randomize = {grainSize:null,pitch:null,pan:null}` and `pitchQuantize = null` (src/audio/Voice.js:44,57), so the arpeggiator/randomization vanishes. This also contradicts agents/CLAUDE.md:229 ("each recording faithfully reproduces the original performance") and the doc's planned `'param'` event type (agents/CLAUDE.md:214), which was never implemented.

**How it fails**

> Enable Randomize Pitch + Arpeggiator with a custom arp shape, record a 4-bar loop in loop-station mode, hear the arpeggio loop correctly. Reload the page: the lane is restored (src/state/InstanceManager.js:308-318) and auto-plays, but every voice now uses `pitchQuantize = null` and `randomize.pitch = null`, so grains play at the flat recorded `pitch` with no arpeggio and no per-grain randomization — a completely different loop.

**Suggested fix**

Include the modulation config in `extractParams` (it is plain JSON-serializable data), or — to keep lanes small — snapshot it once per `'start'` event / as a lane-level header rather than per move event. At minimum, make `Voice.start` reset `randomize`/`pitchQuantize`/`grainSizeQuantize` to null when the param is absent, so behaviour is deterministic rather than dependent on slot-reuse history.

<a id="c-12"></a>
### 12. Loop handles map fractions onto the lane's last-event time while the player's loop end is an exact bar count — dragging a handle silently shortens the loop

**High** · `loop-points` · [main.js:1201](src/main.js#L1201)

Two different notions of "duration" are used for the same handle:

- `finishRecording` sets the player's loop end to an exact bar multiple and pins the handles to 0..1:
  ```js
  const loopDuration = fixedRecordDuration || masterBus.clock.quantizeDurationToBar(...); // main.js:882
  active.player.setLoopRange(0, loopDuration);  // :884
  transport.setLoopRange(0, 1);                 // :885
  ```
- `onLoopRangeChange` converts the same fractions back using a *different* duration:
  ```js
  const duration = active.recorder.getElapsedTime();   // main.js:1201
  let loopEnd = endFrac * duration;                    // :1205
  ```
  and `Recorder.getElapsedTime()` returns `this._lane.getDuration()` when not recording (Recorder.js:115) — i.e. **the timestamp of the last recorded event**, which is always ≤ the bar-quantized loop length (the performer lifts their finger before the bar boundary).

So simply nudging a handle and putting it back at the far right converts a 4-bar loop into a `lastEventTime`-long loop. The bar-snap at :1211-1213 then rounds that down, and the clamp `if (loopEnd <= loopStart) loopEnd = loopStart + barDur` (:1213) can collapse it all the way to **one bar**.

Also note `_loopStartFrac`/`_loopEndFrac` live on the single `TransportBar` (TransportBar.js:48-50) while loop ranges are per-instance on each `Player`; the tab-switch handler (main.js:434-467) never calls `transport.setLoopRange(...)` from the new tab's player, so the handles show the previous tab's positions. `TransportBar.resetLoopRange()` (TransportBar.js:183) is dead code — grep shows no caller.

**How it fails**

> Record a 4-bar loop in loop-station mode at 120 BPM (loop end = 8.0 s), releasing the last touch at 7.1 s. Grab the end handle, wiggle it, drop it at the far right: `loopEnd = 1.0 * 7.1 = 7.1 s`, bar-snapped to `round(7.1/2)*2 = 8.0` — lucky. Release at 6.4 s instead and it snaps to 6.0 s: the loop is now 3 bars and every subsequent layer recorded against it is a bar short.

**Suggested fix**

Make the handle fractions relative to the player's own loop domain, not the recorder's: expose `player.getLoopableDuration()` (the bar-quantized recorded length) and use it in `onLoopRangeChange`. Sync `transport.setLoopRange(...)` from `player.getLoopRange()` inside the tab-switch handler and after every `setLoopRange`, and call `resetLoopRange()` when a new recording begins.

---

# Medium (26)

<a id="c-13"></a>
### 13. Nothing phase-locks playback start or grain onsets to the master clock — quantized densities have correct interval but arbitrary phase

**Medium** · `bpm-sync` · [GrainScheduler.js:47](src/audio/GrainScheduler.js#L47)

Two independent anchor points are set from "whenever this happened to be called", with no reference to `MasterClock`:

1. `Player.play()`: `this._startTime = this._audioContext.currentTime;` (Player.js:129). Even in loop-station mode the clock is consulted only at the *first wrap* (:250-253) — the entire first iteration plays off-grid and then teleports.
2. `GrainScheduler.start()`: `this.nextGrainTime = this.audioContext.currentTime;` (GrainScheduler.js:47). `GrainScheduler.js` imports `getSubdivisionSeconds` but never imports or receives the clock — grep for `clock` across `src/` returns zero hits in `GrainScheduler.js` and `Voice.js`.

So when the user enables quantized density (`main.js:235 interOnset = getSubdivisionSeconds(bpm, m.subdivDensity)`), grains land every 1/16 note *of the right duration* but starting from an arbitrary sub-frame offset. Since `Player.onDispatch` → `engine.startVoice` → `Voice.start()` → `scheduler.start()` runs on a rAF frame, that offset is re-randomised (0–16 ms) at every single loop iteration and is different for every layer.

**How it fails**

> Two layers both set to 1/16-note density at 120 BPM. Start layer A, then layer B two seconds later. Their grain trains have identical periods but a fixed random offset of up to 16 ms, and each loop iteration re-rolls that offset — the two layers never lock, and neither locks to the metronome.

**Suggested fix**

Give `GrainScheduler` a reference to the `MasterClock` and, when `quantizeBpm !== null`, initialise `nextGrainTime` to the next grid point (`clock.getNextSubdivisionTime(now, divisor)`) instead of `currentTime`; keep accumulating from that grid rather than from the start time. Likewise, in `Player.play()`, when `_loopStationMode` is on, set `_startTime = clock.getNextBarTime()` and defer dispatch until then.

<a id="c-14"></a>
### 14. GrainScheduler never clamps nextGrainTime to currentTime — any main-thread stall produces a synchronous burst of hundreds of grains scheduled in the past

**Medium** · `correctness` · [GrainScheduler.js:91](src/audio/GrainScheduler.js#L91)

> **Same defect as [#2](#c-2)**, found independently by the `state-consistency` lens. Kept because it adds detail the other report does not have — fix them together.

`_tick()` computes `const deadline = this.audioContext.currentTime + this.scheduleAhead;` then runs `while (this.nextGrainTime < deadline) { this.onScheduleGrain(this.nextGrainTime); ... this.nextGrainTime += iot; }` (GrainScheduler.js:89-111). `nextGrainTime` is only ever set once, at `start()` (line 47), and afterwards only advanced by `iot`. It is never resynchronised to `currentTime`. If the timer is late by Δ seconds, the loop must iterate `(Δ + 0.1) / iot` times in one synchronous pass, and every grain gets a `when` value in the past. `createGrain` passes that straight through to `source.start(when, offset, grainDuration)` (grainFactory.js:113), and Web Audio starts a source with a past `startTime` immediately — so the whole backlog fires at once. `iot` can be as low as 0.005 s (`expMap(norm, 0.005, 0.5)`, GrainScheduler.js:104).

**How it fails**

> A background-tab timer throttle (1 s), a GC pause, or the undebounced full-buffer waveform recompute on window resize stalls the main thread for 1 s while 8 voices run at minimum inter-onset. Each voice's next `_tick` iterates (1.0 + 0.1)/0.005 = 220 times, creating 220 BufferSource+Gain(+Panner) nodes synchronously — ~1760 nodes in one tick — all of which start simultaneously because their `when` is in the past. Result: a CPU spike that causes further stalls (positive feedback) and an amplitude spike in the output.

**Suggested fix**

At the top of the while loop (or right after computing `deadline`) clamp: `if (this.nextGrainTime < this.audioContext.currentTime) this.nextGrainTime = this.audioContext.currentTime;` and additionally cap the number of grains scheduled per tick (e.g. `let n = 0; while (... && n++ < 64)`) so a stall drops grains instead of bursting.

<a id="c-15"></a>
### 15. GranularEngine.releaseVoice() zeroes the gain of the voice it just released, defeating the loop crossfade it exists to implement

**Medium** · `correctness` · [GranularEngine.js:137](src/audio/GranularEngine.js#L137)

`Voice.release()` documents its contract explicitly: "Does NOT fade the voice gain to zero" / "Gain node is left at its current value. Pre-scheduled grains (up to 100ms look-ahead) continue through their envelopes" (Voice.js:160-169). But `GranularEngine.releaseVoice()` immediately calls `this._updateVoiceGains()` (GranularEngine.js:138), and `_updateVoiceGains` does `this._allocator.setGainLevel(scale)` (GranularEngine.js:44) which `VoiceAllocator.setGainLevel` applies to **every** voice in the pool, including the one just released: `for (const voice of this.voices) voice.setGainLevel(value)` (VoiceAllocator.js:116-120). `scale` is `count > 0 ? 0.4 / Math.sqrt(count) : 0` where `count = activeCount` — and `Voice.release()` already set `this.active = false` (Voice.js:163). So when the last active voice is released, `scale === 0` and the released voice's gain is ramped to 0 over 20 ms (Voice.js:184-187), cutting the 100 ms grain tail the crossfade depends on. When other voices remain active, the tail is instead ramped *up* to the new, louder per-voice level.

**How it fails**

> Loop-station playback of a recording whose first 50 ms contains no `start` events (the normal case — the performer's first touch lands after the downbeat). At the loop boundary `_preStartNextIteration` starts nothing, then `_releaseIterationVoices('A')` releases every voice; after the last `releaseVoice` call `activeCount === 0`, so `scale = 0` and all released voices are ramped to silence in 20 ms. The audible gap at the loop point that CROSSFADE_WINDOW was added to eliminate is back.

**Suggested fix**

Track released-but-still-sounding voices separately (e.g. a `_releasing` flag on Voice) and have `VoiceAllocator.setGainLevel` skip them, or have `releaseVoice` compute the new scale from `activeCount + releasingCount` and apply it only to genuinely active voices.

<a id="c-16"></a>
### 16. Loop crossfade double-counts voices, producing a 3 dB level dip at every loop boundary

**Medium** · `gain-staging` · [GranularEngine.js:40](src/audio/GranularEngine.js#L40)

`_updateVoiceGains()` sets every voice to `0.4 / Math.sqrt(activeCount)` (GranularEngine.js:40-45) and is called from `startVoice` (GranularEngine.js:92), `stopVoice` (GranularEngine.js:124) and `releaseVoice` (GranularEngine.js:138).

The crossfade in `Player` deliberately starts the next iteration's voices *before* releasing the current iteration's: `_preStartNextIteration()` runs 50 ms before the loop end (Player.js:235-238) and `_releaseIterationVoices()` only runs when `elapsed >= loopEnd` (Player.js:244). During that 50 ms window `activeCount` is doubled, so `scale` drops from `0.4/√N` to `0.4/√(2N)` — exactly −3.01 dB — and, because `VoiceAllocator.setGainLevel` applies to *all* voices in the pool (src/input/VoiceAllocator.js:116-120), the outgoing iteration's still-scheduled grains are ducked too. At the boundary the count halves again and everything jumps back up.

The result is a −3 dB notch (with hard step edges, per the linearRamp finding) at every single loop repeat — the opposite of the seamless crossfade the design intends.

A related ordering artefact exists on the normal stop path: `stopVoice` calls `voice.stop()` (ramp to 0 over 30 ms) and then `_updateVoiceGains()`, which appends `linearRamp(scale, now+0.02)` to that same node. The stopping voice's gain therefore rises toward the new, louder `scale` for 20 ms before crashing to 0 in the remaining 10 ms.

**How it fails**

> Record a 4-bar loop using 4 fingers, enable loop-station playback. 50 ms before each wrap, `_preStartNextIteration` starts 4 more voices → `activeCount` 4→8 → every voice's gain ramps from 0.200 to 0.141. At the wrap the old 4 are released → back to 0.200. Audible level pumping locked to the loop period.

**Suggested fix**

Exclude released/outgoing voices from the count, or freeze `_updateVoiceGains` during the crossfade window (e.g. compute the scale from the number of *pointer-mapped* voices rather than `active` voices, and skip re-ramping voices whose scheduler is stopped). In `stopVoice`, call `_updateVoiceGains()` before `voice.stop()`, or have `setGainLevel` skip voices that are `!active`.

<a id="c-17"></a>
### 17. Metronome is routed pre-limiter, so every click ducks the entire mix

**Medium** · `gain-staging` · [MasterBus.js:43](src/audio/MasterBus.js#L43)

`this.metronome = new Metronome(this.audioContext, this.clock, this.masterGain)` (MasterBus.js:43) and `Metronome` connects its gain node straight to that destination (`this.gainNode.connect(destination)`, Metronome.js:17). `masterGain` feeds the brickwall limiter (`masterGain → limiter → softClipper → analyser → destination`, MasterBus.js:34-37), so the click sits *upstream* of a DynamicsCompressor configured at threshold −3 dB, knee 0, ratio 20, attack 1 ms, release 50 ms (MasterBus.js:20-24).

The downbeat click starts at `amp = 1.0` with a `setValueAtTime` step (Metronome.js:181, 193) through a metronome gain of 0.5, so a 0.5-amplitude impulse is added on top of the program material on every beat. With the program already sitting near the −3 dB threshold, each click drives the compressor into gain reduction for its 50 ms release — the granular material audibly ducks and pumps on every beat, including during count-in and during recording, which is precisely when the user is listening for the sample.

**How it fails**

> Enable the metronome at 120 BPM while a dense grain stream is playing near full level. Every 500 ms the mix drops by several dB for ~50 ms in sync with the click, which is both distracting and gets baked into the user's judgement of their loop levels.

**Suggested fix**

Route the metronome around the limiter: `new Metronome(ctx, clock, this.analyser)` (keeps it visible on the meter) or straight to `this.audioContext.destination`. Also give the click a 1–2 ms attack ramp instead of `setValueAtTime(amp, when)` so it isn't a raw step.

<a id="c-18"></a>
### 18. linearRampToValueAtTime is used without cancelling/anchoring, so every gain change is a step discontinuity rather than a ramp

**Medium** · `clicks` · [Voice.js:184](src/audio/Voice.js#L184)

Four places change gain with a bare ramp:
- `Voice.setGainLevel`: `this.gainNode.gain.linearRampToValueAtTime(value, now + 0.02)` (Voice.js:184-188)
- `GranularEngine.setInstanceVolume` (GranularEngine.js:155-158)
- `MasterBus.setMasterVolume` (MasterBus.js:60-63)
- `Metronome.setVolume` / `setMuted` (Metronome.js:120-124, 133-137)

Per the Web Audio spec, a linear ramp interpolates from the *previous automation event* `(T0, V0)` to `(T1, V1)`. When the previous event is an old ramp that finished seconds ago, inserting `linearRamp(V1, now + 0.02)` makes the evaluated value at the current time `V0 + (V1-V0)·(now-T0)/(now+0.02-T0)`, which for `now - T0 ≫ 20 ms` is essentially `V1`. The parameter therefore jumps discontinuously the moment the ramp is inserted, instead of gliding over 20 ms.

This is exactly the case `_updateVoiceGains` hits: a second finger touching down 10 seconds after the first makes every voice's gain step from 0.4 to 0.283 in one sample. `Voice.stop()` (Voice.js:145-153) already does it correctly with `cancelScheduledValues` + `setValueAtTime(gain.value, now)` + ramp — the other four sites were not given the same treatment.

A related nuance at the same sites: `cancelScheduledValues(t)` removes an in-flight ramp entirely (the param reverts to the previous event's value), which is why the `setValueAtTime(gain.value, now)` anchor is mandatory, not optional.

**How it fails**

> Play a sustained voice for 10 s, then touch a second finger. `_updateVoiceGains` (GranularEngine.js:40-45) calls `setGainLevel(0.4/√2 = 0.283)` on all 14 voices; the previous automation event on voice 0 is the ramp that ended ~10 s ago, so voice 0's gain steps from 0.400 to 0.283 within a single render quantum → an audible click on every voice at every touch-down/lift. Dragging the master volume slider produces the same effect ~60×/s (zipper noise).

**Suggested fix**

Factor a helper and use it everywhere:
```js
function rampTo(param, value, ctx, time = 0.02) {
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + time);
}
```

<a id="c-19"></a>
### 19. Custom ADSR envelope produces a mid-grain step, or ends at non-zero gain, whenever a + d + r > 1

**Medium** · `clicks` · [envelopes.js:311](src/audio/envelopes.js#L311)

`_computeADSRFromParams` derives three independent breakpoints and then tests them in a fixed order:
```js
const aEnd  = Math.floor(a * N);
const dEnd  = Math.floor((a + d) * N);
const rStart = Math.floor((1 - r) * N);
if (i <= aEnd) … else if (i <= dEnd) … else if (i < rStart) … else /* release */
```
(envelopes.js:311-334; duplicated verbatim in `_computeCustomADSR`, envelopes.js:342-366). Nothing enforces `dEnd < rStart`. `ADSRWidget` clamps each of a, d, r to `[0.01, 0.5]` independently (src/ui/ADSRWidget.js:95, 98, 104), so `a + d + r` can reach 1.5.

Two distinct failures:
1. `a + d + r > 1` (⇒ `rStart < dEnd`): the decay branch runs past the intended release start, then the release branch resumes with `t = (i - rStart)/rLen` already well above 0. At `i = dEnd+1` the curve steps from `s` down to `s·(1 - (dEnd+1-rStart)/rLen)`. Example a=0.3, d=0.3, r=0.5, length 128 (N=127): `aEnd=38, dEnd=76, rStart=63`; `curve[76] = s`, `curve[77] = 0.781·s` — a −2.1 dB step in the middle of every grain.
2. `a + d >= 1` (e.g. a=0.5, d=0.5): `dEnd = N`, so the release branch is unreachable and the curve *ends* at `s`. The grain's gain is `s` at the instant the source stops → a full step to silence, i.e. a click on literally every grain.

**How it fails**

> Select the 'custom' envelope and drag the ADSR widget to a=0.5, d=0.5, s=0.7, r=0.2. `computeADSREnvelope` returns a 128-point curve whose last value is 0.7, `setValueCurveAtTime` ends there, and the buffer source stops at the same instant → every grain terminates with a −0 dBFS·0.7 discontinuity. At the default 0.1 s inter-onset that is a 10 Hz buzz; at 5 ms it is a 200 Hz square-ish tone unrelated to the sample.

**Suggested fix**

Normalize the segment lengths before computing indices, e.g. `const total = a + d + r; if (total > 1) { a /= total; d /= total; r /= total; }`, and additionally force `curve[length-1] = 0` so the envelope is guaranteed to terminate at silence regardless of parameters.

<a id="c-20"></a>
### 20. Anti-clipping overlap estimate uses the slowest possible inter-onset when density jitter is enabled, so attenuation is effectively disabled at high grain density

**Medium** · `gain-staging` · [grainFactory.js:63](src/audio/grainFactory.js#L63)

createGrain's Layer-1 overlap estimate (grainFactory.js:63-65) uses params.interOnset — the panel's fixed/resolved density value — while the actual grain spacing when random density is enabled is drawn per grain by GrainScheduler._tick from interOnsetRange (GrainScheduler.js:96-105). The two can differ by orders of magnitude, so the 1/sqrt(overlap) attenuation is wrong (usually too weak) whenever density jitter is on; the quantize+random combination is also mismatched because main.js only quantizes params.interOnset in the !randomDensity branch. Note the estimate is not always the range maximum: with a gesture mapped to density, params.interOnset is the lerped value and the error can go either way. Fix: have the scheduler report the inter-onset it actually used and pass it into createGrain.

**How it fails**

> Enable "random density", set densityMin = 0 and densityMax = 1, grain size ≈ 0.2 s. `params.interOnset` = expMap(1, 0.005, 0.5) = 0.5 s → `overlap = max(1, 0.2/0.5) = 1` → `overlapScale = 1`, i.e. no attenuation at all. The scheduler meanwhile emits grains as fast as every 5 ms, so up to 40 grains overlap at once, each at full `amplitude`. Output is ~16 dB (RMS) over the intended level and slams the limiter continuously.

**Suggested fix**

Have the scheduler report the inter-onset it actually used and pass it down, e.g. change the callback signature to `onScheduleGrain(when, iot)` and forward that value into `createGrain`'s `interOnset`. Alternatively compute the overlap from the *minimum* of the jitter range (`expMap(interOnsetRange[0], 0.005, 0.5)`) so the estimate is conservative rather than optimistic.

<a id="c-21"></a>
### 21. Crossfade pre-start makes every event in the first 50 ms of the loop fire twice

**Medium** · `correctness` · [Player.js:277](src/automation/Player.js#L277)

`_preStartNextIteration()` dispatches `getEventsInRange(this._loopStart, this._loopStart + CROSSFADE_WINDOW)` using `_getNextBase()` (Player.js:327-333). At the wrap, `_currentIteration` flips (`:247`) so `_getCurrentBase()` now *is* that base, and `_lastProcessedTime` is reset to `_loopStart` (`:258`). The very next dispatch window `[_loopStart, currentElapsed)` (`:277`) therefore covers the same 50 ms again and re-sends the identical events with the identical synthetic IDs.

Reproduced with the real class (loop 0–2.0 s, lane start@0.000 / move@0.033):
```
1.967 start id=2000     <- pre-start
1.967 move  id=2000
2.033 start id=2000     <- same id, same event, again
2.050 move  id=2000
```

The consequence in the engine: `VoiceAllocator.allocate` returns the already-mapped voice (VoiceAllocator.js:55-58), so the second `start` re-runs `Voice.start()` → `this.arpIndex = 0; this.arpDirection = 1;` (Voice.js:82-83). Every loop boundary silently resets the arpeggiator phase of every voice that begins in the first 50 ms, and re-applies params ~66 ms late.

**How it fails**

> Any looped recording whose first gesture starts at t≈0 (i.e. every loop-station recording, which always begins on the downbeat). With an arpeggiator running, the pattern restarts from step 0 twice per loop at slightly different times, so the arp never lines up with the bar.

**Suggested fix**

Track what the pre-start already consumed: after `_preStartNextIteration()`, set `this._preStartedUpTo = this._loopStart + CROSSFADE_WINDOW`, and at the wrap use `this._lastProcessedTime = this._preStartedUpTo` instead of `this._loopStart`. Reset `_preStartedUpTo` when the crossfade flag is cleared.

<a id="c-22"></a>
### 22. play() ignores _loopStart on the first pass, so the first iteration plays material outside the loop range

**Medium** · `loop-points` · [Player.js:129](src/automation/Player.js#L129)

```js
this._startTime = this._audioContext.currentTime;   // Player.js:129
this._lastProcessedTime = 0;                        // :130
```

Neither line consults `_loopStart`, even though `setLoopRange(start, end)` (:177) has been called and `_tick` honours `_loopStart` on every subsequent wrap (:254-258). So the first pass always starts from t=0 and runs through the entire pre-loop region, and only from the second iteration onward does the loop respect the user's start handle.

Observed with the real class (`setLoopRange(1.0, 3.0)`, lane has PRE-LOOP events at 0.10/0.50/0.90):
```
0.117 start id=1000 PRE-LOOP
0.517 move  id=1000 PRE-LOOP
0.900 stop  id=1000
1.000 start id=1001 IN-LOOP
```
The first pass is also `loopEnd - 0` long instead of `loopEnd - loopStart`, so the first iteration has a different musical length than every later one.

**How it fails**

> Drag the loop start handle to the middle of a recording and press Play: the first pass plays the discarded first half, at the wrong length, before the loop settles in.

**Suggested fix**

In `play()`, set `this._startTime = this._audioContext.currentTime - this._loopStart;` and `this._lastProcessedTime = this._loopStart;` so the first iteration is identical to all subsequent ones.

<a id="c-23"></a>
### 23. Loop-boundary voice release bypasses GhostRenderer, leaving ghost pointers frozen on the canvas

**Medium** · `correctness` · [Player.js:371](src/automation/Player.js#L371)

At a loop boundary the Player releases the previous iteration's voices via `this.onRelease(syntheticId)` (Player.js:368-381), and that callback is wired only to the audio engine: `player.onRelease = (syntheticId) => { engine.releaseVoice(syntheticId); }` (InstanceManager.js:71-73, duplicated at :283-285). Unlike `onDispatch`, it does not call `ghostRenderer.dispatch('stop', syntheticId)`. `GhostRenderer._pointers` therefore keeps the entry for that synthetic id (set at GhostRenderer.js:38-42) until it is overwritten two iterations later by the next pre-start with the same base, or until `clear()`. `draw()` renders every entry of `_pointers` at full alpha (GhostRenderer.js:84-86).

**How it fails**

> Play a 4-bar loop containing 5 recorded voices. At the first loop boundary, iteration A's 5 synthetic ids (1000..1004) are released via `onRelease`; the ghost renderer never learns they stopped. For the whole of iteration B the user sees 5 frozen ghost circles stuck at their last recorded positions, on top of the 5 live ghosts of iteration B — double the expected indicators, half of them motionless.

**Suggested fix**

In `InstanceManager`, make the release callback also notify the visualiser: `player.onRelease = (syntheticId) => { engine.releaseVoice(syntheticId); ghostRenderer.dispatch('stop', syntheticId); };` — in both `createInstance` and `restoreFromSession` (the two wiring sites are copy-pasted and must be kept in sync).

<a id="c-24"></a>
### 24. Recording stop never emits captureStop for pointers still held down — dangling start events sustain on playback

**Medium** · `correctness` · [Recorder.js:67](src/automation/Recorder.js#L67)

`Recorder.stopRecording()` (Recorder.js:67-75) merges the overdub lane and flips flags, but never writes `stop` events for voices whose `start` was captured and whose finger is still down. The callers make this unavoidable: `finishRecording()` calls `active.recorder.stopRecording()` and then `recorderPointerMap.clear()` (main.js:876-878), destroying the pointerId→voiceIndex mapping, so even when the finger is eventually lifted, `onStop` looks up `recorderPointerMap.get(pointerId)`, gets `undefined`, and skips `captureStop` (main.js:414-420) — and `captureStop` would early-return on `!this.isRecording` anyway (Recorder.js:169). The same gap exists in `transport.onStop` (main.js:988-991), `onPlayerComplete` (main.js:1257-1261) and `InstanceManager.switchTo` (InstanceManager.js:129-131).

**How it fails**

> Loop-station mode, 4-bar fixed-length recording. The performer holds a drone through the final bar. The auto-stop fires from inside `render()` (main.js:1321-1323) while the finger is still on the canvas. The lane now contains a `start` for that voice with no matching `stop`. On playback, `Player._tick` dispatches the `start`; no `stop` ever arrives, so `activeVoices` keeps the id and the voice sustains from its start point all the way to the loop boundary, where `_releaseIterationVoices` finally kills it — a note that lasted 0.8 s in performance now lasts until the end of the bar on every repeat.

**Suggested fix**

Have `stopRecording()` (and `finishRecording`) emit a synthetic `stop` at the current time for every voiceIndex that has an unmatched `start` — track open voices in the Recorder itself rather than relying on `recorderPointerMap` in main.js — before clearing state.

<a id="c-25"></a>
### 25. `Ctrl+Z` can only undo the last loop iteration of an overdub, not the overdub session

**Medium** · `state-lifecycle` · [Recorder.js:55](src/automation/Recorder.js#L55)

`startOverdub` overwrites the undo snapshot every time it is called:
```js
startOverdub(startTime) {
    this._undoSnapshot = AutomationLane.fromJSON(this._lane.toJSON());
```
(src/automation/Recorder.js:55-62)

In loop-station mode `startOverdub` is re-invoked on *every* loop wrap by `onPlayerLoopWrap` (src/main.js:1284), so the snapshot is replaced each iteration with the already-merged lane. Meanwhile the keyboard handler only allows undo when the transport is idle:
```js
if (active && active.recorder.canUndo && transport.state === 'idle') { ... active.recorder.undoOverdub(); }
```
(src/main.js:1237-1244)

So undo is unavailable while overdubbing, and by the time the transport is idle the snapshot represents only the final loop pass.

**How it fails**

> Play a loop, enable overdub, layer for six loop iterations, then stop. Press Ctrl+Z expecting the pre-overdub loop back. Only the sixth iteration's additions are removed — the five earlier passes are permanently merged into the main lane with no way to revert, and `_undoSnapshot` is then nulled (src/automation/Recorder.js:84) so a second Ctrl+Z does nothing.

**Suggested fix**

Take the snapshot once when the user *enters* overdub mode (in `transport.onOverdub`, src/main.js:1044) rather than on every internal `startOverdub`, or keep a bounded stack of snapshots. Add a `startOverdub(startTime, { snapshot: false })` option for the loop-wrap auto-commit path.

<a id="c-26"></a>
### 26. Live touches and automation playback share one 14-voice pool with no stealing policy; exhausted allocation silently drops the touch with zero feedback

**Medium** · `correctness` · [VoiceAllocator.js:68](src/input/VoiceAllocator.js#L68)

`allocate()` scans for the first inactive voice and returns `null` when none is free (VoiceAllocator.js:60-68) — there is no stealing (no oldest-voice or quietest-voice victim selection). `GranularEngine.startVoice` propagates that as `undefined` (GranularEngine.js:90), and `PointerHandler._onPointerDown` then skips `this.pointers.set(...)` entirely (`if (voiceId != null)`, PointerHandler.js:140-148), so the pointer is not even drawn by `drawIndicator`. The pool is shared: `player.onDispatch` calls `engine.startVoice(syntheticId, ...)` on the same allocator (InstanceManager.js:63). The pool comment concedes this — "14 accommodates crossfade overlap at loop boundaries (two iterations of up to ~7 voices can coexist briefly)" (VoiceAllocator.js:6-8) — i.e. playback alone is designed to be able to consume all 14 slots. Note also `this.canvas.setPointerCapture(e.pointerId)` is called at PointerHandler.js:123 *before* allocation, so a pointer that will be completely ignored still captures.

**How it fails**

> A recorded loop with 7 simultaneous voices is playing in loop-station mode. During the 50 ms crossfade window both iterations are live, occupying all 14 slots. Every finger the performer puts on the canvas during that window gets `null` from `allocate()` — no sound, no pointer indicator, no gesture-meter movement, no console warning. The instrument appears dead for reasons the user cannot see.

**Suggested fix**

Add an explicit stealing policy in `allocate()` (steal the oldest-started voice, calling `stop()` on it first so its gain declicks), and/or reserve a slice of the pool for live input so playback can never starve touch. At minimum, still track the pointer in `PointerHandler.pointers` so the user gets a visual indicator, and surface pool exhaustion.

<a id="c-27"></a>
### 27. Three different notions of "recording duration" — progress bar can exceed 100% and loop handles map to the wrong timebase

**Medium** · `correctness` · [main.js:1201](src/main.js#L1201)

> **Related to [#12](#c-12)** — same code, different failure. Read both before fixing either.

Loop length, playback-progress denominator, and loop-handle fraction conversion use three unrelated values: the bar-derived `fixedRecordDuration` (main.js:882), `lane.getDuration()` inside Player (Player.js:125/311), and `recorder.getElapsedTime()` in onLoopRangeChange (main.js:1201). When a performer stops touching before the last bar ends (the common case), lane duration < loop duration, so (a) `setProgress` receives >1 and, with no clamp (TransportBar.js:221) and no overflow:hidden on #transport-progress, the fill visibly overruns its track, and (b) dragging the loop-end handle fully right maps to the shorter lane duration and bar-snaps to fewer bars than recorded. Fix by storing one authoritative loop duration at finishRecording and using it for both the progress denominator and the handle conversion.

**How it fails**

> Loop-station mode, 120 BPM 4/4, 4-bar record = 8.0s. The performer lifts their finger at 6.2s, so the last event is at t=6.2 and `lane.getDuration()` = 6.2 while `fixedRecordDuration` = 8.0. Player loops [0, 8.0] but reports progress `7.5/6.2 = 1.21` → progress fill renders at 121% width and the ghost timeline cursor is drawn past the right canvas edge. Then dragging the loop-end handle fully right yields `loopEnd = 1.0 * 6.2 = 6.2`, bar-snapped to 6.0s — silently shortening a 4-bar loop to 3 bars and breaking multi-layer bar alignment.

**Suggested fix**

Introduce a single authority for loop length — e.g. store `state.loopDurationSeconds` when recording finishes and have Player expose `getLoopDuration()` (falling back to `lane.getDuration()`), then use it for `onFrame` progress *and* as the denominator in `onLoopRangeChange` instead of `recorder.getElapsedTime()`.

<a id="c-28"></a>
### 28. fixedRecordDuration is a module-level global while recorders are per-instance — switching tabs mid-record leaks the auto-stop into another tab

**Medium** · `state-leak` · [main.js:122](src/main.js#L122)

`let fixedRecordDuration = null;` (main.js:122) is global, but recording is per-instance (`InstanceManager` gives every instance its own `Recorder`, InstanceManager.js:57). `InstanceManager.switchTo` stops the outgoing tab's recorder directly:

```js
if (current.recorder.isRecording) { current.recorder.stopRecording(); }   // InstanceManager.js:129-131
```

It bypasses `finishRecording()` entirely, so `fixedRecordDuration` is never cleared (it's only nulled in `finishRecording` :894, `cancelRecordArm` :924, and `onStop` :1004), and `active.ghostRenderer.recording` is left `true`.

The render loop then applies the stale value to whatever instance is recording next:
```js
if (active?.recorder.isRecording) {
    if (fixedRecordDuration !== null) { ... if (elapsed >= fixedRecordDuration) finishRecording(active); }   // main.js:1312-1323
}
```

**How it fails**

> Start a 4-bar loop-station recording on tab A, switch to tab B mid-take (recording on A is silently stopped, no loop range set, no auto-play). Arm record on tab B, which is in free-form mode, and touch the canvas. Tab B's free-form take is auto-stopped after 4 bars of A's tempo and is handed A's `finishRecording` treatment, including the loop-station auto-play branch if B happens to have the mode on.

**Suggested fix**

Move `fixedRecordDuration` (and the recording-phase flags) onto the per-instance entry alongside `recorder`, and route the tab-switch stop through `finishRecording()` (or an explicit `abortRecording()`) so the transport/ghost/loop-range cleanup runs for the instance that was actually recording.

<a id="c-29"></a>
### 29. Free-form recordings never reset the player's stale loop range from a previous take

**Medium** · `loop-points` · [main.js:881](src/main.js#L881)

A loop range set by dragging the transport handles is never cleared when a new recording replaces the lane: `finishRecording` only calls `setLoopRange` inside the loop-station branch (main.js:881-886), and neither `Player.stop()` nor `Player.play()` resets `_loopStart`/`_loopEnd`. A subsequent free-form take therefore loops the previous take's sub-range with the handles left where they were. (The claim that this also truncates overdubs after a session reload is speculative — `getLoopRange()` only hard-pins a value once the player has played, and loop-station overdubs never extend the lane.)

**How it fails**

> Record a 20 s free-form take, drag the loop end handle to 5 s, stop. Record a new 30 s take on the same tab and press Play with Loop on: the new recording loops the first 5 s only, with no UI indication (the handles were left where they were). Or: save a session while a loop is playing, reload, overdub past the old end — the added material never plays back.

**Suggested fix**

Reset the loop domain whenever the lane is replaced: call `player.setLoopRange(0, 0)` and `transport.resetLoopRange()` at the top of `Recorder.startRecording()`'s caller (or in `finishRecording` outside the loop-station branch). Have `getLoopRange()` return `end: this._loopEnd` verbatim (0 meaning "full lane") so serialization never hard-pins a derived value.

<a id="c-30"></a>
### 30. resizeCanvas is undebounced and triggers a full O(buffer-length) waveform recompute on every resize event

**Medium** · `efficiency` · [main.js:165](src/main.js#L165)

`resizeCanvas()` (main.js:165-169) calls `waveform.resize()`, which calls `_computeWaveform()` and `_renderCache()` (WaveformDisplay.js:70-75). `_computeWaveform` walks the entire AudioBuffer — the inner loop `for (let i = startSample; i < endSample; i++)` accumulated over all pixel columns visits every sample of every channel (WaveformDisplay.js:120-141). This is bound directly to `window.resize` with no debounce or rAF coalescing (main.js:172), and `resize` fires continuously (dozens of times per second) while a desktop window is being dragged. Because the main thread also hosts every `GrainScheduler` setTimeout, this stall feeds directly into the scheduler catch-up burst described in the GrainScheduler finding.

**How it fails**

> A 4-minute stereo sample is loaded (~21 M samples × 2 channels). The user drags the browser window edge: each of the ~40 resize events per second re-walks 42 M samples plus re-strokes two full-width paths. The UI locks up, and every active voice's scheduler is starved long enough that its next `_tick` dumps its whole backlog of grains at once.

**Suggested fix**

Debounce/coalesce: on `resize`, set the canvas dimensions immediately (cheap) but defer `waveform.resize()` behind a trailing `requestAnimationFrame`/`setTimeout(…, 100)` that cancels the previous pending call. Optionally cache the min/max peaks at a fixed high resolution once per buffer and downsample from that instead of re-walking the buffer per width.

<a id="c-31"></a>
### 31. markSampleMissing() mutates the persisted display name, so the "(missing)" marker compounds on every reload

**Medium** · `persistence-corruption` · [main.js:603](src/main.js#L603)

`markSampleMissing` decorates the live, serialized `state.sampleDisplayName` in place instead of deriving the warning at render time, and never clears `sampleFileName`/`sampleUrl`. Because the decorated name is auto-saved on the next change, each reload prepends another '⚠ ' and appends another ' (missing)', growing the sample label without bound. Cosmetic corruption of the sample-name display only — no state or recording data is lost, and loading a sample overwrites the name.

**How it fails**

> Drag-drop a local file `kick.wav` onto the canvas (sets `sampleFileName='kick.wav'`, `sampleDisplayName='kick.wav'`). Reload: `restoreSampleForInstance` hits the `else if (state.sampleFileName)` branch (src/main.js:597) -> name becomes `⚠ kick.wav (missing)`, which is auto-saved. Reload again -> `⚠ ⚠ kick.wav (missing) (missing)`. Every subsequent reload adds another prefix and suffix, unbounded. The same happens for a bundled sample whenever the fetch fails (offline / dev server down), permanently corrupting the tab label even after connectivity returns.

**Suggested fix**

Do not mutate `state.sampleDisplayName`. Keep the pristine name in state and derive the warning at render time, e.g. set a non-serialized `entry.sampleMissing = true` flag and have the UI render `⚠ ${state.sampleDisplayName} (missing)`. Alternatively make `markSampleMissing` idempotent by storing the raw name separately before decorating.

<a id="c-32"></a>
### 32. `fixedRecordDuration` is a module-level global that survives tab switches and silently truncates the next recording

**Medium** · `cross-instance-state-leak` · [main.js:122](src/main.js#L122)

> **Same defect as [#28](#c-28)**, found independently by the `input-lifecycle` lens. Kept because it adds detail the other report does not have — fix them together.

`let fixedRecordDuration = null;` (src/main.js:122) is a single module global shared by all instances, but it describes a *per-instance* recording in progress. Every teardown path resets it (`finishRecording` src/main.js:894, `cancelRecordArm` src/main.js:924, `onStop` src/main.js:1004) — except the tab-switch path.

`InstanceManager.switchTo` aborts the outgoing tab's recording directly:
```js
// Stop any active recording on the old tab (playback continues in background)
if (current.recorder.isRecording) {
    current.recorder.stopRecording();
}
```
(src/state/InstanceManager.js:128-131)

and the `onSwitch` handler in main.js (src/main.js:433-467) never touches `fixedRecordDuration`. It also never clears `current.ghostRenderer.recording`, so the aborted tab keeps its red recording tint (src/ui/GhostRenderer.js:74-77).

The render loop then branches on the stale global:
```js
if (fixedRecordDuration !== null) { ... if (elapsed >= fixedRecordDuration) finishRecording(active); }
```
(src/main.js:1312-1323)

**How it fails**

> Tab A has loopStationMode on. Press Record, count-in completes, `beginFixedRecording` sets `fixedRecordDuration = 4 bars = 8s` (src/main.js:861). Mid-take, switch to tab B: `switchTo` calls `recorder.stopRecording()` but `fixedRecordDuration` stays 8. Tab B has loopStationMode off, so pressing Record just arms it; the first touch starts a free-form recording. The render loop sees `fixedRecordDuration === 8`, displays "Bar n / 4", and auto-calls `finishRecording(active)` at 8 s — silently cutting off what the user believes is an open-ended take. Tab A is also left with `ghostRenderer.recording === true` (permanent red tint) and no loop range set on its player.

**Suggested fix**

Move `fixedRecordDuration` onto the instance entry (alongside `recorder`/`player`) so it is scoped to the take it describes. Route the tab-switch abort through a shared `abortRecording(entry)` helper that also clears `entry.ghostRenderer.recording` and resets the transport, instead of `switchTo` calling `recorder.stopRecording()` directly.

<a id="c-33"></a>
### 33. Closing the active tab leaves the loop-station and transport UI showing the closed tab's state

**Medium** · `state-desync` · [main.js:468](src/main.js#L468)

`onSwitch` carefully resyncs everything for the newly active tab — transport state, `setHasRecording`, `resetDisplay`, sample name, and `applyLoopStationUI(active.state.loopStationMode)` (src/main.js:433-467). `onClose` does only two of those:

```js
onClose(id) {
    instanceManager.removeInstance(id);
    const active = instanceManager.getActive();
    if (active) {
        sampleNameEl.textContent = active.state.sampleDisplayName;
        sampleSelect.value = active.state.sampleUrl || '';
    }
},
```
(src/main.js:468-476)

`removeInstance` internally calls `switchTo` (src/state/InstanceManager.js:167-172), which swaps the panel and audio, but the loop-station UI (`loopStationBtn` class, `barCountSelector` visibility, and the *disabled* + `loop-forced`/`snap-forced` locks applied at src/main.js:1100-1108) and the transport's recording/playing flags are only ever driven from `applyLoopStationUI` / the `onSwitch` handler.

**How it fails**

> Tab A: loopStationMode ON, has a recording, currently active. Tab B: loopStationMode OFF, no recording. Close tab A. The manager switches to B, but the Loop button stays `disabled` with class `loop-forced` and the Snap button stays `disabled` with `snap-forced` — permanently unusable for tab B until you switch tabs again. The bar-count selector remains visible showing A's bar count, the loop-station button still reads active, and `transport._hasRecording` is still true so Play/Overdub appear enabled although B has an empty lane.

**Suggested fix**

Extract the post-switch resync in `onSwitch` (src/main.js:449-466) into a `syncUiToActiveInstance()` helper and call it from `onClose`, `onAdd`, and the restore/import paths as well.

<a id="c-34"></a>
### 34. `onAdd` applies the loop-station UI before switching, so the bar-count selector is populated from the outgoing instance

**Medium** · `state-desync` · [main.js:486](src/main.js#L486)

```js
onAdd() {
    const id = instanceManager.createInstance();
    const entry = instanceManager.instances.get(id);
    if (entry) {
        entry.player.setLoopStationMode(entry.state.loopStationMode, masterBus.clock);
        applyLoopStationUI(entry.state.loopStationMode);   // <-- before switchTo
    }
    instanceManager.switchTo(id);
```
(src/main.js:480-491)

`applyLoopStationUI` reads the bar count from `instanceManager.getActive()`, not from the instance it was called for:
```js
const active = instanceManager.getActive();
const count = active?.state.recordBarCount ?? 4;
barCountBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.bars, 10) === count));
```
(src/main.js:1093-1098)

At that moment `activeId` is still the previous tab (`createInstance` only sets `activeId` for the very first instance, src/state/InstanceManager.js:101-104). `switchTo` never re-runs `applyLoopStationUI`, so the mismatch persists.

**How it fails**

> Tab 1 has `recordBarCount = 2`. Click "+": the new tab is created with the default `recordBarCount = 4` (src/state/InstanceState.js:54), but the bar-count selector highlights "2" because it read tab 1's value. The user records expecting a 2-bar loop and gets a 4-bar loop (`beginFixedRecording` reads `stillActive.state.recordBarCount || 4`, src/main.js:860).

**Suggested fix**

Move `applyLoopStationUI(entry.state.loopStationMode)` to after `instanceManager.switchTo(id)`, or make `applyLoopStationUI` take the instance entry explicitly instead of re-reading `getActive()`.

<a id="c-35"></a>
### 35. A throw during restore/import destroys every instance and leaves InstanceManager with `activeId === null` (dead app)

**Medium** · `error-recovery` · [InstanceManager.js:249](src/state/InstanceManager.js#L249)

`restoreFromSession` clears all instances and `activeId` up front (InstanceManager.js:251-258) and rebuilds with no rollback, while `validateSession` only checks `granul8`/numeric `version`/instance `id`+`name` and `InstanceState.fromJSON` blind-`Object.assign`s the rest. A throw during the rebuild loop — e.g. a non-finite `volume` hitting `engine.setInstanceVolume` at line 321 — leaves a partial instance map with `activeId === null`, and neither recovery path repairs it (`createDefaultSession`'s `createInstance` only sets `activeId` when `instances.size === 1`; the import catch creates nothing). Note the report's own example (`arpCustomPattern: {}` throwing inside `panel.setFullState`) does NOT strand the app, because `activeId` is assigned at line 331 before that call.

**How it fails**

> Import a session JSON (or have localStorage hold one) where an instance has `"arpCustomPattern": {}` — `validateSession` passes it. `restoreFromSession` clears all instances, then throws inside `panel.setFullState`. The catch shows "Import failed" and the app is left with zero (or partially wired) instances and `activeId === null`: `getActive()` returns null, so pointer input, waveform, transport, and loop-station UI are all dead until a full page reload. The tab bar still renders rows (all with `isActive: false`), so nothing signals the broken state.

**Suggested fix**

Build the new instance map into a local variable and only swap it in (disposing the old engines) after every instance is constructed successfully. In both catch paths, explicitly reset the manager (`instances.clear(); activeId = null;`) before calling `createDefaultSession()`, and make `createInstance` set `activeId` whenever it is currently null rather than keying on `instances.size === 1`.

<a id="c-36"></a>
### 36. localStorage auto-save serializes every automation lane on every change and swallows quota failures silently

**Medium** · `persistence-quota` · [SessionPersistence.js:67](src/state/SessionPersistence.js#L67)

```js
_writeToLocalStorage() {
    try {
        const session = this._getSession();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch (e) {
        console.warn('Failed to save session:', e);
    }
}
```
(src/state/SessionPersistence.js:67-75)

The payload includes every instance's full automation lane (src/state/SessionSerializer.js:29-36). Moves are throttled to 30/s per pointer (src/automation/Recorder.js:8), and each event serializes ~200 bytes (`position, amplitude, pitch, grainSize, interOnset, spread, pan, envelope`, plus a nested `adsr` object — src/automation/Recorder.js:187-199). An 8-second 4-bar take with 5 fingers is ~1200 events ≈ 240 KB per instance, before any overdub layering. With several tabs this crosses the typical 5 MB localStorage budget.

On `QuotaExceededError` the only effect is a `console.warn`: auto-save silently stops working while the UI continues to behave as if the session is being saved, and the last successfully written (now stale) session remains in storage.

**How it fails**

> Build up four tabs each holding a multi-layer overdubbed loop. Once the serialized session exceeds the quota, every subsequent `setItem` throws and is swallowed. The user keeps working, closes the tab, and on reopening gets the session as it was hours earlier — with no error, toast, or indication that persistence died.

**Suggested fix**

Detect `QuotaExceededError` explicitly and surface it via the existing `showNotification(..., true)` toast; degrade gracefully by retrying without the `recording` blobs so at least the parameter state survives. Longer term, move lanes to IndexedDB, which is not bound by the localStorage quota and avoids synchronous stringification on the main thread.

<a id="c-37"></a>
### 37. Root Note / Scale are dimmed and made non-interactive while they still shape every grain

**Medium** · `ui-engine-inconsistency` · [ParameterPanel.js:882](src/ui/ParameterPanel.js#L882)

`updateParamRelevance()` marks the note controls inactive unless pitch quantization or a non-random arp is selected:
```js
const noteActive = m.quantizePitch
    || (m.randomPitch && arpPattern !== 'random');
this._rootNoteGroup.classList.toggle('param-inactive', !noteActive);
this._scaleGroup.classList.toggle('param-inactive', !noteActive);
```
(src/ui/ParameterPanel.js:880-885). `.param-inactive` applies `opacity: 0.35; pointer-events: none;` (style.css:992-996), so the dropdowns cannot be changed. But `resolveParams()` builds a note table from those exact values whenever Randomize Pitch is on, regardless of quantize/arp mode:
```js
} else if (m.randomPitch) {
    // Random pitch, no quantization — noteTable for random selection
    const noteTable = buildNoteTable(scaleIntervals, m.rootNote, -range, range);
    pitchQuantize = { noteTable };
}
```
(src/main.js:296-300), and `Voice._onScheduleGrain` snaps every grain to that table (src/audio/Voice.js:224-228).

**How it fails**

> User checks only "Randomize Pitch" and leaves Arp Mode = Random and Quantize Pitch off. Every grain is snapped to the C-chromatic table. The user wants a minor scale, but Root Note and Scale are greyed at 35% opacity with `pointer-events: none` — the controls that determine the pitch set are unreachable, and the UI states they have no effect.

**Suggested fix**

Add `m.randomPitch` to `noteActive`: `const noteActive = m.quantizePitch || m.randomPitch;` — or, if the intent is that unquantized randomization should be continuous, fix `resolveParams` instead (see the related finding on the mode table).

<a id="c-38"></a>
### 38. Transport loop-handle positions are global UI state, never per-instance and never restored from the persisted loopRange

**Medium** · `state-desync` · [TransportBar.js:48](src/ui/TransportBar.js#L48)

`TransportBar` owns a single pair of loop fractions:
```js
/** Loop start as fraction (0–1) of recording duration */
this._loopStartFrac = 0;
/** Loop end as fraction (0–1) */
this._loopEndFrac = 1;
```
(src/ui/TransportBar.js:48-50)

The *player* loop range is per-instance and is both serialized (`loopRange: entry.player.getLoopRange()`, src/state/SessionSerializer.js:33) and restored (`player.setLoopRange(...)`, src/state/InstanceManager.js:312-317). But `transport.setLoopRange(...)` is never called from `onSwitch` (src/main.js:433-467), from `restoreFromSession`, or from the restore/import blocks in main.js — the only callers are `finishRecording` (`transport.setLoopRange(0, 1)`, src/main.js:885) and the snap path in `onLoopRangeChange` (src/main.js:1222). So the persisted `loopRange` is a field that is written and only half read back.

**How it fails**

> Tab A: drag the loop handles to 25%–75% (`_loopStartFrac=0.25`, `_loopEndFrac=0.75`, and A's player gets that range). Switch to tab B, whose player has the full range. The handles still render at 25%/75%. Nudge the end handle: `_onHandlePointerMove` fires `onLoopRangeChange(0.25, x)` (src/ui/TransportBar.js:139-141), which calls `active.player.setLoopRange(0.25 * durationB, ...)` — silently truncating the start of tab B's loop to a value the user never set for B. Symmetrically, after a session restore a tab with a saved 25%–75% loopRange shows handles at 0%–100%.

**Suggested fix**

Sync the transport handles on every activation: in the post-switch resync, call `transport.setLoopRange(range.start / duration, range.end / duration)` from `player.getLoopRange()` (or `resetLoopRange()` when the instance has no recording), and do the same after `restoreFromSession`.

---

# Low (45)

<a id="c-39"></a>
### 39. TODO.txt lists six items the plan marks [DONE]

**Low** · `doc-drift` · [TODO.txt:1](TODO.txt#L1)

Every one of the first six TODO entries is implemented and documented as complete in the plan. "adsr, volume, pan, arpegio etc. should all be customizable per instance" (TODO.txt:1) — plan 4.5a/4.5b/4.5c [DONE]; per-instance ADSR flows through `params.adsr` (src/audio/grainFactory.js:81), volume through `engine.setInstanceVolume` (src/audio/GranularEngine.js:154). "update transport bar to allow start loop point and end loop point editing" (line 2) — plan 4.5d [DONE]; draggable handles at src/ui/TransportBar.js:105-149. "use pan and allow to randomize pan" (line 3) — plan 4.5c [DONE]; `randomize.pan` at src/main.js:252 and src/audio/Voice.js:245-249. "we should have a master volume per layer" (line 4) — plan 4.5a [DONE]; `#master-volume` at index.html:46. "we need to review the bpm sync accross layers" (line 5) — plan 4.5e [DONE]. "review the loop points and the quantization so that everything stays in rythm" (line 6) — plan 4.5f/4.5g [DONE].

**How it fails**

> The project's only human-facing backlog file is 100% stale on its actionable half, so an agent asked to 'pick up the next TODO' re-implements per-instance pan randomization that already exists in Voice.js.

**Suggested fix**

Prune the completed six lines, leaving the genuinely open items (record audio input, generate AI audio, export audio).

<a id="c-40"></a>
### 40. agents/CLAUDE.md parameter table contradicts the actual ranges in code

**Low** · `doc-drift` · [CLAUDE.md:143](agents/CLAUDE.md#L143)

The "Grain Parameters" table (agents/CLAUDE.md:138-148) is wrong on four of nine rows. **Grain Size** is documented "1 – 500 ms"; code maps `expMap(n, 1, 1000)` for display (src/ui/ParameterPanel.js:30) and `expMap(grainSizeNorm, 0.001, 1.0)` seconds in the engine (src/main.js:225) → 1–1000 ms. **Density / Inter-onset** is documented "5 – 200 ms"; code is `expMap(n, 5, 500)` / `expMap(densityNorm, 0.005, 0.5)` (src/ui/ParameterPanel.js:36, src/main.js:226) → 5–500 ms. **Pitch** is documented "0.25 – 4.0"; with Pitch Range at ±4 octaves the engine emits playbackRate 0.0625–16 (src/main.js:271 + src/audio/Voice.js:223). **Envelope** is documented "Hann / Tukey / Triangle"; index.html:363-373 offers nine (adds gaussian, sigmoid, blackman, expodec, rexpodec, custom/ADSR). Plan step 1.8 repeats the stale 1–500ms / 5–200ms figures and additionally lists a "Pitch (0.25–4.0, step 0.01)" slider that does not exist in the panel at all (agents/granular-sampler-implementation-plan.md:166).

**How it fails**

> A contributor implements a preset system or a MIDI-CC map against the documented 1–500 ms grain-size range; every value above 0.5 of the normalized slider silently maps to a duration outside the documented domain, and 'custom'/'gaussian' envelopes are absent from their enum.

**Suggested fix**

Regenerate the table from `RANGE_PARAMS` in ParameterPanel.js and the `<option>` list in index.html; note that Pitch bounds are `2^±pitchRange`, not a fixed 0.25–4.

<a id="c-41"></a>
### 41. agents/CLAUDE.md folder tree omits 13 shipped modules and lists a sample file that does not exist

**Low** · `doc-drift` · [CLAUDE.md:52](agents/CLAUDE.md#L52)

The "Folder Structure" block (agents/CLAUDE.md:24-54) documents 13 source files. The repo has 26. Undocumented and unmentioned anywhere in that doc: `src/audio/MasterBus.js`, `src/audio/MasterClock.js`, `src/audio/Metronome.js`, the entire `src/state/` directory (`InstanceState.js`, `InstanceManager.js`, `SessionSerializer.js`, `SessionPersistence.js`), `src/ui/ADSRWidget.js`, `src/ui/GhostRenderer.js`, `src/ui/LevelMeter.js`, `src/ui/TabBar.js`, `src/ui/voiceColors.js`, and `src/utils/musicalQuantizer.js`. Conversely the tree lists `samples/texture_pad.wav # Bundled demo sample` (agents/CLAUDE.md:52) — `samples/` contains nine `.mp3` files and no `.wav` at all; index.html defaults to `samples/Soni_Ventorum_Wind_Quintet_-_08_-_Danzi_Wind_Quintet_Op_67_No_3_In_E-Flat_Major_4_Allegretto.mp3` (index.html:26). The same nonexistent file is referenced at agents/granular-sampler-implementation-plan.md:35,40 and agents/granular-sampler-research.md:583. The tree also places `CLAUDE.md` at the repo root ("└── CLAUDE.md # This file") when it actually lives in `agents/`, and the Constraints section claims the project is "a folder of `.html`, `.css`, `.js`, and `.wav` files" (agents/CLAUDE.md:7) — there are no `.wav` files.

**How it fails**

> An agent instructed to "read CLAUDE.md for the file layout" before editing tab/session behaviour never learns that `src/state/` exists, and reimplements instance state or session persistence from scratch. An agent told to load the bundled demo fetches `samples/texture_pad.wav` and gets a 404.

**Suggested fix**

Regenerate the tree from the filesystem, replace `texture_pad.wav` with the actual bundled `.mp3` list (or just point at the `<select id="sample-select">` options), and correct the CLAUDE.md path to `agents/CLAUDE.md`.

<a id="c-42"></a>
### 42. agents/CLAUDE.md numbers phases differently than the plan and predates the entire multi-instance / loop-station architecture

**Low** · `doc-drift` · [CLAUDE.md:266](agents/CLAUDE.md#L266)

CLAUDE.md's roadmap ends at "Phase 3 — Gesture Recording & Playback" (agents/CLAUDE.md:266-277) while the implementation plan uses Phase 3 for "Multi-Instance Architecture with Tab UI" and Phase 4 for automation (agents/granular-sampler-implementation-plan.md:578, 789). Two docs in the same directory therefore assign different meanings to "Phase 3". CLAUDE.md contains no mention of tabs/instances, MasterClock, Metronome, loop station mode, count-in, bar-count recording, overdub, or session persistence — all shipped and marked [DONE]. Specific stale claims inside it: "Playback voices use synthetic pointer IDs (`1000 + voiceIndex`)" (line 220) — the crossfade rewrite added a second range, `SYNTHETIC_POINTER_BASE_B = 2000` (src/automation/Player.js:9-10); "Also capture global parameter changes as a `'param'` event type" (line 214) — never implemented, `AutomationLane`'s type union is only `'start'|'move'|'stop'` (src/automation/AutomationLane.js:9) and `Recorder` has no param-capture method; "draw pointer circles **and grain overlays** at reduced opacity (40%)" (line 233) — `GhostRenderer` draws pointers only (src/ui/GhostRenderer.js:80-110), the grain overlay is shared and undimmed.

**How it fails**

> An agent asked to "add the next phase per CLAUDE.md" starts building multi-touch recording that already exists, or implements a `'param'` event type that the Player's dispatch switch (src/automation/Player.js:284-304) will silently drop because it only handles start/move/stop.

**Suggested fix**

Either regenerate CLAUDE.md from the plan's completed steps, or reduce it to a pointer at the plan and keep only the invariant sections (constraints, signal flow, Web Audio patterns).

<a id="c-43"></a>
### 43. Design docs describe timing behaviour the code does not implement

**Low** · `doc-drift` · [CLAUDE.md:227](agents/CLAUDE.md#L227)

`agents/CLAUDE.md` predates the loop-station work and is wrong on the points this audit covers:

- `:227` — "**BPM changes do NOT affect playback.** If you record at 120 BPM with 1/8 note grains, then change BPM to 140, playback still uses the original 120 BPM timing." False in loop-station mode: `Player._tick` re-snaps every wrap through `this._clock.quantizeToBar(now)` (Player.js:253) using the live BPM. Measured: a 4.000 s loop wraps every 3.433 s after 120→140.
- `:229` — "This design is simpler and predictable: each recording faithfully reproduces the original performance." The wrap teleport, the crossfade double-dispatch, and the discarded overshoot all break faithful reproduction.
- `:218` — "Playback voices use synthetic pointer IDs (`1000 + voiceIndex`)". Actual implementation uses two alternating ranges, 1000 (A) and 2000 (B), for crossfade (Player.js:9-10).
- `:213` — "Also capture global parameter changes as a `'param'` event type." No `'param'` event type exists; `Recorder` only emits `start`/`move`/`stop` (Recorder.js:128, 156, 172) and `AutomationLane`'s typedef lists only those three (AutomationLane.js:9).
- There is no mention anywhere in the docs of `MasterClock`, the epoch model, or who is allowed to move the epoch — which is precisely the invariant that `Metronome.startCountIn` (Metronome.js:100) violates.

**How it fails**

> A contributor reads CLAUDE.md, concludes recordings are BPM-independent, and 'fixes' the loop drift by making BPM changes rescale loop ranges — compounding the double-grid problem rather than resolving it.

**Suggested fix**

Update the BPM & Playback Sync section to state the actual model, and add an explicit invariant: the `MasterClock` epoch is set exactly once and never moved while any player is playing or the metronome is running; all musical positions are stored in bars/beats and converted to seconds only at scheduling time.

<a id="c-44"></a>
### 44. Metronome click spec in the plan does not match the shipped oscillator

**Low** · `doc-drift` · [granular-sampler-implementation-plan.md:1193](agents/granular-sampler-implementation-plan.md#L1193)

Plan 4.5g.2 documents: "**Audio:** Short oscillator sine bursts (~10ms). Downbeat (beat 0): 1000Hz, amplitude 0.8. Other beats: 800Hz, amplitude 0.4." (agents/granular-sampler-implementation-plan.md:1193). The implementation is:
```js
const freq = isDownbeat ? 1500 : 800;
const amp = isDownbeat ? 1.0 : 0.35;
const clickDuration = isDownbeat ? 0.03 : 0.015;
...
if (isDownbeat) osc.frequency.exponentialRampToValueAtTime(900, when + clickDuration);
```
(src/audio/Metronome.js:180-190). Every documented number is wrong: 1500 Hz with a downward ramp to 900 Hz (not a static 1000 Hz), amplitude 1.0 (not 0.8), and 30 ms / 15 ms durations (not ~10 ms).

**How it fails**

> Someone tuning the click to sit under a quiet sample trusts "amplitude 0.8" and scales the metronome gain accordingly, ending up 2 dB hotter than intended on the downbeat; or looks for the 1000 Hz constant and cannot find it.

**Suggested fix**

Update the plan text to match, or (better) stop restating audio constants in prose and reference `Metronome._scheduleClick`.

<a id="c-45"></a>
### 45. Per-grain randomization is silently discarded whenever quantization is also enabled

**Low** · `correctness` · [GrainScheduler.js:96](src/audio/GrainScheduler.js#L96)

When both 'random' and 'quantize' are enabled for density (GrainScheduler.js:96-105) or grain size (Voice.js:203-213), the randomly drawn `norm` is computed and then discarded — the quantize branch returns a constant getSubdivisionSeconds(). This looks like intentional precedence (quantize overrides random; main.js:261-267 only passes the quantize config in exactly this combination), so the concrete defects are the dead computation and the UI, which keeps the randomization control lit and indicated while it has no effect. Either drop the dead draw or map `norm` onto the subdivision table (normalizedToSubdivision, musicalQuantizer.js:158) if random-across-subdivisions was the intent.

**How it fails**

> Tick both "random density" and "quantize density", set density range [0, 1] and subdivision 1/16. Expected: grain spacing jumps randomly among subdivisions. Actual: `iot` is a fixed `getSubdivisionSeconds(bpm, 16)` for every grain — output is a metronomic stream with no jitter, indistinguishable from having the random toggle off.

**Suggested fix**

Map `norm` onto the subdivision table instead of ignoring it, e.g. `iot = getSubdivisionSeconds(this.quantizeBpm, normalizedToSubdivision(norm).divisor)` (`normalizedToSubdivision` already exists in src/utils/musicalQuantizer.js:158), or clamp the random choice to subdivisions between the range endpoints. Apply the same fix to the grain-size path in Voice.js.

<a id="c-46"></a>
### 46. An exception thrown while creating a grain permanently kills that voice's scheduler (the timer re-arm is outside any try/finally)

**Low** · `robustness` · [GrainScheduler.js:113](src/audio/GrainScheduler.js#L113)

GrainScheduler._tick (GrainScheduler.js:85-114) re-arms its timer on line 113, outside any try/finally around the scheduling loop. If onScheduleGrain throws, the re-arm is skipped while _running stays true, so start() early-returns (:45) and that Voice is permanently silent for the rest of the gesture. No concrete throwing input is demonstrated (the NaN paths cited are hypothetical — divisors come from fixed selects, bpm from a bounded slider), so this is robustness hardening: wrap the loop in try/catch with the re-arm in a finally, and optionally reject non-finite grainDuration/pitch/offset at the top of createGrain, where the existing guards do let NaN through.

**How it fails**

> Any single non-finite parameter reaching a grain — e.g. a `divisor` that fails `parseInt` so `getSubdivisionSeconds` returns NaN (src/utils/musicalQuantizer.js:123, reached from Voice.js:208 and GrainScheduler.js:101), or a NaN pointer position — makes `createGrain` throw inside `_tick`. The `setTimeout` re-arm is skipped, `_running` remains true, and that Voice produces no further grains for the rest of the gesture while the UI still shows it as active.

**Suggested fix**

Wrap the loop body and guarantee the re-arm:
```js
_tick() {
    if (!this._running) return;
    try {
        const deadline = …;
        while (…) { … }
    } catch (err) {
        console.error('grain scheduling failed', err);
    } finally {
        if (this._running) this._timerId = setTimeout(() => this._tick(), this.timerInterval);
    }
}
```
Also add `if (!Number.isFinite(grainDuration) || !Number.isFinite(pitch) || !Number.isFinite(offset)) return;` at the top of `createGrain`.

<a id="c-47"></a>
### 47. The "soft clipper" hard-clips: the tanh curve only spans input [-1, 1], so anything louder is flat-topped at 0.7616

**Low** · `dsp-correctness` · [MasterBus.js:71](src/audio/MasterBus.js#L71)

`_createSoftClipper()` builds an 8192-point curve over `x = (2i/(n-1)) - 1`, i.e. the input domain [-1, 1], filled with `Math.tanh(x)` (MasterBus.js:76-79). Per the WaveShaperNode spec, input samples outside [-1, 1] are clamped to the curve's *endpoint values* — so every sample with |input| > 1 comes out as exactly ±tanh(1) = ±0.7616. That is textbook hard clipping (a flat top with infinite-order harmonics), which is precisely what a soft clipper is supposed to prevent; `oversample = '2x'` reduces the aliasing but not the distortion itself.

The DynamicsCompressor upstream has a 1 ms attack (MasterBus.js:23), so transients above the −3 dB threshold pass through unlimited for the first millisecond and land in the flat region — exactly the material the soft clipper was added to round off.

Secondary effect: because the curve is `tanh(x)` rather than a normalized soft-saturation, the whole master path is attenuated by up to 2.4 dB at full scale (tanh(1)/1 = 0.76) and everything gets some harmonic distortion even at moderate levels (tanh(0.7)/0.7 = 0.86, −1.3 dB).

**How it fails**

> A dense multi-voice transient reaches the waveshaper at amplitude 1.4 (the compressor's 1 ms attack has not clamped it yet). Output is a flat ±0.7616 plateau for the duration of the overshoot — audible as a crunchy hard-clip rather than the intended gentle saturation.

**Suggested fix**

Widen the curve's input domain and normalize, e.g. `const k = 4; const x = k * ((2*i/(n-1)) - 1); curve[i] = Math.tanh(x) / Math.tanh(k);`. That keeps unity gain around zero, saturates smoothly, and still asymptotes below 1.0 for inputs several times over full scale.

<a id="c-48"></a>
### 48. Count-in hands off to the recorder via wall-clock setTimeout, so recording t=0 never lands on the audio-clock bar boundary

**Low** · `quantization` · [Metronome.js:158](src/audio/Metronome.js#L158)

The count-in completion is fired off the wall clock:

```js
const delay = Math.max(0, (this._countInBeatTime - this._ctx.currentTime) * 1000);
setTimeout(() => cb(), delay);   // Metronome.js:158-159
```

and the callback establishes the recording origin from whatever `currentTime` is when that timer actually fires:

```js
beginFixedRecording() -> stillActive.recorder.startRecording();  // main.js:863
// Recorder.js:46 -> this._startTime = this._audioContext.currentTime;
```

`setTimeout` is clamped and jittered by main-thread work — and this app runs a full canvas render loop every frame (main.js:1292-1330) plus `params.updateParamRelevance()` etc. So the recording's t=0 lands several milliseconds *after* the downbeat the user heard, while `fixedRecordDuration = barCount * clock.getBarDuration()` (main.js:861) is an exact bar multiple measured from that late origin. The recording is a perfect number of bars long but its phase is off the grid by the timer error — and then the loop-station wrap snaps it back to the grid (Player.js:253), producing exactly that jump on the first wrap.

The exact time is already known and unused: `this._countInBeatTime` (Metronome.js:105).

**How it fails**

> Loop-station mode, count in, record 4 bars, let it loop with the metronome on. The recorded downbeat sits a few ms late relative to the click; at the first loop wrap the bar-snap yanks it back into alignment, so the first iteration and all later iterations have audibly different phase.

**Suggested fix**

Pass the intended audio-clock time to the callback (`cb(this._countInBeatTime)`) and have `Recorder.startRecording(atTime)` accept it: `this._startTime = atTime ?? this._audioContext.currentTime`. Keep `setTimeout` only as the delivery mechanism; never derive musical time from when it happens to fire.

<a id="c-49"></a>
### 49. `randomize.pitch` is computed and stored but can never be read — Voice's scale-snap path is unreachable

**Low** · `dead-code` · [Voice.js:231](src/audio/Voice.js#L231)

`resolveParams` computes `pitch: m.randomPitch ? [-(m.pitchRange || 2), m.pitchRange || 2] : null` (src/main.js:249-251) and `Voice.update()` stores it (src/audio/Voice.js:132). The only consumer is the final `else` branch of `_onScheduleGrain`:
```js
} else {
    // No note table: original behavior
    if (rnd.pitch) { pitch = Math.pow(2, rnd.pitch[0] + ...); }
    if (this.pitchQuantize) { const semitones = rateToSemitones(pitch); ... }
}
```
(src/audio/Voice.js:229-242). That branch only runs when `this.pitchQuantize` is falsy or lacks both `arpSequence` and `noteTable`. But `resolveParams` sets `pitchQuantize` non-null on exactly the three `m.randomPitch` branches (src/main.js:274-300), and every one of them carries `arpSequence` or `noteTable` — so `rnd.pitch` is non-null only when the branch is unreachable. Consequently `quantizePitch` and `rateToSemitones` imported at src/audio/Voice.js:5 are dead in this file, as is the `// Random pitch in log space: ±2 octaves` comment (stale: the real range is ±`pitchRange`, up to ±4 octaves).

**How it fails**

> Any configuration. With Randomize Pitch on, control always takes the arp or noteTable branch; with it off, `rnd.pitch` is null. Lines 231-241 of Voice.js execute zero times in every reachable state, so a maintainer editing the `Math.pow(2, ...)` random-pitch formula or the per-grain scale snap sees no audible change.

**Suggested fix**

Delete `randomize.pitch` from `resolveParams` and remove the dead `else` body (plus the now-unused `quantizePitch`/`rateToSemitones` imports) — or restore reachability by not setting `pitchQuantize` when Quantize Pitch is off.

<a id="c-50"></a>
### 50. Voice.stop()'s declick ramp is immediately overtaken by _updateVoiceGains(), producing an upward level bump and parking inactive voices at non-zero gain

**Low** · `correctness` · [Voice.js:150](src/audio/Voice.js#L150)

`stopVoice` runs `this._allocator.release(pointerId)` then `this._updateVoiceGains()` (GranularEngine.js:122-125). `release()` calls `voice.stop()`, which schedules `cancelScheduledValues(t); setValueAtTime(cur, t); linearRampToValueAtTime(0, t + 0.03)` (Voice.js:145-153). `_updateVoiceGains()` then calls `setGainLevel(scale)` on *every* pool voice including the one just stopped (VoiceAllocator.js:116-120), which appends `linearRampToValueAtTime(scale, t + 0.02)` (Voice.js:184-187) with **no** `setValueAtTime` anchor. Because the AudioParam timeline is sorted by time, the stopped voice's gain now ramps *up* to `scale` at t+0.02 before falling to 0 at t+0.03 — and `scale` is computed from the reduced `activeCount`, so it is larger than the level the voice was at.

**How it fails**

> Two fingers down (count=2, per-voice gain 0.4/√2 = 0.283). Lift one finger at time t: its voice stops, but `_updateVoiceGains` recomputes `scale = 0.4/√1 = 0.4` and applies it to the stopped voice too — its remaining ≤100 ms of pre-scheduled grains swell 41 % louder over 20 ms and are then chopped to zero 10 ms later. Worse: if a third finger lands at t+0.015, `setGainLevel` appends a ramp ending at t+0.035, i.e. *after* the ramp-to-0, leaving the stopped voice's gain parked at a non-zero value indefinitely.

**Suggested fix**

Have `setGainLevel` anchor its ramp (`cancelScheduledValues` is wrong here, but a `setValueAtTime(gain.value, now)` before the ramp is needed) and, more importantly, make `VoiceAllocator.setGainLevel` only touch voices with `voice.active === true`, so a stopping voice's declick ramp is never contradicted.

<a id="c-51"></a>
### 51. Two byte-identical ADSR curve generators live side by side in envelopes.js

**Low** · `duplication` · [envelopes.js:342](src/audio/envelopes.js#L342)

`_computeADSRFromParams(a, d, s, r, length)` (src/audio/envelopes.js:311-334) and `_computeCustomADSR(length)` (src/audio/envelopes.js:342-366) have identical bodies — the same `aEnd`/`dEnd`/`rStart` computation and the same four-branch loop. The only difference is that the latter destructures from the module-global `_customADSRParams`. `_computeCustomADSR` could be one line: `const {a,d,s,r} = _customADSRParams; return _computeADSRFromParams(a,d,s,r,length);`. Relatedly, plan step 4.5b claims "The global `setCustomADSR()` / `getCustomADSR()` remain for the `ADSRWidget` UI preview but are **no longer used for grain generation**" (agents/granular-sampler-implementation-plan.md:989) — but `getEnvelope('custom', ...)` still routes to `_computeCustomADSR` (src/audio/envelopes.js:85) and `grainFactory` falls back to `getEnvelope(envelope, ...)` whenever `params.adsr` is falsy (src/audio/grainFactory.js:81-83), so the global remains a live grain-generation path.

**How it fails**

> A fix to the release-segment math (e.g. making the decay curve exponential) applied to `_computeADSRFromParams` changes per-instance grains but not any grain that reaches the `getEnvelope('custom')` fallback — e.g. an automation event recorded before `adsr` capture existed, replayed on a background tab, which would then use the *active* tab's ADSR.

**Suggested fix**

Delete `_computeCustomADSR` and have the `'custom'` case in `getEnvelope` delegate to `computeADSREnvelope(_customADSRParams, length)`.

<a id="c-52"></a>
### 52. expodec / rexpodec / gaussian windows start or end at non-zero gain, clicking at every grain boundary

**Low** · `clicks` · [envelopes.js:229](src/audio/envelopes.js#L229)

Three of the eight windows do not reach zero at their endpoints:
- `_computeExpodec`: `curve[i] = Math.exp(-decay * t)` with `t = i/(length-1)` → `curve[0] = 1.0` (envelopes.js:229-237). The grain jumps from silence to full scale in one sample at onset.
- `_computeRexpodec`: the mirror → `curve[length-1] = 1.0` (envelopes.js:245-253). The grain is cut from full scale to silence at its end.
- `_computeGaussian`: with `sigma = 0.4`, `t = ±1` at the edges → `exp(-0.5·(1/0.4)²) = 0.044` (envelopes.js:173-182), a −27 dB step at both ends.

`createGrain` writes the curve verbatim (`gainNode.gain.setValueAtTime(0, when); gainNode.gain.setValueCurveAtTime(scaledCurve, when, grainDuration)`, grainFactory.js:90-91) — the `setValueAtTime(0, when)` is immediately superseded by `curve[0]`, so it provides no protection.

A percussive attack is a legitimate design intent for expodec, but the *discontinuity* is not the same thing as a fast attack; a 0.5–1 ms taper preserves the character while removing the broadband click, and rexpodec's full-scale termination is unambiguously an artefact.

For comparison, hann/triangle/blackman all correctly reach exactly 0 at both ends (blackman: `0.42 - 0.5 + 0.08 = 0`), and sigmoid reaches 9e-4.

**How it fails**

> Select the 'rexpodec' envelope with default 0.4 s grains at 0.1 s inter-onset. Every grain terminates at full scale, so the output carries a 10 Hz train of full-amplitude steps — broadband clicks that are louder than the sample content itself and independent of what is in the buffer.

**Suggested fix**

Force a short taper on both ends of every window, e.g. after computing the curve apply a fade over `min(8, length/16)` points at each end, or simply clamp `curve[0] = curve[length-1] = 0` and taper the adjacent few samples.

<a id="c-53"></a>
### 53. Envelope cache is unbounded and keyed by continuous ADSR values

**Low** · `memory` · [envelopes.js:290](src/audio/envelopes.js#L290)

computeADSREnvelope (envelopes.js:290-298) caches on 3-decimal ADSR values in a module-level Map that is never evicted — setCustomADSR only deletes 'custom:'-prefixed keys (:270-272), which never match 'adsr:' keys. Continuous dragging of the ADSR widget (ADSRWidget.js:95-104, read every frame via ParameterPanel.getParams :545-547) mints a new 128-float entry per distinct pointer position, so memory grows monotonically. Bound or drop the cache. Correction to the original report: setCustomADSR/getCustomADSR are NOT dead code — they are imported and called from src/ui/ADSRWidget.js (lines 5, 23, 170, 262). The only genuinely dead symbol is the unused `sig` local in _computeSigmoid (envelopes.js:197).

**How it fails**

> Drag the ADSR widget's decay handle back and forth for 30 seconds at 60 fps: ~1,800 unique `adsr:` keys are inserted into `cache`, each holding a 128-entry Float32Array, and none is ever evicted or re-read (the user has already moved on to a different value). Memory grows monotonically for the lifetime of the page.

**Suggested fix**

Bound the cache — e.g. drop to 2-decimal keys and evict oldest entries past a cap (`if (cache.size > 256) cache.delete(cache.keys().next().value)`), or skip caching for `adsr:` keys entirely since computing 128 points is trivial next to the per-grain node allocation that follows.

<a id="c-54"></a>
### 54. StereoPanner is bypassed at exactly pan === 0, causing a 3 dB level jump and disabling spread-based pan variation

**Low** · `pan-law` · [grainFactory.js:97](src/audio/grainFactory.js#L97)

grainFactory.js:97-109 bypasses the StereoPannerNode when pan === 0. Primary real defect: panVariation (the spread-driven stereo widening) is computed inside the `pan !== 0` branch only, so at the default centred pan (InstanceState panMin/panMax = 0) the spread control produces position spread but never any stereo spread. Secondary: for MONO source buffers the bypass is ~3 dB louder per channel than the panner's equal-power centre (0.707), so nudging pan off 0 drops the voice by 3 dB — this does not apply to stereo buffers (StereoPanner's stereo path is pass-through at pan=0), and all shipped samples are stereo mp3s. Fix: always create the panner, or at minimum compute panVariation outside the branch.

**How it fails**

> Set the pan slider from 0.00 to 0.05 during sustained playback: the voice's level drops ~3 dB instantly even though the image has barely moved. Separately, with pan at dead center and spread at maximum, the output is mono-collapsed rather than the wide stereo field the spread control implies.

**Suggested fix**

Always insert the panner and compute the variation outside the branch:
```js
const panVariation = spread > 0 ? (Math.random() - 0.5) * spread * 0.5 : 0;
const panNode = audioContext.createStereoPanner();
panNode.pan.setValueAtTime(Math.max(-1, Math.min(1, pan + panVariation)), when);
gainNode.connect(panNode);
panNode.connect(destination);
```
If the extra node is a measurable cost, bypass only when `pan === 0 && spread === 0`, and compensate the bypassed path by ×0.707 so the two paths match in level.

<a id="c-55"></a>
### 55. getEventsInRange rescans the lane from index 0 every frame for every playing layer

**Low** · `efficiency` · [AutomationLane.js:44](src/automation/AutomationLane.js#L44)

```js
getEventsInRange(startTime, endTime) {
    const result = [];
    for (const event of this.events) {
        if (event.time >= endTime) break;    // AutomationLane.js:47
        if (event.time >= startTime) result.push(event);
    }
    return result;
}
```

The `break` bounds the scan at `endTime`, not at `startTime`, so the cost per frame is O(events before the playhead) — it grows linearly through each loop iteration and is paid again by `_preStartNextIteration` (Player.js:333) and by every concurrently playing instance. With move events throttled to 30/s/pointer (Recorder.js:8) and several voices, a 30 s overdubbed lane is ~2–3k events; near the loop end each layer rescans all of them, 60×/second. Since `Player` shares the main thread with the canvas render loop, this feeds directly back into the frame jitter that causes the drift findings above.

Repeated overdub auto-commit also grows the lane monotonically: `onPlayerLoopWrap` merges and restarts the overdub at every wrap (main.js:1273-1288) and `AutomationLane.merge` offsets laneB's voice indices by `maxVoiceA + 1` each time (AutomationLane.js:110-115), so `voiceIndex` climbs without bound. Once any `voiceIndex` reaches 1000, `syntheticId = base + event.voiceIndex` (Player.js:282) makes iteration-A IDs collide with iteration-B IDs.

**How it fails**

> Leave loop-station overdub running for a few minutes on a 4-bar loop. The lane accumulates thousands of events; each layer's `_tick` scans the whole prefix every frame, frame time climbs, and the per-iteration overshoot (and therefore the drift) grows with it.

**Suggested fix**

Keep a cursor index on the Player (`this._eventCursor`) advanced monotonically, and reset it to a binary-searched position on wrap/seek; or add `AutomationLane.indexAtOrAfter(time)` using binary search and slice from there. Separately, cap the merge offset (reuse free voice slots) so `voiceIndex` cannot approach the 1000-wide synthetic ID ranges.

<a id="c-56"></a>
### 56. Loop-station wrap can produce negative elapsed time, printing a garbage clock and a negative CSS width

**Low** · `correctness` · [Player.js:311](src/automation/Player.js#L311)

When the bar-snap at Player.js:253 rounds *up*, `_startTime` ends up ahead of `currentTime`, so `currentElapsed` at :276 is negative for up to half a bar. That value is passed straight through:

```js
if (this.onFrame) this.onFrame(currentElapsed, currentElapsed / this._duration);  // :311
```
→ `main.js:1249-1252` → `transport.setTime(elapsed)` / `transport.setProgress(progress)`.

`TransportBar.formatTime` (TransportBar.js:391-397) has no negative handling: `formatTime(-0.9)` returns `"-1:-1.099"` and `formatTime(-0.5)` returns `"-1:-1.500"`. `setProgress` (:222) emits `width: -30.00%`, which the browser rejects, so the progress fill freezes at its previous value instead of resetting.

This is directly observable in loop-station mode with a non-integer-bar loop: with a 3.0 s loop (1.5 bars) at 120 BPM the measured inter-wrap intervals were `4.000, 3.983, 4.000, 4.000, 4.017, …` — the loop is stretched to 2 bars and the playhead sits in negative-elapsed limbo for ~1 s of every iteration.

**How it fails**

> Loop-station mode, 4/4 @120, loop range 0–3.0 s. Each iteration the transport reads `-1:-1.099` for about a second, the progress bar sticks, and the loop audibly hangs for the last half bar with no content playing.

**Suggested fix**

Clamp before reporting: `const reported = Math.max(0, currentElapsed)`. Guard `formatTime` with `seconds = Math.max(0, seconds)` and `setProgress` with `Math.max(0, Math.min(1, fraction))`. Better: fix the root cause by never snapping backwards/forwards mid-loop (see the teleport finding) and by rejecting loop ranges that are not whole bars in loop-station mode.

<a id="c-57"></a>
### 57. Loop-station mode silently stretches non-integer-bar loops to whole bars, hanging the playhead on empty time

**Low** · `loop-points` · [Player.js:241](src/automation/Player.js#L241)

`setLoopRange` never validates that the range is a whole number of bars while the wrap logic snaps to the bar grid (Player.js:250-254), so a non-bar-multiple range iterates on a rounded-up period with a silent tail. Reachable only after a live BPM/tap-tempo change (session restore applies the saved BPM before restoring the range, so the persisted scenario in the original report cannot occur); largely a symptom of the BPM/bar-grid coupling rather than an independent defect.

**How it fails**

> Restore a session saved at 90 BPM while the BPM slider is at 120: the persisted `loopRange` in seconds is no longer a bar multiple, and every loop iteration now has a silent tail of up to one bar.

**Suggested fix**

When `_loopStationMode` is on, validate/clamp in `setLoopRange`: snap both ends to `clock.getBarDuration()` and enforce a minimum of one bar. Better, per the BPM finding, store the range in bars so it is a bar multiple by construction.

<a id="c-58"></a>
### 58. Recorder throttle map is keyed by voiceIndex, not pointerId as its JSDoc and CLAUDE.md state

**Low** · `doc-drift` · [Recorder.js:35](src/automation/Recorder.js#L35)

The field is declared as `/** @type {Map<number, number>} pointerId → last capture time (seconds) */ this._lastMoveTime = new Map();` (src/automation/Recorder.js:35-36) and agents/CLAUDE.md:214 says "Throttle `pointermove` events to **30 per second per pointer**". Every caller passes a voice slot index, not a pointer id: `captureMove(voiceIndex, resolvedParams)` does `this._lastMoveTime.get(voiceIndex)` (src/automation/Recorder.js:143-153), and main.js supplies `recorderPointerMap.get(pointerId)` — the *voiceId* returned by `engine.startVoice` (src/main.js:388-407). The comments in `captureStart`/`captureStop` ("Reset throttle timer for this pointer", src/automation/Recorder.js:134) reinforce the wrong mental model.

**How it fails**

> A maintainer adds a second recorder consumer that keys by real `pointerId` — e.g. throttling a UI meter — and the two maps collide conceptually: pointerIds from the browser are arbitrary integers (often > 14) while voice indices are 0..13, so entries never match and throttling silently no-ops.

**Suggested fix**

Rename to `_lastMoveTimeByVoice` and fix the JSDoc to `voiceIndex → last capture time`; update the CLAUDE.md wording to 'per voice'.

<a id="c-59"></a>
### 59. MAX_POINTERS (10), MAX_VOICES (14) and the design doc (6) all disagree; the constant's own comment is wrong

**Low** · `doc-drift` · [PointerHandler.js:9](src/input/PointerHandler.js#L9)

`const MAX_POINTERS = 10;` is annotated "Maximum tracked pointers (matches VoiceAllocator pool size)" (PointerHandler.js:8-9), but `VoiceAllocator` uses `const MAX_VOICES = 14` (VoiceAllocator.js:9), and its constructor JSDoc says `@param {number} [maxVoices=6]` (VoiceAllocator.js:15) while the default is `MAX_VOICES` = 14. The design doc is a third number: agents/CLAUDE.md:165 "`VoiceAllocator` maps `pointerId → Voice` from a pool of max 6" and agents/CLAUDE.md:259 "Voice pool (6 voices)". Since the pool is shared with playback (see the allocation finding), the 10-pointer cap is not the binding constraint and the comment actively misleads anyone reasoning about polyphony.

**How it fails**

> A maintainer raises MAX_POINTERS to 14 on the strength of the comment "matches VoiceAllocator pool size", expecting 14 simultaneous touches to work; they still fail whenever playback holds slots, because the pool is shared and there is no stealing. Conversely, someone trusting agents/CLAUDE.md sizes a fix around 6 voices.

**Suggested fix**

Derive `MAX_POINTERS` from the allocator (export `MAX_VOICES` and import it, or pass the allocator's size to PointerHandler), fix the `[maxVoices=6]` JSDoc to `[maxVoices=14]`, and update agents/CLAUDE.md:165 and :259.

<a id="c-60"></a>
### 60. Voice pool size is documented as 6, commented as 10, and actually 14

**Low** · `inconsistency` · [VoiceAllocator.js:15](src/input/VoiceAllocator.js#L15)

Four numbers for one value. Actual: `const MAX_VOICES = 14;` (src/input/VoiceAllocator.js:9). Its own JSDoc one line above the constructor still says `@param {number} [maxVoices=6]` (src/input/VoiceAllocator.js:15). `GranularEngine` comments `// Voice pool (10 voices, mapped by pointer ID)` (src/audio/GranularEngine.js:23). `PointerHandler` caps input at `const MAX_POINTERS = 10;` with the comment `/** Maximum tracked pointers (matches VoiceAllocator pool size). */` (src/input/PointerHandler.js:8-9) — which no longer matches. Docs: agents/CLAUDE.md:164 says "`VoiceAllocator` maps `pointerId → Voice` from a pool of max 6", plan 2.1 says "default: 6" (line 226), plan 4.5g.3 says 10 → 14 (line 1206), and the plan summary table says "Multi-touch support (10 voices)" (line 1556). `voiceColors.js:2` also declares "10 distinct, high-contrast colors", so voices 10–13 silently reuse colors 0–3 via `voiceId % VOICE_COLORS.length` (src/ui/voiceColors.js:25).

**How it fails**

> A maintainer reading `PointerHandler.js:8-9` believes 10 is the pool size and raises MAX_POINTERS to match "the pool", or trusts the `maxVoices=6` JSDoc and passes an explicit 6 to `new VoiceAllocator(ctx, dest, 6)` — which silently breaks the loop crossfade, since Player pre-starts the next iteration's voices while the current iteration still holds voices (src/automation/Player.js:324-360) and 6 slots cannot hold both.

**Suggested fix**

Export `MAX_VOICES` from VoiceAllocator, import it in PointerHandler for `MAX_POINTERS`, fix the `[maxVoices=6]` JSDoc and the GranularEngine comment, and update agents/CLAUDE.md:164 plus the plan summary row.

<a id="c-61"></a>
### 61. "Randomize pitch without quantize" is scale-snapped, contradicting the documented mode table

**Low** · `doc-drift` · [main.js:296](src/main.js#L296)

The plan's mode table for all three core parameters states: quantize off + randomize on → "Per-grain continuous random between min/max range — true per-grain jitter" (agents/granular-sampler-implementation-plan.md:341-346), and for pitch specifically "**Randomized mode**: each grain picks a random pitch in log2 space (±2 octaves)" (line 365). The code never does this. `resolveParams` builds a scale-derived note table on all three randomPitch branches — including the un-quantized one at src/main.js:296-300 — and `Voice._onScheduleGrain` picks `table[Math.floor(Math.random() * table.length)]` (src/audio/Voice.js:224-228). Grain size and density *do* honour the documented behaviour (continuous `expMap` at src/audio/Voice.js:211 and src/audio/GrainScheduler.js:104), so pitch is the odd one out.

**How it fails**

> Following the documented behaviour, a user enables Randomize Pitch with Quantize Pitch off and expects continuous glissando-like jitter. Instead they get discrete chromatic steps, because `pitchQuantize = { noteTable }` is always populated. There is no configuration that yields continuous random pitch.

**Suggested fix**

Either set `pitchQuantize = null` on the `else if (m.randomPitch)` branch (leaving the now-dead `randomize.pitch` path in Voice.js to handle it), or update the plan's mode table to state that pitch randomization is always scale-quantized.

<a id="c-62"></a>
### 62. Metronome mute state is serialized but never restored, and the documented mute button does not exist

**Low** · `inconsistency` · [main.js:633](src/main.js#L633)

`getLoopStationState()` serializes `metronome.muted` (src/main.js:569) into localStorage and every exported session, but there is no producer (no mute UI in index.html:77-80) and no consumer (restore hardcodes `setMuted(false)` at main.js:633 — arguably correct, since mute is transient count-in state). Plan 4.5g.5/4.5g.7 (lines 1245, 1255, 1281) document a mute button and a `.metronome-mute-btn` style rule that do not exist. Either drop `muted` from the session schema or ship the documented control; update the plan either way.

**How it fails**

> A field is round-tripped through localStorage and every exported session JSON but has no producer (no UI) and no consumer (restore forces false). Anyone adding the documented mute button will believe persistence already works, ship it, and find mute silently resets on every reload.

**Suggested fix**

Either drop `muted` from `getLoopStationState()`/the session schema, or add the documented mute control and change src/main.js:633 to `masterBus.metronome.setMuted(met.muted ?? false)`. Update plan 4.5g.5 either way.

<a id="c-63"></a>
### 63. One concept, three names, inverted semantics: "Density" is actually inter-onset time

**Low** · `naming` · [main.js:204](src/main.js#L204)

The same value is called `density` in the UI and state (index.html:313 `<label>Density</label>`, `densityMin/densityMax` in src/state/InstanceState.js:20-21 and `ParameterPanel.getParams()` src/ui/ParameterPanel.js:538-539), `interOnset` in the engine (src/audio/Voice.js:33, src/audio/GrainScheduler.js:22, src/automation/Recorder.js:192), and is displayed in milliseconds (src/ui/ParameterPanel.js:36). Crucially the semantics invert: a *higher* "Density" slider produces a *longer* inter-onset, i.e. *fewer* grains per second. The code compensates with a special case duplicated verbatim in two functions:
```js
const effectiveGv = (dim === 'velocity' && target === 'density') ? 1 - gv : gv;
```
(src/main.js:204 and src/main.js:332). `getResolvedNormals` (src/main.js:323-338) is otherwise a second, partial copy of the mapping logic in `resolveParams` (src/main.js:200-223) — the two can drift independently.

**How it fails**

> A user drags "Density" to the right expecting a denser cloud and gets a sparser one. A maintainer adding a new gesture dimension (e.g. tilt) updates the switch in `resolveParams` but forgets the parallel if-chain in `getResolvedNormals`, so the on-slider gesture indicator stops tracking the value actually sent to the engine.

**Suggested fix**

Rename the UI label to "Inter-onset" (or invert the slider so right = denser and delete the `1 - gv` special case), and have `getResolvedNormals` be derived from a single shared mapping function rather than a hand-copied chain.

<a id="c-64"></a>
### 64. expMap bounds for grain size and density are hardcoded in three files each and can drift silently

**Low** · `magic-numbers` · [main.js:225](src/main.js#L225)

Grain size bounds appear as `expMap(n, 1, 1000)` (ms, display — src/ui/ParameterPanel.js:30), `expMap(grainSizeNorm, 0.001, 1.0)` (s, per-pointer — src/main.js:225), and `expMap(norm, 0.001, 1.0)` (s, per-grain randomization — src/audio/Voice.js:211). Density bounds appear as `expMap(n, 5, 500)` (src/ui/ParameterPanel.js:36), `expMap(densityNorm, 0.005, 0.5)` (src/main.js:226), and `expMap(norm, 0.005, 0.5)` (src/audio/GrainScheduler.js:104). They currently agree, but nothing enforces it. The same pattern repeats for the 20 ms parameter ramp `currentTime + 0.02` in four classes (src/audio/Voice.js:186, src/audio/GranularEngine.js:157, src/audio/MasterBus.js:62, src/audio/Metronome.js:121/134) and for the look-ahead pair 0.1 s / 25 ms duplicated between src/audio/GrainScheduler.js:16-19 and src/audio/Metronome.js:30-31.

**How it fails**

> Widening the grain-size range to 2000 ms means editing ParameterPanel.js:30 (display), main.js:225 (fixed value), and Voice.js:211 (randomized value). Missing any one gives labels that lie about the audible duration, or randomized grains covering a different span than fixed grains at the same slider position.

**Suggested fix**

Export `GRAIN_SIZE_RANGE = [0.001, 1.0]` and `INTER_ONSET_RANGE = [0.005, 0.5]` (seconds) from a single module and derive the ms display labels by multiplying by 1000 rather than restating them.

<a id="c-65"></a>
### 65. finishRecording reads the recorder's duration after stopping it, so free-form bar-quantization uses the last-event time instead of the recording length

**Low** · `quantization` · [main.js:883](src/main.js#L883)

main.js:882-883 calls active.recorder.getElapsedTime() after active.recorder.stopRecording() (:876), and Recorder.getElapsedTime() returns lane.getDuration() — the last event's timestamp, not the recorded length — once isRecording is false (Recorder.js:114-117), so quantizeDurationToBar rounds the wrong quantity. Reachability is narrow: the block is guarded by loopStationMode, and loop-station recordings always set fixedRecordDuration (main.js:861), so the fallback only fires if loop-station mode is toggled on during a free-form take. Fix by capturing the elapsed time before stopRecording() or latching it in the Recorder. (The genuinely reachable instance of this same stale-source mistake is onLoopRangeChange at main.js:1201, reported separately.)

**How it fails**

> Free-form recording where the performer lifts their hands at 6.4 s and hits Stop at 8.1 s (120 BPM, bar = 2 s). Intended: 4 bars. Actual: `quantizeDurationToBar(6.4)` = `round(3.2)` = 3 bars. The loop is a bar short and every layer stacked on it fights the grid.

**Suggested fix**

Capture the elapsed time before stopping (`const recordedLength = active.recorder.getElapsedTime();` on the line above `stopRecording()`), or have `Recorder.stopRecording()` return/latch the final elapsed time in a `_recordedLength` field that `getElapsedTime()` reports after the fact.

<a id="c-66"></a>
### 66. No ResizeObserver on the waveform container — panel layout changes resize the canvas box with no resize event, leaving a stale backing store

**Low** · `correctness` · [main.js:172](src/main.js#L172)

The canvas backing store is resynced only on `window.resize` (main.js:165-172), but `#waveform-container` is flex-sized against a content-height `#parameter-panel`, so toggling the arp param groups or the ADSR canvas changes the canvas CSS box with no resize event. The backing store goes stale until the next window resize. Because all drawing uses normalized coordinates scaled by the backing-store dimensions, pointer alignment is unaffected — the visible effects are a blurrier/vertically-rescaled waveform blit and non-uniformly scaled pointer and ghost circles. The fix is still `new ResizeObserver(resizeCanvas).observe(container)`, mirroring ADSRWidget.js:43-45.

**How it fails**

> Tick "randomize pitch" and choose the arpeggiator: five param groups appear, the panel grows ~150 px, the waveform container shrinks by the same amount. The canvas CSS box is now 150 px shorter but `canvas.height` is unchanged, so the browser scales the backing store to fit: the waveform is vertically squashed, and the pointer dot drawn at `amplitude * canvas.height` no longer sits under the finger (pointer input is read from `getBoundingClientRect()`, PointerHandler.js:89-91, so input and output are in different coordinate spaces until the next window resize).

**Suggested fix**

Replace/augment the window listener with `new ResizeObserver(resizeCanvas).observe(container)`, and read `devicePixelRatio` at draw time consistently (PointerHandler.js:244/271, GhostRenderer.js:127/157 and WaveformDisplay.js:232 all use the live global `devicePixelRatio` against a backing store sized at the last resize).

<a id="c-67"></a>
### 67. render() re-arms rAF as its last statement with no try/catch — one throw permanently kills all rendering and the fixed-length record auto-stop

**Low** · `robustness` · [main.js:1330](src/main.js#L1330)

The fixed-length (bar-count) recording auto-stop is evaluated only inside the rAF render loop (src/main.js:1305-1325), so it is tied to rAF liveness: with the tab hidden or backgrounded the loop is throttled/suspended and the recording does not stop at its target bar count while audio continues. Moving the auto-stop onto the audio clock or a timer fixes this. Adding try/finally around the render body is reasonable hardening but no throwing path was demonstrated.

**How it fails**

> Any throw inside `finishRecording()` at the end of a 4-bar loop-station recording (e.g. a null `active.player` after a concurrent tab close) escapes `render()`. The rAF chain is never re-armed: the waveform freezes, pointer indicators stop, the level meter sticks, gesture meters freeze, and no subsequent fixed-length recording can ever auto-stop — while audio keeps playing. The user sees a hung UI with running sound.

**Suggested fix**

Wrap the body in `try { … } catch (err) { console.error(err); } finally { requestAnimationFrame(render); }`, and move `finishRecording`'s auto-stop check out of the draw loop onto a timer or the audio clock so recording length does not depend on rAF liveness (it currently also stalls whenever the tab is hidden).

<a id="c-68"></a>
### 68. Loop-station overdub re-copies and re-serializes the entire lane on every loop wrap, and grows voiceIndex without bound

**Low** · `unbounded-state-growth` · [main.js:1273](src/main.js#L1273)

`onPlayerLoopWrap` fires on every loop boundary of every playing instance and unconditionally commits + restarts the overdub:
```js
inst.recorder.stopRecording();          // -> AutomationLane.merge(full lane, overdub lane)
inst.player.setLane(inst.recorder.getRecording());
inst.recorder.startOverdub(inst.player._startTime);  // -> AutomationLane.fromJSON(this._lane.toJSON())
if (persistence) persistence.scheduleSave();
```
(src/main.js:1273-1288)

That is two full O(n) copies of the lane per loop iteration (`merge` at src/automation/AutomationLane.js:109-142 and the undo snapshot at src/automation/Recorder.js:56), plus a debounced `JSON.stringify` of *every* instance's lane. Additionally, `merge` offsets laneB's voice indices by `maxVoiceA + 1` every time (src/automation/AutomationLane.js:110-115), so `voiceIndex` grows monotonically across wraps even though only 14 voices exist (`MAX_VOICES = 14`, src/input/VoiceAllocator.js:9). The player computes `syntheticId = base + event.voiceIndex` with `SYNTHETIC_POINTER_BASE_A = 1000` / `_B = 2000` (src/automation/Player.js:9-10, 282), so the two crossfade iterations collide once `voiceIndex` reaches 1000.

**How it fails**

> A 2-bar loop at 120 BPM (4 s) with overdub left on: ~15 wraps/minute. With 5 fingers active, `voiceIndex` grows ~5 per wrap, reaching 1000 after roughly 13 minutes of layering — at which point iteration A's synthetic id 2000 aliases iteration B's voice 0, so the crossfade `onRelease`/`stop` for one iteration kills the other iteration's voice (audible dropouts at every loop point). Long before that, the per-wrap double lane copy plus a full-session `JSON.stringify` every 500 ms on the main thread causes visible frame drops in the rAF render loop.

**Suggested fix**

Skip the commit entirely when `_overdubLane.length === 0` (the common case). Renumber voice indices after merge (e.g. modulo the pool size) instead of offsetting monotonically, and only call `scheduleSave()` on wrap when the overdub actually captured events.

<a id="c-69"></a>
### 69. `InstanceState.toJSON()` blind-spreads `...this`, re-emitting non-schema fields injected by `fromJSON`

**Low** · `serialization-hygiene` · [InstanceState.js:62](src/state/InstanceState.js#L62)

`fromJSON` copies every key of the parsed session onto the live state:
```js
return Object.assign(state, data);
```
(src/state/InstanceState.js:80)

and `toJSON` writes every own property back out:
```js
return { ...this, adsr: {...}, mappings: {...}, arpCustomPattern: ... };
```
(src/state/InstanceState.js:60-70)

`serializeSession` attaches `recording` to the *serialized* object (src/state/SessionSerializer.js:31-34), so on restore `state.recording` becomes a live property of the `InstanceState` holding the entire raw lane JSON — even though `restoreFromSession` reads that data from `savedState`, not from `state` (src/state/InstanceManager.js:308-318). Nothing ever removes it. The same mechanism permanently round-trips any obsolete field the current code no longer understands.

**How it fails**

> Restore a session with a recording: `state.recording` now holds a second full copy of every event in memory for the lifetime of the tab (a 1200-event lane is ~240 KB duplicated per instance). If `savedState.recording.lane` is malformed, `restoreFromSession` skips `recorder.setRecording` — but the malformed blob is still glued to the state and re-serialized into every subsequent save, so the corrupt data is preserved forever instead of being dropped.

**Suggested fix**

Make `toJSON()` enumerate the schema explicitly rather than spreading `...this`, and have `fromJSON` whitelist known keys instead of `Object.assign`-ing arbitrary input. `recording` should live on the manager entry, not on `InstanceState`.

<a id="c-70"></a>
### 70. `saveNow()` bypasses the `_enabled` guard that `scheduleSave()` respects

**Low** · `persistence-lifecycle` · [SessionPersistence.js:38](src/state/SessionPersistence.js#L38)

`scheduleSave` short-circuits when disabled, `saveNow` does not:
```js
scheduleSave() {
    if (!this._enabled) return;
    ...
}

/** Force an immediate save (e.g., on beforeunload). */
saveNow() {
    if (this._timerId !== null) { clearTimeout(this._timerId); this._timerId = null; }
    this._writeToLocalStorage();
}
```
(src/state/SessionPersistence.js:26-44)

`disable()` is used to protect the window during restore/import (src/main.js:648 and 742, re-enabled at 696 / 775), but the `beforeunload` handler calls `saveNow()` unconditionally (src/main.js:786-788).

**How it fails**

> Import a session file and close the tab (or navigate away) while `await instanceManager.restoreFromSession(...)` is still resolving sample loads. `beforeunload` fires `saveNow()`, which serializes the half-restored workspace — e.g. instances whose `buffer` is still null and whose `sampleDisplayName` has not yet been reconciled — overwriting the good stored session with a partial snapshot.

**Suggested fix**

Add `if (!this._enabled) return;` to `saveNow()` (keep the pending-timer clear), or have the restore paths set a `_restoring` flag that both entry points check.

<a id="c-71"></a>
### 71. Session `version` is written but never branched on; there is no migration path and future/older schemas are accepted blindly

**Low** · `schema-versioning` · [SessionSerializer.js:42](src/state/SessionSerializer.js#L42)

`serializeSession` stamps `version: 2` (src/state/SessionSerializer.js:42) but `validateSession` only asserts it is a number:
```js
if (typeof json.version !== 'number') {
    return { valid: false, error: 'Missing version number' };
}
```
(src/state/SessionSerializer.js:65-68)

Nothing reads the value. All backward-compat handling is ad-hoc and scattered across two unrelated layers: `InstanceState.fromJSON` rewrites `pan` -> `panMin`/`panMax` (src/state/InstanceState.js:74-79), and `ParameterPanel.setFullState` maps legacy `arpPattern` values `up|down|updown` -> `arpeggiator` (src/ui/ParameterPanel.js:649-655) and defaults `panMin ?? pan ?? 0` (lines 617-618). A v1 field that was *removed* (the old global `loopStationMode`, per the comment at src/state/SessionSerializer.js:47) has no handling at all, and `InstanceState.fromJSON`'s blind `Object.assign` (line 80) copies unknown fields straight onto the live state.

**How it fails**

> A user who has upgraded exports a v2 session, then opens it in an older deployed copy of the app (or vice versa after the next schema change). `validateSession` returns `{valid:true}` for any numeric version, `Object.assign` copies fields the running code does not understand, and the mismatch surfaces as silent wrong values or a mid-restore throw (which, per the restore-failure finding, leaves the app with no active instance) rather than a clear "session from a newer version" message.

**Suggested fix**

Add `const CURRENT_VERSION = 2;` and branch explicitly: reject `json.version > CURRENT_VERSION` with a clear error, and route `json.version < CURRENT_VERSION` through a named `migrate(json, from)` chain that owns the `pan`/`arpPattern`/`loopStationMode` fix-ups currently spread across InstanceState and ParameterPanel.

<a id="c-72"></a>
### 72. ADSRWidget drag state is a single global — a second touch hijacks or silently kills an in-progress drag

**Low** · `correctness` · [ADSRWidget.js:78](src/ui/ADSRWidget.js#L78)

The widget stores one drag target, `this._dragPoint`, and `_onPointerDown` overwrites it unconditionally from the hit-test: `this._dragPoint = this._hitTest(x, y);` (ADSRWidget.js:78). `_onPointerMove` gates only on `if (!this._dragPoint) return;` (ADSRWidget.js:87) with no pointerId check, and `_onPointerUp` clears it for *any* pointer (ADSRWidget.js:112-117). The canvas is `touch-action: none` (style.css:1101) so it does receive multi-touch. On a device whose primary input is touch this is the same hazard the main canvas explicitly designs around with a `Map<pointerId, …>` (PointerHandler.js:40).

**How it fails**

> Finger A is dragging the 'D'/sustain point. Finger B taps the ADSR canvas on empty space: `_hitTest` returns null, `_dragPoint` becomes null, and finger A's subsequent moves are silently ignored for the rest of the gesture. If finger B instead lands on the 'R' point, `_dragPoint` becomes 'R' and finger A's movements now drag the release point instead of sustain.

**Suggested fix**

Key drag state by pointerId (`this._drags = new Map()`), ignore a `pointerdown` while a drag is already in flight, and filter `_onPointerMove`/`_onPointerUp` on `e.pointerId`.

<a id="c-73"></a>
### 73. Assorted unreachable/unread members: dead ghost-color branch, write-only counter, uncalled public API

**Low** · `dead-code` · [GhostRenderer.js:41](src/ui/GhostRenderer.js#L41)

`voiceIndex: params._voiceIndex ?? (syntheticId % 10)` (src/ui/GhostRenderer.js:41) — `_voiceIndex` is never set on any params object anywhere in the repo (the Recorder writes only position/amplitude/pitch/grainSize/interOnset/spread/pan/envelope/adsr, src/automation/Recorder.js:186-200), so the fallback always runs; the magic `10` silently duplicates `VOICE_COLORS.length`. `TabBar._tabCount` is assigned in the constructor and in `render()` but never read (src/ui/TabBar.js:18, 28). `TransportBar.getLoopRange()` (line 167) and `resetLoopRange()` (line 183) have no callers — main.js only ever calls `transport.setLoopRange(...)` (src/main.js:885, 1222). `Player.getElapsedTime()` (src/automation/Player.js:197) has no caller; main.js uses `recorder.getElapsedTime()` instead. `MasterClock` ships seven query methods that nothing calls: `getBeatPhase`, `getBeatInBar`, `getCurrentBeat`, `getCurrentBar`, `getNextBarTime`, `quantizeToBeat`, `getBarsDuration` (src/audio/MasterClock.js:80-193); meanwhile `Metronome` reaches around the public API into the private field — `const elapsed = this._nextBeatTime - this._clock._epoch;` (src/audio/Metronome.js:66). `MasterBus.dispose()`, `PointerHandler.dispose()` and `ADSRWidget.dispose()` are likewise never invoked.

**How it fails**

> With 14 voice slots, a playback voice at voiceIndex 12 produces syntheticId 1012, and `1012 % 10 = 2` — the ghost pointer is drawn in voice-2's color while the live/grain visuals for that voice use `getVoiceColor(12) = VOICE_COLORS[2]`... coincidentally matching only because both moduli are 10. Change `VOICE_COLORS` to 12 entries and ghosts desynchronize from grains.

**Suggested fix**

Replace `syntheticId % 10` with `getVoiceColor`-compatible indexing (import `VOICE_COLORS.length`) and delete `_voiceIndex`; remove `_tabCount`, the two uncalled TransportBar methods, `Player.getElapsedTime`, and either use or delete the unused MasterClock queries; expose a public `getEpoch()` so Metronome stops reading `_clock._epoch`.

<a id="c-74"></a>
### 74. GhostRenderer._fading grows without bound for instances that are not the active tab

**Low** · `memory-leak` · [GhostRenderer.js:47](src/ui/GhostRenderer.js#L47)

`dispatch('stop', ...)` unconditionally pushes onto `this._fading` (GhostRenderer.js:47). The only code that ever removes entries is the splice loop inside `draw()` — but that loop is nested inside `if (this.active)` (GhostRenderer.js:80, prune at :89-98). `draw()` is called only for the active instance: `active.ghostRenderer.draw(...)` in main.js:1298 where `active = instanceManager.getActive()`. Meanwhile `InstanceManager.switchTo()` deliberately leaves background playback running — it only stops the recorder, and the comment on InstanceManager.js:128 says "playback continues in background" — and `player.onDispatch` (InstanceManager.js:61-68, and the duplicate at :273-280) always forwards to `ghostRenderer.dispatch(...)`. So a looping background instance pushes a `_fading` entry per recorded voice-stop per loop iteration and nothing ever drains it. `clear()` (line 59) is only reached via `transport.onStop`/`player.onComplete` for the *active* tab.

**How it fails**

> Record a loop on tab 1, press play, switch to tab 2 and keep working. Tab 1 keeps looping. Its `_fading` array grows by one object per voice-stop per iteration (e.g. 30 stops per 4 s loop = 7.5 objects/s ≈ 27 000 objects/hour), forever, with no eviction. Switch back to tab 1 and the render loop must also splice through the entire backlog on the first frame.

**Suggested fix**

Move the `_fading` pruning out of `draw()` into an `update(now)` method called for every instance each frame (or prune inside `dispatch` itself), and/or cap `_fading` length in `dispatch` — anything pushed while `!this.active` can simply be dropped since it will never be drawn.

<a id="c-75"></a>
### 75. GrainOverlay hardcodes ±2 octaves while the Pitch Range control allows ±4 — grains render off-canvas

**Low** · `inconsistency` · [GrainOverlay.js:77](src/ui/GrainOverlay.js#L77)

The overlay maps pitch to Y assuming a fixed ±2 octave span:
```js
const pitchLog = g.pitch ? Math.log2(g.pitch) : 0;
const pitchNorm = pitchLog / 4; // ±2 oct → ±0.5
const yCenter = canvasHeight / 2 - pitchNorm * canvasHeight;
```
(src/ui/GrainOverlay.js:76-78). But `#param-pitch-range` is `min="1" max="4"` octaves (index.html:270) and `resolveParams` builds the note table over `range = (m.pitchRange || 2) * 12` semitones (src/main.js:271), so playback rates up to 2^4 = 16 are produced. The same ±2 constant is hardcoded twice more in main.js: `const octaves = 2 - 4 * y;` (src/main.js:178) and `pitch = Math.pow(2, lerp(-2, 2, effectiveGv));` (src/main.js:220) — neither consults `pitchRange`.

**How it fails**

> Set Pitch Range to ±4 oct with Randomize Pitch on. A grain at +4 octaves has `pitchLog = 4`, `pitchNorm = 1`, `yCenter = h/2 - h = -h/2` — the rectangle is drawn entirely above the canvas and is invisible. Roughly half the grain cloud disappears from the visualization while remaining audible.

**Suggested fix**

Pass the active `pitchRange` into `GrainOverlay.draw()` (or store it on the overlay when params change) and compute `pitchNorm = pitchLog / (2 * pitchRange)`; hoist the ±2 default into a single shared constant used by `yToPitch` and the gesture pitch mapping.

<a id="c-76"></a>
### 76. Pan is wired into the gesture-mapping machinery but 'pan' is not an option in any mapping dropdown

**Low** · `dead-code` · [ParameterPanel.js:873](src/ui/ParameterPanel.js#L873)

`updateParamRelevance()` computes `const panMinActive = m.randomPan || hasMapping('pan');` (src/ui/ParameterPanel.js:873), where `hasMapping` scans the three gesture selects. All three (`#map-pressure`, `#map-contact-size`, `#map-velocity`) offer exactly five targets — none, grainSize, density, spread, amplitude, pitch (index.html:388-395, 405-412, 422-429). There is no `pan` option, and `resolveParams`'s mapping switch has no `case 'pan'` (src/main.js:206-222), so `hasMapping('pan')` is permanently false. Relatedly, `pan` is a member of `RANGE_PARAMS` (src/ui/ParameterPanel.js:44-49) so `updateGestureIndicators` iterates it every frame (src/ui/ParameterPanel.js:772-800), but `getResolvedNormals` only ever populates grainSize/density/spread (src/main.js:333-335) — the pan gesture indicator is unconditionally hidden.

**How it fails**

> Always. `hasMapping('pan')` short-circuits to false and the `.gesture-indicator[data-param="pan"]` element (index.html:353) is set to `opacity: 0` on every animation frame forever. A maintainer adding pan gesture control will assume the plumbing already works and only add the `<option>`, then find `resolveParams` silently ignores it.

**Suggested fix**

Either add `<option value="pan">Pan</option>` to the three mapping selects plus a `case 'pan'` in `resolveParams`, or drop the `hasMapping('pan')` term and the pan gesture-indicator div.

<a id="c-77"></a>
### 77. ParameterPanel JSDoc no longer matches its own return shapes

**Low** · `doc-drift` · [ParameterPanel.js:19](src/ui/ParameterPanel.js#L19)

Four stale annotations in one file. (1) The `GrainParams` typedef declares `@property {number} pan - Stereo pan (-1 to 1)` (line 19) but `getParams()` returns `panMin`/`panMax` and no `pan` (lines 542-543), and the typedef omits the `adsr` property that is returned (line 546). (2) `getMusicalParams()` is annotated `@returns {{ rootNote: number, scale: string, quantizeDensity: boolean, quantizePitch: boolean }}` (line 560) while actually returning 16 fields including all subdiv/random/arp state (lines 563-583). (3) The section comment `// --- Simple sliders (pan, volume) ---` (line 100) survives plan 4.5c, which moved pan out of `SIMPLE_SLIDERS` — the array now holds only `param-volume` (lines 53-55). (4) The constructor documents `@param {(volume: number) => void} callbacks.onVolumeChange - Called when **master** volume changes` (line 66) but plan 4.5a made this per-instance: main.js routes it to `active.engine.setInstanceVolume(v)` (src/main.js:359). Similar drift elsewhere: `InstanceManager.getActive()` is typed as returning `{state, engine, grainOverlay, buffer}` (src/state/InstanceManager.js:187) while callers rely on `.recorder`, `.player` and `.ghostRenderer`; `grainFactory`'s GrainParams says `@property {'hann'|'tukey'|'triangle'} envelope` (src/audio/grainFactory.js:15) though nine types exist; and `getEnvelope`'s union omits `'custom'` (src/audio/envelopes.js:79) even though line 85 handles it.

**How it fails**

> An editor with JSDoc-driven completion offers `params.pan` after `getParams()` and flags `params.panMax` as unknown; a contributor typing against `getActive()` sees no `.player` member and adds a redundant lookup through `instanceManager.instances.get(activeId)`.

**Suggested fix**

Update the four annotations to match the code; the `getMusicalParams` return type is best expressed as a named `@typedef MusicalParams` alongside `GrainParams`.

<a id="c-78"></a>
### 78. Per-frame forced layout thrash: updateRandomIndicators interleaves offset* reads with style writes inside the render loop

**Low** · `efficiency` · [ParameterPanel.js:830](src/ui/ParameterPanel.js#L830)

Read-after-write of layout properties in a per-frame loop: `updateRandomIndicators` reads slider.offsetLeft/offsetWidth and row offsetTop/offsetHeight (ParameterPanel.js:830-848) each frame, immediately after LevelMeter.update() writes a changing style.width (LevelMeter.js:40) — forcing one synchronous layout per frame. The geometry only changes on resize and the toggles only change on user input, so caching the offsets and driving updateRandomIndicators/updateParamRelevance from change/input events removes the work entirely. Maintainability/efficiency cleanup, not a measured performance defect.

**How it fails**

> During a dense multi-touch performance the main thread runs 3 forced reflows + ~10 style writes + a full DOM parameter read every 16 ms, on top of canvas drawing. Because the `GrainScheduler` setTimeout shares that thread, the added jitter delays `_tick`, which (given the unclamped `nextGrainTime`) turns into batched grain bursts — audible as rhythmic clumping under UI load.

**Suggested fix**

Cache the `offset*` geometry (it only changes on resize/layout change) and recompute it from the resize path rather than per frame; drive `updateRandomIndicators`/`updateParamRelevance` from the panel's own `change`/`input` events instead of the render loop; and in `LevelMeter.update` skip the DOM write when the rounded value/colour bucket is unchanged.

<a id="c-79"></a>
### 79. ADSR default `{a:0.2, d:0.15, s:0.7, r:0.2}` is duplicated in three modules

**Low** · `duplicated-defaults` · [ParameterPanel.js:594](src/ui/ParameterPanel.js#L594)

The same literal appears in three places with no shared constant:
- `envelopes.js`: `let _customADSRParams = { a: 0.2, d: 0.15, s: 0.7, r: 0.2 };` (src/audio/envelopes.js:258) — the module-global fallback, and the source `ADSRWidget` seeds itself from via `getCustomADSR()` (src/ui/ADSRWidget.js:23-27).
- `InstanceState.js`: `this.adsr = { a: 0.2, d: 0.15, s: 0.7, r: 0.2 };` (src/state/InstanceState.js:57) — the per-instance default.
- `ParameterPanel.getFullState()`: `const adsr = this._adsrWidget ? this._adsrWidget.getState() : { a: 0.2, d: 0.15, s: 0.7, r: 0.2 };` (src/ui/ParameterPanel.js:594) — the fallback when no ADSR widget exists.

The same pattern applies to other defaults: `recordBarCount = 4` at src/state/InstanceState.js:54, src/main.js:860, src/main.js:1095 and src/main.js:1316; `pitchRange = 2` at src/state/InstanceState.js:50, src/main.js:250 and src/main.js:271.

**How it fails**

> They currently agree, so nothing is broken today. Change the ADSR default in `envelopes.js` only, and: a fresh instance created via the "+" button gets the *stale* `InstanceState` values pushed into the widget by `setFullState`, while the very first instance — for which `panel.setFullState` is never called (`createInstance` only wires `activeId`, src/state/InstanceManager.js:100-104) — keeps the HTML/widget default. Two tabs, two different envelopes, no error.

**Suggested fix**

Export a single `DEFAULT_ADSR` (and a `DEFAULTS` object for the other duplicated literals) from one module and import it everywhere, including the index.html slider values via a small init pass.

<a id="c-80"></a>
### 80. TransportBar loop-handle drag ignores pointercancel and does not filter by pointerId — stuck drag on multi-touch

**Low** · `lifecycle` · [TransportBar.js:118](src/ui/TransportBar.js#L118)

TransportBar's loop-handle drag uses document-level listeners with no pointerId filter and no pointercancel handler (src/ui/TransportBar.js:118-149). On multi-touch, any other pointer's pointerup ends the handle drag prematurely, and a cancelled touch leaves `_draggingHandle` set until the next pointerup anywhere. Fix: record the pointerId in `_beginDrag`, filter both handlers on it, and bind/unbind `pointercancel` alongside `pointerup`.

**How it fails**

> On a tablet the user drags the loop-start handle and the OS cancels that touch (palm rejection, edge-swipe gesture, incoming notification). `pointercancel` fires, `pointerup` never does. `_draggingHandle` stays `'start'` and the document-level `pointermove` listener stays attached forever. Every subsequent finger movement anywhere on the page — including the multi-touch granular gesture on the waveform canvas — drags the loop-start handle and fires `onLoopRangeChange`, continuously rewriting `player.setLoopRange()` mid-performance. Conversely, with two fingers down, lifting the *canvas* finger fires a document `pointerup` that prematurely ends the handle drag.

**Suggested fix**

Record the dragging pointerId in `_beginDrag`, early-return from `_onHandlePointerMove`/`_onHandlePointerUp` when `e.pointerId` does not match, and add `document.addEventListener('pointercancel', this._onHandlePointerUp)` (removed alongside the others).

<a id="c-81"></a>
### 81. Seven unreferenced exports across utils, including two superseded quantization helpers

**Low** · `dead-code` · [musicalQuantizer.js:158](src/utils/musicalQuantizer.js#L158)

Dead exports confirmed: `normalizedToSubdivision` (musicalQuantizer.js:158) and `quantizeDensity` (line 132) have no importers after plan step 4.7b replaced them with explicit subdivision dropdowns; `mapRange` (math.js:23) has no call site; `generatePermutations`, `hannWindow`/`tukeyWindow`/`triangleWindow` and `VOICE_COLORS` are exported but consumed only within their own modules. The stale ordering comment at musicalQuantizer.js:29 should go with them. (Correction: main.js does not import `quantizeDensity`, so the claimed name collision with the boolean state field does not exist.)

**How it fails**

> A maintainer reads `normalizedToSubdivision` and the SUBDIVISIONS ordering comment and 'fixes' the slider-direction issue described in plan 2.8a, changing behaviour nowhere; or is confused about whether `quantizeDensity` at a call site refers to the imported function or the mode flag.

**Suggested fix**

Delete `normalizedToSubdivision`, `quantizeDensity`, and `mapRange`; drop the `export` keyword from `generatePermutations`, the three window functions, and `VOICE_COLORS` (or keep the export and add a test that uses it). Remove the stale SUBDIVISIONS ordering comment.

<a id="c-82"></a>
### 82. quantizeTimeToGrid ignores the time signature denominator, so the snap-to-grid button uses a different grid than loop-station mode

**Low** · `quantization` · [musicalQuantizer.js:285](src/utils/musicalQuantizer.js#L285)

```js
export function quantizeTimeToGrid(time, bpm, divisor = 4) {
    const gridSize = (60 / bpm) * (4 / divisor);   // musicalQuantizer.js:286
    return Math.round(time / gridSize) * gridSize;
}
```

Callers never pass `divisor`, so the grid is always a quarter note:
```js
loopStart = quantizeTimeToGrid(loopStart, bpm);          // main.js:1217
loopEnd   = quantizeTimeToGrid(loopEnd, bpm);            // :1218
if (loopEnd <= loopStart) loopEnd = loopStart + (60 / bpm);   // :1219 — hardcoded quarter note
```

`MasterClock.getBeatDuration()` (MasterClock.js:42-44) explicitly honours the denominator: `(60/bpm) * (4/denominator)`. So in 6/8 at 120 BPM the clock's beat is 0.25 s while the snap button quantizes to 0.5 s, and the loop-station branch immediately above (`main.js:1210-1213`, using `clock.getBarDuration()`) quantizes to 1.5 s. Three grids, one UI.

Separately, both snap paths use `Math.round`, which is symmetric — that part is fine and does not bias early/late; the bias problems in this codebase come from the wrap logic, not from the rounding function.

**How it fails**

> Set the time signature to 6/8, enable snap-to-grid in free-form mode, and drag a loop handle. The handle snaps to quarter-note positions that do not exist on the 6/8 grid the metronome is clicking, so the loop can never be an integer number of 6/8 bars.

**Suggested fix**

Delete `quantizeTimeToGrid`'s independent grid math and route both branches of `onLoopRangeChange` through the clock (`clock.quantizeToBeat` / `clock.quantizeToBar`), which already accounts for the denominator. Replace the `60 / bpm` fallback at main.js:1219 with `masterBus.clock.getBeatDuration()`.

<a id="c-83"></a>
### 83. test-modules.html covers 5 of 26 modules and overstates what it verifies

**Low** · `test-coverage` · [test-modules.html:31](test-modules.html#L31)

The only test harness in the repo imports MasterBus, InstanceState, InstanceManager, TabBar and ParameterPanel (test-modules.html:11-29) and finishes with `out('\nAll module imports and basic construction succeeded.')` (line 39). It constructs only two of them — `new MasterBus()` (line 32) and `new InstanceState('Test')` (line 36); InstanceManager, TabBar and ParameterPanel are imported but never constructed (they would throw, since the file has no `#parameter-panel` DOM). Nothing covers the modules added in plan steps 4.1-4.9: AutomationLane, Recorder, Player, MasterClock, Metronome, GhostRenderer, SessionSerializer, SessionPersistence, TransportBar, GrainScheduler, grainFactory, envelopes, musicalQuantizer. The harness also constructs an `AudioContext` at load with no user gesture and never calls `bus.dispose()`, so the reported `bus.audioContext.state` will be `'suspended'` in Chrome regardless of whether anything works.

**How it fails**

> A syntax error or bad import path in `Player.js` or `SessionSerializer.js` ships undetected — test-modules.html still prints "All module imports and basic construction succeeded." because it never touches those files.

**Suggested fix**

Either extend the harness to `await import()` every file under `src/**` (a glob-free explicit list is fine for 26 files) and drop the 'construction' claim, or delete it and replace with a small assertion page covering the pure modules (musicalQuantizer, envelopes, math, AutomationLane) that can be tested without DOM or audio.

---

# Nit (6)

<a id="c-84"></a>
### 84. Plan status tags are inconsistent — implemented steps 2.8/2.9 carry no [DONE] marker

**Nit** · `doc-drift` · [granular-sampler-implementation-plan.md:407](agents/granular-sampler-implementation-plan.md#L407)

Every step heading in the plan carries a `[DONE]` suffix except two: "### Step 2.8 — Fix Quantized Slider Directions, Arpeggiator Patterns & Randomization Distribution" (line 407) and "### Step 2.9 — Context-Aware Parameter Relevance (Dim/Disable Inactive Controls)" (line 499). Yet the summary table declares Phase 2 COMPLETE (line 1556) and 2.9 is fully implemented — `updateParamRelevance()` exists (src/ui/ParameterPanel.js:860-886), `.param-inactive`/`.range-row-inactive` exist (style.css:992-1002), and main.js calls it every frame (src/main.js:1306). Step 2.8a's prescribed fix (`normalizedToSubdivision(1 - norm)`) was subsequently superseded by the explicit subdivision dropdowns of step 4.7b (line 1445) but 2.8a is not marked superseded, so the file simultaneously prescribes and forbids `normalizedToSubdivision`. 2.8b's Up/Down/Up-Down arp patterns were likewise replaced by permutations in 3.8 (line 711) — only ParameterPanel's legacy migration at src/ui/ParameterPanel.js:651 remains as evidence.

**How it fails**

> An agent scanning for un-[DONE] steps picks up 2.8a and reintroduces `normalizedToSubdivision(1 - norm)` into `resolveParams`, conflicting with the `m.subdivGrainSize`/`m.subdivDensity` dropdown values that main.js:231-235 now uses.

**Suggested fix**

Mark 2.8 and 2.9 [DONE], and annotate 2.8a/2.8b as SUPERSEDED BY 4.7b / 3.8.

<a id="c-85"></a>
### 85. Orphaned JSDoc block sits above an unrelated section, 15 lines from the function it documents

**Nit** · `readability` · [main.js:1068](src/main.js#L1068)

The comment block
```js
/**
 * Update UI to reflect the active tab's loop station mode.
 * Forces loop ON and snap locked when in loop station mode.
 * @param {boolean} enabled
 */
// --- Bar-count selector (fixed-length recording in loop station mode) ---
const barCountSelector = document.getElementById('bar-count-selector');
```
(src/main.js:1068-1074) documents `applyLoopStationUI`, but the bar-count selector declarations and their click handlers were inserted between the doc comment and the function, which now begins at src/main.js:1088. Tooling and readers attach the JSDoc to `const barCountSelector`. Also `const sig = 1 / (1 + Math.exp(-steepness * t));` in `_computeSigmoid` (src/audio/envelopes.js:197) is computed and immediately shadowed by the two branch expressions below it — a leftover from an earlier formulation.

**How it fails**

> An IDE hovering `barCountSelector` shows "Update UI to reflect the active tab's loop station mode. @param {boolean} enabled", and `applyLoopStationUI` shows no documentation at all.

**Suggested fix**

Move the JSDoc block down to immediately precede `function applyLoopStationUI(enabled)` at line 1088, and delete the unused `sig` local in `_computeSigmoid`.

<a id="c-86"></a>
### 86. `metronome.muted` is serialized but the restore path hardcodes `false`

**Nit** · `serializer-mismatch` · [main.js:633](src/main.js#L633)

> **Same defect as [#62](#c-62)**, found independently by the `input-lifecycle` lens. Kept because it adds detail the other report does not have — fix them together.

`metronome.muted` is captured into every saved and exported session (main.js:566-570, SessionSerializer.js:46) but the restore path hardcodes `setMuted(false)` (main.js:633) and never reads it. Since mute is transient count-in state that arguably should not persist, the real cleanup is to drop the field from the serialized shape rather than to honour it.

**How it fails**

> `muted` is a write-only field: it is stored in every saved session and every exported .json but has no effect on load. Concretely, if the session is saved while a count-in has the metronome muted (`masterBus.metronome.setMuted(true)`, src/main.js:951), the saved `muted: true` is discarded on restore. The dead field also misleads anyone diffing an exported session.

**Suggested fix**

Either honour it — `masterBus.metronome.setMuted(met.muted ?? false)` — or drop `muted` from the serialized shape, since count-in mute is transient state that arguably should not be persisted at all.

<a id="c-87"></a>
### 87. Unused import of applyArpType in ParameterPanel

**Nit** · `dead-code` · [ParameterPanel.js:7](src/ui/ParameterPanel.js#L7)

`applyArpType` is imported at src/ui/ParameterPanel.js:7 (`SUBDIVISIONS, getSubdivisionSeconds, getPermutations, applyArpType,`) but never referenced in the file — the SVG preview draws the raw permutation (`_redrawArpSvg`, src/ui/ParameterPanel.js:355-410) without applying the straight/looped transform. Only main.js uses it (src/main.js:290). This is arguably also a UX inconsistency: with Arp Type = 'looped', the engine plays `[...pattern, ...pattern.slice(1,-1).reverse()]` (src/utils/musicalQuantizer.js:268-274) while the preview SVG still shows only the forward pattern.

**How it fails**

> With Arp Steps = 4 and Arp Type = Looped, the sequence heard is 4 + 2 = 6 steps long but the preview shows 4 points, so the visual pattern editor does not represent what is played.

**Suggested fix**

Either remove the unused import, or use it in `_redrawArpSvg` to render the looped tail (greyed) so the preview matches playback.

<a id="c-88"></a>
### 88. `hasMapping('pan')` in updateParamRelevance can never be true — no gesture select offers `pan`

**Nit** · `dead-code-drift` · [ParameterPanel.js:873](src/ui/ParameterPanel.js#L873)

> **Same defect as [#76](#c-76)**, found independently by the `input-lifecycle` lens. Kept because it adds detail the other report does not have — fix them together.

`updateParamRelevance` computes:
```js
const panMinActive = m.randomPan || hasMapping('pan');
```
(src/ui/ParameterPanel.js:873)

but none of the three gesture selects (`map-pressure`, `map-contact-size`, `map-velocity`) offers a `pan` option — they expose only `none | grainSize | density | spread | amplitude | pitch` (index.html:388-393, 405-410, 422-427). `resolveParams` likewise has no `case 'pan'` in its mapping switch (src/main.js:206-222) and `getResolvedNormals` never sets `normals.pan` (src/main.js:328-336). Meanwhile `pan` *is* in `RANGE_PARAMS` (src/ui/ParameterPanel.js:44-49) so `updateGestureIndicators` iterates a pan indicator that can never be positioned.

**How it fails**

> No runtime failure — the expression is a constant `false`. It is a stale leftover that reads as "pan is gesture-mappable", which it is not, and will mislead the next person implementing TODO.txt's "use pan and allow to randomize pan".

**Suggested fix**

Either add `<option value="pan">Pan</option>` to the three mapping selects plus a `case 'pan'` in `resolveParams`/`getResolvedNormals` (which is what TODO.txt asks for), or drop the `hasMapping('pan')` term and the pan entry from the gesture-indicator loop.

<a id="c-89"></a>
### 89. UI copy drift: canvas hint names a button that does not exist, page title is not the product name

**Nit** · `inconsistency` · [WaveformDisplay.js:235](src/ui/WaveformDisplay.js#L235)

The empty-canvas hint reads `ctx.fillText('Drop an audio file here or click "Load Sample"', ...)` (src/ui/WaveformDisplay.js:235) but the button is labelled "Load File" (index.html:36). `fileLoader.js` repeats the wrong name in its JSDoc: `@param {HTMLButtonElement} button - The visible "Load Sample" button` (src/utils/fileLoader.js:43). Separately, the document title is `<title>Granular Sampler</title>` (index.html:6) while every other user-visible and machine-visible identifier is "Granul8": the `<h1>` (index.html:22), the unlock overlay heading (index.html:12), the localStorage keys `granul8-session` / `granul8-theme` (src/state/SessionPersistence.js:3, src/main.js:31), the session marker `granul8: true` (src/state/SessionSerializer.js:41) and the export filename `granul8-session-*.json` (src/state/SessionPersistence.js:88).

**How it fails**

> A first-time user reads the canvas hint, scans the top bar for a "Load Sample" button, and finds only "Load File". Browser tabs and bookmarks read "Granular Sampler", so the app is unfindable by its actual name.

**Suggested fix**

Change the hint (and the fileLoader JSDoc) to "Load File", and set `<title>Granul8 — Granular Sampler</title>`.

---

# Appendix A — Findings raised and then rejected (5)

These were reported by a finder agent and killed by the verification pass. They are listed so nobody re-raises them.

**Documented spread-based pan variation is unreachable at the default pan of 0** — `src/audio/grainFactory.js`

> The plan sentence the finding quotes explicitly discloses the guard in the same breath: 'the explicit per-grain random pan from Voice is the primary pan value ... createGrain (which already creates a StereoPannerNode when pan ≠ 0)' (plan line 1043-1046). So there is no documentation contradiction. Skipping the StereoPannerNode when pan === 0 is a deliberate per-grain node-count optimization, and the path is reachable in the intended configuration: with Randomize Pan enabled, Voice.js:245-249 supplies a non-zero per-grain pan, at which point the spread variation applies. 'Spread alone produces no stereo movement at pan 0' is a design choice, not a defect in the code as written.

**GrainOverlay's 100-slot ring buffer holds only ~35 ms of history at high density, so the 0.5 s fade is never seen** — `src/ui/GrainOverlay.js`

> MAX_GRAINS=100 is a deliberate fixed draw-cost cap (bounded ring buffer, no leak, graceful degradation), and the stated failure is not accurate. Opacity is always scaled by `g.amplitude * 0.7` (GrainOverlay.js:64), so grains are never drawn 'all at opacity 1'; grains are also added at schedule time with `when` up to the 0.1 s look-ahead in the future and skipped while age<0 (line 52), so the buffer is not a pure history window. The 2800 grains/s figure is unreachable: MAX_POINTERS caps live pointers at 10 (PointerHandler.js:9) and 200 grains/s requires the density slider pinned to its floor. At any realistic density the retained window comfortably exceeds the 0.5 s lifespan. No defect in the code as written.

**Automation playback transport is rAF-driven while grain scheduling is setTimeout-driven: a hidden tab freezes the transport but not the audio** — `src/automation/Player.js`

> Restatement of the same defect reported by the timing-sync lens as 'Playback is rAF-driven, so a backgrounded tab drops entire loop iterations and leaves the layer permanently offset' — same file, same rAF re-arm (Player.js:314/136), same root cause and same suggested fix. The consequences described here (frozen voices droning, no stop dispatched) are a facet of that finding, which states the mechanism more precisely and at the correct severity. Keeping both would double-count.

**Metronome's beat grid diverges from MasterClock's grid as soon as BPM changes while running** — `src/audio/Metronome.js`

> Duplicate: the timing-sync lens reports the identical defect at the identical line as 'Metronome beat grid free-runs by float accumulation and is never re-derived from the clock epoch…' (Metronome.js:164 accumulator vs MasterClock's epoch-derived grid, same consequence that loop-station wraps align to the clock while the click does not, same fix). Its count-in sub-point likewise duplicates the separate 'Count-in hands off to the recorder via wall-clock setTimeout' finding. Nothing here survives that is not already covered.

**Canvas empty-state text names a button that does not exist** — `src/ui/WaveformDisplay.js`

> Duplicate. The claim is true — WaveformDisplay.js:235 says 'Load Sample' while index.html:36 reads 'Load File' — but it is entirely contained in the earlier finding 'The app's only onboarding text sits at 2.26:1 (dark) / 2.43:1 (light) and names a button that does not exist', which cites the same file, the same line, the same mismatch, and the same 'mirror the empty state into a real DOM element' fix. Two lenses reported one defect; this is the restatement with less content.

---

# Appendix B — What was checked and found clean

Verbatim notes from the finder agents. Useful mainly so these areas are not re-audited.

## Lens: `audio-correctness`

Scope: read all 26 files under src/, index.html (443 lines), style.css (1551 lines), test-modules.html, TODO.txt, agents/CLAUDE.md (329), agents/granular-sampler-implementation-plan.md (1590), agents/granular-sampler-research.md (661).

Things I checked that came back CLEAN, so nobody re-audits them:
- No empty catch blocks anywhere. All eight catch sites log via console.warn/console.error and most also surface user-visible state (src/main.js:512, 542, 593, 687, 778; src/state/SessionPersistence.js:55, 72, 106). The lens item "error handling that silently swallows" does not apply to this codebase.
- HTML defaults vs InstanceState defaults are numerically consistent, including the non-obvious ones: grainSize 0.8674 -> expMap(0.8674,1,1000) = 400.2 ms matching the hardcoded label "400 ms" (index.html:301-307 vs src/state/InstanceState.js:16-17); density 0.651 -> 100.2 ms matching "100 ms" (index.html:316-322 vs InstanceState.js:18-19). volume 0.7, envelope 'custom', pitchRange 2, arpSteps 4, subdiv 4, recordBarCount 4, mappings 'none', time sig 4/4, BPM 120, metronome 0.5, masterGain 0.7 all agree across index.html / InstanceState.js / MasterClock.js / MasterBus.js / Metronome.js. The comment "Defaults match the HTML attribute values in index.html" (InstanceState.js:2) is currently true.
- style.css has no orphan selectors for removed elements; every id/class rule I sampled resolves to live markup or a JS-toggled class. The one CSS-related doc claim that fails is `.metronome-mute-btn` (reported).
- Limiter settings in MasterBus.js:20-24 exactly match the values documented in agents/CLAUDE.md:126-131 and 304-311.
- The 'granul8' session envelope, version 2, and per-instance loopStationMode migration are internally consistent between SessionSerializer.js, InstanceState.fromJSON and InstanceManager.restoreFromSession.

Structural observation: the drift is directional. agents/CLAUDE.md is roughly two phases stale (it describes the pre-multi-instance app), the implementation plan is accurate but append-only (superseded steps 2.8a/2.8b are never retracted), and TODO.txt is stale on everything already shipped. If only one doc can be maintained, the plan is the one that tracks reality; CLAUDE.md is currently the most likely to mislead an agent because its authoritative-looking folder tree and parameter table are both wrong.

## Lens: `timing-sync`

METHOD: every timing claim was verified empirically, not just read. I ran the real `Player`, `AutomationLane`, `MasterClock` and `Metronome` modules under Node 24 (they are dependency-free ES modules) against a fake `AudioContext` whose `currentTime` I drive manually, plus a fake `requestAnimationFrame`/`setTimeout` queue. Scripts are in the scratchpad: C:\\Users\\B2CEA~1.REC\\AppData\\Local\\Temp\\claude\\c--Users-b-recoules-Documents--git-Aframe-8thwall-binary\\a8134aa0-3a9d-424d-a6a1-b039e459733c\\scratchpad\\sim.mjs, sim2.mjs, sim3.mjs. Every number quoted in the findings (0.4167 s drift over 29 wraps, 4.000 s intervals for a 3.0 s loop, 3.433 s intervals after a BPM change, 214.3 ms metronome phase error, the double `start id=2000`) is machine output, not estimated.

ROOT CAUSE, in one sentence: the project has three independent timelines that are never reconciled — (a) `MasterClock`'s epoch-relative grid, recomputed from scratch on every query, (b) `Metronome`'s free-running accumulator `_nextBeatTime += beatDur`, and (c) each `Player`'s `_startTime`, set from `audioContext.currentTime` at an arbitrary rAF instant — and the only place they meet is a single `quantizeToBar()` call at the loop wrap, which uses `Math.round` and therefore teleports rather than corrects. TODO.txt's two shaky items ("review the bpm sync accross layers", "review the loop points and the quantization so that everything stays in rythm over time") are both this.

WHAT IS *NOT* WRONG, so nobody chases it:
- Float accumulation is not a meaningful drift source here. `Metronome._nextBeatTime += getBeatDuration()` (Metronome.js:164) and `GrainScheduler.nextGrainTime += iot` (GrainScheduler.js:110) accumulate in float64; relative error is ~1e-16 per add, so after 10^5 beats the error is ~1e-11 s. The metronome's real divergence problem is that it never re-derives from the epoch after a BPM/time-signature change, not the addition itself.
- The rounding functions are unbiased. `quantizeToBar`/`quantizeToBeat` (MasterClock.js:157-172), `quantizeDurationToBar` (:180), `quantizeTimeToGrid` (musicalQuantizer.js:285) and `quantizeDensity` (:132) all use symmetric `Math.round`; none biases early or late. The early/late bias comes entirely from the wrap logic discarding overshoot.
- `Math.floor` negative handling in `quantizePitch` (musicalQuantizer.js:79) is correct, and `getEventsInRange`'s half-open `[start, end)` window (AutomationLane.js:44-53) is the right shape — it's the *reset* of `_lastProcessedTime` at the wrap that breaks the invariant, not the range function.
- The look-ahead scheduling in `GrainScheduler` and `Metronome` (100 ms ahead / 25 ms timer) is the correct Web Audio pattern and is implemented properly; audio-thread grain timing is sample-accurate. The problem is exclusively the *phase* at which those schedulers are started.

TODO.txt ITEM STATUS: "update transport bar to allow start loop point and end loop point editing" is largely implemented, not absent — `#loop-start-handle`/`#loop-end-handle` exist in index.html:135-136, the drag logic is in TransportBar.js:105-149, and `onLoopRangeChange` is wired in main.js:1198-1226. What is missing is correctness, not wiring: the fraction↔seconds domain mismatch, the per-instance/global state split, the never-called `resetLoopRange()`, and the fact that the handles operate on `Recorder.getElapsedTime()` rather than the player's own loop domain.

ORDER I WOULD FIX IN: (1) stop discarding overshoot at the wrap and make the boundary a `while` loop — this alone fixes long-term drift and the backgrounded-tab shift; (2) phase-lock `Player.play()` to the clock once and delete the per-wrap `quantizeToBar` — this fixes the teleport, the out-of-range replay, and the negative-elapsed display; (3) make the metronome derive each beat from the clock instead of accumulating, and forbid `startCountIn` from moving the epoch — this fixes cross-layer sync; (4) store loop points in bars — this fixes BPM changes and session restore. The crossfade double-dispatch (a two-line fix) is independent and can go first.

## Lens: `state-consistency`

Verified-good (no finding, worth knowing): `pointercancel` IS bound on the main canvas (PointerHandler.js:77) and on the ADSR canvas (ADSRWidget.js:39) — the classic stuck-voice-on-cancel bug is absent there; `touch-action: none` IS set on `#waveform-canvas` (style.css:377) and `#adsr-canvas` (style.css:1101), with `user-scalable=no` in the viewport meta (index.html:5), plus belt-and-braces `touchstart`/`touchmove` preventDefault (main.js:160-161) — so the mobile scroll/zoom gap the hunt list asks about is genuinely covered. There is exactly one main render rAF (started once, main.js:1333), and `Player` correctly stores and cancels its `_rafId` (Player.js:136/144-147/268) — no stacked loops. `GrainOverlay._grains` and `PointerHandler._fading` are both properly bounded/evicted. `PointerHandler.dispose()` and `ADSRWidget.dispose()` exist and are correct but are never called from anywhere; that is harmless today (both are singletons) yet it means the teardown paths are untested — `InstanceManager.removeInstance`/`restoreFromSession` do call `engine.dispose()`.

Structural observations that are not discrete bugs: (1) The player-wiring block in `InstanceManager.createInstance` (lines 61-93) is duplicated verbatim in `restoreFromSession` (lines 273-304). Any fix to the release/ghost wiring must be applied twice — this duplication is the direct cause of the ghost-release finding being easy to miss. (2) `main.js` reaches into `PointerHandler` private state twice — `pointer._fading = []` at lines 443 and 739, and `pointer.pointers.clear()` at 442/738 — bypassing the class's own release path (no `onStop` callback, no engine release beyond the manual loop above it). A `PointerHandler.reset()` method would make the tab-switch and session-import paths honest. (3) `main.js` is 1333 lines of module-level script with heavy interdependence (`persistence`, `transport`, `metronomeEnabled`, `timeSigNum` are all read by functions defined before they are initialised — `restoreLoopStationState` even carries a comment acknowledging it "must be called after an await in async init" for that reason). This ordering fragility is why the render loop having no error boundary is more dangerous than usual.

Doc drift beyond the voice-count finding: agents/CLAUDE.md:31 describes `GranularEngine.js` as "Top-level: AudioContext, master bus, limiter, voice pool", but the implementation split those apart — `MasterBus.js` owns the AudioContext/analyser/metronome and `GranularEngine` is now a per-instance subgraph (GranularEngine.js:1-2). The multi-instance/tab architecture, `MasterClock`, `Metronome`, loop-station mode and the crossfade A/B iteration scheme in `Player.js` are absent from the design docs entirely, so those docs should be treated as historical.

## Lens: `input-lifecycle`

SCOPE: read src/state/*.js, src/ui/TabBar.js, src/ui/ParameterPanel.js, src/ui/ADSRWidget.js, src/ui/TransportBar.js, src/ui/GhostRenderer.js, src/main.js, plus src/audio/{envelopes,grainFactory,Voice,GranularEngine,MasterBus,Metronome}.js, src/automation/*.js, src/input/VoiceAllocator.js, src/utils/musicalQuantizer.js, and the relevant parts of index.html and agents/CLAUDE.md.

THINGS THE LENS ASKED ABOUT THAT I CHECKED AND FOUND CLEAN — stating these explicitly so their absence is not read as an omission:

1. No shared-mutable-object aliasing between instances. Every state hand-off makes fresh objects: `ParameterPanel.getParams()` builds a new `mappings` literal (ParameterPanel.js:549-553), `ADSRWidget.getState()` returns a fresh `{a,d,s,r}` (ADSRWidget.js:249-251), `getMusicalParams()` copies the arp pattern as `{values:[...], muted:[...]}` (ParameterPanel.js:579-581), and `setFullState` copies back with `[...state.arpCustomPattern.values]` (ParameterPanel.js:662-663). The `Object.assign(current.state, fullState)` in `switchTo` (InstanceManager.js:124-125) and in `serializeSession` (SessionSerializer.js:19-21) therefore cannot alias the previous instance. `getPermutations` returns a cached array (musicalQuantizer.js:233-238) but every consumer copies it, and `applyArpType` uses `slice().reverse()` so it never mutates its input (musicalQuantizer.js:268-274). I specifically looked for the "switching tabs mutates the previous instance" bug and could not find one.

2. No per-instance event-listener leak. `TabBar.render` wipes `innerHTML` and rebuilds buttons, so listeners die with the elements (TabBar.js:29-70). `ADSRWidget` (and its ResizeObserver) is a singleton created lazily once (ParameterPanel.js:521-525). Bar-count and transport listeners are bound once at module scope. `GranularEngine.dispose()` -> `VoiceAllocator.dispose()` correctly stops and disconnects all 14 voices (VoiceAllocator.js:125-130), and `removeInstance` stops recorder + player + voices before deleting (InstanceManager.js:174-179). The only nit is that `player.onDispatch`/`onFrame` closures over the disposed engine are not nulled, but the whole entry is dropped from the Map so it is collectible.

3. TODO.txt is partly STALE — drift worth reporting upward. "adsr, volume, pan, arpegio etc. should all be customizable per instance" and "we should have a master volume per layer" are now DONE. Volume is a real per-instance `instanceGain` (GranularEngine.js:19-21, 154-159) driven from `state.volume`; ADSR flows per-grain via `params.adsr` -> `computeADSREnvelope` (grainFactory.js:81-83); pan is a per-instance min/max range; arp config is fully in `InstanceState`. The one residual global in the audio path is `envelopes.js`'s `_customADSRParams` (line 258), which every `ADSRWidget.setState`/`_sync` overwrites (ADSRWidget.js:170, 262) and which `grainFactory.js:83` still uses as the fallback whenever a grain has `envelope === 'custom'` but no `adsr`. That is reachable only for automation events recorded before the `adsr` field existed (`extractParams` adds it conditionally, Recorder.js:198); for those legacy lanes a background instance's playback picks up whatever ADSR the currently-displayed tab has. Low impact today, but it is the last true cross-instance global.

4. `InstanceState` defaults and the index.html attribute values currently agree on all 20 fields I checked (grainSize 0.8674, density 0.651, spread/pan 0, volume 0.7, envelope custom, rootNote 0, chromatic, subdiv 4, arpSteps 4, arpType straight, arpStyle 0, pitchRange 2). That agreement is load-bearing but unenforced — see the duplicated-defaults finding for why the *first* instance takes a different code path (never gets `setFullState`) from instances 2+.

5. AudioBuffers are correctly kept out of the serialized session (only `sampleUrl`/`sampleFileName`/`sampleDisplayName`, InstanceState.js:11-13), and bundled-vs-user samples are distinguished properly via `getBundledSampleUrls` (SessionSerializer.js:88-96) against the real `samples/...` option values (index.html:26). The bug there is the display-name mutation, not the buffer handling.

6. agents/CLAUDE.md drift beyond TODO.txt: line 214 specifies a `'param'` automation event type for capturing parameter changes during a recording — never implemented (no such type in Recorder.js or Player.js's dispatch switch), which is the root cause of the playback-fidelity finding. Line 229's claim that "each recording faithfully reproduces the original performance" is not true across a reload. Line 220's "synthetic pointer IDs (1000 + voiceIndex)" also predates the A/B crossfade scheme (Player.js now uses 1000 and 2000), which is what makes the unbounded voiceIndex growth a collision risk.

7. Async-init ordering was checked and is (narrowly) safe: `initializeSession()` is fired without await at main.js:699, but everything it touches before its first `await` is already defined, and the `transport`/`applyLoopStationUI`/`metronomeEnabled` references all execute after the await, i.e. after module evaluation completes. It relies on that ordering implicitly with only a comment (main.js:615) to protect it — brittle, but not currently broken.

## Lens: `cross-cutting`

Scope covered: all of src/audio/*.js read line-by-line, plus src/input/VoiceAllocator.js, src/utils/math.js, src/utils/musicalQuantizer.js, src/automation/Player.js, src/state/InstanceManager.js, and the driving code in src/main.js (param resolution at 185-318, pointer handlers 370-425, transport/loop-station 890-1290, render loop 1292-1333).

Things I specifically checked and found CLEAN (no finding raised):
- No hardcoded 44100 anywhere; the only `sampleRate` references are two console.log lines (src/main.js:510, 540). Sample-rate agnostic.
- `setValueCurveAtTime` overlap: each grain gets its own GainNode (grainFactory.js:76), so no two curves ever share a param. The `setValueAtTime(0, when)` at grainFactory.js:90 sits at exactly the curve's `startTime`, which is the one position implementations permit, so it does not throw NotSupportedError.
- Buffer overrun: `maxDuration = buffer.duration - offset` with `if (maxDuration <= 0) return` (grainFactory.js:53-54) does keep the read inside the buffer *given* the current (incorrect) duration semantics. If the pitch/duration fix from finding #1 is applied, that clamp must be re-derived against `duration * pitch`, otherwise it becomes a genuine overrun.
- Grain node cleanup: no `onended` handlers anywhere, but the fire-and-forget pattern is sound here — a finished AudioBufferSourceNode plus its downstream orphan Gain/StereoPanner have no JS references (`onGrain` is invoked synchronously and captures nothing), so they are collectable. Not a leak; it *is* a throughput concern (up to ~3 nodes × 200 grains/s × 14 voices × N tabs, with no cap on grain rate anywhere).
- AudioContext suspended-state handling is benign: `currentTime` is frozen so the scheduler's `while` loop terminates after filling one window, and those grains play correctly on resume. `masterBus.resume()` being un-awaited (src/main.js:374, 946, 973, 1034, 1166) is fine for the same reason.

Doc drift worth noting (design docs vs. implementation), none of it load-bearing enough to file as its own finding:
- agents/CLAUDE.md:124 specifies layer-1 anti-clipping as "scale amplitude by 1/sqrt(activeGrainCount)". The code instead scales by 1/sqrt(grainDuration/interOnset) — an estimate of one voice's *self*-overlap that is blind to how many voices are running (grainFactory.js:63-65). The voice count is handled separately by layer 2, so the net staging is defensible, but the doc does not describe what was built.
- src/audio/GranularEngine.js:23 comments "Voice pool (10 voices, mapped by pointer ID)"; `MAX_VOICES` is 14 (src/input/VoiceAllocator.js:9). agents/CLAUDE.md:259 says 6. Three different numbers across doc, comment, and code.
- src/audio/grainFactory.js:15 types `envelope` as `'hann'|'tukey'|'triangle'`; eight window types plus 'custom' are actually dispatched (envelopes.js:83-96).
- agents/granular-sampler-implementation-plan.md:1193 documents the metronome as "1000Hz, amplitude 0.8 / 800Hz, amplitude 0.4"; the code uses 1500Hz@1.0 with an exponential pitch drop to 900Hz, and 800Hz@0.35 (Metronome.js:180-189).

Cross-cutting theme: findings #1, #4, #5, #7, #10 and #15 are all the same class of defect — a value is computed in one time base or one code path and consumed in another without reconciliation (wall clock vs. buffer time, fixed vs. jittered inter-onset, current vs. previous automation event, three independent ADSR fractions vs. one normalized axis, panner-present vs. panner-bypassed). Fixing them piecemeal will work, but a single pass that makes `createGrain` take an explicit, fully-resolved, validated grain descriptor (wall-clock duration, buffer span, actual inter-onset used, guaranteed-finite values) would close most of them at once.
