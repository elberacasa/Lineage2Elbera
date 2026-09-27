# Elbera Tools: original effects without a SkillVisualEffect Agent

An empty exact-level `skill_visual_effect` field means **no SkillVisualEffect
Agent**. It does not mean no original visual effects. The original engine
contains a separate legacy path with compiled skill-ID switches and explicit
effect class names. Wind Strike 1177 and Power Strike 3 enter that path.

## Reproduce

```sh
python3 tools/ui/check_legacy_skill_effects_native.py --check
python3 tools/ui/check_legacy_skill_effects_native.py --json
python3 -m unittest discover -s tools/ui -p test_legacy_skill_effects_native.py
```

The verifier checks 49 dispatch, 58 lifecycle and 49 motion/sound instruction anchors, named
export/vtable relationships, four actual ID dispatches, eighteen recovered range fingerprints,
five original classes and their bounded emitter subobject streams. It freshly
decodes the two original DAT records and validates unique class-default
boundaries for eight effect/ancestor classes. Sixty synthetic input cases compare
two call-free physics slices against independent equations. Seventeen source-free tests cover signed and
unsigned comparisons, underflow, overflow, two-stage table selection, missing
flags, unsupported calls, invalid destinations, bounded termination and explicit
Float32 arithmetic. The source-free tests also run with `python3 -S`.

| Private input, relative to `assets/interlude/` | SHA-256 |
| --- | --- |
| `system/engine.dll` | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| `system/LineageEffect.u` | `ea090154c4b8eb2f4fafab331c85fd8f7e42869ec71eb4f11323b546b550114a` |
| `system/skillgrp.dat` | `4e245e914048cee34ada7fb6ed6b499976cbe961ad5bd0a8bfdcf00a1e2288d9` |
| `system/Engine.u` | `9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761` |
| `system/Core.u` | `de5f0ee0a773327bce13c96622fd3c654cff7db88b9be065d1232590c140fda0` |
| `system/Core.dll` | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |

The shared reader recovers Engine's first PE section in memory using its
sentinel-derived additive DWORD key `0x7965b551`, image base `0x10300000`, and
follows original exported `E9` stubs. Nothing executes or emits the original
binary. All code addresses below are RVAs. JSON output includes exact range
hashes, evaluated branch traces, class offsets/hashes and emitter fingerprints.
Capstone and the existing private-input decoding dependencies are required.

## Original selection and dispatch

Fresh source records contain:

| Skill / level | `skill_visual_effect` | `cast_style` | `animation` |
| --- | --- | ---: | --- |
| 1177 / 1 | empty | 2 | `E` |
| 3 / 3 | empty | 3 | `S` |

The [Agent evidence](native-cast-agent-evidence.md) establishes exact-level
path lookup and the Agent-null result. `MagicProcess` loads Pawn Agent
`+0x4f0` at `0x211b1e`. If null, it calls the exported `SkillEffectInit` at
`0x211b39`. Its channeling and preshot branches likewise call legacy
`SkillEffectChanneling` and `SkillEffectPreShot` when Agent is null.

`SkillEffectFinalize` increments StageShot and tests Agent at
`0x211734`–`0x211743`. Its null branch calls legacy `SkillEffectShot` at
`0x211850`. Projectile `processHitWall` tests its own Agent at `+0x538`
(`0x1e9ad9`) and calls legacy `SkillEffectExplosion` at `0x1e9b33` when null.

Those legacy methods select by original MagicID. The verifier evaluates the
actual comparison, subtraction, byte-selector and DWORD-jump instructions;
it does not substitute a hand-authored ID-to-class lookup as its oracle.

| Skill | Legacy phase | Selected block | Original class literals / spawn sites |
| --- | --- | --- | --- |
| 1177 | casting | `0x1f7ec5` | `LineageEffect.m_u000_a`, `0x1f7f08` / `0x1f7f19`; `m_u000_b`, `0x1f8045` / `0x1f8051` |
| 1177 | shot | `0x20862b` | `LineageEffect.m_u000_c`, `0x208680` / `0x2086fc` |
| 1177 | impact | `0x1e4ecd` | `LineageEffect.m_u000_d`, `0x1e5057` / `0x1e50ce` |
| 3 | casting | `0x1f5e83` | `LineageEffect.s_u002_a`, `0x1f5ee8` / `0x1f5ef7` |

Casting calls the exported `AActor::SpawnSkillEffect`. The shot and impact
blocks load explicit original class paths and call `ULevel::SpawnActor` via
its independently named vtable slot `+0xc0`. Some imported class-loading and
vector helper call instructions were erased by the original protection;
their complete execution is not reproduced by this static verifier.

## Original classes and phase conditions

The five named classes exist in the pinned version 123/licensee 30
`LineageEffect.u`. `m_u000_c` derives from `Engine.NSkillProjectile`; the other
four derive from `Engine.Emitter`. Their owned emitter subobject counts are
2, 2, 4, 3 and 3 respectively, all MeshEmitter or SpriteEmitter. The verifier
checks export ownership and consumes every selected emitter property stream
to its declared endpoint. These counts do not by themselves establish all
class-default emitter references, inherited settings or rendering behavior.

Wind Strike's shot block requires `PendingNotify == 2` and a nonnull target
at `0x20862b`–`0x20863e`. It copies the caster's MagicID to projectile `+0x5f0`
and its MagicID/Level into the projectile magic-info structure. The impact
switch reads that copied ID. The lifecycle details below retain the distinction
between an effect actor's lifetime and each emitter's particle lifetime.

## Wind Strike lifecycle: established inputs and open edges

These are original class-default overrides, independently decoded from a
unique complete typed property stream inside each class export. The JSON
records every boundary/hash. They are not invented browser values:

| Original class | Relevant explicit overrides |
| --- | --- |
| `m_u000_a` | `Physics=PHYS_Trailer`, `bTrailerPrePivot=true`, `AutoDestroy=true`, `DrawScale=0.25` |
| `m_u000_b` | `Physics=PHYS_Trailer`, `bRelativeTrail=true`, `AutoDestroy=true`, `DrawScale=Float32(0.1)` |
| `m_u000_c` | `Speed=1000`, `AccSpeed=3000`, `AutoDestroy=true`, `DrawScale=Float32(0.05)` |
| `m_u000_d` | `AutoDestroy=true`, `AutoReset=true`, `DrawScale=Float32(0.1)` |

`m_u000_c` inherits through `Engine.NSkillProjectile`, `Engine.NProjectile`,
`Engine.Emitter`, `Engine.Actor`. The checked `NProjectile` default stream
declares `LifeSpan=100`, collision radius/height 5, and initial class defaults
Speed/AccSpeed 10; `m_u000_c` overrides those last two. This **does not mean
the visible Wind Strike projectile lasts 100 seconds**. Impact, destruction,
emitter completion and actor ticking can end it earlier. The pinned original
Actor source binds enum 10 to `PHYS_Trailer` and 17 to `PHYS_NProjectile`.

**Casting a.** The native call passes the caster as both actor inputs and
selects the owner-relative branch of `SpawnSkillEffect`. For its mode 1, the
helper writes the negative skeletal MeshOrigin.Z times actor DrawScale into
emitter `+0x484` when its mesh path is available, otherwise negative caster
CollisionHeight (`0x1eeff9`–`0x1ef041`). The named exported
`AEmitter::GetTrailerPrePivot` proves `+0x47c/+0x480/+0x484` is that pivot.
For emitter draw type and the pre-pivot flag, `physTrailer` obtains this
getter through vtable `+0x1a8`, adds it to owner location, then moves the
effect (`0x338f24`–`0x338fa1`). This is an actor-origin rule; replacing it
with the browser's bounding-box floor is not source-supported.

**Casting b.** Its initial spawn uses the supplied world position rather
than the actor-input position: caster location plus a vector scaled by caster
CollisionRadius, then `CollisionHeight / 3` in Z. The source vector begins
as `(1,0,0)` and passes through erased native rotation helpers using caster
field `+0x32c`; their complete identity/order is still open. After spawn,
`0x1f8067` sets effect `+0x68` to caster CollisionRadius. The relative-trail
branch of `physTrailer` consumes the vector starting at `+0x68`, rotates it
using owner rotation, and adds owner location (`0x338ea4`–`0x338f10`). The
source `bRelativeTrail` flag and `RelativeTrailOffset` declaration support
this distinct placement path. Initial spawn and subsequent trailer placement
must not be flattened into one guessed permanent offset.

Both casting calls use `SpawnSkillEffect`'s particle-life adjustment path.
For its checked ordinary magic-info condition, it calls the named
`AEmitter::AdjustparticleLife(ShotTime + 1)` (`0x1ef264`–`0x1ef285`) and records
the actor in `FNMagicInfo.EffectActor` at magic-info `+0x6c`
(`0x1ef2db`–`0x1ef2fe`). The helper also has a cylinder-dependent
`SetSizeScale` branch, including a source divisor 9, for nonzero placement
mode. Its complete emitter-level effect is not evaluated by this checkpoint.

Casting b separately copies Pawn ShotTime `+0x514` into actor `+0xe8`
(`0x1f806a`/`0x1f8070`). `AActor::TickAuthoritative` independently establishes
that field's lifetime behavior: if nonzero, subtract delta, store Float32,
then call `ULevel::DestroyActor` when the result is at most source
`0.00009999999747378752` (`0x2d2f01`–`0x2d2f46`). This is not the particle
life adjustment. `FNMagicInfo::Clear` touches its effect array, but calls in
that recovered loop are erased; its full destruction policy remains open.
The explicit array destruction in `SkillEffectFinalize` is a separate Pawn
array and is not treated as proof of `EffectActor` cleanup.

**Projectile c.** Creation uses caster location with `CollisionHeight / 3`
in Z, caster rotation and caster ownership. It explicitly calls the named
`setPhysics` with enum 17, then records TargetActor and skill identity.
`ANSkillProjectile::Tick` refreshes its stored target vector `+0x4e8` by
calling the target's virtual `GetTargetLocation` using owner location; its
owner-absent alternative calls `GetEffTargetLocation`
(`0x1e356b`–`0x1e35c7`). It then calls `ANProjectile::Tick`.

The target and motion details below establish more of this path, including
its arithmetic and important unresolved native calls. Speed/AccSpeed defaults
alone do not justify a fixed-duration linear browser projectile.

**Impact d.** The selected native block derives a rotation from its incoming
hit vector and transforms source `(Float32(1.2),0,0)` through erased helpers.
With no hit actor, it spawns at the projectile's stored target point. With
a hit actor, it subtracts that transformed vector times the hit actor's
CollisionRadius from the stored point (`0x1e4f47`–`0x1e4ff1`). The hit actor
is the new effect's owner. Exact transformation and target reaction helpers
remain open. This class uses its own emitter/default lifecycle; the selected
impact block does not supply a made-up fixed duration.

After the impact call, `processHitWall` invokes the named
`ANSkillProjectile::PreDestroy` through slot `+0x334` (`0x1e9ba1`/`0x1e9ba7`).
That forwards to `ANProjectile::PreDestroy`, which either calls level
destruction or a virtual deferred destruction path according to its original
pre-destroy flag (`0x1e2ce8`–`0x1e2d10`). The proof preserves that condition.

## Target point and bounded projectile equations

**Target selection is a bone-coordinate rule.** Actor, Pawn, Emitter,
NProjectile and NSkillProjectile vtable `+0x2b4` all inherit the named
`AActor::GetTargetLocation` (`0x28ac0`). It forwards its output reference to
`eventGetEffTargetLocation`; it does not use the source-location parameter.
The original Actor event returns actor Location. Pawn overrides it: use
`EffectSpawnBoneIdx` when it differs from −1; otherwise use `SpineBone` when
present; otherwise use bone index 0. The returned point is that bone
coordinate system's origin. No fixed target height occurs in this event.

The verifier fingerprints the original Actor/Pawn ScriptText and their
compiled event exports (37/102 bytes). It verifies the source branch order;
it does not execute their VM bytecode. Native `execGetBoneCoords` and
`execGetBoneCoordsWithBoneIndex` both call the named
`USubSkeletalMeshInstance::GetBoneCoords` (`0x3b79e0`). That method obtains
the instance's named `MeshToWorld(1)` through slot `+0x128`
(`0x3b7a80`–`0x3b7a99`) before combining coordinates. The matrix-combination
imports remain erased. A renderer must supply the actual transformed bone
origin; a browser mesh floor or arbitrary target offset is not a replacement.

**Update order matters.** `ANSkillProjectile::Tick` first refreshes the
target point, then enters `ANProjectile::Tick`. The latter first calls
`AEmitter::Tick` (`0x1e24d7`), which first calls `AActor::Tick`
(`0x30bd74`). For the authoritative actor branch, its named
`TickAuthoritative` invokes `performPhysics` before returning. The actual
physics selector maps enum 17 to `physNProjectile` at `0x33f5ed`.
Only after emitter/actor ticking does `ANProjectile::Tick` perform its
ordinary steering. Actor role, deletion and alternate tick branches retain
their native conditions; this is not a claim that every actor always moves.

**The import-free arithmetic is implementable on its own.** Let `f` mean a
Float32 store, `dt` the supplied Float32 delta, and `V`/`A` the actor's current
Float32 Velocity/Acceleration fields. The effective volume input `F` is zero
when volume `+0x490` bit `0x20` is clear, otherwise volume float `+0x474`.
For each component, `0x33de4d`–`0x33df28` computes:

```text
k = f(1 − F × 0.20000000298023224 × dt)
VbeforeBound[i] = f(f(V[i] × k) + f(A[i] × dt))
```

The coefficient is the original qword at VA `0x108a0530`, equal to promoted
Float32(0.2). There is no clamp on `k` in this slice. Next, native calls
the inherited `AActor::BoundProjectileVelocity` through slot `+0x1d0`.
Given that helper's actual output `Vbounded`, the next import-free slice
(`0x33df39`–`0x33df71`) computes `MoveDelta[i] = f(Vbounded[i] × dt)`.
The tool intentionally requires that bound result as an external input;
it does not insert a guessed bound. Mover type 3 and Hermite branches can
subsequently replace this displacement and are outside these equations.

The straight-line evaluator rejects calls, NOPs (which can hide erased
imports) and undeclared memory. Sixty cases compare decoded instructions
with the equations exactly at Float32 outputs. Python Float64 intermediates
approximate x87 extended precision; this finite comparison is not a universal
bit-exact x87 proof. It tests zero delta, mixed directions, large values,
friction and an unclamped negative factor. Portable tests include a case
where omitting intermediate Float32 stores changes the answer.

**The remaining helper boundaries prevent complete motion certification.**
Ordinary steering stores each component of `LastTargetLocation − Location`
as Float32, passes it to the erased vector-return call at `0x1e26ab`, and
uses that result as a direction. The erased scalar-return call at
`0x1e274e` consumes current Velocity; its Float32 result overwrites Speed
`+0x4dc` at `0x1e275a`. Steering then multiplies those results and separately
multiplies the direction by AccSpeed. It is tempting to label those imports
SafeNormal and Size, but that binding is not recovered. Core's distinct
SafeNormal/UnsafeNormal, Size/SizeSquared and IsZero/IsNearlyZero exports
fit the corresponding call shapes; the verifier records them without
selecting one. The bound helper itself contains erased predicate, scalar
and vector calls (`0x333783`–`0x3337ce`). Consequently its apparent magnitude
clamp cannot yet be ported as a proven equation.

Wind's creation block does not explicitly initialize Velocity. It calls
`setPhysics(17)` before assigning TargetActor; the conditional target-facing
branch inside `setPhysics` is not proof of a velocity assignment. Its checked
class chain declares no Velocity, Acceleration or Hermite override. Absence
of a serialized override does not prove the live post-construction fields
are zero. Do not set initial speed to 1000 merely because that default exists,
or to zero merely because an override is absent.

The arrival code compares the same helper's result for old→new movement
and old→target distance, then snaps to the stored target, invokes
`processHitWall` and sets physics zero. That helper at `0x73830` includes an
erased scalar call after forming squared-component sums (`0x7388f`). Its
complete distance operation, world collision behavior, residual-direction
normalization and the impact's rotation helpers remain open. An unobstructed
linear interpolation does not reproduce this whole path. A faithful full
projectile still needs those bindings and verified live initialization,
followed by actual bone and emitter evaluation.

## Legacy sound owners

These branches complement the [native sound evidence](native-cast-sound-evidence.md).
Wind casting joins the common type-1 sound tail with **the caster as effect
owner** (`0x1f8076` and the failed-second-spawn path `0x1f43e6`). Power Strike
casting retains the successfully spawned `s_u002_a` as that owner; its null
result suppresses the common sound. Wind shot reaches the type-2 tail only
after its pending-final-shot, target and successful-spawn gates; its owner is
the new projectile (`0x207f98`). Guard or spawn failure skips that tail.
These owner choices are not evidence of a particle lifetime or travel timer.

## Animation-notify distinction and implementation boundary

The exported `UAnimNotify_AttackShot::Notify` writes Pawn PendingNotify
`+0x59c` as 2 or 1 (`0x3bd18c`, `0x3bd1a3`). `MagicProcess` consumes pending
shot work through `SkillEffectFinalize`. This phase trigger must not be
conflated with selecting a SkillVisualEffect Agent.

The generic `UAnimNotify_Effect::Notify` is another path: it tests its own
class reference at `+0x38` (`0x3bdb43`/`0x3bdb48`) and passes that reference
to a level spawn (`0x3bdc45`–`0x3bdc4d`). The verifier does not claim that a
generic Effect notify occurs in every skill, or that it supplies Wind Strike's
legacy effects. Agent presence is not a universal switch for all animation
notifies or effects.

A faithful port should keep exact Agent bindings and proven legacy dispatch
as distinct paths. Selecting a same-ID Skill.usk object or matching a display
name is not a replacement for these original branches. The old
`build_skillfx.py` name-convention mechanism is a diagnostic heuristic; its
docstring now explicitly says so.

This checkpoint proves selection, original default overrides and bounded
placement/lifecycle dataflow. The remaining native helper, initialization,
particle and cleanup gaps above prevent claiming a faithful complete effect
renderer. Power Strike's shot/impact and other IDs are outside this bounded
proof. No browser runtime or generated assets were changed here.
