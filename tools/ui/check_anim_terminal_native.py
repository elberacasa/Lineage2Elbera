#!/usr/bin/env python3
"""Elbera Tools: verify original skeletal animation endpoint and loop evidence.

Reads the owner's pinned Engine.dll through the shared in-memory decoder.
Never executes or emits the binary. --json prints hashes, source anchors and
synthetic arithmetic results, not proprietary animation poses. General native
quaternion interpolation and original sparse-track export parity remain open.
"""
import argparse
import hashlib
import json
import math
import struct
import sys

from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA

FIGHTER_SHA = '8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c'


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def normalization(image, frames, rate, multiplier, loop=False):
    """Evaluate only the two actual, call-free x87 normalization snippets.

    Float64 intermediates approximate x87; original Float32 stores are kept.
    Reject every operation outside this deliberately tiny instruction set.
    """
    assert frames > 0 and all(math.isfinite(x) for x in (frames, rate, multiplier))
    memory = {'dword ptr [ebp + 8]': f32(frames),
              'dword ptr [ebp + 0x10]': f32(multiplier),
              'dword ptr [ebp - 0x14]': f32(rate),
              'dword ptr [ebp + 0x18]': f32(frames)}
    stack = [] if loop else [f32(rate)]
    start, end = (0x3b341c, 0x3b3442) if loop else (0x3b3170, 0x3b3193)
    def read(operand):
        return stack[int(operand[3:-1])] if operand.startswith('st(') else memory[operand]
    for instruction in image.dis.disasm(image.data[start:end], image.base + start):
        op, arg = instruction.mnemonic, instruction.op_str
        if op == 'fld':
            stack.insert(0, read(arg))
        elif op == 'fld1':
            stack.insert(0, 1.)
        elif op == 'fxch':
            i = int(arg[3:-1]); stack[0], stack[i] = stack[i], stack[0]
        elif op in ('fst', 'fstp'):
            memory[arg] = f32(stack[0])
            if op == 'fstp': stack.pop(0)
        elif op == 'fmul':
            stack[0] *= read(arg)
        elif op in ('fdivp', 'fdivrp', 'fsubrp'):
            i = int(arg[3:-1]); a, b = stack[i], stack[0]
            stack[i] = a / b if op == 'fdivp' else b / a if op == 'fdivrp' else b - a
            stack.pop(0)
        else:
            raise AssertionError(('unsupported normalization instruction', op, arg))
    assert not stack
    return {name: memory[f'dword ptr [esi + {offset}]'] for name, offset in (
        ('baseRate', '0x20'), ('playbackRate', '0xc'), ('lastFrame', '0x14'))}


def x87_slice(instructions, memory, stack):
    """Evaluate a bounded, branch-free floating point slice; fail closed.

    Memory keys are the original operand strings. Callers supply all inputs,
    including constants read from the pinned image. Stores retain Float32
    rounding; Python intermediates do not emulate x87 extended precision.
    """
    def index(operand):
        assert operand.startswith('st(') and operand.endswith(')'), operand
        return int(operand[3:-1])

    def read(operand):
        return stack[index(operand)] if operand.startswith('st(') else memory[operand]

    for instruction in instructions:
        op, arg = instruction.mnemonic, instruction.op_str
        if op in ('fld', 'fld1', 'fldz'):
            stack.insert(0, read(arg) if op == 'fld' else float(op == 'fld1'))
        elif op == 'fxch':
            i = index(arg); stack[0], stack[i] = stack[i], stack[0]
        elif op in ('fst', 'fstp'):
            if arg.startswith('st('): stack[index(arg)] = stack[0]
            else:
                assert arg.startswith('dword ptr '), 'unbounded store'
                memory[arg] = f32(stack[0])
            if op == 'fstp': stack.pop(0)
        elif op in ('fadd', 'fsub', 'fsubr', 'fmul', 'fdiv', 'fdivr'):
            a, b = stack[0], read(arg)
            stack[0] = (a + b if op == 'fadd' else a - b if op == 'fsub'
                        else b - a if op == 'fsubr' else a * b if op == 'fmul'
                        else a / b if op == 'fdiv' else b / a)
        elif op in ('faddp', 'fsubp', 'fsubrp', 'fmulp', 'fdivp', 'fdivrp'):
            i = index(arg); a, b = stack[i], stack[0]
            stack[i] = (a + b if op == 'faddp' else a - b if op == 'fsubp'
                        else b - a if op == 'fsubrp' else a * b if op == 'fmulp'
                        else a / b if op == 'fdivp' else b / a)
            stack.pop(0)
        else:
            raise AssertionError(('unsupported tween instruction', op, arg))
    return memory, stack


def tween_clock(image, frames, tween, delta, playback_rate):
    """Consume actual positive-Q setup/update slices, including crossing zero."""
    assert frames > 1 and tween > 0 and delta >= 0
    assert all(math.isfinite(x) for x in (frames, tween, delta, playback_rate))
    memory = {'dword ptr [ebp + 8]': f32(frames),
              'dword ptr [esi + 0xc]': f32(playback_rate),
              'qword ptr [0x108a0660]': struct.unpack_from('<d', image.data, image.offset(0x108a0660))[0],
              'qword ptr [0x10854b60]': struct.unpack_from('<d', image.data, image.offset(0x10854b60))[0]}

    def run(start, end, stack):
        return x87_slice(image.dis.disasm(image.data[start:end], image.base + start), memory, stack)[1]

    # Positive Q and zero are the x87 stack after the independently pinned branch.
    assert not run(0x3b321a, 0x3b323b, [f32(tween), 0.])
    start_frame, rate = memory['dword ptr [esi + 0x10]'], memory['dword ptr [esi + 0x18]']
    memory.update({'dword ptr [edi + 0x10]': start_frame,
                   'dword ptr [edi + 0x18]': rate,
                   'dword ptr [ebp - 0x20]': start_frame})
    run(0x3bae16, 0x3bae27, [0., f32(delta)])
    new_frame = memory['dword ptr [edi + 0x10]']
    leftover = 0.
    if new_frame >= 0:
        run(0x3bae30, 0x3bae4b, [0., f32(delta)])
        leftover = memory['dword ptr [ebp - 0x14]']
        memory['dword ptr [edi + 0xc]'] = f32(playback_rate)
        run(0x3baae8, 0x3baaf3, [0., leftover])
    return {'startFrame': start_frame, 'tweenRate': rate,
            'frameBeforeCrossing': new_frame, 'leftoverDelta': leftover,
            'frame': memory['dword ptr [edi + 0x10]']}


def loop_crossing(image, old_frame, new_frame, delta):
    """Evaluate only original crossing-one leftover clock and reset stores."""
    assert 0 <= old_frame < 1 <= new_frame and delta > 0
    memory = {'dword ptr [edi + 0x10]': f32(new_frame),
              'qword ptr [0x10852238]': struct.unpack_from('<d', image.data, image.offset(0x10852238))[0]}
    x87_slice(image.dis.disasm(image.data[0x3bad98:0x3badb2], image.base + 0x3bad98),
              memory, [f32(old_frame), 0., f32(delta)])
    return {'frame': memory['dword ptr [edi + 0x10]'], 'leftoverDelta': memory['dword ptr [ebp - 0x14]']}


def audit_fighter_source():
    """Measure original compressed key times, not dense exported PSA samples.

    Bounded to one pinned 123/30/version1 package. The read layout follows
    the cited UEViewer serializer; every serialized chunk end and full export
    end must agree. No poses or proprietary text are returned.
    """
    sys.path.insert(0, str(ROOT / 'tools'))
    from l2lib import load_package, read_properties
    path = ROOT / 'assets/interlude/animations/Fighter.ukx'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == FIGHTER_SHA
    package, _ = load_package(str(path))
    assert (package.file_version, package.licensee_version) == (123, 30)
    exports = [e for e in package.exports if package.export_name(e) == 'MFighter_anim']
    assert len(exports) == 1
    export = exports[0]
    end = export.serial_offset + export.serial_size
    reader = package.body_reader(export)
    read_properties(package, reader)
    assert reader.i32() == 1

    def count(min_size=1):
        n = reader.compact()
        assert 0 <= n <= (end - reader.pos) // min_size
        return n

    def name():
        index = reader.compact()
        assert 0 <= index < len(package.names)
        return package.names[index]

    def array(width):
        n = count(width)
        return reader.bytes(n * width), n

    def track(allow_empty=False):
        offset = reader.pos
        reader.i32()  # AnalogTrack flags
        _, quats = array(16)
        _, positions = array(12)
        raw, times = array(4)
        values = struct.unpack('<%df' % times, raw)
        assert (values or allow_empty) and quats in (1, times) and positions in (1, times)
        assert all(math.isfinite(t) and t >= 0 for t in values)
        assert all(a <= b for a, b in zip(values, values[1:]))
        return {'offset': offset, 'times': values, 'quaternionKeys': quats, 'positionKeys': positions}

    bones = []
    for i in range(count(9)):
        bones.append(name()); reader.i32()
        assert 0 <= reader.i32() <= i
    moves_end = reader.i32()
    assert reader.pos < moves_end <= end
    moves = []
    for _ in range(count(28)):
        local_end = reader.i32()
        reader.bytes(12)  # RootSpeed3D
        duration = reader.f32()
        assert math.isfinite(duration) and duration > 0
        reader.i32(); reader.i32()  # StartBone, flags
        array(4)  # BoneIndices
        tracks = [track() for _ in range(count(7))]
        assert len(tracks) == len(bones)
        track(allow_empty=True)  # Separate RootTrack, not ordinary pose interpolation.
        assert reader.pos == local_end
        moves.append((duration, tracks))
    assert reader.pos == moves_end
    assert count(18) == len(moves)
    rows = []
    for duration, tracks in moves:
        reader.f32()  # FMeshAnimSeq f28
        sequence_name = name()
        for _ in range(count()): name()  # Groups
        reader.i32()  # StartFrame
        frames = reader.i32()
        for _ in range(count(6)):
            reader.f32(); name(); reader.compact()  # Notifies
        rate = reader.f32()
        assert frames > 0 and math.isfinite(rate) and rate > 0
        reader.i32(); reader.i32(); reader.i32(); reader.compact(); reader.i32(); reader.i32()
        # The exact original version30 trailing Lineage records.
        reader.u8(); array(8)
        for _ in range(count(5)): reader.i32(); array(8)
        reader.i32(); reader.i32(); array(8)
        varying = [t for t in tracks if len(t['times']) > 1]
        early = [t for t in varying if t['times'][-1] * frames / duration < frames - 1 - 1e-6]
        rows.append({'sequence': sequence_name, 'frames': frames, 'rate': rate,
                     'movementDuration': duration, 'nonconstantTracks': len(varying),
                     'earlyFinalKeyTracks': len(early),
                     'earliestLastKeyFrame': min((t['times'][-1] * frames / duration for t in varying), default=None)})
    assert reader.pos == end
    selected = [r for r in rows if r['sequence'].lower() in {
        'castshort_mfighter', 'castmid_mfighter', 'castlong_mfighter',
        'castend_mfighter', 'magicshot_mfighter'}]
    assert len(selected) == 5
    return {'packageSHA256': FIGHTER_SHA, 'export': 'MFighter_anim',
            'exportOffset': export.serial_offset, 'exportSize': export.serial_size,
            'exportSHA256': hashlib.sha256(reader.data[export.serial_offset:end]).hexdigest(),
            'bones': len(bones), 'sequences': len(rows),
            'earlyFinalKeySequences': sum(r['earlyFinalKeyTracks'] > 0 for r in rows),
            'earlyFinalKeyTracks': sum(r['earlyFinalKeyTracks'] for r in rows),
            'selected': selected}


def verify():
    e = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    methods = {
        '?PlayAnim@USkeletalMeshInstance@@UAEHHVFName@@MMH@Z': 0x3b2fe0,
        '?UpdateAnimation@USkeletalMeshInstance@@UAEHM@Z': 0x3ba8d0,
        '?PoseFrame@USkeletalMeshInstance@@UAEXHM@Z': 0x3c6f90,
        '?GetFrame@USkeletalMeshInstance@@UAEXPAVAActor@@PAVFLevelSceneNode@@PAVFVector@@HAAHK@Z': 0x3d9a70,
        '?AnimGetFrameCount@USkeletalMeshInstance@@UAEMPAX@Z': 0x3ae970,
        '?AnimGetRate@USkeletalMeshInstance@@UAEMPAX@Z': 0x3ae990,
        '?IsAnimLooping@USkeletalMeshInstance@@UAEHH@Z': 0x3b2a20,
    }
    for name, rva in methods.items(): assert e.exported(name, True) == e.base + rva
    mesh_vt = e.exported('??_7USkeletalMeshInstance@@6B@')
    for slot, name in ((0xc8, '?AnimGetFrameCount@USkeletalMeshInstance@@UAEMPAX@Z'),
                       (0xcc, '?AnimGetRate@USkeletalMeshInstance@@UAEMPAX@Z')):
        assert e.u32(mesh_vt + slot) == e.exported(name)
    anim_vt = e.exported('??_7UMeshAnimation@@6B@')
    assert e.u32(anim_vt + 0x70) == e.exported('?GetMovement@UMeshAnimation@@UAEPAVMotionChunk@@VFName@@@Z')
    assert e.u32(anim_vt + 0x68) == e.exported('?GetAnimSeq@UMeshAnimation@@UAEPAUFMeshAnimSeq@@VFName@@@Z')
    # Named getters, setup, advancement, nonloop clamp and loop boundary.
    anchors = [
        (0x3ae978, 'fild', 'dword ptr [eax + 0x14]'),
        (0x3ae998, 'fld', 'dword ptr [eax + 0x18]'),
        (0x3b2a62, 'mov', 'eax, dword ptr [ecx + eax + 0x30]'),
        (0x3b30fc, 'cmp', 'dword ptr [ebp + 0x18], 0'),
        (0x3b3100, 'jne', '0x106b3379'),
        (0x3b3142, 'mov', 'edx, dword ptr [eax + 0xc8]'),
        (0x3b3168, 'mov', 'eax, dword ptr [edx + 0xcc]'),
        (0x3b31ae, 'mov', 'dword ptr [esi + 0x30], ecx'),
        (0x3b345d, 'mov', 'dword ptr [esi + 0x30], 1'),
        # Positive tween setup and zero-tween branch are distinct source paths.
        (0x3b3218, 'jne', '0x106b3254'),
        (0x3b3229, 'fstp', 'dword ptr [esi + 0x18]'),
        (0x3b3232, 'fstp', 'dword ptr [esi + 0x10]'),
        (0x3b3254, 'fld', 'dword ptr [0x10854358]'),
        (0x3b3261, 'jp', '0x106b334e'),
        (0x3b334e, 'fstp', 'dword ptr [esi + 0x18]'),
        (0x3b3351, 'fld', 'dword ptr [0x108d7100]'),
        (0x3b3357, 'fstp', 'dword ptr [esi + 0x10]'),
        (0x3b34dc, 'fstp', 'dword ptr [esi + 0x18]'),
        (0x3b34e5, 'fstp', 'dword ptr [esi + 0x10]'),
        (0x3b3507, 'fld', 'dword ptr [0x10854358]'),
        (0x3b3514, 'jp', '0x106b3601'),
        (0x3b3601, 'fstp', 'dword ptr [esi + 0x18]'),
        (0x3b3604, 'fld', 'dword ptr [0x108c50a4]'),
        (0x3b360a, 'fstp', 'dword ptr [esi + 0x10]'),
        (0x3baad8, 'jp', '0x106bae16'),
        (0x3bae16, 'fld', 'dword ptr [edi + 0x18]'),
        (0x3bae24, 'fst', 'dword ptr [edi + 0x10]'),
        (0x3bae2e, 'jne', '0x106bae93'),
        (0x3bae45, 'fstp', 'dword ptr [ebp - 0x14]'),
        (0x3bae48, 'fst', 'dword ptr [edi + 0x10]'),
        (0x3bae53, 'jp', '0x106baa7c'),
        (0x3baab9, 'add', 'eax, 1'),
        (0x3baabc, 'mov', 'dword ptr [ebp - 0x2c], eax'),
        (0x3baabf, 'cmp', 'eax, 4'),
        (0x3baac2, 'jg', '0x106bae97'),
        # Rendering tween reads first track keys and cached displayed poses.
        (0x3da791, 'fld', 'dword ptr [ebx + 0x10]'),
        (0x3da797, 'fdiv', 'dword ptr [ebx + 0x68]'),
        (0x3da7a0, 'fsubrp', 'st(1)'),
        (0x3da980, 'mov', 'eax, dword ptr [ecx + 4]'),
        (0x3da983, 'mov', 'edx, dword ptr [eax]'),
        (0x3da9aa, 'mov', 'eax, dword ptr [ecx + 0x10]'),
        (0x3da9bc, 'mov', 'eax, dword ptr [ebp + 0x1d4]'),
        (0x3da9e0, 'mov', 'eax, dword ptr [ebp + 0x1c8]'),
        (0x3daa29, 'call', '0x10307e96'),
        (0x3daa50, 'call', '0x1030e37c'),
        (0x3baae8, 'fld', 'dword ptr [edi + 0xc]'),
        (0x3baaeb, 'fmul', 'st(2)'),
        (0x3baaed, 'fadd', 'dword ptr [edi + 0x10]'),
        (0x3baaf0, 'fstp', 'dword ptr [edi + 0x10]'),
        (0x3bad62, 'fld', 'dword ptr [edi + 0x14]'),
        (0x3bad72, 'cmp', 'dword ptr [edi + 0x30], 0'),
        (0x3bad76, 'je', '0x106badcf'),
        (0x3bad78, 'fld1', ''),
        (0x3bad7a, 'fcomp', 'dword ptr [edi + 0x10]'),
        (0x3bad82, 'jne', '0x106bad98'),
        (0x3bad9b, 'fsub', 'qword ptr [0x10852238]'),
        (0x3badac, 'fstp', 'dword ptr [ebp - 0x14]'),
        (0x3badaf, 'fst', 'dword ptr [edi + 0x10]'),
        (0x3badbe, 'jne', '0x106baa7c'),
        (0x3bade1, 'fld', 'dword ptr [edi + 0x14]'),
        (0x3bade4, 'fstp', 'dword ptr [edi + 0x10]'),
        (0x3badfd, 'fstp', 'dword ptr [edi + 0xc]'),
        (0x3bae0e, 'fst', 'dword ptr [edi + 0xc]'),
        # PoseFrame: named movement pointer, normalized frame -> source time.
        (0x3c7458, 'mov', 'edx, dword ptr [eax + 0x70]'),
        (0x3c7463, 'mov', 'edi, eax'),
        (0x3c7489, 'fld', 'dword ptr [ebx + 0x10]'),
        (0x3c74c0, 'fld', 'dword ptr [edi + 0x10]'),
        (0x3c74c3, 'fmul', 'dword ptr [esp + 0x10]'),
        (0x3c75ee, 'push', '0'), (0x3c7609, 'call', '0x1030777f'),
        (0x3da5f2, 'push', '0'), (0x3da60d, 'call', '0x1030777f'),
        # Ordinary-bone sampler: successor wraps, denominator uses source end.
        (0x3bb75b, 'lea', 'ebp, [edi + 1]'),
        (0x3bb75e, 'cmp', 'ebp, ebx'),
        (0x3bb760, 'jl', '0x106bb76c'),
        (0x3bb762, 'xor', 'ebp, ebp'),
        (0x3bb764, 'mov', 'dword ptr [esp + 0x4c], 1'),
        (0x3bb7ae, 'fld', 'dword ptr [eax + 0x10]'),
        (0x3bb7b4, 'fsub', 'dword ptr [eax + edi*4]'),
        (0x3bb7e5, 'fcom', 'qword ptr [0x108a8a50]'),
        (0x3bb7f8, 'fsubp', 'st(3)'), (0x3bb7fa, 'fdivp', 'st(2)'),
        (0x3bb7fe, 'fstp', 'dword ptr [esp + 0x14]'),
        (0x3bb89b, 'call', '0x10307e96'),
        (0x3bb963, 'call', '0x1030f024'),
        # Quaternion near-identical copy and linear blend branch thresholds.
        (0x3ae0c6, 'fcom', 'qword ptr [0x108e2140]'),
        (0x3ae0d1, 'jne', '0x106ae0f5'),
        (0x3ae0f5, 'fld', 'dword ptr [0x108e213c]'),
        (0x3ae102, 'jp', '0x106ae155'),
        (0x3ae112, 'fstp', 'dword ptr [esp + 0x38]'),
    ]
    for rva, mnemonic, operands in anchors: e.instruction(e.base + rva, mnemonic, operands)
    for stub, target in ((0x777f, 0x3bb6a0), (0x7e96, 0x3b56d0), (0xf024, 0x3ae090)):
        e.instruction(e.base + stub, 'jmp', hex(e.base + target))
    assert struct.unpack_from('<d', e.data, e.offset(0x10852238))[0] == 1.
    assert struct.unpack_from('<d', e.data, e.offset(0x108a0660))[0] == -1.
    assert struct.unpack_from('<d', e.data, e.offset(0x10854b60))[0] == 0.
    assert struct.unpack_from('<f', e.data, e.offset(0x10854358))[0] == -1.
    assert struct.unpack_from('<f', e.data, e.offset(0x108d7100))[0] == f32(.001)
    assert struct.unpack_from('<f', e.data, e.offset(0x108c50a4))[0] == f32(.0001)
    assert struct.unpack_from('<f', e.data, e.offset(0x108e213c))[0] == f32(.55)
    assert struct.unpack_from('<d', e.data, e.offset(0x108e2140))[0] == 0.9999998807907104
    regions = [
        ('one-shot normalization', 0x3b3170, 0x3b3193, '04d11ad7f3d1a394d588ba26a4af01d1efa1d0042ad5aba445b52825c769ce2a'),
        ('loop normalization', 0x3b341c, 0x3b3442, '6dbea339d897ee419d660a1726cb1c7de5495fa0b25963bbab89eb9acc474a69'),
        ('endpoint advancement', 0x3bad5f, 0x3bae16, '4df5398e550539c945be58698e88af502bbad3d6bfb7a9ea179c280881974b9c'),
        ('sample key selection', 0x3bb6a0, 0x3bb82b, '25bff934179786c0a263e907c490a6914175c8f82bee260f7280fcb54086cbe9'),
        ('sample blend', 0x3bb82b, 0x3bbb49, '062f62aa74d907937e7a314f794a8b777de0fdf8ad2896baba00fa15d26b4ca2'),
        ('quaternion hemisphere', 0x3b56d0, 0x3b5804, '702c08698f429f96464e814d0b36be23b5f45e4c6a008b73c52706e8f35a1ce5'),
        ('quaternion interpolation', 0x3ae090, 0x3ae297, '094131c196c85a7656129d56adacdb2ccb938ea209427559c17b71891eccf839'),
        ('positive tween setup', 0x3b320e, 0x3b323b, '24f2b5848f5500ad687fc03f5ebac402361d5c6de284c8c32d07d86e51683809'),
        ('zero tween one-shot', 0x3b334e, 0x3b3360, '0df38dca2978f17449f2cd67c93f5022cff1feca60f1f5b1b6d42dd608b33803'),
        ('zero tween new loop', 0x3b3601, 0x3b3613, 'fecd5c58d46498c398e62f704a7b2d41e392c24a0cba8a65e24f34132c32cad4'),
        ('tween crossing clock', 0x3bae16, 0x3bae59, 'eb36bdbcf77ad4015812273a5e57677afbfe3b24f2caf3a9e66eee7532a2833c'),
        ('render tween fraction', 0x3da791, 0x3da809, '95e19d0734a3e9a71e386fe2ba714c65e2d19624ae68a6f222b1472fbc46c42d'),
        ('render first-key tween', 0x3da975, 0x3dab0a, '0fdea42d3bf7cb6afc4e4c48b7bbbb917a66d5e4b9bfcc5c754136ba0621c0c0'),
    ]
    for _, start, end, sha in regions: assert hashlib.sha256(e.data[start:end]).hexdigest() == sha
    cases = []
    for frames, rate, multiplier in ((30, 30., 1.), (24, 12., 2.), (2, 17.5, .75), (1, 30., 1.)):
        for loop in (False, True):
            actual = normalization(e, frames, rate, multiplier, loop)
            assert actual == {'baseRate': f32(f32(rate) / f32(frames)),
                              'playbackRate': f32(f32(f32(rate) / f32(frames)) * f32(multiplier)),
                              'lastFrame': f32(1 - 1 / f32(frames))}
        cases.append({'frames': frames, 'rate': rate, 'multiplier': multiplier,
                      'normalization': actual, 'sourcePeriodSeconds': frames / rate,
                      'sampleSpanSeconds': (frames - 1) / rate})
    tween_cases = []
    for n, q, dt, rate in ((30, .2, 0., 1.), (30, .2, .1, 1.),
                          (4, .125, .125, 7.5), (55, .15, .25, 30 / 55)):
        actual = tween_clock(e, n, q, dt, rate)
        initial, tween_rate = f32(-1 / f32(n)), f32(1 / (f32(q) * f32(n)))
        crossed_frame = f32(initial + tween_rate * f32(dt))
        remainder = f32(f32(dt) * crossed_frame / (crossed_frame - initial)) if crossed_frame >= 0 else 0.
        expected = {'startFrame': initial, 'tweenRate': tween_rate, 'frameBeforeCrossing': crossed_frame,
                    'leftoverDelta': remainder,
                    'frame': f32(f32(rate) * remainder) if crossed_frame >= 0 else crossed_frame}
        assert actual == expected
        tween_cases.append({'frames': n, 'tween': q, 'delta': dt, 'playbackRate': rate, 'result': actual})
    loop_cases = []
    for old, new, dt in ((.25, 1., .75), (.75, 1.25, .5), (0., 4.25, 4.25)):
        actual = loop_crossing(e, old, new, dt)
        assert actual == {'frame': 0., 'leftoverDelta': f32(f32(dt) * (f32(new) - 1) / (f32(new) - f32(old)))}
        loop_cases.append({'oldFrame': old, 'newFrame': new, 'delta': dt, 'result': actual})
    return {'tool': 'Elbera Tools', 'sourceSHA256': ENGINE_SHA,
            'instructionAnchors': len(anchors), 'normalizationCases': cases,
            'positiveTweenCases': tween_cases,
            'loopCrossingCases': loop_cases,
            'zeroTweenStartFrame': {'oneShot': f32(.001), 'newLoop': f32(.0001)},
            'regions': [{'name': n, 'startRVA': hex(s), 'endRVAExclusive': hex(t), 'sha256': h}
                        for n, s, t, h in regions],
            'limits': ['static original-code evidence; no original-client execution',
                       'x87 intermediate bit parity not claimed',
                       'general quaternion imported math calls are erased',
                       'compressed source-track versus dense PSA sampling not validated',
                       'special/root-motion sampler argument nonzero is outside this proof']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--audit-fighter', action='store_true', help='measure pinned original human-fighter compressed key tails')
    args = parser.parse_args()
    result = verify()
    if args.audit_fighter: result['fighterSourceAudit'] = audit_fighter_source()
    if args.json: print(json.dumps(result, indent=2))
    else:
        print(f"PASS: Elbera Tools animation terminal proof; {result['instructionAnchors']} anchors, {len(result['regions'])} pinned ranges, 8 normalization, {len(result['positiveTweenCases'])} tween and {len(result['loopCrossingCases'])} loop crossing cases")
        if args.audit_fighter:
            audit = result['fighterSourceAudit']
            print(f"PASS: original {audit['export']}: {audit['sequences']} sequences, {audit['earlyFinalKeyTracks']} tracks end before N-1; all chunk/export bounds match")
