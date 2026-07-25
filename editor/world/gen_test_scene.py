#!/usr/bin/env python3
"""Generate the procedural test scene package assets/world/_test/.

Exact frozen contract format:
  scene.json     {"tile","origin","gridSize":256,"spacing":128,
                  "heightScale":0.296875,"heightmap","heights",
                  "layers":[{"name","diffuse","splat"}],"water":null,"props":[]}
  heightmap.u16  256*256 Uint16 little-endian, row-major (gx fastest)
  heightmap.png  8-bit grayscale preview of the same data
  grass/dirt.png tileable procedural layer diffuse textures
  splat.png      RGB weights: R -> layer0 (grass), G -> layer1 (dirt)

Pure python3.9 stdlib. Delete assets/world/_test/ once real tiles arrive.
"""

import json
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "assets", "world", "_test"))

G = 256          # gridSize
SPACING = 128
HEIGHT_SCALE = 0.296875
ORIGIN = [-16384, -16384, 0]   # non-zero on purpose, to exercise the transform


def write_png(path, width, height, channels, rows):
    """rows: list of bytes objects, one per scanline (no filter byte)."""
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    color_type = {1: 0, 3: 2, 4: 6}[channels]
    raw = b"".join(b"\x00" + r for r in rows)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 6))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def height_at(gx, gy):
    """Synthetic relief: big gaussian hill + rolling tileable waves.
    Heights are stored with the G16 bias: raw = 32768 + z/heightScale
    (docs/map-format.md §6)."""
    dx, dy = gx - 128.0, gy - 118.0
    hill = 15000.0 * math.exp(-(dx * dx + dy * dy) / (2 * 42.0 ** 2))
    waves = (900.0 * math.sin(gx * 2 * math.pi / 85.0) * math.cos(gy * 2 * math.pi / 64.0)
             + 500.0 * math.sin((gx + gy) * 2 * math.pi / 128.0))
    h = 32768 + 2200.0 + hill + waves
    return max(0, min(65535, int(round(h))))


def periodic_noise(u, v, seed):
    """Tileable value-ish noise from integer-frequency sines. u,v in [0,1)."""
    t = 2 * math.pi
    n = (math.sin(3 * t * u + seed) * math.cos(4 * t * v + seed * 1.7)
         + 0.6 * math.sin(9 * t * u + seed * 2.3) * math.sin(7 * t * v)
         + 0.35 * math.sin(17 * t * u + 1.1) * math.cos(13 * t * v + seed))
    return n / 1.95  # ~[-1, 1]


def make_layer_tex(path, base, vary, seed):
    size = 256
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            n = periodic_noise(x / size, y / size, seed)
            n2 = periodic_noise(x / size, y / size, seed + 4.2)
            f = 1.0 + vary * n
            f2 = 1.0 + vary * 0.5 * n2
            row += bytes((
                max(0, min(255, int(base[0] * f))),
                max(0, min(255, int(base[1] * f2))),
                max(0, min(255, int(base[2] * f))),
            ))
        rows.append(bytes(row))
    write_png(path, size, size, 3, rows)


def main():
    os.makedirs(OUT, exist_ok=True)

    # heightmap.u16 + preview
    heights = [height_at(gx, gy) for gy in range(G) for gx in range(G)]
    with open(os.path.join(OUT, "heightmap.u16"), "wb") as f:
        f.write(struct.pack("<%dH" % (G * G), *heights))

    hmin, hmax = min(heights), max(heights)
    span = max(1, hmax - hmin)
    rows = []
    for gy in range(G):
        rows.append(bytes((heights[gy * G + gx] - hmin) * 255 // span for gx in range(G)))
    write_png(os.path.join(OUT, "heightmap.png"), G, G, 1, rows)

    # layer textures
    make_layer_tex(os.path.join(OUT, "grass.png"), (86, 116, 62), 0.22, seed=0.7)
    make_layer_tex(os.path.join(OUT, "dirt.png"), (122, 96, 70), 0.18, seed=2.9)

    # splat: grayscale alpha map for the dirt layer (layer 1):
    # dirt on the hilltop and along a diagonal path, grass elsewhere
    rows = []
    for gy in range(G):
        row = bytearray()
        for gx in range(G):
            h = height_at(gx, gy) - 32768
            dirt = max(0.0, min(1.0, (h - 9000.0) / 5000.0))           # hilltop
            path_d = abs((gx - gy) - 10)                                # diagonal
            dirt = max(dirt, max(0.0, 1.0 - path_d / 6.0) * 0.9)        # path
            row.append(int(dirt * 255))
        rows.append(bytes(row))
    write_png(os.path.join(OUT, "splat.png"), G, G, 1, rows)

    scene = {
        "tile": "_test",
        "origin": ORIGIN,
        "gridSize": G,
        "spacing": SPACING,
        "heightScale": HEIGHT_SCALE,
        "heightmap": "heightmap.u16",
        "heights": "heightmap.png",
        "layers": [
            {"name": "grass", "diffuse": "grass.png", "splat": None},
            {"name": "dirt", "diffuse": "dirt.png", "splat": "splat.png"},
        ],
        "water": None,
        "props": [],
    }
    with open(os.path.join(OUT, "scene.json"), "w") as f:
        json.dump(scene, f, indent=2)

    print("wrote %s (hmin=%d hmax=%d, relief=%.1f m)" %
          (OUT, hmin, hmax, (hmax - hmin) * HEIGHT_SCALE * 0.01))


if __name__ == "__main__":
    main()
