# L2 Interlude .dat format notes — character creation data

How the character-creation data matrix (`editor/characters/charcreate-data.json`)
was extracted from the real client files. Everything below was verified against
the client in `assets/interlude/` on this machine (July 2026).

Generator: `tools/dat/extract_charcreate.py` (stdlib-only Python 3.9, re-runnable).
Low-level binary reader: `tools/dat/l2dat.py`. Debug dumper: `tools/dat/parse_chargrp.py`.

## 1. Decryption

The `.dat` files in `assets/interlude/system/` carry the `Lineage2Ver413`
header (UTF-16LE) and are RSA-encrypted. `tools/bin/l2encdec` removes that layer:

```bash
tools/bin/l2encdec -c decode -p 413 -o /tmp/chargrp.dat.dec assets/interlude/system/chargrp.dat
```

Files used: `chargrp.dat`, `hairgrp.dat`, `classinfo-e.dat`.

## 2. Container format (after decryption)

Little-endian. Every file ends with the trailer `0x0C "SafePackage" 0x00`
(an ASCF string — see below) acting as an EOF marker; `l2asm`-style tools call
this the "safe package" marker. Primitive types:

| Type    | Encoding |
|---|---|
| `UINT`  | int32 LE |
| `UCHAR` | uint8 |
| `UNICODE` string | int32 LE **byte length** (exact, no NUL inside the length), then UTF-16LE payload. Empty string = length 0. |
| `ASCF` string | compact-int length **including a trailing NUL**, then cp1252 bytes. Compact int: first byte = sign (bit 7), 6 value bits, continuation flag (bit 6); each extra byte adds 7 bits. |

Gotcha found while writing the parser: `UNICODE` lengths are byte counts and
are *not* NUL-terminated — do not scan for `00 00`.

## 3. chargrp.dat — per race/gender/class appearance (14 records + padding)

**No record-count header.** The file is a fixed sequence of 15 records read
until EOF; record 15 is all-zero padding, then the `SafePackage` trailer. The
schema is the "ScionsOfDestiny" one — confirmed both against community
definitions (L2Miko/L2FileEdit `DAT_defs/Interlude/chargrp.ddf`,
majestic-world/L2ClientDat `dats/chargrp.xml`) and byte-by-byte against our file.

Record layout:

```
face_icon        UNICODE          e.g. "SEK.cbui29" (icon in systextures/sek.utx)
cnt_hm           UINT             hair mesh count (always 1, default only)
cnt_ht           UINT             hair texture count (always 1)
cnt_fm           UINT             face mesh count (always 1)
cnt_ft           UINT             face texture count (always 3 -> the 3 creation faces)
hair_mesh[]      UNICODE x cnt_hm (same placeholder in every record; real hair table is hairgrp.dat)
hair_tex[]       UNICODE x cnt_ht
face_mesh[]      UNICODE x cnt_fm e.g. "Fighter.MFighter_m000_f"
face_tex[]       UNICODE x cnt_ft e.g. "MFighter.MFighter_m000_t00_f" (t00/t01/t02 = face A/B/C)
body_mesh[4]     UNICODE          creation outfit: upper/lower/gloves/boots
body_tex[4]      UNICODE
attack_effect    UNICODE
walkanimframe    UINT
cnt_att/def/dmg  UINT x3          NOTE: three counts first, THEN the three lists
snd_att[]        UNICODE x cnt_att
snd_def[]        UNICODE x cnt_def
snd_dmg[]        UNICODE x cnt_dmg
8x { UINT count; UNICODE strings[count] }   voice sets: hand, 1hs, 2hs, dual, pole, bow, unknown, fist
```

(The count-then-list-then-count reading of the sound block is the one bug I
hit and fixed: counts for all three sounds come first.)

The 14 real records, in file order:

| # | race | gender | class type | body mesh prefix | texture package |
|---|---|---|---|---|---|
| 0 | human | male | fighter | `Fighter.MFighter_*` | `MFighter.utx` |
| 1 | human | female | fighter | `Fighter.FFighter_*` | `FFighter.utx` |
| 2 | darkelf | male | fighter | `DarkElf.MDarkElf_*` | `mdarkelf.utx` |
| 3 | darkelf | female | fighter | `DarkElf.FDarkElf_*` | `fdarkelf.utx` |
| 4 | dwarf | male | fighter | `Dwarf.MDwarf_*` | `mdwarf.utx` |
| 5 | dwarf | female | fighter | `Dwarf.FDwarf_*` | `fdwarf.utx` |
| 6 | elf | male | fighter | `Elf.MElf_*` | `melf.utx` |
| 7 | elf | female | fighter | `Elf.FElf_*` | `felf.utx` |
| 8 | human | male | mage | `Magic.MMagic_*` | `MMagic.utx` |
| 9 | human | female | mage | `Magic.FMagic_*` | `FMagic.utx` |
| 10 | orc | male | fighter | `Orc.MOrc_*` | `MOrc.utx` |
| 11 | orc | female | fighter | `Orc.FOrc_*` | `FOrc.utx` |
| 12 | orc | male | mage | `Shaman.MShaman_*` | `MShaman.utx` |
| 13 | orc | female | mage | `Shaman.FShaman_*` | `FShaman.utx` |

Notable: there are **no elf/dark-elf mage records**. Those classes reuse the
race fighter models (robe textures are selected client-side) and the race hair
package — consistent with `systextures/` having no `MElfMystic`-style packages.

Reliable: faces = 3 per race/gender (`face_tex` count, universal), creation
outfit meshes/textures, face icon names.

## 4. hairgrp.dat — hair style table (15 records of 120 bytes)

Schema per L2Miko/L2FileEdit `DAT_defs/Interlude/hairgrp.ddf`: 15 records
(same order as chargrp), each 120 bytes = 6 meshes × 10 colors × 2 CHARs. Read
as int32 LE it is much clearer: **30 int32 = 15 slots of
`(meshIndex, textureIndex)`**, `-1` = absent.

Interpretation verified against the actual texture packages (`umodel -list` on
each `systextures/*.utx`):

- Slots 0-6 = the selectable hair **styles**. Slot is valid when
  `textureIndex != -1`. Every male record has 5 valid slots, every female
  record 7 — these are the creation UI hair style counts.
- `meshIndex != -1` → the style has an attached hair mesh (textures named
  `<Prefix>_mXXX_tYY_m00_ah_ori` in the package, e.g. `MFighter_m001_t02_m00_ah_ori`).
- `meshIndex == -1` → painted-on style, no mesh (`..._bh` head textures).
  Example: human male fighter style 3 (`m003`) is painted-only; orc/dwarf
  styles are almost all painted.
- Slots 8 and 9 (`m008`, `m009` textures) exist in **every** record and
  package — universal extra head textures (most likely eyebrow/overlay
  layers). Not exposed as creation choices; documented here only.
- Hair **colors**: 4 per style, suffixes `t00`-`t03` in the hair texture
  names, uniform across all races/genders.

Cross-check results (no mismatches): hairgrp mesh indices match the `mXXX`
suffixes present in each package, e.g. `mdarkelf.utx` has attached-hair
textures for `m001`, `m003`, `m004` = exactly hairgrp's mesh slots for dark
elf male; `MFighter.utx` has `m000,m001,m002,m004` attached + `m003` painted.

## 5. classinfo-e.dat — class descriptions

Trivial format: `UINT count` (10), then per record `UINT id; ASCF description`.
Id 0 is the UI placeholder ("Select a race and occupation."); ids 1-9 are the
9 creation classes in order: Human Fighter, Human Mystic, Elven Fighter,
Elven Mystic, Dark Fighter, Dark Mystic, Orc Fighter, Orc Mystic, Dwarven
Fighter. The texts are the flavor quotes + gameplay summary shown on the
creation screen (verified by content, e.g. id 8 "In the name of the eternal
fire…" = Orc Mystic).

## 6. Base stats — NOT in the client

The Interlude client carries no STR/DEX/CON/INT/WIT/MEN tables (the
`classinfo` stat fields only exist in Awakening+ clients). `baseStats` in the
JSON comes from the server side of this repo,
`server/aCis_datapack/data/xml/classes/*.xml` (aCis = retail-like Interlude
values), together with the official class ids (0, 10, 18, 25, 31, 38, 44, 49,
53). This is the one piece of the JSON not extracted from the client itself.

## 7. Hair color hex values — sampled, approximate

L2 stores hair colors as textures, not RGB values. The `hairColors` hex list
is the **average of the opaque pixels** of one exported hair texture per color
slot (`t00`-`t03`), sampled from the male package of each race
(`MFighter`/`melf`/`mdarkelf` `_ah_ori`; `MOrc`/`mdwarf` `_bh`). Textures
include shading and some scalp/skin bleed, so treat these as representative
swatches, not exact palette entries.

## 8. JSON extras beyond the frozen schema

`charcreate-data.json` follows the frozen schema (`races[].id/name/genders/
classes[].id/name/type/baseStats`, `appearance.faces/hairStyles/hairColors`)
and adds two documented blocks:

- `races[].appearanceDetail`: per gender → per class type:
  `hairStyles` (count), `styleMeshes` (mXXX ids), `attachedMesh` /
  `paintedOnly` split, `hairColorCount`, source `package`.
  Race-level `appearance.hairStyles` is the max over these (7 everywhere).
- `races[].creationAssets`: per gender → per class type: the raw chargrp
  references (`faceMesh`, `faceTextures`, `bodyMeshes`, `bodyTextures`,
  `faceIcon`, `animationPackage`) — the exact `.ukx` model and `.utx` texture
  names the 3D preview needs. Only races with their own chargrp records
  appear here (elf/darkelf mage records do not exist; reuse the fighter
  assets of the same race+gender).
- `classes[].classId` (official L2 class id) and `classes[].description`
  (classinfo-e.dat text) are also extras.

## 9. Reliability summary

| Data | Source | Confidence |
|---|---|---|
| 5 races / 9 classes / genders | chargrp record order + classinfo ids | verified |
| faces = 3 | chargrp `face_tex` count, all 14 records | verified |
| hair styles 5 (m) / 7 (f) | hairgrp slots 0-6, cross-checked vs packages | verified |
| attached vs painted styles | hairgrp meshIndex vs package `mXXX` lists | verified, no mismatches |
| hair colors = 4 | texture suffixes t00-t03 in every package | verified |
| hair color hex | average of exported hair texture pixels | approximate (see §7) |
| class descriptions | classinfo-e.dat ids 1-9 | verified (mapped by content) |
| baseStats / classId | aCis server XML, not the client | retail-like, see §6 |
| m008/m009 meaning | universal in hairgrp/packages | guessed (eyebrow/overlay) |

## References

- L2Miko/L2FileEdit `data/l2asm-disasm/DAT_defs/Interlude/{chargrp,hairgrp,classinfo-e}.ddf`
- majestic-world/L2ClientDat `dist/data/structure/dats/chargrp.xml` (ScionsOfDestiny block) and `ByteReader.java`
- Project toolchain: `docs/assets-tooling.md`

---

# Part II — Gameplay data files (assets/gamedata/)

Decoder: `tools/dat/extract_gamedata.py` → `assets/gamedata/*.json`.
All files below: protocol 413/RSA wrapper (removed by `tools/bin/l2encdec`),
then a `UINT` record count, then fixed-layout records, then the
`\x0cSafePackage\x00` ASCF trailer. Every parser asserts exact byte
consumption, so a layout drift fails loudly instead of producing garbage.

Layout source: majestic-world/L2ClientDat `dist/data/structure/dats/*.xml`
(the variant pinned for each file by `06_interlude.xml`) +
`dist/data/definitions.xml` for composite readers. Two readers were not in
`l2dat.py` before and are implemented in `extract_gamedata.py`:

- `MTX` = `INT` mesh count + that many `UNICODE` meshes, then `INT` texture
  count + that many `UNICODE` textures.
- `RGBA` = 4 bytes in file order A,R,G,B → stored in JSON as `"AARRGGBB"`.

## 10. npcgrp.dat → npcgrp.json (6519 records)

Per NPC visual record:

| Field | Type | Status |
|---|---|---|
| npc_id | UINT | verified (6519 ids match npcname-e.dat ids 1:1) |
| class_name / mesh_name | UNICODE | verified (`LineageMonster.gremlin` / `LineageMonsters.gremlin_m00_wp`-style; mesh = animations .ukx ref) |
| textures / textures_second | UINT count + UNICODE list | verified (`LineageMonstersTex.gremlin_t00`); `textures_second` semantics guessed (alt/second texture set) |
| property_list | CNTR count + UINT list | guessed meaning (bitmask/property ids) |
| npc_speed | FLOAT | verified (multiplier, 1.0 typical) |
| unk_1 | UINT count + UNICODE list | unknown (usually empty) |
| attack_sound / defense_sound / damage_sound | UINT count + UNICODE list | verified names (e.g. `ItemSound.*`, monster voice refs) |
| deco_effect | UINT count of {UNICODE effect, FLOAT scale} | verified structurally; effect attach semantics guessed |
| unk_2 | CNTR count + UINT list | unknown |
| attack_effect | UNICODE | guessed (hit effect asset ref) |
| unk_3 | UINT | unknown |
| sound_vol / sound_radius / sound_random | FLOAT | verified (voice config, e.g. 1/30/10) |
| quest_be / class_lim | UINT | guessed (quest spawn flag / class limitation) |

## 11. NpcName-e.dat → npcname.json (6519 records)

`id` UINT, `name` ASCF, `nick` ASCF, `nickcolor` RGBA.
Verified: 30006 → `Roxxy` / `Gatekeeper` (matches aCis datapack), 18342 →
`Gremlin`. `nickcolor` = title color (AARRGGBB).

## 12. armorgrp.dat → armorgrp.json (1014 records)

Shared item header (also in weapongrp/etcitemgrp): `tag` UINT (always 1),
`object_id` UINT (= item id, joins itemname.json), `drop_type`,
`drop_anim_type`, `drop_radius`, `drop_height` UINT, `unk_0` UINT,
`drop_mesh`[3] UNICODE, `drop_texture`[3] UNICODE, `icon`[5] UNICODE
(verified: `icon.armor_t02_u_i00`).

Then: `durability` INT, `weight`, `material_type`, `crystallizable` UINT,
`unk_1` UINT, `body_part` UINT (verified: 10 = chest, matches aCis
`bodypart=chest`), then 31 MTX slots named in JSON `race_slots`
(m_HumnFigh … f_OrcMage_add + `Unknown_MT`, `NPC`, `AAC` — per
race/gender/class equipped mesh+texture lists), `attack_effect` UNICODE,
`item_sound` list, `drop_sound`, `equip_sound` UNICODE, `unk_2`/`unk_3`
UINT, `armor_type` UINT (verified: 1 = LIGHT on item 21), `crystal_type`,
`avoid_mod`, `pdef`, `mdef`, `mpbonus` UINT (verified: item 21 "Shirt"
pdef 36 matches aCis `pDef val="36"`).

## 13. weapongrp.dat → weapongrp.json (1313 records)

Shared item header, then: `durability` INT, `weight`, `material_type`,
`crystallizable`, `property_params`, `body_part`, `handness` UINT,
`mesh` list (UINT count + UNICODE; count 2 = dual weapon and unlocks the
`*_b` fields below), `texture` list, `item_sound` list, `drop_sound`,
`equip_sound`, `effect` UNICODE, `random_damage`, `patt`, `matt`,
`weapon_type`, `crystal_type` UINT, `critical` UINT, `hit_mod`/`avoid_mod`
INT, `shield_pdef`, `shield_rate`, `speed`, `mp_consume`, `soulshot_count`,
`spiritshot_count`, `curvature` UINT, `unk_1` UINT, `can_equip_hero` INT,
`unk_2` UINT, `effect_a` UNICODE (+ `effect_b` if dual), `junk_1a`[5] FLOAT
(+ `junk_1b` if dual), `range_a` UNICODE (+ `range_b` if dual),
`junk_2a`[6] FLOAT (+ `junk_2b` if dual), `junk_3`[4] INT,
`variation_icon`[4] UNICODE.

Verified: 2369 Squire's Sword → patt 6 / matt 5 / weapon_type 1 /
handness 1, icon `icon.weapon_squires_sword_i00`, mesh
`LineageWeapons.squires_sword_m00_wp`. `junk_*` blocks are per-mesh
positional/attachment data — layout verified (exact consumption incl. dual
branch), semantics unknown.

## 14. etcitemgrp.dat → etcitemgrp.json (6911 records)

Shared item header, then: `durability` UINT, `weight`, `material_type`,
`crystallizable`, `type1` UINT, `mesh_tex_pair` MTX, `drop_sound`,
`equip_sound` UNICODE, `stackable` UINT, `etcitem_type` UINT,
`crystal_type` UINT.

Verified: 1835 Soulshot: No Grade → icon `icon.etc_spirit_bullet_white_i00`.
`stackable` values observed 2/3 (adena 3, soulshot/potion 2) — enum
semantics guessed; kept raw.

## 15. ItemName-e.dat → itemname.json (9238 records)

`id` UINT, `name` UNICODE, `additional_name` UNICODE, `description` ASCF,
`popup` INT, `set_ids` ASCF, `set_bonus_desc` ASCF, `set_extra_id` ASCF,
`set_extra_desc` ASCF, `unk_1` UBYTE, `unk_2` UBYTE, `set_enchant_count`
UINT, `set_enchant_effect` ASCF.

Verified: 1835 → "Soulshot: No Grade" (matches aCis), 57 → "Adena",
1060 → "Lesser Healing Potion". Set-item fields (`set_*`) verified
structurally; `unk_1`/`unk_2` unknown.

## 16. skillgrp.dat → skillgrp.json (29812 records = skill id × level)

`skill_id` UINT, `skill_level` UINT, `operate_type` UINT, `mp_consume`
UINT, `cast_range` UINT, `cast_style` UINT, `hit_time` FLOAT, `is_magic`
UINT, `animation` UNICODE, `description` UNICODE, `icon` UNICODE,
`extra_eff` UINT, `is_enchanted` UINT, `enchant_skill_id` UINT,
`hp_consume` UINT, `rumble_self` UINT, `rumble_target` UINT.

Verified: (3,1) Power Strike → mp 10, range 40, hit_time 1.08, is_magic 0,
icon `icon.skill0003` (skill id 3 = Power Strike confirmed vs aCis).
Record count matches skillname-e.dat 1:1. `extra_eff`, `cast_style`,
`rumble_*` semantics guessed; values kept raw.

## 17. skillname-e.dat → skillname.json (29812 records)

`skill_id` UINT, `skill_level` UINT, `name` ASCF, `desc` ASCF,
`enchant_name` ASCF, `enchant_desc` ASCF.
Verified: (3,1) → "Power Strike" + official description text.

## 18. actionname-e.dat → actionname.json (102 records)

`tag` UINT, `id` UINT, `type` INT, `category` UINT, `category2` (CNTR
count + INT list), `name` ASCF, `icon` ASCF, `desc` ASCF, `cmd` UNICODE.

NOTE: the L2ClientDat schema labels the four trailing strings
cmd/icon/name/desc, but against the real file the order is clearly
name/icon/desc/cmd — record 0 parses as name `Sit/Stand`, icon
`icon.action001`, desc `Toggle Sit/Stand. (/sit, /stand)`, cmd `sitstand`.
Verified on all 102 records (slash commands all parse as clean lowercase
ASCII keywords in `cmd`).

## 19. sysstring-e.dat → sysstring.json (2083 records)

`id` UINT, `string` ASCF. Verified: 1 → "Equipment", 100 → "Social",
300 → "Dwarven Fighter". This is the core English UI string corpus.

## 20. Reliability summary (gameplay files)

| File | Records | Fields mapped | Unknown fields |
|---|---|---|---|
| npcgrp | 6519 | 15 | unk_1, unk_2, unk_3, property_list meaning, quest_be/class_lim semantics |
| npcname | 6519 | 4 | none |
| armorgrp | 1014 | 20 (+31 MTX slots) | unk_0..unk_3, Unknown_MT/AAC slot meaning |
| weapongrp | 1313 | 32 | unk_0..unk_2, junk_1/2/3 blocks, property_params, curvature |
| etcitemgrp | 6911 | 13 | unk_0, type1, stackable/etcitem_type enum values |
| itemname | 9238 | 11 | unk_1, unk_2 (UBYTE pair) |
| skillgrp | 29812 | 17 | extra_eff, cast_style, rumble_* semantics |
| skillname | 29812 | 6 | none |
| actionname | 102 | 10 | type/category/category2 enum values |
| sysstring | 2083 | 2 | none |
| systemmsg | 2083 | 4 (+skipped tail) | unk_0, tail contents (sounds/params/reserved) |

## 21. Icon + metadata layer (M4) — build_meta.py

`tools/dat/build_meta.py` generates the runtime-free metadata the web
client needs for the skill bar and inventory:

- `assets/gamedata/skillmeta.json` — `{ "<skillId>": { "name", "icon",
  "desc", "levels" } }`. Name/desc from `skillname.json`, icon from
  `skillgrp.json` (lowest-level entry per skill id; `levels` = max level).
- `assets/gamedata/itemmeta.json` — `{ "<itemId>": { "name", "icon",
  "type", "grade" } }`. Name from `itemname.json`; icon/type from
  weapongrp/armorgrp/etcitemgrp (`object_id` join); grade from
  `crystal_type` mapped `{0:NG, 1:D, 2:C, 3:B, 4:A, 5:S}`. Items present
  in itemname but no grp table are kept with `type: "etc"`, name only.
- `assets/gamedata/icons/*.png` — the referenced icons copied from
  `assets/library/icon/`, lowercased. Icon refs (`icon.<name>`) map to
  `<name>.png`.

Edge cases handled: the `ect_piece_of_paper_white_i00` ref is a
source-data typo (real texture `etc_piece_of_paper_white_i00`, verified
in icon.utx) and is aliased in the script; 5 skill icon refs
(skill1404, skill4712/4713/4717/4718) are dangling in the source data
(textures never shipped in icon.utx) — the icon field is dropped for
those entries (name/desc kept).

Re-run: `/usr/bin/python3 tools/dat/build_meta.py`; verify:
`/usr/bin/python3 tools/dat/build_meta.py --check` (fails if any
referenced icon path is missing on disk). Last run: 2694 skills, 9238
items, 2777 icons, 11901 refs, 0 missing.

## 22. systemmsg-e.dat → systemmsg.json (2083 records)

Decrypts with protocol **413** (like every other file here — protocol 121
produces garbage). Layout: `count` UINT, then that many records:

`id` UINT, `group` UINT, `message` ASCF, `unk_0` UINT, `color` UINT
(RGBA as AARRGGBB; emitted as `#RRGGBB`), then a variable-length tail
that is **skipped**: param-type strings (`none`, `server`, ...), an
optional sound name (e.g. `ItemSound3.sys_impossible`), zero-filled
reserved blocks (16/24/36 bytes), and — in record 1 — one extra embedded
message string (`Exit Game: $s1 second(s)`).

Because the tail length is not stored, the parser skips it by scanning
forward for the next record header (id UINT + small group + printable
ASCF). Ids are mostly sequential from 0 but have genuine gaps — 2048-2050,
2058-2085, 2087-2090, 2096-2107, 2111-2114, 2129-2131, 2136-2152 do not
exist — so the scan tries id+1, id+2, ... and takes the earliest valid
header (exact successor preferred; this also dodges false headers inside
tails, e.g. record 1's embedded string). Output shape differs from the
other files: a map `"<id>": {"text", "group", "color"}` since lookup is
always by id. Text keeps L2's `$s1`/`$c1` placeholders verbatim.

Verified against aCis `SystemMessageId.java`: 0 = "You have been
disconnected from the server.", 34 = `WELCOME_TO_LINEAGE` ("Welcome to
the World of Lineage II."), 52 = `EARNED_S1_ADENA` ("You have earned $s1
adena."), 53 = `EARNED_S2_S1_S`, 54 = `EARNED_ITEM_S1` ("You have earned
$s1."), 55 = `FAILED_TO_PICKUP_S1_ADENA`. Note: the older-chronicle
phrasing "$s1 has been added to your inventory." does not exist in
Interlude — id 54/30 ("You have earned/obtained $s1.") is the equivalent.
Stats: group = 1 for all 2083; colors: 2014× `#B09B79` (default), 30×
`#FFFF00` (loot/adena), 21× `#5AB0B2` (Seven Signs), 11× `#FED7A0`, 5×
`#FF0000`, 1× `#FF00FF`, 1× `#FF00F0`; no empty texts.

## 23. Skill weapon conditions — NOT in skillgrp.dat (aCis export instead)

skillgrp.dat has **no weapon-condition field**: all 17 decoded fields are
enumerated in §16, and the only opaque candidate, `cast_style`, cannot be a
weapon mask — Power Strike (id 3, retail: sword/blunt) and Mortal Blow
(id 16, retail: dagger) BOTH carry `cast_style` 3, while Double Shot
(id 19, bow) carries 8. There is no target-type field either:
`cast_range == -1` (0xFFFFFFFF) correlates with SELF-target skills but is
not one (47 SELF skills have a real range; 83 ONE-target skills have -1).

The retail gray-out / cast-block therefore sources from the server's skill
definitions, same pattern as `skilltypes.json`:

`tools/dat/export_skillweapons.py` reads the aCis XMLs and writes:

- `assets/gamedata/skillweapons.json` — `weapons: {skillId: [type names]}`
  from `<set name="weaponsAllowed" val="SWORD,BLUNT,..."/>` (112 skills),
  `targets: {skillId: name}` from `<set name="target" val="SELF|ONE|..."/>`
  (2654 skills). Semantics per aCis `L2Skill.java:309-342/:1048-1070`:
  absent = any weapon; otherwise the equipped weapon's type OR a left-hand
  shield must appear in the list (masks OR'd, then AND'd).
- `assets/gamedata/itemtypes.json` — `weapon: {itemId: type name}` (1218)
  from item XML `weapon_type`, `shield: {itemId: 1}` (95) from Armor items
  with `bodypart lhand` (Interlude has no `armor_type` field on shields).

Decode table (verified anchors, all matching retail):

| skill | weaponsAllowed | | item | type |
|---|---|---|---|---|
| 3 Power Strike | SWORD,BLUNT,BIGBLUNT,BIGSWORD | | 10 Dagger | DAGGER |
| 16 Mortal Blow | DAGGER | | 2369 Squire's Sword | SWORD |
| 263 Deadly Blow | DAGGER | | 14 Bow | BOW |
| 19 Double Shot | BOW | | 1299 Great Sword | DUAL (aCis quirk) |
| 410 Mortal Strike | DAGGER (target SELF, toggle) | | 18 Leather Shield | shield |

Distribution over the 112 restricted skills: DAGGER×24, DUAL×22,
DUALFIST×18, BOW×15, POLE×9, sword/blunt family×10, SHIELD×6, FIST×2, +3
mixed — no invented mask semantics, the raw name lists ship verbatim.

weapongrp.dat's own `weapon_type` enum was decoded for comparison
(0 shield, 1 sword, 2 blunt, 3 dagger, 4 pole, 5 fist, 6 bow, 7 etc/spellbook,
8 two-hand sword/dual, 10 fishing rod), but it conflates what the server
distinguishes: type 1 = SWORD *and* BIGSWORD, type 8 = DUAL *and* BIGSWORD,
fist weapons sit in types 0/5. A composite decode (weapon_type + body_part
7-vs-14 + mesh count 2 = dual) reproduces the server value for only
1153/1184 shared items (97.4%) — hero/shadow weapons break the body_part
heuristic, fist weapons the type heuristic — so the client consumes the
per-item server export, not the dat enum.

Cast interruption (client signal, aCis `CreatureCast.java`): a mid-cast
abort sends SystemMessage 27 `CASTING_INTERRUPTED` (or 748
`DIST_TOO_FAR_CASTING_STOPPED`) and ActionFailed via
`PlayerCast.stop → clientActionFailed`. The web client cancels the casting
bar on either signal. A rejected cast request answers ActionFailed +
SystemMessage 113 `S1_CANNOT_BE_USED` (`RequestMagicSkillUse.java`) — the
client-side gate keeps that packet from ever being sent, like retail.
