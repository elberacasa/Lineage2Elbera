# Elbera Tools: original hair attachment evidence

The original client has **two hair rendering paths**. The supplied ordinary
hair tables reference 162 meshes: 14 select the dynamic path and 148 select
ordinary rendering. Both paths explicitly select a master head record, but
their coordinate processing differs. This evidence does not certify browser
attachment, simulation, bind matrices or complete visual parity.

The verifier is [check_hair_attachment_native.py](../tools/ui/check_hair_attachment_native.py).
It reads the owner's original files; it neither executes native binaries nor
redistributes source assets or decoded method dumps.

```sh
# Original binaries required; 69 Engine anchors, 8 Core candidate anchors,
# four vtable bindings and two independently evaluated composition slices.
python3 tools/ui/check_hair_attachment_native.py --check

# Also reread original DAT tables and all 162 SkeletalMesh exports.
# No generated hair.json, built glTF or texture output is used as an oracle.
python3 tools/ui/check_hair_attachment_native.py --audit-assets \
  --out tmp/restart-audit/hair-attachment-original.json

# Seventeen portable synthetic tests; no original client or native execution.
node tools/ui/test_hair_attachment_native.mjs

# Optional, separately obtained comparison copy; exact hash required.
# This does not authenticate the comparison copy as a vendor original.
python3 tools/ui/check_hair_attachment_native.py --check \
  --comparison-engine /path/to/comparison/engine.dll \
  --out tmp/restart-audit/hair-attachment-comparison.json
```

The asset audit requires the same owned package inputs, decoding dependencies
and separately available `l2encdec` as the
[hair asset pipeline](hair-asset-pipeline.md). Receipts contain source references
and fingerprints and stay under ignored `tmp/`.

## Source identity and scope

| Original input | SHA256 | Image base |
| --- | --- | --- |
| Engine.dll | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` | `0x10300000` |
| Core.dll | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` | `0x10100000` |

Addresses below are virtual addresses. Engine recovery follows the
[pinned recovery evidence](native-engine-recovery-evidence.md). Six-NOP sites
are present in the recovered copy; actual runtime restoration is unverified.
The verifier preserves them as missing bindings, never as no-op semantics.

## Exact dispatch and saved source word

Named `USkeletalMeshInstance::Render` resolves to `0x106dd010`. Its loop at
`0x106def02..0x106defb8` visits Pawn submesh slots **4 and 5**. The original
`EPawnSubMeshStyle` names these Hair2 and Hair1, respectively; that identity
is independently checked by the
[hair selector verifier](../tools/ui/check_hair_selection_native.py).

Pawn virtual `+0x25c` binds named `GetSubMesh`. At `0x103414a4` it reads
`[Pawn + 0x3bc + slot*4]`. The selected sub-instance receives that slot at
`+0x13c`; its mesh's signed word at `+0x14c` selects the next call:

- If `word > 0 && word != 4`, `0x106def80` calls named
  `RenderDynamicHairMesh`, body `0x106cd3c0`.
- Otherwise, virtual `+0x12c` in the original sub-instance vtable binds named
  `USubSkeletalMeshInstance::Render`, body `0x106cace0`.

This is a numeric branch, not an inferred test of vertex stream type. The
field's original name remains unbound. It is also distinct from the
ULodMesh version field at native `+0x64`.

`USkeletalMesh::Serialize` passes `mesh+0x14c` to the four-byte scalar helper
at `0x106e638a..0x106e6392`, after the version-gated source prefix. The same
helper serializes SkeletalDepth at `0x106e621d..0x106e6225`.
The audit supports only the supplied archive combinations 123/28 and 123/30.
It starts after freshly decoded LOD0, parses every remaining LOD, then consumes
the object reference and six lazy arrays with element widths
`12, 10, 12, 8, 2, 2`. The triangle width is 12, including its smoothing-group
word. Every absolute saved end must equal the bytes actually consumed. The
mode word, float array and final scalar must end exactly at the original
export boundary. Unknown archive versions, truncation, invalid counts,
displaced boundaries and unexplained trailing bytes are rejected.

The fresh source census is:

| Saved `+0x14c` | Original LOD0 stream | Meshes | Selected path |
| --- | --- | ---: | --- |
| 0 | rigid | 10 | ordinary |
| 2 | soft | 8 | dynamic |
| 4 | rigid | 138 | ordinary |
| 6 | soft | 4 | dynamic |
| 7 | soft | 2 | dynamic |

This covers references from the ordinary base hair table. Equipment-specific
tables and conditional naming overrides remain separate. The agreement
between stream type and dispatch in these 162 records is a measured result,
not a replacement for the native predicate.

## Dynamic head copy: what is directly established

`0x106cd6da..0x106cd6ec` calls Pawn virtual `+0x238`, then named
`USkeletalMesh::MatchRefBone` on the actor's master mesh. The Pawn vtable
binds `+0x238` to named `GetHeadBoneName`, body `0x10341380`; it reads the
name stored at Pawn `+0x450`.

At `0x106cd706..0x106cd722`, the returned bone index is multiplied by 48 and
**12 DWORDs are copied from master-instance `+0xc4[index]` to sub-instance
`+0xdc`**. `DynamicHairGetFrame` then copies those same 48 bytes over the
first record in `sub+0xc4`, at `0x106c0c17..0x106c0c2d`.

The copies and indices are explicit. This does not establish the missing
parent-coordinate composition at `0x106c0c7e`, simulation behavior, or
equivalence to attaching a browser mesh to a bone. `MatchRefBone` also
contains unbound name/alias comparisons; the master-instance class-check
helper has an unbound call. The supported evidence assumes a valid resolved
head index rather than treating the native missing-index behavior as safe.

Before that root override, the dynamic path loads the original reference
bone quaternion and position, then directly calls helper `0x10311252` →
`0x106ae320`. Its **100 retained arithmetic instructions** convert those
values into a local 48-byte coordinate record. The checker compares a
separate formula against four synthetic cases (including a nonunit
quaternion) and, during the fresh asset audit, **all 150 source bones in
the 14 dynamic meshes**. It preserves the original Float32 stores without
normalizing quaternions. This local conversion does not compose the bone
hierarchy or implement dynamic simulation.

## Ordinary rigid rendering also selects the master head

The rigid-section arm of ordinary `USubSkeletalMeshInstance::Render` calls
the same head-name virtual at `0x106cbbc8..0x106cbbce`, then named
`MatchRefBone` at `0x106cbbdc`. It multiplies that index by 48 and reads the
record at **master-instance `+0xd0[headIndex]`**, beginning at `0x106cbc0a`.
It does not simply use the raw hair mesh's bone-zero coordinates.

The next call-shaped site, `0x106cbc19`, is six NOPs. Its receiver is the
selected 48-byte record and its output is a 64-byte matrix. Afterwards the
code explicitly overwrites matrix components 12, 13 and 14 with the first
three values of the selected record, then writes component 15 as 1
(`0x106cbc29..0x106cbc54`). Those four stores are independently testable
without guessing the preceding matrix conversion.

At `0x106cbc76`, another six-NOP site receives that matrix and the earlier
mesh-to-world matrix. Its result is passed by value to RenderInterface
virtual `+0x40` at `0x106cbc98..0x106cbc9b`. Neither missing call's actual
target is recovered here. This branch also depends on surrounding render
state and the current LOD's rigid sections; it is not a universal rendering
entry condition.

Original Core exports `FCoords::Matrix`, body `0x1014df30`, which has a
compatible receiver/output ABI. It transposes the three coordinate rows
into matrix columns and forms a translated matrix, returning with `ret 4`.
The checker pins that named body and eight relevant instructions. It is a
**candidate**, not a recovered binding for `0x106cbc19`. Likewise, the
surviving [Core matrix multiplication](player-transform-audit.md) does not
by itself bind `0x106cbc76`. No candidate is substituted into runtime code.

## Newly executable slice: how master `+0xd0` is formed

The master rendering loop obtains three corresponding 48-byte records:

- current bone coordinates from instance `+0xc4` at `0x106e0342`;
- a source-derived table from master mesh `+0x300` at `0x106e034d`;
- destination from instance `+0xd0` at `0x106e0355`.

The complete arithmetic at `0x106e035d..0x106e067b` is retained, with no
calls or NOPs. It is checked by executing **257 original instructions for
100 finite synthetic input pairs** and comparing them with independently
expressed equations. Let `C` be the current record, `B` the table record,
and `f` a Float32 store. Records contain an origin followed by three rows.

For origin component `r`:

```text
dot = f((C.row[r][1]*B.origin[1] + C.row[r][0]*B.origin[0])
        + C.row[r][2]*B.origin[2])
D.origin[r] = f(C.origin[r] + dot)
```

For row component `(r,c)`:

```text
p0 = f(C.row[r][0] * B.row[0][c])
p1 = f(C.row[r][1] * B.row[1][c])
p2 = f(C.row[r][2] * B.row[2][c])
D.row[r][c] = f(f(p0 + p1) + p2)
```

The origin dot product and axis multiplication have **different store
boundaries**. Portable adversarial cases distinguish them, and distinguish
matrix order, transposition and replacing the whole bone record. The
instruction evaluator uses Float64 intermediates and actual Float32 stores;
these bounded cases do not establish universal x87 extended-precision parity.

The dynamic renderer independently contains the same output equations at
`0x106cdcd2..0x106ce00e`, taking `sub+0xc4` and `mesh+0x300` and writing
`sub+0xd0`. A separate **263-instruction slice is evaluated for 100 input
pairs**, rather than assuming the two branches share an implementation.
Its own reference-parent and cache-initializer sites at `0x106cd582` and
`0x106cd5aa` remain six NOPs in the owned recovered copy.

The input table is not labeled inverse-bind. Its initialization in named
`GetFrame` starts from each original reference bone's quaternion and position
through a surviving direct conversion helper at `0x106da0d2`. For child
bones it then reaches the missing parent-composition site `0x106da110`.
A second missing unary helper at `0x106da13c` produces the 48 bytes copied
into mesh `+0x300`. Those bindings must be recovered or independently proved
before this arithmetic can supply a complete native attachment transform.

## Opt-in comparison-copy bindings

A separately obtained unpacked Engine copy has SHA256
`508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d`.
Its vendor provenance is **not authenticated**. It is therefore an explicit
optional input, never a replacement for the pinned owned source. The
[retrieval and companion-Core evidence](supplemental-engine-evidence.md) records
archive consistency checks and five exact matching Core method bodies. The
section-aware [PE reader](../tools/ui/supplemental_pe.py) resolves exports,
raw section offsets and named imports; assuming RVA equals file offset would
read the wrong data in this copy.

Two blocks match their owned counterparts exactly after permitting only
the four declared six-byte imported calls and two same-target direct-call
displacement changes. Every other byte must match. Neither broad relocation
masking nor an ABI guess is accepted:

| Owned block | Comparison block | Length | Confirmed comparison imports |
| --- | --- | ---: | --- |
| `0x106cbbbf..0x106cbc9d` | `0x106cbb7f..0x106cbc5d` | 222 bytes | `FCoords::Matrix`, `FMatrix::operator*` |
| `0x106da0b0..0x106da16c` | `0x106da070..0x106da12c` | 188 bytes | `FCoords::ApplyPivot`, `FCoords::PivotInverse` |

The enclosing named method bodies are also resolved separately: ordinary
sub-instance Render is `0x106cace0` owned / `0x106caca0` comparison; GetFrame
is `0x106d9a70` owned / `0x106d9a30` comparison. The changed direct calls
still target exactly `0x1030cde2` (`MatchRefBone`) and `0x10311252`
(the retained quaternion helper), respectively.

This establishes the following **contracts in the comparison copy**:

1. Each reference child's coordinates call `ApplyPivot(parentCoordinates)`.
   The subsequent unary `PivotInverse()` result is copied into the source
   mesh's `+0x300` table. This specifically identifies `PivotInverse`, not
   the distinct `FCoords::Inverse` or a guessed transpose.
2. Ordinary hair rendering calls `Matrix()` on the selected master's
   `+0xd0` record, overwrites its origin and homogeneous component as described
   above, then calls the matrix multiplication operator with the previously
   obtained mesh-to-world matrix.

All four imported names resolve to retained named implementations in the
owner's independently pinned Core.dll. In particular, `ApplyPivot` is at
`0x1014d8c0..0x1014d98a` and returns with `ret 8`; `PivotInverse` is at
`0x1014db40..0x1014dd1a` and returns with `ret 4`. Their direct vector-helper
calls bind `0x10101dd4` → `0x1010f5b0`. The former combines a coordinate
pivot through that helper; the latter computes a determinant reciprocal and
cofactors before transforming the negated origin. The receipt fingerprints
the complete named Core bodies. Their full floating-point composition has
not been promoted to a new runtime implementation here.

These exact surrounding-byte and named-import matches are stronger than
the previous candidate ABI observations. They still do not demonstrate how
the owned protected Engine restores its calls, authenticate the comparison
copy, establish every live actor's master mesh or validate full player
placement. The default verifier continues to report the owned six-NOP sites
as unbound; the optional receipt reports the separate comparison explicitly.

## Consequence for the browser port

Raw source influences and the current built model's head-rebound weights
differ. **That fact alone does not establish visually incorrect attachment**:
both original paths contain explicit master-head selection. Equally, a
visually plausible browser attachment does not prove the original math.

The next comparison must use the actual actor master mesh, its reference
skeleton, current bone records and the missing table/matrix operations.
The fresh asset audit also reads each of the 14 original `LineageWarrior`
player classes with an exact validated default-property boundary. All 14
explicitly override `HeadBone` with `Bip01_head` and `Mesh` with their
original face skeletal mesh (`*_m000_f`); these are the class's own tags,
not substituted inherited values or the browser's upper-body skeleton.
The receipt retains the typed fields, property-stream evidence and pinned
`LineageWarrior.u`, `Engine.u` and `Core.u` hashes. A later native mesh
assignment can still change the active master. Bounding-box recentering, model basis and
mesh-to-world placement must also be kept distinct from this bone-relative
calculation. This checkpoint changes no runtime geometry or attachment.
