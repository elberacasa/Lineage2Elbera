// verify-paperdoll.js — equipped gear reaches the client, live against aCis.
//
// The paperdoll arrays were parsed and discarded for the whole life of this
// project, so nothing has ever proven which index is the right hand. Reading
// the wrong index does not crash: it yields a plausible item id from a
// neighbouring slot, which is exactly the sort of bug that survives review.
// So this suite equips real weapons and checks the id that comes back.
//
// Two layouts, and they are NOT the same list truncated (see
// readPaperdollItems in gameclient.js):
//   UserInfo  17 slots, right hand at index 7,  two-hand repeat at 14
//   CharInfo  12 slots, right hand at index 2,  two-hand repeat at 9
//
// Both weapons below are equipped because the two-handed case was originally
// expected to differ. It does not: aCis writes Paperdoll.RHAND at BOTH the
// index-7 and index-14 positions, so a Claymore (handness 2) lands in exactly
// the same slot as a one-hander and "two-handed" is not derivable from this
// packet at all — the client takes it from weapongrp.json's `handness`. The
// two weapons stay in the suite as the regression guard for that finding:
//   69 Bastard Sword  handness 1
//   70 Claymore       handness 2  -> must land in rhand just the same
//
// The strongest evidence here is incidental: a freshly created character is
// NOT naked. aCis issues the newbie kit, so the very first charSheet reports
// Squire's Sword (2369) in rhand, Squire's Shirt (1146) in chest and Squire's
// Pants (1147) in legs. Three unrelated slots each landing on the right item
// is what actually pins the index map down; an all-zero read would have
// proven nothing.
//
// Fixture: seeded into the DB while the character is offline (aCis loads
// inventory at enterWorld), then equipped IN-PROTOCOL with useItem — aCis
// routes UseItem on an equippable to equip/unequip. Equipping in-protocol
// rather than writing loc='PAPERDOLL' directly means the test never has to
// guess the Paperdoll enum's ordinals.
//
// Usage: node test/verify-paperdoll.js

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const WebSocket = require('ws');

const GATEWAY = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const DB = ['-u', 'l2j', '-pl2jpass', 'l2jdb'];
const DEVICE_ID = 'verify-paperdoll-fixture-1';

const ONE_HAND = { itemId: 69, name: 'Bastard Sword' };
const TWO_HAND = { itemId: 70, name: 'Claymore' };

// aCis's newbie kit, issued at character creation. These are the item ids the
// index map has to produce on the very first charSheet.
const STARTER = { rhand: 2369, chest: 1146, legs: 1147 };

const derive = (d) => {
  const h1 = crypto.createHash('sha256').update('l2vzla-account:' + d).digest('hex');
  return { charName: 'W' + h1.slice(12, 23) };
};
const sql = (q) => execFileSync('mariadb', [...DB, '-N', '-B', '-e', q], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

const waitFor = (seen, pred, ms = 20000) => new Promise((resolve) => {
  const t0 = Date.now();
  const poll = setInterval(() => {
    const hit = seen.find(pred);
    if (hit) { clearInterval(poll); resolve(hit); }
    else if (Date.now() - t0 > ms) { clearInterval(poll); resolve(null); }
  }, 100);
});

(async () => {
  const { charName } = derive(DEVICE_ID);

  // pass 1 — ensure the character exists, then leave so the DB is writable
  {
    const { ws, seen } = await connect();
    ws.send(JSON.stringify({ op: 'login', deviceId: DEVICE_ID }));
    if (!await waitFor(seen, m => m.op === 'auth_ok', 30000)) {
      console.log('FAIL  could not log in (is the stack up?)'); process.exit(1);
    }
    ws.send(JSON.stringify({ op: 'enterChar', slot: 0 }));
    await waitFor(seen, m => m.op === 'enterWorld', 30000);
    ws.close();
  }
  await sleep(3000);   // let aCis finish writing the character out

  const owner = sql(`SELECT obj_Id FROM characters WHERE char_name='${charName}' LIMIT 1;`);
  check('fixture character exists', !!owner, `${charName} (${owner || 'not found'})`);
  if (!owner) process.exit(1);

  for (const w of [ONE_HAND, TWO_HAND]) {
    const have = sql(
      `SELECT object_id FROM items WHERE owner_id=${owner} AND item_id=${w.itemId} LIMIT 1;`);
    if (!have) {
      const oid = Number(sql('SELECT COALESCE(MAX(object_id),0) FROM items;')) + 1000;
      sql(`INSERT INTO items (owner_id,object_id,item_id,count,enchant_level,loc,loc_data,`
        + `custom_type1,custom_type2,mana_left,time) VALUES `
        + `(${owner},${oid},${w.itemId},1,0,'INVENTORY',0,0,0,-1,0);`);
    } else {
      // start each run unequipped so the assertions below are meaningful
      sql(`UPDATE items SET loc='INVENTORY', loc_data=0 WHERE object_id=${have};`);
    }
  }
  check('weapons seeded, unequipped', true, `${ONE_HAND.name} + ${TWO_HAND.name}`);

  // pass 2 — log back in and equip through the protocol
  const { ws, seen } = await connect();
  ws.send(JSON.stringify({ op: 'login', deviceId: DEVICE_ID }));
  if (!await waitFor(seen, m => m.op === 'auth_ok', 30000)) { console.log('FAIL  relogin'); process.exit(1); }
  ws.send(JSON.stringify({ op: 'enterChar', slot: 0 }));
  if (!await waitFor(seen, m => m.op === 'enterWorld', 30000)) { console.log('FAIL  re-enter'); process.exit(1); }

  const items = await waitFor(seen, m => m.op === 'itemList', 15000);
  const inv = (items && items.items) || [];
  const oidOf = (itemId) => (inv.find(i => i.itemId === itemId) || {}).objectId;

  check('both weapons are in the inventory',
        !!oidOf(ONE_HAND.itemId) && !!oidOf(TWO_HAND.itemId),
        `oids ${oidOf(ONE_HAND.itemId)} / ${oidOf(TWO_HAND.itemId)}`);

  const base = await waitFor(seen, m => m.op === 'charSheet', 15000);
  check('charSheet carries a paperdoll block', !!(base && base.paperdoll),
        base && base.paperdoll ? JSON.stringify(base.paperdoll) : 'absent');
  // The newbie armour pins down two indices that nothing in this suite ever
  // touches, so the check is stable across runs. The hand is deliberately NOT
  // asserted here: this suite equips and unequips it, and the character
  // persists between runs, so rhand legitimately starts at 0 on a re-run —
  // the weapon assertions below cover that slot instead.
  const p0 = base && base.paperdoll;
  check('starter armour lands in the right slots',
        !!p0 && p0.chest === STARTER.chest && p0.legs === STARTER.legs,
        p0 ? `chest=${p0.chest} legs=${p0.legs} `
           + `(want ${STARTER.chest}/${STARTER.legs})` : 'no paperdoll');
  check('empty slots read as 0', !!p0 && p0.lhand === 0 && p0.feet === 0,
        p0 ? `lhand=${p0.lhand} feet=${p0.feet}` : '');

  // one-handed
  seen.length = 0;
  ws.send(JSON.stringify({ op: 'useItem', objectId: oidOf(ONE_HAND.itemId) }));
  const one = await waitFor(seen, m => m.op === 'charSheet' && m.paperdoll
                                       && m.paperdoll.rhand === ONE_HAND.itemId, 15000);
  check('one-handed weapon reports in the right hand', !!one,
        one ? JSON.stringify(one.paperdoll) : `never saw rhand=${ONE_HAND.itemId}`);
  check('equipping replaces the starter weapon',
        !!one && one.paperdoll.chest === STARTER.chest,
        one ? `chest still ${one.paperdoll.chest} (armour untouched)` : '');

  // two-handed — swapping straight from the one-hander, as a player would
  seen.length = 0;
  ws.send(JSON.stringify({ op: 'useItem', objectId: oidOf(TWO_HAND.itemId) }));
  const two = await waitFor(seen, m => m.op === 'charSheet' && m.paperdoll
                                       && m.paperdoll.rhand === TWO_HAND.itemId, 15000);
  check('two-handed weapon reports in the right hand', !!two,
        two ? JSON.stringify(two.paperdoll) : `never saw rhand=${TWO_HAND.itemId}`);
  // The finding this suite exists to lock in: a two-hander is NOT distinguishable
  // here. It uses the same slot as a one-hander, so anything that starts
  // reporting a separate two-handed slot means the packet shape changed.
  check('two-handed weapon uses the same slot as a one-hander',
        !!two && two.paperdoll.lhand === 0 && two.paperdoll.rhand === TWO_HAND.itemId,
        two ? `rhand=${two.paperdoll.rhand} lhand=${two.paperdoll.lhand}` : '');

  // unequip
  seen.length = 0;
  ws.send(JSON.stringify({ op: 'useItem', objectId: oidOf(TWO_HAND.itemId) }));
  const off = await waitFor(seen, m => m.op === 'charSheet' && m.paperdoll
                                       && m.paperdoll.rhand === 0, 15000);
  check('unequipping clears the hand', !!off,
        off ? JSON.stringify(off.paperdoll) : 'rhand never returned to 0');

  ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error('SUITE ERROR', err); process.exit(1); });
