#!/usr/bin/env python3
"""Where the retail client hangs an item on a character — decoded, twice.

This exists because "shields go on Weapon_L_Bone" was written down, shipped,
and wrong. Two independent things in the client answer "which bone, and with
what transform", and this recovers both so the answer can be re-checked
instead of re-argued.

1. THE BONE NAMES — LineageWarrior.u class default properties
---------------------------------------------------------------------------
Every playable pawn is a UClass export in
`assets/interlude/system/LineageWarrior.u`, and the tail of a UE2 UClass body
is that class's default-property block in the ordinary tagged format
(name index / info byte / [struct name] / size / value). Those defaults fill
four `var name` slots declared on Engine.u's `Pawn`:

    RightHandBone   LeftHandBone   RightArmBone   LeftArmBone

and the client reads them natively (engine.dll exports
`?GetLArmBoneName@APawn@@UAE?AVFName@@XZ` and friends). Decoded, all 14
playable classes agree exactly:

    RightHandBone = Weapon_R_Bone      LeftHandBone = Weapon_L_Bone
    RightArmBone  = Shield_R_Bone      LeftArmBone  = Shield_L_Bone

So a shield is an ARM item: `Shield_L_Bone`. Note the class body offset of the
property block is not stored anywhere, so it is found by scanning forward for
the first offset from which the whole stream parses — the recovered property
NAMES are the proof it locked on (a wrong offset yields garbage names).

2. THE TRANSFORM — the USkeletalMesh socket table
---------------------------------------------------------------------------
A UE2 USkeletalMesh serialises `AttachAliases` / `AttachBoneNames` /
`AttachCoords` (UEViewer `Unreal/UnrealMesh/UnMesh2.cpp:447`) — named sockets
with a full FCoords each. If NCSoft had put a weapon or shield socket there,
THAT would be the attach transform and identity would be wrong.

Decoded for all 14 body meshes: each carries exactly ONE socket, alias
`e_bone` on `Bip01_head`, origin (0, 0, 7.2..9.7) with identity axes — an
effect anchor above the head. All 17 shipped shield meshes carry NO socket
table at all and identity MeshScale/MeshOrigin/RotOrigin. There is therefore
no per-item attach transform in the client: the bone frame is the transform,
and parenting at identity is correct by construction.

NOT RECOVERED, on purpose rather than by omission: engine.dll is
Themida-packed (its only code section is literally named `Themida`), so the
native call site that picks LeftArmBone over LeftHandBone for the shield slot
cannot be disassembled. The bone bindings above, plus the geometric
measurement in editor/world/verify_shield.js, are the evidence.

Usage:
  python3 tools/src/char_pipeline/decode_attach.py           # print both tables
  python3 tools/src/char_pipeline/decode_attach.py --check   # assert them

Needs your own Interlude client under assets/interlude/.
"""
import os
import struct
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
sys.path.insert(0, os.path.join(ROOT, 'tools/l2lib'))
import ue2package as up                                       # noqa: E402

WARRIOR = os.path.join(ROOT, 'assets/interlude/system/LineageWarrior.u')
ANIM = os.path.join(ROOT, 'assets/interlude/animations')

# class -> (package, body mesh). The Mesh= default of each class; the body
# mesh is the one that owns the skeleton every attach bone lives in.
PAWNS = [
    ('MFighter', 'Fighter.ukx', 'MFighter_m000_f'),
    ('FFighter', 'Fighter.ukx', 'FFighter_m000_f'),
    ('MMagic',   'magic.ukx',   'MMagic_m000_f'),
    ('FMagic',   'magic.ukx',   'FMagic_m000_f'),
    ('MElf',     'Elf.ukx',     'MElf_m000_f'),
    ('FElf',     'Elf.ukx',     'FElf_m000_f'),
    ('MDarkElf', 'DarkElf.ukx', 'MDarkElf_m000_f'),
    ('FDarkElf', 'DarkElf.ukx', 'FDarkElf_m000_f'),
    ('MOrc',     'orc.ukx',     'MOrc_m000_f'),
    ('FOrc',     'orc.ukx',     'FOrc_m000_f'),
    ('MShaman',  'Shaman.ukx',  'MShaman_m000_f'),
    ('FShaman',  'Shaman.ukx',  'FShaman_m000_f'),
    ('MDwarf',   'Dwarf.ukx',   'MDwarf_m000_f'),
    ('FDwarf',   'Dwarf.ukx',   'FDwarf_m000_f'),
]

EXPECT_BONES = {
    'RightHandBone': 'Weapon_R_Bone',
    'LeftHandBone':  'Weapon_L_Bone',
    'RightArmBone':  'Shield_R_Bone',
    'LeftArmBone':   'Shield_L_Bone',
}

_PKG = {}


def pkg_of(path):
    if path not in _PKG:
        _PKG[path] = up.load_package(path)[0]
    return _PKG[path]


# ------------------------------------------------- 1. class default properties

_TYPES = {1: 'Byte', 2: 'Int', 3: 'Bool', 4: 'Float', 5: 'Object', 6: 'Name',
          7: 'String', 8: 'Class', 9: 'Array', 10: 'Struct', 13: 'Str',
          14: 'Map', 15: 'FixedArray'}
_SIZES = {0: 1, 1: 2, 2: 4, 3: 12, 4: 16}


def _compact(d, p):
    """UE compact index: bit7 sign, bit6 continue, then 7 bits per byte."""
    b = d[p]; p += 1
    neg, val, shift = b & 0x80, b & 0x3F, 6
    if b & 0x40:
        while True:
            b2 = d[p]; p += 1
            val |= (b2 & 0x7F) << shift
            shift += 7
            if not b2 & 0x80:
                break
    return (-val if neg else val), p


def _props(pkg, start, end):
    """Parse a tagged property stream, or None if it does not parse cleanly."""
    d, names = pkg.data, pkg.names
    p, out = start, []
    while p < end:
        ni, p = _compact(d, p)
        if not 0 <= ni < len(names):
            return None
        nm = names[ni]
        if nm == 'None':
            return out
        if p >= end:
            return None
        info = d[p]; p += 1
        t, sc, arr = info & 0x0F, (info >> 4) & 7, info & 0x80
        if t == 10:                       # struct: a name follows the tag
            _sn, p = _compact(d, p)
        if sc <= 4:
            size = _SIZES[sc]
        elif sc == 5:
            size = d[p]; p += 1
        elif sc == 6:
            size = struct.unpack_from('<H', d, p)[0]; p += 2
        else:
            size = struct.unpack_from('<I', d, p)[0]; p += 4
        if arr and t != 3:
            _ai, p = _compact(d, p)
        val = None
        if t == 6:
            v, _ = _compact(d, p)
            val = names[v] if 0 <= v < len(names) else None
            if val is None:
                return None
        out.append((nm, _TYPES.get(t, t), val))
        p += size
    return None


def class_defaults(cls):
    """-> {property: name value} for a UClass export's default properties.

    The block's offset inside the class body is not recorded, so scan for the
    first offset that parses to a plausible property list. A wrong offset
    yields out-of-range name indices or nonsense names, so a clean parse of
    several real property names is the lock.
    """
    pkg = pkg_of(WARRIOR)
    ex = pkg.find_export(cls)
    if ex is None:
        raise KeyError(cls)
    start, end = ex.serial_offset, ex.serial_offset + ex.serial_size
    for off in range(start, end):
        got = _props(pkg, off, end)
        if got and len(got) >= 4:
            return {n: v for n, ty, v in got if ty == 'Name'}
    return {}


# --------------------------------------------------- 2. the mesh socket table

def sockets(ukx, obj):
    """-> (bones, [(alias, bone, coords12)], MeshScale/Origin/Rot) of a
    UE2 USkeletalMesh, following UEViewer's ULodMesh/USkeletalMesh::Serialize.

    Interlude packages are Ver 123 / licensee 30, so the ArVer>=133 Lineage2
    vertex branch does NOT apply. Points2 is a TLazyArray, but L2 writes no
    SkipPos word ahead of it — proven by the RefSkeleton that follows parsing
    into real bone names only on this reading.
    """
    pkg = pkg_of(os.path.join(ANIM, ukx))
    ex = pkg.find_export(obj)
    if ex is None:
        raise KeyError('%s in %s' % (obj, ukx))
    r = pkg.body_reader(ex)
    up.read_properties(pkg, r)
    r.pos += 25 + 16                                  # FBox + FSphere
    ver = r.i32(); r.i32()                            # Version, VertexCount
    n = r.compact(); r.pos += 4 * n                   # Verts
    nt = r.compact(); [r.compact() for _ in range(nt)]  # Textures
    scale = (r.f32(), r.f32(), r.f32())
    origin = (r.f32(), r.f32(), r.f32())
    rot = (r.i32(), r.i32(), r.i32())
    if ver <= 1:
        n = r.compact(); r.pos += 2 * n
    for elem in (2, 8, 2, 10, 8):   # FaceLevel Faces CollapseWedgeThus Wedges Materials
        c = r.compact(); r.pos += elem * c
    r.f32(); r.f32()                                  # MeshScaleMax, LODHysteresis
    r.f32(); r.i32(); r.f32(); r.f32()                # LODStrength/MinVerts/Morph/ZDisplace
    if ver >= 3:                                      # impostor block
        r.i32(); r.compact(); r.pos += 12 + 12 + 12 + 4
        r.i32(); r.i32(); r.i32()
    if ver >= 4:
        r.f32()                                       # SkinTesselationFactor
    if ver >= 5:                                      # Lineage2 tail of ULodMesh
        r.i32()
        if ver >= 6:
            r.pos += 1
    n = r.compact(); r.pos += 12 * n                  # Points2
    nb = r.compact()
    bones = []
    for _ in range(nb):
        ni = r.compact(); r.i32()                     # Name, Flags
        r.pos += 16 + 12 + 4 + 12                     # VJointPos
        r.i32(); r.i32()                              # ParentIndex, NumChildren
        bones.append(pkg.name(ni))
    r.compact(); r.i32()                              # Animation, SkeletalDepth
    n = r.compact()
    for _ in range(n):                                # WeightIndices
        m = r.compact(); r.pos += 2 * m; r.i32()
    n = r.compact(); r.pos += 4 * n                   # BoneInfluences
    na = r.compact(); aliases = [pkg.name(r.compact()) for _ in range(na)]
    nbn = r.compact(); abones = [pkg.name(r.compact()) for _ in range(nbn)]
    nc = r.compact()
    coords = [tuple(round(r.f32(), 4) for _ in range(12)) for _ in range(nc)]
    table = list(zip(aliases, abones, coords + [None] * len(aliases)))
    return bones, table, (scale, origin, rot)


# ------------------------------------------------------------------- main

def main():
    check = '--check' in sys.argv[1:]
    if not os.path.isfile(WARRIOR) or not os.path.isdir(ANIM):
        print('FAIL: needs your own Interlude client under assets/interlude/')
        return 1

    errs = []

    print('== LineageWarrior.u class default properties (attach bones) ==')
    for cls, ukx, mesh in PAWNS:
        try:
            d = class_defaults(cls)
        except Exception as e:                        # noqa: BLE001
            errs.append('%s: %s' % (cls, e))
            continue
        got = {k: d.get(k) for k in EXPECT_BONES}
        ok = got == EXPECT_BONES
        print('  %-9s %-14s %-14s %-14s %-14s  %s'
              % (cls, got['RightHandBone'], got['LeftHandBone'],
                 got['RightArmBone'], got['LeftArmBone'], 'ok' if ok else 'MISMATCH'))
        if not ok:
            errs.append('%s: attach bones %r != %r' % (cls, got, EXPECT_BONES))

    print('\n== USkeletalMesh socket table (AttachAliases/BoneNames/Coords) ==')
    for cls, ukx, mesh in PAWNS:
        try:
            bones, table, _xf = sockets(ukx, mesh)
        except Exception as e:                        # noqa: BLE001
            errs.append('%s: %s' % (mesh, e))
            continue
        have = {b for b in bones}
        for want in ('Weapon_R_Bone', 'Weapon_L_Bone', 'Shield_R_Bone', 'Shield_L_Bone'):
            if want not in have:
                errs.append('%s: skeleton has no %s' % (mesh, want))
        held = [(a, b, c[:3] if c else None) for a, b, c in table]
        print('  %-22s %3d bones  sockets=%s' % (mesh, len(bones), held or 'none'))
        # A weapon/shield socket coord here would OVERRIDE the identity attach.
        for alias, bone, _c in table:
            if bone in ('Weapon_R_Bone', 'Weapon_L_Bone', 'Shield_R_Bone', 'Shield_L_Bone'):
                errs.append('%s: socket %r targets attach bone %s — the attach '
                            'transform is NOT identity' % (mesh, alias, bone))

    if check:
        for e in errs:
            print('ERROR: %s' % e)
        print('CHECK %s (%d errors)' % ('PASS' if not errs else 'FAIL', len(errs)))
        return 1 if errs else 0
    for e in errs:
        print('ERROR: %s' % e)
    return 1 if errs else 0


if __name__ == '__main__':
    sys.exit(main())
