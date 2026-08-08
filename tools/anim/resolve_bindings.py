#!/usr/bin/env python3
"""Cache the GROUND-TRUTH mesh -> MeshAnimation binding for every creature
model the client can spawn.

Not a name convention: a UE2 USkeletalMesh serializes an `Animation` object
reference naming the MeshAnimation it is rigged against.  `umodel -dump`
follows that reference and logs

    Loading MeshAnimation <anim> from package <File>.ukx

which is what this reads.  A mesh with no Animation reference logs nothing
and is genuinely inanimate.  Identical oracle to
tools/src/char_pipeline/build_monsters.py:bound_animation() -- this script
only caches it for the whole roster so the audit does not re-run 495 dumps.

Writes tools/anim/bindings.json: {mesh_id: {"anim": str|None, "ukx": str|None,
"pkg": str}}
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
UMODEL = os.path.join(ROOT, 'tools/bin/umodel')
CLIENT = os.path.join(ROOT, 'assets/interlude')
ANIMDIR = os.path.join(CLIENT, 'animations')
OUT = os.path.join(os.path.dirname(__file__), 'bindings.json')

_DUMP_ANIM = re.compile(
    r'Loading MeshAnimation (\S+) from package .*?([^\\/]+\.ukx)')


def ukx_for_package(pkg_name):
    """Case-insensitive .ukx lookup (retail casing is inconsistent)."""
    want = pkg_name.lower() + '.ukx'
    for f in os.listdir(ANIMDIR):
        if f.lower() == want:
            return 'animations/' + f
    return None


def dump_binding(pkg, mesh):
    # SkeletalMeshes live in the .ukx animation packages themselves
    # (verified: `umodel -list animations/LineageMonsters.ukx` lists
    # `SkeletalMesh gremlin_m00`), not in staticmeshes/.
    rel = ukx_for_package(pkg)
    if not rel:
        return None, None
    r = subprocess.run([UMODEL, '-game=l2', '-dump', rel, mesh],
                       cwd=CLIENT, capture_output=True)
    txt = (r.stdout + r.stderr).decode('utf-8', 'replace')
    m = _DUMP_ANIM.search(txt)
    if m:
        return m.group(1), ukx_for_package(os.path.splitext(m.group(2))[0])
    return None, None


def main():
    manifest = json.load(open(os.path.join(
        ROOT, 'editor/characters/monsters/manifest.json')))['models']
    grp = {}
    for r in json.load(open(os.path.join(ROOT, 'assets/gamedata/npcgrp.json'))):
        mn = r.get('mesh_name') or ''
        if '.' in mn:
            pkg, obj = mn.split('.', 1)
            grp.setdefault(obj.lower(), pkg)

    out = {}
    if os.path.exists(OUT):
        out = json.load(open(OUT))
    todo = [e['id'] for e in manifest if e['id'] not in out]
    print('%d models, %d already cached, %d to resolve'
          % (len(manifest), len(out), len(todo)), flush=True)

    for i, mesh_id in enumerate(todo):
        pkg = grp.get(mesh_id.lower())
        if not pkg:
            out[mesh_id] = {'anim': None, 'ukx': None, 'pkg': None,
                            'note': 'no npcgrp record'}
            continue
        anim, ukx = dump_binding(pkg, mesh_id)
        out[mesh_id] = {'anim': anim, 'ukx': ukx, 'pkg': pkg}
        if i % 25 == 0:
            print('  %d/%d %s -> %s' % (i, len(todo), mesh_id, anim),
                  flush=True)
            json.dump(out, open(OUT, 'w'), indent=1, sort_keys=True)
    json.dump(out, open(OUT, 'w'), indent=1, sort_keys=True)
    bound = sum(1 for v in out.values() if v.get('anim'))
    print('resolved: %d bound / %d total' % (bound, len(out)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
