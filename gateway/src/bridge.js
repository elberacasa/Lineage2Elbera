// Bridges one browser WebSocket client to one L2 game session.
// Implements the FROZEN bridge contract (see gateway/README.md).
'use strict';

const crypto = require('crypto');
const { login } = require('./loginclient.js');
const { GameSession } = require('./gameclient.js');
const { npcName, npcLevel } = require('./npcnames.js');
const { questName } = require('./questnames.js');

// actionname-e.dat UI id -> aCis RequestSocialAction id. aCis carries no
// social NAMES (verified: RequestSocialAction relays the number only); the
// convention is retail socialname-e.dat: 2 Greeting, 3 Victory, 4 Advance,
// 5 No, 6 Yes, 7 Bow, 8 Unaware, 9 Waiting, 10 Laugh, 11 Applaud,
// 12 Dance, 13 Sorrow. Everything NOT a key here goes verbatim to
// RequestActionUse(0x45) — including non-social actionname ids 2..13
// (Attack 2, Exchange 3, Next Target 4, Pick Up 5, Assist 6, Invite 7,
// Leave Party 8, Dismiss 9, Party Matching 11), which aCis handles with
// their own packets (its RequestActionUse switch just warns on them).
const SOCIAL_UI_TO_ACIS = {
  12: 2, 13: 3, 14: 4, 25: 5, 24: 6, 26: 7,
  29: 8, 30: 9, 31: 10, 33: 11, 34: 12, 35: 13,
};
const SOCIAL_NAMES = {
  2: 'Greeting', 3: 'Victory', 4: 'Advance', 5: 'No', 6: 'Yes', 7: 'Bow',
  8: 'Unaware', 9: 'Waiting', 10: 'Laugh', 11: 'Applaud', 12: 'Dance', 13: 'Sorrow',
};

function deriveCredentials(deviceId) {
  const id = String(deviceId || 'anonymous');
  const h1 = crypto.createHash('sha256').update('l2vzla-account:' + id).digest('hex');
  const h2 = crypto.createHash('sha256').update('l2vzla-pass:' + id).digest('hex');
  return {
    account: 'w' + h1.slice(0, 12), // 13 chars, [a-z0-9]
    password: h2.slice(0, 16),
    charName: 'W' + h1.slice(12, 23), // 12 chars, alphanumeric, unique per device
  };
}

class Bridge {
  constructor(ws, config, log) {
    this.ws = ws;
    this.config = config;
    this.log = log;
    this.game = null;
    this.selfId = 0;
    this.chars = [];
    this.pendingCreate = null;
    this.closed = false;
    // M3 combat state: merged attribute view per object id, and self stats.
    this.statusById = new Map(); // id -> {hp, maxHp, mp, maxMp}
    this.self = null; // {hp, maxHp, mp, maxMp, cp, maxCp, level, exp, sp}
    this.entered = false; // enterWorld must fire exactly once
    // M4: current target (for useSkill) and login-time list ordering. The
    // server sends SkillList/ItemList BEFORE UserInfo during EnterWorld, but
    // the contract wants them right AFTER enterWorld: queue and flush.
    this.currentTarget = 0;
    this.pendingSkillList = null;
    this.pendingItemList = null;
    this.pendingQuestList = null;
    // M9 party state: full snapshot rebuilt on every composition packet;
    // status updates flow as their own op (see README §M9 for the choice).
    this.party = { leaderId: 0, lootRule: 0, members: new Map() }; // id -> member
    this.selfInfo = null; // {id, name, classId, level, race} from UserInfo
    // M11 shop state: last merchant list id + inventory (objectId -> itemId)
    // to resolve RequestSellItem entries.
    this.lastBuyListId = 0;
    this.inventory = new Map();
    // M12 trade state: visible players id -> name (CharInfo). aCis
    // TradeRequest is objectId-based; the contract op is name-based, and
    // tradeAsk/tradeStart resolve ids back to names through this map.
    this.playersByName = new Map();

    ws.on('message', (data) => this._onMessage(data));
    ws.on('close', () => this._shutdown());
    ws.on('error', () => this._shutdown());
  }

  send(obj) {
    if (!this.closed && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  async _onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (_) {
      return;
    }
    try {
      switch (msg.op) {
        case 'login':
          await this._login(String(msg.deviceId || 'anonymous'));
          break;
        case 'enterChar':
          if (this.game) this.game.selectChar(msg.slot | 0);
          break;
        case 'moveTo':
          if (this.game) {
            this.game.pos = { ...this.game.pos, x: msg.x | 0, y: msg.y | 0, z: msg.z | 0 };
            this.game.moveTo(msg.x | 0, msg.y | 0, msg.z | 0);
          }
          break;
        case 'say':
          if (this.game) this.game.say(msg.channel | 0, String(msg.text || '').slice(0, 100), msg.target ? String(msg.target) : null);
          break;
        case 'target':
          // Action (0x04): plain click — target/interact. Also used to loot:
          // targeting a ground drop walks there and picks it up.
          if (this.game) this.game.action(msg.id | 0);
          break;
        case 'attack':
          // AttackRequest (0x0a): ctrl+click — force attack.
          if (this.game) this.game.attackRequest(msg.id | 0);
          break;
        case 'useSkill':
          // RequestMagicSkillUse. Optional targetId presets the target first.
          if (this.game) {
            const skillId = msg.skillId | 0;
            const targetId = msg.targetId | 0;
            if (targetId && targetId !== this.currentTarget) {
              this.game.action(targetId);
              setTimeout(() => { if (this.game) this.game.useSkill(skillId); }, 400);
            } else {
              this.game.useSkill(skillId);
            }
          }
          break;
        case 'useItem':
          if (this.game) this.game.useItem(msg.objectId | 0);
          break;
        case 'talk':
          // Talk/interact with an NPC. aCis Creature.onAction: first Action
          // only TARGETS; a second Action on the current target INTERACTS
          // (dialog) for non-attackable NPCs — and ATTACKS for attackable
          // ones (attackable-without-force) or with ctrl. So talk sends
          // Action twice; on attackable NPCs the second Action is a swing
          // (aCis routing, not packet-level — use the attack op for those).
          if (this.game) {
            const id = msg.id | 0;
            this.game.action(id);
            if (id !== this.currentTarget) {
              setTimeout(() => { if (this.game) this.game.action(id); }, 400);
            }
          }
          break;
        case 'bypass':
          // RequestBypassToServer(0x21) with the raw bypass command string.
          if (this.game) this.game.bypass(String(msg.command || '').slice(0, 200));
          break;
        case 'action':
          // Character action. actionId is an actionname-e.dat UI id.
          // Social entries are remapped to aCis social ids and sent via
          // RequestSocialAction(0x1b); everything else goes verbatim to
          // RequestActionUse(0x45). ctrl/shift always false.
          if (this.game) {
            const actionId = msg.actionId | 0;
            const socialId = SOCIAL_UI_TO_ACIS[actionId];
            if (socialId !== undefined) {
              this.log(`action ${actionId} (UI) -> RequestSocialAction(${socialId}) ${SOCIAL_NAMES[socialId]}`);
              this.game.requestSocialAction(socialId);
            } else {
              this.game.requestActionUse(actionId);
            }
          }
          break;
        case 'questAbort':
          // RequestQuestAbort(0x64).
          if (this.game) this.game.requestQuestAbort(msg.id | 0);
          break;
        case 'partyInvite':
          // RequestJoinParty(0x29): S name, D lootRule (0 = ITEM_LOOTER).
          if (this.game) this.game.requestJoinParty(String(msg.name || '').slice(0, 16), 0);
          break;
        case 'partyAnswer':
          // RequestAnswerJoinParty(0x2a): D 1 accept / 0 refuse.
          if (this.game) this.game.answerJoinParty(msg.accept ? 1 : 0);
          break;
        case 'partyLeave':
          // RequestWithdrawParty(0x2b): empty.
          if (this.game) this.game.withdrawParty();
          break;
        case 'partyKick':
          // RequestOustPartyMember(0x2c): S name.
          if (this.game) this.game.oustPartyMember(String(msg.name || '').slice(0, 16));
          break;
        case 'buy':
          // RequestBuyItem(0x1f) with the last BuyList's listId. Requires the
          // merchant as current target (client sends target{id} first).
          if (this.game && Array.isArray(msg.items)) {
            this.game.requestBuyItem(this.lastBuyListId, msg.items.slice(0, 50));
          }
          break;
        case 'sell':
          // RequestSellItem(0x1e, listId 0). itemId resolved from the
          // inventory map (RequestSellItem carries objectId+itemId+count).
          if (this.game && Array.isArray(msg.items)) {
            const items = msg.items.slice(0, 50).map((it) => ({
              objectId: it.objectId | 0,
              itemId: this.inventory.get(it.objectId | 0) || 0,
              count: it.count | 0,
            })).filter((it) => it.itemId > 0);
            this.game.requestSellItem(0, items);
          }
          break;
        case 'destroyItem':
          // inventory TrashButton (aCis RequestDestroyItem)
          if (this.game) this.game.destroyItem(msg.objectId | 0, msg.count | 0 || 1);
          break;
        case 'crystallizeItem':
          // inventory CrystallizeButton (aCis RequestCrystallizeItem)
          if (this.game) this.game.crystallizeItem(msg.objectId | 0, msg.count | 0 || 1);
          break;
        // ---------------------------------------------------- M12: trade
        case 'tradeRequest': {
          // TradeRequest(0x15) is objectId-based in this rev; the contract
          // op is name-based — resolve via the visible-players map (CharInfo).
          // Server-side the requestor must KNOW the target (Player.knows) and
          // the target must not be busy; request expires after 15s.
          const name = String(msg.name || '').slice(0, 16);
          let id = 0;
          for (const [pid, pname] of this.playersByName) if (pname === name) { id = pid; break; }
          if (this.game && id) this.game.tradeRequest(id);
          else this.log(`tradeRequest: no visible player named "${name}"`);
          break;
        }
        case 'tradeAnswer':
          // AnswerTradeRequest(0x44): D 1 accept / 0 refuse.
          if (this.game) this.game.answerTradeRequest(msg.accept ? 1 : 0);
          break;
        case 'tradeAdd':
          // AddTradeItem(0x16): D tradeId(unused, 0), D objectId, D count.
          if (this.game) this.game.addTradeItem(msg.objectId | 0, msg.count | 0);
          break;
        case 'tradeDone':
          // TradeDone(0x17) response 1 = confirm. TWO-PHASE in aCis: the
          // first confirm only marks the side (TradePressOwnOk/OtherOk);
          // the exchange happens when BOTH confirmed (TradeList.confirm).
          if (this.game) this.game.tradeDone(1);
          break;
        case 'tradeCancel':
          // TradeDone(0x17) response 0 = cancel the trade for BOTH parties.
          if (this.game) this.game.tradeDone(0);
          break;
      }
    } catch (e) {
      this.log(`bridge error: ${e.message}`);
    }
  }

  async _login(deviceId) {
    if (this.game) return; // already logged in
    const creds = deriveCredentials(deviceId);
    this.log(`login: device=${deviceId} account=${creds.account}`);

    // Retry the whole login+game-connect flow. The servers' hardcoded
    // IPv4Filter bans fast reconnects for 300s and every attempt refreshes
    // the ban — so keep retries few and let it expire instead of hammering.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this._loginOnce(creds);
        return;
      } catch (e) {
        this.log(`login attempt ${attempt} failed: ${e.message}`);
        if (this.game) {
          this.game.close();
          this.game = null;
        }
        if (attempt < 2) await new Promise((r) => setTimeout(r, 4000));
      }
    }
  }

  async _loginOnce(creds) {
    const { sessionKey, server } = await login(
      this.config.loginHost, this.config.loginPort,
      creds.account, creds.password, this.config.serverId
    );
    this.log(`login ok: server [${server.id}] ${server.host}:${server.port}`);

    const game = new GameSession();
    this.game = game;
    this._wireGame(game, creds);

    // Resolve when the game session reaches the char list, reject on early close.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for CharSelectInfo')), 15000);
      game.once('charList', () => { clearTimeout(timer); resolve(); });
      game.once('close', () => { clearTimeout(timer); reject(new Error(`game socket closed (state=${game.state})`)); });
      game.once('error', (e) => { clearTimeout(timer); reject(e); });
      game.connect(server.host, server.port, creds.account, sessionKey);
    });

    // Login sequence complete: from now on, a game socket loss ends the WS session.
    game.on('close', () => {
      this.log(`game socket closed (state=${game.state})`);
      this._shutdown();
    });
  }

  _wireGame(game, creds) {
    game.on('error', (e) => this.log(`game socket error: ${e.message}`));
    game.on('debug', (m) => this.log(`game: ${m}`));
    game.on('parseError', ({ op, error }) => this.log(`parse error op=0x${op.toString(16)}: ${error.message}`));

    game.on('charList', (chars) => {
      if (chars.length === 0 && !this.pendingCreate) {
        // First login from this device: auto-create a default Human Fighter.
        this.pendingCreate = creds.charName;
        this.log(`no characters, creating ${creds.charName}`);
        game.createCharacter(creds.charName);
        return;
      }
      this.chars = chars;
      this.send({
        op: 'auth_ok',
        chars: chars.map((c) => ({ slot: c.slot, name: c.name, race: c.race, classId: c.classId })),
      });
    });

    game.on('userInfo', (u) => {
      this.selfId = u.id;
      this.selfInfo = { id: u.id, name: u.name, classId: u.classId, level: u.level, race: u.race };
      // Seed/refresh self stats; UserInfo re-sends (level up, stat changes)
      // must NOT re-emit enterWorld — only the first one does.
      this.self = {
        hp: u.hp, maxHp: u.maxHp, mp: u.mp, maxMp: u.maxMp,
        cp: u.cp, maxCp: u.maxCp, level: u.level, exp: u.exp, sp: u.sp,
      };
      if (!this.entered) {
        this.entered = true;
        this.send({
          op: 'enterWorld',
          char: { id: u.id, name: u.name, race: u.race, classId: u.classId, x: u.x, y: u.y, z: u.z, heading: u.heading },
        });
        // Flush login-time lists right after enterWorld (contract order).
        if (this.pendingSkillList) {
          this.send({ op: 'skillList', skills: this.pendingSkillList });
          this.pendingSkillList = null;
        }
        if (this.pendingItemList) {
          this.send({ op: 'itemList', items: this.pendingItemList });
          this.pendingItemList = null;
        }
        if (this.pendingQuestList) {
          this.send({ op: 'questList', quests: this.pendingQuestList });
          this.pendingQuestList = null;
        }
      }
      this.send({ op: 'selfStatus', ...this.self });
      // charSheet: sent right after enterWorld (first UserInfo) and again on
      // every UserInfo re-send (stat changes).
      this.send({
        op: 'charSheet',
        str: u.str, dex: u.dex, con: u.con, int: u.int, wit: u.wit, men: u.men,
        pAtk: u.pAtk, pDef: u.pDef, mAtk: u.mAtk, mDef: u.mDef,
        accuracy: u.accuracy, evasion: u.evasion, critical: u.critical,
        runSpeed: u.runSpeed, walkSpeed: u.walkSpeed,
        pAtkSpd: u.pAtkSpd, mAtkSpd: u.mAtkSpd,
        maxLoad: u.maxLoad,
      });
    });

    game.on('npcInfo', (n) => {
      this.send({
        op: 'addNpc',
        id: n.id,
        npcId: n.npcId,
        name: n.name || npcName(n.npcId),
        // aCis 409 NpcInfo carries no level: prefer the live "Lv N" title
        // prefix (ShowNpcLevel), else the datapack template level, else null.
        level: n.level ?? npcLevel(n.npcId),
        x: n.x, y: n.y, z: n.z, heading: n.heading,
      });
    });

    game.on('charInfo', (c) => {
      if (c.id === this.selfId) return;
      this.playersByName.set(c.id, c.name);
      this.send({
        op: 'addPlayer',
        id: c.id,
        name: c.name,
        race: c.race,
        classId: c.classId,
        // aCis 409 CharInfo carries no level field; unavailable in-protocol.
        level: null,
        x: c.x, y: c.y, z: c.z, heading: c.heading,
      });
    });

    game.on('move', (m) => {
      if (m.id === this.selfId) {
        this.send({ op: 'move', id: m.id, tx: m.tx, ty: m.ty, tz: m.tz });
        return;
      }
      this.send({ op: 'move', id: m.id, tx: m.tx, ty: m.ty, tz: m.tz });
    });

    game.on('teleport', (t) => {
      if (t.id === this.selfId) this.game.pos = { ...this.game.pos, x: t.x, y: t.y, z: t.z };
      this.send({ op: 'move', id: t.id, tx: t.x, ty: t.y, tz: t.z });
    });

    game.on('validate', (v) => {
      if (v.id === this.selfId) this.game.pos = { x: v.x, y: v.y, z: v.z, heading: v.heading };
      this.send({ op: 'move', id: v.id, tx: v.x, ty: v.y, tz: v.z });
    });

    game.on('delete', (id) => {
      this.playersByName.delete(id);
      this.send({ op: 'remove', id });
    });

    game.on('say', (s) => {
      const msg = { op: 'chat', from: s.name, channel: s.channel, text: s.text };
      // TELL (2): the packet's name is the other party. The sender's own echo
      // arrives as "->targetName" (chathandlers/ChatTell.java); strip it.
      if (s.channel === 2) msg.target = s.name.startsWith('->') ? s.name.slice(2) : s.name;
      this.send(msg);
    });

    // ---------------------------------------------------------- M3 combat

    // StatusType ids (enums/StatusType.java): LEVEL 1, EXP 2, CUR_HP 9,
    // MAX_HP 10, CUR_MP 11, MAX_MP 12, SP 13, CUR_CP 33, MAX_CP 34.
    game.on('statusUpdate', ({ id, attrs }) => {
      if (id === this.selfId) {
        if (!this.self) {
          this.self = { hp: 0, maxHp: 0, mp: 0, maxMp: 0, cp: 0, maxCp: 0, level: 0, exp: 0, sp: 0 };
        }
        let touched = false;
        for (const a of attrs) {
          switch (a.type) {
            case 1: this.self.level = a.value; touched = true; break;
            case 2: this.self.exp = a.value; touched = true; break;
            case 9: this.self.hp = a.value; touched = true; break;
            case 10: this.self.maxHp = a.value; touched = true; break;
            case 11: this.self.mp = a.value; touched = true; break;
            case 12: this.self.maxMp = a.value; touched = true; break;
            case 13: this.self.sp = a.value; touched = true; break;
            case 33: this.self.cp = a.value; touched = true; break;
            case 34: this.self.maxCp = a.value; touched = true; break;
          }
        }
        if (touched) this.send({ op: 'selfStatus', ...this.self });
        return;
      }
      const cur = this.statusById.get(id) || { hp: 0, maxHp: 0, mp: 0, maxMp: 0 };
      let touched = false;
      for (const a of attrs) {
        if (a.type === 9) { cur.hp = a.value; touched = true; }
        else if (a.type === 10) { cur.maxHp = a.value; touched = true; }
        else if (a.type === 11) { cur.mp = a.value; touched = true; }
        else if (a.type === 12) { cur.maxMp = a.value; touched = true; }
      }
      this.statusById.set(id, cur);
      if (touched) this.send({ op: 'status', id, hp: cur.hp, maxHp: cur.maxHp, mp: cur.mp, maxMp: cur.maxMp });
    });

    game.on('attack', ({ attackerId, hits }) => {
      for (const h of hits) {
        this.send({
          op: 'attack',
          id: attackerId,
          targetId: h.targetId,
          damage: h.damage,
          critical: (h.flags & 0x20) !== 0,
          miss: (h.flags & 0x80) !== 0,
        });
      }
    });

    game.on('die', (id) => this.send({ op: 'die', id }));
    game.on('revive', (id) => this.send({ op: 'revive', id }));
    game.on('myTarget', (t) => {
      this.currentTarget = t.id;
      // color = MyTargetSelected color: viewer level - target level for
      // attackable targets (the retail con-color basis), 0 otherwise.
      this.send({ op: 'target_ok', id: t.id, color: t.color });
    });

    game.on('systemMessage', (sm) => {
      this.send({ op: 'sysMsg', id: sm.id, params: sm.params.map((p) => p.value) });
    });

    // ------------------------------------------------------ M4: skills & items

    game.on('skillList', (skills) => {
      // SkillList (0x58) carries per skill: passive flag, level, id, disabled
      // flag. The retail client keys its skill window off exactly these --
      // ESkillCategory{SKILL_Active, SKILL_Passive} and the `Lock` field --
      // so both are forwarded rather than dropped.
      const mapped = skills.map((s) => ({
        id: s.id, level: s.level, passive: !!s.passive, disabled: !!s.disabled,
      }));
      if (this.entered) this.send({ op: 'skillList', skills: mapped });
      else this.pendingSkillList = mapped;
    });

    game.on('skillUse', (s) => {
      this.send({
        op: 'skillCast',
        casterId: s.casterId,
        targetId: s.targetId,
        skillId: s.skillId,
        level: s.level,
        hitTime: s.hitTime,
        reuse: s.reuse, // reuse delay in MILLISECONDS (MagicSkillUse field)
      });
    });

    game.on('skillLaunch', (s) => {
      // Contract shape carries a single targetId; emit one op per target.
      for (const targetId of (s.targetIds.length ? s.targetIds : [0])) {
        this.send({ op: 'skillLaunch', casterId: s.casterId, targetId, skillId: s.skillId, level: s.level });
      }
    });

    game.on('itemList', (items) => {
      for (const it of items) this.inventory.set(it.objectId, it.itemId);
      if (this.entered) this.send({ op: 'itemList', items });
      else this.pendingItemList = items;
    });

    // ItemState ordinals (enums/items/ItemState.java): 0 UNCHANGED,
    // 1 ADDED, 2 MODIFIED, 3 REMOVED.
    game.on('invUpdate', (updated) => {
      for (const it of updated) {
        if (it.change === 3) this.inventory.delete(it.objectId);
        else this.inventory.set(it.objectId, it.itemId);
      }
      const CHANGE = ['unchanged', 'add', 'modify', 'remove'];
      this.send({
        op: 'invUpdate',
        updated: updated.map((it) => ({
          change: CHANGE[it.change] || String(it.change),
          objectId: it.objectId,
          itemId: it.itemId,
          count: it.count,
          slot: it.slot,
          equipped: it.equipped,
          enchant: it.enchant,
        })),
      });
    });

    // Merchant shops: BuyList (store it for RequestBuyItem) and SellList.
    game.on('buyList', (b) => {
      this.lastBuyListId = b.listId;
      this.send({ op: 'buyList', listId: b.listId, money: b.money, items: b.items });
    });
    game.on('sellList', (s) => {
      this.send({ op: 'sellList', money: s.money, items: s.items });
    });

    game.on('drop', (d) => {
      this.send({ op: 'addDrop', id: d.id, itemId: d.itemId, count: d.count, x: d.x, y: d.y, z: d.z });
    });

    // QuestList (0x80): after enterWorld (queued) and on every re-send.
    // progress = raw QuestState flags dword (bit31 = started, low bits =
    // cond mask per QuestState.calculateFlags) — passed through uninterpreted.
    game.on('questList', (quests) => {
      const mapped = quests.map((q) => ({ id: q.id, name: questName(q.id), progress: q.flags }));
      if (this.entered) this.send({ op: 'questList', quests: mapped });
      else this.pendingQuestList = mapped;
    });

    // ------------------------------------------------------------ M9 party
    game.on('partyAsk', (a) => this.send({ op: 'partyAsk', from: a.from }));

    game.on('partyAll', (p) => {
      // PartySmallWindowAll excludes the receiver: rebuild with self.
      this.party.leaderId = p.leaderId;
      this.party.lootRule = p.lootRule;
      this.party.members = new Map(p.members.map((m) => [m.id, m]));
      this._sendPartySnapshot();
    });

    game.on('partyAdd', (p) => {
      this.party.leaderId = p.leaderId;
      this.party.lootRule = p.lootRule;
      this.party.members.set(p.member.id, p.member);
      this._sendPartySnapshot();
    });

    game.on('partyDelete', (d) => {
      this.party.members.delete(d.id);
      this._sendPartySnapshot();
    });

    game.on('partyDeleteAll', () => {
      this.party = { leaderId: 0, lootRule: 0, members: new Map() };
      this._sendPartySnapshot();
    });

    game.on('partyUpdate', (u) => {
      const m = this.party.members.get(u.id);
      if (m) Object.assign(m, u);
      this.send({
        op: 'partyMemberStatus',
        id: u.id, hp: u.hp, maxHp: u.maxHp, mp: u.mp, maxMp: u.maxMp,
      });
    });

    // ------------------------------------------------- M10: buffs & reuse
    // AbnormalStatusUpdate is a FULL SNAPSHOT of self effects each time
    // (built fresh with all current buffs+debuffs on every add/remove).
    // duration is in SECONDS from the packet; -1 = toggle/infinite.
    game.on('abnormal', (effects) => this.send({ op: 'buffs', effects }));

    // SkillCoolTime: reuse + remaining in SECONDS (packet divides by 1000).
    game.on('coolTime', (skills) => this.send({ op: 'skillCoolTime', skills }));

    // ------------------------------------------------------------ M12 trade
    // SendTradeRequest(0x5e) carries the requestor objectId; resolve to name
    // via the visible-players map (server guarantees the requestor is known).
    game.on('tradeAsk', (a) => {
      this.send({ op: 'tradeAsk', from: this.playersByName.get(a.fromId) || String(a.fromId) });
    });

    // TradeStart(0x1e): session open. items = own tradable inventory
    // snapshot (the packet's payload), forwarded uninterpreted.
    game.on('tradeStart', (t) => {
      this.send({
        op: 'tradeStart',
        partnerId: t.partnerId,
        partner: this.playersByName.get(t.partnerId) || null,
        items: t.items,
      });
    });

    // TradeOwnAdd(0x20)/TradeOtherAdd(0x21): per-add packets (H count is
    // always 1 in this rev); forwarded as one-item lists.
    game.on('tradeOwnAdd', (items) => this.send({ op: 'tradeOwn', items }));
    game.on('tradeOtherAdd', (items) => this.send({ op: 'tradeOther', items }));

    // SendTradeDone(0x22): 1 = exchange done, 0 = cancelled/failed.
    game.on('tradeEnd', (e) => this.send({ op: 'tradeEnd', reason: e.success ? 'done' : 'cancel' }));

    // Two-phase confirm markers (TradePressOwnOk 0x75 / TradePressOtherOk
    // 0x7c, both empty): logged only — not part of the frozen contract.
    game.on('tradePressOwnOk', () => this.log('trade: own confirm registered (waiting for partner)'));
    game.on('tradePressOtherOk', () => this.log('trade: partner confirmed'));

    // NpcHtmlMessage (0x0f) — villager dialogs, .menu, teleporters, shops.
    game.on('html', (h) => {
      this.send({ op: 'npcHtml', html: h.html });
      this.log(`npcHtml (html window, ${h.html.length} chars, objectId ${h.objectId}) >>>${h.html.replace(/\s+/g, ' ')}<<<`);
    });

    // ActionFailed (0x25) — talk/action rejected.
    game.on('actionFailed', () => this.send({ op: 'actionFailed' }));

    // Action broadcasts (additive): social emotes, sit/stand, walk/run.
    game.on('socialAction', (s) => this.send({ op: 'socialAction', id: s.id, actionId: s.actionId }));
    game.on('changeWait', (c) => this.send({ op: 'changeWait', id: c.id, waitType: c.waitType }));
    game.on('changeMove', (c) => this.send({ op: 'changeMove', id: c.id, running: c.running }));
  }

  _sendPartySnapshot() {
    // Full snapshot: self first (from local state), then packet members,
    // leader flag per leaderId. Emitted on every composition change
    // (All/Add/Delete/DeleteAll); status flows via partyMemberStatus.
    const members = [];
    if (this.selfInfo && (this.party.members.size > 0 || this.party.leaderId === this.selfId)) {
      members.push({
        id: this.selfId,
        name: this.selfInfo.name,
        classId: this.selfInfo.classId,
        level: this.selfInfo.level,
        hp: this.self ? this.self.hp : 0,
        maxHp: this.self ? this.self.maxHp : 0,
        mp: this.self ? this.self.mp : 0,
        maxMp: this.self ? this.self.maxMp : 0,
        leader: this.party.leaderId === this.selfId,
      });
    }
    for (const m of this.party.members.values()) {
      members.push({
        id: m.id,
        name: m.name,
        classId: m.classId,
        level: m.level,
        hp: m.hp,
        maxHp: m.maxHp,
        mp: m.mp,
        maxMp: m.maxMp,
        leader: m.id === this.party.leaderId,
      });
    }
    this.send({ op: 'party', members });
  }

  _shutdown() {
    if (this.closed) return;
    this.closed = true;
    if (this.game) {
      this.game.close();
      this.game = null;
    }
    try { this.ws.close(); } catch (_) { /* ignore */ }
  }
}

module.exports = { Bridge, deriveCredentials };
