"""Portable safety checks for the independent sitting Sound reference audit."""
import unittest

from check_sitting_sound_refs import compact, imported_path


class SourceReferenceTests(unittest.TestCase):
    def test_signed_serialized_reference_vectors(self):
        for raw, value in [('00', 0), ('3f', 63), ('a1', -33), ('d002', -144),
                           ('f101', -113), ('cf01', -79), ('c801', -72)]:
            data = bytes.fromhex(raw)
            self.assertEqual(compact(data, 0), (value, len(data)))

    def test_outer_chain_preserves_group_and_one_based_import_index(self):
        names = ['Bank', 'Group', 'Sound']
        rows = [{'name': 0, 'outer': 0}, {'name': 1, 'outer': -1},
                {'name': 2, 'outer': -2}]
        self.assertEqual(imported_path(-3, names, rows), 'Bank.Group.Sound')
        self.assertEqual(imported_path(-1, names, rows), 'Bank')
        for ref in (1, -4):
            with self.assertRaises(ValueError):
                imported_path(ref, names, rows)
        with self.assertRaises(ValueError):
            imported_path(-1, names, [{'name': 0, 'outer': -1}])

    def test_truncated_and_unbounded_integers_are_rejected(self):
        for raw in ('', '40', '4080'):
            with self.assertRaises(IndexError):
                compact(bytes.fromhex(raw), 0)
        with self.assertRaises(ValueError):
            compact(bytes.fromhex('7fffffffff'), 0)


if __name__ == '__main__':
    unittest.main()
