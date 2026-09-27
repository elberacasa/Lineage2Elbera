import unittest
from types import SimpleNamespace

import build_npc_variants as variants


class OriginalNpcVariantTest(unittest.TestCase):
    def test_qualified_parent_and_child_array_elements(self):
        tables = {
            'childpkg': {'corpse': {'WaitAnimName': {'0': 'DeathWait'}}},
            'parentpkg': {'pawn': {'WaitAnimName': {'0': 'Wait', '1': 'ArmedWait'}}},
            'otherpkg': {'pawn': {'WaitAnimName': {'0': 'Wrong'}}},
        }
        parents = {'childpkg.corpse': 'parentpkg.pawn', 'parentpkg.pawn': None}
        fields, chain = variants.resolve_fields('ChildPkg.Corpse', tables, parents.__getitem__)
        self.assertEqual(chain, ['childpkg.corpse', 'parentpkg.pawn'])
        self.assertEqual(fields['WaitAnimName']['0'], {'value': 'DeathWait', 'declaredBy': 'childpkg.corpse'})
        self.assertEqual(fields['WaitAnimName']['1']['value'], 'ArmedWait')
        self.assertEqual(fields['WaitAnimName']['1']['declaredBy'], 'parentpkg.pawn')

    def test_shared_mesh_classes_keep_distinct_original_idles(self):
        tables = {'p': {'live': {'WaitAnimName': {'0': 'Wait'}},
                        'corpse': {'WaitAnimName': {'0': 'DeathWait'}}}}
        resolve = lambda name: variants.resolve_fields(name, tables, lambda _key: None)[0]
        self.assertNotEqual(resolve('p.live'), resolve('p.corpse'))

    def test_missing_ancestor_and_cycle_cannot_silently_terminate(self):
        with self.assertRaises(KeyError):
            variants.resolve_fields('p.child', {}, {}.__getitem__)
        with self.assertRaisesRegex(ValueError, 'cyclic'):
            variants.resolve_fields('p.child', {}, lambda _key: 'p.child')

    def test_sequence_lookup_has_no_keyword_or_first_clip_fallback(self):
        self.assertEqual(variants.exact_sequence(['DeathWait_Hand', 'Wait'], 'deathwait_hand'), 'DeathWait_Hand')
        for available, requested in [(['Wait'], 'DeathWait'), (['Wait', 'wait'], 'WAIT')]:
            with self.assertRaises(ValueError):
                variants.exact_sequence(available, requested)

    def test_bone_order_and_existing_bind_transform_must_match(self):
        ctx = {'skeleton': SimpleNamespace(bones=[{}, {}]),
               'parts': [({'bones': [{'name': 'Root'}, {'name': 'Hand'}]}, [0, 1])]}
        fresh = {'nodes': [{'name': 'Root'}, {'name': 'Hand'}]}
        gltf = {**fresh, 'skins': [{'joints': [0, 1]}]}
        variants.check_skeleton(gltf, fresh, ctx, ['root', 'hand'])
        with self.assertRaisesRegex(ValueError, 'positionally'):
            variants.check_skeleton(gltf, fresh, ctx, ['Hand', 'Root'])
        with self.assertRaisesRegex(ValueError, 'positionally'):
            variants.check_skeleton(gltf, fresh, ctx, ['Root', 'Hand', 'Extra'])
        with self.assertRaisesRegex(ValueError, 'skeleton differs'):
            variants.check_skeleton({**gltf, 'nodes': [{'name': 'Other'}]}, fresh, ctx, ['Root', 'Hand'])
        with self.assertRaisesRegex(ValueError, 'node mapping'):
            variants.check_skeleton({**gltf, 'skins': [{'joints': [1, 0]}]}, fresh, ctx, ['Root', 'Hand'])

    def test_hash_serialization_is_deterministic(self):
        self.assertEqual(variants.sha(variants.encode({'b': 2, 'a': 1})),
                         variants.sha(variants.encode({'a': 1, 'b': 2})))
        self.assertNotEqual(variants.sha(b'original'), variants.sha(b'changed'))


if __name__ == '__main__':
    unittest.main()
