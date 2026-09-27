#!/usr/bin/env python3
"""Elbera Tools: bounded ordinary GetFrame cache lifetime and repeat-call gate.

Portable state helpers need only Python's standard library. --check additionally
reads the pinned owned Engine/Core and needs Capstone. --comparison-engine binds
the otherwise erased allocator calls and two global names through exact blocks
of the separately pinned supplemental image; it never executes a client DLL.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]


def _frame(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError('finite frame required')
    try:
        value = struct.unpack('<f', struct.pack('<f', value))[0]
    except (OverflowError, struct.error) as error:
        raise ValueError('finite Float32 frame required') from error
    if not math.isfinite(value):
        raise ValueError('finite Float32 frame required')
    return value


def _tick(value):
    if type(value) is not int or not 0 <= value < 1 << 64:
        raise ValueError('explicit unsigned 64-bit counter bit pattern required')
    return value


def fresh_channel_bookkeeping():
    """Only three fields of a newly AddZeroed 0x70-byte channel.

    This says nothing about the separately allocated mesh instance's +0x1fc.
    previousSequenceId is the raw zero DWORD, not an invented sequence index.
    """
    return dict(previousSequenceId=0, previousFrame=0.0, accumulated=0.0)


def empty_pose_cache_bookkeeping(state):
    """GetFrame's empty-q-array branch resets +0x68, not +0x60/+0x6c."""
    if not isinstance(state, dict) or set(state) != {
            'previousSequenceId', 'previousFrame', 'accumulated'}:
        raise ValueError('explicit three-field channel bookkeeping required')
    name = state['previousSequenceId']
    if type(name) is not int or not 0 <= name < 1 << 32:
        raise ValueError('raw FName DWORD required')
    _frame(state['previousFrame'])
    accumulated = _frame(state['accumulated'])
    return dict(previousSequenceId=name, previousFrame=0.0, accumulated=accumulated)


def cache_decision(*, tick, cached_tick, frame, cached_frame, editor,
                   q_cache_empty, coordinates_changed, source_cache_empty,
                   mode=0):
    """Ordinary same-owner GetFrame gate, finite frames and explicit state only.

    No sequence identity is in the native key. Mode 3 suppresses marker stores;
    it does not itself invalidate a matching key. The native marker is written
    BEFORE pose work, so this return is not a successful-render transaction.
    A browser render/update epoch is an adaptation, not native GTicks identity.
    """
    tick, cached_tick = _tick(tick), _tick(cached_tick)
    frame, cached_frame = _frame(frame), _frame(cached_frame)
    flags = (editor, q_cache_empty, coordinates_changed, source_cache_empty)
    if any(type(flag) is not bool for flag in flags):
        raise ValueError('all cache and editor conditions must be explicit booleans')
    if type(mode) is not int or not -(1 << 31) <= mode < 1 << 31:
        raise ValueError('signed mode DWORD required')
    repeated = tick == cached_tick and frame == cached_frame
    invalidated = q_cache_empty or coordinates_changed or source_cache_empty
    return dict(evaluate=not repeated or editor or invalidated,
                repeated=repeated, invalidated=invalidated,
                marker=dict(tick=cached_tick, frame=cached_frame) if mode == 3
                else dict(tick=tick, frame=frame))


def _corresponding_global(owned, candidate, start, end, operand, candidate_slot,
                          expected):
    """One declared IAT operand; every other byte must be identical."""
    a = bytes(owned.data[owned.offset(start):owned.offset(end)])
    b = candidate.read(start - 0x40, end - start)
    offset = operand - start
    if not 0 <= offset <= len(a) - 4:
        raise ValueError('global operand outside comparison block')
    if struct.unpack_from('<I', b, offset)[0] != candidate_slot \
            or candidate.imports.get(candidate_slot) != expected:
        raise ValueError('supplemental global binding mismatch')
    normalized = bytearray(a)
    normalized[offset:offset + 4] = b[offset:offset + 4]
    if normalized != b:
        raise ValueError('global block differs outside the declared IAT operand')
    return dict(ownedStartVA=hex(start), bytes=len(a),
                ownedSHA256=hashlib.sha256(a).hexdigest(),
                candidateSHA256=hashlib.sha256(b).hexdigest(),
                ownedSlot=hex(struct.unpack_from('<I', a, offset)[0]),
                candidateSlot=hex(candidate_slot), imported=list(expected))


def verify(comparison_engine=None):
    # Keep all original-data/dependency access out of the portable API.
    from check_tutorial_quest_native import Image, ENGINE_SHA
    from check_skillanim_native import CORE_SHA
    from check_hair_attachment_native import COMPARISON_SHA, compare_call_block
    from supplemental_pe import PEImage
    from check_track_native import Machine
    E = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    C = Image(ROOT / 'assets/interlude/system/Core.dll', CORE_SHA)
    P = PEImage(comparison_engine, COMPARISON_SHA) if comparison_engine else None
    methods = {
        '??0USkeletalMeshInstance@@QAE@XZ': (0x103f4460, 0x103f45ec),
        '??0USkeletalMeshInstance@@QAE@ABV0@@Z': (0x103f4650, 0x103f494f),
        '?SetMesh@USkeletalMeshInstance@@UAEXPAVUMesh@@@Z': (0x106c4ae0, 0x106c4b6e),
        '?ActualizeAnimLinkups@USkeletalMeshInstance@@UAEXXZ': (0x106ba200, 0x106ba281),
        '?GetFrame@USkeletalMeshInstance@@UAEXPAVAActor@@PAVFLevelSceneNode@@PAVFVector@@HAAHK@Z':
            (0x106d9a70, 0x106dc53b),
    }
    for symbol, (start, _) in methods.items():
        assert E.exported(symbol, True) == start
    anchors = [
        (0x1031379b, 'jmp', '0x106b2700'),
        (0x106b3017, 'call', '0x1031379b'),
        (0x106b2710, 'cmp', 'dword ptr [esi + 0x188], ebx'),
        (0x106b2716, 'jg', '0x106b273f'),
        (0x106b2720, 'push', '1'), (0x106b2722, 'push', '0x70'),
        (0x103f45c7, 'mov', 'dword ptr [esi + 0x1f4], 0'),
        (0x103f47be, 'mov', 'ecx, dword ptr [ebp + 0x1fc]'),
        (0x103f47c4, 'mov', 'dword ptr [ebx + 0x1fc], ecx'),
        (0x106c4af1, 'mov', 'dword ptr [esi + 0x60], eax'),
        (0x106c4b62, 'mov', 'eax, dword ptr [edx + 0x15c]'),
        (0x103112ca, 'jmp', '0x106ba200'),
        (0x106d9b79, 'mov', 'edx, dword ptr [eax + 0x6c]'),
        (0x106d9b80, 'mov', 'ecx, dword ptr [0x11d8e188]'),
        (0x106d9b8a, 'mov', 'edx, dword ptr [eax + 0x70]'),
        (0x106d9b92, 'fld', 'dword ptr [eax + 0x74]'),
        (0x106d9ba1, 'fucompp', ''), (0x106d9ba8, 'jnp', '0x106d9bb2'),
        (0x106d9daf, 'cmp', 'esi, 3'), (0x106d9dbb, 'jne', '0x106d9dd4'),
        (0x106d9dc1, 'fstp', 'dword ptr [ebp + 0x74]'),
        (0x106d9dcb, 'mov', 'dword ptr [ebp + 0x6c], ecx'),
        (0x106d9dd1, 'mov', 'dword ptr [ebp + 0x70], edx'),
        (0x106d9dd4, 'mov', 'eax, dword ptr [ebp + 0x1cc]'),
        (0x106d9de9, 'mov', 'dword ptr [esp + 0x24], eax'),
        (0x106d9e3b, 'fstp', 'dword ptr [edx + ecx + 0x68]'),
        (0x106d9e42, 'add', 'ecx, 0x70'),
        (0x106d9e59, 'cmp', 'ecx, eax'),
        (0x106d9e66, 'mov', 'dword ptr [esp + 0x24], 0'),
        (0x106da03a, 'mov', 'eax, dword ptr [ebx + 0x304]'),
        (0x106da051, 'mov', 'dword ptr [esp + 0x1c], esi'),
        (0x106da2af, 'call', 'eax'),
        (0x106da2b1, 'cmp', 'dword ptr [esp + 0x1c], 0'),
        (0x106da2b8, 'mov', 'ecx, dword ptr [0x11d8dbe4]'),
        (0x106da2c1, 'je', '0x106dc0f9'),
        (0x106da437, 'cmp', 'dword ptr [ebp + 0x1fc], 0'),
        (0x106db21e, 'mov', 'dword ptr [ebp + 0x1fc], 1'),
    ]
    for anchor in anchors:
        E.instruction(*anchor)
    assert E.u32(0x1087d2bc + 0x15c) == 0x103112ca
    # Direct bodies, not a claim about inherited/erased constructors or every
    # external writer. PlayAnim's exact channel pointer is ESI after 106b30a2.
    def rows(start, end):
        return list(E.dis.disasm(E.data[E.offset(start):E.offset(end)], start))
    for start, end in ((0x103f4460, 0x103f45ec), (0x106c4ae0, 0x106c4b6e),
                       (0x106ba200, 0x106ba281)):
        assert not any('0x1fc]' in i.op_str for i in rows(start, end))
    channel_stores = [i for i in rows(0x106b2fe0, 0x106b371b)
                      if i.mnemonic in ('mov', 'fst', 'fstp')
                      and i.op_str.split(', ')[0] in
                      ('dword ptr [esi + 0x60]', 'dword ptr [esi + 0x68]',
                       'dword ptr [esi + 0x6c]')]
    assert not channel_stores
    C.instruction(0x10109163, 'xor', 'eax, eax')
    C.instruction(0x1010916d, 'rep stosd', 'dword ptr es:[edi], eax')
    C.instruction(0x10109171, 'rep stosb', 'byte ptr es:[edi], al')
    assert C.exported('?AddZeroed@FArray@@QAEHHH@Z', True) == 0x10109110

    comparisons = []
    if P:
        for start, end, sites in [
            (0x106b2700, 0x106b274e, [(0x106b2726, '?AddZeroed@FArray@@QAEHHH@Z'),
                                      (0x106b2738, '?Shrink@FArray@@QAEXH@Z')]),
            (0x106c4ae0, 0x106c4b6e, [(va, '?Empty@FArray@@QAEXHH@Z') for va in
                (0x106c4af4, 0x106c4b04, 0x106c4b14, 0x106c4b24,
                 0x106c4b34, 0x106c4b44, 0x106c4b54)]),
        ]:
            a = E.data[E.offset(start):E.offset(end)]
            b = P.read(start - 0x40, end - start)
            comparisons.append(dict(ownedStartVA=hex(start),
                **compare_call_block(a, b, owned_va=start, candidate_va=start - 0x40,
                    sites=[(va-start, ('core.dll', name)) for va, name in sites],
                    direct_calls=[], imports=P.imports)))
        comparisons += [
            _corresponding_global(E, P, 0x106d9b79, 0x106d9bb2, 0x106d9b82,
                                  0x11d8e180, ('core.dll', '?GTicks@@3_JA')),
            _corresponding_global(E, P, 0x106da2a4, 0x106da2c7, 0x106da2ba,
                                  0x11d8dbe0, ('core.dll', '?GIsEditor@@3HA')),
            _corresponding_global(E, P, 0x106d9dad, 0x106d9dd4, 0x106d9dc5,
                                  0x11d8e180, ('core.dll', '?GTicks@@3_JA')),
        ]

    class Slice(Machine):
        def step(self, ins):
            if ins.mnemonic == 'fucompp':
                a, b = self.stack[:2]
                assert math.isfinite(a) and math.isfinite(b)
                self.status = 0x100 if a < b else 0x4000 if a == b else 0
                del self.stack[:2]
                return ins.address + ins.size
            if ins.mnemonic == 'sete':
                assert ins.op_str == 'al'
                self.registers['eax'] = (self.registers['eax'] & ~255) | int(self.zero)
                return ins.address + ins.size
            return super().step(ins)

    def execute(start, end, memory, registers, stack=(), exits=()):
        initial = dict.fromkeys(('eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp', 'esp'), 0)
        initial.update(registers)
        m = Slice(memory, initial, rows(start, end))
        m.stack = list(stack)
        m.zero = m.less = m.carry = m.sign = m.parity = False
        pc = start
        for count in range(256):
            if pc == end or pc in exits:
                return m, count, pc
            pc = m.step(m.program[pc])
        raise AssertionError('bounded cache slice exceeded step budget')

    # Run actual owned instructions with synthetic state, separately from the
    # portable rule. High-half and Float32 boundary cases distinguish the key.
    cases = steps = 0
    for tick in (0, 1, 0xffffffff, 0x100000001, 0xffffffffffffffff):
        for cached in (tick, tick ^ 1, tick ^ (1 << 32)):
            for frame, cached_frame in ((0., -0.), (-.1, -.1), (.25, .5),
                                        (.250000001, .25)):
                frame, cached_frame = _frame(frame), _frame(cached_frame)
                sp, instance, counter = 0x9000, 0x2000, 0x3000
                memory = {instance+0x6c: cached & 0xffffffff, instance+0x70: cached >> 32,
                          instance+0x74: cached_frame, 0x11d8e188: counter,
                          counter: tick & 0xffffffff, counter+4: tick >> 32}
                m, n, _ = execute(0x106d9b79, 0x106d9bb2, memory,
                                   {'eax': instance, 'esp': sp}, [frame])
                repeat = bool(m.memory[sp+0x1c])
                assert repeat == (tick == cached and frame == cached_frame)
                steps += n
                for editor in (False, True):
                    m, n, pc = execute(0x106da2b1, 0x106da2c7,
                        {sp+0x1c: int(repeat), 0x11d8dbe4: 0x4000, 0x4000: int(editor)},
                        {'esp': sp}, exits=(0x106dc0f9,))
                    expected = cache_decision(tick=tick, cached_tick=cached,
                        frame=frame, cached_frame=cached_frame, editor=editor,
                        q_cache_empty=False, coordinates_changed=False, source_cache_empty=False)
                    assert (pc == 0x106da2c7) == expected['evaluate']
                    cases += 1
                    steps += n
    marker_cases = 0
    for mode in (-1, 0, 1, 2, 3, 4):
        sp, instance, counter = 0x9000, 0x2000, 0x3000
        mem = {sp+0x10: -.125, instance+0x74: .5, instance+0x6c: 99,
               instance+0x70: 2, 0x11d8e188: counter, counter: 7, counter+4: 3}
        m, n, _ = execute(0x106d9dad, 0x106d9dd4, mem,
                          {'esp': sp, 'ebp': instance, 'esi': mode})
        expect = cache_decision(tick=(3 << 32) + 7, cached_tick=(2 << 32) + 99,
            frame=-.125, cached_frame=.5, editor=False, q_cache_empty=False,
            coordinates_changed=False, source_cache_empty=False, mode=mode)['marker']
        assert m.memory[instance+0x74] == expect['frame']
        assert m.memory[instance+0x6c] + (m.memory[instance+0x70] << 32) == expect['tick']
        marker_cases += 1
        steps += n
    reset_cases = 0
    for count in (0, 1, 3, 16):
        instance, channels = 0x2000, 0x4000
        mem = {instance+0x188: count, instance+0x184: channels}
        for i in range(count):
            mem.update({channels+0x70*i+0x60: .25,
                        channels+0x70*i+0x68: -.125,
                        channels+0x70*i+0x6c: i+17})
        m, n, _ = execute(0x106d9e27, 0x106d9e4d, mem, {'ebp': instance})
        for i in range(count):
            expected = empty_pose_cache_bookkeeping(dict(
                previousSequenceId=i+17, previousFrame=-.125, accumulated=.25))
            assert m.memory[channels+0x70*i+0x68] == expected['previousFrame']
            assert m.memory[channels+0x70*i+0x60] == expected['accumulated']
            assert m.memory[channels+0x70*i+0x6c] == expected['previousSequenceId']
        reset_cases += 1
        steps += n
    ranges = []
    for label, start, end in [('channel allocation', 0x106b2700, 0x106b274e),
                             ('repeat key', 0x106d9b79, 0x106d9bb2),
                             ('marker', 0x106d9dad, 0x106d9dd4),
                             ('empty cache reset', 0x106d9e27, 0x106d9e4d),
                             ('repeat bypass', 0x106da2a4, 0x106da2c7),
                             ('default constructor', 0x103f4460, 0x103f45ec),
                             ('PlayAnim', 0x106b2fe0, 0x106b371b)]:
        ranges.append(dict(label=label, start=hex(start), end=hex(end),
            SHA256=hashlib.sha256(E.data[E.offset(start):E.offset(end)]).hexdigest()))
    return dict(ownedEngineSHA256=E.sha, ownedCoreSHA256=C.sha,
        supplementalEngineSHA256=P.sha if P else None, instructionAnchors=len(anchors)+3,
        ranges=ranges, comparisons=comparisons, repeatCases=cases,
        markerCases=marker_cases, resetCases=reset_cases, interpretedInstructions=steps,
        namesAndAllocation='supplemental exact correspondence' if P else 'erased calls/global names unbound',
        freshInstanceCacheFlag='unresolved: direct constructor has no +0x1fc initializer',
        limits=['ordinary same-owner instance only; owner-linked and editor paths excluded from adaptation',
                'finite frames; no NaN/exception-mask emulation',
                'counter is GTicks only with supplemental correspondence; browser epochs are adaptation',
                'marker stores precede pose work; not proof of successful-frame transaction',
                'no allocation-wide +0x1fc zeroing or exhaustive external-writer proof',
                'call ordering and tween arithmetic are separate evidence'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--comparison-engine', type=Path)
    args = parser.parse_args()
    result = verify(args.comparison_engine)
    if args.check:
        print(f"Elbera pose cache: {result['instructionAnchors']} anchors, "
              f"{result['repeatCases']} repeat / {result['markerCases']} marker / "
              f"{result['resetCases']} reset actual-instruction cases; "
              f"{len(result['comparisons'])} supplemental blocks; "
              f"{result['namesAndAllocation']}; fresh instance +0x1fc unresolved.")
    else:
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
