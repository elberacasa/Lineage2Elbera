# Original static mesh traversal and final hits

The browser now follows the original nonzero static-mesh collision tree through
triangle selection, cache writes and final hit adjustment. **2,600 comparisons**
check the actual JavaScript modules against retained Interlude instructions,
including **400 joined preparation/tree/final-hit cases**.

This completes a supplied-state collision component. Live cache acquisition,
current actor membership, level integration and walking still need work. The
full browser-client goal remains active; existing scene behavior is unchanged.

## Browser contract

`editor/world/js/static-mesh-tree.js` provides these query operations:

| Operation | Required input | Result |
| --- | --- | --- |
| `prepareStaticMeshTree(source)` | Original exporter vertices, indices, material slots, triangle planes and ordered nodes | Immutable model; no rebuilt collision geometry |
| `postLoadStaticMesh(current)` | Explicit current flags, signed mesh version, vertex count and array metadata | Original bounded PostLoad sparse writes, including writes reached before an unsupported stage |
| `prepareLoadedStaticMeshTree(source, current)` | Original records plus explicit current flags/version/array and local box | Prepared model, owned box and PostLoad writes; saved metadata is not used to infer current state |
| `traceStaticMeshTree(model, input)` | Query, current cache, closest time and consumed method responses | Tree hit flag, sparse cache/result writes and ordered object-field writes |
| `traceStaticMeshCollision(model, input)` | The same state plus explicit ordinary-mesh branch fields and owner/mesh identities | Original initial time, tree result and final hit adjustment |

`editor/world/js/static-hit.js` also exports `adjustStaticMeshHit(input)` for an
already adopted hit. All geometry stays in **native units and axis order**.
Arithmetic requires `arithmeticProfile: "pc53-rne-math-sqrt"`, dense finite
Float32 vectors and the positive mathematical square-root boundary. This does
not establish the running client's FPU profile or native CRT behavior.

Missing consumed state and unsupported arithmetic return `status: "unsupported"`
with a reason. Callers must preserve that distinction from a clear result.
Inputs remain unchanged; returned records and vectors are immutable.

The [PostLoad contract](native-static-actor-bounds-evidence.md#browser-resource-preparation)
joins original mesh loading to this geometry API under explicit current-state
conditions. Its 600 instruction comparisons check every returned reset and
the unchanged box. The main world's legacy collision loader is not yet wired
to this entry point; native construction/current flags still need source proof.

### Original model and current cache

The model accepts the existing [private sweep export](native-static-sweep-evidence.md#original-record-extraction):

```js
{
  vertices: [[x, y, z], /* original vertices */],
  indices: [/* original triangle vertex indices */],
  materials: [/* original material slot for each triangle */],
  collisionTree: {
    trianglePlanes: [/* 16 original Float32 values per triangle */],
    nodes: [
      { links: [triangle, coplanar, back, front], bounds: [minX, minY, minZ, maxX, maxY, maxZ], valid }
    ]
  }
}
```

Both triangle and node arrays must be nonempty. Child indices use original
`-1` sentinels. Shared descendants are accepted; reachable cycles are rejected.
The saved `valid` byte is preserved even though this source bounds helper does
not consume it. No renderer triangle, inferred plane or rebuilt spatial tree
substitutes for an original record.

The current query supplies `start`, `end`, nonnegative nonzero `extent`,
`ownerStatic`, and `cache`:

```js
{
  worldToLocal, localToWorld, determinant,
  queryTag,
  planes: [{ valid, plane, queryTag }],
  vertices: [{ valid, point }]
}
```

The matrices contain 16 row-major values. `plane` and `point` are required only
when their valid records are consumed. The cache's `queryTag` is the DWORD
**already advanced by the original query constructor**. This component does not
choose a starting tag, allocate the native cache or invent invalidation rules.
`traceStaticMeshTree` additionally requires the caller's current `time`.

The separate [cache adapter](native-static-mesh-cache-evidence.md) now acquires,
initializes or reuses explicit provider entries and advances their tags before
calling this tree. It uses `isPreparedStaticMeshTree` to check the model and
the shared `finishStaticMeshCollision(tree, input)` stage after releasing the
query token. The supplied-cache convenience entry has no token to release.

The module reuses [original local preparation](native-static-sweep-evidence.md)
and [triangle preparation/clipping](native-static-triangle-evidence.md). It
traverses the original near child, coplanar child, current triangle and far
child in source order, with original bounds tests and closest-hit pruning.
Each triangle is attempted once per query tag, including rejected triangles.
Exact-time ties retain the first selected result. An explicit frame stack
avoids imposing JavaScript's recursion limit on the saved tree.

### Materials and sparse writes

`methods` supplies stable source responses as `{status: "ready", value}`:

- `ownerVTableAC(slot)` supplies the original owner method's material identity.
- A null response reads the original `meshMaterials[slot]`; a null slot calls
  `defaultMaterial()`.
- A nonnull material consumes the owner's byte `ownerFlags3a0`. If its mask
  `1` is set, `ownerVTable124()` supplies the next opaque object identity.
  A nonnull response receives the original `+0x578` field write and becomes
  the result material identity.

These names deliberately retain unresolved source offsets. The component does
not assign an invented asset meaning to the object, create a default material,
implement the virtual methods or reproduce their possible side effects.
Missing methods are errors only when the source path consumes them.

The result's `writes` contains:

- `result`: only source fields written by this query.
- `planes` and `vertices`: sparse `{index, record}` final cache values.
- `objectFields`: ordered `{object, offset: 0x578, value}` writes.

The caller applies these writes to the corresponding source state. An optional
`inspect: true` adds ordered `visitedNodes` and `triangleTests`. Inspection is
diagnostic and does not alter the traversal. A miss can still write cache data;
it must not clear unrelated result fields.

### Joined ordinary-mesh result

`traceStaticMeshCollision` requires `ownerFlags2f8` with mask `0x100` clear,
`collisionModel: null`, and nonnull `actorIdentity` / `meshIdentity`. These
explicit conditions admit the ordinary mesh branch. The original cylinder and
alternate collision-model branches remain unsupported by this entry point.

The wrapper initializes time to **one**, traces the tree, then adjusts an
adopted hit using original distance-dependent bias and clamp arithmetic. It
writes the owner/item identities, final point and normal. On a miss, its result
writes contain only `time: 1`. The returned `blocked` flag comes from the tree,
not a comparison of the adjusted time.

The source `Size` stores its square root as Float32. `Normalize` uses a
different rounding path: it stores squared length and reciprocal, without an
intermediate Float32 square-root store. Below its original squared-length
threshold `1e-8`, **the normal stays unchanged**. A generic shared normalization
helper would erase this distinction. Zero or nonfinite segment length is
outside the admitted post-hit arithmetic domain.

## Reproduce the checks

Portable authored tests require no original files:

```sh
node --test editor/world/test/static-mesh-tree.test.mjs editor/world/test/static-hit.test.mjs
python3 -m unittest discover -s tools/ui -p test_static_mesh_native.py
```

The 28 browser tests cover traversal/pruning, coplanar ties, duplicate tags,
warm/cold caches, immutable and shared cache records, conditional material
responses, sparse writes, bounded PostLoad and final-hit behavior. Eight interpreter tests cover
low-byte reads, the admitted WAIT instruction, named call boundaries, normal
SEH frame bookkeeping, material method argument cleanup and square roots.
CI installs the same pinned Capstone version as the other source verifiers.

The original-input check requires owned and explicitly supplied comparison
images with the [pinned Interlude fingerprints](native-actor-transforms-evidence.md#source-bindings-and-edition):

```sh
python3 tools/ui/check_static_mesh_native.py --check \
  --comparison-engine /local/supplemental/engine.dll \
  --comparison-core /local/supplemental/Core.dll
```

Use `--engine` and `--core` for explicit owned-image paths. `--runtime-module`
selects the actual tree module; its sibling hit, triangle and preparation
modules are used and fingerprinted. Omit `--check` for a full JSON receipt on
stdout. No DLL is loaded or executed; no assets or disassembly are written.

| Comparisons | Cases | Scope |
| --- | ---: | --- |
| Whole tree | 600 | Original bounds, traversal/pruning, triangle/cache writes and supplied material responses |
| Joined collision | 400 | Preparation, tree and final hit against the actual composed browser entry point |
| Adopted-hit adjustment | 1,600 | Bias, clamp, point and source normalization, including very small normals |

The current run interprets **6,190,848 instructions across 2,750 addresses**,
including query preparation. It records 344 hits and 656 clear results across
the 1,000 tree/composed cases, 1,744 triangle attempts and 73 ordered object-field
writes. All geometry, matrices and method responses in this suite are authored
fixtures. Expected values come from retained instructions, not copied browser
formulas. Separate mutation checks reject reversed traversal order, ignored
query tags, omitted hit bias and zeroing small source normals.

A separate local diagnostic comparison also passed 48 joined sweeps through
eight freshly decoded meshes from Talking Island and Giran. Original collision
arrays round-trip byte for byte. Its query positions, identity transforms and
method responses are authored diagnostic state, **not current actor placement**.
Those private inputs and receipts are not part of the public test suite.

## Source qualification and remaining work

`tools/ui/static_mesh_source.py` reuses the existing triangle/preparation
qualifiers and adds eight bounded Engine regions and three named Core bodies:

| Region | Owned range, end exclusive |
| --- | --- |
| Normal bounds helper | `106fff9b`–`10700233` |
| Plane pushout | `105e9990`–`105e99d9` |
| Float maximum | `104a4940`–`104a4967` |
| Loaded node pointer | `106ff8c6`–`106ff8ce` |
| Cached node count return | `106fea10`–`106fea27` |
| Normal collision tree | `10702cc0`–`1070315d` |
| Wrapper through final hit | `10703314`–`10703685` |
| Float clamp | `103704b0`–`103704e6` |
| Core exact vector equality | `1010c740`–`1010c77c` |
| Core Size | `1010ca20`–`1010ca50` |
| Core Normalize | `1010cb20`–`1010cb92` |

Engine comparison bodies are `0x40` earlier except the maximum and clamp, which
share addresses. Named erased imports and same-target direct calls are checked
explicitly. One material-class operand is normalized only after checking its
independently named export in both images. Remaining bytes agree; consumed
constants and the Core bodies match exactly. The supplemental archive is not
authenticated and the owned binary is not repaired.

The expected-result interpreter executes supplied-cache preparation, the normal
tree and its helpers, and the post-hit slice. The full wrapper, cached-count
return and exact-equality body are qualified source evidence; their admission
paths are not dynamically interpreted by this checker. The separate cache
verifier now executes bounded acquisition, tag advancement and normal release
against explicit provider responses. Native paging, SEH setup/unwinding,
default-object creation/type checking and virtual method implementations remain
supplied-state boundaries. Other arithmetic profiles and exceptional values
are outside these comparisons.

The next integration work is current actor-provider membership and native
cache-provider internals, followed by level queries and floor/step/ledge response. This Elbera
Tool is available as repository source. Existing standalone releases remain
unchanged. No visual layout changed, so the existing README gallery is retained
without adding an unrelated screenshot.
