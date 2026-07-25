#!/usr/bin/env python3
"""Extract the Lineage 2 Interlude gameplay .dat files into JSON.

Output: assets/gamedata/<name>.json, one file per decoded .dat.

Data sources (all real, in this repo):
  - assets/interlude/system/npcgrp.dat        -> npcgrp.json      (NPC visuals)
  - assets/interlude/system/NpcName-e.dat     -> npcname.json     (NPC names)
  - assets/interlude/system/armorgrp.dat      -> armorgrp.json    (armor visuals/stats)
  - assets/interlude/system/weapongrp.dat     -> weapongrp.json   (weapon visuals/stats)
  - assets/interlude/system/etcitemgrp.dat    -> etcitemgrp.json  (misc item visuals)
  - assets/interlude/system/ItemName-e.dat    -> itemname.json    (item names/descs)
  - assets/interlude/system/skillgrp.dat      -> skillgrp.json    (skill visuals/timing)
  - assets/interlude/system/skillname-e.dat   -> skillname.json   (skill names/descs)
  - assets/interlude/system/actionname-e.dat  -> actionname.json  (UI actions)
  - assets/interlude/system/sysstring-e.dat   -> sysstring.json   (UI strings)
  - assets/interlude/system/systemmsg-e.dat   -> systemmsg.json   (system messages)

Field layouts follow the L2ClientDat (majestic-world) Interlude definitions
(dist/data/structure/06_interlude.xml + dats/*.xml, "Interlude"/"ScionsOfDestiny"
patterns). Unknown/unmapped fields are preserved as unk_N / junk entries rather
than dropped. See docs/dat-format-notes.md for per-file field documentation
including which fields are verified vs guessed.
"""

import json
import os
import struct
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from l2dat import Reader  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SYSTEM_DIR = os.path.join(ROOT, "assets", "interlude", "system")
L2ENCDEC = os.path.join(ROOT, "tools", "bin", "l2encdec")
OUT_DIR = os.path.join(ROOT, "assets", "gamedata")

TRAILER = b"\x0cSafePackage\x00"  # ASCF EOF marker in every .dat


def decrypt(name: str, outdir: str) -> bytes:
    out = os.path.join(outdir, name + ".dec")
    subprocess.run([L2ENCDEC, "-c", "decode", "-p", "413", "-o", out,
                    os.path.join(SYSTEM_DIR, name)],
                   check=True, capture_output=True)
    with open(out, "rb") as f:
        return f.read()


def open_dat(data: bytes, label: str) -> Reader:
    assert data.endswith(TRAILER), f"{label}: missing SafePackage trailer"
    return Reader(data[:-len(TRAILER)], label)


def read_mtx(r: Reader):
    """MTX definition: INT mesh count + UNICODE meshes, INT tex count +
    UNICODE textures (L2ClientDat dist/data/definitions.xml)."""
    meshes = [r.ustr() for _ in range(r.i32())]
    textures = [r.ustr() for _ in range(r.i32())]
    return {"meshes": meshes, "textures": textures}


def read_ustr_list(r: Reader):
    return [r.ustr() for _ in range(r.u32())]


def read_uint_list(r: Reader):
    return [r.u32() for _ in range(r.u32())]


def read_rgba(r: Reader) -> str:
    """RGBA: 4 bytes A,R,G,B -> 'AARRGGBB' hex string."""
    a, red, g, b = r.u8(), r.u8(), r.u8(), r.u8()
    return f"{a:02X}{red:02X}{g:02X}{b:02X}"


# ---------------------------------------------------------------------------
# Per-file parsers. Each returns a list of record dicts, except
# parse_systemmsg which returns an id -> record map.
# ---------------------------------------------------------------------------

def parse_npcgrp(data: bytes):
    r = open_dat(data, "npcgrp.dat")
    records = []
    for _ in range(r.u32()):
        rec = {
            "npc_id": r.u32(),
            "class_name": r.ustr(),
            "mesh_name": r.ustr(),
            "textures": read_ustr_list(r),
            "textures_second": read_ustr_list(r),
            "property_list": [r.u32() for _ in range(r.compact_int())],
            "npc_speed": r.f32(),
            "unk_1": read_ustr_list(r),          # unknown string list
            "attack_sound": read_ustr_list(r),
            "defense_sound": read_ustr_list(r),
            "damage_sound": read_ustr_list(r),
            "deco_effect": [
                {"effect": r.ustr(), "scale": r.f32()}
                for _ in range(r.u32())
            ],
            "unk_2": [r.u32() for _ in range(r.compact_int())],  # unknown ints
            "attack_effect": r.ustr(),
            "unk_3": r.u32(),
            "sound_vol": r.f32(),
            "sound_radius": r.f32(),
            "sound_random": r.f32(),
            "quest_be": r.u32(),
            "class_lim": r.u32(),
        }
        records.append(rec)
    assert r.done(), f"npcgrp: {len(data) - r.pos} bytes left"
    return records


def parse_npcname(data: bytes):
    r = open_dat(data, "NpcName-e.dat")
    records = []
    for _ in range(r.u32()):
        records.append({
            "id": r.u32(),
            "name": r.ascf(),
            "nick": r.ascf(),
            "nickcolor": read_rgba(r),
        })
    assert r.done()
    return records


ITEM_RACE_SLOTS = [
    "m_HumnFigh", "m_HumnFigh_add", "f_HumnFigh", "f_HumnFigh_add",
    "m_DarkElf", "m_DarkElf_add", "f_DarkElf", "f_DarkElf_add",
    "m_Dorf", "m_Dorf_add", "f_Dorf", "f_Dorf_add",
    "m_Elf", "m_Elf_add", "f_Elf", "f_Elf_add",
    "m_HumnMyst", "m_HumnMyst_add", "f_HumnMyst", "f_HumnMyst_add",
    "m_OrcFigh", "m_OrcFigh_add", "f_OrcFigh", "f_OrcFigh_add",
    "m_OrcMage", "m_OrcMage_add", "f_OrcMage", "f_OrcMage_add",
    "Unknown_MT", "NPC", "AAC",
]


def read_item_header(r: Reader):
    """Shared item header: drop visuals, icons, common props (grp files)."""
    return {
        "tag": r.u32(),
        "object_id": r.u32(),
        "drop_type": r.u32(),
        "drop_anim_type": r.u32(),
        "drop_radius": r.u32(),
        "drop_height": r.u32(),
        "unk_0": r.u32(),
        "drop_mesh": [r.ustr() for _ in range(3)],
        "drop_texture": [r.ustr() for _ in range(3)],
        "icon": [r.ustr() for _ in range(5)],
    }


def parse_armorgrp(data: bytes):
    r = open_dat(data, "armorgrp.dat")
    records = []
    for _ in range(r.u32()):
        rec = read_item_header(r)
        rec.update({
            "durability": r.i32(),
            "weight": r.u32(),
            "material_type": r.u32(),
            "crystallizable": r.u32(),
            "unk_1": r.u32(),
            "body_part": r.u32(),
            "race_slots": {slot: read_mtx(r) for slot in ITEM_RACE_SLOTS},
            "attack_effect": r.ustr(),
            "item_sound": read_ustr_list(r),
            "drop_sound": r.ustr(),
            "equip_sound": r.ustr(),
            "unk_2": r.u32(),
            "unk_3": r.u32(),
            "armor_type": r.u32(),
            "crystal_type": r.u32(),
            "avoid_mod": r.u32(),
            "pdef": r.u32(),
            "mdef": r.u32(),
            "mpbonus": r.u32(),
        })
        records.append(rec)
    assert r.done()
    return records


def parse_weapongrp(data: bytes):
    r = open_dat(data, "weapongrp.dat")
    records = []
    for _ in range(r.u32()):
        rec = read_item_header(r)
        rec.update({
            "durability": r.i32(),
            "weight": r.u32(),
            "material_type": r.u32(),
            "crystallizable": r.u32(),
            "property_params": r.u32(),
            "body_part": r.u32(),
            "handness": r.u32(),
        })
        meshes = read_ustr_list(r)
        rec["mesh"] = meshes
        rec["texture"] = read_ustr_list(r)
        rec["item_sound"] = read_ustr_list(r)
        rec.update({
            "drop_sound": r.ustr(),
            "equip_sound": r.ustr(),
            "effect": r.ustr(),
            "random_damage": r.u32(),
            "patt": r.u32(),
            "matt": r.u32(),
            "weapon_type": r.u32(),
            "crystal_type": r.u32(),
            "critical": r.u32(),
            "hit_mod": r.i32(),
            "avoid_mod": r.i32(),
            "shield_pdef": r.u32(),
            "shield_rate": r.u32(),
            "speed": r.u32(),
            "mp_consume": r.u32(),
            "soulshot_count": r.u32(),
            "spiritshot_count": r.u32(),
            "curvature": r.u32(),
            "unk_1": r.u32(),
            "can_equip_hero": r.i32(),
            "unk_2": r.u32(),
            "effect_a": r.ustr(),
        })
        dual = len(meshes) == 2
        if dual:
            rec["effect_b"] = r.ustr()
        rec["junk_1a"] = [r.f32() for _ in range(5)]
        if dual:
            rec["junk_1b"] = [r.f32() for _ in range(5)]
        rec["range_a"] = r.ustr()
        if dual:
            rec["range_b"] = r.ustr()
        rec["junk_2a"] = [r.f32() for _ in range(6)]
        if dual:
            rec["junk_2b"] = [r.f32() for _ in range(6)]
        rec["junk_3"] = [r.i32() for _ in range(4)]
        rec["variation_icon"] = [r.ustr() for _ in range(4)]
        records.append(rec)
    assert r.done()
    return records


def parse_etcitemgrp(data: bytes):
    r = open_dat(data, "etcitemgrp.dat")
    records = []
    for _ in range(r.u32()):
        rec = read_item_header(r)
        rec.update({
            "durability": r.u32(),
            "weight": r.u32(),
            "material_type": r.u32(),
            "crystallizable": r.u32(),
            "type1": r.u32(),
            "mesh_tex_pair": read_mtx(r),
            "drop_sound": r.ustr(),
            "equip_sound": r.ustr(),
            "stackable": r.u32(),
            "etcitem_type": r.u32(),
            "crystal_type": r.u32(),
        })
        records.append(rec)
    assert r.done()
    return records


def parse_itemname(data: bytes):
    r = open_dat(data, "ItemName-e.dat")
    records = []
    for _ in range(r.u32()):
        records.append({
            "id": r.u32(),
            "name": r.ustr(),
            "additional_name": r.ustr(),
            "description": r.ascf(),
            "popup": r.i32(),
            "set_ids": r.ascf(),
            "set_bonus_desc": r.ascf(),
            "set_extra_id": r.ascf(),
            "set_extra_desc": r.ascf(),
            "unk_1": r.u8(),
            "unk_2": r.u8(),
            "set_enchant_count": r.u32(),
            "set_enchant_effect": r.ascf(),
        })
    assert r.done()
    return records


def parse_skillgrp(data: bytes):
    r = open_dat(data, "skillgrp.dat")
    records = []
    for _ in range(r.u32()):
        records.append({
            "skill_id": r.u32(),
            "skill_level": r.u32(),
            "operate_type": r.u32(),
            "mp_consume": r.u32(),
            "cast_range": r.u32(),
            "cast_style": r.u32(),
            "hit_time": r.f32(),
            "is_magic": r.u32(),
            "animation": r.ustr(),
            "description": r.ustr(),
            "icon": r.ustr(),
            "extra_eff": r.u32(),
            "is_enchanted": r.u32(),
            "enchant_skill_id": r.u32(),
            "hp_consume": r.u32(),
            "rumble_self": r.u32(),
            "rumble_target": r.u32(),
        })
    assert r.done()
    return records


def parse_skillname(data: bytes):
    r = open_dat(data, "skillname-e.dat")
    records = []
    for _ in range(r.u32()):
        records.append({
            "skill_id": r.u32(),
            "skill_level": r.u32(),
            "name": r.ascf(),
            "desc": r.ascf(),
            "enchant_name": r.ascf(),
            "enchant_desc": r.ascf(),
        })
    assert r.done()
    return records


def parse_actionname(data: bytes):
    r = open_dat(data, "actionname-e.dat")
    records = []
    for _ in range(r.u32()):
        records.append({
            "tag": r.u32(),
            "id": r.u32(),
            "type": r.i32(),
            "category": r.u32(),
            "category2": [r.i32() for _ in range(r.compact_int())],
            # NOTE: L2ClientDat labels these cmd/icon/name/desc, but against
            # the real Interlude file the 3 ASCFs are clearly name/icon/desc
            # and the trailing UNICODE is the slash command (e.g. 'sitstand').
            "name": r.ascf(),
            "icon": r.ascf(),
            "desc": r.ascf(),
            "cmd": r.ustr(),
        })
    assert r.done()
    return records


def parse_sysstring(data: bytes):
    r = open_dat(data, "sysstring-e.dat")
    records = []
    for _ in range(r.u32()):
        records.append({
            "id": r.u32(),
            "string": r.ascf(),
        })
    assert r.done()
    return records


def _looks_like_sysmsg_record(buf: bytes, p: int, expect_id: int) -> bool:
    """Probe: does buf[p:] start a systemmsg record with id == expect_id?

    Checked against the first records of the real file: id u32, group u32
    (small, 1 everywhere seen), then a printable ASCF message."""
    if p + 9 > len(buf):
        return False
    if struct.unpack_from("<I", buf, p)[0] != expect_id:
        return False
    if struct.unpack_from("<I", buf, p + 4)[0] > 20:  # group
        return False
    try:
        text = Reader(buf[p + 8:], "systemmsg-probe").ascf()
    except (EOFError, ValueError, UnicodeDecodeError):
        return False
    return all(ord(c) >= 32 for c in text)


def _find_next_sysmsg_record(buf: bytes, start: int, prev_id: int) -> tuple:
    """Locate the record following prev_id. Ids are mostly sequential but have
    genuine gaps (e.g. 2048-2050 do not exist), and tails can embed u32s that
    mimic a record header (record 1's tail holds an extra message string), so:
    for each candidate id prev_id+1, prev_id+2, ... find the first valid
    header position; return the candidate with the earliest position."""
    best = None
    for cand in range(prev_id + 1, prev_id + 65):
        needle = struct.pack("<I", cand)
        p = buf.find(needle, start)
        while p != -1:
            if _looks_like_sysmsg_record(buf, p, cand):
                if best is None or p < best[0]:
                    best = (p, cand)
                break
            p = buf.find(needle, p + 1)
        if best is not None and best[1] == prev_id + 1:
            break  # exact successor found; can't do better
    if best is None:
        raise ValueError(f"systemmsg-e.dat: cannot locate record after "
                         f"id {prev_id} from offset {start}")
    return best


def parse_systemmsg(data: bytes):
    """systemmsg-e.dat: count u32, then records keyed by a u32 id (mostly
    sequential from 0, but with genuine gaps, e.g. 2048-2050 do not exist):
    [id u32, group u32, message ascf, unk_0 u32, color u32 (RGBA as AARRGGBB)]
    followed by a variable-length tail (sound name, param-type strings,
    zero-filled reserved blocks) that is not needed here and is skipped by
    scanning for the next record header. Verified on ids 0-13 against aCis
    SystemMessageId.java; see docs/dat-format-notes.md."""
    r = open_dat(data, "systemmsg-e.dat")
    buf = r.data
    records = {}
    count = r.u32()
    for i in range(count):
        rid = r.u32()
        group = r.u32()
        text = r.ascf()
        r.u32()  # unk_0: 2 for ids 0-1, 0 afterwards
        color = r.u32()
        records[str(rid)] = {
            "text": text,
            "group": group,
            "color": f"#{color & 0xFFFFFF:06X}",
        }
        if i < count - 1:
            r.pos, _ = _find_next_sysmsg_record(buf, r.pos, rid)
        else:
            r.pos = len(buf)  # last record's tail runs to the trailer
    assert r.done()
    assert len(records) == count, f"systemmsg: duplicate ids, {len(records)} != {count}"
    return records


FILES = [
    ("npcgrp.dat",        "npcgrp.json",      parse_npcgrp),
    ("NpcName-e.dat",     "npcname.json",     parse_npcname),
    ("armorgrp.dat",      "armorgrp.json",    parse_armorgrp),
    ("weapongrp.dat",     "weapongrp.json",   parse_weapongrp),
    ("etcitemgrp.dat",    "etcitemgrp.json",  parse_etcitemgrp),
    ("ItemName-e.dat",    "itemname.json",    parse_itemname),
    ("skillgrp.dat",      "skillgrp.json",    parse_skillgrp),
    ("skillname-e.dat",   "skillname.json",   parse_skillname),
    ("actionname-e.dat",  "actionname.json",  parse_actionname),
    ("sysstring-e.dat",   "sysstring.json",   parse_sysstring),
    ("systemmsg-e.dat",   "systemmsg.json",   parse_systemmsg),
]


def main():
    workdir = tempfile.mkdtemp(prefix="l2gamedata_")
    os.makedirs(OUT_DIR, exist_ok=True)
    summary = {}
    for dat_name, json_name, parser in FILES:
        records = parser(decrypt(dat_name, workdir))
        out_path = os.path.join(OUT_DIR, json_name)
        with open(out_path, "w") as f:
            json.dump(records, f, indent=1, ensure_ascii=False)
            f.write("\n")
        summary[json_name] = len(records)
        print(f"  {dat_name:<18} -> {json_name:<18} {len(records):>6} records")
    print("done.")
    return summary


if __name__ == "__main__":
    main()
