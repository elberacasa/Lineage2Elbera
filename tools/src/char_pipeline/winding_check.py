#!/usr/bin/env python3
"""Measure triangle winding against vertex normals in a glTF 2.0 file.

WHY this exists: glTF 2.0 §3.7.2.1 fixes the front face as
counter-clockwise in a right-handed coordinate system, i.e. for a triangle
(a, b, c) the front-facing geometric normal is cross(b-a, c-a).  A mesh
whose indices run the other way is *inverted*: renderers that cull nothing
(doubleSided, which every model in this repo uses) still shade it wrong,
because three.js/WebGL negate the interpolated shading normal on
back-facing fragments — so the lighting comes from behind the surface.

The measurement is therefore: for every triangle, compare the geometric
normal cross(b-a, c-a) with the mean of the three vertices' NORMAL
attribute (which the psk pipeline produces pointing outward, angle-weighted
per UEViewer BuildNormalsCommon).  A negative dot means that face's winding
disagrees with its own normals.  A correct mesh scores 0/N.

Degenerate triangles (zero-area, |cross| below EPS) carry no winding and
are excluded from the denominator; they are reported separately.

A handful of models do not reach a clean 0.  That residue is in the SOURCE,
not in the conversion: e.g. `MElf_m001_u` has 6 faces whose authored
per-vertex normals oppose the winding of their own neighbourhood already in
psk space (measured on the raw .psk: 564/570 faces disagree with the psk
face order, 6 agree — after the reversal those same 6 are the ones that
disagree).  A reversal is exactly complementary, so `before + after ==
total` for every file is the proof that only the winding changed.

Usage:
  winding_check.py <file.gltf> [...]           # print per-primitive counts
  winding_check.py --check <file.gltf> [...]   # exit 1 if ANY face inverted
  winding_check.py --majority <file.gltf> [..] # exit 1 only if the inverted
                                               # faces are the majority, i.e.
                                               # the mesh as a whole is
                                               # wound inside-out.  This is
                                               # the pipeline gate; it
                                               # tolerates source outliers
                                               # without tolerating a
                                               # regression (a regression
                                               # flips ~100% of faces).
"""
import json
import os
import struct
import sys

EPS = 1e-12

_CTYPE = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2),
          5125: ('I', 4), 5126: ('f', 4)}
_NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_accessor(g, buf, idx):
    """-> list of tuples (or scalars) for accessor idx, honouring stride."""
    acc = g['accessors'][idx]
    fmt, size = _CTYPE[acc['componentType']]
    n = _NCOMP[acc['type']]
    bv = g['bufferViews'][acc['bufferView']]
    base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = bv.get('byteStride') or n * size
    out = []
    for i in range(acc['count']):
        off = base + i * stride
        vals = struct.unpack_from('<%d%s' % (n, fmt), buf, off)
        out.append(vals[0] if n == 1 else vals)
    return out


def load_buffer(path, g):
    uri = g['buffers'][0].get('uri')
    if uri is None:
        raise ValueError('%s: .glb / embedded buffers not supported' % path)
    return open(os.path.join(os.path.dirname(path), uri), 'rb').read()


def measure(path):
    """-> (inverted, total, degenerate, [(mesh, prim, inverted, total)])"""
    with open(path) as f:
        g = json.load(f)
    buf = load_buffer(path, g)
    tot = inv = deg = 0
    per = []
    for mi, mesh in enumerate(g.get('meshes', [])):
        for pi, prim in enumerate(mesh['primitives']):
            if prim.get('mode', 4) != 4:
                continue
            pos = read_accessor(g, buf, prim['attributes']['POSITION'])
            nrm = (read_accessor(g, buf, prim['attributes']['NORMAL'])
                   if 'NORMAL' in prim['attributes'] else None)
            if nrm is None:
                continue
            idx = (read_accessor(g, buf, prim['indices'])
                   if 'indices' in prim else list(range(len(pos))))
            p_inv = p_tot = 0
            for t in range(0, len(idx) - 2, 3):
                a, b, c = idx[t], idx[t + 1], idx[t + 2]
                ax, ay, az = pos[a]
                u = (pos[b][0] - ax, pos[b][1] - ay, pos[b][2] - az)
                v = (pos[c][0] - ax, pos[c][1] - ay, pos[c][2] - az)
                gx = u[1] * v[2] - u[2] * v[1]
                gy = u[2] * v[0] - u[0] * v[2]
                gz = u[0] * v[1] - u[1] * v[0]
                if gx * gx + gy * gy + gz * gz < EPS:
                    deg += 1
                    continue
                nx = nrm[a][0] + nrm[b][0] + nrm[c][0]
                ny = nrm[a][1] + nrm[b][1] + nrm[c][1]
                nz = nrm[a][2] + nrm[b][2] + nrm[c][2]
                p_tot += 1
                if gx * nx + gy * ny + gz * nz < 0.0:
                    p_inv += 1
            tot += p_tot
            inv += p_inv
            per.append((mesh.get('name', 'mesh%d' % mi), pi, p_inv, p_tot))
    return inv, tot, deg, per


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    check = '--check' in sys.argv
    majority = '--majority' in sys.argv
    verbose = '--verbose' in sys.argv
    if not args:
        print(__doc__)
        return 2
    bad = flipped = residue = 0
    for path in args:
        inv, tot, deg, per = measure(path)
        flag = ('INSIDE-OUT' if inv * 2 > tot
                else ('%d source outlier(s)' % inv if inv else 'ok'))
        print('%-52s %6d/%-6d inverted  (%d degenerate)  %s'
              % (os.path.basename(path), inv, tot, deg, flag))
        if verbose:
            for name, pi, i, t in per:
                print('    %-40s prim %d  %5d/%-5d' % (name, pi, i, t))
        if inv:
            bad += 1
            residue += inv
        if inv * 2 > tot:
            flipped += 1
    if majority:
        if flipped:
            print('FAIL: %d/%d file(s) are wound inside-out'
                  % (flipped, len(args)))
            return 1
        print('PASS: 0/%d file(s) wound inside-out (%d source-outlier faces '
              'across %d file(s))' % (len(args), residue, bad))
        return 0
    if check and bad:
        print('FAIL: %d/%d file(s) have inverted faces' % (bad, len(args)))
        return 1
    if check:
        print('PASS: 0 inverted faces in %d file(s)' % len(args))
    return 0


if __name__ == '__main__':
    sys.exit(main())
