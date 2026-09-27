# Elbera Tools: native casting schedule evidence

The original ordinary player cast is a schedule of source animation phases,
not one animation stretched to the packet's hit time. Its flexible phase loops
until a calculated deadline; physical casts without that phase use a different
rate calculation. The browser now integrates that bounded ordinary player
phase schedule over its exported poses. This document separates original-code
evidence, runtime checks and the remaining gaps; it is **not complete native
animation or effect parity**.

## Reproduce

```sh
python3 tools/ui/check_cast_scheduler_native.py --check
python3 tools/ui/check_cast_scheduler_native.py --json
python3 tools/ui/check_skillanim_native.py --check
python3 -m unittest discover -s tools/ui -p test_cast_scheduler_native.py
python3 tools/ui/check_castschedule_runtime.py --check
node --test editor/world/test/native-castschedule.test.mjs editor/world/test/castplayback.test.mjs editor/world/test/castplayback-review.test.mjs editor/world/test/native-skillanim.test.mjs
```

The scheduler verifier checks 60 original instruction anchors, source field
names, all 32 selector flexible-phase indices, and 12 finite timing cases. A
bounded evaluator consumes the actual decoded arithmetic instructions and
compares its result against separately written equations. Ten source-free
tests check evaluator branching, reverse arithmetic, Float32 stores, rejection
of calls and unbounded loops, and two scheduling consequences. This is not a
full CPU emulator: arithmetic uses Python Float64 intermediate precision with
original Float32 memory stores, not x87 extended-precision bit parity.

Required private inputs:

| Input | SHA-256 |
| --- | --- |
| `assets/interlude/system/engine.dll` | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| `assets/interlude/system/core.dll` | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| `assets/interlude/system/Engine.u` | `9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761` |

Engine image base is `0x10300000`. The shared reader derives the recovery key
`0x7965b551` from the exported UTF-16 function-name sentinel and subtracts it
from aligned DWORDs in `[0x1000, 0x1a99000)` in memory. Export `E9` stubs lead to
the original bodies. No binary is executed or emitted. See the
[selector evidence](native-skill-animation-evidence.md) for recovery details.

| Exported method | Examined RVA range, exclusive end | Recovered range SHA-256 |
| --- | --- | --- |
| `APawn::InitSkillProcess` | `0x1ef470`–`0x1ef98f` | `2ab3b12760b6f714aac5662f0f2c8953b0d7e0c4afec63cb3d848eda14b51c72` |
| `APawn::MagicProcess` | `0x211ab0`–`0x211fd6` | `588f9d57fe65753619d53eb8718b89716f18b6df4850bf5890c09dfd678d3404` |
| `APawn::MagicCancel` | `0x212760`–`0x212b67` | `656eb06b4a9c9eec785a9b2785e078321b9680948389b70768b1c8cc2428e222` |
| `APawn::MagicStop` | `0x212160`–`0x212573` | `350c3b6464c2b7b1abc3ea1e1e483da46d967ab901432e260e21b8de7ac6a866` |
| `USkeletalMeshInstance::AnimGetAttackShotNotifyTimeRev` | `0x3ba5d0`–`0x3ba6a9` | `75d8fcd8a61a6b9ee7f39645b55bd373c4d3b0ca284021aff0823ac47cd6eb84` |

Ranges end after the normal return; additional compiler exception tails are
not included in these fingerprints. The verifier also hashes the bounded
Actor and Pawn `ScriptText` exports from Engine.u. Actor's original
`NMagicInfo` declares the named fields below in their observed order; native
accesses and `GetMagicInfo` bind this structure to Pawn `+0x4f0`.

## Inputs and original sequence time

All times below are seconds. `T` is `SkillHitTime` at Pawn `+0x510`. The normal
server-use handler converts the packet hit-time integer with division by
1000 at RVA `0x19c84d`–`0x19c856`, then calls `SetMagicInfo` at `0x19c897`.
That method stores this argument at `0x1f29a1`. A second argument prepared as
`T - 0.5` is not the value stored in `SkillHitTime`.

`S` is Pawn `SkillSpeedRate` at `+0x6b8`. The exported
`UGameEngine::OnMagicCastingSpeed` writes the server value to User `+0x23c` at
`0x1889ec`; the pawn update divides that field by the original double constant
333 at `0x195366`–`0x195384`. This proves the field conversion in that path;
it is not a proof that every later modifier of casting speed is recovered.
The ordinary equations below use finite positive `S`.

For each nonflexible phase, native source duration is:

```
D[i] = Float32(NumFrames[i] / Rate[i])
```

`InitSkillProcess` reads integer sequence `+0x14` and float `+0x18` at
`0x1ef5a9`–`0x1ef5ac`. Independently named exported getters
`AnimGetFrameCount` (`0x3ae970`) and `AnimGetRate` (`0x3ae990`) identify these
fields. A missing sequence or nonpositive source rate contributes zero in
this scan. The flexible phase also contributes zero, regardless of its source
clip length.

The selector sets flexible index `q = 1` for A–I and MS01, `q = 0` for J–L,
and leaves `q = -1` for the other known codes. A–I therefore loop the middle
`castEnd` phase. It is not a post-launch recovery animation.

The initializer scans phases backward. In each eligible phase it scans
notifies backward using `AnimGetAttackShotNotifyTimeRev`; the cast helper at
`0x1eee60` references the exported private static class of
`UAnimNotify_AttackShot` (`0x10dd51b0`). The first positive result supplies:

- `k`: phase containing that last eligible shot;
- `P`: Float32(normalized notify time × `D[k]`);
- `A`: `P` plus preceding nonflexible phase durations, with Float32 stores.

A zero-time notify does not terminate this positive-result search. If the
accumulated attack time remains zero, the fallback uses the last phase index,
its duration as `P`, and the sum of all nonflexible durations as `A`. The
verifier tests the downstream arithmetic with these scan results supplied;
it does not emulate the imported class/name helpers.

Within a phase, the helper returns the last matching entry in serialized array
order, not the greatest timestamp. If that entry has time zero, the phase does
not supply a positive result; an earlier positive notify in that same phase is
not substituted. Original notify order and class identity therefore matter.

`F` denotes the native scheduling lead. With an effect Agent, RVA `0x1ef667`
reads `SkillVisualEffect.FlyingTime` at Agent `+0x74`. The
[independent Agent evidence](native-cast-agent-evidence.md) establishes that
identity through reflected property order, Core linking rules and compiled
field accesses. A value at least the source Float32 0.15 is used directly;
a smaller value becomes zero for cast style 3 and 0.15 otherwise. The
scheduling lead therefore need not equal the unmodified FlyingTime.

Agent selection uses the exact skill ID/level record's qualified
`skill_visual_effect` path. Known source None, an unresolved path and a
resolved object with FlyingTime zero are distinct states. The browser now
preserves them; a missing export must not select the Agent-absent branch.

Without an Agent, the original branch assigns:

| Raw `cast_style` | `F` |
| --- | --- |
| 2, 5, 8, 10 | Float32(0.4) |
| 3, 12 | 0 |
| 14 | 2 |
| other ordinary styles | Float32(0.15) |

The text loader's literal `cast_style` store at `0x16e5f7` binds the raw value
to skill-data `+0x30`, copied into Pawn `MagicType` (`+0x52c`). Numeric styles
are retained here rather than assigning unsupported category names.

## Ordinary timing equations

These are real-arithmetic equations describing the recovered operations.
The native implementation stores the rate, tween, source times and phase
deadlines as Float32; use those stores when reproducing the calculation.
Let `c = Float32(0.2)`, `m = Float32(0.15)` and `epsilon = 0.0001` (a stored
double). Type 13 has separate branches and is outside this ordinary spec.

For a flexible phase (`q >= 0`):

```
Q = c / S
L = T - F - (A + c) / S
R = S
B = T - F - c / S
if L < 0 and B > epsilon:
    L = 0
    R = A / B
```

`Q` is initial tween time, `L` is flexible-phase duration, and `R` is playback
rate. If `L < 0` but `B <= epsilon`, the original branch retains the negative
`L` and rate `S`; it does not impose a guessed minimum duration. Two verifier
cases exercise this boundary behavior.

Without a flexible phase (`q < 0`):

```
Q = c
R = A / (T - F - c)
```

That division has no positive-denominator guard in this branch. The normal
positive-budget cases are verified; division by zero, nonfinite results and
negative-rate playback are not a specified browser behavior.

Starting with `previous = Q`, process each phase in order:

```
if i == k:
    ShotTime = previous + P / R       # when R > 0
    # otherwise native stores previous

if i == q:
    due = previous + L
else:
    due = previous + D[i] / R         # when R > 0
    # otherwise native adds unscaled D[i]

if i != q and i == 0 and phaseCount > 1 and F >= m and R > 0:
    due = due - due * m / (T - F)

AniDues[i] = Float32(due)
previous = AniDues[i]
```

The first-phase correction at `0x1ef905`–`0x1ef919` changes that deadline;
later deadlines build on the corrected value. It does not redistribute the
removed duration to make the final shot equal exactly `T - F`.

For a synthetic one-phase physical clip with source duration 1.5, shot offset
0.5, `T=1.4` and `F=0`, the native calculation puts the shot at approximately
1.4 and clip deadline at 3.8. Stretching the whole clip to 1.4 would change the
original shot timing. This is a verifier example, not an authored game value.

## Advancement, shot dispatch and cancellation

`MagicProcess` uses `ActiveTime` (`+0x51c`) as one elapsed clock. It advances
when that clock is zero or **strictly greater** than the current cumulative
deadline. Equality does not advance. Nonpositive new deadlines are skipped.
For the selected phase it invokes the exported Pawn `PlayAnim` through
vtable slot `+0x328` with channel zero, the exact selected name, rate `R`,
initial tween `Q` only while elapsed time is zero, and looping enabled only
when the phase index equals `q`. It then adds this update's delta to the
Float32 elapsed clock. It does not advance from a browser clip-end callback.

AttackShot notify delivery sets `PendingNotify` (`+0x59c`): the last shot
sets 2; an earlier shot sets 1 only through the multishot branch.
`MagicProcess` consumes pending shot work through `SkillEffectFinalize`
(`0x211c93`), which increments `StageShot` and invokes `TriggerShot` when an
Agent exists. The notify's last-name comparison uses erased imported calls;
its exact live string helper is not part of this static proof. Completion
also has a conditional finalization path before full cleanup.

Both server `MagicSkillLaunched` overloads call
`AddAssociatedActorNotify` (`0x1925ff`, `0x19c46f`). That path checks the
current action, matching skill identity and target, records the association,
and sets `bTargetExcepted`; it does not directly advance the phase or set the
pending shot flag. Packet arrival and animation notify are distinct inputs.

Server cancellation calls `MagicCancel` at `0x189b15`. The cancellation body
cleans associations/effects, stops spell sound (`0x212a82`), and calls
`FNMagicInfo::Clear(1)` (`0x212b11`). `MagicStop` also uses full clear
(`0x21251b`). Full clear resets phase and flexible indices to -1, elapsed time
to zero, and pending notify flags. Browser deferred work must not resurrect a
cancelled cast after metadata or animation loading completes.

## Bounded browser integration

`native-castschedule.js` now computes all selected ordinary player phases from
the exact skill ID/level, source selector and stance, packet hit time, received
casting-speed field, exact Agent binding and original sequence inputs.
`castanim.js` requires pawn timing format v2 and each clip's `originalTiming`
marker. The [source sequence exporter](pawn-animation-timing-evidence.md)
preserves original Float32 frame rates and normalized notify times, serialized
notify order and boolean AttackShot ancestry. Missing data is distinct from a
verified empty notify list; neither another level nor the first available clip
is a substitute.

`castplayback.js` and `Character.startCastSchedule` apply cumulative deadlines,
the original normalized frame clock, initial positive tween, leftover-delta
handling and bounded loop crossings. Every required rendered clip is checked
before playback starts. One-shots hold their final source pose until the phase
deadline; flexible phases include the original closing interval back to frame
zero. Three still evaluates the exported tracks and tween quaternions: matching
the source clock does not establish native pose interpolation.

Loop closure preserves existing keys. The converter can losslessly collapse a
byte-constant track to its two endpoint keys; this is valid input alongside
dense exact source-frame times. `tools/anim/check_cast_loop_inputs.py --source`
freshly extracts originals, checks actual glTF keys and skeleton correspondence
with the independent recovery verifier, and compares original UKX frame/rate
metadata. All 14 checked `castEnd` clips have four frames at rate 30, with only
dense or byte-constant endpoint tracks. Its ignored receipt records source and
export hashes. The default mode checks sampling shape only; this audit does not
certify other loop slots or native compressed-track interpolation.

Actual `skillCast` events start player schedules; `skillLaunch` remains a
separate target/effect association input, not a phase-advance signal.
Cancellation, actor/model replacement and session changes invalidate deferred
work. Metadata is warmed before normal player entry; an expired cold-load cast
is rejected. A shorter remaining cold-load delay still starts at phase zero,
without an invented seek or missed-notify policy. Unsupported style 13,
single-frame playback, unknown inputs, nonpositive budgets or unavailable
rendered clips produce an explicit unsupported result, not first-phase scaling.

The native/runtime differential tool compares the actual JavaScript planner
with decoded original Agent-lead and arithmetic instructions across selector,
style and boundary cases. Sequence lookups are synthetic inputs to that check;
it does not execute the original renderer or imported helpers. Portable tests
exercise actual Character methods with a Three mixer, phase boundaries, loop
closing, cancellation, source-order notifies and missing-input rejection.

The separate no-login browser inspector replayed Wind Strike 1177/1 for male
human fighter and female dwarf using supplied hit time 6253 ms and casting
speed 213. Both showed opening → `castEnd` loop → `magicShot` → idle; cancelling
during the middle phase returned to idle, and level 999 was unsupported without
fallback. This is a bounded replay through the real Character loader, not a
new live combat or complete-effect verification.

## Remaining fidelity limits

The original protector erased imported calls. This is static reconstruction
supported by exports, branches, source fields and mathematical checks, not a
running unpacked client. The following remain unresolved:

- All speed modifiers and rare type-13/NPC scheduling paths. Agent `+0x74`
  identity and exact source-path selection are now established separately.
- Complete native interpolation and tweening. The
  [animation endpoint evidence](native-animation-terminal-evidence.md) now
  distinguishes the one-shot last pose at `(NumFrames - 1) / Rate` from the
  loop period `NumFrames / Rate`, including its closing interval. A one-shot
  can hold while the scheduler finishes its independent phase deadline;
  stretching every exported key to that deadline is not the native rule.
  Exact quaternion interpolation and source-tail parity for other exports
  remain open; the checked male human fighter export has no early-tail tracks.
- Last-name comparison helpers, multishot/late-target details, callback-mutated
  animation state and full emitter scheduling. The bounded original notify
  clock, ordered batch arithmetic and supported direct animation Sound path
  are now integrated; see [notify evidence](native-animation-notify-evidence.md)
  and [sound evidence](native-cast-sound-evidence.md). Removal-dependent batches
  remain unsupported because of the erased imported array operation.
- Bit-identical x87 rounding and malformed/degenerate time inputs.

The previous first-phase-only whole-clip scaling is superseded for supported
ordinary player casts. NPC casting, full Pawn skill-event particle/sound dispatch,
complete target association and cancellation poses remain separate work. The
old browser callback timing subsystem has been removed; the historical
`verify_castanim.js` reports unsupported rather than certifying its assumptions.

Agent None does not mean that the original client draws no effect. A separate
[native legacy-effects path](native-legacy-skill-effects-evidence.md) selects
Wind Strike's original `m_u000_*` classes and Power Strike's `s_u002_a`.
Compiled dispatch and class availability are established there; placement,
projectile motion and lifecycle remain incomplete. Neither the exact Agent
join nor these recovered dispatches implement the full browser scheduler.
