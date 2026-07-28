# tools/world — offline .unr → web scene converter (M1)

Converts one Lineage 2 Interlude map tile (`assets/interlude/maps/<tile>.unr`)
into a self-contained web scene under `assets/world/<tile>/`:

```
assets/world/<tile>/
├── scene.json          # FROZEN contract (below) — the web client codes against this
├── heightmap.u16       # raw little-endian u16, 256x256, row-major (y rows, x cols)
├── heightmap.png       # min-max normalized grayscale preview of the same data
├── basecolor.png       # simplified splat-blended color preview (NOT exact, see below)
├── textures/           # layer diffuse textures + per-layer splat (weight) maps
└── props/              # converted static meshes (.gltf + .bin) + props/textures/*.png
```

Run:

```
python3 tools/world/convert.py 17_23 [19_22 21_16 ...]   # convert
python3 tools/world/convert.py --check 17_23 ...         # validate scene.json
```

Dependencies: stdlib Python 3, `tools/l2lib` (canonical format library),
`tools/bin/umodel` (for .usx → glTF), `assets/library/` (pre-exported PNGs).
Format lore: `docs/map-format.md`.

## scene.json contract (FROZEN)

```json
{
  "tile": "17_23",
  "origin": [x0, y0, z0],
  "gridSize": 256,
  "spacing": 128,
  "heightScale": 0.296875,
  "heightmap": "heightmap.u16",
  "heights": "heightmap.png",
  "layers": [{"name": "...", "diffuse": "textures/<file>.png"|null,
              "splat": "textures/<file>.png"|null}],
  "water": null,
  "geodata": "geodata.json",          // optional, see geodata contract below
  "interior": true,                   // optional, dungeon tiles only (below)
  "props": [{"mesh": "<package>.<name>",
             "gltf": "props/<name>.gltf"|null,
             "position": [x, y, z],
             "rotation": [pitch, yaw, roll],
             "scale": [sx, sy, sz]}]
}
```

World mapping (validated in `docs/map-format.md` §6):

```
origin  = [ (tx-20)*32768, (ty-18)*32768, TerrainInfo.Location.Z ]
vertex (i,j) world X = x0 + i*128,  Y = y0 + j*128      (i,j in 0..255)
height h = u16 at (j*256+i)  (row j = +Y direction)
world Z = z0 + (h - 32768) * heightScale        (heightScale = 76/256 = 0.296875)
```

- `rotation` is the raw UE2 Rotator `[Pitch, Yaw, Roll]` (65536 units = 360°),
  exactly as serialized on the StaticMeshActor.
- `scale` = `DrawScale * DrawScale3D` per component (defaults 1).
- `props[].gltf` is `null` when the mesh's `.usx` package is not shipped in
  this client install (nothing else is missing — see per-tile notes below).
- glTF files are glTF 2.0 (umodel export), with `images[]`/`textures[]`
  patched in by the converter so materials reference
  `props/textures/<file>.png` (relative URIs). UE2 units = glTF units (no
  unit scaling applied); coordinate handedness conversion is the client's
  job, same as for the character models.
- `layers[].splat` is `null` for the UE2 **base layer** (weight 255 over the
  whole tile). `layers[].diffuse` is `null` never happened in practice;
  placeholder layers (`Texture.Base` with no real texture) are dropped.
- **`interior`** (optional, contract addition): present and `true` only on
  dungeon tiles — maps whose terrain is a flat dummy plane with all content
  (props) far below it. Absent = normal outdoor tile. Verified set:
  `19_16` (Pagan Temple), `21_25` (Elven Ruins), `25_21` (Antharas' Nest).
  Tiles that merely *contain* underground zones but have real outdoor
  terrain (Cruma Tower 20_21, Giran Castle 23_22, Garden of Eva 22_25, the
  Necropolis/Catacomb entrance tiles 18_24/19_20/22_24/23_23/24_20/25_17,
  Forge of the Gods 25_14, Imperial Tomb 25_15, Ant Nest 19_23, School of
  Dark Arts 18_19) are NOT flagged. The list is an explicit constant
  (`INTERIOR_TILES` in convert.py), re-validated against the data at
  conversion time (flat terrain + ≥95% of props ≥500 below the plane);
  `assets/world/tile-map.json` carries the same flag.
- The contract layer objects carry exactly `name`/`diffuse`/`splat`. The
  TerrainLayer `UScale`/`VScale` tiling factors are parsed by the converter
  (used for the basecolor preview) but deliberately omitted from scene.json
  to keep the frozen contract shape.

## What is EXACT

- **Heightmap** — G16 texture from `T_<tile>.utx`, decoded via l2lib (marker
  fallback). `heightmap.u16` is byte-identical to the earlier
  `tools/maps/out/<tile>.heightmap.u16` extractions for 17_23, 19_22, 21_16
  (verified with `cmp`). Same for the normalized PNG previews.
- **Layer table** — TerrainInfo `Layers[]` structs parsed field-for-field
  (nested packed property lists, matches the Engine.u TerrainLayer
  definition). Diffuse = the layer's `Texture` ref (resolved through the
  import package chain, e.g. `T_Gludio.GUS05`), taken from `assets/library/`
  or decoded from the source `.utx`.
- **Splat / weight maps** — the layer `AlphaMap` refs point at real painted
  grayscale weight textures inside the tile's own `T_<tile>.utx` (DXT1,
  512²–1024²). Decoded to grayscale PNGs with l2lib. White = full layer
  weight. These ARE the per-tile splats — no sector-array decoding needed.
  Verified visually: weight-map regions register exactly with heightmap
  features (river channels in 19_22, canyon band in 21_16, sand ridge in
  17_23) and with painted road nets.
- **Prop placements** — every StaticMeshActor's mesh ref (outermost package
  resolved, so `<package>` names the real `.usx` file — note this differs
  from `tools/maps/maps/*.refs.json`, which recorded the inner *group*
  name), Location, Rotation, DrawScale(3D).
- **Prop meshes** — `.usx` → glTF 2.0 via `tools/bin/umodel -export -gltf
  -png -game=l2 -path=assets/interlude` (whole package per pass). Materials
  re-wired to PNGs by material name (umodel PNG export → `assets/library/`
  → Shader/FinalBlend resolved to diffuse via l2lib and decoded). Rendered
  headless (three.js + puppeteer, `preview.html`/`shot.js`) and eyeballed:
  buildings, fences, boards come out textured and correctly shaped.

## geodata.json contract (FROZEN)

Per-tile ground truth for "height at (x, y, z)" — decoded from the installed
L2OFF geodata regions (`server/geodata-staging/geodata/<tile>_conv.dat`,
format: `docs/geodata-format.md`). `scene.json` carries an optional
`"geodata": "geodata.json"` pointer (present on all 100 converted tiles —
every tile has a matching region; no heightmap-fallback cases).

```json
{
  "tile": "22_22",
  "cellSize": 16,
  "origin": [65536.0, 131072.0],
  "cells": 2048,
  "blockCells": 8,
  "blocks": 256,
  "maxLayers": 5,
  "layers": [{"data": "geodata.bin", "encoding": "blockstream-v1",
              "bytes": 5568008}],
  "stats": {"flat": 26699, "complex": 34495, "multilayer": 4342,
            "multilayerCells": 89300}
}
```

- `origin` = world X/Y of cell (0,0)'s **corner** — identical to
  `scene.json.origin[:2]`. Cell of a world point:
  `cx = floor((x - origin[0]) / cellSize)`, same for y (clamp to 0..2047).
- `layers` lists the payload file(s). Currently one payload holding **all**
  height layers; the array shape leaves room for future payloads (e.g.
  dynamic doors).

### geodata.bin — "blockstream-v1"

```
u32 magic = 0x4C324731 ('L2G1'), u16 tileX, u16 tileY
256x256 blocks, X outer, Y inner; each block is 8x8 cells, row-major (y inner)
per block:
  u8 type = 0  FLAT       -> i16 height        (nswe implied 0x0F, open)
  u8 type = 1  COMPLEX    -> 64 x i16 packed cell words
  u8 type = 2  MULTILAYER -> per cell: u8 layerCount (1..127),
                             layerCount x i16 packed cell words
packed cell word: nswe = w & 0x000F (E=1, W=2, S=4, N=8; a bit allows
                 moving OUT of the cell in that direction)
                 height = int16(w & 0xFFF0) >> 1   (arithmetic shift!)
```

### Height query (the multi-layer rule)

FLAT/COMPLEX cells have one height. MULTILAYER cells have several stacked
surfaces (bridge over road, tower floors). **Height is a function of
(x, y, z)**: collect all layer heights of the cell and pick the one nearest
the character's current z (`abs(h - z)` minimum). A lookup without z picks
the wrong floor in multi-level structures — this is the whole point of
shipping geodata instead of using the terrain heightmap.

## What is SIMPLIFIED / not done

- **`basecolor.png` is a preview**, not a shipping asset: it blends
  `Σ weight_i · tiled_diffuse_i / 255` with a guessed tiling (one diffuse
  repeat per 8 quads ÷ UScale) and nearest-neighbour splat sampling. The
  web client (`editor/world/js/terrain.js`) renders the real thing:
  `layers[]` + splats blended in a shader with the exact UE2 rule — layer 0
  opaque, each further layer `mix`-ed by its splat at `(gx, gy)/256`, and
  diffuse UVs at the TerrainMatrix density of one repeat per
  `128 · UScale` L2 units (rule cross-validated against the UE2 engine
  source port in realratchet/Lineage2JS and the serialized matrices in
  shnok/l2-unity's map metadata; UScale/VScale are not in scene.json, so
  layers default to 1 — correct for ~80% of the 971 converted layers).
- **Base layer semantics**: layer 0 has a real diffuse but its AlphaMap ref
  dangles (`Height.layer0`/`Texture.layer0` — package not shipped). Treated
  as full weight (standard UE2 base layer). 21_16's base is `T_Rune.RUG_1`;
  17_23/19_22 use `T_texture.Base` (a real client texture, generic dirt).
- **Prop texture name matching**: materials are wired by *name*; two
  same-named materials in different packages would share the first PNG
  found. Not observed to matter on these tiles. `dummy_material_N` slots
  (unassigned in the retail meshes) are left unwired.
- Not extracted (out of M1 scope): BSP brush buildings (`Model`/`Polys`),
  water volumes (`water: null`), emitters, decals, baked lighting
  (TerrainSector per-vertex arrays + TIntMap), ambient sounds, deco-layer
  grass scatter (DecoLayers parsed as raw array but unused).
- Prop glTF orientation/axis conventions are whatever umodel emits; the
  client owns the UE2→three.js transform (same situation as the character
  pipeline).

## Per-tile results

Original M1 tiles:

| tile | z range (world) | layers | props (actors) | packages found | placed gltf |
|---|---|---|---|---|---|
| 17_23 | −4730.1 .. −3028.7 | 7 | 440 | 5/5 | 440 |
| 19_22 | −4025.6 .. +212.9 | 9 | 1763 | 5/5 | 1763 |
| 21_16 | −4830.7 .. +1797.0 | 11 | 742 | 20/20 | 742 |

Famous-location batch (all verified in the live client: character grounded,
click-walk + WASD work, screenshots eyeballed):

| tile | place | z range | layers | props | notes |
|---|---|---|---|---|---|
| 22_22 | **Giran town** | −4413.9 .. −581.8 | 8 | 1237 | town walls/gate/buildings/square all placed |
| 23_22 | Giran castle | −4515.7 .. −1561.5 | 9 | 1301 | castle on cliff, red banners |
| 17_25 | Talking Island village | −4684.3 .. −2370.5 | 10 | 784 | coastal village, lighthouse hill |
| 16_24 | Talking Island | −4687.3 .. −475.0 | 9 | 230 | fields |
| 16_25 | Talking Island | −4741.3 .. −681.6 | 11 | 708 | dense forest (alpha foliage) |
| 17_24 | ocean NE of TI | −4684.3 .. −3767.3 | 1 | 0 | sea floor only, base texture; no water plane (M1) |
| 17_22 | Gludin area | −4716.6 .. +1773.1 | 9 | 1265 | hills, windmill, banner village |
| 24_18 | Aden | −4571.8 .. −431.9 | 10 | 1012 | paved square/avenue, cypress gardens |
| 20_22 | Dion | −4281.5 .. −1567.2 | 10 | 1647 | white-plaster houses (retail look, see below) |
| 19_21 | Gludio | −4016.7 .. −2263.9 | 9 | 967 | castle walls |

16_10 intentionally skipped (known-flat stub, `docs/map-format.md` §6).

### M2 world-expansion batch (100 tiles total)

Batch runner: `tools/world/batch_convert.sh` (resumable — skips tiles that
already have `scene.json`; per-tile log `batch_convert.log`, failures
`batch_failures.txt`). It converts every tile in
`assets/world/tile-map.json` except the classified skips: `Ocean` (33),
`Ocean (Talking Island approach)` (15_25), `Unnamed terrain` (8),
`Off-world (no terrain data)` (19_11, 20_11), `GM Room` (16_10),
`Olympiad Stadium` (16_11, 17_10, 17_11, 19_17) and `Seven Signs`
catacomb/rift interiors (16_12, 18_10, 19_10, 20_10 — separate scope).
Result: **100/100 named tiles converted** (13 pre-existing + 87 in the
batch), every `scene.json` passes `--check`.

Converter hardening done for this batch (common retail-data quirks, not
per-tile hacks): some maps serialize actor properties with bogus sizes —
`DrawScale` FloatProperty with 12-byte values (4 actors in 23_13) and
`Location`/`Rotation`/`DrawScale3D` structs that are not 12 bytes (8
props in 25_19). `prop_float` now returns `None` for non-4/8-byte values
(callers keep the default), and vector/rotator props are only applied
when the raw value is exactly 12 bytes. Actors with an unreadable
`Location` are skipped (consistent with the existing
mesh-and-location-required rule).

### Per-tile edge cases (M2)

- **19_16 (Pagan Temple), 21_25 (Elven Ruins)** — true dungeon-interior
  tiles: dead-flat heightmap (constant 16384) with ALL props below the
  terrain plane (19_16: 579/579 props at z −11329..−8276; 21_25:
  1110/1110 at z −6689..−5357, plane at −4704). Conversion is correct —
  in retail these interiors are pure static-mesh scenes with no visible
  terrain. In the current web client the flat terrain plane occludes the
  dungeon (character walks on the plane above it). Rendering these needs
  a client-side decision (hide terrain for interior scenes / spawn
  below), not a converter change. Note: 21_25's `T_21_25.utx` G16
  texture is internally named `21_17` (marker fallback finds it; flat
  anyway, harmless).
- **24_16 (Goddard)** — default spawn lands inside the dark castle-keep
  structure; geometry/placement is correct (retail keep sits at tile
  center), just a dark spawn.
- **23_13 (Schuttgart)** — 45 unwired materials (highest of the batch;
  mostly `dummy_material_N` slots, same known situation as the M1 towns).
- All other tiles converted clean: 100% basecolor coverage, all prop
  packages found, no missing heightmaps.

### Prop notes for this batch

- **Alpha foliage**: leaf/fence textures are RGBA PNGs with real
  transparency. The converter now marks such glTF materials
  `alphaMode: MASK`, `alphaCutoff: 0.5`, `doubleSided: true` (detected by
  scanning the PNG alpha channel / tRNS). Without this, foliage rendered
  as opaque white cards.
- **`dummy_material_N`**: some meshes have unassigned material slots (no
  material even in the retail data — e.g. the white plaster faces of Dion
  houses). umodel names those slots `dummy_material_N`; they are left
  unwired (three.js default white), which matches the retail look of those
  buildings. No `Skins` overrides exist on any StaticMeshActor (checked
  20_22's 1993 actors).
- **Placement completeness**: actors whose StaticMesh/Location properties
  are not serialized have no mesh (class default None) — they are
  invisible in retail too. Every actor with both a mesh and a location is
  in scene.json.
- Unwired material counts per tile (all `dummy_material_N` placeholders):
  21_16: 31, 20_22: 32, 17_25: 9, 22_22: 5, 24_18: 4, 17_22/19_21/23_22: 3,
  16_25: 1, others: 0.

## Files

- `convert.py` — the converter (single file, see module docstring). Emits
  geodata too when a matching region exists.
- `geodata.py` — per-tile geodata extraction/validation (standalone:
  `python3 tools/world/geodata.py --all` regenerates geodata + patches the
  scene.json pointer without a full reconversion; `--check [tiles]` does a
  full round-trip validation against the source regions + a heightmap
  cross-check).
- `batch_convert.sh` — resumable M2 batch driver over tile-map.json
  (logs: `batch_convert.log`, `batch_failures.txt`).
- `preview.html`, `shot.js` — headless render check for converted props
  (needs an http server at the repo root on :8777 and the char_pipeline
  node_modules: three + puppeteer-core + system Chrome).
