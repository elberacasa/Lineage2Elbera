#!/usr/bin/env python3
"""Audit the world-prop glTF materials against the retail UE2 material state.

WHY this exists
---------------
`tools/world/convert.py` runs umodel's glTF exporter, which emits material
NAMES but no render state, and then guesses the state from the exported PNG:

    png_has_significant_alpha()  ->  alphaMode = MASK, alphaCutoff = 0.5,
                                     doubleSided = true          (convert.py:762,935)

The retail data does not need guessing.  Every prop material is a UE2
`Shader` (or a bare `Texture`) in a client `systextures`/`textures` .utx,
and the Shader's own packed properties state the render mode exactly:

  AlphaTest + Opacity + AlphaRef      -> alpha-cutout, cutoff = AlphaRef/255
                                         (retail AlphaRef is 10 or 30, NOT 128)
  Diffuse + SelfIllumination(+Mask)   -> OPAQUE, plus an additive emissive
                                         pass masked by the texture ALPHA
  Diffuse + Specular + SpecularityMask-> OPAQUE, alpha is a SPECULAR mask
  Diffuse + OutputBlending            -> a blended (translucent/additive) pass
  TreatAsTwoSided / TwoSided          -> the real two-sidedness

Two failure modes follow from the guess, and this script measures both:

1. FATAL.  When the alpha channel is a specular or self-illumination mask
   (near-zero almost everywhere) the guess marks the material MASK with a
   0.5 cutoff, and every texel fails the test: the surface disappears
   completely.  `Giran_wall08` (Giran village gate) is exactly this — a
   brown stone diffuse whose alpha peaks at 119/255.
2. EROSION.  Where the material really is alpha-cutout, retail cuts at
   AlphaRef (10/255 = 0.039 or 30/255 = 0.118) and the pipeline cuts at
   0.5, eating the soft edge of every leaf card.

Checks
------
  invisible   materials whose texture has ZERO texels at/above the glTF's
              own alphaCutoff -> the surface renders 100% invisible.
              This needs no client install; it is the --check gate.
  shaders     (--shaders) resolve each material name in the client .utx and
              compare the shipped alphaMode / alphaCutoff / doubleSided with
              what the Shader properties actually say.  Needs
              assets/interlude/textures (+ systextures).

Usage
-----
  audit_prop_materials.py                      # all tiles, summary
  audit_prop_materials.py --check              # exit 1 if anything is invisible
  audit_prop_materials.py --tiles 22_22,24_17  # restrict
  audit_prop_materials.py --shaders            # + retail Shader cross-check
  audit_prop_materials.py --verbose            # per-material lines
"""
import json
import os
import struct
import sys
import zlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
WORLD = os.path.join(ROOT, 'assets/world')
CLIENT_TEX = [os.path.join(ROOT, 'assets/interlude/textures'),
              os.path.join(ROOT, 'assets/interlude/systextures')]


# --------------------------------------------------------------- PNG alpha

def _unfilter(raw, w, h, bpp):
    """Undo the PNG per-scanline filters. -> bytes of h*w*bpp samples."""
    stride = w * bpp
    out = bytearray(stride * h)
    prev = bytearray(stride)
    pos = 0
    for y in range(h):
        f = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if f == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                c = prev[x - bpp] if x >= bpp else 0
                b = prev[x]
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return bytes(out)


def alpha_histogram(path):
    """-> (256-bin histogram of the alpha channel, total texels), or None
    when the PNG carries no alpha channel / cannot be decoded here
    (interlaced or 16-bit; both are absent from the converted set)."""
    try:
        with open(path, 'rb') as f:
            data = f.read()
    except OSError:
        return None
    if not data.startswith(b'\x89PNG\r\n\x1a\n'):
        return None
    w, h, depth, ctype, _c, _f, interlace = struct.unpack('>IIBBBBB', data[16:29])
    if depth != 8 or interlace != 0 or ctype not in (4, 6):
        return None
    bpp = 4 if ctype == 6 else 2
    idat = bytearray()
    pos = 8
    while pos + 8 <= len(data):
        (ln,) = struct.unpack('>I', data[pos:pos + 4])
        if data[pos + 4:pos + 8] == b'IDAT':
            idat += data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
    try:
        raw = zlib.decompress(bytes(idat))
    except zlib.error:
        return None
    px = _unfilter(raw, w, h, bpp)
    hist = [0] * 256
    for i in range(bpp - 1, len(px), bpp):
        hist[px[i]] += 1
    return hist, w * h


def surviving(hist, cutoff8):
    """-> fraction of texels that pass `alpha >= cutoff8`."""
    total = sum(hist)
    if not total:
        return 1.0
    return sum(hist[cutoff8:]) / total


# ---------------------------------------------------------- retail Shaders

_UTX_INDEX = None


def utx_index():
    """-> {export_name_lower: (package_path, export)} over every client
    texture package.  Built once; the packages are memory-mapped by l2lib
    only for the ones actually queried."""
    global _UTX_INDEX
    if _UTX_INDEX is not None:
        return _UTX_INDEX
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    from l2lib import ue2package as up
    _UTX_INDEX = {}
    for d in CLIENT_TEX:
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.lower().endswith('.utx'):
                continue
            try:
                pkg, _ = up.load_package(os.path.join(d, f))
            except Exception:
                continue
            for e in pkg.exports:
                _UTX_INDEX.setdefault(pkg.export_name(e).lower(), (pkg, e))
    return _UTX_INDEX


def retail_state(name):
    """-> dict describing what the retail material says, or None if the
    name is not in any client package.

    keys: kind ('cutout'|'opaque'|'blend'|'texture'), cutoff (0..1 or None),
          two_sided (bool), props (raw property names)
    """
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    from l2lib import ue2package as up
    ent = utx_index().get(name.lower())
    if ent is None:
        return None
    pkg, e = ent
    cls = pkg.class_name_of(e)
    if cls == 'Texture':
        return {'kind': 'texture', 'cutoff': None, 'two_sided': False,
                'props': [], 'class': cls}
    try:
        props = up.read_properties(pkg, pkg.body_reader(e))
    except Exception:
        return None
    two = bool(props.get('TreatAsTwoSided')) or bool(props.get('TwoSided'))
    if props.get('AlphaTest'):
        ref = props.get('AlphaRef')
        if isinstance(ref, (bytes, bytearray)) and ref:
            cut = ref[0] / 255.0
        else:
            cut = 0.0        # AlphaTest with no AlphaRef: UE default is 0
        kind = 'cutout'
    elif 'OutputBlending' in props:
        kind, cut = 'blend', None
    else:
        kind, cut = 'opaque', None
    return {'kind': kind, 'cutoff': cut, 'two_sided': two,
            'props': sorted(props), 'class': cls}


# ------------------------------------------------------------------- audit

def audit(tiles, want_shaders, verbose):
    hist_cache = {}
    rows_invisible = []
    rows_mismatch = []
    n_mat = 0
    n_mask = 0
    placements = {}          # (tile, gltf rel) -> count, filled from scene.json

    for tile in tiles:
        tdir = os.path.join(WORLD, tile)
        sj = os.path.join(tdir, 'scene.json')
        if not os.path.isfile(sj):
            continue
        with open(sj) as f:
            scene = json.load(f)
        use = {}
        for p in scene.get('props', []):
            if p.get('gltf'):
                use[p['gltf']] = use.get(p['gltf'], 0) + 1

        pdir = os.path.join(tdir, 'props')
        if not os.path.isdir(pdir):
            continue
        for fn in sorted(os.listdir(pdir)):
            if not fn.endswith('.gltf'):
                continue
            gp = os.path.join(pdir, fn)
            with open(gp) as f:
                g = json.load(f)
            imgs = g.get('images', [])
            texs = g.get('textures', [])
            rel = 'props/' + fn
            for m in g.get('materials', []):
                bc = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
                if bc is None:
                    continue
                n_mat += 1
                uri = imgs[texs[bc['index']]['source']].get('uri')
                if not uri:
                    continue
                png = os.path.join(pdir, uri)
                if png not in hist_cache:
                    hist_cache[png] = alpha_histogram(png)
                ah = hist_cache[png]
                mode = m.get('alphaMode', 'OPAQUE')
                cutoff = m.get('alphaCutoff', 0.5)
                if mode == 'MASK':
                    n_mask += 1
                    if ah:
                        hist, _n = ah
                        keep = surviving(hist, min(255, int(round(cutoff * 255))))
                        if keep == 0.0:
                            rows_invisible.append(
                                (tile, rel, m.get('name'), uri,
                                 use.get(rel, 0), max(i for i, c in enumerate(hist) if c)))
                if want_shaders:
                    rs = retail_state(m.get('name') or '')
                    if rs is None:
                        continue
                    want_mask = rs['kind'] == 'cutout'
                    got_mask = mode == 'MASK'
                    bad = []
                    if want_mask != got_mask:
                        bad.append('alphaMode %s but retail %s (%s)'
                                   % (mode, rs['kind'], '+'.join(rs['props'])))
                    elif want_mask and rs['cutoff'] is not None \
                            and abs(rs['cutoff'] - cutoff) > 0.02:
                        bad.append('alphaCutoff %.3f but retail AlphaRef %.3f'
                                   % (cutoff, rs['cutoff']))
                    if bool(m.get('doubleSided')) != rs['two_sided']:
                        bad.append('doubleSided %s but retail two-sided %s'
                                   % (bool(m.get('doubleSided')), rs['two_sided']))
                    if bad:
                        rows_mismatch.append((tile, rel, m.get('name'), bad,
                                              use.get(rel, 0)))

    # a glTF with two dead materials must not count its placements twice
    dead_props = {(r[0], r[1]): r[4] for r in rows_invisible}
    print('materials with a baseColor texture : %d' % n_mat)
    print('  marked alphaMode MASK            : %d' % n_mask)
    print('  of those, 100%% invisible         : %d material(s) in %d prop '
          'glTF(s), %d placement(s)'
          % (len(rows_invisible), len(dead_props), sum(dead_props.values())))
    if rows_invisible:
        print('\n-- surfaces that render 100%% invisible '
              '(max alpha in texture < cutoff) --')
        for tile, rel, name, uri, n, amax in sorted(
                rows_invisible, key=lambda r: -r[4])[:40 if not verbose else 10 ** 9]:
            print('  %-7s %-38s %-28s max_alpha=%3d  x%d'
                  % (tile, rel, name, amax, n))
    if want_shaders:
        print('\nretail Shader cross-check: %d material(s) disagree with the '
              'client .utx' % len(rows_mismatch))
        for tile, rel, name, bad, n in sorted(
                rows_mismatch, key=lambda r: -r[4])[:40 if not verbose else 10 ** 9]:
            print('  %-7s %-34s %-26s x%-5d %s' % (tile, rel, name, n, '; '.join(bad)))
    return rows_invisible, rows_mismatch


def main():
    argv = sys.argv[1:]
    check = '--check' in argv
    verbose = '--verbose' in argv
    shaders = '--shaders' in argv
    tiles = None
    for a in argv:
        if a.startswith('--tiles'):
            tiles = a.split('=', 1)[1] if '=' in a else None
    if tiles is None and '--tiles' in argv:
        i = argv.index('--tiles')
        if i + 1 < len(argv):
            tiles = argv[i + 1]
    tile_list = ([t.strip() for t in tiles.split(',')] if tiles
                 else sorted(d for d in os.listdir(WORLD)
                             if os.path.isdir(os.path.join(WORLD, d))))
    inv, mism = audit(tile_list, shaders, verbose)
    if check and inv:
        print('\nFAIL: %d prop surface(s) render 100%% invisible' % len(inv))
        return 1
    if check:
        print('\nPASS: no prop surface is fully cut away')
    return 0


if __name__ == '__main__':
    sys.exit(main())
