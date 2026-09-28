# Lineage 2 Interlude map (.unr) format — deep-parse notes

Reverse-engineered in this spike from the live client files in
`assets/interlude/maps/` (157 tiles), cross-checked against the decrypted
`Engine.u` script sources and validated against four tiles:
**16_10** (off-world GM-room tile — not Talking Island; see
`docs/tile-map.md`), **17_23**, **19_22**, **21_16**
(mountainous). Tools built: `tools/maps/unrparse.py`, `tools/maps/unrmap.py`,
`tools/maps/propscan.py`.

## 1. Container: encrypted UE2 package, version 123

- Files are XOR-encrypted `Lineage2Ver111` (maps; `Ver121` for the tile
  texture packages). Decryption is already solved (`tools/bin/l2encdec`,
  `tools/utx/utxedit.py:decode_121` for 121; protocol 111 is handled by
  l2encdec).
- After decryption: standard Unreal package tag `0x9E2A83C1`,
  **FileVersion = 123** (not 117 like the .utx packages), LicenseeVersion
  25 (older tiles, e.g. 16_10) or 28 (newer tiles, e.g. 21_16).
- The `FPackageFileSummary`, name/import/export table layouts are **byte
  identical to v117** (the utxedit parser works unchanged once the version
  check is relaxed):

```
u32 tag=0x9E2A83C1, u16 FileVersion=123, u16 LicenseeVersion,
u32 PackageFlags, u32 NameCount, u32 NameOffset,
u32 ExportCount, u32 ExportOffset, u32 ImportCount, u32 ImportOffset,
byte[16] Guid, u32 GenerationCount, per generation: u32 ExportCount, u32 NameCount

Name   : cidx length (incl. NUL; negative = UTF-16), bytes, u32 flags
Import : nameidx ClassPackage, nameidx ClassName, i32 PackageIndex, nameidx ObjectName
Export : cidx ClassIndex, cidx SuperIndex, i32 PackageIndex, nameidx ObjectName,
         u32 ObjectFlags, cidx SerialSize, [cidx SerialOffset if SerialSize != 0]
```

`cidx` = FCompactIndex (first byte: bit7 sign, bit6 continue, 6 value bits;
continuation bytes add 7 bits each).

## 2. What a map contains (export classes)

Example 16_10 (556 exports): `TerrainInfo`×1, `TerrainSector`×256 (a 16×16
grid), `Brush`×35, `Model`×45 + `Polys`×45 (BSP), `Light`×25,
`StaticMeshActor`×22 + `StaticMeshInstance`×22, `AmbientSoundObject`×59,
`ZoneInfo`, `SkyZoneInfo`, `PlayerStart`, `Camera`, `BlockingVolume`,
`Projector`, `LevelInfo`, `Level` ("myLevel"), `LevelSummary`,
`PhysicsVolume`, plus L2-specific `NMovableSunLight`, `NSun`, `NMoon`.
21_16 (5993 exports) adds `L2FogInfo`, `Emitter`/`SpriteEmitter`/`BeamEmitter`,
`Mover`, `MusicVolume`, `WaterVolume`, `ReachSpec`.

## 3. Export body layout

### 3.1 Scripted actors (Light, ZoneInfo, StaticMeshActor, TerrainInfo, ...)

An export with `RF_HasStack` (`0x02000000`) begins with a serialized
`FStateFrame`. The bounded map reader admits this observed subset:

```
cidx Node                  (= export-table ClassIndex, nonzero)
cidx StateNode             (= export-table ClassIndex)
u64 ProbeMask              (= 0xffffffffffffffff)
u32 word28                 (preserved raw; no script meaning inferred)
cidx CodeOffset            (= -1)
<tagged property list>     (FPropertyTag stream)
<native tail>              (class-specific; empty for most actors)
```

The former `byte[5] ??` was a DWORD followed by a compact code offset.
`convert.py` now reuses `l2lib.read_state_frame` within the export boundary,
and terrain-zone extraction uses that same reader. References, mask, flag and
code offset are checked; unsupported frames return no admitted property start.
Header length follows the encoded references, **not the licensee version**.
For this subset it is `2 * len(cidx(ClassIndex)) + 13`. The general library
reader also handles a null Node, for which no CodeOffset is serialized; that
case is outside this map subset.

Fresh checks retain and round-trip all **2,922 StaticMeshActor frames** in
Talking Island (`17_25`) and Giran (`22_22`). Each is 15 bytes. Their raw DWORDs
have 159 and 296 distinct values respectively and are never zeroed or ignored.
[Source binding and commands](native-static-actor-bounds-evidence.md#saved-actor-frames-and-execution-reset)
distinguish the saved prefix from later `InitExecution`, which replaces the
frame. Neither a saved code offset nor a passing property parse proves current
script state.

`actor_prop_offset()` uses this strict path. `find_prop_start()` still has a
legacy property scan fallback for other callers; that fallback is not evidence
of original loading. The audited collision and terrain-zone readers require
the strict frame. The older census below records conversion history, not a
fresh certification of every actor class, map, property tail or live placement.

History, because this was got wrong twice and the second wrong answer was
written up here as if it were right:

* *2026-07-29 — first-clean-parse scan.* `find_prop_start` took the first
  offset in 0..24 that parsed. About a third of StaticMeshActors (699 of
  1936 on 22_22) carry bytes at offset ~10 that parse as a plausible
  1-property list, so the real list at 15 was never reached and the actor
  dropped out (no StaticMesh → no prop). 105 tiles had undercounted props
  (some −1500).
* *2026-07-29 — scored scan (the fix that was believed complete).* Score
  each candidate: has a `Location` property, then most properties, then
  longest span. This recovered the 699 and was documented here as the rule.
  It is still a heuristic choosing between coincidences, and it **still
  lost 5,593 placements world-wide** and resolved 14 more to the *wrong*
  mesh (a `StaticMesh` reference decoding to `ZoneInfo34`,
  `NMovableSunLight0`). A re-sync deeper into the body can parse cleanly,
  end exactly at the body end, AND carry more property tags than the real
  list while missing `StaticMesh` — the score prefers it. On 22_22 that is
  what dropped `Giran_Village_S.Giran_V_Plaza_Stair01`, the Giran plaza
  staircase the owner reported missing, plus 44 others.
* *2026-08-08 — derived offset.* Rule above. 162,745 usable
  StaticMeshActor placements vs the scan's 157,152, **none lost**. The
  scan survives only as the fallback for bodies that fail the header check.

Gate: `tools/world/prop_census.py --maps --check` (compares every .unr's
static-mesh actors against the shipped scene.json, per tile).

**Actor classes that place a StaticMesh.** Filtering on `StaticMeshActor`
alone also missed two whole classes, 1,202 placements world-wide:
`Mover` (553 — the clan-hall/castle/dungeon doors, `Door_Set_S.*`; their
serialized `Location` equals their `BasePos`, i.e. keyframe 0 = closed) and
`MovableStaticMeshActor` (649 — L2's scripted lifts and rotating machinery;
identical `StaticMesh`/`Location`/`DrawScale3D` fields to a plain
StaticMeshActor). Both are ordinary drawn geometry in retail. See
`convert.py` `STATIC_MESH_ACTOR_CLASSES`.

### 3.2 Fully native exports (no property list)

`Level` (myLevel), `Model`, `Polys`, `TerrainSector`,
`StaticMeshInstance`, `AmbientSoundObject` (props at +0), `LevelSummary`
(props at +0).

`Level` body starts `00, i32 N, i32 N, then a compact-index list`
(object references; N = 59 = ambient sound count in 16_10 — likely the
actor index lists; not fully decoded).

`Model` and `Polys` **are** decoded now (2026-08-07) — see §3.3. Their
bodies do begin with a property stream, but it only ever holds the
terminating `None`, which is why they read as "fully native" above.

### 3.3 Model / Polys — the BSP (SOLVED)

Reader: `l2lib.read_model()` / `l2lib.read_polys()` / `l2lib.level_model()`.
The full field-by-field layout, the flag derivations and the byte-consumption
evidence live in the "UModel / UPolys" block comment of
`tools/l2lib/ue2package.py`; the converter is `tools/world/bsp.py` and the
output contract is in `tools/world/README.md` ("bsp.gltf contract").

The shape of the answer:

- A tile carries **one UModel + one UPolys per Brush actor** (the brush
  *shape*, in brush-local space) **plus exactly one level UModel** — the
  post-CSG world BSP the retail engine rasterises. The level model is the
  only one with `NumZones > 0`, and its `Points` are already **world
  coordinates**: no brush `Location`/`Rotation`/`PrePivot` placement is
  involved (verified — 22_22's `Giran_wall07` surfaces land at world
  x 77403..85821, y 144778..152447, on top of the Giran props).
- `UModel::Serialize` = property stream, `FBox`+`FSphere`, then `Vectors`,
  `Points`, `Nodes` (`FBspNode`), `Surfs` (`FBspSurf`), `Verts` (`FVert`),
  `NumSharedSides`, `NumZones` + `FZoneProperties[]`, the `Polys` ref,
  `Bounds`, `LeafHulls`, `Leaves`, `Lights`, `RootOutside`, `Linked`, then
  the lightmap tail.
- A node is a convex polygon: `Verts[iVertPool .. +NumVertices) -> Points`,
  wound CCW about the node plane (measured on 9082 node polygons over three
  tiles — Newell normal agrees in sign with the plane on every one).
- Texture mapping:
  `U = dot(P - Points[pBase], Vectors[vTextureU])` in texture pixels (the
  texture-axis `Vectors` are deliberately non-unit; their length is the
  scale), same for V.
- Two serialisation variants exist and are **detected**, not assumed:
  `LicenseeVersion <= 20` (12 of the 157 shipped maps) has no FPoly
  `LightingChannels` and no FBspSurf `iLightmapIndex`.

Verification bar met: byte consumption is **exact** for all 18 861 `Polys`
exports (108 390 polygons) and all 18 704 brush `UModel`s across all 157
`.unr` files; the 157 level models parse with every structural invariant
holding (unit planes, in-range indices, zone actors resolving to
ZoneInfo/SkyZoneInfo, `Polys` ref resolving to a Polys export).

**Still not decoded:** the level model's lightmap tail (an
`FLightMapIndex` array + the raw `LightBits` blob, ~1.8 MB on 17_25).
Baked lighting is out of scope for the web port; `Model.lightmap_tail`
reports its size rather than pretending to read it.

## 4. TerrainInfo

### 4.1 Properties (decoded in full)

| Property | Type | Notes |
|---|---|---|
| TerrainMap | Object | texture ref `<tile>` — in package `T_<tile>` (newer tiles) or the missing package `Height` (older tiles) |
| TerrainScale | Vector | `(128.0, 128.0, 76.0)` everywhere observed |
| Layers ×8..15 | struct TerrainLayer | nested tagged props, see below |
| DecoLayers | Array | decoration layers (static mesh scatter) |
| QuadVisibilityBitmap / EdgeTurnBitmap (+`Orig` copies) | Array | compact count 2048 + 2048 little-endian uint32 words (8194 bytes total); visibility indexing verified against each map's saved sectors, diagonal interpretation unknown |
| MapX, MapY | Int | tile grid indices (16, 10 for 16_10 ✓) |
| GeneratedSectorCounter | Int | 256 |
| NumIntMap | Int | 8 |
| TIntMap | Array | 528537 bytes = 8 `TerrainIntensityMap` structs `{f32 Time; array<BYTE> Intensity}` — time-of-day intensity maps (from Engine.u script source), **not** heights |
| TickTime | Float | 15.0 |
| Location | Vector | world position of the tile center |

`TerrainLayer` struct (matches the script definition in Engine.u exactly):
`Texture` (Material ref), `AlphaMap` (Texture ref), `UScale`, `VScale`,
`UPan`, `VPan` (floats), `TextureMapAxis` (byte), `TextureRotation` (float),
`LayerRotation` (Rotator), `TerrainMatrix` (Matrix), `KFriction`,
`KRestitution` (floats), `LayerWeightMap` (Texture), `Scale` (Vector),
`ToWorld[4]`, `ToMaskmap[4]` (Vectors), `bUseAlpha` (bool).

### 4.2 Native tail (after the `None` property terminator)

```
cidx 256                       ; TerrainSector reference count
cidx × 256                     ; object refs (export index+1) to TerrainSector0..255
i32 16, i32 16                 ; sector grid dimensions
~100 bytes of mixed fields     ; includes f32 128.0 (quad size), f32 2048.0
                               ; (sector world size), f32 0.296875,
                               ; f32 cornerX, f32 cornerY  (tile corner in
                               ; world coords — verified: (21-20)*32768=32768,
                               ; (16-18)*32768=-65536 for 21_16),
                               ; f32 ≈minZ, f32 0.0078125 (=1/128)
byte[262144]                   ; 65536 cells × 4 bytes; uniform 00 00 FF 00
                               ; on a plain tile, ~55 non-zero cells on 21_16.
                               ; Purpose unknown (likely per-cell flags/overlay).
```

## 5. TerrainSector (fully native, ~2958–3390 bytes, variable)

```
cidx None, cidx TerrainInfo  ; property terminator name, owner object reference
i32 quadsX, i32 quadsY       ; usually 16; outer sectors use 15 at grid offset 240
i32 gridX, i32 gridY         ; sector origin in quads (e.g. 176, 224 = sector (11,14))
f32 × 6                      ; FBox bounding box (min XYZ, max XYZ) — matches
                             ; corner + grid×128 in X/Y exactly (verified)
u8 valid                     ; FBox validity flag (1 on the measured sectors)
byte[middle]                 ; variable, several small
                             ; cidx-counted blocks — NOT decoded
8 × { cidx 289, byte[289] }  ; eight 17×17 per-vertex byte arrays; exact
                             ; lighting/layer meanings not established here
byte[64]                     ; purpose unknown; not part of the following array
cidx 256                     ; exactly two bytes: 40 04
u16 × 256                    ; 16×16 per-quad table in local row-major order;
                             ; zero/nonzero matches invisible/visible source
                             ; quads. Other value semantics remain unknown.
```

The earlier interpretation of the last 578 bytes as 289 signed vertex values
was incorrect. The last 514 bytes are a compact count plus 256 unsigned quad
values; the preceding 64 bytes remain opaque. Exact byte accounting in the
original four-tile parser did not establish those field meanings.

A separate source check on `17_25`, `22_22` and `24_18` matched the native
sector XY bounds and covered all 65,025 ordinary quads per map exactly once.
For global quad `(x,y)`, the bit at `y*256+x`, least-significant bit first,
is 1 exactly when the saved table entry is nonzero. Current and `Orig`
visibility agree on all 195,075 checked quads; hidden counts are respectively
0, 3,814 and 6,511. Transposed indexing and reversed bit order disagree on
the nonuniform maps. A further read-only check of 100 source maps matched
current visibility on all 6,502,500 ordinary quads, but `22_19` has 430
disagreements with its `Orig` visibility array. Therefore
`tools/world/terrain_topology.py` verifies each map separately and leaves
incomplete or disagreeing evidence unverified.

This evidence covers only quads with `x,y` in `0..254`. It does not establish
the bitmap's outer row/column semantics, the native cross-map boundary
algorithm, or which diagonal an `EdgeTurnBitmap` bit selects. All four raw
bitmap arrays are preserved without assigning those unknown meanings.
[Epic's UE2 terrain documentation](https://docs.unrealengine.com/udk/Two/EditingTerrainMaps.html)
confirms that visibility controls missing, non-solid terrain and edge turns
change triangle diagonals; the saved native table supplies the independent
visibility indexing evidence. See `tools/world/README.md` for the sidecar
contract and verification gate.

## 6. THE HEIGHTMAP — solved (not in the .unr)

The terrain height grid is a **G16 texture named after the tile inside
`assets/interlude/textures/T_<tile>.utx`** (e.g. `T_21_16.utx` → Texture
`21_16`, 131141 bytes). The .unr's `TerrainMap` property references exactly
this texture (older maps point at a `Height` package alias that the tile
.utx re-exports as a 1-byte `Package` export named `Height`).

- Texture body is v123-native (no standard tagged props at offset 0 for the
  tile packages); the 131072-byte G16 payload (256×256 **unsigned** 16-bit,
  little-endian) is preceded by the 4-byte marker **`00 40 80 10`**
  (same trick the Java `L2TerrainExtractor` uses). Marker offsets observed:
  55, 61, 62, 65, 72 depending on tile.
- World mapping (validated against the union of all 256 TerrainSector
  bounding boxes of 21_16: predicted −4831..+1797, bbox union −4761..+1194):

```
tile (tx,ty) corner world X0 = (tx-20)*32768,  Y0 = (ty-18)*32768
vertex spacing  = TerrainScale.X/Y = 128   (256×256 samples per tile)
worldZ(x,y)     = TerrainInfo.Location.Z + (h[x,y] - 32768) * TerrainScale.Z / 256
```

- The same `T_<tile>.utx` also carries the terrain texturing set: layer
  textures (`*_C`, `*_G`, `*_R`, `layer0`...), 512×512 splat/blend maps
  (`*_S`, `*_S1..S5`), deco maps (`*_Deco00x`), referenced from the
  TerrainInfo `Layers[]` structs.
- Note: `t_16_10.utx`'s heightmap is a constant 16384 (flat at z≈−5024.7).
  Resolved: 16_10 is the off-world **GM room** tile (aCis zones `gm_room*` /
  `gm_prison` fall in its rect), so a flat stub is expected — see
  `docs/tile-map.md`. 3 other tiles (17_23, 19_22, 21_16) carry real,
  smoothly varying height data.

### 6.1 The heightmap is the NATURAL ground — the BSP floors sit ON it

The heightmap is not "the ground the player sees" in a town. It is the
terrain surface, and a town square is a stone slab **built on top of it** as
level BSP (section 3.3). All three surfaces are simultaneously correct, and
they are three different numbers. Measured at the Giran square (22_22,
world x 82000 y 148000):

| surface | z |
|---|---|
| `heightmap.u16` — natural ground, under the slab | **-3600.8** |
| level BSP slab top (`Giran_floor03`/`Giran_floor04`) | **-3496** |
| aCis geodata (walkable) | **-3464** |

The geodata stands +32 over the SLAB, which is the same measured
geodata-over-drawn-surface band (+26.9..+34.2, one CELL_HEIGHT wide) that
holds over plain terrain in open country — see `editor/world/js/geodata.js`,
`GEO_ANCHOR_MAX`. That is the evidence that at a town square the geodata is
describing the pavement, not the heightmap: over 60,092 candidate cells on
the 100 converted tiles, the gap `geodata pick - nearest BSP floor` spikes
hard on +32 (4-unit bins: +28:4447 **+32:20027** +36:7074, falling to a
~100/bin background by +48).

Reading the heightmap as "wrong wherever it disagrees with geodata by
metres" therefore mis-reads every town square: the client's stale-rectangle
correction did exactly that and drew dirt terrain over 11,942 grid points of
decoded pavement on 47 tiles. The per-grid-point BSP floor heights are now
extracted to `assets/world/<tile>/bspfloor.bin`
(`tools/world/bspfloor.py`, contract in `tools/world/README.md`) and the
correction consults them — `editor/world/js/heightfix.js`, hazard 3.
Re-runnable measurement: `node tools/world/verify_bspfloor.mjs`.

Extraction tool: `tools/maps/unrmap.py terrain <tile>` →
`tools/maps/out/<tile>.heightmap.{u16,png,json}` (raw LE u16, normalized
PNG, world-space vertex-grid JSON). Rendered PNGs of 21_16 and 19_22 were
inspected visually and show clear terrain relief (ridges, valleys, crater).

## 7. Map → asset manifest

`tools/maps/unrmap.py refs <map.unr>` writes `tools/maps/maps/<tile>.refs.json`:

- full import table with the **outer package resolved** (walk of
  `Import.PackageIndex`): exactly which `.utx` (textures, e.g. `T_21_16`,
  `oren_ded_t`), `.usx` (static meshes, e.g. `Fieldstone`,
  `Rune_Village_S`) and sound packages the tile needs;
- `terrain_map_ref`, `terrain_location`, `terrain_scale`;
- every `StaticMeshActor` with mesh ref + `Location` (Vector) + `Rotation`
  (Rotator) + `DrawScale` — 742 placements decoded in 21_16, 440 in 17_23.

## 8. Still unknown / not yet decoded

- The final 5 bytes of the actor header (§3.1) — constant-ish tail `.. 81`,
  two varying compact-looking values; no semantic assigned.
- TerrainSector `middle` blocks, the 64 bytes before its final array, and
  meanings of the 256 unsigned quad-table values beyond zero/nonzero
  visibility (§5). Native edge-turn diagonal and boundary rules remain unknown.
- The 262144-byte per-cell block in the TerrainInfo tail.
- ~~`Model`/`Polys` BSP geometry (buildings constructed from brushes)~~ —
  **SOLVED 2026-08-07, see §3.3** (only the lightmap tail is left).
  `StaticMeshInstance` body, `Level` actor lists.
- Emitter/Mover/L2FogInfo native tails (props parse; tails skipped).
- The slight mismatch between heightmap-derived max Z and sector-bbox max Z
  (1797 vs 1194 in 21_16) — bboxes may not cover all vertices, or the
  constant in the Z formula differs; needs one more cross-check (e.g.
  against geodata).

## 9. Assessment: can we rebuild a walkable visual map in three.js?

**Yes for terrain + statics, with today's decode level:**

- Heightmap → 256×256 vertex grid per tile with the validated world
  transform (§6) → `THREE.PlaneGeometry` displacement or direct
  `BufferGeometry`; tiles stitch on the world grid.
- Texturing: TerrainInfo `Layers[]` + the `T_<tile>.utx` splat maps and
  layer textures (already decodable with `tools/utx/utxedit.py` + the
  30k-texture library in `assets/library/`).
- Static meshes: `refs.json` gives placements; the `.usx` meshes themselves
  are readable by umodel (`-game=l2`) and our char pipeline already converts
  UE2 meshes to glTF — same path applies to static meshes.
- Walkability: use the aCis geodata
  (`server/aCis_gameserver/build/dist/gameserver/data/geodata/<tile>_conv.dat`)
  which covers the same grid — no need to derive collision from the BSP.
- Remaining gaps for full visual parity: emitters/particles, baked lighting
  (TerrainSector per-vertex arrays + TIntMap time-of-day maps).

## 10. Verification log

- Parsed without errors: 16_10, 17_23, 19_22, 21_16 (all 256 TerrainSectors
  each, exact byte accounting), plus `T_*.utx` height packages.
- `tools/maps/maps/{16_10,17_23,21_16}.refs.json` written.
- `tools/maps/out/{16_10,17_23,19_22,21_16}.heightmap.{u16,png,json}` written;
  PNGs visually confirmed as terrain.
- TerrainLayer struct decode matches the `Engine.u` script definition
  (decrypted with l2encdec, strings extracted) field-for-field.
