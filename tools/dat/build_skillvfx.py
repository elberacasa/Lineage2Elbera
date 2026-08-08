#!/usr/bin/env python3
"""Build assets/gamedata/skillvfx.json -- the browser's skill-effect index.

WHY THIS EXISTS
---------------
The three source tables are 14 MB of JSON and describe far more than a web
client can draw: lineageeffect.json (864 effect classes / 3709 UE2 emitters),
skillvisualeffect.json (the Skill.usk skill -> effect binding) and skillfx.json
(the name-convention fallback bindings). This tool joins them, throws away
everything the renderer cannot faithfully reproduce, and interns every repeated
string -- exactly the shape tools/audio/build_audio.py emits for its sound
bindings, and for the same reason: effect-class names and texture paths repeat
across hundreds of skills, so names live in one table and records hold indices.

WHAT IT KEEPS AND WHY
---------------------
SpriteEmitters ONLY. A UE2 SpriteEmitter is a textured, camera-facing quad with
a colour-over-life ramp, an opacity/fade envelope, a size range, a start-location
shape, a velocity+acceleration range and an optional texture-atlas subdivision --
every one of those is a decoded number in lineageeffect.json and every one maps
onto a three.js Points/Sprite draw. The other emitter families are dropped, not
approximated:
  MeshEmitter    (1232) needs the LineageEffectsStaticmeshes geometry; the
                        client has no .pskx loader, so these would have to be
                        faked with a substitute shape.
  VertMeshEmitter  (36) UE2 VertMesh; umodel cannot export it at all.
  BeamEmitter      (29) / RibbonEmitter (1) are procedural beam/trail geometry
                        with their own (undecoded) segment parameters.
Per-class counts of what was dropped ride along in the output ("skip"), so the
client and the docs can state coverage instead of pretending to full fidelity.

COLOUR -- THE POINT OF THE EXERCISE
-----------------------------------
The retail colour of a particle is NOT simply "the ColorScale array". UE2 packed
property streams omit any value equal to the class default, and UseColorScale is
serialised 1563 times and ALWAYS as true -- so its default is false and the 2141
emitters that carry a ColorScale WITHOUT that flag have their ramp ignored by the
engine. For those, colour comes from ColorMultiplierRange (an RGB multiplier,
default 1,1,1) modulating the texture. This tool applies that gate: `r` (ramp) is
emitted only when UseColorScale is set, otherwise `m` (multiplier) carries the
tint. Alpha rides on Opacity x FadeIn/FadeOut, not on the ramp's alpha byte
(3191 of 3316 ramp stops are 0xff).

Usage:
  /usr/bin/python3 tools/dat/build_skillvfx.py           # write the index
  /usr/bin/python3 tools/dat/build_skillvfx.py --check   # verify, exit 1 on drift
"""

import argparse
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GAMEDATA = os.path.join(ROOT, "assets", "gamedata")
LIBRARY = os.path.join(ROOT, "assets", "library")
OUT = os.path.join(GAMEDATA, "skillvfx.json")

# Phase -> short key. The phase is the Skill.usk ARRAY the action sat in
# (CastingActions/ShotActions/...), never the effect name's suffix: wh_heal_ta
# is in ShotActions while el_wind_strike_ta is in ExplosionActions.
PHASE_KEY = {"casting": "c", "shot": "s", "explosion": "x", "channeling": "h"}

# SkillAction_LocateEffect booleans, packed into one bitmask.
FLAG_ON_TARGET = 1        # bSpawnOnTarget: spawn at the target, not the caster
FLAG_MULTI = 2            # bOnMultiTarget
FLAG_SIZE_SCALE = 4       # bSizeScale: scale by the actor's draw scale
FLAG_CHAR_ROT = 8         # bUseCharacterRotation
FLAG_ABSOLUTE = 16        # bAbsolute
FLAG_WORLD_OFFSET = 32    # bRelativeToCylinder explicitly false -> offset is
                          # in world UU, not collision-cylinder fractions

# EAttachMethod, read out of Engine.u's Enum export (ordinals 0..7):
# None, RH, LH, BoneSpecified, AliasSpecified, Trail, RF, LF. Confirmed against
# the data: attachOn 3 and 4 carry an AttachBoneName in 21 of 21 cases, and
# attachOn 5 carries one in 1 of 401 -- exactly what BoneSpecified /
# AliasSpecified vs. a non-bone method predicts.
ATTACH_BONE = (3, 4)


def load(name):
    with open(os.path.join(GAMEDATA, name)) as fh:
        return json.load(fh)


def r3(x):
    """Round a float for transport; keeps the file small without visible loss."""
    if x is None:
        return None
    return round(float(x), 3)


class Interner:
    def __init__(self):
        self.items, self.index = [], {}

    def __call__(self, key):
        if key is None:
            return None
        if key not in self.index:
            self.index[key] = len(self.items)
            self.items.append(key)
        return self.index[key]


def resolve_texture(ref, cache={}):
    """"LineageEffectsTextures.fx_m_t0000" -> "LineageEffectsTextures/fx_m_t0000.png"
    if that PNG really is staged under assets/library/, else None.

    The client fetches these through the server's /faces/<pkg>/<file> route,
    which is a case-insensitive assets/library lookup -- so resolution here has
    to be case-insensitive too (the tables say "LineageEffectsTextures", the
    export dir may differ in case).
    """
    if not ref or "." not in ref:
        return None
    pkg, name = ref.split(".", 1)
    if pkg not in cache:
        real = next((d for d in os.listdir(LIBRARY) if d.lower() == pkg.lower()), None)
        cache[pkg] = (real, {f.lower(): f for f in os.listdir(os.path.join(LIBRARY, real))}
                      if real else {})
    real, files = cache[pkg]
    if not real:
        return None
    fn = files.get((name + ".png").lower())
    return "%s/%s" % (real, fn) if fn else None


def pack_sprite(em, tex):
    """One SpriteEmitter -> the compact record the renderer consumes.

    Every key is a decoded retail value; nothing is defaulted in here except by
    OMISSION (a missing key means "engine default", which the client applies).
    """
    out = {}
    ti = tex(resolve_texture(em.get("texture")))
    if ti is not None:
        out["t"] = ti
    if em.get("maxParticles"):
        out["n"] = em["maxParticles"]
    if em.get("particlesPerSecond"):
        out["pps"] = r3(em["particlesPerSecond"])
    if em.get("lifetime"):
        out["l"] = [r3(v) for v in em["lifetime"]]

    # StartSizeRange is a RangeVector; UniformSize (default false, only ever
    # serialised true) means the engine uses X for all axes. The 474 sprites
    # without it size X and Y independently.
    ss = em.get("startSize")
    if isinstance(ss, dict) and "X" in ss:
        out["z"] = [r3(ss["X"]["Min"]), r3(ss["X"]["Max"])]
        if not em.get("uniformSize") and "Y" in ss:
            out["zy"] = [r3(ss["Y"]["Min"]), r3(ss["Y"]["Max"])]

    if em.get("opacity") is not None:
        out["o"] = r3(em["opacity"])

    # the UseColorScale gate -- see the module docstring
    if em.get("useColorScale") and em.get("colors"):
        ramp = []
        for c in em["colors"]:
            h = (c.get("c") or "#ffffffff").lstrip("#")
            if len(h) != 8 or c.get("t") is None:
                continue
            ramp.append([r3(c["t"]), int(h[:6], 16), int(h[6:8], 16)])
        if ramp:
            ramp.sort(key=lambda s: s[0])
            out["r"] = ramp
            if em.get("colorScaleRepeats"):
                out["rr"] = r3(em["colorScaleRepeats"])
    # colorMultiplier / startLocation / velocity arrive already collapsed to
    # {X: [min, max], ...} by parse_skillfx.py; only startSize stays nested.
    cm = em.get("colorMultiplier")
    if isinstance(cm, dict) and "X" in cm:
        mult = [r3(cm[a][0]) for a in "XYZ"]
        if mult != [1.0, 1.0, 1.0]:
            out["m"] = mult

    v = em.get("velocity")
    if isinstance(v, dict) and "X" in v:
        vv = [[r3(v[a][0]), r3(v[a][1])] for a in "XYZ"]
        if any(x for pair in vv for x in pair):
            out["v"] = vv
    if em.get("acceleration") and any(em["acceleration"]):
        out["a"] = [r3(x) for x in em["acceleration"]]

    if em.get("drawStyle"):
        out["d"] = em["drawStyle"]
    if em.get("fadeIn") and em.get("fadeInEnd") is not None:
        out["fi"] = r3(em["fadeInEnd"])
    if em.get("fadeOut") and em.get("fadeOutStart") is not None:
        out["fo"] = r3(em["fadeOutStart"])
    if em.get("spin"):
        out["sp"] = 1
    if em.get("texU") or em.get("texV"):
        out["u"] = [em.get("texU") or 1, em.get("texV") or 1]
        if em.get("randomSubdivision"):
            out["ru"] = 1
    # Both of these are serialised ONLY as false (AutomaticInitialSpawning
    # 3586x false / 123 absent, RespawnDeadParticles 3026x false / 683 absent),
    # so both default to TRUE and the explicit false is the interesting case.
    # false + false = "burst MaxParticles once and die", which is what almost
    # every skill effect is; absent = stream at InitialParticlesPerSecond.
    if em.get("autoSpawning") is False:
        out["au"] = 0
    if em.get("respawn") is False:
        out["rs"] = 0
    if em.get("startShape") is not None:
        out["sh"] = em["startShape"]
    if em.get("sphereRadius"):
        out["sr"] = [r3(x) for x in em["sphereRadius"]]
    sl = em.get("startLocation")
    if isinstance(sl, dict) and "X" in sl:
        ll = [[r3(sl[a][0]), r3(sl[a][1])] for a in "XYZ"]
        if any(x for pair in ll for x in pair):
            out["sl"] = ll
    if em.get("startOffset") and any(em["startOffset"]):
        out["so"] = [r3(x) for x in em["startOffset"]]
    if em.get("initialDelay") and any(em["initialDelay"]):
        out["dl"] = [r3(x) for x in em["initialDelay"]]
    return out


def build(verbose=True):
    effects = load("lineageeffect.json")
    binds = load("skillvisualeffect.json")
    sfx = load("skillfx.json")

    tex = Interner()
    fx_names, fx_list, fx_index = [], [], {}

    def effect_id(cls):
        """Intern one LineageEffect class as a packed sprite-emitter list."""
        if cls in fx_index:
            return fx_index[cls]
        rec = effects.get(cls)
        if rec is None:
            return None
        sprites, skipped = [], {}
        for em in rec.get("emitters", []):
            if em.get("type") == "SpriteEmitter":
                p = pack_sprite(em, tex)
                if p.get("t") is not None:      # no texture -> nothing to draw
                    sprites.append(p)
                else:
                    skipped["NoTexture"] = skipped.get("NoTexture", 0) + 1
            else:
                skipped[em["type"]] = skipped.get(em["type"], 0) + 1
        entry = {"e": sprites}
        if skipped:
            entry["skip"] = skipped
        fx_index[cls] = len(fx_list)
        fx_names.append(cls)
        fx_list.append(entry)
        return fx_index[cls]

    def pack_action(a):
        cls = (a.get("effect") or "").split(".", 1)[-1]
        fi = effect_id(cls) if cls else None
        if fi is None:
            return None
        rec = {"f": fi}
        flags = 0
        if a.get("onTarget"):
            flags |= FLAG_ON_TARGET
        if a.get("onMultiTarget"):
            flags |= FLAG_MULTI
        if a.get("sizeScale"):
            flags |= FLAG_SIZE_SCALE
        if a.get("useCharRotation"):
            flags |= FLAG_CHAR_ROT
        if a.get("absolute"):
            flags |= FLAG_ABSOLUTE
        if a.get("relativeToCylinder") is False:
            flags |= FLAG_WORLD_OFFSET
        if flags:
            rec["g"] = flags
        if a.get("offset") and any(a["offset"]):
            rec["o"] = [r3(x) for x in a["offset"]]
        if a.get("spawnDelay"):
            rec["d"] = r3(a["spawnDelay"])
        if a.get("attachOn") in ATTACH_BONE and a.get("bone"):
            rec["b"] = a["bone"]
        return rec

    skills = {}
    # 1. explicit Skill.usk bindings (the only per-skill effect table the
    #    client actually ships). Variant names ("4641_a", "1217_sec") are kept
    #    verbatim -- the client matches the plain id and ignores the rest.
    for sid, rec in binds.items():
        entry = {"b": 1}
        if rec.get("flyingTime"):
            entry["f"] = r3(rec["flyingTime"])
        any_phase = False
        for phase, acts in (rec.get("phases") or {}).items():
            packed = [p for p in (pack_action(a) for a in acts) if p]
            if packed:
                entry[PHASE_KEY[phase]] = packed
                any_phase = True
        if any_phase:
            skills[sid] = entry

    # 2. name-convention bindings from skillfx.json. The MATCH RULE is a
    #    heuristic (the retail fallback is native code with no data presence),
    #    so these are tagged b:2 and the client can weigh them differently.
    #    Their effect classes and every parameter inside are still retail.
    for sid, rec in sfx.items():
        eff = rec.get("effects") or {}
        if eff.get("binding") != "name-convention" or sid in skills:
            continue
        entry, any_phase = {"b": 2}, False
        for phase, classes in (eff.get("phases") or {}).items():
            packed = [p for p in (pack_action({"effect": c}) for c in classes) if p]
            if packed:
                entry[PHASE_KEY[phase]] = packed
                any_phase = True
        if any_phase:
            skills[sid] = entry

    out = {"tex": tex.items, "fxn": fx_names, "fx": fx_list, "skill": skills}
    if verbose:
        n_sprites = sum(len(f["e"]) for f in fx_list)
        n_skip = sum(sum(f.get("skip", {}).values()) for f in fx_list)
        expl = sum(1 for s in skills.values() if s["b"] == 1)
        print("skillvfx: %d skills (%d explicit, %d name-convention), "
              "%d effect classes, %d sprite emitters kept, %d dropped, %d textures"
              % (len(skills), expl, len(skills) - expl, len(fx_list),
                 n_sprites, n_skip, len(tex.items)))
    return out


def check():
    if not os.path.exists(OUT):
        print("CHECK FAIL: %s missing -- run the build" % OUT)
        return 1
    fresh = build(verbose=False)
    with open(OUT) as fh:
        on_disk = json.load(fh)
    if on_disk != fresh:
        print("CHECK FAIL: skillvfx.json is stale -- re-run the tool")
        return 1

    # every texture the index names must be fetchable through /faces
    missing = [p for p in fresh["tex"] if not os.path.exists(os.path.join(LIBRARY, p))]
    if missing:
        print("CHECK FAIL: %d texture(s) not staged: %s" % (len(missing), missing[:5]))
        return 1

    # anchors whose retail appearance is documented in docs/skillfx-data.md
    for sid, phase, cls in (("1177", "s", "el_wind_strike_fl"),
                            ("1177", "x", "el_wind_strike_ta"),
                            ("1011", "c", "wh_heal_ca"),
                            ("1011", "s", "wh_heal_ta"),
                            ("1040", "s", "wh_shield_ta")):
        acts = fresh["skill"].get(sid, {}).get(phase, [])
        got = [fresh["fxn"][a["f"]] for a in acts]
        if cls not in got:
            print("CHECK FAIL: skill %s phase %s lost %s (has %s)" % (sid, phase, cls, got))
            return 1
    if fresh["skill"]["1177"].get("f") != 0.4:
        print("CHECK FAIL: Wind Strike flyingTime != 0.4")
        return 1

    size = os.path.getsize(OUT) / 1024.0
    expl = sum(1 for s in fresh["skill"].values() if s["b"] == 1)
    print("CHECK PASS: %d skills (%d explicit / %d convention), %d effect classes, "
          "%d textures all staged, %.0f KB"
          % (len(fresh["skill"]), expl, len(fresh["skill"]) - expl,
             len(fresh["fxn"]), len(fresh["tex"]), size))
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="verify only, write nothing")
    args = ap.parse_args()
    if args.check:
        return check()
    out = build()
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"), sort_keys=True)
        fh.write("\n")
    print("wrote %s (%.0f KB)" % (OUT, os.path.getsize(OUT) / 1024.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
