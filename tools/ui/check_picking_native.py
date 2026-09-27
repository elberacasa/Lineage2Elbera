#!/usr/bin/env python3
"""Verify picking rules against the owner's original Interlude binaries.

python3 tools/ui/check_picking_native.py --check
Requires capstone. Original binaries are decoded in memory, never executed or
written. This publishes derived behavior/addresses, not proprietary binaries.
See docs/native-picking-evidence.md for the bounded interpretation and gaps.
"""
import argparse
import hashlib
import json
import struct

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA, NWINDOW_SHA

CORE_SHA = '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf'


def verify_actor_defaults_and_trace(e):
    """Elbera Tools: original CDO Rotation and nonzero mouse participation."""
    import sys
    sys.path[:0] = [str(ROOT / 'tools/world'), str(ROOT / 'tools/dat')]
    from export_static_collision import class_defaults
    values, defaults, packages = class_defaults()
    assert packages == {
        'Engine.u': '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761',
        'Core.u': 'de5f0ee0a773327bce13c96622fd3c654cff7db88b9be065d1232590c140fda0'}
    assert values['Rotation'] == [0, 0, 0]
    assert defaults[-1]['rotationDefault']['field']['struct'] == 'Core.Object.Rotator'
    c = Image(ROOT / 'assets/interlude/system/Core.dll', CORE_SHA)
    assert c.exported('?Serialize@UClass@@UAEXAAVFArchive@@@Z', True) == 0x101351c0
    assert c.exported('?InitClassDefaultObject@UObject@@QAEXPAVUClass@@H@Z') == 0x101031e3
    assert c.exported('?InitProperties@UObject@@SAXPAEHPAVUClass@@0HPAV1@2@Z') == 0x1010119f
    vt = c.exported('??_7UClass@@6B@')
    assert c.u32(vt + 0x88) == c.exported(
        '?SerializeTaggedProperties@UStruct@@UAEXAAVFArchive@@PAEPAVUClass@@@Z')
    ranges = [
        (0x101352a8, 0x1013540b, '4d65d86dd081b121b6bee66cd09f5ac19eb1f5fd46cb2e014da67dedad1fa3fb'),
        (0x1015fe10, 0x1015fe9f, '7995734cc2cc19f9b79ad29df0b4a054e3e285014b60082257fea61883e0f82d'),
        (0x1015fb00, 0x1015fc0b, 'dec186032d66a9d75924592eb2d16505cee7b8a66eb605a8f7d360973c74e641'),
        (0x10108420, 0x1010843d, '7631fe6ea18cde71eba7b7436a8d121276e577aa0ab8fd7db89aa9b5cff60900'),
        (0x10173250, 0x101732f1, '80bf0d6214e3a404ca35d27be526557554f3b520fd587b3cb3d9afe91878031f')]
    for start, end, digest in ranges:
        assert hashlib.sha256(c.data[c.offset(start):c.offset(end)]).hexdigest() == digest
    core_checks = [
        (0x101352fd, 'lea', 'ebx, [esi + 0x4f4]'),
        (0x1013532a, 'call', '0x1010421e'), (0x10135331, 'call', '0x101031e3'),
        (0x10135336, 'mov', 'eax, dword ptr [esi + 0x34]'),
        (0x10135342, 'mov', 'edx, dword ptr [edx + 0x88]'),
        (0x1015fe67, 'mov', 'edx, dword ptr [ecx + 0x34]'),
        (0x1015fe77, 'push', 'edx'), (0x1015fe81, 'call', '0x1010119f'),
        (0x1015fb45, 'mov', 'ecx, 0x34'),
        (0x1015fb8a, 'call', '0x101022e3'), (0x1015fbff, 'call', '0x1017ac60'),
        (0x1010842a, 'xor', 'eax, eax'),
        (0x10108434, 'rep stosd', 'dword ptr es:[edi], eax'),
        (0x10108438, 'rep stosb', 'byte ptr es:[edi], al'),
        # Bool Link reuses the preceding Bool offset and doubles its mask.
        (0x101732a6, 'mov', 'eax, dword ptr [ebx + 0x54]'),
        (0x101732ac, 'mov', 'ecx, dword ptr [edi + 0x78]'),
        (0x101732af, 'add', 'ecx, ecx'),
        (0x101732c9, 'mov', 'dword ptr [esi + 0x78], 1')]
    for at, op, args in core_checks: c.instruction(at, op, args)
    engine_checks = [
        # SetCollision binds bCollideActors/BlockActors/BlockPlayers at 1/4/8.
        (0x10531e72, 'and', 'ecx, 1'), (0x10531e75, 'xor', 'dword ptr [esi + 0x2f8], ecx'),
        (0x10531e8a, 'and', 'eax, 4'), (0x10531ea0, 'and', 'ecx, 8'),
        (0x10531eab, 'test', 'cl, 1'), (0x10531eae, 'je', '0x10531ecd'),
        # Extent is the FVector at +68; the two separate hash traversal paths
        # test zero/nonzero bits. The box path expands bounds by that extent.
        (0x10523942, 'lea', 'ecx, [ebp + 0x68]'),
        (0x1052394d, 'je', '0x10523d2f'),
        (0x10523a5e, 'test', 'byte ptr [esi + 0x2f8], 0x20'),
        (0x10523d5f, 'fsub', 'dword ptr [ebp + 0x68]'),
        (0x10523db5, 'fadd', 'dword ptr [ebp + 0x68]'),
        (0x10523eab, 'test', 'byte ptr [esi + 0x2f8], 0x40'),
        (0x1052ff5a, 'test', 'byte ptr [esi + 0x74], 2'),
        (0x1052ff62, 'and', 'eax, 0x80'),
        (0x1058db8a, 'fld', 'dword ptr [0x1089df54]')]
    for at, op, args in engine_checks: e.instruction(at, op, args)
    assert struct.unpack_from('<f', e.data, e.offset(0x1089df54))[0] == 0.10000000149011612
    return {'coreSHA256': c.sha, 'packages': packages,
            'instructionChecks': len(core_checks) + len(engine_checks),
            'sourceRangeChecks': len(ranges), 'rotationDefault': defaults[-1]['rotationDefault'],
            'mouseTraceFlag': 'bBlockNonZeroExtentTraces; zero-extent flag is independent',
            'limits': ['Class-default value, not recovered binding of erased Engine instance constructor imports.',
                       'Extent predicate call at 0x10523945 is six NOPs; box-path arithmetic and independent field identities survive.',
                       'bBlockActors/bBlockPlayers remain conservative gates; their general removal is not part of this change.']}


def verify_lazy_collision(e):
    """Elbera Tools: saved-end framing and shared lazy collision serializers."""
    c = Image(ROOT / 'assets/interlude/system/Core.dll', CORE_SHA)
    targets = {0x1030ac90: 0x106f6930, 0x10308c6a: 0x106f6c10,
               0x10302108: 0x103ae900, 0x10303161: 0x103aebf0,
               0x1030599d: 0x10330040, 0x1030e76e: 0x10366720,
               0x103077de: 0x10366940}
    for stub, body in targets.items():
        p = e.offset(stub)
        assert e.data[p] == 0xe9
        assert stub + 5 + struct.unpack_from('<i', e.data, p+1)[0] == body
    ranges = [
        (0x106f6930, 0x106f6ae5, '15d3e23861d08d10faf7f68459b6c5210cac873d6b9e53b79dae030403075e24'),
        (0x106f6c10, 0x106f6dc5, '32a29b970074a1c6ca2a9e761ec3e08b80f9439253c1f87a1da0ea639ffa85b7'),
        (0x10366720, 0x1036683a, '6661dce89e6b963d0fcf75b3f815ed7297227a382783520582505d42d1f3bbc1'),
        (0x10366940, 0x10366983, '32f3d8b17fdc794a62ee4bfd6a5774d1e3179adb28752b0a098ee28e2295b4c4')]
    for start, end, digest in ranges:
        assert hashlib.sha256(e.data[e.offset(start):e.offset(end)]).hexdigest() == digest
    checks = [
        (0x106f7c53, 'cmp', 'eax, 0x11'),
        (0x106f7c6e, 'lea', 'edx, [esi + 0x148]'), (0x106f7c76, 'call', '0x1030ac90'),
        (0x106f7c7b, 'lea', 'eax, [esi + 0x160]'), (0x106f7c83, 'call', '0x10308c6a'),
        (0x106f697a, 'cmp', 'eax, 0x3d'), (0x106f69b5, 'call', '0x1030599d'),
        (0x106f69d3, 'call', '0x10302108'),
        (0x106f69f0, 'mov', 'eax, dword ptr [edx + 0x40]'),
        (0x106f6a10, 'mov', 'edx, dword ptr [edx + 0x3c]'),
        # Tell -> initial int32 placeholder -> ordinary array -> Tell ->
        # Seek placeholder -> patch int32 end -> Seek end. Absolute offsets.
        (0x106f6a47, 'mov', 'edx, dword ptr [eax + 0x28]'),
        (0x106f6a63, 'call', '0x1030599d'), (0x106f6a6c, 'call', '0x10302108'),
        (0x106f6a78, 'mov', 'eax, dword ptr [edx + 0x28]'),
        (0x106f6a88, 'mov', 'edx, dword ptr [edx + 0x3c]'),
        (0x106f6a92, 'call', '0x1030599d'), (0x106f6aa2, 'mov', 'edx, dword ptr [edx + 0x3c]'),
        (0x106f6c95, 'call', '0x1030599d'), (0x106f6cb3, 'call', '0x10303161'),
        (0x10330049, 'push', '4'),
        (0x103ae98e, 'call', '0x1030e76e'), (0x103aec7e, 'call', '0x103077de'),
        (0x106ff6bf, 'mov', 'eax, dword ptr [edx]'),
        (0x106ff6cd, 'imul', 'eax, eax, 0x54'), (0x106ff719, 'imul', 'eax, eax, 0x54')]
    for at, op, args in checks: e.instruction(at, op, args)
    vt = c.exported('??_7ULinkerLoad@@6BFArchive@@@')
    for off, name in [(0x28, '?Tell@ULinkerLoad@@EAEHXZ'),
                      (0x3c, '?Seek@ULinkerLoad@@EAEXH@Z'),
                      (0x40, '?AttachLazyLoader@ULinkerLoad@@EAEXPAVFLazyLoader@@@Z')]:
        assert c.u32(vt+off) == c.exported(name)
    c.instruction(0x10149c68, 'mov', 'dword ptr [edi + 4], eax')
    c.instruction(0x10149c6f, 'mov', 'eax, dword ptr [edx + 0x28]')
    c.instruction(0x10149c74, 'mov', 'dword ptr [edi + 8], eax')
    return {'coreSHA256': c.sha, 'instructionChecks': len(checks)+3,
            'archiveVtableChecks': 3, 'sourceRangeChecks': len(ranges),
            'triangleLazySerializer': '0x106f6930', 'nodeLazySerializer': '0x106f6c10',
            'savedEnd': 'int32 absolute decoded-package offset; ordinary array payload must finish exactly there',
            'limits': ['File123 serialized arrays only; no native lazy paging/cache lifecycle port.',
                       'Recovered import NOPs do not independently identify erased Ver/LicenseeVer/IsLoading calls.',
                       'Compact-index binding uses independently checked original array framing, not a recovered import.']}


def verify():
    e = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, decode=True)
    w = Image(ROOT / 'assets/interlude/system/NWindow.dll', NWINDOW_SHA)
    def exported(term, body=True):
        names = [name for name in e.exports if name.startswith(term)]
        assert len(names) == 1, (term, names)
        return e.exported(names[0], body)

    functions = {
        '?FindMouseTargetObject@UGameEngine@@': 0x1058daf0,
        '?L2SingleLineCheck@ULevel@@': 0x105c2af0,
        '?L2MultiLineCheck@ULevel@@': 0x105c4a70,
        '?ActorLineCheck@FCollisionHash@@': 0x10523900,
        '?ShouldTrace@APawn@@': 0x10617740,
        '?GetCylinderExtent@AActor@@': 0x1033e620,
        '?LineCheck@UPrimitive@@': 0x10645de0,
        '?SetCollisionSize@AActor@@': 0x1052d650,
        '?AdjustPawnLocation@UGameEngine@@': 0x1048e300,
        '?OnNpcInfo@UGameEngine@@': 0x10494b40,
        '?OnCharInfo@UGameEngine@@': 0x10495a30,
        '?OnUserInfo@UGameEngine@@': 0x10496b30,
    }
    for term, address in functions.items():
        assert exported(term) == address, term
    level = e.exported('??_7ULevel@@6BUObject@@@')
    assert e.u32(level + 0x10c) == exported('?L2SingleLineCheck@ULevel@@', False)
    assert e.u32(level + 0x110) == exported('?L2MultiLineCheck@ULevel@@', False)
    for name in ['UPrimitive', 'UMesh', 'ULodMesh', 'USkeletalMesh']:
        table = e.exported(f'??_7{name}@@6B@')
        assert e.u32(table + 0x6c) == exported('?LineCheck@UPrimitive@@', False), name
    pawn = e.exported('??_7APawn@@6B@')
    assert e.u32(pawn + 0x160) == exported('?ShouldTrace@APawn@@', False)

    checks = [
        (0x1058db8a, 'fld', 'dword ptr [0x1089df54]'),
        (0x1058db9a, 'cmp', 'byte ptr [ecx + 0xedc], bl'),
        (0x10377a30, 'mov', 'al, byte ptr [eax + ecx + 0xecc]'),
        (0x1058dbcc, 'fld', 'qword ptr [0x1089d2f0]'),
        (0x1058dbf0, 'push', '0x300bf'),
        (0x1058dc46, 'fld', 'qword ptr [0x108a1e90]'),
        (0x1058dd60, 'push', '0x200bf'),
        (0x1058dd95, 'push', '0x200bf'),
        (0x105c2b2d, 'or', 'ebx, 0x400'),
        (0x10523a92, 'mov', 'edx, dword ptr [edx + 0x160]'),
        (0x10523aa6, 'mov', 'edx, dword ptr [eax + 0x164]'),
        (0x10523b06, 'mov', 'edx, dword ptr [esi + 0x6c]'),
        (0x105bce58, 'fld', 'dword ptr [ecx + 0x24]'),
        (0x105bce5b, 'fld', 'dword ptr [edx + 0x24]'),
        (0x105bce67, 'or', 'eax, 0xffffffff'),
        (0x105bce7a, 'mov', 'eax, 1'),
        (0x1061774c, 'cmp', 'edi, esi'),
        (0x10617761, 'cmp', 'edi, eax'),
        (0x1061776a, 'test', 'ebp, 0x10000'),
        (0x10617770, 'jne', '0x10617785'),
        (0x1061777c, 'test', 'byte ptr [eax + 0x41c], 1'),
        (0x10617783, 'jne', '0x106177d5'),
        (0x106177a0, 'call', '0x1030d9d6'),
        (0x10490be9, 'or', 'dword ptr [eax + 0x41c], 1'),
        (0x1033e624, 'fld', 'dword ptr [ecx + 0x2f0]'),
        (0x1033e62c, 'fld', 'dword ptr [ecx + 0x2f0]'),
        (0x1033e635, 'fld', 'dword ptr [ecx + 0x2f4]'),
        (0x10645e24, 'call', '0x1030a2b3'),
        (0x10645e2b, 'fadd', 'dword ptr [ebp + 0x64]'),
        (0x10645e3d, 'fadd', 'dword ptr [ebp + 0x6c]'),
        (0x106462a7, 'fcomp', 'qword ptr [0x108c4f28]'),
        (0x1064638f, 'fld', 'dword ptr [0x108db714]'),
        (0x106464f1, 'fsub', 'qword ptr [0x10891a48]'),
        (0x1064650e, 'fst', 'dword ptr [esi + 0x24]'),
        (0x1052d6ab, 'fstp', 'dword ptr [esi + 0x2f0]'),
        (0x1052d6b4, 'fstp', 'dword ptr [esi + 0x2f4]'),
        (0x1048e330, 'mov', 'edx, dword ptr [esi + 0x1c4]'),
        (0x1048e34a, 'fsub', 'dword ptr [esi + 0x2f4]'),
        (0x1048e37c, 'fsub', 'dword ptr [esp + 0x74]'),
        (0x1048e41e, 'fld', 'dword ptr [esi + 0x2f4]'),
        (0x1048e42c, 'fadd', 'qword ptr [0x1089f9a8]'),
        (0x1048e440, 'fsub', 'qword ptr [0x1089d2f0]'),
        (0x1048e479, 'push', '0x86'),
        (0x10495539, 'call', '0x1030c3ab'),
        (0x1049620c, 'call', '0x1030c3ab'),
        (0x10497494, 'call', '0x1030c3ab'),
        (0x10436ce3, 'fld', 'qword ptr [esp + 0xc0]'),
        (0x10436cea, 'fstp', 'dword ptr [esi + 0x1cc]'),
        (0x10436cf0, 'fld', 'qword ptr [esp + 0xc8]'),
        (0x10436cf7, 'fstp', 'dword ptr [esi + 0x1d0]'),
        (0x1043a7e1, 'fld', 'qword ptr [esp + 0xd0]'),
        (0x1043a7e8, 'fstp', 'dword ptr [esi + 0x1cc]'),
        (0x1043a7ee, 'fld', 'qword ptr [esp + 0xd8]'),
        (0x1043a7f5, 'fstp', 'dword ptr [esi + 0x1d0]'),
    ]
    for address, mnemonic, operands in checks:
        e.instruction(address, mnemonic, operands)
    assert w.u32(0x10287da4 + 0x7c) == 0x10141740
    w.instruction(0x1014174c, 'jmp', '0x10070e60')

    constants = {}
    for name, address, kind, expected in [
        ('range', 0x108a1e90, 'd', 10000.0), ('shiftStart', 0x1089d2f0, 'd', 30.0),
        ('extent', 0x1089df54, 'f', 0.10000000149011612),
        ('entryTimeBias', 0x10891a48, 'd', 0.0010000000474974513),
        ('radialParallelSquared', 0x108db714, 'f', 9.99999905104687e-09),
        ('insideApproach', 0x108c4f28, 'd', -0.10000000149011612),
        ('groundedTraceRaise', 0x1089f9a8, 'd', 20.0),
    ]:
        value = struct.unpack_from('<' + kind, e.data, e.offset(address))[0]
        assert value == expected, (name, value)
        constants[name] = value
    formats = {}
    for name, address in [('NpcInfo', 0x1088b5bc), ('CharInfo', 0x1088b080), ('UserInfo', 0x1088ae38)]:
        start = e.offset(address)
        formats[name] = e.data[start:e.data.index(0, start)].decode('ascii')
        assert formats[name].count('f') == 4
    return {
        'status': 'verified', 'engineSHA256': e.sha, 'nwindowSHA256': w.sha,
        'functions': {name.split('@')[0][1:]: hex(address) for name, address in functions.items()},
        'instructionChecks': len(checks) + 1, 'constants': constants, 'packetFormats': formats,
        'staticMesh': verify_static_mesh(),
        'scope': 'ordinary skeletal pawn cylinder and audited static mesh geometry; not a complete native world trace port',
        'remaining': ['native collision placement at slopes and exceptional pawn states',
                      'full trace-category and visibility flags', 'native item/prop primitives',
                      'world trace bias and intermediate x87 rounding'],
    }



def verify_static_mesh():
    """Elbera Tools: original static-actor and collision triangle source path.

    This pins participation and serialized geometry, not a claim that a zero
    width browser ray duplicates the native 0.1-unit nonzero extent sweep.
    """
    e = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, decode=True)
    def target(stub):
        offset = e.offset(stub)
        assert e.data[offset] == 0xe9
        return stub + 5 + struct.unpack_from('<i', e.data, offset + 1)[0]
    for kind in ('AActor', 'AStaticMeshActor'):
        vt = e.exported(f'??_7{kind}@@6B@')
        assert target(e.u32(vt + 0x160)) == 0x1052fe70
        assert target(e.u32(vt + 0x164)) == 0x1052dfb0
    assert target(e.u32(e.exported('??_7UStaticMesh@@6B@') + 0x6c)) == 0x107032d0
    checks = [
        (0x1052ff5a, 'test', 'byte ptr [esi + 0x74], 2'),
        (0x1052ff62, 'and', 'eax, 0x80'),
        (0x10523eab, 'test', 'byte ptr [esi + 0x2f8], 0x40'),
        (0x10703332, 'test', 'dword ptr [ebx + 0x2f8], 0x100'),
        (0x107033a5, 'mov', 'ecx, dword ptr [edi + 0x178]'),
        (0x106f7bde, 'lea', 'ecx, [esi + 0x178]'),
        (0x106f7c53, 'cmp', 'eax, 0x11'),
        (0x106f7d3e, 'imul', 'ecx, ecx, 0x54'),
        (0x10366808, 'lea', 'eax, [edi + 0x4c]'),
        (0x1036680c, 'lea', 'ecx, [edi + 0x48]'),
        (0x10366810, 'lea', 'edx, [edi + 0x44]'),
        (0x10366814, 'add', 'edi, 0x40'),
        (0x10701c72, 'mov', 'edx, dword ptr [eax + 0x40]'),
        (0x10701c99, 'mov', 'edi, dword ptr [edi + 0x78]'),
        (0x10701c9f, 'fld', 'dword ptr [edi + edx*8]'),
        (0x10701d32, 'mov', 'edi, dword ptr [eax + 0x44]'),
        (0x10701df4, 'mov', 'edi, dword ptr [eax + 0x48]'),
        (0x10702fd4, 'mov', 'eax, dword ptr [esi + 0x4c]'),
        (0x10702f95, 'call', '0x10306c99'),
        (0x10703496, 'push', '0'),
        (0x1070349a, 'call', '0x10310d0c'),
        (0x10703504, 'push', '0'),
        (0x10703508, 'call', '0x1030ab96'),
    ]
    for at, op, args in checks:
        e.instruction(at, op, args)
    assert target(0x10306c99) == 0x10701c30
    assert target(0x10304f43) == 0x106ff650
    assert target(0x1030ab96) == 0x10702ca0
    assert e.wide(0x108e86fc) == 'UseSimpleLineCollision'
    assert e.wide(0x108e86c8) == 'UseSimpleBoxCollision'
    return {'engineSHA256': e.sha, 'instructionChecks': len(checks),
            'actorShouldTrace': '0x1052fe70', 'staticMeshLineCheck': '0x107032d0',
            'triangleSerialize': '0x10366720', 'boxTriangleVertices': '0x10701c30',
            'lazyCollision': verify_lazy_collision(e),
            'actorDefaultsAndTrace': verify_actor_defaults_and_trace(e),
            'scope': 'audited static actor participation and source collision triangles'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='verify without writing any files')
    parser.parse_args()
    print(json.dumps(verify(), indent=2))
