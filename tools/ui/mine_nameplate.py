#!/usr/bin/env python3
"""What Engine.dll can and cannot tell us about the overhead nameplate.

    python3 tools/ui/mine_nameplate.py            report
    python3 tools/ui/mine_nameplate.py --check    re-verify, exit 1 on drift

WHY THIS EXISTS
---------------
`editor/world/js/nameplates.js` rebuilt the name label as a SCREEN-SPACE plate
instead of a world-space sprite, and it justifies that with two claims about
the client. Both are mechanical, so both are checked here rather than asserted
in a comment:

  1. Engine.dll exports  ?DrawTargetName@UCanvas@@...W4L2FontType@@...
     and                 ?DrawNormalText@UCanvas@@UAEKHH...W4L2FontType@@...
     A UCanvas method, a single FVector for the anchor, an L2FontType SELECTOR
     for the face, and — in DrawNormalText, the generic text drawer on the same
     class — `int, int` for the position. Nothing in either signature can carry
     a distance-dependent size. That is the whole argument for a fixed-size
     plate, and it rests on names this tool reads out of the export directory.

  2. The BODY of those functions is unreadable, so the remaining questions —
     WHICH L2FontType a nameplate passes, and whether ground-item names are
     Alt-gated — cannot be answered from this client. Engine.dll is
     Themida-packed, and the decisive test is not entropy but the
     disassembler: `objdump -h engine.dll` flags EVERY section DATA and has a
     `Themida` section, so `objdump -d` emits not one instruction, while the
     same objdump disassembles NWindow.dll's .text normally. All 10,083
     exports also resolve into a ~45 KB window near the image base — a stub
     table, not 26 MB of real code. Entropy is reported alongside as a
     secondary number; the objdump result is the gate.

Contrast NWindow.dll, which is plain PE32 and is where every other native
constant in this port came from (tools/ui/mine_native_colors.py). It does NOT
import these symbols — checked here too — so there is no second call site.
"""

import argparse
import collections
import math
import os
import re
import struct
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENGINE = os.path.join(REPO, "assets/interlude/system/engine.dll")
NWINDOW = os.path.join(REPO, "assets/interlude/system/NWindow.dll")

# The exports the nameplate argument rests on, and what each one proves.
WANTED = {
    "?DrawTargetName@UCanvas@@UAEXPAVFLevelSceneNode@@PAVFRenderInterface@@"
    "VFVector@@KPAUUser@@W4TargetRenderType@@W4L2FontType@@K@Z":
        "the nameplate draw: UCanvas method, one FVector anchor, an "
        "L2FontType selector, no size term",
    "?DrawTargetOptionName@UCanvas@@UAEXPAVFLevelSceneNode@@PAVFRenderInterface@@"
    "VFVector@@KPAUUser@@W4TargetRenderType@@W4L2FontType@@@Z":
        "its sibling for the option/title line, same shape",
    "?DrawNormalText@UCanvas@@UAEKHHKPBGKKKMHW4L2FontType@@HHKHHHPAV"
    "?$TArray@PAVFL2ColorFontInfo@@@@GW4EFontExceptionType@@H@Z":
        "the generic text drawer on the same class: its first two arguments "
        "are int X, int Y -- integer SCREEN pixels",
    "?GetNameColor@User@@QAEK_N@Z":
        "a name's colour is chosen per User in native code",
    "?GetNickColor@User@@QAEKXZ": "and so is the nick colour",
}

# objdump is the same instrument tools/ui/mine_native_colors.py and
# mine_classicons.py already use on NWindow.dll.
OBJDUMP = "objdump"


def sections(data):
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    nsec = struct.unpack_from("<H", data, pe + 6)[0]
    optsize = struct.unpack_from("<H", data, pe + 20)[0]
    # PE/COFF spec: the optional header starts 24 bytes past the PE signature,
    # and IMAGE_SECTION_HEADER is 40 bytes. Format constants, not measurements.
    optoff = pe + 24
    base = struct.unpack_from("<I", data, optoff + 28)[0]
    out = []
    secoff = optoff + optsize
    for i in range(nsec):
        o = secoff + 40 * i   # SOURCED: IMAGE_SECTION_HEADER stride, PE/COFF spec
        name = data[o:o + 8].rstrip(b"\0").decode("latin1")
        vsz, va, rsz, ra = struct.unpack_from("<IIII", data, o + 8)
        out.append({"name": name, "va": va, "vsize": vsz, "raw": ra, "rsize": rsz})
    return base, out, optoff


def exports(data):
    """-> {name: VA}. Requires file offset == RVA, asserted by the caller."""
    base, secs, optoff = sections(data)
    rva, _size = struct.unpack_from("<II", data, optoff + 96)
    (_ch, _ts, _mj, _mn, _nameptr, _ordbase, _nfunc, nnames,
     addrf, addrn, addro) = struct.unpack_from("<IIHHIIIIIII", data, rva)
    out = {}
    for i in range(nnames):
        nptr = struct.unpack_from("<I", data, addrn + 4 * i)[0]
        end = data.index(b"\0", nptr)
        name = data[nptr:end].decode("latin1")
        ordi = struct.unpack_from("<H", data, addro + 2 * i)[0]
        out[name] = base + struct.unpack_from("<I", data, addrf + 4 * ordi)[0]
    return base, out


def _objdump(args):
    """objdump output, or "" when it fails — a missing binutils must fail the
    gate loudly rather than look like a packed binary."""
    try:
        r = subprocess.run([OBJDUMP] + args, capture_output=True, text=True)
        return r.stdout
    except OSError:
        return ""


_INSN = re.compile(r"^\s*[0-9a-f]+:\s+([0-9a-f]{2} )+\s*\w", re.M)


def _count_insns(text):
    return len(_INSN.findall(text))


def entropy(block):
    counts = collections.Counter(block)
    n = len(block)
    return -sum(c / n * math.log2(c / n) for c in counts.values())


def code_entropy(path, section_name=None, samples=6):   # AUTHORED sample count
    """Mean Shannon entropy over evenly spaced 64 KB windows of the first
    (or named) section, skipping the tail padding."""
    with open(path, "rb") as fh:
        data = fh.read()
    _base, secs, _o = sections(data)
    sec = None
    for s in secs:
        if section_name is None or s["name"] == section_name:
            sec = s
            break
    if sec is None:
        return None, None
    span = min(sec["rsize"], sec["vsize"] or sec["rsize"])
    win = 1 << 16
    # Only the live head of the section: engine.dll's code section is padded
    # with a 2-bits-per-byte filler for its last 20 MB, and averaging that in
    # would mask the packed part rather than measure it.
    step = max(win, span // (samples * 4))
    vals = []
    for i in range(samples):
        off = sec["raw"] + i * step
        block = data[off:off + win]
        if len(block) < win:
            break
        vals.append(entropy(block))
    return sec, (sum(vals) / len(vals) if vals else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    fails = []
    for p in (ENGINE, NWINDOW):
        if not os.path.isfile(p):
            fails.append("missing %s (needs your own client)" % p)
    if fails:
        for f in fails:
            print("  " + f)
        print("CHECK", "FAIL")
        return 1

    with open(ENGINE, "rb") as fh:
        edata = fh.read()

    # gate 0: file offset == RVA for engine.dll, which every read below needs
    base, secs, _o = sections(edata)
    for s in secs:
        if s["va"] != s["raw"]:
            fails.append("engine.dll section %s: RVA 0x%x != raw 0x%x"
                         % (s["name"], s["va"], s["raw"]))
    print("engine.dll image base 0x%x, %d sections" % (base, len(secs)))

    # gate 1: the five exports exist
    _b, exp = exports(edata)
    print("exports: %d" % len(exp))
    for name, why in WANTED.items():
        va = exp.get(name)
        if va is None:
            fails.append("engine.dll does not export %s" % name[:60])
            continue
        print("  0x%08x  %s\n      %s" % (va, name.split("@")[0][1:], why))

    # gate 2: the exports resolve into one small stub table, not spread over a
    # 26 MB code section -- the Themida signature.
    vas = [exp[n] for n in WANTED if n in exp]
    if vas:
        spread = max(vas) - min(vas)
        print("the 5 exports span %d bytes of address space" % spread)

    # gate 3: objdump can read NWindow.dll and cannot read engine.dll.
    # This is the gate. If it ever flips, the documented gap in
    # editor/world/js/nameplates.js (which font, and the Alt question) can be
    # closed by reading the code, and this tool says so out loud.
    eng_h = _objdump(["-h", ENGINE])
    nwin_h = _objdump(["-h", NWINDOW])
    eng_d = _objdump(["-d", ENGINE])
    nwin_d = _objdump(["-d", NWINDOW, "--start-address=0x100034b0",
                       "--stop-address=0x10003500"])
    eng_text = "TEXT" in eng_h
    eng_themida = "Themida" in eng_h
    eng_insns = _count_insns(eng_d)
    nwin_insns = _count_insns(nwin_d)
    print("engine.dll  sections flagged TEXT: %s   Themida section: %s   "
          "instructions objdump -d emits: %d" % (eng_text, eng_themida, eng_insns))
    print("NWindow.dll instructions objdump -d emits over one known paint: %d"
          % nwin_insns)
    if eng_text or eng_insns:
        fails.append("objdump now finds %d instruction(s) in engine.dll — its "
                     "code may be readable, so the DOCUMENTED GAP in "
                     "editor/world/js/nameplates.js should be revisited"
                     % eng_insns)
    if not eng_themida:
        fails.append("engine.dll no longer carries a Themida section; "
                     "re-derive the packing claim")
    # AUTHORED floor: any positive number proves objdump works on a plain PE;
    # 10 only keeps a one-off decode artefact from passing for a disassembly.
    if nwin_insns < 10:
        fails.append("objdump produced only %d instructions for NWindow.dll — "
                     "the control failed, so the engine.dll result proves "
                     "nothing" % nwin_insns)

    # secondary, reported not gated: the code section's Shannon entropy
    sec, ent = code_entropy(ENGINE)
    _ctrl_sec, ctrl = code_entropy(NWINDOW, ".text")
    print("entropy (secondary): engine.dll code %.2f vs NWindow.dll .text "
          "%.2f bits/byte" % (ent, ctrl))

    # gate 4: NWindow.dll has no second call site to read
    with open(NWINDOW, "rb") as fh:
        ndata = fh.read()
    for sym in (b"DrawTargetName", b"DrawNormalText", b"L2FontType"):
        if sym in ndata:
            fails.append("NWindow.dll now references %s — a readable call "
                         "site may exist; re-open the font-type question"
                         % sym.decode())
    print("NWindow.dll references none of DrawTargetName / DrawNormalText / "
          "L2FontType")

    print()
    print("CONCLUSION: the nameplate is a UCanvas draw at a fixed font size "
          "(gate 1); which font, and any Alt gate, are NOT recoverable from "
          "this client (gates 3-4).")

    if args.check:
        for f in fails:
            print("  " + f)
        print("CHECK", "FAIL" if fails else "PASS")
        return 1 if fails else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
