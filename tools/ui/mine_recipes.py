#!/usr/bin/env python3
"""Elbera Tools: original Interlude recipe catalog and self-crafting windows.

--emit writes ignored metadata and six original textures; --check compares a fresh decode with them.
No server recipes, material counts, success rates or labels are substituted.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'tools/dat'), str(ROOT / 'tools/xdat')]
from extract_gamedata import decrypt, SkillReader, TRAILER, parse_sysstring, parse_itemname
import parse_xdat as xdat
from check_layout_native import verify as verify_layout, XDAT_SHA
from mine_skilltraining import descendants, tree_flow_proof, SYSSTRING_SHA

SOURCE = 'recipe-c.dat'
SOURCE_SHA = '86cc9502a876ff1128a237d3c414ea56ec1838a034b0ba7c2eb4871e2a2a9813'
ITEMNAME_SHA = '3679470522626b1e8b18f4a23a506fcf4e3b4c062f463e676d743a2ba603bf86'
TEXTURE_PACKAGES = {
    'L2UI': 'eb51705df4f15c514a5775d39e31f6136d26883140172ab17cb5efc41468f852',
    'default': '125f36eda3bc276cfc89b172d01fe46aed5e543c00cc83e46d01724b64cede1c',
}
TREE_TEXTURES = ('Default.ChatBack', *['L2UI.RecipeWnd.' + name for name in (
    'RecipeTreeIconBack', 'RecipeTreeIconBack_click', 'RecipeTreeIconDisableBack', 'TreeMinus', 'TreePlus')])
OUTPUT = ROOT / 'assets/gamedata/recipes.json'
WINDOWS = ('RecipeBookWnd', 'RecipeManufactureWnd', 'RecipeTreeWnd')


def parse(data):
    if not data.endswith(TRAILER):
        raise ValueError('recipes: missing source trailer')
    r = SkillReader(data[:-len(TRAILER)], SOURCE)
    count = r.u32()
    if count > (len(r.data) - r.pos) // 33:
        raise ValueError('recipes: row count exceeds payload')
    rows, keys = [], set()
    for _ in range(count):
        start = r.pos
        row = {'name': r.ascf()}
        for key in ('index', 'recipeItemId', 'level', 'productId', 'productCount', 'mpConsume', 'successRate'):
            row[key] = r.u32()
        materials = r.u32()
        if materials > (len(r.data) - r.pos) // 8:
            raise ValueError('recipes: material count exceeds payload')
        row['materials'] = [{'itemId': r.u32(), 'count': r.u32()} for _ in range(materials)]
        if not row['index'] or row['index'] in keys:
            raise ValueError('recipes: invalid or duplicate recipe index')
        keys.add(row['index'])
        row.update(sourceOffset=start, sourceLength=r.pos-start,
                   sourceSHA256=hashlib.sha256(r.data[start:r.pos]).hexdigest())
        rows.append(row)
    if not r.done():
        raise ValueError('recipes: unexplained payload tail')
    return rows


def tree_textures():
    """Decode only the six script-named dynamic textures, with full outer paths.

    No alpha-threshold crops, inherited library aliases, recoloring or upscaling.
    These complete original pixels do not certify the native drawing sampler.
    """
    sys.path.insert(0, str(ROOT / 'tools'))
    from l2lib import load_package, extract_texture_rgba
    result = {}
    for package_name, expected in TEXTURE_PACKAGES.items():
        path = ROOT / f'assets/interlude/systextures/{package_name}.utx'
        assert hashlib.sha256(path.read_bytes()).hexdigest() == expected
        package, _ = load_package(path)
        def qualified(export):
            names, seen = [package.export_name(export)], set()
            while export.package_index > 0:
                assert export.package_index not in seen, 'cyclic texture outer chain'
                seen.add(export.package_index)
                export = package.exports[export.package_index - 1]
                names.insert(0, package.export_name(export))
            return '.'.join([package_name, *names])
        exports = list(package.exports_by_class('Texture'))
        for reference in TREE_TEXTURES:
            if reference.split('.')[0].casefold() != package_name.casefold():
                continue
            # The original script's Default.ChatBack omits the saved Icon
            # group. Admit its unique package leaf while preserving the full
            # saved identity and explicit unresolved native resolver semantics.
            short = len(reference.split('.')) == 2
            matches = [e for e in exports if (package.export_name(e).casefold() == reference.split('.')[-1].casefold()
                       if short else qualified(e).casefold() == reference.casefold())]
            assert len(matches) == 1, f'non-unique original texture {reference}'
            export = matches[0]
            width, height, rgba, _ = extract_texture_rgba(package, export)
            entry = {'file': 'icons/recipes/' + reference.lower().replace('.', '__') + '.png',
                     'width': width, 'height': height, 'packageSHA256': expected,
                     'exportIndex': export.index, 'sourceObject': qualified(export),
                     'referenceResolution': 'unique-package-leaf; native resolver unverified' if short else 'qualified-original-path',
                     'rgbaSHA256': hashlib.sha256(rgba).hexdigest()}
            result[reference] = (entry, rgba)
    assert len(result) == len(TREE_TEXTURES)
    return result


def decode():
    from check_recipe_native import verify, SCRIPT_SHA
    source = (ROOT / 'assets/interlude/system' / SOURCE).read_bytes()
    assert hashlib.sha256(source).hexdigest() == SOURCE_SHA
    raw = (ROOT / 'assets/interlude/system/Interface.xdat').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == XDAT_SHA
    assert hashlib.sha256((ROOT / 'assets/interlude/system/sysstring-e.dat').read_bytes()).hexdigest() == SYSSTRING_SHA
    assert hashlib.sha256((ROOT / 'assets/interlude/system/ItemName-e.dat').read_bytes()).hexdigest() == ITEMNAME_SHA
    with tempfile.TemporaryDirectory(prefix='elbera-recipes-') as temporary:
        data = decrypt(SOURCE, temporary)
        records = parse(data)
        strings = {r['id']: r['string'] for r in parse_sysstring(decrypt('sysstring-e.dat', temporary))}
        names = {r['id']: {'name': r['name'], 'additionalName': r['additional_name']}
                 for r in parse_itemname(decrypt('ItemName-e.dat', temporary))}
    item_ids = {i for r in records for i in [r['recipeItemId'], r['productId'], *[m['itemId'] for m in r['materials']]]}
    assert item_ids <= names.keys(), 'recipe references missing original item names'
    xdat.data_g = raw
    _, scanned = xdat.scan(raw)
    windows = {n['name']: n for n in descendants(xdat.build_tree(scanned)) if n['name'] in WINDOWS}
    assert len(windows) == len(WINDOWS)
    nodes = list(descendants(windows.values()))
    assert all(n.get('parentResolution', {}).get('status', 'resolved') == 'resolved' for n in nodes)
    native = verify()
    ids = {n['textId'] for n in nodes if 'textId' in n} | set(native['windowTitles'].values())
    script_hashes, script_refs = {}, set()
    for name in WINDOWS:
        script = (ROOT / f'assets/uscript/Interface/{name}.uc').read_bytes()
        script_hashes[name] = hashlib.sha256(script).hexdigest()
        assert script_hashes[name] == SCRIPT_SHA[name], 'recipe script differs from original proof'
        ids.update(map(int, re.findall(rb'GetSystemString\(\s*(\d+)\s*\)', script)))
        ids.update(map(int, re.findall(rb'SetWindowTitle\(\s*"[^"\r\n]+",\s*(\d+)\s*\)', script)))
        script_refs.update(s.decode('ascii') for s in re.findall(rb'"([A-Za-z0-9_.]+)"', script)
                           if xdat.TEXREF.match(s.decode('ascii')))
    assert ids <= strings.keys()
    library = xdat.library_index()
    refs = sorted({t for n in nodes for t in n['textures']} | script_refs)
    assert set(TREE_TEXTURES) <= script_refs, 'texture allowlist must be named in verified source script'
    return {'format': 'l2-interlude-recipes-v1', 'sources': {
        SOURCE: SOURCE_SHA, 'decodedSHA256': hashlib.sha256(data).hexdigest(),
        'Interface.xdat': XDAT_SHA, 'sysstring-e.dat': SYSSTRING_SHA, 'ItemName-e.dat': ITEMNAME_SHA, **script_hashes},
        'records': records, 'windows': windows,
        'itemNames': {str(i): names[i] for i in sorted(item_ids)},
        'strings': {str(i): strings[i] for i in sorted(ids)},
        'textures': {ref: xdat.resolve(ref, library) for ref in refs if xdat.resolve(ref, library)},
        'sourceTextures': {ref: entry for ref, (entry, _) in tree_textures().items()},
        'native': native, 'nativeLayoutProof': verify_layout(), 'nativeTreeFlow': tree_flow_proof(),
        'limits': ['original catalog values do not certify configured-server crafting rules',
                   'Default.ChatBack unique original package leaf is identified; native short-reference resolution is unverified',
                   'native 12x12 tree-button sampling of the original 16x16 texture remains unverified',
                   'inherited frames, item-window drawing and exact native text measurement remain incomplete']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--emit', action='store_true')
    mode.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = decode()
    from l2lib import write_png
    from mine_atlas import png_read
    for reference, (entry, rgba) in tree_textures().items():
        target = ROOT / 'assets/gamedata' / entry['file']
        assert result['sourceTextures'][reference] == entry
        if args.emit:
            target.parent.mkdir(parents=True, exist_ok=True)
            write_png(str(target), entry['width'], entry['height'], rgba)
        else:
            width, height, pixels = png_read(str(target))
            assert (width, height, bytes(pixels)) == (entry['width'], entry['height'], rgba), 'recipe texture differs'
    if args.emit:
        OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    else:
        assert json.loads(OUTPUT.read_text()) == result, 'recipe export is stale'
    print(f"Elbera Tools recipes PASS: {len(result['records'])} original records, "
          f"{len(list(descendants(result['windows'].values())))} controls")


if __name__ == '__main__':
    main()
