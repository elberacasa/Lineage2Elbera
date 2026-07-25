"""l2dat tests: Lineage2Ver413 decryption + record readers against the
real system/*.dat files, cross-checked against the existing verified
parser in tools/dat/extract_charcreate.py."""

import os
import sys
import unittest

from l2lib import detect_protocol
from l2lib.l2dat import DatReader, decrypt_dat, load_dat
from l2lib.tests.common import STATS, SYSTEM_DIR, TOOLS_DIR

# reuse the existing, field-verified schema parser as the reference
sys.path.insert(0, os.path.join(TOOLS_DIR, "dat"))
import extract_charcreate  # noqa: E402

TRAILER = b"\x0cSafePackage\x00"

CHARGRP = os.path.join(SYSTEM_DIR, "chargrp.dat")
HAIRGRP = os.path.join(SYSTEM_DIR, "hairgrp.dat")
CLASSINFO = os.path.join(SYSTEM_DIR, "classinfo-e.dat")


def parse_chargrp_l2lib(data):
    """chargrp schema re-implemented on l2lib.DatReader (14 records +
    1 zero padding record + SafePackage trailer)."""
    assert data.endswith(TRAILER), "chargrp: missing SafePackage trailer"
    r = DatReader(data[:-len(TRAILER)], "chargrp.dat")
    records = []
    while not r.done():
        rec = {"face_icon": r.ustr()}
        n_hm, n_ht, n_fm, n_ft = r.u32(), r.u32(), r.u32(), r.u32()
        rec["hair_mesh"] = [r.ustr() for _ in range(n_hm)]
        rec["hair_texture"] = [r.ustr() for _ in range(n_ht)]
        rec["face_mesh"] = [r.ustr() for _ in range(n_fm)]
        rec["face_texture"] = [r.ustr() for _ in range(n_ft)]
        rec["body_mesh"] = [r.ustr() for _ in range(4)]
        rec["body_texture"] = [r.ustr() for _ in range(4)]
        rec["attack_effect"] = r.ustr()
        rec["walkanimframe"] = r.u32()
        n_atk, n_def, n_dmg = r.u32(), r.u32(), r.u32()
        rec["attack_sound"] = [r.ustr() for _ in range(n_atk)]
        rec["defense_sound"] = [r.ustr() for _ in range(n_def)]
        rec["damage_sound"] = [r.ustr() for _ in range(n_dmg)]
        for key in ("hand", "1hs", "2hs", "dual", "pole", "bow",
                    "unknown", "fist"):
            rec["voice_snd_" + key] = [r.ustr() for _ in range(r.u32())]
        records.append(rec)
        STATS["dat_records_read"] += 1
    return records


class TestDatPrimitives(unittest.TestCase):
    def test_compact_int(self):
        # single byte, no continuation
        r = DatReader(bytes([5]))
        self.assertEqual(r.compact_int(), 5)
        # negative single byte: sign bit7, value 3
        r = DatReader(bytes([0x83]))
        self.assertEqual(r.compact_int(), -3)
        # two bytes: bit6 continue on first, bit7 continue on second
        r = DatReader(bytes([0x40, 0x01]))
        self.assertEqual(r.compact_int(), 64)
        # negative multi-byte
        r = DatReader(bytes([0xC0, 0x01]))
        self.assertEqual(r.compact_int(), -64)

    def test_ustr(self):
        payload = "hola".encode("utf-16-le")
        r = DatReader(len(payload).to_bytes(4, "little") + payload)
        self.assertEqual(r.ustr(), "hola")
        self.assertTrue(r.done())
        r = DatReader((0).to_bytes(4, "little"))
        self.assertEqual(r.ustr(), "")

    def test_ascf(self):
        r = DatReader(bytes([6]) + b"hello\x00")
        self.assertEqual(r.ascf(), "hello")
        r = DatReader(bytes([0]))
        self.assertEqual(r.ascf(), "")
        # negative length -> UTF-16LE, byte count -2*n, 2-byte NUL
        raw = "ab".encode("utf-16-le") + b"\x00\x00"
        r = DatReader(bytes([3]))  # n=-3 would be 0x83; test via negative
        r = DatReader(bytes([0x83]) + raw)
        self.assertEqual(r.ascf(), "ab")


class TestRealDatFiles(unittest.TestCase):
    def test_chargrp_decrypt_and_parse(self):
        if not os.path.exists(CHARGRP):
            self.skipTest("chargrp.dat not present")
        with open(CHARGRP, "rb") as f:
            self.assertEqual(detect_protocol(f.read()), 413)
        plain, protocol = decrypt_dat(CHARGRP)
        self.assertEqual(protocol, 413)
        self.assertTrue(plain.endswith(TRAILER))
        # cross-check: l2lib reader vs the field-verified reference parser
        mine = parse_chargrp_l2lib(plain)
        theirs = extract_charcreate.parse_chargrp(plain)
        self.assertEqual(len(mine), 15)  # 14 races + zero padding record
        self.assertEqual(theirs, mine[:14],
                         "l2lib record reads diverge from the reference "
                         "parser")

    def test_hairgrp_and_classinfo(self):
        for path, parser in ((HAIRGRP, extract_charcreate.parse_hairgrp),
                             (CLASSINFO, extract_charcreate.parse_classinfo)):
            if not os.path.exists(path):
                self.skipTest("%s not present" % os.path.basename(path))
            plain, protocol = decrypt_dat(path)
            self.assertEqual(protocol, 413)
            parsed = parser(plain)
            self.assertGreater(len(parsed), 0)

    def test_load_dat_reader(self):
        if not os.path.exists(CHARGRP):
            self.skipTest("chargrp.dat not present")
        r, protocol = load_dat(CHARGRP)
        self.assertEqual(protocol, 413)
        self.assertGreater(r.remaining(), 1000)
        first = r.ustr()  # first record's face_icon is a dotted name
        self.assertIn(".", first)

    def test_plaintext_passthrough(self):
        plain, protocol = decrypt_dat(b"\x01\x02\x03\x04")
        self.assertIsNone(protocol)
        self.assertEqual(plain, b"\x01\x02\x03\x04")


if __name__ == "__main__":
    unittest.main()
