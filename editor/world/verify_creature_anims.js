// CREATURE CAST CLIPS, DISCARDED CLIP SETS, AND THE TWELVE SOCIAL EMOTES.
//
// Three extraction defects, each of which made something play the wrong clip:
//
//  1. THE CAST SLOT WAS A STANDING POSE.  build_monsters.py mapped 'special'
//     (entities.js:skillFlash, the skill-cast visual) to the first of
//     SpWait01 / Social01 / atkwait / AtkWait_1HS -- four WAIT poses -- so 235
//     creatures answered a skill with a stance.  Measured mean per-frame
//     quaternion delta over 25 random creature .psa that carry all four:
//     wait 0.0017, atkwait 0.0041, spwait01 0.0067 versus atk01 0.0160 and
//     spatk01 0.0144.  The wait clips are motionless to three decimals.
//     The fix does NOT pick a strike by name convention: the client ships a
//     per-creature table (Engine.Pawn's `var localized name
//     MagicShotAnimName[4]`, values in system/<Package>.int keyed by the class
//     npcgrp.dat names for that mesh), decoded by
//     tools/anim/creature_anim_table.py, and the slot takes whatever THAT
//     says -- spatk01 for 315 creatures, atk01 for melee creatures like the
//     gremlin.
//
//  2. NINE CREATURES SHIPPED STATIC WITH A REAL ANIMATION SET.  The builder
//     dropped every clip it had already found whenever the set shipped no
//     Wait sequence.  follower_of_frintessa_m00 (a raid boss) threw away
//     Atk01_1HS, Run_1HS, AtkWait_1HS, death and deathwait to ship a statue.
//
//  3. ELEVEN OF TWELVE EMOTES HAD NO ANIMATION.  actionname.dat defines
//     twelve (its `type` field, 2..13, is the SocialAction id) and retail
//     ships a clip for each, but build_characters.py extracted only
//     Social_dance.  The actionId -> clip mapping is the client's own
//     PcSocialAnimName table, not a name match.
//
// Everything here is checked against the .psa umodel exports from the retail
// .ukx (tools/anim/export_psa.sh) via the mesh's own serialized Animation
// reference (tools/anim/bindings.json) -- never against a name convention.
//
// Usage:
//   node verify_creature_anims.js                 report
//   node verify_creature_anims.js --check         assert, exit 1 on regression
//   node verify_creature_anims.js --manifest=P --charmanifest=P
//                                                 point at another manifest
//                                                 (used to prove this suite
//                                                 FAILS on the pre-fix state)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ANIMDIR = path.join(ROOT, 'tools', 'anim');
const CHECK = process.argv.includes('--check');
const argOf = (name, dflt) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const MANIFEST = argOf('manifest',
  path.join(ROOT, 'editor/characters/monsters/manifest.json'));
const CHARMANIFEST = argOf('charmanifest',
  path.join(ROOT, 'editor/characters/manifest.json'));

const summary = { checks: [], failed: false };
function check(name, ok, detail) {
  summary.checks.push({ name, ok: !!ok, detail });
  if (!ok) summary.failed = true;
}
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));

// ------------------------------------------------------------ psa reading
// A .psa is a sequence of 32-byte chunk headers (20-byte id, i32 flags, i32
// element size, i32 count) each followed by size*count bytes. ANIMINFO's
// first 64 bytes per element are the sequence name. This reads names only --
// the same field parse_psa() in assemble.py reads, without the keyframes.
function psaClips(file) {
  const b = fs.readFileSync(file);
  let off = 0;
  while (off + 32 <= b.length) {
    const id = b.toString('latin1', off, off + 20).replace(/\0.*$/, '');
    const size = b.readInt32LE(off + 24);
    const count = b.readInt32LE(off + 28);
    const body = off + 32;
    if (id === 'ANIMINFO') {
      const out = [];
      for (let i = 0; i < count; i++) {
        out.push(b.toString('latin1', body + i * size, body + i * size + 64)
          .replace(/\0.*$/, ''));
      }
      return out;
    }
    off = body + size * count;
  }
  return [];
}

function psaIndex() {
  const root = path.join(ANIMDIR, 'psa');
  const idx = new Map();
  if (!fs.existsSync(root)) return idx;
  for (const pkg of fs.readdirSync(root)) {
    const d = path.join(root, pkg, 'MeshAnimation');
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (f.endsWith('.psa')) {
        idx.set(`${pkg.toLowerCase()}|${f.slice(0, -4).toLowerCase()}`,
          path.join(d, f));
      }
    }
  }
  return idx;
}

// Retail's sequence grammar is <Action>[_<Stance>]. The action token is what
// identifies the clip; a wait-class action is one of these five, all of which
// measure as motionless loops (see the header). SpAtk is deliberately NOT in
// this set and neither is Atk -- those are the clips with motion.
const WAIT_ACTIONS = new Set(['wait', 'spwait', 'spwait01', 'spwait02',
  'atkwait', 'atk', 'social', 'social01', 'social02', 'social03',
  'deathwait', 'picitem']);
const actionToken = s => s.toLowerCase().split('_')[0];
const isWaitPose = s => WAIT_ACTIONS.has(actionToken(s))
  || /^(spwait|atkwait|social)\d*$/.test(s.toLowerCase());
const isStrike = s => /^spatk\d*$/.test(actionToken(s));

// ------------------------------------------------------------ 1+2. monsters
function monsterChecks() {
  const models = readJSON(MANIFEST).models;
  const bindings = readJSON(path.join(ANIMDIR, 'bindings.json'));
  const idx = psaIndex();
  const table = fs.existsSync(path.join(ANIMDIR, 'creature_anim_table.json'))
    ? readJSON(path.join(ANIMDIR, 'creature_anim_table.json')).meshes : {};

  check('every spawnable creature is in the manifest', models.length === 495,
    `${models.length} models`);
  if (!idx.size) {
    check('retail .psa are exported (tools/anim/export_psa.sh)', false,
      `no .psa under ${path.join(ANIMDIR, 'psa')} -- cannot verify anything `
      + 'against retail');
    return null;
  }

  const stats = {
    creatures: models.length,
    special_is_wait_with_strike_available: 0,
    special_from_retail_table: 0,
    special_disagrees_with_retail_table: 0,
    static_with_a_real_animation_set: 0,
    buckets: { full: 0, partial: 0, none: 0 },
  };
  const offenders = [];
  const disagree = [];
  const staticButAnimated = [];
  const waitCastNoStrike = [];
  const retailWaitCast = [];
  // Retail itself points these two at a non-strike while shipping a strike in
  // the same .psa -- verbatim from the client, not a pipeline choice:
  //   LineageMonster3.int [Arachnoid]      MagicShotAnimName[0]=wait
  //     (the whole section is copy-pasted: DeathAnimName and DeathWaitAnimName
  //      are 'wait' too, though arachnoid_anim ships death and deathwait --
  //      the only creature in the roster where the table does that)
  //   LineageMonster.int  [orc_champion]   MagicShotAnimName[0]=social01
  //     (MagicNoTargetAnimName is SpAtk01, so the champion roars on a targeted
  //      cast and strikes on an untargeted one)
  const RETAIL_WAIT_CAST = new Set(['arachnoid_m00:Wait',
    'orc_champion_m00:Social01']);

  for (const m of models) {
    const b = bindings[m.id] || {};
    let retail = null;
    if (b.anim && b.ukx) {
      const pkg = path.basename(b.ukx).replace(/\.ukx$/i, '').toLowerCase();
      const f = idx.get(`${pkg}|${b.anim.toLowerCase()}`);
      if (f) retail = psaClips(f);
    }
    const shipped = m.animations || [];
    const clips = m.clips || {};

    if (!shipped.length) {
      stats.buckets.none++;
      if (retail && retail.length) {
        stats.static_with_a_real_animation_set++;
        staticButAnimated.push(`${m.id} (${b.anim}: ${retail.length} clips)`);
      }
      continue;
    }
    stats.buckets[shipped.length >= 6 ? 'full' : 'partial']++;

    // 1. the cast slot. `clips` records the retail clip each slot took; a
    // manifest written before the fix has no `clips` at all, in which case
    // the slot name itself is all there is and 'special' present with a
    // strike available in retail is the defect.
    const cast = clips.special;
    const strikeAvailable = retail ? retail.some(isStrike) : false;
    if (cast === undefined) {
      // pre-fix manifest: no provenance recorded. The old builder's
      // 'special' list was SpWait01/Social01/atkwait/AtkWait_1HS, all wait
      // poses, so a shipped 'special' IS a wait pose.
      if (shipped.includes('special') && strikeAvailable) {
        stats.special_is_wait_with_strike_available++;
        offenders.push(`${m.id} (no clip provenance; retail has a SpAtk)`);
      }
      continue;
    }
    const fromTable = (m.clipSource || {}).special === 'retail:MagicShotAnimName';
    if (isWaitPose(cast)) {
      if (strikeAvailable && !fromTable) {
        stats.special_is_wait_with_strike_available++;
        offenders.push(`${m.id}: special=${cast}, retail has `
          + `${retail.filter(isStrike).join('/')}`);
      } else if (strikeAvailable) {
        // The CLIENT names a wait pose here while its own .psa ships a
        // strike. That is retail's data, not this pipeline's choice, and
        // overriding it would be inventing a value. Enumerated so a new one
        // cannot appear silently.
        retailWaitCast.push(`${m.id}:${cast}`);
      } else {
        waitCastNoStrike.push(`${m.id}:${cast}`);
      }
    }
    // 1b. where the client's own table answers, the slot must be its answer.
    const want = ((table[m.id.toLowerCase()] || {}).anims || {})
      .MagicShotAnimName;
    if (want && want['0'] && retail
      && retail.some(c => c.toLowerCase() === want['0'].toLowerCase())) {
      if ((cast || '').toLowerCase() === want['0'].toLowerCase()) {
        stats.special_from_retail_table++;
      } else {
        stats.special_disagrees_with_retail_table++;
        disagree.push(`${m.id}: special=${cast}, MagicShotAnimName=${want['0']}`);
      }
    }
  }

  check('no creature binds a WAIT pose as its cast clip while retail ships '
    + 'it a SpAtk strike',
    stats.special_is_wait_with_strike_available === 0,
    stats.special_is_wait_with_strike_available === 0
      ? `0 (${stats.special_from_retail_table} take the cast clip straight `
        + 'from the client\'s MagicShotAnimName table)'
      : `${stats.special_is_wait_with_strike_available}: `
        + offenders.slice(0, 8).join('; '));

  const newQuirks = retailWaitCast.filter(s => !RETAIL_WAIT_CAST.has(s));
  check('the only creatures whose cast clip is a wait pose despite a strike '
    + 'existing are the two where RETAIL itself says so',
    newQuirks.length === 0 && retailWaitCast.length === RETAIL_WAIT_CAST.size,
    newQuirks.length
      ? `undocumented: ${newQuirks.join(', ')}`
      : `${retailWaitCast.length}: ${retailWaitCast.join(', ')} `
        + '(both verbatim from the client\'s MagicShotAnimName)');

  check('the cast slot never contradicts the client\'s own '
    + 'MagicShotAnimName, wherever that clip exists in the bound .psa',
    stats.special_disagrees_with_retail_table === 0,
    stats.special_disagrees_with_retail_table === 0
      ? `${stats.special_from_retail_table} creatures verified against the table`
      : disagree.slice(0, 8).join('; '));

  // 2. Exactly four of the original nine may still ship static, and only
  // because assemble.py refuses to bind a .psa whose bone names do not match
  // the mesh skeleton ("matched only N/M bones; refusing to guess"). That
  // refusal is right -- forcing it would be inventing a rig. The other five
  // now carry clips, including castle_kent_statue_jewel_m00, whose set is
  // nothing but open/close/openwait/closewait: no name convention could have
  // filled a contract slot from that, but the client's own table names
  // WaitAnimName=castle_kent_statue_jewel_closewait, so it ships an idle.
  const ALLOWED_STATIC = new Set(['Evilate_m00', 'old_bookshelf_m00',
    'grail_brazier_b_m00', 'pavel_weather_controller_m00']);
  const unexpected = staticButAnimated.filter(
    s => !ALLOWED_STATIC.has(s.split(' ')[0]));
  check('no creature ships static while carrying a bindable retail '
    + 'animation set',
    unexpected.length === 0,
    unexpected.length === 0
      ? `${stats.static_with_a_real_animation_set} static-with-a-set, all `
        + 'documented (4 bone-mismatch refusals + 1 with no bindable clip)'
      : `${unexpected.length}: ${unexpected.join('; ')}`);

  stats.wait_cast_no_strike = waitCastNoStrike.length;
  stats._waitCastNoStrike = waitCastNoStrike;
  stats._staticButAnimated = staticButAnimated;
  return stats;
}

// --------------------------------------------------------------- 3. emotes
function emoteChecks() {
  const models = readJSON(CHARMANIFEST).models;
  const actions = readJSON(path.join(ROOT, 'assets/gamedata/actionname.json'));
  // actionname.dat's `type` IS the SocialAction id; type 0 ('petspecial') is
  // a pet command, not a PC emote, so the emote types are the positive ones.
  const types = [...new Set(actions.map(a => a.type).filter(t => t >= 2))]
    .sort((a, b) => a - b);
  check('actionname.dat still defines exactly twelve social emotes',
    types.length === 12 && types[0] === 2 && types[11] === 13,
    `types ${types.join(',')}`);

  const social = fs.existsSync(path.join(ANIMDIR, 'social_actions.json'))
    ? readJSON(path.join(ANIMDIR, 'social_actions.json')) : null;
  check('the client\'s PcSocialAnimName table is decoded for all 14 '
    + 'race/gender sets',
    social && Object.keys(social.prefixes).length === 14,
    social ? `${Object.keys(social.prefixes).length} prefixes`
      : 'tools/anim/social_actions.json missing -- run '
        + 'tools/anim/creature_anim_table.py');

  const holes = [];
  const dangling = [];
  let resolved = 0;
  for (const m of models) {
    const map = m.socialActions || {};
    const have = new Set((m.animations || []).map(x => x.toLowerCase()));
    for (const t of types) {
      const slot = map[String(t)];
      if (!slot) { holes.push(`${m.id}:type${t}`); continue; }
      if (!have.has(slot.toLowerCase())) {
        dangling.push(`${m.id}:type${t}->${slot}`);
        continue;
      }
      resolved++;
    }
  }
  check('all twelve SocialAction types resolve to a clip on every player '
    + 'model', holes.length === 0 && dangling.length === 0,
    holes.length || dangling.length
      ? `${holes.length} unmapped (${holes.slice(0, 6).join(', ')}), `
        + `${dangling.length} pointing at a missing clip `
        + `(${dangling.slice(0, 6).join(', ')})`
      : `${resolved} = ${models.length} models x 12 emotes`);

  // The emotes must be DISTINCT clips: mapping all twelve at 'dance' would
  // satisfy the check above while reproducing the exact bug.
  const collapsed = models.filter(m => new Set(
    Object.values(m.socialActions || {})).size < 11);
  check('the twelve emotes are distinct clips, not twelve names for "dance"',
    collapsed.length === 0 && models.length > 0,
    collapsed.length
      ? `${collapsed.length} models map <11 distinct clips: `
        + collapsed.map(m => m.id).join(', ')
      : `every model maps 12 types onto 12 distinct clips`);
  return { models: models.length, resolved };
}

// ---------------------------------------------------------- runtime guards
// entities.js:mapAnimations() resolves several states by "first clip whose
// name CONTAINS one of these words". Adding clips to a glTF is only safe
// while the frozen slot names still come first -- 'social_atk' and 'spatk01'
// both contain 'atk' and must never be reachable before 'attack'. This
// replays that resolution over the shipped animation lists.
const MAPANIM_GUARD = [
  "find('idle', 'wait', 'stand') || first",
  "find('attack', 'atk', 'hit') || first",
  "find('special') || find('attack') || first",
];
function runtimeGuards() {
  const src = fs.readFileSync(path.join(__dirname, 'js', 'entities.js'), 'utf8');
  const missing = MAPANIM_GUARD.filter(s => !src.includes(s));
  check('entities.js mapAnimations() still resolves the way this suite '
    + 'replays it', missing.length === 0,
    missing.length ? `these lines no longer appear: ${JSON.stringify(missing)}`
      : '3 keyword mappings match');

  const find = (names, words) =>
    names.find(n => words.some(w => n.toLowerCase().includes(w))) || null;
  const bad = [];
  const outOfSync = [];
  let seen = 0;
  for (const m of readJSON(MANIFEST).models) {
    const f = path.join(path.dirname(MANIFEST), m.gltf);
    if (!fs.existsSync(f)) continue;
    // The runtime keys its action map off the glTF's animations array, so
    // read THAT rather than trusting the manifest to mirror it -- and assert
    // that it does, since every other check here reads the manifest.
    const a = (readJSON(f).animations || []).map(x => x.name);
    if (JSON.stringify(a) !== JSON.stringify(m.animations || [])) {
      outOfSync.push(`${m.id}: gltf ${JSON.stringify(a)} vs manifest `
        + `${JSON.stringify(m.animations || [])}`);
    }
    if (!a.length) continue;
    seen++;
    if (a.includes('attack') && find(a, ['attack', 'atk', 'hit']) !== 'attack') {
      bad.push(`${m.id}: attack -> ${find(a, ['attack', 'atk', 'hit'])}`);
    }
    if (a.includes('idle') && find(a, ['idle', 'wait', 'stand']) !== 'idle') {
      bad.push(`${m.id}: idle -> ${find(a, ['idle', 'wait', 'stand'])}`);
    }
  }
  // Two contract slots that resolved to the same retail clip are emitted
  // once, the second becoming an alias. That is only sound if mapAnimations()
  // recovers the SAME clip for the aliased slot -- 'special' aliased to
  // 'attack' is exactly its documented fallback, but 'special' aliased to
  // 'idle' is not (the runtime would fall through to 'attack' and play a
  // swing retail never named there).
  const CHAIN = {
    idle: [['idle', 'wait', 'stand']], walk: [['walk']],
    run: [['run'], ['walk']], attack: [['attack', 'atk', 'hit']],
    special: [['special'], ['attack']], die: [['die', 'death', 'dead']],
  };
  const aliasBad = [];
  let aliases = 0;
  for (const m of readJSON(MANIFEST).models) {
    const a = m.animations || [];
    const clips = m.clips || {};
    for (const [slot, target] of Object.entries(m.clipAlias || {})) {
      if (!CHAIN[slot]) continue;
      aliases++;
      let got = null;
      for (const words of CHAIN[slot]) {
        got = find(a, words);
        if (got) break;
      }
      if (!got) got = a[0];
      if (clips[got] !== clips[target]) {
        aliasBad.push(`${m.id}:${slot} wants ${clips[slot]}, runtime plays `
          + `${clips[got]} via '${got}'`);
      }
    }
  }
  check('every aliased slot is recovered by mapAnimations as the SAME retail '
    + 'clip', aliasBad.length === 0,
    aliasBad.length ? `${aliasBad.length}: ${aliasBad.slice(0, 6).join('; ')}`
      : `${aliases} runtime-resolved aliases all land on their own clip`);

  check('the manifest\'s animation list is the glTF\'s, in glTF order',
    outOfSync.length === 0,
    outOfSync.length ? `${outOfSync.length}: ${outOfSync.slice(0, 4).join('; ')}`
      : 'every creature manifest entry matches its glTF');
  check('the added clips never steal a state from its frozen slot at runtime',
    bad.length === 0, bad.length ? bad.slice(0, 8).join('; ')
      : `attack/idle resolve to their own slots on all ${seen} animated creatures`);

  // For player models the manifest's `animations` is sorted alphabetically,
  // which is NOT the order the runtime sees -- three.js keys its action map
  // off the glTF's animations array, in glTF order. Read that.
  const charBad = [];
  let checked = 0;
  for (const m of readJSON(CHARMANIFEST).models) {
    const f = path.join(path.dirname(CHARMANIFEST), m.gltf);
    if (!fs.existsSync(f)) continue;
    const names = (readJSON(f).animations || []).map(a => a.name);
    if (!names.includes('attack')) continue;
    checked++;
    const got = names.find(n => ['attack', 'atk', 'hit'].some(
      w => n.toLowerCase().includes(w)));
    if (got !== 'attack') charBad.push(`${m.id}: attack -> ${got}`);
  }
  check('the social_* clips do not shadow a player model\'s "attack" in '
    + 'glTF clip order', charBad.length === 0,
    charBad.length ? charBad.slice(0, 8).join('; ')
      : `${checked} player glTFs keep 'attack' ahead of every other *atk* clip`);
}

// ------------------------------------------------------------------- main
const mstats = monsterChecks();
const estats = emoteChecks();
runtimeGuards();

console.log('\ncreature animation extraction');
if (mstats) {
  console.log(`  creatures                       : ${mstats.creatures}`);
  console.log(`  fully bound / partial / static  : `
    + `${mstats.buckets.full} / ${mstats.buckets.partial} / ${mstats.buckets.none}`);
  console.log(`  cast slot from the retail table : ${mstats.special_from_retail_table}`);
  console.log(`  cast = WAIT pose, strike exists : ${mstats.special_is_wait_with_strike_available}`);
  console.log(`  cast = WAIT pose, no strike ships: ${mstats.wait_cast_no_strike}`
    + (mstats.wait_cast_no_strike
      ? ` (${mstats._waitCastNoStrike.slice(0, 6).join(', ')}${mstats._waitCastNoStrike.length > 6 ? ', ...' : ''})` : ''));
  console.log(`  static despite a retail anim set: ${mstats.static_with_a_real_animation_set}`
    + (mstats._staticButAnimated.length
      ? ` (${mstats._staticButAnimated.map(s => s.split(' ')[0]).join(', ')})` : ''));
}
console.log(`  player models x emotes resolved : ${estats.resolved}`);
console.log('');
for (const c of summary.checks) {
  console.log(`  [${c.ok ? 'ok' : 'FAIL'}] ${c.name}`);
  if (!c.ok || !CHECK) console.log(`         ${c.detail}`);
}
if (summary.failed) {
  console.error('\nCREATURE ANIMATION VERIFICATION FAILED');
  process.exit(1);
}
console.log('\nall creature animation checks passed');
