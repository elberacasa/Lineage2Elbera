#!/usr/bin/env python3
"""Elbera Tools: exact source binding compression and original export checks."""
import json
from pathlib import Path
import sys
import unittest

from skill_bindings import build_bindings, original_skillgrp

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/ui'))


def row(level, path, sid=7):
    return {'skill_id': sid, 'skill_level': level, 'skill_visual_effect': path}


class BindingChecks(unittest.TestCase):
    def test_empty_override_and_gaps_preserved(self):
        actual = build_bindings([row(3, ''), row(1, 'Skill.wh.shared'), row(9, 'Skill.wh.shared')])
        self.assertEqual(actual, {'7': {'levels': [1, 3, 9], 'path': 'Skill.wh.shared', 'overrides': {'3': ''}}})

    def test_paths_not_replaced_with_id_or_leaf(self):
        actual = build_bindings([row(1, 'Skill.group.99'), row(2, 'Skill.other.99')])
        self.assertEqual(actual['7']['path'], 'Skill.group.99')
        self.assertEqual(actual['7']['overrides']['2'], 'Skill.other.99')

    def test_duplicate_id_level_rejected(self):
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            build_bindings([row(1, ''), row(1, 'Skill.wh.shared')])

    def test_missing_source_field_rejected(self):
        with self.assertRaisesRegex(ValueError, 'missing original'):
            build_bindings([{'skill_id': 7, 'skill_level': 1, 'description': 'old-cache'}])

    @unittest.skipUnless((ROOT / 'assets/interlude/system/skillgrp.dat').exists()
                         and (ROOT / 'assets/gamedata/skillvfx.json').exists(), 'owned originals and local v2 export required')
    def test_every_original_row_and_object_matches_generated_index(self):
        # Independently parse original object headers/Float32 tags with the
        # native evidence reader, not the production exporter or old JSON.
        from check_cast_agent_native import checked_package, qualified_export, strict_agent_properties, SKILL_PACKAGE_SHA
        rows, _ = original_skillgrp()
        index = json.loads((ROOT / 'assets/gamedata/skillvfx.json').read_text())
        self.assertEqual(index['format'], 'l2-interlude-skill-vfx-v2')
        seen = set()
        for record in rows:
            sid, level = record['skill_id'], record['skill_level']
            binding = index['bindings'][str(sid)]
            self.assertIn(level, binding['levels'])
            value = binding['overrides'].get(str(level), binding['path'])
            self.assertEqual(value, record['skill_visual_effect'], (sid, level))
            seen.add((sid, level))
        represented = {(int(sid), level) for sid, b in index['bindings'].items() for level in b['levels']}
        self.assertEqual(represented, seen)
        pkg = checked_package(ROOT / 'assets/interlude/animations/Skill.usk', SKILL_PACKAGE_SHA)
        original_paths = set()
        for export in pkg.exports_by_class('SkillVisualEffect'):
            path = qualified_export(pkg, export, 'Skill')
            original_paths.add(path.lower())
            expected = strict_agent_properties(pkg, export)
            actual = index['objects'][path.lower()]
            self.assertEqual(actual['path'], path)
            self.assertEqual(actual['f'], expected['flyingTime'])
            self.assertEqual(actual['source']['SHA256'], expected['SHA256'])
        self.assertEqual(set(index['objects']), original_paths)
        self.assertEqual(len(seen), 29812)
        self.assertEqual(len(original_paths), 244)


if __name__ == '__main__':
    unittest.main()
