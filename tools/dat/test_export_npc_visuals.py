"""Visual-scale inheritance must never turn missing inputs into defaults."""
import struct
import unittest
from pathlib import Path

from export_npc_visuals import resolve_visual, visual_properties, OriginalClasses, SYSTEM_DIR


class NpcVisualExtractionTests(unittest.TestCase):
    def test_child_scalar_and_inherited_vector_keep_exact_field_owners(self):
        classes = {
            'Original.Child': {'name': 'Original.Child', 'super': 'Engine.Actor',
                               'visual': {'DrawScale': 1.5}},
            'Engine.Actor': {'name': 'Engine.Actor', 'super': 'Core.Object',
                             'visual': {'DrawScale': 1.0, 'DrawScale3D': [1., 2., 3.]}},
        }
        got = resolve_visual('Original.Child', classes.get)
        self.assertEqual(got['drawScale'], 1.5)
        self.assertEqual(got['drawScale3D'], [1., 2., 3.])
        self.assertEqual(got['fieldOwners'], {'DrawScale': 'Original.Child', 'DrawScale3D': 'Engine.Actor'})

    def test_absent_class_parent_field_or_cycle_never_means_scale_one(self):
        cases = [({}, 'Original.Missing'),
                 ({'Original.Child': {'name': 'Original.Child', 'super': 'Engine.Missing', 'visual': {}}}, 'Original.Child'),
                 ({'Original.Child': {'name': 'Original.Child', 'super': None, 'visual': {'DrawScale': 1.}}}, 'Original.Child'),
                 ({'Original.Child': {'name': 'Original.Child', 'super': 'Original.Child', 'visual': {}}}, 'Original.Child')]
        for classes, key in cases:
            with self.subTest(key=key), self.assertRaises(ValueError):
                resolve_visual(key, classes.get)

    def test_scalar_and_vector_decode_without_rounding_or_collision_fitting(self):
        values = [.125, 2.25, -0.5]
        got = visual_properties([('CollisionHeight', 'float', 200.),
            ('DrawScale', 'float', 0.0),
            ('DrawScale3D', 'struct', ('Vector', struct.pack('<3f', *values).hex()))])
        self.assertEqual(got, {'DrawScale': 0., 'DrawScale3D': values})

    def test_wrong_types_duplicates_and_nonfinite_values_reject(self):
        cases = [[('DrawScale', 'int', 1)], [('DrawScale', 'float', float('nan'))],
                 [('DrawScale', 'float', 1.), ('DrawScale', 'float', 2.)],
                 [('DrawScale3D', 'struct', ('Rotator', bytes(12).hex()))],
                 [('DrawScale3D', 'struct', ('Vector', struct.pack('<3f', 1, float('inf'), 1).hex()))]]
        for props in cases:
            with self.subTest(props=props), self.assertRaises(ValueError):
                visual_properties(props)

    @unittest.skipUnless((Path(SYSTEM_DIR) / 'Engine.u').exists(), 'private original client absent')
    def test_original_declared_fields_reject_false_header_and_function_names(self):
        catalog = OriginalClasses()
        actor = catalog.get('Engine.Actor')
        pawn = catalog.get('Engine.Pawn')
        # Independently inspected original boundaries. The previous ungated
        # maximal decoder included a fake Core field in Actor and accepted a
        # same-length Pawn candidate beginning with the function TakeDamage.
        self.assertEqual(actor['defaultsOffset'], 747)
        self.assertEqual(actor['propertyCount'], 36)
        self.assertEqual(actor['visual'], {'DrawScale': 1., 'DrawScale3D': [1., 1., 1.]})
        self.assertEqual(pawn['defaultsOffset'], 2370)
        self.assertEqual(pawn['propertyCount'], 98)

    @unittest.skipUnless((Path(SYSTEM_DIR) / 'LineageMonster.u').exists(), 'private original client absent')
    def test_original_ambiguous_nonvisual_boundary_keeps_all_candidates(self):
        catalog = OriginalClasses()
        spider = catalog.get('LineageMonster.giant_spider')
        self.assertEqual(spider['defaultsBoundary'], 'ambiguous-visual-consensus')
        self.assertEqual([c['offset'] for c in spider['defaultsCandidates']], [90, 94])
        self.assertNotIn('defaultsOffset', spider)
        self.assertEqual(spider['visual'], {})
        visual = resolve_visual('LineageMonster.giant_spider', catalog.get)
        self.assertEqual(visual['drawScale'], 1.)
        self.assertEqual(visual['fieldOwners']['DrawScale'], 'Engine.Actor')


if __name__ == '__main__':
    unittest.main()
