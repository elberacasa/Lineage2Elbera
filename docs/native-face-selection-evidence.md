# Elbera Tools: ordinary player face selection

The browser now retains an explicitly received face index and applies that
index's original `chargrp.dat` texture to the source-bound face part of each
ordinary player model. It reports unsupported indices and hair fields rather
than selecting another face or applying an averaged hair tint. This is a
bounded face-selection correction, not complete native appearance rendering.

## Reproduce

```sh
python3 tools/ui/check_appearance_native.py --check
python3 tools/ui/check_face_selection_native.py --check
python3 tools/dat/build_appearance.py
python3 tools/dat/build_appearance.py --check
node --test editor/world/test/appearance.test.mjs
node tools/dat/test_build_appearance.mjs
```

The first two commands decode only the owner's supplied original files in
memory. The exporter writes the ignored local `assets/gamedata/appearance.json`
only after every source and built-model check succeeds. `--check` freshly
decrypts the DAT and rereads the original packages; it compares that result
with the catalog. It never rebuilds models or edits the library images.
The two portable test suites use synthetic data and need no original assets.

## Original selector

The pinned Engine.dll SHA256 is
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`,
image base `0x10300000`. Engine.u is
`9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761`.
The [wire evidence](native-appearance-wire-evidence.md) independently binds
the original UserInfo/CharInfo face DWORD to `User+0x248`.

Fresh original `Actor` ScriptText declares `PMS_Face` at ordinal 9.
The named `User::GetPcMeshName` body `0x10482c90` dispatches slot 9 through
`0x10483dbc` to `0x104838af`: multiply the model row by `0x274`, then read
`0x10b3e180 + row*0x274`. It selects the first face mesh, independent of the
face texture index.

The named `User::GetPcTexName` body `0x10486000` reaches its default-part table
for texture layer zero. Slot 9 goes through `0x10486efc` to `0x104868d7`:

```
address = 0x10b3e1d0 + 4 * (row * 0x9d + User.face)
```

No clamp, nearest index or face-zero fallback occurs in that selector slice.
The web port deliberately refuses an out-of-range source index instead of
attempting the original unchecked memory read.

The named `GL2GameData` export is `0x10b3c890`. `CharDataLoad` at
`0x104504d0` names `Chargrp.dat`, reads 15 records with stride `0x274` and
places them at `this+0x183c`. Its binary serializer `0x1044c2c0` stores the
third array at record `+0xb4` and fourth at `+0x104`. Independently, its
text-loader branch names `face_mesh` at `0x10895b6c` and stores it at
`this+0x18f0`; `face_texture` at `0x10895b4c` goes to `this+0x1940`.
These are exactly the two absolute arrays consumed above. The checker pins
28 instructions, four complete relevant byte ranges and 42 row/index address
cases using instruction-backed arithmetic; it does not emulate native memory
reads. Name/serialization calls represented by six NOPs in this recovered
copy are not assigned guessed import identities.

## Binding original data to a built face

The exporter joins freshly decrypted `chargrp` body/face arrays to the existing
14 model bindings; the independently established original pawn-class row
mapping agrees. For each face part it verifies all of the following:

- One exact original SkeletalMesh and one corresponding built mesh/node.
- Original LOD0 position-set equality with the actual glTF positions in the
  already audited source-to-built coordinate basis.
- One face primitive, its exact material, UV channel zero, and no material
  sharing with another built part.
- Each selected `chargrp` texture name resolves to one original package
  object of class Texture. Saved group-qualified identity is retained.
- Every existing served PNG has the original mip-zero dimensions and **exact
  decoded RGBA byte equality**, with no tolerance, tint, crop or upscaling.
- Face zero's existing glTF image is byte-identical to the checked library
  PNG. Catalog records retain original package/export, image and built-file
  hashes.

The source references omit their saved `Face` group. This checkpoint proves
the selected name, unique original package object and pixels. It does **not**
prove the native generic group-resolution algorithm. Geometry-set equality
also does not certify UV export, topology, weights or complete native material
state. The browser preserves its existing face material and sampler settings
and replaces only the source image.

The measured supplied build passed all 14 model bindings, 2,713 unique face
positions (summed across those parts), and 42 images totaling 2,752,512 RGBA
texels. Original `chargrp.dat` SHA256 is
`2bb52de25ef3558f51e458c0095efcd9c509dfd5b5695a269f268b5f235fbc0f`;
fresh decrypted payload SHA256 is
`c0d5327143c940c65ad533810668133628e28884b4c47cf439bb654ee88264eb`.
The checks require byte equality, including alpha; a one-unit RGB or alpha
change is rejected by the portable exporter regression.

## Lifecycle and remaining limits

`Character.setAppearance(snapshot)` merges only explicitly supplied `face`,
`hairStyle` and `hairColor`, and returns a promise that resolves to an explicit
status. Repeated identical packets share a pending request. A newer face or
model retires older work. `cancelAppearance()` retires pending work and owned
material/texture wrappers; subsequent explicit requests remain allowed.
`Character.load()` reapplies the latest retained appearance after adoption.
Shared decoded source images and original materials are not disposed.

The creator preview reuses this controller and the same catalog. Its existing
race/class/model loader and controls remain in place. Face chips retain each
catalog record's original index, including a noncontiguous synthetic index
regression; `cc:create.face` sends that value unchanged. Missing or malformed
face metadata offers no substitute faces and disables creation until a source
choice is available. An image failure is shown as an unavailable preview;
it does not silently select a different face. The index remains selectable
when its source catalog record is valid.

Model changes and page retirement cancel face work before disposing model
materials. A late image or glTF completion cannot adopt into the replaced or
retired preview; a persisted-page return reloads the selected model. The
standalone creator server exposes only `/js/appearance.js` and
`/gamedata/appearance.json` as additional fixed read-only routes. Its existing
`/faces/` route supplies the checked pixels. The embedded creator uses the
world server's existing routes.

`node --test editor/charcreate/test/appearance.test.mjs` runs ten portable
tests over actual creator functions and actual shared-controller behavior,
with synthetic Three meshes, a DOM substitute and a no-service server-route
check. These cover selection/packet indices, cancellation, model replacement,
page restoration, missing metadata and image failure. Browser verification
is separate; these tests do not establish creator layout, lighting or native
camera parity. Hair controls/tint were not changed by this face integration.

An ordinary browser check selected female Human Fighter and face C, created
the character on the configured local server, selected it, entered the world,
then disconnected and reloaded before entering again. The visible Elbera Tools
body measurement reported `status: ready`, `face: 2` and
`FFighter.FFighter_m000_t02_f` after reconnect. Hair fields remained explicitly
unsupported. No grants, database edits or forged character packets were used.
The measurement is a browser-runtime observation, not a complete native
rendering comparison. The face inspector separately exercised indices0/1/2
for male Dwarf and female Human Fighter, including model replacement.

The ordinary face path is implemented. Hair mesh/type/color selection remains
unsupported: the original `GetPcTexName`, `GetPcMeshName` and
`GetHairMeshType` paths select exact source assets, including separate hair,
helmet and accessory tables. The creator's historical average-RGB tint is
not evidence of those selectors and is never consumed by the shared face
controller. The creator's separate existing hair-tint path remains unverified
and outside this face-only integration.
Transformed/linked pawns, face item overrides, dynamic hair/helmet hiding,
full native shaders and runtime class/sex model reselection are separate
boundaries. A valid face implementation does not establish those behaviors.
