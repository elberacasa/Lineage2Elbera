// Exercise the actual main.js scene loader without booting its DOM/network UI.
// Only external resource and rendering boundaries are replaced. Controlled
// promises reproduce out-of-order completion and failures without timing races.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const start = main.indexOf('let sceneLoadGeneration = 0;');
const end = main.indexOf('\nasync function loadCharacter(', start);
assert.ok(start >= 0 && end > start, 'scene loader boundary must exist');
const loader = main.slice(start, end);
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ neighbors = false, delayedFetch = false, delayedCollision = false } = {}) {
  const collisions = new Map();
  const jobs = new Map(), fetches = new Map(), neighborJobs = new Map(), notices = [];
  const hidden = new Set(['hidden']);
  const old = { group: { tile: 'old' }, disposed: 0, dispose() { this.disposed++; } };
  const children = new Set([old.group]);
  const noticesDom = [];
  const element = () => ({ style: {}, children: [], events: {},
    setAttribute() {}, append(...items) { this.children.push(...items); },
    addEventListener(name, handler) { this.events[name] = handler; },
    remove() { const index = noticesDom.indexOf(this); if (index >= 0) noticesDom.splice(index, 1); },
  });
  class Terrain {
    constructor(def) {
      this.def = def; this.group = { tile: def.tile }; this.disposed = 0;
      this.work = deferred(); jobs.set(def.tile, this);
    }
    async load(onStage) { this.stage = onStage; onStage('objects'); await this.work.promise; }
    dispose() { this.disposed++; }
    center() { return {}; }
    heightAtWorld(x, z, hint) { this.groundQuery = [x, z, hint]; return hint; }
  }
  const context = {
    AbortController, DOMException, Terrain, pickingInspection: null, lastWorldPick: null,
    document: { createElement: element, body: { append: notice => noticesDom.push(notice) } },
    terrain: old, staticCollision: { tile: 'old' }, currentTile: 'old', sceneLoading: false, pendingSceneSwitch: null, onlineGeneration: 0,
    inspectionRequest: null, character: null, online: false, selfServerPosition: null,
    tileNameFor: () => 'entered',
    chat: { addSystem: m => notices.push(m) },
    HD_ENABLED: false, NEIGHBORS_ENABLED: neighbors,
    scene: { add: group => children.add(group), remove: group => children.delete(group) },
    loadingEl: { classList: { add: x => hidden.add(x), remove: x => hidden.delete(x) } },
    setLoading: m => notices.push(m), setStatus: m => notices.push(m),
    applyInteriorMode: () => {}, worldAudio: { load() {} },
    worldLight: { direction: {}, load() {} },
    sun: { position: { copy() { return this; }, multiplyScalar() { return this; }, add() {} } },
    neighbors: {
      setCenter(tile) { const work = deferred(); neighborJobs.set(tile, work); return work.promise; },
      async disposeAll() {},
    },
    console: { error: (...args) => notices.push(args), warn: (...args) => notices.push(args), info() {} },
    loadStaticCollision: async tile => {
      if (delayedCollision) { const work = deferred(); collisions.set(tile, work); await work.promise; }
      return { tile };
    },
    fetch: async (url, options) => {
      const tile = url.split('/').at(-2), work = deferred();
      fetches.set(tile, { ...work, signal: options.signal });
      if (delayedFetch) await work.promise;
      return { ok: true, json: async () => ({ tile, gridSize: 256 }) };
    },
  };
  vm.runInNewContext(loader + '\nObject.assign(globalThis, { runSceneLoad: loadScene, canAutomaticallyLoadScene, clearSceneLoadFailures });', context);
  return { context, jobs, fetches, collisions, neighborJobs, notices, noticesDom, hidden, old, children };
}

test('latest requested scene wins when terrain builds finish out of order', async () => {
  const h = harness();
  const first = h.context.runSceneLoad('first'); await tick();
  const latest = h.context.runSceneLoad('latest'); await tick();
  assert.equal(h.fetches.get('first').signal.aborted, true);
  h.jobs.get('latest').work.resolve(); await latest;
  assert.equal(h.context.currentTile, 'latest');
  assert.equal(h.context.staticCollision.tile, 'latest');
  const noticeCount = h.notices.length;
  h.jobs.get('first').work.resolve(); await first;
  assert.equal(h.context.currentTile, 'latest');
  assert.equal(h.context.staticCollision.tile, 'latest');
  assert.equal(h.jobs.get('first').disposed, 1);
  assert.equal(h.jobs.get('latest').disposed, 0);
  assert.equal(h.old.disposed, 1);
  assert.deepEqual([...h.children].map(g => g.tile), ['latest']);
  assert.equal(h.notices.length, noticeCount, 'stale completion cannot overwrite status');
});

test('failed partial terrain is disposed while the visible terrain survives', async () => {
  const h = harness();
  const loading = h.context.runSceneLoad('broken'); await tick();
  h.jobs.get('broken').work.reject(new Error('texture decode failure'));
  await loading;
  assert.equal(h.context.terrain, h.old);
  assert.equal(h.context.currentTile, 'old');
  assert.equal(h.old.disposed, 0);
  assert.equal(h.jobs.get('broken').disposed, 1);
  assert.equal(h.context.sceneLoading, false);
  assert.equal(h.hidden.has('hidden'), true);
});

test('stale failure and phase callbacks cannot clear newer progress or busy state', async () => {
  const h = harness();
  const first = h.context.runSceneLoad('first'); await tick();
  const latest = h.context.runSceneLoad('latest'); await tick();
  const noticeCount = h.notices.length;
  assert.throws(() => h.jobs.get('first').stage('buildings'), { name: 'AbortError' });
  h.jobs.get('first').work.reject(new Error('obsolete failure'));
  await first;
  assert.equal(h.notices.length, noticeCount);
  assert.equal(h.context.sceneLoading, true);
  assert.equal(h.hidden.has('hidden'), false);
  assert.equal(h.jobs.get('first').disposed, 1);
  h.jobs.get('latest').work.resolve(); await latest;
});

test('late neighbor completion cannot finish a newer scene load or double-dispose adopted terrain', async () => {
  const h = harness({ neighbors: true });
  const first = h.context.runSceneLoad('first'); await tick();
  h.jobs.get('first').work.resolve(); await tick();
  assert.equal(h.context.currentTile, 'first');
  const latest = h.context.runSceneLoad('latest'); await tick();
  const noticeCount = h.notices.length;
  h.neighborJobs.get('first').resolve(); await first;
  assert.equal(h.context.sceneLoading, true);
  assert.equal(h.hidden.has('hidden'), false);
  assert.equal(h.notices.length, noticeCount);
  assert.equal(h.jobs.get('first').disposed, 0, 'adopted terrain still visible while replacement builds');
  h.jobs.get('latest').work.resolve(); await tick();
  h.neighborJobs.get('latest').resolve(); await latest;
  assert.equal(h.jobs.get('first').disposed, 1);
  assert.equal(h.jobs.get('latest').disposed, 0);
  assert.equal(h.context.currentTile, 'latest');
  assert.equal(h.context.staticCollision.tile, 'latest');
});

test('completed surrounding-map progress leaves visibility checks, and the next load reopens it', async () => {
  const h = harness({ neighbors: true });
  const loading = h.context.runSceneLoad('17_25'); await tick();
  h.jobs.get('17_25').work.resolve(); await tick();
  assert.equal(h.notices.at(-1), 'loading 17_25: surrounding maps…');
  assert.equal(h.context.sceneLoading, true);
  assert.equal(h.hidden.has('hidden'), false, 'actual unfinished neighbors remain loading');
  h.neighborJobs.get('17_25').resolve(); await loading;
  assert.equal(h.context.sceneLoading, false);
  assert.equal(h.hidden.has('hidden'), true);
  // The actual loader already added .hidden before this fix. Opacity alone
  // leaves stale text exposed to DOM/AX visibility checks. Assert the final
  // CSS state as well; fade timing and actual AX behavior are browser checks.
  const hiddenRule = css.match(/#loading\.hidden\s*\{([^}]*)\}/)?.[1] || '';
  const declarations = Object.fromEntries(hiddenRule.replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';').map(value => value.split(':').map(part => part.trim())).filter(row => row.length === 2));
  assert.ok(declarations.visibility === 'hidden' || declarations.display === 'none',
    'finished progress must be hidden semantically, not only transparent');
  const next = h.context.runSceneLoad('18_24'); await tick();
  assert.equal(h.hidden.has('hidden'), false, 'next scene still raises the progress overlay');
  h.jobs.get('18_24').work.resolve(); await tick();
  h.neighborJobs.get('18_24').resolve(); await next;
  assert.equal(h.context.sceneLoading, false);
  assert.equal(h.hidden.has('hidden'), true);
});

test('superseded scene metadata never starts terrain construction even if fetch ignores abort', async () => {
  const h = harness({ delayedFetch: true });
  const first = h.context.runSceneLoad('first');
  const latest = h.context.runSceneLoad('latest');
  h.fetches.get('first').resolve(); await first;
  assert.equal(h.jobs.has('first'), false);
  assert.equal(h.context.sceneLoading, true);
  h.fetches.get('latest').resolve(); await tick();
  h.jobs.get('latest').work.resolve(); await latest;
  assert.equal(h.context.currentTile, 'latest');
  assert.equal(h.context.staticCollision.tile, 'latest');
});

test('a retired session cannot adopt its finished terrain or update status', async () => {
  const h = harness();
  let current = true;
  const loading = h.context.runSceneLoad('session', { isCurrentSession: () => current });
  await tick();
  current = false;
  const noticeCount = h.notices.length;
  h.jobs.get('session').work.resolve(); await loading;
  assert.equal(h.context.terrain, h.old);
  assert.equal(h.context.currentTile, 'old');
  assert.equal(h.jobs.get('session').disposed, 1);
  assert.equal(h.notices.length, noticeCount);
  assert.equal(h.context.sceneLoading, false);
  assert.equal(h.hidden.has('hidden'), true);
});

test('a retired session stops at terrain phase boundaries before more work starts', async () => {
  const h = harness();
  let current = true;
  const loading = h.context.runSceneLoad('session', { isCurrentSession: () => current });
  await tick(); current = false;
  assert.throws(() => h.jobs.get('session').stage('more textures'), { name: 'AbortError' });
  h.jobs.get('session').work.resolve(); await loading;
  assert.equal(h.old.disposed, 0);
  assert.equal(h.jobs.get('session').disposed, 1);
});

test('connecting retires an offline scene build before it replaces the player map', async () => {
  const h = harness();
  const loading = h.context.runSceneLoad('offline-picker'); await tick();
  h.context.onlineGeneration++;
  h.jobs.get('offline-picker').work.resolve(); await loading;
  assert.equal(h.context.terrain, h.old);
  assert.equal(h.context.currentTile, 'old');
  assert.equal(h.jobs.get('offline-picker').disposed, 1);
});


test('late source collision cannot attach to a replacement scene', async () => {
  const h = harness({ delayedCollision: true });
  const stale = h.context.runSceneLoad('stale'); await tick();
  const latest = h.context.runSceneLoad('latest'); await tick();
  h.collisions.get('latest').resolve(); await tick();
  h.jobs.get('latest').work.resolve(); await latest;
  h.collisions.get('stale').resolve(); await stale;
  assert.equal(h.context.staticCollision.tile, 'latest');
  assert.equal(h.jobs.has('stale'), false, 'retired collision load must not start terrain work');
});

test('declared source collision failure keeps previous scene and collision together', async () => {
  const h = harness({ delayedCollision: true });
  const attempt = h.context.runSceneLoad('broken'); await tick();
  h.collisions.get('broken').reject(new Error('malformed collision')); await attempt;
  assert.equal(h.context.terrain, h.old);
  assert.equal(h.context.staticCollision.tile, 'old');
  assert.equal(h.jobs.has('broken'), false);
});

test('failed automatic collision loads stop until the visible retry is clicked', async () => {
  const h = harness({ delayedCollision: true });
  const attempt = h.context.runSceneLoad('broken', { automatic: true, keepCharPos: true }); await tick();
  h.collisions.get('broken').reject(new Error('malformed collision')); await attempt;
  const originalFetch = h.fetches.get('broken');
  for (let frame = 0; frame < 5; frame++) await h.context.runSceneLoad('broken', { automatic: true });
  assert.equal(h.fetches.get('broken'), originalFetch, 'frame retries must not issue requests');
  assert.equal(h.context.canAutomaticallyLoadScene('broken'), false);
  assert.equal(h.context.terrain, h.old);
  assert.equal(h.context.staticCollision.tile, 'old');
  assert.equal(h.noticesDom.length, 1);
  const retryButton = h.noticesDom[0].children[1];
  assert.equal(retryButton.textContent, 'Retry scene');
  const retry = retryButton.events.click(); await tick();
  assert.notEqual(h.fetches.get('broken'), originalFetch);
  assert.equal(h.noticesDom.length, 0, 'retry notice retires before the new request');
  assert.equal(retryButton.events.click(), undefined, 'a detached double-click cannot start another attempt');
  h.collisions.get('broken').resolve(); await tick();
  h.jobs.get('broken').work.resolve(); await retry;
  assert.equal(h.context.currentTile, 'broken');
  assert.equal(h.context.canAutomaticallyLoadScene('broken'), true);
  assert.equal(h.old.disposed, 1);
});

test('new scene requests retire retry callbacks and stale completion cannot win', async () => {
  const h = harness();
  const failed = h.context.runSceneLoad('broken', { automatic: true }); await tick();
  h.jobs.get('broken').work.reject(new Error('failed')); await failed;
  const retryButton = h.noticesDom[0].children[1];
  const retry = retryButton.events.click(); await tick();
  const retriedTerrain = h.jobs.get('broken');
  const latest = h.context.runSceneLoad('latest'); await tick();
  assert.equal(retryButton.events.click(), undefined);
  h.jobs.get('latest').work.resolve(); await latest;
  retriedTerrain.work.resolve(); await retry;
  assert.equal(h.context.currentTile, 'latest');
  assert.equal(retriedTerrain.disposed, 1);
  assert.equal(h.noticesDom.length, 0);
});

test('new sessions allow the tile again but cannot invoke a retired retry callback', async () => {
  const h = harness();
  const failed = h.context.runSceneLoad('broken', { automatic: true }); await tick();
  h.jobs.get('broken').work.reject(new Error('failed')); await failed;
  const retryButton = h.noticesDom[0].children[1], originalFetch = h.fetches.get('broken');
  h.context.onlineGeneration++;
  assert.equal(retryButton.events.click(), undefined);
  assert.equal(h.fetches.get('broken'), originalFetch);
  h.context.clearSceneLoadFailures();
  assert.equal(h.noticesDom.length, 0);
  const fresh = h.context.runSceneLoad('broken', { automatic: true }); await tick();
  assert.notEqual(h.fetches.get('broken'), originalFetch);
  h.jobs.get('broken').work.resolve(); await fresh;
  assert.equal(h.context.currentTile, 'broken');
});

test('actual frame boundary watcher leaves a failed destination idle and admits a different destination', async () => {
  const h = harness();
  const failed = h.context.runSceneLoad('broken', { automatic: true }); await tick();
  h.jobs.get('broken').work.reject(new Error('failed')); await failed;
  const boundaryStart = main.indexOf('    if (!terrain.interior && !sceneLoading) {');
  const boundaryEnd = main.indexOf('\n    combat.update(entityHeadPos);', boundaryStart);
  assert.ok(boundaryStart >= 0 && boundaryEnd > boundaryStart);
  Object.assign(h.context, { character: { group: { position: { x: 0, y: 0, z: 0 } } },
    availableScenes: ['broken', 'other'], destination: 'broken', threeToL2: p => p,
    tileNameFor: () => h.context.destination });
  h.context.neighbors.preloadNear = () => {};
  vm.runInNewContext('globalThis.runBoundary = () => {' + main.slice(boundaryStart, boundaryEnd) + '\n};', h.context);
  for (let frame = 0; frame < 5; frame++) h.context.runBoundary();
  assert.equal(h.context.pendingSceneSwitch, null);
  h.context.destination = 'other'; h.context.runBoundary();
  assert.equal(h.context.pendingSceneSwitch.tile, 'other');
});

test('retry after an initial online scene failure preserves entered character XY and matching server Z', async () => {
  const h = harness();
  h.context.online = true;
  const failed = h.context.runSceneLoad('entered', { isCurrentSession: () => true }); await tick();
  h.jobs.get('entered').work.reject(new Error('failed initial load')); await failed;
  // enterWorld continues after the attempt and places the current model from
  // the server packet. Its original load options had keepCharPos:false.
  const position = { x: -84138 * 0.01, y: -37.557, z: -240470 * 0.01,
    copy() { assert.fail('resource retry must never choose the scene center'); } };
  h.context.character = { group: { position }, clearTarget() {} };
  h.context.selfServerPosition = { x: -84138, y: 240470, z: -3720 };
  const retry = h.noticesDom[0].children[1].events.click(); await tick();
  h.jobs.get('entered').work.resolve(); await retry;
  assert.equal(position.x, -841.38);
  assert.equal(position.z, -240470 * 0.01);
  assert.equal(position.y, -37.2);
  assert.deepEqual(h.jobs.get('entered').groundQuery, [-841.38, -240470 * 0.01, -37.2]);
});

test('online retry cannot reuse a stale server floor hint from different XY', async () => {
  const h = harness();
  h.context.online = true;
  const failed = h.context.runSceneLoad('entered', { groundHintY: 999 }); await tick();
  h.jobs.get('entered').work.reject(new Error('failed')); await failed;
  const position = { x: 1, y: 2, z: 3, copy() { assert.fail('scene-center spawn'); } };
  h.context.character = { group: { position }, clearTarget() {} };
  h.context.selfServerPosition = { x: 1000, y: -300, z: 99900 };
  const retry = h.noticesDom[0].children[1].events.click(); await tick();
  h.jobs.get('entered').work.resolve(); await retry;
  assert.deepEqual(h.jobs.get('entered').groundQuery, [1, 3, 2]);
  assert.equal(position.y, 2);
});

test('online retry selects the current position hint after its resources finish loading', async () => {
  const h = harness();
  h.context.online = true;
  const failed = h.context.runSceneLoad('entered'); await tick();
  h.jobs.get('entered').work.reject(new Error('failed')); await failed;
  const position = { x: 1, y: 2, z: 3, copy() { assert.fail('scene-center spawn'); } };
  h.context.character = { group: { position }, clearTarget() {} };
  h.context.selfServerPosition = { x: 100, y: -300, z: 900 };
  const retry = h.noticesDom[0].children[1].events.click(); await tick();
  Object.assign(position, { x: 4, y: 5, z: 6 });
  h.context.selfServerPosition = { x: 400, y: -600, z: 700 };
  h.jobs.get('entered').work.resolve(); await retry;
  assert.deepEqual(h.jobs.get('entered').groundQuery, [4, 6, 7]);
  assert.equal(position.x, 4); assert.equal(position.z, 6); assert.equal(position.y, 7);
});

test('online retry after walking to another tile preserves Y without querying foreign terrain', async () => {
  const h = harness();
  h.context.online = true;
  const failed = h.context.runSceneLoad('entered'); await tick();
  h.jobs.get('entered').work.reject(new Error('failed')); await failed;
  const position = { x: 1, y: 2, z: 3, copy() { assert.fail('scene-center spawn'); } };
  h.context.character = { group: { position }, clearTarget() {} };
  const retry = h.noticesDom[0].children[1].events.click(); await tick();
  // A real server position is known, but belongs to a different tile. It
  // cannot make the newly loaded tile's clamped height query valid here.
  Object.assign(position, { x: 4, y: 5, z: 6 });
  h.context.selfServerPosition = { x: 400, y: -600, z: 700 };
  h.context.tileNameFor = () => 'other';
  h.jobs.get('entered').work.resolve(); await retry;
  assert.equal(h.jobs.get('entered').groundQuery, undefined);
  assert.equal(position.x, 4); assert.equal(position.z, 6); assert.equal(position.y, 5);
});

test('online retry with no server position retains the current local floor hint', async () => {
  const h = harness();
  h.context.online = true;
  const failed = h.context.runSceneLoad('entered', { groundHintY: 999 }); await tick();
  h.jobs.get('entered').work.reject(new Error('failed')); await failed;
  const position = { x: 1, y: 2, z: 3, copy() { assert.fail('scene-center spawn'); } };
  h.context.character = { group: { position }, clearTarget() {} };
  assert.equal(h.context.selfServerPosition, null);
  const retry = h.noticesDom[0].children[1].events.click(); await tick();
  h.jobs.get('entered').work.resolve(); await retry;
  assert.deepEqual(h.jobs.get('entered').groundQuery, [1, 3, 2]);
  assert.equal(position.y, 2);
});

test('online retry with unavailable current XY does not invent a tile or a ground sample', async () => {
  const h = harness();
  h.context.online = true;
  const failed = h.context.runSceneLoad('entered'); await tick();
  h.jobs.get('entered').work.reject(new Error('failed')); await failed;
  const position = { y: 5 };
  h.context.character = { group: { position }, clearTarget() {} };
  h.context.selfServerPosition = { x: 100, y: -300, z: 700 };
  h.context.tileNameFor = () => assert.fail('unavailable XY must not be mapped to a tile');
  const retry = h.noticesDom[0].children[1].events.click(); await tick();
  h.jobs.get('entered').work.resolve(); await retry;
  assert.equal(h.jobs.get('entered').groundQuery, undefined);
  assert.deepEqual(position, { y: 5 });
});

test('returning to a blocked tile after another scene succeeds restores an actionable notice without loading', async () => {
  const h = harness();
  const failed = h.context.runSceneLoad('broken', { automatic: true }); await tick();
  h.jobs.get('broken').work.reject(new Error('failed')); await failed;
  const staleButton = h.noticesDom[0].children[1];
  const other = h.context.runSceneLoad('other'); await tick();
  h.jobs.get('other').work.resolve(); await other;
  assert.equal(h.noticesDom.length, 0);
  assert.equal(staleButton.events.click(), undefined);
  const originalFetch = h.fetches.get('broken');
  const boundaryStart = main.indexOf('    if (!terrain.interior && !sceneLoading) {');
  const boundaryEnd = main.indexOf('\n    combat.update(entityHeadPos);', boundaryStart);
  Object.assign(h.context, { character: { group: { position: { x: 0, y: 0, z: 0 } } },
    availableScenes: ['broken', 'other'], threeToL2: p => p, tileNameFor: () => 'broken' });
  vm.runInNewContext('globalThis.runBoundary = () => {' + main.slice(boundaryStart, boundaryEnd) + '\n};', h.context);
  for (let frame = 0; frame < 5; frame++) h.context.runBoundary();
  assert.equal(h.context.pendingSceneSwitch, null);
  assert.equal(h.fetches.get('broken'), originalFetch);
  assert.equal(h.noticesDom.length, 1);
  assert.notEqual(h.noticesDom[0].children[1], staleButton);
  assert.equal(staleButton.events.click(), undefined, 'restoring a failure cannot revive a detached button');
  // No character is needed to verify the restored resource-retry action.
  h.context.character = null;
  const retry = h.noticesDom[0].children[1].events.click(); await tick();
  assert.notEqual(h.fetches.get('broken'), originalFetch);
  h.jobs.get('broken').work.resolve(); await retry;
  assert.equal(h.context.currentTile, 'broken');
});

test('ordinary pending crossing cannot ground a later teleport against the old destination', async () => {
  const h = harness();
  h.context.online = true;
  const position = { x: 1, y: 2, z: 3 };
  h.context.character = { group: { position }, clearTarget() {} };
  h.context.selfServerPosition = { x: 100, y: -300, z: 200 };
  const loading = h.context.runSceneLoad('entered', {
    automatic: true, keepCharPos: true, groundHintY: 2,
  });
  await tick();
  // A real teleport packet can arrive while the first tile is building and
  // queue its own destination. Completing the old request must preserve both.
  Object.assign(position, { x: 40, y: 50, z: 60 });
  h.context.selfServerPosition = { x: 4000, y: -6000, z: 5000 };
  h.context.tileNameFor = () => 'other';
  h.context.pendingSceneSwitch = { tile: 'other', hintY: 50 };
  h.jobs.get('entered').work.resolve(); await loading;
  assert.equal(h.context.currentTile, 'entered');
  assert.equal(h.jobs.get('entered').groundQuery, undefined);
  assert.deepEqual(position, { x: 40, y: 50, z: 60 });
  assert.deepEqual(h.context.pendingSceneSwitch, { tile: 'other', hintY: 50 });
});

test('ordinary online adoption discards an old floor hint after same-tile movement', async () => {
  const h = harness();
  h.context.online = true;
  const position = { x: 1, y: 2, z: 3 };
  h.context.character = { group: { position }, clearTarget() {} };
  h.context.selfServerPosition = { x: 100, y: -300, z: 900 };
  const loading = h.context.runSceneLoad('entered', {
    automatic: true, keepCharPos: true, groundHintY: 9,
  });
  await tick();
  // No new packet covers this locally advanced XY; its current floor is the
  // only applicable hint, even though the server's older Z was authoritative.
  Object.assign(position, { x: 4, y: 5, z: 6 });
  h.jobs.get('entered').work.resolve(); await loading;
  assert.deepEqual(h.jobs.get('entered').groundQuery, [4, 6, 5]);
  assert.deepEqual(position, { x: 4, y: 5, z: 6 });
});

test('ordinary online adoption uses the latest matching teleport height after loading', async () => {
  const h = harness();
  h.context.online = true;
  const position = { x: 1, y: 2, z: 3 };
  h.context.character = { group: { position }, clearTarget() {} };
  h.context.selfServerPosition = { x: 100, y: -300, z: 200 };
  const loading = h.context.runSceneLoad('entered', {
    automatic: true, keepCharPos: true, groundHintY: 2,
  });
  await tick();
  Object.assign(position, { x: 4, y: 5, z: 6 });
  h.context.selfServerPosition = { x: 400, y: -600, z: 700 };
  h.jobs.get('entered').work.resolve(); await loading;
  assert.deepEqual(h.jobs.get('entered').groundQuery, [4, 6, 7]);
  assert.deepEqual(position, { x: 4, y: 7, z: 6 });
});
