#!/usr/bin/env python3
"""Build the icon + metadata layer for the web client (M4).

Outputs (frozen paths, the web client builds against these):
  - assets/gamedata/skillmeta.json  {"<skillId>": {"name", "icon", "desc", "levels"}}
  - assets/gamedata/itemmeta.json   {"<itemId>": {"name", "icon", "type", "grade"}}
  - assets/gamedata/icons/*.png     the icon images actually referenced
                                    (copied from assets/library/icon/,
                                    lowercased; names equal the source
                                    texture object name without 'icon.')

Data sources (already-decoded tables from tools/dat work):
  - assets/gamedata/skillgrp.json   skill id+level -> icon / params
  - assets/gamedata/skillname.json  skill id+level -> name / desc
  - assets/gamedata/itemname.json   item id -> name / description
  - assets/gamedata/weapongrp.json  item id -> icon, crystal_type (grade)
  - assets/gamedata/armorgrp.json   item id -> icon, crystal_type
  - assets/gamedata/etcitemgrp.json item id -> icon, crystal_type
  - assets/library/icon/*.png       the exported icon textures (utx icon package)

Usage:
  /usr/bin/python3 tools/dat/build_meta.py           # generate everything
  /usr/bin/python3 tools/dat/build_meta.py --check   # verify only: every icon
                                                     # path referenced in the
                                                     # two JSONs exists on disk
"""
import json
import os
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
GAMEDATA = os.path.join(ROOT, 'assets/gamedata')
LIB_ICONS = os.path.join(ROOT, 'assets/library/icon')
OUT_ICONS = os.path.join(GAMEDATA, 'icons')

# L2 crystal_type -> grade letter (verified against known items:
# 0 = no-grade, 1 = D, 2 = C, 3 = B, 4 = A, 5 = S)
GRADE = {0: 'NG', 1: 'D', 2: 'C', 3: 'B', 4: 'A', 5: 'S'}

# source-data typos: icon ref -> actual texture object name (verified in
# assets/interlude/systextures/icon.utx)
ALIASES = {
    'ect_piece_of_paper_white_i00.png': 'etc_piece_of_paper_white_i00.png',
}


def load(name):
    with open(os.path.join(GAMEDATA, name)) as f:
        return json.load(f)


def icon_file(icon_ref):
    """'icon.skill0003' -> 'skill0003.png'; '' -> None."""
    if not icon_ref or '.' not in icon_ref:
        return None
    return icon_ref.split('.', 1)[1].lower() + '.png'


def build_skills():
    grp = load('skillgrp.json')
    names = load('skillname.json')
    by_id = {}
    # name/desc keyed by (id, level); prefer level 1, else lowest level
    name_by_id = {}
    for r in names:
        sid = r['skill_id']
        cur = name_by_id.get(sid)
        if cur is None or r['skill_level'] < cur['skill_level']:
            name_by_id[sid] = r
    icon_by_id = {}
    levels = {}
    for r in grp:
        sid = r['skill_id']
        levels[sid] = max(levels.get(sid, 0), r['skill_level'])
        cur = icon_by_id.get(sid)
        if cur is None or r['skill_level'] < cur['skill_level']:
            icon_by_id[sid] = r
    for sid in sorted(set(list(levels) + list(name_by_id))):
        meta = {}
        nr = name_by_id.get(sid)
        if nr:
            meta['name'] = nr.get('name', '')
            meta['desc'] = nr.get('desc', '')
        ir = icon_by_id.get(sid)
        ic = icon_file(ir.get('icon', '') if ir else '')
        if ic:
            meta['icon'] = 'icons/' + ic
        if levels.get(sid):
            meta['levels'] = levels[sid]
        by_id[str(sid)] = meta
    return by_id


def build_items():
    itemname = {r['id']: r for r in load('itemname.json')}
    grps = [('weapon', load('weapongrp.json')),
            ('armor', load('armorgrp.json')),
            ('etc', load('etcitemgrp.json'))]
    by_id = {}
    for typ, rows in grps:
        for r in rows:
            oid = r['object_id']
            entry = {'type': typ}
            nr = itemname.get(oid)
            entry['name'] = nr.get('name', '') if nr else ''
            ct = r.get('crystal_type')
            if ct is not None:
                entry['grade'] = GRADE.get(ct, str(ct))
            ic = icon_file((r.get('icon') or [''])[0])
            if ic:
                entry['icon'] = 'icons/' + ic
            by_id[str(oid)] = entry
    # items present in itemname but in no grp table: keep them with name only
    for oid, nr in itemname.items():
        key = str(oid)
        if key not in by_id:
            by_id[key] = {'name': nr.get('name', ''), 'type': 'etc'}
    return by_id


def copy_icons(*metas):
    os.makedirs(OUT_ICONS, exist_ok=True)
    copied, dangling = set(), set()
    for meta in metas:
        for key, entry in meta.items():
            ic = entry.get('icon')
            if not ic:
                continue
            fn = ic.split('/', 1)[1]
            src_name = ALIASES.get(fn, fn)
            if fn not in copied:
                src = os.path.join(LIB_ICONS, src_name)
                if not os.path.isfile(src):
                    alt = None
                    for f in os.listdir(LIB_ICONS):
                        if f.lower() == src_name:
                            alt = f
                            break
                    if alt:
                        src = os.path.join(LIB_ICONS, alt)
                if os.path.isfile(src):
                    shutil.copyfile(src, os.path.join(OUT_ICONS, fn))
                    copied.add(fn)
                else:
                    dangling.add(fn)
            if fn in dangling:
                # dangling source-data ref (texture never shipped) —
                # drop the icon field; entry keeps name/desc
                del entry['icon']
    return copied, dangling


def write_json(path, obj):
    with open(path, 'w') as f:
        json.dump(obj, f, indent=1, sort_keys=True)
    print('wrote %s (%d entries)' % (path, len(obj)))


def check():
    ok = True
    total_refs, missing = 0, []
    for name in ('skillmeta.json', 'itemmeta.json'):
        meta = load(name)
        for key, entry in meta.items():
            ic = entry.get('icon')
            if not ic:
                continue
            total_refs += 1
            if not os.path.isfile(os.path.join(GAMEDATA, ic)):
                missing.append('%s:%s' % (key, ic))
    print('check: %d icon refs, %d missing' % (total_refs, len(missing)))
    for m in missing[:20]:
        print('  MISSING', m)
    if missing:
        ok = False
    print('check: %s' % ('PASS' if ok else 'FAIL'))
    return ok


def main():
    if '--check' in sys.argv:
        sys.exit(0 if check() else 1)
    skills = build_skills()
    items = build_items()
    copied, dangling = copy_icons(skills, items)
    print('icons copied: %d, dangling refs dropped: %d %s'
          % (len(copied), len(dangling), sorted(dangling)))
    write_json(os.path.join(GAMEDATA, 'skillmeta.json'), skills)
    write_json(os.path.join(GAMEDATA, 'itemmeta.json'), items)
    if not check():
        sys.exit(1)


if __name__ == '__main__':
    main()
