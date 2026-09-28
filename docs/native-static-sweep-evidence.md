# Original static collision records and sweep preparation

The browser now prepares a nonzero-extent static-mesh query using the original
cached WorldToLocal matrix and source arithmetic order. **800 finite cases**
match retained Engine/Core instructions bit for bit. Elbera Tools also preserves
the original collision planes, tree links and bounds instead of rebuilding them
from the rendered mesh.

This component does not yet return a collision result. The separate
[triangle component](native-static-triangle-evidence.md) now preserves original
world preparation and clipping. The subsequent
[mesh component](native-static-mesh-evidence.md) joins tree traversal and final
hits with explicit material responses. Current actor/cache lifetime and live
walking remain unfinished. The existing world scene and legacy ray picker are
unchanged.

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
python3 -m unittest discover -s tools/world -p test_prop_identity.py
```

Eleven browser cases cover rounding, signed zero, exact-zero adjustment,
nonzero small deltas, negative scale, composing source matrices and explicit
failure boundaries. Four interpreter cases cover integer flags, partial status
writes, unknown calls and bounded execution. Thirty-seven exporter/record tests
cover source framing, qualification and round trips, including both saved boxes,
licensee tail gates, signed versions, opaque lazy spans and exact export ends.
The fifteen prop-reader/repair cases include extended indices, Boolean framing
and bounded truncation. CI runs all four sets. Twelve terrain-collision and
twelve terrain-zone cases also pass with the shared reader change.

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

### Ordered saved properties

The shared map reader now preserves all original one-, two- and four-byte array
indices. Previously it consumed extended indices but returned zero, which could
misidentify an array element as a scalar property. It also now reads Boolean
values directly from the tag high bit without consuming value bytes. The size
selector is still decoded and retained; it does not create a Boolean payload.
Static-actor audits bound each stream to its own export, preventing truncated
properties from borrowing the next export's bytes.

The existing record checker adds `savedProperties` to each private receipt. It
retains ordered tag identities, indices, sizes, Boolean values and payload
hashes, with a hash of the complete tag span. Duplicate names and native header
names stay visible even when the generic mesh decoder's dictionary collapses
them. Both decoders must finish at the mesh's recovered native-body offset.
That comparison checks framing; it is not execution of native property loading.

On the supplied maps, all **480 per-map mesh records** have saved export flags
`0x000f0004`, no duplicate tag names and no tags for `ObjectInternal`,
`ObjectFlags`, `Outer`, `Name` or `Class`. Their mesh property array indices are
zero. The **2,922 static-actor audit records** are unchanged by the reader fix:
their **7,523 Boolean tags** already have saved size zero, and none of their
array indices use an extended encoding. These findings do not explain existing
placement defects. `savedExportFlags` remains saved metadata, not a substitute
for current resource flags or the original construction/loading chain.

The sweep payload now also retains the qualified `sourceClass` and compact
`savedProperties` metadata (saved flags and ordered name/type/index/struct
identities). This feeds [fresh browser resource preparation](native-static-actor-bounds-evidence.md#fresh-resource-preparation).
That entry uses recovered loading transitions with explicit current class
state; it does not turn the saved export flags directly into live flags.
The record checker cross-checks these added fields against the original export.

The same read-only record command below reproduces the census summary; omit
`--check` for private per-tag evidence. No assets or scenes are rewritten. The
reader and checker remain Elbera repository tools, outside the current standalone
release archives. The fresh-preparation entry changes the browser component;
the main-world loader and visual layout remain unchanged.

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

### Saved mesh bounds

Each mesh now also retains `nativeBodyOffset`, `baseSerializedBounds` and
`savedLocalBounds`. Each box contains `min`, `max`, the original `valid` byte,
`sourceOffset`, `sourceBytes: 25` and `sourceSHA256` for the exact decoded-package
span. Coordinates must be finite; signed zero and every validity-byte value
are retained. No normalization, vertex-derived replacement or validity repair
is performed.

The loader first serializes UPrimitive's box at mesh `+0x34`, followed by its
16-byte sphere. After the compact-counted 14-byte sections, UStaticMesh writes
another box to **the same field**. `savedLocalBounds` is this later saved value.
The former parser's “saved render bounds” comment did not distinguish that
overwrite. Default ray output still consumes neither box; complete sorted JSON output
matches the previous exporter exactly for both checked maps.

The record checker independently recovers both offsets from the native-body
start and section count, re-encodes all coordinates/validity and checks the
original bytes and SHA-256. It rejects shifted spans, changed values, hashes,
validity and signed-zero loss. Original export boundaries prevent a truncated
record from borrowing bytes from the next object.

Both records match each other for all 193 checked meshes on `17_25` and all
287 on `22_22`: **960 box records across 480 per-map mesh records**. These are
not necessarily 480 globally distinct meshes. Choosing between the two boxes
therefore does not explain a sizing difference in this checked subset.
The source distinction still matters for correct extraction and other inputs.

A separately qualified PostLoad block checks the signed field at `+0x1dc`
against eight and invokes `UStaticMesh.Build` when it is lower. The tail recovery
below now establishes a saved value of eight for all 480 checked mesh records.
The [bounded PostLoad check](native-static-actor-bounds-evidence.md#bounded-postload-path)
preserves the box under explicit current-state conditions. It does not prove
those conditions for live objects. **Saved bounds are not yet live current bounds.**
The [runtime static-box helper](native-static-actor-bounds-evidence.md) still
requires the current mesh field and owner state.

### Saved load tail

The optional source output also contains `loadTail`: exact span/hash, `fields`
keyed by native field offset, and `lazyArray1c4`. File version 123 is required.
The decoder follows the original licensee gates at 6, 7, 11, 13, 14 and 15,
preserves compact object-reference indices, and seeks the lazy array's absolute
saved end before reading `+0x1dc`, `+0x1f0` and `+0x1e0`. It must finish exactly
at the original export end. Truncation, invalid ends, trailing bytes and
noncanonical reference encodings are rejected.

`+0x1dc` is retained as a signed 32-bit version; unknown four-byte fields remain
unsigned words so every bit survives without assigning an unsupported meaning.
References are saved indices, not resolved pointers. `lazyArray1c4` records its
header, saved end and opaque payload spans/hashes. It does **not** report a
triangle count or claim to decode that payload's elements.

The record checker re-encodes the declared fields, verifies the original lazy
header and hashes the opaque span. It derives the tail start from the checked
collision arrays and requires the source export's exact end. Both maps retain
their previous admitted geometry counts, and `savedMeshVersions` reports
`8: 193` for `17_25` and `8: 287` for `22_22`. These are saved-state observations,
not evidence that native loading, callbacks or PostLoad ran in the browser.

This mode uses exclusive creation and never changes a scene or legacy ray
sidecar. It cannot be combined with `--emit`, `--audit` or `--references-only`.
`--all-supported` explicitly selects the existing conservative actor/material
subset; an explicit actor list cannot silently produce a partial selection.
Legacy combined placement scales are deliberately absent from this format.
Current matrices and owner/material callbacks remain separate required state.

**Generated files contain private original-derived data.** Do not commit them,
include them in public tool archives or treat them as observed live actor state.

A read-only checker freshly decodes the maps, re-encodes each admitted triangle
and node array, both saved boxes and the decoded load-tail fields. It compares
their original bytes and separately checks the opaque tail payload's hash,
including compact indices and lazy saved-end framing:

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

`serializers.packedPropertyTags` binds the shared reader to the pinned Core
inputs listed below. Eight exact code/data regions include the tag operator
(`10132f10..10133161`, all normal returns), its two size-selector tables, the
tagged-property caller (`101346e0..10134cd8`), value application
(`10131090..10131137`) and byte/word/dword archive helpers. Five exact thunks
and seventeen instruction checks bind the calls, index masks/byte order and
Boolean class identity. The two-byte index is high-seven-bits then low byte;
the four-byte form is high-six-bits followed by three bytes in descending
significance. Boolean application sets or clears the declared mask from the
tag bit without calling a payload serializer.

These checks establish retained framing behavior. Arbitrary compatibility
conversions, archive callbacks, class initialization, malformed streams and
current object flags are outside this claim. Supplemental byte correspondence
does not authenticate a distribution or restore the protected client runtime.

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

The same command now includes `serializers.boundsLoader`, qualifying eight
additional Engine regions for the file-123 prefix and its serializers:

| Region | Owned range, exclusive end |
| --- | --- |
| UPrimitive normal serializer | `10645831..10645878` |
| UStaticMesh prefix through second box | `106f7aa1..106f7b0f` |
| Sphere serializer, both version branches | `105e98f0..105e9968` |
| Section-array normal serializer | `106f7931..106f7a03` |
| Section version branches | `103ec2fa..103ec315`, `103ec39f..103ec3ae` |
| Section file-112-and-later fields | `103ec4dd..103ec54c` |
| PostLoad Build gate only | `106f6197..106f61a7` |

Named exports and direct thunks bind the serializer chain. Erased calls are
matched to named Core imports; the four-byte `FArchive.Ver` getter at
`10108b80..10108b84` is compared byte for byte. The section branch serializes
one four-byte field and five two-byte fields. File123 selects that branch and
the four-component sphere branch. The existing FBox serializer establishes six
four-byte coordinates and one validity byte. These are static code bindings;
archive I/O, allocation and legacy file versions remain outside this proof.

`serializers.loadTail` adds ten Engine regions and seven byte-identical Core
bodies. It binds the licensee/version gates, three four-byte serializers, two
reference helpers and the lazy load/end-seek path. The ULinkerLoad **FArchive
subobject** vtable binds reference slot `+0x18` to its object operator and seek
slot `+0x3c` to its protected `Seek` method. The object operator reads a compact
index from `GetReader` before `IndexToObject`; Seek forwards to the same reader's
seek slot. `Ver`, `LicenseeVer`, `IsLoading` and `IsSaving` getters are matched
individually. All region addresses, source hashes and allowed import/operand
correspondences are in the private receipt.

This is static framing evidence. Reader selection, reference resolution,
lazy callbacks, archive I/O and the raw lazy elements are not executed. The
separate [bounds checker](native-static-actor-bounds-evidence.md#bounded-postload-path)
interprets the admitted version-eight-and-later PostLoad path; older conversion
and Build remain outside its scope.

All four binary inputs must match the fingerprints in the
[actor-transform evidence](native-actor-transforms-evidence.md#source-bindings-and-edition).
A different edition is rejected. Supplemental correspondence does not
authenticate the archive, restore the owned imports or observe a live client.

These Elbera Tools are available as repository source. Existing standalone
release kits and README screenshots remain unchanged; this arithmetic and
extraction milestone adds no new visual layout.
