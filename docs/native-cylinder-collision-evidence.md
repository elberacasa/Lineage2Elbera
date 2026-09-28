# Original actor-cylinder collision

Elbera Tools now checks a finite browser implementation of the owned Interlude
`UPrimitive::LineCheck` cylinder. This is an isolated primitive, not live actor
admission, a full level trace, or completed walking/camera collision.

The original `UPrimitive`, `UMesh`, `ULodMesh`, and `USkeletalMesh` vtable slot
`+0x6c` all resolve this body, `Engine 0x10645de0`. The checker interprets its
ordinary arithmetic/control flow from `0x10645e0f` through `0x106465a7`, stopping
at the separately pinned register/SEH return cleanup. It reuses the existing
bounded BSP arithmetic runner; it does not execute a DLL.

## Source and reproduction

The checker pins these complete inputs:

| Input | SHA-256 |
| --- | --- |
| Owned Engine.dll | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Owned Core.dll | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| Optional supplemental Engine.dll | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |

Private inputs belong under the existing local source configuration. Commands
run from the repository root:

```sh
python3 tools/ui/check_cylinder_collision_native.py --check
python3 tools/ui/check_cylinder_collision_native.py --check \
  --comparison-engine /local/supplemental/engine.dll
node --test editor/world/test/cylinder-collision.test.mjs
python3 -S -m unittest discover -s tools/ui -p test_cylinder_collision_native.py
```

The original checks require Capstone, Node, and the owned binaries. The final
two suites use synthetic data and need no game assets. Public output contains
fingerprints, counts, and source contracts, not binary payloads or captured
world state.

The optional comparison pins all **1,944 bytes** of the ordinary solver range,
allowing only three declared six-byte import sites and seven same-target direct
call relocations. It identifies `FVector::SafeNormal`, `appSqrt`, and
`FVector::Normalize`; the first and third are evaluated using the complete owned
Core bodies. This is exact, qualified correspondence with a separate image,
not authentication of that distribution or restoration of the owned imports.
Owned-only mode explicitly retains those three helper identities as conditions.

## API and result ownership

[`cylinder-collision.js`](../editor/world/js/cylinder-collision.js) exports:

```js
createActorHashResult()
traceActorCylinder({ start, end, extent, actor, initialResult })
```

Vectors use original L2 XYZ. `actor` supplies an opaque `identity`, exact native
`location`, `collisionRadius`, `collisionHeight`, and `skins` material-reference
array. The latter is the array consumed at Actor `+0x298`, count `+0x29c`; its
API label does not establish a new reflected property-name proof. The existing
[NPC material evidence](native-npc-material-evidence.md) separately follows
`SetTexes` and the material consumer. No values come from renderer bounds,
packet feet, guessed defaults, or static-mesh replacement.

The cylinder center is actual `Actor.Location` (`+0x1bc/+0x1c0/+0x1c4`), with
radius `+0x2f0` and half-height `+0x2f4`. The named `GetCylinderExtent` helper
returns `(radius,radius,height)`. Extent expansion is componentwise: the broad
Y bounds use `radius + extentY`, while the radial quadratic uses
`radius + extentX`. Unequal horizontal extents are retained.

`traceActorCylinder` returns `{status:'ready',scope:'native-actor-cylinder',hit,
result}` or an explicit unsupported reason. It owns the returned result record
and changed vectors; actor/material identities remain opaque references. Only
`hit` authorizes hit adoption. The primitive always writes `time = 1` before
checking a null actor or rejecting a segment. A miss can already have changed
`normal` during cap clipping, while retaining the caller's actor, point, item,
and material.

An exact touch can hit at time zero **without writing a normal**. Supplied
normal values remain intact; an omitted normal stays omitted. There is no
fabricated fallback normal. Outside entry writes actor, item zero, point, and
biased time while preserving material. An inward inside hit writes time zero,
the original start, the source normal, and the first material reference (or
null when the source array is empty). Stationary/outward points strictly inside
are not automatically hits; the original inward predicate is preserved.

`createActorHashResult()` has a narrower meaning than a general default:

```js
{
  next: null, actor: null, point: [0, 0, 0], normal: [0, 0, 0],
  item: 0, time: 0, nodeIndex: -1, material: null
}
```

The nonzero actor-hash path calls `0x103048d6 → 0x104419f0` at
`0x10523e88..0x10523e96` with time zero and next null. The complete 56-byte
initializer is pinned and interpreted against this actual JS factory. Thus an
actor-hash touching hit retains a **source-initialized zero normal**. This is
separate from `MultiLineCheck`'s 64-slot buffer, which initializes material only.
Arbitrary primitive callers must supply their own actual known initial fields.

## Arithmetic scope and checks

The check compares **2,277** synthetic queries with the actual JS module:
**1,138 hits**, all returned or retained result fields, and Float32 bit equality
including signed zero. It also compares the source actor-hash initializer with
the actual factory. Portable coverage is **13 Node tests and 5 Python tests**.
The source comparisons cover cap/radial entry, exact touches, stationary inputs,
inward/outward starts, unequal extents, miss-side normal writes, null actors,
and empty/nonempty material arrays.

Explicit Float32 stores are retained. In particular `SafeNormal` stores its
square root to Float32 before reciprocal; `Normalize` does not. Entry time is
biased by the original double constant before its Float32 store and clamp.
The evaluator uses binary64 for extended intermediates and mathematical square
root at the declared CRT boundary. It is not native execution, exhaustive
precision equivalence, or an arbitrary NaN/overflow emulator. The JS component
rejects nonfinite derived geometry rather than reporting a clear trace.

The remaining actor path includes collision-hash population/visitation order,
`ShouldTrace`'s actual class/state predicates, primitive selection, source
ownership, and joining actor hits to the shortened level segment. Raw actor
flags are not relabeled from declaration order. The primitive itself does not
establish current actor coordinates or permit gameplay use of unverified actor
state. See the separate [BSP collision evidence](native-camera-evidence.md)
for the finite world-model component and its aggregation limits.
