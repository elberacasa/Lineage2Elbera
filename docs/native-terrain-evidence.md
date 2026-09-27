# Native Interlude terrain evidence

This records static evidence recovered from the owner's original Interlude
`system/engine.dll`. It establishes the bitmap indexing, diagonal selection,
runtime outer-row visibility and neighboring terrain-edge directions below.
It is not a claim that the whole browser terrain renderer matches the native
client. The private executable and recovered executable bytes are not included.

The reviewed input has SHA-256
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`.
Its PE image base is `0x10300000`. The first file-backed section has RVA and
raw-file offset `0x1000`, length `0x1a98000`, ending at exclusive `0x1a99000`.
Addresses below are RVAs unless explicitly labeled VA.

**Recovery and identity.** The raw PE export names, ordinals and function table
remain readable. The exported UTF-16 name sentinel
`?__FUNC_NAME__@?2??IsTriangleAll@UTerrainSector@@QAEHHHHHHE@Z@4QBGB`
points to RVA `0x5ebcb4`. Subtracting the little-endian DWORD encoding of `UT`
(`0x00540055`) from the first stored DWORD, modulo 2^32, yields `0x7965b551`.
Subtract that key from each aligned little-endian DWORD in the section above.
The complete sentinel becomes `UTerrainSector::IsTriangleAll` plus its null
terminator. This checks more than a two-character guess.

The named function exports point to decoded `E9 rel32` stubs. Their targets
are `stubRVA + 5 + signedRel32`. Resolving each through the PE section table
identifies the bodies independently of an arbitrary disassembly start.
[terrain_topology.py](../tools/world/terrain_topology.py) binds the source hash,
sentinel, export targets, lengths and decoded-body hashes to this single build.
A missing or different engine does not receive this proof.

| Named method | Export stub RVA | Body RVA | Reviewed operation |
| --- | --- | --- | --- |
| `GetEdgeTurnBitmap` | `0xb2e9` | `0x78460` | Current bitmap lookup |
| `GetEdgeTurnBitmapOrig` | `0xbb4f` | `0x78590` | Original bitmap lookup |
| `GetQuadVisibilityBitmap` | `0xfde4` | `0x783c0` | Current visibility lookup |
| `GetQuadVisibilityBitmapOrig` | `0x109f1` | `0x78540` | Original visibility lookup |
| `TriangulateLayer` | `0x98b8` | `0x428070` | Visibility and both diagonal branches |
| `GenerateCompleteIndexBuffer` | `0x4f52` | `0x4285a0` | Independent index-emission branches |
| `PostLoad` on TerrainInfo | Resolved by helper | `0x42ded0` | Copy current arrays; force outer visibility |
| `Serialize` on TerrainSector | Resolved by helper | `0x430fe0` | Runtime versus serialized sector counts |
| `UpdateVTGroup` | Resolved by helper | `0x42b680` | Separate appended row and column |
| `SetVertiEdge` | `0x6852` | `0x4275c0` | Positive-X neighbor's first column |
| `SetHoriEdge` | `0x139c1` | `0x427990` | Positive-Y neighbor's first row |
| `SetEndVertexZ` | `0x4403` | `0x427db0` | Positive-X/positive-Y neighbor's first vertex |

**Bitmap and triangle rules.** The four getters calculate
`index = y * HeightmapX + x`, use word `index >> 5`, and test
`1 << (index & 31)`. They return 0 or 1. The relevant TerrainInfo fields are
current visibility `+0x219c`, current edge-turn `+0x21a8`, original visibility
`+0x225c`, and original edge-turn `+0x2268`.

For a quad let `a=(x,y)`, `b=(x+1,y)`, `c=(x,y+1)`, and `d=(x+1,y+1)`.
`GenerateCompleteIndexBuffer` calculates these four indices using the sector
row stride `quadsX+1`. Its nonzero branch at `0x428675` emits
`(a,c,b),(c,d,b)`: the shared diagonal is **b-c**. The zero branch beginning
`0x428704` emits `(a,c,d),(a,d,b)`: the diagonal is **a-d**.
`TriangulateLayer` independently uses the same branches at `0x4281da`, after
testing quad visibility at `0x42815a`. Layer coverage supplies additional
material-specific filtering; edge-turn alone does not establish layer blending.

The seamless, non-editor branch reads the **Orig** getters. This does not mean
the original arrays serialized in the map can simply be trusted unchanged:
`PostLoad` first replaces them with the current arrays.

The selector names are identified separately from those terrain branches.
The pointer slot at **VA `0x11d8dc0c`** is read by the command handler at
RVA `0x2b572d`, whose decoded UTF-16 argument is `SEAMLESS` (RVA `0x5cb0b8`).
Its `ON` branch at `0x2b5768` writes 1 through that slot at
`0x2b57a0–0x2b57a6`; the corresponding `OFF` branch writes 0. The editor
pointer slot is **VA `0x11d8dbe4`**. The original `ULevel::ToFloor` check at
`0x2cada9` uses it and passes the decoded assertion text `GIsEditor`
(ANSI at RVA `0x5d0024`) on failure. A second check at `0x3745da` uses the same
slot in the assertion `GIsEditor || GIsOpenGL` (ANSI at `0x5ddcf4`). These
identify the two conditions used by Serialize and TriangulateLayer; their
names were not inferred from the desired terrain behavior.

At `0x42e3a2–0x42e3b5`, PostLoad copies current visibility into Orig. It then
sets the high bit of each eighth DWORD at `0x42e3c7–0x42e3df`, marking x=255
visible on a 256-wide map. At `0x42e3e5–0x42e413`, it makes every DWORD in the
last row all ones, marking y=255 visible. **Both current and Orig visibility
are changed.** At `0x42e44b–0x42e45e`, it copies current edge-turn into Orig.
Consequently, runtime boundary visibility cannot be inferred solely from the
serialized outer visibility bits.

A read-only audit of all 100 converted source maps checked 6,502,500 ordinary
quads: every current visibility bit agreed, including 52,249 hidden quads.
Serialized Orig visibility differs only on `22_19` (430 bits). Serialized Orig
edge-turn differs on `16_25` (53 bits) and `22_19` (14 bits). PostLoad's copy is
therefore material to both rules. Across all 6,553,600 bitmap positions, 482,219
edge-turn bits are set and 6,071,381 are clear. SHA-256 of sorted lines
`<tile> <rawMapSHA256>\n` is
`04d9b83dddcd6fcf6c3794cae0e4d9680b8858f5b3cdc33cb513331cd1537695`.

**Source positions and seams.** In Sector Serialize at `0x4314d5–0x43152c`,
the runtime keeps the original sector quad counts separately at `+0xd4/+0xd8`.
For the seamless non-editor path, outer sectors beginning at offset 240 retain
15 source quads there, while active `+0x6c/+0x70` become 16. The alternate path
reduces an outer 16 to 15. This explains why stored sector bounds ending at
source sample 255 do not describe the final seamless runtime boundary.

`UpdateVTGroup` copies the original vertex positions. For the outer horizontal
group, `0x42b835–0x42b86b` appends a seventeenth vertex with x increased by 128,
preserving the preceding vertex's y and initial z. It does not move that
preceding vertex. `0x42b931–0x42b96f` similarly appends a row with y increased
by 128. Both use the **64-bit floating-point** constant at VA `0x108dd7a0`
(RVA `0x5dd7a0`), which decodes to `128.0`.

Thus source index 255 stays at offset 32640 L2 units; the new index 256 lies at
32768, a separate 128-unit interval. Stretching sample 255 onto 32768 loses an
original sample position and does not reproduce this routine.

The following native routines then replace appended z values from neighbors:

| Routine | Required neighbor tile coordinates | Source z copied |
| --- | --- | --- |
| `SetVertiEdge` | `(tileX+1,tileY)` | First column: vertex `y*256`, stride `0xc00` bytes in the native 12-byte position array |
| `SetHoriEdge` | `(tileX,tileY+1)` | First row: vertex `x`, stride 12 bytes |
| `SetEndVertexZ` | `(tileX+1,tileY+1)` | Vertex 0 |

The coordinate checks occur at `0x4275f5–0x427619`, `0x4279cb–0x4279ef`,
and `0x427de8–0x427e0f`. The z copies are visible at
`0x427726–0x427740`, `0x427b56–0x427b63`, and `0x427ede–0x427ee7`.
These methods also update lighting/layer-related data. Copying only z does
not establish fidelity of those other seam attributes.

The native initialization initially repeats the preceding z until a neighbor
overwrites it. The browser's conservative policy of leaving an unavailable
source edge null is a separate decision; it must not be described as proof of
the native client's missing-neighbor appearance.

The UpdateVTGroup call in PostLoad is at `0x42e19b`. All 24 inspected calls
to the three seam setters are inside `UGameEngine::AdjustTerrain`, body
`0x29beb0`. That routine looks up and loads neighbor levels before copying
their edges; a missing required lookup can exit through `0x29c1cc`. This
supports the initialization/attachment order, but does not establish which
sectors are presented during every missing or loading state.

**Native heights and saved coordinates.** The original `system/Core.dll` has
SHA-256 `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf`
and PE image base `0x10100000`. This file's reviewed code is readable without
the Engine subtraction step. Its export
`?TransformPointBy@FVector@@QBE?AV1@ABVFCoords@@@Z` jumps from RVA `0x185c`
to `0xf640`. That 26-byte wrapper has SHA-256
`95f532cf17345f44df7ef299a305de2bed2c0f4bc06266600d20f0453edf8253`.
Its call at `0xf64c` reaches stub `0x1424`, which jumps to `0xf510`.
The 116-byte arithmetic body has SHA-256
`f9a73d1fb5de8cabc076375ac31d19270dfa5280f1d710024838e4d26b2b06e7`.
It subtracts the FCoords origin from the point, takes dot products with the
three axes, and stores the final x, y and z as float32 at
`0xf579`, `0xf57b`, and `0xf57e`. Intermediate subtraction and arithmetic
stay in x87 registers; rounding the subtraction to float32 first is not the
observed operation.

Engine `CalcCoords` at `0x4194a0` builds the z axis from TerrainScale.Z / 256,
with a float32 store, and an initial origin from
`-256 * Location.Z / TerrainScale.Z`, also with a float32 store. The center
constant at RVA `0x5eb380` is **32767.0**, not 32768.0. The supporting double
constants at `0x5b3060` and `0x5eb388` are 1/256 and -256. The relevant Core
FCoords vector `/=` export, `??_0FCoords@@QAEAAV0@ABVFVector@@@Z`, resolves
from `0x4638` to `0x10600`; it adds to each origin component and stores each
sum as float32. Its 33-byte body has SHA-256
`7641277a462918509ace6c8d124dc2c3e0425de65ed70f997ee6a9c2dc662b66`.
Because the Engine import call itself is erased, the saved matrix and the
independent bounds comparison below are essential evidence, rather than
inferring the complete transform from this center constant alone.

TerrainInfo `Serialize` at `0x439cf0` stores the forward FCoords at `+0x212c`
and inverse at `+0x215c` (`0x439ddf–0x439dfc`). In the investigated maps the
forward matrix follows 256 compact sector references and two int32 sector
counts. It consists of twelve float32 values: origin, x axis, y axis, z axis.
The complete serializer has no later reference to vertex array `+0x2100`:
that array is serialized only in its legacy branch below version 17. The
protected version getter is erased, so its precise version-field identity
is not asserted here; the inspected maps' file/licensee versions are 123/30,
both above that threshold. `UpdateVertices` at `0x420900` reads unsigned G16
values and transforms them through `HeightmapToWorld` at `0x64ee0`.

For the reviewed axis-aligned matrix, the exact z operation is
`float32((unsignedG16 - savedOriginZ) * savedAxisZ)`. In the five maps below,
the serialized z origin is 32225.859375 and z axis is 0.296875. These are read
from each source map, not hardcoded as universal terrain constants.

The independent check is the native saved sector bounds. `CalcLocation` at
`0x428930` samples only the four sector corners, then unions those four
positions into its box at `0x428bc4–0x428bf3`. Taking extrema over every
interior height is therefore an incorrect oracle. Two independent inspections
repeated the four-corner comparison against each source sector's saved z
minimum and maximum:

| Source tile | Saved z bounds | Exact with old 32768 formula | Exact with simple 32767 formula | Exact with saved FCoords |
| --- | ---: | ---: | ---: | ---: |
| `17_25` | 512 | 0 | 246 | 512 |
| `22_22` | 512 | 0 | 53 | 512 |
| `24_18` | 512 | 0 | 97 | 512 |
| `16_25` | 512 | 0 | 244 | 512 |
| `22_19` | 512 | 0 | 0 | 512 |

The old formula misses by up to 0.296875 L2 units. Changing only the bias to
32767 still misses by up to 0.000244140625 because it omits native coordinate
rounding. Saved FCoords matches all 2,560 tested z bounds bit for bit.
`native_height_transform` in the same Python module additionally checks all
six bounds per sector, original sample positions, dimensions and source DLL
identities before returning per-map transform evidence. This supports these
ordinary source vertices; it is not a whole-renderer visual comparison.

The subsequent read-only audit across the same 100 maps accepted 98 maps:
150,528 of 150,528 XYZ bounds matched exactly, including XY source samples
0/255 and the separate sample-256 extension. The remaining maps are withheld
from this strict gate. `17_22` has six sectors with different saved Z extrema
(largest difference 13.359375 L2 units); `22_21` has one at quad offset
`(240,80)` with a 440.5625-unit maximum-Z difference. Both have correct XY and
declare the expected `T_<tile>.<tile>` TerrainMap. Their source bytes are
preserved. Stale saved bounds or mismatched original input revisions remain
possible explanations; the audit does not choose one. GenerateTriangles calls
CalcLocation at `0x42dbb1`, so saved bounds alone are not proof of what a fresh
native render would show there.

The exporter checks each declared TerrainMap against the exact extracted G16
texture. Each accepted transform retains the saved 48-byte FCoords digest,
source map digest, engine identities and a digest of the verified bounds.
The browser verifies these records and uses the saved float32 Z origin/axis;
it never rewrites G16 or shifts original XY samples. Unknown transforms keep
the explicitly provisional compatibility path.

**Reproduce the identity gate without writing recovered binaries.** From the
repository root with the private input staged locally:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY'
import json
import sys
sys.path[:0] = ['tools', 'tools/world']
from terrain_topology import native_engine_evidence
proof = native_engine_evidence('assets/interlude/system/engine.dll')
if proof is None:
    raise SystemExit('Missing or unreviewed engine; native proof unavailable')
print(json.dumps(proof, indent=2))
PY
```

The returned record contains only provenance, decoder parameters, reviewed
method identities and hashes. The helper decodes in memory, validates ten
method bodies, and neither executes the DLL nor writes decoded bytes. The
table also includes two directly inspected visibility getters whose bodies
are not separate entries in that ten-method digest list. This helper is a
reproducible identity check for the reviewed disassembly, not an automatic
proof of arbitrary machine-code semantics.

**Local activation and reproduction.** The checked local input set now has
91 of 100 converted scenes using the verified topology, saved FCoords and
available adjacent source samples. The closure includes 134 source tiles:
118 pass the height gate, 12 are absent, and four fail saved-bound agreement
(`17_22`, `22_21`, `24_25`, `24_26`). The latter two are adjacent inputs outside
the converted set. A scene is withheld if its own source or a present required
neighbor fails the gate. These nine scenes remain unchanged on the provisional
compatibility path: `16_21`, `17_21`, `17_22`, `21_20`, `21_21`, `22_20`,
`22_21`, `23_24`, `23_25`. Nineteen absent edge directions remain null; no
heights are extrapolated into those gaps.

Only `scene.json` metadata pointers and the two terrain sidecars were updated.
The local ignored receipt is
`tmp/native-world-migration-20260926-104638/receipt.json`, with metadata backups
under its sibling `backup/` directory. It records the eligible/excluded list,
source closure, missing directions, before/after file hashes and validation.
All 200 raw heightmap U16/PNG files across the 100 scenes were unchanged;
excluded metadata was also unchanged. The 100-map source catalog, formed as
sorted `<tile> <SHA256>\n` lines, has SHA256
`04d9b83dddcd6fcf6c3794cae0e4d9680b8858f5b3cdc33cb513331cd1537695`.
These local assets and receipts are not public repository content.

The supported checked-in update commands are the existing converter's
`--edges-only` and `--topology-only` modes. Both accept multiple explicit tile
arguments and preserve raw height files. For example, to regenerate the three
review checkpoints from the exact reviewed private inputs:

```sh
python3 tools/world/convert.py --edges-only 17_25 22_22 24_18
python3 tools/world/convert.py --topology-only 17_25 22_22 24_18
```

To repeat the full local selection, pass the receipt's 91 `eligible` entries
to each command (as separate arguments). Recheck the source catalog and binary
identities, retain metadata backups, and compare raw-file hashes before and
after. A different source set needs a new per-map/neighbor gate audit; the
91-scene selection is not a universal map allowlist.

The real browser surface loader accepted all 91 generated metadata sets. The
CPU geometry check covered 6,008,144 finite vertices and 11,824,218 triangles
with valid indices and upward winding. Five representative scenes (`16_25`,
`17_25`, `22_19`, `22_22`, `24_18`) also produced identical main/neighbor mesh
buffers; 320 ground queries agreed with independently interpolated rendered
triangles within 0.019623 L2 units. This checks the activated geometry path,
not material or lighting parity. Focused regression commands are:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/world -p 'test_terrain_*.py'
node --test editor/world/test/terrain-surface.test.mjs
node --test tools/world/test_surface_integration.mjs
```

**Limits.** Static inspection was independently repeated from the original
file using PE exports and an x86 disassembler. Some protected import call
sites decode to NOPs; the result is not a restored executable and was not run
as the original game. Branching, index arithmetic, field copies and floating
point operations described above remain readable. This evidence does not
validate all original startup flags or every rendering mode.

Neighbor routines copy already-transformed native float32 world z, not raw
G16 words. The saved-coordinate check above establishes source heights for
the accepted maps; other transforms or different client builds need separate
evidence and must not silently inherit it.
Terrain lighting, normals, layer blending, time-of-day behavior, streaming
order and visual parity require their own source evidence and browser checks.
