// Elbera Tools: exact skill-level data and actual tooltip behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { mergeSkillText } from '../js/skilltext.js';
import { skillInfo } from '../js/gamedata.js';

function row(level) {
  return { name: `Synthetic skill ${level}`, desc: `Exact description ${level}`,
    enchantName: '', enchantDesc: '', icon: `icons/synthetic_${level}.png`,
    iconRef: `icon.synthetic_${level}`, hp: level, mp: level * 3, range: level === 1 ? -2 : 300,
    operateType: level === 1 ? 0 : 2, isMagic: 0,
    hasText: true, hasIconRecord: true };
}
function data() {
  const source = { sha256: 'a'.repeat(64), decodedSHA256: 'b'.repeat(64), records: 2 };
  return { format: 'l2-skilltext-v1', provenance: {
    sources: { 'skillgrp.dat': { ...source }, 'skillname-e.dat': { ...source } },
    nameRecordCount: 2, iconRecordCount: 2, recordCount: 2, skillCount: 1,
  }, skills: { 7001: { 1: row(1), 101: row(101) } } };
}
const legacy = { 7001: { name: 'Legacy level-one name', desc: 'Wrong for requested level',
  icon: 'icons/legacy.png', levels: 101 } };

test('exact level name, description, icon and costs replace the collapsed legacy record', () => {
  const meta = mergeSkillText(legacy, data());
  const info = skillInfo(meta, 7001, 101);
  assert.equal(info.name, 'Synthetic skill 101');
  assert.equal(info.desc, 'Exact description 101');
  assert.equal(info.icon, '/gamedata/icons/synthetic_101.png');
  assert.equal(info.mp, 303);
  assert.equal(info.range, 300);
  assert.equal(info.exactLevel, true);
  assert.equal(info.hasText, true);
  assert.equal(info.displayTypeId, 312);
  // Existing id-only consumers, including system messages, are unaffected.
  assert.equal(skillInfo(meta, 7001).name, legacy[7001].name);
  assert.equal(skillInfo(meta, 7001).icon, '/gamedata/icons/legacy.png');
  assert.deepEqual(Object.keys(meta), ['7001']);
  assert.equal(meta.skillTextProvenance.recordCount, 2);
});

test('missing or invalid requested levels never use another level or id-only icon/text', () => {
  const exact = mergeSkillText(legacy, data());
  for (const meta of [exact, legacy, null]) {
    for (const level of [0, 2, 100, 102, -1, 1.5, '01', null, NaN]) {
      const info = skillInfo(meta, 7001, level);
      assert.equal(info.name, 'Skill #7001');
      assert.equal(info.desc, '');
      assert.equal(info.icon, null);
      assert.equal(info.mp, null);
      assert.equal(info.displayTypeId, null);
      assert.equal(info.exactLevel, false);
    }
  }
});

test('empty original text and incomplete joins remain empty, never borrowing sibling fields', () => {
  const input = data();
  Object.assign(input.skills[7001][101], { name: '', desc: '', icon: null, iconRef: null,
    hp: null, mp: null, range: null, operateType: null, isMagic: null, hasIconRecord: false });
  input.provenance.iconRecordCount = input.provenance.sources['skillgrp.dat'].records = 1;
  const info = skillInfo(mergeSkillText(legacy, input), 7001, 101);
  assert.equal(info.desc, '');
  assert.equal(info.icon, null);
  assert.equal(info.exactLevel, true);
  assert.equal(info.hp, null);
});

test('malformed source provenance, rows and ambiguous keys fail visibly', () => {
  for (const mutate of [
    d => { d.format = 'another format'; },
    d => { d.provenance.sources['skillgrp.dat'].sha256 = 'unknown'; },
    d => { d.provenance.recordCount = 3; },
    d => { d.skills[7001]['01'] = d.skills[7001][1]; delete d.skills[7001][1]; },
    d => { d.skills[7001][1].desc = 7; },
    d => { d.skills[7001][1].icon = '../other-level.png'; },
    d => { d.skills[7001][1].hasText = false; },
    d => { d.skills[7001][1].mp = -1; },
  ]) {
    const input = data(); mutate(input);
    assert.throws(() => mergeSkillText(legacy, input));
  }
});

test('operate labels follow exact native is_magic precedence, not the first level or server category', () => {
  for (const [isMagic, operateType, expected] of [
    [0, 0, 311], [0, 1, 311], [0, 2, 312], [0, 3, 311],
    [1, 2, 313], [2, 2, 313], [3, 2, 1500],
  ]) {
    const input = data();
    Object.assign(input.skills[7001][101], { isMagic, operateType });
    const meta = mergeSkillText(legacy, input);
    assert.equal(skillInfo(meta, 7001, 1).displayTypeId, 311);
    assert.equal(skillInfo(meta, 7001, 101).displayTypeId, expected);
  }
});

test('actual tooltip uses requested-level prose/costs and does not call the clamping numeric accessor', () => {
  const source = fs.readFileSync(new URL('../js/ui/skillwnd.js', import.meta.url), 'utf8');
  const a = source.indexOf('export function skillTooltipLines('), b = source.indexOf("\nconst WND =", a);
  assert.ok(a >= 0 && b > a);
  const context = vm.createContext({ skillInfo, TIP_LV: 88, TIP_HP: 1195, TIP_MP: 320, TIP_RANGE: 321,
    S: id => ({ 88: 'Lv', 1195: 'HP Cost', 320: 'MP Cost', 321: 'Range', 311: 'Active Skill', 312: 'Passive Skill' })[id],
    SkillClass: { displayType() { assert.fail('first-level display label'); }, num() { assert.fail('clamped lookup'); } },
  });
  const tooltip = vm.runInContext(source.slice(a, b).replace('export ', '') + '\nskillTooltipLines;', context);
  const meta = mergeSkillText(legacy, data());
  const lines = [...tooltip(7001, 101, meta)];
  assert.deepEqual(lines, ['Synthetic skill 101', 'Lv 101', 'Passive Skill',
    'HP Cost : 101', 'MP Cost : 303', 'Range : 300', 'Exact description 101']);
  const missing = [...tooltip(7001, 2, meta)];
  assert.ok(!missing.some(line => /Cost|description|Wrong|Range/.test(line)));
  assert.ok(!missing.some(line => line === 'Active Skill' || line === 'Passive Skill'));
  assert.ok(![...tooltip(7001, 1, meta)].some(line => line.startsWith('Range')));
});

test('skillMeta retries missing exact data while preserving legacy id-only access', async () => {
  const savedFetch = globalThis.fetch;
  let exactRequests = 0;
  globalThis.fetch = async path => ({ ok: path !== '/gamedata/skilltext.json' || ++exactRequests > 1,
    json: async () => path === '/gamedata/skillmeta.json' ? legacy : path === '/gamedata/skilltext.json' ? data() : {},
  });
  try {
    const module = await import(`../js/gamedata.js?skilltext-retry=${Date.now()}`);
    const first = await module.skillMeta();
    assert.equal(module.skillInfo(first, 7001).name, legacy[7001].name);
    assert.equal(module.skillInfo(first, 7001, 101).exactLevel, false);
    const second = await module.skillMeta();
    assert.equal(module.skillInfo(second, 7001, 101).exactLevel, true);
    assert.equal(exactRequests, 2);
  } finally { globalThis.fetch = savedFetch; }
});

const privatePath = new URL('../../../assets/gamedata/skilltext.json', import.meta.url);
test('locally generated exact original skill text passes runtime validation', { skip: !fs.existsSync(privatePath) }, () => {
  const input = JSON.parse(fs.readFileSync(privatePath, 'utf8'));
  const meta = mergeSkillText(null, input);
  assert.equal(meta.skillTextProvenance.recordCount, 29812);
  assert.notEqual(skillInfo(meta, 3, 1).desc, skillInfo(meta, 3, 2).desc);
  assert.equal(skillInfo(meta, 3, 999).icon, null);
});
