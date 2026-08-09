// verify_skillclass — the skill CLASSIFICATION: what every skill is, who it
// may be cast on, and what the server refuses with when it may not.
//
//   node verify_skillclass.js --check     data + runtime API only (no browser)
//   node verify_skillclass.js             the above, plus a live browser leg
//                                         against the mock gateway on 8085
//
// What this asserts, and why each assertion can go RED:
//
//  A. The exported table (assets/gamedata/skillclass.json) covers every skill
//     id the client's own skillgrp.dat ships, and every value in aCis's
//     SkillTargetType enum is described.
//  B. ONE NAMED SKILL PER KIND and ONE PER TARGET SCOPE, checked by id AND by
//     the name out of skillname-e.dat, so a table that silently reshuffles
//     ids fails rather than passing on counts.
//  C. The NWindow.dll decode of UIDATA_SKILL::GetOperateType reproduces: the
//     retail tooltip line for a physical active, a passive, a magic skill and
//     a dance, resolved through the decoded sysstring table.
//  D. The refusal messages are the CLIENT's own systemmsg-e.dat text, and
//     SkillClass.checkTarget returns the right one for an illegal target.
//  E. The runtime module (js/skillclass.js) answers the same way the JSON
//     says it should — the API, not just the file.
//
//  F. THE LIVE ORACLE. gateway/test/capture-skills.json is a real recording
//     off the running aCis (2026-08-09): the SkillList packet's own `passive`
//     flag for 11 skills, and the MagicSkillUse hitTime/reuse for 8 casts.
//     Read offline so the gate is deterministic, but every number in it came
//     off the wire.
//
// Deliberately NOT asserted: that the client and the server agree on MP cost,
// cast time or range. They do not, for 179 / 46 / 27 skills respectively, and
// the exporter keeps BOTH readings (`mp` and `mpSv`). Asserting one would be
// picking a winner in a dispute the data has not settled.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');
const DATA = path.join(REPO, 'assets/gamedata/skillclass.json');
const CHECK = process.argv.includes('--check');

const ok = [];
const bad = [];
function want(cond, msg) { (cond ? ok : bad).push(msg); }

// ---------------------------------------------------------------------------
// A. the table exists and is complete
if (!fs.existsSync(DATA)) {
  console.log('  FAIL assets/gamedata/skillclass.json is missing — run '
    + 'tools/dat/export_skillclass.py');
  console.log('VERIFY skillclass: FAIL');
  process.exit(1);
}
const doc = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const S = doc.skills;
const ids = Object.keys(S);

const grpIds = new Set();
{
  // skillgrp.json is 11 MB; stream out just the ids rather than JSON.parse it
  const raw = fs.readFileSync(path.join(REPO, 'assets/gamedata/skillgrp.json'), 'utf8');
  const re = /"skill_id"\s*:\s*(\d+)/g;
  let m;
  while ((m = re.exec(raw)) !== null) grpIds.add(m[1]);
}
want(grpIds.size >= 2694, `skillgrp.dat ships ${grpIds.size} distinct skill ids`);
const uncovered = [...grpIds].filter(i => !S[i]);
want(uncovered.length === 0,
  `every skillgrp id is in the table (${uncovered.length} uncovered)`);

const enumFile = path.join(REPO,
  'server/aCis_gameserver/java/net/sf/l2j/gameserver/enums/skills/SkillTargetType.java');
const enumVals = fs.readFileSync(enumFile, 'utf8').split('\n')
  .map(l => l.trim().replace(/,$/, ''))
  .filter(l => /^[A-Z][A-Z_0-9]*$/.test(l));
want(enumVals.length === 28, `SkillTargetType has ${enumVals.length} values`);
const missingT = enumVals.filter(v => !doc.targetTypes[v]);
want(missingT.length === 0,
  `every SkillTargetType is described (${missingT.length} missing)`);

// ---------------------------------------------------------------------------
// B. one named skill per kind, one per target scope.
//
// Each row is (id, expected name, expected kind, expected target). The name
// is the check that keeps this honest: it comes from skillname-e.dat via the
// exporter's `nm` field, so a table built from the wrong join fails here.
const KIND_CASES = [
  [3,    'Power Strike',      'attack',    'ONE'],
  [1177, 'Wind Strike',       'attack',    'ONE'],
  [1015, 'Battle Heal',       'heal',      'ONE'],
  [45,   'Divine Heal',       'heal',      'SELF'],
  [4,    'Dash',              'buff',      'SELF'],
  [264,  'Song of Earth',     'buff',      'PARTY'],
  [2,    'Confusion',         'debuff',    'ONE'],
  [18,   'Aura of Hate',      'debuff',    'AURA'],
  [1016, 'Resurrection',      'resurrect', 'CORPSE_PLAYER'],
  [1254, 'Mass Resurrection', 'resurrect', 'CORPSE_ALLY'],
  [10,   'Summon Storm Cubic','summon',    'SELF'],
  [21,   'Poison Recovery',   'dispel',    'SELF'],
  [60,   'Fake Death',        'toggle',    'SELF'],
  [226,  'Relax',             'toggle',    'SELF'],
  [113,  'Long Shot',         'passive',   'SELF'],
  [27,   'Unlock',            'utility',   'UNLOCKABLE'],
  [1321, 'Dwarven Craft',     'utility',   'SELF'],
  [1312, 'Fishing',           'utility',   'SELF'],
  [1320, 'Create Common Item','passive',   'SELF'],
  [1419, 'Volcano',           'attack',    'GROUND'],
];
for (const [id, name, kind, target] of KIND_CASES) {
  const e = S[String(id)];
  if (!e) { bad.push(`skill ${id} (${name}) is absent from the table`); continue; }
  want(e.nm === name, `${id} is named "${e.nm}" (expected "${name}")`);
  want(e.k === kind, `${id} ${name}: kind ${e.k} (expected ${kind})`);
  want(e.t === target, `${id} ${name}: target ${e.t} (expected ${target})`);
}
// every kind the exporter declares is actually populated
for (const kind of Object.keys(doc.kinds)) {
  const n = ids.filter(i => S[i].k === kind).length;
  want(n > 0, `kind ${kind}: ${n} skills`);
}

// one skill per TARGET SCOPE, so the scope table is exercised and not just
// declared. Scope comes from the handler classes, not from the target name.
const SCOPE_CASES = [
  ['self',         4,    'Dash'],
  ['single',       3,    'Power Strike'],
  ['party',        264,  'Song of Earth'],
  ['alliance',     1003, "Pa'agrian Gift"],
  ['clan',         4030, 'NPC Clan Might'],
  ['area_self',    36,   'Whirlwind'],
  ['area_target',  7,    'Sonic Storm'],
  ['area_summon',  1382, 'Mass Gloom'],
  ['corpse',       42,   'Sweeper'],
  ['ground',       1419, 'Volcano'],
  ['summon',       1127, 'Servitor Heal'],
  ['owner',        5186, 'Pet Haste'],
  ['none',         390,  'Clan Luck'],
];
const scopesSeen = new Set();
for (const [scope, id, name] of SCOPE_CASES) {
  const e = S[String(id)];
  if (!e || !e.t) { bad.push(`scope case ${id} (${name}) missing from table`); continue; }
  const t = doc.targetTypes[e.t];
  want(e.nm === name, `scope case ${id} is named "${e.nm}" (expected "${name}")`);
  want(t && t.scope === scope,
    `${id} ${name}: target ${e.t} has scope ${t && t.scope} (expected ${scope})`);
  scopesSeen.add(scope);
}
const allScopes = new Set(Object.values(doc.targetTypes).map(t => t.scope));
const unexercised = [...allScopes].filter(s => !scopesSeen.has(s));
want(unexercised.length === 0,
  `${scopesSeen.size}/${allScopes.size} target scopes exercised `
  + `(unexercised: ${unexercised.join(',') || 'none'})`);

// the three unhandled target types must be flagged, not smoothed over
for (const t of ['NONE', 'CORPSE', 'ENEMY_SUMMON']) {
  want(doc.targetTypes[t] && doc.targetTypes[t].handled === false,
    `${t} is marked unhandled (no handler class on the server)`);
}
const uncastable = ids.filter(i => S[i].t && !doc.targetTypes[S[i].t].handled);
want(uncastable.length === 51,
  `${uncastable.length} shipped skills are uncastable for want of a handler`);

// KIND-WEAK: aCis calls these offensive but files them in no labelled combat
// section, so the 'debuff' bucket they land in is a fallback, not a decode.
// The flag must be present and must cover exactly the measured residue.
const weak = ids.filter(i => S[i].kw).map(Number).sort((a, b) => a - b);
want(weak.length === 9,
  `${weak.length} skills carry the kind-weak flag (expected 9: SWEEP, SPOIL, `
  + `BEAST_FEED, BETRAY, ERASE + one BUFF)`);
want(S['42'] && S['42'].kw === 1 && S['42'].k === 'debuff',
  `42 Sweeper falls through to '${S['42'] && S['42'].k}' and IS flagged kind-weak`);
want(ids.filter(i => S[i].k === 'debuff' && !S[i].kw).length > 300,
  'the great majority of the debuff bucket is NOT weak');

// ---------------------------------------------------------------------------
// C. the NWindow.dll GetOperateType decode
const DISPLAY_CASES = [
  [3,    311,  'Active Skill'],   // is_magic 0, operate_type 0
  [239,  312,  'Passive Skill'],  // operate_type 2
  [1177, 313,  'Magic'],          // is_magic 1
  [264,  1500, 'Song/Dance'],     // is_magic 3
];
for (const [id, sysId, text] of DISPLAY_CASES) {
  const e = S[String(id)];
  want(e && e.d === sysId, `${id} ${e && e.nm}: tooltip line is SysString ${e && e.d} (expected ${sysId})`);
  want(doc.operateDisplay[String(sysId)] === text,
    `SysString ${sysId} resolves to "${doc.operateDisplay[String(sysId)]}" (expected "${text}")`);
}
// the decode is a BRANCH, so assert the branch: every id whose tooltip says
// 'Passive Skill' must be one aCis independently calls PASSIVE.
const passiveIds = ids.filter(i => S[i].d === 312);
want(passiveIds.length > 700, `${passiveIds.length} ids print 'Passive Skill'`);
// A DISAGREEMENT, recorded rather than asserted away: exactly three ids
// print 'Passive Skill' while aCis calls them ACTIVE — 4271 Increase Force,
// 4381 Magic Skill Block, 5041 Charm of Courage (all skillgrp operate_type 2,
// all aCis skillType BUFF target SELF). The gate pins the SET so a fourth one
// appearing, or one of these changing, goes red.
const notPassive = passiveIds.filter(i => S[i].sv && S[i].sv !== 'PASSIVE')
  .map(Number).sort((a, b) => a - b);
want(JSON.stringify(notPassive) === JSON.stringify([4271, 4381, 5041]),
  `client says Passive / aCis says ACTIVE for exactly [4271,4381,5041] `
  + `(got [${notPassive}])`);
// and the inverse: nothing aCis calls PASSIVE prints 'Active Skill'
const acisPassive = ids.filter(i => S[i].sv === 'PASSIVE');
const printsActive = acisPassive.filter(i => S[i].d === 311);
// The mirror disagreement: 55 ids aCis calls PASSIVE carry a client
// operate_type of 0 or 1, so the retail tooltip would print 'Active Skill'.
// 53 of them are the 3080+ "Item Skill: ..." block. Pinned by count.
want(acisPassive.length > 700 && printsActive.length === 55,
  `${printsActive.length}/${acisPassive.length} aCis-PASSIVE skills print `
  + `'Active Skill' (expected exactly 55)`);
// song/dance is exactly the dance set
const danceIds = ids.filter(i => S[i].d === 1500);
want(danceIds.length === 29, `${danceIds.length} ids print 'Song/Dance'`);

// ---------------------------------------------------------------------------
// D. refusal messages are the client's own text
const MSG_CASES = [
  [109, 'Invalid target.'],
  [51,  'You cannot use this on yourself.'],
  [84,  'You may not attack in a peaceful zone.'],
  [113, '$s1 cannot be used due to unsuitable terms.'],
  [181, 'Cannot see target.'],
  [1247, 'The corpse is too old. The skill cannot be used.'],
];
for (const [id, text] of MSG_CASES) {
  want(doc.msgs[String(id)] === text,
    `msg ${id} = "${doc.msgs[String(id)]}" (expected "${text}")`);
}
// the UNDECODED list must be present and honest: an empty one would mean the
// exporter is claiming it decoded everything.
want(Array.isArray(doc.undecoded) && doc.undecoded.length >= 8,
  `${(doc.undecoded || []).length} fields are declared undecoded`);
want((doc.undecoded || []).every(u => u.field && u.measured && u.missing),
  'every undecoded entry states what WAS measured and what is missing');
want((doc.undecoded || []).some(u => u.field.includes('cast_style'))
  && (doc.undecoded || []).some(u => u.field.includes('operate_type 0 vs 1')),
  'cast_style and the operate_type 0/1 split are both declared undecoded');
want(Object.values(doc.msgs).every(v => typeof v === 'string' && v.length > 0),
  `all ${Object.keys(doc.msgs).length} refusal messages resolve to real text`);
// TargetOne is the handler that carries the peace-zone refusals; assert they
// are attached to it and not to, say, SELF.
want(doc.targetTypes.ONE.refusals.some(r => r.msg === 84)
  && doc.targetTypes.ONE.refusals.some(r => r.msg === 85),
  'TargetOne carries both peace-zone refusals (84 + 85)');
want(doc.targetTypes.SELF.refusals.length === 0,
  'TargetSelf refuses nothing (meetCastConditions returns true)');
want(doc.targetTypes.PARTY_OTHER.refusals.some(r => r.msg === 51),
  'TargetPartyOther is the one that answers 51 CANNOT_USE_ON_YOURSELF');

// ---------------------------------------------------------------------------
// E. the runtime module answers the same way
(async () => {
  const mod = await import('./js/skillclass.js');
  mod.setSkillClassData(doc);
  const SC = mod.SkillClass;

  want(SC.kind(1015) === 'heal', `SkillClass.kind(1015) = ${SC.kind(1015)}`);
  want(SC.target(1015) === 'ONE', `SkillClass.target(1015) = ${SC.target(1015)}`);
  want(SC.isOffensive(3) === true, 'SkillClass.isOffensive(3 Power Strike) is true');
  want(SC.isOffensive(1015) === false, 'SkillClass.isOffensive(1015 Battle Heal) is false');
  want(SC.displayType(264) === 'Song/Dance',
    `SkillClass.displayType(264) = ${SC.displayType(264)}`);
  want(SC.needsTarget(3) === true, 'ONE needs a target');
  want(SC.needsTarget(4) === false, 'SELF (4 Dash) does not need a target');

  // per-level numbers: Power Strike's MP ladder is 10 10 11 13 13 14 17 18 19
  want(SC.num(3, 'mp', 1) === 10 && SC.num(3, 'mp', 9) === 19,
    `SkillClass.num(3,'mp') level1=${SC.num(3, 'mp', 1)} level9=${SC.num(3, 'mp', 9)}`);
  want(SC.num(3, 'range', 1) === 40, `Power Strike range = ${SC.num(3, 'range', 1)}`);
  want(SC.num(3, 'reuse', 1) === 13000, `Power Strike reuse = ${SC.num(3, 'reuse', 1)}`);
  want(SC.num(3, 'cast', 1) === 1080, `Power Strike cast = ${SC.num(3, 'cast', 1)}`);
  // a level-scaling check that would break if collapse() flattened arrays
  want(Array.isArray(S['3'].n.mp) && S['3'].n.mp.length === 9,
    'level scaling survives as an array where it varies');
  want(!Array.isArray(S['3'].n.range),
    'a constant is stored as a scalar, not a 9-long array');

  // checkTarget: the refusal, with the real message
  const r1 = SC.checkTarget(3, 'self');       // offensive ONE on yourself
  want(r1 && r1.ok === false && r1.msg === 109 && r1.text === 'Invalid target.',
    `offensive ONE on self -> ${JSON.stringify(r1)}`);
  const r2 = SC.checkTarget(3, 'monster');
  want(r2 && r2.ok === true, 'offensive ONE on a monster is allowed');
  const r3 = SC.checkTarget(1015, 'monster'); // beneficial ONE on a monster
  want(r3 && r3.ok === false && r3.msg === 109,
    `beneficial ONE on a monster -> ${JSON.stringify(r3)}`);
  const r4 = SC.checkTarget(1015, 'player');
  want(r4 && r4.ok === true, 'beneficial ONE on a player is allowed');
  const r5 = SC.checkTarget(3, null);         // nothing targeted
  want(r5 && r5.ok === false && r5.msg === 109,
    'a ONE skill with nothing targeted is refused 109');
  const r6 = SC.checkTarget(4, null);        // Dash, target SELF
  want(r6 && r6.ok === true, 'a SELF skill (4 Dash) needs no target');
  const uncast = uncastable[0];
  const r7 = SC.checkTarget(uncast, 'monster');
  want(r7 && r7.ok === false,
    `unhandled-target skill ${uncast} (${S[uncast].nm}) is refused`);

  want(SC.refusals(3).length >= 3
    && SC.refusals(3).every(r => r.text && r.when),
    `SkillClass.refusals(3) returns ${SC.refusals(3).length} messages, all with text`);

  // ---- F. the live oracle ------------------------------------------------
  const capPath = path.join(REPO, 'gateway/test/capture-skills.json');
  if (!fs.existsSync(capPath)) {
    bad.push('gateway/test/capture-skills.json is missing — the live oracle '
      + 'leg cannot run, and a gate that skips its evidence is not a gate');
  } else {
    const cap = JSON.parse(fs.readFileSync(capPath, 'utf8'));
    want(cap.skillList.length >= 11,
      `live capture carries ${cap.skillList.length} SkillList entries`);
    // 1. the packet's own passive boolean vs the NWindow operate_type decode
    let agree = 0;
    for (const e of cap.skillList) {
      const t = S[String(e.id)];
      if (!t) { bad.push(`live skill ${e.id} is not in the table`); continue; }
      const weSayPassive = t.d === 312;          // 'Passive Skill'
      if (weSayPassive === e.passive) agree++;
      else {
        bad.push(`live SkillList says passive=${e.passive} for ${e.id} `
          + `${t.nm}, the operate_type decode says ${weSayPassive}`);
      }
    }
    want(agree === cap.skillList.length,
      `${agree}/${cap.skillList.length} live passive flags match the `
      + `skillgrp operate_type decode`);

    // 2. hitTime/reuse are BASE values scaled by attack speed:
    //    Formulas.calcAtkSpd -> time * 333 / (m)AtkSpd. Recover the speed
    //    from each cast and require every skill of the same kind to agree on
    //    it -- a table whose base times were wrong could not do that.
    const speeds = { phys: new Set(), magic: new Set() };
    let casts = 0;
    for (const tl of cap.timelines) {
      const ev = tl.events.find(e => e.op === 'skillCast');
      if (!ev || !ev.hitTime) continue;              // toggles arrive at 0
      const t = S[String(ev.skillId)];
      const base = Array.isArray(t.n.cast) ? t.n.cast[0] : t.n.cast;
      if (!base) { bad.push(`no base cast time for ${ev.skillId} ${t.nm}`); continue; }
      casts++;
      const speed = Math.round(base * 333 / ev.hitTime);
      speeds[t.mg === 1 || t.mg === 3 ? 'magic' : 'phys'].add(speed);
      // and the recovered speed must reproduce the packet exactly
      want(Math.trunc(base * 333 / speed) === ev.hitTime,
        `${ev.skillId} ${t.nm}: base ${base} * 333 / ${speed} = `
        + `${Math.trunc(base * 333 / speed)} == live hitTime ${ev.hitTime}`);
    }
    want(casts >= 6, `${casts} live casts carried a hitTime`);
    want(speeds.phys.size === 1,
      `every physical cast implies ONE pAtkSpd (${[...speeds.phys]})`);
    want(speeds.magic.size === 1,
      `every magic cast implies ONE mAtkSpd (${[...speeds.magic]})`);
    // the physical speed must be the one the charSheet actually reported
    const sheet = [].concat(...cap.toggleUses)
      .find(e => e.op === 'charSheet' && e.pAtkSpd);
    want(sheet && speeds.phys.has(sheet.pAtkSpd),
      `the recovered pAtkSpd ${[...speeds.phys]} is the charSheet's own `
      + `pAtkSpd ${sheet && sheet.pAtkSpd}`);

    // 3. the MP join. Wind Strike level 1 is skillgrp 9 and aCis
    //    mpInitialConsume 2 + mpConsume 7. The table must carry 9 (what the
    //    retail tooltip prints) and must NOT be flagged as a disagreement.
    const ws = S['1177'];
    want((Array.isArray(ws.n.mp) ? ws.n.mp[0] : ws.n.mp) === 9,
      `1177 Wind Strike tooltip MP = ${Array.isArray(ws.n.mp) ? ws.n.mp[0] : ws.n.mp} (expected 9)`);
    want(ws.n.mpSv === undefined,
      '1177 is NOT recorded as an MP disagreement — the client column is the '
      + 'sum of mpInitialConsume + mpConsume, not mpConsume alone');
    want((Array.isArray(ws.n.mpInit) ? ws.n.mpInit[0] : ws.n.mpInit) === 2,
      'the initial-consume half of that sum is carried separately');
  }

  // ---- browser leg (skipped under --check) ------------------------------
  let browserRan = false;
  if (!CHECK) {
    browserRan = await browserLeg();
  }

  // ---- report ------------------------------------------------------------
  for (const m of ok) console.log(`  ok    ${m}`);
  for (const m of bad) console.log(`  FAIL  ${m}`);
  console.log(`assertions ${ok.length} pass / ${bad.length} fail`
    + (browserRan ? ' (incl. browser leg)' : ''));
  // A gate that evaluates zero assertions is a failure, not a pass.
  if (ok.length + bad.length < 60) {
    console.log('  FAIL  too few assertions ran — the gate is vacuous');
    bad.push('vacuous');
  }
  console.log(bad.length ? 'VERIFY skillclass: FAIL' : 'VERIFY skillclass: PASS');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => {
  console.log('  FAIL  ' + e.stack);
  console.log('VERIFY skillclass: FAIL');
  process.exit(1);
});

// ---------------------------------------------------------------------------
/** Boot the real client against the mock gateway and read the classification
 *  off the skill window's own cells. Proves the WIRING, not just the file. */
async function browserLeg() {
  let puppeteer;
  try {
    puppeteer = require(
      '/Users/alejandroberacasa/l2vzla/tools/src/char_pipeline/node_modules/puppeteer-core');
  } catch (e) {
    bad.push('puppeteer-core not available for the browser leg');
    return false;
  }
  const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const PORT = process.env.MOCK_PORT || '8085';
  const BASE = `http://127.0.0.1:8083/?ws=ws://127.0.0.1:${PORT}&cc=0`;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--headless=new', '--use-angle=swiftshader', '--window-size=1400,900'],
  });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('l2vzla.deviceId', 'verify-skillclass-fixed-device');
    });
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__world && window.__world.ready', { timeout: 45000 });
    await page.click('#online-toggle');
    await page.waitForFunction(
      'window.__world.skillWnd && window.__world.skillWnd.skills.length > 0',
      { timeout: 60000 });
    await new Promise(r => setTimeout(r, 1200));

    const d = await page.evaluate(() => {
      const w = window.__world.skillWnd;
      w.show();
      const cells = [...w.root.querySelectorAll('.l2-skill-cell[data-skill-id]')];
      return {
        cells: cells.length,
        withKind: cells.filter(c => c.dataset.skillKind).length,
        withTarget: cells.filter(c => c.dataset.skillTarget).length,
        kinds: [...new Set(cells.map(c => c.dataset.skillKind))].filter(Boolean),
        sampleTitle: cells.length ? cells[0].title : '',
        titleLines: cells.length ? cells[0].title.split('\n').length : 0,
      };
    });
    want(d.cells > 0, `browser: ${d.cells} skill cells rendered`);
    want(d.withKind === d.cells,
      `browser: ${d.withKind}/${d.cells} cells carry a decoded kind`);
    want(d.withTarget === d.cells,
      `browser: ${d.withTarget}/${d.cells} cells carry a decoded target type`);
    want(d.kinds.length >= 2,
      `browser: ${d.kinds.length} distinct kinds on screen (${d.kinds.join(',')})`);
    want(d.titleLines >= 3,
      `browser: the retail tooltip renders ${d.titleLines} lines`);
    return true;
  } catch (e) {
    bad.push('browser leg: ' + e.message);
    return false;
  } finally {
    await browser.close();
  }
}
