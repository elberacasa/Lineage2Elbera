"""Source-free RIFF admission checks; binary anchors require private originals."""
import struct
import unittest
from fractions import Fraction

from check_playsound_native import (absolute_load_references, dry_gain_witness,
    radius_assertion_passes, recovered_span, wave_info)


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


if __name__ == '__main__':
    unittest.main()
