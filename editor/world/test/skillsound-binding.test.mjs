// Elbera Tools: portable original sound row and three-layer selection tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ordinaryPlayerVoiceMeshType, skillSoundBinding, skillSoundPhase, skillSoundVoice } from '../js/skillsound-binding.js';

const row = (level, name=0) => ({ level, layers: [
  [[name,0,0],[null,4,5],[1,8,9]],
  [[2,2.125,17.25],[3,0,40],[null,0,0]],
  [[4,254,200],[null,0,0],[5,250,80]],
], voiceVolume:250,voiceRadius:50 });
const data = rows => ({skillSoundFormat:'l2-interlude-skill-sound-v1',
  names:['first','second','third','fourth','fifth','sixth'],skillSoundRows:{7:rows}});

test('ordinary model identity uses the proven native voice index and never guesses unknown models',()=>{
 const models=['human_fighter_m','human_fighter_f','darkelf_m','darkelf_f','dwarf_m','dwarf_f',
   'elf_m','elf_f','human_mystic_m','human_mystic_f','orc_fighter_m','orc_fighter_f','orc_mystic_m','orc_mystic_f'];
 assert.deepEqual(models.map(ordinaryPlayerVoiceMeshType),Array.from({length:14},(_,i)=>i));
 for(const model of [undefined,null,0,'__proto__','toString','MFighter','human_fighter_m_npc'])
  assert.equal(ordinaryPlayerVoiceMeshType(model),null);
});

test('reverse native bucket traversal selects last exact row or first serialized level one',()=>{
 const index=data([row(1,0),row(2,1),row(1,2),row(2,3)]);
 assert.equal(skillSoundBinding(index,7,2).recordIndex,3);
 assert.equal(skillSoundBinding(index,7,1).recordIndex,2);
 const fallback=skillSoundBinding(index,7,9);
 assert.equal(fallback.status,'source-level-one');assert.equal(fallback.recordIndex,0);
 assert.equal(skillSoundBinding(data([row(2)]),7,9).status,'missing-level');
 assert.equal(skillSoundBinding(index,8,1).status,'missing-skill');
 for(const level of [undefined,null,'1',NaN,-1,2**32])assert.equal(skillSoundBinding(index,7,level).status,'invalid-identity');
});

test('each phase selects the same column across all three source layers in order',()=>{
 const index=data([row(1)]);
 assert.deepEqual(skillSoundPhase(index,7,1,1),[
  {layer:0,ref:'first',volume:0,radius:0},
  {layer:1,ref:'third',volume:2.125,radius:17.25},
  {layer:2,ref:'fifth',volume:254,radius:200},
 ]);
 assert.deepEqual(skillSoundPhase(index,7,1,2),[{layer:1,ref:'fourth',volume:0,radius:40}]);
 assert.deepEqual(skillSoundPhase(index,7,1,3).map(x=>x.ref),['second','sixth']);
});

test('empty exact rows stay empty and never borrow sounds from a default row',()=>{
 const empty=row(2);empty.layers=Array.from({length:3},()=>Array.from({length:3},()=>[null,0,0]));
 const index=data([row(1),empty]);
 assert.deepEqual(skillSoundPhase(index,7,2,1),[]);
 assert.equal(skillSoundPhase(index,7,3,1).length,3);
});

test('missing or malformed layer/name/gain metadata cannot emit a partial phase',()=>{
 assert.equal(skillSoundPhase({},7,1,1),null);
 for(const mutate of [i=>{i.skillSoundRows[7][0].layers.pop();},
   i=>{i.skillSoundRows[7][0].layers[2][0][0]=42;},
   i=>{i.skillSoundRows[7][0].layers[1][0][1]=NaN;}]){
  const index=data([row(1)]);mutate(index);assert.equal(skillSoundPhase(index,7,1,1),null);
 }
 assert.equal(skillSoundPhase(data([row(1)]),7,1,4),null);
});

test('voice uses its own phase bank, explicit mesh index and exact selected row with zero gains',()=>{
 const older=row(1), exact=row(2), newest=row(2);
 for(const [i,r] of [older,exact,newest].entries()) {
  r.castVoice=Array.from({length:15},()=>i);r.throwVoice=Array.from({length:15},()=>i+3);
 }
 newest.castVoice[13]=5;newest.voiceVolume=0;newest.voiceRadius=0;
 const index=data([older,exact,newest]);
 assert.deepEqual(skillSoundVoice(index,7,2,1,0),{ref:'third',volume:0,radius:0});
 assert.deepEqual(skillSoundVoice(index,7,2,1,13),{ref:'sixth',volume:0,radius:0});
 assert.deepEqual(skillSoundVoice(index,7,2,2,0),{ref:'sixth',volume:0,radius:0});
 assert.equal(skillSoundVoice(index,7,999,1,0).ref,'first');
 newest.castVoice[0]=null;
 assert.equal(skillSoundVoice(index,7,2,1,0),null,'empty exact voice never borrows fallback');
});

test('voice never guesses an identity or emits an impact/reserved/invalid source voice',()=>{
 const record=row(1);record.castVoice=Array(15).fill(0);record.throwVoice=Array(15).fill(1);
 const index=data([record]);
 for(const meshType of [undefined,null,'0',NaN,-1,1.5,14,100])
  assert.equal(skillSoundVoice(index,7,1,1,meshType),null);
 assert.equal(skillSoundVoice(index,7,1,3,0),null);
 assert.equal(skillSoundVoice(index,7,1,0,0),null);
 assert.equal(skillSoundVoice(index,8,1,1,0),null);
 for(const change of [r=>r.castVoice.pop(),r=>{r.castVoice[0]=99;},
   r=>{r.voiceVolume=NaN;},r=>{delete r.voiceRadius;}]) {
  const bad=structuredClone(index);change(bad.skillSoundRows[7][0]);
  assert.equal(skillSoundVoice(bad,7,1,1,0),null);
 }
});
