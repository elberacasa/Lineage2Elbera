// verify_shield.js — a shield hangs on the bone retail names for it.
//
// The claim under test: an equipped shield is parented to `Shield_L_Bone` at
// an identity transform, and a non-shield off-hand item is not.
//
// Why that bone, and why identity — both decoded, neither chosen:
//
//   A  `LineageWarrior.u`'s class default properties (the serialised tagged
//      property block of each UClass export) set, identically on all 14
//      playable pawn classes:
//          RightHandBone = Weapon_R_Bone     LeftHandBone = Weapon_L_Bone
//          RightArmBone  = Shield_R_Bone     LeftArmBone  = Shield_L_Bone
//      Those are `var name` slots on Engine.u's Pawn, read natively via
//      APawn::GetLArmBoneName (exported by engine.dll). The shield slot is the
//      ARM bone. Decode: tools/l2lib/ue2package.py over the .u name table +
//      property stream.
//   B  a UE2 USkeletalMesh carries an explicit socket table (AttachAliases /
//      AttachBoneNames / AttachCoords — UEViewer Unreal/UnrealMesh/UnMesh2.cpp
//      line 447). Decoded for all 14 body meshes: exactly ONE socket each,
//      alias `e_bone` on `Bip01_head` with identity axes. No weapon or shield
//      socket coord exists in the client, and all 17 shield meshes have
//      identity MeshScale/MeshOrigin/RotOrigin with no socket table of their
//      own. So the bone frame IS the transform: identity, or the mesh was
//      mangled upstream.
//
//   NOT recovered: engine.dll is Themida-packed (its only code section is
//   named "Themida"), so the native call that picks LeftArmBone over
//   LeftHandBone for the shield slot cannot be disassembled. A and B plus the
//   geometry gate below are the evidence.
//
// Gates:
//   1  every shipped character glTF carries BOTH `Shield_L_Bone` and
//      `Weapon_L_Bone`, and they are genuinely different frames (a build that
//      collapsed them would make gate 3 vacuous).
//   2  the shield roster is identified by data, not by name: the manifest
//      entries with weapongrp handness 0 are exactly the `_sh` meshes, and
//      every shield glTF node is transform-free.
//   3  LIVE: equipping a shield puts it under `Shield_L_Bone`, leaves
//      `Weapon_L_Bone` empty, and the attached node's local transform is the
//      identity. Equipping a one-handed weapon off-hand still uses
//      `Weapon_L_Bone`. Unequipping clears both.
//   4  GEOMETRY: with the shield attached, the plate's normal is near
//      perpendicular to the forearm (strapped ACROSS the arm). On the bone
//      this used to use it is near parallel — the arm skewers the plate.
//
// Usage:
//   node editor/world/verify_shield.js [base-url]
//   node editor/world/verify_shield.js --check      (exit non-zero on failure)
//
// Needs the dev server on 8083. No gateway: the suite drives the character
// directly, exactly as verify_equipment.js does.

const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPO = path.join(__dirname, '..', '..');
const CHECK = process.argv.includes('--check');
const BASE = process.argv.slice(2).find(a => !a.startsWith('--')) || 'http://127.0.0.1:8083/';
const OUT = path.join(__dirname, 'verify_shots');

const CHAR_MODELS = path.join(REPO, 'editor/characters/models');
const WEAPON_DIR = path.join(REPO, 'editor/characters/weapons');

// Round Shield — weaponmesh: lineageweapons.round_shield_m00_sh, weapongrp
// body_part 8 / handness 0. Same id verify_equipment.js already uses.
const SHIELD = 102;
// Bastard Sword, handness 1 — a one-hander in the off hand must NOT move to
// the shield bone, or the fix would just be a different hard-coded bone.
const OFFHAND_WEAPON = 69;

const SHIELD_BONE = 'Shield_L_Bone';
const WEAPON_L_BONE = 'Weapon_L_Bone';

const results = [];
function gate(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// --- gate 1 + 2: offline, over the shipped assets ---------------------------

function nodeNames(gltf) {
  return new Set((gltf.nodes || []).map(n => n.name).filter(Boolean));
}

function localTRS(gltf, name) {
  const n = (gltf.nodes || []).find(x => x.name === name);
  if (!n) return null;
  return {
    t: n.translation || [0, 0, 0],
    q: n.rotation || [0, 0, 0, 1],
    s: n.scale || [1, 1, 1],
    matrix: n.matrix || null,
  };
}

function checkAssets() {
  const models = fs.readdirSync(CHAR_MODELS).filter(f => f.endsWith('.gltf')).sort();
  const missing = [];
  const collapsed = [];
  for (const f of models) {
    const g = JSON.parse(fs.readFileSync(path.join(CHAR_MODELS, f), 'utf8'));
    const names = nodeNames(g);
    if (!names.has(SHIELD_BONE) || !names.has(WEAPON_L_BONE)) { missing.push(f); continue; }
    const a = localTRS(g, SHIELD_BONE), b = localTRS(g, WEAPON_L_BONE);
    // |dot| of the two quaternions: 1 means the same orientation. The decoded
    // pair sits ~90 degrees apart on every model, so anything near 1 means the
    // export collapsed them and gate 3 would pass for the wrong reason.
    const dot = Math.abs(a.q.reduce((s, v, i) => s + v * b.q[i], 0));
    const dist = Math.hypot(a.t[0] - b.t[0], a.t[1] - b.t[1], a.t[2] - b.t[2]);
    if (dot > 0.99 || dist < 1e-4) collapsed.push(`${f} dot=${dot.toFixed(3)} d=${dist.toFixed(4)}`);
  }
  gate('every character glTF carries Shield_L_Bone and Weapon_L_Bone',
       models.length >= 14 && missing.length === 0,
       `${models.length - missing.length}/${models.length} models` +
       (missing.length ? `; missing on ${missing.join(', ')}` : ''));
  gate('the two off-hand bones are distinct frames (gate 3 is not vacuous)',
       collapsed.length === 0,
       collapsed.length ? collapsed.join('; ') : 'all pairs differ in both position and orientation');

  const manifest = JSON.parse(fs.readFileSync(path.join(WEAPON_DIR, 'manifest.json'), 'utf8')).models;
  const byHandness0 = manifest.filter(m => m.handness === 0).map(m => m.id).sort();
  const bySuffix = manifest.filter(m => m.id.endsWith('_sh')).map(m => m.id).sort();
  gate('shield-ness comes from weapongrp handness, and agrees with the mesh naming',
       byHandness0.length > 0 && JSON.stringify(byHandness0) === JSON.stringify(bySuffix),
       `${byHandness0.length} handness-0 meshes, ${bySuffix.length} _sh meshes`);

  const withXform = [];
  for (const id of byHandness0) {
    const p = path.join(WEAPON_DIR, 'models', `${id}.gltf`);
    if (!fs.existsSync(p)) { withXform.push(`${id}: glTF missing`); continue; }
    const g = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const n of g.nodes || []) {
      if (['translation', 'rotation', 'scale', 'matrix'].some(k => k in n)) {
        withXform.push(`${id}: node ${n.name} carries ${Object.keys(n).filter(k => ['translation','rotation','scale','matrix'].includes(k)).join('/')}`);
      }
    }
  }
  gate('every shield glTF is transform-free (the bone frame is the transform)',
       byHandness0.length > 0 && withXform.length === 0,
       withXform.length ? withXform.join('; ') : `${byHandness0.length} shields checked`);
}

// --- gate 3 + 4: live, in the running client --------------------------------

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  checkAssets();

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1200,900'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__world && window.__world.ready === true,
                               { timeout: 120000 }).catch(() => {});
    await page.waitForFunction(() => window.__world && window.__world.character
                                     && window.__world.character.model,
                               { timeout: 60000 }).catch(() => {});

    // One probe returns everything both live gates need, so the page is only
    // driven once per equip.
    const probe = await page.evaluate(async ({ shieldId, weaponId, shieldBone, weaponBone }) => {
      const ch = window.__world.character;
      const model = ch.model;

      function held(boneName) {
        const b = model.getObjectByName(boneName);
        if (!b) return { bone: null };
        const o = b.children.find(c => c.name && c.name.startsWith('weapon_'));
        return {
          bone: boneName,
          name: o ? o.name : null,
          children: b.children.filter(c => c.name && c.name.startsWith('weapon_')).length,
          pos: o ? [o.position.x, o.position.y, o.position.z] : null,
          scale: o ? [o.scale.x, o.scale.y, o.scale.z] : null,
          quat: o ? [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w] : null,
        };
      }

      // Plate normal vs forearm axis, measured in world space on the live
      // skeleton. The plate is the thinnest axis of the attached model's own
      // bounding box. Plain arithmetic on `matrixWorld.elements` (column-major
      // 16) so the probe needs no THREE import of its own.
      function worldPos(o) {
        const e = o.matrixWorld.elements;
        return [e[12], e[13], e[14]];
      }
      function worldDir(o, axis) {          // a local unit axis, rotated to world
        const e = o.matrixWorld.elements, c = axis * 4;
        const v = [e[c], e[c + 1], e[c + 2]];
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      }
      function geometry(boneName) {
        const b = model.getObjectByName(boneName);
        const o = b && b.children.find(c => c.name && c.name.startsWith('weapon_'));
        if (!o) return null;
        model.updateMatrixWorld(true);
        // local extents in the attached model's own frame
        let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        o.traverse(n => {
          if (n.isMesh && n.geometry) {
            n.geometry.computeBoundingBox();
            const bb = n.geometry.boundingBox;
            mn = [Math.min(mn[0], bb.min.x), Math.min(mn[1], bb.min.y), Math.min(mn[2], bb.min.z)];
            mx = [Math.max(mx[0], bb.max.x), Math.max(mx[1], bb.max.y), Math.max(mx[2], bb.max.z)];
          }
        });
        if (!isFinite(mn[0])) return { unavailable: true };
        const axes = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
        const thin = axes.indexOf(Math.min.apply(null, axes));
        const nrm = worldDir(o, thin);

        const fore = model.getObjectByName('Bip01_L_Forearm');
        const hand = model.getObjectByName('Bip01_L_Hand');
        if (!fore || !hand) return { unavailable: true };
        const a = worldPos(fore), c = worldPos(hand);
        const d = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const dl = Math.hypot(d[0], d[1], d[2]) || 1;
        const dot = Math.abs((nrm[0] * d[0] + nrm[1] * d[1] + nrm[2] * d[2]) / dl);
        return { angleDeg: Math.acos(Math.min(1, dot)) * 180 / Math.PI,
                 localExtent: axes, thinAxis: thin };
      }

      const out = {};
      await ch.setOffhand(shieldId);
      out.shieldOnShieldBone = held(shieldBone);
      out.shieldOnWeaponBone = held(weaponBone);
      out.geomShield = geometry(shieldBone);
      out.geomWrong = geometry(weaponBone);

      await ch.setOffhand(weaponId);
      out.weaponOnShieldBone = held(shieldBone);
      out.weaponOnWeaponBone = held(weaponBone);

      await ch.setOffhand(shieldId);        // back to the shield for the shot
      await ch.setOffhand(0);
      out.clearedShieldBone = held(shieldBone).children;
      out.clearedWeaponBone = held(weaponBone).children;
      await ch.setOffhand(shieldId);
      return out;
    }, { shieldId: SHIELD, weaponId: OFFHAND_WEAPON,
         shieldBone: SHIELD_BONE, weaponBone: WEAPON_L_BONE });

    const s = probe.shieldOnShieldBone;
    gate('a shield attaches to Shield_L_Bone',
         !!s.name && s.name.includes('shield'),
         s.bone ? (s.name || 'nothing attached on that bone') : `${SHIELD_BONE} not on the model`);
    gate('the shield is NOT on Weapon_L_Bone',
         probe.shieldOnWeaponBone.children === 0,
         `${probe.shieldOnWeaponBone.children} model(s) on ${WEAPON_L_BONE}`);

    const identity = s.pos && s.pos.every(v => v === 0)
      && s.scale && s.scale.every(v => v === 1)
      && s.quat && s.quat[0] === 0 && s.quat[1] === 0 && s.quat[2] === 0 && s.quat[3] === 1;
    gate('the shield attach transform is the identity (no fudge factor)', identity,
         s.pos ? `pos=${JSON.stringify(s.pos)} quat=${JSON.stringify(s.quat)} scale=${JSON.stringify(s.scale)}` : 'nothing attached');

    gate('a one-handed weapon in the off hand still uses Weapon_L_Bone',
         !!probe.weaponOnWeaponBone.name && probe.weaponOnShieldBone.children === 0,
         `${WEAPON_L_BONE}=${probe.weaponOnWeaponBone.name || 'none'}, ` +
         `${SHIELD_BONE} children=${probe.weaponOnShieldBone.children}`);

    gate('unequipping the off hand clears BOTH off-hand bones',
         probe.clearedShieldBone === 0 && probe.clearedWeaponBone === 0,
         `${SHIELD_BONE}=${probe.clearedShieldBone}, ${WEAPON_L_BONE}=${probe.clearedWeaponBone}`);

    // Geometry gate. Retail-decoded expectation: strapped across the forearm,
    // so the plate normal is near perpendicular to the arm. Measured 88.2 deg
    // on Shield_L_Bone and 4.0 deg on Weapon_L_Bone for human_fighter_m +
    // tower_shield_m00_sh; 60 deg is a wide margin between those two.
    const g4 = probe.geomShield;
    gate('the shield plate is strapped ACROSS the forearm, not skewered by it',
         !!g4 && !g4.unavailable && g4.angleDeg > 60,
         g4 ? (g4.unavailable ? 'THREE not reachable from the page' :
               `plate normal ${g4.angleDeg.toFixed(1)} deg off the forearm axis ` +
               `(local extents ${g4.localExtent.map(v => v.toFixed(3)).join('/')}, thin axis ${g4.thinAxis})`)
            : 'no shield attached to measure');

    gate('no page errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

    const tag = process.env.SHIELD_SHOT_TAG || (CHECK ? 'after' : 'manual');
    const shot = path.join(OUT, `shield_attach_${tag}.png`);
    await page.screenshot({ path: shot });

    // Close-up: the wide shot cannot show which bone a 25 cm plate is on.
    // Stage the retail follow camera itself (`followCam` is exposed for
    // exactly this) rather than moving `camera` directly — the render loop
    // rewrites `camera` every frame from the boom, so a direct move survives
    // for less than one frame. Purely a viewing change; nothing in the scene
    // moves.
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('body > *')) {
        if (el.tagName !== 'CANVAS') el.style.visibility = 'hidden';
      }
      const w = window.__world, fc = w.followCam, ch = w.character;
      fc.dist = 0.9;
      fc.pitch = 0.12;
      // Look at the character's left side: the model faces +group.rotation.y.
      fc.yaw = ch.group.rotation.y - Math.PI / 2;
    });
    await new Promise(r => setTimeout(r, 700));
    const closeup = path.join(OUT, `shield_attach_${tag}_closeup.png`);
    await page.screenshot({ path: closeup, clip: { x: 300, y: 150, width: 600, height: 600 } });
    console.log(`shots: ${shot}\n       ${closeup}`);
  } finally {
    await browser.close();
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} gates passed`);
  if (CHECK) {
    console.log(`CHECK ${failed.length ? 'FAIL' : 'PASS'} (${failed.length} failing gates)`);
    process.exit(failed.length ? 1 : 0);
  }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
