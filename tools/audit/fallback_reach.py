#!/usr/bin/env python3
"""Which `Layout.*(...) || {invented}` fallbacks does the client actually hit?

`tools/ui/audit_guesses.py` exempts this shape by design:

    const size = Layout.size(WND, 'ItemList') || { w: 240, h: 314 };

and calls it "a defensive fallback for missing data".  That is only true when
the lookup SUCCEEDS.  When `Layout.size` returns null for that control, the
literal is not a fallback at all -- it is the number the player sees, and
nobody decoded it.  The exemption then hides exactly the values it was meant
to make safe.

Nobody had checked which case each site is in.  This script does: it finds
every `Layout.<fn>(<window>, <control>)` guarded by `||` or `??` in
`editor/world/js`, resolves the same lookup against the shipped
`assets/gamedata/interface.json` using Layout's own indexing rules (flat
last-wins for a bare name, path index for a slashed name), and reports:

  LIVE   the lookup returns null -> the literal RENDERS.  Unsourced value.
  DEAD   the lookup succeeds     -> the literal never renders.  Harmless.

`--check` fails while any LIVE site exists.

Read-only.  Writes nothing.

  python3 tools/audit/fallback_reach.py
  python3 tools/audit/fallback_reach.py --live      # only the ones that render
  python3 tools/audit/fallback_reach.py --check
"""

import argparse
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
JS_ROOT = os.path.join(REPO, "editor/world/js")
IFACE = os.path.join(REPO, "assets/gamedata/interface.json")

# Layout.size(WND, 'Ctrl') || { w: 240, h: 314 }
#                          ?? { x: 10, y: 82 }
CALL = re.compile(
    r"Layout\.(?P<fn>size|pos|window|tex0|tex|grid|color|align|textId|autosize)\s*\(\s*"
    r"(?P<win>[A-Za-z_$][\w$.]*|'[^']*'|\"[^\"]*\")\s*"
    r"(?:,\s*(?P<ctrl>'[^']*'|\"[^\"]*\"|`[^`]*`|[A-Za-z_$][\w$.]*)\s*)?\)\s*"
    r"(?P<guard>\|\||\?\?)\s*(?P<fb>\{[^{}]*\}|\[[^\][]*\]|[-\w.'\"]+)")

WNDDECL = re.compile(r"^\s*const\s+([A-Z][A-Z0-9_]*)\s*=\s*'([^']+)'", re.M)
LITERAL = re.compile(r"(?<![\w$.])\d+(?:\.\d+)?")


def build_index():
    """Reproduce Layout.load()'s two indexes exactly."""
    doc = json.load(open(IFACE, encoding="utf-8"))
    flat, paths, windows = {}, {}, {}

    def walk(win, node, path):
        flat[f"{win}/{node['name']}"] = node          # last wins
        paths[f"{win}/{path}"] = node
        for c in node.get("children", []):
            walk(win, c, f"{path}/{c['name']}")

    for w in doc["windows"]:
        windows[w["name"]] = w
        flat[f"{w['name']}/"] = w
        paths[f"{w['name']}/"] = w
        for c in w.get("children", []):
            walk(w["name"], c, c["name"])
    return doc, flat, paths, windows


def resolve(fn, win, ctrl, flat, paths, windows):
    """None when Layout would return null (so the fallback renders)."""
    if ctrl is None:
        node = windows.get(win)
    elif "/" in ctrl:
        node = paths.get(f"{win}/{ctrl}")
    else:
        node = flat.get(f"{win}/{ctrl}")
    if node is None:
        return None
    if fn == "size":
        return None if node.get("width") is None or node.get("height") is None else \
            {"w": node["width"], "h": node["height"]}
    if fn == "pos":
        return None if node.get("x") is None or node.get("y") is None else \
            {"x": node["x"], "y": node["y"]}
    if fn in ("tex0",):
        t = node.get("textures") or []
        return t[0] if t else None
    if fn == "tex":
        return node.get("textures") or None
    if fn == "window":
        return node
    return node.get({"color": "color", "align": "align", "textId": "textId",
                     "grid": "grid", "autosize": "autosize"}[fn])


STRLIT = re.compile(r"'([A-Za-z][\w/]{2,})'|\"([A-Za-z][\w/]{2,})\"")
CTRLISH = re.compile(r"(List|Text|Button|Btn|Bar|Icon|Box|Wnd|Item|Tex|Ctrl|Name|Slot|Tab)")


# parse_xdat.py only attempts these decodes for these record types, so a
# candidate of any other type could never have produced a value and must not
# be counted as a failure.  Without this the probe reported four false LIVE
# verdicts: it fed `Layout.grid` the names of OK/Cancel buttons, which no call
# site ever passes and which carry no grid block by construction.
TYPE_GATE = {"grid": {"ItemWindow"}, "color": {"TextBox"},
             "align": {"TextBox"}, "textId": {"TextBox"}}


NEARBY = 30      # lines either side of the call site


def candidates(src, win, flat, paths, windows, fn, at_line=None):
    """(resolving names, failing names) for the control-name strings that could
    reach this call site; None when there are none, so nothing can be said.

    Scoped to +-NEARBY lines around the site.  A whole-file scan reported a
    false LIVE for `statuswnd.js:179`: it counted `StatusWndRightTex` from
    line 101, which that site never receives -- the name is only ever passed
    to `Layout.size` and `Layout.tex0`.  The dynamic variable is always bound
    by a table or loop next to its use, so proximity is the right scope.
    """
    if win is None or win not in windows:
        return None
    lines = src.split("\n")
    if at_line is not None:
        lo = max(0, at_line - 1 - NEARBY)
        region = "\n".join(lines[lo:at_line - 1 + NEARBY])
    else:
        region = src
    names = set()
    for a, b in STRLIT.findall(region):
        s = a or b
        if CTRLISH.search(s):
            names.add(s)
    if not names:
        return None
    gate = TYPE_GATE.get(fn)
    ok, bad = [], []
    for s in sorted(names):
        node = paths.get(f"{win}/{s}") if "/" in s else flat.get(f"{win}/{s}")
        if node is None:
            continue          # a string that is not a control of THIS window
        if gate and node.get("type") not in gate:
            continue          # this call site could never pass it
        got = resolve(fn, win, s, flat, paths, windows)
        (ok if got is not None else bad).append(s)
    if not ok and not bad:
        return None
    return ok, bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true", help="only sites whose fallback renders")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(IFACE):
        print(f"missing {IFACE}", file=sys.stderr)
        return 2
    _doc, flat, paths, windows = build_index()

    live, dead, unknown = [], [], []
    for root, dirs, files in os.walk(JS_ROOT):
        dirs[:] = [d for d in dirs if d not in ("vendor", "node_modules")]
        for fn_ in sorted(files):
            if not fn_.endswith(".js"):
                continue
            path = os.path.join(root, fn_)
            src = open(path, encoding="utf-8", errors="replace").read()
            consts = dict(WNDDECL.findall(src))
            lines = src.split("\n")
            for m in CALL.finditer(src):
                ln = src.count("\n", 0, m.start()) + 1
                winref = m.group("win")
                win = winref.strip("'\"") if winref[0] in "'\"" else consts.get(winref)
                ctrl = m.group("ctrl")
                if ctrl and ctrl[0] in "'\"`":
                    ctrl = ctrl.strip("'\"`")
                elif ctrl:
                    # A dynamic control name (`sec.item`, `ctrl`, a template
                    # literal).  Its value is always one of the control-name
                    # strings this same file mentions, so resolve EVERY string
                    # literal in the file that names a control of this window:
                    # if they all resolve the site cannot reach its fallback.
                    if win is None:
                        win = consts.get(winref)
                    cands = candidates(src, win, flat, paths, windows, m.group("fn"), ln)
                    if cands is None:
                        unknown.append((os.path.relpath(path, REPO), ln,
                                        m.group("fn"), winref, m.group("ctrl"),
                                        m.group("fb").strip()))
                        continue
                    ok, bad = cands
                    rec = (os.path.relpath(path, REPO), ln, m.group("fn"), win,
                           m.group("ctrl") + f" (dynamic; {len(ok)} names resolve, "
                           f"{len(bad)} do not)",
                           m.group("fb").strip(), None if bad else True,
                           lines[ln - 1].strip()[:120])
                    (live if bad else dead).append(rec)
                    continue
                if win is None:
                    unknown.append((os.path.relpath(path, REPO), ln, m.group("fn"),
                                    winref, m.group("ctrl"), m.group("fb").strip()))
                    continue
                got = resolve(m.group("fn"), win, ctrl, flat, paths, windows)
                rec = (os.path.relpath(path, REPO), ln, m.group("fn"), win, ctrl,
                       m.group("fb").strip(), got, lines[ln - 1].strip()[:120])
                (dead if got is not None else live).append(rec)

    def show(rows, tag):
        for f, ln, fn_, win, ctrl, fb, got, text in rows:
            print(f"{tag} {f}:{ln}  Layout.{fn_}({win}, {ctrl!r}) -> "
                  f"{'null' if got is None else got}")
            print(f"     fallback {fb}")

    if args.live:
        show(live, "LIVE")
    else:
        show(live, "LIVE")
        print()
        show(dead, "DEAD")

    nlit = sum(len(LITERAL.findall(r[5])) for r in live)
    print(f"\n{len(live) + len(dead)} guarded Layout lookups"
          f"  ({len(unknown)} unresolvable window/control refs, not counted)")
    print(f"  LIVE (fallback renders)  {len(live)}   -> {nlit} unsourced literals on screen")
    print(f"  DEAD (lookup succeeds)   {len(dead)}")

    if args.check:
        if live:
            print("\n--check: LIVE fallbacks exist; those literals are what render",
                  file=sys.stderr)
            return 1
        print("\n--check OK: every guarded Layout lookup resolves")
    return 0


if __name__ == "__main__":
    sys.exit(main())
