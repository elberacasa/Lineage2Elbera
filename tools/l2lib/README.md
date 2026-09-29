# l2lib — unified parser core for Lineage 2 Interlude file formats

Python 3 library for supported L2 Interlude package, texture and record
formats. Its readers use the standard library; some encrypted inputs need
the external decoder described below. It consolidates knowledge that was
previously duplicated across `tools/utx/utxedit.py`,
`tools/src/char_pipeline/extract_materials.py` and `tools/dat/l2dat.py`
into one tested package. Those tools are untouched; future code should use
l2lib instead.

The full repository's integration tests compare selected original files in
`assets/interlude/` with reference-tool output (`tools/bin/umodel` and
`tools/bin/l2encdec`). Those private inputs and third-party executables are
not distributed. Coverage is bounded by the supported versions and tests;
this is not a claim that every client format or behavior is recovered.

## Modules

| Module | Contents |
|---|---|
| `l2lib.ue2package` | UE2 package container (.utx/.ukx/.unr/.u): header, name/import/export tables, FCompactIndex, property tags, Texture bodies, Shader→diffuse resolution, SkeletalMesh material slots, Lineage2Ver decryption |
| `l2lib.l2dat` | `.dat` files (L2ASM/L2FileEdit binary): 413/RSA decryption wrapper + record readers (`DatReader`) |
| `l2lib.classdata` | Bounded file-123 UClass prefix reader; supported original expression serializers locate default properties without a terminal-stream search |
| `l2lib.declarations` | Bounded file-123 property declarations, signed dimensions, conditional replication words and complete reference identities |
| `l2lib.textures` | Pixel decoders to RGBA8 (DXT1/DXT3/DXT5/RGBA8/RGB8/L8/P8/G16), mip extraction, stdlib PNG writer |

## API overview

`l2lib.classdata.read_class_default_prefix(package, export)` returns original
prefix fields, serialized script tokens and the relative default-property
offset, with source hashes. Unsupported tokens fail explicitly. Script memory
size is separate from saved byte length; the reader does not execute scripts,
parse default tags or construct live class state. See the
[source evidence and example](../../docs/native-class-defaults-evidence.md).

`l2lib.declarations.read_property_declaration(package, export)` reads a saved
property declaration through its exact export end. It retains the two-byte
replication word when property flag `0x20` is set, before reading subclass
references. It also retains dimensions, category, ClassProperty's separate
metaclass and source hashes. Scalar, Byte, Object, Class, Struct and Array
property records are supported; unknown kinds and nonempty tagged headers are
rejected. These are saved declarations, not linked offsets or current values.

```python
from pathlib import Path
from l2lib import load_package, qualified_ref
from l2lib.declarations import read_property_declaration

package, _ = load_package(Path("/local/interlude/system/Engine.u"))
export = next(e for e in package.exports
              if qualified_ref(package, e.index + 1) == "Engine.PhysicsVolume.Gravity")
print(read_property_declaration(package, export))
```

Seven authored declaration cases run without client files in standalone Core.
The [source evidence and scope](https://github.com/elberacasa/Lineage2Elbera/blob/main/docs/native-static-actor-bounds-evidence.md#volume-construction-and-property-declarations)
explain the original serializer comparison and the separate localization work.

`qualified_ref(package, reference)` returns the complete package/group/object
identity for a nonnull import or export. It rejects cycles and invalid or null
references. This helper is available in standalone Core builds; the world
exporter reuses it. It does not resolve a saved reference into a live object.

`read_polys(package, export)` decodes a bounded Polys export. File-123 packages
use the original FPoly licensee cutoff of 22 for the final DWORD; this differs
from `read_model`'s FBspSurf cutoff of 21. Earlier file versions retain legacy
layout selection and are not qualified by this change. Count/vertex guardrails
are parser limits, not complete native validity rules. The four portable cases
in `tests/test_polys.py` need no client files. See the
[source ranges, fingerprints and limits](https://github.com/elberacasa/Lineage2Elbera/blob/main/docs/native-static-actor-bounds-evidence.md#source-loaded-polys-headers)
in the full repository; this library does not perform live resource loading.

```python
from l2lib import (load_package, parse_texture, extract_texture_rgba,
                   resolve_material, mesh_material_slots, write_png)

# transparently decrypts Lineage2Ver (121 natively, others via l2encdec)
pkg, protocol = load_package("assets/interlude/textures/T_20_20.utx")
print(pkg.file_version, pkg.licensee_version, len(pkg.exports))

for e in pkg.exports_by_class("Texture"):
    w, h, rgba, info = extract_texture_rgba(pkg, e)   # mip0 as RGBA bytes
    print(pkg.export_name(e), info.format_name, w, h, len(info.mips))

# Shader/FinalBlend/TexModifier -> underlying diffuse Texture export
tex_export = resolve_material(pkg, "FFighter_m001_t15_l_sh")

# SkeletalMesh -> (version, texture slots, material TextureIndex list)
version, textures, mats = mesh_material_slots(pkg, mesh_export)

from l2lib.l2dat import load_dat
r, protocol = load_dat("assets/interlude/system/chargrp.dat")
name = r.ustr()          # UNICODE string
s    = r.ascf()          # ASCF string
n    = r.compact_int()   # FCompactIndex variant
```

In the standalone Elbera Tools Core archive, run the portable synthetic suite
from the archive root:

```sh
python3 tools/release/smoke_core.py
```

The larger integration suite below is available only in the full repository
and requires local original files and reference tools; it is not included in
the Core archive:

```
python3 tools/l2lib/tests/run_tests.py        # add -v for per-test output
```

---

# Format knowledge base

## 1. Lineage2Ver file encryption

Encrypted files start with a 28-byte UTF-16LE header `Lineage2VerNNN`
(protocol number) and end with a 20-byte l2encdec tail (crc32 + padding).
The payload cipher depends on the protocol:

| Protocol | Cipher | Found on | Decode path |
|---|---|---|---|
| 111 | fixed XOR key | `animations/*.ukx` (e.g. Fighter.ukx) | `l2encdec -p 111` |
| 120 | XOR with position-dependent key | — | `l2encdec` |
| 121 | single-byte XOR, key = checksum of original file name | `.utx` texture packages | **native** (`decode_121`) |
| 211/212 | Blowfish | — | `l2encdec` |
| 411–414 | RSA | `system/*.dat` (Interlude = 413) | `l2encdec -p 413` |

Protocol 121 is decoded in pure Python: the XOR key is a checksum of the
original file name, but (like UEViewer) we recover it from the first
payload byte instead, because the package tag `0x9E2A83C1` is known — this
works even for renamed files. `detect_protocol()` returns the protocol
number or `None`; `decrypt_file_bytes()`/`load_package()` pick the right
path automatically.

## 2. UE2 package container (`.utx`, `.ukx`, `.unr`, `.u`)

Interlude ships **version 117** (`tools/samples/t_aden.utx`, licensee 0)
and **version 123** (terrain `.utx` are 123/28; `Fighter.ukx` is 123/30).
The table layout is identical:

```
FPackageFileSummary:
  u32 tag = 0x9E2A83C1
  u16 FileVersion, u16 LicenseeVersion
  u32 PackageFlags
  u32 NameCount, NameOffset
  u32 ExportCount, ExportOffset
  u32 ImportCount, ImportOffset
  byte[16] Guid
  u32 GenerationCount, per generation: u32 ExportCount, u32 NameCount

Name entry:   FString (compact length incl. NUL; negative = UTF-16LE), u32 flags
Import entry: nameidx ClassPackage, nameidx ClassName, i32 PackageIndex, nameidx ObjectName
Export entry: cidx ClassIndex, cidx SuperIndex, i32 PackageIndex,
              nameidx ObjectName, u32 ObjectFlags, cidx SerialSize,
              cidx SerialOffset (only when SerialSize != 0)
```

Object references are FCompactIndex: `0` = None, `>0` = export (1-based),
`<0` = import (`-ci-1` indexes the import table). Export table
offsets/sizes verified byte-for-byte against `umodel -game=l2 -list`
(thousands of exports).

### FCompactIndex — THE gotcha

Variable-length integer used for all counts, offsets and references:

- **First byte**: bit7 = sign, **bit6** = has-more, bits0–5 = value.
- **Following bytes**: bit7 = has-more, bits0–6 = value (7 bits each).

The continuation flag moves from bit6 (first byte) to bit7 (rest).
Getting this wrong desyncs every table. `Reader.compact()` /
`encode_compact()` implement it; the test suite round-trips boundary
values (63/64, 8191/8192, negatives, …).

### Property tags — two variants coexist

1. **"packed" (UE1-style)** — used by `UTexture` and **all** `UMaterial`
   bodies (Shader, FinalBlend, TexModifier…) in both v117 and v123 L2
   packages:
   `nameidx Name` ("None" ends the list), `u8 info` (bit7 = array flag /
   bool value, bits4–6 = size selector, bits0–3 = EPropertyType),
   `[nameidx StructName if StructProperty]`,
   `[array index 1/2/4 bytes if array flag and not BoolProperty]`,
   then `DataSize` bytes (0 for BoolProperty — the value IS the array
   flag). Size selector: 0→1, 1→2, 2→4, 3→12, 4→16, 5→u8, 6→u16, 7→u32.

2. **"tagged" (UE2-style FPropertyTag)** — used by `USkeletalMesh` and
   other Engine-serialized bodies:
   `nameidx Name, nameidx Type, i32 Size, i32 ArrayIndex,
   [nameidx StructName], [u8 if BoolProperty], Size bytes`.

`read_properties(pkg, r, fmt=...)` takes `"packed"`, `"tagged"` or
`"auto"` (prefer by version, fall back on desync; the tagged reader
rejects implausible type names/sizes so auto mode can't return garbage).
Properties equal to the class default are NOT serialized — e.g. a
`Texture` with no `Format` property is `TEXF_P8` (the UE2 default).

### Lineage2 UMaterial extra fields (v123 packages)

L2 appends extra fields to `UMaterial::Serialize`, i.e. after the property
stream of **every** material-derived export (Texture, Shader, …), before
class-specific data (UEViewer `UnMaterial2.h`, LINEAGE2 block):

- `ArVer >= 123 && 16 <= ArLicenseeVer < 37`: one extra `i32` ("unk1").
  Interlude terrain/systexture packages are 123/28 → only this.
- `ArLicenseeVer in [30, 37)` (e.g. Fighter.ukx 123/30): additionally a
  full shader block — 6 bytes (TextureTransform, MAX_SAMPLER_NUM,
  MAX_TEXMAT_NUM, MAX_PASS_NUM, TwoPassRenderState, AlphaRef), 3 ints
  (SrcBlend, DestBlend, OverriddenFogColor), 8×(1–2 + 126) bytes of
  matrix table, 8 bytes FC color union, 3 ints (FC_FadePeriod,
  FC_FadePhase, FC_ColorFadeType), 16 FStrings (`strTex`), and the
  `ShaderCode` FString.

`read_lineage_material_block()` parses this and `parse_texture()` applies
it automatically; the parsed fields land in `TextureInfo.l2_material`.
(Without the unk1 skip, mip parsing of every 123/28 texture desyncs —
found the hard way, verified against byte-exact export sizes.)

### Texture export body

```
property stream ("packed")  -> must include Format (else default P8)
[L2 material block, v123 only]
cidx MipCount
per mip: i32 SkipPos, cidx DataCount, byte[DataCount] Data,
         i32 USize, i32 VSize, u8 UBits, u8 VBits
```

`SkipPos` is lazy-array bookkeeping (file offset after the mip; safe to
ignore for sequential reads). Mip chains halve each dimension per level;
the parsed body ends exactly at the export's `serial_offset+serial_size`
(asserted in tests).

### Pixel formats (ETextureFormat)

`P8=0, RGBA7=1, RGB16=2, DXT1=3, RGB8=4, RGBA8=5, NODATA=6, DXT3=7,
DXT5=8, L8=9, G16=10`. Decoders to RGBA8 (`l2lib.textures`):

- **DXT1/DXT3/DXT5**: standard S3TC 4×4 blocks, row-major, block pitch
  `max(1, ceil(w/4))`; RGB565 endpoints expanded with bit replication
  `(v<<3)|(v>>2)`. DXT1 `c0<=c1` = 3-color + 1-bit alpha mode.
- **RGBA8**: 4 B/px stored **B,G,R,A**. **RGB8**: 3 B/px stored B,G,R.
- **L8**: 8-bit luminance. **G16**: 16-bit grayscale terrain heightmaps
  (decoded from the high byte; umodel cannot export these).
- **P8**: 1 byte/px palette indices; the `Palette` property is an object
  ref to a `UPalette` export (`property stream, then TArray<FColor>` —
  256 B,G,R,A entries). `UPalette` is a plain UObject: NO L2 material
  block. `extract_texture_rgba()` resolves the palette automatically.

Decoder output is cross-validated against `umodel -export` TGAs (mean
absolute error ≤ 3 per RGB channel over hundreds of textures).

### Material resolution

`chargrp.dat`/mesh references point at `Shader` objects, not bitmaps.
`resolve_material()` walks the chain: `Shader.Diffuse` →
`FinalBlend.Material`/`TexModifier.Material` → … until a `Texture`
export (returns `None` when the chain ends at an import = another
package). Mesh bindings: `mesh_material_slots()` parses the
`ULodMesh` serialization (`UPrimitive` bounds, Verts, **Textures**
TArray of object refs, 36 B scale/origin, FaceLevel/Faces/
CollapseWedgeThus/Wedges, **Materials** TArray of
`{u32 PolyFlags, i32 TextureIndex}`) giving the authoritative
mesh → texture-name mapping that umodel cannot resolve.

## 3. `.dat` files (system/*.dat, L2ASM/L2FileEdit format)

After removing the 413/RSA wrapper (`l2lib.l2dat.decrypt_dat`, or
`load_dat` for a ready `DatReader`):

- little-endian; `u8/u32/i32/f32`
- **UNICODE string**: `i32` byte length (exact, no NUL inside), UTF-16LE
  payload; empty = length 0
- **ASCF string**: compact-int length **including** a trailing NUL,
  cp1252 payload (negative length = UTF-16LE, byte count `-2*n`).
  Compact int = same FCompactIndex layout, capped at 5 bytes (5th byte
  contributes 5 bits).
- Files end with the trailer `\x0cSafePackage\x00`.

Reference schema: majestic-world/L2ClientDat `06_interlude.xml`; the
chargrp/hairgrp/classinfo schemas are field-verified in
`tools/dat/extract_charcreate.py`, and the test suite cross-checks
l2lib's readers against it record-by-record on the real
`assets/interlude/system/chargrp.dat` (15 records incl. zero padding).

## Historical integration sample

The original integration report recorded the following corpus. These are not
current Core release test counts or a bundled corpus; rerun the full repository
suite with your own inputs to obtain current results.

- 24 tests, all passing: `python3 tools/l2lib/tests/run_tests.py`
- 8 packages parsed (121/111/413-encrypted, v117 + v123/28 + v123/30)
- 2190 exports listed; 1431 export offsets/sizes cross-checked against
  `umodel -list` (byte-exact)
- 299 textures decoded to RGBA, all compared against `umodel -export`
  TGAs (MAE ≤ 3; G16 heightmaps are decode-only since umodel can't
  export them)
- 15 chargrp.dat records read and matched against the reference parser
- reference PNGs written to `editor/cache/l2lib-ref/` by the texture
  tests for eyeballing
