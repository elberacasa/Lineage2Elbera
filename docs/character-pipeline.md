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
  animation tracks). UVs are emitted unchanged. Verified
  bone-by-bone and per-vertex against `umodel -gltf` output (positions
  <3e-8, UVs exact, JOINTS/WEIGHTS identical for all verts; animation
  locals verified equal to raw psa keys for full bone chains).
- **Triangle winding is REVERSED** (`assemble._face_indices` emits
  `v0, v2, v1`). `ExportPsk.cpp` mirrors the mesh on export (`MIRROR_MESH`
  negates every point's Y, lines 98-112) and swaps `WedgeIndex[0]/[1]` to
  compensate (line 184), so psk faces are CCW *in psk space*; the psk→glTF
  map `(x, z, -y)` has determinant +1, but composed with that mirror the
  net UE→glTF map `(x, z, y)` has determinant −1, so the psk order arrives
  CLOCKWISE — back-facing under glTF 2.0 §3.7.2.1 — while
  `_point_normals()` produces outward normals. Every material here is
  `doubleSided`, so the wrong winding never made anything invisible; it
  made three.js negate the shading normal on those fragments and light
  every character and monster from the wrong side. See §5 for the
  measurement. (Bug history: shipped inverted from the first build until
  2026-08-07; `build_weapons.py` had already fixed the static path and now
  calls the same helper so the two cannot drift.)
- **Constant animation tracks are collapsed to 2 keyframes.** psa data is
  overwhelmingly rotation-only — every bone but the pelvis repeats its
  bind translation for all N frames. `inject_animations` collapses a track
  only when every frame's PACKED BYTES are identical, so LINEAR
  interpolation between the two surviving keys reproduces it exactly;
  two keys rather than one so the clip's duration is unchanged. On
  `human_fighter_m` 7882 of 11836 tracks collapse, 2.96 MB of 5.07 MB of
  animation payload. Verified: all 11288 nameable channels re-sample to
  the raw psa keys (rotation bit-exact, translation max |Δ| 2.9e-8, the
  float32 rounding of the ×0.01 scale).

## 4. Output contract (frozen)

```
editor/characters/
  manifest.json          {"models": [{"id", "race", "gender", "className",
                                       "gltf", "animations": [...],
                                       "stances": [...], "nativeHeight"}]}
                         nativeHeight: true in-world height in L2 units
                         (glTF Y extent x 100 x MeshScale.z, decoded from
                         the .ukx by tools/src/char_pipeline/scale_util.py);
                         the world client sizes models from it (authoritative
                         — no client-side normalization)
                         stances: which stance suffixes this model carries
                         clips for (always all six: hand 1hs 2hs dual bow pole)
  stances.json           weapon -> stance mapping, see §7
  models/<id>.gltf       glTF 2.0, JSON + external .bin
  models/<id>.bin
  models/<id>_<part>.png textures (u, l, g, b, f, plus ah/bh hair where present)
```

14 models: `human_fighter_m/f`, `human_mystic_m/f`, `elf_m/f`,
`darkelf_m/f`, `orc_fighter_m/f`, `orc_mystic_m/f`, `dwarf_m/f`.
Each glTF has: canonical skeleton (66–140 bones), one skin per part plus a
canonical skin, textured PBR materials (doubleSided; hair uses alphaMode
MASK), and two groups of animations:

- **the 14 FROZEN clip names** `idle`, `walk`, `run`, `sit`, `dance`,
  `attack`, `castShort`, `castMid`, `castLong`, `magicThrow`, `spAtk01`,
  `spAtk02`, `die`, `damage` — what `editor/world/` addresses today.
  These are the unarmed/legacy resolutions and never change; the stance
  work only ADDS alongside them.  `tools/src/char_pipeline/clip_check.py`
  is the regression guard (see §5).
- **the per-weapon stance clips** `<action>_<stance>` — 41 to 71 per
  model, see §7.

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
- **Winding** — `winding_check.py [--check|--majority|--verbose] <gltf>...`
  counts faces whose geometric normal `cross(b-a, c-a)` opposes the mean
  of their own vertex normals. Measured before and after the
  `_face_indices` fix (2026-08-07):

  | model | before | after |
  |---|---|---|
  | `human_fighter_m` | 2256/2256 | **0**/2256 |
  | 10 more characters | N/N | **0**/N |
  | `elf_m` | 2235/2241 | 6/2241 |
  | `orc_mystic_m` | 2543/2549 | 6/2549 |
  | `human_mystic_f` | 2379/2382 | 3/2382 |
  | `darkelf_f` | 2127/2128 | 1/2128 |
  | 149 monster/NPC glTFs | ≈N/N | 0 inside-out, 627 outlier faces in 96 files |

  `before + after == total` for every single file — the proof that only
  the winding changed, since a reversal is exactly complementary. The
  non-zero remainders are SOURCE data: e.g. the 6 faces of `MElf_m001_u`
  measured on the raw `.psk` (before any transform) are the 6 whose
  authored per-vertex normals already disagreed with the psk face order
  while the other 564 agreed. `--majority` is the pipeline gate (fails
  only when a mesh is wound inside-out); `--check` is the strict form.
- **Shading (the reason winding matters)** —
  `node shading_check.js [--check] <id> [anim] [t] [outdir]` renders the
  model twice under a key-light-at-the-camera rig with ambient 0.02: once
  as shipped, once through a copy with every triangle re-reversed (the
  pre-fix state, reconstructed rather than archived), and reports the mean
  silhouette luminance. `human_fighter_m` idle: **75.50 fixed vs 20.32
  inverted (3.72x)**; `monsters/models/wolf_m00` idle: 65.41 vs 20.42
  (3.20x). The inverted render is a near-black silhouette
  (`verify/winding/*_inverted.png`) — that is what every character and
  monster looked like to a directional light before the fix.
  NOTE: `render_check.html`'s rig (ambient 1.2) deliberately floods the
  model so geometry defects show; ambient is normal-independent, which is
  exactly why it hid this bug for so long. Use `shading_check` for
  lighting claims.
- **Clip regression** — `clip_check.py --snapshot | --check` diffs every
  model's clip list (both manifests, cross-checked against the glTF files
  themselves) against `clip_baseline.json`. Adding clips passes; losing or
  renaming one fails. Current run: 164 models, 742 clips added, 0 lost.
- **Visual** — `node render_check.js <id> <anim> <t> out.png [full|face|top|topback] [hide] [ry]`
  (three.js + headless Chrome). All 14 models rendered at full/face/back
  plus top/top-back skull checks (`verify/after/`); re-taken after the
  winding fix in `verify/after_winding/` (14 characters + monster
  spot-checks) and per-stance in `verify/stances/`: no stray geometry, no
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

---

## 7. Per-weapon animation stances

### 7.1 How retail names them

Every playable race/sex ships ONE `MeshAnimation` (`<Prefix>_anim`) with
all of that pawn's sequences.  Names are

```
<Action>_<Stance>_<Prefix>     Wait_1HS_MFighter, Atk01_Bow_FElf, ...
<Action>_<Prefix>              Death_MFighter, Social_dance_FOrc, ...  (unstanced)
```

The six stance tokens are **not inferred from the names** — the retail
client enumerates them itself.  `assets/interlude/system/NWindow.dll` (the
client's dev-tool window; the file is a normal PE, the strings are
UTF-16LE) holds, in its `NCPawnViewerWnd` resource block, a combo-box item
list laid out back-to-front:

```
7(DUALFIST)  5(BOW)  4(POLE)  3(DUAL)  2(2HS)  1(1HS)  0(HAND)
```

and next to `NCPawnCreateWnd` the lowercase animation tokens

```
1hs  2hs  dual  pole  bow  hand      run  walk  atk  wait  social
```

Those six tokens are exactly the `<Stance>` values found in the `.ukx`
files, and the numbers are **weapongrp's `handness` field** — its domain
is 0,1,2,3,4,5,7, matching one for one.  (`weapon_type` is a *different*
domain: it puts DUAL at 8 and BOW at 6, so it is not what the enum
counts.)  Enumeration reproduced by `build_stances.py::parse_client_enum`.

Source-data landmines in these names:

- **Case is inconsistent.**  `MDwarf` ships `wait_1hs_MDwarf` /
  `atk01_1hs_MDwarf` in lowercase while everything else is
  `Wait_1HS_...`; `MShaman` mixes the suffixes `_MShaman` and `_Mshaman`
  (25 of its 90 sequences use the lowercase 's'); `FShaman` ships the
  typo'd `damegefly_FShaman`.  Matching is case-insensitive throughout.
  Reading the `.ukx` NAME TABLE with a case-sensitive filter under-counts
  MShaman by 25 and mis-reports MDwarf's whole 1HS set as missing.
- **`Social_bow_*` is the greeting emote, not the Bow stance.**  The
  parser whitelists the action token
  (`Wait|Walk|Run|AtkWait|ShieldAtk|Atk\d+|SpAtk\d+`) rather than
  accepting anything before a stance token; `Social_bow_*` is the only
  name in all 14 packages that the whitelist rejects.
- **The `.psa` is authoritative, not the `.ukx` name table.**  Each
  package's name table also carries a `Skirt_F<Race>` name that is not a
  sequence, and `MFighter_anim` carries a stray sequence literally named
  `test`.

### 7.2 The inventory (sequences per stance, per pawn)

Re-derive with `tools/src/char_pipeline/anim_stances.py`
(`--json out.json` for the data, `--check` for the gate).  Counts are
sequences that carry that stance suffix; "seqs" is the pawn's whole
AnimSet.

| pawn | prefix | Hand | 1HS | 2HS | Dual | Bow | Pole | seqs |
|---|---|---|---|---|---|---|---|---|
| `human_fighter_m` | `MFighter` | 6 | 16 | 13 | 18 | 7 | 9 | 114 |
| `human_fighter_f` | `FFighter` | 6 | 16 | 13 | 18 | 7 | 9 | 113 |
| `human_mystic_m` | `MMagic` | 6 | 9 | 7 | 6 | 6 | 7 | 85 |
| `human_mystic_f` | `FMagic` | 6 | 9 | 7 | 6 | 6 | 7 | 85 |
| `elf_m` | `MElf` | 6 | 12 | 8 | 6 | 7 | 7 | 92 |
| `elf_f` | `FElf` | 6 | 12 | 8 | 6 | 7 | 7 | 92 |
| `darkelf_m` | `MDarkElf` | 6 | 12 | 9 | 12 | 7 | 7 | 99 |
| `darkelf_f` | `FDarkElf` | 6 | 12 | 9 | 12 | 7 | 7 | 99 |
| `orc_fighter_m` | `MOrc` | 30 | 11 | 9 | 6 | 6 | 9 | 115 |
| `orc_fighter_f` | `FOrc` | 30 | 11 | 9 | 6 | 6 | 9 | 115 |
| `orc_mystic_m` | `MShaman` | 8 | 10 | 8 | 6 | 6 | 8 | 90 |
| `orc_mystic_f` | `FShaman` | 8 | 10 | 8 | 6 | 6 | 8 | 90 |
| `dwarf_m` | `MDwarf` | 6 | 10 | 8 | 6 | 6 | 9 | 89 |
| `dwarf_f` | `FDwarf` | 6 | 10 | 8 | 6 | 6 | 9 | 89 |

Which ACTION clips each stance carries — grouped, since most pawns share
a set (`SpAtk01-04` means SpAtk01, 02, 03, 04):

**Hand**
- `Wait Walk Run AtkWait Atk01 SpAtk06` — human fighter m/f, human mystic
  m/f, elf m/f, darkelf m/f, dwarf m/f
- `… Atk02 Atk03 SpAtk01,03,06-26` — orc_fighter m/f (the fist-fighter
  skill set: 24 SpAtk clips that exist in no other stance or race)
- `… Atk02 Atk03 SpAtk06` — orc_mystic m/f

**1HS** (every pawn: `Wait Walk Run AtkWait Atk01 Atk02 Atk03 ShieldAtk`, plus)
- `SpAtk01-04,07,11,18-19` — human fighter m/f
- `SpAtk02` — human mystic m/f
- `SpAtk01-02,04-05` — elf m/f
- `SpAtk01-04` — darkelf m/f
- `SpAtk01-03` — orc_fighter m/f
- `SpAtk01-02` — orc_mystic m/f, dwarf m/f

**2HS** (every pawn: `Wait Walk Run AtkWait Atk01 Atk02 Atk03`, plus)
- `SpAtk01,03,07,11,18-19` — human fighter m/f
- (none) — human mystic m/f
- `SpAtk01` — elf m/f, orc_mystic m/f, dwarf m/f
- `SpAtk01,03` — darkelf m/f, orc_fighter m/f

**Dual** (every pawn: `Wait Walk Run AtkWait Atk01 Atk02`, plus)
- `SpAtk01,03,07-08,11-13,18-22` — human fighter m/f
- `SpAtk01,03,05,07,11,18` — darkelf m/f
- (none) — everyone else

**Bow** (every pawn: `Wait Walk Run AtkWait Atk01`, plus)
- `SpAtk01-02` — human fighter m/f, elf m/f, darkelf m/f
- `SpAtk02` — human mystic m/f, orc m/f, orc_mystic m/f, dwarf m/f

**Pole** (every pawn: `Wait Walk Run AtkWait Atk01 Atk02 Atk03`, plus)
- `SpAtk01,03` — human fighter m/f, orc_fighter m/f, dwarf m/f
- `SpAtk01` — orc_mystic m/f
- (none) — human mystic m/f, elf m/f, darkelf m/f

### 7.3 What retail does NOT ship

- **Nothing at the locomotion level.**  All 14 pawns × 6 stances × the
  five clips a client needs to hold a stance (`Wait Walk Run AtkWait
  Atk01`) = 84/84 complete.  `anim_stances.py --check` asserts exactly
  this and currently prints `PASS: 14 pawns, 84 stance sets, 0 core-clip
  gaps`.
- **No `_DualFist_` stance exists** in any package, even though the
  client's own enum lists `7(DUALFIST)`.  See §7.4.
- **`Atk02`/`Atk03` do not exist for Hand or Bow** on most pawns — Bow
  has a single attack for everyone, Hand has one for everyone except the
  four Orc pawns.  A client cycling `atk01/02/03` must fall back.
- **`ShieldAtk` exists only for 1HS**, which is the only stance that can
  hold a shield — consistent, not a gap.
- **The SpAtk (skill) coverage is deeply uneven** — see the lists above.
  Human Fighter has 69 stanced clips, Human Mystic 41.  Elf/DarkElf/Dwarf
  have no Dual SpAtk clips at all; Orc has no Dual SpAtk clips but 24
  Hand ones.  This is retail's authoring, not a conversion loss.
- **`FShaman` has no `Damagefly_FShaman`** (only the typo'd
  `damegefly_FShaman`) and `MShaman` lost 25 sequences to any
  case-sensitive tool — both are covered.

### 7.4 The mapping — `editor/characters/stances.json`

Written by `tools/src/char_pipeline/build_stances.py`
(`--check` re-derives and fails on drift).  **Keyed on `handness`**, per
the client enumeration in §7.1; `weapon_type`, `body_part` and the aCis
type name are carried as cross-reference columns only.

| handness | client label | stance | items | weapon_types seen | aCis types |
|---|---|---|---|---|---|
| 0 | `HAND` | `hand` | 128 | 0, 1 | (shields, body_part 8) + PET |
| 1 | `1HS` | `1hs` | 541 | 1, 2, 3, 4, 7 | SWORD 196, BLUNT 171, DAGGER 123, ETC 46, POLE 4, BIGSWORD 1 |
| 2 | `2HS` | `2hs` | 111 | 0, 1, 2 | BIGSWORD 63, BIGBLUNT 47, NONE 1 |
| 3 | `DUAL` | `dual` | 144 | 0, 8 | DUAL 134, FIST 10 |
| 4 | `POLE` | `pole` | 217 | 2, 4, 10 | BIGBLUNT 111 (two-handed staves), POLE 99, FISHINGROD 7 |
| 5 | `BOW` | `bow` | 93 | 6 | BOW 93 |
| 6 | *(absent)* | `1hs` **(fallback)** | 4 | 0, 3 | DAGGER 2, BOW 1, FIST 1 |
| 7 | `DUALFIST` | `hand` **(fallback)** | 75 | 5 | DUALFIST 75 |

Both fallbacks are marked `"sourced": false` in the JSON with the reason
inline.  They are the only two rows that are not read straight off the
client:

- **handness 7 (DUALFIST) → `hand`.**  The client lists the mode but no
  package ships a `_DualFist_` suffix.  `Hand` is the bare-fist set:
  `SpAtk06_Hand_*` ships for all 14 pawns, and the two Orc packages carry
  22 further `SpAtk*_Hand_*` clips that exist in no other stance — i.e.
  the fist-fighter (Tyrant) skill animations live in the Hand set.  If
  someone later finds the real binding, this is the row to change.
- **handness 6 → `1hs`.**  Not in the client enumeration at all.  The 4
  items are monster-only (`2507 Lizardspear`, `4028 Giant Cannon`,
  `5127 Dailaon Knife`, `6917 Monster Only (Poison Sting)`) and all have
  `body_part` 7 (right hand), i.e. a one-handed grip.

Note two rows that look surprising but ARE the data: two-handed staves
(`Willow Staff` and 110 more BIGBLUNTs) are `handness` 4 and therefore use
the **Pole** stance, while two-handed maces (`Atuba Mace`, 46 more) are
`handness` 2 and use **2HS** — weapongrp splits the BIGBLUNT family across
two grips on purpose.  And the nine race "Fighter Fist" starter items
(`244 Elven Fighter Fist` …) are `handness` 3 → **Dual**, not Hand.

The file also carries `by_item` (all 1313 weapongrp items → stance token)
so the client never has to join anything itself, and `no_weapon: "hand"`.

### 7.5 Clip naming in the glTF

`<action>_<stance>`, all lowercase.  Action tokens are the retail ones
with `Wait` renamed to `idle` so the stanced names read like the frozen
ones:

| retail | clip | example |
|---|---|---|
| `Wait_1HS_MFighter` | `idle_1hs` | idle/guard pose |
| `Walk_Bow_FElf` | `walk_bow` | |
| `Run_Dual_MOrc` | `run_dual` | |
| `AtkWait_Pole_FDwarf` | `atkwait_pole` | combat-ready idle |
| `Atk01_2HS_MDarkElf` | `atk01_2hs` | |
| `ShieldAtk_1HS_MMagic` | `shieldatk_1hs` | |
| `SpAtk18_Dual_FFighter` | `spatk18_dual` | |

Clips per model, before → after this pass (the 14 frozen names are
included in both columns and are unchanged):

| model | before | after | stanced added |
|---|---|---|---|
| `human_fighter_m` / `_f` | 14 | 83 | 69 |
| `orc_fighter_m` / `_f` | 14 | 85 | 71 |
| `darkelf_m` / `_f` | 14 | 67 | 53 |
| `elf_m` / `_f` | 14 | 60 | 46 |
| `orc_mystic_m` / `_f` | 14 | 60 | 46 |
| `dwarf_m` / `_f` | 14 | 59 | 45 |
| `human_mystic_m` / `_f` | 14 | 55 | 41 |

`idle` and `idle_hand` render byte-identically (both resolve to
`Wait_Hand_<Prefix>`), which is the check that the frozen names did not
move.  Monsters/NPCs have no stances (they carry one weapon each in the
mesh) and keep their 2–7 clips unchanged.

Cost: `human_fighter_m` went from 0.62 MB glTF + 1.32 MB bin to 2.99 MB +
2.27 MB (129 KB + 1.86 MB gzipped).  Without the constant-track collapse
described in §3 it would be ~3 MB larger again.
