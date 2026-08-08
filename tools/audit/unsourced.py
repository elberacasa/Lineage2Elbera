#!/usr/bin/env python3
"""Repo-wide no-guess audit: every numeric and colour literal, classified.

The owner's rule for this port is "a 1:1 replica, never guessing, always
decoding how it actually looks".  `tools/ui/audit_guesses.py` already enforces
that for one construct in one directory (`Skin.px(<n>)` under
`editor/world/js/ui`).  This tool does the whole client and the whole tool
chain, for every literal, so the rule stops depending on whether anyone
remembered to wrap a number in `Skin.px`.

WHAT IT SCANS
  editor/world/js/**/*.js        the browser client
  tools/**/*.py                  the extraction/build chain
                                 (minus tools/vendor and tools/src/open-l2encdec,
                                  which are third-party)

WHAT IT EXTRACTS
  * numeric literals in executable positions (decimal, float, hex, exponent)
  * colour literals: #rgb / #rrggbb / #rrggbbaa, rgb()/rgba(), and 0xRRGGBB
    used in a colour-bearing expression
  Literals inside comments are ignored (a comment is evidence, not code).
  Literals inside strings are kept only when the string carries CSS units or
  a colour -- a path, a manifest key or an SQL fragment is not geometry.

HOW IT CLASSIFIES  (first rule that fires wins)
  BENIGN     structural: 0/1/-1, array subscripts, bit masks, halving,
             HTTP codes, ms<->s and deg<->rad conversions, angle constants,
             byte maxima, powers of two, string-index arithmetic.
  AUTHORED   the code says, in a comment on the line or in the comment block
             directly above it, that the value is ours: AUTHORED, DEVIATION,
             invented, placeholder, guess, approximate, arbitrary, tuned.
  SOURCED    the same evidence window ties it to a decoded origin: a marker
             (SOURCED / MEASURED / verified), a client file (.dat, .u, .utx,
             .xdat, .ukx, .psa, .unr), a named client table (npcgrp,
             chargrp, Interface.xdat, Engine.u, ...), a server origin (aCis,
             packet, opcode, the live server), or a umodel cross-check.
  UNSOURCED  none of the above: a bare number nobody explained.

`--check` exits non-zero when the UNSOURCED count for a file exceeds the
baseline recorded in tools/audit/unsourced_baseline.json, so the bucket can
only shrink.  `--write-baseline` re-records it.

Usage
  python3 tools/audit/unsourced.py                    # summary + top offenders
  python3 tools/audit/unsourced.py --list UNSOURCED   # every literal in a bucket
  python3 tools/audit/unsourced.py --file audio.js    # one file, all buckets
  python3 tools/audit/unsourced.py --json out.json    # machine-readable dump
  python3 tools/audit/unsourced.py --check            # regression gate
"""

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASELINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "unsourced_baseline.json")

JS_ROOT = os.path.join(REPO, "editor/world/js")
PY_ROOT = os.path.join(REPO, "tools")
PY_SKIP = ("/vendor/", "/open-l2encdec/", "/node_modules/", "/.venv/", "/build/_deps/",
           "/tools/audit/")   # this file audits others, not itself

# --------------------------------------------------------------------------
# 1. Split each file into CODE / STRING / COMMENT spans.
#    Done with a hand scanner rather than a regex: a `//` inside a string and a
#    `"` inside a comment both defeat regex splitting, and both occur here.
# --------------------------------------------------------------------------

CODE, STR, COMMENT = "code", "str", "comment"


def spans_js(src):
    """Yield (kind, start, end) over a JavaScript source string."""
    i, n = 0, len(src)
    out = []
    start = 0
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            out.append((CODE, start, i))
            j = src.find("\n", i)
            j = n if j < 0 else j
            out.append((COMMENT, i, j))
            i = start = j
        elif c == "/" and nxt == "*":
            out.append((CODE, start, i))
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append((COMMENT, i, j))
            i = start = j
        elif c in "\"'`":
            out.append((CODE, start, i))
            j = i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == c:
                    j += 1
                    break
                if c != "`" and src[j] == "\n":
                    break            # unterminated: bail at EOL
                j += 1
            out.append((STR, i, j))
            i = start = j
        else:
            i += 1
    out.append((CODE, start, n))
    return [s for s in out if s[1] < s[2]]


def spans_py(src):
    i, n = 0, len(src)
    out = []
    start = 0
    while i < n:
        c = src[i]
        if c == "#":
            out.append((CODE, start, i))
            j = src.find("\n", i)
            j = n if j < 0 else j
            out.append((COMMENT, i, j))
            i = start = j
        elif c in "\"'":
            trip = src[i:i + 3]
            if trip in ('"""', "'''"):
                out.append((CODE, start, i))
                j = src.find(trip, i + 3)
                j = n if j < 0 else j + 3
                # A module/function docstring is prose: treat it as a comment,
                # so numbers quoted in it are evidence, not code.
                out.append((COMMENT, i, j))
                i = start = j
            else:
                out.append((CODE, start, i))
                j = i + 1
                while j < n:
                    if src[j] == "\\":
                        j += 2
                        continue
                    if src[j] == c or src[j] == "\n":
                        j += 1 if src[j] == c else 0
                        break
                    j += 1
                out.append((STR, i, j))
                i = start = j
        else:
            i += 1
    out.append((CODE, start, n))
    return [s for s in out if s[1] < s[2]]


# --------------------------------------------------------------------------
# 2. Literal extraction
# --------------------------------------------------------------------------

# A number not glued to an identifier.  `(?<![\w$.])` keeps us off `v2`,
# `L2UI_CH3`, `this.x2` and the `.5` of an already-matched `0.5`.
NUM = re.compile(r"(?<![\w$.])(0[xX][0-9a-fA-F]+|\d+\.\d+(?:[eE][-+]?\d+)?|\.\d+|\d+(?:[eE][-+]?\d+)?)")
HEXCOL = re.compile(r"#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b")
FUNCCOL = re.compile(r"\brgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)")

# A string worth scanning: it carries CSS units or a colour.  Everything else
# (paths, manifest keys, SQL, sound references) is data, not geometry.
# Deliberately excludes a bare `s`/`ms` suffix: "%.3f s" in a log line is not
# a CSS duration, and admitting it dragged printf widths into the pool.
CSSY = re.compile(r"\d(px|%|em|rem|deg|vh|vw)\b|#[0-9a-fA-F]{3,8}\b|\brgba?\("
                  r"|translate|scale\(|\bcalc\(|\bborder\b|\bmargin\b|\bpadding\b")

COLOUR_CTX = re.compile(r"colou?r|setHex|Color\(|\bhex\b|tint|emissive|diffuse|specular|background|\bfog\b", re.I)


def extract(path, src, lang):
    spans = spans_js(src) if lang == "js" else spans_py(src)
    # line index for offset -> (lineno, line text)
    starts = [0]
    for m in re.finditer(r"\n", src):
        starts.append(m.end())

    def lineno(off):
        lo, hi = 0, len(starts) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if starts[mid] <= off:
                lo = mid
            else:
                hi = mid - 1
        return lo + 1

    lines = src.split("\n")
    hits = []
    seen = set()

    for kind, a, b in spans:
        if kind == COMMENT:
            continue
        text = src[a:b]
        if kind == STR and not CSSY.search(text):
            continue
        for m in HEXCOL.finditer(text):
            off = a + m.start()
            if off in seen:
                continue
            seen.add(off)
            hits.append((lineno(off), m.group(0), "colour", kind))
        for m in FUNCCOL.finditer(text):
            off = a + m.start()
            seen.add(off)
            hits.append((lineno(off), m.group(0), "colour", kind))
            for k in range(m.start(), m.end()):
                seen.add(a + k)
        for m in NUM.finditer(text):
            off = a + m.start()
            if off in seen:
                continue
            # skip a number that is part of a hex colour we already took
            if any(off >= s and off < s + 9 for s in ()):
                continue
            seen.add(off)
            raw = m.group(0)
            ln = lineno(off)
            col = m.start() - (starts[ln - 1] - a) if False else off - starts[ln - 1]
            hits.append((ln, raw, "number", kind, col))

    out = []
    for h in hits:
        ln = h[0]
        line = lines[ln - 1] if ln - 1 < len(lines) else ""
        out.append({
            "file": os.path.relpath(path, REPO),
            "line": ln,
            "raw": h[1],
            "type": h[2],
            "where": h[3],
            "text": line.strip()[:200],
        })
    out.sort(key=lambda d: (d["line"], d["raw"]))
    return out, lines


# --------------------------------------------------------------------------
# 3. Evidence window: the comment attached to a literal
# --------------------------------------------------------------------------

def is_comment_line(s, lang):
    t = s.strip()
    if lang == "js":
        return t.startswith(("//", "*", "/*")) or t.endswith("*/")
    return t.startswith("#")


def evidence(lines, ln, lang, lookback=4):
    """The comment ATTACHED to this literal, and nothing further away.

    Attached means: a trailing comment on the same line, or the contiguous
    comment block directly above it (one blank line tolerated), or a comment
    within `lookback` lines above -- which covers the common
    `// note` / `const A = 1;` / `const B = 2;` run of related constants.

    The window is deliberately tight.  An earlier draft used 14 lines and
    produced false SOURCED verdicts: a literal in `audio.js` inherited the
    word "retail" from a comment about a different constant three statements
    away.  Evidence has to be next to the thing it justifies.
    """
    parts = []
    line = lines[ln - 1] if ln - 1 < len(lines) else ""
    if lang == "js":
        for m in re.finditer(r"//(.*)$|/\*(.*?)\*/", line):
            parts.append(m.group(0))
    else:
        m = re.search(r"#(.*)$", line)
        if m:
            parts.append(m.group(0))
    i = ln - 2
    blanks = 0
    while i >= 0 and len(parts) < 400:
        s = lines[i]
        if not s.strip():
            blanks += 1
            if blanks > 1:
                break
            i -= 1
            continue
        if is_comment_line(s, lang):
            parts.append(s)
            i -= 1
            blanks = 0
            continue
        break
    for j in range(max(0, ln - 1 - lookback), ln - 1):
        if is_comment_line(lines[j], lang):
            parts.append(lines[j])

    # A literal inside a data table inherits the table's header comment.
    #
    #   // Channel colors: the DLL-mined table (docs/ui-mined-native.md S2 ...)
    #   const CHANNELS = {
    #     0: { name: 'all', color: '#DCDCDC' },     <- justified by the header
    #
    # Without this, every row of every sourced table read as UNSOURCED and the
    # bucket was mostly false positives.  Restricted to lines that OPEN an
    # object/array literal (a declaration), not to function bodies -- a
    # function's docstring must not bless every number inside it.
    for opener in enclosing_declarations(lines, ln, lang, levels=2):
        parts.append(_comment_block_above(lines, opener, lang))
    return " \n".join(p for p in parts if p)


def _comment_block_above(lines, ln, lang):
    out = []
    i = ln - 2
    blanks = 0
    while i >= 0:
        s = lines[i]
        if not s.strip():
            blanks += 1
            if blanks > 1:
                break
            i -= 1
            continue
        if is_comment_line(s, lang):
            out.append(s)
            blanks = 0
            i -= 1
            continue
        break
    return " \n".join(out)


DECL_OPEN = re.compile(r"[:=]\s*[\{\[]\s*$|^\s*(const|let|var|export const)\s+[\w$]+\s*=\s*[\{\[]\s*$"
                       r"|^\s*[A-Za-z_][\w.]*\s*=\s*[\{\[(]\s*$")


def enclosing_declarations(lines, ln, lang, levels=2):
    """Line numbers of the object/array-literal declarations enclosing `ln`."""
    found = []
    depth = 0
    i = ln - 2
    while i >= 0 and len(found) < levels:
        s = lines[i]
        if is_comment_line(s, lang):
            i -= 1
            continue
        code = re.sub(r"(['\"]).*?\1", "", s)
        closers = code.count("}") + code.count("]") + code.count(")")
        openers = code.count("{") + code.count("[") + code.count("(")
        if closers > openers:
            depth += closers - openers
        elif openers > closers:
            if depth == 0:
                if DECL_OPEN.search(code):
                    found.append(i + 1)
                else:
                    break       # a function body or control block: stop
            else:
                depth -= min(depth, openers - closers)
        i -= 1
    return found


# --------------------------------------------------------------------------
# 4. Classification
# --------------------------------------------------------------------------

# A sourcing word inside a negation is a CONFESSION, not a citation.
# `// rad/s toward heading -- NOT sourced, see report` must not read as SOURCED
# just because it contains the word "sourced".  This fires before both other
# regexes and lands the literal in AUTHORED.
NEGATED_RE = re.compile(
    r"\b(not|never|no|isn'?t|wasn'?t|cannot|can'?t|un)[- ]?"
    r"(sourced|measured|verified|decoded|from retail|retail|derived|a decode)\b"
    r"|\bunsourced\b|\bnot a decode\b|\bno (real )?source\b|\bstill unknown\b"
    r"|\bcorroboration, not\b|\bcalibration, not\b",
    re.I)

AUTHORED_RE = re.compile(
    r"\bAUTHORED\b|\bDEVIATION\b|\binvent(ed|ion)?\b|\bplaceholder\b|\bapprox\w*\b"
    r"|\bguess\w*\b|\barbitrar\w+\b|\btuned?\b|\bhand-?(picked|chosen|tuned)\b"
    r"|\beyeball\w*\b|\bheuristic\w*\b|\bnot (from )?retail\b|\bno source\b"
    r"|\bunsourced\b|\bours\b|\bmade up\b|\bad hoc\b|\bplausible\b|\bcalibration\b",
    re.I)

SOURCED_RE = re.compile(
    # explicit markers
    r"\bSOURCED\b|\bMEASURED\b|\bVERIFIED\b|\bdecoded\b|\bcross-?check\w*\b"
    # client binaries / formats
    r"|\.(dat|utx|ukx|unr|psa|psk|uax|usx|int|xdat|gly|u)\b"
    r"|\bxdat\b|\bumodel\b|\bl2lib\b|\bInterface\.u\b|\bEngine\.u\b|\bNWindow\b"
    # named client tables
    r"|\b(npcgrp|itemgrp|weapongrp|armorgrp|chargrp|skillgrp|skillsoundgrp"
    r"|actionname|sysstring|systemmsg|itemname|skillname|npcname|charcreate"
    r"|playerlevel|TerrainInfo|StaticMesh|l2ui|L2UI)\w*\b"
    # server origins
    r"|\baCis\b|\bL2J\b|\bpacket\b|\bopcode\b|\bthe server\b|\bserver(-| )side\b"
    r"|\bMariaDB\b|\bdatapack\b|\bXML\b"
    # measurement language tied to the real client
    r"|\bretail\b|\bfrom the client\b|\bclient's own\b|\bin-?game\b"
    r"|\bmined\b|\bextract(ed|or)\b|\bumodel\b|\bground truth\b",
    re.I)

# ---- BENIGN rules --------------------------------------------------------

MATHY = {
    "180", "360", "90", "270", "3.14159", "3.141592653589793", "6.28318",
    "65536", "32768", "255", "256", "1000", "1024", "100", "60", "3600",
    "16", "8", "4", "32", "64", "128", "512", "2048", "4096",
    "200", "404", "500", "0.5",
}
HTTP = {"200", "201", "204", "301", "302", "400", "401", "403", "404", "500"}


def benign(hit, line, lang):
    raw = hit["raw"]
    if hit["type"] == "colour":
        # #000 / #fff / pure black+white are structural, not decoded art
        v = raw.lower().lstrip("#")
        if v in ("000", "fff", "000000", "ffffff", "ffffffff", "00000000"):
            return "black/white"
        if raw.lower().startswith("rgb"):
            nums = re.findall(r"[\d.]+", raw)
            if len(set(nums[:3])) == 1:
                return "greyscale"
        return None

    try:
        val = float(int(raw, 16)) if raw.lower().startswith("0x") else float(raw)
    except ValueError:
        return None

    if raw in ("0", "1", "-1") or val in (0.0, 1.0):
        return "0/1"
    if val == -1:
        return "0/1"

    # ---- bit / byte mechanics -------------------------------------------
    # Anything on a line that shifts or masks is describing a bit layout, and
    # a bit layout is fixed by the format, not chosen by us.
    BITOP = re.compile(r"<<|>>|>>>|(?<![&])&(?![&])|(?<![|])\|(?![|])|\^")
    if BITOP.search(line):
        return "bit arithmetic"
    if raw.lower().startswith("0x") and re.fullmatch(r"0[xX][fF0]+", raw):
        return "bit mask"
    # A large hex constant named TAG/MAGIC/SIGNATURE is a file signature.
    if raw.lower().startswith("0x") and val >= 0x1000 and \
            re.search(r"\b(TAG|MAGIC|SIG|SIGNATURE|HEADER|FOURCC)\b", line, re.I):
        return "format magic"

    # Byte-level file walking: widths, cursors, struct field sizes.
    if val == int(val) and 0 < val <= 256 and re.search(
            r"struct\.(un)?pack|from_bytes|to_bytes|\.read\(|\.seek\(|\.tell\("
            r"|\b(pos|off|offset|cursor|ptr|idx)\s*[-+]?=|\bbytes\(|\bbytearray\("
            r"|\bmemoryview\b|frombuffer|\.decode\(|\.encode\(|utf-?16|utf-?8"
            r"|DataView|Uint8|Uint16|Uint32|Int8|Int16|Int32|Float32|Float64"
            r"|getUint|getInt|getFloat|setUint|byteLength|byteOffset|BYTES_PER",
            line):
        return "binary layout"

    # Integer-division block maths (DXT 4x4 blocks, tile strides, page sizes).
    # NOT applied inside a string: a CSS declaration is geometry, and the `%`
    # of a neighbouring `width:100%` was quietly excusing `padding:9px`.
    if hit["where"] != STR and val == int(val) and 0 < val <= 64 \
            and re.search(r"//|Math\.floor|\|\s*0\b|%", line):
        return "block/integer arithmetic"

    # Radix and precision arguments.
    if re.search(r"parseInt\([^)]*,\s*" + re.escape(raw) + r"\s*\)"
                 r"|toString\(\s*" + re.escape(raw) + r"\s*\)"
                 r"|toFixed\(\s*" + re.escape(raw) + r"\s*\)"
                 r"|\bround\([^)]*,\s*" + re.escape(raw) + r"\s*\)", line):
        return "radix/precision"

    # Loop bounds.
    if val == int(val) and 0 < val <= 64 and re.search(
            r"\brange\([^)]*\b" + re.escape(raw) + r"\b|for\s*\([^;]*;[^;]*<=?\s*"
            + re.escape(raw) + r"\b", line):
        return "loop bound"

    # Process exit codes.
    if val == int(val) and 0 <= val <= 3 and re.search(r"sys\.exit|process\.exit|exit\(", line):
        return "exit code"

    # array subscript / small structural index
    if val == int(val) and 0 <= val <= 15:
        if re.search(r"\[\s*" + re.escape(raw) + r"\s*\]", line):
            return "array index"
        if re.search(r"\.(slice|substr|substring|charAt|splice|indexOf|at|toFixed|padStart|padEnd|repeat)\s*\([^)]*\b"
                     + re.escape(raw) + r"\b", line):
            return "string/array arithmetic"
        if re.search(r"\.length\s*[-+]\s*" + re.escape(raw), line):
            return "length arithmetic"

    # halving / doubling / squaring
    if raw == "2" and re.search(r"[/*%]\s*2\b|\b2\s*\*|\*\*\s*2|Math\.pow\([^,]+,\s*2", line):
        return "halve/double/square"
    if raw == "2" and re.search(r"\btoFixed\(2\)|\bpadStart\(2|\bslice\(-?2", line):
        return "formatting"

    # unit conversion and angle maths
    if raw in ("1000", "60", "3600") and re.search(r"/\s*" + raw + r"\b|\*\s*" + raw + r"\b", line):
        return "time unit conversion"
    if raw in ("180", "360", "90", "270") and re.search(r"Math\.PI|PI|deg|rad|heading|angle", line, re.I):
        return "angle constant"
    if raw in ("65536", "32768") and re.search(r"head|angle|yaw|rot", line, re.I):
        return "L2 heading unit (2^16)"
    # 32768 is the G16 heightmap's zero point -- fixed by the format, the same
    # way 65536 is fixed for a UE Rotator.  Without this the four height
    # decoders each contributed a false UNSOURCED hit.
    if raw == "32768" and re.search(r"height|heights|hmAt|heightScale|origin\[2\]|terrainZ",
                                    line, re.I):
        return "G16 heightmap zero point (2^15)"
    # itemSize on a typed attribute: 3 for a vec3, 2 for a uv, 4 for a colour.
    if raw in ("2", "3", "4") and re.search(
            r"BufferAttribute|setAttribute|itemSize|Float32Array|Uint16Array", line):
        return "vector component count"
    if raw == "360" and re.search(r"setHSL|hue|hsl", line, re.I):
        return "degrees per turn"
    if raw in ("255", "256") and re.search(r"byte|/\s*255|\* *255|0\.\.255|clamp|255\b", line, re.I):
        return "byte range"
    if raw.startswith("3.14159") or raw.startswith("6.28318") or raw.startswith("2.7182"):
        return "math constant"
    if raw in HTTP and re.search(r"status|code|HTTP|res\.|response", line, re.I):
        return "HTTP status"
    if re.search(r"^\s*(#|//)?\s*(import|from|require|version|__version__)", line):
        return "import/version"

    # CSS structural zeroes and full-percent
    if hit["where"] == STR and re.search(r"\b" + re.escape(raw) + r"(px|%)?\b", line):
        if val in (0.0, 100.0) and hit["type"] == "number":
            return "css 0/100%"

    # exponent-style tolerances written as 1e-6 etc are numerics of last resort;
    # they stay in the pool.
    return None


def classify(hit, lines, lang):
    line = lines[hit["line"] - 1] if hit["line"] - 1 < len(lines) else ""
    b = benign(hit, line, lang)
    if b:
        return "BENIGN", b
    ev = evidence(lines, hit["line"], lang)
    mn = NEGATED_RE.search(ev)
    if mn:
        return "AUTHORED", "negated: " + mn.group(0)
    ma = AUTHORED_RE.search(ev)
    ms = SOURCED_RE.search(ev)
    if ma and (not ms or ma.start() <= ms.start()):
        return "AUTHORED", ma.group(0)
    if ms:
        return "SOURCED", ms.group(0)
    if ma:
        return "AUTHORED", ma.group(0)
    return "UNSOURCED", ""


# --------------------------------------------------------------------------
# 4b. Impact dimensions: WHERE the literal lives and WHAT it controls.
#     Ranking by these is the point -- a wrong colour in a window the player
#     stares at outranks a tolerance in a loader, and only the domain/role
#     pair can say which is which without a human reading all 8,000 lines.
# --------------------------------------------------------------------------

def domain(relpath):
    if relpath.startswith("editor/world/js/ui/"):
        return "client-ui"          # on screen, always, in front of the player
    if relpath.startswith("editor/world/js/"):
        base = os.path.basename(relpath)
        if base in ("audio.js", "gamesound.js", "worldaudio.js"):
            return "client-audio"
        if base in ("chat.js", "labels.js", "charsheet.js"):
            return "client-ui"
        return "client-world"       # on screen while playing
    if "/tests/" in relpath or os.path.basename(relpath).startswith(("test_", "verify_")):
        return "tool-test"
    if relpath.startswith("tools/l2lib/") or relpath.startswith("tools/utx/") \
            or "parse_" in relpath or "unrparse" in relpath:
        return "tool-parser"        # format mechanics; a wrong value fails loudly
    return "tool-pipeline"          # bakes values INTO assets: silent when wrong


DOMAIN_WEIGHT = {
    "client-ui": 5, "client-world": 4, "tool-pipeline": 3,
    "client-audio": 3, "tool-parser": 1, "tool-test": 0,
}

ROLE_PATTERNS = [
    ("colour",    re.compile(r"colou?r|#[0-9a-fA-F]{3,8}\b|rgba?\(|setHex|tint|emissive|Color")),
    ("geometry",  re.compile(r"Skin\.px|\b(left|top|right|bottom|width|height|x|y|w|h|inset|pad|margin|offset|gap|size)\b\s*[:=]|position|translate")),
    ("scale",     re.compile(r"scale|zoom|\bsize\b|SCALE|_MUL|multiplier|factor")),
    ("timing",    re.compile(r"\b(ms|sec|second|duration|delay|fade|timeout|interval|cooldown|period|rate|fps|tick)\b", re.I)),
    ("font",      re.compile(r"font|fontSize|lineHeight|letterSpacing|Font\.")),
    ("physics",   re.compile(r"speed|velocity|gravity|accel|radius|distance|dist|range|height|near|far")),
    ("tolerance", re.compile(r"epsilon|tolerance|tol\b|threshold|EPS|slack|margin of|allow")),
    ("opacity",   re.compile(r"opacity|alpha|fade|blend")),
]
ROLE_WEIGHT = {
    "colour": 5, "geometry": 5, "font": 4, "opacity": 4, "scale": 3,
    "physics": 3, "timing": 2, "tolerance": 1, "other": 2,
}


def role(hit, line):
    if hit["type"] == "colour":
        return "colour"
    for name, rx in ROLE_PATTERNS:
        if rx.search(line):
            return name
    return "other"


def impact(hit):
    return DOMAIN_WEIGHT.get(hit["domain"], 1) * ROLE_WEIGHT.get(hit["role"], 2)


# --------------------------------------------------------------------------
# 5. Walk
# --------------------------------------------------------------------------

def targets():
    out = []
    for root, dirs, files in os.walk(JS_ROOT):
        dirs[:] = [d for d in dirs if d not in ("vendor", "node_modules")]
        for f in sorted(files):
            if f.endswith(".js"):
                out.append((os.path.join(root, f), "js"))
    for root, dirs, files in os.walk(PY_ROOT):
        p = root + "/"
        if any(s in p for s in PY_SKIP):
            dirs[:] = []
            continue
        for f in sorted(files):
            if f.endswith(".py"):
                out.append((os.path.join(root, f), "py"))
    return sorted(out)


def run():
    rows = []
    for path, lang in targets():
        try:
            src = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        hits, lines = extract(path, src, lang)
        for h in hits:
            bucket, why = classify(h, lines, lang)
            line = lines[h["line"] - 1] if h["line"] - 1 < len(lines) else ""
            h["bucket"] = bucket
            h["why"] = why
            h["lang"] = lang
            h["domain"] = domain(h["file"])
            h["role"] = role(h, line)
            h["impact"] = impact(h)
            rows.append(h)
    return rows


# --------------------------------------------------------------------------
# 6. Reporting
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", metavar="BUCKET", help="print every literal in a bucket")
    ap.add_argument("--file", help="restrict to files whose path contains this")
    ap.add_argument("--json", metavar="PATH", help="dump all rows as JSON")
    ap.add_argument("--check", action="store_true", help="fail if UNSOURCED grew past the baseline")
    ap.add_argument("--write-baseline", action="store_true")
    ap.add_argument("--top", type=int, default=25)
    ap.add_argument("--rank", type=int, metavar="N", help="top N UNSOURCED by visual impact")
    args = ap.parse_args()

    rows = run()
    if args.file:
        rows = [r for r in rows if args.file in r["file"]]

    counts = Counter(r["bucket"] for r in rows)
    per_file = defaultdict(Counter)
    for r in rows:
        per_file[r["file"]][r["bucket"]] += 1

    if args.json:
        with open(args.json, "w") as fh:
            json.dump(rows, fh, indent=1)

    if args.write_baseline:
        base = {f: c["UNSOURCED"] for f, c in per_file.items() if c["UNSOURCED"]}
        with open(BASELINE, "w") as fh:
            json.dump(base, fh, indent=1, sort_keys=True)
        print(f"baseline written: {len(base)} files, {sum(base.values())} UNSOURCED")
        return 0

    if args.rank:
        pool = [r for r in rows if r["bucket"] == "UNSOURCED"]
        pool.sort(key=lambda r: (-r["impact"], r["file"], r["line"]))
        for r in pool[:args.rank]:
            print(f"{r['impact']:3d}  {r['domain']:<13} {r['role']:<9} "
                  f"{r['file']}:{r['line']}  {r['raw']}\n     {r['text']}")
        print(f"\n{len(pool)} UNSOURCED total; showing top {min(args.rank, len(pool))} by impact")
        print("\n== UNSOURCED by domain ==")
        for d, n in Counter(r["domain"] for r in pool).most_common():
            print(f"  {d:<14} {n}")
        print("\n== UNSOURCED by role ==")
        for d, n in Counter(r["role"] for r in pool).most_common():
            print(f"  {d:<14} {n}")
        return 0

    if args.list:
        want = args.list.upper()
        for r in rows:
            if r["bucket"] == want:
                tag = f" [{r['why']}]" if r["why"] else ""
                print(f"{r['file']}:{r['line']}: {r['raw']}{tag}\n    {r['text']}")
        print(f"\n{len([r for r in rows if r['bucket'] == want])} in {want}")
        return 0

    total = sum(counts.values())
    print("== bucket counts ==")
    for b in ("BENIGN", "SOURCED", "AUTHORED", "UNSOURCED"):
        n = counts[b]
        print(f"  {b:<10} {n:6d}  {100.0 * n / max(1, total):5.1f}%")
    print(f"  {'TOTAL':<10} {total:6d}")

    print(f"\n== top {args.top} files by UNSOURCED ==")
    ranked = sorted(per_file.items(), key=lambda kv: -kv[1]["UNSOURCED"])
    for f, c in ranked[:args.top]:
        if not c["UNSOURCED"]:
            break
        print(f"  {c['UNSOURCED']:5d}  {f}   (sourced {c['SOURCED']}, authored {c['AUTHORED']}, benign {c['BENIGN']})")

    if args.check:
        try:
            base = json.load(open(BASELINE))
        except OSError:
            print("\nno baseline; run --write-baseline first", file=sys.stderr)
            return 2
        bad = []
        for f, c in per_file.items():
            if c["UNSOURCED"] > base.get(f, 0):
                bad.append((f, base.get(f, 0), c["UNSOURCED"]))
        if bad:
            print("\nREGRESSION — UNSOURCED literals added:", file=sys.stderr)
            for f, was, now in sorted(bad):
                print(f"  {f}: {was} -> {now}", file=sys.stderr)
            return 1
        print("\n--check OK: no file exceeds its UNSOURCED baseline")
    return 0


if __name__ == "__main__":
    sys.exit(main())
