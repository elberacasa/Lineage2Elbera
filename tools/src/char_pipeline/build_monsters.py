#!/usr/bin/env python3
"""Build web-ready monster/NPC glTFs from the L2 Interlude client.

Reuses the proven full-skeleton psk pipeline (assemble.py) on
assets/interlude/animations/LineageMonsters*.ukx and LineageNpcs.ukx.

- mesh/texture bindings for MONSTERS come from npcgrp.dat (decoded to
  assets/gamedata/npcgrp.json): npcId -> mesh + texture refs.
- MONSTER animations: the package's <mesh>_anim MeshAnimation -> .psa,
  with L2 monster anim names mapped to the frozen client contract
  (idle/walk/run/attack/die [+corpse, +special]).
- village NPCs (LineageNpcs.ukx) have no npcgrp entry; their multi-section
  material bindings are read from the mesh's own .ukx Faces/Materials
  arrays (face MaterialIndex -> Materials -> Textures), not from names.

Frozen output contract (client codes against it):
  editor/characters/monsters/manifest.json
    {"models": [{"id": "gremlin_m00",
                 "gltf": "models/gremlin_m00.gltf",
                 "animations": ["idle", "walk", "run", "attack", "die", ...]}]}
  editor/characters/monsters/models/<id>.gltf + .bin + <id>[_sN].png

Usage: /usr/bin/python3 tools/src/char_pipeline/build_monsters.py [only_id ...]
"""
import json
import os
import re
import shutil
import struct
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
UMODEL = os.path.join(ROOT, 'tools/bin/umodel')
CLIENT = os.path.join(ROOT, 'assets/interlude')
OUT = os.path.join(ROOT, 'editor/characters/monsters')
STAGE = '/tmp/l2mon_stage'

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools/l2lib'))
import assemble
import scale_util
import ue2package as up
from build_characters import (decode_texture_png, library_png, load_utx,
                              resolve_diffuse, find_utx)

# ------------------------------------------------------------ the roster
# id = manifest/glTF id = mesh object name in the package.
# pkg = .ukx package holding mesh + animation.
# tex = authoritative texture refs from npcgrp (monsters); NPCs read their
#       own ukx material slots instead.

MONSTER_PKG = 'LineageMonsters'

MONSTERS = [
    # starter fields: Talking Island + race villages
    'gremlin_m00', 'rabbit_m00', 'fox_m00', 'wolf_m00', 'dire_wolf_m00',
    'werewolf_m00', 'goblin_m00', 'hobgoblin_m00', 'giant_spider_m00',
    'poison_spider_m00', 'skeleton_m00', 'skeleton_archer_m00',
    'zombie_m00', 'pirates_zombie_m00', 'imp_m00', 'pixy_m00', 'dryad_m00',
    'bugbear_m00', 'troll_m00', 'batur_orc_m00', 'wererat_m00',
    'crimson_bear_m00', 'virud_lizardman_m00', 'stone_golem_m00',
    'harpy_m00',
]

NPC_PKG = 'LineageNpcs'
NPCS = ['a_guard_MElf_m00', 'a_common_peopleA_MHuman_m00',
        'Black_Market_Trader_MDwarf_m00']

# frozen-contract animation mapping (first hit wins, case-insensitive)
ANIM_CANDIDATES = {
    'idle':    ['Wait', 'Wait_1HS', 'Wait_Hand', 'SpWait01'],
    'walk':    ['Walk', 'Walk_1HS', 'Walk_Hand'],
    'run':     ['run', 'Run_1HS', 'Run_Hand', 'Run'],
    'attack':  ['atk01', 'Atk01_1HS', 'Atk01_Hand', 'Atk01_Bow',
                'Atk01_Pole', 'Attack01'],
    'die':     ['death', 'Death_Hand', 'die', 'Death'],
    'corpse':  ['deathwait', 'deathwait_Hand'],
    'special': ['SpWait01', 'Social01', 'atkwait', 'AtkWait_1HS'],
}


def umodel(args, **kw):
    r = subprocess.run([UMODEL, '-game=l2'] + args, cwd=CLIENT,
                       capture_output=True, **kw)
    r.stdout = r.stdout.decode('utf-8', 'replace')
    r.stderr = r.stderr.decode('utf-8', 'replace')
    return r


def list_objects(pkg_path):
    r = umodel(['-list', pkg_path])
    out = {}
    for line in r.stdout.splitlines():
        m = re.match(r'\s*\d+\s+[0-9A-Fa-f]+\s+[0-9A-Fa-f]+\s+(\w+)\s+(.+)$', line)
        if m:
            out.setdefault(m.group(1), []).append(m.group(2).strip())
    return out


def find_ci(names, want):
    for n in names:
        if n.lower() == want.lower():
            return n
    return None


def export_one(pkg_path, obj, extra, outdir):
    os.makedirs(outdir, exist_ok=True)
    r = umodel(['-export', '-out=%s' % outdir] + extra + [pkg_path, obj])
    if r.returncode != 0:
        raise RuntimeError('umodel export failed for %s: %s'
                           % (obj, r.stderr[-300:]))


def find_exported(outdir, basename, ext):
    for dirpath, _dirs, files in os.walk(outdir):
        for f in files:
            if f.lower() == (basename + ext).lower():
                return os.path.join(dirpath, f)
    return None


# ------------------------------------------------------- npcgrp bindings

_NPCGRP = None


def npcgrp_bindings():
    """-> {mesh_object_name_lower: [texture refs]} from npcgrp.dat."""
    global _NPCGRP
    if _NPCGRP is None:
        data = json.load(open(os.path.join(ROOT, 'assets/gamedata/npcgrp.json')))
        _NPCGRP = {}
        for r in data:
            mn = r.get('mesh_name', '')
            if '.' in mn:
                pkg, obj = mn.split('.', 1)
                _NPCGRP[obj.lower()] = (pkg, r.get('textures') or [])
    return _NPCGRP


# -------------------------------------------- ukx face->material parsing

PKG_CACHE = {}


def load_ukx(pkg):
    key = pkg.lower()
    if key not in PKG_CACHE:
        p, _proto = up.load_package(
            os.path.join(CLIENT, 'animations/%s.ukx' % pkg))
        PKG_CACHE[key] = p
    return PKG_CACHE[key]


def mesh_faces_and_slots(pkg, mesh_name):
    """-> (tex_refs, face_records, materials) for a SkeletalMesh export.

    tex_refs:    [(package, object_name)|None] per Textures slot
    face_records: [(w0, w1, w2, material_index)] per source face
    materials:   [TextureIndex per Materials slot]
    """
    ex = pkg.find_export(mesh_name)
    if ex is None:
        raise RuntimeError('mesh %s not in %s' % (mesh_name, pkg.path))
    r = pkg.body_reader(ex)
    up.read_properties(pkg, r)
    r.pos += 25 + 16
    version = r.i32()
    r.i32()  # VertexCount
    n = r.compact()
    r.pos += 4 * n
    ntex = r.compact()
    tex_refs = [r.compact() for _ in range(ntex)]
    r.pos += 36  # MeshScale, MeshOrigin, RotOrigin
    if version <= 1:
        n2 = r.compact()
        r.pos += 2 * n2
    n1 = r.compact()  # FaceLevel u16
    r.pos += 2 * n1
    nf = r.compact()  # Faces FMeshFace 8B
    faces = [struct.unpack('<4H', r.bytes(8)) for _ in range(nf)]
    nc = r.compact()  # CollapseWedgeThus u16
    r.pos += 2 * nc
    nw = r.compact()  # Wedges 10B
    r.pos += 10 * nw
    nm = r.compact()  # Materials FMeshMaterial 8B
    mats = []
    for _ in range(nm):
        r.u32()
        mats.append(r.i32())
    refs = [pkg.ref_name(ci) for ci in tex_refs]
    return refs, faces, mats


# ------------------------------------------------------------- textures

def resolve_tex_png(texpkg, obj_name, tmp_dir, keep_alpha=False):
    """-> (png_path, resolved_name) for a utx material object, or None.

    Library export first (verified), l2lib decode otherwise (the
    LineageMonstersTex packages are not in the library).  L2 *_sp
    textures carry the diffuse in RGB with a specular mask in alpha
    (verified channel-by-channel): prefer the non-suffixed sibling when
    exported, otherwise decode the _sp RGB from the .utx (that IS the
    diffuse)."""
    try:
        resolved = resolve_diffuse(texpkg, obj_name)
    except Exception:
        resolved = obj_name
    if resolved.lower().endswith('_sp'):
        sib = resolved[:-3]
        png = library_png(texpkg, sib)
        if png:
            return png, sib
        os.makedirs(tmp_dir, exist_ok=True)
        out = os.path.join(tmp_dir, resolved + '.png')
        if decode_texture_png(texpkg, resolved, out, keep_alpha=False):
            return out, resolved
        return None, resolved
    png = library_png(texpkg, resolved)
    if png:
        return png, resolved
    os.makedirs(tmp_dir, exist_ok=True)
    out = os.path.join(tmp_dir, resolved + '.png')
    if decode_texture_png(texpkg, resolved, out, keep_alpha=keep_alpha):
        return out, resolved
    return None, resolved


def monster_texture(mesh_id, tmp_dir):
    """npcgrp texture ref for a monster mesh -> (png, refname) or None."""
    entry = npcgrp_bindings().get(mesh_id.lower())
    if not entry:
        print('  WARNING: no npcgrp entry for %s' % mesh_id)
        return None, None
    _pkg, texs = entry
    if not texs:
        return None, None
    ref = texs[0]  # textures[0] = default variant (t00); t01+ are variants
    tp, tn = ref.split('.', 1)
    return resolve_tex_png(tp, tn, tmp_dir, keep_alpha=True)


def npc_sections(pkg, mesh_name, psk_path, tmp_dir):
    """Per-section textures for a LineageNpcs mesh, from its own .ukx
    material slots (ordinal section order — verified visually), with
    npcgrp texture refs as fallback when a slot is null (some NPC meshes
    carry no in-package reference, e.g. a_mageguild_teacher_FElf_m00)."""
    ukx_pkg = load_ukx(pkg)
    ex = ukx_pkg.find_export(mesh_name)
    if ex is None:
        raise RuntimeError('mesh %s not in %s' % (mesh_name, ukx_pkg.path))
    _ver, tex_refs, mats = up.mesh_material_slots(ukx_pkg, ex)
    grp = npcgrp_bindings().get(mesh_name.lower())
    grp_texs = grp[1] if grp else []
    data = assemble.parse_psk(psk_path)
    nsec = max(1, len(data['materials']))
    sections = []
    for si in range(nsec):
        ref = None
        if si < len(mats) and 0 <= mats[si] < len(tex_refs):
            ref = tex_refs[mats[si]]
        if (not ref or not ref[0]) and si < len(grp_texs):
            tp, tn = grp_texs[si].split('.', 1)
            ref = (tp, tn)
        if ref and ref[0]:
            png, resolved = resolve_tex_png(ref[0], ref[1], tmp_dir,
                                            keep_alpha=True)
            print('  section %d -> %s.%s -> %s'
                  % (si, ref[0], ref[1], resolved))
            sections.append({'texture': png, 'name': resolved})
        else:
            print('  WARNING: section %d has no texture' % si)
            sections.append({'texture': None, 'name': None})
    return sections


# ---------------------------------------------------------------- build

def build_one(mesh_id, pkg, stage, outdir):
    ukx = 'animations/%s.ukx' % pkg
    objects = list_objects(ukx)
    mesh_name = find_ci(objects.get('SkeletalMesh', []), mesh_id)
    if not mesh_name:
        print('  SKIP: mesh %s not in %s' % (mesh_id, ukx))
        return None
    export_one(ukx, mesh_name, [], stage)
    psk = find_exported(stage, mesh_name, '.psk')
    if not psk:
        print('  SKIP: no psk for %s' % mesh_id)
        return None

    is_npc = pkg == NPC_PKG
    tmp_tex = os.path.join(stage, 'tex')
    sections = []
    if is_npc:
        for s in npc_sections(pkg, mesh_name, psk, tmp_tex):
            uri = None
            if s['texture']:
                uri = '%s_s%d.png' % (mesh_id, len(sections)) \
                    if True else None
                dst = os.path.join(outdir, uri)
                with open(s['texture'], 'rb') as fi, open(dst, 'wb') as fo:
                    fo.write(fi.read())
            sections.append({'texture': uri, 'alpha_mode': None})
    else:
        png, ref = monster_texture(mesh_id, tmp_tex)
        uri = None
        if png:
            uri = '%s.png' % mesh_id
            with open(png, 'rb') as fi, open(os.path.join(outdir, uri), 'wb') as fo:
                fo.write(fi.read())
            print('  tex %s -> %s' % (ref, os.path.basename(png)))
        else:
            print('  WARNING: no texture for %s' % mesh_id)
        sections.append({'texture': uri, 'alpha_mode': None})

    # animations: monster anims are named after the CREATURE, not the
    # full mesh name (gremlin_m00 -> gremlin_anim; goblin_m00 ->
    # Goblin_animation; Black_Market_Trader_MDwarf_m00 ->
    # Black_Market_trader_anim)
    base = re.sub(r'_m\d+$', '', mesh_name)
    anim_obj = find_ci(objects.get('MeshAnimation', []), '%s_anim' % base) \
        or find_ci(objects.get('MeshAnimation', []), '%s_animation' % base)
    if not anim_obj:
        for n in objects.get('MeshAnimation', []):
            nb = re.sub(r'_anim(ation)?$', '', n.lower())
            if base.lower().startswith(nb):
                anim_obj = n
                break
    if not anim_obj:
        print('  SKIP: no MeshAnimation for %s' % mesh_id)
        return None
    export_one(ukx, anim_obj, [], stage)
    psa = find_exported(stage, anim_obj, '.psa')
    bones, anims = assemble.parse_psa(psa)
    names_ci = {n.lower(): n for n in anims}
    selection = {}
    for anim_id, cands in ANIM_CANDIDATES.items():
        for c in cands:
            hit = names_ci.get(c.lower())
            if hit:
                selection[anim_id] = hit
                break
    if 'idle' not in selection:
        print('  SKIP: no idle animation for %s' % mesh_id)
        return None
    print('  anims:', ', '.join('%s=%s' % kv for kv in selection.items()))

    out_gltf = os.path.join(outdir, '%s.gltf' % mesh_id)
    parts = [{'psk': psk, 'name': mesh_name, 'sections': sections}]
    g, bin_data, ctx = assemble.merge_parts(parts, out_gltf)
    bin_data = assemble.inject_animations(g, bin_data, psa, selection, ctx)
    g['buffers'][0]['byteLength'] = len(bin_data)
    with open(out_gltf, 'w') as f:
        json.dump(g, f)
    with open(out_gltf.replace('.gltf', '.bin'), 'wb') as f:
        f.write(bin_data)
    print('  -> %s (%d anims)' % (out_gltf, len(g['animations'])))
    entry = {'id': mesh_id, 'gltf': 'models/%s.gltf' % mesh_id,
             'animations': sorted(selection.keys(),
                                  key=list(ANIM_CANDIDATES).index)}
    # true in-world height (L2 units) = glTF Y extent x 100 x MeshScale.z
    # decoded from the .ukx (scale_util) — the client sizes the model from
    # this, never from a hardcoded fallback
    nh = scale_util.native_height(
        out_gltf, os.path.join(CLIENT, 'animations/%s.ukx' % pkg), mesh_id)
    if nh:
        entry['nativeHeight'] = nh
        print('  nativeHeight %.1f L2 units' % nh)
    return entry


def main():
    only = set(sys.argv[1:])
    outdir = os.path.join(OUT, 'models')
    os.makedirs(outdir, exist_ok=True)
    manifest_path = os.path.join(OUT, 'manifest.json')
    existing = {}
    if os.path.isfile(manifest_path):
        try:
            for m in json.load(open(manifest_path)).get('models', []):
                existing[m['id']] = m
        except Exception:
            pass
    roster = [(m, MONSTER_PKG) for m in MONSTERS] + \
             [(n, NPC_PKG) for n in NPCS]
    for mesh_id, pkg in roster:
        if only and mesh_id not in only:
            continue
        print('== %s (%s) ==' % (mesh_id, pkg))
        stage = os.path.join(STAGE, mesh_id)
        if os.path.isdir(stage):
            shutil.rmtree(stage)
        try:
            m = build_one(mesh_id, pkg, stage, outdir)
        except Exception as e:
            print('  FAILED: %s' % e)
            m = None
        if m:
            existing[m['id']] = m
    order = [m for m, _p in roster]
    models = ([existing[k] for k in order if k in existing] +
              [v for k, v in existing.items() if k not in order])
    with open(manifest_path, 'w') as f:
        json.dump({'models': models}, f, indent=2)
    print('\nmanifest: %d models -> %s' % (len(models), manifest_path))


if __name__ == '__main__':
    main()
