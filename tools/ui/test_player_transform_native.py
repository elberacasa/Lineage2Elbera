"""Elbera Tools source-free checks for the bounded placement/basis auditor."""
import math
import struct
import unittest

from check_player_transform_native import (
    accessor_positions, actor_floor_reference, converted_position,
    core_matrix_product, core_transform_point, f32, subtract_mesh_origin,
)


class PlacementTests(unittest.TestCase):
    def test_origin_is_transformed_by_full_basis_not_subtracted_in_world_axes(self):
        # Local X maps to world +Y, local Y to world -X, local Z doubles.
        basis = [[0, 1, 0], [-1, 0, 0], [0, 0, 2]]
        self.assertEqual(subtract_mesh_origin(basis, [100, 200, 300], [3, 5, 7]),
                         [105, 197, 286])
        self.assertEqual(basis, [[0, 1, 0], [-1, 0, 0], [0, 0, 2]])

    def test_origin_adjustment_keeps_intermediate_float32_store(self):
        # The local dot product is rounded before it is added to translation.
        basis = [[1, 0, 0], [1, 1, 0], [0, 0, 1]]
        result = subtract_mesh_origin(basis, [16777216, 0, 0], [16777216, 1, 0])
        self.assertEqual(result, [0, -1, 0])
        self.assertNotEqual(result[0], f32(16777216 - 16777216 - 1))

    def test_floor_reference_is_a_comparison_not_mesh_height(self):
        self.assertEqual(actor_floor_reference([100, -200, 60], 23.5), [100, -200, 36.5])
        # Negative floor/world positions are legal; never clamp to zero.
        self.assertEqual(actor_floor_reference([0, 0, -20], 30), [0, 0, -50])

    def test_invalid_numeric_inputs_fail_closed(self):
        for invalid in (float('nan'), float('inf'), True, '23'):
            with self.assertRaises(ValueError): actor_floor_reference([0, 0, 1], invalid)
        with self.assertRaises(ValueError): subtract_mesh_origin([[1, 0, 0]] * 2, [0, 0, 0], [0, 0, 0])
        with self.assertRaises(ValueError): converted_position([1, 2])

    def test_asymmetric_source_basis_distinguishes_reflection(self):
        point = [2, -5, 7]
        plus = converted_position(point)
        minus = converted_position(point, -1)
        self.assertEqual(plus, (f32(.02), f32(.07), f32(-.05)))
        self.assertEqual(minus[2], -plus[2])
        self.assertNotEqual(plus, minus)
        with self.assertRaises(ValueError): converted_position(point, 0)


class CoreMatrixTests(unittest.TestCase):
    def test_row_vector_composition_distinguishes_order(self):
        scale = [[2, 0, 0, 0], [0, 3, 0, 0], [0, 0, 4, 0], [0, 0, 0, 1]]
        translate = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [10, 20, 30, 1]]
        self.assertEqual(core_transform_point(core_matrix_product(scale, translate), [1, 2, 3]),
                         [12, 26, 42])
        self.assertEqual(core_transform_point(core_matrix_product(translate, scale), [1, 2, 3]),
                         [22, 66, 132])
        self.assertEqual(translate[3], [10, 20, 30, 1])

    def test_product_keeps_precision_until_component_store(self):
        # Rounding the running sum to f32 loses the +1 before cancellation.
        left = [[16777216, 1, -16777216, 0]] * 4
        right = [[1, 0, 0, 0]] * 4
        self.assertEqual(core_matrix_product(left, right)[0], [1, 0, 0, 0])
        self.assertEqual(f32(f32(16777216 + 1) - 16777216), 0)

    def test_transform_uses_w_one_and_does_not_divide_by_output_w(self):
        matrix = [[0, 2, 0, 10], [-3, 0, 0, 20], [0, 0, 4, 30], [5, 7, 11, 100]]
        self.assertEqual(core_transform_point(matrix, [2, 3, 5]), [-4, 11, 31])

    def test_transform_keeps_precision_until_component_store(self):
        matrix = [[1, 0, 0, 0], [1, 0, 0, 0], [-1, 0, 0, 0], [0, 0, 0, 1]]
        self.assertEqual(core_transform_point(matrix, [16777216, 1, 16777216]), [1, 0, 0])

    def test_invalid_matrix_and_point_fail_closed(self):
        identity = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
        for invalid in (None, identity[:3], [None] * 4, [[1, 2, 3]] * 4,
                        [[1, 2, 3, math.inf]] * 4, [[1, 2, 3, True]] * 4):
            with self.assertRaises(ValueError): core_matrix_product(identity, invalid)
            with self.assertRaises(ValueError): core_transform_point(invalid, [1, 2, 3])
        with self.assertRaises(ValueError): core_transform_point(identity, [1, 2, math.nan])


class AccessorTests(unittest.TestCase):
    def fixture(self):
        # Padding outside and inside a view catches whole-buffer bounds errors.
        data = b'HEAD' + b'pad!' + struct.pack('<3fI3f', 1, 2, 3, 99, -4, 5, -6) + b'outside-padding'
        gltf = {'meshes': [{'name': 'Original_Part', 'primitives': [{'attributes': {'POSITION': 0}}]}],
                'accessors': [{'type': 'VEC3', 'componentType': 5126, 'bufferView': 0,
                               'count': 2, 'byteOffset': 4}],
                'bufferViews': [{'buffer': 0, 'byteOffset': 4, 'byteLength': 32, 'byteStride': 16}]}
        return gltf, [data]

    def test_interleaved_accessor_offsets_are_respected(self):
        gltf, buffers = self.fixture()
        self.assertEqual(accessor_positions(gltf, buffers, 'original_part'),
                         {(1, 2, 3), (-4, 5, -6)})

    def test_bounds_use_view_not_larger_underlying_buffer(self):
        gltf, buffers = self.fixture()
        gltf['bufferViews'][0]['byteLength'] = 31
        with self.assertRaisesRegex(ValueError, 'buffer view'):
            accessor_positions(gltf, buffers, 'Original_Part')

    def test_ambiguous_mesh_and_sparse_accessor_are_rejected(self):
        gltf, buffers = self.fixture()
        gltf['meshes'].append(dict(gltf['meshes'][0], name='ORIGINAL_PART'))
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            accessor_positions(gltf, buffers, 'original_part')
        gltf['meshes'].pop()
        gltf['accessors'][0]['sparse'] = {}
        with self.assertRaisesRegex(ValueError, 'unsupported'):
            accessor_positions(gltf, buffers, 'original_part')

    def test_nonfinite_position_is_not_an_equality_match(self):
        gltf, buffers = self.fixture()
        data = bytearray(buffers[0]); struct.pack_into('<f', data, 8, math.nan)
        with self.assertRaisesRegex(ValueError, 'finite'):
            accessor_positions(gltf, [data], 'original_part')


if __name__ == '__main__':
    unittest.main()
