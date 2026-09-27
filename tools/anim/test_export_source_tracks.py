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


def npc_runtime_fixture(mesh_ref='MeshPkg.Group.Creature', animation_ref='AnimPkg.Group.Movement'):
    from npc_source_tracks import npc_model_id
    model = npc_model_id(mesh_ref)
    catalog, skeleton = runtime_fixture(model)
    catalog.update(meshRef=mesh_ref, animationRef=animation_ref)
    skeleton.update(format='elbera-original-npc-skeleton-v1', meshRef=mesh_ref, animationRef=animation_ref)
    skeleton['source'] = {'meshPackageSHA256':'d'*64, 'animationPackageSHA256':'a'*64,
                          'meshExportSHA256':'e'*64, 'animationExportSHA256':'b'*64}
    return catalog, skeleton


class NpcRuntimeTransportTests(unittest.TestCase):
    def test_npc_cross_package_identity_preserves_payload_and_both_source_pairs(self):
        player, player_skeleton = runtime_fixture()
        catalog, skeleton = npc_runtime_fixture()
        old, new = pack_animation_bundle(player, player_skeleton), pack_animation_bundle(catalog, skeleton)
        def parts(blob):
            _magic,_version,n,_payload = struct.unpack_from('<4sIII',blob)
            return json.loads(blob[16:16+n]), blob[16+(n+3)//4*4:]
        meta, payload = parts(new)
        self.assertEqual(payload, parts(old)[1], 'NPC identity must not resample source keys')
        self.assertEqual(meta['skeleton'],skeleton)
        self.assertEqual(meta['catalog']['meshRef'],'MeshPkg.Group.Creature')
        self.assertEqual(len(meta['catalog']['sequences']),2)
        self.assertNotEqual(skeleton['source']['meshPackageSHA256'],catalog['source']['packageSHA256'])

    def test_npc_identity_and_missing_source_fields_fail_without_player_fallback(self):
        mutations = [lambda c,s:c.pop('meshRef'), lambda c,s:s['source'].pop('meshPackageSHA256'),
                     lambda c,s:s['source'].__setitem__('animationPackageSHA256','f'*64),
                     lambda c,s:s['source'].__setitem__('meshExportSHA256',''),
                     lambda c,s:c.__setitem__('meshRef','MeshPkg.Other.Creature'),
                     lambda c,s:s.__setitem__('meshRef','../Creature'),
                     lambda c,s:c.__setitem__('modelId','npc_'+'0'*32)]
        for mutate in mutations:
            c,s=npc_runtime_fixture();mutate(c,s)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):pack_animation_bundle(c,s)

    def test_npc_cli_requires_runtime_before_reads_and_atomically_checks_selected_index(self):
        c,s=npc_runtime_fixture();model=c['modelId']
        index={'format':'elbera-original-npc-animation-runtime-index-v1','npcs':{'101':{'modelId':model}},
               'models':{model:{'meshRef':s['meshRef'],'animationRef':s['animationRef']}}}
        with tempfile.TemporaryDirectory() as tmp, patch.object(exporter,'OUTPUT',Path(tmp)/'animation-tracks'), \
             patch.object(exporter,'collect_npcs',side_effect=lambda ids,include_skin=False:({model:c},{model:s},copy.deepcopy(index))) as collector, \
             redirect_stdout(io.StringIO()):
            with patch('sys.stderr',io.StringIO()), self.assertRaises(SystemExit):exporter.main(['--npc','101'])
            collector.assert_not_called()
            exporter.main(['--npc','101','--runtime']);self.assertFalse(exporter.OUTPUT.exists())
            exporter.main(['--npc','101','--runtime','--write'])
            bundle=exporter.OUTPUT/'runtime'/f'{model}.l2anim';target=Path(tmp)/'npc-animation-runtime.json'
            emitted=json.loads(target.read_bytes())
            self.assertEqual(emitted['models'][model]['bundleSHA256'],hashlib.sha256(bundle.read_bytes()).hexdigest())
            exporter.main(['--npc','101','--runtime','--check'])
            before=target.read_bytes();bundle.write_bytes(bundle.read_bytes()+b'bad')
            with self.assertRaisesRegex(ValueError,'missing or stale'):exporter.main(['--npc','101','--runtime','--check'])
            self.assertEqual(target.read_bytes(),before)
            with patch.object(Path,'replace',side_effect=OSError('no replacement')):
                with self.assertRaises(OSError):exporter.main(['--npc','101','--runtime','--write'])
            self.assertEqual(target.read_bytes(),before)
            self.assertEqual(list(bundle.parent.iterdir()),[bundle])

    def test_npc_skin_cli_is_explicit_and_preserves_metadata_and_existing_key_payload(self):
        c,s=npc_runtime_fixture();model=c['modelId']
        skin={'format':'elbera-original-npc-skin-inputs-v1','stream':'stored-gpu-soft52',
              'sourceLOD0SHA256':'1'*64,'builtGLTFSHA256':'2'*64,
              'builtBuffers':[{'uri':'fixture.bin','byteLength':4,'SHA256':'3'*64}],
              'meshIndex':0,'skinIndex':0,'boneNodes':[2,0,1],
              'primitives':[{'primitiveIndex':0,'bones':[[2,0,2,-1]],
                             'weights':[[.125,.25,.5,-0.]]}]}
        def collect(ids, *, include_skin=False):
            self.assertEqual(ids,[101])
            skeleton=copy.deepcopy(s)
            if include_skin:skeleton['sourceSkin']=copy.deepcopy(skin)
            index={'format':'elbera-original-npc-animation-runtime-index-v1',
                   'npcs':{'101':{'modelId':model}},'models':{model:{}}}
            return {model:copy.deepcopy(c)},{model:skeleton},index
        with tempfile.TemporaryDirectory() as tmp, patch.object(exporter,'OUTPUT',Path(tmp)/'animation-tracks'), \
             patch.object(exporter,'collect_npcs',side_effect=collect) as collector, \
             redirect_stdout(io.StringIO()):
            for args in (['--npc-skin'],['--runtime','--npc-skin'],['--npc','101','--npc-skin']):
                with self.subTest(args=args),patch('sys.stderr',io.StringIO()),self.assertRaises(SystemExit):
                    exporter.main(args)
            collector.assert_not_called()
            exporter.main(['--npc','101','--runtime','--npc-skin'])
            collector.assert_called_once_with([101],include_skin=True)
            self.assertFalse(exporter.OUTPUT.exists(),'read-only mode must not write the skin extension')
            args=['--npc','101','--runtime','--npc-skin']
            exporter.main(args+['--write'])
            bundle=exporter.OUTPUT/'runtime'/f'{model}.l2anim';blob=bundle.read_bytes()
            size=struct.unpack_from('<I',blob,8)[0];meta=json.loads(blob[16:16+size])
            actual=meta['skeleton']['sourceSkin']
            self.assertEqual(actual,skin)
            self.assertEqual(struct.pack('<4f',*actual['primitives'][0]['weights'][0]),
                             struct.pack('<4f',.125,.25,.5,-0.))
            plain=pack_animation_bundle(c,s);plain_size=struct.unpack_from('<I',plain,8)[0]
            self.assertEqual(blob[16+(size+3)//4*4:],plain[16+(plain_size+3)//4*4:],
                             'adding skin inputs cannot change original animation keys')
            exporter.main(args+['--check'])
            before=bundle.stat().st_mtime_ns
            with self.assertRaisesRegex(ValueError,'missing or stale'):
                exporter.main(['--npc','101','--runtime','--check'])
            self.assertEqual(bundle.read_bytes(),blob)
            self.assertEqual(bundle.stat().st_mtime_ns,before)


class NpcSourceCollectorTests(unittest.TestCase):
    """Actual collector with authored package-reader boundaries, no asset reads."""
    def setUp(self):
        import npc_source_tracks as npc
        self.npc=npc
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        c,s=npc_runtime_fixture();self.animation={k:c[k] for k in ('bones','sequences')}
        self.mesh_ref=s['meshRef'];self.anim_ref=s['animationRef']
        self.mesh={'bones':s['bones'],'animationReference':-1,'sourceExportSHA256':hashlib.sha256(b'MESH').hexdigest()}
        self.mesh_package=SimpleNamespace(path=self.root/'MeshPkg.ukx',data=b'MESHx',
            names=['Root','Absent','Child'],file_version=123,licensee_version=30)
        self.anim_package=SimpleNamespace(path=self.root/'AnimPkg.ukx',data=b'xANIMATIONy',
            names=['Unrelated','Child','Root'],file_version=123,licensee_version=28)
        for package in (self.mesh_package,self.anim_package):Path(package.path).write_bytes(package.data)
        self.mesh_export=SimpleNamespace(index=0,serial_offset=0,serial_size=4)
        self.anim_export=SimpleNamespace(index=0,serial_offset=1,serial_size=9)
        asha=hashlib.sha256(b'ANIMATION').hexdigest()
        self.selectors={'npcs':{str(i):{'className':'Original.Creature'+str(i),'meshName':self.mesh_ref,
            'status':'source-animation','inheritance':['original.creature'+str(i),'engine.pawn'],
            'selectors':{'WaitAnimName':{'0':{'value':'Ordinary','status':'source-sequence'}}}} for i in (101,102)},
            'meshes':{self.mesh_ref.casefold():{'status':'source-animation','animation':self.anim_ref,
                'sourceExportSHA256':self.mesh['sourceExportSHA256'],'built':{'gltf':'models/fixture.gltf'}}},
            'animations':{self.anim_ref.casefold():{'sourceExportSHA256':asha}},
            'sources':{'animations/'+Path(p.path).name:hashlib.sha256(p.data).hexdigest()
                       for p in (self.mesh_package,self.anim_package)},'sourceSHA256':'f'*64}
        owner=self;self.export_calls=[]
        class Sources:
            def get(self,kind,name):
                if kind!='animations':raise AssertionError(kind)
                return {'meshpkg':owner.mesh_package,'animpkg':owner.anim_package}[name.casefold()]
        def export(package,reference,kind):
            self.export_calls.append((reference,kind))
            if (reference,kind)==(self.mesh_ref,'SkeletalMesh'):return self.mesh_export
            if (reference,kind)==(self.anim_ref,'MeshAnimation'):return self.anim_export
            raise ValueError('unmatched qualified synthetic export')
        tool=Path(__file__).resolve().parents[1]/'ui/check_animation_linkup_native.py'
        spec=importlib.util.spec_from_file_location('check_animation_linkup_native',tool)
        linkup=importlib.util.module_from_spec(spec);spec.loader.exec_module(linkup)
        modules={
            'build_hair':SimpleNamespace(Sources=Sources,source_lod0=lambda p,e:copy.deepcopy(self.mesh)),
            'build_npc_variants':SimpleNamespace(recover_selectors=lambda tmp,ids:copy.deepcopy(self.selectors),
                unique_source_export=export,mesh_animation_reference=lambda p,e:(self.anim_ref,{
                    'sourceExportSHA256':self.mesh['sourceExportSHA256'],'animationReferenceOffset':99})),
            'build_pawnanim':SimpleNamespace(original_animation=lambda p,e,include_tracks:copy.deepcopy(self.animation),
                source_ref_path=lambda p,ref,pkg:self.mesh_ref if ref==1 else self.anim_ref),
            'check_animation_linkup_native':linkup,
        }
        for patcher in [patch.dict(sys.modules,modules),patch.object(npc,'ROOT',self.root),
                        patch.object(sys,'path',sys.path[:]),
                        patch.object(npc,'built_correspondence',return_value={'geometryProof':{'status':'synthetic-test'},'skinProof':{'status':'unverified'}})]:
            patcher.start();self.addCleanup(patcher.stop)

    def test_qualified_shared_mesh_deduplicates_bundle_without_collapsing_class_selectors(self):
        catalogs,skeletons,index=self.npc.collect_npcs([101,102])
        self.assertEqual(len(catalogs),1);model=next(iter(catalogs));c=catalogs[model];s=skeletons[model]
        self.assertEqual(self.export_calls,[(self.mesh_ref,'SkeletalMesh'),(self.anim_ref,'MeshAnimation')])
        self.assertEqual(c['sequences'],self.animation['sequences'])
        self.assertEqual(s['trackBindings'],[0,-1,1], 'cross-package token numbers cannot be compared as global IDs')
        self.assertEqual(c['source']['packageSHA256'],s['source']['animationPackageSHA256'])
        self.assertNotEqual(s['source']['meshPackageSHA256'],s['source']['animationPackageSHA256'])
        self.assertEqual(c['source']['exportSHA256'],hashlib.sha256(b'ANIMATION').hexdigest())
        self.assertEqual(index['npcs']['102']['className'],'Original.Creature102')
        self.assertEqual(index['npcs']['101']['selectors'],self.selectors['npcs']['101']['selectors'])
        self.assertEqual(index['models'][model]['bundle'],f'animation-tracks/runtime/{model}.l2anim')
        pack_animation_bundle(c,s)

    def test_stale_package_animation_and_ambiguous_names_reject(self):
        for change,pattern in [
                (lambda:self.selectors['animations'][self.anim_ref.casefold()].__setitem__('sourceExportSHA256','0'*64),'animation changed'),
                (lambda:self.selectors['sources'].__setitem__('animations/MeshPkg.ukx','0'*64),'package changed'),
                (lambda:self.mesh_package.names.append('ROOT'),'name-table')]:
            selectors=copy.deepcopy(self.selectors);names=self.mesh_package.names[:]
            change()
            with self.subTest(pattern=pattern),self.assertRaisesRegex(ValueError,pattern):self.npc.collect_npcs([101,102])
            self.selectors=selectors;self.mesh_package.names=names

    def test_missing_source_or_requested_ids_never_use_legacy_built_alias(self):
        self.selectors['npcs']['101']['status']='unresolved-source'
        with self.assertRaisesRegex(ValueError,'no resolved original'):self.npc.collect_npcs([101,102])
        for ids in ([],[101,101],[True],[0],[103]):
            with self.subTest(ids=ids),self.assertRaises(ValueError):self.npc.collect_npcs(ids)

    def test_optional_skin_is_carried_in_skeleton_without_relabeling_native_deformation(self):
        skin={'format':'elbera-original-npc-skin-inputs-v1','stream':'stored-gpu-soft52',
              'primitives':[{'primitiveIndex':0,'bones':[[0,0,-1,-1]],
                             'weights':[[.25,.75,0.,-0.]]}]}
        built={'geometryProof':{'status':'synthetic-test'},
               'skinProof':{'status':'unverified'},'sourceSkin':copy.deepcopy(skin)}
        with patch.object(self.npc,'built_correspondence',return_value=built) as correspondence:
            catalogs,skeletons,index=self.npc.collect_npcs([101,102],include_skin=True)
        correspondence.assert_called_once()
        self.assertEqual(correspondence.call_args.kwargs,{'include_skin':True})
        model=next(iter(catalogs));skeleton=skeletons[model]
        self.assertEqual(skeleton['sourceSkin'],skin)
        indexed=index['models'][model]['built']
        self.assertNotIn('sourceSkin',indexed,'large lane arrays should have one bundle owner')
        self.assertEqual(indexed['skinProof']['status'],'unverified')
        self.assertEqual(indexed['skinProof']['runtimeInputs'],'stored-gpu-soft52')
        blob=pack_animation_bundle(catalogs[model],skeleton)
        size=struct.unpack_from('<I',blob,8)[0]
        actual=json.loads(blob[16:16+size])['skeleton']['sourceSkin']
        self.assertEqual(actual,skin)
        self.assertEqual(struct.pack('<4f',*actual['primitives'][0]['weights'][0]),
                         struct.pack('<4f',.25,.75,0.,-0.))


class NpcBuiltCorrespondenceTests(unittest.TestCase):
    """Actual geometry/path verifier using a fully authored triangle and glTF."""
    def setUp(self):
        import npc_source_tracks as npc
        self.npc=npc
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name);(self.base/'models').mkdir()
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'dat'))
        self.addCleanup(lambda:sys.path.remove(str(Path(__file__).resolve().parents[1]/'dat')))
        self.raw=bytearray();self.views=[];self.accessors=[]
        def attribute(rows,fmt,width,component,kind):
            self.raw.extend(b'\0'*(-len(self.raw)%4));start=len(self.raw)
            for row in rows:self.raw.extend(struct.pack('<'+str(width)+fmt,*row))
            self.views.append({'buffer':0,'byteOffset':start,'byteLength':len(self.raw)-start})
            self.accessors.append({'bufferView':len(self.views)-1,'componentType':component,'count':len(rows),'type':kind})
            return len(self.accessors)-1
        self.attribute=attribute
        pos=attribute([(0.,0.,0.),(1.,0.,0.),(0.,0.,1.)],'f',3,5126,'VEC3')
        uv=attribute([(0.,0.),(1.,0.),(0.,1.)],'f',2,5126,'VEC2')
        joints=attribute([(0,0,0,0)]*3,'H',4,5123,'VEC4')
        weights=attribute([(1.,0.,0.,0.)]*3,'f',4,5126,'VEC4')
        indices=attribute([(0,),(1,),(2,)],'H',1,5123,'SCALAR')
        self.weight_offset=self.views[weights]['byteOffset']
        self.gltf={'asset':{'version':'2.0'},'buffers':[{'uri':'fixture.bin','byteLength':len(self.raw)}],
            'bufferViews':self.views,'accessors':self.accessors,
            'nodes':[{'name':'Root'},{'name':'mFixture','mesh':0,'skin':0}],
            'skins':[{'joints':[0]}],'materials':[{'name':'SyntheticMaterial'}],
            'meshes':[{'name':'mFixture','primitives':[{'attributes':{'POSITION':pos,'TEXCOORD_0':uv,
                       'JOINTS_0':joints,'WEIGHTS_0':weights},'indices':indices,'material':0}]}]}
        self.source={'name':'mFixture','bones':[{'name':'Root','parent':0}],
            'vertices':[{'position':p,'uv':uv,'sourceInfluences':[(0,1.)],
                         'localBones':[0,255,255,255],'weights':[1.,0.,0.,0.]}
                        for p,uv in [((0.,0.,0.),(0.,0.)),((100.,0.,0.),(1.,0.)),((0.,100.,0.),(0.,1.))]],
            'stream':'soft','useNewWedges':1,'softIndices':[0,1,2],
            'softSections':[{'firstFace':0,'numFaces':1,'material':0,'boneMap':[0]}],
            'materialSlots':[{'textureIndex':0,'polyFlags':0}], 'sourceLOD0':{'SHA256':'f'*64}}
        self.diagnostic={'gltf':'models/fixture.gltf','status':'legacy-only'}
        (self.base/'manifest.json').write_text(json.dumps({'models':[{'id':'fixture','gltf':'models/fixture.gltf'}]}))
        self.save()

    def save(self):
        (self.base/'models/fixture.gltf').write_text(json.dumps(self.gltf))
        (self.base/'models/fixture.bin').write_bytes(self.raw)

    def test_source_geometry_and_bone_paths_match_but_weights_remain_unverified(self):
        result=self.npc.built_correspondence(self.base,self.diagnostic,self.source)
        self.assertEqual(result['modelId'],'fixture');self.assertEqual(result['boneNodes'],[0])
        self.assertEqual(result['geometryProof']['status'],'triangle-position-uv-winding-exact')
        self.assertEqual(result['sourceTriangles'],1)
        self.assertEqual(result['skinProof']['status'],'unverified')
        self.assertEqual(result['buffers'][0],{'uri':'fixture.bin','byteLength':len(self.raw),
                         'SHA256':hashlib.sha256(self.raw).hexdigest()})
        for i in range(3):struct.pack_into('<f',self.raw,self.weight_offset+i*16,.5)
        self.save();changed=self.npc.built_correspondence(self.base,self.diagnostic,self.source)
        self.assertEqual(changed['skinProof']['status'],'unverified')
        self.assertEqual(changed['skinProof']['differentInfluenceVertices'],3)

    def test_changed_actual_geometry_and_renamed_bone_cannot_use_legacy_alias(self):
        struct.pack_into('<f',self.raw,0,2.);self.save()
        with self.assertRaisesRegex(ValueError,'triangle position'):self.npc.built_correspondence(self.base,self.diagnostic,self.source)
        struct.pack_into('<f',self.raw,0,0.);self.gltf['nodes'][0]['name']='DifferentRoot';self.save()
        with self.assertRaisesRegex(ValueError,'bone-parent path'):self.npc.built_correspondence(self.base,self.diagnostic,self.source)

    def test_buffer_escape_or_wrong_size_fails_before_source_admission(self):
        for uri in ('../fixture.bin','https://invalid/fixture.bin','%2e%2e/fixture.bin'):
            self.gltf['buffers'][0]['uri']=uri;self.save()
            with self.subTest(uri=uri),self.assertRaises(ValueError):self.npc.built_correspondence(self.base,self.diagnostic,self.source)
        self.gltf['buffers'][0]['uri']='fixture.bin';self.raw.append(0);self.save()
        with self.assertRaisesRegex(ValueError,'byte length'):self.npc.built_correspondence(self.base,self.diagnostic,self.source)

    def test_source_skin_preserves_four_ordered_lanes_and_signed_zero_across_shuffled_built_joints(self):
        self.source['bones'] += [{'name':name,'parent':0} for name in ('B','C','D')]
        self.gltf['nodes'][0]['children']=[2,3,4]
        self.gltf['nodes'] += [{'name':name} for name in ('B','C','D')]
        self.gltf['skins'][0]['joints']=[4,2,0,3]
        self.source['softSections'][0]['boneMap']=[3,0,2,1]
        for vertex in self.source['vertices']:
            vertex.update(localBones=[2,0,2,255],weights=[.125,.25,.5,-0.],
                          sourceInfluences=[(2,.125),(3,.25),(2,.5)])
        self.save();before=(copy.deepcopy(self.source),copy.deepcopy(self.gltf),bytes(self.raw))
        result=self.npc.built_correspondence(self.base,self.diagnostic,self.source,include_skin=True)
        skin=result['sourceSkin']
        self.assertEqual(skin['boneNodes'],[0,2,3,4])
        self.assertEqual(skin['primitives'][0]['bones'],[[2,3,2,-1]]*3)
        for row in skin['primitives'][0]['weights']:
            self.assertEqual(struct.pack('<4f',*row),struct.pack('<4f',.125,.25,.5,-0.))
            self.assertEqual(sum(row),.875,'do not normalize the stored Float32 input lanes')
        self.assertEqual(skin['builtGLTFSHA256'],result['gltfSHA256'])
        self.assertEqual(skin['builtBuffers'],result['buffers'])
        self.assertEqual(skin['sourceLOD0SHA256'],'f'*64)
        self.assertEqual((self.source,self.gltf,bytes(self.raw)),before)
        self.assertNotIn('sourceSkin',self.npc.built_correspondence(self.base,self.diagnostic,self.source))

    def test_source_skin_equal_position_uv_is_rejected_when_ordered_lanes_are_ambiguous(self):
        self.source['bones'].append({'name':'Child','parent':0})
        self.gltf['nodes'][0]['children']=[2];self.gltf['nodes'].append({'name':'Child'})
        self.gltf['skins'][0]['joints']=[0,2]
        self.source['softSections'][0]['boneMap']=[0,1]
        for vertex in self.source['vertices']:
            vertex.update(localBones=[0,1,255,255],weights=[.25,.75,0.,0.],
                          sourceInfluences=[(0,.25),(1,.75)])
        # Two geometrically identical triangles are legal source data. Their
        # complete lane sequence, not a sum/sort, must disambiguate the mapping.
        self.source['vertices'] += copy.deepcopy(self.source['vertices'])
        self.source['softIndices']=[0,1,2,3,4,5]
        self.source['softSections'][0]['numFaces']=2
        primitive=self.gltf['meshes'][0]['primitives'][0]
        primitive['indices']=self.attribute([(0,),(1,),(2,),(0,),(1,),(2,)],'H',1,5123,'SCALAR')
        self.gltf['buffers'][0]['byteLength']=len(self.raw);self.save()
        self.npc.built_correspondence(self.base,self.diagnostic,self.source,include_skin=True)
        self.source['vertices'][3].update(localBones=[1,0,255,255],weights=[.75,.25,0.,0.])
        with self.assertRaisesRegex(ValueError,'ambiguous original GPU ordered'):
            self.npc.built_correspondence(self.base,self.diagnostic,self.source,include_skin=True)
        # Equal arithmetic weights with a different stored zero sign are also
        # distinct byte records and cannot be silently selected.
        self.source['vertices'][3].update(localBones=[0,1,255,255],weights=[.25,.75,-0.,0.])
        with self.assertRaisesRegex(ValueError,'ambiguous original GPU ordered'):
            self.npc.built_correspondence(self.base,self.diagnostic,self.source,include_skin=True)

    def test_source_skin_mapping_stays_with_each_material_section(self):
        # Identical POSITION/UV in different sections may legitimately carry
        # different influences. Matching must use each source section's range.
        self.source['bones'].append({'name':'Child','parent':0})
        self.gltf['nodes'][0]['children']=[2];self.gltf['nodes'].append({'name':'Child'})
        self.gltf['skins'][0]['joints']=[0,2]
        self.source['vertices'] += copy.deepcopy(self.source['vertices'])
        for vertex in self.source['vertices'][3:]:vertex['sourceInfluences']=[(1,1.)]
        self.source['softIndices'] += [3,4,5]
        self.source['softSections'].append({'firstFace':1,'numFaces':1,'material':0,'boneMap':[1]})
        self.gltf['meshes'][0]['primitives'].append(copy.deepcopy(self.gltf['meshes'][0]['primitives'][0]))
        self.save()
        result=self.npc.built_correspondence(self.base,self.diagnostic,self.source,include_skin=True)
        self.assertEqual([p['bones'] for p in result['sourceSkin']['primitives']],
                         [[[0,-1,-1,-1]]*3,[[1,-1,-1,-1]]*3])

    def test_source_skin_rejects_unproved_stream_palette_lane_and_float_inputs(self):
        mutations=[
            ('stream',lambda:self.source.__setitem__('stream','rigid')),
            ('stream',lambda:self.source.__setitem__('useNewWedges',0)),
            ('palette',lambda:self.source['softSections'][0].__setitem__('boneMap',[])),
            ('palette',lambda:self.source['softSections'][0].__setitem__('boneMap',[0]*71)),
            ('lane',lambda:self.source['vertices'][0]['localBones'].__setitem__(0,1)),
            ('lane',lambda:self.source['vertices'][0]['localBones'].__setitem__(0,True)),
            ('sentinel',lambda:self.source['vertices'][0]['localBones'].__setitem__(0,255)),
            ('outside skeleton',lambda:self.source['softSections'][0].__setitem__('boneMap',[1])),
            ('lane',lambda:self.source['vertices'][0]['weights'].__setitem__(0,-.5)),
            ('Float32',lambda:self.source['vertices'][0]['weights'].__setitem__(0,.1)),
            ('Float32',lambda:self.source['vertices'][0]['weights'].__setitem__(0,float('nan'))),
            ('Float32',lambda:self.source['vertices'][0]['weights'].__setitem__(0,True)),
        ]
        # The real geometry proof is already exercised above. Here isolate the
        # new admission gates from unrelated legacy source-audit assertions.
        built=self.npc.built_correspondence(self.base,self.diagnostic,self.source)
        original=copy.deepcopy(self.source)
        for pattern,change in mutations:
            self.source=copy.deepcopy(original);change()
            with self.subTest(pattern=pattern),self.assertRaisesRegex(ValueError,pattern):
                self.npc.source_skin_inputs(self.gltf,[bytes(self.raw)],self.source,built)
        self.source=original
        self.source['softSections'][0]['boneMap']=[0]*70
        self.npc.source_skin_inputs(self.gltf,[bytes(self.raw)],self.source,built)

    def test_source_skin_rejects_extra_skin_sets_morphs_and_unmapped_vertices(self):
        built=self.npc.built_correspondence(self.base,self.diagnostic,self.source)
        primitive=self.gltf['meshes'][0]['primitives'][0]
        primitive['attributes']['JOINTS_1']=primitive['attributes']['JOINTS_0']
        with self.assertRaisesRegex(ValueError,'additional skin sets'):
            self.npc.source_skin_inputs(self.gltf,[bytes(self.raw)],self.source,built)
        del primitive['attributes']['JOINTS_1'];primitive['targets']=[{'POSITION':0}]
        with self.assertRaisesRegex(ValueError,'morphs'):
            self.npc.source_skin_inputs(self.gltf,[bytes(self.raw)],self.source,built)
        del primitive['targets'];struct.pack_into('<f',self.raw,0,2.)
        with self.assertRaisesRegex(ValueError,'no exact original GPU correspondence'):
            self.npc.source_skin_inputs(self.gltf,[bytes(self.raw)],self.source,built)


if __name__ == '__main__': unittest.main()
