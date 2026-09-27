#!/usr/bin/env node
// Offline loader/lifecycle regression tests using the exact browser Three.js.
// Run: node --test tools/world/test_world_loading.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

const vendor = new URL('../../editor/world/vendor/', import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'three') {
      return { url: new URL('three.module.min.js', vendor).href, shortCircuit: true };
    }
    if (specifier.startsWith('three/addons/')) {
      return { url: new URL(specifier.slice('three/'.length), vendor).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
globalThis.location = { search: '' };
const [THREE, { GLTFLoader }, { Terrain }, { NeighborTile, NeighborTiles }] = await Promise.all([
  import('three'), import('three/addons/loaders/GLTFLoader.js'),
  import('../../editor/world/js/terrain.js'), import('../../editor/world/js/neighbors.js'),
]);

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('prop templates overlap within a bound and retain source order, geometry and placements', async t => {
  const requests = [], templates = new Map();
  let active = 0, peak = 0;
  t.mock.method(GLTFLoader.prototype, 'loadAsync', url => {
    const work = deferred();
    active++;
    peak = Math.max(peak, active);
    requests.push({ url, ...work });
    return work.promise.finally(() => active--);
  });
  const placements = Array.from({ length: 9 }, (_, i) => ({
    gltf: `${i}.gltf`, position: [100 + i, 200, 300], rotation: [0, 0, 0], scale: [1, 1, 1],
  }));
  placements.push({ ...placements[0], position: [150, 200, 300] });
  const terrain = new Terrain({ props: placements }, '/fixture/');
  const loading = terrain._loadPropsInstanced(placements);
  await tick();
  assert.equal(requests.length, 4, 'first four independent templates start before any finishes');
  for (let offset = 0; offset < 9; offset += 4) {
    const batch = requests.slice(offset, offset + 4);
    assert.equal(batch.length, Math.min(4, 9 - offset));
    for (const request of batch.reverse()) {
      const scene = new THREE.Group();
      const geometry = new THREE.BoxGeometry();
      geometry.name = request.url;
      const material = new THREE.MeshBasicMaterial();
      scene.add(new THREE.Mesh(geometry, material));
      templates.set(request.url, { geometry, material });
      request.resolve({ scene });
    }
    await tick();
  }
  await loading;
  assert.equal(peak, 4);
  assert.equal(requests.length, 9, 'duplicate placements reuse one template load');
  assert.deepEqual(terrain.props.map(mesh => mesh.geometry.name),
    Array.from({ length: 9 }, (_, i) => `/fixture/${i}.gltf`));
  for (const mesh of terrain.props) {
    const source = templates.get(mesh.geometry.name);
    assert.equal(mesh.geometry, source.geometry);
    assert.equal(mesh.material, source.material);
  }
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  terrain.props[0].getMatrixAt(1, matrix);
  position.setFromMatrixPosition(matrix);
  assert.deepEqual(position.toArray(), [1.5, 3, -2], 'L2 source placement survives batching');
  terrain.dispose();
});

test('a failed prop template does not discard the other templates in its batch', async t => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async url => {
    if (url.endsWith('bad.gltf')) throw new Error('offline fixture missing');
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    return { scene };
  });
  const terrain = new Terrain({}, '/fixture/');
  await terrain._loadPropsInstanced(['first', 'bad', 'last'].map(name => ({ gltf: `${name}.gltf` })));
  assert.equal(terrain.props.length, 2);
  terrain.dispose();
});

test('tile disposal releases each instance buffer and each shared GPU resource exactly once', () => {
  const terrain = new Terrain({}, '/fixture/');
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  // Disposing a texture is safe; closing its decoded image needs separate
  // ownership proof. A shared bitmap must not be closed by this fix.
  let imageCloses = 0;
  const texture = new THREE.Texture({ close() { imageCloses++; } });
  material.map = texture;
  const counts = { instance: 0, geometry: 0, material: 0, texture: 0 };
  for (const [resource, name] of [[geometry, 'geometry'], [material, 'material'], [texture, 'texture']]) {
    resource.addEventListener('dispose', () => counts[name]++);
  }
  for (let i = 0; i < 3; i++) {
    const mesh = new THREE.InstancedMesh(geometry, material, 2);
    mesh.addEventListener('dispose', () => counts.instance++);
    terrain.group.add(mesh);
    terrain.props.push(mesh);
  }
  terrain.dispose();
  terrain.dispose();
  assert.deepEqual(counts, { instance: 3, geometry: 1, material: 1, texture: 1 });
  assert.equal(imageCloses, 0);
  assert.equal(terrain.group.children.length, 0);
  assert.equal(terrain.props.length, 0);
});

test('recenter retains and awaits a needed in-flight neighbor; only newest center stitches', async t => {
  const work = deferred(), stitches = [];
  let loads = 0;
  t.mock.method(NeighborTile.prototype, 'load', async function () {
    loads++;
    await work.promise;
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    this.group.add(this.mesh);
  });
  t.mock.method(NeighborTile.prototype, 'stitchTo', (center, dx, dy) => stitches.push([center, dx, dy]));
  const scene = new THREE.Scene(), neighbors = new NeighborTiles(scene, ['21_18']);
  const oldCenter = { heights: [1] }, newCenter = { heights: [2] };
  const first = neighbors.setCenter('20_18', oldCenter);
  const entry = neighbors.tiles.get('21_18');
  let latestReady = false;
  const latest = neighbors.setCenter('20_19', newCenter).then(() => { latestReady = true; });
  await tick();
  assert.equal(latestReady, false, 'reservation does not mean ready');
  assert.equal(loads, 1);
  work.resolve();
  await Promise.all([first, latest]);
  assert.equal(neighbors.tiles.get('21_18'), entry);
  assert.equal(entry._disposed, false);
  assert.equal(entry.group.parent, scene);
  assert.deepEqual(stitches, [[newCenter, 1, -1]]);
  await neighbors.disposeAll();
});

test('late failure of a dropped neighbor cannot delete its replacement', async t => {
  const jobs = [];
  t.mock.method(console, 'warn', () => {});
  t.mock.method(NeighborTile.prototype, 'load', async function () {
    const job = deferred();
    jobs.push(job);
    await job.promise;
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    this.group.add(this.mesh);
  });
  const scene = new THREE.Scene(), neighbors = new NeighborTiles(scene, ['21_18']);
  const first = neighbors.setCenter('20_18');
  const obsolete = neighbors.tiles.get('21_18');
  await neighbors.disposeAll();
  const latest = neighbors.setCenter('20_18');
  const replacement = neighbors.tiles.get('21_18');
  assert.notEqual(replacement, obsolete);
  jobs[0].reject(new Error('old request failed late'));
  await first;
  assert.equal(neighbors.tiles.get('21_18'), replacement);
  jobs[1].resolve();
  await latest;
  assert.equal(replacement.group.parent, scene);
  await neighbors.disposeAll();
});

test('late neighbor material is disposed when its tile is no longer needed', async t => {
  const data = new Uint16Array(4).buffer, work = deferred();
  t.mock.method(globalThis, 'fetch', async url => ({
    ok: true,
    json: async () => ({ gridSize: 2, heightmap: 'heightmap.u16' }),
    arrayBuffer: async () => data,
  }));
  const neighbor = new NeighborTile('21_18', '/fixture/');
  t.mock.method(neighbor, '_buildMaterial', () => work.promise);
  const loading = neighbor.load();
  await tick();
  neighbor.dispose();
  const texture = new THREE.Texture(), material = new THREE.MeshLambertMaterial({ map: texture });
  let textures = 0, materials = 0;
  texture.addEventListener('dispose', () => textures++);
  material.addEventListener('dispose', () => materials++);
  work.resolve(material);
  await assert.rejects(loading, { name: 'AbortError' });
  assert.equal(textures, 1);
  assert.equal(materials, 1);
  assert.equal(neighbor.group.children.length, 0);
  assert.equal(neighbor.mesh, null);
});
