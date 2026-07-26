#!/usr/bin/env python3
"""ElberaScript — recover the client's UnrealScript UI sources.

The Interlude UI is three layers, and only one of them is the .xdat:

  Interface.xdat   layout      what each window contains  (tools/xdat/)
  Interface.u      logic       142 classes, one per window
  NWindow.u        framework   UIScript + 28 UIAPI_* control classes

The two .u files are Lineage2Ver111-encrypted UE2 packages. Decrypt them and
every class turns out to carry its ORIGINAL SOURCE TEXT in a `TextBuffer`
export -- UE2 stores the script text alongside the compiled bytecode. So this
is not a disassembler: it recovers the source NCSoft compiled, comments and
all.

That source is the behavioural ground truth for the browser port. When the
xdat cannot answer a question -- how the shortcut bar pages, what resets on
a layout reset, which drag sources the inventory accepts -- the answer is in
here.

Output (gitignored, regenerable):
  assets/uscript/<Package>/<Class>.uc

Usage:
  python3 tools/uscript/extract_uscript.py            # extract
  python3 tools/uscript/extract_uscript.py --check    # verify, write nothing
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "tools"))

SYSTEM = os.path.join(REPO, "assets/interlude/system")
OUT = os.path.join(REPO, "assets/uscript")
L2ENCDEC = os.path.join(REPO, "tools/bin/l2encdec")

# package -> how many classes we expect to recover (regression guard)
PACKAGES = {
    "Interface.u": 142,
    "NWindow.u": 91,
}
PROTOCOL = "111"

CLASS_DECL = re.compile(rb"class\s+(\w+)\s+(?:extends|expands)")


def decrypt(src, dest):
    subprocess.run(
        [L2ENCDEC, "-c", "decode", "-p", PROTOCOL, "-o", dest, src],
        check=True, capture_output=True,
    )


def sources(dec_path, label):
    """Yield (class_name, source_text) for every TextBuffer in the package."""
    from l2lib.ue2package import Package
    pkg = Package(open(dec_path, "rb").read(), label)
    for exp in pkg.exports:
        if pkg.class_name_of(exp) != "TextBuffer":
            continue
        r = pkg.body_reader(exp)
        raw = r.data[r.pos:]
        m = CLASS_DECL.search(raw)
        if not m:
            continue
        body = raw[m.start():]
        # the source is an FString: it ends at the NUL terminator. Do NOT cut
        # at the first non-ASCII byte -- the comments are Korean (EUC-KR) and
        # truncating there loses almost the entire file.
        nul = body.find(b"\x00")
        text = body[:nul if nul > 0 else len(body)].decode("latin-1")
        yield m.group(1).decode("ascii"), text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify only, write nothing")
    args = ap.parse_args()

    if not os.path.exists(L2ENCDEC):
        sys.exit(f"missing {L2ENCDEC} — run tools/build-tools.sh")

    failures, results = [], {}
    with tempfile.TemporaryDirectory() as tmp:
        for pkg_file, expected in PACKAGES.items():
            src = os.path.join(SYSTEM, pkg_file)
            if not os.path.exists(src):
                failures.append(f"{pkg_file}: not found (needs your own client)")
                continue

            dec = os.path.join(tmp, pkg_file + ".dec")
            decrypt(src, dec)
            found = list(sources(dec, pkg_file))
            results[pkg_file] = found

            total = sum(len(t) for _, t in found)
            ok = len(found) >= expected
            print(f"{pkg_file:<14} {len(found):>4} classes "
                  f"(expected >= {expected})  {total/1024:>6.0f} KB  "
                  f"{'ok' if ok else 'SHORT'}")
            if not ok:
                failures.append(
                    f"{pkg_file}: recovered {len(found)} classes, expected {expected}")

    if args.check:
        for f in failures:
            print("  " + f)
        print("CHECK", "FAIL" if failures else "PASS")
        return 1 if failures else 0
    if failures:
        sys.exit("refusing to write: " + "; ".join(failures))

    for pkg_file, found in results.items():
        d = os.path.join(OUT, pkg_file.replace(".u", ""))
        os.makedirs(d, exist_ok=True)
        for name, text in found:
            with open(os.path.join(d, name + ".uc"), "w") as fh:
                fh.write(text)
        print(f"wrote {len(found):>4} sources -> {os.path.relpath(d, REPO)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
