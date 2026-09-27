// Real source rig/Three matrices with authored sparse tracks; no private assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.min.js';
import { createNpcSourceInspection } from '../js/npc-source-inspection.js';
import { sampleOriginalTrack } from '../js/nativetrack.js';

function fixture(shared) {
  const scene=new THREE.Group(),bone=new THREE.Bone();
  bone.name='Root';bone.position.set(7,8,9);scene.add(bone);scene.updateMatrixWorld(true);
  if (shared) return {scene,bone,source:shared,controller:createNpcSourceInspection(scene,shared)};
  const modelId='npc_'+'1'.repeat(32),meshRef='MeshPkg.Group.Creature',animationRef='AnimPkg.Original';
  const bones=[{name:'Root',parent:0,flags:0}];
  const track={flags:0,times:[0,5],positions:[[100,0,0],[300,0,0]],quaternions:[[0,0,0,1],[0,0,0,1]]};
  const constant={flags:0,times:[0],positions:[[900,0,0]],quaternions:[[0,0,0,1]]};
  const sequence=(name,frames,rate,duration,t)=>({name,frames,rate,movement:{flags:0,startBone:0,
    boneIndices:[0],duration,tracks:[t]}});
  const catalog={format:'elbera-original-animation-tracks-v1',modelId,meshRef,animationRef,bones,
    source:{packageSHA256:'a'.repeat(64),exportSHA256:'b'.repeat(64)},
    sequences:[sequence('Ordinary',6,5,10,track),sequence('DeathWait',1,30,1,constant)]};
  const sourceHashes={animationPackageSHA256:'a'.repeat(64),animationExportSHA256:'b'.repeat(64),
    meshPackageSHA256:'c'.repeat(64),meshExportSHA256:'d'.repeat(64)};
  const skeleton={format:'elbera-original-npc-skeleton-v1',modelId,meshRef,animationRef,
    bones:[{...bones[0],position:[0,0,0],orientation:[0,0,0,1]}],animationBones:bones,
    trackBindings:[0],source:sourceHashes};
  const record={modelId,model:{meshRef,animationRef,source:{...sourceHashes},built:{skinProof:{status:'unverified'}}}};
  const source={catalog,skeleton,record};
  return {scene,bone,source,track,controller:createNpcSourceInspection(scene,source)};
}
function snapshot(bone) {
  return {matrix:bone.matrix.elements.slice(),auto:bone.matrixAutoUpdate,
    position:bone.position.toArray(),quaternion:bone.quaternion.toArray(),scale:bone.scale.toArray()};
}

test('lists original timing without selecting aliases or inventing an automatic sequence',()=>{
  const h=fixture(),before=snapshot(h.bone);
  assert.deepEqual(h.controller.sequences,[{name:'Ordinary',frames:6,rate:5,duration:1.2},
    {name:'DeathWait',frames:1,rate:30,duration:1/30}]);
  assert.ok(Object.isFrozen(h.controller.sequences)&&Object.isFrozen(h.controller.sequences[0]));
  assert.equal(h.controller.applyFrame(0).status,'unsupported');
  assert.deepEqual(snapshot(h.bone),before);
  assert.equal(h.controller.status.scope,'manual-original-source-inspection');
  assert.equal(h.controller.status.skinWeights,'unverified');
});

test('manual source seconds map through frames/rate into sparse-track normalized frames',()=>{
  const h=fixture(),before=snapshot(h.bone);
  assert.equal(h.controller.select('ordinary').status,'selected');
  assert.deepEqual(snapshot(h.bone),before,'selection alone must not mutate a pose');
  const byTime=h.controller.applyTime(.3);
  assert.equal(byTime.frame,.25);assert.equal(byTime.duration,1.2);
  const expected=sampleOriginalTrack(h.track,10,.25).position[0]*.01;
  assert.equal(h.bone.matrix.elements[12],expected);
  assert.notEqual(expected,sampleOriginalTrack(h.track,10,.3).position[0]*.01,
    'inspection seconds must not accidentally become the normalized source frame');
  assert.equal(h.bone.matrixAutoUpdate,false);
  assert.deepEqual(h.bone.position.toArray(),before.position,'source display owns matrices, not mixer TRS');
  const displayed=h.bone.matrix.elements.slice();h.controller.applyFrame(.25);
  assert.deepEqual(h.bone.matrix.elements,displayed);
  h.controller.restore();assert.deepEqual(snapshot(h.bone),before);
});

test('one-frame DeathWait is inspected directly across its nonzero frames/rate interval',()=>{
  const h=fixture();h.controller.select('DeathWait');
  const poses=[];
  for (const seconds of [0,1/60,1/30]) {
    const status=h.controller.applyTime(seconds);assert.equal(status.status,'ready');
    poses.push(h.bone.matrix.elements.slice());
  }
  assert.deepEqual(poses[0],poses[1]);assert.deepEqual(poses[1],poses[2]);
  assert.equal(poses[0][12],9);
  assert.equal(h.controller.applyTime(1).status,'unsupported','no authored loop or clamp');
  assert.equal(h.bone.matrixAutoUpdate,true);
});

test('switch, failure and disposal restore the exact preinspection local matrix and mode',()=>{
  const h=fixture();h.bone.matrixAutoUpdate=false;
  h.bone.matrix.set(1,.25,0,11,0,1,.5,12,0,0,1,13,0,0,0,1);
  h.scene.updateMatrixWorld(true);const before=snapshot(h.bone);
  h.controller.select('Ordinary');h.controller.applyFrame(.5);
  h.controller.select('DeathWait');assert.deepEqual(snapshot(h.bone),before);
  h.controller.applyFrame(0);h.controller.select('Missing');assert.deepEqual(snapshot(h.bone),before);
  assert.match(h.controller.status.reason,/missing or ambiguous/);
  h.controller.select('Ordinary');h.controller.applyFrame(.25);
  assert.equal(h.controller.applyFrame(NaN).status,'unsupported');assert.deepEqual(snapshot(h.bone),before);
  h.controller.applyFrame(.5);h.controller.dispose();assert.deepEqual(snapshot(h.bone),before);
  h.controller.dispose();assert.deepEqual(snapshot(h.bone),before);
  assert.equal(h.controller.select('DeathWait').status,'disposed');
  assert.equal(h.controller.applyFrame(0).status,'disposed');assert.deepEqual(snapshot(h.bone),before);
});

test('shared immutable source data still owns independent actor poses and sequence choices',()=>{
  const first=fixture(),second=fixture(first.source),original=JSON.stringify(first.source);
  const beforeFirst=snapshot(first.bone),beforeSecond=snapshot(second.bone);
  first.controller.select('Ordinary');first.controller.applyFrame(.25);
  second.controller.select('DeathWait');second.controller.applyFrame(0);
  assert.notEqual(first.bone.matrix.elements[12],second.bone.matrix.elements[12]);
  first.controller.dispose();assert.deepEqual(snapshot(first.bone),beforeFirst);
  assert.equal(second.bone.matrixAutoUpdate,false);assert.equal(second.controller.status.sequence,'DeathWait');
  second.controller.dispose();assert.deepEqual(snapshot(second.bone),beforeSecond);
  assert.equal(JSON.stringify(first.source),original);
});

test('mismatched source/index and unsupported tracks cannot acquire display ownership',()=>{
  const h=fixture(),before=snapshot(h.bone);
  h.source.record.model.source.meshExportSHA256='e'.repeat(64);
  assert.throws(()=>createNpcSourceInspection(h.scene,h.source),/identities/);
  assert.deepEqual(snapshot(h.bone),before);
  const other=fixture();other.source.catalog.sequences[0].movement.flags=17;
  assert.equal(other.controller.select('Ordinary').status,'unsupported');
  assert.match(other.controller.status.reason,/ordinary source tracks/);
  assert.equal(other.bone.matrixAutoUpdate,true);
});

test('invalid frame/time inputs restore rather than silently clamp, wrap, coerce or keep the last pose',()=>{
  const h=fixture(),before=snapshot(h.bone);h.controller.select('Ordinary');
  for (const [method,value] of [['applyFrame',-0],['applyFrame',-.1],['applyFrame',1.01],
    ['applyFrame','0.5'],['applyTime',-0],['applyTime',Infinity],['applyTime',1.21]]) {
    h.controller.applyFrame(.25);
    assert.equal(h.controller[method](value).status,'unsupported');
    assert.deepEqual(snapshot(h.bone),before);
  }
});
