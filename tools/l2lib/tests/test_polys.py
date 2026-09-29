"""Portable synthetic Polys framing cases; no original client inputs."""

import struct
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from l2lib import L2Error, read_polys, encode_compact


def polys_fixture(licensee=22, count=1):
    c = encode_compact
    polygon = c(3) + struct.pack("<12f", -0.0, 2, 3, 0, 0, 1, 1, 0, 0, 0, 1, 0)
    polygon += struct.pack("<9f", 0, 0, 0, 2, 0, 0, 0, 3, 0)
    polygon += struct.pack("<I", 0x80000001) + b"".join(c(n) for n in (0, 0, 0, -2, 4))
    polygon += struct.pack("<f", 7.5)
    if licensee >= 22:
        polygon += struct.pack("<I", 0x76543210)
    body = b"\0" + struct.pack("<ii", count, count + 3) + polygon * count
    start = 17
    export = SimpleNamespace(
        index=0,
        serial_offset=start,
        serial_size=len(body),
        package_index=0,
        class_index=-2,
        object_flags=0,
        label="Faces",
    )
    imports = [
        SimpleNamespace(label="Engine", package_index=0),
        SimpleNamespace(label="Polys", package_index=-1),
    ]
    package = SimpleNamespace(
        data=bytes(start) + body + b"NEIGHBOR EXPORT",
        path=Path("authored.unr"),
        file_version=123,
        licensee_version=licensee,
        name=lambda n: "None" if n == 0 else "Unexpected",
        exports=[export],
        imports=imports,
        class_name_of=lambda ex: "Polys",
        export_name=lambda ex: ex.label,
        import_name=lambda im: im.label,
    )
    package.resolve_ref = lambda ref: (
        package.exports[ref - 1] if ref > 0 else package.imports[-ref - 1]
    )
    return package, export


class PolysFramingTest(unittest.TestCase):
    def test_native_gate_21_to_22_ignores_legacy_probe_and_preserves_values(self):
        for version in (0, 20, 21, 22, 25):
            package, export = polys_fixture(version)
            with patch(
                "l2lib.ue2package._bsp_long_form",
                side_effect=AssertionError("legacy probe used"),
            ):
                (polygon,) = read_polys(package, export)
            self.assertEqual(
                struct.pack("<f", polygon.base[0]), struct.pack("<f", -0.0)
            )
            self.assertEqual(polygon.i_link, -2)
            self.assertEqual(polygon.flags, 0x80000001)
            self.assertEqual(polygon.shadow_map_scale, 7.5)
            self.assertEqual(
                polygon.lighting_channels, 0x76543210 if version >= 22 else 0xFFFFFFFF
            )

    def test_export_boundary_prevents_neighbor_bytes_completing_a_truncated_field(self):
        package, export = polys_fixture()
        for removed in (1, 4, 8, 20):
            prior = export.serial_size
            export.serial_size = prior - removed
            with self.assertRaises(L2Error):
                read_polys(package, export)
            export.serial_size = prior
        export.serial_size += 1
        with self.assertRaises(L2Error):
            read_polys(package, export)

    def test_zero_polygons_and_independent_saved_max_are_preserved(self):
        package, export = polys_fixture(count=0)
        self.assertEqual(read_polys(package, export), [])
        package, export = polys_fixture(count=2)
        self.assertEqual(len(read_polys(package, export)), 2)

    def test_older_file_versions_keep_explicitly_unqualified_legacy_selection(self):
        package, export = polys_fixture()
        package.file_version = 122
        with patch("l2lib.ue2package._bsp_long_form", return_value=True) as probe:
            self.assertEqual(len(read_polys(package, export)), 1)
        probe.assert_called_once_with(package)


if __name__ == "__main__":
    unittest.main()
