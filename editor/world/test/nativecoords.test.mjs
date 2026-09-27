// Authored coordinate cases only. Python separately evaluates retained source
// instructions; this cross-language suite needs no originals or site packages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  originalQuaternionCoords, applyOriginalPivot, applyOriginalPivotWithoutScale,
  originalPivotInverse, originalPoseHierarchy,
} from '../js/nativecoords.js';

const identity=[0,0,0,1,0,0,0,1,0,0,0,1];
const c=[10,20,30,0,-1,0,1,0,0,0,0,2],p=[3,-4,5,2,1,0,0,3,1,1,0,4];
function bits(value){const data=new DataView(new ArrayBuffer(4));data.setFloat32(0,value,true);return data.getUint32(0,true);}

test('all authored browser results match independent Python Float32 stores exactly',()=>{
  const program=`
import json,struct,sys
sys.path.insert(0,sys.argv[1])
from check_pose_coordinates_native import synthetic_cases,apply_pivot,apply_pivot_without_scale,pivot_inverse,quaternion_record
def bits(values):return [struct.unpack('<I',struct.pack('<f',v))[0] for v in values]
cases=synthetic_cases();rows=[]
for a,b in cases['pairs']:
 rows.append({'kind':'reference','args':[a,b],'bits':bits(apply_pivot(a,b))})
 rows.append({'kind':'current','args':[a,b],'bits':bits(apply_pivot_without_scale(a,b))})
for a in cases['inverses']:rows.append({'kind':'inverse','args':[a],'bits':bits(pivot_inverse(a))})
for q,p in cases['quaternions']:rows.append({'kind':'quaternion','args':[q,p],'bits':bits(quaternion_record(q,p))})
assert 'capstone' not in sys.modules
assert 'check_tutorial_quest_native' not in sys.modules
print(json.dumps(rows,allow_nan=False))
`;
  const result=spawnSync('python3',['-S','-c',program,fileURLToPath(new URL('../../../tools/ui/',import.meta.url))],
    {encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
  const rows=JSON.parse(result.stdout);assert.equal(rows.length,654);
  const functions={reference:applyOriginalPivot,current:applyOriginalPivotWithoutScale,
    inverse:originalPivotInverse,quaternion:originalQuaternionCoords};
  for(const [index,row] of rows.entries()){
    assert.deepEqual(functions[row.kind](...row.args).map(bits),row.bits,`${row.kind} case ${index}`);
  }
});

test('source quaternion conversion does not normalize, transpose or invent a browser basis',()=>{
  assert.deepEqual(originalQuaternionCoords([.5,.5,.5,.5],[4,5,6]),[4,5,6,0,0,1,1,0,0,0,1,0]);
  assert.deepEqual(originalQuaternionCoords([0,0,1,1],[0,0,0]),[0,0,0,-1,-2,0,2,-1,0,0,0,1]);
});

test('reference operand order and origin-before-add store differ from a generic matrix product',()=>{
  assert.deepEqual(applyOriginalPivot(c,p),[43,86,135,-1,2,0,-3,0,2,0,1,8]);
  assert.notDeepEqual(applyOriginalPivot(c,p),applyOriginalPivot(p,c));
  assert.equal(applyOriginalPivot([16777216,1,0,...identity.slice(3)],
    [-16777216,0,0,1,1,0,0,1,0,0,0,1])[0],0);
});

test('current composition normalizes only operand rows and retains its scale in translation',()=>{
  const parent=[5,6,7,2,0,0,0,3,0,0,0,4];
  assert.deepEqual(applyOriginalPivotWithoutScale(c,parent),[25,66,127,0,1,0,-1,0,0,0,0,2]);
  const parallel=applyOriginalPivotWithoutScale(identity,[5,6,7,2,1,0,4,2,0,0,0,0]);
  assert.deepEqual(parallel.slice(3,6),parallel.slice(6,9));
  assert.deepEqual(parallel.slice(9),[0,0,0]);
});

test('the normalizer uses the original double threshold rather than a rounded Float32 cutoff',()=>{
  const small=Math.fround(.0001),tiny=Math.fround(2e-8);
  assert.equal(Math.fround(tiny*tiny+small*small),Math.fround(1e-8));
  assert.ok(Math.fround(1e-8)<1e-8);
  assert.deepEqual(applyOriginalPivotWithoutScale(identity,[0,0,0,small,tiny,0,0,1,0,0,0,1]).slice(3,6),[0,0,0]);
  const view=new DataView(new ArrayBuffer(4));view.setUint32(0,bits(small)+1,true);
  assert.deepEqual(applyOriginalPivotWithoutScale(identity,[0,0,0,view.getFloat32(0,true),0,0,0,1,0,0,0,1]).slice(3,6),[1,0,0]);
});

test('inverse preserves cofactor orientation and rejects exact stored singularity',()=>{
  assert.deepEqual(originalPivotInverse(c),[-20,10,-15,0,1,-0,-1,0,0,0,-0,.5]);
  assert.throws(()=>originalPivotInverse(Array(12).fill(0)),/zero determinant/);
  assert.throws(()=>originalPivotInverse([0,0,0,1,0,0,0,1,0,0,0,1e-46]),/zero determinant/);
});

test('hierarchy copies one root then composes supplied preceding parents without mutating inputs',()=>{
  const poses=[{quaternion:[.5,.5,.5,.5],position:[10,20,30]},
    {quaternion:[0,0,0,1],position:[1,2,3]},{quaternion:[0,0,0,1],position:[4,5,6]}];
  const original=structuredClone(poses),parents=new Int32Array([0,0,1]);
  for(const mode of ['reference','current']){
    const result=originalPoseHierarchy(poses,parents,{mode});
    assert.deepEqual(result.map(r=>r.slice(0,3)),[[10,20,30],[13,21,32],[19,25,37]]);
    result[0][0]=999;assert.deepEqual(poses,original);
  }
  poses[0].quaternion=[0,0,1,1];
  const reference=originalPoseHierarchy(poses,parents,{mode:'reference'});
  const current=originalPoseHierarchy(poses,parents,{mode:'current'});
  assert.deepEqual(reference[0],current[0]);assert.deepEqual(reference[1].slice(0,3),current[1].slice(0,3));
  assert.notDeepEqual(reference[1].slice(3),current[1].slice(3));
});

test('typed components are copied and malformed/nonfinite/overflow data never becomes a fallback pose',()=>{
  const first=new Float32Array(c),second=new Float64Array(p);
  const result=applyOriginalPivot(first,second);result[0]=999;
  assert.deepEqual(Array.from(first),c);assert.deepEqual(Array.from(second),p);
  for(const bad of [null,undefined,'000000000000',new DataView(new ArrayBuffer(48)),identity.slice(1)]){
    assert.throws(()=>applyOriginalPivot(bad,identity));
  }
  for(const bad of [true,'1',NaN,Infinity,1e100])assert.throws(()=>applyOriginalPivot([bad,...identity.slice(1)],identity));
  assert.throws(()=>applyOriginalPivotWithoutScale(identity,[0,0,0,3e38,0,0,0,1,0,0,0,1]));
  assert.throws(()=>applyOriginalPivot(Array(12).fill(1e30),Array(12).fill(1e30)));
  const poses=Array.from({length:3},()=>({quaternion:[0,0,0,1],position:[0,0,0]}));
  for(const parents of [[1,0,1],[0,1,1],[0,2,0],[0,-1,0],[0,true,1],[0,0]]){
    assert.throws(()=>originalPoseHierarchy(poses,parents,{mode:'current'}));
  }
  assert.throws(()=>originalPoseHierarchy(poses,[0,0,1]));
  assert.throws(()=>originalPoseHierarchy(poses,[0,0,1],{mode:'guess'}));
  assert.throws(()=>originalPoseHierarchy(Array(1),[0],{mode:'current'}));
  const before=structuredClone(poses);poses[2].quaternion[3]=NaN;
  assert.throws(()=>originalPoseHierarchy(poses,[0,0,1],{mode:'current'}));
  assert.deepEqual(poses.slice(0,2),before.slice(0,2));
});
