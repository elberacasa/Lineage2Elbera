// Ops task: in-game verification of the custom L2Vzla server mods through
// the real protocol. No GM console, no DB edits.
//  Part A (WS bridge client): .menu, .autoloot, .expon/.expoff.
//  Part B (direct GameSession, same protocol stack + governor): .offline
//    with and without a private store + offline-trader visibility + restore.
'use strict';

const WebSocket = require('ws');
const fs = require('fs');
const { login } = require('../src/loginclient.js');
const { GameSession } = require('../src/gameclient.js');
const { deriveCredentials } = require('../src/bridge.js');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const suffix = process.argv[2] || String(Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VERDICT = {};

const waitFor = (fn, timeout, label) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const v = fn();
    if (v) { clearInterval(iv); resolve(v); }
    else if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error('timeout: ' + label)); }
  }, 250);
});

// ---------------------------------------------------------------- Part A

async function partA() {
  console.log('===== PART A: .menu / .autoloot / .expon / .expoff (WS bridge) =====');
  const logSizeBefore = fs.statSync('gateway.log').size;
  const R = {
    me: null, exp: 0, npcs: [], drops: [], invAdds: [], diedIds: new Set(),
    sysTexts: [], moves: new Map(), removedIds: new Set(),
  };
  const ws = new WebSocket(url);
  ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1); });
  ws.on('open', () => ws.send(JSON.stringify({ op: 'login', deviceId: 'verify-mods-A-' + suffix })));
  ws.on('message', async (d) => {
    const m = JSON.parse(d);
    switch (m.op) {
      case 'auth_ok': await sleep(400); ws.send(JSON.stringify({ op: 'enterChar', slot: 0 })); break;
      case 'enterWorld': R.me = m.char; break;
      case 'selfStatus': R.exp = m.exp; break;
      case 'addNpc': R.npcs.push(m); break;
      case 'addDrop': R.drops.push(m); break;
      case 'invUpdate': R.invAdds.push(...m.updated.filter((u) => u.change === 'add' || u.change === 'modify')); break;
      case 'die': R.diedIds.add(m.id); break;
      case 'remove': R.removedIds.add(m.id); break;
      case 'move': if (m.id) R.moves.set(m.id, { x: m.tx, y: m.ty, z: m.tz }); break;
      case 'sysMsg': if (typeof m.params[0] === 'string') R.sysTexts.push(m.params[0]); break;
    }
  });
  const send = (o) => ws.send(JSON.stringify(o));

  await waitFor(() => R.me, 60000, 'enterWorld');
  await sleep(3000); // npc stream
  console.log('in world as', R.me.name);

  const killGremlin = async (label) => {
    const selfPos = () => R.moves.get(R.me.id) || R.me;
    const g0 = R.npcs
      .filter((n) => n.name === 'Gremlin' && !R.diedIds.has(n.id))
      .map((n) => ({ ...n, ...(R.moves.get(n.id) || n) }))
      .map((n) => ({ ...n, dist: Math.hypot(n.x - selfPos().x, n.y - selfPos().y) }))
      .sort((a, b) => a.dist - b.dist)[0];
    if (!g0) throw new Error('no live Gremlin for ' + label);
    console.log(`  killing Gremlin id=${g0.id} (${label})...`);
    const t0 = Date.now();
    // With geodata active, the ranged auto-approach on AttackRequest can
    // stall: walk NEXT to the gremlin first, then attack. Track its
    // wandering via move broadcasts and re-approach if it got away.
    while (!R.diedIds.has(g0.id) && Date.now() - t0 < 150000) {
      const pos = R.moves.get(g0.id) || g0;
      const me = selfPos();
      send({ op: 'moveTo', x: pos.x + 20, y: pos.y, z: pos.z });
      const walkMs = Math.min(12000, (Math.hypot(pos.x - me.x, pos.y - me.y) / 115) * 1000 + 2500);
      await sleep(walkMs);
      const t1 = Date.now();
      while (!R.diedIds.has(g0.id) && Date.now() - t1 < 15000) {
        send({ op: 'attack', id: g0.id });
        await sleep(4000);
      }
    }
    if (!R.diedIds.has(g0.id)) throw new Error('kill timeout ' + label);
    await sleep(2500); // let loot/exp events settle
    return g0.id;
  };

  // --- 1. .menu ---
  console.log('1. .menu');
  send({ op: 'say', channel: 0, text: '.menu' });
  await sleep(2500);
  const newLog = fs.readFileSync('gateway.log').subarray(logSizeBefore).toString();
  const menuHtml = newLog.includes('html window');
  const menuListsCmds = ['.menu', '.autoloot', '.expon', '.expoff', '.offline']
    .filter((c) => newLog.includes(c));
  VERDICT.menu = menuHtml && menuListsCmds.length >= 4;
  console.log(`   html window arrived: ${menuHtml}; commands listed: ${menuListsCmds.join(' ')}`);

  // --- 2. .autoloot (default ON -> toggle OFF -> toggle ON) ---
  console.log('2. .autoloot');
  let marks = { inv: R.invAdds.length, drops: R.drops.length };
  await killGremlin('autoloot default ON');
  const autoLootedOn = R.invAdds.length > marks.inv && R.drops.length === marks.drops;
  console.log(`   default ON kill: invUpdate add=${R.invAdds.length > marks.inv}, addDrop appeared=${R.drops.length > marks.drops}`);

  send({ op: 'say', channel: 0, text: '.autoloot' });
  await waitFor(() => R.sysTexts.find((t) => t.includes('DESACTIVADO')), 8000, 'autoloot OFF message');
  console.log('   .autoloot -> OFF confirmed by server message');
  marks = { inv: R.invAdds.length, drops: R.drops.length };
  await killGremlin('autoloot OFF');
  const groundDrop = R.drops.length > marks.drops;
  console.log(`   OFF kill: addDrop appeared=${groundDrop}`);
  let manualLoot = false;
  if (groundDrop) {
    // Prefer the adena drop (herb pickups are consumed instantly and yield
    // no invUpdate); pickup is proven by the drop's remove op.
    const newDrops = R.drops.slice(marks.drops);
    const drop = newDrops.find((d) => d.itemId === 57) || newDrops[newDrops.length - 1];
    const invMark = R.invAdds.length;
    send({ op: 'target', id: drop.id });
    await waitFor(() => R.removedIds.has(drop.id), 25000, 'drop pickup (remove)');
    await sleep(2000);
    const invProof = R.invAdds.length > invMark;
    manualLoot = drop.itemId === 57 ? invProof : true;
    console.log(`   manual loot of drop ${drop.id} (itemId ${drop.itemId}): removed=true invUpdate=${invProof}`);
  }
  send({ op: 'say', channel: 0, text: '.autoloot' });
  await waitFor(() => R.sysTexts.find((t) => t.includes('ACTIVADO') && !t.includes('DESACTIVADO')), 8000, 'autoloot ON message');
  console.log('   .autoloot -> ON confirmed by server message');
  marks = { inv: R.invAdds.length, drops: R.drops.length };
  await killGremlin('autoloot toggled ON');
  const autoLootedOn2 = R.invAdds.length > marks.inv && R.drops.length === marks.drops;
  console.log(`   toggled ON kill: invUpdate add=${R.invAdds.length > marks.inv}, addDrop appeared=${R.drops.length > marks.drops}`);
  VERDICT.autoloot = autoLootedOn && groundDrop && manualLoot && autoLootedOn2;

  // --- 3. .expoff / .expon ---
  console.log('3. .expoff / .expon');
  send({ op: 'say', channel: 0, text: '.expoff' });
  await waitFor(() => R.sysTexts.find((t) => t.includes('BLOQUEADA')), 8000, 'expoff message');
  const expBeforeBlocked = R.exp;
  await killGremlin('exp BLOCKED');
  const expBlockedOk = R.exp === expBeforeBlocked;
  console.log(`   expoff kill: exp ${expBeforeBlocked} -> ${R.exp} (blocked=${expBlockedOk})`);

  send({ op: 'say', channel: 0, text: '.expon' });
  await waitFor(() => R.sysTexts.find((t) => t.includes('PERMITIDA')), 8000, 'expon message');
  const expBeforeAllowed = R.exp;
  await killGremlin('exp ALLOWED');
  const expAllowedOk = R.exp > expBeforeAllowed;
  console.log(`   expon kill: exp ${expBeforeAllowed} -> ${R.exp} (gained=${expAllowedOk})`);
  VERDICT.exp = expBlockedOk && expAllowedOk;

  // --- governor honored? ---
  const fails = (newLog.match(/login attempt \d+ failed/g) || []).length;
  VERDICT.governor = fails === 0;
  console.log(`5. governor: login retry-failures during run = ${fails}`);

  ws.close();
  console.log('PART A verdicts:', JSON.stringify(VERDICT));
}

// ---------------------------------------------------------------- Part B

function openSession(deviceId, tag) {
  const creds = deriveCredentials(deviceId);
  const S = {
    tag, creds, game: null, userInfo: null, itemList: [], sysTexts: [], charInfos: [],
    npcs: [], moves: new Map(), diedIds: new Set(), closed: false,
  };
  S.selfPos = () => S.moves.get(S.userInfo?.id) || S.userInfo;
  S.start = async () => {
    const { sessionKey, server } = await login('127.0.0.1', 2106, creds.account, creds.password, 1);
    const game = new GameSession();
    S.game = game;
    game.on('charList', async (chars) => {
      if (chars.length === 0) { game.createCharacter(creds.charName); return; }
      await sleep(600);
      game.selectChar(0);
    });
    game.on('userInfo', (u) => { S.userInfo = u; });
    game.on('itemList', (items) => { S.itemList = items; });
    game.on('charInfo', (c) => S.charInfos.push(c));
    game.on('npcInfo', (n) => S.npcs.push(n));
    game.on('move', (m) => S.moves.set(m.id, { x: m.tx, y: m.ty, z: m.tz }));
    game.on('die', (id) => S.diedIds.add(id));
    game.on('systemMessage', (sm) => { if (typeof sm.params[0]?.value === 'string') S.sysTexts.push(sm.params[0].value); });
    game.on('close', () => { S.closed = true; });
    game.on('error', () => {});
    game.connect(server.host, server.port, creds.account, sessionKey);
    await waitFor(() => S.userInfo, 40000, tag + ' userInfo');
    await sleep(2500);
    return S;
  };
  return S;
}

// Walk-first melee kill (ranged auto-approach stalls with geodata active).
async function killGremlinDirect(S, label) {
  const g0 = S.npcs
    .filter((n) => n.npcId === 18342 && !S.diedIds.has(n.id))
    .map((n) => ({ ...n, ...(S.moves.get(n.id) || n) }))
    .map((n) => ({ ...n, dist: Math.hypot(n.x - S.selfPos().x, n.y - S.selfPos().y) }))
    .sort((a, b) => a.dist - b.dist)[0];
  if (!g0) throw new Error('no live Gremlin for ' + label);
  console.log(`   [${S.tag}] killing Gremlin id=${g0.id} (${label})...`);
  const t0 = Date.now();
  while (!S.diedIds.has(g0.id) && Date.now() - t0 < 150000) {
    const pos = S.moves.get(g0.id) || g0;
    const me = S.selfPos();
    S.game.pos = { ...S.game.pos, x: pos.x + 20, y: pos.y, z: pos.z };
    S.game.moveTo(pos.x + 20, pos.y, pos.z);
    await sleep(Math.min(12000, (Math.hypot(pos.x - me.x, pos.y - me.y) / 115) * 1000 + 2500));
    const t1 = Date.now();
    while (!S.diedIds.has(g0.id) && Date.now() - t1 < 15000) {
      S.game.attackRequest(g0.id);
      await sleep(4000);
    }
  }
  if (!S.diedIds.has(g0.id)) throw new Error('kill timeout ' + label);
  await sleep(2500);
}

async function partB() {
  console.log('===== PART B: .offline (private store) =====');
  const O = await openSession('verify-mods-O-' + suffix, 'O').start();
  console.log('O in world as', O.userInfo.name, 'at', O.userInfo.x, O.userInfo.y, O.userInfo.z);

  // .offline WITHOUT store -> guard message.
  O.game.say(0, '.offline');
  const noStoreMsg = await waitFor(() => O.sysTexts.find((t) => t.includes('tienda privada')), 8000, 'no-store .offline message');
  console.log('   .offline without store ->', JSON.stringify(noStoreMsg));
  VERDICT.offlineNoStore = true;

  // Earn some adena (autoloot is globally ON for a fresh char), then open a
  // private BUY store. Note: this aCis pack's canPassBuyProcess requires
  // OWNING a reference item, and all starter gear is is_tradable=false;
  // adena (57) is tradable and owned after the kill.
  await killGremlinDirect(O, 'adena for buy store');
  // sysMsg 1135 CANT_OPERATE_PRIVATE_STORE_DURING_COMBAT otherwise: the
  // combat flag outlives the kill by ~10s.
  console.log('   waiting for combat flag to fade...');
  await sleep(15000);
  // .offline WITH store -> disconnect is the real signal (the confirmation
  // message may not flush before the logout close). Retry once if the store
  // didn't open (residual combat flag, sysMsg 1135).
  let opened = false;
  for (let attempt = 1; attempt <= 2 && !opened; attempt++) {
    console.log(`   opening BUY store (adena reference, 1x @ 1a), attempt ${attempt}...`);
    const guardMark = O.sysTexts.length;
    O.game.requestPrivateStoreManageBuy();
    await sleep(1200);
    O.game.setPrivateStoreListBuy([{ itemId: 57, count: 1, price: 1 }]);
    await sleep(1500);
    O.game.say(0, '.offline');
    const t0 = Date.now();
    while (!O.closed && Date.now() - t0 < 20000) {
      if (O.sysTexts.slice(guardMark).some((t) => t.includes('tienda privada'))) break; // store didn't open
      await sleep(500);
    }
    opened = O.closed;
    if (!opened && attempt === 1) {
      console.log('   store did not open (combat flag?), waiting 12s before retry...');
      await sleep(12000);
    }
  }
  if (!opened) throw new Error('O socket did not close after .offline with store (2 attempts)');
  VERDICT.offlineStore = true;
  console.log('   .offline with BUY store -> disconnected (offline trader left in world)');
  await sleep(10000);

  // Observer B must still see O's char in-world (offline trader).
  const B = await openSession('verify-mods-B-' + suffix, 'B').start();
  await sleep(4000); // let the known-object stream settle
  const seen = B.charInfos.find((c) => c.name === O.userInfo.name);
  VERDICT.offlineVisible = !!seen;
  console.log(`   B sees offline trader O in world: ${!!seen}${seen ? ` at ${seen.x},${seen.y}` : ''}`);
  B.game.close();

  // Re-login as O: restore must give a consistent state at the same spot.
  const O2 = await openSession('verify-mods-O-' + suffix, 'O2').start();
  const dx = Math.abs(O2.userInfo.x - O.userInfo.x);
  const dy = Math.abs(O2.userInfo.y - O.userInfo.y);
  VERDICT.offlineRestore = O2.userInfo.name === O.userInfo.name && dx < 50 && dy < 50;
  console.log(`   O re-login as ${O2.userInfo.name} at ${O2.userInfo.x},${O2.userInfo.y} (dist ${Math.hypot(dx, dy) | 0} from store spot)`);
  O2.game.say(0, 'restore check m5');
  await sleep(1500);
  O2.game.close();
}

// ---------------------------------------------------------------- runner

(async () => {
  try { await partA(); } catch (e) { console.error('PART A error:', e.message); VERDICT.partAError = e.message; }
  try { await partB(); } catch (e) { console.error('PART B error:', e.message); VERDICT.partBError = e.message; }

  console.log('---');
  console.log('VERDICT TABLE');
  console.log('  .menu (html window + commands):     ', VERDICT.menu ? 'VERIFIED' : 'FAIL');
  console.log('  .autoloot (on/off/on + manual loot):', VERDICT.autoloot ? 'VERIFIED' : 'FAIL');
  console.log('  .expon/.expoff (exp block toggle):  ', VERDICT.exp ? 'VERIFIED' : 'FAIL');
  console.log('  .offline no-store guard message:    ', VERDICT.offlineNoStore ? 'VERIFIED' : 'FAIL');
  console.log('  .offline store + disconnect:        ', VERDICT.offlineStore ? 'VERIFIED' : 'FAIL');
  console.log('  offline trader visible to observer: ', VERDICT.offlineVisible ? 'VERIFIED' : 'FAIL');
  console.log('  offline restore on re-login:        ', VERDICT.offlineRestore ? 'VERIFIED' : 'FAIL');
  console.log('  governor honored (no ban):          ', VERDICT.governor ? 'VERIFIED' : 'FAIL');
  const pass = VERDICT.menu && VERDICT.autoloot && VERDICT.exp &&
    VERDICT.offlineNoStore && VERDICT.offlineStore && VERDICT.offlineVisible && VERDICT.offlineRestore && VERDICT.governor;
  console.log(pass ? 'VERIFY-MODS: PASS' : 'VERIFY-MODS: FAIL');
  process.exit(pass ? 0 : 1);
})();

setTimeout(() => { console.error('VERIFY-MODS: global timeout'); process.exit(1); }, 600000);
