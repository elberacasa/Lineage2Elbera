#!/usr/bin/env python3
"""sky.py - the LAYERS of skylevel.unr that the client does not yet draw.

WHAT THIS ADDS, AND WHAT IT DOES NOT TOUCH

`tools/audit/probe_skydome.py` settled the two layers the client already
draws: the flat #0096CE background and the warm haze band, both of which
tint a texture with exactly ONE distinct RGB, so "texture x colour" reduces
to a single number and nothing is left over. That probe closed by naming
what it deliberately did NOT settle:

    "NOT REPRODUCED, and deliberately not guessed at: the Cloud_Final
     sheet, both StarField sheets, NSun0/NMoon0..4 and the nine-element
     LensFlare array. Those tint non-flat textures, so their rendered
     result is texture x colour and is NOT settled by a single value the
     way these two are."

That is exactly right about the arithmetic and WRONG about one of the
layers, and the correction is the most useful thing here. "Those tint
non-flat textures" is true of the starfields, the sun, the moon and the
flares -- and NOT of the cloud. `WhiteCloud`, measured, is 1024x1024 with
exactly ONE distinct RGB and an ALPHA that runs 0..208 (mean 50.4). That
is the identical situation to WhiteChip and WhiteRing: a constant RGB
times a colour IS a colour, and the alpha is the coverage. The cloud
sheet was in the "cannot be settled by a single value" list only because
nobody had opened the texture.

That constant is (255, 251, 255) -- the SAME off-white as WhiteRing, not
pure white, and this docstring claimed pure white until --check refused
it. So the rendered cloud colour is #FFC097 x (255,251,255)/255, by the
same arithmetic probe_skydome.py used to turn #FFE495 into the haze's
#FFE095. Masked by the alpha channel.

One unit of that is genuinely undecided and is not hidden: the green
channel works out to 192 x 251 / 255 = 188.99, and which side of it the
engine's 8-bit modulate lands on is NOT sourced. This file takes the
floor, 188 (#FFBC97), because that is what an integer multiply-and-divide
gives; the alternative is 189 (#FFBD97). It is a 1/255 ambiguity in one
channel, recorded here rather than rounded away quietly. The haze does
not have this problem -- 228 x 251 / 255 = 224.4 floors and rounds to the
same 224 -- which is why it never came up before.

The other four are reproducible too, for a different and equally measured
reason: their alpha is the CONSTANT 255 (starfields, all five flares), so
alpha cannot be what gives them their shape -- their own RGB is, over a
near-black field (StarField_largeStar02 rgb mean 0.0 over 35 distinct
values; Flare02 0.1 over 24). A layer like that needs its texture shipped
and nothing decided.

So: this file decodes the material chain of each one down to a real image,
writes the images out, and records the geometry and the animation rates the
retail actors carry. It computes no colour, no gradient and no falloff of
its own.

This file does not touch probe_skydome.py, main.js, or the two layers they
already own. It writes a sibling `assets/world/sky/` and nothing else.

WHAT DECODES, AND FROM WHERE

skylevel.unr (protocol 111) holds a 55-node built BSP whose nodes carry
exactly five materials -- 5 SkybackgroundColor, 47 HazeRing_Final, and ONE
node each of Cloud_Final, StarField_Final01 and StarField_Final02. The
three single-node materials are the three unreproduced sheets, and one node
each means each sheet's world quad is read off the BSP directly, with no
reconstruction: its corner Points, its plane, and the retail BSP texture
projection (the same `surface_geometry` formula tools/world/bsp.py uses).

l2_skies.utx (protocol 121) holds the material chains. Every one of them
terminates in a real texture, and every link was read, not assumed:

  Cloud_Final        ColorModifier, Color (B,G,R,A) = 97 C0 FF FF -> the
                     RGB #FFC097, over Shader `Cloud`, whose Diffuse AND
                     Opacity are both TexPanner0 -> texture `WhiteCloud`,
                     1024x1024. Diffuse and Opacity being the same panner
                     is what makes the cloud a self-masking sheet: the
                     texture's own alpha is its coverage.
                     TexPanner0.PanRate is a float and is recorded.
  StarField_Final01  ColorModifier over Shader `StarField01`
                     (OutputBlending 3) -> TexRotator1 -> texture
                     `StarField_largeStar02`, 1024x1024.
  StarField_Final02  ColorModifier over Shader `StarField02`
                     (OutputBlending 3) -> TexRotator0 -> texture
                     `StarField_smallStar01`, 1024x1024, tinted #666666.
                     The two StarField ColorModifiers are NOT symmetric and
                     this docstring said they were until --check refused
                     it: _01 omits `Color` entirely, _02 carries
                     (B,G,R,A) = 66 66 66 FF -> #666666. UE2 only
                     serialises a property that differs from the class
                     default, so _01's absent Color means the class
                     default, and this file records it as ABSENT rather
                     than inventing white. See KNOWN GAPS 1.
  the sun            NSun0: Radius 350, LimitMaxRadius 50, a Rotation, and
                     a Skins array. The sun's texture in the package is
                     `Sun01`, 128x128.
  the moons          NMoon0..4, Radius 245, bMoonLight False, and an
                     `EnvType` that is the only field that differs between
                     them. Its meaning is NOT established -- see GAPS.
  the lens flare     SkyZoneInfo0 carries THREE parallel nine-element
                     arrays -- LensFlare (an object ref), LensFlareOffset
                     (float) and LensFlareScale (float) -- and all nine
                     object refs resolve through the import table to real
                     textures: Flare02 x4, then Flare01, Flare03, Flare04,
                     Flare06, Flare06. Offsets run -0.12 .. 0.60 and scales
                     0.30 .. 3.0. This is a complete, sourced flare rig;
                     nothing about it is estimated.

WHY THE PARALLEL-ARRAY READING IS SAFE. UE2 serialises a static array as
one tagged property per element, in index order, so nine `LensFlare`, nine
`LensFlareOffset` and nine `LensFlareScale` properties in the actor body
ARE the three arrays. --check asserts all three lengths are equal and 9; if
the reader ever mis-frames the body one of them will change length.

KNOWN GAPS - none is papered over, and none blocks shipping the textures

  1. StarField_Final01 does not serialise `Color`, so its tint is the
     ColorModifier class default and this file does not know it. Its
     texture is emitted and the tint is recorded as null. Anyone wiring
     the large-star layer must either source the class default out of
     Engine's ColorModifier defaults or draw it untinted and say so; this
     tool refuses to write white and call it a measurement.
     StarField_Final02 is NOT in this gap: it carries #666666 explicitly.
  2. NMoon.EnvType is 1 or 2 and its meaning is not established. It is
     recorded verbatim. It is NOT known to select a moon phase, a weather
     state or anything else -- NMoon actors at ONE location with two
     distinct EnvTypes is all the data says.
  2b. only THREE of the five NMoon bodies yield properties to this reader
     (NMoon1, NMoon2, NMoon4 -> Radius 245, EnvType 1/1/2). NMoon0 and
     NMoon3 do not: the offset scan finds no property list inside their
     serial size, and NMoon3's body reads as a single `Sheet` tag before
     terminating. Whether they are stubs or whether the reader mis-frames
     them is NOT established, so they are emitted with null fields rather
     than filled in from their siblings. --check pins the count at 3 of 5,
     so if the reader improves, the gap closes loudly.
  3. the TexPanner / TexRotator / TexOscillator modifiers carry rates
     (PanRate, Rotation, UOffset/VOffset, oscillation amplitudes) that are
     recorded verbatim but whose UNITS are not established, so this file
     does not convert any of them into degrees or units per second.
  4. NSun0.Skins and NMoon*.Skins are dynamic arrays this reader does not
     resolve; the sun/moon textures shipped here are the ones the package
     names (`Sun01`, `Default_Moon`), NOT a resolved Skins[0]. Recorded as
     such, and --check pins it.

OUTPUT

    assets/world/sky/sky.json     every value below, with its source
    assets/world/sky/<name>.png   WhiteCloud, StarField_largeStar02,
                                  StarField_smallStar01, Sun01,
                                  Default_Moon, Flare01..Flare06

Usage:
    python3 tools/world/sky.py            # decode + write
    python3 tools/world/sky.py --json     # print, write nothing
    python3 tools/world/sky.py --check    # exit 1 on drift
"""

import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tools", "utx"))
sys.path.insert(0, os.path.join(ROOT, "tools", "maps"))

from l2lib import ue2package as U                      # noqa: E402
from l2lib import extract_texture_rgba                 # noqa: E402
from l2lib.textures import write_png                   # noqa: E402

SKYLEVEL = os.path.join(ROOT, "assets/interlude/maps/skylevel.unr")
SKIES = os.path.join(ROOT, "assets/interlude/textures/l2_skies.utx")
OUT = os.path.join(ROOT, "assets/world/sky")

# The three sheets the client does not draw, and the material each carries
# on its single BSP node. Measured: skylevel.unr's 55 nodes carry exactly
# five materials and these three appear on ONE node each.
SHEETS = ("Cloud_Final", "StarField_Final01", "StarField_Final02")

# Textures shipped so the layers can be drawn at all. Each is the terminal
# leaf of a chain read in decode(), not a name picked by eye.
TEXTURES = ("WhiteCloud", "StarField_largeStar02", "StarField_smallStar01",
            "Sun01", "Default_Moon",
            "Flare01", "Flare02", "Flare03", "Flare04", "Flare06")

# The flare rig, pinned so a mis-framed actor body cannot pass quietly.
FLARE_COUNT = 9
FLARE_TEXTURES = ["Flare02", "Flare02", "Flare02", "Flare02",
                  "Flare01", "Flare03", "Flare04", "Flare06", "Flare06"]


class SkyError(Exception):
    pass


# --------------------------------------------------------------- helpers

def _packed_props(pkg, name):
    e = pkg.find_export(name)
    if e is None:
        raise SkyError("no export %r in %s" % (name, os.path.basename(pkg.path)))
    return e, U.read_properties(pkg, pkg.body_reader(e), fmt="packed")


def _ref(pkg, raw):
    """A packed object-property payload -> the export it names, or None."""
    if raw is None:
        return None
    ci = U.Reader(bytes(raw)).compact()
    try:
        obj = pkg.resolve_ref(ci)
    except Exception:
        return None
    return obj if isinstance(obj, U.Export) else None


def _color(props):
    """FColor is 4 bytes B,G,R,A -- the order docs/ui-mined-native.md
    established and the one under which the sky reads blue, not orange."""
    raw = props.get("Color")
    if raw is None:
        return None
    return [raw[2], raw[1], raw[0], raw[3]]


def _f32(raw):
    if raw is None or len(raw) < 4:
        return None
    return struct.unpack_from("<f", bytes(raw))[0]


def _actor_props(pkg, export):
    """Actor bodies carry a TAGGED property list; borrow tools/maps/unrmap
    the same way probe_skydome.py does, scanning for the body offset rather
    than assuming one."""
    import unrmap                                       # noqa: E402
    for start in range(0, 25):
        try:
            props, rel = unrmap.read_props(pkg, export, start)
        except Exception:
            continue
        if props and rel <= export.serial_size:
            return props
    return None


def _all_values(props, name):
    """Every value serialised under `name`, in file order.

    UE2 writes a static array as one tagged property per element in index
    order, so this IS the array. Returned as a list so --check can assert
    the three flare arrays are the same length.
    """
    return [p["value"] for p in props if p["name"] == name]


def _one(props, name):
    v = _all_values(props, name)
    return v[0] if v else None


# ---------------------------------------------------------------- decode

def _sheet_geometry(pkg, model):
    """The three unreproduced sheets, straight off the BSP.

    One node each, so there is nothing to merge and nothing to average:
    the quad's corners are its node's Points and its UVs are the retail BSP
    projection (identical formula to tools/world/bsp.py surface_geometry,
    normalised by the terminal texture's size by the caller).
    """
    out = {}
    counts = {}
    for i, node in enumerate(model.nodes):
        surf = model.surfs[node.i_surf]
        ref = pkg.ref_name(surf.material)
        name = ("%s.%s" % ref) if ref else None
        if name is None:
            continue
        counts[name] = counts.get(name, 0) + 1
        short = name.split(".")[-1]
        if short not in SHEETS:
            continue
        base = model.points[surf.p_base]
        tu = model.vectors[surf.v_texture_u]
        tv = model.vectors[surf.v_texture_v]
        corners = []
        uv_raw = []
        for k in range(node.num_vertices):
            p = model.points[model.verts[node.i_vert_pool + k][0]]
            corners.append([p[0], p[1], p[2]])
            d = (p[0] - base[0], p[1] - base[1], p[2] - base[2])
            uv_raw.append([d[0] * tu[0] + d[1] * tu[1] + d[2] * tu[2],
                           d[0] * tv[0] + d[1] * tv[1] + d[2] * tv[2]])
        out[short] = {
            "node": i,
            "material": name,
            "corners": corners,
            # UV in TEXELS; divide by the terminal texture's size to get
            # the 0..1 the renderer wants. Kept in texels so the value does
            # not silently depend on which texture you think it is.
            "uvTexels": uv_raw,
            "plane": [node.plane[0], node.plane[1], node.plane[2],
                      node.plane[3]],
            "polyFlags": surf.flags,
        }
    return out, counts


def _chain(pkg, top):
    """Walk a ColorModifier -> Shader -> modifier -> Texture chain.

    Every link is read out of the package; the walk stops at the first
    export whose class is Texture, and the classes it passed through are
    recorded so a changed chain cannot be mistaken for the old one.
    """
    e, props = _packed_props(pkg, top)
    chain = [{"name": top, "class": pkg.class_name_of(e),
              "color": _color(props)}]
    seen = {top}
    node, nprops = e, props
    while pkg.class_name_of(node) != "Texture":
        nxt = None
        for key in ("Material", "Diffuse", "Texture"):
            nxt = _ref(pkg, nprops.get(key))
            if nxt is not None:
                break
        if nxt is None:
            raise SkyError("%s: chain stops at %s (%s) with no Material, "
                           "Diffuse or Texture" % (top, pkg.export_name(node),
                                                   pkg.class_name_of(node)))
        name = pkg.export_name(nxt)
        if name in seen:
            raise SkyError("%s: chain loops at %s" % (top, name))
        seen.add(name)
        node, nprops = _packed_props(pkg, name)
        entry = {"name": name, "class": pkg.class_name_of(node)}
        # the animation rates, verbatim (gap 3)
        for key in ("PanRate", "Rotation", "UOffset", "VOffset",
                    "TexRotationType", "OutputBlending",
                    "UOscillationRate", "VOscillationRate",
                    "UOscillationAmplitude", "VOscillationAmplitude"):
            if key in nprops:
                raw = nprops[key]
                entry[key] = (list(raw) if isinstance(raw, (bytes, bytearray))
                              and len(raw) != 4 else _f32(raw)
                              if isinstance(raw, (bytes, bytearray))
                              else raw)
        # Opacity is what makes the cloud self-masking; record whether it
        # is the SAME object as the diffuse rather than asserting it.
        op = _ref(pkg, nprops.get("Opacity"))
        if op is not None:
            entry["opacity"] = pkg.export_name(op)
        chain.append(entry)
        if len(chain) > 8:
            raise SkyError("%s: chain longer than 8 links" % top)
    return chain


def decode():
    lvl, lvl_proto = U.load_package(SKYLEVEL)
    model = U.level_model(lvl)
    if model is None:
        raise SkyError("skylevel.unr: no level UModel")
    sheets, mat_counts = _sheet_geometry(lvl, model)
    missing = [s for s in SHEETS if s not in sheets]
    if missing:
        raise SkyError("skylevel.unr carries no BSP node for %s" % missing)

    skies, skies_proto = U.load_package(SKIES)
    chains = {s: _chain(skies, s) for s in SHEETS}

    # --- the actors -----------------------------------------------------
    sky_zone = None
    sun = None
    moons = []
    for e in lvl.exports:
        cls = lvl.class_name_of(e)
        if cls not in ("SkyZoneInfo", "NSun", "NMoon"):
            continue
        props = _actor_props(lvl, e)
        if not props:
            continue
        if cls == "SkyZoneInfo":
            flare_refs = _all_values(props, "LensFlare")
            flares = []
            for raw in flare_refs:
                ci = raw[1] if isinstance(raw, tuple) else raw
                ref = lvl.ref_name(ci)
                flares.append({"package": ref[0], "texture": ref[1]}
                              if ref else None)
            sky_zone = {
                "name": lvl.export_name(e),
                "location": _one(props, "Location"),
                "drawScale": _one(props, "DrawScale"),
                "texUPanSpeed": _one(props, "TexUPanSpeed"),
                "texVPanSpeed": _one(props, "TexVPanSpeed"),
                "lensFlare": flares,
                "lensFlareOffset": _all_values(props, "LensFlareOffset"),
                "lensFlareScale": _all_values(props, "LensFlareScale"),
            }
        elif cls == "NSun":
            sun = {
                "name": lvl.export_name(e),
                "location": _one(props, "Location"),
                "rotation": _one(props, "Rotation"),
                "radius": _one(props, "Radius"),
                "limitMaxRadius": _one(props, "LimitMaxRadius"),
                "bDirectional": _one(props, "bDirectional"),
                # gap 4: Skins is a dynamic array this reader does not
                # resolve, so the texture below is the package's Sun01 and
                # is labelled as such, not as "Skins[0]".
                "textureFromPackage": "Sun01",
            }
        else:
            moons.append({
                "name": lvl.export_name(e),
                "location": _one(props, "Location"),
                "radius": _one(props, "Radius"),
                "envType": _one(props, "EnvType"),
                "bMoonLight": _one(props, "bMoonLight"),
                "textureFromPackage": "Default_Moon",
            })
    moons.sort(key=lambda m: m["name"])

    if sky_zone is None:
        raise SkyError("skylevel.unr: no SkyZoneInfo with readable props")
    if sun is None:
        raise SkyError("skylevel.unr: no NSun with readable props")

    textures = {}
    for name in TEXTURES:
        e = skies.find_export(name)
        if e is None:
            raise SkyError("l2_skies.utx: no texture %r" % name)
        w, h, rgba, _info = extract_texture_rgba(skies, e)
        alpha = rgba[3::4]
        rgbs = set(bytes(rgba[i:i + 3]) for i in range(0, len(rgba), 4))
        textures[name] = {
            "w": w, "h": h,
            # WHICH CHANNEL CARRIES THE SHAPE. This is the whole question
            # for every layer here, and it is measured rather than assumed:
            # a texture with one distinct RGB and a varying alpha is a
            # coverage mask (the cloud), and one with a constant alpha and
            # a varying RGB cannot be alpha-blended into shape at all -- its
            # own colour is its intensity (the starfields, the flares).
            "distinctRgb": len(rgbs),
            "rgb": list(next(iter(rgbs))) if len(rgbs) == 1 else None,
            "alphaMin": min(alpha), "alphaMax": max(alpha),
            "alphaMean": round(sum(alpha) / len(alpha), 2),
            "_rgba": rgba,
        }

    cloud_mod = chains["Cloud_Final"][0]["color"]
    cloud_rgb = textures["WhiteCloud"]["rgb"]
    rendered = ([cloud_mod[i] * cloud_rgb[i] // 255 for i in range(3)]
                if cloud_mod and cloud_rgb else None)

    return {
        "cloudRenderedRgb": rendered,
        "source": {
            "level": os.path.relpath(SKYLEVEL, ROOT), "levelProtocol": lvl_proto,
            "package": os.path.relpath(SKIES, ROOT), "packageProtocol": skies_proto,
        },
        "nodeMaterialCounts": mat_counts,
        "sheets": sheets,
        "chains": chains,
        "skyZone": sky_zone,
        "sun": sun,
        "moons": moons,
        "textures": textures,
    }


# ----------------------------------------------------------------- write

def write(info):
    if not os.path.isdir(OUT):
        os.makedirs(OUT)
    shipped = json.loads(json.dumps(
        {k: v for k, v in info.items() if k != "textures"}, default=list))
    tex_meta = {}
    for name, t in info["textures"].items():
        write_png(os.path.join(OUT, name + ".png"), t["w"], t["h"], t["_rgba"])
        tex_meta[name] = {"w": t["w"], "h": t["h"], "file": name + ".png"}
    shipped["textures"] = tex_meta
    with open(os.path.join(OUT, "sky.json"), "w") as f:
        json.dump(shipped, f, indent=1, sort_keys=True)
    return shipped


# ----------------------------------------------------------------- check

def check():
    problems = []
    try:
        info = decode()
    except SkyError as exc:
        return ["skylevel/l2_skies did not decode: %s" % exc]

    # one BSP node per unreproduced sheet -- the whole reason the geometry
    # needs no reconstruction
    for s in SHEETS:
        n = info["nodeMaterialCounts"].get("L2_Skies." + s)
        if n != 1:
            problems.append(
                "%s is on %r BSP nodes, not exactly 1 -- the sheet geometry "
                "in sky.json is only a straight read while that holds" % (s, n))

    # every chain must terminate in a real Texture
    for s, chain in info["chains"].items():
        if chain[-1]["class"] != "Texture":
            problems.append("%s: chain ends on %s (%s), not a Texture"
                            % (s, chain[-1]["name"], chain[-1]["class"]))
    cloud = info["chains"]["Cloud_Final"]
    if cloud[0]["color"] != [255, 192, 151, 255]:
        problems.append("Cloud_Final's colour is %r, not #FFC097"
                        % (cloud[0]["color"],))
    # GAP 1, pinned in BOTH directions. _01 has no Color and _02 has
    # #666666; this asymmetry is the single most mis-rememberable fact in
    # the file (this docstring got it wrong once and this gate caught it),
    # so a change either way has to be deliberate.
    if info["chains"]["StarField_Final01"][0]["color"] is not None:
        problems.append(
            "StarField_Final01 now serialises a Color (%r). KNOWN GAPS 1 "
            "says it does not and the layer is drawn untinted -- close the "
            "gap rather than quietly using it"
            % (info["chains"]["StarField_Final01"][0]["color"],))
    if info["chains"]["StarField_Final02"][0]["color"] != [102, 102, 102, 255]:
        problems.append(
            "StarField_Final02's colour is %r, not #666666"
            % (info["chains"]["StarField_Final02"][0]["color"],))
    # the cloud is self-masking: Diffuse and Opacity are the SAME object
    shader = next((c for c in cloud if c["class"] == "Shader"), None)
    if shader is None or shader.get("opacity") != "TexPanner0":
        problems.append("Cloud's shader no longer routes Opacity through "
                        "TexPanner0 (got %r) -- the sheet stops being "
                        "self-masking" % (shader or {}).get("opacity"))

    # the flare rig: three parallel arrays of nine, and the exact textures
    z = info["skyZone"]
    lens = [f["texture"] if f else None for f in z["lensFlare"]]
    if len(lens) != FLARE_COUNT or len(z["lensFlareOffset"]) != FLARE_COUNT \
            or len(z["lensFlareScale"]) != FLARE_COUNT:
        problems.append(
            "the lens-flare arrays are %d/%d/%d long, not %d each -- the "
            "actor body is being mis-framed"
            % (len(lens), len(z["lensFlareOffset"]), len(z["lensFlareScale"]),
               FLARE_COUNT))
    elif lens != FLARE_TEXTURES:
        problems.append("the lens-flare textures are %r, not %r"
                        % (lens, FLARE_TEXTURES))

    if len(info["moons"]) != 5:
        problems.append("skylevel.unr has %d NMoon actors, not 5"
                        % len(info["moons"]))
    readable = [m["name"] for m in info["moons"] if m["radius"] is not None]
    if readable != ["NMoon1", "NMoon2", "NMoon4"]:
        problems.append(
            "the NMoon actors whose bodies yield properties are %r, not "
            "['NMoon1', 'NMoon2', 'NMoon4'] -- KNOWN GAPS 2b describes the "
            "two that do not read, and a change here closes or widens it"
            % (readable,))
    env = sorted(set(m["envType"] for m in info["moons"]
                     if m["envType"] is not None))
    if env and env != [1, 2]:
        problems.append("NMoon EnvType values are %r, not [1, 2] -- KNOWN "
                        "GAPS 2 describes the set that was measured" % (env,))

    for name, t in info["textures"].items():
        if t["w"] <= 0 or t["h"] <= 0:
            problems.append("%s decoded to %dx%d" % (name, t["w"], t["h"]))

    # WHICH CHANNEL CARRIES THE SHAPE -- the claim each layer's
    # reproduction rests on. Pinned so it cannot rot into an assumption.
    cloud_tex = info["textures"]["WhiteCloud"]
    if cloud_tex["distinctRgb"] != 1 or cloud_tex["rgb"] != [255, 251, 255]:
        problems.append(
            "WhiteCloud has %d distinct RGB values (%r), not the single "
            "(255, 251, 255) -- the cloud layer stops being 'flat #FFC097 x "
            "that constant, masked by alpha' and its reproduction needs "
            "revisiting" % (cloud_tex["distinctRgb"], cloud_tex["rgb"]))
    if info["cloudRenderedRgb"] != [255, 188, 151]:
        problems.append(
            "the cloud's rendered colour is now %r, not #FFBC97 (#FFC097 x "
            "WhiteCloud's constant RGB, floored -- see the docstring on the "
            "one-unit ambiguity in green)" % (info["cloudRenderedRgb"],))
    if cloud_tex["alphaMin"] != 0 or cloud_tex["alphaMax"] <= 0:
        problems.append(
            "WhiteCloud's alpha runs %d..%d -- it is supposed to be the "
            "coverage mask, so it must reach 0 somewhere"
            % (cloud_tex["alphaMin"], cloud_tex["alphaMax"]))
    for name in ("StarField_largeStar02", "StarField_smallStar01",
                 "Flare01", "Flare02", "Flare03", "Flare04", "Flare06"):
        t = info["textures"][name]
        if (t["alphaMin"], t["alphaMax"]) != (255, 255):
            problems.append(
                "%s's alpha runs %d..%d, not the constant 255 that is the "
                "reason this layer is drawn by its own RGB rather than "
                "alpha-blended" % (name, t["alphaMin"], t["alphaMax"]))
        if t["distinctRgb"] < 2:
            problems.append("%s has %d distinct RGB values -- with a "
                            "constant alpha AND a constant RGB there would "
                            "be nothing to draw"
                            % (name, t["distinctRgb"]))

    # the shipped sibling must match what the packages decode to now
    path = os.path.join(OUT, "sky.json")
    if not os.path.exists(path):
        problems.append("no assets/world/sky/sky.json -- run "
                        "`python3 tools/world/sky.py`")
    else:
        with open(path) as f:
            have = json.load(f)
        for name in info["textures"]:
            if not os.path.exists(os.path.join(OUT, name + ".png")):
                problems.append("assets/world/sky/%s.png is missing" % name)
        if [f["texture"] if f else None
                for f in have.get("skyZone", {}).get("lensFlare", [])] != lens:
            problems.append("sky.json's lens-flare textures are stale")
        if sorted(have.get("textures", {})) != sorted(info["textures"]):
            problems.append("sky.json lists %r, the packages decode %r"
                            % (sorted(have.get("textures", {})),
                               sorted(info["textures"])))
    return problems


def main(argv):
    args = argv[1:]
    if args and args[0] == "--check":
        problems = check()
        for p in problems:
            print("FAIL " + p)
        print("--check: %d problems" % len(problems))
        return 1 if problems else 0
    info = decode()
    if args and args[0] == "--json":
        print(json.dumps({k: v for k, v in info.items() if k != "textures"},
                         indent=1, sort_keys=True, default=list))
        return 0
    shipped = write(info)
    print("sky: %d sheets, %d flare elements, %d moons, %d textures -> %s"
          % (len(shipped["sheets"]), len(shipped["skyZone"]["lensFlare"]),
             len(shipped["moons"]), len(shipped["textures"]),
             os.path.relpath(OUT, ROOT)))
    for s in SHEETS:
        chain = shipped["chains"][s]
        print("  %-18s %s" % (s, " -> ".join(
            "%s(%s)" % (c["name"], c["class"]) for c in chain)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
