// Scripted WS verification: one browser-equivalent client through the gateway.
// login -> auth_ok -> enterChar -> enterWorld + world stream -> moveTo -> say.
'use strict';

const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const deviceId = process.argv[2] || 'verify-one-' + Date.now();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { authOk: null, enterWorld: null, npcs: 0, players: 0, moves: 0, chatEcho: null, firstNpc: null };
const seen = new Set();

const ws = new WebSocket(url);
ws.on('open', async () => {
  ws.send(JSON.stringify({ op: 'login', deviceId }));
});
ws.on('message', async (data) => {
  const msg = JSON.parse(data);
  switch (msg.op) {
    case 'auth_ok':
      results.authOk = msg;
      console.log('auth_ok:', JSON.stringify(msg));
      await sleep(400);
      ws.send(JSON.stringify({ op: 'enterChar', slot: 0 }));
      break;
    case 'enterWorld':
      results.enterWorld = msg;
      console.log('enterWorld:', JSON.stringify(msg));
      await sleep(3000); // collect world stream
      const c = msg.char;
      const tx = c.x + 400;
      const ty = c.y - 250;
      console.log(`moveTo ${tx},${ty},${c.z}`);
      ws.send(JSON.stringify({ op: 'moveTo', x: tx, y: ty, z: c.z }));
      await sleep(2500);
      ws.send(JSON.stringify({ op: 'say', channel: 0, text: 'prueba gateway M2' }));
      await sleep(1500);
      finish();
      break;
    case 'addNpc':
      results.npcs++;
      if (!results.firstNpc) { results.firstNpc = msg; console.log('addNpc (first):', JSON.stringify(msg)); }
      break;
    case 'addPlayer':
      results.players++;
      console.log('addPlayer:', JSON.stringify(msg));
      break;
    case 'move':
      if (!seen.has(msg.id)) seen.add(msg.id);
      results.moves++;
      break;
    case 'remove':
      break;
    case 'chat':
      results.chatEcho = msg;
      console.log('chat:', JSON.stringify(msg));
      break;
  }
});
ws.on('close', () => finish());
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1); });

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  const pass = results.authOk && results.enterWorld && results.npcs > 0 && results.chatEcho;
  console.log('---');
  console.log(`authOk=${!!results.authOk} enterWorld=${!!results.enterWorld} npcs=${results.npcs} players=${results.players} moves=${results.moves} chatEcho=${!!results.chatEcho}`);
  console.log(pass ? 'VERIFY-ONE: PASS' : 'VERIFY-ONE: FAIL');
  process.exit(pass ? 0 : 1);
}
setTimeout(finish, 25000);
