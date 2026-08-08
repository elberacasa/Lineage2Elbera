#!/usr/bin/env python3
"""Decode `defaultproperties` out of a UE2 `UClass` export in a .u package.

The retail client's `System/*.u` script packages are the only record of two
numbers this pipeline needs and cannot get anywhere else:

  * `CollisionHeight` / `CollisionRadius` - the Unreal collision cylinder
    (`Engine.Actor` ships 22/22, `Engine.Pawn` 34/78; Lineage overrides them
    per pawn class).  These are the values the aCis datapack carries as
    `height`/`radius`, so this module is what lets the server data be
    checked against its own source.
  * `DrawScale` - the multiplier the engine applies to the *rendered* mesh
    (`Engine.Actor` default 1.0).  344 Lineage NPC/monster classes override
    it; not one of the 14 player pawn classes does.  Without it a mesh's
    rendered size cannot be derived from the .ukx alone.

Format notes (verified against Interlude `System/*.u`, file version 123,
licensee 30):

`UClass::Serialize` writes the class's default property stream LAST, and it
terminates with the `None` name at the final byte of the export body.  The
bytecode that precedes it has no self-describing length we decode here, so
the start offset is found by trying every offset in the body and keeping the
parse that consumes it exactly - a stream that ends on the last byte, with
every name index in range and every property tag well formed, is not
something random bytecode produces.  The stream uses the *packed* tag format
(`ue2package._read_props_packed`), not the tagged one.

The decode is reproducible without this file: `umodel -uc` writes
`#exec MESH SCALE`/`ORIGIN` for the same packages, and the CollisionHeight
values it does not print are cross-checked against
`server/aCis_datapack/data/xml/classes/*.xml` by `audit_native_height.py`.
"""
import os
import struct
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
sys.path.insert(0, os.path.join(ROOT, 'tools/l2lib'))
import ue2package as up

SYSTEM = os.path.join(ROOT, 'assets/interlude/system')

# ue2package packed property type codes, named for readability
_T = {1: 'byte', 2: 'int', 3: 'bool', 4: 'float', 5: 'object', 6: 'name',
      7: 'string', 8: 'class', 9: 'array', 10: 'struct', 11: 'vector',
      12: 'rotator', 13: 'str', 14: 'map', 15: 'fixedarray'}
_PACKED_SIZES = {0: 1, 1: 2, 2: 4, 3: 12, 4: 16}

_PKG_CACHE = {}


def load(pkgfile):
    """Load a package out of the retail System/ directory (cached)."""
    if pkgfile not in _PKG_CACHE:
        _PKG_CACHE[pkgfile] = up.load_package(os.path.join(SYSTEM, pkgfile))[0]
    return _PKG_CACHE[pkgfile]


def _parse_packed(pkg, body, start):
    """Read a packed property stream; -> (props, end_offset). Raises on desync."""
    r = up.Reader(body, start)
    out = []
    while True:
        if r.pos >= len(body):
            raise ValueError('overrun')
        ni = r.compact()
        if not 0 <= ni < len(pkg.names):
            raise ValueError('bad name index')
        name = pkg.name(ni)
        if name == 'None':
            return out, r.pos
        info = r.u8()
        ptype = info & 0x0F
        is_array = bool(info & 0x80)
        size_sel = (info >> 4) & 7
        if ptype == 0 or ptype > 15:
            raise ValueError('bad property type')
        struct_name = None
        if ptype == 10:
            si = r.compact()
            if not 0 <= si < len(pkg.names):
                raise ValueError('bad struct name')
            struct_name = pkg.name(si)
        if size_sel in _PACKED_SIZES:
            size = _PACKED_SIZES[size_sel]
        elif size_sel == 5:
            size = r.u8()
        elif size_sel == 6:
            size = r.u16()
        else:
            size = r.u32()
        if ptype != 3 and is_array:
            b = r.u8()
            if b < 128:
                pass
            elif b & 0x40:
                r.bytes(3)
            else:
                r.bytes(1)
        if ptype == 3:                     # bool: value rides the array flag
            out.append((name, 'bool', is_array))
            continue
        raw = r.bytes(size)
        val = raw.hex()
        try:
            if ptype == 4 and size == 4:
                val = struct.unpack('<f', raw)[0]
            elif ptype == 2 and size == 4:
                val = struct.unpack('<i', raw)[0]
            elif ptype == 1 and size == 1:
                val = raw[0]
            elif ptype in (5, 8):
                val = pkg.ref_name(up.Reader(raw, 0).compact())
            elif ptype == 6:
                v = up.Reader(raw, 0).compact()
                val = pkg.name(v) if 0 <= v < len(pkg.names) else v
            elif ptype == 13:
                rr = up.Reader(raw, 0)
                val = rr.bytes(rr.compact())[:-1].decode('latin-1')
            elif ptype == 11 and size == 12:
                val = struct.unpack('<3f', raw)
            elif ptype == 10:
                val = (struct_name, raw.hex())
        except Exception:
            pass
        out.append((name, _T.get(ptype, ptype), val))


def class_defaults(pkg, export):
    """-> [(name, type, value)] for one `Class` export, or [] when undecodable."""
    body = pkg.data[export.serial_offset:export.serial_offset + export.serial_size]
    best = []
    for start in range(len(body)):
        try:
            props, end = _parse_packed(pkg, body, start)
        except (ValueError, IndexError, struct.error, UnicodeDecodeError,
                up.L2Error):
            continue
        if end == len(body) and len(props) > len(best):
            best = props
    return best


def package_classes(pkgfile):
    """-> {className: {'pkg','super','mesh','submeshes','drawScale',
                       'collisionHeight','collisionRadius','props'}}"""
    pkg = load(pkgfile)
    name = pkgfile[:-2] if pkgfile.endswith('.u') else pkgfile
    out = {}
    for ex in pkg.exports:
        if pkg.class_name_of(ex) != 'Class':
            continue
        props = class_defaults(pkg, ex)
        d = {'pkg': name, 'mesh': None, 'submeshes': [], 'drawScale': None,
             'collisionHeight': None, 'collisionRadius': None, 'props': props,
             'super': list(pkg.ref_name(ex.super_index)) if ex.super_index else None}
        for p in props:
            k, v = p[0], p[2]
            if k == 'Mesh':
                d['mesh'] = list(v) if isinstance(v, tuple) else v
            elif k == 'SubMeshes':
                d['submeshes'].append(list(v) if isinstance(v, tuple) else v)
            elif k == 'DrawScale':
                d['drawScale'] = v
            elif k == 'CollisionHeight':
                d['collisionHeight'] = v
            elif k == 'CollisionRadius':
                d['collisionRadius'] = v
        out[pkg.export_name(ex)] = d
    return out


def index(pkgfiles):
    """Merge several packages into one 'Package.Class' -> defaults index."""
    out = {}
    for f in pkgfiles:
        for cname, d in package_classes(f).items():
            out['%s.%s' % (d['pkg'], cname)] = d
    return out


def resolver(idx):
    """-> (key_for(class_name), inherited(key, field)) over a merged index.

    Lineage class names in npcgrp.dat use the declaring package
    ('LineageMonster.gremlin'), but the case and the package prefix are not
    always the ones the .u tables carry, so lookups fall back to the bare
    name.  `inherited` walks the super chain the way the engine does, so a
    subclass that does not restate DrawScale gets its parent's value (and,
    ultimately, Engine.Actor's 1.0 - which is why None means 1.0).
    """
    bare = {}
    for k in idx:
        bare.setdefault(k.split('.', 1)[1].lower(), k)

    def key_for(class_name):
        if class_name in idx:
            return class_name
        return bare.get(class_name.split('.', 1)[-1].lower())

    def inherited(key, field):
        seen = set()
        while key and key not in seen:
            seen.add(key)
            d = idx.get(key)
            if not d:
                return None
            if d[field] not in (None, []):
                return d[field]
            sup = d['super']
            if not sup:
                return None
            k2 = '%s.%s' % (sup[0], sup[1])
            key = k2 if k2 in idx else bare.get(sup[1].lower())
        return None

    return key_for, inherited


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('usage: uclass_defaults.py <Package.u> [Class ...]')
    want = set(sys.argv[2:])
    for cname, d in package_classes(sys.argv[1]).items():
        if want and cname not in want:
            continue
        print('== %s (extends %s)' % (cname, d['super'] and d['super'][1]))
        for p in d['props']:
            print('    %-22s %-8s %s' % p[:2] + (p[2],) if False else
                  '    %-22s %-8s %r' % (p[0], p[1], p[2]))
