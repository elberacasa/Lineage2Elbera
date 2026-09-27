# Elbera Tools: original hair asset catalog

`tools/dat/build_hair.py` builds private source assets for every mesh referenced
by the fourteen ordinary player rows in the supplied Interlude hair table. It
does not use the old character assembler's head-region or rigid-hair rewrites.
The source selector and material state evidence are described in
[native-hair-selection-evidence.md](native-hair-selection-evidence.md).

Run from the repository root with the privately owned client and current player
models present:

```sh
python3 tools/dat/build_hair.py
python3 tools/dat/build_hair.py --check
node tools/dat/test_build_hair.mjs
```

The first command freshly checks the native selector/material evidence,
decrypts the original hair tables, reads the original skeletal and texture
packages, and writes `assets/gamedata/hair.json` plus content-addressed assets
under `editor/characters/hair/`. The second freshly repeats those source reads
and requires byte-identical outputs. The portable test command uses only
synthetic fixtures. `--source-only --output tmp/restart-audit/hair-raw.json`
provides an embedded raw-data diagnostic without writing image/mesh sidecars.
Original client paths are rejected as output locations. No generated file is
part of the public source release.

## What is exported and checked

The measured catalog contains fourteen model identities, 162 unique source
hair meshes with 27,449 LOD0 vertices, and 648 selected material references.
Those references resolve to 420 Texture objects and 228 FinalBlend objects;
their child textures bring the graph to 876 nodes. All 648 selected materials
pass the bounded original material-state helper. Freshly decoded mip-zero
images produce 580 unique PNG byte sequences; identical source colors share
an image, while their distinct original object identities remain in the graph.

The fifteen stored style entries remain in their original order. Each part
is either explicitly absent (`-1`) or carries its exact mesh and color-index
references. The raw keyed helmet and accessory tables preserve record order
and duplicate keys. The catalog does not infer equipment string matching or
the female Dark Elf upper-body override from appearance. Stored table capacity
and four texture probes do not themselves prove character-creation bounds.

Each mesh sidecar preserves the original LOD0 position, normal, UV, section
indices, material indices, skeleton names/parents/poses, local bone map and all
four skin weights. The decoder accepts only the observed version-5 skeletal
layout in archive versions 123/28 and 123/30. It checks each lazy-array's
absolute saved end against the exact export boundary, section/index coverage,
bone-map bounds, and finite input values. The section and vertex layouts are
independently cross-checked against the UEViewer serializers; the original
bytes, not UEViewer's assembled mesh, are the exported data. Material texture
indices are also checked through the independent ULodMesh reader.

This is a source-data format, `l2-interlude-hair-lod0-v1`, rather than an
implicitly attachable glTF. Its coordinates and normals retain the original
units and basis. Weights are not normalized, sorted, truncated or rebound.
Fourteen meshes use separate five- or thirteen-bone soft rigs; the others use
rigid vertex streams with their original section bone index. Native attachment
to the player's master instance is a separate admission requirement.

Material exports retain the qualified original object, export/property-stream
hashes, typed properties, fresh PNG/pixel hashes and original render state.
Packed scalar types and widths are checked. Duplicate scalar properties are
rejected; the two indexed `InternalTime` IntProperty values are preserved,
rather than silently overwriting index zero. The native shortened material
reference is joined to a unique matching package leaf; this is not a claim
that the native group resolver has been recovered. Filtering, cached-resource
overrides and complete D3D lighting remain outside the material-state proof.

## Existing browser geometry is a separate boundary

Every current default hair part is matched by exact node and mesh identity.
The full triangle multiset—including positions, UVs and winding—matches the
original LOD0. Its original material slot must select texture zero without
PolyFlags overrides, and its browser material must not be shared with another
part. Model and buffer hashes bind these receipts to the actual private build.

All 22 default parts pass that geometry check. All 3,245 emitted vertices have
different joint/weight identities from their source stream because the older
assembler rebound hair to the head. The catalog exposes this as
`skinProof.status = "built-influences-differ"`; it does not certify existing
skinning or bind-pose parity. `builtBindings` admits only material replacement
on the identified existing geometry. A material correction can therefore
remove invented tint or alpha settings without claiming that hair animation
is finished. Alternate source geometry remains explicitly unadmitted for body
attachment until the native master-instance rule is independently recovered.

The portable suite checks absolute/truncated array boundaries, bone maps,
unmodified fractional weights, triangle UV/winding comparisons, material
sharing, accessor bounds, packed property types/duplicate array elements and
read-only verification. These tests establish decoder and admission behavior;
they do not substitute for a visual or native animation comparison.

## Browser inspection

With the local editor running and the private catalog generated, open
`/test/original-hair.html` or choose **Original hair geometry and colors** in
the Elbera Tools inspection hub. Select a model, stored style index and color
index. The page exposes the base table's exact indices, including absent
parts; these stored slots are not character-creation menu bounds. Dwarf male
style 0 offers a small rigid-stream example; Dark Elf female style 0 also
contains a separate soft-rig hair part.

The inspector verifies the served LOD0 JSON and PNG bytes against the catalog's
SHA-256 values before display. It preserves source XYZ positions, UVs and
triangle order, using a Z-up inspection camera and static meshes. Material
admission requires a single texture-zero slot with explicit zero `PolyFlags`;
unimplemented overrides are rejected. The source Texture/FinalBlend state,
including strict greater-than alpha tests, is applied by the shared material
adapter. The optional **Show backfaces** control is an explicit inspection
override and is off by default.

The details panel shows exact source identities, hashes, sections, the first
vertex's influences and a link to the complete raw data. Bind bones and weights
are retained, but are not applied: this page does not demonstrate animated
skinning, equipment selection or body attachment. MeshScale, MeshOrigin and
RotOrigin are reported rather than applied. The unlit view, color-space choice,
texture filtering and camera are inspection settings; native cached-resource,
mip/filtering, lighting and complete renderer parity remain unresolved. The
page stays offline and never connects to the game server.

Portable inspection checks:

```sh
node --test editor/world/test/hair-inspection.test.mjs
```
