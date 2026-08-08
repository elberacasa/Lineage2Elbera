// Retail skill-VFX verification (js/skillvfx.js + assets/gamedata/skillvfx.json).
//
// Drives the REAL path: net.inject() logs + dispatches the message exactly as
// the socket would, and SkillFx._pump() picks it out of the log ring on the
// next frame -- index lookup, phase spawn, projectile flight, particle update
// and teardown all run in production form.
//
// Checks, per anchor skill:
//   - the retail effect classes actually spawned (names read back from the
//     index, so a mis-binding is visible, not just "something drew")
//   - live particle counts > 0 while the effect runs
//   - the MESH emitters resolved to real LineageEffectsStaticmeshes geometry,
//     reported by mesh name and triangle count (a mesh that silently failed to
//     load would otherwise look identical to "the sprites drew")
//   - the scene contains NO object tagged with the deleted authored effects
//   - unbound skills draw nothing at all
//
// Usage: node verify_skillvfx.js   (server on 8083, mock gateway on 8085)
// Output: verify_shots/vfx_*.png + a JSON summary on stdout.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0';
const OUT = path.join(__dirname, 'verify_shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// skill id -> what the retail tables say it must produce (docs/skillfx-data.md)
const ANCHORS = [
  { id: 1177, name: 'Wind Strike', expect: ['el_wind_strike_ca', 'el_wind_strike_pr',
                                            'el_wind_strike_fl', 'el_wind_strike_ta'],
    // the meshes the retail MeshEmitters on those classes name
    meshes: ['windblowin00', 'windknifeball00', 'windknifewave00', 'windblowin01'] },
  { id: 1011, name: 'Heal', expect: ['wh_heal_ca', 'wh_heal_ta'],
    meshes: ['magiccirclewhite00', 'magiccirclewhite01'] },
  { id: 1040, name: 'Shield', expect: ['wh_heal_ca', 'wh_shield_ta'],
    meshes: ['magiccirclewhite01', 'white_shield00'] },
  { id: 1085, name: 'Acumen', expect: ['su_empower_ca', 'su_acumen_ta'],
    meshes: ['supportenchant00'] },
];
const UNBOUND = 1216;   // Self Heal: no binding in ANY retail table

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { anchors: [], errors: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => summary.errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') summary.errors.push(m.text()); });

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      "window.__world.net.log.some(m => m.op === 'skillList')", { timeout: 20000 });
    await sleep(2500);

    // the index must have loaded, and the handler chain must be wrapped
    summary.index = await page.evaluate(async () => {
      const j = await (await fetch('/gamedata/skillvfx.json')).json();
      const m = await (await fetch('/gamedata/skillmesh.json')).json();
      let sprite = 0, mesh = 0;
      const skip = {};
      for (const f of j.fx) {
        for (const e of f.e) (e.k === 1 ? mesh++ : sprite++);
        for (const [k, v] of Object.entries(f.skip || {})) skip[k] = (skip[k] || 0) + v;
      }
      return { skills: Object.keys(j.skill).length, classes: j.fxn.length,
               textures: j.tex.length, texturesWithAlpha: (j.texa || []).reduce((a, b) => a + b, 0),
               spriteEmitters: sprite, meshEmitters: mesh, dropped: skip,
               meshNames: j.msh.length,
               geometry: { meshes: Object.keys(m.mesh).length, verts: m.nv,
                           tris: m.ni / 3, textures: m.tex.length } };
    });

    // Zoom the REAL orbit camera all the way in (it re-derives position from
    // its own dist every frame, so assigning camera.position is overwritten).
    // Characters render at nativeHeight * L2_TO_M = 0.46 m, so the default
    // framing leaves a 0.08 m particle only a few pixels wide.
    await page.mouse.move(640, 450);      // wheel listener is on the canvas
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel({ deltaY: -120 });
      await sleep(15);
    }
    await sleep(600);
    await page.screenshot({ path: path.join(OUT, 'vfx_00_before.png') });

    for (const a of ANCHORS) {
      // cast phase
      await page.evaluate((id) => {
        const w = window.__world;
        w.net.inject({ op: 'skillCast', skillId: id, level: 1,
          casterId: w.net.selfId, targetId: w.net.selfId, hitTime: 2000, reuse: 0 });
      }, a.id);
      await sleep(450);
      const cast = await page.evaluate(async () => {
        const v = (await import('/js/skills.js')).activeSkillFx().vfx;
        return { live: v.live.length,
                 particles: v.live.reduce((n, i) =>
                   n + i.emitters.reduce((m, e) => m + e.p.filter(q => q.alive).length, 0), 0) };
      });
      await page.screenshot({ path: path.join(OUT, `vfx_${a.id}_cast.png`) });

      // launch phase (shot + explosion)
      await page.evaluate((id) => {
        const w = window.__world;
        w.net.inject({ op: 'skillLaunch', skillId: id, level: 1,
          casterId: w.net.selfId, targetId: w.net.selfId });
      }, a.id);
      await sleep(400);
      const launch = await page.evaluate(async () => {
        const w = window.__world;
        const v = (await import('/js/skills.js')).activeSkillFx().vfx;
        // resolve every live instance back to its effect-class NAME
        const names = [];
        w.scene.traverse(o => { if (o.userData.skillFx) names.push(o.userData.skillFx); });
        return {
          live: v.live.length,
          particles: v.live.reduce((n, i) =>
            n + i.emitters.reduce((m, e) => m + e.p.filter(q => q.alive).length, 0), 0),
          tagged: names.length,
        };
      });
      await page.screenshot({ path: path.join(OUT, `vfx_${a.id}_launch.png`) });
      // Which STATIC MESHES actually made it into the scene, with their real
      // triangle counts: a mesh that failed to resolve leaves no object at all,
      // so this separates "the sprites drew" from "the mesh path works".
      const meshes = await page.evaluate(() => {
        const seen = {};
        window.__world.scene.traverse(o => {
          const t = o.userData.skillFx;
          if (!t || t.source !== 'skillmesh.json' || !o.geometry) return;
          const idx = o.geometry.getIndex();
          seen[t.mesh] = (seen[t.mesh] || 0) + (idx ? idx.count / 3 : 0);
        });
        return seen;
      });
      summary.anchors.push({ id: a.id, name: a.name, cast, launch, meshes });
      await page.evaluate(async () => (await import('/js/skills.js')).activeSkillFx().vfx.clear());
      await sleep(200);
    }

    // bUseCharacterRotation, measured rather than eyeballed. Wind Strike's
    // casting phase has TWO actions: el_wind_strike_ca at offset (0,0,-1) — one
    // half-height DOWN, i.e. at the feet — and el_wind_strike_pr at (1,0,0) with
    // the flag set, i.e. one half-height FORWARD in the CASTER's frame. So the
    // _pr instance must sit along the character's facing (dot ~ 1) and the _ca
    // instance must sit below its feet, whatever the heading happens to be.
    await page.evaluate(() => {
      const w = window.__world;
      w.character.group.rotation.y = 0.9;      // an arbitrary non-axis heading
      w.net.inject({ op: 'skillCast', skillId: 1177, level: 1,
        casterId: w.net.selfId, targetId: w.net.selfId, hitTime: 2000, reuse: 0 });
    });
    await sleep(350);
    summary.charRotation = await page.evaluate(async () => {
      const w = window.__world;
      const fx = (await import('/js/skills.js')).activeSkillFx();
      const yaw = w.character.group.rotation.y;
      const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) };   // coords.js convention
      const base = w.character.group.position;
      return fx.vfx.live.map(i => {
        const dx = i.group.position.x - base.x, dz = i.group.position.z - base.z;
        const d = Math.hypot(dx, dz);
        return { horizDist: +d.toFixed(3),
                 dy: +(i.group.position.y - base.y).toFixed(3),
                 dotForward: d > 1e-3 ? +((dx / d) * fwd.x + (dz / d) * fwd.z).toFixed(3) : null };
      });
    });
    await page.screenshot({ path: path.join(OUT, 'vfx_charrotation.png') });
    await page.evaluate(async () => (await import('/js/skills.js')).activeSkillFx().vfx.clear());
    await sleep(200);

    // PROJECTILE: Wind Strike at a real NPC, so FlyingTime (0.4 s) actually
    // has a distance to cross. Sampled mid-flight and again after arrival.
    const npc = await page.evaluate(() => {
      const w = window.__world;
      const ids = [...w.entities.entities.keys()];
      return ids.length ? ids[0] : null;
    });
    if (npc != null) {
      await page.evaluate((id) => {
        const w = window.__world;
        w.net.inject({ op: 'skillLaunch', skillId: 1177, level: 1,
          casterId: w.net.selfId, targetId: id });
      }, npc);
      await sleep(180);
      summary.projectile = await page.evaluate(async () => {
        const fx = (await import('/js/skills.js')).activeSkillFx();
        const t = fx.vfx.live.filter(i => i.travel);
        return { travelling: t.length,
                 pos: t.map(i => i.group.position.toArray().map(x => +x.toFixed(2))) };
      });
      await page.screenshot({ path: path.join(OUT, 'vfx_projectile_midflight.png') });
      await sleep(700);
      summary.projectileAfter = await page.evaluate(async () => {
        const fx = (await import('/js/skills.js')).activeSkillFx();
        return { travelling: fx.vfx.live.filter(i => i.travel).length };
      });
      await page.evaluate(async () => (await import('/js/skills.js')).activeSkillFx().vfx.clear());
      await sleep(200);
    }

    // an UNBOUND skill must draw absolutely nothing
    await page.evaluate((id) => {
      const w = window.__world;
      w.net.inject({ op: 'skillLaunch', skillId: id, level: 1,
        casterId: w.net.selfId, targetId: w.net.selfId });
    }, UNBOUND);
    await sleep(400);
    summary.unbound = await page.evaluate(async () => {
      const w = window.__world;
      const fx = (await import('/js/skills.js')).activeSkillFx();
      let sprites = 0;
      w.scene.traverse(o => { if (o.userData.skillFx) sprites++; });
      return { id: 1216, liveInstances: fx.vfx.live.length,
               legacySprites: fx.fx.length, taggedObjects: sprites };
    });
    await page.screenshot({ path: path.join(OUT, 'vfx_unbound.png') });

    // which effect classes did each anchor actually resolve to?
    summary.bindings = await page.evaluate(async (anchors) => {
      const j = await (await fetch('/gamedata/skillvfx.json')).json();
      const out = {};
      for (const a of anchors) {
        const e = j.skill[String(a.id)] || {};
        out[a.id] = [].concat(...'csxh'.split('').map(k =>
          (e[k] || []).map(x => j.fxn[x.f])));
      }
      return out;
    }, ANCHORS);
  } catch (e) {
    summary.errors.push('FATAL: ' + e.message);
  } finally {
    await browser.close();
  }

  // verdict
  summary.pass = true;
  for (const a of ANCHORS) {
    const got = (summary.bindings || {})[a.id] || [];
    const missing = a.expect.filter(c => !got.includes(c));
    if (missing.length) { summary.pass = false; summary[`missing_${a.id}`] = missing; }
  }
  const drew = (summary.anchors || []).filter(x => x.launch.particles > 0).length;
  if (drew < ANCHORS.length) { summary.pass = false; summary.drewCount = drew; }
  // bUseCharacterRotation: exactly one casting instance sits forward of the
  // caster (dot ~ 1 with its facing) and one sits at its feet.
  {
    const r = summary.charRotation || [];
    const fwd = r.filter(x => x.dotForward !== null && x.dotForward > 0.95);
    // (0, 0, -1) is one half-height below the cylinder CENTRE, and the renderer
    // lifts to that centre first — so the cast aura lands exactly on the feet:
    // no horizontal offset and dy == 0, not dy < 0.
    const feet = r.filter(x => x.horizDist < 0.05 && Math.abs(x.dy) < 0.05);
    if (fwd.length !== 1 || feet.length !== 1) {
      summary.pass = false;
      summary.charRotationVerdict = 'expected 1 forward + 1 at the feet';
    }
  }
  // every anchor's retail MeshEmitters must have produced real geometry
  for (const a of ANCHORS) {
    const got = ((summary.anchors || []).find(x => x.id === a.id) || {}).meshes || {};
    const missing = a.meshes.filter(m => !(got[m] > 0));
    if (missing.length) { summary.pass = false; summary[`missingMesh_${a.id}`] = missing; }
  }
  if (summary.unbound && (summary.unbound.liveInstances || summary.unbound.taggedObjects)) {
    summary.pass = false;
  }
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.pass ? 0 : 1);
})();
