"""Elbera Tools: original class/structure property offset-linking stage.

Inputs are declarations already placed in original linked order and a supplied
parent PropertiesSize. Separate helpers retain consumed property-flag changes
and linked lists from explicit current metadata. This is not full UClass.Link,
registration or archive preloading. Replication grouping separately consumes
explicit loaded scripts and reference bindings.
See docs/native-class-defaults-evidence.md for source qualification and limits.
"""

from .ue2package import L2Error


def replication_links(fields, scripts, *, is_editor=False):
    """Return original +0x68 writes using explicit loaded class scripts.

    Fields must be in current property-iterator order. Scripts map each owning
    class identity to a decoded script and explicit referenceValues. Equal
    loaded expression bytes share the LAST encountered field representative.
    Editor mode and nonreplicated fields receive no writes.
    """
    from .classdata import materialize_class_script

    fields = list(fields)
    property_lists(fields)  # Validate current kinds, flags and unique identities.
    if type(is_editor) is not bool:
        raise L2Error("explicit Boolean editor state required")
    if is_editor:
        return {}
    cache, groups = {}, {}
    for field in fields:
        if not field["propertyFlags"] & 0x20:
            continue
        owner, offset = field.get("ownerClass"), field.get("replicationOffset")
        if not isinstance(owner, str) or not owner or owner not in scripts:
            raise L2Error("explicit owning-class script required")
        if type(offset) is not int or not 0 <= offset <= 0xFFFF:
            raise L2Error("unsigned replication script offset required")
        if owner not in cache:
            source = scripts[owner]
            decoded = source["decoded"]
            data = materialize_class_script(decoded, source["referenceValues"])
            ends = {
                row["memoryOffset"]: row["expressionEnd"] for row in decoded["tokens"]
            }
            cache[owner] = data, ends
        data, ends = cache[owner]
        end = ends.get(offset)
        if type(end) is not int or not offset < end <= len(data):
            raise L2Error("replication offset does not identify a supported expression")
        groups.setdefault(data[offset:end], []).append(field["identity"])
    return {
        identity: members[-1] for members in groups.values() for identity in members
    }


def consensus_flag_bits(variants, mask):
    """Keep only bits agreed by every supplied source-stage variant."""
    if type(mask) is not int or not 0 < mask <= 0xFFFFFFFF:
        raise L2Error("nonempty unsigned consumed-bit mask required")
    variants = list(variants)
    if not variants or any(
        type(v) is not int or not 0 <= v <= 0xFFFFFFFF for v in variants
    ):
        raise L2Error("explicit unsigned flag variants required")
    values = {v & mask for v in variants}
    if len(values) != 1:
        raise L2Error("source stages disagree on consumed class flags")
    return dict(mask=mask, value=values.pop())


def property_link_flags(field):
    """Flags after the qualified scalar/string/structure Link methods.

    Reference-class flags and nested constructor-list presence must be current
    supplied inputs, not inferred from the property's name or saved defaults.
    """
    return _property_link_flags(field, set())


def _array_inner(field, active):
    if id(field) in active:
        raise L2Error("cyclic array inner metadata")
    inner = field.get("inner")
    if not isinstance(inner, dict):
        raise L2Error("explicit array inner metadata required")
    return inner, active | {id(field)}


def _property_link_flags(field, active):
    flags = field.get("propertyFlags")
    if type(flags) is not int or not 0 <= flags <= 0xFFFFFFFF:
        raise L2Error("current property flags required")
    kind = field["kind"]
    if kind in ("StrProperty", "ArrayProperty"):
        if kind == "ArrayProperty":
            inner, active = _array_inner(field, active)
            # Original Array.Link links the inner first. Unknown dependencies
            # cannot be bypassed merely because the outer flag rule is simple.
            _property_link_flags(inner, active)
        if not flags & 0x1000:
            flags |= 0x400000
    elif kind in ("ObjectProperty", "ClassProperty"):
        if flags & 0x4000008 == 0x4000008:
            flags |= 0x400000
        else:
            referenced = field.get("referenceFlags")
            if isinstance(referenced, dict):
                mask, value = referenced.get("mask"), referenced.get("value")
                if (
                    type(mask) is not int
                    or not 0 <= mask <= 0xFFFFFFFF
                    or type(value) is not int
                    or not 0 <= value <= 0xFFFFFFFF
                    or value & ~mask
                    or not mask & 0x200000
                ):
                    raise L2Error("referenced-class consumed bit is unknown or invalid")
                referenced = value
            elif type(referenced) is not int or not 0 <= referenced <= 0xFFFFFFFF:
                raise L2Error("current referenced-class flags required")
            if referenced & 0x200000:
                flags |= 0x400000
    elif kind == "StructProperty":
        linked = field.get("structConstructorLink")
        if type(linked) is not bool:
            raise L2Error("current nested constructor-list presence required")
        if linked and not flags & 0x1000:
            flags |= 0x400000
    elif kind not in (
        "ByteProperty",
        "IntProperty",
        "BoolProperty",
        "FloatProperty",
        "NameProperty",
    ):
        raise L2Error("unsupported property Link kind: " + str(kind))
    return flags


def property_lists(fields):
    """UStruct.Link's four lists in supplied inherited property-iterator order.

    Identity and current flags are explicit. This consumes already-linked
    fields; it does not run offset linking or replication-condition grouping.
    Keys name original head offsets, avoiding unproved consumer semantics.
    """
    result = {head: [] for head in ("0x6c", "0x70", "0x74", "0x78")}
    seen = set()
    kinds = {
        "ByteProperty",
        "IntProperty",
        "BoolProperty",
        "FloatProperty",
        "NameProperty",
        "StrProperty",
        "ObjectProperty",
        "ClassProperty",
        "StructProperty",
        "ArrayProperty",
        "DelegateProperty",
    }
    for field in fields:
        identity, kind, flags = (
            field.get("identity"),
            field.get("kind"),
            field.get("propertyFlags"),
        )
        if not isinstance(identity, str) or not identity or identity in seen:
            raise L2Error("unique current property identity required")
        if kind not in kinds or type(flags) is not int or not 0 <= flags <= 0xFFFFFFFF:
            raise L2Error("qualified current property kind and flags required")
        seen.add(identity)
        result["0x70"].append(identity)
        if kind in (
            "ObjectProperty",
            "ClassProperty",
            "StructProperty",
            "ArrayProperty",
            "DelegateProperty",
        ):
            result["0x6c"].append(identity)
        if flags & 0x4000:
            result["0x74"].append(identity)
        if flags & 0x400000:
            result["0x78"].append(identity)
    return result


def property_offsets(fields, parent_size):
    """Return own-field offsets for admitted Boolean-packing class/struct paths.

    Nested fields require an explicit, independently prepared structSize.
    Dimensions, overflow and unknown kinds fail explicitly. Positive dimensions
    and nonwrapping signed sizes are a safety
    boundary, not an invented limit on official class definitions.
    """
    return _property_offsets(fields, parent_size, set())


def _property_offsets(fields, parent_size, active):
    if type(parent_size) is not int or not 0 <= parent_size <= 0x7FFFFFFC:
        raise L2Error("unsupported parent property size")
    size, previous, result = (parent_size + 3) & ~3, None, []
    for field in fields:
        kind, dimension = field["kind"], field["arrayDim"]
        if type(dimension) is not int or dimension <= 0:
            raise L2Error("unsupported property array dimension")
        inner_layout = None
        if kind == "ArrayProperty":
            inner, inner_active = _array_inner(field, active)
            # UArrayProperty's inherited GetPropertiesSize returns zero, and
            # inner.Link receives a null preceding property (no Boolean pack).
            inner_layout = _property_offsets([inner], 0, inner_active)["fields"][0]
            element, offset = 12, (size + 3) & ~3
        elif kind == "ByteProperty":
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
        if inner_layout is not None:
            row["inner"] = inner_layout
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

        def prepare(field, active):
            if field["kind"] == "ArrayProperty":
                inner, active = _array_inner(field, active)
            else:
                inner = None
            field = dict(field)
            if field["kind"] == "StructProperty":
                if not field["reference"]:
                    raise L2Error("missing nested structure reference")
                field["structSize"] = visit(field["reference"])["propertiesSize"]
            elif field["kind"] == "ArrayProperty":
                field["inner"] = prepare(inner, active)
            return field

        fields = [prepare(field, set()) for field in linked_properties(row)]
        result = property_offsets(fields, parent)
        result.update(identity=row["identity"], parentSize=parent, declarations=fields)
        layouts[key] = result
        visiting.remove(key)
        return result

    for row in records.values():
        visit(row["identity"])
    return layouts


def structure_links(structures, reference_class_flags=None):
    """Prepare structure fields/lists where every consumed dependency is known.

    Saved declaration order and offset layouts come from the shared helpers.
    Referenced-class flags are optional explicit current inputs, never a zero
    fallback. Missing dependencies produce an unsupported record. This does not
    prepare class reflection or execute replication-condition grouping.
    """
    structures = list(structures)
    layouts = structure_layouts(structures)
    records = {row["identity"].casefold(): row for row in structures}
    if reference_class_flags is not None and not isinstance(
        reference_class_flags, dict
    ):
        raise L2Error("current referenced-class flag mapping required")
    reference_flags = {}
    for name, flags in (reference_class_flags or {}).items():
        if not isinstance(name, str) or not name:
            raise L2Error("referenced-class identity required")
        if name.casefold() in reference_flags:
            raise L2Error("duplicate referenced-class identity")
        reference_flags[name.casefold()] = flags
    results, visiting = {}, set()

    def visit(key):
        if key in visiting:
            raise L2Error("cyclic structure metadata")
        if key in results:
            if results[key]["status"] != "ready":
                raise L2Error(
                    "unresolved structure metadata: " + records[key]["identity"]
                )
            return results[key]
        visiting.add(key)
        row, layout = records[key], layouts[key]
        try:
            parent = visit(row["savedSuper"].casefold()) if row["savedSuper"] else None

            def prepare(declared, offset, identity):
                field = dict(declared, **offset)
                field["identity"] = identity
                if field["kind"] == "StructProperty":
                    nested = visit(field["reference"].casefold())
                    field["structConstructorLink"] = bool(nested["lists"]["0x78"])
                elif field["kind"] in ("ObjectProperty", "ClassProperty"):
                    field["referenceFlags"] = reference_flags.get(
                        (field["reference"] or "").casefold()
                    )
                elif field["kind"] == "ArrayProperty":
                    field["inner"] = prepare(
                        declared["inner"],
                        offset["inner"],
                        identity + "." + declared["inner"]["name"],
                    )
                field["savedPropertyFlags"] = field["propertyFlags"]
                field["propertyFlags"] = property_link_flags(field)
                return field

            own = [
                prepare(declared, offset, row["identity"] + "." + declared["name"])
                for declared, offset in zip(layout["declarations"], layout["fields"])
            ]
            fields = own + (parent["fields"] if parent else [])
            result = dict(
                status="ready",
                identity=row["identity"],
                propertiesSize=layout["propertiesSize"],
                ownFields=own,
                fields=fields,
                lists=property_lists(fields),
            )
            results[key] = result
            return result
        finally:
            visiting.remove(key)

    for key in records:
        try:
            visit(key)
        except L2Error as error:
            results[key] = dict(
                status="unsupported",
                identity=records[key]["identity"],
                reason=str(error),
            )
    return results
