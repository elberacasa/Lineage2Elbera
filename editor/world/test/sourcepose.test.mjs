import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.min.js';
import { matchSourceBones, sourcePoseToExport, createOriginalPosePreview } from '../js/sourcepose.js';

function fixture() {
  const root = new THREE.Group();
  const source = [{name:'Root',parent:0},{name:'Left',parent:0},{name:'Finger',parent:1},
    {name:'Right',parent:0},{name:'Finger',parent:3}];
  const nodes = source.map((row, index) => {
    const bone = new THREE.Bone(); bone.name = row.name + index;
    bone.userData.name = row.name; return bone;
  });
  nodes.forEach((bone, index) => (source[index].parent === index ? root : nodes[source[index].parent]).add(bone));
  const movement = {flags:0,startBone:0,duration:2,boneIndices:[0,1,2,3,4],
    tracks:source.map(() => ({flags:0,times:[0,1],quaternions:[[0,0,0,1],[0,0,0,1]],
      positions:[[2,3,5],[4,7,9]]}))};
  const sequence = {name:'Original',rate:2,frames:2,movement};
  return {root,nodes,source,movement,sequence,catalog:{format:'elbera-original-animation-tracks-v1',bones:source,sequences:[sequence]}};
}

test('matches duplicate names by exact parent identity and preserved loader name', () => {
  const f = fixture();
  assert.deepEqual(matchSourceBones(f.root, f.source), f.nodes);
  f.source[2].name = 'FINGER';
  assert.deepEqual(matchSourceBones(f.root, f.source), f.nodes);
});

test('rejects renamed, missing, ambiguous and invalid source hierarchies without aliases', () => {
  for (const mutate of [f=>{f.source[4].name='Other';},f=>{f.source[1].parent=2;},
    f=>{f.source[0].parent=-1;},f=>{const duplicate=new THREE.Bone();duplicate.name='Finger';f.nodes[1].add(duplicate);}]) {
    const f = fixture(); mutate(f); assert.throws(() => matchSourceBones(f.root, f.source));
  }
});

test('raw source conversion retains both measured PSA mirror and glTF conversion', () => {
  assert.deepEqual(sourcePoseToExport([2,3,5],[.1,.2,.3,.4],false), {
    translation:[Math.fround(.02),Math.fround(.05),Math.fround(.03)],rotation:[.1,.3,.2,.4],
  });
  assert.deepEqual(sourcePoseToExport([2,3,5],[.1,.2,.3,.4],true).rotation,[-.1,-.3,-.2,.4]);
});

test('samples sparse source keys onto actual Three bones and reports the prior export delta', () => {
  const f = fixture(), preview = createOriginalPosePreview(f.root,f.catalog,'ORIGINAL');
  assert.equal(preview.duration,1); assert.equal(preview.boneCount,5);
  const result = preview.apply(.25); // source time .5, halfway between stored keys
  assert.deepEqual(f.nodes[0].position.toArray(),[Math.fround(.03),Math.fround(.07),Math.fround(.05)]);
  assert.equal(result.wrapped,0); assert.equal(result.flipped,0); assert.equal(result.rotationDelta,0);
  assert.ok(result.positionDelta > .09);
  preview.apply(.75); // closing interval: halfway from last key back to first
  assert.deepEqual(f.nodes[0].position.toArray(),[Math.fround(.03),Math.fround(.07),Math.fround(.05)]);
});

test('refuses missing, ambiguous or nonidentity bindings instead of guessing track association', () => {
  for (const mutate of [f=>{f.catalog.format='unknown';},f=>{f.sequence.name='Other';},
    f=>{f.catalog.sequences.push(f.sequence);},f=>{f.movement.boneIndices=[];},
    f=>{f.movement.boneIndices=[1,0,2,3,4];},f=>{f.movement.startBone=1;},
    f=>{f.movement.flags=1;},f=>{f.movement.tracks.pop();},f=>{f.sequence.rate=0;},
    f=>{f.sequence.frames=0;},f=>{delete f.sequence.frames;}]) {
    const f = fixture(); mutate(f);
    assert.throws(() => createOriginalPosePreview(f.root,f.catalog,'Original'));
    assert.deepEqual(f.nodes[0].position.toArray(),[0,0,0]);
  }
});

test('keeps sequence period separate from the movement source-time domain', () => {
  const f=fixture(); f.sequence.frames=40; f.movement.duration=80;
  const preview=createOriginalPosePreview(f.root,f.catalog,'Original');
  assert.equal(preview.duration,20);
  preview.apply(1/80); // source time 1 reaches the second stored key
  assert.deepEqual(f.nodes[0].position.toArray(),[Math.fround(.04),Math.fround(.09),Math.fround(.07)]);
});

test('a rejected late track cannot leave a partly updated source pose', () => {
  const f = fixture(), preview = createOriginalPosePreview(f.root,f.catalog,'Original');
  f.movement.tracks.at(-1).quaternions[1][0] = NaN;
  assert.throws(() => preview.apply(.25),/finite/);
  assert.deepEqual(f.nodes.map(node=>node.position.toArray()),f.nodes.map(()=>[0,0,0]));
});
