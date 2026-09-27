// Actual inspector helpers/handlers with source-free DOM, fetch and source-pose
// substitutes. Three's real mixer checks action isolation; no browser is run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three.module.min.js';

const html=fs.readFileSync(new URL('./pawn-original.html',import.meta.url),'utf8');
const start=html.indexOf('function controls('),end=html.indexOf('function resize(){');
assert.ok(start>=0&&end>start,'actual source preview helpers and handlers must be present');
const source=html.slice(start,end);
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function element(value=''){
  return {value,disabled:false,checked:false,textContent:'',className:'',listeners:new Map(),
    addEventListener(event,fn){this.listeners.set(event,fn);},
    fire(event,data={}){return this.listeners.get(event)?.(data);}};
}
function catalog(modelId='source'){
  return {format:'elbera-original-animation-tracks-v1',modelId,animationRef:`Original.${modelId}_anim`,
    source:{packageSHA256:'a'.repeat(64)},sequences:[{name:'OriginalCast'}]};
}
function actor(){
  const model=new THREE.Group(),bone=new THREE.Bone();bone.name='Bone';model.add(bone);
  const group=new THREE.Group();group.add(model);
  const mixer=new THREE.AnimationMixer(model);
  const clip=(name,x)=>new THREE.AnimationClip(name,2,[new THREE.NumberKeyframeTrack('Bone.position[x]',[0,2],[x,x])]);
  const selected=mixer.clipAction(clip('selected',10)),oldPhase=mixer.clipAction(clip('old-phase',30));
  return {model,group,bone,mixer,actions:{selected},selected,oldPhase,cancelled:0,active:null,
    cancelAppearance(){},cancelCast(){this.cancelled++;this.active=null;},
    setWaitType(type){this.active=`wait:${type}`;return {status:'ready'};},
    startCastSchedule(){this.active='cast';return {status:'ready'};}};
}
function harness(){
  const requests=[],sideRequests=[],loads=[],factoryCalls=[],baselines=[],els=new Map();
  const el=id=>{if(!els.has(id))els.set(id,element());return els.get(id);};
  const inspected=actor(),scene=new THREE.Scene();scene.add(inspected.group);
  const binding={slots:{castEnd:{hand:{seq:'OriginalCast',clip:'selected'}}}};
  const context=vm.createContext({
    THREE,AbortController,URL,encodeURIComponent,
    document:{querySelector:id=>el(id)},
    character:inspected,action:inspected.selected,generation:1,poseIntent:0,poseTime:0,
    originalCatalog:null,originalSkeleton:null,originalPreview:null,originalRequest:null,
    originalEnabled:el('#original-enabled'),originalLoad:el('#original-load'),
    originalStatus:el('#original-status'),originalSource:el('#original-source'),
    model:el('#model'),slot:el('#slot'),stance:el('#stance'),
    play:el('#play'),pause:el('#pause'),position:el('#position'),time:el('#time'),
    source:el('#source'),status:el('#status'),
    playing:false,castPlaying:false,waitPlaying:false,previewCast:null,
    pawn:{models:{source:binding,other:binding},clips:{source:{},other:{}}},
    effects:{},animationMeta:{},faceGeneration:0,face:el('#face'),
    faceChoices(){},sourceFaces(){return null;},
    choices(select,rows,selected){select.value=rows.some(row=>row[0]===selected)?selected:rows[0]?.[0]||'';},
    scene,orbit:{target:new THREE.Vector3()},camera:new THREE.PerspectiveCamera(),
    location:{href:'http://localhost/test/pawn-original.html'},history:{replaceState(){}},
    manifest:{models:[{id:'source',className:'Source',gender:'fixture',gltf:'source.gltf'},
      {id:'other',className:'Other',gender:'fixture',gltf:'other.gltf'}]},
    Character:class{constructor(){const item=actor(),task=deferred();item.load=url=>{loads.push({url,item,...task});return task.promise;};return item;}},
    skillFx:{clear(){},cancel(){},nativeContexts:new Map()},
    createOriginalPosePreview(root,data,sequence,skeleton){
      factoryCalls.push({root,data,sequence,skeleton});
      return {duration:2,boneCount:1,mappedCount:1,referenceCount:0,restore(){},apply(frame){
        const bone=root.getObjectByName('Bone');baselines.push({x:bone.position.x,frame});
        bone.position.x=11;
        return {basisDelta:0,positionDelta:1,wrapped:0,hemisphereFlipped:0,flipped:0};
      }};
    },
    fetch(url,options){const task=deferred();(url.endsWith('.skeleton.json')?sideRequests:requests).push({url,options,...task});return task.promise;},
    waitAudio:el('#wait-audio'),waitStatus:el('#wait-status'),waitLines:[],waitEvents:el('#wait-events'),
    castAudio:el('#cast-audio'),castSkill:el('#cast-skill'),castLevel:el('#cast-level'),
    castHit:el('#cast-hit'),castSpeed:el('#cast-speed'),castOutput:el('#cast-output'),
    castStatus:el('#cast-status'),castEvents:el('#cast-events'),notifyCount:el('#notify-count'),
    castCompleteText:'',eventLines:[],agentLines:[],lastAgentTick:null,
    agentEvents:el('#agent-events'),agentPreview:el('#agent-preview'),agentStatus:el('#agent-status'),
    castSchedule(){return {status:'ready',rate:1,tween:.2,shotTime:1,phases:[{slot:'castEnd',clip:'selected',due:2}]};},
    skillAnimInfo(){return {};},skillAgentBinding(){return {};},audio:{manifest:null,resume(){}},
  });
  context.model.value='source';context.slot.value='castEnd';context.stance.value='hand';
  for(const [id,value] of [['#cast-skill','1'],['#cast-level','1'],['#cast-hit','1000'],['#cast-speed','333']])el(id).value=value;
  vm.runInContext(source,context);
  const completeSide=(index,data={modelId:'source',meshRef:'Original.Face'})=>sideRequests[index].resolve({ok:true,json:async()=>data});
  const complete=(index,data=catalog())=>{requests[index].resolve({ok:true,json:async()=>data});completeSide(index);};
  return {context,inspected,requests,sideRequests,loads,factoryCalls,baselines,el,complete,completeSide};
}

test('actual load callback adopts matching source keys and samples an isolated exported baseline',async()=>{
  const h=harness();h.inspected.oldPhase.play();h.inspected.mixer.update(0);
  assert.equal(h.inspected.bone.position.x,30);
  const work=h.el('#original-load').fire('click');
  assert.equal(h.el('#original-load').disabled,true);
  assert.equal(h.requests[0].url,'/gamedata/animation-tracks/source.json');
  assert.equal(h.requests[0].options.cache,'no-cache');
  h.complete(0);await work;
  assert.equal(h.context.originalCatalog.modelId,'source');
  assert.equal(h.el('#original-enabled').checked,true);
  assert.equal(h.el('#original-enabled').disabled,false);
  assert.equal(h.el('#original-load').disabled,false);
  assert.equal(h.baselines[0].x,10,'an old phase at 30 must not blend the comparison to 20');
  assert.equal(h.inspected.bone.position.x,11);
  assert.equal(h.inspected.oldPhase.isScheduled(),false);
  assert.match(h.el('#original-source').textContent,/Original\.source_anim.*package SHA256/);
});

test('late loading retains data but cannot replace newer cast, wait, play, scrub, pause or cancel intent',async()=>{
  for(const [id,event,data] of [['#cast-form','submit',{preventDefault(){}}],
      ['#wait-sit','click',{}],['#play','click',{}],['#position','input',{}],
      ['#pause','click',{}],['#cast-cancel','click',{}]]){
    const h=harness();h.el('#position').value='1';
    const work=h.el('#original-load').fire('click');
    h.el(id).fire(event,data);
    const expected={intent:h.context.poseIntent,cancelled:h.inspected.cancelled,active:h.inspected.active,
      playing:h.context.playing,cast:h.context.castPlaying,wait:h.context.waitPlaying,poseTime:h.context.poseTime};
    assert.ok(expected.intent>0,`${id} must retire pending automatic activation`);
    h.complete(0);await work;
    assert.equal(h.context.originalCatalog.modelId,'source',id);
    assert.equal(h.el('#original-enabled').checked,false,id);
    assert.deepEqual({intent:h.context.poseIntent,cancelled:h.inspected.cancelled,active:h.inspected.active,
      playing:h.context.playing,cast:h.context.castPlaying,wait:h.context.waitPlaying,poseTime:h.context.poseTime},expected,id);
    assert.equal(h.baselines.length,0,`${id}: source pose must not have been applied`);
  }
});

test('actual model selection aborts and discards pending source data before adopting another actor',async()=>{
  const h=harness();const originalWork=h.el('#original-load').fire('click');
  const body=deferred(),readingBody=deferred();
  h.requests[0].resolve({ok:true,json(){readingBody.resolve();return body.promise;}});
  await readingBody.promise;h.completeSide(0);
  h.el('#model').value='other';const modelWork=h.el('#model').fire('change');
  assert.equal(h.requests[0].options.signal.aborted,true);
  assert.equal(h.context.originalCatalog,null);assert.equal(h.context.character,null);
  assert.equal(h.loads[0].url,'/characters/other.gltf');
  const message=h.el('#original-status').textContent;
  body.resolve(catalog());await originalWork;
  assert.equal(h.el('#original-status').textContent,message);
  assert.equal(h.context.originalCatalog,null);assert.equal(h.factoryCalls.length,0);
  h.loads[0].resolve();await modelWork;
  assert.equal(h.context.character,h.loads[0].item);
  assert.equal(h.el('#original-enabled').checked,false);
  assert.equal(h.context.originalCatalog,null);
});

test('aborted source response cannot clear or overwrite its replacement request',async()=>{
  const h=harness(),first=h.el('#original-load').fire('click');
  const second=h.el('#original-load').fire('click');
  assert.equal(h.requests[0].options.signal.aborted,true);
  const active=h.context.originalRequest;
  h.complete(0);await first;
  assert.equal(h.context.originalRequest,active);
  assert.equal(h.el('#original-load').disabled,true);
  assert.equal(h.context.originalCatalog,null);
  h.complete(1);await second;
  assert.equal(h.factoryCalls.length,1);assert.equal(h.context.originalRequest,null);
});

test('identity mismatch cannot admit keys and no-export comparison cannot admit or keep preview',async()=>{
  const h=harness(),work=h.el('#original-load').fire('click');h.complete(0,catalog('other'));await work;
  assert.equal(h.context.originalCatalog,null);assert.equal(h.factoryCalls.length,0);
  assert.match(h.el('#original-status').textContent,/identity does not match/);
  h.context.originalCatalog=catalog();h.context.action=null;h.el('#original-enabled').checked=true;
  h.context.configureOriginalPreview('OriginalCast');
  assert.equal(h.context.originalPreview,null);assert.equal(h.el('#original-enabled').checked,false);
  assert.equal(h.el('#original-enabled').disabled,true);assert.equal(h.factoryCalls.length,0);
  assert.match(h.el('#original-status').textContent,/exported comparison clip is unavailable/);
});

test('mode, play and scrub handlers stop old mixer actions before each comparison sample',()=>{
  for(const trigger of [h=>h.el('#original-enabled').fire('change'),
      h=>h.el('#play').fire('click'),h=>{h.el('#position').value='1';h.el('#position').fire('input');}]){
    const h=harness();h.context.originalCatalog=catalog();h.context.configureOriginalPreview('OriginalCast');
    h.el('#original-enabled').checked=true;
    h.inspected.oldPhase.play();h.inspected.mixer.update(0);
    trigger(h);
    assert.equal(h.baselines.length,1);assert.equal(h.baselines[0].x,10);
    assert.equal(h.inspected.oldPhase.isScheduled(),false);
    h.el('#original-enabled').checked=false;h.el('#original-enabled').fire('change');
    assert.equal(h.inspected.bone.position.x,10,'turning off preview restores the exported comparison pose');
  }
});

test('repeated source samples restore constant exported tracks before measuring every delta',()=>{
  const h=harness();h.context.originalCatalog=catalog();h.context.configureOriginalPreview('OriginalCast');
  h.el('#original-enabled').checked=true;h.el('#original-enabled').fire('change');
  // The real PropertyMixer caches its last output. Source sampling writes 11
  // directly while the exported clip remains 10 at every time; merely resetting
  // the action does not cause that unchanged cached value to be written again.
  for(const seconds of [.25,.5,.75])h.context.sample(seconds);
  assert.deepEqual(h.baselines.map(row=>row.x),[10,10,10,10]);
  assert.equal(h.inspected.bone.position.x,11,'source output still wins after comparison');
  h.el('#original-enabled').checked=false;h.el('#original-enabled').fire('change');
  assert.equal(h.inspected.bone.position.x,10,'returning to export restores the actual exported pose');
});

test('unsupported pose application disables source mode and restores its admitted export baseline',()=>{
  const h=harness();h.context.originalCatalog=catalog();h.context.configureOriginalPreview('OriginalCast');
  h.context.originalPreview.apply=()=>{throw new Error('synthetic unsupported source key');};
  h.el('#original-enabled').checked=true;h.el('#original-enabled').fire('change');
  assert.equal(h.el('#original-enabled').checked,false);assert.equal(h.el('#original-enabled').disabled,true);
  assert.equal(h.context.originalPreview,null);assert.equal(h.context.playing,false);
  assert.equal(h.inspected.bone.position.x,10);
  assert.match(h.el('#original-status').textContent,/Unsupported source pose: synthetic unsupported source key/);
});


test('keys and source skeleton are adopted together; missing sidecar leaves current data unchanged',async()=>{
  const h=harness(),work=h.el('#original-load').fire('click');
  assert.equal(h.sideRequests[0].url,'/gamedata/animation-tracks/source.skeleton.json');
  assert.equal(h.sideRequests[0].options.signal,h.requests[0].options.signal);
  h.requests[0].resolve({ok:true,json:async()=>catalog()});
  await Promise.resolve();await Promise.resolve();
  assert.equal(h.context.originalCatalog,null);assert.equal(h.factoryCalls.length,0);
  h.sideRequests[0].resolve({ok:false,status:404});await work;
  assert.equal(h.context.originalCatalog,null);assert.equal(h.context.originalSkeleton,null);
  assert.match(h.el('#original-status').textContent,/--skeletons --write/);
  assert.equal(h.el('#original-load').disabled,false);
});

test('actual source matrices are restored before exported playback, errors and model disposal',async()=>{
  const {createOriginalPosePreview}=await import('../js/sourcepose.js');
  for(const exit of ['toggle','error','model','slot']){
    const h=harness();h.context.createOriginalPosePreview=createOriginalPosePreview;
    const bone={name:'Bone',parent:0};
    const track={flags:0,times:[0],quaternions:[[0,0,0,1]],positions:[[1100,0,0]]};
    h.context.originalCatalog={...catalog(),bones:[bone],source:{packageSHA256:'a'.repeat(64),exportSHA256:'b'.repeat(64)},
      sequences:[{name:'OriginalCast',rate:1,frames:2,movement:{flags:0,startBone:0,duration:2,boneIndices:[],tracks:[track]}}]};
    h.context.originalSkeleton={format:'elbera-original-player-skeleton-v1',modelId:'source',animationRef:'Original.source_anim',
      bones:[{...bone,orientation:[0,0,0,1],position:[1000,0,0]}],animationBones:[bone],trackBindings:[0],
      source:{packageSHA256:'a'.repeat(64),animationExportSHA256:'b'.repeat(64)}};
    h.context.configureOriginalPreview('OriginalCast');h.el('#original-enabled').checked=true;
    h.el('#original-enabled').fire('change');h.context.sample(.5);
    assert.equal(h.inspected.bone.matrixAutoUpdate,false,exit);
    assert.equal(h.inspected.bone.matrixWorld.elements[12],11,exit);
    assert.equal(h.inspected.bone.position.x,10,'source matrices must not replace mixer TRS');
    if(exit==='toggle'){h.el('#original-enabled').checked=false;h.el('#original-enabled').fire('change');}
    if(exit==='error'){track.positions[0][0]=NaN;h.context.sample(.7);}
    if(exit==='slot')h.context.selectSlot();
    if(exit==='model'){
      h.el('#model').value='other';const work=h.el('#model').fire('change');
      assert.equal(h.inspected.bone.matrixAutoUpdate,true,'dispose restores original bone update mode');
      h.loads[0].resolve();await work;continue;
    }
    if(exit==='slot'){
      // Slot selection may explicitly retain source mode; restoring it must
      // still recover an ordinary mixer pose with no manual matrix left over.
      h.el('#original-enabled').checked=false;h.el('#original-enabled').fire('change');
    }
    h.inspected.model.updateMatrixWorld(true);
    assert.equal(h.inspected.bone.matrixAutoUpdate,true,exit);
    assert.equal(h.inspected.bone.matrixWorld.elements[12],10,exit);
  }
});
