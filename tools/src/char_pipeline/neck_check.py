#!/usr/bin/env python3
"""Neck-seam divergence analysis.

For each character glTF: compute skinned world positions at several
animation frames, then measure the distance between the face mesh (_f)
bottom/neck-ring vertices and the body mesh (_u) top/neck-ring vertices.

A well-formed head-body junction has matched rings: each _f ring vertex
should sit within ~1-2 mm of a _u ring vertex at EVERY frame.
"""
import json
import math
import os
import struct
import sys

MODELS = os.path.join(os.path.dirname(__file__), '../../../editor/characters/models')


def acc(g, b, idx):
    a = g['accessors'][idx]
    bv = g['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    f = {5126: 'f', 5123: 'H', 5121: 'B', 5125: 'I'}[a['componentType']]
    return [struct.unpack_from('<%d%s' % (n, f), b, off + k * n * struct.calcsize(f))
            for k in range(a['count'])]


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def qrot(q, v):
    x, y, z, w = q
    tx = 2 * (y * v[2] - z * v[1])
    ty = 2 * (z * v[0] - x * v[2])
    tz = 2 * (x * v[1] - y * v[0])
    return (v[0] + w * tx + (y * tz - z * ty),
            v[1] + w * ty + (z * tx - x * tz),
            v[2] + w * tz + (x * ty - y * tx))


def compose(pt, qt, pl, ql):
    r = qrot(qt, pl)
    return ((pt[0] + r[0], pt[1] + r[1], pt[2] + r[2]), qmul(qt, ql))


def slerp(a, b, t):
    d = sum(x * y for x, y in zip(a, b))
    if d < 0:
        b = tuple(-x for x in b)
        d = -d
    if d > 0.9995:
        return a
    th = math.acos(min(1.0, d))
    sa = math.sin((1 - t) * th) / math.sin(th)
    sb = math.sin(t * th) / math.sin(th)
    return tuple(sa * x + sb * y for x, y in zip(a, b))


class Model(object):
    def __init__(self, path):
        self.g = json.load(open(path))
        self.b = open(path.replace('.gltf', '.bin'), 'rb').read()
        g = self.g
        self.parent = {}
        for i, n in enumerate(g['nodes']):
            for c in n.get('children', []):
                self.parent[c] = i

    def world_at(self, anim_name, time_s):
        g = self.g
        anim = next(a for a in g['animations'] if a['name'] == anim_name)
        locals_ = {i: (list(n.get('translation', [0, 0, 0])),
                       list(n.get('rotation', [0, 0, 0, 1])))
                   for i, n in enumerate(g['nodes'])}
        for ch in anim['channels']:
            ni = ch['target']['node']
            samp = anim['samplers'][ch['sampler']]
            times = [x[0] for x in acc(g, self.b, samp['input'])]
            out = acc(g, self.b, samp['output'])
            t = max(0.0, min(time_s, times[-1]))
            f = 0
            while f < len(times) - 1 and times[f + 1] < t:
                f += 1
            if f >= len(times) - 1:
                val = out[-1]
            else:
                alpha = (t - times[f]) / (times[f + 1] - times[f]) \
                    if times[f + 1] > times[f] else 0.0
                if ch['target']['path'] == 'rotation':
                    val = slerp(out[f], out[f + 1], alpha)
                else:
                    val = tuple(a + (b_ - a) * alpha
                                for a, b_ in zip(out[f], out[f + 1]))
            tt, rr = locals_[ni]
            if ch['target']['path'] == 'translation':
                tt = list(val)
            else:
                rr = list(val)
            locals_[ni] = (tt, rr)
        world = {}

        def W(i):
            if i in world:
                return world[i]
            tt, rr = locals_[i]
            world[i] = compose(*W(self.parent[i]), tt, rr) \
                if i in self.parent else (tuple(tt), tuple(rr))
            return world[i]

        for i in range(len(g['nodes'])):
            W(i)
        return world

    def skinned(self, mesh_name, world):
        g = self.g
        node = next(n for n in g['nodes'] if n.get('name') == mesh_name)
        skin = g['skins'][node['skin']]
        ibms = acc(g, self.b, skin['inverseBindMatrices'])
        prim = g['meshes'][node['mesh']]['primitives'][0]
        pos = acc(g, self.b, prim['attributes']['POSITION'])
        jts = acc(g, self.b, prim['attributes']['JOINTS_0'])
        wts = acc(g, self.b, prim['attributes']['WEIGHTS_0'])
        out = []
        for p, jj, ww in zip(pos, jts, wts):
            sx = sy = sz = 0.0
            for k in range(4):
                if ww[k] == 0:
                    continue
                joint_node = skin['joints'][jj[k]]
                wt, wr = world[joint_node]
                ibm = ibms[jj[k]]
                # v' = world * ibm * v  (rigid TR composition)
                lx = ibm[0] * p[0] + ibm[4] * p[1] + ibm[8] * p[2] + ibm[12]
                ly = ibm[1] * p[0] + ibm[5] * p[1] + ibm[9] * p[2] + ibm[13]
                lz = ibm[2] * p[0] + ibm[6] * p[1] + ibm[10] * p[2] + ibm[14]
                rx, ry, rz = qrot(wr, (lx, ly, lz))
                sx += ww[k] * (rx + wt[0])
                sy += ww[k] * (ry + wt[1])
                sz += ww[k] * (rz + wt[2])
            out.append((sx, sy, sz))
        return out


def neck_rings(model, world_bind):
    """-> (f_ring, u_ring): vertex index lists of the _f bottom ring and
    _u top ring, identified by bind-space y extremes."""
    g = model.g
    parts = {}
    for n in g['nodes']:
        if 'mesh' in n and n.get('name', '').endswith('_f'):
            parts['f'] = n['name']
        if 'mesh' in n and n.get('name', '').endswith('_u'):
            parts['u'] = n['name']
    rings = {}
    for key, name in parts.items():
        pts = model.skinned(name, world_bind)
        ys = sorted(p[1] for p in pts)
        if key == 'f':
            lo = ys[0]
            ring = [i for i, p in enumerate(pts) if p[1] < lo + 0.006]
        else:
            hi = ys[-1]
            ring = [i for i, p in enumerate(pts) if p[1] > hi - 0.006]
        rings[key] = (name, pts, ring)
    return rings


def ring_match(pts_f, ring_f, pts_u, ring_u):
    """max over f-ring verts of distance to nearest u-ring vert, and the
    ring centroid distance."""
    worst = 0.0
    for i in ring_f:
        p = pts_f[i]
        d = min(math.dist(p, pts_u[j]) for j in ring_u)
        worst = max(worst, d)
    cf = [sum(p[k] for p in (pts_f[i] for i in ring_f)) / len(ring_f)
          for k in range(3)]
    cu = [sum(p[k] for p in (pts_u[j] for j in ring_u)) / len(ring_u)
          for k in range(3)]
    return worst, math.dist(cf, cu)


def main():
    frames = [('idle', 0.0), ('idle', 0.5), ('idle', 1.0),
              ('walk', 0.4), ('attack', 0.4), ('dance', 1.5)]
    ids = sys.argv[1:] or sorted(f[:-5] for f in os.listdir(MODELS)
                                 if f.endswith('.gltf'))
    for cid in ids:
        m = Model(os.path.join(MODELS, cid + '.gltf'))
        try:
            world0 = m.world_at('idle', 0.0)
            rings = neck_rings(m, world0)
        except Exception as e:
            print('%-16s ERROR %s' % (cid, e))
            continue
        fname, fpts0, fring = rings['f']
        uname, upts0, uring = rings['u']
        worst_all = 0.0
        detail = []
        for anim, t in frames:
            try:
                world = m.world_at(anim, t)
            except StopIteration:
                continue
            fpts = m.skinned(fname, world)
            upts = m.skinned(uname, world)
            w, cd = ring_match(fpts, fring, upts, uring)
            worst_all = max(worst_all, w)
            detail.append('%s@%.1f:%.1f/%.1f' % (anim, t, w * 100, cd * 100))
        print('%-16s worst-ring-gap %5.1f mm  (mm per frame: %s)'
              % (cid, worst_all * 100, ' '.join(detail)))


main()
