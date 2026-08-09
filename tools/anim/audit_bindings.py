#!/usr/bin/env python3
"""Audit every creature's animation binding the way the RUNTIME resolves it,
and cross-check it against what the retail .ukx actually contains.

Three layers, kept strictly apart so a measurement is never welded to an
inference:

  RETAIL   what the shipped MeshAnimation genuinely holds -- umodel exports
           the .psa, assemble.parse_psa names its sequences.  The oracle for
           "does this motion exist at all".
  NAMED    what the CLIENT ITSELF says each creature plays per slot:
           tools/anim/creature_anim_table.json, decoded from Engine.Pawn's
           `localized ...AnimName` arrays in the package .int keyed by the
           class npcgrp.dat gives the mesh.  The oracle for "which sequence
           fills this slot" -- retail's own answer, never a name convention.
  SHIPPED  what editor/characters/monsters/models/<id>.gltf actually carries,
           read from the glTF itself, PLUS the manifest's `clips` map, which
           records WHICH RETAIL SEQUENCE each shipped clip carries.
  RUNTIME  what entities.js:mapAnimations() resolves those clips to, replayed
           here verbatim, including its `first` fallback.

A slot is then classified, per creature:

  bound         SHIPPED has a clip named for the slot and RUNTIME binds it
  aliased       SHIPPED has no clip of that name, but the retail sequence
                retail names for the slot DID ship under another slot's clip
                and the RUNTIME fallback chain reaches it.  Correct, not a
                defect: the extractor emits one clip when two slots resolve
                to the SAME retail sequence (portrait_spirit's WalkAnimName
                *is* `run`), and mapAnimations' run->walk / special->attack
                chain lands on it.
  gap           RETAIL has no sequence for the slot -- an honest missing
                animation.  Documented, never synthesised.
  dropped       RETAIL HAS a sequence whose action token is exactly this
                slot's, and it shipped under NO name at all.  A pipeline bug.
  fallback      RUNTIME serves this slot from some OTHER clip (mapAnimations
                keyword miss -> `first`).  What the player actually sees.

Only the action token is used to claim `dropped` (Walk_Pole is a walk;
SpAtk01 is not a Wait).  Nothing is inferred from a sequence's contents.

MEASURED 2026-08-09, and the reason the classifier now reads `clips`: judging
a slot by comparing its NAME to the glTF clip names called six creatures
`dropped` whose sequence had shipped perfectly well under another slot's clip
(dropped run 2->6 was pure artefact).  The manifest recorded the real answer
the whole time and this file never opened it.

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
ANIM_TABLE = os.path.join(HERE, 'creature_anim_table.json')

# Set only by --selftest. Rewrites each creature's 'special' clip to the wait
# pose the old extractor picked, so the metric can be shown to MOVE.
SIM_WAIT_REGRESSION = False

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

# DELETED 2026-08-09: a copy of build_monsters.py:ANIM_CANDIDATES that called
# itself "verbatim" and had not been verbatim since commit 3dc180e.  It still
# carried the OLD 'special': ['SpWait01', 'Social01', ...] wait-pose list, had
# no 'social' slot, and its 'idle' list was missing the atkwait spellings --
# i.e. it described a pipeline that no longer existed.  It was also DEAD: the
# only reader, extractor_would_take(), was never called from anywhere.  A
# stale copy of someone else's table is a false claim waiting to be believed;
# the manifest's own `clips`/`clipSource` say what the extractor really chose,
# so the audit reads that instead of re-deriving it.

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


def main(capture=None):
    argv = sys.argv[1:]
    check = '--check' in argv and capture is None
    as_json = '--json' in argv and capture is None

    manifest = json.load(open(os.path.join(
        ROOT, 'editor/characters/monsters/manifest.json')))['models']
    bindings = json.load(open(os.path.join(HERE, 'bindings.json')))
    # The client's own per-creature answer for which sequence fills each slot.
    # Present since 3dc180e and never read here before 2026-08-09.
    anim_table = json.load(open(ANIM_TABLE))['meshes']
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
        # WHICH RETAIL SEQUENCE each shipped clip carries, per the extractor.
        # `clip_seq` is keyed by glTF clip name; `seq_shipped` is the set of
        # retail sequences that reached the browser under ANY clip name.
        clip_seq = {k: str(v) for k, v in (e.get('clips') or {}).items()}
        if SIM_WAIT_REGRESSION and 'special' in shipped:
            # --selftest only: replay the PRE-3dc180e extractor, whose
            # 'special' candidate list led with the wait poses.
            w = [s for s in seqs
                 if s.lower().startswith(('spwait', 'atkwait'))]
            if w:
                clip_seq['special'] = w[0]
        seq_shipped = {clip_seq[c].lower() for c in clips if c in clip_seq}

        slots = {}
        for slot in CORE:
            served = rt.get(slot)
            want = clip_seq.get(slot)          # sequence retail names here
            if slot in shipped:
                slots[slot] = {'state': 'bound', 'clip': slot}
            elif want and want.lower() in seq_shipped:
                # Deduped: the SAME retail sequence fills two slots, so the
                # extractor emitted it once. Correct only if the runtime
                # fallback chain actually lands on the clip carrying it.
                slots[slot] = {
                    'state': 'aliased',
                    'retail': want,
                    'served_by': served,
                    'serves_retail_clip':
                        bool(served) and clip_seq.get(served, '').lower()
                        == want.lower(),
                }
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

        # --- the 'special' (skill-cast) slot, judged against the CLIENT ---
        # Retail's MagicShotAnimName is what the creature plays when a skill
        # fires. Compare what the runtime actually serves against that name;
        # do NOT infer from whether a sequence called spatk* merely exists.
        magic = ((anim_table.get(mid) or {}).get('anims', {})
                 .get('MagicShotAnimName') or {}).get('0')
        sp_served = rt.get('special')
        sp_seq = clip_seq.get(sp_served) if sp_served else None
        special = {'retail_cast': magic, 'served_by': sp_served,
                   'served_retail': sp_seq}
        if not magic:
            special['state'] = 'no_retail_answer'
        elif sp_seq and sp_seq.lower() == magic.lower():
            special['state'] = 'correct'
        elif sp_seq and any(w in sp_seq.lower()
                            for w in ('wait', 'spwait', 'atkwait')) \
                and not any(w in magic.lower()
                            for w in ('wait', 'spwait', 'atkwait')):
            special['state'] = 'wait_not_cast'
        else:
            special['state'] = 'mismatch'

        report[mid] = {
            'anim': anim, 'psa_found': bool(psa),
            'shipped': clips, 'retail': seqs, 'special': special,
            'slots': slots,
            'retail_special_attack': [s for s in seqs
                                      if action_token(s).startswith('spatk')],
            'shipped_special': 'special' in shipped,
        }

    # ------------------------------------------------------------- buckets
    buckets = {'full': 0, 'partial': 0, 'none': 0}
    dropped_total = {s: 0 for s in CORE}
    gap_total = {s: 0 for s in CORE}
    aliased_total = {s: 0 for s in CORE}
    creatures_with_dropped = []
    # 'special' slot, judged against the client's own MagicShotAnimName.
    sp = {'correct': 0, 'wait_not_cast': 0, 'mismatch': 0,
          'no_retail_answer': 0}
    sp_mismatches = []
    for mid, r in report.items():
        states = [r['slots'][s]['state'] for s in CORE]
        served_ok = [s == 'bound' or (s == 'aliased'
                     and r['slots'][c].get('serves_retail_clip'))
                     for c, s in zip(CORE, states)]
        if not r['shipped']:
            buckets['none'] += 1
        elif all(served_ok):
            # every core slot plays the sequence retail names for it, whether
            # under its own clip or via a deduped alias the runtime reaches
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
            elif st == 'aliased':
                aliased_total[s] += 1
        st = r['special']['state']
        sp[st] = sp.get(st, 0) + 1
        if st in ('wait_not_cast', 'mismatch'):
            sp_mismatches.append((mid, r['special']))

    summary = {
        'creatures': len(report),
        'buckets': buckets,
        'no_anim_binding': sum(1 for r in report.values() if not r['anim']),
        'psa_missing': sum(1 for r in report.values()
                           if r['anim'] and not r['psa_found']),
        'dropped_by_slot': dropped_total,
        'gap_by_slot': gap_total,
        'aliased_by_slot': aliased_total,
        'creatures_with_dropped_clips': len(creatures_with_dropped),
        # RENAMED 2026-08-09. The old key was `special_is_wait_not_spatk` and
        # it counted `retail has a spatk AND a distinct 'special' clip
        # shipped` -- which is the condition for the slot being RIGHT. Of the
        # 196 it last reported, 194 served spatk01. It read backwards: a
        # metric whose number goes UP as the port gets MORE correct, under a
        # name that says the opposite. These four count the real thing, and
        # `special_serves_wait_not_cast` is the defect the old name described.
        'special_serves_retail_cast': sp['correct'],
        'special_serves_wait_not_cast': sp['wait_not_cast'],
        'special_serves_other_mismatch': sp['mismatch'],
        'special_no_retail_answer': sp['no_retail_answer'],
    }

    if capture is not None:
        capture['summary'] = summary
        # The DELETED metric's expression, verbatim, so --selftest can show
        # what it did (and did not) do under the same mutation.
        capture['old_special_is_wait_not_spatk'] = sum(
            1 for r in report.values()
            if r['retail_special_attack'] and r['shipped_special'])
        return 0

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
    print('  %-8s %8s %8s %8s' % ('slot', 'DROPPED', 'GAP', 'ALIASED'))
    for s in CORE:
        print('  %-8s %8d %8d %8d'
              % (s, dropped_total[s], gap_total[s], aliased_total[s]))
    print('  (ALIASED = retail names the SAME sequence for two slots, so it')
    print("   shipped once and the runtime's fallback chain reaches it.")
    print('   Correct by construction -- not a loss.)')
    print()
    print('creatures losing >=1 clip the retail asset HAS : %d'
          % summary['creatures_with_dropped_clips'])
    print()
    print("the 'special' (skill-cast) slot, against the client's own")
    print('MagicShotAnimName -- NOT against a name convention:')
    print('  serves exactly the retail cast clip           : %d'
          % summary['special_serves_retail_cast'])
    print('  serves a WAIT pose instead (the real defect)  : %d'
          % summary['special_serves_wait_not_cast'])
    print('  serves some other mismatched clip             : %d'
          % summary['special_serves_other_mismatch'])
    print('  creature has no decoded MagicShotAnimName     : %d'
          % summary['special_no_retail_answer'])
    for mid, s in sp_mismatches[:10]:
        print('    %-38s serves %-12s retail says %s'
              % (mid, s['served_retail'], s['retail_cast']))
    print()
    print('worst offenders (dropped clips retail actually ships):')
    for mid, drops in sorted(creatures_with_dropped,
                             key=lambda x: -len(x[1]))[:15]:
        r = report[mid]
        got = {s: r['slots'][s].get('retail') for s in drops}
        print('  %-38s %s' % (mid, got))
    return 0


def selftest():
    """Prove the metric reads the RIGHT WAY ROUND.

    Re-runs the audit against a manifest mutated to look like the old
    pipeline -- 'special' filled with a wait pose -- and asserts that the new
    metric MOVES while the deleted one does not. The deleted metric only ever
    asked "does a distinct 'special' clip exist?", never "what is in it", so
    it is numerically IDENTICAL before and after the regression it was named
    for. Measured 2026-08-09: old 196 -> 196, new 0 -> 78.
    """
    global SIM_WAIT_REGRESSION
    clean, dirty = {}, {}
    SIM_WAIT_REGRESSION = False
    main(capture=clean)
    SIM_WAIT_REGRESSION = True
    main(capture=dirty)
    SIM_WAIT_REGRESSION = False

    ok = True
    c = clean['summary']['special_serves_wait_not_cast']
    d = dirty['summary']['special_serves_wait_not_cast']
    print('special_serves_wait_not_cast : %d clean -> %d regressed' % (c, d))
    if c != 0:
        print('  FAIL: the current tree should serve NO wait poses'); ok = False
    if d <= c:
        print('  FAIL: the metric did not rise on a seeded regression')
        ok = False
    else:
        print('  ok: seeded regression detected (+%d)' % (d - c))

    o1, o2 = (clean['old_special_is_wait_not_spatk'],
              dirty['old_special_is_wait_not_spatk'])
    print('old special_is_wait_not_spatk: %d clean -> %d regressed' % (o1, o2))
    if o1 == o2:
        print('  ok: confirmed BLIND — the deleted metric could not see it')
    else:
        print('  NOTE: the old metric moved too; re-read the reasoning above')
    print('selftest: %s' % ('PASS' if ok else 'FAIL'))
    return 0 if ok else 1


if __name__ == '__main__':
    if '--selftest' in sys.argv[1:]:
        sys.exit(selftest())
    sys.exit(main())
