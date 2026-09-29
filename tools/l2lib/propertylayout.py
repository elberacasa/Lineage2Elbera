"""Elbera Tools: the original UClass scalar-property offset-linking stage.

Inputs are declarations already placed in original linked order and a supplied
parent PropertiesSize. This is not full UClass.Link, registration or archive
preloading. Reference/cleanup lists and property-flag changes are outside scope.
See docs/native-class-defaults-evidence.md for source qualification and limits.
"""

from .ue2package import L2Error


def property_offsets(fields, parent_size):
    """Return own-field offsets for the admitted, Boolean-packing class path.

    Dimensions, arithmetic overflow, unknown kinds and nested structures fail
    explicitly. Positive dimensions and nonwrapping signed sizes are a safety
    boundary, not an invented limit on official class definitions.
    """
    if type(parent_size) is not int or not 0 <= parent_size <= 0x7FFFFFFC:
        raise L2Error("unsupported parent property size")
    size, previous, result = (parent_size + 3) & ~3, None, []
    for field in fields:
        kind, dimension = field["kind"], field["arrayDim"]
        if type(dimension) is not int or dimension <= 0:
            raise L2Error("unsupported property array dimension")
        if kind == "ByteProperty":
            element, offset = 1, size
        elif kind in {
            "IntProperty",
            "FloatProperty",
            "NameProperty",
            "ObjectProperty",
            "ClassProperty",
            "StrProperty",
            "BoolProperty",
        }:
            element = 12 if kind == "StrProperty" else 4
            offset = (size + 3) & ~3
        else:
            raise L2Error("unsupported property layout kind: " + str(kind))
        row = dict(elementSize=element, offset=offset)
        if kind == "BoolProperty":
            if previous and previous.get("boolMask", 0) & 0x7FFFFFFF:
                row.update(
                    offset=previous["offset"], boolMask=previous["boolMask"] << 1
                )
            else:
                row["boolMask"] = 1
        size = row["offset"] + element * dimension
        if size > 0x7FFFFFFC:
            raise L2Error("property layout exceeds nonwrapping signed size")
        result.append(row)
        previous = row
    return dict(propertiesSize=(size + 3) & ~3, fields=result)
