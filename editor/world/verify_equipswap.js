// verify_equipswap.js — swapping a weapon updates the model without relogging.
//
// verify_equipment.js proves the attachment works when setWeapon is called
// directly, and gateway/test/verify-paperdoll.js proves the server reports the
// new item. Neither covers the join between them: whether an in-game equip
// actually drives the model. The player's report was that it does not — the
// weapon only appears after a relog — so this reproduces the real path end to
// end against the live stack: go online, equip through useItem, watch the bone.
//
// Needs the full stack up (aCis + gateway + this server), like the other
// verify_live-style suites. The fixture character is seeded with two weapons by
// gateway/test/verify-paperdoll.js; run that first if the inventory is bare.
//
// Usage: node verify_equipswap.js [base-url]

const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://127.0.0.1:8083/';
const DEVICE_ID = 'verify-paperdoll-fixture-1';   // same character the paperdoll suite seeds

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const heldWeapon = () => {
  const ch = window.__world.character;
  if (!ch || !ch.model) return null;
  const socket = ch.model.getObjectByName('Weapon_R_Bone');
  if (!socket) return null;
  const held = socket.children.find(c => c.name && c.name.startsWith('weapon_'));
  return held ? held.name : '';
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1200,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // Pin the device id so we land on the character that already carries the
  // Bastard Sword and Claymore, instead of a fresh empty one.
  await page.evaluateOnNewDocument((id) => {
    try { localStorage.setItem('l2vzla.deviceId', id); } catch { /* ignore */ }
  }, DEVICE_ID);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__world && window.__world.ready === true,
                             { timeout: 120000 }).catch(() => {});

  await page.click('#online-toggle');
  const entered = await page.waitForFunction(
    () => window.__world.net && window.__world.net.connected
          && window.__world.character && window.__world.character.model,
    { timeout: 120000 }).then(() => true).catch(() => false);
  check('went online and spawned', entered);
  if (!entered) { await browser.close(); process.exit(1); }

  await sleep(6000);   // let itemList + the first charSheet land

  const inv = await page.evaluate(() => {
    const w = window.__world;
    return {
      items: (w.inventory ? [...w.inventory.items.values()] : [])
        .map(i => ({ objectId: i.objectId, itemId: i.itemId })),
      paperdollSeen: !!(w.charSheet && w.charSheet.paperdoll),
      rhand: w.charSheet && w.charSheet.paperdoll
        ? w.charSheet.paperdoll.rhand : null,
    };
  });
  check('charSheet delivered a paperdoll to the client', inv.paperdollSeen,
        `rhand=${inv.rhand}`);

  const sword = inv.items.find(i => i.itemId === 69);
  const claymore = inv.items.find(i => i.itemId === 70);
  check('fixture weapons present in the live inventory', !!sword && !!claymore,
        `${inv.items.length} items`);
  if (!sword || !claymore) {
    console.log('  (run: cd gateway && node test/verify-paperdoll.js to seed them)');
    await browser.close(); process.exit(1);
  }

  const before = await page.evaluate(heldWeapon);

  // Equip through the same op the inventory window's double-click sends.
  await page.evaluate((oid) => window.__world.net.sendOp('useItem', { objectId: oid }),
                      sword.objectId);
  const gotSword = await page.waitForFunction(
    () => {
      const ch = window.__world.character;
      const s = ch && ch.model && ch.model.getObjectByName('Weapon_R_Bone');
      const h = s && s.children.find(c => c.name && c.name.startsWith('weapon_'));
      return !!h && h.name.includes('bastard_sword');
    }, { timeout: 20000 }).then(() => true).catch(() => false);
  check('equipping a weapon updates the model live', gotSword,
        `was ${before || 'empty'}, now ${await page.evaluate(heldWeapon)}`);

  // Swap straight to the other weapon — the case the player hit.
  await page.evaluate((oid) => window.__world.net.sendOp('useItem', { objectId: oid }),
                      claymore.objectId);
  const gotClaymore = await page.waitForFunction(
    () => {
      const ch = window.__world.character;
      const s = ch && ch.model && ch.model.getObjectByName('Weapon_R_Bone');
      const h = s && s.children.find(c => c.name && c.name.startsWith('weapon_'));
      return !!h && h.name.includes('claymore');
    }, { timeout: 20000 }).then(() => true).catch(() => false);
  check('swapping to another weapon updates the model live', gotClaymore,
        `now ${await page.evaluate(heldWeapon)}`);

  const socketChildren = await page.evaluate(() => {
    const s = window.__world.character.model.getObjectByName('Weapon_R_Bone');
    return s ? s.children.filter(c => c.name && c.name.startsWith('weapon_')).length : -1;
  });
  check('a swap replaces rather than stacks', socketChildren === 1,
        `${socketChildren} weapon(s) on the bone`);

  // Unequip
  await page.evaluate((oid) => window.__world.net.sendOp('useItem', { objectId: oid }),
                      claymore.objectId);
  const bare = await page.waitForFunction(
    () => {
      const s = window.__world.character.model.getObjectByName('Weapon_R_Bone');
      return s && !s.children.some(c => c.name && c.name.startsWith('weapon_'));
    }, { timeout: 20000 }).then(() => true).catch(() => false);
  check('unequipping clears the model live', bare);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error('SUITE ERROR', err); process.exit(1); });
