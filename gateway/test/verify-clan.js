// Clan (pledge) protocol verification (three sessions):
//  0. A logs in once (char auto-created), logs out; A is seeded to level 20
//     (+ accesslevel 7 for travel only) via SQL — aCis requires level >= 10
//     to found a clan (ClanTable.createClan) and DaysBeforeCreateAClan=10
//     only applies after a previous dissolution.
//  1. A teleports to Grand Master Bitz (30026, TI village) and creates a
//     clan through the REAL dialog chain:
//       talk -> 30026.htm -> bypass "npc_<obj>_Quest Clan" -> 9000-01.htm
//       -> bypass "Quest Clan 9000-02.htm" -> 9000-02.htm (create form)
//       -> bypass "npc_<obj>_create_clan <Name>" -> CLAN_CREATED.
//     (Roien — the spawn-point Grand Master — is NOT in the Clan feature
//     script's talk list in this datapack, so creation must go through a
//     listed VillageMaster; Bitz is the closest TI one, 19k units away —
//     hence the admin teleport for travel. Creation itself is 100% protocol.)
//  2. A invites B -> B gets clanAsk{from,clanName} -> B accepts -> both get
//     clanInfo + clanMembers (2 members, correct names).
//  3. B leaves -> B gets clanInfo{id:0} + empty members; A drops to 1.
//  4. A invites C -> C accepts -> A ousts C -> C cleared, A back to 1.
//  5. clanCrestRequest{id:0} -> clanCrest{id:0,data:null} (decode path only).
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const suffix = process.argv[2] || String(Date.now());
const clanName = ('Vz' + suffix).slice(0, 16).replace(/[^A-Za-z0-9]/g, '7');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BITZ = { npcId: 30026, x: -83326, y: 242964, z: -3718 }; // spawnlist/17_25.xml

function makeClient(name, deviceId) {
  const c = {
    name,
    ws: new WebSocket(url),
    state: {
      me: null, level: 0, authed: false, npcs: [], players: [], htmls: [], moves: new Map(),
      asks: [], clanInfos: [], memberLists: [], crests: [],
    },
  };
  c.queue = [];
  c.send = (o) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); else c.queue.push(o); };
  c.ws.on('open', () => { for (const o of c.queue.splice(0)) c.ws.send(JSON.stringify(o)); });
  c.ws.on('error', (e) => { console.error(`[${name}] ws error:`, e.message); process.exit(1); });
  c.ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.op === 'auth_ok') c.state.authed = true;
    else if (m.op === 'enterWorld') c.state.me = m.char;
    else if (m.op === 'selfStatus') c.state.level = m.level;
    else if (m.op === 'addNpc') c.state.npcs.push(m);
    else if (m.op === 'addPlayer') c.state.players.push(m);
    else if (m.op === 'npcHtml') c.state.htmls.push(m.html);
    else if (m.op === 'move') c.state.moves.set(m.id, { x: m.tx, y: m.ty, z: m.tz });
    else if (m.op === 'clanAsk') { c.state.asks.push(m); console.log(`[${name}] clanAsk:`, JSON.stringify(m)); }
    else if (m.op === 'clanInfo') { c.state.clanInfos.push(m); console.log(`[${name}] clanInfo:`, JSON.stringify(m)); }
    else if (m.op === 'clanMembers') { c.state.memberLists.push(m); console.log(`[${name}] clanMembers:`, JSON.stringify(m)); }
    else if (m.op === 'clanCrest') { c.state.crests.push(m); console.log(`[${name}] clanCrest: id=${m.id} data=${m.data === null ? 'null' : m.data.length + 'b64 chars'}`); }
  });
  return c;
}
const waitFor = (fn, timeout, label) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const v = fn();
    if (v) { clearInterval(iv); resolve(v); }
    else if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error('timeout: ' + label)); }
  }, 250);
});
const snippet = (h, n = 120) => h.replace(/\s+/g, ' ').slice(0, n);

(async () => {
  // --- 0. create A's char, then seed level 20 + GM (travel) offline ---
  console.log(`0. create A's char (clan "${clanName}")...`);
  const A0 = makeClient('A0', 'verify-clan-A-' + suffix);
  A0.send({ op: 'login', deviceId: 'verify-clan-A-' + suffix });
  await waitFor(() => A0.state.authed, 30000, 'auth_ok A0');
  A0.send({ op: 'enterChar', slot: 0 });
  await waitFor(() => A0.state.me, 60000, 'enterWorld A0');
  const aName = A0.state.me.name;
  console.log('   A char:', aName, '— logging out to seed');
  A0.ws.close();
  await sleep(5000); // server saves the char on logout

  const levelsXml = fs.readFileSync(path.join(__dirname, '../../server/aCis_gameserver/build/dist/gameserver/data/xml/playerLevels.xml'), 'utf8');
  const exp = Number(/<playerLevel level="20"[^>]*requiredExpToLevelUp="(\d+)"/.exec(levelsXml)[1]);
  execFileSync('mariadb', ['-u', 'l2j', '-pl2jpass', 'l2jdb', '-e',
    `UPDATE characters SET level=20, exp=${exp}, accesslevel=7 WHERE char_name='${aName}' AND online=0;`]);
  console.log(`   seeded ${aName}: level 20 (exp ${exp}), accesslevel 7 (admin_teleport for travel)`);

  // --- 1. all three in world; A teleports to Bitz and creates the clan ---
  const A = makeClient('A', 'verify-clan-A-' + suffix);
  const B = makeClient('B', 'verify-clan-B-' + suffix);
  const C = makeClient('C', 'verify-clan-C-' + suffix);
  A.send({ op: 'login', deviceId: 'verify-clan-A-' + suffix });
  await sleep(600);
  B.send({ op: 'login', deviceId: 'verify-clan-B-' + suffix });
  await sleep(600);
  C.send({ op: 'login', deviceId: 'verify-clan-C-' + suffix });
  await waitFor(() => A.state.authed, 30000, 'auth_ok A');
  A.send({ op: 'enterChar', slot: 0 });
  await waitFor(() => B.state.authed, 30000, 'auth_ok B');
  B.send({ op: 'enterChar', slot: 0 });
  await waitFor(() => C.state.authed, 30000, 'auth_ok C');
  C.send({ op: 'enterChar', slot: 0 });
  await waitFor(() => A.state.me && B.state.me && C.state.me, 60000, 'enterWorld all');
  await sleep(4000); // mutual CharInfo (clanInvite resolves names from it)
  console.log('1. in world:', A.state.me.name, '/', B.state.me.name, '/', C.state.me.name);
  if (A.state.me.name !== aName) throw new Error('A name mismatch after re-login');
  const lvlOk = await waitFor(() => A.state.level === 20, 10000, 'A level 20').catch(() => false);
  console.log('   A level 20 after seed:', lvlOk);

  console.log('   A teleports to Bitz (admin_teleport, travel only)...');
  A.send({ op: 'bypass', command: `admin_teleport ${BITZ.x} ${BITZ.y} ${BITZ.z}` });
  await waitFor(() => {
    const p = A.state.moves.get(A.state.me.id);
    return p && Math.hypot(p.x - BITZ.x, p.y - BITZ.y) < 500;
  }, 15000, 'A teleported near Bitz');
  const bitz = await waitFor(() => A.state.npcs.find((n) => n.npcId === BITZ.npcId), 15000, 'Bitz visible');
  console.log('   Bitz id=' + bitz.id, 'dist', Math.hypot(bitz.x - BITZ.x, bitz.y - BITZ.y) | 0);

  // The real dialog chain (validated against data/html + the Clan feature
  // script; every bypass must appear in the previously shown html — aCis
  // Player.validateBypass).
  A.send({ op: 'talk', id: bitz.id });
  const h1 = await waitFor(() => A.state.htmls.find((h) => h.includes('Bitz')), 20000, 'Bitz dialog');
  console.log('   talk ->', snippet(h1));
  const linkClan = /bypass -h (npc_\d+_Quest Clan)/.exec(h1);
  if (!linkClan) throw new Error('no "Quest Clan" link in Bitz dialog');

  let mark = A.state.htmls.length;
  A.send({ op: 'bypass', command: linkClan[1] });
  const h2 = await waitFor(() => A.state.htmls.slice(mark).find((h) => h.includes('Clan management')), 20000, 'Clan management page');
  console.log('   ' + linkClan[1] + ' ->', snippet(h2));
  const linkFound = /bypass -h (Quest Clan 9000-02\.htm)/.exec(h2);
  if (!linkFound) throw new Error('no "Found a clan" link');

  mark = A.state.htmls.length;
  A.send({ op: 'bypass', command: linkFound[1] });
  const h3 = await waitFor(() => A.state.htmls.slice(mark).find((h) => h.includes('Create a Clan')), 20000, 'create form');
  console.log('   ' + linkFound[1] + ' ->', snippet(h3));

  A.send({ op: 'bypass', command: `npc_${bitz.id}_create_clan ${clanName}` });
  const ciA = await waitFor(() => A.state.clanInfos.find((c) => c.id > 0), 20000, 'clanInfo at A after create');
  const cmA1 = await waitFor(() => A.state.memberLists.find((l) => l.members.length === 1), 10000, 'clanMembers(1) at A');
  const createOk =
    ciA.name === clanName && ciA.leaderName === A.state.me.name && typeof ciA.level === 'number' &&
    cmA1.members[0].name === A.state.me.name && cmA1.members[0].online === true;
  console.log('   clan created via dialog chain:', JSON.stringify(ciA), '| members:', cmA1.members.map((m) => m.name));
  console.log('   create ok:', createOk);

  // --- 2. invite B -> accept ---
  // A may have logged in AT Bitz (previous run's logout spot) and never got
  // B's/C's CharInfo; clanInvite resolves names via the visible-players map,
  // so teleport A back next to B first (travel only; the invite itself is
  // plain protocol — RequestJoinPledge has no distance check in this rev).
  console.log('2. A returns to the group, invites B, B accepts...');
  A.send({ op: 'bypass', command: `admin_teleport ${B.state.me.x + 50} ${B.state.me.y} ${B.state.me.z}` });
  await waitFor(() => A.state.players.find((p) => p.name === B.state.me.name), 20000, 'B visible to A');
  await waitFor(() => A.state.players.find((p) => p.name === C.state.me.name), 20000, 'C visible to A');
  A.send({ op: 'clanInvite', name: B.state.me.name });
  const invitedAt = Date.now();
  const askB = await waitFor(() => B.state.asks[0], 15000, 'clanAsk at B');
  const askOk = askB.from === A.state.me.name && askB.clanName === clanName;
  console.log('   clanAsk from/clanName ok:', askOk);
  B.send({ op: 'clanAnswer', accept: 1 });
  const cmA2 = await waitFor(() => A.state.memberLists.find((l) => l.members.length === 2), 15000, 'clanMembers(2) at A');
  const ciB = await waitFor(() => B.state.clanInfos.find((c) => c.id === ciA.id), 15000, 'clanInfo at B');
  const cmB2 = await waitFor(() => B.state.memberLists.find((l) => l.members.length === 2), 15000, 'clanMembers(2) at B');
  const joinOk =
    ciB.name === clanName && ciB.leaderName === A.state.me.name &&
    cmA2.members.some((m) => m.name === A.state.me.name) && cmA2.members.some((m) => m.name === B.state.me.name) &&
    cmB2.members.some((m) => m.name === A.state.me.name) && cmB2.members.some((m) => m.name === B.state.me.name) &&
    cmB2.members.every((m) => m.online === true && typeof m.level === 'number' && typeof m.classId === 'number');
  console.log('   A members:', cmA2.members.map((m) => `${m.name} lvl${m.level} cls${m.classId} on=${m.online}`));
  console.log('   B members:', cmB2.members.map((m) => `${m.name} lvl${m.level} cls${m.classId} on=${m.online}`));
  console.log('   join ok:', joinOk);

  // --- 3. B leaves ---
  console.log('3. B leaves the clan...');
  const markB = B.state.clanInfos.length;
  B.send({ op: 'clanLeave' });
  const ciB0 = await waitFor(() => B.state.clanInfos.slice(markB).find((c) => c.id === 0), 15000, 'clanInfo{id:0} at B');
  const cmB0 = await waitFor(() => B.state.memberLists[B.state.memberLists.length - 1]?.members.length === 0, 15000, 'empty members at B');
  const cmA3 = await waitFor(() => A.state.memberLists[A.state.memberLists.length - 1]?.members.length === 1, 15000, 'clanMembers(1) at A');
  console.log('   B cleared (clanInfo id 0 + empty members):', !!ciB0 && !!cmB0, '| A back to 1 member:', !!cmA3);

  // --- 4. invite C -> accept -> A ousts C ---
  // aCis quirk (model/actor/container/player/Request.java): onRequestResponse
  // clears the RESPONDER's state but NEVER the requestor's (clear() nulls
  // _partner before the null check) — so A stays "processing request" until
  // the 15s REQUEST_TIMEOUT task fires. Inviting C sooner gets A a silent
  // WAITING_FOR_ANOTHER_REPLY drop. Wait out the 15s from B's invite.
  const sinceInvite = Date.now() - invitedAt;
  if (sinceInvite < 16000) await sleep(16000 - sinceInvite);
  console.log('4. A invites C, C accepts, A ousts C...');
  A.send({ op: 'clanInvite', name: C.state.me.name });
  await waitFor(() => C.state.asks[0], 15000, 'clanAsk at C');
  C.send({ op: 'clanAnswer', accept: 1 });
  await waitFor(() => C.state.memberLists.find((l) => l.members.length === 2), 15000, 'clanMembers(2) at C');
  const markC = C.state.clanInfos.length;
  A.send({ op: 'clanOust', name: C.state.me.name });
  const ciC0 = await waitFor(() => C.state.clanInfos.slice(markC).find((c) => c.id === 0), 15000, 'clanInfo{id:0} at C');
  const cmA4 = await waitFor(() => A.state.memberLists[A.state.memberLists.length - 1]?.members.length === 1, 15000, 'clanMembers(1) at A after oust');
  console.log('   C cleared after oust:', !!ciC0, '| A back to 1 member:', !!cmA4);

  // --- 5. crest decode path (no crest set: id 0, null data) ---
  console.log('5. clanCrestRequest{id:0}...');
  A.send({ op: 'clanCrestRequest', id: 0 });
  const crest = await waitFor(() => A.state.crests[0], 15000, 'clanCrest');
  const crestOk = crest.id === 0 && crest.data === null;
  console.log('   clanCrest{id:0, data:null} ok:', crestOk);

  console.log('---');
  const pass = !!(lvlOk && createOk && askOk && joinOk && ciB0 && cmB0 && cmA3 && ciC0 && cmA4 && crestOk);
  console.log(pass ? 'VERIFY-CLAN: PASS' : 'VERIFY-CLAN: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('VERIFY-CLAN: FAIL', e.message); process.exit(1); });

setTimeout(() => { console.error('VERIFY-CLAN: global timeout'); process.exit(1); }, 300000);
