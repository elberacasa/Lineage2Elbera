# Original static triangle preparation and clipping

The browser now preserves original static-mesh triangle preparation and
nonzero-extent clipping, including cache validity, negative-scale winding,
plane construction and interval writes. **5,200 comparisons** check the actual
JavaScript module against retained original Engine/Core instructions. Of these,
**500 compose scratch initialization, world geometry and clipping**.

This is a collision component, not a complete mesh sweep or gameplay route.
Whole-mesh traversal, material callbacks, current actor/cache lifetime, spatial
admission and walking remain unfinished. Existing scene rendering is unchanged.

## Browser contract

`editor/world/js/static-triangle.js` provides three pure operations:

| Operation | Required source inputs | Ready output |
| --- | --- | --- |
| `prepareStaticTriangle(input)` | Selected original triangle and consumed cache/matrix/vertex fields | World vertices, world plane and sparse cache writes |
| `createStaticTriangleClipState(maxTime)` | Current caller-owned closest result time | Original initial interval, normal and found flag |
| `clipStaticTriangle(input)` | World geometry, query vectors and current clipping state | Helper return and updated clipping state |

Geometry uses **native units and axis order**. Numerical inputs are dense
ordinary arrays of exact finite Float32 values. Both arithmetic operations
require `arithmeticProfile: "pc53-rne-math-sqrt"`. This names the admitted
PC53/RNE calculation and positive mathematical square-root boundary; it does
not claim that the live client's FPU or CRT has been observed.

All returned records/vectors are frozen. Inputs are unchanged. Missing consumed
state or arithmetic outside the supported domain returns `status: "unsupported"`
with a reason; it must not become a clear collision result.

### Preparing one original triangle

```js
prepareStaticTriangle({
  arithmeticProfile: "pc53-rne-math-sqrt",
  triangleIndex,
  indices,
  vertices,
  vertexCache,
  planeCache,
  localToWorld,
  determinant,
  ownerStatic,
});
```

The caller selects the same triangle and its plane-cache entry. `triangleIndex`
must be in the original unsigned-WORD domain, 0–65,535; higher indices are
explicitly unsupported. `indices` contains three nonnegative original vertex
indices. Each referenced `vertexCache` record supplies its DWORD `valid` value;
each valid record also supplies `point: [x, y, z]`. `planeCache` supplies `valid`
and, when valid, `plane: [x, y, z, w]`.

Only consumed source fields are required. A cold vertex needs its original
position in `vertices`, the cached row-major 16-value `localToWorld` matrix and
the actual boolean `ownerStatic` field. A cold plane also needs `ownerStatic`.
Fully warm records do not require a matrix or source vertex array. The current
cached `determinant` is always required. Neither a renderer inverse nor a guessed
identity matrix substitutes for this state. The
[source actor-transform component](native-actor-transforms-evidence.md) can
derive matrices from explicit original actor fields and a qualified sine table.

The ready result includes `worldVertices`, `worldPlane`, `triangleIndex`, and
`writes`. `writes.vertices` contains only touched records as `{index, record}`;
`writes.plane` is present only when the plane was computed. Applying those
writes and managing the cache are caller responsibilities.

Source behavior retained by the component:

- Cold record validity becomes the original owner's `bStatic` value. A moving
  owner's records remain invalid and are recomputed on later reads. Warm
  nonzero validity values are preserved.
- Vertex transformation sums Y, X, Z and translation in source order, storing
  each result as Float32. Plane construction receives vertices **2, 1, 0**.
- The named Core `SafeNormal` stores the squared length, square root,
  reciprocal and products at the original Float32 boundaries. Its original
  Float64 threshold is `1e-8`; the below-threshold branch produces zero.
- A negative determinant flips a newly computed plane and reverses the final
  first/third vertices. A warm plane is consumed unchanged.

Returned sparse writes represent final record values, not cache-access events.
Native memory-cache paging, allocation, invalidation and owner lifetime are not
implemented here. Supplied warm records are not silently repaired.

### Scratch state and clipping

```js
const scratch = createStaticTriangleClipState(currentResultTime);
// After checking both preparation and scratch are ready:
const interval = clipStaticTriangle({
  arithmeticProfile: "pc53-rne-math-sqrt",
  worldVertices,
  worldPlane,
  start, end, extent,
  initialClipState: scratch.clipState,
});
```

The original scratch constructor initializes **entry = −1**, the normal to
zero, and `found = 0`. Exit comes from the current caller's result time; the
factory neither assumes one nor clamps it. Signed zero is retained.

`extent` must be nonnegative with at least one nonzero axis. The all-zero path
is separate. `initialClipState` requires finite `entry` and `exit`; `normal`
and `found` may remain absent because this stage only writes them. Known normal
values must be a three-value vector; a known flag must be a DWORD.

The clipper follows the original order: six box planes, both orientations of
the triangle plane, then the three edges against each nonparallel box axis.
The edge path calls the source `UnsafeNormal`, whose rounding differs from
the plane constructor's `SafeNormal`. No shared fallback normal is introduced.
The original plane direction threshold is `±9.999999747378752e-6`, recovered
from the source qwords, not a browser tolerance.

The ready result contains `keep` and `clipState`. **`keep` is an interval-helper
return, not an adopted collision hit.** Earlier writes survive a later rejection;
strict interval and entry comparisons preserve source ties. The original tree
also checks `found`, selects a closest result and resolves its material. Those
operations and the outer hit adjustment remain separate work.

## Reproducible verification

Portable authored fixtures require no game files. The Python fixtures require
Capstone; CI installs the pinned version used by the other original-code tools.

```sh
node --test editor/world/test/static-triangle.test.mjs
python3 -m unittest discover -s tools/ui -p test_static_triangle_native.py
```

Seventeen browser tests cover interval ties, tangency, rejected writes, warm and
cold caches, negative scale, source zero normals, signed zero, immutable outputs
and explicit unknowns. Six interpreter tests cover float sign-bit clearing,
unsigned-WORD loads, integer carry, the bounded square-root call and refusing
unqualified calls or absent loaded mesh data.

The original-input comparison reads owned Engine.dll/Core.dll and requires
explicit independently pinned comparison inputs:

```sh
python3 tools/ui/check_static_triangle_native.py --check \
  --comparison-engine /local/supplemental/engine.dll \
  --comparison-core /local/supplemental/Core.dll
```

Use `--engine`, `--core` and `--runtime-module` for other explicit local paths.
Omit `--check` for a full JSON receipt on stdout. No DLL is loaded or executed;
no game asset, disassembly or recovered binary is emitted. Receipts contain
source-block fingerprints, instruction coverage and actual module/tool hashes.

| Browser comparisons | Cases | Coverage |
| --- | ---: | --- |
| Original scratch initialization | 600 | Explicit time, signed zero and copied native query vectors |
| World geometry and cache preparation | 1,600 | Cold/warm/dynamic records, source normalization and handedness |
| Triangle clipping | 3,000 | Bounds, plane/edge order, retained/rejected intervals and exact ties |
| Included composed cases | 500 | Original scratch plus complete triangle function against joined browser operations |

These are authored arithmetic/state inputs, not original map geometry or
observed live actor states. The checker interprets original instructions for
its expected results; it does not use a second copy of the browser formulas.
The loaded-triangle getter boundary executes the original pointer calculation
over an explicitly supplied backing array. Native paging is not simulated.

The current run interprets **4,986,300 instructions across 1,508 addresses**.
Separate deliberate mutations are rejected for zero initial entry, omitted
negative-scale plane reversal, a non-strict interval test and removed square-root
rounding. These checks guard against plausible shortcuts, not just invalid input.

Other precision/rounding profiles, native CRT behavior, floating-point exceptions
and extended-exponent edge behavior remain outside this finite comparison.

## Source qualification and edition

The four input fingerprints are the pinned Interlude images listed in the
[actor-transform evidence](native-actor-transforms-evidence.md#source-bindings-and-edition).
Different binaries are rejected. This identifies the investigated edition;
supplemental correspondence neither authenticates its archive nor repairs
protected imports in the owned copy.

`tools/ui/static_triangle_source.py` qualifies seven bounded Engine regions
and six named Core bodies, including these entry points:

| Original operation | Owned address range, end exclusive |
| --- | --- |
| Scratch constructor | `106fe2c0`–`106fe33d` |
| Plane interval | `106ff1c0`–`106ff30d` |
| Box planes | `106ffcb0`–`106ffddc` |
| Edge plane | `106ffe30`–`106fff37` |
| Loaded triangle pointer | `106ff716`–`106ff71e` |
| World preparation | `10701c30`–`10702223` |
| Triangle clipping | `10702223`–`107025b5` |
| Core three-point FPlane | `1010d560`–`1010d6e4` |
| Core SafeNormal | `1014e070`–`1014e0f9` |
| Core UnsafeNormal | `1010ccb0`–`1010cd07` |

Engine comparison bodies are at the owned address minus `0x40`. Only eight
declared, independently named erased import sites and same-target direct calls
are normalized. The remaining bytes agree. Core bodies and consumed numerical
constants match exactly; named thunks/call sites bind the interpreted helpers.

These Elbera Tools are available as repository source. Existing standalone
archives remain unchanged. This arithmetic milestone introduces no visual
layout and therefore no new screenshot; the README gallery is preserved.
