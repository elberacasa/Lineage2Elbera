# Foundation audit — visual fidelity vs the source data

> **STATUS 2026-08-08 — F1, F2, F3, F4 APPLIED** (F4's client wiring by a
> parallel agent, commit `4e93960`; see the F4 section for what was
> consolidated and what is still open).
> See the "Applied" section at the end of this document for what changed,
> the gate results, the measured improvements, and the one place where this
> document's fix specification turned out to be **wrong** (F1's roll sign).
> The full derivation lives in `docs/world-prop-basis.md`.
>
> **STATUS 2026-08-08 — F5 RESOLVED.** Closed as **NOT A DEFECT** for
> characters: `nativeHeight` is right, and `2 × collision height` was the
> wrong expectation (the collision cylinder is an authored Unreal bound, and
> the retail pawn classes set no `DrawScale`). The same decode turned up a
> real defect one step over — monster/NPC `nativeHeight` omits the retail
> per-class `DrawScale` — filed below as **F5b**. No model file was
> rebuilt. Gate: `tools/src/char_pipeline/audit_native_height.py --check`.

Adversarial audit run 2026-08-07. The question asked of every claim was not
"does a suite pass" but **"does the rendered result equal the decoded source
value"**. Everything below is either PROVED (a decoded number, a byte-level
match, or a screenshot that was actually opened and inspected) or marked
SUSPECT with the reason it could not be closed.

Scope covered: world prop conversion + placement, prop/terrain/character
material state and colour space, the character rebuild done this session,
and the client light rig. Not covered (owned by other workers this session,
or out of time): geodata heights, terrain splat weights, the BSP/brush
buildings, the UI port, HD texture set.

Read-only audit: **no existing file was modified.** New files added:

| file | what it is |
| --- | --- |
| `tools/src/char_pipeline/audit_prop_materials.py` | re-runnable gate: prop surfaces that render 100% invisible; `--shaders` cross-checks every prop material against the retail UE2 `Shader` properties |
| `tools/src/char_pipeline/audit_prop_basis.py` | re-runnable gate: proves, per staticmesh package, which coordinate basis the converted glTF is in, using a umodel `-psk` export as the oracle |
| `editor/world/audit_shots.js` | camera-staged screenshot harness for arbitrary L2 coordinates, with an optional in-page `--eval` patch for A/B |
| `editor/world/audit_shots/*.png` | the screenshots referenced below |

Added by the F5 resolution pass (2026-08-08):

| file | what it is |
| --- | --- |
| `tools/src/char_pipeline/uclass_defaults.py` | decodes `defaultproperties` out of a UE2 `UClass` export — the only source for the retail client's `CollisionHeight`/`CollisionRadius`/`DrawScale` |
| `tools/src/char_pipeline/audit_native_height.py` | re-runnable gate: pawn `DrawScale`, aCis class XML vs the client, shipped `nativeHeight` vs an independent retail re-measurement, and the shared-mesh `DrawScale` test; `--emit-npc-scale` regenerates the NPC table |
| `tools/src/char_pipeline/scale_check.js` + `.html` | orthographic elevation of characters against retail weapons/props in raw L2 units; `--check` asserts the client's scaling rule lands on the shipped `nativeHeight` |
| `tools/src/char_pipeline/f5_scale_check.png` | that render, inspected |
| `editor/characters/monsters/npc-scale.json` | per-`npcId` retail `DrawScale` (666 entries), generated |

---

## Ranked findings

### F1 — PROVED. Every world prop is rendered as its own mirror image (determinant −1 basis)

**Severity: highest.** It is not a subtle shading error: 5,766 prop
placements are also *bodily displaced* by more than 2 m as a side effect,
up to 52 m.

**Evidence (data, not opinion).**

umodel's glTF exporter converts UE space with a *swap*, which is a
reflection, and it scales to metres:

```
tools/src/UEViewer/Exporters/ExportGLTF.cpp:59
    inline void TransformPosition(CVec3& pos)
    {
        Exchange(pos[1], pos[2]);      // (x,y,z)_UE -> (x,z,y)   det = -1
        pos.Scale(0.01f);
    }
```

`tools/world/convert.py:744 umodel_export_package` ships that output
untouched (`patch_gltf_textures` only wires images). The client then places
those meshes with `l2ToThree`, which is the *proper* map:

```
editor/world/js/coords.js:18 (`l2ToThree`)    (x, y, z)_L2 -> (x, z, -y)_three   det = +1
```

The two bases differ by `diag(1, 1, -1)`. That is why
`Terrain.ueQuaternion` has to negate yaw and roll to make the town line up:

```
Terrain.ueQuaternion (editor/world/js/terrain.js, currently :714)
    qYaw  : axis (0,1,0), angle  -yaw
    qPitch: axis (0,0,1), angle  +pitch
    qRoll : axis (1,0,0), angle  -roll
```

Those signs are exactly `S·R·S` for `S = diag(1,1,-1)` (a reflection leaves
a rotation about Z alone and negates rotations about X and Y — pitch is the
unchanged one, and it is the one the code does *not* negate). The comment
above that function asserts the basis map is "a reflection"; it is not —
`(x, z, −y)` has determinant **+1**. The reflection is in the *mesh data*,
not in the placement map.

Byte-level confirmation, using umodel's own psk exporter as the oracle
(psk is UE space with one documented Y mirror,
`Exporters/ExportPsk.cpp:21 #define MIRROR_MESH 1`):

```
$ python3 tools/src/char_pipeline/audit_prop_basis.py --tiles 22_22 --check
giran_village_s   Giran_V_Plaza_Wall04   mirrored  54/54 verts
manor_system_object_s Manor_Giran        mirrored  3288/3288 verts
world_bridge_s    Innadrile_Bridge_A     mirrored  2666/2674 verts
... 17 packages
mirrored (glTF z == +UE y, determinant -1): 17
proper   (glTF z == -UE y, determinant +1): 0
unknown                                   : 2      <- Y-symmetric meshes, no information
FAIL: 17 prop package(s) are in the reflected basis
```

(For `Giran_V_Plaza_Wall04`: 54/54 vertices match `(x, z, −y_psk)`, 0/54
match `(x, z, +y_psk)`.)

**The character pipeline already got this right and documents the exact same
fact** — so this is a world-side regression against a known-good precedent:

```
tools/src/char_pipeline/assemble.py:363-372
  ExportPsk.cpp MIRRORS the mesh on export ... composed with that mirror the
  net UE->glTF map is (x, z, y), determinant -1.  So the psk ...
  [pipeline uses] the proper rotation S=(x,z,-y) with quaternion map
  (x,z,-y,-w) [and reverses triangle winding]
```

**Visible consequence, measured.** The mirror is about each prop's own
pivot, so any mesh not centred on its pivot in that axis moves bodily by
`2·|centroid_z|`:

| tile | placements moved > 0.5 m | > 2 m | worst |
| --- | --- | --- | --- |
| 23_24 | 559 | 437 | 36.6 m (`Innadrile_Sideblock02_01`) |
| 21_16 | 469 | 207 | 41.1 m (`rune_main01_C1`) |
| 23_22 | 268 | 154 | 52.1 m (`Main_Gate_Tower`) |
| **all 100 tiles** | **19,657** | **5,766** | |

Screenshot A/B (`editor/world/audit_shots/mir_pair_crop.png`, top = shipped,
bottom = rebuilt with the determinant +1 placement in-page): 19.2% of pixels
change, and the Giran-castle outer wall presents a completely different face
— the shipped view shows a blank block wall, the corrected one an arrow-slit
bay. **Visual judgement caveat:** this pair proves the *magnitude* of the
difference; it is not a comparison against a retail screenshot, because the
in-page rewrite cannot also fix the winding, so the corrected shot is lit
wrongly. The proof that the shipped one is the reflected variant is the
byte-level psk match above, not the picture.

**Fix specification.**

1. In `tools/world/convert.py`, after `umodel_export_package` and before/next
   to `patch_gltf_textures`, post-process each prop `.gltf`+`.bin`:
   - negate `POSITION.z`, `NORMAL.z`, `TANGENT.z`, and negate `TANGENT.w`
     (bitangent handedness flips with the axis);
   - reverse each triangle's index order (swap indices 1 and 2 of every
     triple) — required because the correction is determinant +1 and umodel
     relied on the reflection to land on glTF's CCW front face;
   - update every POSITION accessor `min`/`max` (`min.z`/`max.z` swap and
     negate).
   Regenerate the `assets/world/*/props/*.gltf` set. `scene.json` is
   untouched — the frozen contract does not change.
2. `Terrain.ueQuaternion` (`editor/world/js/terrain.js`, currently :714) becomes
   `yaw: +yaw about (0,1,0)`, `pitch: +pitch about (0,0,1)` (unchanged),
   `roll: +roll about (1,0,0)`; composition order `qYaw·qPitch·qRoll` is
   already correct for UE (roll→pitch→yaw applied to the object).
   Derivation for the record, with `M = (x,y,z)_L2 → (x,z,−y)`:
   UE yaw is a right-handed rotation about `+Z_L2` → `M(+Z) = +Y_three`;
   UE pitch, from `FRotationMatrix`, is right-handed about `−Y_L2` →
   `M(−Y) = +Z_three`; UE roll is right-handed about `+X_L2` → `+X_three`.
3. Re-run `audit_prop_basis.py --check` (expect `mirrored: 0`) and
   `winding_check.py --majority` over the regenerated props.
4. Fix F2 below in the same pass — it lives in the same two lines.

Suggested gate: `audit_prop_basis.py --check` in the world-conversion
battery.

---

### F2 — PROVED. Prop `scale` is applied on the wrong axes; 308 props are flipped vertically instead of horizontally

`scene.json` stores scale in **L2 axis order** — it is written as
`[ds*d3.x, ds*d3.y, ds*d3.z]` straight from the actor's `DrawScale` and
`DrawScale3D` (`tools/world/convert.py:1029`, in `convert_props` — sourced, correct). The
client then applies it in **three axis order** with no remap:

```
Terrain._propMatrix   (editor/world/js/terrain.js, currently :762-764)
    const [sx, sy, sz] = p.scale || [1, 1, 1];
    return out.compose(pos, quat, new THREE.Vector3(sx, sy, sz));
Terrain._loadPropsRaw (editor/world/js/terrain.js, currently :864-865)
    obj.scale.set(sx, sy, sz);
```

Since `M` maps `L2 y → three −z` and `L2 z → three y`, the correct
assignment is `three (sx, sz, sy)`. Measured over all 100 tiles:

| condition | placements |
| --- | --- |
| `scale.y != scale.z` (the swap changes the result) | **3,025** |
| exactly `(1, −1, 1)` — retail mirrors the prop in Y | **308** → rendered mirrored **vertically** (upside down) instead |
| exactly `(−1, 1, 1)` | 1,431 → unaffected by the swap (X is common to both bases) |
| negative determinant overall | 1,849 |

Worst examples: `25_14` has 43 props at `(1.5, 1.5, 3.0)` — meant to be 3×
*taller*, currently 3× *longer*; `20_20` has 48 at `(1.0, 1.5, 1.0)`.

**Fix specification.** Both call sites become `new THREE.Vector3(sx, sz, sy)`
/ `obj.scale.set(sx, sz, sy)`. Do this **together with F1** — once the prop
meshes are in the proper basis this is the whole of the change; if F1 is
fixed alone the `(1,−1,1)` cases will still be wrong, and if F2 is fixed
alone the `(1,−1,1)` cases will start being wrong in a new way. Note the
1,849 negative-determinant placements will flip triangle winding at draw
time; three.js does not compensate, so those props also need
`material.side` handling or per-instance normal correction — that is a
follow-on, not part of the axis fix.

---

### F3 — PROVED. 1,131 prop surfaces render 100% invisible because the converter guesses alpha semantics instead of reading the retail Shader

**The guess.** `patch_gltf_textures` (`tools/world/convert.py:945-948`) marks a material
alpha-cutout whenever ≥1% of its texture's texels have alpha < 128
(`png_has_significant_alpha`, line 762):

```python
if has_alpha:
    m["alphaMode"] = "MASK"
    m["alphaCutoff"] = 0.5
    m["doubleSided"] = True
```

and the client then re-imposes the same cutoff on *everything* textured:

```
Terrain._prepMaterials (editor/world/js/terrain.js, currently :752)
    if (m.map) { m.alphaTest = 0.5; m.side = THREE.DoubleSide; }
```

**Why that is wrong.** In L2 the alpha channel is only a cutout mask for
alpha-tested materials. For the rest it is a specular mask or a
self-illumination mask — the same hazard `docs/HANDOFF.md:503` already
records for character `_sp` textures, never applied to the world path. The
retail material states it exactly, and l2lib already decodes it. Property
sets actually present in one package:

```
$ giran_village_t.utx — 31 Shader exports
  14 x (Diffuse, SelfIllumination, SelfIlluminationMask)   -> OPAQUE + emissive
   6 x (Diffuse, OutputBlending, TwoSided)                 -> blended pass
   5 x (Diffuse, OutputBlending)                           -> blended pass
   2 x (Diffuse, Specular, SpecularityMask)                -> OPAQUE, alpha = spec mask
   2 x (Diffuse, Opacity, OutputBlending, Specular, SpecularityMask, TwoSided)
   1 x (Diffuse, TwoSided) ;  1 x (Diffuse, Specular)
$ innadrill_tree_t.utx — the genuinely masked ones
  18 x (AlphaRef, AlphaTest, Diffuse, Opacity, TreatAsTwoSided, ZWrite)
```

Decoded values, e.g.:

```
Giran_wall08_light   class=Shader  Diffuse=03  SelfIllumination=03  SelfIlluminationMask=03
inna_Stree_leaf_1    class=Shader  AlphaTest=True  AlphaRef=0x0a (=10/255=0.039)  TreatAsTwoSided=True
inna_Spalmtree02_B1_1                AlphaRef=0x1e (=30/255=0.118)
```

`Giran_wall08_light` is an **opaque** wall with an additive window glow.
Its texture `Giran_wall08.png` is a brown stone diffuse (mean RGB
113/77/52) whose alpha peaks at **119/255 = 0.467** — below the invented
0.5 cutoff, so *every texel is discarded*.

**Measured impact (whole world).**

```
$ python3 tools/src/char_pipeline/audit_prop_materials.py --check
  materials with a baseColor texture : 75650
    marked alphaMode MASK            : 9440
    of those, 100% invisible         : 209 material(s) in 142 prop glTF(s),
                                       1131 placement(s)
  worst tiles: 24_17 (492), 22_16 (188), 26_14 (117), 22_25 (84),
               19_16 (54), 23_14 (50), 21_16 (27), 22_22 (26)
```

Affected in Giran alone: `Giran_V_Entrance02` (the village gate),
`Giran_Agit_body` (clan hall), `Giran_House01`, `Giran_V_AccessaryShop`,
`Giran_V_GroceryShop_Top`, `Giran_V_MagicShop_Top`, `Giran_V_Plaza_Pole01`.

**Screenshot proof (inspected).**
`editor/world/audit_shots/ab_before_volcano_stone.png` vs
`ab_after_volcano_stone.png` — single page session, identical camera, only
`alphaTest` changed on the 4 volcano materials (164 material instances
patched). Before: the volcanic plain of tile 24_17 is **completely bare**.
After: dozens of boulders appear, including three large ones in the
foreground. 424 of the 492 invisible placements on that tile are these
rocks. Crop pair: `audit_shots/alphacut_pair_crop.png`.

**Secondary, same root cause — erosion of every leaf card.** Retail
`AlphaRef` for foliage is 10 or 30 out of 255 (0.039 / 0.118); the pipeline
cuts at 0.5. Median masked-area loss across 425 MASK materials sampled in
16_24 + 22_22 is **5%** of the surviving leaf area, concentrated at the soft
edges where it is most visible.

**Tertiary — `doubleSided` is guessed too.** `--shaders` on tile 22_22 alone
reports **409** materials whose shipped `alphaMode`/`alphaCutoff`/`doubleSided`
disagrees with the retail Shader, e.g.:

```
Giran_StLight01  StLight03_light   alphaMode MASK but retail opaque (Diffuse+SelfIllumination+SelfIlluminationMask);
                                   doubleSided True but retail two-sided False
interior_A_102   z_A_flag06        alphaMode MASK but retail blend  (Diffuse+OutputBlending+TwoSided)
girantree1       girantreeleaf1_1  alphaCutoff 0.500 but retail AlphaRef 0.039
```

**Fix specification.**

1. In `tools/world/convert.py`, replace `png_has_significant_alpha` with a
   read of the material's own retail state. `PropTextureResolver` already
   resolves a material name to its `(package, export)` in the client `.utx`
   (`_index_client_utx`), so the Shader properties are one
   `read_properties()` away. Map:

   | retail properties | glTF |
   | --- | --- |
   | `AlphaTest` true | `alphaMode: "MASK"`, `alphaCutoff = AlphaRef/255` (default 0 when `AlphaRef` absent) |
   | `SelfIllumination(+Mask)` | `alphaMode: "OPAQUE"`; emit `emissiveTexture` = the same image, `emissiveFactor [1,1,1]` (the alpha is the mask — needs a one-channel-to-RGB bake, or `KHR_materials_emissive_strength` with a baked emissive PNG) |
   | `Specular` + `SpecularityMask` | `alphaMode: "OPAQUE"`; alpha carries no coverage |
   | `OutputBlending` present, no `AlphaTest` | `alphaMode: "BLEND"` (decode the `OutputBlending` enum for additive vs translucent before choosing) |
   | `TreatAsTwoSided` or `TwoSided` | `doubleSided: true`, otherwise `false` |

   Minimum viable first step, if the emissive pass is deferred: for every
   material that is **not** `AlphaTest`, set `alphaMode: "OPAQUE"`. That
   alone makes all 1,131 placements visible again with the correct diffuse.
2. In `Terrain._prepMaterials` (`editor/world/js/terrain.js`, currently :752), stop overriding: delete the blanket
   `m.alphaTest = 0.5; m.side = THREE.DoubleSide;` and let `GLTFLoader`
   apply the glTF's own `alphaMode`/`alphaCutoff`/`doubleSided`. Otherwise
   the client silently discards any corrected cutoff.
3. Gate: `audit_prop_materials.py --check` (fails on any fully-invisible
   surface) plus `--shaders` in the world battery.

---

### F4 — PROVED (data), unquantified visually. The client light rig, fog and ambient are invented; the retail values are in the map file and decode cleanly

`editor/world/js/main.js:68,102-116` hard-codes a sky gradient, `Fog(60,
420)`, `AmbientLight(0xcfd4de, 0.55)`, `HemisphereLight(0xbcc8e0, 0x40382e,
0.85)`, `DirectionalLight(0xfff0d8, 2.2)` and
`SUN_DIR = (0.5, 1.0, 0.35)`. None of it comes from the source.
`tools/world/convert.py` extracts `TerrainInfo`, `StaticMeshActor` and
`WaterVolume` and ignores every lighting actor.

Class census of `assets/interlude/maps/22_22.unr` (decoded with l2lib):

```
Light 91 · ZoneInfo 17 · NMovableSunLight 1 · NSun 1 · NMoon 1 · SkyZoneInfo 1
```

Decoded (22_22 and 19_21 agree — the sun is global):

```
NMovableSunLight  LightBrightness 70.0   Rotation (pitch -8846, yaw 25324, roll 0)
                  = pitch -48.6 deg, yaw 139.1 deg
NSun              Radius 350.0  bDirectional  Rotation (-5944, -39696, 0)
ZoneInfo (terrain zone, 22_22)  bDistanceFog  DistanceFogEnd 15000.0  AmbientVector (0.360,0.360,0.360)
ZoneInfo (another 22_22 zone)   DistanceFogStart 500.0  DistanceFogEnd 16000.0
ZoneInfo (19_21 zones)          AmbientVector (0.277,...)  and (0.457,...)
```

Concrete divergences:

- **Fog far distance.** Retail Giran fogs out at 15,000 L2 units = **150 m**.
  The client uses **420 m** — 2.8× too far, so the horizon reads as a
  different world.
- **Ambient colour.** Retail is neutral grey `(0.36, 0.36, 0.36)` and
  varies per zone. The client is a fixed blue-tinted `0xcfd4de` ambient
  plus a blue/brown hemisphere — a global colour cast on every surface.
- **Sun direction.** Retail sun elevation is 48.6°; the client's
  `SUN_DIR` is 58.6°. The two unit vectors are ~5.7° apart in three space
  (retail `(0.500, 0.750, 0.433)`, client `(0.432, 0.864, 0.302)`) — close,
  but not sourced, and it will not track when other maps are added.
- **91 `Light` actors per map are dropped entirely.** The client instead
  invents torch lights from a material-name regex (`FLAME_MAT_RE`,
  `terrain.js`).

**Not closed:** I did not decode `LightBrightness`/`Radius` into a
photometric value comparable with a three.js intensity, and I did not
photograph a before/after — mapping UE2 light units onto the ACES-tonemapped
PBR rig needs a calibration pass that is a task in itself.

**Fix specification.** Add a `lights` extraction pass to
`tools/world/convert.py` (`NMovableSunLight` rotation + brightness, the
terrain `ZoneInfo`'s `AmbientVector` / `DistanceFogStart` / `DistanceFogEnd`
/ `DistanceFogColor` when present, and the `Light` actor list with
`Location`/`LightBrightness`/`LightRadius`/`LightHue`/`LightSaturation`).
`assets/world/<tile>/scene.json` is frozen — write these to a **new sibling
file** `assets/world/<tile>/lights.json` and have the client load it
alongside. Convert the rotator with the same `M` as F1 so the sun direction
lands in the corrected basis.

---

### F5 — RESOLVED 2026-08-08. NOT A DEFECT for characters (2× collision height was the wrong expectation). One real defect found next door: monster/NPC `nativeHeight` omits the retail `DrawScale`

> Closed with the pawn setup code the original audit said it needed. It was
> in the repo the whole time: `assets/interlude/system/LineageWarrior.u`.
> Gate: `tools/src/char_pipeline/audit_native_height.py --check`.
> Decoder: `tools/src/char_pipeline/uclass_defaults.py`.

**The premise was wrong on two counts.**

*It is not consistent.* Measured over all 14 pawns, not six, the ratio
`nativeHeight / (2 × CollisionHeight)` runs **0.9079 … 1.0000**, sd 0.0271 —
a 9-point spread, not a constant. And it inverts rank twice, which a
measurement of the same quantity cannot do: the cylinder says
`FFighter (47.0) > MFighter (46.0)` while the mesh says
`MFighter (45.96) > FFighter (44.20)`; the cylinder says
`MOrc (56.0) > FOrc (54.0)` while the mesh says `FOrc (53.87) > MOrc (52.43)`.

*It is not one-signed either.* For monsters the same ratio sits slightly
**above** 1 (median 1.014 over the 492 DrawScale-1 classes), so "always
short" is an artefact of looking only at players.

**What the retail client actually does**, decoded from the client's own
UnrealScript class defaults (`uclass_defaults.py` reads the packed
`defaultproperties` stream at the tail of each `UClass` export):

```
rendered height = mesh Z extent × ULodMesh.MeshScale.z × Actor.DrawScale
```

- `Engine.Actor` defaults `DrawScale = 1.0`, `DrawScale3D = (1,1,1)`
  (decoded from `Engine.u`).
- **None of the 14 player pawn classes overrides `DrawScale`** —
  `MFighter, FFighter, MMagic, FMagic, MElf, FElf, MDarkElf, FDarkElf,
  MOrc, FOrc, MShaman, FShaman, MDwarf, FDwarf` in `LineageWarrior.u`, nor
  their common parent `LineagePawn`. So for characters the rendered height
  *is* mesh extent × MeshScale, i.e. exactly `nativeHeight`.
- `MeshScale` itself is confirmed against the umodel oracle:
  `umodel -game=l2 -uc -export animations/Fighter.ukx MFighter_m001_u`
  writes `#exec MESH SCALE MESH=MFighter_m001_u X=1.03 Y=1.03 Z=1.03`,
  matching `scale_util.mesh_scale` byte for byte (FFighter: 1.0).
- `CollisionHeight` is the Unreal collision **cylinder** half-height —
  `Engine.Actor` ships 22, `Engine.Pawn` 78, and Lineage overrides it per
  class. It is an authored bound, not a measurement of the mesh.

**Where the server number comes from — it is the client's number.**
aCis `data/xml/classes/*.xml` `height`/`heightFemale`/`radius`/`radiusFemale`
are the client's `CollisionHeight`/`CollisionRadius` transcribed:
**35 of 36 values match exactly**. The one that does not is an aCis
datapack error, not a mesh problem: `orcMystic.xml height="27.5"` where the
client's `MShaman` has `CollisionHeight = 27.0`. (That is the row the
original F5 table listed as the worst offender, −8.9%; 0.5 of it is this
bug.) Server semantics confirmed in source, not from the wiki:
`GeoEngine.canSeeTarget` — `// Note: real creature height = collision
height * 2` — and `Player.getCollisionHeightBySex`.

**Full distribution** (`audit_native_height.py`, section C; the "retail"
column is an independent re-measurement from the pawn class's *own*
`Mesh` + `SubMeshes` list — the naked newly created character — via umodel
`.psk` points × `MeshScale`, so it owes nothing to the build pipeline's
armour choice):

| model | manifest | retail mesh | Δ | 2×CollH | ratio |
| --- | --- | --- | --- | --- | --- |
| human_fighter_m | 46.0 | 45.96 | +0.1% | 46.0 | 1.0000 |
| orc_fighter_f | 53.9 | 53.87 | +0.1% | 54.0 | 0.9981 |
| orc_mystic_f | 50.0 | 50.04 | −0.1% | 51.0 | 0.9804 |
| elf_m | 46.3 | 46.28 | +0.0% | 48.0 | 0.9646 |
| darkelf_m | 45.6 | 45.64 | −0.1% | 48.0 | 0.9500 |
| dwarf_m | 34.2 | 34.23 | −0.1% | 36.0 | 0.9500 |
| darkelf_f | 44.6 | 44.55 | +0.1% | 47.0 | 0.9489 |
| elf_f | 43.6 | 43.56 | +0.1% | 46.0 | 0.9478 |
| human_fighter_f | 44.2 | 44.20 | +0.0% | 47.0 | 0.9404 |
| orc_fighter_m | 52.4 | 52.43 | −0.1% | 56.0 | 0.9357 |
| orc_mystic_m | 50.1 | 50.10 | +0.0% | 54.0 | 0.9278 |
| human_mystic_m | 42.1 | 42.14 | −0.1% | 45.6 | 0.9232 |
| human_mystic_f | 41.3 | 41.27 | +0.1% | 45.0 | 0.9178 |
| dwarf_f | 34.5 | 34.46 | +0.1% | 38.0 | 0.9079 |

Every shipped `nativeHeight` reproduces the retail mesh to within ±0.1%.
**No character model was rebuilt and none needs to be.**

**Third oracle, independent of both sides.** `scale_check.js` renders the
character at its `nativeHeight` next to retail geometry in raw L2 units
(`tools/src/char_pipeline/f5_scale_check.png`, orthographic elevation,
rules every 10 units — the image was rendered and read, not assumed):

| retail object | L2 units | vs `human_fighter_m` = 46.0 |
| --- | --- | --- |
| `long_bow_m00_wp` | 46.59 | 1.01× — a longbow is the archer's height |
| `short_bow_m00_wp` | 23.28 | 0.51× |
| `long_spear_m00_wp` | 54.94 | 1.19× — polearms 1.2–1.4× |
| `dagger_m00_wp` | 18.90 | 0.41× |
| `round_shield_m00_sh` | 13.10 | 0.28× — buckler |
| `Elmo_LM_woodfence01_01` (staticmesh) | 44.65 | 0.97× — rural fence |
| `GL_Stair02` riser | **8.00–8.13** over 8 steps (`GL_Stair01`: 10 steps, same) | the L2 geodata Z quantum |
| `Elf_Door_01` (staticmesh) | 92.6 | 2.01× |

Numbers reproducible with `audit_native_height.py --props`.

Weapons are the sharpest of these because they are retail meshes authored
to be *held by* the retail character, and they come out at correct human
proportions. **Honest limits, stated so nobody over-reads the picture:**

- This oracle fixes the *absolute* scale to roughly ±10%. It cannot
  adjudicate the 5–9% gap. What adjudicates that is `DrawScale = 1` plus
  the rank inversions above.
- Stair risers sit on the 8-unit geodata grid, so they are a technical
  quantum, not an ergonomic one, and say nothing about human scale.
  (At 46 units ≈ 1.75 m a riser would be ~30 cm — L2 stairs are simply not
  ergonomic. Recorded so nobody re-derives it and concludes the characters
  are half-size.)
- Architecture is monumental: an elven door leaf is 2× the character. That
  is a retail art choice, not a scale error — the furniture and hand props
  (fence, weapons) are the human-scale references, not the doorways.

---

### F5b — NEW, PROVED. Monster/NPC `nativeHeight` omits the retail per-class `DrawScale`

Falls out of the same decode. **344 of 1,125 Lineage NPC/monster classes set
`DrawScale`** (0.25 … 5.0). `scale_util.native_height` never applies it, so
`editor/characters/monsters/manifest.json` `nativeHeight` is the mesh's
unscaled size for every one of them.

**Proof that DrawScale is what the retail size keys on, using no mesh data
at all.** 362 pairs of classes share a mesh but carry different
`DrawScale`. If the client applies it, their `CollisionHeight` must be in
the same ratio as their `DrawScale`; if it ignores it, the ratio must be 1:

| hypothesis | pairs within 5% |
| --- | --- |
| CollisionHeight ratio == DrawScale ratio | **83.7%** |
| CollisionHeight ratio == 1 (DrawScale ignored) | 0.8% |

The `_bi` / `_sm` families are the mechanism in the open —
`wererat` `DrawScale 1.0 / CollisionHeight 25`, `wererat_bi` `1.5 / 38`,
`wererat_100_bi` `2.0 / 50`, `wererat_sm` `0.75 / 18.7`: one mesh, four
sizes, cylinder and DrawScale moving together.

**Effect on the fit** (per class, median over the meshes it uses):

| population | median `nH/2·CH` | within ±10% |
| --- | --- | --- |
| DrawScale == 1 (n=492) | 1.014 | 66.9% |
| DrawScale != 1 (n=258), no DrawScale | 0.834 | 19.0% |
| DrawScale != 1 (n=258), **with** DrawScale | 1.026 | **57.4%** |

Applying it lifts the DrawScale≠1 population to the DrawScale==1 baseline,
and it collapses the reused-mesh families that `docs/npc-visual-data.md` §4
listed as its unexplained 20%: `death_blader` goes from
`1.08 / 0.98 / 1.20 / 0.72 / 0.34` across its five classes to
`1.08 / 1.08 / 1.08 / 1.08 / 1.03`; `werewolf` from `1.35 / 1.18` to
`1.01 / 1.00`; `drop_gourd` from `2.20 … 0.58` to `0.87 … 1.10`. The
residual per-mesh offset is the cylinder's loose fit — the same thing F5
found in the players.

**Where the fix goes — NOT in the manifest.** `DrawScale` is per NPC
*class*, and the same mesh serves classes at different scales, so it cannot
be baked into a per-mesh `nativeHeight`. It has to be applied per `npcId`
at spawn. The decoded table is shipped as
**`editor/characters/monsters/npc-scale.json`** (666 npcIds with
`DrawScale != 1`; regenerate with
`audit_native_height.py --emit-npc-scale`).

Client change, in a file this worker does not own
(`editor/world/js/entities.js`, currently :241-248): it presently sizes NPCs
as `renderScale = (2 × grp.height) / nativeHeight` (per
`docs/npc-visual-data.md` §4). The retail rule is

```
targetHeight = entry.nativeHeight × (npcScale[npcId]?.drawScale ?? 1.0)
```

`2 × grp.height` is a *proxy* for that — it tracks it because the designers
kept the cylinder proportional to `DrawScale`, and it is the only source
that covers npcIds whose class the client tables do not name. It is not the
retail number: it is off by the per-mesh cylinder slack, median ≈1.4–2.6%,
and by more than 10% for about a third of classes. Recommended: prefer
`npc-scale.json` when the npcId is listed, keep `2 × grp.height` as the
fallback, and do not change the character path at all.

---

## Claims checked and found CORRECT

Recording these so the same ground is not re-audited.

1. **`_sp` textures are not bound as baseColor anywhere in the shipped
   models.** Hashed the pixel content of all 2,564 `assets/library/**/*_sp.png`
   exports and of every PNG under `editor/characters/**`: **0 matches**. The
   `choose_texture` rules in `build_characters.py:325-360` are doing what
   they claim. No shipped character/monster/weapon texture is a
   pure-greyscale (mask-shaped) image either — minimum per-pixel saturation
   across 671 materials is 1.6, not 0.
2. **Triangle winding on the rebuilt models is clean.** Re-ran
   `winding_check.py --majority` on the current files, not the build log:
   14/14 characters, 149/149 monsters, 180/180 weapons pass, with only the
   documented source-outlier residue (16 / 627 / 193 faces). The claim in
   `docs/character-pipeline.md` §winding table holds after this session's rebuild.
3. **World prop winding is also self-consistent** (`winding_check.py` on
   `assets/world/22_22/props/Giran_V_Plaza_Wall04.gltf`: 0/28 inverted) —
   because the reflection in F1 converts UE's left-handed CW front face to
   glTF's CCW. Correct winding is therefore *not* evidence that the basis
   is right, and the existing winding gate cannot catch F1. That is why
   `audit_prop_basis.py` exists.
4. **Character chirality is right.** In every character glTF the model's
   local forward is `+Z` (implied by `l2HeadingToThreeYaw = π/2 + θ`, itself
   verified against live traffic), so the character's right is `−X_local`.
   Measured bind-pose world positions: `Bip01_R_Hand` at x = −0.1176,
   `Bip01_L_Hand` at +0.1176 (human_fighter_m); same sign for elf_f. The
   right hand is on the right. `Weapon_R_Bone` follows it.
5. **Colour space is handled correctly.** `renderer.outputColorSpace =
   SRGBColorSpace` (`main.js:57`); every hand-built texture sets
   `SRGBColorSpace` (`terrain.js` `_buildWater`/`_buildMaterial`, `neighbors.js:176,204`,
   `labels.js:27`); glTF baseColor maps get sRGB from `GLTFLoader`
   automatically; and — the one that would have been easy to get wrong —
   the terrain **splat** array is left in linear space with
   `format = RedFormat` and no `colorSpace`, which is right, because a splat
   weight is data, not colour — `terrain.js` `_buildMaterial`, the `splatTex` block.
6. **No character, monster or weapon material is fully cut away.** Ran the
   F3 test against `editor/characters/**`: 85 MASK materials, **0** with
   zero surviving texels. F3 is a world-path-only defect.
7. **Prop rotation composition order** is `qYaw·qPitch·qRoll`
   (`Terrain.ueQuaternion`), which is UE's roll→pitch→yaw applied to the object.
   Correct — only the axis signs are wrong (F1).
8. **Prop scale is sourced**, `DrawScale × DrawScale3D`
   (`convert.py:1029`, `convert_props`). The defect is only in how the client assigns
   the components (F2).
9. **Water plane height is sourced** from the `WaterVolume` bbox top and
   never adjusted (`terrain.js` `_buildWater` and the `water` block in
   `scene.json`, e.g. 22_22 `height: -3780.0`). No shoreline fudging.
10. **Character root motion does not float the model.** Suspecting task #11
    ("characters floating above the ground") lived in
    `character.js` (`root.position.y -= box2.min.y` uses the *bind pose*
    box), I measured the `Bip01` translation track against the bind
    translation for idle/walk/run in 4 models: idle differs by ≤ 3.5 mm on a
    0.46 m model, run by ≤ 5.9 cm (normal locomotion bob), and every
    model's mesh `min.y` is already ≈ 0. **The scale/feet normalisation is
    not the cause** — look at the ground-height source instead.

---

## What I could not do

- No retail-client screenshot was available as an oracle, so no finding
  rests on "it looks like retail". F1's chirality is proved against umodel's
  psk output and the character pipeline's own convention; F3's visibility is
  proved by an in-client A/B against the decoded alpha values.
- F4 is proved as *unsourced* but not as *visually wrong by N units* — the
  UE2 light-unit → three.js intensity calibration is unfinished.
- F5 was left open on purpose in that pass; it was closed on 2026-08-08
  (see the F5 / F5b sections above) once the retail pawn setup code was
  found in `assets/interlude/system/LineageWarrior.u`.
- The `--shaders` cross-check indexes every client `.utx` on each run
  (~2 min). It is fine as a nightly gate, too slow for a pre-commit hook;
  cache the index if it needs to run often.

---

# Applied — 2026-08-08

F1, F2 and F3 are **fixed and shipped**. F4 is **extracted** (the retail
values now ship per tile) but **not wired into the renderer**, because the
light rig lives in `editor/world/js/main.js`, which was outside this
change's ownership. F5 was untouched by that pass, as intended, and was
resolved separately on 2026-08-08.

Full derivation of the coordinate work: **`docs/world-prop-basis.md`**.
Contract updates: `tools/world/README.md` (prop basis, prop material state,
the `light.json` sibling), `docs/HANDOFF.md` §5.

## One place where this document was WRONG

F1's fix specification says `roll` becomes `+roll about (1,0,0)`. It does
not — it stays `-roll`. Only the **yaw** sign changes.

The audit derived the roll sign from "UE roll is right-handed about
`+X_L2`". The vendored oracle disagrees: composing
`Unreal/UnrealMesh/UnMathTools.h:6 RotatorToAxis` with
`Core/Math3D.cpp:252 Euler2Vecs` (which together reproduce UE2's
`FRotationMatrix` term for term) and setting pitch = yaw = 0 gives local
`Y = (0, cos R, -sin R)` — `Y` tilting toward `-Z`, i.e. a right-handed
rotation about **`-X_L2`**. An exhaustive search over all 8 sign
combinations × 6 composition orders, matched against `M R_ue Mᵀ` on 40
random rotators, finds exactly one solution — `yaw +, pitch +, roll -`,
order `qYaw·qPitch·qRoll`, max element error 6.7e-16 — and **no** match for
the specified combination. 10,101 of 157,171 placements carry a non-zero
roll, so it matters.

Everything else in F1 held: the reflection is in the mesh data, the yaw sign
flips, the winding must be reversed, `TANGENT.w` must be negated.

## F1 — prop glTF basis

`tools/world/convert.py`:

* new `gltf_to_proper_basis(gltf_path)`, run on every prop export between
  the umodel pass and `patch_gltf_textures`. Negates `POSITION.z`,
  `NORMAL.z`, `TANGENT.z` and `TANGENT.w`, reverses every triangle's index
  order, swaps+negates the POSITION accessors' `min.z`/`max.z`. Tags
  `asset.extras.basis = "l2ToThree(x,z,-y) det+1"` and is idempotent; it
  raises rather than run on a glTF whose nodes carry a local transform.
* `scene.json` is **unchanged** — the frozen contract does not move. Only
  the sibling `props/*.gltf` + `.bin` payloads change.

`editor/world/js/terrain.js`: `Terrain.ueQuaternion` yaw sign flipped (see
above), with the derivation in the comment.

**Gate — `audit_prop_basis.py --check`, all 100 tiles:**

```
mirrored (glTF z == +UE y, determinant -1): 0
proper   (glTF z == -UE y, determinant +1): 155
unknown                                   : 16
exit 0
```

(was `mirrored 17 / proper 0` on 22_22 alone; on 22_22 alone it is now
`proper 17 / mirrored 0`. The `unknown` packages are Y-symmetric meshes that
carry no information either way — the audit already recorded 2 of them on
22_22.)

## F2 — prop scale axes

`Terrain._propMatrix` and `Terrain._loadPropsRaw` now go through a new
`Terrain.propScale()`, which maps the L2-ordered `scale` to three as
`(sx, sz, sy)`. Reproduced the audit's census exactly on the current data:
3,025 placements where the swap changes the result, 308 at `(1,-1,1)`,
1,431 at `(-1,1,1)`, 1,849 negative-determinant.

**Follow-on that the audit listed as out of scope and that this change
DID have to close:** those 1,849 negative-determinant instances draw with
reversed winding, and three.js only compensates on an object's own
`matrixWorld`, never per InstancedMesh instance. The blanket
`side = DoubleSide` used to hide it; removing that (F3) would have culled
them inside-out. `_loadPropsInstanced` now splits each cluster's instances
by the sign of the instance-matrix determinant and gives the mirrored group
a material clone with the front face flipped (`Terrain._flipSide`). Normals
need no correction: these are axis mirrors, diagonal ±1, for which the
instance matrix is its own inverse-transpose.

## F3 — prop material render state

`tools/world/convert.py`: `png_has_significant_alpha` is no longer used on
the prop path (it survives only as `bsp.py`'s fallback — see the open item
below). `patch_gltf_textures` now takes `alphaMode` / `alphaCutoff` /
`doubleSided` from the new `RetailMaterialIndex`, which resolves the glTF
material name to its export in the client `textures`/`systextures` `.utx`
and reads the UE2 render state. The translation is taken from the reference
oracle's own renderer, not from a reading of the audit's table:

| retail | glTF | oracle |
| --- | --- | --- |
| Shader `AlphaTest` | `MASK`, `alphaCutoff = (AlphaRef + 1)/255` | `UnRenderer.cpp:1443` `glAlphaFunc(GL_GREATER, AlphaRef/255)` — GL keeps `alpha > ref`, glTF keeps `alpha >= cutoff`, so `+1` is the *exact* conversion, not a nudge |
| Shader `OutputBlending != OB_Normal`, or `OB_Normal` with an `Opacity` map | `BLEND` | `UnRenderer.cpp:1510`; enum values `UnMaterial2.h:570` |
| Shader, anything else (incl. `SelfIllumination`, `Specular`+`SpecularityMask`) | `OPAQUE` | ditto |
| Texture `bMasked`, or `bAlphaTexture` on DXT1 | `MASK` @ 0.8 | `UnRenderer.cpp:1246` |
| Texture `bAlphaTexture` | `BLEND` | `UnRenderer.cpp:1251,1256` |
| Texture, neither | `OPAQUE` | `UnRenderer.cpp:1261` (alpha test AND blend explicitly disabled) |
| `TwoSided` / `TreatAsTwoSided` / `bTwoSided` | `doubleSided` | `UnRenderer.cpp:1430,1235` |

Every real prop material name resolves. The only names with no retail state
are umodel's 82 `dummy_material_N` placeholders, which never get a texture
wired either. Two decode refinements were needed to get there, both found by
running the converter over the whole world:

* `FinalBlend` (199 materials / 1,848 placements) carries its blend mode in
  `FrameBufferBlending`, not `OutputBlending`; and `TexPanner` /
  `TexOscillator` / `Combiner` (80 materials / ~570 placements) are
  modifiers, so their render state is the wrapped material's. Both are now
  decoded (`UnMaterial2.h:719, :752, :775, :856, :944`).
* 9 names (`frame01`..`frame07`, `Stone`, `corpse`) collide with a
  non-material export — `frame01` is a `StaticMesh` in `deco01.utx` *and*
  the `Shader` the props actually reference in `interior_s_t.utx`, and
  alphabetical first-wins picked the mesh. The index now lets a material
  class win a name collision, and `_decode` refuses to read a non-material
  export as a material rather than returning a plausible wrong answer. The name→export index costs ~80 s to build and is
cached in `assets/world/.utx_material_index.json`, keyed on the `.utx` file
list + sizes; per-tile conversion went from ~112 s to ~30 s after the first
build.

`editor/world/js/terrain.js`: the blanket
`if (m.map) { m.alphaTest = 0.5; m.side = THREE.DoubleSide; }` in
`_prepMaterials` is gone, so `GLTFLoader` applies the glTF's own state. The
`FLAME_MAT_RE` additive branch is untouched.

**Gate — `audit_prop_materials.py --check`, all 100 tiles:**

```
materials with a baseColor texture : 73876
  marked alphaMode MASK            : 1745
  of those, 100% invisible         : 0 material(s) in 0 prop glTF(s), 0 placement(s)
PASS: no prop surface is fully cut away
```

(was 9,440 MASK of 75,650, 209 of them fully invisible over 1,131
placements. The MASK count collapses because MASK now means *retail
AlphaTest*, not "this PNG has some transparent texels".)

**`--shaders` cross-check on 22_22: 409 → 35 disagreements.** All 35
residuals are the *gate's* blind spot, not the converter's: its
`retail_state()` short-circuits every `Texture`-class export to
`kind='texture', two_sided=False` without reading `bMasked` /
`bAlphaTexture` / `bTwoSided`. Verified case by case, e.g.
`orcguild_skin10_a` is `Texture{bMasked: True, bTwoSided: True}` and
`KnightStatue_T01_u` is `Texture{bTwoSided: True}`. The gate was left
untouched; extending its Texture branch would close the last 35.

Distribution over 22_22's 2,113 textured prop materials after the fix:
1,774 OPAQUE single-sided · 302 BLEND · 12 MASK @ 0.8 (retail `bMasked`) ·
10 MASK @ 0.043 (`AlphaRef` 10) · 3 MASK @ 0.008 (`AlphaRef` 1) · 12 OPAQUE
double-sided. `Giran_wall08_light` is OPAQUE, `StLight03_light` is OPAQUE
and single-sided, `girantreeleaf1_1` cuts at 0.043 instead of 0.5 — exactly
the three cases the audit named.

**Deliberately still undone (documented gaps, not guesses):**
`SelfIllumination`/`SelfIlluminationMask` shaders render OPAQUE with the
correct diffuse but no additive emissive pass — that needs a baked
one-channel-to-RGB emissive PNG. `OB_Modulate`/`OB_Brighten`/`OB_Darken`
collapse to plain `BLEND`; glTF 2.0 core has no additive or modulate mode.

## F4 — retail light rig: extracted here, wired by a parallel agent

I first landed F4 exactly as this document specifies: a `read_lights()` /
`write_tile_lights()` pass in `convert.py` writing a sibling
`assets/world/<tile>/lights.json`, carrying the `NMovableSunLight`, the
`NSun`, all 17 `ZoneInfo` and all 91 `Light` actors in retail units, with
`directionToSun` derived through the same `M` as F1 and reproducing this
document's `(0.500, 0.750, 0.433)` / 48.6° exactly.

**In parallel, another agent implemented and WIRED F4** (commit
`4e93960`): `tools/world/light_extract.py` → sibling
`assets/world/<tile>/light.json` → `editor/world/js/worldlight.js`, called
from `main.js` — the file I was not allowed to touch, which is why my
version stopped at the data. Their `light.json` is therefore the live
contract.

Two extractors of the same actor is duplication, so **mine was removed**:
`convert.py` now calls `light_extract.write()` from `convert_tile` (so a
re-converted tile can never ship a stale `light.json`) and the
`--lights-only` mode and the `lights.json` files are gone. Nothing decoded
by both paths was lost.

**What that consolidation DID drop, and is now an open item.** `light.json`
carries the sun, the terrain zone's ambient and the distance fog. It does
not carry, and nothing else does either:

* the per-map `Light` point-light actors — **91 on 22_22, 1,704 on 23_23** —
  with `Location`, `LightBrightness`, `LightRadius`, `LightHue`,
  `LightSaturation`, `LightType`, `LightEffect`, `bCorona`, on/off times.
  All of it decodes cleanly with `find_prop_start` + the packed property
  reader; the client still invents torch lights from `FLAME_MAT_RE`.
* the `NSun` / `NMoon` billboards (22_22: `NSun` radius 350, rotation
  (-5944, -39696, 0), `bDirectional`).
* the other 16 `ZoneInfo` per tile — only the `bTerrainZone` one is taken,
  so per-zone ambient (22_22 has zones at 0.356, 0.360 and 0.457) is flat.

**Still NOT converted, deliberately, on either path:** `LightBrightness` /
`LightRadius` are UE2 light units with no sourced mapping onto a
three.js/ACES intensity. Inventing a scale factor is exactly what F4
objects to.

## The `correctHeightsWithGeodata` threshold — MEASURED, and NOT changed

The audit suggests applying `MESH_GEO_MAX_DEV` to the *anchored* deviation
instead of the raw one. Measured on 22_22 (all 65,536 cells, raw heightmap
re-fetched so the in-place correction does not contaminate it):

```
median(geodata - heightmap) = +30.85 L2u    p05 +16.7  p25 +25.9  p75 +36.6
cells with dev >  +100 : 3340      cells with dev < -100 : 0
```

The bias is real and the distribution is entirely one-sided, so the ±100
test *is* asymmetric. But two things say not to change it:

1. **Substituting `anchoredHeightAt` is literally a no-op.** `GEO_ANCHOR_MAX`
   is 64 and `MESH_GEO_MAX_DEV` is 100. Within 64 the anchored deviation is
   exactly 0 (already below the threshold); beyond 64 `anchoredHeightAt`
   returns the raw height unchanged. Same cells selected, same values
   written.
2. **Removing the measured offset before thresholding makes the result
   worse against an independent oracle.** Doing it drops the correction from
   3,340 candidate cells / 3,105 rewritten to 2,326 / 1,844, changing 2,293
   cells by a mean of 0.75 m. Judged by retail prop `Location.Z` (props are
   placed on the ground the retail client draws — the same oracle
   `geodata.js` cites for the anchoring work), over the 487 props standing
   on cells that differ: median `|prop.z - terrain|` is **89.3 L2u as
   shipped vs 137.8** with the offset removed, and props landing within
   100 L2u drop from 271 to 184. 17_25 disagrees weakly the other way (21
   props, 112 vs 74) but has 4% of the sample.

So the code is unchanged and this is recorded instead. Closing it properly
needs a ground-truth terrain oracle for the stale-rectangle zones
themselves, not a re-weighting of the same two surfaces.

## New defect found while applying F3 (not fixed)

The same alpha guess still runs on the **BSP** path: `bsp.py:402`
`alpha = masked or png_has_significant_alpha(png)`. Scanning all 100
`bsp.gltf` files: 1,130 materials with a baseColor texture, 39 marked MASK,
of which **2 are 100% invisible** — `18_19 test` (max alpha 68) and
`22_25 eva_wall_03_sh` (max alpha 85). Both are retail **OPAQUE**
(`RetailMaterialIndex` on the client `.utx`). Left alone deliberately: the
BSP path landed hours before this change and the instruction was not to
regress it; the fix is to give `bsp.py` the same `RetailMaterialIndex`
lookup as the prop path, keeping `PF_MASKED` as the primary signal.

## Gates and suites actually observed

Run after re-converting all 100 tiles (`convert.py <tile>` per tile, ~30 s
each with the .utx index cached; one tile, 23_23, failed on a mid-edit
import and was re-converted successfully).

| gate | result |
| --- | --- |
| `python3 tools/world/convert.py --check` × 100 tiles | exit 0, no contract violation |
| `python3 tools/src/char_pipeline/audit_prop_basis.py --check` (all tiles) | exit 0 — **mirrored 0**, proper 155, unknown 16 |
| `python3 tools/src/char_pipeline/audit_prop_materials.py --check` (all tiles) | exit 0 — **0 fully-invisible surfaces** of 73,876 textured materials |
| `python3 tools/src/char_pipeline/audit_prop_materials.py --tiles 22_22 --shaders` | 409 → **35** disagreements, all in the gate's un-read `Texture` branch |
| `python3 tools/world/bsp.py --check` | **100/100 tiles OK** (unchanged — the BSP path was not touched) |
| `python3 tools/world/light_extract.py --check` | 100 tiles, 100 with a sun, 94 with fog, **0 stale** (after wiring it into `convert_tile`) |
| `editor/world/verify_terrain.js` | PASS |
| `editor/world/verify_geodata.js` | PASS |
| `editor/world/verify_interior.js` | PASS |
| `editor/world/verify_civilians.js` | PASS |
| `editor/world/verify_app.js` | PASS |
| `editor/world/verify_bsp.js` | FAILS on this machine — **not caused by this change**, see below |

`verify_bsp.js` passes tile-by-tile (`node verify_bsp.js 22_22` → PASS,
`node verify_bsp.js 17_25` → PASS) but times out on the 22_22 → 17_25 scene
switch when both run in one browser session. Reduced to a minimal script
(load 22_22, take the suite's five 1280×900 screenshots under
`--use-angle=swiftshader`, switch tile) and A/B'd against `git show
HEAD:editor/world/js/terrain.js`: **both the old and the new terrain.js time
out identically** at that switch, with the old tile's geometries/textures
still resident (2,110 / 1,997) and the new tile never built. Raising
`LOAD_TIMEOUT_MS` to 900,000 does not help, so it is a genuine hang in the
harness/host (headless software GL), not slowness — and not a rendering
regression from this change.
The first three suite runs also failed spuriously because the three
`mock_gateway.js` processes had been reaped — that produces exactly the
misleading navigation timeout the handoff warns about.

Renderer cost for the record (`verify_terrain` perf block, same machine and
software renderer): draw calls 838 → 932 (+11%, the mirrored-instance split
plus the wider material variety), triangles 210,449 → 216,237 (+3%).

## Screenshots inspected (before / after)

`editor/world/audit_shots/fixbefore_*.png` vs `fix2after_*.png`, identical
camera stations, opened and read.

* **24_17, the volcanic plain (the F3 test case).** Before: a bare grey
  plain with two black dead trees and nothing else. After: dozens of
  boulders across the foreground and mid-ground, the lava rivers read as
  bright orange rather than washed-out dark, the dead trees have visible
  bark instead of pure silhouette, and the cliff faces show their lava
  bands. This is the 424-of-492 invisible placements the audit predicted on
  that tile.
* **22_22, the Giran north gate.** Before: the right-hand wing of the
  gatehouse was a flat dark block and the field trees were sparse
  silhouettes. After: the full half-timbered facade with its window
  frames, the gate's wooden doors, warm interior light in the windows, and
  fully-leafed trees (the 0.5 cutoff was eating ~5% of every leaf card at
  its softest edges).
* **22_22, the plaza and the south block.** Buildings sit in different
  places — F1 moves geometry — and read as a coherent street: shop awnings,
  door surrounds and lit windows appear where the shipped build had flat
  dark facades. The clock-tower windows are lit.
* **23_24, Innadril.** The arcade behind the clock tower resolves into a
  row of arched, lit windows instead of a dark brown mass; the cathedral's
  stained glass and the red roof tiles are visible.

Caveat, unchanged from the audit: **no retail screenshot was available as an
oracle.** The claim these shots support is "more of the decoded source is
now being drawn, and the town reads as a town", not "this matches retail
pixel for pixel". The proof that the *basis* is right is the byte-level psk
match in `audit_prop_basis.py`, not the pictures.
