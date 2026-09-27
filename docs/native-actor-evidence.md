# Original Interlude skeletal visual scale

The original ordinary skeletal render path multiplies the actor's visual
scale by the mesh's own scale. It does not fit the rendered mesh to the
server collision cylinder. This is a bounded result about local visual
scale, not proof of complete animation, actor placement or material parity.

## Input and reproduction

The input is the owner's original `assets/interlude/system/engine.dll`,
SHA256 `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`.
Its PE32 image base is `0x10300000`. The in-memory recovery is the exact same
export-derived DWORD subtraction described in
[native-terrain-evidence.md](native-terrain-evidence.md): derive
`0x7965b551` from the exported UTF16 function-name sentinel, decode the first
section, verify the complete sentinel, then follow each export's E9 jump.
The file is never executed, patched or written in decoded form.

```sh
python3 tools/ui/check_actor_native.py --check
```

This uses the existing PE/Capstone verifier from
`tools/ui/check_tutorial_quest_native.py`. It pins the original binary hash,
checks named exports, native vtable entries and the reviewed instructions.
It verifies the identity of the inspected evidence; it is not a general
decompiler or an automatic proof of arbitrary machine-code semantics.

All addresses below are RVAs; add the image base to obtain the virtual
addresses printed by the verifier.

| Original export | Stub RVA | Body RVA |
| --- | ---: | ---: |
| `AActor::SetDrawScale(float)` | `0x1336d` | `0x22d780` |
| `AActor::SetDrawScale3D(FVector)` | `0xd076` | `0x22dab0` |
| `ULodMeshInstance::GetActor()` | `0x37dd` | `0x60d80` |
| `ULodMeshInstance::GetMesh()` | `0x8a3a` | `0x60cf0` |
| `USkeletalMeshInstance::SetScale(FVector)` | `0xea70` | `0x3b25d0` |
| `USkeletalMeshInstance::MeshToWorld(float)` | `0x101a4` | `0x3bc040` |
| `USubSkeletalMeshInstance::MeshToWorld(float)` | `0x1404c` | `0x3b5f20` |
| `USkeletalMeshInstance::Render(...)` | `0x8463` | `0x3dd010` |
| `USubSkeletalMeshInstance::Render(...)` | `0x8521` | `0x3cace0` |
| `ULodMesh::Serialize(FArchive&)` | `0x7833` | `0x2ddee0` |
| `UMesh::Serialize(FArchive&)` | `0xdcc9` | `0x2e47f0` |
| `UPrimitive::Serialize(FArchive&)` | `0x11293` | `0x345810` |

## Typed fields and scale order

The named actor setters independently establish the field identities:

- `SetDrawScale` stores its float argument at actor `+0x27c` (`0x22d7d5`).
- `SetDrawScale3D` stores its vector at actor `+0x280/+0x284/+0x288`
  (`0x22db04/0x22db0d/0x22db16`).
- Skeletal `SetScale` gets the mesh through vtable slot `+0x94`, then stores
  its vector at mesh `+0x84/+0x88/+0x8c` (`0x3b2608/0x3b2611/0x3b261a`).

The native skeletal and sub-skeletal vtables resolve slot `+0x8c` to
`GetActor` and `+0x94` to `GetMesh`. Thus the two objects used by
`MeshToWorld` are identified from named native exports, not guessed from
plausible floating-point values. The ordinary skeletal override at
`0x3bc040` forwards its incoming float to the sub-skeletal implementation via
export stub `0x1404c` at `0x3bc086`.

In that implementation the normal branch at `0x3b6356` computes each axis:

```text
actorAxis = float32(Actor.DrawScale * Actor.DrawScale3D[axis])
meshAxis  = float32(actorAxis * MeshScale[axis])
scaleAxis = float32(meshAxis * incomingRenderMultiplier)
```

The float32 stores occur after each multiplication stage. The mesh-axis
stage is `0x3b638f–0x3b63b5`; the incoming-float stage is
`0x3b63b9–0x3b63dc`. The other local branch at `0x3b604a` has the same scale
products. The resulting XYZ vector is used to construct a scale matrix.
The arithmetic precedes the later rotation/translation matrix composition;
this evidence does not reconstruct every attachment or special-pawn branch.

The extra multiplier is **exactly 1.0 for the ordinary render entry points**:
skeletal `Render` executes `fld1` at `0x3dd1a9`, stores the argument at
`0x3dd1ab`, then calls vtable slot `+0x128` at `0x3dd1bd`. The native table
maps that slot to `USkeletalMeshInstance::MeshToWorld(float)`.
Sub-skeletal `Render` independently does the same at
`0x3cae44/0x3cae46/0x3cae58`. Other callers of `MeshToWorld` are not assumed
to use 1.0.

For the browser's existing `(x,z,-y)` axis convention, the corresponding
diagonal scale is `(scaleX, scaleZ, scaleY)`. MeshScale must be applied only
once: a model normalized using a derived `nativeHeight` may already include
its Z factor. Original class scale is per NPC class; two classes sharing one
mesh can legitimately have different visual sizes.

## Original mesh serialization and class provenance

`ULodMesh::Serialize` calls its `UMesh` parent at `0x2ddf11`, then serializes
the following fields in this order:

| Native offset | Serialized value | Evidence |
| --- | --- | --- |
| `+0x64` | int32 mesh version | `0x2ddf29` |
| `+0x68` | int32 vertex count | `0x2ddf33` |
| `+0x6c` | array of four-byte packed vertices | `0x2ddf3d`, helper `0x2dda30` |
| `+0x78` | texture object-reference array | `0x2ddf74`, helper `0x2dd8e0` |
| `+0x84` | three-float mesh scale | `0x2ddf8f/0x2ddf97` |
| `+0x90` | three-float mesh origin | `0x2ddf88/0x2ddfa0` |
| `+0x9c` | rotator | `0x2ddf81/0x2ddfa9` |

The scale field's meaning is independently established by the named native
setter and its use in the render transform above. The serializer compares
the mesh version with 2 at `0x2ddf4a`: versions below 2 insert a legacy array
before the texture array. An exporter using the compact layout must reject
that legacy branch rather than silently reading a different field as scale.

`UPrimitive::Serialize` first emits its box through helper `0x302c0`
(six four-byte components plus one validity byte), then its sphere through
`0x2e98f0` (four four-byte components when its version check exceeds 61).
That protected version getter is erased, so its precise field identity is
not established by this body alone. The reviewed Interlude file reader uses
the 25+16-byte bounds layout after the property stream. `UMesh::Serialize`
also has an archive-mode-dependent
instance-reference branch whose protected archive getter was erased; this
is not a claim that the same layout applies to arbitrary archive modes or
client revisions. Original package, export, mesh-version and scale-offset
metadata must remain attached to each exported record.

A read-only pass over all 3,051 local original `SkeletalMesh` exports found
mesh version 5 in every case. All have package file version 123; licensee
versions are 30 (729 meshes), 28 (1,565) and 31 (757). This records the actual
local input coverage rather than assuming every package has licensee 30.

Actor values come from the original named class's `DrawScale` and
`DrawScale3D` default properties, following its exact qualified parent
chain. `Engine.Actor`'s explicit defaults can close that chain; a missing
class or field is not evidence for an invented value of 1. The current
default-property decoder requires every tag to match a field declared on that
exact class or its qualified ancestors. This rejects false package-header
properties and a function-name candidate observed in `Engine.Pawn`. It selects
maximal validated streams ending at the export boundary. If more than one
remains, visual fields are usable only when **all candidates agree**, including
whether a field is absent and therefore inherited. Both stream offsets/hashes
remain recorded; no single boundary or nonvisual fields are claimed in that
case. The original `giant_spider` is such an ambiguous boundary with unanimous
visual inheritance. A complete native `UClass::Serialize` decoder remains a
separate improvement.

## Limits

Some protected imported calls recover as NOPs. The original binary was
inspected statically, not restored and run. This establishes the named
visual scale fields, ordinary render multiplier and reviewed mesh layout.
It does not establish native pose bounds, animation blending, mesh-origin
placement, attachment transforms, runtime scale overrides, or complete
visual equivalence with the original client. Collision dimensions remain
their own authoritative input for movement and picking, not a replacement
for source visual scale.
