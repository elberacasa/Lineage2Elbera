# Original NPC initial-animation inputs and bounded playback

The browser now has a bounded initial Wait/AtkWait path for the owned Interlude
Gremlin IDs `18342`/`20001` and Fox `20091` on Talking Island tile `17_25`.
It joins qualified source selectors, the original channel clock, sparse keys
and Sound-notify selection.
It starts only after verified resources are ready and retires at unsupported
state changes. This is an
implementation milestone, not unconditional native NPC playback or full visual
parity. The separate manual inspector still does not dispatch gameplay events.

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

The original check verifies the existing 164 Engine and nine Core anchors,
57 additional event/packet-order anchors, ten interpreted native hash-lookup
cases, three freshly recovered NPC selector joins, 19 starter-profile anchors,
6,519 independently framed NPC records, and the existing fresh-instance
allocation proof. It also parses all 1,152 unique original spawn-event records
through exact EOF. The portable suite has 20 cases. Passing these checks is
evidence for the bounded statements below, not an NPC behavior or rendering
parity certificate.

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
| 18342, 20001[^gremlin-18342] | `LineageMonster.gremlin` | `LineageMonsters.gremlin_m00` → `LineageMonsters.gremlin_anim` |
| 20091 | `LineageMonster.fox` | `LineageMonsters.fox_m00` → `LineageMonsters.Fox_anim` |

Both qualified ancestry chains continue through `LineageWarrior.LineagePawn`,
`Engine.Pawn`, `Engine.Actor`, and `Core.Object`. The JSON output records the
fresh `.u`, localized `.int`, `npcgrp.dat`, and UKX package fingerprints, exact
mesh/animation export hashes, source names and timings. A matching schema,
mesh basename, NPC number, or legacy clip alias alone is insufficient to admit
another source build/class. See [selector recovery](npc-animation-variants.md)
and [original NPC transport](original-npc-animation-runtime.md).

[^gremlin-18342]: ID `18342` is separately decoded and admitted by exact source
    identity, not by display name or a mesh-only alias. Fresh decoding of the
    complete 6,519-record `npcgrp.dat` table finds its row differs from `20001` only in `npc_id`
    and the decoder's `class_lim` final DWORD (`0` versus `1`). The original
    serializer stores that final word at `FL2NpcData+0xdc`
    (`0x10465789–0x10465791`); the fresh NpcInfo decoder separately stores
    `User+8=1` (`0x1043abea`, `0x1043ac2f`). Its qualified class, ancestry, mesh,
    animation, selectors and zero decoration count match the Gremlin source
    profile, and its own enter-event lookup misses. This bounded comparison
    does not establish every consumer or meaning of the final DWORD. The base
    native checker above now reproduces all three selector joins; the three-ID source
    regeneration command is in the transport guide.

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
| First byte 27 | Nonzero sets controller `+0x41c` mask `0x02`, used by the combat-wait branch |
| First byte 28 | Nonzero sets controller `+0x41c` mask `0x01`, used by the dead branch |
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
call, not a recovered full idle/movement/combat state machine. The fresh decoder
calls `OnNpcInfo` at `0x1043b0df`; its initial loop and optional spawn event return
before the decoder stores extension DWORD 0 at `Pawn+0x17d0` at `0x1043b15d`.
The incoming mask therefore cannot be treated as a field already set during
that initial selector call.

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

## Spawn event: closed table miss for these three IDs

The original `entereventgrp.dat` encrypted SHA256 is
`748a0b56f4c92854ddd639945c40d1956601bbc78a034a79c15ffa415f6608f5`;
its decoded 125,689 bytes hash to
`cd0819ef32fdb3828a7c1fd855865ccdba3cde1b856f69a5cd55291366f20d5a`.
The checker freshly decrypts that input and reads the retained serializer's
field order: ID, two FStrings, two floats, two DWORDs and two L2FNames. It retains
the first string as `text0`, because its purpose is not established. Counts,
string boundaries, the original trailer, exact EOF and unique IDs are checked;
the generated table is not committed or returned in the public proof metadata.

The fresh loader constructs the event map and inserts records by their source
ID. Packet template normalization and `OnNpcInfo` assign that ID to
`Pawn+0x69c`. `SpawnEnterEvent` at `0x1061ce50` passes it to the named
`GetEnterEventData` at `0x104616e0`. The getter requires an exact matching record
with nonzero `spawn_type`. Missing records return null; there is **no key-zero
fallback**. The interpreted native lookup tests include collisions and an
actual synthetic key-zero entry, which returns its own stored-value pointer.

IDs 18342, 20001 and 20091 are absent from the 1,152-record original table. The
null-result branch at `0x1061cead` therefore returns before all data-driven
effect, rise, animation and sound branches. This closes the original spawn-mode
2 concern for these exact templates under a fresh original binary-table load.
It excludes edited text-mode data, later table mutation and template changes.
Spawn mode 2 is not generally inert: other records can move an actor or replace
channel-zero animation through `APawn::PlayAnim`.

The serializer, map constructor and append blocks have explicit supplemental
correspondence. One FString import operand differs between the images and is
bound individually; same-address IAT slots are not borrowed across files.
Relocated exception-handler references have only the bounded entry comparison
described by the checker, not a claim about complete unwind equivalence.

## Bounded browser initial loop

[npcwaitanim.js](../editor/world/js/npcwaitanim.js) requires the pinned original
class/package/localization/table fingerprints, exact qualified mesh and animation
exports, and a unique matching source selector/sequence. Its caller is the
verified [NPC resource loader](../editor/world/js/npcsourceanim.js), which retains
the index's source-file provenance. A generated schema or legacy clip label is
not enough.

Both the ready source terrain for the current world entry and the received NPC
coordinates must identify tile `17_25`. The current source zone/volume callback
census covers that map; the adapter does not generalize it to other maps.

The scene and model are separate resource dependencies. An NPC received before
the entry's map finishes loading keeps processing packets while its first
source start waits. Guarded center adoption releases this dependency before
surrounding maps finish; a matching already-loaded entry uses the same path.
Only the first entry can bind eligible NPCs received before UserInfo. Session
reset, replacement entries, unsupported intervening state and foreign scene
changes retire ownership. Repeated readiness cannot reset a running channel.
This browser scheduling does not reproduce native lazy-loader or tick history
and does not synthesize missed animation events.

The first raw NPC snapshot must be complete and immutable: WaitType 1, explicit
alive state, empty right/chest/left equipment, a positive finite Float32 movement
multiplier, spawn mode 0 or 2, and the complete typed tail. The known incoming
effect DWORD and two effect bytes must be zero. Other opaque tail words retain
their raw values; the adapter does not assign them invented neutral meanings.

The entity installs and tracks the recovered fresh constructor/channel inputs:
empty fallback equipment and abnormal collection, no lobby/ride/fishing or
damage/spine adjustment, original None swim overrides, one ordinary channel
zero, and disabled root lock/reference override with empty modifier arrays.
These are port-owned initial state, not observations of another native process
or deductions from combat zero. Missing or changed inputs are unsupported.

Combat zero selects the original `Wait`; nonzero selects `atkwait`, using the
source frame counts above and `Float32(speedMul)`. The adapter reuses
[waitanim.js](../editor/world/js/waitanim.js) and the existing
[notify clock](native-animation-notify-evidence.md), including stored event
order, remainder behavior and the four-advancement cap. It does not retime an
exported glTF clip. The ordinary source-pose evaluator receives the clock's
normalized frame and applies original sparse keys/reference fallbacks through
the recovered current hierarchy.

The initial zero-tween loop starts at `Float32(.0001)`, whereas the earlier
script one-shot starts at `.001`. With a different repeat key, ordinary
nonnegative GetFrame replaces sampled local q/p and unmatched reference rows;
possible earlier shadow evaluation does not require pretending the cache was
cold. Positive evaluation does **not** reconstruct negative-tween bookkeeping.
Later negative transitions are outside this initial-loop adapter. See the
[fallback](native-pose-fallback-evidence.md) and
[cache](native-pose-cache-evidence.md) evidence.

Browser scheduling starts when that entity's verified model is ready. It does
not reconstruct elapsed native loading time, missed events, lazy-loader history
or the exact native GTicks history. Movement/placement, MoveToPawn/StopMove,
move/wait/combat-mode changes, attack/cast/social actions, incoming attack/skill
launches, subsequent NpcInfo, death, revive and entity removal retire this source
loop. Retirement restores the compatibility playback path and invalidates
pending sound ownership; it does not invent the missing original transition.
The same entity cannot re-enter the initial path
from a later empty packet. A new entity has a new admission lifecycle.

## Sound dispatch and remaining limits

The supported Wait/AtkWait Sound records use the
[recovered integer RNG and signed gate](native-cast-sound-evidence.md): one
shared `audio.nativeRandom` context serves ported player and NPC Sound notifies.
A dispatched base Sound draws before comparing `result % 100` with its original
Random field, including thresholds 0 and 100. Muting or browser audio lock does
not remove that draw. Unreached/null/unsupported-class callbacks do not draw;
an admitted base Sound still draws before an unsupported direct/surface branch.
Delayed audio decoding neither draws again nor starts a retired event.

The integer recurrence is recovered; browser cryptographic seed selection and
one browser context's lifetime are explicit platform adaptations. Other native
RNG consumers, original thread/storage selection, seed and reseed history are
not all reproduced. Matching each original client's sound-event sequence is
not claimed. Original raw volume/radius remain separate from mixer, codec and
audio-driver fidelity, and unresolved references do not gain substitute sounds.

The [fresh allocation proof](native-pose-allocation-evidence.md) supplies a
bounded ordinary CDO-template mesh-instance chain. It does not prove that a
network-created actor has no later bone modifiers, extra channels, root lock,
local overrides, or damage adjustment. Initial `PlayAnim` can enable/disable
face rotation from a sequence field; the disable path calls named
`ClearBoneDirection`, which cannot add a modifier to a fresh empty array. This
closes that specific concern, not every actor update.

An incoming zero mask still cannot justify re-admission of an old actor.
`CheckAbnormalState` reads the reverse array at
`Pawn+0x165c/+0x1660`, rather than directly testing the incoming mask.
`UpdateAbnormalState` visits existing entries with the current `+0x17d0` mask
before its zero-mask gate skips creation. Its direct caller is `APawn::Tick` at
`0x105d4403`. A zero packet mask is consequently **not** an unconditional clear
or proof of an empty collection. The browser's bounded fresh state above is
retired instead of claiming to reconstruct later collection mutations.

General lobby, riding, fishing, swimming, damage/spine changes, additional
channels, movement/attack/death/corpse transitions and effects remain separate
work. Actor world placement and existing centering, lighting/materials, current
browser inverse binds and full native GPU/CPU skinning remain provisional.
Preserving original influence inputs does not certify the complete deformation.

The manual inspector remains a source-pose comparison with its own timeline and
no event dispatch. Browser acceptance of the new entity path is recorded
separately; this document does not turn portable tests into a live-play claim.

Focused synthetic checks, without original assets or a server:

```sh
node --test editor/world/test/npcwaitanim.test.mjs editor/world/test/npc-entity-lifecycle.test.mjs
node --test editor/world/test/waitanim.test.mjs editor/world/test/native-random.test.mjs editor/world/test/audio-lifecycle.test.mjs
```
