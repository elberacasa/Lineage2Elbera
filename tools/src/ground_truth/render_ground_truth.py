#!/usr/bin/env python3
"""Render ground-truth reference images of L2 Interlude character-creation
meshes with the rendering-enabled UEViewer build (tools/bin/umodel-view).

For each of the 14 race/gender combos this renders, straight from the retail
data (no pipeline code involved), the exact meshes that chargrp.dat binds for
the creation screen:

  face mesh  <Prefix>_m000_f
  body meshes <Prefix>_mNNN_{u,l,g,b}  (per charcreate-data.json creationAssets)
  hair meshes <Prefix>_m000_m00_{ah,bh} (only when the combo attaches hair
             meshes for style m000 per appearanceDetail)

Each part is rendered from the FRONT and the BACK in bind pose, textured
(umodel resolves materials itself from assets/interlude/systextures).

Output: tools/reference/track-a/<combo>/<part>_{front,back}.png

Usage: python3 tools/src/ground_truth/render_ground_truth.py [combo_id ...]
"""
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
UMODEL = os.path.join(ROOT, 'tools', 'bin', 'umodel-view')
GAME = os.path.join(ROOT, 'assets', 'interlude')
CHARDATA = os.path.join(ROOT, 'editor', 'characters', 'charcreate-data.json')
OUT = os.path.join(ROOT, 'tools', 'reference', 'track-a')
TMP = os.path.join(ROOT, 'tools', 'reference', 'track-a', '.tmp')

# combo id -> (race id, gender, class key, ukx package, mesh prefix)
COMBOS = {
    'human_fighter_m': ('human',   'male',   'fighter', 'Fighter', 'MFighter'),
    'human_fighter_f': ('human',   'female', 'fighter', 'Fighter', 'FFighter'),
    'human_mystic_m':  ('human',   'male',   'mage',    'Magic',   'MMagic'),
    'human_mystic_f':  ('human',   'female', 'mage',    'Magic',   'FMagic'),
    'elf_m':           ('elf',     'male',   'fighter', 'Elf',     'MElf'),
    'elf_f':           ('elf',     'female', 'fighter', 'Elf',     'FElf'),
    'darkelf_m':       ('darkelf', 'male',   'fighter', 'DarkElf', 'MDarkElf'),
    'darkelf_f':       ('darkelf', 'female', 'fighter', 'DarkElf', 'FDarkElf'),
    'orc_fighter_m':   ('orc',     'male',   'fighter', 'Orc',     'MOrc'),
    'orc_fighter_f':   ('orc',     'female', 'fighter', 'Orc',     'FOrc'),
    'orc_mystic_m':    ('orc',     'male',   'mage',    'Shaman',  'MShaman'),
    'orc_mystic_f':    ('orc',     'female', 'mage',    'Shaman',  'FShaman'),
    'dwarf_m':         ('dwarf',   'male',   'fighter', 'Dwarf',   'MDwarf'),
    'dwarf_f':         ('dwarf',   'female', 'fighter', 'Dwarf',   'FDwarf'),
}


def combo_meshes(data, combo):
    """Return ordered [(suffix, mesh_name)] for one combo, per chargrp data."""
    race_id, gender, ckey, _pkg, prefix = COMBOS[combo]
    race = next(r for r in data['races'] if r['id'] == race_id)
    ca = race['creationAssets'][gender][ckey]
    parts = [('_f', ca['faceMesh'][0].split('.')[-1])]
    for suffix, mref in zip(('_u', '_l', '_g', '_b'), ca['bodyMeshes']):
        parts.append((suffix, mref.split('.')[-1]))
    # hair meshes for creation style m000: only when the style attaches meshes
    detail = race.get('appearanceDetail', {}).get(gender, {}).get(ckey, {})
    if 'm000' in detail.get('attachedMesh', []):
        for suffix in ('_ah', '_bh'):
            parts.append((suffix, '%s_m000_m00%s' % (prefix, suffix)))
    return parts


def render_view(meshes, pkg, view, dist, env_extra):
    """Render all meshes of one package from one view into TMP/Screenshots."""
    if os.path.exists(TMP):
        shutil.rmtree(TMP)
    os.makedirs(TMP)
    cmd = [UMODEL, '-game=l2', '-path=' + GAME,
           os.path.join(GAME, 'animations', pkg + '.ukx')]
    for _suffix, mesh in meshes:
        cmd += ['-obj=' + mesh]
    env = dict(os.environ)
    env.update({
        'UMODEL_HIDDEN': '1',
        'UMODEL_AUTOSHOT': '15',
        'UMODEL_SHOTALL': '1',
        'UMODEL_WINSIZE': '800x800',
        'UMODEL_DIST': str(dist),
    })
    env.update(env_extra)
    p = subprocess.run(cmd, cwd=TMP, env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if p.returncode != 0:
        print('  !! umodel-view failed for %s (%s)' % (pkg, view))
    shots = os.path.join(TMP, 'Screenshots')
    # note: L2 object names are case-inconsistent (MMagic_M005_u vs chargrp's
    # MMagic_m005_u) — umodel names screenshots with the canonical case
    return {os.path.splitext(f)[0].lower(): os.path.join(shots, f)
            for f in os.listdir(shots)} if os.path.isdir(shots) else {}


def main():
    data = json.load(open(CHARDATA))
    combos = sys.argv[1:] or list(COMBOS)

    # group meshes per package so one umodel-view run covers a whole package
    by_pkg = {}
    part_of = {}   # mesh -> (combo, suffix)
    for combo in combos:
        for suffix, mesh in combo_meshes(data, combo):
            pkg = COMBOS[combo][3]
            by_pkg.setdefault(pkg, []).append((suffix, mesh))
            part_of[mesh] = (combo, suffix)

    # default camera shows the character's FRONT (verified visually);
    # UMODEL_YAW=180 turns to the back
    for view, extra in (('front', {}), ('back', {'UMODEL_YAW': '180'})):
        for pkg, meshes in by_pkg.items():
            # small meshes (face/hair) need the camera pulled back
            groups = [(1.0, [m for m in meshes if m[0] in ('_u', '_l', '_g', '_b')]),
                      (3.0, [m for m in meshes if m[0] not in ('_u', '_l', '_g', '_b')])]
            for dist, group in groups:
                if not group:
                    continue
                print('rendering %-9s %s dist=%.1f (%d meshes)' % (pkg, view, dist, len(group)))
                shots = render_view(group, pkg, view, dist, extra)
                for suffix, mesh in group:
                    combo, sfx = part_of[mesh]
                    tga = shots.get(mesh.lower())
                    if not tga:
                        print('  !! no shot for %s (%s)' % (mesh, combo))
                        continue
                    outdir = os.path.join(OUT, combo)
                    os.makedirs(outdir, exist_ok=True)
                    png = os.path.join(outdir, '%s%s_%s.png' % (combo, sfx, view))
                    subprocess.run(['sips', '-s', 'format', 'png', tga, '--out', png],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   check=True)
    shutil.rmtree(TMP, ignore_errors=True)

    # idle-pose skinning reference: _u mesh playing Wait_Hand_<Prefix>
    for combo in combos:
        _race, _gender, _ckey, pkg, prefix = COMBOS[combo]
        mesh = next(m for s, m in combo_meshes(data, combo) if s == '_u')
        if os.path.exists(TMP):
            shutil.rmtree(TMP)
        os.makedirs(TMP)
        env = dict(os.environ)
        env.update({
            'UMODEL_HIDDEN': '1', 'UMODEL_AUTOSHOT': '40',
            'UMODEL_WINSIZE': '800x800', 'UMODEL_ANIM': 'Wait_Hand_' + prefix,
        })
        p = subprocess.run([UMODEL, '-game=l2', '-path=' + GAME,
                            os.path.join(GAME, 'animations', pkg + '.ukx'), mesh],
                           cwd=TMP, env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shots = os.path.join(TMP, 'Screenshots')
        tga = None
        if os.path.isdir(shots):
            for f in os.listdir(shots):
                if f.lower() == mesh.lower() + '.tga':
                    tga = os.path.join(shots, f)
        if not tga:
            print('  !! no wait-pose shot for %s (%s)' % (mesh, combo))
            continue
        outdir = os.path.join(OUT, combo)
        os.makedirs(outdir, exist_ok=True)
        subprocess.run(['sips', '-s', 'format', 'png', tga, '--out',
                        os.path.join(outdir, '%s_wait_front.png' % combo)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        print('wait pose: %s' % combo)
    shutil.rmtree(TMP, ignore_errors=True)
    print('done -> %s' % OUT)


if __name__ == '__main__':
    main()
