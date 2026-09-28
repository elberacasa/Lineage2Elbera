"""Source-free RIFF admission checks; binary anchors require private originals."""
import struct
import unittest
from fractions import Fraction
from types import SimpleNamespace

from check_playsound_native import (absolute_load_references, dry_gain_witness,
    radius_assertion_passes, recovered_span, verify, PriorityMachine, VoiceMachine, wave_info)


def wave(channels=2, sample_data=b'\0\0\1\0', rate=22050):
    block = channels * 2
    fmt = struct.pack('<HHIIHH', 1, channels, rate, rate * block, block, 16)
    body = b'WAVEfmt ' + struct.pack('<I', len(fmt)) + fmt + b'data' + struct.pack('<I', len(sample_data)) + sample_data
    return b'RIFF' + struct.pack('<I', len(body)) + body


class WaveTests(unittest.TestCase):
    def test_retains_channel_count_and_exact_frame_count(self):
        stereo, mono = wave_info(wave()), wave_info(wave(1))
        self.assertEqual((stereo['channels'], stereo['frames']), (2, 1))
        self.assertEqual((mono['channels'], mono['frames']), (1, 2))
        self.assertNotEqual(stereo['SHA256'], mono['SHA256'])

    def test_rejects_partial_and_surplus_containers(self):
        raw = wave()
        for length in range(len(raw)):
            with self.assertRaises(ValueError):
                wave_info(raw[:length])
        with self.assertRaises(ValueError):
            wave_info(raw + b'\0')

    def test_rejects_inconsistent_format_and_frame_boundaries(self):
        with self.assertRaises(ValueError):
            wave_info(wave(sample_data=b'\0\0'))
        with self.assertRaises(ValueError):
            wave_info(wave(rate=0))
        raw = bytearray(wave()); struct.pack_into('<I', raw, 28, 123)
        with self.assertRaises(ValueError):
            wave_info(raw)


class OrdinaryGainEvidenceTests(unittest.TestCase):
    def test_original_assertion_is_not_a_positive_finite_gate(self):
        self.assertFalse(radius_assertion_passes(0.0))
        self.assertFalse(radius_assertion_passes(-0.0))
        for value in (-1, 1, float('inf'), -float('inf'), float('nan')):
            self.assertTrue(radius_assertion_passes(value))

    def test_zero_distance_reduction_needs_no_chosen_radius(self):
        # Exact-real witnesses spanning tiny/large, fractional and negative R.
        # These are neither original radius values nor an x87 rounding oracle.
        for radius in (Fraction(1, 2**149), Fraction(1, 4), 1, 97,
                       Fraction(2**128 - 2**104), -1):
            for volume in (Fraction(1, 10), Fraction(1, 2), 1):
                self.assertEqual(dry_gain_witness(volume, radius, 0), volume)

    def test_reduction_does_not_authorize_unknown_radius_or_other_listener(self):
        for value in (0, float('nan'), float('inf')):
            with self.assertRaises(ValueError):
                dry_gain_witness(1, value, 0)
        self.assertEqual(dry_gain_witness(1, 4, 100), Fraction(1, 2))
        self.assertEqual(dry_gain_witness(1, 4, 200), 0)


class BindingBoundaryTests(unittest.TestCase):
    def test_incomplete_comparison_pair_fails_before_private_inputs_are_read(self):
        for engine, core in [('synthetic-engine', None), (None, 'synthetic-core')]:
            with self.assertRaisesRegex(ValueError, 'supplied together'):
                verify(engine, core)

    def test_unaligned_raw_recovery_preserves_neighbors_and_wraparound(self):
        source = b'abc' + b'\x90' * 6 + b'xyz'
        key = 0xfffffff1
        raw = b''.join(((value + key) & 0xffffffff).to_bytes(4, 'little')
                       for (value,) in struct.iter_unpack('<I', source))
        self.assertEqual(recovered_span(raw, 3, 6, key), b'\x90' * 6)
        self.assertEqual(recovered_span(raw, 0, 12, key), source)
        for offset, size in [(-1, 1), (0, 0), (10, 4)]:
            with self.assertRaises(ValueError):
                recovered_span(raw, offset, size, key)

    def test_direct_pointer_load_inventory_does_not_drop_unknown_references(self):
        slot, base = 0x12345678, 0x1000
        address = struct.pack('<I', slot)
        raw = b'\xa1' + address + b'\x8b\x0d' + address + b'\x8b\x15' + address
        self.assertEqual(absolute_load_references(raw, base, slot), [
            {'VA': base, 'register': 'eax'}, {'VA': base + 5, 'register': 'ecx'},
            {'VA': base + 11, 'register': 'edx'}])
        self.assertEqual(absolute_load_references(b'', base, slot), [])
        for data in [address, b'\xa3' + address, b'\x89\x05' + address, raw + address]:
            with self.assertRaises(ValueError):
                absolute_load_references(data, base, slot)


class VoiceInterpreterTests(unittest.TestCase):
    def machine(self):
        return VoiceMachine({0x2000: 0x11223344},
                            {'ebx': 0x123456fe, 'ecx': 0x2000, 'eax': 0}, [])

    def instruction(self, machine, op, args):
        return machine.step(SimpleNamespace(mnemonic=op, op_str=args, address=0x1000, size=1))

    def test_byte_reads_and_writes_preserve_neighboring_bits(self):
        machine = self.machine()
        self.assertEqual(machine.read('bl'), 254)
        self.assertEqual(machine.read('byte ptr [ecx]'), 0x44)
        machine.write('byte ptr [ecx]', 0xaa)
        self.assertEqual(machine.memory[0x2000], 0x112233aa)

    def test_multiply_wrap_and_signed_greater_branch(self):
        machine = self.machine()
        self.instruction(machine, 'imul', 'eax, ebx, 0x5c')
        self.assertEqual(machine.registers['eax'], (0x123456fe * 0x5c) & 0xffffffff)
        for lhs, rhs, taken in [(0xffffffff, 1, False), (1, 0xffffffff, True), (1, 1, False)]:
            machine.registers['eax'], machine.registers['ebx'] = lhs, rhs
            self.instruction(machine, 'cmp', 'eax, ebx')
            target = self.instruction(machine, 'jg', '0x1234')
            self.assertEqual(target, 0x1234 if taken else 0x1001)

    def test_finite_comparison_flags_distinguish_greater_from_ties(self):
        machine = self.machine()
        for lhs, rhs, greater in [(1, 0, True), (0, -0.0, False), (-1, 1, False), (2**-149, 0, True)]:
            machine.stack = [lhs, rhs]
            self.instruction(machine, 'fcompp', '')
            self.instruction(machine, 'fnstsw', 'ax')
            self.instruction(machine, 'test', 'ah, 0x41')
            self.assertEqual(machine.zero, greater)
            self.assertEqual(machine.stack, [])
        machine.stack = [float('nan'), 0]
        with self.assertRaises(AssertionError):
            self.instruction(machine, 'fcompp', '')

    def test_calls_and_erased_calls_cannot_silently_pass(self):
        machine = self.machine()
        for op, args in [('call', '0x1234'), ('nop', '')]:
            with self.assertRaises(AssertionError):
                self.instruction(machine, op, args)


class PriorityInterpreterTests(VoiceInterpreterTests):
    def machine(self):
        return PriorityMachine({0x2000: 0x11223344},
                               {'ebx': 0x123456fe, 'ecx': 0x2000, 'eax': 0}, [])

    def test_division_and_signed_integer_add_preserve_stack_order(self):
        machine = self.machine()
        machine.stack = [5.0, 7.0]
        machine.memory[0x2000] = 2.0
        self.instruction(machine, 'fdiv', 'dword ptr [ecx]')
        machine.memory[0x2000] = 0xffffffff
        self.instruction(machine, 'fiadd', 'dword ptr [ecx]')
        self.assertEqual(machine.stack, [1.5, 7.0])
        self.instruction(machine, 'shr', 'ebx, 2')
        self.instruction(machine, 'and', 'ebx, 3')
        self.assertEqual(machine.registers['ebx'], (0x123456fe >> 2) & 3)

    def test_unordered_compare_is_finite_only_and_does_not_pop(self):
        machine = self.machine()
        machine.stack = [0.25, 0.5]
        self.instruction(machine, 'fucom', 'st(1)')
        self.assertEqual(machine.status, 0x100)
        self.assertEqual(machine.stack, [0.25, 0.5])
        machine.stack[0] = float('nan')
        with self.assertRaises(AssertionError):
            self.instruction(machine, 'fucom', 'st(1)')

    def test_admitted_helper_call_and_return_balance_the_original_stack(self):
        machine = self.machine()
        machine.registers['esp'] = 0x3000
        target = machine.step(SimpleNamespace(mnemonic='call', op_str='0x1000120d',
                                              address=0x100080d3, size=5))
        self.assertEqual(target, 0x1000120d)
        self.assertEqual(machine.registers['esp'], 0x2ffc)
        self.assertEqual(self.instruction(machine, 'ret', ''), 0x100080d8)
        self.assertEqual(machine.registers['esp'], 0x3000)


if __name__ == '__main__':
    unittest.main()
