#!/usr/bin/env python3
"""Emit editor/characters/stances.json — weapon -> animation stance, as DATA.

WHY this is data and not client logic: the animation a pawn plays while
holding a weapon is picked by the weapon's `handness`, and the enumeration
that ties a handness NUMBER to a stance NAME is printed by the retail
client itself.  `assets/interlude/system/NWindow.dll` is the client's
developer-tool window; its NCPawnViewerWnd resource block holds the
UTF-16 literals

    7(DUALFIST)  5(BOW)  4(POLE)  3(DUAL)  2(2HS)  1(1HS)  0(HAND)

(that is the physical order in the binary — a combo-box item list, built
back to front) and the neighbouring NCPawnCreateWnd block holds the
lowercase animation tokens

    1hs  2hs  dual  pole  bow  hand      + run  walk  atk  wait  social

which are exactly the six `<Action>_<Stance>_<Prefix>` tokens found in
every `<Pkg>.ukx` (see anim_stances.py).  Those numbers are weapongrp's
`handness` domain and nothing else's: weapongrp uses handness 0..7 with
dual=3 and bow=5, whereas its `weapon_type` puts DUAL at 8 and BOW at 6.

So: stance = f(handness), read off the client's own table.  `weapon_type`
is carried through only as a cross-reference/sanity column.

Two handness values need a stated fallback rather than a source:
  - 7 DUALFIST is in the client's list but NO package ships a
    `_DualFist_` sequence suffix (verified across all 14 pawn AnimSets).
  - 6 is NOT in the client's list at all; four Interlude items use it.
Both are emitted with "sourced": false and an explicit reason.

Inputs (all mined, none hand-typed):
  assets/gamedata/weapongrp.json  -- per item: weapon_type, handness, body_part
  assets/gamedata/itemtypes.json  -- aCis weapon type name per item id
  assets/interlude/system/NWindow.dll -- the handness->stance enumeration

Usage:
  build_stances.py            # write editor/characters/stances.json
  build_stances.py --check    # re-derive, diff against the file, exit 1 on drift
"""
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
GAMEDATA = os.path.join(ROOT, 'assets/gamedata')
NWINDOW = os.path.join(ROOT, 'assets/interlude/system/NWindow.dll')
OUT = os.path.join(ROOT, 'editor/characters/stances.json')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from anim_stances import STANCES  # noqa: E402  (canonical token spelling)

# stance token that a handness the client does not enumerate falls back to,
# with the reason.  NOT sourced — flagged as such in the output.
FALLBACK = {
    7: ('hand',
        'client lists 7(DUALFIST) but no .ukx ships a _DualFist_ suffix; '
        'Hand is the bare-fist set (SpAtk06_Hand ships for all 14 pawns, '
        'and the two Orc packages carry 22 further SpAtk*_Hand clips that '
        'exist in no other stance)'),
    6: ('1hs',
        'handness 6 is absent from the client enumeration; the 4 items '
        'that use it are monster-only and all body_part 7 (right hand), '
        'i.e. a one-handed grip'),
}

NO_WEAPON = 'hand'   # nothing in the right hand -> handness 0 -> HAND


def parse_client_enum(path=NWINDOW):
    """-> {handness:int -> stance token} straight out of NWindow.dll.

    The literals are UTF-16LE, NUL-separated, laid out back to front.  We
    only accept a token that is also one of the six .ukx stance suffixes,
    or the DUALFIST entry that has no suffix.
    """
    with open(path, 'rb') as f:
        blob = f.read()
    text = blob.decode('utf-16-le', 'ignore')
    found = {}
    for m in re.finditer(r'(\d)\(([A-Z0-9]+)\)', text):
        found[int(m.group(1))] = m.group(2)
    if not found:
        raise RuntimeError('%s: no N(NAME) literals found' % path)
    return found


def stance_for(handness, client_enum):
    """-> (stance token or None, sourced?, note)"""
    name = client_enum.get(handness)
    if name:
        low = name.lower()
        if low in [s.lower() for s in STANCES]:
            return low, True, 'client enumeration %d(%s)' % (handness, name)
        fb, why = FALLBACK.get(handness, (None, 'no fallback defined'))
        return fb, False, 'client enumeration %d(%s) has no animation ' \
                          'suffix; fallback: %s' % (handness, name, why)
    fb, why = FALLBACK.get(handness, (None, 'no fallback defined'))
    return fb, False, why


def build():
    weapons = json.load(open(os.path.join(GAMEDATA, 'weapongrp.json')))
    types = json.load(open(os.path.join(GAMEDATA, 'itemtypes.json')))['weapon']
    client_enum = parse_client_enum()

    by_hand, pairs = {}, {}
    for rec in weapons:
        h, wt = rec['handness'], rec['weapon_type']
        st, sourced, note = stance_for(h, client_enum)
        e = by_hand.setdefault(str(h), {
            'stance': st, 'sourced': sourced, 'basis': note,
            'client_label': client_enum.get(h), 'items': 0,
            'weapon_types': {}, 'body_parts': {}, 'acis_types': {}})
        e['items'] += 1
        e['weapon_types'][str(wt)] = e['weapon_types'].get(str(wt), 0) + 1
        e['body_parts'][str(rec['body_part'])] = \
            e['body_parts'].get(str(rec['body_part']), 0) + 1
        t = types.get(str(rec['object_id']))
        if t:
            e['acis_types'][t] = e['acis_types'].get(t, 0) + 1
        pairs.setdefault((wt, h), 0)
        pairs[(wt, h)] += 1

    by_item = {}
    for rec in weapons:
        st, _s, _n = stance_for(rec['handness'], client_enum)
        by_item[str(rec['object_id'])] = st

    return {
        'source': {
            'stance_enum': 'assets/interlude/system/NWindow.dll '
                           '(NCPawnViewerWnd combo-box literals, UTF-16LE): '
                           + '  '.join('%d(%s)' % (k, client_enum[k])
                                       for k in sorted(client_enum)),
            'stance_suffixes': 'assets/interlude/animations/<Pkg>.ukx '
                               'AnimSequence names <Action>_<Stance>_<Prefix>',
            'weapon_table': 'assets/gamedata/weapongrp.json '
                            '(handness, weapon_type, body_part per item)',
            'acis_types': 'assets/gamedata/itemtypes.json '
                          '(aCis data/xml/items weapon type per item id)',
            'keyed_on': 'handness — its domain (0,1,2,3,4,5,7) is exactly '
                        'the client enumeration above; weapon_type is a '
                        'different domain (DUAL=8, BOW=6) and is carried '
                        'only as a cross-reference',
        },
        'no_weapon': NO_WEAPON,
        'stance_tokens': [s.lower() for s in STANCES],
        'clip_suffix': 'append "_" + stance to the base clip name '
                       '(idle/walk/run/atk01/atk02/atk03/atkwait/'
                       'shieldatk/spatkNN); fall back to the unsuffixed '
                       'clip if the model does not carry it',
        'by_handness': {k: by_hand[k] for k in sorted(by_hand, key=int)},
        'by_weapon_type_handness': {
            '%d/%d' % k: {'items': v,
                          'stance': stance_for(k[1], client_enum)[0]}
            for k, v in sorted(pairs.items())},
        'by_item': dict(sorted(by_item.items(), key=lambda kv: int(kv[0]))),
    }


def main():
    data = build()
    if '--check' in sys.argv:
        if not os.path.isfile(OUT):
            print('FAIL: %s missing' % OUT)
            return 1
        cur = json.load(open(OUT))
        drift = [k for k in data if json.dumps(cur.get(k), sort_keys=True)
                 != json.dumps(data[k], sort_keys=True)]
        unsourced = [h for h, e in data['by_handness'].items()
                     if not e['sourced']]
        print('handness rows: %d (%d unsourced fallbacks: %s)'
              % (len(data['by_handness']), len(unsourced),
                 ', '.join(unsourced) or '-'))
        if drift:
            print('FAIL: stances.json is stale in: %s' % ', '.join(drift))
            return 1
        print('PASS: stances.json matches a fresh derivation '
              '(%d items mapped)' % len(data['by_item']))
        return 0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(data, f, indent=1)
    for h, e in data['by_handness'].items():
        print('handness %-2s -> %-5s %-9s %5d items  wt=%s'
              % (h, e['stance'], '(SOURCED)' if e['sourced'] else '(fallback)',
                 e['items'], ','.join(sorted(e['weapon_types'], key=int))))
    print('wrote %s (%d items)' % (OUT, len(data['by_item'])))
    return 0


if __name__ == '__main__':
    sys.exit(main())
