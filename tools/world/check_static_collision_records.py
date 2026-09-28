#!/usr/bin/env python3
"""Elbera Tools: exact-byte round trip of original static collision records.

Reads private original maps/packages through the existing audited exporter.
Writes only a JSON evidence receipt to stdout, never assets or scene changes.
The comparison covers saved arrays, not live state or native collision results.
"""
import argparse
from collections import Counter
import hashlib
import json
import struct

from export_static_collision import Audit, qualified_ref
from l2lib import encode_compact


def check_arrays(source, data):
    """Re-encode decoded records and compare original payload and lazy framing."""
    tree = data["collisionTree"]
    triangles = bytearray(encode_compact(data["collisionTriangleCount"]))
    for index, planes in enumerate(tree["trianglePlanes"]):
        triangles += struct.pack("<16f", *planes)
        for value in data["indices"][3 * index : 3 * index + 3] + [
            data["materials"][index]
        ]:
            triangles += encode_compact(value)
    nodes = bytearray(encode_compact(len(tree["nodes"])))
    for node in tree["nodes"]:
        nodes += b"".join(encode_compact(value) for value in node["links"])
        nodes += struct.pack("<6fB", *node["bounds"], node["valid"])
    cursor, spans = data["collisionOffset"], []
    for payload in (triangles, nodes):
        if data["collisionArrayLayout"] == "lazy-saved-end":
            saved_end = struct.unpack_from("<i", source, cursor)[0]
            cursor += 4
            if saved_end != cursor + len(payload):
                raise ValueError("re-encoded array does not match original saved end")
        original = bytes(source[cursor : cursor + len(payload)])
        if original != payload:
            raise ValueError("re-encoded collision records differ from original bytes")
        spans.append(
            dict(
                start=cursor,
                bytes=len(payload),
                SHA256=hashlib.sha256(original).hexdigest(),
            )
        )
        cursor += len(payload)
    return spans


def verify(tile):
    audit = Audit(tile, retain_sweep_data=True)
    report = audit.report(audit.actors())
    records, layouts = [], Counter()
    for name, data in sorted(audit.geometry.items()):
        package = audit.packages[name.split(".")[0]]
        export = next(
            e
            for e in package.exports
            if package.class_name_of(e) == "StaticMesh"
            and qualified_ref(package, e.index + 1).casefold() == name.casefold()
        )
        assert (
            hashlib.sha256(
                package.data[
                    export.serial_offset : export.serial_offset + export.serial_size
                ]
            ).hexdigest()
            == data["exportSHA256"]
        )
        spans = check_arrays(package.data, data)
        layouts[data["collisionArrayLayout"]] += 1
        records.append(
            dict(
                mesh=name,
                triangles=data["collisionTriangleCount"],
                nodes=data["collisionNodeCount"],
                sourceExportSHA256=data["exportSHA256"],
                arrays=spans,
            )
        )
    if not records:
        raise ValueError("no source collision records qualified for comparison")
    return dict(
        tool="Elbera Tools",
        status="pass",
        tile=tile,
        sources=audit.sources,
        selection=report["summary"],
        meshes=len(records),
        triangles=sum(row["triangles"] for row in records),
        nodes=sum(row["nodes"] for row in records),
        layouts=dict(layouts),
        records=records,
        limits=[
            "Exact decoded-package array byte round trip, including compact-index encoding and lazy saved ends.",
            "Reads every geometry record admitted by existing class/version/material gates, including references from actors rejected by placement gates.",
            "Not native archive I/O execution, current actor/cache state, collision result parity or complete map coverage.",
            "Malformed/noncanonical compact streams and unsupported versions are outside this evidence.",
        ],
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tiles", nargs="+")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    for tile in args.tiles:
        report = verify(tile)
        if args.check:
            report = {
                key: report[key]
                for key in [
                    "status",
                    "tile",
                    "meshes",
                    "triangles",
                    "nodes",
                    "layouts",
                    "selection",
                ]
            }
        print(json.dumps(report, indent=None if args.check else 2))


if __name__ == "__main__":
    main()
