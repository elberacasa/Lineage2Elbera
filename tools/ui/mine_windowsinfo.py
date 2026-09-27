#!/usr/bin/env python3
"""Elbera Tools: recover saved window positions and native reset defaults.

python3 tools/ui/mine_windowsinfo.py --emit
python3 tools/ui/mine_windowsinfo.py --check

WindowsInfo.ini contains saved absolute positions, not universal defaults.
The separate pinned Interface.xdat default-position table supplies reset
anchors/offsets; native ReArrangeSavedWnd resets only when no window corner
is inside the root rectangle. See docs/native-layout-evidence.md.
Numbered INI sections remain unmapped. The 1024x768 box below is diagnostic,
not evidence of a native scaling/clamping rule. No original files are bundled.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import struct
from pathlib import Path

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INI = os.path.join(REPO, 'assets/interlude/system/WindowsInfo.ini')
XDAT_JSON = os.path.join(REPO, 'assets/gamedata/interface.json')
XDAT = os.path.join(REPO, 'assets/interlude/system/Interface.xdat')
XDAT_SHA = 'a7969a86d3b676d95cfd42cfd6cd0742c07d7941250dbb63a2ba6d937961c1f4'
DEFAULT_START, DEFAULT_END = 532005, 534247
OUT = os.path.join(REPO, 'assets/gamedata/windowsinfo.json')

# Diagnostic reference box only; saved INI positions carry no source viewport.
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


def decode_default_positions(data, start, end):
    """Decode the native int32-count / FString + six-int32 table, bounded.

    The pinned build supplies the table span. This is not a string-signature
    search or a decoder for unrelated trailing Interface.xdat structures.
    Repeated identical records retain all offsets; conflicting repeats fail
    rather than silently choosing a different rule for a window.
    """
    if not 0 <= start <= end <= len(data) or end - start < 4:
        raise ValueError('invalid default-position table span')
    count, = struct.unpack_from('<i', data, start)
    if not 0 <= count <= (end - start - 4) // 27:
        raise ValueError('invalid default-position count')
    p, out = start + 4, {}
    for _ in range(count):
        record_start = p
        if p >= end:
            raise ValueError('truncated default-position name')
        length = data[p]
        p += 1
        if length < 2 or p + length + 24 > end or data[p + length - 1] != 0:
            raise ValueError('invalid default-position FString')
        raw_name = data[p:p + length - 1]
        if any(c < 32 or c >= 127 for c in raw_name):
            raise ValueError('unsupported default-position name encoding')
        name = raw_name.decode('ascii')
        p += length
        anchor, x, y, anchored, width, height = struct.unpack_from('<6i', data, p)
        p += 24
        if not 1 <= anchor <= 9 or anchored not in (0, 1):
            raise ValueError('unsupported default-position anchor')
        if width < 0 and width != -9999 or height < 0 and height != -9999:
            raise ValueError('unsupported default-position size sentinel')
        row = {'anchor': anchor, 'offsetX': x, 'offsetY': y,
               'anchored': bool(anchored),
               'w': None if width == -9999 else width,
               'h': None if height == -9999 else height}
        if name in out:
            if row != {k: v for k, v in out[name].items() if k != 'sourceOffsets'}:
                raise ValueError(f'conflicting default-position records: {name}')
            out[name]['sourceOffsets'].append(record_start)
        else:
            out[name] = {**row, 'sourceOffsets': [record_start]}
    if p != end:
        raise ValueError('default-position table boundary mismatch')
    return out, count


def original_defaults():
    raw = Path(XDAT).read_bytes()
    if hashlib.sha256(raw).hexdigest() != XDAT_SHA:
        raise ValueError('unsupported Interface.xdat source hash')
    defaults, count = decode_default_positions(raw, DEFAULT_START, DEFAULT_END)
    if count != 56:
        raise ValueError('unexpected source default-position count')
    return defaults, {'xdatSHA256': XDAT_SHA, 'defaultTableStart': DEFAULT_START,
                      'defaultTableEnd': DEFAULT_END, 'defaultRecordCount': count}


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

    try:
        defaults, provenance = original_defaults()
        provenance['windowsInfoSHA256'] = hashlib.sha256(Path(INI).read_bytes()).hexdigest()
    except (OSError, ValueError) as error:
        return None, [*fails, str(error)], notes
    return {'docks': docks, 'numeric': numeric, 'defaults': defaults,
            '_provenance': provenance}, fails, notes


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--emit', action='store_true')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()

    data, fails, notes = run()
    print('Elbera Tools: saved window positions and native reset defaults')
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
        '_note': 'docks are saved WindowsInfo.ini positions, not initial defaults. '
                 'defaults are separate original XDAT reset records; null w/h '
                 'means native unchanged size. numeric identities are unresolved.',
        **(data or {}),
    }

    if a.emit and data and not fails:
        with open(OUT, 'w') as f:
            json.dump(payload, f, indent=1, sort_keys=True)
            f.write('\n')
        print(f'\nwrote {os.path.relpath(OUT, REPO)}')

    if a.check:
        if not os.path.exists(OUT):
            fails.append(f'{os.path.relpath(OUT, REPO)} absent -- run --emit')
        elif data:
            have = json.load(open(OUT))
            for k in ('docks', 'numeric', 'defaults', '_provenance'):
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
