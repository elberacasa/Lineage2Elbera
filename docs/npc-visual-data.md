# NPC visual data: original scale and collision are separate

Updated 2026-09-26. The previous version of this document recommended fitting
each mesh to twice the emulator's collision height. **That recommendation was
incorrect and has been removed from the browser runtime.** A distribution of
mesh-to-cylinder ratios, or server line-of-sight code, cannot establish the
original client's visual transform.

The replacement reads the original Interlude client:

- `npcgrp.dat` identifies the exact qualified NPC class and mesh.
- Qualified class ancestry supplies `DrawScale` and `DrawScale3D`, including
  the original `Engine.Actor` defaults. Missing sources never imply one.
- Original `ULodMesh` serialization supplies `MeshScale` for the named mesh.
- The original ordinary skeletal render path supplies an incoming scale of
  one. Native `MeshToWorld` multiplies actor scalar, actor axis and mesh axis,
  storing float32 between stages. The browser then swaps Y/Z consistently
  with the existing source coordinate conversion.

The executable source checks, addresses, hashes and limits are in
[native-actor-evidence.md](native-actor-evidence.md). The extractor is
`tools/dat/export_npc_visuals.py`; its private result is
`assets/gamedata/npcvisual.json`. Current coverage is 6,519 original NPC
records and 495 built mesh transforms, with no unresolved entries in that
bounded export. This does not mean all original meshes are built or that
all NPC appearance is correct.

Class-default extraction now rejects tags that are not declared properties
of the exact class or its ancestors. Where multiple terminal candidates
remain, it accepts only agreement on the visual fields across all maximal
validated candidates and retains their offsets/hashes. It does not claim a
complete native UClass serializer or use ambiguous nonvisual fields.

## Collision and remaining appearance work

`NpcInfo` and player packets carry collision radius and half-height. Those
fields describe the targeting cylinder; they are not a visual scaling rule.
The browser's source-backed selection work and remaining floor-location
limits are documented in [native-picking-evidence.md](native-picking-evidence.md).

Visual root recentering and placement still need the original mesh origin,
rotation and pawn floor-adjustment behavior. Per-NPC texture selection,
non-default animation arrays, effect-only NPCs, nameplate placement and
unbuilt meshes are separate fidelity gaps. See
[npc-animation-variants.md](npc-animation-variants.md) for the first bounded
class-specific animation correction. None of these should be repaired with
collision fitting, keyword animation guesses or invented scale constants.

## Reproduction

Run `python3 tools/dat/export_npc_visuals.py --check` against the private
original inputs to compare the generated metadata. Run
`python3 tools/ui/check_actor_native.py --check` to recheck the native
multiplication, ordinary render argument and serializer evidence. The
extractor and runtime have focused tests under `tools/dat/` and
`editor/world/test/npcvisual.test.mjs`.
