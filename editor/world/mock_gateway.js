// M2 mock gateway — implements the frozen browser<->gateway JSON contract
// so the web client can be verified before the real gateway lands.
//
//   node mock_gateway.js [port]        (default 8085)
//
// Behavior per connection:
//   login{deviceId}   -> auth_ok{chars:[one char]}
//   enterChar{slot}   -> enterWorld{char{...}} at tile 17_24 center,
//                        then addNpc x3, addPlayer x3 (2 standing, 1 walker)
//   moveTo{x,y,z}     -> echoed back as move{id:<self>} (server-authoritative)
//   say{channel,text} -> echoed back as chat{from:<self name>}
//   periodic: walker move ops (square patrol) + ambient chat lines
//
// M3 combat simulation:
//   target{id}      -> target_ok{id} + status{id,hp,maxHp}
//   attack{id}      -> combat loop on the gremlin (70001): player hits
//                      (attack/status ops), gremlin counters, selfStatus
//                      ticks; gremlin dies -> die + exp gain, revives 6 s
//                      later (revive + full status)
//   say "/die"      -> selfStatus hp 0 (death overlay test)
//   say "/revive"   -> selfStatus full (overlay clears)
//   selfStatus      -> sent once after enterChar
// M4 ops emitted by the mock:
//   enterChar   -> skillList + itemList (after enterWorld/selfStatus)
//   useSkill    -> skillCast(hitTime 1500) -> skillLaunch; gremlin hit if
//                  it is the target; gremlin also casts back periodically
//   useItem     -> sysMsg + invUpdate (decrement/remove consumable)
//   action      -> sysMsg; ids 2..13 also echo socialAction (bridge routing)
//                  for self AND Aria (remote-player emote fixture)
//   buffs       <- 3 timed effects + 1 toggle at enterChar; buffUpdate
//                  removes the short one at +12s
//   skillCoolTime <- login snapshot at enterChar (skill 3, 10s reuse, 5s
//                  left); useSkill's skillCast carries reuse ms (aCis
//                  sends no SkillCoolTime on cast)
//   questList   <- sent at enterChar (Q1 cond1 + Q6 cond3, REAL names)
//   questAbort  -> removes the quest and re-sends questList (server push)
//   partyAsk    <- incoming invite (Aria), ON DEMAND via say "/partyask"
//   partyAnswer -> accept forms a 2-member party + status tick
//   partyInvite -> snapshot with SELF leader; partyKick/partyLeave ->
//   updated snapshots (party of one disbands, like aCis)
//   buyList     <- on bypass npc_buy; sellList <- npc_sell and after a
//                  sale; buy/sell validated, results via invUpdate only
//   loot{id}    -> invUpdate add (adena) + sysMsg, only for dead mobs
// M12 trade (virtual partner Aria):
//   tradeRequest{name} -> sysMsg 118, then Aria accepts -> tradeStart
//                  (items = own tradable snapshot: equipped excluded)
//   say "/tradeask" -> incoming tradeAsk{from:'Aria'} (on-demand fixture)
//   tradeAnswer -> accept 1: tradeStart; accept 0: silence (refuse only
//                  sysMsgs the REQUESTOR, who is virtual here)
//   tradeAdd    -> tradeOwn echo (per-add, one-item list); Aria answers
//                  the first add with her own offer via tradeOther
//   tradeDone   -> TWO-PHASE: marks own confirm; Aria confirms 500 ms
//                  later -> tradeEnd{done} + sysMsg 123 + item movement
//                  via invUpdate ONLY
//   tradeCancel -> tradeEnd{cancel}; offered items never move
// Remote-anim fixtures at enterChar: changeWait{Borg,sit} + changeMove
// {Cora,running}.
//
// Coordinates are L2 world units. Tile 17_24 center: origin
// [-98304, 196608] + 127.5*128 = (-81984, 212928).

const path = require('path');
const { WebSocketServer } = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/ws');

const PORT = Number(process.argv[2]) || 8085;

// z is deliberately far underground: the web client takes
// max(terrainHeight, serverZ), so entities ground-clamp to the converted
// terrain (the mock has no geodata; the real gateway sends true z).
const SPAWN = { x: -81984, y: 212928, z: -100000 };

const NPCS = [
  { id: 70001, npcId: 20001, name: 'Gremlin', level: 1, x: SPAWN.x + 800, y: SPAWN.y + 400, z: SPAWN.z, heading: 32768 },
  { id: 70002, npcId: 20003, name: 'Goblin', level: 1, x: SPAWN.x - 600, y: SPAWN.y + 900, z: SPAWN.z, heading: 16384 },
  // name intentionally blank: exercises the client's /gamedata/npcname.json enrichment
  { id: 70003, npcId: 20004, name: '', level: 1, x: SPAWN.x + 300, y: SPAWN.y - 700, z: SPAWN.z, heading: 49152 },
  // M4: mapped civilian (a_common_peopleA_MHuman_m00 is in the monsters
  // manifest) -> renders as a real model
  { id: 70004, npcId: 30050, name: 'Elias', x: SPAWN.x + 300, y: SPAWN.y - 400, z: SPAWN.z, heading: 16384 },
  // unmapped npcId (no npcgrp entry at all) -> capsule fallback
  { id: 70005, npcId: 99999, name: 'Mystery Man', x: SPAWN.x + 500, y: SPAWN.y - 200, z: SPAWN.z, heading: 0 },
  // renderScale demo (docs/npc-visual-data.md §4): same wererat mesh,
  // server heights 18.7 vs 50.0 -> visibly different sizes
  { id: 70006, npcId: 20360, name: 'Ratman Spy', x: SPAWN.x - 500, y: SPAWN.y - 300, z: SPAWN.z, heading: 0 },
  { id: 70007, npcId: 25438, name: 'Thief Kelbar', x: SPAWN.x - 900, y: SPAWN.y - 300, z: SPAWN.z, heading: 0 },
];

const PLAYERS = [
  { id: 80001, name: 'Aria', race: 'Elf', classId: 25, level: null, x: SPAWN.x + 1000, y: SPAWN.y + 1200, z: SPAWN.z, heading: 32768 },
  { id: 80002, name: 'Borg', race: 'Orc', classId: 44, level: null, x: SPAWN.x - 1100, y: SPAWN.y - 500, z: SPAWN.z, heading: 0 },
];
const WALKER = { id: 80003, name: 'Cora', race: 'Human', classId: 0, x: SPAWN.x - 400, y: SPAWN.y + 400, z: SPAWN.z, heading: 0 };
const SQUARE = 800;        // L2 units per side (8 m -> ~5 s per side at walk speed)
const WALK_PERIOD = 5000;  // ms per side

const AMBIENT = [
  'welcome to the L2Vzla web port',
  'this is the mock gateway talking',
  'the real gateway speaks this same JSON',
  'try click-walking near me',
];

// M3: combat state for the targetable gremlin
const MOBS = {
  70001: { hp: 500, maxHp: 500, dead: false },
};
// viewer level: seedable for con-color tests (default 1; MOCK_LEVEL=40
// makes target_ok.color strongly negative vs level-1 gremlins)
const SELF_LEVEL = Number(process.env.MOCK_LEVEL) || 1;

const SELF_BASE = {
  hp: 800, maxHp: 800, mp: 200, maxMp: 200,
  cp: 400, maxCp: 400, level: SELF_LEVEL, exp: 0, sp: 0,
};

let nextPlayerId = 1000001;
const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
console.log(`mock gateway on ws://127.0.0.1:${PORT}`);

wss.on('connection', (ws) => {
  const timers = [];
  const self = { id: nextPlayerId++, name: `WebTester${Math.floor(Math.random() * 900 + 100)}` };
  const selfStats = { ...SELF_BASE };
  const items = [];
  const quests = [];
  let party = [];
  let partyTick = null;
  // M12 trade state (virtual partner Aria): null = no active trade
  let trade = null;
  let nextBoughtId = 1;
  let lastTarget = null;
  let lootCounter = 0;
  let combatTimer = null;
  // mobs are module-level (shared): reset per session so a killed mob
  // from a previous run (respawn cancelled on disconnect) can't leak
  for (const id of Object.keys(MOBS)) MOBS[id] = { hp: 500, maxHp: 500, dead: false };
  console.log(`+ connection, player id ${self.id}`);

  const send = (op, fields = {}) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ op, ...fields }));
  };

  // M11 shop: the sell list is built from the CURRENT inventory (prices
  // are the server's truth — the client never computes them; adena
  // itself is not sellable)
  let shopStock = [];
  const SELL_PRICES = { 1147: 60, 2509: 400, 2369: 750, 1060: 120, 1835: 30, 734: 220 };
  const sendSellList = () => {
    send('sellList', {
      items: items.filter(it => it.itemId !== 57).map(it => ({
        objectId: it.objectId, itemId: it.itemId, count: it.count,
        price: SELL_PRICES[it.itemId] || 10,
      })),
    });
  };

  // M12 trade: Aria's standing offer (2 healing potions). Movement on
  // completion rides invUpdate ONLY — the trade ops never move items.
  const ARIA_OFFER = { objectId: 95001, itemId: 1060, count: 2, slot: 0, enchant: 0 };
  const startTrade = () => {
    trade = { ownOffer: [], ownConfirmed: false, ariaOffered: false };
    send('tradeStart', {
      partnerId: 80001, partner: 'Aria',
      // own tradable snapshot (M12): equipped items excluded
      items: items.filter(i => !i.equipped).map(i => ({
        objectId: i.objectId, itemId: i.itemId, count: i.count,
        slot: i.slot, enchant: i.enchant,
      })),
    });
  };
  const finishTrade = () => {
    if (!trade) return;
    for (const e of trade.ownOffer) {
      const it = items.find(i => i.objectId === e.objectId);
      if (!it) continue;
      it.count -= e.count;
      if (it.count <= 0) {
        items.splice(items.indexOf(it), 1);
        send('invUpdate', { updated: [{ change: 'remove', objectId: it.objectId, itemId: it.itemId }] });
      } else {
        send('invUpdate', { updated: [{ change: 'modify', ...it }] });
      }
    }
    const potions = items.find(i => i.itemId === ARIA_OFFER.itemId && !i.equipped);
    if (potions) {
      potions.count += ARIA_OFFER.count;
      send('invUpdate', { updated: [{ change: 'modify', ...potions }] });
    } else {
      const it = { ...ARIA_OFFER };
      items.push(it);
      send('invUpdate', { updated: [{ change: 'add', ...it }] });
    }
    send('sysMsg', { id: 123, params: [] });
    send('tradeEnd', { reason: 'done' });
    trade = null;
  };

  // M3 combat loop: player whacks the gremlin, gremlin counters
  const startCombat = (mobId) => {
    const mob = MOBS[mobId];
    if (!mob || mob.dead || combatTimer) return;
    let tick = 0;
    combatTimer = setInterval(() => {
      tick++;
      if (mob.dead) { clearInterval(combatTimer); combatTimer = null; return; }
      const miss = Math.random() < 0.1;
      const critical = !miss && Math.random() < 0.15;
      const damage = miss ? 0 : Math.round((40 + Math.random() * 40) * (critical ? 2 : 1));
      send('attack', { id: self.id, targetId: mobId, damage, critical, miss });
      if (!miss) mob.hp = Math.max(0, mob.hp - damage);
      send('status', { id: mobId, hp: mob.hp, maxHp: mob.maxHp });
      // gremlin counters every other tick; keeps player hp above ~30%
      if (tick % 2 === 0 && !mob.dead) {
        const md = 8 + Math.round(Math.random() * 8);
        send('attack', { id: mobId, targetId: self.id, damage: md, critical: false, miss: false });
        selfStats.hp = Math.max(240, selfStats.hp - md);
        send('selfStatus', selfStats);
      }
      // and casts its special every 6th tick
      if (tick % 6 === 0 && !mob.dead) {
        send('skillCast', { casterId: mobId, targetId: self.id, skillId: 45, level: 1, hitTime: 900 });
        timers.push(setTimeout(() => {
          send('skillLaunch', { casterId: mobId, targetId: self.id, skillId: 45, level: 1 });
        }, 900));
      }
      if (mob.hp <= 0) {
        mob.dead = true;
        send('die', { id: mobId });
        selfStats.exp = Math.min(1, +(selfStats.exp + 0.35).toFixed(2));
        selfStats.sp += 50;
        send('selfStatus', selfStats);
        clearInterval(combatTimer); combatTimer = null;
        // respawn the gremlin 6 s later
        timers.push(setTimeout(() => {
          mob.dead = false; mob.hp = mob.maxHp;
          send('revive', { id: mobId });
          send('status', { id: mobId, hp: mob.hp, maxHp: mob.maxHp });
        }, 6000));
      }
    }, 1200);
    timers.push(combatTimer);
  };

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    console.log('  <-', JSON.stringify(msg));

    if (msg.op === 'login') {
      send('auth_ok', {
        chars: [{ slot: 0, name: self.name, race: 'Human', classId: 0 }],
      });
    } else if (msg.op === 'enterChar') {
      send('enterWorld', {
        char: {
          id: self.id, name: self.name, race: 'Human', classId: 0,
          x: SPAWN.x, y: SPAWN.y, z: SPAWN.z, heading: 32768,
        },
      });
      for (const n of NPCS) send('addNpc', n);
      for (const p of PLAYERS) send('addPlayer', p);
      send('addPlayer', WALKER);
      send('selfStatus', selfStats);

      // M4: skills + inventory snapshots
      send('skillList', { skills: [
        { id: 3, level: 1 }, { id: 1043, level: 1 }, { id: 28, level: 1 },
      ] });
      items.push(
        { objectId: 90001, itemId: 57, count: 1200, slot: 0, equipped: 0, enchant: 0 },
        { objectId: 90002, itemId: 1147, count: 5, slot: 0, equipped: 0, enchant: 0 },
        { objectId: 90003, itemId: 2369, count: 1, slot: 5, equipped: 1, enchant: 3 },
        { objectId: 90004, itemId: 2509, count: 1, slot: 0, equipped: 0, enchant: 0 },
        { objectId: 90005, itemId: 1060, count: 12, slot: 0, equipped: 0, enchant: 0 },
        { objectId: 90006, itemId: 1835, count: 7, slot: 0, equipped: 0, enchant: 0 },
        { objectId: 90007, itemId: 734, count: 2, slot: 0, equipped: 0, enchant: 0 },
      );
      send('itemList', { items });

      // M5: character sheet + welcome sysmsg + whisper demo
      send('charSheet', {
        str: 35, dex: 26, con: 32, int: 21, wit: 19, men: 25,
        pAtk: 42, pDef: 36, mAtk: 28, mDef: 31, accuracy: 33, evasion: 29,
        critical: 44, runSpeed: 126, walkSpeed: 88, pAtkSpd: 300, mAtkSpd: 333,
      });
      send('sysMsg', { id: 1087, params: [] });

      // M8: quest journal — two REAL quests (names from the aCis Java
      // sources): Q1 cond 1 (0x80000001 signed) and Q6 cond 3 (0x80000007
      // signed). questAbort removes and re-sends, like the server push.
      quests.push(
        { id: 1, name: 'Letters of Love', progress: -2147483647 },
        { id: 6, name: 'Step into the Future', progress: -2147483641 },
      );
      send('questList', { quests });

      // walker: patrol a square, one move op per side
      let corner = 0;
      const corners = [
        [WALKER.x + SQUARE, WALKER.y],
        [WALKER.x + SQUARE, WALKER.y + SQUARE],
        [WALKER.x, WALKER.y + SQUARE],
        [WALKER.x, WALKER.y],
      ];
      timers.push(setInterval(() => {
        const [tx, ty] = corners[corner % corners.length];
        corner++;
        send('move', { id: WALKER.id, tx, ty, tz: SPAWN.z });
      }, WALK_PERIOD));

      // remote-anim fixtures: Borg sits (ChangeWaitType 0), the walker
      // runs her square (ChangeMoveType running) — the client must pick
      // the sit/run clips from these ops alone
      send('changeWait', { id: 80002, waitType: 0 });
      send('changeMove', { id: WALKER.id, running: true });

      // C.10 buff fixture: 3 real effects (icons exist in skillmeta) —
      // two long buffs + one short "debuff" (Entangle; the strip has no
      // tint distinction in Interlude, see abnormalwnd.js header). The
      // short one is removed by a buffUpdate delta at +12s (local
      // countdown would expire it at the same time — both paths covered).
      send('buffs', { effects: [
        { skillId: 1040, level: 3, duration: 120 },
        { skillId: 1035, level: 4, duration: 20 },
        { skillId: 102, level: 1, duration: 12 },
        { skillId: 1043, level: 1, duration: -1 },   // toggle (M10: -1)
      ] });
      timers.push(setTimeout(() => {
        send('buffUpdate', { add: [], remove: [102] });
      }, 12000));

      // SkillCoolTime arrives at EnterWorld in aCis (login restore of
      // cooldowns in progress) — reuse + remaining in SECONDS, like M10.
      // Long times so the verify can observe the sweep any time later.
      send('skillCoolTime', { skills: [{ id: 3, level: 1, reuse: 600, remaining: 300 }] });

      // ambient chat
      let ci = 0;
      timers.push(setInterval(() => {
        send('chat', { from: WALKER.name, channel: 'all', text: AMBIENT[ci++ % AMBIENT.length] });
      }, 8000));
    } else if (msg.op === 'moveTo') {
      // server-authoritative echo: client reconciles its own movement
      send('move', { id: self.id, tx: msg.x, ty: msg.y, tz: msg.z });
    } else if (msg.op === 'say') {
      // whisper (channel 2) carries a target; echo + fake reply
      if (msg.channel === 2 && msg.target) {
        // mirror the real bridge: own echo as "->target", reply from sender
        send('chat', { from: '->' + msg.target, channel: 2, target: msg.target, text: msg.text });
        timers.push(setTimeout(() => {
          send('chat', {
            from: msg.target, channel: 2, target: self.name,
            text: `psst — hi from ${msg.target}`,
          });
        }, 1200));
      } else {
        send('chat', { from: self.name, channel: msg.channel ?? 0, text: msg.text });
      }
      if (msg.text === '/die') send('selfStatus', { ...selfStats, hp: 0 });
      if (msg.text === '/revive') send('selfStatus', selfStats);
      // M9 party fixture ON DEMAND — an unsolicited prompt would cover the
      // 3D clicks of unrelated verify suites
      if (msg.text === '/partyask' && !party.length) send('partyAsk', { from: 'Aria' });
      // M12: incoming trade ask, ON DEMAND (same reason as /partyask)
      if (msg.text === '/tradeask' && !trade) send('tradeAsk', { from: 'Aria' });
      if (msg.text === '.menu') {
        send('npcHtml', { html:
          `<html><body><title>L2Vzla - Player menu</title><br><br><center>` +
          `<font color="LEVEL">Server menu</font><br><br>` +
          `<button value="Auto-loot ON" action="bypass -h menu_loot_on" width="110" height="18"><br>` +
          `<button value="Auto-loot OFF" action="bypass -h menu_loot_off" width="110" height="18"><br>` +
          `<button value="Sanitize test" action="bypass -h evil" width="110" height="18"><br>` +
          `<button value="Close" action="bypass -h npc_bye" width="110" height="18">` +
          `</center></body></html>` });
      }
    } else if (msg.op === 'target') {
      // loot (mirror of the real bridge: Action on a dead mob = pickup)
      const deadMob = MOBS[msg.id];
      if (deadMob && deadMob.dead) {
        lootCounter++;
        const adena = { objectId: 90100 + lootCounter, itemId: 57, count: 23, slot: 0, equipped: 0, enchant: 0 };
        items.push(adena);
        send('invUpdate', { updated: [{ change: 'add', ...adena }] });
        send('sysMsg', { id: 28, params: ['adena', 23] });
        return;
      }
      lastTarget = msg.id;
      const targetNpc = NPCS.find(n => n.id === msg.id);
      // aCis MyTargetSelected color semantics: viewer level - target level
      // for attackable targets (all our NPCs count as attackable), 0 else
      const color = targetNpc && targetNpc.level != null
        ? selfStats.level - targetNpc.level : 0;
      send('target_ok', { id: msg.id, color });
      const mob = MOBS[msg.id];
      send('status', { id: msg.id, hp: mob ? mob.hp : 300, maxHp: mob ? mob.maxHp : 300 });
    } else if (msg.op === 'attack') {
      startCombat(msg.id);
    } else if (msg.op === 'useSkill') {
      const targetId = msg.targetId ?? lastTarget;
      // per-cast reuse rides inside MagicSkillUse itself (aCis sends no
      // SkillCoolTime on cast; the field is MILLISECONDS)
      send('skillCast', {
        casterId: self.id, targetId, skillId: msg.skillId, level: 1, hitTime: 1500,
        reuse: 8000,
      });
      timers.push(setTimeout(() => {
        send('skillLaunch', { casterId: self.id, targetId, skillId: msg.skillId, level: 1 });
        const mob = MOBS[targetId];
        if (mob && !mob.dead) {
          const damage = 60 + Math.round(Math.random() * 40);
          send('attack', { id: self.id, targetId, damage, critical: false, miss: false });
          mob.hp = Math.max(0, mob.hp - damage);
          send('status', { id: targetId, hp: mob.hp, maxHp: mob.maxHp });
        }
      }, 1500));
    } else if (msg.op === 'talk') {
      // villager dialog (representative L2 markup: title, colored fonts,
      // a table, links, a button)
      const npc = NPCS.find(n => n.id === msg.id) || { name: 'NPC' };
      send('npcHtml', { html:
        `<html><body><title>${npc.name}</title><br><br><center>` +
        `<font color="LEVEL">${npc.name}</font><br><br>` +
        `Welcome, traveler. What brings you to our village?<br><br>` +
        `<table width="260"><tr><td width="120"><font color="BROWN">Services</font></td>` +
        `<td><a action="bypass -h npc_services">Ask about services</a></td></tr>` +
        `<tr><td><font color="BROWN">Quests</font></td>` +
        `<td><a action="bypass -h npc_quests">Ask about quests</a></td></tr>` +
        `<tr><td><font color="BROWN">Shop</font></td>` +
        `<td><a action="bypass -h npc_shop">Buy / sell supplies</a></td></tr></table><br>` +
        `<button value="Farewell" action="bypass -h npc_bye" width="80" height="18">` +
        `</center></body></html>` });
    } else if (msg.op === 'bypass') {
      const cmd = String(msg.command || '');
      if (cmd === 'npc_shop') {
        send('npcHtml', { html:
          `<html><body><title>Shop</title><br><br><center>` +
          `<a action="bypass -h npc_buy">Buy supplies</a><br><br>` +
          `<a action="bypass -h npc_sell">Sell items</a><br><br>` +
          `<a action="bypass -h npc_back">Back</a></center></body></html>` });
      } else if (cmd === 'npc_buy') {
        // merchant stock: price + stock count (-1 = unlimited, like the
        // merchant's endless potion supply)
        shopStock = [
          { itemId: 1060, count: -1, price: 250 },
          { itemId: 734, count: -1, price: 450 },
          { itemId: 2509, count: -1, price: 1000 },
          { itemId: 2369, count: 1, price: 1500 },
        ];
        send('buyList', { items: shopStock });
      } else if (cmd === 'npc_sell') {
        sendSellList();
      } else if (cmd === 'npc_services') {        send('npcHtml', { html:
          `<html><body><title>Services</title><br><br><center>` +
          `We offer <font color="YELLOW">supplies</font> and guidance.<br><br>` +
          `<a action="bypass -h npc_back">Back</a></center></body></html>` });
      } else if (cmd === 'npc_quests') {
        send('npcHtml', { html:
          `<html><body><title>Quests</title><br><br><center>` +
          `Hunt <font color="RED">gremlins</font> in the fields nearby.<br><br>` +
          `<a action="bypass -h npc_back">Back</a></center></body></html>` });
      } else if (cmd === 'npc_back') {
        send('npcHtml', { html:
          `<html><body><title>Gremlin</title><br><br><center>` +
          `<a action="bypass -h npc_services">Services</a> · ` +
          `<a action="bypass -h npc_quests">Quests</a></center></body></html>` });
      } else if (cmd === 'evil') {
        // sanitize test fixture: script tag + javascript: href must die
        send('npcHtml', { html:
          `<html><body><title>Evil</title>` +
          `<script>window.__pwned = true;</script>` +
          `<a action="javascript:window.__pwned2 = true">bad link</a>` +
          `<a action="bypass -h npc_back">safe link</a>` +
          `<img src="https://evil.example/x.png">` +
          `</body></html>` });
      }
      // npc_bye and unknown commands: no response (retail silence)
    } else if (msg.op === 'useItem') {
      const it = items.find(i => i.objectId === msg.objectId);
      send('sysMsg', { id: 46, params: [it ? `item:${it.itemId}` : `${msg.objectId}`] });
      if (it && it.count > 1) {
        it.count -= 1;
        send('invUpdate', { updated: [{ change: 'modify', ...it }] });
      } else if (it) {
        items.splice(items.indexOf(it), 1);
        send('invUpdate', { updated: [{ change: 'remove', objectId: it.objectId, itemId: it.itemId }] });
      }
    } else if (msg.op === 'action') {
      // mirror the real bridge's routing: ids 2..13 are social actions and
      // get a SocialAction broadcast back; the rest is fire-and-forget
      send('sysMsg', { id: 46, params: [`action:${msg.actionId}`] });
      if (msg.actionId >= 2 && msg.actionId <= 13) {
        send('socialAction', { id: self.id, actionId: msg.actionId });
        // a social in the area is broadcast for everyone present: Aria
        // dances along (exercises remote-player emotes)
        send('socialAction', { id: 80001, actionId: msg.actionId });
      }
    } else if (msg.op === 'questAbort') {
      // mirror the real server: abort removes the quest and the updated
      // QuestList is pushed back
      const i = quests.findIndex(q => q.id === msg.id);
      if (i >= 0) quests.splice(i, 1);
      send('questList', { quests });
    } else if (msg.op === 'partyAnswer') {
      // the mock's pending ask (Aria invited): accept forms the party —
      // FULL snapshot, self first (the bridge re-inserts self the same
      // way), then a status tick so bar updates get exercised
      if (msg.accept === 1) {
        party = [
          { id: self.id, name: self.name, classId: 0, level: 1,
            hp: 800, maxHp: 800, mp: 200, maxMp: 200, leader: false },
          { id: 80001, name: 'Aria', classId: 25, level: 20,
            hp: 320, maxHp: 500, mp: 90, maxMp: 200, leader: true },
        ];
        send('party', { members: party });
        let hi = false;
        partyTick = setInterval(() => {
          if (!party.length) { clearInterval(partyTick); partyTick = null; return; }
          hi = !hi;
          send('partyMemberStatus', {
            id: 80001, hp: hi ? 450 : 320, maxHp: 500, mp: 90, maxMp: 200,
          });
        }, 3000);
        timers.push(partyTick);
      }
      // accept 0 (refuse): retail silence
    } else if (msg.op === 'partyInvite') {
      // we invite: the invited player accepts -> party with SELF leader
      party = [
        { id: self.id, name: self.name, classId: 0, level: 1,
          hp: 800, maxHp: 800, mp: 200, maxMp: 200, leader: true },
        { id: 80001, name: String(msg.name || '?'), classId: 25, level: 20,
          hp: 320, maxHp: 500, mp: 90, maxMp: 200, leader: false },
      ];
      send('party', { members: party });
    } else if (msg.op === 'partyKick') {
      party = party.filter(m => m.name !== msg.name);
      // aCis disbands a party reduced to one member -> empty snapshot
      if (party.length <= 1) party = [];
      send('party', { members: party });
    } else if (msg.op === 'partyLeave') {
      party = [];
      send('party', { members: party });
    } else if (msg.op === 'buy') {
      // validate against the stock the mock last sent + the player's
      // adena; results arrive ONLY via invUpdate (server truth)
      const adena = items.find(i => i.itemId === 57);
      let total = 0;
      const clean = [];
      for (const b of msg.items || []) {
        const stock = shopStock.find(s => s.itemId === b.itemId);
        if (!stock) continue;
        const n = Math.max(0, b.count | 0);
        if (!n) continue;
        if (stock.count >= 0) stock.count = Math.max(0, stock.count - n);
        total += stock.price * n;
        clean.push({ stock, n });
      }
      if (!adena || adena.count < total) {
        send('sysMsg', { id: 279, params: ['not enough adena'] });
      } else {
        adena.count -= total;
        send('invUpdate', { updated: [{ change: 'modify', ...adena }] });
        for (const { stock, n } of clean) {
          const have = items.find(i => i.itemId === stock.itemId && !i.equipped);
          if (have) {
            have.count += n;
            send('invUpdate', { updated: [{ change: 'modify', ...have }] });
          } else {
            const it = { objectId: 90200 + (nextBoughtId++), itemId: stock.itemId, count: n, slot: 0, equipped: 0, enchant: 0 };
            items.push(it);
            send('invUpdate', { updated: [{ change: 'add', ...it }] });
          }
        }
        send('sysMsg', { id: 46, params: [`bought ${clean.length} item(s)`] });
      }
    } else if (msg.op === 'sell') {
      const adena = items.find(i => i.itemId === 57);
      let total = 0;
      for (const s of msg.items || []) {
        const it = items.find(i => i.objectId === s.objectId);
        if (!it) continue;
        const n = Math.min(it.count, Math.max(0, s.count | 0));
        if (!n) continue;
        total += (SELL_PRICES[it.itemId] || 10) * n;
        it.count -= n;
        if (it.count <= 0) {
          items.splice(items.indexOf(it), 1);
          send('invUpdate', { updated: [{ change: 'remove', objectId: it.objectId, itemId: it.itemId }] });
        } else {
          send('invUpdate', { updated: [{ change: 'modify', ...it }] });
        }
      }
      if (adena && total > 0) {
        adena.count += total;
        send('invUpdate', { updated: [{ change: 'modify', ...adena }] });
      }
      // retail sends nothing more: the sell window hides on OK and the
      // list is only re-sent when the dialog asks again
    } else if (msg.op === 'tradeRequest') {
      // sysMsg 118 (REQUEST_S1_FOR_TRADE) at the requestor; Aria accepts
      // after a beat -> tradeStart on both sides (M12)
      send('sysMsg', { id: 118, params: [String(msg.name || 'Aria')] });
      timers.push(setTimeout(startTrade, 600));
    } else if (msg.op === 'tradeAnswer') {
      // the mock's pending ask (Aria offered): accept opens the trade;
      // refuse only sysMsgs the REQUESTOR (virtual here) -> silence
      if (msg.accept === 1) startTrade();
    } else if (msg.op === 'tradeAdd') {
      // per-add echo: tradeOwn to the offerer (M12). Aria answers the
      // first add with her own standing offer via tradeOther.
      if (!trade || trade.ownConfirmed) return;
      const it = items.find(i => i.objectId === msg.objectId && !i.equipped);
      if (!it) return;
      const n = Math.min(it.count, Math.max(1, msg.count | 0));
      const entry = { objectId: it.objectId, itemId: it.itemId, count: n, slot: it.slot, enchant: it.enchant };
      const have = trade.ownOffer.find(e => e.objectId === entry.objectId);
      if (have) have.count += n;
      else trade.ownOffer.push(entry);
      send('tradeOwn', { items: [entry] });
      if (!trade.ariaOffered) {
        trade.ariaOffered = true;
        timers.push(setTimeout(() => {
          if (trade) send('tradeOther', { items: [{ ...ARIA_OFFER }] });
        }, 400));
      }
    } else if (msg.op === 'tradeDone') {
      // TWO-PHASE (M12): this only marks our side — Aria confirms 500 ms
      // later and the exchange runs (invUpdate + tradeEnd{done})
      if (!trade || trade.ownConfirmed) return;
      trade.ownConfirmed = true;
      timers.push(setTimeout(finishTrade, 1500));
    } else if (msg.op === 'tradeCancel') {
      // cancel hits BOTH parties; offered items never move (M12)
      if (!trade) return;
      trade = null;
      send('tradeEnd', { reason: 'cancel' });
    }
  });

  ws.on('close', () => {
    timers.forEach(clearInterval);
    console.log(`- connection closed (player ${self.id})`);
  });
});
