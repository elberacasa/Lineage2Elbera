# utxedit — L2 Interlude .utx texture swapper

Pure Python 3 stdlib tool that **replaces a texture inside a Lineage 2
Interlude `.utx` package** (UE2, package version 117, Lineage2Ver121
encryption) and produces a package that still loads. This closes the
"repack" gap documented in `docs/assets-tooling.md` §4.

## Usage

```bash
# List texture exports (name, pixel format, dimensions, mip count):
python3 tools/utx/utxedit.py list <package.utx>

# Replace a texture in place (writes <package.utx.bak> first):
python3 tools/utx/utxedit.py replace <package.utx> <TextureName> <image.png>
```

- `replace` exits 0 and prints a summary on success; non-zero with a clear
  `error: ...` message on failure (texture not found, dimension/format
  mismatch, unreadable PNG, ...). On failure the package is never touched
  (all checks happen before the backup/write).
- Works on encrypted (Lineage2Ver121) and already-decrypted packages.
  Encrypted inputs are re-encrypted after patching (via
  `tools/bin/l2encdec`); the output file keeps working in the game and in
  umodel. Protocol 121 is XOR-FILENAME: the key derives from the file's
  base name, so **do not rename encrypted .utx files** — `utxedit` reads
  renamed files fine (it recovers the key umodel-style) but always
  re-encrypts against the current file name, same as the game client.
- Input PNG: 8-bit, non-interlaced, color types 0/2/3/4/6 (gray, RGB,
  palette, gray+alpha, RGBA) — anything `sips` exports.

## Constraints (by design)

The replacement image must have the **same dimensions** as the stored
texture and the texture must use a **supported pixel format**. Every
mipmap level is re-generated (2×2 box filter), encoded, and must come out
**byte-size-identical** to the stored level; the mip bulk data is then
patched in place without moving a single table offset. This is the classic
texture-mod case (retexture UI/icons/terrain) and avoids full package
reserialization.

Supported formats for replace: **DXT1**, **DXT5**, **RGBA8** (stored
B,G,R,A), **RGB8** (stored B,G,R), **L8** (luma). DXT1/DXT5 are encoded in
pure Python (range-fit endpoints, 4-color opaque blocks; DXT5 8-alpha
mode). P8 (paletted), DXT3, RGBA7, RGB16, G16 are refused with a clear
message.

Performance (Apple Silicon): ~4 s for a 1024×1024 DXT1 texture (11 mips),
~17 s for 2048×2048 (12 mips).

## Verified evidence (tools/samples/t_aden.utx, 59 DXT1 texture exports)

- `list` output matches `umodel -game=l2 -list` exactly: all 59 exports,
  same names, serial offsets and sizes.
- Replaced `AS_N_02` (1024×1024) with a checkerboard PNG:
  - `umodel -game=l2 -list` still parses the re-encrypted package;
  - `umodel -export AS_N_02` from the modified package returns the
    injected image **pixel-exact** (MAE 0);
  - byte-diff of decrypted original vs. modified: all 667,634 changed
    bytes lie inside AS_N_02's export body (0x3C2–0xAAF18 ⊂ 0x38B–0xAAF23);
    nothing else in the 47 MB package moved.
- Replaced `AS07` with a gradient PNG, then exported **all 59 objects**
  with umodel from both original and modified packages: the 58 untouched
  TGAs are byte-identical; the swapped AS07 matches the injected gradient
  (MAE 1.74, max diff 7 — normal DXT1 loss).
- Replaced `AC01` (2048×2048, 12 mips) with a flat color: umodel exports
  it back as a uniform field at exactly the RGB565 quantization of the
  injected color.
- Encoder byte layouts cross-checked against UEViewer's decoder
  (`UnTexture2.cpp`/`UnTexture.cpp`): TEXF_RGBA8→BGRA, TEXF_RGB8→BGR,
  DXT1/DXT5 block layout. DXT5/DXT1/RGBA8/RGB8/L8 encoders unit-tested
  (sizes + reference-decode round-trip). Note: the sample package is
  all-DXT1, so only the DXT1 path is verified end-to-end against a real
  package; the other formats follow UEViewer's documented layouts.

## Byte layout (reverse-engineered, UE2 package version 117)

Sources: UEViewer (`tools/src/UEViewer/Unreal/UnrealPackage/`,
`UnrealMaterial/`), open-l2encdec, and hex inspection of `t_aden.utx`.

- **Summary**: `u32 tag=0x9E2A83C1`, `u16 FileVersion=117`,
  `u16 LicenseeVersion`, `u32 PackageFlags`, `u32 NameCount/NameOffset`,
  `u32 ExportCount/ExportOffset`, `u32 ImportCount/ImportOffset`,
  `byte[16] Guid`, `u32 GenerationCount`, per generation
  `{u32 ExportCount, u32 NameCount}`.
- **FCompactIndex** (all table indices, string lengths, serial sizes):
  first byte: bit7=sign, bit6=has-more, bits0-5=value; continuation
  bytes: bit7=has-more, bits0-6=value. (Note: this is UEViewer's layout —
  sign/continuation are **not** the UE1 bits.)
- **Name entry**: FString (compact-index length incl. NUL, then bytes;
  negative length = UTF-16), `u32 flags`.
- **Import entry**: `cidx ClassPackage`, `cidx ClassName`,
  `i32 PackageIndex`, `cidx ObjectName`.
- **Export entry**: `cidx ClassIndex`, `cidx SuperIndex`,
  `i32 PackageIndex`, `cidx ObjectName`, `u32 ObjectFlags`,
  `cidx SerialSize`, `cidx SerialOffset` (only if SerialSize≠0).
  ClassIndex<0 → import `-ClassIndex-1`; >0 → export `ClassIndex-1`.
- **Texture export body**: tagged property list, then native mip array.
  - Property tag: `cidx Name` ("None" ends), `u8 info`
    (bit7=array-flag/bool-value, bits4-6=size selector, bits0-3=type),
    `cidx StructName` if type=StructProperty(10), array index
    (1/2/4 bytes) if array-flag and type≠BoolProperty(3), then
    DataSize bytes of value (none for Bool). Size selector:
    0→1, 1→2, 2→4, 3→12, 4→16, 5→u8, 6→u16, 7→u32.
    The pixel format is the 1-byte value of the `Format` ByteProperty
    (ETextureFormat: P8=0, RGBA7=1, RGB16=2, DXT1=3, RGB8=4, RGBA8=5,
    DXT3=7, DXT5=8, L8=9, G16=10).
  - Mip array: `cidx MipCount`; per mip: `i32 SkipPos` (lazy-array
    bookkeeping), `cidx DataCount`, `byte[DataCount] Data`, `i32 USize`,
    `i32 VSize`, `u8 UBits`, `u8 VBits`. Only the `Data` blobs are patched.
- **Lineage2Ver121 container**: 28-byte UTF-16LE `Lineage2Ver121` header,
  then payload XORed with a single key byte (key = checksum of the
  original file name; recoverable from payload[0] ^ 0xC1), then a 20-byte
  trailer (crc32 + padding, not XORed). Re-encryption goes through
  `tools/bin/l2encdec -c encode -p 121 -f <basename>` so header and tail
  are regenerated correctly.

## Follow-ups

- DXT3, P8 (needs palette export lookup), RGBA7/RGB16/G16 encoders.
- Higher-quality DXT endpoints (cluster fit) if banding bothers anyone.
- Dimension-changing replace would require full export-table/name-table
  reserialization (out of scope by design).
