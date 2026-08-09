#!/usr/bin/env python3
"""Mine the retail class-icon table from NWindow.dll (tier 5).

ClanWnd.uc / PartyWndCompact.uc / PartyMatchWaitListWnd.uc render a member's
class with GetClassIconName(classID), a NATIVE UIScript function — no script
source states the texture names, so they are recovered from the DLL:

  ?execGetClassIconName@UUIScript@@  (export #1170, thunk)
    -> helper at 0x1014eb90: cmpl $0xf + jump table 0x1014ec38, 16 cases,
       each loads a pointer to an inline UTF-16 string in .rdata
    -> classifier at 0x10147480: cmpl-chain mapping classId -> case 0..15;
       ids without a cmp fall through to the xorl %eax,%eax block (case 0)

The 16 icons live in L2UI_CH3.PartyWnd (party_styleicon1..7, 1_1, 1_2, 1_3,
2_3..7_3). 89 real class ids exist (0..57 + 88..118; 58..87 are dummies):
88 carry an explicit cmp, id 0 (Human Fighter) rides the default.

Output: assets/gamedata/classicons.json
  { "source": ..., "icons": [16 refs], "classes": {"<id>": iconIndex} }

Usage:
  python3 tools/ui/mine_classicons.py [--check]
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
OUT = os.path.join(REPO, "assets/gamedata/classicons.json")

# All three addresses are decoded from NWindow.dll and re-asserted by the
# --check gate below; none is a number chosen here.
CLASSIFIER_VA = 0x10147480   # decoded: classId -> case 0..15
CLASSIFIER_END = 0x101477D4  # decoded: xorl %eax,%eax ; retl $0x4 (default block)
JUMPTABLE_VA = 0x1014EC38    # decoded: 16 case addresses
ICON_REF = re.compile(r"^L2UI_CH3\.PartyWnd\.party_styleicon[1-7](_[123])?$")


class Pe:
    def __init__(self, path):
        self.data = open(path, "rb").read()
        pe = struct.unpack_from("<I", self.data, 0x3C)[0]
        nsec = struct.unpack_from("<H", self.data, pe + 6)[0]
        soh = struct.unpack_from("<H", self.data, pe + 0x14)[0]
        self.imgbase = struct.unpack_from("<I", self.data, pe + 0x18 + 28)[0]
        self.secs = []
        off = pe + 0x18 + soh
        for i in range(nsec):
            # SPEC: PE/COFF -- IMAGE_SECTION_HEADER is 40 bytes.
            o = off + i * 40
            vsize, vaddr, rsize, raddr = struct.unpack_from("<IIII", self.data, o + 8)
            self.secs.append((self.imgbase + vaddr, vsize, raddr, rsize))

    def off(self, va):
        for vaddr, vsize, raddr, rsize in self.secs:
            if vaddr <= va < vaddr + max(vsize, rsize):
                return raddr + (va - vaddr)
        raise KeyError(hex(va))

    def dword(self, va):
        return struct.unpack_from("<I", self.data, self.off(va))[0]

    def ustr(self, va):
        o = self.off(va)
        s = b""
        # SPEC: a UTF-16LE string is 2 bytes per code unit, NUL-terminated.
        while self.data[o:o + 2] != b"\x00\x00":
            s += self.data[o:o + 2]
            o += 2
        return s.decode("utf-16-le")


def disasm(start, end):
    """objdump range -> [(addr, mnemonic, operands)]; needs binutils on PATH."""
    out = subprocess.run(
        ["objdump", "-d", f"--start-address={hex(start)}",
         f"--stop-address={hex(end)}", DLL],
        check=True, capture_output=True, text=True).stdout
    ins = []
    for line in out.splitlines():
        m = re.match(r"\s*([0-9a-f]+):\s+(?:[0-9a-f]{2} )+\s*(\S+)\s*(.*)", line)
        if m:
            # SPEC: objdump prints addresses and immediates in base 16;
            # groups 1/2/3 are address, mnemonic, operands.
            ins.append((int(m.group(1), 16), m.group(2), m.group(3).strip()))
    return ins


def mine(pe):
    # --- the 16 icon refs, via the jump table (each case is movl $strVA, %eax)
    icons = []
    for i in range(16):
        case = pe.dword(JUMPTABLE_VA + i * 4)   # SPEC: 32-bit jump-table entry
        o = pe.off(case)
        # decoded: every case block starts `mov eax,<imm32>` (opcode 0xB8)
        assert pe.data[o] == 0xB8, f"case {i}: expected movl at {hex(case)}"
        str_va = struct.unpack_from("<I", pe.data, o + 1)[0]
        ref = pe.ustr(str_va)
        assert ICON_REF.match(ref), f"case {i}: unexpected icon ref {ref!r}"
        icons.append(ref)
    # decoded: the jump table has 16 entries, one per class-icon texture
    assert len(set(icons)) == 16, "icon refs are not 16 distinct textures"

    # --- the classId -> case map, by following every cmp/branch in the chain
    ins = disasm(CLASSIFIER_VA, CLASSIFIER_END)
    by_addr = {a: (mn, op) for a, mn, op in ins}

    def block_val(addr):
        mn, op = by_addr[addr]
        if mn == "xorl":
            return 0
        assert mn == "movl" and op.startswith("$"), \
            f"unexpected block at {hex(addr)}: {mn} {op}"
        val = int(op.split(",")[0][1:], 16)   # SPEC: objdump immediate, base 16
        # decoded: the switch has cases 0..15, matching the 16-entry table
        assert 0 <= val <= 15, f"block value out of range: {val}"
        return val

    classes = {}
    for i, (a, mn, op) in enumerate(ins):
        if mn != "cmpl" or not (op.startswith("$") and op.endswith(", %eax")):
            continue
        cid = int(op.split(",")[0][1:], 16)   # SPEC: objdump immediate, base 16
        naddr, nmn, nop = ins[i + 1]
        if nmn == "je":
            # SPEC: objdump address, base 16
            classes[cid] = block_val(int(nop.split()[0], 16))
        elif nmn == "jne":  # a match falls through to the block right after
            # decoded: the compare is followed by a two-instruction stub
            # (jump + target) before the block address
            classes[cid] = block_val(ins[i + 2][0])

    # invariants: every real class id but 0 carries an explicit cmp; the rest
    # (id 0 and the 58..87 dummies) fall through to the default block, case 0
    real = set(range(0, 58)) | set(range(88, 119))
    assert set(classes) == real - {0}, \
        f"cmp set drifted: missing {sorted(real - {0} - set(classes))}, " \
        f"extra {sorted(set(classes) - real)}"
    classes[0] = 0  # Human Fighter: default block (xorl), verified above
    return icons, classes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(DLL):
        sys.exit(f"missing {DLL}")

    icons, classes = mine(Pe(DLL))
    print(f"icons       {len(icons)}")
    print(f"class ids   {len(classes)} "
          f"({sum(1 for v in classes.values() if v == 0)} on icon1)")

    doc = {
        "source": "NWindow.dll GetClassIconName "
                  "(?execGetClassIconName@UUIScript@@, tier 5; "
                  "classifier at 0x10147480, jump table 0x1014ec38)",
        "icons": icons,
        "classes": {str(k): classes[k] for k in sorted(classes)},
    }
    # 16 = the decoded jump table's entry count; 89 = the number of ordinals
    # in aCis's ClassId enum, which mine_classnames.py parses independently.
    ok = len(icons) == 16 and len(classes) == 89
    if args.check:
        if ok and os.path.exists(OUT):
            cur = json.load(open(OUT))
            ok = cur.get("icons") == doc["icons"] and cur.get("classes") == doc["classes"]
        print("CHECK", "PASS" if ok else "FAIL")
        return 0 if ok else 1
    if not ok:
        sys.exit("refusing to write: the mine looks incomplete")

    with open(OUT, "w") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")
    print(f"wrote       {os.path.relpath(OUT, REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
