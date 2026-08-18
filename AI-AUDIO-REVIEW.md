# Critical feedback: client-side AI audio generation for Granul8

A review of the proposal to add local, client-side neural audio generation (RAVE / DAC /
EnCodec / Kokoro / Magenta) as a sample source for the granular engine.

> **Method.** Three research agents verified the proposal's claims against primary sources
> in August 2026 — repository source, npm and Hugging Face file listings with byte counts,
> live HTTP HEAD requests and CORS preflights, GitHub issue threads, and the RAVE paper
> itself. Every size, price and date below is measured or cited, not recalled. Where the
> proposal and the evidence disagree, the evidence is quoted.

---

## Verdict

**Don't ship in-browser neural generation. Three of the four things it was reaching for are
available at zero bytes, and one of them is already the line above it in TODO.txt.**

The proposal is a competent survey of the model landscape and it is right that the browser
runtime story has matured. But it evaluates the models and never evaluates *this project*,
and on the two constraints that actually decide the question — the zero-dependency promise
and the mobile-first tagline — every option in it fails. It also contains one recommendation
that is conceptually wrong (feeding random latents to a codec decoder), one that is dead
infrastructure (Magenta as the "easy start"), and one whose headline speed number does not
mean what it appears to mean (RAVE's 20× realtime).

---

## 1. What the proposal gets right

Credit where it is due, because these are the parts most people get wrong:

- **The Float32Array hand-off is genuinely trivial**, and worrying about it was reasonable.
  `pipeline('text-to-speech', …)` really does return
  `RawAudio { audio: Float32Array, sampling_rate: Number }` — verified in
  `packages/transformers/src/pipelines/text-to-audio.js`. `createBuffer` + `copyToChannel`
  is exactly right.
- **The package name is correct.** `@huggingface/transformers` (latest 4.2.0, 2026-04-22),
  not the superseded `@xenova/transformers`.
- **No-build CDN loading really does work** — for transformers.js. `import { pipeline } from
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0'` returns 200 with
  `ACAO: *`. WASM MIME types and CORS are a solved problem; the CDN serves
  `Content-Type: application/wasm` with `ACAO: *` and `Cross-Origin-Resource-Policy:
  cross-origin`.
- **The COOP/COEP fear is overstated**, which the proposal implicitly gets right by not
  raising it. Cross-origin isolation is only needed for *threaded* WASM. Single-threaded
  runs on any static host — about 2–4× slower, but it runs.
- **RAVE is the right model family to have thought of.** Latent-space timbre morphing is
  genuinely the most musically interesting fit for a granular instrument. The problem is
  availability, not taste.

---

## 2. What is factually wrong

### 2.1 "Feed synthetic latent arrays into a DAC/EnCodec decoder" — the input isn't latents

This is the proposal's central technical error and it is worth being precise about.

The `onnx-community/dac_44khz-ONNX` decoder graph bakes `quantizer.from_codes()` *inside*
it. Its input is `audio_codes`: **int64, shape `(batch, 9, time_steps)`, values 0–1023**.
Those are RVQ codebook *indices*, not a continuous latent space. You cannot "generate random
points in latent space and interpolate between them" — there is no latent space exposed, and
integers do not interpolate meaningfully.

Nothing crashes if you feed random integers; the export script's own dummy input is
`torch.randint(1024, (4, 9, 100))`. But the one paper that measures this directly
(arXiv 2509.09550) bit-flips EnCodec and DAC token indices at rates from 0.1% to 50% and
finds that *"RVQ codecs experience a sharp decline once more than 1% of bits are altered"*,
because *"perturbing their code indices can result in arbitrarily-sized changes in the
embedding space."* Fifty percent is effectively random.

What actually comes out is not silence and not NaN — it is an adversarially-trained deconv
stack, so it always emits a bandlimited, spectrally-coloured waveform. With independent
random codes per frame the latent jumps discontinuously at the frame rate (hop 512 @ 44.1 kHz
= 86.13 frames/sec), which reads as **a monotonous broadband hash with an audible 86 Hz
pulse**. Not "novel, glitchy, structured sound clips."

There is a version of this idea that might work — freeze codebook 0, random-walk the indices
with temporal smoothing, randomise only residual stages 3–8 — but there is **no published
recipe and zero prior browser art**. That is a multi-week research spike with a real chance
of producing nothing musical, not a feature you can scope.

**And if the goal is genuinely "random vector in, novel timbre out," there is a model whose
designed contract is exactly that: GANSynth.** For a GAN, a random latent is the intended
input rather than an abuse of the model. See §6.

### 2.2 EnCodec cannot be run in the browser at all

Two independent blockers: transformers.js ships
`packages/transformers/src/models/encodec/feature_extraction_encodec.js` and **no
`modeling_encodec.js`** — there is no `EncodecModel` class, so the library cannot execute it.
And no maintained ONNX export exists on the Hub (`facebookresearch/encodec` #76 and
`huggingface/transformers` #27602 are both about ONNX export failing; the repo last shipped
2024-01-04). Producing one requires a PyTorch export pipeline — precisely the build step this
project forbids.

### 2.3 DAC cannot be shrunk, and the proposal's "FP16" suggestion is the floor, not a win

Exact bytes from `onnx-community/dac_44khz-ONNX`:

| dtype | size | note |
|---|---:|---|
| fp32 | 207.1 MB | |
| **fp16** | **103.6 MB** | the floor |
| int8 | 121.4 MB | **larger than fp16** |
| q4 | 207.1 MB | **literally zero reduction** |

int4/int8 tooling only quantizes MatMul/Gemm, and DAC's decoder is pure
Conv1d/ConvTranspose1d. There is no quantization win available. "Convert to ONNX FP16" is the
best case, and it is 103.6 MB for a decoder alone.

The proposal also missed **SNAC** (`onnx-community/snac_24khz-ONNX`), which is the strongest
option in this category: 50.2 MB fp32 / **25.1 MB fp16**, MIT licensed, and *actually
supported* — `modeling_snac.js` exists with `SnacDecoderModel.from_pretrained` and
`.decode() → {audio_values: Tensor}`. Four times smaller than DAC fp16.

### 2.4 Kokoro is not reachable through the API in the snippet

The code sample does not work. **There is no `kokoro` model directory in transformers.js.**
`packages/transformers/src/models/` contains `dac`, `snac`, `speecht5`, `supertonic`, `vits`
— and nothing else. `TextToAudioPipeline._call` branches exactly three ways: processor-based
(SpeechT5), `model_type === 'supertonic'`, and text-to-waveform (VITS/MMS). Kokoro is a
StyleTTS2 derivative requiring external phonemization and is only reachable through the
separate `kokoro-js` package.

And `kokoro-js` is not a healthy dependency: **latest 1.2.1, published 2025-05-03** — 15
months stale — pinned to `@huggingface/transformers ^3.5.1`, so it will never resolve to the
current 4.2.0 line. You would be adopting an abandoned wrapper two major versions behind.

Also: **`device: 'webgpu'` is not production-ready for Kokoro.** `hexgrad/kokoro` #98
("produced audio is distorted and unusable", open since Feb 2025), #275 ("serious memory
leak … when using WebGPU", open since Nov 2025), #193 (corrupted audio on Chrome/Android).
There is no documented automatic fallback — you pick the device and live with it.

### 2.5 "82M parameters" is not a size

`onnx-community/Kokoro-82M-v1.0-ONNX` on disk: fp32 **310.4 MB**, fp16 155.7 MB, q8 88.1 MB,
q8f16 **82.0 MB** (smallest), q4 291.1 MB (barely helps — conv-heavy graph). Plus 510 KB per
voice pack. Output is 24 kHz, not 44.1. Apache-2.0, commercial use explicitly welcomed — the
licensing is the one genuinely good thing here.

Realistic Kokoro first-load: transformers.js 0.41 + ORT WASM 11.3 + model 82.0 + voice 0.5 +
kokoro-js 2.0 + phonemizer/espeak ~2.7 ≈ **99 MB uncompressed**, ~45–55 MB over the wire.

### 2.6 The model file is not the main download

**Nobody budgets the runtime.** `ort-wasm-simd-threaded.wasm` is **11.27 MB**; the
WebGPU-capable JSEP build — the one the proposal's `executionProviders: ['webgpu', 'wasm']`
requires — is **22.6–26.8 MB** raw (~5.2 MB Brotli). It is fetched at runtime on first
inference. The WebGPU EP is JSEP, a hybrid C++/TS provider that still needs the full WASM
binary for the graph partitioner, optimisers and CPU fallback kernels. There is no
"WebGPU-only, skip the WASM" path.

`transformers.web.min.js` itself is 0.41 MB — trivial by comparison, and the only number
anyone ever quotes.

### 2.7 RAVE: the artifact you need does not exist

This is the most important correction, because RAVE is the proposal's top recommendation.

**There is no publicly distributed RAVE `.onnx` checkpoint anywhere.** The Hugging Face
`Intelligent-Instruments-Lab/rave-models` file list contains **zero** `.onnx` files. Every
IRCAM Forum download returns TorchScript — including, delightfully, the one called
`darbouka_onnx`, whose `Content-Disposition` is `darbouka_onnx.ts`. The name is a legacy
artifact of having been *trained* with the `onnx.gin` config, then exported to TorchScript
like everything else.

"Export the decoder part to `.onnx`" is one bullet in the proposal. Here is what it actually
requires:

| Claim | Reality |
|---|---|
| `rave export_onnx` exists | It does — and **crashes on import**. Its 4th line is `from effortless_config import Config`; `effortless-config` is not in `requirements.txt`. Last touched 2023-08-16 while the repo is actively pushed as of 2026-03-07. |
| It exports a decoder | **It exports the full autoencoder.** `torch.onnx.export(pretrained, x, input_names=['audio_in'], output_names=['audio_out'])`. No latent input, no decode entry point. Getting `latent → audio` means writing your own exporter around `rave/model.py:260`. |
| Padding works | **Confirmed bug.** `cached_conv`'s `Conv1d` applies an *asymmetric* `(left, right)` pad; the export script passes `child._pad[0]` to `nn.Conv1d`, which applies it *symmetrically*. Output length drifts whenever `p_left ≠ p_right`. This exactly reproduces RAVE issue #225 — closed with no maintainer reply. |
| Streaming works | **Impossible in ONNX.** `CachedConv1d`/`CachedConvTranspose1d` hold mutable in-place state buffers with no ONNX representation, and the export script does not even match those classes. RAVE's own README: without streaming *"you will hear clicking artifacts."* |
| Snake activations break it | **False, and this one's in RAVE's favour** — Snake is opt-in (v3 only); every default activation is `LeakyReLU(.2)`. Snake decomposes to Sin/Pow/Div/Mul/Add, all on the WebGPU op list. Non-issue. |
| The noise synthesiser | **Cannot be exported at any opset.** `NoiseGenerator` calls `fft.irfft`/`fft.rfft`; `torch.onnx` cannot lower `aten::fft_rfft` (pytorch #112382, #129331, #149276). **Smoking gun:** RAVE ships `rave/configs/onnx.gin` whose entire body is `include "configs/v1.gin"; CAPACITY = 32; blocks.Generator.use_noise = False`. The official ONNX config is v1-only, quarter-capacity, and noiseless. |

And the kicker: **no released checkpoint was trained with `use_noise=False`**, so the ONNX
path most likely means **retraining a RAVE model from scratch** — days to weeks of GPU time.
That is the actual project, and it dwarfs the JS integration.

Finally, licensing: `acids-ircam/RAVE` is **CC BY-NC 4.0**, and the HF checkpoint collection
declares `cc-by-nc-4.0`. NonCommercial + attribution. Redistributing a ~90 MB NonCommercial
model as a static asset from a public site is a legal decision, not a technical one. (Note
`setup.py` carries a misleading `MIT License` classifier — do not rely on it.)

### 2.8 "20×+ realtime on standard CPUs" does not transfer

It is a real published number — arXiv 2111.05011 Table 2, 985 kHz on CPU = 20.5× realtime at
48 kHz. Every qualifier the headline drops matters:

- It is RAVE **v1** (17.6M params), not the v2/v3 architecture every public checkpoint uses.
- It is **decoder-only from pre-computed latents**, measured offline, batched, non-streaming,
  on **native libtorch/MKL, multithreaded**.
- The CPU is described only as "a standard laptop CPU."
- **The same table shows "RAVE w/o multiband: 38 kHz" = 0.79× realtime — slower than
  realtime.** The entire 26× speedup comes from the 16-band PQMF decomposition. Any web port
  that drops or naively reimplements the inverse PQMF forfeits all of it.

It is not evidence about browser performance and should not be used to justify the
integration.

### 2.9 WebGPU is not reliably faster — for *this* op mix it is often slower

The proposal treats WebGPU as the enabling technology. For conv-heavy audio decoders that is
not established:

- `microsoft/onnxruntime` **#23273 — "[js/webgpu] ConvTranspose1D slower on WebGPU than
  Wasm"**: on an M1 MacBook Pro, **WASM 6 s vs WebGPU 30 s** (18 s on Canary). That is 3–5×
  *slower*, on the exact operator class that dominates a RAVE or DAC decoder's upsampling
  path.
- **#27809** (2026-03): "CPU EP is 4X faster than WebGPU EP" on an audio model.
- ORT's own WebGPU operator doc marks both `Conv` and `ConvTranspose` as supported but
  annotated *"need perf optimization; need implementing activation."*

WebGPU is plausible for these workloads but must be benchmarked, not assumed — and you need a
WASM fallback regardless.

### 2.10 Magenta as the "easy start" is backwards — it is the highest-risk option

The proposal lists Magenta.js / DDSP.js as the low-effort on-ramp. It is abandoned
infrastructure:

- `@magenta/music` **latest 1.23.1, published 2021-11-01** — no release in ~4.75 years. Last
  substantive commit 2024-03-25; nothing real since 2021. 136 open issues.
- Its dependency is `@tensorflow/tfjs: ^2.7.0`. tfjs 2.x is from 2020 and the caret range can
  **never** resolve to current 4.x/5.x.
- The Python `magenta/magenta` repo was **archived read-only in January 2026**.
- **`@magenta/ddsp` on npm is a hard 404.** DDSP ships *inside* `@magenta/music` as a module
  plus a demo — it was never its own library. And it is tone *transfer*: it needs an input
  melody. **It is not a generator**, which is what the proposal wanted it for.

Search engines report Magenta as maintained because they read GitHub's `pushed_at` field.
They are wrong.

The checkpoints *are* still live (DDSP violin: 381 KB `model.json` + ~3.9 MB weights;
GANSynth: 27.9 MB across 7 shards) — but they are hosted by a team whose parent repo was
archived, and nobody is committed to serving them.

---

## 3. The code snippet has seven bugs

```js
import * as ort from 'onnxruntime-web/webgpu';
const audioCtx = new AudioContext();                       // ← 2

async function generateSampleBuffer(latentTensor) {        // ← 6
  const session = await ort.InferenceSession.create(       // ← 1
    './rave_decoder.onnx',
    { executionProviders: ['webgpu', 'wasm'] });           // ← 4
  const results = await session.run({ latent_input: latentTensor });
  const audioData = results.audio_output.data;             // ← 5
  const sampleRate = 44100;                                // ← 3
  const buffer = audioCtx.createBuffer(1, audioData.length, sampleRate);
  buffer.copyToChannel(audioData, 0);
  return buffer;                                           // ← 7
}
```

1. **The session is created inside the per-call function.** Model load and shader compilation
   are the expensive part — hundreds of ms to seconds. This re-downloads and re-JITs the
   entire model on every button press. Hoist it and cache it.
2. **`new AudioContext()` at module scope.** This project has exactly one `AudioContext`, in
   [MasterBus.js:10](src/audio/MasterBus.js#L10), behind a deliberate unlock overlay. A second
   context opens a second hardware stream, will be born `suspended` on iOS, and its buffers
   are **not** interchangeable with the first one's in every engine path. Use
   `masterBus.audioContext`.
3. **Hardcoded 44100.** RAVE is 44.1/48 kHz, Kokoro is **24 kHz**, SNAC 24 kHz, GANSynth
   **16 kHz**, MMS 16 kHz. Sample-rate mismatch is the norm here, not the exception. Use the
   model's real rate — `createBuffer` with 24 kHz against a 48 kHz context is legal and
   resamples on playback, but declaring 44100 for 24 kHz data pitches it up a fifth. (Note
   the existing codebase is scrupulously sample-rate-agnostic; this would be the first
   hardcoded rate in it.)
4. **Missing `ort.env.wasm.wasmPaths` — this one fails late and looks like it works.**
   Verified 2026-08-15: both `cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/+esm` and
   `esm.sh/onnxruntime-web@1.23.2` preserve `import.meta.url` and still contain the literal
   `ort-wasm-simd-threaded.jsep.mjs`, so the sidecar lookups resolve to the wrong directory
   and **404**. The `import` succeeds. `InferenceSession.create()` is where it dies. The
   mandatory incantation is to import from `/dist/*.bundle.min.mjs` *and* set
   `ort.env.wasm.wasmPaths` to the matching `/dist/` URL — at the exact same version, or
   initialisation fails on minified-name mismatch.
5. **`results.audio_output.data`** — output names are per-model, not a convention. You have to
   read them off the graph.
6. **`latentTensor` is passed in but never constructed.** The elided part is the hard part:
   what shape, what dtype, what distribution. For DAC it is int64 codes; for RAVE it is a
   float latent whose dimensionality depends on the checkpoint; for GANSynth it is a
   normally-distributed z. "Create random points in latent space" is doing enormous work in
   that sentence.
7. **No progress, no cancel, no error path, no cache-hit detection.** For a 100–650 MB
   download on a music toy, that *is* the feature. The MusicGen demo's loading UI is most of
   its code.

One thing the snippet gets exactly right: `createBuffer` + `copyToChannel` is the correct
hand-off, and it lands cleanly on this codebase's existing seam. The buffer would go through
something like a new `GranularEngine.adoptBuffer(buffer)` beside
[`_decodeAndStore`](src/audio/GranularEngine.js#L73), then
`instanceManager.setActiveSample(...)` + `waveform.setBuffer(...)` — the same three calls
[`handleFile`](src/main.js#L502) already makes. That plumbing is ~10 lines and is not the
problem.

---

## 4. The constraint the proposal never mentions

Granul8's README opens with: *"Zero dependencies. No build step. No npm, no bundler, no
framework."* `index.html` has exactly one script tag. There is no `package.json`. The entire
JS payload is ~130 KB.

**"No build step" survives.** CDN ESM import genuinely works — that part of the proposal is
sound.

**"Zero dependencies" does not.** It is violated by definition the moment you import any of
this, and the numbers are not close:

| | Bytes |
|---|---:|
| Granul8's entire JS source | ~130 KB |
| onnxruntime-web JSEP WASM runtime | 22.6–26.8 MB |
| Kokoro q8f16 + voice + wrapper + phonemizer | ~99 MB |
| MusicGen-small via transformers.js | **656 MB** (the demo's own loading UI) |

You would also inherit a version-locked `(transformers.js, onnxruntime-web)` pair that has
already shipped one breaking regression — `huggingface/transformers.js` **#1527**, where the
library unconditionally set `wasmPaths` to a CDN and produced `Failed to construct 'Worker'`
CORS errors, because a Worker script cannot be constructed from a foreign origin. That is the
class of breakage that costs a day and reappears on every version bump.

And for a project whose samples are curated from the Free Music Archive and whose whole
posture is "a folder of files you can serve anywhere," a hard runtime dependency on jsDelivr
and `huggingface.co/resolve` staying up is a real archival concern.

### The mobile wall is absolute

The splash screen says *"for the web and multitouch devices."* That tagline and in-browser
neural generation are **mutually exclusive in 2026**:

- **Memory.** Measured iOS 26.2 page-crash thresholds are ~**100 MB** on an iPhone SE 3rd gen
  and ~**200 MB** on an 8th-gen iPad — the page is killed by WebKit's `MemoryPressureHandler`
  and Jetsam. Against a 656 MB model (or even a 99 MB Kokoro) *plus* a 23 MB WASM runtime
  *plus* the granular engine's decoded AudioBuffers. Even flagship iPhones sit far below what
  MusicGen needs.
- **WebGPU buffer limits.** Safari's Metal backend defaults to a **256 MB `maxBufferSize`** on
  lower-end devices, producing *"Binding size is larger than the maximum binding size"* for
  larger weight tensors.
- **WebGPU availability** is 85.56% globally, but: Safari only on **macOS/iOS/iPadOS 26+**
  (and caniuse still flags it *partial*); Chrome Android only on Android 12+ with
  Qualcomm/ARM GPUs; **no Firefox on Android, none on Linux**. For a touch-first toy the
  honest planning number is well under the headline.
- **Cache eviction is worst exactly here.** Safari with cross-site tracking prevention
  **proactively deletes script-created storage (Cache API included) for any origin with no
  user click in the last 7 days of browser use**. A music toy is by definition intermittently
  used. `navigator.storage.persist()` exempts you, but WebKit grants it on heuristics that
  favour Home Screen web apps, not plain tabs. So your iOS users may re-download hundreds of
  megabytes **every week or two**.

Realistic cold start for 656 MB: ~52 s at 100 Mbps, ~3.5 min at 25 Mbps typical LTE, ~8.7 min
at 10 Mbps.

---

## 5. The argument nobody in the proposal makes: granular synthesis destroys what these models produce

This is the one I would weigh most heavily.

Read what this engine does to a buffer. [`GrainScheduler`](src/audio/GrainScheduler.js) fires
grains every 5–500 ms. [`grainFactory`](src/audio/grainFactory.js) slices 1–1000 ms at a
randomised position with randomised spread, repitches by up to ±2 octaves per grain, and pans
each one randomly. The arpeggiator reassigns every grain's pitch from a scale table.

Melody, harmony, phrase structure, coherence over seconds — **the exact properties a
generative music model's weights encode** — do not survive that. They are what the next
processing stage is explicitly designed to obliterate. What a granular engine is hungry for is
*timbre and texture*: spectral density, inharmonicity, evolving noise. That is the one thing
a 656 MB music model is not optimised to deliver, and the one thing you can synthesise
procedurally for free.

Spending 656 MB and the mobile platform to obtain source material that the engine will render
unrecognisable is the worst bytes-to-new-capability ratio on the table.

---

## 6. What I would actually build, in order

### 1. Microphone recording — the line directly above "generate ia audio ?" in TODO.txt

Zero bytes, zero latency, the user owns the audio, no licence question, works on every device
the app already supports. It converts a fixed list of nine samples into an **unbounded personal
sound source** — which is most of what "AI audio" was really reaching for.

```js
const stream = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
});
```

Skip `MediaRecorder` entirely — you want raw Float32 frames, not encoded blobs, and the engine
already consumes `AudioBuffer`s. Capture through an `AudioWorklet` or `ScriptProcessor` tap
into a growing Float32Array, then hand it to the same seam
[`handleFile`](src/main.js#L502) uses. HTTPS and the user gesture are already satisfied by the
existing "Tap to start" overlay. **A day or two of work.**

### 2. A procedural texture generator — the honest answer to "generate audio"

`src/audio/TextureSynth.js`: render into an `OfflineAudioContext` and return an `AudioBuffer`.
Noise buffers + `BiquadFilterNode` sweeps + FM by routing an oscillator into a
`frequency` AudioParam + a `ConvolverNode` against a synthesised decaying-noise impulse. Drive
it from a handful of macro sliders and a seed.

~200–400 lines, zero dependencies, zero bytes over the wire, works offline, works on every
device, and **the seed serialises cleanly into the existing session JSON** — which the 656 MB
option can never do. Granular processing flatters filtered noise and inharmonic drones far
more than it flatters a generated music bed. This is the highest-value item in this document
relative to its cost.

### 3. Freesound search — the "infinite sample library"

Verified live: `freesound.org/apiv2` sends `Access-Control-Allow-Origin: *` on both search and
preflight, and the preview CDN sends `ACAO: *` plus `Access-Control-Expose-Headers:
Content-Length,Content-Range` — so previews are `fetch`-able and `decodeAudioData`-able. Token
auth is enough (OAuth2 only for original-quality downloads). 60 req/min, 2000 req/day.

Human-recorded material is *better grain fodder* than anything MusicGen produces. Cost: a
search field, a results list, a preview-then-load flow, and a per-sample attribution record
threaded through `SessionSerializer`. The attribution pattern already exists — the unlock
overlay credits the Free Music Archive.

### 4. If you want a text prompt box, make it bring-your-own-key and server-side

Both endpoints are CORS-open (preflights verified 2026-08-15), so a static page can call them
with no backend:

| Service | Endpoint | Price |
|---|---|---|
| ElevenLabs SFX | `POST /v1/sound-generation` | **~$0.0194 per effect**, flat, any length; free tier 10k credits/mo |
| Stability | `/v2beta/audio/stable-audio-2/text-to-audio` | ~$0.20 per clip (20 credits) |

**ElevenLabs' *sound effects* endpoint is a far better match for a grain engine than any music
model** — it produces exactly the textural material the engine wants. Store the user's own key
in `localStorage`, label it as optional and network-dependent, and never ship a key of your
own. This delivers everything the in-browser route promised — text prompt in, novel audio out
— at **0 bytes, on every device including phones**, at 2–20 s latency. The tradeoffs are real
and should be stated in the UI: it costs the user money, and it breaks on a school LAN with no
internet.

---

## 7. If you insist on a local neural model, there is exactly one defensible option

**GANSynth**, and it is in far better shape than the proposal assumed — it dismissed the
Magenta family wholesale and this is the one piece worth keeping.

- **It is a GAN**, so a random latent vector is the *designed* input contract — not an abuse
  of the model, which is precisely what the DAC/EnCodec idea gets wrong.
- Checkpoint is live and small: **27.9 MB** across 7 shards.
- `@magenta/music` ships `dist/magentamusic.js`, a **2.38 MB UMD bundle with tfjs baked in**,
  usable from a plain `<script>` tag. **No ORT WASM, no ESM plumbing, no build step.**
- Total ~30 MB versus ~115 MB for DAC — byte-for-byte the cheapest way to get a neural
  generator into this project.
- Apache-2.0. 4 seconds at 16 kHz per note.

The honest risk is that its bundled tfjs is 2.7 from 2020 and nobody has tested that WebGL
backend on a 2026 browser. So **spike it in half a day, outside this repo**: load
`magentamusic.js` from CDN, instantiate GANSynth against the `acoustic_only` checkpoint,
generate one note, confirm you get a clean Float32Array. If tfjs 2.7 is broken on current
Chrome you will know immediately and have spent nothing.

If it works, ship it as **a lazily-loaded, explicitly-opt-in easter egg** behind a
"Generate" button — never on first load, never blocking the tap-to-start path, desktop-gated,
with a real progress UI. That way the zero-dependency promise holds for the 99% path and the
30 MB is something the user chooses.

**For TTS specifically, nothing clears the bar.** MMS/VITS is the right technical fit — one
36.6 MB q8 graph, natively supported by the pipeline, no phonemizer, no speaker embedding, no
wrapper — but `facebook/mms-tts-eng` is **CC-BY-NC-4.0**, non-commercial, and that propagates
to generated audio. Kokoro is the only permissive option but costs ~99 MB through an abandoned
wrapper with broken WebGPU. SpeechT5 is four graphs and 613 MB fp32 / 164 MB q8, autoregressive,
and silently downloads a fourth fp32 vocoder if you don't pass one.

If you want voice grains, **`SpeechSynthesisUtterance` is already in the browser, costs zero
bytes**, and its output can be captured through a `MediaStreamAudioDestinationNode` straight
into the granular engine. Take that and spend the 99 MB budget on literally anything else.

---

## 8. And keep RAVE — just not in the browser

RAVE is excellent, and the instinct to reach for it was right. Run it **natively or in a
Colab**, export `.wav` files, and drop them in `samples/`.

You get the full v2/v3 quality with streaming and the noise synthesiser intact — none of which
survives the ONNX path. Granul8 stays zero-dependency. And there is no licence question,
because you are shipping *audio you generated*, not model weights under CC BY-NC.

That is the version of "AI-generated samples for a granular sampler" that actually works
today, and it costs nothing.

---

## 9. When to revisit

One specific trigger: **someone publishes an ONNX / transformers.js build of Stable Audio
Open Small** (341M params — Stability + Arm, May 2025, 11 s of 44.1 kHz stereo in under 8 s).
It is the only model whose size class would genuinely fit. Today it ships as LiteRT/KleidiAI
for **native Android** and has no web runtime; Stability's "99% of smartphones" line refers
to Arm CPU share, not browser deployment.

Even then: gate it behind an explicit opt-in, check `navigator.deviceMemory` and the WebGPU
limits, keep it desktop-only, request `navigator.storage.persist()` before downloading, and
never let it block first paint.

---

## Reference implementations worth reading regardless

- **MusicGen Web** — <https://huggingface.co/spaces/Xenova/musicgen-web>
  ([source](https://github.com/huggingface/transformers.js/tree/v3/examples/musicgen-web)).
  The honest state of the art: 100% local, static, $0 to host. Its own 656 MB loading UI is
  the single best argument against this whole direction.
- **Magenta.js DDSP Tone Transfer** — <https://magenta.withgoogle.com/tone-transfer>. Proof
  that a ~4.3 MB in-browser neural audio model is possible — and, at tfjs ^2.7.0 last
  published 2021-11-01, proof that nobody is maintaining that path.
- **`microsoft/onnxruntime-web-demo`** — the ORT-in-browser audio plumbing pattern, if you do
  end up needing it.
