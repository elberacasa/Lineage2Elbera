// Little-endian packet reader/writer for the L2 wire format.
// writeS/readS are UTF-16LE, terminated by a 0x0000.
// NOTE: aCis 409's writeF is a DOUBLE (8 bytes), not a 4-byte float
// (commons/mmocore/SendablePacket.java: putDouble). This deviates from
// retail L2J packs — readF/writeF here match the aCis source.
'use strict';

class PacketWriter {
  constructor() {
    this.parts = [];
    this.length = 0;
  }
  writeC(v) { const b = Buffer.alloc(1); b.writeUInt8(v & 0xff); this._push(b); return this; }
  writeH(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff); this._push(b); return this; }
  writeD(v) { const b = Buffer.alloc(4); b.writeInt32LE(v | 0); this._push(b); return this; }
  writeQ(v) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); this._push(b); return this; }
  writeF(v) { const b = Buffer.alloc(8); b.writeDoubleLE(v); this._push(b); return this; }
  writeB(buf) { this._push(Buffer.from(buf)); return this; }
  writeS(str) {
    const b = Buffer.from(str, 'utf16le');
    this._push(b);
    return this.writeH(0);
  }
  writeLoc(x, y, z) { return this.writeD(x).writeD(y).writeD(z); }
  _push(b) { this.parts.push(b); this.length += b.length; }
  build() { return Buffer.concat(this.parts, this.length); }
}

class PacketReader {
  constructor(buf) { this.buf = buf; this.pos = 0; }
  remaining() { return this.buf.length - this.pos; }
  readC() { const v = this.buf.readUInt8(this.pos); this.pos += 1; return v; }
  readH() { const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
  readD() { const v = this.buf.readInt32LE(this.pos); this.pos += 4; return v; }
  readQ() { const v = this.buf.readBigInt64LE(this.pos); this.pos += 8; return v; }
  readF() { const v = this.buf.readDoubleLE(this.pos); this.pos += 8; return v; }
  readB(n) { const v = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return v; }
  readS() {
    let end = this.pos;
    while (end + 1 < this.buf.length && this.buf.readUInt16LE(end) !== 0) end += 2;
    const s = this.buf.toString('utf16le', this.pos, end);
    this.pos = end + 2;
    return s;
  }
}

// Splits a TCP stream into L2 packets: 2-byte LE length header, inclusive of
// the header itself (mmocore SelectorThread, HEADER_SIZE = 2).
class PacketFramer {
  constructor(onPacket) {
    this.buf = Buffer.alloc(0);
    this.onPacket = onPacket;
  }
  push(data) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, data]) : data;
    for (;;) {
      if (this.buf.length < 2) return;
      const total = this.buf.readUInt16LE(0);
      if (this.buf.length < total) return;
      this.onPacket(this.buf.subarray(2, total));
      this.buf = this.buf.subarray(total);
    }
  }
}

// Wraps a payload (already encrypted if needed) with the 2-byte length header.
function frame(payload) {
  const out = Buffer.alloc(2 + payload.length);
  out.writeUInt16LE(2 + payload.length, 0);
  payload.copy(out, 2);
  return out;
}

module.exports = { PacketWriter, PacketReader, PacketFramer, frame };
