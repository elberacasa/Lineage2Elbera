// Scripted WS verification: browser-driven character creation (createChar).
// fresh deviceId -> auth_ok -> createChar (orc female mystic, classId 49)
// -> charCreateOk -> refreshed auth_ok carrying the new char + appearance ->
// negative cases (duplicate name, invalid sex, invalid classId) ->
// enterChar -> enterWorld. ONE session, no reconnects (IPv4Filter anti-flood
// bans fast reconnects for 300s). Works with GATEWAY_AUTOCREATE on or off:
// on (default) the fresh device already has the auto-created Human Fighter
// in the first auth_ok; off it has none — either way we add one char.
'use strict';

const WebSocket = require('ws');

const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const deviceId = process.argv[2] || 'verify-create-' + Date.now();
const charName = ('Z' + Date.now().toString(36)).slice(0, 16); // unique, ^[A-Za-z0-9]{1,16}$

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${label}${detail ? ' — ' + detail : ''}`);
}

let step = 'login';
let initialCount = -1;
let newChar = null;
let createSent = false;

const ws = new WebSocket(url);
ws.on('open', () => {
  ws.send(JSON.stringify({ op: 'login', deviceId }));
});
ws.on('message', async (data) => {
  const msg = JSON.parse(data);
  switch (msg.op) {
    case 'auth_ok': {
      if (step === 'login') {
        initialCount = msg.chars.length;
        console.log(`auth_ok #1: ${initialCount} char(s) — ${JSON.stringify(msg.chars)}`);
        const c0 = msg.chars[0];
        if (c0) {
          check('auth_ok chars carry extended fields',
            ['sex', 'level', 'hairStyle', 'hairColor', 'face'].every((k) => k in c0));
        }
        step = 'creating';
        createSent = true;
        console.log(`createChar ${charName} (orc female mystic, classId 49)`);
        ws.send(JSON.stringify({
          op: 'createChar', name: charName, race: 3, sex: 1, classId: 49,
          hairStyle: 2, hairColor: 1, face: 1,
        }));
      } else if (step === 'await-refresh') {
        check('refreshed auth_ok has one more char', msg.chars.length === initialCount + 1, `count=${msg.chars.length} (was ${initialCount})`);
        newChar = msg.chars.find((c) => c.name === charName);
        check('new char present by name', !!newChar);
        if (newChar) {
          console.log('new char:', JSON.stringify(newChar));
          check('race is orc (3)', newChar.race === 3);
          check('classId is orc mystic (49)', newChar.classId === 49);
          check('sex is female (1)', newChar.sex === 1);
          check('appearance round-trips', newChar.hairStyle === 2 && newChar.hairColor === 1 && newChar.face === 1,
            `hair=${newChar.hairStyle}/${newChar.hairColor} face=${newChar.face}`);
        }
        step = 'dup-name';
        ws.send(JSON.stringify({ op: 'createChar', name: charName, race: 3, sex: 1, classId: 49 }));
      }
      break;
    }
    case 'charCreateOk':
      // The legacy auto-create's CharCreateOk may arrive before our own
      // createChar (GATEWAY_AUTOCREATE=1) — ignore that one.
      if (!createSent || step !== 'creating') {
        console.log('charCreateOk (legacy auto-create, ignored)');
        break;
      }
      check('charCreateOk received', true);
      step = 'await-refresh';
      break;
    case 'charCreateFail': {
      console.log('charCreateFail:', JSON.stringify(msg));
      if (step === 'dup-name') {
        check('duplicate name -> name_already_exists', msg.reason === 'name_already_exists' && msg.code === 2, msg.reason);
        step = 'bad-sex';
        ws.send(JSON.stringify({ op: 'createChar', name: charName + 'x', race: 3, sex: 7, classId: 49 }));
      } else if (step === 'bad-sex') {
        // Rejected gateway-side BEFORE any server round-trip: aCis would
        // have thrown ArrayIndexOutOfBounds with NO fail packet (sex is not
        // validated server-side). No numeric code => never reached aCis.
        check('sex=7 -> invalid_sex (gateway-side, no code)', msg.reason === 'invalid_sex' && msg.code === undefined, msg.reason);
        step = 'bad-class';
        ws.send(JSON.stringify({ op: 'createChar', name: charName + 'y', race: 0, sex: 0, classId: 2 }));
      } else if (step === 'bad-class') {
        // classId 2 (Gladiator) is a real class but post-newbie — not one of
        // the 9 base ids, so the gateway rejects it without a round-trip.
        check('classId=2 (non-base) -> invalid_classId (gateway-side)', msg.reason === 'invalid_classId' && msg.code === undefined, msg.reason);
        step = 'entering';
        ws.send(JSON.stringify({ op: 'enterChar', slot: newChar ? newChar.slot : 0 }));
      }
      break;
    }
    case 'enterWorld':
      console.log('enterWorld:', JSON.stringify(msg.char));
      check('enterWorld as the new char', msg.char.name === charName && msg.char.classId === 49, msg.char.name);
      step = 'done';
      await sleep(500);
      finish();
      break;
  }
});
ws.on('close', () => finish());
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1); });

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  console.log('---');
  const failed = checks.filter((c) => !c.ok);
  const pass = step === 'done' && failed.length === 0;
  console.log(`checks=${checks.length} failed=${failed.length} step=${step}`);
  console.log(pass ? 'VERIFY-CREATE: PASS' : 'VERIFY-CREATE: FAIL');
  process.exit(pass ? 0 : 1);
}
setTimeout(finish, 30000);
