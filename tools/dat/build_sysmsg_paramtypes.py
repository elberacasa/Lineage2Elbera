#!/usr/bin/env python3
"""Build sysmsg param-type map for the web client (sysMsg item/skill names).

The gateway flattens SystemMessage params to raw values (bridge.js sysMsg),
dropping the wire-level param TYPE (gameclient.js SM_TYPES). The client can
still resolve ids to names if it knows which $s slots of a message are
ITEM_NAME / SKILL_NAME — and that is fixed per message id at the aCis call
sites. This script mines those call sites:

  - server/aCis_gameserver/java/net/sf/l2j/gameserver/network/SystemMessageId.java
        NAME = new SystemMessageId(<id>);
  - every aCis .java call site
        ...getSystemMessage(SystemMessageId.NAME).addItemName(x)...   (chains)
        sm = SystemMessage.getSystemMessage(SystemMessageId.NAME);
        sm.addItemName(x);                                            (var adds)

$s slots are filled by the string-type adds in chain order (addNumber /
addItemNumber fill $c slots and do not advance the $s index — the same
sequential-consumption model renderSysMsg uses). Output:

  assets/gamedata/sysmsg_paramtypes.json
    {"<msgId>": {"item": [<s-slot indexes>], "skill": [<s-slot indexes>]}}

Conflicting call sites (same id + slot mined as both item and skill) are
dropped with a warning — the client renders the raw value there, which is
wrong less often than a guessed kind.

Usage:
  python3 tools/dat/build_sysmsg_paramtypes.py
"""
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
ACIS = os.path.join(ROOT, 'server/aCis_gameserver/java')
ENUM = os.path.join(ACIS, 'net/sf/l2j/gameserver/network/SystemMessageId.java')
OUT = os.path.join(ROOT, 'assets/gamedata/sysmsg_paramtypes.json')

ENUM_RE = re.compile(r'(\w+)\s*=\s*new SystemMessageId\((\d+)\)')
# chain on the getSystemMessage(...) statement itself (may span lines)
CHAIN_RE = re.compile(
    r'getSystemMessage\(\s*SystemMessageId\.(\w+)\s*\)([^;]*);', re.S)
ADD_RE = re.compile(r'\.(add\w+)\s*\(')
# bare assignment, then var.addXxx(...) statements before the var is sent
# or reassigned
ASSIGN_RE = re.compile(
    r'(\w+)\s*=\s*SystemMessage\.getSystemMessage\(\s*SystemMessageId\.(\w+)'
    r'\s*\)\s*;')

# add methods that fill $c (number) slots; every other add* fills the next
# $s slot (TEXT/NPC_NAME/ITEM_NAME/SKILL_NAME/CASTLE_NAME/ZONE_NAME/...)
NUMBER_ADDS = {'addNumber', 'addItemNumber'}


def enum_ids():
    ids = {}
    with open(ENUM) as f:
        for m in ENUM_RE.finditer(f.read()):
            ids[m.group(1)] = int(m.group(2))
    return ids


def s_positions(adds):
    """([add methods in order]) -> (item slots, skill slots)."""
    item, skill, s = [], [], 0
    for a in adds:
        if a in NUMBER_ADDS:
            continue
        if a == 'addItemName':
            item.append(s)
        elif a == 'addSkillName':
            skill.append(s)
        s += 1
    return item, skill


def main():
    ids = enum_ids()
    mined = {}   # msg id -> {'item': set, 'skill': set}
    unknown_enum = set()

    def record(enum_name, adds):
        mid = ids.get(enum_name)
        if mid is None:
            unknown_enum.add(enum_name)
            return
        item, skill = s_positions(adds)
        if not item and not skill:
            return
        e = mined.setdefault(mid, {'item': set(), 'skill': set()})
        e['item'].update(item)
        e['skill'].update(skill)

    for dirpath, _, files in os.walk(ACIS):
        for fn in files:
            if not fn.endswith('.java'):
                continue
            with open(os.path.join(dirpath, fn), errors='replace') as f:
                text = f.read()
            for m in CHAIN_RE.finditer(text):
                record(m.group(1), ADD_RE.findall(m.group(2)))
            for m in ASSIGN_RE.finditer(text):
                var, enum_name = m.group(1), m.group(2)
                tail = text[m.end():]
                stop = re.search(
                    r'\b(?:sendPacket|broadcastPacket)\s*\(|'
                    + re.escape(var) + r'\s*=', tail)
                if stop:
                    tail = tail[:stop.start()]
                record(enum_name, re.findall(
                    r'\b' + re.escape(var) + r'\s*\.\s*(add\w+)\s*\(', tail))

    out = {}
    conflicts = []
    for mid in sorted(mined):
        item = mined[mid]['item'] - mined[mid]['skill']
        skill = mined[mid]['skill'] - mined[mid]['item']
        for p in sorted(mined[mid]['item'] & mined[mid]['skill']):
            conflicts.append('%d slot %d' % (mid, p))
        entry = {}
        if item:
            entry['item'] = sorted(item)
        if skill:
            entry['skill'] = sorted(skill)
        if entry:
            out[str(mid)] = entry

    with open(OUT, 'w') as f:
        json.dump(out, f, indent=1, sort_keys=True)
    print('wrote %s (%d message ids)' % (OUT, len(out)))
    if conflicts:
        print('conflicts dropped (kept raw):', ', '.join(conflicts))
    if unknown_enum:
        print('call sites with unknown enum name (skipped): %d %s'
              % (len(unknown_enum), sorted(unknown_enum)[:10]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
