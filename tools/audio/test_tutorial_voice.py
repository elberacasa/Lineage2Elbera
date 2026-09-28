"""Portable synthetic Ogg framing tests, not original voice data/codec tests."""
import struct
import unittest
from export_tutorial_voice import ogg_info


def page(flags, sequence, payload, frames=0):
    return b'OggS\0' + bytes([flags]) + struct.pack('<QIII', frames, 123, sequence, 0) + bytes([1, len(payload)]) + payload


def source():
    header = b'\x01vorbis' + struct.pack('<I', 0) + b'\x01' + struct.pack('<IiiiBB', 44100, 0, 0, 0, 0x88, 1)
    return page(2, 0, header) + page(4, 1, b'synthetic', 100)


class VoiceFramingTests(unittest.TestCase):
    def test_preserves_opaque_trailer_without_claiming_its_meaning(self):
        blob = source()
        info = ogg_info(blob + b'opaque-synthetic-trailer')
        self.assertEqual(info['oggBytes'], len(blob))
        self.assertEqual(info['trailerBytes'], 24)
        self.assertEqual(info['frames'], 100)
        self.assertEqual(info['channels'], 1)

    def test_truncation_missing_end_or_broken_sequence_is_refused(self):
        blob = source()
        for bad in (b'', blob[:-1], blob[:58], blob.replace(b'OggS', b'L2SD', 1)):
            with self.assertRaises(ValueError): ogg_info(bad)
        broken = bytearray(blob)
        struct.pack_into('<I', broken, 58 + 18, 99)
        with self.assertRaises(ValueError): ogg_info(broken)


if __name__ == '__main__':
    unittest.main()
