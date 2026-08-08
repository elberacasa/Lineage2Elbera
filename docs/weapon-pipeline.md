# Weapon/Shield Model Pipeline — LineageWeapons.ukx → web glTF

Extends the character pipeline (`character-pipeline.md`) to equippable
weapons and shields.  Builder:
`tools/src/char_pipeline/build_weapons.py`
(`python3 tools/src/char_pipeline/build_weapons.py [mesh_id ...]`,
`--list`, `--check`).

Status: **180 of the 181 newbie-grade meshes built, 180/180 pass
`validate_gltf.py`, attachment verified visually on 4 races and 5 weapon
classes** (renders in `tools/src/char_pipeline/verify/after/weapons/`).

## 1. Sources

- Meshes: `assets/interlude/animations/LineageWeapons.ukx` — 417
  SkeletalMesh objects (`_wp` weapons, `_sh` shields, a few `_et`) plus
  exactly 2 MeshAnimations (`Bow_anim`, `F_Stick_anim`, which are
  *character* arm poses, not weapon rigs).
- Textures: `assets/interlude/systextures/LineageWeaponsTex.utx`
  (530 Textures, 93 Shaders, 48 FinalBlends, …).  Exported PNGs already
  exist in `assets/library/LineageWeaponsTex/`.
- Bindings: `assets/gamedata/weapongrp.json` (weapongrp.dat decoded) —
  1,313 records; `object_id` IS the server item id, `mesh`/`texture` name
  the package objects, `handness` says how the item is wielded.
- Grades: `server/aCis_datapack/data/xml/items/*.xml` (`crystal_type`).

## 2. Roster: what a player meets in the first hours

Newbie/low-level = crystal grade **NONE and D**.  `crystal_type` is
absent on NONE items in the datapack, so absent == NONE.

**Cross-check that validates both sources:** weapongrp's own integer
`crystal_type` agrees with the datapack letter for **all 1,313** records
(0=NONE 1=D 2=C 3=B 4=A 5=S) — 413 records are NONE/D.  The builder
re-runs that comparison at roster time and drops (loudly) any record
where the two disagree.

Excluded from the roster: items named `Monster Only*` (never equippable),
`body_part == 0` (not an equip slot — e.g. the 33 quest items that point
at `dropitems.drop_sack_m00`), and meshes outside the LineageWeapons
package.

Result: **181 distinct meshes** (163 `_wp`, 17 `_sh`, plus the
suffix-less `flower_m00`) covering 413 item ids.  That is well over the
~60 that would have made the choice obvious, but these are small static
props — the whole roster builds in about three minutes of umodel — so all
181 are attempted rather than a ranked subset.

`--list` prints the roster ranked by how many item ids share each mesh
(`bastard_sword_m00_wp` 12, `apprentices_staff_m00_wp` 11,
`spinebone_sword_m00_wp` / `knights_sword_m00_wp` / `vipers_canine_m00_wp`
10, …).

### handness is an item property, not a mesh property

A dual-sword item (`handness` 3, e.g. "Saber\*Bastard Sword") references
**two** one-handed meshes, so 8 sword meshes are seen with both 1 and 3.
Resolution used: take the handness the mesh has in records where it is
the item's **only** mesh — verified unambiguous for all 165 meshes that
have such a record.  The 16 meshes that only ever appear paired (fist
weapons, dual swords: `iron_glove_m00_wp`, `vipers_canine_m00_wp`,
`aka_m00_wp`, …) take the most common value across all their records,
since paired IS how they are worn.

Distribution: 92× one-hand (1), 25× pole/staff (4), 17× shield (0),
16× two-hand (2), 13× bow (5), 11× dual fist (7), 5× dual sword (3),
2× other (6).

## 3. Attachment — nothing to correct

The character glTFs already carry NCSoft's own weapon sockets as nodes
named `Weapon_R_Bone` / `Weapon_L_Bone` (present in all 14 models).  The
weapon mesh is parented to the socket with an **identity transform**; no
offset, rotation or scale is applied anywhere, client-side or at build
time.  Three facts make that correct rather than lucky:

1. **The psk points are already in socket-relative mesh space.**  An
   ActorX `.psk` stores Points in reference-pose mesh space.  umodel's own
   `-gltf` export of `small_sword_m00_wp` writes a mesh node with **no
   transform** whose child is the single bone — i.e. the geometry is
   positioned in mesh space and the bone's bind transform is cancelled by
   the inverse-bind matrix.  Measured: the short sword's grip sits at
   mesh-space x≈0 with the blade running to x=+18.7 and the pommel to
   x=−5.2.  169 of the 180 built meshes have their long axis on mesh X;
   the 11 that don't are 6 round shields (longest across the shield
   plane) and 5 fist claws (longest along the punch direction) — all
   correct for their shape.
2. **MeshScale/MeshOrigin/RotOrigin are identity for the whole roster.**
   `ULodMesh` carries these three and the engine applies them at
   *instance* time, on top of the psk points (UEViewer
   `SkelMeshInstance.cpp:193-199`).  Decoded from the .ukx for all 417
   objects: **410 are exactly MeshScale=(1,1,1), MeshOrigin=(0,0,0),
   RotOrigin=(0,0,0)**.  The 7 exceptions — `box_m00_et`,
   `shield_of_pledge_m00_sh`, `Arrow_`, `headgear_m00`,
   `skull_graver_m00_wp01`, `maingauche_m00_wp_`, `krono_arrow_m00_wp` —
   are all off-roster.  `build_one()` **refuses** to ship a mesh whose
   transform is not identity (`--allow-xform` overrides and then records
   the raw values in the manifest entry) rather than silently dropping a
   transform.
3. **The scale matches the body.**  Weapons are emitted in the same
   `(x, z, -y) * 0.01` convention as `build_characters.py` bodies, so a
   weapon inherits the character's own uplift scale through the bone it
   hangs on.  No per-weapon rescale exists or is needed.

Verified visually with `tools/src/char_pipeline/weapon_check.js`
(`node weapon_check.js <charId> <weaponId>:<R|L>[,…] [anim] [t] [out.png]`),
which parents the weapon glTF to the socket and never touches
position/rotation/scale.  `verify/after/weapons/`:

| render | what it shows |
|---|---|
| `human_fighter_m_sword_shield.png` | short sword in the right hand, tower shield on the left forearm, idle |
| `human_fighter_m_sword_attack.png` | same sword tracking the `attack` clip overhead |
| `elf_f_bow.png` | bow gripped at the riser |
| `human_mystic_m_staff.png` | journeyman's staff held on the shaft |
| `dwarf_m_iron_gloves.png` | iron gloves on both fists |

## 4. Output contract (frozen)

```
editor/characters/weapons/
  manifest.json   {"models": [{"id": "small_sword_m00_wp",
                               "gltf": "models/small_sword_m00_wp.gltf",
                               "handness": 1,
                               "nativeHeight": 0.6,
                               "nativeLength": 23.9}]}
  models/<id>.gltf + .bin + <id>.png   (or <id>_sN.png per section)
```

Merge is append-only and idempotent, exactly as for monsters; the builder
rewrites and re-parses the manifest after every id, so an interrupted run
leaves valid JSON.

### id case convention: **lowercase**

`id` is the weapongrp mesh object name **lowercased**, and the glTF/bin/PNG
basenames are the same string.  Reason, from the data: **weapongrp.dat and
the .ukx export table disagree in case for 6 objects** — weapongrp writes
`cedar_staff_m00_wp` and `short_bow_m00_wp`, the package holds
`Cedar_staff_m00_wp` and `Short_bow_m00_wp`, and *both of those are on the
newbie roster*.  An id copied from the package spelling would resolve on
macOS's case-insensitive filesystem and **404 on a case-sensitive Linux
web server** — the exact defect already recorded for the monsters manifest
(`monster-pipeline.md`, "Known defect").  All 417 object names are unique
under `lower()`, so lowercasing is lossless.  The client does
`weapongrp[itemId].mesh[i].split('.')[1].toLowerCase()`.

`--check` enforces it: ids must be lowercase, unique under `lower()`, and
every `.gltf`/`.bin`/image must be present in a **case-sensitive**
`os.listdir` of the model directory (`os.path.exists` lies on macOS).

### The two size fields

`nativeHeight` is the same number the character/monster manifests carry,
from the same `scale_util.native_height()` (glTF Y extent × 100 ×
MeshScale.z).  For a weapon it is close to meaningless: weapons are
modelled along mesh X with the flat of the blade in Z, and glTF Y == psk
Z, so a short sword's `nativeHeight` is **0.6** — its blade *thickness*.
`nativeLength` (max over axes of psk extent × the matching MeshScale
component) is the number that actually describes a weapon: **23.9** L2
units for `small_sword_m00_wp` against a ~45-unit-tall human.  Both are
descriptive; neither is applied by the client, because the weapon
inherits the character's scale through the socket.

## 5. Format decisions

- **Static, unskinned.**  One identity node → one mesh → one primitive per
  material section.  No skin, no bone node, no IBM, no animations.
  Dropping them moves no vertex (see §3.1) and removes every ambiguity
  about how the client should parent the model.  179 of the 180 built meshes
  have a single bone anyway; only `fishing_rod_m00_wp` has more (7) and it
  still ships its reference pose, which is what a static prop needs.
- **Winding is reversed relative to the psk face order** — and this is a
  fix, not a quirk.  `ExportPsk.cpp` mirrors the mesh (`MIRROR_MESH`:
  points' Y negated, lines 98-112) and swaps `WedgeIndex[0]/[1]` to
  compensate (line 184), so psk faces are CCW *in psk space*.  The
  pipeline's psk→glTF map `(x, z, -y)` has determinant +1, but composed
  with that mirror the net UE→glTF map `(x, z, y)` has determinant −1, so
  the psk order comes out CW in glTF space while `_point_normals()`
  produces outward normals.  Measured on `small_sword_m00_wp`:
  unreversed, **86/86** faces have their geometric normal opposite to
  their vertex normals; reversed, **0/86** disagree and the triangle set
  (positions + UVs + winding) is **identical to umodel's own `-gltf`
  export**.
- **Materials.**  Per-section, ordinal, from the mesh's own `.ukx`
  material slots (`Materials` → `Textures`) with weapongrp's `texture`
  array as the ordinal fallback — most LineageWeapons meshes leave the
  slot null (`small_sword_m00_wp` does), and weapongrp's array is a
  per-section list, not a variant list (`tower_shield_m00_sh` has two
  slots and weapongrp lists exactly `tower_shield_t00_sh`,
  `tower_shield_t01_sh`).  PNG sourcing and the `*_sp` rule (diffuse in
  RGB, specular mask in alpha) are shared with the monster path.
- **alphaMode from the texture's own UE2 flags**, never from the pixels:
  `bMasked` → `MASK`, `bAlphaTexture` → `BLEND`, otherwise opaque.
  LineageWeaponsTex sets `bMasked` on 226 of its 530 Textures and
  `bAlphaTexture` on 77.

## 6. Verified / known gaps

- `validate_gltf.py`: **180/180 OK**, 0 errors.  (It gained a two-line
  guard so a mesh with no `skins` array no longer crashes the JOINTS_0
  check; skinned models are unaffected.)
- `--check`: PASS, 0 errors — ids lowercase and unique, files present
  case-sensitively, no node carries a transform, no skins/animations,
  handness matches the freshly re-derived roster.
- **`mon_grail_spear_m00_wp` — 1 mesh not built.**  Item 9137 "Sword of
  Valakas (2-Handed)" points at `LineageWeapons.Mon_grail_spear_m00_wp`,
  which **does not exist** in the Interlude `LineageWeapons.ukx` — it is
  the only one of weapongrp's 390 distinct LineageWeapons mesh references
  with no matching export.  Nothing to build; not a pipeline failure.
  (Grade NONE only because it is a raid-drop special, which is why a
  Valakas sword lands on a "newbie grade" roster at all.)
- **Two texture gaps, both genuine source-data gaps, both shipped with
  the untextured fallback colour rather than a guess:**
  - `flower_m00` ("Bouquet", item 4027 — the wedding prop): the mesh's
    material slot is null AND weapongrp's `texture` is `[""]`.
    `LineageWeaponsTex` contains no object matching `flower*`/`bouquet*`,
    and the whole `assets/library` index has none that is a weapon
    texture either (only icons and scenery).  Rendered, it is a large
    (71-unit) flat untextured fan in the hand — it IS in the manifest,
    but the client should treat it as cosmetic-only until a texture
    binding turns up.
  - `nos_sword_m00_wp` section 1: the mesh has two material sections but
    weapongrp lists a single texture and both slots are null.  The utx
    holds `nos_sword_t00_wp` and a *Package* named `nos_sword` (a group,
    not a material) — there is no second texture to bind.
- **The same defect in the shared skinned path — RESOLVED 2026-08-07.**
  `assemble.py::merge_parts` used to emit the psk face order unchanged, so
  every character/monster/NPC glTF carried the inverted winding described
  in §5 (measured 486/486 inverted faces on `human_fighter_m`'s first
  primitive, 2256/2256 over the whole model).  It now calls the shared
  `assemble._face_indices`, which is also what the code above uses, so the
  static and skinned paths cannot drift apart.  All 14 characters and 150
  monster/NPC entries were rebuilt and re-verified; the measurement,
  the residual source-data outliers and the A/B shading proof are in
  `docs/character-pipeline.md` §3 and §5.
- Bows are shipped static.  `Bow_anim` in the package animates the
  *character's* arms, not the bow; no weapon mesh in this roster has a
  matching MeshAnimation.
