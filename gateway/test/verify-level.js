// Level-field verification: addNpc.level (Gremlin = 1 per datapack template),
// addPlayer.level present (null — aCis 409 CharInfo has no level field),
// target_ok.color (viewer level - target level) for a targeted monster.
'use strict';

const WebSocket = require('ws');
const { execSync } = require('child_process');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const deviceId = process.argv[2] || 'verify-level-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const R = { me: null, npcs: [], players: [], targetOk: null, selfLevel: 1 };
const ws = new WebSocket(url);
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1); });
ws.on('open', () => ws.send(JSON.stringify({ op: 'login', deviceId })));
ws.on('message', async (d) => {
  const m = JSON.parse(d);
  switch (m.op) {
    case 'auth_ok': await sleep(400); ws.send(JSON.stringify({ op: 'enterChar', slot: 0 })); break;
    case 'enterWorld': R.me = m.char; break;
    case 'selfStatus': R.selfLevel = m.level; break;
    case 'addNpc': R.npcs.push(m); break;
    case 'addPlayer': R.players.push(m); break;
    case 'target_ok': R.targetOk = m; break;
  }
});

(async () => {
  const t0 = Date.now();
  while (!R.me && Date.now() - t0 < 60000) await sleep(250);
  if (!R.me) throw new Error('no enterWorld');
  await sleep(3500); // npc/player stream

  const gremlins = R.npcs.filter((n) => n.name === 'Gremlin');
  const withLevel = R.npcs.filter((n) => n.level !== null && n.level !== undefined);
  const gremlinLevels = [...new Set(gremlins.map((g) => g.level))];

  // cross-check against the datapack template (npc 18342 = Gremlin)
  const xml = execSync(`grep -A4 'npc id="18342"' /Users/alejandroberacasa/l2vzla/server/aCis_gameserver/build/dist/gameserver/data/xml/npcs/18000-18999.xml | grep 'name="level"'`).toString().trim();
  console.log('datapack gremlin template:', xml);

  // target the nearest gremlin for target_ok.color
  const g = gremlins
    .map((n) => ({ ...n, dist: Math.hypot(n.x - R.me.x, n.y - R.me.y) }))
    .sort((a, b) => a.dist - b.dist)[0];
  ws.send(JSON.stringify({ op: 'target', id: g.id }));
  await sleep(2000);

  console.log('sample addNpc:', JSON.stringify(R.npcs.find((n) => n.name === 'Gremlin')));
  if (R.players.length) console.log('sample addPlayer:', JSON.stringify(R.players[0]));
  console.log('target_ok:', JSON.stringify(R.targetOk));
  console.log('---');
  console.log(`npcs=${R.npcs.length} withLevel=${withLevel.length} gremlinLevels=${JSON.stringify(gremlinLevels)}`);
  console.log(`self level=${R.selfLevel} gremlin level=${g.level} target_ok.color=${R.targetOk?.color}`);

  const npcLevelOk = gremlins.length > 0 && gremlinLevels.length === 1 && gremlinLevels[0] === 1;
  const playerFieldOk = R.players.length === 0 || R.players.every((p) => 'level' in p);
  const targetOk = R.targetOk && R.targetOk.id === g.id &&
    R.targetOk.color === R.selfLevel - g.level;
  const pass = npcLevelOk && playerFieldOk && targetOk;
  console.log(pass ? 'VERIFY-LEVEL: PASS' : 'VERIFY-LEVEL: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('VERIFY-LEVEL: FAIL', e.message); process.exit(1); });
