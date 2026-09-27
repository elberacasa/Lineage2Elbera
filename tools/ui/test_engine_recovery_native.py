"""Elbera Tools source-free handler reader and restricted integer trace cases."""
from types import SimpleNamespace
import unittest

from check_engine_recovery_native import WordTrace, decompress_handlers


class Stream:
    """Write command bits interleaved with literals; no production reader reuse."""
    def __init__(self, first=65):
        self.data = bytearray([first])
        self.bits_left = 0

    def bits(self, values):
        for value in values:
            if not self.bits_left:
                self.tag = len(self.data)
                self.data.append(0)
                self.bits_left = 8
            self.bits_left -= 1
            self.data[self.tag] |= int(value) << self.bits_left
        return self

    def byte(self, value):
        self.data.append(value)
        return self

    def literal(self, value):
        return self.bits('0').byte(value)

    def gamma(self, value):
        digits = bin(value)[3:]
        assert digits
        for index, digit in enumerate(digits):
            self.bits(digit + ('1' if index < len(digits) - 1 else '0'))
        return self

    def end(self):
        return bytes(self.bits('110').byte(0).data)


class HandlerStreamTests(unittest.TestCase):
    def test_literals_and_consumed_length(self):
        data = Stream().literal(66).literal(67).end()
        out, consumed = decompress_handlers(data + b'not-consumed', 3)
        self.assertEqual(out, b'ABC')
        self.assertEqual(consumed, len(data))

    def test_short_match_copies_overlapping_output(self):
        data = Stream().bits('110').byte(3).end()  # Offset1, length3.
        self.assertEqual(decompress_handlers(data, 4)[0], b'AAAA')

    def test_four_bit_match_and_zero_literal(self):
        data = Stream().literal(66).literal(67).bits('1110011').bits('1110000').end()
        self.assertEqual(decompress_handlers(data, 5)[0], b'ABCA\0')

    def test_repeat_last_offset_survives_literal_mode_change(self):
        data = Stream().bits('110').byte(2).literal(88).bits('10').gamma(2).gamma(4).end()
        self.assertEqual(decompress_handlers(data, 8)[0], b'AAAXXXXX')

    def test_long_match_length_thresholds(self):
        for offset, extra in [(127, 2), (128, 0), (1279, 0), (1280, 1), (31999, 1), (32000, 2)]:
            with self.subTest(offset=offset):
                prefix = bytes((n * 17) % 251 for n in range(offset))
                writer = Stream(prefix[0])
                for value in prefix[1:]:
                    writer.literal(value)
                # Literal mode=2; high offset uses gamma=(offset>>8)+3.
                data = writer.bits('10').gamma((offset >> 8) + 3).byte(offset & 255).gamma(2).end()
                count = 2 + extra
                self.assertEqual(decompress_handlers(data, offset + count)[0], prefix + prefix[:count])

    def test_truncation_and_missing_terminator_fail(self):
        data = Stream().literal(66).literal(67).end()
        for length in range(len(data)):
            with self.subTest(length=length), self.assertRaises(ValueError):
                decompress_handlers(data[:length], 3)

    def test_invalid_backreference_and_unset_previous_offset_fail(self):
        for data in (Stream().bits('110').byte(6).end(),
                     Stream().bits('10').gamma(2).gamma(2).end(),
                     Stream().bits('1111111').end()):
            with self.assertRaisesRegex(ValueError, 'backreference'):
                decompress_handlers(data, 10)

    def test_output_header_and_limits_fail_closed(self):
        data = Stream().end()
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            decompress_handlers(data, 2)
        with self.assertRaises(ValueError):
            decompress_handlers(Stream().literal(66).end(), 1)
        for size in (0, -1, True, 2.5, 2097153):
            with self.assertRaises(ValueError):
                decompress_handlers(data, size)


class WordTraceTests(unittest.TestCase):
    def machine(self, instructions):
        code = {i: SimpleNamespace(mnemonic=op, op_str=args, size=1)
                for i, (op, args) in enumerate(instructions)}
        def missing(address, size):
            raise ValueError('missing memory')
        registers = {name: 0 for name in ('eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp', 'esp')}
        registers['esp'] = 0x8000
        return WordTrace(code.__getitem__, [(0, len(code))], missing, registers)

    def run_code(self, instructions):
        machine = self.machine(instructions)
        machine.run(0, {len(instructions)})
        return machine

    def test_partial_registers_sign_extension_and_scaled_address(self):
        machine = self.run_code([('mov', 'eax, 0x12345678'), ('mov', 'ah, 0xab'),
                                 ('movsx', 'ebx, ah'), ('movzx', 'ecx, ax'),
                                 ('mov', 'edx, 3'), ('lea', 'esi, [edx*4 + 0x20]'),
                                 ('mov', 'word ptr [esi - 2], ax')])
        self.assertEqual(machine.reg['eax'], 0x1234ab78)
        self.assertEqual(machine.reg['ebx'], 0xffffffab)
        self.assertEqual(machine.reg['ecx'], 0xab78)
        self.assertEqual(machine.read('word ptr [0x2a]'), 0xab78)

    def test_add_sub_flags_against_signed_and_unsigned_ranges(self):
        for width, register in [(8, 'al'), (16, 'ax'), (32, 'eax')]:
            size = 1 << width
            signed = lambda n: n if n < size//2 else n-size
            for a, b in [(size-1, 1), (size//2-1, 1), (size//2, 1), (0, size-1), (7, 7)]:
                for op in ('add', 'sub'):
                    with self.subTest(width=width, a=a, b=b, op=op):
                        result = a+b if op == 'add' else a-b
                        signed_result = signed(a)+signed(b) if op == 'add' else signed(a)-signed(b)
                        machine = self.run_code([('mov', f'{register}, {a}'), (op, f'{register}, {b}')])
                        self.assertEqual(machine.read(register), result % size)
                        self.assertEqual(machine.flags['c'], result < 0 or result >= size)
                        self.assertEqual(machine.flags['o'], not -size//2 <= signed_result < size//2)
                        self.assertEqual(machine.flags['z'], result % size == 0)

    def test_branch_uses_restored_flags_and_inc_preserves_carry(self):
        machine = self.run_code([('mov', 'eax, 0'), ('sub', 'eax, 1'), ('pushfd', ''),
                                 ('xor', 'eax, eax'), ('popfd', ''), ('inc', 'eax'),
                                 ('jb', '8'), ('mov', 'ebx, 99'), ('mov', 'edx, 42')])
        self.assertEqual(machine.reg['ebx'], 0)
        self.assertEqual(machine.reg['edx'], 42)
        self.assertEqual(machine.reg['esp'], 0x8000)

    def test_push_esp_captures_before_decrement_and_pop_uses_new_address(self):
        machine = self.run_code([('push', 'esp'), ('pop', 'dword ptr [esp]')])
        self.assertEqual(machine.read('dword ptr [0x8000]'), 0x8000)
        self.assertEqual(machine.reg['esp'], 0x8000)

    def test_rotates_preserve_zero_flag_and_imul_marks_unknown_flags(self):
        machine = self.run_code([('xor', 'eax, eax'), ('mov', 'al, 0x81'), ('rol', 'al, 1'),
                                 ('je', '5'), ('mov', 'ebx, 99'), ('ror', 'al, 1')])
        self.assertEqual(machine.reg['eax'], 0x81)
        self.assertEqual(machine.reg['ebx'], 0)
        with self.assertRaisesRegex(ValueError, 'undefined branch flag'):
            self.run_code([('imul', 'eax, eax, 3'), ('je', '2')])

    def test_opaque_flags_cannot_be_materialized_or_partially_overwritten(self):
        for middle in [('mov', 'eax, dword ptr [esp]'), ('mov', 'byte ptr [esp], 0')]:
            with self.assertRaises(ValueError):
                self.run_code([('pushfd', ''), middle, ('popfd', '')])

    def test_string_copy_respects_restored_direction_and_overlap(self):
        instructions = [('std', ''), ('pushfd', ''), ('cld', ''), ('popfd', ''),
                        ('mov', 'esi, 0x1003'), ('mov', 'edi, 0x1004'),
                        ('mov', 'ecx, 4'), ('rep movsb', 'byte ptr es:[edi], byte ptr [esi]')]
        machine = self.machine(instructions)
        machine.write('dword ptr [0x1000]', int.from_bytes(b'ABCD', 'little'))
        machine.run(0, {len(instructions)})
        self.assertEqual(bytes(machine.read(f'byte ptr [{a}]') for a in range(0x1000, 0x1005)), b'AABCD')
        self.assertEqual(machine.reg['ecx'], 0)

    def test_missing_memory_calls_unbounded_copy_and_control_flow_fail(self):
        for instructions in [[('mov', 'eax, dword ptr [0x1000]')], [('call', '0')],
                             [('jmp', '10')], [('movsd', 'dword ptr es:[edi], dword ptr [esi]')],
                             [('cld', ''), ('mov', 'ecx, 4097'), ('rep movsb', 'byte ptr es:[edi], byte ptr [esi]')]]:
            with self.subTest(instructions=instructions), self.assertRaises(ValueError):
                self.run_code(instructions)
        with self.assertRaisesRegex(ValueError, 'step limit'):
            self.machine([('jmp', '0')]).run(0, limit=10)


if __name__ == '__main__':
    unittest.main()
