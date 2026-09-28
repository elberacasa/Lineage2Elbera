# Original nonzero actor queries

The browser's actor tree now supports the ordinary nonzero-extent
`FCollisionOctree.ActorLineCheck` traversal. It joins query preparation, ordered
node visits, actor tags, ownership filtering, supplied virtual methods, hit
collection and minimum-time selection. It uses the actual membership component,
not a second reconstructed tree.

Elbera Tools compares **600 queries across 100 sequences**, following **1,144
original actor admissions**, against retained Interlude Engine/Core instructions.
The run checks 3,302 candidate-tag writes, 283 returned hit records, callback
arguments/order, scratch initialization and final tag state. It executes
4,104,967 instructions at 1,890 addresses, including 360 explicitly admitted
masked zero divisions. These are authored component cases, not live world or
walking evidence.

## Browser contract

`queryActorOctree(tree, input)` is exported by `editor/world/js/actor-octree.js`.
The tree must use the [original initialized root](native-actor-octree-evidence.md)
and its `pc53-rne` creation profile. All vectors below are dense finite Float32
triples in native axes and units.

```js
const result = queryActorOctree(tree, {
  start, end, extent, flags, extra, sourceActor, currentTag,
  maskedZeroDivision,
  readActor, isOwnedBy, shouldTrace, getPrimitive, lineCheck,
});
```

`extent` must be nonnegative with at least one nonzero component. The separate
zero-extent query is not implemented. `flags`, `extra` and `currentTag` are
explicit unsigned DWORDs; `sourceActor` is an identity or explicit null. The
current provider tag increments with DWORD wrap. Initial actor tags must come
from current state, not an assumed zero.

| Synchronous provider | Ready response |
| --- | --- |
| `readActor(identity)` | `{status: "ready", actor: {tag1b0, flags2f8, cachedCenter, cachedExtent}}` |
| `isOwnedBy(sourceActor, candidate)` | `{status: "ready", value}` with an unsigned DWORD predicate |
| `shouldTrace(candidate, sourceActor, flags)` | `{status: "ready", value}` with an unsigned DWORD predicate |
| `getPrimitive(candidate)` | `{status: "ready", primitiveIdentity}` with a nonnull identity |
| `lineCheck(primitiveIdentity, request)` | `{status: "ready", hit, writes}` with explicit boolean hit and source result-field writes |

The line request carries `actor`, `start`, `end`, `extent`, `flags`, `extra` and
`initialResult`. The scratch record is the original constructor with Time zero,
Next/Actor/Material null, zero Point/Normal/Item and NodeIndex −1. An explicit
primitive miss never adopts its scratch writes. An accepted hit merges exact
writes into that initialized record; unknown fields or nonfinite numeric
results are unsupported. No actor, material or normal is inferred from the
rendered object. Static-mesh Item can be an opaque mesh identity.

The ready result contains `hits` in original linked-list order, excluding native
allocation addresses and Next pointers, plus `writes.currentTag` and ordered
`writes.actorTags` entries `{identity, tag1b0}`. Apply those writes before a
subsequent query, including writes returned with an unsupported result. Tags are
kept locally during traversal so an actor in several nodes is tested once.

Unknown later methods preserve completed tag writes and partial hits with
`status: "unsupported"`. Those partial results cannot establish a clear route.
Preflight domain checks are browser admission guards, not extra original game
rules. Source state must remain stable during the synchronous call. Same-tree
mutations and nested queries are rejected. Native reentrancy, exceptions and
callbacks that observe externally applied tag writes mid-call remain unported.

## Preserved source behavior

1. Store Float32 `End − Start` and each reciprocal. Under explicitly supplied
   `maskedZeroDivision: true`, an exactly zero direction produces signed
   infinity; the broad-phase helper does not consume that reciprocal component.
   Nonzero-direction reciprocal overflow remains unsupported. This condition
   does not establish a live native thread's FPU control word.
2. Build the query box by adding Start, then End to a newly invalid FBox, then
   expand by the query extent with original Float32 stores. Equal endpoint
   components retain the first stored value, including signed zero.
3. Visit each node's actor array in ascending order before its children. The
   root is called directly on this branch, without an added root-overlap gate.
4. Skip a matching actor tag. Otherwise write the new tag **before** checking
   actor `+0x2f8` mask `0x40`, self identity, ownership and virtual ShouldTrace.
   Rejected actors keep that tag too.
5. Add the query extent to cached actor extent with Float32 stores, then use
   the original segment/box helper before selecting and calling the primitive.
6. Copy accepted scratch hits and prepend them. The browser collects forward
   and reverses once to preserve this order without repeated array shifting.
   Flag `0x200` returns after the first adopted hit in traversal order.
7. Select intersected children in the original descending order, test the
   expanded child volume, then recurse. Repeated actor entries share their tag.
8. Flag `0x400` selects the strictly smallest Time in the collected list,
   starting from the original maximum finite Float32 constant. Equal times keep
   the first linked record. A hit equal to that initial maximum is not selected.

`isActorOwnedBy` in `actor-blocking.js` provides the ordinary Owner-chain method.
It includes the receiver and follows Owner `+0x3c` until null. It is distinct
from Base traversal. Missing or cyclic consumed links are unsupported. The
verifier executes the actual original method; ShouldTrace and primitive
LineCheck remain supplied virtual responses in this comparison.

## Evidence and reproduction

The four pinned Engine/Core images and exact supplemental correspondence policy
are recorded in the [membership source guide](native-actor-octree-evidence.md#source-and-reproducibility).
Original inputs remain private and are not loaded at tool import.

```sh
python3 tools/ui/check_actor_octree_query_native.py \
  --comparison-engine /local/comparison/engine.dll \
  --comparison-core /local/comparison/Core.dll --check
```

Owned files default to `assets/interlude/system/engine.dll` and `Core.dll`;
`--engine`/`--core` override them. Without `--check`, the verifier reports source
bindings, instruction coverage and file hashes. `--runtime-module` selects the
actual alternate `actor-octree.js` beside its geometry, actor-blocking and
cylinder-collision dependencies. Capstone 5.0.7 and Node are required.

Qualification binds the common query preparation, nonzero branch, full normal
node traversal, owner-chain predicate, scratch constructor, allocation wrapper
and minimum-hit reduction. Core IsZero, FBox construction and vector addition
match complete bodies. Named vtables identify ordinary ShouldTrace and generic
and static-mesh LineCheck slots; that qualification alone does not execute those
virtual methods. Selected normal SEH prefixes retain the prior source limits.
Successful memory-stack allocation is an explicit provider response. Opaque
padding stays unknown unless previously written; byte writes to reused Float32
stack cells now preserve their original bits.

Portable checks require no private client files:

```sh
node --test editor/world/test/actor-octree*.test.mjs \
  editor/world/test/actor-blocking.test.mjs
python3 -m unittest discover -s tools/ui -p 'test_actor_octree*py'
```

There are nine new browser and four new interpreter cases. Eight deliberate
local mutations are rejected: ignored tags, reversed parent/child order, wrong
candidate flags, encounter-order output, changed equal-time adoption, ignored
first-hit mode and omitted broad-phase extent. Raw receipts and mutation copies
remain private. Existing ordinary admission comparisons are retained separately.

## Remaining integration

Live actor fields, provider/tag history, subclass ShouldTrace dispatch, primitive
selection, current bounding boxes and lifecycle updates still need bindings to
the browser world. This query exposes the method boundary for existing cylinder
and cached-mesh collision components; the 600 cases supply those responses and
do not prove the concrete primitive join. Zero-extent queries are separate work.

The ordinary level collector can consume this linked-list order once its actual
provider is connected. Camera and walking, movement callbacks, floor/step/ledge
response and other full-client systems remain unfinished. This milestone does
not complete the browser port. These headless Elbera Tools remain repository
source, outside the existing standalone archives; no new UI or screenshot is
claimed.
