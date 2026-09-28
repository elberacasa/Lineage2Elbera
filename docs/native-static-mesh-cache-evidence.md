# Original static mesh cache acquisition and reuse

The browser now joins the original cache lookup, identity checks, initialization,
matrix refresh and query-tag update with the existing mesh collision component.
It applies triangle-cache writes and releases the query's cache token **before**
the final hit adjustment, following the original wrapper's order.

Elbera Tools checks **600 joined browser queries** against retained Interlude
instructions, plus **1,000 general matrix determinants**. This is a component
with explicit provider responses. Native memory allocation/eviction, current
actor membership and live walking remain unfinished. The full browser-client
goal remains active.

## Browser entry point

`editor/world/js/static-mesh-cache.js` exports:

| Operation | Purpose |
| --- | --- |
| `staticMeshCacheKey(ownerCacheIndex, meshCacheIndex)` | Original two-DWORD type-`0xe3` key from source UObject cache indices |
| `bindStaticMeshCacheEntry(entry, input)` | Copy explicit existing source cache state into an unbound opaque entry |
| `inspectStaticMeshCache(entry)` | Read an immutable diagnostic snapshot, retaining absent numeric cells |
| `traceCachedStaticMeshCollision(model, input)` | Acquire/reuse the cache and run the ordinary nonzero mesh query |

The model comes from `prepareStaticMeshTree`; its original geometry and saved
collision records are described in the [mesh component](native-static-mesh-evidence.md).
Queries use native units and axis order, finite Float32 vectors and
`arithmeticProfile: "pc53-rne-math-sqrt"`. The admitted arithmetic profile and
mathematical square-root boundary do not establish live native FPU/CRT behavior.

```js
const result = traceCachedStaticMeshCollision(model, {
  arithmeticProfile: "pc53-rne-math-sqrt",
  ownerIdentity, meshIdentity,
  ownerCacheIndex, meshCacheIndex,
  ownerStatic, ownerFlags2f8, collisionModel,
  start, end, extent,
  provider, readTransforms,
  methods, meshMaterials, ownerFlags3a0,
  inspect: true,
});
```

Both identities are explicit opaque nonnull values. The two cache indices are
original unsigned DWORD fields returned by `UObject.GetCacheIndex`; neither
server object IDs nor filenames establish those fields. The key retains source
integer wrap: low DWORD `((ownerCacheIndex << 8) + 0xe3) mod 2^32`, high DWORD
`meshCacheIndex`. A key match alone does not establish an identity match.

`ownerStatic` is the current source `bStatic` boolean. The ordinary-mesh entry
requires the `ownerFlags2f8` mask `0x100` clear and `collisionModel: null`.
Alternate primitive branches remain outside this entry point. Material methods
and their conditional fields follow the existing mesh component's contract.
All query, provider and method state must remain stable during this synchronous
call; arbitrary callbacks or nested queries mutating shared source state are
outside the comparison.

### Explicit provider responses

The provider owns opaque entry handles and lock tokens. Every consumed method
returns `{status: "ready", ...}` synchronously:

| Method | Required response / behavior |
| --- | --- |
| `get(key, 8)` | `entry: null`, or an initialized entry object and its `token` |
| `create(key, bytes, 8, 0)` | A fresh entry object and its `token` |
| `unlock(token)` | Confirm release of that acquired token |
| `flush(key, 0xffffffff, 0)` | Confirm the original mismatch flush operation |

The numeric arguments and their order come from the original call sites. The
adapter does **not** implement native `FMemCache` capacity, allocation, lock
internals or eviction. The provider must supply known results; missing state
cannot become a cache miss or successful allocation by default.

On a lookup hit, the adapter checks the stored **owner and mesh identities**.
A mismatch releases the old token, flushes the key, then creates fresh storage.
An unrecognized existing entry returns unsupported after releasing its known
token. A normal reused entry retains its records.

Fresh storage requests the original size:
`0x98 + 24 * triangleCount + 16 * sourceVertexCount`.
The browser admits sizes representable as a positive signed DWORD. It constructs
the matrices, initializes the query tag to zero, sets every triangle's validity
and tag to zero, and sets every vertex's validity to zero. **Cold numerical
plane/point cells remain absent**; the source constructor does not fill them
with zero vectors.

### Matrix refresh and cache writes

`readTransforms()` returns
`{status: "ready", worldToLocal, localToWorld}` with two current source
16-value Float32 matrices. The [original actor-transform component](native-actor-transforms-evidence.md)
can derive them from explicit actor fields and a qualified original sine table.
A rendered transform or arbitrary matrix inverse is not a source substitute.

A fresh cache always consumes the matrix response. A reused cache consumes it
only when `bStatic` is false. The cache computes the source determinant from
`localToWorld` using the shared `originalMatrixDeterminant` helper; a supplied
scalar cannot override that calculation. Matrix refresh **does not clear**
existing triangle/vertex validity or per-triangle tags.

The query tag increments as a DWORD, including `0xffffffff → 0`. There is no
invented reset to one or full record clear on that branch. Existing matching
triangle tags still suppress their attempts. Each query applies the tree's
sparse cache writes before releasing its token. Final hit adjustment follows
release. The returned `blocked`, result writes, material-field writes and
optional inspection retain the mesh component's meaning; `cacheDisposition`
reports `created`, `reused` or `replaced`.

Missing consumed data returns `status: "unsupported"`, never a clear route.
Already acquired tokens are released when browser validation aborts a query.
That cleanup is browser resource management, not evidence of original exception
unwinding. An unsupported query supplies no successful collision result or
rollback guarantee for earlier cache activity.

### Existing state and inspection

```js
bindStaticMeshCacheEntry(entry, {
  ownerIdentity, meshIdentity,
  cache: {
    worldToLocal, localToWorld, determinant, queryTag,
    planes: [{valid, queryTag, plane}],
    vertices: [{valid, point}],
  },
});
```

The binder requires an unbound entry and copies dense finite records. `plane`
and `point` may remain absent until consumed. Binding does not authenticate the
caller's source data. A bound entry cannot be overwritten through this API.
`inspectStaticMeshCache(entry)` returns frozen owned records rather than exposing
the mutable runtime cache. Ordinary queries update only touched records; they
do not copy all mesh cache arrays on every trace.

## Reproducible verification

Portable fixtures need no game files:

```sh
node --test editor/world/test/static-mesh-cache.test.mjs
python3 -m unittest discover -s tools/ui -p test_static_mesh_cache_native.py
```

Fifteen browser cases cover fresh/cold state, reused static/dynamic matrices,
identity collisions, warm validity, tag wrap, sparse writes, unsupported-state
cleanup and release-before-hit order. Eight interpreter cases cover unsigned
product words, fresh carry and zero flags, provider argument cleanup, output
tokens and refusal of unqualified calls. CI installs the pinned Capstone version
used by the other source verifiers.

The original-input comparison requires owned Engine/Core files plus explicitly
supplied comparison images matching the [pinned Interlude fingerprints](native-actor-transforms-evidence.md#source-bindings-and-edition):

```sh
python3 tools/ui/check_static_mesh_cache_native.py --check \
  --comparison-engine /local/supplemental/engine.dll \
  --comparison-core /local/supplemental/Core.dll
```

Use `--engine` / `--core` for explicit owned paths. `--runtime-module` selects the
actual cache module and its sibling runtime dependencies. Omit `--check` for
the full JSON receipt, including nested source checks, coverage and runtime/tool
fingerprints. Importing the checker reads no game images. No DLL is executed;
no original assets or disassembly are emitted.

| Comparison | Cases | What is checked |
| --- | ---: | --- |
| Joined cache and collision queries | 600 | 150 fresh, 150 reused and 300 identity-replacement responses, with bitwise cache/results and ordered provider/material events |
| General matrix determinants | 1,000 | Actual source cache update and Core determinant stores, including non-affine and degenerate authored matrices |

The query cases include eight counter-wrap cases and prior cache records computed
under a different `bStatic` state. Those are authored states, not observations of
live actors. Expected results are computed from retained instructions, including
the key's wide product, constructor stores, matrix copy/determinant, tree and
normal destructor. Memory-cache and owner-matrix responses remain supplied
boundaries. Separate deliberately incorrect implementations are rejected for
ignored mesh identity, unnecessary static matrix refresh, cleared warm validity,
missing DWORD wrap and release deferred until after hit adjustment.

## Source scope and next integration

`tools/ui/static_mesh_cache_source.py` extends the existing mesh program with
ten Engine regions and three exact named Core bodies:

| Region | Owned range, end exclusive |
| --- | --- |
| Matrix update, normal body | `106fe138`–`106fe1cf` |
| Query destructor, normal body | `106fe889`–`106fe8a9` |
| Complete cache key | `106fead0`–`106feb18` |
| Fresh cache constructor, normal body | `106feb51`–`106fec0f` |
| Allocation size | `106fed90`–`106fedac` |
| Base lookup and mismatch | `106feeb1`–`106fef62` |
| Base creation | `106fef71`–`106fefb2` |
| Reused matrix-update gate | `106fefba`–`106fefc8` |
| Tag increment | `106fefd7`–`106fefe1` |
| Complete wide-product helper | `107a6660`–`107a6694` |
| Core GetCacheIndex | `1010a1c0`–`1010a1c4` |
| Core matrix destructor | `101111e0`–`101111e1` |
| Core determinant | `10111bb0`–`10111c76` |

Comparison Engine bodies are `0x40` earlier. Named erased imports, exported
`GCache` operands and the independently checked wide-product target are the
declared normalizations; remaining bytes agree. Core bodies and consumed
constants match exactly. Named thunks bind the source stages and the wrapper's
destructor call before its final-hit slice.

Normal SEH frames are explicit interpreter inputs. Three statistics-only gaps
are excluded: `106fef62`–`106fef71`, `106fefb2`–`106fefd7`, and the reused branch
`106fefc8`–`106fefd7`. This is not full native constructor execution. Native
exception paths, provider internals, current actor bindings, alternate primitive
branches and live level/movement integration remain open.

The verifier is an Elbera Tool available as repository source. Existing
standalone archives and the README screenshot gallery are unchanged. The next
integration work is the original actor provider and its spatial membership,
followed by complete level queries and camera/floor/step/ledge response.
