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
//   C->S MoveBackwardToLocation(0x01), Say2(0x38), ValidatePosition(0x48),
//        TradeRequest(0x15), AddTradeItem(0x16), TradeDone(0x17),
//        AnswerTradeRequest(0x44)
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

  // RequestBuyItem (0x1f): D listId, D count, per item D itemId, D count.
  requestBuyItem(listId, items) {
    const w = new PacketWriter().writeC(0x1f).writeD(listId | 0).writeD(items.length);
    for (const it of items) w.writeD(it.itemId | 0).writeD(it.count | 0);
    this._send(w.build());
  }

  // RequestSellItem (0x1e): D listId, D count, per item D objectId,
  // D itemId, D count.
  requestSellItem(listId, items) {
    const w = new PacketWriter().writeC(0x1e).writeD(listId | 0).writeD(items.length);
    for (const it of items) w.writeD(it.objectId | 0).writeD(it.itemId | 0).writeD(it.count | 0);
    this._send(w.build());
  }

  // RequestJoinParty (0x29): S targetName, D lootRule
  // (0 ITEM_LOOTER, 1 ITEM_RANDOM, 2 ITEM_RANDOM_SPOIL, 3 ITEM_ORDER,
  // 4 ITEM_ORDER_SPOIL — enums/LootRule.java).
  requestJoinParty(name, lootRule = 0) {
    this._send(new PacketWriter().writeC(0x29).writeS(String(name)).writeD(lootRule).build());
  }

  // RequestAnswerJoinParty (0x2a): D response (1 accept, 0 refuse).
  answerJoinParty(response) {
    this._send(new PacketWriter().writeC(0x2a).writeD(response ? 1 : 0).build());
  }

  // RequestWithdrawParty (0x2b): empty.
  withdrawParty() {
    this._send(new PacketWriter().writeC(0x2b).build());
  }

  // RequestOustPartyMember (0x2c): S targetName.
  oustPartyMember(name) {
    this._send(new PacketWriter().writeC(0x2c).writeS(String(name)).build());
  }

  // RequestJoinPledge (0x24): D targetId, D pledgeType. OBJECTID-based in
  // this rev (clientpackets/RequestJoinPledge.java) — the bridge resolves
  // player names to objectIds for the contract op. pledgeType 0 = main clan.
  requestJoinPledge(targetId, pledgeType = 0) {
    this._send(new PacketWriter().writeC(0x24).writeD(targetId | 0).writeD(pledgeType | 0).build());
  }

  // RequestAnswerJoinPledge (0x25): D response (1 accept, 0 refuse).
  answerJoinPledge(response) {
    this._send(new PacketWriter().writeC(0x25).writeD(response ? 1 : 0).build());
  }

  // RequestWithdrawPledge (0x26): empty. The clan LEADER cannot withdraw
  // (SystemMessageId.CLAN_LEADER_CANNOT_WITHDRAW); dissolve is not bridged.
  withdrawPledge() {
    this._send(new PacketWriter().writeC(0x26).build());
  }

  // RequestOustPledgeMember (0x27): S targetName. Requires SP_DISMISS
  // privilege (the leader has it).
  oustPledgeMember(name) {
    this._send(new PacketWriter().writeC(0x27).writeS(String(name)).build());
  }

  // RequestPledgeCrest (0x68): D crestId.
  requestPledgeCrest(crestId) {
    this._send(new PacketWriter().writeC(0x68).writeD(crestId | 0).build());
  }

  // TradeRequest (0x15): D targetObjectId (objectId-based in this rev —
  // the bridge resolves player names to objectIds for the contract op).
  tradeRequest(objectId) {
    this._send(new PacketWriter().writeC(0x15).writeD(objectId | 0).build());
  }

  // AnswerTradeRequest (0x44): D response (1 accept, 0 refuse).
  answerTradeRequest(response) {
    this._send(new PacketWriter().writeC(0x44).writeD(response ? 1 : 0).build());
  }

  // AddTradeItem (0x16): D tradeId (read but UNUSED in this rev — send 0),
  // D objectId, D count.
  addTradeItem(objectId, count) {
    this._send(
      new PacketWriter()
        .writeC(0x16)
        .writeD(0) // tradeId, unused by aCis
        .writeD(objectId | 0)
        .writeD(count | 0)
        .build()
    );
  }

  // TradeDone (0x17): D response. 1 = confirm (two-phase: BOTH sides must
  // confirm; the exchange happens on the second confirm — TradeList.confirm).
  // Anything else = cancel the whole trade for both parties.
  tradeDone(response) {
    this._send(new PacketWriter().writeC(0x17).writeD(response ? 1 : 0).build());
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

  // SetPrivateStoreMsgSell (0x77): S title (max 29 chars server-side).
  // The title rides the TradeList and survives clear(), so setting it BEFORE
  // SetPrivateStoreListSell makes the store-open broadcast carry it.
  setPrivateStoreMsgSell(title) {
    this._send(new PacketWriter().writeC(0x77).writeS(String(title).slice(0, 29)).build());
  }

  // SetPrivateStoreMsgBuy (0x94): S title (max 29 chars server-side).
  setPrivateStoreMsgBuy(title) {
    this._send(new PacketWriter().writeC(0x94).writeS(String(title).slice(0, 29)).build());
  }

  // RequestPrivateStoreQuitSell (0x76): empty. Closes ANY store type
  // (server just sets OperateType.NONE + broadcastUserInfo).
  requestPrivateStoreQuitSell() {
    this._send(new PacketWriter().writeC(0x76).build());
  }

  // RequestPrivateStoreQuitBuy (0x93): empty — same effect as 0x76.
  requestPrivateStoreQuitBuy() {
    this._send(new PacketWriter().writeC(0x93).build());
  }

  // RequestPrivateStoreBuy (0x79) — buy FROM someone's sell-store:
  // D storePlayerId, D count, per item (12 bytes) D objectId, D count,
  // D price. The price MUST match the store price (TradeList.privateStoreBuy
  // validates objectId+price against the store TradeList).
  requestPrivateStoreBuy(storeId, items) {
    const w = new PacketWriter().writeC(0x79).writeD(storeId | 0).writeD(items.length);
    for (const it of items) w.writeD(it.objectId | 0).writeD(it.count | 0).writeD(it.price | 0);
    this._send(w.build());
  }

  // RequestPrivateStoreSell (0x96) — sell INTO someone's buy-store:
  // D storePlayerId, D count, per item (20 bytes) D objectId, D itemId,
  // H enchant, H 0, D count, D price. itemId/enchant must match the actual
  // inventory item, price must match the store price.
  requestPrivateStoreSell(storeId, items) {
    const w = new PacketWriter().writeC(0x96).writeD(storeId | 0).writeD(items.length);
    for (const it of items) {
      w.writeD(it.objectId | 0).writeD(it.itemId | 0).writeH(it.enchant || 0).writeH(0).writeD(it.count | 0).writeD(it.price | 0);
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

  // Appearing (0x30): empty. The retail client sends this after a self
  // TeleportToLocation; aCis clears _isTeleporting in onTeleported()
  // (clientpackets/Appearing.java) — WITHOUT it the player stays
  // teleport-locked and denyAiAction() rejects every interact/attack with a
  // bare ActionFailed (verified live after admin_teleport).
  appearing() {
    this._send(new PacketWriter().writeC(0x30).build());
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
        const reuse = r.readD(); // reuse delay, milliseconds
        r.readD(); r.readD(); r.readD(); // caster x,y,z
        const success = r.readD();
        if (success === 1) r.readH();
        r.readD(); r.readD(); r.readD(); // target x,y,z
        this.emit('skillUse', { casterId, targetId, skillId, level, hitTime, reuse });
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
      case 0x11: { // BuyList (merchant shop): D money, D listId, H count,
        // per item: H type1, D itemId, D itemId(dup), D count, H type2,
        // H 0, D bodyPart, H 0, H 0, H 0, D price(taxed)
        const money = r.readD();
        const listId = r.readD();
        const count = r.readH();
        const items = [];
        for (let i = 0; i < count; i++) {
          r.readH(); // type1
          const itemId = r.readD();
          r.readD(); // itemId dup
          const cnt = r.readD();
          r.readH(); r.readH(); // type2, 0
          r.readD(); // bodyPart
          r.readH(); r.readH(); r.readH(); // 0,0,0
          const price = r.readD();
          items.push({ itemId, count: cnt, price });
        }
        this.emit('buyList', { money, listId, items });
        break;
      }
      case 0x10: { // SellList (player sellables): D money, D 0, H count,
        // per item: H type1, D objectId, D itemId, D count, H type2,
        // H custom1, D bodyPart, H enchant, H custom2, H 0, D price(ref/2)
        const money = r.readD();
        r.readD(); // 0
        const count = r.readH();
        const items = [];
        for (let i = 0; i < count; i++) {
          r.readH(); // type1
          const objectId = r.readD();
          const itemId = r.readD();
          const cnt = r.readD();
          r.readH(); r.readH(); // type2, custom1
          r.readD(); // bodyPart
          const enchant = r.readH();
          r.readH(); r.readH(); // custom2, 0
          const price = r.readD();
          items.push({ objectId, itemId, count: cnt, price, enchant });
        }
        this.emit('sellList', { money, items });
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
      // ------------------------------------------------------ M9: party
      case 0x39: { // AskJoinParty (invite prompt): S requestorName, D lootRule
        const from = r.readS();
        const lootRule = r.readD();
        this.emit('partyAsk', { from, lootRule });
        break;
      }
      case 0x3a: { // JoinParty (result to requestor): D response
        this.emit('partyJoinResult', r.readD());
        break;
      }
      case 0x4e: { // PartySmallWindowAll: D leaderId, D lootRule, D count
        // (EXCLUDES the receiver), per member: D objectId, S name, D cp,
        // D maxCp, D hp, D maxHp, D mp, D maxMp, D level, D classId, D 0, D race
        const leaderId = r.readD();
        const lootRule = r.readD();
        const count = r.readD();
        const members = [];
        for (let i = 0; i < count; i++) members.push(parsePartyMember(r, true));
        this.emit('partyAll', { leaderId, lootRule, members });
        break;
      }
      case 0x4f: { // PartySmallWindowAdd: D leaderId, D lootRule, member
        // (same minus race: ends with D 0, D 0)
        const leaderId = r.readD();
        const lootRule = r.readD();
        const member = parsePartyMember(r, false);
        this.emit('partyAdd', { leaderId, lootRule, member });
        break;
      }
      case 0x50: // PartySmallWindowDeleteAll: empty
        this.emit('partyDeleteAll');
        break;
      case 0x51: { // PartySmallWindowDelete: D objectId, S name
        const id = r.readD();
        const name = r.readS();
        this.emit('partyDelete', { id, name });
        break;
      }
      case 0x52: { // PartySmallWindowUpdate (member status): D objectId,
        // S name, D cp, D maxCp, D hp, D maxHp, D mp, D maxMp, D level, D classId
        const id = r.readD();
        const name = r.readS();
        const cp = r.readD(); const maxCp = r.readD();
        const hp = r.readD(); const maxHp = r.readD();
        const mp = r.readD(); const maxMp = r.readD();
        const level = r.readD(); const classId = r.readD();
        this.emit('partyUpdate', { id, name, cp, maxCp, hp, maxHp, mp, maxMp, level, classId });
        break;
      }
      // ------------------------------------------------------ M14: clan
      case 0x32: { // AskJoinPledge (invite prompt): D requestorObjId, S pledgeName
        const fromId = r.readD();
        const clanName = r.readS();
        this.emit('clanAsk', { fromId, clanName });
        break;
      }
      case 0x33: { // JoinPledge (to the new member on accept): D clanId
        this.emit('clanJoined', r.readD());
        break;
      }
      case 0x53: { // PledgeShowMemberListAll: D subFlag, D clanId,
        // D pledgeType, S pledgeName, S leaderName, D crestId, D level,
        // D castleId, D clanHallId, D rank, D reputation, D dissolution,
        // D 0, D allyId, S allyName, D allyCrestId, D atWar, D count,
        // per member: S name, D level, D classId, D sex, D race,
        // D onlineObjId (0 = offline), D hasSponsor
        r.readD(); // subFlag (0 = main clan view)
        const clanId = r.readD();
        const pledgeType = r.readD();
        const name = r.readS();
        const leaderName = r.readS();
        const crestId = r.readD();
        const level = r.readD();
        r.readD(); r.readD(); r.readD(); r.readD(); r.readD(); r.readD(); // castle, hall, rank, rep, dissolution, 0
        const allyId = r.readD();
        const allyName = r.readS();
        r.readD(); // allyCrestId
        r.readD(); // atWar
        const count = r.readD();
        const members = [];
        for (let i = 0; i < count; i++) {
          members.push(parsePledgeMember(r));
          r.readD(); // hasSponsor
        }
        this.emit('clanAll', { clanId, pledgeType, name, leaderName, crestId, level, allyId, allyName, members });
        break;
      }
      case 0x54: { // PledgeShowMemberListUpdate (member login/status
        // refresh): S name, D level, D classId, D sex, D race,
        // D onlineObjId, D pledgeType, D hasSponsor
        const member = parsePledgeMember(r);
        r.readD(); // pledgeType
        r.readD(); // hasSponsor
        this.emit('clanMemberUpdate', member);
        break;
      }
      case 0x55: { // PledgeShowMemberListAdd (a member joined): S name,
        // D level, D classId, D sex, D race, D onlineObjId, D pledgeType
        const member = parsePledgeMember(r);
        r.readD(); // pledgeType
        this.emit('clanMemberAdd', member);
        break;
      }
      case 0x56: { // PledgeShowMemberListDelete: S name
        this.emit('clanMemberDelete', r.readS());
        break;
      }
      case 0x82: // PledgeShowMemberListDeleteAll: empty — you left / were
        // ousted / the clan was dissolved (STATIC_PACKET).
        this.emit('clanDeleteAll');
        break;
      case 0x83: { // PledgeInfo (answer to RequestPledgeInfo): D clanId,
        // S name, S allyName
        const id = r.readD();
        const name = r.readS();
        const allyName = r.readS();
        this.emit('clanPledgeInfo', { id, name, allyName });
        break;
      }
      case 0x88: { // PledgeShowInfoUpdate (broadcast on join/level/crest
        // changes): D clanId, D crestId, D level, D castleId, D clanHallId,
        // D rank, D reputation, D dissolution, D 0, D allyId, S allyName,
        // D allyCrestId, D atWar. NO clan name / leader name.
        const clanId = r.readD();
        const crestId = r.readD();
        const level = r.readD();
        r.readD(); r.readD(); r.readD(); r.readD(); r.readD(); r.readD(); // castle, hall, rank, rep, dissolution, 0
        const allyId = r.readD();
        const allyName = r.readS();
        r.readD(); // allyCrestId
        r.readD(); // atWar
        this.emit('clanInfoUpdate', { clanId, crestId, level, allyId, allyName });
        break;
      }
      case 0x6c: { // PledgeCrest: D crestId, D length, B data (raw DDS —
        // CrestCache stores .dds files; 0 length when no crest)
        const crestId = r.readD();
        const length = r.readD();
        const data = length > 0 ? Buffer.from(r.readB(length)) : null;
        this.emit('clanCrest', { id: crestId, data });
        break;
      }
      case 0xcd: { // PledgeStatusChanged (rides RequestPledgeInfo answers):
        // D leaderId, D clanId, D crestId, D allyId, D allyCrestId, D 0, D 0
        const leaderId = r.readD();
        const clanId = r.readD();
        const crestId = r.readD();
        const allyId = r.readD();
        r.readD(); r.readD(); r.readD(); // allyCrestId, 0, 0
        this.emit('clanStatusChanged', { leaderId, clanId, crestId, allyId });
        break;
      }
      // ------------------------------------------------------ M12: trade
      case 0x5e: { // SendTradeRequest (ask prompt): D senderObjectId
        this.emit('tradeAsk', { fromId: r.readD() });
        break;
      }
      case 0x1e: { // TradeStart (session opens): D partnerObjectId, H count,
        // per item the shared trade entry (own tradable inventory snapshot)
        const partnerId = r.readD();
        const count = r.readH();
        const items = [];
        for (let i = 0; i < count; i++) items.push(parseTradeItem(r));
        this.emit('tradeStart', { partnerId, items });
        break;
      }
      case 0x20: { // TradeOwnAdd (own offer changed): H count(1), entries
        const count = r.readH();
        const items = [];
        for (let i = 0; i < count; i++) items.push(parseTradeItem(r));
        this.emit('tradeOwnAdd', items);
        break;
      }
      case 0x21: { // TradeOtherAdd (partner offer changed): same layout
        const count = r.readH();
        const items = [];
        for (let i = 0; i < count; i++) items.push(parseTradeItem(r));
        this.emit('tradeOtherAdd', items);
        break;
      }
      case 0x22: { // SendTradeDone (session closes): D value
        // 1 = exchange done, 0 = cancelled/failed
        this.emit('tradeEnd', { success: r.readD() === 1 });
        break;
      }
      case 0x75: // TradePressOwnOk: empty — you pressed confirm (phase 1)
        this.emit('tradePressOwnOk');
        break;
      case 0x7c: // TradePressOtherOk: empty — partner pressed confirm
        this.emit('tradePressOtherOk');
        break;
      // ------------------------------------------- M13: private stores
      case 0x9a: { // PrivateStoreManageListSell (own manage view):
        // D objectId, D packageSale, D adena, D sellableCount, per item
        // D type2, D objectId, D itemId, D count, H 0, H enchant, H 0,
        // D bodyPart, D price; then D storeCount + same + D referencePrice
        const objectId = r.readD();
        const packageSale = r.readD() === 1;
        const adena = r.readD();
        const sellableCount = r.readD();
        const sellables = [];
        for (let i = 0; i < sellableCount; i++) sellables.push(parseStoreSellEntry(r));
        const storeCount = r.readD();
        const items = [];
        for (let i = 0; i < storeCount; i++) {
          const it = parseStoreSellEntry(r);
          it.storePrice = r.readD(); // reference price
          items.push(it);
        }
        this.emit('storeManageSell', { objectId, packageSale, adena, sellables, items });
        break;
      }
      case 0x9b: { // PrivateStoreListSell (observer view of a sell-store):
        // D storePlayerId, D packageSale, D viewerAdena, D count, per item
        // same as manage entry + D price, D referencePrice
        const storeId = r.readD();
        const packageSale = r.readD() === 1;
        const adena = r.readD();
        const count = r.readD();
        const items = [];
        for (let i = 0; i < count; i++) {
          const it = parseStoreSellEntry(r);
          it.storePrice = r.readD(); // reference price
          items.push(it);
        }
        this.emit('storeListSell', { storeId, packageSale, adena, items });
        break;
      }
      case 0x9c: { // PrivateStoreMsgSell (store title): D objectId, S title
        const id = r.readD();
        const title = r.readS();
        this.emit('storeTitle', { id, type: 'sell', title });
        break;
      }
      case 0xb7: { // PrivateStoreManageListBuy (own manage view):
        // D objectId, D adena, D buyableCount, per item D itemId, H enchant,
        // D count, D referencePrice, H 0, D bodyPart, H type2; then D
        // storeCount, per item D itemId, H enchant, D quantity, D refPrice,
        // H 0, D bodyPart, H type2, D price, D refPrice
        const objectId = r.readD();
        const adena = r.readD();
        const buyableCount = r.readD();
        const buyables = [];
        for (let i = 0; i < buyableCount; i++) buyables.push(parseStoreBuyRefEntry(r));
        const storeCount = r.readD();
        const items = [];
        for (let i = 0; i < storeCount; i++) {
          const it = parseStoreBuyRefEntry(r);
          it.price = r.readD();
          it.storePrice = r.readD(); // reference price
          items.push(it);
        }
        this.emit('storeManageBuy', { objectId, adena, buyables, items });
        break;
      }
      case 0xb8: { // PrivateStoreListBuy (observer view of a buy-store):
        // D storePlayerId, D viewerAdena, D count, per item D objectId,
        // D itemId, H enchant, D count, D refPrice, H 0, D bodyPart,
        // H type2, D price, D quantity. objectIds are the VIEWER's own
        // items (getAvailableItems intersects with the viewer inventory).
        const storeId = r.readD();
        const adena = r.readD();
        const count = r.readD();
        const items = [];
        for (let i = 0; i < count; i++) {
          const objectId = r.readD();
          const itemId = r.readD();
          const enchant = r.readH();
          const cnt = r.readD();
          const storePrice = r.readD(); // reference price
          r.readH(); // 0
          const slot = r.readD(); // bodyPart
          r.readH(); // type2
          const price = r.readD();
          const quantity = r.readD();
          items.push({ objectId, itemId, enchant, count: cnt, price, quantity, storePrice, slot });
        }
        this.emit('storeListBuy', { storeId, adena, items });
        break;
      }
      case 0xb9: { // PrivateStoreMsgBuy (store title): D objectId, S title
        const id = r.readD();
        const title = r.readS();
        this.emit('storeTitle', { id, type: 'buy', title });
        break;
      }
      // -------------------------------------------- M10: buffs & cooldowns
      case 0x7f: { // AbnormalStatusUpdate: H count, per effect
        // D skillId, H level, D duration (seconds; -1 = toggle/infinite).
        // Built fresh with ALL current effects on every add/remove — i.e. a
        // FULL SNAPSHOT each time (EffectList.updateEffectIcons).
        const count = r.readH();
        const effects = [];
        for (let i = 0; i < count; i++) {
          const skillId = r.readD();
          const level = r.readH();
          const duration = r.readD();
          effects.push({ skillId, level, duration });
        }
        this.emit('abnormal', effects);
        break;
      }
      case 0xc1: { // SkillCoolTime: D count, per skill D skillId, D level,
        // D reuse/1000 (seconds), D remaining/1000 (seconds)
        const count = r.readD();
        const skills = [];
        for (let i = 0; i < count; i++) {
          const id = r.readD();
          const level = r.readD();
          const reuse = r.readD();
          const remaining = r.readD();
          skills.push({ id, level, reuse, remaining });
        }
        this.emit('coolTime', skills);
        break;
      }
      case 0x0b: { // SpawnItem (ground drop)
        const id = r.readD();
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
  r.readC(); // mountType
  const operateType = r.readC(); // OperateType id (0 NONE, 1 SELL, 2 SELL_MANAGE, 3 BUY, 4 BUY_MANAGE, 8 PACKAGE_SELL)
  r.readC(); // crystallize
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
    runSpeed, walkSpeed, operateType,
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

// Shared trade item entry (TradeStart / TradeOwnAdd / TradeOtherAdd —
// serverpackets/TradeStart.java writeImpl): H type1, D objectId, D itemId,
// D count, H type2, H customType1, D bodyPart, H enchant, H customType2, H 0.
// (TradeItemUpdate/TradeUpdate 0x74 add a leading H available-flag and are
// not bridged — the trade window's own-inventory refresh.)
function parseTradeItem(r) {
  r.readH(); // type1
  const objectId = r.readD();
  const itemId = r.readD();
  const count = r.readD();
  r.readH(); // type2
  r.readH(); // custom type 1
  const slot = r.readD(); // body part
  const enchant = r.readH();
  r.readH(); // custom type 2
  r.readH(); // 0
  return { objectId, itemId, count, slot, enchant };
}

// Shared private-store sell entry (PrivateStoreManageListSell /
// PrivateStoreListSell): D type2, D objectId, D itemId, D count, H 0,
// H enchant, H 0, D bodyPart, D price. In the store-list variants a
// trailing D referencePrice follows (read by the caller).
function parseStoreSellEntry(r) {
  r.readD(); // type2
  const objectId = r.readD();
  const itemId = r.readD();
  const count = r.readD();
  r.readH(); // 0
  const enchant = r.readH();
  r.readH(); // 0
  const slot = r.readD(); // bodyPart
  const price = r.readD();
  return { objectId, itemId, count, enchant, price, slot };
}

// Shared private-store buy reference entry (PrivateStoreManageListBuy lists):
// D itemId, H enchant, D count, D referencePrice, H 0, D bodyPart, H type2.
// In the store-list variant a trailing D price + D referencePrice follows
// (read by the caller).
function parseStoreBuyRefEntry(r) {
  const itemId = r.readD();
  const enchant = r.readH();
  const count = r.readD();
  const storePrice = r.readD(); // reference price
  r.readH(); // 0
  const slot = r.readD(); // bodyPart
  r.readH(); // type2
  return { itemId, enchant, count, storePrice, slot };
}

// Party member entry shared by PartySmallWindowAll (withRace) and
// PartySmallWindowAdd (no race, two trailing zeros).
function parsePartyMember(r, withRace) {
  const id = r.readD();
  const name = r.readS();
  const cp = r.readD(); const maxCp = r.readD();
  const hp = r.readD(); const maxHp = r.readD();
  const mp = r.readD(); const maxMp = r.readD();
  const level = r.readD(); const classId = r.readD();
  r.readD(); // 0
  const race = withRace ? r.readD() : (r.readD(), null); // race or trailing 0
  return { id, name, cp, maxCp, hp, maxHp, mp, maxMp, level, classId, race };
}

// Pledge member entry shared by PledgeShowMemberListAll/Update/Add:
// S name, D level, D classId, D sex, D race, D onlineObjId (0 = offline —
// these packets never carry an offline member's objectId). Trailing
// pledgeType/hasSponsor dwords are read by the callers (they vary).
function parsePledgeMember(r) {
  const name = r.readS();
  const level = r.readD();
  const classId = r.readD();
  const sex = r.readD();
  const race = r.readD();
  const onlineId = r.readD();
  return { name, level, classId, sex, race, onlineId, online: onlineId !== 0 };
}

module.exports = { GameSession };
