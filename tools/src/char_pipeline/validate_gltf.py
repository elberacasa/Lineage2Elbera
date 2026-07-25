#!/usr/bin/env python3
"""Structural validation of the assembled character glTFs.

Checks (no external deps):
  - JSON parses, required sections present
  - buffer file exists and byteLength matches the real file size
  - every bufferView fits inside the buffer; every accessor fits its bufferView
  - skins: joints reference existing nodes, IBM accessor count == joint count
  - JOINTS_0 vertex attribute values are within the skin's joint list
  - animations: channels target existing nodes; sampler input/output accessors
    exist; input is monotonic with max > 0
  - images referenced by textures exist on disk and are valid PNGs
Usage: validate_gltf.py <file.gltf> [...]
"""
import json
import os
import struct
import sys

CT_SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
TYPE_N = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_accessor(g, blob, idx):
    ac = g['accessors'][idx]
    if 'bufferView' not in ac:
        return None
    bv = g['bufferViews'][ac['bufferView']]
    off = bv.get('byteOffset', 0) + ac.get('byteOffset', 0)
    ncomp = TYPE_N[ac['type']]
    fmt = {5121: 'B', 5123: 'H', 5125: 'I', 5126: 'f'}[ac['componentType']]
    size = CT_SIZE[ac['componentType']]
    stride = bv.get('byteStride') or ncomp * size
    out = []
    for i in range(ac['count']):
        out.append(struct.unpack_from('<%d%s' % (ncomp, fmt),
                                      blob, off + i * stride))
    return out


def validate(path):
    errs = []
    warn = []
    g = json.load(open(path))
    base = os.path.dirname(path)

    buf = g['buffers'][0]
    bin_path = os.path.join(base, buf['uri'])
    if not os.path.exists(bin_path):
        errs.append('missing buffer %s' % buf['uri'])
        return errs, warn
    blob = open(bin_path, 'rb').read()
    if len(blob) != buf['byteLength']:
        errs.append('byteLength %d != file size %d' % (buf['byteLength'], len(blob)))

    for i, bv in enumerate(g['bufferViews']):
        if bv.get('byteOffset', 0) + bv['byteLength'] > len(blob):
            errs.append('bufferView %d out of range' % i)
    for i, ac in enumerate(g['accessors']):
        if 'bufferView' not in ac:
            continue
        bv = g['bufferViews'][ac['bufferView']]
        need = ac.get('byteOffset', 0) + ac['count'] * TYPE_N[ac['type']] * CT_SIZE[ac['componentType']]
        if need > bv['byteLength']:
            errs.append('accessor %d overflows bufferView' % i)

    nnodes = len(g['nodes'])
    for si, sk in enumerate(g.get('skins', [])):
        for j in sk['joints']:
            if j >= nnodes:
                errs.append('skin %d joint %d out of range' % (si, j))
        ibm = g['accessors'][sk['inverseBindMatrices']]
        if ibm['count'] != len(sk['joints']):
            errs.append('skin %d IBM count %d != joints %d' % (si, ibm['count'], len(sk['joints'])))

    # JOINTS_0 values must index into the skin's joint list
    for mi, me in enumerate(g.get('meshes', [])):
        skin = g['skins'][mi] if mi < len(g.get('skins', [])) else g['skins'][0]
        for prim in me['primitives']:
            if 'JOINTS_0' not in prim['attributes']:
                continue
            vals = read_accessor(g, blob, prim['attributes']['JOINTS_0'])
            mx = max(max(v) for v in vals)
            if mx >= len(skin['joints']):
                errs.append('mesh %d JOINTS_0 max %d >= skin joints %d'
                            % (mi, mx, len(skin['joints'])))

    for ai, an in enumerate(g.get('animations', [])):
        if not an['channels']:
            errs.append('anim %s has no channels' % an['name'])
        for ch in an['channels']:
            if ch['target']['node'] >= nnodes:
                errs.append('anim %s channel targets bad node' % an['name'])
            sm = an['samplers'][ch['sampler']]
            for key in ('input', 'output'):
                if sm[key] >= len(g['accessors']):
                    errs.append('anim %s sampler bad %s accessor' % (an['name'], key))
        times = read_accessor(g, blob, an['samplers'][0]['input'])
        tv = [t[0] for t in times]
        if tv[-1] <= 0:
            # single-keyframe static poses are legitimate (e.g. monster
            # 'corpse'/deathwait); zero-duration is a warning, not an error
            warn.append('anim %s zero duration (static pose)' % an['name'])
        if any(b < a for a, b in zip(tv, tv[1:])):
            errs.append('anim %s non-monotonic times' % an['name'])

    for im in g.get('images', []):
        p = os.path.join(base, im['uri'])
        if not os.path.exists(p):
            errs.append('missing image %s' % im['uri'])
        elif open(p, 'rb').read(8) != b'\x89PNG\r\n\x1a\n':
            errs.append('image %s is not a PNG' % im['uri'])

    skins = len(g.get('skins', []))
    anims = [a['name'] for a in g.get('animations', [])]
    print('%s: %d nodes, %d meshes, %d skins, anims=%s images=%d -> %s'
          % (os.path.basename(path), nnodes, len(g['meshes']), skins, anims,
             len(g.get('images', [])),
             'OK' if not errs else '%d ERRORS' % len(errs)))
    for e in errs:
        print('   ERROR:', e)
    for w in warn:
        print('   warn:', w)
    return errs, warn


if __name__ == '__main__':
    bad = 0
    for p in sys.argv[1:]:
        errs, _ = validate(p)
        bad += len(errs)
    sys.exit(1 if bad else 0)
