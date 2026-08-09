// M5 verification (live): chat channels (TELL w/ target, SHOUT), charSheet
// after enterWorld, and .menu passthrough (response = an NpcHtmlMessage
// window, forwarded to this client as the `npcHtml` op).
//
// THE .menu CHECK USED TO READ A LOG FILE, AND THAT WAS THE BUG (2026-08-09).
// It did `fs.readFileSync('gateway.log')` and looked for the string
// "html window". That path only exists if whoever started the gateway
// happened to redirect stdout to ./gateway.log; the gateway running during
// this failure had been started with its stdout going somewhere else
// entirely, so the file on disk was FOUR HOURS STALE and the check read
// `false` while `.menu` was working perfectly — the real log showed the
// 1457-char "L2Vzla - Menu del jugador" window arriving during the very run
// that reported the failure. Two suites (this one and verify-mods) called
// the product broken because of how an operator had redirected a stream.
//
// bridge.js:1366-1367 does `this.send({op:'npcHtml', ...})` BEFORE it logs,
// so the op is strictly better evidence than the log line: it is the actual
// contract, it is what the browser client consumes, and it cannot be
// affected by shell redirection.
'use strict';

const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const suffix = process.argv[2] || String(Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(name, deviceId) {
  const c = { name, ws: new WebSocket(url), state: { me: null, chats: [], charSheets: [], sysMsgs: [], htmls: [] } };
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
    else if (m.op === 'npcHtml') { c.state.htmls.push(m); console.log(`[${name}] npcHtml: ${m.html.length} chars`); }
  });
  return c;
}

(async () => {

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

  // .menu passthrough: the server mod answers with an NpcHtmlMessage, which
  // the gateway forwards as `npcHtml`. Assert on the op, not on a log file.
  const htmlsBefore = A.state.htmls.length;
  A.send({ op: 'say', channel: 0, text: '.menu' });
  await sleep(2500);

  const whisperB = B.state.chats.find((c) => c.channel === 2);
  const echoA = A.state.chats.find((c) => c.channel === 2);
  const shoutB = B.state.chats.find((c) => c.channel === 1);
  // The window must arrive AFTER our .menu (not be a leftover tutorial html
  // from enterWorld) and must actually be the player menu.
  const menuHtml = A.state.htmls.slice(htmlsBefore).find((h) => /Menu del jugador/.test(h.html));

  console.log('---');
  console.log(`charSheet A: str=${sheetA?.str} dex=${sheetA?.dex} con=${sheetA?.con} int=${sheetA?.int} wit=${sheetA?.wit} men=${sheetA?.men}`);
  console.log(`  pAtk=${sheetA?.pAtk} pDef=${sheetA?.pDef} mAtk=${sheetA?.mAtk} mDef=${sheetA?.mDef} acc=${sheetA?.accuracy} eva=${sheetA?.evasion} crit=${sheetA?.critical}`);
  console.log(`  runSpeed=${sheetA?.runSpeed} walkSpeed=${sheetA?.walkSpeed} pAtkSpd=${sheetA?.pAtkSpd} mAtkSpd=${sheetA?.mAtkSpd} maxLoad=${sheetA?.maxLoad}`);
  console.log(`charSheet B present: ${!!sheetB}`);
  console.log(`whisper at B: ${JSON.stringify(whisperB)}`);
  console.log(`whisper echo at A: ${JSON.stringify(echoA)}`);
  console.log(`shout at B: ${JSON.stringify(shoutB)}`);
  console.log(`.menu response (npcHtml op): ${!!menuHtml}`
    + (menuHtml ? ` — ${menuHtml.html.length} chars` : ''));

  const sheetOk = sheetA && sheetB &&
    Number.isInteger(sheetA.str) && sheetA.str >= 30 && sheetA.str <= 90 &&
    sheetA.runSpeed === 115 && sheetA.walkSpeed === 80 && sheetA.mAtkSpd > 0 && sheetA.maxLoad > 0;
  const whisperOk = whisperB && whisperB.from === A.state.me.name && whisperB.target === A.state.me.name &&
    whisperB.text === 'psst, esto es un whisper' &&
    echoA && echoA.target === B.state.me.name;
  const shoutOk = shoutB && shoutB.text === 'grito de prueba m5' && !('target' in shoutB);
  const pass = sheetOk && whisperOk && shoutOk && !!menuHtml;
  console.log(pass ? 'VERIFY-M5: PASS' : 'VERIFY-M5: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('VERIFY-M5: FAIL', e.stack || e.message); process.exit(1); });
