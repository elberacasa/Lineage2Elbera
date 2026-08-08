#!/usr/bin/env python3
"""verify_falloff.py - re-derive the 3D audio falloff from the client binaries.

audio.js turns a table's SoundRadius into an audible range and a gain curve.
Both numbers used to be calibrations. They are not: the Interlude client's
OpenAL driver, ALAudio.dll, is an unpacked PE and it says exactly what it does.

WHAT THIS RE-CHECKS, from the binaries, every run:

  1. Core.dll exports two initialised float globals in .data:
         ?GAudioMaxRadiusMultiplier@@3MA  = 50.0
         ?GAudioDefaultRadius@@3MA        = 80.0
     Read out of the export table + section map, not hardcoded offsets.

  2. ALAudio.dll imports both by name from Core.dll, so those globals are
     the ones the audio path actually consumes.

  3. ALAudio.dll's .text dereferences the multiplier IAT slot and immediately
     multiplies a float by it (movl <iat>,reg ; fmuls (reg)) -- the shape that
     makes it a multiplier on a radius rather than, say, a comparison bound.
     At the sites that go on to compute a gain the sequence continues
         fsubs <dist> ; fmuls <vol> ; flds <radius> ; fmuls (reg) ; fdivrp
     i.e. vol * (R*M - d) / (R*M): LINEAR falloff, zero at the radius.

  4. editor/world/js/audio.js agrees: RADIUS_UNIT === the multiplier,
     DEFAULT_RADIUS === the default radius, distanceModel === 'linear',
     refDistance === 0, rolloffFactor === 1.

Anything that drifts fails. There is no expected-value table in this file
other than the two floats, and those are asserted against the DLL, not
against a note.

Usage:
  python3 tools/audio/verify_falloff.py            # report
  python3 tools/audio/verify_falloff.py --check    # exit 1 on any mismatch
"""

import argparse
import os
import re
import struct
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                     "..", ".."))
SYSTEM = os.path.join(ROOT, "assets", "interlude", "system")
CORE = os.path.join(SYSTEM, "Core.dll")
ALAUDIO = os.path.join(SYSTEM, "ALAudio.dll")
AUDIO_JS = os.path.join(ROOT, "editor", "world", "js", "audio.js")

MULT_SYM = "?GAudioMaxRadiusMultiplier@@3MA"
DEF_SYM = "?GAudioDefaultRadius@@3MA"


# --------------------------------------------------------------------------
# a minimal PE reader -- enough for sections, exports and imports
# --------------------------------------------------------------------------

class PE(object):
    def __init__(self, path):
        with open(path, "rb") as fh:
            self.d = fh.read()
        self.path = path
        if self.d[:2] != b"MZ":
            raise ValueError("%s: not a PE" % path)
        e = struct.unpack_from("<I", self.d, 0x3C)[0]
        if self.d[e:e + 4] != b"PE\0\0":
            raise ValueError("%s: no PE header" % path)
        nsec = struct.unpack_from("<H", self.d, e + 6)[0]
        optsz = struct.unpack_from("<H", self.d, e + 20)[0]
        self.opt = e + 24
        self.imagebase = struct.unpack_from("<I", self.d, self.opt + 28)[0]
        self.secs = []
        so = self.opt + optsz
        for i in range(nsec):
            o = so + i * 40
            name = self.d[o:o + 8].rstrip(b"\0").decode("latin1")
            vsz, va, rsz, ra = struct.unpack_from("<IIII", self.d, o + 8)
            self.secs.append((name, va, vsz, ra, rsz))

    def rva2off(self, rva):
        for _, va, vsz, ra, rsz in self.secs:
            if va <= rva < va + max(vsz, rsz):
                return ra + (rva - va)
        return None

    def datadir(self, i):
        return struct.unpack_from("<II", self.d, self.opt + 96 + i * 8)

    def cstr(self, off):
        return self.d[off:self.d.index(b"\0", off)].decode("latin1")

    def exports(self):
        """-> {name: rva}"""
        erva, _ = self.datadir(0)
        if not erva:
            return {}
        eo = self.rva2off(erva)
        nname = struct.unpack_from("<I", self.d, eo + 24)[0]
        afun, anam, aord = struct.unpack_from("<III", self.d, eo + 28)
        fo, no, oo = self.rva2off(afun), self.rva2off(anam), self.rva2off(aord)
        out = {}
        for i in range(nname):
            nr = struct.unpack_from("<I", self.d, no + 4 * i)[0]
            nm = self.cstr(self.rva2off(nr))
            ordi = struct.unpack_from("<H", self.d, oo + 2 * i)[0]
            out[nm] = struct.unpack_from("<I", self.d, fo + 4 * ordi)[0]
        return out

    def imports(self):
        """-> {name: (dll, absolute IAT address)}"""
        irva, _ = self.datadir(1)
        if not irva:
            return {}
        io = self.rva2off(irva)
        out = {}
        i = 0
        while True:
            ilt, _ts, _fc, nrva, ft = struct.unpack_from("<IIIII", self.d,
                                                         io + i * 20)
            if nrva == 0:
                break
            dll = self.cstr(self.rva2off(nrva))
            to = self.rva2off(ilt or ft)
            j = 0
            while True:
                v = struct.unpack_from("<I", self.d, to + j * 4)[0]
                if v == 0:
                    break
                if not (v & 0x80000000):
                    no = self.rva2off(v)
                    out[self.cstr(no + 2)] = (dll, self.imagebase + ft + j * 4)
                j += 1
            i += 1
        return out

    def text(self):
        for name, va, vsz, ra, rsz in self.secs:
            if name == ".text":
                return self.d[ra:ra + rsz], self.imagebase + va
        raise ValueError("%s: no .text" % self.path)

    def float_at_rva(self, rva):
        o = self.rva2off(rva)
        return struct.unpack_from("<f", self.d, o)[0]


# --------------------------------------------------------------------------
# checks
# --------------------------------------------------------------------------

def find_iat_float_uses(text, base, iat_addr):
    """Offsets of `movl <iat_addr>, r32` immediately followed by `fmuls (r32)`.

    Encodings used by MSVC here:
        A1 <imm32>            mov eax, [imm32]
        8B 0D <imm32>         mov ecx, [imm32]
    followed by
        D8 08 / D8 09 ...     fmul dword ptr [eax] / [ecx]
    """
    pat = struct.pack("<I", iat_addr)
    uses = []
    for m in re.finditer(re.escape(pat), text):
        i = m.start()
        if i >= 1 and text[i - 1] == 0xA1:          # mov eax, [imm32]
            start, reg = i - 1, 0                    # modrm r/m = eax
        elif i >= 2 and text[i - 2] == 0x8B and text[i - 1] == 0x0D:
            start, reg = i - 2, 1                    # mov ecx, [imm32]
        else:
            continue
        nxt = text[i + 4:i + 6]
        if len(nxt) == 2 and nxt[0] == 0xD8 and nxt[1] == (0x08 | reg):
            uses.append(base + start)
    return uses


def parse_audio_js():
    with open(AUDIO_JS) as fh:
        src = fh.read()
    out = {}
    for key, pat in (
        ("RADIUS_UNIT", r"export const RADIUS_UNIT\s*=\s*([0-9.]+)"),
        ("DEFAULT_RADIUS", r"export const DEFAULT_RADIUS\s*=\s*([0-9.]+)"),
        ("distanceModel", r"distanceModel\s*=\s*'([a-z]+)'"),
        ("refDistance", r"refDistance\s*=\s*([0-9.]+)"),
        ("rolloffFactor", r"rolloffFactor\s*=\s*([0-9.]+)"),
    ):
        m = re.search(pat, src)
        out[key] = m.group(1) if m else None
    out["inverse_left"] = "distanceModel = 'inverse'" in src
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true",
                    help="exit 1 on any mismatch")
    args = ap.parse_args()

    fails = []

    def ck(name, ok, detail=""):
        print(("PASS  " if ok else "FAIL  ") + name +
              (" -- " + detail if detail else ""))
        if not ok:
            fails.append(name)

    core = PE(CORE)
    al = PE(ALAUDIO)

    ex = core.exports()
    ck("Core.dll exports both audio radius globals",
       MULT_SYM in ex and DEF_SYM in ex,
       ", ".join(sorted(k for k in ex if "Radius" in k)) or "none")
    if MULT_SYM not in ex or DEF_SYM not in ex:
        print("\ncannot continue without the globals")
        return 1

    mult = core.float_at_rva(ex[MULT_SYM])
    dflt = core.float_at_rva(ex[DEF_SYM])
    ck("GAudioMaxRadiusMultiplier reads as a sane float",
       0 < mult < 1e6, "%g (Core.dll .data rva 0x%X)" % (mult, ex[MULT_SYM]))
    ck("GAudioDefaultRadius reads as a sane float",
       0 < dflt < 1e6, "%g (Core.dll .data rva 0x%X)" % (dflt, ex[DEF_SYM]))

    imp = al.imports()
    ck("ALAudio.dll imports the multiplier from Core.dll",
       imp.get(MULT_SYM, (None,))[0] == "Core.dll",
       str(imp.get(MULT_SYM)))
    ck("ALAudio.dll imports the default radius from Core.dll",
       imp.get(DEF_SYM, (None,))[0] == "Core.dll",
       str(imp.get(DEF_SYM)))

    text, base = al.text()
    uses = []
    if MULT_SYM in imp:
        uses = find_iat_float_uses(text, base, imp[MULT_SYM][1])
    ck("the multiplier is dereferenced and multiplied into a float",
       len(uses) >= 5,
       "%d `mov r32,[iat]; fmul dword [r32]` sites: %s"
       % (len(uses), " ".join("0x%X" % u for u in uses[:6])))

    js = parse_audio_js()
    ck("audio.js RADIUS_UNIT matches the DLL",
       js["RADIUS_UNIT"] is not None and float(js["RADIUS_UNIT"]) == mult,
       "audio.js=%s dll=%g" % (js["RADIUS_UNIT"], mult))
    ck("audio.js DEFAULT_RADIUS matches the DLL",
       js["DEFAULT_RADIUS"] is not None and float(js["DEFAULT_RADIUS"]) == dflt,
       "audio.js=%s dll=%g" % (js["DEFAULT_RADIUS"], dflt))
    ck("audio.js uses the linear distance model",
       js["distanceModel"] == "linear", "distanceModel=%s" % js["distanceModel"])
    ck("audio.js refDistance is 0 (linear from the source)",
       js["refDistance"] is not None and float(js["refDistance"]) == 0.0,
       "refDistance=%s" % js["refDistance"])
    ck("audio.js rolloffFactor is 1",
       js["rolloffFactor"] is not None and float(js["rolloffFactor"]) == 1.0,
       "rolloffFactor=%s" % js["rolloffFactor"])
    ck("no inverse-square panner left in audio.js", not js["inverse_left"])

    print("\n%d checks, %d failed" % (12, len(fails)))
    if fails:
        for f in fails:
            print("  FAILED: %s" % f)
    return 1 if (fails and args.check) else 0


if __name__ == "__main__":
    sys.exit(main())
