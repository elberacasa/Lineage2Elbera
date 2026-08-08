#!/usr/bin/env python3
"""prop_census.py — how many prop placements never become a rendered object,
and why.

Two halves, because a prop can be lost in two different places:

  --maps    the SOURCE side: every actor in the retail .unr that places a
            StaticMesh, against what scene.json actually shipped.  This is
            where the losses were: convert.py's actor-header scan dropped
            5,593 StaticMeshActor placements world-wide (including
            Giran_V_Plaza_Stair01, the Giran plaza staircase) and two whole
            actor classes, Mover (553) and MovableStaticMeshActor (649),
            were never read at all.  Both fixed 2026-08-08; this mode is
            the gate that keeps them fixed.

  (default) the CLIENT side: which shipped packages could never draw.

The client's prop path (editor/world/js/terrain.js `_loadProps` ->
`_loadPropsInstanced`) turns each scene.json placement into InstancedMesh
instances.  A placement drops out silently at four different points, and
three of those points swallow the error:

  1. `_loadProps` filters `p.gltf` — a placement whose scene.json entry has
     `"gltf": null` is skipped without a word.
  2. `loadTemplate` fetches `<tile>/<gltf>`.  A 404 on the .gltf, on its
     .bin, or on ANY of its texture images rejects the GLTFLoader promise
     (GLTFLoader resolves the whole dependency graph before it resolves the
     scene), and `_loadPropsInstanced` catches that with a bare
     `console.warn`.
  3. The template may parse and still contain no drawable primitive: a
     primitive whose POSITION accessor count is 0, or whose index accessor
     count is 0, produces a BufferGeometry that renders nothing.
  4. A node in the glTF scene graph may carry no mesh at all.

This walks the packages on disk and reports, per tile and per reason, how
many placements survive to something drawable.  It never opens a browser —
everything it checks is a static property of the package, so it is the
cheap half of the measurement; editor/world/verify_props.js is the live
half that confirms the prediction against the real client.

Usage:
  python3 tools/world/prop_census.py                 # all tiles, summary
  python3 tools/world/prop_census.py 22_22 --detail  # one tile, per-mesh
  python3 tools/world/prop_census.py --json out.json
  python3 tools/world/prop_census.py --check         # exit 1 if any
                                                     # placement is undrawable
  python3 tools/world/prop_census.py --maps          # .unr vs scene.json
  python3 tools/world/prop_census.py --maps --check  # exit 1 if a retail
                                                     # placement was dropped

The live half — do the shipped placements actually become InstancedMesh
instances in the running client — is editor/world/verify_props.js.
"""

import argparse
import json
import os
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
WORLD = os.path.join(ROOT, "assets", "world")

# reasons, in the order the client hits them
R_OK = "ok"
R_NULL = "gltf_null"            # scene.json placement has no gltf at all
R_GLTF_404 = "gltf_missing"     # .gltf file not on disk
R_GLTF_BAD = "gltf_unparsable"  # .gltf is not valid JSON
R_BIN_404 = "bin_missing"       # buffer uri not on disk
R_TEX_404 = "texture_missing"   # an image uri is not on disk
R_NO_MESH = "no_mesh_node"      # scene graph references no mesh
R_EMPTY = "empty_geometry"      # every primitive has 0 verts or 0 indices

ORDER = [R_OK, R_NULL, R_GLTF_404, R_GLTF_BAD, R_BIN_404, R_TEX_404,
         R_NO_MESH, R_EMPTY]


def _prim_drawable(g, prim):
    """A primitive draws triangles only if it has vertices AND (when
    indexed) indices.  Both are accessor `count` fields."""
    accs = g.get("accessors", [])
    pos = prim.get("attributes", {}).get("POSITION")
    if pos is None or pos >= len(accs):
        return False
    if (accs[pos].get("count") or 0) <= 0:
        return False
    idx = prim.get("indices")
    if idx is not None:
        if idx >= len(accs) or (accs[idx].get("count") or 0) <= 0:
            return False
    return True


def analyze_gltf(path):
    """-> (reason, info dict).  info carries per-primitive detail so
    --detail can show exactly which section of a mesh vanished."""
    if not os.path.isfile(path):
        return R_GLTF_404, {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            g = json.load(fh)
    except (OSError, ValueError) as e:
        return R_GLTF_BAD, {"error": str(e)}

    d = os.path.dirname(path)
    for b in g.get("buffers", []):
        uri = b.get("uri")
        if uri and not os.path.isfile(os.path.join(d, uri)):
            return R_BIN_404, {"missing": uri}
    for im in g.get("images", []):
        uri = im.get("uri")
        if uri and not os.path.isfile(os.path.join(d, uri)):
            return R_TEX_404, {"missing": uri}

    nodes = g.get("nodes", [])
    scenes = g.get("scenes", [])
    scene_i = g.get("scene", 0)
    roots = scenes[scene_i].get("nodes", []) if scene_i < len(scenes) else []
    seen, stack, mesh_ids = set(), list(roots), []
    while stack:
        ni = stack.pop()
        if ni in seen or ni >= len(nodes):
            continue
        seen.add(ni)
        n = nodes[ni]
        if "mesh" in n:
            mesh_ids.append(n["mesh"])
        stack.extend(n.get("children", []))
    if not mesh_ids:
        return R_NO_MESH, {}

    meshes = g.get("meshes", [])
    prims, drawable = 0, 0
    dead = []
    for mi in mesh_ids:
        if mi >= len(meshes):
            continue
        for k, p in enumerate(meshes[mi].get("primitives", [])):
            prims += 1
            if _prim_drawable(g, p):
                drawable += 1
            else:
                mat = p.get("material")
                name = (g.get("materials", [])[mat].get("name")
                        if mat is not None and mat < len(g.get("materials", []))
                        else "?")
                dead.append({"prim": k, "material": name})
    info = {"primitives": prims, "drawable": drawable, "dead": dead}
    if drawable == 0:
        return R_EMPTY, info
    return R_OK, info


def census(tiles, detail=False):
    out = {"tiles": {}, "totals": Counter(), "dead_prims": 0,
           "dead_prim_placements": 0}
    mesh_cache = {}
    per_mesh = defaultdict(lambda: {"placements": 0, "reason": None,
                                    "info": None, "tiles": set()})
    for tile in tiles:
        tdir = os.path.join(WORLD, tile)
        sj = os.path.join(tdir, "scene.json")
        if not os.path.isfile(sj):
            continue
        with open(sj, "r", encoding="utf-8") as fh:
            def_ = json.load(fh)
        counts = Counter()
        for p in def_.get("props", []):
            rel = p.get("gltf")
            if not rel:
                counts[R_NULL] += 1
                per_mesh[p.get("mesh") or "?"]["placements"] += 1
                per_mesh[p.get("mesh") or "?"]["reason"] = R_NULL
                per_mesh[p.get("mesh") or "?"]["tiles"].add(tile)
                continue
            key = (tile, rel)
            if key not in mesh_cache:
                mesh_cache[key] = analyze_gltf(os.path.join(tdir, rel))
            reason, info = mesh_cache[key]
            counts[reason] += 1
            m = per_mesh[p.get("mesh") or rel]
            m["placements"] += 1
            m["reason"] = reason
            m["info"] = info
            m["tiles"].add(tile)
            if reason == R_OK and info.get("dead"):
                out["dead_prim_placements"] += 1
        out["tiles"][tile] = dict(counts)
        out["totals"].update(counts)
    out["per_mesh"] = per_mesh
    return out


# ---------------------------------------------------------------------------
# --maps: the retail .unr against what scene.json shipped
# ---------------------------------------------------------------------------

MAPS = os.path.join(ROOT, "assets", "interlude", "maps")


def map_census(tiles):
    """For each tile: how many actors in the .unr place a StaticMesh, and
    how many of those are in scene.json.

    Uses convert.py's OWN readers, so it measures the converter that is
    installed rather than a re-implementation of it; a regression in
    find_prop_start shows up here as `dropped`."""
    sys.path.insert(0, HERE)
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import convert as C          # noqa: E402  (path set above)

    out = {}
    for tile in tiles:
        unr = os.path.join(MAPS, tile + ".unr")
        sj = os.path.join(WORLD, tile, "scene.json")
        if not (os.path.isfile(unr) and os.path.isfile(sj)):
            continue
        pkg, _ = C.load_package(unr)
        exports = Counter(pkg.class_name_of(e) for e in pkg.exports
                          if pkg.class_name_of(e)
                          in C.STATIC_MESH_ACTOR_CLASSES)
        actors = C.read_static_mesh_actors(pkg)
        with open(sj, "r", encoding="utf-8") as fh:
            shipped = json.load(fh)["props"]
        # match on (mesh name, position), not just the count — a converter
        # that swapped one placement for another would keep the count
        want = Counter(("%s.%s" % (a["mesh"]["package"], a["mesh"]["name"]),
                        tuple(a["location"])) for a in actors)
        got = Counter((p["mesh"], tuple(p["position"])) for p in shipped)
        missing = sum((want - got).values())
        extra = sum((got - want).values())
        out[tile] = {
            "exports": dict(exports),
            "exports_total": sum(exports.values()),
            "actors": len(actors),
            "shipped": len(shipped),
            "shipped_gltf": sum(1 for p in shipped if p.get("gltf")),
            "dropped": missing,
            "extra": extra,
        }
    return out


def run_maps(tiles, as_json, check):
    r = map_census(tiles)
    tot = Counter()
    cls = Counter()
    for v in r.values():
        tot["exports"] += v["exports_total"]
        tot["actors"] += v["actors"]
        tot["shipped"] += v["shipped"]
        tot["shipped_gltf"] += v["shipped_gltf"]
        cls.update(v["exports"])
    print(f"tiles: {len(r)}")
    print(f"  static-mesh actor exports in the .unr : {tot['exports']:7d}")
    for k, v in cls.most_common():
        print(f"      {k:24s} {v:7d}")
    print(f"  actors the converter reads            : {tot['actors']:7d}")
    print(f"  placements in scene.json              : {tot['shipped']:7d}")
    print(f"  ... with a converted gltf             : {tot['shipped_gltf']:7d}")
    stale = sorted((v["dropped"] + v["extra"], t) for t, v in r.items()
                   if v["dropped"] or v["extra"])
    if stale:
        print("\ntiles whose scene.json does not match the converter "
              "(reconvert them):  [mesh+position mismatch]")
        for n, t in stale[:20]:
            print(f"  {t}  -{r[t]['dropped']} +{r[t]['extra']}")
    if as_json:
        with open(as_json, "w", encoding="utf-8") as fh:
            json.dump(r, fh, indent=1)
        print(f"\nwrote {as_json}")
    if check:
        if stale:
            print(f"\nFAIL: {len(stale)} tile(s) ship a different placement "
                  f"set than the converter reads")
            return 1
        print("\nPASS: every actor the converter reads is in scene.json")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tiles", nargs="*")
    ap.add_argument("--maps", action="store_true",
                    help="compare the retail .unr actors against scene.json")
    ap.add_argument("--detail", action="store_true",
                    help="list every mesh that loses placements or sections")
    ap.add_argument("--json", metavar="PATH")
    ap.add_argument("--check", action="store_true",
                    help="exit 1 when any placement can never draw")
    a = ap.parse_args()

    tiles = a.tiles or sorted(d for d in os.listdir(WORLD)
                              if os.path.isdir(os.path.join(WORLD, d))
                              and os.path.isfile(os.path.join(WORLD, d,
                                                              "scene.json")))
    if a.maps:
        return run_maps(tiles, a.json, a.check)

    r = census(tiles, a.detail)
    t = r["totals"]
    total = sum(t.values())
    bad = total - t[R_OK]

    print(f"tiles: {len(r['tiles'])}   placements: {total}")
    for k in ORDER:
        if t[k]:
            print(f"  {k:16s} {t[k]:7d}  {100.0*t[k]/max(total,1):5.2f}%")
    # NOT a defect: a UE2 static mesh routinely carries a material section
    # with zero triangles, and umodel's own raw export shows the same empty
    # section (checked on Giran_V_Plaza_Elevation: umodel writes prim 0 with
    # a 0-count POSITION accessor before convert.py ever touches it). The
    # count is printed so a real regression here would be visible.
    print(f"  placements whose mesh has >=1 empty retail section: "
          f"{r['dead_prim_placements']:7d}")

    worst = sorted(((sum(v for k, v in c.items() if k != R_OK), tile)
                    for tile, c in r["tiles"].items()), reverse=True)
    print("\nworst tiles (undrawable placements):")
    for n, tile in worst[:12]:
        if not n:
            break
        c = r["tiles"][tile]
        why = ", ".join(f"{k}={v}" for k, v in sorted(c.items()) if k != R_OK)
        print(f"  {tile}  {n:5d} / {sum(c.values()):5d}   {why}")

    if a.detail:
        print("\nper mesh:")
        rows = sorted(r["per_mesh"].items(),
                      key=lambda kv: -kv[1]["placements"])
        for name, m in rows:
            info = m["info"] or {}
            if m["reason"] == R_OK and not info.get("dead"):
                continue
            dead = ", ".join(f"prim{d['prim']}:{d['material']}"
                             for d in info.get("dead", []))
            print(f"  {m['placements']:5d}x {name}  [{m['reason']}] "
                  f"{info.get('drawable','-')}/{info.get('primitives','-')} "
                  f"drawable {('dead: ' + dead) if dead else ''}")

    if a.json:
        ser = {"tiles": r["tiles"], "totals": dict(t),
               "dead_prim_placements": r["dead_prim_placements"],
               "per_mesh": {k: {**v, "tiles": sorted(v["tiles"])}
                            for k, v in r["per_mesh"].items()}}
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(ser, fh, indent=1)
        print(f"\nwrote {a.json}")

    if a.check:
        if bad:
            print(f"\nFAIL: {bad} placements can never draw")
            return 1
        print("\nPASS: every placement resolves to a drawable primitive")
    return 0


if __name__ == "__main__":
    sys.exit(main())
