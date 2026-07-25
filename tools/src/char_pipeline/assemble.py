#!/usr/bin/env python3
"""Assemble a web-ready glTF character from umodel .psk/.psa exports.

Full-skeleton, zero-remap architecture:

  Every L2 body-part SkeletalMesh exports (via `umodel -game=l2 -export`) a
  .psk carrying the COMPLETE reference skeleton of its package (verified:
  70-130 bones per part, identical bind poses across parts of a combo).
  Merging therefore means concatenating points/wedges/faces with bone
  indices passed through an EXACT permutation — never matrix math on skin
  data. The permutation is derived structurally from the data itself:

    bone identity = (parent identity, name, local bind pose)

  This matters because the source data is not name-clean: e.g. in
  Fighter.ukx the meshes MFighter_m001_l/_g/_b (and MFighter_anim) carry a
  duplicated bone name 'Bip01_L_Finger01' where the second occurrence
  (parent Bip01_R_Finger0) is really Bip01_R_Finger01. The old pipeline
  remapped joints by bare name, binding right-hand glove vertices to the
  LEFT finger bone -> "rod through the hands" the moment a pose separated
  the hands (and the old cross-side face stripping then cut holes trying
  to hide it). Name+parent+pose matching resolves this deterministically.

  Meshes whose whole skeleton is a separate hair rig (female _bh meshes
  with bones Hair01-13 only, e.g. FElf/FDarkElf) contain no body bones at
  all; their vertices are in the same pawn space, so they are bound
  rigidly to the head bone (the hair rig is not animated by the .psa).

Coordinate conversion (measured against the umodel binary's own glTF
export; see the note above _xf_pos — the vendored ExportGLTF.cpp source
describes a different swap(y,z) convention than the binary implements):
  position: (x, z, -y), scale 0.01
  rotation: quaternion (x, z, -y, -w); the root bone is additionally
            conjugated (node rotations AND animation tracks)
  inverse bind matrices: inverse of the node world bind transforms
            (composed from exactly the node transforms written)
  normals: angle-weighted, shared by wedge PointIndex (BuildNormalsCommon)
  indices/UVs: emitted unchanged (no winding flip, no V flip)
"""
import json
import math
import re
import struct
import sys


# ---------------------------------------------------------------- psk parsing

def _chunks(data):
    pos = 0
    while pos < len(data):
        cid = data[pos:pos + 20].split(b'\0')[0].decode('latin1')
        _typ, size, count = struct.unpack('<III', data[pos + 20:pos + 32])
        yield cid, size, count, pos + 32
        pos += 32 + size * count


def parse_psk(path):
    """-> dict(points, wedges, faces, materials, bones, weights).

    bones: [{name, parent (index; == own index for root), quat, pos}]
    wedges: (point_index, u, v)
    faces: (w0, w1, w2, mat_index)
    materials: [name per section]
    weights: {point_index: [(bone_index, weight), ...]}
    """
    data = open(path, 'rb').read()
    out = {'points': [], 'wedges': [], 'faces': [], 'materials': [],
           'bones': [], 'weights': {}}
    for cid, size, count, off in _chunks(data):
        if cid == 'PNTS0000':
            out['points'] = [struct.unpack_from('<3f', data, off + i * 12)
                             for i in range(count)]
        elif cid == 'VTXW0000':
            ws = []
            for i in range(count):
                pi, u, v = struct.unpack_from('<I2f', data, off + i * size)
                ws.append((pi & 0xFFFF, u, v))
            out['wedges'] = ws
        elif cid == 'FACE0000':
            fs = []
            for i in range(count):
                w0, w1, w2, mi, _aux, _sg = struct.unpack_from(
                    '<3H2BI', data, off + i * size)
                fs.append((w0, w1, w2, mi))
            out['faces'] = fs
        elif cid == 'MATT0000':
            out['materials'] = [
                data[off + i * size:off + i * size + 64]
                .split(b'\0')[0].decode('latin1') for i in range(count)]
        elif cid == 'REFSKELT':
            bones = []
            for i in range(count):
                r = data[off + i * size:off + (i + 1) * size]
                name = r[:64].split(b'\0')[0].decode('latin1')
                parent = struct.unpack('<I', r[72:76])[0]
                quat = struct.unpack('<4f', r[76:92])
                pos = struct.unpack('<3f', r[92:104])
                bones.append({'name': name, 'parent': parent,
                              'quat': quat, 'pos': pos})
            # psk convention: bone 0 with parent index 0 is the root;
            # any other bone with parent index 0 is a child of bone 0.
            if bones and bones[0]['parent'] == 0:
                bones[0]['parent'] = 0  # self == root marker
            out['bones'] = bones
        elif cid == 'RAWWEIGHTS':
            w = {}
            for i in range(count):
                weight, pi, bi = struct.unpack_from('<f2i', data,
                                                    off + i * size)
                w.setdefault(pi, []).append((bi, weight))
            out['weights'] = w
    if not out['points'] or not out['bones']:
        raise RuntimeError('%s: not a skeletal .psk (no points/bones)' % path)
    return out


def parse_psa(path):
    """-> (bone_names, anims). anims: {name: {'rate', 'frames'}} with
    frames[f][b] = ((px,py,pz),(qx,qy,qz,qw))."""
    data = open(path, 'rb').read()
    chunks = {cid: (size, count, off) for cid, size, count, off in _chunks(data)}

    size, count, off = chunks['BONENAMES']
    bones = [data[off + i * size:off + i * size + 64]
             .split(b'\0')[0].decode('latin1') for i in range(count)]

    size, count, off = chunks['ANIMINFO']
    infos = []
    for i in range(count):
        r = data[off + i * size:off + (i + 1) * size]
        name = r[:64].split(b'\0')[0].decode('latin1')
        total_bones = struct.unpack('<i', r[128:132])[0]
        key_quotum = struct.unpack('<i', r[140:144])[0]
        rate = struct.unpack('<f', r[152:156])[0]
        nframes = struct.unpack('<i', r[164:168])[0]
        infos.append((name, total_bones, key_quotum, rate, nframes))

    ksize, kcount, koff = chunks['ANIMKEYS']
    anims = {}
    base = 0
    nbones = len(bones)
    for name, total_bones, key_quotum, rate, nframes in infos:
        if total_bones != nbones:
            raise RuntimeError('%s: anim %s has %d bones, skeleton has %d'
                               % (path, name, total_bones, nbones))
        if nframes <= 0:
            nframes = key_quotum // nbones if nbones else 0
        frames = []
        for f in range(nframes):
            fr = []
            for b in range(nbones):
                k = base + f * nbones + b
                px, py, pz, qx, qy, qz, qw, _t = struct.unpack(
                    '<8f', data[koff + k * 32:koff + k * 32 + 32])
                fr.append(((px, py, pz), (qx, qy, qz, qw)))
            frames.append(fr)
        anims[name] = {'rate': rate, 'frames': frames}
        base += key_quotum
    return bones, anims


# ------------------------------------------------------------ skeleton merge

_HAIR_RE = re.compile(r'^hair\d+$', re.I)


def is_hair_only(part):
    """True when the part's skeleton is a standalone hair rig (no body
    bones at all), e.g. female _bh meshes with bones Hair01-13."""
    return all(_HAIR_RE.match(b['name']) for b in part['bones'])


def _pos_eq(a, b, eps=1e-3):
    return all(abs(x - y) <= eps for x, y in zip(a, b))


def _quat_eq(a, b, eps=1e-4):
    return (all(abs(x - y) <= eps for x, y in zip(a, b)) or
            all(abs(x + y) <= eps for x, y in zip(a, b)))


class CanonicalSkeleton:
    """Union of part skeletons. Identity = (parent identity, name, pose).

    bones: [{name, parent (canonical index; == own index for root),
             quat, pos}] in topological order (parent index < child).
    """

    def __init__(self):
        self.bones = []

    def add_part(self, part, part_label):
        """-> perm: part bone index -> canonical index."""
        src = part['bones']
        perm = [None] * len(src)
        for i, b in enumerate(src):
            if b['parent'] >= i and b['parent'] != i:
                raise RuntimeError(
                    '%s: bone %d (%s) parent %d not topological'
                    % (part_label, i, b['name'], b['parent']))
            cparent = None if b['parent'] == i else perm[b['parent']]
            if b['parent'] != i and cparent is None:
                raise RuntimeError('%s: internal permutation failure'
                                   % part_label)
            ci = self._match(b, cparent)
            if ci is None:
                ci = len(self.bones)
                self.bones.append({
                    'name': b['name'],
                    'parent': ci if cparent is None else cparent,
                    'quat': b['quat'], 'pos': b['pos'],
                })
            else:
                cb = self.bones[ci]
                if not (_pos_eq(cb['pos'], b['pos'], 0.5) and
                        _quat_eq(cb['quat'], b['quat'], 1e-2)):
                    # same bone identity (name + parent), slightly
                    # different authored bind pose in this part — the
                    # canonical pose (first part's) wins; the deviation
                    # is sub-centimeter authoring noise
                    dp = max(abs(x - y) for x, y in zip(cb['pos'], b['pos']))
                    print('  note: %s bone %s bind pose differs from '
                          'canonical by %.3f cm (identity by name+parent)'
                          % (part_label, b['name'], dp))
                if cb['name'].lower() != b['name'].lower():
                    print('  note: %s bone %d "%s" == canonical "%s" '
                          '(source-data rename, matched by parent+pose)'
                          % (part_label, i, b['name'], cb['name']))
            perm[i] = ci
        return perm

    def _match(self, b, cparent):
        """Bone identity = (parent identity, name); pose only breaks ties
        between same-named siblings (the Fighter.ukx duplicated
        'Bip01_L_Finger01' case has distinct parents, so pose is a
        fallback for even dirtier data, not the primary key)."""
        named = []
        pose_only = None
        for ci, cb in enumerate(self.bones):
            cb_parent = cb['parent'] if cb['parent'] != ci else None
            if cb_parent != cparent:
                continue
            if cb['name'].lower() == b['name'].lower():
                named.append(ci)
            elif pose_only is None and _pos_eq(cb['pos'], b['pos']) and \
                    _quat_eq(cb['quat'], b['quat']):
                pose_only = ci
        if len(named) == 1:
            return named[0]
        if len(named) > 1:
            for ci in named:
                cb = self.bones[ci]
                if _pos_eq(cb['pos'], b['pos']) and \
                        _quat_eq(cb['quat'], b['quat']):
                    return ci
            return named[0]
        return pose_only  # renamed bone (e.g. dup 'Bip01_L_Finger01')

    def root_indices(self):
        return [i for i, b in enumerate(self.bones) if b['parent'] == i]

    def head_index(self):
        for i, b in enumerate(self.bones):
            if b['name'].lower() == 'bip01_head':
                return i
        for i, b in enumerate(self.bones):
            if 'head' in b['name'].lower():
                return i
        raise RuntimeError('no head bone in canonical skeleton')


# ------------------------------------------------------------ math helpers

def _q_conj(q):
    return (-q[0], -q[1], -q[2], q[3])


def _q_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def _q_rot(q, v):
    # rotate vector v by quaternion q
    x, y, z, w = q
    ux, uy, uz = x, y, z
    vx, vy, vz = v
    # t = 2 * cross(u, v)
    tx = 2 * (uy * vz - uz * vy)
    ty = 2 * (uz * vx - ux * vz)
    tz = 2 * (ux * vy - uy * vx)
    return (vx + w * tx + (uy * tz - uz * ty),
            vy + w * ty + (uz * tx - ux * tz),
            vz + w * tz + (ux * ty - uy * tx))


def _tr_compose(pt, qt, pl, ql):
    """(world pos, world quat) of parent (pt,qt) x local (pl,ql)."""
    rx, ry, rz = _q_rot(qt, pl)
    return ((pt[0] + rx, pt[1] + ry, pt[2] + rz), _q_mul(qt, ql))


def _mat_from_tr(t, q):
    x, y, z, w = q
    rot = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    # column-major 4x4 (glTF layout)
    return [rot[0][0], rot[1][0], rot[2][0], 0.0,
            rot[0][1], rot[1][1], rot[2][1], 0.0,
            rot[0][2], rot[1][2], rot[2][2], 0.0,
            t[0], t[1], t[2], 1.0]


def _mat_inv_rigid(m):
    """Inverse of a rigid column-major 4x4 (rotation + translation)."""
    r = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]]
    rt = [[r[c][r_] for c in range(3)] for r_ in range(3)]  # transpose
    t = [m[12], m[13], m[14]]
    ti = [-sum(rt[r_][k] * t[k] for k in range(3)) for r_ in range(3)]
    return [rt[0][0], rt[1][0], rt[2][0], 0.0,
            rt[0][1], rt[1][1], rt[2][1], 0.0,
            rt[0][2], rt[1][2], rt[2][2], 0.0,
            ti[0], ti[1], ti[2], 1.0]


# UE -> glTF conversions, measured against the umodel binary's own glTF
# export (tools/bin/umodel -gltf; NOTE: the vendored UEViewer source's
# swap(y,z) convention does NOT match the binary — the binary uses the
# proper rotation S=(x,z,-y) with quaternion map (x,z,-y,-w), the root
# bone additionally conjugated; verified numerically bone-by-bone):
#   position: (x, z, -y), scale 0.01
#   direction: (x, z, -y)
#   rotation: (x, z, -y, -w); root bone: conjugated after conversion
#   inverse bind matrices: world bind transforms rebuilt from
#     conj(node rotation) locals, then inverted (as ExportGLTF does)
#   normals: angle-weighted, shared by wedge PointIndex (BuildNormalsCommon)
#   indices/UVs: emitted unchanged (no winding flip, no V flip)

def _xf_pos(p):
    return (p[0] * 0.01, p[2] * 0.01, -p[1] * 0.01)


def _xf_dir(v):
    return (v[0], v[2], -v[1])


def _xf_rot(q):
    return (q[0], q[2], -q[1], -q[3])


# ------------------------------------------------------------- glTF emitter

class GltfBuilder:
    def __init__(self):
        self.g = {'asset': {'version': '2.0',
                            'generator': 'l2vzla char_pipeline (psk full-skeleton)'},
                  'scene': 0, 'scenes': [{'nodes': []}],
                  'nodes': [], 'meshes': [], 'materials': [],
                  'skins': [], 'accessors': [], 'bufferViews': [],
                  'animations': []}
        self.bin = bytearray()

    def push(self, blob):
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        self.bin.extend(blob)
        self.g['bufferViews'].append(
            {'buffer': 0, 'byteOffset': off, 'byteLength': len(blob)})
        return len(self.g['bufferViews']) - 1

    def accessor(self, bv, ctype, count, atype, mn=None, mx=None):
        ac = {'bufferView': bv, 'componentType': ctype, 'count': count,
              'type': atype}
        if mn is not None:
            ac['min'] = mn
            ac['max'] = mx
        self.g['accessors'].append(ac)
        return len(self.g['accessors']) - 1

    def add_material(self, tex_uri, alpha_mode, name):
        mat = {'name': name,
               'pbrMetallicRoughness': {'metallicFactor': 0.0,
                                        'roughnessFactor': 0.9},
               'doubleSided': True}
        if tex_uri:
            self.g.setdefault('images', []).append({'uri': tex_uri})
            self.g.setdefault('samplers', []).append(
                {'magFilter': 9729, 'minFilter': 9987,
                 'wrapS': 10497, 'wrapT': 10497})
            self.g.setdefault('textures', []).append(
                {'source': len(self.g['images']) - 1,
                 'sampler': len(self.g['samplers']) - 1})
            mat['pbrMetallicRoughness']['baseColorTexture'] = {
                'index': len(self.g['textures']) - 1}
        else:
            mat['pbrMetallicRoughness']['baseColorFactor'] = \
                [0.7, 0.6, 0.55, 1.0]
        if alpha_mode:
            mat['alphaMode'] = alpha_mode
            if alpha_mode == 'MASK':
                mat['alphaCutoff'] = 0.5
        self.g['materials'].append(mat)
        return len(self.g['materials']) - 1


def _point_normals(points, wedges, faces):
    """Angle-weighted smooth normals shared by wedge PointIndex
    (mirrors UEViewer BuildNormalsCommon). UE coordinate space."""
    acc = [[0.0, 0.0, 0.0] for _ in points]
    for w0, w1, w2, _mi in faces:
        p0, p1, p2 = (points[wedges[w][0]] for w in (w0, w1, w2))
        d0 = [p1[i] - p0[i] for i in range(3)]
        d1 = [p2[i] - p1[i] for i in range(3)]
        d2 = [p0[i] - p2[i] for i in range(3)]
        n = [d1[1] * d0[2] - d1[2] * d0[1],
             d1[2] * d0[0] - d1[0] * d0[2],
             d1[0] * d0[1] - d1[1] * d0[0]]
        ln = math.sqrt(sum(c * c for c in n))
        if ln < 1e-12:
            continue
        n = [c / ln for c in n]
        ls = []
        for d in (d0, d1, d2):
            l = math.sqrt(sum(c * c for c in d))
            ls.append(max(l, 1e-12))
        d0 = [c / ls[0] for c in d0]
        d1 = [c / ls[1] for c in d1]
        d2 = [c / ls[2] for c in d2]

        def clamp(x):
            return -1.0 if x < -1.0 else (1.0 if x > 1.0 else x)
        a0 = math.acos(clamp(-sum(d0[i] * d2[i] for i in range(3))))
        a1 = math.acos(clamp(-sum(d0[i] * d1[i] for i in range(3))))
        a2 = math.acos(clamp(-sum(d1[i] * d2[i] for i in range(3))))
        for w, a in ((w0, a0), (w1, a1), (w2, a2)):
            pi = wedges[w][0]
            for i in range(3):
                acc[pi][i] += n[i] * a
    out = []
    for a in acc:
        l = math.sqrt(sum(c * c for c in a))
        if l < 1e-12:
            out.append((0.0, 0.0, 1.0))
        else:
            out.append((a[0] / l, a[1] / l, a[2] / l))
    return out


def merge_parts(parts, out_path):
    """parts: [{psk, name, sections: [{texture, alpha_mode}]}, ...] in
    canonical order (first non-hair part seeds the skeleton).

    -> (gltf dict, bin bytes, anim_context)
    anim_context = {'skeleton': CanonicalSkeleton,
                    'bone_node': [node idx per canonical bone],
                    'parts': [(part, perm) for non-hair parts]}
    """
    b = GltfBuilder()
    g = b.g
    parsed = []
    for p in parts:
        parsed.append((p, parse_psk(p['psk'])))

    skel = CanonicalSkeleton()
    perms = []  # per part: perm or None for hair-only
    for p, data in parsed:
        if is_hair_only(data):
            print('  %s: standalone hair rig (%d bones) -> rigid head bind'
                  % (p['name'], len(data['bones'])))
            perms.append(None)
        else:
            perms.append(skel.add_part(data, p['name']))

    roots = skel.root_indices()
    if not roots:
        raise RuntimeError('canonical skeleton has no root')

    # ---- bone nodes (canonical order; node index == canonical index)
    for ci, cb in enumerate(skel.bones):
        t = _xf_pos(cb['pos'])
        q = _xf_rot(cb['quat'])
        if cb['parent'] == ci:      # root bone: conjugate (ExportGLTF)
            q = _q_conj(q)
        node = {'name': cb['name'], 'translation': list(t),
                'rotation': list(q)}
        g['nodes'].append(node)
    for ci, cb in enumerate(skel.bones):
        if cb['parent'] != ci:
            g['nodes'][cb['parent']].setdefault('children', []).append(ci)
    for r in roots:
        g['scenes'][0]['nodes'].append(r)

    # ---- inverse bind matrices: IBM = inverse(node world bind
    # transform) (verified against the umodel binary: 70/70 IBMs equal
    # inverse(node world)).  Skin 0 uses the canonical skeleton's bind
    # pose; each body part additionally gets its OWN skin with IBMs from
    # its OWN psk bind pose — some parts author a few bones slightly
    # (or 90 degrees, e.g. MDarkElf gloves' Dummy02) differently, and
    # their vertices are bound in that part's frame.  Joints (the shared
    # node hierarchy, driven by the shared animations) are identical
    # across skins; only the bind matrices differ.
    world = [None] * len(skel.bones)
    for ci, cb in enumerate(skel.bones):
        t = _xf_pos(cb['pos'])
        q = _xf_rot(cb['quat'])
        if cb['parent'] == ci:
            world[ci] = (t, _q_conj(q))    # root node rotation (as written)
        else:
            world[ci] = _tr_compose(world[cb['parent']][0],
                                    world[cb['parent']][1], t, q)
    canon_ibm = []
    ibm_blob = bytearray()
    for ci in range(len(skel.bones)):
        m = _mat_inv_rigid(_mat_from_tr(*world[ci]))
        canon_ibm.append(m)
        ibm_blob += struct.pack('<16f', *m)
    ibm_acc = b.accessor(b.push(bytes(ibm_blob)), 5126,
                         len(skel.bones), 'MAT4')
    g['skins'].append({'inverseBindMatrices': ibm_acc,
                       'skeleton': roots[0],
                       'joints': list(range(len(skel.bones)))})
    head_ci = None

    def part_skin(data, perm):
        """Per-part skin: IBMs from the part's own psk bind pose."""
        src = data['bones']
        pworld = [None] * len(src)
        for i, bb in enumerate(src):
            t = _xf_pos(bb['pos'])
            q = _xf_rot(bb['quat'])
            if bb['parent'] == i:
                pworld[i] = (t, _q_conj(q))
            else:
                pworld[i] = _tr_compose(pworld[bb['parent']][0],
                                        pworld[bb['parent']][1], t, q)
        blob = bytearray()
        for ci in range(len(skel.bones)):
            blob += struct.pack('<16f', *canon_ibm[ci])
        for i, ci in enumerate(perm):
            m = _mat_inv_rigid(_mat_from_tr(*pworld[i]))
            struct.pack_into('<16f', blob, ci * 64, *m)
        acc = b.accessor(b.push(bytes(blob)), 5126,
                         len(skel.bones), 'MAT4')
        g['skins'].append({'inverseBindMatrices': acc,
                           'skeleton': roots[0],
                           'joints': list(range(len(skel.bones)))})
        return len(g['skins']) - 1

    # ---- meshes
    if head_ci is None:
        head_ci = skel.head_index()
    head_bind = world[head_ci][0]
    anchored = {'verts': 0}
    for (p, data), perm in zip(parsed, perms):
        points, wedges, faces = data['points'], data['wedges'], data['faces']
        weights = data['weights']
        hair = perm is None
        # head-region part (face / front / back hair): source data often
        # weights these meshes 100% to the ROOT bone, so the face/hair
        # shell pivots around the pelvis while the body neck follows the
        # spine chain -> the head detaches under any pose that leans the
        # spine (verified: 23 of 34 face/hair parts fully root-weighted;
        # FFighter/FMagic/MMagic faces are head-weighted in the source,
        # i.e. anchoring to the head is what the artists intended).
        # Re-anchor root-weighted verts near the head to the head bone.
        # Bind pose is bit-identical either way (identity skinning).
        lname = p['name'].lower()
        head_part = lname.endswith(('_f', '_ah', '_bh'))
        normals = _point_normals(points, wedges, faces)

        # per-vertex joint/weight tuples (keyed by wedge point)
        def vert_skin(pi):
            if hair:
                return ((head_ci, 0, 0, 0), (1.0, 0.0, 0.0, 0.0))
            inf = sorted(weights.get(pi, []), key=lambda x: -x[1])[:4]
            if not inf:
                # unweighted vertex: bind rigidly to the root bone
                inf = [(0, 1.0)]
            total = sum(w for _b, w in inf) or 1.0
            jj = [perm[bi] for bi, _w in inf]
            ww = [w / total for _bi, w in inf]
            if head_part and 0 in jj and math.dist(
                    points[pi],
                    (head_bind[0] * 100, -head_bind[2] * 100,
                     head_bind[1] * 100)) < 15.0:
                jj = [head_ci if j == 0 else j for j in jj]
                anchored['verts'] += 1
            while len(jj) < 4:
                jj.append(0)
                ww.append(0.0)
            return tuple(jj), tuple(ww)

        nsec = max(1, len(data['materials']))
        sec_faces = [[] for _ in range(nsec)]
        for f in faces:
            mi = f[3] if f[3] < nsec else 0
            sec_faces[mi].append(f)

        prims = []
        for si, sfaces in enumerate(sec_faces):
            if not sfaces:
                continue
            # dedupe wedges used by this section
            vmap = {}
            order = []

            def vidx(w):
                if w not in vmap:
                    vmap[w] = len(order)
                    order.append(w)
                return vmap[w]

            iblob = bytearray()
            for w0, w1, w2, _mi in sfaces:
                for v in (vidx(w0), vidx(w1), vidx(w2)):
                    iblob += struct.pack('<I', v)
            pos_b = bytearray()
            nrm_b = bytearray()
            uv_b = bytearray()
            jnt_b = bytearray()
            wgt_b = bytearray()
            mins = [1e30] * 3
            maxs = [-1e30] * 3
            for w in order:
                pi, u, v = wedges[w]
                tp = _xf_pos(points[pi])
                for i in range(3):
                    mins[i] = min(mins[i], tp[i])
                    maxs[i] = max(maxs[i], tp[i])
                pos_b += struct.pack('<3f', *tp)
                nrm_b += struct.pack('<3f', *_xf_dir(normals[pi]))
                uv_b += struct.pack('<2f', u, v)
                jj, ww = vert_skin(pi)
                jnt_b += struct.pack('<4H', *jj)
                wgt_b += struct.pack('<4f', *ww)
            attrs = {
                'POSITION': b.accessor(b.push(bytes(pos_b)), 5126,
                                       len(order), 'VEC3',
                                       mn=mins, mx=maxs),
                'NORMAL': b.accessor(b.push(bytes(nrm_b)), 5126,
                                     len(order), 'VEC3'),
                'TEXCOORD_0': b.accessor(b.push(bytes(uv_b)), 5126,
                                         len(order), 'VEC2'),
                'JOINTS_0': b.accessor(b.push(bytes(jnt_b)), 5123,
                                       len(order), 'VEC4'),
                'WEIGHTS_0': b.accessor(b.push(bytes(wgt_b)), 5126,
                                        len(order), 'VEC4'),
            }
            prim = {'attributes': attrs, 'mode': 4,
                    'indices': b.accessor(b.push(bytes(iblob)), 5125,
                                          len(sfaces) * 3, 'SCALAR')}
            sec = (p.get('sections') or [{}])[min(
                si, len(p.get('sections') or [{}]) - 1)]
            mat_name = data['materials'][si] if si < len(
                data['materials']) else p['name']
            prim['material'] = b.add_material(
                sec.get('texture'), sec.get('alpha_mode'),
                '%s:%s' % (p['name'], mat_name))
            prims.append(prim)
        if not prims:
            print('  WARNING: %s has no faces' % p['name'])
            continue
        skin_idx = 0 if hair else part_skin(data, perm)
        g['meshes'].append({'name': p['name'], 'primitives': prims})
        node_idx = len(g['nodes'])
        g['nodes'].append({'name': p['name'],
                           'mesh': len(g['meshes']) - 1, 'skin': skin_idx})
        g['scenes'][0]['nodes'].append(node_idx)

    bin_data = bytes(b.bin)
    if anchored['verts']:
        print('  head-anchored %d root-weighted verts to the head bone'
              % anchored['verts'])
    g['buffers'] = [{'uri': out_path.rsplit('/', 1)[-1].replace(
        '.gltf', '.bin'), 'byteLength': len(bin_data)}]
    ctx = {'skeleton': skel,
           'bone_node': list(range(len(skel.bones))),
           'parts': [(data, perm) for (p, data), perm in zip(parsed, perms)
                     if perm is not None]}
    return g, bin_data, ctx


# -------------------------------------------------------- animation injection

def inject_animations(g, bin_data, psa_path, selection, ctx):
    """selection: {gltf_anim_name: psa_anim_name}. Mutates g, returns bin.

    psa bone order is matched to a part skeleton with a 100% positional
    name agreement (verified against the data at build time), then passed
    through that part's structural permutation — so the duplicated
    'Bip01_L_Finger01' in MFighter_anim lands on the RIGHT finger bone it
    actually animates (position 27), not on the left one its name claims.
    """
    bin_data = bytearray(bin_data)
    bones, anims = parse_psa(psa_path)
    skel = ctx['skeleton']

    ref_perm = None
    best = -1
    for data, perm in ctx['parts']:
        names = [bn['name'].lower() for bn in data['bones']]
        if len(names) != len(bones):
            agree = sum(1 for a, b in zip(names, bones)
                        if a == b.lower())
        else:
            agree = sum(1 for a, b in zip(names, bones)
                        if a == b.lower())
            if agree == len(bones):
                ref_perm = perm
                break
        if agree > best:
            best = agree
    if ref_perm is None:
        # fallback: match psa bones to canonical bones by normalized name
        # with occurrence order (monster packages often carry a different
        # bone ORDER or extra attachment bones vs the mesh REFSKELT).
        # Names are normalized (strip non-alphanumerics) so 'Bip01 Pelvis'
        # == 'Bip01_Pelvis'.  Unmatched psa bones are skipped, loudly.
        def norm_name(s):
            return re.sub(r'[^a-z0-9]', '', s.lower())
        queues = {}
        for ci, cb in enumerate(skel.bones):
            queues.setdefault(norm_name(cb['name']), []).append(ci)
        used = {k: 0 for k in queues}
        bone_node = []
        skipped = []
        for bname in bones:
            k = norm_name(bname)
            q = queues.get(k)
            if q and used[k] < len(q):
                bone_node.append(ctx['bone_node'][q[used[k]]])
                used[k] += 1
            else:
                bone_node.append(None)
                skipped.append(bname)
        matched = sum(1 for x in bone_node if x is not None)
        print('  note: psa bone map by name-occurrence: %d/%d bones matched'
              % (matched, len(bones)) +
              ('; skipped (not in mesh skeleton): %s'
               % ', '.join(skipped) if skipped else ''))
        if matched * 2 < len(bones):
            raise RuntimeError(
                '%s: psa bone map by name matched only %d/%d bones; '
                'refusing to guess' % (psa_path, matched, len(bones)))
    else:
        bone_node = [ctx['bone_node'][ref_perm[i]] for i in range(len(bones))]
    root_nodes = set(ctx['bone_node'][ci] for ci in skel.root_indices())

    def push(blob):
        while len(bin_data) % 4:
            bin_data.append(0)
        off = len(bin_data)
        bin_data.extend(blob)
        g['bufferViews'].append({'buffer': 0, 'byteOffset': off,
                                 'byteLength': len(blob)})
        return len(g['bufferViews']) - 1

    def add_accessor(bv, ctype, count, atype, mn=None, mx=None):
        ac = {'bufferView': bv, 'componentType': ctype, 'count': count,
              'type': atype}
        if mn is not None:
            ac['min'] = mn
            ac['max'] = mx
        g['accessors'].append(ac)
        return len(g['accessors']) - 1

    g.setdefault('animations', [])
    for out_name, psa_name in selection.items():
        if psa_name not in anims:
            print('  WARNING: anim %s not in psa' % psa_name,
                  file=sys.stderr)
            continue
        anim = anims[psa_name]
        frames = anim['frames']
        rate = anim['rate'] if anim['rate'] > 0.001 else 1.0
        nframes = len(frames)
        times = [f / rate for f in range(nframes)]
        tblob = struct.pack('<%df' % nframes, *times)
        tacc = add_accessor(push(tblob), 5126, nframes, 'SCALAR',
                            mn=[times[0]], mx=[times[-1]])
        channels = []
        samplers = []
        for bi, node_idx in enumerate(bone_node):
            if node_idx is None:
                continue
            pos_blob = bytearray()
            rot_blob = bytearray()
            for fr in frames:
                (px, py, pz), (qx, qy, qz, qw) = fr[bi]
                # TransformPosition: (x, z, -y), scale 0.01
                pos_blob += struct.pack('<3f', px * 0.01, pz * 0.01,
                                        -py * 0.01)
                # TransformRotation: (x, z, -y, -w)
                rx, ry, rz, rw = qx, qz, -qy, -qw
                if node_idx in root_nodes:
                    # root bone: conjugated after conversion
                    rx, ry, rz = -rx, -ry, -rz
                rot_blob += struct.pack('<4f', rx, ry, rz, rw)
            pacc = add_accessor(push(bytes(pos_blob)), 5126, nframes,
                                'VEC3')
            racc = add_accessor(push(bytes(rot_blob)), 5126, nframes,
                                'VEC4')
            samplers.append({'input': tacc, 'output': pacc,
                             'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers) - 1,
                             'target': {'node': node_idx,
                                        'path': 'translation'}})
            samplers.append({'input': tacc, 'output': racc,
                             'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers) - 1,
                             'target': {'node': node_idx,
                                        'path': 'rotation'}})
        g['animations'].append({'name': out_name, 'channels': channels,
                                'samplers': samplers})
    g['buffers'][0]['byteLength'] = len(bin_data)
    return bytes(bin_data)


if __name__ == '__main__':
    # CLI: assemble.py --out out.gltf --part mesh.psk:tex.png[:MASK] ... \
    #        --psa anim.psa --anim idle=Wait_Hand_X --anim run=Run_Hand_X
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--part', action='append', required=True)
    ap.add_argument('--psa')
    ap.add_argument('--anim', action='append', default=[])
    a = ap.parse_args()

    parts = []
    for p in a.part:
        fields = p.split(':')
        parts.append({'psk': fields[0],
                      'name': fields[0].rsplit('/', 1)[-1]
                      .replace('.psk', ''),
                      'sections': [{
                          'texture': fields[1] if fields[1] != '-' else None,
                          'alpha_mode': fields[2] if len(fields) > 2
                          else None}]})
    g, bin_data, ctx = merge_parts(parts, a.out)
    if a.psa and a.anim:
        sel = dict(x.split('=', 1) for x in a.anim)
        bin_data = inject_animations(g, bin_data, a.psa, sel, ctx)
    g['buffers'][0]['byteLength'] = len(bin_data)
    with open(a.out, 'w') as f:
        json.dump(g, f)
    with open(a.out.replace('.gltf', '.bin'), 'wb') as f:
        f.write(bin_data)
    print('wrote', a.out,
          'anims:', [x['name'] for x in g.get('animations', [])])
