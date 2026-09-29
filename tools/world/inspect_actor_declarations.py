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
from l2lib.declarations import read_property_declaration, read_field_chain


DEFAULT_CLASSES = (
    "Engine.Volume",
    "Engine.BlockingVolume",
    "Engine.MusicVolume",
    "Engine.PhysicsVolume",
    "Gameplay.WaterVolume",
)


def inspect_declarations(names):
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
            record = read_property_declaration(pkg, ex)
            result.append(record)
            if record["kind"] == "StructProperty":
                if record["reference"] is None:
                    raise ValueError(
                        "unresolved saved structure: "
                        + qualified_ref(pkg, ex.index + 1)
                    )
                visit_structure(record["reference"])
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
        structures[key] = dict(
            identity=qualified_ref(pkg, ex.index + 1),
            savedSuper=parent,
            exportSHA256=hashlib.sha256(
                pkg.data[ex.serial_offset : ex.serial_offset + ex.serial_size]
            ).hexdigest(),
            fields=fields(pkg, ex),
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
        visiting.remove(key)

    for name in names:
        visit_class(name)
    records = [*classes.values(), *structures.values()]
    declarations = [field for row in records for field in row["fields"]]
    summary = dict(
        classes=len(classes),
        structures=len(structures),
        declarations=len(declarations),
        linkedClassFields=sum(
            len(row["fieldChain"]["fields"]) for row in classes.values()
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
    return dict(
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
        ],
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("classes", nargs="*", default=list(DEFAULT_CLASSES))
    parser.add_argument(
        "--check", action="store_true", help="print the summary and source fingerprints"
    )
    args = parser.parse_args()
    report = inspect_declarations(args.classes)
    if args.check:
        report = {
            key: report[key]
            for key in ("tool", "status", "scope", "summary", "sources", "limits")
        }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
