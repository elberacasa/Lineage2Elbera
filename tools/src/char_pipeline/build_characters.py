#!/usr/bin/env python3
"""Build web-ready character glTFs from the L2 Interlude client.

For each race/gender combo:
  1. umodel export of the creation body-part meshes from
     assets/interlude/animations/<Pkg>.ukx as .psk (full reference
     skeleton included in every part)
  2. material slots from the .ukx itself (l2lib mesh_material_slots) ->
     Shader/FinalBlend resolved to their diffuse Texture in the
     systextures .utx (l2lib resolve_material) -> umodel -png export
  3. umodel export of the <Prefix>_anim MeshAnimation as .psa
  4. assemble.py concatenates parts over the shared full skeleton (exact
     structural bone permutation, no matrix remapping), emits glTF,
     injects animations
  5. results land in editor/characters/models/, manifest.json is updated

chargrp.dat (editor/characters/charcreate-data.json -> creationAssets) selects
the creation body and face. Hair style/color zero comes from the freshly decoded
original hair table and native selectors, with explicit absent parts and exact
material-to-Texture references. This selection correction does not establish
native attachment or change the assembler's existing material render state.

Usage: /usr/bin/python3 tools/src/char_pipeline/build_characters.py [only_id ...]
"""
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
UMODEL = os.path.join(ROOT, 'tools/bin/umodel')
CLIENT = os.path.join(ROOT, 'assets/interlude')
OUT = os.path.join(ROOT, 'editor/characters')
STAGE = '/tmp/l2char_stage'

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools/l2lib'))
import anim_stances
import assemble
import scale_util
import ue2package as up

# id, race, gender, className, ukx package, mesh prefix, texture package
COMBOS = [
    ('human_fighter_m', 'Human',   'male',   'Human Fighter', 'Fighter', 'MFighter', 'MFighter'),
    ('human_fighter_f', 'Human',   'female', 'Human Fighter', 'Fighter', 'FFighter', 'FFighter'),
    ('human_mystic_m',  'Human',   'male',   'Human Mystic',  'Magic',   'MMagic',   'MMagic'),
    ('human_mystic_f',  'Human',   'female', 'Human Mystic',  'Magic',   'FMagic',   'FMagic'),
    ('elf_m',           'Elf',     'male',   'Elf',           'Elf',     'MElf',     'melf'),
    ('elf_f',           'Elf',     'female', 'Elf',           'Elf',     'FElf',     'felf'),
    ('darkelf_m',       'DarkElf', 'male',   'Dark Elf',      'DarkElf', 'MDarkElf', 'mdarkelf'),
    ('darkelf_f',       'DarkElf', 'female', 'Dark Elf',      'DarkElf', 'FDarkElf', 'fdarkelf'),
    ('orc_fighter_m',   'Orc',     'male',   'Orc Fighter',   'Orc',     'MOrc',     'MOrc'),
    ('orc_fighter_f',   'Orc',     'female', 'Orc Fighter',   'Orc',     'FOrc',     'FOrc'),
    ('orc_mystic_m',    'Orc',     'male',   'Orc Mystic',    'Shaman',  'MShaman',  'MShaman'),
    ('orc_mystic_f',    'Orc',     'female', 'Orc Mystic',    'Shaman',  'FShaman',  'FShaman'),
    ('dwarf_m',         'Dwarf',   'male',   'Dwarf',         'Dwarf',   'MDwarf',   'mdwarf'),
    ('dwarf_f',         'Dwarf',   'female', 'Dwarf',         'Dwarf',   'FDwarf',   'fdwarf'),
]

# combo id -> charcreate-data.json creationAssets key: (race id, gender, class key)
CREATION_KEY = {
    'human_fighter_m': ('human', 'male', 'fighter'),
    'human_fighter_f': ('human', 'female', 'fighter'),
    'human_mystic_m':  ('human', 'male', 'mage'),
    'human_mystic_f':  ('human', 'female', 'mage'),
    'elf_m':           ('elf', 'male', 'fighter'),
    'elf_f':           ('elf', 'female', 'fighter'),
    'darkelf_m':       ('darkelf', 'male', 'fighter'),
    'darkelf_f':       ('darkelf', 'female', 'fighter'),
    'orc_fighter_m':   ('orc', 'male', 'fighter'),
    'orc_fighter_f':   ('orc', 'female', 'fighter'),
    'orc_mystic_m':    ('orc', 'male', 'mage'),
    'orc_mystic_f':    ('orc', 'female', 'mage'),
    'dwarf_m':         ('dwarf', 'male', 'fighter'),
    'dwarf_f':         ('dwarf', 'female', 'fighter'),
}

# Body-part output suffixes plus the two original hair part slots.
PARTS = ['_u', '_l', '_g', '_b', '_f', '_ah', '_bh']


def default_hair_bindings(catalog, model_packages):
    """Select base style/color zero from source records, never asset existence.

    Pure admission helper. ``collect`` supplies freshly decoded source tables
    and exact material graph identities, without built glTFs or image sidecars.
    Empty parts remain records; missing required source data raises an error.
    """
    if catalog.get('format') != 'l2-interlude-player-hair-v1':
        raise ValueError('unsupported original hair catalog')
    result = {}
    for model, expected_package in model_packages.items():
        slots = [row for row in catalog.get('models', {}).get(model, {}).get('slots', []) if row.get('index') == 0]
        if len(slots) != 1:
            raise ValueError('missing or ambiguous default source hair style: ' + model)
        parts = slots[0].get('parts', [])
        if len(parts) != 2 or {part.get('part') for part in parts} != {1, 2}:
            raise ValueError('missing or ambiguous source hair parts: ' + model)
        entry = {}
        for part in parts:
            number = part['part']
            if part.get('nativeSlot') != (5 if number == 1 else 4):
                raise ValueError('source hair native slot mismatch: ' + model)
            suffix = '_ah' if number == 1 else '_bh'
            status = part.get('status')
            if status == 'source-absent':
                entry[suffix] = {'sourceStatus': status, 'mesh': None, 'tex': None}
                continue
            if status != 'source-present':
                raise ValueError('unresolved source hair part: ' + model)
            mesh_ref = part.get('mesh', '')
            mesh_fields = mesh_ref.split('.')
            mesh = catalog.get('meshes', {}).get(mesh_ref)
            if len(mesh_fields) != 2 or mesh_fields[0].casefold() != expected_package.casefold() or not mesh:
                raise ValueError('missing or incompatible source hair mesh: ' + model)
            material_slots = mesh.get('materialSlots')
            if not isinstance(material_slots, list) or len(material_slots) != 1 or \
                    material_slots[0].get('textureIndex') != 0 or material_slots[0].get('polyFlags') != 0:
                raise ValueError('unsupported original hair material slots: ' + mesh_ref)
            colors = [color for color in part.get('colors', []) if color.get('index') == 0]
            if len(colors) != 1:
                raise ValueError('missing or ambiguous default hair color: ' + model)
            material_ref = colors[0].get('material')
            texture_ref = material_ref
            seen = set()
            while True:
                if not isinstance(texture_ref, str) or texture_ref in seen:
                    raise ValueError('missing or cyclic original hair material')
                seen.add(texture_ref)
                node = catalog.get('materials', {}).get(texture_ref)
                if not node:
                    raise ValueError('missing original hair material: ' + texture_ref)
                if node.get('class') == 'Texture':
                    break
                if node.get('class') != 'FinalBlend':
                    raise ValueError('unsupported original hair material: ' + texture_ref)
                texture_ref = node.get('properties', {}).get('Material', {}).get('reference')
            if any(not re.fullmatch(r'[a-f0-9]{64}', value or '') for value in
                   (mesh.get('sourceExportSHA256'), node.get('sourceExportSHA256'))):
                raise ValueError('missing original hair export fingerprint')
            package, separator, _name = texture_ref.partition('.')
            if not separator or not _name:
                raise ValueError('unqualified original hair texture')
            material_package, _, material_name = material_ref.partition('.')
            entry[suffix] = {'sourceStatus': status, 'mesh': mesh_fields[1],
                'sourceMesh': mesh_ref, 'meshExportSHA256': mesh['sourceExportSHA256'],
                'tex': (material_package, material_name), 'sourceMaterial': material_ref,
                'sourceTexture': texture_ref, 'textureExportSHA256': node['sourceExportSHA256']}
        result[model] = entry
    return result


def load_default_hair_bindings():
    sys.path[:0] = [os.path.join(ROOT, 'tools/dat'), os.path.join(ROOT, 'tools/ui')]
    from build_hair import collect
    catalog, _sources = collect()
    return default_hair_bindings(catalog, {combo[0]: combo[4] for combo in COMBOS})


def load_creation_bindings():
    """Mesh selection from chargrp.dat (extracted to
    editor/characters/charcreate-data.json -> creationAssets): which
    meshes form the creation outfit.  Also keeps chargrp's own texture
    references as the FALLBACK for meshes whose .ukx material slots are
    null (the game binds those textures at runtime through chargrp; many
    meshes carry no in-package reference,
    their psk MATT chunk then just says 'material_0').

    Hair uses the separate freshly decoded original base style/color-zero
    bindings. Explicit source absence is distinct from missing source assets.
    """
    path = os.path.join(OUT, 'charcreate-data.json')
    data = json.load(open(path))
    races = {r['id']: r for r in data['races']}
    hair = load_default_hair_bindings()
    table = {}
    for cid, (race_id, gender, cls) in CREATION_KEY.items():
        race = races[race_id]
        ca = race['creationAssets'][gender][cls]
        face_mesh = ca['faceMesh'][0].split('.')[-1]
        face_tex = ca['faceTextures'][0].split('.')
        entry = {'_f': {'mesh': face_mesh, 'tex': (face_tex[0], face_tex[1])}}
        for suffix, mref, tref in zip(('_u', '_l', '_g', '_b'),
                                      ca['bodyMeshes'], ca['bodyTextures']):
            tp, tn = tref.split('.')
            entry[suffix] = {'mesh': mref.split('.')[-1], 'tex': (tp, tn)}
        entry.update(hair[cid])
        table[cid] = entry
    return table


# ------------------------------------------------------------ l2lib helpers

PKG_CACHE = {}


def load_ukx(pkg):
    key = pkg.lower()
    if key not in PKG_CACHE:
        p, _proto = up.load_package(
            os.path.join(CLIENT, 'animations/%s.ukx' % pkg))
        PKG_CACHE[key] = p
    return PKG_CACHE[key]


UTX_CACHE = {}


def find_utx(texpkg):
    """-> path of <texpkg>.utx, case-insensitive.

    systextures/ first (where every character/monster texture package
    lives), then textures/ -- a handful of npcgrp refs name a MAP texture
    package that the client ships under textures/ instead, e.g.
    core_m00 -> dion_curumadungeon_t.  Searching the second directory is
    additive: it only runs when systextures/ has no such package, so no
    existing binding can change."""
    want = texpkg.lower() + '.utx'
    for sub in ('systextures', 'textures'):
        d = os.path.join(CLIENT, sub)
        if not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            if f.lower() == want:
                return '%s/%s' % (sub, f)
    raise RuntimeError('texture package %s not found' % texpkg)


def load_utx(texpkg):
    key = texpkg.lower()
    if key not in UTX_CACHE:
        p, _proto = up.load_package(os.path.join(CLIENT, find_utx(texpkg)))
        UTX_CACHE[key] = p
    return UTX_CACHE[key]


def source_hair_export(package, reference, kind, expected_sha):
    """Resolve and fingerprint the exact qualified export, including its group."""
    sys.path.insert(0, os.path.join(ROOT, 'tools/dat'))
    from build_hair import qualified
    if not isinstance(reference, str) or '.' not in reference or \
            not re.fullmatch(r'[a-f0-9]{64}', expected_sha or ''):
        raise ValueError('missing original hair export identity')
    package_name = reference.split('.', 1)[0]
    matches = [e for e in package.exports if package.class_name_of(e) == kind
               and qualified(package, e, package_name).casefold() == reference.casefold()]
    if len(matches) != 1:
        raise ValueError('missing or ambiguous original hair export: ' + reference)
    export = matches[0]
    start, end = export.serial_offset, export.serial_offset + export.serial_size
    if not 0 <= start < end <= len(package.data) or \
            hashlib.sha256(package.data[start:end]).hexdigest() != expected_sha:
        raise ValueError('original hair export fingerprint differs: ' + reference)
    return export


def required_hair_mesh(binding, package, listed_meshes):
    """Explicit source absence skips a part; every present part must export."""
    if not binding or binding.get('sourceStatus') not in ('source-absent', 'source-present'):
        raise ValueError('missing original hair part binding')
    if binding['sourceStatus'] == 'source-absent':
        if binding.get('mesh') is not None or binding.get('tex') is not None:
            raise ValueError('conflicting absent original hair part')
        return None
    export = source_hair_export(package, binding.get('sourceMesh'), 'SkeletalMesh',
                                binding.get('meshExportSHA256'))
    name = package.export_name(export)
    matches = [m for m in listed_meshes if m.casefold() == name.casefold()]
    if len(matches) != 1 or not isinstance(binding.get('mesh'), str) or binding['mesh'].casefold() != name.casefold():
        raise ValueError('required original hair mesh unavailable to exporter: ' + name)
    return matches[0]


def choose_source_hair_texture(binding, tmp_dir):
    """Decode the selected original Texture's RGBA; no library/sibling fallback.

    The exact source graph was resolved when reading the hair table. This only
    preserves its mip-zero pixels; the existing assembler's material state and
    hair attachment are separate, unresolved parts of that pipeline.
    """
    if binding.get('sourceStatus') != 'source-present':
        raise ValueError('no present original hair texture binding')
    reference = binding.get('sourceTexture')
    if not isinstance(reference, str) or '.' not in reference:
        raise ValueError('missing original hair texture identity')
    package = load_utx(reference.split('.', 1)[0])
    export = source_hair_export(package, reference, 'Texture', binding.get('textureExportSHA256'))
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    from l2lib import textures as tx
    width, height, rgba, _info = tx.extract_texture_rgba(package, export)
    path = os.path.join(tmp_dir, 'hair-' + binding['textureExportSHA256'] + '.png')
    tx.write_png(path, width, height, rgba)
    return ('hairgrp', binding['tex'], reference, path, [])


def mesh_section_materials(ukx_pkg, mesh_name):
    """The mesh's OWN material bindings, from its .ukx material slots.

    -> [ (utx_pkg, object_name) per mesh section ] (None entries allowed).
    Object names are material objects in the systextures .utx (Texture,
    Shader, FinalBlend, ...); callers resolve them to diffuse Textures.
    """
    ex = ukx_pkg.find_export(mesh_name)
    if ex is None:
        raise RuntimeError('mesh %s not in %s' % (mesh_name, ukx_pkg.path))
    _ver, tex_refs, mats = up.mesh_material_slots(ukx_pkg, ex)
    return [tex_refs[m] if 0 <= m < len(tex_refs) else None for m in mats]


def find_material_export(pkg, obj_name):
    """-> the MATERIAL export named obj_name, not a same-named group.

    A few L2 texture packages carry a `Package` (group) export and a
    material export with the SAME name, the group being the container of
    the material family: LineageMonstersTex3 has `Drake_Raid_t00`
    (Package) whose children are `Drake_Raid_t00_sp` (Texture),
    `Drake_Raid_t00` (Shader), `Drake_Raid_t01` (FinalBlend), ...
    `find_export` returns whichever comes first in the export table, so a
    plain lookup can hand back the group.  A group has no bitmap and no
    Diffuse/Material property; the material with the same name is the
    object npcgrp's reference means.  Only Package exports are skipped --
    nothing is chosen by similarity."""
    ex = pkg.find_export(obj_name)
    if ex is not None and pkg.class_name_of(ex) != 'Package':
        return ex
    want = obj_name.lower()
    for e in pkg.exports:
        if (pkg.export_name(e) or '').lower() == want and \
                pkg.class_name_of(e) != 'Package':
            return e
    return ex


def resolve_diffuse(texpkg, obj_name):
    """Resolve a material object in a systextures package to the name of
    its underlying diffuse Texture export (Shader/FinalBlend/TexModifier
    chains followed by l2lib resolve_material)."""
    pkg = load_utx(texpkg)
    ex = find_material_export(pkg, obj_name)
    if ex is None:
        raise RuntimeError('%s not found in %s' % (obj_name, texpkg))
    if pkg.class_name_of(ex) == 'Texture':
        return pkg.export_name(ex)
    tex = up.resolve_material(pkg, ex)
    if tex is None:
        raise RuntimeError('%s.%s does not resolve to a Texture'
                           % (texpkg, obj_name))
    return pkg.export_name(tex)


# ------------------------------------------------------- texture PNG sourcing

LIBRARY = os.path.join(ROOT, 'assets/library')
_LIBRARY_INDEX = None


def library_index():
    """-> {package_name_lower: {texture_name_lower: rel_png_path}} from
    assets/library/manifest.json (the verified texture exports)."""
    global _LIBRARY_INDEX
    if _LIBRARY_INDEX is None:
        with open(os.path.join(LIBRARY, 'manifest.json')) as f:
            m = json.load(f)
        _LIBRARY_INDEX = {
            p['package'].lower(): {t['name'].lower(): t['png']
                                   for t in p['textures']}
            for p in m}
    return _LIBRARY_INDEX


def library_png(texpkg, texname):
    """-> absolute path of the library PNG for (package, texture), or None."""
    rel = library_index().get(texpkg.lower(), {}).get(texname.lower())
    if rel:
        path = os.path.join(LIBRARY, rel)
        if os.path.isfile(path):
            return path
    return None


def _png_mean_luminance(path):
    """Mean luminance (0-255) of opaque pixels of a non-interlaced
    8-bit RGB/RGBA PNG.  Returns None when undecodable."""
    import zlib
    data = open(path, 'rb').read()
    if not data.startswith(b'\x89PNG'):
        return None
    pos = 8
    idat = b''
    w = h = ct = None
    interlace = 1
    while pos < len(data):
        ln, typ = struct.unpack('>I4s', data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, bd, ct, _cm, _fm, interlace = struct.unpack('>IIBBBBB', chunk[:13])
            if bd != 8 or ct not in (2, 6) or interlace:
                return None
        elif typ == b'IDAT':
            idat += chunk
        pos += 12 + ln
    if not idat:
        return None
    raw = zlib.decompress(idat)
    ch = 4 if ct == 6 else 3
    stride = w * ch
    prev = bytearray(stride)
    total = count = 0

    def paeth(a, b, c):
        p = a + b - c
        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
        return a if pa <= pb and pa <= pc else (b if pb <= pc else c)

    i = 0
    for _y in range(h):
        f = raw[i]
        i += 1
        row = bytearray(raw[i:i + stride])
        i += stride
        for x in range(stride):
            a = row[x - ch] if x >= ch else 0
            b = prev[x]
            c = prev[x - ch] if x >= ch else 0
            if f == 1:
                row[x] = (row[x] + a) & 255
            elif f == 2:
                row[x] = (row[x] + b) & 255
            elif f == 3:
                row[x] = (row[x] + (a + b) // 2) & 255
            elif f == 4:
                row[x] = (row[x] + paeth(a, b, c)) & 255
        for x in range(w):
            if ch == 3 or row[x * 4 + 3] >= 128:
                total += (row[x * ch] * 299 + row[x * ch + 1] * 587 +
                          row[x * ch + 2] * 114) // 1000
                count += 1
        prev = row
    return (total / count) if count else None


def decode_texture_png(texpkg, texname, out_path, keep_alpha=False):
    """Decode a texture straight from the .utx with l2lib and write it as
    PNG.  Used when the resolved diffuse only exists as a *_sp texture:
    in L2 those are DXT3 textures with the DIFFUSE in RGB and a specular
    mask in alpha (verified channel-by-channel, e.g.
    MFighter_m001_t01_u_sp / _t02_l_sp).  The assets/library exports of
    *_sp textures show the alpha mask instead, so we decode RGB ourselves
    and force alpha opaque (unless keep_alpha)."""
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    from l2lib import textures as tx
    pkg = load_utx(texpkg)
    ex = find_material_export(pkg, texname)
    if ex is None:
        return False
    w, h, rgba, _info = tx.extract_texture_rgba(pkg, ex)
    if not keep_alpha:
        rgba = bytearray(rgba)
        for i in range(3, len(rgba), 4):
            rgba[i] = 255
        rgba = bytes(rgba)
    tx.write_png(out_path, w, h, rgba)
    return True


def choose_texture(candidates, tmp_dir):
    """Pick the diffuse texture for a part section.

    candidates: [(source, (utx_pkg, obj_name)|None), ...] in precedence
    order (chargrp first, mesh slot as fallback).  Resolves each
    candidate's material to its diffuse Texture and returns
    (source, ref, texname, png_path, notes).

    Legacy non-hair rules (hair bypasses this resolver):
    - the retail chargrp binding wins; the mesh slot is only a fallback.
    - a resolved name ending in _sp is used only through its RGB channel
      (l2lib decode): never the library's *_sp export (that is the alpha
      specular mask, near-black/white — not diffuse).  If the non-_sp
      sibling exists in the library it is preferred.
    - the historical _ori sibling substitution below is an unverified
      non-hair compatibility rule. Source-selected hair never uses it.
    """
    for source, ref in candidates:
        if not ref or not ref[0]:
            continue
        notes = []
        try:
            name = resolve_diffuse(ref[0], ref[1])
        except Exception:
            name = None
        if name is None:
            # material object missing/unresolvable in the utx; maybe the
            # reference IS already the plain texture name
            name = ref[1]
            if library_png(ref[0], name) is None:
                continue
        low = name.lower()
        png = None
        if low.endswith('_sp'):
            sib = name[:-3]
            png = library_png(ref[0], sib)
            if png:
                notes.append('%s is specular-alpha variant; using diffuse '
                             'sibling %s' % (name, sib))
                name = sib
            else:
                # decode the diffuse RGB ourselves (see decode_texture_png)
                out = os.path.join(tmp_dir, name + '.png')
                if decode_texture_png(ref[0], name, out):
                    png = out
                    notes.append('%s exists only as specular-alpha variant; '
                                 'decoded diffuse RGB from .utx' % name)
                else:
                    notes.append('%s unresolvable in .utx' % name)
                    continue
        else:
            if low.endswith('_ori'):
                sib = name[:-4]
                png = library_png(ref[0], sib)
                if png:
                    name = sib
                else:
                    notes.append('keeping %s (only export of this material)'
                                 % name)
            if png is None:
                png = library_png(ref[0], name)
                if png is None:
                    # plain name not exported to the library; decode from
                    # the .utx directly (same data, verified decoder)
                    out = os.path.join(tmp_dir, name + '.png')
                    if decode_texture_png(ref[0], name, out,
                                          keep_alpha=low.endswith('_ori')):
                        png = out
                        notes.append('%s not in library; decoded from .utx'
                                     % name)
                    else:
                        continue
        return source, ref, name, png, notes
    return None


# FROZEN CLIP NAMES.  editor/world/ addresses these 14 by name; they are
# the unarmed/legacy set and must keep resolving to exactly what they
# resolved to before stances existed.  Never rename or drop one — the
# per-weapon clips are ADDED alongside them (see anim_stances.py), never
# in place of them.  First candidate that exists wins.
ANIM_CANDIDATES = {
    'idle':   ['Wait_Hand_{P}', 'Wait_1HS_{P}', 'SitWait_{P}'],
    'walk':   ['Walk_Hand_{P}', 'Walk_1HS_{P}'],
    'run':    ['Run_Hand_{P}', 'Run_1HS_{P}'],
    'sit':    ['SitWait_{P}'],
    'sitDown': ['Sit_{P}'],
    'standUp': ['Stand_{P}'],
    'dance':  ['Social_dance_{P}'],
    'attack': ['Atk01_Hand_{P}', 'Atk01_1HS_{P}'],
    'castShort':  ['CastShort_{P}'],
    'castMid':    ['CastMid_{P}'],
    'castLong':   ['CastLong_{P}'],
    'magicThrow': ['MagicThrow_{P}'],
    'spAtk01': ['SpAtk01_1HS_{P}', 'SpAtk02_1HS_{P}', 'SpAtk06_Hand_{P}'],
    'spAtk02': ['SpAtk02_1HS_{P}', 'SpAtk02_Bow_{P}', 'SpAtk01_2HS_{P}'],
    'die':    ['Death_{P}'],
    # FShaman ships the retail-typo'd 'damegefly_FShaman' — kept as a
    # second-chance fallback (first-hit-wins, so other races are unaffected)
    'damage': ['Damagefly_{P}', 'Damegefly_{P}'],
    # Exact additional slots verified against original .int and PSA.
    'castEnd':    ['CastEnd_{P}'],
    'magicShot':  ['MagicShot_{P}'],
    'magicNoTarget': ['MagicNoTarget_{P}'],
    'picItem':    ['PicItem_{P}'],
}

# ---------------------------------------------------------- social emotes
#
# actionname.dat defines twelve emotes (its `type` field, 2..13, is the
# SocialAction id the server broadcasts) and retail ships a clip for each.
# Only 'dance' above was ever extracted, so eleven of the twelve had no
# animation to play.
#
# The actionId -> clip mapping is NOT inferred from the names.  Engine.Pawn
# declares `var localized name PcSocialAnimName[20]` and the client indexes it
# with the SocialAction id; the values live in system/lineagewarrior.int, one
# section per race/gender prefix.  tools/anim/creature_anim_table.py decrypts
# that and writes tools/anim/social_actions.json:
#
#   [MFighter] PcSocialAnimName[2]=Social_Nod_MFighter
#              PcSocialAnimName[3]=Social_Victory_MFighter
#              PcSocialAnimName[4]=Social_Atk_MFighter        ... through [13]
#
# so "Greeting is a nod" and "Advance is Social_Atk" are the client's answers,
# not this file's guesses.  All 14 prefixes carry all twelve.
_SOCIAL = None


def social_clips(prefix):
    """-> {actionType(str): psa_clip_name} for a race/gender prefix, from the
    decoded PcSocialAnimName table.  {} when the table is missing."""
    global _SOCIAL
    if _SOCIAL is None:
        p = os.path.join(ROOT, 'tools/anim/social_actions.json')
        try:
            _SOCIAL = json.load(open(p))['prefixes']
        except Exception as e:
            print('  note: no social action table (%s) — emotes limited to '
                  "the legacy 'dance' clip" % e)
            _SOCIAL = {}
    return _SOCIAL.get(prefix.lower(), {})


def social_slot(clip, prefix):
    """'Social_waiting_a_MFighter' -> 'social_waiting_a' (the glTF clip name).

    Derived from the retail clip name itself, so a race whose set is spelled
    differently still lands on the same slot as long as the client points at
    it; nothing here invents a name."""
    base = clip
    if base.lower().endswith('_' + prefix.lower()):
        base = base[:-(len(prefix) + 1)]
    return 'social_' + base[len('Social_'):].lower() \
        if base.lower().startswith('social_') else 'social_' + base.lower()


def umodel(args, **kw):
    r = subprocess.run([UMODEL, '-game=l2'] + args, cwd=CLIENT,
                       capture_output=True, text=True, **kw)
    return r


def list_objects(pkg_path):
    """-> {class: [names]} for a package inside the client dir."""
    r = umodel(['-list', pkg_path])
    out = {}
    for line in r.stdout.splitlines():
        m = re.match(r'\s*\d+\s+[0-9A-Fa-f]+\s+[0-9A-Fa-f]+\s+(\w+)\s+(.+)$', line)
        if m:
            out.setdefault(m.group(1), []).append(m.group(2).strip())
    return out


def find_ci(names, want):
    for n in names:
        if n.lower() == want.lower():
            return n
    return None


def export_one(pkg_path, obj, extra, outdir):
    os.makedirs(outdir, exist_ok=True)
    r = umodel(['-export', '-out=%s' % outdir] + extra + [pkg_path, obj])
    if r.returncode != 0:
        raise RuntimeError('umodel export failed for %s: %s' % (obj, r.stderr[-300:]))


def find_exported(outdir, basename, ext):
    for dirpath, _dirs, files in os.walk(outdir):
        for f in files:
            if f.lower() == (basename + ext).lower():
                return os.path.join(dirpath, f)
    return None


def build_combo(cid, race, gender, cname, pkg, prefix, texpkg, bindings):
    ukx = 'animations/%s.ukx' % pkg
    print('== %s (%s %s) ==' % (cid, race, gender))

    meshes = list_objects(ukx).get('SkeletalMesh', [])
    bind = bindings[cid]
    ukx_pkg = load_ukx(pkg)
    hair_meshes = {suffix: required_hair_mesh(bind.get(suffix), ukx_pkg, meshes)
                   for suffix in ('_ah', '_bh')}
    stage = os.path.join(STAGE, cid)
    if os.path.isdir(stage):
        shutil.rmtree(stage)
    parts = []
    for suffix in PARTS:
        is_hair = suffix in hair_meshes
        if is_hair and hair_meshes[suffix] is None:
            continue  # Native table explicitly omits this part.
        if suffix not in bind:
            continue
        want = bind[suffix]['mesh']
        mesh_name = hair_meshes[suffix] if is_hair else want and find_ci(meshes, want)
        if not mesh_name:
            if suffix in ('_u', '_l', '_f'):
                print('  SKIP: required part %s (%s) missing' % (suffix, want))
                return None
            continue
        export_one(ukx, mesh_name, [], stage)
        psk = find_exported(stage, mesh_name, '.psk')
        if not psk:
            if is_hair:
                raise ValueError('required original hair mesh produced no PSK: ' + mesh_name)
            print('  SKIP: export of %s produced nothing' % mesh_name)
            return None
        parts.append({'suffix': suffix, 'mesh': mesh_name, 'psk': psk})

    # Body/face keep the existing chargrp/slot resolver. Hair must decode the
    # exact source graph's Texture even when a similarly named library PNG
    # exists. An unavailable required hair asset fails the build.
    tex_stage = os.path.join(stage, 'tex')
    os.makedirs(tex_stage, exist_ok=True)
    outdir = os.path.join(OUT, 'models')
    os.makedirs(outdir, exist_ok=True)
    for p in parts:
        data = assemble.parse_psk(p['psk'])
        sec_names = data['materials'] or ['material_0']
        if p['suffix'] in hair_meshes and len(sec_names) != 1:
            raise ValueError('source hair single material slot differs from exported PSK: ' + p['mesh'])
        slots = mesh_section_materials(ukx_pkg, p['mesh'])
        grp_tex = bind[p['suffix']].get('tex')
        sections = []
        for si, sname in enumerate(sec_names):
            slot_ref = None
            if len(sec_names) == 1 and slots:
                slot_ref = slots[0]
            else:
                # multi-section: match the ukx slot by object name
                for r_ in slots:
                    if r_ and r_[1].lower() == sname.lower():
                        slot_ref = r_
                        break
                if slot_ref is None and si < len(slots):
                    slot_ref = slots[si]
            chosen = (choose_source_hair_texture(bind[p['suffix']], tex_stage)
                      if p['suffix'] in hair_meshes else
                      choose_texture([('chargrp', grp_tex), ('slot', slot_ref)], tex_stage))
            tex_uri = None
            if chosen:
                source, ref, resolved, png, notes = chosen
                for n in notes:
                    print('    note: %s' % n)
                tex_uri = '%s%s%s.png' % (
                    cid, p['suffix'],
                    '' if len(sec_names) == 1 else '_s%d' % si)
                with open(png, 'rb') as fsrc, \
                        open(os.path.join(outdir, tex_uri), 'wb') as fdst:
                    fdst.write(fsrc.read())
                lum = _png_mean_luminance(png)
                lum_s = ('%.0f' % lum) if lum is not None else '?'
                if lum is not None and lum < 25:
                    print('    note: %s is dark (mean luminance %.0f) — '
                          'kept (retail look may be genuinely dark)'
                          % (resolved, lum))
                print('  part %-28s %-7s %s.%s -> tex %s (lum %s)'
                      % (p['mesh'], source, ref[0], ref[1], resolved,
                         lum_s))
            else:
                print('  WARNING: %s section %d (%s): no diffuse texture '
                      'found (chargrp %s, slot %s) — neutral material'
                      % (p['mesh'], si, sname, grp_tex, slot_ref))
            sections.append({
                'texture': tex_uri,
                'alpha_mode': 'MASK' if p['suffix'] in ('_ah', '_bh')
                else None})
        p['name'] = p['mesh']
        p['sections'] = sections

    # animations
    anim_obj = find_ci(list_objects(ukx).get('MeshAnimation', []), '%s_anim' % prefix)
    if not anim_obj:
        print('  SKIP: no MeshAnimation %s_anim' % prefix)
        return None
    export_one(ukx, anim_obj, [], stage)
    psa = find_exported(stage, anim_obj, '.psa')
    bones, anims = assemble.parse_psa(psa)
    names_ci = {n.lower(): n for n in anims}
    selection = {}
    for anim_id, cands in ANIM_CANDIDATES.items():
        for c in cands:
            hit = names_ci.get(c.format(P=prefix).lower())
            if hit:
                selection[anim_id] = hit
                break
    if 'idle' not in selection:
        print('  SKIP: no idle animation found')
        return None
    legacy = sorted(selection)
    # ADD every per-weapon stance clip the package actually ships
    # (idle_1hs, run_bow, atk01_dual, ...).  Never overwrites a frozen
    # name: stance clip names all carry a '_<stance>' suffix that no
    # frozen name has.
    stanced = anim_stances.stance_clips(list(anims), prefix)
    for k, v in stanced.items():
        if k in selection:
            raise SystemExit('FATAL: stance clip %s would overwrite the '
                             'frozen clip of the same name' % k)
        selection[k] = v

    # ADD the twelve social emotes, keyed by the SocialAction id the server
    # broadcasts (see social_clips).  Appended AFTER the frozen and stance
    # names so the glTF animation ORDER is unchanged for everything that
    # already existed -- entities.js mapAnimations resolves several slots by
    # first-key-that-contains-a-word (find('attack','atk','hit')), and
    # 'social_atk' must never be reachable before 'attack'.
    by_clip = {v.lower(): k for k, v in selection.items()}
    social_actions, missing_emotes = {}, []
    for atype, clip in sorted(social_clips(prefix).items(), key=lambda kv: int(kv[0])):
        hit = names_ci.get(clip.lower())
        if not hit:
            missing_emotes.append((atype, clip))
            continue
        if hit.lower() in by_clip:
            # type 12 is Social_dance_<P>, already carried by the frozen
            # 'dance' clip -- point the action at that rather than paying for
            # a second copy of the same keyframes.
            social_actions[atype] = by_clip[hit.lower()]
            continue
        slot = social_slot(hit, prefix)
        if slot in selection:
            raise SystemExit('FATAL: emote clip %s would overwrite %s'
                             % (hit, slot))
        selection[slot] = hit
        by_clip[hit.lower()] = slot
        social_actions[atype] = slot
    if missing_emotes:
        print('  WARNING: %d emote clips named by PcSocialAnimName are not in '
              '%s: %s' % (len(missing_emotes), anim_obj, missing_emotes))
    print('  emotes: %d of 12 SocialAction types resolve (%s)'
          % (len(social_actions),
             ', '.join('%s=%s' % kv for kv in sorted(
                 social_actions.items(), key=lambda kv: int(kv[0])))))
    print('  anims: %d frozen (%s) + %d stanced across %s'
          % (len(legacy), ', '.join(legacy), len(stanced),
             ', '.join(sorted(set(k.rsplit('_', 1)[1]
                                  for k in stanced)))))

    # assemble
    out_gltf = os.path.join(outdir, '%s.gltf' % cid)
    g, bin_data, ctx = assemble.merge_parts(parts, out_gltf)
    bin_data = assemble.inject_animations(g, bin_data, psa, selection, ctx)
    g['buffers'][0]['byteLength'] = len(bin_data)
    with open(out_gltf, 'w') as f:
        json.dump(g, f)
    with open(out_gltf.replace('.gltf', '.bin'), 'wb') as f:
        f.write(bin_data)
    print('  -> %s (%d anims, %d parts)' % (out_gltf, len(g['animations']), len(parts)))
    entry = {'id': cid, 'race': race, 'gender': gender, 'className': cname,
             'gltf': 'models/%s.gltf' % cid,
             'animations': sorted(selection.keys()),
             # which stance suffixes this model carries a full locomotion
             # set for; the client joins this with stances.json
             'stances': sorted(set(k.rsplit('_', 1)[1] for k in stanced)),
             # SocialAction id -> glTF clip name, straight from the client's
             # own PcSocialAnimName table.  The runtime reads msg.actionId
             # off the socialAction broadcast and looks it up here; before
             # this existed every emote played 'dance'.
             'socialActions': social_actions}
    # Exact original local scale, with all actual built parts checked against
    # source bindings and mesh fields. A rounded silhouette is a measurement,
    # never the input from which runtime visual scale should be recovered.
    sys.path.insert(0, os.path.join(ROOT, 'tools/dat'))
    from export_player_visuals import player_visual_record, exact_browser_scale
    entry['visualScale'] = player_visual_record(entry)
    visual = entry['visualScale']
    axes = exact_browser_scale(visual['drawScale'], visual['drawScale3D'], visual['meshScale'])
    entry['nativeHeight'] = round(scale_util.gltf_y_extent(out_gltf) * 100 * axes[1], 1)
    print('  original per-axis visual scale %s; measured height %.1f L2 units' % (axes, entry['nativeHeight']))
    return entry


def main():
    only = set(sys.argv[1:])
    bindings = load_creation_bindings()
    manifest_path = os.path.join(OUT, 'manifest.json')
    # merge into the existing manifest so single-model runs don't clobber it
    existing = {}
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path) as source:
                previous_models = json.load(source).get('models', [])
            for m in previous_models:
                existing[m['id']] = m
        except Exception:
            pass
    succeeded = 0
    failed = 0
    for combo in COMBOS:
        if only and combo[0] not in only:
            continue
        try:
            m = build_combo(*combo, bindings)
        except Exception as e:
            print('  FAILED: %s' % e)
            m = None
        if m:
            # merge, don't replace: keys a rebuild doesn't produce (e.g. an
            # earlier measure_scale.py enrichment) must survive
            existing[m['id']] = {**existing.get(m['id'], {}), **m}
            succeeded += 1
        else:
            failed += 1
    # Keep the previous manifest byte-for-byte when nothing was rebuilt. A
    # missing required source part is a failed request, even if an older model
    # is available. Partial successes are retained, but still report failure.
    if not succeeded:
        return 1 if failed else 0
    order = [c[0] for c in COMBOS]
    models = ([existing[k] for k in order if k in existing] +
              [v for k, v in existing.items() if k not in order])
    os.makedirs(OUT, exist_ok=True)
    manifest = {'models': models}
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    print('\nmanifest: %d models -> %s' % (len(models), manifest_path))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
