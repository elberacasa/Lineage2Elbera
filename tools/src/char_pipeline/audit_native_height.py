#!/usr/bin/env python3
"""Re-runnable gate for `nativeHeight` - closes foundation-audit F5.

F5 asked why the manifest's `nativeHeight` sits 5-9% under twice the
server's collision height, "consistently".  It is not consistent (the ratio
runs 0.907..0.999 over the 14 pawns), and the two numbers are not measuring
the same thing.  What the retail client actually does, decoded from
`System/*.u`:

    rendered height = mesh Z extent  x  ULodMesh.MeshScale.z  x  Actor.DrawScale

`Engine.Actor` defaults DrawScale to 1.0 and **not one of the 14 player pawn
classes overrides it**, so for characters `nativeHeight` (extent x MeshScale)
IS the rendered height and needs no correction.  `CollisionHeight` is the
Unreal collision *cylinder* half-height (`Engine.Actor` 22, `Engine.Pawn`
78, overridden per Lineage class) - an authored bound, not a measurement.

344 NPC/monster classes DO override DrawScale, and that is a real gap: the
monster manifest's `nativeHeight` omits it.

Checks (all sourced, none guessed):

  A. every retail player pawn class carries no DrawScale override
     -> `nativeHeight` is authoritative for characters
  B. aCis `data/xml/classes/*.xml` height/radius == the client's
     CollisionHeight/CollisionRadius (one known aCis deviation, allow-listed)
  C. the shipped `nativeHeight` reproduces an independent re-measurement of
     the retail pawn's own default mesh set (Mesh + SubMeshes from the .u),
     measured off umodel .psk points x MeshScale
  D. DrawScale is what the retail size actually keys on: over meshes shared
     by classes with different DrawScale, CollisionHeight ratio ==
     DrawScale ratio.  This is the whole argument for D in one number and it
     uses no mesh measurement at all.

Usage:
  audit_native_height.py                 full report
  audit_native_height.py --check         same, exit 1 on any regression
  audit_native_height.py --no-mesh       skip check C (skips umodel exports)
  audit_native_height.py --props         the third, independent yardstick:
                                         retail weapon lengths and staticmesh
                                         sizes in raw L2 units, plus stair
                                         riser heights measured off tread
                                         geometry
  audit_native_height.py --emit-npc-scale
                                         write editor/characters/monsters/
                                         npc-scale.json (per-npcId DrawScale)
"""
import glob
import json
import math
import os
import statistics
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
sys.path.insert(0, os.path.join(ROOT, 'tools/l2lib'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import assemble
import scale_util
import uclass_defaults as ucd

CLIENT = os.path.join(ROOT, 'assets/interlude')
UMODEL = os.path.join(ROOT, 'tools/bin/umodel')
STAGE = '/tmp/l2scale_stage'
CHARS = os.path.join(ROOT, 'editor/characters')

# The 14 retail player pawn classes -> the manifest id built from each.
# CharClassID in the class defaults ties MFighter..FDwarf to the base class
# ids the server uses; the mapping below is that, spelled out.
PAWN_TO_MODEL = {
    'MFighter': 'human_fighter_m', 'FFighter': 'human_fighter_f',
    'MMagic': 'human_mystic_m', 'FMagic': 'human_mystic_f',
    'MElf': 'elf_m', 'FElf': 'elf_f',
    'MDarkElf': 'darkelf_m', 'FDarkElf': 'darkelf_f',
    'MOrc': 'orc_fighter_m', 'FOrc': 'orc_fighter_f',
    'MShaman': 'orc_mystic_m', 'FShaman': 'orc_mystic_f',
    'MDwarf': 'dwarf_m', 'FDwarf': 'dwarf_f',
}
# object-package name in the .u -> .ukx file under assets/interlude/animations
UKX = {'orc': 'Orc', 'shaman': 'Shaman', 'magic': 'Magic', 'dwarf': 'Dwarf',
       'darkelf': 'DarkElf', 'elf': 'Elf', 'fighter': 'Fighter'}
# aCis class xml -> (male pawn, female pawn)
CLASS_XML = {
    'humanFighter.xml': ('MFighter', 'FFighter'),
    'humanMystic.xml': ('MMagic', 'FMagic'),
    'elvenFighter.xml': ('MElf', 'FElf'),
    'elvenMystic.xml': ('MElf', 'FElf'),
    'darkFighter.xml': ('MDarkElf', 'FDarkElf'),
    'darkMystic.xml': ('MDarkElf', 'FDarkElf'),
    'orcFighter.xml': ('MOrc', 'FOrc'),
    'orcMystic.xml': ('MShaman', 'FShaman'),
    'dwarfFighter.xml': ('MDwarf', 'FDwarf'),
}
# Known aCis datapack deviations from the retail client, recorded so a NEW
# drift fails the gate while this one only prints.  Measured 2026-08-08.
KNOWN_ACIS_DEVIATIONS = {
    ('orcMystic.xml', 'height'): (27.5, 27.0),   # aCis 27.5, client MShaman 27.0
}
NPC_SCRIPT_PACKAGES = ['LineageMonster.u', 'LineageMonster2.u',
                       'LineageMonster3.u', 'LineageNpc.u', 'LineageNpc2.u',
                       'LineageNpcEv.u', 'LineageWarrior.u',
                       'LineageVehicle.u', 'LineageDeco.u']


def load_manifest(path):
    return {m['id']: m for m in json.load(open(path))['models']}


# ------------------------------------------------------------------ A + B

def pawns():
    return ucd.package_classes('LineageWarrior.u')


def check_pawn_drawscale(pw, fails):
    print('== A. retail player pawn DrawScale (Engine.Actor default 1.0)')
    bad = [n for n in PAWN_TO_MODEL if pw.get(n, {}).get('drawScale') is not None]
    for n in sorted(PAWN_TO_MODEL):
        if n not in pw:
            fails.append('pawn class %s missing from LineageWarrior.u' % n)
    if bad:
        fails.append('pawn classes override DrawScale: %s - nativeHeight '
                     'must be multiplied by it' % ', '.join(sorted(bad)))
        print('   FAIL: %s carry an explicit DrawScale' % ', '.join(sorted(bad)))
    else:
        print('   %d/%d pawn classes carry no DrawScale -> DrawScale = 1.0, '
              'so nativeHeight = mesh extent x MeshScale is the rendered height'
              % (len(PAWN_TO_MODEL), len(PAWN_TO_MODEL)))


def check_acis_classes(pw, fails):
    print('== B. aCis data/xml/classes vs the retail client class defaults')
    xdir = os.path.join(ROOT, 'server/aCis_datapack/data/xml/classes')
    seen = 0
    match = 0
    deviations = []
    for fn, (male, female) in sorted(CLASS_XML.items()):
        p = os.path.join(xdir, fn)
        if not os.path.isfile(p):
            fails.append('missing %s' % p)
            continue
        root = ET.parse(p).getroot()
        vals = {}
        for s in root.iter('set'):
            for k in ('radius', 'radiusFemale', 'height', 'heightFemale'):
                if s.get(k) is not None:
                    vals[k] = float(s.get(k))
        pairs = [('height', male, 'collisionHeight'),
                 ('heightFemale', female, 'collisionHeight'),
                 ('radius', male, 'collisionRadius'),
                 ('radiusFemale', female, 'collisionRadius')]
        for key, cls, field in pairs:
            if key not in vals or cls not in pw:
                continue
            seen += 1
            got, want = vals[key], pw[cls][field]
            if want is not None and abs(got - want) < 1e-6:
                match += 1
            else:
                deviations.append((fn, key, cls, got, want))
    print('   %d/%d aCis values equal the client value' % (match, seen))
    for fn, key, cls, got, want in deviations:
        known = KNOWN_ACIS_DEVIATIONS.get((fn, key.replace('Female', '')))
        tag = 'KNOWN' if known and abs(known[0] - got) < 1e-6 else 'NEW'
        print('   %-5s %s %s=%s  vs client %s=%s' % (tag, fn, key, got, cls, want))
        if tag == 'NEW':
            fails.append('aCis %s %s=%s != client %s=%s' % (fn, key, got, cls, want))


# ---------------------------------------------------------------------- C

def _psk(pkg, mesh):
    hit = [c for c in glob.glob(os.path.join(STAGE, '*', 'SkeletalMesh', '*.psk'))
           if os.path.basename(c)[:-4].lower() == mesh.lower()]
    if hit:
        return hit[0]
    subprocess.run([UMODEL, '-game=l2', '-export', '-out=' + STAGE,
                    'animations/%s.ukx' % pkg, mesh],
                   cwd=CLIENT, capture_output=True)
    hit = [c for c in glob.glob(os.path.join(STAGE, '*', 'SkeletalMesh', '*.psk'))
           if os.path.basename(c)[:-4].lower() == mesh.lower()]
    return hit[0] if hit else None


def measure_pawn(pw, cls):
    """Retail rendered height of a pawn's own default mesh set, L2 units.

    The pawn's `Mesh` plus its `SubMeshes` are what the retail client puts on
    a naked newly created character, so this is a measurement of the retail
    silhouette that owes nothing to the build pipeline's armour choice.
    """
    d = pw[cls]
    if not d['mesh']:
        return None
    pkg = UKX[d['mesh'][0].lower()]
    parts = [d['mesh'][1]] + [s[1] for s in d['submeshes']]
    lo, hi = 1e30, -1e30
    for m in parts:
        f = _psk(pkg, m)
        if not f:
            return None
        zs = [p[2] for p in assemble.parse_psk(f)['points']]
        lo, hi = min(lo, min(zs)), max(hi, max(zs))
    sc = scale_util.mesh_scale(
        os.path.join(ROOT, 'assets/interlude/animations/%s.ukx' % pkg), parts[0])
    return (hi - lo) * (sc[2] if sc else 1.0)


def check_native_height(pw, fails):
    print('== C. manifest nativeHeight vs the retail default mesh set')
    if not os.path.isfile(UMODEL):
        print('   SKIP: tools/bin/umodel missing')
        return
    man = load_manifest(os.path.join(CHARS, 'manifest.json'))
    print('   %-17s %8s %8s %7s  %8s %7s' %
          ('model', 'manifest', 'retail', 'delta', '2xCollH', 'ratio'))
    ratios = []
    for cls, mid in sorted(PAWN_TO_MODEL.items(), key=lambda t: t[1]):
        if mid not in man:
            fails.append('manifest has no entry for %s' % mid)
            continue
        nh = man[mid].get('nativeHeight')
        got = measure_pawn(pw, cls)
        ch = pw[cls]['collisionHeight']
        if nh is None or got is None:
            fails.append('%s: no nativeHeight / no measurement' % mid)
            continue
        d = (nh - got) / got
        r = nh / (2 * ch)
        ratios.append(r)
        print('   %-17s %8.1f %8.2f %+6.1f%%  %8.1f %7.4f' %
              (mid, nh, got, 100 * d, 2 * ch, r))
        if abs(d) > 0.02:
            fails.append('%s: manifest nativeHeight %.1f is %+.1f%% off the '
                         'retail mesh measurement %.2f' % (mid, nh, 100 * d, got))
    if ratios:
        print('   nativeHeight / 2xCollisionHeight: min %.4f  max %.4f  sd %.4f'
              % (min(ratios), max(ratios), statistics.pstdev(ratios)))
        print('   -> the ratio is a 9-point spread, not a constant: the '
              'cylinder is an authored bound, not a measurement of the mesh.')


# ---------------------------------------------------------------------- D

def npc_index():
    idx = ucd.index(NPC_SCRIPT_PACKAGES)
    return idx, ucd.resolver(idx)


def check_same_mesh(fails):
    print('== D. does the retail size key on DrawScale?  (no mesh data used)')
    idx, (key_for, inherited) = npc_index()
    npcgrp = json.load(open(os.path.join(ROOT, 'assets/gamedata/npcgrp.json')))
    bymesh = {}
    for r in npcgrp:
        mn = r.get('mesh_name', '')
        if '.' not in mn:
            continue
        k = key_for(r['class_name'])
        if not k:
            continue
        ds = inherited(k, 'drawScale') or 1.0
        ch = inherited(k, 'collisionHeight')
        if not ch or ch <= 0:
            continue
        bymesh.setdefault(mn.split('.', 1)[1].lower(), {})[r['class_name']] = (ds, ch)
    hyp, null = [], []
    for cls in bymesh.values():
        items = sorted(cls.items())
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                (_, (d1, h1)), (_, (d2, h2)) = items[i], items[j]
                if abs(d1 - d2) < 1e-9:
                    continue
                hyp.append(abs(math.log((h2 / h1) / (d2 / d1))))
                null.append(abs(math.log(h2 / h1)))
    if not hyp:
        fails.append('no shared-mesh DrawScale pairs found - decode broken?')
        return
    agree = 100.0 * sum(1 for e in hyp if e < 0.05) / len(hyp)
    agree0 = 100.0 * sum(1 for e in null if e < 0.05) / len(null)
    print('   %d mesh pairs whose two classes differ in DrawScale' % len(hyp))
    print('   CollisionHeight ratio == DrawScale ratio : %.1f%% within 5%%' % agree)
    print('   CollisionHeight ratio == 1 (DrawScale ignored) : %.1f%% within 5%%'
          % agree0)
    if agree < 80:
        fails.append('shared-mesh DrawScale agreement fell to %.1f%% (<80%%)' % agree)


def check_monster_drawscale(fails):
    print('== D2. monster manifest nativeHeight against 2xCollisionHeight')
    idx, (key_for, inherited) = npc_index()
    npcgrp = json.load(open(os.path.join(ROOT, 'assets/gamedata/npcgrp.json')))
    man = load_manifest(os.path.join(CHARS, 'monsters/manifest.json'))
    permesh = {}
    for r in npcgrp:
        mn = r.get('mesh_name', '')
        if '.' not in mn:
            continue
        permesh.setdefault(r['class_name'], set()).add(mn.split('.', 1)[1])
    raw1, corr1, raw0 = [], [], []
    n_ds = 0
    for cname, meshes in permesh.items():
        k = key_for(cname)
        if not k:
            continue
        ds = inherited(k, 'drawScale') or 1.0
        ch = inherited(k, 'collisionHeight')
        if not ch or ch <= 0:
            continue
        hs = [man[m]['nativeHeight'] for m in meshes
              if m in man and man[m].get('nativeHeight')]
        if not hs:
            continue
        nh = statistics.median(hs)
        if abs(ds - 1.0) < 1e-9:
            raw0.append(nh / (2 * ch))
        else:
            n_ds += 1
            raw1.append(nh / (2 * ch))
            corr1.append(nh * ds / (2 * ch))

    def band(v):
        return 100.0 * sum(1 for t in v if 0.9 <= t <= 1.1) / len(v)
    if raw0:
        print('   DrawScale == 1 classes (n=%d): median %.3f, %.1f%% within 10%%'
              % (len(raw0), statistics.median(raw0), band(raw0)))
    if raw1:
        print('   DrawScale != 1 classes (n=%d):' % n_ds)
        print('       without DrawScale: median %.3f, %.1f%% within 10%%'
              % (statistics.median(raw1), band(raw1)))
        print('       with    DrawScale: median %.3f, %.1f%% within 10%%'
              % (statistics.median(corr1), band(corr1)))
        if band(corr1) <= band(raw1):
            fails.append('applying DrawScale no longer improves the monster fit')


def emit_npc_scale(path):
    """Write the per-npcId retail DrawScale table the client needs."""
    idx, (key_for, inherited) = npc_index()
    npcgrp = json.load(open(os.path.join(ROOT, 'assets/gamedata/npcgrp.json')))
    out = {}
    for r in npcgrp:
        mn = r.get('mesh_name', '')
        k = key_for(r['class_name'])
        if not k:
            continue
        ds = inherited(k, 'drawScale')
        if ds is None or abs(ds - 1.0) < 1e-9:
            continue                      # Engine.Actor default; nothing to store
        out[str(r['npc_id'])] = {
            'class': r['class_name'],
            'drawScale': round(float(ds), 6),
            'clientCollisionHeight': inherited(k, 'collisionHeight'),
            'mesh': mn.split('.', 1)[1] if '.' in mn else None,
        }
    doc = {
        '_source': 'assets/interlude/system/Lineage*.u class defaultproperties '
                   '(Actor.DrawScale) joined to assets/gamedata/npcgrp.json by '
                   'class_name; decoded by tools/src/char_pipeline/'
                   'uclass_defaults.py',
        '_meaning': 'retail rendered height = manifest nativeHeight(mesh) x '
                    'drawScale. npcIds absent from this table have the '
                    'Engine.Actor default drawScale 1.0.',
        'scales': out,
    }
    with open(path, 'w') as f:
        json.dump(doc, f, indent=1, sort_keys=True)
    print('wrote %s (%d npcIds with DrawScale != 1)' % (path, len(out)))


# ------------------------------------------------------- third yardstick

# Retail geometry whose real-world size is not in dispute, used to sanity
# the ABSOLUTE scale of nativeHeight independently of both the mesh decode
# and the collision cylinder.  Weapons are the sharpest: they are retail
# meshes authored to be held by the retail character.
YARDSTICK_WEAPONS = ['long_bow_m00_wp', 'short_bow_m00_wp',
                     'long_spear_m00_wp', 'dagger_m00_wp',
                     'round_shield_m00_sh']
YARDSTICK_PROPS = ['Elmo_LM_woodfence01_01', 'GL_Stair02', 'GL_Stair01',
                   'Dion_Punish_stair_A', 'Elf_Door_01']


def _gltf_arrays(path):
    g = json.load(open(path))
    import struct as _s
    b = open(path.replace('.gltf', '.bin'), 'rb').read()

    def acc(i):
        a = g['accessors'][i]
        bv = g['bufferViews'][a['bufferView']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        ct = {5126: 'f', 5123: 'H', 5125: 'I', 5121: 'B'}[a['componentType']]
        stride = bv.get('byteStride') or (n * _s.calcsize(ct))
        return [_s.unpack_from('<%d%s' % (n, ct), b, off + k * stride)
                for k in range(a['count'])]
    return g, acc


def _bbox_l2(path):
    g, acc = _gltf_arrays(path)
    lo = [1e30] * 3
    hi = [-1e30] * 3
    for m in g['meshes']:
        for pr in m['primitives']:
            a = g['accessors'][pr['attributes']['POSITION']]
            pts = [tuple(a['min']), tuple(a['max'])] if 'min' in a \
                else acc(pr['attributes']['POSITION'])
            for p in pts:
                for i in range(3):
                    lo[i] = min(lo[i], p[i])
                    hi[i] = max(hi[i], p[i])
    return [(hi[i] - lo[i]) * 100 for i in range(3)]


def _risers(path):
    """Distinct Z levels of up-facing (tread) triangles, in L2 units."""
    g, acc = _gltf_arrays(path)
    levels = []
    for m in g['meshes']:
        for pr in m['primitives']:
            if 'NORMAL' not in pr['attributes'] or 'indices' not in pr:
                continue
            P = acc(pr['attributes']['POSITION'])
            N = acc(pr['attributes']['NORMAL'])
            idx = [i[0] for i in acc(pr['indices'])]
            for t in range(0, len(idx) - 2, 3):
                tri = idx[t:t + 3]
                if all(N[v][1] > 0.95 for v in tri):
                    levels.append(sum(P[v][1] for v in tri) / 3 * 100)
    levels.sort()
    cl = []
    for y in levels:
        if cl and y - cl[-1] < 0.6:
            continue
        cl.append(y)
    return [round(cl[i + 1] - cl[i], 2) for i in range(len(cl) - 1)]


def report_props():
    man = load_manifest(os.path.join(CHARS, 'manifest.json'))
    base = man['human_fighter_m']['nativeHeight']
    print('== third yardstick: retail geometry in raw L2 units')
    print('   reference: human_fighter_m nativeHeight = %.1f' % base)
    wman = json.load(open(os.path.join(CHARS, 'weapons/manifest.json')))['models']
    wbyid = {w['id']: w for w in wman}
    for wid in YARDSTICK_WEAPONS:
        w = wbyid.get(wid)
        if not w:
            print('   %-28s (not built)' % wid)
            continue
        print('   %-28s %7.2f  = %.2f x character' %
              (wid, w['nativeLength'], w['nativeLength'] / base))
    for name in YARDSTICK_PROPS:
        hit = sorted(glob.glob(os.path.join(ROOT, 'assets/world/*/props/%s.gltf' % name)))
        if not hit:
            print('   %-28s (no converted tile carries it)' % name)
            continue
        ext = _bbox_l2(hit[0])
        extra = ''
        if 'tair' in name:
            gaps = _risers(hit[0])
            keep = [g for g in gaps if g < 20]
            if keep:
                extra = '  risers %.2f..%.2f over %d steps' % (
                    min(keep), max(keep), len(keep))
        print('   %-28s X %7.1f  up %7.1f  Z %7.1f%s' %
              (name, ext[0], ext[1], ext[2], extra))
    print('   NOTE: this fixes the absolute scale to roughly +/-10%; it does '
          'NOT\n         adjudicate the 5-9% nativeHeight vs 2xCollisionHeight '
          'gap.\n         Stair risers sit on the 8-unit geodata Z quantum, so '
          'they are a\n         technical grid, not an ergonomic one.')


def main():
    args = sys.argv[1:]
    check = '--check' in args
    if '--props' in args:
        report_props()
        return
    if '--emit-npc-scale' in args:
        emit_npc_scale(os.path.join(CHARS, 'monsters/npc-scale.json'))
        return
    fails = []
    pw = pawns()
    check_pawn_drawscale(pw, fails)
    print()
    check_acis_classes(pw, fails)
    print()
    if '--no-mesh' not in args:
        check_native_height(pw, fails)
        print()
    check_same_mesh(fails)
    print()
    check_monster_drawscale(fails)
    print()
    if fails:
        for f in fails:
            print('FAIL: %s' % f)
        print('FAIL (%d)' % len(fails))
        if check:
            sys.exit(1)
    else:
        print('PASS')


if __name__ == '__main__':
    main()
