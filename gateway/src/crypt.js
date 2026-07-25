// L2 protocol cryptography, ported from aCis rev 409 sources:
//  - loginserver/crypt/NewCrypt.java      (checksum + XOR pass)
//  - loginserver/crypt/LoginCrypt.java    (static first packet, then dynamic key)
//  - loginserver/crypt/ScrambledKeyPair.java (RSA modulus scrambling)
//  - gameserver/network/GameCrypt.java    (XOR stream cipher)
'use strict';

const crypto = require('crypto');
const { BlowfishEngine } = require('./blowfish.js');

const STATIC_BLOWFISH_KEY = Buffer.from([
  0x6b, 0x60, 0xcb, 0x5b, 0x82, 0xce, 0x90, 0xb1,
  0xcc, 0x2b, 0x6c, 0x55, 0x6c, 0x6c, 0x6c, 0x6c,
]);

// ---------------------------------------------------------------- NewCrypt

function verifyChecksum(raw, offset, size) {
  if ((size & 3) !== 0 || size <= 4) return false;
  let chksum = 0;
  for (let i = offset; i < offset + size - 4; i += 4) chksum ^= raw.readInt32LE(i);
  return raw.readInt32LE(offset + size - 4) === chksum;
}

function appendChecksum(raw, offset, size) {
  let chksum = 0;
  for (let i = offset; i < offset + size - 4; i += 4) chksum ^= raw.readInt32LE(i);
  raw.writeInt32LE(chksum, offset + size - 4);
}

// aCis NewCrypt.encXORPass (used by the server on the FIRST login packet, Init).
function encXORPass(raw, offset, size, key) {
  const stop = size - 8;
  let pos = 4 + offset;
  let ecx = key | 0;
  while (pos < stop) {
    let edx = raw.readInt32LE(pos);
    ecx = (ecx + edx) | 0;
    edx = (edx ^ ecx) | 0;
    raw.writeInt32LE(edx, pos);
    pos += 4;
  }
  raw.writeInt32LE(ecx, pos);
}

// Inverse of encXORPass: walks BACKWARDS from the tail (the forward pass is
// not invertible in that direction). Key is stored at size-8 by the server.
function decXORPass(raw, offset, size, key) {
  const stop = 4 + offset;
  let pos = size - 12;
  let ecx = key | 0;
  while (stop <= pos) {
    let edx = raw.readInt32LE(pos);
    edx = (edx ^ ecx) | 0;
    ecx = (ecx - edx) | 0;
    raw.writeInt32LE(edx, pos);
    pos -= 4;
  }
}

// -------------------------------------------------------------- LoginCrypt
// Client-side mirror of aCis LoginCrypt: the first packet received (Init) is
// blowfish'd with the static key + XOR pass; everything after uses the dynamic
// key from Init, with a trailing 4-byte XOR checksum. All client->server
// packets use the dynamic key + checksum, padded to a multiple of 8.

class LoginCrypt {
  constructor() {
    this._staticCipher = new BlowfishEngine(STATIC_BLOWFISH_KEY);
    this._cipher = null; // dynamic key cipher
    this._first = true;
  }

  setKey(key) {
    this._cipher = new BlowfishEngine(key);
  }

  // Decrypts a server packet in place. Returns false on checksum failure.
  decrypt(raw) {
    if (this._first) {
      this._first = false;
      this._staticCipher.decrypt(raw, 0, raw.length);
      const rndXor = raw.readInt32LE(raw.length - 8);
      decXORPass(raw, 0, raw.length, rndXor);
      return true;
    }
    this._cipher.decrypt(raw, 0, raw.length);
    return verifyChecksum(raw, 0, raw.length);
  }

  // Takes a plaintext payload, returns a ready-to-send encrypted body
  // (checksum + padding + dynamic blowfish).
  encrypt(payload) {
    let size = payload.length + 4; // checksum reserve
    size += 8 - (size % 8);
    const raw = Buffer.alloc(size);
    payload.copy(raw, 0);
    appendChecksum(raw, 0, size);
    this._cipher.encrypt(raw, 0, size);
    return raw;
  }
}

// --------------------------------------------------------------- GameCrypt
// Client-side mirror of aCis GameCrypt. The first server packet (VersionCheck)
// goes out plaintext while enabling the cipher, so our first decrypt() call
// must also pass through untouched; the first client packet
// (SendProtocolVersion) is likewise sent plaintext.

const GAME_KEY_TAIL = Buffer.from([0xc8, 0x27, 0x93, 0x01, 0xa1, 0x6c, 0x31, 0x97]);

class GameCrypt {
  constructor() {
    this._inKey = Buffer.alloc(16);
    this._outKey = Buffer.alloc(16);
    this._enabled = false;
  }

  // key8: the 8 key bytes from VersionCheck; the last 8 are static
  // (gameserver/network/BlowFishKeygen.java).
  setKey(key8) {
    key8.copy(this._inKey, 0, 0, 8);
    key8.copy(this._outKey, 0, 0, 8);
    GAME_KEY_TAIL.copy(this._inKey, 8);
    GAME_KEY_TAIL.copy(this._outKey, 8);
  }

  decrypt(raw) {
    if (!this._enabled) {
      this._enabled = true;
      return;
    }
    let temp = 0;
    for (let i = 0; i < raw.length; i++) {
      const temp2 = raw[i];
      raw[i] = (temp2 ^ this._inKey[i & 15] ^ temp) & 0xff;
      temp = temp2;
    }
    bumpKey(this._inKey, raw.length);
  }

  encrypt(raw) {
    // Mirror of server behavior: while disabled, pass plaintext.
    if (!this._enabled) return;
    let temp = 0;
    for (let i = 0; i < raw.length; i++) {
      const temp2 = raw[i];
      raw[i] = (temp2 ^ this._outKey[i & 15] ^ temp) & 0xff;
      temp = raw[i];
    }
    bumpKey(this._outKey, raw.length);
  }
}

function bumpKey(key, size) {
  let old = key.readUInt32LE(8);
  old = (old + size) >>> 0;
  key.writeUInt32LE(old, 8);
}

// -------------------------------------------------------- RSA + scrambling

// Inverse of ScrambledKeyPair.scrambleModulus: same steps in reverse order.
function unscrambleModulus(scrambled) {
  const mod = Buffer.from(scrambled);
  // step 4: xor last 0x40 bytes with first 0x40 bytes
  for (let i = 0; i < 0x40; i++) mod[0x40 + i] ^= mod[i];
  // step 3: xor bytes 0x0d-0x10 with bytes 0x34-0x37
  for (let i = 0; i < 4; i++) mod[0x0d + i] ^= mod[0x34 + i];
  // step 2: xor first 0x40 bytes with last 0x40 bytes
  for (let i = 0; i < 0x40; i++) mod[i] ^= mod[0x40 + i];
  // step 1: 0x4d-0x50 <-> 0x00-0x04
  for (let i = 0; i < 4; i++) {
    const t = mod[i];
    mod[i] = mod[0x4d + i];
    mod[0x4d + i] = t;
  }
  return mod;
}

// Raw RSA (RSA/ECB/NoPadding) encryption of a 128-byte block with the server
// public key. aCis reads the login at 0x5E (14 bytes) and password at 0x6C
// (16 bytes); the rest may be zero.
function rsaEncryptAuthBlock(modulus128, user, password) {
  const block = Buffer.alloc(128);
  block.write(user.slice(0, 14), 0x5e, 14, 'ascii');
  block.write(password.slice(0, 16), 0x6c, 16, 'ascii');
  const key = crypto.createPublicKey({
    key: {
      kty: 'RSA',
      n: base64url(modulus128),
      e: 'AQAB', // 65537
    },
    format: 'jwk',
  });
  return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, block);
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

module.exports = {
  STATIC_BLOWFISH_KEY,
  verifyChecksum,
  appendChecksum,
  encXORPass,
  decXORPass,
  LoginCrypt,
  GameCrypt,
  unscrambleModulus,
  rsaEncryptAuthBlock,
};
