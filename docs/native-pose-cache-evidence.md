# Original ordinary pose-cache lifetime

Elbera Tools records the ordinary same-owner `USkeletalMeshInstance::GetFrame`
cache gate and narrowly established channel initialization. This is evidence for
preserving the last **evaluated local q/p pose** across an animation transition.
It does not establish the render loop's call ordering or a new initial pose.

## Reproduce

```sh
python3 -S -m unittest discover -s tools/ui -p test_pose_cache_native.py
python3 tools/ui/check_pose_cache_native.py --check
python3 tools/ui/check_pose_cache_native.py --check \
  --comparison-engine /path/to/pinned/supplemental/engine.dll
```

The portable helpers use only the standard library and authored state. The
original-source check requires Capstone and the privately owned Engine/Core
files. It checks 40 instruction anchors and interprets the retained instruction
slices for 120 repeat-key, six marker-store and four empty-array-reset cases.
The optional supplemental check also compares five exact blocks. Default JSON
output includes source/range hashes and explicit limits; no decoded binary or
original pose is written.

Pinned owned Engine SHA256:
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`.
Owned Core SHA256:
`9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf`.
Supplemental Engine SHA256:
`508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d`.
Its archival provenance and authentication limits remain those of the
[supplemental source evidence](supplemental-engine-evidence.md).
The comparison does not restore or execute the protected owned client.

## Repeat evaluation is keyed by counter and frame

The retained entry at `0x106d9b79..0x106d9bb2` compares two DWORDs at instance
`+0x6c/+0x70` against a pointed-to 64-bit global, and the Float32 at `+0x74`
against the current channel-zero frame. Both counter halves and ordered float
equality must match. Signed zero compares equal. Sequence identity is **not**
part of this key. NaN behavior and floating-point exception policy are outside
the portable helper's finite-input domain.

The 57-byte entry block matches the supplemental block at VA minus `0x40`
except exactly one declared absolute IAT operand. Supplemental IAT
`0x11d8e180` names Core `GTicks`; the owned operand is `0x11d8e188`. The
35-byte downstream block `0x106da2a4..0x106da2c7` likewise differs only in its
one global IAT operand, binding the supplemental `0x11d8dbe0` to Core
`GIsEditor` (owned slot `0x11d8dbe4`). No arbitrary address normalization is
allowed by this comparison.

At `0x106da2b1..0x106da2c1`, a matching key with editor mode off jumps to
`0x106dc0f9`. This bypasses the ordinary sampling, tween bookkeeping, q/p
fallback and current-coordinate hierarchy calculation. Later optional output
work remains; this is not an early return from the entire method.

Three setup conditions clear the repeat decision:

- Empty q-cache (`+0x1cc == 0`), at `0x106d9dde..0x106d9de9`.
- Current-coordinate count (`+0xc8`) differing from source bone count, at
  `0x106d9e4d..0x106d9e66`.
- Empty source reference-coordinate table (`mesh+0x304 == 0`), at
  `0x106da03a..0x106da051`.

Mode argument `3` suppresses marker writes. Other modes write the current frame
and 64-bit counter at `0x106d9dbd..0x106d9dd1`, **before** pose work. Mode `3`
does not itself invalidate a previously matching key. The 39-byte marker block
has the same exact supplemental global correspondence. A successful-pose-only
browser commit policy is therefore an application policy, not a description of
native marker-store timing.

This is not a universal one-evaluation-per-tick rule: a different frame can
evaluate again during the same `GTicks`. Using one final browser channel state
after advancement, or a browser update epoch in place of native `GTicks`, needs
its own explicitly stated scheduling adaptation. The cache proof alone does
not establish whether an `AnimEnd` callback evaluates the old endpoint.

## Channel state and mesh replacement

`PlayAnim` calls channel helper `0x106b2700` through thunk `0x1031379b` at
`0x106b3017`. The helper returns an existing channel unchanged when count is
already greater than the requested index. Otherwise it appends 0x70-byte
records. Its full 78-byte body matches the supplemental body at VA minus
`0x40`, with only two declared six-byte import replacements: Core
`FArray::AddZeroed` and `FArray::Shrink`. The owned named `AddZeroed` body at
`0x10109110` explicitly zeroes the appended bytes (`rep stosd` / `rep stosb`).

Thus a newly appended channel starts with accumulator `+0x60 = +0`, previous
frame `+0x68 = +0`, and previous FName DWORD `+0x6c = 0`.
`fresh_channel_bookkeeping()` exposes precisely those three fields. It does
not invent an instance cache-valid flag or a valid animation sequence.

The direct `PlayAnim` body `0x106b2fe0..0x106b371b` contains no store to these
three channel fields. A new sequence must not silently reset them in a port.
When GetFrame finds the q array empty, its retained loop
`0x106d9e27..0x106d9e4d` resets **only previous frame** for every existing
channel; accumulator and previous FName remain untouched.

Named `SetMesh` (`0x106c4ae0..0x106c4b6e`) clears the q/p and current-coordinate
arrays through seven independently matched `FArray::Empty` calls. It does not
directly clear `+0x1fc`. Its vtable `+0x15c` callback is named
`ActualizeAnimLinkups` (`0x106ba200..0x106ba281`), which updates mesh/animation
mapping records and also has no direct `+0x1fc` access. These inspected bodies
do not establish every external invalidation or allocation path.

## What is known after evaluation, and what remains unknown

The successful ordinary local-pose pass writes `instance+0x1fc = 1` at
`0x106db21e`, after q/p sampling and reference fallback and before later
hierarchy/modifier work. The mapped/unmapped behavior remains pinned by the
[reference-fallback evidence](native-pose-fallback-evidence.md): a negative
linkup bypasses track/tween evaluation, and its source reference q/p is copied
into the same persistent local caches. It is populated but not tweened.

The default instance constructor `0x103f4460..0x103f45ec` has no direct
`+0x1fc` initializer. The copy constructor explicitly copies the field at
`0x103f47be..0x103f47c4`. This checker alone does **not** bind the allocation-wide
initial value. The subsequent [fresh allocation proof](native-pose-allocation-evidence.md)
traces class-default zeroing, template copy and the constructor chain to establish
zero for the ordinary fresh path. Fresh q/p storage is still not a prior pose:
the native invalid-cache branch evaluates ordinary frame zero first.

A bounded browser implementation can retain a fully evaluated positive pose,
its per-bone local q/p, explicit channel bookkeeping and repeat marker, then
admit subsequent supported tween evaluation using that known state. Model
replacement must retire the browser's previous model state; this is lifecycle
isolation, not an invented native `SetMesh` flag write. Initial or replacement
negative frames use the separate fresh-allocation contract only when that state
is known; copied, reused or unobserved state remains an admission boundary.

Fresh channel previous frame is zero even after positive sampling, so the
first negative tween may divide by zero **before** checking the previous
sequence name. The [tween arithmetic evidence](native-pose-tween-evidence.md)
retains that floating-point exception-mask boundary. The
[normal Windows/CRT evidence](native-animation-fpu-evidence.md) supplies its
explicit environment contract without substituting a guessed previous frame.
