"""Elbera Tools: source-free original-key export/CLI boundary checks.

Packages are synthetic byte streams. No client assets, services, third-party
modules, animation conversion, or generated production outputs are required.
"""
from contextlib import redirect_stdout
import copy
import hashlib
import io
import json
from pathlib import Path
import struct
import tempfile
from types import SimpleNamespace
import importlib.util
import sys
import unittest
from unittest.mock import patch

import export_source_tracks as exporter
from test_pawnanim_source import fixture


def package_fixture():
    package, export, _, _ = fixture(notifies=(.9, .1), extra_sequence=True)
    export.object_name = 'mFixture_anim'
    export.object_class = 'MeshAnimation'
    export.package_index = 0
    package.exports = [export]
    package.export_name = lambda row: row.object_name
    package.class_name_of = lambda row: row.object_class
    # Bytes outside the selected export must not enter its identity hash.
    package.data += b'UNRELATED SYNTHETIC PACKAGE TRAILER'
    return package, export


class SourceTrackExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root/'private-output'
        self.source = self.root/'supplied-inputs'
        self.source.mkdir()
        self.source_bytes = b'SYNTHETIC SOURCE FILE; NOT AN ORIGINAL CLIENT'
        (self.source/'Fixture.ukx').write_bytes(self.source_bytes)
        self.package, self.export = package_fixture()
        self.models = [('fixture_m', 'Fixture', 'MFixture')]
        for patcher in [patch.object(exporter, 'OUTPUT', self.output),
                        patch.object(exporter.pawn, 'ANIMS', self.source),
                        patch.object(exporter.pawn, 'PAWNS', self.models)]:
            patcher.start(); self.addCleanup(patcher.stop)
        loader_patch = patch.object(exporter.pawn, 'load_package', return_value=(self.package, None))
        self.loader = loader_patch.start(); self.addCleanup(loader_patch.stop)

    def run_cli(self, *args):
        captured = io.StringIO()
        with redirect_stdout(captured): exporter.main(list(args))
        return captured.getvalue()

    def test_qualified_root_export_ignores_group_and_class_homonyms_and_reuses_package(self):
        self.package.exports.extend([
            SimpleNamespace(**{**vars(self.export), 'package_index':17}),
            SimpleNamespace(**{**vars(self.export), 'object_class':'Texture'}),
            SimpleNamespace(**{**vars(self.export), 'object_name':'FFixture_anim'})])
        self.models.append(('fixture_f', 'Fixture', 'FFixture'))
        rows = exporter.collect()
        self.assertEqual(list(rows), ['fixture_m', 'fixture_f'])
        self.assertEqual(rows['fixture_m']['animationRef'], 'Fixture.mFixture_anim')
        self.assertEqual(rows['fixture_f']['animationRef'], 'Fixture.FFixture_anim')
        self.loader.assert_called_once_with(str(self.source/'Fixture.ukx'))
        source = rows['fixture_m']['source']
        self.assertEqual(source['packageSHA256'], hashlib.sha256(self.source_bytes).hexdigest())
        self.assertEqual(source['exportSHA256'], hashlib.sha256(
            self.package.data[:self.export.serial_size]).hexdigest())
        self.assertEqual((source['exportOffset'], source['exportSize']), (0, self.export.serial_size))
        self.assertEqual((source['fileVersion'], source['licenseeVersion']), (123, 30))

    def test_missing_group_only_and_casefold_duplicate_root_exports_fail_closed(self):
        with self.assertRaisesRegex(ValueError, 'unknown original player model'):
            exporter.collect('unknown')
        for exports in [[], [SimpleNamespace(**{**vars(self.export), 'package_index':17})],
                        [self.export, SimpleNamespace(**{**vars(self.export), 'object_name':'MFIXTURE_ANIM'})]]:
            with self.subTest(exports=len(exports)):
                self.package.exports = exports
                with self.assertRaisesRegex(ValueError, 'missing or ambiguous qualified MeshAnimation'):
                    exporter.collect('fixture_m')
        self.assertFalse(self.output.exists())

    def test_default_cli_audits_without_creating_or_changing_outputs(self):
        self.assertIn('read-only', self.run_cli('fixture_m'))
        self.assertFalse(self.output.exists())
        self.output.mkdir()
        existing = self.output/'fixture_m.json'; existing.write_bytes(b'older private receipt')
        before = existing.stat()
        self.run_cli('fixture_m')
        self.assertEqual(existing.read_bytes(), b'older private receipt')
        self.assertEqual(existing.stat().st_mtime_ns, before.st_mtime_ns)
        self.assertEqual(list(self.output.iterdir()), [existing])

    def test_write_and_check_preserve_sparse_values_signed_zero_order_and_fingerprints(self):
        original = exporter.pawn.original_animation(self.package, self.export, include_tracks=True)
        movement = original['sequences'][0]['movement']
        track = movement['tracks'][0]
        changed = bytearray(self.package.data)
        # The fixture uses one quaternion/position/time, rather than a dense
        # key per frame. Preserve nonunit and signed source values verbatim.
        struct.pack_into('<i', changed, track['source']['offset'], -27)
        struct.pack_into('<4f', changed, track['source']['offset']+5, -2.,3.,-0.,.5)
        struct.pack_into('<3f', changed, track['source']['offset']+22, 9.125,-0.,-7.5)
        self.package.data = bytes(changed)
        expected = exporter.pawn.original_animation(self.package, self.export, include_tracks=True)
        before = self.package.data
        self.assertIn('written', self.run_cli('fixture_m','--write'))
        target = self.output/'fixture_m.json'
        emitted = json.loads(target.read_bytes())
        self.assertEqual(emitted['format'], 'elbera-original-animation-tracks-v1')
        self.assertEqual(emitted['modelId'], 'fixture_m')
        self.assertEqual(emitted['bones'], expected['bones'])
        # JSON tuple→list conversion is the only representation change.
        self.assertEqual(emitted['sequences'], json.loads(json.dumps(expected['sequences'])))
        actual = emitted['sequences'][0]['movement']['tracks'][0]
        self.assertEqual(actual['flags'], -27)
        self.assertEqual(struct.pack('<4f',*actual['quaternions'][0]), struct.pack('<4f',-2.,3.,-0.,.5))
        self.assertEqual(struct.pack('<3f',*actual['positions'][0]), struct.pack('<3f',9.125,-0.,-7.5))
        self.assertEqual(actual['times'], [0.])
        self.assertEqual(emitted['sequences'][0]['frames'], 3)
        self.assertEqual(emitted['sequences'][0]['movement']['rootTrack']['times'], [])
        self.assertGreater(emitted['sequences'][0]['notifies'][0]['t'], emitted['sequences'][0]['notifies'][1]['t'])
        source = actual['source']
        self.assertEqual(source['SHA256'], hashlib.sha256(before[source['offset']:source['offset']+source['size']]).hexdigest())
        self.assertEqual(self.package.data, before, 'original package bytes must not be mutated')
        self.assertTrue(target.read_bytes().endswith(b'\n'))
        previous = target.stat().st_mtime_ns
        self.assertIn('checked', self.run_cli('fixture_m','--check'))
        self.assertEqual(target.stat().st_mtime_ns, previous)
        self.assertEqual(list(self.output.iterdir()), [target], 'no staged temporary file survives')

    def test_check_rejects_missing_and_stale_receipts_without_repair(self):
        with self.assertRaisesRegex(ValueError, 'missing or stale'):
            self.run_cli('fixture_m','--check')
        self.assertFalse(self.output.exists())
        self.run_cli('fixture_m','--write')
        target = self.output/'fixture_m.json'; stale = target.read_bytes()+b' '
        target.write_bytes(stale)
        with self.assertRaisesRegex(ValueError, 'missing or stale'):
            self.run_cli('fixture_m','--check')
        self.assertEqual(target.read_bytes(), stale)
        self.assertEqual(list(self.output.iterdir()), [target])

    def test_later_decode_failure_prevents_all_writes_and_preserves_existing_file(self):
        self.models.append(('fixture_f','Fixture','FFixture'))
        # A valid first requested model must not be written when the later
        # model's qualified source export is absent.
        self.output.mkdir()
        target = self.output/'fixture_m.json'; target.write_bytes(b'KEEP')
        with self.assertRaisesRegex(ValueError, 'missing or ambiguous'):
            self.run_cli('all','--write')
        self.assertEqual(target.read_bytes(), b'KEEP')
        self.assertEqual(list(self.output.iterdir()), [target])

    def test_later_encoding_failure_prevents_all_writes(self):
        valid = exporter.collect('fixture_m')['fixture_m']
        invalid = copy.deepcopy(valid); invalid['sequences'][0]['movement']['duration'] = float('nan')
        self.output.mkdir()
        target = self.output/'fixture_m.json'; target.write_bytes(b'KEEP')
        with patch.object(exporter, 'collect', return_value={'fixture_m':valid,'fixture_f':invalid}):
            with self.assertRaisesRegex(ValueError, 'Out of range float values'):
                self.run_cli('all','--write')
        self.assertEqual(target.read_bytes(), b'KEEP')
        self.assertEqual(list(self.output.iterdir()), [target])

    def test_atomic_replace_failure_keeps_previous_output_and_removes_staged_file(self):
        self.output.mkdir()
        target = self.output/'fixture_m.json'; target.write_bytes(b'KEEP')
        with patch.object(Path, 'replace', side_effect=OSError('synthetic replace failure')):
            with self.assertRaisesRegex(OSError, 'synthetic replace failure'):
                self.run_cli('fixture_m','--write')
        self.assertEqual(target.read_bytes(), b'KEEP')
        self.assertEqual(list(self.output.iterdir()), [target])

    def test_cli_modes_are_exclusive_before_source_reads(self):
        with redirect_stdout(io.StringIO()), patch('sys.stderr', new=io.StringIO()):
            with self.assertRaises(SystemExit) as error:
                exporter.main(['fixture_m','--write','--check'])
        self.assertEqual(error.exception.code, 2)
        self.loader.assert_not_called()
        self.assertFalse(self.output.exists())


class SourceSkeletonExportTests(unittest.TestCase):
    """Exercise the actual collector, with authored source-reader boundaries."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root/'SkeletonPkg.ukx'; self.path.write_bytes(b'SYNTHETIC UKX INPUT')
        system = self.root/'assets/interlude/system'; system.mkdir(parents=True)
        (system/'chargrp.dat').write_bytes(b'SYNTHETIC DAT INPUT')
        self.mesh_export = SimpleNamespace(name='FaceMesh', kind='SkeletalMesh', package_index=0,
                                          serial_offset=0, serial_size=4)
        self.anim_export = SimpleNamespace(name='MFixture_anim', kind='MeshAnimation', package_index=0,
                                          serial_offset=4, serial_size=9)
        self.package = SimpleNamespace(path=self.path, data=b'MESHANIMATIONUNRELATED',
            names=['Root','Left','Right','Child'], exports=[self.mesh_export,self.anim_export])
        self.package.export_name = lambda row: row.name
        self.package.exports_by_class = lambda kind: [e for e in self.package.exports if e.kind==kind]
        def bone(name, parent):
            return {'name':name,'parent':parent,'flags':0,
                    'orientation':[.25,-.5,0.,2.], 'position':[1.,-0.,3.]}
        self.mesh = {'bones':[bone('Root',0),bone('Right',0),bone('Child',1),bone('Root',0)],
                     'animationReference':7,'sourceExportSHA256':'synthetic-mesh-hash'}
        self.animation = {'bones':[{'name':n,'flags':0,'parent':0} for n in ['Root','Left','Left','Child']]}
        self.reference = 'SkeletonPkg.MFixture_anim'
        self.defaults = {'sourcePackages':{'synthetic':'source-package-hash'}, 'rows':[{
            'modelId':'fixture_m','class':'Synthetic.Fixture','defaultsEvidence':{'stream':'bounded'},
            'fields':{'Mesh':{'value':['SkeletonPkg','FaceMesh']}}}]}
        self.records = [{'face_mesh':['SkeletonPkg.FaceMesh']}]
        self.source_calls = []
        owner = self
        class Sources:
            def get(self, kind, name):
                owner.source_calls.append((kind,name))
                return owner.package
        # The real decoded-name adapter is source-free; keep it in this test.
        tool = Path(__file__).resolve().parents[1]/'ui/check_animation_linkup_native.py'
        spec = importlib.util.spec_from_file_location('check_animation_linkup_native', tool)
        linkup = importlib.util.module_from_spec(spec); spec.loader.exec_module(linkup)
        modules = {
            'build_hair': SimpleNamespace(Sources=Sources,
                source_lod0=lambda package, export: copy.deepcopy(self.mesh),
                object_reference=lambda package, ref: self.reference),
            'check_hair_attachment_native': SimpleNamespace(audit_pawn_defaults=lambda:self.defaults),
            'extract_charcreate': SimpleNamespace(decrypt=lambda name, temp:b'SYNTHETIC DECODED CHARGRP',
                                                  parse_chargrp=lambda raw:self.records),
            'check_animation_linkup_native': linkup,
        }
        for patcher in [patch.dict(sys.modules, modules), patch.object(sys,'path',sys.path[:]),
                        patch.object(exporter,'ROOT',self.root),
                        patch.object(exporter.pawn,'PAWNS',[('fixture_m','SkeletonPkg','MFixture')]),
                        patch.object(exporter.pawn,'original_animation',side_effect=lambda p,e:copy.deepcopy(self.animation))]:
            patcher.start(); self.addCleanup(patcher.stop)

    def test_fresh_class_face_join_preserves_source_bones_and_native_first_match(self):
        result = exporter.collect_skeletons('fixture_m')['fixture_m']
        self.assertEqual(result['bones'], self.mesh['bones'])
        self.assertEqual(result['animationBones'], self.animation['bones'])
        self.assertEqual(result['trackBindings'], [0,-1,3,0])
        self.assertEqual(result['meshRef'], 'SkeletonPkg.FaceMesh')
        self.assertEqual(result['animationRef'], self.reference)
        self.assertEqual(result['source']['packageSHA256'], hashlib.sha256(self.path.read_bytes()).hexdigest())
        self.assertEqual(result['source']['animationExportSHA256'], hashlib.sha256(b'ANIMATION').hexdigest())
        self.assertEqual(result['source']['chargrpIndex'], 0)
        self.assertEqual(self.source_calls, [('animations','SkeletonPkg')])
        self.assertIsNot(result['bones'], self.mesh['bones'])

    def test_ambiguous_chargrp_face_cannot_select_arbitrary_source_row(self):
        self.records.append(copy.deepcopy(self.records[0]))
        with self.assertRaisesRegex(ValueError, 'ambiguous original master face'):
            exporter.collect_skeletons('fixture_m')
        self.assertEqual(self.source_calls, [])

    def test_grouped_or_duplicate_animation_export_does_not_satisfy_qualified_reference(self):
        self.anim_export.package_index = 4
        with self.assertRaisesRegex(ValueError, 'missing or ambiguous master MeshAnimation'):
            exporter.collect_skeletons('fixture_m')
        self.anim_export.package_index = 0
        self.package.exports.append(SimpleNamespace(**{**vars(self.anim_export),'name':'MFIXTURE_ANIM'}))
        with self.assertRaisesRegex(ValueError, 'missing or ambiguous master MeshAnimation'):
            exporter.collect_skeletons('fixture_m')

    def test_imported_animation_package_is_not_satisfied_by_local_homonym(self):
        exporter.pawn.PAWNS[:] = [('fixture_m','ForeignPkg','MFixture')]
        self.reference = 'ForeignPkg.MFixture_anim'
        with self.assertRaisesRegex(ValueError, 'package'):
            exporter.collect_skeletons('fixture_m')

    def test_original_name_table_gate_rejects_unverified_casefold_token_equivalence(self):
        self.package.names.append('ROOT')
        with self.assertRaisesRegex(ValueError, 'name'):
            exporter.collect_skeletons('fixture_m')


if __name__ == '__main__': unittest.main()
