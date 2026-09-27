// Elbera Tools: independent source-free review of actual Character methods
// with a real Three animation mixer. No browser or private game assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createCastPlayback, advanceCastPlayback, closeSourceLoop } from '../js/castplayback.js';
import { directNotifySound } from '../js/animnotify-clock.js';

const THREE = await import('../vendor/three.module.min.js');
const source = fs.readFileSync(new URL('../js/character.js', import.meta.url), 'utf8');
const start = source.indexOf('  cancelCast() {');
const end = source.indexOf('  /**\n   * One attack swing', start);
assert.ok(start >= 0 && end > start, 'actual Character cast-method boundary');
const methods = audio => vm.runInNewContext(`class ReviewedCharacter {${source.slice(start, end)}}; ReviewedCharacter.prototype`, {
  createCastPlayback, advanceCastPlayback, closeSourceLoop, directNotifySound, audio, performance: { now: () => 0 },
});

function schedule({ frames = 2, rate = 1, tween = Math.fround(.2) } = {}) {
  return { status: 'ready', rate: 1, tween,
    phases: [{ notifies: [], clip: 'source', frames, sourceRate: rate,
      sourceDuration: frames / rate, sourceEndpoint: (frames - 1) / rate, due: 5, loop: false }] };
}
function character(values = [10, 0, 0, 10, 0, 0]) {
  const sounds = [];
  const model = new THREE.Group(), bone = new THREE.Bone();
  bone.name = 'sourceBone'; model.add(bone);
  const mixer = new THREE.AnimationMixer(model);
  const clip = new THREE.AnimationClip('source', 1, [new THREE.VectorKeyframeTrack('sourceBone.position', [0, 1], values)]);
  const ch = Object.assign(Object.create(methods({playAt:(ref,position,options)=>sounds.push({ref,position,options})})),
    { group:model, model, mixer, actions: { source: mixer.clipAction(clip) }, emoteUntil: 0 });
  return { ch, bone, sounds, step(dt) { ch._advanceCastSchedule(dt); mixer.update(dt); ch._applyCastTween(); } };
}

test('positive tween setup retains the native unrounded multiplication before reciprocal store', () => {
  const state = createCastPlayback(schedule({ frames: 13, rate: 30 }));
  advanceCastPlayback(state, 0);
  assert.equal(state.tweenRate, 0.38461539149284363);
});

test('constant destination tracks reach their first pose when a tween crosses into positive source time', () => {
  const h = character();
  assert.equal(h.ch.startCastSchedule(schedule()).status, 'ready');
  h.step(.01);
  assert.ok(Math.abs(h.bone.position.x) < .000001);
  h.step(.1);
  assert.ok(h.bone.position.x > 4.9 && h.bone.position.x < 5.1);
  h.step(.2);
  assert.ok(h.ch.lastCastPhase.sampleTime > 0);
  assert.equal(h.bone.position.x, 10, 'mixer cache must not leave the previous partial tween on a constant track');
});

test('a moving destination track keeps the positive-time remainder after tween completion', () => {
  const h = character([10, 0, 0, 20, 0, 0]);
  h.ch.startCastSchedule(schedule()); h.step(.01); h.step(.1); h.step(.2);
  const expected = 10 + 10 * h.ch.lastCastPhase.sampleTime;
  assert.ok(Math.abs(h.bone.position.x - expected) < .000001);
});

test('source loop closure preserves old keys and evaluates the added closing interval', () => {
  const original = new THREE.AnimationClip('loop', 1, [new THREE.VectorKeyframeTrack('sourceBone.position',
    [0, .5, 1], [1, 0, 0, 2, 0, 0, 4, 0, 0])]);
  const loop = closeSourceLoop(original, 3, 2);
  assert.equal(original.duration, 1);
  assert.deepEqual([...original.tracks[0].times], [0, .5, 1]);
  assert.deepEqual([...loop.tracks[0].times], [0, .5, 1, 1.5]);
  assert.deepEqual([...loop.tracks[0].values.slice(0, 9)], [...original.tracks[0].values]);
  const model = new THREE.Group(), bone = new THREE.Bone(); bone.name = 'sourceBone'; model.add(bone);
  const mixer = new THREE.AnimationMixer(model), action = mixer.clipAction(loop);
  action.play(); action.paused = true; action.time = 1.25; mixer.update(0);
  assert.equal(bone.position.x, 2.5);
});

test('single-frame source sequences are unsupported by the ordinary playback path', () => {
  const h = character();
  h.ch.actions.source = h.ch.mixer.clipAction(new THREE.AnimationClip('one-frame', 0,
    [new THREE.VectorKeyframeTrack('sourceBone.position', [0], [10, 0, 0])]));
  assert.equal(h.ch.startCastSchedule(schedule({ frames: 1, rate: 30 })).status, 'unsupported');
});

test('invalid or unrepresentable cast clocks cannot replace a running verified cast', () => {
  const h = character();
  assert.equal(h.ch.startCastSchedule(schedule()).status, 'ready');
  const current = h.ch.nativeCast;
  const invalid = [
    {...schedule(), tween: NaN}, {...schedule(), tween: -.2},
    {...schedule(), tween: 1e-46}, {...schedule(), tween: Math.fround(1e-45)},
    {...schedule(), rate: Infinity}, {...schedule(), rate: 1e-46},
    {...schedule(), phases: [null]},
  ];
  for (const values of [{sourceRate:NaN}, {sourceRate:0}, {sourceRate:Math.fround(1e-45)},
    {sourceEndpoint:Infinity}, {sourceEndpoint:0}, {due:NaN}, {loop:'false'}]) {
    const input = schedule(); input.phases[0] = {...input.phases[0], ...values}; invalid.push(input);
  }
  for (const input of invalid) {
    assert.equal(createCastPlayback(input), null);
    assert.equal(h.ch.startCastSchedule(input).status, 'unsupported');
    assert.equal(h.ch.nativeCast, current, 'rejected metadata cannot retire an active cast');
  }
  assert.equal(createCastPlayback(schedule(), {notifiesEnabled:'true'}), null);
  const skipped = schedule(); skipped.phases[0].due = -1;
  assert.ok(createCastPlayback(skipped), 'native nonpositive phase deadlines remain valid skipped phases');
});

test('elapsed-time overflow retires playback without exposing a nonfinite sample', () => {
  const input = schedule({tween:0}); input.phases[0].due = Math.fround(3.3e38);
  const state = createCastPlayback(input);
  Object.assign(state, {phaseIndex:0, elapsed:Math.fround(3e38), phaseElapsed:Math.fround(3e38),
    frame:.5, frameRate:0, tweenRate:0, initialTween:0});
  const elapsed = state.elapsed;
  const result = advanceCastPlayback(state, Math.fround(1e38));
  assert.deepEqual(result, {done:true, unsupported:'nonfinite-cast-clock'});
  assert.equal(result.sampleTime, undefined);
  assert.equal(state.elapsed, elapsed);
  assert.equal(state.done, true);
});

const soundNotify = t => ({ t, objectRef:1, function:'None', isAttackShot:false, isBoneScale:false,
  isSound:true, classPath:'Engine.AnimNotify_Sound', sound:'Fixture.SourceSound',
  soundInfo:{status:'source-direct',volume:250,radius:30,random:100} });
function soundSchedule() {
  const plan=schedule({tween:0});plan.phases[0].notifies=[soundNotify(.2)];return plan;
}

test('normal completion keeps already-dispatched direct sound decode guards live', () => {
  const h=character(),plan=soundSchedule();plan.phases[0].due=.1;
  h.ch.startCastSchedule(plan);h.step(.2);h.step(.5);
  assert.equal(h.ch.nativeCast,null);assert.equal(h.ch.lastCastError,null);
  assert.equal(h.sounds.length,1);assert.equal(h.sounds[0].options.isCurrent(),true);
});

test('explicit cancellation and accepted cast replacement retire earlier direct sound decode guards', () => {
  for(const retire of [ch=>ch.cancelCast(),ch=>ch.startCastSchedule(schedule())]) {
    const h=character();h.ch.startCastSchedule(soundSchedule());h.step(.1);h.step(.5);
    assert.equal(h.sounds.length,1);assert.equal(h.sounds[0].options.isCurrent(),true);
    retire(h.ch);assert.equal(h.sounds[0].options.isCurrent(),false);
  }
});

test('unsupported channel retirement invalidates earlier direct sound decode guards', () => {
  const h=character(),plan=soundSchedule();
  plan.phases[0].notifies.push(...[.4,.5].map(t=>({t,objectRef:2,function:'None',isAttackShot:true,isBoneScale:false})));
  h.ch.startCastSchedule(plan);h.step(.1);h.step(.5);
  assert.equal(h.sounds.length,1);assert.equal(h.sounds[0].options.isCurrent(),true);
  h.step(1);
  assert.equal(h.ch.nativeCast,null);assert.equal(h.ch.lastCastError,'unresolved-native-notify-removal');
  assert.equal(h.sounds[0].options.isCurrent(),false);
});
