# Original static-mesh actor bounds

The browser now reproduces the original nonnull-owner
`UStaticMesh.GetCollisionBoundingBox` method, including its cylinder branch,
transformed local box and conditional auxiliary collision-model union.
`static-sweep.js` reuses the same original eight-corner box transform.

Elbera Tools compares **600 bounding-box cases** and **288 actor updates across
8 sequences** with retained Interlude instructions. The joined comparison
executes the original primitive selector, static bounds, cached-box preparation,
level-mode selection, insertion and removal. It checks ordered membership,
method calls, sparse writes and bitwise Float32 cache values. Results include
200 insertions, 24 root rejections, 40 skipped updates and 24 removals:
2,314,902 instructions at 1,725 addresses in total.

These are authored finite component cases. Current live actor fields, resource
state and transforms remain required before this becomes world collision.
The work does not establish corrected NPC placement or playable maps.

## Runtime contract

The existing `editor/world/js/actor-primitive-bounds.js` exports:

```js
const result = prepareStaticMeshBounds({
  arithmeticProfile: "pc53-rne",
  ownerFlags2f8,
  ownerIdentity,
  localBounds: { min, max },
  collisionModel,
  readLocalToWorld,
  getCollisionModelBounds,
  // Consumed by the cylinder branch only:
  location, collisionRadius, collisionHeight,
});
```

All consumed vectors/matrices contain dense, finite Float32 values in original
axes and units. Flags are unsigned DWORDs; references are explicit identities
or null. Undefined means unresolved. Helper replies are synchronous:

| Helper | Response |
| --- | --- |
| `readLocalToWorld(ownerIdentity)` | `{status: "ready", matrix}` with the current 16-component row matrix |
| `getCollisionModelBounds(modelIdentity, ownerIdentity)` | `{status: "ready", bounds: {min, max, valid}}`; `valid` is the source byte |

Owner flag `+0x2f8 & 0x100` selects the existing generic cylinder box, including
its separately rounded radius/height plus one. That branch consumes no mesh
box, transform or auxiliary model. Its nonnull-owner dimensions remain limited
to finite nonnegative inputs.

Otherwise, LocalToWorld runs before reading the current mesh box. The original
Core transform visits all eight corners and stores each transformed component
as Float32 after the ordered Y, X, Z and translation terms. Source-box validity
is not consumed. The result is rebuilt from the corners with validity one;
strict comparisons retain earlier values on ties, including signed zero.
Singular matrices do not require an invented inverse.

After transformation, an explicit null collision model returns that result.
A nonnull model invokes its current bounding-box method. The original
`FBox += FBox` has an unusual rule: **an invalid right-hand box replaces the
whole result**, including its validity byte. A valid auxiliary box contributes
strict min/max comparisons. There is no additional final padding in this method;
[octree expansion](native-actor-admission-evidence.md) is a later operation.

The helper returns an immutable `{status: "ready", bounds: {min, max, valid}}`
or an explicit unsupported result. It preserves finite inverted auxiliary
bounds when the native copy branch returns them. The existing actor-admission
API accepts only ordered bounds, so joined comparisons supply ordered boxes;
this does not claim admission parity for malformed or inverted boxes.

`transformOriginalBox({arithmeticProfile, bounds, matrix})` exposes the shared
Core calculation. Mesh sweep preparation continues to compute its extent from
the transformed box using the original subsequent Float32 stores. All 800
existing source sweep comparisons pass after replacing the duplicate loop.

## Sources and reproducibility

The checker requires the same privately held Interlude Engine/Core edition as
the other collision tools. All four files are pinned:

| Input | SHA-256 |
| --- | --- |
| Owned Engine.dll | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Owned Core.dll | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| Supplemental Engine.dll | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |
| Supplemental Core.dll | `d83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639` |

```sh
python3 tools/ui/check_static_actor_bounds_native.py \
  --comparison-engine /local/comparison/engine.dll \
  --comparison-core /local/comparison/Core.dll --check
```

Owned inputs default to `assets/interlude/system/engine.dll` and `Core.dll`;
`--engine` and `--core` override them. Capstone 5.0.7 and Node.js are required.
Without `--check`, stdout includes source qualification and current verifier,
runtime and dependency hashes. `--runtime-module` selects an alternate
`actor-primitive-bounds.js` beside its actor-octree dependencies. The checker
interprets qualified instructions; it never loads or executes the DLLs natively.

Qualification binds the complete normal static-box path
`106fe719..106fe7dd` to the supplemental body shifted by -64, including the
named erased Core calls and direct generic-box call. The retained SEH prefix
supplies ordinary frame effects; handler execution/unwinding is excluded.
Named UStaticMesh, AActor and AStaticMeshActor vtable slots bind the box and
LocalToWorld methods. Supplemental correspondence does not authenticate the
archive's origin or establish the protected client's runtime restoration.

The following Core bodies are compared byte for byte and interpreted:

| Method | Body, exclusive end |
| --- | --- |
| Default FBox constructor | `1010ef70..1010ef73` |
| FBox.TransformBy(FMatrix) | `10117dd0..10117f26` |
| FMatrix destructor | `101111e0..101111e1` |
| FBox += FBox | `10117a00..10117b62` |
| FBox += FVector | `101177f0..10117954` |

The default box constructor does not initialize the box. The interpreter keeps
unwritten padding partially unknown instead of zero-filling it. Comparisons
cover the six coordinates and validity byte; unknown padding reads fail.

The joined run reuses the [actor-admission interpreter](native-actor-admission-evidence.md)
and its explicit null GLog, non-editor, successful-storage and finite PC53/RNE
conditions. Native LocalToWorld and auxiliary subclass bodies are **supplied
method responses** in this checker, not executed internals. Those boundaries,
exception behavior and other FPU profiles remain outside its evidence.

Portable checks require no original files:

```sh
node --test editor/world/test/static-actor-bounds.test.mjs
python3 -m unittest discover -s tools/ui -p test_static_actor_bounds_native.py
```

Ten browser-module tests cover rounding, corner extrema, validity, signed-zero
ties, lazy field reads, unknown inputs, and actor removal/reentry. Ten
interpreter tests cover method arguments, return buffers, stack cleanup,
unknown targets, opaque padding, repeated stores, unsigned multiplication,
carry/overflow and PostLoad admission guards.
The related 89 browser-module tests pass.
Local deliberate mutations of the invalid-box rule, cylinder flag, intermediate
rounding and equal-maximum comparison are rejected by the original comparison.

A browser startup smoke reached the offline world without captured errors;
the resulting screenshot was inspected. This is a startup regression check,
not an Online world-collision acceptance run. No new interface screenshot is
claimed for this headless component. This Elbera tool is repository source and
is not yet included in the existing standalone release archives.

## Bounded PostLoad path

The same command now compares the browser's `postLoadStaticMesh` with
`UStaticMesh.PostLoad` before another **600 bounding-box queries**. These
authored cases supply a current signed mesh
version of at least eight, current UObject flags with `0x100` clear, valid
nonaliasing array storage, successful allocation and a clear direction flag.
They vary vertex counts, existing array sizes, object flags and mesh versions.
The existing allocation provider and instruction interpreter are reused.

Original instructions preserve the local box, set UObject's `0x20000000` flag,
clear mesh fields `+0x1e4/+0x1e8/+0x1ec`, and replace array `+0xd8` with one
zeroed four-byte element per source vertex. The array calls are **FArray.Empty
and FArray.AddZeroed**. They do not rebuild the box in this admitted branch.
All modeled mesh fields outside that explicit write set remain unchanged in the
fixtures. The JavaScript sparse writes match the interpreted object flag,
three reset fields, array count/capacity and every zeroed element. Subsequent
bounds results match the prior browser comparisons. The JSON receipt reports
`postLoad.browserStateCompared: true` and fingerprints the tree module and
its imported collision helpers.
This adds 764,694 interpreted instructions at 676 addresses, reported separately
from the 600 original bounds cases and 288 actor updates.

Source binding compares four normal Engine regions at
`106f5ce1..106f5cfc`, `106f603b..106f605c`, `106f60f5..106f6102` and
`106f61a7..106f61f3` with their independently named supplemental counterparts.
The ordinary SEH prefix is retained for stack effects only. UObject.PostLoad
(`10163c60..10163cb8`), FArray.Empty (`101091c0..101091db`) and FArray.AddZeroed
(`10109110..1010917c`) match the pinned Core image byte for byte. Reallocation
reuses the existing qualified membership helper. Unknown targets still fail.

This does not establish the current conditions from saved exports. UObject's
`0x100` branch invokes the named `LoadLocalized` method and is excluded, as are
older mesh conversion/Build, failures and exceptions. The decoder now recovers
saved version eight for all 480 examined per-map records; the object-loading
and current-flag boundary still needs to be joined before those records can
be treated as live current bounds. The browser component has changed; the
main world's collision loader does not yet call it. No Online acceptance or
visual correction is claimed.

### Browser resource preparation

The existing `static-mesh-tree.js` now exports:

```js
const postLoad = postLoadStaticMesh({
  objectFlags,             // current unsigned UObject flags
  meshVersion,             // current signed field +0x1dc
  vertexCount,             // current vertex-stream count
  vertexArray: { count, capacity }, // current array +0xd8
});

const loaded = prepareLoadedStaticMeshTree(originalRecords, {
  objectFlags,
  meshVersion,
  vertexArray: { count, capacity },
  localBounds: { min, max, valid },
});
```

`postLoadStaticMesh` returns immutable sparse `writes` and leaves its input
unchanged. An unsupported result retains writes reached before that boundary:
the object flag is set before localized loading, and version `-1` stops before
the three field resets while other versions below eight stop afterward. Callers
must preserve those writes and the unsupported status. Missing current flags
produce no writes. The successful-storage browser profile admits at most
1,000,000 vertices; this allocation cap is **not an original game limit**.

`prepareLoadedStaticMeshTree` first validates/snapshots the original collision
records and current box, then performs PostLoad with the actual vertex-stream
count. It returns `model`, an owned immutable `localBounds`, and
`postLoadWrites`. This joins resource preparation to the existing bounds/tree
APIs; it does not execute the original archive or constructor. Saved export
flags, `loadTail` metadata and `savedLocalBounds` cannot silently supply missing
current fields. No box is recomputed from rendered geometry.

Seven added portable tests cover these boundaries, empty arrays, unsigned
flags, signed zero, mutation isolation and a composed bounds/tree query. The
53 related browser tests and ten bounds-interpreter tests pass. The original
2,600 tree/final-hit comparisons remain a separate regression check.

## Ordinary mesh construction

The same Elbera command now also executes **128 constructor cases** against
retained instructions. The input is authored incoming object storage and
explicit, nonaliasing current global counters. No browser constructor or
complete fresh-load recipe is claimed by these cases.

The original `UStaticMesh` constructor calls `UPrimitive`, `UObject`, and the
embedded stream/array constructors. The comparison establishes that:

- Header words `+0x04..+0x30`, including object flags at `+0x1c`, are preserved.
- The mesh-version field `+0x1dc` and the other checked untouched tail fields
  retain their incoming values. The constructor does **not** initialize the
  entire mesh to zero or establish its saved version.
- The primitive box and sphere initialize to zero; box validity becomes zero
  while adjacent padding stays unchanged. Serialization writes the boxes later.
- Embedded arrays initialize empty. Seven streams consume the explicit
  `GMakeCacheIDIndex` counter using the original integer arithmetic, including
  low-word carry and full 64-bit wrap. These checks do not infer its startup value.
- Fields `+0x1f4/+0x1f8` become `0xffffffff`; the source return value, stack,
  exception-chain pointer and saved registers are preserved as required.

The added run covers **117,144 instructions at 568 addresses**, reported as
`construction` separately from PostLoad and bounding-box comparisons. It
includes low/high counter boundaries, random 64-bit counters, both ordinary
construction-counter comparison outcomes and varied incoming header bits.
The existing successful storage provider is reused; no DLL executes.

Source qualification compares eleven Engine regions: the mesh/primitive
constructors, their embedded helpers, and the complete 52-byte integer-product
helper. Six Core constructor bodies match byte for byte. Every changed direct
call is tied to a separately compared helper or bound thunk; the global counter
operand is tied to its independently named Core export. Erased imports are
individually bound. The JSON report includes the source spans and the current
constructor qualifier's fingerprint. Only ten exception-handler entry bytes
are compared; complete unwind/exception behavior remains outside scope.

This closes the ordinary **constructor preservation** dependency. Incoming
allocation flags, class registration/defaults, archive side effects and reused
objects remain separate. Supplying a constructor with saved flags would still
skip the original allocation/loading rules. These results therefore do not
enable automatic adoption of saved boxes as live world bounds.

## Next integration boundary

`localBounds` must be the **current native mesh field**, not a box recomputed
from rendered vertices. The [source exporter](native-static-sweep-evidence.md#saved-mesh-bounds) now
retains both serialized writes with exact offsets and hashes; the later box
overwrites the first. Both records agree for all 480 checked per-map meshes.
Saved mesh version eight and the bounded PostLoad path above are now qualified.
Current object initialization/flags and later mutations remain separate; source
bytes alone still do not establish live current bounds.

Live actor population, original current transforms/flags, concrete primitive
query dispatch, auxiliary model implementations and movement callbacks remain
unfinished. This component removes one dependency from the faithful browser
port; it does not complete that goal.
