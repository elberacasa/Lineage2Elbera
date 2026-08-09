#!/usr/bin/env python3
"""Build web-ready monster/NPC glTFs from the L2 Interlude client.

Reuses the proven full-skeleton psk pipeline (assemble.py) on
assets/interlude/animations/LineageMonsters*.ukx and LineageNpcs.ukx.

- mesh/texture bindings for MONSTERS come from npcgrp.dat (decoded to
  assets/gamedata/npcgrp.json): npcId -> mesh + texture refs.
- MONSTER animations: the package's <mesh>_anim MeshAnimation -> .psa,
  with L2 monster anim names mapped to the frozen client contract
  (idle/walk/run/attack/die [+corpse, +special]).
- village NPCs (LineageNpcs.ukx) have no npcgrp entry; their multi-section
  material bindings are read from the mesh's own .ukx Faces/Materials
  arrays (face MaterialIndex -> Materials -> Textures), not from names.

Frozen output contract (client codes against it):
  editor/characters/monsters/manifest.json
    {"models": [{"id": "gremlin_m00",
                 "gltf": "models/gremlin_m00.gltf",
                 "animations": ["idle", "walk", "run", "attack", "die", ...]}]}
  editor/characters/monsters/models/<id>.gltf + .bin + <id>[_sN].png

Usage: /usr/bin/python3 tools/src/char_pipeline/build_monsters.py [only_id ...]
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
OUT = os.path.join(ROOT, 'editor/characters/monsters')
STAGE = '/tmp/l2mon_stage'

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools/l2lib'))
import assemble
import scale_util
import ue2package as up
from build_characters import (decode_texture_png, library_png, load_utx,
                              resolve_diffuse, find_utx)

# ------------------------------------------------------------ the roster
# id = manifest/glTF id = mesh object name in the package.
# pkg = .ukx package holding mesh + animation.
# tex = authoritative texture refs from npcgrp (monsters); NPCs read their
#       own ukx material slots instead.

MONSTER_PKG = 'LineageMonsters'

# npcgrp package name -> .ukx filename on disk.  Resolved case-insensitively
# against the real directory (npcgrp writes "LineageNPCs", the file is
# "LineageNpcs.ukx"; "LineageDecos" is "lineagedecos.ukx") so nothing here
# is a guessed spelling.
_UKX_BY_NAME = None


def ukx_for_package(pkg_name):
    """-> ('animations/<File>.ukx', '<File>') for an npcgrp package name,
    or (None, None) when that package has no .ukx in the client."""
    global _UKX_BY_NAME
    if _UKX_BY_NAME is None:
        d = os.path.join(CLIENT, 'animations')
        _UKX_BY_NAME = {f[:-4].lower(): f[:-4]
                        for f in os.listdir(d) if f.lower().endswith('.ukx')}
    real = _UKX_BY_NAME.get((pkg_name or '').lower())
    if not real:
        return None, None
    return 'animations/%s.ukx' % real, real

MONSTERS = [
    # starter fields: Talking Island + race villages
    'gremlin_m00', 'rabbit_m00', 'fox_m00', 'wolf_m00', 'dire_wolf_m00',
    'werewolf_m00', 'goblin_m00', 'hobgoblin_m00', 'giant_spider_m00',
    'poison_spider_m00', 'skeleton_m00', 'skeleton_archer_m00',
    'zombie_m00', 'pirates_zombie_m00', 'imp_m00', 'pixy_m00', 'dryad_m00',
    'bugbear_m00', 'troll_m00', 'batur_orc_m00', 'wererat_m00',
    'crimson_bear_m00', 'virud_lizardman_m00', 'stone_golem_m00',
    'harpy_m00',
]

NPC_PKG = 'LineageNpcs'
# Spellings here are npcgrp.dat's, which is what the client keys off.  The
# dwarf trader used to be listed as 'Black_Market_Trader_MDwarf_m00' (the
# .ukx object's capitalisation); npcgrp writes
# 'black_market_trader_MDwarf_m00', so this roster produced a SECOND
# manifest entry differing only in case, whose glTF/PNG filenames resolved
# on macOS and 404'd on a case-sensitive host.  npcgrp wins.
NPCS = ['a_guard_MElf_m00', 'a_common_peopleA_MHuman_m00',
        'black_market_trader_MDwarf_m00']

# ------------------------------------------------------- animation binding
#
# PRIMARY SOURCE: the client's own per-creature animation-name table, decoded
# by tools/anim/creature_anim_table.py to tools/anim/creature_anim_table.json.
# Engine.Pawn declares `var localized name WaitAnimName[4]` (and Run/Walk/
# Atk01/SpAtk01/Death/DeathWait/CastShort/CastMid/CastLong/CastEnd/MagicShot/
# MagicThrow/MagicNoTarget/NpcSocial); `localized` puts the VALUES in the
# package's .int, keyed by class name, and npcgrp.dat carries both the class
# and the mesh for every npcId.  So "what does this creature play when it
# casts?" has a decoded answer per creature and does not have to be guessed
# from a name convention.  Cross-checked: 13082 of 13103 clip names the table
# produces exist in the .psa the mesh is actually rigged against.
#
# Contract slot -> the retail variable that fills it.  Index [0] is the
# default row; [1..3] are per-weapon-stance rows the client picks by the
# creature's equipped weapon, which this port does not model -- documented
# gap, not a guess.
RETAIL_SLOTS = {
    'idle':    ['WaitAnimName', 'AtkWaitAnimName'],
    'walk':    ['WalkAnimName'],
    'run':     ['RunAnimName'],
    'attack':  ['Atk01AnimName'],
    'die':     ['DeathAnimName'],
    'corpse':  ['DeathWaitAnimName'],
    # 'special' is this port's skill-cast slot (entities.js skillFlash).
    # Retail splits the cast in two: CastShort/Mid/Long is the wind-up (a
    # stance -- usually atkwait) and MagicShot/MagicThrow is the clip played
    # when the skill actually fires.  The firing clip is the one with the
    # motion (measured mean per-frame quaternion delta over 25 creature sets:
    # spatk01 0.0144, atk01 0.0160, versus atkwait 0.0041 and spwait01
    # 0.0067), so the single-clip slot takes MagicShotAnimName.  For 315
    # creatures that IS spatk01; for melee creatures like the gremlin retail
    # names atk01 there, and the table says so rather than this file guessing.
    'special': ['MagicShotAnimName'],
    # Social emote (SocialAction broadcast).  Retail keeps this SEPARATE from
    # the cast -- NpcSocialAnimName, usually spwait01.  Before this table the
    # 'special' slot was doing both jobs with a wait pose, which is why a
    # skill cast looked like a creature standing still.
    'social':  ['NpcSocialAnimName'],
}

# FALLBACK ONLY: name-convention candidates for the meshes npcgrp/.int cannot
# answer for (props and event NPCs whose classes carry no localized table).
# First hit wins, case-insensitive.  The 'special' list now leads with the
# real strike clips and keeps the old wait poses only as a last resort, so a
# creature that HAS a strike can never bind a standing pose as its cast.
ANIM_CANDIDATES = {
    'idle':    ['Wait', 'Wait_1HS', 'Wait_Hand', 'SpWait01',
                'atkwait', 'AtkWait_1HS', 'atkwait_2HS', 'atk_wait'],
    'walk':    ['Walk', 'Walk_1HS', 'Walk_Hand'],
    'run':     ['run', 'Run_1HS', 'Run_Hand', 'Run'],
    'attack':  ['atk01', 'Atk01_1HS', 'Atk01_Hand', 'Atk01_Bow',
                'Atk01_Pole', 'Attack01'],
    'die':     ['death', 'Death_Hand', 'die', 'Death'],
    'corpse':  ['deathwait', 'deathwait_Hand'],
    'special': ['spatk01', 'SpAtk01_1HS', 'SpAtk01_2HS', 'spatk02',
                'atk01', 'Atk01_1HS',
                'SpWait01', 'Social01', 'atkwait', 'AtkWait_1HS'],
    'social':  ['Social01', 'SpWait01', 'Social02'],
}

# entities.js:mapAnimations() resolves each runtime state to the FIRST glTF
# clip whose name contains one of these words, falling back to the first clip
# in the file.  Kept here because the aliasing below is only safe while it
# holds -- verify_creature_anims.js asserts these literals against
# entities.js, so an edit there fails loudly instead of silently changing
# which clip a creature plays.  Slots absent from this table ('corpse',
# 'social') are not resolved by mapAnimations at all today.
RUNTIME_FALLBACK = {
    'idle':    [('idle', 'wait', 'stand')],
    'walk':    [('walk',)],
    'run':     [('run',), ('walk',)],
    'attack':  [('attack', 'atk', 'hit')],
    'special': [('special',), ('attack',)],
    'die':     [('die', 'death', 'dead')],
}


def runtime_resolves_to(slot, emitted):
    """Replay mapAnimations() for `slot` over the emitted clip names."""
    for words in RUNTIME_FALLBACK.get(slot, []):
        for name in emitted:
            if any(w in name.lower() for w in words):
                return name
    return emitted[0] if emitted else None


_ANIM_TABLE = None


def retail_anim_table():
    """-> {mesh_id_lower: {AnimVar: {index: clip}}} decoded from the client,
    or {} when the table has not been generated yet."""
    global _ANIM_TABLE
    if _ANIM_TABLE is None:
        p = os.path.join(ROOT, 'tools/anim/creature_anim_table.json')
        try:
            _ANIM_TABLE = {k: v['anims'] for k, v in
                           json.load(open(p))['meshes'].items()}
        except Exception as e:
            print('  note: no retail animation table (%s) — falling back to '
                  'name candidates for every creature' % e)
            _ANIM_TABLE = {}
    return _ANIM_TABLE


def select_clips(mesh_id, names_ci):
    """-> ({slot: psa_clip_name}, source) for the clips this creature ships.

    Retail table first, name candidates only where it cannot answer.  A table
    entry naming a clip the bound .psa does not contain (retail ships 21 such
    dangling references, e.g. batur_orc_shaman_a -> SpAtk01) falls through to
    the candidate list rather than being forced.
    """
    rec = retail_anim_table().get(mesh_id.lower(), {})
    selection, source = {}, {}
    for slot, variables in RETAIL_SLOTS.items():
        for var in variables:
            clip = (rec.get(var) or {}).get('0')
            hit = names_ci.get((clip or '').lower())
            if hit:
                selection[slot] = hit
                source[slot] = 'retail:%s' % var
                break
    for slot, cands in ANIM_CANDIDATES.items():
        if slot in selection:
            continue
        for c in cands:
            hit = names_ci.get(c.lower())
            if hit:
                selection[slot] = hit
                source[slot] = 'candidate'
                break
    return selection, source


def umodel(args, **kw):
    r = subprocess.run([UMODEL, '-game=l2'] + args, cwd=CLIENT,
                       capture_output=True, **kw)
    r.stdout = r.stdout.decode('utf-8', 'replace')
    r.stderr = r.stderr.decode('utf-8', 'replace')
    return r


def list_objects(pkg_path):
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
        raise RuntimeError('umodel export failed for %s: %s'
                           % (obj, r.stderr[-300:]))


_DUMP_ANIM = re.compile(r'Loading MeshAnimation (\S+) from package (\S+)')


def bound_animation(pkg_path, mesh_name):
    """-> (anim_object, 'animations/<File>.ukx') actually bound to this mesh,
    or (None, None).

    GROUND TRUTH, not a name convention.  A UE2 `USkeletalMesh` serializes an
    `Animation` object reference (UnMesh2.cpp: `Points2 << RefSkeleton <<
    Animation`) naming the MeshAnimation the mesh is rigged against.  l2lib's
    mesh reader stops at the Materials array and never reaches that field, so
    the builder used to derive the animation from the mesh NAME
    (`<base>_anim`).  The reference oracle resolves it properly: loading the
    mesh with `umodel -dump` follows the reference and logs

        Loading MeshAnimation <anim> from package <File>.ukx

    Retail is full of cases the name convention cannot reach and must not
    guess at -- transposition typos in the shipped data
    (`hunter_gargoyle_m00` -> `hunter_gargolye_anim`, `marsh_stakato_m00` ->
    `marsh_stakarto_anim`, `ketra_orc_chieftain_m00` ->
    `Ketra_orc_cheiftain_anim`), disambiguation between several plausible
    sets (`heretic_privates_m00` -> `heretic_privates_anathema_anim`, not
    `_hatchet_anim`), a different creature's set (`youth_ostrich_m00` ->
    `Rough_Ostrich_anim`) and animations in another package.  Control:
    `gremlin_m00` -> `gremlin_anim`, i.e. it agrees with the old convention
    wherever the old convention was right.

    A mesh with no `Animation` reference logs nothing and is genuinely
    inanimate -- it ships static.
    """
    r = umodel(['-dump', pkg_path, mesh_name])
    m = _DUMP_ANIM.search(r.stdout + r.stderr)
    if not m:
        return None, None
    anim, pkgfile = m.group(1), m.group(2)
    rel, _real = ukx_for_package(os.path.splitext(pkgfile)[0])
    return anim, rel


def find_exported(outdir, basename, ext):
    for dirpath, _dirs, files in os.walk(outdir):
        for f in files:
            if f.lower() == (basename + ext).lower():
                return os.path.join(dirpath, f)
    return None


# ------------------------------------------------------- npcgrp bindings

_NPCGRP = None


def npcgrp_bindings():
    """-> {mesh_object_name_lower: [texture refs]} from npcgrp.dat."""
    global _NPCGRP
    if _NPCGRP is None:
        data = json.load(open(os.path.join(ROOT, 'assets/gamedata/npcgrp.json')))
        _NPCGRP = {}
        for r in data:
            mn = r.get('mesh_name', '')
            if '.' in mn:
                pkg, obj = mn.split('.', 1)
                _NPCGRP[obj.lower()] = (pkg, r.get('textures') or [])
    return _NPCGRP


# -------------------------------------------- ukx face->material parsing

PKG_CACHE = {}


def load_ukx(pkg):
    key = pkg.lower()
    if key not in PKG_CACHE:
        rel, _real = ukx_for_package(pkg)
        if not rel:
            raise RuntimeError('no .ukx for package %s' % pkg)
        p, _proto = up.load_package(os.path.join(CLIENT, rel))
        PKG_CACHE[key] = p
    return PKG_CACHE[key]


def mesh_faces_and_slots(pkg, mesh_name):
    """-> (tex_refs, face_records, materials) for a SkeletalMesh export.

    tex_refs:    [(package, object_name)|None] per Textures slot
    face_records: [(w0, w1, w2, material_index)] per source face
    materials:   [TextureIndex per Materials slot]
    """
    ex = pkg.find_export(mesh_name)
    if ex is None:
        raise RuntimeError('mesh %s not in %s' % (mesh_name, pkg.path))
    r = pkg.body_reader(ex)
    up.read_properties(pkg, r)
    r.pos += 25 + 16
    version = r.i32()
    r.i32()  # VertexCount
    n = r.compact()
    r.pos += 4 * n
    ntex = r.compact()
    tex_refs = [r.compact() for _ in range(ntex)]
    r.pos += 36  # MeshScale, MeshOrigin, RotOrigin
    if version <= 1:
        n2 = r.compact()
        r.pos += 2 * n2
    n1 = r.compact()  # FaceLevel u16
    r.pos += 2 * n1
    nf = r.compact()  # Faces FMeshFace 8B
    faces = [struct.unpack('<4H', r.bytes(8)) for _ in range(nf)]
    nc = r.compact()  # CollapseWedgeThus u16
    r.pos += 2 * nc
    nw = r.compact()  # Wedges 10B
    r.pos += 10 * nw
    nm = r.compact()  # Materials FMeshMaterial 8B
    mats = []
    for _ in range(nm):
        r.u32()
        mats.append(r.i32())
    refs = [pkg.ref_name(ci) for ci in tex_refs]
    return refs, faces, mats


# ------------------------------------------------------------- textures

def resolve_tex_png(texpkg, obj_name, tmp_dir, keep_alpha=False):
    """-> (png_path, resolved_name) for a utx material object, or None.

    Library export first (verified), l2lib decode otherwise (the
    LineageMonstersTex packages are not in the library).  L2 *_sp
    textures carry the diffuse in RGB with a specular mask in alpha
    (verified channel-by-channel): prefer the non-suffixed sibling when
    exported, otherwise decode the _sp RGB from the .utx (that IS the
    diffuse)."""
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


def npc_sections(pkg, mesh_name, psk_path, tmp_dir):
    """Per-section textures for ANY .ukx mesh, from its own material
    slots (ordinal section order), with the npcgrp texture refs as
    ordinal fallback when a slot is null.

    Cross-check that established the ordinal rule holds for MONSTERS too,
    not just LineageNpcs: for meshes that carry both, the in-package
    slots and the npcgrp `textures` array agree element-for-element —
    orc_fighter_m00 slots ['orc_fighter_t00','orc_fighter_t01'] vs npcgrp
    ['LineageMonstersTex.orc_fighter_t00','...t01'], mats [0,1]; likewise
    elpy_m00 and undine_m00.  npcgrp `textures` is therefore a per-section
    list, NOT a variant list, and a multi-section monster must not be
    painted with textures[0] on every section."""
    ukx_pkg = load_ukx(pkg)
    ex = ukx_pkg.find_export(mesh_name)
    if ex is None:
        raise RuntimeError('mesh %s not in %s' % (mesh_name, ukx_pkg.path))
    _ver, tex_refs, mats = up.mesh_material_slots(ukx_pkg, ex)
    grp = npcgrp_bindings().get(mesh_name.lower())
    grp_texs = grp[1] if grp else []
    data = assemble.parse_psk(psk_path)
    nsec = max(1, len(data['materials']))
    sections = []
    for si in range(nsec):
        ref = None
        if si < len(mats) and 0 <= mats[si] < len(tex_refs):
            ref = tex_refs[mats[si]]
        if (not ref or not ref[0]) and si < len(grp_texs):
            tp, tn = grp_texs[si].split('.', 1)
            ref = (tp, tn)
        if ref and ref[0]:
            png, resolved = resolve_tex_png(ref[0], ref[1], tmp_dir,
                                            keep_alpha=True)
            print('  section %d -> %s.%s -> %s'
                  % (si, ref[0], ref[1], resolved))
            sections.append({'texture': png, 'name': resolved})
        else:
            print('  WARNING: section %d has no texture' % si)
            sections.append({'texture': None, 'name': None})
    return sections


# ---------------------------------------------------------------- build

def build_one(mesh_id, pkg, stage, outdir):
    ukx, _real = ukx_for_package(pkg)
    if not ukx:
        print('  SKIP: no .ukx for package %s' % pkg)
        return None
    objects = list_objects(ukx)
    mesh_name = find_ci(objects.get('SkeletalMesh', []), mesh_id)
    if not mesh_name:
        print('  SKIP: mesh %s not in %s' % (mesh_id, ukx))
        return None
    export_one(ukx, mesh_name, [], stage)
    psk = find_exported(stage, mesh_name, '.psk')
    if not psk:
        print('  SKIP: no psk for %s' % mesh_id)
        return None

    # One ordinal section path for monsters and NPCs alike (see
    # npc_sections docstring for the cross-check).  Single-section meshes
    # keep the historical flat "<id>.png" name so existing outputs and
    # their manifest entries stay byte-stable on a rebuild.
    tmp_tex = os.path.join(stage, 'tex')
    secs = npc_sections(pkg, mesh_name, psk, tmp_tex)
    sections = []
    for si, s in enumerate(secs):
        uri = None
        if s['texture']:
            uri = ('%s.png' % mesh_id if len(secs) == 1
                   else '%s_s%d.png' % (mesh_id, si))
            with open(s['texture'], 'rb') as fi, \
                    open(os.path.join(outdir, uri), 'wb') as fo:
                fo.write(fi.read())
        sections.append({'texture': uri, 'alpha_mode': None})
    if not any(s['texture'] for s in sections):
        print('  WARNING: no texture resolved for %s' % mesh_id)

    # animations: the mesh's own serialized `Animation` reference, read
    # through the reference oracle (see bound_animation).  The name
    # convention below is only a fallback for meshes that carry no such
    # reference but do have an identically-named MeshAnimation.
    anim_obj, anim_ukx = bound_animation(ukx, mesh_name)
    if anim_obj:
        print('  animation binding (umodel -dump): %s in %s'
              % (anim_obj, anim_ukx))
    else:
        # gremlin_m00 -> gremlin_anim; goblin_m00 -> Goblin_animation;
        # black_market_trader_MDwarf_m00 -> Black_Market_trader_anim
        base = re.sub(r'_m\d+$', '', mesh_name)
        anim_ukx = ukx
        anim_obj = find_ci(objects.get('MeshAnimation', []),
                           '%s_anim' % base) \
            or find_ci(objects.get('MeshAnimation', []), '%s_animation' % base)
        if not anim_obj:
            for n in objects.get('MeshAnimation', []):
                nb = re.sub(r'_anim(ation)?$', '', n.lower())
                if base.lower().startswith(nb):
                    anim_obj = n
                    break
        if anim_obj:
            print('  animation by name convention (mesh carries no '
                  'Animation reference): %s' % anim_obj)
    psa = None
    selection, source, alias = {}, {}, {}
    if anim_obj and anim_ukx:
        export_one(anim_ukx, anim_obj, [], stage)
        psa = find_exported(stage, anim_obj, '.psa')
    if psa:
        _bones, anims = assemble.parse_psa(psa)
        names_ci = {n.lower(): n for n in anims}
        resolved, source = select_clips(mesh_id, names_ci)
        # Emit in the frozen contract order, and emit each retail clip ONCE:
        # retail routinely points two slots at the same clip (the gremlin's
        # MagicShotAnimName and Atk01AnimName are both atk01), and duplicating
        # the keyframes would grow every .bin for no picture.  A slot whose
        # clip is already carried by an earlier slot becomes an alias, which
        # the client resolves the same way it always has -- entities.js
        # mapAnimations already reads `special: find('special') ||
        # find('attack')`, and 'attack' is exactly the clip the alias points
        # at.  The full slot -> retail clip map is written to the manifest so
        # nothing has to re-derive it.
        by_clip = {}
        for slot in ANIM_CANDIDATES:
            clip = resolved.get(slot)
            if not clip:
                continue
            if clip.lower() in by_clip:
                alias[slot] = by_clip[clip.lower()]
            else:
                by_clip[clip.lower()] = slot
                selection[slot] = clip
        # An alias is only allowed when mapAnimations() actually recovers the
        # SAME retail clip.  It usually does -- 'special' aliased to 'attack'
        # is exactly its documented fallback -- but not always: arachnoid_m00
        # has MagicShotAnimName=wait, so 'special' would alias to 'idle' while
        # the runtime, finding no 'special' key, falls through to 'attack' and
        # plays atk01.  Promote any such slot back to a real clip rather than
        # ship a creature playing something retail did not name.  Promoting
        # changes the emitted list, so this runs to a fixed point.
        while True:
            emitted = [s for s in ANIM_CANDIDATES if s in selection]
            promote = None
            for slot, target in alias.items():
                if slot not in RUNTIME_FALLBACK:
                    continue          # not resolved by mapAnimations at all
                got = runtime_resolves_to(slot, emitted)
                if selection.get(got) != selection.get(target):
                    promote = slot
                    break
            if promote is None:
                break
            selection[promote] = resolved[promote]
            del alias[promote]
        # inject_animations writes the glTF clips in selection order, and the
        # runtime resolution above depends on that order -- restore it after
        # any promotion appended a slot out of sequence.
        selection = {s: selection[s] for s in ANIM_CANDIDATES if s in selection}
    if not selection:
        # Nothing bindable at all.  Some monster meshes are inanimate props
        # (alchemic_box_m00 — a chest) and the package genuinely holds no
        # animation for them; ship the static mesh, which is what
        # build_npcs.py already does for the retail-static NPCs.
        #
        # This used to test `'idle' not in selection`, which threw away every
        # clip already found whenever the set happened to ship no Wait
        # sequence -- follower_of_frintessa_m00 (a raid boss) has Atk01_1HS,
        # Run_1HS, Run_2HS, AtkWait_1HS, death and deathwait and shipped as a
        # statue with all six discarded.  Keep whatever exists.
        print('  note: no animation set for %s — shipping static mesh'
              % mesh_id)
        selection, psa = {}, None
    else:
        print('  anims:', ', '.join('%s=%s [%s]'
                                    % (k, v, source.get(k, '?'))
                                    for k, v in selection.items()),
              ('| alias: ' + ', '.join('%s->%s' % kv for kv in alias.items()))
              if alias else '')

    out_gltf = os.path.join(outdir, '%s.gltf' % mesh_id)
    parts = [{'psk': psk, 'name': mesh_name, 'sections': sections}]
    g, bin_data, ctx = assemble.merge_parts(parts, out_gltf)
    if psa and selection:
        try:
            bin_data = assemble.inject_animations(g, bin_data, psa, selection,
                                                  ctx)
        except Exception as e:
            # assemble refuses to bind a psa whose bone names do not match
            # the mesh skeleton ("matched only N/M bones; refusing to
            # guess").  That refusal is right -- but dropping the whole
            # model over it leaves a coloured capsule, which is strictly
            # worse than the correct geometry standing still.  Same policy
            # as the no-animation-set branch below: ship the static mesh
            # and say why.  Seen on single-bone props whose <name>_anim
            # rig uses a different root bone name (old_bookshelf_m00,
            # grail_brazier_b_m00, pavel_weather_controller_m00,
            # Evilate_m00).
            print('  note: animation set does not fit this skeleton (%s)'
                  ' -- shipping static mesh' % e)
            g, bin_data, ctx = assemble.merge_parts(parts, out_gltf)
            selection, psa, alias, source = {}, None, {}, {}
    g['buffers'][0]['byteLength'] = len(bin_data)
    with open(out_gltf, 'w') as f:
        json.dump(g, f)
    with open(out_gltf.replace('.gltf', '.bin'), 'wb') as f:
        f.write(bin_data)
    print('  -> %s (%d anims)' % (out_gltf, len(g['animations'])))
    entry = {'id': mesh_id, 'gltf': 'models/%s.gltf' % mesh_id,
             'animations': sorted(selection.keys(),
                                  key=list(ANIM_CANDIDATES).index)}
    if selection:
        # Provenance, so a verifier (or the next reader) can tell WHICH retail
        # clip filled each slot without re-exporting 495 .psa: the clip name,
        # and whether it came from the client's own table or from the
        # name-convention fallback.  `clipAlias` names the slot that actually
        # carries a slot's clip when two slots share one.
        clips = {k: selection[k] for k in entry['animations']}
        clips.update({a: selection[t] for a, t in alias.items()})
        order = list(ANIM_CANDIDATES)
        entry['clips'] = {k: clips[k] for k in sorted(clips, key=order.index)}
        entry['clipSource'] = {k: source.get(k, '?') for k in entry['clips']}
        if alias:
            entry['clipAlias'] = {k: alias[k]
                                  for k in sorted(alias, key=order.index)}
    # true in-world height (L2 units) = glTF Y extent x 100 x MeshScale.z
    # decoded from the .ukx (scale_util) — the client sizes the model from
    # this, never from a hardcoded fallback
    nh = scale_util.native_height(out_gltf, os.path.join(CLIENT, ukx), mesh_id)
    if nh:
        entry['nativeHeight'] = nh
        print('  nativeHeight %.1f L2 units' % nh)
    return entry


def resolve_roster(only):
    """-> [(mesh_id, package)] to build.

    With no arguments: the static starter roster (unchanged behaviour).
    With arguments: any mesh id, with its package taken from npcgrp.dat
    (which is what binds npcId -> "<Package>.<mesh>"), so the ranked
    worklist from coverage.py can be fed straight in.  A requested id
    that is in the static roster keeps the roster's package.
    """
    static = [(m, MONSTER_PKG) for m in MONSTERS] + \
             [(n, NPC_PKG) for n in NPCS]
    if not only:
        return static
    by_id = {m: p for m, p in static}
    grp = npcgrp_bindings()
    roster, missing = [], []
    for mesh_id in only:
        if mesh_id in by_id:
            roster.append((mesh_id, by_id[mesh_id]))
            continue
        entry = grp.get(mesh_id.lower())
        if not entry:
            missing.append(mesh_id)
            continue
        roster.append((mesh_id, entry[0]))
    for m in missing:
        print('== %s ==\n  SKIP: no npcgrp record, cannot resolve package' % m)
    return roster


def main():
    only = list(dict.fromkeys(sys.argv[1:]))   # keep the caller's order
    outdir = os.path.join(OUT, 'models')
    os.makedirs(outdir, exist_ok=True)
    manifest_path = os.path.join(OUT, 'manifest.json')
    # MERGE ONLY — the manifest is shared state; never drop an entry and
    # never reorder the ones already there (see docs/monster-pipeline.md).
    existing, order = {}, []
    if os.path.isfile(manifest_path):
        for m in json.load(open(manifest_path)).get('models', []):
            existing[m['id']] = m
            order.append(m['id'])
    built = failed = 0
    for mesh_id, pkg in resolve_roster(only):
        print('== %s (%s) ==' % (mesh_id, pkg))
        stage = os.path.join(STAGE, mesh_id)
        if os.path.isdir(stage):
            shutil.rmtree(stage)
        try:
            m = build_one(mesh_id, pkg, stage, outdir)
        except Exception as e:
            print('  FAILED: %s' % e)
            m = None
        if m:
            if m['id'] not in existing:
                order.append(m['id'])
            existing[m['id']] = m
            built += 1
        else:
            failed += 1
    models = [existing[k] for k in order if k in existing]
    # Two ids equal under lower() are always a bug, never a feature: the
    # client matches the manifest id case-insensitively, so the pair is
    # ambiguous, and their glTF/PNG filenames collide on a case-insensitive
    # filesystem while resolving to different URLs on a case-sensitive
    # host.  Refuse rather than write it.
    seen = {}
    for m in models:
        prev = seen.setdefault(m['id'].lower(), m['id'])
        if prev != m['id']:
            print('REFUSING to write manifest: ids %r and %r differ only in '
                  'case' % (prev, m['id']), file=sys.stderr)
            return 2
    with open(manifest_path, 'w') as f:
        json.dump({'models': models}, f, indent=2)
    print('\nbuilt %d, failed/skipped %d; manifest: %d models -> %s'
          % (built, failed, len(models), manifest_path))
    return 1 if failed and built == 0 else 0


if __name__ == '__main__':
    sys.exit(main())
