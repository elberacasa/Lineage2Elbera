// Tutorial protocol verification (M17): fresh deviceId -> login (legacy
// auto-create makes a level-1 Human Fighter) -> enterChar -> the aCis
// Tutorial script fires TutorialShowHtml ~10s after EnterWorld (QT timer,
// server/.../script/feature/Tutorial.java). Assert:
//   1. the tutorial page arrives through the npcHtml op with its
//      `action="link TE02"` rewritten to `action="bypass -h TE02"`
//      (bridge rewrite — the client dialog only renders bypass links)
//   2. bypass{TE02} -> the Movement page (RequestTutorialLinkHtml 0x7b
//      routing, NOT RequestBypassToServer)
//   3. bypass{TE00} -> tutorialHtmlClose (TutorialCloseHtml 0xa3)
// One session, governor-paced by the bridge itself.
'use strict';

const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
// deviceId starts with 'tut' — the mock gates its tutorial fixture on it
// (aCis only sends TutorialShowHtml for genuinely new chars; the live
// server ignores the prefix — it is just a fresh account either way)
const deviceId = process.argv[2] || 'tut-verify-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const R = { me: null, htmls: [], closes: 0 };
const ws = new WebSocket(url);
ws.on('error', (e) => { console.error('ws error:', e.stack || e.message); process.exit(1); });
ws.on('open', () => ws.send(JSON.stringify({ op: 'login', deviceId })));
ws.on('message', (d) => {
  const m = JSON.parse(d);
  switch (m.op) {
    case 'auth_ok': sleep(400).then(() => ws.send(JSON.stringify({ op: 'enterChar', slot: 0 }))); break;
    case 'enterWorld': R.me = m.char; break;
    case 'npcHtml': R.htmls.push(m.html); break;
    case 'tutorialHtmlClose': R.closes++; break;
  }
});
const send = (o) => ws.send(JSON.stringify(o));
const waitFor = (fn, timeout, label) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const v = fn();
    if (v) { clearInterval(iv); resolve(v); }
    else if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error('timeout: ' + label)); }
  }, 250);
});
const snippet = (h, n = 160) => h.replace(/\s+/g, ' ').slice(0, n);

(async () => {
  await waitFor(() => R.me, 60000, 'enterWorld');
  console.log('in world as', R.me.name);

  // --- 1. tutorial page arrives as npcHtml (aCis fires it ~10s after
  // EnterWorld for a fresh level-1 char; allow generous margin) ---
  const page1 = await waitFor(
    () => R.htmls.find((h) => h.includes('Welcome to Lineage II')),
    30000, 'tutorial npcHtml (TutorialShowHtml 0xa0)');
  console.log('1. tutorial npcHtml snippet:', snippet(page1));
  if (!page1.includes('bypass -h TE02'))
    throw new Error('tutorial link not rewritten to "bypass -h TE02": ' + snippet(page1));
  console.log('   link rewritten: action="bypass -h TE02" present');

  // --- 2. follow the TE02 link (0x7b routing) -> Movement page ---
  send({ op: 'bypass', command: 'TE02' });
  const page2 = await waitFor(
    () => R.htmls.find((h) => h.includes('[Movement]')),
    15000, 'Movement page after bypass TE02');
  console.log('2. TE02 -> Movement page snippet:', snippet(page2));

  // --- 3. TE00 -> TutorialCloseHtml (0xa3) as tutorialHtmlClose ---
  send({ op: 'bypass', command: 'TE00' });
  await waitFor(() => R.closes > 0, 15000, 'tutorialHtmlClose after bypass TE00');
  console.log('3. TE00 -> tutorialHtmlClose received');

  console.log('---');
  console.log(`htmls received=${R.htmls.length} closes=${R.closes}`);
  console.log('VERIFY-TUTORIAL: PASS');
  process.exit(0);
})().catch((e) => { console.error('VERIFY-TUTORIAL: FAIL', e.stack || e.message); process.exit(1); });
