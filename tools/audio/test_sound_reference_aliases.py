"""Portable original sound identity/ambiguity fixtures; no client assets."""
import unittest
import copy
from types import SimpleNamespace

from sound_reference_aliases import check_manifest, manifest_summary, match_records, original_path


def sound(path='Bank.Group.Step', leaf='Step'):
    return {'reference':path,'package':'Bank','leaf':leaf,'export':2,'SHA256':'source'}


def output(package='bank',leaf='step',path='bank/step.ogg'):
    return {'package':package,'leaf':leaf,'path':path,'SHA256':'audio'}


class SoundAliasTests(unittest.TestCase):
    def test_manifest_summary_hashes_canonical_full_evidence_without_embedding_it(self):
        report = {'format':'fixture-v1', 'packages':{'bank':{'SHA256':'source'}},
                  'sourceSounds':1, 'audioOutputs':1, 'unresolved':[],
                  'references':{'bank.group.step':{'audioSHA256':'audio','sourceExport':2}}}
        summary = manifest_summary(report)
        reordered = dict(reversed(list(report.items())))
        reordered['references'] = {'bank.group.step':{'sourceExport':2,'audioSHA256':'audio'}}
        self.assertEqual(summary, manifest_summary(reordered))
        self.assertEqual(summary['verifiedReferences'], 1)
        self.assertNotIn('references', summary)
        self.assertNotIn('packages', summary)
        changed = copy.deepcopy(report)
        changed['references']['bank.group.step']['audioSHA256'] = 'different'
        self.assertNotEqual(summary['reportSHA256'], manifest_summary(changed)['reportSHA256'])

    def test_manifest_check_rejects_missing_alias_and_changed_source_digest_or_counts(self):
        report = {'format':'fixture-v1','packages':{},'sourceSounds':1,'audioOutputs':1,
                  'references':{'bank.group.step':{'audioSHA256':'audio'}},'unresolved':[]}
        aliases = {'bank.group.step':'bank/step.ogg'}
        manifest = {'sfx':dict(aliases),'soundReferences':manifest_summary(report)}
        check_manifest(manifest, aliases, report)
        for field, value in [('reportSHA256','stale'),('sourceSounds',2)]:
            bad = copy.deepcopy(manifest); bad['soundReferences'][field] = value
            with self.assertRaisesRegex(ValueError,'summary'):check_manifest(bad,aliases,report)
        for mapping in ({}, {'bank.group.step':'bank/other.ogg'}):
            bad = copy.deepcopy(manifest); bad['sfx'] = mapping
            with self.assertRaisesRegex(ValueError,'reference'):check_manifest(bad,aliases,report)

    def test_qualified_alias_requires_both_exact_unique_identities(self):
        aliases, source, unresolved = match_records([sound()],[output()])
        self.assertEqual(aliases,{'bank.group.step':'bank/step.ogg'})
        self.assertEqual(source['bank.group.step']['sourceExport'],2)
        self.assertEqual(source['bank.group.step']['audioSHA256'],'audio')
        self.assertEqual(unresolved,[])

    def test_different_original_groups_cannot_share_a_flat_export_guess(self):
        aliases, _, errors = match_records([sound(),sound('Bank.Other.Step')],[output()])
        self.assertEqual(aliases,{})
        self.assertEqual([e['reason'] for e in errors],['ambiguous-original-basename']*2)

    def test_case_collisions_missing_file_and_other_package_do_not_alias(self):
        for outputs, reason in [([], 'missing-audio-output'), ([output(package='Other')],'missing-audio-output'),
                                ([output(),output(leaf='STEP',path='bank/STEP.ogg')],'ambiguous-audio-output')]:
            aliases,_,errors=match_records([sound()],outputs)
            self.assertEqual(aliases,{})
            self.assertEqual(errors[0]['reason'],reason)
        with self.assertRaises(ValueError):match_records([sound(),sound('BANK.GROUP.STEP')],[output()])

    def test_serialized_nested_group_chain_is_preserved_and_cycles_rejected(self):
        exports={1:SimpleNamespace(name='Outer',package_index=0),
                 2:SimpleNamespace(name='Inner',package_index=1)}
        pkg=SimpleNamespace(export_name=lambda e:e.name,resolve_ref=lambda ref:exports[ref],class_name_of=lambda e:'Package')
        item=SimpleNamespace(name='Step',package_index=2)
        self.assertEqual(original_path(pkg,item,'Bank'),'Bank.Outer.Inner.Step')
        exports[1].package_index=2
        with self.assertRaises(ValueError):original_path(pkg,item,'Bank')
        item.package_index=-1
        with self.assertRaises(ValueError):original_path(pkg,item,'Bank')


if __name__ == '__main__':unittest.main()
