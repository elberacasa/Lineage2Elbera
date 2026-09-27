#!/usr/bin/env python3
"""Elbera Tools: original sitting selectors, wait-state branches and clip inventory.

Requires the owner's local Interlude client and Capstone. Reads native code
only in memory; no binary execution, browser, login or asset conversion.
--check validates source anchors and current recovered clip metadata; --output
keeps the detailed receipt at an explicit private path. This does not prove
pose placement or the complete AnimEnd callback/reentrancy clock.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'tools/ui'), str(ROOT / 'tools/uscript'), str(ROOT / 'tools/dat')]
from check_tutorial_quest_native import Image, ENGINE_SHA
from extract_uscript import sources_from_package
from check_anim_terminal_native import x87_slice, f32
import build_pawnanim as pawn


def sha(data):
    return hashlib.sha256(data).hexdigest()


def function_body(text, name):
    match = re.search(r'\b(?:function|event)\s+(?:\w+\s+)?' + re.escape(name) + r'\s*\([^)]*\)\s*\{', text)
    if not match:
        raise ValueError('missing source function ' + name)
    start, depth = match.end(), 1
    for index in range(start, len(text)):
        depth += (text[index] == '{') - (text[index] == '}')
        if not depth:
            return text[start:index]
    raise ValueError('unterminated source function ' + name)


def native_evidence():
    image = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    methods = {
        '?OnChangeWaitType@UGameEngine@@UAEHPAUUser@@HVFVector@@@Z': 0x19bbc0,
        '?GetSitAnimName@APawn@@QAE?AVFName@@XZ': 0x41720,
        '?GetSitWaitAnimName@APawn@@QAE?AVFName@@XZ': 0x41740,
        '?GetStandAnimName@APawn@@QAE?AVFName@@XZ': 0x41760,
        '?GetSitAnimRate@APawn@@QAEMXZ': 0x42680,
        '?GetStandAnimRate@APawn@@QAEMXZ': 0x426c0,
        '?PlayAnim@APawn@@UAEHHVFName@@MMHH@Z': 0x3a7c80,
        '?GetCurWaitAnimName@APawn@@QAE?AVFName@@XZ': 0x317240,
        '?UpdateMovementAnimation@APawn@@QAEXM@Z': 0x324d00,
        '?OnUserInfo@UGameEngine@@UAEHPAUUser@@VFVector@@HHHDD@Z': 0x196b30,
    }
    for name, rva in methods.items():
        assert image.exported(name, True) == image.base + rva
    anchors = [
        (0x19bbfe, 'call', '0x10315046'),  # AdjustPawnLocation precedes duplicate check.
        (0x19bc0f, 'movzx', 'edx, byte ptr [ecx + 0x435]'),
        (0x19bc1a, 'cmp', 'edx, edi'),
        (0x19bc1c, 'je', '0x1049bf2c'),
        (0x19bc38, 'call', '0x1030bef6'),  # NActionStop.
        (0x19bc3d, 'cmp', 'edi, 3'),
        (0x19bc46, 'jmp', 'dword ptr [edi*4 + 0x1049bf3c]'),
        (0x19bc59, 'movzx', 'edx, byte ptr [ecx + 0x71d]'),
        (0x19bc60, 'mov', 'eax, dword ptr [ecx + edx*4 + 0x8ac]'),
        (0x19bc77, 'call', '0x10309fc5'),
        (0x19bca8, 'mov', 'eax, dword ptr [edi + 0x328]'),
        (0x19bcae, 'push', '0'),
        (0x19bcb0, 'call', 'eax'),
        (0x19bcbe, 'mov', 'byte ptr [edx + 0x435], 0'),
        (0x19bd86, 'mov', 'al, byte ptr [edx + 0x435]'),
        (0x19bd8c, 'test', 'al, al'),
        (0x19bd8e, 'jne', '0x1049bdc5'),
        (0x19bd9d, 'mov', 'edx, dword ptr [ecx + eax*4 + 0x8ec]'),
        (0x19bdb4, 'call', '0x1030f803'),
        (0x19bdc5, 'cmp', 'al, 4'),
        (0x19bdc7, 'jne', '0x1049bf2c'),
        (0x19bf0f, 'mov', 'edx, dword ptr [edi + 0x328]'),
        (0x19bf15, 'push', '0'),
        (0x19bf17, 'call', 'edx'),
        (0x19bf25, 'mov', 'byte ptr [ecx + 0x435], 1'),
        (0x41727, 'mov', 'ecx, dword ptr [ecx + eax*4 + 0x8ac]'),
        (0x41747, 'mov', 'ecx, dword ptr [ecx + eax*4 + 0x8cc]'),
        (0x41767, 'mov', 'ecx, dword ptr [ecx + eax*4 + 0x8ec]'),
        (0x42683, 'fcomp', 'dword ptr [ecx + 0x1400]'),
        (0x4268b, 'test', 'ah, 0x44'),
        (0x4268e, 'jp', '0x1034269a'),
        (0x42690, 'fld1', ''),
        (0x4269a, 'fld', 'dword ptr [ecx + 0x1400]'),
        (0x426c3, 'fcomp', 'dword ptr [ecx + 0x1404]'),
        (0x426cb, 'test', 'ah, 0x44'),
        (0x426ce, 'jp', '0x103426da'),
        (0x426d0, 'fld1', ''),
        (0x426da, 'fld', 'dword ptr [ecx + 0x1404]'),
        (0x3badde, 'fstp', 'dword ptr [ebp - 0x14]'),
        (0x3bade4, 'fstp', 'dword ptr [edi + 0x10]'),
        (0x3baded, 'cmp', 'dword ptr [edi + 0x44], 0'),
        (0x3badf1, 'jne', '0x106bae0e'),
        (0x3badfd, 'fstp', 'dword ptr [edi + 0xc]'),
        (0x3bae82, 'mov', 'edx, dword ptr [edx + 0x170]'),
        (0x3bae88, 'call', 'edx'),
        (0x3bae8c, 'jmp', '0x106baa7c'),
        (0x3baa7c, 'cmp', 'dword ptr [edi + 4], -1'),
        (0x3baaa6, 'fld', 'dword ptr [ebp - 0x14]'),
        (0x3baab6, 'mov', 'eax, dword ptr [ebp - 0x2c]'),
        (0x3baab9, 'add', 'eax, 1'),
        (0x3baabf, 'cmp', 'eax, 4'),
        (0x3baac2, 'jg', '0x106bae97'),
        (0x3baac8, 'fld', 'dword ptr [edi + 0x10]'),
        (0x196330, 'push', '0'),
        (0x196332, 'push', '1'),
        (0x196337, 'fldz', ''),
        (0x19633d, 'fld', 'dword ptr [ecx + 0x6b4]'),
        (0x196352, 'call', '0x10306ee2'),
        (0x196368, 'push', '0'),
        (0x196375, 'call', 'edx'),
        (0x136800, 'lea', 'edx, [esp + 0x130]'),
        (0x136807, 'push', 'edx'),
        (0x1369b7, 'push', '0x1088b080'),
        (0x1369cc, 'add', 'esp, 0x160'),
        (0x136cd6, 'fld', 'qword ptr [esp + 0xd0]'),
        (0x136cdd, 'fstp', 'qword ptr [esi + 0x1c4]'),
        (0x196505, 'fld', 'qword ptr [edi + 0x1c4]'),
        (0x19650b, 'fstp', 'dword ptr [ebp + 0x78]'),
        (0x19650e, 'fld', 'dword ptr [ebp + 0x78]'),
        (0x196517, 'fstp', 'dword ptr [edx + 0x6b4]'),
        (0x1343dd, 'lea', 'eax, [esp + 0x168]'),
        (0x1343e4, 'push', 'eax'),
        (0x134747, 'add', 'esp, 0x234'),
        (0x134a7d, 'fld', 'qword ptr [esp + 0x10c]'),
        (0x134a84, 'fstp', 'qword ptr [esi + 0x1c4]'),
        (0x1359b5, 'mov', 'edx, dword ptr [edx + 0x124]'),
        (0x1359db, 'push', 'esi'),
        (0x1359df, 'call', 'edx'),
        (0x1973bc, 'fld', 'qword ptr [esi + 0x1c4]'),
        (0x1973c2, 'fstp', 'dword ptr [esp + 0x10]'),
        (0x1973c6, 'fld', 'dword ptr [esp + 0x10]'),
        (0x1973ca, 'fstp', 'dword ptr [ecx + 0x6b4]'),
        (0x1974b9, 'fldz', ''),
        (0x1974c3, 'push', '0'),
        (0x1974c5, 'push', '1'),
        (0x1974ca, 'fstp', 'dword ptr [esp + 8]'),
        (0x1974d0, 'fld', 'dword ptr [ecx + 0x6b4]'),
        (0x1974da, 'fstp', 'dword ptr [esp + 4]'),
        (0x1974e5, 'add', 'edi, 0x328'),
        (0x1974eb, 'call', '0x10306ee2'),
        (0x197509, 'push', '0'),
        (0x19750b, 'call', 'edx'),
        (0x19651d, 'movzx', 'eax, byte ptr [ebp + 0x1c]'),
        (0x196521, 'mov', 'byte ptr [esi + 0x435], al'),
        (0x3173aa, 'mov', 'eax, dword ptr [esi + 0x14d8]'),
        (0x3173b0, 'mov', 'cl, byte ptr [eax + 0x435]'),
        (0x3173b6, 'test', 'cl, cl'),
        (0x3173b8, 'jne', '0x106173d7'),
        (0x3174af, 'movzx', 'eax, byte ptr [eax + 0x435]'),
        (0x3174b6, 'sub', 'eax, ebx'),
        (0x317523, 'movzx', 'ecx, byte ptr [esi + 0x71d]'),
        (0x31752a, 'mov', 'edx, dword ptr [esi + ecx*4 + 0x86c]'),
        (0x3b3601, 'fstp', 'dword ptr [esi + 0x18]'),
        (0x3b3604, 'fld', 'dword ptr [0x108c50a4]'),
        (0x3b360a, 'fstp', 'dword ptr [esi + 0x10]'),
        (0x32507d, 'call', '0x10306ee2'),
        (0x325082, 'push', '0'),
        (0x325084, 'push', 'ebx'),
        (0x325088, 'fld', 'dword ptr [0x108a052c]'),
        (0x325092, 'fld', 'dword ptr [esi + 0x6b4]'),
        (0x32509e, 'push', '0'),
    ]
    for rva, op, operands in anchors:
        image.instruction(image.base + rva, op, operands)
    assert image.exported('?AdjustPawnLocation@UGameEngine@@QAEXPAVAPawn@@VFVector@@@Z') == 0x10315046
    assert image.exported('?NActionStop@APawn@@QAEXXZ') == 0x1030bef6
    assert image.exported('?GetCurWaitAnimName@APawn@@QAE?AVFName@@XZ') == 0x10306ee2
    assert [image.u32(image.base + 0x19bf3c + i*4) - image.base for i in range(4)] == [
        0x19bc4d, 0x19bd7a, 0x19be46, 0x19bebb]
    assert image.u32(image.exported('??_7APawn@@6B@') + 0x328) == image.exported(
        '?PlayAnim@APawn@@UAEHHVFName@@MMHH@Z')
    assert image.u32(image.exported('??_7APawn@@6B@') + 0x170) == image.exported(
        '?NotifyAnimEnd@APawn@@UAEXH@Z')
    assert image.u32(image.exported('??_7UGameEngine@@6BUObject@@@') + 0x124) == image.exported(
        '?OnUserInfo@UGameEngine@@UAEHPAUUser@@VFVector@@HHHDD@Z')
    tween = struct.unpack_from('<f', image.data, image.offset(0x1089df54))[0]
    assert tween == struct.unpack('<f', struct.pack('<f', .1))[0]
    idle_tween = struct.unpack_from('<f', image.data, image.offset(0x108a052c))[0]
    assert idle_tween == f32(.2)
    initial_loop_frame = struct.unpack_from('<f', image.data, image.offset(0x108c50a4))[0]
    assert initial_loop_frame == f32(.0001)
    fmt_offset = image.offset(0x1088b080)
    packet_format = bytes(image.data[fmt_offset:image.data.index(0, fmt_offset)]).decode('ascii')
    assert packet_format[59:63] == 'ffff' and packet_format.count('f') == 4
    instructions = list(image.dis.disasm(image.data[0x136777:0x1369c3], image.base+0x136777))
    pushes = [i for i in instructions if i.mnemonic == 'push']
    assert len(pushes) == 85
    # S consumes a destination and capacity; other fields have one destination.
    first_double_argument = 59 + packet_format[:59].count('S')
    assert list(reversed(pushes[:-3]))[first_double_argument].address == image.base+0x136807
    before_pointer = sum(i.address < image.base+0x136800 for i in pushes)
    assert before_pointer == 21
    # Native cleanup is twelve bytes beyond the 85 pushed arguments.
    assert 0x130 - before_pointer*4 - (0x160-len(pushes)*4) == 0xd0
    self_fmt_offset = image.offset(0x1088ae38)
    self_format = bytes(image.data[self_fmt_offset:image.data.index(0, self_fmt_offset)]).decode('ascii')
    assert self_format[113:117] == 'ffff' and self_format.count('f') == 4
    self_instructions = list(image.dis.disasm(image.data[0x134357:0x13473e], image.base+0x134357))
    self_pushes = [i for i in self_instructions if i.mnemonic == 'push']
    assert len(self_pushes) == 138
    self_double_argument = 113 + self_format[:113].count('S')
    assert list(reversed(self_pushes[:-3]))[self_double_argument].address == image.base+0x1343e4
    self_before_pointer = sum(i.address < image.base+0x1343dd for i in self_pushes)
    assert self_before_pointer == 20
    assert 0x168 - self_before_pointer*4 - (0x234-len(self_pushes)*4) == 0x10c
    cases = 0
    for raw in [(0,.5,.5,.016), (.1,.95,.75,.2), (.2,1.4,.95,.7), (.875,.95,.9,.01)]:
        old, advanced, last, delta = map(f32, raw)
        memory = {'dword ptr [edi + 0x10]': advanced, 'dword ptr [edi + 0x14]': last}
        stack = [old, 0., delta]
        x87_slice(image.dis.disasm(image.data[0x3badcf:0x3bade7], image.base+0x3badcf), memory, stack)
        assert memory['dword ptr [ebp - 0x14]'] == f32((advanced-last)*delta/(advanced-old))
        assert memory['dword ptr [edi + 0x10]'] == last
        assert stack == [0.]
        cases += 1
    return {'engineSHA256': image.sha, 'instructionAnchors': len(anchors), 'methods': methods,
            'waitChangeSHA256': sha(image.data[0x19bbc0:0x19bf4c]), 'transitionTween': tween,
            'terminalSHA256': sha(image.data[0x3badcf:0x3bae99]), 'terminalArithmeticCases': cases,
            'nativeIdleTween': idle_tween,
            'snapshotOrder': 'initial GetCurWaitAnimName/loop before incoming Controller.WaitType store',
            'nativeIdleRate': 'Float32(first CharInfo/UserInfo f64 multiplier), via User+0x1c4 to Pawn+0x6b4; distinct from script callback literal 1',
            'snapshotRateDecoderSHA256': sha(image.data[0x136777:0x1369d2]),
            'selfRateDecoderSHA256': sha(image.data[0x134357:0x13474d]),
            'selfInitializationSHA256': sha(image.data[0x1973bc:0x19750d]),
            'selfInitialIdle': {'tween': 0., 'normalizedFrame': initial_loop_frame,
                                'scope': 'new ordinary multi-frame loop, standing controller; same-loop shortcut separate'},
            'limits': 'Callback path requires channel+44 zero; allocation default, arbitrary callback mutation/destruction and native poses remain separate.'}


def script_evidence():
    from export_npc_visuals import OriginalClasses, terminal_defaults
    scripts, hashes = {}, {}
    for package, expected in [('Engine', ('Pawn', 'Controller')), ('LineageWarrior', ('LineagePawn',))]:
        path = ROOT / 'assets/interlude/system' / (package + '.u')
        pkg, _ = pawn.load_package(str(path)); rows = dict(sources_from_package(pkg))
        hashes[package] = sha(path.read_bytes())
        for name in expected:
            scripts[name] = rows[name]
    enum = re.search(r'enum\s+PStopType\s*\{([^}]+)\}', scripts['Controller']).group(1)
    assert re.findall(r'\bSTP_\w+\b', enum) == [
        'STP_SIT', 'STP_STAND', 'STP_FAKE_DEAD', 'STP_FAKE_DEAD_STAND', 'STP_CHAIR_SIT']
    # Pawn has a second AnimEnd inside Dying; use the ordinary final definition.
    ordinary = scripts['Pawn'].rfind('simulated event AnimEnd(int Channel)')
    assert ordinary >= 0
    end = function_body(scripts['Pawn'][ordinary:], 'AnimEnd')
    assert re.search(r'if\s*\(\s*Channel\s*==\s*0\s*\)\s*PlayWaiting\(\)', end)
    lineage = scripts['LineagePawn']
    wait = function_body(lineage, 'GetCurWaitAnimName')
    assert re.search(r'WaitType\s*==\s*STP_SIT\s*\)\s*return\s+GetSitWaitAnimName\(\)', wait)
    assert 'AnimateStanding();' in function_body(lineage, 'PlayWaiting')
    stand = function_body(lineage, 'AnimateStanding')
    assert re.search(r'LoopIfNeeded\(GetCurWaitAnimName\(\),\s*1.0,\s*0.2\)', stand)
    loop = function_body(lineage, 'LoopIfNeeded')
    assert '(NewAnim != OldAnim)' in loop and '(NewRate != Rate)' in loop and '!IsAnimating(0)' in loop
    assert 'LoopAnim(NewAnim, NewRate, BlendIn);' in loop and 'LoopAnim(NewAnim, NewRate);' in loop
    classes = OriginalClasses()
    types = classes.property_types('Engine.Controller', set())
    pkg = classes.packages['Engine']
    owners = [e for e in pkg.exports if pkg.class_name_of(e) == 'Class' and pkg.export_name(e) == 'Controller']
    assert len(owners) == 1
    props, defaults = terminal_defaults(pkg, owners[0], types)
    assert defaults['defaultsBoundary'] == 'unique-validated-candidate'
    assert [p for p in props if p[0] == 'WaitType'] == [('WaitType', 'byte', 1)]
    return {'packageSHA256': hashes,
            'classTextSHA256': {name: sha(text.encode('latin1')) for name, text in scripts.items()},
            'controllerDefaultWaitType': {'value': 1, 'source': defaults},
            'seatedLoopMultiplier': 1., 'changedWaitLoopTween': .2,
            'samePlayingLoop': 'LoopAnim without supplied BlendIn; native setup semantics checked separately'}


def inventory(check_built=False):
    table = pawn.read_warrior_int(); cache = {}; rows = []
    metadata = json.loads(Path(pawn.OUT).read_text()) if check_built else None
    manifest = {m['id']: m for m in json.loads(Path(pawn.MANIFEST).read_text())['models']}
    for model, package, prefix in pawn.PAWNS:
        if package not in cache:
            cache[package] = pawn.load_package(str(Path(pawn.ANIMS, package + '.ukx')))[0]
        pkg = cache[package]
        export = pkg.find_export(prefix + '_anim', 'MeshAnimation')
        original = {r['name'].lower(): r for r in pawn.original_sequences(pkg, export)}
        gltf = json.loads((Path(pawn.CHARACTERS) / manifest[model]['gltf']).read_text())
        clips = {a['name'] for a in gltf['animations']}
        rates = pawn.source_wait_rates(table[prefix]); selected = {}
        for role, field, clip in [('sitDown', 'SitAnimName', 'sitDown'),
                                   ('sitWait', 'SitWaitAnimName', 'sit'),
                                   ('standUp', 'StandAnimName', 'standUp')]:
            names = [table[prefix].get((field, i)) for i in (0,1,2,3,4,5,7)]
            assert all(names) and len({n.lower() for n in names}) == 1
            seq = original[names[0].lower()]
            selected[role] = {'sequence': seq['name'], 'frames': seq['frames'], 'rate': seq['rate'],
                              'source': seq['source'], 'notifyCount': len(seq['notifies']),
                              'clip': clip, 'built': clip in clips}
            if check_built:
                assert clip in clips
                row = metadata['clips'][model][clip]
                assert row['originalTiming'] and (row['seq'], row['frames'], row['rate']) == (
                    seq['name'], seq['frames'], seq['rate'])
                assert row['source'] == seq['source']
                assert metadata['models'][model]['slots'][role]['hand']['clip'] == clip
        if check_built:
            assert all(metadata['models'][model]['rates'][k] == v for k, v in rates.items())
        idle = {}
        for index, stance in enumerate(pawn.STANCE_INDEX):
            name = table[prefix]['WaitAnimName', index]
            seq = original[name.lower()]
            if check_built:
                slot = metadata['models'][model]['slots']['idle'][stance]
                assert slot['seq'] == name and slot['clip'] in clips
                clip = metadata['clips'][model][slot['clip']]
                assert clip['seq'] == seq['name'] and clip['source'] == seq['source']
            idle[stance] = name
        rows.append({'model': model, 'prefix': prefix, 'rates': rates, 'slots': selected, 'idle': idle})
    return {'slotTableSHA256': pawn.file_sha256(pawn.WARRIOR_INT), 'models': rows,
            'missingBuiltClips': sum(not s['built'] for r in rows for s in r['slots'].values())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    report = {'format': 'elbera-sitting-evidence-v1', 'native': native_evidence(),
              'scripts': script_evidence(), 'inventory': inventory(args.check)}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n')
    print('Verified %d native anchors, %d original model slot/rate sets, %d missing built clips.' % (
        report['native']['instructionAnchors'], len(report['inventory']['models']),
        report['inventory']['missingBuiltClips']))


if __name__ == '__main__':
    main()
