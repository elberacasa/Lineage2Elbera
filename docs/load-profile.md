# Where the client's startup time actually goes — Giran (22_22)

Measured 2026-08-09 10:24Z, head **421d0f5**, `node editor/world/verify_loadprofile.js
--save`. Renderer **ANGLE Metal / Apple M4** — the real GPU, no `--use-angle`.
Machine loadavg 2.72 → 2.91 on 10 cores; tree did not change during the run.
Raw output and provenance: `editor/world/verify_loadprofile.baseline.json`.

**This document reports. It does not optimise anything.** Every number came out
of the browser's own Navigation/Resource Timing, Chrome's sampling profiler, or
a controlled A/B where one thing was changed and the load re-measured. Where a
difference was too small to separate from run-to-run noise, it is written down
as UNRESOLVED rather than quoted as a finding.

---

## 0. Both previous baselines were contaminated. Neither is a before-picture.

Stated plainly, because the task asked:

| baseline | cold worldReady | why it is void |
|---|---:|---|
| format 1/2, 2026-08-09 03:22Z, head 3dc180e | 15,371 ms | taken under `--use-angle=swiftshader` — **software** GL — and with zero boot phases captured |
| format 3, 2026-08-09 06:24Z, head c71dc15 | 6,763 ms | taken at **loadavg 12.14 → 13.96 on 10 cores**, and with `treeChangedDuringRun: true` |
| **format 3, 2026-08-09 10:24Z, head 421d0f5** | **4,386 ms** | this one: loadavg 2.72 → 2.91, tree stable, real GPU, 16 phases |

The tool refuses both old files by its own rules, and refuses them *before*
spending the measurement time — verified, exit 2:

```
$ node editor/world/verify_loadprofile.js --check
VERIFY LOADPROFILE FAILED: the baseline ... was captured on a BUSY machine
(loadavg 12.14 -> 13.96 on 10 cores; the bar is 6.0).
```

There is a third reason the 06:24Z baseline could never have answered this
task, and it is the one that matters: it was captured at head **c71dc15**,
which is **before** `053d0db` and `421d0f5` — the two commits that landed BSP
lightmaps. The prime suspect had not been written yet when the baseline that
was supposed to price it was taken. Its network table has no lightmap row at
all, and nothing in the file says why.

## 1. Milestones — ms from navigationStart

| | cold (empty disk cache) | warm (cache primed) |
|---|---:|---:|
| domContentLoaded | 146 | 126 |
| firstPaint / FCP | 84 | 128 |
| **worldReady** | **4,386** | **3,993** |
| firstFrameAfterReady | 4,443 | 4,045 |
| interactive (`#loading` hidden) | 4,386 | 3,993 |
| wall clock (harness) | 4,457 | 4,068 |

Warm saves 393 ms, about 9%. (The earlier claim that "warm is not faster" was
an artefact of SwiftShader: when the software rasteriser dominates by 10x,
nothing else is visible.)

## 2. Per-phase — the table this task asked for

`performance.now()` around the **real** methods, wrappers installed before
`boot()` ever constructs a Terrain (`wrappersBeforeFirstLoad: true`).

| phase | cold ms | warm ms | what it is |
|---|---:|---:|---|
| **neighbors** | **2,214** | **2,112** | the 3x3 background tile ring |
| props / propsInstanced | 1,379 | 908 | prop template fetch, parse, instancing |
| ui.layout | 114 | 22 | UI layout load |
| ui.font | 108 | 19 | UI font load |
| ui.skin | 85 | 18 | **UI skin load** |
| heightfix | 64 | 106 | terrain height correction |
| terrainMesh | 62 | 43 | centre terrain build |
| terrainMaterial | 51 | 31 | splat material |
| bspLoad / bsp.fetch+parse | 35 | 20 | **BSP fetch + glTF parse + build** |
| geodata | 20 | 13 | geodata decode |
| **bspFloor** | **13** | **6** | **walk-raster fetch + parse** |
| water | 2 | 1 | |
| **bsp.lightmaps** | **1** | **0** | **lightmap atlas fetch + decode** |
| *terrain.total (contains the above)* | *1,569* | *1,092* | |
| sum of leaves | 4,063 | 3,248 | |

`gltf parse` as CPU self-time (sampling profiler) is 86 ms cold; the whole of
`js/terrain.js` is 16 ms.

**Two documented holes, printed by the tool rather than left as zeros:**

- `steps.notify` / `steps.tile` — the footstep-audio wrappers install at 68 ms
  and those calls had already started. Their cost sits inside the milestones
  and the network table but is not attributed to a phase.
- On a *cold cache* the `ui.*` wrappers sometimes lose the same race and the
  three UI rows vanish entirely. They are present in this baseline and in all
  eight attribution runs (ui.skin 81–98 ms cold), but a run that shows no
  `ui.*` row is missing them, not measuring 0. The tool now prints
  `NOT CAPTURED ... a HOLE, not a zero` for exactly this.

## 3. Network, per asset class (cold)

requests / summed wall ms / transferred KB / decoded KB

| class | req | wall ms | transfer KB | decoded KB | cache hits |
|---|---:|---:|---:|---:|---:|
| texture | 204 | 7,181 | 20,447 | 20,387 | 0 |
| **prop gltf+bin** | **2,680** | **4,240** | **57,404** | **112,467** | 1,284 |
| ui skin/font | 83 | 1,095 | 605 | 581 | 0 |
| gamedata json | 53 | 395 | 1,937 | 1,921 | 0 |
| javascript | 33 | 250 | 1,330 | 1,320 | 0 |
| character models | 12 | 84 | 3,428 | 3,457 | 1 |
| scene.json | 9 | 53 | 5,338 | 5,335 | 0 |
| heightmap | 9 | 44 | 1,155 | 1,152 | 0 |
| geodata | 2 | 15 | 5,438 | 5,438 | 0 |
| **bspfloor (walk raster)** | **1** | **7** | **1,379** | 1,379 | 0 |
| bsp gltf | 2 | 3 | 528 | 528 | 0 |
| **bsp lightmap atlas** | **1** | **1** | **42** | 42 | 0 |
| **total** | **3,097** | 13,444 | **103,689** | 158,663 | 1,285 |

The wall column overlaps heavily (six sockets in parallel); it ranks classes,
it does not add to elapsed time.

## 4. Attribution — every row is a measured load, not a subtraction

`node editor/world/verify_loadprofile.js --attribute`. Each row is the same
cold Giran boot with exactly one thing changed, on its own freshly-spawned
server, interleaved across passes, median reported.

**Run B (3 passes, control spread 293 ms) — the decisive one:**

| variant | worldReady | Δ vs full | spread | verdict |
|---|---:|---:|---:|---|
| full (control) | 4,305 ms | — | 293 | |
| **neighbors-off** | **2,684 ms** | **−1,621** | 224 | **RESOLVED** |
| **nb-nosplat** | **3,367 ms** | **−938** | 85 | **RESOLVED** |
| lm-nosheet | 4,344 ms | +38 | 281 | UNRESOLVED (< noise) |
| walktrunc | 4,423 ms | +117 | 446 | UNRESOLVED (< noise) |

**Run A (2 passes, control spread 1,099 ms):**

| variant | worldReady | Δ vs full | spread | verdict |
|---|---:|---:|---:|---|
| full (control) | 4,742 ms | — | 1,099 | |
| **props0** | **1,708 ms** | **−3,034** | 73 | **RESOLVED** |
| props1891 | 4,564 ms | −178 | 336 | UNRESOLVED |
| bspfloor-off | 4,437 ms | −305 | 695 | UNRESOLVED |
| lm-off | 4,179 ms | −563 | 83 | UNRESOLVED (control spread 1,099) |
| walkraster-off | 4,617 ms | −125 | 1,303 | UNRESOLVED |

### 4.0 The harness taxes its own rewriting variants by ~380 ms

Run C set out to price the two prop waves separately and produced an
impossible result: removing **55** placements (`props1891`) measured **+305 ms
slower**, while removing **709** (`props1237`) measured **188 ms faster**.
Removing more work cannot cost more time, so the ordering was measuring the
harness, not the client.

It was. Variants that rewrite a response do not get it from the socket: the
request is paused, round-tripped to Node over CDP, and fulfilled from there.
The `null-intercept` control intercepts exactly what the `props*` variants
intercept — the same 9 `scene.json` requests — and fulfils each with **the
file's own unmodified bytes**:

| variant | worldReady | Δ vs full | spread | corrected for the tax |
|---|---:|---:|---:|---:|
| full (control) | 4,281 ms | — | 23 | — |
| **null-intercept** | **4,663 ms** | **+382** | 479 | *this is the tax* |
| props1891 (−55 props) | 4,587 ms | +305 | 249 | **≈ −77 ms** |
| props1237 (−709 props) | 4,093 ms | −188 | 274 | **≈ −570 ms** |

Corrected, the dose-response is monotone and physical again: removing 709
placements saves about 7x what removing 55 does.

**This tax does not transfer between variants** — it scales with what is pushed
through CDP, and `null-intercept` pushes 9 x 510 KB of `scene.json`. It prices
the `props*` rows only. What it establishes generally is that the tax is
**larger than every small delta in §4**, and always in the slow direction, so:

- `walktrunc` (+117) and `lm-nosheet` (+38) are *taxed* rows whose true effect
  is therefore **≤ 0** — reinforcing, not weakening, "these cost nothing";
- `neighbors-off` (−1,621) uses a query parameter and intercepts **nothing**,
  so it is untaxed and clean;
- `nb-nosplat` (−938) rewrites 8 neighbour `scene.json`s, so its true saving is
  **larger** than 938 ms. The headline number is a conservative floor.

The report now labels any variant that removes work yet measures slower as
`SUSPECT (+ve: removing work cannot cost time)` rather than `RESOLVED`.

What the variants are:

- `props0` — `scene.json` served with an empty props array.
- `props1891` / `props1237` — truncated to the count before each of the two
  prop waves (see §4.1).
- `null-intercept` — the control for the controls: the same interception,
  serving byte-identical bytes (§4.0).
- `walktrunc` — `bspfloor.bin` truncated at its `WALK` magic. Located in the
  real file at offset **77,818 of 1,411,751 B**, i.e. the 18.1x growth
  reproduced from the file itself.
- `walkraster-off` / `bspfloor-off` — the client's own switches.
- `lm-off` — `?lm=off`: no atlas fetched, uv1 still parsed and uploaded.
- `lm-nosheet` — `bsp.gltf` served with all 41 `extras.lightmapSheet` and all
  130 `TEXCOORD_1` attributes removed: the pre-`053d0db` client, off the same
  bytes on disk.
- `neighbors-off` — `?neighbors=0`. `setCenter` is **awaited** inside
  `loadScene` (`main.js:1652`), so the ring is on the critical path.
- `nb-nosplat` — neighbour `scene.json` with the `splat` keys dropped, which
  is the client's own no-bake path. The centre tile is never rewritten.

Both intercepting variants are provably live, not inert: `lm-nosheet` shows
`bsp.lightmaps` 0 where every other row shows 1, and drops one request;
`nb-nosplat` drops 135 requests and 10.3 MB and cuts the `neighbors` phase from
2,278 ms to 935 ms.

### 4.1 Answers

**The walk raster is not the cause.** 1 request, 7 ms, 1,379 KB (1.3% of
transferred bytes), a 13 ms parse phase, and a worldReady delta of +117 ms
against a 446 ms noise floor — i.e. indistinguishable from zero, and the sign
is the wrong way round. Removing 1.3 MB from the load did not make it faster.

**The lightmaps are not the cause.** This is the suspect the task flagged as
new, so it was measured two independent ways. Giran resolves **one** atlas
sheet (`g0p0.png`, 42 KB): the 907-page / 35 MB figure is the whole 100-tile
world, and a tile only fetches the sheets its own glTF names. Fetch + decode is
**1 ms cold, 0 ms warm**. Stripping the wave out entirely (`lm-nosheet`) moves
worldReady by +38 ms against a 281 ms noise floor. The wave's other cost is
72,208 B of `TEXCOORD_1` in `bsp.bin` — computed from the accessors, 18% of
that file, **0.07%** of the 103 MB load.

**The prop wave is not the cause either, though props are the budget.**
All 1,946 placements together are worth 3,034 ms (`props0`, spread 73 — the
cleanest number in this document). But *two* prop waves reached Giran and
neither explains a recent slowdown:

| wave | Giran placements | tax-corrected cost |
|---|---|---:|
| `8a5c205` 2026-08-03 actor-parser fix | 1,237 → 1,891 (+654, +53%) | ~570 ms |
| `398286c` 2026-08-08 extraction fix | 1,891 → 1,946 (+55, +2.9%) | ~77 ms |

The wave the task named — the +6,782 placements world-wide — is worth
**+55 placements and roughly 77 ms on Giran**. The earlier, five-days-older
wave is the expensive one. Both counts come from commit text, not from a file
this suite can diff: `scene.json` is gitignored, so there is no before-image on
disk. That provenance is stated rather than buried.

**The cause is the neighbour tile ring, and specifically its splat bake.**
Skipping the ring saves **1,621 ms of a 4,305 ms load — 38%**. Skipping only
the JS splat bake, keeping the ring, saves **938 ms — 22%**. `js/neighbors.js`
is also the largest client-owned entry in the CPU profile at 1,303 ms of
self-time, plus `getImageData` 205 ms, `drawImage` 42 ms, `toDataURL` 20 ms.

The bake is priced from the files, and the arithmetic agrees with the clock:
Giran's 8 neighbours carry 9, 9, 9, 11, 12, 9, 9, 9 terrain layers — **77 splat
layers** — and `_bakeSplatTexture` blends each over a **1024x1024** canvas in
JavaScript. That is 77 x 1,048,576 = **80.7 million per-pixel blends**, which
at the measured 938 ms is ~86 M/s — an ordinary rate for this code in JS.

Note what `neighbors.js` says about itself. Its header, under
**"Cost contract (vs the full center tile)"**, reads:

> `* one texture per neighbor — a 256x256 canvas baked at load`

The code bakes 1024x1024 — **16x the pixels the file's own cost contract
promises**. The constant carries its own justification (`// 32 L2 units/px —
the 256px bake read as flat blur`) and has been 1024 since `0847657`, so this
is not a regression; it is a documented cost that was never updated to match
the code, sitting on the single largest phase of the load.

## 5. Task #17 — HTTP/1.0 does NOT dominate the cold load

`editor/world/server.py` inherits `protocol_version = "HTTP/1.0"`, so the
socket closes after every response. `tools/dev/keepalive_server.py` subclasses
the real handler and changes that one class attribute, so the A/B differs in
exactly one thing. Six cold Giran boots, ABBA-ordered, fresh server and fresh
port each, TIME_WAIT drained between:

| arm | median worldReady | summed TCP connect | sockets reused |
|---|---:|---:|---:|
| HTTP/1.0 (as shipped) | **4,184 ms** | 328 ms | 47–49% |
| HTTP/1.1 keep-alive | **4,207 ms** | 2 ms | 99.7% |

**Keep-alive saves −23 ms (−0.6%) — i.e. nothing, and the sign is negative.**
Connection setup really does collapse (328 ms → 2 ms summed over 3,097
requests), but 328 ms summed across six parallel sockets is ~55 ms of wall
clock against a 4,200 ms load. This also corrects the previous document, which
modelled the cost at "~1.7 s serial" from a per-connection micro-benchmark; the
end-to-end measurement is 5x smaller than that model.

Caveat, so the reuse column is not over-read: the 47% "reused" on the HTTP/1.0
arm is mostly **cache hits**, not socket reuse — 1,285 of the 3,097 requests
are repeats served without touching the network, and those show
`connectStart == connectEnd` too.

**Recommendation for #17: do it for robustness, not for speed.** The accept
queue is 5 deep (`socketserver` default) and a connection-per-asset load has
already produced `ERR_CONNECTION_TIMED_OUT` and 36 s outliers when two suites
shared one server. Keep-alive fixes that. It will not make the client load
faster.

## 6. A finding neither task asked for: 41% of the requests are duplicates

The cold load makes **3,097 requests to 1,812 distinct URLs — 1,285 are
re-requests of something already asked for in the same load.** One texture is
requested **49 times**.

This is not a browser artefact; it is predictable exactly from disk. Giran's
1,946 placements resolve to 288 glTF templates. Each template names its own
textures, `_loadPropsInstanced` builds a fresh `GLTFLoader` per template, and
GLTFLoader has no cross-file texture cache — so a texture shared by 49
templates is requested 49 times:

| from `assets/world/22_22` | |
|---|---:|
| gltf templates + their .bin | 288 + 288 |
| texture references across templates | 2,106 |
| **distinct** textures | **820** |
| predicted prop requests | **2,682** (browser measured 2,680) |
| if textures were deduped | 1,396 |
| **avoidable requests** | **1,286** (browser measured 1,285 repeats) |
| distinct texture bytes | 48.2 MB |
| bytes if nothing were cached | 105.0 MB |

The disk cache absorbs the *bytes* (57.4 MB transferred, not 105 MB), so this
is not a bandwidth problem — but each duplicate is still a full request, and
`prop gltf+bin` is 4,240 ms of summed wall time. **This is reported, not
fixed:** `editor/world/js/**` is outside this lane.

## 7. What to trade if the owner wants the time back

Ranked by measured milliseconds per unit of risk. Nothing here has been done.

1. **Shrink the neighbour splat bake. Up to ~880 ms of 4,386 ms, for a change
   to one constant.** `SIZE = 1024` in `neighbors.js::_bakeSplatTexture` costs
   **938 ms, measured** (`nb-nosplat`, spread 85 ms) — and that is a *floor*,
   since `nb-nosplat` rewrites responses and so carries the §4.0 tax.
   *The saving at other sizes is arithmetic, not a measurement* — the loop is
   per-pixel, so scaling by area predicts 512 → ~235 ms (saving ~700 ms) and
   256 → ~59 ms (saving ~880 ms). No variant has measured those; `SIZE` is a
   constant with no query-string override, so pricing them needs either a new
   override or an edit to `neighbors.js` (outside this lane). **Treat the
   projections as a hypothesis and measure before acting.**
   The trade is blurrier *background* tiles, which are fog-distant scenery by
   design — but **verify with a screenshot before accepting**: the 1024 value
   exists because 256 "read as flat blur", so this trade was already made once
   in the other direction.
2. **Move the bake off the critical path. Up to 1,621 ms, no visual change at
   all.** `main.js:1652` *awaits* `neighbors.setCenter` before the world is
   declared ready. The ring is background scenery; letting it resolve after
   `worldReady` and fading it in would return the whole 1,621 ms to
   time-to-interactive without lowering any quality. This is the best
   ms-per-fidelity trade available and it costs no fidelity.
3. **Cache prop textures across templates. 1,286 requests, ms not yet measured.**
   A shared `THREE.LoadingManager`/texture cache across the 288 templates. Real
   but unpriced — no variant isolates it yet, so it is a hypothesis, not a
   finding.
4. **Do NOT trade away the walk raster or the lightmaps.** Both were measured
   twice and neither is separable from noise: 7 ms and 1 ms of a 4,386 ms load.
   Deleting either would cost fidelity and buy nothing.
5. **HTTP/1.1 keep-alive: take it for stability, not speed** (§5).

---

## Re-running, and what `--check` guarantees

```
node editor/world/verify_loadprofile.js              cold + warm profile (~4 min)
node editor/world/verify_loadprofile.js --selftest   the harness itself, ~1 s, no browser
node editor/world/verify_loadprofile.js --attribute [--only a,b,c] [--passes N]
node editor/world/verify_loadprofile.js --ab         HTTP/1.0 vs keep-alive (task #17)
node editor/world/verify_loadprofile.js --save       re-baseline
node editor/world/verify_loadprofile.js --check      re-measure, fail on regression
```

`--check` refuses a baseline before measuring against it when the baseline is
format < 3, was captured on a machine at loadavg > 60% of core count, over a
changing tree, with no boot phases, under a different renderer, or for a
different tile/variant/server arrangement.

**Any row that rewrites a response carries the CDP interception tax (§4.0).**
Run `null-intercept` alongside it and subtract, or read the row only as a
bound. Variants driven by a query parameter (`lm-off`, `neighbors-off`,
`walkraster-off`, `bspfloor-off`) are untaxed.

`--selftest` asserts the *instrument*, because every defect this suite has
actually shipped was the harness reporting a clean number for something it had
not measured — and none of those would fail a timing check:

- the lightmap atlas was invisible because `classify()` had no rule for it, so
  42 KB of atlas sat inside a 204-request `texture` bucket;
- `lm-nosheet` substituted **nothing** for an entire matrix run because
  `*bsp.gltf` was missing from the `Fetch.enable` pattern list — its row read as
  a 351 ms *finding* rather than as a broken variant;
- cold `ui.*` phases vanished into a wrapper race and were simply not printed,
  which reads as free.

- and `props1891` printed a clean, noise-clearing **+282 ms** that no reading of
  the client can explain, because the harness's own interception tax was in it.

It now proves all these cannot recur: the classify rules, that `lm-nosheet` and
`nb-nosplat` really rewrite the real files on disk (and that `nb-nosplat` never
touches the profiled tile), that every intercepting variant's URL is covered by
a Fetch pattern, that the inert-variant detector fires, that `null-intercept`
serves its file byte-for-byte, that a variant which removes work yet measures
slower is reported SUSPECT rather than RESOLVED, that each bad baseline shape is
refused, and that the baseline on disk carries the lightmap phase.

**It fails on the pre-fix tree, verified rather than asserted:** run against
the baseline this wave inherited it reports `2/31 FAIL` —
`baseline on disk: carries cold.boot.bsp.lightmaps [baseline 2026-08-09T06:24:47Z
head c71dc15 has 50 metrics]` — because a baseline captured before the lightmap
wave cannot catch a lightmap regression. After re-baselining: `SELFTEST PASS 31/31`.

`tools/battery.sh` deliberately does not run the profile — it is an instrument,
not a suite. `--selftest` is fast and deterministic enough to be a suite.
