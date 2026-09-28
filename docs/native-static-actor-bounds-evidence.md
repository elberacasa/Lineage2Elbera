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

## Fresh resource preparation

`static-mesh-tree.js` adds a fresh-resource entry that joins the recovered flag
transitions, constructor-empty array, saved version and saved box to the existing
PostLoad/tree API:

```js
const prepared = prepareFreshStaticMeshTree(originalRecords, { classFlags });
```

The explicit `classFlags` argument supplies current native class state for
component comparisons. Without it, the entry requires the source-derived
`classLoading` mask described below; missing evidence is unsupported. This
entry is limited to a freshly allocated, resolved `Engine.StaticMesh`, file
version 123, ordinary native class defaults and admitted saved properties.
Reuse, custom templates, external default-object changes, script stacks and
class configuration/localization remain outside its contract.

The optional sweep export now retains `sourceClass` and ordered
`savedProperties`: saved export flags plus every tag's name, type, array index
and struct identity. The runtime admits only the sixteen original top-level
mesh declarations with their exact types, index zero and no duplicates. Unknown
or converted tags remain unsupported. These declarations target native tail
fields; `Materials` belongs at **+0x13c**, separate from sections at +0x60.
The default ray export is unchanged.

The unsigned flag stages are exposed in `loadingFlags` for inspection:

| Stage | Recovered operation |
| --- | --- |
| CreateExport | `(savedFlags & 0x067f01a5) \| 0x01000200` |
| Fresh allocation | Add `0x4000` when current class flags contain `0x8` |
| Preload begins | Clear `0x200`, set `0x8000` |
| Serialize / Preload ends | Set `0x40000000`, clear `0x8000` |
| ConditionalPostLoad | Clear `0x21000000` before the mesh's PostLoad |

The existing PostLoad then sets `0x20000000` and performs its bounded reset.
`localBounds` comes from the later saved box; it is never fitted to rendered
vertices. Successful results expose the existing immutable `model`,
`localBounds` and `postLoadWrites`. Preflight rejection does not simulate a
partially executed native loader; unsupported PostLoad branches retain their
existing sparse-write behavior.

The same bounds verifier adds **256 source/browser comparisons**, executing
271,620 instructions at 723 addresses. It interprets the original flag slices,
the complete normal mesh constructor and ConditionalPostLoad/PostLoad. It
compares all five stages, final flags, reset fields, array size/capacity and
every zeroed entry. All sixteen source-bound property types exercise browser
admission. The decoded payload and current class flags are supplied boundaries;
archive I/O and full class/default-object loading are **not executed**.

Qualification binds the complete normal native property constructor
`106f4810..106f4f1d`, seventeen Core regions and eighteen instruction anchors.
Each erased import and changed class/FName operand has an explicit binding.
The source report records all spans, hashes and declarations. Only the ten
entry bytes of relocated exception handlers are compared.

This investigation also corrected an inherited `InitProperties` boundary in
the picking and pose-allocation checks. Its old endpoint cut through a jump;
the complete normal body ends at **0x1015fc7a**. The omitted constructor-linked
property loop is now retained. Bulk copying starts after the object header,
but later property copying uses declared offsets: header preservation is
scoped to the original native descriptors, not arbitrary class metadata. See
the [corrected allocation evidence](native-pose-allocation-evidence.md).

For an original-input compatibility check, the existing record checker can
exercise the actual browser helper with an **explicit diagnostic** class state:

```sh
python3 tools/world/check_static_collision_records.py 17_25 22_22 \
  --fresh-class-flags 0 --check
```

Here zero is an authored test condition, **not a recovered game value**. All
480 per-map records pass under that condition, alongside exact geometry,
box, tail and property comparisons. The output labels the class state as
diagnostic and fingerprints the runtime. Omitting the option leaves this extra
check disabled. No generated assets or live scenes are changed.

Validation also passes 42 related browser tests, 40 portable collision-record
tests and ten instruction-interpreter tests. The corrected original picking
and pose-allocation checks pass. An inspected offline browser startup produced
no captured errors; it does not exercise the new entry through the live world.
The reusable tools remain repository source outside the current standalone
archives. Original inputs, raw listings and per-record receipts stay private.

## Source-derived class loading bits

The optional sweep exporter now adds `classLoading`, derived from the pinned
native Object → Primitive → StaticMesh registration declarations and the
original Core/Engine class packages. The browser can therefore call
`prepareFreshStaticMeshTree(originalRecords)` without a diagnostic class word.
The explicit `classFlags` argument remains available for component comparisons.

The record carries a known-bit mask **0x408** and its decoded value. These are
exactly the two class bits consumed by this preparation path: allocation's
0x8 branch and configuration/localization's 0x400 branch. Both are clear in
the qualified native chain. Other class bits are not supplied as current state.
Missing masks, unresolved consumed bits, mismatched class identities, unknown
scope and values outside the known mask are rejected rather than defaulted.

The native UClass constructor adds 0x12 to its declared flags. Registration
inherits the parent's flags through mask 0x000f86ec. The root's native
constructor flags and its saved Core.u class flags differ, but neither supplies
either consumed bit through this hierarchy. Engine.u has no serialized Class
replacement for Primitive or StaticMesh. The root reader follows the bounded
zero-script file-123 prefix through the actual ClassFlags field, preserving
variable-width compact fields and rejecting truncated or unsupported layouts.

Elbera's existing bounds verifier now binds two Engine registration prefixes,
six explicit operand bindings, nine named imports and 26 exact Core regions,
including constructor, registration, Link, Bind, PostLoad and root-prefix
serialization. Twenty-two additional instruction anchors qualify prefix
layout and the State table's boundary before the ClassFlags slot. The added
helper is `tools/ui/static_mesh_class_source.py`; its hash is included in the
verification receipt. The existing 256 native flag comparisons exercise both
explicit-word and source-known-bit browser input forms.

The two additional owned packages are required at their original local paths:

| Input | SHA-256 |
| --- | --- |
| `assets/interlude/system/Engine.u` | `9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761` |
| `assets/interlude/system/Core.u` | `de5f0ee0a773327bce13c96622fd3c654cff7db88b9be065d1232590c140fda0` |

The usual bounds-verifier command above reproduces the source qualification.
`python3 tools/world/check_static_collision_records.py 17_25 22_22 --check`
now also checks browser preparation using decoded class metadata by default;
Node.js is required. All 480 per-map records pass without a diagnostic override.
`--fresh-class-flags` remains an explicitly labeled diagnostic override.

This is scoped to ordinary native registration and the pinned original
packages/descriptors. It does not execute the full native class registry or
support external class mutation, custom defaults or replacement classes.
The main world still uses the older collision loader; live actor population,
placement and complete resolved-object lifecycle remain unfinished.

## Actor construction and saved transform inputs

The same Elbera bounds verifier now executes ordinary `AStaticMeshActor`
construction, its `AActor` parent and their named Core helpers in **192 authored
storage cases**. It compares every supplied DWORD, the object/actor counters,
callee-saved registers and stack restoration. The constructor preserves
incoming property storage, including transforms, collision fields and no-init
arrays. Its writes are the vtable and the four words beginning at actor `+3a0`;
the latter follow the original texture-modification helper. This is not a
zero-initialized allocation or recovered class-default object.

Another **192 PostLoad cases** execute the original Actor and UObject methods
with object bit `0x100` clear, class bit `0x20` clear, an empty attached-actor
array and explicit nonaliasing references. UObject sets object flag `0x20000000`;
Actor copies the three rotation words from `+1c8` to `+2d0` and sets `+5c` bit
`0x40`. Nonnull `+278` and its nonnull `+60` reference receive object flag `1`.
The check does not infer further meanings for those referenced objects. All
other supplied actor words survive. Unsupported localization and attached-array
paths stop the interpreter rather than treating erased calls as no-ops.

The run adds **46,080 constructor instructions at 185 addresses** and
**15,424 PostLoad instructions at 84 addresses**. Source qualification adds
five Engine regions and eight exact Core bodies, with 41 named imports,
four counter-operand bindings and Actor/StaticMeshActor vtable bindings.
`AActor.Serialize` is compared as source correspondence only: its loading
branch delegates tagged property application to UObject; no archive is executed
in these new actor cases. Exception/unwind paths remain excluded. The helper
lives in the existing `actor_transform_source.py`, whose hash is recorded.

The private sweep export now retains `savedTransform` for selected actors:
`location`, `rotation`, **separate** `drawScale` and `drawScale3D`, and `prePivot`,
each identified as a map property or inherited class default. PrePivot's
original Vector declaration and the existing zero-plus-parent class-default
path qualify an absent tagged override; a caller without that default is
rejected. The legacy combined `scale` must not feed the native matrix API.
Signed-zero bits survive raw-property round trips. The same record-checker
command checks **986 Talking Island and 1,936 Giran transform records**; the
existing conservative collision selection is unchanged.

These results deliberately stop short of declaring saved transforms to be live
actor state. Current class flags, archive application, linked references,
level membership and later lifecycle changes still need to be joined. The main
browser has not switched collision loaders. Forty-seven portable record tests
and twelve interpreter tests pass; prior mesh/bounds comparisons still pass.
No runtime JS/UI changed, and no new screenshot or Online acceptance is claimed.
Original files and raw receipts remain private; the reusable checker remains
repository source outside the current standalone tool archives.

## Declared actor flags and reference identities

The same private sweep export now retains `savedCollisionFlags`, with a
known-bit mask and value for each of four Actor words. The decoder follows
linked property declarations from the pinned `Engine.u`, rather than export
table order. It rejects foreign owners, cycles, arrays, truncated declarations
and unsupported group endpoints. Explicit false map overrides survive; fields
without a tagged default use the already qualified zero-plus-parent CDO path.
Undeclared padding stays unknown.

| Actor word | Declared Boolean fields | Known mask |
| --- | --- | --- |
| `+64` | 21 | `0x1fffff` |
| `+74` | 23 | `0x7fffff` |
| `+2e4` | 21 | `0x1fffff` |
| `+2f8` | 17 | `0x1ffff` |

The bounds verifier binds these **82 field identities** to four byte-identical
regions of the original typed AActor copy constructor. It executes **512 copy
cases**, checking source preservation, declared destination bits, untouched
padding and neighboring words: 52,096 instructions at 407 addresses. These
are copy slices with supplied inputs, not execution of class layout or map
loading. The full normal `UBoolProperty.Link` body
(`10173250..101732f1`) also matches the pinned companion; instruction anchors
identify prior-bit shifting, offset reuse, four-byte alignment and initial mask.

Five additional linked declaration/typed-copy chains resolve references that
must not be conflated during world integration:

| Actor field | Offset | Declared reference type |
| --- | --- | --- |
| StaticMesh | `+38` | `Engine.StaticMesh` |
| Level | `+e0` | `Engine.LevelInfo` |
| XLevel | `+e4` | `Engine.Level` |
| Mesh | `+104` | `Engine.Mesh` |
| Brush | `+278` | `Engine.Model` |
| AntiPortal | `+2b8` | `Engine.ConvexVolume` |

Thus the prior PostLoad `+278` object is Brush; its `+60` reference still has
no further meaning assigned here. XLevel is transient in its declaration.
An absent saved XLevel is not proof of a null current world. The checker
records exact property flags and declaration fingerprints with the bindings.

The existing bounds and record commands reproduce this milestone; there are
no new dependencies. All **986 Talking Island and 1,936 Giran saved flag
records** agree with decoded tags and inherited defaults. Transform counts,
mesh preparation and conservative collision selection are unchanged.
Fifty-two portable record tests and twelve interpreter tests pass. Authored
fixtures check linked order, rejection boundaries, false overrides and padding
mutations without original files.

`savedCollisionFlags` remains saved-source evidence. Transient-property
loading rules, current lifecycle writes, resolved references and level
membership must be joined before it can supply current actor state. There is
no new runtime JS/UI change, screenshot or Online map-repair claim. Original
inputs and generated flag records remain private; these additions extend
the existing repository tools, outside the current standalone archives.

## Saved level membership and population order

The shared Level prefix reader now retains both serialized reference arrays,
not just their counts. `savedLevelBinding` carries their exact original order;
each static source record adds `exportRef` and `savedLevelSlots` for the
`ULevel+38` array. Empty and repeated slots remain intact. The static export's
`references` list is still an audit list, **not a population sequence**. An
empty `savedLevelSlots` means the export has no slot in the saved actor array.

| Map | Saved `+48` references | Saved `+38` actor slots | Static actor exports | Static actors in `+38` |
| --- | --- | --- | --- | --- |
| Talking Island `17_25` | 1,484 | 1,234 | 986 | 983 |
| Giran `22_22` | 2,301 | 2,406 | 1,936 | 1,936 |

All **7,425 references** round-trip their original array bytes, and every
audited static actor's slot membership is checked. The three Talking Island
exports outside `+38` pass the older static collision-selection checks;
export-table presence alone cannot establish level membership. This does not
remove actors from the current browser scene or claim that later loading
never changes the arrays.

The existing bounds verifier also binds `ULevel.SetActorCollision` and its
fresh-hash population loop (`105cabe8..105cac20`). **256 interpreted cases**
preserve slot order, skip nulls, test actor `+2f8` mask `0x1` and call the collision
provider's `AddActor` virtual at offset `+0x08`. A repeated actor gets another
call; there is no sorting or deduplication. These cases make 2,311 calls over
80,761 instructions at 19 addresses, including 589 null slots and 3,218
repeated nonnull slots. The preceding fresh-hash guard matches the pinned
supplement as source correspondence; allocation is not executed.

These cases supply a stable current array, provider and synchronous AddActor
callback. They do not execute the callback internals, editor cleanup, hash
removal or saved-to-current loading. The existing separate AddActor comparisons
remain passing. The original Level serializer binding also passes its existing
41 instruction anchors and ten supplemental block comparisons:

```sh
python3 tools/world/export_bsp_collision.py 17_25 --check \
  --native-binding-check --comparison-engine /local/comparison/engine.dll
```

The usual record and bounds commands above reproduce the new checks. Portable
tests pass: 53 static-record tests, 12 BSP tests, 13 bounds-interpreter tests
and 44 related terrain tests. Authored fixtures reject changed array order,
missing repeated slots, fabricated membership, changed counts/spans and wrong
callback targets or receivers. No runtime JS/UI change or new screenshot is
claimed; live population still needs current fields and loading evidence.

## Level loading assignments and saved references

The browser's `actor-loading.js` now reproduces the two actor assignment
loops in `ULevel.PostLoad`. It traverses the current object registry and then
the current object buffer, retaining null filtering, class ancestry, outer
identity comparisons and repeated entries. Matching actors receive
`XLevel(+e4) = Level` and collision query tag `+2cc = 0`. The original
PlayerController cast excludes controllers with `+5ac & 0x100`; this check is
not a Pawn or TerrainInfo test.

```js
const result = collectLevelActorAssignments({
  level: { identity, outerIdentity },
  registry, buffer,             // Dense arrays of identities or explicit nulls.
  objects,                     // Map: identity -> current class/outer fields.
  classParents,                // Map: class identity -> parent identity or null.
  actorClass, playerControllerClass,
});
```

Object records provide `classIdentity` and, when consumed, `outerIdentity` and
`playerControllerFlags5ac`. The returned ordered `assignments` contain source
list/index, actor identity and the two sparse writes. The caller applies the
writes; the module does not mutate inputs. Missing or cyclic consumed class
state returns `unsupported`, retaining earlier recovered writes. An absent
field never becomes a null reference. Inputs must remain stable during the
synchronous operation.

The same bounds command compares **192 cases and 1,875 ordered assignments**
against 337,380 interpreted instructions at 145 addresses. Every other supplied
actor word and both source lists remain unchanged. Source qualification binds
the named Level method, both global registry imports, Actor and PlayerController
class exports, iterator/cast thunks, and the actual Core `GetOuter` and `IsA`
bodies. The source loops are `105cd651..105cd747`, after UObject.PostLoad and
before model/render/tile preparation. Class construction, registry population
and later world reassignment remain separate boundaries.

The existing private sweep exporter also adds `savedReferences`. Each of its
seven fields—StaticMesh, Owner, Level, XLevel, Mesh, Brush and AntiPortal—retains
the canonical package index, full qualified identity, source package and
map/default origin. The linked declarations preserve property flags, including
transient XLevel. Native copy-chain qualification checks those declarations
against the previously recovered field offsets. Class references start from
the qualified zero/parent default path and take ordered class overrides; the
reader never uses a flattened leaf name as an identity.

All **20,454 reference fields across 2,922 static actors** check against their
original map tags or class defaults. Both maps explicitly save StaticMesh and
Level. The other five references have zero class defaults with no saved map
override. These are saved facts, not proof of current native pointers or of
transient-property application. Legacy ray selection remains unchanged.

```sh
node --test editor/world/test/actor-loading.test.mjs
python3 -m unittest discover -s tools/world -p test_static_collision.py
python3 -m unittest discover -s tools/ui -p test_static_actor_bounds_native.py
```

Six browser-module cases, 57 portable record cases and 14 bounds-interpreter
cases pass without original files. They cover ordering, lazy input consumption,
nulls, unresolved ancestry, duplicate/malformed references, preserved group
names and SETE's low-byte/flag behavior. The existing private record and bounds
commands reproduce the original-input checks using the pinned editions above.

The main browser collision loader still uses the earlier ray path. A browser
startup check reached the offline Giran scene without captured errors; its
inspector still reported no audited static surfaces loaded. This verifies
startup only. No new Online query, map repair or UI screenshot is claimed.
These additions remain repository Elbera Tools, outside the existing standalone
release archives; original inputs and generated records stay private.

## Next integration boundary

`localBounds` must be the **current native mesh field**, not a box recomputed
from rendered vertices. The [source exporter](native-static-sweep-evidence.md#saved-mesh-bounds) now
retains both serialized writes with exact offsets and hashes; the later box
overwrites the first. Both records agree for all 480 checked per-map meshes.
Saved mesh version eight and the bounded PostLoad path above are now qualified.
Fresh initialization now has the bounded entry above, but complete class state,
resolved-object lifecycle and later mutations remain separate. Source
bytes alone still do not establish live current bounds.

Live actor population, original current transforms/flags, concrete primitive
query dispatch, auxiliary model implementations and movement callbacks remain
unfinished. This component removes one dependency from the faithful browser
port; it does not complete that goal.
