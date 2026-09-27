#!/usr/bin/env python3
"""Elbera Tools: bounded original player placement and exported-basis audit.

Original binaries are decoded in memory, never executed or written. --basis
also compares original LOD0 positions with current player glTF accessors; it
does not treat the converted model as an oracle for native rendering. No
complete placement, collision, skinning or animation parity is claimed.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
CORE_SHA = '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf'


def f32(value):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        raise ValueError('finite scalar required')
    try:
        result = struct.unpack('<f', struct.pack('<f', value))[0]
    except OverflowError as error:
        raise ValueError('finite Float32 required') from error
    if not math.isfinite(result):
        raise ValueError('finite Float32 required')
    return result


def vector(value):
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError('three scalar components required')
    return list(map(f32, value))


def subtract_mesh_origin(basis_rows, translation, origin):
    """Only the native final adjustment, given the already-composed matrix.

    Applies when instance fields +80 and +84 are both zero. This function
    neither composes the preceding matrix nor assumes those flags' defaults.
    Float64 intermediates model the bounded tests, not every x87 rounding case.
    """
    if len(basis_rows) != 3:
        raise ValueError('three basis rows required')
    rows = [vector(row) for row in basis_rows]
    translation, origin = vector(translation), vector(origin)
    return [f32(translation[j] + f32(-origin[0] * rows[0][j]
                                    - origin[1] * rows[1][j]
                                    - origin[2] * rows[2][j])) for j in range(3)]


def actor_floor_reference(location, collision_height):
    """Comparison reference in AdjustPawnLocation, not a grounding solver."""
    x, y, z = vector(location)
    return [x, y, f32(z - f32(collision_height))]


def converted_position(point, source_y_sign=1):
    """Measured glTF position conversion; not the native MeshToWorld rule."""
    if source_y_sign not in (-1, 1):
        raise ValueError('comparison sign must be -1 or 1')
    x, y, z = vector(point)
    return tuple(map(f32, (x * .01, z * .01, source_y_sign * y * .01)))


def matrix4(value):
    if not isinstance(value, (list, tuple)) or len(value) != 4 \
            or any(not isinstance(row, (list, tuple)) or len(row) != 4 for row in value):
        raise ValueError('four rows of four components required')
    return [list(map(f32, row)) for row in value]


def core_matrix_product(left, right):
    """Original Core FMatrix operator*, independently verified below.

    This is not evidence that an erased Engine call targeted that operator.
    The original stores each output component once, after the four products
    and additions. These finite tests do not prove universal x87 equivalence.
    """
    left, right = matrix4(left), matrix4(right)
    return [[f32(((left[r][0] * right[0][c] + left[r][1] * right[1][c])
                  + left[r][2] * right[2][c]) + left[r][3] * right[3][c])
             for c in range(4)] for r in range(4)]


def core_transform_point(matrix, point):
    """Original Core TransformFVector: row-vector, implicit W=1, no divide."""
    matrix, point = matrix4(matrix), vector(point)
    return [f32(((point[0] * matrix[0][c] + point[1] * matrix[1][c])
                 + point[2] * matrix[2][c]) + matrix[3][c]) for c in range(3)]


def core_placement_evidence(engine):
    """Surviving Core implementations and explicit Engine binding limits."""
    import random
    from check_tutorial_quest_native import Image
    from check_legacy_skill_effects_native import LinearX87
    core = Image(ROOT / 'assets/interlude/system/Core.dll', CORE_SHA)
    methods = {
        '??DFMatrix@@QBE?AV0@V0@@Z': 0x11240,
        '?TransformFVector@FMatrix@@QBE?AVFVector@@ABV2@@Z': 0x11990,
        '?InitProperties@UObject@@SAXPAEHPAVUClass@@0HPAV1@2@Z': 0x5fb00,
        '?InitClassDefaultObject@UObject@@QAEXPAVUClass@@H@Z': 0x5fe10,
        '?Register@UClass@@UAEXXZ': 0x339d0,
        '?StaticAllocateObject@UObject@@SAPAV1@PAVUClass@@PAV1@VFName@@K1PAVFOutputDevice@@11@Z': 0x677c0,
        '?StaticConstructObject@UObject@@SAPAV1@PAVUClass@@PAV1@VFName@@K1PAVFOutputDevice@@1@Z': 0x67eb0,
    }
    for name, rva in methods.items(): assert core.exported(name, True) == core.base + rva
    # The exact named setter binds the field identity; no declaration-order guess.
    name = '?SetPrePivot@FNMonsterRaceInfo@@QAEHXZ'
    assert engine.exported(name, True) == engine.base + 0x1bb9f0
    engine_anchors = [
        (0x1bbba1, 'mov', 'esi, dword ptr [esi + 4]'),
        (0x1bbbf1, 'mov', 'dword ptr [esi + 0x28c], edx'),
        (0x1bbbfa, 'mov', 'dword ptr [esi + 0x290], ecx'),
        (0x1bbc03, 'mov', 'dword ptr [esi + 0x294], edx'),
        # These fields belong to ULodMeshInstance, not mesh MeshScale.
        (0x60e56, 'mov', 'ecx, dword ptr [edi + 0x80]'),
        (0x60e5c, 'mov', 'dword ptr [esi + 0x80], ecx'),
        (0x60e62, 'mov', 'edx, dword ptr [edi + 0x84]'),
        (0x60e68, 'mov', 'dword ptr [esi + 0x84], edx'),
        (0x60f2e, 'mov', 'dword ptr [ebx + 0x80], edx'),
        (0x60f3a, 'mov', 'dword ptr [ebx + 0x84], eax'),
        # Candidate allocation call has eight stack arguments and class identity.
        (0x6373d, 'push', '0x10dd8ff0'), (0x63748, 'add', 'esp, 0x20'),
        # Native class registration passes the Lod superclass, then size 0x144.
        (0x54940b, 'push', '0x10c6a5e0'), (0x549412, 'push', '0x144'),
        (0x549419, 'mov', 'ecx, 0x10dd8ff0'),
    ]
    for rva, op, args in engine_anchors: engine.instruction(engine.base + rva, op, args)
    for rva in (0x63742, 0x54941e): assert engine.data[rva:rva+6] == b'\x90' * 6
    for name, rva in [('??0ULodMeshInstance@@QAE@ABV0@@Z', 0x60df0),
                      ('??4ULodMeshInstance@@QAEAAV0@ABV0@@Z', 0x60ec0)]:
        assert engine.exported(name, True) == engine.base + rva
    for owner, va in [('USubSkeletalMeshInstance', 0x10dd8ff0), ('ULodMeshInstance', 0x10c6a5e0)]:
        assert engine.exported('?PrivateStaticClass@' + owner + '@@0VUClass@@A') == va
    core_anchors = [
        (0x11242, 'mov', 'eax, dword ptr [esp + 4]'),
        (0x11246, 'fld', 'dword ptr [esp + 8]'),
        (0x11485, 'ret', '0x44'),
        (0x119d5, 'fadd', 'dword ptr [ecx + 0x30]'),
        (0x119ee, 'fadd', 'dword ptr [ecx + 0x34]'),
        (0x11a0e, 'fadd', 'dword ptr [ecx + 0x38]'),
        # InitProperties copies template bytes after UObject's 0x34-byte header.
        (0x5fb45, 'mov', 'ecx, 0x34'),
        (0x5fb5b, 'cmp', 'dword ptr [esi + 0x4f8], 0'),
        (0x5fbed, 'lea', 'eax, [ebx - 0x34]'),
        (0x5fbf4, 'add', 'ecx, 0x34'),
        (0x5fbff, 'call', '0x1017ac60'),
        (0x5fc07, 'mov', 'ecx, ebx'),
        (0x5fb84, 'sub', 'eax, ecx'),
        (0x5fb87, 'add', 'ecx, edi'),
        (0x5fb8a, 'call', '0x101022e3'),
        # The actual helper is a call-free zero fill, not an inferred name.
        (0x842a, 'xor', 'eax, eax'),
        (0x8434, 'rep stosd', 'dword ptr es:[edi], eax'),
        (0x8438, 'rep stosb', 'byte ptr es:[edi], al'),
        (0x5fe67, 'mov', 'edx, dword ptr [ecx + 0x34]'),
        (0x5fe81, 'call', '0x1010119f'),
        (0x67c56, 'call', '0x1010119f'),
        (0x67f11, 'call', '0x10103e7c'),
        (0x67f20, 'mov', 'edx, dword ptr [edi + 0x518]'),
        (0x67f26, 'call', 'edx'),
    ]
    for rva, op, args in core_anchors: core.instruction(core.base + rva, op, args)
    assert core.exported('?InitProperties@UObject@@SAXPAEHPAVUClass@@0HPAV1@2@Z') == 0x1010119f
    allocate = '?StaticAllocateObject@UObject@@SAPAV1@PAVUClass@@PAV1@VFName@@K1PAVFOutputDevice@@11@Z'
    assert core.exported(allocate) == 0x10103e7c
    core.instruction(0x101022e3, 'jmp', '0x10108420')

    # Execute all arithmetic instructions in the original bodies using explicit
    # synthetic Float32 memory. Only the outer ret/prologue/epilogue is omitted.
    product_code = list(core.dis.disasm(core.data[0x11240:0x11485], 0x10111240))
    point_code = list(core.dis.disasm(core.data[0x11997:0x11a24], 0x10111997))
    random_source = random.Random(0x504c4143)
    cases = []
    identity = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
    translation = [*identity[:3], [123.25, -543.5, 77, 1]]
    scale = [[2, 0, 0, 0], [0, 3, 0, 0], [0, 0, 4, 0], identity[3]]
    cases.extend([(identity, translation), (scale, translation), (translation, scale)])
    for _ in range(97):
        cases.append(tuple([[f32(random_source.uniform(-1024, 1024)) for _ in range(4)] for _ in range(4)] for _ in range(2)))
    for left, right in cases:
        memory = {0x1000 + r*16+c*4: f32(left[r][c]) for r in range(4) for c in range(4)}
        memory.update({0x3008 + r*16+c*4: f32(right[r][c]) for r in range(4) for c in range(4)})
        memory[0x3004] = 0x2000
        evaluator = LinearX87(memory, {'ecx': 0x1000, 'esp': 0x3000})
        evaluator.run(product_code)
        actual = [[evaluator.memory[0x2000+r*16+c*4] for c in range(4)] for r in range(4)]
        assert actual == core_matrix_product(left, right) and not evaluator.stack
        point = [f32(random_source.uniform(-100, 100)) for _ in range(3)]
        memory = {0x1000 + r*16+c*4: f32(left[r][c]) for r in range(4) for c in range(4)}
        memory.update({0x4000+c*4: point[c] for c in range(3)})
        memory[0x3014] = 0x2000
        evaluator = LinearX87(memory, {'ecx': 0x1000, 'esp': 0x3000, 'eax': 0x4000})
        evaluator.run(point_code)
        assert [evaluator.memory[0x2000+c*4] for c in range(3)] == core_transform_point(left, point)
        assert not evaluator.stack
    ranges = [('FMatrix::operator*', 0x11240, 0x11488),
              ('FMatrix::TransformFVector', 0x11990, 0x11a2a),
              ('InitProperties', 0x5fb00, 0x5fc7a),
              ('zero-fill helper', 0x8420, 0x843d)]
    return {'coreSHA256': core.sha, 'engineAnchors': len(engine_anchors), 'coreAnchors': len(core_anchors),
            'matrixArithmeticCases': len(cases), 'pointArithmeticCases': len(cases),
            'prePivotFieldIdentity': 'named FNMonsterRaceInfo::SetPrePivot writes actor +28c/+290/+294',
            'matrixABI': 'ECX=left; stack hidden output pointer then by-value 64-byte right; callee pops 0x44',
            'matrixBinding': 'Core implementation proved; three erased Engine call targets remain unbound',
            'flagOwnership': 'ULodMeshInstance +80/+84 copied independently; names and live defaults unresolved',
            'allocationBoundary': 'Core zero-fill/default-copy proved; Engine allocation and class registration targets erased',
            'ranges': [{'name': name, 'startRVA': hex(a), 'endRVAExclusive': hex(b),
                        'SHA256': hashlib.sha256(core.data[a:b]).hexdigest()} for name, a, b in ranges]}


def verify():
    from check_tutorial_quest_native import Image, ENGINE_SHA
    from check_legacy_skill_effects_native import LinearX87
    image = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    methods = {
        '?MeshToWorld@USubSkeletalMeshInstance@@UAE?AVFMatrix@@M@Z': 0x3b5f20,
        '?AdjustPawnLocation@UGameEngine@@QAEXPAVAPawn@@VFVector@@@Z': 0x18e300,
        '?OnCharInfo@UGameEngine@@UAEHPAUUser@@VFVector@@HAAVL2ParamStack@@@Z': 0x195a30,
        '?OnChangeWaitType@UGameEngine@@UAEHPAUUser@@HVFVector@@@Z': 0x19bbc0,
        '?SetCollisionSize@AActor@@QAEXMM@Z': 0x22d650,
        '?GetBoneCoords@USubSkeletalMeshInstance@@QAE?AVFCoords@@K@Z': 0x3b79e0,
    }
    for name, rva in methods.items():
        assert image.exported(name, True) == image.base + rva
    level = image.exported('??_7ULevel@@6BUObject@@@')
    slots = {}
    for slot in (0xa8, 0xc0, 0xe4):
        matches = [n for n in image.exports if image.exported(n) == image.u32(level + slot)]
        assert len(matches) == 1
        slots[hex(slot)] = matches[0]
    assert slots['0xa8'].startswith('?FarMoveActor@ULevel@@')
    assert slots['0xc0'].startswith('?SpawnActor@ULevel@@')
    assert slots['0xe4'].startswith('?SingleLineCheck@ULevel@@')
    anchors = [
        (0x3b5f89, 'cmp', 'dword ptr [esi + 0x84], 0'),
        (0x3b5f90, 'je', '0x106b61fc'),
        (0x3b61fc, 'fld', 'dword ptr [ebp + 0x1bc]'),
        (0x3b6202, 'fadd', 'dword ptr [ebp + 0x28c]'),
        (0x3b621c, 'fld', 'dword ptr [ebp + 0x294]'),
        (0x3b625f, 'call', '0x1030916f'),
        (0x3b62a5, 'call', '0x10306b40'),
        (0x3b62e8, 'call', '0x10306b40'),
        (0x3b6413, 'call', '0x1030d526'),
        (0x3b6712, 'cmp', 'dword ptr [eax + 0x80], 0'),
        (0x3b6751, 'jne', '0x106b684e'),
        (0x3b6757, 'cmp', 'dword ptr [eax + 0x84], 0'),
        (0x3b675e, 'jne', '0x106b684e'),
        (0x3b6764, 'fld', 'dword ptr [ebx + 0x90]'),
        (0x3b6770, 'fld', 'dword ptr [ebx + 0x94]'),
        (0x3b677c, 'fld', 'dword ptr [ebx + 0x98]'),
        (0x3b67af, 'fstp', 'dword ptr [ebp + 0x30]'),
        (0x3b67fd, 'fstp', 'dword ptr [ebp + 0x34]'),
        (0x3b684b, 'fstp', 'dword ptr [ebp + 0x38]'),
        (0x22d6ab, 'fstp', 'dword ptr [esi + 0x2f0]'),
        (0x22d6b4, 'fstp', 'dword ptr [esi + 0x2f4]'),
        (0x18e330, 'mov', 'edx, dword ptr [esi + 0x1c4]'),
        (0x18e34a, 'fsub', 'dword ptr [esi + 0x2f4]'),
        (0x18e37c, 'fsub', 'dword ptr [esp + 0x74]'),
        (0x18e529, 'mov', 'edx, dword ptr [edx + 0xa8]'),
        (0x18e54d, 'call', 'edx'),
        (0x195ab8, 'fld', 'dword ptr [edi + 0x1d0]'),
        (0x195ac1, 'fld', 'dword ptr [edi + 0x1cc]'),
        (0x195c2f, 'fld', 'dword ptr [ebp + 0x7c]'),
        (0x195c32, 'fadd', 'qword ptr [0x1089f9a8]'),
        (0x195c44, 'fsub', 'qword ptr [0x1089de78]'),
        (0x195c54, 'fld', 'dword ptr [ebp + 0x30]'),
        (0x195c5d, 'fld', 'dword ptr [ebp + 0x7c]'),
        (0x195c81, 'push', '0x86'),
        (0x195c99, 'mov', 'edx, dword ptr [edx + 0xe4]'),
        (0x195c9f, 'call', 'edx'),
        (0x195cb5, 'fld', 'dword ptr [ebp - 0x3c]'),
        (0x195cb8, 'fmul', 'qword ptr [0x10891488]'),
        (0x195cc4, 'fcom', 'qword ptr [0x10891478]'),
        (0x195cd1, 'fsubr', 'qword ptr [0x10891468]'),
        (0x195cd9, 'fstp', 'dword ptr [ebp - 0x50]'),
        (0x195cea, 'add', 'eax, 0xc0'),
        (0x195d29, 'mov', 'ecx, dword ptr [ebp - 0x58]'),
        (0x195d2e, 'mov', 'edx, dword ptr [ebp - 0x54]'),
        (0x195d34, 'mov', 'ecx, dword ptr [ebp - 0x50]'),
        (0x195d5a, 'call', 'edx'),
        (0x19620c, 'call', '0x1030c3ab'),
        (0x19bbfe, 'call', '0x10315046'),
        (0x19bc46, 'jmp', 'dword ptr [edi*4 + 0x1049bf3c]'),
        (0x19bc60, 'mov', 'eax, dword ptr [ecx + edx*4 + 0x8ac]'),
        (0x3b7a80, 'fld1', ''),
        (0x3b7a85, 'mov', 'edx, dword ptr [eax + 0x128]'),
        (0x3b7a99, 'call', 'edx'),
    ]
    for rva, op, args in anchors:
        image.instruction(image.base + rva, op, args)
    assert image.exported('?AdjustPawnLocation@UGameEngine@@QAEXPAVAPawn@@VFVector@@@Z') == 0x10315046
    assert image.exported('?SetCollisionSize@AActor@@QAEXMM@Z') == 0x1030c3ab
    # Do not silently replace these erased imports with a guessed FMatrix op.
    for rva in (0x3b643d, 0x3b6468, 0x3b6493):
        assert image.data[rva:rva + 6] == b'\x90' * 6

    class OriginArithmetic(LinearX87):
        def run(self, instructions):
            for instruction in instructions:
                if instruction.mnemonic == 'fchs':
                    self.stack[0] = -self.stack[0]
                else:
                    super().run([instruction])

    def instructions(start, end):
        result = list(image.dis.disasm(image.data[start:end], image.base + start))
        assert result[-1].address + result[-1].size == image.base + end
        return result

    # Compare a separately expressed formula with the actual import-free
    # arithmetic, including the matrix-column loads and Float32 stores.
    prep = [i for i in instructions(0x3b6707, 0x3b6751) if i.mnemonic in ('fld', 'fstp')]
    arithmetic = instructions(0x3b6764, 0x3b684e)
    cases = 0
    for rows in ([[1, 0, 0], [0, 1, 0], [0, 0, 1]],
                 [[0, -1, 0], [1, 0, 0], [0, 0, 1.03]],
                 [[1.01, .3, -.1], [2, -.75, .04], [-.2, .9, 3]]):
        for origin in ([0, 0, 23], [5, -4, 31.5], [-.007, 1.9, -200.125]):
            for translation in ([0, 0, 0], [78400, 163712, -3312.49], [.7, -2.1, 12.3]):
                memory = {0x1000 + r * 16 + c * 4: f32(rows[r][c]) for r in range(3) for c in range(3)}
                memory.update({0x1030 + c * 4: f32(translation[c]) for c in range(3)})
                memory.update({0x2090 + c * 4: f32(origin[c]) for c in range(3)})
                evaluator = OriginArithmetic(memory, {'ebp': 0x1000, 'ebx': 0x2000, 'esp': 0x3000})
                evaluator.run(prep + arithmetic)
                assert [evaluator.memory[0x1030 + c * 4] for c in range(3)] == subtract_mesh_origin(rows, translation, origin)
                assert evaluator.stack == []
                cases += 1
    constants = {hex(rva): struct.unpack_from('<d', image.data, rva)[0]
                 for rva in (0x59f9a8, 0x59de78, 0x591488, 0x591478, 0x591468)}
    assert list(constants.values()) == [20., 10., 12., 1.899999976158142, 2.150000035762787]
    ranges = [('MeshToWorld', 0x3b5f20, 0x3b686b),
              ('AdjustPawnLocation', 0x18e300, 0x18e559),
              ('OnCharInfo floor trace and spawn', 0x195c04, 0x195d64),
              ('OnChangeWaitType', 0x19bbc0, 0x19bf3c)]
    return {'status': 'bounded-evidence-verified', 'engineSHA256': image.sha,
            'instructionAnchors': len(anchors), 'arithmeticCases': cases,
            'corePlacement': core_placement_evidence(image),
            'functionsRVA': {n: hex(rva) for n, rva in methods.items()},
            'levelSlots': slots, 'sourceConstantsRVA': constants,
            'decodedRanges': [{'name': n, 'startRVA': hex(a), 'endRVAExclusive': hex(b),
                               'SHA256': hashlib.sha256(image.data[a:b]).hexdigest()} for n, a, b in ranges],
            'limits': ['matrix multiplication imports erased; operand order traced, binding unproved',
                       'instance +80/+84 names and fresh values unresolved',
                       'native collision solver and complete player placement not implemented']}


def original_lod0_points(package, export):
    """Narrow version-5 Lineage LOD reader; uses original positions, not PSK.

    Layout comparison: UEViewer UnMesh2.cpp/.h. The original TLazyArray end
    offsets independently frame each variable block. Not a general UKX reader.
    """
    from export_npc_visuals import original_mesh_scale
    from l2lib.ue2package import Reader
    if (package.file_version, package.licensee_version) not in ((123, 28), (123, 30)):
        raise ValueError('unsupported original mesh package version')
    _, version, offset = original_mesh_scale(package, export)
    if version != 5:
        raise ValueError('unsupported LOD mesh version')
    end = export.serial_offset + export.serial_size
    r = Reader(memoryview(package.data)[:end], offset + 36)
    def count():
        value = r.compact()
        if not 0 <= value <= 1000000:
            raise ValueError('invalid original array count')
        return value
    def array(size):
        n = count()
        return r.bytes(n * size), n
    for size in (2, 8, 2, 10, 8): array(size)
    r.bytes(24); r.i32(); r.compact(); r.bytes(52); r.f32(); r.i32()
    array(12)
    for _ in range(count()): package.name(r.compact()); r.bytes(56)
    r.compact(); r.i32()
    for _ in range(count()): array(2); r.i32()
    array(4)
    for _ in range(2):
        for _ in range(count()): package.name(r.compact())
    array(48)
    if not 0 < count() < 10:
        raise ValueError('invalid original LOD count')
    array(4); array(16); r.i32()
    for _ in range(2):
        for _ in range(count()): r.bytes(18); array(4)
    for _ in range(2): array(2); r.i32()
    r.bytes(12); rigid, nr = array(32)
    for size in (8, 10, 8, 12):
        skip = r.i32(); array(size)
        if skip != r.pos: raise ValueError('original lazy-array boundary mismatch')
    r.bytes(24); r.i32(); soft, ns = array(52)
    if bool(ns) == bool(nr):
        raise ValueError('unsupported mixed or empty original LOD positions')
    data, n, stride = (soft, ns, 52) if ns else (rigid, nr, 32)
    return [tuple(vector(struct.unpack_from('<3f', data, i * stride))) for i in range(n)]


def accessor_positions(gltf, buffers, mesh_name):
    matches = [m for m in gltf['meshes'] if m.get('name', '').casefold() == mesh_name.casefold()]
    if len(matches) != 1:
        raise ValueError('missing or ambiguous built mesh')
    points = set()
    for primitive in matches[0]['primitives']:
        a = gltf['accessors'][primitive['attributes']['POSITION']]
        if a['type'] != 'VEC3' or a['componentType'] != 5126 or 'sparse' in a:
            raise ValueError('unsupported built position accessor')
        view = gltf['bufferViews'][a['bufferView']]
        data = buffers[view['buffer']]
        start, length = view.get('byteOffset', 0), view['byteLength']
        offset, stride, count = a.get('byteOffset', 0), view.get('byteStride', 12), a['count']
        if any(not isinstance(v, int) or isinstance(v, bool) or v < 0 for v in (start, length, offset, stride, count)) \
                or stride < 12 or stride % 4 or start + length > len(data) \
                or count > 1000000 or offset + (count - 1) * stride + 12 > length:
            raise ValueError('built accessor exceeds its buffer view')
        points.update(tuple(vector(struct.unpack_from('<3f', data, start + offset + i * stride))) for i in range(count))
    if not points: raise ValueError('empty built mesh')
    return points


def basis_audit():
    sys.path[:0] = [str(ROOT / p) for p in ('tools', 'tools/dat', 'tools/src/char_pipeline')]
    import build_characters as builder
    from export_player_visuals import built_model
    manifest = json.loads((ROOT / 'editor/characters/manifest.json').read_text())
    entries = {e['id']: e for e in manifest['models']}
    bindings = builder.load_creation_bindings()
    models, packages = [], {}
    for model_id, _, _, _, package_name, _, _ in builder.COMBOS:
        package = builder.load_ukx(package_name)
        path = ROOT / 'assets/interlude/animations' / (package_name + '.ukx')
        packages[package_name] = hashlib.sha256(path.read_bytes()).hexdigest()
        names, provenance = built_model(entries[model_id], ROOT / 'editor/characters')
        gltf_path = ROOT / 'editor/characters' / provenance['gltf']
        gltf = json.loads(gltf_path.read_text())
        buffers = [(gltf_path.parent / b['uri']).read_bytes() for b in gltf['buffers']]
        parts = []
        for name in names:
            matches = [e for e in package.exports if package.class_name_of(e) == 'SkeletalMesh'
                       and package.export_name(e).casefold() == name.casefold()]
            if len(matches) != 1: raise ValueError('ambiguous original mesh: ' + name)
            export = matches[0]
            source = original_lod0_points(package, export)
            built = accessor_positions(gltf, buffers, name)
            plus = {converted_position(p) for p in source}
            minus = {converted_position(p, -1) for p in source}
            parts.append({'mesh': name, 'sourcePositionCount': len(source),
                'sourceExportSHA256': hashlib.sha256(package.data[export.serial_offset:export.serial_offset + export.serial_size]).hexdigest(),
                'plusYExactSetEquality': plus == built, 'minusYExactSetEquality': minus == built,
                'plusYMatchingSourcePositions': sum(converted_position(p) in built for p in source)})
            if plus != built:
                raise ValueError('built part positions differ from audited source: ' + model_id + '/' + name)
        upper_name = bindings[model_id]['_u']['mesh']
        upper = next(p for p in parts if p['mesh'].casefold() == upper_name.casefold())
        if not upper['plusYExactSetEquality'] or upper['minusYExactSetEquality']:
            raise ValueError('upper-body coordinate basis differs from audited source: ' + model_id)
        models.append({'model': model_id, 'built': provenance, 'parts': parts})
    return {'scope': 'raw LOD0 position sets only; not topology, weights, posed bones or mesh world placement',
            'packageSHA256': packages, 'models': models,
            'measuredSourceToBuiltPosition': 'f32(originalX*.01), f32(originalZ*.01), f32(originalY*.01)'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='read-only native source checks (default)')
    parser.add_argument('--basis', action='store_true', help='also audit original positions against current built models')
    parser.add_argument('--output', type=Path, help='optional private JSON receipt; no original bytes')
    args = parser.parse_args()
    result = verify()
    if args.basis: result['basis'] = basis_audit()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + '\n')
        print('Private receipt: ' + str(args.output))
    else:
        print(json.dumps(result, indent=2))
