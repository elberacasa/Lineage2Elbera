"""Elbera Tools: synthetic export boundaries, no private client required."""
import unittest
from types import SimpleNamespace

from extract_uscript import source_text, sources_from_package


def package(bodies):
    exports, data = [], b''
    for body in bodies:
        exports.append(SimpleNamespace(serial_offset=len(data), serial_size=len(body)))
        data += body
    return SimpleNamespace(data=data, exports=exports, class_name_of=lambda _: 'TextBuffer')


class SourceBoundaryTests(unittest.TestCase):
    def test_empty_buffer_cannot_borrow_a_later_class(self):
        pkg = package([b'\0' * 8, b'\0class Actual extends Object;\r\n\0'])
        self.assertEqual(list(sources_from_package(pkg)), [('Actual', 'class Actual extends Object;\r\n')])

    def test_unterminated_source_cannot_consume_neighbor_terminator(self):
        pkg = package([b'class Truncated extends Object;', b'\0class Neighbor extends Object;\0'])
        with self.assertRaisesRegex(ValueError, 'unterminated'):
            list(sources_from_package(pkg))

    def test_korean_comment_bytes_and_line_endings_are_preserved(self):
        text = b'class Original expands Object;\r\n//\xb0\xa1\xb3\xaa\r\n'
        name, recovered = source_text(b'\0\0' + text + b'\0trailing archive bytes')
        self.assertEqual(name, 'Original')
        self.assertEqual(recovered.encode('latin-1'), text)

    def test_duplicate_class_cannot_silently_overwrite_an_output_file(self):
        pkg = package([b'class Same extends Object;\0', b'class same extends Object;\0'])
        with self.assertRaisesRegex(ValueError, 'duplicate source class'):
            list(sources_from_package(pkg))

    def test_invalid_export_extents_fail_instead_of_clamping(self):
        for start, size in [(-1, 1), (0, 10), (1, -1)]:
            pkg = package([b'\0'])
            pkg.exports[0].serial_offset, pkg.exports[0].serial_size = start, size
            with self.assertRaisesRegex(ValueError, 'outside package'):
                list(sources_from_package(pkg))

    def test_unrelated_export_and_nonclass_buffer_are_not_source_classes(self):
        pkg = package([b'class Decoy extends Object;\0'])
        pkg.class_name_of = lambda _: 'Function'
        self.assertEqual(list(sources_from_package(pkg)), [])
        self.assertIsNone(source_text(b'// A buffer without a declaration\0'))


if __name__ == '__main__':
    unittest.main()
