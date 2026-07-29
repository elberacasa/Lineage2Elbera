// ClanWnd LIVE verification (real aCis via gateway on 8090). Self-contained:
// builds its own fixture because a clan that ousted a member is invite-locked
// for CLAN_JOIN_DAYS days (RequestOustPledgeMember.java:60 — verified live:
// invites against such a clan are silently dropped server-side).
//
// Fixture (raw gateway ops — setup only, the UI is what gets tested):
//   A2 = clanui-leader-<suffix>: create char -> seed level 20 + GM offline ->
//        teleport to Bitz -> REAL dialog chain -> create clan "Ui<suffix>"
//   B2 = clanui-member-<suffix>: auto-created char, invited + accepts
// Browser (A2): Alt+N window shows the real clan; Invite button arms on a
// player target; fresh D2 accepts -> 3 rows; D2's oust mark -> back to 2.
// Output: verify_shots/clan_live_*.png + JSON summary.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const WebSocket = require('/Users/alejandroberacasa/l2vzla/gateway/node_modules/ws');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8090';
const GATEWAY = 'ws://127.0.0.1:8090';
const OUT = path.join(__dirname, 'verify_shots');
const BITZ = { npcId: 30026, x: -83326, y: 242964, z: -3718 }; // spawnlist/17_25.xml
const sleep = ms => new Promise(r => setTimeout(r, ms));
const suffix = process.argv[2] || String(Date.now());
const clanName = ('Ui' + suffix).slice(0, 16).replace(/[^A-Za-z0-9]/g, '7');

const waitFor = (fn, ms, what) => new Promise((res, rej) => {
  const t0 = Date.now();
  (function poll() {
    const v = fn();
    if (v) return res(v);
    if (Date.now() - t0 > ms) return rej(new Error('timeout: ' + what));
    setTimeout(poll, 150);
  })();
});

function rawClient(tag) {
  const ws = new WebSocket(GATEWAY);
  const st = { me: null, level: 0, npcs: [], htmls: [], moves: new Map(),
               asks: [], memberLists: [], clanInfos: [], players: [] };
  ws.on('open', () => ws.send(JSON.stringify({ op: 'login', deviceId: 'clanui-' + tag + '-' + suffix })));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.op === 'auth_ok') st.auth = m;
    else if (m.op === 'enterWorld') st.me = m.char;
    else if (m.op === 'selfStatus') st.level = m.level;
    else if (m.op === 'addNpc') st.npcs.push(m);
    else if (m.op === 'addPlayer') st.players.push(m);
    else if (m.op === 'npcHtml') st.htmls.push(m.html);
    else if (m.op === 'move') st.moves.set(m.id, { x: m.tx, y: m.ty, z: m.tz });
    else if (m.op === 'clanAsk') st.asks.push(m);
    else if (m.op === 'clanMembers') st.memberLists.push(m.members);
    else if (m.op === 'clanInfo') st.clanInfos.push(m);
  });
  return { ws, st, send: (o) => ws.send(JSON.stringify(o)) };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const summary = { suffix, clanName, consoleLogs: [] };
  let browser;
  try {
    // ---------------- fixture: A2 char, seeded, clan created ---------------
    console.log('fixture: A2 char + clan', clanName);
    const A0 = rawClient('leader');
    await waitFor(() => A0.st.auth, 30000, 'A0 auth');
    A0.send({ op: 'enterChar', slot: 0 });
    await waitFor(() => A0.st.me, 60000, 'A0 enterWorld');
    const aName = A0.st.me.name;
    A0.ws.close();
    await sleep(5000); // the server saves on logout
    const levelsXml = fs.readFileSync(path.join(__dirname,
      '../../server/aCis_gameserver/build/dist/gameserver/data/xml/playerLevels.xml'), 'utf8');
    const exp = Number(/<playerLevel level="20"[^>]*requiredExpToLevelUp="(\d+)"/.exec(levelsXml)[1]);
    execFileSync('mariadb', ['-u', 'l2j', '-pl2jpass', 'l2jdb', '-e',
      `UPDATE characters SET level=20, exp=${exp}, accesslevel=7 WHERE char_name='${aName}' AND online=0;`]);

    const A = rawClient('leader');
    await waitFor(() => A.st.auth, 30000, 'A auth');
    A.send({ op: 'enterChar', slot: 0 });
    await waitFor(() => A.st.me, 60000, 'A enterWorld');
    await waitFor(() => A.st.level === 20, 15000, 'A level 20');

    // B enters BEFORE A teleports: the bridge resolves clanInvite names from
    // players seen this session, and Bitz is out of the spawn's sight range
    await sleep(700); // anti-flood pacing between fresh connections
    const B = rawClient('member');
    await waitFor(() => B.st.auth, 30000, 'B auth');
    B.send({ op: 'enterChar', slot: 0 });
    await waitFor(() => B.st.me, 60000, 'B enterWorld');
    await sleep(4000); // mutual CharInfo like verify-clan
    const bName = B.st.me.name;

    A.send({ op: 'bypass', command: `admin_teleport ${BITZ.x} ${BITZ.y} ${BITZ.z}` });
    await waitFor(() => {
      const p = A.st.moves.get(A.st.me.id);
      return p && Math.hypot(p.x - BITZ.x, p.y - BITZ.y) < 500;
    }, 15000, 'A teleported');
    const bitz = await waitFor(() => A.st.npcs.find(n => n.npcId === BITZ.npcId), 15000, 'Bitz visible');

    // the real creation dialog chain (same as verify-clan.js)
    A.send({ op: 'talk', id: bitz.id });
    const h1 = await waitFor(() => A.st.htmls.find(h => h.includes('Bitz')), 20000, 'Bitz dialog');
    const linkClan = /bypass -h (npc_\d+_Quest Clan)/.exec(h1);
    if (!linkClan) throw new Error('no "Quest Clan" link');
    let mark = A.st.htmls.length;
    A.send({ op: 'bypass', command: linkClan[1] });
    const h2 = await waitFor(() => A.st.htmls.slice(mark).find(h => h.includes('Clan management')), 20000, 'clan mgmt');
    const linkFound = /bypass -h (Quest Clan 9000-02\.htm)/.exec(h2);
    if (!linkFound) throw new Error('no "Found a clan" link');
    mark = A.st.htmls.length;
    A.send({ op: 'bypass', command: linkFound[1] });
    await waitFor(() => A.st.htmls.slice(mark).find(h => h.includes('Create a Clan')), 20000, 'create form');
    A.send({ op: 'bypass', command: `npc_${bitz.id}_create_clan ${clanName}` });
    await waitFor(() => A.st.clanInfos.find(c => c.id > 0), 20000, 'clanInfo after create');

    // B joins: A teleports BACK next to B first — the bridge resolves
    // clanInvite names from players seen this session, and the map prunes
    // on remove (the Bitz hop dropped B from it) — verify-clan.js:152-159.
    // The players list is cleared so the visible-wait can't pass on the
    // STALE pre-teleport entry before the fresh CharInfo lands.
    A.st.players = [];
    A.send({ op: 'bypass', command: `admin_teleport ${B.st.me.x + 50} ${B.st.me.y} ${B.st.me.z}` });
    await waitFor(() => A.st.players.find(p => p.name === bName), 20000, 'B visible to A (fresh)');
    A.send({ op: 'clanInvite', name: bName });
    await waitFor(() => B.st.asks[0], 15000, 'clanAsk at B');
    B.send({ op: 'clanAnswer', accept: 1 });
    await waitFor(() => A.st.memberLists.find(l => l.length === 2), 15000, 'clan of 2');
    console.log('fixture ready: A =', aName, '| B =', bName);

    // ---------------- the UI test: browser as A ---------------------------
    browser = await puppeteer.launch({
      executablePath: CHROME,
      args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', m => summary.consoleLogs.push(m.text()));
    page.on('pageerror', e => summary.consoleLogs.push('PAGEERROR: ' + e.message));
    await page.evaluateOnNewDocument((id) => {
      localStorage.setItem('l2vzla.deviceId', id);
    }, 'clanui-leader-' + suffix);
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'clanInfo' && m.id > 0)`, { timeout: 30000 });
    await sleep(1500);
    await page.keyboard.down('Alt');
    await page.keyboard.press('KeyN');
    await page.keyboard.up('Alt');
    await page.waitForFunction('window.__world.clanWnd.visible', { timeout: 8000 });
    await sleep(400);

    summary.leader = await page.evaluate((bn) => {
      const w = window.__world.clanWnd;
      const txt = el => (el && el.__l2text || '').split('|')[0];
      const rows = [...document.querySelectorAll('#l2-clanwnd [data-member]')];
      const bRow = rows.find(r => r.dataset.member === bn);
      const btn = (id) => document.querySelector(`#l2-clanwnd [data-btn="${id}"]`);
      const log = window.__world.net.log.filter(m => m.op === 'clanInfo' && m.id > 0);
      return {
        leaderName: log.length ? log[log.length - 1].leaderName : null,
        name: txt(w.nameEl), master: txt(w.masterEl), level: txt(w.levelEl),
        count: txt(w.countEl), rows: rows.length,
        leaveOpacity: btn('ClanQuitBtn') && btn('ClanQuitBtn').style.opacity,
        inviteOpacity: btn('ClanAskJoinBtn') && btn('ClanAskJoinBtn').style.opacity,
        bHasOust: !!(bRow && [...bRow.querySelectorAll('div')]
          .some(d => (d.__l2text || '').startsWith('×'))),
        selfOust: null, // below
        bIcons: bRow ? [...bRow.querySelectorAll('div')]
          .map(d => d.style.backgroundImage).filter(Boolean) : [],
      };
    }, bName);
    summary.leader.selfOust = await page.evaluate((an) => {
      const rows = [...document.querySelectorAll('#l2-clanwnd [data-member]')];
      const selfRow = rows.find(r => r.dataset.member === an);
      return !!(selfRow && [...selfRow.querySelectorAll('div')]
        .some(d => (d.__l2text || '').startsWith('×')));
    }, aName);
    await page.screenshot({ path: path.join(OUT, 'clan_live_leader.png') });

    // fresh D2 joins the SPAWN area (-71417,258270 is ~19km from Bitz — the
    // bridge resolves clanInvite names only from players seen this session),
    // so GM-teleport A there first
    await page.evaluate(() => window.__world.net.sendOp('bypass', {
      command: 'admin_teleport -71417 258270 -3104',
    }));
    await sleep(3000); // teleport + neighbor tiles stream
    await sleep(700);
    const D = rawClient('fresh');
    await waitFor(() => D.st.auth, 30000, 'D auth');
    D.send({ op: 'enterChar', slot: 0 });
    await waitFor(() => D.st.me, 60000, 'D enterWorld');
    const dName = D.st.me.name;
    await page.waitForFunction(
      `window.__world.entities.snapshot().some(e => e.name === '${dName}')`,
      { timeout: 30000 });
    const dId = await page.evaluate((n) =>
      window.__world.entities.snapshot().find(x => x.name === n).id, dName);
    await page.evaluate((id) => window.__world.net.sendOp('target', { id }), dId);
    await page.waitForFunction(
      `window.__world.combat.target && window.__world.combat.target.id === ${dId}`,
      { timeout: 10000 });
    await sleep(300);
    await page.evaluate(() => {
      document.querySelector('#l2-clanwnd [data-btn="ClanAskJoinBtn"]').click();
    });
    await waitFor(() => D.st.asks[0], 15000, 'clanAsk at D');
    summary.askOk = D.st.asks[0].clanName === clanName && D.st.asks[0].from === aName;
    D.send({ op: 'clanAnswer', accept: 1 });
    await page.waitForFunction('window.__world.clanWnd.members.length === 3', { timeout: 15000 });
    await sleep(500);
    summary.withThree = await page.evaluate(() => {
      const w = window.__world.clanWnd;
      const txt = el => (el && el.__l2text || '').split('|')[0];
      return { count: txt(w.countEl),
               rows: document.querySelectorAll('#l2-clanwnd [data-member]').length };
    });
    await page.screenshot({ path: path.join(OUT, 'clan_live_three.png') });

    // D2's oust mark -> clanOust -> back to 2
    await page.evaluate((dn) => {
      const rows = [...document.querySelectorAll('#l2-clanwnd [data-member]')];
      const dRow = rows.find(r => r.dataset.member === dn);
      [...dRow.querySelectorAll('div')]
        .find(d => (d.__l2text || '').startsWith('×')).click();
    }, dName);
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.dir === 'out' && m.op === 'clanOust')`,
      { timeout: 8000 });
    await page.waitForFunction('window.__world.clanWnd.members.length === 2', { timeout: 15000 });
    await waitFor(() => D.st.clanInfos.find(c => c.id === 0), 15000, 'D clanInfo{id:0}');
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, 'clan_live_ousted.png') });

    const L = summary.leader, T = summary.withThree;
    summary.checks = {
      clanFields: L.name === clanName && L.master === L.leaderName && L.count === '(2/2)',
      leaderLeaveDisabled: L.leaveOpacity === '0.45',
      inviteArmedNoTargetIsDisabled: L.inviteOpacity === '0.45',
      twoRows: L.rows === 2,
      bOustShown: L.bHasOust === true,
      selfNoOust: L.selfOust === false,
      bOnlineIcon: L.bIcons.some(u => u.includes('BloodHood_Logon')),
      bClassIcon: L.bIcons.some(u => u.includes('party_styleicon')),
      askOk: summary.askOk === true,
      threeAfterJoin: T.rows === 3 && T.count === '(3/3)',
      oustWorks: true, // reached only after members===2 + D cleared
    };
    summary.pass = Object.values(summary.checks).every(Boolean);
    A.ws.close(); B.ws.close(); D.ws.close();
  } catch (e) {
    summary.error = e.message;
    summary.consoleLogs.push('FATAL: ' + e.message);
  } finally {
    fs.writeFileSync(path.join(OUT, 'clan_live_summary.json'), JSON.stringify(summary, null, 1));
    if (browser) await browser.close();
  }
  console.log(JSON.stringify(summary.checks || summary, null, 1));
  process.exit(summary.pass ? 0 : 1);
})();
