#!/usr/bin/env python3
"""Elbera Tools: differential check of the pure browser cast schedule planner.

Uses the existing bounded evaluator on actual pinned Engine instructions,
including the Agent lead branch. Synthetic sequence inputs contain no game
assets. The Node unit tests remain source-free; this explicit check requires
the owned original inputs and the native verifier's dependencies.
"""
import argparse
import hashlib
import json
import random
import subprocess

from check_cast_scheduler_native import Arithmetic, f32, verify
from check_tutorial_quest_native import Image, ROOT, ENGINE_SHA


def scan(phases, flexible):
    """Independent reference for the bounded original source-sequence scan.

    The native verifier anchors source field access, reverse helper and phase
    order. Arithmetic below is evaluated from original machine instructions;
    imported sequence/class lookup is represented by explicit synthetic data.
    """
    durations = [0 if i == flexible else f32(p['frames'] / f32(p['rate']))
                 for i, p in enumerate(phases)]
    attack, offset, selected = 0., 0., -1
    for i in reversed(range(len(phases))):
        if i == flexible:
            continue
        if offset > 0:
            attack = f32(attack + durations[i])
            continue
        match = next((n for n in reversed(phases[i]['notifies']) if n['isAttackShot']), None)
        selected = i
        offset = f32(f32(match['t']) * durations[i]) if match else 0.
        attack = offset
    if attack == 0:
        selected, offset = len(phases) - 1, durations[-1]
        for duration in durations:
            attack = f32(attack + duration)
    return durations, selected, offset, attack


def native(image, case, flexible):
    durations, selected, offset, attack = scan(case['phases'], flexible)
    pawn, frame, agent = 0x100000, 0x200000, 0x300000
    resolved = case['agent']['status'] == 'resolved-source-object'
    memory = {pawn + 0x4f0: agent if resolved else 0, agent + 0x74: f32(case['agent'].get('entry', {}).get('f', 0)),
              pawn + 0x504: flexible, pawn + 0x510: f32(case['hitTimeMs'] / 1000), pawn + 0x524: 1.,
              pawn + 0x52c: case['style'], pawn + 0x534: len(durations), pawn + 0x6b8: f32(case['speedRate']),
              frame - 0x20: offset, frame - 0x24: selected}
    memory.update({pawn + 0x58c + i * 4: duration for i, duration in enumerate(durations)})
    # At 1ef65d, source scan has left [A, 0] on the x87 stack. Run the actual
    # Agent-present/absent lead selection as well as ordinary timing arithmetic.
    machine = Arithmetic(image, memory, [attack, 0.], {'esi': pawn, 'ebp': frame, 'ebx': 2})
    machine.run(0x1ef65d, 0x1ef959)
    return {'rate': machine.memory[pawn + 0x524], 'tween': machine.memory[pawn + 0x518],
            'shotTime': machine.memory[pawn + 0x514], 'shotPhase': selected,
            'shotOffset': offset, 'sourceAttackTime': attack,
            'dues': [machine.memory[pawn + 0x58c + i * 4] for i in range(len(durations))]}


def cases_for(mapping):
    rng = random.Random(1177)
    cases = []
    for animation, flexible in mapping.items():
        count = 3 if flexible == 1 or animation.startswith('MIX') else 2 if flexible == 0 else 1
        for style in (1, 2, 3, 5, 8, 10, 11, 12, 14):
            for agent in ({'status': 'source-none'},
                          {'status': 'resolved-source-object', 'entry': {'f': 0}},
                          {'status': 'resolved-source-object', 'entry': {'f': f32(.4)}}):
                phases = [{'clip': f'synthetic-{i}', 'frames': rng.randrange(2, 81),
                           'rate': f32(rng.uniform(15, 45)), 'notifies': []} for i in range(count)]
                for phase in phases:
                    # Unsorted source order deliberately differs from time order.
                    phase['notifies'] = [{'t': f32(.8), 'isAttackShot': True},
                                         {'t': f32(.7), 'isAttackShot': False},
                                         {'t': f32(rng.uniform(.1, .6)), 'isAttackShot': True}]
                cases.append({'animation': animation, 'style': style, 'hitTimeMs': 12000,
                              'speedRate': f32(rng.uniform(.4, 3)), 'agent': agent, 'phases': phases})
    for animation in ('E', 'K', 'S', 'MIX01'):
        flexible = mapping[animation]
        count = 3 if animation in ('E', 'MIX01') else 2 if animation == 'K' else 1
        for time in (850, 1000, 1500, 4000):
            for notes in ([], [{'t': 0, 'isAttackShot': True}],
                          [{'t': .8, 'isAttackShot': True}, {'t': .25, 'isAttackShot': True}]):
                phases = [{'clip': f'boundary-{i}', 'frames': 24 + i * 3,
                           'rate': 30, 'notifies': notes} for i in range(count)]
                cases.append({'animation': animation, 'style': 3, 'hitTimeMs': time,
                              'speedRate': 1, 'agent': {'status': 'source-none'}, 'phases': phases})
    return cases


def check():
    evidence = verify()
    image = Image(ROOT / 'assets/interlude/system/engine.dll', ENGINE_SHA, True)
    mapping = evidence['flexiblePhases']
    cases = cases_for(mapping)
    script = """
import fs from 'node:fs';
import { planNativeCastSchedule, nativeCastFlexIndex } from './editor/world/js/native-castschedule.js';
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(cases.map(c => ({...planNativeCastSchedule(c), flexIndex: nativeCastFlexIndex(c.animation)}))));
"""
    output = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(cases),
                            text=True, capture_output=True, cwd=ROOT, check=True)
    plans = json.loads(output.stdout)
    assert len(plans) == len(cases)
    for i, (case, actual) in enumerate(zip(cases, plans)):
        assert actual['status'] == 'ready', (i, case, actual)
        assert actual['flexIndex'] == mapping[case['animation']]
        expected = native(image, case, mapping[case['animation']])
        for key in ('rate', 'tween', 'shotTime', 'shotPhase', 'shotOffset', 'sourceAttackTime'):
            assert actual[key] == expected[key], (i, key, actual[key], expected[key], case)
        assert [p['due'] for p in actual['phases']] == expected['dues'], (i, actual, expected, case)
    return {'tool': 'Elbera Tools', 'status': 'verified', 'cases': len(cases),
            'nativeSelectors': len(mapping), 'engineSHA256': image.sha,
            'decodedRange': {'startRVA': '0x1ef65d', 'endRVAExclusive': '0x1ef959',
                             'SHA256': hashlib.sha256(image.data[0x1ef65d:0x1ef959]).hexdigest()},
            'limits': ['Float64 intermediates and native Float32 stores, not bit-identical x87 precision',
                       'synthetic source-sequence lookup; downstream Agent lead and arithmetic execute decoded instructions',
                       'no native animation playback, target association or effect spawning']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.parse_args()
    print(json.dumps(check(), indent=2))
