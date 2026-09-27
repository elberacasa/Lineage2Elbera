"""Portable original-hair selection/decoder regressions; no client files needed."""
import copy
import contextlib
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_characters as builder


def sha(data):
    return hashlib.sha256(data).hexdigest()


def catalog():
    return {'format': 'l2-interlude-player-hair-v1', 'models': {'model': {'slots': [
        {'index': 0, 'parts': [
            {'part': 1, 'nativeSlot': 5, 'status': 'source-present',
             'mesh': 'Rig.UnexpectedHair7', 'colors': [
                 {'index': 0, 'material': 'Paint.Group.HairBlend'},
                 {'index': 1, 'material': 'Paint.OtherColor'}]},
            {'part': 2, 'nativeSlot': 4, 'status': 'source-absent'}]}]}},
        'meshes': {'Rig.UnexpectedHair7': {'sourceExportSHA256': sha(b'mesh'),
                                         'materialSlots': [{'textureIndex': 0, 'polyFlags': 0}]}},
        'materials': {
            'Paint.Group.HairBlend': {'class': 'FinalBlend', 'properties': {
                'Material': {'reference': 'Paint.Group.Actual_ori'}}},
            'Paint.Group.Actual_ori': {'class': 'Texture', 'sourceExportSHA256': sha(b'texture')}}}


class Package:
    """Minimal synthetic UE2 export table, including two same-leaf groups."""
    def __init__(self, rows):
        self.data = b''
        self.exports = []
        for name, kind, parent, data in rows:
            self.exports.append(SimpleNamespace(name=name, kind=kind, package_index=parent,
                                serial_offset=len(self.data), serial_size=len(data)))
            self.data += data

    @staticmethod
    def export_name(export):
        return export.name

    @staticmethod
    def class_name_of(export):
        return export.kind


def texture_package():
    return Package([
        ('Group', 'Package', 0, b'g'),
        ('Other', 'Package', 0, b'o'),
        ('Actual_ori', 'Texture', 2, b'wrong-group'),
        ('Actual', 'Texture', 1, b'wrong-sibling'),
        ('Actual_ori', 'Texture', 1, b'texture')])


class DefaultHairTests(unittest.TestCase):
    def test_uses_selected_source_index_and_exact_material_child(self):
        selected = builder.default_hair_bindings(catalog(), {'model': 'Rig'})['model']
        self.assertEqual(selected['_ah']['mesh'], 'UnexpectedHair7')
        self.assertEqual(selected['_ah']['sourceMaterial'], 'Paint.Group.HairBlend')
        self.assertEqual(selected['_ah']['sourceTexture'], 'Paint.Group.Actual_ori')
        self.assertEqual(selected['_ah']['tex'], ('Paint', 'Group.HairBlend'))
        self.assertEqual(selected['_bh'], {'sourceStatus': 'source-absent', 'mesh': None, 'tex': None})

    def test_absence_is_not_inferred_from_available_meshes(self):
        selected = builder.default_hair_bindings(catalog(), {'model': 'Rig'})['model']
        self.assertIsNone(builder.required_hair_mesh(selected['_bh'], None, ['Invented_bh']))
        with self.assertRaisesRegex(ValueError, 'missing original hair part'):
            builder.required_hair_mesh(None, None, [])
        with self.assertRaisesRegex(ValueError, 'conflicting absent'):
            builder.required_hair_mesh({**selected['_bh'], 'mesh': 'Invented_bh'}, None, [])

    def test_missing_or_ambiguous_source_selection_is_rejected(self):
        changes = [
            lambda c: c['models']['model']['slots'].clear(),
            lambda c: c['models']['model']['slots'].append(copy.deepcopy(c['models']['model']['slots'][0])),
            lambda c: c['models']['model']['slots'][0]['parts'].pop(),
            lambda c: c['models']['model']['slots'][0]['parts'][0].update(status='unknown'),
            lambda c: c['models']['model']['slots'][0]['parts'][0].update(nativeSlot=4),
            lambda c: c['models']['model']['slots'][0]['parts'][0]['colors'].append({'index': 0}),
            lambda c: c['models']['model']['slots'][0]['parts'][0]['colors'].clear(),
            lambda c: c['meshes'].clear(),
            lambda c: c['meshes']['Rig.UnexpectedHair7'].update(sourceExportSHA256='bad'),
            lambda c: c['materials'].pop('Paint.Group.Actual_ori'),
            lambda c: c['materials']['Paint.Group.HairBlend'].update(**{'class': 'Shader'}),
            lambda c: c['materials']['Paint.Group.HairBlend']['properties']['Material'].update(reference='Paint.Group.HairBlend'),
        ]
        for i, change in enumerate(changes):
            with self.subTest(case=i):
                source = catalog()
                change(source)
                with self.assertRaises(ValueError):
                    builder.default_hair_bindings(source, {'model': 'Rig'})
        with self.assertRaisesRegex(ValueError, 'incompatible'):
            builder.default_hair_bindings(catalog(), {'model': 'OtherRig'})

    def test_present_mesh_requires_matching_source_bytes_and_exporter_entry(self):
        binding = builder.default_hair_bindings(catalog(), {'model': 'Rig'})['model']['_ah']
        package = Package([('UnexpectedHair7', 'SkeletalMesh', 0, b'mesh')])
        self.assertEqual(builder.required_hair_mesh(binding, package, ['UnexpectedHair7']), 'UnexpectedHair7')
        self.assertEqual(builder.required_hair_mesh({**binding, 'mesh': 'unexpectedhair7'}, package,
                                                   ['UNEXPECTEDHAIR7']), 'UNEXPECTEDHAIR7')
        for listed in ([], ['UnexpectedHair7', 'unexpectedhair7']):
            with self.assertRaisesRegex(ValueError, 'unavailable'):
                builder.required_hair_mesh(binding, package, listed)
        package.data = b'edit'
        with self.assertRaisesRegex(ValueError, 'fingerprint'):
            builder.required_hair_mesh(binding, package, ['UnexpectedHair7'])

    def test_multiple_nonzero_or_unknown_source_material_slots_are_rejected(self):
        for slots in (None, [], [{'textureIndex': 0}], [{'textureIndex': 1, 'polyFlags': 0}],
                      [{'textureIndex': 0, 'polyFlags': 1}],
                      [{'textureIndex': 0, 'polyFlags': 0}] * 2):
            with self.subTest(slots=slots):
                source = catalog()
                source['meshes']['Rig.UnexpectedHair7']['materialSlots'] = slots
                with self.assertRaisesRegex(ValueError, 'material slots'):
                    builder.default_hair_bindings(source, {'model': 'Rig'})

    def test_texture_lookup_requires_qualified_group_and_exact_hash(self):
        package = texture_package()
        found = builder.source_hair_export(package, 'Paint.Group.Actual_ori', 'Texture', sha(b'texture'))
        self.assertIs(found, package.exports[-1])
        for reference in ('Paint.Actual_ori', 'Paint.Group.Missing', 'Paint.Other.Actual_ori'):
            with self.assertRaises(ValueError):
                builder.source_hair_export(package, reference, 'Texture', sha(b'texture'))
        package.exports.append(copy.copy(found))
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            builder.source_hair_export(package, 'Paint.Group.Actual_ori', 'Texture', sha(b'texture'))

    def test_exact_texture_decode_preserves_rgba_without_library_or_sibling(self):
        binding = builder.default_hair_bindings(catalog(), {'model': 'Rig'})['model']['_ah']
        package = texture_package()
        pixels = bytes([10, 20, 30, 0, 40, 50, 60, 127, 70, 80, 90, 128, 100, 110, 120, 255])
        sys.path.insert(0, str(Path(builder.ROOT) / 'tools'))
        from l2lib import textures
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(builder, 'load_utx', return_value=package) as load, \
                patch.object(builder, 'library_png', side_effect=AssertionError('no library fallback')), \
                patch.object(builder, 'resolve_diffuse', side_effect=AssertionError('no leaf resolver')), \
                patch.object(textures, 'extract_texture_rgba', return_value=(4, 1, pixels, None)) as decode:
            source, ref, resolved, path, notes = builder.choose_source_hair_texture(binding, directory)
            load.assert_called_once_with('Paint')
            decode.assert_called_once_with(package, package.exports[-1])
            self.assertEqual((source, ref, resolved, notes), ('hairgrp', binding['tex'], binding['sourceTexture'], []))
            png = Path(path).read_bytes()
            pos, compressed = 8, b''
            while pos < len(png):
                length, kind = struct.unpack_from('>I4s', png, pos)
                if kind == b'IDAT':
                    compressed += png[pos + 8:pos + 8 + length]
                pos += length + 12
            self.assertEqual(zlib.decompress(compressed), b'\0' + pixels)

    def test_present_hair_export_failure_cannot_silently_drop_part(self):
        binding = builder.default_hair_bindings(catalog(), {'model': 'Rig'})
        package = Package([('UnexpectedHair7', 'SkeletalMesh', 0, b'mesh')])
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(builder, 'STAGE', directory), \
                patch.object(builder, 'load_ukx', return_value=package), \
                patch.object(builder, 'list_objects', return_value={'SkeletalMesh': ['UnexpectedHair7']}), \
                patch.object(builder, 'export_one'), patch.object(builder, 'find_exported', return_value=None):
            with self.assertRaisesRegex(ValueError, 'produced no PSK'):
                builder.build_combo('model', '', '', '', 'Rig', '', '', binding)

    def test_main_all_failed_preserves_manifest_and_reports_failure(self):
        # Exercise the real caller, not only the admission helper's exception.
        # Both an exception and the existing explicit skip/None path must fail.
        for result in (ValueError('required original hair mesh unavailable'), None):
            with self.subTest(result=result), tempfile.TemporaryDirectory() as directory:
                manifest = Path(directory) / 'manifest.json'
                original = b'{"models":[{"id":"model","gltf":"models/old.gltf"}]}\n'
                manifest.write_bytes(original)
                old_model = Path(directory) / 'old.gltf'
                old_model.write_bytes(b'previous model')
                with patch.object(builder, 'OUT', directory), \
                        patch.object(builder, 'COMBOS', [('model', '', '', '', '', '', '')]), \
                        patch.object(builder, 'load_creation_bindings', return_value={}), \
                        patch.object(builder, 'build_combo', side_effect=[result]), \
                        patch.object(builder.json, 'dump') as write_manifest, \
                        patch.object(sys, 'argv', ['build_characters.py', 'model']), \
                        contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(builder.main(), 1)
                write_manifest.assert_not_called()
                self.assertEqual(manifest.read_bytes(), original)
                self.assertEqual(old_model.read_bytes(), b'previous model')

    def test_main_partial_success_merges_success_and_keeps_failed_entry(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / 'manifest.json'
            old = [{'id': 'failed', 'gltf': 'models/old-failed.gltf'},
                   {'id': 'ready', 'gltf': 'models/old-ready.gltf', 'enrichment': 'keep'},
                   {'id': 'unrequested', 'gltf': 'models/other.gltf'}]
            manifest.write_text(json.dumps({'models': old}))
            with patch.object(builder, 'OUT', directory), \
                    patch.object(builder, 'COMBOS', [(name, '', '', '', '', '', '')
                                                   for name in ('failed', 'ready', 'unrequested')]), \
                    patch.object(builder, 'load_creation_bindings', return_value={}), \
                    patch.object(builder, 'build_combo', side_effect=[
                        ValueError('required original hair mesh unavailable'),
                        {'id': 'ready', 'gltf': 'models/new-ready.gltf'}]) as build, \
                    patch.object(sys, 'argv', ['build_characters.py', 'failed', 'ready']), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(builder.main(), 1)
            self.assertEqual(build.call_count, 2)
            self.assertEqual(json.loads(manifest.read_text())['models'], [
                old[0], {**old[1], 'gltf': 'models/new-ready.gltf'}, old[2]])

    def test_main_success_reports_zero_and_writes_new_manifest(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(builder, 'OUT', directory), \
                patch.object(builder, 'COMBOS', [('model', '', '', '', '', '', '')]), \
                patch.object(builder, 'load_creation_bindings', return_value={}), \
                patch.object(builder, 'build_combo', return_value={'id': 'model', 'gltf': 'models/new.gltf'}), \
                patch.object(sys, 'argv', ['build_characters.py', 'model']), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(builder.main(), 0)
            self.assertEqual(json.loads((Path(directory) / 'manifest.json').read_text()),
                             {'models': [{'id': 'model', 'gltf': 'models/new.gltf'}]})


if __name__ == '__main__':
    unittest.main()
