#!/usr/bin/env python3
"""Elbera Tools: source-free adversarial exact Agent binding tests."""
from types import SimpleNamespace
import unittest

from check_cast_agent_native import qualified_export, resolve_binding, strict_agent_properties
from l2lib import encode_compact


class Package:
    def __init__(self, records=(), data=b'', names=()):
        self.records, self.data, self.names = records, data, names

    def export_name(self, export):
        return export.name

    def resolve_ref(self, ref):
        return self.records[ref - 1]

    def name(self, index):
        return self.names[index]


class BindingChecks(unittest.TestCase):
    def test_shared_source_object_is_not_selected_by_skill_id(self):
        objects = {'skill.wh.1012': {'flyingTime': 0.}}
        self.assertEqual(resolve_binding('skill.wh.1012', objects)['object'], objects['skill.wh.1012'])
        self.assertEqual(resolve_binding('21', objects)['status'], 'unresolved-source-path')

    def test_empty_source_does_not_find_unrelated_same_id_object(self):
        objects = {'skill.el.1177': {'flyingTime': .4}}
        self.assertEqual(resolve_binding('', objects)['status'], 'source-none')
        self.assertEqual(resolve_binding('NoNe', objects)['status'], 'source-none')

    def test_missing_manifest_object_is_not_native_absence(self):
        self.assertEqual(resolve_binding('Skill.wh.missing', {})['status'], 'unresolved-source-path')

    def test_missing_level_metadata_rejected_instead_of_defaulting(self):
        with self.assertRaisesRegex(ValueError, 'missing exact-level'):
            resolve_binding(None, {})

    def test_full_group_path_preserved(self):
        group = SimpleNamespace(name='wh', package_index=0)
        export = SimpleNamespace(name='1012', package_index=1)
        self.assertEqual(qualified_export(Package([group]), export, 'Skill'), 'Skill.wh.1012')

    def test_outer_cycles_rejected(self):
        group = SimpleNamespace(name='bad', package_index=1)
        export = SimpleNamespace(name='1012', package_index=1)
        with self.assertRaisesRegex(ValueError, 'cyclic'):
            qualified_export(Package([group]), export, 'Skill')

    def test_duplicate_flying_time_rejected(self):
        tag = encode_compact(1) + bytes([0x24]) + bytes(4)
        data = tag + tag + encode_compact(0)
        package = Package(data=data, names=['None', 'FlyingTime'])
        export = SimpleNamespace(index=0, serial_offset=0, serial_size=len(data))
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            strict_agent_properties(package, export)

    def test_trailing_export_bytes_rejected(self):
        package = Package(data=b'\0\1', names=['None'])
        export = SimpleNamespace(index=0, serial_offset=0, serial_size=2)
        with self.assertRaisesRegex(AssertionError, 'trailing'):
            strict_agent_properties(package, export)


if __name__ == '__main__':
    unittest.main()
