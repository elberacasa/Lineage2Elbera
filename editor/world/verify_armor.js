// verify_armor.js — equipped armor reaches the character as SWAPPED BODY GEOMETRY.
//
// Armor is not an attachment, so this cannot check "something appeared on a
// bone" the way verify_equipment.js does for weapons. The assertion that
// matters is COMPOSITION: for a given equipped set, each slot must resolve to
// the exact mesh armorgrp names for that item and that model, the base body
// part it replaces must go away, and an empty slot must fall back to the base
// mesh rather than to a hole.
//
// Four things are checked, and each one has failed at some point during the
// wave that built this:
//
//   A  the slot map resolves. paperdoll {chest,legs,gloves,feet} -> the meshes
//      armorgrp names, per model. Checked against armormesh.json itself so a
//      table regression cannot hide behind a renderer that draws something.
//   B  the pieces are really in the scene AND really skinned to the character's
//      own skeleton. A SkinnedMesh bound to its own imported skeleton looks
//      correct in a still frame and then stands rigid while the body animates,
//      which a screenshot will never catch.
//   C  the base part is hidden. Without this the armor and the bare torso
//      z-fight, which reads as "armor works" at a glance.
//   D  unequipping restores the base part. The failure mode here is a
//      character left permanently topless after a swap.
//
// Usage: node verify_armor.js [base-url]
//        node verify_armor.js --check   (same thing; nonzero exit on failure)

const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2).filter(a => a !== '--check');
const BASE = args[0] || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'ui_shots');
const ROOT = path.join(__dirname, '../..');

// A real equipped set for a male human fighter, taken from armorgrp (item ids
// are itemname.json's). Deliberately NOT the m001 newbie tier: m001 IS the
// creation body, so a renderer that did nothing at all would still "match".
const SET = {
  chest: 58,     // Mithril Breastplate -> Fighter.MFighter_m003_u
  legs: 59,      // Mithril Gaiters     -> Fighter.MFighter_m003_l
  gloves: 61,    // Mithril Gloves      -> Fighter.MFighter_m006_g
  feet: 62,      // Mithril Boots       -> Fighter.MFighter_m007_b
};
const FULL_ARMOR = 356;   // Full Plate Armor -> m008_u AND m008_l from one item

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // ---- A: the table, read straight off disk -------------------------------
  const table = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'assets/gamedata/armormesh.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'editor/characters/armor/manifest.json'), 'utf8'));

  const MID = 'human_fighter_m';
  const expect = {
    chest: ['Fighter.MFighter_m003_u'],
    legs: ['Fighter.MFighter_m003_l'],
    gloves: ['Fighter.MFighter_m006_g'],
    feet: ['Fighter.MFighter_m007_b'],
  };
  for (const [slot, itemId] of Object.entries(SET)) {
    const row = table.items[String(itemId)];
    const got = row && row.byModel[MID] && row.byModel[MID].meshes;
    check(`table: ${slot} item ${itemId} -> ${expect[slot][0]}`,
          !!got && JSON.stringify(got) === JSON.stringify(expect[slot]),
          `slot=${row && row.slot} meshes=${JSON.stringify(got)}`);
    check(`table: ${slot} mesh is built`,
          !!got && got.every(m => manifest.meshes[m]));
  }
  const fa = table.items[String(FULL_ARMOR)];
  check('table: full armor covers chest AND legs from one item',
        !!fa && fa.slot === 'fullarmor'
          && JSON.stringify(fa.replaces) === JSON.stringify(['_u', '_l'])
          && fa.byModel[MID].meshes.length === 2,
        fa ? `${fa.slot} ${JSON.stringify(fa.byModel[MID].meshes)}` : 'absent');
  // The negative claim, asserted so a future extraction cannot quietly invent
  // helmet geometry: Interlude ships none.
  const helmets = Object.values(table.items).filter(r => r.slot === 'head');
  check('table: head slot exists but carries NO mesh (Interlude has none)',
        helmets.length > 50
          && helmets.every(r => Object.keys(r.byModel).length === 0),
        `${helmets.length} head items, ${helmets.filter(r => Object.keys(r.byModel).length).length} with meshes`);

  // ---- browser ------------------------------------------------------------
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1200,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__world && window.__world.ready === true,
                             { timeout: 120000 }).catch(() => {});
  await page.waitForFunction(() => window.__world && window.__world.character
                                   && window.__world.character.model,
                             { timeout: 60000 }).catch(() => {});

  // Put the character in a known model so the expectations above apply.
  await page.evaluate(async () => {
    const ch = window.__world.character;
    if (ch.modelId !== 'human_fighter_m') {
      await ch.load('/characters/models/human_fighter_m.gltf');
    }
  });

  const shot = async (name) => {
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: path.join(OUT, name) });
  };

  const survey = () => page.evaluate(() => {
    const ch = window.__world.character;
    const body = [], armor = [];
    ch.model.traverse(o => {
      if (!o.isSkinnedMesh) return;
      const rec = {
        name: o.name, visible: o.visible,
        tris: o.geometry.index ? o.geometry.index.count / 3
          : o.geometry.attributes.position.count / 3,
        sharesSkeleton: null,
      };
      if (o.name.startsWith('armor_')) armor.push(rec); else body.push(rec);
    });
    // Does every armor piece ride the SAME Skeleton object as the body?
    let hostSkel = null;
    ch.model.traverse(o => {
      if (o.isSkinnedMesh && !o.name.startsWith('armor_') && !hostSkel) {
        hostSkel = o.skeleton;
      }
    });
    ch.model.traverse(o => {
      if (o.isSkinnedMesh && o.name.startsWith('armor_')) {
        const r = armor.find(a => a.name === o.name);
        if (r) r.sharesSkeleton = (o.skeleton === hostSkel);
      }
    });
    return { body, armor, modelId: ch.modelId };
  });

  const before = await survey();
  await shot('armor_before.png');
  check('before: no armor pieces in the scene', before.armor.length === 0,
        `${before.armor.length} pieces`);
  check('before: every base body part is visible',
        before.body.length >= 4 && before.body.every(b => b.visible),
        before.body.map(b => `${b.name}:${b.visible}`).join(' '));

  // ---- equip the set ------------------------------------------------------
  await page.evaluate(async (set) => {
    await window.__world.character.setArmor(set);
  }, SET);
  await new Promise(r => setTimeout(r, 2500));
  const after = await survey();
  await shot('armor_after.png');

  check('B: four armor pieces are in the scene', after.armor.length === 4,
        after.armor.map(a => a.name).join(' '));
  check('B: every piece has real geometry',
        after.armor.length > 0 && after.armor.every(a => a.tris > 50),
        after.armor.map(a => `${a.name}:${Math.round(a.tris)}t`).join(' '));
  // The one that a screenshot cannot catch.
  check('B: every piece is bound to the CHARACTER\'s skeleton, not its own',
        after.armor.length > 0 && after.armor.every(a => a.sharesSkeleton === true),
        after.armor.map(a => `${a.name}:${a.sharesSkeleton}`).join(' '));

  for (const [slot, mesh] of Object.entries(expect)) {
    check(`B: ${slot} piece is ${mesh[0]}`,
          after.armor.some(a => a.name === `armor_${mesh[0]}`));
  }

  // ---- C: the replaced base parts are hidden ------------------------------
  const hiddenNow = after.body.filter(b => !b.visible).map(b => b.name);
  for (const sfx of ['_u', '_l', '_g', '_b']) {
    const part = after.body.find(b => b.name.toLowerCase().endsWith(sfx));
    check(`C: base ${sfx} is hidden under its armor`, !!part && !part.visible,
          part ? `${part.name} visible=${part.visible}` : 'no such part');
  }
  check('C: the face and hair are NOT hidden (armor covers the body only)',
        after.body.filter(b => /_(f|ah|bh)$/i.test(b.name)).every(b => b.visible),
        `hidden: ${hiddenNow.join(' ')}`);

  // ---- D: a partial set, then nothing -------------------------------------
  await page.evaluate(async () => {
    await window.__world.character.setArmor({ chest: 58, legs: 0, gloves: 0, feet: 0 });
  });
  await new Promise(r => setTimeout(r, 1500));
  const partial = await survey();
  check('D: chest-only set leaves exactly one piece', partial.armor.length === 1,
        partial.armor.map(a => a.name).join(' '));
  const legs = partial.body.find(b => b.name.toLowerCase().endsWith('_l'));
  check('D: an EMPTY slot falls back to the base mesh, not a hole',
        !!legs && legs.visible, legs ? `${legs.name} visible=${legs.visible}` : 'missing');

  await page.evaluate(async () => {
    await window.__world.character.setArmor({ chest: 0, legs: 0, gloves: 0, feet: 0 });
  });
  await new Promise(r => setTimeout(r, 1200));
  const bare = await survey();
  await shot('armor_unequipped.png');
  check('D: unequipping removes every piece', bare.armor.length === 0,
        `${bare.armor.length} left`);
  check('D: unequipping restores every base part',
        bare.body.length >= 4 && bare.body.every(b => b.visible),
        bare.body.filter(b => !b.visible).map(b => b.name).join(' ') || 'all visible');

  // ---- E: the WIRE path, not the direct call -----------------------------
  // Everything above drives Character.setArmor() by hand, which proves the
  // renderer but not the wiring. The defect this whole wave fixes was exactly
  // a wiring one -- the gateway had been decoding gloves/chest/legs/feet for
  // a wave already and NOTHING read them -- so the last check pushes a real
  // `charSheet` op through the client's own dispatcher and looks at the model.
  await page.evaluate((set) => {
    window.__world.net.inject({
      op: 'charSheet',
      runSpeed: 115, walkSpeed: 80, speedMul: 1.1,
      paperdoll: { rhand: 0, lhand: 0, ...set },
    });
  }, SET);
  await new Promise(r => setTimeout(r, 2500));
  const wired = await survey();
  await shot('armor_from_charsheet.png');
  check('E: a charSheet paperdoll off the wire dresses the character',
        wired.armor.length === 4,
        wired.armor.map(a => a.name).join(' ') || 'nothing equipped');
  check('E: and it hid the base body parts',
        ['_u', '_l', '_g', '_b'].every(
          s => (wired.body.find(b => b.name.toLowerCase().endsWith(s)) || {}).visible === false));

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(`shots: ${path.join(OUT, 'armor_before.png')} / armor_after.png`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
