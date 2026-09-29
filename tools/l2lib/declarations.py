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


def read_field_link(package, export):
    """Read the bounded UField prefix, without interpreting its remaining body.

    Non-Class fields in this admitted edition start with an empty tagged
    UObject stream, then SuperField and Next. Function/State script contents
    are not needed to follow Next and are deliberately left uninterpreted.
    """
    kind = package.class_name_of(export)
    if package.file_version != 123 or kind not in (
        SCALAR_KINDS
        | REFERENCE_KINDS
        | {"Function", "State", "Struct", "Enum", "Const"}
    ):
        raise L2Error("unsupported field-link edition or kind")
    if export.object_flags & RF_HAS_STACK:
        raise L2Error("field link has an unsupported script frame")
    start, end = export.serial_offset, export.serial_offset + export.serial_size
    if not 0 <= start < end <= len(package.data):
        raise L2Error("invalid field-link export boundary")
    reader = Reader(memoryview(package.data)[:end], start, package.path)
    if package.name(_name(package, reader)) != "None":
        raise L2Error("unsupported tagged field-link header")
    parent, following = _reference(package, reader), _reference(package, reader)
    return dict(
        exportRef=export.index + 1,
        name=package.export_name(export),
        kind=kind,
        super=parent,
        next=following,
        sourceBytes=reader.pos - start,
        sourceSHA256=hashlib.sha256(package.data[start : reader.pos]).hexdigest(),
    )


def read_field_chain(package, owner, head):
    """Follow saved child links, preserving nonproperties and ownership stops.

    Import links require another package's current object and are unsupported.
    A foreign owner terminates traversal before its field is admitted, matching
    the original offset-linking loop. Cycles fail instead of looping forever.
    """
    if type(head) is not int:
        raise L2Error("field chain requires an integer child reference")
    rows, seen = [], set()
    while head:
        if type(head) is not int or not 0 < head <= len(package.exports):
            raise L2Error("field chain requires local export references")
        if head in seen:
            raise L2Error("cyclic field chain")
        seen.add(head)
        export = package.exports[head - 1]
        if export.package_index != owner.index + 1:
            break
        row = read_field_link(package, export)
        rows.append(row)
        head = row["next"]
    return dict(fields=rows, stoppedAt=head)


def read_struct_children(package, export):
    """Read through UStruct's saved child reference, leaving its body untouched.

    A Struct has UObject's empty tagged stream; unlike a Class prefix it does
    not bypass that stream. The saved SuperField must match the export table.
    No script length, script contents or current PropertiesSize is inferred.
    """
    if package.class_name_of(export) != "Struct":
        raise L2Error("structure child prefix requires a Struct export")
    field = read_field_link(package, export)
    if field["super"] != export.super_index:
        raise L2Error("structure superclass differs from export")
    start, end = export.serial_offset, export.serial_offset + export.serial_size
    reader = Reader(
        memoryview(package.data)[:end], start + field["sourceBytes"], package.path
    )
    script_text, children = _reference(package, reader), _reference(package, reader)
    return dict(
        **{key: field[key] for key in ("exportRef", "super", "next")},
        scriptText=script_text,
        children=children,
        sourceBytes=reader.pos - start,
        sourceSHA256=hashlib.sha256(package.data[start : reader.pos]).hexdigest(),
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
