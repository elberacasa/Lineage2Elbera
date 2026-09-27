# Elbera Tools: original local-pose fallback

This evidence closes the reference-pose input needed when an original mesh bone
has **no animation linkup**. It supports the neutral original-pose inspector;
it does not establish complete live actor animation, blending or modifiers.
No replacement finger name, generated bind pose or guessed identity quaternion
is required.

## Reproduce

The owned-source check requires the pinned Engine/Core binaries and Python with
Capstone. It interprets retained instructions on synthetic memory; it never
executes the client or writes decoded native code.

```sh
python3 tools/ui/check_pose_fallback_native.py --check
```

The default check verifies **49 instruction anchors, six pinned Engine ranges
and 47 actual-instruction cases / 1,044 instructions**. Cases cover raw local
copies, reference selection, conversion arguments, root locking and hierarchy
arguments. Bit patterns include negative zero and NaN payloads to ensure the
*copy evaluator* preserves DWORDs; these are not admitted browser pose values.
There is no floating arithmetic approximation in these copy/address cases.

To also re-read the original male Fighter face/animation and verify the two
supplemental import bindings:

```sh
python3 tools/ui/check_pose_fallback_native.py --check --audit-assets \
  --comparison-engine /path/to/separately-obtained/engine.dll \
  --out tmp/restart-audit/pose-fallback.json
```

That adds **70 original-bone eligibility cases / 1,460 instructions**, for
117 cases / 2,504 instructions total. The receipt contains identities, hashes,
indices and evidence boundaries, not original pose arrays or binary code.

| Input | SHA-256 |
| --- | --- |
| Owned Engine | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Owned Core | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| Optional comparison Engine | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |

The comparison copy has surviving named imports. It is **not authenticated as a
vendor original**, and the corresponding owned sites remain six NOPs. Exact
surrounding-byte correspondence provides a bounded comparison contract, not
proof that those imports are restored in the owned client at runtime. See the
[comparison input boundary](native-hair-attachment-evidence.md).

## Local input flow

The named `USkeletalMeshInstance::GetFrame` body is `0x106d9a70`. The ordinary
nonnegative-frame, special-mode-zero channel path uses the following dataflow:

| Step | Original evidence | Bounded rule |
| --- | --- | --- |
| Temporary mask | `0x106da30a..0x106da328` | Allocate one byte per mesh reference bone. The optional comparison differs only at `0x106da322`, naming Core `FArray::AddZeroed(int,int)`. Owned Core `0x10109110..0x1010917c` zeroes the requested bytes with DWORD and byte stores. Without the comparison input, this checker labels the caller binding unresolved. |
| Channel eligibility | `0x106da560..0x106da5b0` | Start at the channel's base bone (`+0x64`) and propagate eligibility through mesh reference parents. This mask is independent of whether a bone has an animation match. |
| Missing linkup | `0x106da5b0..0x106da5c7` | A negative linkup index skips the sampled record. A zero special-mode field (`channel+0x48`) takes the ordinary sparse sampler. |
| Channel zero | `0x106dabec..0x106dac4e` | Record channel zero copies four quaternion DWORDs and three position DWORDs into the instance local caches (`+0x1c8`, `+0x1d4`), then marks the bone byte as one. This includes the root. |
| Reference selection | `0x106db140..0x106db1ae` | If the byte is zero **or** instance `+0x20c` is nonzero, copy that mesh bone's original reference quaternion and position. Otherwise preserve the cached local values. The `+0x20c` field is left unnamed here. |
| Local coordinates | `0x106db1ae..0x106db1d9` | Call `0x10311252 → 0x106ae320` with quaternion pointer, position pointer and destination coordinate pointer. The retained [coordinate helper](native-pose-coordinate-evidence.md) converts these values. No root-only quaternion sign flip occurs in this bounded copy/conversion path. |
| Root lock | `0x106db1dc..0x106db208` | Only for bone zero, and only when instance `+0x218` is nonzero, replace the three coordinate-origin words with instance `+0x284/+0x288/+0x28c`. Basis rows are untouched by this slice. Named `LockRootMotion` at `0x106aec30` stores its integer argument directly to `+0x218` at `0x106aec70`. |
| First current hierarchy composition | `0x106db9f0..0x106dba33` | The child coordinate record is `this`; the mesh parent’s current coordinate record is the argument. The returned 48 bytes replace the child. The optional exact 67-byte comparison binds `0x106dba22` to `FCoords::ApplyPivotWithoutScale`. |

The mask-allocation comparison is exactly 30 bytes, and the hierarchy comparison
exactly 67 bytes. Each permits one declared six-NOP-to-named-import replacement;
all other bytes must match. No broad relocation masking or ABI guess is used.
Current hierarchy composition starts at bone one: root local coordinates are
already the hierarchy root. Reference-cache construction uses a different
operation, as explained in the [coordinate evidence](native-pose-coordinate-evidence.md).

## The male Fighter missing finger

The fresh source example is `Fighter.MFighter_m000_f` with
`Fighter.MFighter_anim`. The [original linkup rule](native-animation-linkup-evidence.md)
finds 69 of 70 mesh bones. Mesh bone 27, `Bip01_R_Finger01`, has no match; the
animation instead contains duplicate `Bip01_L_Finger01` names at 13 and 27.
Animation index 27 is unused by that first-match join.

With one ordinary channel zero, base bone zero and no reference override:

- Bone 27 receives its **original face mesh reference local quaternion and
  position**, with parent 26.
- Its child 28, `Bip01_R_Finger0Nub`, still maps to animation index 28. A missing
  parent animation match does not clear the descendant eligibility mask.
- Hierarchy construction then places that sampled child under the reference
  local pose of parent 27. Neither the child's animation parent nor an inferred
  renamed finger replaces the original mesh parent relationship.

The audited face export SHA-256 is
`af4ff3431c7adb1153305f1b4b132f3b61c638c8bc689939fd6d1b1990dcf77d`;
the animation export SHA-256 is
`8e7869882afb903a96caca1c5636e2e421a6ed651249957b9fef4a8698bb64ac`.
The decoder reads original packages afresh; generated browser catalogs are not
the oracle for this example.

## Admission boundary

A neutral inspector can explicitly choose one ordinary channel zero, base bone
zero, nonnegative normalized time, root lock disabled and no additional
modifiers. For unmatched bones it must use the exact reference local values of
the actual master mesh. Raw original local quaternion/translation sampling is
separate from both the [sparse-track rules](native-track-evidence.md) and the
coordinate/hierarchy arithmetic.

This is not evidence that those neutral conditions hold for every live actor.
GetFrame has negative-frame tweening, cached-pose reuse, additional channel
blending, special modes, root-motion extraction/locking, scale and direction
arrays, actor virtual look adjustments, and later current-coordinate modifiers.
The observed instance arrays at `+0x190/+0x19c/+0x1a8/+0x1b4` and their counts
must not simply be treated as empty in a faithful live port. Whole-method
scheduling, actor transforms, world basis, skinning and hair attachment are also
outside this input-fallback checkpoint.
