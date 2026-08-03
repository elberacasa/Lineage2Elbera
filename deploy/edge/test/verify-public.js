// Public end-to-end check through the Cloudflare tunnel + edge proxy:
// wss://<tunnel>/ws -> edge -> ElberaGate -> aCis login+game.
// Flow mirrors gateway/test/verify-one.js's first steps:
// login -> auth_ok -> enterChar -> enterWorld. PASS only if all three land.
//
// Usage: node test/verify-public.js https://<sub>.trycloudflare.com [deviceId]

const WebSocket = require('ws');

const pageUrl = process.argv[2];
if (!pageUrl) {
  console.error('usage: node test/verify-public.js https://<sub>.trycloudflare.com [deviceId]');
  process.exit(2);
}
const deviceId = process.argv[3] || `pub-${Date.now().toString(36)}`;
const wsUrl = pageUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';

const state = { authOk: false, enterWorld: false };
const done = (ok, msg) => { console.log(`VERIFY-PUBLIC: ${ok ? 'PASS' : 'FAIL'} (${msg})`); process.exit(ok ? 0 : 1); };
setTimeout(() => done(false, `timeout — authOk=${state.authOk} enterWorld=${state.enterWorld}`), 30000);

console.log(`connecting ${wsUrl} (deviceId ${deviceId})`);
const ws = new WebSocket(wsUrl, { handshakeTimeout: 15000 });
ws.on('open', () => ws.send(JSON.stringify({ op: 'login', deviceId })));
ws.on('error', (e) => done(false, `ws error: ${e.message}`));
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.op === 'auth_ok') {
    state.authOk = true;
    console.log(`auth_ok: ${m.chars.length} char(s)`);
    ws.send(JSON.stringify({ op: 'enterChar', slot: 0 }));
  } else if (m.op === 'enterWorld') {
    state.enterWorld = true;
    console.log(`enterWorld: ${m.char.name} @ ${m.char.x},${m.char.y},${m.char.z}`);
    done(true, `tunnel+edge+gateway+aCis chain live; char ${m.char.name} entered world`);
  }
});
