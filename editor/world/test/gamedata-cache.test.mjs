// Elbera Tools: actual metadata loader with controlled responses only.
// No original data, browser, server or automatic retry timer.
import test from 'node:test';
import assert from 'node:assert/strict';

let instance = 0;
async function withModule(fetcher, run) {
  const prior = globalThis.fetch, calls = [];
  globalThis.fetch = path => { calls.push(path); return fetcher(path); };
  try {
    const module = await import(`../js/gamedata.js?cache-test=${++instance}`);
    await run(module, path => calls.filter(value => value === path).length);
  } finally { globalThis.fetch = prior; }
}
const ok = value => ({ ok: true, json: async () => value });
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

for (const [method, path] of [
  ['itemMeta', '/gamedata/itemmeta.json'], ['sysMsgMeta', '/gamedata/systemmsg.json'],
  ['skillWeapons', '/gamedata/skillweapons.json'], ['itemTypes', '/gamedata/itemtypes.json'],
  ['sysStringMeta', '/gamedata/sysstring.json'], ['classIcons', '/gamedata/classicons.json'],
]) {
  test(`${method} retries an unavailable response, shares inflight work and caches success`, async () => {
    const first = deferred(), second = deferred(); let attempts = 0;
    const value = { synthetic: 'source response' };
    await withModule(url => url === path ? (++attempts === 1 ? first.promise : second.promise) : ok({}), async (m, count) => {
      const initial = m[method]();
      assert.equal(m[method](), initial);
      first.resolve({ ok: false }); assert.equal(await initial, null);
      assert.equal(count(path), 1, 'failure does not start an automatic retry');
      const retry = m[method](); assert.notEqual(retry, initial);
      assert.equal(m[method](), retry);
      second.resolve(ok(value)); assert.equal(await retry, value);
      assert.equal(m[method](), retry); assert.equal(await m[method](), value);
      assert.equal(count(path), 2);
    });
  });
}

test('network, synchronous fetch, JSON decoding and explicit null failures all remain retryable', async () => {
  const path = '/gamedata/itemmeta.json';
  for (const fail of [() => Promise.reject(new Error('network')),
    () => { throw new Error('unavailable fetch'); },
    () => ({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } }),
    () => ok(null)]) {
    let attempts = 0;
    await withModule(url => url === path ? (++attempts === 1 ? fail() : ok({})) : ok({}), async (m, count) => {
      assert.equal(await m.itemMeta(), null);
      assert.deepEqual(await m.itemMeta(), {});
      assert.deepEqual(await m.itemMeta(), {});
      assert.equal(count(path), 2, 'a successful empty table is cached');
    });
  }
});

test('action indexing retries missing data and caches a valid empty source list', async () => {
  const path = '/gamedata/actionname.json'; let attempts = 0;
  await withModule(url => url === path ? (++attempts === 1 ? { ok: false } : ok([])) : ok({}), async (m, count) => {
    const first = m.actionMeta(); assert.equal(m.actionMeta(), first);
    assert.deepEqual(await first, { list: [], byId: {} });
    const retry = m.actionMeta(); assert.notEqual(retry, first);
    assert.equal(m.actionMeta(), retry); assert.deepEqual(await retry, { list: [], byId: {} });
    assert.equal(m.actionMeta(), retry); assert.equal(count(path), 2);
  });
});

test('recovered shot metadata updates the synchronous accessor after failed eager loading', async () => {
  const path = '/gamedata/shots.json', first = deferred(); let attempts = 0;
  const value = { 7001: { kind: 'soulshot' } };
  await withModule(url => url === path ? (++attempts === 1 ? first.promise : ok(value)) : ok({}), async (m, count) => {
    const initial = m.shotMeta(); assert.equal(m.shotMeta(), initial);
    first.resolve({ ok: false }); assert.equal(await initial, null);
    assert.equal(m.shotsReady(), null); assert.equal(m.isShot(7001), false);
    const retry = m.shotMeta(); assert.equal(m.shotMeta(), retry);
    assert.equal(await retry, value); assert.equal(m.shotsReady(), value);
    assert.equal(m.isShot(7001), true); assert.equal(m.shotMeta(), retry);
    assert.equal(count(path), 2);
  });
});

test('animation metadata retries failure and publishes only the recovered response', async () => {
  const path = '/gamedata/skillanim.json'; let attempts = 0;
  const value = { 7001: { levels: [1], anim: 'synthetic' } };
  await withModule(url => url === path ? (++attempts === 1 ? { ok: false } : ok(value)) : ok({}), async (m, count) => {
    const initial = m.skillAnimMeta(); assert.equal(m.skillAnimMeta(), initial);
    assert.equal(await initial, null); assert.equal(m.skillAnimLoaded(), null);
    const retry = m.skillAnimMeta(); assert.equal(m.skillAnimMeta(), retry);
    assert.equal(await retry, value); assert.equal(m.skillAnimLoaded(), value);
    assert.equal(m.skillAnimMeta(), retry); assert.equal(count(path), 2);
  });
});

function exactText() {
  const fingerprint = { sha256: 'a'.repeat(64), decodedSHA256: 'b'.repeat(64), records: 1 };
  return { format: 'l2-skilltext-v1', provenance: {
    sources: { 'skillgrp.dat': fingerprint, 'skillname-e.dat': fingerprint },
    nameRecordCount: 1, iconRecordCount: 1, recordCount: 1, skillCount: 1,
  }, skills: { 7001: { 1: { name: 'Synthetic exact', desc: '', enchantName: '', enchantDesc: '',
    iconRef: 'icon.synthetic', icon: 'icons/synthetic.png', hp: 0, mp: 0, range: 0,
    operateType: 0, isMagic: 0, hasText: true, hasIconRecord: true } } } };
}

for (const failedPath of ['/gamedata/skillmeta.json', '/gamedata/skilltext.json']) {
  test(`skill metadata retries only its missing dependency: ${failedPath}`, async () => {
    let attempts = 0;
    const legacy = { 7001: { name: 'Synthetic legacy' } }, exact = exactText();
    await withModule(path => {
      if (path === failedPath && ++attempts === 1) return { ok: false };
      return ok(path === '/gamedata/skilltext.json' ? exact : path === '/gamedata/skillmeta.json' ? legacy : {});
    }, async (m, count) => {
      const initial = m.skillMeta(); assert.equal(m.skillMeta(), initial); await initial;
      const retry = m.skillMeta(); assert.notEqual(retry, initial); assert.equal(m.skillMeta(), retry);
      const result = await retry;
      assert.equal(m.skillInfo(result, 7001).name, 'Synthetic legacy');
      assert.equal(m.skillInfo(result, 7001, 1).name, 'Synthetic exact');
      assert.equal(m.skillMeta(), retry);
      assert.equal(count(failedPath), 2);
      assert.equal(count(failedPath === '/gamedata/skilltext.json' ? '/gamedata/skillmeta.json' : '/gamedata/skilltext.json'), 1);
    });
  });
}

test('existing exact-skill validation failures retry without refetching valid legacy data', async () => {
  let attempts = 0; const warnings = [], priorWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    await withModule(path => ok(path === '/gamedata/skilltext.json'
      ? (++attempts === 1 ? { format: 'unsupported' } : exactText())
      : path === '/gamedata/skillmeta.json' ? { 7001: { name: 'Synthetic legacy' } } : {}), async (m, count) => {
      const first = await m.skillMeta();
      assert.equal(m.skillInfo(first, 7001).name, 'Synthetic legacy');
      assert.equal(m.skillInfo(first, 7001, 1).exactLevel, false);
      const retry = await m.skillMeta();
      assert.equal(m.skillInfo(retry, 7001, 1).exactLevel, true);
      assert.equal(count('/gamedata/skilltext.json'), 2);
      assert.equal(count('/gamedata/skillmeta.json'), 1);
      assert.equal(warnings.length, 1);
    });
  } finally { console.warn = priorWarn; }
});
