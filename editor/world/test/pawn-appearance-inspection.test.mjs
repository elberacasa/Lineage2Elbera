// Actual pawn inspection helpers; source-free DOM and asynchronous loader
// substitutes. These checks do not replace visual browser inspection.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('./pawn-original.html',import.meta.url),'utf8');
const helpers=html.slice(html.indexOf('function choices('),html.indexOf('function controls('));
const releaseSource=html.slice(html.indexOf('function release('),html.indexOf('async function selectModel('));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function harness(){
  const listeners=new Map(),requests=[];
  const face={value:'',disabled:true,children:[],replaceChildren(){this.children=[];this.value='';},
    appendChild(option){this.children.push(option);},addEventListener:(event,fn)=>listeners.set(event,fn)};
  const actor={cancelled:0,cancelAppearance(){this.cancelled++;},setAppearance(value){
    const task=deferred();requests.push({value,...task});return task.promise;
  }};
  const context=vm.createContext({
    appearance:{format:'l2-interlude-player-appearance-v1',models:{source:{
      faceMesh:'Original.Face',nodeName:'FaceNode',materialName:'FaceMaterial',
      faces:[{index:3,texture:'Original.Face3',url:'/faces/Original/Face3.png'},
             {index:7,texture:'Original.Face7',url:'/faces/Original/Face7.png'}],
    }}},faceCatalogError:null,faceGeneration:0,generation:1,character:actor,
    model:{value:'source'},face,faceStatus:{textContent:''},faceSource:{textContent:''},
    document:{createElement:()=>({value:'',textContent:''})},
    scene:{remove(){}},
  });
  vm.runInContext(helpers+releaseSource,context);
  return {context,face,actor,requests,listeners};
}

test('face choices enumerate only exact catalog indices and never invent an initial selection',()=>{
  const h=harness();h.context.faceChoices('source');
  assert.deepEqual(h.face.children.map(option=>option.value),['','3','7']);
  assert.equal(h.face.value,'');assert.match(h.context.faceSource.textContent,/Original.Face/);
  assert.match(h.context.faceStatus.textContent,/No face change requested/);
  h.face.value='0';h.context.applyFace();assert.equal(h.requests.length,0);
});

test('unavailable, ambiguous or malformed source face catalog cannot offer a fabricated face',()=>{
  for(const mutate of [c=>{c.appearance=null;},c=>{c.appearance.format='old';},
    c=>{c.appearance.models.source.faces.push({...c.appearance.models.source.faces[0]});},
    c=>{c.appearance.models.source.nodeName='';}]){
    const h=harness();mutate(h.context);h.context.faceChoices('source');
    assert.equal(h.face.disabled,true);assert.equal(h.face.children.length,1);
    assert.match(h.context.faceStatus.textContent,/Unavailable/);
  }
});

test('actual inspector calls Character.setAppearance and publishes the current result and source reference',async()=>{
  const h=harness();h.face.value='7';const work=h.context.applyFace();
  assert.equal(h.requests[0].value.face,7);assert.match(h.context.faceStatus.textContent,/pending/);
  h.actor.lastAppearance={status:'ready',texture:'Original.Face7'};
  h.requests[0].resolve(h.actor.lastAppearance);await work;
  assert.match(h.context.faceStatus.textContent,/ready: source face 7/);
  assert.match(h.context.faceSource.textContent,/FaceMaterial.*Original.Face7.*\/faces\/Original\/Face7.png/);
});

test('late completion cannot overwrite a newer face request or another actor status',async()=>{
  const h=harness();h.face.value='3';const old=h.context.applyFace();
  h.face.value='7';const current=h.context.applyFace();
  h.requests[1].resolve({status:'ready',texture:'Original.Face7'});await current;
  const expected=h.context.faceStatus.textContent;
  h.requests[0].resolve({status:'error',reason:'old'});await old;
  assert.equal(h.context.faceStatus.textContent,expected);
  h.face.value='3';const retired=h.context.applyFace();
  h.context.character={};h.context.generation++;h.context.faceGeneration++;
  h.context.faceStatus.textContent='Replacement model loading';
  h.requests[2].resolve({status:'ready'});await retired;
  assert.equal(h.context.faceStatus.textContent,'Replacement model loading');
});

test('release cancels pending appearance before disposing an inspected model',()=>{
  const h=harness(),order=[];
  const actor={cancelAppearance:()=>order.push('appearance'),cancelCast:()=>order.push('cast'),
    group:{traverse(){}},model:{},mixer:{stopAllAction(){},uncacheRoot(){}}};
  h.context.release(actor);assert.deepEqual(order,['appearance','cast']);
});
