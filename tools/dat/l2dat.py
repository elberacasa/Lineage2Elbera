"""Minimal reader for decrypted Lineage 2 .dat files (L2ASM/L2FileEdit binary format).

Format after l2encdec decryption (protocol 413 RSA wrapper removed):
  - little-endian
  - UINT  : int32
  - UCHAR : uint8
  - UNICODE string: int32 byte-length (exact, NOT null-terminated inside the
    length), then UTF-16LE bytes. Empty string = length 0.
  - ASCF string: compact-int length INCLUDING a trailing NUL byte, then
    cp1252 bytes. Compact int: first byte holds sign (bit7), 6 value bits,
    and a continuation flag (bit6); following bytes add 7 bits each.

Reference: majestic-world/L2ClientDat (Java) ByteReader.java +
dist/data/structure/06_interlude.xml (ScionsOfDestiny schemas).
"""

import struct


class Reader:
    def __init__(self, data: bytes, path: str = "<bytes>"):
        self.data = data
        self.pos = 0
        self.path = path

    def _take(self, n: int) -> bytes:
        if self.pos + n > len(self.data):
            raise EOFError(f"{self.path}: need {n} bytes at {self.pos}, "
                           f"only {len(self.data) - self.pos} left")
        chunk = self.data[self.pos:self.pos + n]
        self.pos += n
        return chunk

    def u8(self) -> int:
        return self._take(1)[0]

    def u32(self) -> int:
        return struct.unpack("<I", self._take(4))[0]

    def i32(self) -> int:
        return struct.unpack("<i", self._take(4))[0]

    def f32(self) -> float:
        return struct.unpack("<f", self._take(4))[0]

    def compact_int(self) -> int:
        output = 0
        signed = False
        for i in range(5):
            x = self.u8()
            if i == 0:
                signed = bool(x & 0x80)
                output |= x & 0x3F
                if not (x & 0x40):
                    break
            elif i == 4:
                output |= (x & 0x1F) << 27
            else:
                output |= (x & 0x7F) << (6 + (i - 1) * 7)
                if not (x & 0x80):
                    break
        return -output if signed else output

    def ustr(self) -> str:
        """UNICODE: int32 byte length (no NUL included), UTF-16LE payload."""
        size = self.i32()
        if size <= 0:
            return ""
        if size > 1_000_000 or size % 2:
            raise ValueError(f"{self.path}: bad string size {size} at {self.pos - 4}")
        return self._take(size).decode("utf-16-le")

    def ascf(self) -> str:
        """ASCF: compact-int length including trailing NUL, cp1252 payload."""
        n = self.compact_int()
        if n == 0:
            return ""
        size = n if n > 0 else -2 * n
        charset = "cp1252" if n > 0 else "utf-16-le"
        raw = self._take(size)
        # strip the trailing NUL (1 byte cp1252 / 2 bytes utf-16)
        trim = 1 if n > 0 else 2
        return raw[:-trim].decode(charset) if size >= trim else ""

    def done(self) -> bool:
        return self.pos == len(self.data)
