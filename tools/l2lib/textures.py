"""Texture decoding: UE2 texture pixel formats -> RGBA8.

Decoders for the formats found in Interlude .utx packages (DXT1, DXT3,
DXT5, RGBA8, RGB8, L8), a mip-level convenience wrapper around
ue2package.parse_texture, and a minimal stdlib PNG writer (useful for
verification and for feeding decoded textures to other tools).

Storage orders (verified against umodel TGA exports):
  TEXF_RGBA8 : 4 bytes/px, stored B,G,R,A
  TEXF_RGB8  : 3 bytes/px, stored B,G,R
  TEXF_L8    : 1 byte/px luminance
  TEXF_DXT1/3/5 : standard S3TC 4x4 blocks, row-major, block pitch
                  max(1, ceil(w/4)); RGB565 endpoints expanded with
                  bit replication ((v<<3)|(v>>2)), matching hardware/nvtt.
"""

import struct
import zlib

from .ue2package import (
    L2Error, Reader, TEXF_DXT1, TEXF_DXT3, TEXF_DXT5, TEXF_G16, TEXF_L8,
    TEXF_P8, TEXF_RGB8, TEXF_RGBA8, FORMAT_NAMES, Export, mip_bytes,
    parse_palette, parse_texture,
)


def _expand565(c):
    r = (c >> 11) & 0x1F
    g = (c >> 5) & 0x3F
    b = c & 0x1F
    return ((r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2))


def decode_dxt1(data, w, h):
    """DXT1 -> RGBA bytes. c0 <= c1 selects the 3-color + 1-bit-alpha mode."""
    out = bytearray(w * h * 4)
    bw = max(1, (w + 3) // 4)
    bh = max(1, (h + 3) // 4)
    if len(data) < bw * bh * 8:
        raise L2Error("DXT1 data too short: %d bytes for %dx%d"
                      % (len(data), w, h))
    pos = 0
    for by in range(bh):
        for bx in range(bw):
            c0, c1, bits = struct.unpack_from("<HHI", data, pos)
            pos += 8
            r0, g0, b0 = _expand565(c0)
            r1, g1, b1 = _expand565(c1)
            if c0 > c1:
                palette = ((r0, g0, b0, 255), (r1, g1, b1, 255),
                           ((2 * r0 + r1) // 3, (2 * g0 + g1) // 3,
                            (2 * b0 + b1) // 3, 255),
                           ((r0 + 2 * r1) // 3, (g0 + 2 * g1) // 3,
                            (b0 + 2 * b1) // 3, 255))
            else:
                palette = ((r0, g0, b0, 255), (r1, g1, b1, 255),
                           ((r0 + r1) // 2, (g0 + g1) // 2,
                            (b0 + b1) // 2, 255),
                           (0, 0, 0, 0))
            for i in range(16):
                idx = (bits >> (2 * i)) & 3
                px, py = bx * 4 + (i & 3), by * 4 + (i >> 2)
                if px < w and py < h:
                    o = (py * w + px) * 4
                    out[o:o + 4] = bytes(palette[idx])
    return bytes(out)


def _decode_dxt_color_block(data, pos):
    """DXT1 color block forced to 4-color mode (used inside DXT3/DXT5)."""
    c0, c1, bits = struct.unpack_from("<HHI", data, pos)
    r0, g0, b0 = _expand565(c0)
    r1, g1, b1 = _expand565(c1)
    palette = ((r0, g0, b0), (r1, g1, b1),
               ((2 * r0 + r1) // 3, (2 * g0 + g1) // 3, (2 * b0 + b1) // 3),
               ((r0 + 2 * r1) // 3, (g0 + 2 * g1) // 3, (b0 + 2 * b1) // 3))
    return palette, bits


def decode_dxt5(data, w, h):
    """DXT5 -> RGBA bytes (interpolated-alpha block + DXT1 color block)."""
    out = bytearray(w * h * 4)
    bw = max(1, (w + 3) // 4)
    bh = max(1, (h + 3) // 4)
    if len(data) < bw * bh * 16:
        raise L2Error("DXT5 data too short: %d bytes for %dx%d"
                      % (len(data), w, h))
    pos = 0
    for by in range(bh):
        for bx in range(bw):
            a0, a1 = data[pos], data[pos + 1]
            abits = int.from_bytes(data[pos + 2:pos + 8], "little")
            pos += 8
            if a0 > a1:
                apal = [a0, a1] + [((7 - k) * a0 + k * a1) // 7
                                   for k in range(1, 7)]
            else:
                apal = [a0, a1] + [((5 - k) * a0 + k * a1) // 5
                                   for k in range(1, 5)] + [0, 255]
            palette, cbits = _decode_dxt_color_block(data, pos)
            pos += 8
            for i in range(16):
                px, py = bx * 4 + (i & 3), by * 4 + (i >> 2)
                if px < w and py < h:
                    r, g, b = palette[(cbits >> (2 * i)) & 3]
                    a = apal[(abits >> (3 * i)) & 7]
                    o = (py * w + px) * 4
                    out[o:o + 4] = bytes((r, g, b, a))
    return bytes(out)


def decode_dxt3(data, w, h):
    """DXT3 -> RGBA bytes (explicit 4-bit alpha + DXT1 color block)."""
    out = bytearray(w * h * 4)
    bw = max(1, (w + 3) // 4)
    bh = max(1, (h + 3) // 4)
    if len(data) < bw * bh * 16:
        raise L2Error("DXT3 data too short: %d bytes for %dx%d"
                      % (len(data), w, h))
    pos = 0
    for by in range(bh):
        for bx in range(bw):
            abits = struct.unpack_from("<Q", data, pos)[0]
            pos += 8
            palette, cbits = _decode_dxt_color_block(data, pos)
            pos += 8
            for i in range(16):
                px, py = bx * 4 + (i & 3), by * 4 + (i >> 2)
                if px < w and py < h:
                    r, g, b = palette[(cbits >> (2 * i)) & 3]
                    a = ((abits >> (4 * i)) & 0xF) * 255 // 15
                    o = (py * w + px) * 4
                    out[o:o + 4] = bytes((r, g, b, a))
    return bytes(out)


def decode_rgba8(data, w, h):
    """TEXF_RGBA8: stored B,G,R,A -> RGBA."""
    if len(data) < w * h * 4:
        raise L2Error("RGBA8 data too short: %d bytes for %dx%d"
                      % (len(data), w, h))
    out = bytearray(w * h * 4)
    out[0::4] = data[2::4][:w * h]  # R
    out[1::4] = data[1::4][:w * h]  # G
    out[2::4] = data[0::4][:w * h]  # B
    out[3::4] = data[3::4][:w * h]  # A
    return bytes(out)


def decode_rgb8(data, w, h):
    """TEXF_RGB8: 3 bytes/px stored B,G,R -> RGBA (alpha=255)."""
    if len(data) < w * h * 3:
        raise L2Error("RGB8 data too short: %d bytes for %dx%d"
                      % (len(data), w, h))
    out = bytearray(w * h * 4)
    out[0::4] = data[2::3][:w * h]
    out[1::4] = data[1::3][:w * h]
    out[2::4] = data[0::3][:w * h]
    out[3::4] = b"\xff" * (w * h)
    return bytes(out)


def decode_l8(data, w, h):
    """TEXF_L8: 8-bit luminance -> RGBA."""
    if len(data) < w * h:
        raise L2Error("L8 data too short: %d bytes for %dx%d"
                      % (len(data), w, h))
    n = w * h
    gray = data[:n]
    out = bytearray(n * 4)
    out[0::4] = gray
    out[1::4] = gray
    out[2::4] = gray
    out[3::4] = b"\xff" * n
    return bytes(out)


def decode_p8(data, w, h, palette):
    """TEXF_P8: 1 byte/px palette indices -> RGBA. `palette` is 256*4
    bytes in B,G,R,A order (FColor), e.g. from parse_palette()."""
    if len(data) < w * h:
        raise L2Error("P8 data too short: %d bytes for %dx%d"
                      % (len(data), w, h))
    if len(palette) < 1024:
        raise L2Error("P8 palette too short: %d bytes" % len(palette))
    out = bytearray(w * h * 4)
    for i in range(w * h):
        p = data[i] * 4
        o = i * 4
        out[o] = palette[p + 2]      # R
        out[o + 1] = palette[p + 1]  # G
        out[o + 2] = palette[p]      # B
        out[o + 3] = palette[p + 3]  # A
    return bytes(out)


def decode_g16(data, w, h):
    """TEXF_G16: 16-bit grayscale (terrain heightmaps) -> RGBA, using the
    high byte as intensity."""
    if len(data) < w * h * 2:
        raise L2Error("G16 data too short: %d bytes for %dx%d"
                      % (len(data), w, h))
    n = w * h
    out = bytearray(n * 4)
    hi = data[1:n * 2:2]
    out[0::4] = hi
    out[1::4] = hi
    out[2::4] = hi
    out[3::4] = b"\xff" * n
    return bytes(out)


DECODERS = {
    TEXF_DXT1: decode_dxt1,
    TEXF_DXT3: decode_dxt3,
    TEXF_DXT5: decode_dxt5,
    TEXF_RGBA8: decode_rgba8,
    TEXF_RGB8: decode_rgb8,
    TEXF_L8: decode_l8,
    TEXF_G16: decode_g16,
}


def decode_pixels(fmt, data, w, h, palette=None):
    """Decode one mip level of raw pixels to RGBA bytes.

    `palette` (256*4 BGRA bytes, see ue2package.parse_palette) is required
    for TEXF_P8."""
    if fmt == TEXF_P8:
        if palette is None:
            raise L2Error("P8 decode requires a palette")
        return decode_p8(data, w, h, palette)
    fn = DECODERS.get(fmt)
    if fn is None:
        raise L2Error("no decoder for texture format %s"
                      % FORMAT_NAMES.get(fmt, fmt))
    return fn(data, w, h)


def extract_texture_rgba(pkg, export, level=0):
    """Parse a Texture export and decode one mip level.

    Resolves the palette automatically for TEXF_P8 textures.
    Returns (width, height, rgba_bytes, TextureInfo)."""
    tex = parse_texture(pkg, export)
    if level >= len(tex.mips):
        raise L2Error("texture has %d mips, level %d requested"
                      % (len(tex.mips), level))
    palette = None
    if tex.format == TEXF_P8:
        ref = tex.props.get("Palette")
        if ref is None:
            raise L2Error("P8 texture '%s' has no Palette property"
                          % pkg.export_name(export))
        pal_obj = pkg.resolve_ref(Reader(ref).compact())
        if not isinstance(pal_obj, Export):
            raise L2Error("P8 texture '%s': palette lives outside the "
                          "package" % pkg.export_name(export))
        palette = parse_palette(pkg, pal_obj)
    mip = tex.mips[level]
    rgba = decode_pixels(tex.format, mip_bytes(pkg, mip), mip.u, mip.v,
                         palette)
    return mip.u, mip.v, rgba, tex


# --------------------------------------------------------------------------
# minimal PNG writer (stdlib; 8-bit RGBA, no filtering)
# --------------------------------------------------------------------------

def _png_chunk(ctype, body):
    return (struct.pack(">I", len(body)) + ctype + body
            + struct.pack(">I", zlib.crc32(ctype + body) & 0xFFFFFFFF))


def write_png(path, w, h, rgba):
    """Write RGBA bytes as a PNG file (color type 6, filter 0 per row)."""
    if len(rgba) != w * h * 4:
        raise L2Error("write_png: expected %d bytes, got %d"
                      % (w * h * 4, len(rgba)))
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", ihdr)
           + _png_chunk(b"IDAT", zlib.compress(bytes(raw)))
           + _png_chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    return path
