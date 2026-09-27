#!/usr/bin/env python3
"""Recover the Interlude quest journal directly from questname-e.dat.

Layout lead: L2ClientDat's Interlude questname schema (see docs/quest-data.md).
Every record, string terminator and trailing byte is checked against the local
decrypted client. Unresolved flag meanings remain unknown fields, not rules.
Original Interface/QuestTreeWnd.uc and NWindow/UIDATA_QUEST.uc establish the
journal's consumers. No quest prose, location or requirement is authored here.
"""
import argparse
import hashlib
import json
import math
import struct
from pathlib import Path
import tempfile

from extract_gamedata import decrypt, SYSTEM_DIR, OUT_DIR, TRAILER
from l2dat import Reader

SOURCE = 'questname-e.dat'
FORMAT = 'l2-interlude-quests-v1'


class QuestReader(Reader):
    def _take(self, n):
        if not isinstance(n, int) or n < 0:
            raise ValueError('negative byte count')
        return super()._take(n)

    def string(self):
        count = self.compact_int()
        if count == 0:
            return ''
        width = 1 if count > 0 else 2
        raw = self._take(abs(count) * width)
        if raw[-width:] != b'\0' * width:
            raise ValueError(f'{self.path}: unterminated string at {self.pos}')
        return raw[:-width].decode('cp1252' if count > 0 else 'utf-16-le')

    def ints(self, signed=False):
        count = self.compact_int()
        if count < 0 or count > (len(self.data) - self.pos) // 4:
            raise ValueError(f'{self.path}: invalid list count at {self.pos}')
        read = self.i32 if signed else self.u32
        return [read() for _ in range(count)]

    def vector(self):
        raw = self._take(12)
        values = list(struct.unpack('<3f', raw))
        # Three source records contain nonfinite start-NPC coordinates. Keep
        # their exact bits and mark the position absent instead of inventing a
        # replacement or emitting nonstandard JSON NaN values.
        return (values if all(math.isfinite(v) for v in values) else None,
                list(struct.unpack('<3I', raw)))


def parse(data):
    if not data.endswith(TRAILER):
        raise ValueError('questname: missing SafePackage trailer')
    r = QuestReader(data[:-len(TRAILER)], SOURCE)
    count = r.u32()
    if count > len(r.data) // 12:
        raise ValueError('questname: impossible record count')
    rows, keys = [], set()
    for _ in range(count):
        offset = r.pos
        q = {'tag': r.u32(), 'id': r.u32(), 'level': r.u32(),
             'title': r.string(), 'journal': r.string(), 'description': r.string(),
             'itemIds': r.ints(), 'itemCounts': r.ints(signed=True), 'targetLoc': r.vector(),
             'minLevel': r.u32(), 'maxLevel': r.u32(), 'questType': r.u32(),
             'targetName': r.string(), 'getItemInQuest': r.u32(),
             'unknown1': r.u32(), 'unknown2': r.u32(), 'startNpcId': r.u32(),
             'startNpcLoc': r.vector(), 'requirements': r.string(), 'intro': r.string(),
             'classLimits': r.ints(signed=True), 'requiredItems': r.ints(signed=True),
             'clanPetQuest': r.u32(), 'requiredQuest': r.u32(),
             'unknown3': r.u32(), 'areaId': r.u32()}
        for name in ('targetLoc', 'startNpcLoc'):
            q[name], q[name + 'Bits'] = q[name]
        if len(q['itemIds']) != len(q['itemCounts']):
            raise ValueError(f'quest {q["id"]}: item/count lists disagree')
        key = q['id'], q['level']
        if key in keys:
            raise ValueError(f'duplicate quest journal key {key}')
        keys.add(key)
        q['sourceOffset'] = offset
        q['sourceLength'] = r.pos - offset
        q['sourceSHA256'] = hashlib.sha256(r.data[offset:r.pos]).hexdigest()
        rows.append(q)
    if not r.done():
        raise ValueError(f'questname: {len(r.data) - r.pos} unexplained bytes')
    return rows


def build(data, original):
    rows = parse(data)
    return {'format': FORMAT, 'provenance': {
        'edition': 'Interlude', 'source': 'assets/interlude/system/' + SOURCE,
        'sourceSHA256': hashlib.sha256(original).hexdigest(),
        'decryptedSHA256': hashlib.sha256(data).hexdigest(),
        'recordCount': len(rows), 'questCount': len({r['id'] for r in rows}),
        'decodedBytes': len(data) - len(TRAILER),
        # NWindow showability helpers -> Engine GetQuestData record offsets:
        # +0x24 (unknown1) journal completion; +0x4c (unknown2) item completion.
        # The native serializer at Engine VA0x104659c0 validates these fields.
        'completionFields': {'journal': 'unknown1 != 0', 'items': 'unknown2 != 0'},
        'unresolvedFields': ['getItemInQuest',
                             'clanPetQuest', 'requiredQuest', 'unknown3', 'areaId'],
    }, 'records': rows}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--check', action='store_true', help='re-decode source and compare existing output')
    ap.add_argument('--output', type=Path, default=Path(OUT_DIR) / 'quests.json')
    args = ap.parse_args()
    original = (Path(SYSTEM_DIR) / SOURCE).read_bytes()
    with tempfile.TemporaryDirectory() as temp:
        result = build(decrypt(SOURCE, temp), original)
    if args.check:
        if json.loads(args.output.read_text()) != result:
            raise ValueError('quests.json differs from the original client extraction')
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False,
                                         separators=(',', ':')) + '\n')
    p = result['provenance']
    print(f"{'CHECK PASS' if args.check else 'EXTRACTED'}: {p['recordCount']} journal records, "
          f"{p['questCount']} quests, {p['decodedBytes']} decoded bytes, no unexplained tail")


if __name__ == '__main__':
    main()
