#!/usr/bin/env python3
"""Build assets/gamedata/skillfx.json — the consumable per-skill visual
presentation map: cast animation, sounds, and the REAL retail effect
binding with asset paths that exist on disk.

Inputs (all decoded from the retail client, in this repo):
  assets/gamedata/skillgrp.json           skillgrp.dat — anim code, is_magic,
                                          cast_range, hit_time
  assets/gamedata/skillname.json          skillname-e.dat — display names
  assets/gamedata/skillsoundgrp.json      skillsoundgrp.dat — spell sounds
  assets/gamedata/skillvisualeffect.json  Skill.usk — EXPLICIT per-skill
                                          effect binding (244 skills,
                                          tools/dat/parse_skillfx.py)
  assets/gamedata/lineageeffect.json      LineageEffect.u — 864 effect
                                          classes (emitters/textures/meshes/
                                          colors, tools/dat/parse_skillfx.py)
  assets/library/manifest.json            exported texture index

Effect binding resolution (docs/skillfx-data.md):
  1. explicit     — the skill has a SkillVisualEffect object in Skill.usk.
  2. name-convention — no Skill.usk entry, but the sanitized skill name
     matches exactly ONE effect-class family in LineageEffect.u (prefixes
     never collide per family — verified). This is the mechanism the
     retail client falls back to; flagged so the client can weigh it.
  3. null         — no data. NEVER substituted with an invented effect.

Asset rules (hard): every texture/mesh path in an entry is verified to
exist on disk (library PNGs already exported; static meshes exported by
this tool via umodel into assets/library/<Package>/). Anything that
cannot resolve lands in the entry's "missing" list.

castClip derivation (documented, not invented): Pawn.uc (recovered source
inside Engine.u) declares CastShort (<1s) / CastMid (2-5s) / CastLong
(5s+) per the Korean comments — mapped from skillgrp hit_time. Dance
skills (anim code N) use Social_dance exactly. Physical SpAtkNN clip
selection per letter code is native code and NOT recovered — castClip is
omitted there. All clip names are cross-checked against the Fighter.ukx
name table at build time.

Usage:
  /usr/bin/python3 tools/dat/build_skillfx.py           # write JSON + export meshes
  /usr/bin/python3 tools/dat/build_skillfx.py --check   # verify only
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(ROOT := os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")), "tools", "l2lib"))
from ue2package import load_package  # noqa: E402

GAMEDATA = os.path.join(ROOT, "assets", "gamedata")
LIBRARY = os.path.join(ROOT, "assets", "library")
SOUNDS_DIR = os.path.join(ROOT, "assets", "interlude", "sounds")
UMODEL = os.path.join(ROOT, "tools", "bin", "umodel")
OUT_PATH = os.path.join(GAMEDATA, "skillfx.json")

# mesh package name -> client package file (umodel-exportable static meshes)
MESH_PACKAGES = {
    "LineageEffectsStaticmeshes": "assets/interlude/staticmeshes/LineageEffectsStaticmeshes.usx",
    "FX_E_S": "assets/interlude/staticmeshes/FX_E_S.usx",
    "fx_m_s": "assets/interlude/staticmeshes/fx_m_s.usx",
}
# LineageEffectMeshes (animations/LineageEffectMeshes.ukx) holds UE2
# VertMesh objects which umodel cannot export — listed as missing instead.

# effect-class name suffix -> presentation phase (decoded from the
# Skill.usk explicit bindings: suffix/phase pairs agree there)
SUFFIX_PHASE = {"ca": "casting", "cb": "casting", "cs": "casting",
                "co": "channeling", "fl": "shot", "pr": "shot", "ra": "shot",
                "sp": "shot", "ta": "explosion", "to": "explosion",
                "tc": "explosion"}


def load(name):
    with open(os.path.join(GAMEDATA, name)) as f:
        return json.load(f)


def sanitize(name):
    n = re.sub(r"['\-\.]", "", name.lower())
    return re.sub(r"[^a-z0-9]+", "_", n).strip("_")


# ---------------------------------------------------------------- sounds ---

def build_sound_index():
    """{package_lower: (file_path, {sound_name_lower})} for every .uax."""
    idx = {}
    for fn in sorted(os.listdir(SOUNDS_DIR)):
        if not fn.lower().endswith(".uax"):
            continue
        path = os.path.join(SOUNDS_DIR, fn)
        pkg, _ = load_package(path)
        names = {pkg.export_name(e).lower()
                 for e in pkg.exports_by_class("Sound")}
        idx[fn[:-4].lower()] = (path, names)
    return idx


def resolve_sound(ref, snd_idx):
    """'SkillSound.power_strike_cast' -> file path if the object exists."""
    if "." not in ref:
        return None
    package, name = ref.split(".", 1)
    hit = snd_idx.get(package.lower())
    if hit and name.lower() in hit[1]:
        return os.path.relpath(hit[0], ROOT)
    return None


# ---------------------------------------------------------------- meshes ---

def export_meshes(needed, check_only):
    """Export `needed` {(package, meshname)} via umodel into the library.
    Returns {ref: library_relative_pskx_path} for everything on disk."""
    by_pkg = {}
    for package, name in needed:
        by_pkg.setdefault(package, set()).add(name)

    out = {}
    for package, names in sorted(by_pkg.items()):
        src = MESH_PACKAGES.get(package) or MESH_PACKAGES.get(package.lower())
        if src is None:
            continue
        destdir = os.path.join(LIBRARY, package, "StaticMesh")
        # umodel writes <out>/<Package>/StaticMesh/<name>.pskx (+ .props.txt)
        tmp = tempfile.mkdtemp(prefix="l2mesh_")
        try:
            need_export = check_only or any(
                not os.path.exists(os.path.join(destdir, n + ".pskx"))
                for n in names)
            if need_export and not check_only:
                subprocess.run(
                    [UMODEL, "-export", "-out=" + tmp,
                     os.path.join(ROOT, src)],
                    check=True, capture_output=True)
                os.makedirs(destdir, exist_ok=True)
                staged = os.path.join(tmp, package, "StaticMesh")
                by_lower = {}
                if os.path.isdir(staged):
                    for fn in os.listdir(staged):
                        by_lower[fn.lower()] = fn
                for n in names:
                    for ext in (".pskx", ".props.txt"):
                        hit = by_lower.get((n + ext).lower())
                        if hit:
                            shutil.copy2(os.path.join(staged, hit),
                                         os.path.join(destdir, hit))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        for n in names:
            for cand in (n + ".pskx",):
                p = os.path.join(destdir, cand)
                if os.path.exists(p):
                    out[f"{package}.{n}"] = os.path.relpath(p, LIBRARY)
    return out


# ----------------------------------------------------------------- build ---

def build(check_only):
    skillgrp = load("skillgrp.json")
    skillname = load("skillname.json")
    skillsoundgrp = load("skillsoundgrp.json")
    bindings = load("skillvisualeffect.json")
    effects = load("lineageeffect.json")
    with open(os.path.join(LIBRARY, "manifest.json")) as f:
        manifest = json.load(f)

    # texture lookup: (package_lower, texture_lower) -> library png path
    tex_png = {}
    for entry in manifest:
        for t in entry["textures"]:
            tex_png[(entry["package"].lower(), t["name"].lower())] = t["png"]

    # effect class family -> class names (for the name-convention fallback)
    fam_classes = {}
    for cname in effects:
        m = re.match(r"^[a-z]+_(.+?)(?:_([a-z0-9]+))?$", cname)
        if m and m.group(1):
            fam_classes.setdefault(m.group(1), []).append(cname)

    # clip cross-check: the retail cast clips must exist in Fighter.ukx
    fighter, _ = load_package(os.path.join(
        ROOT, "assets", "interlude", "animations", "Fighter.ukx"))
    f_names = set(fighter.names)
    for clip in ("CastShort_MFighter", "CastMid_MFighter", "CastLong_MFighter",
                 "MagicThrow_MFighter", "Magicshot_MFighter",
                 "Social_dance_MFighter", "SpAtk01_1HS_MFighter"):
        assert clip in f_names, f"{clip} not in Fighter.ukx name table"

    snd_idx = build_sound_index()

    # per-skill base rows (lowest level, same convention as build_meta.py)
    grp_by_id = {}
    for rec in skillgrp:
        cur = grp_by_id.get(rec["skill_id"])
        if cur is None or rec["skill_level"] < cur["skill_level"]:
            grp_by_id[rec["skill_id"]] = rec
    name_by_id = {}
    for rec in skillname:
        name_by_id.setdefault(rec["skill_id"], rec["name"])
    snd_by_id = {}
    for rec in skillsoundgrp:
        cur = snd_by_id.get(rec["skill_id"])
        if cur is None or rec["skill_level"] < cur["skill_level"]:
            snd_by_id[rec["skill_id"]] = rec

    # figure out which effect classes are actually used, to scope the
    # mesh export (explicit bindings + name-convention fallbacks)
    def classes_for(sid):
        """(binding_kind, {phase: [class names]}) or (None, {})"""
        key = str(sid)
        if key in bindings:
            phases = {}
            for phase, acts in bindings[key]["phases"].items():
                lst = [a["effect"].split(".", 1)[1] for a in acts
                       if a.get("effect", "").startswith("LineageEffect.")]
                if lst:
                    phases[phase] = lst
            return "explicit", phases
        fam = sanitize(name_by_id.get(sid, ""))
        if fam and fam in fam_classes:
            phases = {}
            for cname in sorted(fam_classes[fam]):
                suffix = cname.rsplit("_", 1)[-1]
                phase = SUFFIX_PHASE.get(suffix)
                if phase:
                    phases.setdefault(phase, []).append(cname)
            return "name-convention", phases
        return None, {}

    used_classes = set()
    plan = {}
    for sid in name_by_id:
        kind, phases = classes_for(sid)
        plan[sid] = (kind, phases)
        for lst in phases.values():
            used_classes.update(lst)

    needed_meshes = set()
    for cname in used_classes:
        for em in effects[cname]["emitters"]:
            if em.get("mesh"):
                pkg_name, mesh = em["mesh"].split(".", 1)
                needed_meshes.add((pkg_name, mesh))
    mesh_paths = {} if check_only else {}
    mesh_paths = export_meshes(needed_meshes, check_only)

    out = {}
    stats = {"explicit": 0, "name-convention": 0, "no-binding": 0,
             "passive": 0, "full": 0, "partial": 0}
    for sid, sname in sorted(name_by_id.items()):
        g = grp_by_id.get(sid, {})
        entry = {"name": sname}
        missing = []

        # --- cast animation ---
        code = g.get("animation", "")
        magic = g.get("is_magic")
        if code:
            anim = {"code": code, "magic": magic,
                    "range": -1 if g.get("cast_range") == 0xFFFFFFFF
                    else g.get("cast_range"),
                    "hitTime": g.get("hit_time")}
            if code == "N":
                anim["castClip"] = "Social_dance"      # exact (Pawn.uc)
            elif magic == 1:
                ht = g.get("hit_time", 0)
                anim["castClip"] = ("CastShort" if ht < 1.0
                                    else "CastMid" if ht < 5.0 else "CastLong")
            # physical: retail plays SpAtkNN per weapon; the letter->NN
            # switch is native code (not recovered) — no castClip emitted
            entry["anim"] = anim
        else:
            entry["anim"] = None
            stats["passive"] += 1

        # --- sounds (skillsoundgrp, base level) ---
        srec = snd_by_id.get(sid)
        if srec:
            snd = {}
            for i, key in ((0, "cast"), (1, "shot"), (2, "exp")):
                ref = srec["spell_sounds"][i]
                if not ref:
                    continue
                path = resolve_sound(ref, snd_idx)
                if path:
                    snd[key] = {"ref": ref, "file": path}
                else:
                    snd[key] = {"ref": ref, "file": None}
                    missing.append(f"sound:{ref}")
            if snd:
                entry["snd"] = snd

        # --- effects ---
        kind, phases = plan[sid]
        if kind:
            stats[kind] += 1
            fx = {"binding": kind, "phases": phases}
            if kind == "explicit":
                ft = bindings[str(sid)].get("flyingTime")
                if ft:
                    fx["flyingTime"] = ft
            textures, meshes, colors = [], [], []
            for lst in phases.values():
                for cname in lst:
                    for em in effects.get(cname, {}).get("emitters", []):
                        if em.get("texture"):
                            p, t = em["texture"].split(".", 1)
                            png = tex_png.get((p.lower(), t.lower()))
                            if png and os.path.exists(os.path.join(LIBRARY, png)):
                                if png not in textures:
                                    textures.append(png)
                            else:
                                missing.append(f"texture:{em['texture']}")
                        if em.get("mesh"):
                            path = mesh_paths.get(em["mesh"])
                            full = os.path.join(LIBRARY, path) if path else None
                            if path and os.path.exists(full):
                                if path not in meshes:
                                    meshes.append(path)
                            else:
                                missing.append(f"mesh:{em['mesh']}")
                        for c in em.get("colors", []):
                            if c.get("c") and c["c"] not in colors:
                                colors.append(c["c"])
            fx["textures"] = sorted(textures)
            fx["meshes"] = sorted(meshes)
            fx["colors"] = colors
            entry["effects"] = fx
        elif code:
            stats["no-binding"] += 1
            entry["effects"] = None
            missing.append("effect-binding")

        if missing:
            entry["missing"] = sorted(set(missing))
            stats["partial"] += 1
        else:
            stats["full"] += 1
        out[str(sid)] = entry

    out["_meta"] = {
        "source": "tools/dat/build_skillfx.py — see docs/skillfx-data.md",
        "skills": len(name_by_id),
        "stats": stats,
    }
    return out, stats


def sanity(out):
    # the four anchor skills (ids verified vs skillname.json + aCis)
    ps = out["3"]
    assert ps["name"] == "Power Strike" and ps["anim"]["code"] == "S"
    assert ps["anim"]["magic"] == 0 and "castClip" not in ps["anim"]
    assert ps["effects"]["binding"] == "name-convention"
    assert ps["effects"]["phases"] == {"casting": ["at_power_strike_cs"]}
    assert ps["snd"]["cast"]["ref"] == "SkillSound.power_strike_cast"
    assert ps["snd"]["cast"]["file"] and ps["snd"]["shot"]["file"]
    assert ps["effects"]["textures"], "Power Strike textures unresolved"

    sh = out["1216"]
    assert sh["name"] == "Self Heal" and sh["anim"]["castClip"] == "CastLong"
    assert sh["snd"]["cast"]["ref"] == "SkillSound.heal_cast"
    assert sh["effects"] is None and "effect-binding" in sh["missing"]

    ws = out["1177"]
    assert ws["name"] == "Wind Strike" and ws["effects"]["binding"] == "explicit"
    assert ws["effects"]["phases"]["explosion"] == ["el_wind_strike_ta"]
    assert ws["effects"]["phases"]["shot"] == ["el_wind_strike_fl"]
    assert ws["effects"]["flyingTime"] > 0
    assert ws["anim"]["castClip"] == "CastMid"
    assert ws["snd"]["exp"]["ref"] == "SkillSound.wind_strike_explotion"

    sd = out["1040"]
    assert sd["name"] == "Shield" and sd["effects"]["binding"] == "explicit"
    assert sd["effects"]["phases"]["shot"] == ["wh_shield_ta"]
    assert sd["effects"]["phases"]["casting"] == ["wh_heal_ca"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify only, write nothing")
    args = ap.parse_args()

    out, stats = build(args.check)
    sanity(out)

    if args.check:
        if not os.path.exists(OUT_PATH):
            sys.exit("CHECK FAIL: skillfx.json missing")
        with open(OUT_PATH) as f:
            on_disk = json.load(f)
        if on_disk != out:
            sys.exit("CHECK FAIL: skillfx.json is stale — re-run the tool")
        # every referenced asset path must exist on disk
        bad = []
        for sid, e in out.items():
            if sid == "_meta":
                continue
            for s in (e.get("snd") or {}).values():
                if s["file"] and not os.path.exists(os.path.join(ROOT, s["file"])):
                    bad.append((sid, s["file"]))
            fx = e.get("effects")
            if fx:
                for rel in fx["textures"] + fx["meshes"]:
                    if not os.path.exists(os.path.join(LIBRARY, rel)):
                        bad.append((sid, rel))
        if bad:
            sys.exit(f"CHECK FAIL: {len(bad)} dangling asset paths, e.g. {bad[:3]}")
        print(f"CHECK PASS: {len(out) - 1} skills, all asset paths on disk, "
              f"JSON in sync")
        return 0

    with open(OUT_PATH, "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"skillfx.json: {len(out) - 1} skills — {stats}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
