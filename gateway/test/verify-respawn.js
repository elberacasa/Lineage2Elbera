// Respawn vertical verification (no live kill needed — dying live is
// impractical, no lethal mob near spawn):
//  (a) packet-level unit test: craft a Die(0x06) packet per the aCis rev 409
//      layout (serverpackets/Die.java: D objectId, D toVillage, D toClanHall,
//      D toCastle, D toSiegeHQ, D sweepable, D fixedRes) and assert the
//      gameclient parse + the requestRestartPoint(0x6d) sender.
//  (b) end-to-end against the MOCK gateway (spawned on a dedicated port):
//      login -> enterChar -> say "/die" -> die{canRespawn:true} + hp 0 ->
//      respawn{} -> revive + full selfStatus.
// Usage: node test/verify-respawn.js [mockPort]   (default 8086)
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const { GameSession } = require('../src/gameclient.js');
const { PacketReader } = require('../src/l2io.js');

const mockPort = Number(process.argv[2]) || 8086;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// ---------------------------------------------------------------- (a) unit
function unitTests() {
  console.log('-- (a) packet-level unit tests');

  // Die packet payload AFTER the opcode, per serverpackets/Die.java:
  // player with clanhall+castle options, not sweepable, no fixed res.
  const body = Buffer.alloc(7 * 4);
  const dv = [123456, 1, 1, 1, 0, 0, 0];
  dv.forEach((v, i) => body.writeInt32LE(v, i * 4));

  const game = new GameSession();
  const died = [];
  game.on('die', (d) => died.push(d));
  game._dispatch(0x06, new PacketReader(body));

  check('die event emitted once', died.length === 1);
  const d = died[0] || {};
  check('die.id parsed', d.id === 123456, JSON.stringify(d));
  check('die.toVillage parsed', d.toVillage === true);
  check('die.toClanHall parsed', d.toClanHall === true);
  check('die.toCastle parsed', d.toCastle === true);
  check('die.toSiegeHQ parsed', d.toSiegeHQ === false);
  check('die.sweepable parsed', d.sweepable === false);
  check('die.fixedRes parsed', d.fixedRes === false);

  // Monster-style Die: only objectId + toVillage + sweepable set.
  const body2 = Buffer.alloc(7 * 4);
  [77001, 1, 0, 0, 0, 1, 0].forEach((v, i) => body2.writeInt32LE(v, i * 4));
  game._dispatch(0x06, new PacketReader(body2));
  check('monster die parsed', died.length === 2 && died[1].id === 77001 && died[1].sweepable === true);

  // requestRestartPoint: C 0x6d, D requestType.
  const sent = [];
  game._send = (payload) => sent.push(Buffer.from(payload));
  game.requestRestartPoint(0);
  const p = sent[0];
  check('restartRequest sent', !!p);
  check('restartRequest opcode 0x6d', p && p[0] === 0x6d, p && p.toString('hex'));
  check('restartRequest type 0 (to village)', p && p.length === 5 && p.readInt32LE(1) === 0);
}

// ------------------------------------------------------------- (b) mock e2e
async function mockE2E() {
  console.log(`-- (b) end-to-end vs mock gateway on :${mockPort}`);
  const mock = spawn('node', [path.join(__dirname, '../../editor/world/mock_gateway.js'), String(mockPort)], { stdio: 'ignore' });
  await sleep(800);

  const R = { selfId: 0, dieOp: null, hpZero: false, reviveOp: null, statusAfterRespawn: null };
  let phase = 'login';
  let done, failed;
  const finished = new Promise((res, rej) => { done = res; failed = rej; });
  const timer = setTimeout(() => failed(new Error('timeout waiting for respawn flow')), 20000);

  const ws = new WebSocket(`ws://127.0.0.1:${mockPort}`);
  ws.on('error', (e) => { clearTimeout(timer); failed(e); });
  ws.on('open', () => ws.send(JSON.stringify({ op: 'login', deviceId: 'verify-respawn-' + Date.now() })));
  ws.on('message', async (data) => {
    const msg = JSON.parse(data);
    switch (msg.op) {
      case 'auth_ok':
        await sleep(200);
        ws.send(JSON.stringify({ op: 'enterChar', slot: 0 }));
        break;
      case 'enterWorld':
        R.selfId = msg.char.id;
        await sleep(400);
        phase = 'dying';
        ws.send(JSON.stringify({ op: 'say', channel: 0, text: '/die' }));
        break;
      case 'die':
        if (msg.id === R.selfId && phase === 'dying') {
          R.dieOp = msg;
          await sleep(200);
          phase = 'respawning';
          ws.send(JSON.stringify({ op: 'respawn' }));
        }
        break;
      case 'selfStatus':
        if (phase === 'dying' && msg.hp === 0) R.hpZero = true;
        if (phase === 'respawning' && msg.hp > 0) R.statusAfterRespawn = msg;
        break;
      case 'revive':
        if (msg.id === R.selfId && phase === 'respawning') {
          R.reviveOp = msg;
          await sleep(300); // let the full selfStatus land
          clearTimeout(timer);
          done();
        }
        break;
    }
  });

  try {
    await finished;
  } catch (e) {
    failures++;
    console.log(`FAIL mock e2e — ${e.message}`);
  } finally {
    try { ws.close(); } catch (_) { /* ignore */ }
    mock.kill();
  }

  check('self die op received', !!R.dieOp, JSON.stringify(R.dieOp));
  check('self die carries canRespawn:true', !!R.dieOp && R.dieOp.canRespawn === true);
  check('hp hit 0 on death', R.hpZero);
  check('revive op after respawn{}', !!R.reviveOp);
  check('full selfStatus after respawn{}', !!R.statusAfterRespawn,
    R.statusAfterRespawn ? JSON.stringify(R.statusAfterRespawn) : 'none');
}

(async () => {
  unitTests();
  await mockE2E();
  console.log(failures === 0 ? 'PASS' : `FAIL (${failures} checks failed)`);
  process.exit(failures === 0 ? 0 : 1);
})();
