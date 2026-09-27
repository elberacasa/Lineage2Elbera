// Elbera Tools: real NPC/manager methods and Three mixers, controlled async
// model/material inputs. No private assets, browser, service or native claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three.module.min.js';

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

function harness({holdManifest=false}={}) {
  const scene=new THREE.Group(),jobs=[],materials=[],warnings=[],mixers=[],timers=new Map();
  const manifest=deferred(),titles=deferred();let timerId=0;
  const modelRows=[{id:'Authored9',gltf:'nine.gltf'},{id:'Authored10',gltf:'ten.gltf'}];
  if(!holdManifest)manifest.resolve(modelRows);
  class Mixer extends THREE.AnimationMixer {
    constructor(root){super(root);this.stops=0;this.uncached=[];mixers.push(this);}
    stopAllAction(){this.stops++;return super.stopAllAction();}
    uncacheRoot(root){this.uncached.push(root);return super.uncacheRoot(root);}
  }
  const context={THREE:{...THREE,AnimationMixer:Mixer},L2_TO_M:.01,NPC_SPEED:1.6,MOVE_TICK_S:.1,
    NAME_COLOR:'#fff',npcColor:()=>new THREE.Color(0),labelScale:()=>1,
    l2ToThree:(x,y,z,out=new THREE.Vector3())=>out.set(x*.01,z*.01,-y*.01),l2HeadingToThreeYaw:()=>0,
    makeLabel:text=>{const label=new THREE.Object3D();label.userData.nameplate={text};return label;},
    titleFor:row=>row ? {text:row,color:null}:null,npcTitles:()=>titles.promise,
    monsterManifest:()=>manifest.promise,npcMeshes:async()=>({9:{mesh:'Authored9',type:'Monster'},10:{mesh:'Authored10',type:'Folk'}}),
    npcVisualMeta:async()=>({}),npcVisualScale:()=>({x:1,y:1,z:1}),GLTFLoader:class {},
    loadNpcAnimationModel:(npcId,entry)=>{const work=deferred();jobs.push({npcId,entry,...work});return work.promise;},
    applyOriginalNpcMaterials:(npcId,entry,gltf)=>{const work=deferred();materials.push({npcId,entry,gltf,...work});return work.promise;},
    setTimeout:callback=>{timers.set(++timerId,callback);return timerId;},clearTimeout:id=>timers.delete(id),
    console:{warn:(...args)=>warnings.push(args)},
  };
  const classes=source.slice(begin).replace('export class EntityManager','class EntityManager');
  const {EntityManager,NpcEntity}=vm.runInNewContext(source.slice(mapBegin,mapEnd)+classes+'\n({EntityManager,NpcEntity});',context);
  const manager=new EntityManager(scene,[]);
  const add=msg=>{manager.addNpc(msg,{heightAtWorld:()=>0});return manager.getEntity(msg.id);};
  return{scene,manager,NpcEntity,add,jobs,materials,warnings,mixers,timers,titles,manifest,modelRows};
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
