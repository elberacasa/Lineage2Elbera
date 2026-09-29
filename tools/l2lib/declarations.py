"""Elbera Tools: bounded Interlude file-123 property declarations.

These are saved reflection records, not linked offsets or current metadata.
Unknown kinds, tagged headers and inherited declaration bodies stay unsupported.
The conditional replication word precedes each subclass's reference payload.
"""

import hashlib

from .ue2package import L2Error, Reader, RF_HAS_STACK, qualified_ref
from .classdata import _name, _reference


SCALAR_KINDS = frozenset(
    ("IntProperty", "FloatProperty", "BoolProperty", "NameProperty", "StrProperty")
)
REFERENCE_KINDS = frozenset(
    (
        "ByteProperty",
        "ObjectProperty",
        "ClassProperty",
        "StructProperty",
        "ArrayProperty",
    )
)


def read_property_declaration(package, export):
    """Read one exact export, retaining dimensions and the optional network word.

    Dimensions are serialized signed values, not an inferred valid array size.
    ClassProperty carries both its inherited property class and metaclass.
    Reference identities retain their package/outer paths; zero remains null.
    """
    kind = package.class_name_of(export)
    if package.file_version != 123 or kind not in SCALAR_KINDS | REFERENCE_KINDS:
        raise L2Error("unsupported property declaration edition or kind")
    if export.object_flags & RF_HAS_STACK:
        raise L2Error("property declaration has an unsupported script frame")
    start, end = export.serial_offset, export.serial_offset + export.serial_size
    if not 0 <= start < end <= len(package.data):
        raise L2Error("invalid property declaration export boundary")
    reader = Reader(memoryview(package.data)[:end], start, package.path)
    if (
        package.name(_name(package, reader)) != "None"
        or _reference(package, reader) != 0
    ):
        raise L2Error("unsupported property declaration header")
    following = _reference(package, reader)
    dimension, flags = reader.i32(), reader.u32()
    category = package.name(_name(package, reader))
    replication_offset = reader.u16() if flags & 0x20 else None
    reference = _reference(package, reader) if kind in REFERENCE_KINDS else 0
    metaclass = _reference(package, reader) if kind == "ClassProperty" else 0
    if reader.pos != end:
        raise L2Error("property declaration does not end at its export boundary")
    return dict(
        name=package.export_name(export),
        kind=kind,
        next=following,
        arrayDim=dimension,
        propertyFlags=flags,
        category=category,
        replicationOffset=replication_offset,
        referenceIndex=reference,
        reference=qualified_ref(package, reference) if reference else None,
        metaClassIndex=metaclass,
        metaClass=qualified_ref(package, metaclass) if metaclass else None,
        exportRef=export.index + 1,
        exportSHA256=hashlib.sha256(package.data[start:end]).hexdigest(),
    )
