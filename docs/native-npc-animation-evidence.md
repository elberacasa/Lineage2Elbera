# Original NPC initial-animation inputs

Elbera Tools recovers the ordinary initial-loop inputs for the owned Interlude
Gremlin and Fox. It does **not** yet establish unconditional live NPC playback
admission. The browser's original-sequence inspector can use the source poses
without claiming that a live actor is in the same neutral state.

The checker is [check_npc_animation_native.py](../tools/ui/check_npc_animation_native.py).
It reads local originals and explicitly supplied supplemental files; it never
executes the native client or writes extracted binaries. Portable tests require
no proprietary inputs, Capstone, game connection, or server:

```sh
python3 -S -m unittest discover -s tools/ui -p test_npc_animation_native.py
python3 tools/ui/check_npc_animation_native.py \
  --comparison-engine /path/to/pinned/supplemental/engine.dll \
  --comparison-core /path/to/pinned/supplemental/Core.dll --check
```

The original check verifies 164 Engine anchors, nine Core anchors, five
interpreted native hash-lookup cases, two freshly recovered NPC selector joins,
and the existing fresh-instance allocation proof. The portable suite has eight
cases. Passing these checks is evidence for the bounded statements below, not
an NPC behavior or rendering parity certificate.

## Edition and exact source domain

Owned Engine SHA256 is
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`;
owned Core is
`9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf`.
Supplemental Engine is
`508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d`;
supplemental Core is
`d83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639`.
The supplemental distribution is unauthenticated. Exact compared code blocks
qualify individual imported identities; they do not restore the protected
owned imports or authenticate the whole distribution.

| NPC | Original class | Serialized mesh → animation |
| --- | --- | --- |
| 20001 | `LineageMonster.gremlin` | `LineageMonsters.gremlin_m00` → `LineageMonsters.gremlin_anim` |
| 20091 | `LineageMonster.fox` | `LineageMonsters.fox_m00` → `LineageMonsters.Fox_anim` |

Both qualified ancestry chains continue through `LineageWarrior.LineagePawn`,
`Engine.Pawn`, `Engine.Actor`, and `Core.Object`. The JSON output records the
fresh `.u`, localized `.int`, `npcgrp.dat`, and UKX package fingerprints, exact
mesh/animation export hashes, source names and timings. A matching schema,
mesh basename, NPC number, or legacy clip alias alone is insufficient to admit
another source build/class. See [selector recovery](npc-animation-variants.md)
and [original NPC transport](original-npc-animation-runtime.md).

## Initial packet and loop

Opcode `0x16` resolves to the retained decoder at `0x1043a470`. Its first
Deserialize format is `ddddddddddddddddddffffdddcccccSSddd`, followed by
`dddddccffdd`. Field ordinals below are zero-based within each part. Strings
consume both a destination and capacity argument; the checker derives stack
destinations using that convention rather than counting DWORDs blindly.

| Input | Original destination / behavior |
| --- | --- |
| First field 18, double | `User+0x1c4`; rounded to Float32 at `OnNpcInfo` into `Pawn+0x6b4` |
| First fields 22/23/24 | Right/chest/left equipment fields `User+0xb4/+0xc0/+0xb8` |
| First byte 25 | `Controller.WaitType+0x435` |
| First byte 26 | `Controller.MoveType+0x434` |
| First byte 27 | Nonzero sets controller `+0x41c` bit 2, used by the combat-wait branch |
| First byte 28 | Nonzero sets controller `+0x41c` bit 1, used by the dead branch |
| First byte 29 | Fresh creation accepts 0 or 2; 2 calls `APawn::SpawnEnterEvent` after initial PlayAnim |
| Three DWORDs after strings | `User+0xc`, `+0x194`, `+0x198`; retained as raw fields here |
| Extension DWORD 0 | `Pawn+0x17d0`; installed server names this `abnormalEffect` |
| Extension byte 5 | Signed byte → `Pawn+0x778` |
| Extension byte 6 | Signed byte → named `User::SetEventmatchEffect` |

The byte-25 “name above” comment in the configured server is not the original
consumer's meaning. The sender's `L2ParamStack::PushBack` and receiver's `Top`
operands have exact supplemental block comparisons (117 and 86 bytes); owned
Core `Top` reads in insertion order. Same-address candidate IAT slots are
**not** assumed to name the owned imports: these particular operands differ.

`OnNpcInfo` calls `GetCurWaitAnimName`, then channel-zero `APawn::PlayAnim`
with loop 1, tween 0, and Float32 wire movement multiplier. This is the initial
call, not a recovered full idle/movement/combat state machine.

## Empty-equipment stance and conditional selection

`User::GetItemClassID` uses the empty right/left/fallback bank to return 0 for
slots 10–13. Fresh `User` zero-initialization is conditional on the exact
101-byte supplemental constructor correspondence naming
`appMemset(this,0,0x314)`; the owned erased call remains unbound. Reused User
objects are outside that conclusion.

`GetAnimType` performs item-metadata lookups on the returned IDs. The original
fresh loader constructs the map and inserts original record IDs; all 9,238
weapon/armor/etc records exclude ID 0. The native map lookup returns null on
miss, and the all-null `GetAnimType` branch returns stance 0. Zero is an ordinary
possible map key, **not** a universal sentinel: the interpreted collision-chain
cases include a synthetic key-zero record and confirm that it returns a value.
Runtime table mutations and different source datasets are excluded.

With all earlier special-state branches excluded, WaitType 1 and combat zero
select `WaitAnimName[0]`; nonzero combat selects `AtkWaitAnimName[0]`.
Gremlin uses Wait 61 frames / rate 30 and AtkWait 41 / 30; Fox uses Wait 61 / 30
and AtkWait 31 / 30. Those are original sequence values, not wall-clock timings
independent of the supplied multiplier.

Earlier branches include lobby animation, death, riding, three abnormal-state
queries, fishing, and conditional swimming animation names. Combat alone does
not attest these conditions. `IsDamageAct` independently reads `Pawn+0x73c`
bit 0; `IsSpineRotation` reads `+0x748` bit 0. Combat 1 is therefore not itself
proof of either damage or spine modification.

## What remains before live admission

The [fresh allocation proof](native-pose-allocation-evidence.md) supplies a
bounded ordinary CDO-template mesh-instance chain. It does not prove that a
network-created actor has no later bone modifiers, extra channels, root lock,
local overrides, or damage adjustment. Initial `PlayAnim` can enable/disable
face rotation from a sequence field; the disable path calls named
`ClearBoneDirection`, which cannot add a modifier to a fresh empty array. This
closes that specific concern, not every actor update.

Two concrete boundaries prevent an unconditional packet-to-neutral-pose claim:

- `SpawnEnterEvent` at `0x1061ce50` has global and actor gates followed by
  class/data-driven effects. The installed ordinary-NPC writer sends spawn
  byte 2. This event is not established as inert for either live actor.
- Packet `Pawn+0x17d0` and the linked abnormal-state collection read by
  `CheckAbnormalState` have not been connected through their complete update
  lifecycle. A zero packet mask alone is not proof that the collection is empty.

The gateway now preserves raw spawn mode and the complete optional tail.
Unavailable/truncated tails remain unavailable, not invented zeros. The browser
inspector is an explicit neutral source-pose comparison; native sound notifies,
full NPC transitions, live state admission, and complete rendering remain open.
