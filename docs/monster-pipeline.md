# Monster/NPC Model Pipeline — L2 Interlude .ukx → web glTF

Extends the character pipeline (`character-pipeline.md`) to creatures.
Builder: `tools/src/char_pipeline/build_monsters.py`
(`/usr/bin/python3 tools/src/char_pipeline/build_monsters.py [only_id ...]`).

## Sources

- Meshes/anims: `assets/interlude/animations/LineageMonsters.ukx`
  (240 SkeletalMeshes; monsters), `LineageMonsters2/3.ukx` (later-chapter
  monsters), `LineageNpcs.ukx` (179, humanoid NPCs: `a_*` prefixes),
  `LineageNPCs2.ukx`, `lineagenpcsev.ukx`, `lineagedecos.ukx`.
  Player-race packages (Fighter/Magic/Elf/DarkElf/Orc/Shaman/Dwarf) are
  characters, see character-pipeline.md.
- Bindings: `assets/gamedata/npcgrp.json` (npcgrp.dat decoded):
  npcId → `LineageMonsters.<mesh>` + texture refs
  (`LineageMonstersTex.<monster>_t00`; `textures[0]` = default variant).
  Village NPCs have no npcgrp entry — their multi-section materials come
  from each mesh's own .ukx `ULodMesh.Textures` slots (l2lib
  `mesh_material_slots`, ordinal section order — verified visually).
- Animations: the package's `<creature>_anim` MeshAnimation (naming
  varies: `gremlin_anim`, `Fox_anim`, `Goblin_animation`,
  `Black_Market_trader_anim` — builder tries all three conventions).

## Frozen output contract

```
editor/characters/monsters/
  manifest.json   {"models": [{"id", "gltf": "models/<id>.gltf",
                               "animations": [...]}, ...]}
  models/<id>.gltf + .bin + <id>.png (or <id>_sN.png per section)
```

Manifest merge is idempotent (single-id rebuilds don't clobber).
Client (`editor/world/js/entities.js::upgradeToMonster`) resolves
npcId → mesh name (npcMeshes) → manifest id, so ids MUST stay the exact
mesh object names (e.g. `gremlin_m00`).

## Which MeshAnimation a mesh uses (decoded, was guessed)

The mesh -> animation-set binding is **in the binary**, not a naming
convention. A UE2 `USkeletalMesh` serializes an `Animation` object
reference (UEViewer `UnMesh2.cpp`: `Points2 << RefSkeleton << Animation`)
naming the MeshAnimation the mesh is rigged against. l2lib's mesh reader
stops at the Materials array and never reaches that field, so the builder
used to derive the animation from the mesh NAME (`<base>_anim`, then a
prefix match). The reference oracle resolves it properly — loading the
mesh alone makes UEViewer follow the reference and log it:

```
$ tools/bin/umodel -game=l2 -dump animations/LineageMonsters.ukx hunter_gargoyle_m00
Loading MeshAnimation hunter_gargolye_anim from package LineageMonsters.ukx
```

`build_monsters.bound_animation()` reads that line and uses it as the
primary binding; the old name convention is now only a fallback for meshes
that carry no reference but do have an identically-named MeshAnimation.
Control case: `gremlin_m00` -> `gremlin_anim`, i.e. it agrees with the old
convention wherever the old convention was right.

Surveying all 495 manifest meshes, **42 were bound wrong or not at all**
(838 spawned instances). Classes the name convention could never reach,
and must not have guessed at:

| class | example | binding |
|---|---|---|
| transposition typos in retail data | `hunter_gargoyle_m00` | `hunter_gargolye_anim` |
|  | `marsh_stakato_m00` | `marsh_stakarto_anim` |
|  | `ketra_orc_chieftain_m00` | `Ketra_orc_cheiftain_anim` |
|  | `golem_cannon_catapult_m00` | `Golem_Cannon_Captapult_anim` |
|  | `lilim_knight_m00` | `lilim_kinght_anim` |
| several plausible sets, one is right | `heretic_privates_m00` | `_anathema_anim`, not `_hatchet_anim` |
|  | `heretic_privates_a_m00` | `_hatchet_anim` |
|  | `halisha_a/b_m00` vs `halisha_c/d_m00` | `Shadow_Of_Halisha_a` vs `_b` |
| another creature's set entirely | `youth_ostrich_m00` | `Rough_Ostrich_anim` |
|  | `elpy_m00` | `Rabbit_anim` |
|  | `a_tombkeeperA_m00` | `a_mageguild_master_FHuman_anim` |
| variant suffix the convention dropped | `apostle_grail_a_m00` | `Apostle_grail_bow_anim` (bow, not the melee set) |
|  | `*_m00_mon` NPCs | `*_mon_anim` |
| word order | `ant_soldier_m00` | `soldier_ant_anim` |

34 of the 42 had been shipping as **static** meshes (750 spawned
instances) and now animate; 6 more had a wrong or partial set.

This retires two "documented gaps" that were really just unread data:
`alchemic_box_m00` **is** bound to `mimic_anim` (the chest is a mimic) and
`elpy_m00` to `Rabbit_anim`. The old note below claimed the binding "lives
in the LineageMonster uscript classes, which are not in this repo" — the
`.u` packages *are* in `assets/interlude/system/`, but they hold only class
names (no `_m00` / `_anim` object references), so they were never the
source. The mesh export is.

## Animation mapping (frozen, what the client gets)

Monster psa anim names differ from players. Mapping used by the builder
(first hit, case-insensitive):

| clip    | psa candidates (in order)                                              |
|---------|------------------------------------------------------------------------|
| idle    | `Wait`, `Wait_1HS`, `Wait_Hand`, `SpWait01`                            |
| walk    | `Walk`, `Walk_1HS`, `Walk_Hand`                                        |
| run     | `run`, `Run_1HS`, `Run_Hand`, `Run`                                    |
| attack  | `atk01`, `Atk01_1HS`, `Atk01_Hand`, `Atk01_Bow`, `Atk01_Pole`, `Attack01` |
| die     | `death`, `Death_Hand`, `die`, `Death`                                  |
| corpse  | `deathwait`, `deathwait_Hand` (1-frame static pose, zero duration OK)  |
| special | `SpWait01`, `Social01`, `atkwait`, `AtkWait_1HS`                       |

The client's keyword matcher (idle/wait/stand, walk, run, attack/atk/hit,
die/death) hits: `idle`, `walk`, `run`, `attack`, `die` directly;
`corpse` for the death end pose.  All 25 monsters carry the full 7-clip
set; the 2 civilian NPCs (commoner, trader) ship `idle`+`special` only
(non-combat NPCs — their packages have no combat anims; the guard NPC
has the full set).

## Coverage: how much of the world actually renders

`tools/src/char_pipeline/coverage.py` measures the only thing that matters
to a player — the share of **spawned instances** (not distinct npcIds) that
resolve all the way to a glTF. It walks the client's own three hops
(npcId → npcgrp mesh_name → manifest id) over the aCis spawn tables,
weighting each npcId by its `total` across `spawnlist/*.xml` (54,901
instances in 102 tiles).

```
python3 tools/src/char_pipeline/coverage.py                 # overall + per tile + worklist
python3 tools/src/char_pipeline/coverage.py --starter       # the six newbie regions
python3 tools/src/char_pipeline/coverage.py --tiles 17_25   # one tile
python3 tools/src/char_pipeline/coverage.py --check         # exits 1 if coverage regressed
python3 tools/src/char_pipeline/coverage.py --update-baseline
```

Baseline: `tools/src/char_pipeline/coverage_baseline.json` — currently
99.6958% (54,734/54,901 instances, 495 models); `--check` gates against it.

| scope | first pass | coverage wave | now |
|---|---|---|---|
| all 102 tiles | 22.0% | 71.4% | **99.7%** |
| six starter regions (33 tiles) | 39.4% | 90.7% | **99.8%** |
| human newbie tiles (17_25, 16_25, 16_24, 21_25, 17_22, 17_23) | 69.4% | 99.1% | **100.0%** |

The coverage wave worked the ranked worklist end to end: **347 unbuilt
meshes / 15,558 instances in, 346 built** (manifest 150 -> 495 models).
54,734 of 54,901 spawned instances now resolve to a glTF. What is left:

- `heart_of_warding_m00` — **2 instances, unbuildable as data stands.**
  Its npcgrp texture `LineageNpcsTex.Heart_of_warding_t00` is a `TexEnvMap`
  whose `Material` is the `Cubemap` `d_vally_cube`: the object has no
  diffuse bitmap at all, it is a pure reflection material. glTF
  metallic-roughness has no equivalent, and painting it with anything else
  would be inventing its appearance. Needs an env-map material path, not a
  texture fix.
- 165 instances (0.3%) whose npcgrp record has an **empty `mesh_name`** —
  no mesh is named by the data, so nothing can be built.
- `core_m00` — builds, but 2 of its 7 sections have a null material slot
  in both the mesh and npcgrp and ship untextured (1 instance).

Two caveats the script reports rather than hides:
- `maximumNpcs` vs per-`<npc>` `total` is unverified upstream
  (docs/spawn-tables.md §9); `--sensitivity` recomputes under a
  proportional cap and moves the headline by 0.6 pp.
- Tiles come from the spawn **filename**; `--verify-tiles` re-checks it
  against `pos` for the 9,286 fixed spawns (22, 0.237%, land outside).

## Builder: arbitrary meshes, not a fixed roster

`build_monsters.py <mesh_id> ...` now builds **any** mesh id, taking its
package from npcgrp (`LineageMonsters`/`2`/`3`, `LineageNpcs`,
`LineageNPCs2`, `LineageDecos`) and resolving the `.ukx` filename
case-insensitively against the real directory. The ranked worklist from
coverage.py feeds straight in. With no arguments the static starter roster
builds exactly as before.

**Run it serially, one id per process.** The manifest is shared
append-merge state; two concurrent builders corrupt it.

## Fixed: npcgrp `textures` is per-section, not a variant list

The monster path used `textures[0]` for every section, so a multi-section
monster was painted with its body texture everywhere — `skeleton_archer_m00`
referenced the same PNG three times where retail has t00/t01/t02.

Evidence for the correction: for meshes carrying both, the in-package
`ULodMesh.Textures` slots and npcgrp's `textures` array agree
element-for-element — `orc_fighter_m00` slots `[orc_fighter_t00,
orc_fighter_t01]` vs npcgrp `[...t00, ...t01]`, `mats=[0,1]`; likewise
`elpy_m00`, `undine_m00`. Monsters and NPCs now share one ordinal section
path (mesh slots first, npcgrp refs as fallback for null slots). Output
naming: `<id>.png` when there is one section, `<id>_sN.png` when there are
several. 19 pre-existing monsters were rebuilt under the fix (goblin,
skeleton, both spiders, zombie, troll, harpy, …).

## Meshes with no usable animation ship static, not skipped

A mesh whose animation cannot be sourced ships with `animations: []` (what
`build_npcs.py` already does for retail-static NPCs) rather than leaving a
capsule — correct geometry standing still beats a coloured pill. Two
triggers, both of which print the reason:

1. **no `Animation` reference on the mesh** — genuinely inanimate retail
   props (altars, coffers, tablets, obelisks, the x-mas tree, ice
   sculptures…). 42 meshes.
2. **the bound psa does not fit** — `assemble` refuses a psa whose bone
   names do not match the mesh skeleton ("matched only N/M bones; refusing
   to guess"); `build_one` now catches that refusal instead of losing the
   whole model. Single-bone props whose `<name>_anim` is rigged on a
   `Dummy01` root: `Evilate_m00`, `old_bookshelf_m00`,
   `grail_brazier_b_m00`, `pavel_weather_controller_m00` (21 instances).

**51 of 495 entries are static (241 spawned instances).** Six of them have
a real animation set that the frozen 7-clip contract cannot map because the
psa has no idle: `crokian_sorcerer_m00` / `crokian_vice_elder_m00` (only
`Social01/02/03`), `follower_of_frintessa_m00` (a full 1HS set but no
`Wait_1HS`), `follower_of_frintessa_tran_m00`, and
`castle_kent_statue_jewel_m00` (`open`/`close`/`openwait`/`closewait` — a
mechanism, not a creature). 8 instances total. Mapping those would mean
extending `ANIM_CANDIDATES` with clips that are not the retail idle, so
they stay static until the client grows a non-idle default.

## Fixed: two ids differing only in case (the Linux-404 defect)

The manifest used to carry **two entries for the dwarf trader**,
`Black_Market_Trader_MDwarf_m00` (from `build_monsters.NPCS`) and
`black_market_trader_MDwarf_m00` (npcgrp's spelling). Only one set of files
existed on disk, so one entry's `gltf`/PNG uris resolved on macOS's
case-insensitive filesystem and **404'd on a case-sensitive Linux web
server**, dropping that NPC back to a capsule in production.

All three parts of the fix are in:

- `build_monsters.NPCS` now lists npcgrp's spelling
  (`black_market_trader_MDwarf_m00`); npcgrp is authoritative because the
  client keys off it. The stale entry and its files were removed and the id
  rebuilt.
- The manifest merge step **refuses to write** two ids equal under
  `lower()` (exit 2) instead of emitting the ambiguity.
- `validate_gltf.py` checks buffer and image uris **case-sensitively
  against `os.listdir`**, not `os.path.exists`. It caught a live instance
  of the defect during that very rebuild: macOS keeps the *existing*
  filename when a differently-cased file is overwritten, so the rebuilt
  glTF referenced `black_market_trader_MDwarf_m00_s0.png` while the file on
  disk was still `Black_Market_...`. Delete the old files before rebuilding
  an id whose case changes.

## Fixed: texture packages and name collisions

- `find_utx` searches `systextures/` first, then `textures/`. A few npcgrp
  refs name a MAP texture package the client ships under `textures/`
  (`core_m00` -> `dion_curumadungeon_t`).
- `find_material_export` skips a `Package` (group) export that shares its
  name with the material it contains. `LineageMonstersTex3` has both
  `Drake_Raid_t00` (Package, holding `Drake_Raid_t00_sp`, `Drake_Raid_t01`,
  …) and `Drake_Raid_t00` (Shader); a plain `find_export` returned whichever
  came first in the export table. Only `Package` exports are skipped —
  nothing is chosen by similarity. Measured blast radius: 5 collisions
  across the whole texture corpus (3 in `LineageNpcsTex`, 2 in
  `LineageMonstersTex3`), **0 in any character package**, so the character
  pipeline is provably unaffected.

## Notes / caveats

- Skeletons generalize: quadrupeds (wolf/fox/spider/bear) and
  multi-style rigs build with the same full-skeleton psk path.  Some
  monster psa bone orders don't match the mesh REFSKELT positionally
  (rabbit, hobgoblin, skeleton_archer, imp, troll) — assemble.py falls
  back to a normalized name-occurrence bone map (strips spaces: `Bip01
  Pelvis` == `Bip01_Pelvis`); psa bones not present in the mesh skeleton
  (e.g. `Sword Bone01`, `Bip01 R Finger0R`) are skipped with a log note.
- Textures: `LineageMonstersTex.utx`/`LineageMonstersTex2.utx` are NOT
  in assets/library — PNGs are decoded from the .utx with l2lib
  (`decode_texture_png`, alpha kept for hair/feather planes).
- `corpse` clips are single-keyframe static poses; validate_gltf.py
  reports them as a warning, not an error.
- Roster: 25 starter-area monsters (gremlin, rabbit, fox/keltir, wolf,
  dire wolf, werewolf, goblin, hobgoblin, giant/poison spider, skeleton,
  skeleton archer, zombie, pirate zombie, imp, pixy, dryad, bugbear,
  troll, batur orc, wererat, crimson bear, virud lizardman, stone golem,
  harpy) + 3 village NPCs (elf guard, human commoner, dwarf trader).
- Roster is no longer a fixed list — see "Builder: arbitrary meshes"
  above. The manifest holds **495 entries**, 495 glTFs, no duplicate ids
  under `lower()`.
- Verified after the coverage wave: **495/495 pass `validate_gltf.py`**
  (0 errors; 311 warnings, all `corpse` zero-duration static poses, which
  is the documented legitimate case). **495/495 pass
  `winding_check.py --majority`** — 0 files wound inside-out; 3,851
  source-outlier faces out of 1,152,158 triangles = **0.334%**, worst
  single file 3.85% (`alchemic_box_m00`, 4/104), i.e. the assemble.py
  winding fix is inherited by every new build.
- Renders inspected at idle and attack:
  `tools/src/char_pipeline/verify/after/monsters/coverage_wave/`
  (ashuras, deinonychus, ol_mahum_champion, vampire_witch, crokian,
  ketra_orc_shaman, blade_stakato, zombie_em_knight, Drake_Raid,
  a_lord_MHuman, ketra_orc_chieftain, lienrik, hunter_gargoyle,
  marsh_stakato, alchemic_box). Each is a `_fixed` / `_inverted` pair
  from `shading_check.js`; the fixed render is 1.9-4.1x brighter in every
  case and the inverted one is a black silhouette. Note the tool's
  `--check` threshold of 3x is calibrated on characters and reads FAIL on
  models with large two-sided planes (wings, capes) that stay lit either
  way — read the pair, not just the ratio.

## Civilian NPCs (M-next: towns without capsules)

`tools/src/char_pipeline/build_npcs.py` converts civilian NPCs into the
same manifest.  Roster = aCis spawn ground truth
(`server/aCis_datapack/data/xml/spawnlist/17_2*.xml`, Talking Island)
cross-referenced with `assets/gamedata/npcgrp.json` (npcId →
`LineageNPCs.<mesh>`, `LineageNPC` class only): **56 distinct meshes
covering 146 civilian spawns** (Roien 30008, Newbie Helper 30009,
traders, warehouse keepers, guild masters/teachers, priests, guards,
fishermen, priests of dawn/dusk, heroes obelisk, pig ball).

- Packages: `LineageNpcs.ukx` (a_* + e_* + priests/obelisk),
  `LineageNPCs2.ukx` (pig_ball).  Textures: mesh's own .ukx material
  slots (ordinal), falling back to the npcgrp texture refs when a slot
  is null (e.g. `a_mageguild_teacher_FElf_m00`).  `_sp` textures handled
  per the L2 convention (diffuse in RGB) — non-suffixed sibling from the
  library when exported, else RGB decoded from the .utx.
- Animations: per-mesh `<name>_anim`.  Guards/fighters carry the full
  combat set (idle/walk/run/attack/die/corpse/special); most civilians
  idle/walk/social; three retail-static NPCs (fisherA, traderC, heroes
  obelisk) ship with `animations: []` (no anim set exists in the package
  — authentic; the client keeps the static pose).
- Entries merge into `editor/characters/monsters/manifest.json` with the
  same shape and `nativeHeight` (computed per build: bind extent ×100 ×
  MeshScale; obelisk = 137.0 units tall, humans 43–48, dwarves ~36).
  Merge discipline: never rewrite the manifest wholesale; single-id
  rebuilds supported (`build_npcs.py <mesh_id> ...`).
- Status: 83/83 entries valid, 83/83 with nativeHeight.  Renders:
  `verify/after/monsters/{roien,newbie_helper,trader,warehouse_dwarf,priest_dawn,mage_teacher}.png`.
