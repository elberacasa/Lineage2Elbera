# Original actor bounds and octree membership

The browser now has the original actor-box preparation, node geometry and
membership operations used by Interlude's collision octree. It preserves split
thresholds, child order, single/multi-node insertion, redistribution and removal
of repeated pointer entries. These are components with explicit source inputs;
they do **not** yet populate the live game world or replace walking collision.

Elbera Tools compares **5,946 geometry/bounds cases** and **2,239 ordered
membership snapshots across 60 sequences** with retained Engine/Core
instructions. The membership run executes 1,872,517 instructions and reaches
890 instruction addresses, including trees with up to 561 nodes. No native DLL
executes. Original inputs and raw local receipts remain private.

## Browser contracts

All geometry uses native axis order and units, dense finite Float32 values,
and the explicit profile `arithmeticProfile: "pc53-rne"`. This finite arithmetic
contract does not observe a running client's x87 control word.

`editor/world/js/actor-octree-geometry.js` exports:

| Function | Result and original distinction |
| --- | --- |
| `octreeChildVolume({arithmeticProfile, volume, child})` | Child center/half extent; child bits are X=4, Y=2, Z=1. Half extent is stored as Float32 before center arithmetic. |
| `octreeBoxContainsVolume({arithmeticProfile, volume, box})` | Whether the actor box contains the entire node volume, including equal faces. This is not ordinary overlap. |
| `octreeIntersectedChildren({arithmeticProfile, volume, box})` | Descending child indices, using strict comparisons against split planes. A zero-width plane box can select none. |
| `octreeSingleChild({arithmeticProfile, volume, box})` | Child index or −1 for the parent. The low side admits `max <= center`; the high side requires `min > center`. |
| `octreeSegmentIntersectsBox({arithmeticProfile, start, center, extent, direction, reciprocal})` | Preliminary segment/box test, including endpoint contact. Stored direction and reciprocal are explicit; zero-direction axes do not consume their reciprocal. |
| `prepareOctreeActorBounds({arithmeticProfile, primitiveBounds})` | Expanded `bounds`, cached `center`/`extent`, and `rootOverlap`. The primitive's current bounding-box response is supplied. |

A volume is `{center: [x,y,z], halfExtent}`; a box is
`{min: [x,y,z], max: [x,y,z]}`. Ready results are immutable and use
`{status: "ready", ...}`. Missing inputs, unsupported profiles or nonfinite
consumed arithmetic return `{status: "unsupported", reason}` and never mean
that a path is clear.

Box endpoints need not be ordered. An invalid auxiliary model box can replace
the mesh box while retaining reversed endpoints; the original octree compares
those stored values without sorting them. Cached extents may consequently be
negative. The component preserves those source comparisons and Float32 stores;
it does not repair the box. The 5,946-case geometry/bounds comparison includes
reversed intervals and negative broad-phase extents.

### Expanded actor bounds

Original AddActor consumes the stored Float32 value `Math.fround(4.2)`. It
subtracts that value from the primitive minimum and adds it to the maximum.
Core then stores each `max - min` subtraction as Float32, halves and stores it,
and computes the center from `min + storedExtent`. Averaging the endpoints
changes rounding and is not a substitute.

The root filter admits **inclusive overlap** with `[-360448, 360448]` on all
three axes. It does not require full containment. The root initializer's
qualified instructions write center `(0,0,0)` and half extent `360448`; this
source binding does not observe startup execution or the current live global.

FBox's validity byte is written by the original expansion method. Opaque padding
is outside the numerical comparison. Actor flags, removal of prior membership,
primitive virtual dispatch and level-mode selection are not part of this helper.

### Membership storage

`editor/world/js/actor-octree.js` owns an opaque tree:

```js
const created = createActorOctree({ arithmeticProfile: "pc53-rne", volume });
if (created.status !== "ready") return created;
const { tree } = created;
const inserted = insertActorOctree(tree, {
  identity: actorIdentity,
  cachedBounds: preparedBounds.bounds,
  singleNode: sourceSingleNodeBit,
});
const state = inspectActorOctree(tree);
removeActorOctree(tree, actorIdentity);
```

The volume is explicit: authored diagnostic volumes are supported without
claiming they describe a live level. `cachedBounds` must already be the current
expanded source box. `singleNode` is the boolean value of actor offset `+0x74`,
mask `0x100`; the component never infers it from an actor class or mesh name.
Identities are opaque nonnull values. Input arrays are copied, and diagnostic
snapshots are immutable. Diagnostic node paths identify this browser tree, not
original memory addresses.

A node splits when it already has at least three entries, has no children, and
its half extent multiplied by the double `0.5` is **strictly greater than 100**.
The comparison precedes a child-volume Float32 store. The original allocates
eight children, copies the old actor array, appends the incoming actor, empties
the parent, then redistributes that copied sequence in order. Each actor's
current mode chooses single or multi insertion.

Both membership append wrappers use ordinary `FArray.Add`. Repeated identities
remain repeated; they are not unique-entry operations. Redistribution removes
every old parent occurrence from each actor's membership array. Multi insertion
visits intersected children in descending order, unless the actor contains the
entire node cube. Single insertion leaves straddling boxes at their parent.

Normal removal visits the actor's membership array and removes every matching
actor entry from each node, preserving survivor order. It empties the actor's
membership array but **does not collapse child nodes**. Repeated removal of a
known actor is allowed.

The browser requires removal before changing an existing member's bounds or
mode. This admission guard prevents unsupported stale membership; it is not an
additional original game rule. The [ordinary AddActor wrapper](native-actor-admission-evidence.md)
now composes these operations with explicit actor, level and primitive-method
state, removing existing membership under its original gates.
Unknown identities and malformed input fail without changing membership.
Successful browser storage is assumed; native allocation failure and exception
behavior are outside scope.

## Source and reproducibility

The owned Interlude Engine/Core inputs and supplemental pair are pinned by
SHA-256:

| Input | SHA-256 |
| --- | --- |
| Owned Engine | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Owned Core | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| Comparison Engine | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |
| Comparison Core | `d83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639` |

Supplemental correspondence identifies erased imports and explicit relocated
operands in matched blocks; it neither authenticates the archive nor repairs
the owned image. See the [comparison policy](supplemental-engine-evidence.md).

The geometry qualifier matches five complete helpers and three dispatch slices.
The bounds qualifier adds AddActor slices, the named Core `FBox.ExpandBy` and
`GetCenterAndExtents` bodies, and the consumed constants. The membership
qualifier adds constructor/store/filter/removal bodies, array wrappers, seven
Core array methods, named thunks, the normal vector-construction loop and root
initializer. Each receipt records block hashes, normalized operands and limits.

The interpreter executes the retained arithmetic, branches, recursive calls,
array count/capacity changes and pointer stores. Successful allocation,
reallocation, freeing and overlap-safe DWORD copying are authored provider
responses. Uninitialized memory stays absent, and unexpected reads/calls fail.
The vector-construction loop and bounded RemoveActor body use explicit normal
frames. Supplemental body comparisons omit selected SEH setup prefixes; native
exception handling and unwinding are not certified.

From the repository root, with the matching local files and Capstone 5.0.7:

```sh
python3 tools/ui/check_actor_octree_native.py \
  --comparison-engine /local/comparison/engine.dll \
  --comparison-core /local/comparison/Core.dll --check

python3 tools/ui/check_actor_octree_membership_native.py \
  --comparison-engine /local/comparison/engine.dll \
  --comparison-core /local/comparison/Core.dll --check
```

Both commands also accept `--engine` and `--core` for owned input paths.
Without `--check`, they emit evidence receipts with coverage and current file
hashes. Each accepts `--runtime-module` to compare the actual alternate browser
module, including deliberate mutations. The membership module must be beside
its geometry dependency. Tools read no original files at import.

Portable tests require no game inputs:

```sh
node --test editor/world/test/actor-octree-geometry.test.mjs \
  editor/world/test/actor-octree.test.mjs
python3 -m unittest discover -s tools/ui -p 'test_actor_octree*py'
```

These add 15 browser cases and ten interpreter cases to CI. Local negative
checks reject wrong expansion, midpoint averaging, root containment, changed
child order/equality/contact/rounding, delayed or inclusive splitting, reversed
redistribution, ignored single-node mode, deduplicated append and retained
duplicate parent membership. Mutation copies and raw receipts remain private.

## Remaining integration

This closes bounded geometry and membership operations, not live spatial
discovery. The ordinary update component now joins admission, generic or supplied
primitive bounds and level-mode selection. Live input bindings, overridden
primitive bounds, zero-extent queries, live candidate filtering and concrete
primitive dispatch remain unfinished. The [nonzero query component](native-actor-query-evidence.md)
now traverses this membership with explicit method responses.
[Cached mesh collision](native-static-mesh-cache-evidence.md)
and [level sweeps](native-level-sweep-adapters-evidence.md) are adjacent components,
not evidence that those joins already work.

Actual world population, movement callbacks, floor/step/ledge response and
camera/walking integration remain unfinished. Very large authored overlapping
boxes can expand into many memberships; these bounded cases are not a game-world
performance benchmark. The full browser-client goal remains active. These
headless Elbera Tools are repository source and are not included in the existing
standalone archives; no new UI or screenshot is claimed.
