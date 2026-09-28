# Original terrain extent sweep

Elbera Tools now exposes the ordinary, finite **current-coordinate, nonzero
extent, no-owner** path of Interlude `ATerrainInfo::LineCheck` and
`LineCheckWithQuad`. It accepts prepared native vertex values and current
bitmaps. It does not obtain collision geometry from a rendered mesh or from
browser walk heights.

This is a terrain primitive milestone. Loaded-level admission, terrain-zone
lists, region rejection, actor state, world hit aggregation, and walking or
camera integration remain separate work. A primitive miss does not mean the
world is clear.

## Files and reproducible checks

- [Runtime](../editor/world/js/terrain-collision.js) and
  [portable tests](../editor/world/test/terrain-collision.test.mjs).
- [Native arithmetic verifier](../tools/ui/check_terrain_collision_native.py).
- [Source input exporter](../tools/world/export_terrain_collision.py) and
  [input provenance](native-terrain-collision-inputs.md).
- Earlier [terrain serialization and topology evidence](native-terrain-evidence.md).

Portable tests require Node, without client inputs:

```sh
node --test editor/world/test/terrain-collision.test.mjs
```

Native verification requires the pinned private original files, Python with
Capstone, and Node. It reads bytes without executing or emitting native DLLs:

```sh
python3 tools/ui/check_terrain_collision_native.py --check
python3 tools/ui/check_terrain_collision_native.py --check \
  --comparison-engine /private/comparison/engine.dll \
  --comparison-core /private/comparison/Core.dll
```

Owned-only mode checks retained instructions and reports the erased Engine
helper identities as **conditional**. The optional comparison checks every
byte of eight selected blocks, permitting only explicitly checked import,
call-target, handler-entry and data-operand correspondences. It qualifies the
specific named imports; it does not authenticate the supplemental distribution
or restore calls in the owned image.

| Input | SHA-256 |
| --- | --- |
| Owned Engine | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Owned Core | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| Optional comparison Engine | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |
| Optional comparison Core | `d83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639` |

The checkpoint has **15 portable tests** and **100 synthetic actual-module
comparisons**, exercising 2,165 retained instruction addresses. The comparison
covers exact Float32 bits of final point, normal and time, and exact visited
cell order. Fixtures include slopes, both diagonals, inverted surfaces,
hidden cells, forward/reverse traversal, and signed-zero normal components.
The verifier also tracks actual result writes against unique sentinels and
compares the complete 48-byte record after each query. This checks untouched
fields as well as successful hit values.
The verifier evaluates the retained Engine transform/direction prefix, Core
coordinate helpers, nonzero-extent gate, candidate-cell loops and both triangle
arithmetic branches. Prepared vertex and bitmap access is an explicit adapter;
this is not execution of the complete native method or its allocation/cleanup.

## Recovered ordinary path

`ATerrainInfo::LineCheck` is at owned VA `0x10722670`;
`LineCheckWithQuad` is at `0x10721040`. The supplemental bodies are 0x40 bytes
earlier. The finite interpreter reuses Elbera's existing arithmetic runner,
with bounded call frames and declared helpers; unknown operations fail.

The initial method requires a TerrainMap at `+0x3c0` and nonempty vertices
at `+0x2104`. The current path uses inverse FCoords at `+0x215c`.
`TransformPointBy` retains each point-origin subtraction until the final dot
product store; transforming the extent uses `TransformVectorBy` without an
origin. Source input provenance is described separately by the exporter.

The candidate-cell radius is the absolute **X component** of that transformed
extent. SafeNormal of the stored transformed end-minus-start determines the
segment extension. Source dimensions bound cell coordinates to `0..size-2`;
outer rejection uses strict comparisons. There is no fabricated last seam
cell. Same-cell segments visit exactly one cell. Otherwise traversal follows
the primary direction, scans secondary coordinates in ascending order, and
stops only after the primary distance from the first adopted hit is strictly
greater than the transformed radius.

The current visibility getter is called before the quad arithmetic; a false
bit rejects it. Actor `+0x64` mask `0x80` rejects deleted terrain. The Inverted
flag at `+0x20e0` mask `0x01` selects the height offset and winding. These field
names and source/default values belong to the
[input provenance proof](native-terrain-collision-inputs.md), not inferred
live actor values.

For a quad with corners `a=(x,y)`, `b=(x+1,y)`, `c=(x,y+1)`, `d=(x+1,y+1)`:

- Vertex Z receives the signed world `Extent.Z`, with Float32 stores.
- The two current diagonal orders are `(a,b,d),(a,d,c)` or
  `(a,b,c),(c,b,d)`. Inverted reverses cross-product operands.
- The approach test requires stored `dot(end-start,normal)` strictly below
  the stored `-0.0001` constant. It is one-sided.
- The second triangle's plane is anchored at `d`, even when its normal uses
  another first vertex. The line-plane helper receives End before Start.
- Edge planes are **unnormalized** cross products. Their signed distances
  compare directly with world `Extent.X`; this path does not substitute
  `Extent.Y` or a generic box-triangle test.
- An earlier adopted hit participates through its already adjusted point.
  Candidate squared distance must be strictly smaller.
- Accepted raw segment time lies in `[0,1]`. The result time becomes
  `clamp(f32(rawTime - 0.5 / Size(end-start)),0,1)`, then Location is recomputed
  with the original stored multiply/add boundaries.

The Core helpers are independently named, and their actual instructions run
in the differential: SafeNormal, Size, SizeSquared, Normalize, coordinate
transforms and FVector equality. SafeNormal stores both the square root and
reciprocal as Float32; Normalize has a different threshold/store contract.
The source clamp helpers also run as retained instructions. Mathematical
square root and finite signed-DWORD truncation remain declared boundaries;
Python/JavaScript binary64 approximates x87 intermediate precision. The tests
do not establish universal bit equality for every extended-precision edge case.

## Runtime contract

```js
const prepared = prepareTerrainSweep({
  width, height, vertices, inverseCoords, visibility, edgeTurn,
  inverted, deleteMe, terrainMapPresent: true, owner: null,
});
const result = traceTerrainSweep(prepared.model, start, end, extent, { flags });
```

Coordinates are original L2 XYZ. `vertices` is a dense row-major array of
stored Float32 triples, `inverseCoords` has twelve stored Float32 values,
and both current bitmaps contain one explicit boolean per vertex index.
Preparation snapshots/freezes arrays. The state fields must be explicit;
missing data never becomes a neutral default. Query coordinates and extent
are stored as Float32. Extent must be nonnegative and nonzero.

The result is either `status: 'unsupported'` with a reason, or
`status: 'ready'` with `blocked` and a nullable `hit`. A hit has `point`,
`normal` and `time`. `rawTime`, `cell`, `triangle`, `visited` and `cells` are
inspection diagnostics; the native differential checks cell traversal and
final point/normal/time, not every diagnostic independently. Actor, Item and
Material fields are not fabricated by this primitive API. Caller hit-record
association and world aggregation remain separate.

Every ready result also exposes `enteredTraversal`, which identifies the
native caller-record write stage. An outer-bounds rejection returns `false`
and leaves the entire caller record untouched. At `0x10722a18`, after those
bounds checks and before integer cell conversion, the native method clears
only `Result.Actor` (`+0x04`); the metadata becomes `true`. A later miss,
including hidden or deleted quads, therefore clears Actor only. A hit also
writes Location (`+0x08`), Normal (`+0x14`), Time (`+0x24`), and Material
(`+0x2c`, null in this admitted no-material path), then sets Actor to the
terrain receiver. The caller must supply that receiver's identity.
Next (`+0x00`), Item (`+0x20`) and node (`+0x28`) remain untouched.

The two triangle branches' Material/Actor stores are pinned at
`0x10721943/0x1072194a` and `0x107220a7/0x107220ae`. The checker propagates
their actual interpreted writes into the same sentinel record used by the
outer traversal; it does not infer those writes solely from a hit boolean.
Unsupported results have no write-stage contract. Missing TerrainMap/vertices
are still unsupported API inputs, even though the native early exits precede
all result writes. Callers must not turn that unknown input into a clear world.

The admitted path rejects owner transforms, flags `0x80000` (alternate
original coordinates/bitmaps) and `0x1000` (material lookup), zero extent,
visibility bypass, missing state, nonfinite derived arithmetic, and native
integer-conversion overflow. Other trace flags do not select another branch
inside this admitted terrain path; their caller-level meanings still apply.
No browser default camera or movement solver is changed by this component.

## Prepared-map diagnostics

The separate exporter can generate source geometry without live state.
`--diagnostic-static-state` explicitly supplies no owner, not deleted and
TerrainMap present **for an offline query only**. It is not evidence that the
same conditions hold for a loaded actor.

```sh
python3 tools/world/export_terrain_collision.py --tile 17_25 22_22 \
  --output-dir /private/terrain-diagnostics --diagnostic-static-state --write
python3 tools/ui/check_terrain_collision_native.py --check \
  --comparison-engine /private/comparison/engine.dll \
  --comparison-core /private/comparison/Core.dll \
  --prepared-input /private/terrain-diagnostics/17_25.terrain-collision.json \
  --prepared-input /private/terrain-diagnostics/22_22.terrain-collision.json
```

The diagnostic check hashes each input and runs twelve reproducible vertical
sweeps per supplied map, comparing the actual browser module with retained
native arithmetic. Both `17_25` and `22_22` passed these twelve comparisons,
each with ten hits and two misses. These are authored diagnostic queries,
not recorded player or camera movement. Source rows, query receipts, original binaries and generated
map files remain private. Query success cannot establish level-zone terrain
membership, current deletion state, material behavior, or complete walking and
camera collision.
