// NPC dialog protocol verification: talk{id} -> npcHtml -> bypass{command}
// -> second npcHtml; plus .menu html + voiced_ bypass.
'use strict';

const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const deviceId = process.argv[2] || 'verify-dialog-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const R = { me: null, npcs: [], htmls: [], actionFailed: 0, moves: new Map() };
const ws = new WebSocket(url);
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1); });
ws.on('open', () => ws.send(JSON.stringify({ op: 'login', deviceId })));
ws.on('message', async (d) => {
  const m = JSON.parse(d);
  switch (m.op) {
    case 'auth_ok': await sleep(400); ws.send(JSON.stringify({ op: 'enterChar', slot: 0 })); break;
    case 'enterWorld': R.me = m.char; break;
    case 'addNpc': R.npcs.push(m); break;
    case 'npcHtml': R.htmls.push(m.html); break;
    case 'actionFailed': R.actionFailed++; break;
    case 'move': R.moves.set(m.id, { x: m.tx, y: m.ty, z: m.tz }); break;
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
  await sleep(3000);
  console.log('in world as', R.me.name);

  // --- 1. talk to an NPC with real dialog links (Roien preferred; the
  // Newbie Helper is stuck in the tutorial chain for fresh chars and shows
  // link-less quest text — aCis quest behavior, not a bridge issue).
  const candidates = R.npcs
    .filter((n) => ['Roien', 'Newbie Helper'].includes(n.name))
    .map((n) => ({ ...n, dist: Math.hypot(n.x - R.me.x, n.y - R.me.y) }))
    .sort((a, b) => (a.name === 'Roien' ? -1 : 1) - (b.name === 'Roien' ? -1 : 1) || a.dist - b.dist);
  let html1 = null, link = null;
  for (const npc of candidates) {
    console.log(`1. talk to ${npc.name} id=${npc.id} (dist ${npc.dist | 0})`);
    const mark = R.htmls.length;
    send({ op: 'talk', id: npc.id });
    const got = await waitFor(() => R.htmls[mark], 20000, `npcHtml from ${npc.name}`).catch(() => null);
    if (!got) continue;
    console.log('   npcHtml snippet:', snippet(got));
    const m = /bypass -h ([^"']+)/.exec(got);
    if (m) { html1 = got; link = m[1].trim(); break; }
    console.log('   (no bypass -h link in this dialog — tutorial chain html)');
  }
  if (!html1) throw new Error('no NPC produced a dialog with bypass links');

  // --- 2. follow one of the dialog's own bypass links ---
  console.log('2. following bypass link:', link);
  const mark2 = R.htmls.length;
  send({ op: 'bypass', command: link });
  const html2 = await waitFor(() => R.htmls[mark2], 20000, 'second npcHtml');
  console.log('   npcHtml after bypass snippet:', snippet(html2));

  // --- 3. .menu html + voiced_ bypass ---
  send({ op: 'say', channel: 0, text: '.menu' });
  const menuHtml = await waitFor(() => R.htmls.find((h) => h.includes('Menu del jugador')), 15000, '.menu npcHtml');
  console.log('3. .menu npcHtml snippet:', snippet(menuHtml));
  const menuLink = /bypass (voiced_[^"]+?)(?:'|")/.exec(menuHtml);
  if (!menuLink) throw new Error('no voiced_ bypass in menu html');
  console.log('   following menu bypass:', menuLink[1]);
  send({ op: 'bypass', command: menuLink[1] });
  const html3 = await waitFor(() => R.htmls.find((h, i) => i > R.htmls.indexOf(menuHtml) && h.includes('Menu del jugador')), 15000, 'menu refresh after voiced_ bypass');
  console.log('   npcHtml #3 (menu refresh) snippet:', snippet(html3));

  console.log('---');
  console.log(`htmls received=${R.htmls.length} actionFailed=${R.actionFailed}`);
  const pass = html1.length > 20 && html2.length > 20 && menuHtml.includes('.autoloot') && html3.length > 20;
  console.log(pass ? 'VERIFY-DIALOG: PASS' : 'VERIFY-DIALOG: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('VERIFY-DIALOG: FAIL', e.message); process.exit(1); });
