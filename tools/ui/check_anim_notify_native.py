#!/usr/bin/env python3
"""Elbera Tools: pinned Interlude skeletal notify selection and clock evidence.

--check/--json require the owner's Engine.dll and capstone. Synthetic helpers
and their unittest suite use only Python's standard library. The verifier
decodes but never executes or emits original code. This is a finite ordinary
channel model, not an original-client emulator or a callback implementation.
"""
import argparse
import hashlib
import json
import math
import struct

CORE_SHA = '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf'

def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def crossing(old, new, time):
    old, new, time = map(f32, (old, new, time))
    if not all(map(math.isfinite, (old, new, time))):
        raise ValueError('nonfinite notify comparison is outside this proof')
    return old < time <= new


def selected_indices(notifies, old, new, *, removal_policy='reject'):
    """Serialized order; class booleans must come from original ancestry.

    A source null object still has a clock position. Named legacy function
    records must first undergo UpdateOldNotifies conversion; see dispatch_kind.

    The native removal helper receives an aliased array element address. Its
    erased import cannot be rebound conclusively. By default reject a batch
    requiring removal instead of certifying idealized remove-current behavior.
    small-in-place-alias is an explicitly conditional Core Add/Remove model.
    """
    if removal_policy not in ('reject', 'small-in-place-alias'):
        raise ValueError('unknown removal policy')
    candidates = [i for i, n in enumerate(notifies) if crossing(old, new, n['t'])]
    selected, found_shot = [], False
    for index in candidates:
        notify = notifies[index]
        if type(notify.get('isAttackShot')) is not bool or type(notify.get('isBoneScale')) is not bool:
            raise ValueError('missing original notify class predicates')
        remove = notify['isBoneScale'] or (notify['isAttackShot'] and found_shot)
        if remove:
            if removal_policy == 'reject':
                raise ValueError('native aliased removal import binding unresolved')
            if len(candidates) > 33:
                raise ValueError('conditional small-array capacity exceeded')
            return selected  # At capacity33, the aliased RemoveItem eats tail.
        if notify['isAttackShot']:
            found_shot = True
        selected.append(index)
    return selected


def dispatch_kind(notify):
    """Describe post-load dispatch; never infer a function from a class name."""
    if notify.get('function') not in (None, 'None'):
        return 'postload-script'  # Function replaces object, even if non-null.
    if notify.get('objectRef') == 0:
        return 'null'
    if isinstance(notify.get('objectRef'), int):
        return 'object'
    raise ValueError('source object reference missing')


def split_delta(old, current, time, delta):
    """Literal native per-record remainder, including negative results.

    old remains the original advancement frame across every record. current
    and delta change after each record. No sorting, clamping or normalization.
    Float64 intermediates approximate x87; the Float32 result store is retained.
    """
    old, current, time, delta = map(f32, (old, current, time, delta))
    if not all(map(math.isfinite, (old, current, time, delta))) or current == old:
        raise ValueError('nonfinite/zero-divisor callback mutation outside proof')
    return f32((current - time) * delta / (current - old))


def dispatch_batch(notifies, old, advanced, delta):
    """No callback mutations: returns the frame and remainder after the batch."""
    frame, remaining, events = f32(advanced), f32(delta), []
    for index in selected_indices(notifies, old, advanced):
        notify = notifies[index]
        remaining = split_delta(old, frame, notify['t'], remaining)
        frame = f32(notify['t'])
        events.append({'index': index, 'frame': frame, 'remaining': remaining,
                       'dispatch': dispatch_kind(notify)})
    return {'frame': frame, 'remaining': remaining, 'events': events}


def advance_channel(frame, rate, last, delta, notifies=(), *, loop=False,
                    tween_rate=0., initial_advancements=0):
    """Bounded ordinary channel clock, with immutable callbacks and sequences.

    Native actor/channel gates are assumed enabled. This deliberately excludes
    callbacks that replace/free the channel, negative velocity-driven rates,
    AnimEnd callbacks and the special one-frame setup. initial_advancements is
    for testing the shared counter, not a second per-notify dispatch budget.
    """
    frame, rate, last, remaining, tween_rate = map(f32, (frame, rate, last, delta, tween_rate))
    if not all(map(math.isfinite, (frame, rate, last, remaining, tween_rate))):
        raise ValueError('nonfinite channel state')
    if rate < 0 or not 0 <= last < 1 or not 0 <= initial_advancements <= 4:
        raise ValueError('unsupported channel state')
    count, events, discarded = initial_advancements, [], 0.
    while remaining > 0 and (frame < 0 or rate > 0):
        if count == 4:
            discarded = remaining
            break
        count += 1
        old = frame
        if frame < 0:
            if tween_rate <= 0:
                raise ValueError('missing positive tween rate')
            frame = f32(frame + tween_rate * remaining)
            if frame < 0:
                remaining = 0.
                break
            remaining = split_delta(old, frame, 0., remaining)
            frame = 0.
            continue
        frame = f32(frame + rate * remaining)
        batch = dispatch_batch(notifies, old, frame, remaining)
        frame, remaining = batch['frame'], batch['remaining']
        events.extend(batch['events'])
        if frame < last:
            # The source exits here, even after a notify changed remaining.
            discarded = remaining if batch['events'] else 0.
            remaining = 0.
            break
        if loop:
            if frame >= 1.:
                remaining = split_delta(old, frame, 1., remaining)
                frame = 0.
            else:
                remaining = 0.
        else:
            remaining = split_delta(old, frame, last, remaining) if frame != old else 0.
            frame, rate = last, 0.
            break
    return {'frame': frame, 'rate': rate, 'remaining': remaining,
            'discarded': discarded, 'advancements': count, 'events': events}


def native_crossing(image, old, new, time):
    """Execute only the original comparison/branch slice, with finite inputs."""
    values = { 'dword ptr [ebp - 0x20]': f32(old),
               'dword ptr [ebp - 0x34]': f32(time),
               'dword ptr [edi + 0x10]': f32(new)}
    assert all(map(math.isfinite, values.values()))
    instructions = {i.address - image.base: i for i in image.dis.disasm(
        image.data[0x3babd5:0x3babf2], image.base + 0x3babd5)}
    pc, stack, status, zero = 0x3babd5, [], 0, False
    for _ in range(24):
        if pc == 0x3babf2: return True
        if pc in (0x3bac04, 0x3bac06): return False
        ins = instructions[pc]
        op, arg = ins.mnemonic, ins.op_str
        next_pc = pc + ins.size
        if op == 'fld': stack.insert(0, values[arg])
        elif op in ('fcom', 'fcompp'):
            a, b = stack[:2]
            status = 0x40 if a == b else 1 if a < b else 0
            if op == 'fcompp': del stack[:2]
        elif op == 'fnstsw': assert arg == 'ax'
        elif op == 'fstp':
            assert arg == 'st(1)'
            stack[1] = stack[0]
            stack.pop(0)
        elif op == 'test':
            register, mask = arg.split(', ')
            assert register == 'ah'
            zero = status & int(mask, 0) == 0
        elif op == 'jne':
            if not zero: next_pc = int(arg, 0) - image.base
        else: raise AssertionError(('unsupported comparison instruction', op, arg))
        pc = next_pc
    raise AssertionError('notify comparison did not terminate')


def native_split_delta(image, old, current, time, delta):
    from check_anim_terminal_native import x87_slice
    memory = {'qword ptr [ebp - 0x40]': f32(current),
              'dword ptr [ebp - 0x14]': f32(delta),
              'dword ptr [edi + 0x10]': f32(current),
              'dword ptr [ebp - 0x20]': f32(old)}
    x87_slice(image.dis.disasm(image.data[0x3bacc6:0x3bacd7], image.base + 0x3bacc6),
              memory, [f32(time)])
    return memory['dword ptr [ebp - 0x14]']


def verify():
    # Lazy imports keep synthetic tests independent of capstone/private assets.
    from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA
    image = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    core = Image(ROOT / 'assets/interlude/system/core.dll', CORE_SHA)
    for name, rva in (('?Remove@FArray@@QAEXHHH@Z', 0x523c0),
                      ('?Add@FArray@@QAEHHH@Z', 0x90c0),
                      ('?AddZeroed@FArray@@QAEHHH@Z', 0x9110)):
        assert core.exported(name, True) == core.base + rva
    core.instruction(core.base + 0x523f1, 'call', hex(core.exported('?appMemmove@@YAPAXPAXPBXH@Z')))
    for rva, op, arg in ((0x523f6, 'sub', 'dword ptr [esi + 4], ebx'),
                         (0x5241d, 'cmp', 'ecx, 0x40'), (0x52424, 'jne', '0x10152431'),
                         (0x916d, 'rep stosd', 'dword ptr es:[edi], eax')):
        core.instruction(core.base + rva, op, arg)
    methods = {
        '?UpdateAnimation@USkeletalMeshInstance@@UAEHM@Z': 0x3ba8d0,
        '?AnimGetNotifyCount@USkeletalMeshInstance@@UAEHPAX@Z': 0x3ae9b0,
        '?AnimGetNotifyTime@USkeletalMeshInstance@@UAEMPAXH@Z': 0x3b3cc0,
        '?AnimGetNotifyText@USkeletalMeshInstance@@UAEPBGPAXH@Z': 0x3b3cf0,
        '?AnimGetNotifyObject@USkeletalMeshInstance@@UAEPAVUAnimNotify@@PAXH@Z': 0x3b3d20,
        '?PostLoad@UMeshAnimation@@UAEXXZ': 0x3b1910,
        '?SetStatus@ULodMeshInstance@@UAEXH@Z': 0x60cc0,
        '?GetStatus@ULodMeshInstance@@UAEHXZ': 0x60cd0,
        '?Notify@UAnimNotify_Script@@UAEXPAVUMeshInstance@@PAVAActor@@@Z': 0x3cab10,
        '?PlayAnim@APawn@@UAEHHVFName@@MMHH@Z': 0x3a7c80,
        '?PlayAnim@USkeletalMeshInstance@@UAEHHVFName@@MMH@Z': 0x3b2fe0,
        '?EnableChannelNotify@USkeletalMeshInstance@@QAEHHH@Z': 0x3b4380,
    }
    for name, rva in methods.items(): assert image.exported(name, True) == image.base + rva
    assert image.u32(image.exported('??_7APawn@@6B@') + 0x328) == image.exported(
        '?PlayAnim@APawn@@UAEHHVFName@@MMHH@Z')
    vt = image.exported('??_7USkeletalMeshInstance@@6B@')
    assert image.u32(vt + 0xac) == image.exported('?PlayAnim@USkeletalMeshInstance@@UAEHHVFName@@MMH@Z')
    for slot, prefix in ((0xa0, '?SetStatus@'), (0xa4, '?GetStatus@'), (0xd0, '?AnimGetNotifyCount@'),
                         (0xd4, '?AnimGetNotifyTime@'), (0xd8, '?AnimGetNotifyText@'), (0xdc, '?AnimGetNotifyObject@')):
        name = next(n for n in methods if n.startswith(prefix))
        assert image.u32(vt + slot) == image.exported(name)
    for cls, address in (('AttackShot', 0x10dd51b0), ('BoneScale', 0x10dd3cf0), ('Script', 0x10dd7b30)):
        assert image.exported(f'?PrivateStaticClass@UAnimNotify_{cls}@@0VUClass@@A') == address
    assert image.wide(0x108d3498) == 'FMeshAnimSeq::UpdateOldNotifies'
    anchors = [
        (0x3ae9b8, 'mov', 'eax, dword ptr [eax + 0x20]'),
        (0x3b3ccc, 'mov', 'ecx, dword ptr [ecx + 0x1c]'),
        (0x3b3ccf, 'lea', 'eax, [eax + eax*2]'),
        (0x3b3cd2, 'fld', 'dword ptr [ecx + eax*4]'),
        (0x3b3d05, 'lea', 'ecx, [eax + 4]'),
        (0x3b3d32, 'mov', 'eax, dword ptr [ecx + eax*4 + 8]'),
        (0x2e54ce, 'cmp', 'eax, 0x70'), (0x2e54d5, 'push', '4'),
        (0x2e5504, 'lea', 'ecx, [edi + 4]'), (0x2e550e, 'add', 'edi, 8'),
        (0x2e6106, 'push', '0xc'), (0x2e616e, 'call', '0x10307662'),
        (0x2e6176, 'add', 'ebx, 1'),
        (0x3b194c, 'imul', 'esi, esi, 0x74'), (0x3b195d, 'call', '0x103049e9'),
        (0x2e5d26, 'je', '0x105e5d6f'), (0x2e5d3c, 'push', '0x10dd7b30'),
        (0x2e5d50, 'mov', 'dword ptr [eax + 0x38], edx'),
        (0x2e5d56, 'mov', 'dword ptr [ecx + esi + 8], eax'),
        (0x2e5d6b, 'mov', 'dword ptr [edx + esi + 4], eax'),
        (0x3ba9db, 'mov', 'dword ptr [ebp - 0x2c], edi'),
        (0x3ba9e6, 'imul', 'edi, edi, 0x70'),
        (0x3baab9, 'add', 'eax, 1'), (0x3baabf, 'cmp', 'eax, 4'),
        (0x3baac2, 'jg', '0x106bae97'),
        (0x3bab4b, 'cmp', 'dword ptr [edi + 0x34], 0'),
        (0x3bab65, 'cmp', 'dword ptr [eax + 0x104], 0'),
        (0x3bab72, 'cmp', 'dword ptr [edi + 0x44], 0'),
        (0x3babca, 'mov', 'edx, dword ptr [eax + 0xd4]'),
        (0x3babe1, 'test', 'ah, 0x41'), (0x3babe4, 'jne', '0x106bac04'),
        (0x3babed, 'test', 'ah, 1'), (0x3babf0, 'jne', '0x106bac06'),
        (0x3babfe, 'add', 'dword ptr [ebp - 0x24], 1'),
        (0x3bac33, 'call', '0x10307dd3'), (0x3bac43, 'je', '0x106bac5d'),
        (0x3bac52, 'call', '0x103013a2'), (0x3bac5d, 'mov', 'dword ptr [ebp - 0x30], 1'),
        (0x3bac68, 'call', '0x10306e83'), (0x3bac81, 'call', '0x103013a2'),
        (0x3bac4b, 'lea', 'edx, [eax + ecx*4]'),
        (0x3bac7a, 'lea', 'eax, [ecx + edx*4]'),
        (0x3016af, 'mov', 'ebx, dword ptr [esp + 0x14]'),
        (0x3016b8, 'cmp', 'ecx, dword ptr [ebx]'),
        (0x3016c1, 'call', '0x1030314d'), (0x3016c6, 'sub', 'esi, 1'),
        (0x25711, 'push', '4'), (0x25713, 'push', 'ebx'), (0x25714, 'push', 'edi'),
        (0x1eee69, 'push', '0x10dd51b0'), (0x31e7d9, 'push', '0x10dd3cf0'),
        (0x3baccc, 'fld', 'dword ptr [edi + 0x10]'),
        (0x3baccf, 'fsub', 'dword ptr [ebp - 0x20]'),
        (0x3bacd4, 'fstp', 'dword ptr [ebp - 0x14]'),
        (0x3bacee, 'fstp', 'dword ptr [edi + 0x10]'),
        (0x3bad0d, 'je', '0x106bad38'),
        (0x3bad12, 'mov', 'dword ptr [esi + 0x1c0], ecx'),
        (0x3bad1a, 'add', 'eax, 0x68'), (0x3bad36, 'call', 'eax'),
        (0x3bad38, 'add', 'dword ptr [ebp - 0x1c], 1'),
        (0x3bad3f, 'jmp', '0x106baca3'),
        (0x3bad6c, 'je', '0x106bae91'), (0x3bad76, 'je', '0x106badcf'),
        (0x3bad82, 'jne', '0x106bad98'), (0x3badaf, 'fst', 'dword ptr [edi + 0x10]'),
        (0x3bade4, 'fstp', 'dword ptr [edi + 0x10]'),
        (0x3bae88, 'call', 'edx'), (0x3bae8c, 'jmp', '0x106baa7c'),
        (0x60cc4, 'mov', 'dword ptr [ecx + 0x68], eax'),
        (0x60cd0, 'mov', 'eax, dword ptr [ecx + 0x68]'),
        (0x211e1f, 'mov', 'edi, 1'), (0x211f78, 'push', 'edi'),
        (0x211f81, 'sete', 'dl'), (0x211f84, 'push', 'edx'),
        (0x211f9d, 'push', 'ebx'), (0x211fa0, 'mov', 'edx, dword ptr [eax + 0x328]'),
        (0x3a7cda, 'mov', 'eax, dword ptr [ebp + 0x1c]'),
        (0x3a7cdd, 'mov', 'byte ptr [esi + 0x710], al'),
        (0x3a7cf0, 'or', 'dword ptr [esi + 0x70c], 1'),
        (0x3a7deb, 'mov', 'eax, dword ptr [ebp + 0x18]'),
        (0x3a7e03, 'push', 'edi'), (0x3a7e04, 'mov', 'edx, dword ptr [edx + 0xac]'),
        (0x3b3198, 'mov', 'eax, dword ptr [edx + 0xd0]'),
        (0x3b31a6, 'mov', 'dword ptr [esi + 0x34], eax'),
        (0x3b31bd, 'mov', 'dword ptr [esi + 0x34], ecx'),
        (0x3b3447, 'mov', 'eax, dword ptr [edx + 0xd0]'),
        (0x3b3455, 'mov', 'dword ptr [esi + 0x34], eax'),
        (0x3b3470, 'mov', 'dword ptr [esi + 0x34], ecx'),
        (0x3b43cc, 'cmp', 'dword ptr [ebp + 0xc], eax'),
        (0x3b43cf, 'sete', 'al'),
        (0x3b43db, 'mov', 'dword ptr [ecx + esi + 0x44], eax'),
    ]
    for rva, mnemonic, args in anchors: image.instruction(image.base + rva, mnemonic, args)
    for stub, target in ((0x7dd3, 0x1eee60), (0x6e83, 0x31e7d0), (0x13a2, 0x3016a0),
                         (0x49e9, 0x2e5cd0), (0x7662, 0x2e54c0), (0x1893, 0x2e60e0)):
        image.instruction(image.base + stub, 'jmp', hex(image.base + target))
    for cls in ('AttackShot', 'Sound', 'Script'):
        assert image.u32(image.exported(f'??_7UAnimNotify_{cls}@@6B@') + 0x68) == image.exported(
            f'?Notify@UAnimNotify_{cls}@@UAEXPAVUMeshInstance@@PAVAActor@@@Z')
    regions = []
    for name, start, end, digest in REGIONS:
        assert hashlib.sha256(image.data[start:end]).hexdigest() == digest, name
        regions.append({'name': name, 'startRVA': hex(start), 'endRVAExclusive': hex(end), 'sha256': digest})
    comparisons = 0
    for old in (0., .125, f32(.001), .75, 1.):
        for new in (old, old + .125, old + 1.):
            for time in (0., old, new, .5, 1., 1.5):
                assert native_crossing(image, old, new, time) == crossing(old, new, time)
                comparisons += 1
    arithmetic = []
    for old, current, time, delta in ((.125, .875, .25, .75), (.125, .25, .5, .625),
                                    (.125, .5, .5, .75), (.9, 1.5, 1.25, .6),
                                    (.125, .75, .25, .625), (.125, .5, .75, -1.25)):
        actual = native_split_delta(image, old, current, time, delta)
        assert actual == split_delta(old, current, time, delta)
        arithmetic.append({'old': old, 'current': current, 'time': time, 'delta': delta, 'result': actual})
    return {'tool': 'Elbera Tools', 'engineSHA256': ENGINE_SHA, 'coreSHA256': CORE_SHA,
            'instructionAnchors': len(anchors), 'regions': regions,
            'nativeBoundaryCases': comparisons, 'nativeRemainderCases': arithmetic,
            'limits': ['static original-code evidence, not original-client execution',
                       'Float64 intermediates with original Float32 stores; x87 bit parity not claimed',
                       'imported class/name/allocation calls are erased; class constants and surrounding control flow pinned',
                       'batches needing class filtering reject by default: erased Remove import and aliased array element',
                       'fresh channel notify-disable default is unresolved; named enable API and existing-state gates proved',
                       'portable clock excludes callback mutation, destruction, negative rates and AnimEnd callbacks',
                       'sound/effect/action implementations are separate proofs']}


# Hashes cover the complete relevant regions, not just favorable instructions.
REGIONS = [
    ('ordinary MagicProcess PlayAnim arguments', 0x211f4c, 0x211faa, 'b7d88c504dfd4603a89520a8206d058c647459d4c435237553cd17bd6633cd0a'),
    ('Pawn forwarding', 0x3a7cda, 0x3a7e0f, '1d44048ff52e9195804e110da799525d0ffc4590ddc5d5940de9dfd6bb38e77b'),
    ('one-shot notify enable', 0x3b3193, 0x3b31c3, '14134764de307dedc35d10b5537e7e2edc5749fa7ff299af6235facaa4023599'),
    ('loop notify enable', 0x3b3442, 0x3b3476, 'f749b0a1a53b90f3a14da4b2bad0a7d166336ed80425cc81cd68293c327488ea'),
    ('channel enable API', 0x3b4380, 0x3b43f7, '87ae1655b5e876efc4418c1ee848bf54cda8b28dfb22beb8d58af555d5ccc575'),

    ('notify getters', 0x3b3cc0, 0x3b3d3c, 'aff4a48432ede961561c682ead55cee476d285bed0868e6334f362e7f0ed2a69'),
    ('notify serializer', 0x2e54c0, 0x2e551c, '563191b4651b16749c08f41b5f7270418e385c013b4d058222c41981add5930c'),
    ('notify array reader', 0x2e60e0, 0x2e61d3, '1e5eb80734a3baecfbf41de25bfd07b9c8667f4eb7fc8b1a7a5f5053405ebb81'),
    ('legacy function conversion', 0x2e5cd0, 0x2e5d8c, '886f3342141082dd804464034bcffe44118c0c9a0e623ff346e016b7fd6d9b19'),
    ('mesh PostLoad', 0x3b1910, 0x3b197f, 'ca0c0bbefd78fec86feef3b33b91b1bab112ecdd23951e47e0395ceb26889c55'),
    ('notify crossing/filter/dispatch', 0x3bab4b, 0x3bad5f, 'c3fb34c0cc2ff9b27f5f4a8a85dfddc9df943803d324488f833b8d5711df2610'),
    ('advance guard and cap', 0x3baa7c, 0x3baaf5, '7e618acaa129b03ebb255bb99a5c3688e9a07411aa1ad14d6ee2bf0d11bb1a98'),
    ('endpoint and tween control', 0x3bad5f, 0x3bae99, 'f8858ef1d05d72d1384e6fa2097cc166976e5d14d83d000358b6b81c6e2db903'),
    ('AttackShot class test', 0x1eee60, 0x1eee82, '3e03b8641d9eb6772fdbb353420d5d7b830afab6e7a03c80a8e90231582491ea'),
    ('BoneScale class test', 0x31e7d0, 0x31e7f2, '48264ab2b0b153c0a156d753d7ebe2c75981a50e9a1d20d39b11a26f0406dfe5'),
    ('array removal', 0x3016a0, 0x3016db, 'dcff619673e83a5e15e82be7e6b5c56618095412e45909215a1d1017d037f1f9'),
]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    result = verify()
    if args.json: print(json.dumps(result, indent=2))
    else: print(f"PASS: Elbera Tools notify proof; {result['instructionAnchors']} anchors, "
                f"{len(result['regions'])} ranges, {result['nativeBoundaryCases']} native boundary cases, "
                f"{len(result['nativeRemainderCases'])} native remainder cases")
