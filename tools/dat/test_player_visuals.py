"""Portable Elbera Tools player-scale arithmetic and input-binding tests."""
import json
from pathlib import Path
import tempfile
import unittest

from export_player_visuals import built_model, common_mesh_scale, exact_browser_scale, f32


class PlayerVisualTests(unittest.TestCase):
    def test_exact_multiply_stores_and_axis_swap(self):
        self.assertEqual(exact_browser_scale(1,[1,1,1],[1.0299999713897705]*3),[1.0299999713897705]*3)
        self.assertEqual(exact_browser_scale(2,[3,5,7],[11,13,17]),[66,238,130])
        self.assertEqual(exact_browser_scale(0,[3,5,7],[11,13,17]),[0,0,0])
        self.assertEqual(exact_browser_scale(1.3,[.7,.8,.9],[1.03,1.04,1.05]),
                         [f32(f32(f32(1.3)*f32(.7))*f32(1.03)),
                          f32(f32(f32(1.3)*f32(.9))*f32(1.05)),
                          f32(f32(f32(1.3)*f32(.8))*f32(1.04))])

    def test_missing_divergent_or_nonfinite_parts_have_no_root_scale(self):
        self.assertEqual(common_mesh_scale([{'meshScale':[1,2,3]},{'meshScale':[1,2,3]}]),[1,2,3])
        for parts in ([],[{'meshScale':[1,2,3]},{'meshScale':[1,2,4]}],[{'meshScale':[1,2]}]):
            with self.assertRaises(ValueError):common_mesh_scale(parts)
        for value in (float('inf'),float('nan'),1e40,True):
            with self.assertRaises(ValueError):exact_browser_scale(value,[1,1,1],[1,1,1])
        with self.assertRaises(ValueError):exact_browser_scale(1e30,[1e30]*3,[1]*3)

    def test_built_fingerprints_change_with_bytes_and_transformed_instances_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'model.bin').write_bytes(b'data')
            gltf={'asset':{'generator':'l2vzla char_pipeline (psk full-skeleton)'},
                  'buffers':[{'uri':'model.bin','byteLength':4}],
                  'meshes':[{'name':'OriginalPart'}],
                  'nodes':[{'name':'OriginalPart','mesh':0}], 'scenes':[{'nodes':[0]}]}
            path=root/'model.gltf';path.write_text(json.dumps(gltf))
            names,before=built_model({'gltf':'model.gltf'},root)
            self.assertEqual(names,['OriginalPart'])
            (root/'model.bin').write_bytes(b'new!')
            _,after=built_model({'gltf':'model.gltf'},root)
            self.assertNotEqual(before['buffers'][0]['SHA256'],after['buffers'][0]['SHA256'])
            gltf['nodes'][0]['scale']=[2,2,2];path.write_text(json.dumps(gltf))
            with self.assertRaisesRegex(ValueError,'transform'):built_model({'gltf':'model.gltf'},root)
            gltf['nodes'][0].pop('scale');gltf['buffers'][0]['uri']='../outside.bin';path.write_text(json.dumps(gltf))
            with self.assertRaisesRegex(ValueError,'nonlocal'):built_model({'gltf':'model.gltf'},root)


if __name__ == '__main__':unittest.main()
