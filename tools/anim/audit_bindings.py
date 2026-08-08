#!/usr/bin/env python3
"""Audit every creature's animation binding the way the RUNTIME resolves it,
and cross-check it against what the retail .ukx actually contains.

Three layers, kept strictly apart so a measurement is never welded to an
inference:

  RETAIL   what the shipped MeshAnimation genuinely holds -- umodel exports
           the .psa, assemble.parse_psa names its sequences.  The oracle.
  SHIPPED  what editor/characters/monsters/models/<id>.gltf actually carries
           (read from the glTF itself, not from the manifest's summary).
  RUNTIME  what entities.js:mapAnimations() resolves those clips to, replayed
           here verbatim, including its `first` fallback.

A slot is then classified, per creature:

  bound         SHIPPED has the clip and RUNTIME binds it
  gap           RETAIL has no sequence for the slot -- an honest missing
                animation.  Documented, never synthesised.
  dropped       RETAIL HAS a sequence whose action token is exactly this
                slot's, but the extractor's alias table did not list that
                spelling, so it never shipped.  A pipeline bug, not a gap.
  fallback      RUNTIME serves this slot from some OTHER clip (mapAnimations
                keyword miss -> `first`).  What the player actually sees.

Only the action token is used to claim `dropped` (Walk_Pole is a walk;
SpAtk01 is not a Wait).  Nothing is inferred from a sequence's contents.

Usage:
  audit_bindings.py            full report
  audit_bindings.py --check    assert the recorded buckets, exit 1 on drift
  audit_bindings.py --json     machine-readable dump
"""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools/src/char_pipeline'))
import assemble  # noqa: E402

PSA_DIR = os.environ.get('L2_PSA_DIR',
                         os.path.join(HERE, 'psa'))
BASELINE = os.path.join(HERE, 'baseline.json')

# entities.js:mapAnimations() -- the keyword lists, verbatim.
RUNTIME_KEYWORDS = {
    'idle':    ['idle', 'wait', 'stand'],
    'walk':    ['walk'],
    'run':     ['run'],
    'attack':  ['attack', 'atk', 'hit'],
    'special': ['special'],
    'die':     ['die', 'death', 'dead'],
}
# the ordered secondary fallbacks mapAnimations applies before `first`
RUNTIME_CHAIN = {'run': ['walk'], 'special': ['attack']}

CORE = ['idle', 'walk', 'run', 'attack', 'die']

# tools/src/char_pipeline/build_monsters.py:ANIM_CANDIDATES, verbatim
EXTRACTOR_CANDIDATES = {
    'idle':    ['Wait', 'Wait_1HS', 'Wait_Hand', 'SpWait01'],
    'walk':    ['Walk', 'Walk_1HS', 'Walk_Hand'],
    'run':     ['run', 'Run_1HS', 'Run_Hand', 'Run'],
    'attack':  ['atk01', 'Atk01_1HS', 'Atk01_Hand', 'Atk01_Bow',
                'Atk01_Pole', 'Attack01'],
    'die':     ['death', 'Death_Hand', 'die', 'Death'],
    'corpse':  ['deathwait', 'deathwait_Hand'],
    'special': ['SpWait01', 'Social01', 'atkwait', 'AtkWait_1HS'],
}

# Retail's sequence grammar is <Action>[_<Stance>][_<Prefix>].  A slot owns an
# action token; any stance/prefix suffix is still that action.  Deliberately
# NOT a fuzzy match: `SpAtk01` is its own action and never fills `attack`,
# `SpWait01` is its own action and never fills `idle`.
SLOT_ACTIONS = {
    'idle':    ['wait'],
    'walk':    ['walk'],
    'run':     ['run'],
    'attack':  ['atk01', 'atk02', 'atk03', 'attack01'],
    'die':     ['death', 'die'],
    'corpse':  ['deathwait'],
}


def action_token(seq):
    """Leading action token of a retail sequence name, lowercased."""
    return seq.lower().split('_')[0]


def slots_present_in_retail(seqs):
    """-> {slot: [retail sequence names]} by action token only."""
    out = {}
    for s in seqs:
        low = s.lower()
        tok = action_token(s)
        for slot, actions in SLOT_ACTIONS.items():
            # deathwait must win over death: test the longer token first
            if low.startswith('deathwait'):
                if slot == 'corpse':
                    out.setdefault(slot, []).append(s)
                continue
            if tok in actions:
                out.setdefault(slot, []).append(s)
    return out


def extractor_would_take(seqs):
    """Replay build_monsters.py's alias table over a retail sequence list."""
    ci = {s.lower(): s for s in seqs}
    sel = {}
    for slot, cands in EXTRACTOR_CANDIDATES.items():
        for c in cands:
            if c.lower() in ci:
                sel[slot] = ci[c.lower()]
                break
    return sel


def runtime_map(clips):
    """entities.js:mapAnimations() replayed. -> {state: clip|None}."""
    first = clips[0] if clips else None

    def find(words):
        for c in clips:
            if any(w in c.lower() for w in words):
                return c
        return None

    out = {}
    for state, words in RUNTIME_KEYWORDS.items():
        hit = find(words)
        if hit is None:
            for nxt in RUNTIME_CHAIN.get(state, []):
                hit = find(RUNTIME_KEYWORDS[nxt])
                if hit:
                    break
        out[state] = hit or first
    return out


def load_psa_index():
    idx = {}
    for f in glob.glob(os.path.join(PSA_DIR, '**', '*.psa'), recursive=True):
        idx[os.path.basename(f)[:-4].lower()] = f
    return idx


def main():
    argv = sys.argv[1:]
    check = '--check' in argv
    as_json = '--json' in argv

    manifest = json.load(open(os.path.join(
        ROOT, 'editor/characters/monsters/manifest.json')))['models']
    bindings = json.load(open(os.path.join(HERE, 'bindings.json')))
    psa_idx = load_psa_index()
    if not psa_idx:
        print('no .psa exports under %s -- run tools/anim/export_psa.sh first'
              % PSA_DIR, file=sys.stderr)
        return 2

    models_dir = os.path.join(ROOT, 'editor/characters/monsters/models')
    report = {}
    for e in manifest:
        mid = e['id']
        gltf = json.load(open(os.path.join(
            models_dir, os.path.basename(e['gltf']))))
        clips = [a.get('name') for a in gltf.get('animations', [])]

        b = bindings.get(mid) or {}
        anim = b.get('anim')
        psa = psa_idx.get((anim or '').lower())
        seqs = []
        if psa:
            try:
                _bones, seqs = assemble.parse_psa(psa)
            except Exception:
                seqs = []
        seqs = sorted(seqs)

        retail_slots = slots_present_in_retail(seqs)
        rt = runtime_map(clips)
        shipped = set(clips)

        slots = {}
        for slot in CORE:
            served = rt.get(slot)
            if slot in shipped:
                slots[slot] = {'state': 'bound', 'clip': slot}
            elif retail_slots.get(slot):
                slots[slot] = {'state': 'dropped',
                               'retail': retail_slots[slot],
                               'served_by': served}
            else:
                slots[slot] = {'state': 'gap', 'served_by': served}
            # a shipped clip can still be mis-served if the keyword misses
            if slot in shipped and served != slot:
                slots[slot] = {'state': 'fallback', 'clip': slot,
                               'served_by': served}

        report[mid] = {
            'anim': anim, 'psa_found': bool(psa),
            'shipped': clips, 'retail': seqs,
            'slots': slots,
            'retail_special_attack': [s for s in seqs
                                      if action_token(s).startswith('spatk')],
            'shipped_special': 'special' in shipped,
        }

    # ------------------------------------------------------------- buckets
    buckets = {'full': 0, 'partial': 0, 'none': 0}
    dropped_total = {s: 0 for s in CORE}
    gap_total = {s: 0 for s in CORE}
    creatures_with_dropped = []
    spatk_dropped = 0
    for mid, r in report.items():
        states = [r['slots'][s]['state'] for s in CORE]
        if not r['shipped']:
            buckets['none'] += 1
        elif all(s == 'bound' for s in states):
            buckets['full'] += 1
        else:
            buckets['partial'] += 1
        drops = [s for s in CORE if r['slots'][s]['state'] == 'dropped']
        if drops:
            creatures_with_dropped.append((mid, drops))
        for s in CORE:
            st = r['slots'][s]['state']
            if st == 'dropped':
                dropped_total[s] += 1
            elif st == 'gap':
                gap_total[s] += 1
        if r['retail_special_attack'] and r['shipped_special']:
            spatk_dropped += 1

    summary = {
        'creatures': len(report),
        'buckets': buckets,
        'no_anim_binding': sum(1 for r in report.values() if not r['anim']),
        'psa_missing': sum(1 for r in report.values()
                           if r['anim'] and not r['psa_found']),
        'dropped_by_slot': dropped_total,
        'gap_by_slot': gap_total,
        'creatures_with_dropped_clips': len(creatures_with_dropped),
        'special_is_wait_not_spatk': spatk_dropped,
    }

    if as_json:
        json.dump({'summary': summary, 'creatures': report},
                  sys.stdout, indent=1)
        return 0

    if check:
        if not os.path.exists(BASELINE):
            json.dump(summary, open(BASELINE, 'w'), indent=1, sort_keys=True)
            print('baseline written:', BASELINE)
            return 0
        base = json.load(open(BASELINE))
        if base != summary:
            print('ANIMATION BINDING REGRESSION', file=sys.stderr)
            for k in sorted(set(base) | set(summary)):
                if base.get(k) != summary.get(k):
                    print('  %s: %r -> %r' % (k, base.get(k), summary.get(k)),
                          file=sys.stderr)
            return 1
        print('ok: %d creatures, buckets %s' % (summary['creatures'], buckets))
        return 0

    print('=' * 72)
    print('CREATURE ANIMATION BINDING AUDIT')
    print('=' * 72)
    print('creatures in manifest      : %d' % summary['creatures'])
    print('  fully bound (idle/walk/run/attack/die) : %d' % buckets['full'])
    print('  partially bound                        : %d' % buckets['partial'])
    print('  no animation at all (static mesh)      : %d' % buckets['none'])
    print()
    print('no Animation reference in the mesh       : %d'
          % summary['no_anim_binding'])
    print('bound anim whose .psa did not export     : %d'
          % summary['psa_missing'])
    print()
    print('per-slot, across all creatures:')
    print('  %-8s %8s %8s' % ('slot', 'DROPPED', 'GAP'))
    for s in CORE:
        print('  %-8s %8d %8d' % (s, dropped_total[s], gap_total[s]))
    print()
    print('creatures losing >=1 clip the retail asset HAS : %d'
          % summary['creatures_with_dropped_clips'])
    print("creatures whose 'special' is a WAIT pose while  ")
    print('  the retail set carries a real SpAtk           : %d'
          % spatk_dropped)
    print()
    print('worst offenders (dropped clips retail actually ships):')
    for mid, drops in sorted(creatures_with_dropped,
                             key=lambda x: -len(x[1]))[:15]:
        r = report[mid]
        got = {s: r['slots'][s].get('retail') for s in drops}
        print('  %-38s %s' % (mid, got))
    return 0


if __name__ == '__main__':
    sys.exit(main())
