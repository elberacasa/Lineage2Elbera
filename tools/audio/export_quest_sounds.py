#!/usr/bin/env python3
"""Elbera Tools: preserve four original quest-feedback stereo WAV containers.

Requires supplied private ItemSound.uax. No transcoding, downmixing, playback,
network or account access. Outputs remain private under assets/audio/quest.
This preserves audio source data; it does not certify runtime gain behavior.
"""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/ui'))
from check_playsound_native import collect_quest_waves, ITEMSOUND_SHA, wave_info

FORMAT = 'l2-interlude-quest-sounds-v1'


def build_metadata(sounds):
    return {'format': FORMAT,
        'source': {'file': 'assets/interlude/sounds/ItemSound.uax', 'SHA256': ITEMSOUND_SHA},
        'sounds': {key.lower(): {**info,
            'url': '/audio/quest/' + key.split('.')[-1] + '.wav'}
            for key, info in sorted(sounds.items())}}


def write_or_check(output, metadata, waves, check=False):
    """One namespace, explicit complete source set; no existing mono fallback."""
    output = Path(output)
    encoded = json.dumps(metadata, sort_keys=True, separators=(',', ':')) + '\n'
    files = {'quest-sounds.json': encoded.encode()}
    for key, data in waves.items():
        row = metadata['sounds'][key.lower()]
        info = wave_info(data)
        if any(info[field] != row[field] for field in info):
            raise ValueError('WAV bytes do not match the exact source metadata')
        name = key.split('.')[-1]
        if row['url'] != '/audio/quest/' + name + '.wav':
            raise ValueError('unexpected quest-sound output URL')
        files['quest/' + name + '.wav'] = data
    if set(metadata['sounds']) != {k.lower() for k in waves}:
        raise ValueError('source records and WAV set disagree')
    for relative, data in files.items():
        path = output / relative
        if check:
            if not path.is_file() or path.read_bytes() != data:
                raise ValueError('missing or changed original quest output: ' + str(path))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    return sum(len(data) for name, data in files.items() if name.endswith('.wav'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='fresh original bytes must equal every existing output')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'assets/audio')
    parser.add_argument('--receipt', type=Path, default=ROOT / 'tmp/restart-audit/quest-sounds.json')
    args = parser.parse_args()
    sounds, waves = collect_quest_waves()
    metadata = build_metadata(sounds)
    total = write_or_check(args.output_dir, metadata, waves, args.check)
    receipt = {'tool': 'Elbera Tools', 'status': 'checked-original-bytes' if args.check else 'exported-original-bytes',
        **metadata, 'totalWavBytes': total,
        'limits': ['Unchanged original PCM containers; no codec conversion.',
                   'Audio-driver gain after the initial call remains under investigation.']}
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.write_text(json.dumps(receipt, indent=2) + '\n')
    print(f"{'CHECK PASS' if args.check else 'EXPORTED'}: {len(waves)} stereo WAVs, {total} unchanged original bytes")
    print('Private metadata: ' + str(args.output_dir / 'quest-sounds.json'))
    print('Private receipt: ' + str(args.receipt))


if __name__ == '__main__':
    main()
