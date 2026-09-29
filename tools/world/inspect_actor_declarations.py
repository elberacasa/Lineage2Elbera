#!/usr/bin/env python3
"""Elbera Tools: inspect saved actor and nested-structure declarations.

Requires caller-supplied local packages in assets/interlude/system. Emits JSON
or a compact --check receipt; never writes input files or linked runtime data.
Example: python3 tools/world/inspect_actor_declarations.py Engine.Volume --check
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "tools"), str(ROOT / "tools/world")]
from export_static_collision import OriginalClasses, serialized_class_record
from l2lib import load_package, qualified_ref
from l2lib.declarations import (
    read_property_tree,
    read_field_chain,
    read_struct_children,
)
from l2lib.propertylayout import (
    structure_layouts,
    structure_links,
    class_layouts,
    class_links,
)
from l2lib.stringproperty import decode_string_property


DEFAULT_CLASSES = (
    "Engine.Volume",
    "Engine.BlockingVolume",
    "Engine.MusicVolume",
    "Engine.PhysicsVolume",
    "Gameplay.WaterVolume",
)


def inspect_declarations(
    names,
    *,
    include_structure_layouts=False,
    include_string_defaults=False,
    include_structure_links=False,
    include_reference_flags=False,
    include_class_links=False,
    include_default_config=False,
):
    if include_reference_flags and not (include_structure_links or include_class_links):
        raise ValueError(
            "reference flags require structure-link or class-link preparation"
        )
    catalog = OriginalClasses()
    classes, structures, visiting = {}, {}, set()

    def resolve(name, kind):
        path = catalog.files.get(name.split(".")[0].casefold())
        if path is None:
            raise ValueError("missing declaration package: " + name)
        if path.stem not in catalog.packages:
            catalog.packages[path.stem] = load_package(path)[0]
        catalog.sources[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
        pkg = catalog.packages[path.stem]
        matches = [
            ex
            for ex in pkg.exports
            if pkg.class_name_of(ex) == kind
            and qualified_ref(pkg, ex.index + 1).casefold() == name.casefold()
        ]
        if len(matches) != 1:
            raise ValueError("missing or ambiguous declaration: " + name)
        return pkg, matches[0]

    def fields(pkg, owner):
        result = []
        for ex in pkg.exports:
            if ex.package_index != owner.index + 1 or not pkg.class_name_of(
                ex
            ).endswith("Property"):
                continue
            record = read_property_tree(pkg, ex)
            result.append(record)
            nested = record
            while nested["kind"] == "ArrayProperty":
                nested = nested["inner"]
            if nested["kind"] == "StructProperty":
                if nested["reference"] is None:
                    raise ValueError(
                        "unresolved saved structure: "
                        + qualified_ref(pkg, ex.index + 1)
                    )
                visit_structure(nested["reference"])
        return result

    def visit_structure(name):
        key = name.casefold()
        if key in visiting:
            raise ValueError("cyclic saved structure declarations: " + name)
        if key in structures:
            return
        visiting.add(key)
        pkg, ex = resolve(name, "Struct")
        parent = qualified_ref(pkg, ex.super_index) if ex.super_index else None
        if parent:
            visit_structure(parent)
        prefix = read_struct_children(pkg, ex)
        structures[key] = dict(
            identity=qualified_ref(pkg, ex.index + 1),
            savedSuper=parent,
            exportSHA256=hashlib.sha256(
                pkg.data[ex.serial_offset : ex.serial_offset + ex.serial_size]
            ).hexdigest(),
            fields=fields(pkg, ex),
            childPrefix=prefix,
            fieldChain=read_field_chain(pkg, ex, prefix["children"]),
        )
        visiting.remove(key)

    def visit_class(name):
        key = name.casefold()
        if key in visiting:
            raise ValueError("cyclic saved class declarations: " + name)
        if key in classes:
            return
        visiting.add(key)
        pkg, ex, source = serialized_class_record(catalog, name)
        if source["parent"]:
            visit_class(source["parent"])
        classes[key] = dict(
            identity=source["sourceClass"],
            savedSuper=source["parent"],
            classPrefix=source["defaults"]["classPrefix"],
            fields=fields(pkg, ex),
            fieldChain=read_field_chain(
                pkg, ex, source["defaults"]["classPrefix"]["references"][3]
            ),
        )
        if include_string_defaults:
            row = classes[key]
            parent = classes[source["parent"].casefold()] if source["parent"] else None
            known = dict(parent["savedStringDefaults"]) if parent else {}
            declarations = {}
            ancestor = row
            while ancestor:
                for field in ancestor["fields"]:
                    declarations.setdefault(field["name"].casefold(), field)
                ancestor = classes.get((ancestor["savedSuper"] or "").casefold())
            own = []
            for index, tag in enumerate(source["tags"]):
                field = declarations.get(tag["name"].casefold())
                if tag["type"] != 13 and (
                    field is None or field["kind"] != "StrProperty"
                ):
                    continue
                if (
                    field is None
                    or field["kind"] != "StrProperty"
                    or tag["type"] != 13
                    or not 0 <= tag["index"] < field["arrayDim"]
                ):
                    raise ValueError("saved string tag does not match declaration")
                record = dict(
                    name=field["name"],
                    index=tag["index"],
                    tagOrder=index,
                    sourceClass=row["identity"],
                    payloadHex=tag["raw"].hex(),
                    payloadSHA256=hashlib.sha256(tag["raw"]).hexdigest(),
                    **decode_string_property(tag["raw"]),
                )
                own.append(record)
                known[field["name"].casefold() + ":" + str(tag["index"])] = record
            row["savedStringTags"] = own
            row["savedStringDefaults"] = known
            row["stringDefaultsSource"] = source["defaults"]
        visiting.remove(key)

    for name in names:
        visit_class(name)
    records = [*classes.values(), *structures.values()]
    declarations = [field for row in records for field in row["fields"]]
    inners = []
    for field in declarations:
        while field["kind"] == "ArrayProperty":
            field = field["inner"]
            inners.append(field)
    summary = dict(
        classes=len(classes),
        structures=len(structures),
        declarations=len(declarations),
        arrayInnerDeclarations=len(inners),
        linkedClassFields=sum(
            len(row["fieldChain"]["fields"]) for row in classes.values()
        ),
        linkedStructureFields=sum(
            len(row["fieldChain"]["fields"]) for row in structures.values()
        ),
        networkedDeclarations=sum(
            field["replicationOffset"] is not None for field in declarations
        ),
        localizedDeclarations=[
            row["identity"] + "." + field["name"]
            for row in records
            for field in row["fields"]
            if field["propertyFlags"] & 0x8000
        ],
    )
    report = dict(
        tool="Elbera Tools actor declarations",
        status="pass",
        summary=summary,
        scope="saved declarations and export-table ancestry; not linked runtime metadata",
        sources=catalog.sources,
        classes=classes,
        structures=structures,
        limits=[
            "Caller-supplied file-123 packages. Recorded fingerprints identify inputs, not authenticated edition provenance.",
            "fields retains export order; fieldChain separately follows saved child/Next links, including nonproperties and the ownership stop. Neither executes archive preloading or gameplay.",
            "Source flags, dimensions and reference identities do not establish native offsets, aliasing, localization effects or current actor state.",
            "Array inner declarations require local exports with the array as their exact owner; their nested structure references are inspected too. Inner records do not join the owner's child field chain.",
        ],
    )
    if include_structure_layouts:
        report["structureLayouts"] = structure_layouts(structures.values())
        report["summary"]["structureLayouts"] = len(report["structureLayouts"])
        report["limits"].append(
            "Optional structureLayouts computes only the original offset stage from complete saved chains; it does not construct a live reflection registry or property cleanup/reference lists."
        )
    if include_string_defaults:
        report["summary"]["savedStringTags"] = sum(
            len(row["savedStringTags"]) for row in classes.values()
        )
        report["limits"].append(
            "Optional savedStringDefaults overlays decoded tags through saved ancestry only. Untagged values remain unknown; native initialization, property acceptance, configuration/localization and current object storage are not inferred. Full output contains decoded private input values and payloads."
        )
    if include_structure_links or include_class_links:
        reference_flags = None
        if include_reference_flags:
            sys.path.insert(0, str(ROOT / "tools/ui"))
            from static_mesh_class_source import read_owned_reference_class_bits

            proof = read_owned_reference_class_bits()
            report["referenceClassBits"] = proof
            reference_flags = proof["records"]
            report["summary"]["referenceClassBits"] = len(reference_flags)
            report["sources"].update(
                {
                    "engine.dll": proof["sources"]["engine"],
                    "Core.dll": proof["sources"]["core"],
                }
            )
        report["structureLinks"] = structure_links(structures.values(), reference_flags)
        report["summary"]["structureLinks"] = {
            status: sum(
                row["status"] == status for row in report["structureLinks"].values()
            )
            for status in ("ready", "unsupported")
        }
        report["limits"].append(
            "Optional structureLinks retains property Link flag changes and four lists, with own fields before inherited fields. Missing current referenced-class flags remain unsupported. No full class/reflection lifecycle or replication grouping is claimed."
        )
    if include_class_links:
        report["classLayouts"] = class_layouts(classes.values(), structures.values())
        report["classLinks"] = class_links(
            classes.values(), structures.values(), reference_flags
        )
        report["summary"]["classLinks"] = {
            status: sum(
                row["status"] == status for row in report["classLinks"].values()
            )
            for status in ("ready", "unsupported")
        }
        report["limits"].append(
            "Optional classLinks recomputes saved inheritance, offsets, consumed flags and four property lists. Ready means only these components have inputs; replication bindings, UClass/UState tables, native binding, CDO configuration/localization and actual world startup are not inferred."
        )
    if include_default_config:
        sys.path.insert(0, str(ROOT / "tools/ui"))
        from static_mesh_class_source import read_owned_default_config_bits

        proof = read_owned_default_config_bits()
        report["defaultConfigBits"] = proof
        report["summary"]["defaultConfig"] = {
            status: sum(
                (
                    "skipped"
                    if proof["records"].get(key, {}).get("value") == 0
                    else "unresolved"
                )
                == status
                for key in classes
            )
            for status in ("skipped", "unresolved")
        }
        report["sources"].update(
            {
                "engine.dll": proof["sources"]["engine"],
                "Core.dll": proof["sources"]["core"],
                **{
                    name: digest
                    for name, digest in proof["sources"].items()
                    if name.endswith(".u")
                },
            }
        )
        report["limits"].append(
            "Optional defaultConfigBits proves only the consumed LoadConfig gate for the pinned volume family and ancestors, including inherited flags. Other requested classes remain unresolved. No CDO values, live class loading or localized configuration replies are inferred."
        )
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("classes", nargs="*", default=list(DEFAULT_CLASSES))
    parser.add_argument(
        "--check", action="store_true", help="print the summary and source fingerprints"
    )
    parser.add_argument(
        "--structure-layouts",
        action="store_true",
        help="also compute the admitted nested-structure offset graph",
    )
    parser.add_argument(
        "--structure-links",
        action="store_true",
        help="also prepare supported structure flags/lists; unresolved class dependencies stay explicit",
    )
    parser.add_argument(
        "--class-links",
        action="store_true",
        help="also prepare the complete saved class inheritance graph; implies structure links",
    )
    parser.add_argument(
        "--reference-flags",
        action="store_true",
        help="with --structure-links or --class-links, read consumed class bits from pinned owned DLLs/packages; requires Capstone",
    )
    parser.add_argument(
        "--default-config",
        action="store_true",
        help="recover the volume-family LoadConfig gate from pinned owned DLLs/packages; requires Capstone",
    )
    parser.add_argument(
        "--string-defaults",
        action="store_true",
        help="also decode and overlay saved string tags; full JSON contains private input values",
    )
    args = parser.parse_args()
    if args.reference_flags and not (args.structure_links or args.class_links):
        parser.error("--reference-flags requires --structure-links or --class-links")
    report = inspect_declarations(
        args.classes,
        include_structure_layouts=args.structure_layouts,
        include_string_defaults=args.string_defaults,
        include_structure_links=args.structure_links,
        include_reference_flags=args.reference_flags,
        include_class_links=args.class_links,
        include_default_config=args.default_config,
    )
    if args.check:
        report = {
            key: report[key]
            for key in ("tool", "status", "scope", "summary", "sources", "limits")
        }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
