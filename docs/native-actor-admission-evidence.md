# Original octree actor admission and updates

The browser now joins ordinary `FCollisionOctree.AddActor` admission, current
primitive bounds, cached-box preparation, level-mode selection and membership.
Skipped updates preserve existing membership. Out-of-root updates remove old
membership and write the new cached box, but retain mode and stored location.

Elbera Tools compares **935 operations across 43 sequences** with retained
Interlude Engine/Core instructions: 558 insertions, 255 skipped updates,
118 root rejections and four explicit removals. The run executes 626,446
instructions at 1,300 addresses. It checks ordered membership, cached fields,
sparse writes and membership at the primitive-method boundary. This is an
ordinary-path component, not a live world-population or walking claim.

## Update contract

`editor/world/js/actor-octree.js` adds `updateActorOctree(tree, input)` to the
[existing geometry and membership API](native-actor-octree-evidence.md).
The tree must use the qualified original root volume: center `(0,0,0)`, half
extent `360448`, and `arithmeticProfile: "pc53-rne"` at creation. Executing the
original initializer in the verifier establishes those stores under the supplied
state; it does not observe a live client's startup or current globals.

```js
const result = updateActorOctree(tree, {
  identity: actorIdentity,
  flags2f8, flags64, flags2e4, flags74,
  location, storedLocation,
  level: currentLevel === null ? null : { infoFlags554 },
  getPrimitive,
  getPrimitiveBounds,
});
```

Flags are explicit unsigned DWORDs or partial `{mask, value}` words identified
by original offsets. A partial value may contain only bits established by its
mask. The shared loading helpers read only the consumed masks: actor `+0x2f8`
bit `1`, `+0x64` bit `0x80`, `+0x2e4` bit `0x4000`, and LevelInfo `+0x554` bit
`2`. Actor `+0x74` is only written here, so an empty known mask is valid. The
write establishes bit `0x100` and retains every other known bit; unknown padding
remains unknown. Complete numeric inputs retain their numeric output contract.
No value is inferred from rendered objects or emulator defaults.

`level: null` means the actor's Level reference is null. Otherwise `infoFlags554`
is the current LevelInfo word; a missing LevelInfo is not a null Level. Current/stored locations are dense finite Float32 triples in native axes
and units. The arithmetic profile remains finite PC53/RNE, without a claim
about a running native thread's control word.

The virtual responses are synchronous and explicit:

| Method | Required response |
| --- | --- |
| `getPrimitive(actorIdentity)` | `{status: "ready", primitiveIdentity}` with a nonnull current identity |
| `getPrimitiveBounds(primitiveIdentity, actorIdentity)` | `{status: "ready", bounds: {min, max}}` with current finite Float32 bounds |

Unknown responses and null primitives return unsupported. They do not select a
generic fallback or establish a clear route. Inputs must remain stable during
the call. Nested mutations of the same tree are rejected as an admission guard;
native reentrancy and exception behavior remain outside this component.

### Source order and writes

1. Actor `+0x2f8` mask `1` is an assertion precondition. The browser requires it;
   it is not treated as an ordinary skip branch.
2. Actor `+0x64` mask `0x80`, then `+0x2e4` mask `0x4000`, skip before removal,
   primitive calls or cached-field writes. Later unused inputs are not required.
3. Existing membership is removed before primitive selection. The full original
   RemoveActor wrapper consumes current/stored locations. Under finite vectors
   and the explicitly admitted **null GLog** condition, its comparisons add no
   membership gate; its normal removal body is the previously verified one.
4. The current primitive supplies its box. Original `ExpandBy` and cached
   center/extent arithmetic run, including the distinct Float32 4.2 expansion.
5. A box outside the inclusive root-overlap filter leaves membership empty and
   keeps the previous mode and stored location. New cached bounds remain written.
6. An accepted box uses single-node insertion when Level is null or LevelInfo
   `+0x554` mask `2` is set. Otherwise it uses multi-node insertion. Only actor
   `+0x74` mask `0x100` changes; unrelated bits survive.
7. Insertion completes before current location is copied to stored `+0x33c`.
   The original self-equality assertion is admitted only for finite locations.

Ready results include `disposition: "skipped" | "outside-root" | "inserted"`
and immutable sparse `writes`. Possible write keys are `cachedBounds`,
`cachedCenter`, `cachedExtent`, `flags74` and `storedLocation`. These describe
source field updates; the caller applies them to its current actor state.

Unsupported results after a known stage retain its completed writes and tree
changes. For example, an unknown level mode after bounds preparation returns the
new numeric cache writes and leaves the old membership removed. This preserves
known source ordering, not native failure/exception parity. Callers must consume
the unsupported result and cannot treat the incomplete actor set as a clear
collision route. `inspectActorOctree` remains a diagnostic membership snapshot.

## Ordinary primitive helpers

`editor/world/js/actor-primitive-bounds.js` provides the ordinary source methods
for use inside those callbacks:

- `selectActorPrimitive(input)` reproduces ordinary `AActor.GetPrimitive`.
  It consumes `primitive104`, then `primitive38`, then `primitive2b8`, returning
  the first nonnull identity. Each consumed reference must be explicit; undefined
  remains unknown. If all three are null, a nonnull `levelIdentity` is required.
  A null `engineIdentity` yields a null primitive. Otherwise it returns the
  explicit `enginePrimitive50`. Field names preserve source offsets, without
  asserting meanings that have not been bound to class metadata.
- `prepareGenericPrimitiveBounds({arithmeticProfile, location,
  collisionRadius, collisionHeight})` reproduces the generic `UPrimitive`
  method for a nonnull actor and finite nonnegative radius/height. Radius plus
  one and height plus one are stored as Float32 **before** location arithmetic.
  It returns `{status: "ready", bounds}`. That padding belongs to the primitive;
  the octree's later 4.2 expansion is a separate stage.

The verifier executes the ordinary selector and generic box method themselves.
Other primitive bounding boxes remain authored virtual responses in that
checker. The separate [static-mesh bounds component](native-static-actor-bounds-evidence.md)
now executes transformed boxes and collision-model unions, including 288
joined updates through this admission path. Current transform and auxiliary
model method replies remain explicit. Overridden actor selectors and the
generic method's null-owner branch remain outside these helpers.

## Reproduce the evidence

The same four pinned Engine/Core inputs and comparison policy as the
[octree membership guide](native-actor-octree-evidence.md#source-and-reproducibility)
apply. No original bytes or generated game assets are included in this tool.

```sh
python3 tools/ui/check_actor_octree_admission_native.py \
  --comparison-engine /local/comparison/engine.dll \
  --comparison-core /local/comparison/Core.dll --check
```

Owned files default to `assets/interlude/system/engine.dll` and `Core.dll`;
`--engine` and `--core` override them. Without `--check`, the tool returns source
bindings, coverage and current file hashes. `--runtime-module` compares an
alternate `actor-octree.js` beside its geometry, actor-loading, primitive-helper and
cylinder-collision dependencies.
Original files are read only when verification runs. Capstone 5.0.7 is required.

New qualification includes normal AddActor/RemoveActor, `ULevel.GetLevelInfo`,
ordinary `AActor.GetPrimitive`, the nonnull-owner generic box path, Core vector
equality/inequality, and the Core box constructor. Named vtables bind provider
removal, the ordinary actor selector and generic primitive box slots. Exact
supplemental blocks bind erased imports and relocated global/root operands.
Selected SEH setup prefixes, allocation providers and compiler-frame boundaries
retain the prior verifier's explicit limits. Diagnostic GLog is supplied as
null and GIsEditor as false; logging/assertion handlers and native exceptions
are not executed.

Opaque FBox padding is kept as partially known words when only its validity
byte is written. It is not filled with fabricated numeric defaults or included
in the numeric comparison. The checker rejects reads of unknown padding bytes.

Portable checks need no original files:

```sh
node --test editor/world/test/actor-octree*.test.mjs
python3 -m unittest discover -s tools/ui -p 'test_actor_octree*py'
```

The related suites contain 23 browser and 13 interpreter cases, including eight
new browser and three new interpreter tests. The earlier 2,239 membership
snapshots also pass with the updated module. Nine local deliberate mutations
are rejected: early removal on a skipped update, wrong skip/mode bits, clearing
unrelated mode flags, writing location on root rejection, missing primitive
padding or its Float32 store, reversed selector priority, and late removal.

## Remaining work

Current fields, LevelInfo state, primitive methods and lifecycle calls still
need to come from the live browser world. The separate
[nonzero actor-query component](native-actor-query-evidence.md) now traverses this
membership. Live filtering and concrete primitive dispatch must connect it to
[cached mesh collision](native-static-mesh-cache-evidence.md), cylinders and
[level sweeps](native-level-sweep-adapters-evidence.md). Saved render placements
alone do not establish those current values.

Camera/walking queries, movement callbacks, floor/step/ledge response and the
other full-client systems remain unfinished. These headless Elbera Tools are
repository source, outside the existing standalone archives. No new UI or
screenshot is claimed, and this milestone does not complete the browser port.
