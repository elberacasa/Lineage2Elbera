"""Portable synthetic PCM fixtures, no originals or audio backend required."""
import json
from pathlib import Path
import struct
import tempfile
import unittest

from export_quest_sounds import build_metadata, write_or_check, wave_info


def fixture():
    fmt = struct.pack('<HHIIHH', 1, 2, 22050, 88200, 4, 16)
    pcm = struct.pack('<4h', 1000, -1000, 2, 700)
    body = b'WAVEfmt ' + struct.pack('<I', 16) + fmt + b'data' + struct.pack('<I', len(pcm)) + pcm
    wave = b'RIFF' + struct.pack('<I', len(body)) + body
    key = 'ItemSound.synthetic'
    info = {'sourceReference': 'ItemSound.Group.synthetic', 'sourceExport': 1,
        'sourceExportSHA256': '1' * 64, 'waveOffsetInExport': 9, **wave_info(wave)}
    return build_metadata({key: info}), {key: wave}


class ExportTests(unittest.TestCase):
    def test_writes_and_checks_exact_stereo_bytes(self):
        metadata, waves = fixture()
        with tempfile.TemporaryDirectory() as directory:
            total = write_or_check(directory, metadata, waves)
            self.assertEqual(total, len(waves['ItemSound.synthetic']))
            path = Path(directory) / 'quest/synthetic.wav'
            self.assertEqual(path.read_bytes(), waves['ItemSound.synthetic'])
            self.assertEqual(wave_info(path.read_bytes())['channels'], 2)
            self.assertEqual(json.loads((Path(directory) / 'quest-sounds.json').read_text()), metadata)
            self.assertEqual(write_or_check(directory, metadata, waves, True), total)
            changed = bytearray(path.read_bytes()); changed[-1] ^= 1; path.write_bytes(changed)
            with self.assertRaises(ValueError):
                write_or_check(directory, metadata, waves, True)

    def test_rejects_mismatched_source_payload_and_missing_rows(self):
        metadata, waves = fixture()
        with tempfile.TemporaryDirectory() as directory:
            metadata['sounds']['itemsound.synthetic']['channels'] = 1
            with self.assertRaises(ValueError):
                write_or_check(directory, metadata, waves)
            metadata, waves = fixture()
            with self.assertRaises(ValueError):
                write_or_check(directory, metadata, {})


if __name__ == '__main__':
    unittest.main()
