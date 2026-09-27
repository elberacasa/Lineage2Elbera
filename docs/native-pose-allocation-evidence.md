# Fresh ordinary pose-cache initialization

Elbera Tools now closes the fresh-instance `+0x1fc` boundary left open by the
[cache-lifetime checkpoint](native-pose-cache-evidence.md), for the original
ordinary default-template allocation path. The native class-default buffer has
zero at that offset; instance allocation copies it before calling the normal
constructor chain, which preserves it. This permits a fresh negative frame to
take the original **cache-invalid ordinary frame-zero sampling** path. It does
not initialize the cache from exported glTF poses or from raw first keys.

## Reproduce with explicit inputs

```sh
python3 tools/ui/check_pose_allocation_native.py --check \
  --comparison-engine /path/to/pinned/supplemental/engine.dll \
  --comparison-core /path/to/pinned/supplemental/Core.dll
```

This original-input check requires Capstone and privately owned
`assets/interlude/system/engine.dll`, `Core.dll` and `Engine.u`. Both supplemental
paths are required independently; the checker never trusts an adjacent file by
location. Without `--check`, it prints source hashes, bounded comparisons and
limits as JSON. It does not run client code or write decoded binaries.

| Input | SHA256 |
| --- | --- |
| Owned Engine DLL | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Owned Core DLL | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| Owned Engine package | `9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761` |
| Supplemental Engine DLL | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |
| Supplemental Core DLL | `d83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639` |

The supplemental archive remains third-party and unauthenticated. The
[supplemental evidence](supplemental-engine-evidence.md) explains its provenance.
Only separately matched blocks and named bodies are used here. Their agreement
does not authenticate the archive or establish whole-build equivalence.

## Original allocation chain

1. `USkeletalMesh::MeshGetInstanceClass` returns its named native class object
   at owned VA `0x10dd3290` (`0x103638a0`). The original skeletal-mesh vtable
   `+0x8c` points to that getter. In `UMesh::MeshGetInstance`, the ordinary fresh
   path obtains this class at `0x105e4962..0x105e4979`.
2. The block `0x105e4979..0x105e49ac` obtains `UClass::GetDefaultObject`, passes
   that result as the explicit template, supplies flags `0x84004`, constructs
   the original FName argument and obtains the mesh's outer. It then calls
   named Core `UObject::StaticConstructObject`. This whole block matches the
   supplemental block at VA minus `0x40`, allowing only its four declared
   erased-import replacements and the named `GError` IAT operand.
3. Core `StaticConstructObject`, `0x10167eb0`, calls named `StaticAllocateObject`
   at `0x10167f11`. The allocator calls `InitProperties` at `0x10167c56`, with
   the supplied class-default template and the class size. Only after this
   returns does `StaticConstructObject` call the class's internal constructor
   (`class+0x518`, `0x10167f20..0x10167f26`).

`InitProperties` copies template bytes after the 0x34-byte UObject header.
An explicit template is copied for the supplied size; if inheriting a shorter
parent default, its remaining tail is zeroed. The retained path is
`0x1015fb00..0x1015fc0b`; copy at `0x1015fbff`, tail length/address setup at
`0x1015fb84..0x1015fb89`, and zero-fill call at `0x1015fb8a`. Its call-free
helper at `0x10108420` uses `xor eax,eax`, `rep stosd` and `rep stosb`.

## Why this class default contains zero

The native registration block `0x10848750..0x108487c4` supplies:

- Exact class identity `USkeletalMeshInstance`, size **0x348**.
- Parent `USubSkeletalMeshInstance`, independently registered with size
  **0x144** at `0x10849412`.
- Internal constructor thunk `0x1030c48c → 0x103f8ba0`.
- The named inherited `UObject::StaticConstructor` pointer.

All 116 registration bytes are compared. Besides named import replacements,
the only normalized operands are independently named class exports, the
StaticConstructor IAT slot and identical UTF-16 package name. No arbitrary
immediate, branch or layout substitution is accepted.

The retained Core native constructor chain stores the class size in `+0x4c`
and internal/static constructor pointers in `+0x518/+0x51c`.
`UClass::Register` allocates its default buffer at `+0x4f4`, then invokes
`GetDefaultObject` and `InitClassDefaultObject` at `0x10133a49..0x10133a50`.
`InitClassDefaultObject` uses the superclass at `+0x34`, calling
`InitProperties` at `0x1015fe81`. Thus the child tail **[0x144,0x348)** is
zero-filled, including all four bytes at **+0x1fc**.

The supplied `UObject::StaticConstructor` at `0x1015a1e0..0x1015a220` has no
object-field writes. The pinned Engine package contains no serialized Class
export for SkeletalMeshInstance, SubSkeletalMeshInstance, LodMeshInstance or
MeshInstance. This check does not substitute a guessed absent property tag.
The normal registration/configuration path has no new reflected cache field
that supplies a different `+0x1fc` default.

## Why the normal instance constructor preserves it

Five complete normal constructor bodies independently match the supplemental
copy: SkeletalMeshInstance **396 bytes**, SubSkeletalMeshInstance **232**,
LodMeshInstance **88**, MeshInstance **74**, and Primitive **97**. The
comparison binds the erased member-constructor calls. Default FName, FCoords
and FRotator constructors return without writing their storage; FArray clears
only its three DWORDs. None of the inspected normal constructor calls or
explicit stores changes the separate `+0x1fc` field.

Sixteen relevant named Core bodies, including registration, default creation,
template initialization, allocation and member constructors, are byte-identical
between the owned and supplemental Core files. Therefore the supplemental
Engine import names lead to the same retained Core implementations used by the
owned proof. Relocated exception-handler entries are compared for ten bytes;
the complete exception/unwind graph is excluded.

The check passes **16 Engine anchors, 24 Core anchors, seven supplemental block
comparisons and 16 exact Core bodies**. This is an original-input source check,
not a portable synthetic game fixture or a live execution of the client.

## Admission and limits

For a **fresh ordinary instance constructed from this class default**, the
initial flag is zero. The already pinned GetFrame rule therefore uses ordinary
sampling at frame zero during an initial negative frame, preserving channel
bookkeeping. A successful local-pose pass subsequently sets `+0x1fc` to one;
the next supported negative frame can use evaluated q/p as its cache. Ordinary
frame-zero sampling can differ from choosing raw first keys when key intervals
are very small; use the original sampler.

This does not apply to copies, reused instances, custom templates, modified
class-default buffers or arbitrary plugin hooks. Losing browser source-state
after an exported-only interval is **unknown cache state**, not a fresh native
instance. It cannot be relabeled cache-invalid merely to enable a transition.
Mesh replacement and session retirement remain browser lifecycle boundaries.
The arithmetic, exception-policy and modifier limits of the
[tween evidence](native-pose-tween-evidence.md) still apply.
