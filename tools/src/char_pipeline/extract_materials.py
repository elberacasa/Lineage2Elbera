#!/usr/bin/env python3
"""Extract the REAL per-mesh material bindings from L2 Interlude .ukx packages.

umodel cannot resolve L2 mesh->material bindings (its .psk export just says
"material_0"), but the bindings ARE in the package: every USkeletalMesh export
serializes (UE2 layout, see UEViewer Unreal/UnrealMesh/UnMesh2.cpp):

    UObject::Serialize      -> property tag stream (FName "None" when empty)
    UPrimitive::Serialize   -> FBox BoundingBox (24B) + FSphere (16B)
    ULodMesh::Serialize     -> Version i32, VertexCount i32,
                               Verts TArray<FMeshVert 4B>   (ArVer 123 < 133)
                               Textures TArray<UObject*>    (compact index refs)
                               MeshScale/MeshOrigin/RotOrigin (36B)
                               FaceLevel TArray<u16>, Faces TArray<FMeshFace 8B>,
                               CollapseWedgeThus TArray<u16>,
                               Wedges TArray<FMeshWedge 10B>,
                               Materials TArray<FMeshMaterial 8B>
                                  FMeshMaterial = { PolyFlags u32, TextureIndex i32 }

Materials[i].TextureIndex indexes into the Textures array; each Textures entry
is a package object reference (compact index; negative = import table). That
yields the authoritative mesh -> [texture object names] binding, which the
naming-convention heuristic in build_characters.py only guessed at.

Usage: extract_materials.py <pkg.ukx> [meshName ...]
"""
import os
import struct
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                '../../utx'))
import utxedit  # noqa: E402


class Package(utxedit.Package):
    def __init__(self, data):
        self.data = data
        r = utxedit.Reader(data)
        tag = r.u32()
        if tag != utxedit.PACKAGE_TAG:
            raise utxedit.UtxError("not an Unreal package")
        self.file_version = r.u16()
        self.licensee_version = r.u16()
        if self.file_version not in (117, 123):
            raise utxedit.UtxError("unsupported package version %d"
                                   % self.file_version)
        self.package_flags = r.u32()
        name_count = r.u32()
        name_offset = r.u32()
        export_count = r.u32()
        export_offset = r.u32()
        import_count = r.u32()
        import_offset = r.u32()

        r.pos = name_offset
        self.names = []
        for _ in range(name_count):
            length = r.compact()
            if length == 0:
                self.names.append("")
                continue
            if length < 0:
                raw = r.bytes(-length * 2)
                self.names.append(raw[:-2].decode("utf-16-le", "replace"))
            else:
                raw = r.bytes(length)
                self.names.append(raw[:-1].decode("latin-1"))
            r.u32()

        r.pos = import_offset
        self.imports = []
        for _ in range(import_count):
            imp = utxedit.Import()
            imp.class_package = r.compact()
            imp.class_name = r.compact()
            imp.package_index = r.i32()
            imp.object_name = r.compact()
            self.imports.append(imp)

        r.pos = export_offset
        self.exports = []
        for i in range(export_count):
            e = utxedit.Export()
            e.index = i
            e.class_index = r.compact()
            e.super_index = r.compact()
            e.package_index = r.i32()
            e.name_index = r.compact()
            e.object_flags = r.u32()
            e.serial_size = r.compact()
            e.serial_offset = r.compact() if e.serial_size else 0
            self.exports.append(e)


def read_props_ue2(pkg, r):
    """Parse a UE1/UE2 property tag stream (FPropertyTag: name FName, then an
    info byte: bit7=array, bits4-6=size selector, bits0-3=type).
    -> {prop_name: raw_value_bytes or bool}."""
    out = {}
    while True:
        tag = pkg.name(r.compact())
        if tag == 'None':
            return out
        info = r.u8()
        is_array = bool(info & 0x80)
        ptype = info & 0xF
        if ptype == 10:  # StructProperty
            r.compact()
        sel = (info >> 4) & 7
        if sel == 0:
            size = 1
        elif sel == 1:
            size = 2
        elif sel == 2:
            size = 4
        elif sel == 3:
            size = 12
        elif sel == 4:
            size = 16
        elif sel == 5:
            size = r.u8()
        elif sel == 6:
            size = r.u16()
        else:
            size = r.i32()
        if ptype != 3 and is_array:  # not BoolProperty: read array index
            b = r.u8()
            if b < 128:
                pass
            elif b & 0x40:
                r.pos += 3
            else:
                r.pos += 1
        if ptype == 3:  # BoolProperty: value is the array flag
            out[tag] = is_array
        else:
            out[tag] = r.bytes(size)


def resolve_texture(pkg, obj_name, _depth=0):
    """Resolve a material object to its diffuse Texture object name.

    L2 chargrp.dat references materials by name; most body materials are
    Shader objects whose Diffuse points at the real bitmap (often named
    '<base>_sp' or '<base>_ori' — it doubles as specularity mask).
    TexModifiers are followed through their Material slot."""
    exp = None
    for e in pkg.exports:
        if pkg.export_name(e).lower() == obj_name.lower():
            exp = e
            break
    assert exp, '%s not in package' % obj_name
    return _resolve_export(pkg, exp, _depth)


def _resolve_export(pkg, exp, _depth=0):
    assert _depth < 8, 'material chain too deep'
    cls = pkg.class_name_of(exp)
    if cls == 'Texture':
        return pkg.export_name(exp)
    r = utxedit.Reader(pkg.data, exp.serial_offset)
    props = read_props_ue2(pkg, r)
    ref = props.get('Diffuse')
    if ref is None:
        ref = props.get('Material')
    assert ref is not None, '%s (%s): no Diffuse/Material property' % (
        pkg.export_name(exp), cls)
    rr = utxedit.Reader(ref)
    ci = rr.compact()
    assert ci > 0, '%s: Diffuse is null or an import (%d)' % (
        pkg.export_name(exp), ci)
    return _resolve_export(pkg, pkg.exports[ci - 1], _depth + 1)


def obj_ref(pkg, ci):
    """Resolve a compact-index object reference to (package, name)."""
    if ci == 0:
        return None
    if ci > 0:
        e = pkg.exports[ci - 1]
        return (None, pkg.export_name(e))
    imp = pkg.imports[-ci - 1]
    pkg_name = pkg.name(imp.class_package) if imp.class_package >= 0 else '?'
    # outer package of the import: package_index -> export (Package) or import
    outer = imp.package_index
    while outer != 0:
        if outer > 0:
            pkg_name = pkg.export_name(pkg.exports[outer - 1])
            break
        outer = pkg.imports[-outer - 1].package_index
        pkg_name = pkg.name(pkg.imports[-outer - 1].object_name) if False else pkg_name
    return (pkg_name, pkg.name(imp.object_name))


def skip_props(pkg, r):
    """Skip the UObject property tag stream. Returns after the 'None' tag."""
    tags = []
    while True:
        name_idx = r.compact()
        tag = pkg.name(name_idx)
        if tag == 'None':
            return tags
        tags.append(tag)
        type_idx = r.compact()
        ptype = pkg.name(type_idx)
        size = r.i32()
        r.i32()  # array index
        if ptype == 'BoolProperty':
            r.u8()
        elif ptype == 'StructProperty':
            r.compact()  # struct name
        r.pos += size


def mesh_textures(pkg, export):
    """-> (version, textures, materials, props) for a SkeletalMesh export.

    textures: list of (package, name) per ULodMesh.Textures slot
    materials: list of TextureIndex per ULodMesh.Materials slot
    """
    r = utxedit.Reader(pkg.data, export.serial_offset)
    tags = skip_props(pkg, r)
    r.pos += 25  # FBox: Min(12) + Max(12) + IsValid byte
    r.pos += 16  # FSphere
    version = r.i32()
    r.i32()  # VertexCount
    # UE2 serializes TArray counts as FCompactIndex (bit7=sign, bit6=more)
    n = r.compact()  # Verts (empty for USkeletalMesh)
    assert 0 <= n < 100000, 'bad vert count %d (parse desync?)' % n
    r.pos += 4 * n
    ntex = r.compact()  # Textures: TArray<UObject*>
    assert 0 <= ntex < 64, 'bad texture count %d (parse desync?)' % ntex
    tex_refs = [r.compact() for _ in range(ntex)]
    r.pos += 36  # MeshScale, MeshOrigin, RotOrigin
    if version <= 1:
        n2 = r.compact()
        r.pos += 2 * n2
    for elemsize in (2, 8, 2, 10):  # FaceLevel, Faces, CollapseWedgeThus, Wedges
        cnt = r.compact()
        assert 0 <= cnt < 1000000, 'array desync'
        r.pos += elemsize * cnt
    nmat = r.compact()  # Materials: TArray<FMeshMaterial>
    assert 0 <= nmat < 64, 'bad material count %d' % nmat
    mats = []
    for _ in range(nmat):
        r.u32()  # PolyFlags
        mats.append(r.i32())  # TextureIndex
    textures = [obj_ref(pkg, t) for t in tex_refs]
    return version, textures, mats, tags


def main():
    path = sys.argv[1]
    want = set(sys.argv[2:])
    plain, _proto = utxedit.load_package(path)
    pkg = Package(plain)
    for e in pkg.exports:
        if pkg.class_name_of(e) != 'SkeletalMesh' or not e.serial_size:
            continue
        name = pkg.export_name(e)
        if want and name not in want:
            continue
        try:
            ver, textures, mats, tags = mesh_textures(pkg, e)
        except Exception as exc:
            print('%s: PARSE FAIL: %s' % (name, exc))
            continue
        tex_names = [('?pkg.%s' % t[1]) if t and not t[0]
                     else ('%s.%s' % t if t else 'None') for t in textures]
        used = [tex_names[i] if 0 <= i < len(tex_names) else '?%d' % i
                for i in mats]
        print('%s (v%d): sections=%s%s' % (
            name, ver, used,
            ' props=%s' % tags if tags else ''))


if __name__ == '__main__':
    main()
