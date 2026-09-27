# Original sitting animation audit

Elbera Tools, 2026-09-26. The original client distinguishes **sit down,
seated idle and stand up**. The browser's earlier `sit` clip was the correct
seated-idle sequence, but it skipped both transitions. This finding does not
explain or authorize a correction to the character's world height.

## Original state and animation selection

`tools/anim/check_sitting_native.py` reads the owner's original Engine.dll
through the existing in-memory decoder. It pins Engine SHA256
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`,
checks 111 instruction anchors and four synthetic cases executing the actual
non-loop endpoint arithmetic. Original package scripts and animation data
are read locally; the receipt contains hashes and bounded metadata, not
redistributed proprietary source or poses.

Original `Engine.Controller.PStopType` defines sit=0, stand=1, fake-dead=2,
fake-dead-stand=3 and chair-sit=4. `UGameEngine::OnChangeWaitType`
(RVA `0x19bbc0`) first calls named `AdjustPawnLocation` with the received
position. It then compares incoming state with Controller.WaitType
(`+0x435`); an equal state returns without restarting animation. For a
changed state, it calls `NActionStop` before the selection below.

| Incoming state | Original selected input | Evidence |
| --- | --- | --- |
| 0 | `SitAnimName[CurWeaponType]`, `GetSitAnimRate()`, channel 0 `PlayAnim` | `0x19bc60`, `0x19bc77`, `0x19bcb0` |
| 1, previous state 0 | `StandAnimName[CurWeaponType]`, `GetStandAnimRate()`, channel 0 `PlayAnim` | `0x19bd9d`, `0x19bdb4`, `0x19bf17` |
| 1, previous state 4 | Separate chair-stand branch | `0x19bdc5`–`0x19be23` |

The sit and ordinary stand branches supply the original Float32 tween
`0.10000000149011612`. Their respective WaitType stores happen immediately
after `PlayAnim`, not when the transition finishes. A stand update during
sit-down therefore observes state 0 and selects the stand transition;
a duplicate sit update must not reset the in-progress sit-down clip.
Special states and chair behavior are outside the ordinary browser contract.

The named Pawn getters independently bind array offsets `+0x8ac`, `+0x8cc`
and `+0x8ec` to Sit, SitWait and Stand. They use the source weapon-type byte
at `+0x71d`. All seven present stance indices (0–5 and 7) select the same
sit/sit-wait/stand sequence within each of the 14 original player models.
This is measured from the original `lineagewarrior.int`, not inferred from
sequence names.

`SitAnimRate` and `StandAnimRate` are **scalar localized floats**. The old
exporter's indexed-key parser omitted both, despite listing their names in
its rate table. The corrected parser retains the exact Float32 values.
The named native getters use 1 only when their stored source scalar is
exactly zero; negative values are not a proved positive-rate fallback.
All 28 scalar values in these 14 original models are positive.

## End of transition and seated loop

The ordinary original `Engine.Pawn.AnimEnd` calls `PlayWaiting` only for
channel 0. `LineageWarrior.LineagePawn.PlayWaiting` dispatches its normal
grounded branch to `AnimateStanding`. That calls `LoopIfNeeded` with
`GetCurWaitAnimName()`, rate multiplier 1 and tween 0.2. The wait selector
uses SitWait when Controller.WaitType is sit. Ordinary standing selects
WaitAnimName; death, fake death, auto-attack, swimming and typing have
additional branches and must not be folded into an assumed idle state.

`LoopIfNeeded` supplies the blend only when the sequence or rate changed,
or the channel is no longer animating. Otherwise it calls `LoopAnim`
without that explicit blend. Repeated browser renders must not restart a
playing seated loop. Original loop and one-shot endpoints differ: see
[native animation endpoint evidence](native-animation-terminal-evidence.md).

The native non-loop endpoint arithmetic at `0x3badcf`–`0x3bade4` stores
the leftover time and clamps the normalized frame to AnimLast:

```text
remaining = f32((advancedFrame - lastFrame) * remaining
                / (advancedFrame - oldFrame))
frame = lastFrame
```

When channel field `+0x44` is zero and the previous rate is positive, the
source zeros the rate and calls the actor's virtual `+0x170`; the original
Pawn vtable independently names that method `NotifyAnimEnd`. After the
callback, `0x3bae8c` jumps back to the existing channel loop at `0x3baa7c`.
It re-reads the channel, leftover time and current frame. The advancement
counter is retained; there is one four-step budget for the complete update,
not a new budget for the animation selected by the callback. Thus the
callback's newly selected SitWait/Wait channel can consume the remainder
within that update. Discarding it or advancing the new clip by the entire
original delta would both change the recovered control flow.

The named `EnableChannelNotify` method binds the `+0x44` gate, but the
freshly allocated channel's default remains unresolved. Explicitly enabling
notifications is a bounded browser admission choice, not a recovered
allocation default. Arbitrary callback mutation, channel-array reallocation,
destruction and the full notify-removal behavior remain outside this proof.
See [animation notify evidence](native-animation-notify-evidence.md).

## Recovered inputs and browser contract

The existing recovery tool appended **28 original clips across 14 models**.
It kept every pre-existing binary byte, mesh, material and node unchanged.
It verified complete RefBones name/parent order and every emitted transition
channel against independently indexed keys from the original-package PSA
export. That establishes conversion consistency, not native interpolation
or final pose parity. The original compressed sequence reader independently
supplies frames, rate, ordered notifies and sequence hashes.

`pawnanim.json` now exports:

| Field | Meaning |
| --- | --- |
| `models[id].slots.sitDown[stance]` | Original SitAnimName, browser clip `sitDown` |
| `models[id].slots.sitWait[stance]` | Original SitWaitAnimName, existing browser clip `sit` |
| `models[id].slots.standUp[stance]` | Original StandAnimName, browser clip `standUp` |
| `models[id].slots.idle[stance]` | Exact original WaitAnimName and its existing stance clip |
| `models[id].rates.sit`, `.stand` | Original scalar playback multipliers, without rounded decimals |
| `clips[id][clip]` | Original frames/rate/ordered notifies with `originalTiming:true` and source hash |

The existing `slotSource` contract distinguishes an explicit source-none,
known source sequence and missing source sequence. The source metadata has
no substitute animation. Human Fighter male, for example, has Sit=41 frames
at rate 12 with multiplier `1.2745100259780884`, Stand=41 frames at rate 15
with multiplier `1.013069987297058`, and SitWait=7 frames at rate 3. All 14
SitWait sequences have a verified empty notify array; transitions retain
their actual source notifies. Scale metadata was freshly regenerated after
the appended buffers changed their fingerprints.

The audit's initial browser path assigned a Boolean `sitting` from the
packet and cross-faded directly between `sit` and idle with an authored
0.25-second fade. It did not play the source transitions or use the source
scalar rates. The current ordinary browser path now uses the source slots,
transition rates and wait-state suppression. It advances transitions to
their original one-shot endpoint, then carries the same update's remainder
into the selected waiting loop within the shared four-step budget. Portable
state/Character tests cover this integration; live Human Fighter sitting
and standing were visually checked. This is bounded state/timing support,
not complete pose, sound or world-placement parity. The apparent floating
silhouette remains a separate, unresolved placement/pose issue.

`ChangeWaitType` includes X/Y/Z. The gateway decoder reads them, while the
bridge's existing `changeWait` event omitted them at audit time. The native
placement call precedes even duplicate-state suppression. This is a
separate position-reconciliation gap; it does not justify an invented sit
offset. Original `OnCharInfo` also directly initializes the controller's
wait-state byte (`0x19651d`/`0x196521`). Its `GetCurWaitAnimName`/`PlayAnim`
calls at `0x196352`/`0x196375` occur **before** that incoming-state assignment.
A fresh, uniquely validated original `Engine.Controller` default-property
stream explicitly sets WaitType=1. That initial call therefore selects the
standing wait path; it is a loop with tween zero and rate from Pawn `+0x6b4`.
The later ordinary `UpdateMovementAnimation` path selects the current wait
name again (`0x32507d`) and plays it as a loop with Float32 tween 0.2
(`0x325088`) and rate from the same Pawn field. A sitting spawn snapshot can
therefore reach steady SitWait through the update path, without a sit-down
transition. It is not an `OnChangeWaitType` transition. The erased
velocity/name-comparison helpers at `0x324d8c`/`0x325067` retain limits on
fully reproducing the exact first-frame and update admission behavior.

The original CharInfo decoder's first of four consecutive `f` fields is
stored as a double in User `+0x1c4` (`0x136cd6`/`0x136cdd`). The verifier
independently counts the argument pushes and stack cleanup to bind that
field to its destination. `OnCharInfo` loads it, rounds it through a Float32
stack value, then stores Pawn `+0x6b4` (`0x196505`–`0x196517`). That proves
the remote snapshot's browser `speedMul` mapping. Its initial loop call
precedes this incoming-rate store; admitting the received snapshot directly
to the later steady-state loop is an explicit browser adaptation.

The self UserInfo path is independently bound too. Its format's first of
four consecutive `f` fields is destination index 114 (zero-based) after accounting for the
preceding string capacity argument. The verifier counts 138 pushes, 20
before its destination address and the exact cleanup. This binds the
first double to `[esp+0x10c]`, which is stored in User `+0x1c4`
(`0x134a7d`/`0x134a84`). The decoder dispatches that same User through the
original GameEngine vtable's `OnUserInfo` slot `+0x124`. The named handler
rounds it through Float32 and stores Pawn `+0x6b4`
(`0x1973bc`–`0x1973ca`) **before** its initial wait-animation call.

That ordinary self initialization selects `GetCurWaitAnimName()`, channel
0, loop enabled, tween zero and the newly stored rate
(`0x1974b9`–`0x19750b`). In the source standing domain, the selector uses
WaitAnimName at Pawn `+0x86c`, indexed by CurWeaponType. The existing
native `PlayAnim` proof binds a new, multi-frame zero-tween loop to initial
normalized frame `Float32(0.0001)` and zero tween rate. It does not authorize
restarting an already-playing loop on every repeated packet. The initial
self-standing browser snapshot can therefore use the exact source idle
slot, Float32 wire multiplier and zero-tween initialization. Sitting
snapshots, later updates and native movement-admission/name-comparison
gates retain the limitations described above. See
[native loop initialization](native-animation-terminal-evidence.md#initial-tween-and-the-per-update-clock).

That native steady-state rate field is a separate input from the script
AnimEnd callback's literal rate multiplier 1. This audit preserves the
distinction rather than assuming a generic browser idle-rate policy proves
both paths.
See [player transform audit](player-transform-audit.md) for the still-open
placement, reflection and skinning limits.

## Unusual original sound references

The live sit-down diagnostics exposed surprising sounds. A second sequence
reader agrees with the source traversal on all five Human Fighter male
sit-down notify references and exact normalized times. The separate
`check_sitting_sound_refs.py` then re-reads the decrypted package's name,
import and export tables with an independent compact-integer reader. It
checks each first packed `Sound` property and its full imported outer chain,
then verifies that the exact qualified sound exists in the original UAX.

These are actual serialized direct sounds, including the Silenos and ice
sound names; they are not a guessed surface selection or an export-index
shift. The current manifest has verified aliases for four of the five.
The Silenos sound shares a basename with another original grouped export,
so the existing flattened OGG output cannot prove which one it contains.
Its qualified reference intentionally has no alias. The audio loader uses
exact qualified lookup and returns no buffer; it does not strip the group
or substitute a similar sound. Diagnostics listing that notify do not mean
it played. Source identities are preserved without renaming apparently
inappropriate data. This check does not certify codec or audible parity.

## Reproduce

No browser or game account is needed. Original client and built character
assets are private prerequisites. Detailed receipts default nowhere in the
public repository; the commands below use ignored `tmp/restart-audit`.

```sh
python3 tools/anim/check_sitting_native.py --check --output tmp/restart-audit/sitting-animation.json
python3 tools/anim/check_sitting_sound_refs.py --output tmp/restart-audit/sitting-sound-references.json
python3 -m unittest discover -s tools/anim -p test_sitting_sound_refs.py
python3 -m unittest discover -s tools/anim -p test_pawnanim_source.py
python3 -m unittest discover -s tools/anim -p test_recover_pawn_clips.py
python3 tools/anim/build_pawnanim.py --check
python3 tools/dat/export_player_visuals.py --check
```

For a supplied local model missing the transitions, `recover_pawn_clips.py
MODEL --write --report tmp/restart-audit/MODEL-clips.json` verifies and
appends the exact source slots. Rebuild pawn metadata and refresh scale
fingerprints afterward with `build_pawnanim.py` and
`export_player_visuals.py --write-manifest`. Without `--write`, clip recovery
is a dry run. Existing clips are checked rather than overwritten.
