#!/usr/bin/env node
// verify_audio_coverage.js — how many sounds the game asks for, how many this
// port can play, and where the rest go. Plus the footstep selection rule.
//
// This is a data audit, not a browser test: it reads the shipped tables, the
// built audio manifest, the binding index the client actually loads, and the
// per-tile step data, and joins them. verify_audio.js already covers the
// runtime (graph, decode, degrade path); nothing here needs a browser.
//
// THREE DIFFERENT QUESTIONS, kept apart on purpose. The repo used to answer
// only the first and call it coverage:
//
//   RESOLVED   the reference names a file we built. tools/audio/build_audio.py
//              --check answers this, but only for three of the six tables that
//              carry sound references.
//   BOUND      the reference reaches the browser at all — i.e. it is in
//              assets/audio/bindings.json, which is the ONLY sound table the
//              client downloads. A reference that resolves but is not bound
//              can never play, however good the .ogg is.
//   REACHABLE  some code path in editor/world/js/ can actually fire it.
//
// Every miss is bucketed by which of those three it failed, so a regression
// says what broke rather than just moving a number.
//
// Usage:
//   node verify_audio_coverage.js            # report
//   node verify_audio_coverage.js --check    # exit 1 on drift from EXPECT

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const GAMEDATA = path.join(ROOT, 'assets', 'gamedata');
const AUDIO = path.join(ROOT, 'assets', 'audio');
const WORLD = path.join(ROOT, 'assets', 'world');

const CHECK = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// EXPECT — the numbers this run must reproduce.
//
// These are measurements, not targets. Each was produced by this script from
// the shipped client data; a change means either the data changed or the
// pipeline did, and either way somebody must look. Do not "fix" a failure by
// editing this block unless you know which of the two happened.
// ---------------------------------------------------------------------------
const EXPECT = {
  manifestSfx: 5128,
  manifestMusic: 250,

  // distinct "package.name" references, per table+field
  refs: {
    'npcgrp.attack_sound': 17,
    'npcgrp.defense_sound': 149,
    'npcgrp.damage_sound': 440,
    'weapongrp.item_sound': 128,
    'weapongrp.equip_sound': 17,
    'weapongrp.drop_sound': 22,
    'skillsoundgrp.spell_sounds': 260,
    'skillsoundgrp.shot_sounds': 48,
    'skillsoundgrp.exp_sounds': 3,
    'skillsoundgrp.voice_cast': 58,
    'skillsoundgrp.voice_throw': 42,
    'armorgrp.item_sound': 50,
    'armorgrp.equip_sound': 14,
    'armorgrp.drop_sound': 18,
    'etcitemgrp.equip_sound': 9,
    'etcitemgrp.drop_sound': 35,
    'unr.AmbientSoundObject': 435,
    'unr.StepSound': 98,
  },

  // union across every source above
  distinctRefs: 1658,
  resolved: 1649,

  // References that name no file we built. Six were already known; three more
  // are in etcitemgrp, which build_audio.py --check never looked at.
  //
  //   antaras / antars      Antaras is a Hellbound-era raid; the sounds are
  //                         simply not in the Interlude banks.
  //   *_explotion           two SkillSound names misspelled in NCSoft's table
  //                         with no matching object in the bank either way.
  //   ...shing_3;[...       one weapongrp cell has two names glued together by
  //                         a stray ";[" separator.
  //   ...seize_mace_mace    a repeated word in the name.
  //   itemequip_etc_swordbody / itemequip_bone / itemequip_jewelbox
  //                         three etcitemgrp names with no object in ItemSound.
  //                         Note the first is used as a DROP sound while being
  //                         named "itemequip" — NCSoft's own copy/paste.
  unresolved: [
    'itemsound.itemdrop_weapon_seize_mace_mace',
    'itemsound.itemequip_bone',
    'itemsound.itemequip_etc_swordbody',
    'itemsound.itemequip_jewelbox',
    'itemsound.public_sword_shing_3;[itemsound.sword_great_4',
    'monsound3.antars_ground_wave',
    'skillsound.fiend_wind_explotion',
    'skillsound2.antaras_creak',
    'skillsound4.doublewind_explotion',
  ],

  // bindings.json is what the browser downloads. Anything resolved but absent
  // from it, and not carried by another shipped file, cannot play.
  boundNames: 989,

  // footsteps
  stepTiles: 100,
  stepActors: 12015,
  stepNames: 98,
  stepUnmatched: 0,
  stepVolumes: 0,       // the unused PhysicsVolume.bL2StepVolume path
};

// ---------------------------------------------------------------------------

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- 1. what the game data asks for ---------------------------------------

function collectRefs() {
  const out = new Map();                       // "table.field" -> Set(ref)
  const add = (key, ref) => {
    if (!ref || typeof ref !== 'string' || !ref.includes('.')) return;
    if (!out.has(key)) out.set(key, new Set());
    out.get(key).add(ref.toLowerCase());
  };
  const list = (key, arr) => (arr || []).forEach(r => add(key, r));

  for (const r of readJson(path.join(GAMEDATA, 'npcgrp.json'))) {
    list('npcgrp.attack_sound', r.attack_sound);
    list('npcgrp.defense_sound', r.defense_sound);
    list('npcgrp.damage_sound', r.damage_sound);
  }
  for (const r of readJson(path.join(GAMEDATA, 'weapongrp.json'))) {
    list('weapongrp.item_sound', r.item_sound);
    add('weapongrp.equip_sound', r.equip_sound);
    add('weapongrp.drop_sound', r.drop_sound);
  }
  for (const r of readJson(path.join(GAMEDATA, 'skillsoundgrp.json'))) {
    list('skillsoundgrp.spell_sounds', r.spell_sounds);
    list('skillsoundgrp.shot_sounds', r.shot_sounds);
    list('skillsoundgrp.exp_sounds', r.exp_sounds);
    // voice_cast / voice_throw are per-race maps, not arrays
    for (const f of ['voice_cast', 'voice_throw']) {
      for (const v of Object.values(r[f] || {})) add(`skillsoundgrp.${f}`, v);
    }
  }
  for (const r of readJson(path.join(GAMEDATA, 'armorgrp.json'))) {
    list('armorgrp.item_sound', r.item_sound);
    add('armorgrp.equip_sound', r.equip_sound);
    add('armorgrp.drop_sound', r.drop_sound);
  }
  for (const r of readJson(path.join(GAMEDATA, 'etcitemgrp.json'))) {
    add('etcitemgrp.equip_sound', r.equip_sound);
    add('etcitemgrp.drop_sound', r.drop_sound);
  }
  return out;
}

function tiles() {
  return fs.readdirSync(WORLD)
    .filter(d => fs.existsSync(path.join(WORLD, d, 'scene.json')))
    .sort();
}

// ---- run -------------------------------------------------------------------

const manifest = readJson(path.join(AUDIO, 'manifest.json'));
const sfx = manifest.sfx;

check('audio build present',
      Object.keys(sfx).length === EXPECT.manifestSfx &&
      manifest.music.length === EXPECT.manifestMusic,
      `${Object.keys(sfx).length} sfx / ${manifest.music.length} music`);

const refs = collectRefs();

// world audio + footsteps, per tile
const ambient = new Set();
const steps = new Set();
let stepActors = 0, stepTiles = 0, stepMissingTiles = [];
for (const t of tiles()) {
  const ap = path.join(WORLD, t, 'audio.json');
  if (fs.existsSync(ap)) {
    for (const a of readJson(ap).ambient || []) ambient.add(a.sound.toLowerCase());
  }
  const sp = path.join(WORLD, t, 'steps.json');
  if (!fs.existsSync(sp)) { stepMissingTiles.push(t); continue; }
  const s = readJson(sp);
  stepTiles++;
  stepActors += s.actors;
  for (const n of s.names) steps.add(n);
}
refs.set('unr.AmbientSoundObject', ambient);
refs.set('unr.StepSound', steps);

// per-source counts
const counts = {};
for (const [k, v] of refs) counts[k] = v.size;
const keys = Object.keys(EXPECT.refs).sort();
const drift = keys.filter(k => counts[k] !== EXPECT.refs[k])
                  .concat(Object.keys(counts).filter(k => !(k in EXPECT.refs)));
check('every reference source counts as expected', drift.length === 0,
      drift.map(k => `${k}: ${counts[k]} != ${EXPECT.refs[k]}`).join(', ') ||
      `${keys.length} sources`);

// union
const all = new Set();
for (const v of refs.values()) for (const r of v) all.add(r);
const missing = [...all].filter(r => !(r in sfx)).sort();

check('distinct references across every source',
      all.size === EXPECT.distinctRefs, `${all.size}`);
check('references that resolve to a built file',
      all.size - missing.length === EXPECT.resolved,
      `${all.size - missing.length}/${all.size}`);
check('the unresolved set is exactly the known-bad list',
      eq(missing, EXPECT.unresolved),
      missing.length === EXPECT.unresolved.length ? `${missing.length} refs` :
      `got ${missing.length}: ${missing.filter(m => !EXPECT.unresolved.includes(m)).join(', ')}`);

// ---- 2. BOUND: what actually reaches the browser --------------------------

const bindings = readJson(path.join(AUDIO, 'bindings.json'));
const bound = new Set(bindings.names);
check('bindings.json name table size', bound.size === EXPECT.boundNames,
      `${bound.size} names`);

// bucket every resolvable reference by whether the browser can see it
const resolvable = [...all].filter(r => r in sfx);
const buckets = new Map();
for (const [src, set] of refs) {
  let ok = 0, no = 0;
  for (const r of set) {
    if (!(r in sfx)) continue;
    // ambient + step references are carried by the per-tile files, not
    // bindings.json, so they count as delivered when their file exists.
    const delivered = bound.has(r) || src.startsWith('unr.');
    if (delivered) ok++; else no++;
  }
  buckets.set(src, { ok, no });
}
const unbound = [...buckets].filter(([, v]) => v.no > 0);
console.log('\nreferences the browser never receives (resolved, but not shipped to it):');
if (!unbound.length) console.log('  (none)');
for (const [src, v] of unbound.sort((a, b) => b[1].no - a[1].no)) {
  console.log(`  ${src.padEnd(32)} ${v.no} of ${v.ok + v.no}`);
}
const totalUnbound = unbound.reduce((n, [, v]) => n + v.no, 0);
console.log(`  ${'TOTAL'.padEnd(32)} ${totalUnbound} of ${resolvable.length} resolvable\n`);

// ---- 3. footsteps ----------------------------------------------------------

check('every tile has footstep data', stepMissingTiles.length === 0,
      stepMissingTiles.length ? `missing: ${stepMissingTiles.slice(0, 5).join(' ')}` :
      `${stepTiles} tiles`);
check('footstep actor count', stepActors === EXPECT.stepActors, `${stepActors}`);
check('distinct footstep sounds', steps.size === EXPECT.stepNames, `${steps.size}`);
check('every footstep sound resolves',
      [...steps].every(s => s in sfx),
      [...steps].filter(s => !(s in sfx)).join(', ') || 'all');

// The selection rule itself: a footstep bank belongs to a StaticMeshActor and
// is joined to a scene.json prop by (mesh, location). Re-assert the join on a
// tile rather than trusting the builder's own report.
const SAMPLE = '19_22';
if (fs.existsSync(path.join(WORLD, SAMPLE, 'steps.json'))) {
  const s = readJson(path.join(WORLD, SAMPLE, 'steps.json'));
  const scene = readJson(path.join(WORLD, SAMPLE, 'scene.json'));
  const idxs = Object.keys(s.props).map(Number);
  check(`${SAMPLE}: every step entry indexes a real prop`,
        idxs.length > 0 && idxs.every(i => scene.props[i] !== undefined),
        `${idxs.length} props of ${scene.props.length}`);
  check(`${SAMPLE}: every bank has 1..3 alternates`,
        Object.values(s.props).every(b => b.length >= 1 && b.length <= 3),
        'StaticMeshActor declares StepSound_1..3');
  check(`${SAMPLE}: banks index the tile name table`,
        Object.values(s.props).every(b => b.every(i => s.names[i] !== undefined)));
}

// Is anything in the client wired to play them? Say so plainly either way.
// This is reported as a GAP, not a FAIL: it is a known-open piece of work, and
// a permanently-red check is a broken gate rather than a signal. --check still
// exits 1 the moment any measurement above drifts.
const JS = path.join(ROOT, 'editor', 'world', 'js');
const clientSrc = fs.readdirSync(JS).filter(f => f.endsWith('.js'))
  .map(f => fs.readFileSync(path.join(JS, f), 'utf8')).join('\n');
// Deliberately narrow: only a real fetch of the data counts. A comment
// mentioning footsteps is not a consumer.
const footstepsWired = /steps\.json/.test(clientSrc);

console.log('\nopen gaps:');
const gaps = [];
if (!footstepsWired) {
  gaps.push('footsteps: assets/world/*/steps.json is built, complete and verified above, ' +
            'but nothing in editor/world/js fetches it. The port plays NO footstep at all — ' +
            'not a generic one, none. Wiring needs (a) the prop index under the ' +
            'character each frame, which only main.js/terrain.js can supply, and ' +
            '(b) the footfall cadence, which is an AnimNotify_Sound on the walk/run ' +
            'sequence and has not been read out of the .ukx yet.');
}
if (totalUnbound > 0) {
  gaps.push(`${totalUnbound} resolvable references never reach the browser (see the table above). ` +
            'armorgrp and etcitemgrp are absent from bindings.json entirely, and ' +
            "skillsoundgrp's voice_cast/voice_throw are absent from it too.");
}
if (!gaps.length) console.log('  (none)');
for (const g of gaps) console.log('  - ' + g);

console.log(`\n${pass} passed, ${fail} failed, ${gaps.length} open gaps`);
if (CHECK) process.exit(fail === 0 ? 0 : 1);
