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

  say(channel, text, target) {
    // Say2 (0x38): S text, D type, and S target only when type == TELL (2)
    // (clientpackets/Say2.java).
    const w = new PacketWriter().writeC(0x38).writeS(text).writeD(channel);
    if (channel === 2 && target) w.writeS(String(target));
    this._send(w.build());
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

  // RequestMagicSkillUse (0x2f): D skillId, D ctrlPressed, C shiftPressed.
  // The server casts on the CURRENT target; the bridge sets it beforehand
  // with Action when a targetId is given.
  useSkill(skillId) {
    this._send(
      new PacketWriter()
        .writeC(0x2f)
        .writeD(skillId | 0)
        .writeD(0) // ctrlPressed = false
        .writeC(0) // shiftPressed = false
        .build()
    );
  }

  // RequestDestroyItem (0x59): D objectId, D count
  // (aCis clientpackets/RequestDestroyItem.java readImpl).
  destroyItem(objectId, count) {
    this._send(
      new PacketWriter()
        .writeC(0x59)
        .writeD(objectId | 0)
        .writeD(count | 0)
        .build()
    );
  }

  // RequestCrystallizeItem (0x72): D objectId, D count
  // (aCis clientpackets/RequestCrystallizeItem.java readImpl).
  crystallizeItem(objectId, count) {
    this._send(
      new PacketWriter()
        .writeC(0x72)
        .writeD(objectId | 0)
        .writeD(count | 0)
        .build()
    );
  }

  // UseItem (0x14): D objectId, D ctrlPressed.
  useItem(objectId) {
    this._send(
      new PacketWriter()
        .writeC(0x14)
        .writeD(objectId | 0)
        .writeD(0) // ctrlPressed = false
        .build()
    );
  }

  // RequestBypassToServer (0x21): S command — raw bypass string from dialog
  // links ("bypass -h <cmd>", e.g. npc_<objectId>_Chat 1) or voiced bypasses.
  bypass(command) {
    this._send(new PacketWriter().writeC(0x21).writeS(String(command)).build());
  }

  // RequestActionUse (0x45): D actionId, D ctrlPressed, C shiftPressed.
  // Ids (this rev's switch): 0 Sit/Stand, 1 Walk/Run, 10 Store Sell,
  // 28 Store Buy, 37 Dwarven Manufacture, 51 General Manufacture,
  // 61 Package Sell, pet/summon ids...
  requestActionUse(actionId) {
    this._send(
      new PacketWriter()
        .writeC(0x45)
        .writeD(actionId | 0)
        .writeD(0) // ctrlPressed = false
        .writeC(0) // shiftPressed = false
        .build()
    );
  }

  // RequestSocialAction (0x1b): D actionId. aCis accepts ids 2..13
  // (2 Greeting, 3 Victory, 4 Advance, 5 No, 6 Yes, 7 Bow, 8 Unaware,
  // 9 Waiting, 10 Laugh, 11 Applaud, 12 Dance, 13 Sorrow).
  requestSocialAction(actionId) {
    this._send(new PacketWriter().writeC(0x1b).writeD(actionId | 0).build());
  }

  // RequestQuestAbort (0x64): D questId.
  requestQuestAbort(questId) {
    this._send(new PacketWriter().writeC(0x64).writeD(questId | 0).build());
  }

  // RequestUserCommand (0xaa): D commandId. 52 = /unstuck (Escape skill).
  userCommand(commandId) {
    this._send(new PacketWriter().writeC(0xaa).writeD(commandId | 0).build());
  }

  // RequestPrivateStoreManageSell (0x73): opens the sell-store management.
  requestPrivateStoreManageSell() {
    this._send(new PacketWriter().writeC(0x73).build());
  }

  // SetPrivateStoreListSell (0x74): D packageSale, D count, per item
  // D objectId, D count, D price. Opens the store on success.
  setPrivateStoreListSell(items, packageSale = false) {
    const w = new PacketWriter()
      .writeC(0x74)
      .writeD(packageSale ? 1 : 0)
      .writeD(items.length);
    for (const it of items) w.writeD(it.objectId | 0).writeD(it.count | 0).writeD(it.price | 0);
    this._send(w.build());
  }

  // RequestPrivateStoreManageBuy (0x90): opens the buy-store management.
  requestPrivateStoreManageBuy() {
    this._send(new PacketWriter().writeC(0x90).build());
  }

  // SetPrivateStoreListBuy (0x91): D count, per item (16 bytes)
  // D itemId, H enchant, H 0, D count, D price.
  setPrivateStoreListBuy(items) {
    const w = new PacketWriter().writeC(0x91).writeD(items.length);
    for (const it of items) {
      w.writeD(it.itemId | 0).writeH(it.enchant || 0).writeH(0).writeD(it.count | 0).writeD(it.price | 0);
    }
    this._send(w.build());
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
      case 0x64: { // SystemMessage: shallow typed decode
        this.emit('systemMessage', parseSystemMessage(r));
        break;
      }
      // --------------------------------------------------------- M4: skills & items
      case 0x58: { // SkillList: D count, per skill D passive, D level, D id, C disabled
        const count = r.readD();
        const skills = [];
        for (let i = 0; i < count; i++) {
          const passive = r.readD();
          const level = r.readD();
          const id = r.readD();
          const disabled = r.readC();
          skills.push({ id, level, passive: passive === 1, disabled: disabled === 1 });
        }
        this.emit('skillList', skills);
        break;
      }
      case 0x48: { // MagicSkillUse (cast start)
        const casterId = r.readD();
        const targetId = r.readD();
        const skillId = r.readD();
        const level = r.readD();
        const hitTime = r.readD();
        r.readD(); // reuse delay
        r.readD(); r.readD(); r.readD(); // caster x,y,z
        const success = r.readD();
        if (success === 1) r.readH();
        r.readD(); r.readD(); r.readD(); // target x,y,z
        this.emit('skillUse', { casterId, targetId, skillId, level, hitTime });
        break;
      }
      case 0x76: { // MagicSkillLaunched
        const casterId = r.readD();
        const skillId = r.readD();
        const level = r.readD();
        const count = r.readD();
        const targetIds = [];
        if (count === 0) r.readD(); // trailing 0 when no targets
        for (let i = 0; i < count; i++) targetIds.push(r.readD());
        this.emit('skillLaunch', { casterId, skillId, level, targetIds });
        break;
      }
      case 0x1b: { // ItemList: H showWindow, H count, per item see parseItem*
        r.readH(); // showWindow
        const count = r.readH();
        const items = [];
        for (let i = 0; i < count; i++) items.push(parseItemEntry(r, false));
        this.emit('itemList', items);
        break;
      }
      case 0x27: { // InventoryUpdate (player): H count, per item H change + entry
        const count = r.readH();
        const updated = [];
        for (let i = 0; i < count; i++) {
          const change = r.readH(); // ItemState ordinal: 0 unchanged, 1 added, 2 modified, 3 removed
          updated.push({ change, ...parseItemEntry(r, true) });
        }
        this.emit('invUpdate', updated);
        break;
      }
      case 0x0f: { // NpcHtmlMessage: D objectId, S html, D itemId (villager
        // dialogs, .menu, teleporters, shops)
        const objectId = r.readD();
        const html = r.readS();
        const itemId = r.remaining() >= 4 ? r.readD() : 0;
        this.emit('html', { objectId, html, itemId });
        break;
      }
      case 0x25: // ActionFailed (no payload)
        this.emit('actionFailed');
        break;
      case 0x2d: { // SocialAction: D objectId, D actionId
        const id = r.readD();
        const actionId = r.readD();
        this.emit('socialAction', { id, actionId });
        break;
      }
      case 0x2e: { // ChangeMoveType: D objectId, D running, D swimming
        const id = r.readD();
        const running = r.readD();
        r.readD(); // swimming
        this.emit('changeMove', { id, running });
        break;
      }
      case 0x2f: { // ChangeWaitType: D objectId, D waitType (0 sit, 1 stand,
        // 2 start fake death, 3 stop fake death), D x,y,z
        const id = r.readD();
        const waitType = r.readD();
        const x = r.readD(); const y = r.readD(); const z = r.readD();
        this.emit('changeWait', { id, waitType, x, y, z });
        break;
      }
      case 0x80: { // QuestList: H count, per quest D questId, D flags.
        // flags (QuestState.calculateFlags): while active =
        // ((1 << cond) - 1) | 0x80000000 — bit31 = started, low bits = cond.
        const count = r.readH();
        const quests = [];
        for (let i = 0; i < count; i++) quests.push({ id: r.readD(), flags: r.readD() });
        this.emit('questList', quests);
        break;
      }
      case 0x0b: { // SpawnItem (ground drop)        const id = r.readD();
        const itemId = r.readD();
        const x = r.readD(); const y = r.readD(); const z = r.readD();
        r.readD(); // stackable flag
        const count = r.readD();
        r.readD(); // 0
        this.emit('drop', { id, itemId, count, x, y, z });
        break;
      }
      case 0x0c: { // DropItem (player-dropped, has dropper id)
        r.readD(); // dropper object id
        const id = r.readD();
        const itemId = r.readD();
        const x = r.readD(); const y = r.readD(); const z = r.readD();
        r.readD(); // stackable flag
        const count = r.readD();
        r.readD(); // 1
        this.emit('drop', { id, itemId, count, x, y, z });
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
  // aCis 409 NpcInfo has NO level field; when Config.ShowNpcLevel is on the
  // server prepends "Lv N" to the title (AbstractNpcInfo.java:106).
  let level = null;
  const lvlMatch = /^Lv (\d+)/.exec(title);
  if (lvlMatch) level = Number(lvlMatch[1]);
  return { id: objectId, npcId, isAttackable, name, title, level, x, y, z, heading };
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
  const str = r.readD();
  const dex = r.readD();
  const con = r.readD();
  const int = r.readD();
  const wit = r.readD();
  const men = r.readD();
  const maxHp = r.readD();
  const hp = r.readD();
  const maxMp = r.readD();
  const mp = r.readD();
  const sp = r.readD();
  const currentWeight = r.readD();
  const maxLoad = r.readD(); // weight limit
  r.readD(); // weapon timer
  for (let j = 0; j < 17; j++) r.readD(); // paperdoll object ids
  for (let j = 0; j < 17; j++) r.readD(); // paperdoll item ids
  for (let j = 0; j < 14; j++) r.readH();
  r.readD(); // rhand augmentation
  for (let j = 0; j < 12; j++) r.readH();
  r.readD(); // lhand augmentation
  for (let j = 0; j < 4; j++) r.readH();
  const pAtk = r.readD();
  const pAtkSpd = r.readD();
  const pDef = r.readD();
  const evasion = r.readD();
  const accuracy = r.readD();
  const critical = r.readD();
  const mAtk = r.readD();
  const mAtkSpd = r.readD();
  r.readD(); // pAtkSpd (again)
  const mDef = r.readD();
  r.readD(); r.readD(); // pvp flag, karma
  const runSpeed = r.readD();
  const walkSpeed = r.readD();
  r.readD(); r.readD(); // swim speed x2
  r.readD(); r.readD(); // 0, 0
  r.readD(); r.readD(); // fly run/walk speed
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
  return {
    id: objectId, name, race, sex, classId, level, exp, sp, hp, maxHp, mp, maxMp, cp, maxCp, x, y, z, heading,
    str, dex, con, int, wit, men, currentWeight, maxLoad,
    pAtk, pAtkSpd, pDef, evasion, accuracy, critical, mAtk, mAtkSpd, mDef,
    runSpeed, walkSpeed,
  };
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

// Shared item entry layout (ItemList / InventoryUpdate):
// H type1, D objectId, D itemId, D count, H type2, H customType1, H equipped,
// D bodyPart(=slot), H enchant, H customType2, D augmentation, D manaLeft.
function parseItemEntry(r) {
  r.readH(); // type1
  const objectId = r.readD();
  const itemId = r.readD();
  const count = r.readD();
  r.readH(); // type2
  r.readH(); // custom type 1
  const equipped = r.readH();
  const slot = r.readD(); // body part
  const enchant = r.readH();
  r.readH(); // custom type 2
  r.readD(); // augmentation id
  r.readD(); // mana left
  return { objectId, itemId, count, slot, equipped, enchant };
}

module.exports = { GameSession };
