# Ground-Truth Oracle — L2 Interlude Character Showcase

The oracle answers "what should it look like?" without guessing. It has two
independent tracks that cross-validate each other:

- **Track A — authoritative renders from the retail data itself.** A
  rendering-enabled UEViewer build (`tools/bin/umodel-view`) renders the
  actual retail `.ukx` meshes, textures and animations, headlessly, to PNG.
- **Track B — community/retail reference.** Official NCSoft
  character-creation captures (faces + hairstyles for all 14 combos) and the
  assembly rules extracted from `shnok/l2-unity`, an actively maintained
  Unity port that solved the same problems.

All images live under `tools/reference/`. Montages used for visual
verification are in `tools/reference/_montages/`.

## Track A — umodel-view (rendering UEViewer for macOS arm64)

The stock build had `RENDERING` compiled out on macOS
(`UmodelTool/Build.h`: `#undef RENDERING` under `__APPLE__`). The rendering
build re-enables it with a vendored SDL2 (nothing installed system-wide):

- `tools/vendor/SDL2/` — SDL2 2.30.5 built from source by
  `tools/build-tools.sh` (shared dylib, `@rpath` → `@executable_path/../vendor/SDL2/lib`).
- `tools/patches/ueviewer-macos-render.patch` — applied on top of
  `ueviewer-macos-arm64.patch`:
  - `UmodelTool/Build.h`: keep `RENDERING 1` on `__APPLE__` (THREADING stays off).
  - `libs/SDL2/SDL2.project` + `common.project`: link vendored SDL2 and
    `-framework OpenGL` on osx.
  - `Core/CoreGL.h`: `APIENTRY` guard + BPTC constants missing from macOS GL headers.
  - `Core/GlWindow.cpp`: headless/env knobs (below).
  - `UmodelTool/UmodelApp.cpp`: auto-screenshot + exit (`UMODEL_AUTOSHOT`),
    iterate all skeletal meshes (`UMODEL_SHOTALL`).
  - `Viewers/SkelMeshViewer.cpp`: play a named animation (`UMODEL_ANIM`).
- Rebuild: `tools/build-tools.sh` (builds `tools/bin/umodel` CLI first, then
  `tools/bin/umodel-view`; the CLI binary is untouched).

### Headless capture API (env vars)

| Var | Effect |
|---|---|
| `UMODEL_HIDDEN=1` | hidden SDL window (GL still renders; no window appears) |
| `UMODEL_WINSIZE=WxH` | viewport size (default 800x600) |
| `UMODEL_AUTOSHOT=N` | screenshot frame N (TGA via `glReadPixels`) and exit |
| `UMODEL_SHOTALL=1` | after each shot, advance to the next SkeletalMesh and keep shooting |
| `UMODEL_YAW=deg` / `UMODEL_PITCH=deg` | rotate initial camera (yaw 180 = back view) |
| `UMODEL_DIST=f` | multiply initial camera distance (small meshes need ~3) |
| `UMODEL_ANIM=<seq>` | loop a named sequence, e.g. `Wait_Hand_MFighter` |

Screenshots land in `./Screenshots/<ObjectName>.tga` (cwd-relative).

Example — textured front render of one mesh:

```sh
UMODEL_HIDDEN=1 UMODEL_AUTOSHOT=15 UMODEL_WINSIZE=1024x1024 \
  tools/bin/umodel-view -game=l2 -path=assets/interlude \
  assets/interlude/animations/Fighter.ukx MFighter_m001_u
```

### Batch ground truth

`tools/src/ground_truth/render_ground_truth.py` renders, per combo, exactly
the meshes `chargrp.dat` binds for the creation screen (from
`editor/characters/charcreate-data.json`, not from pipeline code):

```
tools/reference/track-a/<combo>/<combo>_<part>_{front,back}.png   # 172 imgs
tools/reference/track-a/<combo>/<combo>_wait_front.png            # 14 idle-pose imgs
```

`<part>` ∈ `_f` (face), `_u`/`_l`/`_g`/`_b` (body), `_ah`/`_bh` (front/back
hair, only where the combo attaches hair meshes for style m000).
Run: `python3 tools/src/ground_truth/render_ground_truth.py [combo ...]`.

**Caveat — textures:** umodel shows the material the `.ukx` itself declares.
Male meshes usually carry their *default* variant (e.g. `MFighter_m001_t01_u`,
not the creation `t02`); most female and hair meshes declare **no** texture
slot and render as colored material sections. This is data-correct: creation
texture variants come from chargrp.dat, never from the mesh. Use track-A
images for **geometry, proportions, bind pose, skinning and facing**; use
chargrp + track B for texture-identity checks.

## Track B — retail/community reference

- `tools/reference/track-b/faces/` — 42 official NCSoft creation-screen face
  captures (types A/B/C = t00/t01/t02) for all 14 combos.
- `tools/reference/track-b/hairstyles/` — 72 official hairstyle head shots,
  all styles per combo.
- Provenance and l2-unity cross-checks: `tools/reference/track-b/SOURCES.md`.

## The authoritative assembly rulebook

1. **Part lists** — per race/gender/class from `chargrp.dat` (our
   `charcreate-data.json` matches l2-unity's parsed `chargrp.txt` field for
   field): face mesh `<Prefix>_m000_f`, body meshes `<Prefix>_mNNN_{u,l,g,b}`
   (m001 for most classes; mixed for human mages, e.g. `MMagic_M005_u` +
   `MMagic_m003_l/g/b` — exact sets in charcreate-data).
2. **Skeleton** — all parts of a race/gender share one Bip01 skeleton and
   must be re-bound to the base skeleton **by bone name**; parts never keep
   their own rig (l2-unity's SkinnedMeshSync literally assigns the root
   renderer's bone array to every part). Bone *count* varies per package
   (66–82); name-based remap absorbs that. The `<Prefix>_anim` AnimSet
   always matches the package's own skeleton.
3. **Hair** — creation hair = `<Prefix>_m000_m00_ah` (front) and/or `_bh`
   (back), only when `appearanceDetail.attachedMesh` includes style m000
   (orcs, dark-elf males, dwarf males are painted-only → no hair mesh).
   Hair-only `HairNN` bones fold into `Bip01_Head` (l2-unity parents
   armature-less hair under the head bone — same rule). The legacy `_h`
   mesh is NOT the creation hair.
4. **Textures** — only from chargrp: creation = face `t00` (options
   t00/t01/t02 = types A/B/C), body `t02` variant, hair `t00` `ah/bh`
   (FinalBlend `*_ori`, alphaMode MASK). `.ukx` texture slots hold the
   default variant (t01) or nothing — never bind textures by mesh slot or
   by name similarity. 10 of 56 body bindings are Shader materials (resolve
   Diffuse, e.g. `MFighter_m001_t02_l` → `MFighter_m001_t02_l_sp`).
5. **Facing** — measured, not guessed: with UEViewer's default camera the
   character's FRONT faces the camera (verified on `MFighter_m000_f` and
   vest renders), i.e. the mesh faces +X in UE2 space. `UMODEL_YAW=180`
   shows the back.
6. **Scale/units** — UE2 units are cm; pipeline glTF conversion:
   swap(y,z), scale 0.01 (mirrors UEViewer ExportGLTF.cpp).
7. **Case** — object names are case-inconsistent between chargrp and the
   packages (`MMagic_m005_u` in chargrp = `MMagic_M005_u` in Magic.ukx;
   `FMagic_M000_M00_bh`). All name matching must be case-insensitive.
8. **Weapon attach bones** — `Weapon_R_Bone`, `Weapon_L_Bone`,
   `Shield_L_Bone` (l2-unity UserGear.cs; present in the Bip01 skeletons).
9. **Idle reference** — creation-screen idle is `Wait_Hand_<Prefix>` (10–16
   frames, looped). `*_wait_front.png` shows the authoritative skinned pose
   per combo — compare against pipeline renders at the same pose.

## Verification evidence (all images inspected with ReadMediaFile)

- `_montages/track-a_upper_front.png` / `upper_back.png` — all 14 upper
  bodies, front and back: correct anatomy, natural shoulders, **no stray
  rod geometry anywhere** (the retail meshes are clean; rods in the web
  showcase are pipeline assembly artifacts, not source data).
- `_montages/track-a_faces_front.png` — all 14 face meshes; geometry
  matches the official captures in `track-b/faces/`.
- `_montages/track-a_lower_front.png`, `gloves_boots_front.png`,
  `hair_front.png` — all parts correct (pants/skirts, gauntlets, boot
  pairs, hair shells; some untextured by-design, see caveat).
- `_montages/track-a_wait_poses.png` — all 14 combos playing their
  `Wait_Hand_*` idle (status bar confirms sequence + frame, e.g.
  `Wait_Hand_FDarkElf 11.1/16`): relaxed arms, no skinning blowups.
- `_montages/track-b_retail_faces_typeA.png` / `retail_hairstyles.png` —
  the official retail look per combo.
- First end-to-end proof: `MFighter_m001_u` rendered textured front and
  back on 2026-07-24 (materials auto-resolved from
  `assets/interlude/systextures`).
