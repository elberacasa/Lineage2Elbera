# Original static collision records and sweep preparation

The browser now prepares a nonzero-extent static-mesh query using the original
cached WorldToLocal matrix and source arithmetic order. **800 finite cases**
match retained Engine/Core instructions bit for bit. Elbera Tools also preserves
the original collision planes, tree links and bounds instead of rebuilding them
from the rendered mesh.

This component does not yet return a collision result. The separate
[triangle component](native-static-triangle-evidence.md) now preserves original
world preparation and clipping. Tree traversal, material callbacks, current
actor/cache lifetime and live walking remain unfinished. The existing world
scene and legacy ray picker are unchanged.

## Browser contract

`editor/world/js/static-sweep.js` exports:

```js
prepareStaticSweep({
  arithmeticProfile: "pc53-rne",
  start, end, extent,
  cacheWorldToLocal,
});
```

The vectors are dense ordinary arrays of three exact finite Float32 values in
**native units and axis order**. `extent` must be nonnegative with at least one
nonzero axis. The all-zero query follows a separate original path. Supply the
actual cached source matrix as a dense, row-major array of 16 Float32 values;
translation occupies indices 12–14. A renderer inverse is not this input.

The [original actor-transform component](native-actor-transforms-evidence.md)
can compute the matrix from explicit source actor fields and a qualified sine
table. That does not establish cache validity or the actor's current state.

A ready result contains frozen `localStart`, `localEnd`, `localExtent`,
`localDelta` and `reciprocalDelta` vectors, plus scope and arithmetic profile.
Missing or sparse inputs, unsupported profiles, negative/all-zero extents and
nonfinite derived output return `status: "unsupported"`. No state is invented,
inputs are untouched, and a ready preparation is not a clear collision result.

### Source order and rounding

The original point calculation adds the Y product, X product, Z product and
translation in that order, then stores each output as Float32. FBox transforms
all eight corners in X/Y/Z loop order, visiting minimum before maximum on each
axis. Strict comparisons retain previous bounds on a tie. GetExtent stores
`max - min` before multiplying by the source one-half constant.

Consequently, translation affects the rounded extent. For an authored identity
basis translated by `[2^24, 2^25, 0]`, source extent `[1, 1, 1]` becomes
`[0.5, 0, 1]`. An absolute-matrix shortcut gives a different answer. It differs
from the original in **725 of the 800** comparison cases.

Delta is the stored local end minus local start. Only an **exactly zero**
component receives the original Float64 addition
`1.0000000116860974e-7`, followed by a Float32 store. Small nonzero components
retain their value. Each reciprocal is then stored as Float32. This is a
recovered operation, not a browser tolerance or general collision epsilon.

## Reproducible checks

Portable authored fixtures need no game files; the Python interpreter tests
require Capstone:

```sh
node --test editor/world/test/static-sweep.test.mjs
python3 -m unittest discover -s tools/ui -p test_static_sweep_native.py
python3 -m unittest discover -s tools/world -p test_static_collision.py
```

Eleven browser cases cover rounding, signed zero, exact-zero adjustment,
nonzero small deltas, negative scale, composing source matrices and explicit
failure boundaries. Four interpreter cases cover integer flags, partial status
writes, unknown calls and bounded execution. Twenty-five exporter/record tests
cover source framing, qualification and round trips. CI runs all three sets.

The original-input differential reads pinned owned Engine.dll/Core.dll and
requires explicit comparison images:

```sh
python3 tools/ui/check_static_sweep_native.py --check \
  --comparison-engine /local/supplemental/engine.dll \
  --comparison-core /local/supplemental/Core.dll
```

Use `--engine`, `--core` and `--runtime-module` for explicit local paths. Omit
`--check` for a full JSON receipt on stdout. The checker interprets
**1,176,375 instructions across 492 addresses**, including 411 exact-zero delta
components, and compares the actual browser module's Float32 words. Separate
negative checks reject both the absolute-matrix shortcut and clamping small
nonzero deltas. No DLL is loaded or executed.

The finite arithmetic model explicitly requires PC53/RNE. Other rounding or
precision modes, floating-point exceptions and extended-exponent edge behavior
remain outside the claim. The interpreter starts after cache acquisition with
explicit fields/frame state; it does not emulate the constructor's complete
cache, statistics, exception or actor-lifetime paths.

## Original record extraction

The existing exporter has an opt-in `--sweep-output` mode:

```sh
python3 tools/world/export_static_collision.py 17_25 \
  --actor StaticMeshActor140 --actor StaticMeshActor141 \
  --sweep-output /private/local/lighthouse-collision.json
```

The separate `l2-static-sweep-source-v1` file contains original vertices,
triangle indices/material slots, all 16 Float32 plane values per triangle,
ordered node links, six bounds values and the validity byte. It also records
source/export hashes and actor-to-mesh references. Planes are not normalized;
the tree is not rebuilt. Signed zero is retained in the decoded records.

This mode uses exclusive creation and never changes a scene or legacy ray
sidecar. It cannot be combined with `--emit`, `--audit` or `--references-only`.
`--all-supported` explicitly selects the existing conservative actor/material
subset; an explicit actor list cannot silently produce a partial selection.
Legacy combined placement scales are deliberately absent from this format.
Current matrices and owner/material callbacks remain separate required state.

**Generated files contain private original-derived data.** Do not commit them,
include them in public tool archives or treat them as observed live actor state.

A read-only checker freshly decodes the maps, re-encodes each admitted triangle
and node array, and compares every byte with the original package, including
compact indices and lazy saved-end framing:

```sh
python3 tools/world/check_static_collision_records.py 17_25 22_22 --check
```

| Map | Decoded meshes checked | Triangle records | Node records | Lazy / ordinary arrays |
| --- | ---: | ---: | ---: | ---: |
| `17_25` | 193 | 66,674 | 233,307 | 157 / 36 meshes |
| `22_22` | 287 | 90,139 | 305,937 | 270 / 17 meshes |

Counts are per map's unique qualified geometry, not placed actors or unique
meshes across both maps. The checker includes admitted geometry referenced by
actors that fail placement gates; its selection report distinguishes these.
Unsupported versions/materials remain excluded. Exact original payload round
trips do not prove native archive lifetime, malformed/noncanonical compact
stream behavior, current cache state or collision results. Full receipts stay
local and include every source fingerprint.

## Source qualification

The preparation checker qualifies two Engine slices and four named Core bodies:

| Source region | Owned address range (end exclusive) |
| --- | --- |
| Base query after cache/tag work | `106fefe1`–`106ff0c4` |
| Nonzero query fields, delta and reciprocal | `106ff3d1`–`106ff568` |
| FBox constructor | `1010ef80`–`1010efb2` |
| FBox TransformBy | `10117dd0`–`10117f26` |
| FBox GetExtent | `1010f1b0`–`1010f1f8` |
| FBox point accumulation | `101177f0`–`10117954` |

Only the three independently named erased Core calls are normalized in these
Engine comparisons. The supplemental Engine slices are at owned address minus
`0x40`; all other compared bytes agree. Source constants are independently
matched in both images. Original block hashes are included in the receipt.

`tools/ui/static_collision_source.py` additionally qualifies three Engine
serializer blocks (`10366720`, `10366940`, `103302c0`) and two named Core bodies.
Twenty-two erased sites bind ByteOrderSerialize; two independently named
operand loads bind the compact-index serializer. ByteOrderSerialize delegates
to the supplied archive's virtual Serialize. These are static bindings, not
numerical execution of archive I/O. The earlier owned-only picking proof still
cannot name those protected imports without the explicit supplemental images.

All four binary inputs must match the fingerprints in the
[actor-transform evidence](native-actor-transforms-evidence.md#source-bindings-and-edition).
A different edition is rejected. Supplemental correspondence does not
authenticate the archive, restore the owned imports or observe a live client.

These Elbera Tools are available as repository source. Existing standalone
release kits and README screenshots remain unchanged; this arithmetic and
extraction milestone adds no new visual layout.
