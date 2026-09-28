# Original level collision composition

The ordinary Interlude level collector now joins explicit BSP, terrain, region
and actor-provider results in original source order. It preserves the result
fields left behind by rejected queries, endpoint shortening between phases,
terrain region admission, the 64-result capacity and the original unstable
sort. This is a finite collector implementation, **not live world discovery,
a complete collision scene, walking response or gameplay adoption**.

The [earlier level operations](native-level-collision-evidence.md) supply the
source sort and shortening arithmetic. The distinct mouse-picking
`L2MultiLineCheck` is outside this ordinary `MultiLineCheck` path.

## Reproduce

Portable authored fixtures require Node and no original client files:

```sh
node --test editor/world/test/level-query.test.mjs
```

Elbera Tools compares the actual browser module against retained instructions
from the privately owned, pinned Engine/Core files:

```sh
python3 tools/ui/check_level_query_native.py --check
python3 tools/ui/check_level_query_native.py --check \
  --comparison-engine /private/comparison/engine.dll
```

Python, Capstone and Node are required for this original-input check. No DLL is
loaded for execution and no original bytes or generated assets are written.
The optional supplement qualifies selected erased imports and the seamless
global's name; it does not authenticate the distribution or restore imports.
Owned-only mode leaves those correspondences conditional.

| Input | SHA-256 |
| --- | --- |
| Owned Engine.dll | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Owned Core.dll | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| Optional supplemental Engine.dll | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |

## Explicit source contract

[`collectLevelHits`](../editor/world/js/level-query.js) accepts:

```js
collectLevelHits({
  start, end, extent, flags, sourceActor,
  level, callerLevel, attachedLevelsEnabled, attachedLevels,
  primitives: { bsp, terrain, region, actorHash },
});
```

Coordinates are original L2 XYZ, stored as Float32. `level` supplies the current
LevelInfo identity, Model, actor-provider identity and resolved zone slots.
`callerLevel` is null or the supplied LevelInfo identity and its own Model.
Those Models need not be the same. Attached levels preserve source order and
null entries. The live seamless gate is an explicit boolean input; a map name,
nearby render tile or successful export does not establish its value.

A zone has an explicit identity, raw `flags3d8` and an ordered `terrains` array.
The terrain phase needs all 64 **resolved** `GetZoneActor` slots. The original
helper uses the current LevelInfo when a slot's ZoneActor is null. Repeated
resolved zones and repeated terrain entries are queried repeatedly. Do not
replace this with a set of visible meshes or deduplicate the arrays.

The callback boundaries are deliberately narrow:

| Adapter | Required result and limits |
| --- | --- |
| `bsp` | Receives the Model participant, query, owner null, extra node flags zero and current scratch fields. Returns explicit `blocked` and exact result `writes`, including writes on a clear return. |
| `terrain` | Receives the terrain participant, query, visibility bypass false and scratch fields. Returns the same explicit write contract. |
| `region` | Receives the **current** Model, accepted terrain point and current LevelInfo as fallback. Returns the source region's zone identity, not a guessed zone from rendering. |
| `actorHash` | Receives the actual provider identity, query, source actor and extra argument zero. Returns records in the provider's original linked-list order. |

Every successful adapter response has `status: 'ready'`. Missing data or an
unsupported participant propagates as `status: 'unsupported'`; it cannot be
converted to a clear path because another participant returned a known hit.
The collector does not substitute an all-actor scan for a source spatial query.
`Level.Hash` is a virtual provider: both hash and octree implementations exist
in the original Engine. Their admission, order and result construction remain
separate contracts.

The public array represents returned linked-list order. Native heap addresses
and `Next` fields are excluded from adapter records. Other fields remain opaque
except the point and time used by source shortening. This API does not emulate
allocation failure, native pointer identities or the private provider list's
in-place time writes.

## Source phases and observable details

The collector's retained body is at Engine `0x105c5920`.

1. Flag `0x04` and a nonnull caller LevelInfo select its Model BSP. The seamless
   gate then admits attached BSP Models in source order, skipping explicit null
   levels and null Models. Accepted hits associate the relevant LevelInfo and
   shorten the later endpoint using the original BSP allowance.
2. With accepted results, `0x200` finishes **after the whole BSP phase**. It does
   not stop after the first BSP callback.
3. Flag `0x04` without `0x100` traverses zone slots `0..63`. Zone `+0x3d8` bit
   `0x04` admits its terrain list. A primitive hit is accepted only if the current
   Model's PointRegion zone equals that list's zone or the caller LevelInfo.
   Accepted terrain results associate the terrain actor and use the distinct
   terrain shortening allowance. Region-rejected writes still remain in the
   scratch slot for the next attempt.
4. With results, `0x200` can finish after the entire terrain phase. Otherwise
   mask `0x4009b` selects the current actor provider, then enabled attached
   providers. Their result times receive the current stored scale; their hit
   points are not recomputed.
5. Records use the retained Core `appQsort`, including its nonstable ties.

Actor copying stops at 64 records. Later eligible actor providers are still
called even when no more results can be copied. The world BSP/terrain phases
have no equivalent native capacity guard. The browser refuses a subsequent
world scratch-slot access instead of imitating an out-of-bounds native write
or silently discarding participants.

The comparison qualifies the global through two finite, otherwise exact blocks
at `0x105c5ff1..0x105c6016` and `0x105c6596..0x105c65ba`. Their supplemental IAT
operand names **Core.GIsL2Seamless**. This names the gate; it does not observe its
live value. The admitted collector uses one explicit gate snapshot for both
reads. Callback-driven mutation of the world, attached arrays or gate is outside
this snapshot contract.

### Result writes are not hit booleans

The original 64 scratch records initialize only `Material = null`. All other
fields are unknown until written; the module leaves them absent.

- With BSP nodes present, the no-owner extent wrapper initializes Time to 2.
  Hull adoption writes Time, Normal, Actor null and Item equal to the Model
  identity. The wrapper writes the backed-off point/time even when Time 1
  ultimately returns clear. Node index and material are not fabricated.
- An empty BSP returns RootOutside without writing a result. A solid empty
  model therefore does not provide a usable invented hit point.
- A terrain rejection before traversal writes nothing. Traversal clears Actor;
  an accepted ordinary terrain hit writes Point, Normal, Time, Material null
  and Actor. Item and node index remain unchanged.

These differences matter when a later call reuses a slot after a clear return
or rejected terrain region. Adapters must report actual writes; clearing a
record or supplying a universal zero normal changes source behavior.

## Verification and remaining work

The collector has 16 portable tests. The original-input differential compares
260 authored scenes, 743 collected hits and 941 primitive/region/provider
callback invocations, exercising 671 retained collector instruction addresses.
It also checks a guarded world-capacity overflow separately. Point, normal,
time, endpoint and scale comparisons retain Float32 bit patterns, including
signed zero. Adversarial scenes cover repeated zones, null caller identity,
stale result fields, phase exits and actor calls after the copy limit.

The differential runs original collector control/arithmetic plus the retained
Size/FMin helpers and Core sort. Primitive, region and provider outcomes are
explicit authored callback boundaries. It stops before final allocation and
native `Next` reconstruction; array order expresses that list contract. The
scratch constructor is checked separately, without claiming that the entire
compiler constructor loop or exception/profiling prefix was interpreted.

This does not establish full native arithmetic for every x87 rounding case,
loaded terrain membership, live actor state, static/transformed primitives,
provider population or movement's MoveActor/floor/step/ledge response. Those
joins must be recovered before the collector replaces gameplay collision. The
full browser-client goal remains active.
