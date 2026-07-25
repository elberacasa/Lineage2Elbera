"""Reader for decrypted Lineage 2 .dat files (L2ASM/L2FileEdit binary format)
plus transparent decryption of the Lineage2Ver 413/RSA wrapper.

Format after l2encdec decryption (protocol 413 RSA wrapper removed):
  - little-endian
  - UINT  : int32
  - UCHAR : uint8
  - FLOAT : float32
  - UNICODE string: int32 byte-length (exact, NOT null-terminated inside the
    length), then UTF-16LE bytes. Empty string = length 0.
  - ASCF string: compact-int length INCLUDING a trailing NUL byte, then
    cp1252 bytes (negative length = UTF-16LE, byte count -2*n). Compact int:
    first byte holds sign (bit7), 6 value bits, and a continuation flag
    (bit6); following bytes add 7 bits each (same FCompactIndex layout as
    UE2 packages, capped at 5 bytes here).

Reference: majestic-world/L2ClientDat (Java) ByteReader.java +
dist/data/structure/06_interlude.xml (ScionsOfDestiny schemas), verified
against assets/interlude/system/*.dat in this repository.
"""

import os
import struct

from .ue2package import L2Error, decrypt_file_bytes, detect_protocol


class DatReader(object):
    """Cursor over decrypted .dat bytes with the L2 string/int primitives."""

    def __init__(self, data, path="<bytes>"):
        self.data = data
        self.pos = 0
        self.path = path

    def _take(self, n):
        if self.pos + n > len(self.data):
            raise L2Error("%s: need %d bytes at %d, only %d left"
                          % (self.path, n, self.pos,
                             len(self.data) - self.pos))
        chunk = self.data[self.pos:self.pos + n]
        self.pos += n
        return chunk

    def u8(self):
        return self._take(1)[0]

    def u32(self):
        return struct.unpack("<I", self._take(4))[0]

    def i32(self):
        return struct.unpack("<i", self._take(4))[0]

    def f32(self):
        return struct.unpack("<f", self._take(4))[0]

    def bytes(self, n):
        return self._take(n)

    def compact_int(self):
        """FCompactIndex variant used for ASCF lengths (max 5 bytes; the
        5th byte contributes only 5 bits)."""
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

    def ustr(self):
        """UNICODE: int32 byte length (no NUL included), UTF-16LE payload."""
        size = self.i32()
        if size <= 0:
            return ""
        if size > 1_000_000 or size % 2:
            raise L2Error("%s: bad string size %d at %d"
                          % (self.path, size, self.pos - 4))
        return self._take(size).decode("utf-16-le")

    def ascf(self):
        """ASCF: compact-int length including trailing NUL, cp1252 payload
        (negative length = UTF-16LE)."""
        n = self.compact_int()
        if n == 0:
            return ""
        size = n if n > 0 else -2 * n
        charset = "cp1252" if n > 0 else "utf-16-le"
        raw = self._take(size)
        trim = 1 if n > 0 else 2  # strip the trailing NUL
        return raw[:-trim].decode(charset) if size >= trim else ""

    def done(self):
        return self.pos == len(self.data)

    def remaining(self):
        return len(self.data) - self.pos


def decrypt_dat(source, path=None):
    """Decrypt a .dat file given as bytes or filesystem path.

    Returns (plain_bytes, protocol_or_None). Unencrypted input is passed
    through unchanged.
    """
    if isinstance(source, (bytes, bytearray)):
        data = bytes(source)
        filename = path or "<bytes>"
    else:
        filename = source
        try:
            with open(source, "rb") as f:
                data = f.read()
        except OSError as exc:
            raise L2Error("cannot read %s: %s" % (source, exc))
    return decrypt_file_bytes(data, os.path.basename(filename))


def load_dat(source, path=None):
    """Decrypt and wrap in a DatReader. Returns (DatReader, protocol)."""
    plain, protocol = decrypt_dat(source, path)
    name = path or (source if isinstance(source, str) else "<bytes>")
    return DatReader(plain, path=name), protocol


__all__ = ["DatReader", "decrypt_dat", "load_dat", "detect_protocol"]
