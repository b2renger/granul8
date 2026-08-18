# Neural audio transform — design spec

**Status:** approved in principle, RAVE-first scope. Not yet planned or implemented.
**Answers:** the `generate ia audio ?` line in [TODO.txt](../TODO.txt), reframed.
**Supersedes:** the "do not ship in-browser neural audio" recommendation in
[AI-AUDIO-REVIEW.md](../AI-AUDIO-REVIEW.md) — see [What changed](#what-changed-since-the-review).

---

## The one-paragraph version

Add a **Transform** action that takes the sample currently loaded in an instance, runs it
through a neural audio model locally, and installs the result as the new sample — leaving the
original one undo away. The model is [RAVE](https://github.com/acids-ircam/RAVE) (Realtime
Audio Variational autoEncoder, IRCAM), a single ONNX graph of `audio_in → audio_out`. It runs
on onnxruntime-web's plain WASM build. Nothing touches the network at performance time. A
second backend (SNAC code-bending) is designed for but deliberately not built until RAVE has
been heard.

## Why this and not a generator

Granular synthesis is an information destroyer: the engine slices its buffer into
1–1000 ms grains at randomised position, pitch and pan and reassembles them. Melody, harmony
and structure — everything a *generative* music model's weights encode — are what the next
stage deliberately obliterates. Timbre is what survives. A model that **transforms timbre
while preserving the gesture and envelope of your own recording** is therefore the one shape
of neural audio that actually pays for itself here. That is exactly what RAVE does, and it is
why the granular/experimental community uses it rather than MusicGen.

It also composes with the other two Phase 3 sources: hum into the mic, transform it into
something else, granulate that.

## What changed since the review

[AI-AUDIO-REVIEW.md](../AI-AUDIO-REVIEW.md) §2.7 said *"There is no publicly distributed RAVE
`.onnx` checkpoint anywhere."* **That was wrong**, and the correction is the reason this
document exists.

[caillonantoine/ravejs](https://github.com/caillonantoine/ravejs) — by RAVE's own author —
has been running RAVE in a browser since 2022. It ships five ONNX models, each **exactly
19,250,870 bytes**, and processes a user-supplied file entirely locally.

What the review got right and still stands:

- The **export toolchain** is broken and stale (`rave export_onnx` crashes on a missing
  `effortless_config` import; the padding bug in RAVE issue #225 is real; the FFT noise
  synthesiser cannot be lowered to ONNX at any opset, which is why `configs/onnx.gin` forces
  v1 at quarter capacity with `use_noise = False`).
- The **identical file sizes** across all five ravejs models confirm they are exactly that
  config — so the review's architectural analysis was accurate, it just did not know someone
  had already run the export and published the artifacts.
- **Licensing is still a wall** (see [Licensing](#licensing)).

The practical consequence is large: the export problem is already solved by someone else, so
the remaining work is licensing, not licensing *plus* an unsolved PyTorch export.

---

## Architecture

### The seam

One interface, so a second backend is a drop-in and the choice is settled by ear:

```js
/**
 * A neural transform turns one AudioBuffer into another, offline.
 * Never called on the audio thread.
 *
 * @typedef {Object} NeuralTransform
 * @property {string}  id                       - stable key, e.g. 'rave'
 * @property {string}  label                    - shown in the UI
 * @property {number}  bytes                    - total download, shown BEFORE fetching
 * @property {'vendored'|'download'} delivery
 * @property {number}  maxInputSeconds          - input longer than this is rejected
 * @property {() => Promise<void>} load         - idempotent; fetch + create sessions
 * @property {(input: AudioBuffer, opts?: Object, onProgress?: (f: number) => void)
 *            => Promise<AudioBuffer>} transform
 * @property {() => void} unload                - release sessions and memory
 * @property {() => boolean} isLoaded
 */
```

Three implementations:

| id | Purpose |
|---|---|
| `passthrough` | Returns its input unchanged. Makes the entire UI, progress, undo and error path testable with **no model and no runtime** — this is what the Node tests use. |
| `rave` | The real thing. Built now. |
| `snac` | Designed, not built. See [Deferred](#deferred-snac-code-bending). |

### Where it plugs in

The output side already exists. Phase 3 Task 23 introduces `GranularEngine.adoptBuffer()` and
`adoptGeneratedBuffer(buffer, displayName)` in `main.js` for the microphone and the procedural
generator. A neural transform is a third producer through that same seam — no new install path.

```
current instance buffer
        │
        ▼
  NeuralTransform.transform()        ← offline, OfflineAudioContext-free, in a Worker if needed
        │
        ▼
  adoptGeneratedBuffer(out, label)   ← existing seam (Phase 3 Task 23)
        │
        ▼
  waveform + engine + session state
```

### Runtime: plain WASM, not WebGPU

**Decision: use `onnxruntime-web`'s plain WASM build, single-threaded.**

| | plain WASM | WebGPU (JSEP) |
|---|---:|---|
| Binary | **11.27 MB** | 22.6 MB |
| ConvTranspose1d perf | baseline | **3–5× slower** (onnxruntime #23273, M1: 6 s vs 30 s) |
| Needs COOP/COEP | no (single-threaded) | no, but threads do |
| Mobile `maxBufferSize` limit | n/a | 256 MB default on lower-end Safari |
| Availability | universal | Safari 26+, no Firefox Android/Linux |

ConvTranspose1d is the dominant operator in RAVE's upsampling path, and ORT's own WebGPU
operator docs annotate both `Conv` and `ConvTranspose` *"need perf optimization"*. Half the
payload and probably faster, on every browser, with no isolation headers. This single choice
removes the WebGPU availability problem, the mobile memory ceiling and the COOP/COEP question
together.

Revisit only if a measurement on real hardware contradicts it.

### Delivery

Per the agreed "pick per model" rule:

- **RAVE model: vendored — *once the licence permits*.** 18.4 MB sits comfortably beside the
  45 MB of samples already shipped, and vendoring is the only way "offline" is literally true:
  no first-run network, no cache eviction, works on a venue LAN and in five years.
  **During evaluation the model is NOT committed.** `models/` is git-ignored and the file is
  placed there by hand, because committing a CC BY-NC model into an MIT repo is the exact
  conflict [Licensing](#licensing) exists to resolve. Vendoring for real is contingent on
  exit 1 or 3 there. The code path is identical either way — only the `.gitignore` entry
  changes — so this costs nothing to defer.
- **ORT runtime: vendored.** `ort.wasm.bundle.min.mjs` + `ort-wasm-simd-threaded.wasm`, with
  `ort.env.wasm.wasmPaths` pointed at the local directory and `ort.env.wasm.numThreads = 1`.
  A CDN import would reintroduce a network dependency and the version-skew failure mode
  (the JS bundle and `.wasm` must be the exact same release).

Total repo growth: **~30 MB**. That is a real change to what this project is, and the README's
zero-dependency claim must be amended rather than quietly broken — see
[Documentation obligations](#documentation-obligations).

```
granul8/
  vendor/
    ort/  ort.wasm.bundle.min.mjs, ort-wasm-simd-threaded.wasm    ~11 MB
  models/
    rave/ <name>.onnx                                             18.4 MB
```

### Module layout

| File | Responsibility |
|---|---|
| `src/neural/NeuralTransform.js` | The typedef, the registry, and `passthrough`. No ORT import. |
| `src/neural/ortLoader.js` | Lazily `import()`s ORT once, sets `wasmPaths`/`numThreads`, caches the module. The **only** file that knows ORT exists. |
| `src/neural/RaveTransform.js` | Implements the interface for RAVE. Resampling, chunking, session lifecycle. |
| `src/ui/TransformPanel.js` | Model picker, size/consent, progress, cancel, errors. |

`src/neural/` is a new directory. Nothing outside it imports ORT, so removing the feature is
deleting one directory and one button.

---

## Behaviour

### The transform itself

RAVE's exported graph is **one end-to-end model**: input `audio_in`, output `audio_out`, mono.
There is no separately exposed latent, so v1 offers no latent-space knobs — the control surface
is *which model* you run your audio through.

1. **Guard.** No sample loaded, or input longer than `maxInputSeconds` → refuse with a message
   naming the limit. `maxInputSeconds = 10`, matching ravejs, which caps at
   `10 * audioCtx.sampleRate`.
2. **Downmix** to mono by averaging channels. RAVE is mono.
3. **Resample** to the model's training rate. This is a correctness point ravejs gets wrong:
   it feeds `audioCtx.sampleRate` directly, so on a 44.1 kHz context a 48 kHz-trained model is
   played ~9 % flat. Resample with an `OfflineAudioContext` at the model rate, then resample
   the output back to `masterBus.audioContext.sampleRate` before adopting. **The model's rate
   must be read from a manifest, never hardcoded** — see [Open questions](#open-questions).
4. **Run** inference in one pass. Report progress around it (the call itself is opaque).
5. **Normalise** the output to roughly the input's peak, so a transform never arrives far
   louder or quieter than what it replaced.
6. **Adopt** via `adoptGeneratedBuffer(out, \`${modelLabel} · ${sourceName}\`)`.

### Failure modes, all of which must be handled

| Condition | Behaviour |
|---|---|
| No sample loaded | Button disabled, with a title explaining why |
| Input over the cap | Refuse before loading the model; name the limit |
| Model file missing / 404 | Toast with the path; feature disables itself for the session |
| ORT fails to initialise | Toast; feature disables itself; the rest of the app is unaffected |
| Inference throws or OOMs | Toast; the previous buffer stays installed; session unchanged |
| User cancels mid-run | Previous buffer stays installed |

The instrument must remain fully usable with the entire neural subsystem broken. It is
additive, never load-bearing.

### Memory

An 18.4 MB model plus an ORT session plus a 10 s stereo buffer is not free. `unload()` must
release the session, and the panel calls it when the user closes it. Do not hold two sessions
at once.

### Undo

`adoptGeneratedBuffer` replaces the instance's buffer. The **pre-transform buffer must be
recoverable** — a transform you cannot back out of is a trap, and this one is slow enough that
losing a good sample to it would be genuinely costly.

This needs its own mechanism. Phase 2 Task 19's undo operates on `Recorder`'s
`AutomationLane` — recorded *gestures* — and has nothing to do with sample buffers; reusing
it would be a category error. Instead, keep one `AudioBuffer` reference per instance:

```js
// InstanceManager entry gains:
previousBuffer: AudioBuffer|null   // set by adoptGeneratedBuffer, cleared on sample load
```

One level is enough — this is "undo the transform I just ran", not a history stack. The
Transform panel shows a **Revert** control while `previousBuffer` is set. Buffers are large,
so hold exactly one and drop it when a sample is loaded from any other source.

### Persistence

Do **not** serialise transformed audio into the session — it is an `AudioBuffer`, and
`SessionSerializer` deliberately stores references, not samples. Store the provenance
(`{ source, modelId }`) so a restored instance can show what it was, and mark it missing the
same way a user file is. Re-running a transform on restore is not automatic: it is slow, and
silently burning CPU on load is worse than an honest "(missing)".

---

## Testing

The Node harness from Phase 1 Task 0 (`tests/fakes.mjs`, `FakeAudioContext`, `FakeTimers`)
covers everything except inference itself.

| Test | Backend |
|---|---|
| Registry lists backends; `passthrough` round-trips a buffer unchanged | `passthrough` |
| Input over `maxInputSeconds` is refused before `load()` is called | `passthrough` |
| Multi-channel input is downmixed to mono | `passthrough` |
| Output is normalised to the input's peak within tolerance | `passthrough` |
| A throwing `transform()` leaves the previous buffer installed | a stub that throws |
| `unload()` releases the session and `isLoaded()` goes false | a stub |
| `load()` is idempotent — two calls create one session | a stub |

Inference correctness itself is **verified by ear, by you**, and recorded in the evaluation
below. There is no meaningful unit test for "does this sound good."

---

## Evaluation — the actual point of building this

RAVE-first exists to answer one question: **is this worth 30 MB and a dependency?** Record the
answer rather than absorbing it.

Try each of the five models against: a bundled sample, a mic recording of your own voice, and
a procedurally generated texture. For each, note whether the output is *musically useful after
granulation* — not whether it sounds like the model's training data.

Then take one of three decisions, and write it down:

- **PROCEED** — keep it, settle the licence, amend the README.
- **PROCEED + SNAC** — RAVE is good and an editing surface is worth having too; build the
  second backend.
- **DROP** — delete `src/neural/`, keep the mic and the procedural generator, and record why so
  the question is not reopened from scratch.

## Licensing

> Not legal advice — I am not a lawyer. For anything that matters, check with someone who is.
> What follows is the reasoning and the standard practice.

### Don't relicense granul8 as CC BY-NC

The intuition "the models are NC, so the project should be NC" is natural and, I think, wrong
here. Three reasons.

**1. It does not help the models.** A licence you apply to granul8 cannot grant anyone more
rights to a RAVE-derived model than RAVE itself grants. The model files carry their own terms
no matter what the surrounding repository says. Relicensing your code buys nothing for the
thing that actually has a licence problem.

**2. It works against the musicians.** You said people will probably make music with this and
may sell it. CC BY-NC forbids use "primarily intended for or directed toward commercial
advantage or private monetary compensation." Whether selling a track made with an NC-licensed
instrument crosses that line is genuinely unsettled — Creative Commons' own FAQ describes the
NC boundary as fact-specific. So an NC licence on the app manufactures exactly the uncertainty
you don't want, for the exact people you want to support.

**3. Creative Commons recommends against CC licences for software.** Their FAQ says so
directly: CC licences don't address source vs object code, grant no patent rights, and create
compatibility problems with software licences.

### Do this instead — split the licensing

This is the standard pattern for anything that ships model weights: permissive code, models
licensed separately.

| Path | Licence | Why |
|---|---|---|
| `src/`, `index.html`, `style.css`, `tests/` | **MIT** (unchanged) | 100 % your original work. Nothing in it derives from RAVE. |
| `models/<name>/` | Each model's own terms, in a `LICENSE` beside it | Whatever the model actually carries — CC BY-NC 4.0 with attribution for RAVE-derived ones |

What this gets you:

- **"I won't sell this"** — achieved by not selling it. MIT never obliged you to.
- **"People may sell their music"** — unambiguous for anything made with the procedural
  generator, the microphone, or the user's own samples: no restriction at all. Music made
  through a RAVE NC model inherits that model's terms, which is true regardless of granul8's
  licence. The split makes the boundary *legible* instead of blanket-restricting everything.
- **Someone repackaging and selling granul8 itself** is the one thing MIT permits and NC would
  prevent. If that genuinely bothers you, the right instrument is copyleft (AGPL/GPL — still
  permits commercial use, but forces source sharing), not NC on code. Say so and I will write
  that up instead.

The README must state the split plainly rather than leaving people to work it out.

### Shipping models — what is actually permitted

You want a few models included. Here is the real position for each source:

| Source | Licence | Can you redistribute? |
|---|---|---|
| `caillonantoine/ravejs` (the 5 ONNX files) | **none** → all rights reserved | **No.** Not without permission. |
| `Intelligent-Instruments-Lab/rave-models` (HF) | CC BY-NC 4.0 | Yes with attribution — **but they are TorchScript `.ts`, not ONNX**, and re-exporting them is blocked (see below) |
| IRCAM Forum checkpoints | CC BY-NC 4.0 | Same: `.ts`, same blocker |
| A model you train | **yours** | Yes, under any terms you choose |

The blocker on re-exporting existing checkpoints is architectural, not legal:
`rave/configs/onnx.gin` forces v1 at `CAPACITY = 32` with `use_noise = False`, because the FFT
noise synthesiser cannot be lowered to ONNX at any opset. **No public checkpoint was trained
that way** — which is precisely why all five ravejs models are byte-identical in size
(19,250,870). They were each trained *specifically* for ONNX export. An existing v2/v3
checkpoint cannot simply be converted.

So there are exactly two routes to shipping models:

1. **Ask Antoine Caillon for permission** to redistribute the five ravejs ONNX files under
   CC BY-NC 4.0 with attribution. He wrote both RAVE and ravejs, he is an academic, and the
   request is modest and in the spirit of the work. This is cheap, fast, and likely to succeed —
   **do this first.** If he agrees, put his terms in `models/LICENSE` and credit him in the UI
   next to the Free Music Archive credit that already exists.
2. **Train your own** — see [Appendix: training a custom model](#appendix-training-a-custom-model-for-granul8).
   Slower, but the models are then unambiguously yours, and the timbre is yours rather than a
   stranger's dog recordings.

Until route 1 or 2 lands, `models/` stays git-ignored and local, and the work is
non-commercial evaluation.

## Documentation obligations

If the decision is PROCEED, the README's opening claim — *"Zero dependencies. No build step."* —
becomes false as written and must be amended honestly, e.g.:

> The instrument core has zero dependencies and no build step. The optional neural transform
> vendors onnxruntime-web (~11 MB) and one RAVE model (~18 MB); it is lazily loaded and the
> app is fully functional without it.

Do not quietly leave the old claim standing.

---

## Deferred: SNAC code-bending

Designed, not built. Revisit after the RAVE evaluation.

[transformers.js #1251](https://github.com/huggingface/transformers.js/pull/1251) added
`SnacModel` with both `.encode()` and `.decode()`, and
[onnx-community/snac_24khz-ONNX](https://huggingface.co/onnx-community/snac_24khz-ONNX) ships
both halves: encoder fp16 **13.9 MB** + decoder fp16 **26.3 MB** (encoder int8 is 7.57 MB).
MIT throughout. The 44 kHz variant is 32.7 + 77.1 = ~110 MB — too big.

It is a genuinely different instrument from RAVE: encoding exposes **discrete codes you can
edit** — drop residual stages for graded lo-fi, shuffle codes in time, interpolate two samples'
codes. RAVE gives you a timbre; SNAC gives you an editing surface.

Two honest caveats. Output is **24 kHz — a hard 12 kHz ceiling**, an audible timbral loss on a
granular instrument. And nobody has shipped this as an instrument, so it may read as artefacts
rather than music. That is precisely why it waits behind a RAVE result: it fits the same seam,
so building it later costs nothing extra.

Note this is **not** the discredited idea from AI-AUDIO-REVIEW §2.1. Feeding *random* codes to
an RVQ decoder produces broadband hash — that criticism stands. Perturbing *real* codes derived
from *real* audio is a different regime, and it is the one worth trying.

---

## Open questions

Settle these during planning, not implementation:

1. **What sample rate were the ravejs models trained at?** Not stated in the repo. Determine it
   before writing the resampling step — read the ONNX graph's input shape, or test empirically
   by round-tripping a known tone and measuring pitch drift. Everything in step 3 above depends
   on it, and getting it wrong pitch-shifts every result.
2. **Is 10 s the right cap?** Inherited from ravejs. Measure actual inference time on target
   hardware first; the cap should be driven by wall-clock patience, not copied.
3. **Worker or main thread?** A multi-second synchronous inference freezes the UI and the
   render loop. If measured time exceeds ~200 ms, it belongs in a Worker — which complicates
   ORT setup. Measure before deciding.
4. **Which of the five models ship?** All five is 92 MB. Probably one or two, chosen by ear
   during evaluation.

## Appendix: training a custom model for granul8

Everything here is verified against RAVE's current README and its `rave/configs/` directory.
The single most important instruction is in step 3 — **get the config wrong and the export
simply cannot work**, no matter how good the model sounds.

### What you need

- An NVIDIA GPU. This is not practical on CPU. A free Colab tier works for small models;
  community training notebooks exist (e.g. `devstermarts/Notebooks`,
  `RAVE_Training_Template--Colab.ipynb`).
- **Audio.** RAVE needs at least 128 batches to compute its internal latent PCA, so a handful
  of files will fail outright. Practically: an hour is a bare minimum, several hours is
  comfortable. It does **not** need to be musical — field recordings, one instrument, one
  voice, machine noise all work. Coherent material gives a more characterful model than a
  varied one.
- Patience. Days, not hours, for a model you would keep.

### 1. Install

```bash
# Install torch/torchaudio FIRST so you control the CUDA build
pip install torch torchaudio
pip install acids-rave
conda install ffmpeg          # or any system ffmpeg on PATH

# NOT in requirements.txt, and `rave export_onnx` crashes on import without it
pip install effortless-config
```

### 2. Preprocess

```bash
rave preprocess \
  --input_path /path/to/your/audio \
  --output_path /path/to/dataset \
  --channels 1
```

`--channels 1` — mono. The ONNX export path is mono, so do not train in stereo.

If preprocessing stalls, your files are shorter than the analysis window: lower
`--num_signal`. Add `--lazy` to train straight from mp3/ogg without converting, at a
significant CPU cost during training.

### 3. Train — the config is the whole ballgame

```bash
rave train \
  --config onnx \
  --db_path /path/to/dataset \
  --out_path /path/to/runs \
  --name my_model \
  --channels 1
```

**Use `--config onnx`. Not `v2`, not `v3`, not `v2_small`.**

`rave/configs/onnx.gin` is, in its entirety: `include "configs/v1.gin"`, `CAPACITY = 32`,
`blocks.Generator.use_noise = False`. Every part of that matters:

- **`use_noise = False`** — RAVE's noise synthesiser calls `torch.fft.rfft`/`irfft`, and
  `torch.onnx.export` cannot lower those at any opset (pytorch #112382, #129331, #149276).
  A model trained with noise **cannot be exported to ONNX at all.** This is the reason you
  cannot simply convert an existing pretrained checkpoint.
- **v1 at `CAPACITY = 32`** — quarter capacity. Smaller and less hi-fi than v2, and that is the
  trade being made in exchange for a graph that exports.

**Do not pass `--streaming`.** Cached convolutions hold mutable in-place state that has no ONNX
representation. Streaming is for `nn~` in Max/PD, not for this.

Training runs in two phases: representation learning, then adversarial. The default schedule is
long (millions of steps); a model with usable *character* often arrives well before a model
with good *fidelity*. For a granular sampler, which is going to shred the output anyway,
"characterful" is the target — check in early and often rather than waiting for convergence.

Monitor with `tensorboard --logdir /path/to/runs`.

### 4. Export

```bash
rave export_onnx --run /path/to/runs/my_model
```

Two known problems in `scripts/export_onnx.py`, which was last touched in **August 2023** and
is unmaintained relative to the rest of the repo:

1. **Missing dependency** — the `effortless_config` import, installed in step 1.
2. **The padding bug.** `cached_conv`'s `Conv1d` applies an *asymmetric* `(left, right)` pad,
   but the export script passes only `child._pad[0]` to `nn.Conv1d`, which applies it
   *symmetrically*. Output lengths then drift and the residual adds throw
   `RuntimeError: The size of tensor a (54) must match the size of tensor b (52)`. This is
   RAVE issue #225, closed with no maintainer fix. If you hit it, patch the script to emit an
   asymmetric `nn.functional.pad` (or an ONNX `Pad` node) instead of a symmetric convolution
   padding.

### 5. Verify before wiring it in

**Check the file size first.** A correct `onnx.gin` export lands around **18–19 MB** — all five
ravejs models are exactly 19,250,870 bytes. If yours is dramatically larger, you trained with
the wrong config and it will not load or will not sound right. This is the cheapest possible
sanity check; do it before anything else.

Then confirm the graph shape: one input `audio_in`, one output `audio_out`, both mono. That is
what `RaveTransform` expects.

Finally, **record the training sample rate** in a manifest beside the model:

```json
{ "id": "my_model", "label": "My Model", "sampleRate": 48000,
  "bytes": 19250870, "license": "...", "attribution": "..." }
```

This is [Open question 1](#open-questions) and it matters: `RaveTransform` resamples the input
to the model's rate, and guessing wrong pitch-shifts every result. ravejs gets this wrong — it
feeds `audioCtx.sampleRate` straight in, so a 48 kHz-trained model on a 44.1 kHz context plays
about 9 % flat. Do not copy that.

### 6. Install it

Drop the `.onnx` and its manifest into `models/<name>/` and restart. No build step.

### If you only want to hear whether this is worth it

Training is a days-long commitment to answer a question you can answer in an afternoon. Do the
[evaluation](#evaluation--the-actual-point-of-building-this) with the existing ravejs models
locally first — that is non-commercial research and needs nobody's permission. Train only once
you know the answer is yes.

## Non-goals

- **Realtime / streaming transformation.** The exportable graph is non-streaming; cached
  convolutions have no ONNX representation. Offline batch only.
- **Latent-space performance controls.** The graph exposes no latent. Would need a different export.
- **Any network call at performance time.** Permanently out of scope.
- **Text-prompted generation.** No offline model does this at a viable size.
- **Mobile support for this feature.** Desktop-gated. The rest of the instrument stays
  touch-first; this is the one feature that is not.
