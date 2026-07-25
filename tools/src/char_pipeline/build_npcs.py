#!/usr/bin/env python3
"""Build web-ready civilian NPC glTFs (towns stop showing capsules).

Follows build_monsters.py conventions. Sources:
  - Roster (ground truth): aCis spawn XMLs
    (server/aCis_datapack/data/xml/spawnlist/17_2*.xml = Talking Island
    tiles) cross-referenced with assets/gamedata/npcgrp.json
    (npcId -> LineageNPCs.<mesh> + texture refs) and npcname.json.
  - Meshes/anims: assets/interlude/animations/LineageNpcs.ukx (a_* and
    e_* humanoid NPC meshes; priest_of_dawn/dusk, heroes_obelisk) and
    LineageNPCs2.ukx (pig_ball).
  - Textures: each mesh's own .ukx material slots (ordinal section
    mapping, verified visually — same as build_monsters.npc_sections).
  - Animations: per-mesh <name>_anim MeshAnimation. Civilians are mostly
    idle/social (authentic retail); guards additionally carry the full
    combat set.

Output (frozen contract — merged into the monsters manifest, same entry
shape, id = exact npcgrp mesh object name):
  editor/characters/monsters/manifest.json  (MERGED, never rewritten wholesale)
  editor/characters/monsters/models/<id>.gltf + .bin + <id>_sN.png

Usage: /usr/bin/python3 tools/src/char_pipeline/build_npcs.py [only_id ...]
"""
import json
import os
import re
import shutil
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools/l2lib'))
import assemble
import build_monsters as bm
from measure_scale import gltf_y_extent, mesh_scale

OUT = os.path.join(ROOT, 'editor/characters/monsters')
SPAWN_DIR = os.path.join(ROOT, 'server/aCis_datapack/data/xml/spawnlist')

PKG_FOR_PREFIX = {
    'LineageNPCs': 'LineageNpcs',
    'LineageNPCs2': 'LineageNPCs2',
}

CIVILIAN_ANIM_CANDIDATES = {
    'idle':    ['Wait_1HS', 'Wait_Hand', 'Wait', 'SpWait01'],
    'walk':    ['Walk_1HS', 'Walk_Hand', 'Walk'],
    'run':     ['Run_1HS', 'Run_Hand', 'run', 'Run'],
    'attack':  ['Atk01_1HS', 'Atk01_Hand', 'atk01', 'Atk01_Bow',
                'Atk01_Pole'],
    'die':     ['Death_Hand', 'death', 'die'],
    'corpse':  ['deathwait_Hand', 'deathwait'],
    'special': ['Social01', 'SpWait01', 'atkwait', 'AtkWait_1HS'],
}


def spawn_npc_ids(tiles=('17_2',)):
    """npcIds that spawn in the given tile prefixes (aCis ground truth)."""
    ids = set()
    for fn in os.listdir(SPAWN_DIR):
        if not fn.endswith('.xml') or not fn.startswith(tiles):
            continue
        tree = ET.parse(os.path.join(SPAWN_DIR, fn))
        for npc in tree.iter('npc'):
            nid = npc.get('id')
            if nid:
                ids.add(int(nid))
    return sorted(ids)


def civilian_roster():
    """-> [(mesh_id, pkg)] for every civilian (LineageNPC class) mesh
    used by a spawn in the roster tiles. First mesh variant per npcgrp."""
    grp = {r['npc_id']: r for r in json.load(
        open(os.path.join(ROOT, 'assets/gamedata/npcgrp.json')))}
    seen = {}
    for nid in spawn_npc_ids():
        r = grp.get(nid)
        if not r or not r['class_name'].startswith('LineageNPC'):
            continue
        mn = r.get('mesh_name', '')
        if '.' not in mn:
            continue
        pkg, mesh = mn.split('.', 1)
        if pkg not in PKG_FOR_PREFIX:
            continue
        seen.setdefault(mesh, pkg)
    return sorted(seen.items())


def build_npc(mesh_id, pkg, stage, outdir):
    ukx = 'animations/%s.ukx' % pkg
    objects = bm.list_objects(ukx)
    mesh_name = bm.find_ci(objects.get('SkeletalMesh', []), mesh_id)
    if not mesh_name:
        print('  SKIP: mesh %s not in %s' % (mesh_id, ukx))
        return None
    bm.export_one(ukx, mesh_name, [], stage)
    psk = bm.find_exported(stage, mesh_name, '.psk')
    if not psk:
        print('  SKIP: no psk for %s' % mesh_id)
        return None

    tmp_tex = os.path.join(stage, 'tex')
    sections = []
    for s in bm.npc_sections(pkg, mesh_name, psk, tmp_tex):
        uri = None
        if s['texture']:
            uri = '%s_s%d.png' % (mesh_id, len(sections))
            with open(s['texture'], 'rb') as fi, \
                    open(os.path.join(outdir, uri), 'wb') as fo:
                fo.write(fi.read())
        sections.append({'texture': uri, 'alpha_mode': None})

    # animations
    base = re.sub(r'_m\d+$', '', mesh_name)
    anim_obj = bm.find_ci(objects.get('MeshAnimation', []), '%s_anim' % base)
    if not anim_obj:
        for n in objects.get('MeshAnimation', []):
            nb = re.sub(r'_anim(ation)?$', '', n.lower())
            if base.lower().startswith(nb):
                anim_obj = n
                break
    selection = {}
    psa = None
    if anim_obj:
        bm.export_one(ukx, anim_obj, [], stage)
        psa = bm.find_exported(stage, anim_obj, '.psa')
    if psa:
        bones, anims = assemble.parse_psa(psa)
        names_ci = {n.lower(): n for n in anims}
        for anim_id, cands in CIVILIAN_ANIM_CANDIDATES.items():
            for c in cands:
                hit = names_ci.get(c.lower())
                if hit:
                    selection[anim_id] = hit
                    break
    if 'idle' not in selection:
        # some civilians have NO animation set at all in retail (standing
        # shopkeepers, statues): ship the static mesh with an empty clip
        # list rather than a capsule-shaped hole in the manifest
        print('  note: no animation set for %s (static NPC, retail-authentic)'
              % mesh_id)
        selection = {}
        psa = None
    print('  anims:', ', '.join('%s=%s' % kv for kv in selection.items()))

    out_gltf = os.path.join(outdir, '%s.gltf' % mesh_id)
    parts = [{'psk': psk, 'name': mesh_name, 'sections': sections}]
    g, bin_data, ctx = assemble.merge_parts(parts, out_gltf)
    if psa and selection:
        bin_data = assemble.inject_animations(g, bin_data, psa, selection, ctx)
    g['buffers'][0]['byteLength'] = len(bin_data)
    with open(out_gltf, 'w') as f:
        json.dump(g, f)
    with open(out_gltf.replace('.gltf', '.bin'), 'wb') as f:
        f.write(bin_data)

    ext = gltf_y_extent(out_gltf)
    sc = mesh_scale(pkg, mesh_name) or (1.0, 1.0, 1.0)
    native = ext * 100 * sc[2]
    print('  -> %s (%d anims, native %.1f)' % (out_gltf, len(g['animations']), native))
    return {'id': mesh_id, 'gltf': 'models/%s.gltf' % mesh_id,
            'animations': sorted(selection.keys(),
                                 key=list(CIVILIAN_ANIM_CANDIDATES).index),
            'nativeHeight': round(native, 1)}


def main():
    only = set(sys.argv[1:])
    outdir = os.path.join(OUT, 'models')
    os.makedirs(outdir, exist_ok=True)
    manifest_path = os.path.join(OUT, 'manifest.json')
    existing = {}
    order = []
    if os.path.isfile(manifest_path):
        # MERGE ONLY — never drop existing entries (shared file)
        for m in json.load(open(manifest_path)).get('models', []):
            existing[m['id']] = m
            order.append(m['id'])
    roster = civilian_roster()
    print('roster: %d civilian meshes from aCis spawn ground truth'
          % len(roster))
    built = 0
    for mesh_id, pkg_prefix in roster:
        if only and mesh_id not in only:
            continue
        pkg = PKG_FOR_PREFIX[pkg_prefix]
        print('== %s (%s) ==' % (mesh_id, pkg))
        stage = os.path.join(bm.STAGE, mesh_id)
        if os.path.isdir(stage):
            shutil.rmtree(stage)
        try:
            m = build_npc(mesh_id, pkg, stage, outdir)
        except Exception as e:
            print('  FAILED: %s' % e)
            m = None
        if m:
            if m['id'] not in existing:
                order.append(m['id'])
            existing[m['id']] = m
            built += 1
    models = [existing[k] for k in order if k in existing]
    with open(manifest_path, 'w') as f:
        json.dump({'models': models}, f, indent=2)
    print('\nbuilt %d NPCs; manifest: %d models -> %s'
          % (built, len(models), manifest_path))


if __name__ == '__main__':
    main()
