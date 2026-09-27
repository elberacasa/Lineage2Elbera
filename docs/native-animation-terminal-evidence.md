# Elbera Tools: original animation endpoints and loop closure

The original skeletal renderer distinguishes a sequence's **period** `N / R`
from its one-shot **sample span** `(N - 1) / R`, where `N` is its source frame
count and `R` its source rate. A loop traverses the closing interval back to
the first pose; a one-shot stops at its last normalized frame. This establishes
a timing correction, not complete parity for the current exported poses.

## Reproduce

```sh
python3 tools/ui/check_anim_terminal_native.py --check
python3 tools/ui/check_anim_terminal_native.py --json
python3 tools/ui/check_anim_terminal_native.py --audit-fighter --json
python3 -m unittest discover -s tools/ui -p test_anim_terminal_native.py
```

The verifier checks 90 original instruction anchors, thirteen recovered range
hashes, named exports and vtables. A tiny evaluator consumes both original
normalization snippets for eight finite synthetic cases and compares their
Float32 stores with independently written equations. Another bounded evaluator
consumes the original positive-tween and loop-crossing instructions for four
tween cases and three loop crossings; five source-free tests cover operand
order, stack stores, per-store rounding and rejection of unsupported code.
Its Float64 intermediate
arithmetic does not claim x87 extended-precision bit equality. No original
code is executed or emitted; no assets are modified.

Private input `assets/interlude/system/engine.dll` has SHA-256
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`.
Image base is `0x10300000`. The shared reader derives the additive DWORD key
`0x7965b551` from the exported UTF-16 sentinel and recovers the first PE
section in memory, then follows original export `E9` stubs. See
[the scheduler evidence](native-cast-scheduler-evidence.md) for the related
source phase deadlines and the recovery limitations.

| Original export | Body RVA |
| --- | --- |
| `USkeletalMeshInstance::PlayAnim` | `0x3b2fe0` |
| `USkeletalMeshInstance::UpdateAnimation` | `0x3ba8d0` |
| `USkeletalMeshInstance::PoseFrame` | `0x3c6f90` |
| `USkeletalMeshInstance::GetFrame` | `0x3d9a70` |
| `USkeletalMeshInstance::AnimGetFrameCount` | `0x3ae970` |
| `USkeletalMeshInstance::AnimGetRate` | `0x3ae990` |
| `USkeletalMeshInstance::IsAnimLooping` | `0x3b2a20` |

The verifier's JSON includes exact exclusive ranges and SHA-256 fingerprints
for normalization, endpoint advancement, key selection and interpolation.
Addresses below are RVAs, unless explicitly marked VA.

## One-shot endpoint and loop period

Named getters identify sequence integer `+0x14` as `NumFrames` and float
`+0x18` as `Rate`. `PlayAnim` calls these through skeletal-instance vtable
slots `+0xc8` and `+0xcc`. Channel records are `0x70` bytes; the named looping
getter reads channel `+0x30`.

Both one-shot normalization (`0x3b3170`–`0x3b3193`) and new-loop normalization
(`0x3b341c`–`0x3b3442`) store:

```
baseRate     = Float32(R / N)                    // channel +0x20
playbackRate = Float32(baseRate * multiplier)    // channel +0x0c
lastFrame    = Float32(1 - 1 / N)               // channel +0x14
```

The frame clock at channel `+0x10` is normalized. Once initial tweening has
finished, ordinary positive playback advances it by rate times delta at
`0x3baae8`–`0x3baaf0`.

At the one-shot endpoint, `UpdateAnimation` clamps that clock to `lastFrame`
(`0x3bade1`/`0x3bade4`) and stops its rate (`0x3badfd` or `0x3bae0e`). For a
loop, it retains the final interval until normalized frame 1, then resets to
zero and processes the leftover delta (`0x3bad78`–`0x3badca`). The original
update caps this internal iteration at four. Reverse-rate, notify callback
reentrancy and special root-motion behavior remain outside this bounded proof.

Ignoring Float32 rounding and initial tweening, a 30-frame sequence at 30 fps
therefore reaches its last one-shot pose at 29/30 second; its loop period is
one second. These are synthetic arithmetic values, not authored game data.
`N = 1` has a distinct native tween-only setup branch: the normalization result
is verified, but ordinary multi-frame advancement must not be applied to it.

The cast scheduler separately uses `N / R` and cumulative phase deadlines.
Its next phase must not be triggered by the browser clip's end event. A
one-shot may hold its last pose while that scheduler finishes its phase.

## Initial tween and the per-update clock

For a new ordinary multi-frame sequence and **positive** caller tween time
`Q`, `PlayAnim` stores `tweenRate = Float32(1 / (Q * N))` in channel `+0x18`
and `frame = Float32(-1 / N)` in `+0x10`. Caller `Q` and `N` are already
Float32. The one-shot branch is `0x3b320e`–`0x3b323b`; the new-loop branch
stores the same values at `0x3b34dc`/`0x3b34e5`. These are separate from
`playbackRate`; the new sequence does not advance through positive source
time while the normalized clock is negative.

`UpdateAnimation` advances a negative clock at `0x3bae16`–`0x3bae27`:

```
newFrame = Float32(oldFrame + Float32(delta) * tweenRate)
```

If this crosses zero, `0x3bae30`–`0x3bae48` preserves the leftover time and
resets the frame to zero:

```
remainingDelta = Float32(Float32(delta) * newFrame / (newFrame - oldFrame))
frame = 0
```

It then reenters the ordinary update with that remainder. Ordinary positive
playback stores `Float32(frame + playbackRate * delta)` each update; deriving
the frame once from total elapsed time discards the original repeated-store
rounding. Ignoring rounding, the positive tween lasts `Q` and the remainder
advances the new sequence in the same update.

**Zero** tween time takes a different path: one-shots start at Float32
`0.001` (`0x3b334e`–`0x3b3360`, constant VA `0x108d7100`); new loops start
at Float32 `0.0001` (`0x3b3601`–`0x3b3613`, VA `0x108c50a4`). Both store
zero tween rate. The source's `Q = -1` automatic-tween branch and the
already-playing same-loop continuation shortcut are distinct and are not
covered by this new-sequence rule. `N = 1` also has its separate setup.

Crossing a loop's normalized frame 1 uses the analogous original arithmetic
at `0x3bad98`–`0x3badb2`:

```
remainingDelta = Float32(delta * (newFrame - 1) / (newFrame - oldFrame))
frame = 0
```

It reenters the update rather than applying modulo. Reaching `lastFrame`
while remaining below 1 keeps the frame and consumes the delta. The positive
delta loop increments one per-channel counter before advancement and stops
when it exceeds four (`0x3baab6`–`0x3baac2`). Tween crossings, loop crossings
and native notify splits share that budget; there are at most four advance
iterations in one channel update. Any remaining delta at that cap is not
carried into the next update in this routine. The evaluator checks crossing
arithmetic, not every notify callback or original actor event.

The rendering `GetFrame` path explicitly reads the **first compressed key**
of the new sequence (`0x3da975`–`0x3da9b5`) and the cached displayed bone
translations/quaternions (`0x3da9bc`/`0x3da9e0`). It does not keep advancing
the old animation to produce the tween source. Its incremental fraction is
`1 - currentNegativeFrame / previousNegativeFrame`
(`0x3da791`–`0x3da7a2`), with cached sequence/frame and accumulated fraction
bookkeeping through `0x3da806`. Ordinary translation blends from the cached
displayed translation toward that first key; repeated increments yield the
same linear frozen-pose transition in the uninterrupted, exact-arithmetic
case. First evaluation, absent pose caches, channel masks and interrupted
tweens have additional bookkeeping and are not reduced here to one formula.

The tween quaternion path is a **different helper** from ordinary track
sampling: hemisphere adjustment at `0x3daa29`, then stub VA `0x1030e37c`
to body `0x3afd00`. Its imported trigonometric calls remain erased. A browser
that freezes the displayed exported pose, holds the new clip at its first
pose during `Q`, and processes leftover delta follows this clock/pose-source
evidence; it still must not claim exact native quaternion blending.

## Last-key interpolation

`PoseFrame` gets the source movement through the named `GetMovement` vtable
slot `+0x70`, clamps the normalized frame to `[0, 1]`, and multiplies it by
movement `+0x10` at `0x3c74c0`/`0x3c74c3`. UEViewer names the corresponding
source duration `TrackTime`; native dataflow establishes the role directly.
Both `PoseFrame` and the rendering `GetFrame` call stub VA `0x1030777f` with
the final special-mode argument zero. That stub leads to `0x3bb6a0`.

For this ordinary bone path, the helper finds the preceding key, then uses
the following key. Past the final key it chooses key zero and sets a wrap
flag (`0x3bb75b`–`0x3bb76c`). The closing interpolation fraction is:

```
alpha = (sampleTime - lastKeyTime) / (movementDuration - lastKeyTime)
```

The original includes a small-denominator fallback and constant-track cases;
this equation describes the ordinary positive-denominator case. Translation
uses a linear blend. Wrapped quaternion endpoints receive a hemisphere
adjustment through stub VA `0x10307e96`, body `0x3b56d0`.

Quaternion interpolation at `0x3ae090` is **not established as exactly glTF
slerp**. It copies the first quaternion for a dot product above
`0.9999998807907104`; another branch uses normalized linear blending above
source Float32 `0.55`. The remaining branch has erased imported math calls.
Their surrounding arithmetic resembles spherical interpolation, but those
imports have not been independently identified. Special/root-motion sampling
with the final argument nonzero is also outside this proof.

## Exporter consequence and bounded recommendation

Local UEViewer revision `a0bfb468d42be831b126632fd8a0ae6b3614f981` provides
exporter implementation evidence, not proof of original client behavior:

- `Unreal/UnrealMesh/UnAnim2.cpp::ConvertAnims` retains source `NumFrames` and
  `Rate` and scales compressed key times by `NumFrames / TrackTime`.
- `Exporters/ExportPsk.cpp::ExportPsa` samples integer frames `0 .. N-1` using
  `GetBonePosition(..., Loop=false)` and writes PSA key time 1.
- `Unreal/Mesh/SkeletalMesh.cpp::GetKeyParams` clamps to the last compressed
  key when that exporter call samples beyond it.
- `tools/src/char_pipeline/assemble.py` reads the PSA's frame count/rate and
  emits glTF sample times `f / R`, ending at `(N-1) / R`. It does not retain
  the original compressed key times or original movement duration.

Thus two separate issues exist. The missing closing interval shortens loop
periods. Separately, if a compressed source track ends before sample `N-1`,
the exported late poses can differ from original wrap interpolation. The
direct measurement below found **no such early-tail tracks** in the male
human fighter export. This remains a check for other source exports, not a
demonstrated defect in those measured animations.

## Direct original source-tail measurement

`--audit-fighter` reads the owned `assets/interlude/animations/Fighter.ukx`,
SHA-256 `8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c`.
The `MFighter_anim` export occupies decoded bytes `[33801, 3270568)` and has
SHA-256 `8e7869882afb903a96caca1c5636e2e421a6ed651249957b9fef4a8698bb64ac`.
It contains 70 reference bones and 114 sequences. The bounded parser uses the
original package's version 123/licensee 30 and MeshAnimation version 1,
checks every declared movement endpoint, the outer movement endpoint and
the complete export endpoint, and associates sequence headers with their
original compressed tracks. It emits counts and times, not proprietary poses.

All 114 sequences have zero nonconstant tracks whose last key precedes
`N-1` in sequence-frame units. The selected casting records are:

| Source sequence | Frames | Rate | Movement duration | Nonconstant tracks | Earliest final key |
| --- | ---: | ---: | ---: | ---: | ---: |
| `CastLong_MFighter` | 115 | 30 | 115 | 43 | 114 |
| `CastEnd_MFighter` | 4 | 30 | 4 | 11 | 3 |
| `CastMid_MFighter` | 55 | 30 | 55 | 39 | 54 |
| `CastShort_MFighter` | 25 | 30 | 25 | 30 | 24 |
| `Magicshot_MFighter` | 46 | 30 | 46 | 45 | 45 |

Consequently the hypothesized clamp-versus-wrap difference before `N-1`
does not occur for this checked export. The missing **loop closing interval**
and unresolved exact **subframe quaternion interpolation** are separate
findings and remain relevant. This audit does not measure other race, NPC,
effect or root-motion exports, nor compare every exported pose numerically.

## Playback recommendation

A bounded timing repair should preserve every original exported sample time,
retain source `N` and `R`, and use separate one-shot and loop playback forms.
One-shots clamp to their last pose while the independent source scheduler
controls transitions. Loops can append the first pose at `N/R` to restore the
source period and closing interval. This derived closure introduces no new
authored pose, but remains an **exported-pose approximation** until compressed
source-tail samples and native quaternion interpolation are verified.

Do not stretch all existing times to `N/R`, and do not label the approximation
pixel-exact or native-exact. Full fidelity needs original compressed keys,
their source times and the native evaluator, or a proven export of equivalent
poses. No private glTFs or browser animation code were changed by this audit.
