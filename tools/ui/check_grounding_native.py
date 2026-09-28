#!/usr/bin/env python3
"""Elbera Tools: original correction traces and movement packet evidence.

Portable helpers/tests need only Python's standard library. --check requires
the pinned Interlude Engine.dll/Engine.u and Capstone. --comparison-engine takes
an explicitly supplied, separately pinned supplemental image: exact finite
blocks bind otherwise erased Size/Empty/GetStateFrame calls conditionally.
That optional mode also reads the pinned owned Core.dll to verify Size's
Float32 return store; it does not emulate the CRT square root or FPU policy.
This does not authenticate that copy or prove restoration of the owned DLL.
ChangeMoveType dispatch, reflected Environment identity and its conditional
store are checked from owned inputs. No native code is executed or emitted.
Trace collision, controller overrides,
physics, velocity clearing and movement-to-Wait admission are not implemented.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys

from check_player_transform_native import f32

ROOT = Path(__file__).resolve().parents[2]


def audit_stack_arguments(instructions, *, start, end, argument_bytes, calls):
    """Finite x86 stack-read audit, not an emulator or a transitive call audit.

    Instructions are (address, size, mnemonic, operand_text) records. Both arms
    of every forward JE/JNE are visited. Only the small retained integer subset
    is accepted; stack-pointer aliases and saved aliases are tracked. Explicit
    calls declare their operand and callee-popped bytes; only EAX/ECX/EDX are
    clobbered by the Win32 ABI. Incoming values are not assumed stack aliases.
    No indirect jumps, loops, unknown calls, partial decode or unbalanced exits
    may silently establish an unread argument. Results describe local reads,
    not arbitrary memory access by callees or native execution.
    """
    code = list(instructions)
    if not code or type(argument_bytes) is not int or argument_bytes < 0 or argument_bytes % 4:
        raise ValueError('complete instructions and DWORD argument size required')
    positions, cursor = {}, start
    for address, size, op, args in code:
        if address != cursor or type(size) is not int or size <= 0:
            raise ValueError('noncontiguous or invalid instruction range')
        positions[address] = (size, op, args)
        cursor += size
    if cursor != end:
        raise ValueError('truncated instruction range')
    registers = {'eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp', 'esp'}
    pending = [(start, 0, {}, {})]
    visited, reads, used_calls = set(), set(), set()
    exits = 0
    while pending:
        pc, sp, aliases, saved = pending.pop()
        key = (pc, sp, tuple(sorted(aliases.items())), tuple(sorted(saved.items())))
        if key in visited:
            continue
        visited.add(key)
        if len(visited) > 512 or pc not in positions:
            raise ValueError('unsupported control flow or audit bound exceeded')
        size, op, args = positions[pc]
        operands = args.split(', ') if args else []
        aliases, saved = dict(aliases), dict(saved)

        def address_of(operand):
            match = re.fullmatch(r'(?:dword|byte) ptr \[([a-z]+)(?: \+ (0x[0-9a-f]+|\d+))?\]', operand)
            if not match or match[1] not in registers:
                raise ValueError('unsupported memory operand')
            base = sp if match[1] == 'esp' else aliases.get(match[1])
            return None if base is None else base + int(match[2] or '0', 0)

        def value_of(operand):
            if operand in registers:
                return sp if operand == 'esp' else aliases.get(operand)
            if 'ptr' in operand:
                offset = address_of(operand)
                if offset is None:
                    return None
                width = 1 if operand.startswith('byte ') else 4
                if offset < 4 < offset + width or offset < 0 < offset + width:
                    raise ValueError('read overlaps return-address boundary')
                if offset >= 0:
                    if offset < 4 or offset + width > argument_bytes + 4:
                        raise ValueError('read outside declared arguments')
                    reads.update(range(offset, offset + width))
                return saved.get(offset)
            try:
                int(operand, 0)
            except ValueError as error:
                raise ValueError('unsupported operand') from error
            return None

        def assign(register, value):
            if register not in registers or register == 'esp':
                raise ValueError('unsupported register write')
            aliases.pop(register, None)
            if value is not None:
                aliases[register] = value

        next_pc = pc + size
        if op == 'push' and len(operands) == 1:
            value = value_of(operands[0]); sp -= 4
            saved.pop(sp, None)
            if value is not None:
                saved[sp] = value
        elif op == 'pop' and len(operands) == 1:
            if sp >= 0:
                raise ValueError('pop outside local stack')
            assign(operands[0], saved.pop(sp, None)); sp += 4
        elif op == 'sub' and len(operands) == 2 and operands[0] == 'esp':
            amount = int(operands[1], 0)
            if amount <= 0 or amount % 4:
                raise ValueError('unsupported stack allocation')
            sp -= amount
        elif op == 'mov' and len(operands) == 2:
            value = value_of(operands[1])
            if operands[0] in registers:
                assign(operands[0], value)
            else:
                offset = address_of(operands[0])
                if offset is None and value is not None:
                    raise ValueError('stack alias escapes through a memory write')
                if offset is not None:
                    if not operands[0].startswith('dword ') or not sp <= offset <= -4:
                        raise ValueError('unsupported stack write')
                    saved.pop(offset, None)
                    if value is not None:
                        saved[offset] = value
        elif op == 'test' and len(operands) == 2:
            for operand in operands:
                value_of(operand)
        elif op in ('je', 'jne') and len(operands) == 1:
            target = int(operands[0], 0)
            if target not in positions or target <= pc:
                raise ValueError('branch is not a forward instruction boundary')
            pending.append((target, sp, aliases, saved))
        elif op == 'call' and pc in calls and calls[pc][0] == args:
            used_calls.add(pc)
            if aliases.get('ecx') is not None or args in aliases:
                raise ValueError('stack alias escapes through call receiver/target')
            cleanup = calls[pc][1]
            if type(cleanup) is not int or cleanup < 0 or cleanup % 4 or sp + cleanup > 0:
                raise ValueError('invalid callee stack cleanup')
            # Values copied into a by-value argument area must not secretly
            # forward a pointer into the caller stack to an uninspected callee.
            if any(sp <= slot < sp + cleanup for slot in saved):
                raise ValueError('stack alias escapes through a call argument')
            sp += cleanup
            saved = {k: v for k, v in saved.items() if k >= sp}
            for register in ('eax', 'ecx', 'edx'):
                aliases.pop(register, None)
        elif op == 'ret' and args == hex(argument_bytes):
            if sp != 0:
                raise ValueError('unbalanced return stack')
            exits += 1
            continue
        else:
            raise ValueError(f'unsupported audit instruction: {op} {args}')
        pending.append((next_pc, sp, aliases, saved))
    if not exits or {state[0] for state in visited} != set(positions) or used_calls != set(calls):
        raise ValueError('missing return, unreachable bytes or unmatched call declarations')
    return {'argumentBytesRead': sorted(reads), 'argumentDwordsRead': sorted({n // 4 * 4 for n in reads}),
            'reachableInstructions': len(positions), 'statesChecked': len(visited), 'returnPaths': exits}


def correction_trace_z(packet_z, collision_height):
    """Ordinary AdjustPawnLocation trace seed, after its admission gates."""
    z, height = f32(packet_z), f32(collision_height)
    return f32(z + height + 20.), f32(z - 30.)


def collision_hit_z(hit_z, hit_time):
    """Only the recovered post-trace bias, given native collision results."""
    z, time = f32(hit_z), f32(hit_time)
    d = f32(time * 12.)
    return f32(z + (2.150000035762787 - d)) if d < 1.899999976158142 else z


def verify_change_move_environment(image):
    """Original 0x2e field identity/store gate, without emulating actor state."""
    sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'tools/l2lib')]
    from l2lib import load_package
    from ue2package import Reader
    read = lambda va, n: bytes(image.data[image.offset(va):image.offset(va) + n])
    dispatch = b'\xc7\x05' + struct.pack('<I', 0x10a57310 + 0x2e * 0x104)
    assert image.data.count(dispatch) == 1
    dispatch_at = image.data.index(dispatch)
    packet_stub = struct.unpack_from('<I', image.data, dispatch_at + 6)[0]
    assert packet_stub == 0x1030316b and read(packet_stub, 1) == b'\xe9'
    assert packet_stub + 5 + struct.unpack('<i', read(packet_stub + 1, 4))[0] == 0x10427b20
    copy_symbol = '??0APawn@@QAE@ABV0@@Z'
    assert image.exported(copy_symbol) == 0x103035da
    assert image.exported(copy_symbol, True) == 0x103c5f50
    path = ROOT / 'assets/interlude/system/Engine.u'
    package, _ = load_package(str(path))
    pawn, = [e for e in package.exports_by_class('Class') if package.export_name(e) == 'Pawn']
    properties = {}
    for export in package.exports:
        if export.package_index != pawn.index + 1 or not package.class_name_of(export).endswith('Property'):
            continue
        raw = package.data[export.serial_offset:export.serial_offset + export.serial_size]
        reader = Reader(raw)
        assert package.name(reader.compact()) == 'None' and reader.compact() == 0
        properties[export.index + 1] = {'name': package.export_name(export),
            'type': package.class_name_of(export), 'next': reader.compact(),
            'SHA256': hashlib.sha256(raw).hexdigest()}
    names = ['WarpDest', 'IsWarpDest', 'bReadyToWarp', 'bIgnoreToWarp', 'Environment',
             'bHitGroundInWater', 'bSwimAfloat', 'LastFootRot', 'TurnAnimName']
    ref, = [ref for ref, row in properties.items() if row['name'] == names[0]]
    chain = []
    types = ['StructProperty', 'BoolProperty', 'BoolProperty', 'BoolProperty',
             'IntProperty', 'BoolProperty', 'BoolProperty', 'StructProperty', 'NameProperty']
    for expected, expected_type in zip(names, types):
        row = properties[ref]
        assert row['name'] == expected and row['type'] == expected_type
        chain.append(row); ref = row['next']
    anchors = [
        (0x103c5f68, 'mov', 'ebp, dword ptr [esp + 0x1c]'),
        (0x103c5f6e, 'mov', 'ebx, ecx'),
        (0x10427b3f, 'push', '0x1087ff0c'),
        (0x10427bba, 'call', 'eax'),
        (0x10427ba4, 'mov', 'esi, dword ptr [esp + 8]'),
        (0x10427bad, 'push', 'esi'),
        (0x10427bae, 'mov', 'esi, dword ptr [esp + 0x10]'),
        (0x10427bb2, 'push', 'esi'),
        (0x10427bb3, 'push', 'eax'),
        (0x10427bb4, 'mov', 'eax, dword ptr [edx + 0x280]'),
        (0x104890a1, 'movzx', 'ecx, byte ptr [eax + 0x434]'),
        (0x104890a8, 'mov', 'eax, dword ptr [esp + 0xc]'),
        (0x104890ac, 'cmp', 'ecx, eax'),
        (0x104890ae, 'je', '0x10489202'),
        (0x104890c2, 'mov', 'byte ptr [ecx + 0x434], al'),
        (0x104890ce, 'mov', 'ecx, dword ptr [esp + 0x10]'),
        (0x104890d2, 'mov', 'dword ptr [edx + 0x778], ecx'),
        (0x103c6799, 'mov', 'edx, dword ptr [ebp + 0x778]'),
        (0x103c679f, 'mov', 'dword ptr [ebx + 0x778], edx'),
        (0x103c678e, 'and', 'ecx, 4'),
        (0x103c6793, 'mov', 'dword ptr [ebx + 0x774], ecx'),
        (0x103c67b7, 'and', 'eax, 1'),
        (0x103c67ba, 'xor', 'dword ptr [ebx + 0x77c], eax'),
        (0x103c67ce, 'and', 'ecx, 2'),
        (0x103c67d3, 'mov', 'dword ptr [ebx + 0x77c], ecx'),
        (0x103c67d9, 'mov', 'edx, dword ptr [ebp + 0x780]'),
        (0x103c67fd, 'lea', 'edi, [ebx + 0x78c]'),
    ]
    for va, op, args in anchors:
        image.instruction(va, op, args)
    assert bytes(image.data[image.offset(0x1087ff0c):image.offset(0x1087ff0c)+4]) == b'ddd\0'
    table = image.exported('??_7UGameEngine@@6BUObject@@@')
    assert image.u32(table + 0x280) == image.exported('?OnChangeMoveType@UGameEngine@@UAEHPAUUser@@HH@Z')
    assert image.exported('?OnChangeMoveType@UGameEngine@@UAEHPAUUser@@HH@Z', True) == 0x10489080
    # Exact complete bounded call-prefix, including saved-register pushes.
    # Any new/missing instruction fails before deriving writer destinations.
    prefix = [
        ('sub', 'esp, 8'), ('push', 'esi'), ('push', 'edi'),
        ('lea', 'eax, [esp + 8]'), ('push', 'eax'),
        ('mov', 'eax, dword ptr [esp + 0x1c]'),
        ('lea', 'ecx, [esp + 0x10]'), ('push', 'ecx'),
        ('mov', 'ecx, dword ptr [esp + 0x1c]'),
        ('lea', 'edx, [esp + 0x1c]'), ('push', 'edx'),
        ('mov', 'edx, dword ptr [ecx + 0x48]'),
        ('push', '0x1087ff0c'), ('push', 'eax'), ('push', 'edx'),
        ('call', '0x103034e5'),
    ]
    rows = list(image.dis.disasm(read(0x10427b20, 0x2b), 0x10427b20))
    assert rows and rows[0].address == 0x10427b20
    assert rows[-1].address + rows[-1].size == 0x10427b4b
    assert sum(i.size for i in rows) == 0x2b
    assert [(i.mnemonic, i.op_str) for i in rows] == prefix
    pushes = [i for i in rows if i.mnemonic == 'push']
    leas = [i for i in rows if i.mnemonic == 'lea']
    assert len(pushes) == 8 and len(leas) == 3
    pushes = pushes[2:]  # saved ESI/EDI are part of the restored-stack baseline
    output_pushes = list(reversed(pushes[:-3]))
    assert len(output_pushes) == 3
    destinations = []
    for output in output_pushes:
        lea = next(i for i in reversed(rows[:rows.index(output)])
                   if i.mnemonic == 'lea' and i.op_str.startswith(output.op_str + ', [esp'))
        displacement = int(lea.op_str.split(' + ')[1].rstrip(']'), 16)
        destinations.append(displacement - 4 * sum(i.address < lea.address for i in pushes))
    assert destinations == [0x14, 0xc, 8]
    image.instruction(0x10427b51, 'add', 'esp, 0x18')

    return {'packetOpcode': 0x2e, 'packetFormat': 'ddd', 'instructionAnchors': len(anchors) + len(prefix) + 1,
        'packetDispatch': {'slot': hex(0x10a57310 + 0x2e * 0x104),
            'stub': hex(packet_stub), 'body': '0x10427b20',
            'pointerOrder': destinations, 'prefixSHA256': hashlib.sha256(read(0x10427b20, 0x2b)).hexdigest()},
        'typedCopy': {'symbol': copy_symbol, 'body': '0x103c5f50',
            'fieldRange': ['0x103c678e', '0x103c6803'],
            'fieldRangeSHA256': hashlib.sha256(read(0x103c678e, 0x75)).hexdigest()},
        'enginePackageSHA256': hashlib.sha256(path.read_bytes()).hexdigest(), 'propertyChain': chain,
        'wireField': 2, 'nativeProperty': 'Engine.Pawn.Environment', 'nativeOffset': '0x778',
        'storeGate': 'zero-extended current MoveType byte != incoming signed DWORD; not boolean comparison',
        'rawContract': 'Preserve every Environment DWORD. An unchanged move type skips the native Environment store; no effective-state inference.',
        'limits': ['No Environment enum meaning, swimming flag conversion, physics tick, or browser movement admission is supplied.']}


def verify_stop_move(image, comparison_engine=None):
    """One complete handler plus selected caller/base/correction slices.

    The private comparison input is never found implicitly. Owned-only checks
    preserve erased-call uncertainty; comparison names do not certify callee
    behavior, dynamic overrides or a full collision/movement implementation.
    """
    from check_hair_attachment_native import COMPARISON_SHA, compare_call_block
    from supplemental_pe import PEImage
    candidate = PEImage(comparison_engine, COMPARISON_SHA) if comparison_engine else None
    read = lambda va, n: bytes(image.data[image.offset(va):image.offset(va) + n])
    dispatch = b'\xc7\x05' + struct.pack('<I', 0x10a57310 + 0x47 * 0x104)
    assert image.data.count(dispatch) == 1
    at = image.data.index(dispatch)
    stub = image.u32(image.base + at + 6)
    assert read(stub, 1) == b'\xe9'
    assert stub + 5 + struct.unpack('<i', read(stub + 1, 4))[0] == 0x104287a0
    assert read(0x10883d84, 6) == b'ddddd\0'
    symbol = '?OnStopMove@UGameEngine@@UAEHPAUUser@@VFVector@@H@Z'
    assert image.exported(symbol, True) == 0x10491c80
    assert image.u32(image.exported('??_7UGameEngine@@6BUObject@@@') + 0x288) == image.exported(symbol)
    stop_symbol = '?StopMove@AController@@UAEXXZ'
    assert image.exported(stop_symbol, True) == 0x1056cdd0
    assert image.u32(image.exported('??_7AController@@6B@') + 0x320) == image.exported(stop_symbol)
    anchors = [
        (0x104287a5, 'lea', 'eax, [esp + 8]'),
        (0x104287aa, 'lea', 'ecx, [esp + 0x10]'),
        (0x104287af, 'lea', 'edx, [esp + 0x18]'),
        (0x104287b8, 'lea', 'eax, [esp + 0x20]'),
        (0x104287c1, 'lea', 'ecx, [esp + 0x38]'),
        (0x104287c9, 'push', '0x10883d84'),
        (0x104287d0, 'call', '0x103034e5'),
        (0x104287d5, 'fild', 'dword ptr [esp + 0x34]'),
        (0x104287e8, 'fild', 'dword ptr [esp + 0x10]'),
        (0x104287f0, 'fild', 'dword ptr [esp + 0xc]'),
        (0x10428846, 'mov', 'edx, dword ptr [esp + 8]'),
        (0x10428853, 'push', 'edx'),
        (0x10428867, 'mov', 'eax, dword ptr [esi + 0x288]'),
        (0x10428870, 'call', 'eax'),
        (0x10491c94, 'mov', 'eax, dword ptr [edx + 0x14d8]'),
        (0x10491c9e, 'test', 'byte ptr [eax + 0x41c], 1'),
        (0x10491ca5, 'jne', '0x10491cdc'),
        (0x10491cd4, 'mov', 'eax, dword ptr [edx + 0x320]'),
        (0x1056cdd6, 'xor', 'ebx, ebx'),
        (0x1056cdda, 'push', 'ebx'),
        (0x1056cddb, 'lea', 'ecx, [esi + 0x420]'),
        (0x1056cde1, 'push', '0xc'),
        (0x1056cdf1, 'mov', 'dword ptr [esi + 0x42c], ebx'),
        (0x1056ce04, 'and', 'dword ptr [eax + 0x6e4], edx'),
        (0x1056ce18, 'mov', 'dword ptr [esi + 0x3f0], ebx'),
        (0x1056ce22, 'mov', 'dword ptr [esi + 0x40c], ebx'),
        (0x1056ce2e, 'mov', 'dword ptr [esi + 0x400], ecx'),
        (0x1056ce52, 'mov', 'dword ptr [esi + 0x32c], ecx'),
        (0x1056ce88, 'mov', 'dword ptr [eax + 0x330], edi'),
        (0x1056cea4, 'and', 'dword ptr [esi + 0x2f8], ecx'),
        (0x1056ceaa, 'and', 'dword ptr [eax + 0x2f8], ecx'),
        (0x1056ceb6, 'and', 'dword ptr [eax + 0x88], edx'),
        (0x1056cec2, 'and', 'dword ptr [eax + 0x14e8], 0xfffffffb'),
        (0x1056ced7, 'add', 'eax, 0x1e0'),
        (0x1056cee5, 'mov', 'dword ptr [eax + 8], edx'),
        (0x1056ceee, 'call', '0x1030873d'),
        (0x1056cef5, 'je', '0x1056cfcd'),
        (0x1056cfb3, 'mov', 'dword ptr [esi + 0x3f4], edx'),
        (0x1056cfc7, 'mov', 'dword ptr [esi + 0x3fc], ecx'),
        (0x1056cfdc, 'mov', 'dword ptr [eax + 0x28], ebx'),
        (0x1056d153, 'ret', ''),
    ]
    for anchor in anchors:
        image.instruction(*anchor)
    handler = read(0x10491c80, 0x66)
    stack = audit_stack_arguments(
        [(i.address, i.size, i.mnemonic, i.op_str) for i in image.dis.disasm(handler, 0x10491c80)],
        start=0x10491c80, end=0x10491ce6, argument_bytes=20,
        calls={0x10491cc1: ('0x10315046', 16), 0x10491cda: ('eax', 0)})
    assert stack['argumentBytesRead'] == list(range(4, 20))
    ranges = [
        ('complete OnStopMove', 0x10491c80, 0x10491ce6, {}),
        ('correction displacement gate', 0x1048e330, 0x1048e3c7,
         {0x1048e384: '?Size@FVector@@QBEMXZ'}),
        ('selected StopMove queue/acceleration prefix', 0x1056cdd0, 0x1056cee8,
         {0x1056cde3: '?Empty@FArray@@QAEXHH@Z'}),
        ('GetStateFrame before retained latent clear', 0x1056cfcd, 0x1056cfd5,
         {0x1056cfcf: '?GetStateFrame@UObject@@QAEPAUFStateFrame@@XZ'}),
    ]
    blocks = []
    for label, lo, hi, sites in ranges:
        data = read(lo, hi - lo)
        instructions = list(image.dis.disasm(data, lo))
        cursor = lo
        for instruction in instructions:
            assert instruction.address == cursor
            cursor += instruction.size
        assert cursor == hi
        for va in sites:
            assert read(va, 6) == b'\x90' * 6
        block = {'label': label, 'startVA': hex(lo), 'endVAExclusive': hex(hi),
                 'bytes': len(data), 'ownedSHA256': hashlib.sha256(data).hexdigest(),
                 'instructionCount': len(instructions)}
        if candidate:
            block['correspondence'] = compare_call_block(
                data, candidate.read(lo, hi - lo), owned_va=lo, candidate_va=lo,
                sites=[(va - lo, ('core.dll', name)) for va, name in sites.items()],
                direct_calls=[i.address - lo for i in instructions
                              if i.mnemonic == 'call' and bytes(i.bytes)[:1] == b'\xe8'],
                imports=candidate.imports)
        blocks.append(block)
    size_return = None
    if candidate:
        assert candidate.body(symbol) == 0x10491c80
        from check_tutorial_quest_native import Image
        from check_player_transform_native import CORE_SHA
        core = Image(ROOT / 'assets/interlude/system/Core.dll', CORE_SHA)
        assert core.exported('?Size@FVector@@QBEMXZ', True) == 0x1010ca20
        core_anchors = [(0x1010ca3c, 'fstp', 'qword ptr [esp]'),
                        (0x1010ca3f, 'call', '0x10104840'),
                        (0x1010ca44, 'fstp', 'dword ptr [esp + 8]'),
                        (0x1010ca48, 'fld', 'dword ptr [esp + 8]'),
                        (0x1010ca4f, 'ret', '')]
        for anchor in core_anchors:
            core.instruction(*anchor)
        data = bytes(core.data[core.offset(0x1010ca20):core.offset(0x1010ca50)])
        size_return = {'coreSHA256': core.sha, 'bodyVA': '0x1010ca20', 'endVAExclusive': '0x1010ca50',
                       'bodySHA256': hashlib.sha256(data).hexdigest(), 'instructionAnchors': len(core_anchors),
                       'return': 'Float32 store/reload after the scalar helper call',
                       'limit': 'squared-sum/CRT/FPU arithmetic not evaluated; no Math.hypot equivalence'}
    return {'opcode': 0x47, 'format': 'ddddd', 'fields': ['id', 'x', 'y', 'z', 'heading'],
            'decoderBodyVA': '0x104287a0', 'registeredStubVA': hex(stub),
            'handlerBodyVA': '0x10491c80', 'handlerSlot': '0x288',
            'instructionAnchors': len(anchors), 'handlerStackAudit': stack,
            'heading': 'passed by decoder; no local handler read of entryESP+20',
            'order': 'AdjustPawnLocation before Controller virtual+0x320 StopMove',
            'handlerGuards': ['User/Pawn/Controller present', 'Controller+41c mask1 clear'],
            'correction': {'threshold': 200., 'comparison': 'strict-greater; equality/unordered exit',
                           'input': 'stored Float32 (Location-[0,0,CollisionHeight])-packetXYZ',
                           'helper': 'Core.FVector.Size' if candidate else 'erased; ABI alone cannot name it',
                           'guards': ['pre-clear Controller+424 count=0', 'not first viewport controller'],
                           'result': 'native cylinder trace/bias and FarMoveActor; not raw XYZ snap'},
            'selectedDirectEffects': ['queue+420 (Empty binding requires comparison)', 'target+42c', '+3f0', '+40c', 'Pawn.Acceleration+1e0',
                                     'StateFrame latent+28 (GetStateFrame binding requires comparison)',
                                     'current Controller/Pawn Rotation copied to their DesiredRotation',
                                     'Pawn+6e4 mask1; Controller/Pawn+2f8 mask4000; Pawn+88 mask1; Pawn+14e8 mask4'],
            'notDirectlyCleared': ['Pawn.Velocity', 'ordinary Destination+3f4 (camera branch excluded)'],
            'comparison': {'status': 'matched-finite-blocks' if candidate else 'not-supplied-erased-calls',
                           'engineSHA256': candidate.sha if candidate else None, 'blocks': blocks},
            'ownedSizeReturn': size_return,
            'limits': ['selected direct effects, not a full transitive callee/override census',
                       'no native zero-velocity or movement-to-Wait inference',
                       'browser feet/target are not native actor-origin/queue/viewport state',
                       'no collision solver, arbitrary physics or incoming packet ordering equivalence']}


def verify(comparison_engine=None):
    from check_tutorial_quest_native import Image, ENGINE_SHA
    from check_legacy_skill_effects_native import LinearX87
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
    stop_move = verify_stop_move(image, comparison_engine)
    return {'format':'elbera-grounding-evidence-v1','engineSHA256':image.sha,
            'enginePackageSHA256':hashlib.sha256(package_path.read_bytes()).hexdigest(),
            'playerClassTextSHA256':hashlib.sha256(player_source.encode('latin1')).hexdigest(),
            'instructionAnchors':len(anchors),'traceArithmeticCases':cases,
            'stopMove':stop_move,
            'changeMoveType':verify_change_move_environment(image),
            'methods':methods,'levelSlots':slots,'constants':constants,
            'viewportCorrection':'skip when Pawn.Controller equals first viewport actor',
            'moveToPawn':{'opcode':0x60,'packetFormat':'dddddd',
                          'distanceField':'Pawn+0x6c4 signed DWORD to Float32',
                          'localOriginCorrection':False,
                          'reachedResult':'clear acceleration and return true; do not choose target center',
                          'completeReachedPredicateVerified':False},
            'ranges':[{'name':n,'startRVA':hex(a),'endRVAExclusive':hex(b),
                       'SHA256':hashlib.sha256(image.data[a:b]).hexdigest()} for n,a,b in ranges],
            'limits':(['erased displacement helper'] if comparison_engine is None else
                      ['supplemental import correspondence is not runtime restoration or vendor authentication'])
                      + ['unnamed controller/state admission fields',
                      'native collision geometry and trace filters','FarMoveActor collision semantics',
                      'initial spawn retries and native actor/mesh origin integration',
                      'ReachedDestination erased type/vector helpers and additional height/collision gates']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true',help='verify original evidence; no receipt unless --output is supplied')
    parser.add_argument('--output',type=str)
    parser.add_argument('--comparison-engine',type=Path,
                        help='explicit pinned supplemental Engine.dll; binds three erased calls in exact blocks')
    args=parser.parse_args();report=verify(args.comparison_engine)
    if args.output:
        path=Path(args.output);path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(report,indent=2)+'\n')
    print('Verified %d grounding + %d StopMove + %d ChangeMoveType anchors, '
          'complete %d-instruction handler stack audit, %d trace-input cases; comparison: %s.' % (
        report['instructionAnchors'],report['stopMove']['instructionAnchors'],
        report['changeMoveType']['instructionAnchors'],
        report['stopMove']['handlerStackAudit']['reachableInstructions'],
        report['traceArithmeticCases'],report['stopMove']['comparison']['status']))


if __name__=='__main__':main()
