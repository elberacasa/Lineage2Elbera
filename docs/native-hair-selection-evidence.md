# Original hair selection: source audit, not a completed renderer

Elbera Tools independently checks the owner's original Interlude `Engine.dll`,
`Core.dll`, `D3DDrv.dll`, `Engine.u`, `hairgrp.dat`, `helmetgrp.dat` and
`hairaccessarygrp.dat`. It decodes
the protected binary in memory and never executes it. Original inputs, decoded
tables, model/texture assets and the detailed receipt remain private.

```sh
python3 tools/ui/check_hair_selection_native.py --check
python3 tools/ui/check_hair_selection_native.py --check --audit-assets \
  --output tmp/restart-audit/hair-selection-audit.json
python3 -m unittest discover -s tools/ui -p test_hair_selection_native.py
```

The selector check pins 78 instruction anchors, nine code ranges and the original
submesh enum. It also interprets only the straight-line literal-copy MOV/XOR
instructions that initialize the 14 native mesh/package/texture prefixes; it
does not execute protected calls. The receipt records original file hashes.
Engine identity is the same pinned build as the
[face selector](native-face-selection-evidence.md).
The material extension pins a further 153 instruction anchors and 15 ranges;
it does not execute the binaries or infer native state from another port.

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

## Original hair material states

`verify().materialProof` is `elbera-hair-material-native-v1`. It binds the
original reflected `UField.Next` chains, typed native copy constructors and
Core's boolean packing; source declaration order alone is insufficient.

| Original source evidence | Bounded result |
| --- | --- |
| Texture chain `Specular → bMasked → bAlphaTexture → bTwoSided`, typed copy `0x103f1329–0x103f136a` | Flags at Texture+0x5c0 are masks 1, 2 and 4 respectively. |
| D3D `0x1000faa0`, named imports `UTexture::StaticClass` and `UObject::IsA`; `SetSimpleMaterial` `0x1000ce3c–0x1000ceae` | Masked takes precedence over alpha-texture. Masked uses AlphaRef127 and overwrite blending; alpha-texture uses AlphaRef0 and alpha blending. Both enable alpha testing. |
| Modifier-info constructor `0x10007630`; real caller `0x10029120`; render-pass constructor `0x10007c80` and default-template copy `0x10028fc3` | Ordinary opaque Texture starts with alpha test/blending off and depth read/write on. Source two-sided state remains independent. |
| FinalBlend reflected chain and typed copy `0x1034a010` | `ZWrite`, `ZTest`, `AlphaTest`, `TwoSided` are separate masks 1/2/4/8 at +0x580. AlphaRef is the byte at +0x584. `TreatAsTwoSided` is a different field, not a replacement for `TwoSided`. |
| D3D unwrap `0x10011143–0x1001119c`; common switch `0x1000f4a0` | An explicit FinalBlend suppresses the underlying Texture flag override. Admitted blend arms are FB_Overwrite0 and FB_AlphaBlend2; the latter uses source-alpha/inverse-source-alpha. |
| D3D `0x10022fb4–0x10022fe2` and actual state-send sites | Native alpha comparison is **strictly greater** than AlphaRef/255, including equality rejection. Do not substitute 0.5, 0.8 or Angel's 160. |
| Core `UObject::InitProperties` `0x1015fb00`, retained zero-fill `0x10108420`, and uniquely validated original class defaults | New property bytes are zero-initialized after inherited defaults. FinalBlend explicitly defaults ZWrite/ZTest to true. Omitted AlphaRef resolves to zero; it does not inherit the child Texture's 127. |

The renderer's enum/state transfer is the same original D3D source described
in the [NPC material evidence](native-npc-material-evidence.md), but the hair
admission does not reuse the Angel graph shape, shader requirement or cutoff.
It is scoped to the ordinary material without ColorModifier, actor opacity
overrides or other graph modifiers. Lighting, complete D3D passes and render
ordering remain separate fidelity questions.

The fresh base-table census covers 648 references: 420 plain Texture and 228
FinalBlend, each of the latter wrapping a plain Texture directly. The Texture
records comprise 340 masked/two-sided, 49 opaque/two-sided and 31 opaque
records. All 228 FinalBlends explicitly enable alpha testing, alpha blending
and two-sided rendering. Their source AlphaRefs are 5 (166 records), 150 (40),
160 (4), and 1/3/200 (one each); 15 omit the property and resolve to zero.
These are four color probes across the stored base table, not headgear-table
coverage or a creation-control bounds proof. The private graph receipt keeps
every original field and qualified child identity.

The source-only exporter [build_hair.py](../tools/dat/build_hair.py) calls the
pure `hair_material_state(class_name, typedProperties, child=None)` helper.
For FinalBlend, `child` must explicitly be
`{class: 'Texture', properties: typedProperties}` and `Material` must retain
its exact `{reference: qualifiedSourcePath}`. Unsupported graph classes,
unknown properties, invalid byte/boolean types and unverified blend arms
return `status: unsupported`, with a reason; there is no diffuse-only fallback.
A supported result retains blend source/destination numbers, alpha-test enable,
the exact AlphaRef and strict comparison, depth flags, two-sided state,
the separate TreatAsTwoSided hint, and source texture flags.
AlphaRef0 with alpha testing enabled must still reject alpha zero; a browser
API that treats cutoff zero as disabling the test needs a separate enable gate.
Exporter source identity/pixel checks remain required independently of this
pure state helper. Its portable tests cover those rejection boundaries,
explicit false/zero, mask precedence, omitted AlphaRef and child overrides.

## Sampling boundary

BitmapMaterial's reflected chain and typed copy bind UClampMode/VClampMode to
bytes +0x579/+0x57a. Named `FStaticTexture::GetUClamp/GetVClamp` at
`0x1073e2b0/0x1073e2c0` read those bytes. The original enum is Wrap0/Clamp1;
the source-address branch at D3D `0x1000f42c–0x1000f477` maps those to address
states 1/3. The supplied class defaults and hair objects omit both properties,
so both source modes are zero.

This is **not full sampler parity**: the preceding cached-resource branch can
override those address states, and native filtering, mip selection and authored
mip-chain behavior are not closed here. Descriptors therefore label sampling
`source-address-branch-only`. An image/state correction may preserve the
existing browser sampler with this limit; it must not claim the current
repeat/linear/trilinear exporter settings were recovered from native code.

## Existing browser assets and correction boundary

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

Before this correction, the creator's `extract_charcreate.py` labeled the pair as
`(meshIndex, textureIndex)` and derived `paintedOnly`; those interpretations
are superseded by this proof. The pre-correction creator applied a sampled
average color to the default hair material without swapping the hairstyle
mesh. That preview did not provide native hair fidelity. The world appearance
module initially reported hairstyle/color as unsupported; runtime admission
must follow the exact source catalog and state rules rather than those earlier
creator interpretations.

The implementation contract is a source catalog with separate
Hair1/Hair2 entries, explicit absent-part state, exact source mesh identities
and exact color references. Export each selected skeletal part against the
existing original skeleton, verify its binding, and preserve its actual
material graph. Default-style material/image replacement can reuse existing
geometry while retaining its known skinning/attachment limits. The old
assembler's rigid-head and root-weight rebinding are not certified by a
position-set match and must not be copied into new alternate-hair exports.
Headgear and row-3 equipment overrides must either be source-implemented or
remain explicitly unsupported. This checker itself changes no runtime behavior.
