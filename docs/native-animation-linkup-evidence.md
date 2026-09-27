# Elbera Tools: original mesh-to-animation bone linkup

The ordinary original linkup builder maps **each mesh bone to the first animation bone with the same interned FName**. It does not compare parents, repair order, consume a matched name, or require a one-to-one mapping. A missing name remains `-1`.

This is the native animation association rule. The browser exporter has a different
structural adapter; proof of that adapter must not be presented as proof of the
native rule. The [neutral source-pose inspector](native-track-evidence.md#browser-pose-preview)
now applies this linkup with separately verified reference fallback and current
parent math. Complete native animation and rendering remain outside this scope.

## Reproduction and input boundary

The portable API/tests need Python's standard library only:

```sh
python3 -S -m unittest discover -s tools/ui -p test_animation_linkup_native.py
node tools/ui/test_animation_linkup_native.mjs
```

The original-source check additionally needs Capstone and the owner's pinned original files:

```sh
python3 tools/ui/check_animation_linkup_native.py --check
python3 tools/ui/check_animation_linkup_native.py --check \
  --comparison-engine /private/path/to/system/engine.dll --audit-assets
```

The first command verifies the retained owned blocks and reports that three calls remain erased. The second requires the explicitly supplied supplemental Engine and its sibling Core; it checks exact block correspondence, named imports, 105 authored cases against the retained integer loop, and freshly reads the original Human Fighter face mesh/animation. It never runs a DLL or emits original binaries. Without `--check`, it prints a metadata report.

The supplemental copy is an **unauthenticated archive input**, not a verified vendor distribution. Its use is restricted to exact local correspondence; see [supplemental provenance and reader](supplemental-engine-evidence.md). No downloaded images, original catalogs, animation tracks, accounts, or private research receipts belong in Git.

| Input | SHA-256 |
| --- | --- |
| Owned Engine.dll | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Supplemental Engine.dll | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |
| Owned Core.dll | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| Supplemental Core.dll | `d83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639` |

## Retained caller and field layout

Named `USkeletalMeshInstance::ActualizeAnimLinkups` resolves to owned VA `0x106ba200`. It walks instance `+0x144/+0x148` as 24-byte entries, obtains the current mesh through vtable `+0x94` (named `GetMesh`), and rebuilds an entry when its animation is non-null and its recorded mesh differs. It passes the mesh, animation, and entry's array at `+0x0c` to internal stub `0x10307784`, which jumps to `0x106b9ee0`.

The builder uses the mesh's reference-bone pointer/count at `+0x208/+0x20c`, stride64; the animation's reference-bone pointer/count is `+0x38/+0x3c`, stride12. It compares the first field of each record. Named `UMeshAnimation::Serialize` at `0x106e6c30` passes `+0x38` to the retained array serializer; that serializer allocates 12-byte records and invokes the record serializer at `0x106b13d0`. The latter serializes its first field through archive vtable +0x1c, independently bound by the owned Core FArchive table to its named FName operator, followed by two DWORD fields. The original package reader independently preserves name, flags and parent from that record.

The relevant ordinary `GetFrame` path selects an instance linkup entry by its 24-byte index at `0x106da3ff..0x106da410`, retains it in the local later loaded into EDI at `0x106da54e`, and reads `entry+0x0c` at `0x106da5b0`. A negative mapped index branches to the next mesh bone at `0x106da774`. Otherwise that index is passed to the original track sampler at `0x106da600..0x106da60d`. Skipping this sampling insertion is not itself proof of the later fallback.
The separate [GetFrame fallback check](native-pose-fallback-evidence.md) follows
the zeroed mask, channel-zero copies and later reference/cached-pose selection.
An unmatched bone uses the mesh reference local values in the admitted neutral
single-channel path; another channel or modifier is a separate condition.

## Exact supplemental correspondence

| Owned block | Supplemental block | Size | Explained differences |
| --- | --- | ---: | --- |
| `0x106b9ee0..0x106b9f23` | `0x106b9ea0..0x106b9ee3` | 67 bytes | Two six-NOP sites become named `FArray::Empty` and `FArray::Add` imports |
| `0x106b9f60..0x106b9fd6` | `0x106b9f20..0x106b9f96` | 118 bytes | One six-NOP site becomes named `FName::operator==` |

Every other byte in these blocks matches. This comparison does not normalize arbitrary addresses. A full-builder comparison encounters different logging-global addresses; no claim of full-method identity is made.

The allocation prefix clears the result array and adds one DWORD per mesh bone. The matching loop initializes each result to `-1`, starts at animation index0, advances by12bytes on inequality, and stores the first matching index without continuing the inner loop. It then advances the mesh index. No parent field is read and no already-used-index table exists in this loop.

The imported symbol is `??8FName@@QBEHABV0@@Z`. Both Core inputs contain the same 18-byte body at the named export target `0x10109d40`. It compares `[this]` with `[argument]`, returns0/1, and returns with the four-byte member argument popped. It does not compare text, parents, bone transforms or occurrence counts.

The checker pins 28 caller/layout anchors. Its bounded instruction evaluator executes only this retained loop, with the separately verified FName DWORD equality as the explicit call boundary. It compares 105 authored cases to the portable first-match API; inputs include reordered names, duplicates, missing names and an empty animation array. This is not a general x86 emulator or native executable run.

## Portable API and decoded-name limits

`first_interned_linkup(mesh_names, animation_names)` accepts unsigned32-bit identifiers and returns one index per mesh bone, or `-1`. Duplicate mesh names may share one animation index. Duplicate animation names use their first occurrence.

`decoded_name_linkup(mesh_names, animation_names)` is a conservative convenience adapter. It accepts repeated identical spellings, but rejects a casefold bucket containing different spellings. It retains punctuation and does not invent aliases. The caller must establish original table identity; this helper does not prove a general native name-interning, locale, or Unicode policy.

A read-only audit of all14 actual ordinary face/animation inputs, freshly selected from original chargrp and bound model rows, found that **every used casefold name has exactly one original package name-table entry**. All14 decoded-name results equal their same-package token results. Thus this gate rejects no proven variant in the current corpus. Thirteen face skeletons map completely. The Human Fighter male exception is described below. No generated glTF/catalog was used as the native mapping oracle.

## Source face selection is a separate boundary

The optional audit below explicitly reads the named original face mesh and its animation. It does not execute player creation or prove that this mesh is active in every runtime context. The separately published [original class-default audit](native-hair-attachment-evidence.md) establishes each ordinary player's declared Mesh and HeadBone. The source skeleton exporter now additionally requires that the exact class
Mesh reference agrees with one unique original chargrp face entry and that its
stored animation reference names the same qualified animation export. All 14
ordinary player model sidecars pass these checks. Generate or independently
recheck them alongside the original keys:

```sh
python3 tools/anim/export_source_tracks.py --skeletons --write
python3 tools/anim/export_source_tracks.py --skeletons --check
```

These write or check private `assets/gamedata/animation-tracks/<model>.skeleton.json`
files. They retain exact reference locals, animation records and binding indices;
no generated browser pose is used to fill an absent native link.

Those source/class agreements must be distinguished from native runtime selection. A wider ordinary slot9 assignment trace exists in private research, but its complete loading/selection conditions have not been promoted into this linkup checker. This document therefore does not extend the checker into a general live master-selection claim. Transformation, alternate pawn and later resource changes remain outside its admitted scope.

## Human Fighter male: native rule versus exported adapter

The original `Fighter.MFighter_anim` has two reference bones named `Bip01_L_Finger01`, at indices13 and27; both use the same original package name entry. The original ordinary face master `Fighter.MFighter_m000_f` has `Bip01_R_Finger01` at mesh index27, a different name entry absent from the animation's reference-bone list.

The native result is:

- **69/70 mesh bones matched**; mesh27 stays `-1`.
- Its child28 still maps to animation28; the matching loop does not inspect its parent.
- Mesh18/19 map to animation19/18; mesh32/33 map to animation33/32.
- All remaining mesh indices map to themselves; animation27 is unused by this face master.

The existing browser assembler can instead send animation27 to its renamed right finger through a source-part structural permutation. That export association is reproducible, but it is **not** what this native first-name builder does. The new neutral inspector uses the native result instead: 69 animated links
and the original face reference local pose for bone 27, while child 28 remains
animated. This is supported by the separate
[fallback evidence](native-pose-fallback-evidence.md) and
[current-parent coordinate rules](native-pose-coordinate-evidence.md).
The displayed character still uses the existing browser skinning and hair
adaptations, so this does not certify its complete final appearance.

The optional `--audit-assets` verifies the specified original face/animation pair directly and reports original package/export fingerprints. It does not establish that every possible transformed pawn, appearance, or equipment context selects that same master mesh.

## Serialized movement maps and the inspector

The ordinary caller indexes tracks through this mesh-to-animation linkup.
Serialized movement `BoneIndices` does not replace it; an empty list is not
proof that no association exists. The current original-key inspector therefore
admits the 15 measured sequences with empty movement lists while retaining its
ordinary-mode, start-bone-zero and complete-track-array checks.

Its neutral scope is channel zero, base bone zero, root lock disabled and no
additional modifiers. First-name selection and reference fallback happen in
source space; current parent composition precedes the measured glTF matrix
basis conversion. A separate strict source-mesh-to-browser name/parent match
protects display correspondence without changing the native linkup rule.
See the [preview guide](native-track-evidence.md#browser-pose-preview) for both
required inputs, controls, comparison measurements and remaining limits.
