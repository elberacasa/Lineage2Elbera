import copy
import unittest

import export_npc_materials as materials


def ghost():
    return {'class': 'Shader', 'properties': {
        'Diffuse': {'reference': 'p:1'}, 'SpecularityMask': {'reference': 'p:1'},
        'OutputBlending': {'raw': '05'}, 'TwoSided': True}}


class OriginalNpcMaterialTest(unittest.TestCase):
    def test_angel_alpha_uses_explicit_finalblend_and_same_diffuse_opacity(self):
        nodes = {'final': {'class': 'FinalBlend', 'properties': {
            'FrameBufferBlending': {'raw': '02'}, 'AlphaTest': True, 'TwoSided': True,
            'TreatAsTwoSided': True, 'AlphaRef': {'raw': 'a0'}, 'Material': {'reference': 'shader'}}},
            'shader': {'class': 'Shader', 'properties': {'Diffuse': {'reference': 'texture'},
                'Opacity': {'reference': 'texture'}, 'Specular': {'reference': 'unimplemented-env'},
                'SpecularityMask': {'reference': 'mask'}}}, 'texture': {'class': 'Texture'}}
        correction = materials.angel_alpha_binding(nodes, ['unchanged-body', 'final'])
        self.assertEqual((correction['textureIndex'], correction['alphaRef']), (1, 160))
        for modify in [
            lambda n: n['final']['properties'].update(AlphaRef={'raw': '80'}),
            lambda n: n['final']['properties'].update(ZWrite=False),
            lambda n: n['shader']['properties'].update(Opacity={'reference': 'other'}),
            lambda n: n['texture'].update({'class': 'TexModifier'}),
        ]:
            changed = copy.deepcopy(nodes)
            modify(changed)
            with self.assertRaises(ValueError):
                materials.angel_alpha_binding(changed, ['unchanged-body', 'final'])

    def test_only_explicit_original_brighten_shape_is_eligible(self):
        self.assertIsNone(materials.classify_shader(ghost()))
        for field, value in [('OutputBlending', {'raw': '03'}), ('TwoSided', False),
                             ('SpecularityMask', {'reference': 'other'})]:
            node = ghost()
            node['properties'][field] = value
            self.assertIsNotNone(materials.classify_shader(node))

    def test_gold_environment_specular_opacity_and_unknown_shader_fields_stay_unresolved(self):
        for field in ['Specular', 'Opacity', 'NormalMap', 'SelfIllumination', 'Unknown']:
            node = ghost()
            node['properties'][field] = {'reference': 'original-subgraph'}
            self.assertIn('unimplemented', materials.classify_shader(node))
        node = ghost()
        node['class'] = 'TexEnvMap'
        self.assertIn('unsupported', materials.classify_shader(node))

    def test_converted_binding_requires_original_geometry_and_exact_material_order(self):
        fresh = {'nodes': [{'name': 'root'}], 'skins': [{'joints': [0]}],
                 'meshes': [{'primitives': [{'material': 0}, {'material': 1}]}]}
        materials.validate_converted_binding(fresh, b'original-clip', fresh, b'original')
        with self.assertRaisesRegex(ValueError, 'geometry'):
            materials.validate_converted_binding(fresh, b'changed-clip', fresh, b'original')
        changed = copy.deepcopy(fresh)
        changed['meshes'][0]['primitives'].reverse()
        with self.assertRaisesRegex(ValueError, 'material mapping'):
            materials.validate_converted_binding(changed, b'original', fresh, b'original')
        changed = copy.deepcopy(fresh)
        changed['skins'][0]['joints'] = [1]
        with self.assertRaisesRegex(ValueError, 'skeleton'):
            materials.validate_converted_binding(changed, b'original', fresh, b'original')


if __name__ == '__main__':
    unittest.main()
