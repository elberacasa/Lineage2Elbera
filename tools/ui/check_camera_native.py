#!/usr/bin/env python3
"""Elbera Tools: distinguish stored camera script and active native overrides.

python3 tools/ui/check_camera_native.py --check

Freshly reads the owner's pinned Engine.u, user.ini, l2.ini and Engine/Core
DLLs. Temporary INI decryption is removed on exit; DLLs are decoded only in
memory and never executed. Output contains rules and fingerprints, not assets.
This proves selected script/trace branches, not complete collision or rendering
parity. See docs/native-camera-evidence.md for the deliberately bounded claim.
"""
import argparse
import configparser
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
ENGINE_U_SHA = '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761'
USER_INI_SHA = '18d53de7a88f5363173a6c309e4fc4fd808da9715242e200d6484bbff2e511b0'
L2_INI_SHA = '377ff9e4a08d3657781d218e192dcdf1fba34348812e213d8613d6c609cf177c'
SCRIPT_SHA = '4b32e90aecb29ac9cf539a453b392d9ddbea0b71768c2564f2b0e87c5b9bb073'
FUNCTIONS = {
    'CalcBehindView': 'e5af807c182172cd0a4325ea7ca6daaa9aabea6cf37bd48319e178fc37b13388',
    'PlayerCalcView': 'eb8689f72b37e9d2c48c58bb9114232096f7bf1b1e79bb1e9621cdbef737702b',
    'PlayerTick': '34a29f146de33cc359e3ff01017d47a9fa26466e7cfd4c7c38121954a6e38138',
}


def behind_view_distances(view_distance, projected_hit=None):
    """Source equations for finite scalar examples, not an x87/VM emulator.

    projected_hit is already (target - HitLocation) dot forward. None means
    the trace returned no actor. No zero clamp is present in this script path.
    """
    if not math.isfinite(view_distance) or projected_hit is not None and not math.isfinite(projected_hit):
        raise ValueError('finite source inputs required')
    clipped = view_distance if projected_hit is None else min(projected_hit, view_distance)
    return {'traceReach': view_distance + 30, 'signedBoom': clipped - 30}


def trace_base_flags(trace_actors):
    """execTrace's boolean-to-category arithmetic before auxiliary flags."""
    if not isinstance(trace_actors, bool):
        raise ValueError('explicit source boolean required')
    return ((-int(trace_actors)) & 0x39) + 0x86


def verify_native_override(engine, package):
    """Active virtual path, packed property identity and hit-check branch.

    Rotation-vector imports, complete special modes and primitive collision
    implementations are explicitly outside this selected static proof.
    """
    from l2lib import Reader
    from check_tutorial_quest_native import Image
    from check_skillanim_native import CORE_SHA
    core = Image(ROOT / 'assets/interlude/system/core.dll', CORE_SHA)
    table = engine.exported('??_7ALineagePlayerController@@6B@')
    bindings = {
        0x36c: ('?PlayerCalcView@ALineagePlayerController@@UAEXPAVAActor@@PAVFVector@@PAVFRotator@@@Z', 0x1056e740),
        0x388: ('?CalcVolumeCamera@ALineagePlayerController@@UAEXPAVFVector@@PAVFRotator@@@Z', 0x10569780),
        0x38c: ('?CalcBehindView@ALineagePlayerController@@UAEXPAVFVector@@PAVFRotator@@@Z', 0x1056ea50),
    }
    for offset, (name, address) in bindings.items():
        assert engine.u32(table + offset) == engine.exported(name)
        assert engine.exported(name, True) == address
    draw, = [name for name in engine.exports if name.startswith('?Draw@UGameEngine@@')]
    assert engine.exported(draw, True) == 0x1058ee50
    for prefix, stub, body in [
        ('?SpawnPlayActor@ULevel@@', 0x103141f0, 0x105c7ee0),
        ('?eventLogin@AGameInfo@@', 0x10306ee7, 0x10375190),
        ('?eventL2NetLogin@AGameInfo@@', 0x10313fc5, 0x103750a0),
        ('?SetPlayer@APlayerController@@', 0x10312f12, 0x1052f400),
    ]:
        name, = [name for name in engine.exports if name.startswith(prefix)]
        assert engine.exported(name) == stub and engine.exported(name, True) == body
    assert core.exported('?Link@UBoolProperty@@UAEXAAVFArchive@@PAVUProperty@@@Z', True) == 0x10173250

    # Do not identify packed bits from a matching source spelling alone.
    # Original reflected NEXT order, Core packing and typed native copies
    # independently join names, types, offsets and masks.
    owner, = [entry for entry in package.exports_by_class('Class')
              if package.export_name(entry) == 'LineagePlayerController']
    rows = {}
    for entry in package.exports:
        if entry.package_index != owner.index + 1 or not package.class_name_of(entry).endswith('Property'):
            continue
        raw = package.data[entry.serial_offset:entry.serial_offset + entry.serial_size]
        reader = Reader(raw)
        assert package.name(reader.compact()) == 'None'
        assert reader.compact() == 0
        next_ref = reader.compact()
        dim, flags = reader.u32(), reader.u32()
        category = package.name(reader.compact())
        rows[entry.index + 1] = {'name': package.export_name(entry), 'kind': package.class_name_of(entry),
            'next': next_ref, 'dim': dim, 'flags': flags, 'category': category, 'tail': raw[reader.pos:]}
    ref, = [ref for ref, row in rows.items() if row['name'] == 'CheatFlyYaw']
    chain = []
    for name, kind in [('CheatFlyYaw', 'IntProperty'), ('bUseAutoTrackingPawn', 'BoolProperty'),
                       ('bUseVolumeCamera', 'BoolProperty'), ('bUseHitCheckCamera', 'BoolProperty'),
                       ('AutoTrackingPawnSpeed', 'FloatProperty')]:
        row = rows[ref]
        assert (row['name'], row['kind'], row['dim'], row['flags'], row['tail']) == (name, kind, 1, 0x4000, b'')
        chain.append({'exportRef': ref, 'name': name, 'kind': kind})
        ref = row['next']
    anchors = [
        (0x103d97f2, 'mov', 'dword ptr [esi], 0x1086f26c'),
        (0x105c7ffa, 'call', '0x10306ee7'), (0x105c7fff, 'mov', 'ebx, eax'),
        (0x105c804f, 'call', '0x10313fc5'), (0x105c8054, 'mov', 'ebx, eax'),
        (0x105c80d2, 'mov', 'esi, dword ptr [ebp + 8]'),
        (0x105c80d5, 'push', 'esi'), (0x105c80d6, 'mov', 'ecx, ebx'),
        (0x105c80d8, 'call', '0x10312f12'),
        (0x1052f45a, 'mov', 'dword ptr [edi + 0x560], esi'),
        (0x1052f460, 'mov', 'dword ptr [esi + 0x3c], edi'),
        (0x1058eebd, 'mov', 'ecx, dword ptr [ebx + 0x3c]'),
        (0x1058ef06, 'mov', 'eax, dword ptr [eax + 0x36c]'), (0x1058ef0c, 'call', 'eax'),
        (0x1056e774, 'test', 'byte ptr [esi + 0x858], 2'),
        (0x1056e77d, 'fld', 'dword ptr [esi + 0x998]'), (0x1056e783, 'fstp', 'dword ptr [esi + 0x994]'),
        (0x1056e789, 'test', 'byte ptr [esi + 0x9b4], 3'),
        (0x1056e797, 'cmp', 'dword ptr [esi + 0x5c0], esi'),
        (0x1056e7a5, 'mov', 'eax, dword ptr [edx + 0x38c]'), (0x1056e7af, 'call', 'eax'),
        (0x103d98ce, 'mov', 'eax, dword ptr [ebp + 0x854]'),
        (0x103d98e6, 'and', 'ecx, 1'), (0x103d98e9, 'xor', 'dword ptr [ebx + 0x858], ecx'),
        (0x103d98fd, 'and', 'eax, 2'), (0x103d9902, 'mov', 'dword ptr [ebx + 0x858], eax'),
        (0x103d9910, 'and', 'edx, 4'), (0x103d9915, 'mov', 'dword ptr [ebx + 0x858], edx'),
        (0x103d991b, 'fld', 'dword ptr [ebp + 0x85c]'),
        (0x1056ea5b, 'mov', 'eax, dword ptr [esi + 0x5c0]'),
        (0x1056ea61, 'fld', 'dword ptr [esi + 0x95c]'),
        (0x1056ea67, 'mov', 'ecx, dword ptr [eax + 0x1bc]'),
        (0x1056eabc, 'fld', 'dword ptr [0x108bcf20]'),
        (0x1056eadf, 'fst', 'dword ptr [esi + 0x994]'),
        (0x1056eaeb, 'fstp', 'dword ptr [esi + 0x998]'),
        (0x1056eaf1, 'mov', 'eax, 0xfffff574'),
        (0x1056f017, 'cmp', 'eax, 0xffffc568'),
        (0x1056f020, 'mov', 'dword ptr [edi], 0xffffc568'),
        (0x1056f028, 'cmp', 'eax, 0x4000'), (0x1056f02f, 'mov', 'dword ptr [edi], 0x4000'),
        (0x1056f035, 'fld', 'dword ptr [esi + 0x994]'),
        (0x1056f041, 'test', 'al, 2'), (0x1056f043, 'fadd', 'qword ptr [0x108a1d90]'),
        (0x1056f054, 'mov', 'edx, dword ptr [eax + 0x388]'),
        (0x1056f06f, 'test', 'al, 4'), (0x1056f071, 'je', '0x1056f2bc'),
        (0x1056f10c, 'fadd', 'qword ptr [0x1089d2f0]'),
        (0x1056f15a, 'fld', 'dword ptr [0x1089df54]'),
        (0x1056f164, 'fst', 'dword ptr [esp + 0x60]'),
        (0x1056f16e, 'fstp', 'dword ptr [esp + 0x64]'),
        (0x1056f176, 'fld', 'dword ptr [0x1089139c]'),
        (0x1056f17c, 'fstp', 'dword ptr [esp + 0x68]'),
        (0x1056f1a8, 'mov', 'dword ptr [eax], ecx'),
        (0x1056f1ae, 'mov', 'dword ptr [eax + 4], ecx'),
        (0x1056f1b5, 'mov', 'dword ptr [eax + 8], ecx'),
        (0x1056f1b8, 'push', '0x86'),
        (0x1056f1c1, 'mov', 'edx, dword ptr [edx + 0xe4]'), (0x1056f1dc, 'call', 'edx'),
        (0x1056f1de, 'cmp', 'dword ptr [esp + 0x70], ebx'),
        (0x1056f240, 'call', '0x10303ddc'),
        (0x1056f250, 'fsub', 'qword ptr [0x1089d2f0]'),
    ]
    for address, op, operands in anchors: engine.instruction(address, op, operands)
    core_anchors = [
        (0x101732a6, 'mov', 'eax, dword ptr [ebx + 0x54]'),
        (0x101732a9, 'mov', 'dword ptr [esi + 0x54], eax'),
        (0x101732ac, 'mov', 'ecx, dword ptr [edi + 0x78]'),
        (0x101732af, 'add', 'ecx, ecx'), (0x101732b1, 'mov', 'dword ptr [esi + 0x78], ecx'),
        (0x101732c0, 'add', 'eax, 3'), (0x101732c3, 'and', 'eax, 0xfffffffc'),
        (0x101732c9, 'mov', 'dword ptr [esi + 0x78], 1'),
        (0x101732d0, 'mov', 'dword ptr [esi + 0x44], 4'),
    ]
    for address, op, operands in core_anchors: core.instruction(address, op, operands)
    ranges = [
        (engine, 0x1056ea50, 0x1056eb02, '8b16980743cde77133a76c45a5d63019159279051496cbc2f7d2d712931df2c2'),
        (engine, 0x1056f017, 0x1056f2bc, '71ec6de009424298512f0da4bdde214c37afa6413aa59328501fe4fe848c235c'),
        (engine, 0x1058eef8, 0x1058ef0e, 'a5dcc51c9eee51449108f31a40900c6922d0612753af69ad0a3478d989b3bf8d'),
        (engine, 0x1056e780, 0x1056e7b5, 'c2fe9d9f791da66dbb046e16709dc2fa00e38088bdd9f33de83d9c181ce9b0c4'),
        (engine, 0x103d98ce, 0x103d9927, 'a2f7e0770b24c36b5aae30f1b273b6c6e77598a22270490a84d3b11d6bed6b65'),
        (core, 0x10173250, 0x101732da, '627127acedb792c29ca1a4da84f3d5655e2746b0b2e070ec3e8c9de32cdb9d8e'),
    ]
    for image, a, b, digest in ranges:
        assert hashlib.sha256(image.data[image.offset(a):image.offset(b)]).hexdigest() == digest
    constants = [(0x108bcf20, 'f', -20.), (0x108a1d90, 'd', 250.),
                 (0x1089d2f0, 'd', 30.), (0x1089df54, 'f', 0.10000000149011612),
                 (0x1089139c, 'f', 5.)]
    for address, fmt, value in constants:
        assert struct.unpack_from('<' + fmt, engine.data, engine.offset(address))[0] == value
    # The selected min helper is retained code, not an assumed imported FMin.
    engine.instruction(0x10303ddc, 'jmp', '0x104a4970')
    engine.instruction(0x104a4978, 'fcom', 'st(1)')
    engine.instruction(0x104a497f, 'jne', '0x104a498c')
    for address in (0x1056f08b, 0x1056f09e, 0x1056f11d):
        assert engine.data[engine.offset(address):engine.offset(address) + 6] == b'\x90' * 6
    return {'engineAnchors': len(anchors) + 3, 'coreAnchors': len(core_anchors),
            'coreSHA256': CORE_SHA, 'controllerVtable': hex(table), 'propertyChain': chain,
            'packedFlags': {'offset': '0x858', 'bUseAutoTrackingPawn': 1,
                            'bUseVolumeCamera': 2, 'bUseHitCheckCamera': 4},
            'configuredHitCheckBranch': {'baseFlags': '0x86', 'extent': [0.10000000149011612, 0.10000000149011612, 5.0],
                'initialZoom': -20, 'baseDistance': 250, 'reachAddition': 30, 'finalSubtraction': 30,
                'ordinaryManualPitchClamp': [-15000, 16384]},
            'ranges': [{'image': 'core.dll' if image is core else 'engine.dll',
                        'start': hex(a), 'end': hex(b), 'sha256': digest} for image, a, b, digest in ranges],
            'limits': ['native direction-vector import targets are unverified',
                       'special/volume/disabled-hitcheck camera branches not ported',
                       'native nonzero-extent BSP/terrain/static primitives remain unported']}


def read_defaults():
    path = ROOT / 'assets/interlude/system/user.ini'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == USER_INI_SHA
    with tempfile.TemporaryDirectory(prefix='elbera-camera-') as directory:
        output = Path(directory) / 'user.ini'
        subprocess.run([str(ROOT / 'tools/bin/l2encdec'), '-c', 'decode', '-p', '413',
                        '-o', str(output), str(path)], check=True, capture_output=True)
        config = configparser.ConfigParser(strict=False, interpolation=None)
        config.read_string(output.read_bytes().decode('latin-1'))
    section = config['Engine.LineagePlayerController']
    values = {
        'CameraViewHeightAdjust': section.getfloat('CameraViewHeightAdjust'),
        'bUseVolumeCamera': section.getboolean('bUseVolumeCamera'),
        'bUseHitCheckCamera': section.getboolean('bUseHitCheckCamera'),
        'bUseAutoTrackingPawn': section.getboolean('bUseAutoTrackingPawn'),
        'MinZoomingDist': section.getfloat('MinZoomingDist'),
        'MaxZoomingDist': section.getfloat('MaxZoomingDist'),
        'FixedDefaultCameraDist[0]': section.getfloat('FixedDefaultCameraDist[0]'),
        'FixedDefaultCameraPitch[0]': section.getfloat('FixedDefaultCameraPitch[0]'),
        'DefaultFOV': config['Engine.PlayerController'].getfloat('DefaultFOV'),
    }
    assert values == dict(CameraViewHeightAdjust=0, bUseVolumeCamera=False,
                         bUseHitCheckCamera=True, bUseAutoTrackingPawn=True,
                         MinZoomingDist=-200, MaxZoomingDist=250,
                         **{'FixedDefaultCameraDist[0]': 230,
                            'FixedDefaultCameraPitch[0]': -2700, 'DefaultFOV': 60})
    path = ROOT / 'assets/interlude/system/l2.ini'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == L2_INI_SHA
    with tempfile.TemporaryDirectory(prefix='elbera-camera-config-') as directory:
        output = Path(directory) / 'l2.ini'
        subprocess.run([str(ROOT / 'tools/bin/l2encdec'), '-c', 'decode', '-p', '413',
                        '-o', str(output), str(path)], check=True, capture_output=True)
        config = configparser.ConfigParser(strict=False, interpolation=None)
        config.read_string(output.read_bytes().decode('latin-1'))
    values['DefaultPlayerController'] = config['Engine.Engine']['DefaultPlayerController']
    assert values['DefaultPlayerController'] == 'Engine.LineagePlayerController'
    return values


def verify():
    sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'tools/uscript')]
    from l2lib import load_package
    from extract_uscript import sources_from_package
    from check_inventory_native import script_function
    from check_tutorial_quest_native import Image, ENGINE_SHA

    path = ROOT / 'assets/interlude/system/Engine.u'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == ENGINE_U_SHA
    package, _ = load_package(path)
    sources = dict(sources_from_package(package))
    game_info = sources['GameInfo']
    assert hashlib.sha256(game_info.encode('utf-8')).hexdigest() == '6db48abd234c470e248de1faa38a35f2f77ba839aaf5367203154c82878dd0c1'
    login_hashes = {'Login': '542a6448fbcba602a0dcff59159cdeb907486c7982d5a372f71d40b5a54e32a3',
                    'L2NetLogin': '287399cd64426c3b4b652e493680e093a38d884475f4397fe8134b37837377d2'}
    for name, digest in login_hashes.items():
        body = script_function(re.sub(r'\bevent\b', 'function', game_info), name)
        assert hashlib.sha256(body.encode('utf-8')).hexdigest() == digest
        compact_body = re.sub(r'\s+', '', body)
        assert 'DynamicLoadObject("ini:Engine.Engine.DefaultPlayerController",class\'Class\')' in compact_body
        assert 'NewPlayer=spawn(PlayerControllerClass,,,StartSpot.Location,StartSpot.Rotation);' in compact_body
    source = sources['LineagePlayerController']
    assert hashlib.sha256(source.encode('latin-1')).hexdigest() == SCRIPT_SHA
    # The existing bounded function helper handles `function`; replace the
    # source event keyword only for extraction, retaining whole body hashes.
    normalized = re.sub(r'\bevent\b', 'function', source)
    bodies = {name: script_function(normalized, name) for name in FUNCTIONS}
    for name, digest in FUNCTIONS.items():
        assert hashlib.sha256(bodies[name].encode('latin-1')).hexdigest() == digest
    compact = {name: re.sub(r'\s+', '', text) for name, text in bodies.items()}
    checks = {
        'PlayerCalcView': ['CameraLocation=ViewTarget.Location;',
                           'if(!bUseVolumeCamera)CurZoomingDist=DesiredZoomingDist;',
                           'CalcBehindView(CameraLocation,CameraRotation,250);'],
        'CalcBehindView': ['CameraLocation.Z+=CameraViewHeightAdjust;',
            'ViewDist=Dist+CurZoomingDist;',
            'Trace(HitLocation,HitNormal,CameraLocation-(ViewDist+30)*vector(CameraRotation),CameraLocation,false)',
            'ViewDist=FMin((CameraLocation-HitLocation)DotView,ViewDist);',
            'CameraLocation-=(ViewDist-30)*View;',
            'if(CurZoomingDist==OldZoomingDist){CameraLocation=OldCameraLocation;return;}',
            'if(CameraRotation.Pitch<-15000)CameraRotation.Pitch=-15000;',
            'elseif(CameraRotation.Pitch>15000)CameraRotation.Pitch=15000;',
            'View=vect(1,1,0)*(CameraLocation-OldCameraLocation);'],
    }
    for name, snippets in checks.items():
        for snippet in snippets: assert snippet in compact[name], (name, snippet)
    actor = re.sub(r'\s+', '', sources['Actor'])
    assert 'native(277)finalfunctionActorTrace(outvectorHitLocation,outvectorHitNormal,vectorTraceEnd,optionalvectorTraceStart,optionalboolbTraceActors,optionalvectorExtent,optionaloutmaterialMaterial);' in actor
    defaults = read_defaults()

    engine = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, decode=True)
    native_override = verify_native_override(engine, package)
    def exported(prefix, body=True):
        name, = [name for name in engine.exports if name.startswith(prefix)]
        return engine.exported(name, body)
    functions = {
        '?execTrace@AActor@@': 0x106a88f0,
        '?SingleLineCheck@ULevel@@': 0x105c2da0,
        '?MultiLineCheck@ULevel@@': 0x105c5920,
        '?LineCheck@UModel@@': 0x10749210,
        '?LineCheck@ATerrainInfo@@': 0x10722670,
        '?ShouldTrace@AActor@@': 0x1052fe70,
        '?ActorLineCheck@FCollisionHash@@': 0x10523900,
    }
    for prefix, address in functions.items(): assert exported(prefix) == address
    level = engine.exported('??_7ULevel@@6BUObject@@@')
    assert engine.u32(level + 0xe4) == exported('?SingleLineCheck@ULevel@@', False)
    assert engine.u32(level + 0xf4) == exported('?MultiLineCheck@ULevel@@', False)
    assert engine.u32(engine.exported('??_7UModel@@6B@') + 0x6c) == exported('?LineCheck@UModel@@', False)
    assert engine.u32(engine.exported('??_7FCollisionHash@@6B@') + 0x10) == exported('?ActorLineCheck@FCollisionHash@@', False)
    anchors = [
        # Trace optional Extent is explicitly initialized to (0,0,0).
        (0x106a8a38, 'fldz', ''),
        (0x106a8a3d, 'fst', 'dword ptr [esp + 0x20]'),
        (0x106a8a44, 'fst', 'dword ptr [esp + 0x24]'),
        (0x106a8a48, 'fstp', 'dword ptr [esp + 0x28]'),
        (0x106a8aea, 'mov', 'esi, dword ptr [esp + 0x18]'),
        (0x106a8af2, 'neg', 'esi'), (0x106a8af8, 'sbb', 'esi, esi'),
        (0x106a8afe, 'and', 'esi, 0x39'), (0x106a8b05, 'add', 'esi, 0x86'),
        (0x106a8b40, 'or', 'esi, 0x1000'),
        (0x106a8b71, 'mov', 'edx, dword ptr [edx + 0xe4]'),
        (0x106a8b8c, 'push', 'esi'), (0x106a8b9d, 'call', 'edx'),
        # Ordinary wrapper adds 0x400; it is not the mouse L2 wrapper.
        (0x105c2ddd, 'or', 'ebx, 0x400'),
        (0x105c2e4c, 'mov', 'edx, dword ptr [edx + 0xf4]'),
        (0x105c2e52, 'call', 'edx'),
        # BSP model and terrain are independent world collision paths.
        (0x105c5e2b, 'and', 'eax, 4'),
        (0x105c5e48, 'mov', 'ecx, dword ptr [eax + 0xc0]'),
        (0x105c5e9e, 'mov', 'edx, dword ptr [edx + 0x6c]'),
        (0x105c5ea1, 'call', 'edx'),
        (0x105c6242, 'test', 'dword ptr [ebp + 0x74], 0x100'),
        (0x105c6252, 'cmp', 'esi, 0x40'),
        (0x105c626f, 'test', 'byte ptr [eax + 0x3d8], 4'),
        (0x105c62f6, 'call', '0x10301fff'),
        (0x105c64d1, 'test', 'dword ptr [ebp + 0x74], 0x4009b'),
        (0x105c653e, 'mov', 'edx, dword ptr [edx + 0x10]'),
        (0x105c6541, 'call', 'edx'),
        # Zero/nonzero extent paths retain different source actor flag gates.
        (0x10523a5e, 'test', 'byte ptr [esi + 0x2f8], 0x20'),
        (0x10523eab, 'test', 'byte ptr [esi + 0x2f8], 0x40'),
        (0x10523a92, 'mov', 'edx, dword ptr [edx + 0x160]'),
        (0x10523aa6, 'mov', 'edx, dword ptr [eax + 0x164]'),
        (0x10523b06, 'mov', 'edx, dword ptr [esi + 0x6c]'),
        (0x1052ff5a, 'test', 'byte ptr [esi + 0x74], 2'),
        (0x1052ff62, 'and', 'eax, 0x80'),
        (0x1052ff7a, 'test', 'bl, 0x10'),
        # First eligible hit copied, missing result returns Actor=None.
        (0x105c2f5d, 'rep movsd', 'dword ptr es:[edi], dword ptr [esi]'),
        (0x105c2f69, 'mov', 'dword ptr [eax + 4], 0'),
    ]
    for address, mnemonic, operands in anchors: engine.instruction(address, mnemonic, operands)
    ranges = [
        (0x106a88f0, 0x106a8bf4, 'c7c0a93d85267872e549372564722b4f84f1feb6fa761546f39e54416b71f6e5'),
        (0x105c2da0, 0x105c2ff0, 'b169db86620337f743e75b4b119ad0676b27d2c2999daa301f04cd79bac68ab7'),
        (0x105c5e28, 0x105c5fec, 'ec9b28781cf84a761e22afd108eeced368b794dfcabfce26390c2992dc894dc1'),
        (0x105c6234, 0x105c64b1, 'eab51c292adba5acac3ad1ad1e27a22c2cf5f5ab45b317badbb1c877db4f21f5'),
        (0x105c64cc, 0x105c658f, '060358366ac8d5c9fac6b5ddff66a6b30309e8daf2ec5c2ca3d453cf19ee06d1'),
        (0x1052ff48, 0x1052ff83, 'aee8fb96091ab4466d445097fbbc0f2e4de2538af9fdb438deef001a035109f4'),
        (0x10523a5c, 0x10523ade, '3272e10997b8e7c8fe8e3d0e7542783536a402c16160520e9818d5199670e7a4'),
    ]
    for a, b, digest in ranges:
        assert hashlib.sha256(engine.data[engine.offset(a):engine.offset(b)]).hexdigest() == digest
    # These erased sites are an explicit proof boundary, not an invented ABI.
    assert engine.data[engine.offset(0x10523945):engine.offset(0x1052394b)] == b'\x90' * 6
    assert engine.data[engine.offset(0x105c66b7):engine.offset(0x105c66bd)] == b'\x90' * 6
    return {'tool': 'Elbera Tools', 'format': 'original-camera-evidence-v1',
            'sourceSHA256': {'Engine.u': ENGINE_U_SHA, 'user.ini': USER_INI_SHA,
                             'l2.ini': L2_INI_SHA, 'engine.dll': ENGINE_SHA},
            'gameInfoLoginBodySHA256': login_hashes,
            'scriptSHA256': SCRIPT_SHA, 'functionSHA256': FUNCTIONS, 'defaults': defaults,
            'scriptAnchors': sum(map(len, checks.values())), 'nativeAnchors': len(anchors),
            'nativeFunctions': {k: hex(v) for k, v in functions.items()},
            'nativeRanges': [{'start': hex(a), 'end': hex(b), 'sha256': c} for a, b, c in ranges],
            'scriptTrace': {'baseFlags': hex(trace_base_flags(False)), 'extent': [0, 0, 0],
                      'worldModel': True, 'terrain': True, 'staticActorCategory': True},
            'nativeOverride': native_override,
            'examples': {str(distance): behind_view_distances(distance) for distance in (50, 230, 500)},
            'limits': ['stored script is distinct from the active native camera override',
                       'not full input/special camera modes',
                       'Actor.Location is not derived from rendered model height',
                       'erased extent-predicate and sort import bindings remain unresolved',
                       'native collision geometry, one-sidedness, hit bias and complete filters are not triangle-ray parity',
                       'user.ini values do not prove every later config override or initialization path']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='print compact verification result')
    args = parser.parse_args()
    result = verify()
    if args.check:
        print(f"Elbera Tools camera PASS: {len(FUNCTIONS)} camera + 2 login bodies, "
              f"{result['scriptAnchors']} script anchors, {result['nativeAnchors']} native anchors, "
              f"{len(result['nativeRanges'])} trace ranges; native override "
              f"{result['nativeOverride']['engineAnchors']} Engine/{result['nativeOverride']['coreAnchors']} Core anchors, "
              f"{len(result['nativeOverride']['ranges'])} ranges; shipped hit-check extent (0.1, 0.1, 5)")
    else:
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
