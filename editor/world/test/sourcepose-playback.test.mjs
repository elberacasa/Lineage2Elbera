// Elbera Tools: actual Character methods, real Three mixer, authored source data.
// No original client assets, renderer, browser, gateway or game account required.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three.module.min.js';
import { createOriginalPosePlayback } from '../js/sourcepose-playback.js';
import { sampleOriginalTrack } from '../js/nativetrack.js';
import { waitSequence, createWaitSequence, advanceWaitPlayback } from '../js/waitanim.js';
import { createCastPlayback, advanceCastPlayback, closeSourceLoop } from '../js/castplayback.js';
import { directNotifySound } from '../js/animnotify-clock.js';
import { castSchedule } from '../js/castanim.js';

const text = fs.readFileSync(new URL('../js/character.js', import.meta.url), 'utf8');
const classStart = text.indexOf('export class Character {');
assert.ok(classStart > 0, 'production Character class boundary');
const f = Math.fround;
const terrain = { heightAtWorld: () => 0 };
const near = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-7,
  `${label}: ${actual} versus ${expected}`);
function characterClass(extra = {}) {
  return vm.runInNewContext(text.slice(classStart).replace('export class Character', 'class Character') + '\nCharacter;', {
    THREE, waitSequence, createWaitSequence, advanceWaitPlayback,
    createCastPlayback, advanceCastPlayback, closeSourceLoop, directNotifySound, createOriginalPosePlayback,
    performance: { now: () => 0 }, audio: { playAt() {} },
    DEFAULT_RUN_SPEED_L2: 115, DEFAULT_WALK_SPEED_L2: 80, L2_TO_M: .01,
    DEFAULT_ATK_SPD_MUL: 1, MOVE_TICK_S: .1, TURN_RATE: 10,
    ...extra,
  });
}

function fixture(extra = {}) {
  const Character = characterClass(extra), ch = new Character();
  const model = new THREE.Group(), bone = new THREE.Bone();
  bone.name = 'Root'; bone.userData.name = 'Root'; model.add(bone);
  ch.model = model; ch.group.add(model); ch.mixer = new THREE.AnimationMixer(model);
  ch.modelId = 'fixture';
  const bones = [{ name: 'Root', parent: 0 }];
  const catalog = { format: 'elbera-original-animation-tracks-v1', modelId: 'fixture',
    animationRef: 'Fixture.Anim', source: { packageSHA256: 'a'.repeat(64), exportSHA256: 'b'.repeat(64) },
    bones, sequences: [] };
  const skeleton = { format: 'elbera-original-player-skeleton-v1', modelId: 'fixture', animationRef: 'Fixture.Anim',
    source: { packageSHA256: 'a'.repeat(64), animationExportSHA256: 'b'.repeat(64) }, animationBones: bones,
    bones: [{ ...bones[0], position: [0, 0, 0], orientation: [0, 0, 0, 1] }], trackBindings: [0] };
  const slots = {}, clips = {}, sourceByClip = new Map();
  for (const [clip, base] of [['idle', 100], ['sitDown', 200], ['sitWait', 300], ['standUp', 400],
    ['cast', 500], ['run', 600], ['walk', 700], ['gesture', 800]]) {
    const seq = `Original_${clip}`;
    // The source movement duration is intentionally different from N/R.
    // Substituting inspector seconds for normalized channel frame is detectable.
    const track = { flags: 0, times: [0, 5], quaternions: [[0, 0, 0, 1], [0, 0, 0, 1]],
      positions: [[base, 0, 0], [base + 200, 0, 0]] };
    const source = { name: seq, frames: 6, rate: 5,
      movement: { flags: 0, startBone: 0, boneIndices: [], duration: 10, tracks: [track] } };
    catalog.sequences.push(source); sourceByClip.set(clip, source);
    slots[clip] = { hand: { clip, seq } };
    clips[clip] = { seq, originalTiming: true, frames: 6, rate: 5, notifies: [] };
    const times = Array.from({ length: 6 }, (_, i) => f(i / 5));
    ch.actions[clip] = ch.mixer.clipAction(new THREE.AnimationClip(clip, 1,
      [new THREE.VectorKeyframeTrack('Root.position', times, times.flatMap(t => [base / 10 + t, 0, 0]))]));
  }
  ch.waitTable = { models: { fixture: { slots, rates: { sit: 1, stand: 1 } } }, clips: { fixture: clips } };
  ch.originalPose = createOriginalPosePlayback(model, { catalog, skeleton });
  const expectedX = (clip, frame) => {
    const source = sourceByClip.get(clip);
    return sampleOriginalTrack(source.movement.tracks[0], source.movement.duration, frame).position[0] * .01;
  };
  const tick = (dt, move = null) => { ch.update(dt, terrain, move); ch.group.updateMatrixWorld(true); };
  return { ch, bone, model, catalog, skeleton, sourceByClip, expectedX, tick,
    plan: clip => ({ seq: `Original_${clip}`, frames: 6, sourceRate: 5 }),
    cast: (options = {}) => ({ status: 'ready', rate: 1, tween: 0,
      phases: [{ seq: 'Original_cast', clip: 'cast', frames: 6, sourceRate: 5,
        sourceEndpoint: 1, due: 10, loop: false, notifies: [], ...options }] }),
  };
}

function readyWait(h) {
  assert.equal(h.ch.setWaitType(1, { snapshot: true, initial: true }).status, 'ready');
  h.tick(.3);
  assert.equal(h.ch.lastOriginalPose.status, 'ready');
  assert.equal(h.bone.matrixAutoUpdate, false);
}

test('actual standing wait samples exact normalized channel frame, not playback seconds', () => {
  const h = fixture(); readyWait(h);
  const frame = h.ch.nativeWait.channel.frame;
  assert.equal(h.ch.lastOriginalPose.frame, frame);
  assert.notEqual(frame, h.ch.lastWaitPhase.sampleTime);
  near(h.bone.matrix.elements[12], h.expectedX('idle', frame));
  assert.ok(Math.abs(h.bone.matrix.elements[12] - h.expectedX('idle', h.ch.lastWaitPhase.sampleTime)) > .01);
  assert.ok(h.bone.position.x > 10, 'exported mixer TRS remains independent of source display');
  // An unchanged clock still needs to restore and reapply the source owner.
  h.tick(0); near(h.bone.matrix.elements[12], h.expectedX('idle', frame));
});

test('actual cast passes source identity and exact phase frame through the production mixer', () => {
  const h = fixture(); assert.equal(h.ch.startCastSchedule(h.cast()).status, 'ready');
  h.tick(.01); h.tick(.3);
  const frame = h.ch.nativeCast.frame;
  assert.equal(h.ch.lastOriginalPose.sequence, 'Original_cast');
  assert.equal(h.ch.lastOriginalPose.frame, frame);
  near(h.bone.matrix.elements[12], h.expectedX('cast', frame));
  assert.notEqual(frame, h.ch.lastCastPhase.sampleTime);
  assert.ok(h.bone.position.x > 50, 'source overlay must not write mixer TRS');
});

test('negative wait interval stays exported and resumes original sampling only at a nonnegative frame', () => {
  const h = fixture();
  assert.equal(h.ch.setWaitType(0, { snapshot: true }).status, 'ready');
  h.tick(.05);
  assert.ok(h.ch.nativeWait.channel.frame < 0);
  assert.equal(h.ch.lastOriginalPose.status, 'unsupported');
  assert.equal(h.ch.lastOriginalPose.reason, 'native-transition-cache-not-yet-admitted');
  assert.equal(h.bone.matrixAutoUpdate, true);
  near(h.bone.matrix.elements[12], h.bone.position.x);
  h.tick(.3);
  const frame = h.ch.nativeWait.channel.frame;
  assert.ok(frame >= 0); assert.equal(h.ch.lastOriginalPose.status, 'ready');
  assert.equal(h.bone.matrixAutoUpdate, false);
  near(h.bone.matrix.elements[12], h.expectedX('sitWait', frame));
});

test('source clock mismatch or missing sequence restores the previous overlay and never relabels exports', () => {
  for (const override of [{ seq: 'Missing' }, { seq: undefined }, { frames: 7 }]) {
    const h = fixture(); readyWait(h);
    const result = h.ch.originalPose.select({ ...h.plan('idle'), ...override });
    assert.equal(result.status, 'unsupported');
    assert.equal(h.bone.matrixAutoUpdate, true);
    h.model.updateMatrixWorld(true); near(h.bone.matrix.elements[12], h.bone.position.x);
    assert.equal(h.ch.originalPose.apply(.5).status, 'unsupported');
    assert.equal(h.bone.matrixAutoUpdate, true);
  }
  const h = fixture(); readyWait(h);
  assert.equal(h.ch.startCastSchedule(h.cast({ seq: 'Missing' })).status, 'ready', 'clock and pose admission stay separate');
  h.tick(.01); h.tick(.1);
  assert.equal(h.ch.lastOriginalPose.status, 'unsupported');
  assert.equal(h.bone.matrixAutoUpdate, true);
  near(h.bone.matrix.elements[12], h.bone.position.x);
});

test('movement, direct play, cancellation and one-shot retire source matrix ownership', () => {
  for (const [name, retire] of [
    ['movement', h => h.tick(.1, new THREE.Vector3(1, 0, 0))],
    ['cancel', h => h.ch.cancelCast()],
    ['oneShot', h => h.ch.oneShotExact('gesture', 0)],
    ['play', h => h.ch.play('run', 0)],
  ]) {
    const h = fixture(); readyWait(h); retire(h);
    assert.equal(h.bone.matrixAutoUpdate, true, name);
    assert.equal(h.ch.originalPose.status.status, 'idle', name);
    h.model.updateMatrixWorld(true); near(h.bone.matrix.elements[12], h.bone.position.x, name);
    if (name !== 'play') assert.equal(h.ch.nativeWait, null, name);
  }
});

test('normal cast completion retires matrices before ordinary idle resumes', () => {
  const h = fixture(); h.ch.startCastSchedule(h.cast({ due: .1 }));
  h.tick(.01); h.tick(.1);
  assert.equal(h.ch.nativeCast !== null, true); assert.equal(h.bone.matrixAutoUpdate, false);
  h.tick(.01);
  assert.equal(h.ch.nativeCast, null); assert.equal(h.ch.lastCastError, null);
  assert.equal(h.ch.originalPose.status.status, 'idle');
  assert.equal(h.bone.matrixAutoUpdate, true);
  near(h.bone.matrix.elements[12], h.bone.position.x);
});

test('same-tick wait successor uses each segment identity/frame and restores for its unresolved tween', () => {
  const h = fixture(), observed = [];
  const apply = h.ch.originalPose.apply.bind(h.ch.originalPose);
  h.ch.originalPose.apply = frame => {
    const result = apply(frame);
    observed.push({ ...result, inputFrame: frame, x: h.bone.matrix.elements[12], auto: h.bone.matrixAutoUpdate });
    return result;
  };
  h.ch.setWaitType(0); h.tick(1.2);
  assert.equal(h.ch.lastWaitPhase.clip, 'sitWait');
  const ending = observed.find(row => row.sequence === 'Original_sitDown' && row.status === 'ready');
  assert.ok(ending, 'old segment must sample before successor');
  near(ending.x, h.expectedX('sitDown', ending.inputFrame));
  assert.equal(ending.inputFrame, f(1 - 1 / 6));
  const successor = observed.find(row => row.sequence === 'Original_sitWait');
  assert.ok(successor.inputFrame < 0);
  assert.equal(successor.reason, 'native-transition-cache-not-yet-admitted');
  assert.equal(successor.auto, true);
  assert.equal(h.bone.matrixAutoUpdate, true);
});

test('wait observer cancellation prevents a later segment or final update from restoring stale source matrices', () => {
  const h = fixture(), seen = [];
  h.ch.waitTable.clips.fixture.sitDown.notifies = [{ t: f(.2), objectRef: 0,
    function: 'None', isAttackShot: false, isBoneScale: false }];
  h.ch.onWaitNotify = () => {
    seen.push(h.ch.originalPose.status.sequence);
    h.ch.cancelCast();
  };
  h.ch.setWaitType(0); h.tick(2);
  assert.deepEqual(seen, ['Original_sitDown']);
  assert.equal(h.ch.nativeWait, null);
  assert.equal(h.ch.originalPose.status.status, 'idle');
  assert.equal(h.bone.matrixAutoUpdate, true);
  h.tick(.1); assert.equal(h.bone.matrixAutoUpdate, true);
});

test('actual model replacement waits for its paired source result and retires old matrix ownership', async () => {
  for (const available of [true, false]) {
    const next = fixture();
    next.model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial()));
    const gltf = { scene: next.model, animations: Object.values(next.ch.actions).map(action => action.getClip()) };
    let release, reject;
    const delivery = new Promise((resolve, fail) => { release = resolve; reject = fail; });
    const h = fixture({
      charManifest: async () => [{ id: 'fixture' }], pawnAnim: async () => next.ch.waitTable,
      playerVisualScale: () => ({ x: 1, y: 1, z: 1 }),
      GLTFLoader: class { setRequestHeader() { return this; } async loadAsync() { return gltf; } },
      fetchOriginalAnimationBundle: () => delivery, detachArmor() {},
    });
    readyWait(h);
    const oldPlayback = h.ch.originalPose, oldModel = h.model;
    const loading = h.ch.load('/characters/models/fixture.gltf');
    await Promise.resolve(); await Promise.resolve();
    assert.equal(h.ch.model, oldModel, 'unresolved pair must not partially adopt the new model');
    assert.equal(h.ch.originalPose, oldPlayback);
    if (available) release({ catalog: next.catalog, skeleton: next.skeleton });
    else reject(new Error('source fixture unavailable'));
    await loading;
    assert.equal(h.bone.matrixAutoUpdate, true, 'discarded skeleton cannot retain manual source matrices');
    assert.equal(oldPlayback.status.status, 'idle');
    assert.equal(oldModel.parent, null);
    assert.equal(h.ch.model, next.model);
    assert.equal(next.bone.matrixAutoUpdate, true);
    if (available) {
      assert.notEqual(h.ch.originalPose, oldPlayback);
      assert.equal(h.ch.setWaitType(1, { snapshot: true, initial: true }).status, 'ready');
      h.tick(.3); assert.equal(next.bone.matrixAutoUpdate, false);
      assert.equal(h.bone.matrixAutoUpdate, true);
    } else {
      assert.equal(h.ch.originalPose, null);
      assert.equal(h.ch.lastOriginalPose.status, 'unsupported');
      assert.match(h.ch.lastOriginalPose.reason, /source fixture unavailable/);
    }
    next.model.traverse(node => { node.geometry?.dispose(); node.material?.dispose(); });
  }
});

test('real castSchedule preserves original sequence names through the native planner and Character', () => {
  const h = fixture(), table = h.ch.waitTable;
  table.format = 'l2-interlude-pawn-animation-v2';
  for (const [slot, clip] of [['castShort', 'idle'], ['castEnd', 'sitWait'], ['magicShot', 'cast']]) {
    table.models.fixture.slots[slot] = { hand: { clip, seq: `Original_${clip}` } };
  }
  const schedule = castSchedule(table, 'fixture', 'hand', { anim: 'B', style: 2 },
    { hitTimeMs: 5000, speedRate: 1, agent: { status: 'source-none' } });
  assert.equal(schedule.status, 'ready');
  assert.deepEqual(schedule.phases.map(phase => phase.seq), ['Original_idle', 'Original_sitWait', 'Original_cast']);
  assert.deepEqual(schedule.phases.map(phase => phase.slot), ['castShort', 'castEnd', 'magicShot']);
  assert.equal(h.ch.startCastSchedule(schedule).status, 'ready');
  h.tick(.01); h.tick(.3);
  assert.equal(h.ch.lastOriginalPose.status, 'ready');
  assert.equal(h.ch.lastOriginalPose.sequence, 'Original_idle');
  near(h.bone.matrix.elements[12], h.expectedX('idle', h.ch.nativeCast.frame));
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('older actual load cannot replace a newer model, source rig or displayed pose after either await', async () => {
  for (const delayedAt of ['metadata', 'asset-pair']) {
    const assets = new Map(), table = { models: {}, clips: {} };
    for (const [id, offset] of [['fixture_a', 0], ['fixture_b', 1000]]) {
      const item = fixture();
      item.catalog.modelId = item.skeleton.modelId = id;
      item.catalog.animationRef = item.skeleton.animationRef = `${id}.Anim`;
      for (const sequence of item.catalog.sequences) {
        for (const position of sequence.movement.tracks[0].positions) position[0] += offset;
      }
      item.model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial()));
      item.gltf = { scene: item.model, animations: Object.values(item.ch.actions).map(action => action.getClip()) };
      table.models[id] = item.ch.waitTable.models.fixture;
      table.clips[id] = item.ch.waitTable.clips.fixture;
      assets.set(id, item);
    }
    const metadataA = deferred(), gltfA = deferred(), sourceA = deferred(), firstPairStarted = deferred();
    const manifest = [...assets.keys()].map(id => ({ id })), requests = [];
    let manifestReads = 0;
    const h = fixture({
      charManifest: () => ++manifestReads === 1 && delayedAt === 'metadata' ? metadataA.promise : Promise.resolve(manifest),
      pawnAnim: async () => table,
      playerVisualScale: (_, expected) => {
        assert.equal(expected.gltf, `models/${expected.modelId}.gltf`);
        return { x: 1, y: 1, z: 1 };
      },
      GLTFLoader: class {
        setRequestHeader() { return this; }
        loadAsync(url) {
          const id = url.split('/').pop().replace('.gltf', ''); requests.push(['gltf', id]);
          return id === 'fixture_a' ? gltfA.promise : Promise.resolve(assets.get(id).gltf);
        }
      },
      fetchOriginalAnimationBundle: id => {
        requests.push(['source', id]);
        const item = assets.get(id);
        assert.equal(item.catalog.modelId, id, 'source bundle requested for the same model as glTF');
        if (id === 'fixture_a') firstPairStarted.resolve();
        return id === 'fixture_a' ? sourceA.promise : Promise.resolve({ catalog: item.catalog, skeleton: item.skeleton });
      },
      detachArmor() {},
    });
    const oldLoad = h.ch.load('/characters/models/fixture_a.gltf');
    if (delayedAt === 'asset-pair') await firstPairStarted.promise;
    await h.ch.load('/characters/models/fixture_b.gltf');
    assert.equal(h.ch.setWaitType(1, { snapshot: true, initial: true }).status, 'ready'); h.tick(.3);
    const newer = assets.get('fixture_b'), newRig = h.ch.originalPose, newMixer = h.ch.mixer;
    const newPose = newer.bone.matrix.clone(), newFrame = h.ch.lastOriginalPose.frame;
    assert.equal(newer.bone.matrixAutoUpdate, false);
    assert.equal(h.ch.lastOriginalPose.status, 'ready');
    const old = assets.get('fixture_a');
    metadataA.resolve(manifest); gltfA.resolve(old.gltf);
    sourceA.resolve({ catalog: old.catalog, skeleton: old.skeleton });
    await oldLoad;
    assert.equal(h.ch.modelId, 'fixture_b'); assert.equal(h.ch.model, newer.model);
    assert.equal(h.ch.originalPose, newRig); assert.equal(h.ch.mixer, newMixer);
    assert.equal(h.ch.nativeWait.channel.frame, newFrame);
    assert.ok(newer.bone.matrix.equals(newPose)); assert.equal(newer.bone.matrixAutoUpdate, false);
    assert.equal(old.model.parent, old.ch.group, 'retired candidate was never adopted');
    assert.equal(old.bone.matrixAutoUpdate, true);
    assert.deepEqual(requests, delayedAt === 'metadata' ? [['gltf', 'fixture_b'], ['source', 'fixture_b']]
      : [['gltf', 'fixture_a'], ['source', 'fixture_a'], ['gltf', 'fixture_b'], ['source', 'fixture_b']]);
    h.ch.cancelCast();
    for (const item of assets.values()) item.model.traverse(node => { node.geometry?.dispose(); node.material?.dispose(); });
  }
});
