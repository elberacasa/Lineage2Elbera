// verify-shots.js — soulshot automation, live against aCis.
//
// Asserts the whole path a shot takes, in both directions:
//   out  autoShot{itemId,enable} -> RequestAutoSoulShot, which is the client
//        ->server EXTENDED opcode 0xD0 + writeH(5) (NOT the 0xFE the server
//        uses coming back — that asymmetry is the easy way to get this wrong)
//   in   ExAutoSoulShot (0xFE, sub 0x12) -> autoShotState{itemId,enabled}
//
// The server answers ExAutoSoulShot ONLY on success: RequestAutoSoulShot
// returns silently when the item is not in the inventory, so "no reply" is a
// real outcome and this suite checks both — a toggle that takes, and one that
// is correctly refused for an item the character does not carry.
//
// Fixture: the character needs shots in its inventory. Buying them in-protocol
// means walking to a merchant (verify-shop takes ~9 minutes for exactly that),
// so instead the shots are seeded straight into the DB while the character is
// OFFLINE — aCis loads inventory from the DB at enterWorld, so it must be
// seeded before login, and seeding a logged-in character would be invisible.
//
// Usage: node test/verify-shots.js

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const WebSocket = require('ws');

const GATEWAY = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const DB = ['-u', 'l2j', '-pl2jpass', 'l2jdb'];

// Fixed device id so the fixture targets one stable character across runs
// instead of littering the DB with a new one each time.
const DEVICE_ID = 'verify-shots-fixture-1';
const SOULSHOT_D = 1463;      // tools/dat/export_shots.py: kind soulshot, grade D
const NOT_CARRIED = 1467;     // Soulshot: S-grade — deliberately never seeded

function derive(deviceId) {
  const h1 = crypto.createHash('sha256').update('l2vzla-account:' + deviceId).digest('hex');
  return { account: 'w' + h1.slice(0, 12), charName: 'W' + h1.slice(12, 23) };
}

function sql(query) {
  return execFileSync('mariadb', [...DB, '-N', '-B', '-e', query], { encoding: 'utf8' }).trim();
}

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY);
    const seen = [];
    ws.on('message', (d) => { try { seen.push(JSON.parse(d)); } catch { /* non-JSON */ } });
    ws.on('open', () => resolve({ ws, seen }));
    ws.on('error', reject);
  });
}

const waitFor = (seen, op, ms = 20000) => new Promise((resolve) => {
  const t0 = Date.now();
  const poll = setInterval(() => {
    const hit = seen.find(m => m.op === op);
    if (hit) { clearInterval(poll); resolve(hit); }
    else if (Date.now() - t0 > ms) { clearInterval(poll); resolve(null); }
  }, 100);
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const { account, charName } = derive(DEVICE_ID);

  // --- pass 1: make sure the character exists, then disconnect -------------
  {
    const { ws, seen } = await connect();
    ws.send(JSON.stringify({ op: 'login', deviceId: DEVICE_ID }));
    const auth = await waitFor(seen, 'auth_ok', 30000);
    if (!auth) { console.log('FAIL  could not log in (is the stack up?)'); process.exit(1); }
    ws.send(JSON.stringify({ op: 'enterChar', slot: 0 }));
    await waitFor(seen, 'enterWorld', 30000);
    ws.close();
  }
  // aCis writes the character out on logout; give it a moment before we touch
  // the same rows, or the seed can be overwritten by the save.
  await sleep(3000);

  const owner = sql(`SELECT obj_Id FROM characters WHERE char_name='${charName}' LIMIT 1;`);
  check('fixture character exists', !!owner, `${charName} (${owner || 'not found'})`);
  if (!owner) process.exit(1);

  // --- seed the shots while offline ---------------------------------------
  const online = sql(`SELECT online FROM characters WHERE obj_Id=${owner};`);
  check('character is offline before seeding', online === '0', `online=${online}`);

  const existing = sql(
    `SELECT object_id FROM items WHERE owner_id=${owner} AND item_id=${SOULSHOT_D} LIMIT 1;`);
  if (existing) {
    sql(`UPDATE items SET count=5000 WHERE object_id=${existing};`);
  } else {
    // object_id must not collide with any live object; the server allocates
    // from its own id factory, so take one well above the current maximum.
    const maxId = sql('SELECT COALESCE(MAX(object_id),0) FROM items;');
    const oid = Number(maxId) + 1000;
    sql(`INSERT INTO items (owner_id,object_id,item_id,count,enchant_level,loc,loc_data,`
      + `custom_type1,custom_type2,mana_left,time) VALUES `
      + `(${owner},${oid},${SOULSHOT_D},5000,0,'INVENTORY',0,0,0,-1,0);`);
  }
  const seeded = sql(
    `SELECT count FROM items WHERE owner_id=${owner} AND item_id=${SOULSHOT_D} LIMIT 1;`);
  check('soulshots seeded into inventory', Number(seeded) > 0, `count=${seeded}`);

  // --- pass 2: log back in and drive the toggle ---------------------------
  const { ws, seen } = await connect();
  ws.send(JSON.stringify({ op: 'login', deviceId: DEVICE_ID }));
  if (!await waitFor(seen, 'auth_ok', 30000)) { console.log('FAIL  relogin'); process.exit(1); }
  ws.send(JSON.stringify({ op: 'enterChar', slot: 0 }));
  if (!await waitFor(seen, 'enterWorld', 30000)) { console.log('FAIL  re-enterWorld'); process.exit(1); }

  const items = await waitFor(seen, 'itemList', 15000);
  const carried = items && (items.items || []).find(i => i.itemId === SOULSHOT_D);
  check('server reports the shots in the inventory', !!carried,
        carried ? `objectId=${carried.objectId} count=${carried.count}` : 'absent');

  // enable
  seen.length = 0;
  ws.send(JSON.stringify({ op: 'autoShot', itemId: SOULSHOT_D, enable: true }));
  const on = await waitFor(seen, 'autoShotState', 15000);
  check('enabling automatic use is confirmed', !!on && on.itemId === SOULSHOT_D && on.enabled === true,
        on ? JSON.stringify(on) : 'no ExAutoSoulShot');

  // disable
  seen.length = 0;
  ws.send(JSON.stringify({ op: 'autoShot', itemId: SOULSHOT_D, enable: false }));
  const off = await waitFor(seen, 'autoShotState', 15000);
  check('disabling automatic use is confirmed', !!off && off.enabled === false,
        off ? JSON.stringify(off) : 'no ExAutoSoulShot');

  // an item the character does not carry: the server must stay silent
  seen.length = 0;
  ws.send(JSON.stringify({ op: 'autoShot', itemId: NOT_CARRIED, enable: true }));
  await sleep(4000);
  const bogus = seen.find(m => m.op === 'autoShotState');
  check('a shot we do not carry is refused silently', !bogus,
        bogus ? `unexpected ${JSON.stringify(bogus)}` : 'no reply, as aCis specifies');

  ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error('SUITE ERROR', err); process.exit(1); });
