#!/usr/bin/env python3
"""Elbera Tools: verify original NPC skin binding and bounded material states.

No DLL execution, decoded binary output or emulator-derived rules. Requires the
owner's pinned Interlude files. Public output is provenance and recovered facts.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys

from check_tutorial_quest_native import Image, ENGINE_SHA, ROOT

D3D_SHA = '05622ddea5d96aec5618bc1ae064af9d27d83178f78d9631b5448377502e1323'


def verify():
    engine = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, decode=True)
    d3d = Image(ROOT / 'assets/interlude/system/D3DDrv.dll', D3D_SHA)
    checks = 0
    def instruction(image, rva, mnemonic, operands):
        nonlocal checks
        image.instruction(image.base + rva, mnemonic, operands)
        checks += 1
    # Serializer identifies the primary fixed name array and separate alternate.
    for rva, mnemonic, operands in [
        (0x165561, 'lea', 'eax, [esi + 0x28]'),
        (0x165576, 'lea', 'ecx, [esi + ebx*4 + 0x2c]'),
        (0x1845cb, 'mov', 'eax, dword ptr [eax + 0x28]'),
        (0x1844d3, 'mov', 'edx, dword ptr [esi + ebx*4 + 0x2c]'),
        (0x184495, 'push', '0x8000'),
        (0x1844a7, 'mov', 'eax, dword ptr [esi + 0x44]'),
        (0x1844b1, 'mov', 'edx, dword ptr [esi + 0x40]'),
        (0x187434, 'push', 'ebx'), (0x18743c, 'call', '0x10304f11'),
        (0x187441, 'push', 'ebx'), (0x187445, 'push', '9'),
        (0x18744b, 'call', 'edx'), (0x18744d, 'add', 'ebx, 1'),
        (0x31e940, 'cmp', 'ebx, ebp'),
        (0x31e945, 'lea', 'ecx, [esi + 0x298]'),
        (0x31e964, 'lea', 'ecx, [esi + 0x298]'),
        (0x31e96a, 'call', '0x10314f7e'),
        (0x193f85, 'mov', 'dword ptr [ecx + eax*4], edx'),
        (0x22cfa4, 'cmp', 'eax, dword ptr [ecx + 0x29c]'),
        (0x22cfac, 'mov', 'ecx, dword ptr [ecx + 0x298]'),
        (0x22cfb2, 'mov', 'eax, dword ptr [ecx + eax*4]'),
    ]:
        instruction(engine, rva, mnemonic, operands)
    pawn_vtable = engine.exported('??_7APawn@@6B@')
    assert engine.u32(pawn_vtable + 0xd4) == engine.exported('?SetTexes@APawn@@UAEXHVFName@@H@Z')
    entry = engine.data[0x31ea88 + 9]
    assert engine.u32(engine.base + 0x31ea6c + entry * 4) == engine.base + 0x31e940
    # Bound the source read to the TextBuffer export, never the entire package.
    sys.path.insert(0, str(ROOT / 'tools/src/char_pipeline'))
    import uclass_defaults
    pkg = uclass_defaults.load('Engine.u')
    found = []
    for export in pkg.exports:
        if pkg.class_name_of(export) != 'TextBuffer':
            continue
        raw = pkg.data[export.serial_offset:export.serial_offset + export.serial_size]
        match = re.search(rb'class\s+Shader\s+extends\s+RenderedMaterial', raw)
        if match:
            source = raw[match.start():].split(b'\0')[0]
            found.append(source)
    assert len(found) == 1
    enum = re.search(rb'enum EOutputBlending\s*\{([^}]+)\}', found[0]).group(1)
    values = re.findall(rb'OB_\w+', enum)
    assert values[5] == b'OB_Brighten' and len(values) == 7
    final_sources = []
    for export in pkg.exports:
        if pkg.class_name_of(export) != 'TextBuffer':
            continue
        raw = pkg.data[export.serial_offset:export.serial_offset + export.serial_size]
        match = re.search(rb'class\s+FinalBlend\s+extends\s+Modifier', raw)
        if match:
            final_sources.append(raw[match.start():].split(b'\0')[0])
    assert len(final_sources) == 1
    final_enum = re.search(rb'enum EFrameBufferBlending\s*\{([^}]+)\}', final_sources[0]).group(1)
    assert re.findall(rb'FB_\w+', final_enum)[2] == b'FB_AlphaBlend'
    # FinalBlend's missing per-object ZWrite/ZTest inherit these explicit,
    # uniquely validated original class defaults, not browser assumptions.
    sys.path.insert(0, str(ROOT / 'tools/dat'))
    import export_npc_visuals
    classes = export_npc_visuals.OriginalClasses()
    types = classes.property_types('Engine.FinalBlend', set())
    final_pkg = classes.packages['Engine']
    final_export = next(e for e in final_pkg.exports if final_pkg.class_name_of(e) == 'Class'
                        and final_pkg.export_name(e) == 'FinalBlend')
    defaults, defaults_proof = export_npc_visuals.terminal_defaults(final_pkg, final_export, types)
    assert defaults_proof['defaultsBoundary'] == 'unique-validated-candidate'
    assert defaults == [('ZWrite', 'bool', True), ('ZTest', 'bool', True)]
    assert d3d.wide(d3d.base + 0xdfc10) == 'FD3DRenderInterface::SetShaderMaterial'
    assert d3d.u32(d3d.base + 0xcdc0 + 5 * 4) == d3d.base + 0xca6b
    for rva, mnemonic, operands in [
        (0xc80e, 'movzx', 'eax, byte ptr [esi + 0x598]'),
        (0xc81e, 'jmp', 'dword ptr [eax*4 + 0x1000cdc0]'),
        (0xca77, 'mov', 'dword ptr [ecx + 0x24], 2'),
        (0xca8a, 'mov', 'dword ptr [eax + 0x28], 4'),
        (0xcaac, 'mov', 'dword ptr [ecx + 0x14], 0'),
        (0xcabf, 'mov', 'dword ptr [eax + 0x2c], edi'),
        (0xcac2, 'push', '0'), (0xcac4, 'push', '0'),
        (0xcac6, 'push', '0'), (0xcac8, 'push', '0'),
        (0xcae4, 'mov', 'dword ptr [eax + 0x30], ecx'),
        (0xcba3, 'mov', 'eax, dword ptr [esi + 0x59c]'),
        (0xcbad, 'and', 'eax, edi'),
        (0xcbbb, 'mov', 'dword ptr [edx + 0x18], eax'),
        (0x23083, 'mov', 'edx, dword ptr [ebx + 0x24]'),
        (0x2308e, 'mov', 'dword ptr [eax + 0x10], edx'),
        (0x23091, 'mov', 'edx, dword ptr [ebx + 0x28]'),
        (0x2309c, 'mov', 'dword ptr [eax + 0x14], edx'),
        (0x23045, 'cmp', 'dword ptr [ebx + 0x14], edx'),
        (0x23053, 'mov', 'dword ptr [eax + 8], edx'),
        (0x23056, 'cmp', 'dword ptr [ebx + 0x18], 0'),
        (0x23069, 'mov', 'dword ptr [eax + 0x18], edx'),
        (0x2ef32, 'mov', 'ecx, dword ptr [esi + 0x10]'),
        (0x2ef48, 'push', '0x13'),
        (0x2ef59, 'mov', 'ecx, dword ptr [esi + 0x14]'),
        (0x2ef6f, 'push', '0x14'),
        (0x2eee4, 'mov', 'ecx, dword ptr [esi + 8]'),
        (0x2eefa, 'push', '0xe'),
        (0x2ef80, 'mov', 'ecx, dword ptr [esi + 0x18]'),
        (0x2ef96, 'push', '0x16'),
        # Original modifier unwrap: FinalBlend properties -> modifier state.
        (0x11143, 'call', 'dword ptr [0x100dd3d0]'),
        (0x11159, 'mov', 'al, byte ptr [ebx + 0x57c]'),
        (0x1115f, 'mov', 'byte ptr [edi + 0x58], al'),
        (0x1116a, 'mov', 'dword ptr [edi + 0x5c], ecx'),
        (0x11177, 'mov', 'dword ptr [edi + 0x60], edx'),
        (0x11185, 'mov', 'dword ptr [edi + 0x64], eax'),
        (0x11193, 'mov', 'dword ptr [edi + 0x68], ecx'),
        (0x11196, 'mov', 'dl, byte ptr [ebx + 0x584]'),
        (0x1119c, 'mov', 'byte ptr [edi + 0x6c], dl'),
        # FinalBlend overrides the Shader's ordinary output-blend selection.
        (0xc7f9, 'cmp', 'dword ptr [ebp + 0x10], ecx'),
        (0xc804, 'call', '0x1000f4a0'),
        (0xf4e2, 'movzx', 'eax, byte ptr [ebx + 0x58]'),
        (0xf4ef, 'jmp', 'dword ptr [eax*4 + 0x1000f8b8]'),
        (0xf53c, 'mov', 'dword ptr [ecx + 0x24], 5'),
        (0xf54f, 'mov', 'dword ptr [eax + 0x28], 6'),
        (0xf562, 'mov', 'dword ptr [edx + 4], edi'),
        (0xf81f, 'mov', 'eax, dword ptr [ebx + 0x5c]'),
        (0xf822, 'mov', 'dword ptr [edx + 0x14], eax'),
        (0xf831, 'mov', 'eax, dword ptr [ebx + 0x60]'),
        (0xf834, 'mov', 'dword ptr [edx + 0x10], eax'),
        (0xf843, 'mov', 'eax, dword ptr [ebx + 0x68]'),
        (0xf846, 'mov', 'dword ptr [edx + 0x18], eax'),
        (0xf855, 'mov', 'eax, dword ptr [ebx + 0x64]'),
        (0xf858, 'mov', 'dword ptr [edx + 8], eax'),
        (0xf867, 'mov', 'al, byte ptr [ebx + 0x6c]'),
        (0xf86a, 'mov', 'byte ptr [edx + 0xc], al'),
        # Pass -> deferred state -> actual D3D alpha-ref/function/enable.
        (0x22fb4, 'movzx', 'ecx, byte ptr [ebx + 0xc]'),
        (0x22fc0, 'mov', 'dword ptr [eax + 0x20], ecx'),
        (0x22fcb, 'mov', 'dword ptr [eax + 0x24], 5'),
        (0x22fd4, 'cmp', 'dword ptr [ebx + 8], ecx'),
        (0x22fe2, 'mov', 'dword ptr [eax + 0xc], ecx'),
        (0x2ef0b, 'mov', 'ecx, dword ptr [esi + 0xc]'),
        (0x2ef21, 'push', '0xf'),
        (0x2efe4, 'push', '0x18'),
        (0x2f00b, 'push', '0x19'),
    ]:
        instruction(d3d, rva, mnemonic, operands)
    assert d3d.u32(d3d.base + 0xf8b8 + 2 * 4) == d3d.base + 0xf530
    return {'format': 'l2-interlude-npc-material-proof-v1', 'edition': 'Interlude',
            'engineSHA256': engine.sha, 'd3dSHA256': d3d.sha,
            'shaderScriptSHA256': hashlib.sha256(found[0]).hexdigest(),
            'instructionChecks': checks,
            'binding': 'npc-primary-texture-index-to-actor-skins',
            'brighten': {'outputBlending': 5, 'srcBlend': 2, 'dstBlend': 4,
                         'depthWrite': False, 'twoSidedCullMode': 1,
                         'fogOverrideARGB': 0},
            'finalBlendAlpha': {'frameBufferBlending': 2, 'srcBlend': 5, 'dstBlend': 6,
                               'alphaCompare': 5, 'depthWrite': True, 'depthTest': True,
                               'twoSidedCullMode': 1,
                               'scriptSHA256': hashlib.sha256(final_sources[0]).hexdigest(),
                               'classDefaults': defaults_proof,
                               'packageSHA256': classes.sources['Engine.u']}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.parse_args()
    print(json.dumps(verify(), indent=2))
