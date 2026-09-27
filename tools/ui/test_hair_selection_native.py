"""Portable hair-table tests; no original input or native execution."""
import struct
import unittest

from check_hair_selection_native import TRAILER, hair_pairs, keyed_hair_pairs


class HairTables(unittest.TestCase):
    def raw(self):
        return struct.pack('<450i', *range(450)) + TRAILER

    def test_serialized_pairs_are_two_independent_submesh_indices(self):
        rows = hair_pairs(self.raw())
        self.assertEqual(rows[0][0], [0, 1])
        self.assertEqual(rows[1][0], [30, 31])
        self.assertEqual(rows[14][14], [448, 449])

    def test_absent_first_part_does_not_remove_second_part(self):
        raw = bytearray(self.raw())
        struct.pack_into('<ii', raw, 0, -1, 6)
        self.assertEqual(hair_pairs(raw)[0][0], [-1, 6])

    def test_no_silent_table_truncation_or_extra_words(self):
        for raw in [self.raw()[:-1], self.raw() + b'\0', b'\0' * 1800 + b'wrong']:
            with self.assertRaises(ValueError):
                hair_pairs(raw)

    def test_equipment_count_key_and_row_order(self):
        body = self.raw()[:-len(TRAILER)]
        raw = struct.pack('<Ii', 2, 3) + body + struct.pack('<i', 1) + body + TRAILER
        rows = keyed_hair_pairs(raw)
        self.assertEqual([row['key'] for row in rows], [3, 1])
        self.assertEqual(rows[1]['pairs'][14][14], [448, 449])

    def test_duplicate_keys_remain_visible_without_inventing_overwrite_policy(self):
        record = struct.pack('<i', 4) + self.raw()[:-len(TRAILER)]
        rows = keyed_hair_pairs(struct.pack('<I', 2) + record * 2 + TRAILER)
        self.assertEqual([row['key'] for row in rows], [4, 4])

    def test_equipment_count_mismatch_rejected(self):
        for raw in [TRAILER, struct.pack('<I', 1) + TRAILER,
                    struct.pack('<I', 0) + self.raw()]:
            with self.assertRaises(ValueError):
                keyed_hair_pairs(raw)


if __name__ == '__main__':
    unittest.main()
