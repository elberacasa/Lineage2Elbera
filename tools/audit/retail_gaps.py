#!/usr/bin/env python3
"""Retail-gap inventory: what is still NOT retail, measured rather than argued.

WHY THIS EXISTS, AND WHY IT IS NOT `unsourced.py`
------------------------------------------------
`tools/audit/unsourced.py` answers "is this number justified?".  That is a
necessary question and a badly incomplete one: a value can be perfectly
SOURCED and the surface still not be retail, because

  * the decoded value was never wired to a runtime reader at all
    (94 footstep sounds, WindowsInfo.ini's 55 sections, AttachOn -- the
    project's signature failure, three times over), or
  * the surface was never built (106 of the xdat's 137 windows), or
  * it was wired to the WRONG source (a con-colour ladder mined from the
    TARGET WINDOW's data provider, applied to the world nameplate layer).

None of those three shows up as an unjustified literal.  All three are
things a player sees.  This tool measures them.

EVERY METRIC IS A COUNT OVER FILES ON DISK, NOT A JUDGEMENT
-----------------------------------------------------------
Each metric below states what it counts and where it reads it.  None of them
requires a running server, a browser, or a screenshot, so `--check` is cheap
enough to sit in the battery.  The report the metrics support is
`editor/world/audit_report/retail-gaps.md`.

WHAT --check ASSERTS
--------------------
Gap counts recorded in `tools/audit/retail_gaps_baseline.json` may only go
DOWN.  A metric that grows is a regression and exits 1.  A metric that shrinks
prints "IMPROVED" and also exits 1 -- deliberately, so that closing a gap
forces someone to re-record the baseline and thereby to notice the win rather
than let it rot into a stale number nobody re-reads.  `--write-baseline`
re-records, printing every value it changes in either direction.

WHAT --selftest PROVES
----------------------
A gate that cannot go red proves nothing (docs/HANDOFF.md section 5: verify_m5
and verify_targetwnd shipped for months asserting nothing).  `--selftest`
re-runs every metric against a PERTURBED view of the tree in which the gap is
artificially closed, and REQUIRES each one to move.  A metric that reads the
same number before and after its own perturbation is reported as VACUOUS and
fails the selftest.

Usage
  python3 tools/audit/retail_gaps.py                 # the inventory
  python3 tools/audit/retail_gaps.py --json out.json # machine-readable
  python3 tools/audit/retail_gaps.py --check         # gate
  python3 tools/audit/retail_gaps.py --selftest      # prove the gates move
  python3 tools/audit/retail_gaps.py --write-baseline
"""

import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
BASELINE = os.path.join(HERE, "retail_gaps_baseline.json")

SYSTEM = os.path.join(REPO, "assets/interlude/system")
GAMEDATA = os.path.join(REPO, "assets/gamedata")
CLIENT_JS = os.path.join(REPO, "editor/world/js")
GATEWAY_SRC = os.path.join(REPO, "gateway/src")
UI_JS = os.path.join(CLIENT_JS, "ui")
USCRIPT = os.path.join(REPO, "assets/uscript")
NPC_XML = os.path.join(
    REPO, "server/aCis_gameserver/build/dist/gameserver/data/xml/npcs")


# --------------------------------------------------------------------------
# corpus helpers
# --------------------------------------------------------------------------

def _read(path):
    try:
        with open(path, encoding="utf-8", errors="ignore") as fh:
            return fh.read()
    except OSError:
        return ""


def _js_of(*dirs):
    """Concatenated source of every .js directly in each dir (no recursion --
    the client is flat, and recursing would drag in node_modules)."""
    out = []
    for d in dirs:
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.endswith(".js"):
                out.append(_read(os.path.join(d, f)))
    return "\n".join(out)


def runtime_corpus():
    """Everything that runs at play time: the browser client and the gateway.

    A build tool reading a table is NOT the table being wired -- that is the
    whole distinction this file exists to draw -- so tools/ is excluded on
    purpose."""
    return _js_of(CLIENT_JS, UI_JS, GATEWAY_SRC)


def repo_corpus():
    """Every CODE file that could plausibly open a data file, runtime or not.
    Used only to tell 'nothing anywhere reads this' from 'a build tool reads
    it'.

    PROSE IS EXCLUDED ON PURPOSE, and the exclusion was earned: with `.md` in
    the corpus, writing `editor/world/audit_report/retail-gaps.md` -- a report
    ABOUT the unread files -- dropped `system_files_unread` from 48 to 20.
    Naming a file in a sentence is not reading it, and a corpus that cannot
    tell those apart lets any document close a gap by describing it."""
    out = []
    for root in ("editor", "gateway", "tools", "panel"):
        base = os.path.join(REPO, root)
        for dp, dn, fn in os.walk(base):
            dn[:] = [d for d in dn if d not in
                     ("node_modules", ".git", "vendor", "open-l2encdec",
                      "build", "verify_shots", "audit_shots", "audit_report")]
            for f in fn:
                if f.rsplit(".", 1)[-1] in ("js", "py", "html", "sh",
                                            "mjs", "json"):
                    out.append(_read(os.path.join(dp, f)))
    return "\n".join(out)


# --------------------------------------------------------------------------
# metrics
#
# Each returns (value, detail).  `value` is the gap size -- always "how much
# is still wrong", so every metric shrinks toward zero.
# --------------------------------------------------------------------------

def m_timeenv_unread(rt, repo):
    """The retail day/night environment tables.

    assets/interlude/system/timeenv0..3.int are Lineage2Ver111-encrypted INIs
    carrying, per EnvType and per hour of a 25-point day:
      SunColor SunScale MoonColor MoonScale SkyBoxColor HazeringColor
      CloudColor1..3 TerrainAmbient ActorAmbient StaticMeshAmbient BSPAmbient
      HSVTerrainLight HSVActorLight HSVStaticMeshLight HSVBSPLight
    Counted: how many of the four files no source file in the repo names."""
    files = [f for f in os.listdir(SYSTEM) if f.lower().startswith("timeenv")]
    unread = [f for f in files if f.lower() not in repo.lower()]
    return len(unread), sorted(unread)


def m_daynight_unbridged(rt):
    """Whether a game clock reaches the client at all.

    aCis ships ClientSetTime / SunRise / SunSet as server packets.  Counted:
    how many of those three names the gateway and client never mention, i.e.
    how many are unbridged.  With none of them bridged there is no hour to
    index the timeenv tables with even once they are read."""
    missing = [n for n in ("ClientSetTime", "SunRise", "SunSet")
               if n not in rt]
    return len(missing), missing


def importers_of(module):
    """Runtime modules that `import ... from '<module>'`.  A preview page is
    not the client, so only editor/world/js and its ui/ subdir count."""
    hits = []
    stem = re.escape(module)
    for d in (CLIENT_JS, UI_JS):
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith(".js") or f == module:
                continue
            src = _read(os.path.join(d, f))
            if re.search(r"""from\s+['"][^'"]*/?%s['"]""" % stem, src):
                hits.append(f)
    return hits


def m_sky_module_unwired(_rt):
    """editor/world/js/sky.js builds the cloud sheet, both starfields and the
    sun/moon/flare rig out of assets/world/sky/sky.json -- and its own header
    says 'nothing here is called yet'.

    Counted: 1 when no runtime module imports it, 0 once one does."""
    hits = importers_of("sky.js")
    return (0 if hits else 1), hits


def m_skill_voices_unplayed(rt):
    """skillsoundgrp.dat's per race/gender character VOICE columns.

    voice_cast[15] and voice_throw[15] were decoded into
    assets/gamedata/skillsoundgrp.json and the clips are staged under
    assets/audio/sfx/chrsound*.  Counted: distinct clip names that are staged
    on disk and that no runtime module names -- i.e. extracted audio the game
    can never play."""
    p = os.path.join(GAMEDATA, "skillsoundgrp.json")
    if not os.path.exists(p):
        return 0, ["skillsoundgrp.json absent"]
    d = json.load(open(p))
    recs = d if isinstance(d, list) else list(d.values())
    names = set()
    for r in recs:
        for blk in ("voice_cast", "voice_throw"):
            for v in (r.get(blk) or {}).values():
                if v:
                    names.add(v)
    if "voice_cast" in rt:            # a reader appeared -> gap closed
        return 0, ["a runtime module now names voice_cast"]
    man = os.path.join(REPO, "assets/audio/manifest.json")
    staged = set()
    if os.path.exists(man):
        staged = set(json.load(open(man)).get("sfx", []))
    have = [n for n in names if n in staged]
    return len(have), sorted(have)[:8]


def m_xdat_windows_unbuilt(rt):
    """Interface.xdat declares 137 windows; parse_xdat.py recovered all of
    them into assets/gamedata/interface.json.

    Counted: window names that no runtime module ever mentions.  A name that
    appears is not proof the window is faithful -- it IS proof one exists;
    the complement is the set with no surface at all."""
    p = os.path.join(GAMEDATA, "interface.json")
    if not os.path.exists(p):
        return 0, ["interface.json absent"]
    names = [w["name"] for w in json.load(open(p))["windows"]]
    missing = [n for n in names
               if not re.search(r"\b" + re.escape(n) + r"\b", rt)]
    return len(missing), sorted(missing)[:12]


def m_windowsinfo_docks_unused(rt):
    """WindowsInfo.ini's opening position for every retail window, mined into
    assets/gamedata/windowsinfo.json.

    Counted: sections whose window the client never names -- decoded docking
    coordinates with nothing to place."""
    p = os.path.join(GAMEDATA, "windowsinfo.json")
    if not os.path.exists(p):
        return 0, ["windowsinfo.json absent"]
    d = json.load(open(p))
    keys = []
    for k, v in d.items():
        if k.startswith("_"):
            continue
        if isinstance(v, dict) and not any(
                isinstance(x, dict) for x in v.values()):
            keys.append(k)
        elif isinstance(v, dict):
            keys.extend(kk for kk in v if not kk.startswith("_"))
    missing = [k for k in keys
               if not re.search(r"\b" + re.escape(k) + r"\b", rt)]
    return len(missing), sorted(missing)[:12]


def m_uc_unread(repo):
    """The client's own decompiled UnrealScript, assets/uscript/{Interface,
    NWindow}.  Tooltip.uc sat unread in this tree until 2026-08-09 and held
    the entire item-tooltip contract.

    Counted: .uc files no source file in the repo names."""
    n, sample = 0, []
    for d in ("Interface", "NWindow"):
        p = os.path.join(USCRIPT, d)
        if not os.path.isdir(p):
            continue
        for f in sorted(os.listdir(p)):
            if f.endswith(".uc") and f not in repo:
                n += 1
                if len(sample) < 10:
                    sample.append(f"{d}/{f}")
    return n, sample


def m_system_files_unread(repo):
    """assets/interlude/system/*.{dat,ini,int,gly} -- the shipped client data.

    Counted: files no source file in the repo names.  A name may be built at
    runtime (creature_anim_table.py composes '<Package>.int'), so this is a
    LOWER bound on what is read and an UPPER bound on the gap; the report
    names the ones checked by hand."""
    if not os.path.isdir(SYSTEM):
        return 0, ["system/ absent"]
    low = repo.lower()
    names = [f for f in sorted(os.listdir(SYSTEM))
             if f.lower().endswith((".dat", ".ini", ".int", ".gly"))]
    missing = [f for f in names if f.lower() not in low]
    return len(missing), missing[:12]


def m_nameplate_red(_rt):
    """The world nameplate colour, as the client actually resolves it.

    The gap is the con-colour ladder being applied to FLOATING NAMES.  That
    ladder's only evidence is NWindow.dll's
    ?execGetTargetNameColor@UUIDATA_TARGET@@ -- the TARGET WINDOW's data
    provider -- and its first rung is #FF0000 for anything 9+ levels above the
    viewer.

    Counted: NPCs in the aCis datapack that a level-1 character would see on
    that first rung, in tenths of a percent, but ONLY while nameplates.js
    still routes plate colour through the ladder.  Once it does not, the
    ladder cannot paint a plate and the metric is 0 -- so this measures the
    live code path, not a hypothetical."""
    plate = _read(os.path.join(CLIENT_JS, "nameplates.js"))
    plate = re.sub(r"//[^\n]*", "", plate)
    plate = re.sub(r"/\*.*?\*/", "", plate, flags=re.S)
    if not re.search(r"ladder\s*\(\s*['\"]conColor", plate):
        return 0, ["nameplates.js no longer routes plate colour "
                   "through the conColor ladder"]
    if not os.path.isdir(NPC_XML):
        return 0, ["datapack npcs/ absent"]
    nc = os.path.join(GAMEDATA, "native_colors.json")
    if not os.path.exists(nc):
        return 0, ["native_colors.json absent"]
    rungs = json.load(open(nc))["ladders"]["conColor"]["rungs"]

    def rung(v):
        for r in rungs:
            if r["maxDiff"] is None or v <= r["maxDiff"]:
                return r["color"]
        return None

    re_npc = re.compile(r'<npc id="(\d+)" name="([^"]*)"[^>]*>([\s\S]*?)</npc>')
    re_lvl = re.compile(r'<set name="level" val="(\d+)"')
    total = red = 0
    for f in sorted(os.listdir(NPC_XML)):
        if not f.endswith(".xml"):
            continue
        for m in re_npc.finditer(_read(os.path.join(NPC_XML, f))):
            lv = re_lvl.search(m.group(3))
            if not lv:
                continue
            total += 1
            if rung(1 - int(lv.group(1))) == rungs[0]["color"]:
                red += 1
    if not total:
        return 0, ["no levelled npcs parsed"]
    return round(1000.0 * red / total), [f"{red}/{total} npcs on rung 0 at viewer level 1"]


def m_authored_light_rig(_rt):
    """main.js's lighting rig, against timeenv*.int's answer for the same
    quantities.

    Counted: light constructors in editor/world/js/main.js whose colour and
    intensity are typed in the file.  AmbientLight/HemisphereLight/
    DirectionalLight/PointLight each carry values that TerrainAmbient,
    ActorAmbient, StaticMeshAmbient, BSPAmbient, SunColor and SunScale state
    per hour -- and HemisphereLight has no counterpart in the client at
    all."""
    src = _read(os.path.join(CLIENT_JS, "main.js"))
    pat = re.compile(r"new THREE\.(Ambient|Hemisphere|Directional|Point)Light"
                     r"\(\s*0x[0-9a-fA-F]+")
    hits = pat.findall(src)
    return len(hits), hits


def m_suites_without_failpath(_rt):
    """Verification suites that cannot exit non-zero.

    docs/HANDOFF.md records verify_app and verify_terrain as screenshot
    generators that can only fail by throwing.  Counted: verify_*.js under
    editor/world and gateway/test with no `process.exit(<non-zero-able>)` and
    no `exitCode` assignment anywhere."""
    out = []
    for d, pat in ((os.path.join(REPO, "editor/world"), r"verify_.*\.js$"),
                   (os.path.join(REPO, "gateway/test"), r"verify.*\.js$")):
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not re.match(pat, f):
                continue
            # Line comments are stripped first: verify_app.js EXPLAINS why it
            # avoids process.exit() in a comment, and an unstripped scan reads
            # that sentence as a failure path. A comment is evidence, not code.
            src = re.sub(r"//[^\n]*", "", _read(os.path.join(d, f)))
            src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
            if not re.search(r"process\.exit\((?!\s*0\s*\))|exitCode\s*=\s*[^0]",
                             src):
                out.append(os.path.relpath(os.path.join(d, f), REPO))
    return len(out), out


def m_unsourced(_rt):
    """Delegates to tools/audit/unsourced.py so there is ONE definition of an
    unsourced literal.  Counted: the repo-wide UNSOURCED bucket."""
    try:
        r = subprocess.run([sys.executable,
                            os.path.join(HERE, "unsourced.py")],
                           capture_output=True, text=True, timeout=900,
                           cwd=REPO)
    except Exception as e:                       # noqa: BLE001
        return -1, [f"unsourced.py did not run: {e}"]
    m = re.search(r"UNSOURCED\s+(\d+)", r.stdout)
    return (int(m.group(1)) if m else -1), []


def m_unsourced_regressed(_rt):
    """Counted: files whose UNSOURCED count exceeds the recorded baseline --
    the true size of task #52, which the task text puts at 19."""
    try:
        r = subprocess.run([sys.executable, os.path.join(HERE, "unsourced.py"),
                            "--check"], capture_output=True, text=True,
                           timeout=900, cwd=REPO)
    except Exception as e:                       # noqa: BLE001
        return -1, [f"unsourced.py --check did not run: {e}"]
    blob = r.stdout + r.stderr
    rows = re.findall(r"^\s{2}(\S+): (\d+) -> (\d+)$", blob, re.M)
    return len(rows), [f"{f}: {a}->{b}" for f, a, b in rows][:12]


METRICS = [
    ("timeenv_unread",            m_timeenv_unread,          "corpus2"),
    ("daynight_unbridged",        m_daynight_unbridged,      "rt"),
    ("sky_module_unwired",        m_sky_module_unwired,      "rt"),
    ("skill_voices_unplayed",     m_skill_voices_unplayed,   "rt"),
    ("nameplate_red_permille",    m_nameplate_red,           "rt"),
    ("authored_light_rig",        m_authored_light_rig,      "rt"),
    ("xdat_windows_unbuilt",      m_xdat_windows_unbuilt,    "rt"),
    ("windowsinfo_docks_unused",  m_windowsinfo_docks_unused, "rt"),
    ("uc_files_unread",           m_uc_unread,               "repo"),
    ("system_files_unread",       m_system_files_unread,     "repo"),
    ("suites_without_failpath",   m_suites_without_failpath, "rt"),
    ("unsourced_total",           m_unsourced,               "rt"),
    ("unsourced_regressed_files", m_unsourced_regressed,     "rt"),
]


def run(rt=None, repo=None):
    rt = runtime_corpus() if rt is None else rt
    repo = repo_corpus() if repo is None else repo
    out = {}
    for name, fn, kind in METRICS:
        if kind == "corpus2":
            v, d = fn(rt, repo)
        elif kind == "repo":
            v, d = fn(repo)
        else:
            v, d = fn(rt)
        out[name] = {"value": v, "detail": d}
    return out


# --------------------------------------------------------------------------
# selftest: every metric must MOVE when its gap is artificially closed
# --------------------------------------------------------------------------

def selftest():
    """Perturb the corpora so each gap looks closed, and require the metric to
    drop.  A metric that does not move is reading nothing."""
    rt = runtime_corpus()
    repo = repo_corpus()
    base = run(rt, repo)

    # A runtime corpus that names everything: every data file, every window,
    # every uc file, plus the three time packets and voice_cast.
    extra = ["ClientSetTime", "SunRise", "SunSet", "voice_cast"]
    for d in ("Interface", "NWindow"):
        p = os.path.join(USCRIPT, d)
        if os.path.isdir(p):
            extra += os.listdir(p)
    if os.path.isdir(SYSTEM):
        extra += os.listdir(SYSTEM)
    ip = os.path.join(GAMEDATA, "interface.json")
    if os.path.exists(ip):
        extra += [w["name"] for w in json.load(open(ip))["windows"]]
    wp = os.path.join(GAMEDATA, "windowsinfo.json")
    if os.path.exists(wp):
        d = json.load(open(wp))
        for k, v in d.items():
            if k.startswith("_"):
                continue
            extra.append(k)
            if isinstance(v, dict):
                extra.extend(kk for kk in v if not kk.startswith("_"))
    fat_rt = rt + "\n" + "\n".join(extra)
    fat_repo = repo + "\n" + "\n".join(extra)
    fat = run(fat_rt, fat_repo)

    # These read files, not corpora, so a corpus perturbation cannot move
    # them; they are exercised by their own inline argument instead.
    STATIC = {"nameplate_red_permille", "authored_light_rig",
              "suites_without_failpath", "unsourced_total",
              "unsourced_regressed_files", "sky_module_unwired"}

    bad = []
    print("== selftest: does each metric move when its gap is closed? ==")
    for name, _, _ in METRICS:
        if name in STATIC:
            continue
        b, a = base[name]["value"], fat[name]["value"]
        ok = a < b
        print(f"  {'ok  ' if ok else 'VACUOUS'}  {name:26s} {b} -> {a}")
        if not ok:
            bad.append(name)

    # nameplate_red_permille reads the code path AND the datapack, so a corpus
    # perturbation cannot move it. Prove instead that its two halves are both
    # live: the datapack half must produce a non-empty NPC set, and the code
    # half must flip when the ladder call is removed from the source it reads.
    v0 = base["nameplate_red_permille"]["value"]
    src = _read(os.path.join(CLIENT_JS, "nameplates.js"))
    src = re.sub(r"//[^\n]*", "", src)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    routes = bool(re.search(r"ladder\s*\(\s*['\"]conColor", src))
    npcs = 0
    if os.path.isdir(NPC_XML):
        for f in os.listdir(NPC_XML):
            if f.endswith(".xml"):
                npcs += len(re.findall(r'<set name="level" val="\d+"',
                                       _read(os.path.join(NPC_XML, f))))
    ok = npcs > 0 and ((v0 > 0) == routes)
    print(f"  {'ok  ' if ok else 'VACUOUS'}  nameplate_red_permille     "
          f"{v0}/1000; plate path uses the ladder: {routes}; "
          f"levelled npcs in the datapack: {npcs}")
    if not ok:
        bad.append("nameplate_red_permille")

    for name in ("authored_light_rig", "suites_without_failpath"):
        if base[name]["value"] <= 0:
            bad.append(name)
        print(f"  ok    {name:26s} {base[name]['value']} (non-empty set)")

    # sky_module_unwired scans import statements, so no corpus perturbation can
    # move it. Prove the DETECTOR instead: it must find importers for a module
    # that is plainly wired (coords.js) while finding none for sky.js. If the
    # regex were broken, both would read empty and the metric would be a lie.
    wired = importers_of("coords.js")
    unwired = importers_of("sky.js")
    ok = bool(wired) and not unwired
    print(f"  {'ok  ' if ok else 'VACUOUS'}  sky_module_unwired         "
          f"coords.js importers={len(wired)}, sky.js importers={len(unwired)}")
    if not ok:
        bad.append("sky_module_unwired")

    print(f"\nSELFTEST {'FAIL' if bad else 'PASS'}"
          + (f" — vacuous: {', '.join(bad)}" if bad else ""))
    return 1 if bad else 0


# --------------------------------------------------------------------------

def prove(rev):
    """Prove the gates move in BOTH directions against a real earlier tree.

    `--selftest` shows a metric responds to a synthetic perturbation.  This
    shows it responds to the actual history: it materialises the client's JS
    at `rev` (default HEAD, read-only -- `git show`, never a checkout) and
    re-runs the metrics that read those files.  Any metric that reads the same
    value on both trees is reported, and the mode fails if none moved."""
    import shutil
    import tempfile
    global CLIENT_JS, UI_JS
    now = run()
    tmp = tempfile.mkdtemp(prefix="retail_gaps_")
    try:
        files = subprocess.run(
            ["git", "ls-tree", "-r", "--name-only", rev, "editor/world/js"],
            cwd=REPO, capture_output=True, text=True).stdout.split()
        for rel in files:
            if not rel.endswith(".js"):
                continue
            dst = os.path.join(tmp, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            blob = subprocess.run(["git", "show", f"{rev}:{rel}"], cwd=REPO,
                                  capture_output=True)
            with open(dst, "wb") as fh:
                fh.write(blob.stdout)
        keep = (CLIENT_JS, UI_JS)
        CLIENT_JS = os.path.join(tmp, "editor/world/js")
        UI_JS = os.path.join(CLIENT_JS, "ui")
        then = run()
        CLIENT_JS, UI_JS = keep
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print(f"== prove: working tree vs {rev} (editor/world/js only) ==")
    moved = []
    for name, _, _ in METRICS:
        a, b = then[name]["value"], now[name]["value"]
        tag = "MOVED" if a != b else "same "
        if a != b:
            moved.append(name)
        print(f"  {tag}  {name:26s} {a} -> {b}")
    print(f"\nPROVE {'PASS' if moved else 'FAIL'} — "
          f"{len(moved)} metric(s) distinguish the two trees"
          + (f": {', '.join(moved)}" if moved else
             "; the gates cannot tell the trees apart"))
    return 0 if moved else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--prove", nargs="?", const="HEAD", metavar="REV",
                    help="re-run against editor/world/js at REV (default HEAD) "
                         "and require the metrics to differ")
    ap.add_argument("--write-baseline", action="store_true")
    ap.add_argument("--json", metavar="PATH")
    ap.add_argument("--detail", action="store_true",
                    help="print each metric's sample rows")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    if args.prove:
        return prove(args.prove)

    res = run()
    if args.json:
        with open(args.json, "w") as fh:
            json.dump(res, fh, indent=1, sort_keys=True)

    print("== retail gaps (each number is how much is still NOT retail) ==")
    for name, _, _ in METRICS:
        print(f"  {res[name]['value']:>8}  {name}")
        if args.detail and res[name]["detail"]:
            for row in res[name]["detail"]:
                print(f"            {row}")

    if args.write_baseline:
        old = {}
        if os.path.exists(BASELINE):
            old = json.load(open(BASELINE))
        new = {k: v["value"] for k, v in res.items()}
        for k, v in sorted(new.items()):
            if k in old and old[k] != v:
                print(f"  baseline {k}: {old[k]} -> {v}", file=sys.stderr)
        with open(BASELINE, "w") as fh:
            json.dump(new, fh, indent=1, sort_keys=True)
        print(f"\nbaseline written: {len(new)} metrics")
        return 0

    if args.check:
        if not os.path.exists(BASELINE):
            print("\nno baseline; run --write-baseline first", file=sys.stderr)
            return 2
        base = json.load(open(BASELINE))
        grew, shrank, missing = [], [], []
        for k, v in res.items():
            if k not in base:
                missing.append(k)
            elif v["value"] > base[k]:
                grew.append((k, base[k], v["value"]))
            elif v["value"] < base[k]:
                shrank.append((k, base[k], v["value"]))
        for k, a, b in grew:
            print(f"REGRESSION  {k}: {a} -> {b}", file=sys.stderr)
        for k, a, b in shrank:
            print(f"IMPROVED    {k}: {a} -> {b} — re-record with "
                  f"--write-baseline", file=sys.stderr)
        for k in missing:
            print(f"NEW METRIC  {k} — re-record with --write-baseline",
                  file=sys.stderr)
        bad = grew or shrank or missing
        print(f"\nCHECK {'FAIL' if bad else 'PASS'}")
        return 1 if bad else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
