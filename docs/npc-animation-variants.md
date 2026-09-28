# Elbera Tools: original NPC animation selectors and variants

The browser's old animation catalog is keyed by mesh. Original `npcgrp.dat`
binds an NPC to both a **class** and a mesh, and several classes share the same
mesh while declaring different localized animation names. Taking the first
class for a mesh makes corpse NPCs play a living guard or merchant's idle.

`tools/anim/build_npc_variants.py` has two separate modes. Its default mode
builds the bounded clip supplements below. `--selectors-only` recovers the
qualified per-NPC source fields and sequence timing without changing model
assets. The same fresh collector now supplies the separate
[NPC sparse-source transport and manual inspector](original-npc-animation-runtime.md)
for Gremlin IDs 18342/20001 and fox 20091. A separate bounded
[initial Wait/AtkWait integration](native-npc-animation-evidence.md#bounded-browser-initial-loop)
now joins those inputs to explicit fresh state on Talking Island tile `17_25`,
original clocks/keys and Sound selection. Transporting selectors alone does not
establish that admission.
Values are decoded afresh on each build, rather than supplied by these tables.

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

## Existing bounded clip supplements

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

## Qualified selector recovery without rebuilding models

The selector mode reads original `npcgrp.dat`, qualified UClass parents and
localized `.int` arrays, then follows each SkeletalMesh's **serialized
Animation reference**. The animation may belong to another package. Lookup
matches the full package/object path, including groups; a name suffix or
same-named object in another package cannot select it. The bounded original
mesh reader admits package version 123, licensee 28/30 and LodMesh version 5.
An unsupported layout is reported instead of trying a different animation.

The original MeshAnimation reader preserves each sequence's frame count and
Float32 rate without decimal rounding. It does not convert these values into
playback deadlines or pick a stance. Each name retains its localized array
index and declaring class. Two NPC classes sharing a mesh therefore retain
independent selectors, including corpse-specific `WaitAnimName` values.

With local original Interlude inputs available:

```sh
python3 tools/anim/build_npc_variants.py --selectors-only --npc 18342 20001 20091 \
  --output tmp/restart-audit/npc-animation-audit/selectors.json
python3 tools/anim/build_npc_variants.py --selectors-only --npc 18342 20001 20091 \
  --output tmp/restart-audit/npc-animation-audit/selectors.json --check
python3 -S -m unittest discover -s tools/anim -p test_build_npc_variants.py
```

`--check` freshly reads the inputs and compares exact output bytes; it writes
nothing. The first command writes only the requested private catalog. Without
`--npc`, the tool attempts every original NPC record; the fresh source check
for this checkpoint covers Gremlin IDs 18342/20001 and fox 20091, not the whole roster.
Without `--output`, the selector destination is the ignored
`assets/gamedata/npcselectors.json`. No original files, generated catalogs or
raw audit extracts belong in the public tool distribution.

The `l2-interlude-npc-selectors-v1` contract contains:

| Field | Meaning and admission limit |
| --- | --- |
| `npcs[id]` | Original qualified class and mesh, complete ancestry, localized fields and per-element selectors. NPC identity is never collapsed to a mesh ID. |
| `selectors[field][index]` | Original value and declaring class. `source-sequence` adds the exact sequence spelling, frame count and rate. |
| `meshes[qualifiedName]` | Original mesh export hash, serialized reference offset/bytes hash and bound qualified animation identity. |
| `animations[qualifiedName]` | Original export hash and sequence records with their own source provenance. |
| `sources` / `sourceSHA256` | Fresh original package/table fingerprints and their canonical aggregate digest. |
| `meshes[…].built` | Optional diagnostic of the current legacy model manifest, actual glTF/buffer hashes and exact declared aliases. It is **not** source-mesh or baked-pose equivalence proof. |

An explicit original `None` produces `source-none`; an empty localized value
produces `source-empty-localized-value`; a named sequence absent from the bound
animation produces `unresolved-sequence`. Missing fields or array indexes stay
missing: this mode does not yet recover serialized default-property fallback.
An empty original mesh name, a zero Animation reference and an unreadable
source export likewise remain separate states. The localized fields survive
even when there is no usable animation. Missing/ambiguous class ancestry fails
before the output is written.

Legacy aliases require the manifest's exact source sequence and a unique
actual glTF clip name. Explicit alias chains are retained only when their
destination declares that same sequence. These records are labeled
`legacy-manifest-alias-pose-unverified`; matching labels and byte hashes do
not prove how a historical converter produced the pose. No keyword search,
first-clip fallback or visual similarity supplies a missing alias.

Fresh original results illustrate why the distinction matters:

| NPC | Serialized animation object | Ordinary localized names | Source timing examples |
| --- | --- | --- | --- |
| Gremlin 18342 / 20001 | `LineageMonsters.gremlin_anim` | Wait, walk, run, atkwait, atk01, death, deathwait | Wait 61 frames; walk 23; run 17; atk01 55; death 64; deathwait 1; each rate 30. |
| Fox 20091 | `LineageMonsters.Fox_anim` | Wait, walk, run, atkwait, atk01, death, deathwait | Wait 61 frames; walk 31; run 21; atk01 55; death 43; deathwait 1; each rate 30. |

For both classes all three localized attack-name arrays point to `atk01` at
index zero. That observation does not establish the general attack-choice
rule. Fox's localized social array names `spwait01`; no corresponding
localized Gremlin social field was recovered through its ancestry. The latter
is unresolved, not proof that the native client never plays its `SpWait01`.
Both current legacy models omit an `atkwait` clip despite its presence in the
original animation object.

## Native consumer boundary

A separate read-only inspection of the owned Interlude `Engine.dll`
(`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`)
establishes why a source name table alone is insufficient for a runtime port.
The following are preferred-image-base virtual addresses, not RVAs; the
selector exporter verifies the data chain above, not these native bodies.

| Native consumer | Bounded finding |
| --- | --- |
| `APawn::GetCurMoveAnimName`, `0x106176b0` | Ordinary MoveType selects walk/run arrays indexed by `CurWeaponType`; riding and other branches remain separate. |
| `APawn::GetCurWaitAnimName`, `0x10617240` | Ordinary standing reads `WaitAnimName`; combat reads `AtkWaitAnimName`; dead state reaches `GetDeathWaitAnimName`. Sit, swim, ride and abnormal-state branches also exist. |
| `GetDeathAnimName`, `0x10614bb0`; `GetDeathWaitAnimName`, `0x10614ca0` | Death transition and corpse wait use distinct source arrays, with special-state alternatives. |
| `OnNpcInfo`, `0x10494b40` | Stores incoming move/wait and dead/combat state before resource setup and `GetCurWaitAnimName` loop playback at `0x10495634–0x10495654`. |
| `OnDie`, `0x10490b50` | Sets dead state and uses `GetDeathAnimName` for one-shot playback. This audit does not recover the complete subsequent AnimEnd/corpse lifecycle. |
| `User::GetAnimType`, `0x10485c10` | Computes the stance from equipment/item metadata; general slot-zero selection cannot be justified by an NPC's class name. |
| `SwordAttackProcess`, `0x106317f0` | Selects among three attack-name arrays. The upstream choice helper remains unbound, so no random-choice policy is claimed. |

Movement rates also have source rate arrays and native modifiers. Sequence
`rate` is the original clip rate, not a substitute for those runtime values.
The source transport now retains every Gremlin/fox sequence and verifies the
existing models' triangle geometry and bone identities. The bounded initial
Wait/AtkWait path separately checks source fingerprints and complete raw state;
the original spawn-event table miss closes mode 2 for these three IDs only.
The separately recovered [18342 identity](native-npc-animation-evidence.md#edition-and-exact-source-domain)
is not a display-name alias or an assertion that its differing final source
DWORD has no other consumers.

The original GPU influence inputs are now preserved, without claiming full
native bind/deformation parity. Subsequent NpcInfo and handled movement, action
and state transitions retire the initial path rather than fabricating re-entry.
Its resource-ready start does not reconstruct native loading or lazy-loader history.
Initial dead NPCs still need the original corpse-wait selector instead of an
immediate death transition.
General attack choice, transitions/blend clocks and the current authored corpse
fade remain separate gaps.

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

Per-NPC materials have their own bounded implementation and limits, described
in [original NPC material bindings](native-npc-material-evidence.md). The seven
ghost overrides and Angel wing-alpha correction do not imply complete Shader
or lighting parity; Golden Cursed Pig's specular graph remains unresolved.
