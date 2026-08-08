#!/usr/bin/env python3
"""Build web-ready weapon/shield glTFs from the L2 Interlude client.

Source: assets/interlude/animations/LineageWeapons.ukx (417 SkeletalMesh
objects, `_wp` weapons and `_sh` shields) + LineageWeaponsTex.utx.
Bindings: assets/gamedata/weapongrp.json (weapongrp.dat decoded) —
`object_id` IS the server item id, `mesh`/`texture` name the package
objects, `handness` says how it is wielded.

Why the output looks the way it does
------------------------------------

**Static, unskinned meshes.**  Every roster mesh is a rigid prop: 1 bone,
no per-mesh MeshAnimation (the package holds only `Bow_anim` and
`F_Stick_anim`, which are the *character* arm poses, not weapon rigs).
An ActorX .psk stores its Points in reference-pose MESH space, so a skin
whose bind pose is the reference pose renders exactly those points —
umodel's own glTF export proves it: for `small_sword_m00_wp` it writes a
mesh node with NO transform whose child is the single bone, i.e. the
geometry is already positioned in mesh space.  Emitting the same points
under a single identity node drops the skin, the bone node and the
inverse-bind matrix without moving a single vertex, and makes the client
side unambiguous: `Weapon_R_Bone.add(gltf.scene)` with an identity
transform is correct by construction.

**Origin/scale are retail, untouched.**  ULodMesh carries
MeshScale/MeshOrigin/RotOrigin, which the engine applies at instance time
(UEViewer SkelMeshInstance.cpp:193-199), i.e. ON TOP of the .psk points.
Decoded from the .ukx for all 417 objects, 410 are exactly
MeshScale=(1,1,1), MeshOrigin=(0,0,0), RotOrigin=(0,0,0) — and every one
of the meshes this builder ships is in that set (the 7 exceptions are
`box_m00_et`, `shield_of_pledge_m00_sh`, `Arrow_`, `headgear_m00`,
`skull_graver_m00_wp01`, `maingauche_m00_wp_`, `krono_arrow_m00_wp`, none
of them on the roster).  So there is nothing to bake and nothing to
correct: the emitted positions are the raw psk points in the pipeline's
(x, z, -y) * 0.01 convention, identical to what build_characters.py emits
for bodies — which is why a weapon inherits the character's own uplift
scale for free when parented to `Weapon_R_Bone` / `Weapon_L_Bone`.
`nativeHeight` is computed by the SAME scale_util.native_height() the
character and monster manifests use (glTF Y extent x 100 x MeshScale.z),
so for these meshes it is literally the mesh's own Y extent in L2 units.
The builder REFUSES to ship a mesh whose MeshScale/MeshOrigin/RotOrigin
is not identity rather than silently dropping a transform (--allow-xform
overrides, and then the entry records the raw values).

**ids are lowercased.**  weapongrp.dat and the .ukx export table disagree
in case for 6 objects — weapongrp says `cedar_staff_m00_wp` /
`short_bow_m00_wp`, the package says `Cedar_staff_m00_wp` /
`Short_bow_m00_wp` (both on this roster) — so an id copied from the
package would 404 for a client that keys off weapongrp on a
case-sensitive web server; that exact bug is already recorded for the
monsters manifest (docs/monster-pipeline.md, "Known defect").  All 417
object names are unique under lower(), so lowercasing is lossless.
Manifest id == glTF basename == PNG basename == weapongrp mesh name
lowercased; the client does
`weapongrp[itemId].mesh[i].split('.')[1].toLowerCase()`.

**Roster.**  Newbie/low-level = crystal grade NONE and D, taken from
server/aCis_datapack/data/xml/items/*.xml (`crystal_type`, absent = NONE);
weapongrp's own integer `crystal_type` agrees with the datapack letter for
all 1,313 records (0=NONE 1=D 2=C 3=B 4=A 5=S), so the two sources
cross-check each other.  Excluded: items named "Monster Only*" (never
equippable by a player), body_part 0 (non-equippable, e.g. the
`dropitems.drop_sack_m00` quest drops) and meshes outside LineageWeapons.

Frozen output contract (client codes against it):
  editor/characters/weapons/manifest.json
    {"models": [{"id": "small_sword_m00_wp",
                 "gltf": "models/small_sword_m00_wp.gltf",
                 "handness": 1, "nativeHeight": 0.6, "nativeLength": 23.9}]}
  (handness: 0 shield -> Weapon_L_Bone, everything else -> Weapon_R_Bone;
   1 one-hand, 2 two-hand, 3 dual sword, 4 pole/staff, 5 bow, 6 other,
   7 dual fist -- weapongrp's own field, passed through unchanged.
   See native_length() on why BOTH size fields are emitted.)
  editor/characters/weapons/models/<id>.gltf + .bin + <id>[_sN].png

Usage:
  python3 tools/src/char_pipeline/build_weapons.py            # whole roster
  python3 tools/src/char_pipeline/build_weapons.py <mesh_id>...
  python3 tools/src/char_pipeline/build_weapons.py --list     # roster only
  python3 tools/src/char_pipeline/build_weapons.py --check    # verify output

Run it SERIALLY: the manifest is shared append-merge state (same rule as
build_monsters.py); two concurrent builders corrupt it.
"""
import collections
import json
import os
import shutil
import struct
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
UMODEL = os.path.join(ROOT, 'tools/bin/umodel')
CLIENT = os.path.join(ROOT, 'assets/interlude')
OUT = os.path.join(ROOT, 'editor/characters/weapons')
STAGE = '/tmp/l2wp_stage'
UKX = 'animations/LineageWeapons.ukx'
ITEMS_XML = os.path.join(ROOT, 'server/aCis_datapack/data/xml/items')
WEAPONGRP = os.path.join(ROOT, 'assets/gamedata/weapongrp.json')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools/l2lib'))
import assemble
import scale_util
import validate_gltf
import ue2package as up
from build_characters import (decode_texture_png, library_png, load_utx,
                              resolve_diffuse)

# grades a player meets in the first hours; weapongrp int <-> datapack letter
NEWBIE_GRADES = ('NONE', 'D')
GRADE_INT = {'NONE': 0, 'D': 1, 'C': 2, 'B': 3, 'A': 4, 'S': 5}


# ------------------------------------------------------------ source data

def load_items():
    """-> {item_id: (type, name, crystal_grade)} from the aCis datapack.

    `crystal_type` is absent on NONE-grade items (319 D, 504 C, ... carry
    it explicitly), so absent == NONE.
    """
    items = {}
    for fn in sorted(os.listdir(ITEMS_XML)):
        if not fn.endswith('.xml'):
            continue
        root = ET.parse(os.path.join(ITEMS_XML, fn)).getroot()
        for it in root.findall('item'):
            grade = 'NONE'
            for s in it.findall('set'):
                if s.get('name') == 'crystal_type':
                    grade = s.get('val')
            items[int(it.get('id'))] = (it.get('type'), it.get('name'), grade)
    return items


_WEAPONGRP = None


def weapongrp():
    """-> {object_id: record} from weapongrp.dat."""
    global _WEAPONGRP
    if _WEAPONGRP is None:
        with open(WEAPONGRP) as f:
            _WEAPONGRP = {r['object_id']: r for r in json.load(f)}
    return _WEAPONGRP


def _mesh_ids(rec):
    """LineageWeapons mesh object names (lowercased) of a weapongrp record."""
    out = []
    for m in rec['mesh']:
        if not m or '.' not in m:
            continue
        pkg, obj = m.split('.', 1)
        if pkg.lower() == 'lineageweapons':
            out.append(obj.lower())
    return out


def roster():
    """-> [(mesh_id, handness, [(item_id, name, grade), ...])] newest-first
    by how many item ids share the mesh (the ranking a partial build uses).

    handness is an ITEM property, not a mesh property: a dual-sword item
    (handness 3) references TWO one-handed meshes, so 8 sword meshes are
    seen with both 1 and 3.  Resolution: take the handness the mesh has in
    records where it is the item's ONLY mesh (verified unambiguous for all
    165 meshes that have such a record); the 16 meshes that only ever
    appear paired (fist weapons, dual swords) take the most common value
    across all their records — for those, paired IS how they are worn.
    """
    items = load_items()
    grp = weapongrp()
    hands_single = collections.defaultdict(collections.Counter)
    hands_any = collections.defaultdict(collections.Counter)
    uses = collections.OrderedDict()
    for iid in sorted(items):
        _typ, name, grade = items[iid]
        if grade not in NEWBIE_GRADES:
            continue
        rec = grp.get(iid)
        if not rec:
            continue
        # weapongrp's own grade must agree with the datapack's (it does for
        # all 1,313 records) -- a mismatch means one of the two sources is
        # stale and the roster would be wrong.
        if rec['crystal_type'] != GRADE_INT[grade]:
            print('  WARNING: item %d grade mismatch: weapongrp %d vs xml %s'
                  % (iid, rec['crystal_type'], grade))
            continue
        if name.startswith('Monster Only'):
            continue        # never equippable by a player
        if rec['body_part'] == 0:
            continue        # not an equip slot (quest drops etc.)
        ids = _mesh_ids(rec)
        for mid in ids:
            uses.setdefault(mid, []).append((iid, name, grade))
            hands_any[mid][rec['handness']] += 1
            if len(ids) == 1:
                hands_single[mid][rec['handness']] += 1
    out = []
    for mid, u in uses.items():
        c = hands_single[mid] or hands_any[mid]
        out.append((mid, c.most_common(1)[0][0], u))
    out.sort(key=lambda r: (-len(r[2]), r[0]))
    return out


# --------------------------------------------------------------- umodel

def umodel(args):
    r = subprocess.run([UMODEL, '-game=l2'] + args, cwd=CLIENT,
                       capture_output=True)
    r.stdout = r.stdout.decode('utf-8', 'replace')
    r.stderr = r.stderr.decode('utf-8', 'replace')
    return r


_OBJECTS = None


def package_objects():
    """-> {lowercased object name: real object name} for LineageWeapons.ukx.

    Read from the package itself (not `umodel -list`) so the real spelling
    is authoritative; 6 objects differ in case from weapongrp's spelling.
    """
    global _OBJECTS
    if _OBJECTS is None:
        pkg = load_ukx()
        _OBJECTS = {}
        for ex in pkg.exports:
            if pkg.class_name_of(ex) == 'SkeletalMesh':
                _OBJECTS[pkg.export_name(ex).lower()] = pkg.export_name(ex)
    return _OBJECTS


_UKX = None


def load_ukx():
    global _UKX
    if _UKX is None:
        _UKX, _proto = up.load_package(os.path.join(CLIENT, UKX))
    return _UKX


def export_psk(obj_name, outdir):
    os.makedirs(outdir, exist_ok=True)
    r = umodel(['-export', '-out=%s' % outdir, UKX, obj_name])
    if r.returncode != 0:
        raise RuntimeError('umodel export failed: %s' % r.stderr[-300:])
    for dirpath, _dirs, files in os.walk(outdir):
        for f in files:
            if f.lower() == (obj_name + '.psk').lower():
                return os.path.join(dirpath, f)
    return None


# ------------------------------------------------------- instance transform

def instance_transform(obj_name):
    """ULodMesh MeshScale / MeshOrigin / RotOrigin decoded from the .ukx.

    The engine applies these to the whole mesh at instance time
    (UEViewer SkelMeshInstance.cpp:193-199), so they are NOT in the .psk.
    """
    pkg = load_ukx()
    ex = pkg.find_export(obj_name)
    if ex is None:
        raise RuntimeError('mesh %s not in %s' % (obj_name, UKX))
    r = pkg.body_reader(ex)
    up.read_properties(pkg, r)
    r.pos += 25 + 16                 # bounding box/sphere
    r.i32()                          # version
    r.i32()                          # VertexCount
    n = r.compact()
    r.pos += 4 * n                   # Verts
    ntex = r.compact()
    for _ in range(ntex):
        r.compact()                  # Textures
    scale = (r.f32(), r.f32(), r.f32())
    origin = (r.f32(), r.f32(), r.f32())
    rot = (r.i32(), r.i32(), r.i32())
    return scale, origin, rot


IDENTITY_XFORM = ((1.0, 1.0, 1.0), (0.0, 0.0, 0.0), (0, 0, 0))


def native_length(psk_data, scale):
    """Longest bounding-box edge in L2 world units.

    `nativeHeight` (glTF Y extent x 100 x MeshScale.z) is emitted too so
    every manifest in this pipeline carries the same field computed the
    same way, but for a weapon it is nearly meaningless: weapons are
    modelled along mesh-space X (blade/haft) with the flat of the blade in
    Z, and glTF Y == psk Z, so `nativeHeight` reports a short sword's
    BLADE THICKNESS (0.6 units) rather than its size.  nativeLength is the
    number that describes a weapon: max over axes of (psk extent x
    MeshScale component), i.e. 23.9 units for small_sword_m00_wp against a
    ~45-unit-tall human.  Weapons need no client-side rescale at all —
    they inherit the character's uplift through the bone they hang on —
    so both numbers are descriptive, not corrective.
    """
    pts = psk_data['points']
    return round(max((max(p[i] for p in pts) - min(p[i] for p in pts))
                     * scale[i] for i in range(3)), 1)


# -------------------------------------------------------------- materials

def texture_alpha_mode(texpkg, texname):
    """glTF alphaMode from the Texture's OWN UE2 property flags.

    LineageWeaponsTex sets `bMasked` on 226 of its 530 Textures and
    `bAlphaTexture` on 77 — the engine's masked (1-bit cutout, e.g. bow
    strings and pierced blades) and alpha-blended modes.  Nothing is
    inferred from the pixels.
    """
    pkg = load_utx(texpkg)
    ex = pkg.find_export(texname)
    if ex is None:
        return None
    props = up.read_properties(pkg, pkg.body_reader(ex))
    if props.get('bMasked') is True:
        return 'MASK'
    if props.get('bAlphaTexture') is True:
        return 'BLEND'
    return None


def resolve_tex_png(texpkg, obj_name, tmp_dir, keep_alpha):
    """-> (png_path, resolved_texture_name) — library export first, l2lib
    decode otherwise.  Same *_sp handling as the monster path: L2 `_sp`
    textures carry the diffuse in RGB with a specular mask in alpha, and
    the library export of an `_sp` shows the MASK, so prefer the
    non-suffixed sibling and decode RGB from the .utx when there is none.
    """
    try:
        resolved = resolve_diffuse(texpkg, obj_name)
    except Exception:
        resolved = obj_name
    if resolved.lower().endswith('_sp'):
        sib = resolved[:-3]
        png = library_png(texpkg, sib)
        if png:
            return png, sib
        os.makedirs(tmp_dir, exist_ok=True)
        out = os.path.join(tmp_dir, resolved + '.png')
        if decode_texture_png(texpkg, resolved, out, keep_alpha=False):
            return out, resolved
        return None, resolved
    png = library_png(texpkg, resolved)
    if png:
        return png, resolved
    os.makedirs(tmp_dir, exist_ok=True)
    out = os.path.join(tmp_dir, resolved + '.png')
    if decode_texture_png(texpkg, resolved, out, keep_alpha=keep_alpha):
        return out, resolved
    return None, resolved


def sections_for(obj_name, psk_data, tmp_dir):
    """Per-section (png_path, resolved_name, alpha_mode) in ORDINAL order.

    Primary source: the mesh's own .ukx material slots (Materials ->
    Textures), the rule the monster/NPC path already established.  Many
    LineageWeapons meshes leave the slot null (small_sword_m00_wp does),
    so weapongrp's `texture` array is the ordinal fallback — it is a
    per-section list, not a variant list: tower_shield_m00_sh has two
    slots and weapongrp lists exactly `[tower_shield_t00_sh,
    tower_shield_t01_sh]` for it.
    """
    pkg = load_ukx()
    ex = pkg.find_export(obj_name)
    _ver, tex_refs, mats = up.mesh_material_slots(pkg, ex)
    grp_texs = []
    for rec in weapongrp().values():
        if obj_name.lower() in _mesh_ids(rec):
            grp_texs = [t for t in rec['texture'] if t]
            break
    nsec = max(1, len(psk_data['materials']))
    out = []
    for si in range(nsec):
        ref = None
        if si < len(mats) and 0 <= mats[si] < len(tex_refs):
            ref = tex_refs[mats[si]]
        if (not ref or not ref[0]) and si < len(grp_texs):
            tp, tn = grp_texs[si].split('.', 1)
            ref = (tp, tn)
        if not ref or not ref[0]:
            print('  WARNING: section %d has no texture' % si)
            out.append((None, None, None))
            continue
        mode = texture_alpha_mode(ref[0], ref[1])
        png, resolved = resolve_tex_png(ref[0], ref[1], tmp_dir,
                                        keep_alpha=mode is not None)
        print('  section %d -> %s.%s -> %s%s'
              % (si, ref[0], ref[1], resolved,
                 ' [%s]' % mode if mode else ''))
        out.append((png, resolved, mode))
    return out


# --------------------------------------------------------- static emitter

def emit_static_gltf(data, name, sections, out_path):
    """A rigid prop: one identity node, one mesh, one primitive per
    material section.  Positions/normals/UVs come out of assemble.py's
    verified converters, so the numbers are bit-identical to what the
    character pipeline emits for the same points; only the skin is gone
    (see the module docstring)."""
    b = assemble.GltfBuilder()
    g = b.g
    g['asset']['generator'] = 'l2vzla char_pipeline (weapons, static psk)'
    points, wedges, faces = data['points'], data['wedges'], data['faces']
    normals = assemble._point_normals(points, wedges, faces)

    nsec = max(1, len(data['materials']))
    sec_faces = [[] for _ in range(nsec)]
    for f in faces:
        sec_faces[f[3] if f[3] < nsec else 0].append(f)

    prims = []
    for si, sfaces in enumerate(sec_faces):
        if not sfaces:
            continue
        vmap, order = {}, []

        def vidx(w):
            if w not in vmap:
                vmap[w] = len(order)
                order.append(w)
            return vmap[w]

        iblob = bytearray()
        for w0, w1, w2, _mi in sfaces:
            # WINDING: assemble._face_indices reverses the psk face order.
            # Rationale and the measurement live in its docstring; the
            # skinned path in assemble.merge_parts now calls the same
            # helper, so both paths cannot drift apart.
            for w in assemble._face_indices(w0, w1, w2):
                iblob += struct.pack('<I', vidx(w))
        pos_b, nrm_b, uv_b = bytearray(), bytearray(), bytearray()
        mins, maxs = [1e30] * 3, [-1e30] * 3
        for w in order:
            pi, u, v = wedges[w]
            tp = assemble._xf_pos(points[pi])
            for i in range(3):
                mins[i] = min(mins[i], tp[i])
                maxs[i] = max(maxs[i], tp[i])
            pos_b += struct.pack('<3f', *tp)
            nrm_b += struct.pack('<3f', *assemble._xf_dir(normals[pi]))
            uv_b += struct.pack('<2f', u, v)
        attrs = {
            'POSITION': b.accessor(b.push(bytes(pos_b)), 5126, len(order),
                                   'VEC3', mn=mins, mx=maxs),
            'NORMAL': b.accessor(b.push(bytes(nrm_b)), 5126, len(order),
                                 'VEC3'),
            'TEXCOORD_0': b.accessor(b.push(bytes(uv_b)), 5126, len(order),
                                     'VEC2'),
        }
        uri, alpha = sections[si] if si < len(sections) else (None, None)
        mat_name = data['materials'][si] if si < len(data['materials']) \
            else name
        prims.append({'attributes': attrs, 'mode': 4,
                      'indices': b.accessor(b.push(bytes(iblob)), 5125,
                                            len(sfaces) * 3, 'SCALAR'),
                      'material': b.add_material(uri, alpha,
                                                 '%s:%s' % (name, mat_name))})
    if not prims:
        raise RuntimeError('%s has no faces' % name)
    g['meshes'].append({'name': name, 'primitives': prims})
    g['nodes'].append({'name': name, 'mesh': 0})
    g['scenes'][0]['nodes'].append(0)
    del g['skins']
    del g['animations']
    bin_data = bytes(b.bin)
    g['buffers'] = [{'uri': os.path.basename(out_path).replace('.gltf', '.bin'),
                     'byteLength': len(bin_data)}]
    with open(out_path, 'w') as f:
        json.dump(g, f)
    with open(out_path.replace('.gltf', '.bin'), 'wb') as f:
        f.write(bin_data)
    return g


# ------------------------------------------------------------------ build

def build_one(mesh_id, handness, stage, outdir, allow_xform=False):
    obj = package_objects().get(mesh_id)
    if not obj:
        print('  SKIP: %s is not a SkeletalMesh in %s' % (mesh_id, UKX))
        return None
    xform = instance_transform(obj)
    if xform != IDENTITY_XFORM:
        msg = ('MeshScale/MeshOrigin/RotOrigin %s is not identity — the '
               'engine applies it on top of the psk points, so an '
               'identity-parented glTF would be wrong' % (xform,))
        if not allow_xform:
            print('  SKIP: %s' % msg)
            return None
        print('  NOTE: %s (--allow-xform)' % msg)
    psk = export_psk(obj, stage)
    if not psk:
        print('  SKIP: umodel produced no .psk for %s' % obj)
        return None
    data = assemble.parse_psk(psk)
    if len(data['bones']) != 1:
        # Not fatal: psk Points are in reference-pose mesh space whatever
        # the bone count, so a static emit still renders the bind pose.
        print('  note: %d bones (shipping the reference pose)'
              % len(data['bones']))

    secs = sections_for(obj, data, os.path.join(stage, 'tex'))
    out_secs = []
    for si, (png, _resolved, mode) in enumerate(secs):
        uri = None
        if png:
            uri = ('%s.png' % mesh_id if len(secs) == 1
                   else '%s_s%d.png' % (mesh_id, si))
            with open(png, 'rb') as fi, \
                    open(os.path.join(outdir, uri), 'wb') as fo:
                fo.write(fi.read())
        out_secs.append((uri, mode))
    if not any(u for u, _m in out_secs):
        print('  WARNING: no texture resolved for %s' % mesh_id)

    out_gltf = os.path.join(outdir, '%s.gltf' % mesh_id)
    emit_static_gltf(data, obj, out_secs, out_gltf)
    entry = {'id': mesh_id, 'gltf': 'models/%s.gltf' % mesh_id,
             'handness': handness}
    nh = scale_util.native_height(out_gltf, os.path.join(CLIENT, UKX), obj)
    if nh:
        entry['nativeHeight'] = nh
    entry['nativeLength'] = native_length(data, xform[0])
    if xform != IDENTITY_XFORM:
        entry['meshScale'] = list(xform[0])
        entry['meshOrigin'] = list(xform[1])
        entry['rotOrigin'] = list(xform[2])
    print('  -> %s (%d sections, nativeHeight %s)'
          % (out_gltf, len(out_secs), nh))
    return entry


# ------------------------------------------------------------------ check

def check():
    """Verify the shipped manifest against the roster and the files."""
    manifest_path = os.path.join(OUT, 'manifest.json')
    outdir = os.path.join(OUT, 'models')
    if not os.path.isfile(manifest_path):
        print('MISSING %s' % manifest_path)
        return 1
    models = json.load(open(manifest_path))['models']
    errs = []
    seen = {}
    # case-sensitive listing: os.path.exists lies on macOS (the defect
    # documented in docs/monster-pipeline.md) and a Linux web server does not
    ondisk = set(os.listdir(outdir)) if os.path.isdir(outdir) else set()
    for m in models:
        mid = m['id']
        if mid != mid.lower():
            errs.append('%s: id is not lowercase' % mid)
        if mid.lower() in seen:
            errs.append('%s: duplicate id under lower()' % mid)
        seen[mid.lower()] = m
        if 'handness' not in m:
            errs.append('%s: no handness' % mid)
        if not m.get('nativeLength', 0) > 0:
            errs.append('%s: no positive nativeLength' % mid)
        if m.get('gltf') != 'models/%s.gltf' % mid:
            errs.append('%s: gltf path %r does not match id' % (mid, m.get('gltf')))
        for suffix in ('.gltf', '.bin'):
            if '%s%s' % (mid, suffix) not in ondisk:
                errs.append('%s: %s%s missing (case-sensitive check)'
                            % (mid, mid, suffix))
        gp = os.path.join(outdir, '%s.gltf' % mid)
        if not os.path.isfile(gp):
            continue
        g = json.load(open(gp))
        for im in g.get('images', []):
            if im['uri'] not in ondisk:
                errs.append('%s: image %s missing (case-sensitive check)'
                            % (mid, im['uri']))
        for n in g['nodes']:
            if any(k in n for k in ('translation', 'rotation', 'scale',
                                    'matrix')):
                errs.append('%s: node %r carries a transform — the client '
                            'parents with identity' % (mid, n.get('name')))
        if g.get('skins') or g.get('animations'):
            errs.append('%s: expected a static mesh (no skins/animations)' % mid)
        ge, _gw = validate_gltf.validate(gp)
        errs.extend('%s: %s' % (mid, e) for e in ge)

    want = roster()
    missing = [r for r in want if r[0] not in seen]
    for mid, hand, _u in want:
        if mid in seen and seen[mid]['handness'] != hand:
            errs.append('%s: handness %s != roster %s'
                        % (mid, seen[mid]['handness'], hand))
    print('\nmanifest: %d models; roster (NONE/D player weapons): %d; '
          'built %d; missing %d'
          % (len(models), len(want), len(want) - len(missing), len(missing)))
    if missing:
        print('remaining worklist (most-shared mesh first):')
        for mid, hand, u in missing:
            print('  %-42s handness=%d  %d item ids  e.g. %s'
                  % (mid, hand, len(u), u[0][1]))
    for e in errs:
        print('ERROR: %s' % e)
    print('CHECK %s (%d errors)' % ('PASS' if not errs else 'FAIL', len(errs)))
    return 1 if errs else 0


# ------------------------------------------------------------------- main

def main():
    args = list(sys.argv[1:])
    allow_xform = '--allow-xform' in args
    args = [a for a in args if a != '--allow-xform']
    if '--check' in args:
        return check()
    if '--list' in args:
        want = roster()
        for mid, hand, u in want:
            print('%-42s handness=%d  %2d item ids  e.g. %s'
                  % (mid, hand, len(u), u[0][1]))
        print('%d meshes' % len(want))
        return 0

    want = roster()
    hands = {mid: h for mid, h, _u in want}
    if args:
        todo = []
        for a in args:
            mid = a.lower()
            if mid not in hands:
                print('== %s ==\n  SKIP: not a NONE/D player weapon mesh' % a)
                continue
            todo.append((mid, hands[mid]))
    else:
        todo = [(mid, h) for mid, h, _u in want]

    outdir = os.path.join(OUT, 'models')
    os.makedirs(outdir, exist_ok=True)
    manifest_path = os.path.join(OUT, 'manifest.json')
    # MERGE ONLY — shared append-merge state; never drop or reorder entries.
    existing, order = {}, []
    if os.path.isfile(manifest_path):
        for m in json.load(open(manifest_path)).get('models', []):
            existing[m['id']] = m
            order.append(m['id'])
    built = failed = 0
    for n, (mesh_id, handness) in enumerate(todo, 1):
        print('== %s (%d/%d) ==' % (mesh_id, n, len(todo)))
        stage = os.path.join(STAGE, mesh_id)
        if os.path.isdir(stage):
            shutil.rmtree(stage)
        try:
            entry = build_one(mesh_id, handness, stage, outdir, allow_xform)
        except Exception as e:
            print('  FAILED: %s' % e)
            entry = None
        if entry:
            if entry['id'] not in existing:
                order.append(entry['id'])
            existing[entry['id']] = entry
            built += 1
        else:
            failed += 1
        models = [existing[k] for k in order if k in existing]
        with open(manifest_path, 'w') as f:
            json.dump({'models': models}, f, indent=2)
        if n % 5 == 0 or n == len(todo):
            # re-parse: the manifest is shared state, prove it still parses
            json.load(open(manifest_path))
    print('\nbuilt %d, failed/skipped %d; manifest: %d models -> %s'
          % (built, failed, len(existing), manifest_path))
    return 1 if failed and built == 0 else 0


if __name__ == '__main__':
    sys.exit(main())
