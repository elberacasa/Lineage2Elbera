#!/usr/bin/env python3
"""Build assets/gamedata/skillvfx.json -- the browser's skill-effect index.

WHY THIS EXISTS
---------------
The effect source tables are 14 MB of JSON and describe far more than a web
client can draw: lineageeffect.json (864 effect classes / 3709 UE2 emitters),
skillvisualeffect.json (the Skill.usk skill -> effect binding) and skillfx.json
(legacy name-convention diagnostics). This tool joins supported emitter
fields, preserves source Agent identity separately, and interns repeated
strings -- exactly the shape tools/audio/build_audio.py emits for its sound
bindings, and for the same reason: effect-class names and texture paths repeat
across hundreds of skills, so names live in one table and records hold indices.

EXACT AGENT BINDING
-------------------
The v2 runtime contract uses objects keyed by full qualified source path and
bindings keyed by skill ID with explicit known levels plus differing paths.
Build/check freshly decrypt skillgrp.dat and parse Skill.usk. The old `skill`
leaf/heuristic map remains diagnostic compatibility data only. No runtime
Agent selection may use it. Objects are retained even if no emitter is drawn.
All transported numeric fields preserve decoded Float32 values (no decimal rounding).
Action arrays retain original order, stage, identity and non-drawable entries.

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

The two "nothing to draw" buckets, re-checked 2026-08-09:
  NoTexture (10)  These do NOT "name a texture that was never staged", which
                  is what this file and js/skillvfx.js used to say. Their
                  Texture property is ABSENT from the packed stream, so it
                  equals ParticleEmitter's class default -- and that default
                  is `"S_Emitter"` (tools/dat/dump_emitter_classes.py
                  --defaults), the UnrealEd editor billboard, not a particle
                  texture. Retail authors left them untextured; drawing
                  nothing is the faithful outcome, not a coverage hole.
  NoMesh    (5)   StaticMesh left at its None default: s_u806_ca,
                  mp_super_strike_a_ta, mp_super_strike_b_ta,
                  mp_super_strike_a_co, mo_rapid_shot_ta. Same story.
The 13 VertMeshEmitters DO name their asset (parse_skillfx.py stores
VertexMesh under the same `mesh` key as StaticMesh): LineageEffectMeshes'
magic2, Water01, water00, swirl, selfblaster, linetail60frm and
linetail60frm_red. The blocker is only the missing Unreal `.3d` decoder.

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
import hashlib
import json
import os
import struct
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GAMEDATA = os.path.join(ROOT, "assets", "gamedata")
LIBRARY = os.path.join(ROOT, "assets", "library")
OUT = os.path.join(GAMEDATA, "skillvfx.json")
from skill_bindings import original_skillgrp, build_bindings
from parse_skillfx import parse_skill_usk, load_package, SKILL_USK

SKILL_SOURCE_SHA = '30b9a60d2a27c12d7fb9826a38772b3932c4ad66ab5f0638e8128813898463f5'
ENGINE_DEFAULTS_SHA = '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761'


# Phase -> short key. The phase is the Skill.usk ARRAY the action sat in
# (CastingActions/ShotActions/...), never the effect name's suffix: wh_heal_ta
# is in ShotActions while el_wind_strike_ta is in ExplosionActions.
PHASE_KEY = {"casting": "c", "shot": "s", "explosion": "x", "channeling": "h", "preshot": "p"}

# SkillAction_LocateEffect booleans, packed into one bitmask.
FLAG_ON_TARGET = 1        # bSpawnOnTarget: spawn at the target, not the caster
FLAG_MULTI = 2            # bOnMultiTarget
FLAG_SIZE_SCALE = 4       # bSizeScale: scale by the actor's draw scale
FLAG_CHAR_ROT = 8         # bUseCharacterRotation
FLAG_ABSOLUTE = 16        # bAbsolute
FLAG_WORLD_OFFSET = 32    # bRelativeToCylinder explicitly false -> offset is
                          # in world UU, not collision-cylinder fractions

# EAttachMethod, re-read 2026-08-09 straight out of Engine.u's Enum export
# (ordinals 0..7) and NOT from a name table whose order is arbitrary:
#     [EAM_None, EAM_RH, EAM_LH, EAM_BoneSpecified,
#      EAM_AliasSpecified, EAM_Trail, EAM_RF, EAM_LF]
# The Enum export is export 3369 and its OUTER is the Class export of
# SkillAction_LocateEffect itself (export 9996) -- i.e. the enum is declared
# on the very class whose AttachOn ByteProperty (export 10581) uses it, so
# the type association is not an inference from the property's name.
#
# The class-default stream of SkillAction_LocateEffect (found by the
# clean-parse search in tools/dat/dump_emitter_classes.py, ending exactly on
# the last byte of the export body) holds ONE authored default:
# bRelativeToCylinder = True. Everything else is the zero value -- so the 79
# actions that omit AttachOn are EAM_None (0), not "unknown".
#
# The ordinals are corroborated by what the data attaches where, which is the
# part a wrong enum order could not survive:
#   EAM_RH  (1, 18 actions)  at_sting_ca, at_mortal_blow_ca, at_fatal_strike_cs,
#                            dw_spoil_ca -- sword/dagger skills, weapon hand
#   EAM_LH  (2,  5 actions)  at_shield_slam_ca, at_shield_stun_ca -- SHIELD
#                            skills, and the shield is the left hand
#   3 / 4   (21 actions)     carry an AttachBoneName in 21 of 21 cases
#   EAM_Trail (5, 401)       carries one in 1 of 401
#   EAM_None (0, 79)         el_wind_strike_fl, el_flame_strike_fl,
#                            el_aqua_swirl_fl, el_twister_fl, el_prominence_fl
#                            -- 16 of the 19 `_fl` (flying) actions. Exactly
#                            the effects that must NOT be glued to a moving
#                            actor.
# TWO THINGS THAT LOOK OBVIOUS AND ARE NOT, both measured over the 519 explicit
# actions rather than assumed:
#   * NOT every `_fl` class is unattached. Valakas' breath (4683/4684,
#     mb_valakas_breath_low_fl / _high_fl) hangs off bone `Dummy05` -- a breath
#     weapon has to stream from the head -- and 4204's el_ice_dagger_fl is
#     EAM_Trail.
#   * NOT every impact burst stays where it landed. Of the 19 ExplosionActions
#     13 are EAM_Trail (el_wind_strike_ta rides a running target, which is what
#     retail does) and only 6 are EAM_None (el_aqua_swirl_ta, el_ice_dagger_ta,
#     el_flame_strike_ra, mu_wyvern_breath_ta). The split is per ACTION; there
#     is no rule that can be read off the phase or the name.
# Per-phase attach distribution, explicit bindings only:
#   casting  EAM_Trail 247, RH 15, None 11, Bone 9, Alias 6, LH 3
#   shot     EAM_Trail 133, None 62, Alias 5, RH 3, LH 2, Bone 1
#   explosion EAM_Trail 13, None 6      channeling EAM_Trail 6
ATTACH_NONE, ATTACH_RH, ATTACH_LH, ATTACH_TRAIL = 0, 1, 2, 5
ATTACH_BONE = (3, 4)


def load(name):
    with open(os.path.join(GAMEDATA, name)) as fh:
        return json.load(fh)


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
        out["pps"] = em["particlesPerSecond"]
    if em.get("lifetime"):
        out["l"] = list(em["lifetime"])

    # StartSizeRange is a RangeVector; UniformSize (default false, only ever
    # serialised true) means the engine uses X for all axes. The 474 sprites
    # without it size X and Y independently. On a MeshEmitter the same range is
    # a per-axis SCALE on the static mesh (ParticleEmitter defaults it to 100,
    # MeshEmitter overrides it to 1.0 -- Engine.u class defaults), so Z matters
    # there too and is carried as `zz`.
    ss = em.get("startSize")
    if isinstance(ss, dict) and "X" in ss:
        out["z"] = [ss["X"]["Min"], ss["X"]["Max"]]
        if not em.get("uniformSize") and "Y" in ss:
            out["zy"] = [ss["Y"]["Min"], ss["Y"]["Max"]]
        if is_mesh and not em.get("uniformSize") and "Z" in ss:
            out["zz"] = [ss["Z"]["Min"], ss["Z"]["Max"]]

    # SizeScale: the size-over-life curve, gated by UseSizeScale exactly as the
    # colour ramp is gated by UseColorScale. Decoded for the first time in this
    # pass -- 559 of the 724 bound sprite emitters and 311 of the 413 bound mesh
    # emitters set UseSizeScale, and 549 / 295 of those have a curve that is not
    # flat, so before this every one of them held its StartSize for its whole
    # life. UseRegularSizeScale defaults TRUE and is serialised false on the
    # emitters that carry an authored curve, i.e. "honour these RelativeTimes".
    if em.get("useSizeScale") and em.get("sizeScale"):
        curve = [[s["t"], s["s"]] for s in em["sizeScale"]
                 if s.get("t") is not None and s.get("s") is not None]
        if curve and any(abs(c[1] - 1.0) > 1e-3 for c in curve):
            curve.sort(key=lambda s: s[0])
            out["zs"] = curve
            if em.get("sizeScaleRepeats"):
                out["zr"] = em["sizeScaleRepeats"]

    if em.get("opacity") is not None:
        out["o"] = em["opacity"]

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
                vv = [[v[a]["Min"], v[a]["Max"]] for a in "XYZ"]
                if any(x for pair in vv for x in pair):
                    out[key] = vv
        cw = em.get("spinCCWorCW")
        if cw and list(cw) != [0.5, 0.5, 0.5]:
            out["qw"] = list(cw)

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
            ramp.append([c["t"], int(h[:6], 16), int(h[6:8], 16)])
        if ramp:
            ramp.sort(key=lambda s: s[0])
            out["r"] = ramp
            if em.get("colorScaleRepeats"):
                out["rr"] = em["colorScaleRepeats"]
    # colorMultiplier / startLocation / velocity arrive already collapsed to
    # {X: [min, max], ...} by parse_skillfx.py; only startSize stays nested.
    cm = em.get("colorMultiplier")
    if tinted and isinstance(cm, dict) and "X" in cm:
        mult = [cm[a][0] for a in "XYZ"]
        if mult != [1.0, 1.0, 1.0]:
            out["m"] = mult

    v = em.get("velocity")
    if isinstance(v, dict) and "X" in v:
        vv = [[v[a][0], v[a][1]] for a in "XYZ"]
        if any(x for pair in vv for x in pair):
            out["v"] = vv
    if em.get("acceleration") and any(em["acceleration"]):
        out["a"] = list(em["acceleration"])

    if em.get("drawStyle"):
        out["d"] = em["drawStyle"]
    if em.get("fadeIn") and em.get("fadeInEnd") is not None:
        out["fi"] = em["fadeInEnd"]
    if em.get("fadeOut") and em.get("fadeOutStart") is not None:
        out["fo"] = em["fadeOutStart"]
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
        out["sr"] = list(em["sphereRadius"])
    sl = em.get("startLocation")
    if isinstance(sl, dict) and "X" in sl:
        ll = [[sl[a][0], sl[a][1]] for a in "XYZ"]
        if any(x for pair in ll for x in pair):
            out["sl"] = ll
    if em.get("startOffset") and any(em["startOffset"]):
        out["so"] = list(em["startOffset"])
    if em.get("initialDelay") and any(em["initialDelay"]):
        out["dl"] = list(em["initialDelay"])
    return out


def pack_action(a, effect_id):
    cls = (a.get("effect") or "").split(".", 1)[-1]
    fi = effect_id(cls) if cls else None
    rec = {}
    if fi is not None:
        rec["f"] = fi
    for key in ("sourceIndex", "actionRef", "actionPath", "actionStatus", "stage", "stageSerialized"):
        if key in a:
            rec[key] = a[key]
    if a.get("effect") is not None:
        rec["effectPath"] = a["effect"]
    # Source actions without a supported renderer still affect array order
    # and stage selection. A missing EffectClass is not a null Action.
    if not rec:
        return None
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
        rec["o"] = list(a["offset"])
    if a.get("spawnDelay"):
        rec["d"] = a["spawnDelay"]
    # AttachOn (EAttachMethod). Carried for the first time 2026-08-09:
    # before this the renderer glued EVERY effect to the actor's collision
    # centre and made every one of them track the actor for life, which is
    # wrong twice over -- 44 actions name a hand or a bone, and 79 are
    # EAM_None, i.e. they must stay where they were spawned.
    # Omitted when 0 (the class default, EAM_None) to keep the file small.
    if a.get("attachOn"):
        rec["at"] = a["attachOn"]
    if a.get("bone"):
        rec["b"] = a["bone"]
    return rec

def build(verbose=True):
    effects = load("lineageeffect.json")
    with open(SKILL_USK, "rb") as source_file:
        source_sha = hashlib.sha256(source_file.read()).hexdigest()
    if source_sha != SKILL_SOURCE_SHA:
        raise ValueError("skill Agent schema requires the verified original Skill.usk build")
    with open(os.path.join(ROOT, "assets/interlude/system/Engine.u"), "rb") as source_file:
        defaults_sha = hashlib.sha256(source_file.read()).hexdigest()
    if defaults_sha != ENGINE_DEFAULTS_SHA:
        raise ValueError("FlyingTime default requires the verified original Engine.u build")
    binds, _ = parse_skill_usk(load_package(SKILL_USK)[0])
    skill_rows, skill_source = original_skillgrp()
    exact_bindings = build_bindings(skill_rows)
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

    skills, objects = {}, {}
    # Qualified source objects are separate from exact skill-level bindings.
    # Keep the old leaf/heuristic table only for existing diagnostic tools;
    # the runtime must never select a source Agent through that table.
    for sid, rec in binds.items():
        entry = {"b": 1, "f": rec["flyingTime"], "path": rec["path"], "source": rec["source"],
                 "actionFormat": "l2-skill-action-records-v1",
                 **{key: [] for key in PHASE_KEY.values()}}
        any_phase = False
        for phase, acts in (rec.get("phases") or {}).items():
            packed = [pack_action(a, effect_id) for a in acts]
            if any(p is None for p in packed):
                raise ValueError("lost original action record")
            entry[PHASE_KEY[phase]] = packed
            any_phase |= bool(packed)
        key = rec["path"].lower()
        if key in objects:
            raise ValueError("duplicate qualified source SkillVisualEffect: " + rec["path"])
        # An object with no supported drawable action is still an Agent.
        objects[key] = entry
        if any_phase:
            skills[sid] = entry

    # 2. name-convention bindings from skillfx.json. The MATCH RULE is a
    #    heuristic (the retail fallback is native code with no data presence),
    #    retained as b:2 diagnostics only; they are excluded from objects and
    #    exact bindings and cannot authorize runtime effects.
    #    Their effect classes and every parameter inside are still retail.
    for sid, rec in sfx.items():
        eff = rec.get("effects") or {}
        if eff.get("binding") != "name-convention" or sid in skills:
            continue
        entry, any_phase = {"b": 2}, False
        for phase, classes in (eff.get("phases") or {}).items():
            packed = [p for p in (pack_action({"effect": c}, effect_id) for c in classes) if p]
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
    out = {"format": "l2-interlude-skill-vfx-v2", "objects": objects, "bindings": exact_bindings,
           "source": {"skillgrp": skill_source, "skillObjects": {"file": "Skill.usk", "SHA256": source_sha},
                      "agentDefaults": {"file": "Engine.u", "SHA256": defaults_sha}},
           "tex": tex.items,
           "texa": [1 if png_has_alpha_channel(p) else 0 for p in tex.items],
           "msh": msh.items, "fxn": fx_names, "fx": fx_list, "skill": skills}
    if verbose:
        n_kept = sum(len(f["e"]) for f in fx_list)
        n_mesh = sum(1 for f in fx_list for e in f["e"] if e.get("k") == 1)
        n_skip = sum(sum(f.get("skip", {}).values()) for f in fx_list)
        expl = sum(1 for s in skills.values() if s["b"] == 1)
        print("skillvfx diagnostics: %d leaves (%d source objects, %d excluded heuristics), "
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

    # Validate original object actions, independently of which skill levels
    # actually select those objects. The legacy `skill` table is diagnostic.
    assert fresh["bindings"]["21"]["path"].lower() == "skill.wh.1012"
    assert fresh["bindings"]["1177"]["path"] == ""
    assert "skill.wh.1012" in fresh["objects"]
    assert len(fresh["objects"]) == 244
    # anchors whose source object appearance is documented in docs/skillfx-data.md
    for sid, phase, cls in (("1177", "s", "el_wind_strike_fl"),
                            ("1177", "x", "el_wind_strike_ta"),
                            ("1011", "c", "wh_heal_ca"),
                            ("1011", "s", "wh_heal_ta"),
                            ("1040", "s", "wh_shield_ta")):
        acts = fresh["skill"].get(sid, {}).get(phase, [])
        got = [fresh["fxn"][a["f"]] for a in acts if "f" in a]
        if cls not in got:
            print("CHECK FAIL: skill %s phase %s lost %s (has %s)" % (sid, phase, cls, got))
            return 1
    if fresh["skill"]["1177"].get("f") != struct.unpack("<f", struct.pack("<f", 0.4))[0]:
        print("CHECK FAIL: Wind Strike flyingTime != 0.4")
        return 1

    # --- AttachOn survives the join (added 2026-08-09) ---------------------
    # These four assert the whole attach story end to end and FAIL on any tree
    # where `at` is not carried: a shield skill's cast glint on the LEFT hand,
    # a dagger skill's on the RIGHT, a named bone reaching the client, and the
    # projectile classes staying EAM_None so they do not follow their caster.
    def action(sid, phase, cls):
        for a in fresh["skill"].get(sid, {}).get(phase, []):
            if "f" in a and fresh["fxn"][a["f"]] == cls:
                return a
        return None
    for sid, phase, cls, want in (("92", "c", "at_shield_stun_ca", ATTACH_LH),
                                  ("353", "c", "at_shield_slam_ca", ATTACH_LH),
                                  ("223", "c", "at_sting_ca", ATTACH_RH),
                                  ("263", "c", "at_mortal_blow_ca", ATTACH_RH),
                                  ("1011", "c", "wh_heal_ca", ATTACH_TRAIL)):
        a = action(sid, phase, cls)
        if a is None or a.get("at", ATTACH_NONE) != want:
            print("CHECK FAIL: skill %s %s AttachOn = %s, expected %d"
                  % (sid, cls, a and a.get("at", 0), want))
            return 1
    a = action("1177", "s", "el_wind_strike_fl")
    if a is None or "at" in a:
        print("CHECK FAIL: el_wind_strike_fl must stay EAM_None (no `at`)")
        return 1
    a = action("4683", "c", "mb_valakas_breath_low_fl")
    if a is None or a.get("at") != 3 or not a.get("b"):
        print("CHECK FAIL: Valakas breath lost its BoneSpecified attach")
        return 1
    n_at = sum(1 for s in fresh["skill"].values() for k in "cshx"
               for a in s.get(k, []) if a.get("at"))
    n_hand = sum(1 for s in fresh["skill"].values() for k in "cshx"
                 for a in s.get(k, []) if a.get("at") in (ATTACH_RH, ATTACH_LH))
    n_bone = sum(1 for s in fresh["skill"].values() for k in "cshx"
                 for a in s.get(k, []) if a.get("b"))
    if not (n_at and n_hand and n_bone):
        print("CHECK FAIL: attach counts are empty (at %d, hand %d, bone %d) "
              "-- a gate that asserts nothing" % (n_at, n_hand, n_bone))
        return 1
    print("attach: %d actions carry AttachOn (%d hand, %d named bone)"
          % (n_at, n_hand, n_bone))

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
    print("CHECK PASS: %d diagnostic leaves (%d source objects / %d excluded heuristics), %d effect classes, "
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
