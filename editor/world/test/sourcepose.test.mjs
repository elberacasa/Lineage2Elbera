import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.min.js';
import { matchSourceBones, sourcePoseToExport, createOriginalPosePreview } from '../js/sourcepose.js';

function fixture() {
  const root = new THREE.Group();
  const source = [{name:'Root',parent:0},{name:'Left',parent:0},{name:'Finger',parent:1},
    {name:'Right',parent:0},{name:'Finger',parent:3}];
  const nodes = source.map(row => {
    const bone = new THREE.Bone(); bone.name = row.name;
    bone.userData.name = row.name; return bone;
  });
  nodes.forEach((bone,index)=>(index===0?root:nodes[source[index].parent]).add(bone));
  const movement = {flags:0,startBone:0,duration:2,boneIndices:[0,1,2,3,4],
    tracks:source.map(()=>({flags:0,times:[0,1],quaternions:[[0,0,0,1],[0,0,0,1]],
      positions:[[2,3,5],[4,7,9]]}))};
  const sequence = {name:'Original',rate:2,frames:2,movement};
  const catalog = {format:'elbera-original-animation-tracks-v1',modelId:'synthetic',animationRef:'Fixture.Animation',
    source:{packageSHA256:'a'.repeat(64),exportSHA256:'b'.repeat(64)},bones:structuredClone(source),sequences:[sequence]};
  const skeleton = {format:'elbera-original-player-skeleton-v1',modelId:'synthetic',animationRef:'Fixture.Animation',
    source:{packageSHA256:'a'.repeat(64),animationExportSHA256:'b'.repeat(64)},animationBones:structuredClone(source),
    bones:source.map(bone=>({...bone,orientation:[0,0,0,1],position:[1,0,0]})),trackBindings:[0,1,2,3,2]};
  const f={root,nodes,source,movement,sequence,catalog,skeleton};
  f.preview=()=>createOriginalPosePreview(root,catalog,'ORIGINAL',skeleton);
  return f;
}
function near(actual,expected){assert.equal(actual.length,expected.length);actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-7,`${i}: ${v} vs ${expected[i]}`));}
function worldPosition(node){return new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).toArray();}

test('export correspondence matches duplicate names by parent and preserved loader name',()=>{
  const f=fixture();assert.deepEqual(matchSourceBones(f.root,f.source),f.nodes);
  f.source[2].name='FINGER';assert.deepEqual(matchSourceBones(f.root,f.source),f.nodes);
});

test('rejects renamed, missing, ambiguous and invalid export hierarchies without aliases',()=>{
  for(const mutate of [f=>{f.source[4].name='Other';},f=>{f.source[1].parent=2;},
    f=>{f.source[0].parent=-1;},f=>{f.source[1].parent=1;},
    f=>{const duplicate=new THREE.Bone();duplicate.name='Finger';f.nodes[1].add(duplicate);}]){
    const f=fixture();mutate(f);assert.throws(()=>matchSourceBones(f.root,f.source));
  }
});

test('measured local adapter retains both PSA mirror and glTF conversion',()=>{
  assert.deepEqual(sourcePoseToExport([2,3,5],[.1,.2,.3,.4],false),{
    translation:[Math.fround(.02),Math.fround(.05),Math.fround(.03)],rotation:[.1,.3,.2,.4]});
  assert.deepEqual(sourcePoseToExport([2,3,5],[.1,.2,.3,.4],true).rotation,[-.1,-.3,-.2,.4]);
});

test('renders sparse keys and complete current hierarchy with reversible manual matrices',()=>{
  const f=fixture(),preview=f.preview();
  assert.equal(preview.duration,1);assert.equal(preview.mappedCount,5);assert.equal(preview.referenceCount,0);
  const before=f.nodes.map(bone=>bone.matrix.clone());
  const result=preview.apply(.25);
  near(worldPosition(f.nodes[0]),[.03,.07,.05]);
  near(worldPosition(f.nodes[2]),[.09,.21,.15]);
  assert.deepEqual(f.nodes[0].position.toArray(),[0,0,0],'manual display must not overwrite mixer TRS');
  assert.equal(f.nodes[0].matrixAutoUpdate,false);
  assert.equal(result.wrapped,0);assert.equal(result.flipped,0);assert.equal(result.basisDelta,0);
  preview.apply(.75);near(worldPosition(f.nodes[0]),[.03,.07,.05]);
  preview.restore();preview.restore();
  f.nodes.forEach((bone,index)=>{assert.equal(bone.matrixAutoUpdate,true);assert.ok(bone.matrix.equals(before[index]));});
});

test('native first-name binding ignores parent identity and serialized movement BoneIndices',()=>{
  const f=fixture();f.movement.boneIndices=[];
  f.movement.tracks[2].positions=[[8,0,0]];f.movement.tracks[4].positions=[[999,0,0]];
  const preview=f.preview(),result=preview.apply(0);
  // Both Finger mesh bones use the FIRST matching animation name, though one
  // animation parent disagrees. The later homonym is never selected.
  near(result.coordinates[2].slice(0,3),[12,6,10]);
  near(result.coordinates[4].slice(0,3),[12,6,10]);
  f.movement.boneIndices=[4,3,2,1,0];preview.apply(0);
  near(worldPosition(f.nodes[4]),[.12,.10,.06]);
});

test('missing parent track uses original reference q/p while its mapped child still animates',()=>{
  const f=fixture();f.skeleton.bones[1].name='Unmatched';f.nodes[1].userData.name='Unmatched';
  f.skeleton.trackBindings[1]=-1;f.skeleton.bones[1].position=[11,0,0];
  const preview=f.preview(),result=preview.apply(0);
  assert.equal(preview.mappedCount,4);assert.equal(preview.referenceCount,1);
  near(result.coordinates[1].slice(0,3),[13,3,5]);
  near(result.coordinates[2].slice(0,3),[15,6,10]);
  near(worldPosition(f.nodes[2]),[.15,.10,.06]);
});

test('rejects mismatched source identities, hand-edited bindings and ambiguous name interning',()=>{
  for(const mutate of [f=>{f.skeleton.source.packageSHA256='c'.repeat(64);},
    f=>{f.skeleton.source.animationExportSHA256='c'.repeat(64);},f=>{f.skeleton.modelId='other';},
    f=>{f.skeleton.animationRef='Other.Animation';},f=>{delete f.catalog.source.exportSHA256;},
    f=>{f.skeleton.trackBindings[4]=4;},f=>{f.skeleton.trackBindings[4]=-1;},
    f=>{f.skeleton.animationBones[2].parent=0;},f=>{f.skeleton.bones[1].name='left';},
    f=>{f.skeleton.bones[1].name='Böne';},f=>{f.skeleton.bones[1].orientation[0]=NaN;}]){
    const f=fixture();mutate(f);assert.throws(f.preview);
    assert.equal(f.nodes[0].matrixAutoUpdate,true);near(worldPosition(f.nodes[0]),[0,0,0]);
  }
});

test('refuses unsupported source movements or sequence timing before rendering',()=>{
  for(const mutate of [f=>{f.catalog.format='unknown';},f=>{f.sequence.name='Other';},
    f=>{f.catalog.sequences.push(f.sequence);},f=>{f.movement.startBone=1;},
    f=>{f.movement.flags=1;},f=>{f.movement.tracks.pop();},f=>{f.sequence.rate=0;},f=>{f.sequence.frames=0;}]){
    const f=fixture();mutate(f);assert.throws(f.preview);assert.equal(f.nodes[0].matrixAutoUpdate,true);
  }
});

test('sequence period remains distinct from movement key-time duration',()=>{
  const f=fixture();f.sequence.frames=40;f.movement.duration=80;
  const preview=f.preview();assert.equal(preview.duration,20);preview.apply(1/80);
  near(worldPosition(f.nodes[0]),[.04,.09,.07]);
});

test('a late bad track or frame preserves all previously displayed matrices until explicit restore',()=>{
  const f=fixture(),preview=f.preview();preview.apply(.25);
  const before=f.nodes.map(node=>node.matrix.clone());
  for(const frame of [NaN,-.1,1.1,-0])assert.throws(()=>preview.apply(frame));
  f.movement.tracks[3].quaternions[1][0]=NaN;
  assert.throws(()=>preview.apply(.25),/finite/);
  f.nodes.forEach((node,index)=>assert.ok(node.matrix.equals(before[index])));
  preview.restore();f.nodes.forEach(node=>assert.equal(node.matrixAutoUpdate,true));
});

test('display basis includes ancestor transforms exactly once and restores manual input state',()=>{
  const f=fixture();f.root.position.set(7,11,13);f.root.scale.setScalar(2);f.root.rotation.y=.4;
  f.nodes[1].matrixAutoUpdate=false;f.nodes[1].matrix.makeTranslation(.4,.5,.6);
  const expectedManual=f.nodes[1].matrix.clone(),preview=f.preview();preview.apply(0);
  const expected=new THREE.Vector3(.02,.05,.03).applyMatrix4(f.root.matrixWorld);
  near(worldPosition(f.nodes[0]),expected.toArray());
  preview.restore();assert.equal(f.nodes[1].matrixAutoUpdate,false);assert.ok(f.nodes[1].matrix.equals(expectedManual));
});
