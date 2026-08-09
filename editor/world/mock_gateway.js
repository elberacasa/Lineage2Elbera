// M2 mock gateway — implements the frozen browser<->gateway JSON contract
// so the web client can be verified before the real gateway lands.
//
//   node mock_gateway.js [port]        (default 8085)
//
// Behavior per connection:
//   login{deviceId}   -> auth_ok{chars:[one char]}
//   login{deviceId:'multi*'} -> auth_ok{chars:[TWO chars]} — char-select
//                        fixture: Sylva (slot 0, Elf Mystic, lv 20) and
//                        Dorn (slot 1, Dwarf Fighter, lv 12); a createChar
//                        appends a third; enterChar{slot} enters the
//                        CLICKED char, not always slot 0
//   login{...,noAutoCreate:true} -> auth_ok{chars:[]} until a createChar
//                        succeeds (bridge login-flag parity: the browser
//                        then drives character creation itself)
//   createChar{name,race,sex,classId,hairStyle,hairColor,face}
//                     -> lightly validated (name regex, base classIds,
//                        fixture players' names are "taken"); success:
//                        charCreateOk + refreshed auth_ok{chars:[created]}
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
//                      ticks; gremlin dies -> die + addDrop (adena next to
//                      the corpse) + exp gain, revives 6 s later (revive +
//                      full status); target on the corpse = loot pickup
//                      (invUpdate + sysMsg 28 + remove of the drop)
//   say "/die"      -> selfStatus hp 0 + die{id:<self>,canRespawn:true}
//                      (death overlay test, mirrors the real bridge)
//   say "/revive"   -> selfStatus full (overlay clears)
//   respawn{}       -> revive{id:<self>} + selfStatus full (the aCis
//                      RequestRestartPoint answer: doRevive + teleport)
//   selfStatus      -> sent once after enterChar
// M4 ops emitted by the mock:
//   enterChar   -> skillList + itemList (after enterWorld/selfStatus)
//   useSkill    -> skillCast(hitTime 1500) -> skillLaunch; gremlin hit if
//                  it is the target; gremlin also casts back periodically
//   useItem     -> sysMsg + invUpdate (decrement/remove consumable)
//   action      -> sysMsg; ids 2..13 also echo socialAction (bridge routing)
//                  for self AND Aria (remote-player emote fixture)
//   buffs       <- 3 timed effects + 1 toggle (Relax 226, a REAL toggle per
//                  skilltypes.json) at enterChar; buffUpdate removes the
//                  short one at +12s; casting Relax toggles its buff off/on
//   skillCoolTime <- login snapshot at enterChar. The code sends reuse 600 /
//                  remaining 300 SECONDS (deliberately long, so a suite can
//                  observe the 50% sweep whenever it gets there); this header
//                  used to claim "10s reuse, 5s left", which is 60x off and
//                  never matched the payload. useSkill's skillCast carries
//                  reuse in ms (aCis sends no SkillCoolTime on cast — the
//                  reuse rides inside MagicSkillUse, confirmed live in
//                  gateway/test/capture-skills.js)
//   questList   <- sent at enterChar (Q1 cond1 + Q6 cond3, REAL names)
//   questAbort  -> removes the quest and re-sends questList (server push)
//   partyAsk    <- incoming invite (Aria), ON DEMAND via say "/partyask"
//   partyAnswer -> accept forms a 2-member party + status tick
//   partyInvite -> snapshot with SELF leader; partyKick/partyLeave ->
//   updated snapshots (party of one disbands, like aCis)
//   clanInfo/clanMembers <- clan at login (ElberaGuard, led by Aria)
//   clanAsk     <- incoming invite (Aria), ON DEMAND via say "/clanask"
//   clanAnswer/clanLeave/clanOust/clanInvite -> full snapshots back
//   (clanLeave mirrors the bridge's clanDeleteAll: id:0 + empty list)
//   buyList     <- on bypass npc_buy; sellList <- npc_sell and after a
//                  sale; buy/sell validated, results via invUpdate only
//   multisellList <- on bypass npc_multisell (M15: 2-entry exchange
//                  fixture, one entry missing ingredients on purpose);
//                  multisellChoose validated, invUpdate + sysMsg 53/123,
//                  then the list is re-sent (refresh), like aCis
//   loot{id}    -> invUpdate add (adena) + sysMsg, only for dead mobs
// M17 tutorial (mirrors the real bridge's tutorial forwarding):
//   enterChar   -> tutorial page as npcHtml after ~1.5s, ONLY for deviceIds
//                  starting with 'tut' (aCis TutorialShowHtml fires only for
//                  a genuinely new char's first EnterWorld, 10s QT timer
//                  compressed; the link arrives ALREADY rewritten to
//                  "bypass -h TE02", exactly what the real bridge emits)
//   bypass TE02 -> second tutorial page (Movement) as npcHtml
//   bypass TE00 -> tutorialHtmlClose (aCis TutorialCloseHtml)
// M16 warehouse (Wilford 70008, npcId 30005):
//   talk -> keeper html with real npc_70008_DepositP/WithdrawP links
//   bypass DepositP -> whDeposit (own inventory, equipped excluded; adena
//                  is a normal itemId-57 entry); WithdrawP -> whWithdraw
//                  (warehouse contents) or sysMsg 282 when EMPTY (aCis)
//   whDepositItems -> fee 30a PER ENTRY charged from what remains after
//                  the adena deposit; stackables land under a NEW objectId
//                  (the aCis split-stack quirk); results via invUpdate only
//   whWithdrawItems -> back via invUpdate (adena/stackables merge into a
//                  carried stack, the rest re-add)
//   useSkill    -> MP drops by 10 on skillLaunch (selfStatus); a useSkill
//                  with no targetId for a SELF-target skill (skillweapons.json
//                  targets) lands on the caster, not the current target
//   say "/skilldepth" -> skillList [3, 1216, 226] + Dagger equipped
//   say "/equipsword" / "/equipdagger" -> weapon swap via invUpdate
//   say "/interrupt"  -> sysMsg 27 + actionFailed (cast abort fixture)
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
// M13 private stores (Borg runs the sell-store fixture):
//   storeManageSell/Buy -> storeMsgSell/storeMsgBuy (sellables/buyables
//                  from the CURRENT inventory); SILENT while sitting-and-
//                  not-in-store-mode (the aCis re-list quirk, README M13)
//   storeSetSell/Buy -> the store OPENS (no start op exists): changeWait
//                  {self, sit} + storeState{open:true,type}
//   storeStop    -> storeState{open:false}; NO changeWait (the player
//                  stays sitting — the quirk)
//   action{0}    -> sit/stand toggle: changeWait{self, waitType}
//   talk Borg (80002) -> playerStore of his sell store; a stopped store
//                  answers with NOTHING (M13)
//   storeBuy     -> validated against Borg's list (price must match);
//                  item + adena move via invUpdate only; sell-out
//                  auto-closes the store (talk then yields nothing)
//   say "/storeoffline" -> offline-trader fixture: Borg's store (re)opens
//                  in PERSISTENT mode — it keeps serving playerStore views
//                  and buys even after sell-out (the mock cannot disconnect
//                  a virtual owner; persistence of the STORE is the part
//                  the client can observe, so that is what is modeled)
// Remote-anim fixtures at enterChar: changeWait{Borg,sit} + changeMove
// {Cora,running}.
//
// Coordinates are L2 world units. Tile 17_24 center: origin
// [-98304, 196608] + 127.5*128 = (-81984, 212928).

const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/ws');

// aCis target routing (skillweapons.json targets map, tier 4): a useSkill
// that carries no targetId for a SELF-target skill lands on the caster,
// not on the current target
let SKILL_TARGETS = {};
try {
  SKILL_TARGETS = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../assets/gamedata/skillweapons.json'), 'utf8')).targets || {};
} catch { /* metadata absent: fall back to lastTarget routing */ }

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
  // M16: warehouse keeper (real npcId 30005, TI town) — his html offers the
  // retail DepositP/WithdrawP bypasses that open whDeposit/whWithdraw
  { id: 70008, npcId: 30005, name: 'Wilford', x: SPAWN.x + 500, y: SPAWN.y + 500, z: SPAWN.z, heading: 0 },
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

// M13: Borg (80002) is the sitting fixture (changeWait at enterChar) and
// runs a private sell store. Entries mirror PrivateStoreListSell: price is
// the store price, storePrice the reference price.
function freshBorgStore() {
  return {
    type: 'sell', title: "Borg's goods",
    items: [
      { objectId: 95011, itemId: 2509, count: 1, enchant: 0, price: 400, storePrice: 1500 },
      { objectId: 95012, itemId: 1060, count: 3, enchant: 0, price: 120, storePrice: 250 },
    ],
  };
}
// viewer level: seedable for con-color tests (default 1; MOCK_LEVEL=40
// makes target_ok.color strongly negative vs level-1 gremlins)
const SELF_LEVEL = Number(process.env.MOCK_LEVEL) || 1;

const SELF_BASE = {
  hp: 800, maxHp: 800, mp: 200, maxMp: 200,
  cp: 400, maxCp: 400, level: SELF_LEVEL, exp: 0, sp: 0,
};

let nextPlayerId = 1000001;
const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });

// A PORT COLLISION USED TO BE SILENT. With no 'error' listener the underlying
// http server emits EADDRINUSE, EventEmitter turns an unhandled 'error' into a
// throw, and the process died writing a stack trace nobody read (the battery
// redirected it, and verify_targetwnd spawned with stdio 'ignore'). Every suite
// that then connected to that port reached the OTHER, already-running mock —
// possibly seeded with a different MOCK_LEVEL — and measured the wrong thing
// while reporting PASS. Fail loudly and with a distinct exit code instead.
wss.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`mock_gateway: port ${PORT} is already in use — refusing to `
      + 'start. Something else is serving this port; a suite that connects to '
      + 'it would silently talk to the wrong mock.');
    process.exit(98);
  }
  console.error(`mock_gateway: server error on :${PORT}: ${err && err.stack || err}`);
  process.exit(99);
});

wss.on('listening', () => {
  console.log(`mock gateway on ws://127.0.0.1:${PORT}`);
});

wss.on('connection', (ws) => {
  const timers = [];
  const self = { id: nextPlayerId++, name: `WebTester${Math.floor(Math.random() * 900 + 100)}` };
  const selfStats = { ...SELF_BASE };
  const items = [];
  const quests = [];
  let party = [];
  // M14 clan fixture: an existing clan at login (self a rank-and-file
  // member — Leave enabled, no oust marks), restored on clanAnswer accept.
  let clan = null;
  // character-creation fixture: set by a successful createChar (the
  // account's only char from then on; null = legacy fixture char)
  let createdChar = null;
  // char-select fixture: deviceId starting with 'multi' logs into a
  // TWO-char account (names distinct from the fixture players Aria/Borg/
  // Cora so the taken-name check and the world fixtures stay unambiguous);
  // a successful createChar appends a third. null = single-char account.
  let accountChars = null;
  // M17 tutorial fixture gating: the real aCis only sends TutorialShowHtml
  // for a genuinely NEW char's first EnterWorld — firing it for every
  // suite login broke verify_dialog (unsolicited npcHtml). Only deviceIds
  // starting with 'tut' get the tutorial page (verify-tutorial uses one).
  let loginDeviceId = '';
  let partyTick = null;
  // M12 trade state (virtual partner Aria): null = no active trade
  let trade = null;
  let nextBoughtId = 1;
  let lastTarget = null;
  let relaxOn = false;   // Relax (226) toggle state — see the useSkill handler
  let lootCounter = 0;
  let combatTimer = null;
  // M13 private-store state: own store (null = closed), the sit/stand
  // toggle the aCis re-list quirk hinges on, and Borg's sell-store fixture
  let selfSitting = false;
  let store = null;
  let storeTitlePending = '';
  let borgStore = freshBorgStore();
  let borgOffline = false;
  // M16 warehouse state (private): entries {objectId, itemId, count,
  // enchant}; stackables get a NEW objectId across the transfer (the aCis
  // quirk, gateway README M16)
  let warehouse = [];
  const WH_STACKABLES = new Set([57, 1060, 1835, 2509, 734, 1147]);
  const WH_FEE = 30;   // per entry (WarehouseWnd.uc KEEPING_PRICE / aCis)
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

  // M15 multisell: the exchange fixture. Entry 1 (Ring of Knowledge for
  // Squire's Pants + 200a) is affordable several times over -> the amount
  // prompt; entry 2 needs the (equipped-only) Squire's Sword + 5000a ->
  // missing ingredients, so the client must gray it out and refuse clicks.
  // aCis pre-filters the prepared list (inventoryOnly) — the mock sends
  // entry 2 anyway to exercise the DEFENSIVE graying the contract asks
  // for. listId 47667 is the REAL Java String.hashCode of "003" (the
  // newbie exchange list); entryIds are 1-based, passed back verbatim.
  const MULTISELL_LIST_ID = 47667;
  const MULTISELL_ENTRIES = [
    {
      entryId: 1,
      products: [{ itemId: 875, count: 1, enchant: 0 }],
      ingredients: [{ itemId: 1147, count: 1, enchant: 0 }, { itemId: 57, count: 200, enchant: 0 }],
    },
    {
      entryId: 2,
      products: [{ itemId: 906, count: 1, enchant: 0 }],
      ingredients: [{ itemId: 2369, count: 1, enchant: 3 }, { itemId: 57, count: 5000, enchant: 0 }],
    },
  ];
  const sendMultiSellList = () => {
    send('multisellList', { listId: MULTISELL_LIST_ID, items: MULTISELL_ENTRIES.map(e => ({ ...e })) });
  };
  // owned = unequipped stacks only (aCis inventoryOnly skips equipped gear)
  const ownedCount = (itemId) =>
    items.filter(i => i.itemId === itemId && !i.equipped).reduce((s, i) => s + i.count, 0);

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

  // Attack timing, so the offline path exercises the same fields the real
  // bridge sends. Values are the ones OBSERVED live against aCis
  // (gateway/test/verify-atkspeed.js): self pAtkSpd 416 / atkSpdMul 1.5253,
  // Gremlin (npcId 18342) pAtkSpd 272 / atkSpdMul 1.2093 — not invented.
  const SELF_PATK_SPD = 416;
  const SELF_ATK_SPD_MUL = 1.525333285331726;
  const MOB_PATK_SPD = 272;
  const MOB_ATK_SPD_MUL = 1.2092797756195068;
  // Formulas.calculateTimeBetweenAttacks; the default (non-bow, non-dual)
  // CreatureAttack branch applies its single hit at timeAtk / 2.
  const timeAtk = (spd) => Math.max(100, Math.floor(500000 / spd));
  const meleeHitDelay = (spd) => Math.floor(timeAtk(spd) / 2);

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
      send('attack', { id: self.id, targetId: mobId, damage, critical, miss,
        shield: false, soulshot: false, hitIndex: 0, hitCount: 1,
        attackType: 'SWORD', hitDelay: meleeHitDelay(SELF_PATK_SPD) });
      if (!miss) mob.hp = Math.max(0, mob.hp - damage);
      send('status', { id: mobId, hp: mob.hp, maxHp: mob.maxHp });
      // gremlin counters every other tick; keeps player hp above ~30%
      if (tick % 2 === 0 && !mob.dead) {
        const md = 8 + Math.round(Math.random() * 8);
        send('attack', { id: mobId, targetId: self.id, damage: md, critical: false, miss: false,
          shield: false, soulshot: false, hitIndex: 0, hitCount: 1,
          attackType: 'NONE', hitDelay: meleeHitDelay(MOB_PATK_SPD) });
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
        // ground drop next to the corpse (mirrors aCis SpawnItem + the
        // bridge's addDrop op); consumed by the loot pickup in 'target'
        const npcDef = NPCS.find(n => n.id === mobId);
        mob.dropId = 95000 + Number(mobId) % 1000;
        send('addDrop', { id: mob.dropId, itemId: 57, count: 23,
          x: (npcDef ? npcDef.x : 0) + 40, y: (npcDef ? npcDef.y : 0) + 40, z: npcDef ? npcDef.z : 0 });
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

  // equip-swap helper for the skill-depth fixtures: unequip whatever sits
  // in the right hand (slot bit 0x0080) and equip itemId, all via invUpdate
  const WEAPON_FIXTURES = {
    10: { objectId: 90401, itemId: 10, count: 1, slot: 128, equipped: 1, enchant: 0 },
    2369: { objectId: 90003, itemId: 2369, count: 1, slot: 128, equipped: 1, enchant: 3 },
  };
  const swapWeapon = (itemId) => {
    const updated = [];
    for (const it of items) {
      if (it.equipped && (it.slot & 128) && it.itemId !== itemId) {
        it.equipped = 0;
        updated.push({ change: 'modify', ...it });
      }
    }
    let w = items.find(i => i.itemId === itemId);
    if (!w) {
      w = { ...WEAPON_FIXTURES[itemId] };
      items.push(w);
      updated.push({ change: 'add', ...w });
    } else if (!w.equipped) {
      w.equipped = 1;
      updated.push({ change: 'modify', ...w });
    }
    if (updated.length) send('invUpdate', { updated });
  };

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    console.log('  <-', JSON.stringify(msg));

    if (msg.op === 'login') {
      loginDeviceId = String(msg.deviceId || '');
      // multi-char account fixture: seed once per connection
      if (accountChars === null && /^multi/i.test(loginDeviceId)) {
        accountChars = [
          { slot: 0, name: 'Sylva', race: 'Elf', classId: 25, sex: 1, level: 20, hairStyle: 1, hairColor: 0, face: 2 },
          { slot: 1, name: 'Dorn', race: 'Dwarf', classId: 53, sex: 0, level: 12, hairStyle: 0, hairColor: 1, face: 0 },
        ];
      }
      // login{noAutoCreate:true} (the world client): skip the legacy
      // auto-create — the account stays empty until createChar succeeds
      if (accountChars) {
        send('auth_ok', { chars: accountChars });
      } else if (msg.noAutoCreate && !createdChar) {
        send('auth_ok', { chars: [] });
      } else {
        send('auth_ok', {
          chars: [createdChar || { slot: 0, name: self.name, race: 'Human', classId: 0 }],
        });
      }
    } else if (msg.op === 'createChar') {
      // Light parity with the bridge's gateway-side validation (which
      // checks EVERY field — gateway/src/bridge.js): the mock checks the
      // name and classId, and treats the fixture characters' names as
      // taken so the charCreateFail path is exercisable.
      const CLASS_RACE = {
        0: 'Human', 10: 'Human', 18: 'Elf', 25: 'Elf', 31: 'DarkElf',
        38: 'DarkElf', 44: 'Orc', 49: 'Orc', 53: 'Dwarf',
      };
      const name = String(msg.name || '');
      const race = CLASS_RACE[msg.classId | 0];
      const taken = [self.name, ...PLAYERS.map(p => p.name), WALKER.name];
      if (!/^[A-Za-z0-9]{1,16}$/.test(name)) {
        send('charCreateFail', { reason: 'invalid_name' });
      } else if (!race) {
        send('charCreateFail', { reason: 'invalid_classId' });
      } else if (taken.includes(name)) {
        send('charCreateFail', { reason: 'name_already_exists', code: 2 });
      } else {
        createdChar = {
          slot: accountChars ? accountChars.length : 0,
          name, race, classId: msg.classId | 0, sex: msg.sex | 0,
          level: 1,
          hairStyle: msg.hairStyle | 0, hairColor: msg.hairColor | 0, face: msg.face | 0,
        };
        if (accountChars) accountChars.push(createdChar);
        send('charCreateOk');
        send('auth_ok', { chars: accountChars || [createdChar] });
      }
    } else if (msg.op === 'enterChar') {
      // multi-char accounts: enter the CLICKED slot (single-char accounts
      // keep the legacy createdChar/self fallback, slot ignored)
      const chosen = accountChars
        ? (accountChars.find(c => c.slot === (msg.slot | 0)) || accountChars[0])
        : createdChar;
      send('enterWorld', {
        char: {
          id: self.id,
          name: chosen ? chosen.name : self.name,
          race: chosen ? chosen.race : 'Human',
          classId: chosen ? chosen.classId : 0,
          // bridge parity (2026-08-03): appearance fields ride enterWorld
          sex: chosen ? (chosen.sex | 0) : 0,
          hairStyle: chosen ? (chosen.hairStyle | 0) : 0,
          hairColor: chosen ? (chosen.hairColor | 0) : 0,
          face: chosen ? (chosen.face | 0) : 0,
          x: SPAWN.x, y: SPAWN.y, z: SPAWN.z, heading: 32768,
        },
      });
      // pAtkSpd/atkSpdMul ride NpcInfo on the real bridge. Values are the
      // ones observed live for the tutorial Gremlin (npcId 18342, datapack
      // atkSpd 247.42 -> pAtkSpd 272, multiplier 1.2093); the mock's npcIds
      // are placeholders, the timing fields are not invented.
      for (const n of NPCS) {
        send('addNpc', { ...n, pAtkSpd: 272, mAtkSpd: 333, atkSpdMul: 1.2092797756195068, rhand: 0 });
      }
      for (const p of PLAYERS) send('addPlayer', p);
      send('addPlayer', WALKER);
      send('selfStatus', selfStats);

      // M4: skills + inventory snapshots. Same per-skill shape as the real
      // bridge (gateway/src/bridge.js): SkillList (0x58) carries `passive`
      // and `disabled` per skill; 141 Weapon Mastery is the PASSIVE fixture
      // (skilltypes.json) so the MagicSkillWnd pane split is exercisable.
      send('skillList', { skills: [
        { id: 3, level: 1, passive: false, disabled: false },
        { id: 226, level: 1, passive: false, disabled: false },
        { id: 28, level: 1, passive: false, disabled: false },
        { id: 141, level: 1, passive: true, disabled: false },
      ] });
      // type2 is Item.TYPE2_* and rides every ItemList entry on the wire:
      // 0 WEAPON, 1 SHIELD_ARMOR, 2 ACCESSORY, 3 QUEST, 4 MONEY, 5 OTHER.
      // Each value below is the one aCis computes for that exact item id —
      // Weapon.java sets TYPE2_WEAPON, Armor.java TYPE2_SHIELD_ARMOR, and
      // EtcItem.java sets TYPE2_MONEY for adena (57), TYPE2_QUEST when
      // etcitem_type is QUEST, TYPE2_OTHER otherwise. 1001 "Book of Aklantoth
      // - Part 4" is the quest-item fixture (data/xml/items/1000-1099.xml).
      items.push(
        { objectId: 90001, itemId: 57, count: 1200, type2: 4, slot: 0, equipped: 0, enchant: 0 },
        { objectId: 90002, itemId: 1147, count: 5, type2: 1, slot: 0, equipped: 0, enchant: 0 },
        // slot is the REAL bodyPart (aCis Item.java SLOT_R_HAND = 0x0080,
        // Squire's Sword is one-handed) — the weapon gate keys off it
        { objectId: 90003, itemId: 2369, count: 1, type2: 0, slot: 128, equipped: 1, enchant: 3 },
        { objectId: 90004, itemId: 2509, count: 1, type2: 5, slot: 0, equipped: 0, enchant: 0 },
        { objectId: 90005, itemId: 1060, count: 12, type2: 5, slot: 0, equipped: 0, enchant: 0 },
        { objectId: 90006, itemId: 1835, count: 7, type2: 5, slot: 0, equipped: 0, enchant: 0 },
        { objectId: 90007, itemId: 734, count: 2, type2: 5, slot: 0, equipped: 0, enchant: 0 },
        { objectId: 90008, itemId: 1001, count: 1, type2: 3, slot: 0, equipped: 0, enchant: 0 },
      );
      send('itemList', { items });

      // M5: character sheet + welcome sysmsg + whisper demo
      send('charSheet', {
        str: 35, dex: 26, con: 32, int: 21, wit: 19, men: 25,
        pAtk: 42, pDef: 36, mAtk: 28, mDef: 31, accuracy: 33, evasion: 29,
        critical: 44,
        // The real protocol shape: UserInfo carries the BASE speeds and the
        // movement multiplier as separate fields, and the server moves at the
        // product (115 x 1.10 = 126.5 u/s, measured live against aCis in
        // gateway/test/verify-movement.js). The mock used to send a single
        // pre-multiplied 126/88, which is not a shape the client can ever see.
        runSpeed: 115, walkSpeed: 80, speedMul: 1.1,
        pAtkSpd: SELF_PATK_SPD, mAtkSpd: 213, atkSpdMul: SELF_ATK_SPD_MUL,
        running: true,
        // Both halves of the inventory weight gauge (UserInfo writes
        // getCurrentWeight() immediately before getWeightLimit()). FIXTURE
        // VALUES, like every other number in this mock — the point is that the
        // client receives both fields, not that they are this character's.
        curLoad: 3140, maxLoad: 69000,
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

      // M14: clan at login — clanInfo + clanMembers ride enterWorld like
      // the real bridge queues them. 'ElberaGuard', led by Aria: self is a
      // member (online), Aria online, Borg offline (id 0 = offline).
      clan = {
        info: { id: 4711, name: 'ElberaGuard', leaderName: 'Aria', level: 5 },
        members: [
          { id: 80001, name: 'Aria', level: 20, classId: 25, online: true },
          { id: self.id, name: self.name, level: 1, classId: 0, online: true },
          { id: 0, name: 'Borg', level: 12, classId: 7, online: false },
        ],
      };
      send('clanInfo', clan.info);
      send('clanMembers', { members: clan.members });

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
        { skillId: 226, level: 1, duration: -1 },   // Relax — a REAL toggle
                                                    // (skilltypes.json; M10: -1)
      ] });
      relaxOn = true;
      timers.push(setTimeout(() => {
        send('buffUpdate', { add: [], remove: [102] });
      }, 12000));

      // SkillCoolTime arrives at EnterWorld in aCis (login restore of
      // cooldowns in progress) — reuse + remaining in SECONDS, like M10.
      // Long times so the verify can observe the sweep any time later.
      send('skillCoolTime', { skills: [{ id: 3, level: 1, reuse: 600, remaining: 300 }] });

      // M17 tutorial fixture: a fresh char's first EnterWorld triggers the
      // aCis Tutorial script (~10s QT timer — compressed here). Content is
      // the REAL datapack page (tutorial_human_fighter001.htm) with the
      // link already rewritten to "bypass -h TE02", exactly what the real
      // bridge emits for TutorialShowHtml. Gated on a 'tut*' deviceId —
      // aCis only sends this for genuinely new chars (see loginDeviceId).
      if (/^tut/i.test(loginDeviceId)) timers.push(setTimeout(() => {
        send('npcHtml', { html:
          `<html><body>` +
          `<font color="LEVEL">Welcome to Lineage II!</font><br>` +
          `This is Cedric's Training Hall. This place is famous for producing many noted Fighters.<br>` +
          `Now, you are taking your first step to becoming a Human Fighter. First, I will explain the basic operation of the game.<br>` +
          `<table border=0 cellpadding=0 cellspacing=0><tr><td>` +
          `<a action="bypass -h TE02">If you click here, you will move to the next topic of this tutorial.</a></td>` +
          `<td valign=top></td></tr></table>` +
          `</body></html>` });
      }, 1500));

      // ambient chat
      let ci = 0;
      timers.push(setInterval(() => {
        send('chat', { from: WALKER.name, channel: 'all', text: AMBIENT[ci++ % AMBIENT.length] });
      }, 8000));
    } else if (msg.op === 'moveTo') {
      // server-authoritative echo: client reconciles its own movement.
      // MoveToLocation carries the mover's CURRENT position beside the
      // destination — the client sends its own as the packet origin, so the
      // echo mirrors it back the way aCis does.
      send('move', {
        id: self.id, tx: msg.x, ty: msg.y, tz: msg.z,
        x: msg.ox, y: msg.oy, z: msg.oz,
      });
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
      if (msg.text === '/die') {
        send('selfStatus', { ...selfStats, hp: 0 });
        // mirror the real bridge: SELF death carries the respawn capability
        send('die', { id: self.id, canRespawn: true });
      }
      if (msg.text === '/revive') send('selfStatus', selfStats);
      // M9 party fixture ON DEMAND — an unsolicited prompt would cover the
      // 3D clicks of unrelated verify suites
      if (msg.text === '/partyask' && !party.length) send('partyAsk', { from: 'Aria' });
      // M14: incoming clan invite, ON DEMAND (same reason as /partyask)
      if (msg.text === '/clanask') send('clanAsk', { from: 'Aria', clanName: 'ElberaGuard' });
      // M12: incoming trade ask, ON DEMAND (same reason as /partyask)
      if (msg.text === '/tradeask' && !trade) send('tradeAsk', { from: 'Aria' });
      // M13: offline-trader fixture, ON DEMAND — Borg's store (re)opens in
      // persistent mode (keeps serving playerStore views after sell-out)
      if (msg.text === '/storeoffline') {
        borgOffline = true;
        if (!borgStore) borgStore = freshBorgStore();
      }
      // skill-depth fixtures, ON DEMAND (verify_skilldepth):
      //   /skilldepth  -> skillList [Power Strike 3, Self Heal 1216, Relax 226]
      //                   + a Dagger (10) swaps into the right hand
      //   /equipsword  -> Squire's Sword (2369) back in, dagger out
      //   /equipdagger -> reverse
      //   /interrupt   -> cast abort: sysMsg 27 + actionFailed (aCis
      //                   CreatureCast.interrupt + PlayerCast.stop)
      if (msg.text === '/skilldepth') {
        send('skillList', { skills: [
          { id: 3, level: 1 }, { id: 1216, level: 1 }, { id: 226, level: 1 },
        ] });
        swapWeapon(10);
      }
      if (msg.text === '/equipsword') swapWeapon(2369);
      if (msg.text === '/equipdagger') swapWeapon(10);
      if (msg.text === '/interrupt') {
        send('sysMsg', { id: 27, params: [] });
        send('actionFailed');
      }
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
    } else if (msg.op === 'respawn') {
      // mirror the real bridge's RequestRestartPoint answer: revive + a
      // full selfStatus (aCis doRevive restores hp/cp; the town teleport
      // arrives as a move op — the mock keeps the player in place)
      send('revive', { id: self.id });
      send('selfStatus', selfStats);
    } else if (msg.op === 'target') {
      // loot (mirror of the real bridge: Action on a dead mob = pickup)
      const deadMob = MOBS[msg.id];
      if (deadMob && deadMob.dead) {
        lootCounter++;
        const adena = { objectId: 90100 + lootCounter, itemId: 57, count: 23, slot: 0, equipped: 0, enchant: 0 };
        items.push(adena);
        send('invUpdate', { updated: [{ change: 'add', ...adena }] });
        // sysMsg 28 = "You have obtained $s1 adena." — $s1 is the COUNT
        send('sysMsg', { id: 28, params: [23] });
        // the ground drop (if any) is consumed by the pickup
        if (deadMob.dropId) { send('remove', { id: deadMob.dropId }); deadMob.dropId = null; }
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
      // no explicit targetId: aCis routes by the skill's own target type —
      // SELF lands on the caster, anything else on the current target
      const targetId = msg.targetId
        ?? (SKILL_TARGETS[msg.skillId] === 'SELF' ? self.id : lastTarget);
      // per-cast reuse rides inside MagicSkillUse itself (aCis sends no
      // SkillCoolTime on cast; the field is MILLISECONDS)
      send('skillCast', {
        casterId: self.id, targetId, skillId: msg.skillId, level: 1, hitTime: 1500,
        reuse: 8000,
      });
      timers.push(setTimeout(() => {
        send('skillLaunch', { casterId: self.id, targetId, skillId: msg.skillId, level: 1 });
        // MP cost lands with the cast (aCis StatusUpdate on consume) —
        // the status bar must move
        selfStats.mp = Math.max(0, selfStats.mp - 10);
        send('selfStatus', selfStats);
        // Relax (226) is a TOGGLE (skilltypes.json): a second cast stops the
        // effect — aCis PlayerCast.doToggleCast ("if the toggle is already
        // active, we don't need to do anything else besides stopping it").
        if (msg.skillId === 226) {
          relaxOn = !relaxOn;
          send('buffUpdate', relaxOn
            ? { add: [{ skillId: 226, level: 1, duration: -1 }], remove: [] }
            : { add: [], remove: [226] });
        }
        const mob = MOBS[targetId];
        if (mob && !mob.dead) {
          const damage = 60 + Math.round(Math.random() * 40);
          send('attack', { id: self.id, targetId, damage, critical: false, miss: false,
            shield: false, soulshot: false, hitIndex: 0, hitCount: 1,
            attackType: 'SWORD', hitDelay: meleeHitDelay(SELF_PATK_SPD) });
          mob.hp = Math.max(0, mob.hp - damage);
          send('status', { id: targetId, hp: mob.hp, maxHp: mob.maxHp });
        }
      }, 1500));
    } else if (msg.op === 'talk') {
      // M13: clicking Borg opens his private sell store (PrivateStoreListSell
      // on interact); a stopped store answers with NOTHING (README M13)
      if (msg.id === 80002) {
        if (borgStore) {
          const adena = items.find(i => i.itemId === 57);
          send('playerStore', {
            id: 80002, type: borgStore.type, title: borgStore.title,
            adena: adena ? adena.count : 0,
            items: borgStore.items.map(i => ({ ...i })),
          });
        }
        return;
      }
      // M16: Wilford the warehouse keeper — the retail private-warehouse
      // bypasses (DepositP/WithdrawP) as real links
      if (msg.id === 70008) {
        send('npcHtml', { html:
          `<html><body><title>Warehouse Keeper Wilford</title><br><br><center>` +
          `<font color="LEVEL">Warehouse Keeper Wilford</font><br><br>` +
          `Your goods are safe with us.<br><br>` +
          `<a action="bypass -h npc_70008_DepositP">Deposit items (private warehouse)</a><br>` +
          `<a action="bypass -h npc_70008_WithdrawP">Withdraw items (private warehouse)</a><br><br>` +
          `<button value="Farewell" action="bypass -h npc_bye" width="80" height="18">` +
          `</center></body></html>` });
        return;
      }
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
        `<td><a action="bypass -h npc_shop">Buy / sell supplies</a></td></tr>` +
        `<tr><td><font color="BROWN">Exchange</font></td>` +
        `<td><a action="bypass -h npc_multisell">Exchange materials</a></td></tr></table><br>` +
        `<button value="Farewell" action="bypass -h npc_bye" width="80" height="18">` +
        `</center></body></html>` });
    } else if (msg.op === 'bypass') {
      const cmd = String(msg.command || '');
      if (/^TE\d+$/.test(cmd)) {
        // M17 tutorial links (the real bridge routes TE* to aCis
        // RequestTutorialLinkHtml -> the Tutorial script): TE00 closes the
        // window, TE02 shows the Movement page (REAL tutorial_02.htm
        // content); other TE codes are out of fixture scope (retail silence)
        if (cmd === 'TE00') send('tutorialHtmlClose');
        else if (cmd === 'TE02') {
          send('npcHtml', { html:
            `<html><body>` +
            `<center><font color="LEVEL">[Movement]</font></center><br>` +
            `Move your mouse cursor to the spot to which you want to move and ` +
            `<font color="FF0000">left-click</font>. Then, you will be moved to that location.<br>` +
            `<a action="bypass -h TE07">Exit the Tutorial</a>` +
            `</body></html>` });
        }
        return;
      }
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
      } else if (cmd === 'npc_multisell') {
        // the merchant bypass drives the exchange server-side — the list
        // IS the window opener (nothing client-side to request it with)
        sendMultiSellList();
      } else if (/^npc_\d+_DepositP$/.test(cmd)) {
        // M16: WarehouseDepositList — own inventory, deposit-eligible
        // (equipped excluded); adena is a NORMAL entry (itemId 57)
        const adena = items.find(i => i.itemId === 57);
        send('whDeposit', {
          whType: 1, adena: adena ? adena.count : 0,
          items: items.filter(i => !i.equipped).map(i => ({
            objectId: i.objectId, itemId: i.itemId, count: i.count, enchant: i.enchant,
          })),
        });
      } else if (/^npc_\d+_WithdrawP$/.test(cmd)) {
        // M16: an EMPTY warehouse answers with sysMsg 282 only — no 0x42
        const adena = items.find(i => i.itemId === 57);
        if (!warehouse.length) send('sysMsg', { id: 282, params: [] });
        else {
          send('whWithdraw', {
            whType: 1, adena: adena ? adena.count : 0,
            items: warehouse.map(i => ({ ...i })),
          });
        }
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
      // M13: id 0 is the server-side sit/stand toggle (aCis RequestActionUse)
      if ((msg.actionId | 0) === 0) {
        selfSitting = !selfSitting;
        send('changeWait', { id: self.id, waitType: selfSitting ? 0 : 1 });
      }
    } else if (msg.op === 'storeManageSell') {
      // aCis quirk (README M13): sitting-and-not-in-store-mode SILENTLY
      // refuses (canOpenPrivateStore, no sysMsg) — the client must stand first
      if (selfSitting && !store) return;
      const adena = items.find(i => i.itemId === 57);
      send('storeMsgSell', {
        packageSale: false,
        adena: adena ? adena.count : 0,
        items: store && store.type === 'sell' ? store.items.map(i => ({ ...i })) : [],
        sellables: items.filter(i => !i.equipped && i.itemId !== 57).map(i => ({
          objectId: i.objectId, itemId: i.itemId, count: i.count,
          enchant: i.enchant, slot: i.slot,
          price: SELL_PRICES[i.itemId] || 10,
          storePrice: SELL_PRICES[i.itemId] || 10,
        })),
      });
    } else if (msg.op === 'storeManageBuy') {
      if (selfSitting && !store) return;
      const adena = items.find(i => i.itemId === 57);
      // buyables = owned reference items, one per itemId (PrivateStoreManageListBuy)
      const seen = new Set();
      send('storeMsgBuy', {
        adena: adena ? adena.count : 0,
        items: store && store.type === 'buy' ? store.items.map(i => ({ ...i })) : [],
        buyables: items.filter(i => !i.equipped && i.itemId !== 57
          && !seen.has(i.itemId) && seen.add(i.itemId)).map(i => ({
          itemId: i.itemId, enchant: i.enchant, count: i.count, slot: i.slot,
          price: SELL_PRICES[i.itemId] || 10,
          storePrice: SELL_PRICES[i.itemId] || 10,
        })),
      });
    } else if (msg.op === 'storeTitle') {
      // routed by the last manage type server-side; rides the next storeSet*
      storeTitlePending = String(msg.title || '').slice(0, 29);
    } else if (msg.op === 'storeSetSell') {
      // SetPrivateStoreListSell IS the store start (README M13 — no start op)
      if (store) return;   // already running: aCis refuses silently
      const clean = [];
      for (const s of msg.items || []) {
        const it = items.find(i => i.objectId === s.objectId);
        if (!it) continue;
        const n = Math.min(it.count, Math.max(1, s.count | 0));
        clean.push({
          objectId: it.objectId, itemId: it.itemId, count: n,
          enchant: it.enchant, price: Math.max(0, s.price | 0),
        });
      }
      if (!clean.length) return;
      store = { type: 'sell', title: String(msg.title ?? storeTitlePending).slice(0, 29), items: clean };
      selfSitting = true;   // sitDown() + broadcastUserInfo server-side
      send('changeWait', { id: self.id, waitType: 0 });
      send('storeState', { open: true, type: 'sell' });
      send('sysMsg', { id: 46, params: [`private store open: ${store.title}`] });
    } else if (msg.op === 'storeSetBuy') {
      if (store) return;
      const clean = [];
      for (const s of msg.items || []) {
        // canPassBuyProcess requires OWNING a reference item of the type
        if (!items.some(i => i.itemId === s.itemId)) continue;
        clean.push({
          itemId: s.itemId, count: Math.max(1, s.count | 0),
          enchant: 0, price: Math.max(0, s.price | 0),
        });
      }
      if (!clean.length) return;
      store = { type: 'buy', title: String(msg.title ?? storeTitlePending).slice(0, 29), items: clean };
      selfSitting = true;
      send('changeWait', { id: self.id, waitType: 0 });
      send('storeState', { open: true, type: 'buy' });
      send('sysMsg', { id: 46, params: [`private buy-store open: ${store.title}`] });
    } else if (msg.op === 'storeStop') {
      if (!store) return;
      store = null;
      // the quirk (README M13): NO changeWait — the player stays SITTING
      send('storeState', { open: false });
    } else if (msg.op === 'storeBuy') {
      // buy FROM Borg's sell-store. The price MUST match the store's (the
      // real bridge fills it from its playerStore cache); the mock resolves
      // the same way and fails silently on unknown entries (aCis behavior)
      if ((msg.storeId | 0) !== 80002 || !borgStore) return;
      const adena = items.find(i => i.itemId === 57);
      let total = 0;
      const clean = [];
      for (const b of msg.items || []) {
        const s = borgStore.items.find(i => i.objectId === b.objectId);
        if (!s) continue;
        const n = Math.min(s.count, Math.max(1, b.count | 0));
        total += s.price * n;
        clean.push({ s, n });
      }
      if (!clean.length) return;
      if (!adena || adena.count < total) {
        send('sysMsg', { id: 279, params: ['not enough adena'] });
        return;
      }
      adena.count -= total;
      send('invUpdate', { updated: [{ change: 'modify', ...adena }] });
      for (const { s, n } of clean) {
        s.count -= n;
        const have = items.find(i => i.itemId === s.itemId && !i.equipped && i.itemId !== 57);
        if (have) {
          have.count += n;
          send('invUpdate', { updated: [{ change: 'modify', ...have }] });
        } else {
          const it = { objectId: 90300 + (nextBoughtId++), itemId: s.itemId, count: n, slot: 0, equipped: 0, enchant: s.enchant || 0 };
          items.push(it);
          send('invUpdate', { updated: [{ change: 'add', ...it }] });
        }
      }
      send('sysMsg', { id: 46, params: [`bought ${clean.length} item(s) from Borg`] });
      borgStore.items = borgStore.items.filter(i => i.count > 0);
      // sell-out auto-closes the store (README M13) — unless the offline
      // fixture keeps it alive (see '/storeoffline')
      if (!borgStore.items.length && !borgOffline) borgStore = null;
      else if (borgOffline) {
        // persistent stand-in: the offline trader's stock does not deplete
        borgStore = freshBorgStore();
      }
    } else if (msg.op === 'storeSell') {
      // Borg runs no buy-store fixture: aCis fails silently on an
      // unresolvable sell — nothing moves, nothing is said
      return;
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
    } else if (msg.op === 'clanAnswer') {
      // accept re-joins the fixture clan (full clanInfo + members snapshot,
      // like PledgeShowMemberListAll); refuse: retail silence
      if (msg.accept === 1 && clan) {
        send('clanInfo', clan.info);
        send('clanMembers', { members: clan.members });
      }
    } else if (msg.op === 'clanLeave') {
      // the bridge's clanDeleteAll: clanInfo{id:0} + an empty member list;
      // the fixture itself keeps its members so a re-join restores fully
      send('clanInfo', { id: 0 });
      send('clanMembers', { members: [] });
    } else if (msg.op === 'clanOust') {
      if (clan) {
        clan.members = clan.members.filter(m => m.name !== msg.name);
        send('clanMembers', { members: clan.members });
      }
    } else if (msg.op === 'clanInvite') {
      // the invitee accepts -> they appear in the next full snapshot
      if (clan && !clan.members.some(m => m.name === msg.name)) {
        clan.members.push({ id: 80002, name: String(msg.name || '?'), level: 9, classId: 18, online: true });
        send('clanMembers', { members: clan.members });
      }
    } else if (msg.op === 'multisellChoose') {
      // validated against the fixture list (a listId mismatch nukes it
      // silently, like aCis dropping the prepared list); results arrive
      // via invUpdate + sysMsg, then the list is RE-SENT (aCis re-sends
      // after an exchange — the client must treat it as a refresh)
      if ((msg.listId | 0) !== MULTISELL_LIST_ID) return;
      const entry = MULTISELL_ENTRIES.find(e => e.entryId === (msg.entryId | 0));
      if (!entry) return;
      const amount = Math.max(1, Math.min(9999, msg.count | 0 || 1));
      for (const ing of entry.ingredients) {
        if (ownedCount(ing.itemId) < ing.count * amount) {
          send('sysMsg', { id: 351, params: [] });   // NOT_ENOUGH_ITEMS
          return;
        }
      }
      for (const ing of entry.ingredients) {
        let need = ing.count * amount;
        for (const it of items.filter(i => i.itemId === ing.itemId && !i.equipped)) {
          if (need <= 0) break;
          const take = Math.min(it.count, need);
          it.count -= take;
          need -= take;
          if (it.count <= 0) {
            items.splice(items.indexOf(it), 1);
            send('invUpdate', { updated: [{ change: 'remove', objectId: it.objectId, itemId: it.itemId }] });
          } else {
            send('invUpdate', { updated: [{ change: 'modify', ...it }] });
          }
        }
      }
      for (const p of entry.products) {
        const have = items.find(i => i.itemId === p.itemId && !i.equipped);
        if (have) {
          have.count += p.count * amount;
          send('invUpdate', { updated: [{ change: 'modify', ...have }] });
        } else {
          const it = { objectId: 90600 + (nextBoughtId++), itemId: p.itemId, count: p.count * amount, slot: 0, equipped: 0, enchant: p.enchant || 0 };
          items.push(it);
          send('invUpdate', { updated: [{ change: 'add', ...it }] });
        }
        send('sysMsg', { id: 53, params: [`item:${p.itemId}`, p.count * amount] });
      }
      send('sysMsg', { id: 123, params: [] });   // SUCCESSFULLY_TRADED_WITH_NPC
      sendMultiSellList();
    } else if (msg.op === 'whDepositItems') {
      // M16: validated against the CURRENT inventory (objectIds from the
      // last whDeposit list); FEE 30 adena PER ENTRY, charged from what
      // remains AFTER the adena deposit (SendWarehouseDepositList); results
      // via invUpdate only. Stackables land in the warehouse under a NEW
      // objectId (the aCis split-stack quirk).
      const adena = items.find(i => i.itemId === 57);
      const entries = [];
      for (const d of msg.items || []) {
        const it = items.find(i => i.objectId === d.objectId && !i.equipped);
        if (!it) continue;
        const n = Math.min(it.count, Math.max(1, d.count | 0));
        if (n) entries.push({ it, n });
      }
      if (!entries.length) return;
      const fee = WH_FEE * entries.length;
      const depAdena = entries.filter(e => e.it.itemId === 57).reduce((s, e) => s + e.n, 0);
      if (!adena || adena.count - depAdena < fee) {
        send('sysMsg', { id: 279, params: ['not enough adena'] });
        return;
      }
      if (depAdena || fee) {
        adena.count -= depAdena + fee;
        send('invUpdate', { updated: [{ change: 'modify', ...adena }] });
      }
      for (const { it, n } of entries) {
        if (it.itemId === 57) {
          const have = warehouse.find(w => w.itemId === 57);
          if (have) have.count += n;
          else warehouse.push({ objectId: 91000 + (nextBoughtId++), itemId: 57, count: n, enchant: 0 });
          continue;
        }
        it.count -= n;
        if (it.count <= 0) {
          items.splice(items.indexOf(it), 1);
          send('invUpdate', { updated: [{ change: 'remove', objectId: it.objectId, itemId: it.itemId }] });
        } else {
          send('invUpdate', { updated: [{ change: 'modify', ...it }] });
        }
        const stackable = WH_STACKABLES.has(it.itemId);
        const have = stackable && warehouse.find(w => w.itemId === it.itemId);
        if (have) have.count += n;
        else {
          warehouse.push({
            objectId: stackable ? 91000 + (nextBoughtId++) : it.objectId,
            itemId: it.itemId, count: n, enchant: it.enchant,
          });
        }
      }
    } else if (msg.op === 'whWithdrawItems') {
      // M16: objectIds from the last whWithdraw list; back into the
      // inventory via invUpdate only (adena/stackables merge into a carried
      // stack, the rest re-add with their warehouse objectId)
      const entries = [];
      for (const w of msg.items || []) {
        const it = warehouse.find(i => i.objectId === w.objectId);
        if (!it) continue;
        const n = Math.min(it.count, Math.max(1, w.count | 0));
        if (n) entries.push({ it, n });
      }
      if (!entries.length) return;
      for (const { it, n } of entries) {
        it.count -= n;
        if (it.count <= 0) warehouse.splice(warehouse.indexOf(it), 1);
        const stackable = WH_STACKABLES.has(it.itemId);
        const have = stackable && items.find(i => i.itemId === it.itemId && !i.equipped);
        if (have) {
          have.count += n;
          send('invUpdate', { updated: [{ change: 'modify', ...have }] });
        } else {
          const back = { objectId: it.objectId, itemId: it.itemId, count: n, slot: 0, equipped: 0, enchant: it.enchant };
          items.push(back);
          send('invUpdate', { updated: [{ change: 'add', ...back }] });
        }
      }
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
