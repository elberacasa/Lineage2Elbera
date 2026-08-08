#!/usr/bin/env python3
"""Regression guard: a rebuilt model must never LOSE an animation clip.

WHY: editor/world/ addresses clips by name (`idle`, `run`, `attack`, ...).
A pipeline change that renames or drops one does not fail any structural
validator — the glTF is still valid — it just makes the client fall back
to a T-pose at runtime, in a build nobody rendered.  So the clip set is
snapshotted as an explicit baseline and diffed on every rebuild.

The baseline is a plain JSON map {model id: [clip names]}.  ADDING clips
is always allowed (that is what the stance work does); removing one, or
renaming one, fails.

Covers both manifests: editor/characters/manifest.json and
editor/characters/monsters/manifest.json, plus the glTF files themselves
(the manifest's `animations` list is checked against what the file really
contains, so a manifest that lies also fails).

Usage:
  clip_check.py --snapshot           # write the baseline from what is on disk
  clip_check.py --check              # fail if any model lost a clip
  clip_check.py --check --baseline X # use a different baseline file
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
BASELINE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        'clip_baseline.json')
SETS = [('characters', os.path.join(ROOT, 'editor/characters')),
        ('monsters', os.path.join(ROOT, 'editor/characters/monsters'))]


def scan():
    """-> {'<set>/<id>': {'manifest': [...], 'gltf': [...]}} from disk."""
    out = {}
    for label, base in SETS:
        mpath = os.path.join(base, 'manifest.json')
        if not os.path.isfile(mpath):
            continue
        with open(mpath) as f:
            models = json.load(f).get('models', [])
        for m in models:
            key = '%s/%s' % (label, m['id'])
            rec = {'manifest': sorted(m.get('animations', []))}
            gp = os.path.join(base, m['gltf'])
            if os.path.isfile(gp):
                with open(gp) as f:
                    g = json.load(f)
                rec['gltf'] = sorted(a.get('name', '')
                                     for a in g.get('animations', []))
            out[key] = rec
    return out


def main():
    argv = sys.argv[1:]
    baseline = BASELINE
    if '--baseline' in argv:
        baseline = argv[argv.index('--baseline') + 1]
    cur = scan()

    if '--snapshot' in argv:
        with open(baseline, 'w') as f:
            json.dump({k: v['manifest'] for k, v in sorted(cur.items())},
                      f, indent=1)
        print('snapshot: %d models -> %s' % (len(cur), baseline))
        return 0

    if not os.path.isfile(baseline):
        print('FAIL: no baseline at %s (run --snapshot first)' % baseline)
        return 1
    with open(baseline) as f:
        base = json.load(f)

    errs, added, missing_models = [], 0, []
    for mid, want in sorted(base.items()):
        rec = cur.get(mid)
        if rec is None:
            missing_models.append(mid)
            continue
        lost = [c for c in want if c not in rec['manifest']]
        if lost:
            errs.append('%s: lost clip(s) %s' % (mid, ', '.join(lost)))
        added += len([c for c in rec['manifest'] if c not in want])
        if 'gltf' in rec:
            liar = [c for c in rec['manifest'] if c not in rec['gltf']]
            if liar:
                errs.append('%s: manifest claims %s but the glTF has no such '
                            'animation' % (mid, ', '.join(liar)))
    for mid in missing_models:
        errs.append('%s: in the baseline but not in any manifest now' % mid)

    print('%d models checked against %d baselined; %d clips added, '
          '%d problems' % (len(cur), len(base), added, len(errs)))
    for e in errs:
        print('FAIL: %s' % e)
    if errs:
        return 1
    print('PASS: no model lost a clip')
    return 0


if __name__ == '__main__':
    sys.exit(main())
