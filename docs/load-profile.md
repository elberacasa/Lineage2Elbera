# Where the client's startup time actually goes — Giran (22_22)

Measured 2026-08-09, `node editor/world/verify_loadprofile.js --save`, head
`3dc180e`. Raw output and the machine/tree provenance are in
`editor/world/verify_loadprofile.baseline.json`.

**This document reports. It does not recommend an optimisation.** Every number
below came out of the browser's own Navigation/Resource Timing and Chrome's
sampling profiler, or out of `tools/dev/measure_http.py` against the real dev
server. Where a number could not be obtained, that is written down as a gap
rather than filled in.

---

## 0. The previous baseline was worthless, and here is the proof

The `verify_loadprofile.baseline.json` that was on disk before this run
(untracked, like `verify_loadprofile.js` itself) recorded
**cold worldReady 158,153 ms** and **warm 147,188 ms**. The same measurement on
the same tile now reads **15,371 ms / 15,793 ms** — a **10.3x** difference with
no code change in between that touches loading.

The old baseline is stamped `2026-08-08T21:06:22Z`. `bspfloor.py --all` was
rewriting the whole 100-tile set from 16:55 to 17:21 local (= 20:55–21:21Z),
and `assets/world/22_22/bspfloor.bin` — the tile being profiled — has mtime
**17:14 local**, eight minutes *after* that profile run started. The baseline
measured a machine competing with a bulk extraction job, and nothing in the
file said so.

Two things changed as a result:

- the baseline format is now **2** and carries `provenance`: git head, dirty
  file count, `treeChangedDuringRun`, `loadavg` before and after, prop count,
  how many phase timings were captured, and any reload error;
- `verify_loadprofile.js --check` **refuses** a format-1 baseline, a baseline
  taken over a changing tree, or one with no phase timings, and it refuses
  *before* spending 35 minutes measuring against it.

## 1. Milestones

| ms from navigationStart | cold (empty disk cache) | warm (cache primed) |
|---|---:|---:|
| domContentLoaded | 422 | 1,772 |
| firstPaint / FCP | 380 | 1,752 |
| **worldReady** | **15,371** | **15,793** |
| firstFrameAfterReady | 16,713 | 17,236 |
| interactive (`#loading` hidden) | 15,371 | 15,793 |
| wall clock (harness) | 17,988 | 18,665 |

**Warm is not faster.** A fully primed cache — 2,680 prop files served from
disk cache, 0 bytes transferred — leaves `worldReady` unchanged (15.4 s → 15.8 s,
i.e. inside the noise, and in the wrong direction). That single comparison is
the strongest statement in this document: **network transfer is not the
critical path.**

## 2. Network, per asset class (cold)

requests / summed wall ms / transferred KB / decoded KB

| class | req | wall ms | transferred KB | share of bytes |
|---|---:|---:|---:|---:|
| **prop gltf+bin** | **2,680** | **13,583** | **113,252** | **74.2%** |
| texture | 211 | 4,575 | 21,193 | 13.9% |
| ui skin/font | 85 | 1,257 | 1,197 | 0.8% |
| gltf (character) | 1 | 496 | 3,309 | 2.2% |
| gamedata json | 50 | 496 | 1,089 | 0.7% |
| other .bin | 2 | 375 | 2,847 | 1.9% |
| javascript | 30 | 309 | 1,271 | 0.8% |
| scene.json | 9 | 80 | 5,338 | 3.5% |
| heightmap | 9 | 54 | 1,155 | 0.8% |
| other json | 8 | 25 | 1,456 | 1.0% |
| geodata | 2 | 20 | 5,438 | 3.6% |
| **bspfloor** | **1** | **9** | **1,379** | **0.9%** |
| bsp gltf | 2 | 4 | 416 | 0.3% |
| **total** | **3,093** | **~21,300** | **~152,600** | |

The summed wall column overlaps heavily (six sockets in parallel); it ranks
classes, it does not add up to elapsed time.

**Props are the asset budget**: 87% of the requests and 74% of the bytes. The
tile boots 1,946 placements.

## 3. CPU self-time (Chrome sampling profiler, 100 µs, post-DCL)

Top of the cold profile, in ms of self-time:

| | cold | warm |
|---|---:|---:|
| `vertexAttribPointer` | 3,435 | 4,603 |
| `getShaderInfoLog` | 2,031 | 1,548 |
| `getProgramInfoLog` | 1,840 | 2,044 |
| `drawElementsInstanced` | 1,467 | 1,898 |
| `texSubImage2D` | 1,267 | 1,486 |
| `uniformMatrix4fv` | 1,229 | 707 |
| neighbor tiles (`js/neighbors.js`) | 1,022 | 1,298 |
| three.js core | 743 | 791 |
| **gltf parse (GLTFLoader.js)** | **102** | **111** |
| geodata (`js/geodata.js`) | 37 | 30 |
| terrain + prop instancing (`js/terrain.js`) | 17 | 25 |
| heightfix (`js/heightfix.js`) | 14 | 28 |
| **bsp build (`js/bsp*.js`)** | **5** | **6** |

Long tasks: 47 totalling 15,784 ms cold, worst 3,150 ms.

Read this carefully, because it is easy to over-read:

- The client's **own JavaScript is not the cost**. glTF parsing is 102 ms.
  BSP build is 5 ms. Terrain + prop instancing is 17 ms. Geodata decode is
  37 ms. Heightfix is 14 ms. Together, under 200 ms of a 15,000 ms load.
- Everything expensive is a **WebGL call**, and this run is on **SwiftShader**
  (headless Chrome, `--use-angle=swiftshader`). Attribute setup, texture
  upload and draws are CPU-emulated here and are *not* representative of the
  owner's GPU. **Nothing in this table licenses a conclusion about the real
  machine's GPU cost.**
- `getShaderInfoLog` + `getProgramInfoLog` = **3.9 s cold**. Those are
  three.js's post-link diagnostic reads. They are synchronous round trips that
  force a pipeline flush, and they happen once per program. This one is
  probably real on any driver, but it has not been measured on a real GPU here,
  so it is a **hypothesis, not a finding**.
- `js/neighbors.js` at 1.0–1.3 s of *self*-time is the largest client-owned
  entry and is worth a look on real hardware.

## 4. Does the walk raster cost anything? No.

`bspfloor.bin` grew ~18x per tile when the 16-unit `WALK` section landed
(Giran: 77,818 B → 1,411,751 B; the 100-tile set is 126.5 MiB). In the load:

- **1 request, 9 ms, 1,379 KB — 0.9% of the transferred bytes.**
- It is not in the CPU profile at all above the 1 ms floor.

The walk raster is **not** the reason the client feels slower. Neither is the
+6,782-placement prop wave in the JS: `js/terrain.js` self-time is 17 ms. What
props cost is *bytes and requests* (§2), and even those do not move
`worldReady` (§1).

## 5. Does HTTP/1.0 dominate the cold load? No — by two orders of magnitude.

`editor/world/server.py` is a `ThreadingHTTPServer` over
`BaseHTTPRequestHandler`, whose `protocol_version` defaults to `HTTP/1.0`, so
the socket closes after every response. Verified, not assumed —
`python3 tools/dev/measure_http.py --check` asserts the status line *and* asks
the socket whether the server closed it.

Measured on this machine (`python3 tools/dev/measure_http.py --assets 22_22`):

| | |
|---|---|
| per-request fixed cost (200 sequential GETs) | **median 0.53 ms**, p90 0.57, p99 0.66 |
| connect alone | median 0.06–0.09 ms |
| throughput on `bspfloor.bin` (1.35 MiB) | ~1,280–1,880 MiB/s |

Applied to the real cold load's 3,093 requests: **~1.7 s of connection
overhead, serial** — about 290 ms across Chrome's six sockets per origin —
against a 15.4 s time-to-`worldReady`. And the warm run settles it
independently: with **2,680 of those requests answered from cache**,
`worldReady` did not improve at all.

**Conclusion: switching the dev server to HTTP/1.1 keep-alive would be worth
under a second of a fifteen-second load.** It is a tidiness change, not a
performance one. (Caveat, stated rather than hidden: this prices the *server*
side. Chrome's own per-request cost — fetch dispatch, decode, GC — is inside
the `wall ms` column of §2 and is not separable by this tool.)

Two headers worth knowing, both asserted by `measure_http.py --check`:
`Cache-Control: public, max-age=3600` on tile assets (without it there is no
warm cache at all) and `no-store` on `.js` (without it, dev edits go invisible).

## 6. DOCUMENTED GAP — the per-phase breakdown could not be captured

`verify_loadprofile.js` wraps the real `Terrain.prototype` methods and times an
in-page `loadScene(tile)` to price `heightfix` / `terrainMesh` /
`terrainMaterial` / `water` / `props` / `bsp` / `neighbors` separately. **That
reload did not complete**, on both the cold and the warm run:

```
!! reload phase failed: Runtime.callFunctionOn timed out.
```

with `protocolTimeout` already set to **900,000 ms**. So a second
`loadScene('22_22')` inside one `page.evaluate` takes **more than fifteen
minutes** under SwiftShader, or does not resolve at all. That is itself worth
chasing — a tile re-load should not cost 60x a first load — but it means the
phase columns in `verify_loadprofile.baseline.json` are empty, `--check`
correctly refuses that baseline, and §3's CPU attribution is the only
phase-level evidence available today.

Until that is fixed, the honest summary of "per phase" is §3: the client's own
work is <200 ms, and the rest is renderer-side under a software rasteriser.

---

Re-run: `node editor/world/verify_loadprofile.js` (~35 min: two full boots;
it prints nothing until it finishes).
`--json` for the raw object, `--save` to re-baseline, `--check` to gate.
`tools/battery.sh` deliberately does **not** run it — it is an instrument, not
a suite.
