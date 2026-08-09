// Stable per-suite login fixture for the *_live browser suites.
//
// THE DEFECT THIS EXISTS TO KILL (measured 2026-08-09, not inferred):
//   A headless Chrome launched by puppeteer gets a FRESH profile, so
//   localStorage has no `l2vzla.deviceId`. js/net.js:32-38 mints a random
//   uuid, the gateway derives a NEVER-BEFORE-SEEN account from it
//   (gateway/src/bridge.js:69 deriveCredentials), and js/main.js:360-365
//   sends login{noAutoCreate:true} — so bridge.js:666 SKIPS the legacy
//   auto-create and the client correctly receives `auth_ok {chars: []}`.
//   The client then opens the character-creation overlay and waits.
//   Probed directly on a fresh profile:
//     ops       ["login","auth_ok"]
//     auth_ok   {chars: []}
//     charCreate.open  true          <-- the product is behaving CORRECTLY
//   The suites then blow their 120 s wait for an `enterWorld` that can never
//   arrive. That is a HARNESS defect. It cost the battery nine live rows.
//
//   (Note the property name: `charCreate.open`. `charCreate.visible` is
//   undefined and reads as false — one wrong property away from filing a
//   critical bug against correct code. See HANDOFF §5.)
//
// THE FIX, in two halves, both of which a suite needs:
//   1. seed(page, deviceId) — pin a STABLE deviceId before the first script
//      runs, so every run of a suite lands on the SAME account.
//   2. ensureChar(deviceId) — make sure that account actually HAS a
//      character, because a stable deviceId whose account is empty hangs in
//      exactly the same way. This does NOT touch the database: it opens one
//      websocket to the real gateway and logs in WITHOUT noAutoCreate, which
//      is the gateway's own documented legacy auto-create path
//      (bridge.js:666-673, default Human Fighter). The character is created
//      by the real server through the real protocol, or not at all.
//
// Usage in a suite:
//     const fixture = require('./live_fixture');
//     const DEVICE_ID = 'verify-minimap-fixture-1';   // STABLE. No Date.now().
//     ...
//     await fixture.ensureChar(DEVICE_ID);            // before launching
//     await fixture.seed(page, DEVICE_ID);            // before page.goto
//
// Usage as a gate:
//     node live_fixture.js --check
//   Audits every `live` suite in tools/battery.sh and FAILS if any of them
//   would log into a fresh account. Exits 1 with the offender list.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://127.0.0.1:8090';
const DB = ['-u', 'l2j', '-pl2jpass', 'l2jdb'];

// MIRRORS gateway/src/bridge.js:69-77 deriveCredentials(). If that function
// changes, this must change with it — verified by --check below, which
// re-derives from the gateway source rather than trusting this copy.
function derive(deviceId) {
  const id = String(deviceId || 'anonymous');
  const h1 = crypto.createHash('sha256').update('l2vzla-account:' + id).digest('hex');
  const h2 = crypto.createHash('sha256').update('l2vzla-pass:' + id).digest('hex');
  return {
    account: 'w' + h1.slice(0, 12),
    password: h2.slice(0, 16),
    charName: 'W' + h1.slice(12, 23),
  };
}

function sql(query) {
  return execFileSync('mariadb', [...DB, '-N', '-B', '-e', query], { encoding: 'utf8' }).trim();
}

// obj_Id of the fixture character, or '' if the account has never had one.
function charIdFor(deviceId) {
  const { charName } = derive(deviceId);
  return sql(`SELECT obj_Id FROM characters WHERE char_name='${charName}'`);
}

// Create the fixture character through the REAL gateway + REAL aCis if it
// does not exist yet. Idempotent: a second call is a single DB SELECT.
// Returns { charName, charId, created }.
async function ensureChar(deviceId, { timeoutMs = 45000 } = {}) {
  const { charName } = derive(deviceId);
  let charId = charIdFor(deviceId);
  if (charId) return { charName, charId, created: false };

  const WebSocket = require(path.join(ROOT, 'gateway', 'node_modules', 'ws'));
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_URL);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error(`live_fixture: gateway never returned a populated auth_ok for `
        + `${charName} within ${timeoutMs}ms`));
    }, timeoutMs);
    const done = (err) => { clearTimeout(timer); try { ws.close(); } catch { /* ignore */ }
      err ? reject(err) : resolve(); };
    // NO noAutoCreate: this is deliberately the gateway's legacy auto-create
    // path (bridge.js:666), which asks aCis to make a Human Fighter.
    ws.on('open', () => ws.send(JSON.stringify({ op: 'login', deviceId })));
    ws.on('message', (data) => {
      let msg; try { msg = JSON.parse(data); } catch { return; }
      if (msg.op === 'auth_ok' && Array.isArray(msg.chars) && msg.chars.length > 0) done(null);
      else if (msg.op === 'charCreateFail') done(new Error('live_fixture: charCreateFail '
        + (msg.reason || msg.code)));
    });
    ws.on('error', (e) => done(e));
  });

  charId = charIdFor(deviceId);
  if (!charId) {
    throw new Error(`live_fixture: gateway reported a character for ${charName} but the `
      + `database has none — the fixture cannot be trusted`);
  }
  return { charName, charId, created: true };
}

// Pin the deviceId BEFORE any page script runs. evaluateOnNewDocument (not
// page.evaluate) is required: net.js reads localStorage during module init,
// which happens before any post-goto evaluate could land.
async function seed(page, deviceId) {
  await page.evaluateOnNewDocument((id) => {
    try { localStorage.setItem('l2vzla.deviceId', id); } catch { /* ignore */ }
  }, deviceId);
}

// Reusing a FIXED pair of fixture characters breaks any suite that MOVES an
// item from one to the other: verify_tradewnd_live and verify_storewnd_live
// both hand the Tutorial Guide (5588 — the only tradable starter item) from
// A to B, so on the second run A has none and the suite fails for a reason
// that has nothing to do with the product.
//
// Rather than seeding items behind the server's back, ASK THE DATABASE who
// currently holds the item and give that character the giving role. Run 1
// A -> B, run 2 B -> A, forever. Idempotent, uses only real server state,
// and needs no cleanup step that a crashed run could skip.
//
// Returns the deviceIds reordered so that holders of `itemId` come first.
// Throws if nobody holds it (that IS a real failure worth reporting, not
// something to paper over).
async function orderByItem(deviceIds, itemId) {
  const held = [];
  const empty = [];
  for (const id of deviceIds) {
    const { charName } = derive(id);
    const charId = charIdFor(id);
    const n = charId
      ? Number(sql(`SELECT COUNT(*) FROM items WHERE owner_id=${charId} `
        + `AND item_id=${itemId} AND loc IN ('INVENTORY','PAPERDOLL')`))
      : 0;
    (n > 0 ? held : empty).push({ id, charName, n });
  }
  if (held.length === 0) {
    throw new Error(`live_fixture: none of [${deviceIds.join(', ')}] holds item ${itemId} `
      + `(${[...held, ...empty].map((c) => `${c.charName}=${c.n}`).join(' ')}) — `
      + `the fixture pair has drifted; delete these characters to re-seed`);
  }
  return [...held, ...empty].map((c) => c.id);
}

module.exports = { derive, sql, charIdFor, ensureChar, seed, orderByItem };

// ---------------------------------------------------------------------------
// --check: the standing gate.
//
// It FAILS on the pre-fix tree — nine live suites had no stable deviceId on
// 2026-08-09 — and it stays failing for any future suite that regresses.
// Two independent assertions:
//   A. derive() still matches gateway/src/bridge.js (parsed from source, not
//      trusted from this file's copy);
//   B. every `live` row in tools/battery.sh either seeds a STABLE deviceId
//      or opts into the gateway auto-create with ?cc=0.
// ---------------------------------------------------------------------------
if (require.main === module && process.argv.includes('--check')) {
  let bad = 0;
  const ok = (label, pass, detail = '') => {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
    if (!pass) bad++;
  };

  // --- A. the derivation is still the gateway's ---------------------------
  const bridgeSrc = fs.readFileSync(path.join(ROOT, 'gateway', 'src', 'bridge.js'), 'utf8');
  const accPrefix = /update\('l2vzla-account:' \+ id\)/.test(bridgeSrc);
  const accSlice = /account: 'w' \+ h1\.slice\(0, 12\)/.test(bridgeSrc);
  const nameSlice = /charName: 'W' \+ h1\.slice\(12, 23\)/.test(bridgeSrc);
  ok('derive() matches gateway/src/bridge.js deriveCredentials',
    accPrefix && accSlice && nameSlice,
    `salt=${accPrefix} account=${accSlice} charName=${nameSlice}`);

  // --- B. every live suite has a stable identity --------------------------
  const battery = fs.readFileSync(path.join(ROOT, 'tools', 'battery.sh'), 'utf8');
  const liveRows = battery.split('\n')
    .map((l) => l.match(/^"live\|([^|]+)\|([^|]+)\|\d+\|([^|"]+)/))
    .filter(Boolean)
    .map((m) => ({ name: m[1], dir: m[2], script: m[3] }));
  ok('found the live section in tools/battery.sh', liveRows.length > 0,
    `${liveRows.length} rows`);

  const offenders = [];
  for (const row of liveRows) {
    const file = path.join(ROOT, row.dir, row.script);
    let src;
    try { src = fs.readFileSync(file, 'utf8'); }
    catch { offenders.push(`${row.name}: script not readable (${file})`); continue; }

    // A suite that TESTS the character-creation path needs a fresh account by
    // construction — a stable one would hit name_already_exists on run 2.
    // The exemption is explicit and must carry a reason, so it stays visible
    // instead of becoming a silent hole.
    const exempt = src.match(/LIVE-FIXTURE-EXEMPT:\s*(.+)/);
    if (exempt) {
      if (!exempt[1].trim()) offenders.push(`${row.name}: LIVE-FIXTURE-EXEMPT with no reason`);
      continue;
    }

    // ?cc=0 => the client does NOT send noAutoCreate, so the gateway
    // auto-creates on first login and a fresh account still enters the world.
    if (/[?&]cc=0/.test(src)) continue;

    // Otherwise it must seed a deviceId — either by hand, or (preferred)
    // through this module's seed(), which is the same evaluateOnNewDocument
    // call with the ordering trap documented.
    const seedsByHand = /localStorage\.setItem\(\s*['"]l2vzla\.deviceId['"]/.test(src);
    const seedsViaHelper = /require\(['"]\.\/live_fixture['"]\)/.test(src)
      && /\.seed\(\s*page/.test(src);
    if (!seedsByHand && !seedsViaHelper) {
      offenders.push(`${row.name}: seeds no deviceId and has no ?cc=0 -> fresh account, `
        + `auth_ok{chars:[]}, hangs at char creation`);
      continue;
    }
    // ...and that deviceId must be STABLE across runs. `Date.now()`,
    // `Math.random()` and `randomUUID` all mint a new account every run,
    // which is indistinguishable from seeding nothing at all.
    const idLines = src.split('\n')
      .filter((l) => /DEVICE_ID\s*=|deviceId\s*=\s*['"]/.test(l))
      .join('\n');
    if (/Date\.now\(\)|Math\.random\(\)|randomUUID|process\.pid/.test(idLines)) {
      offenders.push(`${row.name}: deviceId is minted per run (${idLines.trim()
        .split('\n')[0].trim()}) -> a brand-new account every time`);
    }
  }
  ok('every live suite has a stable login identity', offenders.length === 0,
    offenders.length ? `${offenders.length} offender(s)` : 'all rows clean');
  for (const o of offenders) console.log('        ' + o);

  console.log('---');
  console.log(bad === 0 ? 'LIVE-FIXTURE: PASS' : 'LIVE-FIXTURE: FAIL');
  process.exit(bad === 0 ? 0 : 1);
}
