// Elbera Tools: synthetic source-profile/clock fixtures; no private assets,
// browser, native execution or runtime actor admission is claimed by this suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {NPC_WAIT_SOURCES,planInitialNpcWait,createInitialNpcWait,advanceInitialNpcWait} from '../js/npcwaitanim.js';
import {createWaitSequence,advanceWaitSequence} from '../js/waitanim.js';
import {fixture,freeze,profiles,sound} from './fixtures/npc-wait.mjs';
const f=Math.fround;
const copy=value=>structuredClone(value);

test('exact Wait/AtkWait source records and Float32 wire rates for all three qualified NPC IDs',()=>{
  for(const npcId of [18342,20001,20091]) for(const combat of [0,1,255]) {
    const x=fixture(npcId);x.raw.combat=combat;
    const p=x.plan();assert.equal(p.status,'ready');assert.equal(p.seq,combat?'atkwait':'Wait');
    assert.equal(p.selector,combat?'AtkWaitAnimName':'WaitAnimName');assert.equal(p.stance,0);
    assert.equal(p.frames,combat?profiles[npcId].atkwait:61);assert.equal(p.sourceRate,30);
    assert.equal(p.rate,f(1.123456789));assert.equal(p.tween,0);assert.equal(p.loop,true);
    const state=createInitialNpcWait(p);assert.equal(state.frame,f(.0001));
    assert.notEqual(state.frame,f(.001),'native initial loop differs from earlier script one-shot');
  }
});

test('source profile joins reject other classes, ancestry, models, hashes and catalog aliases',()=>{
  const edits=[
    x=>x.raw.npcId=20002,
    x=>x.source.record.npcId=20091,
    x=>x.source.record.npc.className='LineageMonster.custom',
    x=>x.source.record.npc.inheritance[1]='Fixture.OtherPawn',
    x=>x.source.record.npc.meshRef='Other.gremlin_m00',
    x=>x.source.record.model.animationRef='Other.gremlin_anim',
    x=>x.source.catalog.modelId='npc_'+'c'.repeat(32),
    x=>x.source.record.model.source.meshExportSHA256='0'.repeat(64),
    x=>x.source.skeleton.source.animationExportSHA256='0'.repeat(64),
    x=>x.source.catalog.source.exportSHA256='0'.repeat(64),
    x=>x.source.catalog.source.notifyClassPackage.SHA256='0'.repeat(64),
    x=>x.sources['system/LineageMonster.int']='0'.repeat(64),
    x=>delete x.sources['system/npcgrp.dat'],
  ];
  for(const edit of edits) {const x=fixture();edit(x);assert.equal(x.plan().status,'unsupported');}
  const x=fixture();x.source.record.npc.inheritance.reverse();assert.equal(x.plan().status,'unsupported');
});

test('each selector must exist exactly once with original sequence and timing, never legacy idle/first clip',()=>{
  for(const edit of [
    x=>delete x.source.record.npc.selectors.WaitAnimName['0'],
    x=>x.source.record.npc.selectors.WaitAnimName['0'].status='source-none',
    x=>x.source.record.npc.selectors.WaitAnimName['0'].declaredBy='Fixture.Parent',
    x=>x.source.record.npc.selectors.WaitAnimName['0'].sequence='idle',
    x=>x.source.record.npc.selectors.WaitAnimName['0'].frames=60,
    x=>x.source.catalog.sequences[0].frames=60,
    x=>x.source.catalog.sequences[0].rate=29.999,
    x=>x.source.catalog.sequences.push(copy(x.source.catalog.sequences[0])),
    x=>x.source.catalog.sequences[0].movement.flags=1,
    x=>x.source.catalog.sequences[0].movement.startBone=1,
    x=>delete x.source.catalog.sequences[0].source,
  ]) {const x=fixture();edit(x);assert.equal(x.plan().status,'unsupported');}
});

test('raw snapshot must be complete and deeply immutable; no compatibility fallback or coercion',()=>{
  const x=fixture();assert.equal(planInitialNpcWait(x.raw,x.source,x.startup,x.sources).status,'unsupported');
  Object.freeze(x.raw);assert.equal(planInitialNpcWait(x.raw,x.source,x.startup,x.sources).status,'unsupported');
  const inherited=fixture();
  assert.equal(planInitialNpcWait(Object.freeze(Object.create(freeze(inherited.raw))),
    inherited.source,inherited.startup,inherited.sources).status,'unsupported');
  for(const key of ['npcId','waitType','dead','combat','running','rhand','chest','lhand','speedMul','summonAnimationRaw','npcInfoTail']) {
    const y=fixture();delete y.raw[key];assert.equal(y.plan().status,'unsupported',key);
  }
  for(const [key,value] of [['dead',0],['dead',true],['waitType',0],['waitType',2],['combat',false],
    ['combat',256],['running',true],['rhand',1],['chest',1],['lhand',1],['speedMul','1'],
    ['speedMul',0],['speedMul',-1],['speedMul',Infinity],['speedMul',1e40],['speedMul',1e-50],['summonAnimationRaw',1]]) {
    const y=fixture();y.raw[key]=value;assert.equal(y.plan().status,'unsupported',key+':'+value);
  }
});

test('port-owned native startup operands are all explicit and cannot be inferred from combat or packet mask zero',()=>{
  for(const key of Object.keys(fixture().startup)) {
    const x=fixture();delete x.startup[key];assert.equal(x.plan().status,'unsupported',key);
  }
  const changes={userItemBankMode:1,userFallbackItem:57,curWeaponType:1,lobby:true,ride:true,fishing:true,
    abnormalStates:[{flag:0}],swimWait:'Swim',swimAttackWait:'SwimAttack',damageAct:true,spineRotation:true,
    channelCount:2,channelBaseBone:1,channelSpecialMode:1,channelNotifyDisabled:1,rootLock:1,referenceOverride:1};
  for(const [key,value] of Object.entries(changes)) {
    const x=fixture();x.raw.combat=1;x.startup[key]=value;assert.equal(x.plan().status,'unsupported',key);
  }
  for(let index=0;index<4;index++) {
    const x=fixture();x.startup.modifierCounts[index]=1;assert.equal(x.plan().status,'unsupported');
  }
  const inherited=fixture();inherited.startup=Object.create(inherited.startup);
  assert.equal(planInitialNpcWait(freeze(inherited.raw),inherited.source,inherited.startup,inherited.sources).status,'unsupported');
});

test('known postpacket effect inputs reject nonzero values; opaque words are retained without zero sentinel claims',()=>{
  for(const edit of [
    x=>delete x.raw.npcInfoTail.extension,
    x=>x.raw.npcInfoTail.prefix.pop(),
    x=>x.raw.npcInfoTail.extension.dwords.push(0),
    x=>x.raw.npcInfoTail.extension.bytes[0]=256,
    x=>x.raw.npcInfoTail.extension.doubles[0]=NaN,
    x=>x.raw.npcInfoTail.extension.finalDwords[0]=2147483648,
    x=>x.raw.npcInfoTail.extension.dwords[0]=-2147483648,
    x=>x.raw.npcInfoTail.extension.bytes[0]=128,
    x=>x.raw.npcInfoTail.extension.bytes[1]=1,
  ]) {const x=fixture();edit(x);assert.equal(x.plan().status,'unsupported');}
  const x=fixture();x.raw.summonAnimationRaw=0;x.raw.npcInfoTail.prefix=[1,-2,3];
  x.raw.npcInfoTail.extension.dwords=[0,1,-2,3,4];x.raw.npcInfoTail.extension.doubles=[12.75,-28.125];
  x.raw.npcInfoTail.extension.finalDwords=[-1,0];assert.equal(x.plan().status,'ready');
});

test('required source and startup arrays reject missing or inherited entries',()=>{
  const arrays=[
    x=>x.source.record.npc.inheritance,
    x=>x.startup.modifierCounts,
    x=>x.raw.npcInfoTail.prefix,
    x=>x.raw.npcInfoTail.extension.dwords,
    x=>x.raw.npcInfoTail.extension.bytes,
    x=>x.raw.npcInfoTail.extension.doubles,
    x=>x.raw.npcInfoTail.extension.finalDwords,
  ];
  for (const get of arrays) for (const inherited of [false,true]) {
    const x=fixture(),values=get(x),index=values.length-1,original=values[index];
    delete values[index];
    if (inherited) {
      const prototype=Object.create(Array.prototype);
      prototype[index]=original;Object.setPrototypeOf(values,prototype);
    }
    assert.equal(x.plan().status,'unsupported',`${inherited?'inherited':'missing'} entry in ${get}`);
  }
  const x=fixture();x.startup.modifierCounts=Array(4);
  assert.equal(x.plan().status,'unsupported','an empty four-slot array is not four source zeroes');
});

test('plans own frozen notifies and preserve source order, full raw fields and null records',()=>{
  const x=fixture(),notifies=[sound(.3,2),sound(.1,0),sound(.2,1)];
  x.source.catalog.sequences[0].notifies=notifies;
  const p=x.plan();assert.equal(p.status,'ready');assert.deepEqual(p.notifies,notifies);
  assert.notEqual(p.notifies,notifies);assert.notEqual(p.notifies[0].soundInfo,notifies[0].soundInfo);
  notifies[0].t=.9;notifies[0].soundInfo.volume=999;notifies.pop();
  assert.deepEqual(p.notifies.map(n=>n.t),[f(.3),f(.1),f(.2)]);assert.equal(p.notifies[0].soundInfo.volume,250);
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.notifies) && Object.isFrozen(p.notifies[0].soundInfo));
  assert.throws(()=>p.notifies[0].soundInfo.random=100,TypeError);
});

test('missing or unsupported source notify behavior stays unavailable instead of becoming an empty sequence',()=>{
  for(const value of [undefined,null,[{...sound(.1),function:'ScriptEvent'}],
    [{...sound(.1),isBoneScale:true}],[{...sound(.1),isAttackShot:true}],
    [{...sound(.1),classPath:'Engine.OtherNotify'}],[{...sound(.1),t:Infinity}]]) {
    const x=fixture();x.source.catalog.sequences[0].notifies=value;assert.equal(x.plan().status,'unsupported');
  }
  const x=fixture();assert.equal(x.plan().status,'ready','explicit no-notify source array is valid');
});

test('all advancing results exactly reuse the original wait clock including source-order crossings and cap',()=>{
  const x=fixture();x.source.catalog.sequences[0].notifies=[sound(.02),sound(.08,0)];
  const p=x.plan(),state=createInitialNpcWait(p),reference=createWaitSequence(p);
  for(const delta of [0,.01,.04,.2,.03,1,4,20,.001]) {
    const expected=advanceWaitSequence(reference,delta),actual=advanceInitialNpcWait(state,delta);
    assert.deepEqual(actual,expected);assert.equal(state.frame,reference.frame);assert.ok(state.frame>=0);
  }
  assert.ok(Object.isFrozen(state));assert.throws(()=>state.frame=-.1,TypeError);
});

test('initial positive loop needs no fabricated cold shadow cache and cannot introduce a negative tween',()=>{
  const x=fixture(),p=x.plan(),a=createInitialNpcWait(p),b=createInitialNpcWait(p);
  assert.equal(a.frame,f(.0001));assert.equal(b.frame,f(.0001));
  assert.equal(advanceInitialNpcWait(a,.4).status,'ready');assert.equal(b.frame,f(.0001));
  for(const delta of [-1,NaN,Infinity,1e40]) {
    const previous=a.frame;assert.equal(advanceInitialNpcWait(a,delta).status,'unsupported');assert.equal(a.frame,previous);
  }
  assert.equal(p.tween,0);assert.equal(p.loop,true);
});

test('arbitrary ready plans and externally fabricated channels are not admitted by the adapter',()=>{
  assert.equal(createInitialNpcWait({status:'ready',tween:0,loop:true}),null);
  assert.equal(createInitialNpcWait(null),null);
  assert.equal(advanceInitialNpcWait({},.1).status,'unsupported');
  const p=fixture().plan();assert.equal(createInitialNpcWait({...p}),null);
});
