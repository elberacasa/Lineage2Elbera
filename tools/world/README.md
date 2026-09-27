# tools/world — offline .unr → web scene converter (M1)

Converts one Lineage 2 Interlude map tile (`assets/interlude/maps/<tile>.unr`)
into a self-contained web scene under `assets/world/<tile>/`:

```
assets/world/<tile>/
├── scene.json          # FROZEN contract (below) — the web client codes against this
├── heightmap.u16       # raw little-endian u16, 256x256, row-major (y rows, x cols)
├── terrain-topology.json # native bitmap words; interpretation explicitly unverified
├── heightmap.png       # min-max normalized grayscale preview of the same data
├── basecolor.png       # simplified splat-blended color preview (NOT exact, see below)
├── textures/           # layer diffuse textures + per-layer splat (weight) maps
└── props/              # converted static meshes (.gltf + .bin) + props/textures/*.png
```

Run:

```
python3 tools/world/convert.py 17_23 [19_22 21_16 ...]   # convert
python3 tools/world/convert.py --check 17_23 ...         # validate scene.json
python3 tools/world/convert.py --topology-only 17_25 22_22 24_18  # preserve masks only
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
  "topology": "terrain-topology.json", // optional, preservation contract below
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
  build of the same tile). `--check` now also opens every referenced prop
  glTF and verifies its external buffer and images exist — a `.gltf` with a
  missing `.bin` used to validate clean and then fail silently in the
  client.
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

### Terrain topology preservation (2026-09-26)

`terrain-topology.json` retains `QuadVisibilityBitmap`, `EdgeTurnBitmap`,
`QuadVisibilityBitmapOrig` and `EdgeTurnBitmapOrig` from the source map. The
first two are required; the `Orig` fields are retained when present. The format
is `ue2-terrain-topology-v1`, with the scene's `gridSize`, and `bitmaps` keyed
by `visibility`, `edgeTurn`, `visibilityOrig`, `edgeTurnOrig`. Each record has
`sourceProperty`, `wordCount`, `words` (unsigned 32-bit integers in original
array order), and `sourcePropertySHA256` of the serialized property payload,
including its compact count. `provenance.sourceMap` is the relative source
path; `provenance.sourceSHA256` hashes the original on-disk map file.

Without a source package, `conventions.status` is **`unverified`**, and all
interpretation fields are `null`. With the original map supplied, the exporter
checks its separately serialized native `TerrainSector` per-quad table.
Only complete, unique coverage of every `(gridSize-1)^2` ordinary quad and zero
disagreements in both visibility variants promote the status to
**`visibility-verified`**: `indexOrder: "row-major"`, `visibleBit: 1`,
`bitmapVariant: "visibility"`. The bit at `(x,y)` is
`(words[(y*gridSize+x)//32] >> ((y*gridSize+x)%32)) & 1`.
`bitSetDiagonal` and `boundary` remain **`null`**. Runtime code must not
interpret the edge-turn words or unverified visibility records.

This check is performed for each map, rather than promoting every map from
three samples. `verification` records the source digest, complete coverage,
duplicate/missing/mismatched quad counts, hidden quad count, native table
digest and bitmap digests. A changed bitmap cannot reuse an earlier proof.
Malformed, incomplete or disagreeing sources retain the original words and
unverified conventions with diagnostic evidence.

The independent source measurement found **zero mismatches over 195,075
ordinary quads** across 768 sectors on TI (`17_25`), Giran (`22_22`) and Aden
(`24_18`). Native per-quad table zeros match exactly 0, 3,814 and 6,511
invisible quads. Current and `Orig` visibility arrays are byte-identical on
these maps. Transposing the global bitmap instead gives 2,180 mismatches on
Giran and 12,636 on Aden; using most-significant-bit-first gives 2,760 and
3,458. The tail is a compact count of **256** followed by **256 uint16 quad
values**, with 64 preceding bytes whose purpose is not established. The older
`docs/map-format.md` description of one 289-entry int16 vertex array has been
corrected to reflect this framing.
These are saved-sector observations, not a recovered native runtime algorithm.
An additional read-only audit of all 100 converted source maps found current
visibility matching all 6,502,500 ordinary quad-table entries. The stricter
two-variant gate passed 99 maps: `22_19` differs at 430 `Orig` bits despite its
current bitmap matching the table. That map intentionally remains unverified;
the exporter does not guess which runtime variant should win.
[Epic's UE2 terrain documentation](https://docs.unrealengine.com/udk/Two/EditingTerrainMaps.html)
confirms that visibility controls missing, non-solid terrain and edge turns
change triangle diagonals. The documentation supplies their purpose; the
independent serialized sector table supplies the visibility indexing evidence.

The local `engine.dll` exports `GetQuadVisibilityBitmap`, `GetEdgeTurnBitmap`,
their `Orig` counterparts, and `SetHoriEdge`/`SetVertiEdge`/`SetEndVertexZ`, but
its method bodies are packed with Themida; those symbol names alone do not
prove the algorithms. An independent browser port is a useful comparison,
not a native correctness oracle.

Fresh source measurements of `17_25`, `22_22`, and `24_18` found all four
arrays at 2048 words (65536 bits). Their serialized `TerrainSector` records
at offset 240 use **15** quads on the outer axis, not 16. For example, TI's
last-X sector spans X `-67584..-65664` (1920 = 15×128), while its nominal tile
edge is `-65536`. Giran ends at X `98176` versus tile edge `98304`; Aden ends
at Y `32640` versus tile edge `32768`. This proves that the saved ordinary
terrain ends at sample 255. The native runtime's handling of the remaining
128-unit border and adjacent maps is still unverified. Any browser stretch
to the full 32768-unit tile width is a compatibility workaround, not a source
coordinate transformation established by these records.

`--topology-only` replaces only this sidecar and the `scene.json` pointer;
raw heights, props, textures and geodata are unchanged. It is deterministic
and does not need umodel or a full world conversion. Tests use synthetic
bitmaps; an additional optional test round-trips the four source payloads
from the three private maps when those files are installed:

```
python3 -m unittest discover -s tools/world -p 'test_terrain_topology.py'
```

## Adjacent source terrain samples

`python3 tools/world/convert.py --edges-only 17_25 22_22 24_18` writes
`terrain-edges.json` and its `scene.json.terrainEdges` pointer. The updater
requires the existing heightmap bytes to match the original G16 extraction.
It preserves sample 255 at its original coordinate and supplies separate
samples at coordinate 256 from the east/south neighbors, using each neighbor's
own origin Z and scale. The southeast sample comes from that map's first
vertex. Missing sources remain null; no heights are extrapolated.

The `l2-terrain-edges-v1` record contains `tile`, `gridSize`, `origin`,
`spacing`, `east`, `south`, `southeast`, and `provenance`. Every present source
records its tile, transform, original map hash and extracted height hash.
Each present edge also records `edgeValuesSHA256`: SHA-256 of its world-Z
values encoded as little-endian IEEE-754 float64 in array order (one value
for southeast). The exporter and browser reject mismatched adjacent source
coordinates, missing metadata and changed payloads.

The browser's source path uses these original positions and decoded heights
without the legacy geodata height repair. Verified visibility removes ordinary
hidden quads from both drawing and terrain queries. Boundary joins still use
the provisional browser triangulation; adjacent source points do not establish
the native seam algorithm or edge-turn diagonal semantics.

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

## light.json (sibling file — the retail sun, ambient and fog)

`scene.json` is frozen, so the decoded lighting ships beside it as
`assets/world/<tile>/light.json`. Decoded by `tools/world/light_extract.py`
(`--all`, `--check`) and read by `editor/world/js/worldlight.js`.
`convert.py` calls `light_extract.write()` from `convert_tile`, so a
re-converted tile can never ship a stale `light.json`.

Sources: `NMovableSunLight` (`LightBrightness`, `Rotation`), the terrain
`ZoneInfo` (`AmbientVector`, `AmbientBrightness`, `bDistanceFog`,
`DistanceFogStart`/`End`, `DistanceFogColor`). 22_22 (Giran) decodes to sun
brightness 70.0 at rotation (-8846, 25324, 0) — elevation 48.6°, yaw
139.1° — ambient (0.360, 0.360, 0.360) and `DistanceFogEnd` 15000 = **150 m**
against the client's previously invented 420 m. `--check` over the converted
set: 100 tiles, 100 with a sun, 94 with fog, 0 stale.

**Not decoded into any shipped file yet** (open item, see
`docs/foundation-audit.md` F4): the per-map `Light` point-light actors (91 on
22_22, 1,704 on 23_23 — `Location`, `LightBrightness`, `LightRadius`,
`LightHue`, `LightSaturation`, `LightType`), the `NSun`/`NMoon` billboards,
and the per-zone ambient list (17 `ZoneInfo` on 22_22; only the
`bTerrainZone` one is taken). The client still invents torch lights from a
material-name regex (`FLAME_MAT_RE` in `terrain.js`). `LightBrightness` is
also deliberately NOT converted to a three.js intensity — UE2 light units
have no sourced mapping onto the ACES-tonemapped PBR rig.

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
  matching the client's `PROP_CLUSTER_SIZE`), one primitive per
  material **× lightmap sheet** inside a chunk (a primitive can bind one
  lightmap, so the sheet is part of the bucket key). Attributes
  `POSITION`, `NORMAL` (the BSP node plane), `TEXCOORD_0`, `TEXCOORD_1`;
  indices are a triangle fan per BSP node, wound CCW.
- **Materials**: `pbrMetallicRoughness` with `baseColorTexture` →
  `bsp/<name>.png`, `metallicFactor 0`, `roughnessFactor 1`,
  `doubleSided: true` (the player walks *inside* these shells),
  `alphaMode: MASK` + `alphaCutoff 0.5` when the surface is PF_Masked or the
  PNG carries real transparency — the same rule the prop path uses.
- **UVs** are the retail BSP projection
  `U = dot(P - Points[pBase], Vectors[vTextureU]) / texture width` (same for
  V), i.e. texture *pixels* normalised by the shipped PNG's size.
- `asset.extras` records the per-tile stats (nodes drawn/skipped by
  category, triangles, cluster size, and the lightmap counts below).

### Lightmaps (sibling files — the retail baked lighting)

Decoded by `tools/world/bsplight.py` out of the level UModel's tail; the
full format, the evidence and the known gaps are that file's docstring.

```
assets/world/<tile>/bsplight.json          records, counts, page list
assets/world/<tile>/lightmap/g<S>p<V>.png  512×512 RGBA — sheet S, variant V
```

```
python3 tools/world/bsplight.py 22_22 [...]   # decode + write
python3 tools/world/bsplight.py --all
python3 tools/world/bsplight.py --check       # the gate (exit 1 on drift)
node editor/world/verify_bsplight.js          # in the real client
```

- `TEXCOORD_1` is the **retail lightmap UV**, read verbatim out of bytes
  20..27 of the level model's own 40-byte render vertices. It is not
  projected or reconstructed. Proof that those bytes are the lightmap UV:
  `(u·512, v·512)` lands inside the vertex's own independently-decoded
  lightmap rectangle on 403 735 of 403 735 vertices across the 99 tiles
  that decode.
- Each material carries **either** `extras.lightmapSheet` (the sheet whose
  PNG the client binds as `lightMap` on UV set 1) **or** `extras.unlit`
  (the surface carries `PF_UNLIT`, retail draws it fullbright). Twelve
  drawn nodes in the whole world are neither; they are counted in
  `asset.extras.unlitUnflaggedNodes` and pinned in `bsplight.UNLIT_UNFLAGGED`.
- **The client draws BSP unlit**: `MeshBasicMaterial`, texture × lightmap,
  no dynamic light. That is not a style choice — it is what the split above
  forces, since retail leaves no drawn BSP surface for a dynamic light to
  light. The 2× modulate comes from `D3DDrv.dll`'s own shaders
  (`mul_x2 r0, r0, v0 // r0 = r0 * lighting`); see `editor/world/js/bsp.js`.

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

### The BSP floor vs the terrain mesh — CLOSED 2026-08-08

Measured on the Giran square (22_22, world x 82000 y 148000):

| surface | z |
|---|---|
| raw `.unr` heightmap terrain (natural ground, UNDER the slab) | **-3600.8** |
| decoded BSP pavement slab (`Giran_floor03`/`04`) top | **-3496** |
| aCis geodata (walkable) | **-3464** |
| terrain the client drew, before the fix | **-3464** |
| terrain the client draws now | **-3600.8** |
| where `heightAtWorld` puts the walker now | **-3496** (on the pavement) |

A retail town square is a BSP slab laid ~105 units above the natural ground,
and the geodata describes the SLAB (+32, the same measured
geodata-over-drawn-surface band as anywhere else), not the terrain. The
client's stale-rectangle repair read that gap as a stale heightmap and
raised the terrain mesh onto it, burying the newly decoded pavement.

Fixed by giving the correction the BSP as evidence:

* **`bspfloor.py` -> `bspfloor.bin`** (sibling file, contract below) — per
  terrain grid point, the Z of every upward-facing level-BSP surface.
* **`editor/world/js/heightfix.js`** (the correction, moved out of
  `terrain.js` and made dependency-free) gained hazard 3: a geodata pick
  that matches a BSP floor is that floor's geodata, not a stale heightmap,
  so the cell keeps the heightmap, capped under the slab.
* **`Terrain.heightAtWorld` / `NeighborTile.heightAtWorld`** anchor onto the
  BSP floor where one is the drawn ground, so the walker stands ON the
  pavement instead of the geodata offset above it.

Extent, measured over all 100 tiles with
`node tools/world/verify_bspfloor.mjs`: **12,512 grid points on 47 tiles**
had the correction drawn over a BSP floor the raw heightmap left visible
(median burial 32.1 L2u, p95 548, max 4546; worst tiles 25_18 = 4036,
22_22 = 1634, 24_18 = 1280, 24_16 = 941). After: **0** at grid resolution,
and at 16-unit triangle resolution against `bsp.gltf` itself 22_22 goes
130,404 → 0 sample points, 25_18 253,025 → 553, 24_18 84,078 → 2,109,
20_22 3,485 → 804 — what is left is not the raster but the 128-unit mesh,
which can still cross a slab edge by a few units between two capped
vertices (22_22 measured median 2.9, max 24 L2u before it reached zero).

What the old code called the legitimate stale-rectangle repair was mostly
this bug: accepted geodata picks fall from **6,929 cells to 912**, and on
22_22 the whole 1,196-cell "Giran square stale rectangle" turns out to be
the slab. The remaining 912 are on tiles whose stale zone carries no BSP
floor (26_14 keeps all 254, 24_18 keeps 163) plus the four BSP-less tiles,
which are untouched.

### bspfloor.bin contract (sibling file — the BSP floor raster)

Written by `python3 tools/world/bspfloor.py --all` from the SHIPPED
`bsp.gltf` (identity node transforms, raw L2 world units), gate
`--check` (re-derives and compares byte for byte; 100/100 OK). One file per
converted tile.

**Size, re-measured 2026-08-08 over the shipped files** (the "~83 KB average,
8.3 MB for the set" that stood here was the SECTION-1-ONLY file, from before
the WALK raster landed): the 100-tile set is **126.5 MiB**, mean **1,295 KiB**
per tile, min 128 KiB (`17_24`), max 4,449 KiB (`23_18`). On Giran `22_22` the
file is 1,411,751 B = 77,818 B of section 1 + 1,333,933 B of section 2, i.e.
section 2 is **17.1x** section 1 and the file grew **18.1x**.

```
u32  magic 'BSPF' 0x46505342
u16  gridSize (256)        u16 maxLayers (15)
i32  originX, originY      i32 spacing (128)
then gridSize*gridSize records, row-major, gx FASTEST (heightmap.u16 order):
  u8 count, count x i16 floor Z (L2 world, ASCENDING, deduped within 8)
```

A "floor" is a triangle whose geometric normal points up by at least 0.5;
walls and undersides floor nothing. Heights are sampled at the grid points
themselves (the terrain vertices), so the raster and the heightmap address
exactly the same lattice.

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
