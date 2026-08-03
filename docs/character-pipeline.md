# Character Model Pipeline — L2 Interlude .ukx → web glTF

Status: **working end-to-end (full-skeleton psk pipeline)**. 14 race/gender
models exported, structurally validated, and rendered headlessly with
three.js + Chrome (SwiftShader); every model inspected on screenshots
(full body / face / 3-4 back, plus bind-pose and attack/run/dance spot
checks) in `tools/src/char_pipeline/verify/after/`.

## 1. What the character .ukx files contain

`assets/interlude/animations/*.ukx` (umodel `-game=l2 -list`):

| Package        | Meshes (prefix)     | Race / gender        | AnimSet          |
|----------------|---------------------|----------------------|------------------|
| `Fighter.ukx`  | `MFighter_`, `FFighter_` | Human Fighter M/F | `MFighter_anim`, `FFighter_anim` |
| `Magic.ukx`    | `MMagic_`, `FMagic_`     | Human Mystic M/F  | `MMagic_anim`, `FMagic_anim` |
| `Elf.ukx`      | `MElf_`, `FElf_`         | Elf M/F           | `MElf_anim`, `FElf_anim` |
| `DarkElf.ukx`  | `MDarkElf_`, `FDarkElf_` | Dark Elf M/F      | `MDarkElf_anim`, `FDarkElf_anim` |
| `Orc.ukx`      | `MOrc_`, `FOrc_`         | Orc Fighter M/F   | `MOrc_anim`, `FOrc_anim` |
| `Shaman.ukx`   | `MShaman_`, `FShaman_`   | Orc Mystic M/F    | `MShaman_anim`, `FShaman_anim` |
| `Dwarf.ukx`    | `MDwarf_`, `FDwarf_`     | Dwarf M/F         | `MDwarf_anim`, `FDwarf_anim` |

Each race/gender has many SkeletalMeshes named `<Prefix>_m<NNN>_<part>`:
- `m000` = the "underwear" base set (its face mesh `<Prefix>_m000_f` IS the
  creation-screen face). The creation-screen body uses the class armor set
  from chargrp.dat (`m001` for most, mixed `m005/m003`, `m003/m002` for
  human mages).
- part suffixes: `_u` upper body, `_l` lower body, `_g` gloves, `_b` boots,
  `_f` face, plus `_m00_ah` / `_m00_bh` front/back hair meshes.  NOTE on
  hair: chargrp's `appearanceDetail.attachedMesh` lists only the TINTABLE
  hair styles; `paintedOnly` styles (all orc styles, darkelf/dwarf male
  m000) still attach their hair-cap meshes on the creation screen — the
  `_f` face mesh is a hollow mask open at the crown, and the `_bh` cap is
  what closes the skull (verified against official NCSoft hairstyle
  captures and umodel renders of the caps; bug history: models without
  the cap showed an open skull from top/back angles).  The pipeline now
  offers `_ah`/`_bh` for every combo and keeps only those with an
  existing texture (painted styles carry only the `_bh` cap; `_ah` has no
  texture there and would render as a gray blob).

**Skeletons (verified by parsing every part's .psk REFSKELT chunk):**
every body part exports with the COMPLETE reference skeleton of its
package (66–109 bones depending on race/gender; FShaman has 140 entries
including duplicated skirt-bone names). Bind poses of shared bones are
identical across parts except for sub-centimeter authoring jitter and a
few exceptions (e.g. MDarkElf gloves' `Dummy02` quat is 90° off the body's
— handled by per-part skins, see §3). Two hair meshes
(`FElf_m000_m00_bh`, `FDarkElf_m000_m00_bh`) are a *separate* 13-bone
`Hair01-13` rig with no body bones; their vertices are in the same pawn
space, so they are bound rigidly to the head bone.

**Source-data landmine #2 (face rig):** 23 of the 34 face/hair part meshes
are weighted 100% to the ROOT bone (`Bip01`) in the source data — the face
shell then pivots around the pelvis while the body's neck follows the
spine chain, so any pose that leans the spine relative to the root opens
a visible head/body gap (worst in idles with turned heads: orc/shaman,
dwarf_m, darkelf_m — up to ~2.6 cm of neck-ring divergence).  NCSoft's
own authoring is inconsistent: FFighter/FMagic/MMagic faces ARE
head-weighted.  **Deliberate deviation from retail:** the pipeline
re-anchors every root-weighted vertex in `_f`/`_ah`/`_bh` parts to the
head bone (verts within 15 cm of the head bind position).  Bind pose is
bit-identical (identity skinning either way); under animation the face
rides the head and the neck junction never opens.  Side effect: the
charcreate app's face-normal facing measurement now samples head-turned
poses for combos whose idle turns the head (human_fighter_m reads
facingOk=False) — the model is correct; the app should prefer body
landmarks there.

**Source-data landmine:** in `Fighter.ukx`, the meshes
`MFighter_m001_l/_g/_b` (and `MFighter_anim`) contain a DUPLICATED bone
name `Bip01_L_Finger01` — the second occurrence (parent `Bip01_R_Finger0`)
is really `Bip01_R_Finger01` mislabeled. Any name-based joint remapping
binds right-hand glove vertices to the LEFT finger bone; in bind pose the
verts are co-located so nothing shows, but any pose that separates the
hands stretches them into a "rod between the hands". The old pipeline hit
exactly this and then tried to hide it by deleting "cross-side" triangles
(cutting holes in the gloves). The current pipeline never remaps by bare
name (see §3).

## 2. Materials

Character textures live in `assets/interlude/systextures/<Prefix>.utx`
(case varies: `MFighter.utx`, `melf.utx`, …).  The verified PNG exports
live in `assets/library/<Package>/` (indexed by
`assets/library/manifest.json`).

Resolution order per part section (`build_characters.py::choose_texture`)
— chargrp.dat is AUTHORITATIVE (owner directive: the retail
creation-screen look, i.e. the `t00` face / `t02` body sets from
`creationAssets.bodyTextures`/`faceTextures`):

1. **chargrp.dat creation binding** — the material reference is resolved
   through Shader/FinalBlend chains to its diffuse Texture (l2lib
   `resolve_material`).
2. **The mesh's OWN .ukx material slot** (l2lib `mesh_material_slots`) —
   only a fallback for parts chargrp does not cover.

Texture-variant rules:

- L2 `*_sp` textures are DXT3 with the **diffuse in RGB and a specular
  mask in alpha** (verified channel-by-channel).  The `assets/library`
  exports of `*_sp` show the alpha mask (near-black / white), never the
  diffuse.  So: if the non-suffixed sibling exists in the library it is
  used; otherwise the diffuse RGB is decoded straight from the .utx with
  l2lib (`decode_texture_png`, alpha forced opaque).  The library's
  `*_sp` export is NEVER bound as baseColor.
- `*_ori` textures are the 'original' bitmaps behind FinalBlend hair
  materials: the non-suffixed sibling is preferred when exported, else
  the library `_ori` is used (it IS the diffuse; alpha drives the hair
  strands).
- Sanity: every chosen PNG's mean opaque-pixel luminance is printed;
  values < 25 are logged as notes but kept (dark-elf outfits are dark by
  design).

chargrp is also used (as before) to decide WHICH meshes form the
creation outfit.  Nothing is bound by name-pattern guessing.

## 3. Pipeline (build_characters.py + assemble.py)

Per model (example: Human Fighter male):

```bash
cd assets/interlude
# 1. body parts → ActorX .psk (FULL reference skeleton in every part)
../../tools/bin/umodel -game=l2 -export -out=/tmp/stage animations/Fighter.ukx MFighter_m001_u
# 2. animations → ActorX .psa
../../tools/bin/umodel -game=l2 -export -out=/tmp/stage animations/Fighter.ukx MFighter_anim
# 3. textures → PNG (after Shader→Diffuse resolution via l2lib)
../../tools/bin/umodel -game=l2 -png -export -out=/tmp/stage systextures/MFighter.utx MFighter_m001_t01_u_sp
# 4. merge parts + inject animations + write manifest entry
/usr/bin/python3 tools/src/char_pipeline/build_characters.py human_fighter_m
```

`build_characters.py` runs 1–4 for all 14 combos (or the ids given as
arguments) and merges results into the existing
`editor/characters/manifest.json` (single-id runs no longer clobber it).

### assemble.py — full-skeleton, zero-remap merge

- **Canonical skeleton** = union of all parts' skeletons. Bone identity =
  (parent identity, name); the bind pose only breaks ties between
  same-named siblings. This resolves the `Bip01_L_Finger01` duplicate
  deterministically (its parent `Bip01_R_Finger0` gives it away) and
  tolerates the sub-cm bind jitter (name+parent match, jitter logged).
  Genuinely new bones (FShaman skirt helpers) are appended.
- **Merging = concatenation.** Every part's weights reference its own
  skeleton by index, so per part we keep an exact index permutation into
  the canonical skeleton; JOINTS_0 values are permuted indices. No matrix
  math is ever applied to skin data.
- **Per-part skins.** All skins share the canonical joint node list, but
  each part gets its own inverse-bind matrices computed from ITS OWN .psk
  bind pose (IBM = inverse of the node world bind transform; verified
  against umodel's own glTF: 70/70 IBMs match). This keeps parts whose
  bind pose deviates from the canonical skeleton (MDarkElf gloves'
  `Dummy02` is 90° off) exactly correct.
- **Standalone hair rigs** (`Hair01-13` only): vertices bound 100% to the
  head bone; the hair rig is not animated by the .psa.
- **Normals**: angle-weighted, shared by wedge PointIndex (mirrors
  UEViewer `BuildNormalsCommon`).
- **Animations**: the .psa bone order is matched to a part skeleton with
  100% positional name agreement (verified present in every package), then
  mapped through that part's structural permutation — so the duplicated
  `Bip01_L_Finger01` at psa index 27 drives the RIGHT finger bone. If no
  part matches, the build fails loudly instead of guessing.
- **Coordinate conversion** (measured against the umodel BINARY's own
  glTF export — note the vendored `ExportGLTF.cpp` documents a different
  swap(y,z) convention than the binary implements):
  position `(x, z, -y) * 0.01`; direction `(x, z, -y)`; quaternion
  `(x, z, -y, -w)`; the root bone additionally conjugated (nodes and
  animation tracks). Indices and UVs are emitted unchanged. Verified
  bone-by-bone and per-vertex against `umodel -gltf` output (positions
  <3e-8, UVs exact, JOINTS/WEIGHTS identical for all verts; animation
  locals verified equal to raw psa keys for full bone chains).

## 4. Output contract (frozen)

```
editor/characters/
  manifest.json          {"models": [{"id", "race", "gender", "className",
                                       "gltf", "animations": [...],
                                       "nativeHeight"}, ...]}
                         nativeHeight: true in-world height in L2 units
                         (glTF Y extent x 100 x MeshScale.z, decoded from
                         the .ukx by tools/src/char_pipeline/scale_util.py);
                         the world client sizes models from it (authoritative
                         — no client-side normalization)
  models/<id>.gltf       glTF 2.0, JSON + external .bin
  models/<id>.bin
  models/<id>_<part>.png textures (u, l, g, b, f, plus ah/bh hair where present)
```

14 models: `human_fighter_m/f`, `human_mystic_m/f`, `elf_m/f`,
`darkelf_m/f`, `orc_fighter_m/f`, `orc_mystic_m/f`, `dwarf_m/f`.
Each glTF has: canonical skeleton (66–140 bones), one skin per part plus a
canonical skin, 6 animations (`idle`, `walk`, `run`, `sit`, `dance`,
`attack`), textured PBR materials (doubleSided; hair uses alphaMode MASK).
Models are in the source data's own scale (~0.4–0.5 glTF units tall; the
retail client upscales pawns — same scale the umodel glTF export
produces).

## 5. Verification

- **Structural** — `tools/src/char_pipeline/validate_gltf.py
  editor/characters/models/*.gltf`: all 14 pass.
- **Numeric** — the emitter was diffed against `umodel -gltf` for
  `MFighter_m001_u` (nodes, IBMs, positions, normals, UVs) and for
  `FDarkElf_m001_u` (all 437 verts' POSITION/JOINTS/WEIGHTS identical).
  psa→glTF animation locals verified equal to raw psa keys.
- **Visual** — `node render_check.js <id> <anim> <t> out.png [full|face|top|topback] [hide] [ry]`
  (three.js + headless Chrome). All 14 models rendered at full/face/back
  plus top/top-back skull checks (`verify/after/`): no stray geometry, no
  open skulls, natural shoulders/arms, correct faces.
  `debug_skin.js <id> [anim] [t] [mesh]` CPU-skins the model in three.js
  and dumps per-vertex skinned positions with joint names (artifact
  hunting).
- **Notable verified-authentic oddities** (source data, not bugs):
  darkelf_f wears flat-black floating pauldron/forearm plates (verts
  weighted to clavicle/upper-arm, UVs flat-mapped to black texels of the
  chargrp t02 texture; CONFIRMED authentic by
  `tools/reference/track-a/darkelf_f/darkelf_f_wait_front.png` — umodel's
  own viewer shows the same plates under `Wait_Hand_FDarkElf`); orc_fighter_f
  has a slight neck seam in idle (the `Wait_Hand_FOrc` psa leans the neck
  ~15° from bind and the neck-ring verts are head-weighted — verified in
  the raw data).
- **Reference sets** — `tools/reference/track-a/` holds umodel-viewer
  renders per part; `tools/reference/track-b/` holds official NCSoft
  creation-screen face/hairstyle captures. `applit.js <id> out.png`
  renders a model with the charcreate app's exact light rig
  (spot/ambient/rim/fill from `editor/charcreate/app.js`) for
  app-vs-model lighting comparisons. NOTE: with the current app light rig
  every model renders dark navy (physical light units: 60 cd spot at ~7 m
  ≈ 1 lx over a dim blue ambient) — verified independent of the model
  files; it is an app lighting matter, not a texture/geometry defect.

## 6. Known limitations / notes for the web app

- **Facing**: the corrected animation conversion changed per-model facing
  in `idle` vs the old (inconsistent) conversion. Any app-side facing fix
  table (`FACING_FIX` in `editor/charcreate/app.js`) must be re-measured
  against these builds — do not carry old values over blindly.
- The `.psa` key `Time` fields are garbage (all 1.0); frame times come
  from `AnimRate`.
- Only `MFighter`/`MElf` packages have a legacy `_h` hair mesh (not used).
- **Elf/DarkElf/Dwarf mystics look identical to their fighters — RETAIL
  FACT, not a bug.**  chargrp.dat has 14 records (no elf/darkelf/dwarf
  mage record), and armorgrp.dat maps the mystic starting armor
  (425 Apprentice's Tunic / 461 Apprentice's Stockings) to the same
  `m001` meshes as the fighter's Squire set for those races; only human
  (`MMagic_m005`/`FMagic_m002`) and orc (`MShaman_m001`/`FShaman_m001`)
  mystics have distinct level-1 robes.  The `m002+` series in
  Elf.ukx/DarkElf.ukx are higher-grade armor sets, not the level-1
  outfit.  The app's race+gender model fallback for Elven/Dark Mystic is
  therefore correct retail behavior (verified against the aCis class
  item lists and official captures, which have no elf/darkelf
  mystic-specific set).
- Other face options (`t01`/`t02` face textures), armor sets (`m001`+) and
  hair variants are available in the same packages if the creator wants
  options later.
