#!/usr/bin/env python3
"""Elbera Tools: recover the original Next Target dispatch and selector boundary.

Read-only; requires pinned local originals, l2encdec and capstone. DLLs are
decoded in memory and never executed. No game connection or runtime changes.
This intentionally does not supply an invented distance metric or selector.
"""
import argparse
import hashlib
import json
import struct
import sys
import tempfile

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA, NWINDOW_SHA

INTERFACE_SHA = '5da491d8234863a94bfa1959bcb0be2cd5cdf81110003785436eecc04c86decd'
ACTION_SHA = '131ca5a5b07ff4b23a4912dcb6a23597931223bfd746679a40316534d5257cc2'
ACTION_SCRIPT_SHA = 'ca6135beff737cb0214116092ebc8e0f0317006ee5c11709612b52c3dabe508a'
CORE_SHA = '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf'


def verify_boundaries(engine, system):
    """New bounded evidence, without guessing erased imports or glow rendering."""
    from verify_falloff import PE
    raw = (system / 'engine.dll').read_bytes()
    start, end = engine.offset(0x10407dec), engine.offset(0x10407df4)
    words = struct.unpack('<2I', raw[start:end])
    decoded = b''.join(struct.pack('<I', (word - 0x7965b551) & 0xffffffff) for word in words)
    assert decoded == engine.data[start:end]
    assert decoded[2:] == b'\x90' * 6
    # Same no-argument float-return ABI has several original mathematical
    # meanings. A compatible signature cannot select the erased operation.
    assert hashlib.sha256((system / 'Core.dll').read_bytes()).hexdigest() == CORE_SHA
    core = PE(system / 'Core.dll')
    compatible = [f'?{name}@FVector@@QBEMXZ' for name in
                  ['Size', 'Size2D', 'SizeSquared', 'SizeSquared2D', 'GetMax', 'GetMin', 'GetAbsMax']]
    assert all(name in core.exports() for name in compatible)
    methods = {'??0FNPawnLight@@QAE@PAVAActor@@@Z': (0x1030e133, 0x104eb7e0),
               '?Init@FNPawnLight@@QAEXHVFVector@@VFRotator@@EEVFPlane@@MME@Z': (0x103148d5, 0x104ebe40)}
    for name, (stub, body) in methods.items():
        assert engine.exported(name) == stub and engine.exported(name, True) == body
    table = engine.exported('??_7UGameEngine@@6BUObject@@@')
    assert engine.u32(table + 0x13c) == engine.exported('?OnDie@UGameEngine@@UAEHPAUUser@@AAVL2ParamStack@@@Z')
    checks = [
        # Existing-key upsert changes the value in place. New allocation's
        # imported call remains erased; no complete map ordering claim.
        (0x1042c417, 'lea', 'edx, [edi + edx*4]'),
        (0x1042c41a, 'je', '0x1042c434'),
        (0x1042c429, 'call', '0x1030a196'),
        (0x1042c441, 'mov', 'dword ptr [edi + eax + 8], edx'),
        (0x10423322, 'push', '0xc'), (0x10423324, 'push', '1'),
        # Original seven-DWORD Die decoder and the named game handler.
        (0x10836a48, 'mov', 'dword ptr [0x10a57928], 0x1030837d'),
        (0x1030837d, 'jmp', '0x10425770'),
        (0x104257b8, 'push', '0x108874cc'),
        (0x1042580d, 'mov', 'edx, dword ptr [esp + 0x18]'),
        (0x10425816, 'call', 'esi'),
        (0x10425884, 'mov', 'eax, dword ptr [edx + 0x13c]'),
        (0x1042588a, 'call', 'eax'),
        # Fifth accessor result is tested for nonzero before this effect
        # block. Push/read accessor identities are deliberately unbound.
        (0x10490b78, 'mov', 'ecx, esi'), (0x10490b7e, 'call', 'edi'),
        (0x10490b86, 'call', 'edi'), (0x10490b8e, 'call', 'edi'),
        (0x10490b96, 'call', 'edi'), (0x10490b9e, 'call', 'edi'),
        (0x10490ba2, 'mov', 'dword ptr [esp + 0x5c], eax'),
        (0x10490d3d, 'cmp', 'dword ptr [esp + 0x5c], ebp'),
        (0x10490d41, 'je', '0x10490f93'),
        (0x10490d6a, 'call', '0x1030e133'),
        (0x10490e50, 'call', '0x103148d5'),
        (0x10490ed5, 'cmp', 'dword ptr [esi + 0x16c0], ebp'),
        (0x10490ee5, 'push', '0x1089fadc'),
        (0x10490f88, 'mov', 'dword ptr [esi + 0x16c0], eax'),
    ]
    for address, mnemonic, operands in checks:
        engine.instruction(address, mnemonic, operands)
    for start, end, digest in [
        (0x1042c3f0, 0x1042c450, 'cc0c13ea1025354def7a72e997464275faecd88d63e5ee595a4e78b601d62e1d'),
        (0x10423320, 0x1042338f, 'f670b6c73e9d2911505b62226d63aff5400d3ab56b39acd9ef541cb55e25443f'),
        (0x10425770, 0x1042588c, 'f4e527c5e36b216891b26c676d9fd91fb79c9f8906599d11eed38071e082d0b7'),
        (0x10490b50, 0x10490baa, 'a5d7463c9fff2be2180b69819fc6574420f990a0425938acf34291e1c6f8a807'),
        (0x10490d3d, 0x10490f93, '4f8ce953d09f9e2ac007e2b7a4058eec36d88a9d3d4e22a919d5c0caeb563263'),
    ]:
        assert hashlib.sha256(engine.data[engine.offset(start):engine.offset(end)]).hexdigest() == digest
    assert engine.data[engine.offset(0x10423328):engine.offset(0x1042332e)] == b'\x90' * 6
    assert engine.data[engine.offset(0x108874cc):engine.offset(0x108874cc)+8] == b'ddddddd\0'
    assert engine.wide(0x1089fadc) == 'LineageEffect.s_u008_spoil'
    return {'instructionChecks': len(checks), 'rangeChecks': 5,
            'coreSHA256': CORE_SHA, 'compatibleScalarExports': compatible,
            'rawCallsite': 'aligned original words independently decode to six NOPs',
            'mapUpdate': 'existing value replaced in place; allocation operation unresolved',
            'corpse': {'packet': '0x06; seven DWORDs', 'effect': 'LineageEffect.s_u008_spoil',
                       'branch': 'fifth OnDie accessor result nonzero',
                       'limit': 'protected ParamStack accessors not independently bound; packet ordinal equivalence remains limited'}}


def verify():
    sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'tools/uscript'),
                   str(ROOT / 'tools/dat'), str(ROOT / 'tools/audio')]
    from l2lib import load_package
    from extract_uscript import sources_from_package
    from extract_gamedata import decrypt, parse_actionname
    from verify_falloff import PE

    system = ROOT / 'assets/interlude/system'
    assert hashlib.sha256((system / 'Interface.u').read_bytes()).hexdigest() == INTERFACE_SHA
    assert hashlib.sha256((system / 'actionname-e.dat').read_bytes()).hexdigest() == ACTION_SHA
    package, _ = load_package(system / 'Interface.u')
    script = dict(sources_from_package(package))['ActionWnd']
    assert hashlib.sha256(script.encode()).hexdigest() == ACTION_SCRIPT_SHA
    assert 'DoAction(infItem.ClassID);' in script
    with tempfile.TemporaryDirectory(prefix='elbera-nexttarget-') as tmp:
        decoded = decrypt('actionname-e.dat', tmp)
    assert hashlib.sha256(decoded).hexdigest() == '4680e3f2eb00e8933666cf578b94b076fa8522b3fea0bcb18bf7b46256a36cf9'
    rows = parse_actionname(decoded)
    row, = [row for row in rows if row['id'] == 4]
    assert len(rows) == 102
    assert (row['type'], row['name'], row['cmd']) == (-1, 'Next Target', 'targetnext')

    e = Image(system / 'engine.dll', ENGINE_SHA, True)
    w = Image(system / 'NWindow.dll', NWINDOW_SHA)
    assert w.exported('?execDoAction@UUIScript@@QAEXAAUFFrame@@QAX@Z') == 0x100f6920
    assert w.exported('?execIsCanBeAttacked@UUIDATA_TARGET@@QAEXAAUFFrame@@QAX@Z') == 0x1012ae90
    table = e.exported('??_7UNetworkHandler@@6BUObject@@@')
    methods = {
        0x100: ('?Action@UNetworkHandler@@UAEXHVFVector@@H@Z', 0x10403d00),
        0x420: ('?GetNextEnemy@UNetworkHandler@@UAEPAUUser@@MH@Z', 0x104080b0),
        0x528: ('?GetDistance@UNetworkHandler@@UAEMPAVFObjectMap@@0@Z', 0x10407cf0),
        0x52c: ('?IsGNOMatch@UNetworkHandler@@UAEHHPAVFObjectMap@@@Z', 0x10407e50),
        0x538: ('?GetNearestObject@UNetworkHandler@@UAEPAVFObjectMap@@HMH@Z', 0x10432a20),
        0x53c: ('?GetNextObject@UNetworkHandler@@UAEPAVFObjectMap@@HMH@Z', 0x10432bc0),
    }
    for offset, (name, body) in methods.items():
        assert e.u32(table + offset) == e.exported(name)
        assert e.exported(name, True) == body
    for name in ['AController', 'APlayerController', 'ALineagePlayerController']:
        table = e.exported(f'??_7{name}@@6B@')
        assert e.u32(table + 0x35c) == e.exported('?GetSelectedActor@AController@@UAEPAVAActor@@XZ')
    assert e.exported('?OnDie@UGameEngine@@UAEHPAUUser@@AAVL2ParamStack@@@Z', True) == 0x10490b50
    assert e.exported('?OnRevive@UGameEngine@@UAEHPAUUser@@@Z', True) == 0x10491260
    assert PE(system / 'NWindow.dll').imports()['?KeyDown@UInput@@QAEEH@Z'] == ('Engine.dll', 0x1022c78c)
    assert e.exported('?KeyDown@UInput@@QAEEH@Z', True) == 0x10377a10
    # Action4's two-level jump table, not the superficially similar joypad
    # NPCTargetNext command and not RequestActionUse(4).
    case = w.data[w.offset(0x10170f98 + 4 - 2)]
    assert case == 2 and w.u32(0x10170f44 + case * 4) == 0x101709b0
    assert e.u32(0x10407f10 + 4) == 0x10407e93  # IsGNOMatch filter2.

    window_checks = [
        (0x100f699f, 'push', '0'), (0x100f69a1, 'push', '0'),
        (0x100f69a3, 'mov', 'eax, dword ptr [ebp - 0x14]'),
        (0x100f69ad, 'call', '0x10170860'),
        (0x10170896, 'lea', 'eax, [edi - 2]'),
        (0x101708a2, 'movzx', 'eax, byte ptr [eax + 0x10170f98]'),
        (0x101708a9, 'jmp', 'dword ptr [eax*4 + 0x10170f44]'),
        (0x101709b0, 'call', '0x1014ddd0'),
        (0x101709b9, 'mov', 'eax, dword ptr [eax + 0x204]'),
        (0x101709c3, 'mov', 'eax, dword ptr [eax + 0x60]'),
        (0x101709c7, 'push', '0xc8'), (0x101709ce, 'call', '0x1014c7c0'),
        (0x101709d8, 'push', '-1'), (0x101709da, 'push', '0xc8'),
        (0x101709e1, 'call', '0x1014c7c0'),
        (0x1014de12, 'mov', 'esi, dword ptr [edx + 0x3bc]'),
        (0x1014de35, 'mov', 'edx, dword ptr [eax + 0x35c]'),
        (0x1014de3b, 'call', 'edx'),
        (0x1014c7c0, 'fild', 'dword ptr [esp + 4]'),
        (0x1014c7d5, 'mov', 'edx, dword ptr [edx + 0x420]'),
        (0x1014c7e1, 'call', 'edx'), (0x1014c7e5, 'test', 'ebx, ebx'),
        (0x1014c7e9, 'cmp', 'dword ptr [ebx + 0x204], 0'),
        (0x1014c814, 'push', '0x10'),
        (0x1014c816, 'call', 'dword ptr [0x1022c78c]'),
        (0x1014c825, 'mov', 'eax, dword ptr [edx + 0x3bc]'),
        (0x1014c82b, 'mov', 'edx, dword ptr [eax + 0x1bc]'),
        (0x1014c84c, 'mov', 'ecx, dword ptr [ebx + 0x18]'),
        (0x1014c84f, 'mov', 'eax, dword ptr [ebp + 0x100]'),
        (0x1014c859, 'call', 'eax'),
        # Named script getter independently identifies User+10.
        (0x1012aef2, 'call', '0x1014ddd0'),
        (0x1012aefb, 'mov', 'esi, dword ptr [eax + 0x10]'),
    ]
    engine_checks = [
        (0x104080ba, 'mov', 'eax, dword ptr [eax + 0x53c]'),
        (0x104080c5, 'push', '2'), (0x104080c7, 'call', 'eax'),
        (0x10407e93, 'cmp', 'dword ptr [ecx], 1'),
        (0x10407e98, 'cmp', 'dword ptr [eax + 0x10], 0'),
        (0x10407e9e, 'mov', 'eax, dword ptr [eax + 0x204]'),
        (0x10407ea8, 'mov', 'eax, dword ptr [eax + 0x14d8]'),
        (0x10407eb2, 'test', 'byte ptr [eax + 0x41c], 1'),
        (0x10407eb9, 'jne', '0x10407f08'),
        (0x10490be9, 'or', 'dword ptr [eax + 0x41c], 1'),
        (0x10491294, 'and', 'dword ptr [eax + 0x41c], 0xfffffffe'),
        (0x10432bf5, 'cmp', 'eax, dword ptr [esi + 0x58]'),
        (0x10432bfc, 'mov', 'dword ptr [esi + 0x58], eax'),
        (0x10432c02, 'mov', 'dword ptr [esi + 0x60], 0xffffffff'),
        (0x10432c10, 'push', '0x10b1f550'),
        (0x10432c53, 'mov', 'eax, dword ptr [ebp + 0x528]'),
        (0x10432c5b, 'call', 'eax'),
        (0x10432c76, 'mov', 'ebp, dword ptr [0x10b1f558]'),
        (0x10432c96, 'add', 'ebp, 0x194'),
        (0x10432cc6, 'mov', 'edi, dword ptr [edx + ecx*4 + 8]'),
        (0x10432d04, 'fcom', 'qword ptr [0x10854b60]'),
        (0x10432d0c, 'test', 'ah, 1'),
        (0x10432d15, 'fcomp', 'st(1)'),
        (0x10432d19, 'test', 'ah, 5'), (0x10432d1c, 'jp', '0x10432d46'),
        (0x10432d26, 'test', 'ah, 0x41'), (0x10432d29, 'jne', '0x10432d48'),
        (0x10432d32, 'cmp', 'eax, dword ptr [esp + 0x50]'),
        (0x10432d48, 'add', 'ebx, 1'),
        (0x10432d82, 'mov', 'eax, dword ptr [eax + 0x538]'),
        (0x10432d90, 'call', 'eax'), (0x10432da3, 'mov', 'dword ptr [edi], eax'),
        (0x10432aa7, 'mov', 'esi, dword ptr [ecx + eax*4 + 8]'),
        (0x10432ae7, 'fcom', 'qword ptr [0x10854b60]'),
        (0x10432afc, 'test', 'ah, 0x41'), (0x10432aff, 'jne', '0x10432b1e'),
        (0x10432b08, 'cmp', 'eax, dword ptr [esp + 0x44]'),
        (0x10432b1e, 'add', 'edi, 1'),
        (0x10407d43, 'mov', 'eax, dword ptr [ecx + 0x204]'),
        (0x10407d65, 'mov', 'ecx, dword ptr [eax + 0x1bc]'),
        (0x10407d6f, 'mov', 'ecx, dword ptr [eax + 0x1c0]'),
        (0x10407d75, 'mov', 'eax, dword ptr [eax + 0x1c4]'),
        (0x10407dca, 'lea', 'ecx, [esp + 0x1c]'),
        (0x10407dd2, 'fstp', 'dword ptr [esp + 0x1c]'),
        (0x10407dde, 'fstp', 'dword ptr [esp + 0x20]'),
        (0x10407dea, 'fstp', 'dword ptr [esp + 0x24]'),
        (0x10407dfb, 'fld', 'dword ptr [0x10854358]'),
        (0x10403d0c, 'jle', '0x10403d70'),
        (0x10403d30, 'movzx', 'edx, byte ptr [esp + 0x28]'),
        (0x10403d45, 'push', '4'), (0x10403d47, 'push', '0x1087f7e4'),
        (0x10403d4d, 'mov', 'eax, dword ptr [ecx + 0x68]'),
        (0x10377a30, 'mov', 'al, byte ptr [eax + ecx + 0xecc]'),
    ]
    for image, checks in [(w, window_checks), (e, engine_checks)]:
        for address, mnemonic, operands in checks:
            image.instruction(address, mnemonic, operands)
    ranges = [
        (e, 0x10407cf0, 0x10407e08, '02f90d77fd27068115d20c0858d860519da2e933090e8f31f7d9ba4c80e4bb23'),
        (e, 0x10407e50, 0x10407f0d, 'a426f283987f4294ddaa26a0643400e4fc261eb9fddc5a75c189fff8cf1a8432'),
        (e, 0x104080b0, 0x104080e3, 'd0a342659d2e0631da05ebd31ca10a0893ac45b748625a7da587037ae285f556'),
        (e, 0x10432a20, 0x10432b61, '8f909ec25a5d04bf86292384348dc9789f7caaae72ca2e076aefd31041966ade'),
        (e, 0x10432bc0, 0x10432dd0, 'd1da8c10f4c352381760474a9b0a9a893dcbc065828c6c6778cc0cab029b7142'),
        (e, 0x10403d00, 0x10403d75, '3e14a0daf7e88dbbbbe00241f13c9dc8d6630e0fbb52e1cf80a091a0bcf306fa'),
        (w, 0x1014c7c0, 0x1014c862, 'db606bce90a09dcb3835dbf24c384e19b8e7f15a05eed4afa299221fc74887f2'),
        (w, 0x1014ddd0, 0x1014de61, '767e97845d3e18dac42fc7a751dde1c6f9331c24170c632d8e72021c5baba820'),
        (w, 0x101709b0, 0x101709eb, '2c73009007965f4254d72e577e16d694bd53c38181e8d57599e97f683074f294'),
        (w, 0x1012aeea, 0x1012af03, 'bc66969182891fc5d79fbad36f2a07be387695cc99bb047eeda3326f5bd604e9'),
    ]
    for image, start, end, digest in ranges:
        assert hashlib.sha256(image.data[image.offset(start):image.offset(end)]).hexdigest() == digest
    assert struct.unpack_from('<d', e.data, e.offset(0x10854b60))[0] == 0.0
    assert struct.unpack_from('<f', e.data, e.offset(0x10854358))[0] == -1.0
    assert e.data[e.offset(0x1087f7e4):e.offset(0x1087f7e4)+7] == b'cddddc\0'
    assert e.data[e.offset(0x10407dee):e.offset(0x10407df4)] == b'\x90' * 6
    return {
        'format': 'elbera-next-target-evidence-v1',
        'status': 'dispatch-and-scalar-order-verified; distance-operation-unresolved',
        'sources': {'Engine.dll': e.sha, 'NWindow.dll': w.sha,
                    'Interface.u': INTERFACE_SHA, 'actionname-e.dat': ACTION_SHA},
        'instructionChecks': len(window_checks) + len(engine_checks),
        'rangeChecks': len(ranges), 'networkVtableChecks': len(methods),
        'followup': verify_boundaries(e, system),
        'action': {'id': row['id'], 'command': row['cmd'], 'rangeArgument': 200,
                   'filter': 2, 'resultPacket': '0x04 Action, cddddc', 'keyIndex': 16},
        'eligibility': ['User object', 'CanBeAttacked nonzero', 'Pawn and Controller present',
                        'OnDie flag clear', 'exclude selected Actor ID'],
        'order': {'firstPass': 'strictly greater than remembered-object scalar and strictly below range',
                  'wrap': 'GetNearestObject: nonnegative scalar strictly below range',
                  'ties': 'first in native map entry array', 'remember': 'only successful result updates ID'},
        'unresolved': ['GetDistance vector-scalar imported call erased at 0x10407dee',
                       'Native object-map mutation/tie order versus browser entity collection',
                       'Native Actor.Location versus current browser grounded visual origins'],
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='verify originals; writes no files')
    parser.parse_args()
    print(json.dumps(verify(), indent=2))
