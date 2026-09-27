"""Elbera Tools: exact skill-level visual references from the owned original DAT."""
import hashlib
from pathlib import Path
import tempfile

from extract_gamedata import ROOT, decrypt, parse_skillgrp

SOURCE_SHA = '4e245e914048cee34ada7fb6ed6b499976cbe961ad5bd0a8bfdcf00a1e2288d9'


def original_skillgrp():
    path = Path(ROOT) / 'assets/interlude/system/skillgrp.dat'
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    if sha != SOURCE_SHA:
        raise ValueError('skill visual binding schema requires the verified original skillgrp.dat build')
    with tempfile.TemporaryDirectory() as temp:
        rows = parse_skillgrp(decrypt('skillgrp.dat', temp))
    return rows, {'file': 'skillgrp.dat', 'SHA256': sha,
                  'field': 'skill_visual_effect', 'nativeRecordOffset': '0x44'}


def build_bindings(rows):
    """Compress identical paths without making absent levels inherit a record."""
    grouped = {}
    for row in rows:
        sid, level = row['skill_id'], row['skill_level']
        path = row.get('skill_visual_effect')
        if not isinstance(sid, int) or not isinstance(level, int) or sid <= 0 or level <= 0:
            raise ValueError('invalid original skill identity')
        if not isinstance(path, str):
            raise ValueError('missing original skill_visual_effect field')
        levels = grouped.setdefault(sid, {})
        if level in levels:
            raise ValueError('duplicate original skill identity')
        levels[level] = path
    result = {}
    for sid in sorted(grouped):
        values = grouped[sid]
        levels = sorted(values)
        path = values[levels[0]]
        overrides = {str(level): values[level] for level in levels if values[level] != path}
        result[str(sid)] = {'levels': levels, 'path': path, 'overrides': overrides}
    return result
