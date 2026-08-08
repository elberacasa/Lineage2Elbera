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

Baseline: `tools/src/char_pipeline/coverage_baseline.json`.

| scope | before | after |
|---|---|---|
| all 102 tiles | 22.0% | **71.4%** |
| six starter regions (33 tiles) | 39.4% | **90.7%** |
| human newbie tiles (17_25, 16_25, 16_24, 21_25, 17_22, 17_23) | 69.4% | **99.1%** |

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

## Fixed: meshes with no animation set ship static, not skipped

Some monster meshes are inanimate props — `alchemic_box_m00` (a chest) has
no `alchemic_box_anim` in the package. The mesh→MeshAnimation binding lives
in the `LineageMonster` uscript classes, which are **not** in this repo, so
pairing it with the similarly-named `mimic_anim` would be a guess. The
builder now ships the static mesh with `animations: []` (what
`build_npcs.py` already did for retail-static NPCs) rather than leaving a
capsule. Currently static: `alchemic_box_m00`, `elpy_m00`.

## Known defect (pre-existing, NOT fixed here)

The manifest carries **two entries for the dwarf trader** differing only in
case — `Black_Market_Trader_MDwarf_m00` (from `build_monsters.NPCS`) and
`black_market_trader_MDwarf_m00` (from `build_npcs`' npcgrp-derived
roster). Only the capitalised files exist on disk; the lowercase entry
points at `models/black_market_trader_MDwarf_m00.gltf`, which resolves on
macOS's case-insensitive filesystem and **404s on a case-sensitive Linux
web server**, dropping that NPC back to a capsule in production.
`validate_gltf.py` cannot see it for the same reason (`os.path.exists`
is case-insensitive here).

Fix (scripted, not a hand-edit): drop `'Black_Market_Trader_MDwarf_m00'`
from `build_monsters.NPCS` — npcgrp's spelling is authoritative since the
client keys off it — then rebuild that id and have the merge step reject
any two ids equal under `lower()`. Add a case-sensitive image check to
`validate_gltf.py` (compare `im['uri']` against `os.listdir` of the model
directory instead of calling `os.path.exists`).

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
  above. As of the coverage pass the manifest holds **150 entries**
  (149 glTFs; the 150th is the duplicate-case defect noted above), all
  149 passing validate_gltf.py.
- Verified: 28/28 validate; renders of 8 diverse monsters at
  idle+attack (`tools/src/char_pipeline/verify/after/monsters/`); live
  world smoke test (real gateway on :8083) shows gremlins as real models
  with `capsuleMeshes: 0` (see `app_gremlin.png`).

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
