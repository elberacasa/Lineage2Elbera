#!/usr/bin/env python3
"""Elbera Tools: build icon metadata and exact original skill-level text.

Outputs (frozen paths, the web client builds against these):
  - assets/gamedata/skillmeta.json  {"<skillId>": {"name", "icon", "desc", "levels"}}
  - assets/gamedata/skilltext.json  private exact-level text/icon records with
                                    original DAT provenance (no level fallback)
  - assets/gamedata/itemmeta.json   {"<itemId>": {"name", "icon", "type", "grade",
                                                "isRecipe", "popMsgNum",
                                                "consumeType", "crystallizable"}}
  - assets/gamedata/icons/*.png     the icon images actually referenced
                                    (copied from assets/library/icon/,
                                    lowercased; names equal the source
                                    texture object name without 'icon.')
                                    Action icons come from actionname.json
                                    (list) directly — same utx icon package.

Exact skilltext reads skillgrp.dat and skillname-e.dat directly through the
strict original-table decoder. Legacy id-only catalogs use these decoded tables:
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
  python3 tools/dat/build_meta.py --skills-only      # private skilltext + icons
  python3 tools/dat/build_meta.py --check-skills     # re-decode originals, compare
  python3 tools/dat/build_meta.py --items-only       # item metadata only, original DATs
  python3 tools/dat/build_meta.py --check-items       # compare original item action fields
"""
import hashlib
import json
import os
import shutil
import sys
import tempfile

import extract_gamedata

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


def skill_rows(rows, label):
    """Unique exact keys; even identical duplicates require source investigation."""
    if not isinstance(rows, list) or not rows:
        raise ValueError(f'{label}: expected nonempty record list')
    result = {}
    for row in rows:
        key = row['skill_id'], row['skill_level']
        if any(type(value) is not int or not 0 < value <= 0xffffffff for value in key):
            raise ValueError(f'{label}: invalid skill key {key}')
        if key in result:
            raise ValueError(f'{label}: duplicate skill key {key}')
        result[key] = row
    return result


def build_skilltext(grp, names, sources):
    """Join by exact (id, level), retaining incomplete source records as missing."""
    icons = skill_rows(grp, 'skillgrp')
    texts = skill_rows(names, 'skillname')
    skills = {}
    for sid, level in sorted(icons.keys() | texts.keys()):
        nr, ir = texts.get((sid, level)), icons.get((sid, level))
        row = {'name': None, 'desc': None, 'enchantName': None, 'enchantDesc': None,
               'icon': None, 'iconRef': None, 'hp': None, 'mp': None, 'range': None,
               'operateType': None, 'isMagic': None,
               'hasText': nr is not None, 'hasIconRecord': ir is not None}
        if nr is not None:
            for source, target in [('name', 'name'), ('desc', 'desc'),
                                   ('enchant_name', 'enchantName'), ('enchant_desc', 'enchantDesc')]:
                value = nr[source]
                if not isinstance(value, str):
                    raise ValueError(f'skillname: {sid}/{level} {source} is not text')
                row[target] = value
        if ir is not None:
            ref = ir['icon']
            if not isinstance(ref, str):
                raise ValueError(f'skillgrp: {sid}/{level} icon is not text')
            row['iconRef'] = ref
            icon = icon_file(ref)
            row['icon'] = 'icons/' + icon if icon else None
            for source, target in [('hp_consume', 'hp'), ('mp_consume', 'mp'), ('cast_range', 'range'),
                                   ('operate_type', 'operateType'), ('is_magic', 'isMagic')]:
                value = ir[source]
                if type(value) is not int or not 0 <= value <= 0xffffffff:
                    raise ValueError(f'skillgrp: {sid}/{level} invalid {source}')
                row[target] = value - 0x100000000 if target == 'range' and value >= 0x80000000 else value
        skills.setdefault(str(sid), {})[str(level)] = row
    return {'format': 'l2-skilltext-v1', 'provenance': {
        'sources': sources, 'nameRecordCount': len(texts), 'iconRecordCount': len(icons),
        'recordCount': sum(len(levels) for levels in skills.values()), 'skillCount': len(skills),
        'join': 'exact skill_id + skill_level; missing fields remain null',
    }, 'skills': skills}


def original_skilltext():
    rows, sources = {}, {}
    with tempfile.TemporaryDirectory(prefix='elbera-skilltext-') as temp:
        for filename, parser, label in [
            ('skillgrp.dat', extract_gamedata.parse_skillgrp, 'group'),
            ('skillname-e.dat', extract_gamedata.parse_skillname, 'names'),
        ]:
            with open(os.path.join(extract_gamedata.SYSTEM_DIR, filename), 'rb') as source:
                raw = source.read()
            decoded = extract_gamedata.decrypt(filename, temp)
            rows[label] = parser(decoded)
            sources[filename] = {'sha256': hashlib.sha256(raw).hexdigest(),
                                 'decodedSHA256': hashlib.sha256(decoded).hexdigest(),
                                 'records': len(rows[label])}
    return build_skilltext(rows['group'], rows['names'], sources)


def write_skilltext(check_only=False):
    data = original_skilltext()
    destination = os.path.join(GAMEDATA, 'skilltext.json')
    if check_only:
        with open(destination) as stream:
            if json.load(stream) != data:
                raise ValueError('skilltext.json differs from original exact-level records')
        print('skilltext: original source comparison PASS (%d records)' % data['provenance']['recordCount'])
        return data
    # Reuse image staging without erasing an original reference when art is
    # missing. The source reference remains diagnostic; <img> handles absence.
    icon_rows = {f'{sid}_{level}': dict(row) for sid, levels in data['skills'].items()
                 for level, row in levels.items()}
    copied, missing = copy_icons(icon_rows)
    write_json(destination, data)
    print('skilltext: %d exact records, %d icons staged, %d missing art references' % (
        data['provenance']['recordCount'], len(copied), len(missing)))
    return data


def item_use_fields(typ, group, name):
    """Original InventoryWnd warning inputs; unknown is distinct from false/0.

    Engine EtcItemDataLoad binds etcitem_type to +0x100; NWindow sets Recipe
    only for group2/subtype5. ItemName popup binds +0x64 → PopMsgNum. See
    docs/native-inventory-evidence.md. This does not decide item usability.
    """
    recipe = None
    if group is not None:
        if typ in ('weapon', 'armor'):
            recipe = False
        elif typ == 'etc' and 'etcitem_type' in group:
            value = group['etcitem_type']
            if type(value) is not int or not 0 <= value <= 0xffffffff:
                raise ValueError('etcitem_type must be an original uint32')
            recipe = value == 5
    popup = None if name is None else name.get('popup')
    if popup is not None and (type(popup) is not int or not -0x80000000 <= popup <= 0x7fffffff):
        raise ValueError('popup must be an original int32')
    return {'isRecipe': recipe, 'popMsgNum': popup}


def item_action_fields(typ, group):
    """Native inventory predicate inputs, not inferred from grade or count.

    ConsumeType initializes to zero; only etc groups copy source record+0xfc.
    The historical DAT parser calls this integer enum ``stackable``. Native
    IsStackableItem accepts exactly 1, 2 or 3. IsCrystallizable reads source
    record+0xcc, preserved here as an integer rather than a grade heuristic.
    """
    consume = crystalline = None
    if group is not None:
        consume = 0 if typ in ('weapon', 'armor') else group.get('stackable') if typ == 'etc' else None
        crystalline = group.get('crystallizable')
    for key, value in [('consumeType', consume), ('crystallizable', crystalline)]:
        if value is not None and (type(value) is not int or not 0 <= value <= 0xffffffff):
            raise ValueError(f'{key} must be an original uint32')
    return {'consumeType': consume, 'crystallizable': crystalline}


def build_items(tables=None):
    read = load if tables is None else tables.__getitem__
    itemname = {r['id']: r for r in read('itemname.json')}
    grps = [('weapon', read('weapongrp.json')),
            ('armor', read('armorgrp.json')),
            ('etc', read('etcitemgrp.json'))]
    by_id = {}
    for typ, rows in grps:
        for r in rows:
            oid = r['object_id']
            entry = {'type': typ}
            nr = itemname.get(oid)
            entry['name'] = nr.get('name', '') if nr else ''
            entry.update(item_use_fields(typ, r, nr))
            entry.update(item_action_fields(typ, r))
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
            by_id[key] = {'name': nr.get('name', ''), 'type': 'etc',
                          **item_use_fields(None, None, nr), **item_action_fields(None, None)}
    return by_id


def original_item_tables():
    """Read local originals without rewriting decoded tables or other metadata."""
    tables, sources = {}, {}
    with tempfile.TemporaryDirectory(prefix='elbera-itemmeta-') as temp:
        for filename, output, parser, key in [
            ('ItemName-e.dat', 'itemname.json', extract_gamedata.parse_itemname, 'id'),
            ('weapongrp.dat', 'weapongrp.json', extract_gamedata.parse_weapongrp, 'object_id'),
            ('armorgrp.dat', 'armorgrp.json', extract_gamedata.parse_armorgrp, 'object_id'),
            ('etcitemgrp.dat', 'etcitemgrp.json', extract_gamedata.parse_etcitemgrp, 'object_id'),
        ]:
            with open(os.path.join(extract_gamedata.SYSTEM_DIR, filename), 'rb') as source:
                raw = source.read()
            decoded = extract_gamedata.decrypt(filename, temp)
            rows = parser(decoded)
            if len({row[key] for row in rows}) != len(rows):
                raise ValueError(f'{filename}: duplicate item IDs require source investigation')
            tables[output] = rows
            sources[filename] = {'sha256': hashlib.sha256(raw).hexdigest(),
                                 'decodedSHA256': hashlib.sha256(decoded).hexdigest(),
                                 'records': len(rows)}
    groups = [row['object_id'] for name in ('weapongrp.json', 'armorgrp.json', 'etcitemgrp.json')
              for row in tables[name]]
    if len(set(groups)) != len(groups):
        raise ValueError('item appears in multiple original group tables')
    return tables, sources


def write_items(check_only=False):
    tables, sources = original_item_tables()
    expected = build_items(tables)
    if check_only:
        actual = load('itemmeta.json')
        if set(actual) != set(expected) or any(
            any(field not in actual[key] or type(actual[key][field]) is not type(row[field])
                or actual[key][field] != row[field]
                for field in ('isRecipe', 'popMsgNum', 'consumeType', 'crystallizable'))
            for key, row in expected.items()
        ):
            raise ValueError('itemmeta action fields differ from original item records')
        print('itemmeta: original action field comparison PASS (%d records)' % len(expected))
    else:
        write_json(os.path.join(GAMEDATA, 'itemmeta.json'), expected)
    return sources


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


def copy_action_icons():
    """actionname.json is a LIST with 'icon.actionNNN' refs (ActionWnd);
    the textures ship in the same utx icon package as skills/items."""
    copied, missing = 0, []
    for r in load('actionname.json'):
        fn = icon_file(r.get('icon', ''))
        if not fn:
            continue
        src = os.path.join(LIB_ICONS, fn)
        if os.path.isfile(src):
            shutil.copyfile(src, os.path.join(OUT_ICONS, fn))
            copied += 1
        else:
            missing.append(fn)
    return copied, missing


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
    for r in load('actionname.json'):
        fn = icon_file(r.get('icon', ''))
        if not fn:
            continue
        total_refs += 1
        if not os.path.isfile(os.path.join(OUT_ICONS, fn)):
            missing.append('action%s:%s' % (r.get('id'), fn))
    print('check: %d icon refs, %d missing' % (total_refs, len(missing)))
    for m in missing[:20]:
        print('  MISSING', m)
    if missing:
        ok = False
    print('check: %s' % ('PASS' if ok else 'FAIL'))
    return ok


def main():
    if '--items-only' in sys.argv or '--check-items' in sys.argv:
        write_items(check_only='--check-items' in sys.argv)
        return
    if '--skills-only' in sys.argv or '--check-skills' in sys.argv:
        write_skilltext(check_only='--check-skills' in sys.argv)
        return
    if '--check' in sys.argv:
        sys.exit(0 if check() else 1)
    skills = build_skills()
    items = build_items()
    copied, dangling = copy_icons(skills, items)
    print('icons copied: %d, dangling refs dropped: %d %s'
          % (len(copied), len(dangling), sorted(dangling)))
    acopied, amissing = copy_action_icons()
    print('action icons copied: %d, missing: %d %s'
          % (acopied, len(amissing), amissing))
    write_json(os.path.join(GAMEDATA, 'skillmeta.json'), skills)
    write_json(os.path.join(GAMEDATA, 'itemmeta.json'), items)
    write_skilltext()
    if not check():
        sys.exit(1)


if __name__ == '__main__':
    main()
