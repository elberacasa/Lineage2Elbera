# Original Next Target: dispatch recovered, distance operation unresolved

Elbera Tools freshly checks the owner's original Interlude `ActionWnd`, action
catalog, NWindow DLL and in-memory decoded Engine DLL. No native code is
executed and no game connection is made:

```sh
python3 tools/ui/check_nexttarget_native.py --check
```

The verifier pins input fingerprints, named exports, vtable and jump-table
bindings, instruction anchors and selected complete byte ranges. Its output
is evidence metadata. It does not enable a browser selector or certify one.

## Actual action path

The original action catalog identifies ID4 as Next Target with command
`targetnext`. `ActionWnd.OnClickItem` calls `DoAction` with the item's ClassID.
`UUIScript::execDoAction` at `0x100f6920` reaches the NWindow action dispatcher
at `0x10170860`. The two-level jump table maps ID4 to `0x101709b0`.

That branch gets the currently selected actor through controller virtual
`+0x35c`, bound to `AController::GetSelectedActor`. It calls the wrapper at
`0x1014c7c0` with integer200 and the selected actor's object ID, or −1 when
there is no selected actor. The wrapper converts200 to float and calls
`UNetworkHandler::GetNextEnemy` through virtual `+0x420`. This is distinct
from the separately compiled `NPCTargetNext` command.

If a result and its pawn exist, the wrapper calls
`UNetworkHandler::Action` through virtual `+0x100`, passing its User ID, the
local pawn's `Actor.Location`, and `UInput::KeyDown(0x10)`. The key method is
identified by NWindow's named Engine import, not an assumed Win32 call.
The Action sender at `0x10403d00` emits opcode04 with format `cddddc`: target
ID, three integer position components and the key-state byte. Its coordinate
conversion helper is not reimplemented by this check.

At this checkpoint `main.js useAction(4)` instead forwards generic action4;
the gateway routes it to `RequestActionUse(0x45)`. The configured aCis handler
does not implement Next Target there. That interoperability failure agrees
with the observed inert button, but the original native chain above is the
client behavior evidence.

## Eligibility and remembered-distance cycling

`GetNextEnemy` at `0x104080b0` calls `GetNextObject` with filter2.
`IsGNOMatch` at `0x10407e50`, filter branch `0x10407e93`, requires:

- a non-null User object, pawn and controller;
- User `+0x10` nonzero, independently named by
  `UUIDATA_TARGET::execIsCanBeAttacked` at `0x1012ae90`;
- controller `+0x41c` bit0 clear. `UGameEngine::OnDie` sets this bit and
  `OnRevive` clears it, independently binding the death predicate.

The candidate loop separately excludes the currently selected actor ID.
It has no additional screen-angle, visibility-ray or line-of-sight query.
That does not establish which objects were admitted to its map beforehand.

`GetNextObject` at `0x10432bc0` retains the last successfully selected ID at
network-handler `+0x60`, resetting it when the filter changes. It computes
the current scalar distance of that remembered object to the reference
object looked up through global ID `0x10b1f550`; missing/negative distance
uses zero. It scans the native object-map entry array in ascending index,
selecting the smallest scalar strictly greater than that threshold and
strictly less than200. The threshold comes from the remembered result,
not necessarily the currently selected actor.

When this pass has no result, `GetNearestObject` at `0x10432a20` performs the
same eligibility/exclusion checks and selects the smallest nonnegative
scalar strictly below200. Equal candidates retain the first map entry.
Successful wrap results also replace the remembered ID. Equal-to200 is
excluded; the initial strict pass skips zero, while the wrap can admit zero.
These are scalar comparisons, not a claim that200 is a proven physical
radius. Native object-map insertion/removal and tie order have not been
matched to the browser's entity collection.

## Precise boundary before implementation

`UNetworkHandler::GetDistance` at `0x10407cf0` reads the two actors' native
XYZ locations and writes all three float32 differences. At `0x10407dee`
the next imported vector-to-scalar call has been replaced by six NOP bytes
in the supplied protected binary. The return is a float; invalid objects
return −1. The helper's identity is not recovered. A 2D norm, 3D norm or
squared norm must not be selected by familiarity with other L2 clients.

A faithful runtime selector therefore still needs that helper binding and
a deliberate native-position contract. The browser currently keeps grounded
visual origins; substituting those for `Actor.Location` can alter vertical
distance. Exact equal-distance selection additionally needs original map
ordering. These are distinct gaps from the already recovered dispatch,
eligibility and cyclic scalar-order rules. The current button remains
unsupported; this checkpoint introduces no guessed nearest-target fallback.

The next narrow source task is resolving the erased call at `0x10407dee`
from the original protector/import repair or another independently bound
original call site. Once closed, a portable selector can test exclusions,
strict bounds, movement of the remembered object, wrap and equal-distance
ordering before using the existing ordinary target Action transport.

## Follow-up: rejected metric assumption and retained corpse state

An independent read of the original encrypted DWORDs around `0x10407dee`
reproduces those six NOPs after subtraction; the shared decoder did not erase
the call. Original Core exports `FVector::Size`, `Size2D`, `SizeSquared`,
`SizeSquared2D`, `GetMin`, `GetMax` and `GetAbsMax` with the same no-argument,
float-return signature. Unpacked companion DLLs import `Size` for their own
uses, but that does not bind this caller. The protector investigation remains
at the [documented conditional VM prefix](native-engine-recovery-evidence.md),
without a recovered import-repair target. No metric was selected.

The native map upsert at `0x1042c3f0` replaces an existing value in place.
Its new-entry path at `0x10423320` encounters another erased allocation call
at `0x10423328`. This narrows the ordering question but does not establish
all insertion/removal behavior or equate it to browser `Map` iteration.

A separate concrete transport defect was actionable: the decoder read Die's
corpse flag and the bridge discarded it. The original opcode06 decoder at
`0x10425770` reads seven DWORDs and dispatches to named `UGameEngine::OnDie`.
Inside that handler the fifth accessor result is tested for nonzero at
`0x10490d3d`; the admitted block constructs `FNPawnLight` and references exact
class `LineageEffect.s_u008_spoil`. **The protected ParamStack push/read
identities are not independently bound, so the complete packet-ordinal to
effect-argument equivalence is still limited.** The configured server names
the fifth DWORD after objectId `sweepable` and emits0/1; that server mapping
is interoperability evidence, separate from the native effect branch.

The bounded runtime correction preserves that exact signed DWORD as
`sweepableRaw` and exposes a nonzero boolean as `sweepable`. Missing metadata
stays unknown; known zero stays false. Existing NPC/entity objects retain the
state through asynchronous model loading, and revive clears it. No ID-keyed
cache transfers old metadata to a later incarnation. Duplicate NPC deaths
also retire the previous presentation-fade timer before replacing it, so
revive cannot leave an older callback that fades the live NPC later.
Closed/replaced gateway sessions cannot emit stale death/revive events.

This adds **no spoil glow, skill eligibility rule or target-selection rule**.
Existing authored corpse fading is not newly certified native behavior.
Remote player death before its base model has been admitted remains a
separate pre-existing gap; absent actors do not leave deferred corpse state.
Portable checks use synthetic packets and the actual browser state methods:

```sh
node --test gateway/test/corpse-state.test.js editor/world/test/corpse-state.test.mjs
```
