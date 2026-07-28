#!/usr/bin/env python3
"""Decode the retail skill VISUAL presentation tables -> assets/gamedata/.

Two client packages hold the skill -> effect binding and the effect
definitions (neither is a .dat; both are UE2 packages decoded with
tools/l2lib):

  assets/interlude/animations/Skill.usk  (Lineage2Ver111)
      244 SkillVisualEffect objects NAMED BY SKILL ID ("110", "1177",
      "4641_a", "1217_sec", ...). Each carries:
        Desc             NameProperty   Korean designer comment
        FlyingTime       FloatProperty  projectile flight time (seconds)
        CastingActions / ChannelingActions / PreshotActions /
        ShotActions / ExplosionActions
                         ArrayProperty of SkillActionInfo structs
                         {Action -> SkillAction_LocateEffect, SpecificStage}
      524 SkillAction_LocateEffect objects carry the actual spawn params:
        EffectClass      ClassProperty  -> LineageEffect.<class>
        AttachOn         ByteProperty   EAttachMethod (raw; enum not recovered)
        AttachBoneName   NameProperty   bone when AttachOn is bone-based
        offset           Vector         spawn offset
        SpawnDelay / bAbsolute / bUseCharacterRotation /
        bRelativeToCylinder / bSpawnOnTarget / bSizeScale / bOnMultiTarget

  assets/interlude/system/LineageEffect.u  (Lineage2Ver111)
      864 effect classes (at_power_strike_cs, el_wind_strike_ta, ...) with
      3709 emitter subobjects (SpriteEmitter/MeshEmitter/BeamEmitter/
      VertMeshEmitter/RibbonEmitter). Emitter bodies are packed UE1-style
      property streams; Texture/StaticMesh/VertexMesh refs resolve to real
      texture/static-mesh packages; ColorScale holds the retail color
      ramps; Opacity/MaxParticles/LifetimeRange/StartSizeRange/
      InitialParticlesPerSecond give the basic particle parameters.

Property encoding notes (reverse-engineered against both packages, see
docs/skillfx-data.md):
  - packed props: nameidx, u8 info (bit7 array-flag / bool value,
    bits4-6 size selector, bits0-3 EPropertyType), optional array index,
    then DataSize bytes. Structs carry a nameidx struct name first.
  - TArray<struct> data = compact count, then PER ELEMENT a full packed
    property stream terminated by the 'None' name (verified byte-exact on
    every CastingActions/ShotActions array and every ColorScale).
  - Range structs = packed props {Min f32, Max f32}; RangeVector =
    {X/Y/Z: Range}; Color struct = 4 raw bytes B,G,R,A; Vector = 3 f32.

Outputs:
  assets/gamedata/lineageeffect.json      effect class decomposition
  assets/gamedata/skillvisualeffect.json  skill id -> binding table

Usage:
  /usr/bin/python3 tools/dat/parse_skillfx.py           # write JSON
  /usr/bin/python3 tools/dat/parse_skillfx.py --check   # verify only
"""

import argparse
import json
import os
import struct
import sys

sys.path.insert(0, os.path.join(ROOT := os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")), "tools", "l2lib"))
from ue2package import load_package, Reader  # noqa: E402

SKILL_USK = os.path.join(ROOT, "assets", "interlude", "animations", "Skill.usk")
LINEAGE_EFFECT = os.path.join(ROOT, "assets", "interlude", "system", "LineageEffect.u")
OUT_EFFECT = os.path.join(ROOT, "assets", "gamedata", "lineageeffect.json")
OUT_BIND = os.path.join(ROOT, "assets", "gamedata", "skillvisualeffect.json")

EMITTER_CLASSES = ("SpriteEmitter", "MeshEmitter", "BeamEmitter",
                   "VertMeshEmitter", "RibbonEmitter")
PHASES = (("CastingActions", "casting"), ("ChannelingActions", "channeling"),
          ("PreshotActions", "preshot"), ("ShotActions", "shot"),
          ("ExplosionActions", "explosion"))

PACKED_SIZES = (1, 2, 4, 12, 16)


# --------------------------------------------------------------------------
# generic packed-property decoding (UE1-style tags used inside both packages)
# --------------------------------------------------------------------------

def read_packed(pkg, r):
    """One packed property stream (terminated by the 'None' name).
    Returns {name: (ptype, struct_name_or_None, raw_bytes_or_bool)}."""
    props = {}
    while True:
        name = pkg.name(r.compact())
        if name == "None":
            return props
        info = r.u8()
        ptype, size_sel, is_array = info & 0x0F, (info >> 4) & 7, bool(info & 0x80)
        sname = pkg.name(r.compact()) if ptype == 10 else None
        if size_sel < 5:
            dsize = PACKED_SIZES[size_sel]
        elif size_sel == 5:
            dsize = r.u8()
        elif size_sel == 6:
            dsize = r.u16()
        else:
            dsize = r.u32()
        if ptype == 3:                      # bool: value IS the array flag
            props[name] = (ptype, sname, is_array)
            continue
        if is_array:                        # array index: 1/2/4 bytes
            b = r.u8()
            if b >= 128:
                r.bytes(3 if b & 0x40 else 1)
        props[name] = (ptype, sname, r.bytes(dsize))


def decode_value(pkg, ptype, sname, raw):
    """Decode one packed property value to JSON-friendly data."""
    if ptype == 3:
        return bool(raw)
    if ptype == 1:                          # byte
        return raw[0]
    if ptype == 2:                          # int
        return struct.unpack("<i", raw)[0]
    if ptype == 4:                          # float
        return struct.unpack("<f", raw)[0]
    if ptype == 5 or ptype == 8:            # object/class ref
        ci = Reader(raw).compact()
        rn = pkg.ref_name(ci)
        if rn is None:
            return None
        return rn[0] + "." + rn[1] if rn[0] else rn[1]
    if ptype == 6:                          # name
        return pkg.name(Reader(raw).compact())
    if ptype == 10:                         # struct
        if len(raw) == 4:                   # Color: B,G,R,A
            b, g, rr, a = raw
            return "#%02x%02x%02x%02x" % (rr, g, b, a)
        if len(raw) == 12:                  # Vector/Rotator: 3 x f32
            return list(struct.unpack("<3f", raw))
        # Range / RangeVector / nested struct: packed props again
        return decode_struct(pkg, raw)
    if ptype == 9:                          # array: count + per-element streams
        try:
            return decode_struct_array(pkg, raw)
        except Exception:
            return {"_raw": raw.hex()}
    return {"_raw": raw.hex()}


def decode_struct(pkg, data):
    r = Reader(data)
    out = {}
    for name, (ptype, sname, raw) in read_packed(pkg, r).items():
        out[name] = decode_value(pkg, ptype, sname, raw)
    return out


def decode_struct_array(pkg, data):
    r = Reader(data)
    out = []
    for _ in range(r.compact()):
        elem = {}
        for name, (ptype, sname, raw) in read_packed(pkg, r).items():
            elem[name] = decode_value(pkg, ptype, sname, raw)
        out.append(elem)
    if r.pos != len(data):
        raise ValueError("struct array desync: %d/%d bytes" % (r.pos, len(data)))
    return out


def rng(v):
    """Collapse a decoded {Min, Max} range to [min, max]; pass scalars through."""
    if isinstance(v, dict) and set(v) == {"Min", "Max"}:
        return [v["Min"], v["Max"]]
    return v


# --------------------------------------------------------------------------
# LineageEffect.u -> lineageeffect.json
# --------------------------------------------------------------------------

def parse_effect_classes(pkg):
    classes = {}
    for cls_exp in pkg.exports_by_class("Class"):
        cname = pkg.export_name(cls_exp)
        ref = pkg.exports.index(cls_exp) + 1
        sup = pkg.ref_name(cls_exp.super_index)
        emitters = []
        for e in pkg.exports:
            if e.package_index != ref or pkg.class_name_of(e) not in EMITTER_CLASSES:
                continue
            props = read_packed(pkg, pkg.body_reader(e))
            em = {"name": pkg.export_name(e), "type": pkg.class_name_of(e)}
            for key, (ptype, sname, raw) in props.items():
                v = decode_value(pkg, ptype, sname, raw)
                if key in ("Texture", "StaticMesh", "VertexMesh"):
                    em[{"Texture": "texture", "StaticMesh": "mesh",
                        "VertexMesh": "mesh"}[key]] = v
                elif key == "ColorScale":
                    if isinstance(v, list):
                        em["colors"] = [{"t": c.get("Time"), "c": c.get("Color")}
                                        for c in v]
                elif key == "Opacity":
                    em["opacity"] = v
                elif key == "MaxParticles":
                    em["maxParticles"] = v
                elif key == "LifetimeRange":
                    em["lifetime"] = rng(v)
                elif key == "StartSizeRange":
                    em["startSize"] = rng(v)
                elif key == "InitialParticlesPerSecond":
                    em["particlesPerSecond"] = v
                elif key == "AutomaticInitialSpawning":
                    em["autoSpawning"] = v
                elif key == "DrawStyle":
                    em["drawStyle"] = v
                elif key == "StartVelocityRange":
                    em["velocity"] = {k: rng(x) for k, x in v.items()} \
                        if isinstance(v, dict) else v
                elif key == "SpinParticles":
                    em["spin"] = v
            emitters.append(em)
        entry = {"super": sup[1] if sup else None, "emitters": emitters}
        classes[cname] = entry
    return classes


# --------------------------------------------------------------------------
# Skill.usk -> skillvisualeffect.json
# --------------------------------------------------------------------------

def parse_skill_usk(pkg):
    # Decode every SkillAction_LocateEffect ONCE, keyed by EXPORT INDEX —
    # their object names are NOT unique (SkillAction_LocateEffect3 appears
    # 25x), so Action refs must be resolved by index, never by name.
    actions = {}                      # 1-based export index -> decoded action
    for i, e in enumerate(pkg.exports):
        if pkg.class_name_of(e) != "SkillAction_LocateEffect":
            continue
        props = read_packed(pkg, pkg.body_reader(e))
        act = {}
        for key, (ptype, sname, raw) in props.items():
            v = decode_value(pkg, ptype, sname, raw)
            if key == "EffectClass":
                act["effect"] = v
            elif key == "AttachOn":
                act["attachOn"] = v
            elif key == "AttachBoneName":
                act["bone"] = v
            elif key == "offset":
                act["offset"] = v
            elif key == "SpawnDelay":
                act["spawnDelay"] = v
            elif key == "bAbsolute":
                act["absolute"] = v
            elif key == "bUseCharacterRotation":
                act["useCharRotation"] = v
            elif key == "bRelativeToCylinder":
                act["relativeToCylinder"] = v
            elif key == "bSpawnOnTarget":
                act["onTarget"] = v
            elif key == "bSizeScale":
                act["sizeScale"] = v
            elif key == "bOnMultiTarget":
                act["onMultiTarget"] = v
        actions[i + 1] = act

    skills = {}
    for e in pkg.exports_by_class("SkillVisualEffect"):
        props = read_packed(pkg, pkg.body_reader(e))
        rec = {}
        phases = {}
        for key, (ptype, sname, raw) in props.items():
            if key == "Desc":
                rec["desc"] = decode_value(pkg, ptype, sname, raw)
            elif key == "FlyingTime":
                rec["flyingTime"] = decode_value(pkg, ptype, sname, raw)
            else:
                for prop_name, phase in PHASES:
                    if key == prop_name:
                        lst = []
                        # SkillActionInfo array: the Action field is an
                        # object ref (compact export index) — decode it by
                        # hand so the index survives (names collide).
                        r = Reader(raw)
                        for _ in range(r.compact()):
                            elem = read_packed(pkg, r)
                            item = {}
                            if "Action" in elem:
                                ci = Reader(elem["Action"][2]).compact()
                                if ci > 0 and actions.get(ci) is not None:
                                    item.update(actions[ci])
                                else:
                                    item["action"] = pkg.ref_name(ci)
                            if "SpecificStage" in elem:
                                stage = decode_value(pkg, *elem["SpecificStage"])
                                if stage:
                                    item["stage"] = stage
                            lst.append(item)
                        if r.pos != len(raw):
                            raise ValueError(f"{pkg.export_name(e)}.{key}: array desync")
                        phases[phase] = lst
        rec["phases"] = phases
        skills[pkg.export_name(e)] = rec
    return skills, actions


# --------------------------------------------------------------------------

def sanity(effects, skills):
    # anchors from the retail data itself (docs/skillfx-data.md)
    assert "at_power_strike_cs" in effects, "Power Strike effect class missing"
    em_types = sorted(e["type"] for e in effects["at_power_strike_cs"]["emitters"])
    assert em_types == ["MeshEmitter", "MeshEmitter", "SpriteEmitter"], em_types
    texs = {e["texture"] for e in effects["at_power_strike_cs"]["emitters"]
            if e.get("texture")}
    assert "LineageEffectsTextures.fx_m_t0002" in texs, texs
    for cls in ("el_wind_strike_ca", "el_wind_strike_fl", "el_wind_strike_pr",
                "el_wind_strike_ta", "wh_shield_ta", "wh_heal_ca", "wh_heal_ta"):
        assert cls in effects, cls + " missing"
    # binding anchors: 1177 Wind Strike / 1040 Shield / 1011 Heal are explicit
    b1177 = [a.get("effect") for p in skills["1177"]["phases"].values() for a in p]
    assert "LineageEffect.el_wind_strike_ta" in b1177, b1177
    b1040 = [a.get("effect") for p in skills["1040"]["phases"].values() for a in p]
    assert "LineageEffect.wh_shield_ta" in b1040, b1040
    b1011 = [a.get("effect") for p in skills["1011"]["phases"].values() for a in p]
    assert "LineageEffect.wh_heal_ca" in b1011, b1011
    # every bound EffectClass must exist in LineageEffect.u
    missing = set()
    for rec in skills.values():
        for acts in rec["phases"].values():
            for a in acts:
                eff = a.get("effect")
                if eff and eff.startswith("LineageEffect.") \
                        and eff.split(".", 1)[1] not in effects:
                    missing.add(eff)
    assert not missing, f"bindings reference unknown classes: {sorted(missing)[:5]}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify only, write nothing")
    args = ap.parse_args()

    le_pkg, _ = load_package(LINEAGE_EFFECT)
    effects = parse_effect_classes(le_pkg)
    usk_pkg, _ = load_package(SKILL_USK)
    skills, _ = parse_skill_usk(usk_pkg)
    sanity(effects, skills)

    n_em = sum(len(c["emitters"]) for c in effects.values())
    if args.check:
        for path, data in ((OUT_EFFECT, effects), (OUT_BIND, skills)):
            if not os.path.exists(path):
                sys.exit(f"CHECK FAIL: {os.path.basename(path)} missing")
            with open(path) as f:
                if json.load(f) != data:
                    sys.exit(f"CHECK FAIL: {os.path.basename(path)} stale — re-run the tool")
        print(f"CHECK PASS: {len(effects)} effect classes ({n_em} emitters), "
              f"{len(skills)} skill bindings, JSON in sync")
        return 0

    with open(OUT_EFFECT, "w") as f:
        json.dump(effects, f, indent=1, ensure_ascii=False, sort_keys=True)
        f.write("\n")
    with open(OUT_BIND, "w") as f:
        json.dump(skills, f, indent=1, ensure_ascii=False,
                  sort_keys=lambda k: (not k.isdigit(), int(k) if k.isdigit() else k))
        f.write("\n")
    print(f"lineageeffect.json: {len(effects)} classes, {n_em} emitters")
    print(f"skillvisualeffect.json: {len(skills)} skill bindings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
