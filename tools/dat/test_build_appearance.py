"""Elbera Tools portable face-part binding tests; no original assets read."""
import copy
import unittest
from build_appearance import face_binding, unique, verify_face_pixels


def fixture():
    return {'meshes': [{'name': 'ExactFace', 'primitives': [{'attributes': {'TEXCOORD_0': 1}, 'material': 0}]}],
            'nodes': [{'name': 'ExactFace', 'mesh': 0, 'skin': 1}],
            'materials': [{'name': 'ExactMaterial', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}}}],
            'textures': [{'source': 0}], 'images': [{'uri': 'source.png'}]}


class FaceBindingTests(unittest.TestCase):
    def test_original_pixels_require_exact_alpha_and_rgb(self):
        rgba = bytes([10, 20, 30, 40])
        verify_face_pixels(1, 1, rgba, (1, 1), rgba)
        for channel in range(4):
            different = bytearray(rgba); different[channel] += 1
            with self.assertRaises(ValueError): verify_face_pixels(1, 1, rgba, (1, 1), bytes(different))

    def test_pixel_dimensions_and_payload_length(self):
        with self.assertRaises(ValueError): verify_face_pixels(1, 1, bytes(4), (2, 1), bytes(8))
        with self.assertRaises(ValueError): verify_face_pixels(1, 1, bytes(4), (1, 1), bytes(3))

    def test_exact_binding(self):
        self.assertEqual(face_binding(fixture(), 'ExactFace'),
                         {'nodeName': 'ExactFace', 'materialName': 'ExactMaterial', 'defaultImage': 'source.png'})

    def test_absent_and_duplicate_source_identity_rejected(self):
        for entries in ([], [1, 2]):
            with self.assertRaises(ValueError): unique(entries, 'source')
        data = fixture()
        with self.assertRaises(ValueError): face_binding(data, 'Guess_f')
        data['nodes'].append(copy.deepcopy(data['nodes'][0]))
        with self.assertRaises(ValueError): face_binding(data, 'ExactFace')

    def test_shared_material_and_nonlocal_image_rejected(self):
        data = fixture(); data['meshes'].append({'name': 'Body', 'primitives': [{'material': 0}]})
        with self.assertRaises(ValueError): face_binding(data, 'ExactFace')
        data = fixture(); data['images'][0]['uri'] = '../other.png'
        with self.assertRaises(ValueError): face_binding(data, 'ExactFace')

    def test_multisection_or_unbound_uv_rejected(self):
        data = fixture(); data['meshes'][0]['primitives'] *= 2
        with self.assertRaises(ValueError): face_binding(data, 'ExactFace')
        data = fixture(); data['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['texCoord'] = 1
        with self.assertRaises(ValueError): face_binding(data, 'ExactFace')


if __name__ == '__main__': unittest.main()
