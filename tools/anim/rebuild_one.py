#!/usr/bin/env python3
"""Rebuild ONE creature with the special-attack clip actually included, into a
scratch directory, so the fix can be seen side by side with the shipped model.

Why this exists
---------------
tools/src/char_pipeline/build_monsters.py maps the runtime's `special` slot to

    'special': ['SpWait01', 'Social01', 'atkwait', 'AtkWait_1HS']

Every one of those is a WAIT pose.  Measured, not assumed -- mean per-frame
quaternion delta across all bones, from the retail .psa:

    skeleton_anim     Wait 0.0010   atkwait 0.0057   SpWait01 0.0096
                      atk01 0.0277  spatk01 0.0237   run 0.0387
    stone_golem_anim  Wait 0.0028   atkwait 0.0028   SpWait01 0.0124
                      atk01 0.0365  spatk01 0.0399

`atkwait` is motionless to three decimals -- it is the combat-ready idle.
`SpWait01` is a slow taunt loop.  `spatk01` sits in the same band as `atk01`,
i.e. it is a strike.  entities.js:skillFlash() plays `special` for a monster
skill cast, so 235 creatures currently answer a skill cast with a standing
pose while their own animation set carries the real special attack.

This script does NOT modify the shipped pipeline or the shipped models -- it
imports build_monsters as a library, adds `spatk` to the candidate table for a
single mesh, and writes to --out (default tools/anim/rebuilt/).  Nothing under
editor/characters/ is touched.

Usage:  rebuild_one.py skeleton_m00 [--out DIR]
"""
import argparse
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools/src/char_pipeline'))
import build_monsters as bm  # noqa: E402

# The retail spellings actually observed across the 533 exported creature
# .psa sets (tools/anim/export_psa.sh + a frequency count): spatk01 appears in
# 271 sets, spatk02 in 144, spatk03 in 20.  No spelling is invented here --
# every candidate below was read out of a shipped .psa.
SPATK_CANDIDATES = {
    'spatk':  ['spatk01', 'SpAtk01', 'SpAtk01_1HS', 'SpAtk01_2HS'],
    'spatk2': ['spatk02', 'SpAtk02', 'SpAtk02_1HS', 'SpAtk02_2HS'],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('mesh_id')
    ap.add_argument('--out', default=os.path.join(HERE, 'rebuilt'))
    a = ap.parse_args()

    # additive only: every existing slot keeps its existing candidate list, so
    # the rebuilt model is the shipped model PLUS the special-attack clips.
    bm.ANIM_CANDIDATES = dict(bm.ANIM_CANDIDATES, **SPATK_CANDIDATES)

    roster = bm.resolve_roster([a.mesh_id])
    if not roster:
        print('no npcgrp record for %s' % a.mesh_id, file=sys.stderr)
        return 2
    mesh_id, pkg = roster[0]
    os.makedirs(a.out, exist_ok=True)
    stage = os.path.join(bm.STAGE, 'anim_' + mesh_id)
    if os.path.isdir(stage):
        shutil.rmtree(stage)
    m = bm.build_one(mesh_id, pkg, stage, a.out)
    if not m:
        print('build failed', file=sys.stderr)
        return 1
    print('rebuilt %s -> %s' % (mesh_id, a.out))
    print('clips: %s' % m.get('animations'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
