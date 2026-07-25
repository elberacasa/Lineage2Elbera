// Blowfish engine ported 1:1 from aCis rev 409
// server/aCis_gameserver/java/net/sf/l2j/loginserver/crypt/BlowfishEngine.java
// NOTE: L2 uses LITTLE-endian word assembly (bytesTo32bits reads b[i] as LSB),
// so generic Blowfish libraries will NOT interoperate.
'use strict';

const { KP, KS0, KS1, KS2, KS3 } = require('./tables.js');

const ROUNDS = 16;
const BLOCK_SIZE = 8;
const SBOX_SK = 256;
const P_SZ = ROUNDS + 2;

class BlowfishEngine {
  constructor(key) {
    this.S0 = new Int32Array(KS0);
    this.S1 = new Int32Array(KS1);
    this.S2 = new Int32Array(KS2);
    this.S3 = new Int32Array(KS3);
    this.P = new Int32Array(KP);
    this.setKey(key);
  }

  func(x) {
    const t = (this.S0[x >>> 24] + this.S1[(x >>> 16) & 0xff]) | 0;
    return ((t ^ this.S2[(x >>> 8) & 0xff]) + this.S3[x & 0xff]) | 0;
  }

  processTable(xl, xr, table) {
    const size = table.length;
    for (let s = 0; s < size; s += 2) {
      xl = (xl ^ this.P[0]) | 0;
      for (let i = 1; i < ROUNDS; i += 2) {
        xr = (xr ^ ((this.func(xl) ^ this.P[i]) | 0)) | 0;
        xl = (xl ^ ((this.func(xr) ^ this.P[i + 1]) | 0)) | 0;
      }
      xr = (xr ^ this.P[ROUNDS + 1]) | 0;
      table[s] = xr;
      table[s + 1] = xl;
      xr = xl;
      xl = table[s];
    }
  }

  setKey(key) {
    const keyLength = key.length;
    let keyIndex = 0;
    for (let i = 0; i < P_SZ; i++) {
      let data = 0;
      for (let j = 0; j < 4; j++) {
        data = ((data << 8) | (key[keyIndex++] & 0xff)) | 0;
        if (keyIndex >= keyLength) keyIndex = 0;
      }
      this.P[i] = (this.P[i] ^ data) | 0;
    }
    this.processTable(0, 0, this.P);
    this.processTable(this.P[P_SZ - 2], this.P[P_SZ - 1], this.S0);
    this.processTable(this.S0[SBOX_SK - 2], this.S0[SBOX_SK - 1], this.S1);
    this.processTable(this.S1[SBOX_SK - 2], this.S1[SBOX_SK - 1], this.S2);
    this.processTable(this.S2[SBOX_SK - 2], this.S2[SBOX_SK - 1], this.S3);
  }

  encryptBlock(src, srcIndex, dst, dstIndex) {
    let xl = bytesTo32bits(src, srcIndex);
    let xr = bytesTo32bits(src, srcIndex + 4);
    xl = (xl ^ this.P[0]) | 0;
    for (let i = 1; i < ROUNDS; i += 2) {
      xr = (xr ^ ((this.func(xl) ^ this.P[i]) | 0)) | 0;
      xl = (xl ^ ((this.func(xr) ^ this.P[i + 1]) | 0)) | 0;
    }
    xr = (xr ^ this.P[ROUNDS + 1]) | 0;
    bits32ToBytes(xr, dst, dstIndex);
    bits32ToBytes(xl, dst, dstIndex + 4);
  }

  decryptBlock(src, srcIndex, dst, dstIndex) {
    let xl = bytesTo32bits(src, srcIndex);
    let xr = bytesTo32bits(src, srcIndex + 4);
    xl = (xl ^ this.P[ROUNDS + 1]) | 0;
    for (let i = ROUNDS; i > 0; i -= 2) {
      xr = (xr ^ ((this.func(xl) ^ this.P[i]) | 0)) | 0;
      xl = (xl ^ ((this.func(xr) ^ this.P[i - 1]) | 0)) | 0;
    }
    xr = (xr ^ this.P[0]) | 0;
    bits32ToBytes(xr, dst, dstIndex);
    bits32ToBytes(xl, dst, dstIndex + 4);
  }

  // In-place ECB over buf[offset .. offset+size), size must be a multiple of 8.
  encrypt(buf, offset, size) {
    for (let i = 0; i < size; i += BLOCK_SIZE) this.encryptBlock(buf, offset + i, buf, offset + i);
  }

  decrypt(buf, offset, size) {
    for (let i = 0; i < size; i += BLOCK_SIZE) this.decryptBlock(buf, offset + i, buf, offset + i);
  }
}

function bytesTo32bits(b, i) {
  return ((b[i + 3] & 0xff) << 24) | ((b[i + 2] & 0xff) << 16) | ((b[i + 1] & 0xff) << 8) | (b[i] & 0xff);
}

function bits32ToBytes(v, b, offset) {
  b[offset] = v & 0xff;
  b[offset + 1] = (v >> 8) & 0xff;
  b[offset + 2] = (v >> 16) & 0xff;
  b[offset + 3] = (v >> 24) & 0xff;
}

module.exports = { BlowfishEngine, BLOCK_SIZE };
