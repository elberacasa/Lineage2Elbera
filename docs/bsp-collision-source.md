# Original BSP collision records

Elbera Tools now exports the serialized world `UModel` independently of the
rendered BSP mesh. This is a staging checkpoint: no scene file or live asset
is adopted by this tool, and the export itself does not implement a trace.
The original algorithm is investigated separately in
[native-camera-evidence.md](native-camera-evidence.md).

```sh
python3 tools/world/export_bsp_collision.py 17_25 --check
python3 tools/world/export_bsp_collision.py 22_22 --check
python3 tools/world/export_bsp_collision.py 17_25 --stage tmp/restart-audit/bsp-17_25-review
python3 -m unittest discover -s tools/world -p test_bsp_collision.py
PYTHONPATH=tools python3 -m unittest l2lib.tests.test_ue2package.TestBsp
```

Checking is the default. Staging requires a new, gitignored directory under
`tmp/restart-audit`; an existing destination or live scene directory is
rejected. The owner's client supplies `assets/interlude/maps/<tile>.unr`.
The output contains original-derived data and stays private.
The staging CLI admits file version 123 only; broader decoder validation
below does not expand that gate.

## Data contract

`bsp-collision.json` uses `format: l2-bsp-collision-source-v1`. Coordinates
remain original world units with Z up. No triangulation, render visibility
filter, scale conversion or guessed flag interpretation is applied.

The primary tree fields are `rootOutside` (the original integer 0/1) and
`nodes[].plane`, `back`, `front`, `numVertices`, `flags`. The complete source
node records also retain `planeChild`, vertex-pool/surface indices, zone and
leaf links, collision/render-bound indices, exclusive sphere, reserved bytes
and render-section fields. Surface records, points, vectors, vertex slots,
saved bounds, leaf-hull integers, leaves, zones, lights and the Polys reference
are retained for subsequent material/trace work. Each 64-bit mask is a
16-digit hexadecimal string to avoid JavaScript integer precision loss.

Object references include their original signed package reference and full
outer-qualified identity. The source receipt fingerprints the archive,
decoded package, model export and decoded prefix independently. Contiguous
absolute byte spans account for every prefix section and the remaining tail.
The decoder now bounds each model reader to that export, so adjacent package
bytes cannot satisfy a truncated model read.

The exporter selects the **actual serialized `ULevel.Model` reference**. It
requires one qualified `Engine.Level`, reads its bounded ordinary saved prefix
(two actor-reference arrays and FURL for version123/licensee≥23), then resolves
the local qualified `Engine.Model` reference. A noncanonical prefix, wrong
class, truncated export or mismatched supplied model is rejected. It records
the Level export/prefix hashes and the exact model-reference byte span under
`source.levelBinding`.

The original `ULevel::Serialize` writes field `+0xc0` through the archive object
reference operator. `ULevel::MultiLineCheck` reads that same field for the world
BSP collision receiver. An optional check verifies 41 owned Engine/Core
instruction anchors and 10 direct bindings; a separately pinned supplemental
Engine adds 10 exact block comparisons for erased archive operation names.
This binds the saved source field, not a later runtime reassignment or captured
original process. No DLL is executed.

```sh
python3 tools/world/export_bsp_collision.py 17_25 --check --native-binding-check
python3 tools/world/export_bsp_collision.py 17_25 --check --native-binding-check --comparison-engine /path/to/pinned/engine.dll
```

Fresh 17_25 and 22_22 checks select references 1756 (`Model315`) and 1576
(`Model505`) respectively. Those match the earlier `NumZones>0` heuristic,
and all geometry fields remain unchanged. Earlier staged exports are retained
as historical private inputs; new stages include the stronger binding receipt.
The remaining UModel render/lightmap tail is fingerprinted, not decoded.
Collision-bound/leaf-hull words stay raw in this exporter; the browser sweep
module interprets them separately.

## Checked local samples

| Source model | Nodes | Surfaces | Active vertex slots | Prefix bytes | Unparsed tail bytes |
|---|---:|---:|---:|---:|---:|
| `17_25.Model315` | 1,819 | 458 | 8,686 | 391,107 | 1,846,438 |
| `22_22.Model505` | 2,770 | 1,091 | 13,050 | 648,494 | 2,066,899 |

Both graphs are acyclic and all nodes are reachable from node zero through
the retained front/back/plane links. Referenced surfaces, vertex spans,
points, vectors, leaves and zones resolve. Plane/bounds inputs are finite,
with ordered valid boxes. This does not imply render or collision equivalence.

The originals also retain stale **unused** vertex slots: 8,085 in `17_25`
and 13,670 in `22_22` contain point indices outside the current point array.
They are exported unchanged and counted separately. Every vertex slot used
by a live node resolves; making an invalid unused slot active is rejected.
Discarding the entire model because of those unused records would incorrectly
reject both original samples.

Original archive SHA256:

- `17_25.unr`: `8dbe180888719dcb2216b866caa85aaf38f18e2686dc7cb8f78ba722bfe63857`
- `22_22.unr`: `74d86d7cd503700494650fa25e237295f9bb37b194419fc67ef5eaf5effe8e6e`

Private staged receipts are under `tmp/restart-audit/bsp-17_25-source` and
`tmp/restart-audit/bsp-22_22-source`. The eleven portable tests cover serialized Level.Model selection, wrong-class
and truncated/noncanonical Level prefixes, supplied-model mismatch, and raw-field
preservation, 64-bit mask fidelity, inactive versus active stale vertices,
both surface layouts, truncated export boundaries, invalid/cyclic graphs,
nonfinite inputs, bad references and unsafe staging destinations. Three
existing original-file BSP tests additionally pass across long/short source
layouts without changing the existing renderer's decoded byte positions.

A read-only census also validated the retained fields in all 157 local map
packages: 160,912 nodes and 66,636 surfaces, with no rejected graph, reference
or prefix boundary and no unreachable nodes. The census included file
versions 118 and 123; it did not export or adopt those maps. Of those sources,
155 retained invalid unused point references (605,338 vertex slots total),
reinforcing why validation follows active node spans. The private receipt
`tmp/restart-audit/bsp-source-census.json` records each source hash, versions,
counts and byte boundaries. These are structural decoder checks, not proof
that every node participates identically in the native trace.
