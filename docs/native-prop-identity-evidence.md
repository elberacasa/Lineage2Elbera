# Elbera Tools: qualified prop identity repair

The original package contains distinct StaticMesh objects under different
groups with the same leaf name. The inherited world exporter discarded the
group and reused one mesh file for all of them. This checkpoint repairs six
source identities across11placements in17_25; it does not certify every map,
texture decoder, shader, transform or native rendering rule.

## Inputs and reproduction

These are the supplied Interlude files, read locally. No original bytes,
textures, meshes or private receipts are included with the public tool code.

| Input | SHA-256 |
|---|---|
|17_25.unr|8dbe180888719dcb2216b866caa85aaf38f18e2686dc7cb8f78ba722bfe63857|
|v_obj_s.usx|6391f5c4e22f97430eee8e36c0191c2b2bd4324ed1ed790958df4304dd21839d|
|V_Obj_T.utx|080ca71ddf4ac7fba6691d558b09f4b44eb630c0108cca7a4fa9605ffc999db2|
|local umodel exporter|404bc44de029825b452052a4f3a6ad510e0c3e45d45ad6229c9c79398266d3fb|

From the repository root, stage without changing live assets:

```sh
python3 tools/world/convert.py --repair-prop-identities 17_25 \
  --mesh V_Obj_S.Etc.O_Cart01 \
  --mesh V_Obj_S.Speaking_Town_S.O_Cart01 \
  --mesh V_Obj_S.H_Wares.O_Tank02 \
  --mesh V_Obj_S.Speaking_Town_S.O_Tank02 \
  --mesh V_Obj_S.H_Wares.O_Tank03 \
  --mesh V_Obj_S.Speaking_Town_S.O_Tank03
```

The tool prints an ignored staging/receipt path. Repeating the same command
with `--emit` builds a fresh stage, backs up the original scene and adopts the
verified files. Optional `--stage` must name a new directory inside ignored
`tmp/restart-audit`. It never runs the full converter or its file cleanup.

```sh
python3 tools/world/convert.py --check 17_25
python3 -m unittest discover -s tools/world -p test_prop_identity.py
```

## What is independently checked

`prop_objref` preserves its legacy fields and additionally resolves the full
original import/export outer chain. Broken/cyclic references fail. Grouped
UEViewer exports use exact package/group/name paths, with no basename fallback.
The bounded source reader handles file123/licensee-below17 render streams and
the selected V_Obj_S objects. Required materials must resolve uniquely to
original V_Obj_T Texture objects; other material domains remain unsupported.

For each source material section, a triangle-position multiset is constructed
directly from the original vertex/index streams. It must match the exported
glTF exactly after UEViewer's Float32 `0.01` scale and axis conversion, both
before and after the existing proper-basis correction. This comparison retains
triangle multiplicity and material association. It does not independently
certify winding, normals, UVs, lighting, all shader behavior or compression
equivalence. Complete native render parity is a larger task.

Each glTF copies its own sibling buffer, rewrites the URI to the qualified
destination filename, and validates the buffer length/accessor bounds. The old
general path could rename a buffer without updating its reference; it now uses
the same paired-copy helper. Exactly12 source texture identities are needed
for this selection; their grouped exports match existing local texture files
byte for byte, so adoption leaves those shared files untouched.

Scene matching uses original mesh identity plus unchanged position, rotation
and scale, rejecting missing/ambiguous matches. It changes only `gltf` and
adds `sourceMesh` on matched rows. New glTF metadata records sourceMesh and the
original export hash. Before adoption, source files and the original scene
must still match their staging hashes/bytes. Existing output byte conflicts
fail. New files are installed first, the scene is replaced atomically last,
and a failed adoption removes newly created files. Old leaf files are retained.

## Adopted local result and browser check

| Source variants | Render triangles | Scene placements |
|---|---|---|
|Cart01: Etc / Speaking_Town_S|210 /246|1 /1|
|Tank02: H_Wares / Speaking_Town_S|70 /70|4 /2|
|Tank03: H_Wares / Speaking_Town_S|124 /122|1 /2|

The legacy Cart file matched Etc, wrongly reused for the town Cart. The legacy
Tank03 matched H_Wares, wrongly reused for two town placements. Tank02's old
file used the three town material names while four H_Wares placements require
two different source materials. Equal triangle counts do not establish equal
geometry or material identity.

The final dry stage left all947live tile files unchanged. Explicit local
adoption added six glTF/buffer pairs, changed exactly11scene rows and preserved
all other scene fields/transforms. Shared textures were already identical.
Scene validation still reports986props and10terrain layers. The backup/receipt
is under `tmp/restart-audit/prop-identity-17_25-adopt/`.

The offline [prop comparison](http://127.0.0.1:8083/test/prop-identity.html) was
visually checked for all three families. It shows the retained legacy asset
beside both source variants at a shared camera scale, with rendered triangle
counts, material names and original export fingerprints. Qualified loads must
match the glTF's embedded identity before appearing. Diagnostic lights/cameras
are explicitly separate from game presentation. Browser inspection caught and
fixed a high-DPI canvas sizing error; no console errors were captured after
the correction. Retired views release geometry, materials, textures and owned
ImageBitmap resources; this is not a measured long-session memory benchmark.

## Remaining scope

Twelve portable repair/conversion tests cover same-leaf separation, correct buffer pairing,
placement matching, pre-mutation collision refusal, conflict rejection, backups,
rollback and stale scene/source refusal. Ten terrain-edge regressions also pass.

The full converter now validates every original qualified StaticMesh identity
against its own package before output mutation, exports with original groups,
and selects the exact qualified geometry. It retains the legacy `mesh` label,
adds `sourceMesh` and an export fingerprint, and pairs each qualified glTF with
its own renamed binary URI. The global basename geometry fallback is removed.
This also handles a map using only one member of a package's duplicate leaves.

Twelve portable tests cover same-group/leaf, cross-package and singleton cases,
unknown or ambiguous originals, missing exact grouped exports, safe buffer
pairing and the earlier selective adoption/rollback paths. Fresh private stages
passed for17_25's six variants/11placements, its singleton Town Cart, and18_21's
ten variants/16placements. All staged triangle sections/material slots matched
original geometry after the known f32 scale/basis transform. All1,477existing
live files across those maps remained unchanged; no full-map conversion or
new cross-map adoption was performed. Receipt:
`tmp/restart-audit/general-qualified-props/receipt.json`.

General texture/material lookup remains legacy leaf-based and explicitly
unverified, even though these selected stages had no missing texture names.
Full conversion still has its broader non-atomic write/prune workflow; use fresh
staging and the backed-up selective repair path for controlled live changes.
The cross-map reference census is described in
[picking evidence](native-picking-evidence.md#cross-map-qualified-reference-census).
Qualified geometry alone does not certify normals, UVs, shaders or the world.
