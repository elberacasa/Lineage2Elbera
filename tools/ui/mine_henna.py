#!/usr/bin/env python3
"""Elbera Tools: decode original henna records and dialog layout.

--emit writes ignored henna.json and only its original library icons.
--check rereads the source and checks the existing private export.
No server-derived names, prices, stats or client-class rules are invented.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'tools/dat'), str(ROOT / 'tools/xdat')]
from extract_gamedata import decrypt, SkillReader, TRAILER, parse_sysstring
import parse_xdat as xdat
from check_layout_native import verify as verify_layout, XDAT_SHA
from mine_skilltraining import descendants, tree_flow_proof, SYSSTRING_SHA
from check_henna_native import verify as verify_henna, SCRIPT_SHA

SOURCE = 'hennagrp-e.dat'
SOURCE_SHA = '837e1665358e510dbd8e36b5d71737717f894b9e71a8d06db8b68ba29a54a03c'
OUTPUT = ROOT / 'assets/gamedata/henna.json'


def parse(data):
    if not data.endswith(TRAILER):
        raise ValueError('henna: missing source trailer')
    r = SkillReader(data[:-len(TRAILER)], SOURCE)
    count = r.u32()
    if count > (len(r.data) - r.pos) // 12:
        raise ValueError('henna: row count exceeds payload')
    rows, keys = [], set()
    for _ in range(count):
        start = r.pos
        row = dict(symbolId=r.u32(), dyeId=r.u32(), name=r.ascf(), icon=r.ascf(),
                   text1=r.ascf(), text2=r.ascf())
        if not row['symbolId'] or row['symbolId'] in keys:
            raise ValueError('henna: invalid or duplicate symbol ID')
        keys.add(row['symbolId'])
        row.update(sourceOffset=start, sourceLength=r.pos-start,
                   sourceSHA256=hashlib.sha256(r.data[start:r.pos]).hexdigest())
        rows.append(row)
    if not r.done():
        raise ValueError('henna: unexplained payload tail')
    return rows


def decode():
    original = (ROOT / 'assets/interlude/system' / SOURCE).read_bytes()
    assert hashlib.sha256(original).hexdigest() == SOURCE_SHA
    raw = (ROOT / 'assets/interlude/system/Interface.xdat').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == XDAT_SHA
    assert hashlib.sha256((ROOT / 'assets/interlude/system/sysstring-e.dat').read_bytes()).hexdigest() == SYSSTRING_SHA
    with tempfile.TemporaryDirectory(prefix='elbera-henna-') as temporary:
        data = decrypt(SOURCE, temporary)
        records = parse(data)
        strings = {r['id']: r['string'] for r in parse_sysstring(decrypt('sysstring-e.dat', temporary))}
    xdat.data_g = raw
    _, scanned = xdat.scan(raw)
    all_nodes = list(descendants(xdat.build_tree(scanned)))
    windows = {n['name']: n for n in all_nodes if n['name'] in ('HennaInfoWnd', 'HennaListWnd')}
    assert len(windows) == 2
    inventory, = [n for n in all_nodes if n['name'] == 'InventoryWnd']
    slot, = [n for n in inventory['children'] if n['name'] == 'HennaItem']
    nodes = list(descendants(windows.values()))
    assert all(n.get('parentResolution', {}).get('status', 'resolved') == 'resolved' for n in nodes)
    ids = {n['textId'] for n in nodes if 'textId' in n}
    script_hashes, script_refs = {}, set()
    for name in windows:
        script = (ROOT / f'assets/uscript/Interface/{name}.uc').read_bytes()
        script_hashes[name] = hashlib.sha256(script).hexdigest()
        assert script_hashes[name] == SCRIPT_SHA[name], 'henna script differs from fresh original proof'
        ids.update(map(int, re.findall(rb'GetSystemString\(\s*(\d+)\s*\)', script)))
        script_refs.update(s.decode('ascii') for s in re.findall(rb'"([A-Za-z0-9_.]+)"', script)
                           if xdat.TEXREF.match(s.decode('ascii')))
    assert ids <= strings.keys()
    refs = sorted({t for n in nodes + [slot] for t in n['textures']} | script_refs)
    library = xdat.library_index()
    textures = {ref: xdat.resolve(ref, library) for ref in refs if xdat.resolve(ref, library)}
    icons = {}
    for row in records:
        if not re.fullmatch(r'icon\.[A-Za-z0-9_]+', row['icon']):
            raise ValueError('henna: unresolved icon identity')
        filename = row['icon'].split('.')[1].lower() + '.png'
        source = ROOT / 'assets/library/icon' / filename
        if not source.is_file():
            raise ValueError('henna: original library icon missing')
        icons[row['icon']] = {'file': 'icons/' + filename,
                              'librarySHA256': hashlib.sha256(source.read_bytes()).hexdigest()}
    return {'format': 'l2-interlude-henna-v1', 'sources': {
        SOURCE: SOURCE_SHA, 'decodedSHA256': hashlib.sha256(data).hexdigest(),
        'Interface.xdat': XDAT_SHA, 'sysstring-e.dat': SYSSTRING_SHA, **script_hashes},
        'records': records, 'icons': icons, 'windows': windows, 'inventorySlot': slot,
        'strings': {str(i): strings[i] for i in sorted(ids)}, 'textures': textures,
        'native': verify_henna(),
        'nativeLayoutProof': verify_layout(), 'nativeTreeFlow': tree_flow_proof(),
        'limits': ['text1 is native inventory description; text2 is tattooAddName/remove-list description',
                   'inherited frames and exact native text measurement remain unported']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--emit', action='store_true')
    mode.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = decode()
    for entry in result['icons'].values():
        source = ROOT / 'assets/library/icon' / Path(entry['file']).name
        output = ROOT / 'assets/gamedata' / entry['file']
        if args.emit:
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, output)
        else:
            assert output.is_file() and output.read_bytes() == source.read_bytes(), 'henna icon differs'
    if args.emit:
        OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    else:
        assert json.loads(OUTPUT.read_text()) == result, 'henna export is stale'
    print(f"Elbera Tools henna PASS: {len(result['records'])} original records, "
          f"{len(result['icons'])} icons, {len(list(descendants(result['windows'].values())))} controls")


if __name__ == '__main__':
    main()
