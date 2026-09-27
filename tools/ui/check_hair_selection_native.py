#!/usr/bin/env python3
"""Elbera Tools: original ordinary hair selection, without native execution.

--check requires the owner's pinned Engine/Core/D3DDrv binaries, Engine.u and
original DAT files. Native material state is bounded to unmodified hair graphs.
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


def reflected_chain(package, owner, expected):
    """Read UField.Next; declaration text/order alone does not bind bitfields."""
    from l2lib import Reader
    owners = [e for e in package.exports_by_class('Class') if package.export_name(e) == owner]
    if len(owners) != 1:
        raise ValueError('missing or ambiguous reflected class: ' + owner)
    rows = {}
    for entry in package.exports:
        if entry.package_index != owners[0].index + 1 or not package.class_name_of(entry).endswith('Property'):
            continue
        raw = package.data[entry.serial_offset:entry.serial_offset + entry.serial_size]
        reader = Reader(raw)
        if package.name(reader.compact()) != 'None' or reader.compact() != 0:
            raise ValueError('unsupported reflected property prefix')
        next_ref, dim, flags = reader.compact(), reader.u32(), reader.u32()
        package.name(reader.compact())
        rows[entry.index + 1] = {'name': package.export_name(entry), 'kind': package.class_name_of(entry),
            'next': next_ref, 'dim': dim, 'flags': flags, 'tail': raw[reader.pos:].hex(),
            'SHA256': hashlib.sha256(raw).hexdigest()}
    starts = [ref for ref, row in rows.items() if row['name'] == expected[0][0]]
    if len(starts) != 1:
        raise ValueError('missing or ambiguous reflected chain start')
    ref, = starts
    chain = []
    for name, kind in expected:
        row = rows.get(ref)
        if not row or (row['name'], row['kind'], row['dim']) != (name, kind, 1):
            raise ValueError('original reflected chain differs: ' + name)
        chain.append({'exportRef': ref, **row})
        ref = row['next']
    return chain


def hair_material_state(class_name, properties, child=None):
    """Admit only observed plain Texture / FinalBlend->Texture state graphs.

    The exporter must freshly verify native evidence, exact export references,
    property types/widths, and original pixels separately. Values here are
    decoded typed properties; Material keeps {'reference': qualifiedPath}.
    A FinalBlend child must explicitly carry its class and typed properties.
    Returning state does not certify skinning, lighting or texture filtering.
    """
    def unsupported(reason):
        return {'status': 'unsupported', 'reason': reason}
    def byte(props, name, default):
        value = props.get(name, default)
        if type(value) is not int or not 0 <= value <= 255:
            raise ValueError('invalid original byte: ' + name)
        return value
    def boolean(props, name, default=False):
        value = props.get(name, default)
        if type(value) is not bool:
            raise ValueError('invalid original boolean: ' + name)
        return value
    texture_fields = {'Format', 'InternalTime', 'UBits', 'VBits', 'USize', 'VSize', 'UClamp', 'VClamp',
                      'bMasked', 'bAlphaTexture', 'bTwoSided', 'UClampMode', 'VClampMode'}
    final_fields = {'Material', 'FrameBufferBlending', 'AlphaTest', 'AlphaRef', 'ZWrite', 'ZTest',
                    'TwoSided', 'TreatAsTwoSided'}
    if type(properties) is not dict or any(not isinstance(key, str) for key in properties):
        return unsupported('missing typed source properties')
    if class_name == 'Texture':
        if child is not None:
            return unsupported('plain Texture unexpectedly has a material child')
        texture = properties
    elif class_name == 'FinalBlend':
        if set(properties) - final_fields:
            return unsupported('unverified FinalBlend properties: ' + ', '.join(sorted(set(properties) - final_fields)))
        material = properties.get('Material')
        if type(material) is not dict or set(material) != {'reference'} \
                or not isinstance(material['reference'], str) or not material['reference']:
            return unsupported('FinalBlend has no exact source Material reference')
        if type(child) is not dict or child.get('class') != 'Texture' or type(child.get('properties')) is not dict:
            return unsupported('FinalBlend child is not a verified plain Texture')
        texture = child['properties']
    else:
        return unsupported('unverified hair material class: ' + str(class_name))
    if any(not isinstance(key, str) for key in texture):
        return unsupported('invalid Texture property name')
    if set(texture) - texture_fields:
        return unsupported('unverified Texture properties: ' + ', '.join(sorted(set(texture) - texture_fields)))
    try:
        masked, alpha, texture_two_sided = (boolean(texture, name)
                                           for name in ('bMasked', 'bAlphaTexture', 'bTwoSided'))
        u, v = byte(texture, 'UClampMode', 0), byte(texture, 'VClampMode', 0)
        if u not in (0, 1) or v not in (0, 1):
            return unsupported('unverified source texture addressing mode')
        if class_name == 'FinalBlend':
            mode = byte(properties, 'FrameBufferBlending', 0)
            alpha_test, alpha_ref = boolean(properties, 'AlphaTest'), byte(properties, 'AlphaRef', 0)
            depth_write, depth_test = boolean(properties, 'ZWrite', True), boolean(properties, 'ZTest', True)
            two_sided = boolean(properties, 'TwoSided')
            # This separate source hint is retained, not used as an alias for
            # the different TwoSided bit actually copied into D3D pass state.
            treat_as_two_sided = boolean(properties, 'TreatAsTwoSided')
        else:
            # bMasked precedes bAlphaTexture in the original branch.
            mode, alpha_test, alpha_ref = ((0, True, 127) if masked else
                                          (2, True, 0) if alpha else (0, False, 0))
            depth_write = depth_test = True
            two_sided, treat_as_two_sided = texture_two_sided, None
    except ValueError as error:
        return unsupported(str(error))
    blends = {0: {'source': 2, 'destination': 1, 'enabled': False},
              2: {'source': 5, 'destination': 6, 'enabled': True}}
    if mode not in blends:
        return unsupported('unverified FinalBlend blend arm: ' + str(mode))
    return {'status': 'supported-state', 'kind': 'texture' if class_name == 'Texture' else 'finalblend-texture',
        'frameBufferBlending': mode, 'blend': blends[mode], 'alphaTest': alpha_test,
        'alphaRef': alpha_ref, 'alphaCompare': 'greater', 'depthWrite': depth_write,
        'depthTest': depth_test, 'twoSided': two_sided, 'treatAsTwoSided': treat_as_two_sided,
        'sourceTextureFlags': {'bMasked': masked, 'bAlphaTexture': alpha, 'bTwoSided': texture_two_sided},
        'sampling': {'uClampMode': u, 'vClampMode': v, 'status': 'source-address-branch-only'},
        'scope': 'ordinary unmodified material; no actor/ColorModifier overrides or full rendering parity'}


def verify_material_native(engine, package):
    """Ordinary unmodified Texture/FinalBlend states, not full renderer parity.

    This proof is independent of the NPC/Angel graph admission rules. It uses
    the actual UTexture and UFinalBlend reflected fields, typed native copies,
    named D3D imports, and the shared render-state transfer path.
    """
    from check_tutorial_quest_native import Image
    from check_skillanim_native import CORE_SHA
    from check_npc_material_native import D3D_SHA
    from check_numberpad_native import import_names
    from extract_uscript import sources_from_package
    from export_npc_visuals import OriginalClasses, terminal_defaults
    core = Image(ROOT / 'assets/interlude/system/core.dll', CORE_SHA)
    d3d = Image(ROOT / 'assets/interlude/system/D3DDrv.dll', D3D_SHA)
    scripts = dict(sources_from_package(package))
    enums = {}
    for owner, enum, prefix in [('BitmapMaterial', 'ETexClampMode', 'TC_'),
                                ('FinalBlend', 'EFrameBufferBlending', 'FB_')]:
        body = re.search(r'enum ' + enum + r'\s*\{([^}]+)\}', scripts[owner]).group(1)
        enums[enum] = re.findall(prefix + r'\w+', body)
    assert enums['ETexClampMode'] == ['TC_Wrap', 'TC_Clamp']
    assert enums['EFrameBufferBlending'][:3] == ['FB_Overwrite', 'FB_Modulate', 'FB_AlphaBlend']
    chains = {
        'Texture': reflected_chain(package, 'Texture', [('Specular', 'FloatProperty'),
            ('bMasked', 'BoolProperty'), ('bAlphaTexture', 'BoolProperty'), ('bTwoSided', 'BoolProperty')]),
        'BitmapMaterial': reflected_chain(package, 'BitmapMaterial', [('Format', 'ByteProperty'),
            ('UClampMode', 'ByteProperty'), ('VClampMode', 'ByteProperty'), ('UBits', 'ByteProperty')]),
        'FinalBlend': reflected_chain(package, 'FinalBlend', [('FrameBufferBlending', 'ByteProperty'),
            ('ZWrite', 'BoolProperty'), ('ZTest', 'BoolProperty'), ('AlphaTest', 'BoolProperty'),
            ('TwoSided', 'BoolProperty'), ('AlphaRef', 'ByteProperty'), ('TreatAsTwoSided', 'BoolProperty')]),
    }
    symbols = {
        '??0UTexture@@QAE@ABV0@@Z': 0x103f1280,
        '??0UBitmapMaterial@@QAE@ABV0@@Z': 0x10333b00,
        '??0UFinalBlend@@QAE@ABV0@@Z': 0x1034a010,
        '?GetUClamp@FStaticTexture@@UAE?AW4ETexClampMode@@XZ': 0x1073e2b0,
        '?GetVClamp@FStaticTexture@@UAE?AW4ETexClampMode@@XZ': 0x1073e2c0,
    }
    for name, address in symbols.items():
        assert engine.exported(name, True) == address
    imports = import_names(d3d)
    assert imports[0x100dd39c] == ('Engine.dll', '?StaticClass@UTexture@@SAPAVUClass@@XZ')
    assert imports[0x100dd3d0] == ('Engine.dll', '?StaticClass@UFinalBlend@@SAPAVUClass@@XZ')
    assert imports[0x100dd130] == ('Core.dll', '?IsA@UObject@@QBEHPAVUClass@@@Z')
    assert d3d.wide(0x100e0128) == 'FD3DRenderInterface::SetSimpleMaterial'
    engine_anchors = [
        (0x103f1329, 'fld', 'dword ptr [edi + 0x5bc]'),
        (0x103f133b, 'and', 'ecx, 1'), (0x103f133e, 'xor', 'dword ptr [esi + 0x5c0], ecx'),
        (0x103f1352, 'and', 'eax, 2'), (0x103f1357, 'mov', 'dword ptr [esi + 0x5c0], eax'),
        (0x103f1365, 'and', 'ecx, 4'), (0x103f136a, 'mov', 'dword ptr [esi + 0x5c0], ecx'),
        (0x10333b36, 'movzx', 'eax, byte ptr [edi + 0x578]'),
        (0x10333b43, 'movzx', 'ecx, byte ptr [edi + 0x579]'),
        (0x10333b50, 'mov', 'dl, byte ptr [edi + 0x57a]'),
        (0x10333b5c, 'movzx', 'eax, byte ptr [edi + 0x57b]'),
        (0x1073e2b0, 'mov', 'eax, dword ptr [ecx + 0xc]'),
        (0x1073e2b3, 'movzx', 'eax, byte ptr [eax + 0x579]'),
        (0x1073e2c3, 'movzx', 'eax, byte ptr [eax + 0x57a]'),
        (0x1034a04c, 'movzx', 'eax, byte ptr [edi + 0x57c]'),
        (0x1034a05f, 'and', 'ecx, 1'), (0x1034a076, 'and', 'eax, 2'),
        (0x1034a089, 'and', 'ecx, 4'), (0x1034a09c, 'and', 'edx, 8'),
        (0x1034a0a7, 'movzx', 'eax, byte ptr [edi + 0x584]'),
    ]
    core_anchors = [
        # Consecutive reflected BoolProperty fields share a word and double masks.
        (0x101732a6, 'mov', 'eax, dword ptr [ebx + 0x54]'),
        (0x101732a9, 'mov', 'dword ptr [esi + 0x54], eax'),
        (0x101732ac, 'mov', 'ecx, dword ptr [edi + 0x78]'),
        (0x101732af, 'add', 'ecx, ecx'), (0x101732b1, 'mov', 'dword ptr [esi + 0x78], ecx'),
        (0x101732c9, 'mov', 'dword ptr [esi + 0x78], 1'),
        # InitProperties copies inherited/default bytes, zeroes the new tail.
        (0x1015fb45, 'mov', 'ecx, 0x34'),
        (0x1015fb7d, 'mov', 'eax, dword ptr [ebp + 0xc]'),
        (0x1015fb84, 'sub', 'eax, ecx'), (0x1015fb87, 'add', 'ecx, edi'),
        (0x1015fb8a, 'call', '0x101022e3'),
        (0x1015fbff, 'call', '0x1017ac60'), (0x1015fc07, 'mov', 'ecx, ebx'),
        (0x1015fc09, 'jmp', '0x1015fb7d'),
        (0x101022e3, 'jmp', '0x10108420'), (0x1010842a, 'xor', 'eax, eax'),
        (0x10108434, 'rep stosd', 'dword ptr es:[edi], eax'),
        (0x10108438, 'rep stosb', 'byte ptr es:[edi], al'),
        (0x1015fe73, 'push', '0'), (0x1015fe75, 'push', '0'),
        (0x1015fe81, 'call', '0x1010119f'), (0x1010119f, 'jmp', '0x1015fb00'),
    ]
    d3d_anchors = [
        # SetMaterial constructs modifier info before unwrapping the graph.
        (0x10029120, 'lea', 'ecx, [ebp - 0xa8]'), (0x10029126, 'call', '0x10007630'),
        (0x10007652, 'xor', 'ebx, ebx'), (0x10007670, 'mov', 'dword ptr [ebp + 4], ebx'),
        (0x10007673, 'mov', 'dword ptr [ebp + 8], ebx'), (0x10007689, 'mov', 'eax, 1'),
        (0x1000769c, 'mov', 'byte ptr [ebp + 0x58], bl'),
        (0x1000769f, 'mov', 'dword ptr [ebp + 0x5c], eax'),
        (0x100076a2, 'mov', 'dword ptr [ebp + 0x60], eax'),
        (0x100076a5, 'mov', 'dword ptr [ebp + 0x64], ebx'),
        (0x100076a8, 'mov', 'dword ptr [ebp + 0x68], ebx'),
        (0x100076ab, 'mov', 'byte ptr [ebp + 0x6c], bl'),
        # Fresh pass defaults and actual SetMaterial template-copy path.
        (0x10007caa, 'xor', 'eax, eax'),
        (0x10007cb9, 'mov', 'dword ptr [esi + 4], eax'),
        (0x10007cbc, 'mov', 'dword ptr [esi + 8], eax'),
        (0x10007cbf, 'mov', 'byte ptr [esi + 0xc], al'),
        (0x10007cc2, 'mov', 'dword ptr [esi + 0x18], eax'),
        (0x10007ccf, 'mov', 'dword ptr [esi + 0x10], 1'),
        (0x10007cd6, 'mov', 'dword ptr [esi + 0x14], 1'),
        (0x10007cac, 'mov', 'ecx, 2'),
        (0x10007ce0, 'mov', 'dword ptr [esi + 0x24], ecx'),
        (0x10007ce3, 'mov', 'dword ptr [esi + 0x28], 1'),
        (0x100272fe, 'lea', 'ecx, [esi + 0x4dc14]'), (0x10027304, 'call', '0x10007c80'),
        (0x10028fc3, 'lea', 'eax, [ebx + 0x4dc14]'), (0x10028fd0, 'call', '0x10015f10'),
        (0x10028fdb, 'mov', 'dword ptr [ecx + 0x538], eax'),
        (0x10015f7e, 'push', '0xdc4'), (0x10015f83, 'push', 'eax'),
        (0x10015f84, 'push', 'esi'), (0x10015f85, 'call', '0x100c2660'),
        # Real class test, not a coincident offset in another material type.
        (0x1000faa9, 'call', 'dword ptr [0x100dd39c]'),
        (0x1000fab2, 'call', 'dword ptr [0x100dd130]'),
        (0x1000ce1f, 'cmp', 'dword ptr [ebp + 0x10], esi'),
        (0x1000ce22, 'jne', '0x1000ceef'),
        (0x1000ce2c, 'call', '0x1000faa0'),
        (0x1000ce3c, 'mov', 'ecx, dword ptr [eax + 0x5c0]'),
        (0x1000ce42, 'test', 'cl, 1'), (0x1000ce45, 'je', '0x1000ce82'),
        (0x1000ce5d, 'mov', 'byte ptr [ebp + 0x64], 0'),
        (0x1000ce61, 'mov', 'dword ptr [ebp + 0x68], edi'),
        (0x1000ce64, 'mov', 'dword ptr [ebp + 0x6c], edi'),
        (0x1000ce67, 'mov', 'dword ptr [ebp + 0x70], edi'),
        (0x1000ce6a, 'mov', 'byte ptr [ebp + 0x78], 0x7f'),
        (0x1000ce78, 'shr', 'ecx, 2'), (0x1000ce7d, 'mov', 'dword ptr [ebp + 0x74], ecx'),
        (0x1000ce82, 'test', 'cl, 2'), (0x1000ce8a, 'mov', 'byte ptr [ebp + 0x64], 2'),
        (0x1000ce97, 'mov', 'byte ptr [ebp + 0x78], 0'),
        (0x1000ceb0, 'test', 'cl, 4'), (0x1000ceb3, 'je', '0x1000cecd'),
        (0x1000cec3, 'shr', 'ecx, 2'),
        (0x1000cec8, 'mov', 'dword ptr [ebp + 0x74], ecx'),
        (0x1000ceda, 'mov', 'dword ptr [ebp + 0x74], esi'),
        (0x1000d173, 'lea', 'edx, [ebp + 0xc]'), (0x1000d179, 'call', '0x1000f4a0'),
        # FinalBlend's explicit state suppresses those Texture-flag overrides.
        (0x10011143, 'call', 'dword ptr [0x100dd3d0]'),
        (0x1001114c, 'call', 'dword ptr [0x100dd130]'),
        (0x10011156, 'mov', 'dword ptr [edi + 4], esi'),
        (0x10011159, 'mov', 'al, byte ptr [ebx + 0x57c]'),
        (0x1001115f, 'mov', 'byte ptr [edi + 0x58], al'),
        (0x1001116a, 'mov', 'dword ptr [edi + 0x5c], ecx'),
        (0x10011173, 'shr', 'edx, 1'), (0x10011177, 'mov', 'dword ptr [edi + 0x60], edx'),
        (0x10011180, 'shr', 'eax, 2'), (0x10011185, 'mov', 'dword ptr [edi + 0x64], eax'),
        (0x1001118e, 'shr', 'ecx, 3'), (0x10011193, 'mov', 'dword ptr [edi + 0x68], ecx'),
        (0x10011196, 'mov', 'dl, byte ptr [ebx + 0x584]'),
        (0x1001119c, 'mov', 'byte ptr [edi + 0x6c], dl'),
        # FB_Overwrite and FB_AlphaBlend, then common alpha/depth/cull transfer.
        (0x1000f4ef, 'jmp', 'dword ptr [eax*4 + 0x1000f8b8]'),
        (0x1000f502, 'mov', 'dword ptr [ecx + 0x24], 2'),
        (0x1000f515, 'mov', 'dword ptr [eax + 0x28], edi'),
        (0x1000f524, 'mov', 'dword ptr [edx + 4], 0'),
        (0x1000f53c, 'mov', 'dword ptr [ecx + 0x24], 5'),
        (0x1000f54f, 'mov', 'dword ptr [eax + 0x28], 6'),
        (0x1000f562, 'mov', 'dword ptr [edx + 4], edi'),
        (0x1000f81f, 'mov', 'eax, dword ptr [ebx + 0x5c]'),
        (0x1000f822, 'mov', 'dword ptr [edx + 0x14], eax'),
        (0x1000f831, 'mov', 'eax, dword ptr [ebx + 0x60]'),
        (0x1000f834, 'mov', 'dword ptr [edx + 0x10], eax'),
        (0x1000f843, 'mov', 'eax, dword ptr [ebx + 0x68]'),
        (0x1000f846, 'mov', 'dword ptr [edx + 0x18], eax'),
        (0x1000f855, 'mov', 'eax, dword ptr [ebx + 0x64]'),
        (0x1000f858, 'mov', 'dword ptr [edx + 8], eax'),
        (0x1000f867, 'mov', 'al, byte ptr [ebx + 0x6c]'),
        (0x1000f86a, 'mov', 'byte ptr [edx + 0xc], al'),
        (0x10022fb4, 'movzx', 'ecx, byte ptr [ebx + 0xc]'),
        (0x10022fc0, 'mov', 'dword ptr [eax + 0x20], ecx'),
        (0x10022fcb, 'mov', 'dword ptr [eax + 0x24], 5'),
        (0x10022fe2, 'mov', 'dword ptr [eax + 0xc], ecx'),
        (0x10023045, 'cmp', 'dword ptr [ebx + 0x14], edx'),
        (0x10023053, 'mov', 'dword ptr [eax + 8], edx'),
        (0x10023056, 'cmp', 'dword ptr [ebx + 0x18], 0'),
        (0x1002305c, 'jne', '0x10023061'),
        (0x1002305e, 'mov', 'edx, dword ptr [ebp + 0xc]'),
        (0x10023069, 'mov', 'dword ptr [eax + 0x18], edx'),
        (0x1002ef21, 'push', '0xf'), (0x1002efe4, 'push', '0x18'), (0x1002f00b, 'push', '0x19'),
        # Source address modes, conditional on the preceding resource override.
        (0x1000f406, 'cmp', 'dword ptr [eax + 0x3c], 0'),
        (0x1000f415, 'mov', 'dword ptr [ebx + 0x104], edx'),
        (0x1000f42a, 'jmp', '0x1000f477'),
        (0x1000f42c, 'movzx', 'eax, byte ptr [edi + 0x579]'),
        (0x1000f436, 'mov', 'ecx, 3'), (0x1000f43b, 'je', '0x1000f44a'),
        (0x1000f442, 'mov', 'dword ptr [ebx + 0x104], ecx'),
        (0x1000f44a, 'mov', 'dword ptr [ebx + 0x104], 1'),
        (0x1000f454, 'movzx', 'eax, byte ptr [edi + 0x57a]'),
        (0x1000f465, 'mov', 'dword ptr [ebx + 0x108], ecx'),
        (0x1000f46d, 'mov', 'dword ptr [ebx + 0x108], 1'),
    ]
    for image, anchors in [(engine, engine_anchors), (core, core_anchors), (d3d, d3d_anchors)]:
        for address, mnemonic, operands in anchors:
            image.instruction(address, mnemonic, operands)
    assert core.exported('?Link@UBoolProperty@@UAEXAAVFArchive@@PAVUProperty@@@Z', True) == 0x10173250
    assert core.exported('?InitProperties@UObject@@SAXPAEHPAVUClass@@0HPAV1@2@Z', True) == 0x1015fb00
    assert [d3d.u32(0x1000f8b8 + i * 4) for i in (0, 2)] == [0x1000f4f6, 0x1000f530]
    classes = OriginalClasses()
    defaults = {}
    for name in ('BitmapMaterial', 'Texture', 'FinalBlend'):
        types = classes.property_types('Engine.' + name, set())
        pkg = classes.packages['Engine']
        export, = [e for e in pkg.exports_by_class('Class') if pkg.export_name(e) == name]
        properties, evidence = terminal_defaults(pkg, export, types)
        assert evidence['defaultsBoundary'] == 'unique-validated-candidate'
        defaults[name] = {'properties': properties, **evidence}
    assert defaults['BitmapMaterial']['properties'] == []
    assert defaults['FinalBlend']['properties'] == [('ZWrite', 'bool', True), ('ZTest', 'bool', True)]
    assert defaults['Texture']['properties'] == [('DetailScale', 'float', 8.0),
        ('MipZero', 'struct', ('Color', '40804000')), ('MaxColor', 'struct', ('Color', 'ffffffff')),
        ('LODSet', 'byte', 1)]
    ranges = [(engine, 0x103f1280, 0x103f13e7), (engine, 0x10333b00, 0x10333bb2),
        (engine, 0x1034a010, 0x1034a0c9), (core, 0x10173250, 0x101732da),
        (core, 0x1015fb45, 0x1015fc11), (core, 0x10108420, 0x1010843d),
        (d3d, 0x1000ce1f, 0x1000ceef), (d3d, 0x10011143, 0x1001119f),
        (d3d, 0x1000f4df, 0x1000f568), (d3d, 0x1000f813, 0x1000f870),
        (d3d, 0x1000f3fc, 0x1000f477), (d3d, 0x10007c80, 0x10007cef),
        (d3d, 0x10015f76, 0x10015f9c), (d3d, 0x10028fc3, 0x10028fe1),
        (d3d, 0x10007652, 0x100076ae)]
    return {'format': 'elbera-hair-material-native-v1', 'status': 'bounded-states-verified',
        'engineSHA256': engine.sha, 'coreSHA256': core.sha, 'd3dSHA256': d3d.sha,
        'instructionChecks': sum(map(len, (engine_anchors, core_anchors, d3d_anchors))),
        'propertyChains': chains, 'enums': enums, 'classDefaults': defaults,
        'textureFlags': {'offset': '0x5c0', 'bMasked': 1, 'bAlphaTexture': 2, 'bTwoSided': 4},
        'maskedTexture': {'alphaRef': 127, 'alphaCompare': 'greater', 'frameBufferBlending': 0},
        'alphaTexture': {'alphaRef': 0, 'alphaCompare': 'greater', 'frameBufferBlending': 2},
        'opaqueTexture': {'alphaTest': False, 'frameBufferBlending': 0},
        'blendModes': {'0': {'source': 2, 'destination': 1, 'enabled': False},
                       '2': {'source': 5, 'destination': 6, 'enabled': True}},
        'sampling': {'sourceUDefault': 0, 'sourceVDefault': 0, 'addressState': {'0': 1, '1': 3},
                     'status': 'source-address-branch-only', 'filtering': 'unverified',
                     'mipSelection': 'unverified', 'resourceOverride': 'unverified'},
        'ranges': [{'imageSHA256': im.sha, 'startVA': hex(a), 'endVAExclusive': hex(b),
                    'SHA256': hashlib.sha256(im.data[im.offset(a):im.offset(b)]).hexdigest()}
                   for im, a, b in ranges],
        'limits': ['ordinary material state without ColorModifier/actor override; not full D3D pass parity',
                   'only FB_Overwrite and FB_AlphaBlend switch arms admitted',
                   'source clamp modes do not certify filtering, authored mip chains or resource overrides',
                   'original graph identity and extra properties require per-object admission']}


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
            'source': source, 'templates': templates, 'materialProof': verify_material_native(image, package),
            'rows': [{'row': row, 'meshPackage': packages[row], 'prefix': mesh_prefixes[row],
                      'pairs': tables['hairgrp.dat'][row]} for row in range(14)],
            'equipmentTableKeys': {key: [row['key'] for row in table] for key, table in tables.items()
                                   if key != 'hairgrp.dat'},
            'limits': ['ordinary native row and layer-zero formulas; not complete hair renderer parity',
                       'headgear mesh naming/string helper imports and table lookup implementation remain partially erased',
                       'row 3 upper-body overrides are recorded, not executed by this verifier',
                       'valid creation-control style/color bounds are separate from the 15 source table slots',
                       'bounded Texture/FinalBlend states are verified; graph bindings, sampling and full render parity remain separate']}


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
    print(f"PASS Elbera Tools hair selector: {result['instructionChecks']} selector anchors; "
          f"{result['materialProof']['instructionChecks']} material anchors; 14 rows; "
          f"equipment keys {result['equipmentTableKeys']}" if args.check else json.dumps(result, indent=2))
