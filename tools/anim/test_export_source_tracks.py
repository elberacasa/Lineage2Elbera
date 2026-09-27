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
from pack_source_tracks import pack_animation_bundle
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


def runtime_fixture(model='fixture_m'):
    """Authored transport fixture, also consumed by the browser codec tests."""
    tiny = struct.unpack('<f', struct.pack('<I', 1))[0]
    third = struct.unpack('<f', struct.pack('<f', .3))[0]
    bones = [{'name':'Root','parent':0,'flags':0}, {'name':'Child','parent':0,'flags':0},
             {'name':'Child','parent':1,'flags':0}]
    track = {'flags':0, 'quaternions':[[0.,-0.,tiny,1.], [2.,-3.,.5,0.], [0.,1.,0.,-1.]],
             'positions':[[9.125,-0.,-7.5]], 'times':[0.,third,2.],
             'source':{'SHA256':'c'*64,'offset':77,'size':101}}
    empty = {'flags':0,'quaternions':[],'positions':[],'times':[],
             'source':{'SHA256':'d'*64,'offset':178,'size':7}}
    movement = {'flags':0,'duration':3.,'startBone':0,'rootSpeed':[0.,0.,0.],
                'boneIndices':[],'tracks':[copy.deepcopy(track) for _ in bones], 'rootTrack':empty}
    catalog = {'format':'elbera-original-animation-tracks-v1','modelId':model,
               'animationRef':'Fixture.Animation', 'bones':bones,
               'source':{'packageSHA256':'a'*64,'exportSHA256':'b'*64,'exportOffset':7,'exportSize':1000},
               'sequences':[{'name':'Ordinary','rate':30.,'frames':90,'movement':movement,'notifies':[]}]}
    unusual = copy.deepcopy(catalog['sequences'][0]); unusual['name'] = 'NotASamplerAdmission'
    unusual['movement']['flags'] = 17; unusual['movement']['tracks'][0]['flags'] = -27
    unusual['movement']['tracks'][1]['quaternions'] = unusual['movement']['tracks'][1]['quaternions'][:1]
    catalog['sequences'].append(unusual)
    skeleton = {'format':'elbera-original-player-skeleton-v1','modelId':model,
                'animationRef':'Fixture.Animation','meshRef':'Fixture.Face',
                'animationBones':copy.deepcopy(bones), 'trackBindings':[0,-1,1],
                'bones':[{'name':name,'parent':parent,'orientation':[0.,-0.,0.,1.],
                          'position':[1.,tiny,-0.]} for name,parent in [('Root',0),('Absent',0),('Child',1)]],
                'source':{'packageSHA256':'a'*64,'animationExportSHA256':'b'*64,
                          'meshExportSHA256':'e'*64,'chargrpSHA256':'f'*64}}
    return catalog, skeleton


class RuntimeTransportTests(unittest.TestCase):
    def test_binary_arrays_preserve_all_source_bits_order_provenance_and_inputs(self):
        catalog, skeleton = runtime_fixture()
        before = copy.deepcopy((catalog, skeleton))
        blob = pack_animation_bundle(catalog, skeleton)
        self.assertEqual(blob, pack_animation_bundle(catalog, skeleton))
        self.assertEqual((catalog, skeleton), before)
        magic, version, json_size, payload_size = struct.unpack_from('<4sIII', blob)
        self.assertEqual((magic, version), (b'ELBA',1))
        metadata = json.loads(blob[16:16+json_size]); start = 16+(json_size+3)//4*4
        self.assertEqual(len(blob),start+payload_size)
        self.assertEqual(blob[16+json_size:start],b'\0'*(start-16-json_size))
        self.assertEqual(metadata['format'],'elbera-original-animation-runtime-v1')
        self.assertEqual(metadata['skeleton'],skeleton)
        expected=bytearray(); cursor=0
        for sequence, packed_sequence in zip(catalog['sequences'],metadata['catalog']['sequences']):
            raw, packed = sequence['movement'], packed_sequence['movement']
            self.assertEqual(packed['flags'],raw['flags'])
            for original, compact in zip(raw['tracks']+[raw['rootTrack']],packed['tracks']+[packed['rootTrack']]):
                self.assertEqual(compact['flags'],original['flags']); self.assertEqual(compact['source'],original['source'])
                for key,width in [('quaternions',4),('positions',3),('times',1)]:
                    desc=compact[key]; self.assertEqual(desc,{'offset':cursor,'count':len(original[key]),'width':width})
                    for row in original[key]:
                        values=[row] if width==1 else row
                        expected.extend(struct.pack('<'+'f'*width,*values)); cursor+=width*4
        self.assertEqual(blob[start:],bytes(expected))

    def test_invalid_source_bindings_values_shapes_or_identity_fail_before_encoding(self):
        mutations=[lambda c,s:s['trackBindings'].__setitem__(2,2),
                   lambda c,s:s['source'].__setitem__('packageSHA256','0'*64),
                   lambda c,s:s.__setitem__('modelId','other'),
                   lambda c,s:s['bones'][1].__setitem__('parent',2),
                   lambda c,s:c['sequences'][0]['movement']['tracks'].pop(),
                   lambda c,s:c['sequences'][0]['movement']['tracks'][0]['positions'].append([1.,2.,3.]),
                   lambda c,s:c['sequences'][0]['movement']['tracks'][0]['quaternions'][0].pop(),
                   lambda c,s:c['sequences'][0]['movement']['tracks'][0]['times'].__setitem__(1,.1),
                   lambda c,s:c['sequences'][0]['movement']['tracks'][0]['times'].__setitem__(1,float('inf')),
                   lambda c,s:c['sequences'][0]['movement']['tracks'][0]['times'].__setitem__(1,True)]
        for mutate in mutations:
            c,s=runtime_fixture();mutate(c,s)
            with self.assertRaises(ValueError):pack_animation_bundle(c,s)

    def test_runtime_cli_default_write_check_exclusion_and_atomic_failure(self):
        c,s=runtime_fixture()
        with tempfile.TemporaryDirectory() as tmp, patch.object(exporter,'OUTPUT',Path(tmp)/'private'), \
             patch.object(exporter,'collect',return_value={'fixture_m':c}) as collect, \
             patch.object(exporter,'collect_skeletons',return_value={'fixture_m':s}), \
             patch.object(exporter.pawn,'PAWNS',[('fixture_m','Fixture','Fixture')]), redirect_stdout(io.StringIO()):
            target=exporter.OUTPUT/'runtime/fixture_m.l2anim'
            exporter.main(['fixture_m','--runtime']);self.assertFalse(target.exists())
            with self.assertRaises(ValueError):exporter.main(['fixture_m','--runtime','--check'])
            exporter.main(['fixture_m','--runtime','--write']);before=target.read_bytes()
            self.assertEqual(before,pack_animation_bundle(c,s))
            exporter.main(['fixture_m','--runtime','--check'])
            self.assertEqual(target.read_bytes(),before)
            with patch.object(Path,'replace',side_effect=OSError('atomic failure')):
                with self.assertRaises(OSError):exporter.main(['fixture_m','--runtime','--write'])
            self.assertEqual(target.read_bytes(),before)
            self.assertEqual(list(target.parent.iterdir()),[target])
            target.write_bytes(before+b'bad')
            with self.assertRaises(ValueError):exporter.main(['fixture_m','--runtime','--check'])
            self.assertEqual(target.read_bytes(),before+b'bad')
            collect.reset_mock()
            with patch('sys.stderr',io.StringIO()), self.assertRaises(SystemExit):
                exporter.main(['--runtime','--skeletons'])
            collect.assert_not_called()

    def test_later_runtime_validation_failure_cannot_replace_an_earlier_file(self):
        c,s=runtime_fixture();other,other_s=runtime_fixture('fixture_f');other_s['trackBindings'][0]=-1
        with tempfile.TemporaryDirectory() as tmp, patch.object(exporter,'OUTPUT',Path(tmp)), \
             patch.object(exporter,'collect',return_value={'fixture_m':c,'fixture_f':other}), \
             patch.object(exporter,'collect_skeletons',return_value={'fixture_m':s,'fixture_f':other_s}):
            target=Path(tmp)/'runtime/fixture_m.l2anim';target.parent.mkdir();target.write_bytes(b'KEEP')
            with self.assertRaises(ValueError):exporter.main(['--runtime','--write'])
            self.assertEqual(target.read_bytes(),b'KEEP');self.assertEqual(list(target.parent.iterdir()),[target])


if __name__ == '__main__': unittest.main()
