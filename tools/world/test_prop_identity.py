"""Elbera Tools: portable qualified-prop repair tests; no client assets."""
import json
from pathlib import Path
import struct
import tempfile
from contextlib import ExitStack, contextmanager
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import convert as c


def actor(group, *, x=1, name=None):
    return {"name": name or group, "mesh": {"package": "Objects", "name": "Box",
        "qualified": "Objects." + group + ".Box"}, "location": [x, 2, 3],
        "rotation": [0, 100, 0], "draw_scale": 2, "draw_scale3d": [1, 2, 3]}


def row(a):
    return {"mesh": "Objects.Box", "gltf": "props/Box.gltf",
            "position": a["location"], "rotation": a["rotation"],
            "scale": [a["draw_scale"] * v for v in a["draw_scale3d"]]}


def mesh(path, offset=0):
    """One source-derived triangle, with a sibling buffer of the same leaf."""
    points = [(100 + offset, 200, 300), (0, 50, 0), (20, 30, 40)]
    f32 = lambda x: struct.unpack('<f', struct.pack('<f', x))[0]
    scale = f32(.01)
    positions = [(f32(p[0]*scale), f32(p[2]*scale), f32(p[1]*scale)) for p in points]
    data = b''.join(struct.pack('<3f', *p) for p in positions) + struct.pack('<3H', 0, 1, 2)
    g = {"asset": {"version": "2.0"}, "nodes": [{"mesh": 0}],
         "buffers": [{"uri": "Box.bin", "byteLength": len(data)}],
         "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 36},
                         {"buffer": 0, "byteOffset": 36, "byteLength": 6}],
         "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
                       {"bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR"}],
         "materials": [{"name": "Wood"}],
         "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1, "material": 0}]}]}
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(g)); path.with_suffix('.bin').write_bytes(data)
    return {"materials": ["Textures.Group.Wood"], "triangles": [[points]]}


def package_fixture(package, groups):
    exports = []
    for group in groups:
        exports.append(SimpleNamespace(index=len(exports), name=group, package_index=0,
                                       cls='Package', serial_offset=0, serial_size=0))
        exports.append(SimpleNamespace(index=len(exports), name='Box', package_index=len(exports),
                                       cls='StaticMesh', serial_offset=0, serial_size=4))
    return SimpleNamespace(path=package + '.usx', exports=exports, data=b'mesh',
        resolve_ref=lambda i: exports[i-1], export_name=lambda e: e.name, class_name_of=lambda e: e.cls)


@contextmanager
def converter_fixture(packages, *, export_filter=lambda package, group: True):
    """Stub source/archive I/O and painting; run actual qualification/copy logic."""
    originals = {name.casefold(): package_fixture(name, groups) for name, groups in packages.items()}
    evidence = {}
    def export(path, directory):
        name = Path(path).stem
        for group, offset in packages[name].items():
            if export_filter(name, group):
                evidence[name + '.' + group + '.Box'] = mesh(Path(directory) / name / group / 'Box.gltf', offset)
        return True
    with ExitStack() as stack:
        stack.enter_context(patch.object(c, 'find_usx', side_effect=lambda name:
            next((key + '.usx' for key in packages if key.casefold() == name.casefold()), None)))
        stack.enter_context(patch.object(c, 'load_package', side_effect=lambda path:
            (originals[Path(path).stem.casefold()], None)))
        stack.enter_context(patch.object(c, 'umodel_export_package', side_effect=export))
        stack.enter_context(patch.object(c, 'PropTextureResolver', return_value=SimpleNamespace(add_export_tree=lambda path: None)))
        stack.enter_context(patch.object(c, 'patch_gltf_textures'))
        yield evidence, originals


class PropIdentityTest(unittest.TestCase):
    def properties(self, raw, **kwargs):
        names = ['None', 'Field', 'Flag', 'Vector']
        pkg = SimpleNamespace(path='authored.unr', data=raw, name=lambda n: names[n])
        return c.read_props_ordered(pkg, 0, **kwargs)

    def test_packed_indices_preserve_original_one_two_and_four_byte_order(self):
        # Literal byte sequences from the source layout, no encoder round trip.
        for encoded, expected in [(b'\x00', 0), (b'\x7f', 127),
                (b'\x80\x80', 128), (b'\xbf\xff', 16383),
                (b'\xc0\x00\x40\x00', 16384), (b'\xc1\x02\x03\x04', 16909060),
                (b'\xff\xff\xff\xff', 1073741823)]:
            with self.subTest(index=expected):
                raw = b'\x01\xa2' + encoded + b'ABCD' + b'\x01\x22EFGH\0'
                props, end = self.properties(raw)
                self.assertEqual([p['index'] for p in props], [expected, 0])
                self.assertEqual([p['raw'] for p in props], [b'ABCD', b'EFGH'])
                self.assertEqual([p['name'] for p in props], ['Field', 'Field'])
                self.assertEqual(end, len(raw))

    def test_boolean_uses_tag_bit_without_reading_payload_or_array_index(self):
        for bit in (0, 128):
            for selector, size_bytes, size in [(0, b'', 1), (3, b'', 12),
                    (5, b'\0', 0), (5, b'\xff', 255),
                    (6, b'\x00\x01', 256), (7, b'\xff' * 4, 4294967295)]:
                with self.subTest(bit=bit, selector=selector):
                    raw = bytes([2, bit | selector << 4 | 3]) + size_bytes + b'\x01\x22ABCD\0'
                    props, end = self.properties(raw)
                    self.assertEqual(props[0], dict(name='Flag', type=3, size=size,
                        struct=None, index=0, raw=b'', boolval=bool(bit)))
                    self.assertEqual(props[1]['raw'], b'ABCD')
                    self.assertEqual(end, len(raw))

    def test_packed_export_bounds_cannot_borrow_next_export_bytes(self):
        raw = b'\x01\xa2\xc1\x02\x03\x04ABCD\0'
        for end in range(len(raw)):
            with self.subTest(end=end), self.assertRaises(c.L2Error):
                self.properties(raw, end=end)
        self.assertEqual(self.properties(raw, end=len(raw))[1], len(raw))
        for end in (-1, len(raw)+1, True, 1.5):
            with self.assertRaisesRegex(c.L2Error, 'boundary'):
                self.properties(raw, end=end)

    def test_object_reference_retains_legacy_fields_and_full_group(self):
        names = ['Objects', 'Town', 'Box', 'Core', 'StaticMesh']
        imports = [SimpleNamespace(object_name=0, package_index=0),
                   SimpleNamespace(object_name=1, package_index=-1),
                   SimpleNamespace(object_name=2, package_index=-2, class_name=4, class_package=3)]
        pkg = SimpleNamespace(path='Map.unr', imports=imports, name=lambda n: names[n],
            resolve_ref=lambda i: imports[-i-1], import_name=lambda o: names[o.object_name])
        self.assertEqual(c.prop_objref(pkg, b'\x83'), {
            'package': 'Objects', 'class': 'StaticMesh', 'name': 'Box', 'qualified': 'Objects.Town.Box'})
        self.assertIsNone(c.prop_objref(pkg, b'\0'))
        imports[1].package_index = -3
        with self.assertRaisesRegex(c.L2Error, 'cyclic'): c.prop_objref(pkg, b'\x83')

    def test_full_conversion_refuses_unknown_qualification_before_any_output(self):
        invalid = actor('Town'); del invalid['mesh']['qualified']
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'does-not-exist'
            with self.assertRaisesRegex(c.L2Error, 'qualified prop reference'):
                c.convert_props('0_0', [invalid], str(output))
            self.assertFalse(output.exists())
            with patch.object(c, 'load_package', return_value=(object(), None)), \
                    patch.object(c, 'read_static_mesh_actors', return_value=[invalid]), \
                    patch.object(c.os, 'makedirs') as mkdir:
                with self.assertRaisesRegex(c.L2Error, 'qualified prop reference'): c.convert_tile('0_0')
                mkdir.assert_not_called()

    def test_singleton_map_uses_requested_group_despite_another_package_leaf_variant(self):
        # The unrequested duplicate is exported first. Basename-first lookup
        # would pick its distinct geometry even though this map uses only Town.
        with tempfile.TemporaryDirectory() as tmp, converter_fixture({'Objects': {'Home': 700, 'Town': 0}}) as (proof, _):
            props, stats = c.convert_props('0_0', [actor('Town')], tmp)
            self.assertEqual(props[0]['mesh'], 'Objects.Box')
            self.assertEqual(props[0]['sourceMesh'], 'Objects.Town.Box')
            c._repair_verify_geometry(Path(tmp) / props[0]['gltf'], proof['Objects.Town.Box'], proper=True)
            self.assertEqual(stats['unique_meshes'], 1)
            self.assertEqual(len(list((Path(tmp) / 'props').glob('*.gltf'))), 1)

    def test_full_conversion_keeps_both_groups_and_cross_package_buffers_distinct(self):
        other = actor('Town', x=12, name='OtherActor')
        other['mesh'].update(package='Other', qualified='Other.Town.Box')
        actors = [actor('Town'), actor('Home', x=8), other]
        with tempfile.TemporaryDirectory() as tmp, converter_fixture({
                'Objects': {'Home': 700, 'Town': 0}, 'Other': {'Town': 1400}}) as (proof, _):
            props, stats = c.convert_props('0_0', actors, tmp)
            self.assertEqual(stats['unique_meshes'], 3)
            self.assertEqual(stats['packages_found'], 2)
            self.assertEqual(len({p['gltf'] for p in props}), 3)
            for prop in props:
                path = Path(tmp) / prop['gltf']
                c._repair_verify_geometry(path, proof[prop['sourceMesh']], proper=True)
                g, _ = c._repair_buffer(path)
                self.assertEqual(g['buffers'][0]['uri'], prop['sourceMesh'] + '.bin')
                self.assertEqual(g['asset']['extras']['sourceMesh'], prop['sourceMesh'])

    def test_missing_group_never_borrows_geometry_from_other_group_or_package(self):
        other = actor('Town', x=12, name='OtherActor')
        other['mesh'].update(package='Other', qualified='Other.Town.Box')
        with tempfile.TemporaryDirectory() as tmp, converter_fixture({
                'Objects': {'Home': 700, 'Town': 0}, 'Other': {'Town': 1400}},
                export_filter=lambda package, group: package != 'Objects' or group != 'Town'):
            output = Path(tmp) / 'out'
            with self.assertRaisesRegex(c.L2Error, 'missing exact grouped mesh export Objects.Town.Box'):
                c.convert_props('0_0', [other, actor('Town')], str(output))
            self.assertFalse(output.exists(), 'all exact export paths must resolve before copying output')

    def test_original_source_identity_must_resolve_uniquely_before_export(self):
        with converter_fixture({'Objects': {'Town': 0}}) as (_, originals):
            with self.assertRaisesRegex(c.L2Error, 'missing/ambiguous qualified StaticMesh source'):
                c._qualified_prop_sources([actor('Home')])
            pkg = originals['objects']
            duplicate = SimpleNamespace(**vars(pkg.exports[-1])); duplicate.index = len(pkg.exports)
            pkg.exports.append(duplicate)
            with self.assertRaisesRegex(c.L2Error, 'missing/ambiguous qualified StaticMesh source'):
                c._qualified_prop_sources([actor('Town')])

    def test_duplicate_leaf_buffers_remain_paired_after_unique_renaming(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for group, offset in [('Town', 0), ('Home', 700)]:
                src = root / 'raw' / 'Objects' / group / 'Box.gltf'
                source = mesh(src, offset)
                raw_bytes = src.with_suffix('.bin').read_bytes()
                c._repair_verify_geometry(src, source)
                dst = root / 'staged' / ('Objects.' + group + '.Box.gltf')
                c._repair_copy_mesh(src, dst)
                c._repair_verify_geometry(dst, source, proper=True)
                g, data = c._repair_buffer(dst)
                self.assertEqual(g['buffers'][0]['uri'], dst.with_suffix('.bin').name)
                self.assertEqual(src.with_suffix('.bin').read_bytes(), raw_bytes)
                self.assertEqual(struct.unpack_from('<f', data, 8)[0], -2.0)
            index = c._repair_group_index(root / 'raw', '.gltf')
            self.assertEqual(set(index), {'objects/town/box.gltf', 'objects/home/box.gltf'})
            self.assertNotEqual((root / 'staged/Objects.Town.Box.bin').read_bytes(),
                                (root / 'staged/Objects.Home.Box.bin').read_bytes())
            with self.assertRaisesRegex(c.L2Error, 'positions differ'):
                c._repair_verify_geometry(root / 'raw/Objects/Town/Box.gltf', source)

    def test_buffer_uri_cannot_escape_or_pick_an_unrelated_basename(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'raw/Box.gltf'; mesh(path)
            g = json.loads(path.read_text())
            for uri in ['../Box.bin', '/Box.bin', 'other\\Box.bin', 'data:Box.bin']:
                g['buffers'][0]['uri'] = uri; path.write_text(json.dumps(g))
                with self.assertRaises(c.L2Error): c._repair_buffer(path)
            g['buffers'][0]['uri'] = 'Box.bin'; g['buffers'][0]['byteLength'] += 1
            path.write_text(json.dumps(g))
            with self.assertRaisesRegex(c.L2Error, 'length'): c._repair_buffer(path)

    def test_scene_matches_original_placement_not_order_and_changes_only_selected_fields(self):
        town, home = actor('Town'), actor('Home', x=9)
        scene = {'unrelated': {'preserve': True}, 'props': [row(home), row(town)]}
        before = json.loads(json.dumps(scene))
        selected = ['Objects.Town.Box']
        updated, matched = c._repair_scene(scene, [town, home], selected)
        self.assertEqual(scene, before)
        self.assertEqual(updated['props'][0], scene['props'][0])
        self.assertEqual(updated['props'][1], dict(scene['props'][1],
            sourceMesh=selected[0], gltf='props/Objects.Town.Box.gltf'))
        self.assertEqual(updated['unrelated'], scene['unrelated'])
        self.assertEqual(matched[0]['actor'], 'Town')
        with self.assertRaisesRegex(c.L2Error, 'ambiguous'):
            c._repair_scene({'props': [row(town), row(town)]}, [town], selected)
        altered = row(town); altered['rotation'] = [0, 101, 0]
        with self.assertRaisesRegex(c.L2Error, 'unchanged'):
            c._repair_scene({'props': [altered]}, [town], selected)
        with self.assertRaisesRegex(c.L2Error, 'every selected'):
            c._repair_scene(scene, [town, home], selected + ['Objects.Absent.Box'])

    def test_conflicting_existing_texture_refuses_adoption_without_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            live, staged = Path(tmp) / 'live', Path(tmp) / 'stage'
            for path in [live, staged]: (path / 'props/textures').mkdir(parents=True)
            old = live / 'props/textures/Wood.png'; old.write_bytes(b'original texture')
            (staged / 'props/textures/Wood.png').write_bytes(b'different texture')
            with self.assertRaisesRegex(c.L2Error, 'byte conflict'):
                c._repair_adoption_plan(live, staged)
            self.assertEqual(old.read_bytes(), b'original texture')
            (staged / 'props/textures/Wood.png').write_bytes(old.read_bytes())
            self.assertEqual(len(c._repair_adoption_plan(live, staged)), 1)

    def test_adoption_backup_and_validation_failure_rollback(self):
        for fail in [False, True]:
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as tmp:
                live, staged, backup = (Path(tmp) / name for name in ('live', 'stage', 'backup'))
                live.mkdir(); (staged / 'props').mkdir(parents=True)
                original = b'{"original":true}'
                (live / 'scene.json').write_bytes(original)
                (live / 'untouched').write_bytes(b'unchanged')
                (staged / 'scene.json').write_text('{"candidate":true}')
                (staged / 'props/new.bin').write_bytes(b'new geometry')
                with patch.object(c, 'validate_scene', side_effect=c.L2Error('synthetic invalid scene') if fail else None):
                    if fail:
                        with self.assertRaisesRegex(c.L2Error, 'synthetic invalid'):
                            c._repair_adopt(live, staged, backup, original, {})
                    else: c._repair_adopt(live, staged, backup, original, {})
                self.assertEqual((backup / 'scene.json').read_bytes(), original)
                self.assertEqual((live / 'untouched').read_bytes(), b'unchanged')
                self.assertEqual((live / 'props/new.bin').exists(), not fail)
                self.assertEqual((live / 'scene.json').read_bytes(), original if fail else b'{"candidate":true}')

    def test_staging_cannot_adopt_over_a_newer_scene_or_changed_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            live, staged, backup = (Path(tmp) / name for name in ('live', 'stage', 'backup'))
            live.mkdir(); (staged / 'props').mkdir(parents=True)
            (live / 'scene.json').write_bytes(b'newer scene')
            (staged / 'props/new.bin').write_bytes(b'new geometry')
            with self.assertRaisesRegex(c.L2Error, 'scene changed'):
                c._repair_adopt(live, staged, backup, b'old scene', {})
            with self.assertRaisesRegex(c.L2Error, 'source changed'):
                c._repair_adopt(live, staged, backup, b'newer scene', {str(live / 'scene.json'): 'old digest'})
            self.assertFalse(backup.exists()); self.assertFalse((live / 'props').exists())


if __name__ == '__main__': unittest.main()
