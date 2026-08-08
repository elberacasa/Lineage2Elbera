#!/usr/bin/env python3
"""Prove which coordinate basis the converted world-prop glTFs are in.

WHY this exists
---------------
UEViewer's glTF exporter converts UE space with a *swap*:

    Exporters/ExportGLTF.cpp:59   TransformPosition: Exchange(pos[1], pos[2])
                                                     pos.Scale(0.01f)

i.e. `(x, y, z)_UE -> (x, z, y)_glTF`.  That matrix has determinant -1: it
is a REFLECTION, not a rotation.  The character pipeline knows this and does
not use it — `tools/src/char_pipeline/assemble.py:363` documents the same
fact and converts with the proper `(x, z, -y)` (determinant +1) plus a
triangle-index reversal.  The world pipeline
(`tools/world/convert.py:744 umodel_export_package`) ships umodel's glTF
untouched, while the client places those meshes with `l2ToThree`, which IS
`(x, z, -y)` (`editor/world/js/coords.js:17`).  The two differ by
diag(1,1,-1), so every prop is drawn as its own mirror image about its
pivot, which is also why `Terrain.ueQuaternion`
(`editor/world/js/terrain.js:703`) has to negate yaw and roll to make the
scene line up.

This script decides the question with data instead of source reading:
umodel's *psk* exporter writes the mesh in UE coordinates with a documented
single mirror on Y (`Exporters/ExportPsk.cpp:21 #define MIRROR_MESH 1`,
applied at lines 98-112).  So for the same StaticMesh:

    psk point (px, py, pz)  ==  UE (px, -py, pz)
    proper glTF  (det +1)   ==  (px, pz,  py) * 0.01     [three_z = -ue_y]
    umodel glTF  (det -1)   ==  (px, pz, -py) * 0.01     [three_z = +ue_y]

Exporting one mesh per package as psk and matching its point set against the
shipped glTF's POSITION accessor therefore tells you, per package, which
basis the shipped data is in.  No opinion involved.

Usage
-----
  audit_prop_basis.py --tiles 22_22                 # sample 1 mesh/package
  audit_prop_basis.py --tiles 22_22 --sample 3
  audit_prop_basis.py --tiles 22_22 --check         # exit 1 on any mirrored
Requires tools/bin/umodel and assets/interlude/staticmeshes.
"""
import json
import os
import struct
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
WORLD = os.path.join(ROOT, 'assets/world')
UMODEL = os.path.join(ROOT, 'tools/bin/umodel')
USX_DIR = os.path.join(ROOT, 'assets/interlude/staticmeshes')
TOL = 1e-3


def psk_points(path):
    """-> [(x, y, z)] from the PNTS0000 chunk of an ActorX .psk/.pskx."""
    with open(path, 'rb') as f:
        d = f.read()
    off = 0
    while off + 32 <= len(d):
        name = d[off:off + 20].split(b'\0')[0].decode('latin1')
        _flags, dsize, dcount = struct.unpack_from('<iii', d, off + 20)
        off += 32
        if name == 'PNTS0000':
            return [struct.unpack_from('<3f', d, off + i * 12)
                    for i in range(dcount)]
        off += dsize * dcount
    return []


def gltf_points(path):
    """-> [(x, y, z)] of every POSITION accessor in a .gltf with an external
    .bin buffer (what umodel writes)."""
    with open(path) as f:
        g = json.load(f)
    buf = open(os.path.join(os.path.dirname(path),
                            g['buffers'][0]['uri']), 'rb').read()
    out = []
    for mesh in g.get('meshes', []):
        for prim in mesh['primitives']:
            a = g['accessors'][prim['attributes']['POSITION']]
            bv = g['bufferViews'][a['bufferView']]
            base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
            stride = bv.get('byteStride') or 12
            for k in range(a['count']):
                out.append(struct.unpack_from('<3f', buf, base + k * stride))
    return out


def export_psk(package, mesh, out_dir):
    argv = [UMODEL, '-export', '-psk', '-notex', '-game=l2',
            '-path=' + USX_DIR, '-out=' + out_dir, package + '.usx', mesh]
    r = subprocess.run(argv, capture_output=True)
    if r.returncode != 0:
        return None
    for root, _d, files in os.walk(out_dir):
        for f in files:
            if f.lower() in (mesh.lower() + '.psk', mesh.lower() + '.pskx'):
                return os.path.join(root, f)
    return None


def classify(psk, gl):
    """-> ('mirrored'|'proper'|'unknown', matched, total)."""
    key = set((round(x, 3), round(y, 3), round(z, 3)) for x, y, z in gl)
    mir = sum(1 for x, y, z in psk
              if (round(x * .01, 3), round(z * .01, 3), round(-y * .01, 3)) in key)
    pro = sum(1 for x, y, z in psk
              if (round(x * .01, 3), round(z * .01, 3), round(y * .01, 3)) in key)
    n = len(psk)
    if not n:
        return 'unknown', 0, 0
    if mir > pro and mir >= 0.95 * n:
        return 'mirrored', mir, n
    if pro > mir and pro >= 0.95 * n:
        return 'proper', pro, n
    return 'unknown', max(mir, pro), n


def main():
    argv = sys.argv[1:]
    check = '--check' in argv
    sample = 1
    tiles = None
    for i, a in enumerate(argv):
        if a == '--sample' and i + 1 < len(argv):
            sample = int(argv[i + 1])
        if a == '--tiles' and i + 1 < len(argv):
            tiles = argv[i + 1]
    tile_list = ([t.strip() for t in tiles.split(',')] if tiles
                 else sorted(d for d in os.listdir(WORLD)
                             if os.path.isdir(os.path.join(WORLD, d))))
    # scene.json "mesh" is "<package>.<meshname>", and "gltf" the converted file
    todo = {}          # package -> [(mesh, gltf abs path)]
    for tile in tile_list:
        sj = os.path.join(WORLD, tile, 'scene.json')
        if not os.path.isfile(sj):
            continue
        with open(sj) as f:
            scene = json.load(f)
        for p in scene.get('props', []):
            if not p.get('gltf') or '.' not in (p.get('mesh') or ''):
                continue
            pkg, mesh = p['mesh'].split('.', 1)
            lst = todo.setdefault(pkg.lower(), [])
            gp = os.path.join(WORLD, tile, p['gltf'])
            if len(lst) < sample and os.path.isfile(gp) \
                    and mesh not in [m for m, _ in lst]:
                lst.append((mesh, gp))

    counts = {'mirrored': 0, 'proper': 0, 'unknown': 0}
    tmp = tempfile.mkdtemp(prefix='audit_basis_')
    try:
        for pkg, items in sorted(todo.items()):
            for mesh, gp in items:
                psk = export_psk(pkg, mesh, os.path.join(tmp, pkg, mesh))
                if not psk:
                    counts['unknown'] += 1
                    print('%-34s %-32s  psk export failed' % (pkg, mesh))
                    continue
                verdict, hit, n = classify(psk_points(psk), gltf_points(gp))
                counts[verdict] += 1
                print('%-34s %-32s  %-9s %d/%d verts' % (pkg, mesh, verdict, hit, n))
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)

    print('\nmirrored (glTF z == +UE y, determinant -1): %d' % counts['mirrored'])
    print('proper   (glTF z == -UE y, determinant +1): %d' % counts['proper'])
    print('unknown                                   : %d' % counts['unknown'])
    if check and counts['mirrored']:
        print('FAIL: %d prop package(s) are in the reflected basis'
              % counts['mirrored'])
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
