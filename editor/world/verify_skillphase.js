// Skill EFFECT + SOUND phase verification.
//
// This suite exists because of a defect the older suites could not see: the
// data was decoded correctly and then wired to the wrong field. Concretely,
// before 2026-08-09
//   * assets/audio/bindings.json put skillsoundgrp's THREE PHASE SLOTS
//     (cast / shot / explosion) into ONE list and js/gamesound.js picked among
//     them at random, so a skill could play its impact sound as the gesture
//     began; and
//   * assets/gamedata/skillvfx.json dropped Skill.usk's AttachOn entirely, so
//     every effect hung off the actor's collision centre and tracked the actor
//     for life -- including the projectiles and impact bursts that retail
//     explicitly marks EAM_None.
// Both look perfectly healthy from the outside. So this file asserts the
// BINDING, not the presence of pixels.
//
// `--check` runs pure Node against the shipped tables: no server, no browser,
// ~1 s. It FAILS on the pre-2026-08-09 tree (proven: see the report of that
// wave -- gate S1 reads one bank of 2 refs where it needs two phases, gate A1
// finds no `at` key at all).
//
// Without `--check` it additionally drives the real client (8083 + the mock on
// 8085) to prove the RENDERER honours what the tables say, and writes
// screenshots to verify_shots/phase_*.png.
//
// Usage:
//   node verify_skillphase.js --check             data gates only, ~1 s
//   node verify_skillphase.js                     + browser gates + screenshots
//   node verify_skillphase.js --check --browser   both (what the battery runs)
//
// The exit code is NEVER gated on a flag: every mode exits nonzero on any
// failed assertion, and on fewer than 25 assertions evaluated. `--check` only
// selects how much is checked.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const GAMEDATA = path.join(ROOT, 'assets', 'gamedata');
const AUDIO = path.join(ROOT, 'assets', 'audio');
const OUT = path.join(__dirname, 'verify_shots');
const CHECK_ONLY = process.argv.includes('--check')
                && !process.argv.includes('--browser');

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}  ${detail}`); }
  return ok;
}

// ===========================================================================
// data gates
// ===========================================================================

const vfx = readJson(path.join(GAMEDATA, 'skillvfx.json'));
const binds = readJson(path.join(GAMEDATA, 'skillvisualeffect.json'));
const sound = readJson(path.join(GAMEDATA, 'skillsoundgrp.json'));
const bindings = readJson(path.join(AUDIO, 'bindings.json'));

// EAttachMethod, Engine.u Enum export declared ON SkillAction_LocateEffect
const EAM = { NONE: 0, RH: 1, LH: 2, BONE: 3, ALIAS: 4, TRAIL: 5, RF: 6, LF: 7 };
const PHASES = ['c', 's', 'x', 'h'];   // casting / shot / explosion / channeling

const actionsOf = e => PHASES.flatMap(k => e[k] || []);
const fxName = a => vfx.fxn[a.f];
function action(sid, phase, cls) {
  return (vfx.skill[sid] || {})[phase]?.find(a => fxName(a) === cls) || null;
}

console.log('\n-- A. effect attach point (Skill.usk AttachOn / EAttachMethod)');

// A1. The attach method reaches the client index at all. This is the gate that
// fails on the pre-fix tree: `at` did not exist there.
const allActions = Object.values(vfx.skill).flatMap(actionsOf);
const withAt = allActions.filter(a => a.at);
check('A1 actions carry AttachOn', withAt.length > 0,
      `${withAt.length}/${allActions.length} actions`);

// A2. SHIELD skills attach to the LEFT hand and dagger/sword skills to the
// RIGHT. This is the assertion that would break first if the enum ordinals
// were wrong, because it is a semantic cross-check the ordinals cannot fake.
for (const [sid, cls] of [['92', 'at_shield_stun_ca'], ['353', 'at_shield_slam_ca']]) {
  const a = action(sid, 'c', cls);
  check(`A2 ${cls} (skill ${sid}) attaches LEFT hand`, a && a.at === EAM.LH,
        `at=${a && a.at}`);
}
for (const [sid, cls] of [['223', 'at_sting_ca'], ['263', 'at_mortal_blow_ca'],
                          ['254', 'dw_spoil_ca']]) {
  const a = action(sid, 'c', cls);
  check(`A2 ${cls} (skill ${sid}) attaches RIGHT hand`, a && a.at === EAM.RH,
        `at=${a && a.at}`);
}

// A3. The player-facing elemental bolts are EAM_None -- NOT attached -- which
// is what lets the renderer leave them where they were spawned.
//
// "every _fl class is EAM_None" is FALSE and this gate used to assert it. The
// measurement that corrected it: 3 of the 19 `_fl` actions in the table DO
// carry an attach method, and all three are sourced and sensible --
// mb_valakas_breath_low_fl / _high_fl hang off the bone `Dummy05` (a breath
// weapon has to stream from the dragon's head, and 4683/4684 are Valakas), and
// el_ice_dagger_fl on skill 4204 is EAM_Trail. So the rule is about the
// PROJECTILE classes, and the three exceptions are named here so their number
// cannot grow silently.
const flying = [];
for (const [sid, e] of Object.entries(vfx.skill)) {
  for (const a of actionsOf(e)) if (/_fl$/.test(fxName(a))) flying.push([sid, a]);
}
const FL_ATTACHED = new Set(['4204:el_ice_dagger_fl',
                             '4683:mb_valakas_breath_low_fl',
                             '4684:mb_valakas_breath_high_fl']);
const flAttached = flying.filter(([sid, a]) => a.at).map(([sid, a]) => `${sid}:${fxName(a)}`);
check('A3 the elemental bolts are EAM_None', flying.length > 10 &&
      flAttached.every(k => FL_ATTACHED.has(k)) &&
      flying.filter(([, a]) => !a.at).length >= 16,
      `${flying.length} _fl actions, attached: ${flAttached.join(', ') || 'none'}`);
for (const sid of ['1177', '1159', '1178', '1181']) {
  const a = actionsOf(vfx.skill[sid] || {}).find(x => /_fl$/.test(fxName(x)));
  check(`A3 skill ${sid} bolt is unattached`, a && !a.at, a ? `at=${a.at}` : 'no _fl action');
}

// A4. A named bone survives the join with its name.
const boned = allActions.filter(a => a.b);
check('A4 named AttachBoneName survives', boned.length > 0,
      `${boned.length} actions, e.g. ${[...new Set(boned.map(a => a.b))].slice(0, 4).join(', ')}`);
check('A4 every named bone carries a bone-ish attach method',
      boned.length > 0 && boned.every(a => [EAM.BONE, EAM.ALIAS, EAM.TRAIL].includes(a.at)),
      `methods ${[...new Set(boned.map(a => a.at))].sort().join(',')}`);

// A5. The index must not have gained attach points the source table never had,
// and must not have lost any it could carry. Two source actions carry an
// AttachOn but NO EffectClass at all (skills 832 and 4548, both casting) --
// there is nothing to spawn, so they are dropped upstream by design.
let srcAttached = 0, srcAttachedNoEffect = 0;
for (const rec of Object.values(binds)) {
  for (const acts of Object.values(rec.phases || {})) {
    for (const a of acts) {
      if (!a.attachOn) continue;
      if (a.effect) srcAttached++; else srcAttachedNoEffect++;
    }
  }
}
check('A5 attach count matches skillvisualeffect.json exactly',
      withAt.length === srcAttached,
      `index ${withAt.length} vs source ${srcAttached} ` +
      `(+${srcAttachedNoEffect} source actions have AttachOn but no EffectClass)`);
check('A5 the two effect-less actions are exactly the known pair',
      srcAttachedNoEffect === 2, `${srcAttachedNoEffect}`);

console.log('\n-- B. effect PROVENANCE (a skill the tables do not bind draws nothing)');

// B1. Every action points at a real decoded effect class.
check('B1 every action resolves to a decoded effect class',
      allActions.every(a => vfx.fx[a.f] && Array.isArray(vfx.fx[a.f].e)),
      `${allActions.length} actions`);
// B2. Every emitter carries either a staged texture index or a mesh index --
// nothing may be drawn from an authored stand-in.
const emitters = vfx.fx.flatMap(f => f.e);
check('B2 every emitter is sourced (texture index or mesh index)',
      emitters.length > 0 &&
      emitters.every(e => (e.k === 1 ? e.g != null : e.t != null)),
      `${emitters.length} emitters`);
// B3. The unbound anchor. Skill 1216 (Self Heal) is absent from the table and
// must stay absent -- this is the assertion that catches a stand-in creeping
// back in as a "reasonable default".
check('B3 skill 1216 is NOT bound (draws nothing by construction)',
      !vfx.skill['1216']);
check('B3 skill 1177 IS bound (the gate is not vacuous)', !!vfx.skill['1177']);

console.log('\n-- C. phases the data actually defines');

// The counts have to be split by BINDING SOURCE or they mean nothing: `b:1` is
// the retail Skill.usk table, `b:2` is build_skillfx.py's name-convention
// heuristic (the retail fallback is native code with no data presence).
const phaseCount = { 1: { c: 0, s: 0, x: 0, h: 0 }, 2: { c: 0, s: 0, x: 0, h: 0 } };
for (const e of Object.values(vfx.skill)) {
  for (const k of PHASES) if (e[k]) phaseCount[e.b][k]++;
}
// Measured from skillvisualeffect.json's own arrays: casting 241, shot 159,
// explosion 17, channeling 3, PreshotActions 0 across all 244 objects. So
// "a skill has a cast, a travel and an impact effect" is NOT what the data
// says: only 17 of the 244 explicitly-bound skills have an explosion phase,
// and the travel phase exists for the 16 skills with a FlyingTime.
check('C1 casting is the dominant retail phase', phaseCount[1].c > phaseCount[1].s,
      JSON.stringify(phaseCount[1]));
check('C2 the retail explosion phase is rare, not universal',
      phaseCount[1].x === 17, `${phaseCount[1].x} of 244 explicit skills`);
check('C2 channeling exists and is rarer still', phaseCount[1].h === 3);
const fly = Object.entries(vfx.skill).filter(([, e]) => e.f);
check('C3 FlyingTime exists only on projectile skills', fly.length === 16,
      `${fly.length} skills, Wind Strike ${vfx.skill['1177'].f}s`);
// C4. In the RETAIL table an explosion never appears without a shot -- an
// impact with nothing launched would mean the phase arrays are misread.
const orphanRetail = Object.entries(vfx.skill).filter(([, e]) => e.b === 1 && e.x && !e.s);
check('C4 no retail explosion phase without a shot phase', orphanRetail.length === 0,
      orphanRetail.map(([s]) => s).join(','));
// C5. The heuristic layer does NOT hold that property, and the number is
// recorded rather than hidden: 42 of the 46 name-convention skills get an
// explosion phase and no shot phase at all, because the rule assigns a phase
// from the effect NAME's suffix. Those 42 fire their impact effect the instant
// skillLaunch arrives, with no travel. Flagged, not fixed -- the match rule
// lives in tools/dat/build_skillfx.py.
const orphanHeuristic = Object.entries(vfx.skill).filter(([, e]) => e.b === 2 && e.x && !e.s);
check('C5 the name-convention layer is the only source of orphan explosions',
      orphanHeuristic.length === 42,
      `${orphanHeuristic.length} of ${phaseCount[2].c + phaseCount[2].x} heuristic skills`);

console.log('\n-- D. skill SOUNDS are phases, not a random bank');

const soundById = new Map();
for (const r of sound) if (!soundById.has(r.skill_id)) soundById.set(r.skill_id, r);

// D1. The gain columns. SoundVolume is a ByteProperty in Engine.u; a "volume"
// above 255 means the volume and radius columns are swapped.
let maxVol = 0, maxRad = 0;
for (const r of sound) for (const g of ['spell', 'shot', 'exp']) {
  for (let i = 0; i < 3; i++) {
    maxVol = Math.max(maxVol, r[`${g}_vols`][i]);
    maxRad = Math.max(maxRad, r[`${g}_rads`][i]);
  }
}
check('D1 volume column is byte-legal (<=255)', maxVol <= 255, `max ${maxVol}`);
check('D1 radius column is a float radius (>255 somewhere)', maxRad > 255, `max ${maxRad}`);

// D2. Wind Strike's three slots, the anchor named in docs/skillfx-data.md.
const ws = soundById.get(1177);
check('D2 1177 slot 0 is the cast sound',
      ws.spell_sounds[0] === 'SkillSound.wind_strike_cast');
check('D2 1177 slot 1 is the shot sound',
      ws.spell_sounds[1] === 'SkillSound.wind_strike_shot');
check('D2 1177 slot 2 is the explosion sound',
      ws.spell_sounds[2] === 'SkillSound.wind_strike_explotion');
check('D2 1177 gains are (250,40) (250,40) (250,80)',
      JSON.stringify([ws.spell_vols, ws.spell_rads]) ===
      JSON.stringify([[250, 250, 250], [40, 40, 80]]),
      JSON.stringify([ws.spell_vols, ws.spell_rads]));

// D3. The slot -> phase reading, measured over the whole table rather than
// asserted from one row: slot 1 is overwhelmingly `_shot`, slot 2 `_explotion`.
const suffix = (s, re) => s && re.test(s.split('.').pop());
const s1 = sound.filter(r => r.spell_sounds[1]);
const s2 = sound.filter(r => r.spell_sounds[2]);
const s1shot = s1.filter(r => suffix(r.spell_sounds[1], /_shot$/)).length;
const s2exp = s2.filter(r => suffix(r.spell_sounds[2], /_explo(t|s)ion$/)).length;
check('D3 slot 1 is the shot slot', s1.length > 500 && s1shot / s1.length > 0.85,
      `${s1shot}/${s1.length}`);
check('D3 slot 2 is the explosion slot', s2.length > 50 && s2exp / s2.length > 0.7,
      `${s2exp}/${s2.length}`);

// D4. bindings.json -- what the browser actually downloads -- must carry the
// phases SEPARATELY, each with its own gain pair. THIS IS THE GATE THAT FAILS
// on the pre-fix tree, where skill 1177's `c` was one array of three name
// indices and there was no `s`/`x` at all.
const b1177 = bindings.skill['1177'];
check('D4 bindings 1177 has three separate phases',
      !!(b1177 && b1177.c && b1177.s && b1177.x), JSON.stringify(b1177));
check('D4 each phase is [nameIndex, volume, radius]',
      !!b1177 && ['c', 's', 'x'].every(k => Array.isArray(b1177[k]) && b1177[k].length === 3));
check('D4 the phases name the three retail sounds in order',
      !!b1177 && bindings.names[b1177.c[0]] === 'skillsound.wind_strike_cast' &&
      bindings.names[b1177.s[0]] === 'skillsound.wind_strike_shot' &&
      bindings.names[b1177.x[0]] === 'skillsound.wind_strike_explotion');
check('D4 the explosion carries its own radius 80, not the record default 50',
      !!b1177 && b1177.x[2] === 80 && b1177.c[2] === 40,
      b1177 && `cast r=${b1177.c[2]} exp r=${b1177.x[2]}`);
// D5. No skill may have its shot sound sitting in the cast slot.
const skillRecs = Object.values(bindings.skill);
const multi = skillRecs.filter(r => Array.isArray(r.c) && r.c.length !== 3);
check('D5 no skill has a multi-sound cast bank', multi.length === 0,
      `${multi.length} records`);
const withShot = skillRecs.filter(r => r.s).length;
const withExp = skillRecs.filter(r => r.x).length;
check('D5 the shot phase reaches the client for the skills that have one',
      withShot > 1000, `${withShot} of ${skillRecs.length} skills`);
check('D5 the explosion phase reaches the client', withExp > 100,
      `${withExp} skills`);

// ===========================================================================
// coverage report (a COUNT, per the brief)
// ===========================================================================

const meta = readJson(path.join(GAMEDATA, 'skillmeta.json'));
const totalSkills = Object.keys(meta).length;
let fullyDrawn = 0, partial = 0;
for (const e of Object.values(vfx.skill)) {
  const acts = actionsOf(e);
  const drawn = acts.filter(a => vfx.fx[a.f].e.length);
  if (drawn.length === acts.length) fullyDrawn++;
  else if (drawn.length) partial++;
}
const withCast = [...soundById.values()].filter(r => r.spell_sounds[0]).length;
const coverage = {
  skillsInClient: totalSkills,
  effect: {
    bound: Object.keys(vfx.skill).length,
    explicit: Object.values(vfx.skill).filter(e => e.b === 1).length,
    nameConvention: Object.values(vfx.skill).filter(e => e.b === 2).length,
    everyActionDrawable: fullyDrawn,
    someActionUndrawable: partial,
    noEffectAtAll: totalSkills - Object.keys(vfx.skill).length,
    emittersRendered: emitters.length,
    emittersDropped: vfx.fx.reduce(
      (n, f) => n + Object.values(f.skip || {}).reduce((a, b) => a + b, 0), 0),
  },
  sound: {
    rows: soundById.size,
    withCast: withCast,
    withShot: [...soundById.values()].filter(r => r.spell_sounds[1]).length,
    withExplosion: [...soundById.values()].filter(r => r.spell_sounds[2]).length,
    reachingClient: skillRecs.length,
    noSoundAtAll: totalSkills - skillRecs.length,
  },
};

// ===========================================================================
// browser gates (skipped under --check)
// ===========================================================================

async function browserGates() {
  const puppeteer = require(
    path.join(ROOT, 'tools/src/char_pipeline/node_modules/puppeteer-core'));
  const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const BASE = 'http://127.0.0.1:8083/?ws=ws://127.0.0.1:8085&cc=0';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1280,900'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 40000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      "window.__world.net.log.some(m => m.op === 'skillList')", { timeout: 25000 });
    await sleep(2500);
    await page.mouse.move(640, 450);
    for (let i = 0; i < 40; i++) { await page.mouse.wheel({ deltaY: -120 }); await sleep(12); }
    await sleep(500);

    console.log('\n-- E. the RENDERER honours the attach data');

    // E1. A LEFT-hand skill's cast effect must sit at the Weapon_L_Bone socket,
    // not at the actor's collision centre. Measured as a distance to each.
    const cast = async (id) => {
      await page.evaluate((sid) => {
        const w = window.__world;
        w.net.inject({ op: 'skillCast', skillId: sid, level: 1,
          casterId: w.net.selfId, targetId: w.net.selfId, hitTime: 2000, reuse: 0 });
      }, id);
      await sleep(400);
    };
    const clear = () => page.evaluate(async () =>
      (await import('/js/skills.js')).activeSkillFx().vfx.clear());

    await cast(92);                                   // Shield Stun -> LH
    const lh = await page.evaluate(async () => {
      const w = window.__world;
      const fx = (await import('/js/skills.js')).activeSkillFx();
      const THREE = await import('three');
      const bone = w.character.group.getObjectByName('Weapon_L_Bone');
      const bp = bone ? bone.getWorldPosition(new THREE.Vector3()) : null;
      const c = w.character.group.position;
      return fx.vfx.live.map(i => ({
        attach: i.attach, boneName: i.boneName, boneFound: !!i.bone,
        dBone: bp ? +i.group.position.distanceTo(bp).toFixed(4) : null,
        dCentre: +Math.hypot(i.group.position.x - c.x, i.group.position.z - c.z).toFixed(4),
      }));
    });
    await page.screenshot({ path: path.join(OUT, 'phase_92_lefthand.png') });
    check('E1 skill 92 cast effect carries EAM_LH', lh.some(i => i.attach === 2),
          JSON.stringify(lh));
    const attached = lh.filter(i => i.boneFound);
    check('E1 the Weapon_L_Bone socket resolved on the live character',
          attached.length > 0, JSON.stringify(lh));
    if (attached.length) {
      check('E1 the effect sits ON the bone, not at the actor centre',
            attached.every(i => i.dBone < 1e-3), JSON.stringify(attached));
    }
    await clear(); await sleep(150);

    // E2. An EAM_None effect must NOT follow its actor; an EAM_Trail one MUST.
    // The test needs a real second actor: casting at yourself makes the
    // projectile's start and end the same point, and the projectile is the one
    // EAM_None instance that legitimately moves (its anchor is the synthetic
    // flight point, not an actor).
    //
    // The skill has to be chosen from the table, not by intuition. Wind
    // Strike's own impact `el_wind_strike_ta` is EAM_Trail -- the retail burst
    // really does ride a running target -- so it proves nothing here. Of the
    // 19 explosion actions in the retail table only 6 are EAM_None, and Aqua
    // Swirl (1175, `el_aqua_swirl_ta`, offset (-1,0,0), bSpawnOnTarget) is one
    // of them. That per-action split is exactly what the port was blind to:
    // 13 impacts follow their target and 6 stay put.
    //
    // So: launch Aqua Swirl at an NPC, wait past FlyingTime 0.4 s so the
    // EAM_None impact instance exists, then teleport the target and require
    // the burst to stay where it detonated.
    const npc = await page.evaluate(() => {
      const ids = [...window.__world.entities.entities.keys()];
      return ids.length ? ids[0] : null;
    });
    check('E2 a target NPC exists (the gate is not vacuous)', npc != null);
    if (npc != null) {
      await page.evaluate((id) => {
        const w = window.__world;
        w.net.inject({ op: 'skillLaunch', skillId: 1175, level: 1,
          casterId: w.net.selfId, targetId: id });
      }, npc);
      await sleep(750);                       // past FlyingTime
      const drift = await page.evaluate(async (id) => {
        const w = window.__world;
        const fx = (await import('/js/skills.js')).activeSkillFx();
        const e = w.entities.getEntity(id);
        const before = fx.vfx.live.map(i => ({
          at: i.attach, follows: i.follows, travel: !!i.travel,
          p: i.group.position.clone() }));
        e.group.position.x += 25;             // teleport the TARGET
        await new Promise(r => setTimeout(r, 250));
        const after = fx.vfx.live.map(i => i.group.position.clone());
        e.group.position.x -= 25;
        return before.map((b, n) => ({ at: b.at, follows: b.follows,
          travel: b.travel,
          moved: after[n] ? +b.p.distanceTo(after[n]).toFixed(3) : null }));
      }, npc);
      await page.screenshot({ path: path.join(OUT, 'phase_1175_impact.png') });
      const burst = drift.filter(d => d.at === 0 && !d.travel);
      check('E2 the Aqua Swirl impact is an unattached EAM_None instance',
            burst.length > 0 && burst.every(d => d.follows === false),
            JSON.stringify(drift));
      check('E2 an EAM_None impact does not follow a teleporting target',
            burst.length > 0 && burst.every(d => d.moved === 0),
            JSON.stringify(burst));
      await clear(); await sleep(150);
    }

    // ...and the other side of the same rule: Heal's cast aura is EAM_Trail,
    // so it MUST track the caster. Without both halves this gate would pass on
    // a renderer that simply froze every effect.
    await cast(1011);
    const trail = await page.evaluate(async () => {
      const w = window.__world;
      const fx = (await import('/js/skills.js')).activeSkillFx();
      const before = fx.vfx.live.map(i => ({ at: i.attach, follows: i.follows,
        p: i.group.position.clone() }));
      w.character.group.position.x += 25;
      await new Promise(r => setTimeout(r, 250));
      const after = fx.vfx.live.map(i => i.group.position.clone());
      w.character.group.position.x -= 25;
      return before.map((b, n) => ({ at: b.at, follows: b.follows,
        moved: after[n] ? +b.p.distanceTo(after[n]).toFixed(2) : null }));
    });
    await page.screenshot({ path: path.join(OUT, 'phase_1011_trail.png') });
    const trailing = trail.filter(d => d.at === 5);
    check('E2 Heal spawns EAM_Trail instances', trailing.length > 0,
          JSON.stringify(trail));
    check('E2 an EAM_Trail effect DOES follow its caster',
          trailing.length > 0 && trailing.every(d => d.moved > 20),
          JSON.stringify(trailing));
    await clear(); await sleep(150);

    // E3. Provenance: everything drawn must be tagged from a decoded table.
    await cast(1177);
    const prov = await page.evaluate(() => {
      const seen = {};
      window.__world.scene.traverse(o => {
        const t = o.userData.skillFx;
        if (t) seen[t.source] = (seen[t.source] || 0) + 1;
      });
      return seen;
    });
    await page.screenshot({ path: path.join(OUT, 'phase_1177_cast.png') });
    check('E3 every drawn object is tagged skillvfx.json / skillmesh.json',
          Object.keys(prov).length > 0 &&
          Object.keys(prov).every(k => k === 'skillvfx.json' || k === 'skillmesh.json'),
          JSON.stringify(prov));
    await clear(); await sleep(150);

    // E4. The unbound skill draws nothing at all.
    await page.evaluate(() => {
      const w = window.__world;
      w.net.inject({ op: 'skillLaunch', skillId: 1216, level: 1,
        casterId: w.net.selfId, targetId: w.net.selfId });
    });
    await sleep(400);
    const unbound = await page.evaluate(async () => {
      const fx = (await import('/js/skills.js')).activeSkillFx();
      let tagged = 0;
      window.__world.scene.traverse(o => { if (o.userData.skillFx) tagged++; });
      return { live: fx.vfx.live.length, tagged };
    });
    await page.screenshot({ path: path.join(OUT, 'phase_1216_unbound.png') });
    check('E4 unbound skill 1216 draws nothing',
          unbound.live === 0 && unbound.tagged === 0, JSON.stringify(unbound));

    console.log('\n-- F. sound phases reach the audio engine');
    // The gateway mock does not carry audio, so this asserts the CLIENT side:
    // gameSound resolves three distinct phases with three distinct gain pairs.
    const snd = await page.evaluate(() => {
      const g = window.__world.gameSound;
      const r = g.skill['1177'];
      return { rec: r, cast: g.names[r.c[0]], shot: g.names[r.s[0]], exp: g.names[r.x[0]] };
    });
    check('F1 the client resolves three distinct sound phases for 1177',
          snd.cast !== snd.shot && snd.shot !== snd.exp, JSON.stringify(snd));
    check('F2 each phase carries its own radius',
          snd.rec.c[2] === 40 && snd.rec.x[2] === 80, JSON.stringify(snd.rec));

    check('G1 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
}

(async () => {
  if (!CHECK_ONLY) {
    try { await browserGates(); }
    catch (e) { check('browser gates ran', false, e.message); }
  }
  console.log('\ncoverage: ' + JSON.stringify(coverage, null, 2));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log('failures: ' + failures.join('; '));
  // A gate that evaluates zero assertions is a failure.
  if (pass < 25) { console.log('FAIL: too few assertions evaluated'); process.exit(1); }
  process.exit(fail ? 1 : 0);
})();
