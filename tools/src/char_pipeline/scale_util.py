#!/usr/bin/env python3
"""Shared native-scale decoding for the character/monster pipelines.

nativeHeight (L2 world units) = glTF bind-space Y extent * 100 *
ULodMesh.MeshScale.z  (glTF positions are raw psk points in the
(x, z, -y)*0.01 convention; the engine additionally applies MeshScale
at instance time — verified in UEViewer SkelMeshInstance.cpp:194).

Used by build_characters.py (writes nativeHeight into the manifest at
build time) and measure_scale.py (fleet-wide report + manifest merge).
"""
import json
import os
import struct
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
sys.path.insert(0, os.path.join(ROOT, 'tools/l2lib'))
import ue2package as up

_PKG_CACHE = {}


def load_ukx_path(path):
    if path not in _PKG_CACHE:
        p, _ = up.load_package(path)
        _PKG_CACHE[path] = p
    return _PKG_CACHE[path]


def mesh_scale(pkg_path, mesh_name):
    """ULodMesh.MeshScale (x, y, z) decoded from the .ukx export."""
    p = load_ukx_path(pkg_path)
    ex = p.find_export(mesh_name)
    if ex is None:
        return None
    r = p.body_reader(ex)
    up.read_properties(p, r)
    r.pos += 25 + 16
    r.i32()
    r.i32()
    n = r.compact()
    r.pos += 4 * n
    ntex = r.compact()
    for _ in range(ntex):
        r.compact()
    return (r.f32(), r.f32(), r.f32())


def _acc(g, b, idx):
    a = g['accessors'][idx]
    bv = g['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    return [struct.unpack_from('<%df' % n, b, off + k * n * 4)
            for k in range(a['count'])]


def gltf_y_extent(path):
    """max over POSITION accessors of (max.y - min.y), gltf units."""
    g = json.load(open(path))
    b = open(path.replace('.gltf', '.bin'), 'rb').read()
    lo = 1e30
    hi = -1e30
    for mesh in g['meshes']:
        for prim in mesh['primitives']:
            a = g['accessors'][prim['attributes']['POSITION']]
            if 'min' in a and 'max' in a:
                lo = min(lo, a['min'][1])
                hi = max(hi, a['max'][1])
            else:
                for p in _acc(g, b, prim['attributes']['POSITION']):
                    lo = min(lo, p[1])
                    hi = max(hi, p[1])
    return hi - lo


def native_height(gltf_path, pkg_path, mesh_name):
    """True in-world height in L2 units, or None when undecodable."""
    ext = gltf_y_extent(gltf_path)
    sc = mesh_scale(pkg_path, mesh_name) or (1.0, 1.0, 1.0)
    if ext <= 0:
        return None
    return round(ext * 100 * sc[2], 1)
