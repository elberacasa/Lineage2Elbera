# L2Vzla Asset Editor — Architecture & Roadmap

Status: **Phase A spiked and verified** (July 2026, macOS arm64).
English-primary UI, Spanish secondary. This document is the architecture contract
for the web-based Lineage 2 Interlude asset editor: what exists today, how it is
built, and — with evidence — how far Phases C and D can realistically go.

```
editor/
├── server.py          # stdlib-only backend, 127.0.0.1:8081 (Phase A + Phase B wiring)
├── index.html         # self-contained UI (no CDN), dark theme shared with panel/
├── settings.json      # persisted config: assetRoot (created on first change)
├── editor.log         # nohup log of the running spike
└── cache/             # generated: parsed lists + exported PNGs (safe to delete)
    ├── lists/<key>.json
    └── pkg/<key>/{export,thumbs,full,.done}
```

Related contracts owned elsewhere:
- `tools/bin/umodel` — native arm64 UE Viewer CLI, reads encrypted L2 packages (`-game=l2`).
- `tools/bin/l2encdec` — decrypt/re-encrypt Lineage2Ver111–414 files.
- `tools/utx/utxedit.py` — texture writer (parallel workstream). Frozen CLI:
  `python3 tools/utx/utxedit.py list <pkg.utx>` and
  `python3 tools/utx/utxedit.py replace <pkg.utx> <TextureName> <image.png>`
  (in-place swap, `.bak` backup, re-encrypts 121).

---

## Phase A — Texture browser / viewer (DONE, verified)

The spike at `editor/server.py` + `editor/index.html` implements:

- **Configurable asset root** (default `tools/samples/`, persisted in
  `editor/settings.json`, changeable from the UI or `POST /api/config`).
  An empty or missing root is a first-class state: the package list renders a
  "no .utx packages" empty state instead of failing. Verified against the empty
  `assets/interlude/` (`{"packages": []}`).
- **Package browser**: recursive scan of the asset root for `*.utx`
  (`GET /api/packages`).
- **Texture list per package**: `umodel -game=l2 -list` stdout parsed with a
  regex into `{index, offset, size, class, name}` rows, cached on disk
  (`GET /api/contents?pkg=`). Verified: `t_aden.utx` → ver 117/0, 59 textures,
  names/offsets identical to umodel's own output.
- **Thumbnails + full-size view**: on first open the whole package is exported
  (`umodel -export`, ~0.4 s for 59 textures) to `editor/cache/pkg/<key>/export/`,
  then `sips` converts every TGA to a 128 px thumbnail PNG and a full-size PNG
  (`GET /api/thumbs`, `GET /api/image?kind=thumb|full`). First build for
  `t_aden.utx`: ~4 s total; subsequent calls are pure disk reads (<10 ms).

### Data flow

```
browser (editor/index.html)
  │ GET /api/packages                    → scan asset root for *.utx
  │ GET /api/contents?pkg=…              → umodel -list   → parse stdout → cache JSON
  │ GET /api/thumbs?pkg=…                → umodel -export → sips TGA→PNG (128px + full)
  │ GET /api/image?pkg=…&name=…&kind=…   → serve cached PNG
  │ POST /api/replace {pkg,texture,png}  → utxedit adapter (Phase B)
  ▼
editor/server.py (Python 3.9 stdlib, ThreadingHTTPServer, 127.0.0.1:8081)
```

### Cache strategy

Everything is keyed by `sha1(absPath | mtime | size)[:16]` of the package file:

- `cache/lists/<key>.json` — parsed `umodel -list` output.
- `cache/pkg/<key>/` — one umodel export + derived PNGs, with a `.done` marker
  so interrupted builds are retried. A global lock serializes builds; repeat
  requests during a build wait instead of duplicating work.
- A texture replace changes mtime → new key → stale entries simply age out
  (plus an explicit invalidate on successful replace). No cache-invalidation
  logic beyond that; the cache directory is disposable.

Key decisions (inherited from the panel stack and `docs/assets-tooling.md`):

- **No UE2 parser in Python for reading.** umodel CLI is the reader; the backend
  treats it as a subprocess, exactly like the panel treats `.properties` as text.
- **`-out` must be absolute** (umodel resolves relative paths against `$HOME`).
- **Export the whole package, not per-texture.** Measured 0.4 s for 59 textures;
  per-texture exports would fork umodel once per thumbnail for no benefit.
- **Path safety**: package paths are resolved against the asset root and rejected
  on traversal; texture names reject `/`, `\`, `..`.

---

## Phase B — Texture replace loop (WIRED, verified end-to-end)

`POST /api/replace` accepts `{pkg, texture, imageBase64}` (PNG), then calls the
writer through a single adapter function — `replace_texture()` in
`editor/server.py` — which is the **only** place that knows the utxedit CLI:

```python
python3 tools/utx/utxedit.py replace <pkg.utx> <TextureName> <image.png>
```

- While `tools/utx/utxedit.py` is absent, the adapter raises
  `503 {"code": "writer-not-ready"}` and the UI shows a graceful
  "Texture writer not ready — Phase B pending" notice with the replace controls
  disabled. Browsing/viewing are unaffected.
- Verified against a scratch copy of `t_aden.utx` (the repo sample was not
  touched): `AS_N_02` (1024×1024 DXT1) replaced via the HTTP API →
  `mips patched: 11`, `.bak` backup created, package re-encrypted
  Lineage2Ver121. On success the package cache is invalidated so the grid and
  viewer re-render from the new bytes.

**Cross-validation note.** During the spike, the editor's independent package
parser (see Phase C) and utxedit's `list` output were diffed against
`umodel -list`: serial offsets/sizes agree exactly (`AS_N_02 off=0x38B
size=0xAAB98`, `AR_N_01 off=0x155ABB`, …, all 59 entries). One real bug was
found and reported to the writer workstream: the first byte of the UE2
`FCompactIndex` is **bit7 = sign, bit6 = continue** (UEViewer
`Unreal/UnrealPackage/UnCoreSerialize.cpp:44-63`), not the other way around —
with the swapped layout the export table mis-decodes (`class_index` came out
`+1` instead of `-1`) and every export after the first misaligns.

---

## Phase C — Map awareness (index which textures each map uses)

Goal: when editing texture `t_aden.AS_N_02`, show "used by maps X, Y, Z".

### What is verified today

An L2 `.unr` (or `.utx`) is, after `l2encdec -c decode -p 121`, a standard UE2
package container (signature `0x9E2A83C1`, version 117). The three tables that
matter for dependency indexing were parsed with ~100 lines of stdlib Python and
verified against `t_aden.utx`:

- **Header** — counts/offsets of the name, import and export tables. ✔
- **Name table** — `FString` with compact-index length + u32 flags. All 74
  names decoded. ✔
- **Import table** — `classPackage, className, packageIndex, objectName`.
  Decoded: `Engine.Texture (class Class)`. ✔
- **Export table** — `class, super, package, name, flags, serialSize,
  serialOffset` (compact indices). All 59 exports decoded; serial offsets and
  sizes match `umodel -list` byte-for-byte. ✔

The one format gotcha is the compact-index bit layout documented in Phase B —
with that fixed, the container is fully walkable for table-level data.

### What this buys for maps

A UE2 map references external textures through its **import table**: every
`t_aden.AS_N_02`-style reference a map's terrain layers and materials use is an
import entry (`package t_aden, class Texture, name AS_N_02`). Therefore Phase C
can deliver, with high confidence:

1. **Map → texture-package dependency index**: for each `Maps/*.unr`, decrypt to
   a temp file, parse the import table, record `(map, package, object, class)`.
   This is table-level parsing — it does NOT require understanding L2's
   modified level format, actor serialization, or geometry. Cost per map:
   decrypt (~1 s for large maps) + parse (<0.1 s). Cache like the texture lists.
2. **Reverse index in the editor UI**: opening a texture shows "Used by N maps"
   with the list; opening a map shows its texture dependencies with thumbnails
   (reusing the Phase A cache).
3. **Impact warnings on replace**: Phase B replace can warn "this texture is
   referenced by these maps".

Caveat, stated plainly: the pipeline is **verified on `.utx` but not yet on a
real `.unr`** — `assets/interlude/Maps/` is empty pending the client copy. The
container format is identical, so the risk is low, but the first real map must
be run through before Phase C is called done. (Also note: L2 terrain textures
may additionally be referenced by name *inside* serialized TerrainInfo actor
data rather than only via imports; import-table indexing may under-report.
String-scanning the decrypted export data for package names is a cheap
complementary heuristic if that shows up.)

### What Phase C cannot do (evidence)

- **umodel is not a fallback for maps.** Gildor (umodel's author): L2 has a
  "heavily modified" engine; maps from other UE2 games are incompatible, and
  "it is not possible to export [a Lineage] level so it will be openable in
  UnrealEd" ([gildor.org forums, topic 339](https://www.gildor.org/smf/index.php?topic=339.0)).
  Do not plan on `umodel -list` working on `.unr`; plan on our own table parser.
- **Rendering maps is out of scope.** Community attempts (ushock level viewer,
  L2Walker map tool) either fail on L2 or render only the terrain heightmap
  (which UE2 stores as a 16-bit texture — extractable, but that is a heightmap
  preview, not a map viewer).

---

## Phase D — Direct map asset editing (feasibility assessment)

Honest verdict: **not feasible in the foreseeable roadmap; do not promise it.**

- There is no tool — on any platform — that opens L2 `.unr` files in an editor
  and saves them back. UnrealEd rejects decrypted L2 maps ("Serial missize"),
  because NCSoft modified the engine's serialization, not just the encryption
  (same Gildor thread as above).
- Writing a general UE2 *level* serializer (actors, BSP, terrain, lighting) for
  a heavily forked 2003 engine is a multi-month reverse-engineering project
  with no existing codebase to build on. The L2Walker tool demonstrates the
  ceiling the community reached: heightmap extraction, nothing more.
- What remains *conceivable* as narrow, Phase-B-style in-place patches:
  - swapping a texture **reference** inside a map's serialized data for another
    of identical name length (fragile, needs the actor property format);
  - heightmap replacement (16-bit texture payload swap, same-size constraint —
    exactly the utxedit replace case, but inside the `.unr`).
  Both are research spikes, not roadmap items. The realistic editing surface
  for this product is **textures (Phase B) + impact visibility (Phase C)**.

---

## Merge path: editor + panel → one product

Both apps already share the stack (stdlib `ThreadingHTTPServer`, single-file
HTML, same CSS variables/dark theme) and the 127.0.0.1 binding. Merge plan:

1. **Now (parallel spikes)**: panel on :8080, editor on :8081, cross-linked.
2. **Unified backend**: one `server.py` mounting both route families
   (`/api/config-*`, `/api/packages`, …) behind a path prefix, e.g.
   `/panel/*` and `/editor/*`, with a shared top-level navigation in the HTML
   shell. The editor's endpoints are already prefixed (`/api/…`) and its state
   is file-based (`settings.json`, `cache/`), so merging is route
   concatenation, not redesign. Port: keep 8080.
3. **Shared chrome**: one header (brand + server status pills + tool status
   pills), left nav switching between "Server config" and "Asset editor".
   Keep English-primary labels with Spanish secondary text as in both apps.
4. **Later**: the same merge pattern absorbs the Phase C map index
   (`editor/cache/maps.json`) and, eventually, in-browser diff/backup views of
   `panel/backups/` and `.bak` package backups.

---

## Verification appendix (this spike)

| Claim | Evidence |
|---|---|
| Package listing | `GET /api/packages` → `t_aden.utx` (47,551,543 B) |
| Texture list | `GET /api/contents?pkg=t_aden.utx` → ver 117/0, 59 textures, offsets match umodel |
| Thumbnails | `GET /api/thumbs` → 59/59 withThumb; first build ~4 s, cached calls <10 ms |
| Full-size view | `GET /api/image?…&kind=full` → HTTP 200, 1,411,378 B PNG, 1024×1024 (sips-verified) |
| Thumb size | kind=thumb → 128×128 PNG |
| Empty asset root | `assets/interlude/` → `{"packages": []}`, UI empty state |
| Replace loop | scratch copy: `POST /api/replace` → `mips patched: 11`, `.bak` + re-encrypted 121 |
| Writer-not-ready state | adapter returns 503 `writer-not-ready` when `tools/utx/utxedit.py` is absent |
| Table parser (Phase C grounding) | 74 names / 2 imports / 59 exports parsed from decrypted `t_aden.utx`; sizes/offsets equal to umodel |
