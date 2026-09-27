# Original hair selection: source audit, not a completed renderer

Elbera Tools independently checks the owner's original Interlude `Engine.dll`,
`Engine.u`, `hairgrp.dat`, `helmetgrp.dat` and `hairaccessarygrp.dat`. It decodes
the protected binary in memory and never executes it. Original inputs, decoded
tables, model/texture assets and the detailed receipt remain private.

```sh
python3 tools/ui/check_hair_selection_native.py --check
python3 tools/ui/check_hair_selection_native.py --check --audit-assets \
  --output tmp/restart-audit/hair-selection-audit.json
python3 -m unittest discover -s tools/ui -p test_hair_selection_native.py
```

The checker pins 78 instruction anchors, nine code ranges and the original
submesh enum. It also interprets only the straight-line literal-copy MOV/XOR
instructions that initialize the 14 native mesh/package/texture prefixes; it
does not execute protected calls. The receipt records original file hashes.
Engine identity is the same pinned build as the
[face selector](native-face-selection-evidence.md).

## Proven ordinary selection

`User::GetPcMeshName` (`0x10482c90`) and `GetPcTexName` (`0x10486000`) select
`PMS_Hair1=5` and `PMS_Hair2=4` separately. `User+0x240` is hairstyle and
`User+0x244` is hair color, independently bound by the
[appearance packet proof](native-appearance-wire-evidence.md). The native
model row and exact Chargrp face identity agree for all 14 ordinary models.

`hairgrp.dat` contains 15 rows × 15 styles × two signed DWORDs, followed by the
SafePackage trailer. The reader at `0x104460c0` consumes each pair in order but
stores its first value at `15*row+style` and its second at
`15*(row+15)+style`. These are **two hair-part mesh indices**, not a mesh index
and a texture index. A value of `-1` suppresses that part only. In particular,
the first default part is absent for male Dark Elf/Dwarf and the four Orc
models, while their second hair part is present. This does not mean that hair
is painted into the face texture.

For the admitted table, native format literals and surviving arguments are:

| Part | Mesh | Texture, layer zero |
| --- | --- | --- |
| Hair1 | `package.prefix_m00{index}_m00_ah` | `prefix.prefix_m00{index}_t0{color}_m00_ah` |
| Hair2 | `package.prefix_m00{index}_m00_bh` | `prefix.prefix_m00{index}_t0{color}_m00_bh` |

The spellings are literal native `%d` templates, not arbitrary three-digit
padding for any integer. Color selects a different original material/texture
reference. No average-RGB tint is involved in this source path. The shared
placeholder hair arrays in Chargrp are not the ordinary hair selector's table.
The 15 storage slots are not proof that the creation UI offers 15 hairstyles;
the exact creation-control bounds remain a separate question.

## Headgear and body-dependent branches

`GetHairMeshType` (`0x10485ec0`) calls `GetPcMeshName` for Helm/HairAcce1/HairAcce2
slots 6/7/8. Its surviving code uses the literal `_m0`, reads two UTF-16 digits
at offsets 6/8 from the returned substring, validates both against `0..9`,
and computes `10*tens+ones`. The protected name/string helpers are still
unbound, so the checker does not claim a complete implementation of arbitrary
equipment-name parsing. These are mesh-derived keys, not item IDs.

The hair selector checks accessory key/presence first, then the helmet key.
Precisely, when the slot-7 mesh key is positive, `HaveItem(17)` selects the
accessory table with that key; otherwise `HaveItem(18)` selects it with the
slot-8 key. The second accessory check is also inside that positive slot-7
key branch. If neither branch selects an accessory table, a positive helmet
key selects `Helmetgrp`; helmet key zero selects the base Hairgrp table.
`HaveItem` checks the corresponding `User+0x98+4*slot` value is positive.
Failed selected-table lookup does not justify substituting the default style.
The equipment DAT loaders read a count, then each key and the same 450 signed
words. This owned build has helmet keys `[1,2,3]` and accessory keys `[0,1,2,3]`.
The helper preserves duplicate keys rather than guessing overwrite behavior.

There are additional row-3 (female Dark Elf) branches after ordinary selection.
They inspect upper-body mesh slot 2 and explicit `m003_u`, `m006_u`, `m009_u`
references, with corresponding `_u00` hair mesh/material replacements. The
comparison helper is protected. The audit records these branches and their
range hashes; it does not activate a guessed string comparison or apply the
ordinary formula unconditionally to equipped actors. Linked/transformed pawn
selection, equipment precedence beyond this traced path and full material
rendering remain separate work.

## Existing browser assets and next correction

The optional asset audit checks original mesh export identity for every
nonempty table slot and four explicitly probed color indices (`0..3`). The
four-color probe is asset coverage, not an independent creation-UI bounds
proof. Source references include both `Texture` and `FinalBlend` exports;
flattening every reference to an image loses material behavior.
The fresh owned-input census finds 162 unique mesh references and 648 unique
material references (420 Texture, 228 FinalBlend), with none missing under the
explicit matching rule below.
The native material format omits the source exports' `Hair` outer group. The
receipt preserves both the original reference and actual qualified object,
admitting only unique package-leaf matches for this asset census. The native
resolver's omitted-group semantics are not yet bound; this is not a claim that
an arbitrary shortened reference can be safely resolved at runtime.

All 14 current default glTFs have the expected 22 default hair part names. The
audit also compares their hair POSITION sets directly with original UKX LOD0
vertices, using the existing measured conversion basis. This certifies that
bounded position comparison only: it does not certify UVs, skin weights,
alpha state, shader graphs, lighting or complete placement. Nondefault meshes
exist in the original inputs, but the current player glTFs contain only their
default hair parts. No alternate hair meshes are exported by this audit.

The current creator's `extract_charcreate.py` labels the pair as
`(meshIndex, textureIndex)` and derives `paintedOnly`; those interpretations
are superseded by this proof. `editor/charcreate/app.js` still applies a sampled
average color to the default hair material and does not swap the hairstyle
mesh. That preview is not native hair fidelity. The world appearance module
currently reports hairstyle/color as unsupported instead of claiming them.

The smallest honest next implementation is a source catalog with separate
Hair1/Hair2 entries, explicit absent-part state, exact source mesh identities
and exact color references. Export each selected skeletal part against the
existing original skeleton, verify its binding, and preserve its actual
material graph. A narrow default-style color slice could reuse existing
geometry, but only after its original Texture/FinalBlend state is admitted.
Headgear and row-3 equipment overrides must either be source-implemented or
remain explicitly unsupported. This checkpoint changes no runtime behavior.
