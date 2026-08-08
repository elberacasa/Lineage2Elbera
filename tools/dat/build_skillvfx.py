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
SpriteEmitters and MeshEmitters. A UE2 SpriteEmitter is a textured, camera-facing
quad with a colour-over-life ramp, an opacity/fade envelope, a size range and
size curve, a start-location shape, a velocity+acceleration range and an optional
texture-atlas subdivision -- every one of those is a decoded number in
lineageeffect.json and every one maps onto a three.js instanced quad.

A MeshEmitter is the SAME particle with a static mesh in place of the quad: per
Engine.u (tools/dat/dump_emitter_classes.py) `class MeshEmitter extends
ParticleEmitter` adds exactly four authored fields -- StaticMesh,
UseMeshBlendMode, RenderTwoSided, UseParticleColor -- and inherits every other
knob unchanged. The one field whose UNITS change is StartSizeRange, and Engine.u
settles that outright: ParticleEmitter defaults it to 100 (UU) and MeshEmitter
overrides it to 1.0, so on a mesh it is a per-axis SCALE. Geometry for the 108
meshes bound skills reference is emitted by tools/dat/build_skillmesh.py; this
file only carries the mesh NAME (interned in `msh`), so the two indexes join by
name and neither has to be rebuilt when the other changes.

Still dropped, not approximated:
  VertMeshEmitter  (36) UE2 VertMesh in LineageEffectMeshes.ukx. umodel DOES
                        export these (as Unreal .3d vertex-animation pairs -- the
                        older claim that it "cannot export it at all" is wrong),
                        but nothing in this repo decodes .3d yet.
  BeamEmitter      (29) / RibbonEmitter (1) are procedural beam/trail geometry.
                        Their parameters ARE decodable now that Engine.u's
                        BeamEmitter declaration is recovered, but the noise/
                        branching model that turns them into vertices is native.
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
(3191 of 3316 ramp stops are 0xff -- and wh_heal_ca's stops are #7d7d7d00, i.e.
alpha 0, which would make the retail heal circle invisible if the byte were used).

MESH PARTICLES ARE NOT TINTED, and that is a sourced decision, not a shortcut.
`UseParticleColor` is absent from MeshEmitter's class-default stream in Engine.u
(so it is false) and is serialised true on only 5 of the 413 bound mesh emitters.
The falsifying case is el_prominence_fl -- Prominence is a FIRE skill: its
`spirit_fire00` mesh is textured with fx_m_t0066, whose bright pixels average
(204, 113, 70) orange, and the emitter carries ColorMultiplierRange
(0.269, 1.0, 1.0). Applying that multiplier turns the fire core (55, 113, 70)
dark green. So `r`/`m` are emitted for a MeshEmitter only when UseParticleColor
is set; the mesh's own retail texture is the colour. What is NOT recoverable is
whether the native renderer still applies the Opacity x fade ALPHA envelope when
UseParticleColor is false; the client applies it (377 of 413 bound mesh emitters
set FadeOut explicitly and 290 set Opacity), which can only change transparency,
never colour. Written up in docs/skillfx-data.md §4c.

Usage:
  /usr/bin/python3 tools/dat/build_skillvfx.py           # write the index
  /usr/bin/python3 tools/dat/build_skillvfx.py --check   # verify, exit 1 on drift
"""

import argparse
import json
import os
import struct
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


def png_has_alpha_channel(rel, _cache={}):
    """True when the umodel PNG export really carries an alpha channel.

    Not cosmetic: 33 of the 127 sprite textures and part of the mesh textures
    are colour type 6 (RGBA), and on several of them (fx_m_t0054, fx_m_t0035,
    fx_m_t0071, fx_m_t0099 ...) the RGB is opaque everywhere and the SHAPE is
    entirely in the alpha channel -- 0.0% of pixels have a dark RGB while
    60-90% have alpha < 8. Treating luminance as coverage there paints a solid
    bright rectangle. So coverage is alpha when the file has one, luminance
    when it does not.
    """
    if rel in _cache:
        return _cache[rel]
    path = os.path.join(LIBRARY, rel)
    ct = None
    try:
        with open(path, "rb") as fh:
            d = fh.read(64)
        pos = 8
        while pos + 8 <= len(d):
            ln = struct.unpack_from(">I", d, pos)[0]
            if d[pos + 4:pos + 8] == b"IHDR":
                ct = struct.unpack_from(">IIBB", d, pos + 8)[3]
                break
            pos += 12 + ln
    except OSError:
        ct = None
    _cache[rel] = ct in (4, 6)          # 4 = grey+alpha, 6 = RGBA
    return _cache[rel]


def pack_emitter(em, tex, msh=None):
    """One SpriteEmitter or MeshEmitter -> the compact record the renderer consumes.

    Every key is a decoded retail value; nothing is defaulted in here except by
    OMISSION (a missing key means "engine default", which the client applies).
    A MeshEmitter carries `k: 1` and `g` (index into the `msh` name table) in
    place of `t`; everything else is the shared ParticleEmitter contract.
    """
    out = {}
    is_mesh = em.get("type") == "MeshEmitter"
    if is_mesh:
        out["k"] = 1
        out["g"] = msh((em.get("mesh") or "").split(".", 1)[-1])
        if em.get("twoSided"):
            out["ts"] = 1
        # UseMeshBlendMode defaults TRUE (Engine.u) = use the MESH material's
        # own blend mode; 1182 of 1232 emitters turn it off, which is what makes
        # the emitter's DrawStyle (`d`) authoritative for those.
        if em.get("useMeshBlendMode") is not False:
            out["mb"] = 1
    else:
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
    # without it size X and Y independently. On a MeshEmitter the same range is
    # a per-axis SCALE on the static mesh (ParticleEmitter defaults it to 100,
    # MeshEmitter overrides it to 1.0 -- Engine.u class defaults), so Z matters
    # there too and is carried as `zz`.
    ss = em.get("startSize")
    if isinstance(ss, dict) and "X" in ss:
        out["z"] = [r3(ss["X"]["Min"]), r3(ss["X"]["Max"])]
        if not em.get("uniformSize") and "Y" in ss:
            out["zy"] = [r3(ss["Y"]["Min"]), r3(ss["Y"]["Max"])]
        if is_mesh and not em.get("uniformSize") and "Z" in ss:
            out["zz"] = [r3(ss["Z"]["Min"]), r3(ss["Z"]["Max"])]

    # SizeScale: the size-over-life curve, gated by UseSizeScale exactly as the
    # colour ramp is gated by UseColorScale. Decoded for the first time in this
    # pass -- 559 of the 724 bound sprite emitters and 311 of the 413 bound mesh
    # emitters set UseSizeScale, and 549 / 295 of those have a curve that is not
    # flat, so before this every one of them held its StartSize for its whole
    # life. UseRegularSizeScale defaults TRUE and is serialised false on the
    # emitters that carry an authored curve, i.e. "honour these RelativeTimes".
    if em.get("useSizeScale") and em.get("sizeScale"):
        curve = [[r3(s["t"]), r3(s["s"])] for s in em["sizeScale"]
                 if s.get("t") is not None and s.get("s") is not None]
        if curve and any(abs(c[1] - 1.0) > 1e-3 for c in curve):
            curve.sort(key=lambda s: s[0])
            out["zs"] = curve
            if em.get("sizeScaleRepeats"):
                out["zr"] = r3(em["sizeScaleRepeats"])

    if em.get("opacity") is not None:
        out["o"] = r3(em["opacity"])

    # SpinParticles + StartSpinRange / SpinsPerSecondRange, both in REVOLUTIONS
    # (SpinsPerSecondRange is 5.0 at most across the whole table and clusters at
    # 0.1-1.0; StartSpinRange clusters at 0..1 / -1..1 with 0.25 and 0.75 stops,
    # which only reads as quarter turns). A sprite only ever uses X (523 of them
    # hold Y = Z = 0) -- that is its screen-space roll. A mesh spins in 3-D and
    # the component -> axis map is NOT the identity; see skillvfx.js.
    if em.get("spin"):
        out["sp"] = 1
        for key, field in (("q0", "startSpin"), ("qs", "spinsPerSecond")):
            v = em.get(field)
            if isinstance(v, dict) and "X" in v:
                vv = [[r3(v[a]["Min"]), r3(v[a]["Max"])] for a in "XYZ"]
                if any(x for pair in vv for x in pair):
                    out[key] = vv
        cw = em.get("spinCCWorCW")
        if cw and [r3(x) for x in cw] != [0.5, 0.5, 0.5]:
            out["qw"] = [r3(x) for x in cw]

    # the UseColorScale gate -- see the module docstring. On a MeshEmitter the
    # tint is additionally gated by UseParticleColor (false on 408 of the 413
    # bound mesh emitters), so the mesh's own retail texture is the colour.
    tinted = not is_mesh or bool(em.get("useParticleColor"))
    if em.get("useParticleColor"):
        out["pc"] = 1
    if tinted and em.get("useColorScale") and em.get("colors"):
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
    if tinted and isinstance(cm, dict) and "X" in cm:
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
    msh = Interner()
    fx_names, fx_list, fx_index = [], [], {}

    def effect_id(cls):
        """Intern one LineageEffect class as a packed emitter list."""
        if cls in fx_index:
            return fx_index[cls]
        rec = effects.get(cls)
        if rec is None:
            return None
        sprites, skipped = [], {}
        for em in rec.get("emitters", []):
            if em.get("type") == "SpriteEmitter":
                p = pack_emitter(em, tex)
                if p.get("t") is not None:      # no texture -> nothing to draw
                    sprites.append(p)
                else:
                    skipped["NoTexture"] = skipped.get("NoTexture", 0) + 1
            elif em.get("type") == "MeshEmitter":
                if em.get("mesh"):
                    sprites.append(pack_emitter(em, tex, msh))
                else:
                    # StaticMesh left at its None default: nothing to draw.
                    skipped["NoMesh"] = skipped.get("NoMesh", 0) + 1
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

    # `texa[i]` says whether tex[i]'s PNG carries a real alpha channel. Not
    # cosmetic: on fx_m_t0054 / fx_m_t0035 / fx_m_t0071 / fx_m_t0099 the RGB is
    # bright everywhere and the SHAPE lives entirely in alpha (0.0% of pixels
    # have a dark RGB, 60-90% have alpha < 8), so treating luminance as coverage
    # there paints a solid rectangle. 33 of the sprite textures are RGBA.
    out = {"tex": tex.items,
           "texa": [1 if png_has_alpha_channel(p) else 0 for p in tex.items],
           "msh": msh.items, "fxn": fx_names, "fx": fx_list, "skill": skills}
    if verbose:
        n_kept = sum(len(f["e"]) for f in fx_list)
        n_mesh = sum(1 for f in fx_list for e in f["e"] if e.get("k") == 1)
        n_skip = sum(sum(f.get("skip", {}).values()) for f in fx_list)
        expl = sum(1 for s in skills.values() if s["b"] == 1)
        print("skillvfx: %d skills (%d explicit, %d name-convention), "
              "%d effect classes, %d emitters kept (%d sprite + %d mesh), "
              "%d dropped, %d textures, %d meshes"
              % (len(skills), expl, len(skills) - expl, len(fx_list),
                 n_kept, n_kept - n_mesh, n_mesh, n_skip,
                 len(tex.items), len(msh.items)))
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

    # Wind Strike's shot is the anchor for the mesh path: the bolt is
    # windknifeball00 + windknifewave00 and BOTH have to survive as k:1 records.
    fl = fresh["fxn"].index("el_wind_strike_fl")
    got = sorted(fresh["msh"][e["g"]] for e in fresh["fx"][fl]["e"] if e.get("k") == 1)
    if got != ["windknifeball00", "windknifewave00"]:
        print("CHECK FAIL: el_wind_strike_fl mesh emitters = %s" % got)
        return 1
    # every mesh name must exist in the geometry index built beside this one
    mesh_path = os.path.join(GAMEDATA, "skillmesh.json")
    if os.path.exists(mesh_path):
        with open(mesh_path) as fh:
            have = set(json.load(fh)["mesh"])
        lost = [m for m in fresh["msh"] if m not in have]
        if lost:
            print("CHECK FAIL: %d mesh(es) missing from skillmesh.json: %s"
                  % (len(lost), lost[:5]))
            return 1
    else:
        print("NOTE: skillmesh.json absent -- run tools/dat/build_skillmesh.py")

    size = os.path.getsize(OUT) / 1024.0
    expl = sum(1 for s in fresh["skill"].values() if s["b"] == 1)
    n_mesh = sum(1 for f in fresh["fx"] for e in f["e"] if e.get("k") == 1)
    n_kept = sum(len(f["e"]) for f in fresh["fx"])
    skipped = {}
    for f in fresh["fx"]:
        for k, v in f.get("skip", {}).items():
            skipped[k] = skipped.get(k, 0) + v
    print("CHECK PASS: %d skills (%d explicit / %d convention), %d effect classes, "
          "%d emitters (%d sprite + %d mesh), dropped %s, %d textures all staged, "
          "%.0f KB"
          % (len(fresh["skill"]), expl, len(fresh["skill"]) - expl,
             len(fresh["fxn"]), n_kept, n_kept - n_mesh, n_mesh,
             ", ".join("%s %d" % kv for kv in sorted(skipped.items())),
             len(fresh["tex"]), size))
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
