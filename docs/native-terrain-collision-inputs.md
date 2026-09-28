# Original terrain collision inputs

[Elbera Tools exporter](../tools/world/export_terrain_collision.py) reads the
original terrain actor, its **fully qualified** G16 texture reference, saved
coordinate transforms and topology arrays. It supplies input for the separate
[terrain collision primitive](native-terrain-collision-evidence.md). It does
not use rendered terrain meshes, browser height queries or configured-server
geodata as evidence.

The default output deliberately omits `owner`, `deleteMe` and
`terrainMapPresent`. Original package/default values are retained in provenance;
they do not observe a live actor. `--diagnostic-static-state` explicitly adds
`owner:null`, `deleteMe:false` and `terrainMapPresent:true`, labeled
`scope.actorState: "explicit-diagnostic-query-state"`. This is suitable for a
static source query, not automatic production admission or evidence of loaded
neighbor levels. An explicitly deleted source actor rejects that option.

## Commands and inputs

Python 3, standard library, repository tool sources and privately owned
Interlude packages are required for export. The native binding check also needs
Capstone 5.0.7. Portable tests and CLI help need no client files or Capstone.

```sh
python3 -S tools/world/test_export_terrain_collision.py
python3 tools/world/export_terrain_collision.py --help

# Read original inputs and print metadata; write nothing.
python3 tools/world/export_terrain_collision.py --tile 17_25 22_22

# Create fresh private diagnostic inputs; existing files are refused.
python3 tools/world/export_terrain_collision.py --tile 17_25 22_22 \
  --output-dir tmp/terrain-collision-diagnostic --diagnostic-static-state --write

# Independently regenerate and compare exact output bytes.
python3 tools/world/export_terrain_collision.py --tile 17_25 22_22 \
  --output-dir tmp/terrain-collision-diagnostic --diagnostic-static-state --check

# Owned-only report: explicitly leaves the erased call identities unresolved.
python3 tools/world/export_terrain_collision.py --native-binding-check

# Optional exact correspondence, using explicitly supplied pinned supplements.
python3 tools/world/export_terrain_collision.py --native-binding-check \
  --comparison-engine /owned/supplement/engine.dll \
  --comparison-core /owned/supplement/core.dll
```

`--write --overwrite` is an explicit replacement operation. Without it,
publication of each completed temporary output refuses an existing file or
symlink. Multiple tiles are independent files, not a transactional batch.
No output is written to served world assets by these examples.

The original input layout is `assets/interlude/maps/<tile>.unr`, the exact
referenced package under `assets/interlude/textures`, and pinned files under
`assets/interlude/system`. Missing packages remain errors. Source fingerprints,
export hashes, qualified object identities and consumed byte spans accompany
each generated record. The current Core and NPC Source standalone kits do not
include this exporter; it runs from the repository checkout.

## Source bindings

The pinned owned Engine SHA-256 is
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`;
Core is
`9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf`.
The checker also binds fresh `Engine.u` and `Core.u` hashes. Optional comparison
copies have hashes
`508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d`
and `d83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639`.
Their [archival provenance and correspondence limits](supplemental-engine-evidence.md)
remain separate from vendor authentication. No executable is run or restored.

All addresses below are preferred virtual addresses for these builds.

| Evidence | Bound behavior |
| --- | --- |
| `ATerrainInfo::Serialize`, `10739d18..10739e39` | Licensee version >=17 writes sector references/counts; forward FCoords at `+212c`, inverse at `+215c`; width/height at `+210c/+2110`. Legacy version branches are explicitly excluded. |
| FCoords serializer, `106af200..106af2b6` | Twelve ordered four-byte component transfers through `ByteOrderSerialize`. |
| `HeightmapToWorld`, `10364ee0..10364efd` | Exact supplemental import correspondence identifies `FVector::TransformPointBy`; `WorldToHeightmap` uses the inverse field and the same named operation. |
| `GetHeightmap`, `1071bfab..1071bfe7` | TerrainMap `+3c0`, G16 format 10, unsigned 16-bit sample at `y*textureWidth+x`. |
| `UpdateVertices`, `10720a6d..10720ad9` | G16 sample and integer grid coordinates become Float32 inputs, then the saved forward FCoords produce the stored three-component base vertex. |
| Typed copy plus linked property declarations | `TerrainInfo+20e0`, mask `0x01` (bit 0), is `Inverted`. `Actor+64`, mask `0x80`, is `bDeleteMe`. |

The four supplemental blocks preserve all bytes except explicitly identified
import replacements and checked direct-call relocations. The owned Core
TransformPointBy wrapper/arithmetic and Bool-Link ranges are byte-identical to
the supplied Core. Owned-only mode checks retained instructions and marks the
six-NOP import sites as erased; it does not claim to identify them on its own.

The native coordinate formula subtracts the FCoords origin, takes each axis
dot product and stores each result as Float32. The admitted export domain has
diagonal axes `(128,128,0.296875)`, inverse axes stored by the source, and forward
origins on a 1/64 grid within ±2^20. For these integer/G16 inputs each operation
before the final store fits binary64 exactly. Other transforms are refused,
not coerced into this domain.

## Bitmaps, seams and dimensions

The [earlier terrain evidence](native-terrain-evidence.md) binds native bitmap
lookup and PostLoad behavior. PostLoad copies current arrays to Orig, sets
outer-row/column visibility, and preserves current edge-turn choices. The
exporter emits those current boolean arrays and fingerprints the serialized
current/Orig words separately.

For serialized dimensions 256×256, ordinary collision uses cells 0..254.
`Vertices(index)` at `1071d430` selects
`group=((index>>8)<<4)+((index&255)>>4)`, `sample=index&15` for indices 0..65535.
`UpdateVTGroup` copies these first 16 samples of every group directly from the
base array. Its appended seventeenth sample and row 256 are separate. The
reviewed neighbor setters write those appended coordinates, disjoint from all
65,536 base selections. Direct-base fallback selects the same source points.

This finite equivalence does not claim arbitrary later VTGroup replacement,
editor mutation or complete streaming behavior. The checker also records a
complete decoded-range census of dimension references through each reviewed
body's main receiver register; none writes the dimension fields. This is not
an alias analysis or proof of transitive callee effects. Expanded **sector rendering**
dimensions are distinct from the saved TerrainInfo dimensions.

## Strict source framing and measured coverage

The source reader requires one qualified `Engine.TerrainInfo`, its checked
actor prefix, bounded tagged properties, all 256 distinct sector references,
16×16 sector dimensions and 256×256 saved terrain dimensions. It stops after
that native prefix and hashes the remaining tail. An opaque state-frame DWORD
is preserved without treating it as a runtime initial-state value.

Texture selection follows the entire import/export group chain. It requires
one qualified `Engine.Texture`, format G16, one 256×256 mip, matching tagged
dimensions and complete export consumption. Neither leaf-name fallback nor
“first height texture” selection is admitted. The TerrainInfo must also appear
in the original serialized Level actor arrays.

Fresh checks passed for:

| Map | Exact TerrainMap | Base vertices | Independent saved-bound values |
| --- | --- | ---: | ---: |
| `17_25` | `T_17_25.Height.17_25` | 65,536 | 1,536 |
| `22_22` | `T_22_22.Height.22_22` | 65,536 | 1,536 |

Every original sector's four stored corner bounds agree with the freshly
decoded coordinates/heights. The producer checks both map outputs byte for
byte after generation. This is source-input evidence; full level collision,
terrain participant discovery, ownership, live deletion and loading order
remain separate responsibilities. The generated JSON remains private.
