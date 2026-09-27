# Original local-pose tween: bounded source evidence

Elbera Tools now separates the original **negative-frame tween** from ordinary
sparse-track interpolation. The reusable helper evaluates one mapped source
bone in an ordinary channel-zero transition. It does not choose a sequence,
construct a prior pose, own animation state, or establish complete playback
parity. In particular, the first transition with a zero previous tween frame
remains explicitly unsupported by its default API.

## Reproduce

```sh
# Portable authored fixtures, no original inputs or Capstone.
node --test editor/world/test/nativetween.test.mjs
node tools/ui/test_pose_tween_native.mjs

# Retained owned instructions and Core math only.
python3 tools/ui/check_pose_tween_native.py --check

# Explicit supplemental Engine: exact call-site correspondence and JS comparison.
python3 tools/ui/check_pose_tween_native.py --check --js \
  --comparison-engine /private/path/system/engine.dll
```

The source checker reads pinned inputs and uses Capstone. It interprets narrow
instruction slices on synthetic memory; it never executes native code, writes
decoded binaries, changes assets, or downloads the comparison input. Without
`--check`, it returns a JSON receipt with source hashes, byte ranges, named
imports, cases and limits. Its portable formulas import without originals or
site packages.

## API and caller responsibilities

[`tweenOriginalLocalPose`](../editor/world/js/nativetween.js) accepts:

```js
{
  cacheValid,                            // explicit boolean
  frame, frames,                         // negative normalized frame; source NumFrames
  sequenceId, previousSequenceId,         // caller-bound original FName identity tokens
  previousFrame, accumulated,             // original channel bookkeeping
  cached: { quaternion, position },       // prior displayed SOURCE LOCAL pose
  firstKey: { quaternion, position },     // raw first original q/p, for valid cache
  frameZeroPose: { quaternion, position }, // ordinary sample(0), for invalid cache
  floatingPointEnvironment: 'win32-default' // optional explicit masked policy
}
```

It returns `status:'ready'`, `mode:'tween'|'frame-zero'`, new quaternion and
position, fraction, hemisphere/branch metadata, and
`state:{previousFrame,previousSequenceId,accumulated}`. Missing, malformed or
nonfinite inputs return `status:'unsupported'` with a reason. Inputs are never
mutated. Sequence tokens must already represent the original equality domain;
the helper does not invent aliases or lowercase names.

For **valid cache**, supply the raw first quaternion and position. The native
tween reads those arrays directly; it does not sample an advancing destination
clip. For **invalid cache**, supply the ordinary sampler's frame-zero result.
These are deliberately separate inputs: an original short first key interval
can take the ordinary sampler's small-denominator branch and select the next
key even at time zero. Copying raw first keys would then be incorrect. Invalid
cache skips tween normalization and leaves channel bookkeeping unchanged.

Every bone in one channel uses the **same incoming bookkeeping snapshot**.
Commit the returned state once after evaluating the whole pose. The cached
local q/p must be the previous source evaluation, not a Three.js decomposition,
an exported glTF sample, or a frozen pose resampled from the old clip. Missing
animation links use the separately proved [reference fallback](native-pose-fallback-evidence.md).
Root overrides, other channels, special modes, scale interpolation and later
modifiers are outside this helper.

## Pinned source and call correspondence

Owned Engine SHA256:
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`.
Owned Core SHA256:
`9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf`.
Optional supplemental Engine SHA256:
`508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d`.
The supplement is an unauthenticated archive copy; its
[provenance and exact-comparison limits](supplemental-engine-evidence.md) remain
material. Named imports in that copy do not prove restoration of six-NOP call
sites in the owned recovered image.

Named `USkeletalMeshInstance::GetFrame` resolves to owned `0x106d9a70`,
supplemental `0x106d9a30`. Five bounded blocks match exactly after only declared
six-NOP/import substitutions and two same-target direct-call displacements:

| Owned range, exclusive end | Bytes | Specific evidence |
| --- | ---: | --- |
| `0x106afd00–0x106afe3b` | 315 | Complete separate tween quaternion helper; constructor, `appAcos`, three `appSin` calls |
| `0x106da791–0x106da809` | 120 | Fraction/reset bookkeeping; Core `FName::operator!=` |
| `0x106da975–0x106daa65` | 240 | Raw first keys, cached locals, hemisphere call, tween call and Core `FQuat::Normalize` |
| `0x106d9aa0–0x106d9ad3` | 51 | Empty channel creation calls `FArray::AddZeroed(0x70,1)`, then `Shrink` |
| `0x106c4ae0–0x106c4b6e` | 142 | Named `SetMesh` clears its coordinate/cache arrays with `FArray::Empty` |

Supplemental addresses in these blocks are owned addresses minus `0x40`.
Core's named bodies are checked independently: `FName::operator!=` at
`0x10109d60` compares the two stored DWORDs; the three-byte `FQuat` default
constructor at `0x10110a80` does not initialize components; `FQuat::Normalize`
at `0x10110cc0–0x10110d60` contains the normalization and fallback below.
Its retained `0x10110d02→0x10104840→0x1012d790` call reaches named `appSqrt`.
The verifier checks the direct tween and hemisphere thunks separately.

## Recovered arithmetic

`F(x)` denotes an explicit Float32 store. Unmarked arithmetic uses the
implementation's Float64 approximation of x87 intermediates; named math calls
use host `acos`, `sin` and `sqrt`. This is bounded compatibility, not a proof
of universal x87/CRT bit equality.

For finite nonzero previous frame, the original bookkeeping computes:

```text
fraction = F(1 - currentFrame / previousFrame)
startFrame = F(-1 / NumFrames)
if previousName != currentName or fraction < 0 or fraction > 1:
    fraction = 0
    previousFrame = startFrame
    previousName = currentName
    accumulated = 0
else:
    previousFrame = currentFrame
    accumulated = F((1 - accumulated) * fraction + accumulated)
```

The ratio is not separately rounded before subtraction. Zero and one are
accepted by the source comparisons. The browser entry point remains limited
to current negative frames; the source checker also tests the arithmetic
boundary at zero. A reset does not simply skip quaternion processing:
normalization still runs with fraction zero.

The caller first adjusts the **destination** quaternion against the cached
quaternion using the [retained hemisphere helper](native-track-evidence.md).
It compares the source-ordered, Float32-stored squared lengths of their sum
and difference, negating the destination only when the sum is strictly shorter.
Let `A` be cached and `B` the adjusted first key:

```text
dot = F(((A0*B0 + A1*B1) + A2*B2) + A3*B3)
if dot >= 1:
    q = A
else:
    theta = F(acos(dot))
    inverseSin = F(1 / sin(theta))
    a = F(sin((1-fraction)*theta) * inverseSin)
    b = F(sin(theta*fraction) * inverseSin)
    q[i] = F(a*A[i] + b*B[i])

square = F(((q1*q1 + q0*q0) + q2*q2) + q3*q3)
if square < F(0.00001):
    q = [0, 0, F(0.1), 0]
else:
    reciprocal = F(1 / F(sqrt(square)))
    q[i] = F(q[i] * reciprocal)

position[i] = F(cached[i] + F(F(first[i] - cached[i]) * fraction))
```

This separate quaternion helper has neither the ordinary helper's `0.55`
linear branch nor its `0.9999998807907104` copy threshold. Core normalization
runs even after a raw copy. The tiny-result tuple is source data, not the
identity quaternion. No dot clamp, input normalization, scale tween or generic
host slerp is substituted.

## Cache and clock boundaries

The retained GetFrame gate `0x106da42b–0x106da450` selects tween only when
channel frame `+0x10` is negative and instance `+0x1fc` is nonzero. Otherwise it
clamps ordinary sampling time to zero and follows the ordinary track path.
Both ordinary positive sampling and cache-invalid negative sampling bypass
the channel bookkeeping block: they do not store positive current frame into
previous tween frame `+0x68`, or overwrite cached name `+0x6c`/accumulator `+0x60`.

When the local quaternion cache count `+0x1cc` is zero, GetFrame allocates its
q/p arrays and directly clears every channel `+0x68` to zero at
`0x106d9e27–0x106d9e4d`. The valid-local-cache flag is set to one at
`0x106db21e`, after local coordinate construction. Named `SetMesh` empties the
arrays; its inspected direct body does not clear `+0x1fc`. This is not an
exhaustive proof of every invalidation path or constructor/default value.

Consequently **zero previous frame is a real source boundary**, not permission
to initialize it to `-1/NumFrames`. The checker additionally interprets four
conditional cases with an explicitly masked x87 divide-by-zero. Negative
current divided by `+0` or `-0` yields signed infinity; the retained name/range
branches then reset to fraction zero, previous frame `F(-1/N)`, new name and
zero accumulator. This proves the result **if the divide is masked**. The separate
[floating-point environment evidence](native-animation-fpu-evidence.md) now binds
this case to documented normal Windows/CRT defaults and owned mask-preserving
startup/renderer paths. Callers explicitly supplying
`floatingPointEnvironment: 'win32-default'` admit the reset; the library still
rejects zero previous frame when that policy is absent. The unreferenced Core
`FNINIT` is not asserted to run. Modified or unknown process environments remain
outside the admission contract.

The existing [animation clock evidence](native-animation-terminal-evidence.md)
separately covers initial negative frame, tween rate, crossing zero with leftover
delta, and the shared four-step update cap. Callers should pass its actual frame;
this helper does not derive a frame from wall-clock duration or seek past missing
metadata. Ordinary frame sampling must continue preserving source local q/p if
a later native tween is to use them.

## Measured checks and remaining work

The checkpoint passes 13 browser-helper tests and 12 portable Python tests.
The source checker verifies 31 instruction anchors, six owned range hashes,
three named Core bodies and, with the explicit supplement, five exact blocks.
It interprets **510 cases / 36,071 instructions**, including separate source
endpoint sentinels, quaternion branches, hemisphere ties, reset boundaries,
position store order, cache allocation and four conditional masked-zero cases.
There are 127 JS/Python comparisons: state/position results match exactly;
quaternion comparison allows `2e-6` for host math implementation differences.

Missing linkups, root lock, special modes, multichannel mixing, actor modifiers,
altered native exception state and complete cache lifetime remain separate.
The [live browser adapter](original-animation-runtime.md) now uses this helper
for transitions from known evaluated source locals and separately proved fresh
frame-zero initialization. Unknown playback history remains gated;
this does not declare the whole browser animation or exported skinning native-exact.
