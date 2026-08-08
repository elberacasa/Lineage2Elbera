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

chargrp.dat (editor/characters/charcreate-data.json -> creationAssets) is
used ONLY to decide WHICH meshes form the creation outfit (body meshes,
face mesh, whether hair style m000 has attached meshes). Textures come
from each mesh's OWN material slots — never from naming conventions.

Usage: /usr/bin/python3 tools/src/char_pipeline/build_characters.py [only_id ...]
"""
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

# body-part suffixes, in chargrp bodyMeshes order, plus face and the two
# hair meshes (_ah front hair, _bh back hair)
PARTS = ['_u', '_l', '_g', '_b', '_f', '_ah', '_bh']


def load_creation_bindings():
    """Mesh selection from chargrp.dat (extracted to
    editor/characters/charcreate-data.json -> creationAssets): which
    meshes form the creation outfit.  Also keeps chargrp's own texture
    references as the FALLBACK for meshes whose .ukx material slots are
    null (the game binds those textures at runtime through chargrp; many
    meshes — most female and hair meshes — carry no in-package reference,
    their psk MATT chunk then just says 'material_0').

    -> {combo_id: {suffix: {'mesh': str, 'tex': (utx_pkg, obj)|None,
                            'optional': bool}}}
    """
    path = os.path.join(OUT, 'charcreate-data.json')
    data = json.load(open(path))
    races = {r['id']: r for r in data['races']}
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
        # hair meshes (optional): offered whenever the package carries
        # them; existence-checked per combo in build_combo.  chargrp's
        # appearanceDetail.attachedMesh lists only the TINTABLE attached
        # styles — paintedOnly styles (all orc styles, darkelf/dwarf male
        # m000) still get their hair-cap meshes on the creation screen
        # (verified against official NCSoft hairstyle captures and
        # umodel renders of the caps: they are what closes the skull on
        # the mask-like _f face meshes).
        mprefix = face_mesh[:-2]           # e.g. MFighter_m000
        tprefix = face_tex[1][:-2]         # e.g. MFighter_m000_t00
        for hs in ('_ah', '_bh'):
            entry[hs] = {
                'mesh': '%s_m00%s' % (mprefix, hs),
                # hair textures are not in chargrp either; the client's
                # own naming is <faceTexPrefix>_m00_ah/_bh — used only
                # after an existence check in the .utx
                'tex': (face_tex[0], '%s_m00%s' % (tprefix, hs)),
                'optional': True}
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

    Rules (owner directive):
    - the retail chargrp binding wins; the mesh slot is only a fallback.
    - a resolved name ending in _sp is used only through its RGB channel
      (l2lib decode): never the library's *_sp export (that is the alpha
      specular mask, near-black/white — not diffuse).  If the non-_sp
      sibling exists in the library it is preferred.
    - a resolved name ending in _ori is the 'original' bitmap used by
      FinalBlend hair materials: prefer the non-suffixed sibling when
      exported, else accept the library _ori (it IS the diffuse there,
      alpha needed for hair strands).
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
}


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
    stage = os.path.join(STAGE, cid)
    if os.path.isdir(stage):
        shutil.rmtree(stage)
    parts = []
    bind = bindings[cid]
    for suffix in PARTS:
        if suffix not in bind:
            continue  # optional part dropped (e.g. painted-only hair style)
        want = bind[suffix]['mesh']
        mesh_name = want and find_ci(meshes, want)
        if not mesh_name:
            if suffix in ('_u', '_l', '_f'):
                print('  SKIP: required part %s (%s) missing' % (suffix, want))
                return None
            continue
        export_one(ukx, mesh_name, [], stage)
        psk = find_exported(stage, mesh_name, '.psk')
        if not psk:
            print('  SKIP: export of %s produced nothing' % mesh_name)
            return None
        parts.append({'suffix': suffix, 'mesh': mesh_name, 'psk': psk})

    # textures: chargrp.dat creation bindings are AUTHORITATIVE (the
    # retail creation-screen look: t00 face, t02 body sets); each mesh's
    # own .ukx material slot is only a fallback for parts chargrp does
    # not cover.  Specular (_sp) resolutions are rejected outright —
    # never a baseColor; _ori only when it is the material's only
    # export (hair FinalBlends).  PNGs come from the verified exports in
    # assets/library/<Package>/.
    ukx_pkg = load_ukx(pkg)
    tex_stage = os.path.join(stage, 'tex')
    os.makedirs(tex_stage, exist_ok=True)
    outdir = os.path.join(OUT, 'models')
    os.makedirs(outdir, exist_ok=True)
    kept = []
    for p in parts:
        data = assemble.parse_psk(p['psk'])
        sec_names = data['materials'] or ['material_0']
        slots = mesh_section_materials(ukx_pkg, p['mesh'])
        grp_tex = bind[p['suffix']].get('tex')
        if grp_tex and p['suffix'] in ('_ah', '_bh') and \
                load_utx(grp_tex[0]).find_export(grp_tex[1]) is None and \
                library_png(grp_tex[0], grp_tex[1]) is None and \
                library_png(grp_tex[0], grp_tex[1] + '_ori') is None:
            grp_tex = None
        sections = []
        dropped = False
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
            chosen = choose_texture([('chargrp', grp_tex),
                                     ('slot', slot_ref)], tex_stage)
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
            elif p['suffix'] in ('_ah', '_bh'):
                # hair part with no texture anywhere (painted styles carry
                # only the _bh cap; the retail client shows no front-hair
                # piece there) — drop the mesh rather than show a gray blob
                print('  part %-28s dropped (no hair texture exists for '
                      'this style)' % p['mesh'])
                dropped = True
                break
            else:
                print('  WARNING: %s section %d (%s): no diffuse texture '
                      'found (chargrp %s, slot %s) — neutral material'
                      % (p['mesh'], si, sname, grp_tex, slot_ref))
            sections.append({
                'texture': tex_uri,
                'alpha_mode': 'MASK' if p['suffix'] in ('_ah', '_bh')
                else None})
        if dropped:
            continue
        kept.append(p)
        p['name'] = p['mesh']
        p['sections'] = sections
    parts = kept

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
             'stances': sorted(set(k.rsplit('_', 1)[1] for k in stanced))}
    # true in-world height (L2 units) = glTF Y extent x 100 x MeshScale.z
    # decoded from the .ukx (scale_util) — the client sizes the model from
    # this, never from a hardcoded fallback
    u_mesh = next((p['mesh'] for p in parts if p['suffix'] == '_u'), None)
    nh = u_mesh and scale_util.native_height(
        out_gltf, os.path.join(CLIENT, ukx), u_mesh)
    if not nh:
        # hard fail: a missing nativeHeight silently renders the model at
        # the client's legacy 1.75 m fallback (3.8x oversized vs the L2
        # world) — 2026-08-03 bug, never let it ship silently again
        raise SystemExit('FATAL: no nativeHeight for %s (_u mesh %r) — '
                         'refusing to write a manifest entry without it'
                         % (cid, u_mesh))
    entry['nativeHeight'] = nh
    print('  nativeHeight %.1f L2 units (%s)' % (nh, u_mesh))
    return entry


def main():
    only = set(sys.argv[1:])
    bindings = load_creation_bindings()
    manifest_path = os.path.join(OUT, 'manifest.json')
    # merge into the existing manifest so single-model runs don't clobber it
    existing = {}
    if os.path.isfile(manifest_path):
        try:
            for m in json.load(open(manifest_path)).get('models', []):
                existing[m['id']] = m
        except Exception:
            pass
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
    order = [c[0] for c in COMBOS]
    models = ([existing[k] for k in order if k in existing] +
              [v for k, v in existing.items() if k not in order])
    os.makedirs(OUT, exist_ok=True)
    manifest = {'models': models}
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    print('\nmanifest: %d models -> %s' % (len(models), manifest_path))


if __name__ == '__main__':
    main()
