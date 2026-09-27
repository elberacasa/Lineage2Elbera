"""Portable authored fixtures; no original client files or converters required."""
import contextlib
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import build_npc_variants as variants


def source_package():
    """A grouped export and a homonymous top-level object are distinct."""
    exports = [SimpleNamespace(index=i, name=name, kind=kind, package_index=outer)
               for i, (name, kind, outer) in enumerate([
                   ('Group', 'Package', 0), ('Mesh', 'SkeletalMesh', 1),
                   ('Mesh', 'SkeletalMesh', 0), ('ExactAnim', 'MeshAnimation', 0)])]
    imports = [SimpleNamespace(name='External', package_index=0),
               SimpleNamespace(name='ActualAnim', package_index=-1)]
    def resolve(ref):
        if not ref or ref > len(exports) or ref < -len(imports):
            raise ValueError('invalid original reference')
        return exports[ref - 1] if ref > 0 else imports[-ref - 1]
    return SimpleNamespace(path='Fixture.ukx', file_version=123, licensee_version=30,
        exports=exports, resolve_ref=resolve, export_name=lambda e:e.name,
        import_name=lambda e:e.name, class_name_of=lambda e:e.kind,
        name=lambda index: ['Root'][index])


def skeletal_prefix(reference):
    # Property None is mocked separately. All native fields below follow the
    # bounded serialized prefix, with one full RefSkeleton bone.
    return (bytes(41) + struct.pack('<ii', 5, 0) + b'\0\0' + bytes(36)
            + bytes(5) + bytes(24) + bytes(4) + b'\0' + bytes(52)
            + bytes(8) + b'\0' + b'\1\0' + bytes(56) + bytes([reference]))


class OriginalNpcVariantTest(unittest.TestCase):
    def test_qualified_parent_and_child_array_elements(self):
        tables = {
            'childpkg': {'corpse': {'WaitAnimName': {'0': 'DeathWait'}}},
            'parentpkg': {'pawn': {'WaitAnimName': {'0': 'Wait', '1': 'ArmedWait'}}},
            'otherpkg': {'pawn': {'WaitAnimName': {'0': 'Wrong'}}},
        }
        parents = {'childpkg.corpse': 'parentpkg.pawn', 'parentpkg.pawn': None}
        fields, chain = variants.resolve_fields('ChildPkg.Corpse', tables, parents.__getitem__)
        self.assertEqual(chain, ['childpkg.corpse', 'parentpkg.pawn'])
        self.assertEqual(fields['WaitAnimName']['0'], {'value': 'DeathWait', 'declaredBy': 'childpkg.corpse'})
        self.assertEqual(fields['WaitAnimName']['1']['value'], 'ArmedWait')
        self.assertEqual(fields['WaitAnimName']['1']['declaredBy'], 'parentpkg.pawn')

    def test_shared_mesh_classes_keep_distinct_original_idles(self):
        tables = {'p': {'live': {'WaitAnimName': {'0': 'Wait'}},
                        'corpse': {'WaitAnimName': {'0': 'DeathWait'}}}}
        resolve = lambda name: variants.resolve_fields(name, tables, lambda _key: None)[0]
        self.assertNotEqual(resolve('p.live'), resolve('p.corpse'))

    def test_missing_ancestor_and_cycle_cannot_silently_terminate(self):
        with self.assertRaises(KeyError):
            variants.resolve_fields('p.child', {}, {}.__getitem__)
        with self.assertRaisesRegex(ValueError, 'cyclic'):
            variants.resolve_fields('p.child', {}, lambda _key: 'p.child')

    def test_sequence_lookup_has_no_keyword_or_first_clip_fallback(self):
        self.assertEqual(variants.exact_sequence(['DeathWait_Hand', 'Wait'], 'deathwait_hand'), 'DeathWait_Hand')
        for available, requested in [(['Wait'], 'DeathWait'), (['Wait', 'wait'], 'WAIT')]:
            with self.assertRaises(ValueError):
                variants.exact_sequence(available, requested)

    def test_bone_order_and_existing_bind_transform_must_match(self):
        ctx = {'skeleton': SimpleNamespace(bones=[{}, {}]),
               'parts': [({'bones': [{'name': 'Root'}, {'name': 'Hand'}]}, [0, 1])]}
        fresh = {'nodes': [{'name': 'Root'}, {'name': 'Hand'}]}
        gltf = {**fresh, 'skins': [{'joints': [0, 1]}]}
        variants.check_skeleton(gltf, fresh, ctx, ['root', 'hand'])
        with self.assertRaisesRegex(ValueError, 'positionally'):
            variants.check_skeleton(gltf, fresh, ctx, ['Hand', 'Root'])
        with self.assertRaisesRegex(ValueError, 'positionally'):
            variants.check_skeleton(gltf, fresh, ctx, ['Root', 'Hand', 'Extra'])
        with self.assertRaisesRegex(ValueError, 'skeleton differs'):
            variants.check_skeleton({**gltf, 'nodes': [{'name': 'Other'}]}, fresh, ctx, ['Root', 'Hand'])
        with self.assertRaisesRegex(ValueError, 'node mapping'):
            variants.check_skeleton({**gltf, 'skins': [{'joints': [1, 0]}]}, fresh, ctx, ['Root', 'Hand'])

    def test_hash_serialization_is_deterministic(self):
        self.assertEqual(variants.sha(variants.encode({'b': 2, 'a': 1})),
                         variants.sha(variants.encode({'a': 1, 'b': 2})))
        self.assertNotEqual(variants.sha(b'original'), variants.sha(b'changed'))

    def test_source_export_match_preserves_package_group_and_ambiguity(self):
        pkg = source_package()
        self.assertIs(variants.unique_source_export(pkg, 'fixture.group.mesh', 'SkeletalMesh'), pkg.exports[1])
        self.assertIs(variants.unique_source_export(pkg, 'Fixture.Mesh', 'SkeletalMesh'), pkg.exports[2])
        for ref in ['Other.Mesh', 'Fixture.Missing', 'Mesh']:
            with self.assertRaises(ValueError):
                variants.unique_source_export(pkg, ref, 'SkeletalMesh')
        pkg.exports.append(SimpleNamespace(index=4, name='Mesh', kind='SkeletalMesh', package_index=0))
        with self.assertRaisesRegex(ValueError, '2 exact'):
            variants.unique_source_export(pkg, 'Fixture.Mesh', 'SkeletalMesh')

    def test_serialized_animation_reference_preserves_external_null_and_bounds(self):
        pkg = source_package()
        exp = pkg.exports[2]
        for raw_ref, expected in [(4, 'Fixture.ExactAnim'), (0x82, 'External.ActualAnim'), (0, None)]:
            raw = skeletal_prefix(raw_ref)
            pkg.data = b'prefix' + raw + b'OUTSIDE-EXPORT'
            exp.serial_offset, exp.serial_size = 6, len(raw)
            with patch.object(variants.classes.up, 'read_properties', lambda _p, _r: None):
                ref, proof = variants.mesh_animation_reference(pkg, exp)
                self.assertEqual(ref, expected)
                self.assertEqual(proof['animationReferenceOffset'], 6 + len(raw) - 1)
                self.assertEqual(proof['sourceExportSHA256'], variants.sha(raw))
                exp.serial_size -= 1  # Valid-looking bytes outside the export cannot rescue it.
                with self.assertRaises((ValueError, variants.classes.up.L2Error, struct.error)):
                    variants.mesh_animation_reference(pkg, exp)

    def test_serialized_animation_prefix_rejects_wrong_versions_and_reference(self):
        pkg = source_package()
        exp = pkg.exports[2]
        pkg.data = skeletal_prefix(6)
        exp.serial_offset, exp.serial_size = 0, len(pkg.data)
        with patch.object(variants.classes.up, 'read_properties', lambda _p, _r: None):
            with self.assertRaisesRegex(ValueError, 'reference'):
                variants.mesh_animation_reference(pkg, exp)
            pkg.licensee_version = 99
            with self.assertRaisesRegex(ValueError, 'version'):
                variants.mesh_animation_reference(pkg, exp)
            pkg.licensee_version = 30
            pkg.data = pkg.data[:41] + struct.pack('<i', 4) + pkg.data[45:]
            with self.assertRaisesRegex(ValueError, 'version'):
                variants.mesh_animation_reference(pkg, exp)

    def test_selectors_do_not_conflate_none_empty_missing_or_unresolved(self):
        field = lambda value: {'value': value, 'declaredBy': 'p.mob'}
        fields = {'WaitAnimName': {'0': field('wAiT'), '2': field('None'),
                  '3': field(''), '4': field('missing')}, 'WalkAnimRate': {'0': field('0.75')}}
        rate = struct.unpack('<f', struct.pack('<f', 29.970003))[0]
        result = variants.selector_elements(fields, [{'name': 'Wait', 'frames': 1, 'rate': rate}])
        self.assertEqual(result['WaitAnimName']['0']['rate'], rate)
        self.assertEqual(result['WaitAnimName']['0']['sequence'], 'Wait')
        self.assertEqual(result['WaitAnimName']['0']['frames'], 1)
        self.assertEqual(result['WaitAnimName']['2']['status'], 'source-none')
        self.assertEqual(result['WaitAnimName']['3']['status'], 'source-empty-localized-value')
        self.assertEqual(result['WaitAnimName']['4']['status'], 'unresolved-sequence')
        self.assertNotIn('1', result['WaitAnimName'])
        self.assertNotIn('WalkAnimName', result)
        self.assertNotIn('WalkAnimRate', result)
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            variants.selector_elements(fields, [{'name': 'Wait'}, {'name': 'wait'}])

    def test_exact_exported_aliases_require_same_source_and_unique_real_clip(self):
        seqs = [{'name': 'Strike'}, {'name': 'Wait'}]
        entry = {'clips': {'attack': 'Strike', 'special': 'strike', 'idle': 'Wait'},
                 'clipAlias': {'special': 'attack'}}
        result = variants.exported_aliases(entry, {'animations': [{'name':'attack'}, {'name':'idle'}]}, seqs)
        self.assertEqual(result['special']['clip'], 'attack')
        self.assertEqual(result['special']['sequence'], 'Strike')
        self.assertEqual(result['special']['status'], 'legacy-manifest-alias-pose-unverified')
        entry['clipAlias']['special'] = 'idle'
        self.assertNotIn('special', variants.exported_aliases(entry, {'animations':[{'name':'idle'}]}, seqs))
        self.assertNotIn('idle', variants.exported_aliases(entry, {'animations':[{'name':'idle'},{'name':'idle'}]}, seqs))
        entry['clipAlias'] = {'attack':'special','special':'attack'}
        with self.assertRaisesRegex(ValueError, 'cyclic'):
            variants.exported_aliases(entry, {'animations': []}, seqs)

    def test_build_diagnostics_hash_actual_bytes_and_do_not_claim_native_mesh(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(variants, 'ROOT', Path(tmp)):
            base = Path(tmp)/'editor/characters/monsters/models'; base.mkdir(parents=True)
            raw = json.dumps({'buffers':[{'uri':'fixture.bin','byteLength':4}],
                              'animations':[{'name':'idle'}]}).encode()
            (base/'fixture.gltf').write_bytes(raw); (base/'fixture.bin').write_bytes(b'KEYS')
            entry = {'gltf':'models/fixture.gltf','clips':{'idle':'Wait'}}
            result = variants.built_alias_record(entry, [{'name':'Wait'}])
            self.assertEqual(result['gltfSHA256'], variants.sha(raw))
            self.assertEqual(result['buffers'][0]['SHA256'], variants.sha(b'KEYS'))
            self.assertEqual(result['status'], 'legacy-model-id-match-source-mesh-unverified')
            (base/'fixture.bin').write_bytes(b'changed')
            self.assertEqual(variants.built_alias_record(entry, [])['status'], 'unresolved-existing-export')
            entry['gltf'] = '../../../outside.gltf'
            self.assertEqual(variants.built_alias_record(entry, [])['status'], 'unresolved-existing-export')

    def test_selector_cli_check_is_read_only_and_never_calls_the_clip_builder(self):
        catalog = {'format': variants.SELECTOR_FORMAT, 'npcs': {'8': {}}, 'animations': {}}
        with tempfile.TemporaryDirectory() as tmp, patch.object(variants, 'recover_selectors', return_value=catalog) as recover:
            output = Path(tmp)/'selectors.json'
            args = ['build_npc_variants.py','--selectors-only','--npc','8','--output',str(output)]
            with patch.object(variants, 'build_mesh', side_effect=AssertionError('must not build')), contextlib.redirect_stdout(io.StringIO()):
                with patch('sys.argv', args): variants.main()
                self.assertEqual(output.read_bytes(), variants.encode(catalog))
                before = output.stat().st_mtime_ns
                with patch('sys.argv', args + ['--check']): variants.main()
                self.assertEqual(output.stat().st_mtime_ns, before)
                self.assertEqual(recover.call_args.args[1], [8])
                output.write_bytes(b'stale')
                with patch('sys.argv', args + ['--check']), self.assertRaisesRegex(ValueError, 'stale'):
                    variants.main()
                self.assertEqual(output.read_bytes(), b'stale')
                recover.side_effect = ValueError('original input unavailable')
                with patch('sys.argv', args), self.assertRaisesRegex(ValueError, 'unavailable'):
                    variants.main()
                self.assertEqual(output.read_bytes(), b'stale')

    def test_catalog_keeps_shared_mesh_classes_and_follows_external_animation(self):
        import build_pawnanim
        mesh_pkg = source_package(); mesh_pkg.data = b'MESH'
        anim = SimpleNamespace(index=0, name='ActualAnim', kind='MeshAnimation', package_index=0,
                               serial_offset=0, serial_size=4)
        anim_pkg = SimpleNamespace(path='External.ukx', exports=[anim], data=b'ANIM',
            export_name=lambda e:e.name, class_name_of=lambda e:e.kind, resolve_ref=lambda i: [anim][i-1])
        rows = [dict(npc_id=n, class_name=cls, mesh_name=mesh) for n,cls,mesh in [
            (8,'ClassPkg.Live','Fixture.Mesh'), (9,'ClassPkg.Corpse','Fixture.Mesh'),
            (10,'ClassPkg.Effect','')]]
        resolved = {cls.casefold(): ({'WaitAnimName': {'0': {'value':value,'declaredBy':cls.casefold()}}},
                                    [cls.casefold(), 'engine.pawn'])
                    for cls,value in [('ClassPkg.Live','Wait'),('ClassPkg.Corpse','DeathWait'),('ClassPkg.Effect','None')]}
        sequence = lambda n: {'name':n, 'frames':1, 'rate':30.0, 'source':{'SHA256':'synthetic'}}
        with tempfile.TemporaryDirectory() as tmp, patch.object(variants, 'ROOT', Path(tmp)), \
                patch.object(variants.dat, 'decrypt', return_value='unused'), \
                patch.object(variants.dat, 'parse_npcgrp', return_value=rows), \
                patch.object(variants, 'localized_classes', return_value=(resolved, {'ClassPkg.u':'hash'})), \
                patch.object(variants.classes.up, 'load_package', side_effect=lambda path: (
                    anim_pkg if Path(path).stem == 'External' else mesh_pkg, None)), \
                patch.object(variants, 'mesh_animation_reference', return_value=('External.ActualAnim', {'sourceExportSHA256':'mesh-hash'})), \
                patch.object(build_pawnanim, 'original_animation', return_value={'sequences':[sequence('Wait'),sequence('DeathWait')]}) as parse:
            client = Path(tmp)/'assets/interlude'
            (client/'system').mkdir(parents=True); (client/'animations').mkdir()
            (client/'system/npcgrp.dat').write_bytes(b'NPCS')
            for p in ('Fixture','External'): (client/'animations'/f'{p}.ukx').write_bytes(p.encode())
            result = variants.recover_selectors(tmp, [8,9,10])
            parse.assert_called_once_with(anim_pkg, anim)
            self.assertEqual(result['npcs']['8']['selectors']['WaitAnimName']['0']['sequence'], 'Wait')
            self.assertEqual(result['npcs']['9']['selectors']['WaitAnimName']['0']['sequence'], 'DeathWait')
            self.assertEqual(result['npcs']['10']['status'], 'source-empty-mesh-name')
            self.assertIsNone(result['npcs']['10']['selectors'])
            self.assertEqual(result['npcs']['10']['localizedFields']['WaitAnimName']['0']['value'], 'None')
            self.assertEqual(list(result['animations']), ['external.actualanim'])
            self.assertEqual(result['animations']['external.actualanim']['sourceExportSHA256'], variants.sha(b'ANIM'))
            self.assertNotIn('built', result['meshes']['fixture.mesh'])
            with self.assertRaisesRegex(ValueError, 'absent'):
                variants.recover_selectors(tmp, [99])


if __name__ == '__main__':
    unittest.main()
