#!/usr/bin/env python3
"""Measure native L2 heights for all character + monster models.

nativeHeight (L2 world units) = glTF bind-space Y extent * 100 *
ULodMesh.MeshScale.z  (glTF positions are raw psk points in the
(x, z, -y)*0.01 convention; the engine additionally applies MeshScale
at instance time — verified in UEViewer SkelMeshInstance.cpp:194).

Cross-validates against aCis npc templates (collision radius/height)
via npcgrp npcId -> mesh_name.

Writes editor/characters/scale-report.json.
"""
import json
import os
import re
import struct
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
sys.path.insert(0, os.path.join(ROOT, 'tools/l2lib'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ue2package as up
import build_monsters as bm

CHARS = os.path.join(ROOT, 'editor/characters')
MON = os.path.join(CHARS, 'monsters')

_PKG_CACHE = {}


def load_ukx(pkg):
    if pkg not in _PKG_CACHE:
        p, _ = up.load_package(
            os.path.join(ROOT, 'assets/interlude/animations/%s.ukx' % pkg))
        _PKG_CACHE[pkg] = p
    return _PKG_CACHE[pkg]


def mesh_scale(pkg, mesh_name):
    p = load_ukx(pkg)
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


def acc(g, b, idx):
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
                for p in acc(g, b, prim['attributes']['POSITION']):
                    lo = min(lo, p[1])
                    hi = max(hi, p[1])
    return hi - lo


def npcgrp_by_mesh():
    data = json.load(open(os.path.join(ROOT, 'assets/gamedata/npcgrp.json')))
    out = {}
    for r in data:
        mn = r.get('mesh_name', '')
        if '.' in mn:
            out.setdefault(mn.split('.', 1)[1].lower(), []).append(r['npc_id'])
    return out


def acis_collisions():
    """npcId -> (radius, height) from aCis npc templates
    (<set name="radius"/"height" val="..."/>)."""
    out = {}
    npc_dir = os.path.join(ROOT, 'server/aCis_datapack/data/xml/npcs')
    for fn in os.listdir(npc_dir):
        if not fn.endswith('.xml'):
            continue
        try:
            tree = ET.parse(os.path.join(npc_dir, fn))
        except ET.ParseError:
            continue
        for npc in tree.iter('npc'):
            nid = npc.get('id')
            vals = {}
            for s in npc.iter('set'):
                if s.get('name') in ('radius', 'height'):
                    vals[s.get('name')] = float(s.get('val'))
            if nid and 'radius' in vals and 'height' in vals:
                out[int(nid)] = (vals['radius'], vals['height'])
    return out


CHAR_PKGS = {
    'human_fighter_m': ('Fighter', 'MFighter_m001_u'),
    'human_fighter_f': ('Fighter', 'FFighter_m001_u'),
    'human_mystic_m': ('Magic', 'MMagic_M005_u'),
    'human_mystic_f': ('Magic', 'FMagic_m003_u'),
    'elf_m': ('Elf', 'MElf_m001_u'),
    'elf_f': ('Elf', 'FElf_m001_u'),
    'darkelf_m': ('DarkElf', 'MDarkElf_m001_u'),
    'darkelf_f': ('DarkElf', 'FDarkElf_m001_u'),
    'orc_fighter_m': ('Orc', 'MOrc_m001_u'),
    'orc_fighter_f': ('Orc', 'FOrc_m001_u'),
    'orc_mystic_m': ('Shaman', 'MShaman_m001_u'),
    'orc_mystic_f': ('Shaman', 'FShaman_m001_u'),
    'dwarf_m': ('Dwarf', 'MDwarf_m001_u'),
    'dwarf_f': ('Dwarf', 'FDwarf_m001_u'),
}


def main():
    by_mesh = npcgrp_by_mesh()
    colls = acis_collisions()
    report = {'models': {}, 'notes': []}

    print('== player characters ==')
    char_manifest = json.load(open(os.path.join(CHARS, 'manifest.json')))
    for cid, (pkg, mesh) in sorted(CHAR_PKGS.items()):
        ext = gltf_y_extent(os.path.join(CHARS, 'models', cid + '.gltf'))
        sc = mesh_scale(pkg, mesh) or (1.0, 1.0, 1.0)
        native = ext * 100 * sc[2]
        report['models'][cid] = {
            'kind': 'character', 'package': pkg, 'mesh': mesh,
            'gltfExtent': round(ext, 4), 'meshScale': round(sc[2], 4),
            'nativeHeight': round(native, 1),
        }
        for entry in char_manifest['models']:
            if entry['id'] == cid:
                entry['nativeHeight'] = round(native, 1)
        print('%-18s extent %.4f scale %.2f -> native %.1f'
              % (cid, ext, sc[2], native))
    with open(os.path.join(CHARS, 'manifest.json'), 'w') as f:
        json.dump(char_manifest, f, indent=2)

    print('\n== monsters/NPCs ==')
    man = json.load(open(os.path.join(MON, 'manifest.json')))
    for m in man['models']:
        mid = m['id']
        pkg = bm.NPC_PKG if mid in bm.NPCS else bm.MONSTER_PKG
        ext = gltf_y_extent(os.path.join(MON, 'models', mid + '.gltf'))
        sc = mesh_scale(pkg, mid) or (1.0, 1.0, 1.0)
        native = ext * 100 * sc[2]
        ids = by_mesh.get(mid.lower(), [])
        col = [(i, colls[i]) for i in ids if i in colls]
        entry = {'kind': 'npc' if mid in bm.NPCS else 'monster',
                 'package': pkg, 'mesh': mid,
                 'gltfExtent': round(ext, 4), 'meshScale': round(sc[2], 4),
                 'nativeHeight': round(native, 1)}
        if col:
            hs = [c[1][1] for c in col]
            rs = [c[1][0] for c in col]
            entry['npcIds'] = ids[:6]
            entry['collisionHeight'] = round(sum(hs) / len(hs), 1)
            entry['collisionRadius'] = round(sum(rs) / len(rs), 1)
            entry['collisionHeightRatio'] = round(
                (sum(hs) / len(hs)) / native, 3) if native else None
        report['models'][mid] = entry
        m['nativeHeight'] = round(native, 1)
        print('%-34s extent %.4f scale %.2f -> native %6.1f  collision %s'
              % (mid, ext, sc[2], native,
                 'h=%.1f r=%.1f (%.2f)' % (
                     entry['collisionHeight'], entry['collisionRadius'],
                     entry['collisionHeightRatio']) if col else 'n/a'))
    with open(os.path.join(MON, 'manifest.json'), 'w') as f:
        json.dump(man, f, indent=2)

    report['scale'] = {
        'unit': 'L2 world unit (== source psk cm, as used by the L2 client '
                'and geodata; 1 geodata cell = 16 units)',
        'worldToMeters': 0.01,
        'anchorHumanMale': report['models']['human_fighter_m']['nativeHeight'],
        'modelScaleFormula': 'scale = nativeHeight * 0.01 / gltfBindExtent '
                             '(gltf units); == meshScale * 0.01 for this '
                             'pipeline since gltf extent*100 == raw units',
        'collisionConvention': 'aCis/retail collision height ~= 0.4-0.55 x '
                               'visual nativeHeight (flying creatures bigger)',
        'propCalibration': '17_25 props measured in the same units: '
                           'H_Door_MV_01 = 80.0 tall, O_Fence01 = 50.0, '
                           'SI_Fighter_torchlight = 90.0; human male 46.0 '
                           '(57% of door height), elf guard 49.5',
    }
    out = os.path.join(CHARS, 'scale-report.json')
    with open(out, 'w') as f:
        json.dump(report, f, indent=2)
    print('\nwrote', out, '+ nativeHeight merged into both manifests')

    print('== player characters ==')
    for cid, (pkg, mesh) in sorted(CHAR_PKGS.items()):
        ext = gltf_y_extent(os.path.join(CHARS, 'models', cid + '.gltf'))
        sc = mesh_scale(pkg, mesh) or (1.0, 1.0, 1.0)
        native = ext * 100 * sc[2]
        report['models'][cid] = {
            'kind': 'character', 'package': pkg, 'mesh': mesh,
            'gltfExtent': round(ext, 4), 'meshScale': round(sc[2], 4),
            'nativeHeight': round(native, 1),
        }
        print('%-18s extent %.4f scale %.2f -> native %.1f'
              % (cid, ext, sc[2], native))

    print('\n== monsters/NPCs ==')
    man = json.load(open(os.path.join(MON, 'manifest.json')))
    for m in man['models']:
        mid = m['id']
        pkg = bm.NPC_PKG if mid in bm.NPCS else bm.MONSTER_PKG
        ext = gltf_y_extent(os.path.join(MON, 'models', mid + '.gltf'))
        sc = mesh_scale(pkg, mid) or (1.0, 1.0, 1.0)
        native = ext * 100 * sc[2]
        ids = by_mesh.get(mid.lower(), [])
        col = [(i, colls[i]) for i in ids if i in colls]
        entry = {'kind': 'npc' if mid in bm.NPCS else 'monster',
                 'package': pkg, 'mesh': mid,
                 'gltfExtent': round(ext, 4), 'meshScale': round(sc[2], 4),
                 'nativeHeight': round(native, 1)}
        if col:
            hs = [c[1][1] for c in col]
            rs = [c[1][0] for c in col]
            entry['npcIds'] = ids[:6]
            entry['collisionHeight'] = round(sum(hs) / len(hs), 1)
            entry['collisionRadius'] = round(sum(rs) / len(rs), 1)
            entry['collisionHeightRatio'] = round(
                (sum(hs) / len(hs)) / native, 3) if native else None
        report['models'][mid] = entry
        print('%-34s extent %.4f scale %.2f -> native %6.1f  collision %s'
              % (mid, ext, sc[2], native,
                 'h=%.1f r=%.1f (%.2f)' % (
                     entry['collisionHeight'], entry['collisionRadius'],
                     entry['collisionHeightRatio']) if col else 'n/a'))

    out = os.path.join(CHARS, 'scale-report.json')
    with open(out, 'w') as f:
        json.dump(report, f, indent=2)
    print('\nwrote', out, '+ nativeHeight merged into both manifests')


if __name__ == '__main__':
    main()
