#!/usr/bin/env python3
"""Elbera Tools: original ordinary hair selection, without native execution.

--check requires the owner's pinned Engine/Engine.u and original DAT files.
--audit-assets additionally checks source export identities and built defaults;
it does not convert assets or certify material/renderer parity. Receipts belong
under ignored tmp/, never in the public repository.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
TRAILER = b'\x0cSafePackage\x00'


def hair_pairs(raw):
    """On-disk row/style order, pair=(PMS_Hair1, PMS_Hair2), signed DWORDs."""
    if len(raw) != 1800 + len(TRAILER) or not raw.endswith(TRAILER):
        raise ValueError('expected exact 15-by-15 pair table and SafePackage trailer')
    words = struct.unpack('<450i', raw[:-len(TRAILER)])
    return [[list(words[(row * 15 + style) * 2:(row * 15 + style) * 2 + 2])
             for style in range(15)] for row in range(15)]


def keyed_hair_pairs(raw):
    """Helmet/HairAccessary: count, repeated signed key + the same 450 words."""
    if not raw.endswith(TRAILER) or len(raw) < 4 + len(TRAILER):
        raise ValueError('missing keyed table trailer/header')
    count = struct.unpack_from('<I', raw)[0]
    if len(raw) != 4 + count * 1804 + len(TRAILER):
        raise ValueError('keyed hair table size disagrees with count')
    records = []
    for index in range(count):
        pos = 4 + index * 1804
        records.append({'key': struct.unpack_from('<i', raw, pos)[0],
                        'pairs': hair_pairs(raw[pos + 4:pos + 1804] + TRAILER)})
    # Preserve file order/duplicates; no unproved table overwrite policy.
    return records


def copied_strings(image, start, end, base, count=14):
    """Interpret only this straight-line literal-copy block's MOV/XOR subset.

    No calls, jumps, imported helpers or arbitrary native execution. Every
    output byte must have been written by an original instruction.
    """
    registers, memory = {}, {}
    aliases = {'ax': 'eax', 'cx': 'ecx', 'dx': 'edx', 'si': 'esi', 'di': 'edi'}
    for ins in image.dis.disasm(image.data[image.offset(start):image.offset(end)], start):
        dst, src = ins.op_str.split(', ')
        if ins.mnemonic == 'xor' and dst == src:
            registers[dst] = 0
            continue
        if ins.mnemonic not in ('mov', 'movzx'):
            raise ValueError('unsupported literal-copy instruction: ' + ins.mnemonic)
        source = re.fullmatch(r'(dword|word) ptr \[0x([0-9a-f]+)\]', src)
        if source:
            size = 4 if source[1] == 'dword' else 2
            offset = image.offset(int(source[2], 16))
            registers[aliases.get(dst, dst)] = int.from_bytes(image.data[offset:offset + size], 'little')
            continue
        target = re.fullmatch(r'(dword|word) ptr \[ebp - 0x([0-9a-f]+)\]', dst)
        if not target or src not in registers and src not in aliases:
            raise ValueError('unsupported literal-copy operands: ' + ins.op_str)
        size = 4 if target[1] == 'dword' else 2
        value = registers[aliases.get(src, src)]
        offset = -int(target[2], 16)
        for index, byte in enumerate((value & ((1 << (8 * size)) - 1)).to_bytes(size, 'little')):
            memory[offset + index] = byte
    result = []
    for row in range(count):
        block = bytes(memory[base + row * 40 + index] for index in range(40))
        result.append(block.decode('utf-16le').split('\0', 1)[0])
    return result


def verify():
    from check_tutorial_quest_native import Image, ENGINE_SHA
    sys.path[:0] = [str(ROOT / p) for p in ('tools', 'tools/dat', 'tools/uscript')]
    from extract_charcreate import decrypt, parse_chargrp
    from extract_uscript import sources_from_package
    from l2lib import load_package
    image = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    symbols = {
        '?GetPcMeshName@User@@QAE?AVFName@@H@Z': 0x10482c90,
        '?GetPcTexName@User@@QAE?AVFName@@HH@Z': 0x10486000,
        '?GetHairMeshType@User@@QAEHW4EPawnSubMeshStyle@@@Z': 0x10485ec0,
        '?HaveItem@User@@QAEHW4ItemSlotType@@@Z': 0x10480f40,
        '?HairDataLoad@FL2GameData@@IAEHH@Z': 0x10451720,
        '?HelmHairDataLoad@FL2GameData@@IAEHH@Z': 0x10466140,
        '?AccessaryHairDataLoad@FL2GameData@@IAEHH@Z': 0x104675f0,
    }
    for name, address in symbols.items():
        assert image.exported(name, True) == address
    anchors = [
        (0x1030bd0c, 'jmp', '0x10485ec0'),
        (0x1030bde3, 'jmp', '0x10482c90'),
        (0x1030a853, 'jmp', '0x10480f40'),
        # Reader alternates serialized words into two banks, not mesh/texture.
        (0x10451818, 'lea', 'ecx, [ebx + 0x1124]'),
        (0x1045181e, 'call', '0x10306e47'),
        (0x10306e47, 'jmp', '0x104460c0'),
        (0x104460ef, 'cmp', 'esi, 0xf'),
        (0x104460f9, 'cmp', 'edi, 0xf'),
        (0x104460fe, 'mov', 'eax, esi'),
        (0x10446100, 'shl', 'eax, 4'),
        (0x10446103, 'sub', 'eax, esi'),
        (0x10446105, 'add', 'eax, edi'),
        (0x1044610a, 'lea', 'edx, [ecx + eax*4]'),
        (0x1044610f, 'call', '0x1030599d'),
        (0x10446114, 'lea', 'eax, [esi + 0xf]'),
        (0x10446117, 'mov', 'ecx, eax'),
        (0x10446119, 'shl', 'ecx, 4'),
        (0x1044611c, 'sub', 'ecx, eax'),
        (0x1044611e, 'add', 'ecx, edi'),
        (0x10446123, 'lea', 'eax, [edx + ecx*4]'),
        (0x10446128, 'call', '0x1030599d'),
        (0x1030599d, 'jmp', '0x10330040'),
        (0x10330049, 'push', '4'),
        # The selector's ordinary model/style/color address arithmetic.
        (0x1048391c, 'mov', 'ecx, dword ptr [edx + 0x698]'),
        (0x10483924, 'shl', 'edi, 4'),
        (0x10483927, 'sub', 'edi, ecx'),
        (0x10483929, 'add', 'edi, dword ptr [ebx + 0x240]'),
        (0x1048392f, 'cmp', 'dword ptr [eax + edi*4], -1'),
        (0x10483963, 'push', '0x1089cfe4'),
        (0x104839d8, 'mov', 'eax, 0x10b3d9b4'),
        (0x10483a41, 'add', 'ecx, 0xf'),
        (0x10483a4b, 'add', 'edi, dword ptr [ebx + 0x240]'),
        (0x10483a51, 'cmp', 'dword ptr [eax + edi*4], -1'),
        (0x10483a8e, 'push', '0x1089cfb4'),
        (0x1048696f, 'mov', 'esi, dword ptr [edi + 0x244]'),
        (0x10486975, 'push', 'esi'),
        (0x10486989, 'push', '0x1089dc04'),
        (0x10486a67, 'add', 'ecx, 0xf'),
        (0x10486a71, 'add', 'esi, dword ptr [edi + 0x240]'),
        (0x10486a91, 'mov', 'esi, dword ptr [edi + 0x244]'),
        (0x10486aae, 'push', '0x1089dbc8'),
        # Headgear keys come from GetPcMeshName and surviving digit arithmetic.
        (0x10485ee8, 'cmp', 'dword ptr [ecx + 8], 0'),
        (0x10485f0c, 'call', '0x1030bde3'),
        (0x10485f3f, 'push', '0x1089d4e0'),
        (0x10485f5b, 'movzx', 'ecx, word ptr [eax + 6]'),
        (0x10485f5f, 'sub', 'ecx, 0x30'),
        (0x10485f62, 'movzx', 'eax, word ptr [eax + 8]'),
        (0x10485f66, 'sub', 'eax, 0x30'),
        (0x10485f69, 'cmp', 'ecx, 9'),
        (0x10485f6c, 'ja', '0x10485f2a'),
        (0x10485f6e, 'cmp', 'eax, 9'),
        (0x10485f71, 'ja', '0x10485f2a'),
        (0x10485f73, 'lea', 'ecx, [ecx + ecx*4]'),
        (0x10485f76, 'lea', 'eax, [eax + ecx*2]'),
        (0x104838c3, 'push', '6'), (0x104838cf, 'push', '7'),
        (0x104838dd, 'push', '8'),
        (0x104838f1, 'push', '0x11'),
        (0x10483906, 'mov', 'ecx, dword ptr [0x10b3e0c0]'),
        (0x104839a6, 'push', '0x12'),
        (0x104839c7, 'mov', 'ecx, dword ptr [0x10b3e0bc]'),
        (0x10480f4b, 'cmp', 'dword ptr [ecx + edx*4 + 0x98], eax'),
        (0x10480f52, 'setg', 'al'),
        # Both equipment DATs allocate the same 1800-byte table and read a key.
        (0x10466b9d, 'push', '4'), (0x10466bd7, 'push', '4'),
        (0x10466bb8, 'push', '0x708'),
        (0x10466be7, 'call', '0x10306e47'),
        (0x10466bf7, 'mov', 'ecx, dword ptr [edx + 0x182c]'),
        (0x1046804d, 'push', '4'), (0x10468087, 'push', '4'),
        (0x10468068, 'push', '0x708'),
        (0x10468097, 'call', '0x10306e47'),
        (0x104680a7, 'mov', 'ecx, dword ptr [edx + 0x1830]'),
        # Additional row-3 equipment overrides prevent an unconditional formula.
        (0x10483ba9, 'cmp', 'esi, 3'),
        (0x10483bb2, 'push', '2'),
        (0x10483c42, 'cmp', 'esi, 3'),
        (0x10486bc2, 'cmp', 'ebx, 3'),
        (0x10486ccd, 'cmp', 'ebx, 3'),
    ]
    for address, op, args in anchors:
        image.instruction(address, op, args)
    assert image.exported('?GL2GameData@@3VFL2GameData@@A') + 0x1124 == 0x10b3d9b4
    assert [image.u32(0x10483dbc + i * 4) for i in (4, 5)] == [0x104839e2, 0x104838c3]
    assert [image.u32(0x10486efc + i * 4) for i in (4, 5)] == [0x10486a08, 0x104868ef]
    assert image.wide(0x10895e1c) == 'Hairgrp.dat'
    assert image.wide(0x10898970) == 'Helmetgrp.dat'
    assert image.wide(0x10898dd8) == 'HairAccessarygrp.dat'
    assert image.wide(0x1089d4e0) == '_m0'
    templates = {'mesh1': image.wide(0x1089cfe4), 'mesh2': image.wide(0x1089cfb4),
                 'texture1': image.wide(0x1089dc04), 'texture2': image.wide(0x1089dbc8)}
    assert templates == {'mesh1': '%s.%s_m00%d_m00_ah', 'mesh2': '%s.%s_m00%d_m00_bh',
                         'texture1': '%s.%s_m00%d_t0%d_m00_ah', 'texture2': '%s.%s_m00%d_t0%d_m00_bh'}
    mesh_prefixes = copied_strings(image, 0x10482cd8, 0x104831e8, -0x370)
    packages = copied_strings(image, 0x104831fa, 0x104835d9, -0x690)
    texture_prefixes = copied_strings(image, 0x10486059, 0x1048656a, -0x378)
    assert mesh_prefixes == texture_prefixes
    package_path = ROOT / 'assets/interlude/system/Engine.u'
    package_sha = hashlib.sha256(package_path.read_bytes()).hexdigest()
    assert package_sha == '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761'
    package, _ = load_package(str(package_path))
    actor = dict(sources_from_package(package))['Actor']
    enum = re.search(r'enum EPawnSubMeshStyle\s*\{([^}]+)\}', actor).group(1)
    slots = [item.strip() for item in enum.split(',')]
    assert slots[4:9] == ['PMS_Hair2', 'PMS_Hair1', 'PMS_Helm', 'PMS_HairAcce1', 'PMS_HairAcce2']
    source = {}
    with tempfile.TemporaryDirectory() as temp:
        raw_char = decrypt('chargrp.dat', temp)
        chars = parse_chargrp(raw_char)
        tables = {}
        for filename, parser in [('hairgrp.dat', hair_pairs), ('helmetgrp.dat', keyed_hair_pairs),
                                 ('hairaccessarygrp.dat', keyed_hair_pairs)]:
            raw = decrypt(filename, temp)
            source[filename] = {'SHA256': hashlib.sha256((ROOT / 'assets/interlude/system' / filename).read_bytes()).hexdigest(),
                                'decodedSHA256': hashlib.sha256(raw).hexdigest()}
            tables[filename] = parser(raw)
    for row, char in enumerate(chars):
        # Independent original Chargrp identity agrees with literal native row.
        assert char['face_mesh'][0].casefold() == f'{packages[row]}.{mesh_prefixes[row]}_m000_f'.casefold()
    ranges = [(0x104460c0, 0x10446152), (0x10482cd8, 0x104831e8),
              (0x104831fa, 0x104835d9), (0x10486059, 0x1048656a),
              (0x104838c3, 0x10483b0a), (0x10485ec0, 0x10485f8a),
              (0x104868ef, 0x10486b2f), (0x10483ba9, 0x10483cd2),
              (0x10486bc2, 0x10486e25)]
    return {'format': 'elbera-hair-selector-evidence-v1', 'engineSHA256': image.sha,
            'enginePackageSHA256': package_sha, 'instructionChecks': len(anchors),
            'ranges': [{'startVA': hex(a), 'endVAExclusive': hex(b),
                        'SHA256': hashlib.sha256(image.data[image.offset(a):image.offset(b)]).hexdigest()}
                       for a, b in ranges],
            'source': source, 'templates': templates,
            'rows': [{'row': row, 'meshPackage': packages[row], 'prefix': mesh_prefixes[row],
                      'pairs': tables['hairgrp.dat'][row]} for row in range(14)],
            'equipmentTableKeys': {key: [row['key'] for row in table] for key, table in tables.items()
                                   if key != 'hairgrp.dat'},
            'limits': ['ordinary native row and layer-zero formulas; not complete hair renderer parity',
                       'headgear mesh naming/string helper imports and table lookup implementation remain partially erased',
                       'row 3 upper-body overrides are recorded, not executed by this verifier',
                       'valid creation-control style/color bounds are separate from the 15 source table slots',
                       'source FinalBlend/Texture material graphs require independent render-state admission']}


def audit_assets(proof):
    """Fresh original export join and default built names; no asset conversion."""
    from l2lib import load_package
    from check_cast_sound_native import model_voice_source
    from check_player_transform_native import original_lod0_points, accessor_positions, converted_position
    join = model_voice_source()['modelMeshTypes']
    manifest = json.loads((ROOT / 'editor/characters/manifest.json').read_text())
    cache = {}
    def source_package(directory, name):
        key = (directory, name.casefold())
        if key not in cache:
            paths = [p for p in (ROOT / 'assets/interlude' / directory).iterdir() if p.stem.casefold() == name.casefold()]
            if len(paths) != 1:
                raise ValueError('missing/ambiguous source package: ' + name)
            package, _ = load_package(str(paths[0]))
            cache[key] = (package, hashlib.sha256(paths[0].read_bytes()).hexdigest())
        return cache[key]
    result = []
    for model in manifest['models']:
        row = proof['rows'][join[model['id']]]
        mesh_package, mesh_sha = source_package('animations', row['meshPackage'])
        texture_package, texture_sha = source_package('systextures', row['prefix'])
        gltf_path = ROOT / 'editor/characters' / model['gltf']
        gltf = json.loads(gltf_path.read_text())
        buffers = [(gltf_path.parent / item['uri']).read_bytes() for item in gltf['buffers']]
        source_refs, missing = [], []
        for style, pair in enumerate(row['pairs']):
            for part, index in enumerate(pair, 1):
                if index == -1:
                    continue
                ref = proof['templates']['mesh' + str(part)] % (row['meshPackage'], row['prefix'], index)
                name = ref.split('.')[1]
                candidates = [e for e in mesh_package.exports_by_class('SkeletalMesh')
                              if mesh_package.export_name(e).casefold() == name.casefold() and e.package_index == 0]
                if len(candidates) != 1:
                    missing.append(ref)
                    continue
                # Colors 0..3 are an explicit audit probe, not a UI bounds proof.
                colors = []
                for color in range(4):
                    texture = proof['templates']['texture' + str(part)] % (row['prefix'], row['prefix'], index, color)
                    target = [e for e in texture_package.exports
                              if texture_package.export_name(e).casefold() == texture.split('.')[1].casefold()
                              and texture_package.class_name_of(e) != 'Package']
                    if len(target) != 1:
                        missing.append(texture)
                        continue
                    names = [texture_package.export_name(target[0])]
                    outer, seen = target[0].package_index, set()
                    while outer:
                        if outer < 0 or outer in seen:
                            raise ValueError('unsupported hair material outer chain')
                        seen.add(outer)
                        parent = texture_package.exports[outer - 1]
                        names.insert(0, texture_package.export_name(parent))
                        outer = parent.package_index
                    colors.append({'color': color, 'reference': texture,
                                   'qualifiedObject': row['prefix'] + '.' + '.'.join(names),
                                   'referenceResolution': 'unique-package-leaf; native resolver unverified',
                                   'class': texture_package.class_name_of(target[0])})
                record = {'style': style, 'part': part, 'reference': ref, 'colors': colors}
                if style == 0:
                    built = [m for m in gltf['meshes'] if m.get('name', '').casefold() == name.casefold()]
                    if len(built) != 1:
                        raise ValueError('missing/ambiguous built default hair: ' + ref)
                    source_positions = {converted_position(p) for p in original_lod0_points(mesh_package, candidates[0])}
                    if source_positions != accessor_positions(gltf, buffers, built[0]['name']):
                        raise ValueError('built default hair differs from source LOD0: ' + ref)
                    record['builtDefault'] = {'name': built[0]['name'], 'originalPositionCount': len(source_positions)}
                source_refs.append(record)
        expected = {r['reference'].split('.')[1].casefold() for r in source_refs if r['style'] == 0}
        built = {m.get('name', '').casefold() for m in gltf['meshes'] if m.get('name', '').lower().endswith(('_ah', '_bh'))}
        if expected != built:
            raise ValueError('built extra/missing default hair part: ' + model['id'])
        result.append({'modelId': model['id'], 'row': row['row'], 'meshPackageSHA256': mesh_sha,
                       'texturePackageSHA256': texture_sha,
                       'gltfSHA256': hashlib.sha256(gltf_path.read_bytes()).hexdigest(),
                       'sourceReferences': source_refs, 'missing': missing})
    return {'models': result, 'limits': ['default source LOD0 POSITION sets only; UVs, skin weights and material parity not certified',
                                      'nondefault original exports are present, but this audit does not build them',
                                      'material exports match unique package leaf names; omitted Hair group resolution is not natively bound',
                                      'four probed texture colors do not establish creation-control bounds']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--audit-assets', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = verify()
    if args.audit_assets:
        result['assetAudit'] = audit_assets(result)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(f"PASS Elbera Tools hair selector: {result['instructionChecks']} anchors; 14 rows; "
          f"equipment keys {result['equipmentTableKeys']}" if args.check else json.dumps(result, indent=2))
