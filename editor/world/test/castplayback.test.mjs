// Elbera Tools: actual Three clips and ordinary phase-clock integration.
// Synthetic tracks test lifecycle/loop closure, not original pose parity.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createNativeRandom} from '../js/native-random.js';
import * as THREE from '../vendor/three.module.min.js';
import { selectNotifySound } from '../js/animnotify-clock.js';
import { createCastPlayback, advanceCastPlayback, closeSourceLoop } from '../js/castplayback.js';

const source=fs.readFileSync(new URL('../js/character.js',import.meta.url),'utf8');
const Character=vm.runInNewContext(source.replace(/^import .*;$/gm,'').replace(/^export /gm,'')+'\nCharacter;',
  {THREE,selectNotifySound,audio:{nativeRandom:createNativeRandom(0),playAt:()=>{}},L2_TO_M:.01,createCastPlayback,advanceCastPlayback,closeSourceLoop,performance:{now:()=>1000}});
function phase(clip,due,loop=false){return {clip,slot:clip,notifies:[],frames:3,sourceRate:2,sourceEndpoint:1,sourceDuration:1.5,due,loop};}
function schedule(phases,tween=.2){return {status:'ready',rate:1,tween,phases};}
function fixture(){
 const character=new Character(), bone=new THREE.Bone();bone.name='Joint';bone.position.x=8;
 character.model=new THREE.Group();character.model.add(bone);character.group.add(character.model);
 character.mixer=new THREE.AnimationMixer(character.model);
 for(const name of ['opening','middle','final','idle']){
  const clip=new THREE.AnimationClip(name,1,[new THREE.NumberKeyframeTrack('Joint.position[x]',[0,.5,1],[0,10,20])]);
  character.actions[name]=character.mixer.clipAction(clip);
 }
 return {character,bone,step:dt=>character.update(dt,{heightAtWorld:()=>null})};
}
const near=(a,b,e=1e-5)=>assert.ok(Math.abs(a-b)<e,`${a} differs from ${b}`);

test('loop closure preserves every sample and interpolates the missing closing interval',()=>{
 const clip=new THREE.AnimationClip('source',1,[new THREE.NumberKeyframeTrack('Joint.position[x]',[0,.5,1],[0,10,20])]);
 const loop=closeSourceLoop(clip,3,2);
 assert.deepEqual([...loop.tracks[0].times],[0,.5,1,1.5]);
 assert.deepEqual([...loop.tracks[0].values],[0,10,20,0]);
 assert.deepEqual([...clip.tracks[0].times],[0,.5,1]);
 near(loop.tracks[0].createInterpolant().evaluate(1.25)[0],10);
 assert.equal(loop.duration,1.5);
 assert.equal(closeSourceLoop(clip,4,3),null,'mismatched sampling is not stretched');
});

test('phase clock advances strictly beyond deadlines, not on equality or clip finish',()=>{
 const state=createCastPlayback(schedule([phase('opening',1),phase('middle',2,true),phase('final',4)],.5));
 for(let i=0;i<4;i++)advanceCastPlayback(state,.25);
 assert.equal(state.elapsed,1);assert.equal(state.phaseIndex,0);
 advanceCastPlayback(state,.25);assert.equal(state.phaseIndex,0);
 const next=advanceCastPlayback(state,.25);assert.equal(next.phaseIndex,1);assert.equal(next.changed,true);
 assert.equal(next.tween,0,'later phase does not repeat initial tween');
 while(state.elapsed<=2)advanceCastPlayback(state,.25);
 assert.equal(advanceCastPlayback(state,.25).phaseIndex,2);
});

test('losslessly collapsed constant tracks preserve their keys while sparse motion is rejected',()=>{
 const constant=new THREE.VectorKeyframeTrack('Joint.position',[0,1],[3,4,5,3,4,5]);
 const dense=new THREE.NumberKeyframeTrack('Joint.scale[x]',[0,.5,1],[1,2,3]);
 const clip=new THREE.AnimationClip('mixed',1,[constant,dense]);
 const loop=closeSourceLoop(clip,3,2);
 assert.deepEqual([...loop.tracks[0].times],[0,1,1.5]);
 assert.deepEqual([...loop.tracks[0].values],[3,4,5,3,4,5,3,4,5]);
 assert.deepEqual([...loop.tracks[1].times],[0,.5,1,1.5]);
 assert.deepEqual([...constant.times],[0,1]);
 const moving=clip.clone();moving.tracks[0].values[3]=6;
 assert.equal(closeSourceLoop(moving,3,2),null);
 const wrongEnd=clip.clone();wrongEnd.tracks[0].times[1]=.75;
 assert.equal(closeSourceLoop(wrongEnd,3,2),null);
});

test('one-shot holds its final source pose while the independent phase deadline remains',()=>{
 const h=fixture();assert.equal(h.character.startCastSchedule(schedule([phase('opening',3)])).status,'ready');
 for(let i=0;i<12;i++)h.step(.125);
 near(h.bone.position.x,20);assert.ok(h.character.nativeCast);
 h.step(.125);near(h.bone.position.x,20);
 assert.equal(h.character.current.getClip().name,'opening');
});

test('positive tween holds frame zero, then consumes leftover delta as new animation',()=>{
 const h=fixture();h.character.startCastSchedule(schedule([phase('opening',3)]));
 h.step(.1);near(h.bone.position.x,8); // New phase has not received an animation delta.
 h.step(.1);near(h.bone.position.x,4);
 h.step(.15);near(h.bone.position.x,1,2e-5);
 assert.ok(h.character.lastCastPhase.sampleTime>0);
});

test('all phases play, middle loop has source period, and cancellation prevents later phases',()=>{
 const h=fixture(), plan=schedule([phase('opening',.5),phase('middle',2.5,true),phase('final',4)]);
 assert.equal(h.character.startCastSchedule(plan).status,'ready');
 const seen=new Set();
 for(let i=0;i<25;i++){h.step(.125);seen.add(h.character.lastCastPhase.index);}
 assert.deepEqual([...seen],[0,1,2]);
 assert.equal(h.character.castLoopActions.size,1);
 const loop=[...h.character.castLoopActions.values()][0];assert.equal(loop.getClip().duration,1.5);
 h.character.cancelCast();assert.equal(h.character.nativeCast,null);
 const last=h.character.lastCastPhase;
 for(let i=0;i<8;i++)h.step(.125);
 assert.equal(h.character.lastCastPhase,last);assert.equal(h.character.current.getClip().name,'idle');
});

test('missing later clips and unsupported plans cannot partially play or invent a replacement',()=>{
 const h=fixture();delete h.character.actions.final;
 const result=h.character.startCastSchedule(schedule([phase('opening',.5),phase('middle',2,true),phase('final',4)]));
 assert.equal(result.status,'unsupported');assert.equal(h.character.nativeCast,undefined);
 assert.equal(h.character.current,null);
 assert.equal(h.character.startCastSchedule({status:'unsupported'}).status,'unsupported');
});

test('casting speed is sourced from the received magic speed and never the physical multiplier',()=>{
 const h=fixture();h.character.setSpeeds({mAtkSpd:213,atkSpdMul:9});
 assert.equal(h.character.skillSpeedRate,Math.fround(213/333));
 h.character.setSpeeds({mAtkSpd:0});assert.equal(h.character.skillSpeedRate,Math.fround(213/333));
});

test('actual Character observes the native batch once, exposes null records and cancels further events',()=>{
 const h=fixture(), notes=[.25,.5].map((t,i)=>({t,isAttackShot:false,isBoneScale:false,objectRef:i,function:'None'}));
 const p=phase('opening',3);p.notifies=notes;
 const seen=[];h.character.onCastNotify=event=>seen.push(event);
 h.character.startCastSchedule(schedule([p],0));
 h.step(.001);h.step(1);
 assert.deepEqual(seen.map(e=>[e.index,e.dispatch]),[[0,'null'],[1,'object']]);
 assert.equal(h.character.nativeCast.frame,.5);assert.equal(h.character.castNotifyCount,2);
 h.character.cancelCast();h.step(1);
 assert.equal(seen.length,2);
});

test('actual Character stops on unsupported native filtering without dispatching part of the batch',()=>{
 const h=fixture(), p=phase('opening',3);
 p.notifies=[.25,.5].map(t=>({t,isAttackShot:true,isBoneScale:false,objectRef:1,function:'None'}));
 const seen=[];h.character.onCastNotify=event=>seen.push(event);
 h.character.startCastSchedule(schedule([p],0));h.step(.001);h.step(1);
 assert.equal(h.character.nativeCast,null);assert.equal(h.character.castNotifyCount,0);
 assert.equal(h.character.lastCastError,'unresolved-native-notify-removal');
 assert.equal(seen.length,0);
});


test('old channel events survive phase transition and completion with their original phase identity',()=>{
 const note={t:.5,isAttackShot:false,isBoneScale:false,objectRef:1,function:'None'};
 const old={...phase('opening',.25),notifies:[note]}, next={...phase('final',.75),notifies:[note]};
 const state=createCastPlayback(schedule([old,next],0),{notifiesEnabled:true});
 const init=advanceCastPlayback(state,.5);
 assert.deepEqual(init.events,[]);assert.equal(state.frame,Math.fround(.001));
 assert.equal(state.phaseElapsed,0,'initial MagicProcess does not advance new animation');
 const change=advanceCastPlayback(state,.75);
 assert.equal(change.phaseIndex,1);assert.equal(change.eventPhase,old);
 assert.deepEqual(change.events.map(e=>e.index),[0]);
 assert.equal(state.frame,Math.fround(.001),'new phase is not advanced with old phase delta');
 assert.equal(state.phaseElapsed,0);
 const done=advanceCastPlayback(state,.75);
 assert.equal(done.done,true);assert.equal(done.eventPhase,next);
 assert.deepEqual(done.events.map(e=>e.index),[0]);
 assert.equal(state.elapsed,.75,'Clear(1) then shared delta addition');
 assert.equal(done.eventElapsed,2,'observed tick time precedes Clear');
});

test('zero ActiveTime re-enters the initial branch and increments phase on the next tick',()=>{
 const state=createCastPlayback(schedule([phase('opening',1),phase('final',2)],.2));
 advanceCastPlayback(state,0);assert.equal(state.phaseIndex,0);assert.equal(state.elapsed,0);
 const next=advanceCastPlayback(state,.1);
 assert.equal(next.phaseIndex,1);assert.equal(next.changed,true);
 assert.equal(next.tween,.2);
 assert.equal(next.sampleTime,0);assert.equal(state.phaseElapsed,0);
});

test('Character dispatches the last old-channel event before retiring completion',()=>{
 const h=fixture(),p=phase('opening',.25);
 p.notifies=[{t:.5,isAttackShot:false,isBoneScale:false,objectRef:1,function:'None'}];
 const seen=[];h.character.onCastNotify=event=>seen.push(event);
 h.character.startCastSchedule(schedule([p],0));h.step(.5);h.step(.75);
 assert.equal(h.character.nativeCast,null);
 assert.deepEqual(seen.map(e=>[e.clip,e.phaseIndex,e.elapsed]),[['opening',0,1.25]]);
});

test('Character hooks consume old-phase events and pre-add ActiveTime before phase exposure',()=>{
 const h=fixture(), seen=[], starts=[], cancellations=[];
 const a=phase('opening',.1),b=phase('final',.5);
 a.notifies=[{t:.05,function:'None',isAttackShot:true,isBoneScale:false,objectRef:7,classPath:'Engine.AnimNotify_AttackShot',objectPath:'Synthetic.Shot'}];
 h.character.startCastSchedule(schedule([a,b],0),{
   start:g=>starts.push(g),cancel:()=>cancellations.push(true),
   tick:t=>seen.push({...t,visiblePhase:h.character.lastCastPhase?.index}),
 });
 h.step(.1);h.step(.1);h.step(.1);
 assert.equal(starts.length,1);
 assert.equal(seen[0].activeTime,0);
 const eventTick=seen.find(t=>t.events.length);
 assert.ok(eventTick);assert.equal(eventTick.events[0].notify.objectPath,'Synthetic.Shot');
 assert.equal(eventTick.visiblePhase,0);
 assert.equal(seen[2].activeTime,Math.fround(.2));
 assert.equal(h.character.lastCastPhase.index,1);
 for(let i=0;i<7;i++)h.step(.1);
 assert.ok(seen.some(t=>t.complete));assert.equal(cancellations.length,0,'normal completion preserves queued emission guards');
 assert.equal(h.character.castGeneration,starts[0]);
 h.character.cancelCast();assert.notEqual(h.character.castGeneration,starts[0]);
});
