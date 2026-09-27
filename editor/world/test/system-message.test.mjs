// Elbera Tools: actual message formatter, portable protocol/text fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderSysMsg } from '../js/gamedata.js';

const skills = { 7001: { name: 'Wrong base-level name', byLevel: {
  1: { name: 'First level' }, 101: { name: 'Exact enchanted name' },
} } };
const items = { 7001: { name: 'Synthetic material' } };

test('wire types distinguish a skill, item, number and text sharing the same numeric ID', () => {
  const meta = { 9999: { text: '$s1 / $s2 / $s3 / $s4' } };
  const typed = [{ type: 4, value: { id: 7001, level: 101 } },
    { type: 3, value: 7001 }, { type: 1, value: 7001 }, { type: 0, value: '7001' }];
  assert.equal(renderSysMsg(meta, 9999, [7001, 7001, 7001, '7001'], skills, typed, items),
    'Exact enchanted name / Synthetic material / 7001 / 7001');
});

test('message ID cannot override an explicit numeric parameter or guess a missing skill level', () => {
  const meta = { 46: { text: '$s1' }, 92: { text: '$s1' } };
  assert.equal(renderSysMsg(meta, 46, [7001], skills, [{ type: 1, value: 7001 }]), '7001');
  for (const level of [null, undefined, 2]) {
    assert.equal(renderSysMsg(meta, 92, [7001], skills,
      [{ type: 4, value: { id: 7001, level } }]), 'Skill #7001');
  }
});

test('numbered placeholders retain reordered, repeated and mixed references', () => {
  const meta = { 1: { text: '$s2 $s1; $s1; $c2; $s10; $s3' } };
  const params = ['first', 'second']; params[9] = 'tenth';
  assert.equal(renderSysMsg(meta, 1, params), 'second first; first; second; tenth; $s3');
  assert.equal(renderSysMsg({ 1: { text: '$s1 then $s1' } }, 1, ['$s2']), '$s2 then $s2');
});

test('local dialogs keep supplied text verbatim and missing templates remain explicit', () => {
  assert.equal(renderSysMsg({ 46: { text: 'Use $s1' } }, 46, ['Already resolved']), 'Use Already resolved');
  assert.equal(renderSysMsg(null, 92, [7001], skills,
    [{ type: 4, value: { id: 7001, level: 101 } }]), 'sysmsg 92: Exact enchanted name');
});

const sourceFile = new URL('../../../assets/gamedata/systemmsg.json', import.meta.url);
test('original private message examples preserve their own reordered and repeated numbering',
  { skip: !fs.existsSync(sourceFile) && 'requires locally decoded original systemmsg.json' }, () => {
    const meta = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
    assert.match(meta[29].text, /\$s2.*\$s1/);
    assert.equal(renderSysMsg(meta, 29, ['material', 7]),
      meta[29].text.replaceAll('$s2', '7').replaceAll('$s1', 'material'));
    assert.equal(meta[1228].text.match(/\$s1/g).length, 2);
    assert.equal(renderSysMsg(meta, 1228, ['Recipient']), meta[1228].text.replaceAll('$s1', 'Recipient'));
  });
