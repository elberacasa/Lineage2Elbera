#!/usr/bin/env python3
"""Elbera Tools: original character-creation choices and source asset references.

Writes ignored editor/characters/charcreate-data.json. Original NWindow option
lists establish offered styles/colors/faces. Hairgrp pairs are two independent
hair-part indices, NOT mesh/texture pairs or a painted-hair classification.
Chargrp/classinfo/SysString supply original references/descriptions/labels.
Class IDs and base stats remain explicitly configured aCis-server data.

Requires pinned original DLLs, Capstone, the owner's DAT files and l2encdec.
This metadata does not certify preview initialization or renderer parity.
See docs/native-creation-appearance-evidence.md.
"""

import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from l2dat import Reader  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SYSTEM_DIR = os.path.join(ROOT, "assets", "interlude", "system")
CLASSES_DIR = os.path.join(ROOT, "server", "aCis_datapack", "data", "xml", "classes")
L2ENCDEC = os.path.join(ROOT, "tools", "bin", "l2encdec")
OUT_PATH = os.path.join(ROOT, "editor", "characters", "charcreate-data.json")

TRAILER = b"\x0cSafePackage\x00"  # ASCF EOF marker in every .dat

# chargrp.dat record order (fixed, no header; record 14 is zero padding).
# (race, gender, class type, texture package holding face/hair assets)
CHARGRP_RECORDS = [
    ("human",   "male",   "fighter", "MFighter"),
    ("human",   "female", "fighter", "FFighter"),
    ("darkelf", "male",   "fighter", "mdarkelf"),
    ("darkelf", "female", "fighter", "fdarkelf"),
    ("dwarf",   "male",   "fighter", "mdwarf"),
    ("dwarf",   "female", "fighter", "fdwarf"),
    ("elf",     "male",   "fighter", "melf"),
    ("elf",     "female", "fighter", "felf"),
    ("human",   "male",   "mage",    "MMagic"),
    ("human",   "female", "mage",    "FMagic"),
    ("orc",     "male",   "fighter", "MOrc"),
    ("orc",     "female", "fighter", "FOrc"),
    ("orc",     "male",   "mage",    "MShaman"),
    ("orc",     "female", "mage",    "FShaman"),
]
# Native GetMeshType maps Elf/Dark Elf mage and fighter to the same model
# rows; see check_face_selection_native.py. Starting gear/class statistics
# are separate configured-server inputs, not evidence for that native mapping.

RACE_NAMES = {"human": "Human", "elf": "Elf", "darkelf": "Dark Elf",
              "orc": "Orc", "dwarf": "Dwarf"}
# aCis datapack file per creation class + classinfo-e.dat id (creation order
# 1..9: HF, HM, EF, EM, DF, DM, OF, OM, DwF; id 0 is the placeholder).
CLASS_DEFS = {
    "human":   [("human_fighter",  "Human Fighter",  "fighter", "humanFighter",  1),
                ("human_mystic",   "Human Mystic",   "mage",    "humanMystic",   2)],
    "elf":     [("elven_fighter",  "Elven Fighter",  "fighter", "elvenFighter",  3),
                ("elven_mystic",   "Elven Mystic",   "mage",    "elvenMystic",   4)],
    "darkelf": [("dark_fighter",   "Dark Fighter",   "fighter", "darkFighter",   5),
                ("dark_mystic",    "Dark Mystic",    "mage",    "darkMystic",    6)],
    "orc":     [("orc_fighter",    "Orc Fighter",    "fighter", "orcFighter",    7),
                ("orc_mystic",     "Orc Mystic",     "mage",    "orcMystic",     8)],
    "dwarf":   [("dwarven_fighter", "Dwarven Fighter", "fighter", "dwarfFighter", 9)],
}


def decrypt(name: str, outdir: str) -> bytes:
    out = os.path.join(outdir, name + ".dec")
    subprocess.run([L2ENCDEC, "-c", "decode", "-p", "413", "-o", out,
                    os.path.join(SYSTEM_DIR, name)],
                   check=True, capture_output=True)
    with open(out, "rb") as f:
        return f.read()


def parse_chargrp(data: bytes):
    """14 real records + 1 zero padding record + SafePackage trailer."""
    assert data.endswith(TRAILER), "chargrp: missing SafePackage trailer"
    r = Reader(data[:-len(TRAILER)], "chargrp.dat")
    records = []
    while not r.done():
        face_icon = r.ustr()
        n_hm, n_ht, n_fm, n_ft = r.u32(), r.u32(), r.u32(), r.u32()
        rec = {
            "face_icon": face_icon,
            "hair_mesh": [r.ustr() for _ in range(n_hm)],
            "hair_texture": [r.ustr() for _ in range(n_ht)],
            "face_mesh": [r.ustr() for _ in range(n_fm)],
            "face_texture": [r.ustr() for _ in range(n_ft)],
            "body_mesh": [r.ustr() for _ in range(4)],
            "body_texture": [r.ustr() for _ in range(4)],
        }
        rec["attack_effect"] = r.ustr()
        rec["walkanimframe"] = r.u32()
        n_atk, n_def, n_dmg = r.u32(), r.u32(), r.u32()
        rec["attack_sound"] = [r.ustr() for _ in range(n_atk)]
        rec["defense_sound"] = [r.ustr() for _ in range(n_def)]
        rec["damage_sound"] = [r.ustr() for _ in range(n_dmg)]
        for key in ("hand", "1hs", "2hs", "dual", "pole", "bow", "unknown", "fist"):
            rec["voice_snd_" + key] = [r.ustr() for _ in range(r.u32())]
        records.append(rec)
    assert len(records) == 15, f"chargrp: expected 15 records, got {len(records)}"
    padding = records.pop()
    assert not padding["face_icon"] and not padding["body_mesh"][0], \
        "chargrp: record 15 is not the expected zero padding"
    return records


def parse_hairgrp(data: bytes):
    """15 records x 15 signed pairs: (PMS_Hair1 index, PMS_Hair2 index).

    -1 means that individual part is absent; it does not remove the style
    from the original creation UI. Native proof: check_hair_selection_native.
    """
    assert data.endswith(TRAILER), "hairgrp: missing SafePackage trailer"
    body = data[:-len(TRAILER)]
    assert len(body) == 15 * 30 * 4, f"hairgrp: unexpected size {len(body)}"
    ints = struct.unpack("<%di" % (len(body) // 4), body)
    records = []
    for i in range(15):
        g = ints[i * 30:(i + 1) * 30]
        records.append([(g[k], g[k + 1]) for k in range(0, 30, 2)])
    return records


def parse_classinfo(data: bytes):
    assert data.endswith(TRAILER), "classinfo: missing SafePackage trailer"
    r = Reader(data[:-len(TRAILER)], "classinfo-e.dat")
    descs = {}
    for _ in range(r.u32()):
        cid = r.u32()
        descs[cid] = r.ascf()
    assert r.done()
    return descs


def parse_acis_class(filename: str):
    with open(os.path.join(CLASSES_DIR, filename + ".xml")) as f:
        x = f.read()
    cid = int(re.search(r'<set id="(\d+)"', x).group(1))
    m = re.search(r'<set str="(\d+)" con="(\d+)" dex="(\d+)" int="(\d+)" '
                  r'wit="(\d+)" men="(\d+)"/>', x)
    str_, con, dex, int_, wit, men = map(int, m.groups())
    return cid, {"STR": str_, "DEX": dex, "CON": con,
                 "INT": int_, "WIT": wit, "MEN": men}


def appearance_matrix(chargrp, hairgrp, proof, labels):
    """Join original offered options to both part indices, preserving absence.

    The UI options determine the domain. A missing part never shrinks/reorders
    it; source labels carry no fabricated average-color swatches.
    """
    if proof.get('status') != 'verified-options' or len(chargrp) != 14 or len(hairgrp) != 15:
        raise ValueError('verified native options and complete source tables required')
    race_ids = {'human': 0, 'elf': 1, 'darkelf': 2, 'orc': 3, 'dwarf': 4}
    combinations = {(row['race'], row['occupation'], row['sex']): row for row in proof['combinations']}
    if len(combinations) != len(proof['combinations']):
        raise ValueError('duplicate creation-option combination')

    def choices(ids):
        return [{'index': index, 'sysStringId': key, 'name': labels[key]} for index, key in enumerate(ids)]

    appearance, assets = {}, {}
    for index, (race, gender, kind, package) in enumerate(CHARGRP_RECORDS):
        row = combinations[(race_ids[race], int(kind == 'mage'), int(gender == 'female'))]
        styles = choices(row['styleSysStringIds'])
        if len(hairgrp[index]) != 15:
            raise ValueError('incomplete hair-part source row')
        parts = []
        for style in styles:
            pair = hairgrp[index][style['index']]
            if len(pair) != 2 or any(type(value) is not int or value < -1 for value in pair):
                raise ValueError('invalid source hair-part pair')
            parts.append({'style': style['index'], 'hair1Index': pair[0], 'hair2Index': pair[1]})
        appearance.setdefault(race, {}).setdefault(gender, {})[kind] = {
            'hairStyles': len(styles), 'hairStyleOptions': styles,
            'hairParts': parts, 'hairColorCount': len(row['colorSysStringIds']),
            'hairColors': choices(row['colorSysStringIds']), 'faces': choices(row['faceSysStringIds']),
            'chargrpRow': index, 'package': package + '.utx',
        }
        rec = chargrp[index]
        assets.setdefault(race, {}).setdefault(gender, {})[kind] = {
            'faceIcon': 'sek.' + rec['face_icon'].split('.', 1)[1] if '.' in rec['face_icon'] else rec['face_icon'],
            'faceMesh': rec['face_mesh'], 'faceTextures': rec['face_texture'],
            'bodyMeshes': rec['body_mesh'], 'bodyTextures': rec['body_texture'],
            'animationPackage': pkg_animation(rec),
        }
    for race in ('elf', 'darkelf'):
        for gender in ('male', 'female'):
            appearance[race][gender]['mage'] = dict(appearance[race][gender]['fighter'])
    return appearance, assets


def main():
    workdir = tempfile.mkdtemp(prefix="l2charcreate_")
    print("decrypting .dat files ...")
    chargrp = parse_chargrp(decrypt("chargrp.dat", workdir))
    hairgrp = parse_hairgrp(decrypt("hairgrp.dat", workdir))
    classinfo = parse_classinfo(decrypt("classinfo-e.dat", workdir))
    print(f"  chargrp: {len(chargrp)} records (+padding), "
          f"hairgrp: {len(hairgrp)} records, classinfo: {len(classinfo)} entries")

    sys.path.insert(0, os.path.join(ROOT, "tools", "ui"))
    from check_creation_appearance_native import verify
    from extract_gamedata import parse_sysstring
    proof = verify()
    labels = {row["id"]: row["string"] for row in parse_sysstring(decrypt("sysstring-e.dat", workdir))}
    appearance, assets = appearance_matrix(chargrp, hairgrp, proof, labels)

    out = {"format": "elbera-character-creation-v2", "races": [], "nativeAppearance": proof,
           "sources": {name: hashlib.sha256(open(os.path.join(SYSTEM_DIR, name), "rb").read()).hexdigest()
                       for name in ("chargrp.dat", "hairgrp.dat", "classinfo-e.dat", "sysstring-e.dat")},
           "classStatsSource": "configured aCis datapack; not original-client rules"}
    for race in ("human", "elf", "darkelf", "orc", "dwarf"):
        classes = []
        for cid, name, ctype, acis_file, classinfo_id in CLASS_DEFS[race]:
            configured_id, stats = parse_acis_class(acis_file)
            classes.append({
                "id": cid,
                "name": name,
                "type": ctype,
                "classId": configured_id,
                "baseStats": stats,
                "description": classinfo[classinfo_id],
            })
        app = appearance[race]
        race_entry = {
            "id": race,
            "name": RACE_NAMES[race],
            "genders": ["male", "female"],
            "classes": classes,
            "appearance": {
                "faces": app["male"]["fighter"]["faces"],
                "hairStyles": max(app[g][t]["hairStyles"]
                                  for g in app for t in app[g]),
                "hairColors": app["male"]["fighter"]["hairColors"],
            },
            # Per-sex choices are authoritative; the race maximum is retained
            # only for older consumers. These are source references, not a
            # full visual-parity certification.
            "appearanceDetail": app,
            "creationAssets": assets.get(race, {}),
        }
        out["races"].append(race_entry)

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {OUT_PATH}")


def pkg_animation(rec):
    """Derive the animations/*.ukx package from a body mesh reference."""
    if rec["body_mesh"] and "." in rec["body_mesh"][0]:
        return rec["body_mesh"][0].split(".", 1)[0] + ".ukx"
    return None


if __name__ == "__main__":
    main()
