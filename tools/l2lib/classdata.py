"""Elbera Tools: bounded file-123 UClass prefix and serialized default boundary.

Follows the original Core serializers, rather than searching for plausible
property tags. The bytecode walker supports only the qualified token paths
below; it does not execute script or interpret replication conditions.
See docs/native-class-defaults-evidence.md for source bindings and limits.
"""

import hashlib
import struct

from .ue2package import L2Error, Reader, RF_HAS_STACK, encode_compact

NO_OPERAND_TOKENS = frozenset(
    (0x08, 0x0B, 0x16, 0x17, 0x25, 0x26, 0x27, 0x28, 0x2A, 0x2D, 0x30, 0x31)
)
REFERENCE_TOKENS = frozenset((0x00, 0x01, 0x02, 0x29))
REFERENCE_EXPRESSION_TOKENS = frozenset((0x13, 0x2E))
WORD_EXPRESSION_TOKENS = frozenset((0x09, 0x18))
BYTE_TOKENS = frozenset((0x24, 0x2C))


def _compact(reader):
    start = reader.pos
    value = reader.compact()
    if not -(1 << 31) < value < (1 << 31):
        raise L2Error("class prefix compact index outside supported signed range")
    if bytes(reader.data[start : reader.pos]) != encode_compact(value):
        raise L2Error("noncanonical class prefix compact index")
    return value


def _reference(package, reader):
    value = _compact(reader)
    if not -len(package.imports) <= value <= len(package.exports):
        raise L2Error("class prefix object reference outside package table")
    return value


def _name(package, reader):
    value = _compact(reader)
    if not 0 <= value < len(package.names):
        raise L2Error("class prefix name outside package table")
    return value


def read_class_script(package, reader, memory_size):
    """Walk qualified SerializeExpr paths with separate saved/memory cursors.

    A compact object reference occupies four bytes in the native script buffer.
    Memory size is never used as a serialized byte count. An explicit stack
    mirrors expression recursion without imposing an invented game depth limit.
    Unsupported tokens fail before any default-property boundary is returned.
    Each token retains its memoryOffset and the exclusive expressionEnd reached
    by its original SerializeExpr call, including nested argument terminators.
    """
    if type(memory_size) is not int or not 0 <= memory_size <= 0x7FFFFFFF:
        raise L2Error("invalid class script memory size")
    start, memory, tokens = reader.pos, 0, []
    returned_token = None
    while memory < memory_size:
        pending = [("expression", None)]
        while pending:
            action, previous = pending.pop()
            if action == "finish":
                previous["expressionEnd"] = memory
                returned_token = previous["token"]
                continue
            if action == "arguments-next":
                if returned_token != 0x16:
                    pending.extend([("arguments-next", None), ("expression", None)])
                continue
            if memory >= memory_size:
                raise L2Error("class script ends inside an expression")
            position = reader.pos
            token = reader.u8()
            row = dict(offset=position, memoryOffset=memory, token=token)
            memory += 1
            pending.append(("finish", row))
            if token >= 0x70:
                pending.extend([("arguments-next", None), ("expression", None)])
            elif token == 0x39:
                row["byte"] = reader.u8()
                memory += 1
                pending.append(("expression", None))
            elif token in REFERENCE_TOKENS | REFERENCE_EXPRESSION_TOKENS:
                row["reference"] = _reference(package, reader)
                memory += 4
                if token in REFERENCE_EXPRESSION_TOKENS:
                    pending.append(("expression", None))
            elif token in WORD_EXPRESSION_TOKENS:
                row["word"] = reader.u16()
                memory += 2
                pending.append(("expression", None))
            elif token in BYTE_TOKENS:
                row["byte"] = reader.u8()
                memory += 1
            elif token not in NO_OPERAND_TOKENS:
                raise L2Error(f"unsupported class script token 0x{token:02x}")
            if memory > memory_size:
                raise L2Error("class script exceeds declared memory size")
            tokens.append(row)
    return dict(
        sourceOffset=start,
        sourceBytes=reader.pos - start,
        memoryBytes=memory_size,
        tokens=tokens,
        sourceSHA256=hashlib.sha256(reader.data[start : reader.pos]).hexdigest(),
    )


def materialize_class_script(script, reference_values):
    """Build loaded bytes from a decoded script and explicit reference bindings.

    Bindings are caller-supplied current DWORD values, not saved package indices
    or addresses inferred here. This neither loads objects nor executes script.
    Only the existing reader's admitted operand shapes are accepted.
    """
    if not isinstance(reference_values, dict) or any(
        type(key) is not int for key in reference_values
    ):
        raise L2Error("explicit integer-indexed script reference bindings required")
    result = bytearray()
    for row in script["tokens"]:
        token = row["token"]
        if type(token) is not int or not 0 <= token <= 255:
            raise L2Error("invalid decoded script token")
        if row["memoryOffset"] != len(result):
            raise L2Error("noncontiguous decoded script memory offsets")
        result.append(token)
        if token in REFERENCE_TOKENS | REFERENCE_EXPRESSION_TOKENS:
            reference = row["reference"]
            if reference not in reference_values:
                raise L2Error("missing explicit script reference binding")
            value, size = reference_values[reference], 4
        elif token in WORD_EXPRESSION_TOKENS:
            value, size = row["word"], 2
        elif token in BYTE_TOKENS or token == 0x39:
            value, size = row["byte"], 1
        elif token in NO_OPERAND_TOKENS or token >= 0x70:
            continue
        else:
            raise L2Error("unsupported decoded script token")
        if type(value) is not int or not 0 <= value < 1 << (8 * size):
            raise L2Error("invalid decoded operand or script reference binding")
        result.extend(value.to_bytes(size, "little"))
    if len(result) != script["memoryBytes"]:
        raise L2Error("decoded script memory size mismatch")
    return bytes(result)


def read_class_default_prefix(package, export):
    """Locate the default stream by reading a supported original UClass prefix.

    Values identified only by storage offset retain that label. This recovers
    serialized structure, not native registration, a default object or gameplay
    state. The caller must separately validate the default tags through the
    exact export end and against the class's declared property types.
    """
    if package.file_version != 123:
        raise L2Error("unsupported class prefix file version")
    if package.class_name_of(export) != "Class" or export.object_flags & RF_HAS_STACK:
        raise L2Error("class prefix requires a Class export without a script frame")
    start, end = export.serial_offset, export.serial_offset + export.serial_size
    if not 0 <= start < end <= len(package.data):
        raise L2Error("invalid class prefix export boundary")
    reader = Reader(memoryview(package.data)[:end], start, package.path)
    refs = [_reference(package, reader) for _ in range(4)]
    name = _name(package, reader)
    refs.append(_reference(package, reader))
    if refs[0] != export.super_index or package.name(name) != package.export_name(
        export
    ):
        raise L2Error("class prefix identity differs from export")
    line, text_position = reader.i32(), reader.i32()
    script = read_class_script(package, reader, reader.i32())
    state = dict(
        probeMask=struct.unpack("<Q", reader.bytes(8))[0],
        ignoreMask=struct.unpack("<Q", reader.bytes(8))[0],
        labelOffset=reader.u16(),
        flags=reader.u32(),
    )
    flags_offset = reader.pos
    fields = {"0x4a4": reader.u32(), "0x4ac": [reader.u32() for _ in range(4)]}

    def count(minimum):
        value = _compact(reader)
        if not 0 <= value <= (end - reader.pos) // minimum:
            raise L2Error("class prefix array count exceeds export")
        return value

    fields["0x4dc"] = [
        dict(
            reference=_reference(package, reader),
            word4=reader.u32(),
            word8=reader.u32(),
        )
        for _ in range(count(9))
    ]
    fields["0x4e8"] = [_name(package, reader) for _ in range(count(1))]
    fields["0x4bc"] = _reference(package, reader)
    fields["0x4c0"] = _name(package, reader)
    fields["0x500"] = [_name(package, reader) for _ in range(count(1))]
    if reader.pos >= end:
        raise L2Error("class prefix leaves no default-property terminator")
    return dict(
        scope="serialized-class-prefix",
        fileVersion=package.file_version,
        exportOffset=start,
        exportLength=export.serial_size,
        exportSHA256=hashlib.sha256(package.data[start:end]).hexdigest(),
        references=refs,
        name=name,
        line=line,
        textPosition=text_position,
        script=script,
        state=state,
        fields=fields,
        flagsOffset=flags_offset,
        defaultsOffset=reader.pos - start,
        sourceBytes=reader.pos - start,
        sourceSHA256=hashlib.sha256(package.data[start : reader.pos]).hexdigest(),
    )
