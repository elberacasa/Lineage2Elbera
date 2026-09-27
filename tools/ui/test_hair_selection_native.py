"""Portable hair-table tests; no original input or native execution."""
import struct
import unittest

from check_hair_selection_native import TRAILER, hair_pairs, keyed_hair_pairs, hair_material_state


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


class HairMaterials(unittest.TestCase):
    def final(self, **props):
        return {'Material': {'reference': 'Example.Hair.SourcePixels'},
                'FrameBufferBlending': 2, 'AlphaTest': True, 'TwoSided': True, **props}

    def child(self, **props):
        return {'class': 'Texture', 'properties': props}

    def test_masked_state_uses_native127_and_preserves_exact_boolean_cull(self):
        state = hair_material_state('Texture', {'bMasked': True, 'bTwoSided': True, 'Format': 3})
        self.assertEqual(state['status'], 'supported-state')
        self.assertEqual((state['alphaRef'], state['alphaCompare'], state['alphaTest']), (127, 'greater', True))
        self.assertEqual(state['blend'], {'source': 2, 'destination': 1, 'enabled': False})
        self.assertTrue(state['twoSided'])

    def test_original_mask_flag_has_priority_over_alpha_flag(self):
        state = hair_material_state('Texture', {'bMasked': True, 'bAlphaTexture': True})
        self.assertEqual((state['frameBufferBlending'], state['alphaRef']), (0, 127))
        self.assertTrue(state['sourceTextureFlags']['bAlphaTexture'])

    def test_plain_and_alpha_textures_do_not_inherit_masked_cutoff(self):
        opaque = hair_material_state('Texture', {})
        alpha = hair_material_state('Texture', {'bAlphaTexture': True})
        self.assertFalse(opaque['alphaTest'])
        self.assertFalse(opaque['twoSided'])
        self.assertEqual((alpha['frameBufferBlending'], alpha['alphaRef'], alpha['alphaTest']), (2, 0, True))

    def test_finalblend_exact_reference_values_not_angel_constant(self):
        for ref in (0, 1, 3, 5, 150, 160, 200, 255):
            state = hair_material_state('FinalBlend', self.final(AlphaRef=ref), self.child(bMasked=True))
            self.assertEqual(state['status'], 'supported-state')
            self.assertEqual(state['alphaRef'], ref)
            self.assertEqual(state['blend'], {'source': 5, 'destination': 6, 'enabled': True})
            self.assertTrue(state['depthWrite'])
            self.assertTrue(state['depthTest'])

    def test_omitted_final_reference_is_original_zero_not_missing_or_child127(self):
        state = hair_material_state('FinalBlend', self.final(), self.child(bMasked=True))
        self.assertEqual(state['alphaRef'], 0)
        self.assertTrue(state['sourceTextureFlags']['bMasked'])

    def test_explicit_false_and_zero_override_class_defaults(self):
        state = hair_material_state('FinalBlend', self.final(FrameBufferBlending=0, AlphaTest=False,
            ZWrite=False, ZTest=False, TwoSided=False, TreatAsTwoSided=True), self.child(bAlphaTexture=True))
        self.assertEqual(state['status'], 'supported-state')
        for name in ('alphaTest', 'depthWrite', 'depthTest', 'twoSided'):
            self.assertFalse(state[name])
        self.assertTrue(state['treatAsTwoSided'])  # separate hint does not enable culling flag
        self.assertFalse(state['blend']['enabled'])

    def test_nontexture_child_missing_reference_and_unknown_graph_rejected(self):
        cases = [('FinalBlend', self.final(), None),
                 ('FinalBlend', self.final(), {'class': 'Shader', 'properties': {}}),
                 ('FinalBlend', self.final(Material={'reference': None}), self.child()),
                 ('FinalBlend', self.final(Specular={'reference': 'Extra'}), self.child()),
                 ('FinalBlend', self.final(), self.child(Detail={'reference': 'Extra'})),
                 ('Shader', {}, None), ('Texture', {}, self.child()),
                 ('Texture', {1: True}, None),
                 ('FinalBlend', self.final(), {'class': 'Texture', 'properties': {1: True}})]
        for kind, props, child in cases:
            self.assertEqual(hair_material_state(kind, props, child)['status'], 'unsupported')

    def test_malformed_source_types_not_coerced(self):
        for value in (1, 'true', None):
            self.assertEqual(hair_material_state('Texture', {'bMasked': value})['status'], 'unsupported')
        for value in (-1, 256, 1.5, True, None):
            state = hair_material_state('FinalBlend', self.final(AlphaRef=value), self.child())
            self.assertEqual(state['status'], 'unsupported')
        self.assertEqual(hair_material_state('FinalBlend', self.final(FrameBufferBlending=3), self.child())['status'], 'unsupported')

    def test_source_addressing_is_preserved_without_certifying_filter_or_mips(self):
        state = hair_material_state('Texture', {'bMasked': True, 'UClampMode': 1})
        self.assertEqual(state['sampling'], {'uClampMode': 1, 'vClampMode': 0,
                                            'status': 'source-address-branch-only'})
        for value in (2, -1, True):
            self.assertEqual(hair_material_state('Texture', {'UClampMode': value})['status'], 'unsupported')

    def test_descriptor_does_not_change_source_fields(self):
        props, child = self.final(), self.child(bMasked=True)
        before = repr((props, child))
        first = hair_material_state('FinalBlend', props, child)
        first['sourceTextureFlags']['bMasked'] = False
        self.assertEqual(repr((props, child)), before)
        self.assertTrue(hair_material_state('FinalBlend', props, child)['sourceTextureFlags']['bMasked'])


if __name__ == '__main__':
    unittest.main()
