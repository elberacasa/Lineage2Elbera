"""Portable adversarial fixtures for the exported castEnd input audit."""
import copy
import struct
import unittest

from check_cast_loop_inputs import check_tracks


def fixture(times=(0, 1), values=(4, 5, 6, 4, 5, 6)):
    tb, vb = struct.pack('<%df' % len(times), *times), struct.pack('<%df' % len(values), *values)
    g = {'animations': [{'name': 'castEnd', 'samplers': [{'input': 0, 'output': 1}],
                         'channels': [{'sampler': 0, 'target': {'node': 0, 'path': 'translation'}}]}],
         'bufferViews': [{'byteOffset': 0, 'byteLength': len(tb)}, {'byteOffset': len(tb), 'byteLength': len(vb)}],
         'accessors': [{'bufferView': 0, 'componentType': 5126, 'type': 'SCALAR', 'count': len(times)},
                       {'bufferView': 1, 'componentType': 5126, 'type': 'VEC3', 'count': len(values) // 3}]}
    return g, tb + vb


class LoopInputsTest(unittest.TestCase):
    def test_accepts_only_exact_dense_times_or_byte_constant_endpoints(self):
        g, b = fixture(); self.assertEqual(check_tracks(g, b, 'castEnd', 3, 2)['constantEndpoints'], 1)
        g, b = fixture((0, .5, 1), (1, 0, 0, 2, 0, 0, 4, 0, 0))
        self.assertEqual(check_tracks(g, b, 'castEnd', 3, 2)['dense'], 1)

    def test_rejects_changed_pair_time_shape_and_nonfinite_values(self):
        for times, values in [((0, 1), (4, 5, 6, 7, 5, 6)),
                              ((0, .9), (4, 5, 6, 4, 5, 6)),
                              ((0, .4, 1), (1, 0, 0, 2, 0, 0, 4, 0, 0)),
                              ((0, 1), (float('nan'), 5, 6, float('nan'), 5, 6)),
                              ((0, 1), (0., 5, 6, -0., 5, 6))]:
            g, b = fixture(times, values)
            with self.assertRaises(ValueError): check_tracks(g, b, 'castEnd', 3, 2)

    def test_rejects_empty_duplicate_channel_and_interpolation_changes(self):
        g, b = fixture()
        for change in ('empty', 'duplicate', 'step', 'stride'):
            changed = copy.deepcopy(g)
            if change == 'empty': changed['animations'][0]['channels'] = []
            if change == 'duplicate': changed['animations'][0]['channels'] *= 2
            if change == 'step': changed['animations'][0]['samplers'][0]['interpolation'] = 'STEP'
            if change == 'stride': changed['bufferViews'][1]['byteStride'] = 16
            with self.assertRaises(ValueError): check_tracks(changed, b, 'castEnd', 3, 2)


if __name__ == '__main__':
    unittest.main()
