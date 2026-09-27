#!/usr/bin/env python3
"""Elbera Tools: bounded original hair dispatch and master-bone arithmetic.

--check reads the pinned client in memory, never executes or writes it.
--audit-assets also freshly reads original hair tables and SkeletalMesh exports;
it does not use generated hair.json, alter assets, or certify attachment parity.
Portable functions below require neither original assets nor Capstone.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import random
import struct
import sys

ROOT = Path(__file__).resolve().parents[2]
COMPARISON_SHA = '508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d'


def f32(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError('finite numeric component required')
    try:
        value = struct.unpack('<f', struct.pack('<f', value))[0]
    except OverflowError as error:
        raise ValueError('finite Float32 component required') from error
    if not math.isfinite(value):
        raise ValueError('finite Float32 component required')
    return value


def record12(value):
    if not isinstance(value, (list, tuple)) or len(value) != 12:
        raise ValueError('48-byte coordinate record requires 12 components')
    return list(map(f32, value))


def hair_render_path(mode):
    """Exact signed native +0x14c branch; the field's name is not inferred."""
    if type(mode) is not int or not -(1 << 31) <= mode < (1 << 31):
        raise ValueError('native signed DWORD required')
    return 'dynamic' if mode > 0 and mode != 4 else 'ordinary'


def master_record(current, source_table):
    """Retained 106e035d..106e067b arithmetic, given BOTH actual inputs.

    This does not label mesh+300 inverse-bind or supply its unknown initializer.
    Origin dot products keep intermediates until an explicit Float32 store;
    axis products and each subsequent sum are individually stored as Float32.
    Float64 intermediate arithmetic is a bounded approximation to x87.
    """
    a, b = record12(current), record12(source_table)
    result = [f32(a[r] + f32((a[3 + r * 3 + 1] * b[1]
              + a[3 + r * 3] * b[0]) + a[3 + r * 3 + 2] * b[2])) for r in range(3)]
    for r in range(3):
        for c in range(3):
            products = [f32(a[3 + r * 3 + k] * b[3 + k * 3 + c]) for k in range(3)]
            result.append(f32(f32(products[0] + products[1]) + products[2]))
    return result


def quaternion_record(quaternion, position):
    """Retained local reference-bone conversion; no normalization or hierarchy."""
    if not isinstance(quaternion, (list, tuple)) or len(quaternion) != 4 \
            or not isinstance(position, (list, tuple)) or len(position) != 3:
        raise ValueError('four quaternion and three position components required')
    x, y, z, w = map(f32, quaternion)
    dx, dy, dz = [f32(v * 2) for v in (x, y, z)]
    xx, xy, xz, yy, yz, zz, wx, wy, wz = [f32(a * b) for a, b in
        ((x, dx), (x, dy), (x, dz), (y, dy), (y, dz), (z, dz), (w, dx), (w, dy), (w, dz))]
    return list(map(f32, [*position, 1 - (yy + zz), xy - wz, xz + wy,
                         xy + wz, 1 - (xx + zz), yz - wx, xz - wy, yz + wx, 1 - (xx + yy)]))


def replace_matrix_origin(matrix, bone_record):
    """Only the four explicit stores AFTER the unknown conversion helper."""
    if not isinstance(matrix, (list, tuple)) or len(matrix) != 16:
        raise ValueError('16-component already-produced matrix required')
    result, bone = list(map(f32, matrix)), record12(bone_record)
    result[12:16] = bone[:3] + [1.0]
    return result


def compare_call_block(owned, candidate, *, owned_va, candidate_va, sites, direct_calls, imports):
    """Exact block comparison allowing ONLY declared named calls/relocations.

    This establishes correspondence with a separate copy, not its provenance.
    The portable test supplies synthetic bytes; the optional original check
    obtains bytes/imports through the section-aware PE reader.
    """
    if len(owned) != len(candidate):
        raise ValueError('comparison block lengths differ')
    normalized_a, normalized_b = bytearray(owned), bytearray(candidate)
    used, result = set(), []
    for offset, expected in sites:
        positions = set(range(offset, offset + 6))
        if offset < 0 or offset + 6 > len(owned) or used & positions:
            raise ValueError('invalid/overlapping comparison site')
        used |= positions
        if owned[offset:offset + 6] != b'\x90' * 6 or candidate[offset:offset + 2] != b'\xff\x15':
            raise ValueError('expected owned six-NOP site and candidate imported call')
        iat, = struct.unpack_from('<I', candidate, offset + 2)
        resolved = imports.get(iat)
        if resolved is None or (resolved[0].casefold(), resolved[1]) != expected:
            raise ValueError('candidate named import differs')
        result.append({'ownedVA': hex(owned_va + offset), 'candidateVA': hex(candidate_va + offset),
                       'iatVA': hex(iat), 'dll': resolved[0], 'symbol': resolved[1]})
        normalized_a[offset:offset + 6] = normalized_b[offset:offset + 6] = bytes(6)
    for offset in direct_calls:
        positions = set(range(offset, offset + 5))
        if offset < 0 or offset + 5 > len(owned) or used & positions:
            raise ValueError('invalid/overlapping direct call')
        used |= positions
        if owned[offset] != 0xe8 or candidate[offset] != 0xe8:
            raise ValueError('expected direct relative call')
        a = owned_va + offset + 5 + struct.unpack_from('<i', owned, offset + 1)[0]
        b = candidate_va + offset + 5 + struct.unpack_from('<i', candidate, offset + 1)[0]
        if a != b:
            raise ValueError('direct-call targets differ')
        normalized_a[offset + 1:offset + 5] = normalized_b[offset + 1:offset + 5] = bytes(4)
    if normalized_a != normalized_b:
        raise ValueError('unexplained surrounding native block difference')
    return {'bytes': len(owned), 'normalizedSHA256': hashlib.sha256(normalized_a).hexdigest(),
            'imports': result, 'sameDirectCallTargets': len(direct_calls)}


def source_tail(data, *, export_start, start, export_end, lod_count,
                file_version, licensee_version):
    """Bounded original post-LOD0 framing; no guessed seek/header skip.

    Supports only the supplied 123/28 and 123/30 archives. Array element
    serializers are the same layouts independently used by the LOD0 decoder.
    Every lazy array's ABSOLUTE saved end must equal actual consumed bytes.
    """
    if (file_version, licensee_version) not in ((123, 28), (123, 30)):
        raise ValueError('unsupported original skeletal archive version')
    if any(type(v) is not int for v in (export_start, start, export_end, lod_count)) \
            or not 0 <= export_start <= start <= export_end <= len(data) or not 1 <= lod_count < 10:
        raise ValueError('invalid original export/LOD boundary')
    sys.path.insert(0, str(ROOT / 'tools')) if str(ROOT / 'tools') not in sys.path else None
    from l2lib import Reader, L2Error
    reader = Reader(memoryview(data)[:export_end], start)
    spans = []

    def count():
        value = reader.compact()
        if not 0 <= value <= 1000000:
            raise ValueError('invalid original array count')
        return value

    def array(size):
        value = count()
        reader.bytes(value * size)
        return value

    def lazy(size):
        at = reader.pos
        saved = reader.i32()
        value = array(size)
        if not export_start <= saved <= export_end or saved != reader.pos:
            raise ValueError('original lazy-array saved end differs from consumed bytes')
        spans.append({'start': at, 'savedEnd': saved, 'count': value, 'elementSize': size})

    try:
        for _ in range(lod_count - 1):
            array(4); array(16); reader.i32()
            for _ in range(2):
                for _ in range(count()):
                    reader.bytes(18); array(4)
            for _ in range(2):
                array(2); reader.i32()
            reader.bytes(12); array(32)
            for size in (8, 10, 8, 12):
                lazy(size)
            reader.bytes(24); reader.i32(); array(52)
        object_ref = reader.compact()
        for size in (12, 10, 12, 8, 2, 2):
            lazy(size)
        mode_at = reader.pos
        mode = reader.i32()
        extra_float_count = array(4)
        auth_word = reader.i32()
        if reader.pos != export_end:
            raise ValueError('unconsumed bytes after original skeletal tail')
    except (L2Error, IndexError, struct.error) as error:
        raise ValueError('truncated original skeletal tail') from error
    return {'modeWord': mode, 'modeWordOffset': mode_at, 'renderPath': hair_render_path(mode),
            'objectRef': object_ref, 'extraFloatCount': extra_float_count,
            'finalWord': auth_word, 'lazyArrays': spans, 'end': reader.pos}


ANCHORS = [
    (0x106c0ba1, 'mov', 'ecx, dword ptr [ebp + 0x208]'),
    (0x106c0bb1, 'mov', 'ecx, dword ptr [eax + 8]'),
    (0x106c0bb8, 'mov', 'edx, dword ptr [eax + 0xc]'),
    (0x106c0bbf, 'mov', 'ecx, dword ptr [eax + 0x10]'),
    (0x106c0bc6, 'mov', 'edx, dword ptr [eax + 0x14]'),
    (0x106c0bcd, 'mov', 'ecx, dword ptr [eax + 0x18]'),
    (0x106c0bd0, 'mov', 'edx, dword ptr [eax + 0x1c]'),
    (0x106c0bd3, 'mov', 'eax, dword ptr [eax + 0x20]'),
    (0x106c0bf5, 'call', '0x10311252'),
    (0x106cdcb7, 'mov', 'ecx, dword ptr [edi + 0xc4]'),
    (0x106cdcc2, 'mov', 'eax, dword ptr [edx + 0x300]'),
    (0x106cdcca, 'mov', 'edx, dword ptr [edi + 0xd0]'),
    (0x106cd551, 'call', '0x10311252'),

    (0x106def02, 'mov', 'edi, 4'),
    (0x106def0a, 'cmp', 'edi, 5'),
    (0x106def5a, 'mov', 'eax, dword ptr [eax + 0x14c]'),
    (0x106def60, 'test', 'eax, eax'),
    (0x106def62, 'jle', '0x106def90'),
    (0x106def64, 'cmp', 'eax, 4'),
    (0x106def67, 'je', '0x106def90'),
    (0x106def80, 'call', '0x1031276f'),
    (0x106defa5, 'mov', 'eax, dword ptr [eax + 0x12c]'),
    (0x106cd6da, 'mov', 'edx, dword ptr [edx + 0x238]'),
    (0x106cd6e0, 'call', 'edx'),
    (0x10341380, 'mov', 'ecx, dword ptr [ecx + 0x450]'),
    (0x106cd6ec, 'call', '0x1030cde2'),
    (0x106cd706, 'lea', 'edi, [ebx + 0xdc]'),
    (0x106cd70f, 'lea', 'esi, [eax + eax*2]'),
    (0x106cd712, 'shl', 'esi, 4'),
    (0x106cd717, 'add', 'esi, dword ptr [edx + 0xc4]'),
    (0x106cd71d, 'mov', 'ecx, 0xc'),
    (0x106cd722, 'rep movsd', 'dword ptr es:[edi], dword ptr [esi]'),
    (0x106c0c17, 'mov', 'edi, dword ptr [ebx + 0xc4]'),
    (0x106c0c1d, 'lea', 'esi, [ebx + 0xdc]'),
    (0x106c0c23, 'mov', 'ecx, 0xc'),
    (0x106c0c2d, 'rep movsd', 'dword ptr es:[edi], dword ptr [esi]'),
    (0x106e638a, 'lea', 'eax, [edi + 0x14c]'),
    (0x106e6392, 'call', '0x1030599d'),
    (0x106e621d, 'lea', 'eax, [edi + 0x214]'),
    (0x106e6225, 'call', '0x1030599d'),
    (0x10330049, 'push', '4'),
    (0x1033004b, 'push', 'eax'),
    (0x103414a4, 'mov', 'eax, dword ptr [ecx + eax*4 + 0x3bc]'),
    (0x106cbbc8, 'mov', 'eax, dword ptr [eax + 0x238]'),
    (0x106cbbce, 'call', 'eax'),
    (0x106cbbdc, 'call', '0x1030cde2'),
    (0x106cbc02, 'lea', 'edi, [eax + eax*2]'),
    (0x106cbc05, 'shl', 'edi, 4'),
    (0x106cbc0a, 'mov', 'ecx, dword ptr [esi + 0xd0]'),
    (0x106cbc10, 'add', 'ecx, edi'),
    (0x106cbc29, 'fld', 'dword ptr [edi + eax]'),
    (0x106cbc3c, 'fstp', 'dword ptr [ebp - 0x250]'),
    (0x106cbc4c, 'fstp', 'dword ptr [ebp - 0x24c]'),
    (0x106cbc98, 'mov', 'eax, dword ptr [edx + 0x40]'),
    (0x106cbc9b, 'call', 'eax'),
    (0x106e0342, 'mov', 'ecx, dword ptr [esi + 0xc4]'),
    (0x106e034d, 'mov', 'eax, dword ptr [eax + 0x300]'),
    (0x106e0355, 'mov', 'edx, dword ptr [esi + 0xd0]'),
    (0x106da03a, 'mov', 'eax, dword ptr [ebx + 0x304]'),
    (0x106da0b0, 'mov', 'eax, dword ptr [ebx + 0x208]'),
    (0x106da0ca, 'lea', 'edx, [eax + 0x18]'),
    (0x106da0ce, 'add', 'eax, 8'),
    (0x106da0d2, 'call', '0x10311252'),
    (0x106da0eb, 'mov', 'eax, dword ptr [ecx + eax + 0x34]'),
    (0x106da12a, 'mov', 'edi, dword ptr [ebx + 0x300]'),
    (0x106da152, 'mov', 'ecx, 0xc'),
    (0x106da15a, 'rep movsd', 'dword ptr es:[edi], dword ptr [esi]'),
    (0x106cbc52, 'fld1', ''),
    (0x106cbc54, 'fstp', 'dword ptr [ebp - 0x248]'),
]


def verify_native():
    from check_tutorial_quest_native import Image, ENGINE_SHA
    from check_skillanim_native import CORE_SHA
    image = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    for anchor in ANCHORS:
        image.instruction(*anchor)
    symbols = {
        '?GetHeadBoneName@APawn@@UAE?AVFName@@XZ': 0x10341380,
        '?GetSubMesh@APawn@@UAEPAVUMesh@@H@Z': 0x103414a0,
        '?MatchRefBone@USkeletalMesh@@QAEHVFName@@@Z': 0x106b24d0,
        '?RenderDynamicHairMesh@USubSkeletalMeshInstance@@QAEXPAVFDynamicActor@@PAVFLevelSceneNode@@PAV?$TList@PAVFDynamicLight@@@@PAV?$TList@PAUFProjectorRenderInfo@@@@PAVFRenderInterface@@H@Z': 0x106cd3c0,
        '?Render@USkeletalMeshInstance@@UAEXPAVFDynamicActor@@PAVFLevelSceneNode@@PAV?$TList@PAVFDynamicLight@@@@PAV?$TList@PAUFProjectorRenderInfo@@@@PAVFRenderInterface@@@Z': 0x106dd010,
        '?Render@USubSkeletalMeshInstance@@UAEXPAVFDynamicActor@@PAVFLevelSceneNode@@PAV?$TList@PAVFDynamicLight@@@@PAV?$TList@PAUFProjectorRenderInfo@@@@PAVFRenderInterface@@@Z': 0x106cace0,
        '?GetFrame@USkeletalMeshInstance@@UAEXPAVAActor@@PAVFLevelSceneNode@@PAVFVector@@HAAHK@Z': 0x106d9a70,
    }
    for name, address in symbols.items():
        assert image.exported(name, True) == address
    slots = [('??_7APawn@@6B@', 0x238, '?GetHeadBoneName@APawn@@UAE?AVFName@@XZ'),
             ('??_7APawn@@6B@', 0x25c, '?GetSubMesh@APawn@@UAEPAVUMesh@@H@Z'),
             ('??_7USkeletalMesh@@6B@', 0x98, '?MeshGetInstance@UMesh@@UAEPAVUMeshInstance@@PBVAActor@@@Z'),
             ('??_7USubSkeletalMeshInstance@@6B@', 0x12c,
              next(n for n, a in symbols.items() if a == 0x106cace0))]
    for name, offset, target in slots:
        assert image.u32(image.exported(name) + offset) == image.exported(target)
    missing = {'ordinaryCoordsToMatrix': 0x106cbc19, 'ordinaryMatrixComposition': 0x106cbc76,
               'referenceParentComposition': 0x106da110, 'referenceTableInitializer': 0x106da13c,
               'dynamicChildComposition': 0x106c0c7e,
               'dynamicReferenceParentComposition': 0x106cd582,
               'dynamicReferenceTableInitializer': 0x106cd5aa}
    for address in missing.values():
        assert image.data[image.offset(address):image.offset(address) + 6] == b'\x90' * 6
    # This surviving named Core implementation is a candidate, NOT evidence
    # that either missing Engine call was restored to this function at runtime.
    core = Image(ROOT / 'assets/interlude/system/Core.dll', CORE_SHA)
    assert core.exported('?Matrix@FCoords@@QBE?AVFMatrix@@XZ', True) == 0x1014df30
    core_anchors = [(0x1014df37, 'fld', 'dword ptr [ecx + 0xc]'),
                    (0x1014df3c, 'fld', 'dword ptr [ecx + 0x18]'),
                    (0x1014df42, 'fld', 'dword ptr [ecx + 0x24]'),
                    (0x1014df77, 'fld', 'dword ptr [ecx]'),
                    (0x1014df79, 'fchs', ''),
                    (0x1014dfc0, 'fstp', 'dword ptr [eax + 0x30]'),
                    (0x1014e01b, 'fstp', 'dword ptr [eax + 0x3c]'),
                    (0x1014e021, 'ret', '4')]
    for anchor in core_anchors:
        core.instruction(*anchor)
    ranges = [('hairDispatch', 0x106def02, 0x106defb8),
              ('dynamicHeadCopy', 0x106cd6da, 0x106cd724),
              ('dynamicRootOverride', 0x106c0c17, 0x106c0c2f),
              ('ordinaryRigidHeadTransform', 0x106cbbbf, 0x106cbc9d),
              ('nativeSavedModeWord', 0x106e6371, 0x106e63a0),
              ('referenceTableSetup', 0x106da03a, 0x106da16c),
              ('masterRecordArithmetic', 0x106e035d, 0x106e067b),
              ('dynamicRecordArithmetic', 0x106cdcd2, 0x106ce00e),
              ('referenceQuaternionHelper', 0x106ae320, 0x106ae436)]
    return {'format': 'elbera-hair-attachment-evidence-v1', 'engineSHA256': image.sha,
            'instructionChecks': len(ANCHORS), 'symbols': {k: hex(v) for k, v in symbols.items()},
            'vtableChecks': len(slots), 'arithmetic': check_arithmetic(image),
            'quaternionArithmetic': check_quaternion(image),
            'coreMatrixCandidate': {'coreSHA256': core.sha, 'bodyVA': '0x1014df30',
                'instructionChecks': len(core_anchors), 'engineCallBinding': 'unverified',
                'SHA256': hashlib.sha256(core.data[core.offset(0x1014df30):core.offset(0x1014e024)]).hexdigest()},
            'unboundSixNopSites': {k: hex(v) for k, v in missing.items()},
            'ranges': [{'name': name, 'startVA': hex(a), 'endVAExclusive': hex(b),
                        'SHA256': hashlib.sha256(image.data[image.offset(a):image.offset(b)]).hexdigest()}
                       for name, a, b in ranges],
            'limits': ['actual runtime restoration of six-NOP sites unverified',
                       'FName/alias and master-instance class-check helpers remain unbound',
                       'mesh+300 initializer is not labeled inverse-bind without its helper binding',
                       'ordinary head matrix construction/composition remain unbound',
                       'source weight differences alone do not prove visually wrong attachment',
                       'full render-state gating, LOD selection, dynamic simulation and browser equivalence not certified']}


def check_arithmetic(image):
    from check_legacy_skill_effects_native import LinearX87

    class Machine(LinearX87):
        def write(self, operand, value, floating=False):
            if operand in ('edi', 'esi'):
                self.registers[operand] = value
            else:
                super().write(operand, value, floating)

    rng = random.Random(6144724)
    identity = [0., 0., 0., 1., 0., 0., 0., 1., 0., 0., 0., 1.]
    cases = [(identity, identity)]
    cases += [([f32(rng.uniform(-50, 50)) for _ in range(12)],
               [f32(rng.uniform(-50, 50)) for _ in range(12)]) for _ in range(99)]
    results = {}
    for name, start, end in [('ordinary', 0x106e035d, 0x106e067b), ('dynamic', 0x106cdcd2, 0x106ce00e)]:
        instructions = list(image.dis.disasm(image.data[image.offset(start):image.offset(end)], start))
        assert instructions[-1].address + instructions[-1].size == end
        for current, table in cases:
            memory = {0x1000 + i * 4: v for i, v in enumerate(current)}
            memory.update({0x2000 + i * 4: v for i, v in enumerate(table)})
            machine = Machine(memory, {'ecx': 0x1000, 'eax': 0x2000, 'edx': 0x3000, 'ebp': 0x5000})
            machine.run(instructions)
            assert [machine.memory[0x3000 + i * 4] for i in range(12)] == master_record(current, table)
            assert not machine.stack
        results[name] = {'cases': len(cases), 'instructionsPerCase': len(instructions)}
    return {**results, 'scope': 'actual call-free +d0 arithmetic; bounded Float64 intermediates with source Float32 stores'}


def check_quaternion(image, pairs=None):
    from check_legacy_skill_effects_native import LinearX87

    class Machine(LinearX87):
        def run(self, instructions):
            for instruction in instructions:
                if instruction.mnemonic == 'fsubp':
                    index = int(instruction.op_str[3:-1])
                    self.stack[index] -= self.stack[0]
                    self.stack.pop(0)
                else:
                    super().run([instruction])

    at = image.offset(0x10311252)
    assert image.data[at] == 0xe9
    assert 0x10311257 + struct.unpack_from('<i', image.data, at + 1)[0] == 0x106ae320
    instructions = list(image.dis.disasm(image.data[image.offset(0x106ae323):image.offset(0x106ae432)], 0x106ae323))
    assert instructions[-1].address + instructions[-1].size == 0x106ae432
    if pairs is None:
        pairs = [([0, 0, 0, 1], [0, 0, 0]), ([.5, .5, .5, .5], [1, 2, 3]),
                 ([0, 0, .70710677, .70710677], [-10, 34, .125]), ([.123, -.3, .78, -.45], [15, -20, 3])]
    for quaternion, position in pairs:
        memory = {0x1024: 0x2000, 0x1028: 0x3000, 0x102c: 0x4000}
        memory.update({0x2000 + i * 4: f32(x) for i, x in enumerate(quaternion)})
        memory.update({0x3000 + i * 4: f32(x) for i, x in enumerate(position)})
        machine = Machine(memory, {'esp': 0x1000})
        machine.run(instructions)
        assert not machine.stack
        assert [machine.memory[0x4000 + i * 4] for i in range(12)] == quaternion_record(quaternion, position)
    return {'cases': len(pairs), 'instructionsPerCase': len(instructions),
            'scope': 'local quaternion/position only; bounded Float64 intermediates, no normalization or parent composition'}


def audit_original_meshes():
    """Fresh source census; no generated catalog, PNG or built glTF dependency."""
    sys.path.insert(0, str(ROOT / 'tools/dat'))
    from build_hair import Sources, source_lod0
    from check_hair_selection_native import verify
    selector, sources, references = verify(), Sources(), {}
    for row in selector['rows']:
        for style, pair in enumerate(row['pairs']):
            for part, index in enumerate(pair, 1):
                if index < 0:
                    if index != -1:
                        raise ValueError('unknown signed hair-table entry')
                    continue
                ref = selector['templates']['mesh' + str(part)] % (row['meshPackage'], row['prefix'], index)
                references.setdefault(ref, []).append({'row': row['row'], 'style': style, 'part': part})
    rows, dynamic_bones = [], []
    for reference, uses in sorted(references.items()):
        package_name, name = reference.split('.')
        package = sources.get('animations', package_name)
        matches = [e for e in package.exports_by_class('SkeletalMesh')
                   if package.export_name(e).casefold() == name.casefold() and e.package_index == 0]
        if len(matches) != 1:
            raise ValueError('missing or ambiguous original skeletal export: ' + reference)
        entry, = matches
        lod = source_lod0(package, entry)
        tail = source_tail(package.data, export_start=entry.serial_offset, start=lod['sourceLOD0']['end'],
            export_end=entry.serial_offset + entry.serial_size, lod_count=lod['sourceLodCount'],
            file_version=package.file_version, licensee_version=package.licensee_version)
        rows.append({'reference': reference, 'sourceExportSHA256': lod['sourceExportSHA256'],
            'stream': lod['stream'], 'bones': len(lod['bones']), 'uses': uses, **tail})
        if tail['renderPath'] == 'dynamic':
            dynamic_bones.extend((bone['orientation'], bone['position']) for bone in lod['bones'])
    counts = Counter((r['modeWord'], r['stream'], r['renderPath']) for r in rows)
    from check_tutorial_quest_native import Image, ENGINE_SHA
    quaternion_checks = check_quaternion(Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True), dynamic_bones)
    return {'sourcePackages': sources.receipts, 'selectorSources': selector['source'], 'rows': rows,
            'pawnClassDefaults': audit_pawn_defaults(),
            'dynamicSourceBoneArithmetic': quaternion_checks,
            'meshCount': len(rows), 'counts': [{'modeWord': key[0], 'stream': key[1],
                'renderPath': key[2], 'count': value} for key, value in sorted(counts.items())],
            'scope': 'all ordinary base-table references; equipment-specific and conditional naming branches excluded'}


def audit_pawn_defaults():
    """Fresh exact class-default tags, not a claim about the live actor mesh."""
    from export_npc_visuals import OriginalClasses, terminal_defaults
    from build_characters import COMBOS
    classes, rows = OriginalClasses(), []
    for model_id, _, _, _, _, prefix, _ in COMBOS:
        qualified = 'LineageWarrior.' + prefix
        node = classes.get(qualified)
        if not node:
            raise ValueError('missing original player class: ' + qualified)
        package = classes.packages[Path(node['source']).stem]
        matches = [e for e in package.exports_by_class('Class')
                   if package.export_name(e).casefold() == prefix.casefold()]
        if len(matches) != 1:
            raise ValueError('ambiguous original player class: ' + qualified)
        props, evidence = terminal_defaults(package, matches[0], classes.property_types(qualified, set()))
        if evidence['defaultsBoundary'] != 'unique-validated-candidate':
            raise ValueError('unproven original defaults boundary: ' + qualified)
        fields = {name: {'kind': kind, 'value': value} for name, kind, value in props
                  if name in ('HeadBone', 'Mesh')}
        if fields.get('HeadBone', {}).get('kind') != 'name' or fields.get('Mesh', {}).get('kind') != 'object':
            raise ValueError('original class lacks explicit HeadBone/Mesh tags: ' + qualified)
        rows.append({'modelId': model_id, 'class': qualified, 'fieldOwner': qualified,
                     'fields': fields, 'defaultsEvidence': evidence})
    expected = {'LineageWarrior.u': '747b1e7c3045c748c08b03b54893dc2d29cf7103379f19804ccbeb7764224558',
                'Engine.u': '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761',
                'Core.u': 'de5f0ee0a773327bce13c96622fd3c654cff7db88b9be065d1232590c140fda0'}
    if classes.sources != expected:
        raise ValueError('unsupported original class package build')
    return {'sourcePackages': classes.sources, 'rows': rows,
            'limit': 'class defaults only; later native actor Mesh assignments are not excluded'}


def comparison_evidence(path):
    """Opt-in, pinned comparison copy; never silently replaces owned inputs."""
    from supplemental_pe import PEImage
    from check_tutorial_quest_native import Image, ENGINE_SHA
    from check_skillanim_native import CORE_SHA
    candidate = PEImage(path, COMPARISON_SHA)
    owned = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    core = Image(ROOT / 'assets/interlude/system/Core.dll', CORE_SHA)
    render = '?Render@USubSkeletalMeshInstance@@UAEXPAVFDynamicActor@@PAVFLevelSceneNode@@PAV?$TList@PAVFDynamicLight@@@@PAV?$TList@PAUFProjectorRenderInfo@@@@PAVFRenderInterface@@@Z'
    get_frame = '?GetFrame@USkeletalMeshInstance@@UAEXPAVAActor@@PAVFLevelSceneNode@@PAVFVector@@HAAHK@Z'
    matrix = '?Matrix@FCoords@@QBE?AVFMatrix@@XZ'
    product = '??DFMatrix@@QBE?AV0@V0@@Z'
    pivot = '?ApplyPivot@FCoords@@QBE?AV1@ABV1@@Z'
    inverse = '?PivotInverse@FCoords@@QBE?AV1@XZ'
    blocks = []
    for method, start, end, sites, direct in [
        (render, 0x106cbbbf, 0x106cbc9d, [(0x106cbc19, matrix), (0x106cbc76, product)], [0x106cbbdc]),
        (get_frame, 0x106da0b0, 0x106da16c, [(0x106da110, pivot), (0x106da13c, inverse)], [0x106da0d2]),
    ]:
        source_body, candidate_body = owned.exported(method, True), candidate.body(method)
        candidate_start = candidate_body + start - source_body
        block = compare_call_block(owned.data[owned.offset(start):owned.offset(end)],
            candidate.read(candidate_start, end - start), owned_va=start, candidate_va=candidate_start,
            sites=[(va - start, ('core.dll', symbol)) for va, symbol in sites],
            direct_calls=[va - start for va in direct], imports=candidate.imports)
        blocks.append({'method': method, 'ownedBodyVA': hex(source_body),
                       'candidateBodyVA': hex(candidate_body), **block})
    core_methods = {matrix: (0x1014df30, 0x1014e024), product: (0x10111240, 0x10111488),
                    pivot: (0x1014d8c0, 0x1014d98a), inverse: (0x1014db40, 0x1014dd1a)}
    for symbol, (start, _) in core_methods.items():
        assert core.exported(symbol, True) == start
    core.instruction(0x1014d987, 'ret', '8')
    core.instruction(0x1014dd17, 'ret', '4')
    core.instruction(0x10101dd4, 'jmp', '0x1010f5b0')
    for address in (0x1014d8d3, 0x1014d91a, 0x1014d93e, 0x1014d962, 0x1014dcf5):
        core.instruction(address, 'call', '0x10101dd4')
    return {'status': 'comparison-copy-bindings-verified', 'candidateSHA256': COMPARISON_SHA,
            'provenance': 'separate comparison copy; vendor authenticity and owned runtime restoration unverified',
            'blocks': blocks, 'ownedCoreSHA256': core.sha,
            'ownedCoreMethods': [{'symbol': symbol, 'startVA': hex(start), 'endVAExclusive': hex(end),
                                 'SHA256': hashlib.sha256(core.data[core.offset(start):core.offset(end)]).hexdigest()}
                                for symbol, (start, end) in core_methods.items()],
            'limits': ['normalized block comparison permits only declared six-NOP replacements and same-target relative calls',
                       'named imports belong to the pinned comparison copy, not the recovered owned call sites',
                       'no runtime transform or full actor-master domain is admitted by this comparison']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--audit-assets', action='store_true')
    parser.add_argument('--comparison-engine', type=Path, help='optional separately obtained, pinned comparison Engine.dll')
    parser.add_argument('--out', type=Path, help='optional private JSON receipt under repository tmp/')
    args = parser.parse_args()
    if not args.check and not args.audit_assets:
        parser.error('choose --check or --audit-assets')
    result = verify_native()
    if args.audit_assets:
        result['sourceMeshes'] = audit_original_meshes()
    if args.comparison_engine:
        result['comparison'] = comparison_evidence(args.comparison_engine)
    if args.out:
        output = args.out.resolve()
        if not output.is_relative_to((ROOT / 'tmp').resolve()):
            parser.error('receipts must stay under repository tmp/')
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'status': 'bounded-evidence-verified', 'instructionChecks': result['instructionChecks'],
                      'arithmetic': result['arithmetic'],
                      'sourceMeshCount': result.get('sourceMeshes', {}).get('meshCount'),
                      'comparisonStatus': result.get('comparison', {}).get('status')}))


if __name__ == '__main__':
    main()
