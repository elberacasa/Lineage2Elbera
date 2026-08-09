// Direct protocol smoke test (no WebSocket): login -> game -> char create
// (if needed) -> enter world -> move -> say. Prints every decoded event.
'use strict';

const { login } = require('../src/loginclient.js');
const { GameSession } = require('../src/gameclient.js');
const { deriveCredentials } = require('../src/bridge.js');

const deviceId = process.argv[2] || 'smoke-test-device-1';
const creds = deriveCredentials(deviceId);
console.log('credentials:', creds);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('--- login flow ---');
  const { sessionKey, server } = await login('127.0.0.1', 2106, creds.account, creds.password, 1);
  console.log('login OK, sessionKey:', sessionKey, 'server:', server);

  const game = new GameSession();
  game.on('error', (e) => { console.error('game error:', e.stack || e.message); process.exit(1); });
  game.on('close', () => { console.log('game closed'); process.exit(0); });
  game.on('parseError', (p) => console.error('parseError:', p.op.toString(16), p.error.message));

  let npcCount = 0;
  let playerCount = 0;
  let moveSeen = null;
  let saySeen = null;

  game.on('charList', async (chars) => {
    console.log('charList:', chars.map((c) => `${c.slot}:${c.name} race=${c.race} class=${c.classId}`));
    if (chars.length === 0) {
      console.log('creating character', creds.charName);
      game.createCharacter(creds.charName);
      return;
    }
    await sleep(600); // stay clear of CHARACTER_SELECT flood protector
    console.log('selecting slot 0');
    game.selectChar(0);
  });
  game.on('charCreateOk', () => console.log('charCreateOk'));
  game.on('charCreateFail', (r) => console.error('charCreateFail reason', r));
  game.on('userInfo', async (u) => {
    console.log('userInfo (enterWorld):', u);
    await sleep(3000); // let npc/player streams arrive
    console.log(`seen ${npcCount} npcs, ${playerCount} players`);
    const tx = u.x + 300;
    const ty = u.y + 100;
    console.log(`moveTo -> ${tx},${ty},${u.z}`);
    game.pos = { ...game.pos, x: tx, y: ty };
    game.moveTo(tx, ty, u.z);
    await sleep(2500);
    console.log('say: hola desde el gateway');
    game.say(0, 'hola desde el gateway');
    await sleep(1500);
    console.log('RESULT moveSeen=', moveSeen, 'saySeen=', saySeen, 'npcs=', npcCount, 'players=', playerCount);
    game.close();
  });
  game.on('npcInfo', (n) => { npcCount++; if (npcCount <= 3) console.log('npcInfo:', n); });
  game.on('charInfo', (c) => { playerCount++; console.log('charInfo:', c); });
  game.on('move', (m) => { moveSeen = m; console.log('move:', m); });
  game.on('say', (s) => { saySeen = s; console.log('say:', s); });
  game.on('teleport', (t) => console.log('teleport:', t));
  game.on('delete', (id) => console.log('delete:', id));

  console.log('--- game flow ---');
  game.connect(server.host, server.port, creds.account, sessionKey);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
