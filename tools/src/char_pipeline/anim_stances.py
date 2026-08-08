#!/usr/bin/env python3
"""Per-weapon animation stances: how retail names them, and the inventory.

FORMAT.  Every playable race/sex ships ONE MeshAnimation object
(`<Prefix>_anim` in `assets/interlude/animations/<Pkg>.ukx`) holding all
of that pawn's sequences.  Sequence names are

    <Action>_<Stance>_<Prefix>          e.g. Wait_1HS_MFighter
    <Action>_<Prefix>                   e.g. Death_MFighter   (unstanced)

with six stance tokens.  They are not inferred from the names: the retail
client's own pawn-viewer window enumerates them, and its numbering is
weapongrp's `handness` field (UTF-16 string literals in
`assets/interlude/system/NWindow.dll`, in the NCPawnViewerWnd/
NCPawnCreateWnd resource blocks):

    0(HAND) 1(1HS) 2(2HS) 3(DUAL) 4(POLE) 5(BOW) 7(DUALFIST)
    ... and the lowercase token list "1hs 2hs dual pole bow hand"
        next to the action groups "run walk atk wait social".

Note 6 is absent from the client's own list and DUALFIST(7) has no
animation suffix of its own — see STANCE_BY_HANDNESS in build_stances.py
for what that means for the mapping.

Case is NOT consistent in the source data: MDwarf ships `wait_1hs_MDwarf`
(lowercase) while every other package ships `Wait_1HS_MDwarf`-style names,
and MShaman mixes `_MShaman` with `_Mshaman`.  Everything here matches
case-insensitively and re-emits the canonical token.

Two name shapes look stanced but are not, and the action whitelist below
is what keeps them out: `Social_bow_MFighter` is the *greeting* bow emote,
not the Bow weapon stance, and `Fishing_wait_*`/`Fishing_end_*` share
tokens with nothing but each other.

Usage:
  anim_stances.py                 # print the inventory for all 14 pawns
  anim_stances.py --json out.json # write it as data
  anim_stances.py --check         # re-derive and fail on any regression
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
UMODEL = os.path.join(ROOT, 'tools/bin/umodel')
CLIENT = os.path.join(ROOT, 'assets/interlude')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import assemble

# canonical spelling of the six stance tokens, in the client's handness order
STANCES = ['Hand', '1HS', '2HS', 'Dual', 'Bow', 'Pole']
_STANCE_CI = {s.lower(): s for s in STANCES}

# the actions that appear with a stance suffix.  Whitelisted rather than
# "anything before the stance token" so Social_bow_* cannot be mistaken
# for a Bow-stance clip.  Verified exhaustive: across all 14 packages the
# only <A>_<stance>_<prefix> names whose A is outside this set are the
# Social_bow_* emotes.
ACTION_RE = re.compile(r'^(Wait|Walk|Run|AtkWait|ShieldAtk|Atk\d+|SpAtk\d+)$',
                       re.I)

# retail action token -> glTF clip prefix.  'Wait' becomes 'idle' so the
# stanced clips read like the frozen unstanced ones (idle/walk/run).
CLIP_ACTION = {'wait': 'idle', 'walk': 'walk', 'run': 'run',
               'atkwait': 'atkwait', 'shieldatk': 'shieldatk'}

# id, ukx package, mesh/anim prefix — mirrors build_characters.COMBOS
PAWNS = [
    ('human_fighter_m', 'Fighter', 'MFighter'),
    ('human_fighter_f', 'Fighter', 'FFighter'),
    ('human_mystic_m',  'Magic',   'MMagic'),
    ('human_mystic_f',  'Magic',   'FMagic'),
    ('elf_m',           'Elf',     'MElf'),
    ('elf_f',           'Elf',     'FElf'),
    ('darkelf_m',       'DarkElf', 'MDarkElf'),
    ('darkelf_f',       'DarkElf', 'FDarkElf'),
    ('orc_fighter_m',   'Orc',     'MOrc'),
    ('orc_fighter_f',   'Orc',     'FOrc'),
    ('orc_mystic_m',    'Shaman',  'MShaman'),
    ('orc_mystic_f',    'Shaman',  'FShaman'),
    ('dwarf_m',         'Dwarf',   'MDwarf'),
    ('dwarf_f',         'Dwarf',   'FDwarf'),
]


def split_sequence(name, prefix):
    """'Wait_1HS_MFighter' -> ('Wait', '1HS'); non-stanced -> None."""
    parts = name.split('_')
    if len(parts) != 3:
        return None
    action, stance, pref = parts
    if pref.lower() != prefix.lower():
        return None
    if stance.lower() not in _STANCE_CI:
        return None
    if not ACTION_RE.match(action):
        return None
    return action, _STANCE_CI[stance.lower()]


def clip_name(action, stance):
    """('Atk01', '1HS') -> 'atk01_1hs'; ('Wait', 'Bow') -> 'idle_bow'."""
    a = action.lower()
    return '%s_%s' % (CLIP_ACTION.get(a, a), stance.lower())


def stance_clips(psa_names, prefix):
    """-> {'idle_1hs': 'Wait_1HS_MFighter', ...} for one pawn.

    psa_names is the sequence-name list straight out of the .psa (the
    authoritative set — the .ukx name table also carries `Skirt_F*` names
    that are not sequences, and misses none that are).
    """
    out = {}
    for n in psa_names:
        sp = split_sequence(n, prefix)
        if sp:
            out[clip_name(*sp)] = n
    return out


def inventory(psa_names, prefix):
    """-> {'stances': {stance: {Action: seqname}}, 'unstanced': [...]}"""
    st, un = {}, []
    for n in sorted(psa_names):
        sp = split_sequence(n, prefix)
        if sp:
            st.setdefault(sp[1], {})[sp[0]] = n
        else:
            un.append(n)
    return {'stances': {s: st[s] for s in STANCES if s in st},
            'unstanced': un}


# ------------------------------------------------------------ psa sourcing

def export_psa(pkg, prefix, stage):
    """umodel-export <Prefix>_anim from <Pkg>.ukx; -> path to the .psa."""
    os.makedirs(stage, exist_ok=True)
    obj = '%s_anim' % prefix
    r = subprocess.run([UMODEL, '-game=l2', '-export', '-out=%s' % stage,
                        'animations/%s.ukx' % pkg, obj],
                       cwd=CLIENT, capture_output=True, text=True)
    for dirpath, _d, files in os.walk(stage):
        for f in files:
            if f.lower() == (obj + '.psa').lower():
                return os.path.join(dirpath, f)
    raise RuntimeError('umodel produced no %s.psa: %s' % (obj, r.stderr[-300:]))


def build_inventory(stage):
    inv = {}
    for cid, pkg, prefix in PAWNS:
        psa = export_psa(pkg, prefix, stage)
        _bones, anims = assemble.parse_psa(psa)
        inv[cid] = dict(inventory(list(anims), prefix), prefix=prefix,
                        package=pkg, total=len(anims))
    return inv


# ------------------------------------------------------------------- report

def _actions_union(inv):
    acts = {}
    for rec in inv.values():
        for st, d in rec['stances'].items():
            for a in d:
                acts.setdefault(a.lower(), a)
    def key(a):
        m = re.match(r'^(spatk|atk)(\d+)$', a)
        order = {'wait': 0, 'walk': 1, 'run': 2, 'atkwait': 3}
        if a in order:
            return (order[a], 0)
        if m:
            return (4 if m.group(1) == 'atk' else 6, int(m.group(2)))
        return (5, 0)
    return [acts[a] for a in sorted(acts, key=key)]


def report(inv):
    print('%-16s %-8s %s   total' % ('pawn', 'prefix',
                                     ' '.join('%5s' % s for s in STANCES)))
    for cid, rec in inv.items():
        print('%-16s %-8s %s   %d'
              % (cid, rec['prefix'],
                 ' '.join('%5d' % len(rec['stances'].get(s, {}))
                          for s in STANCES), rec['total']))
    print()
    acts = _actions_union(inv)
    for s in STANCES:
        print('-- %s' % s)
        have = {}
        for cid, rec in inv.items():
            have[cid] = set(a.lower() for a in rec['stances'].get(s, {}))
        for a in acts:
            who = [cid for cid in inv if a.lower() in have[cid]]
            if not who:
                continue
            if len(who) == len(inv):
                print('   %-10s all 14' % a)
            else:
                print('   %-10s %s' % (a, ' '.join(who)))


def main():
    stage = os.environ.get('L2_ANIM_STAGE', '/tmp/l2anim_stage')
    inv = build_inventory(stage)
    if '--json' in sys.argv:
        out = sys.argv[sys.argv.index('--json') + 1]
        with open(out, 'w') as f:
            json.dump(inv, f, indent=1, sort_keys=True)
        print('wrote', out)
        return 0
    if '--check' in sys.argv:
        errs = []
        for cid, rec in inv.items():
            for s in STANCES:
                if s not in rec['stances']:
                    errs.append('%s: no %s stance at all' % (cid, s))
                    continue
                have = set(a.lower() for a in rec['stances'][s])
                # the five clips the client needs to *hold* a stance
                for a in ('wait', 'walk', 'run', 'atk01', 'atkwait'):
                    if a not in have:
                        errs.append('%s/%s: missing %s' % (cid, s, a))
        for e in errs:
            print('FAIL: %s' % e)
        print('%s: 14 pawns, %d stance sets, %d core-clip gaps'
              % ('FAIL' if errs else 'PASS',
                 sum(len(r['stances']) for r in inv.values()), len(errs)))
        return 1 if errs else 0
    report(inv)
    return 0


if __name__ == '__main__':
    sys.exit(main())
