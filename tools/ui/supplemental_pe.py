"""Elbera Tools: bounded, read-only PE32 metadata for supplemental evidence.

This reader does not load or execute an image, recover erased imports, or
authenticate a distributor. Callers must pin the complete input SHA256 and
independently establish correspondence with the original method being studied.
Addresses exposed by this API are preferred-base VAs, never raw file offsets.
"""
import hashlib
from pathlib import Path
import struct


class PEImage:
    def __init__(self, path, expected_sha256):
        self.path = Path(path)
        self.data = self.path.read_bytes()
        self.sha = hashlib.sha256(self.data).hexdigest()
        if self.sha != expected_sha256:
            raise ValueError(f'unsupported supplemental image SHA256: {self.path}')
        if self.data[:2] != b'MZ':
            raise ValueError('missing DOS signature')
        pe = self._raw_u32(60)
        if self._raw(pe, 4) != b'PE\0\0':
            raise ValueError('missing PE signature')
        machine, count = struct.unpack('<HH', self._raw(pe + 4, 4))
        optional_size = struct.unpack('<H', self._raw(pe + 20, 2))[0]
        optional = pe + 24
        if machine != 0x14c or optional_size < 224 or self._raw(optional, 2) != b'\x0b\x01':
            raise ValueError('only PE32 x86 images are supported')
        if not 0 < count <= 96:
            raise ValueError('invalid PE section count')
        self.base = self._raw_u32(optional + 28)
        self.timestamp = self._raw_u32(pe + 8)
        self.header_size = self._raw_u32(optional + 60)
        self._raw(0, self.header_size)
        self.sections = []
        start = optional + optional_size
        for i in range(count):
            entry = self._raw(start + i * 40, 40)
            vs, rva, size, raw = struct.unpack_from('<4I', entry, 8)
            self._raw(raw, size)
            if rva < self.header_size or rva + max(vs, size) > 0x100000000 - self.base:
                raise ValueError('invalid section address range')
            self.sections.append((vs, rva, size, raw))
        ranges = sorted((rva, rva + max(vs, size)) for vs, rva, size, _ in self.sections)
        if any(left[1] > right[0] for left, right in zip(ranges, ranges[1:])):
            raise ValueError('overlapping virtual sections')
        self.exports = {}
        self.forwarded_exports = {}
        export_rva, export_size = struct.unpack('<II', self._raw(optional + 96, 8))
        if export_rva:
            table = struct.unpack('<IIHH7I', self.read(self.base + export_rva, 40))
            functions_count, names_count, functions, names, ordinals = table[6:]
            if names_count > functions_count or functions_count > 1000000:
                raise ValueError('invalid export table count')
            for i in range(names_count):
                name = self.cstring(self.base + self.u32(self.base + names + i * 4))
                ordinal = struct.unpack('<H', self.read(self.base + ordinals + i * 2, 2))[0]
                if ordinal >= functions_count or name in self.exports or name in self.forwarded_exports:
                    raise ValueError('invalid or duplicate export entry')
                rva = self.u32(self.base + functions + ordinal * 4)
                if export_rva <= rva < export_rva + export_size:
                    self.forwarded_exports[name] = self.cstring(self.base + rva)
                else:
                    # Exported globals may legitimately be in zero-fill BSS.
                    # Record their VA, but read() still refuses absent bytes.
                    if not (0 < rva < self.header_size or any(
                            address <= rva < address + max(vs, size)
                            for vs, address, size, _ in self.sections)):
                        raise ValueError('export address outside virtual image')
                    self.exports[name] = self.base + rva
        self.imports = {}
        import_rva, import_size = struct.unpack('<II', self._raw(optional + 104, 8))
        if import_rva:
            terminated = False
            # Some reconstructed PEs exclude the all-zero terminator from the
            # directory size. Permit exactly that extra row, never a descriptor.
            for pos in range(0, import_size + 1, 20):
                row = struct.unpack('<5I', self.read(self.base + import_rva + pos, 20))
                if not any(row):
                    terminated = True
                    break
                if pos + 20 > import_size:
                    raise ValueError('import descriptor outside declared directory')
                original, _, _, name, first = row
                if not first:
                    raise ValueError('missing import address table')
                dll = self.cstring(self.base + name)
                for i in range(1000000):
                    thunk = self.u32(self.base + (original or first) + i * 4)
                    if not thunk:
                        break
                    symbol = ('#' + str(thunk & 0xffff)) if thunk & 0x80000000 else self.cstring(self.base + thunk + 2)
                    iat = self.base + first + i * 4
                    self.offset(iat, 4)
                    if iat in self.imports:
                        raise ValueError('duplicate import address')
                    self.imports[iat] = (dll, symbol)
                else:
                    raise ValueError('unterminated import thunk table')
            if not terminated:
                raise ValueError('unterminated import descriptors')

    def _raw(self, offset, size):
        if not isinstance(offset, int) or not isinstance(size, int) or offset < 0 or size < 0 or offset + size > len(self.data):
            raise ValueError('read outside source file')
        return self.data[offset:offset + size]

    def _raw_u32(self, offset):
        return struct.unpack('<I', self._raw(offset, 4))[0]

    def offset(self, va, size=1):
        if not isinstance(va, int) or not isinstance(size, int) or size < 0:
            raise ValueError('integer address and nonnegative read size required')
        rva = va - self.base
        if 0 <= rva and rva + size <= self.header_size:
            return rva
        for _, address, raw_size, raw in self.sections:
            if address <= rva and rva + size <= address + raw_size:
                return raw + rva - address
        raise ValueError(f'unmapped or non-file-backed range: {va:#x}+{size:#x}')

    def read(self, va, size):
        return self._raw(self.offset(va, size), size)

    def u32(self, va):
        return struct.unpack('<I', self.read(va, 4))[0]

    def cstring(self, va, limit=65536):
        result = bytearray()
        for i in range(limit):
            value = self.read(va + i, 1)
            if value == b'\0':
                return result.decode('ascii')
            result.extend(value)
        raise ValueError('unterminated metadata string')

    def body(self, symbol):
        """Resolve one exported E9 thunk; leave ordinary entry points as-is."""
        va = self.exports[symbol]
        if self.read(va, 1) == b'\xe9':
            va += 5 + struct.unpack('<i', self.read(va + 1, 4))[0]
            self.offset(va, 1)
        return va

    def imported_call(self, va):
        """Resolve only a literal x86 FF 15 absolute-IAT call at this address."""
        code = self.read(va, 6)
        if code[:2] != b'\xff\x15':
            raise ValueError(f'not a direct IAT call: {va:#x}')
        slot = struct.unpack_from('<I', code, 2)[0]
        if slot not in self.imports:
            raise ValueError(f'call address is absent from named imports: {slot:#x}')
        return self.imports[slot]
