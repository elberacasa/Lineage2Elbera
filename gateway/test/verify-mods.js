// Ops task: in-game verification of the custom L2Vzla server mods through
// the real protocol. No GM console, no DB edits.
//  Part A (WS bridge client): .menu, .autoloot, .expon/.expoff.
//  Part B (direct GameSession, same protocol stack + governor): .offline
//    with and without a private store + offline-trader visibility + restore.
'use strict';

const WebSocket = require('ws');
const fs = require('fs');
const { execFileSync } = require('child_process');
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

// ---------------------------------------------------------------- gateway log
//
// `fs.statSync('gateway.log')` was a standing landmine (found 2026-08-09).
// That file only exists if whoever started the gateway redirected stdout to
// it; the gateway running when this was found had its stdout pointed at a
// scratchpad file, so ./gateway.log was FOUR HOURS STALE. Two consequences,
// and the second is worse than the first:
//   1. the .menu check read `false` and called a WORKING feature broken
//      (the real log showed the 1457-char "Menu del jugador" window arriving
//      during the very run that reported the failure);
//   2. the governor check read an EMPTY slice, found zero "login attempt N
//      failed" lines in it, and reported VERIFIED. A vacuous pass — it would
//      have said VERIFIED just as loudly with the gateway on fire.
//
// .menu no longer needs the log at all (it asserts on the `npcHtml` op).
// The governor check genuinely does, so resolve the log the running gateway
// is ACTUALLY writing to by asking the OS, and if that cannot be determined,
// say SKIPPED instead of manufacturing a pass.
function resolveGatewayLog() {
  if (process.env.GATEWAY_LOG) return process.env.GATEWAY_LOG;
  try {
    const port = (process.env.GATEWAY_URL || 'ws://127.0.0.1:8090').split(':').pop();
    const pid = execFileSync('lsof', ['-t', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN'],
      { encoding: 'utf8' }).trim().split('\n')[0];
    if (!pid) return null;
    // fd 1 is stdout; `lsof -p <pid>` prints its target path for a regular file
    const line = execFileSync('lsof', ['-p', pid], { encoding: 'utf8' })
      .split('\n').find((l) => /\s1w\s+REG\s/.test(l));
    if (!line) return null;
    const m = line.match(/(\/\S.*)$/);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

// ---------------------------------------------------------------- Part A

async function partA() {
  console.log('===== PART A: .menu / .autoloot / .expon / .expoff (WS bridge) =====');
  const GW_LOG = resolveGatewayLog();
  const logSizeBefore = (GW_LOG && fs.existsSync(GW_LOG)) ? fs.statSync(GW_LOG).size : null;
  console.log(`   (gateway stdout log: ${GW_LOG || 'NOT RESOLVED'})`);
  const R = {
    me: null, exp: 0, npcs: [], drops: [], invAdds: [], diedIds: new Set(),
    sysTexts: [], moves: new Map(), removedIds: new Set(), attacks: [], htmls: [],
  };
  const ws = new WebSocket(url);
  ws.on('error', (e) => { console.error('ws error:', e.stack || e.message); process.exit(1); });
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
      case 'attack': R.attacks.push(m); break;
      case 'remove': R.removedIds.add(m.id); break;
      case 'move': if (m.id) R.moves.set(m.id, { x: m.tx, y: m.ty, z: m.tz }); break;
      case 'sysMsg': if (typeof m.params[0] === 'string') R.sysTexts.push(m.params[0]); break;
      // NpcHtmlMessage forwarded by bridge.js:1366 — the .menu evidence.
      case 'npcHtml': R.htmls.push(m); break;
    }
  });
  const send = (o) => ws.send(JSON.stringify(o));

  await waitFor(() => R.me, 60000, 'enterWorld');
  await sleep(3000); // npc stream
  console.log('in world as', R.me.name);

  const killGremlin = async (label) => {
    const selfPos = () => R.moves.get(R.me.id) || R.me;
    const npcPos = (g) => R.moves.get(g.id) || g;
    const ownHit = (id) => R.attacks.some((a) => a.id === R.me.id && a.targetId === id && a.damage > 0);
    const dmgOn = (id) => R.attacks.filter((a) => a.targetId === id).length;
    // Prefer gremlins a short straight walk away: the absolute nearest can
    // sit across training-hall geometry where straight-line moveTo stalls.
    const all = R.npcs
      .filter((n) => n.name === 'Gremlin' && !R.diedIds.has(n.id))
      .map((n) => ({ ...n, ...(R.moves.get(n.id) || n) }))
      .map((n) => ({ ...n, dist: Math.hypot(n.x - selfPos().x, n.y - selfPos().y) }))
      .sort((a, b) => a.dist - b.dist);
    const near = all.filter((g) => g.dist < 150);
    const candidates = (near.length ? near : all).slice(0, 4);
    if (!candidates.length) throw new Error('no live Gremlin for ' + label);
    // With geodata active, the ranged auto-approach on AttackRequest can
    // stall: walk NEXT to the gremlin in straight-line legs, verify
    // adjacency (<=80u by last known positions) before each attack window,
    // and skip to the next candidate if no damage lands within 20s. The
    // kill only counts if OUR attacks landed (loot/exp assertions need it).
    const tKill = Date.now();
    for (const g0 of candidates) {
      if (Date.now() - tKill > 150000) break;
      console.log(`  killing Gremlin id=${g0.id} at ${g0.x},${g0.y} dist ${g0.dist | 0} (${label})...`);
      const t0 = Date.now();
      let dmgMark = dmgOn(g0.id);
      let lastProgress = Date.now();
      while (!R.diedIds.has(g0.id) && Date.now() - t0 < 60000) {
        const dealt = dmgOn(g0.id);
        if (dealt > dmgMark) { dmgMark = dealt; lastProgress = Date.now(); }
        if (Date.now() - lastProgress > 20000) break; // no damage progress: stuck/contested
        const pos = npcPos(g0);
        const me = selfPos();
        const d = Math.hypot(pos.x - me.x, pos.y - me.y);
        if (d > 80) {
          const leg = Math.min(d, 150);
          const lx = leg >= d ? pos.x + 20 : me.x + ((pos.x - me.x) / d) * leg;
          const ly = leg >= d ? pos.y : me.y + ((pos.y - me.y) / d) * leg;
          send({ op: 'moveTo', x: lx | 0, y: ly | 0, z: pos.z | 0 });
          await sleep(Math.min(12000, (leg / 115) * 1000 + 2500));
          continue;
        }
        send({ op: 'attack', id: g0.id });
        await sleep(2000);
      }
      if (R.diedIds.has(g0.id) && ownHit(g0.id)) {
        await sleep(2500); // let loot/exp events settle
        return g0.id;
      }
      console.log(`  gremlin id=${g0.id} ${R.diedIds.has(g0.id) ? 'killed by someone else' : 'made no progress'}, trying another...`);
    }
    throw new Error('kill timeout ' + label);
  };

  // --- 1. .menu ---
  // Asserted on the CONTRACT (bridge.js:1366 sends `npcHtml` before it logs),
  // not on a log file whose path depends on how the operator started the
  // gateway. Same evidence, one fewer way to be wrong.
  console.log('1. .menu');
  const htmlsBefore = R.htmls.length;
  send({ op: 'say', channel: 0, text: '.menu' });
  await sleep(2500);
  const menuWindows = R.htmls.slice(htmlsBefore);
  const menuHtml = menuWindows.length > 0;
  const menuBody = menuWindows.map((h) => h.html).join('\n');
  const menuListsCmds = ['.menu', '.autoloot', '.expon', '.expoff', '.offline']
    .filter((c) => menuBody.includes(c));
  VERDICT.menu = menuHtml && menuListsCmds.length >= 4;
  console.log(`   html window arrived: ${menuHtml} (${menuBody.length} chars);`
    + ` commands listed: ${menuListsCmds.join(' ')}`);

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
  // This one really does need the gateway's stdout. If it could not be
  // resolved, say so — do NOT score an empty string as zero failures.
  if (logSizeBefore === null) {
    VERDICT.governor = 'SKIPPED';
    console.log('5. governor: SKIPPED — could not resolve the running gateway\'s'
      + ' stdout log (set GATEWAY_LOG=<path> to enable this check)');
  } else {
    const newLog = fs.readFileSync(GW_LOG).subarray(logSizeBefore).toString();
    const fails = (newLog.match(/login attempt \d+ failed/g) || []).length;
    VERDICT.governor = fails === 0;
    console.log(`5. governor: login retry-failures during run = ${fails}`);
  }

  ws.close();
  console.log('PART A verdicts:', JSON.stringify(VERDICT));
}

// ---------------------------------------------------------------- Part B

function openSession(deviceId, tag) {
  const creds = deriveCredentials(deviceId);
  const S = {
    tag, creds, game: null, userInfo: null, itemList: [], sysTexts: [], charInfos: [],
    npcs: [], moves: new Map(), diedIds: new Set(), closed: false, attacks: [],
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
    game.on('move', (m) => {
      S.moves.set(m.id, { x: m.tx, y: m.ty, z: m.tz });
      // m.x/m.y/m.z is the server's CURRENT position of the mover: keep the
      // client-side origin (used by moveTo/attackRequest packets) honest.
      if (S.userInfo && m.id === S.userInfo.id) S.game.pos = { ...S.game.pos, x: m.x, y: m.y, z: m.z };
    });
    game.on('validate', (v) => {
      S.moves.set(v.id, { x: v.x, y: v.y, z: v.z });
      if (S.userInfo && v.id === S.userInfo.id) S.game.pos = { ...S.game.pos, x: v.x, y: v.y, z: v.z };
    });
    game.on('attack', (a) => S.attacks.push(a));
    game.on('die', (d) => S.diedIds.add(d.id)); // Die event = parsed object {id, toVillage, ...} (gameclient.js)
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
  const selfPos = () => S.moves.get(S.userInfo.id) || S.userInfo;
  const npcPos = (g) => S.moves.get(g.id) || g;
  const ownHit = (id) => S.attacks.some((a) =>
    a.attackerId === S.userInfo.id && a.hits.some((h) => h.targetId === id && h.damage > 0));
  const dmgOn = (id) => S.attacks.reduce((n, a) => n + a.hits.filter((h) => h.targetId === id).length, 0);
  // Prefer gremlins a short straight walk away: the absolute nearest can
  // sit across training-hall geometry where straight-line moveTo stalls.
  const all = S.npcs
    .filter((n) => n.npcId === 18342 && !S.diedIds.has(n.id))
    .map((n) => ({ ...n, ...(S.moves.get(n.id) || n) }))
    .map((n) => ({ ...n, dist: Math.hypot(n.x - selfPos().x, n.y - selfPos().y) }))
    .sort((a, b) => a.dist - b.dist);
  const near = all.filter((g) => g.dist < 150);
  const candidates = (near.length ? near : all).slice(0, 4);
  if (!candidates.length) throw new Error('no live Gremlin for ' + label);
  // Walk NEXT to the gremlin in straight-line legs, verify adjacency (<=80u
  // by last known positions) before each attack window, and skip to the
  // next candidate if no damage lands within 20s.
  const tKill = Date.now();
  for (const g0 of candidates) {
    if (Date.now() - tKill > 150000) break;
    console.log(`   [${S.tag}] killing Gremlin id=${g0.id} at ${g0.x},${g0.y} dist ${g0.dist | 0} (${label})...`);
    const t0 = Date.now();
    let dmgMark = dmgOn(g0.id);
    let lastProgress = Date.now();
    while (!S.diedIds.has(g0.id) && Date.now() - t0 < 60000) {
      const dealt = dmgOn(g0.id);
      if (dealt > dmgMark) { dmgMark = dealt; lastProgress = Date.now(); }
      if (Date.now() - lastProgress > 20000) break; // no damage progress: stuck/contested
      const pos = npcPos(g0);
      const me = selfPos();
      const d = Math.hypot(pos.x - me.x, pos.y - me.y);
      S.game.pos = { ...S.game.pos, x: me.x, y: me.y, z: me.z ?? pos.z }; // packet origin
      if (d > 80) {
        const leg = Math.min(d, 150);
        const lx = leg >= d ? pos.x + 20 : me.x + ((pos.x - me.x) / d) * leg;
        const ly = leg >= d ? pos.y : me.y + ((pos.y - me.y) / d) * leg;
        S.game.moveTo(lx | 0, ly | 0, pos.z | 0);
        await sleep(Math.min(12000, (leg / 115) * 1000 + 2500));
        continue;
      }
      S.game.attackRequest(g0.id);
      await sleep(2000);
    }
    if (S.diedIds.has(g0.id) && ownHit(g0.id)) {
      await sleep(2500);
      return;
    }
    console.log(`   [${S.tag}] gremlin id=${g0.id} ${S.diedIds.has(g0.id) ? 'killed by someone else' : 'made no progress'}, trying another...`);
  }
  throw new Error('kill timeout ' + label);
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
  // SKIPPED is not FAIL and is not VERIFIED: the log the check needs could
  // not be located, so it produced no evidence either way. Printing it as
  // VERIFIED (what an empty-string scrape used to do) is the one option that
  // is actually dishonest.
  console.log('  governor honored (no ban):          ',
    VERDICT.governor === 'SKIPPED' ? 'SKIPPED (no gateway log)'
      : VERDICT.governor ? 'VERIFIED' : 'FAIL');
  const governorOk = VERDICT.governor === 'SKIPPED' || VERDICT.governor === true;
  const pass = VERDICT.menu && VERDICT.autoloot && VERDICT.exp &&
    VERDICT.offlineNoStore && VERDICT.offlineStore && VERDICT.offlineVisible
    && VERDICT.offlineRestore && governorOk;
  console.log(pass ? 'VERIFY-MODS: PASS' : 'VERIFY-MODS: FAIL');
  process.exit(pass ? 0 : 1);
})();

setTimeout(() => { console.error('VERIFY-MODS: global timeout'); process.exit(1); }, 600000);
