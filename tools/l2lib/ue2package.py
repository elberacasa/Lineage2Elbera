"""UE2 (Unreal Engine 2) package parser for Lineage 2 Interlude.

Pure Python 3 stdlib. Handles the package container shared by .utx, .ukx,
.unr and .u files: FPackageFileSummary header, name/import/export tables,
FCompactIndex, property tags (both serialisation variants found in L2
packages), Texture bodies (tagged properties + native mipmap array),
Shader/FinalBlend/TexModifier -> diffuse texture resolution, and the
Lineage2Ver file encryption (native decode for protocol 121, external
tools/bin/l2encdec for the others).

Format knowledge reverse-engineered from UEViewer sources and verified
against the Interlude client files in this repository (see README.md).

FPackageFileSummary (UE2, Interlude uses version 117 for .utx and 123 for
.ukx, both with the same table layout):

    u32 tag = 0x9E2A83C1
    u16 FileVersion, u16 LicenseeVersion
    u32 PackageFlags
    u32 NameCount,  u32 NameOffset
    u32 ExportCount, u32 ExportOffset
    u32 ImportCount, u32 ImportOffset
    byte[16] Guid
    u32 GenerationCount, per generation: u32 ExportCount, u32 NameCount

Name table entry:    FString (compact-index length incl. NUL, then bytes),
                     u32 flags. Negative length = UTF-16LE.
Import entry:        nameidx ClassPackage, nameidx ClassName,
                     i32 PackageIndex, nameidx ObjectName
Export entry:        cidx ClassIndex, cidx SuperIndex, i32 PackageIndex,
                     nameidx ObjectName, u32 ObjectFlags, cidx SerialSize,
                     cidx SerialOffset (only when SerialSize != 0)

Object references are FCompactIndex values: 0 = None, >0 = export (1-based),
<0 = import (-ci-1 indexes the import table).

Exports whose ObjectFlags carry RF_HasStack (0x02000000) serialise a UE2
FStateFrame BEFORE the property stream. Every scripted Actor in a .unr map
tile has it (StaticMeshActor, ZoneInfo, MusicVolume, LevelInfo, Light, ...):

    cidx  Node            (the actor's class import; 0 = None)
    cidx  StateNode       (same value as Node in every retail map actor)
    i64   ProbeMask       (-1 in every retail map actor)
    i32   LatentAction
    cidx  Offset          (present only when Node != 0; -1 in retail maps)

The frame is 15 bytes when Node encodes in one compact byte and 17 when it
needs two -- which is the "15- or 17-byte native header" of
docs/map-format.md 3.1, finally given a name (that section guessed the size
tracked LicenseeVersion; it actually tracks the class's import index).
read_state_frame() / Package.actor_body_reader() skip it. Exports without
the flag (AmbientSoundObject, LevelSummary) begin at their properties.
"""

import os
import shutil
import struct
import subprocess
import tempfile

PACKAGE_TAG = 0x9E2A83C1

# UE2 EObjectFlags: the object's body starts with a serialised FStateFrame
RF_HAS_STACK = 0x02000000

# ETextureFormat (UE2, from UEViewer UnMaterial2.h)
TEXF_P8 = 0
TEXF_RGBA7 = 1
TEXF_RGB16 = 2
TEXF_DXT1 = 3
TEXF_RGB8 = 4
TEXF_RGBA8 = 5
TEXF_NODATA = 6
TEXF_DXT3 = 7
TEXF_DXT5 = 8
TEXF_L8 = 9
TEXF_G16 = 10

FORMAT_NAMES = {
    TEXF_P8: "P8", TEXF_RGBA7: "RGBA7", TEXF_RGB16: "RGB16",
    TEXF_DXT1: "DXT1", TEXF_RGB8: "RGB8", TEXF_RGBA8: "RGBA8",
    TEXF_NODATA: "NODATA", TEXF_DXT3: "DXT3", TEXF_DXT5: "DXT5",
    TEXF_L8: "L8", TEXF_G16: "G16",
}

# EPropertyType (UE1/UE2)
PROP_BYTE = 1
PROP_INT = 2
PROP_BOOL = 3
PROP_FLOAT = 4
PROP_OBJECT = 5
PROP_NAME = 6
PROP_STRING = 7
PROP_CLASS = 8
PROP_ARRAY = 9
PROP_STRUCT = 10
PROP_VECTOR = 11
PROP_ROTATOR = 12
PROP_STR = 13
PROP_MAP = 14
PROP_FIXED_ARRAY = 15

_L2LIB_DIR = os.path.dirname(os.path.abspath(__file__))
L2ENCDEC = os.path.normpath(os.path.join(_L2LIB_DIR, "..", "bin", "l2encdec"))


class L2Error(Exception):
    """Base error for everything raised by l2lib."""


# --------------------------------------------------------------------------
# low-level reader + FCompactIndex
# --------------------------------------------------------------------------

class Reader(object):
    """Bounds-checked little-endian cursor over a bytes-like object."""

    def __init__(self, data, pos=0, path="<bytes>"):
        self.data = data
        self.pos = pos
        self.path = path

    def _take(self, n):
        if self.pos + n > len(self.data):
            raise L2Error("%s: need %d bytes at 0x%X, only %d left"
                          % (self.path, n, self.pos,
                             len(self.data) - self.pos))
        chunk = self.data[self.pos:self.pos + n]
        self.pos += n
        return chunk

    def u8(self):
        return self._take(1)[0]

    def u16(self):
        return struct.unpack("<H", self._take(2))[0]

    def u32(self):
        return struct.unpack("<I", self._take(4))[0]

    def i32(self):
        return struct.unpack("<i", self._take(4))[0]

    def f32(self):
        return struct.unpack("<f", self._take(4))[0]

    def bytes(self, n):
        return self._take(n)

    def compact(self):
        """UE1/UE2 FCompactIndex (AR_INDEX).

        First byte: bit7 = sign, bit6 = has-more, bits0-5 = value.
        Following bytes: bit7 = has-more, bits0-6 = value (7 bits each,
        little-endian base-128 continuation). THE gotcha: the continuation
        flag sits on bit6 of the FIRST byte but on bit7 of all later bytes.
        """
        b0 = self.u8()
        negative = bool(b0 & 0x80)
        value = b0 & 0x3F
        if b0 & 0x40:
            shift = 6
            while True:
                b = self.u8()
                value |= (b & 0x7F) << shift
                shift += 7
                if not (b & 0x80):
                    break
        return -value if negative else value


def encode_compact(value):
    """Inverse of Reader.compact (used for sanity checks / writers)."""
    negative = value < 0
    v = abs(value)
    b0 = v & 0x3F
    if negative:
        b0 |= 0x80
    if v <= 0x3F:
        return bytes([b0])
    out = bytearray([b0 | 0x40])
    v >>= 6
    while True:
        b = v & 0x7F
        v >>= 7
        if v:
            b |= 0x80
        out.append(b)
        if not v:
            return bytes(out)


# --------------------------------------------------------------------------
# package tables
# --------------------------------------------------------------------------

class Export(object):
    __slots__ = ("index", "class_index", "super_index", "package_index",
                 "name_index", "object_flags", "serial_size", "serial_offset")

    def __repr__(self):
        return "<Export #%d name_index=%d size=%d offset=0x%X>" % (
            self.index, self.name_index, self.serial_size, self.serial_offset)


class Import(object):
    __slots__ = ("class_package", "class_name", "package_index", "object_name")


class Package(object):
    """Parsed UE2 package. Works for any table-layout-compatible version
    (Interlude ships 117 for .utx and 123/30 for .ukx)."""

    def __init__(self, data, path="<bytes>"):
        self.data = data
        self.path = path
        r = Reader(data, path=path)
        tag = r.u32()
        if tag != PACKAGE_TAG:
            raise L2Error("%s: not an Unreal package (bad tag 0x%08X)"
                          % (path, tag))
        self.file_version = r.u16()
        self.licensee_version = r.u16()
        if not 100 <= self.file_version <= 130:
            raise L2Error(
                "%s: unsupported package version %d (expected UE2-era "
                "100..130; Interlude ships 117 and 123)"
                % (path, self.file_version))
        self.package_flags = r.u32()
        name_count = r.u32()
        name_offset = r.u32()
        export_count = r.u32()
        export_offset = r.u32()
        import_count = r.u32()
        import_offset = r.u32()
        self.guid = r.bytes(16)
        gen_count = r.u32()
        self.generations = [(r.u32(), r.u32()) for _ in range(gen_count)]

        # --- name table ---
        r.pos = name_offset
        self.names = []
        for _ in range(name_count):
            length = r.compact()
            if length == 0:
                self.names.append("")
                continue
            if length < 0:  # UTF-16 (rare; Korean clients)
                raw = r.bytes(-length * 2)
                self.names.append(raw[:-2].decode("utf-16-le", "replace"))
            else:
                raw = r.bytes(length)
                self.names.append(raw[:-1].decode("latin-1"))
            r.u32()  # name flags

        # --- import table ---
        r.pos = import_offset
        self.imports = []
        for _ in range(import_count):
            imp = Import()
            imp.class_package = r.compact()
            imp.class_name = r.compact()
            imp.package_index = r.i32()
            imp.object_name = r.compact()
            self.imports.append(imp)

        # --- export table ---
        r.pos = export_offset
        self.exports = []
        for i in range(export_count):
            e = Export()
            e.index = i
            e.class_index = r.compact()
            e.super_index = r.compact()
            e.package_index = r.i32()
            e.name_index = r.compact()
            e.object_flags = r.u32()
            e.serial_size = r.compact()
            e.serial_offset = r.compact() if e.serial_size else 0
            self.exports.append(e)

    # -- name / reference helpers --

    def name(self, index):
        if 0 <= index < len(self.names):
            return self.names[index]
        raise L2Error("%s: bad name index %d" % (self.path, index))

    def export_name(self, export):
        return self.name(export.name_index)

    def class_name_of(self, export):
        ci = export.class_index
        if ci < 0:
            return self.name(self.imports[-ci - 1].object_name)
        if ci > 0:
            return self.name(self.exports[ci - 1].name_index)
        return "Class"

    def import_name(self, imp):
        return self.name(imp.object_name)

    def find_export(self, name, cls=None):
        """First export with this object name (case-insensitive)."""
        want = name.lower()
        for e in self.exports:
            if self.export_name(e).lower() == want:
                if cls is None or self.class_name_of(e) == cls:
                    return e
        return None

    def exports_by_class(self, cls):
        return [e for e in self.exports
                if self.class_name_of(e) == cls and e.serial_size > 0]

    def resolve_ref(self, ci):
        """FCompactIndex object reference -> Export, Import or None."""
        if ci > 0:
            if ci - 1 >= len(self.exports):
                raise L2Error("%s: export ref %d out of range"
                              % (self.path, ci))
            return self.exports[ci - 1]
        if ci < 0:
            if -ci - 1 >= len(self.imports):
                raise L2Error("%s: import ref %d out of range"
                              % (self.path, ci))
            return self.imports[-ci - 1]
        return None

    def ref_name(self, ci):
        """Human-readable (package, name) for an object reference."""
        obj = self.resolve_ref(ci)
        if obj is None:
            return None
        if isinstance(obj, Export):
            return (None, self.export_name(obj))
        # import: walk the package_index chain for the outer package name
        pkg_name = None
        outer = obj.package_index
        while outer != 0:
            if outer > 0:
                pkg_name = self.export_name(self.exports[outer - 1])
                break
            o = self.imports[-outer - 1]
            pkg_name = self.name(o.object_name)
            outer = o.package_index
        if pkg_name is None:
            pkg_name = self.name(obj.class_package) \
                if obj.class_package >= 0 else "?"
        return (pkg_name, self.name(obj.object_name))

    def body_reader(self, export):
        return Reader(self.data, export.serial_offset, path=self.path)

    def actor_body_reader(self, export):
        """body_reader positioned past the RF_HasStack FStateFrame, if any.

        Use this instead of body_reader for map actors: scripted Actors
        (ObjectFlags & RF_HAS_STACK) do not begin with properties.
        """
        r = self.body_reader(export)
        if export.object_flags & RF_HAS_STACK:
            read_state_frame(self, r)
        return r


class StateFrame(object):
    """A UE2 FStateFrame as serialised in front of an RF_HasStack body."""

    __slots__ = ("node", "state_node", "probe_mask", "latent_action",
                 "offset", "size")

    def __repr__(self):
        return ("<StateFrame node=%d state=%d probe=%d latent=%d offset=%s "
                "size=%d>" % (self.node, self.state_node, self.probe_mask,
                              self.latent_action, self.offset, self.size))


def read_state_frame(pkg, r):
    """Consume the FStateFrame at r (see the module docstring) -> StateFrame.

    Offset is only serialised when Node is a real reference; a None Node
    (index 0) has no execution position to record.
    """
    start = r.pos
    f = StateFrame()
    f.node = r.compact()
    f.state_node = r.compact()
    f.probe_mask = struct.unpack("<q", r.bytes(8))[0]
    f.latent_action = r.i32()
    f.offset = r.compact() if f.node else None
    f.size = r.pos - start
    return f


# --------------------------------------------------------------------------
# property tags
# --------------------------------------------------------------------------
# L2 packages contain TWO property-tag serialisations:
#
#   "packed" (UE1-style, FPropertyTag compact form) -- used by UTexture and
#   UMaterial-derived exports (Shader, FinalBlend, TexModifier...) even in
#   v123 .ukx packages:
#       nameidx Name ("None" ends the list)
#       u8 info: bit7 = array flag / bool value, bits4-6 = size selector,
#                bits0-3 = EPropertyType
#       [nameidx StructName if type == StructProperty]
#       [array index (1/2/4 bytes) if array flag and type != BoolProperty]
#       DataSize bytes of value (0 bytes for BoolProperty; the value is the
#       array flag bit)
#     Size selector: 0->1, 1->2, 2->4, 3->12, 4->16, 5->u8, 6->u16, 7->u32.
#
#   "tagged" (UE2-style FPropertyTag) -- used by USkeletalMesh and other
#   Engine-serialised bodies:
#       nameidx Name, nameidx Type, i32 Size, i32 ArrayIndex,
#       [nameidx StructName if StructProperty], [u8 value if BoolProperty],
#       Size bytes of value.
#
# read_properties(fmt="auto") prefers by package version (< 120 -> packed)
# and falls back to the other variant when the first one desyncs.

_PACKED_SIZES = {0: 1, 1: 2, 2: 4, 3: 12, 4: 16}


def _read_props_packed(pkg, r):
    props = {}
    while True:
        name = pkg.name(r.compact())
        if name == "None":
            return props
        info = r.u8()
        ptype = info & 0x0F
        is_array = bool(info & 0x80)
        size_sel = (info >> 4) & 7
        if ptype == 0:
            raise L2Error("%s: invalid packed property type 0 at 0x%X"
                          % (pkg.path, r.pos))
        if ptype == PROP_STRUCT:
            r.compact()  # StructName
        if size_sel in _PACKED_SIZES:
            data_size = _PACKED_SIZES[size_sel]
        elif size_sel == 5:
            data_size = r.u8()
        elif size_sel == 6:
            data_size = r.u16()
        else:
            data_size = r.u32()
        if ptype != PROP_BOOL and is_array:
            # array index: 1, 2 or 4 bytes
            b = r.u8()
            if b < 128:
                pass
            elif b & 0x40:
                r.bytes(3)
            else:
                r.bytes(1)
        if ptype == PROP_BOOL:
            props[name] = is_array  # bool value lives in the array flag
        else:
            props[name] = r.bytes(data_size)


def _read_props_tagged(pkg, r):
    props = {}
    while True:
        name = pkg.name(r.compact())
        if name == "None":
            return props
        ptype = pkg.name(r.compact())
        size = r.i32()
        r.i32()  # array index
        # sanity: real UE2 type names all end in "Property"; a spurious
        # match on packed-format data must fail fast so auto mode can fall
        # back instead of returning garbage
        if not ptype.endswith("Property") or not 0 <= size < 0x1000000:
            raise L2Error("%s: implausible tagged property '%s' size %d "
                          "at 0x%X" % (pkg.path, ptype, size, r.pos))
        if ptype == "BoolProperty":
            props[name] = bool(r.u8())
        else:
            if ptype == "StructProperty":
                r.compact()  # struct name
            props[name] = r.bytes(size)


def read_properties(pkg, r, fmt="auto"):
    """Read a property tag stream terminated by the 'None' name.

    fmt: "packed", "tagged" or "auto" (prefer by package version, fall back
    to the other variant if the preferred one desyncs).
    Returns {prop_name: raw_value_bytes or bool}.
    """
    if fmt not in ("auto", "packed", "tagged"):
        raise ValueError("fmt must be 'auto', 'packed' or 'tagged'")
    if fmt == "packed":
        return _read_props_packed(pkg, r)
    if fmt == "tagged":
        return _read_props_tagged(pkg, r)
    order = (_read_props_packed, _read_props_tagged) \
        if pkg.file_version < 120 else (_read_props_tagged, _read_props_packed)
    last_exc = None
    for fn in order:
        mark = r.pos
        try:
            return fn(pkg, r)
        except (L2Error, IndexError, UnicodeDecodeError, struct.error) as exc:
            last_exc = exc
            r.pos = mark
    raise L2Error("%s: property stream unreadable at 0x%X (%s)"
                  % (pkg.path, r.pos, last_exc))


# --------------------------------------------------------------------------
# Texture bodies
# --------------------------------------------------------------------------
# Lineage 2 serializes extra UMaterial fields after the property stream in
# every material-derived export (UEViewer UnMaterial2.h UMaterial::Serialize,
# LINEAGE2 block). For ArVer >= 123 && 16 <= ArLicenseeVer < 37 there is an
# extra i32 ("unk1", obsolete Reserved). For ArLicenseeVer in [30, 37) a
# full shader block follows: blend state, a 1KB matrix table, FC_* color
# ints, 16 texture-name FStrings and the ShaderCode FString. Interlude
# texture packages are 123/28 (unk1 only); Fighter.ukx is 123/30 (full
# block). Only then comes the native mipmap array.

class Mip(object):
    __slots__ = ("u", "v", "data_offset", "data_size")


class TextureInfo(object):
    __slots__ = ("export", "format", "props", "mips", "body_end",
                 "l2_material")

    @property
    def format_name(self):
        return FORMAT_NAMES.get(self.format, "fmt%d" % self.format)


def read_fstring(r):
    """UE2 FString: compact-index length INCLUDING the NUL terminator
    (negative = UTF-16LE char count), then bytes."""
    length = r.compact()
    if length == 0:
        return ""
    if length < 0:
        raw = r.bytes(-length * 2)
        return raw[:-2].decode("utf-16-le", "replace")
    return r.bytes(length)[:-1].decode("latin-1")


def read_lineage_material_block(pkg, r):
    """Read the extra L2 fields UMaterial::Serialize appends after the
    property stream (see module comment above). Returns a dict; the caller
    must only invoke this when pkg.file_version >= 123."""
    lic = pkg.licensee_version
    if not 16 <= lic < 37:
        return None
    out = {"unk1": r.i32()}
    if lic < 30:
        return out
    if 33 <= lic < 36:
        out["material_info"] = r.u8()
    out["texture_transform"] = r.u8()
    out["max_sampler_num"] = r.u8()
    out["max_texmat_num"] = r.u8()
    out["max_pass_num"] = r.u8()
    out["two_pass_render_state"] = r.u8()
    out["alpha_ref"] = r.u8()
    out["src_blend"] = r.i32()
    out["dest_blend"] = r.i32()
    out["overridden_fog_color"] = r.i32()
    for _ in range(8):           # matTexMatrix[16]: really 1KB of data
        r.u8()
        if lic < 36:
            r.u8()
        r.bytes(126)
    out["fc_color"] = r.bytes(8)  # FC_Color1/FC_Color2 union (strange order)
    out["fc_fade_period"] = r.i32()
    out["fc_fade_phase"] = r.i32()
    out["fc_color_fade_type"] = r.i32()
    out["str_tex"] = [read_fstring(r) for _ in range(16)]
    out["shader_code"] = read_fstring(r)
    return out


def parse_texture(pkg, export, data=None):
    """Parse a Texture export body: tagged properties + native mipmap array.

    Body layout (after the property list and the L2 material block, when
    present):
        cidx MipCount
        per mip: i32 SkipPos, cidx DataCount, byte[DataCount] Data,
                 i32 USize, i32 VSize, u8 UBits, u8 VBits
    """
    if pkg.class_name_of(export) != "Texture":
        raise L2Error("%s: export '%s' is a %s, not a Texture"
                      % (pkg.path, pkg.export_name(export),
                         pkg.class_name_of(export)))
    r = pkg.body_reader(export)
    end = export.serial_offset + export.serial_size
    # UTexture/UMaterial bodies in ALL L2 packages (v117 and v123 alike)
    # use the packed UE1-style property stream -- verified against
    # UEViewer and every Interlude package in this repository.
    props = read_properties(pkg, r, fmt="packed")
    tex = TextureInfo()
    tex.export = export
    tex.props = props
    tex.l2_material = None
    if pkg.file_version >= 123:
        tex.l2_material = read_lineage_material_block(pkg, r)
    fmt = props.get("Format")
    if fmt is None:
        # property equals the UTexture class default and was not
        # serialized: TEXF_P8 (palettized; see the Palette object ref)
        tex.format = TEXF_P8
    elif len(fmt) != 1:
        raise L2Error("%s: texture '%s' has a malformed 'Format' property"
                      % (pkg.path, pkg.export_name(export)))
    else:
        tex.format = fmt[0]
    mip_count = r.compact()
    tex.mips = []
    for _ in range(mip_count):
        r.u32()  # SkipPos (lazy-array bookkeeping, ignored)
        data_size = r.compact()
        m = Mip()
        m.data_size = data_size
        m.data_offset = r.pos
        r.pos += data_size
        m.u = r.i32()
        m.v = r.i32()
        r.u8()  # UBits
        r.u8()  # VBits
        tex.mips.append(m)
    tex.body_end = r.pos
    if r.pos > end:
        raise L2Error("%s: texture '%s' mip data overruns export body"
                      % (pkg.path, pkg.export_name(export)))
    return tex


def mip_bytes(pkg, mip):
    return pkg.data[mip.data_offset:mip.data_offset + mip.data_size]


def parse_palette(pkg, export):
    """Parse a UPalette export body -> 256*4 bytes of B,G,R,A colors.

    UPalette is a plain UObject (NO Lineage2 UMaterial block): property
    stream, then TArray<FColor> Colors (cidx count, count*4 bytes).
    """
    if pkg.class_name_of(export) != "Palette":
        raise L2Error("%s: export '%s' is a %s, not a Palette"
                      % (pkg.path, pkg.export_name(export),
                         pkg.class_name_of(export)))
    r = pkg.body_reader(export)
    read_properties(pkg, r)
    count = r.compact()
    if count <= 0 or count > 65536:
        raise L2Error("%s: palette '%s' has bad color count %d"
                      % (pkg.path, pkg.export_name(export), count))
    return r.bytes(count * 4)


# --------------------------------------------------------------------------
# material resolution (Shader / FinalBlend / TexModifier -> diffuse Texture)
# --------------------------------------------------------------------------

#: material classes whose body is just a property stream and which forward
#: to another material/texture through one of these property names
_FORWARD_PROPS = ("Diffuse", "Material", "Material1", "FallbackMaterial")


def resolve_material(pkg, obj, _depth=0):
    """Resolve a material object (name or Export) to the Export of the
    underlying diffuse Texture.

    L2 chargrp/mesh references point at Shader objects whose Diffuse slot
    holds the real bitmap; FinalBlend/TexModifier chain through Material.
    Returns None when the chain ends at an import or null reference.
    """
    if _depth > 16:
        raise L2Error("%s: material chain too deep (cycle?)" % pkg.path)
    if isinstance(obj, str):
        obj = pkg.find_export(obj)
        if obj is None:
            raise L2Error("%s: no export named '%s'" % (pkg.path, obj))
    cls = pkg.class_name_of(obj)
    if cls == "Texture":
        return obj
    r = pkg.body_reader(obj)
    props = read_properties(pkg, r, fmt="packed")  # L2 material bodies
    for key in _FORWARD_PROPS:
        ref = props.get(key)
        if ref is None:
            continue
        ci = Reader(ref).compact()
        nxt = pkg.resolve_ref(ci)
        if isinstance(nxt, Export):
            return resolve_material(pkg, nxt, _depth + 1)
        return None  # import or null: texture lives in another package
    raise L2Error("%s: %s (%s) has no Diffuse/Material property"
                  % (pkg.path, pkg.export_name(obj), cls))


# --------------------------------------------------------------------------
# SkeletalMesh -> material bindings (ULodMesh serialization, UE2)
# --------------------------------------------------------------------------

def mesh_material_slots(pkg, export):
    """-> (version, textures, materials) for a SkeletalMesh export.

    Every USkeletalMesh serializes (see UEViewer UnMesh2.cpp):
        UObject::Serialize    -> property tag stream ("tagged" variant)
        UPrimitive::Serialize -> FBox BoundingBox (24B + 1B) + FSphere (16B)
        ULodMesh::Serialize   -> Version i32, VertexCount i32,
            Verts TArray<FMeshVert 4B>, Textures TArray<UObject*>,
            MeshScale/MeshOrigin/RotOrigin (36B),
            FaceLevel TArray<u16>, Faces TArray<FMeshFace 8B>,
            CollapseWedgeThus TArray<u16>, Wedges TArray<FMeshWedge 10B>,
            Materials TArray<FMeshMaterial { u32 PolyFlags, i32 TextureIndex }>

    textures: list of (package, name) per Textures slot (None for null refs)
    materials: list of TextureIndex per Materials slot (indexes `textures`)
    """
    r = pkg.body_reader(export)
    read_properties(pkg, r)  # usually just the terminating "None"
    r.pos += 25  # FBox: Min(12) + Max(12) + IsValid byte
    r.pos += 16  # FSphere
    version = r.i32()
    r.i32()  # VertexCount
    n = r.compact()  # Verts (empty for USkeletalMesh)
    if not 0 <= n < 1000000:
        raise L2Error("%s: bad vert count %d in '%s' (parse desync?)"
                      % (pkg.path, n, pkg.export_name(export)))
    r.pos += 4 * n
    ntex = r.compact()  # Textures: TArray<UObject*>
    if not 0 <= ntex < 256:
        raise L2Error("%s: bad texture count %d in '%s' (parse desync?)"
                      % (pkg.path, ntex, pkg.export_name(export)))
    tex_refs = [r.compact() for _ in range(ntex)]
    r.pos += 36  # MeshScale, MeshOrigin, RotOrigin
    if version <= 1:
        n2 = r.compact()
        r.pos += 2 * n2
    for elemsize in (2, 8, 2, 10):  # FaceLevel, Faces, CollapseWedgeThus, Wedges
        cnt = r.compact()
        if not 0 <= cnt < 10000000:
            raise L2Error("%s: array desync in '%s'"
                          % (pkg.path, pkg.export_name(export)))
        r.pos += elemsize * cnt
    nmat = r.compact()  # Materials: TArray<FMeshMaterial>
    if not 0 <= nmat < 256:
        raise L2Error("%s: bad material count %d in '%s'"
                      % (pkg.path, nmat, pkg.export_name(export)))
    mats = []
    for _ in range(nmat):
        r.u32()  # PolyFlags
        mats.append(r.i32())  # TextureIndex
    textures = [pkg.ref_name(t) for t in tex_refs]
    return version, textures, mats


# --------------------------------------------------------------------------
# Lineage2Ver file encryption
# --------------------------------------------------------------------------
# Encrypted L2 files start with a UTF-16LE header "Lineage2VerNNN" (28
# bytes) and end with a 20-byte l2encdec tail (crc32 + padding). The
# payload cipher depends on the protocol:
#   111       - fixed XOR key
#   120       - XOR with position-dependent key
#   121       - single-byte XOR; key = checksum of the original file name
#               (we recover it from the known package tag instead, like
#               UEViewer, so renamed files still decode)
#   211/212   - Blowfish
#   411-414   - RSA (used by the system/*.dat files; Interlude = 413)

L2_MAGIC_PREFIX = b"L\x00i\x00n\x00e\x00a\x00g\x00e\x002\x00V\x00e\x00r\x00"
L2_HEADER_SIZE = 28  # "Lineage2VerNNN" as UTF-16LE
L2_TAIL_SIZE = 20    # l2encdec trailer (crc32 + padding), added after cipher


def detect_protocol(data):
    """Return the Lineage2Ver protocol number, or None if not encrypted."""
    if not data.startswith(L2_MAGIC_PREFIX):
        return None
    text = data[:32].decode("utf-16-le", "ignore")
    digits = ""
    for ch in text[len("Lineage2Ver"):]:
        if ch.isdigit():
            digits += ch
        else:
            break
    return int(digits) if digits else None


def decode_121(data):
    """Decode a Lineage2Ver121 file in pure Python.

    Protocol 121 is a single-byte XOR over the payload; the key is a
    checksum of the *original* file name. Like UEViewer, we recover the key
    from the first payload byte instead (the package tag 0x9E2A83C1 is
    known), so this works even when the file was renamed."""
    if len(data) < L2_HEADER_SIZE + L2_TAIL_SIZE + 4:
        raise L2Error("file too small for a Lineage2Ver121 package")
    payload = data[L2_HEADER_SIZE:len(data) - L2_TAIL_SIZE]
    key = payload[0] ^ (PACKAGE_TAG & 0xFF)
    return bytes(b ^ key for b in payload)


def run_l2encdec(command, protocol, src_bytes, key_filename=None,
                 l2encdec_path=L2ENCDEC):
    """Run tools/bin/l2encdec on src_bytes, return the output bytes.

    key_filename is required for protocol 121 (XOR_FILENAME): the XOR key
    is the checksum of the file's base name, so we force the original name
    with -f regardless of the temp file's actual name."""
    if not os.path.exists(l2encdec_path):
        raise L2Error("l2encdec not found at %s" % l2encdec_path)
    tmpdir = tempfile.mkdtemp(prefix="l2lib_")
    try:
        src = os.path.join(tmpdir, "in.bin")
        dst = os.path.join(tmpdir, "out.bin")
        with open(src, "wb") as f:
            f.write(src_bytes)
        argv = [l2encdec_path, "-c", command, "-p", str(protocol)]
        if key_filename:
            argv += ["-f", key_filename]
        argv += ["-o", dst, src]
        proc = subprocess.run(argv, capture_output=True, text=True)
        if proc.returncode != 0 or not os.path.exists(dst):
            raise L2Error("l2encdec %s (protocol %s) failed: %s%s"
                          % (command, protocol, proc.stdout, proc.stderr))
        with open(dst, "rb") as f:
            return f.read()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def decrypt_file_bytes(data, filename="<bytes>"):
    """Decrypt one Lineage2Ver-encrypted file (or pass plaintext through).

    Returns (plain_bytes, protocol_or_None). Protocol 121 is decoded
    natively; everything else goes through tools/bin/l2encdec.
    """
    protocol = detect_protocol(data)
    if protocol is None:
        return data, None
    if protocol == 121:
        return decode_121(data), protocol
    plain = run_l2encdec("decode", protocol, data,
                         os.path.basename(filename))
    return plain, protocol


def load_package(path):
    """Read a package file from disk, transparently decrypting it.

    Returns (Package, protocol_or_None)."""
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError as exc:
        raise L2Error("cannot read %s: %s" % (path, exc))
    plain, protocol = decrypt_file_bytes(data, os.path.basename(path))
    return Package(plain, path=path), protocol
