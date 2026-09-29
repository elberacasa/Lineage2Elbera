"""Elbera Tools: original class/structure property offset-linking stage.

Inputs are declarations already placed in original linked order and a supplied
parent PropertiesSize. This is not full UClass.Link, registration or archive
preloading. Reference/cleanup lists and property-flag changes are outside scope.
See docs/native-class-defaults-evidence.md for source qualification and limits.
"""

from .ue2package import L2Error


def property_offsets(fields, parent_size):
    """Return own-field offsets for admitted Boolean-packing class/struct paths.

    Nested fields require an explicit, independently prepared structSize.
    Dimensions, overflow and unknown kinds fail explicitly. Positive dimensions
    and nonwrapping signed sizes are a safety
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
        elif kind == "StructProperty":
            element = field.get("structSize")
            if type(element) is not int or not 0 <= element <= 0x7FFFFFFC:
                raise L2Error("missing or unsupported nested structure size")
            alignment = 2 if element == 2 else 1 if element < 4 else 4
            offset = (size + alignment - 1) & ~(alignment - 1)
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


def linked_properties(record):
    """Select complete own declarations in their separately decoded link order.

    A mismatched or incomplete chain is not a license to use export order.
    Native linking can stop at a foreign owner; this helper admits only a
    complete, locally resolved chain ending at null.
    """
    by_ref = {field["exportRef"]: field for field in record["fields"]}
    if len(by_ref) != len(record["fields"]) or record["fieldChain"]["stoppedAt"] != 0:
        raise L2Error("incomplete or duplicate declaration chain")
    result, seen = [], set()
    for field in record["fieldChain"]["fields"]:
        reference = field["exportRef"]
        if reference in seen:
            raise L2Error("repeated field in declaration chain")
        seen.add(reference)
        if field["kind"].endswith("Property"):
            declared = by_ref.get(reference)
            if declared is None or (declared["kind"], declared["name"]) != (
                field["kind"],
                field["name"],
            ):
                raise L2Error("linked field differs from its declaration")
            result.append(declared)
        elif reference in by_ref:
            raise L2Error("property declaration linked as a nonproperty")
    if {field["exportRef"] for field in result} != set(by_ref):
        raise L2Error("declaration is absent from its field chain")
    return result


def structure_layouts(structures):
    """Resolve a decoded structure graph without inferred names or sizes.

    The caller supplies records from the declaration inspector. Super and
    StructProperty references must resolve to exact qualified identities.
    Cycles or unsupported property kinds reject the graph. Output is an offset
    stage only; it neither executes scripts nor constructs property lists.
    """
    records, layouts, visiting = {}, {}, set()
    for row in structures:
        key = row["identity"].casefold()
        if key in records:
            raise L2Error("duplicate structure identity")
        records[key] = row

    def visit(name):
        key = name.casefold()
        if key in visiting:
            raise L2Error("cyclic structure layout")
        if key in layouts:
            return layouts[key]
        if key not in records:
            raise L2Error("missing structure layout: " + name)
        visiting.add(key)
        row = records[key]
        parent = visit(row["savedSuper"])["propertiesSize"] if row["savedSuper"] else 0
        fields = []
        for field in linked_properties(row):
            field = dict(field)
            if field["kind"] == "StructProperty":
                if not field["reference"]:
                    raise L2Error("missing nested structure reference")
                field["structSize"] = visit(field["reference"])["propertiesSize"]
            fields.append(field)
        result = property_offsets(fields, parent)
        result.update(identity=row["identity"], parentSize=parent, declarations=fields)
        layouts[key] = result
        visiting.remove(key)
        return result

    for row in records.values():
        visit(row["identity"])
    return layouts
