# Explicit original level sweep participants

Elbera Tools now connects the existing BSP sweep, terrain sweep and PointRegion
components to the ordinary level collector. The adapter preserves result writes
on both hits and clear returns. It requires explicit current participant
identities and prepared geometry; it does not discover a live collision scene,
enable gameplay collision or replace the actor spatial provider.

The component contracts remain in [BSP collision](native-camera-evidence.md),
[terrain collision](native-terrain-collision-evidence.md),
[PointRegion](native-bsp-region-evidence.md) and
[level collection](native-level-query-evidence.md).

## API and identity

```js
const prepared = prepareLevelSweepAdapters({
  models: [{identity: modelIdentity, source: bspSource, numZones, zoneActors}],
  terrains: [{identity: terrainIdentity, source: terrainSource}],
  actorHash: query => actualProvider(query),
});
// Pass prepared.primitives to collectLevelHits only when status is 'ready'.
```

`source` is the existing primitive input, without another geometry decoder.
The same Model nodes and RootOutside feed both BSP collision and PointRegion.
`numZones` and `zoneActors` supply the actual region binding, including the
explicit slot-zero requirement when a nonempty tree has NumZones zero. A saved
model export by itself does not observe current zone actor pointers.

Identities are opaque values compared exactly. A model name, rendered mesh or
position does not substitute for that association. Arrays must be dense;
missing and duplicate identities within either registry are rejected. Numeric
geometry is copied by the existing immutable preparation functions. This is a
snapshot contract: later callback-driven changes to geometry, identities,
zone slots or world lists are outside its scope.

Every actual callback must find its participant. The caller must still provide
the current LevelInfo, attached-level state, all required resolved zone slots
and terrain list order to `collectLevelHits`. An absent or unsupported
participant rejects the query, even after another participant found a hit.

The actor provider receives the collector's exact query, including its current
shortened endpoint. It is required if that phase is reached, even after the
collector has copied 64 results. No all-actor list or empty response is invented
when the provider is missing. Its order, eligibility and live membership remain
the supplied provider's responsibility.

## Exact sparse result writes

The adapters return `{status: 'ready', blocked, writes}`. The collector applies
only those writes to its current scratch record. They do not initialize a new
complete record and do not clear fields merely because a primitive returned
clear.

| Primitive branch | Writes |
| --- | --- |
| Empty BSP with RootOutside 1 | None |
| Nonempty BSP without adopted hull result | Time = 2 |
| BSP adopted result, including clamped Time 1 with clear return | Actor = null; Item = supplied Model identity; Point, Normal, Time |
| Terrain rejected before traversal | None |
| Terrain entered traversal without accepted quad | Actor = null |
| Terrain accepted quad | Actor = supplied terrain identity; Point, Normal, Time; Material = null |

The BSP adapter retains the primitive's explicit unsupported result for an
empty solid Model: RootOutside zero does not provide a usable hit point/time.
It does not fabricate a clear return or a complete hit record.

BSP does not write node index or Material in this admitted path. Terrain does
not write Item or node index. Consequently, an earlier BSP Item can survive
into a later terrain record, and region-rejected terrain writes remain in the
scratch slot for the next primitive. Portable fixtures exercise these joins
using actual component implementations.

No-owner BSP with ExtraNodeFlags zero is required explicitly. For terrain,
visibility bypass must be explicitly false. Each component retains its own
finite-input, extent, flag and owner restrictions; unsupported becomes neither
a hit nor a miss.

## TraceFlags in the admitted BSP branch

The wrapper's extent test is at Engine `0x10749248..0x10749271`. Its nonzero
branch at `0x1074926b` reaches `0x107496b0`. The complete nonzero suffix through
`0x107498c0` has 164 instructions, and the empty-model suffix through
`0x107498df` has eight; neither reads nor passes the address of input TraceFlags
at frame `+0x74`. The constructor receives ExtraNodeFlags at `+0x70` instead.

The TraceFlags `0x1000` test at `0x1074949b` belongs to the excluded zero-extent
branch. The adapter therefore validates the supplied uint32 flags but does not
invent a material behavior for the ordinary nonzero BSP sweep. Terrain still
checks its own flags and rejects its unported alternate/material paths.

The optional pinned supplemental Engine comparison qualifies the erased
extent equality call as Core `FVector::operator==` in the otherwise matching
41-byte block. Owned-only mode keeps that import identity conditional. This
comparison neither authenticates the supplemental distribution nor restores
the owned executable's erased imports.

## Reproduce

Portable authored fixtures require Node and no game files:

```sh
node --test editor/world/test/level-sweep-adapters.test.mjs
```

The original-input check requires Python, Capstone, Node and the privately
owned pinned Engine/Core files:

```sh
python3 tools/ui/check_level_sweep_adapters_native.py --check
python3 tools/ui/check_level_sweep_adapters_native.py --check \
  --comparison-engine /private/comparison/engine.dll
```

| Input | SHA-256 |
| --- | --- |
| Owned Engine.dll | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Owned Core.dll | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| Optional supplemental Engine.dll | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |

The current portable suite has 13 cases. The original-input differential joins
48 authored queries, 48 resulting hits and 124 actual collector callbacks.
Every callback query frame and final point/normal/time/end/scale is compared
with exact stored Float32 bits. The joined evaluator uses the existing
retained-instruction collector, BSP, terrain and region evaluators; it does not
execute a DLL or introduce a second collector interpreter. The existing
collector's 260-case default-provider regression also passes after adding the
optional evaluator hooks.

The BSP provider reuses the independently checked adoption/write association.
The terrain provider forwards the actual interpreted result-write events.
Actor-provider responses are explicit authored fixtures, not an interpreted
native actor-hash traversal. Shared fixture geometry is prepared once per
binding table; each query retains its own provider responses and call log.

### Original-map composition

The optional original-map check reads fresh map and heightmap packages through
the existing BSP/terrain exporters and the [terrain-zone source tool](native-terrain-zone-inputs.md).
It verifies normal construction, the saved Model binding, terrain-zone list
reconstruction and retained PointRegion results. Both supplemental inputs are
required to qualify this path's erased calls:

```sh
python3 tools/ui/check_level_sweep_adapters_native.py --check \
  --comparison-engine /private/comparison/engine.dll \
  --comparison-core /private/comparison/core.dll \
  --map 17_25 --map 22_22
```

This adds 58 probes per map: 116 queries, 94 results and 281 actual primitive/
region calls. Including the authored cases, 164 queries, 142 results and 405
calls match exact stored values and shortened call frames. The map probes use
original collision geometry; their offsets and extents are authored diagnostic
inputs, not player dimensions, timings or other invented game values.

Source object references receive distinct synthetic identity tokens. The check
projects only the consumed terrain-zone flag bit, preserving all 64 resolved
slots and their repeated fallback identities. It explicitly selects world flag4,
disables attached levels, and supplies diagnostic terrain owner/deletion/map
state. Actor collision is outside this query; the interpreter's unused hash
field is null. Conditional normal-build lists are checked against saved tags.
These conditions and source hashes appear in the JSON report when `--check`
is omitted. They do not establish live actor state or a gameplay route.

The source tool records the exact supplemental Core fingerprint and remaining
constructor, loading and callback limitations. An unchanged terrain position in
these two saved inputs does not establish every PostLoad branch.

Existing component evidence still governs arithmetic, named helper
correspondence and admitted source inputs. Binary64 approximates x87
intermediates with explicit original Float32 stores; this is bounded finite
comparison, not universal floating-point equivalence. The checker does not
independently re-prove every component import in each joined run.

Live level loading, actor/provider membership, dynamic mutation, ownership,
deletion, terrain enablement and arbitrary alternate primitive branches remain
separate. These adapters do not establish a full walking, camera or MoveActor
implementation.
