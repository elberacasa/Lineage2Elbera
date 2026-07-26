// Bridges one browser WebSocket client to one L2 game session.
// Implements the FROZEN bridge contract (see gateway/README.md).
'use strict';

const crypto = require('crypto');
const { login } = require('./loginclient.js');
const { GameSession } = require('./gameclient.js');
const { npcName } = require('./npcnames.js');

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
      }
    } catch (e) {
      this.log(`bridge error: ${e.message}`);
    }
  }

  async _login(deviceId) {
    if (this.game) return; // already logged in
    const creds = deriveCredentials(deviceId);
    this.log(`login: device=${deviceId} account=${creds.account}`);

    // Retry the whole login+game-connect flow: the servers' hardcoded
    // IPv4Filter can still reject a burst (see governor.js), so back off.
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await this._loginOnce(creds);
        return;
      } catch (e) {
        this.log(`login attempt ${attempt} failed: ${e.message}`);
        if (this.game) {
          this.game.close();
          this.game = null;
        }
        if (attempt < 4) await new Promise((r) => setTimeout(r, 1500 * attempt));
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
        x: n.x, y: n.y, z: n.z, heading: n.heading,
      });
    });

    game.on('charInfo', (c) => {
      if (c.id === this.selfId) return;
      this.send({
        op: 'addPlayer',
        id: c.id,
        name: c.name,
        race: c.race,
        classId: c.classId,
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

    game.on('delete', (id) => this.send({ op: 'remove', id }));

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
      this.send({ op: 'target_ok', id: t.id });
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
      });
    });

    game.on('skillLaunch', (s) => {
      // Contract shape carries a single targetId; emit one op per target.
      for (const targetId of (s.targetIds.length ? s.targetIds : [0])) {
        this.send({ op: 'skillLaunch', casterId: s.casterId, targetId, skillId: s.skillId, level: s.level });
      }
    });

    game.on('itemList', (items) => {
      if (this.entered) this.send({ op: 'itemList', items });
      else this.pendingItemList = items;
    });

    // ItemState ordinals (enums/items/ItemState.java): 0 UNCHANGED,
    // 1 ADDED, 2 MODIFIED, 3 REMOVED.
    game.on('invUpdate', (updated) => {
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

    game.on('drop', (d) => {
      this.send({ op: 'addDrop', id: d.id, itemId: d.itemId, count: d.count, x: d.x, y: d.y, z: d.z });
    });

    // NpcHtmlMessage (0x0f) — e.g. the .menu window. Not a contract op;
    // logged for debugging (the web client implements its own menu).
    game.on('html', (h) => {
      this.log(`html window (${h.html.length} chars) >>>${h.html.replace(/\s+/g, ' ')}<<<`);
    });
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
