// Elbera Tools: ordinary wait playback, no private assets or browser needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {waitSequence,createWaitSequence,advanceWaitPlayback} from '../js/waitanim.js';
import {createCastPlayback,advanceCastPlayback,closeSourceLoop} from '../js/castplayback.js';
import {directNotifySound} from '../js/animnotify-clock.js';
const THREE=await import('../vendor/three.module.min.js');
const f=Math.fround;
function table() {
 const slots={},clips={};
 for(const slot of ['sitDown','sitWait','standUp','idle']) {
  const clip=slot==='sitWait'?'sit':slot;
  slots[slot]={hand:{seq:'Original_'+slot,clip}};
  clips[clip]={seq:'Original_'+slot,frames:6,rate:5,originalTiming:true,notifies:[]};
 }
 return {models:{fixture:{slots,rates:{sit:f(1.27451),stand:f(1.01307)}}},clips:{fixture:clips}};
}
const plan=(t,slot)=>waitSequence(t,'fixture','hand',slot);
test('separate original slots, exact scalar rates and source tween values; no alias fallback',()=>{
 const t=table();
 assert.equal(plan(t,'sitDown').rate,f(1.27451));assert.equal(plan(t,'standUp').rate,f(1.01307));
 assert.equal(plan(t,'sitWait').rate,1);assert.equal(plan(t,'sitWait').clip,'sit');
 assert.equal(plan(t,'sitDown').tween,f(.1));assert.equal(plan(t,'sitWait').tween,f(.2));
 assert.equal(waitSequence(t,'fixture','bow','sitDown').status,'unsupported');
 t.clips.fixture.sit.seq='Different';assert.equal(plan(t,'sitWait').status,'unsupported');
 t.models.fixture.rates.sit=0;assert.equal(plan(t,'sitDown').rate,1);
 t.models.fixture.rates.sit=-1;assert.equal(plan(t,'sitDown').status,'unsupported');
 delete t.models.fixture.rates.sit;assert.equal(plan(t,'sitDown').status,'unsupported');
});
test('AnimEnd installs source successor immediately and consumes the same tick remainder',()=>{
 const t=table();t.models.fixture.rates.sit=1;
 const state={channel:createWaitSequence(plan(t,'sitDown')),successor:plan(t,'sitWait'),changed:true};
 const out=advanceWaitPlayback(state,2);
 assert.equal(out.status,'ready');assert.equal(out.segments.length,2);
 assert.equal(out.segments[0].done,true);assert.equal(out.segments[0].sampleTime,1);
 assert.equal(out.segments[1].plan.slot,'sitWait');assert.ok(out.segments[1].sampleTime>.69);
 assert.ok(out.segments[1].sampleTime<.71);assert.equal(out.segments[1].changed,true);
 assert.equal(out.segments.reduce((n,s)=>n+s.advancements,0),4);
});
test('successor shares native four-advancement cap instead of receiving a fresh budget',()=>{
 const t=table();t.models.fixture.rates.sit=1;
 const state={channel:createWaitSequence(plan(t,'sitDown')),successor:plan(t,'sitWait'),changed:true};
 const out=advanceWaitPlayback(state,20);
 assert.equal(out.status,'ready');assert.equal(out.segments.reduce((n,s)=>n+s.advancements,0),4);
 assert.ok(out.segments.at(-1).discarded>15);assert.equal(out.segments.at(-1).frame,0);
});
test('terminal sample uses actual source endpoint and unsupported successor stays explicit',()=>{
 const t=table(),p=plan(t,'standUp');
 const state={channel:createWaitSequence(p),changed:true};
 const out=advanceWaitPlayback(state,5);
 assert.equal(out.status,'unsupported');assert.equal(out.reason,'missing-original-wait-successor');
 assert.equal(out.segments[0].sampleTime,p.sourceEndpoint);
});
const source=fs.readFileSync(new URL('../js/character.js',import.meta.url),'utf8');
const begin=source.indexOf('  cancelCast('),end=source.indexOf('  /**\n   * One attack swing',begin);
assert.ok(begin>=0 && end>begin,'actual Character wait-method boundary');
function harness() {
 const sounds=[],model=new THREE.Group(),bone=new THREE.Bone();bone.name='sourceBone';model.add(bone);
 const mixer=new THREE.AnimationMixer(model),t=table(),actions={};
 for(const [clip,base] of [['sitDown',10],['sit',20],['standUp',30],['idle',40]]) {
  const times=Array.from({length:6},(_,i)=>f(i/5));
  const values=times.flatMap(time=>[base+time,0,0]);
  actions[clip]=mixer.clipAction(new THREE.AnimationClip(clip,1,[new THREE.VectorKeyframeTrack('sourceBone.position',times,values)]));
 }
 const proto=vm.runInNewContext(`class C {${source.slice(begin,end)}};C.prototype`,{waitSequence,createWaitSequence,advanceWaitPlayback,
  createCastPlayback,advanceCastPlayback,closeSourceLoop,directNotifySound,performance:{now:()=>0},
  audio:{playAt:(...args)=>sounds.push(args)}});
 const ch=Object.assign(Object.create(proto),{group:model,model,mixer,actions,waitTable:t,modelId:'fixture',stance:'hand',speedMul:1.1,waitType:1,sitting:false});
 return {ch,bone,sounds,step(dt){ch._advanceWaitSchedule(dt);mixer.update(dt);ch._applySourceTween(ch.nativeWait);}};
}
test('actual Character plays Sit then SitWait and Stand then source idle; duplicate packets do not restart',()=>{
 const h=harness();assert.equal(h.ch.setWaitType(0).status,'ready');
 const original=h.ch.nativeWait;h.step(.2);
 assert.equal(h.ch.lastWaitPhase.clip,'sitDown');assert.equal(h.ch.sitting,true);
 assert.equal(h.ch.setWaitType(0).status,'unchanged');assert.equal(h.ch.nativeWait,original);
 h.step(2);assert.equal(h.ch.lastWaitPhase.clip,'sit');assert.equal(h.ch.nativeWait.channel.plan.loop,true);
 assert.ok(h.bone.position.x>=20 && h.bone.position.x<=21,'actual successor pose sampled');
 assert.equal(h.ch.setWaitType(1).status,'ready');assert.equal(h.ch.sitting,false);h.step(.3);
 assert.equal(h.ch.lastWaitPhase.clip,'standUp');h.step(2);assert.equal(h.ch.lastWaitPhase.clip,'idle');
 assert.ok(h.bone.position.x>=40 && h.bone.position.x<=41);
});
test('snapshot skips transition, special wait stays unsupported and missing clip is never replaced',()=>{
 const h=harness();assert.equal(h.ch.setWaitType(0,{snapshot:true}).status,'ready');h.step(.25);
 assert.equal(h.ch.lastWaitPhase.clip,'sit');assert.equal(h.ch.lastWaitPhase.rate,f(1.1));const state=h.ch.nativeWait;
 assert.equal(h.ch.setWaitType(2).status,'unsupported');assert.equal(h.ch.waitType,0);assert.equal(h.ch.nativeWait,state);
 const bad=harness();delete bad.ch.actions.sitDown;
 assert.equal(bad.ch.setWaitType(0).status,'unsupported');assert.equal(bad.ch.nativeWait,undefined);
 assert.equal(bad.ch.current,undefined);
});
test('actual wait direct sounds preserve source volume/radius and retire on explicit cancellation',()=>{
 const h=harness();h.ch.waitTable.clips.fixture.sitDown.notifies=[{t:f(.2),objectRef:1,function:'None',isAttackShot:false,isBoneScale:false,
  isSound:true,classPath:'Engine.AnimNotify_Sound',sound:'Fixture.Sit',soundInfo:{status:'source-direct',random:100,volume:128,radius:30}}];
 h.ch.setWaitType(0);h.step(.4);
 assert.equal(h.sounds.length,1);assert.equal(h.sounds[0][0],'Fixture.Sit');
 assert.equal(h.sounds[0][2].volume,128);assert.equal(h.sounds[0][2].radius,30);assert.equal(h.sounds[0][2].isCurrent(),true);
 h.ch.cancelCast();assert.equal(h.sounds[0][2].isCurrent(),false);assert.equal(h.ch.nativeWait,null);
});


test('standing snapshot uses the first wire multiplier and duplicate snapshot retains the loop',()=>{
 const h=harness();assert.equal(h.ch.setWaitType(1,{snapshot:true}).status,'ready');h.step(.25);
 assert.equal(h.ch.lastWaitPhase.clip,'idle');assert.equal(h.ch.lastWaitPhase.rate,f(1.1));
 const state=h.ch.nativeWait;assert.equal(h.ch.setWaitType(1,{snapshot:true}).status,'unchanged');
 assert.equal(h.ch.nativeWait,state);
 h.ch.setWaitType(0);h.step(3);assert.equal(h.ch.lastWaitPhase.rate,1,'script AnimEnd uses literal1, separate from snapshot rate');
});

function waitReviewSound(t, ref) {
 return {t:f(t),objectRef:1,function:'None',isAttackShot:false,isBoneScale:false,isSound:true,
  classPath:'Engine.AnimNotify_Sound',sound:ref,
  soundInfo:{status:'source-direct',random:100,volume:128,radius:30}};
}
// Exercise the production movement/idle branches around the same real mixer
// used above; a helper-only cancellation assertion would miss direct clears.
const updateStart=source.indexOf('  update(dt, terrain, moveDir = null) {');
assert.ok(updateStart>=0);
const actualWaitReviewUpdate=vm.runInNewContext(
 `class C {${source.slice(updateStart,source.lastIndexOf('\n}'))}};C.prototype.update`,
 {performance:{now:()=>0},MOVE_TICK_S:.1,TURN_RATE:10});

test('wait observer cancellation blocks the remaining batch and stale phase adoption',()=>{
 const h=harness();
 h.ch.waitTable.clips.fixture.sitDown.notifies=[waitReviewSound(.2,'First'),waitReviewSound(.25,'Second')];
 const observed=[];
 h.ch.onWaitNotify=detail=>{observed.push(detail.notify.sound);h.ch.cancelCast();};
 assert.equal(h.ch.setWaitType(0).status,'ready');h.step(.4);
 assert.deepEqual(observed,['First']);assert.deepEqual(h.sounds.map(s=>s[0]),['First']);
 assert.equal(h.ch.nativeWait,null);assert.equal(h.ch.lastWaitPhase,undefined);
 assert.equal(h.sounds[0][2].isCurrent(),false);
});

test('actual movement retires asynchronous wait sound ownership',()=>{
 const h=harness();h.ch.waitTable.clips.fixture.sitDown.notifies=[waitReviewSound(.2,'Sit')];
 h.ch.setWaitType(0);h.step(.4);
 assert.equal(h.sounds.length,1);assert.equal(h.sounds[0][2].isCurrent(),true);
 h.ch.moveMode='run';h.ch.runSpeed=1;h.ch.play=()=>{};
 actualWaitReviewUpdate.call(h.ch,.1,{heightAtWorld:()=>0},new THREE.Vector3(1,0,0));
 assert.equal(h.ch.nativeWait,null);assert.equal(h.sounds[0][2].isCurrent(),false);
});

test('unsupported wait clock retires asynchronous sounds while retaining its error',()=>{
 const h=harness();h.ch.waitTable.clips.fixture.sitDown.notifies=[waitReviewSound(.2,'Sit')];
 h.ch.setWaitType(0);h.step(.4);assert.equal(h.sounds[0][2].isCurrent(),true);
 h.ch._advanceWaitSchedule(Number.MAX_VALUE);
 assert.equal(h.ch.nativeWait,null);assert.equal(h.ch.lastWaitError.status,'unsupported');
 assert.equal(h.ch.lastWaitError.reason,'invalid-channel-clock');
 assert.equal(h.sounds[0][2].isCurrent(),false);
});

test('unsupported sit transition cannot silently become SitWait on the next actual update',()=>{
 const h=harness();delete h.ch.actions.sitDown;h.ch.play=()=>{};
 const error=h.ch.setWaitType(0);assert.equal(error.status,'unsupported');
 actualWaitReviewUpdate.call(h.ch,.1,{heightAtWorld:()=>0});
 assert.equal(h.ch.nativeWait==null,true);assert.equal(h.ch.lastWaitError,error);
 assert.equal(h.ch.current,undefined);
});

test('weapon changes select the current stance for an existing wait loop and a pending stand successor',async()=>{
 const start=source.indexOf('  setWeapon(itemId) {'),end=source.indexOf('\n  }',start)+4;
 const setWeapon=vm.runInNewContext(`class C {${source.slice(start,end)}};C.prototype.setWeapon`,{
  stanceFor:()=> 'bow',equipWeapon:async()=>null,
 });
 for(const transition of [false,true]) {
  const h=harness();h.ch.setWeapon=setWeapon;
  const t=h.ch.waitTable;
  for(const row of Object.values(t.models.fixture.slots))row.bow={...row.hand};
  t.models.fixture.slots.idle.bow={seq:'Original_BowWait',clip:'idle_bow'};
  t.clips.fixture.idle_bow={...t.clips.fixture.idle,seq:'Original_BowWait'};
  const clip=h.ch.actions.idle.getClip().clone();clip.name='idle_bow';h.ch.actions.idle_bow=h.ch.mixer.clipAction(clip);
  if(transition){h.ch.setWaitType(0);h.step(3);h.ch.setWaitType(1);h.step(.3);}
  else {h.ch.setWaitType(1,{snapshot:true});h.step(.3);}
  await h.ch.setWeapon(123);
  if(transition)assert.equal(h.ch.nativeWait.channel.plan.slot,'standUp','weapon must not truncate the transition');
  h.step(3);assert.equal(h.ch.lastWaitPhase.clip,'idle_bow');
 }
});


test('self initial UserInfo waiting uses its source multiplier and native zero-tween loop start',()=>{
 const h=harness();assert.equal(h.ch.setWaitType(1,{snapshot:true,initial:true}).status,'ready');
 assert.equal(h.ch.nativeWait.channel.plan.rate,f(1.1));assert.equal(h.ch.nativeWait.channel.plan.tween,0);
 assert.equal(h.ch.nativeWait.channel.frame,f(.0001));assert.equal(h.ch.nativeWait.channel.tweenRate,0);
 h.step(0);assert.equal(h.ch.lastWaitPhase.clip,'idle');assert.equal(h.ch.lastWaitPhase.tweenProgress,1);
 assert.ok(h.ch.lastWaitPhase.sampleTime>0);assert.ok(h.bone.position.x>=40);
});

test('same-tick successor tween starts at the displayed last transition pose',()=>{
 const h=harness();h.ch.waitTable.models.fixture.rates.sit=1;
 h.ch.setWaitType(0);h.step(1.2);
 assert.equal(h.ch.lastWaitPhase.clip,'sit');
 assert.ok(Math.abs(h.ch.lastWaitPhase.tweenProgress-.5)<.000002);
 // Original transition endpoint x=11; successor frame zero x=20.
 assert.ok(Math.abs(h.bone.position.x-15.5)<.00002,'must not wrap to transition frame zero or retain the previous tick');
});
