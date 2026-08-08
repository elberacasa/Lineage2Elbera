#!/usr/bin/env python3
"""Monster/NPC model coverage: what fraction of SPAWNED INSTANCES render.

The client (editor/world/js/entities.js::upgradeToMonster) resolves a live
NPC in three hops:

    npcId  --npcgrp.dat-->  "LineageMonsters.gremlin_m00"
           --rsplit('.')-->  "gremlin_m00"
           --manifest.json-->  models/gremlin_m00.gltf

Any hop that misses leaves the entity as a coloured capsule (npcColor()).
This report walks the same three hops over the aCis spawn tables and
reports the share of instances that make it all the way through.

WHY INSTANCES, NOT DISTINCT IDS
-------------------------------
Distinct-id coverage flatters the result: 3,213 mimic1_m00 instances and
one unique raid boss both count as "1 unbuilt id", yet the player sees the
mimic 3,213 times.  Everything here is weighted by instance count.

FORMAT / SOURCES (all ground truth, nothing guessed)
----------------------------------------------------
1. server/aCis_datapack/data/xml/spawnlist/<tile>.xml -- 102 files, one
   per world tile, 30,137 <npc> elements.  Instance count of an <npc> is
   its `total` attribute (present on all 30,137; see docs/spawn-tables.md
   sec.2).  Sum over the corpus = 54,901 instances.

   `maximumNpcs` on the parent <npcmaker> caps the LIVE population and its
   interaction with per-<npc> `total` is unverified upstream
   (docs/spawn-tables.md sec.9).  772 of 10,072 makers (7.7%) declare more
   `total` than `maximumNpcs`.  Rather than guess a rule, --sensitivity
   recomputes everything under a proportional cap so the reader can see
   how much the answer moves; the headline number uses raw `total`, which
   is the value literally in the file.

   <private> minions (3,159 of them) are NOT counted: they are spawned by
   their parent at runtime with a `weight` whose semantics are unconfirmed.
   --privates adds them at face value as a second sensitivity check.

2. Tile assignment.  The spawn file NAME is the tile: docs/tile-map.md
   sec."How tiles were named" verified that only 8 of ~52,000 territory
   nodes fall outside their file's world rect (0.015%).  The filename is
   also defined for the 69% of spawns that carry no `pos` at all, so it is
   the only assignment that covers every instance.  --verify-tiles
   re-runs that cross-check here, from assets/world/tile-map.json, over
   the fixed spawns that DO carry pos.

3. assets/gamedata/npcgrp.json -- 6,519 records, npcId -> mesh_name.
4. editor/characters/monsters/manifest.json -- what is built.  Matching
   mirrors the client exactly: exact id first, then case-insensitive.

Usage:
  coverage.py                       overall + per-tile + ranked worklist
  coverage.py --tiles 17_25,16_25   restrict to tiles
  coverage.py --region "Talking Island"    restrict by tile-map.json name
  coverage.py --starter              the six newbie regions
  coverage.py --top 40               worklist length (default 25)
  coverage.py --check                non-zero exit if coverage regressed
  coverage.py --update-baseline      record current numbers as the floor
  coverage.py --json PATH            machine-readable dump
"""
import argparse
import collections
import json
import os
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
SPAWN_DIR = os.path.join(ROOT, 'server/aCis_datapack/data/xml/spawnlist')
NPCGRP = os.path.join(ROOT, 'assets/gamedata/npcgrp.json')
MANIFEST = os.path.join(ROOT, 'editor/characters/monsters/manifest.json')
TILE_MAP = os.path.join(ROOT, 'assets/world/tile-map.json')
BASELINE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        'coverage_baseline.json')

# The regions a new character actually walks through.  Named, not
# hand-picked coordinates: tiles are selected by tile-map.json `name`, so
# the set follows the map data if the map data is ever corrected.
STARTER_REGIONS = ('Talking Island', 'Gludin', 'Orc', 'Dark Elven',
                   'Elven', 'Dwarven')

TILE_SIZE = 32768          # docs/tile-map.md: world rect per tile
TILE_X0, TILE_Y0 = 20, 18  # tx = floor(x/32768)+20, ty = floor(y/32768)+18


# ------------------------------------------------------------- the data

def load_spawns():
    """-> [(tile, npc_id, total, pos_or_None)] and [(tile, private_id)].

    One row per <npc> element, keeping the maker so the cap sensitivity
    check can group by it.
    """
    rows, privates = [], []
    for fn in sorted(os.listdir(SPAWN_DIR)):
        if not fn.endswith('.xml'):
            continue
        tile = fn[:-4]
        root = ET.parse(os.path.join(SPAWN_DIR, fn)).getroot()
        for mi, maker in enumerate(root.iter('npcmaker')):
            cap = maker.get('maximumNpcs')
            for npc in maker.findall('npc'):
                nid = npc.get('id')
                if not nid:
                    continue
                rows.append({
                    'tile': tile,
                    'maker': (tile, mi),
                    'cap': int(cap) if cap and cap.isdigit() else None,
                    'npc_id': int(nid),
                    'total': int(npc.get('total') or 1),
                    'pos': npc.get('pos'),
                })
                for p in npc.iter('private'):
                    if p.get('id'):
                        privates.append({'tile': tile,
                                         'npc_id': int(p.get('id')),
                                         'total': 1, 'maker': (tile, mi),
                                         'cap': None, 'pos': None})
    return rows, privates


def load_meshes():
    """-> {npc_id: (full_mesh_ref, mesh_object_name)}; '' when npcgrp has
    a record but no mesh."""
    out = {}
    with open(NPCGRP, 'r', encoding='utf-8') as fh:
        for r in json.load(fh):
            mn = r.get('mesh_name') or ''
            out[r['npc_id']] = (mn, mn.rsplit('.', 1)[-1] if '.' in mn else '')
    return out


def load_built():
    with open(MANIFEST, 'r', encoding='utf-8') as fh:
        ids = [m['id'] for m in json.load(fh).get('models', [])]
    return set(ids), {i.lower() for i in ids}


def load_tile_names():
    try:
        with open(TILE_MAP, 'r', encoding='utf-8') as fh:
            return {k: v.get('name', '?') for k, v in json.load(fh).items()}
    except (OSError, ValueError):
        return {}


# ------------------------------------------------------------ the count

def resolve(npc_id, meshes, built, built_lc):
    """-> ('built'|'unbuilt'|'no_mesh'|'no_npcgrp', mesh_ref).

    Same two-step match the client does: exact id, then lowercase.
    """
    rec = meshes.get(npc_id)
    if rec is None:
        return 'no_npcgrp', ''
    ref, obj = rec
    if not obj:
        return 'no_mesh', ref
    if obj in built or obj.lower() in built_lc:
        return 'built', ref
    return 'unbuilt', ref


def tally(rows, meshes, built, built_lc, weight=lambda r: r['total']):
    """-> (per_tile {tile: Counter(state)}, worklist Counter(mesh_ref),
            per_tile_unbuilt {tile: Counter(mesh_ref)})."""
    per_tile = collections.defaultdict(collections.Counter)
    worklist = collections.Counter()
    per_tile_unbuilt = collections.defaultdict(collections.Counter)
    for r in rows:
        w = weight(r)
        state, ref = resolve(r['npc_id'], meshes, built, built_lc)
        per_tile[r['tile']][state] += w
        per_tile[r['tile']]['total'] += w
        if state == 'unbuilt':
            worklist[ref] += w
            per_tile_unbuilt[r['tile']][ref] += w
    return per_tile, worklist, per_tile_unbuilt


def capped_weight(rows):
    """Sensitivity weight: scale each maker's <npc> totals down so the
    maker never exceeds its own maximumNpcs.  NOT ground truth -- the
    server's real rule is unverified (docs/spawn-tables.md sec.9)."""
    by_maker = collections.defaultdict(int)
    for r in rows:
        by_maker[r['maker']] += r['total']
    def w(r):
        cap, s = r['cap'], by_maker[r['maker']]
        if cap is None or s <= cap or s == 0:
            return r['total']
        return r['total'] * cap / float(s)
    return w


# ------------------------------------------------------------- checking

def verify_tiles(rows):
    """Cross-check filename-tile against pos-derived tile for the fixed
    spawns (the ~31% that carry pos).  -> (checked, mismatches)."""
    checked = mismatch = 0
    for r in rows:
        if not r['pos']:
            continue
        parts = r['pos'].split(';')
        if len(parts) < 2:
            continue
        try:
            x, y = int(float(parts[0])), int(float(parts[1]))
        except ValueError:
            continue
        checked += 1
        tx = x // TILE_SIZE + TILE_X0
        ty = y // TILE_SIZE + TILE_Y0
        if '%d_%d' % (tx, ty) != r['tile']:
            mismatch += 1
    return checked, mismatch


# -------------------------------------------------------------- reports

def pct(n, d):
    return 100.0 * n / d if d else 0.0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--tiles', help='comma-separated tile list')
    ap.add_argument('--region', help='tile-map.json region name substring')
    ap.add_argument('--starter', action='store_true',
                    help='the six newbie regions (%s)'
                         % ', '.join(STARTER_REGIONS))
    ap.add_argument('--top', type=int, default=25)
    ap.add_argument('--per-tile', type=int, default=15,
                    help='how many tiles to print (worst-covered first)')
    ap.add_argument('--sensitivity', action='store_true',
                    help='also report the maximumNpcs-capped variant')
    ap.add_argument('--privates', action='store_true',
                    help='also count <private> minions')
    ap.add_argument('--verify-tiles', action='store_true')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--update-baseline', action='store_true')
    ap.add_argument('--json', help='write machine-readable results here')
    args = ap.parse_args()

    rows, privates = load_spawns()
    meshes = load_meshes()
    built, built_lc = load_built()
    names = load_tile_names()

    if args.privates:
        rows = rows + privates

    wanted = None
    if args.tiles:
        wanted = {t.strip() for t in args.tiles.split(',') if t.strip()}
    elif args.starter:
        wanted = {t for t, n in names.items()
                  if any(n.startswith(r) for r in STARTER_REGIONS)}
    elif args.region:
        wanted = {t for t, n in names.items() if args.region.lower() in n.lower()}
    scope = rows if wanted is None else [r for r in rows if r['tile'] in wanted]
    if not scope:
        print('no spawns in scope', file=sys.stderr)
        return 2

    per_tile, worklist, per_tile_unbuilt = tally(scope, meshes, built, built_lc)
    agg = collections.Counter()
    for c in per_tile.values():
        agg.update(c)
    total = agg['total']

    scope_label = ('ALL TILES' if wanted is None else
                   'starter regions' if args.starter else
                   args.region or ','.join(sorted(wanted)))
    print('=== spawned-instance model coverage (%s) ===' % scope_label)
    print('tiles %d   distinct npcIds %d   instances %d'
          % (len(per_tile), len({r['npc_id'] for r in scope}), total))
    print('  BUILT      %7d  %5.1f%%   renders as a real glTF' % (agg['built'], pct(agg['built'], total)))
    print('  unbuilt    %7d  %5.1f%%   mesh known, no glTF -> capsule' % (agg['unbuilt'], pct(agg['unbuilt'], total)))
    print('  no_mesh    %7d  %5.1f%%   npcgrp record with empty mesh_name' % (agg['no_mesh'], pct(agg['no_mesh'], total)))
    print('  no_npcgrp  %7d  %5.1f%%   npcId absent from npcgrp.dat' % (agg['no_npcgrp'], pct(agg['no_npcgrp'], total)))
    distinct_unbuilt = len(worklist)
    print('  %d distinct unbuilt meshes cover the %d unbuilt instances'
          % (distinct_unbuilt, agg['unbuilt']))

    if args.sensitivity:
        w = capped_weight(scope)
        pt2, _wl2, _u2 = tally(scope, meshes, built, built_lc, weight=w)
        a2 = collections.Counter()
        for c in pt2.values():
            a2.update(c)
        print('  [sensitivity] under a proportional maximumNpcs cap: '
              '%.1f%% built (%.1f pp from headline)'
              % (pct(a2['built'], a2['total']),
                 pct(a2['built'], a2['total']) - pct(agg['built'], total)))

    if args.verify_tiles:
        checked, mism = verify_tiles(scope)
        print('  [tile check] %d fixed spawns carry pos; %d (%.3f%%) land '
              'outside their filename tile' % (checked, mism, pct(mism, checked)))

    if args.per_tile:
        print('\n--- worst-covered tiles (by unbuilt instances) ---')
        print('%-7s %-26s %6s %7s  %s' % ('tile', 'region', 'inst', 'built', 'top unbuilt meshes'))
        order = sorted(per_tile.items(), key=lambda kv: -kv[1]['unbuilt'])
        for tile, c in order[:args.per_tile]:
            top = ', '.join('%s x%d' % (m.rsplit('.', 1)[-1], n)
                            for m, n in per_tile_unbuilt[tile].most_common(4))
            print('%-7s %-26s %6d %6.1f%%  %s'
                  % (tile, names.get(tile, '?')[:26], c['total'],
                     pct(c['built'], c['total']), top))

    print('\n--- ranked worklist: unbuilt meshes by instance count ---')
    print('%5s %7s %6s  %s' % ('#', 'inst', 'share', 'mesh (package.object)'))
    cum = 0
    for i, (ref, n) in enumerate(worklist.most_common(args.top), 1):
        cum += n
        print('%5d %7d %5.2f%%  %-46s  (cum %.1f%% of all unbuilt)'
              % (i, n, pct(n, total), ref, pct(cum, agg['unbuilt'])))
    if distinct_unbuilt > args.top:
        print('      ... %d more meshes, %d instances'
              % (distinct_unbuilt - args.top,
                 agg['unbuilt'] - sum(n for _r, n in worklist.most_common(args.top))))

    result = {
        'scope': scope_label,
        'instances': total,
        'built': agg['built'],
        'built_pct': round(pct(agg['built'], total), 4),
        'unbuilt': agg['unbuilt'],
        'no_mesh': agg['no_mesh'],
        'no_npcgrp': agg['no_npcgrp'],
        'distinct_unbuilt_meshes': distinct_unbuilt,
        'manifest_models': len(built),
        'worklist': [{'mesh': m, 'instances': n}
                     for m, n in worklist.most_common()],
        'per_tile': {t: {'instances': c['total'], 'built': c['built'],
                         'built_pct': round(pct(c['built'], c['total']), 4)}
                     for t, c in sorted(per_tile.items())},
    }
    if args.json:
        with open(args.json, 'w', encoding='utf-8') as fh:
            json.dump(result, fh, indent=2)
        print('\nwrote %s' % args.json)

    if args.update_baseline:
        if wanted is not None:
            print('\nrefusing to baseline a filtered scope -- run with no '
                  'tile filter', file=sys.stderr)
            return 2
        base = {'built_pct': result['built_pct'], 'built': result['built'],
                'instances': result['instances'],
                'manifest_models': result['manifest_models']}
        with open(BASELINE, 'w', encoding='utf-8') as fh:
            json.dump(base, fh, indent=2)
            fh.write('\n')
        print('\nbaseline updated: %.4f%% (%d/%d instances, %d models)'
              % (base['built_pct'], base['built'], base['instances'],
                 base['manifest_models']))
        return 0

    if args.check:
        if wanted is not None:
            print('\n--check must run over ALL tiles', file=sys.stderr)
            return 2
        try:
            with open(BASELINE, 'r', encoding='utf-8') as fh:
                base = json.load(fh)
        except (OSError, ValueError):
            print('\nFAIL: no baseline; run --update-baseline first',
                  file=sys.stderr)
            return 1
        print('\n--- check vs baseline ---')
        print('baseline %.4f%% (%d models)   now %.4f%% (%d models)'
              % (base['built_pct'], base.get('manifest_models', -1),
                 result['built_pct'], result['manifest_models']))
        if result['built_pct'] + 1e-9 < base['built_pct']:
            print('FAIL: coverage regressed by %.4f pp'
                  % (base['built_pct'] - result['built_pct']), file=sys.stderr)
            return 1
        if result['instances'] != base['instances']:
            # spawn tables changed under us: the % is not comparable
            print('WARN: instance total moved %d -> %d (spawn tables changed)'
                  % (base['instances'], result['instances']))
        print('PASS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
