# Finite MoveActor query and backoff arithmetic

Elbera Tools recovers a small part of Interlude's `ULevel::MoveActor`: extend a
non-nearly-zero movement query, consume its **already selected** collision time,
and calculate the position before actor callbacks. This is not a replacement
for MoveActor, a collision selector, or a live walking implementation.

The helper requires exact finite Float32 source coordinates. It does not use
rendered positions, rounded packet destinations, a guessed collision normal,
or terrain heights. Unknown modes and unsupported arithmetic stay unsupported.

## API and collector integration

`editor/world/js/moveactor-arithmetic.js` exports:

```js
const sweep = prepareMoveActorSweep({start, delta});
// sweep.query = {start, end}; also source length/direction/extendedDelta.

// The caller obtains and filters actual ordered collision results.
const motion = finishMoveActorSweep(sweep, selectedHit, {arg4: 0});
// motion.adjustedDelta
// motion.preCallbackLocation
// motion.hitWrites: {} or {time}
// motion.returnPredicate
```

The preparation owns immutable copies and must be passed back unchanged to the
same module. It is reusable for independent supplied hits; it stores no actor,
timer, collision membership or callback state. `selectedHit.time` must be an
exact finite Float32 in [0,1]. Missing time, a forged preparation, or absent/
nonzero arg4 produces `unsupported`. This bounded API does not reinterpret
other original MoveActor argument values.

An existing level collector can use `sweep.query.start/end`, but still needs
the exact source extent, flags, source actor, caller level and live providers.
MoveActor then performs additional ordered actor/base/blocking checks before
the selected result is supplied here. The [finite actor-blocking component](native-actor-blocking-evidence.md)
now implements those checks with explicit source state and class callbacks. It
still requires the actual query result order and live participant bindings. An
arbitrary first collision is not an admitted replacement for those checks.

`hitWrites` is deliberately sparse. For selected Time=1 this slice does not
write Time; for Time<1 it writes only Time. Actor, point, normal, Item,
nodeIndex, Material and Next must remain as the caller actually obtained them.
The helper neither copies nor initializes those fields. In particular,
`preCallbackLocation` is **not** assigned from the collision point.

The original MoveActor caller initializes its own result before querying:
Time=1, Actor/Next/Material=null, zero point/normal/Item, nodeIndex=-1.
The checker executes the retained initializer `103048d6 → 104419f0` with these
caller arguments. It must not be confused with the level collector's
material-only scratch initialization or the actor-hash Time=0 initializer.

## Source arithmetic

The owned named MoveActor body is `105c08e0`; `ULevel` vtable slot `+a4` points
to it. The ordinary `physWalking` call passes the actual Delta, current Rotation
and four zero integer arguments. The four parameter names are not recovered
from the export's `HHHH` signature; `arg4` denotes the fourth integer argument.

Let `f` mean a source Float32 store, `D` the supplied Delta and `L` its Size.
The original `IsNearlyZero` predicate uses strict per-component magnitude
comparisons against the double `0.0001`. This helper rejects that branch.

```text
L = f(sqrt(qword((D.x*D.x + D.y*D.y) + D.z*D.z)))
reciprocal = f(1 / L)
direction[i] = f(D[i] * reciprocal)
padding[i] = f(2 * direction[i])
extendedDelta[i] = f(padding[i] + D[i])
queryEnd[i] = f(start[i] + extendedDelta[i])
```

The extension uses the **movement direction**, not Hit.Normal. The reciprocal
store is part of original Core vector division. Ordinary `D[i]/L` without that
store is not the recovered formula. Core Size stores the squared sum as a
double for its square-root call, then stores/reloads the result as Float32.

For selected hit Time `t<1`, with zero arg4:

```text
travel = f((2 + L) * t)
if travel <= 2:
    adjustedDelta = [0,0,0]
    hitWrites = {time: 0}
else:
    adjustedDelta[i] = f(f(extendedDelta[i] * t) - padding[i])
    hitWrites = {time: f((travel - 2) / L)}
preCallbackLocation[i] = f(start[i] + adjustedDelta[i])
```

There is no intervening Float32 store between `2+L` and multiplication, or
between the final subtraction and division. For Time=1, Delta and Time are
unchanged by the backoff branch. The later finite return predicate is
`Hit.Time>0`: partial blocked movement can return true, while zero movement
time returns false. This is only the predicate after the real callback suffix,
not a claim that those callbacks have been executed by the helper.

## Reproducible checks

Portable synthetic tests require Node and no game files:

```sh
node --test editor/world/test/moveactor-arithmetic.test.mjs
```

Seven tests cover padding versus collision normal, sparse result fields,
two-unit boundary/neighboring Float32 values, signed zero, immutable ownership,
repeated use, and explicit unsupported inputs/modes.

The original-source check requires the owner's pinned files, Python with
Capstone, and Node. It never executes a DLL or writes original data:

```sh
python3 tools/ui/check_moveactor_arithmetic_native.py --check
python3 tools/ui/check_moveactor_arithmetic_native.py --check \
  --comparison-engine /local/supplemental/engine.dll
```

`--runtime-module /path/to/moveactor-arithmetic.js` selects an explicit module
for an isolated staged check. Both modes compare the actual module with 735
retained-instruction cases, checking exact Float32 bits including signed zero
and whether Time was written. The arithmetic visit set contains 173 addresses.
The checker also verifies 42 retained anchors, the source Time=1 initializer,
18 original nearly-zero cases, and named owned Core method bodies. Qualified
mode adds six exact bounded Engine comparisons. It normalizes only declared
erased calls, same-target direct calls, and one explicitly named GMem IAT word;
raw span hashes and that normalization are included in the report.

Pinned inputs:

| Input | SHA256 |
|---|---|
| Owned Engine.dll | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Owned Core.dll | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| Optional supplemental Engine.dll | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |

Owned-only results leave erased call identities conditional. Supplemental
correspondence qualifies those specific bindings; it does not restore the
owned import table or authenticate the supplemental distribution. Binary64
approximates x87 extended intermediates and the named finite square-root
operation. These comparisons do not certify every possible FPU/CRT edge case.

## Required surrounding behavior

The source common path still needs actual mobility/collision flags, base
relationships, IsEncroacher/IsBlockedBy results, collision membership and
ordered hits. A successful primitive hit alone is insufficient. Same rotation
and no attached children exclude substantial branches but do not make the
remaining effects inert.

Before/after the position write, the collision provider removes/adds the actor
when the source condition requires it. The retained suffix can update relative
base location, notify both blocking actors with NotifyBump, begin eligible
touches, end obsolete overlaps, call the actual actor's SetZone, and clear render
data. The touch pass compares original list times with the already rewritten
caller Hit.Time; it must not silently normalize the whole list. A zero adjusted
Delta can still reach this suffix. Encroachment and attached-child motion are
separate branches and remain outside this helper.

Walking additionally needs source CheckForLedges, blocked stepUp, floor/base
selection and post-collision velocity. No live actor admission, callback
equivalence, world membership, complete movement or camera parity is asserted.
