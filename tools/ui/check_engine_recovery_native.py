#!/usr/bin/env python3
"""Elbera Tools: bounded original Engine protector recovery audit.

Checks raw on-disk words independently of the shared decoder, recovers three
surviving startup transforms and decompresses the framed VM handler payload.
Everything stays in memory. This neither executes the client nor resolves its
virtualized import-repair program. A restricted, conditional integer trace
checks the first VM operation. No reconstructed DLL or handler bytes are
written or included in the result.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct


class WordTrace:
    """Restricted integer instruction slices with explicit memory and no calls.

    This is not a Windows or full x86 emulator. Missing memory, unsupported
    instructions and control flow outside declared regions stop the trace.
    """
    MASK = 0xffffffff
    ALIASES = {**{name[1:]: (name, 0, 16) for name in ('eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp', 'esp')},
               **{name[1]+'l': (name, 0, 8) for name in ('eax', 'ebx', 'ecx', 'edx')},
               **{name[1]+'h': (name, 8, 8) for name in ('eax', 'ebx', 'ecx', 'edx')}}

    def __init__(self, decode, ranges, read_memory, registers, direction=None):
        self.decode, self.ranges, self.read_memory = decode, ranges, read_memory
        self.reg = dict(registers)
        self.memory, self.writes, self.trace = {}, [], []
        self.flags = {}
        self.saved_flags = {}
        self.direction = direction

    def arithmetic_flags(self, op, a, b, width):
        mask, sign = (1 << width) - 1, 1 << (width - 1)
        a, b = a & mask, b & mask
        total = a + b if op == 'add' else a - b
        result = total & mask
        self.flags = {'z': result == 0, 's': bool(result & sign), 'p': bin(result & 255).count('1') % 2 == 0,
                      'c': total > mask if op == 'add' else a < b,
                      'o': bool((~(a ^ b) if op == 'add' else a ^ b) & (a ^ result) & sign)}
        return result

    def logical_flags(self, value, width):
        self.flags = {'z': value == 0, 's': bool(value & (1 << (width - 1))),
                      'p': bin(value & 255).count('1') % 2 == 0, 'c': False, 'o': False}

    def address(self, operand):
        match = re.fullmatch(r'(?:(?:byte|word|dword) ptr )?\[([^]]+)\]', operand)
        if not match:
            raise ValueError('unsupported address: ' + operand)
        total = 0
        for term in re.findall(r'[+-]?[^+-]+', match[1].replace(' ', '')):
            sign = -1 if term.startswith('-') else 1
            parts = term.lstrip('+-').split('*')
            if len(parts) > 2:
                raise ValueError('unsupported address product')
            value = self.read(parts[0])
            if len(parts) == 2:
                value *= int(parts[1], 0)
            total += sign * value
        return total & self.MASK

    def width(self, operand):
        if operand in self.ALIASES:
            return self.ALIASES[operand][2]
        return 8 if operand.startswith('byte ptr') else 16 if operand.startswith('word ptr') else 32

    def read(self, operand):
        if '[' in operand:
            at, size = self.address(operand), self.width(operand) // 8
            if any(at < saved + 4 and saved < at + size for saved in self.saved_flags):
                raise ValueError('opaque flags cannot be read as an integer')
            values = [self.memory[at+i] if at+i in self.memory else self.read_memory(at+i, 1) for i in range(size)]
            return int.from_bytes(bytes(values), 'little')
        if operand in self.reg:
            return self.reg[operand] & self.MASK
        if operand in self.ALIASES:
            parent, shift, width = self.ALIASES[operand]
            return (self.reg[parent] >> shift) & ((1 << width) - 1)
        try:
            return int(operand, 0) & self.MASK
        except ValueError:
            raise ValueError('unsupported operand: ' + operand) from None

    def write(self, operand, value):
        width = self.width(operand)
        value &= (1 << width) - 1
        if '[' in operand:
            at = self.address(operand)
            for saved in list(self.saved_flags):
                if at < saved + 4 and saved < at + width // 8:
                    del self.saved_flags[saved]
            for index, byte in enumerate(value.to_bytes(width // 8, 'little')):
                self.memory[at+index] = byte
            self.writes.append((at, width // 8, value))
        elif operand in self.reg:
            self.reg[operand] = value
        elif operand in self.ALIASES:
            parent, shift, width = self.ALIASES[operand]
            mask = ((1 << width) - 1) << shift
            self.reg[parent] = (self.reg[parent] & ~mask) | (value << shift)
        else:
            raise ValueError('unsupported destination: ' + operand)

    def run(self, start, stops=(), limit=10000):
        pc = start
        for _ in range(limit):
            if pc in stops:
                return pc
            if not any(a <= pc < b for a, b in self.ranges):
                raise ValueError('instruction trace left declared region: ' + hex(pc))
            instruction = self.decode(pc)
            if not any(a <= pc and pc + instruction.size <= b for a, b in self.ranges):
                raise ValueError('instruction crosses declared region')
            self.trace.append(pc)
            op, args = instruction.mnemonic, instruction.op_str.split(', ')
            nxt = pc + instruction.size
            if op == 'mov':
                self.write(args[0], self.read(args[1]))
            elif op in ('movzx', 'movsx'):
                value, width = self.read(args[1]), self.width(args[1])
                if op == 'movsx' and value & (1 << (width - 1)):
                    value -= 1 << width
                self.write(args[0], value)
            elif op == 'lea':
                self.write(args[0], self.address(args[1]))
            elif op in ('cld', 'std'):
                self.direction = 1 if op == 'cld' else -1
            elif op == 'movsd' and instruction.op_str == 'dword ptr es:[edi], dword ptr [esi]':
                if self.direction not in (-1, 1):
                    raise ValueError('unknown string direction flag')
                self.write('dword ptr [edi]', self.read('dword ptr [esi]'))
                self.reg['esi'] = (self.reg['esi'] + 4 * self.direction) & self.MASK
                self.reg['edi'] = (self.reg['edi'] + 4 * self.direction) & self.MASK
            elif op == 'rep movsb' and instruction.op_str == 'byte ptr es:[edi], byte ptr [esi]':
                if self.direction not in (-1, 1) or self.reg['ecx'] > 4096:
                    raise ValueError('unbounded string copy')
                for _ in range(self.reg['ecx']):
                    self.write('byte ptr [edi]', self.read('byte ptr [esi]'))
                    self.reg['esi'] = (self.reg['esi'] + self.direction) & self.MASK
                    self.reg['edi'] = (self.reg['edi'] + self.direction) & self.MASK
                self.reg['ecx'] = 0
            elif op == 'push':
                value = self.read(args[0])
                self.reg['esp'] = (self.reg['esp'] - 4) & self.MASK
                self.write('dword ptr [esp]', value)
            elif op == 'pop':
                value = self.read('dword ptr [esp]')
                self.reg['esp'] = (self.reg['esp'] + 4) & self.MASK
                self.write(args[0], value)
            elif op == 'pushfd':
                self.reg['esp'] = (self.reg['esp'] - 4) & self.MASK
                for at in range(self.reg['esp'], self.reg['esp'] + 4):
                    self.memory.pop(at, None)
                self.saved_flags[self.reg['esp']] = (dict(self.flags), self.direction)
            elif op == 'popfd':
                if self.reg['esp'] not in self.saved_flags:
                    raise ValueError('unmodeled flags source')
                self.flags, self.direction = self.saved_flags.pop(self.reg['esp'])
                self.reg['esp'] = (self.reg['esp'] + 4) & self.MASK
            elif op == 'xchg':
                a, b = map(self.read, args)
                # The declared slices do not exchange a memory address with its
                # own base register; reject that shape rather than order-guess.
                if '[' in args[0] and args[1] in args[0] or '[' in args[1] and args[0] in args[1]:
                    raise ValueError('aliasing xchg address is unsupported')
                self.write(args[0], b)
                self.write(args[1], a)
            elif op in ('add', 'sub', 'xor', 'and', 'or', 'cmp', 'test'):
                a, b = map(self.read, args)
                if op in ('add', 'sub', 'cmp'):
                    value = self.arithmetic_flags('sub' if op == 'cmp' else op, a, b, self.width(args[0]))
                else:
                    value = {'xor': a^b, 'and': a&b, 'or': a|b, 'test': a&b}[op]
                    value &= (1 << self.width(args[0])) - 1
                    self.logical_flags(value, self.width(args[0]))
                if op not in ('cmp', 'test'):
                    self.write(args[0], value)
            elif op in ('inc', 'dec', 'neg', 'not'):
                value = self.read(args[0])
                carry = self.flags.get('c')
                if op == 'not': result = ~value
                elif op == 'neg': result = self.arithmetic_flags('sub', 0, value, self.width(args[0]))
                else:
                    result = self.arithmetic_flags('add' if op == 'inc' else 'sub', value, 1, self.width(args[0]))
                    self.flags['c'] = carry
                self.write(args[0], result)
            elif op in ('shl', 'shr'):
                value, count = map(self.read, args)
                count, width = count & 31, self.width(args[0])
                result = (value << count if op == 'shl' else value >> count) & ((1 << width) - 1)
                if count:
                    self.logical_flags(result, width)
                    self.flags['c'] = bool(value & (1 << (width-count if op == 'shl' else count-1))) if count < width else None
                    self.flags['o'] = (bool(result & (1 << (width-1))) ^ self.flags['c'] if op == 'shl'
                                       else bool(value & (1 << (width-1)))) if count == 1 else None
                self.write(args[0], result)
            elif op in ('rol', 'ror'):
                value, count = map(self.read, args)
                width = self.width(args[0])
                count = (count & 31) % width
                if count:
                    mask = (1 << width) - 1
                    result = ((value << count) | (value >> (width-count))) & mask if op == 'rol' else (
                        (value >> count) | (value << (width-count))) & mask
                    self.flags['c'] = bool(result & (1 if op == 'rol' else 1 << (width-1)))
                    self.flags['o'] = (bool(result & (1 << (width-1))) ^ (
                        self.flags['c'] if op == 'rol' else bool(result & (1 << (width-2))))) if count == 1 else None
                    self.write(args[0], result)
            elif op == 'imul' and len(args) in (2, 3):
                width = self.width(args[0])
                mask, sign = (1 << width) - 1, 1 << (width - 1)
                def signed(value):
                    value &= mask
                    return value - (1 << width) if value & sign else value
                a, b = (map(self.read, args[1:]) if len(args) == 3 else map(self.read, args))
                value = signed(a) * signed(b)
                overflow = value != signed(value)
                self.flags = {'c': overflow, 'o': overflow}
                self.write(args[0], value)
            elif op == 'jmp':
                nxt = self.read(args[0])
            elif op in ('je', 'jne', 'jb', 'jae', 'jbe', 'ja', 'js', 'jns', 'jp', 'jnp', 'jl', 'jge', 'jle', 'jg'):
                def flag(name):
                    if self.flags.get(name) is None:
                        raise ValueError('undefined branch flag: ' + name)
                    return self.flags[name]
                conditions = {'je': lambda: flag('z'), 'jne': lambda: not flag('z'),
                              'jb': lambda: flag('c'), 'jae': lambda: not flag('c'),
                              'jbe': lambda: flag('c') or flag('z'), 'ja': lambda: not flag('c') and not flag('z'),
                              'js': lambda: flag('s'), 'jns': lambda: not flag('s'),
                              'jp': lambda: flag('p'), 'jnp': lambda: not flag('p'),
                              'jl': lambda: flag('s') != flag('o'), 'jge': lambda: flag('s') == flag('o'),
                              'jle': lambda: flag('z') or flag('s') != flag('o'),
                              'jg': lambda: not flag('z') and flag('s') == flag('o')}
                if conditions[op]():
                    nxt = self.read(args[0])
            else:
                raise ValueError('unmodeled instruction at ' + hex(pc) + ': ' + op + ' ' + instruction.op_str)
            pc = nxt
        raise ValueError('instruction trace step limit')


def decompress_handlers(data, expected, max_output=2 * 1024 * 1024):
    """Bounded translation of original RVA1aa2887..1aa2a34 bitstream reader.

    Returns bytes and consumed input length. Output/header agreement is checked
    at the native terminator. Backreferences deliberately allow overlap.
    """
    if not isinstance(expected, int) or isinstance(expected, bool) or not 0 < expected <= max_output:
        raise ValueError('unsupported output size')
    pos, tag, last, mode = 0, 0x80, None, 2
    out = bytearray()

    def byte():
        nonlocal pos
        if pos >= len(data):
            raise ValueError('truncated handler stream')
        value = data[pos]
        pos += 1
        return value

    def bit():
        nonlocal tag
        carry, tag = tag >> 7, (tag << 1) & 255
        if not tag:
            value = byte()
            tag, carry = ((value << 1) + carry) & 255, value >> 7
        return carry

    def gamma():
        value = 1
        for _ in range(32):
            value = value * 2 + bit()
            if not bit():
                return value
        raise ValueError('handler stream integer overflow')

    def copy(offset, count):
        if offset is None or not 0 < offset <= len(out) or len(out) + count > expected:
            raise ValueError('invalid handler backreference')
        for _ in range(count):
            out.append(out[-offset])

    out.append(byte())
    # Every nonterminal command emits at least one byte, so the output limit
    # also bounds the number of commands without an arbitrary timeout.
    for _ in range(expected + 1):
        if not bit():
            out.append(byte())
            mode = 2
        elif not bit():
            offset = gamma() - mode
            mode = 1
            if not offset:
                copy(last, gamma())
            else:
                offset = ((offset - 1) << 8) + byte()
                last, count = offset, gamma()
                if offset >= 0x7d00:
                    count += 2
                elif offset >= 0x500:
                    count += 1
                elif offset <= 0x7f:
                    count += 2
                copy(offset, count)
        elif not bit():
            value = byte()
            offset = value >> 1
            if not offset:
                if len(out) != expected:
                    raise ValueError('handler output/header mismatch')
                return bytes(out), pos
            copy(offset, 2 + (value & 1))
            last, mode = offset, 1
        else:
            offset = 0
            for _ in range(4):
                offset = offset * 2 + bit()
            if offset:
                copy(offset, 1)
            else:
                out.append(0)
            mode = 2
        if len(out) > expected:
            raise ValueError('handler output overflow')
    raise ValueError('unterminated handler stream')


def vm_program_boundary(image, handler_records):
    """Static framing only; does not interpret VM instructions or repair imports."""
    anchors = [
        (0x1b4c8d5, 'jmp', '0x11e4e1e2'), (0x1b4e1e2, 'mov', 'eax, 0x8d02caf'),
        (0x1b4e1e7, 'add', 'eax, ebp'), (0x1b4e1e9, 'jmp', 'eax'),
        (0x1b4dd02, 'push', '0x45599378'), (0x1b4dd38, 'jmp', '0x11e4c8da'),
        (0x1b4c8de, 'call', '0x11e4c8e3'), (0x1b4c8e3, 'pop', 'ebp'),
        (0x1b4c8e4, 'sub', 'ebp, 0x8d018cf'),
        (0x1b4c8ea, 'mov', 'eax, 0x8d03162'), (0x1b4c8ef, 'add', 'eax, ebp'),
        (0x1b4c919, 'mov', 'dword ptr [esi + 0x62c], eax'),
        (0x1b4c92a, 'mov', 'dword ptr [esp + 0x24], 0x8c57a2e'),
        (0x1b4c932, 'add', 'dword ptr [esp + 0x24], ebp'),
        (0x1aa2adb, 'mov', 'esi, dword ptr [ebp + 0x8c52df1]'),
        (0x1aa2ae1, 'mov', 'edi, dword ptr [esi + 0x62c]'),
        (0x1aa2ae7, 'mov', 'eax, dword ptr [edi]'), (0x1aa2ae9, 'add', 'eax, ebp'),
        (0x1aa2aeb, 'mov', 'dword ptr [esi + 0x37c], eax'),
        (0x1aa2af1, 'add', 'eax, dword ptr [edi + 4]'),
        (0x1aa2af4, 'mov', 'dword ptr [esi + 0x3d4], eax'),
        (0x1aa2afa, 'mov', 'eax, dword ptr [esp + 0x24]'),
        (0x1aa2b04, 'add', 'esi, 8'), (0x1aa2b0c, 'add', 'esi, 0xc'),
        (0x1aa2b0f, 'cmp', 'dword ptr [esi], eax'), (0x1aa2b11, 'jne', '0x11da2b0c'),
        (0x1aa2b17, 'mov', 'eax, dword ptr [esi + 4]'), (0x1aa2b1a, 'add', 'eax, ebp'),
        (0x1aa2b22, 'mov', 'dword ptr [edi + 0x5e8], eax'),
        (0x1aa2b34, 'jmp', 'dword ptr [edi + 0x39c]'),
        (0x1aa2ad1, 'mov', 'dword ptr [esi + 0x3b8], 0xf0000000'),
        (0x1b4c67f, 'mov', 'eax, dword ptr [esi + 8]'),
        (0x1b4c68a, 'add', 'edx, eax'), (0x1b4c68c, 'mov', 'ecx, 0x12b'),
        (0x1b4c691, 'mov', 'esi, edx'), (0x1b4c699, 'add', 'edi, 0x7d0'),
        (0x1b4c69f, 'rep movsb', 'byte ptr es:[edi], byte ptr [esi]'),
        (0x1b4c6ad, 'add', 'eax, 0x7d0'), (0x1b4c6b2, 'mov', 'dword ptr [esi + 0x39c], eax'),
        (0x1b4c6ca, 'mov', 'dword ptr [esi + 0x528], eax'),
        (0x1b4c6d0, 'lea', 'eax, [esi + 0x74]'),
        (0x1b4c6d3, 'mov', 'dword ptr [esi + 0x524], eax'),
        (0x1b4c6eb, 'mov', 'dword ptr [esi + 0x608], eax'),
    ]
    for rva, mnemonic, operands in anchors:
        image.instruction(image.base + rva, mnemonic, operands)
    bias = image.base + 0x1b4c8e3 - 0x8d018cf
    assert bias == image.base + 0x1a9e53f - 0x8c5352b
    table = bias + 0x8d03162 - image.base
    program, size = struct.unpack_from('<II', image.data, table)
    program += bias - image.base
    assert (table, program, size) == (0x1b4e176, 0x1b4c940, 0x1383)
    entries = []
    for index in range(8):
        token, code, thunk = struct.unpack_from('<3I', image.data, table + 8 + index * 12)
        code, thunk = code + bias - image.base, thunk + bias - image.base
        assert program <= code < program + size <= thunk < table
        entries.append({'token': hex(token), 'bytecodeRVA': hex(code), 'nativeThunkRVA': hex(thunk)})
    assert len({entry['token'] for entry in entries}) == 8
    assert entries[0] == {'token': '0x45599378', 'bytecodeRVA': '0x1b4c940', 'nativeThunkRVA': '0x1b4dcc3'}
    assert struct.unpack_from('<I', image.data, table + 8 + 8 * 12)[0] == 0xffffffff
    # Dispatcher bytes are appended after the exact compressed-handler span.
    dispatcher = 0x1aa3292 + 692566
    assert dispatcher == 0x1b4c3e8
    first_selector = image.data[program] & 0x7f
    initial = [row[2] for row in handler_records if row[4] == first_selector]
    assert first_selector == 0 and initial == [0]
    return {'instructionAnchors': len(anchors), 'programTableRVA': hex(table),
            'programStartRVA': hex(program), 'programBytes': size,
            'programSHA256': hashlib.sha256(image.data[program:program+size]).hexdigest(),
            'entryTable': entries, 'virtualIPContextOffset': '0x5e8',
            'dispatcherSourceRVA': hex(dispatcher), 'dispatcherBytes': 0x12b,
            'dispatcherSHA256': hashlib.sha256(image.data[dispatcher:dispatcher+0x12b]).hexdigest(),
            'initialHandlerOffsetCandidate': initial[0],
            'limits': ['Table/header and native bridge are pinned; program instructions are not interpreted.',
                       'Low-seven-bit dispatch simplification is a static arithmetic observation, not a VM execution result.',
                       'No entry is identified as import repair, and native-thunk row fields are not assumed return addresses.']}


def first_entry_slice(image, handlers, records):
    """Conditional original-instruction trace of the first handler body prefix.

    Addresses and captured register values below are synthetic test inputs,
    not recovered runtime state. No unknown memory is filled with zeroes.
    """
    context, code, stack = 0x20000000, 0x30000000, 0x40010000
    table1, table2 = 0x21000000, 0x21001000
    selected = [row[2] for row in records if row[:2] == (54, 2)]
    assert selected == [937224]
    stop = code + 0x60b56  # Immediately after the original REP MOVSB.
    def decode(address):
        return next(image.dis.disasm(handlers[address-code:address-code+16], address))
    def memory(address, size):
        at = address - image.base
        if not 0 <= at <= len(image.data) - size:
            raise ValueError('missing trace memory at ' + hex(address))
        return int.from_bytes(image.data[at:at+size], 'little')
    results = []
    for seed in (0x12340000, 0x76543210, 0xffffffff):
        registers = {name: (seed + i) & 0xffffffff for i, name in enumerate(
            ('eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp', 'esp'))}
        registers.update(edi=context, esp=stack, ebp=0x0914b014)
        trace = WordTrace(decode, [(code, code+len(handlers))], memory, registers, direction=1)
        fields = {0x5e8: image.base+0x1b4c940, 0x39c: context+0x7d0,
                  0x608: code, 0x528: table1, 0x3b8: 0xf0000000, 0x524: context+0x74}
        for offset, value in fields.items():
            trace.write(f'dword ptr [{context+offset:#x}]', value)
        bank = [((seed ^ (i * 0x01020307)) & 0xffffffff) for i in range(28)]
        for i, value in enumerate(bank):
            trace.write(f'dword ptr [{context+0x74+i*4:#x}]', value)
        for row in range(63):
            trace.write(f'dword ptr [{table1+row*4:#x}]', table2+row*12)
        for row, column, offset, _, _ in records:
            trace.write(f'dword ptr [{table2+row*12+column*4:#x}]', code+offset)
        trace.writes.clear()
        # Separate decoder from selected handler: no register-bank read is
        # needed to determine this first instruction's class and variant.
        assert trace.run(code, {code+selected[0]}) == code+selected[0]
        decoder_steps = len(trace.trace)
        get = lambda off: trace.read(f'dword ptr [{context+off:#x}]')
        assert (get(0x5e8)-image.base, get(0x3fc), get(0x368)) == (0x1b4c94f, 54, 2)
        assert trace.run(code+selected[0], {stop}) == stop
        result = [get(0x74+i*4) for i in range(28)]
        assert result == bank[-6:] + bank[:-6]
        assert get(0x3b8) == 0xf0000018
        assert get(0x5e8) == image.base+0x1b4c94f
        # Every write is to modeled VM context or bounded scratch stack.
        assert all((context <= address and address+size <= context+0x800) or
                   (stack-0x1000 <= address and address+size <= stack)
                   for address, size, _ in trace.writes)
        results.append({'decoderInstructions': decoder_steps, 'totalInstructions': len(trace.trace)})
    assert results[0] == results[1] == results[2]
    return {'cases': len(results), **results[0], 'programStartRVA': '0x1b4c940',
            'nextVirtualIPRVA': '0x1b4c94f', 'instructionBytes': 15,
            'handlerClass': 54, 'handlerVariant': 2, 'handlerPayloadOffset': hex(selected[0]),
            'stoppedAfterPayloadOffset': '0x60b54',
            'observedBodyPrefix': 'virtual stack +24; rotate 28-dword register bank right by 6 dwords',
            'imageWrites': 0, 'nativeCalls': 0,
            'limits': ['Captured registers, allocated addresses and initial direction flag are supplied test inputs, not a native process snapshot.',
                       'Only the first decoded handler body prefix is interpreted, ending immediately after its register-bank copy before return to dispatch.',
                       'No entry is identified as import repair; later operations, external state and target bindings remain unresolved.']}


def verify():
    from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA
    path = ROOT / 'assets/interlude/system/engine.dll'
    raw = path.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == ENGINE_SHA
    image = Image(path, ENGINE_SHA, True)
    key = 0x7965b551
    pe = struct.unpack_from('<I', raw, 60)[0]
    optional = pe + 24
    section = optional + struct.unpack_from('<H', raw, pe + 20)[0]
    virtual_size, rva, size, offset = struct.unpack_from('<4I', raw, section + 8)
    assert (virtual_size, rva, size, offset) == (0x1a98000, 0x1000, 0x1a98000, 0x1000)
    sites = [0x3b643d, 0x3b6468, 0x3b6493, 0x1ec8f2, 0x1ec902]
    for site in sites:
        start, stop = site & ~3, (site + 9) & ~3
        words = struct.unpack('<' + 'I' * ((stop - start) // 4), raw[start:stop])
        independent = b''.join(((word - key) & 0xffffffff).to_bytes(4, 'little') for word in words)
        assert independent == image.data[start:stop]
        assert independent[site-start:site-start+6] == b'\x90' * 6
        roundtrip = b''.join(((word + key) & 0xffffffff).to_bytes(4, 'little')
                             for (word,) in struct.iter_unpack('<I', independent))
        assert roundtrip == raw[start:stop]
    # Read ordinary PE metadata directly from raw bytes, without Image recovery.
    descriptor, descriptor_size = struct.unpack_from('<II', raw, optional + 104)
    assert (descriptor, descriptor_size) == (0x1a9a014, 0x3c)
    imports = []
    while True:
        original_thunk, _, _, name_rva, thunk = struct.unpack_from('<5I', raw, descriptor)
        if not name_rva:
            break
        name = raw[name_rva:raw.index(0, name_rva)].decode('ascii')
        functions = []
        for slot in range(16):
            value = struct.unpack_from('<I', raw, (original_thunk or thunk) + slot * 4)[0]
            if not value:
                break
            assert not value & 0x80000000
            functions.append(raw[value+2:raw.index(0, value+2)].decode('ascii'))
        imports.append({'dll': name, 'functions': functions})
        descriptor += 20
    assert imports == [{'dll': 'KERNEL32.dll', 'functions': ['CreateFileA', 'ExitProcess']},
                       {'dll': 'COMCTL32.dll', 'functions': ['InitCommonControls']}]
    assert struct.unpack_from('<II', raw, optional + 136) == (0x1a9a100, 8)
    assert struct.unpack_from('<II', raw, 0x1a9a100) == (0, 8)
    assert struct.unpack_from('<I', raw, optional + 16)[0] == 0x1a9b014
    first = [(0x1a9b014, 'jmp', '0x11d9e535'),
             (0x1a9e53a, 'call', '0x11d9e53f'), (0x1a9e53f, 'pop', 'ebp'),
             (0x1a9e540, 'sub', 'ebp, 0x8c5352b'),
             (0x1a9e7ab, 'mov', 'ecx, 0x7000'),
             (0x1a9e7b0, 'lea', 'edi, [ebp + 0x8c537a8]'),
             (0x1a9e7b6, 'dec', 'byte ptr [edi]'), (0x1a9e7b8, 'inc', 'edi'),
             (0x1a9e7b9, 'dec', 'ecx'), (0x1a9e7ba, 'jne', '0x11d9e7b6')]
    anchors = 0
    def check(rows):
        nonlocal anchors
        for address, mnemonic, operands in rows:
            image.instruction(image.base + address, mnemonic, operands)
            anchors += 1
    check(first)
    assert 0x11d9e53f - 0x8c5352b + 0x8c537a8 == image.base + 0x1a9e7bc
    image.data[0x1a9e7bc:0x1aa57bc] = bytes((value - 1) & 255 for value in image.data[0x1a9e7bc:0x1aa57bc])
    check([(0x1a9e98e, 'call', '0x11d9e99f'), (0x1a9e9a1, 'pop', 'eax'),
           (0x1a9e9a5, 'add', 'eax, 0x5934'), (0x1a9e9b7, 'pop', 'ecx'),
           (0x1a9e9b9, 'push', 'dword ptr [ecx + eax]'), (0x1a9e9c9, 'pop', 'edx'),
           (0x1a9e9ca, 'sub', 'edx, 0x4c903eb9'), (0x1a9e9d0, 'xor', 'edx, 0xafacf0b'),
           (0x1a9e9db, 'sub', 'edx, 0x17959be1'), (0x1a9e9e1, 'push', 'edx'),
           (0x1a9e9e4, 'pop', 'dword ptr [eax + ecx]'), (0x1a9e9eb, 'sub', 'ecx, 4'),
           (0x1a9e9f3, 'cmp', 'ecx, 0xffffa740'), (0x1a9e9f9, 'jne', '0x11d9e9b9')])
    for rel in range(0, -0x58c0, -4):
        at = 0x1a9e993 + 0x5934 + rel
        value = struct.unpack_from('<I', image.data, at)[0]
        value = (((value - 0x4c903eb9) & 0xffffffff) ^ 0xafacf0b) - 0x17959be1
        struct.pack_into('<I', image.data, at, value & 0xffffffff)
    check([(0x1a9ea0b, 'jmp', '0x11d9f0ca'),
           (0x1a9f11c, 'call', '0x11d9f128'), (0x1a9f12e, 'pop', 'ebx'),
           (0x1a9f135, 'add', 'ebx, 0x6431'), (0x1a9f141, 'xor', 'ecx, ecx'),
           (0x1a9f149, 'mov', 'esi, dword ptr [ebx + ecx]'),
           (0x1a9f152, 'add', 'esi, 0x33efaacb'), (0x1a9f158, 'sub', 'esi, 0x3fbb16ac'),
           (0x1a9f164, 'add', 'esi, 0x5b4a5ce1'), (0x1a9f16f, 'push', 'esi'),
           (0x1a9f176, 'pop', 'dword ptr [ebx + ecx]'), (0x1a9f17b, 'sub', 'ecx, 4'),
           (0x1a9f181, 'cmp', 'ecx, 0xffff9c60'), (0x1a9f187, 'jne', '0x11d9f1a4'),
           (0x1a9f1aa, 'jmp', '0x11d9f149')])
    for rel in range(0, -0x63a0, -4):
        at = 0x1a9f121 + 0x6431 + rel
        value = struct.unpack_from('<I', image.data, at)[0]
        value += 0x33efaacb - 0x3fbb16ac + 0x5b4a5ce1
        struct.pack_into('<I', image.data, at, value & 0xffffffff)
    check([(0x1aa2891, 'mov', 'dl, 0x80'), (0x1aa2899, 'mov', 'ebx, 2'),
           (0x1aa28a9, 'adc', 'dl, dl'), (0x1aa2955, 'sub', 'eax, ebx'),
           (0x1aa2957, 'mov', 'ebx, 1'), (0x1aa298c, 'sub', 'esi, ebp'),
           (0x1aa298e, 'rep movsb', 'byte ptr es:[edi], byte ptr [esi]'),
           (0x1aa299d, 'mov', 'ebp, eax'), (0x1aa29c6, 'cmp', 'eax, 0x7d00'),
           (0x1aa29d1, 'cmp', 'eax, 0x500'), (0x1aa29ea, 'cmp', 'eax, 0x7f'),
           (0x1aa29f3, 'add', 'ecx, 2'), (0x1aa2a08, 'shr', 'al, 1'),
           (0x1aa2a0b, 'je', '0x11da2a28'), (0x1aa2a11, 'adc', 'ecx, 2'),
           (0x1aa2a31, 'ret', '8'),
           (0x1b4c59f, 'add', 'esi, 4'), (0x1b4c5a2, 'mov', 'ecx, dword ptr [esi]'),
           (0x1b4c5a6, 'imul', 'edx, edx, 0xb'), (0x1b4c5a9, 'add', 'esi, 0xc'),
           (0x1b4c5ac, 'add', 'edx, esi'), (0x1b4c5c0, 'push', 'edx'),
           (0x1b4c5c1, 'lea', 'eax, [ebp + 0x8c57873]'), (0x1b4c5c7, 'call', 'eax'),
           (0x1b4c612, 'movzx', 'eax, byte ptr [esi]'),
           (0x1b4c61c, 'movzx', 'eax, byte ptr [esi + 1]'),
           (0x1b4c62b, 'add', 'eax, dword ptr [esi + 2]'),
           (0x1b4c62e, 'mov', 'dword ptr [edi], eax'),
           (0x1b4c647, 'add', 'esi, 0xb'),
           (0x1b4c73f, 'shl', 'ebx, 2'), (0x1b4c748, 'mov', 'dword ptr [ebx], eax')])
    header = 0x1aa2c10
    allocated, count, expected, packed_size = struct.unpack_from('<4I', image.data, header)
    assert (allocated, count, expected, packed_size) == (0, 150, 983624, 692566)
    packed_start = header + 16 + count * 11
    packed = image.data[packed_start:packed_start + packed_size]
    handlers, consumed = decompress_handlers(packed, expected)
    assert consumed == packed_size
    handler_sha = hashlib.sha256(handlers).hexdigest()
    assert handler_sha == '0684bfb06e55ddc00872d5110680b7eb86e8f59ecc804f32fcde4d82fdc6ec19'
    records = [struct.unpack_from('<BBIIB', image.data, header + 16 + i * 11) for i in range(count)]
    assert all(row[0] < 0x3f and row[1] < 3 and row[2] < len(handlers) for row in records)
    assert len(set((row[0], row[1]) for row in records)) == count
    # Record +6 is intentionally not named or interpreted as a byte length.
    references = {hex(site): {kind: {form: data.count(struct.pack('<I', value))
                                    for form, value in [('rva', site), ('va', image.base + site), ('sectionOffset', site - 0x1000)]}
                             for kind, data in [('raw', raw), ('recovered', image.data), ('handlers', handlers)]}
                  for site in sites}
    assert all(not n for site in references.values() for version in site.values() for n in version.values())
    return {'engineSHA256': image.sha, 'instructionAnchors': anchors,
            'independentRawRoundTrips': len(sites), 'nopSiteRVAs': list(map(hex, sites)),
            'ordinaryImports': imports, 'ordinaryRelocationEntries': 0,
            'startupLayers': 3, 'handlerTableRVA': hex(header), 'handlerRecords': count,
            'uniqueHandlerSlots': len(set((row[0], row[1]) for row in records)),
            'compressedRVA': hex(packed_start), 'compressedBytes': consumed,
            'handlerBytes': len(handlers), 'handlerSHA256': handler_sha,
            'vmProgramBoundary': vm_program_boundary(image, records),
            'firstEntrySlice': first_entry_slice(image, handlers, records),
            'plainTargetReferences': references, 'resolvedTargets': {},
            'limits': ['Raw-file identity is pinned to the owned copy; vendor-original provenance is not independently authenticated.',
                       'The shared decoder does not remove these calls; exact runtime repair mechanism and targets remain unproved.',
                       'Only a conditional first-operation integer slice is interpreted; no native code or import restoration is executed.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='print only the verification summary')
    parser.add_argument('--output', type=Path, help='write the metadata report, preferably under ignored tmp/')
    args = parser.parse_args()
    report = verify()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n')
    if args.check:
        total = report['instructionAnchors'] + report['vmProgramBoundary']['instructionAnchors']
        print(f"Elbera Tools: {total} native anchors, {report['independentRawRoundTrips']} raw round trips, "
              f"{report['startupLayers']} startup layers, {report['handlerRecords']} handler slots, "
              f"{len(report['vmProgramBoundary']['entryTable'])} VM entries, "
              f"{report['firstEntrySlice']['cases']} first-operation traces verified; import targets unresolved.")
    elif not args.output:
        print(json.dumps(report, indent=2))
