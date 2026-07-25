#!/usr/bin/env python3
"""Extract the Lineage 2 Interlude character-creation data matrix into JSON.

Output: editor/characters/charcreate-data.json (frozen schema for the web
character creator, plus documented extra blocks with the raw asset references).

Data sources (all real, extracted from this repo):
  - assets/interlude/system/chargrp.dat    (413/RSA, decrypted with tools/bin/l2encdec)
      -> per race/gender/class: face mesh + 3 face textures, creation outfit
         body meshes/textures (the preview model data)
  - assets/interlude/system/hairgrp.dat    (413/RSA)
      -> per char record: 15 hair slots of (meshIndex, textureIndex);
         slots 0-6 = selectable hair styles (mesh -1 = painted hair, no
         attached mesh), slots 8/9 = universal extra head textures
  - assets/interlude/system/classinfo-e.dat (413/RSA)
      -> the 9 creation class description texts (ids 1-9; id 0 is the
         "Select a race and occupation." placeholder)
  - assets/interlude/systextures/*.utx     (listed with tools/bin/umodel -game=l2)
      -> hair style meshes (mXXX) and colors (tYY) actually shipped per
         race/gender/class package; hair color hex values are the average of
         the opaque pixels of one exported hair texture per color (t00-t03)
  - server/aCis_datapack/data/xml/classes/*.xml
      -> official class ids + base STR/DEX/CON/INT/WIT/MEN (server-side data;
         the Interlude client does NOT carry base stats)

See docs/dat-format-notes.md for the reverse-engineered format details.
"""

import glob
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
SYSTEX_DIR = os.path.join(ROOT, "assets", "interlude", "systextures")
CLASSES_DIR = os.path.join(ROOT, "server", "aCis_datapack", "data", "xml", "classes")
L2ENCDEC = os.path.join(ROOT, "tools", "bin", "l2encdec")
UMODEL = os.path.join(ROOT, "tools", "bin", "umodel")
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
# Elf / Dark Elf (and Dwarf) mages have no chargrp record of their own.
# PROVEN identical-to-fighter in retail Interlude (three independent sets):
#   1. chargrp.dat carries exactly 14 records (re-parsed from the raw file);
#      no elf/darkelf/dwarf mage record exists.
#   2. armorgrp.dat race_slots: the mystic starting armor (425 Apprentice's
#      Tunic, 461 Apprentice's Stockings) maps to the SAME m001 meshes as
#      the fighter's Squire set (1146/1147) for elf/darkelf/dwarf — only
#      human mystics (MMagic_m005 / FMagic_m002) and orc mystics
#      (MShaman/FShaman_m001) get distinct robe meshes at level 1.
#   3. aCis class definitions: elvenMystic/darkMystic start with items
#      425+461, i.e. the same in-game look as their fighters.
# The m002+ armor series in Elf.ukx/DarkElf.ukx are higher-GRADE sets
# (Devotion etc.), not the level-1 mystic outfit.
PACKAGE_FALLBACK = {  # (race, gender, mage) -> package used for hair assets
    "elf":     {"mage": {"male": "melf",     "female": "felf"}},
    "darkelf": {"mage": {"male": "mdarkelf", "female": "fdarkelf"}},
}

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
    """15 records x 30 int32 = 15 slots of (meshIndex, textureIndex)."""
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


def umodel_list(package: str):
    out = subprocess.run([UMODEL, "-game=l2", "-list",
                          os.path.join(SYSTEX_DIR, package + ".utx")],
                         check=True, capture_output=True, text=True).stdout
    return out


def hair_assets(package: str):
    """Distinct hair mesh indices (mXXX) and color indices (tYY) in a package."""
    meshes, colors = set(), set()
    for m in re.finditer(r"Texture\s+\S*?_(m\d{3})_(t\d+)_m00_(?:a|b)h(?:_ori)?\b",
                         umodel_list(package)):
        meshes.add(m.group(1))
        colors.add(m.group(2))
    return sorted(meshes), sorted(colors)


def export_texture(package: str, texname: str, outdir: str) -> str:
    subprocess.run([UMODEL, "-game=l2", "-export", "-out=" + outdir,
                    os.path.join(SYSTEX_DIR, package + ".utx"), texname],
                   check=True, capture_output=True)
    hits = glob.glob(os.path.join(outdir, package, "Texture", texname + ".tga"))
    assert hits, f"umodel did not export {package}/{texname}"
    return hits[0]


def tga_avg_hex(path: str) -> str:
    """Average RGB of opaque pixels of an uncompressed/RLE truecolor TGA."""
    with open(path, "rb") as f:
        hdr = f.read(18)
        idlen, imgtype = hdr[0], hdr[2]
        w, h = struct.unpack("<HH", hdr[12:16])
        step = hdr[16] // 8
        f.seek(18 + idlen)
        raw = f.read()
    if imgtype == 2:
        data = raw
    elif imgtype == 10:
        data = bytearray()
        i = 0
        while i < len(raw) and len(data) < w * h * step:
            c = raw[i]; i += 1
            n = (c & 0x7F) + 1
            if c & 0x80:
                data += raw[i:i + step] * n; i += step
            else:
                data += raw[i:i + step * n]; i += step * n
    else:
        raise ValueError(f"{path}: unsupported TGA type {imgtype}")
    tr = tg = tb = tn = 0
    for i in range(0, min(len(data), w * h * step), step):
        a = data[i + 3] if step == 4 else 255
        if a > 128:
            tb += data[i]; tg += data[i + 1]; tr += data[i + 2]; tn += 1
    assert tn, f"{path}: no opaque pixels"
    return f"#{tr // tn:02x}{tg // tn:02x}{tb // tn:02x}"


def sample_hair_colors(package: str, mesh: str, suffix: str, outdir: str):
    """Average color of the t00-t03 hair textures of one style mesh."""
    colors = []
    for t in ("t00", "t01", "t02", "t03"):
        tex = f"{TEX_PREFIX[package]}_{mesh}_{t}_m00_{suffix}"
        colors.append(tga_avg_hex(export_texture(package, tex, outdir)))
    return colors


# Texture names inside a package use the class-model prefix, not the file name.
TEX_PREFIX = {
    "MFighter": "MFighter", "FFighter": "FFighter",
    "MMagic": "MMagic", "FMagic": "FMagic",
    "melf": "MElf", "felf": "FElf",
    "mdarkelf": "MDarkElf", "fdarkelf": "FDarkElf",
    "MOrc": "MOrc", "FOrc": "FOrc",
    "MShaman": "MShaman", "FShaman": "FShaman",
    "mdwarf": "MDwarf", "fdwarf": "FDwarf",
}

# Representative style mesh + suffix used to sample hair colors per race.
# _ah_ori = attached-hair texture, _bh = painted-on head texture.
COLOR_SAMPLE = {
    "human":   ("MFighter",  "m000", "ah_ori"),
    "elf":     ("melf",      "m000", "ah_ori"),
    "darkelf": ("mdarkelf",  "m001", "ah_ori"),
    "orc":     ("MOrc",      "m000", "bh"),
    "dwarf":   ("mdwarf",    "m000", "bh"),
}


def parse_acis_class(filename: str):
    with open(os.path.join(CLASSES_DIR, filename + ".xml")) as f:
        x = f.read()
    cid = int(re.search(r'<set id="(\d+)"', x).group(1))
    m = re.search(r'<set str="(\d+)" con="(\d+)" dex="(\d+)" int="(\d+)" '
                  r'wit="(\d+)" men="(\d+)"/>', x)
    str_, con, dex, int_, wit, men = map(int, m.groups())
    return cid, {"STR": str_, "DEX": dex, "CON": con,
                 "INT": int_, "WIT": wit, "MEN": men}


def main():
    workdir = tempfile.mkdtemp(prefix="l2charcreate_")
    print("decrypting .dat files ...")
    chargrp = parse_chargrp(decrypt("chargrp.dat", workdir))
    hairgrp = parse_hairgrp(decrypt("hairgrp.dat", workdir))
    classinfo = parse_classinfo(decrypt("classinfo-e.dat", workdir))
    print(f"  chargrp: {len(chargrp)} records (+padding), "
          f"hairgrp: {len(hairgrp)} records, classinfo: {len(classinfo)} entries")

    # Per (race, gender, type) appearance from hairgrp + umodel cross-check.
    print("listing systextures packages with umodel ...")
    appearance = {}   # race -> gender -> type -> info
    assets = {}       # race -> gender -> type -> chargrp asset refs
    for i, (race, gender, ctype, pkg) in enumerate(CHARGRP_RECORDS):
        rec = chargrp[i]
        slots = hairgrp[i]
        style_slots = [(k, m, t) for k, (m, t) in enumerate(slots[:7])
                       if t != -1]
        meshes, colors = hair_assets(pkg)
        # style id = mesh index when an attached hair mesh exists, else the
        # texture index (painted-on hair, no mesh)
        style_meshes = ["m%03d" % (m if m != -1 else t)
                        for k, m, t in style_slots]
        # cross-check hairgrp against the real package contents
        missing = [m for m in style_meshes if m not in meshes]
        if missing:
            print(f"  WARNING {pkg}: hairgrp meshes {missing} not in package")
        appearance.setdefault(race, {}).setdefault(gender, {})[ctype] = {
            "hairStyles": len(style_slots),
            "styleMeshes": style_meshes,
            "paintedOnly": ["m%03d" % t for k, m, t in style_slots if m == -1],
            "attachedMesh": ["m%03d" % m for k, m, t in style_slots if m != -1],
            "hairColorCount": len(colors),
            "package": pkg + ".utx",
        }
        assets.setdefault(race, {}).setdefault(gender, {})[ctype] = {
            "faceIcon": "sek." + rec["face_icon"].split(".", 1)[1]
                        if "." in rec["face_icon"] else rec["face_icon"],
            "faceMesh": rec["face_mesh"],
            "faceTextures": rec["face_texture"],
            "bodyMeshes": rec["body_mesh"],
            "bodyTextures": rec["body_texture"],
            "animationPackage": pkg_animation(rec),
        }
        print(f"  {pkg:<10} styles={len(style_slots)} {style_meshes} "
              f"colors={len(colors)} faces={len(rec['face_texture'])}")

    # Elf/Dark Elf mage appearance = same race package (no own chargrp record).
    for race in ("elf", "darkelf"):
        for gender in ("male", "female"):
            pkg = PACKAGE_FALLBACK[race]["mage"][gender]
            meshes, colors = hair_assets(pkg)
            fighter_app = appearance[race][gender]["fighter"]
            appearance[race][gender]["mage"] = {
                "hairStyles": fighter_app["hairStyles"],
                "styleMeshes": fighter_app["styleMeshes"],
                "paintedOnly": [],
                "attachedMesh": fighter_app["attachedMesh"],
                "hairColorCount": len(colors),
                "package": pkg + ".utx",
            }

    print("sampling hair color hex values ...")
    race_colors = {}
    for race, (pkg, mesh, suffix) in COLOR_SAMPLE.items():
        race_colors[race] = sample_hair_colors(pkg, mesh, suffix, workdir)
        print(f"  {race:<8} {race_colors[race]}")

    out = {"races": []}
    for race in ("human", "elf", "darkelf", "orc", "dwarf"):
        classes = []
        for cid, name, ctype, acis_file, classinfo_id in CLASS_DEFS[race]:
            official_id, stats = parse_acis_class(acis_file)
            classes.append({
                "id": cid,
                "name": name,
                "type": ctype,
                "classId": official_id,
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
                "faces": 3,
                "hairStyles": max(app[g][t]["hairStyles"]
                                  for g in app for t in app[g]),
                "hairColors": race_colors[race],
            },
            # EXTRA (documented in docs/dat-format-notes.md): full-fidelity
            # per-gender/per-class data and raw asset references.
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
