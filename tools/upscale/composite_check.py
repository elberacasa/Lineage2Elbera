#!/usr/bin/env python3
"""Composite an RGBA png over dark and light backgrounds (halo check)."""
import struct
import sys
import zlib


def read_png(path):
    data = open(path, 'rb').read()
    assert data.startswith(b'\x89PNG')
    pos = 8
    idat = b''
    w = h = ct = None
    while pos < len(data):
        ln, typ = struct.unpack('>I4s', data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, bd, ct, _c, _f, inter = struct.unpack('>IIBBBBB', chunk[:13])
            assert bd == 8 and ct in (2, 6) and not inter, (bd, ct, inter)
        elif typ == b'IDAT':
            idat += chunk
        pos += 12 + ln
    ch = 4 if ct == 6 else 3
    raw = zlib.decompress(idat)
    stride = w * ch
    prev = bytearray(stride)
    out = bytearray()

    def paeth(a, b, c):
        p = a + b - c
        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
        return a if pa <= pb and pa <= pc else (b if pb <= pc else c)

    i = 0
    for _y in range(h):
        f = raw[i]
        i += 1
        row = bytearray(raw[i:i + stride])
        i += stride
        for x in range(stride):
            a = row[x - ch] if x >= ch else 0
            b = prev[x]
            c = prev[x - ch] if x >= ch else 0
            if f == 1:
                row[x] = (row[x] + a) & 255
            elif f == 2:
                row[x] = (row[x] + b) & 255
            elif f == 3:
                row[x] = (row[x] + (a + b) // 2) & 255
            elif f == 4:
                row[x] = (row[x] + paeth(a, b, c)) & 255
        out += row
        prev = row
    return w, h, ch, out


def write_png(path, w, h, rgba):
    def chunk(typ, payload):
        c = struct.pack('>I', len(payload)) + typ + payload
        return c + struct.pack('>I', zlib.crc32(typ + payload) & 0xFFFFFFFF)
    raw = b''.join(b'\x00' + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) +
                           chunk(b'IDAT', zlib.compress(raw, 6)) +
                           chunk(b'IEND', b''))


def main():
    src, dark_out, light_out = sys.argv[1], sys.argv[2], sys.argv[3]
    w, h, ch, px = read_png(src)
    for outp, bg in ((dark_out, (24, 24, 32)), (light_out, (235, 235, 230))):
        comp = bytearray(w * h * 4)
        for i in range(w * h):
            if ch == 4:
                r, g, b, a = px[i * 4:i * 4 + 4]
            else:
                r, g, b = px[i * 3:i * 3 + 3]
                a = 255
            for k, c in enumerate((r, g, b)):
                comp[i * 4 + k] = (c * a + bg[k] * (255 - a)) // 255
            comp[i * 4 + 3] = 255
        write_png(outp, w, h, bytes(comp))
    print('wrote', dark_out, light_out)


main()
