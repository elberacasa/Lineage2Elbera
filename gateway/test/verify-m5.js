// M5 verification (live): chat channels (TELL w/ target, SHOUT), charSheet
// after enterWorld, and .menu passthrough (response observed in gateway log
// as an NpcHtmlMessage window — not a contract op).
'use strict';

const WebSocket = require('ws');
const fs = require('fs');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const suffix = process.argv[2] || String(Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(name, deviceId) {
  const c = { name, ws: new WebSocket(url), state: { me: null, chats: [], charSheets: [], sysMsgs: [] } };
  c.queue = [];
  c.send = (o) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); else c.queue.push(o); };
  c.ws.on('open', () => { for (const o of c.queue.splice(0)) c.ws.send(JSON.stringify(o)); });
  c.ws.on('error', (e) => { console.error(`[${name}] ws error:`, e.message); process.exit(1); });
  c.ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.op === 'enterWorld') c.state.me = m.char;
    else if (m.op === 'chat') { c.state.chats.push(m); console.log(`[${name}] chat:`, JSON.stringify(m)); }
    else if (m.op === 'charSheet') { c.state.charSheets.push(m); }
    else if (m.op === 'sysMsg') c.state.sysMsgs.push(m);
  });
  return c;
}

(async () => {
  const logSizeBefore = fs.existsSync('gateway.log') ? fs.statSync('gateway.log').size : 0;

  const A = makeClient('A', 'verify-m5-A-' + suffix);
  const B = makeClient('B', 'verify-m5-B-' + suffix);
  A.send({ op: 'login', deviceId: 'verify-m5-A-' + suffix });
  await sleep(600);
  B.send({ op: 'login', deviceId: 'verify-m5-B-' + suffix });
  await sleep(3500);
  A.send({ op: 'enterChar', slot: 0 });
  await sleep(500);
  B.send({ op: 'enterChar', slot: 0 });
  await sleep(5000);
  if (!A.state.me || !B.state.me) throw new Error('enterWorld missing');
  console.log('[A]', A.state.me.name, '[B]', B.state.me.name);

  // charSheet must have arrived right after enterWorld.
  const sheetA = A.state.charSheets[0];
  const sheetB = B.state.charSheets[0];
  console.log('[A] charSheet:', JSON.stringify(sheetA));

  // Whisper A -> B.
  A.send({ op: 'say', channel: 2, target: B.state.me.name, text: 'psst, esto es un whisper' });
  await sleep(2000);

  // Shout A.
  A.send({ op: 'say', channel: 1, text: 'grito de prueba m5' });
  await sleep(2000);

  // .menu passthrough (response = NpcHtmlMessage, logged by the gateway).
  A.send({ op: 'say', channel: 0, text: '.menu' });
  await sleep(2500);

  const whisperB = B.state.chats.find((c) => c.channel === 2);
  const echoA = A.state.chats.find((c) => c.channel === 2);
  const shoutB = B.state.chats.find((c) => c.channel === 1);
  const menuLogged = fs.readFileSync('gateway.log').subarray(logSizeBefore).toString().includes('html window');

  console.log('---');
  console.log(`charSheet A: str=${sheetA?.str} dex=${sheetA?.dex} con=${sheetA?.con} int=${sheetA?.int} wit=${sheetA?.wit} men=${sheetA?.men}`);
  console.log(`  pAtk=${sheetA?.pAtk} pDef=${sheetA?.pDef} mAtk=${sheetA?.mAtk} mDef=${sheetA?.mDef} acc=${sheetA?.accuracy} eva=${sheetA?.evasion} crit=${sheetA?.critical}`);
  console.log(`  runSpeed=${sheetA?.runSpeed} walkSpeed=${sheetA?.walkSpeed} pAtkSpd=${sheetA?.pAtkSpd} mAtkSpd=${sheetA?.mAtkSpd} maxLoad=${sheetA?.maxLoad}`);
  console.log(`charSheet B present: ${!!sheetB}`);
  console.log(`whisper at B: ${JSON.stringify(whisperB)}`);
  console.log(`whisper echo at A: ${JSON.stringify(echoA)}`);
  console.log(`shout at B: ${JSON.stringify(shoutB)}`);
  console.log(`.menu response (html window in gateway log): ${menuLogged}`);

  const sheetOk = sheetA && sheetB &&
    Number.isInteger(sheetA.str) && sheetA.str >= 30 && sheetA.str <= 90 &&
    sheetA.runSpeed === 115 && sheetA.walkSpeed === 80 && sheetA.mAtkSpd > 0 && sheetA.maxLoad > 0;
  const whisperOk = whisperB && whisperB.from === A.state.me.name && whisperB.target === A.state.me.name &&
    whisperB.text === 'psst, esto es un whisper' &&
    echoA && echoA.target === B.state.me.name;
  const shoutOk = shoutB && shoutB.text === 'grito de prueba m5' && !('target' in shoutB);
  const pass = sheetOk && whisperOk && shoutOk && menuLogged;
  console.log(pass ? 'VERIFY-M5: PASS' : 'VERIFY-M5: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('VERIFY-M5: FAIL', e.stack || e.message); process.exit(1); });
