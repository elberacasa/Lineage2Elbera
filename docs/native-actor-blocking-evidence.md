# Original actor blocking and movement-hit selection

Elbera Tools now supplies the finite original `AActor::IsBlockedBy`, its direct
brush/encroacher helpers, `IsBasedOn`, and the ordered blocking-result scan in
`ULevel::MoveActor`. These checks determine which supplied collision result
movement adopts. An intersecting shape alone does not establish blocking.

The component consumes explicit source actor state and actual subclass
predicate responses. It does not discover actors, populate a spatial tree,
perform a collision query, execute movement callbacks, or enable live walking.
Missing consumed state returns `unsupported`; it never becomes a clear route.

## Browser interface

`editor/world/js/actor-blocking.js` exports:

```js
isActorBasedOn({actor, base, baseOf});
isActorBrush({actor, helpers});
isActorEncroacher({actor, helpers});
actorIsBlockedBy({actor, other, helpers});
selectMoveActorBlockingHit({actor, hits, arg3, helpers});
```

Each returns `status: "ready"` with the predicate `value` (0 or 1), or
`status: "unsupported"` with a reason. The selector instead returns `selected`
and `passedBaseChecks`. The scope is `original-actor-blocking`.

Identities are opaque caller tokens. Use `null` explicitly for a native null
pointer, keep aliases consistent, and provide current source state. Undefined
means unknown. JavaScript numeric token zero is not automatically a native
null pointer. All callbacks are synchronous. Provider exceptions propagate.

### Source fields

Actor records expose only fields consumed by the selected branch. Offsets are
aliases for the pinned edition, not portable property names or invented game
definitions:

| Field | Original offset | Input contract |
|---|---|---|
| `identity` | Caller binding | Non-null actor token, required when dispatch is consumed |
| `bits74` | Actor `+74` | Unsigned DWORD; branches consume masks `2` and `40` hex |
| `collisionBits` | Actor `+2f8` | Unsigned DWORD; branches consume masks `1`, `2`, `4`, `8` |
| `primitive38` | Actor `+38` | Explicit nullable token |
| `primitive278` | Actor `+278` | Explicit nullable token |
| `physicsByte34` | Actor `+34` | Integer byte; distinct comparisons with 13 and 14 |

The two pointer aliases do not classify the referenced asset or authorize a
rendering substitute. The Physics comparisons do not assign new enum meanings.

The actor helper callbacks are `isABrush(identity)`, `isAMover(identity)`,
`isKConstraint(identity)`, `getPlayerPawn(identity)` and
`isAProjectile(identity)`. Boolean predicates accept a boolean or native
unsigned DWORD. `getPlayerPawn` requires an explicit nullable identity, never
a boolean. `isKConstraint` is the qualified original `UObject::IsA` test against
the named `AKConstraint` class object. Its source call is conditional.

The caller must supply actual subclass behavior. The component does not assume
that every actor is a generic AActor or that a player/NPC/server ID determines
the correct native class. Branches preserve lazy reads, short-circuit calls and
repeated predicate invocations; results are deliberately not cached.

### Base chains and selected records

`isActorBasedOn` starts with the receiver itself, then follows `Base` at `+40`
using `baseOf(identity)`. This differs from Owner at `+3c`. A null receiver
returns false, including when the requested base is null. A missing consumed
link or nonterminating cycle is unsupported; a target reached before an
unneeded link does not require that link.

The selector starts **after** the actual collision query. `hits` must preserve
the returned linked-list order. Its helper callbacks are
`isBasedOn(receiver, candidate)` and `isBlockedBy(receiver, candidate)`.
They can delegate to the finite implementations above, propagating an
unsupported result rather than converting it to false.

The scan runs only when the mover has any bit in mask `0x0e`. For each result:

1. If the third integer MoveActor argument is nonzero, exclude it when the
   mover is based on that result's actor.
2. Exclude it when that actor is based on the mover.
3. Set the accumulated `passedBaseChecks` flag, even if the next predicate
   returns false.
4. Select the first result for which the mover's `IsBlockedBy` returns true.

`arg3` retains its position in the original `HHHH` signature; no parameter name
is inferred. It requires an unsigned DWORD only when the loop consumes it.
The collision flag gate and an empty list do not require unused helper inputs.

The original scan copies 48 bytes from the selected record. The browser API
returns that **same supplied record by identity**, without copying or changing
its fields. It does not initialize Time, choose the lowest time independently,
replace the normal/material, or inspect records after selection. A null
selection means this loop adopted no result; it does not certify the query as
complete or collision-free.

An actual selected record can feed the existing [MoveActor arithmetic
component](native-moveactor-arithmetic-evidence.md). If no record is selected,
the surrounding caller must preserve its real initialized result. Neither
component performs the later collision membership or bump/touch/zone work.

## Source qualification and checks

Portable tests need Node and no original files:

```sh
node --test editor/world/test/actor-blocking.test.mjs
```

Seventeen tests cover directional flags, class-call ordering, repeated calls,
base relationships, exact record identity, untouched inputs, early exits and
unknown state. Synthetic inputs do not establish live actor state.

The original-source check needs Python with Capstone, Node, the pinned owned
Engine and an explicitly supplied pinned supplemental Engine:

```sh
python3 tools/ui/check_actor_blocking_native.py --check \
  --comparison-engine /local/supplemental/engine.dll
```

`--engine` accepts an explicit owned path. `--runtime-module` selects the actual
module for an isolated check. Omit `--check` for the full JSON receipt on stdout.
The checker never executes a native DLL or writes proprietary inputs. The
supplement is required to qualify the erased class-test call; this tool does
not silently substitute a guessed helper name when that input is absent.

The checker compares the actual JavaScript module with **6,600 retained-code
cases**: 5,000 blocking predicates, 300 terminating base chains, 1,000 ordered
scans and 300 scans composed with the full finite blocking implementation.
It checks results and receiver/argument/call order, including changing explicit
helper responses. Four explicit collision-flag mutations verify the read order
across the player callback in both brush branches. The native selector copies all 12 supplied DWORDs; the
browser selector must return the corresponding original record. Seeded fixture
generation uses stable ordering so its receipt is reproducible.

Seven bounded supplemental comparisons cover the complete normal blocking,
brush and encroacher bodies; the base loop/normal cleanup; and selection flag
initialization, scan and list advancement. Only declared same-target direct
calls, the qualified `Core.IsA` import and the independently named
`AKConstraint::PrivateStaticClass` address are normalized. All remaining bytes
must match. Raw span hashes and every normalization appear in the receipt.

| Binding | Owned address or slot |
|---|---|
| `AActor::IsBlockedBy` | Named body `1052e110` |
| `AActor::IsBrush` | Named body `10363dd0` |
| `AActor::IsEncroacher` | Named body `10363eb0` |
| `AActor::IsBasedOn` | Named body `10363f70`; decision loop `10363fa0` |
| `ULevel::MoveActor` | Named body `105c08e0`; vtable `+a4` |
| `AActor::GetPlayerPawn` | Vtable `+6c` |
| `AActor::IsABrush`, `IsAMover`, `IsAProjectile` | Vtable `+2e0`, `+2e4`, `+2f4` |

Pinned edition inputs:

| File | SHA256 |
|---|---|
| Owned Interlude Engine.dll | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Supplemental Engine.dll | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |

Supplemental correspondence qualifies those finite bindings. It does not
authenticate the supplemental archive or restore the owned image's imports.
The interpreter reuses the existing integer machine with explicit byte-register,
nested-call and record-copy support. Native class internals, exceptions and
arbitrary mutations made by callbacks are outside this comparison.

## Remaining integration

Live admission still needs current class/state bindings, actual spatial-provider
population and query order, static-mesh primitives, and the original movement
side effects. The normal client provider must be established from its original
factory; an editor-only structure cannot be substituted simply because it is
easier to decode. This module is one reusable client component, not evidence
that maps, actor collisions or walking have reached full parity.
