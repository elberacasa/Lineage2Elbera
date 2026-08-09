#!/usr/bin/env python3
"""Probe: the retail sky, all the way down to the pixel that makes the gradient.

`tools/audit/probe_sky.py` settled ONE number: the ColorModifier named
`SkybackgroundColor` in `L2_Skies` decodes to `#0096CE`, and because it tints
`WhiteChip` -- 32x32 of solid white -- that colour IS the rendered colour.
That probe then observed, correctly, that "the retail sky is not a gradient",
meaning the background is a single flat colour rather than a two-stop ramp.

That observation is true and this probe reproduces it.  But it left a real
question open, and answering it is the point of this file: **the background is
flat, yet the sky the player sees is not**, because the same skybox level
paints a SECOND, nearer surface over the bottom of it.

What this reads, and from where:

  assets/interlude/maps/skylevel.unr   (protocol 111, l2encdec)
      The built world BSP (`Model29`).  Every one of its 55 nodes is
      PF_UNLIT, so nothing here is lit, shaded or vertex-coloured: what the
      material says is exactly what is drawn.  The nodes group into

        * an upper box  (4 walls + ceiling) painted `SkybackgroundColor`,
          spanning z 24534..24932 -- i.e. from the eye UP;
        * a lower box   (4 walls + floor)   painted `HazeRing_Final`,
          spanning z 24338..24534 -- from the eye DOWN;
        * a 16-sided cylinder around the eye painted `HazeRing_Final`,
          z 24535..24547, radius 22..30 -- a band sitting on the horizon;
        * one horizontal `Cloud_Final` sheet at z 24548 and two
          `StarField_Final` sheets at z 24560/24561.

      The eye is `SkyZoneInfo0.Location` = (324.20, 264435.16, 24535.02):
      UE2 renders a fake-backdrop zone from the SkyZoneInfo actor's location,
      so every angle below is measured from that point.

  assets/interlude/textures/l2_skies.utx  (protocol 121)
      `HazeRing_Final` is a ColorModifier (#FFE495) over the Shader
      `HazeRing`, whose Diffuse AND Opacity are both the texture `WhiteRing`.
      `WhiteRing` decodes to 512x128 whose RGB is the constant (255,251,255)
      and whose ALPHA is a monotone vertical ramp, 0 at the top row to 255 at
      the bottom.  That alpha ramp, sampled over the v-range the BSP gives the
      cylinder, is the gradient.

So the sky decomposes into two sourced layers and no invented ones:

    background   flat  #0096CE                       everywhere above the eye
    haze band    (WhiteRing.rgb * #FFE495) with the WhiteRing alpha ramp,
                 from elevation 0 up to the top of the cylinder

Read-only.  Writes nothing.

  python3 tools/audit/probe_skydome.py
  python3 tools/audit/probe_skydome.py --json
  python3 tools/audit/probe_skydome.py --check
"""

import argparse
import collections
import json
import math
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "tools"))

from l2lib import ue2package as U            # noqa: E402
from l2lib import extract_texture_rgba       # noqa: E402

SKIES = os.path.join(REPO, "assets/interlude/textures/l2_skies.utx")
SKYLEVEL = os.path.join(REPO, "assets/interlude/maps/skylevel.unr")

PF_UNLIT = 0x00400000


# ---------------------------------------------------------------- materials

def read_props(pkg, name):
    e = pkg.find_export(name)
    if e is None:
        raise SystemExit("no export %r in %s" % (name, pkg.path))
    return e, U.read_properties(pkg, pkg.body_reader(e), fmt="packed")


def color_of(props):
    """FColor is 4 bytes B,G,R,A -- the byte order docs/ui-mined-native.md
    established for the NWindow.dll chat dwords, and the one under which the
    sky reads as blue and the haze as warm rather than the reverse."""
    raw = props.get("Color")
    if raw is None:
        return None
    b, g, r, a = raw[0], raw[1], raw[2], raw[3]
    return (r, g, b, a)


def ref(pkg, raw):
    """A packed object-property payload -> the export it names, or None."""
    if raw is None:
        return None
    ci = U.Reader(bytes(raw)).compact()
    try:
        obj = pkg.resolve_ref(ci)
    except Exception:
        return None
    return obj if isinstance(obj, U.Export) else None


def materials():
    pkg, proto = U.load_package(SKIES)
    out = {"package": os.path.basename(SKIES), "protocol": proto}

    _, bg = read_props(pkg, "SkybackgroundColor")
    bgm = ref(pkg, bg.get("Material"))
    out["background"] = {
        "modifier": "SkybackgroundColor",
        "rgba": color_of(bg),
        "material": pkg.export_name(bgm) if bgm else None,
        "material_class": pkg.class_name_of(bgm) if bgm else None,
    }
    # WhiteChip is the whole reason the background needs no further decoding.
    chip = pkg.find_export("WhiteChip")
    w, h, rgba, _info = extract_texture_rgba(pkg, chip)
    uniq = set(bytes(rgba[i:i + 3]) for i in range(0, len(rgba), 4))
    out["background"]["chip"] = {"w": w, "h": h,
                                 "distinct_rgb": len(uniq),
                                 "rgb": list(next(iter(uniq)))}

    _, hz = read_props(pkg, "HazeRing_Final")
    shader = ref(pkg, hz.get("Material"))
    _, sh = read_props(pkg, pkg.export_name(shader))
    diffuse = ref(pkg, sh.get("Diffuse"))
    opacity = ref(pkg, sh.get("Opacity"))
    out["haze"] = {
        "modifier": "HazeRing_Final",
        "rgba": color_of(hz),
        "shader": pkg.export_name(shader),
        "diffuse": pkg.export_name(diffuse) if diffuse else None,
        "opacity": pkg.export_name(opacity) if opacity else None,
        "output_blending": sh.get("OutputBlending"),
    }

    w, h, rgba, _info = extract_texture_rgba(pkg, diffuse)
    # RGB constancy: if the diffuse is one colour, the rendered haze colour is
    # exactly rgb * modifier and there is no residual unknown in it either.
    rgbs = set(bytes(rgba[i:i + 3]) for i in range(0, len(rgba), 4))
    # the alpha ramp, column-independent: take the per-row min/max so a claim
    # of "vertical only" is checkable rather than assumed
    rows = []
    for y in range(h):
        a = rgba[(y * w) * 4 + 3::4][:w]
        rows.append((min(a), max(a), sum(a) // len(a)))
    out["haze"]["texture"] = {
        "name": pkg.export_name(diffuse), "w": w, "h": h,
        "distinct_rgb": len(rgbs),
        "rgb": list(next(iter(rgbs))) if len(rgbs) == 1 else None,
        "alpha_row_spread": max(hi - lo for lo, hi, _ in rows),
        "alpha": [avg for _lo, _hi, avg in rows],
        "monotone_down": all(rows[i][2] <= rows[i + 1][2] for i in range(h - 1)),
    }
    return out


# ----------------------------------------------------------------- geometry

def sky_zone_location(pkg):
    """SkyZoneInfo0.Location -- UE2 renders a fake backdrop from here.

    Actor bodies in a .unr carry a TAGGED property list (unlike the packed
    material bodies above), so this borrows tools/maps/unrmap's reader.  Its
    own find_prop_offset() only catches two exception types and l2lib raises a
    third on a mis-aligned guess, so the offset scan is repeated here with a
    wider net rather than patching a file this pass does not own."""
    sys.path.insert(0, os.path.join(REPO, "tools/utx"))
    sys.path.insert(0, os.path.join(REPO, "tools/maps"))
    import unrmap                                     # noqa: E402
    for e in pkg.exports:
        if pkg.class_name_of(e) != "SkyZoneInfo":
            continue
        for start in range(0, 25):
            try:
                props, rel = unrmap.read_props(pkg, e, start)
            except Exception:
                continue
            if not props or rel > e.serial_size:
                continue
            for p in props:
                if p["name"] == "Location" and p["struct"] == "Vector":
                    return pkg.export_name(e), p["value"]
    return None, None


def skybox():
    pkg, proto = U.load_package(SKYLEVEL)
    model = U.level_model(pkg)
    zone, eye = sky_zone_location(pkg)
    if eye is None:
        raise SystemExit("skylevel.unr: no SkyZoneInfo Location")

    def matname(ci):
        if ci == 0:
            return "None"
        obj = pkg.resolve_ref(ci)
        return (pkg.export_name(obj) if isinstance(obj, U.Export)
                else pkg.name(obj.object_name))

    groups = collections.defaultdict(lambda: {
        "nodes": 0, "surfs": set(), "flags": set(),
        "z": [float("inf"), float("-inf")], "verts": []})
    for node in model.nodes:
        surf = model.surfs[node.i_surf]
        pts = [model.points[model.verts[node.i_vert_pool + k][0]]
               for k in range(node.num_vertices)]
        # split the two HazeRing uses apart the way the BSP itself does: the
        # boxes are single-node walls, the band is a 16-gon of small ones
        name = matname(surf.material)
        if name == "HazeRing_Final":
            name += "/band" if min(p[2] for p in pts) >= eye[2] - 1 else "/lowerbox"
        g = groups[name]
        g["nodes"] += 1
        g["surfs"].add(node.i_surf)
        g["flags"].add(surf.flags)
        g["z"][0] = min(g["z"][0], min(p[2] for p in pts))
        g["z"][1] = max(g["z"][1], max(p[2] for p in pts))
        for k in range(node.num_vertices):
            p = model.points[model.verts[node.i_vert_pool + k][0]]
            base = model.points[surf.p_base]
            tv = model.vectors[surf.v_texture_v]
            d = (p[0] - base[0], p[1] - base[1], p[2] - base[2])
            g["verts"].append({
                "surf": node.i_surf,
                "z": p[2],
                "dz": p[2] - eye[2],
                "r": math.hypot(p[0] - eye[0], p[1] - eye[1]),
                "vraw": d[0] * tv[0] + d[1] * tv[1] + d[2] * tv[2],
            })

    out = {"map": os.path.basename(SKYLEVEL), "protocol": proto,
           "model": pkg.export_name(model.export), "nodes": len(model.nodes),
           "zone": zone, "eye": list(eye), "layers": {}}
    for name, g in groups.items():
        out["layers"][name] = {
            "nodes": g["nodes"], "surfs": sorted(g["surfs"]),
            "flags": sorted(hex(f) for f in g["flags"]),
            "all_unlit": all(f & PF_UNLIT for f in g["flags"]),
            "z": [round(g["z"][0], 2), round(g["z"][1], 2)],
        }
    out["_band_verts"] = groups["HazeRing_Final/band"]["verts"]
    return out


def band_mapping(sky, tex_h):
    """The cylinder's vertices -> the elevation/v pairs the shader needs.

    The band's walls are vertical, so every vertex sits on one of two rings:
    the bottom (on the eye plane) and the top.  For each, this reports the
    elevation from the eye and the texture v -- and it reports the SPREAD, not
    just a mean, because the retail cylinder is not centred on the eye and its
    radius genuinely varies with azimuth.
    """
    allv = sky["_band_verts"]
    lo = min(v["dz"] for v in allv)
    hi = max(v["dz"] for v in allv)
    # A wall surface is one that reaches BOTH heights; the cylinder also has
    # two flat caps on the eye plane, and those carry a different (and
    # irrelevant) v projection, so they are excluded structurally rather than
    # by a radius threshold.
    spans = collections.defaultdict(set)
    for v in allv:
        spans[v["surf"]].add(round(v["dz"], 1))
    walls = [v for v in allv
             if round(lo, 1) in spans[v["surf"]] and round(hi, 1) in spans[v["surf"]]]
    bottom = [v for v in walls if abs(v["dz"] - lo) < 0.5]
    top = [v for v in walls if abs(v["dz"] - hi) < 0.5]

    def ring(vs, label):
        rs = [v["r"] for v in vs]
        vv = [(v["vraw"] / tex_h) % 1.0 for v in vs]
        els = [math.degrees(math.atan2(v["dz"], v["r"])) for v in vs]
        return {
            "label": label,
            "dz": round(sum(v["dz"] for v in vs) / len(vs), 3),
            "radius": [round(min(rs), 2), round(max(rs), 2),
                       round(sum(rs) / len(rs), 2)],
            "v": [round(min(vv), 5), round(max(vv), 5)],
            "elev_deg": [round(min(els), 2), round(max(els), 2),
                         round(sum(els) / len(els), 2)],
        }
    return {"bottom": ring(bottom, "bottom"), "top": ring(top, "top")}


# --------------------------------------------------------------------- main

def build():
    mats = materials()
    sky = skybox()
    tex_h = mats["haze"]["texture"]["h"]
    band = band_mapping(sky, tex_h)
    sky.pop("_band_verts", None)

    hz = mats["haze"]["rgba"]
    trgb = mats["haze"]["texture"]["rgb"]
    haze_rgb = [round(hz[i] * trgb[i] / 255.0) for i in range(3)] if trgb else None
    bg = mats["background"]["rgba"]
    chip = mats["background"]["chip"]["rgb"]
    bg_rgb = [round(bg[i] * chip[i] / 255.0) for i in range(3)]

    return {
        "materials": mats,
        "skybox": sky,
        "band": band,
        "rendered": {
            # background = modifier x WhiteChip(white) = the modifier
            "background_hex": "#%02X%02X%02X" % tuple(bg_rgb),
            # haze = modifier x WhiteRing.rgb; alpha comes from the ramp
            "haze_hex": "#%02X%02X%02X" % tuple(haze_rgb),
            "haze_alpha_ramp": mats["haze"]["texture"]["alpha"],
            # what a shader needs: v at elevation 0 and v at the band top,
            # plus the height/radius that turn an elevation into a height
            "band_v_bottom": band["bottom"]["v"][0],
            "band_v_top": band["top"]["v"][0],
            "band_height": round(band["top"]["dz"] - band["bottom"]["dz"], 3),
            "band_radius_mean": band["bottom"]["radius"][2],
            "band_top_elev_deg": band["top"]["elev_deg"],
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    for p in (SKIES, SKYLEVEL):
        if not os.path.exists(p):
            print("missing %s" % p, file=sys.stderr)
            return 2

    d = build()
    if args.json:
        print(json.dumps(d, indent=1, sort_keys=True))
        return 0

    m, s, b, r = d["materials"], d["skybox"], d["band"], d["rendered"]
    print("== %s (protocol %s), model %s, %d nodes =="
          % (s["map"], s["protocol"], s["model"], s["nodes"]))
    print("   eye = %s.Location = (%.2f, %.2f, %.2f)"
          % (s["zone"], *s["eye"]))
    for name in sorted(s["layers"]):
        L = s["layers"][name]
        print("   %-28s nodes=%3d  z=[%.0f..%.0f]  flags=%s  unlit=%s"
              % (name, L["nodes"], L["z"][0], L["z"][1],
                 ",".join(L["flags"]), L["all_unlit"]))

    print("\n== %s (protocol %s) ==" % (m["package"], m["protocol"]))
    bgc = m["background"]
    print("   SkybackgroundColor  rgba=%s over %s (%s), %dx%d, %d distinct rgb %s"
          % (bgc["rgba"], bgc["material"], bgc["material_class"],
             bgc["chip"]["w"], bgc["chip"]["h"], bgc["chip"]["distinct_rgb"],
             bgc["chip"]["rgb"]))
    h = m["haze"]
    t = h["texture"]
    print("   HazeRing_Final      rgba=%s over Shader %s "
          "(Diffuse=%s, Opacity=%s)" % (h["rgba"], h["shader"],
                                        h["diffuse"], h["opacity"]))
    print("   %-18s  %dx%d, %d distinct rgb %s, alpha row spread %d, "
          "monotone top->bottom %s"
          % (t["name"], t["w"], t["h"], t["distinct_rgb"], t["rgb"],
             t["alpha_row_spread"], t["monotone_down"]))

    print("\n== the band, from the BSP ==")
    for k in ("bottom", "top"):
        g = b[k]
        print("   %-6s dz=%+7.2f  radius %.1f..%.1f (mean %.1f)  "
              "v=%.5f..%.5f  elevation %.2f..%.2f deg (mean %.2f)"
              % (k, g["dz"], g["radius"][0], g["radius"][1], g["radius"][2],
                 g["v"][0], g["v"][1], g["elev_deg"][0], g["elev_deg"][1],
                 g["elev_deg"][2]))

    print("\n== what renders ==")
    print("   background      %s   flat, above the horizon" % r["background_hex"])
    print("   haze band       %s   alpha = WhiteRing ramp, v %.4f (horizon) "
          "-> %.4f (top)" % (r["haze_hex"], r["band_v_bottom"], r["band_v_top"]))
    print("   band geometry   height %.2f over mean radius %.2f  ->  top at "
          "%.2f deg" % (r["band_height"], r["band_radius_mean"],
                        math.degrees(math.atan2(r["band_height"],
                                                r["band_radius_mean"]))))
    print("   alpha at v=%.4f = %d   alpha at v=%.4f = %d"
          % (r["band_v_bottom"],
             r["haze_alpha_ramp"][int(r["band_v_bottom"] * t["h"])],
             r["band_v_top"],
             r["haze_alpha_ramp"][int(r["band_v_top"] * t["h"])]))

    if args.check:
        fails = []
        if r["background_hex"] != "#0096CE":
            fails.append("background %s != #0096CE" % r["background_hex"])
        if bgc["chip"]["distinct_rgb"] != 1 or bgc["chip"]["rgb"] != [255, 255, 255]:
            fails.append("WhiteChip is no longer flat white")
        if not s["layers"]["SkybackgroundColor"]["all_unlit"]:
            fails.append("the background box is no longer PF_UNLIT")
        if not all(L["all_unlit"] for L in s["layers"].values()):
            fails.append("some skybox surface is lit, so material != rendered")
        if t["distinct_rgb"] != 1:
            fails.append("WhiteRing rgb is no longer constant (%d colours)"
                         % t["distinct_rgb"])
        if not t["monotone_down"]:
            fails.append("WhiteRing alpha is no longer a monotone ramp")
        if t["alpha_row_spread"] > 4:
            fails.append("WhiteRing alpha varies across a row by %d -- it is "
                         "not a purely vertical ramp" % t["alpha_row_spread"])
        # the band must start opaque at the horizon and end transparent
        a0 = r["haze_alpha_ramp"][int(r["band_v_bottom"] * t["h"])]
        a1 = r["haze_alpha_ramp"][int(r["band_v_top"] * t["h"])]
        if a0 < 250:
            fails.append("band is not opaque at the horizon (alpha %d)" % a0)
        if a1 > 5:
            fails.append("band is not transparent at its top (alpha %d)" % a1)
        # and there must be no SECOND background colour anywhere -- the whole
        # point of the decision this probe supports
        if len(s["layers"]["SkybackgroundColor"]["surfs"]) != 5:
            fails.append("the background is no longer 5 surfaces (4 walls + "
                         "ceiling): %s"
                         % s["layers"]["SkybackgroundColor"]["surfs"])
        if fails:
            print("\n--check FAIL:")
            for f in fails:
                print("   " + f, file=sys.stderr)
            return 1
        print("\n--check OK: flat #0096CE background + a WhiteRing-alpha haze "
              "band, both PF_UNLIT")
    return 0


if __name__ == "__main__":
    sys.exit(main())
