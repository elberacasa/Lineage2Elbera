// M3 combat verification (single client): login -> enterWorld -> target a
// Gremlin -> attack until it dies. Asserts: target_ok, attack ops with
// damage > 0, status ops for the target (hp decreasing), selfStatus (own hp
// drops, exp gained), die op, corpse removal (remove op).
'use strict';

const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const deviceId = process.argv[2] || 'verify-combat-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const R = {
  me: null,
  selfInit: null,
  selfLatest: null,
  targetOk: false,
  targetId: 0,
  npcs: [],
  attacks: [], // {id, targetId, damage, critical, miss}
  targetStatuses: [],
  targetDied: false,
  targetRemoved: false,
  selfDied: false,
  sysDmg: 0,
  moves: new Map(), // id -> last move target {x,y,z}
};

const ws = new WebSocket(url);
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1); });
ws.on('open', () => ws.send(JSON.stringify({ op: 'login', deviceId })));

ws.on('message', async (data) => {
  const msg = JSON.parse(data);
  switch (msg.op) {
    case 'auth_ok':
      console.log('auth_ok:', JSON.stringify(msg.chars));
      await sleep(400);
      ws.send(JSON.stringify({ op: 'enterChar', slot: 0 }));
      break;
    case 'enterWorld':
      R.me = msg.char;
      console.log('enterWorld:', JSON.stringify(msg.char));
      await sleep(3000);
      startCombat();
      break;
    case 'selfStatus':
      if (!R.selfInit) {
        R.selfInit = msg;
        console.log('selfStatus (initial):', JSON.stringify(msg));
      }
      R.selfLatest = msg;
      break;
    case 'addNpc':
      R.npcs.push(msg);
      break;
    case 'target_ok':
      if (msg.id === R.targetId) {
        R.targetOk = true;
        console.log('target_ok:', msg.id);
      }
      break;
    case 'status':
      if (msg.id === R.targetId) {
        R.targetStatuses.push(msg);
        if (R.targetStatuses.length <= 3 || msg.hp === 0) console.log('status(target):', JSON.stringify(msg));
      }
      break;
    case 'attack':
      R.attacks.push(msg);
      if (R.attacks.length <= 5) console.log('attack:', JSON.stringify(msg));
      break;
    case 'move':
      R.moves.set(msg.id, { x: msg.tx, y: msg.ty, z: msg.tz });
      break;
    case 'die':
      console.log('die:', msg.id, msg.id === R.targetId ? '(TARGET)' : msg.id === R.me.id ? '(SELF)' : '');
      if (msg.id === R.targetId) R.targetDied = true;
      if (msg.id === R.me.id) R.selfDied = true;
      break;
    case 'remove':
      if (msg.id === R.targetId) {
        R.targetRemoved = true;
        console.log('remove (corpse decayed):', msg.id);
      }
      break;
  }
});

async function startCombat() {
  const me = R.me;
  // Nearest Gremlin (attackable starter-village monster).
  const gremlins = R.npcs
    .filter((n) => n.name === 'Gremlin')
    .map((n) => ({ ...n, dist: Math.hypot(n.x - me.x, n.y - me.y) }))
    .sort((a, b) => a.dist - b.dist);
  if (!gremlins.length) {
    console.error('no Gremlin found in addNpc stream');
    return finish();
  }
  // Try up to 2 gremlins: occasionally the first one is contested/dead on
  // the shared dev server and never produces attack ops.
  for (const g of gremlins.slice(0, 2)) {
    R.targetId = g.id;
    const dealtMark = R.attacks.length;
    console.log(`targeting Gremlin id=${g.id} at ${g.x},${g.y} (dist ${g.dist | 0})`);
    ws.send(JSON.stringify({ op: 'target', id: g.id }));
    await sleep(1000);

    // With geodata active the ranged auto-approach on AttackRequest can
    // stall: walk NEXT to the gremlin first, then attack. Bail to the next
    // gremlin if no attack ops appear within 25s of engagement.
    const t0 = Date.now();
    while (!R.targetDied && !R.selfDied && Date.now() - t0 < 120000) {
      if (R.attacks.length === dealtMark && Date.now() - t0 > 25000) break; // unresponsive gremlin
      const pos = R.moves.get(g.id) || g;
      const mePos = R.moves.get(R.me.id) || R.me;
      ws.send(JSON.stringify({ op: 'moveTo', x: pos.x + 20, y: pos.y, z: pos.z }));
      const walkMs = Math.min(12000, (Math.hypot(pos.x - mePos.x, pos.y - mePos.y) / 115) * 1000 + 2500);
      await sleep(walkMs);
      const t1 = Date.now();
      while (!R.targetDied && !R.selfDied && Date.now() - t1 < 12000) {
        ws.send(JSON.stringify({ op: 'attack', id: g.id }));
        await sleep(4000);
      }
    }
    if (R.targetDied || R.selfDied || R.attacks.length > dealtMark) break; // engaged or done
    console.log('gremlin unresponsive, trying another...');
  }
  console.log(R.targetDied ? 'gremlin dead, waiting for corpse decay...' : 'combat ended without kill');
  // Wait for decay (remove op) up to 20s.
  const t1 = Date.now();
  while (!R.targetRemoved && Date.now() - t1 < 20000) await sleep(1000);
  await sleep(1500); // let final selfStatus (exp) arrive
  finish();
}

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  const dmgDealt = R.attacks.filter((a) => a.id === R.me?.id && a.targetId === R.targetId && a.damage > 0);
  const dmgTaken = R.attacks.filter((a) => a.targetId === R.me?.id);
  const hpDrops = R.targetStatuses.map((s) => s.hp);
  const hpDecreasing = hpDrops.length >= 2 && hpDrops[hpDrops.length - 1] < hpDrops[0];
  const expGained = R.selfLatest && R.selfInit && R.selfLatest.exp > R.selfInit.exp;
  console.log('---');
  console.log(`targetOk=${R.targetOk}`);
  console.log(`attacks dealt=${dmgDealt.length} (crits=${dmgDealt.filter((a) => a.critical).length}, misses=${dmgDealt.filter((a) => a.miss).length}) taken=${dmgTaken.length}`);
  console.log(`target status updates=${R.targetStatuses.length} hp ${hpDrops[0]} -> ${hpDrops[hpDrops.length - 1]} decreasing=${hpDecreasing}`);
  console.log(`self hp: init=${R.selfInit?.hp} latest=${R.selfLatest?.hp} maxHp=${R.selfLatest?.maxHp}`);
  console.log(`self exp: init=${R.selfInit?.exp} latest=${R.selfLatest?.exp} gained=${expGained} sp=${R.selfLatest?.sp}`);
  console.log(`targetDied=${R.targetDied} targetRemoved=${R.targetRemoved} selfDied=${R.selfDied}`);
  const pass = R.targetOk && dmgDealt.length > 0 && hpDecreasing && R.targetDied && R.targetRemoved && expGained && !R.selfDied;
  console.log(pass ? 'VERIFY-COMBAT: PASS' : 'VERIFY-COMBAT: FAIL');
  process.exit(pass ? 0 : 1);
}
setTimeout(finish, 200000);
