#!/usr/bin/env python3
"""Elbera Tools: build the standalone NPC Source kit from an explicit allowlist.

No original data, generated models, browser runtime or third-party binaries.
Shares Core's archive machinery; the existing Core profile stays unchanged.
"""
import argparse
import hashlib
from pathlib import Path
import subprocess

from build_core import ROOT, build_source_archive, smoke_archive

# Paths and imports stay identical to the repository. Internal support modules
# are not additional advertised commands. Never replace this list with a glob.
MODULES = (
    'tools/anim/build_npc_variants.py',
    'tools/anim/build_pawnanim.py',
    'tools/anim/creature_anim_table.py',
    'tools/anim/export_source_tracks.py',
    'tools/anim/npc_source_tracks.py',
    'tools/anim/pack_source_tracks.py',
    'tools/dat/build_appearance.py',
    'tools/dat/build_hair.py',
    'tools/dat/build_meta.py',
    'tools/dat/export_npc_visuals.py',
    'tools/dat/extract_charcreate.py',
    'tools/dat/extract_gamedata.py',
    'tools/dat/l2dat.py',
    'tools/l2lib/__init__.py',
    'tools/l2lib/l2dat.py',
    'tools/l2lib/textures.py',
    'tools/l2lib/ue2package.py',
    'tools/src/char_pipeline/scale_util.py',
    'tools/src/char_pipeline/uclass_defaults.py',
    'tools/ui/check_anim_terminal_native.py',
    'tools/ui/check_animation_linkup_native.py',
    'tools/ui/check_hair_attachment_native.py',
    'tools/ui/check_legacy_skill_effects_native.py',
    'tools/ui/check_npc_animation_native.py',
    'tools/ui/check_npc_skin_native.py',
    'tools/ui/check_pose_allocation_native.py',
    'tools/ui/check_quaternion_native.py',
    'tools/ui/check_skillanim_native.py',
    'tools/ui/check_supplemental_engine.py',
    'tools/ui/check_track_native.py',
    'tools/ui/check_tutorial_quest_native.py',
    'tools/ui/supplemental_pe.py',
)
TESTS = (
    'tools/anim/test_pawnanim_source.py',
    'tools/anim/test_export_source_tracks.py',
    'tools/anim/test_build_npc_variants.py',
    'tools/ui/test_npc_animation_native.py',
    'tools/ui/test_animation_linkup_native.py',
    'tools/ui/test_supplemental_pe.py',
)
FILES = {
    **{name: name for name in MODULES + TESTS},
    'README.md': 'tools/release/NPC-SOURCE-README.md',
    'LICENSE': 'LICENSE',
    'docs/source-boundary.md': 'tools/release/NPC-SOURCE-BOUNDARY.md',
    'requirements-native.txt': 'tools/release/requirements-npc-native.txt',
    'tools/release/smoke_npc_source.py': 'tools/release/smoke_npc_source.py',
}


def build_bytes(root, version, revision, source_state='working-tree-candidate'):
    return build_source_archive(root, version, revision, FILES, 'npc-source', source_state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', default='0.1.0')
    parser.add_argument('--output', type=Path, help='write a new ZIP; refuses overwrite')
    parser.add_argument('--check', action='store_true', help='build and smoke-test without writing a ZIP')
    parser.add_argument('--native-fixtures', action='store_true',
                        help='also run synthetic PE comparisons; requires Capstone 5.0.7, no originals')
    args = parser.parse_args()
    if args.check == bool(args.output):
        parser.error('choose exactly one of --check or --output')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'],
                                    cwd=ROOT, text=True)
    source_state = 'working-tree-candidate' if dirty else 'committed-source'
    raw, prefix = build_bytes(ROOT, args.version, revision, source_state)
    smoke_archive(raw, prefix, 'tools/release/smoke_npc_source.py',
                  ('--native-fixtures',) if args.native_fixtures else ())
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('xb') as output:
            output.write(raw)
        print(f'Created {args.output} ({len(raw)} bytes)')
    print(f'Elbera Tools NPC Source: {len(FILES)} allowlisted files; {source_state}; SHA256 {hashlib.sha256(raw).hexdigest()}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
