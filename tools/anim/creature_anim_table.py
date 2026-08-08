#!/usr/bin/env python3
"""Decode the RETAIL per-creature animation-name table out of the client.

Why this exists
---------------
build_monsters.py used to choose a creature's clips from a hand-written
candidate list (`ANIM_CANDIDATES`): "for 'attack' try atk01, then Atk01_1HS,
then ...".  That list is a name convention, i.e. a guess, and it is wrong
often enough to matter -- most visibly it mapped the 'special' (skill-cast)
slot to four WAIT poses, so 235 creatures answered a skill with a standing
pose.

The client does not guess.  Engine.Pawn declares

    var localized name WalkAnimName[4];      // LineageCreature/Pawn
    var localized name RunAnimName[4];
    var localized name WaitAnimName[4];
    var localized name AtkWaitAnimName[4];
    var localized name Atk01AnimName[4];  .. Atk03AnimName
    var localized name SpAtk01AnimName[4] .. SpAtk06AnimName
    var localized name DeathAnimName[4];
    var localized name DeathWaitAnimName[4];
    var localized name CastShortAnimName[4]; CastMidAnimName, CastLongAnimName,
                       CastEndAnimName
    var localized name MagicShotAnimName[4]; MagicThrowAnimName,
                       MagicNoTargetAnimName
    var localized name NpcSocialAnimName[5];
    var localized name PcSocialAnimName[20];

(recovered verbatim from Engine.u's TextBuffer -- see tools/uscript for the
same decrypt-then-read-TextBuffer technique).  `localized` means the VALUES
live in the package's .int file, keyed by class name.  So the client's own
answer to "what does <creature> play when it casts?" is sitting in
system/LineageMonster.int under that creature's class section.

The chain, end to end, with no name convention anywhere:

    npcgrp.dat   npcId -> class_name ("LineageMonster.gremlin")
                       -> mesh_name  ("LineageMonsters.gremlin_m00")
    <Package>.int  [gremlin] -> WaitAnimName[0]=wait, Atk01AnimName[0]=atk01,
                                MagicShotAnimName[0]=spatk01, ...
    the mesh's own serialized Animation reference -> the .psa that holds them

Class defaults INHERIT, and so does this table: a subclass section that omits
WaitAnimName gets its parent's.  The parent is read from each class's
recovered source line `class <X> extends <Y>`, so the chain is data too.

Cross-check (this is the proof the join is right, not a story about it):
every clip name the table produces is looked up in the .psa the creature's
mesh is ACTUALLY rigged against (tools/anim/bindings.json, itself umodel's
reading of the mesh's Animation reference).  13082 of 13103 references
resolve.  The 21 that do not are retail data errors -- batur_orc_shaman_a
points at batur_orc_shaman_anim, which ships no SpAtk01; Frintessa's table
names walk/run that Frintessa_anim does not contain -- and are reported, not
patched.  A table entry naming a clip that is not in the bound .psa is
dropped by the consumer.

Outputs (committed, regenerable):
  tools/anim/creature_anim_table.json  {mesh_id: {AnimVar: {index: clip}}}
  tools/anim/social_actions.json       {prefix: {actionType: clip}} for PCs

Usage:
  python3 tools/anim/creature_anim_table.py            # decode + write
  python3 tools/anim/creature_anim_table.py --check    # verify, write nothing
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                     '..', '..'))
SYSTEM = os.path.join(ROOT, 'assets/interlude/system')
L2ENCDEC = os.path.join(ROOT, 'tools/bin/l2encdec')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_TABLE = os.path.join(HERE, 'creature_anim_table.json')
OUT_SOCIAL = os.path.join(HERE, 'social_actions.json')
PROTOCOL = '111'

# The packages that declare creature classes.  LineageNpcEv and LineageDeco
# ship no .int: their classes carry no localized override and inherit whatever
# their parent declares (usually nothing), which is why a handful of props end
# up with no record at all.  That is the client's own state, not a gap here.
CLASS_PACKAGES = ['LineageMonster', 'LineageMonster2', 'LineageMonster3',
                  'LineageNpc', 'LineageNpc2', 'LineageNpcEv', 'LineageDeco',
                  'LineageCreature', 'LineageWarrior', 'Engine']

ANIM_VARS = re.compile(r'^(?:[A-Za-z0-9_]*Anim(?:Name|Rate))$')
_KEY = re.compile(r'^([A-Za-z0-9_]+)\[(\d+)\]\s*=\s*(.*?)\s*$')
_SEC = re.compile(r'^\[([^\]]+)\]\s*$')
_CLASS_DECL = re.compile(rb'class\s+(\w+)\s+(?:extends|expands)\s+([\w.]+)')

# actionname.json's `type` is the SocialAction id the server broadcasts; the
# client indexes PcSocialAnimName with exactly that id (types 2..13 are the
# twelve emotes; type 0 'petspecial' is a pet command, not a PC emote).
SOCIAL_TYPES = list(range(2, 14))


def _find_ci(directory, name):
    want = name.lower()
    for f in os.listdir(directory):
        if f.lower() == want:
            return os.path.join(directory, f)
    return None


def decrypt(src, dest):
    subprocess.run([L2ENCDEC, '-c', 'decode', '-p', PROTOCOL, '-o', dest, src],
                   check=True, capture_output=True)


def parse_int(path):
    """-> {section_lower: {VarName: {index: value}}} for an unencrypted .int."""
    out, cur = {}, None
    with open(path, encoding='latin-1') as fh:
        for line in fh:
            s = line.strip()
            m = _SEC.match(s)
            if m:
                cur = out.setdefault(m.group(1).strip().lower(), {})
                continue
            if cur is None:
                continue
            m = _KEY.match(s)
            if m and ANIM_VARS.match(m.group(1)):
                cur.setdefault(m.group(1), {})[m.group(2)] = m.group(3)
    return out


def class_parents(dec_path, label):
    """-> {class_lower: parent_lower} from the package's recovered sources."""
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    from l2lib.ue2package import Package
    pkg = Package(open(dec_path, 'rb').read(), label)
    out = {}
    for exp in pkg.exports:
        if pkg.class_name_of(exp) != 'TextBuffer':
            continue
        r = pkg.body_reader(exp)
        m = _CLASS_DECL.search(r.data[r.pos:])
        if m:
            out[m.group(1).decode('ascii').lower()] = \
                m.group(2).decode('ascii').split('.')[-1].lower()
    return out


def load_client(tmp):
    """-> (tables, parents).  tables: {pkg_lower: {class_lower: {var: {i: v}}}}"""
    tables, parents = {}, {}
    for pkg in CLASS_PACKAGES:
        u = _find_ci(SYSTEM, pkg + '.u')
        if u:
            dec = os.path.join(tmp, pkg + '.u.dec')
            decrypt(u, dec)
            parents.update(class_parents(dec, pkg + '.u'))
        i = _find_ci(SYSTEM, pkg + '.int')
        if i:
            dec = os.path.join(tmp, pkg + '.int.dec')
            decrypt(i, dec)
            tables[pkg.lower()] = parse_int(dec)
    return tables, parents


def resolve_class(tables, parents, pkg, cls):
    """Merge a class's localized anim table with its ancestors' (child wins)."""
    t = tables.get(pkg.lower(), {})
    chain, seen, c = [], set(), cls.lower()
    while c and c not in seen and len(chain) < 32:
        seen.add(c)
        chain.append(c)
        c = parents.get(c)
    merged = {}
    for c in reversed(chain):
        for var, idx in (t.get(c) or {}).items():
            merged.setdefault(var, {}).update(idx)
    return merged


def mesh_to_class():
    """-> {mesh_object_lower: 'Package.class'} from npcgrp.dat."""
    grp = json.load(open(os.path.join(ROOT, 'assets/gamedata/npcgrp.json')))
    out = {}
    for r in grp:
        mn, cn = r.get('mesh_name') or '', r.get('class_name') or ''
        if '.' in mn and '.' in cn:
            out.setdefault(mn.split('.', 1)[1].lower(), cn)
    return out


def build():
    with tempfile.TemporaryDirectory() as tmp:
        tables, parents = load_client(tmp)
    m2c = mesh_to_class()
    table = {}
    for mesh, cn in sorted(m2c.items()):
        pkg, cls = cn.split('.', 1)
        rec = resolve_class(tables, parents, pkg, cls)
        if rec:
            table[mesh] = {'class': cn, 'anims': rec}

    social = {}
    wcls = tables.get('lineagewarrior', {})
    for cls, rec in sorted(wcls.items()):
        pcs = rec.get('PcSocialAnimName') or {}
        if not pcs:
            continue
        got = {}
        for t in SOCIAL_TYPES:
            v = pcs.get(str(t))
            if v:
                got[str(t)] = v
        if got:
            social[cls] = got
    return table, social


# ------------------------------------------------------------------ check

def cross_check(table):
    """Every clip the table names must exist in the .psa the creature's mesh
    is rigged against.  -> (ok, missing, [(mesh, var, clip)])"""
    import struct
    bindings_path = os.path.join(HERE, 'bindings.json')
    psa_root = os.path.join(HERE, 'psa')
    if not os.path.isfile(bindings_path) or not os.path.isdir(psa_root):
        return None, None, []
    bindings = json.load(open(bindings_path))

    index = {}
    for pkg in os.listdir(psa_root):
        d = os.path.join(psa_root, pkg, 'MeshAnimation')
        if os.path.isdir(d):
            for f in os.listdir(d):
                if f.endswith('.psa'):
                    index[(pkg.lower(), f[:-4].lower())] = os.path.join(d, f)

    def clips(path):
        data = open(path, 'rb').read()
        off, chunks = 0, {}
        while off + 32 <= len(data):
            cid = data[off:off + 20].split(b'\0')[0].decode('latin1')
            _f, size, count = struct.unpack('<3i', data[off + 20:off + 32])
            chunks[cid] = (size, count, off + 32)
            off += 32 + size * count
        if 'ANIMINFO' not in chunks:
            return set()
        size, count, o = chunks['ANIMINFO']
        return {data[o + i * size:o + i * size + 64].split(b'\0')[0]
                .decode('latin1').lower() for i in range(count)}

    ok = missing = 0
    bad = []
    cache = {}
    for mesh_id, b in bindings.items():
        anim, ukx = b.get('anim'), b.get('ukx')
        rec = table.get(mesh_id.lower())
        if not (anim and ukx and rec):
            continue
        key = (os.path.splitext(os.path.basename(ukx))[0].lower(), anim.lower())
        p = index.get(key)
        if not p:
            continue
        if p not in cache:
            cache[p] = clips(p)
        have = cache[p]
        for var, idx in rec['anims'].items():
            if not var.endswith('AnimName'):
                continue
            for _i, v in idx.items():
                if not v:
                    continue
                if v.lower() in have:
                    ok += 1
                else:
                    missing += 1
                    bad.append((mesh_id, var, v))
    return ok, missing, bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()

    if not os.path.exists(L2ENCDEC):
        sys.exit('missing %s — run tools/build-tools.sh' % L2ENCDEC)
    table, social = build()

    print('creature classes with a decoded animation table: %d meshes'
          % len(table))
    print('player social tables: %d prefixes x %d emote types'
          % (len(social), len(SOCIAL_TYPES)))
    problems = []
    if len(social) < 14:
        problems.append('expected 14 player prefixes, got %d' % len(social))
    for pfx, got in sorted(social.items()):
        if len(got) != 12:
            problems.append('%s has %d of 12 emote clips' % (pfx, len(got)))

    ok, missing, bad = cross_check(table)
    if ok is None:
        print('psa cross-check SKIPPED (no tools/anim/psa — run '
              'tools/anim/export_psa.sh)')
    else:
        print('psa cross-check: %d clip references resolve, %d missing'
              % (ok, missing))
        for row in bad:
            print('   MISSING %-38s %-24s %s' % row)
        # Retail itself ships 21 dangling references (see docstring); more
        # than that means the join broke, not that the client changed.
        if missing > 21:
            problems.append('%d dangling clip references (retail ships 21)'
                            % missing)
        if ok < 13000:
            problems.append('only %d references resolve (expected >= 13000)'
                            % ok)

    if args.check:
        if os.path.isfile(OUT_TABLE):
            old = json.load(open(OUT_TABLE))
            if len(old.get('meshes', {})) > len(table):
                problems.append('coverage regressed: %d -> %d meshes'
                                % (len(old['meshes']), len(table)))
        for p in problems:
            print('  ' + p)
        print('CHECK', 'FAIL' if problems else 'PASS')
        return 1 if problems else 0

    if problems:
        sys.exit('refusing to write: ' + '; '.join(problems))
    with open(OUT_TABLE, 'w') as f:
        json.dump({'meshes': table}, f, indent=1, sort_keys=True)
    with open(OUT_SOCIAL, 'w') as f:
        json.dump({'types': SOCIAL_TYPES, 'prefixes': social}, f, indent=1,
                  sort_keys=True)
    print('wrote %s and %s' % (os.path.relpath(OUT_TABLE, ROOT),
                               os.path.relpath(OUT_SOCIAL, ROOT)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
