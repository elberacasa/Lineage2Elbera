// Game server session (aCis rev 409, port 7777).
//   C->S SendProtocolVersion(0x00)  version 746, plaintext
//   S->C VersionCheck(0x00)         0x01 + key[8], plaintext; enables GameCrypt
//   C->S AuthLogin(0x08)            S account, D playOk2, D playOk1, D loginOk1, D loginOk2
//   S->C CharSelectInfo(0x13)
//   C->S RequestCharacterCreate(0x0b)  (optional, when account has no char)
//   S->C CharCreateOk(0x19) + CharSelectInfo(0x13)
//   C->S RequestGameStart(0x0d)     slot
//   S->C CharSelected(0x15)
//   C->S EnterWorld(0x03)
//   S->C ... UserInfo(0x04), NpcInfo(0x16), CharInfo(0x03), ...
// In game:
//   C->S MoveBackwardToLocation(0x01), Say2(0x38), ValidatePosition(0x48)
'use strict';

const net = require('net');
const { EventEmitter } = require('events');
const { PacketWriter, PacketReader, PacketFramer, frame } = require('./l2io.js');
const { GameCrypt } = require('./crypt.js');
const { gatedConnect } = require('./governor.js');

const PROTOCOL_VERSION = 746;

class GameSession extends EventEmitter {
  constructor() {
    super();
    this.crypt = new GameCrypt();
    this.state = 'INIT';
    this.pos = { x: 0, y: 0, z: 0, heading: 0 }; // last known own position
    this.packetLog = new Map(); // opcode -> count, for debugging unknown packets
  }

  connect(host, port, account, sessionKey) {
    this.account = account;
    this.sessionKey = sessionKey;
    this.framer = new PacketFramer((body) => this._onPacket(body));
    gatedConnect(() => new Promise((resolve, reject) => {
      this.sock = net.connect(port, host);
      this.sock.on('data', (d) => this.framer.push(d));
      this.sock.on('error', (e) => this.emit('error', e));
      this.sock.on('close', () => this.emit('close'));
      this.sock.on('connect', () => {
        // SendProtocolVersion (plaintext)
        this._send(new PacketWriter().writeC(0x00).writeD(PROTOCOL_VERSION).build());
        this.state = 'CONNECTED';
        this.emit('debug', 'socket connected, SendProtocolVersion sent');
        resolve();
      });
      this.sock.once('error', reject);
    })).catch(() => {});
  }

  close() {
    try { this.sock && this.sock.destroy(); } catch (_) { /* ignore */ }
  }

  // ---------------------------------------------------------------- sends

  _send(payload) {
    const buf = Buffer.from(payload);
    this.crypt.encrypt(buf);
    this.sock.write(frame(buf));
  }

  authLogin() {
    const k = this.sessionKey;
    this._send(
      new PacketWriter()
        .writeC(0x08)
        .writeS(this.account)
        .writeD(k.playOk2).writeD(k.playOk1)
        .writeD(k.loginOk1).writeD(k.loginOk2)
        .build()
    );
    this.state = 'AUTH_SENT';
  }

  createCharacter(name) {
    // Human Fighter: race 0, sex 0 (male), classId 0. Stats are read but the
    // server uses the template; hairStyle/hairColor/face = 0.
    this._send(
      new PacketWriter()
        .writeC(0x0b)
        .writeS(name)
        .writeD(0).writeD(0).writeD(0) // race, sex, classId
        .writeD(0).writeD(0).writeD(0).writeD(0).writeD(0).writeD(0) // int str con men dex wit
        .writeD(0).writeD(0).writeD(0) // hairStyle, hairColor, face
        .build()
    );
  }

  selectChar(slot) {
    this._send(
      new PacketWriter()
        .writeC(0x0d)
        .writeD(slot).writeH(0).writeD(0).writeD(0).writeD(0)
        .build()
    );
    this.state = 'SELECT_SENT';
  }

  enterWorld() {
    this._send(new PacketWriter().writeC(0x03).build());
    this.state = 'ENTERING';
  }

  moveTo(x, y, z) {
    const o = this.pos;
    this._send(
      new PacketWriter()
        .writeC(0x01)
        .writeD(x | 0).writeD(y | 0).writeD(z | 0)
        .writeD(o.x | 0).writeD(o.y | 0).writeD(o.z | 0)
        .writeD(1) // 1 = mouse movement (0 = keyboard, rejected by aCis)
        .build()
    );
  }

  say(channel, text) {
    this._send(new PacketWriter().writeC(0x38).writeS(text).writeD(channel).build());
  }

  // Action (0x04): plain click — target/interact (shift=0).
  action(objectId) {
    const o = this.pos;
    this._send(
      new PacketWriter()
        .writeC(0x04)
        .writeD(objectId | 0)
        .writeD(o.x | 0).writeD(o.y | 0).writeD(o.z | 0)
        .writeC(0)
        .build()
    );
  }

  // AttackRequest (0x0a): ctrl+click — force attack (shift=0).
  attackRequest(objectId) {
    const o = this.pos;
    this._send(
      new PacketWriter()
        .writeC(0x0a)
        .writeD(objectId | 0)
        .writeD(o.x | 0).writeD(o.y | 0).writeD(o.z | 0)
        .writeC(0)
        .build()
    );
  }

  validatePosition() {
    const o = this.pos;
    this._send(
      new PacketWriter()
        .writeC(0x48)
        .writeD(o.x | 0).writeD(o.y | 0).writeD(o.z | 0)
        .writeD(o.heading | 0).writeD(0)
        .build()
    );
  }

  // ------------------------------------------------------------- receives

  _onPacket(body) {
    const buf = Buffer.from(body);
    this.crypt.decrypt(buf);
    const r = new PacketReader(buf);
    const op = r.readC();
    try {
      switch (this.state) {
        case 'CONNECTED':
          if (op === 0x00) { // VersionCheck: C 0x01, B key[8], D, D
            r.readC();
            this.crypt.setKey(Buffer.from(r.readB(8)));
            this.state = 'KEYED';
            this.authLogin();
          }
          break;

        default:
          this._dispatch(op, r);
      }
    } catch (e) {
      this.emit('parseError', { op, error: e });
    }
  }

  _dispatch(op, r) {
    switch (op) {
      case 0x13: // CharSelectInfo
        this.state = 'AUTHED';
        this.emit('charList', parseCharSelectInfo(r));
        break;
      case 0x19: // CharCreateOk
        this.emit('charCreateOk');
        break;
      case 0x1a: // CharCreateFail
        this.emit('charCreateFail', r.readD());
        break;
      case 0x15: // CharSelected -> enter the world
        this.state = 'ENTERING';
        this.enterWorld();
        break;
      case 0x04: { // UserInfo (own character, full parse incl. CP/HP/MP/exp/sp)
        const u = parseUserInfo(r);
        this.pos = { x: u.x, y: u.y, z: u.z, heading: u.heading };
        this.state = 'IN_GAME';
        this.emit('userInfo', u);
        break;
      }
      case 0x05: { // Attack (melee broadcast): D attacker, then per hit D target, D damage, C flags
        const attackerId = r.readD();
        const hits = [];
        const t0 = r.readD(); const d0 = r.readD(); const f0 = r.readC();
        hits.push({ targetId: t0, damage: d0, flags: f0 });
        r.readD(); r.readD(); r.readD(); // attacker x,y,z
        const extra = r.readH();
        for (let i = 0; i < extra; i++) {
          const t = r.readD(); const d = r.readD(); const f = r.readC();
          hits.push({ targetId: t, damage: d, flags: f });
        }
        this.emit('attack', { attackerId, hits });
        break;
      }
      case 0x06: { // Die (rest is respawn options, not needed)
        this.emit('die', r.readD());
        break;
      }
      case 0x07: { // Revive
        this.emit('revive', r.readD());
        break;
      }
      case 0x0e: { // StatusUpdate: D objectId, D count, per attr D type, D value
        const objectId = r.readD();
        const count = r.readD();
        const attrs = [];
        for (let i = 0; i < count; i++) attrs.push({ type: r.readD(), value: r.readD() });
        this.emit('statusUpdate', { id: objectId, attrs });
        break;
      }
      case 0xa6: { // MyTargetSelected: D objectId, H color
        const objectId = r.readD();
        const color = r.readH();
        this.emit('myTarget', { id: objectId, color });
        break;
      }
      case 0x64: { // SystemMessage: decoded shallowly for logs
        this.emit('systemMessage', parseSystemMessage(r));
        break;
      }
      case 0x03: // CharInfo (other player)
        this.emit('charInfo', parseCharInfo(r));
        break;
      case 0x16: // NpcInfo
        this.emit('npcInfo', parseNpcInfo(r));
        break;
      case 0x01: { // MoveToLocation
        const id = r.readD();
        const tx = r.readD(); const ty = r.readD(); const tz = r.readD();
        const cx = r.readD(); const cy = r.readD(); const cz = r.readD();
        this.emit('move', { id, tx, ty, tz, x: cx, y: cy, z: cz });
        break;
      }
      case 0x12: { // DeleteObject
        this.emit('delete', r.readD());
        break;
      }
      case 0x4a: { // CreatureSay
        const objectId = r.readD();
        const channel = r.readD();
        if (r.remaining() === 8) {
          r.readD(); r.readD(); // sysString/sysMsg variant, not chat text
          break;
        }
        const name = r.readS();
        const text = r.readS();
        this.emit('say', { objectId, channel, name, text });
        break;
      }
      case 0x28: { // TeleportToLocation
        const id = r.readD();
        const x = r.readD(); const y = r.readD(); const z = r.readD();
        r.readD(); // fast teleport flag
        this.emit('teleport', { id, x, y, z });
        break;
      }
      case 0x61: { // ValidateLocation
        const id = r.readD();
        const x = r.readD(); const y = r.readD(); const z = r.readD();
        const heading = r.readD();
        this.emit('validate', { id, x, y, z, heading });
        break;
      }
      default:
        this.packetLog.set(op, (this.packetLog.get(op) || 0) + 1);
        this.emit('packet', op);
    }
  }
}

function parseCharSelectInfo(r) {
  const size = r.readD();
  const chars = [];
  for (let i = 0; i < size; i++) {
    const name = r.readS();
    const charId = r.readD();
    r.readS(); // login name
    r.readD(); // session id
    r.readD(); // clan id
    r.readD(); // builder level
    const sex = r.readD();
    const race = r.readD();
    const baseClassId = r.readD();
    r.readD(); // active
    const x = r.readD(); const y = r.readD(); const z = r.readD();
    r.readF(); r.readF(); // cur hp/mp
    r.readD(); // sp
    r.readQ(); // exp
    const level = r.readD();
    r.readD(); r.readD(); r.readD(); // karma, pk, pvp
    for (let j = 0; j < 7; j++) r.readD();
    for (let j = 0; j < 17; j++) r.readD(); // paperdoll object ids
    for (let j = 0; j < 17; j++) r.readD(); // paperdoll item ids
    r.readD(); r.readD(); r.readD(); // hairStyle, hairColor, face
    r.readF(); r.readF(); // max hp/mp
    r.readD(); // delete timer
    const classId = r.readD();
    r.readD(); // auto-selected flag
    r.readC(); // enchant effect
    r.readD(); // augmentation
    chars.push({ slot: i, name, charId, race, sex, classId, baseClassId, level, x, y, z });
  }
  return chars;
}

function parseCharInfo(r) {
  const x = r.readD(); const y = r.readD(); const z = r.readD();
  r.readD(); // boat object id
  const objectId = r.readD();
  const name = r.readS();
  const race = r.readD();
  const sex = r.readD();
  const classId = r.readD();
  for (let j = 0; j < 12; j++) r.readD(); // paperdoll item ids
  for (let j = 0; j < 4; j++) r.readH();
  r.readD(); // rhand augmentation
  for (let j = 0; j < 12; j++) r.readH();
  r.readD(); // lhand augmentation
  for (let j = 0; j < 4; j++) r.readH();
  r.readD(); r.readD(); // pvp, karma
  r.readD(); r.readD(); // mAtkSpd, pAtkSpd
  r.readD(); r.readD(); // pvp, karma
  for (let j = 0; j < 8; j++) r.readD(); // speeds
  r.readF(); r.readF(); // speed multipliers
  r.readF(); r.readF(); // collision radius/height
  r.readD(); r.readD(); r.readD(); // hairStyle, hairColor, face
  r.readS(); // title
  r.readD(); r.readD(); r.readD(); r.readD(); // clan, clan crest, ally, ally crest
  r.readD(); // 0
  r.readC(); r.readC(); r.readC(); r.readC(); r.readC(); // sitting, running, combat, alikeDead, invisible
  r.readC(); r.readC(); // mountType, operateType
  const cubics = r.readH();
  for (let j = 0; j < cubics; j++) r.readH();
  r.readC(); // party match room
  r.readD(); // abnormal effect
  r.readC(); // recom left
  r.readH(); // recom have
  r.readD(); // class id (again)
  r.readD(); r.readD(); // maxCp, cp
  r.readC(); // enchant
  r.readC(); // team
  r.readD(); // clan crest large
  r.readC(); r.readC(); // noble, hero
  r.readC(); // fishing
  r.readD(); r.readD(); r.readD(); // fishing loc
  r.readD(); // name color
  const heading = r.readD();
  // pledgeClass, pledgeType, titleColor, cursed weapon stage follow; not needed
  return { id: objectId, name, race, sex, classId, x, y, z, heading };
}

function parseNpcInfo(r) {
  const objectId = r.readD();
  const npcId = r.readD() - 1000000;
  const isAttackable = r.readD();
  const x = r.readD(); const y = r.readD(); const z = r.readD();
  const heading = r.readD();
  r.readD(); // 0
  r.readD(); r.readD(); // mAtkSpd, pAtkSpd
  for (let j = 0; j < 8; j++) r.readD(); // speeds
  r.readF(); r.readF(); // multipliers
  r.readF(); r.readF(); // collision
  r.readD(); r.readD(); r.readD(); // rhand, chest, lhand
  r.readC(); // name above
  r.readC(); r.readC(); r.readC(); r.readC(); // running, combat, alikeDead, summon anim
  const name = r.readS();
  const title = r.readS();
  return { id: objectId, npcId, isAttackable, name, title, x, y, z, heading };
}

// Full UserInfo layout (serverpackets/UserInfo.java). Remember: writeF is an
// 8-byte double in aCis 409.
function parseUserInfo(r) {
  const x = r.readD(); const y = r.readD(); const z = r.readD();
  const heading = r.readD();
  const objectId = r.readD();
  const name = r.readS();
  const race = r.readD();
  const sex = r.readD();
  const classId = r.readD();
  const level = r.readD();
  const exp = Number(r.readQ());
  for (let j = 0; j < 6; j++) r.readD(); // STR DEX CON INT WIT MEN
  const maxHp = r.readD();
  const hp = r.readD();
  const maxMp = r.readD();
  const mp = r.readD();
  const sp = r.readD();
  r.readD(); r.readD(); r.readD(); // current weight, weight limit, weapon timer
  for (let j = 0; j < 17; j++) r.readD(); // paperdoll object ids
  for (let j = 0; j < 17; j++) r.readD(); // paperdoll item ids
  for (let j = 0; j < 14; j++) r.readH();
  r.readD(); // rhand augmentation
  for (let j = 0; j < 12; j++) r.readH();
  r.readD(); // lhand augmentation
  for (let j = 0; j < 4; j++) r.readH();
  for (let j = 0; j < 10; j++) r.readD(); // pAtk pAtkSpd pDef evasion accuracy critical mAtk mAtkSpd pAtkSpd mDef
  r.readD(); r.readD(); // pvp flag, karma
  for (let j = 0; j < 8; j++) r.readD(); // speeds
  r.readF(); r.readF(); // speed multipliers
  r.readF(); r.readF(); // collision radius/height
  r.readD(); r.readD(); r.readD(); // hairStyle, hairColor, face
  r.readD(); // isGM
  r.readS(); // title
  r.readD(); r.readD(); r.readD(); r.readD(); // clan, clan crest, ally, ally crest
  r.readD(); // relation
  r.readC(); r.readC(); r.readC(); // mountType, operateType, crystallize
  r.readD(); r.readD(); // pk, pvp kills
  const cubics = r.readH();
  for (let j = 0; j < cubics; j++) r.readH();
  r.readC(); // party match room
  r.readD(); // abnormal effect
  r.readC(); // 0
  r.readD(); // clan privileges
  r.readH(); r.readH(); // recom left/have
  r.readD(); // mount npc id
  r.readH(); // inventory limit
  r.readD(); // class id (again)
  r.readD(); // 0
  const maxCp = r.readD();
  const cp = r.readD();
  // enchant, team, crestLarge, noble, hero, fishing(+loc), nameColor, running,
  // pledgeClass, pledgeType, titleColor, cursed stage follow; not needed.
  return { id: objectId, name, race, sex, classId, level, exp, sp, hp, maxHp, mp, maxMp, cp, maxCp, x, y, z, heading };
}

// Shallow SystemMessage decode (serverpackets/SystemMessage.java):
// D smId, D paramCount, per param D type + payload.
const SM_TYPES = {
  0: (r) => r.readS(), // TEXT
  1: (r) => r.readD(), // NUMBER
  2: (r) => r.readD(), // NPC_NAME
  3: (r) => r.readD(), // ITEM_NAME
  4: (r) => { const id = r.readD(); r.readD(); return id; }, // SKILL_NAME (id, level)
  5: (r) => r.readD(), // CASTLE_NAME
  6: (r) => r.readD(), // ITEM_NUMBER
  7: (r) => { const x = r.readD(); const y = r.readD(); const z = r.readD(); return [x, y, z]; }, // ZONE_NAME (loc)
};

function parseSystemMessage(r) {
  const smId = r.readD();
  const count = r.readD();
  const params = [];
  for (let i = 0; i < count && r.remaining() >= 4; i++) {
    const type = r.readD();
    try {
      params.push({ type, value: SM_TYPES[type] ? SM_TYPES[type](r) : r.readD() });
    } catch (_) {
      break; // best-effort; leave the rest unparsed
    }
  }
  return { id: smId, params };
}

module.exports = { GameSession };
