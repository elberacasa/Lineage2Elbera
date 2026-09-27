"""Elbera Tools portable hair decoder/binding tests; no client files required."""
import copy
from pathlib import Path
import struct
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from build_hair import (accessor, built_binding, read_material_properties, source_lod0,
                       source_vertex_key, typed_properties, validate_lod0, write_verified,
                       output_path, ROOT)
from l2lib.ue2package import Reader, L2Error, encode_compact


def source_fixture():
    bones = [{'name': 'Root', 'parent': 0, 'orientation': [0, 0, 0, 1], 'position': [0, 0, 0]},
             {'name': 'Head', 'parent': 0, 'orientation': [0, 0, 0, 1], 'position': [0, 0, 10]}]
    mesh = {'name': 'SourceHair', 'bones': bones, 'stream': 'rigid',
        'vertices': [{'position': list(p), 'normal': [0, 0, 512], 'uv': list(uv)} for p, uv in
                     [((0, 0, 0), (0, 0)), ((100, 0, 0), (1, 0)), ((0, 100, 0), (0, 1))]],
        'rigidSections': [{'firstFace': 0, 'numFaces': 1, 'minWedge': 0, 'maxWedge': 2, 'bone': 0, 'material': 0}],
        'softSections': [], 'rigidIndices': [0, 1, 2], 'softIndices': [],
        'materialSlots': [{'polyFlags': 0, 'textureIndex': 0}]}
    validate_lod0(mesh)
    return mesh


def built_fixture(mesh, joint=0):
    blob = bytearray()
    gltf = {'nodes': [{'name': 'Root', 'children': [1]}, {'name': 'Head'},
                      {'name': 'SourceHair', 'mesh': 0, 'skin': 0}],
            'skins': [{'joints': [0, 1]}], 'bufferViews': [], 'accessors': [],
            'materials': [{'name': 'HairMaterial'}]}
    def ac(values, typ, code):
        raw = b''.join(struct.pack('<' + code * len(v), *v) for v in values)
        gltf['bufferViews'].append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(raw)})
        gltf['accessors'].append({'bufferView': len(gltf['bufferViews']) - 1, 'componentType': 5126 if code == 'f' else 5123,
                                  'count': len(values), 'type': typ})
        blob.extend(raw)
        return len(gltf['accessors']) - 1
    keys = [source_vertex_key(v) for v in mesh['vertices']]
    attrs = {'POSITION': ac([k[:3] for k in keys], 'VEC3', 'f'),
             'TEXCOORD_0': ac([k[3:] for k in keys], 'VEC2', 'f'),
             'JOINTS_0': ac([(joint, 0, 0, 0)] * 3, 'VEC4', 'H'),
             'WEIGHTS_0': ac([(1, 0, 0, 0)] * 3, 'VEC4', 'f')}
    gltf['meshes'] = [{'name': 'SourceHair', 'primitives': [{'attributes': attrs, 'indices': ac([(1,), (2,), (0,)], 'SCALAR', 'H'), 'material': 0}]}]
    return gltf, [bytes(blob)]


def serialized_fixture():
    """An independently laid out minimal rigid version-5 LOD0 export."""
    data = bytearray(struct.pack('<6f3i', 1, 1, 1, 0, 0, 0, 0, 0, 0))
    def array(raw=b'', n=0):
        data.extend(encode_compact(n)); data.extend(raw)
    for _ in range(4): array()
    array(struct.pack('<Ii', 0, 0), 1)
    data.extend(bytes(24)); data.extend(struct.pack('<i', 0)); data.extend(b'\0'); data.extend(bytes(52)); data.extend(bytes(8))
    array()  # Points2
    data.extend(b'\1')  # RefSkeleton count
    data.extend(b'\0')  # root name
    data.extend(struct.pack('<I4f3ff3fii', 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0))
    data.extend(b'\0' + bytes(4))  # animation reference and depth
    for _ in range(5): array()  # weight indices/influences/aliases/bone names/coords
    data.extend(b'\1')  # LOD count
    array(); array(); data.extend(bytes(4))
    array()  # soft sections
    array(struct.pack('<9H', 0, 0, 0, 2, 3, 0, 0, 0, 1) + b'\0', 1)
    array(); data.extend(bytes(4))
    array(struct.pack('<3H', 0, 1, 2), 3); data.extend(bytes(4))
    data.extend(bytes(12))
    verts = [(0, 0, 0, 0, 0, 512, 0, 0), (100, 0, 0, 0, 0, 512, 1, 0), (0, 100, 0, 0, 0, 512, 0, 1)]
    array(b''.join(struct.pack('<8f', *v) for v in verts), 3)
    lazy_positions = []
    for _ in range(4):
        lazy_positions.append(len(data)); data.extend(struct.pack('<i', len(data) + 5)); array()
    data.extend(bytes(24)); data.extend(bytes(4)); array()
    pkg = SimpleNamespace(data=bytes(data), file_version=123, licensee_version=28,
                          name=lambda _: 'Root', export_name=lambda _: 'SourceHair')
    exp = SimpleNamespace(serial_offset=0, serial_size=len(data))
    return pkg, exp, lazy_positions


class HairSourceTests(unittest.TestCase):
    def test_raw_lod_stream_preserves_original_indices_normals_and_weights(self):
        pkg, exp, _ = serialized_fixture()
        with patch('export_npc_visuals.original_mesh_scale', return_value=([1, 1, 1], 5, 0)):
            result = source_lod0(pkg, exp)
        self.assertEqual(result['rigidIndices'], [0, 1, 2])
        self.assertEqual(result['vertices'][1]['position'], [100, 0, 0])
        self.assertEqual(result['vertices'][1]['normal'], [0, 0, 512])
        self.assertEqual(result['vertices'][1]['sourceInfluences'], [[0, 1.0]])
        self.assertEqual(result['sourceLOD0']['end'], exp.serial_size)

    def test_lazy_end_is_absolute_exact_and_export_bounded(self):
        pkg, exp, offsets = serialized_fixture()
        for change in (-1, 1, 100000):
            raw = bytearray(pkg.data); at = offsets[2]
            struct.pack_into('<i', raw, at, struct.unpack_from('<i', raw, at)[0] + change)
            broken = copy.copy(pkg); broken.data = bytes(raw)
            with patch('export_npc_visuals.original_mesh_scale', return_value=([1, 1, 1], 5, 0)):
                with self.assertRaisesRegex(ValueError, 'boundary'):
                    source_lod0(broken, exp)
        with patch('export_npc_visuals.original_mesh_scale', return_value=([1, 1, 1], 5, 0)):
            with self.assertRaises(L2Error):
                source_lod0(pkg, SimpleNamespace(serial_offset=0, serial_size=exp.serial_size - 1))

    def test_soft_source_weights_not_renormalized_or_rebound(self):
        mesh = source_fixture(); mesh['stream'] = 'soft'
        mesh['softSections'] = [dict(mesh['rigidSections'][0], boneMap=[1, 0])]
        mesh['rigidSections'] = []; mesh['softIndices'] = mesh.pop('rigidIndices'); mesh['rigidIndices'] = []
        for v in mesh['vertices']:
            v.update(localBones=[0, 1, 255, 255], weights=[.2, .79997, 0, 0])
        validate_lod0(mesh)
        self.assertEqual(mesh['vertices'][0]['sourceInfluences'], [[1, .2], [0, .79997]])
        for key, value in [('localBones', [3, 1, 255, 255]), ('weights', [.2, .79997, .01, 0])]:
            broken = copy.deepcopy(mesh); broken['vertices'][0][key] = value
            with self.assertRaises(ValueError): validate_lod0(broken)

    def test_source_sections_parent_and_finite_boundaries(self):
        for mutate in [lambda m: m['bones'][0].update(parent=1),
                       lambda m: m['vertices'][0]['uv'].__setitem__(0, float('nan')),
                       lambda m: m['rigidIndices'].__setitem__(0, 4),
                       lambda m: m['rigidSections'][0].update(material=2),
                       lambda m: m['rigidSections'].append(dict(m['rigidSections'][0]))]:
            mesh = source_fixture(); mutate(mesh)
            with self.assertRaises(ValueError): validate_lod0(mesh)

    def test_built_geometry_and_source_skin_admission_are_separate(self):
        mesh = source_fixture()
        gltf, buffers = built_fixture(mesh)
        self.assertEqual(built_binding(gltf, buffers, mesh)['skinProof']['status'], 'source-influences-match')
        gltf, buffers = built_fixture(mesh, joint=1)
        proof = built_binding(gltf, buffers, mesh)
        self.assertEqual(proof['skinProof']['differentInfluenceVertices'], 3)
        self.assertEqual(proof['materials'][0]['sourceTextureIndex'], 0)

    def test_built_uv_winding_and_shared_material_cannot_pass_position_only(self):
        mesh = source_fixture(); gltf, buffers = built_fixture(mesh)
        wrong = copy.deepcopy(mesh); wrong['vertices'][0]['uv'] = [.5, .5]
        with self.assertRaisesRegex(ValueError, 'position/UV/winding'):
            built_binding(gltf, buffers, wrong)
        wrong = copy.deepcopy(mesh); wrong['rigidIndices'] = [0, 2, 1]
        with self.assertRaisesRegex(ValueError, 'position/UV/winding'):
            built_binding(gltf, buffers, wrong)
        gltf['meshes'].append({'name': 'Body', 'primitives': [{'material': 0}]})
        with self.assertRaisesRegex(ValueError, 'shared'):
            built_binding(gltf, buffers, mesh)

    def test_built_accessor_cannot_overrun_view(self):
        gltf, buffers = built_fixture(source_fixture())
        gltf['accessors'][0]['count'] = 100
        with self.assertRaisesRegex(ValueError, 'outside'):
            accessor(gltf, buffers, 0)

    def test_packed_material_types_duplicates_arrays_and_widths_are_strict(self):
        names = ['None', 'AlphaRef', 'AlphaTest', 'USize']
        pkg = SimpleNamespace(name=lambda i: names[i])
        self.assertEqual(read_material_properties(pkg, Reader(bytes([1, 1, 5, 2, 211, 0, 0]))),
                         {'AlphaRef': b'\5', 'AlphaTest': True})
        for raw in [bytes([1, 1, 5, 1, 1, 5, 0]), bytes([1, 2, 5, 0]),
                    bytes([1, 129, 0]), bytes([3, 2, 0, 0])]:
            with self.assertRaises(ValueError): read_material_properties(pkg, Reader(raw))
        self.assertEqual(typed_properties({'AlphaRef': {'raw': '96'}, 'AlphaTest': False}),
                         {'AlphaRef': 150, 'AlphaTest': False})
        with self.assertRaises(ValueError): typed_properties({'AlphaRef': {'raw': '9600'}})

    def test_internal_time_two_int_elements_are_preserved_without_duplicate_overwrite(self):
        pkg = SimpleNamespace(name=lambda i: ['None', 'InternalTime'][i])
        raw = bytes([1, 0x22]) + struct.pack('<i', 12) + bytes([1, 0xa2, 1]) + struct.pack('<i', 34) + b'\0'
        result = read_material_properties(pkg, Reader(raw))
        self.assertEqual(result['InternalTime'], {0: struct.pack('<i', 12), 1: struct.pack('<i', 34)})
        duplicate = raw[:-1] + bytes([1, 0xa2, 1]) + struct.pack('<i', 56) + b'\0'
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            read_material_properties(pkg, Reader(duplicate))

    def test_absolute_lazy_ends_with_nonzero_export_offset(self):
        pkg, exp, offsets = serialized_fixture()
        prefix = b'X' * 64
        raw = bytearray(pkg.data)
        for at in offsets:
            struct.pack_into('<i', raw, at, struct.unpack_from('<i', raw, at)[0] + len(prefix))
        pkg.data = prefix + raw
        exp.serial_offset = len(prefix)
        with patch('export_npc_visuals.original_mesh_scale', return_value=([1, 1, 1], 5, len(prefix))):
            result = source_lod0(pkg, exp)
        self.assertEqual(result['sourceLOD0']['end'], exp.serial_offset + exp.serial_size)

    def test_check_never_repairs_private_output(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'hair.json'
            write_verified(path, b'original', False)
            write_verified(path, b'original', True)
            with self.assertRaises(ValueError): write_verified(path, b'changed', True)
            self.assertEqual(path.read_bytes(), b'original')

    def test_original_input_output_path_is_rejected(self):
        with self.assertRaises(ValueError):
            output_path(ROOT / 'assets/interlude/systextures/hair.png')
        with tempfile.TemporaryDirectory() as temp:
            link = Path(temp) / 'original'; link.symlink_to(ROOT / 'assets/interlude', target_is_directory=True)
            with self.assertRaises(ValueError): output_path(link / 'hair.json')


if __name__ == '__main__':
    unittest.main()
