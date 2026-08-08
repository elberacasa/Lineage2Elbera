# Foundation audit — visual fidelity vs the source data

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

### F5 — SUSPECT, could not close. `nativeHeight` is ~5% short of 2× the server collision height, consistently

`editor/characters/manifest.json` `nativeHeight` is measured from the mesh
itself (`scale-report.json`: `gltfExtent × 100 × meshScale`, and `meshScale`
is the `.ukx` DrawScale), so it is source-derived and the client applies it
exactly (`character.js:90`). But against the server's own collision heights
(`server/aCis_datapack/data/xml/classes/*.xml`, where L2 `height` is a
half-height):

| model | 2 × server height | manifest `nativeHeight` | delta |
| --- | --- | --- | --- |
| human_fighter_m | 46.0 | 46.0 | 0.0% |
| human_fighter_f | 47.0 | 44.2 | −6.0% |
| human_mystic_m | 45.6 | 42.1 | −7.7% |
| elf_m | 48.0 | 46.3 | −3.5% |
| dwarf_f | 38.0 | 34.5 | −9.2% |
| orc_mystic_m | 55.0 | 50.1 | −8.9% |

Every entry is short, never long, which reads like a systematic measurement
gap (bind-pose bounding box vs the standing silhouette, or hair/crown
geometry excluded) rather than noise. I could not decide whether the retail
client scales pawns by collision height or renders the mesh at DrawScale —
that needs the pawn setup code, which I did not have. **Leaving it open
rather than guessing a correction factor.** If someone closes this: the
correct test is a retail screenshot of a named character next to a
known-size prop, not a ratio.

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
- F5 is left open on purpose.
- The `--shaders` cross-check indexes every client `.utx` on each run
  (~2 min). It is fine as a nightly gate, too slow for a pre-commit hook;
  cache the index if it needs to run often.
