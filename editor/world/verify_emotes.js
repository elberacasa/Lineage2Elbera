// THE TWELVE SOCIAL EMOTES, AND THE CREATURE CAST CLIP — THE WIRING HALF.
//
// verify_creature_anims.js proves the EXTRACTION: that the manifests and the
// glTFs carry the right clips. This suite proves the RUNTIME USES THEM, which
// is a different question and was the one that was wrong. Both halves have
// failed independently in this repo, so both are asserted.
//
//  1. THE PACKET FIELD SURVIVES THE HANDLER.  SocialAction carries `actionId`
//     and the gateway has forwarded it since bridge.js:1398. main.js's
//     handler read only `msg.id` — `entities.socialFlash(msg.id)` and
//     `character.emote('dance')` — so all twelve emotes danced. The clips and
//     the actionId->clip table were on disk the whole time, in
//     editor/characters/manifest.json's `socialActions`.
//
//  2. THE TABLE IS RETAIL'S, AND COMPLETE.  actionname.dat defines exactly
//     twelve (its `type` field, 2..13) and the client resolves each through
//     Engine.Pawn's PcSocialAnimName[], per race/gender —
//     tools/anim/social_actions.json. Every one of the 14 models must map all
//     twelve to a clip its own glTF actually contains, and the twelve must be
//     twelve DIFFERENT animations: identical sampler sets would mean the
//     pipeline had shipped one clip under twelve names, which looks exactly
//     like the bug being fixed.
//
//  3. THE CREATURE CAST CLIP IS NOT A WAIT POSE.  A monster answering a
//     spell used to strike its 'special' slot, which build_monsters had
//     filled with the first of SpWait01/Social01/atkwait — wait poses. The
//     slot now takes the client's own MagicShotAnimName. This suite measures
//     the shipped glTF clip's motion directly (mean per-frame quaternion
//     delta) rather than trusting the name: a cast clip must move
//     substantially more than the same creature's idle.
//
//  4. A SOCIAL ACTION ON A MONSTER IS NOT A SPELL.  NpcSocialAnimName is a
//     separate, retail-sourced slot (381 of 495 creatures) that the runtime
//     never used; socialFlash() called skillFlash(), so waving at a mob made
//     it cast.
//
//  All four are asserted as SOURCE-TEXT guards as well as data, because the
//  data has been right and unused before — which is the entire point.
//
// Usage:
//   node verify_emotes.js               report
//   node verify_emotes.js --check       assert, exit 1 on regression
//   node verify_emotes.js --live        also drive the real client (mock
//                                       gateway on 8085) and read back the
//                                       clip each of the twelve ids played
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CHARDIR = path.join(ROOT, 'editor', 'characters');
const CHARMAN = path.join(CHARDIR, 'manifest.json');
const MONMAN = path.join(CHARDIR, 'monsters', 'manifest.json');
const SOCIAL = path.join(ROOT, 'tools', 'anim', 'social_actions.json');
const JS = path.join(__dirname, 'js');

const CHECK = process.argv.includes('--check');
const LIVE = process.argv.includes('--live');
// --shots writes verify_shots/emotes_<tag>/<id>_<clip>.png, one frame per
// SocialAction id, taken partway into the clip. Run it once with the client
// stashed and once with it applied and the two directories are the before/
// after: on the pre-fix tree all twelve are the same dance frame.
const SHOTS = process.argv.find(a => a.startsWith('--shots'));
const SHOTS_TAG = SHOTS && SHOTS.includes('=') ? SHOTS.split('=')[1] : 'now';
const BASE = process.env.WORLD_BASE
  || 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0';
const TILE = process.env.TILE || '22_22';

const summary = { checks: [], failed: false };
function check(name, ok, detail) {
  summary.checks.push({ name, ok: !!ok, detail });
  if (!ok) summary.failed = true;
}
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));

// actionname.dat's twelve types. Frozen here as the contract the rest of the
// suite is about; verify_creature_anims.js re-derives it from the .dat.
const ACTION_IDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

// ------------------------------------------------- glTF animation identity
// Two clips are "the same animation" when they read the same accessors. That
// is stricter than comparing durations and cheaper than decoding keyframes,
// and it is exactly the question being asked: did the pipeline ship twelve
// animations, or one animation twelve times?
function clipSignature(gltf, anim) {
  const acc = [];
  for (const s of anim.samplers) acc.push(s.input, s.output);
  return acc.sort((a, b) => a - b).join(',');
}

// Mean per-frame quaternion delta over every rotation track, in radians.
// The measure verify_creature_anims.js used on the retail .psa, applied here
// to what the glTF actually ships.
function clipMotion(gltf, bin, anim) {
  let total = 0;
  let count = 0;
  for (const ch of anim.channels) {
    if (ch.target.path !== 'rotation') continue;
    const acc = gltf.accessors[anim.samplers[ch.sampler].output];
    if (acc.type !== 'VEC4' || acc.componentType !== 5126) continue;
    const bv = gltf.bufferViews[acc.bufferView];
    const off = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const buf = bin[bv.buffer];
    for (let i = 0; i < acc.count - 1; i++) {
      let dot = 0;
      for (let k = 0; k < 4; k++) {
        dot += buf.readFloatLE(off + (i * 4 + k) * 4)
          * buf.readFloatLE(off + ((i + 1) * 4 + k) * 4);
      }
      total += 2 * Math.acos(Math.min(1, Math.abs(dot)));
      count++;
    }
  }
  return count ? total / count : null;
}

function loadGltf(dir, rel) {
  const p = path.join(dir, rel);
  const g = JSON.parse(fs.readFileSync(p, 'utf8'));
  const bin = (g.buffers || []).map(
    b => fs.readFileSync(path.join(path.dirname(p), decodeURIComponent(b.uri))));
  return { g, bin };
}

// --------------------------------------------------------- 1+2. the emotes
function emoteChecks() {
  const models = readJSON(CHARMAN).models;
  const social = fs.existsSync(SOCIAL) ? readJSON(SOCIAL) : null;

  check('the decoded PcSocialAnimName table still covers 14 race/gender sets '
    + 'and twelve types', social
      && Object.keys(social.prefixes).length === 14
      && social.types.length === 12
      && social.types.every((t, i) => t === ACTION_IDS[i]),
    social ? `${Object.keys(social.prefixes).length} sets, `
      + `types ${social.types.join(',')}` : 'tools/anim/social_actions.json missing');

  const noTable = models.filter(m => !m.socialActions);
  check('all 14 player models carry a socialActions map', noTable.length === 0,
    noTable.map(m => m.id).join(', ') || `${models.length} models`);

  const missingId = [];
  const notInGltf = [];
  const notDistinct = [];
  const perModel = {};
  for (const m of models) {
    const t = m.socialActions || {};
    for (const id of ACTION_IDS) if (!t[String(id)]) missingId.push(`${m.id}:${id}`);
    const { g } = loadGltf(CHARDIR, m.gltf);
    const byName = new Map((g.animations || []).map(a => [a.name, a]));
    const sigs = new Map();
    for (const id of ACTION_IDS) {
      const clip = t[String(id)];
      const anim = clip && byName.get(clip);
      if (!anim) { notInGltf.push(`${m.id}:${id}->${clip}`); continue; }
      const sig = clipSignature(g, anim);
      if (sigs.has(sig)) notDistinct.push(`${m.id}: ${sigs.get(sig)} == ${clip}`);
      else sigs.set(sig, clip);
    }
    perModel[m.id] = Object.fromEntries(
      ACTION_IDS.map(id => [id, t[String(id)] || null]));
  }
  check('every model maps all twelve SocialAction ids', missingId.length === 0,
    missingId.slice(0, 8).join(', ') || `${models.length * 12} mappings`);
  check('every mapped clip exists in that model\'s own glTF',
    notInGltf.length === 0, notInGltf.slice(0, 8).join(', ') || 'all present');
  check('the twelve are twelve DIFFERENT animations, not twelve names for '
    + '"dance"', notDistinct.length === 0,
    notDistinct.slice(0, 6).join(' | ') || 'all distinct per model');
  summary.emoteTable = perModel;

  // --- the wiring, as source text
  const mainSrc = fs.readFileSync(path.join(JS, 'main.js'), 'utf8');
  const entSrc = fs.readFileSync(path.join(JS, 'entities.js'), 'utf8');
  const chSrc = fs.readFileSync(path.join(JS, 'character.js'), 'utf8');

  check('main.js passes the packet\'s actionId to the EntityManager',
    /entities\.socialFlash\(\s*msg\.id\s*,\s*msg\.actionId\s*\)/.test(mainSrc),
    mainSrc.match(/entities\.socialFlash\([^)]*\)/) ?
      mainSrc.match(/entities\.socialFlash\([^)]*\)/)[0] : 'no call found');
  check('main.js resolves the local player\'s emote by actionId, not by a '
    + 'hard-coded clip',
    /character\.socialEmote\(\s*msg\.actionId\s*\)/.test(mainSrc)
      && !/character\.emote\('dance'\)/.test(mainSrc),
    /character\.emote\('dance'\)/.test(mainSrc)
      ? "still calls character.emote('dance')" : 'socialEmote(msg.actionId)');
  check('entities.socialFlash takes the actionId and forwards it',
    /socialFlash\(\s*id\s*,\s*actionId\s*\)/.test(entSrc)
      && /socialEmote\(\s*actionId\s*\)/.test(entSrc));
  check('character.js resolves actionId through the model\'s own table',
    /socialClip\(\s*actionId\s*\)/.test(chSrc)
      && /this\.socialActions/.test(chSrc)
      && /charManifest\(\)/.test(chSrc));
  check('a miss resolves to NOTHING rather than to a default clip — a '
    + 'fallback here would restore the bug quietly',
    /if \(!clip\) return null;/.test(chSrc));

  // --- the resolver, replayed
  const resolve = (table, actionId) => (table && table[String(actionId)]) || null;
  const bad = [];
  for (const m of models) {
    for (const id of ACTION_IDS) {
      const want = m.socialActions[String(id)];
      if (resolve(m.socialActions, id) !== want) bad.push(`${m.id}:${id}`);
    }
  }
  check('the replayed resolver returns the manifest clip for all 168 '
    + '(14 models x 12 ids) pairs', bad.length === 0,
    bad.join(', ') || '168/168');
}

// --------------------------------------------------- 3+4. creature clips
function creatureChecks() {
  const models = readJSON(MONMAN).models;
  const dir = path.join(CHARDIR, 'monsters');
  const entSrc = fs.readFileSync(path.join(JS, 'entities.js'), 'utf8');

  // mapAnimations must still prefer the dedicated 'special' clip. The exact
  // literal is also guarded by verify_anim.js; repeated here because THIS
  // suite's cast conclusions are void without it.
  check("entities.js mapAnimations still binds special to the 'special' clip",
    entSrc.includes("special: find('special') || find('attack') || first"));
  check('the social clip is bound outside mapAnimations (so the audit replay '
    + 'stays valid) and NpcEntity plays it for a social action',
    /this\.actions\.social = raw\.social \|\| null;/.test(entSrc)
      && /socialFlash\(\)\s*\{[\s\S]*?_playTimed\('social'/.test(entSrc));
  check('socialFlash on a monster no longer plays the CAST clip',
    !/if \(e\.kind === 'npc'\) e\.skillFlash\(\);/.test(entSrc));

  // WHICH CREATURES ARE ALLOWED A MOTIONLESS CAST, stated as a predicate
  // rather than as a name pattern. Two facts decide it and neither is a
  // guess:
  //   hasStrike  — the manifest gives it an `attack` clip that is not simply
  //                its idle under another name. A creature with no strike in
  //                the retail set (most civilians; crokian_sorcerer, whose
  //                whole set is Social01/Social02) has nothing better to play
  //                and retail plays a pose too.
  //   retailSaid — clipSource.special === 'retail:MagicShotAnimName', i.e.
  //                the CLIENT'S OWN table names that pose as the cast. Those
  //                are retail being retail, and they are NAMED below rather
  //                than quietly excused.
  // Anything left over is the pipeline having picked a pose for a creature
  // that owns a strike, which is the defect this whole slot exists about.
  const clipsOf = m => m.clips || {};
  const isPose = m => {
    const sp = clipsOf(m).special;
    return !!sp && (sp === clipsOf(m).idle || /^(wait|spwait|social)/i.test(sp));
  };
  const hasStrike = m => !!clipsOf(m).attack && clipsOf(m).attack !== clipsOf(m).idle;
  const retailSaid = m => (m.clipSource || {}).special === 'retail:MagicShotAnimName';

  const sanctioned = models.filter(m => isPose(m) && hasStrike(m) && retailSaid(m));
  const offenders = models.filter(m => isPose(m) && hasStrike(m) && !retailSaid(m));
  check('no creature that owns a strike has a POSE in its cast slot unless '
    + 'the client\'s own MagicShotAnimName put it there',
    offenders.length === 0,
    offenders.map(m => `${m.id}:${clipsOf(m).special}`).slice(0, 8).join(', ')
      || `${sanctioned.length} retail-sanctioned: `
        + sanctioned.map(m => `${m.id} (${clipsOf(m).special})`).join(', '));
  summary.poseCast = {
    sanctioned: sanctioned.map(m => ({ id: m.id, clip: clipsOf(m).special })),
    noStrike: models.filter(m => isPose(m) && !hasStrike(m)).length,
  };

  // And the shipped glTF must back the manifest up: where the cast is NOT a
  // sanctioned pose, the clip in the file has to move. Sampled rather than
  // exhaustive — reading every buffer of 495 models costs minutes and buys
  // nothing extra.
  const withSpecial = models.filter(m => (m.animations || []).includes('special')
    && hasStrike(m) && !isPose(m));
  const sample = withSpecial.filter((_, i) => i % 12 === 0).slice(0, 24);
  const still = [];
  const measured = [];
  for (const m of sample) {
    let g;
    try { g = loadGltf(dir, m.gltf); } catch (e) { continue; }
    const by = new Map((g.g.animations || []).map(a => [a.name, a]));
    const sp = by.get('special');
    const idle = by.get('idle');
    if (!sp || !idle) continue;
    const mSp = clipMotion(g.g, g.bin, sp);
    const mIdle = clipMotion(g.g, g.bin, idle);
    if (mSp == null || mIdle == null) continue;
    measured.push({ id: m.id, clip: m.clips.special, special: +mSp.toFixed(4),
      idle: +mIdle.toFixed(4), source: m.clipSource.special,
      sameAsIdle: clipSignature(g.g, sp) === clipSignature(g.g, idle) });
    // THE THRESHOLD IS MEASURED, NOT PICKED. verify_creature_anims.js read
    // the retail .psa and found the wait poses at 0.0028-0.0057 rad of mean
    // per-frame quaternion delta and real strikes at 0.0277-0.0365. MOTION
    // sits between those two bands, so a clip that fails it is inside the
    // wait band and a clip that passes is not.
    //
    // A ratio against the creature's own idle would have been the obvious
    // test and is WRONG: lidia_von_helmann_m00's idle is itself animated at
    // 0.1336, more than three times a normal strike, so "twice the idle"
    // fails a perfectly good spatk01 at 0.1505. Identity against the idle is
    // asserted separately, which is the thing that ratio was reaching for.
    const MOTION = 0.015;
    if (mSp < MOTION) still.push(`${m.id}:${m.clips.special} (${mSp.toFixed(4)})`);
  }
  summary.castMotion = measured;
  check('every sampled cast clip moves more than the retail WAIT band — '
    + 'measured from the shipped glTF, not from the clip\'s name',
    still.length === 0,
    still.join(', ') || `${measured.length} sampled, all above 0.015 rad/frame`);
  const echoesIdle = measured.filter(m => m.sameAsIdle);
  check('no sampled cast clip is the creature\'s idle animation under '
    + 'another name', echoesIdle.length === 0,
    echoesIdle.map(m => m.id).join(', ') || `${measured.length} sampled`);

  const socialSourced = models.filter(
    m => ((m.clipSource || {}).social || '').startsWith('retail:')).length;
  check('the NpcSocialAnimName decode is still there to be used',
    socialSourced >= 380, `${socialSourced} creatures retail-sourced`);
}

// ------------------------------------------------------------------- live
async function live() {
  const puppeteer = require(path.join(ROOT,
    'tools/src/char_pipeline/node_modules/puppeteer-core'));
  const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const browser = await puppeteer.launch({
    executablePath: CHROME, protocolTimeout: 900000,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready',
      { timeout: 180000 });
    await page.click('#online-toggle');
    await page.waitForFunction('window.__world.net.selfId != null',
      { timeout: 60000 });
    await sleep(2000);

    const got = await page.evaluate(async (ids) => {
      const w = window.__world;
      const selfId = w.net.selfId;
      const res = [];
      for (const actionId of ids) {
        w.character.emoteUntil = 0;
        w.character.lastOneShot = null;
        w.character.lastSocial = null;
        // through the REAL dispatch, not by calling the resolver directly
        w.net.inject({ op: 'socialAction', id: selfId, actionId });
        await new Promise(r => setTimeout(r, 60));
        res.push({ actionId,
          played: w.character.lastOneShot ? w.character.lastOneShot.clip : null,
          resolved: w.character.lastSocial ? w.character.lastSocial.clip : null });
      }
      return { selfId, modelId: w.selfModelId, res };
    }, ACTION_IDS);

    check('no page errors while driving the twelve emotes', errors.length === 0,
      errors.join('; '));
    const models = readJSON(CHARMAN).models;
    const entry = models.find(m => m.id === got.modelId);
    const want = entry ? entry.socialActions : null;
    const wrong = got.res.filter(
      r => !want || r.played !== want[String(r.actionId)]);
    check(`all twelve emotes play their own clip on ${got.modelId} (live)`,
      wrong.length === 0,
      wrong.length ? JSON.stringify(wrong)
        : got.res.map(r => `${r.actionId}=${r.played}`).join(' '));
    const uniq = new Set(got.res.map(r => r.played));
    check('the twelve live plays are twelve different clips', uniq.size === 12,
      `${uniq.size} distinct: ${[...uniq].join(', ')}`);
    summary.liveEmotes = got;

    if (SHOTS) {
      const dir = path.join(__dirname, 'verify_shots', `emotes_${SHOTS_TAG}`);
      fs.mkdirSync(dir, { recursive: true });
      await page.evaluate(() => {
        const w = window.__world;
        w.followCam.pitch = 0.10;
        w.followCam.dist = 3.4;     // metres (the setter clamps to retail's 0.2..4.7)
        w.followCam.yaw = Math.PI;
        for (const el of document.querySelectorAll('body > *')) {
          if (el.tagName !== 'CANVAS') el.style.display = 'none';
        }
      });
      await sleep(1200);
      for (const actionId of ACTION_IDS) {
        await page.evaluate((a) => {
          const w = window.__world;
          w.character.emoteUntil = 0;
          w.net.inject({ op: 'socialAction', id: w.net.selfId, actionId: a });
        }, actionId);
        // ~45% into the clip: past the cross-fade, before it re-idles
        const ms = await page.evaluate(
          () => (window.__world.character.lastOneShot || {}).ms || 800);
        await sleep(Math.max(200, ms * 0.45));
        const clip = await page.evaluate(
          () => (window.__world.character.lastOneShot || {}).clip || 'none');
        await page.screenshot({
          path: path.join(dir, `${String(actionId).padStart(2, '0')}_${clip}.png`),
          clip: { x: 480, y: 200, width: 320, height: 480 },
        });
      }
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('body > *')) {
          if (el.tagName !== 'CANVAS') el.style.display = '';
        }
      });
      summary.shotDir = dir;
    }

    // the cast clip, through the real dispatch, on creatures whose retail
    // MagicShotAnimName differs from their strike
    const cast = await page.evaluate(async (picks) => {
      const w = window.__world;
      const p = w.character.group.position;
      const out = [];
      let eid = 940001;
      for (const [mesh, npcId] of picks) {
        const id = eid++;
        w.net.inject({ op: 'addNpc', id, npcId, name: mesh,
          x: Math.round(p.x * 100) + 200, y: -Math.round(p.z * 100),
          z: Math.round(p.y * 100), heading: 0 });
        const t0 = Date.now();
        let e = null;
        while (Date.now() - t0 < 30000) {
          e = w.entities.entities.get(id);
          if (e && e.actions && Object.keys(e.actions).length) break;
          await new Promise(r => setTimeout(r, 200));
        }
        if (!e || !e.actions) { out.push({ mesh, err: 'never loaded' }); continue; }
        e.lastFlash = null;
        w.entities.skillFlash(id);
        await new Promise(r => setTimeout(r, 80));
        const castState = e.lastFlash && e.lastFlash.state;
        const castClip = castState && e.actions[castState]
          ? e.actions[castState].getClip().name : null;
        e.lastFlash = null;
        const socialState = w.entities.socialFlash(id, 12);
        await new Promise(r => setTimeout(r, 80));
        const socialClip = socialState && e.actions[socialState]
          ? e.actions[socialState].getClip().name : null;
        out.push({ mesh, castState, castClip, socialState, socialClip,
          idleClip: e.actions.idle ? e.actions.idle.getClip().name : null });
        w.entities.remove(id);
      }
      return out;
    }, [['pirates_zombie_m00', 20836], ['barka_silenos_shaman_m00', 21355],
      ['doll_master_m00', 20803], ['gremlin_m00', 20001]]);

    summary.liveCast = cast;
    const castBad = cast.filter(c => c.err || c.castState !== 'special'
      || c.castClip === c.idleClip);
    check('a skill cast plays the creature\'s own cast clip, never its idle '
      + '(live)', castBad.length === 0, JSON.stringify(castBad.length ? castBad : cast));
    const socialBad = cast.filter(c => !c.err && c.socialClip
      && c.socialClip === c.castClip);
    check('a social action on a monster plays its social clip, not its cast '
      + 'clip (live)', socialBad.length === 0,
      JSON.stringify(socialBad.length ? socialBad
        : cast.map(c => `${c.mesh}:${c.socialClip}`)));
  } finally {
    await browser.close();
  }
}

// ------------------------------------------------------------------- main
(async () => {
  emoteChecks();
  creatureChecks();
  if (LIVE) await live();

  const t = summary.emoteTable && summary.emoteTable.human_fighter_m;
  if (t) {
    console.log('the twelve, on human_fighter_m:');
    for (const id of ACTION_IDS) console.log(`  ${String(id).padStart(2)}  ${t[id]}`);
  }
  if (summary.castMotion && summary.castMotion.length) {
    console.log('\ncast clip motion (mean per-frame quaternion delta, rad):');
    for (const m of summary.castMotion.slice(0, 8)) {
      console.log(`  ${m.id.padEnd(30)} ${String(m.clip).padEnd(10)} `
        + `special ${m.special}  idle ${m.idle}   ${m.source}`);
    }
  }
  console.log('');
  for (const c of summary.checks) {
    console.log(`  [${c.ok ? 'ok' : 'FAIL'}] ${c.name}`);
    if (!c.ok && c.detail) console.log(`         ${c.detail}`);
  }
  if (summary.failed) {
    console.log('\nEMOTE / CAST WIRING VERIFICATION FAILED');
    process.exit(CHECK ? 1 : 0);
  }
  console.log('\nall emote / cast wiring checks passed');
})().catch(e => { console.error(e); process.exit(2); });
