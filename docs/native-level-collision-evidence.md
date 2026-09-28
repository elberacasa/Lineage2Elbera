# Original level collision operations

**Status: component evidence, not complete world collision or walking parity.**
Elbera Tools now checks the ordinary level query's hit ordering, endpoint
shortening and final single-hit filtering against retained Interlude
instructions. The browser module does not yet discover collision participants,
compose a full level query, or drive the game's movement/camera.

This work complements the [BSP sweep](bsp-collision-source.md) and
[camera investigation](native-camera-evidence.md). The separate mouse-picking
`L2MultiLineCheck` path is not interchangeable with ordinary `MultiLineCheck`.

## Reproduce

Portable authored-fixture checks, requiring no game files:

```sh
node --test editor/world/test/level-collision.test.mjs
# Shared evaluator/BSP boundary coverage used by the native checker:
python3 -m unittest discover -s tools/ui -p test_bsp_camera_native.py
```

Source differential, requiring the owner's pinned inputs, Capstone and Node:

```sh
python3 tools/ui/check_level_collision_native.py --check
python3 tools/ui/check_level_collision_native.py --check \
  --comparison-engine /local/supplemental/engine.dll
```

The checker decodes/reads binaries in memory and interprets bounded instruction
ranges. It never loads executable DLL code, writes decoded binaries, or exports
original assets. Receipts contain hashes, addresses, counts and limitations.
Keep private binaries and local receipts out of release bundles.

| Input | SHA-256 |
| --- | --- |
| Owned Interlude Engine.dll | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Owned Core.dll | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| Optional supplemental Engine.dll | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |

The owned Engine contains erased six-byte imports. Without the optional copy,
the receipt leaves their bindings unresolved. With it, four exact surrounding
blocks identify three `FVector::Size` calls and `appQsort`, allowing only the
declared import sites and verified relative-call relocations. This establishes
qualified correspondence, not vendor authenticity or restoration of imports.
The called Size, sort and comparator bodies come from the pinned owned inputs.

## Browser operations

[`level-collision.js`](../editor/world/js/level-collision.js) exports:

| Operation | Required source inputs | Result |
| --- | --- | --- |
| `orderLevelHits(hits)` | At most 64 dense finite hit records, in source collection order | A new array ordered by the original Core sort; records stay unchanged |
| `shortenLevelTrace({start, originalEnd, hit, scale, kind})` | Original coordinates, accepted primitive hit, previous stored scale, `bsp` or `terrain` | Rescaled hit time and the endpoint for subsequent checks |
| `selectSingleLevelHit({hits, flags, currentLevel, adjacentLevels})` | Already ordered multi-query results produced with `flags \| 0x400`, actual level identities, source Model nodes/surfaces and required raw actor flags | Selected original record, a two-field miss write, or explicit unsupported input |

Identities are supplied source identities, not guessed names, positions or
scene-mesh IDs. `actorFlags2e4` represents the actual original field; its tested
bit is intentionally not assigned an unverified reflected property name.
`nodeIndex` is the original result field at `+0x28`, not an invented nearest
render triangle. A sweep that has not recovered that field cannot pass a branch
which needs it.

### Ordering, including ties

The level collector calls `appQsort` on 48-byte results using the comparator
at Engine `0x105bce50`. The comparator examines only stored `Time`; equal values
return zero. Core `0x1017e4d0` supplies the actual sort, including its short-sort
helper at `0x1017e440` and byte exchanges at `0x1017e410`.

The result is **not stable**. Two equal-time records exchange order. Eight
equal-time records move the first record to the end. Nine equal-time records
take the partition path and retain their order in that fixture. A language's
stable `sort` therefore does not reproduce this source behavior. The module
specializes the recovered algorithm to finite hit times and the collector's
64-record capacity.

### Shortening later checks

The ordinary collector checks the primary world BSP, then admitted attached
level BSPs, then terrain, then actor hashes. Accepted world hits update the
endpoint supplied to later primitives. The saved original endpoint remains
available for this computation.

For an accepted hit, the component preserves the original Float32 stores:

```text
distance = F32(Size(F32(hit.point - start)))
time = F32(hit.time * previousScale)
allowance = 5 for BSP, 20 for terrain
candidate = F32(((distance + allowance) * time) / (distance + F32(0.0001)))
scale = F32(FMin(1, candidate))
nextEnd = F32(start + F32(F32(originalEnd - start) * scale))
```

The primary BSP begins with scale one; adjacent BSP and terrain hits rescale
their relative times before this computation. Hit location and normal are not
recomputed by this helper. These allowances come from the original collector,
not from the BSP or terrain primitive's separate hit backoff.

### Single-hit filtering

`SingleLineCheck` adds `0x400` before calling the ordinary multi-query. It then
walks its returned list. With `0x100`, a matching level result can be rejected
through the hit node's surface flag `0x80`. The source also tests actor field
`+0x2e4` bit `0x02` **inside** the attached-level loop. Moving that test outside
the loop changes behavior when the list is empty or contains multiple levels.

Success copies the selected 48-byte source result. A miss writes only
`Actor = null` and `Time = 1`. It does not zero the previous location, normal,
item, node index or material. The module reports only those two miss writes.
Omitted or uninitialized source fields remain omitted rather than receiving
plausible replacements.

The actor hash constructs its own primitive result before querying an actor;
that constructor is different from the collector's material-only scratch
slots. Its initial zero normal is source-defined, not a general fallback for
arbitrary primitive callers. See the [cylinder caller contract](native-cylinder-collision-evidence.md).

## What is checked

The reproducible differential compares the actual browser module with:

- 138 retained-Core sort cases, 23,973 source comparator calls, including
  equal times, both sides of the short-sort threshold and full capacity;
- 396 primary BSP, attached BSP and terrain shortening cases, comparing all
  returned Float32 bit patterns, including signed zero;
- 500 retained single-filter cases with zero, one or two attached levels,
  different surface/actor bits, skipped hits and empty results.

The sorter interprets the pinned integer/byte instructions and calls the
retained Engine comparator. Shortening reuses the existing bounded arithmetic
interpreter and the original Size/FMin bodies. Synthetic primitive results are
explicit inputs. These checks do not pretend to execute a native game session.

## Remaining join

The following source observations guide the next implementation; they are not
implemented by the three operations above:

- World participation uses flag `0x04` and the caller's actual LevelInfo/model.
  Attached-level participation has a separate live global gate and ordered
  level list. The global's identity and runtime value must not be guessed.
- Terrain examines resolved zone slots `0..63`, enabled zone bit `0x04` at
  `+0x3d8`, and each zone's terrain array in order. Flag `0x100` skips terrain.
  A primitive hit must pass the current Model's `PointRegion` test against its
  zone or the caller's LevelInfo before adoption.
- Flag `0x200` can finish after the BSP phase or terrain phase when results
  exist. It does not justify skipping unqueried participants for other flags.
- Actor hashes are selected with mask `0x4009b`. Their returned list order,
  actor admission, primitive choice and source-owner exclusions are separate
  responsibilities. Copied actor times are multiplied by the current scale;
  actor copying stops at the result capacity.
- Static meshes, transformed owners, complete live source snapshots and
  movement's collision response/step/ledge/floor rules remain integration
  work. Unknown participants must never become a clear path.

Float64 intermediates approximate the original x87 arithmetic. The named square
root is a mathematical boundary, not a complete CRT/FPU-environment emulation.
No finite fixture count establishes universal numerical parity. The full client
port remains the goal.
