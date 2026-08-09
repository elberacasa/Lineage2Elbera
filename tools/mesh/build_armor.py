#!/usr/bin/env python3
"""Build the armor paperdoll: per-slot body meshes + the item->mesh table.

WHY THIS SHAPE
==============
L2 armor is not an attached prop. Equipping a breastplate does not hang a
model off a bone -- it REPLACES the character's upper-body mesh. armorgrp.dat
says so directly: every armor row carries, per race AND sex, a SkeletalMesh
name and a material name, and those mesh names are the same family the
creation body is built from (`MFighter_m001_u` is both the newbie chest and
armorgrp row 21's `m_HumnFigh` mesh). So the renderer's job is mesh
SUBSTITUTION per slot, and the "no armor" default is simply the mesh the base
character glTF already ships.

MEASURED, not assumed:

  * body_part -> slot.  Never taken from an L2J bitmask table.  Derived from
    the data itself: group armorgrp by `body_part` and look at what the
    referenced mesh names END in.  bp 9 -> 145 meshes, all `_g`.  bp 10 -> 95,
    all `_u`.  bp 11 -> `_l`.  bp 12 -> `_b`.  bp 15 -> `_u` AND `_l` together
    (74 items, i.e. full armor).  bp 13 -> `_mt` (cloaks).  bp 17/18/19 ->
    `_a` (hair accessories).  The item NAMES agree independently: bp 9 is
    "Short Gloves/Gloves/Bracer", bp 12 is "Cloth Shoes/Low Boots".
    `--check` re-derives this and fails if the data ever disagrees.

  * bp 6 (HEAD) -- 96 items, "Cloth Cap", "Wooden Helmet", ... -- references
    ZERO meshes across all 28 race slots.  Interlude does not render helmets
    as geometry at all.  No helmet mesh is invented here; the slot exists in
    the table with `meshes: []` and the renderer leaves the head alone.
    Same for bp 1/3/4 (earring, necklace, ring): no geometry in retail.

  * race_slot key -> model id.  Verified by package agreement, not by name
    similarity: `m_HumnMyst` rows name meshes in package `Magic` with prefix
    `MMagic`, and build_characters.py's `human_mystic_m` combo is
    (Magic, MMagic).  All 14 pairs match this way.

  * the diffuse texture.  armorgrp's texture string is a MATERIAL name, and
    56% of them are `Shader`/`FinalBlend` objects, not `Texture` objects --
    which is exactly why a plain "is this file in assets/library" check
    reports 1,937 missing textures when in fact every raw bitmap is already
    on disk.  l2lib.resolve_material walks Diffuse/Material to the underlying
    Texture export; umodel agrees object-for-object (it loads precisely the
    same bitmaps for each material).

  * alpha.  NOT guessed from the texture's alpha channel -- many armor
    diffuses have a near-empty alpha channel that is a specularity level, not
    coverage, and treating it as opacity erases the piece.  The material's own
    property stream decides: a FinalBlend with `AlphaTest` true -> MASK at its
    `AlphaRef`; anything else -> OPAQUE.  `TwoSided` likewise comes from the
    property, never from a guess about skirts.

  * the mirrored-geometry trap.  Every armor mesh's ULodMesh
    MeshScale/MeshOrigin/RotOrigin is decoded before the mesh ships.  The gate
    is NOT "must be identity" -- measured, none of them are, and neither are
    the creation meshes the client already renders correctly: every model's
    own body carries a yaw of 49152 (270 deg in Unreal rotation units), a z
    origin of 20.5-31.5, and a uniform scale of 1.0 or 1.03.  That transform
    is the whole-body placement, and it is the SAME for a model's armor as for
    its bare body, which is exactly why substitution needs no extra transform.
    So the gate is EQUALITY WITH THE BASE MESH THIS ONE REPLACES, per model.
    A mesh whose transform differs from the body it swaps into is refused and
    listed rather than shipped under a node that would place it wrongly.
    On mirroring specifically: all 1,355 armor meshes were checked and NONE
    has a negative MeshScale component, so the negative-determinant DrawScale3D
    problem that affects 1,849 world placements does not arise here.  That is
    a measurement, not an assumption -- `--check` re-runs it.

OUTPUTS
    assets/gamedata/armormesh.json      itemId -> slot + per-model mesh/texture
    editor/characters/armor/<Pkg>/<Mesh>.gltf/.bin   geometry only, no texture
    editor/characters/armor/tex/<Pkg>.<Tex>.png      resolved diffuse
    editor/characters/armor/manifest.json

Usage:
    tools/mesh/build_armor.py            # build everything
    tools/mesh/build_armor.py --check    # verify; nonzero exit on any defect
    tools/mesh/build_armor.py --table    # table only (no mesh/texture export)
"""
import argparse
import collections
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
UMODEL = os.path.join(ROOT, 'tools/bin/umodel')
CLIENT = os.path.join(ROOT, 'assets/interlude')
ANIMDIR = os.path.join(CLIENT, 'animations')
TEXDIR = os.path.join(CLIENT, 'systextures')
LIBRARY = os.path.join(ROOT, 'assets/library')
ARMORGRP = os.path.join(ROOT, 'assets/gamedata/armorgrp.json')
TABLE_OUT = os.path.join(ROOT, 'assets/gamedata/armormesh.json')
OUT = os.path.join(ROOT, 'editor/characters/armor')
STAGE = '/tmp/l2armor_stage'

sys.path.insert(0, os.path.join(ROOT, 'tools/src/char_pipeline'))
sys.path.insert(0, os.path.join(ROOT, 'tools/l2lib'))
import assemble                                    # noqa: E402
import ue2package as up                            # noqa: E402


# armorgrp race_slot key -> (model id, ukx package, mesh prefix).  The package
# and prefix are what build_characters.py's COMBOS use for the same model; the
# mesh names in each race slot are checked against them in verify_slot_map().
RACE_SLOTS = [
    ('m_HumnFigh', 'human_fighter_m', 'Fighter', 'MFighter'),
    ('f_HumnFigh', 'human_fighter_f', 'Fighter', 'FFighter'),
    ('m_HumnMyst', 'human_mystic_m',  'Magic',   'MMagic'),
    ('f_HumnMyst', 'human_mystic_f',  'Magic',   'FMagic'),
    ('m_Elf',      'elf_m',           'Elf',     'MElf'),
    ('f_Elf',      'elf_f',           'Elf',     'FElf'),
    ('m_DarkElf',  'darkelf_m',       'DarkElf', 'MDarkElf'),
    ('f_DarkElf',  'darkelf_f',       'DarkElf', 'FDarkElf'),
    ('m_OrcFigh',  'orc_fighter_m',   'Orc',     'MOrc'),
    ('f_OrcFigh',  'orc_fighter_f',   'Orc',     'FOrc'),
    ('m_OrcMage',  'orc_mystic_m',    'Shaman',  'MShaman'),
    ('f_OrcMage',  'orc_mystic_f',    'Shaman',  'FShaman'),
    ('m_Dorf',     'dwarf_m',         'Dwarf',   'MDwarf'),
    ('f_Dorf',     'dwarf_f',         'Dwarf',   'FDwarf'),
]
MODEL_IDS = [r[1] for r in RACE_SLOTS]

# body_part -> (slot name, the base-character mesh suffixes it replaces).
# The suffix lists are DERIVED (see verify_slot_map); they are written out
# here so the renderer knows which base part to hide, and re-checked on
# every run against what armorgrp's own mesh names end in.
SLOTS = {
    # Underwear replaces the body, and the mesh it names proves it: the one
    # underwear row that carries geometry (id 55 "Cotton Undergarment") names
    # `<Prefix>_m000_u` + `_m000_l` for all 14 models -- the BARE body meshes.
    # The other 12 underwear rows reference no mesh at all.
    0:  ('underwear', ['_u', '_l']),
    1:  ('rear',      []),
    2:  ('lear',      []),
    3:  ('neck',      []),
    4:  ('rfinger',   []),
    5:  ('lfinger',   []),
    6:  ('head',      []),        # 96 items, ZERO meshes in Interlude
    9:  ('gloves',    ['_g']),
    10: ('chest',     ['_u']),
    11: ('legs',      ['_l']),
    12: ('feet',      ['_b']),
    13: ('cloak',     []),        # _mt, an ADDITIONAL mesh, replaces nothing
    15: ('fullarmor', ['_u', '_l']),
    16: ('alldress',  ['_u', '_l', '_g', '_b']),
    17: ('hair',      []),        # _a, additional
    18: ('hair2',     []),
    19: ('hairall',   []),
}
# which paperdoll key on the wire feeds each slot (gateway readPaperdollItems)
PAPERDOLL_KEYS = ['gloves', 'chest', 'legs', 'feet']

IDENTITY_XFORM = ((1.0, 1.0, 1.0), (0.0, 0.0, 0.0), (0, 0, 0))


def load_armorgrp():
    with open(ARMORGRP) as f:
        return json.load(f)


# ------------------------------------------------------------------ slot map

def derive_slot_suffixes(rows):
    """body_part -> Counter of mesh-name suffixes, straight from armorgrp."""
    out = collections.defaultdict(collections.Counter)
    for e in rows:
        for key, _mid, _pkg, _pfx in RACE_SLOTS:
            for m in e['race_slots'][key]['meshes']:
                if not m:
                    continue
                mm = re.search(r'_([a-z0-9]+)$', m.split('.')[-1])
                out[e['body_part']][mm.group(1) if mm else '?'] += 1
    return out


def verify_slot_map(rows, fail):
    """The SLOTS table must still match what the data says."""
    derived = derive_slot_suffixes(rows)
    for bp, counts in sorted(derived.items()):
        if bp not in SLOTS:
            fail('body_part %d appears in armorgrp but is not in SLOTS' % bp)
            continue
        name, replaces = SLOTS[bp]
        # every suffix the data uses, in descending frequency, ignoring the
        # additive kinds that replace no base part
        seen = {'_' + s for s in counts}
        if replaces and not set(replaces) <= seen:
            fail('body_part %d (%s) claims to replace %s but armorgrp only '
                 'references suffixes %s' % (bp, name, replaces, sorted(seen)))
        if not replaces and any(('_' + s) in ('_u', '_l', '_g', '_b')
                                for s in counts):
            fail('body_part %d (%s) is marked additive but references body '
                 'suffixes %s' % (bp, name, sorted(seen)))
    # bp 6 is the load-bearing negative claim: helmets have no geometry
    if 6 in derived:
        fail('body_part 6 (head) now references meshes %s -- Interlude shipped '
             'none; the helmet gap must be revisited' % dict(derived[6]))
    # the race-slot -> package mapping must hold for every row
    bad = collections.Counter()
    for e in rows:
        for key, mid, pkg, pfx in RACE_SLOTS:
            for m in e['race_slots'][key]['meshes']:
                if not m or '.' not in m:
                    continue
                p, n = m.split('.', 1)
                # LineageAccessory holds the shared hair/accessory meshes for
                # every race; only body meshes live in the race package.
                if p.lower().startswith('lineage'):
                    continue
                if p.lower() != pkg.lower() or not n.lower().startswith(pfx.lower()):
                    bad[(key, p, n[:12])] += 1
    if bad:
        fail('race_slot -> package mapping broken for %d mesh refs, e.g. %s'
             % (sum(bad.values()), bad.most_common(3)))


# ------------------------------------------------------------ package access

_ukx_cache = {}
_utx_cache = {}


def ukx(pkg):
    key = pkg.lower()
    if key not in _ukx_cache:
        path = _find(ANIMDIR, key + '.ukx')
        _ukx_cache[key] = up.load_package(path)[0] if path else None
    return _ukx_cache[key]


def utx(pkg):
    key = pkg.lower()
    if key not in _utx_cache:
        path = _find(TEXDIR, key + '.utx')
        _utx_cache[key] = up.load_package(path)[0] if path else None
    return _utx_cache[key]


def _find(directory, lower_name):
    for f in os.listdir(directory):
        if f.lower() == lower_name:
            return os.path.join(directory, f)
    return None


_lib_index = None


def library_png(pkg, name):
    """Case-insensitive lookup into assets/library/<Pkg>/<Name>.png."""
    global _lib_index
    if _lib_index is None:
        _lib_index = {}
        for p in os.listdir(LIBRARY):
            d = os.path.join(LIBRARY, p)
            if not os.path.isdir(d):
                continue
            for f in os.listdir(d):
                base, ext = os.path.splitext(f)
                if ext.lower() == '.png':
                    _lib_index.setdefault((p.lower(), base.lower()),
                                          os.path.join(d, f))
    return _lib_index.get((pkg.lower(), name.lower()))


# --------------------------------------------------------------- materials

def material_info(texpkg, objname):
    """-> {'diffuse': (pkg, name), 'alpha_mode': ..., 'two_sided': bool}

    The alpha decision comes from the material's own properties, never from
    the bitmap: a FinalBlend that declares AlphaTest is a cutout at its
    AlphaRef; everything else is opaque.  Several armor diffuses carry an
    almost-empty alpha channel that is a specularity level, and reading it
    as coverage makes the piece vanish.
    """
    pkg = utx(texpkg)
    if pkg is None:
        return None
    ex = pkg.find_export(objname)
    if ex is None:
        return None
    cls = pkg.class_name_of(ex)
    alpha_mode, alpha_ref, two_sided = 'OPAQUE', None, False
    if cls != 'Texture':
        r = pkg.body_reader(ex)
        props = up.read_properties(pkg, r, fmt='packed')
        if props.get('AlphaTest') is True:
            alpha_mode = 'MASK'
            raw = props.get('AlphaRef')
            if isinstance(raw, (bytes, bytearray)) and raw:
                alpha_ref = raw[0] / 255.0
        if props.get('Opacity') is not None:
            alpha_mode = 'BLEND'
        two_sided = bool(props.get('TwoSided') or props.get('TreatAsTwoSided'))
    try:
        dif = up.resolve_material(pkg, ex)
    except up.L2Error:
        return None
    if dif is None:
        return None
    return {'diffuse': (texpkg, pkg.export_name(dif)),
            'alpha_mode': alpha_mode,
            'alpha_ref': alpha_ref,
            'two_sided': two_sided,
            'material_class': cls}


# ------------------------------------------------------- instance transform

def instance_transform(pkg_name, obj_name):
    """ULodMesh MeshScale/MeshOrigin/RotOrigin -- applied by the engine at
    instance time (UEViewer SkelMeshInstance.cpp), so NOT baked in the .psk.
    A negative MeshScale component mirrors the mesh; shipping it under an
    identity node would be wrong."""
    pkg = ukx(pkg_name)
    ex = pkg.find_export(obj_name, 'SkeletalMesh')
    if ex is None:
        return None
    r = pkg.body_reader(ex)
    up.read_properties(pkg, r)
    r.pos += 25 + 16
    r.i32()                      # version
    r.i32()                      # VertexCount
    n = r.compact()
    r.pos += 4 * n               # Verts
    for _ in range(r.compact()):
        r.compact()              # Textures
    scale = (r.f32(), r.f32(), r.f32())
    origin = (r.f32(), r.f32(), r.f32())
    rot = (r.i32(), r.i32(), r.i32())
    return scale, origin, rot


# --------------------------------------------------------------- collection

def base_body_mesh():
    """model id -> the `_u` mesh name its shipped glTF is built from.

    The glTF's mesh names ARE the retail names, so this is a direct read of
    what the client already renders, not a naming guess.
    """
    out = {}
    for mid in MODEL_IDS:
        path = os.path.join(ROOT, 'editor/characters/models/%s.gltf' % mid)
        if not os.path.exists(path):
            continue
        with open(path) as f:
            g = json.load(f)
        # EVERY mesh, in the glTF's own order -- which is the order
        # build_characters.py added them, and therefore the order that produced
        # this model's canonical bone list. Seeding with only `_u` is not
        # enough: the later parts contribute bones of their own, so a
        # `_u`-only seed lands on a shorter, different canonical order.
        out[mid] = ([m['name'] for m in g['meshes']],
                    [g['nodes'][j]['name'] for j in g['skins'][0]['joints']])
    return out


def model_of_mesh(pkg_name, mesh_name):
    """Which of the 14 models owns this mesh, by package + prefix.

    Body meshes live in the race package under the model's own prefix
    (`Fighter.MFighter_m003_u` -> human_fighter_m); the accessory package is
    shared and is prefixed per race in lower case
    (`LineageAccessory.Mfighter_hair_m000_a`).
    """
    low = mesh_name.lower()
    best = None
    for _key, mid, pkg, pfx in RACE_SLOTS:
        if low.startswith(pfx.lower()) and (
                pkg.lower() == pkg_name.lower()
                or pkg_name.lower().startswith('lineage')):
            if best is None or len(pfx) > best[1]:
                best = (mid, len(pfx))
    return best[0] if best else None


def base_transforms():
    """model id -> the ULodMesh transform of the body mesh it already ships.

    Read from the built character glTFs, whose mesh names ARE the retail mesh
    names (`MFighter_m001_u`), so this is the transform the client is already
    rendering correctly today.  Any armor mesh that swaps into that slot must
    carry the same one.
    """
    pkgpfx = {r[1]: (r[2], r[3]) for r in RACE_SLOTS}
    out = {}
    for mid in MODEL_IDS:
        path = os.path.join(ROOT, 'editor/characters/models/%s.gltf' % mid)
        if not os.path.exists(path):
            continue
        with open(path) as f:
            g = json.load(f)
        pkg, _pfx = pkgpfx[mid]
        for m in g['meshes']:
            if m['name'].lower().endswith('_u'):
                out[mid] = instance_transform(pkg, m['name'])
                break
    return out


def collect(rows):
    """-> (table, meshes_needed, textures_needed)

    table: {itemId: {slot, bodyPart, replaces, byModel: {mid: {meshes, textures}}}}
    meshes: {(pkg, name): {'models': set(), 'slots': set()}}
    """
    table, meshes, textures = {}, {}, {}
    for e in rows:
        bp = e['body_part']
        if bp not in SLOTS:
            continue
        slot, replaces = SLOTS[bp]
        by = {}
        for key, mid, pkg, _pfx in RACE_SLOTS:
            s = e['race_slots'][key]
            ms = [m for m in s['meshes'] if m]
            ts = [t for t in s['textures'] if t]
            add = e['race_slots'].get(key + '_add') or {'meshes': [], 'textures': []}
            ms += [m for m in add['meshes'] if m]
            ts += [t for t in add['textures'] if t]
            if not ms:
                continue
            by[mid] = {'meshes': ms, 'textures': ts}
            for m in ms:
                p, n = m.split('.', 1) if '.' in m else (pkg, m)
                rec = meshes.setdefault((p, n), {'models': set(), 'slots': set()})
                rec['models'].add(mid)
                rec['slots'].add(slot)
            for t in ts:
                p, n = t.split('.', 1) if '.' in t else (None, t)
                if p:
                    textures[(p, n)] = textures.get((p, n), 0) + 1
        table[str(e['object_id'])] = {
            'slot': slot, 'bodyPart': bp, 'replaces': replaces, 'byModel': by,
        }
    return table, meshes, textures


# ------------------------------------------------------------------- export

def strip_to_mesh(g, binb, keep):
    """Keep only mesh `keep` and the skin, dropping every accessor and
    bufferView nothing else references.

    Needed because the canonical bone order is a PERMUTATION that only exists
    once a part has been added to a skeleton -- see build_meshes -- so each
    armor mesh is assembled ALONGSIDE the model's own body mesh and the body
    is thrown away afterwards.
    """
    prim = g['meshes'][keep]['primitives'][0]
    used = list(prim['attributes'].values())
    if 'indices' in prim:
        used.append(prim['indices'])
    used.append(g['skins'][0]['inverseBindMatrices'])
    order, remap = [], {}
    for a in used:
        if a not in remap:
            remap[a] = len(order)
            order.append(a)
    new_acc, new_bv, blob = [], [], bytearray()
    for a in order:
        acc = dict(g['accessors'][a])
        bv = g['bufferViews'][acc['bufferView']]
        off = bv.get('byteOffset', 0)
        data = binb[off:off + bv['byteLength']]
        while len(blob) % 4:
            blob.append(0)
        nbv = {'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data)}
        if 'byteStride' in bv:
            nbv['byteStride'] = bv['byteStride']
        if 'target' in bv:
            nbv['target'] = bv['target']
        blob += data
        acc['bufferView'] = len(new_bv)
        new_bv.append(nbv)
        new_acc.append(acc)
    prim = dict(prim)
    prim['attributes'] = {k: remap[v] for k, v in prim['attributes'].items()}
    if 'indices' in prim:
        prim['indices'] = remap[prim['indices']]
    mesh = dict(g['meshes'][keep])
    mesh['primitives'] = [prim]
    skin = dict(g['skins'][0])
    skin['inverseBindMatrices'] = remap[skin['inverseBindMatrices']]
    nodes = [dict(n) for n in g['nodes']]
    keep_node = None
    for i, n in enumerate(nodes):
        if n.get('mesh') == keep:
            keep_node = i
        n.pop('mesh', None)
        n.pop('skin', None)
    nodes[keep_node]['mesh'] = 0
    nodes[keep_node]['skin'] = 0
    # the discarded body mesh's node is left in place as an empty node: it is
    # not a bone (bones are nodes 0..n-1 and are all referenced by the skin),
    # and renumbering nodes would invalidate every joint index.
    out = {
        'asset': g['asset'], 'scene': g['scene'], 'scenes': g['scenes'],
        'nodes': nodes, 'meshes': [mesh], 'skins': [skin],
        'accessors': new_acc, 'bufferViews': new_bv,
        'materials': g.get('materials', [])[:1] or [{'name': 'armor'}],
    }
    out['meshes'][0]['primitives'][0]['material'] = 0
    return out, bytes(blob)


def umodel_export_package(pkg_name, stage):
    out = os.path.join(stage, pkg_name)
    if os.path.isdir(out):
        return out
    os.makedirs(out, exist_ok=True)
    path = _find(ANIMDIR, pkg_name.lower() + '.ukx')
    subprocess.run([UMODEL, '-export', '-out=' + out, path],
                   check=True, capture_output=True, cwd=ROOT)
    return out


def find_psk(stage_dir, name):
    want = name.lower() + '.psk'
    for dirpath, _dn, files in os.walk(stage_dir):
        for f in files:
            if f.lower() == want:
                return os.path.join(dirpath, f)
    return None


def build_meshes(meshes, report):
    """Emit one geometry-only skinned glTF per armor mesh."""
    os.makedirs(OUT, exist_ok=True)
    built, skipped = {}, []
    refs = base_transforms()
    bodies = base_body_mesh()
    mirrored = []

    # THE JOINT-ORDER TRAP.
    # A .psk carries its own bone table, and retail's tables are NOT in the
    # same order from mesh to mesh: `MFighter_m001_b` lists Weapon_L_Bone
    # before Shield_L_Bone where `MFighter_m001_u` lists them the other way,
    # and -- worse -- `_b`, `_g` and `_l` each name `Bip01_L_Finger01` TWICE
    # and never name `Bip01_R_Finger01` at all.  So a runtime bind by joint
    # INDEX would shuffle bones, and a bind by NAME would drive the right hand
    # from the left.  Neither is safe.
    # assemble.CanonicalSkeleton already solves this the only way that works:
    # it computes a STRUCTURAL permutation (parent + bind position + bind
    # rotation), not a name match.  So every armor mesh is assembled together
    # with the model's own body mesh, which seeds the canonical order, and the
    # body is stripped out afterwards -- leaving the armor's JOINTS_0 already
    # permuted into the exact order the character glTF uses.
    seed_cache = {}

    def seed_part(mid):
        if mid in seed_cache:
            return seed_cache[mid]
        names, order = bodies[mid]
        pkg = dict((r[1], r[2]) for r in RACE_SLOTS)[mid]
        stage = umodel_export_package(pkg, STAGE)
        parts = []
        for nm in names:
            p = find_psk(stage, nm)
            if p:
                parts.append({'psk': p, 'name': nm,
                              'sections': [{'texture': None,
                                            'alpha_mode': None}]})
        seed_cache[mid] = (parts or None, order)
        return seed_cache[mid]

    by_pkg = collections.defaultdict(list)
    for (p, n) in meshes:
        by_pkg[p].append(n)
    for pkg_name in sorted(by_pkg, key=str.lower):
        if _find(ANIMDIR, pkg_name.lower() + '.ukx') is None:
            skipped += [(pkg_name + '.' + n, 'no .ukx package') for n in by_pkg[pkg_name]]
            continue
        stage = umodel_export_package(pkg_name, STAGE)
        outdir = os.path.join(OUT, pkg_name)
        os.makedirs(outdir, exist_ok=True)
        for n in sorted(by_pkg[pkg_name], key=str.lower):
            psk = find_psk(stage, n)
            if not psk:
                skipped.append((pkg_name + '.' + n, 'mesh not in package'))
                continue
            xf = instance_transform(pkg_name, n)
            if xf is None:
                skipped.append((pkg_name + '.' + n, 'no ULodMesh header'))
                continue
            if any(s < 0 for s in xf[0]):
                # The mirror trap. Nothing in armorgrp hits this today; if a
                # mesh ever does, it must NOT ship under an identity node --
                # mirrored geometry needs its winding and normals flipped.
                mirrored.append((pkg_name + '.' + n, xf))
                skipped.append((pkg_name + '.' + n,
                                'negative MeshScale (mirrored): %r' % (xf[0],)))
                continue
            rec = meshes[(pkg_name, n)]
            # A body mesh must carry exactly the transform of the body it
            # replaces, for EVERY model that equips it. Accessory meshes
            # (cloak/hair) replace nothing, so there is no reference to
            # compare against -- they are built and flagged, not rendered.
            body = bool(rec['slots'] & {'chest', 'legs', 'gloves', 'feet',
                                        'fullarmor', 'alldress', 'underwear'})
            mismatched = [m for m in rec['models']
                          if m in refs and refs[m] != xf] if body else []
            if mismatched:
                skipped.append((pkg_name + '.' + n,
                                'transform %r differs from the base body of %s'
                                % (xf, sorted(mismatched)[:2])))
                continue
            base = n.lower()
            owner = model_of_mesh(pkg_name, n)
            seed, want_order = (None, None)
            if owner and owner in bodies:
                seed, want_order = seed_part(owner)
            if seed is None:
                skipped.append((pkg_name + '.' + n,
                                'no base body mesh to seed the canonical bone '
                                'order (owner=%s)' % owner))
                continue
            part = {'psk': psk, 'name': n,
                    'sections': [{'texture': None, 'alpha_mode': None}]}
            try:
                g, binb, _ctx = assemble.merge_parts(
                    seed + [part], os.path.join(outdir, base + '.gltf'))
                g, binb = strip_to_mesh(g, binb, len(g['meshes']) - 1)
            except Exception as exc:                    # noqa: BLE001
                skipped.append((pkg_name + '.' + n, 'assemble failed: %s' % exc))
                continue
            got = [g['nodes'][j]['name'] for j in g['skins'][0]['joints']]
            if got != want_order:
                # Refused rather than shipped: a mesh whose canonical order
                # still disagrees cannot be bound to the character's skeleton.
                skipped.append((pkg_name + '.' + n,
                                'canonical joint order differs from %s' % owner))
                continue
            g['buffers'] = [{'uri': base + '.bin', 'byteLength': len(binb)}]
            with open(os.path.join(outdir, base + '.bin'), 'wb') as f:
                f.write(binb)
            with open(os.path.join(outdir, base + '.gltf'), 'w') as f:
                json.dump(g, f, separators=(',', ':'))
            built[pkg_name + '.' + n] = {
                'gltf': '%s/%s.gltf' % (pkg_name, base),
                'joints': len(g['skins'][0]['joints']),
                'body': body,
                'xform': {'scale': xf[0], 'origin': xf[1], 'rot': xf[2]},
            }
    report['mesh_built'] = len(built)
    report['mesh_skipped'] = skipped
    report['mirrored'] = mirrored
    return built


def build_textures(textures, report):
    texout = os.path.join(OUT, 'tex')
    os.makedirs(texout, exist_ok=True)
    built, skipped = {}, []
    for (p, n) in sorted(textures, key=lambda x: (x[0].lower(), x[1].lower())):
        info = material_info(p, n)
        if info is None:
            skipped.append((p + '.' + n, 'material did not resolve'))
            continue
        dp, dn = info['diffuse']
        src = library_png(dp, dn)
        if src is None:
            skipped.append((p + '.' + n, 'diffuse %s.%s not in assets/library'
                            % (dp, dn)))
            continue
        rel = '%s.%s.png' % (p.lower(), n.lower())
        dst = os.path.join(texout, rel)
        if not os.path.exists(dst) or os.path.getsize(dst) != os.path.getsize(src):
            shutil.copyfile(src, dst)
        built[p + '.' + n] = {
            'png': 'tex/' + rel,
            'diffuse': '%s.%s' % (dp, dn),
            'alphaMode': info['alpha_mode'],
            'alphaCutoff': info['alpha_ref'],
            'doubleSided': info['two_sided'],
            'materialClass': info['material_class'],
        }
    report['tex_built'] = len(built)
    report['tex_skipped'] = skipped
    return built


# --------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--table', action='store_true',
                    help='write the item table only, skip mesh/texture export')
    args = ap.parse_args()

    problems = []

    def fail(msg):
        problems.append(msg)

    rows = load_armorgrp()
    verify_slot_map(rows, fail)
    table, meshes, textures = collect(rows)

    if args.check:
        return check(table, meshes, textures, problems)

    report = {}
    built_meshes = {} if args.table else build_meshes(meshes, report)
    built_tex = {} if args.table else build_textures(textures, report)

    out = {
        'slots': {str(k): {'name': v[0], 'replaces': v[1]}
                  for k, v in SLOTS.items()},
        'paperdollKeys': PAPERDOLL_KEYS,
        'models': MODEL_IDS,
        'items': table,
    }
    with open(TABLE_OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    if not args.table:
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
            json.dump({'meshes': built_meshes, 'textures': built_tex,
                       # Every mesh that was NOT shipped, with the reason.
                       # Recorded so --check can tell a deliberate refusal from
                       # a mesh that went missing silently -- the second is a
                       # defect, the first is a documented gap.
                       'refused': dict(report['mesh_skipped']),
                       'texturesRefused': dict(report['tex_skipped'])},
                      f, separators=(',', ':'))

    print('items with a slot        : %d' % len(table))
    print('distinct meshes referenced: %d' % len(meshes))
    print('distinct materials        : %d' % len(textures))
    if not args.table:
        print('meshes built              : %d (skipped %d)'
              % (report['mesh_built'], len(report['mesh_skipped'])))
        print('textures built            : %d (skipped %d)'
              % (report['tex_built'], len(report['tex_skipped'])))
        seen = collections.Counter(r for _n, r in report['mesh_skipped'])
        for r, c in seen.most_common():
            print('   mesh skip: %-50s %d' % (r[:50], c))
        seen = collections.Counter(r.split(' not in')[0]
                                   for _n, r in report['tex_skipped'])
        for r, c in seen.most_common(5):
            print('   tex  skip: %-50s %d' % (r[:50], c))
    if problems:
        for p in problems:
            print('DEFECT: %s' % p)
        return 1
    return 0


def check(table, meshes, textures, problems):
    """Assert the build products exist and agree with armorgrp."""
    ok = True

    def bad(msg):
        nonlocal ok
        print('FAIL: %s' % msg)
        ok = False

    for p in problems:
        bad(p)

    if not os.path.exists(TABLE_OUT):
        bad('%s does not exist -- run build_armor.py' % TABLE_OUT)
        return 1
    with open(TABLE_OUT) as f:
        t = json.load(f)
    if len(t.get('items', {})) != len(table):
        bad('armormesh.json has %d items, armorgrp yields %d'
            % (len(t.get('items', {})), len(table)))
    for iid, want in table.items():
        got = t['items'].get(iid)
        if got is None:
            bad('item %s missing from armormesh.json' % iid)
            break
        if got['slot'] != want['slot'] or got['byModel'] != want['byModel']:
            bad('item %s disagrees with armorgrp' % iid)
            break

    manifest_path = os.path.join(OUT, 'manifest.json')
    if not os.path.exists(manifest_path):
        bad('%s does not exist -- armor meshes were never built' % manifest_path)
        return 0 if ok else 1
    with open(manifest_path) as f:
        man = json.load(f)

    # Every mesh the table names must be either built or refused WITH A REASON.
    # A mesh that is in neither map went missing silently, which is the defect
    # this arm exists to catch.
    refused = man.get('refused', {})
    silent = [k for k in ('%s.%s' % m for m in meshes)
              if k not in man['meshes'] and k not in refused]
    if silent:
        bad('%d meshes are neither built nor refused -- they vanished: %s'
            % (len(silent), silent[:5]))
    absent = [k for k, r in refused.items() if 'not in package' in r]
    print('meshes: %d referenced, %d built, %d refused (%d absent from every '
          'client package)'
          % (len(meshes), len(man['meshes']), len(refused), len(absent)))

    # THE COMPOSITION GUARANTEE, and the reason this suite is not vacuous:
    # the four slots the server actually sends (gloves/chest/legs/feet) must
    # resolve to a BUILT mesh for every item and every model that has one.
    # A regression that dropped a whole race or a whole slot would show here
    # as a coverage collapse, not as a silent pass over an empty set.
    cov = collections.Counter()
    tot = collections.Counter()
    for _iid, row in t['items'].items():
        if row['slot'] not in ('chest', 'legs', 'gloves', 'feet', 'fullarmor'):
            continue
        for _mid, per in row['byModel'].items():
            tot[row['slot']] += 1
            if all(m in man['meshes'] for m in per['meshes']):
                cov[row['slot']] += 1
    if sum(tot.values()) < 1000:
        bad('coverage check ran over only %d model-items -- too few to mean '
            'anything; the table is probably empty' % sum(tot.values()))
    for slot in ('chest', 'legs', 'feet'):
        if tot[slot] and cov[slot] != tot[slot]:
            bad('slot %s: only %d of %d model-items resolve to a built mesh'
                % (slot, cov[slot], tot[slot]))
    for slot in ('gloves', 'fullarmor'):
        # 9 gloves and 2 full-armor model-items are refused upstream (one mesh
        # whose transform differs from its body, and meshes absent from the
        # client); anything worse is a regression.
        if tot[slot] and tot[slot] - cov[slot] > 10:
            bad('slot %s: %d of %d model-items have no built mesh'
                % (slot, tot[slot] - cov[slot], tot[slot]))
    for slot in sorted(tot):
        print('  slot %-10s %d/%d model-items resolve to a built mesh'
              % (slot, cov[slot], tot[slot]))

    # The mirror trap, re-measured every run rather than trusted.
    neg = [k for k, e in man['meshes'].items()
           if any(s < 0 for s in e['xform']['scale'])]
    if neg:
        bad('%d shipped meshes have a negative MeshScale (mirrored) and were '
            'emitted under an identity node anyway: %s' % (len(neg), neg[:3]))
    print('mirrored (negative MeshScale) meshes shipped: %d' % len(neg))

    # files on disk
    for k, e in list(man['meshes'].items())[:0] or man['meshes'].items():
        gp = os.path.join(OUT, e['gltf'])
        if not os.path.exists(gp):
            bad('%s: %s missing' % (k, e['gltf']))
            break
    for k, e in man['textures'].items():
        if not os.path.exists(os.path.join(OUT, e['png'])):
            bad('%s: %s missing' % (k, e['png']))
            break

    # the composition assertion: a known equipped set must resolve to the
    # exact meshes retail names for it.
    for iid, slot, mid, want in EXPECTED:
        row = t['items'].get(str(iid))
        if row is None:
            bad('expected item %d absent from the table' % iid)
            continue
        if row['slot'] != slot:
            bad('item %d slot is %r, expected %r' % (iid, row['slot'], slot))
        got = (row['byModel'].get(mid) or {}).get('meshes')
        if got != want:
            bad('item %d / %s meshes are %r, expected %r'
                % (iid, mid, got, want))

    # every built mesh must carry the SAME skeleton the base model does, or
    # the runtime cannot rebind it
    base = os.path.join(ROOT, 'editor/characters/models/human_fighter_m.gltf')
    if os.path.exists(base):
        with open(base) as f:
            bg = json.load(f)
        bones = [bg['nodes'][j]['name'] for j in bg['skins'][0]['joints']]
        sample = [k for k in man['meshes'] if k.startswith('Fighter.MFighter')][:25]
        if len(sample) < 5:
            bad('joint-order check had only %d meshes to look at' % len(sample))
        for k in sample:
            with open(os.path.join(OUT, man['meshes'][k]['gltf'])) as f:
                ag = json.load(f)
            ab = [ag['nodes'][j]['name'] for j in ag['skins'][0]['joints']]
            if ab != bones:
                bad('%s joint order differs from human_fighter_m' % k)
    print('OK' if ok else 'FAILED')
    return 0 if ok else 1


# Ground truth for the composition check, read straight out of armorgrp.json
# (item id, slot, model id, the meshes retail names for that pair).
EXPECTED = [
    # 21 Squire's Shirt-family chest: the newbie chest IS the creation mesh
    (21, 'chest', 'human_fighter_m', ['Fighter.MFighter_m001_u']),
    (21, 'chest', 'darkelf_f',       ['DarkElf.FDarkElf_m001_u']),
]

if __name__ == '__main__':
    sys.exit(main())
