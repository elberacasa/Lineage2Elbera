"""Portable Elbera Tools tests; all PE bytes and machine code are synthetic."""
import hashlib
from pathlib import Path
import struct
import tempfile
import unittest

from supplemental_pe import PEImage
from check_supplemental_engine import compare_method


def fixture():
    data = bytearray(0xa00)
    data[:2] = b'MZ'
    struct.pack_into('<I', data, 60, 0x80)
    data[0x80:0x84] = b'PE\0\0'
    struct.pack_into('<HH', data, 0x84, 0x14c, 1)
    struct.pack_into('<H', data, 0x94, 224)
    optional = 0x98
    struct.pack_into('<H', data, optional, 0x10b)
    struct.pack_into('<I', data, optional + 28, 0x400000)
    struct.pack_into('<I', data, optional + 60, 0x200)
    struct.pack_into('<II', data, optional + 96, 0x1100, 0x80)
    struct.pack_into('<II', data, optional + 104, 0x1200, 20)
    section = optional + 224
    data[section:section + 8] = b'.code\0\0\0'
    struct.pack_into('<4I', data, section + 8, 0x1000, 0x1000, 0x800, 0x200)
    data[0x200:0x205] = b'\xe9' + struct.pack('<i', 0x1b)
    data[0x220] = 0xc3
    data[0x230:0x236] = b'\xff\x15' + struct.pack('<I', 0x401340)
    # RVA1100 maps raw300, including named export and zero-file-backed global.
    struct.pack_into('<IIHH7I', data, 0x300, 0, 0, 0, 0, 0, 1, 2, 2, 0x1180, 0x1188, 0x1190)
    struct.pack_into('<II', data, 0x380, 0x1000, 0x1a00)
    struct.pack_into('<II', data, 0x388, 0x11a0, 0x11b0)
    struct.pack_into('<HH', data, 0x390, 0, 1)
    data[0x3a0:0x3a7] = b'Method\0'
    data[0x3b0:0x3b7] = b'Global\0'
    struct.pack_into('<5I', data, 0x400, 0x1320, 0, 0, 0x1300, 0x1340)
    data[0x500:0x509] = b'core.dll\0'
    struct.pack_into('<II', data, 0x520, 0x1360, 0)
    struct.pack_into('<II', data, 0x540, 0x1360, 0)
    data[0x562:0x56e] = b'SyntheticOp\0'
    return data


class PEReaderTests(unittest.TestCase):
    def load(self, data, sha=None):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'synthetic.dll'
            path.write_bytes(data)
            return PEImage(path, sha or hashlib.sha256(data).hexdigest())

    def test_maps_rva_to_raw_and_resolves_export_and_import(self):
        image = self.load(fixture())
        self.assertEqual(image.body('Method'), 0x401020)
        self.assertEqual(image.read(0x401020, 1), b'\xc3')
        self.assertEqual(image.imported_call(0x401030), ('core.dll', 'SyntheticOp'))
        self.assertEqual(image.exports['Global'], 0x401a00)
        with self.assertRaises(ValueError):
            image.read(0x401a00, 1)

    def test_checks_entire_read_and_hash(self):
        image = self.load(fixture())
        for address, count in [(0x4017ff, 2), (0x4001ff, 2), (0x401000, -1), (0x3fffff, 1)]:
            with self.assertRaises(ValueError):
                image.read(address, count)
        with self.assertRaises(ValueError):
            self.load(fixture(), '0' * 64)

    def test_rejects_nonzero_descriptor_beyond_declared_size(self):
        data = fixture()
        data[0x414:0x428] = data[0x400:0x414]
        with self.assertRaisesRegex(ValueError, 'outside declared directory'):
            self.load(data)

    def test_rejects_unbacked_metadata_and_truncated_file(self):
        data = fixture()
        struct.pack_into('<I', data, 0x38c, 0x1a00)
        with self.assertRaises(ValueError):
            self.load(data)
        with self.assertRaises(ValueError):
            self.load(fixture()[:-1])

    def test_rejects_ordinal_overrun_and_unknown_iat(self):
        data = fixture()
        struct.pack_into('<H', data, 0x390, 2)
        with self.assertRaises(ValueError):
            self.load(data)
        data = fixture()
        struct.pack_into('<I', data, 0x232, 0x401344)
        with self.assertRaises(ValueError):
            self.load(data).imported_call(0x401030)


class CorrespondenceTests(unittest.TestCase):
    def test_accepts_only_named_import_and_same_call_target(self):
        old_va, new_va, target = 0x1000, 0x2000, 0x3000
        old = b'\x90' * 6 + b'\xe8' + struct.pack('<i', target - old_va - 11) + b'\xc3'
        new = b'\xff\x15\x00\x40\x00\x00' + b'\xe8' + struct.pack('<i', target - new_va - 11) + b'\xc3'
        read = lambda va, size: b'\xe9\x01\x00\x00\x00' if (va, size) == (target, 5) else b''
        result = compare_method(old, new, old_va, new_va, lambda va: ('core.dll', 'Synthetic'), read, read)
        self.assertEqual([row['kind'] for row in result['differences']], ['named-import', 'same-direct-call-target'])
        self.assertEqual(result['normalizedSHA256'], hashlib.sha256(old).hexdigest())
        mutated = new[:-1] + b'\x90'
        with self.assertRaisesRegex(ValueError, 'unexplained'):
            compare_method(old, mutated, old_va, new_va, lambda va: ('core.dll', 'Synthetic'), read, read)
        mutated = new[:7] + struct.pack('<i', target + 1 - new_va - 11) + new[11:]
        with self.assertRaisesRegex(ValueError, 'target mismatch'):
            compare_method(old, mutated, old_va, new_va, lambda va: ('core.dll', 'Synthetic'), read, read)

    def test_handler_mapping_requires_explicit_equal_entry(self):
        old = b'\x68' + struct.pack('<I', 0x5000) + b'\xc3'
        new = b'\x68' + struct.pack('<I', 0x6000) + b'\xc3'
        read = lambda va, size: bytes(range(size))
        with self.assertRaises(ValueError):
            compare_method(old, new, 0x1000, 0x2000, None, read, read)
        result = compare_method(old, new, 0x1000, 0x2000, None, read, read, (0x5000, 0x6000))
        self.assertFalse(result['differences'][0]['completeUnwindEquivalent'])
        with self.assertRaises(ValueError):
            compare_method(old, new, 0x1000, 0x2000, None, read, lambda va, size: b'X' * size, (0x5000, 0x6000))

    def test_partial_instruction_does_not_pass(self):
        with self.assertRaisesRegex(ValueError, 'cover every byte'):
            compare_method(b'\x0f', b'\x0f', 0x1000, 0x2000, None, None, None)


if __name__ == '__main__':
    unittest.main()
