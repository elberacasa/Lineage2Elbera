// Elbera Tools: actual entity/main methods with controlled model loading and
// timers. Source-free state tests; no claimed native visual effect parity.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/entities.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const classes = source.slice(source.indexOf('class NpcEntity {')).replace('export class EntityManager', 'class EntityManager');
function harness() {
  const timers = new Map(), children = new Set(), warnings = [];
  let nextTimer = 1, resolveManifest;
  const loading = new Promise(resolve => { resolveManifest = resolve; });
  const group = () => ({ position: { x: 0, y: 0, z: 0 }, rotation: {}, userData: {},
    material: { opacity: 1 }, scale: { set() {} }, add() {}, remove() {},
    traverse(fn) { fn({ isMesh: true, material: this.material }); } });
  const model = group();
  const context = vm.createContext({
    window: { __world: null },
    setTimeout: fn => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
    playDeathClip: actor => { actor.deathClips = (actor.deathClips || 0) + 1; return true; },
    monsterManifest: () => loading, npcMeshes: async () => ({ 9: { mesh: 'SourceModel' } }),
    npcVisualMeta: async () => ({}), npcVisualScale: () => ({ x: 1, y: 1, z: 1 }),
    loadNpcAnimationModel: async () => ({ gltf: { scene: model, animations: [] }, overrides: {} }),
    applyOriginalNpcMaterials: async () => {}, GLTFLoader: class {},
    mapAnimations: () => ({}),
    THREE: { Vector3: class {}, Box3: class {
      constructor() { this.min = { y: 0 }; }
      setFromObject() { return this; } getCenter() { return { x: 0, z: 0 }; } getSize() { return { y: 1 }; }
    }, AnimationMixer: class { clipAction() {} } },
    console: { warn: (...args) => warnings.push(args) },
  });
  const { EntityManager, NpcEntity } = vm.runInContext(classes + '\n({EntityManager,NpcEntity})', context);
  const manager = new EntityManager({ add: g => children.add(g), remove: g => children.delete(g) }, []);
  function npc(id = 7) {
    const entity = Object.assign(Object.create(NpcEntity.prototype), {
      id, npcId: 9, kind: 'npc', dead: false, group: group(), actions: null,
      target: null, label: null, capsuleMeshes: [], played: [],
      _play(state) { this.played.push(state); },
    });
    manager.entities.set(id, entity); children.add(entity.group);
    return entity;
  }
  return { manager, npc, timers, children, context, warnings, resolveManifest };
}

test('known zero, nonzero and missing corpse fields stay distinct on the exact entity', () => {
  const h = harness(), npc = h.npc();
  for (const [raw, expected] of [[0, false], [1, true], [2, true], [-1, true]]) {
    h.manager.die(7, { sweepableRaw: raw, sweepable: !expected });
    assert.equal(npc.sweepableRaw, raw); assert.equal(npc.sweepable, expected);
    assert.equal(npc.dead, true);
  }
  for (const raw of [undefined, null, '1', 1.5, 0x80000000]) {
    h.manager.die(7, { sweepableRaw: raw, sweepable: true });
    assert.equal(npc.sweepableRaw, null); assert.equal(npc.sweepable, null);
  }
});

test('duplicate death cannot leave an old fade callback that runs after revive', () => {
  const h = harness(), npc = h.npc();
  h.manager.die(7, { sweepableRaw: 1 });
  h.manager.die(7, { sweepableRaw: 2 });
  assert.equal(h.timers.size, 1); assert.equal(npc.sweepableRaw, 2);
  h.manager.revive(7);
  assert.equal(h.timers.size, 0); assert.equal(npc.dead, false);
  assert.equal(npc.sweepableRaw, null); assert.equal(npc.sweepable, null);
  assert.equal(npc.group.material.opacity, 1);
});

test('death during actual NPC model loading survives adoption without adding a glow', async () => {
  const h = harness(), npc = h.npc(), work = npc.upgradeToMonster();
  h.manager.die(7, { sweepableRaw: 1 });
  assert.equal(npc.actions, null);
  h.resolveManifest([{ id: 'SourceModel' }]); await work;
  assert.equal(npc.sweepableRaw, 1); assert.equal(npc.sweepable, true); assert.equal(npc.dead, true);
  assert.equal(npc.played.at(-1), 'die'); assert.equal(npc.pickResourcesReady, true);
  assert.deepEqual(h.warnings, []);
});

test('revive while the NPC model loads leaves the adopted actor alive with no corpse metadata', async () => {
  const h = harness(), npc = h.npc(), work = npc.upgradeToMonster();
  h.manager.die(7, { sweepableRaw: 1 }); h.manager.revive(7);
  h.resolveManifest([{ id: 'SourceModel' }]); await work;
  assert.equal(npc.sweepableRaw, null); assert.equal(npc.dead, false);
  assert.equal(npc.played.at(-1), 'idle'); assert.equal(h.timers.size, 0);
});

test('missing actors and removed incarnations cannot transfer corpse metadata to a reused ID', async () => {
  const h = harness();
  h.manager.die(7, { sweepableRaw: 1 });
  const old = h.npc(), work = old.upgradeToMonster();
  assert.equal(old.sweepableRaw, undefined);
  h.manager.die(7, { sweepableRaw: 1 }); h.manager.remove(7);
  const fresh = h.npc();
  h.resolveManifest([{ id: 'SourceModel' }]); await work;
  assert.equal(h.manager.entities.get(7), fresh); assert.equal(fresh.dead, false);
  assert.equal(fresh.sweepableRaw, undefined); assert.equal(fresh.sweepable, undefined);
  for (const callback of h.timers.values()) callback();
  assert.equal(fresh.group.material.opacity, 1);
  h.manager.clear(); const nextSession = h.npc();
  assert.equal(nextSession.sweepableRaw, undefined);
});

test('self corpse metadata is retired on the existing authoritative revive path', () => {
  const h = harness(), character = { cancelCast() {}, play() {} };
  h.context.window.__world = { net: { selfId: 42 }, character };
  h.manager.die(42, { sweepableRaw: 0 });
  assert.equal(character.sweepableRaw, 0); assert.equal(character.sweepable, false);
  h.manager.revive(42);
  assert.equal(character.sweepableRaw, null); assert.equal(character.sweepable, null);
  assert.equal(character.dead, false);
});

test('actual main death handler forwards the received record to EntityManager', () => {
  const h = harness(), npc = h.npc(), handlers = new Map();
  Object.assign(h.context, { net: { on: (op, fn) => handlers.set(op, fn) },
    entityHeadPos: () => null, entities: h.manager, combat: { markDead() {} },
    selfId: 42, character: null });
  const start = main.indexOf("net.on('die', (msg) => {"), end = main.indexOf("net.on('revive',", start);
  assert.ok(start > 0 && end > start); vm.runInContext(main.slice(start, end), h.context);
  handlers.get('die')({ id: 7, sweepableRaw: -1, sweepable: true });
  assert.equal(npc.sweepableRaw, -1); assert.equal(npc.sweepable, true);
});
