#!/usr/bin/env python3
"""Elbera Tools: copy the supplied English Interlude tutorial Oggs unchanged.

Reads private client files; emits private browser assets and source metadata.
No client execution, transcoding, synthesized speech or language fallback.
The catalog fingerprint identifies this supplied edition, not its distributor.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[2]
CATALOG_SHA = 'd6a59635328d18053a600d200b544ae84708fdbe3c553f197e1b393ce0284ea2'


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def ogg_info(data):
    """Bounded single-stream Vorbis framing; full codec validation is separate."""
    position, serial, sequence, first, final, frames = 0, None, 0, None, False, None
    while position < len(data) and not final:
        if data[position:position + 6] not in (b'OggS\0\x02', b'OggS\0\x00', b'OggS\0\x01', b'OggS\0\x04', b'OggS\0\x05'):
            raise ValueError('unsupported Ogg page framing')
        if position + 27 > len(data):
            raise ValueError('truncated Ogg page')
        flags = data[position + 5]
        granule, page_serial, page_sequence = struct.unpack_from('<QII', data, position + 6)
        if sequence == 0:
            if flags != 2:
                raise ValueError('missing Ogg beginning')
            serial = page_serial
        elif flags & 2:
            raise ValueError('unexpected Ogg beginning')
        if page_serial != serial or page_sequence != sequence:
            raise ValueError('unexpected Ogg stream or sequence')
        count = data[position + 26]
        laces = data[position + 27:position + 27 + count]
        start = position + 27 + count
        end = start + sum(laces)
        if len(laces) != count or end > len(data):
            raise ValueError('truncated Ogg body')
        if first is None:
            if len(laces) != 1 or laces[0] != 30:
                raise ValueError('unsupported Vorbis identification page')
            first = data[start:end]
            if first[:7] != b'\x01vorbis' or struct.unpack_from('<I', first, 7)[0] != 0 or first[29] != 1:
                raise ValueError('unsupported Vorbis identification')
        if flags & 4:
            final, frames = True, granule
        sequence += 1
        position = end
    if not final or first is None or not 0 < frames < 0x80000000:
        raise ValueError('missing final Vorbis sample position')
    channels, rate = first[11], struct.unpack_from('<I', first, 12)[0]
    if channels != 1 or rate != 44100:
        raise ValueError('unsupported supplied tutorial voice format')
    # Supplied files retain extra bytes after EOS. Their meaning is unresolved;
    # preserve and fingerprint them, rather than silently stripping them.
    return {'channels': channels, 'sampleRate': rate, 'frames': frames, 'encoding': 'vorbis',
            'oggBytes': position, 'trailerBytes': len(data) - position,
            'trailerSHA256': hashlib.sha256(data[position:]).hexdigest()}


def export(source, output, check=False):
    paths = sorted(source.glob('tutorial_voice_*-e.ogg'))
    catalog, blobs = [], {}
    for path in paths:
        if path.is_symlink() or not re.fullmatch(r'tutorial_voice_[0-9]{3}[a-z]?-e\.ogg', path.name):
            raise ValueError('unexpected tutorial voice input')
        data = path.read_bytes()
        catalog.append({'file': path.name, 'bytes': len(data), 'SHA256': hashlib.sha256(data).hexdigest()})
        blobs[path.name] = data
    if hashlib.sha256(encoded(catalog)).hexdigest() != CATALOG_SHA:
        raise ValueError('supplied tutorial catalog differs from pinned edition')
    sounds = {}
    for row in catalog:
        name = row['file']
        key = name[:-6]  # Remove exactly the decoded English suffix "-e.ogg".
        sounds[key] = {**row, **ogg_info(blobs[name]), 'url': '/audio/voice/' + name,
                       'sourceReference': name, 'sourceDirectory': 'Voice'}
    metadata = {'format': 'l2-interlude-tutorial-voice-v1', 'catalogSHA256': CATALOG_SHA,
        'languageVariant': 'e', 'languagePolicy': 'explicit-English-variant', 'sounds': sounds,
        'limits': ['Supplied original file identity, not archive provenance.',
                   'English suffix is selected explicitly; native startup language globals are not emulated.',
                   'Container framing checked; opaque post-EOS trailers are preserved, not interpreted.',
                   'Decoded PCM/device equivalence is not established.']}
    files = {'tutorial-voice.json': encoded(metadata) + b'\n',
             **{'voice/' + name: data for name, data in blobs.items()}}
    for relative, data in files.items():
        path = output / relative
        if check:
            if not path.is_file() or path.read_bytes() != data:
                raise ValueError('missing or changed original voice output: ' + str(path))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    return len(sounds), sum(len(data) for data in blobs.values())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=ROOT / 'assets/interlude/voice')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'assets/audio')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    count, size = export(args.source_dir, args.output_dir, args.check)
    print(f"{'CHECK PASS' if args.check else 'EXPORTED'}: {count} original tutorial voices, {size} unchanged bytes")
