#!/usr/bin/env python3
"""Elbera Tools: original wait-position correction and initial player trace evidence.

Requires the owner's original Interlude Engine.dll. Decodes only in memory;
never executes native code, opens the game, or changes world assets. This is
a bounded trace-input/control-flow audit, not a native collision solver.
"""
import argparse
import hashlib
import json
import re
import struct
import sys

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA
from check_player_transform_native import f32
from check_legacy_skill_effects_native import LinearX87


def correction_trace_z(packet_z, collision_height):
    """Ordinary AdjustPawnLocation trace seed, after its admission gates."""
    z, height = f32(packet_z), f32(collision_height)
    return f32(z + height + 20.), f32(z - 30.)


def collision_hit_z(hit_z, hit_time):
    """Only the recovered post-trace bias, given native collision results."""
    z, time = f32(hit_z), f32(hit_time)
    d = f32(time * 12.)
    return f32(z + (2.150000035762787 - d)) if d < 1.899999976158142 else z


def verify():
    image = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    methods = {
        '?AdjustPawnLocation@UGameEngine@@QAEXPAVAPawn@@VFVector@@@Z': 0x18e300,
        '?execGetViewport@AActor@@QAEXAAUFFrame@@QAX@Z': 0x3a06d0,
        '?LockOnActor@UViewport@@QAEXPAVAActor@@@Z': 0x5b7e0,
        '?GetCylinderExtent@AActor@@QBE?AVFVector@@XZ': 0x3e620,
        '?OnUserInfo@UGameEngine@@UAEHPAUUser@@VFVector@@HHHDD@Z': 0x196b30,
        '?OnMoveToPawn@UGameEngine@@UAEHPAUUser@@0HVFVector@@@Z': 0x18ebb0,
        '?MoveToward@AController@@QAEXPAVAActor@@0M@Z': 0x26d370,
        '?AddMoveToward@AController@@QAEXVFVector@@PAVAActor@@M@Z': 0x270680,
        '?moveToward@APawn@@QAEHABVFVector@@PAVAActor@@@Z': 0x320300,
        '?ReachedDestination@APawn@@QAEHVFVector@@PAVAActor@@@Z': 0x3186e0,
    }
    for name, rva in methods.items():
        assert image.exported(name, True) == image.base + rva
    level = image.exported('??_7ULevel@@6BUObject@@@')
    slots = {}
    for slot, prefix in [(0xe4, '?SingleLineCheck@ULevel@@'), (0xa8, '?FarMoveActor@ULevel@@')]:
        names = [n for n in image.exports if image.exported(n) == image.u32(level+slot)]
        assert len(names) == 1 and names[0].startswith(prefix)
        slots[hex(slot)] = names[0]
    anchors = [
        (0x19bbfe, 'call', '0x10315046'),
        (0x19bc1a, 'cmp', 'edx, edi'),
        (0x18e30f, 'je', '0x1048e54f'),
        (0x18e31d, 'je', '0x1048e54f'),
        (0x18e323, 'test', 'byte ptr [eax + 0x41c], 1'),
        (0x18e32a, 'jne', '0x1048e54f'),
        (0x18e34a, 'fsub', 'dword ptr [esi + 0x2f4]'),
        (0x18e38a, 'fcomp', 'qword ptr [0x1089de88]'),
        (0x18e395, 'jne', '0x1048e54f'),
        (0x18e3a1, 'cmp', 'dword ptr [ecx + 0x424], 0'),
        (0x18e3a8, 'jne', '0x1048e54f'),
        (0x18e3ae, 'mov', 'eax, dword ptr [edi + 0x54]'),
        (0x18e3b1, 'mov', 'edx, dword ptr [eax + 0x38]'),
        (0x18e3b4, 'mov', 'eax, dword ptr [edx]'),
        (0x18e3b6, 'mov', 'eax, dword ptr [eax + 0x3c]'),
        (0x18e3b9, 'cmp', 'eax, ecx'),
        (0x18e3c1, 'je', '0x1048e54f'),
        (0x3a0733, 'mov', 'eax, dword ptr [eax + 0x54]'),
        (0x3a073a, 'mov', 'eax, dword ptr [eax + 0x38]'),
        (0x3a0742, 'mov', 'eax, dword ptr [eax]'),
        (0x3a0747, 'mov', 'dword ptr [ecx], eax'),
        (0x5b7f7, 'mov', 'eax, dword ptr [ecx + 0x3c]'),
        (0x5b801, 'mov', 'dword ptr [eax + 0x1bc], esi'),
        (0x196b4b, 'mov', 'eax, dword ptr [ecx + 0x54]'),
        (0x196b54, 'mov', 'ecx, dword ptr [eax + 0x38]'),
        (0x196b57, 'mov', 'ebp, dword ptr [ecx]'),
        (0x196b59, 'mov', 'eax, dword ptr [ebp + 0x3c]'),
        (0x18e3e4, 'mov', 'eax, dword ptr [esi + 0x778]'),
        (0x18e3ea, 'cmp', 'eax, 1'),
        (0x18e405, 'je', '0x1048e513'),
        (0x18e40b, 'cmp', 'eax, 2'),
        (0x18e40e, 'je', '0x1048e513'),
        (0x18e414, 'cmp', 'byte ptr [esi + 0x34], 4'),
        (0x18e418, 'je', '0x1048e513'),
        (0x18e41e, 'fld', 'dword ptr [esi + 0x2f4]'),
        (0x18e42c, 'fadd', 'qword ptr [0x1089f9a8]'),
        (0x18e440, 'fsub', 'qword ptr [0x1089d2f0]'),
        (0x18e457, 'call', '0x1030a2b3'),
        (0x3e624, 'fld', 'dword ptr [ecx + 0x2f0]'),
        (0x3e62c, 'fld', 'dword ptr [ecx + 0x2f0]'),
        (0x3e635, 'fld', 'dword ptr [ecx + 0x2f4]'),
        (0x18e460, 'mov', 'edx, dword ptr [edx + 0xe4]'),
        (0x18e479, 'push', '0x86'),
        (0x18e490, 'call', 'edx'),
        (0x18e494, 'fcomp', 'dword ptr [esp + 0x44]'),
        (0x18e49d, 'jp', '0x1048e4c9'),
        (0x18e4b0, 'cmp', 'eax, 0x1e'),
        (0x18e4c7, 'jl', '0x1048e450'),
        (0x18e4e8, 'fmul', 'qword ptr [0x10891488]'),
        (0x18e4f6, 'fcom', 'qword ptr [0x10891478]'),
        (0x18e503, 'fsubr', 'qword ptr [0x10891468]'),
        (0x18e50d, 'fstp', 'dword ptr [esp + 0x44]'),
        (0x18e529, 'mov', 'edx, dword ptr [edx + 0xa8]'),
        (0x18e54d, 'call', 'edx'),
        (0x196bda, 'fsub', 'qword ptr [0x1089de78]'),
        (0x196bf0, 'fld', 'dword ptr [esi + 0x1d0]'),
        (0x196bfd, 'fadd', 'qword ptr [0x1089f9a8]'),
        (0x196c15, 'fadd', 'dword ptr [esp + 0xe0]'),
        (0x196c40, 'fld', 'dword ptr [esi + 0x1cc]'),
        (0x196c66, 'fld', 'dword ptr [esi + 0x1d0]'),
        (0x196c79, 'push', '0x86'),
        (0x196ccb, 'call', 'edx'),
        (0x196dc5, 'call', '0x1030c671'),
        # Ordinary 0x60 packet: six DWORD fields and the named handler slot.
        (0x124920, 'push', '0x10886c3c'),
        (0x124a4a, 'mov', 'edx, dword ptr [edx + 0xfc]'),
        (0x124a69, 'push', 'eax'),
        (0x124a6a, 'push', 'ebx'),
        (0x124a9e, 'push', 'ebp'),
        (0x124a9f, 'call', 'edx'),
        # Local handler preserves distance, without using remote packet XYZ.
        (0x18ecfa, 'cmp', 'ecx, dword ptr [eax + 0x3bc]'),
        (0x18ed00, 'jne', '0x1048ed52'),
        (0x18ed12, 'fild', 'dword ptr [esp + 0x20]'),
        (0x18ed24, 'fstp', 'dword ptr [eax + 0x6c4]'),
        (0x18ed43, 'call', '0x103015a5'),
        (0x18ed70, 'call', '0x10315046'),
        (0x18ed8c, 'fst', 'dword ptr [edx + 0x6c4]'),
        (0x18edb5, 'call', '0x1030a213'),
        # Controller -> Pawn movement -> reached predicate -> zero acceleration.
        (0x26d687, 'call', '0x1031050a'),
        (0x3209c6, 'call', '0x10301415'),
        (0x3209cb, 'test', 'eax, eax'),
        (0x3209cd, 'je', '0x106209fe'),
        (0x3209cf, 'fldz', ''),
        (0x3209dd, 'mov', 'dword ptr [esi + 0x1e0], edx'),
        (0x3209e6, 'mov', 'dword ptr [esi + 0x1e4], eax'),
        (0x3209ef, 'mov', 'dword ptr [esi + 0x1e8], ecx'),
        (0x32082b, 'mov', 'eax, 1'),
        # The target-Pawn candidate uses packet distance, then another offset.
        # Erased type/vector helpers prevent claiming the full predicate.
        (0x3188a7, 'push', '0x10daf7d8'),
        (0x3188ec, 'fld', 'dword ptr [esi + 0x6c4]'),
        (0x31892c, 'fstp', 'dword ptr [ebp - 0x1c]'),
        (0x31892f, 'fld', 'dword ptr [esi + 0x152c]'),
        (0x318935, 'fadd', 'dword ptr [ebp - 0x1c]'),
        (0x318943, 'fstp', 'dword ptr [ebp + 0x10]'),
        (0x31895a, 'fcompp', ''),
        (0x318961, 'jnp', '0x10618b7d'),
    ]
    for rva, op, args in anchors:
        image.instruction(image.base+rva, op, args)
    dispatch = b'\xc7\x05' + struct.pack('<I', 0x10a57310 + 0x60*0x104)
    assert image.data.count(dispatch) == 1
    dispatch_offset = image.data.index(dispatch)
    packet_stub = image.u32(image.base+dispatch_offset+6)
    assert packet_stub == 0x103140c4
    stub_offset = image.offset(packet_stub)
    assert image.data[stub_offset] == 0xe9
    assert packet_stub+5+struct.unpack_from('<i', image.data, stub_offset+1)[0] == 0x104248f0
    assert image.data[image.offset(0x10886c3c):image.offset(0x10886c3c)+7] == b'dddddd\0'
    game_vtable = image.exported('??_7UGameEngine@@6BUObject@@@')
    assert image.u32(game_vtable+0xfc) == image.exported('?OnMoveToPawn@UGameEngine@@UAEHPAUUser@@0HVFVector@@@Z')
    assert image.exported('?PrivateStaticClass@APawn@@0VUClass@@A') == 0x10daf7d8
    for start in (0x3188ac, 0x31894f):
        assert image.data[start:start+6] == b'\x90'*6
    # The displacement helper is erased. Its ABI alone cannot prove Size vs SizeSquared.
    assert image.data[0x18e384:0x18e38a] == b'\x90'*6
    assert image.exported('?eventSpawnPlayerPawn@AGameInfo@@QAEXPAVAController@@ABVFString@@VFVector@@VFRotator@@@Z') == 0x1030c671
    sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'tools/uscript')]
    from l2lib import load_package
    from extract_uscript import sources_from_package
    package_path = ROOT / 'assets/interlude/system/Engine.u'
    package, _ = load_package(str(package_path))
    player_source = dict(sources_from_package(package))['Player']
    assert re.search(r'var\s+transient\s+const\s+playercontroller\s+Actor\s*;', player_source)
    constants = {}
    for name, va, expected in [('unboundDisplacementThreshold',0x1089de88,200.),
                              ('startRaise',0x1089f9a8,20.), ('correctionEndLower',0x1089d2f0,30.),
                              ('initialEndLower',0x1089de78,10.), ('hitTimeScale',0x10891488,12.),
                              ('hitThreshold',0x10891478,1.899999976158142),
                              ('hitBias',0x10891468,2.150000035762787)]:
        constants[name] = struct.unpack_from('<d',image.data,image.offset(va))[0]
        assert constants[name] == expected
    cases = 0
    code = list(image.dis.disasm(image.data[0x18e42c:0x18e44a],image.base+0x18e42c))
    for raw_z, raw_height in [(0,23),(-4672,23),(12345.678,15.2),(-32768.5,100.)]:
        z,height = f32(raw_z),f32(raw_height)
        machine = LinearX87({0x1000+0x74:z,0x1089f9a8:20.,0x1089d2f0:30.},
                            {'esp':0x1000},[height])
        machine.run(code)
        assert (machine.memory[0x1018],machine.memory[0x1024]) == correction_trace_z(z,height)
        assert not machine.stack
        cases += 1
    ranges = [('AdjustPawnLocation',0x18e300,0x18e559),
              ('OnUserInfo first floor trace',0x196bcf,0x196e20),
              ('MoveToPawn decoder',0x1248f0,0x124aa1),
              ('OnMoveToPawn',0x18ebb0,0x18edc4),
              ('Pawn moveToward reached branch',0x3209aa,0x3209fe),
              ('ReachedDestination distance candidate',0x3188a7,0x318967)]
    return {'format':'elbera-grounding-evidence-v1','engineSHA256':image.sha,
            'enginePackageSHA256':hashlib.sha256(package_path.read_bytes()).hexdigest(),
            'playerClassTextSHA256':hashlib.sha256(player_source.encode('latin1')).hexdigest(),
            'instructionAnchors':len(anchors),'traceArithmeticCases':cases,
            'methods':methods,'levelSlots':slots,'constants':constants,
            'viewportCorrection':'skip when Pawn.Controller equals first viewport actor',
            'moveToPawn':{'opcode':0x60,'packetFormat':'dddddd',
                          'distanceField':'Pawn+0x6c4 signed DWORD to Float32',
                          'localOriginCorrection':False,
                          'reachedResult':'clear acceleration and return true; do not choose target center',
                          'completeReachedPredicateVerified':False},
            'ranges':[{'name':n,'startRVA':hex(a),'endRVAExclusive':hex(b),
                       'SHA256':hashlib.sha256(image.data[a:b]).hexdigest()} for n,a,b in ranges],
            'limits':['erased displacement helper','unnamed controller/state admission fields',
                      'native collision geometry and trace filters','FarMoveActor collision semantics',
                      'initial spawn retries and native actor/mesh origin integration',
                      'ReachedDestination erased type/vector helpers and additional height/collision gates']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true',help='verify original evidence; no receipt unless --output is supplied')
    parser.add_argument('--output',type=str)
    args=parser.parse_args();report=verify()
    if args.output:
        from pathlib import Path
        path=Path(args.output);path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(report,indent=2)+'\n')
    print('Verified %d grounding anchors and %d original trace-input arithmetic cases.' % (
        report['instructionAnchors'],report['traceArithmeticCases']))


if __name__=='__main__':main()
