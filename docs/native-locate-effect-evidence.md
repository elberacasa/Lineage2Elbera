# Original LocateEffect placement evidence

Elbera Tools checks the owner's original Interlude
`SkillAction_LocateEffect::Notify(BaseActor, DestActor)`. This establishes
specific callback inputs and attachment failure behavior. It does not certify
the browser's actor origin, particle placement, full attachment transform,
emitter lifetime, or complete rendering parity.

## Reproduce

```sh
python3 tools/ui/check_locate_effect_native.py --check
python3 -m unittest discover -s tools/ui -p test_locate_effect_native.py
```

The original callback check covers 90 instruction anchors, nine pinned native
ranges, 23 actual arithmetic slices, 16 actor-selection cases and six
attachment-failure cases. The alias extension checks 38 more Engine anchors,
three serializer ranges, 12 surviving Core ranges, 12 additional arithmetic
cases and all 14 original player primary-mesh alias tables. It freshly decodes
all 524 original action objects and checks the exporter's packed flag mapping.
Fifteen portable tests exercise missing inputs, zero-valued source fields,
distinct dimensions, finite arithmetic limits and strict parallel-array decoding.
The JSON form reports bounded method hashes, reflected property hashes,
source counts and explicit erased-import boundaries. It never executes native
code or writes original assets.

Pinned sources:

| Source | SHA-256 |
| --- | --- |
| Engine.dll | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Engine.u | `9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761` |
| Skill.usk | `30b9a60d2a27c12d7fb9826a38772b3932c4ad66ab5f0638e8128813898463f5` |
| Core.dll | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |

Engine recovery uses the previously documented in-memory DWORD subtraction
and image base `0x10300000`; see [native terrain evidence](native-terrain-evidence.md).
The callback body is RVA `0x1ec6f0`–`0x1ecdbf`. Several call-shaped sites
contain six NOP bytes in the recovered copy. Independent raw-word decoding
confirms those NOPs come from the pinned input; the shared decoder did not
delete calls. Whether the original runtime restores them, and to which
targets, is unverified. Their apparent ABI and class arguments do not establish
recovered import bindings. The shorthand “erased” below refers to that missing
binding, not a proven protector operation; see
[native Engine recovery evidence](native-engine-recovery-evidence.md).

## Source fields and selected actor

Engine.u's linked property declarations, typed generated copy constructor
(`0x559b0`), and native accesses establish these fields:

| Field | Native layout | Packed browser field |
| --- | --- | --- |
| AttachOn | byte `+0x3c` | `at` |
| AttachBoneName | FName `+0x40` | `b` |
| bAbsolute | `+0x44` bit 1 | `g & 16` |
| SpawnDelay | float `+0x48` | `d` |
| bUseCharacterRotation | `+0x4c` bit 1 | `g & 8` |
| Offset | vector `+0x50` | `o` |
| bRelativeToCylinder | `+0x5c` bit 1 | **false** when `g & 32` |
| bSpawnOnTarget | `+0x5c` bit 2 | `g & 1` |
| bSizeScale | `+0x5c` bit 4 | `g & 4` |

The separately inherited bOnMultiTarget is used by Agent action selection;
it is not bSpawnOnTarget. The original LocateEffect class's unique terminal
default stream explicitly sets bRelativeToCylinder=true. Omission of that
field in an action therefore retains true.

At `0x1ec70a`–`0x1ec71e`, bSpawnOnTarget selects DestActor when set and
BaseActor otherwise. A null selected actor returns null at `0x1ec759`–
`0x1ec75b`; there is no replacement with the other actor. Both source flags
and their packed meanings are checked against every freshly decoded action.

## Offset arithmetic

For the relative branch, before the erased coordinate transform, the compiled
callback constructs this vector from the **selected actor**:

```text
X = Float32(CollisionRadius * Offset.X)
Y = Offset.Y
Z = Float32(CollisionHeight * Offset.Z)                  [non-skeletal path]
Z = Float32(MeshOrigin.Z * Offset.Z * DrawScale)          [skeletal path]
```

The X store is `0x1ec885`–`0x1ec896`; Y is copied at `0x1ec89a`–
`0x1ec89d`. Non-skeletal Z uses actor `+0x2f4` at `0x1ec8d2`; skeletal
Z uses returned mesh `+0x98` and actor `+0x27c` at `0x1ec8be`–`0x1ec8ca`.
The latter product has one final Float32 store; there is no store between its
two multiplications. Named SetCollisionSize and SetDrawScale independently
bind the actor fields. ULodMesh serialization binds MeshOrigin at `+0x90`;
see [player transform evidence](player-transform-audit.md) for the independent
original package layout comparison.

The skeletal branch tests the selected mesh with the original USkeletalMesh
class object and uses a second cast-shaped helper at `0x1b4270`. Both class
predicate imports are erased. The verifier preserves the two branches as
explicit inputs; a missing classification or source field cannot become a
visual-height fallback. Float64 evaluation of the chosen finite cases is an
approximation of x87 extended intermediates, with native Float32 stores
preserved; it is not universal extended-precision equivalence.

An original script comment describes a different Y/Z convention. The compiled
loads and stores above are the evidence for this build. Scaling all three
components by `heightM / 2`, or by an authored `.85` metres, contradicts them.
For example, offset `(2,3,-1)`, radius 9 and height 23 produce `(18,3,-23)`
on the non-skeletal path, not `(46,69,-23)`.

When bRelativeToCylinder=false, `0x1ec916`–`0x1ec938` instead copies Offset
unchanged. This branch bypasses both dimension scaling and the offset
coordinate transform. It does not rotate the raw offset merely because
bUseCharacterRotation is set. The current source has 31 relative=false
actions, but none combine a nonzero offset with bUseCharacterRotation=true;
that particular renderer error is latent in the current action set.

## Rotation and spawn baseline

bUseCharacterRotation copies the selected actor's Rotation at `0x1ec77f`–
`0x1ec799`. Otherwise, a distinct nonnull target produces the vector
`DestActor.Location - BaseActor.Location`, which is passed to an erased
rotation helper. The no-distinct-target branch uses BaseActor Rotation.
A separately classified projectile BaseActor has a saved-rotation path.
The callback later forces the outgoing spawn Pitch to zero at `0x1ec93c`;
this does not establish a complete browser heading conversion.

For relative offsets, the rotation is passed through two erased helpers at
`0x1ec8f2` and `0x1ec902` to produce the offset used below. The verifier does
not replace those helpers with a guessed matrix.

The surviving Core code narrows this boundary without closing it. The first
call receives a coordinate receiver, a rotation reference and a hidden return
buffer. Both named `FCoords::operator*(FRotator)` at Core RVA `0x10150` and
`operator/(FRotator)` at `0x105b0` have that ABI and return with `ret 8`.
The second call receives a vector receiver, the returned coordinates and a
hidden vector buffer. Four surviving named methods share that ABI:

| Core method | RVA | Arithmetic with coordinate origin O and axis rows A |
| --- | --- | --- |
| TransformPointBy | `0xf640`, helper `0xf510` | `(V − O)` dotted with each row of A |
| TransformVectorBy | `0xf660`, helper `0xf5b0` | V dotted with each row of A |
| TransformVectorByTranspose | `0xf680` | V dotted with each column of A |
| PivotTransform | `0xf6f0` | Stored row-dot result, then add O |

Twelve evaluations of the actual call-free arithmetic distinguish these
methods, including asymmetric axes and nonzero origins. For the same fixture,
their outputs are `(2,8,8)`, `(-5,-2,14)`, `(5,2,14)` and `(5,-9,17)`.
That is evidence against selecting a transform from the stack shape alone.
The named Core methods are recoverable; their binding to these two Engine
NOP sites is not. The same finite x87 approximation limit applies.

EAM_None adds the processed offset to selected actor Location, beginning
at `0x1ec951`. A classified projectile BaseActor uses its saved position
at `+0x4e8` instead. There is **no visual half-height addition** in this
callback. This alone does not prove that a browser group's feet, packet Z,
or server geodata floor is the original actor Location. Native actor placement
must be established separately before replacing the renderer baseline.

For other AttachOn values, SpawnActor receives the selected actor as owner
and the processed offset as the initial location. The callback then applies
the attachment-specific behavior below. Its SpawnActor virtual slot `+0xc0`
is independently bound to the original ULevel export. Therefore treating
every attachment as an unattached world position followed by an approximate
bone-center shift is not a proven implementation.

## Attachment lookup and failure

The original EAttachMethod declaration and the eight-entry jump table at
`0x1ecdc0` agree:

| Value | Source attachment | Native action |
| --- | --- | --- |
| 0 | EAM_None | Sets physics 0; no bone attachment |
| 1 | EAM_RH | Selected actor's named GetRHandBoneName virtual `+0x21c` |
| 2 | EAM_LH | Selected actor's named GetLHandBoneName virtual `+0x220` |
| 3 | EAM_BoneSpecified | Uses source AttachBoneName |
| 4 | EAM_AliasSpecified | Calls GetAliasesTagBoneName **and** GetAliasesTagCoords |
| 5 | EAM_Trail | Sets PHYS_Trailer (10) and separate trailer/relative-offset flags |
| 6, 7 | EAM_RF, EAM_LF | Read Pawn foot-name fields; absent from the current action set |

Aliases are not literal bone names. GetAliasesTagBoneName (`0x3b4110`)
searches the original alias-name array at mesh `+0x318`, using count `+0x31c`,
then returns the parallel bone-name entry at `+0x324`. GetAliasesTagCoords
(`0x3b4050`) returns the parallel 48-byte coordinate record from `+0x330`.
Their name comparisons are erased imports, so exact comparison semantics
remain bounded. At a successful bone attachment, LocateEffect adds the alias
coordinate origin to the processed offset and writes the result into the
returned effect's relative location (`+0x1fc`–`+0x204`). Non-alias cases begin
with a zero alias origin.

The named AActor::AttachToBone (`0x22e3e0`) calls the named
USubSkeletalMeshInstance::MatchRefBone at `0x22e420`. A result at most -1
follows its failure path and returns zero. LocateEffect tests that return
at `0x1eccdb`; failure branches to ULevel::DestroyActor at `0x1ecd47`–
`0x1ecd5a`, then returns null. There is no actor-center fallback. The source
bAbsolute bit is passed into AttachToBone; its full transform semantics are
outside this bounded check.

A safe partial renderer can therefore decline an unresolved explicit bone
attachment rather than drawing it at the actor center. Alias attachments
need actual original alias-to-bone and coordinate metadata; treating an alias
as a node name is unsupported. A missing exported bone is a browser coverage
gap, not proof that the original bone was absent. This correction must retain
that distinction in diagnostics.

Fresh original counts are: None 79, RH 18, LH 5, specified bone 10, alias 11,
Trail 401. These replace stale renderer-header counts. They describe source
actions, not the number of effects exercised by a given exact skill level.

## Exact original player alias tables

The decoder can now expose the actual serialized alias data without rounding,
padding a missing coordinate record or silently truncating unequal arrays.
For each of the 14 ordinary player classes, it freshly validates the unique
default-property stream against inherited declared fields and reads its exact
`Mesh` object reference. An independent freshly decrypted chargrp join binds
the browser model identity to that class. The decoder then reads the original
mesh export, retaining package, export and alias-byte hashes. The independent
placement reader checks the following LOD/lazy-array framing. No generated
mesh dimensions are used as an oracle.

Native `USkeletalMesh::Serialize` at `0x3e61c0` serializes fields `+0x318`,
`+0x324` and `+0x330` in that order (`0x3e6244`–`0x3e6269`). The first two
use the same four-byte FName-array helper; the third uses the 48-byte array
helper at `0x3c3060`. Its element helper at `0x3af200` serializes the twelve
four-byte components in order. The named Core FCoords constructors independently
place origin first, then the three axis vectors. The getters read these same
parallel arrays. Their mesh comes from virtual `+0x94`, bound by the original
USkeletalMeshInstance vtable to `ULodMeshInstance::GetMesh`, which returns
instance field `+0x60`.

Every one of these 14 **serialized primary meshes** has one alias:
`e_bone → Bip01_head`. Its axes are exactly identity, its X/Y origin is zero,
and its Z origin is the following exact Float32 value in original mesh units:

| Player model | Alias origin Z |
| --- | --- |
| Human fighter male/female | 7.800000190734863 |
| Human mystic male | 8.199999809265137 |
| Human mystic female | 7.199999809265137 |
| Elf male/female; dwarf female | 7.599999904632568 |
| Dark elf male | 7.300000190734863 |
| Dark elf female | 7.5 |
| Orc fighter male | 9.699999809265137 |
| Orc fighter female | 8.5 |
| Orc mystic male | 9 |
| Orc mystic female | 7.699999809265137 |
| Dwarf male | 9.300000190734863 |

The eleven original alias actions request `e_bone` five times, `soulshot1`
five times and `soulshot2` once. All eleven have zero source offset and
bAbsolute=true. The five e_bone requests therefore have exact matching saved
player metadata. The other six names are absent from these particular tables.
This does **not** prove that a native runtime mesh or another actor type never
adds or supplies those aliases. Nor does this table establish the attached
bone's world transform, the browser basis conversion or bAbsolute following.

Two further admission limits remain explicit. First, the two alias lookup
comparisons at `0x3b4160` and `0x3b407e` are erased. Surviving Core FName
equality (`0x9d40`) and inequality (`0x9d60`) both take the same name reference
and return with `ret 4`; their `sete`/`setne` bodies prove opposite results.
The call-site ABI alone cannot select one. Second, LocateEffect obtains the
alias instance from a classified Pawn's `+0x134` through another class-check
shaped helper; those predicate imports are also erased. A failed lookup takes
an erased FName-constructor call with argument zero, rather than returning
the requested alias as a literal bone name.

Consequently, the reusable output is exact source attachment metadata and
conditional native dataflow. It does not authorize enabling all alias effects
or substituting these mesh-local offsets for Actor.Location. The browser's
current explicit unsupported gate remains appropriate until the remaining
lookup and attachment-transform boundaries are resolved.

## Returned effects and remaining limits

After SpawnActor, the callback passes the returned object to an erased
classification call with the original AEmitter class object and rejects a
zero result. The source class argument and following branch are pinned; the
import target itself is not recovered. A missing BaseActor GetMagicInfo also
destroys the effect. Valid completion returns the emitter pointer.

SpawnDelay is evaluated against MagicInfo source timing, including a separate
negative-delay branch; all 524 current source actions have nonnegative delay.
Size scaling, emitter delay/lifetime, trail following, returned projectile
classification and Agent bookkeeping require their own complete dataflow.
This document does not use those gaps to assert that the existing provisional
particle renderer is faithful.
