# Original terrain-zone source inputs

Elbera Tools now reads the source identities used to join the saved BSP model,
zone actors and terrain actors. This is saved-source evidence and an optional
conditional reconstruction. It does not admit a live level or populate an actor
collision hash.

The first supported sources are the pinned original Interlude maps `17_25` and
`22_22`. Other maps, class variants and source fingerprints fail closed. The
exporter reuses the [serialized Level.Model binding](native-bsp-region-evidence.md),
the original package reader, and the [terrain source prefix reader](native-terrain-collision-inputs.md).
It does not consult a rendered scene, copied UnrealScript, browser height sampler
or generated map catalog.

## Commands and dependencies

Run from the repository checkout. Saved-data export and the synthetic tests use
Python's standard library plus repository modules. Export also checks the pinned
owned Engine/Core DLL hashes for the constructor/default interpretation and reads
Engine.u/Core.u. The native check/reconstruction additionally needs Capstone.

```sh
python3 -S tools/world/test_export_terrain_zones.py
python3 tools/world/export_terrain_zones.py --tile 17_25 22_22
python3 tools/world/export_terrain_zones.py --tile 17_25 22_22 \
  --output-dir /your/private/new-output --write
python3 tools/world/export_terrain_zones.py --tile 17_25 22_22 \
  --output-dir /your/private/new-output --check
python3 tools/ui/check_terrain_zones_native.py --check
```

Read-only is the default. Writing requires an explicit directory and refuses an
existing file unless `--overwrite` is also supplied. `--check` compares freshly
reconstructed bytes. Outputs contain original data and remain private; no DLL is
executed or emitted. This tool is not included in an existing standalone kit.

Named erased calls and the optional normal-build reconstruction require both
explicit supplemental inputs:

```sh
python3 tools/ui/check_terrain_zones_native.py --check \
  --comparison-engine /your/private/comparison/Engine.dll \
  --comparison-core /your/private/comparison/Core.dll --tile 17_25 22_22
python3 tools/world/export_terrain_zones.py --tile 17_25 22_22 \
  --reconstruct-normal-build \
  --comparison-engine /your/private/comparison/Engine.dll \
  --comparison-core /your/private/comparison/Core.dll \
  --output-dir /your/private/new-reconstruction --write
```

The comparison files are the exact pinned supplemental archive copies described
in the existing [Engine recovery evidence](native-engine-recovery-evidence.md).
Their distribution is not authenticated as an untouched vendor release. Finite
byte correspondence qualifies particular imported calls; it does not restore
imports in the owned file or prove arbitrary build interchangeability.

## Output contract

`elbera-original-terrain-zones-v1` retains qualified identities and original
package/export hashes. Its important fields are:

- `numZones` and `serializedZoneActorRefs`: exactly the stored zone records.
- `zoneActorRefs`: 64 slots, preserving repeated references and nulls. The tail
  beyond NumZones is null only under the checked normal default-constructor and
  saved-serializer path; this condition appears in `scope.fixedSlotTail`.
- `resolvedZoneActorRefs`: the same 64 slots after the checked GetZoneActor null
  fallback. Repeated slots remain repeated, including repeated LevelInfo fallback.
- `defaultZoneActor`: qualified current `Level.actorArray(+0x38)[0]`, required to
  be LevelInfo. The separately serialized array at `+0x48` is not substituted.
- `zoneActors`: resolved source `bTerrainZone`, source/default provenance, and
  `savedTerrains`. An absent Terrains tag is `null` with an explicit absence label;
  it is not silently converted into an empty saved list.
- `terrains`: source Location, Region, qualified TerrainMap, source-prefix hashes
  and saved deletion value. The deletion value is a class-default/tag projection,
  not a claim about the live actor.

Only the named `bTerrainZone` Boolean is projected (`Zone+0x3d8`, mask `0x04`).
No full native zone flags, Owner, live deletion state, hash state or seamless
readiness is fabricated.

With `--reconstruct-normal-build`, `normalBuildReconstruction` additionally
contains retained-instruction PointRegion results and source-order `zoneTerrains`
lists, plus the conditions under which they apply. It verifies every explicitly
saved Terrains list it reconstructs. This optional state does not replace the
saved fields and has `liveAdmission:false`.

## Native population rule

Named `ULevel::BuildRenderData` calls `UpdateTerrainArrays` at `105cf3e8`.
The checked UpdateTerrainArrays normal path first visits all 64 fixed Model zone
slots and empties each nonnull Zone.Terrains array (`+0x3dc`). It then walks the
current Level actor array in order, skips null/deleted/non-TerrainInfo actors,
calls virtual SetZone with `(1,0)`, and AddUnique-appends the terrain pointer to
its resulting Region.Zone. Pointer equality determines uniqueness. Neither
sorting nor tile overlap determines membership.

The source method does not set `bTerrainZone`. A populated terrain array and the
zone's terrain flag are independent. The editor-only tail clears LevelInfo's
terrain array; arbitrary editor/later mutations are outside the reconstruction.

The AActor and TerrainInfo virtual slots bind SetZone to the same named method.
SetZone uses Actor.Location and the actor's LevelInfo default in Model.PointRegion.
Argument1 suppresses its zone and volume script callbacks; it still calls
GetPhysicsVolume and stores that result. No transitive side-effect-free claim is
made.

The normal Model default constructor calls EmptyModel(1,0). Its explicit 64-entry
loop zeros each zone actor pointer at `Model+0x138+24*i`. The later saved serializer
writes only NumZones entries. Other bytes in a ZoneProperty record are not assumed
zero. Copied/reused/custom models remain outside this constructor proof.
GetZoneActor returns the first current Level actor when the selected slot is null.

Fresh declared-field linkage, retained Core Boolean mask doubling, the native
ZoneInfo copy constructor and the collision consumer bind `bTerrainZone` to mask 4.
The qualified class-default reader rejects ambiguous nonvisual default streams.
Terrains' own constructor is FArray(ENoInit); that constructor alone does not prove
its contents empty. The separately bound Empty/Add/Realloc operations preserve
the stated list behavior on normal return.

## Actual source checks and precision

| Source map | Terrain | Saved/recomputed zone | Leaf |
| --- | --- | --- | --- |
| 17_25 | `17_25.TerrainInfo0` | `17_25.ZoneInfo1`, zone1 | 145 |
| 22_22 | `22_22.TerrainInfo0` | `22_22.ZoneInfo3`, zone1 | 49 |

Each inspected map has one TerrainInfo in the current actor array and one zone
with source `bTerrainZone=true`. That zone's saved Terrains list contains the
terrain. Both LevelInfo fallback actors have the source terrain flag false.

TerrainInfo.PostLoad can adjust Location, so a saved-position query alone is
insufficient. Exact correspondence binds its vector call to **SizeSquared**, not
Size. The helper stores its squared displacement as Float32 and compares it with 5.
The two retained arithmetic checks produce approximately `2.33e-8` and `1.89e-8`,
respectively, and skip the Location assignment. The integer half-dimensions are
exactly 128 for these positive 256 inputs. Existing finite interpreters preserve
Float32 stores and approximate x87 intermediates with binary64; this is not a
universal precision/FPU proof.

The native check reports 68 local Engine anchors, 7 Core array anchors, six finite
Engine comparison ranges and seven retained Core ranges. It also composes the
existing serialized-region and CDO/Boolean proofs, whose counts remain separate.
Owned-only mode explicitly leaves missing call identities unresolved. No
PostLoad math is admitted from ABI resemblance alone.

The remaining composition boundary is live state: normal helper returns,
unchanged source actors, actual loading order, later zone edits and resource
readiness must be independently supplied or stated as diagnostic assumptions.
These records alone cannot enable automatic collision or gameplay.
