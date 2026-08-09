// Per-skill cast ANIMATION + EFFECT verification against the MOCK gateway.
// Three skill families (data-driven, assets/gamedata/skillanim.json):
//   melee strike      3 Power Strike  (anim 'S', magic 0, range 40)
//                     -> 'spAtk01'/'spAtk02' clip (physical skills alternate
//                     the two; only the plain attack op still plays 'attack')
//                     + amber slash arc at the target
//   magic projectile  1177 Wind Strike (anim 'E', magic 1, range 600,
//                     wind_strike_explotion hit sound)
//                     -> 'castShort'/'castMid'/'castLong' clip by hitTime
//                     + cyan bolt caster->target + hit flash
//   self buff/heal    1216 Self Heal  (anim 'D', magic 1, range -1)
//                     -> cast clip + green aura ring at self
// plus the exact clip mapping: 271 Dance of the Warrior (anim 'N')
//                     -> 'dance' clip (retail Social_dance).
//
// Usage: node verify_skillanim.js   (mock gateway on 8085, server on 8083)
// Output: verify_shots/skillanim_*.png + JSON summary on stdout.
const fs = require('fs');
const path = require('path');
const puppeteer = require(
  '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0';
const OUT = path.join(__dirname, 'verify_shots');
const GREMLIN = 70001;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function check(summary, name, ok, detail) {
  summary.checks.push({ name, ok: !!ok, detail });
  if (!ok) summary.failed = true;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  const summary = { checks: [], consoleLogs: [], failed: false };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('console', m => summary.consoleLogs.push(m.text()));
    page.on('pageerror', e => summary.consoleLogs.push('PAGEERROR: ' + e.message));

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 30000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'skillList')`, { timeout: 20000 });
    await sleep(800);

    // aim the camera at the gremlin so the effects are on screen
    await page.evaluate((id) => {
      const w = window.__world;
      const e = w.entities.getEntity(id);
      const c = w.character.group.position;
      w.followCam.yaw = Math.atan2(e.group.position.x - c.x, e.group.position.z - c.z);
      w.followCam.pitch = 0.5;
      w.followCam.dist = Math.max(w.followCam.minDist, 5);
    }, GREMLIN);
    await sleep(1200);

    // helpers evaluated in-page
    const castVia = (skillId, targetId) => page.evaluate((sid, tid) => {
      const w = window.__world;
      w.net.sendOp('target', { id: tid });
      w.net.sendOp('useSkill', { skillId: sid });
    }, skillId, targetId);
    const clipName = () => page.evaluate(() => {
      const c = window.__world.character;
      return c && c.current ? c.current.getClip().name : null;
    });
    // `userData.skillFx` is now stamped by THREE different producers, and only
    // one of them is what this suite asserts on:
    //   js/skills.js:333       { kind, skillId, source:'authored-pop' }  MeshBasicMaterial
    //   js/skillvfx.js:440     { source:'skillvfx.json' }                ShaderMaterial
    //   js/skillvfx.js:522     { source:'skillmesh.json', mesh }         ShaderMaterial
    // A ShaderMaterial has no `.color`, so the unconditional
    // `o.material.color.getHexString()` this used to do threw
    // `Cannot read properties of undefined (reading 'getHexString')` the
    // moment the retail VFX layer put an emitter in the scene — a SUITE bug
    // caused by a legitimate product addition, not a regression in the FX.
    // Filter to the authored-pop objects (they are the ones carrying `kind`
    // and `skillId`, which every check below matches on) and read the colour
    // defensively so a future material type reports rather than throws.
    const fxNow = () => page.evaluate(() => {
      const out = [];
      window.__world.scene.traverse(o => {
        const fx = o.userData.skillFx;
        if (!fx || fx.kind == null) return;
        const col = o.material && o.material.color;
        out.push({
          ...fx,
          color: col ? '#' + col.getHexString() : null,
          materialType: o.material ? o.material.type : null,
          pos: o.position.toArray().map(v => +v.toFixed(2)),
        });
      });
      return out;
    });

    // ---- 1. melee strike: Power Strike (3) on the gremlin -----------------
    await castVia(3, GREMLIN);
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'skillCast' && m.skillId === 3)`,
      { timeout: 8000 });
    await sleep(350);   // mid-cast: gesture must be playing
    const meleeClip = await clipName();
    // physical skills gesture with the rebuilt SpAtk clips (skillfx_anim.js
    // clipForSkill: is_magic 0 -> 'spAtk01'/'spAtk02', alternating); the
    // 'attack' clip is now reserved for the plain melee attack op
    check(summary, 'melee_clip_spatk',
      meleeClip === 'spAtk01' || meleeClip === 'spAtk02', `clip=${meleeClip}`);
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'skillLaunch' && m.skillId === 3)`,
      { timeout: 8000 });
    await sleep(180);
    let fx = await fxNow();
    const slash = fx.find(f => f.kind === 'slash' && f.skillId === 3);
    check(summary, 'melee_slash_fx', !!slash, JSON.stringify(fx));
    check(summary, 'melee_slash_color', slash && slash.color === '#ffc060',
      slash && slash.color);
    await page.screenshot({ path: path.join(OUT, 'skillanim_1_melee_slash.png') });
    await sleep(2000);

    // ---- 2. magic projectile: Wind Strike (1177) on the gremlin -----------
    await castVia(1177, GREMLIN);
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'skillLaunch' && m.skillId === 1177)`,
      { timeout: 8000 });
    await sleep(120);   // bolt mid-flight
    fx = await fxNow();
    const bolt = fx.find(f => f.kind === 'projectile' && f.skillId === 1177);
    check(summary, 'magic_projectile_fx', !!bolt, JSON.stringify(fx));
    check(summary, 'magic_projectile_color', bolt && bolt.color === '#6fd8ff',
      bolt && bolt.color);
    await page.screenshot({ path: path.join(OUT, 'skillanim_2_projectile.png') });
    // bolt lands within ~350 ms -> hit flash (poll; screenshot latency
    // makes fixed sleeps flaky in headless)
    let hitFound = true;
    try {
      await page.waitForFunction(`(() => {
        let found = false;
        window.__world.scene.traverse(o => {
          if (o.userData.skillFx && o.userData.skillFx.kind === 'hit'
              && o.userData.skillFx.skillId === 1177) found = true;
        });
        return found;
      })()`, { timeout: 3000, polling: 50 });
    } catch { hitFound = false; }
    check(summary, 'magic_hit_flash', hitFound, hitFound ? 'hit flash seen' : 'timeout');
    fx = await fxNow();
    await page.screenshot({ path: path.join(OUT, 'skillanim_2b_hit.png') });
    await sleep(2000);

    // ---- 3. self heal: aura ring at the caster ----------------------------
    await castVia(1216, GREMLIN);   // SELF-target: mock routes to self
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'skillLaunch' && m.skillId === 1216
        && m.targetId === window.__world.net.selfId)`,
      { timeout: 8000 });
    await sleep(120);
    await page.screenshot({ path: path.join(OUT, 'skillanim_3_self_aura.png') });
    fx = await fxNow();
    const aura = fx.find(f => f.kind === 'aura' && f.skillId === 1216);
    check(summary, 'self_aura_fx', !!aura, JSON.stringify(fx));
    check(summary, 'self_aura_color', aura && aura.color === '#86f0b0',
      aura && aura.color);
    if (aura) {
      const selfPos = await page.evaluate(() =>
        window.__world.character.group.position.toArray().map(v => +v.toFixed(2)));
      const near = Math.hypot(aura.pos[0] - selfPos[0], aura.pos[2] - selfPos[2]) < 0.5;
      check(summary, 'self_aura_at_caster', near, `aura=${aura.pos} self=${selfPos}`);
    }
    await sleep(2000);

    // ---- 4. dance: exact clip mapping ('N' -> 'dance') --------------------
    await castVia(271, GREMLIN);
    await page.waitForFunction(
      `window.__world.net.log.some(m => m.op === 'skillCast' && m.skillId === 271)`,
      { timeout: 8000 });
    await sleep(500);
    const danceClip = await clipName();
    check(summary, 'dance_clip_exact', danceClip === 'dance', `clip=${danceClip}`);
    await page.screenshot({ path: path.join(OUT, 'skillanim_4_dance.png') });

    summary.pageErrors = summary.consoleLogs.filter(l => l.startsWith('PAGEERROR'));
    check(summary, 'no_page_errors', summary.pageErrors.length === 0,
      summary.pageErrors.join(' | ') || 'none');
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed) process.exit(1);
})().catch(e => { console.error('VERIFY SKILLANIM FAILED:', e.stack || e.message); process.exit(1); });
