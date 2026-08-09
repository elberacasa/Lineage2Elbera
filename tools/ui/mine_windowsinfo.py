#!/usr/bin/env python3
"""Mine the client's own default window placements out of WindowsInfo.ini.

    python3 tools/ui/mine_windowsinfo.py            report
    python3 tools/ui/mine_windowsinfo.py --emit     write assets/gamedata/windowsinfo.json
    python3 tools/ui/mine_windowsinfo.py --check    re-parse + cross-check, exit 1 on drift

WHY THIS EXISTS
---------------
`assets/interlude/system/WindowsInfo.ini` is a shipped client file. It holds
the position every retail window opens at the first time a character sees it,
in absolute 1024x768 client pixels, and for six of them the size as well.

It has been sitting on disk unread. Fourteen files under
`editor/world/js/ui/` mention it *in a comment* -- several of them next to a
typed pair of numbers, and at least three next to the words "AUTHORED dock
(WindowsInfo.ini not mined for this window)" while the window in question
does have a section. This tool reads the file so those numbers can be READ
rather than transcribed, which is the difference between a value that stays
right and a value that was right once.

WHAT IT DOES NOT CLAIM
----------------------
* Eight sections are named by bare number -- `[1]`..`[8]`. `[6]` is 348x187,
  which is exactly ChatWnd's size in Interface.xdat, so the numbers are
  plainly window ids of some kind. **Which id is which window is not decoded
  here**, so they are emitted under their literal names and nothing maps
  them. Do not guess: a wrong mapping would dock a window at another
  window's corner and look deliberate.
* A window with no section gets nothing. `Layout.dock()` returns null and the
  caller keeps its own AUTHORED placement, marked as such at the site. The
  goal is not to have a number for every window; it is to stop pretending we
  decoded the ones we did not.
* The origin is the top-left of the client area at 1024x768, the same origin
  Interface.xdat uses -- consistent with every entry landing inside that box
  except the three `_1`/`_2` expanded shortcut rows and `UnionDetailWnd`,
  which are reported below rather than swept under the rug.

THE CROSS-CHECK
---------------
Six sections carry `width`/`height` as well as a position. Those six are the
gate: each one must equal the size `parse_xdat.py` independently recovered
from Interface.xdat for the same window name. Two unrelated client files
agreeing on six sizes is what says the parse is reading the right fields --
if the ini format were being misread, the sizes would not line up.
"""

import argparse
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INI = os.path.join(REPO, 'assets/interlude/system/WindowsInfo.ini')
XDAT_JSON = os.path.join(REPO, 'assets/gamedata/interface.json')
OUT = os.path.join(REPO, 'assets/gamedata/windowsinfo.json')

# The client's UI is authored at 1024x768 and is NOT rescaled with the
# resolution (docs/ui-mined-values.md); positions are absolute pixels in that
# box. Used below only to report which entries fall outside it.
REF_W, REF_H = 1024, 768

SECTION = re.compile(r'^\[([^\]\r\n]+)\]\s*$')
FIELD = re.compile(r'^\s*(\w+)\s*=\s*(-?\d+)\s*$')


def parse(text):
    """{section: {field: int}} in file order. The format is plain INI with
    integer values only -- asserted: any line that is neither blank, a
    section header nor an int field is returned as an anomaly."""
    out, anomalies, cur = {}, [], None
    for n, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        m = SECTION.match(line)
        if m:
            cur = m.group(1)
            out.setdefault(cur, {})
            continue
        m = FIELD.match(line)
        if m and cur is not None:
            # SPEC: re -- groups 1/2 of FIELD are the key and the value
            out[cur][m.group(1)] = int(m.group(2))
            continue
        anomalies.append((n, line))
    return out, anomalies


def xdat_sizes():
    if not os.path.exists(XDAT_JSON):
        return None
    doc = json.load(open(XDAT_JSON))
    return {w['name']: (w.get('width'), w.get('height')) for w in doc['windows']}


def run():
    fails, notes = [], []
    if not os.path.exists(INI):
        return None, [f'{os.path.relpath(INI, REPO)} absent'], notes
    raw, anomalies = parse(open(INI, encoding='utf-8', errors='replace').read())
    for n, line in anomalies:
        fails.append(f'{os.path.relpath(INI, REPO)}:{n}: not a section or an '
                     f'int field -- the format is not what this parser assumes: '
                     f'{line!r}')

    docks, sizes, numeric = {}, {}, {}
    for name, kv in raw.items():
        entry = {}
        if 'posX' in kv and 'posY' in kv:
            entry['x'] = kv['posX']
            entry['y'] = kv['posY']
        if 'width' in kv and 'height' in kv:
            entry['w'] = kv['width']
            entry['h'] = kv['height']
            sizes[name] = (kv['width'], kv['height'])
        stray = set(kv) - {'posX', 'posY', 'width', 'height'}
        if stray:
            fails.append(f'[{name}] carries unknown fields {sorted(stray)} -- '
                         f'this tool would be dropping decoded data')
        if not entry:
            fails.append(f'[{name}] has neither a position nor a size')
            continue
        (numeric if name.isdigit() else docks)[name] = entry

    # -- the gate: the six sized sections must agree with Interface.xdat -----
    xs = xdat_sizes()
    if xs is None:
        fails.append('assets/gamedata/interface.json absent -- '
                     'run tools/xdat/parse_xdat.py; the size cross-check is '
                     'the only thing proving this parse reads the right fields')
    else:
        checked = 0
        for name, (w, h) in sizes.items():
            if name not in xs:
                notes.append(f'[{name}] {w}x{h}: no window of that name in '
                             f'Interface.xdat, so not cross-checked')
                continue
            if xs[name] != (w, h):
                fails.append(f'[{name}] says {w}x{h} but Interface.xdat says '
                             f'{xs[name][0]}x{xs[name][1]} -- one of the two '
                             f'parses is wrong')
            else:
                checked += 1
        # AUTHORED floor on how many sections must cross-check before the
        # gate means anything. Six carry width/height today.
        if checked < 3:
            fails.append(f'only {checked} sections cross-checked against the '
                         f'xdat; the gate is too weak to trust')
        else:
            notes.append(f'size cross-check: {checked} sections agree with '
                         f'Interface.xdat exactly')

    outside = sorted(n for n, e in {**docks, **numeric}.items()
                     if 'x' in e and (e['x'] >= REF_W or e['y'] >= REF_H))
    if outside:
        notes.append(f'outside the {REF_W}x{REF_H} reference box (reported, '
                     f'not corrected): {", ".join(outside)}')

    return {'docks': docks, 'numeric': numeric}, fails, notes


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--emit', action='store_true')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()

    data, fails, notes = run()
    print('WindowsInfo.ini default window placement')
    if data:
        print(f'  {len(data["docks"])} named sections, '
              f'{len(data["numeric"])} numbered (unmapped, see docstring)')
        for n in sorted(data['docks']):
            e = data['docks'][n]
            size = f'  {e["w"]}x{e["h"]}' if 'w' in e else ''
            print(f'    {n:<24} ({e.get("x")},{e.get("y")}){size}')
    for n in notes:
        print(f'  note: {n}')

    payload = {
        '_source': 'assets/interlude/system/WindowsInfo.ini',
        '_tool': 'tools/ui/mine_windowsinfo.py',
        '_note': 'Retail default window placement, absolute pixels at '
                 '1024x768. "numeric" holds the [1]..[8] sections, whose '
                 'window identity is NOT decoded -- do not map them.',
        **(data or {}),
    }

    if a.emit and data:
        with open(OUT, 'w') as f:
            json.dump(payload, f, indent=1, sort_keys=True)
            f.write('\n')
        print(f'\nwrote {os.path.relpath(OUT, REPO)}')

    if a.check:
        if not os.path.exists(OUT):
            fails.append(f'{os.path.relpath(OUT, REPO)} absent -- run --emit')
        elif data:
            have = json.load(open(OUT))
            for k in ('docks', 'numeric'):
                if have.get(k) != data[k]:
                    fails.append(f'{os.path.relpath(OUT, REPO)} "{k}" disagrees '
                                 f'with WindowsInfo.ini')

    print()
    if fails:
        print(f'CHECK FAIL ({len(fails)})')
        for f in fails:
            print('   ' + f)
        return 1
    print('CHECK PASS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
