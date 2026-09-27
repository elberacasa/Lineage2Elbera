#!/usr/bin/env python3
"""Elbera Tools: verified original UAX group paths to existing audio exports.

Reads supplied encrypted UAX packages and existing .ogg outputs; no extraction,
transcoding or audio mutation. A grouped source path is mapped only when its
package+basename identifies exactly one original Sound export and one output.
Hashes identify the inputs; this name/identity audit does not prove codec parity.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
from l2lib import load_package


def sha(data):
    return hashlib.sha256(data).hexdigest()


def manifest_summary(report):
    """Fingerprint the full source audit without shipping its per-sound evidence.

    Canonical encoding: UTF-8 JSON, sorted object keys, compact separators,
    ASCII escapes and no nonfinite numbers. Serialized array order is retained.
    The separate pawn-notify coverage receipt is not part of this source report.
    """
    encoded = json.dumps(report, sort_keys=True, separators=(',', ':'),
                         ensure_ascii=True, allow_nan=False).encode('utf-8')
    return {'format': 'original-uax-sound-reference-summary-v1',
            'reportFormat': report['format'], 'reportSHA256': sha(encoded),
            'sourceBanks': len(report['packages']), 'sourceSounds': report['sourceSounds'],
            'audioOutputs': report['audioOutputs'], 'verifiedReferences': len(report['references']),
            'unresolvedReferences': len(report['unresolved'])}


def check_manifest(manifest, aliases, report):
    if any(manifest.get('sfx', {}).get(key) != value for key, value in aliases.items()):
        raise ValueError('Manifest does not retain every verified original sound reference')
    if manifest.get('soundReferences') != manifest_summary(report):
        raise ValueError('Manifest sound-reference summary differs from fresh inputs')


def original_path(package, export, package_name):
    """Recover every serialized group; reject foreign/non-package outers."""
    names, ref, seen = [package.export_name(export)], export.package_index, set()
    while ref:
        if ref <= 0 or ref in seen:
            raise ValueError('foreign or cyclic Sound outer chain')
        seen.add(ref)
        group = package.resolve_ref(ref)
        if package.class_name_of(group) != 'Package':
            raise ValueError('unsupported Sound outer type')
        names.append(package.export_name(group))
        ref = group.package_index
    if any(not n or '.' in n or '/' in n or '\\' in n for n in [package_name, *names]):
        raise ValueError('invalid qualified Sound name component')
    return '.'.join([package_name, *reversed(names)])


def match_records(records, outputs):
    """Pure ambiguity check, independent of the current manifest's guesses."""
    source_by_leaf, output_by_leaf = defaultdict(list), defaultdict(list)
    seen_paths = set()
    for row in records:
        key = row['reference'].casefold()
        if key in seen_paths:
            raise ValueError('duplicate case-insensitive original Sound path')
        seen_paths.add(key)
        source_by_leaf[row['package'].casefold(), row['leaf'].casefold()].append(row)
    for row in outputs:
        output_by_leaf[row['package'].casefold(), row['leaf'].casefold()].append(row)
    aliases, provenance, unresolved = {}, {}, []
    for row in records:
        key = row['reference'].casefold()
        leaf = row['package'].casefold(), row['leaf'].casefold()
        candidates = output_by_leaf[leaf]
        reason = ('ambiguous-original-basename' if len(source_by_leaf[leaf]) != 1 else
                  'missing-audio-output' if not candidates else
                  'ambiguous-audio-output' if len(candidates) != 1 else None)
        if reason:
            unresolved.append({'reference': row['reference'], 'reason': reason})
            continue
        output = candidates[0]
        aliases[key] = output['path']
        provenance[key] = {'sourceExport': row['export'], 'sourceExportSHA256': row['SHA256'],
                           'audioPath': output['path'], 'audioSHA256': output['SHA256']}
    return aliases, provenance, unresolved


def build_aliases(source_dir=ROOT / 'assets/interlude/sounds', output_dir=ROOT / 'assets/audio/sfx'):
    source_dir, output_dir = Path(source_dir), Path(output_dir)
    if not source_dir.is_dir() or not output_dir.is_dir():
        raise ValueError('supplied original sound banks and existing audio outputs are required')
    records, outputs, packages = [], [], {}
    banks = sorted(p for p in source_dir.iterdir() if p.is_file() and p.suffix.casefold() == '.uax')
    if not banks:
        raise ValueError('no supplied original UAX banks')
    for path in banks:
        key = path.stem.casefold()
        if key in packages:
            raise ValueError('duplicate case-insensitive UAX package')
        pkg, _ = load_package(str(path))
        packages[key] = {'file': path.name, 'SHA256': sha(path.read_bytes()),
                         'decryptedSHA256': sha(pkg.data), 'fileVersion': pkg.file_version,
                         'licenseeVersion': pkg.licensee_version}
        for export in pkg.exports_by_class('Sound'):
            start, end = export.serial_offset, export.serial_offset + export.serial_size
            if not 0 <= start < end <= len(pkg.data):
                raise ValueError('Sound export outside original package')
            records.append({'package': path.stem, 'leaf': pkg.export_name(export),
                            'reference': original_path(pkg, export, path.stem),
                            'export': export.index, 'SHA256': sha(pkg.data[start:end])})
    for package in sorted(p for p in output_dir.iterdir() if p.is_dir()):
        for path in sorted(p for p in package.iterdir() if p.is_file() and p.suffix.casefold() == '.ogg'):
            outputs.append({'package': package.name, 'leaf': path.stem,
                            'path': path.relative_to(output_dir).as_posix(), 'SHA256': sha(path.read_bytes())})
    aliases, provenance, unresolved = match_records(records, outputs)
    return aliases, {'format': 'original-uax-sound-reference-aliases-v1', 'packages': packages,
                     'sourceSounds': len(records), 'audioOutputs': len(outputs),
                     'references': provenance, 'unresolved': unresolved,
                     'limits': 'Original qualified identity and unique export filename mapping; no codec/content parity proof'}


def direct_notify_coverage(aliases, pawn_file):
    data = json.loads(Path(pawn_file).read_text())
    if data.get('format') != 'l2-interlude-pawn-animation-v2':
        raise ValueError('original pawn timing v2 required for notify reference coverage')
    refs, events = set(), 0
    for clips in data['clips'].values():
        for name, clip in clips.items():
            if not name.casefold().startswith(('cast', 'magic', 'spatk', 'shieldatk', 'picitem')):
                continue
            for note in clip['notifies']:
                if note.get('soundInfo', {}).get('status') == 'source-direct':
                    events += 1
                    refs.add(note['sound'].casefold())
    return {'scope': 'exported ordinary cast/magic/special-attack/shield/pickup aliases',
            'events': events, 'distinctReferences': len(refs),
            'unresolved': sorted(refs - aliases.keys())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='also require the current manifest to retain every verified reference')
    parser.add_argument('--output', type=Path, default=ROOT / 'tmp/restart-audit/sound-reference-aliases.json')
    args = parser.parse_args()
    aliases, report = build_aliases()
    if args.check:
        manifest = json.loads((ROOT / 'assets/audio/manifest.json').read_text())
        check_manifest(manifest, aliases, report)
    # Supplemental coverage is private receipt data, outside the summary hash.
    pawn_file = ROOT / 'editor/characters/pawnanim.json'
    if pawn_file.exists():
        report['ordinaryNotifyCoverage'] = direct_notify_coverage(aliases, pawn_file)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print('%d original references verified; %d unresolved source/output identities.' % (len(aliases), len(report['unresolved'])))
    if 'ordinaryNotifyCoverage' in report:
        coverage = report['ordinaryNotifyCoverage']
        print('%d ordinary notify events, %d references, %d unresolved.' %
              (coverage['events'], coverage['distinctReferences'], len(coverage['unresolved'])))
    print('Private receipt: ' + str(args.output))


if __name__ == '__main__':
    main()
