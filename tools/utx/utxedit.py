#!/usr/bin/env python3
"""utxedit - list and replace textures inside Lineage 2 Interlude .utx packages.

Pure Python 3 stdlib. Understands UE2 packages (package version 117, the
Interlude format) and the Lineage2Ver121/413 file encryption (via the external
tools/bin/l2encdec binary).

Usage:
    python3 utxedit.py list <package.utx>
    python3 utxedit.py replace <package.utx> <TextureName> <image.png>

replace is deliberately conservative: the new image must have the SAME pixel
format and SAME dimensions as the stored texture, and every mipmap level must
encode to exactly the same byte size as the stored level. The mipmap bulk data
is then patched in place without moving a single table offset.

Layout references (reverse-engineered from UEViewer sources and verified
against tools/samples/t_aden.utx):

  FPackageFileSummary (v117):
    u32 tag=0x9E2A83C1, u16 FileVersion=117, u16 LicenseeVersion,
    u32 PackageFlags, u32 NameCount, u32 NameOffset,
    u32 ExportCount, u32 ExportOffset, u32 ImportCount, u32 ImportOffset,
    byte[16] Guid, u32 GenerationCount, per generation: u32 ExportCount,
    u32 NameCount.

  Name table entry: FString (compact-index length including NUL, then bytes),
    u32 flags.

  Import entry: nameidx ClassPackage, nameidx ClassName, i32 PackageIndex,
    nameidx ObjectName.

  Export entry: cidx ClassIndex, cidx SuperIndex, i32 PackageIndex,
    nameidx ObjectName, u32 ObjectFlags, cidx SerialSize,
    cidx SerialOffset (only when SerialSize != 0).

  Texture export body: tagged property list terminated by the "None" name,
    then the native mipmap array:
      cidx MipCount
      per mip: i32 SkipPos, cidx DataCount, byte[DataCount] Data,
               i32 USize, i32 VSize, u8 UBits, u8 VBits

  Property tag: nameidx Name ("None" ends the list), u8 info
    (bit7 = array flag / bool value, bits4-6 = size selector, bits0-3 = type),
    [nameidx StructName if type == StructProperty],
    [array index (1/2/4 bytes) if array flag and type != BoolProperty],
    then DataSize bytes of value (0 bytes for BoolProperty).
    Size selector: 0->1, 1->2, 2->4, 3->12, 4->16, 5->u8, 6->u16, 7->u32.
"""

import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

TOOL_DIR = os.path.dirname(os.path.abspath(__file__))
L2ENCDEC = os.path.normpath(os.path.join(TOOL_DIR, "..", "bin", "l2encdec"))

PACKAGE_TAG = 0x9E2A83C1
SUPPORTED_VERSION = 117

# ETextureFormat (UE2, from UEViewer UnMaterial2.h)
TEXF_P8 = 0
TEXF_RGBA7 = 1
TEXF_RGB16 = 2
TEXF_DXT1 = 3
TEXF_RGB8 = 4
TEXF_RGBA8 = 5
TEXF_NODATA = 6
TEXF_DXT3 = 7
TEXF_DXT5 = 8
TEXF_L8 = 9
TEXF_G16 = 10

FORMAT_NAMES = {
    TEXF_P8: "P8", TEXF_RGBA7: "RGBA7", TEXF_RGB16: "RGB16",
    TEXF_DXT1: "DXT1", TEXF_RGB8: "RGB8", TEXF_RGBA8: "RGBA8",
    TEXF_NODATA: "NODATA", TEXF_DXT3: "DXT3", TEXF_DXT5: "DXT5",
    TEXF_L8: "L8", TEXF_G16: "G16",
}

# EPropertyType (UE1/UE2)
PROP_BYTE = 1
PROP_INT = 2
PROP_BOOL = 3
PROP_STRUCT = 10


class UtxError(Exception):
    pass


# --------------------------------------------------------------------------
# low-level readers
# --------------------------------------------------------------------------

class Reader(object):
    def __init__(self, data, pos=0):
        self.data = data
        self.pos = pos

    def u8(self):
        v = self.data[self.pos]
        self.pos += 1
        return v

    def u16(self):
        v = struct.unpack_from("<H", self.data, self.pos)[0]
        self.pos += 2
        return v

    def u32(self):
        v = struct.unpack_from("<I", self.data, self.pos)[0]
        self.pos += 4
        return v

    def i32(self):
        v = struct.unpack_from("<i", self.data, self.pos)[0]
        self.pos += 4
        return v

    def bytes(self, n):
        v = self.data[self.pos:self.pos + n]
        self.pos += n
        return v

    def compact(self):
        """UE1/UE2 FCompactIndex (AR_INDEX).

        First byte: bit7 = sign, bit6 = has-more, bits0-5 = value.
        Following bytes: bit7 = has-more, bits0-6 = value."""
        b0 = self.u8()
        negative = bool(b0 & 0x80)
        value = b0 & 0x3F
        if b0 & 0x40:
            shift = 6
            while True:
                b = self.u8()
                value |= (b & 0x7F) << shift
                shift += 7
                if not (b & 0x80):
                    break
        return -value if negative else value


def encode_compact(value):
    """Inverse of Reader.compact (used only for sanity checks)."""
    negative = value < 0
    v = abs(value)
    b0 = v & 0x3F
    if negative:
        b0 |= 0x80
    if v <= 0x3F:
        return bytes([b0])
    out = bytearray([b0 | 0x40])
    v >>= 6
    while True:
        b = v & 0x7F
        v >>= 7
        if v:
            b |= 0x80
        out.append(b)
        if not v:
            return bytes(out)


# --------------------------------------------------------------------------
# package parsing
# --------------------------------------------------------------------------

class Export(object):
    __slots__ = ("index", "class_index", "super_index", "package_index",
                 "name_index", "object_flags", "serial_size", "serial_offset")


class Import(object):
    __slots__ = ("class_package", "class_name", "package_index", "object_name")


class Package(object):
    def __init__(self, data):
        self.data = data
        r = Reader(data)
        tag = r.u32()
        if tag != PACKAGE_TAG:
            raise UtxError("not an Unreal package (bad tag 0x%08X)" % tag)
        self.file_version = r.u16()
        self.licensee_version = r.u16()
        if self.file_version != SUPPORTED_VERSION:
            raise UtxError(
                "unsupported package version %d (only %d / Interlude)"
                % (self.file_version, SUPPORTED_VERSION))
        self.package_flags = r.u32()
        name_count = r.u32()
        name_offset = r.u32()
        export_count = r.u32()
        export_offset = r.u32()
        import_count = r.u32()
        import_offset = r.u32()
        # Guid + generations are not needed; tables carry their own offsets.

        # --- name table ---
        r.pos = name_offset
        self.names = []
        for _ in range(name_count):
            length = r.compact()
            if length == 0:
                self.names.append("")
                continue
            if length < 0:  # UTF-16 (rare; Korean clients)
                raw = r.bytes(-length * 2)
                self.names.append(raw[:-2].decode("utf-16-le", "replace"))
            else:
                raw = r.bytes(length)
                self.names.append(raw[:-1].decode("latin-1"))
            r.u32()  # name flags

        # --- import table ---
        r.pos = import_offset
        self.imports = []
        for _ in range(import_count):
            imp = Import()
            imp.class_package = r.compact()
            imp.class_name = r.compact()
            imp.package_index = r.i32()
            imp.object_name = r.compact()
            self.imports.append(imp)

        # --- export table ---
        r.pos = export_offset
        self.exports = []
        for i in range(export_count):
            e = Export()
            e.index = i
            e.class_index = r.compact()
            e.super_index = r.compact()
            e.package_index = r.i32()
            e.name_index = r.compact()
            e.object_flags = r.u32()
            e.serial_size = r.compact()
            e.serial_offset = r.compact() if e.serial_size else 0
            self.exports.append(e)

    def name(self, index):
        if 0 <= index < len(self.names):
            return self.names[index]
        raise UtxError("bad name index %d" % index)

    def class_name_of(self, export):
        ci = export.class_index
        if ci < 0:
            return self.name(self.imports[-ci - 1].object_name)
        if ci > 0:
            return self.name(self.exports[ci - 1].name_index)
        return "Class"

    def export_name(self, export):
        return self.name(export.name_index)


class Mip(object):
    __slots__ = ("u", "v", "data_offset", "data_size")


class TextureInfo(object):
    __slots__ = ("export", "format", "props", "mips", "body_end")


def parse_texture(pkg, export):
    """Parse a Texture export body: tagged properties + mipmap array."""
    r = Reader(pkg.data, export.serial_offset)
    end = export.serial_offset + export.serial_size
    props = {}
    # --- tagged properties ---
    while True:
        name = pkg.name(r.compact())
        if name == "None":
            break
        info = r.u8()
        ptype = info & 0x0F
        is_array = bool(info & 0x80)
        size_sel = (info >> 4) & 7
        if ptype == PROP_STRUCT:
            r.compact()  # StructName
        if size_sel == 0:
            data_size = 1
        elif size_sel == 1:
            data_size = 2
        elif size_sel == 2:
            data_size = 4
        elif size_sel == 3:
            data_size = 12
        elif size_sel == 4:
            data_size = 16
        elif size_sel == 5:
            data_size = r.u8()
        elif size_sel == 6:
            data_size = r.u16()
        else:
            data_size = r.u32()
        if ptype != PROP_BOOL and is_array:
            b = r.u8()
            if b < 128:
                pass
            elif b & 0x40:
                r.u8(); r.u8(); r.u8()
            else:
                r.u8()
        if ptype == PROP_BOOL:
            props[name] = is_array  # bool value lives in the array flag
        else:
            props[name] = r.bytes(data_size)
    # --- native mipmap array ---
    tex = TextureInfo()
    tex.export = export
    tex.props = props
    fmt = props.get("Format")
    if fmt is None or len(fmt) != 1:
        raise UtxError("texture has no usable 'Format' property")
    tex.format = fmt[0]
    mip_count = r.compact()
    tex.mips = []
    for _ in range(mip_count):
        r.u32()  # SkipPos (lazy-array bookkeeping, ignored)
        data_size = r.compact()
        m = Mip()
        m.data_size = data_size
        m.data_offset = r.pos
        r.pos += data_size
        m.u = r.i32()
        m.v = r.i32()
        r.u8()  # UBits
        r.u8()  # VBits
        tex.mips.append(m)
    tex.body_end = r.pos
    if r.pos != end:
        # Not fatal for listing, but replacing requires exact understanding.
        tex.body_end = r.pos
    return tex


# --------------------------------------------------------------------------
# PNG decoding (stdlib): 8-bit, non-interlaced, color types 0/2/3/4/6
# --------------------------------------------------------------------------

def decode_png(path):
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError as exc:
        raise UtxError("cannot read %s: %s" % (path, exc.strerror or exc))
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise UtxError("%s: not a PNG file" % path)
    pos = 8
    idat = bytearray()
    width = height = None
    bit_depth = color_type = interlace = None
    palette = None
    trns = None
    while pos < len(data):
        length = struct.unpack_from(">I", data, pos)[0]
        ctype = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            (width, height, bit_depth, color_type,
             _comp, _filt, interlace) = struct.unpack(">IIBBBBB", body)
        elif ctype == b"PLTE":
            palette = body
        elif ctype == b"tRNS":
            trns = body
        elif ctype == b"IDAT":
            idat += body
        elif ctype == b"IEND":
            break
    if width is None:
        raise UtxError("%s: missing IHDR" % path)
    if bit_depth != 8:
        raise UtxError("%s: only 8-bit PNGs are supported (bit depth %d)"
                       % (path, bit_depth))
    if interlace != 0:
        raise UtxError("%s: interlaced PNGs are not supported" % path)
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color_type)
    if channels is None:
        raise UtxError("%s: unsupported PNG color type %d" % (path, color_type))
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    recon = bytearray(height * stride)
    prev = bytearray(stride)
    src = 0
    for y in range(height):
        ftype = raw[src]
        src += 1
        line = bytearray(raw[src:src + stride])
        src += stride
        if ftype == 0:
            pass
        elif ftype == 1:  # Sub
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ftype == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:  # Average
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:  # Paeth
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        else:
            raise UtxError("%s: bad PNG filter type %d" % (path, ftype))
        recon[y * stride:(y + 1) * stride] = line
        prev = line
    # expand to RGBA
    rgba = bytearray(width * height * 4)
    if color_type == 6:
        rgba[:] = recon
    elif color_type == 2:
        for i in range(width * height):
            rgba[i * 4:i * 4 + 3] = recon[i * 3:i * 3 + 3]
            rgba[i * 4 + 3] = 255
    elif color_type == 0:
        for i in range(width * height):
            g = recon[i]
            rgba[i * 4:i * 4 + 4] = bytes((g, g, g, 255))
    elif color_type == 4:
        for i in range(width * height):
            g, a = recon[i * 2], recon[i * 2 + 1]
            rgba[i * 4:i * 4 + 4] = bytes((g, g, g, a))
    else:  # palette
        if palette is None:
            raise UtxError("%s: palette PNG without PLTE chunk" % path)
        for i in range(width * height):
            idx = recon[i]
            rgba[i * 4:i * 4 + 3] = palette[idx * 3:idx * 3 + 3]
            rgba[i * 4 + 3] = trns[idx] if trns and idx < len(trns) else 255
    return width, height, bytes(rgba)


# --------------------------------------------------------------------------
# mipmap generation (2x2 box filter, edge-clamped)
# --------------------------------------------------------------------------

def downsample_half(rgba, w, h):
    tw = max(1, w >> 1)
    th = max(1, h >> 1)
    out = bytearray(tw * th * 4)
    for y in range(th):
        y0 = 2 * y
        y1 = min(y0 + 1, h - 1)
        for x in range(tw):
            x0 = 2 * x
            x1 = min(x0 + 1, w - 1)
            i00 = (y0 * w + x0) * 4
            i01 = (y0 * w + x1) * 4
            i10 = (y1 * w + x0) * 4
            i11 = (y1 * w + x1) * 4
            o = (y * tw + x) * 4
            for c in range(4):
                out[o + c] = (rgba[i00 + c] + rgba[i01 + c] +
                              rgba[i10 + c] + rgba[i11 + c] + 2) >> 2
    return tw, th, bytes(out)


# --------------------------------------------------------------------------
# pixel format encoders
# --------------------------------------------------------------------------

def encode_rgba8(rgba, w, h):
    """TEXF_RGBA8 is stored as B,G,R,A (TPF_BGRA8 in UEViewer)."""
    out = bytearray(w * h * 4)
    out[0::4] = rgba[2::4]  # B
    out[1::4] = rgba[1::4]  # G
    out[2::4] = rgba[0::4]  # R
    out[3::4] = rgba[3::4]  # A
    return bytes(out)


def encode_rgb8(rgba, w, h):
    """TEXF_RGB8: 3 bytes per pixel, stored B,G,R (D3DFMT_R8G8B8 order)."""
    out = bytearray(w * h * 3)
    out[0::3] = rgba[2::4]
    out[1::3] = rgba[1::4]
    out[2::3] = rgba[0::4]
    return bytes(out)


def encode_l8(rgba, w, h):
    """TEXF_L8: 8-bit grayscale (luma)."""
    out = bytearray(w * h)
    for i in range(w * h):
        r, g, b = rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]
        out[i] = (r * 299 + g * 587 + b * 114) // 1000
    return bytes(out)


def _rgb565(r, g, b):
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)


def _unpack565(c):
    r = ((c >> 11) & 0x1F) * 255 // 31
    g = ((c >> 5) & 0x3F) * 255 // 63
    b = (c & 0x1F) * 255 // 31
    return r, g, b


def _dxt1_color_block(pixels):
    """pixels: list of 16 (r,g,b) tuples. Returns 8 bytes of DXT1 color data,
    always in opaque 4-color mode (c0 > c1)."""
    # endpoints: min/max by luminance
    min_c = max_c = pixels[0]
    min_l = max_l = pixels[0][0] * 299 + pixels[0][1] * 587 + pixels[0][2] * 114
    for p in pixels[1:]:
        l = p[0] * 299 + p[1] * 587 + p[2] * 114
        if l < min_l:
            min_l, min_c = l, p
        elif l > max_l:
            max_l, max_c = l, p
    c0 = _rgb565(*max_c)
    c1 = _rgb565(*min_c)
    if c0 < c1:
        c0, c1 = c1, c0
    elif c0 == c1 and c0 > 0:
        c1 = c0 - 1
    r0, g0, b0 = _unpack565(c0)
    r1, g1, b1 = _unpack565(c1)
    r2, g2, b2 = (2 * r0 + r1) // 3, (2 * g0 + g1) // 3, (2 * b0 + b1) // 3
    r3, g3, b3 = (r0 + 2 * r1) // 3, (g0 + 2 * g1) // 3, (b0 + 2 * b1) // 3
    palette = ((r0, g0, b0), (r1, g1, b1), (r2, g2, b2), (r3, g3, b3))
    indices = 0
    for i, p in enumerate(pixels):
        best, best_d = 0, None
        for j, q in enumerate(palette):
            d = ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 +
                 (p[2] - q[2]) ** 2)
            if best_d is None or d < best_d:
                best, best_d = j, d
        indices |= best << (2 * i)
    return struct.pack("<HHI", c0, c1, indices)


def encode_dxt1(rgba, w, h):
    out = bytearray()
    for by in range(0, h, 4):
        for bx in range(0, w, 4):
            pixels = []
            for y in range(4):
                sy = min(by + y, h - 1)
                for x in range(4):
                    sx = min(bx + x, w - 1)
                    i = (sy * w + sx) * 4
                    pixels.append((rgba[i], rgba[i + 1], rgba[i + 2]))
            out += _dxt1_color_block(pixels)
    return bytes(out)


def encode_dxt5(rgba, w, h):
    out = bytearray()
    for by in range(0, h, 4):
        for bx in range(0, w, 4):
            pixels = []
            alphas = []
            for y in range(4):
                sy = min(by + y, h - 1)
                for x in range(4):
                    sx = min(bx + x, w - 1)
                    i = (sy * w + sx) * 4
                    pixels.append((rgba[i], rgba[i + 1], rgba[i + 2]))
                    alphas.append(rgba[i + 3])
            # alpha block: 8-alpha mode (a0 > a1)
            a0, a1 = max(alphas), min(alphas)
            if a0 == a1 and a0 > 0:
                a1 = a0 - 1
            apal = [a0, a1]
            for k in range(1, 7):
                apal.append(((7 - k) * a0 + k * a1) // 7)
            aidx = 0
            for i, a in enumerate(alphas):
                best, best_d = 0, None
                for j, q in enumerate(apal):
                    d = abs(a - q)
                    if best_d is None or d < best_d:
                        best, best_d = j, d
                aidx |= best << (3 * i)
            out += bytes((a0, a1)) + aidx.to_bytes(6, "little")
            out += _dxt1_color_block(pixels)
    return bytes(out)


ENCODERS = {
    TEXF_RGBA8: encode_rgba8,
    TEXF_RGB8: encode_rgb8,
    TEXF_L8: encode_l8,
    TEXF_DXT1: encode_dxt1,
    TEXF_DXT5: encode_dxt5,
}


# --------------------------------------------------------------------------
# encryption handling (via tools/bin/l2encdec)
# --------------------------------------------------------------------------

L2_MAGIC_PREFIX = b"L\x00i\x00n\x00e\x00a\x00g\x00e\x002\x00V\x00e\x00r\x00"
L2_HEADER_SIZE = 28  # "Lineage2VerNNN" as UTF-16LE
L2_TAIL_SIZE = 20    # l2encdec trailer (crc32 + padding), added after cipher


def detect_protocol(data):
    """Return the Lineage2Ver protocol number, or None if not encrypted."""
    if not data.startswith(L2_MAGIC_PREFIX):
        return None
    # header is UTF-16LE "Lineage2VerNNN"
    text = data[:32].decode("utf-16-le", "ignore")
    digits = ""
    for ch in text[len("Lineage2Ver"):]:
        if ch.isdigit():
            digits += ch
        else:
            break
    return int(digits) if digits else None


def decode_121(data):
    """Decode a Lineage2Ver121 file without external tools.

    Protocol 121 is a single-byte XOR over the payload; the key is a checksum
    of the *original* file name. Like UEViewer, we recover the key from the
    first payload byte instead (the package tag 0x9E2A83C1 is known), so this
    works even when the file was renamed."""
    if len(data) < L2_HEADER_SIZE + L2_TAIL_SIZE + 4:
        raise UtxError("file too small for a Lineage2Ver121 package")
    payload = data[L2_HEADER_SIZE:len(data) - L2_TAIL_SIZE]
    key = payload[0] ^ (PACKAGE_TAG & 0xFF)
    plain = bytes(b ^ key for b in payload)
    return plain


def run_l2encdec(command, protocol, src_bytes, key_filename):
    """Run l2encdec on src_bytes.

    key_filename is required for protocol 121 (XOR_FILENAME): the XOR key is
    the checksum of the file's base name, so we force the original name with
    -f regardless of the temp file's actual name."""
    if not os.path.exists(L2ENCDEC):
        raise UtxError("l2encdec not found at %s" % L2ENCDEC)
    tmpdir = tempfile.mkdtemp(prefix="utxedit_")
    try:
        src = os.path.join(tmpdir, "in.bin")
        dst = os.path.join(tmpdir, "out.bin")
        with open(src, "wb") as f:
            f.write(src_bytes)
        proc = subprocess.run(
            [L2ENCDEC, "-c", command, "-p", str(protocol),
             "-f", key_filename, "-o", dst, src],
            capture_output=True, text=True)
        if proc.returncode != 0 or not os.path.exists(dst):
            raise UtxError("l2encdec %s failed: %s%s"
                           % (command, proc.stdout, proc.stderr))
        with open(dst, "rb") as f:
            return f.read()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# --------------------------------------------------------------------------
# commands
# --------------------------------------------------------------------------

def load_package(path):
    """Returns (plain_bytes, protocol_or_None)."""
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError as exc:
        raise UtxError("cannot read %s: %s" % (path, exc.strerror or exc))
    protocol = detect_protocol(data)
    if protocol == 121:
        plain = decode_121(data)
    elif protocol is not None:
        plain = run_l2encdec("decode", protocol, data, os.path.basename(path))
    else:
        plain = data
    return plain, protocol


def iter_textures(pkg):
    for e in pkg.exports:
        if pkg.class_name_of(e) == "Texture" and e.serial_size > 0:
            yield e


def cmd_list(path):
    plain, protocol = load_package(path)
    pkg = Package(plain)
    enc = "Lineage2Ver%d" % protocol if protocol else "none"
    print("package: %s" % path)
    print("  version: %d/%d  names: %d  exports: %d  imports: %d  encryption: %s"
          % (pkg.file_version, pkg.licensee_version, len(pkg.names),
             len(pkg.exports), len(pkg.imports), enc))
    print("%-4s %-28s %-6s %-11s %-5s %s"
          % ("idx", "name", "format", "dims", "mips", "serial"))
    count = 0
    for e in pkg.exports:
        cls = pkg.class_name_of(e)
        if cls != "Texture" or e.serial_size == 0:
            continue
        name = pkg.export_name(e)
        try:
            tex = parse_texture(pkg, e)
            fmt = FORMAT_NAMES.get(tex.format, "fmt%d" % tex.format)
            m0 = tex.mips[0]
            print("%-4d %-28s %-6s %-11s %-5d off=0x%X size=0x%X"
                  % (e.index, name, fmt, "%dx%d" % (m0.u, m0.v),
                     len(tex.mips), e.serial_offset, e.serial_size))
        except UtxError as exc:
            print("%-4d %-28s <unparsed: %s>" % (e.index, name, exc))
        count += 1
    print("%d texture exports" % count)
    return 0


def cmd_replace(path, tex_name, png_path):
    plain, protocol = load_package(path)
    pkg = Package(plain)

    target = None
    for e in iter_textures(pkg):
        if pkg.export_name(e).lower() == tex_name.lower():
            target = e
            break
    if target is None:
        names = sorted(pkg.export_name(e) for e in iter_textures(pkg))
        raise UtxError(
            "texture '%s' not found in %s. Available: %s"
            % (tex_name, os.path.basename(path), ", ".join(names)))

    tex = parse_texture(pkg, target)
    real_name = pkg.export_name(target)
    fmt_name = FORMAT_NAMES.get(tex.format, "fmt%d" % tex.format)

    if tex.format not in ENCODERS:
        raise UtxError(
            "texture '%s' uses format %s, which replace does not support "
            "(supported: %s)"
            % (real_name, fmt_name,
               ", ".join(FORMAT_NAMES[f] for f in sorted(ENCODERS))))

    w, h, rgba = decode_png(png_path)
    m0 = tex.mips[0]
    if (w, h) != (m0.u, m0.v):
        raise UtxError(
            "dimension mismatch: image is %dx%d but texture '%s' is %dx%d "
            "(replace requires identical dimensions)"
            % (w, h, real_name, m0.u, m0.v))

    encoder = ENCODERS[tex.format]

    # build the full mip chain and verify each level against the stored one
    levels = [(w, h, rgba)]
    for _ in range(len(tex.mips) - 1):
        lw, lh, lrgba = levels[-1]
        levels.append(downsample_half(lrgba, lw, lh))

    patches = []  # (offset, bytes)
    for i, mip in enumerate(tex.mips):
        lw, lh, lrgba = levels[i]
        if (lw, lh) != (mip.u, mip.v):
            raise UtxError(
                "mip %d size mismatch: generated %dx%d, stored %dx%d "
                "(unusual mip chain; refusing to patch)"
                % (i, lw, lh, mip.u, mip.v))
        encoded = encoder(lrgba, lw, lh)
        if len(encoded) != mip.data_size:
            raise UtxError(
                "mip %d encodes to %d bytes but stored level has %d "
                "(refusing to patch)" % (i, len(encoded), mip.data_size))
        patches.append((mip.data_offset, encoded))

    # patch the plain package
    patched = bytearray(plain)
    for offset, blob in patches:
        patched[offset:offset + len(blob)] = blob
    patched = bytes(patched)

    # backup + write
    backup = path + ".bak"
    shutil.copy2(path, backup)

    if protocol is not None:
        out = run_l2encdec("encode", protocol, patched, os.path.basename(path))
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(out)
        os.replace(tmp, path)
    else:
        with open(path, "wb") as f:
            f.write(patched)

    total = sum(len(b) for _, b in patches)
    print("replaced '%s' in %s" % (real_name, path))
    print("  format: %s  dims: %dx%d  mips patched: %d  bytes written: %d"
          % (fmt_name, w, h, len(patches), total))
    print("  backup: %s" % backup)
    if protocol is not None:
        print("  re-encrypted: Lineage2Ver%d" % protocol)
    return 0


USAGE = __doc__


def main(argv):
    if len(argv) < 3:
        sys.stderr.write(USAGE)
        return 2
    cmd = argv[1]
    try:
        if cmd == "list" and len(argv) == 3:
            return cmd_list(argv[2])
        if cmd == "replace" and len(argv) == 5:
            return cmd_replace(argv[2], argv[3], argv[4])
        sys.stderr.write(USAGE)
        return 2
    except UtxError as exc:
        sys.stderr.write("error: %s\n" % exc)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
