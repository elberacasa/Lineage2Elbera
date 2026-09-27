"""Strict binary boundaries and optional full original-client round-trip.

Run: python3 -m unittest discover -s tools/dat -p test_export_quests.py
Synthetic records deliberately contain no original quest prose.
"""
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest

import export_quests as quests


def compact(value):
    sign, value = (128 if value < 0 else 0), abs(value)
    out = bytearray([sign | (value & 63) | (64 if value > 63 else 0)])
    value >>= 6
    while value:
        out.append((value & 127) | (128 if value > 127 else 0))
        value >>= 7
    return bytes(out)


def text(value, wide=False):
    if wide:
        raw = value.encode('utf-16-le') + b'\0\0'
        return compact(-len(raw) // 2) + raw
    raw = value.encode('cp1252') + b'\0'
    return compact(len(raw)) + raw


def integers(values):
    return compact(len(values)) + b''.join(struct.pack('<I', v & 0xffffffff) for v in values)


def record(*, stage=1, counts=(-3,), position=(1., 2., 3.)):
    return (struct.pack('<III', 0, 7001, stage)
            + text('Synthetic quest') + text('Synthetic stage') + text('Fictional test description')
            + integers([42]) + integers(counts) + struct.pack('<3f', 4, 5, 6)
            + struct.pack('<III', 1, 20, 0) + text('Synthetic target')
            + struct.pack('<IIII', 7, 8, 9, 123) + struct.pack('<3f', *position)
            + text('Synthetic requirements') + text('Synthetic introduction')
            + integers([-1]) + integers([]) + struct.pack('<IIII', 0, 0, 0, 0))


def file(*rows):
    return struct.pack('<I', len(rows)) + b''.join(rows) + quests.TRAILER


class QuestExtractionTests(unittest.TestCase):
    def test_record_offsets_hashes_signed_counts_and_exact_tail(self):
        rows = [record(), record(stage=2)]
        parsed = quests.parse(file(*rows))
        for index, (row, source) in enumerate(zip(parsed, rows)):
            self.assertEqual(row['sourceOffset'], 4 + sum(map(len, rows[:index])))
            self.assertEqual(row['sourceLength'], len(source))
            self.assertEqual(row['sourceSHA256'], hashlib.sha256(source).hexdigest())
            self.assertEqual(row['itemCounts'], [-3])
            self.assertEqual(row['classLimits'], [-1])

    def test_ascf_codepages_and_terminators(self):
        self.assertEqual(quests.QuestReader(text('Café')).string(), 'Café')
        self.assertEqual(quests.QuestReader(text('世界', True)).string(), '世界')
        self.assertEqual(quests.QuestReader(b'\0').string(), '')
        for data in (b'\x02ab', b'\x82a\0b\0'):
            with self.assertRaises(ValueError):
                quests.QuestReader(data).string()

    def test_truncation_unknown_tail_and_duplicate_stages_fail(self):
        body = record()
        for data in (file(body)[:-1], file(body[:-1]), file(body + b'\0'), file(body, body)):
            with self.subTest(length=len(data)), self.assertRaises((EOFError, ValueError)):
                quests.parse(data)

    def test_counts_cannot_run_past_buffer_or_disagree(self):
        for data in (compact(-1), compact(5) + bytes(4)):
            with self.assertRaises(ValueError):
                quests.QuestReader(data).ints()
        with self.assertRaises(ValueError):
            quests.parse(file(record(counts=())))

    def test_nonfinite_positions_keep_raw_bits_without_fabricated_coordinate(self):
        row = quests.parse(file(record(position=(float('nan'), 2., 3.))))[0]
        self.assertIsNone(row['startNpcLoc'])
        self.assertEqual(row['startNpcLocBits'][1:], [0x40000000, 0x40400000])
        json.dumps(row, allow_nan=False)

    @unittest.skipUnless((Path(quests.SYSTEM_DIR) / quests.SOURCE).exists(), 'private original client absent')
    def test_original_client_exact_roundtrip(self):
        with tempfile.TemporaryDirectory() as temp:
            data = quests.decrypt(quests.SOURCE, temp)
        rows = quests.parse(data)
        self.assertEqual(len(rows), 2050)
        self.assertEqual(len({q['id'] for q in rows}), 342)
        self.assertEqual(rows[-1]['sourceOffset'] + rows[-1]['sourceLength'], len(data) - len(quests.TRAILER))
        for row in rows:
            source = data[row['sourceOffset']:row['sourceOffset'] + row['sourceLength']]
            self.assertEqual(row['sourceSHA256'], hashlib.sha256(source).hexdigest())


if __name__ == '__main__':
    unittest.main()
