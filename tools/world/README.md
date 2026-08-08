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
  "water": [{"height": -3780.0,
             "rect": [x0, y0, x1, y1],
             "texture": "textures/water01.png"}] | null,
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
  `props/textures/<file>.png` (relative URIs). umodel scales to metres
  (`pos.Scale(0.01f)`), so glTF units = metres, matching the client.
- **Prop glTF coordinate basis (changed 2026-08-08, see
  `docs/world-prop-basis.md`).** umodel's exporter converts UE space with a
  swap, `(x,y,z)_UE -> (x,z,y)`, determinant **-1** — a reflection. The
  client places props with `l2ToThree`, `(x,y,z)_L2 -> (x,z,-y)`,
  determinant **+1**, so every prop used to be drawn as its own mirror
  image. `convert.py gltf_to_proper_basis()` now post-processes each export
  into the **proper (x, z, -y) basis**: `POSITION.z`, `NORMAL.z`,
  `TANGENT.z` and `TANGENT.w` negated, every triangle's index order
  reversed, POSITION accessor `min.z`/`max.z` swapped and negated. The file
  is tagged `asset.extras.basis = "l2ToThree(x,z,-y) det+1"` and the pass is
  idempotent. Gate: `tools/src/char_pipeline/audit_prop_basis.py --check`.
- **Prop material render state (changed 2026-08-08).** `alphaMode`,
  `alphaCutoff` and `doubleSided` are read from the **retail UE2 material**
  in the client `.utx` (Shader `AlphaTest`/`AlphaRef`/`OutputBlending`/
  `TwoSided`/`TreatAsTwoSided`, or Texture `bMasked`/`bAlphaTexture`/
  `bTwoSided`), never from a PNG alpha histogram. See the
  `RetailMaterialIndex` block comment in convert.py for the mapping and its
  UEViewer source lines. Modifier chains (`TexPanner`, `TexOscillator`,
  `Combiner`, …) resolve through to the wrapped material; a name that
  resolves to a non-material export (a `StaticMesh` or `Package` sharing the
  name) is reported as unsourced and left alone rather than guessed. The
  name→export index is cached in `assets/world/.utx_material_index.json`
  (rebuilt when the .utx set changes). Gate:
  `tools/src/char_pipeline/audit_prop_materials.py --check`. A change to the
  decode can be rolled over the converted world without the umodel pass:
  `python3 tools/world/convert.py --materials-only <tile> ...` (touches only
  `alphaMode`/`alphaCutoff`/`doubleSided`; idempotent).
- Prop `.gltf`/`.bin` files in `props/` that are not referenced by
  `scene.json` are deleted at conversion time (leftovers from an earlier
  build of the same tile).
- `layers[].splat` is `null` for the UE2 **base layer** (weight 255 over the
  whole tile). `layers[].diffuse` is `null` never happened in practice;
  placeholder layers (`Texture.Base` with no real texture) are dropped.
- **`water`** is `null` when the tile's `.unr` places no WaterVolume brush,
  else one entry per WaterVolume actor. `height` is the brush bounding-box
  top in world Z (the swimmable surface; there is no FluidSurfaceInfo in any
  retail map — the client renders the volume's top face). `rect` is the
  brush bbox XY extent in world L2 units. `texture` is the retail
  WaterSurfaceSet diffuse (`FX_E_T.Water01`, the texture behind
  `WaterShader01`), shipped per-tile; retail scrolls it with a TexPanner.
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

## lights.json contract (sibling file — the retail light rig)

`scene.json` is frozen, so the decoded lighting ships beside it. Written by
`convert.py` (`read_lights` / `write_tile_lights`); regenerable on its own
with `python3 tools/world/convert.py --lights-only <tile> ...`.

```
assets/world/<tile>/lights.json
```

Everything is copied out of the `.unr` in **retail units** (L2 cm, UE
rotator 65536/rev, `LightHue`/`LightSaturation` 0..255) and never
reinterpreted. Keys:

| key | source |
| --- | --- |
| `sun` | the single `NMovableSunLight`: `location`, `rotation`, `brightness` (`LightBrightness`), `drawScale` |
| `sun.derived` | pure arithmetic on the above: `pitchDeg`/`yawDeg`, and `shineDirThree`/`directionToSun` — the rotator's forward axis `(cP cY, cP sY, sP)` mapped with the props' own `M = (x,y,z) -> (x,z,-y)`. 22_22: `directionToSun = (0.500, 0.750, 0.433)`, elevation 48.6° |
| `nsun` | the `NSun` billboard: `location`, `rotation`, `radius`, `directional` |
| `zones` | every `ZoneInfo` carrying lighting/fog state: `AmbientVector`, `AmbientBrightness`, `bDistanceFog`, `DistanceFogStart`/`End` (+ `_m` = ×0.01), `DistanceFogColor` (UE1/UE2 `FColor` is R,G,B,A — UEViewer `UnCore.h:2483`) |
| `terrainZone` | the name of the `ZoneInfo` with `bTerrainZone` — the tile's outdoor zone |
| `lights` | every `Light` actor: `Location`, `Rotation`, `LightBrightness`, `LightRadius`, `LightHue`, `LightSaturation`, `LightType`, `LightEffect`, `bDirectional`, `bCorona`, on/off times |

22_22 (Giran) decodes to: sun brightness 70.0 at rotation
(-8846, 25324, 0); terrain zone `ZoneInfo3` with `AmbientVector`
(0.360, 0.360, 0.360) and `DistanceFogEnd` 15000 (= **150 m**); 17 zones;
91 `Light` actors.

**NOT converted, deliberately**: `LightBrightness` / `LightRadius` are UE2
light units and there is no sourced mapping onto a three.js (ACES-tonemapped
PBR) intensity. They ship raw so the calibration can be done against data
rather than guessed. **NOT consumed yet**: the client's light rig lives in
`editor/world/js/main.js`, which was outside this change's ownership — see
`docs/foundation-audit.md` F4.

## bsp.gltf contract (sibling file — the BSP buildings)

`scene.json` is frozen, so the decoded BSP ships beside it. Written by
`tools/world/bsp.py`; loaded by `editor/world/js/bsp.js`.

```
assets/world/<tile>/bsp.gltf     glTF 2.0, external buffer, no extensions
assets/world/<tile>/bsp.bin      vertex + index data
assets/world/<tile>/bsp/*.png    the surface textures (one per material)
```

```
python3 tools/world/bsp.py 22_22 [17_25 ...]   # convert
python3 tools/world/bsp.py --all               # every converted tile
python3 tools/world/bsp.py --check [tiles]     # validate (exit 1 on fail)
```

Why this file exists: every building shell, wall, floor, stair and
**interior** in an Interlude town is BSP brush geometry, which `convert.py`
never read — the static meshes it does read are the *decoration bolted onto
these shells*. A town tile carries 300–500 brushes; the 100 converted tiles
carry 146 740 BSP node polygons between them.

- **Source**: the tile's single post-CSG **level UModel** (the one with
  `NumZones > 0`), i.e. the geometry the retail engine rasterises —
  doorways already cut, rooms already hollow. NOT the per-brush source
  UPolys, which would render a subtracted room as a solid box.
- **Units and placement**: raw **L2 world units, Z-up**, exactly like
  `scene.json` props ("UE2 units = glTF units; handedness conversion is the
  client's job"). The level model's Points are already world-placed, so the
  converter applies **no** translation, rotation or scale — there is no
  brush `Location`/`PrePivot` step to get wrong. The client applies the
  coords.js map as one group transform (`rotation.x = -PI/2`, `scale 0.01`).
- **Structure**: one glTF node per spatial chunk (4800 L2u = 48 m grid,
  matching the client's `PROP_CLUSTER_SIZE`), one primitive per material
  inside a chunk. Attributes `POSITION`, `NORMAL` (the BSP node plane),
  `TEXCOORD_0`; indices are a triangle fan per BSP node, wound CCW.
- **Materials**: `pbrMetallicRoughness` with `baseColorTexture` →
  `bsp/<name>.png`, `metallicFactor 0`, `roughnessFactor 1`,
  `doubleSided: true` (the player walks *inside* these shells),
  `alphaMode: MASK` + `alphaCutoff 0.5` when the surface is PF_Masked or the
  PNG carries real transparency — the same rule the prop path uses.
- **UVs** are the retail BSP projection
  `U = dot(P - Points[pBase], Vectors[vTextureU]) / texture width` (same for
  V), i.e. texture *pixels* normalised by the shipped PNG's size.
- `asset.extras` records the per-tile stats (nodes drawn/skipped by
  category, triangles, cluster size).

### What is dropped, and on what evidence

Every exclusion is decided from the retail data, never from a texture name:

| dropped | rule | 17_25 / 22_22 |
|---|---|---|
| invisible helpers | `PolyFlags & PF_INVISIBLE (0x1)` | 800 / 638 nodes (with the two below) |
| zone portals | `PolyFlags & PF_PORTAL (0x4000000)` | ” |
| sky-box faces | `PolyFlags & PF_FAKEBACKDROP (0x80)` | ” |
| the sky room | node has the `SkyZoneInfo` zone on one side (`iZone`) | 53 / 53 |
| the world box | brush whose UModel bbox is wider than a whole tile (`GRID*SPACING`) | 36 / 31 |
| water already drawn from `scene.json.water` | material is `FX_E_T.WaterShader01`, tile has water entries | 244 / 100 |

`PF_INVISIBLE` is *named from the data*: across 17_25 + 22_22 + 20_21 a
surface carries 0x1 if and only if it is an editor helper (painted
`AntiPortal` / `WaterAntiportal` / `ZonePortal`, or flagged portal /
antiportal). Full flag→material histogram and the byte-level structure
evidence: the "UModel / UPolys" block in `tools/l2lib/ue2package.py`.

### NOT decoded

- **Lightmaps / baked lighting.** The level UModel ends with an
  `FLightMapIndex` array plus the raw `LightBits` blob (~1.8 MB on 17_25);
  `read_model()` reports its size in `Model.lightmap_tail` and does not
  parse it. The client lights the BSP with the same rig it lights props
  with. Nothing here fakes retail's baked light.
- `Engine.DefaultTexture` surfaces (the UnrealEd "no texture assigned"
  placeholder) are skipped: 213 nodes on 22_25, 209 on 24_18, 186 on 25_18,
  10 on 25_15, 4 on 21_16, 0 everywhere else.

### Result over the converted set

100/100 tiles converted and `--check` clean: **118 310 of 146 740 BSP node
polygons drawn, 332 717 triangles**, 3904 primitives, 24 MB of
`bsp.gltf`+`bsp.bin` and 227 MB of `bsp/*.png` (per-tile texture copies, the
same convention `props/textures/` already uses; worst tile 21_16 at 7.9 MB).
Whole run: ~1 min for all 100 tiles. 20 tiles are countryside with no BSP at
all (60-node stubs = world box + sky) and ship an empty `bsp.gltf`.
Cost in the client, measured on Giran with `?bsp=off` as the baseline:
**+37 draw calls** (1159 → 1196) and +35 geometries; triangles in view are
unchanged because most of the BSP sits behind the static-mesh facades.
Client-side verification: `node editor/world/verify_bsp.js` (before/after
from one build via `?bsp=off`, plus numeric chunk/triangle/bounding-box
assertions; shots in `editor/world/verify_shots/bsp_*`).

### Open finding: the BSP floor vs the terrain mesh (NOT fixed here)

Measured on the Giran square (22_22, world x 82000 y 148000):

| surface | z |
|---|---|
| raw `.unr` heightmap terrain | **−3600.8** |
| decoded BSP pavement slab (`Giran_floor03`) top | **−3496** |
| aCis geodata (walkable) | **−3464** |
| terrain as the client renders it (after `correctHeightsWithGeodata`) | **−3464** |

So the retail town square is a BSP slab laid ~105 units above the natural
ground, and geodata describes the slab top (+32), not the terrain. The
client's stale-rectangle repair raises the terrain mesh to the geodata
level, which now buries the newly decoded pavement by ~32 units. Two
existing notes are affected and should be revisited by whoever owns the
terrain/geodata correction: `docs/HANDOFF.md` "town floors painted with the
base dirt are a retail fact" (the pavement is real — it is BSP, not a
terrain layer) and the `MESH_GEO_*` heuristic in `terrain.js` (at the square
the heightmap is not stale; the missing slab explained the deviation). This
BSP work deliberately does **not** change the terrain correction — that
would be a cross-cutting change to the walking router, and a depth nudge to
make the slab win would be exactly the kind of magic offset this project
forbids.

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
- BSP brush buildings (`Model`/`Polys`) are no longer missing — they ship in
  the sibling `bsp.gltf` (contract above), not in scene.json.
- Not extracted (out of M1 scope):
  emitters, decals, baked lighting
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
| 17_24 | ocean NE of TI | −4684.3 .. −3767.3 | 1 | 0 | sea floor only, base texture; water plane at −3780 (WaterVolume) |
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
- `bsp.py` — the BSP (buildings) converter: level UModel → `bsp.gltf`
  (contract above). `--all` / `--check` like the others.
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
