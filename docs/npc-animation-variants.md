# Original NPC class animation variants

The browser's old animation catalog is keyed by mesh. Original `npcgrp.dat`
binds an NPC to both a **class** and a mesh, and several classes share the same
mesh while declaring different localized animation names. Taking the first
class for a mesh makes corpse NPCs play a living guard or merchant's idle.

`tools/anim/build_npc_variants.py` fixes the following bounded, independently
checked cases. Values are decoded afresh on each build; this table documents
the result, rather than supplying animation values to the converter.

| Original class | Original field | Sequence in the mesh's bound animation set |
| --- | --- | --- |
| `LineageNPC.e_guard_MDwarf_death` | `WaitAnimName[0]` | `deathwait_Hand` |
| `LineageNPC.e_trader_Morc_death` | `WaitAnimName[0]` | `deathwait_Hand` |
| `LineageNPC.angel_death` | `WaitAnimName[0]` | `deathwait` |
| `LineageNPC.a_traderA_Mhuman_deco` | `WaitAnimName[0]` | `Social02` |
| `LineageNPC.a_traderA_Mhuman_deco` | `NpcSocialAnimName[0]` | `Death_Hand` |

The supplied Interlude files contain ten NPC records using those classes:
30675, 30761, 30762, 30763, 30980, 31074, 31665, 31752, 32015 and 32038.
Sequence matching follows original name case insensitivity and preserves the
actual PSA spelling in the generated clip name. The new glTF clips are named
`native:<sequence>`; original geometry, materials and earlier clips remain.

## Reproduction and evidence chain

Run `python3 tools/anim/build_npc_variants.py` with the owner's original
Interlude files and existing converted models available locally. The script:

1. Freshly decrypts original `system/npcgrp.dat` and package `.int` files.
2. Reads qualified parents from original UClass export `super_index` references.
   Child fields override individual array elements; packages are never dropped
   while resolving inheritance. Missing classes and cycles fail the build.
3. Retains each localized field's declaring class, its array index, the complete
   ancestry and SHA-256 hashes of the original package/table files.
4. Resolves the original SkeletalMesh object's serialized animation reference
   using UModel's package reader. An absent reference fails; no animation name
   convention or first matching candidate is used.
5. Exports the original PSK/PSA and requires complete positional bone-name
   agreement. The current four meshes pass without the older assembler's
   normalized-name or partial-bone fallback. Existing glTF bind nodes and joint
   indexes must also match the fresh original PSK conversion.
6. Appends only the five exact sequences, retaining original frame timing and
   applying the existing source coordinate conversion. It asserts that every
   earlier binary byte remains unchanged. All four products validate before
   output files are written.

Outputs are private: `assets/gamedata/npcanimations.json` and four existing
models under `editor/characters/monsters/models/`. The catalog uses
`l2-interlude-npc-animations-v1`, with `npcs` keyed by original NPC ID and
`models` keyed by the existing mesh ID. Per-model metadata includes original
UKX/PSK/PSA hashes, actual animation object, exact added clips, and final glTF
and buffer hashes. The glTF `extras.originalNpcAnimations` also records source
provenance. These supplements are separate from the older manifest's legacy
animation slot list.

Re-running against identical inputs is byte-identical. A conflicting previous
supplement is rejected; rebuild the corresponding base model before refreshing
against different original inputs. Rebuilding a base model also requires
running this helper again, because the runtime validates final asset hashes.

`editor/world/js/npcanimations.js` verifies source-field bindings and complete
model/buffer hashes, then gives the loader those very same verified bytes.
It replaces the affected entity's action with the exact clip before initial
playback. An absent, ambiguous or stale declared clip fails visibly in the
console instead of selecting a different sequence. NPCs outside this bounded
catalog retain their existing animation behavior and its existing gaps.

Validation:

```sh
python3 -m unittest discover -s tools/anim -p test_build_npc_variants.py
node --test editor/world/test/npcanimations.test.mjs
```

## Remaining fidelity gaps

This change covers the named array elements above. It does not claim the full
native animation state machine, all weapon stances, action-indexed socials,
cast phases, blending or effect timing. Original `Engine.Pawn` declares the
main animation arrays with eight entries, and its recovered script selects
several by `CurWeaponType`; the older mesh table's four-entry documentation and
unconditional slot-zero selection are incomplete. Candidate-selected clips
elsewhere remain unaudited, and two shared-model social aliases remain absent
from the browser's generic action binding.

The original `old_bookshelf` class names a `wait` clip that exists in its bound
PSA, but the current converter cannot map that PSA's skeleton reliably and
ships a static model. This requires its own source investigation.

Original teleport NPCs are also an explicit gap, not missing named meshes:
`LineageNPC.teleport_npc` and `teleport_npc_sm` have empty `npcgrp` mesh fields.
Their original script spawns and attaches an emitter from `EmitterClass`
(`Lineageeffect.teleport_map_a` or `Lineageeffect.teleport_small`). A capsule
placeholder does not reproduce this original presentation. The source emitter
decoder, rendering and lifecycle still need implementation. The local coverage
audit finds 165 configured spawn instances with blank mesh fields across these
effect classes; spawn XML is used only to prioritize the existing server's
population, never as proof of the official visual behavior.

Per-NPC texture overrides also remain separate work. Original `npcgrp` selects
gold/ghost texture variants for Golden Cursed Pig, Ghost of Adventurer, Ghost
Chamberlains/Imperial Tomb Guide and Ghost of Wigoth. A single fixed-material
glTF per shared mesh cannot represent all of those original records.
