#!/usr/bin/env python3
"""Build assets/gamedata/skillmesh.{json,bin} -- the geometry a MeshEmitter draws.

WHY THIS EXISTS
---------------
1232 of the 3709 emitters in LineageEffect.u are MeshEmitters, and 413 of those
sit on effect classes real skills bind. Until now the browser dropped every one
of them ("no .pskx loader in the client"), which is why Wind Strike showed its
sprite trail and not its bolt: `windknifewave00` / `windknifeball00` are meshes.

`build_skillfx.py` already exports the referenced StaticMeshes with umodel into
`assets/library/<Package>/StaticMesh/<name>.pskx`. This tool turns those into
something a browser can draw without shipping 108 glTF files or a multi-MB JSON:

  assets/gamedata/skillmesh.json   ~30 KB index: one interned texture table,
                                   one mesh record per name (vertex/index ranges
                                   + material submesh ranges)
  assets/gamedata/skillmesh.bin    one binary blob: [positions f32x3]
                                   [uvs f32x2] [indices u16]

Same interning discipline as tools/audio/build_audio.py: every repeated string
(texture path) lives once in a table and records hold indices.

WHAT A MeshEmitter ACTUALLY SPECIFIES  (Engine.u, tools/dat/dump_emitter_classes.py)
-----------------------------------------------------------------------------
    class MeshEmitter extends ParticleEmitter native;
        var (Mesh) staticmesh StaticMesh;
        var (Mesh) bool UseMeshBlendMode;    // class default TRUE
        var (Mesh) bool RenderTwoSided;      // zero value -> FALSE
        var (Mesh) bool UseParticleColor;    // zero value -> FALSE
        var transient vector MeshExtent;

Four authored fields, nothing else: every other knob (lifetime, size, spin,
velocity, colour, fade, spawn mode) is inherited ParticleEmitter and means
exactly what it means for a SpriteEmitter. The one field whose meaning CHANGES
is StartSizeRange, and Engine.u settles it outright: ParticleEmitter defaults it
to 100 (UU -- a 1 m sprite quad) and MeshEmitter OVERRIDES it to 1.0. It is a
per-axis SCALE on the static mesh. Cross-checked against geometry: mesh bbox x
StartSize over the 391 bound mesh emitters with a staged mesh gives a median
extent of 51 UU and a 90th percentile of 205 UU -- i.e. half a metre to two
metres, the right size for a skill effect on a ~50 UU character. Read as world
units instead, the same numbers give a median 0.26 UU = 2.6 mm.

GEOMETRY BASIS
--------------
umodel's psk exporter MIRRORS on Y (ExportPsk.cpp MIRROR_MESH), so a psk point
(px, py, pz) is UE (px, -py, pz). The client is in the proper (x, z, -y) basis
(coords.js), so the emitted position is (px, pz, py) * 0.01 -- identical to the
character pipeline's `_xf_pos` composed with that mirror -- and the wedge triple
is reversed to (w0, w2, w1) for the winding, exactly as
tools/src/char_pipeline/assemble.py:_face_indices does and for the same reason.

Usage:
  /usr/bin/python3 tools/dat/build_skillmesh.py           # write the index
  /usr/bin/python3 tools/dat/build_skillmesh.py --check   # verify, exit 1 on drift
"""

import argparse
import json
import os
import struct
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "l2lib"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ue2package import load_package, read_properties  # noqa: E402
from parse_skillfx import decode_struct_array  # noqa: E402
import build_skillvfx as bv  # noqa: E402

GAMEDATA = os.path.join(ROOT, "assets", "gamedata")
LIBRARY = os.path.join(ROOT, "assets", "library")
UMODEL = os.path.join(ROOT, "tools", "bin", "umodel")
OUT_JSON = os.path.join(GAMEDATA, "skillmesh.json")
OUT_BIN = os.path.join(GAMEDATA, "skillmesh.bin")

# package -> the .usx that defines it (same map build_skillfx.py exports from)
MESH_PACKAGES = {
    "LineageEffectsStaticmeshes":
        "assets/interlude/staticmeshes/LineageEffectsStaticmeshes.usx",
    "FX_E_S": "assets/interlude/staticmeshes/FX_E_S.usx",
    "fx_m_s": "assets/interlude/staticmeshes/fx_m_s.usx",
}

UU = 0.01                      # UE units -> metres


# ------------------------------------------------------------- psk decoding

def psk_chunks(path):
    """ActorX .psk/.pskx -> {chunk id: (elem size, count, payload bytes)}."""
    with open(path, "rb") as fh:
        d = fh.read()
    out, off = {}, 0
    while off + 32 <= len(d):
        name = d[off:off + 20].split(b"\0")[0].decode("latin1")
        _flags, dsize, dcount = struct.unpack_from("<iii", d, off + 20)
        off += 32
        out[name] = (dsize, dcount, d[off:off + dsize * dcount])
        off += dsize * dcount
    return out


def decode_psk(path):
    """-> (positions[(x,y,z) three-space metres], uvs[(u,v)],
           faces[(w0,w1,w2,mat)], material slot names).

    PNTS0000 12B  float x,y,z             (psk space: UE with Y mirrored)
    VTXW0000 16B  u16 PointIndex, u16 pad, f32 U, f32 V, u8 MatIndex, ...
    FACE0000 12B  u16 WedgeIndex[3], u8 MatIndex, u8 AuxMatIndex, u32 Smooth
    MATT0000 88B  char[64] name, ...
    """
    c = psk_chunks(path)
    for need in ("PNTS0000", "VTXW0000", "FACE0000", "MATT0000"):
        if need not in c:
            raise ValueError("%s: no %s chunk" % (path, need))
    _s, npts, pdata = c["PNTS0000"]
    pts = [struct.unpack_from("<3f", pdata, i * 12) for i in range(npts)]
    _s, nw, wdata = c["VTXW0000"]
    wedges = []
    for i in range(nw):
        pi, _pad, u, v = struct.unpack_from("<HHff", wdata, i * 16)
        wedges.append((pi, u, v))
    _s, nf, fdata = c["FACE0000"]
    faces = []
    for i in range(nf):
        w0, w1, w2, mat = struct.unpack_from("<HHHB", fdata, i * 12)
        faces.append((w0, w1, w2, mat))
    _s, nm, mdata = c["MATT0000"]
    mats = [mdata[i * 88:i * 88 + 64].split(b"\0")[0].decode("latin1")
            for i in range(nm)]

    # psk (px, py, pz) == UE (px, -py, pz); three = (ue_x, ue_z, -ue_y) * 0.01
    # => three = (px, pz, py) * 0.01. See the module docstring.
    pos, uv = [], []
    for pi, u, v in wedges:
        px, py, pz = pts[pi]
        pos.append((px * UU, pz * UU, py * UU))
        uv.append((u, v))
    return pos, uv, faces, mats


# ------------------------------------------------------- material resolution

def usx_materials(package):
    """{StaticMesh name: [material ref 'Package.Object' or None]} for one .usx.

    The psk MATT chunk carries only the OBJECT name, so the owning package (and
    therefore the staged PNG) has to come from the .usx itself: the StaticMesh
    export's `Materials` property is an array of
    StaticMeshMaterial{Material, EnableCollision} whose Material is an object
    ref that l2lib resolves to Package.Object even when it is an import.
    """
    path = os.path.join(ROOT, MESH_PACKAGES[package])
    pkg, _ = load_package(path)
    out = {}
    for e in pkg.exports:
        if pkg.class_name_of(e) != "StaticMesh":
            continue
        raw = read_properties(pkg, pkg.body_reader(e), fmt="auto").get("Materials")
        arr = decode_struct_array(pkg, raw) if raw else []
        out[pkg.export_name(e)] = [m.get("Material") for m in arr]
    return out


def staged_pskx(package, name):
    """assets/library/<pkg>/StaticMesh/<name>.pskx if build_skillfx.py staged it."""
    d = os.path.join(LIBRARY, package, "StaticMesh")
    if not os.path.isdir(d):
        return None
    low = {f.lower(): f for f in os.listdir(d)}
    for ext in (".pskx", ".psk"):
        f = low.get((name + ext).lower())
        if f:
            return os.path.join(d, f)
    return None


def export_pskx(package, name):
    """Export one StaticMesh with umodel into assets/library/<pkg>/StaticMesh/."""
    usx = os.path.join(ROOT, MESH_PACKAGES[package])
    if not os.path.exists(usx) or not os.path.exists(UMODEL):
        return None
    with tempfile.TemporaryDirectory() as tmp:
        # -out MUST be absolute (relative resolves against $HOME) -- HANDOFF §5
        r = subprocess.run([UMODEL, "-export", "-psk", "-notex", "-game=l2",
                            "-path=" + os.path.dirname(usx), "-out=" + tmp,
                            os.path.basename(usx), name],
                           capture_output=True)
        if r.returncode != 0:
            return None
        for root, _d, files in os.walk(tmp):
            for f in files:
                if f.lower() in (name.lower() + ".psk", name.lower() + ".pskx"):
                    dest_dir = os.path.join(LIBRARY, package, "StaticMesh")
                    os.makedirs(dest_dir, exist_ok=True)
                    dest = os.path.join(dest_dir, f)
                    with open(os.path.join(root, f), "rb") as src, \
                            open(dest, "wb") as dst:
                        dst.write(src.read())
                    return dest
    return None


# ------------------------------------------------------------------- build

def mesh_refs():
    """Every StaticMesh a MeshEmitter on a BOUND effect class names.

    The bound-class set comes from build_skillvfx.build() so there is exactly
    one definition of "bound" in the pipeline, and no build-order dependency
    (build() is a pure function over the decoded tables).
    """
    index = bv.build(verbose=False)
    effects = bv.load("lineageeffect.json")
    refs, order = set(), []
    for cls in index["fxn"]:
        for em in effects.get(cls, {}).get("emitters", []):
            if em.get("type") != "MeshEmitter":
                continue
            ref = em.get("mesh")
            if ref and ref not in refs:
                refs.add(ref)
                order.append(ref)
    return sorted(order)


def build(verbose=True, allow_export=True):
    tex = bv.Interner()
    meshes, skipped = {}, {}
    pos_all, uv_all, idx_all = [], [], []
    usx_cache = {}

    for ref in mesh_refs():
        package, name = ref.split(".", 1)
        if package not in MESH_PACKAGES:
            skipped[ref] = "package %s is not an exportable .usx" % package
            continue
        path = staged_pskx(package, name)
        if path is None and allow_export:
            path = export_pskx(package, name)
        if path is None:
            skipped[ref] = "no .pskx staged and umodel export failed"
            continue
        pos, uv, faces, matt = decode_psk(path)
        if package not in usx_cache:
            usx_cache[package] = usx_materials(package)
        slots = usx_cache[package].get(name)
        if slots is None:
            skipped[ref] = "no StaticMesh export named %s in the .usx" % name
            continue
        # The psk MATT names must line up with the .usx Materials array or the
        # per-face MatIndex would select the wrong texture. Assert, never assume.
        for i, mn in enumerate(matt):
            ref_i = slots[i] if i < len(slots) else None
            if ref_i is None:
                # a genuinely null material slot; umodel names it "material_<n>"
                if mn != "material_%d" % i:
                    raise ValueError("%s slot %d: usx says null, psk says %s"
                                     % (ref, i, mn))
                continue
            if ref_i.split(".")[-1].lower() != mn.lower():
                raise ValueError("%s slot %d: psk says %s, usx says %s"
                                 % (ref, i, mn, ref_i))

        vbase = len(pos_all)
        pos_all.extend(pos)
        uv_all.extend(uv)
        # group faces by material slot so each submesh is one contiguous range
        subs = []
        for slot in range(max(len(matt), len(slots), 1)):
            group = [f for f in faces if f[3] == slot]
            if not group:
                continue
            start = len(idx_all)
            for w0, w1, w2, _m in group:
                # winding: umodel's psk mirror makes the net psk->three map
                # det -1, so the triple arrives clockwise. (w0, w2, w1) undoes
                # it -- the same correction assemble.py:_face_indices applies.
                idx_all.extend((w0, w2, w1))
            ti = tex(bv.resolve_texture(slots[slot] if slot < len(slots) else None))
            subs.append({"i0": start, "n": len(idx_all) - start,
                         **({"t": ti} if ti is not None else {})})
        meshes[name] = {"v0": vbase, "nv": len(pos), "s": subs}

    out = {"tex": tex.items,
           "texa": [1 if bv.png_has_alpha_channel(p) else 0 for p in tex.items],
           "mesh": meshes,
           "nv": len(pos_all), "ni": len(idx_all)}
    if skipped:
        out["skip"] = skipped

    blob = bytearray()
    for p in pos_all:
        blob += struct.pack("<3f", *p)
    for u in uv_all:
        blob += struct.pack("<2f", *u)
    for i in idx_all:
        blob += struct.pack("<H", i)
    while len(blob) % 4:
        blob.append(0)

    if verbose:
        print("skillmesh: %d meshes, %d vertices, %d triangles, %d textures, "
              "%d skipped, %.0f KB binary"
              % (len(meshes), len(pos_all), len(idx_all) // 3, len(tex.items),
                 len(skipped), len(blob) / 1024.0))
    return out, bytes(blob)


def verify_basis(index, blob, mesh="windknifeball00",
                 package="LineageEffectsStaticmeshes"):
    """Prove the emitted geometry against umodel's OWN glTF exporter.

    umodel's glTF path converts UE space as (x, y, z) -> (x, z, y) * 0.01,
    determinant -1 (ExportGLTF.cpp TransformPosition; docs/world-prop-basis.md).
    Ours is the proper (x, z, -y) * 0.01, determinant +1. The two therefore
    differ by exactly diag(1, 1, -1) and by nothing else -- so negating Z on
    umodel's own export must land on our vertices, and our triangles must carry
    the same ordered position triples. That is what this checks. It is the same
    style of proof audit_prop_basis.py uses for world props, and the same
    relationship build_weapons.py verified for the static character path.

    -> (message, ok). ok is None when umodel or the .usx is unavailable.
    """
    usx = os.path.join(ROOT, MESH_PACKAGES[package])
    if not (os.path.exists(UMODEL) and os.path.exists(usx)):
        return "umodel or %s unavailable" % os.path.basename(usx), None
    with tempfile.TemporaryDirectory() as tmp:
        r = subprocess.run([UMODEL, "-export", "-gltf", "-game=l2",
                            "-path=" + os.path.dirname(usx), "-out=" + tmp,
                            os.path.basename(usx), mesh], capture_output=True)
        if r.returncode != 0:
            return "umodel -gltf failed", None
        gltf = bin_ = None
        for root, _d, files in os.walk(tmp):
            for f in files:
                if f.lower() == mesh.lower() + ".gltf":
                    gltf = os.path.join(root, f)
                if f.lower() == mesh.lower() + ".bin":
                    bin_ = os.path.join(root, f)
        if not (gltf and bin_):
            return "umodel wrote no glTF for " + mesh, None
        with open(gltf) as fh:
            g = json.load(fh)
        with open(bin_, "rb") as fh:
            gbuf = fh.read()

        def read(ai, fmt, size):
            a = g["accessors"][ai]
            bvw = g["bufferViews"][a["bufferView"]]
            base = bvw.get("byteOffset", 0) + a.get("byteOffset", 0)
            stride = bvw.get("byteStride") or size
            return [struct.unpack_from(fmt, gbuf, base + k * stride)
                    for k in range(a["count"])]

        prim = g["meshes"][0]["primitives"][0]
        gpos = read(prim["attributes"]["POSITION"], "<3f", 12)
        ifmt, isz = {5123: ("<H", 2), 5125: ("<I", 4)}[
            g["accessors"][prim["indices"]]["componentType"]]
        gidx = [x[0] for x in read(prim["indices"], ifmt, isz)]

    rec = index["mesh"][mesh]
    nv = index["nv"]
    opos = [struct.unpack_from("<3f", blob, (rec["v0"] + k) * 12)
            for k in range(rec["nv"])]
    oidx = []
    for s in rec["s"]:
        oidx += [struct.unpack_from("<H", blob, nv * 12 + nv * 8 + (s["i0"] + k) * 2)[0]
                 for k in range(s["n"])]

    def rnd(v):
        return tuple(round(x, 4) for x in v)

    flip = lambda p: (p[0], p[1], -p[2])          # noqa: E731  det -1 -> det +1
    key = {rnd(flip(p)) for p in gpos}
    hits = sum(1 for p in opos if rnd(p) in key)

    def canon(t):
        i = t.index(min(t))
        return t[i:] + t[:i]

    gt = {canon(tuple(rnd(flip(gpos[gidx[k + j]])) for j in range(3)))
          for k in range(0, len(gidx), 3)}
    ot = [canon(tuple(rnd(opos[oidx[k + j]]) for j in range(3)))
          for k in range(0, len(oidx), 3)]
    same = sum(1 for t in ot if t in gt)
    rev = sum(1 for t in ot if canon((t[0], t[2], t[1])) in gt)
    ok = hits >= 0.95 * len(opos) and same >= 0.95 * len(ot) and rev == 0
    return ("%s: %d/%d vertices are negate-Z of umodel's own glTF, "
            "%d/%d triangles match with the same winding (%d reversed)"
            % (mesh, hits, len(opos), same, len(ot), rev)), ok


def check():
    if not (os.path.exists(OUT_JSON) and os.path.exists(OUT_BIN)):
        print("CHECK FAIL: skillmesh.json/.bin missing -- run the build")
        return 1
    fresh, blob = build(verbose=False, allow_export=False)
    with open(OUT_JSON) as fh:
        on_disk = json.load(fh)
    if on_disk != fresh:
        print("CHECK FAIL: skillmesh.json is stale -- re-run the tool")
        return 1
    with open(OUT_BIN, "rb") as fh:
        if fh.read() != blob:
            print("CHECK FAIL: skillmesh.bin is stale -- re-run the tool")
            return 1
    # the binary must be exactly as long as the header claims
    want = fresh["nv"] * 12 + fresh["nv"] * 8 + fresh["ni"] * 2
    want += (4 - want % 4) % 4
    if len(blob) != want:
        print("CHECK FAIL: blob is %d bytes, header implies %d" % (len(blob), want))
        return 1
    # every texture the index names must be fetchable through /faces
    missing = [p for p in fresh["tex"] if not os.path.exists(os.path.join(LIBRARY, p))]
    if missing:
        print("CHECK FAIL: %d mesh texture(s) not staged: %s"
              % (len(missing), missing[:5]))
        return 1
    # Wind Strike's bolt: the whole point of this tool
    for name, min_tris in (("windknifeball00", 30), ("windknifewave00", 8),
                           ("windblowin00", 8), ("magiccirclewhite01", 8)):
        rec = fresh["mesh"].get(name)
        if not rec:
            print("CHECK FAIL: %s missing from the index" % name)
            return 1
        tris = sum(s["n"] for s in rec["s"]) // 3
        if tris < min_tris or not any("t" in s for s in rec["s"]):
            print("CHECK FAIL: %s has %d triangles / textures %s"
                  % (name, tris, [s.get("t") for s in rec["s"]]))
            return 1
    msg, ok = verify_basis(fresh, blob)
    if ok is False:
        print("CHECK FAIL: basis/winding — " + msg)
        return 1
    print("CHECK PASS: %d meshes (%d verts, %d tris), %d textures all staged, "
          "%.0f KB binary, %d unresolved"
          % (len(fresh["mesh"]), fresh["nv"], fresh["ni"] // 3,
             len(fresh["tex"]), len(blob) / 1024.0, len(fresh.get("skip", {}))))
    print("            basis %s: %s" % ("PROVED" if ok else "SKIPPED", msg))
    return 0


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="verify only, write nothing")
    args = ap.parse_args()
    if args.check:
        return check()
    out, blob = build()
    with open(OUT_JSON, "w") as fh:
        json.dump(out, fh, separators=(",", ":"), sort_keys=True)
        fh.write("\n")
    with open(OUT_BIN, "wb") as fh:
        fh.write(blob)
    print("wrote %s (%.0f KB) + %s (%.0f KB)"
          % (OUT_JSON, os.path.getsize(OUT_JSON) / 1024.0,
             OUT_BIN, os.path.getsize(OUT_BIN) / 1024.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
