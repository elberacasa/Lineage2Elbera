#!/usr/bin/env python3
"""ElberaSkin — decode the retail ITEM TOOLTIP: field order, labels, formulas.

    python3 tools/ui/mine_itemtooltip.py            report
    python3 tools/ui/mine_itemtooltip.py --emit     write assets/gamedata/itemtooltip.json
    python3 tools/ui/mine_itemtooltip.py --check    re-derive, exit 1 on drift

WHY THIS EXISTS
---------------
"What does retail put in an item tooltip, in what order?" has an exact answer
on disk, and it is not a screenshot and not a guess. Two sources:

  1. `assets/uscript/Interface/Tooltip.uc` -- the client's OWN UnrealScript.
     The whole tooltip is built in script: NCTooltipManager::MakeTooltipInfo
     raises EV_RequestTooltipInfo with a `TooltipType` and a serialised
     ItemInfo, `Tooltip.uc:HandleRequestTooltipInfo` dispatches on the type,
     and `ReturnTooltip_NTT_ITEM` (uc:213-820) appends DrawItemInfo records
     in order and hands them back through the native `ReturnTooltipInfo`.
     So the FIELD ORDER is a straight-line read of that function, and this
     tool extracts it from the file rather than transcribing it.

  2. `assets/interlude/system/NWindow.dll` -- the natives that function calls
     (`NWindow/UIScript.uc:136-241` declares them `native final function`):
     GetItemGradeString, GetSlotTypeString, GetWeaponTypeString,
     GetAttackSpeedString, GetPhysicalDamage, GetMagicalDamage,
     GetPhysicalDefense, GetMagicalDefense, GetShieldDefense, IsMagicalArmor,
     IsStackableItem.  NWindow.dll is a plain unpacked PE32 (image base
     0x10000000, file offset == RVA -- gate 0 below), so each one is read with
     `objdump -d` exactly as tools/ui/mine_native_colors.py reads the colours.

THE KEY THAT UNLOCKS ALL THE LABELS
-----------------------------------
Every label in the tooltip is a SysString id, and the natives reference those
strings as raw offsets into one global blob, not as ids. `execGetSystemString`
gives the base:

    100f9ae2: 8d 04 40           lea  eax, [eax+eax*2]     ; id*3
    100f9ae5: 8b 0d 90 c7 22 10  mov  ecx, [0x1022c790]    ; string-table base
    100f9aeb: 8d 8c 81 dc a8 06  lea  ecx, [ecx+eax*4+0x6a8dc]

so  offset(id) = 0x6a8dc + id*12  (12 = sizeof FString: Data/Num/Max).
Two independent confirmations, both asserted below:
  * GetWeaponTypeString's first arm uses 0x6aae0 -> id 43 -> "Sword";
  * its eighth arm uses 0x6c07c -> id 504 -> "Double Blades".
A wrong base could not land both on the right words 461 ids apart.

WHAT IS *NOT* HERE, AND WHY THAT MATTERS
----------------------------------------
There is NO grade colouring of the item name. `AddTooltipItemName`
(uc:1847) sets no colour at all, and the grade is a separate 12x12 SYMBOL --
the string `GetItemGradeString` returns is "graded"/"gradec"/"gradeb"/
"gradea"/"grades", wrapped in backticks by `AddTooltipItemGrade` (uc:1887),
and the layout pass recognises exactly that shape:

    10146430: cmp eax, 8              ; Len(str) == 8, i.e. `xxxxxx`
    10146476: push 6 / push 1         ; Mid(1,6)
    10146497: mov ecx, [0x10350f70 + esi*4]  ; compare vs the grade table
    100656ee: mov eax, 0xc            ; -> 12 x 12

so a tinted item name would be an invention. Recorded as an explicit
`noGradeColouring` fact so nobody re-adds one.
"""

import argparse
import json
import os
import re
import struct
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DLL = os.path.join(REPO, "assets/interlude/system/NWindow.dll")
UC = os.path.join(REPO, "assets/uscript/Interface/Tooltip.uc")
SYSSTRING = os.path.join(REPO, "assets/gamedata/sysstring.json")
OUT = os.path.join(REPO, "assets/gamedata/itemtooltip.json")

IMAGE_BASE = 0x10000000
SYSSTR_BASE = 0x6A8DC       # decoded above, asserted in gate 1
SYSSTR_STRIDE = 12          # sizeof(FString)


# --------------------------------------------------------------------------
# PE / disassembly plumbing (same instrument as tools/ui/mine_native_colors.py)
# --------------------------------------------------------------------------

class Image:
    def __init__(self, path):
        with open(path, "rb") as f:
            self.d = f.read()

    def u32(self, rva):
        return struct.unpack_from("<I", self.d, rva)[0]

    def f64(self, rva):
        return struct.unpack_from("<d", self.d, rva)[0]

    def wstr(self, va):
        o = va - IMAGE_BASE
        e = o
        while self.d[e] or self.d[e + 1]:
            e += 2
        return self.d[o:e].decode("utf-16-le")

    def expect(self, rva, pattern, what):
        """Assert the exact bytes at rva, so a different NWindow.dll fails loud."""
        raw = bytes.fromhex(pattern.replace(" ", ""))
        got = self.d[rva:rva + len(raw)]
        if got != raw:
            raise SystemExit(
                f"BYTE MISMATCH at {IMAGE_BASE + rva:#x} ({what})\n"
                f"  expected {raw.hex(' ')}\n"
                f"  found    {got.hex(' ')}\n"
                f"  (run: objdump -d {DLL} --start-address={IMAGE_BASE + rva:#x})")

    def dis(self, va, length):
        r = subprocess.run(
            ["objdump", "-d", DLL, f"--start-address={va:#x}",
             f"--stop-address={va + length:#x}"],
            capture_output=True, text=True)
        return r.stdout


def sysstring_id(offset):
    """Blob offset used by a native -> SysString id."""
    if (offset - SYSSTR_BASE) % SYSSTR_STRIDE:
        raise SystemExit(f"offset {offset:#x} is not on the FString stride")
    return (offset - SYSSTR_BASE) // SYSSTR_STRIDE


def load_sysstrings():
    with open(SYSSTRING) as f:
        return {e["id"]: e["string"] for e in json.load(f)}


# --------------------------------------------------------------------------
# 1. the natives
# --------------------------------------------------------------------------

def mine_natives(img, S):
    out = {}

    # --- gate 1: the SysString base itself -------------------------------
    # execGetSystemString @0x100f9ae2. If these bytes ever move, every id
    # below is meaningless, so this is asserted first.
    img.expect(0xF9AE2, "8d 04 40 8b 0d 90 c7 22 10 8d 8c 81 dc a8 06 00",
               "execGetSystemString: id*3, base ptr, lea +0x6a8dc")

    # --- GetItemGradeString(crystalType) ---------------------------------
    # 0x10146390: `if (crystalType < 1) return ""` else return table[ct],
    # table at 0x10350f70, entries 1..5 are wide literals.
    img.expect(0x1463C2, "8b 45 08 83 f8 01 7c 1b 8b 04 85 70 0f 35 10",
               "GetItemGradeString: arg>=1 then table[arg] @0x10350f70")
    grade = {}
    for ct in range(1, 6):
        grade[str(ct)] = img.wstr(img.u32(0x350F70 + 4 * ct))
    out["gradeSymbol"] = {
        "_evidence": "NWindow.dll GetItemGradeString 0x10146390 -- `cmp eax,1 / jl` "
                     "then `mov eax,[0x10350f70+eax*4]`; crystalType 0 yields the "
                     "empty string (0x101463e5 xor eax,eax).",
        "_wrappedBy": "Tooltip.uc:1887 AddTooltipItemGrade -- \"`\" $ name $ \"`\"",
        "byCrystalType": grade,
    }

    # --- GetWeaponTypeString(weaponType) ---------------------------------
    # 0x10145ab0: (wt-1) switched through the jump table at 0x10145b74;
    # every arm loads one SysString offset.
    img.expect(0x145AB0, "8b 44 24 04 83 c0 ff 83 f8 07 0f 87",
               "GetWeaponTypeString: (arg-1) bounds-checked against 7")
    img.expect(0x145AC0, "ff 24 85 74 5b 14 10",
               "GetWeaponTypeString: jmp [0x10145b74 + idx*4]")
    wt = {}
    for i in range(8):
        arm = img.u32(0x145B74 + 4 * i) - IMAGE_BASE
        # each arm is `mov ecx,[0x1022c790]; add ecx,<off>` ...
        off = img.u32(arm + 8)
        wt[str(i + 1)] = sysstring_id(off)
    out["weaponType"] = {
        "_evidence": "NWindow.dll GetWeaponTypeString 0x10145ab0, jump table 0x10145b74. "
                     "Any weaponType outside 1..8 returns \"\" (0x10145b6f xor eax,eax).",
        "sysstringByType": wt,
        "_text": {k: S[v] for k, v in wt.items()},
    }

    # --- GetAttackSpeedString(atkSpd) ------------------------------------
    # 0x10145ed0: four `cmp eax,<threshold>; jge` steps, five outcomes.
    img.expect(0x145ED0, "8b 44 24 04 3d 04 01 00 00 8b 0d 90 c7 22 10 7d 0f",
               "GetAttackSpeedString: first threshold 0x104")
    spd = []
    # (threshold, offset-of-the-string-taken-when-BELOW-it)
    for cmp_rva, off_rva in ((0x145ED4, 0x145EE3), (0x145EF0, 0x145EF9),
                             (0x145F06, 0x145F0F), (0x145F1C, 0x145F25)):
        spd.append({"below": img.u32(cmp_rva + 1),
                    "sysstring": sysstring_id(img.u32(off_rva))})
    spd.append({"below": None, "sysstring": sysstring_id(img.u32(0x145F34))})
    out["attackSpeed"] = {
        "_evidence": "NWindow.dll GetAttackSpeedString 0x10145ed0 -- a four-step "
                     "compare ladder; the arm is taken when atkSpd < the bound.",
        "ladder": spd,
        "_text": [S[e["sysstring"]] for e in spd],
    }

    # --- GetSlotTypeString(ItemType, SlotBitType, ArmorType) -------------
    # 0x10145ba0. ItemType selects a block; inside a block SlotBitType (and
    # for three armour slots, ArmorType) selects the SysString.
    img.expect(0x145BAE, "8b 44 24 1c 85 c0 56 8b 74 24 28 75 3f",
               "GetSlotTypeString: ItemType == 0 fast path")
    slot = {
        "0": {"128": sysstring_id(img.u32(0x145BF1)),      # SBT_RHAND
              "256": sysstring_id(img.u32(0x145BF1)),      # SBT_LHAND
              "16384": sysstring_id(img.u32(0x145BE0))},   # SBT_LRHAND
        "1": {"1": sysstring_id(img.u32(0x145C5E)),
              "64": sysstring_id(img.u32(0x145C4D)),
              "128": sysstring_id(img.u32(0x145C3C)),
              "256": sysstring_id(img.u32(0x145C3C)),
              "512": sysstring_id(img.u32(0x145D5E)),
              "1024": sysstring_id(img.u32(0x145C98)),
              "2048": sysstring_id(img.u32(0x145D82)),
              "4096": sysstring_id(img.u32(0x145E16)),
              "8192": sysstring_id(img.u32(0x145E05)),
              "32768": sysstring_id(img.u32(0x145DE0)),
              "65536": sysstring_id(img.u32(0x145E39)),
              "262144": sysstring_id(img.u32(0x145E39)),
              "524288": sysstring_id(img.u32(0x145E39))},
        "2": {"2": sysstring_id(img.u32(0x145E54)),
              "4": sysstring_id(img.u32(0x145E54)),
              "8": sysstring_id(img.u32(0x145E6A)),
              "16": sysstring_id(img.u32(0x145E80)),
              "32": sysstring_id(img.u32(0x145E80))},
        "3": {"*": sysstring_id(img.u32(0x145E93))},
        "4": {"*": sysstring_id(img.u32(0x145EA6))},
    }
    # The three armour slots that append " / <armour class>".
    armor_kind = {"1": sysstring_id(img.u32(0x145D31)),
                  "2": sysstring_id(img.u32(0x145D04)),
                  "3": sysstring_id(img.u32(0x145CD7))}
    img.expect(0x145C81, "68 5c f3 27 10", "GetSlotTypeString: pushes the \" / \" literal")
    sep = img.wstr(0x1027F35C)
    out["slotType"] = {
        "_evidence": "NWindow.dll GetSlotTypeString 0x10145ba0. Arg0 is ItemType "
                     "(compared against 0..4), arg1 SlotBitType, arg3 ArmorType; "
                     "the FString return pointer is arg2. Slot bits not listed "
                     "return the empty string (0x10145eb9).",
        "byItemTypeAndSlotBit": slot,
        "armorClassSuffixSlots": ["1024", "2048", "32768"],
        "armorClassBySysstring": armor_kind,
        "separator": sep,
        "_text": {it: {b: S[i] for b, i in m.items()} for it, m in slot.items()},
        "_armorText": {k: S[v] for k, v in armor_kind.items()},
    }

    # --- the enchant formulas --------------------------------------------
    # GetPhysicalDamage 0x1014e1f0 / GetMagicalDamage 0x1014e290 share one
    # shape: pick a per-weapon-class bonus table indexed by crystalType,
    # multiply by a step function of the enchant level, add the base.
    img.expect(0x146942, "8b 45 08 83 f8 03 7e 04 8d 44 00 fd",
               "weapon enchant step: e<=3 ? e : 2e-3")
    img.expect(0x1469D2, "8b 45 08 83 f8 03 7e 04 8d 44 40 fa",
               "armour enchant step: e<=3 ? e : 3e-6")
    img.expect(0x14E1F0, "83 ec 08 8b 44 24 0c d9 ee 83 c0 ff dd 1c 24 83 f8 07",
               "GetPhysicalDamage prologue")
    img.expect(0x14E330, "83 ec 08 8b 44 24 0c 8b 54 24 10 dd 04 c5 d8 df 27 10",
               "GetPhysicalDefense/MagicalDefense/ShieldDefense share 0x1014e330")

    def table(rva):
        return [img.f64(rva + 8 * i) for i in range(6)]

    # Which bonus table each weaponType uses, straight off the jump tables.
    # arms: 0x1014e20b/0x1014e2ab = "two-handed if SlotBitType==0x4000 else
    # one-handed"; 0x1014e215/0x1014e2b5 = two-handed; 0x1014e222/0x1014e2c2 =
    # one-handed; 0x1014e22f/0x1014e2cf = the bow table.
    def arms(jt, name_by_arm):
        m = {}
        for i in range(8):
            m[str(i + 1)] = name_by_arm[img.u32(jt + 4 * i)]
        return m

    patk_arms = arms(0x14E264, {
        0x1014E20B: "byHandedness", 0x1014E215: "twoHanded",
        0x1014E222: "oneHanded", 0x1014E22F: "bow"})
    matk_arms = arms(0x14E304, {
        0x1014E2AB: "byHandedness", 0x1014E2B5: "twoHanded",
        0x1014E2C2: "oneHanded", 0x1014E2CF: "bow"})
    out["enchant"] = {
        "_evidence": "NWindow.dll GetPhysicalDamage 0x1014e1f0, GetMagicalDamage "
                     "0x1014e290, and the shared defence routine 0x1014e330. "
                     "Step helpers 0x10146910 (weapon) / 0x101469a0 (armour). "
                     "Result = ftol(step(enchant) * table[crystalType] + base).",
        "weaponStep": "enchant <= 3 ? enchant : 2*enchant - 3",
        "armorStep": "enchant <= 3 ? enchant : 3*enchant - 6",
        "twoHandedSlotBit": 0x4000,
        "pAtkTables": {"oneHanded": table(0x27DF48), "twoHanded": table(0x27DF78),
                       "bow": table(0x27DFA8)},
        "mAtkTables": {"oneHanded": table(0x351020), "twoHanded": table(0x351050),
                       "bow": table(0x351080)},
        "defenseTable": table(0x27DFD8),
        "pAtkTableByWeaponType": patk_arms,
        "mAtkTableByWeaponType": matk_arms,
    }

    # --- IsMagicalArmor / IsStackableItem --------------------------------
    img.expect(0x164D9A, "83 b8 e4 05 00 00 03", "IsMagicalArmor: armorType == 3")
    img.expect(0xF6A82, "83 f8 01 74 15 83 f8 02 74 10 83 f8 03 74 0b",
               "IsStackableItem: consumeType in {1,2,3}")
    out["predicates"] = {
        "isMagicalArmor": {
            "_evidence": "NWindow.dll 0x10164d80 -- looks the ClassID up in the "
                         "loaded armour table and tests field +0x5e4 == 3, which "
                         "is armorgrp's armor_type.",
            "rule": "armorgrp.armor_type == 3",
        },
        "isStackableItem": {
            "_evidence": "NWindow.dll execIsStackableItem 0x100f6a00 -- three "
                         "`cmp eax,imm8 / je` at 0x100f6a82, 0x100f6a87, "
                         "0x100f6a8c; the immediates are read, not typed.",
            "values": [img.d[0xF6A84], img.d[0xF6A89], img.d[0xF6A8E]],
            "source": "etcitemgrp.stackable (0 for weapon/armour records)",
        },
    }
    return out


# --------------------------------------------------------------------------
# 2. the window itself
# --------------------------------------------------------------------------

def mine_window(img):
    # NCTooltip::DrawTooltip 0x10054680 paints a 3x3 nine-slice, corners 8x8,
    # edges stretched to W-16 / H-16, centre at (+8,+8); then renders the
    # DrawList at (+5,+5).
    img.expect(0x547B3, "6a 08 6a 08 6a 00 6a 00 6a 08 6a 08 57 56",
               "DrawTooltip: corner 1 at (x,y), 8x8, uv 0,0 8x8")
    img.expect(0x547DF, "83 c0 f0", "DrawTooltip: top edge width = W - 0x10")
    img.expect(0x5493B, "83 c7 05 57 83 c6 05 56",
               "DrawTooltip: DrawList rendered at (x+5, y+5)")
    img.expect(0x54789, "8d 7c 07 20",
               "DrawTooltip: flip below the cursor by 0x20 when it would clip the top")
    # The DEFAULT text colour, which decides how the item NAME is painted --
    # Tooltip.uc never sets a colour on it (AddTooltipItemName, uc:1847).
    #
    # `StartItem()` does `m_Info = infoClear` from a bare local, and
    # DrawItemInfo is declared `struct native constructive`, so the local is
    # built by the C++ constructor rather than zeroed:
    #   10115999: push 0xff x4        -> FColor(255,255,255,255)
    #   101159d5: mov [ebp], eax      ; ebp = this+0x24 = t_color
    # The value survives untouched to the draw: NCTooltipManager's copy
    # (0x10063240) moves it through FColor::DWColor with no substitution, and
    # the text draw (0x100217a0) ANDs only the ALPHA byte with the window's.
    # A zeroed local would have made the name invisible -- worth stating,
    # because "the default must be some grey" is the tempting wrong answer.
    img.expect(0x115999, "68 ff 00 00 00 68 ff 00 00 00 68 ff 00 00 00 68 ff 00 00 00",
               "FDrawItemInfo ctor: FColor(255,255,255,255)")
    img.expect(0x1159D5, "89 45 00", "FDrawItemInfo ctor: store into t_color (this+0x24)")
    tex = img.wstr(0x10256A74)
    return {
        "defaultTextColor": "#FFFFFF",
        "_defaultTextColorEvidence":
            "NWindow.dll ??0FDrawItemInfo@@QAE@XZ 0x10115930 -- four `push 0xff` "
            "at 0x10115999 into the FColor ctor, stored at this+0x24 (t_color) "
            "by 0x101159d5. Tooltip.uc's StartItem() copies a bare local of this "
            "`native constructive` struct, so every DrawItemInfo starts opaque "
            "white; the item name, the grade symbol and the stackable count are "
            "the entries that never override it.",
        "_evidence": "NWindow.dll NCTooltip::DrawTooltip 0x10054680. Nine texture "
                     "handles at ctrl+0x00..+0x20 are painted row-major: "
                     "TL(x,y,8,8) T(x+8,y,W-16,8) TR(x+W-8,y,8,8) / "
                     "L(x,y+8,8,H-16) C(x+8,y+8,W-16,H-16) R(x+W-8,y+8,8,H-16) / "
                     "BL(x,y+H-8,8,8) B(x+8,y+H-8,W-16,8) BR(x+W-8,y+H-8,8,8).",
        "textureFormat": tex,
        "textureRefs": [tex.replace("%d", str(i)) for i in range(1, 10)],
        "sliceCorner": 8,
        "contentInset": 5,
        "flipBelowCursorOffset": 0x20,
        "_sizeEvidence": "TooltipInfo::CalculateSize 0x10054120 -> 0x10065570 writes "
                         "W = max(MinimumWidth, widest line) and H = sum of line "
                         "heights, with NO padding added (TooltipInfo::SetTooltipInfo "
                         "0x10054f20 only copies MinimumWidth/SimpleLineCount before "
                         "calling it). The frame is drawn at exactly W x H, so the "
                         "content's 5px inset is a real overhang, not a margin.",
        "lineHeightRule": "max over the line of (DrawItemInfo.nOffSetY + item height)",
        "blankRule": "DIT_BLANK contributes exactly b_nHeight and breaks the line",
        "gradeSymbolSize": 12,
        "_gradeSymbolEvidence": "0x100656ee `mov eax,0xc` taken when 0x10146430 "
                                "(Len==8 and Mid(1,6) is in the grade table) is true.",
    }


# --------------------------------------------------------------------------
# 3. the field order, extracted from Tooltip.uc
# --------------------------------------------------------------------------

CALL = re.compile(
    r"^\s*(AddTooltipItemOption2|AddTooltipItemOption|AddTooltipItemBlank|"
    r"AddTooltipItemEnchant|AddTooltipItemName|AddTooltipItemGrade|"
    r"AddTooltipItemCount|SetTooltipItemColor)\s*\((.*)$")


def split_args(s):
    """Split a call's argument text on top-level commas."""
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            if depth == 0:
                break
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def extract_order(uc_text, S):
    """Walk ReturnTooltip_NTT_ITEM and record every append, in source order.

    Conditions are captured verbatim from the enclosing `if`/`case` so the
    port has to implement the same guard, and a reader can check it against
    the .uc without this tool in between.
    """
    lines = uc_text.split("\n")
    start = next(i for i, l in enumerate(lines)
                 if l.startswith("function ReturnTooltip_NTT_ITEM"))
    # the function ends at the next top-level `}` followed by a blank line
    end = next(i for i in range(start + 2, len(lines))
               if lines[i].rstrip() == "}")

    seq = []
    case = "header"
    cond = []          # stack of (indent, condition text)
    switch_indent = None
    n = start - 1
    while n + 1 < end:
        n += 1
        raw = lines[n]
        line = raw.strip()
        if line in ("{", ""):
            # A brace on its own line sits at the CONDITION's indent, not the
            # body's. Popping on it threw away every guard whose body is
            # braced -- which is most of them ("if (Item.SoulshotCount>0)").
            continue
        indent = len(raw) - len(raw.lstrip("\t "))
        while cond and indent <= cond[-1][0]:
            cond.pop()
        if line.startswith("switch ("):
            switch_indent = indent
            continue
        if switch_indent is not None and line == "}" and indent == switch_indent:
            # the EItemType switch closed: everything after it (durability,
            # description, set effects) applies to every category
            switch_indent = None
            case = "tail"
            cond = []
            continue
        m = re.match(r"^case (ITEM_\w+):", line)
        if m:
            case = m.group(1)
            cond = []
            continue
        if re.match(r"^(if|else if|else)\b", line):
            cond.append((indent, line))
            continue
        if line == "StartItem();":
            # A raw DrawItemInfo the script fills in by hand rather than
            # through an AddTooltipItem* helper -- the adena readout, the
            # description, and every set-item line are built this way, and a
            # helper-only scan misses them entirely.
            fields, k = {}, n
            while k + 1 < end and lines[k + 1].strip() != "EndItem();":
                k += 1
                fm = re.match(r"^m_Info\.(\w+(?:\.\w+)?)\s*=\s*(.+?);\s*$",
                              lines[k].strip())
                if fm:
                    fields[fm.group(1)] = fm.group(2)
                cm = re.match(r"^ParamAdd\(m_Info\.Condition, \"(\w+)\", (.+)\);$",
                              lines[k].strip())
                if cm:
                    fields.setdefault("Condition", {})[cm.group(1)] = cm.group(2)
            seq.append({"case": case, "fn": "RawDrawItem", "fields": fields,
                        "line": n + 1, "guards": [c[1] for c in cond]})
            n = k + 1
            continue
        m = CALL.match(raw)
        if not m:
            continue
        fn, rest = m.group(1), m.group(2)
        # a call may wrap; join until the parens balance
        text = rest
        k = n
        while text.count("(") + 1 > text.count(")") and k + 1 < end:
            k += 1
            text += " " + lines[k].strip()
        args = split_args(text)
        rec = {"case": case, "fn": fn, "args": args,
               "line": n + 1, "guards": [c[1] for c in cond]}
        if fn in ("AddTooltipItemOption", "AddTooltipItemOption2") and args:
            try:
                sid = int(args[0])
            except ValueError:
                sid = None
            if sid is not None:
                rec["labelSysstring"] = sid
                rec["label"] = S.get(sid, "")
        if fn == "AddTooltipItemOption2" and len(args) > 1:
            try:
                cid = int(args[1])
                rec["valueSysstring"] = cid
                rec["value"] = S.get(cid, "")
            except ValueError:
                pass
        seq.append(rec)
    return seq


def extract_colors(uc_text):
    """Every t_color literal in Tooltip.uc's item path, with its site."""
    lines = uc_text.split("\n")
    hits = {}
    for i, l in enumerate(lines):
        m = re.match(r"\s*m_Info\.t_color\.R = (\d+);", l)
        if m and i + 2 < len(lines):
            g = re.match(r"\s*m_Info\.t_color\.G = (\d+);", lines[i + 1])
            b = re.match(r"\s*m_Info\.t_color\.B = (\d+);", lines[i + 2])
            if g and b:
                rgb = (int(m.group(1)), int(g.group(1)), int(b.group(1)))
                hits.setdefault(rgb, []).append(i + 1)
    for m in re.finditer(r"SetTooltipItemColor\((\d+), (\d+), (\d+), \d+\)", uc_text):
        rgb = tuple(int(m.group(k)) for k in (1, 2, 3))
        hits.setdefault(rgb, []).append(
            uc_text[:m.start()].count("\n") + 1)
    return [{"hex": "#%02X%02X%02X" % rgb, "rgb": list(rgb),
             "ucLines": sorted(set(v))}
            for rgb, v in sorted(hits.items(), key=lambda kv: min(kv[1]))]


# --------------------------------------------------------------------------

def build():
    img = Image(DLL)
    # gate 0: file offset == RVA for this PE (mine_native_colors.py's gate 0).
    # SPEC: PE/COFF -- OptionalHeader follows the 0x18-byte file header;
    # SectionAlignment at +0x20, FileAlignment at +0x24.
    pe = img.u32(0x3C)
    opt = pe + 0x18
    if img.u32(opt + 0x20) != img.u32(opt + 0x24):
        raise SystemExit("SectionAlignment != FileAlignment: file offset != RVA")

    S = load_sysstrings()
    with open(UC, encoding="latin-1") as f:
        uc = f.read()

    doc = {
        "_note": "The retail item tooltip: which fields, in which order, with "
                 "which labels, formulas and colours. Every entry cites the "
                 "Tooltip.uc line or the NWindow.dll instruction it came from. "
                 "Regenerate/verify with tools/ui/mine_itemtooltip.py --check.",
        "_sources": {
            "script": "assets/uscript/Interface/Tooltip.uc "
                      "(ReturnTooltip_NTT_ITEM, uc:213-820)",
            "natives": "assets/interlude/system/NWindow.dll",
            "labels": "assets/gamedata/sysstring.json (SysString-e.dat)",
        },
        "_tool": "tools/ui/mine_itemtooltip.py",
        "tooltipTypes": sorted(set(re.findall(
            r'TooltipType == "(Inventory\w*)"', uc))),
        "minimumWidth": int(re.search(
            r"const TOOLTIP_MINIMUM_WIDTH = (\d+);", uc).group(1)),
        "setItemMax": int(re.search(
            r"const TOOLTIP_SETITEM_MAX = (\d+);", uc).group(1)),
        "adenaClassId": int(re.search(
            r"if \(Item\.ClassID==(\d+)\)", uc).group(1)),
        "itemTypeEnum": ["ITEM_WEAPON", "ITEM_ARMOR", "ITEM_ACCESSARY",
                         "ITEM_QUESTITEM", "ITEM_ASSET", "ITEM_ETCITEM"],
        "noGradeColouring": {
            "fact": "AddTooltipItemName (Tooltip.uc:1847) sets NO colour on the "
                    "item name, and no branch in ReturnTooltip_NTT_ITEM tints it "
                    "by grade. The grade is a 12x12 symbol appended after the "
                    "name, not a colour.",
        },
        "shieldSlotBits": [256, 128],
        "window": mine_window(img),
        "natives": mine_natives(img, S),
        "colors": extract_colors(uc),
        "fieldOrder": extract_order(uc, S),
    }
    return doc


def report(doc):
    print(f"tooltip types      {doc['tooltipTypes']}")
    print(f"minimum width      {doc['minimumWidth']}")
    w = doc["window"]
    print(f"window art         {w['textureRefs'][0]} .. {w['textureRefs'][-1]}"
          f"  corner {w['sliceCorner']}px, content inset {w['contentInset']}px")
    print(f"colours            {len(doc['colors'])} distinct literals")
    n = doc["natives"]
    print(f"grade symbols      {n['gradeSymbol']['byCrystalType']}")
    print(f"weapon types       {n['weaponType']['_text']}")
    print(f"attack speed       {n['attackSpeed']['_text']} "
          f"at {[e['below'] for e in n['attackSpeed']['ladder']]}")
    print(f"weapon enchant     {n['enchant']['weaponStep']}")
    print(f"armour enchant     {n['enchant']['armorStep']}")
    print()
    cur = None
    for e in doc["fieldOrder"]:
        if e["case"] != cur:
            cur = e["case"]
            print(f"--- {cur}")
        lab = e.get("label")
        lab = f"{lab!r}" if lab else ""
        g = f"   [{'; '.join(e['guards'])}]" if e["guards"] else ""
        if e["fn"] == "RawDrawItem":
            f = e["fields"]
            val = f.get("t_strText") or f.get("t_ID") or ""
            col = ",".join(str(f.get(f"t_color.{c}", "")) for c in "RGB")
            print(f"  uc:{e['line']:<5} {'RawDrawItem':<24} {'(' + col + ')':<22}"
                  f"{val}{g}")
        else:
            print(f"  uc:{e['line']:<5} {e['fn']:<24} {lab:<22}"
                  f"{e['args'][1] if len(e['args']) > 1 else ''}{g}")
    print(f"\n{len(doc['fieldOrder'])} appends extracted")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--emit", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    doc = build()

    if a.check:
        if not os.path.exists(OUT):
            print(f"FAIL {OUT} missing")
            return 1
        with open(OUT) as f:
            old = json.load(f)
        if json.dumps(old, sort_keys=True) != json.dumps(doc, sort_keys=True):
            print(f"FAIL {OUT} differs from a fresh decode")
            return 1
        print(f"OK   {OUT} matches a fresh decode "
              f"({len(doc['fieldOrder'])} appends, "
              f"{len(doc['colors'])} colours)")
        return 0

    if a.emit:
        with open(OUT, "w") as f:
            json.dump(doc, f, indent=1, sort_keys=True)
            f.write("\n")
        print(f"wrote {OUT}")
        return 0

    report(doc)
    return 0


if __name__ == "__main__":
    sys.exit(main())
