# Original Pawn animation-event lifecycle

Elbera Tools checks the owner's original Interlude client. This evidence
describes action dispatch and state consumption; it does not certify particle
placement, projectile motion, sound playback, or complete browser parity.

## Reproduce

```sh
python3 tools/ui/check_pawn_notify_native.py --check
python3 -m unittest discover -s tools/ui -p test_pawn_notify_native.py
```

The first command pins the original Engine.dll SHA-256
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` and
Engine.u SHA-256
`9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761`.
It uses the existing in-memory Engine recovery: image base `0x10300000`,
DWORD subtraction key `0x7965b551` derived from the exported UTF-16 sentinel.
See [native terrain evidence](native-terrain-evidence.md) for recovery details.
No native code is executed and no decrypted binaries or source text are saved.
Without `--check`, the tool reports exported method names, bounded recovered
method hashes, source-export hashes, and case counts. It currently checks 88
instruction anchors, 16 method ranges and 300 synthetic cases executing actual
decoded integer slices. The extended report also pins Core.dll SHA-256
`9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf`,
checks additional identity/tick/array instruction anchors and ranges, executes
the zero-elapsed branch and three original Float32 suffix cases, and freshly
reads all 14 player animation packages. Separate actual-instruction cases
check four duplicate-preserving appends and six ordinary initial-target
branches. Fourteen source-free tests exercise
evaluator and identity-domain boundaries.

The evaluator stops at declared calls and branch exits. Imported calls erased
to NOPs by the client protector remain explicit proof boundaries. This is
static/dataflow evidence, not an execution trace of the original game.

## Event input and consumption

Original Pawn's `NActionList` names action 5 `NACT_SKILLUSE`. In the normal
client branch, AttackPreShot, Channeling and the skill portion of AttackShot
require a Pawn, nonnull current action target at `+0x63c`, and action 5 at
`+0x62c`. An additional shared global-mode gate precedes this branch; its name
is not needed or claimed here. Editor/ordinary weapon-attack branches are
outside this porting contract.

| Original notify | Method RVA | Skill-side effect |
| --- | --- | --- |
| AttackPreShot | `0x3bd6e0` | Sets PendingPreshotNotify `+0x5a0` to 1 |
| Channeling | `0x3bd7c0` | Sets PendingChannelingNotify `+0x5a4` to 1 |
| AttackShot | `0x3bd100` | Selected last shot sets PendingNotify `+0x59c` to 2; other shots set 1 only for multishot types |
| AttackItem | `0x3bce80` | Calls named Pawn GetAttackItemSound; audio path, no MagicInfo pending write |
| AttackVoice | `0x3bd8a0` | Calls named Pawn GetAttackVoiceSound; audio path, no MagicInfo pending write |

`IsCastingMultiShotSkill` (`0x1ed8e0`) returns true only for MagicType 8, 9
and 10 in this build. These are source control values, not guessed gameplay
classes. The pending fields are assignments, not counters or a queue. Multiple
deliveries before consumption may collapse, and a later eligible assignment
can replace an earlier value.

On initial MagicProcess (`0x211ab0`), ActiveTime is zero. It clears pending
shot and preshot, invokes Agent TriggerCasting or legacy SkillEffectInit,
then advances/selects the first phase. It does not run the subsequent-update
pending-consumption block during this initial branch.

On subsequent updates the order at `0x211c2d`–`0x211c98` is:

1. Channeling: invoke Agent TriggerChanneling(caster, main target), or legacy
   SkillEffectChanneling; clear its pending flag.
2. Preshot: increment StagePreshot, invoke Agent TriggerPreshot(caster), or
   legacy SkillEffectPreShot; clear its pending flag.
3. Shot: call SkillEffectFinalize; clear pending shot.

This consumption precedes phase-deadline advancement. Clock behavior and the
skeletal notify crossing/selection rules are separate proofs; see
[native cast scheduler evidence](native-cast-scheduler-evidence.md).

## Actor tick order

The ordinary skeletal Pawn path generates notifies **before** consuming its
pending flags in the same actor tick. These calls are bound by the original
export names and vtable entries, not their apparent purpose:

| Call site RVA | Original call |
| --- | --- |
| `0x2d3f73` | Pawn Tick calls Actor Tick |
| `0x2d3659` | Actor Tick calls Pawn virtual `+0x174`, UpdateAnimation |
| `0x32fb5d` | Pawn UpdateAnimation first calls Actor UpdateAnimation |
| `0x2258ca`, `0x2258de` | Actor obtains the mesh instance through `+0x98`, then calls its `+0xa8`, skeletal UpdateAnimation |
| `0x2d37ed` | Later in Actor Tick, Pawn virtual `+0x18c`, TickSpecial |
| `0x2d300b` | TickSpecial calls NActionProcess |
| `0x331fa5` | NActionProcess action 5 calls MagicProcess |

The last two are the only direct calls to their respective exported methods
found in this recovered Engine. There are actor early exits, viewport-mode
and ownership checks, and a destruction check between the update calls.
The supported statement is their ordering when the tick reaches both calls
and action 5 remains active; it is not a guarantee that every rendered frame
runs both methods.

A browser implementation should advance the **existing** skeletal channel
and collect its events first. MagicProcess then consumes pending flags,
compares the previous ActiveTime with the phase deadline, selects any next
phase, and adds this tick's delta. A newly selected phase does not consume
that same delta again. Events generated by the outgoing phase still precede
consumption and completion in a tick which exhausts the phase list.

Two source edge cases must remain visible. ActiveTime equal to zero takes
the initialization branch on every invocation, even after a previous
zero-delta phase activation. The phase test at `0x211e24` then branches to
the index increment at `0x211e51`; it does not test a separate initialized
flag. Thus an artificial zero-delta setup followed by a tick with ActiveTime
still zero is not equivalent to an ordinary first positive tick. At phase
exhaustion, completion calls Clear(1), including ActiveTime=0, then jumps
from `0x211f4a` to `0x211fac`. The normal Float32 delta addition still runs;
the completed MagicInfo's ActiveTime becomes that delta, while its action
and identity have already been cleared. The verifier executes the actual
zero comparison/branch and the arithmetic suffix independently.

## Ordinary initial target

In the supplied-User overload of OnReceiveMagicSkillUse (`0x19c4a0`), the
second User wrapper is the target. Its actor pointer at wrapper `+0x204` must
be nonnull: `0x19c67c`–`0x19c687` returns before skill setup otherwise. The
wrapper stays at the handler's stable stack `+0x48`; after two temporary
pushes, `0x19c861` reads that same argument at stack `+0x50`, reads its actor,
and passes the actor as SetMagicInfo's fifth argument.

SetMagicInfo (`0x1f2840`) stores that supplied actor in MagicInfo main target
at Pawn `+0x520` (`0x1f29a7`, `0x1f29d7`). Following a successful
InitSkillProcess, the handler reads the same wrapper actor again and stores
action 5 and current action target at Pawn `+0x62c` and `+0x63c`
(`0x19c921`–`0x19c939`). Thus the two target fields initially refer to the same
resolved actor on this ordinary successful path. They are separate fields:
Clear(0) can later clear the main target while preserving the current action
target. There is no substitution of the caster when the supplied target actor
is null on this path. An explicitly supplied self target remains self.

Six actual-instruction cases cover null, self and another actor with successful
or failed initialization. The evaluator checks the separate argument-load and
target-store slices; it does not emulate a calling convention or the packet-ID
resolver. Ground-target overloads, temporary actors, special branches and
asynchronous replacement of an actor wrapper remain outside this proof.

## Agent action selection

The original SkillVisualEffect declares arrays of `(Action, SpecificStage)`.
SkillAction declares EffectClass followed by bOnMultiTarget. Its generated
copy constructor independently copies EffectClass at `+0x34` and bit 1 at
`+0x38` (`0x55467`–`0x55476`). The action virtual slot `+0x68` is the exported
`USkillAction::Notify(BaseActor, DestActor)`; derived actions implement it.

| Agent method | RVA | Verified dispatch |
| --- | --- | --- |
| TriggerCasting | `0x1ed030` | Walk CastingActions in source order, skip null Action, invoke Notify(caster, supplied main target). SpecificStage is not consulted. |
| TriggerChanneling | `0x1ed1b0` | Walk ChannelingActions with the same target arguments. SpecificStage is not consulted. This runs on its animation event, not automatically at cast start. |
| TriggerPreshot | `0x1ec250` | **No-op in this original build.** The complete method is entry/exit bookkeeping. It does not walk PreshotActions. |
| TriggerShot | `0x1ed420` | Select stages and targets as below; preserve source array order. |

SkillEffectFinalize increments StageShot **before** calling TriggerShot.
A ShotAction is selected when its SpecificStage equals that new StageShot,
or when SpecificStage is 0 and PendingNotify is 2. For each selected nonnull
Action:

- If bOnMultiTarget is set and the AssociatedActor array is nonempty, invoke
  Notify(caster, associated actor) for every stored entry, in array order.
- Otherwise, if the main target is nonnull, invoke Notify(caster, main target).
- Otherwise, iterate the associated array. With both main target and array
  absent, no action is invoked.

Thus an empty associated array does not suppress a multi-target action when
a main target exists. Conversely a null main target does not prevent use of
existing associated actors. The associated branch ignores Notify's return
value; the main-target branch separately classifies a returned projectile or
records a returned emitter. This document does not turn that distinction into
an approximate projectile renderer.

Clear(1) initializes StageShot and StagePreshot to zero at `0x8e6a0` and
`0x8e6a3`. This is distinct from an action's SpecificStage. All **524** action
records in the owner's original version-123 Skill.usk explicitly serialize
SpecificStage as a four-byte zero; none omit that tag. The verifier checks
the raw tagged payloads with a second generic property reader, as well as
the bounded action decoder. Earlier claims that these zeros were all omitted
defaults were incorrect.

For genuinely omitted fields, the original loading path separately proves
zero initialization: Core UArrayProperty::SerializeItem clears the incoming
array and calls named FArray::AddZeroed at `0x6f8f6` before invoking the inner
property serializer. AddZeroed (`0x9110`) performs explicit zero DWORD/byte
stores at `0x916d` / `0x9171`. Version 118 and newer ordinary struct loading
uses UStructProperty's tagged route and passes null defaults to
SerializeTaggedProperties at `0x7280e`–`0x72812`; an absent tag does not write
the field. This supports zero-filled loaded structs, not an arbitrary rule
that every missing scalar property on every class is zero.

Casting calls PlaySkillSound(caster, caster, 1) after the action loop. Shot
calls it with phase 2 after its loop, including when no visual action was
eligible. Channeling has no corresponding sound tail. TriggerShot also has
a separately gated EffectID/Action_Attack tail; the action selector alone
does not emulate that gameplay-animation path.

Casting/channeling additionally adjust returned emitter lifetimes; their
source inputs include ShotTime, first phase deadline, and emitter overrides.
Those are distinct from the action-dispatch proof and must not be replaced
by authored browser durations.

## Server association is a separate input

Both native MagicSkillLaunched handlers call AddAssociatedActorNotify at
`0x1925ff` / `0x19c46f`. Its method (`0x213230`) accepts only action 5,
matching skill ID and a nonnull current main target. In this method the
incoming level and last integer parameter are not checked. The incoming
actor is not required to equal the main target; additional actors are the
purpose of the association list. MagicType 12 takes a distinct special path
and is not covered by the ordinary association rule.

Ordinary acceptance adds the actor to AssociatedActor and the caster to the
actor's backreference list, then sets bTargetExcepted. Both use Engine helper
`0x1109f` → `0x7ae60`. Its surviving arguments to the erased Core call are
count 1 and element size 4. It does not inspect the incoming actor until
**after** that call, then writes the actor into the returned slot index.
There is no preceding actor comparison or scan. The exhaustive compatible
named Core FArray integer-returning, two-integer-argument methods are Add
(`0x90c0`) and AddZeroed (`0x9110`); both increase the count and return the old
count. The subsequent pointer store overwrites any zero fill, so both preserve
duplicate actors. Four actual-instruction cases execute Core Add's existing
capacity branch and the Engine store, including repeated actors. Within this
named-API domain, a browser array must append in packet order, not use a Set.
The erased allocation target itself remains unbound; allocation failures and
arbitrary external helpers are outside that statement.
It does not set pending flags, restart animation, advance a phase, or invoke
TriggerShot. SkillEffectFinalize also does **not** wait for a launch packet.
The targets already present when the native shot event is consumed determine
dispatch. A late packet does not replay or retry an earlier shot.

## Last-shot identity and fallback limits

The reverse shot scan writes LastShotName before reading/returning the found
notify's time (`0x3ba67f`, then `0x3ba68d`). A no-match scan leaves its output
name unchanged. Therefore a zero-time AttackShot can leave a selected name
even when the scheduler later uses its numeric attack-time fallback. A
numeric `shotFallback` flag is not evidence that LastShotName is None.

Both identity construction and notify comparison pass the notify object as
receiver and a null argument to an erased imported string helper. The reverse
site then constructs FName(string, mode 1); the delivery site compares its
returned string with LastShotName's string. The exhaustive named Core UObject
wide-string candidate set is:

| Method | Body RVA | Surviving ABI evidence |
| --- | --- | --- |
| GetName | `0x158a0` | No argument; returns leaf name; `ret` |
| GetPathName | `0x5e200` | Stop-outer and buffer arguments; `ret 8` |
| GetFullName | `0x5e300` | One optional buffer argument; `ret 4` |
| GetFName | `0xa230` | Returns the value through an output pointer; writes to that pointer, so a null output would be invalid |

Only GetFullName matches the observed one-null-argument string-returning
member-call shape. Its named body proves the format: class **leaf** name,
a space, then the full recursively assembled outer/object path. Core's
FName(string, mode) constructor calls named appStricmp for existing-name
lookup and adds a missing name for nonzero mode. However, the two Engine
helper calls themselves are six NOP bytes, and the protected Engine's
remaining PE import table contains only KERNEL32 and COMCTL32. No literal
Core/GetFullName/GetPathName import names remain. **The compatible ABI is
not a recovered import binding.** Undecoded protector metadata and arbitrary
external helpers are not ruled out by this named-method inventory.

A subsequent bounded protector inspection has not closed the import binding.
The original entry at `0x1a9b014` jumps into the Themida bootstrap at
`0x1a9e535`. The verifier fingerprints that protected section and checks for
plain DWORD repair references to the three relevant call-site RVAs/VAs;
none occur in the recovered image. The remaining ordinary PE import symbols
are only CreateFileA, ExitProcess and InitCommonControls. Absence of plain
references does not exclude encoded restoration records. No runtime import
restoration or native code execution is claimed by this tool, and it does
not promote either completion polarity to verified.

The current player source supplies a narrower useful equality domain.
Fresh extraction finds 497 AttackShot records referring to 496 original
objects, all of exact class Engine.AnimNotify_AttackShot. Within each of the
14 model source sets, leaf-name equality, full-path equality and the named
GetFullName format produce the same partition of those objects. Across
packages, 144 leaf-name groups are ambiguous, with up to six objects sharing
a leaf. One human fighter notify object is reused by two sequences, so
sequence name plus notify index is also an incorrect object identity.

Consequently a **bounded source identity comparison** can compare complete
original objectPath values only when both records belong to the same
verified model/source-package set and retain that exact source class. The
source domain is ASCII; canonical spellings already agree, and ASCII case
folding preserves the measured equivalence. The verifier rejects a future
within-model candidate collision, reference rebinding, unknown class or
non-ASCII identity before making this claim. This does not certify the exact
native LastShotName string or allow global leaf-name/object-reference keys.

There are exactly two direct calls to SkillEffectFinalize in recovered
Engine code: pending consumption at `0x211c93`, and phase exhaustion at
`0x211e95`. The completion path compares LastShotName against a constructed
None value through another erased imported helper. Core's FName equality
and inequality methods (`0x9d40`, `0x9d60`) have the **same** one-FName argument
ABI, but use `sete` and `setne` respectively. The erased call at `0x211e7f`
does not identify which was used. When its returned value permits fallback,
the source sets PendingNotify=2, finalizes, clears the flag,
then performs full completion cleanup. There is **no separate comparison of
ActiveTime with ShotTime in MagicProcess**. ShotTime affects the derived
phase schedule and effect lifetimes; it is not a license to fire effects
from an independent browser timeout. In particular, this verifier does not
prove the polarity of a browser `lastShot == None` completion fallback;
that decision remains unsupported until the imported comparison is bound.

### Conservative completion contract

Pending consumption and the common completion cleanup are separately known.
A browser can retain the source order and explicit pending assignments, then
retire the action through the common Clear(1) completion path. It must not
manufacture a timed shot or decide the optional completion shot from the
unresolved comparison.

A previous pending=2 delivery is **not enough** to prove a later fallback
has no effect. Agent Finalize calls Clear(0), which clears MagicInfo's main
target (`Pawn +0x520`), but preserves action 5 and the current-action target
(`+0x63c`). Later skill notifies can therefore still pass their normal gates.
Finalize also has no early return for a null main target: it increments
StageShot and invokes the Agent before cleanup.

For a resolved Agent with an explicitly cleared main target and empty
associated list, a hypothetical later TriggerShot selects zero visual
actions and skips its EffectID/Action_Attack tail. Nevertheless it still
calls PlaySkillSound(caster, caster, 2) unconditionally at `0x1ed5ea`. The
verifier executes four targetless tail cases to demonstrate this. Therefore:

- Visual action selection is empty on either completion polarity in that
  bounded targetless Agent state.
- No-additional-audio equivalence also requires independently resolved empty
  source phase-2 sound rows. Muting audio or having an undecoded sound is not
  proof of that condition.
- Common final state cleanup is known; optional completion shot/audio remains
  explicitly unresolved when those conditions do not establish equivalence.
- Legacy no-Agent completion and arbitrary callback side effects are not
  covered by the Agent result.

This is a conservative partial contract, not a claim that LastShotName's
imported comparison or the complete original completion behavior has been
recovered.

## Finalization and cancellation

Finalize (`0x211640`) invokes Agent TriggerShot or legacy SkillEffectShot
for a pending shot. Pending=1 returns without last-shot cleanup. Pending=2
removes target/associated backreferences and cleans the separate Pawn effect
array `+0x370`, then invokes FNMagicInfo::Clear(0). The legacy projectile path
also transfers retained MagicInfo into a returned projectile. Array internals
with erased imported calls are not emulated here.

Clear(0) preserves Agent, skill ID/level, phase indices, StageShot,
ActiveTime and LastShotName. It clears main target, hit/shot times,
MagicAniStatus, bTargetExcepted and **all three pending flags**. Associated
array cleanup follows in Finalize. A subsequent launch packet therefore
fails the main-target gate and cannot revive the finalized cast.

MagicCancel (`0x212760`) and MagicStop (`0x212160`) invoke Clear(1), at
`0x212b11` / `0x21251b`. This also clears Agent and identity, resets phase and
flexible indices to -1, clears stages/elapsed time, and resets LastShotName.
They clear current action/target afterwards. A browser must likewise retire
pending events, deferred metadata work and saved association state when a
cast is cancelled, replaced, removed or its online session ends. That is a
lifecycle requirement; no packet arrival should manufacture a replacement
effect event.


## Browser checkpoint: ordered phase playback and bounded live Agent dispatch

`castplayback.js` now advances the old skeletal channel before evaluating phase
changes. Its event payload retains the old phase identity even on completion;
newly selected channels do not consume that tick's delta. The explicit zero
ActiveTime case repeats initial phase selection, and completion clears ActiveTime
before the shared addition. Browser `eventElapsed`/Character `elapsed` is an
end-of-tick observation; `eventActiveTime`/Character `activeTime` preserves the
previous native ActiveTime seen by callbacks. Character now invokes the bounded
Pawn pending controller with those old-channel events before exposing the next
phase. Native callbacks that mutate animation channels remain unsupported.

`parse_skillfx.py` bounds action export/array reads and retains source index,
reference/path, source-null/unsupported distinctions and SpecificStage, including
its serialization presence. `build_skillvfx.py` keeps all524 records and all five
arrays (including empty defaults). Two actual actions omit EffectClass; they
remain real Action references, with no drawable effect index. Three-decimal
rounding was removed from transported effect/action fields.

`skillaction-dispatch.js` preserves the proven c/h/p/s callback rules. The live
`pawnskill.js` consumer admits exact-class LastShotName identities within one
verified source model package, ordinary non-type12 schedules, a resolved target
and fully verified source action arrays. It preserves overwrite/collapse of
pending flags, initial ActiveTime zero behavior, h/p/s order, stage increments,
source-order duplicate associations and Clear(0)'s distinction between main and
current action target. Incoming launch levels are not compared; packets only
associate targets and cannot trigger or revive an effect.

`SkillFx` reserves that path at packet receipt when its source index is warm.
Character invokes it from the recovered clock; each ready action plan enters
the existing effect renderer, then casting/shot sound tails enter GameSound.
This path creates no packet FlyingTime projectile/impact timer. Cancellation,
replacement, actor identity changes and session reset guard deferred work.
Small completed/cancelled tombstones suppress late packets without retaining
removed character graphs. A cast that begins with a cold index stays on the
preexisting provisional path for its whole lifetime, avoiding mixed clocks.
Short animation-metadata delay still starts phase zero without native catch-up.

`test/skill-source.html` remains the pure argument inspector;
`test/pawn-original.html` can now preview the live Agent path, associate its
explicit inspection target, play source sound layers/voices and show ordered
callbacks. This does not send commands to a game server. Unsupported completion
comparison is displayed and no guessed fallback shot is emitted.

This is partial lifecycle integration, not complete native effects. The erased
completion FName comparison can still add a shot sound even without targets.
LocateEffect geometry, returned actor classification/bookkeeping, explosion
callbacks, stopping sounds and native projectile/emitter lifetime remain open.
Source-none/unsupported/non-player/instant paths retain their previously labelled
provisional presentation; legacy Wind Strike and Power Strike are not finished.
