// verify_equipment.js — an equipped weapon reaches the character's hand.
//
// The chain has three joins that each key on different ids, so this checks the
// whole thing rather than any one link:
//   itemId -> mesh (weaponmesh.json) -> glTF (weapons manifest) -> socket bone
//
// The socket assertion is the important one. The weapon meshes ship with their
// retail origin intact, so the correct attachment is the identity transform on
// `Weapon_R_Bone`; if anything here ever needs a position or rotation nudge,
// the mesh has been mangled upstream. So the suite asserts the transform stays
// identity, not merely that something appeared.
//
// Usage: node verify_equipment.js [base-url]

const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'ui_shots');

const ONE_HAND = 69;     // Bastard Sword  (handness 1)
const TWO_HAND = 70;     // Claymore       (handness 2)
const STARTER = 2369;    // Squire's Sword — what a new character actually holds

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
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
                                   && window.__world.character.model, { timeout: 60000 }).catch(() => {});

  const sockets = await page.evaluate(() => {
    const m = window.__world.character.model;
    return { r: !!m.getObjectByName('Weapon_R_Bone'), l: !!m.getObjectByName('Weapon_L_Bone') };
  });
  check('character carries retail weapon sockets', sockets.r && sockets.l,
        `R=${sockets.r} L=${sockets.l}`);

  async function equip(itemId) {
    return page.evaluate(async (id) => {
      const ch = window.__world.character;
      await ch.setWeapon(id);
      const socket = ch.model.getObjectByName('Weapon_R_Bone');
      const held = socket && socket.children.find(c => c.name.startsWith('weapon_'));
      let meshes = 0, tris = 0;
      if (held) {
        held.traverse(n => {
          if (n.isMesh) {
            meshes++;
            const g = n.geometry;
            tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
          }
        });
      }
      return {
        name: held ? held.name : null,
        children: socket ? socket.children.length : -1,
        meshes,
        tris,
        pos: held ? [held.position.x, held.position.y, held.position.z] : null,
        scale: held ? [held.scale.x, held.scale.y, held.scale.z] : null,
        quat: held ? [held.quaternion.x, held.quaternion.y, held.quaternion.z, held.quaternion.w] : null,
      };
    }, itemId);
  }

  const one = await equip(ONE_HAND);
  check('one-handed weapon attaches to the right socket',
        !!one.name && one.name.includes('bastard_sword'), one.name || 'nothing attached');
  check('attached weapon has real geometry', one.meshes > 0 && one.tris > 0,
        `${one.meshes} mesh(es), ${Math.round(one.tris)} triangles`);
  const identity = one.pos && one.pos.every(v => v === 0)
    && one.scale && one.scale.every(v => v === 1)
    && one.quat && one.quat[0] === 0 && one.quat[1] === 0 && one.quat[2] === 0 && one.quat[3] === 1;
  check('attachment transform is identity (no fudge factor)', identity,
        one.pos ? `pos=${JSON.stringify(one.pos)} scale=${JSON.stringify(one.scale)}` : '');

  const two = await equip(TWO_HAND);
  check('swapping weapons replaces rather than stacks',
        !!two.name && two.name.includes('claymore') && two.children === 1,
        `${two.name}, socket children=${two.children}`);

  const starter = await equip(STARTER);
  check('the starter weapon a new character holds resolves',
        !!starter.name && starter.name.includes('squires_sword'), starter.name || 'unresolved');

  const bare = await equip(0);
  check('unequipping clears the hand', bare.name === null && bare.children === 0,
        `children=${bare.children}`);

  // --- stance ---------------------------------------------------------------
  // The clips are per weapon stance (Wait_1HS_MFighter and friends). Holding a
  // sword must actually select them, or the character stands unarmed with a
  // sword in its hand — which is what play testing reported.
  const stance = await page.evaluate(async (ids) => {
    const ch = window.__world.character;
    const out = {};
    for (const [label, id] of Object.entries(ids)) {
      await ch.setWeapon(id);
      out[label] = { stance: ch.stance, idle: ch._clip('idle'), attack: ch._clip('attack') };
    }
    out.clips = Object.keys(ch.actions).length;
    out.has1hs = !!ch.actions.idle_1hs;
    return out;
  }, { unarmed: 0, sword: ONE_HAND, claymore: TWO_HAND });

  check('model carries the stanced clip set', stance.clips > 20 && stance.has1hs,
        `${stance.clips} clips, idle_1hs=${stance.has1hs}`);
  check('unarmed uses the hand stance', stance.unarmed.stance === 'hand'
        && stance.unarmed.idle === 'idle', JSON.stringify(stance.unarmed));
  check('a one-handed sword selects the 1HS stance', stance.sword.stance === '1hs'
        && stance.sword.idle === 'idle_1hs' && stance.sword.attack === 'atk01_1hs',
        JSON.stringify(stance.sword));
  check('a two-handed sword selects the 2HS stance', stance.claymore.stance === '2hs'
        && stance.claymore.idle === 'idle_2hs', JSON.stringify(stance.claymore));

  // Put it back on and photograph it — the numbers above cannot tell us it
  // looks right, only that it is present and untransformed.
  await equip(ONE_HAND);
  await page.evaluate(() => {
    // frame the character so the weapon is actually visible in the shot
    const w = window.__world;
    const p = w.character.group.position;
    w.camera.position.set(p.x + 2.2, p.y + 1.7, p.z + 2.2);
    w.camera.lookAt(p.x, p.y + 0.9, p.z);
  });
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(OUT, '10-weapon-equipped.png') });

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\nshot -> ${path.join(OUT, '10-weapon-equipped.png')}`);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error('SUITE ERROR', err); process.exit(1); });
