// Elbera Tools: real NPC/manager methods and Three mixers, controlled async
// model/material inputs. No private assets, browser, service or native claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three.module.min.js';
import {planInitialNpcWait,createInitialNpcWait,advanceInitialNpcWait} from '../js/npcwaitanim.js';
import {createOriginalPosePlayback} from '../js/sourcepose-playback.js';
import {selectNotifySound} from '../js/animnotify-clock.js';
import {createNativeRandom} from '../js/native-random.js';
import {fixture as waitFixture,sound} from './fixtures/npc-wait.mjs';

const source=fs.readFileSync(new URL('../js/entities.js',import.meta.url),'utf8');
const begin=source.indexOf('class NpcEntity {');
const mapBegin=source.indexOf('function mapAnimations('),mapEnd=source.indexOf('// aCis/L2 classId',mapBegin);
assert.ok(begin>0 && mapBegin>0 && mapEnd>mapBegin,'actual NPC method boundaries');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const packet=(extra={})=>({id:7,npcId:9,name:'Authored NPC',x:0,y:0,z:0,heading:0,
  combat:0,waitType:1,rhand:0,chest:0,lhand:0,speedMul:1.25,running:0,dead:0,
  collisionRadius:12,collisionHeight:24,...extra});
const plain=value=>JSON.parse(JSON.stringify(value));
const terrainFor=tile=>({def:{tile},heightAtWorld:()=>0});

function harness({holdManifest=false,worldEntry=true,sceneReady=true,readyTile='17_25'}={}) {
  const scene=new THREE.Group(),jobs=[],materials=[],warnings=[],mixers=[],timers=new Map();
  const manifest=deferred(),titles=deferred();let timerId=0;
  const modelRows=[{id:'Authored9',gltf:'nine.gltf'},{id:'Authored10',gltf:'ten.gltf'},
    {id:'Authored18342',gltf:'starter-gremlin.gltf'},{id:'Authored20001',gltf:'gremlin.gltf'},{id:'Authored20091',gltf:'fox.gltf'}];
  if(!holdManifest)manifest.resolve(modelRows);
  class Mixer extends THREE.AnimationMixer {
    constructor(root){super(root);this.stops=0;this.uncached=[];mixers.push(this);}
    stopAllAction(){this.stops++;return super.stopAllAction();}
    uncacheRoot(root){this.uncached.push(root);return super.uncacheRoot(root);}
  }
  const sounds=[],audio={nativeRandom:createNativeRandom(0),playAt:(...args)=>sounds.push(args)};
  const context={THREE:{...THREE,AnimationMixer:Mixer},L2_TO_M:.01,NPC_SPEED:1.6,MOVE_TICK_S:.1,
    planInitialNpcWait,createInitialNpcWait,advanceInitialNpcWait,createOriginalPosePlayback,selectNotifySound,audio,
    NAME_COLOR:'#fff',npcColor:()=>new THREE.Color(0),labelScale:()=>1,
    l2ToThree:(x,y,z,out=new THREE.Vector3())=>out.set(x*.01,z*.01,-y*.01),l2HeadingToThreeYaw:()=>0,
    makeLabel:text=>{const label=new THREE.Object3D();label.userData.nameplate={text};return label;},
    titleFor:row=>row ? {text:row,color:null}:null,npcTitles:()=>titles.promise,
    monsterManifest:()=>manifest.promise,npcMeshes:async()=>Object.fromEntries([9,10,18342,20001,20091].map(id=>[id,{mesh:`Authored${id}`,type:'Monster'}])),
    npcVisualMeta:async()=>({}),npcVisualScale:()=>({x:1,y:1,z:1}),GLTFLoader:class {},
    loadNpcAnimationModel:(npcId,entry)=>{const work=deferred();jobs.push({npcId,entry,...work});return work.promise;},
    applyOriginalNpcMaterials:(npcId,entry,gltf)=>{const work=deferred();materials.push({npcId,entry,gltf,...work});return work.promise;},
    setTimeout:callback=>{timers.set(++timerId,callback);return timerId;},clearTimeout:id=>timers.delete(id),
    console:{warn:(...args)=>warnings.push(args)},
  };
  const classes=source.slice(begin).replace('export class EntityManager','class EntityManager');
  const {EntityManager,NpcEntity}=vm.runInNewContext(source.slice(mapBegin,mapEnd)+classes+'\n({EntityManager,NpcEntity});',context);
  const manager=new EntityManager(scene,[]);
  const session={current:true},entry=worldEntry ? manager.beginNpcWorldEntry(()=>session.current) : null;
  if(entry && sceneReady)assert.equal(manager.setNpcWorldScene(terrainFor(readyTile),entry),true);
  const add=(msg,tile='17_25')=>{manager.addNpc(msg,terrainFor(tile));return manager.getEntity(msg.id);};
  return{scene,manager,NpcEntity,add,jobs,materials,warnings,mixers,timers,titles,manifest,modelRows,audio,sounds,session,entry};
}
function model() {
  const root=new THREE.Group(),texture=new THREE.Texture({close(){assert.fail('cached image closed');}});
  const material=new THREE.MeshLambertMaterial({map:texture}),geometry=new THREE.BoxGeometry(1,2,1);
  const mesh=new THREE.Mesh(geometry,material);root.add(mesh);
  const disposal={material:0,texture:0,geometry:0};
  for(const [key,value] of Object.entries({material,texture,geometry}))value.addEventListener('dispose',()=>disposal[key]++);
  return{gltf:{scene:root,animations:[new THREE.AnimationClip('idle',1,[])]},overrides:{},root,material,disposal};
}
async function adopt(h,job=0) {
  await flush();const loaded=model();h.jobs[job].resolve(loaded);await flush();
  h.materials.find(row=>row.gltf===loaded.gltf).resolve();await flush();return loaded;
}

// Synthetic one-bone source keys with exact profile identities. These exercise
// the real planner/clock/pose/entity together, not original asset correctness.
function sourceModel(npcId=20001) {
  const loaded=model(),f=waitFixture(npcId),bone=new THREE.Bone();
  bone.name='Root';loaded.root.add(bone);
  const bones=[{name:'Root',parent:0}];
  f.source.record.sourceFiles=Object.freeze({...f.sources});
  f.source.catalog.bones=bones;
  Object.assign(f.source.skeleton,{modelId:f.source.catalog.modelId,meshRef:f.source.catalog.meshRef,
    animationRef:f.source.catalog.animationRef,animationBones:bones,trackBindings:[0],
    bones:[{...bones[0],position:[0,0,0],orientation:[0,0,0,1]}]});
  for(const sequence of f.source.catalog.sequences) {
    Object.assign(sequence.movement,{duration:10,tracks:[{flags:0,times:[0,10],
      quaternions:[[0,0,0,1],[0,0,0,1]],positions:[[10,0,0],[110,0,0]]}]});
    const note=sound(.2);note.soundInfo.random=100;sequence.notifies=[note];
  }
  loaded.gltf.animations=[new THREE.AnimationClip('idle',1,
    [new THREE.VectorKeyframeTrack('Root.position',[0,1],[50,0,0,60,0,0])])];
  loaded.originalSource=f.source;
  return {...loaded,packet:packet({...f.raw,x:-71000,y:258000,z:-3100}),bone};
}
async function adoptSource(h,loaded,job=0) {
  await flush();h.jobs[job].resolve(loaded);await flush();h.materials.find(row=>row.gltf===loaded.gltf).resolve();await flush();
}

test('actual NPC loop uses original normalized frames, independent per actor, and shared sound draw order',async()=>{
  const h=harness(),a=sourceModel(18342),b=sourceModel(20091);
  b.packet.id=8;b.packet.combat=1;
  const first=h.add(a.packet),second=h.add(b.packet);
  await adoptSource(h,a);await adoptSource(h,b,1);
  assert.equal(first.originalWaitStatus.status,'ready');assert.equal(second.originalWaitStatus.sequence,'atkwait');
  assert.equal(first.originalWaitStatus.frame,Math.fround(.0001));
  assert.equal(a.bone.matrixAutoUpdate,false);assert.equal(first.current,null);
  first.waitSoundEnabled=false;first.update(.5,null);
  assert.equal(h.audio.nativeRandom.draws,1);assert.equal(h.sounds.length,0);
  assert.equal(first.originalWaitStatus.lastNotify.soundDecision.randomValue,38);
  assert.equal(second.originalWaitStatus.frame,Math.fround(.0001),'another actor did not advance');
  second.update(.5,null);
  assert.equal(h.audio.nativeRandom.draws,2);assert.equal(h.sounds.length,1);
  assert.equal(second.originalWaitStatus.lastNotify.soundDecision.randomValue,7719);
  assert.ok(Math.abs(a.bone.matrix.elements[12]-(.1+first.originalWaitStatus.frame))<1e-6);
  const guard=h.sounds[0][2].isCurrent;
  h.manager.remove(8);assert.equal(guard(),false);assert.equal(b.bone.matrixAutoUpdate,true);
  assert.equal(second.originalWaitStatus.notifyCount,1,'retired inspector status retains observed events');
  assert.equal(second.originalWaitStatus.status,'unsupported','retained observation does not claim ongoing source playback');
  assert.equal(a.bone.matrixAutoUpdate,false,'other actor retains source ownership');
  h.manager.clear();assert.equal(a.bone.matrixAutoUpdate,true);
});

test('NPC unported transitions retire before pending model adoption and never re-admit the same actor',async()=>{
  const transitions=[
    (h,n)=>n.attackFlash(),(h,n)=>n.skillFlash(),(h,n)=>n.socialFlash(),
    (h,n)=>n.die(),(h,n)=>n.revive(),(h,n)=>h.add(n.originalNpcInfo ? {...packet(),...n.originalNpcInfo} : packet()),
    (h,n)=>h.manager.setWaitType(n.id,4),(h,n)=>h.manager.setMoveMode(n.id,true),
    (h,n)=>h.manager.move({id:n.id,x:0,y:0,z:0,tx:100,ty:0,tz:0},null),
    (h,n)=>h.manager.place({id:n.id,x:0,y:0,z:0},null),
    (h,n)=>h.manager.retireNpcWait(n.id,'incoming-attack'),
  ];
  for(const transition of transitions) for(const pending of [true,false]) {
    const h=harness(),loaded=sourceModel(),npc=h.add(loaded.packet);
    if(!pending)await adoptSource(h,loaded);
    transition(h,npc);
    if(pending)await adoptSource(h,loaded);
    assert.equal(npc.originalWait,null);assert.equal(npc._initialWaitEligible,false);
    npc.target=null;npc.dead=false;npc._startOriginalWait();
    assert.equal(npc.originalWait,null,'resetting compatibility flags cannot recreate native history');
    assert.equal(loaded.bone.matrixAutoUpdate,true);assert.equal(h.audio.nativeRandom.draws,0);
    h.manager.clear();
  }
});

test('fresh same-ID replacement may start a new source loop; stale actor and queued sound stay retired',async()=>{
  const h=harness(),a=sourceModel(),old=h.add(a.packet);await adoptSource(h,a);
  old.update(.5,null);const guard=h.sounds[0][2].isCurrent;
  h.manager.remove(old.id);const b=sourceModel(),fresh=h.add(b.packet);await adoptSource(h,b,1);
  assert.equal(fresh.originalWaitStatus.status,'ready');assert.notEqual(fresh,old);assert.equal(guard(),false);
  old.update(1,null);assert.equal(h.audio.nativeRandom.draws,1);
  fresh.update(.5,null);assert.equal(h.audio.nativeRandom.draws,2);
  h.manager.clear();
});

test('invalid source pose leaves converted playback usable, without a hidden stopped mixer',async()=>{
  const h=harness(),loaded=sourceModel();loaded.originalSource.catalog.sequences[0].movement.tracks=[];
  const npc=h.add(loaded.packet);await adoptSource(h,loaded);
  assert.equal(npc.originalWaitStatus.status,'unsupported');assert.equal(npc.modelLoadError,null);
  assert.equal(npc.current,npc.actions.idle);npc.update(.1,null);
  assert.equal(loaded.bone.matrixAutoUpdate,true);assert.ok(loaded.bone.position.x>50);
  assert.equal(h.audio.nativeRandom.draws,0);h.manager.clear();
});

test('initial source loop is not generalized beyond the audited source level',async()=>{
  for(const tile of ['22_22','23_12']) {
    const h=harness({readyTile:tile}),loaded=sourceModel(),npc=h.add(loaded.packet,tile);await adoptSource(h,loaded);
    assert.equal(npc.originalWaitStatus.reason,'unverified-initial-source-level');
    npc.update(.5,null);assert.equal(h.audio.nativeRandom.draws,0);
    assert.equal(loaded.bone.matrixAutoUpdate,true);h.manager.clear();
  }
  const h=harness(),loaded=sourceModel();loaded.packet.x=80000;loaded.packet.y=140000;
  const npc=h.add(loaded.packet);await adoptSource(h,loaded);
  assert.equal(npc.originalWaitStatus.reason,'unverified-initial-source-level','old displayed tile cannot admit a foreign packet');
  h.manager.clear();
});

test('original resources and scene readiness join in either order without replaying loading time',async()=>{
  for(const first of ['model','scene']) {
    const h=harness({sceneReady:false}),loaded=sourceModel(),npc=h.add(loaded.packet);
    const snapshot=npc.originalNpcInfo;
    if(first==='model') {
      await adoptSource(h,loaded);
      assert.equal(npc.originalWaitStatus.reason,'waiting-for-initial-source-scene');
      npc.update(.5,null);
      assert.equal(npc.current,npc.actions.idle,'converted playback remains usable while waiting');
      assert.equal(loaded.bone.matrixAutoUpdate,true);
      assert.equal(h.audio.nativeRandom.draws,0);
    }
    assert.equal(h.manager.setNpcWorldScene(terrainFor('17_25'),h.entry),true);
    if(first==='scene') {
      assert.equal(npc.originalWaitStatus.reason,'waiting-for-original-resources');
      assert.equal(npc.originalWait == null,true);
      await adoptSource(h,loaded);
    }
    assert.equal(npc.originalNpcInfo,snapshot,'readiness must not recreate the packet');
    assert.equal(npc.originalWaitStatus.status,'ready',first);
    assert.equal(npc.originalWaitStatus.frame,Math.fround(.0001));
    assert.equal(npc.originalWaitStatus.notifyCount,0);
    assert.equal(h.audio.nativeRandom.draws,0,'loading time produces no synthetic events');
    npc.update(.5,null);assert.equal(h.audio.nativeRandom.draws,1);
    h.manager.clear();
  }
});

test('the first world entry binds untouched pre-entry packets in both model readiness orders',async()=>{
  for(const modelBeforeEntry of [false,true]) {
    const h=harness({worldEntry:false}),loaded=sourceModel(),npc=h.add(loaded.packet);
    const snapshot=npc.originalNpcInfo;
    if(modelBeforeEntry) {
      await adoptSource(h,loaded);
      assert.equal(npc.originalWaitStatus.reason,'waiting-for-world-entry');
      npc.update(.5,null);assert.equal(h.audio.nativeRandom.draws,0);
    }
    const entry=h.manager.beginNpcWorldEntry(()=>h.session.current);
    assert.ok(entry);assert.equal(Object.isFrozen(entry),true);
    assert.equal(npc.originalNpcInfo,snapshot);
    assert.equal(h.manager.setNpcWorldScene(terrainFor('17_25'),entry),true);
    if(!modelBeforeEntry)await adoptSource(h,loaded);
    assert.equal(npc.originalWaitStatus.status,'ready');
    assert.equal(npc.originalWaitStatus.frame,Math.fround(.0001));
    h.manager.clear();
  }
});

test('manual inspection without an entry keeps converted playback and refuses unrelated readiness tokens',async()=>{
  const h=harness({worldEntry:false}),other=harness(),loaded=sourceModel(),npc=h.add(loaded.packet);
  await adoptSource(h,loaded);npc.update(.5,null);
  assert.equal(npc.originalWait == null,true);assert.equal(npc.originalWaitStatus.reason,'waiting-for-world-entry');
  assert.equal(npc.current,npc.actions.idle);assert.ok(loaded.bone.position.x>50);
  assert.equal(loaded.bone.matrixAutoUpdate,true);assert.equal(h.audio.nativeRandom.draws,0);
  assert.equal(h.manager.setNpcWorldScene(terrainFor('17_25'),null),false);
  assert.equal(h.manager.setNpcWorldScene(terrainFor('17_25'),other.entry),false);
  assert.equal(h.manager.beginNpcWorldEntry(()=>false),null);
  assert.equal(npc.originalWait == null,true);
  h.manager.clear();other.manager.clear();
});

test('repeated scene readiness preserves the exact live channel, pose, frame and random stream',async()=>{
  const h=harness(),loaded=sourceModel(),npc=h.add(loaded.packet);await adoptSource(h,loaded);
  npc.update(.5,null);
  const owned=npc.originalWait,frame=owned.channel.frame,epoch=npc._waitPoseEpoch;
  const status=plain(npc.originalWaitStatus),stops=npc.mixer.stops,draws=h.audio.nativeRandom.draws;
  const snapshot=npc.originalNpcInfo,guard=h.sounds[0][2].isCurrent;
  for(let i=0;i<3;i++)assert.equal(h.manager.setNpcWorldScene(terrainFor('17_25'),h.entry),true);
  assert.equal(npc.originalWait,owned);assert.equal(owned.channel.frame,frame);
  assert.equal(npc._waitPoseEpoch,epoch);assert.equal(npc.mixer.stops,stops);
  assert.deepEqual(plain(npc.originalWaitStatus),status);assert.equal(npc.originalNpcInfo,snapshot);
  assert.equal(h.audio.nativeRandom.draws,draws);assert.equal(h.sounds.length,1);assert.equal(guard(),true);
  npc.update(.1,null);assert.notEqual(owned.channel.frame,frame,'the existing channel keeps advancing');
  h.manager.clear();
});

test('pending scene readiness cannot erase intervening movement, state, or snapshot transitions',async()=>{
  const transitions=[
    ['movement',(h,n)=>h.manager.move({id:n.id,x:-71000,y:258000,z:-3100,tx:-70900,ty:258000,tz:-3100},null)],
    ['attack',(h,n)=>n.attackFlash()],['skill',(h,n)=>n.skillFlash()],
    ['death',(h,n)=>n.die()],['wait-type',(h,n)=>h.manager.setWaitType(n.id,4)],
    ['snapshot',(h,n)=>h.add({...n.originalNpcInfo,id:n.id,x:-71000,y:258000,z:-3100})],
  ];
  for(const [name,transition] of transitions) {
    const h=harness({sceneReady:false}),loaded=sourceModel(),npc=h.add(loaded.packet);
    await adoptSource(h,loaded);transition(h,npc);
    npc.target=null;npc.dead=false;
    assert.equal(h.manager.setNpcWorldScene(terrainFor('17_25'),h.entry),true);
    assert.equal(npc.originalWait,null,name);assert.equal(npc._initialWaitEligible,false,name);
    assert.equal(loaded.bone.matrixAutoUpdate,true);assert.equal(h.audio.nativeRandom.draws,0);
    h.manager.clear();
  }
});

test('readiness uses the frozen first snapshot and never reuses eligibility after a replacement snapshot',async()=>{
  const h=harness({sceneReady:false}),loaded=sourceModel(),npc=h.add(loaded.packet);
  const initial=npc.originalNpcInfo,rate=initial.speedMul,tail=plain(initial.npcInfoTail);
  loaded.packet.combat=1;loaded.packet.speedMul=9;
  loaded.packet.npcInfoTail.extension.bytes[0]=255;
  await adoptSource(h,loaded);
  assert.equal(h.manager.setNpcWorldScene(terrainFor('17_25'),h.entry),true);
  assert.equal(npc.originalNpcInfo,initial);assert.equal(npc.originalWait.channel.plan.seq,'Wait');
  assert.equal(npc.originalWait.channel.plan.rate,Math.fround(rate));
  assert.deepEqual(plain(initial.npcInfoTail),tail);
  h.add({...loaded.packet,dead:false});const replacement=npc.originalNpcInfo;
  assert.notEqual(replacement,initial);assert.equal(npc._initialWaitEligible,false);
  assert.equal(h.manager.setNpcWorldScene(terrainFor('17_25'),h.entry),true);
  assert.equal(npc.originalNpcInfo,replacement);assert.equal(npc.originalWait,null);
  h.manager.clear();
});

test('a scene outside the proven domain retires active or pending admission permanently',async()=>{
  for(const active of [false,true]) {
    const h=harness({sceneReady:active}),loaded=sourceModel(),npc=h.add(loaded.packet);
    await adoptSource(h,loaded);
    assert.equal(h.manager.setNpcWorldScene(terrainFor('22_22'),h.entry),true);
    assert.equal(npc.originalWait,null);assert.equal(npc._initialWaitEligible,false);
    assert.equal(h.manager.setNpcWorldScene(terrainFor('17_25'),h.entry),true);
    assert.equal(npc.originalWait,null);assert.equal(loaded.bone.matrixAutoUpdate,true);
    assert.equal(h.audio.nativeRandom.draws,0);h.manager.clear();
  }
});

test('source identity rejection at readiness is terminal, even if the object is later changed to match',async()=>{
  const h=harness({sceneReady:false}),loaded=sourceModel(),npc=h.add(loaded.packet);
  await adoptSource(h,loaded);
  const sourceFiles=loaded.originalSource.record.sourceFiles;
  loaded.originalSource.record.sourceFiles={...sourceFiles,'system/Engine.u':'0'.repeat(64)};
  assert.equal(h.manager.setNpcWorldScene(terrainFor('17_25'),h.entry),true);
  assert.equal(npc.originalWait == null,true);assert.equal(npc._initialWaitEligible,false);
  loaded.originalSource.record.sourceFiles=sourceFiles;
  assert.equal(h.manager.setNpcWorldScene(terrainFor('17_25'),h.entry),true);
  assert.equal(npc.originalWait == null,true);assert.equal(npc.current,npc.actions.idle);
  assert.equal(loaded.bone.matrixAutoUpdate,true);h.manager.clear();
});

test('an expired session predicate blocks pending loads and active clocks and queued sounds without reset',async()=>{
  for(const stage of ['model','scene','active']) {
    const h=harness({sceneReady:stage!=='scene'}),loaded=sourceModel(),npc=h.add(loaded.packet);
    if(stage!=='model')await adoptSource(h,loaded);
    let guard=null;
    if(stage==='active'){npc.update(.5,null);guard=h.sounds[0][2].isCurrent;}
    const draws=h.audio.nativeRandom.draws;h.session.current=false;
    if(guard)assert.equal(guard(),false,'async audio must reject before another entity update');
    assert.equal(h.manager.setNpcWorldScene(terrainFor('17_25'),h.entry),false);
    if(stage==='model')await adoptSource(h,loaded);
    else if(stage==='scene')npc._startOriginalWait();
    npc.update(.5,null);
    assert.equal(npc.originalWait,null);assert.equal(npc._initialWaitEligible,false);
    assert.equal(h.audio.nativeRandom.draws,draws);assert.equal(loaded.bone.matrixAutoUpdate,true);
    h.manager.clear();
  }
});

test('reset and replacement entries retire old pending/active ownership and permit only fresh actors',async()=>{
  for(const operation of ['reset','replace'])for(const stage of ['model','scene','active']) {
    const h=harness({sceneReady:stage!=='scene'}),loaded=sourceModel(),old=h.add(loaded.packet);
    if(stage!=='model')await adoptSource(h,loaded);
    let guard=null;if(stage==='active'){old.update(.5,null);guard=h.sounds[0][2].isCurrent;}
    const draws=h.audio.nativeRandom.draws;
    if(operation==='reset')h.manager.resetNpcWorldEntry();
    const entry=h.manager.beginNpcWorldEntry(()=>true);
    assert.notEqual(entry,h.entry);assert.equal(h.entry.isCurrent(),false);
    assert.equal(h.manager.setNpcWorldScene(terrainFor('17_25'),h.entry),false);
    assert.equal(h.manager.setNpcWorldScene(terrainFor('17_25'),entry),true);
    if(stage==='model')await adoptSource(h,loaded);
    assert.equal(old.originalWait,null);assert.equal(old._initialWaitEligible,false);
    if(guard)assert.equal(guard(),false);
    old.update(.5,null);assert.equal(h.audio.nativeRandom.draws,draws);
    const fresh=sourceModel();fresh.packet.id=8;const npc=h.add(fresh.packet);await adoptSource(h,fresh,1);
    assert.equal(npc.originalWaitStatus.status,'ready');assert.equal(npc.originalWaitStatus.frame,Math.fround(.0001));
    assert.equal(loaded.bone.matrixAutoUpdate,true);assert.equal(fresh.bone.matrixAutoUpdate,false);
    h.manager.clear();
  }
});

test('raw NpcInfo snapshots replace only own received fields, retaining zero independently of compatibility fallbacks',async()=>{
  const h=harness({holdManifest:true}),msg=packet({waitType:0,speedMul:0,collisionRadius:0,collisionHeight:0});
  const npc=h.add(msg);
  assert.deepEqual(plain(npc.originalNpcInfo),{npcId:9,combat:0,waitType:0,rhand:0,chest:0,lhand:0,speedMul:0,running:0,dead:0,collisionRadius:0,collisionHeight:0});
  assert.equal(npc.speedMul,1,'existing compatibility fallback does not contaminate source snapshot');
  assert.equal(Object.isFrozen(npc.originalNpcInfo),true);msg.combat=1;assert.equal(npc.originalNpcInfo.combat,0);
  h.add({id:7,npcId:9,dead:false});
  assert.deepEqual(plain(npc.originalNpcInfo),{npcId:9,dead:false});
  h.add(Object.assign(Object.create({combat:1,speedMul:99}),{id:7,dead:0}));
  assert.deepEqual(plain(npc.originalNpcInfo),{dead:0},'missing and inherited fields never persist');
  h.manager.clear();h.manifest.resolve(h.modelRows);await flush();assert.equal(h.jobs.length,0);
});

test('raw creation/effect tail snapshots deep-copy and freeze arrays without carrying missing updates forward',()=>{
  const h=harness({holdManifest:true});
  const tail={prefix:[1,-2,3],extension:{dwords:[-2147483648,2,3,4,5],bytes:[128,255],
    doubles:[12.75,28.125],finalDwords:[-1,0]}};
  const msg=packet({summonAnimationRaw:0,npcInfoTail:tail}),npc=h.add(msg);
  const retained=npc.originalNpcInfo;
  assert.equal(retained.summonAnimationRaw,0);assert.deepEqual(plain(retained.npcInfoTail),tail);
  assert.notEqual(retained.npcInfoTail,tail);
  for(const value of [retained.npcInfoTail,retained.npcInfoTail.prefix,retained.npcInfoTail.extension,
    ...Object.values(retained.npcInfoTail.extension)])assert.equal(Object.isFrozen(value),true);
  tail.prefix[0]=99;tail.extension.dwords[0]=0;tail.extension.bytes.push(0);msg.summonAnimationRaw=2;
  assert.equal(retained.npcInfoTail.prefix[0],1);assert.equal(retained.npcInfoTail.extension.dwords[0],-2147483648);
  assert.deepEqual(plain(retained.npcInfoTail.extension.bytes),[128,255]);assert.equal(retained.summonAnimationRaw,0);
  assert.throws(()=>{retained.npcInfoTail.extension.doubles[0]=0;},TypeError);
  h.add({id:7,npcId:9,summonAnimationRaw:2});
  assert.deepEqual(plain(npc.originalNpcInfo),{npcId:9,summonAnimationRaw:2});
  h.add({id:7,npcId:9});
  assert.deepEqual(plain(npc.originalNpcInfo),{npcId:9});
  h.manager.clear();
});

test('removal before manifest/scale work retires owned placeholders and ignores late title/type results',async()=>{
  const h=harness({holdManifest:true}),npc=h.add(packet()),counts=[];
  for(const mesh of npc.capsuleMeshes)for(const resource of [mesh.geometry,mesh.material]) {
    const count={value:0};resource.addEventListener('dispose',()=>count.value++);counts.push(count);
  }
  const label=npc.label;h.manager.remove(7);npc.retire();
  h.manifest.resolve(h.modelRows);h.titles.resolve({9:'Late title'});await flush();
  assert.equal(npc._retired,true);assert.equal(npc.npcType,undefined);assert.equal(npc.title,undefined);
  assert.equal(label.userData.nameplate.title,undefined);assert.equal(npc.group.parent,null);
  assert.equal(h.jobs.length,0);assert.ok(counts.every(count=>count.value===1));
});

test('late model load after remove cannot adopt into retired actor or its same-ID replacement',async()=>{
  const h=harness(),old=h.add(packet());await flush();h.manager.remove(7);
  const fresh=h.add(packet({name:'Replacement'}));await flush();
  const freshModel=await adopt(h,1),stale=model();h.jobs[0].resolve(stale);await flush();
  assert.equal(h.manager.getEntity(7),fresh);assert.equal(fresh.monsterRoot,freshModel.root);
  assert.equal(old.monsterRoot,undefined);assert.equal(old.pickResourcesReady,false);
  assert.equal(stale.root.parent,null);assert.equal(h.materials.length,1,'retired model never starts material work');
  assert.deepEqual(h.warnings,[]);assert.deepEqual(stale.disposal,{material:0,texture:0,geometry:0});
});

test('actor-owned source skin retires on removal, obsolete loads and failed adoption',async()=>{
  for(const stage of ['adopted','loading','materials','invalid']) {
    const h=harness(),npc=h.add(packet());await flush();const loaded=model();let disposed=0;
    loaded.originalSource={disposeSkin:()=>disposed++};
    if(stage==='loading')h.manager.remove(7);
    if(stage==='invalid')loaded.overrides={idle:'AbsentSourceClip'};
    h.jobs[0].resolve(loaded);await flush();
    if(stage==='materials')h.manager.remove(7);
    if(stage!=='loading'){h.materials[0].resolve();await flush();}
    if(stage==='adopted')assert.equal(disposed,0,'live actor keeps its owned geometry');
    h.manager.remove(7);npc.retire();
    assert.equal(disposed,1,stage);
    assert.deepEqual(loaded.disposal,{material:0,texture:0,geometry:0},'shared model resources remain untouched');
  }
});

test('removal while original materials await prevents late admission and never disposes shared asset resources',async()=>{
  const h=harness(),npc=h.add(packet());await flush();const loaded=model();h.jobs[0].resolve(loaded);await flush();
  assert.equal(h.materials.length,1);h.manager.remove(7);h.materials[0].resolve();await flush();
  assert.equal(npc.monsterRoot,undefined);assert.equal(npc.mixer,null);assert.equal(loaded.root.parent,null);
  assert.deepEqual(loaded.disposal,{material:0,texture:0,geometry:0});assert.deepEqual(h.warnings,[]);
});

test('template changes at one object ID retire the old upgrade; complete same-template updates preserve latest raw state',async()=>{
  const h=harness(),old=h.add(packet());await flush();
  const fresh=h.add(packet({npcId:10,chest:333,dead:1,speedMul:0}));await flush();
  assert.notEqual(old,fresh);assert.equal(old._retired,true);assert.equal(old.group.parent,null);
  h.add(packet({npcId:10,combat:2,rhand:0,chest:0,lhand:0,dead:0,speedMul:-1}));
  const loaded=await adopt(h,1);h.jobs[0].resolve(model());await flush();
  assert.equal(fresh.monsterRoot,loaded.root);assert.equal(fresh.dead,false);
  assert.equal(fresh.originalNpcInfo.combat,2);assert.equal(fresh.originalNpcInfo.speedMul,-1);
  assert.equal(fresh.originalNpcInfo.chest,0);assert.equal(h.scene.children.length,1);
});

test('clear stops entity mixer and queued timers; retained callbacks cannot mutate retired materials',async()=>{
  const h=harness(),npc=h.add(packet()),loaded=await adopt(h);
  npc._playTimed('idle',1);const attack=[...h.timers.values()][0];
  npc.die();const fade=[...h.timers.values()][0],mixer=npc.mixer;
  h.manager.clear();assert.equal(h.timers.size,0);assert.equal(mixer.stops,1);assert.deepEqual(mixer.uncached,[loaded.root]);
  attack();fade();npc.revive();npc.update(.1,{heightAtWorld:()=>0});
  assert.equal(loaded.material.opacity,1);assert.equal(npc.actions,null);assert.equal(npc.mixer,null);
  assert.equal(npc.pickResourcesReady,false);assert.deepEqual(loaded.disposal,{material:0,texture:0,geometry:0});
});

test('obsolete upgrade failures stay silent; invalid overrides cannot partially adopt and current retry succeeds',async()=>{
  const h=harness(),old=h.add(packet());await flush();h.manager.remove(7);
  const fresh=h.add(packet());await flush();h.jobs[0].reject(new Error('retired load'));await flush();
  assert.deepEqual(h.warnings,[]);
  const bad=model();bad.overrides={idle:'MissingExact'};h.jobs[1].resolve(bad);await flush();h.materials[0].resolve();await flush();
  assert.equal(h.warnings.length,1);assert.equal(fresh.monsterRoot,undefined);assert.equal(fresh.pickResourcesReady,false);
  assert.match(fresh.modelLoadError,/missing: MissingExact/);
  assert.equal(fresh.capsuleMeshes.length,2);assert.equal(h.mixers[0].stops,1);assert.deepEqual(h.mixers[0].uncached,[bad.root]);
  const retry=fresh.upgradeToMonster();const loaded=await adopt(h,2);await retry;
  assert.equal(fresh.monsterRoot,loaded.root);assert.equal(fresh.pickResourcesReady,true);assert.equal(fresh.modelLoadError,null);
});

test('a newer explicit upgrade attempt owns adoption even when an older request finishes last',async()=>{
  const h=harness(),npc=h.add(packet());await flush();const second=npc.upgradeToMonster();await flush();
  const loaded=await adopt(h,1);await second;h.jobs[0].resolve(model());await flush();
  assert.equal(npc.monsterRoot,loaded.root);assert.equal(h.materials.length,1);
  assert.equal(npc.group.children.filter(child=>child===loaded.root).length,1);assert.deepEqual(h.warnings,[]);
});
