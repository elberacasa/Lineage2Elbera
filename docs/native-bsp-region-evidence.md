# Original BSP point regions

Elbera Tools implements the finite ordinary `UModel::PointRegion` lookup used
by the original level query when accepting terrain hits. This is a lookup in an
explicit current BSP tree and zone table. It does not establish which level or
zone actors are currently loaded, or enable a gameplay collision path.

## Reproduce

Portable synthetic tests need Node.js and no game files:

```sh
node --test editor/world/test/bsp-region.test.mjs
```

The original-input checker needs the owned Interlude Engine/Core files, Python
with Capstone, and Node.js. It reads instructions; it never executes a DLL.

```sh
python3 tools/ui/check_bsp_region_native.py --check
python3 tools/ui/check_bsp_region_native.py --check --map 17_25 --map 22_22
python3 tools/ui/check_bsp_region_native.py --check \
  --comparison-engine /private/path/to/comparison/engine.dll
```

The optional comparison must match the pinned copy below. Its named imports
qualify archive serializer bindings; it is not an authenticated vendor
original or a restoration of the owned executable. The ordinary PointRegion
body itself contains no erased calls.

| Input | SHA-256 |
| --- | --- |
| Owned Engine | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Owned Core, reused archive proof | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| Optional comparison Engine | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |

## Runtime contract

[`bsp-region.js`](../editor/world/js/bsp-region.js) exports
`prepareBspRegion(source)` and `queryBspRegion(sourceOrPrepared, point,
defaultZone)`. Preparation copies and freezes the numeric arrays, preserves
opaque actor identities, and rejects invalid or cyclic front/back trees.
Shared child nodes are allowed. It also rejects cycles in unreachable parts.

The source contains `nodes`, explicit `rootOutside`, `numZones`, and a dense
`zoneActors` array. Each node supplies its stored Float32 `plane`, `front`,
`back`, `flags`, `numVertices`, two `zones`, and two `leaves`. These numeric node
fields are already retained by the
[original BSP exporter](../tools/world/export_bsp_collision.py).
`zoneActors` contains explicit actor identities or `null`; missing entries are
unknown. The caller supplies a nonnull `defaultZone` identity and an original
XYZ point. The point is stored as Float32 before evaluation.

A ready result contains `region: {zone, leaf, zoneNumber}` and a diagnostic
`visited` list. An unsupported result is unknown, not an outside-world or
default-zone answer. No actor identity is guessed from a name or node number.

The source has a notable zero-zone case: a **nonempty** tree with `NumZones=0`
still reads the actual fixed zone slot zero. A saved empty zone array does not
prove that slot is null. Preparation therefore requires an explicit slot zero
for that case. An empty tree reads no zone slot and returns the supplied
default, leaf `-1`, and zone number zero.

## Retained selection rule

The named owned method is `0x10746950`; the checker evaluates its complete
ordinary output/traversal block `0x1074699b..0x10746a69`. The preceding caller
assertion is satisfied by the explicit nonnull default input. The following
SEH/return epilogue does not change the result.

At each node it evaluates, in source operand order:

```text
distance = Float32(plane.y * point.y + plane.x * point.x
                   + plane.z * point.z - plane.w)
side = distance >= 0 ? 1 : 0
```

Side zero follows `back`; side one follows `front`. Both positive and negative
zero take the front branch. There is no epsilon and no coplanar-chain walk.
When the selected link is `-1`, the final node provides its leaf and zone byte
for that side. If `NumZones=0`, the selected zone number is zero. A null actor
slot falls back to `defaultZone` **without clearing the selected leaf or zone
number**.

The method calls the retained `ChildOutside` helper
`0x10685790..0x106857d5` with node flags, vertex count, side, prior outside
state, and extra flags zero. That helper writes no memory. Its result does not
feed the traversal or returned region in this method. The checker executes it;
the browser omits only this unused bookkeeping. This observation does not
remove its meaning from other BSP methods.

## Serialized operand bindings

The checker adds 41 instruction anchors and eight optional qualified
serializer comparisons. It follows named `UModel::Serialize` at `0x105ef380`,
the ordinary 120-byte node array serializer, named `FBspNode` serialization at
`0x105eba40`, and zone-property serialization at `0x105e99f0`.

| Serialized field | Consumed native storage |
| --- | --- |
| Nodes | Model `+0x64` pointer, `+0x68` count; stride 120 |
| Node plane | Node `+0x00` |
| Compact back/front links | Node `+0x20` / `+0x24` |
| Zone bytes | Node `+0x54` / `+0x55` |
| Fixed DWORD leaf indices | Node `+0x58` / `+0x5c` |
| Fixed DWORD NumZones | Model `+0x134` |
| Zone actor reference | Model `+0x138 + 24 * zone` |

The archive object-reference virtual binding and actual serialized
`ULevel.Model` selection reuse the existing
[BSP exporter evidence](../tools/world/export_bsp_collision.py). Saved object
references remain separate from live UObject pointer identity and later
loading or reassignment.

## Validation and limits

The portable suite has 11 cases covering ties, subnormal rounding, final-node
selection, null fallback, zero zones, empty trees, ignored outside bookkeeping,
snapshot ownership, cycles, missing fields and derived overflow. The original
checker compares the actual browser module with retained instruction
evaluation for 312 finite synthetic cases, reaching 93 instruction addresses.
It optionally checks two complete ordinary method blocks against the pinned
comparison copy.

Fresh map diagnostics decode the actual serialized Level.Model for `17_25`
and `22_22`, then compare 16 points per map. Saved zone references are replaced
with unique diagnostic pointer tokens to preserve equality and nullness; the
caller default is also explicitly diagnostic. These probes check real tree
data, not live actor admission. Their receipts include the package, level and
model hashes and source spans.

Binary64 intermediates approximate x87; the native Float32 distance store is
retained. The checked finite cases are evidence within that numerical scope,
not exhaustive equivalence for every extended-precision boundary. Nonfinite
inputs or derived distances are unsupported. There is no runtime zone-table
construction, level lifecycle, terrain association, collision-record assembly,
or full level-query integration in this component.
