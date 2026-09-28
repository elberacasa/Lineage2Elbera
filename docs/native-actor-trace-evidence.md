# Original actor and pawn trace filtering

The collision module now implements the original `AActor.ShouldTrace` and
`APawn.ShouldTrace` methods. Elbera Tools compares **8,028 authored cases**
against retained Interlude instructions, checking the exact DWORD result and
the order, receiver and arguments of every consumed helper call. This removes
one missing component between actor-tree traversal and primitive collision.

It does not establish live actor state or repair NPC placement by itself. The
game still uses provisional visual feet and mesh recentering. Unknown current
fields, resource state and subclass dispatch cannot become an assumed hit or
clear result.

## Runtime contract

Both functions live in the existing `editor/world/js/actor-blocking.js`:

```js
actorShouldTrace({actor, source, flags, helpers});
pawnShouldTrace({actor, source, flags, helpers});
```

`source` is an explicit actor record or null. `flags` is an unsigned DWORD.
Successful results are `{status: "ready", value}`; retain the returned number,
which is not always 0 or 1. Missing consumed inputs return `unsupported`.
Unused later fields and helpers are not required on an earlier return branch.
Identity values are opaque; filenames or server IDs do not by themselves
establish native object relationships.

| Record field | Original offset | Contract |
| --- | --- | --- |
| `identity` | Object identity | Nonnull identity |
| `levelIdentity` | Actor `+e4` | Explicit level identity or null |
| `bits74`, `flags64` | Actor `+74`, `+64` | Unsigned DWORD |
| `flags2e4`, `collisionBits` | Actor `+2e4`, `+2f8` | Unsigned DWORD |
| `primitive38`, `primitive104` | Actor `+38`, `+104` | Explicit reference or null |
| `drawTypeByte35` | Actor `+35` | Byte, 0–255 |
| `controllerIdentity` | Pawn `+14d8` | Explicit reference or null |
| `flags678` | Pawn `+678` | Unsigned DWORD |

Offset names avoid assigning undocumented meanings to individual bits.
Consumed helpers return explicit values synchronously:

- `getLevelInfo(levelIdentity)` returns the current nonnull LevelInfo identity.
- `isPawn(sourceIdentity)` supplies the named `UObject.IsA(APawn)` predicate.
- `isBlockedBy(sourceIdentity, candidateIdentity)` supplies the named directional
  predicate. The existing `actorIsBlockedBy` component can implement this method
  when its own current fields and virtual responses are available.
- `checkLoadingResource(pawnIdentity, 1)` supplies the original pawn overload's
  response. The second argument remains exactly 1. Its internal global, queue
  and loading behavior is not replaced with a test of rendered mesh presence.
- `readController(controllerIdentity)` returns `{flags41c}`. This is a browser
  field provider for the original direct read, not an extra native virtual call.

Predicate helpers accept boolean or unsigned DWORD responses. Fields read after
a helper remain fresh reads; the module does not cache them across callbacks.
The broader actor-tree contract still requires a stable scene during a query.

## Differences that affect collision participation

Ordinary actors first apply the level/LevelInfo and source gates. Their category
priority is `0x8000`, eligible draw-type exceptions under `0x2000`, `0x100`, the
static branch, then dynamic `0x10` with conditional `0x20`/`0x40` rules.
The static branch returns `flags & 0x80`, including the exact value 128. The
`0x40` branch calls **source.IsBlockedBy(candidate)**; reversing that direction
changes the result.

Pawns first reject self/controller sources, apply controller `+41c` mask 1
unless `0x10000` is requested, apply the source/Pawn flag pair, and call the
resource loader. Later fields are read after that call. The pawn `0x100` gate
precedes the `0x2000` exception, and this exception has only the `+38` /
draw-type-8 branch; it does not borrow the ordinary actor's `+104` branch.

Finally the pawn returns `flags & 0x86` when `+678` mask 2 is set, otherwise
`flags & 1`. Therefore a spawn/camera trace using `0x86` cannot universally
assume that all pawns are excluded. This is a conditional code rule, not an
assertion that a particular live pawn has that bit set.

## Source qualification and reproduction

| Input | SHA-256 |
| --- | --- |
| Owned Interlude Engine.dll | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Required supplemental Engine.dll | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |

The comparison qualifies the ordinary actor body
`0x1052fe91..0x1052ffef` and complete pawn body
`0x10617740..0x10617829` (exclusive ends). Only independently named APawn-class
and loader-global operands, the two erased `Core.IsA` sites and same-target
direct calls are normalized. Named vtables bind slot `+0x160` for AActor,
AStaticMeshActor, APawn and AVehicle. Other subclass overrides require their
actual dispatch; selecting a method from a browser label is insufficient.

The actor interpreter starts after ordinary SEH setup, with a supplied frame
bound by six instruction anchors. Exception handlers and helper internals are
not executed. The supplemental archive remains unauthenticated; correspondence
qualifies these bindings rather than its distribution origin. No native DLL
is loaded or executed.

```sh
python3 tools/ui/check_actor_trace_native.py --check \
  --comparison-engine /private/comparison/engine.dll
```

The tool requires Python, Capstone 5.0.7, Node and the pinned private files.
`--engine` overrides the owned input; `--runtime-module` selects the actual
JavaScript module to compare. Omit `--check` for a JSON receipt containing input
and runtime fingerprints, normalized spans, outcomes and limitations. Keep raw
local receipts private. Importing the tool reads no game files.

The differential includes 4,000 ordinary actor and 4,028 pawn cases. It executes
254,701 instructions at 199 addresses. Authored callback writes exercise reads
after the loader; they do not claim that the real loader makes those mutations.
Five deliberate local mistakes are rejected: normalizing the static result,
reversing the blocking call, changing the loader argument, changing the controller
bypass flag and changing the pawn category mask. Mutation copies remain private.

Portable checks need no game files:

```sh
node --test editor/world/test/actor-trace.test.mjs
python3 -m unittest discover -s tools/ui -p test_actor_trace_native.py
```

Twelve browser-module tests cover branch priority, helper ordering/direction,
unknown inputs and joins through the actual actor tree, generic source bounds
and cylinder primitive. Successive queries preserve tag writes while a changed
controller state excludes the nearer cylinder. An unknown loader response
rejects the query before primitive dispatch. These joins use authored actors;
they are not native world-population or playtest evidence. Four portable Python
cases check helper frames, class arguments, byte reads and unknown-call rejection.

## Remaining integration

Current source fields, loader responses, complete live membership and primitive
dispatch must still feed these components. Static-mesh bounds/material methods,
actor lifecycle changes, NPC spawn sweeps, mesh-to-world placement and the mouse's
distinct level wrappers remain separate requirements. This milestone does not
enable native camera/walking or certify a clear gameplay route.

This headless Elbera tool is repository source, outside the existing standalone
archives. It introduces no visual tool layout or new screenshot. Original client
files, generated assets and raw private evidence remain excluded from publication.
