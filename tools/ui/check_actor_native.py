#!/usr/bin/env python3
"""Check original Interlude skeletal scale evidence without executing binaries.

python3 tools/ui/check_actor_native.py --check
Uses the existing exact-build PE decoder and Capstone instruction checker.
See docs/native-actor-evidence.md for the interpretation and its limits.
"""
import argparse
import json

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA


def verify():
    engine = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, decode=True)
    functions = {
        '?SetDrawScale@AActor@@QAEXM@Z': 0x1052d780,
        '?SetDrawScale3D@AActor@@QAEXVFVector@@@Z': 0x1052dab0,
        '?GetActor@ULodMeshInstance@@UAEPAVAActor@@XZ': 0x10360d80,
        '?GetMesh@ULodMeshInstance@@UAEPAVUMesh@@XZ': 0x10360cf0,
        '?SetScale@USkeletalMeshInstance@@UAEXVFVector@@@Z': 0x106b25d0,
        '?MeshToWorld@USkeletalMeshInstance@@UAE?AVFMatrix@@M@Z': 0x106bc040,
        '?MeshToWorld@USubSkeletalMeshInstance@@UAE?AVFMatrix@@M@Z': 0x106b5f20,
        '?Serialize@ULodMesh@@UAEXAAVFArchive@@@Z': 0x105ddee0,
        '?Serialize@UMesh@@UAEXAAVFArchive@@@Z': 0x105e47f0,
        '?Serialize@UPrimitive@@UAEXAAVFArchive@@@Z': 0x10645810,
    }
    render_suffix = ('@@UAEXPAVFDynamicActor@@PAVFLevelSceneNode@@'
                     'PAV?$TList@PAVFDynamicLight@@@@PAV?$TList@PAUFProjectorRenderInfo@@@@'
                     'PAVFRenderInterface@@@Z')
    functions['?Render@USkeletalMeshInstance' + render_suffix] = 0x106dd010
    functions['?Render@USubSkeletalMeshInstance' + render_suffix] = 0x106cace0
    for name, address in functions.items():
        assert engine.exported(name, True) == address, name
    for owner in ('USkeletalMeshInstance', 'USubSkeletalMeshInstance'):
        table = engine.exported(f'??_7{owner}@@6B@')
        for slot, name in (
            (0x8c, '?GetActor@ULodMeshInstance@@UAEPAVAActor@@XZ'),
            (0x94, '?GetMesh@ULodMeshInstance@@UAEPAVUMesh@@XZ'),
            (0x128, f'?MeshToWorld@{owner}@@UAE?AVFMatrix@@M@Z'),
        ):
            assert engine.u32(table + slot) == engine.exported(name), (owner, slot)

    checks = [
        # Named setters and getters establish the actual object/field types.
        (0x1052d7d5, 'fstp', 'dword ptr [esi + 0x27c]'),
        (0x1052db04, 'mov', 'dword ptr [esi + 0x280], eax'),
        (0x1052db0d, 'mov', 'dword ptr [esi + 0x284], ecx'),
        (0x1052db16, 'mov', 'dword ptr [esi + 0x288], edx'),
        (0x10360d80, 'mov', 'eax, dword ptr [ecx + 0x64]'),
        (0x10360cf0, 'mov', 'eax, dword ptr [ecx + 0x60]'),
        (0x106b2608, 'mov', 'dword ptr [esi + 0x84], eax'),
        (0x106b2611, 'mov', 'dword ptr [esi + 0x88], ecx'),
        (0x106b261a, 'mov', 'dword ptr [esi + 0x8c], edx'),
        # The ordinary skeletal override delegates to the reviewed submesh body.
        (0x106bc07c, 'fld', 'dword ptr [ebp + 0xc]'),
        (0x106bc086, 'call', '0x1031404c'),
        (0x106b5f54, 'mov', 'edx, dword ptr [eax + 0x94]'),
        (0x106b5f5c, 'mov', 'ebx, eax'),
        (0x106b5f60, 'mov', 'edx, dword ptr [eax + 0x8c]'),
        (0x106b5f6a, 'mov', 'ebp, eax'),
        # Normal branch: actor scalar, actor XYZ, mesh XYZ, incoming float.
        (0x106b6356, 'fld', 'dword ptr [ebp + 0x27c]'),
        (0x106b6360, 'fld', 'dword ptr [ebp + 0x280]'),
        (0x106b6375, 'fstp', 'dword ptr [esp + 0x20]'),
        (0x106b6379, 'fld', 'dword ptr [ebp + 0x284]'),
        (0x106b6381, 'fstp', 'dword ptr [esp + 0x24]'),
        (0x106b6385, 'fmul', 'dword ptr [ebp + 0x288]'),
        (0x106b638b, 'fstp', 'dword ptr [esp + 0x1c]'),
        (0x106b638f, 'fld', 'dword ptr [ebx + 0x84]'),
        (0x106b6399, 'fstp', 'dword ptr [esp + 0x20]'),
        (0x106b639d, 'fld', 'dword ptr [ebx + 0x88]'),
        (0x106b63a7, 'fstp', 'dword ptr [esp + 0x24]'),
        (0x106b63ab, 'fld', 'dword ptr [ebx + 0x8c]'),
        (0x106b63b5, 'fstp', 'dword ptr [esp + 0x1c]'),
        (0x106b63bd, 'fld', 'dword ptr [esp + 0x3b0]'),
        (0x106b63ca, 'fstp', 'dword ptr [esp + 0x20]'),
        (0x106b63d4, 'fstp', 'dword ptr [esp + 0x24]'),
        (0x106b63dc, 'fstp', 'dword ptr [esp + 0x1c]'),
        # Both ordinary render entry points supply exactly 1.0.
        (0x106dd1a9, 'fld1', ''),
        (0x106dd1ab, 'fstp', 'dword ptr [esp]'),
        (0x106dd1b7, 'mov', 'edx, dword ptr [eax + 0x128]'),
        (0x106dd1bd, 'call', 'edx'),
        (0x106cae44, 'fld1', ''),
        (0x106cae46, 'fstp', 'dword ptr [esp]'),
        (0x106cae52, 'mov', 'edx, dword ptr [eax + 0x128]'),
        (0x106cae58, 'call', 'edx'),
        # Serializer field order, including the legacy version branch.
        (0x105ddf11, 'call', '0x1030dcc9'),
        (0x105ddf29, 'lea', 'ebx, [esi + 0x64]'),
        (0x105ddf33, 'lea', 'eax, [esi + 0x68]'),
        (0x105ddf3d, 'lea', 'ecx, [esi + 0x6c]'),
        (0x105ddf4a, 'cmp', 'dword ptr [ebx], 2'),
        (0x105ddf4d, 'jge', '0x105ddf74'),
        (0x105ddf74, 'lea', 'eax, [esi + 0x78]'),
        (0x105ddf8f, 'lea', 'eax, [esi + 0x84]'),
        (0x105ddf97, 'call', '0x1030e3e0'),
        (0x105ddf88, 'lea', 'edx, [esi + 0x90]'),
        (0x105ddf81, 'lea', 'ecx, [esi + 0x9c]'),
    ]
    for address, mnemonic, operands in checks:
        engine.instruction(address, mnemonic, operands)
    return {'status': 'verified', 'engineSHA256': engine.sha,
            'imageBase': hex(engine.base), 'functions': {n: hex(a) for n, a in functions.items()},
            'instructionChecks': len(checks),
            'actorDrawScaleOffset': '0x27c', 'actorDrawScale3DOffset': '0x280',
            'meshScaleOffset': '0x84', 'ordinaryRenderMultiplier': 1,
            'scaleOrder': 'float32(float32(DrawScale * DrawScale3D[axis]) * MeshScale[axis])',
            'scope': 'ordinary skeletal local scale; not complete actor placement or animation parity'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='verify without writing any files')
    parser.parse_args()
    print(json.dumps(verify(), indent=2))
