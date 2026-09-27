#!/usr/bin/env python3
"""Elbera Tools: differential check of the bounded browser notify clock.

Synthetic clock inputs are compared with the independent Python reference;
its crossing and remainder arithmetic are first checked against the pinned
original Engine instructions. --source-coverage additionally re-reads all
original player packages and slot tables in memory, without generating assets.
No browser, game server or callback side effects are invoked.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import random
import subprocess
import sys

from check_anim_notify_native import advance_channel, f32, verify

ROOT = Path(__file__).resolve().parents[2]


def note(time, *, shot=False, bone=False, null=False):
    return {'t': f32(time), 'isAttackShot': shot, 'isBoneScale': bone,
            'objectRef': 0 if null else 1, 'function': 'None',
            'classPath': None if null else 'Fixture.Notify'}


def cases():
    base = {'frame': .125, 'rate': 1., 'last': .875, 'delta': .75,
            'notifies': [], 'loop': False, 'tweenRate': 0., 'notifiesEnabled': True}
    out = []

    def add(name, **values):
        out.append({'name': name, 'input': {**base, **values}})

    add('multiple-ascending', notifies=[note(.25), note(.5)])
    add('multiple-unsorted', notifies=[note(.75), note(.25), note(.5)])
    add('equal-times', notifies=[note(.5), note(.5), note(.5)])
    add('null-splits-clock', notifies=[note(.25, null=True)])
    add('above-one-null-before-endpoint-clamp', frame=.5, delta=1., last=.75,
        notifies=[note(1.25, null=True)])
    add('old-exclusive-end-inclusive', notifies=[note(.125), note(.875)])
    add('one-shot-endpoint', frame=.5, delta=.25, last=.75, notifies=[note(.75)])
    add('loop-exact-one-notify-drops-remainder', frame=.75, delta=.5,
        loop=True, notifies=[note(0.), note(.125), note(1.)])
    add('loop-wrap-excludes-zero', frame=.75, delta=.5, loop=True,
        notifies=[note(0.), note(.125)])
    add('loop-cap', frame=0., delta=8.5, loop=True)
    add('tween-loop-shared-cap', frame=-.25, delta=8.5, last=.75, loop=True, tweenRate=1.)
    add('negative-tween-only', frame=-.25, delta=.125, tweenRate=1.)
    add('tween-cross-zero', frame=-.25, delta=.5, tweenRate=1., notifies=[note(0.), note(.125)])
    add('zero-delta', delta=0., notifies=[note(.5)])
    add('zero-rate', rate=0., notifies=[note(.5)])
    add('disabled-does-not-split', notifiesEnabled=False, notifies=[note(.25), note(.5)])
    add('disabled-removal-candidates', notifiesEnabled=False,
        notifies=[note(.25, shot=True), note(.5, shot=True), note(.75, bone=True)])
    add('duplicate-attack-rejected', notifies=[note(.25, shot=True), note(.5, shot=True)])
    add('bone-removal-rejected', notifies=[note(.5, bone=True)])
    add('uncrossed-duplicate-attack-allowed', notifies=[note(0., shot=True), note(.5, shot=True)])
    add('nine-events-one-advancement', notifies=[note(.5) for _ in range(9)])

    def reject(name, reason, **values):
        # Browser safety admission, not a claim that native overflow is usable
        # or that the finite Python/native-slice reference supports that domain.
        add(name, **values)
        out[-1]['expectedUnsupported'] = reason

    reject('ordinary-frame-overflow', 'nonfinite-channel-result', rate=3e38, delta=2.)
    reject('tween-frame-overflow', 'nonfinite-channel-result',
           frame=-.25, tweenRate=3e38, delta=2.)
    reject('notify-remainder-overflow', 'nonfinite-channel-result',
           frame=0., notifies=[note(1e-45), note(.5)])
    reject('stationary-loop-division-zero', 'nonfinite-channel-result',
           frame=1., rate=1e-40, delta=1e-10, loop=True)
    reject('endpoint-rounds-one', 'invalid-channel-clock', last=1. - 1e-10)
    rng = random.Random(1177)
    for index in range(160):
        # All synthetic source values are Float32, as in the package stream.
        frame = f32(rng.uniform(0., .75))
        delta = f32(rng.uniform(.001, 2.))
        notes = [note(rng.uniform(.001, 1.5), null=(j % 3 == 0)) for j in range(index % 6)]
        if notes and index % 5 == 0:
            notes[-1]['isAttackShot'] = True
        add('random-' + str(index), frame=frame, rate=f32(rng.uniform(.1, 4.)),
            delta=delta, notifies=notes, loop=index % 2 == 0,
            notifiesEnabled=index % 7 != 0)
    return out


def expected(case):
    if 'expectedUnsupported' in case:
        return {'status': 'unsupported', 'reason': case['expectedUnsupported']}
    values = case['input']
    notes = values['notifies'] if values['notifiesEnabled'] else []
    try:
        return {'status': 'ready', **advance_channel(
            values['frame'], values['rate'], values['last'], values['delta'], notes,
            loop=values['loop'], tween_rate=values['tweenRate'])}
    except ValueError as error:
        if 'aliased removal' not in str(error):
            raise
        return {'status': 'unsupported', 'boundary': 'native-class-filter-removal'}


def source_coverage():
    """Static potential-removal coverage, not a claim about live tick frequency.

    Selector × model × six source stances is a coverage matrix, not an assertion
    that every skill uses every combination. A complete source sequence with
    multiple positive AttackShot times may need removal on a sufficiently large
    frame step; it can still be usable on smaller steps. Missing renderable clips
    are reported separately from that notify limitation.
    """
    from check_skillanim_native import derive
    sys.path.insert(0, str(ROOT / 'tools/anim'))
    from build_pawnanim import build
    stats = {}
    table = build(stats)  # Fresh original files; no generated JSON as oracle.
    mapping = derive()['mapping']
    matrix, counts, affected = [], Counter(), {}
    stances = table['stanceIndex']
    for model, data in sorted(table['models'].items()):
        for code, slots in sorted(mapping.items()):
            for stance in stances:
                issues, sources = [], []
                for slot in slots:
                    source = data['slotSource'].get(slot, {}).get(stance)
                    if not source or source['status'] != 'source-sequence':
                        issues.append('missing-source-slot'); continue
                    info = table['sequences'][model][source['seq'].lower()]
                    if not source['clip']:
                        issues.append('missing-rendered-clip')
                    notes = info['notifies']
                    shot = sum(n['isAttackShot'] and n['t'] > 0 for n in notes)
                    bone = sum(n['isBoneScale'] and n['t'] > 0 for n in notes)
                    named = sum(n.get('function') not in (None, 'None') for n in notes)
                    if shot > 1 or bone:
                        issues.append('potential-filter-removal')
                        affected[(model, source['seq'])] = {'model': model, 'sequence': source['seq'],
                            'positiveAttackShots': shot, 'positiveBoneScales': bone,
                            'notifies': len(notes)}
                    if named: issues.append('legacy-function-conversion')
                    sources.append(source['seq'])
                unique = sorted(set(issues))
                counts['combinations'] += 1
                counts['sourceComplete' if 'missing-source-slot' not in unique else 'sourceMissing'] += 1
                if not unique: counts['completeWithoutRemovalPotential'] += 1
                for issue in unique: counts[issue] += 1
                matrix.append({'model': model, 'animation': code, 'stance': stance,
                               'issues': unique, 'sequences': sources})
    return {'source': table['source'], 'models': len(table['models']),
            'selectors': len(mapping), 'sourceNotifies': stats['notify_rows'],
            'counts': dict(counts), 'affectedSequences': list(affected.values()),
            'combinations': matrix,
            'limits': ['fresh original source extraction, current manifest used only for renderability',
                       'potential removal at a large positive frame step, not a measured per-cast failure rate',
                       'selector/model/stance matrix does not assert every skill uses every combination',
                       'explicit enabled-channel state and all other runtime gates remain required']}


def check():
    evidence = verify()
    inputs = cases()
    script = """
import fs from 'node:fs';
import { advanceAnimationChannel } from './editor/world/js/animnotify-clock.js';
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(cases.map(c => {
  const before = JSON.stringify(c.input);
  const result = advanceAnimationChannel(c.input);
  if (before !== JSON.stringify(c.input)) throw new Error('input mutated: ' + c.name);
  return result;
})));
"""
    run = subprocess.run(['node', '--input-type=module', '-e', script],
                         input=json.dumps(inputs), text=True, capture_output=True,
                         cwd=ROOT, check=True, timeout=30)
    actuals = json.loads(run.stdout)
    assert len(actuals) == len(inputs)
    for case, actual in zip(inputs, actuals):
        want = expected(case)
        assert actual['status'] == want['status'], (case['name'], actual, want)
        if want['status'] == 'unsupported':
            assert actual.get('reason'), (case['name'], actual)
            if 'reason' in want:
                assert actual['reason'] == want['reason'], (case['name'], actual, want)
            assert 'events' not in actual, (case['name'], actual)
            continue
        for field in ('frame', 'rate', 'remaining', 'discarded', 'advancements'):
            assert actual[field] == want[field], (case['name'], field, actual[field], want[field], case['input'])
        assert actual['events'] == want['events'], (case['name'], actual['events'], want['events'])
    return {'tool': 'Elbera Tools', 'status': 'verified', 'cases': len(inputs),
            'derivedDomainRejections': sum('expectedUnsupported' in case for case in inputs),
            'engineSHA256': evidence['engineSHA256'],
            'nativeBoundaryCases': evidence['nativeBoundaryCases'],
            'nativeRemainderCases': len(evidence['nativeRemainderCases']),
            'limits': ['synthetic channel state with immutable callbacks; no live native execution',
                       'native slices establish crossing/remainder arithmetic; full Python clock is independently transcribed',
                       'Float64 intermediates and original Float32 stores, not exact x87 precision',
                       'nonfinite derived clocks are browser admission rejections, outside the finite native reference domain',
                       'filtered batches reject before adoption; original removed-import alias behavior remains unresolved']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--source-coverage', action='store_true')
    parser.add_argument('--coverage-output', type=Path, help='save source matrix to an explicitly selected private/local file')
    args = parser.parse_args()
    result = check()
    if args.source_coverage:
        coverage = source_coverage()
        result['sourceCoverage'] = {k: v for k, v in coverage.items() if k not in ('source', 'combinations')}
        if args.coverage_output:
            args.coverage_output.parent.mkdir(parents=True, exist_ok=True)
            args.coverage_output.write_text(json.dumps(coverage, indent=2) + '\n')
    elif args.coverage_output:
        parser.error('--coverage-output requires --source-coverage')
    print(json.dumps(result, indent=2))
