// Elbera Tools: synthetic inputs through the actual vendored GLTFLoader.
// Only import URLs are adapted for Node; no original assets or native binaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {applyNpcSourceSkin,disposeNpcSourceSkin} from '../js/npc-source-skin.js';
import {verifiedNpcSourceModel} from '../js/npcsourceanim.js';
import {Mesh} from '../vendor/three.module.min.js';
const three = new URL('../vendor/three.module.min.js',import.meta.url).href;
const moduleURL = text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const utils = moduleURL(readFileSync(new URL('../vendor/addons/utils/BufferGeometryUtils.js',import.meta.url),'utf8')
  .replace("from 'three'",`from '${three}'`));
const loaderCode = readFileSync(new URL('../vendor/addons/loaders/GLTFLoader.js',import.meta.url),'utf8')
  .replace("from 'three'",`from '${three}'`).replace("from '../utils/BufferGeometryUtils.js'",`from '${utils}'`);
const {GLTFLoader} = await import(moduleURL(loaderCode));
globalThis.ProgressEvent ??= class {constructor(type,data){this.type=type;Object.assign(this,data);}};
globalThis.crypto ??= webcrypto;
const sha = bytes=>createHash('sha256').update(bytes).digest('hex');
const bits = array=>Array.from(new Uint32Array(array.buffer,array.byteOffset,array.length));
const sourceHash = Object.fromEntries(['meshPackageSHA256','animationPackageSHA256','meshExportSHA256','animationExportSHA256']
  .map((key,i)=>[key,String(i+1).repeat(64)]));
let serial=0;
async function fixture({primitives=1}={}) {
  const f=Math.fround, weights=[[f(.2),f(.3),0,-0],[.5,f(.5000001192092896),0,0],[0,0,0,0]];
  const boneRows=[[1,1,-1,2],[0,2,-1,-1],[-1,-1,-1,-1]];
  const inverse = new Float32Array(48);
  for(let i=0;i<3;i++){for(const j of [0,5,10,15])inverse[i*16+j]=1;inverse[i*16+12]=i+1;}
  const arrays=[new Float32Array([0,0,0,1,0,0,0,1,0]),new Float32Array([0,0,1,0,0,1]),
    new Uint16Array([0,1,2,0,0,1,2,0,0,1,2,0]),new Float32Array(weights.flat()),inverse];
  const views=[];let length=0;
  for(const array of arrays){length=(length+3)&~3;views.push({buffer:0,byteOffset:length,byteLength:array.byteLength});length+=array.byteLength;}
  const binary=Buffer.alloc(length);
  arrays.forEach((array,i)=>binary.set(new Uint8Array(array.buffer),views[i].byteOffset));
  const uri=`synthetic_${++serial}.bin`;
  const document={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,1]}],
    nodes:[{name:'body',mesh:0,skin:0},{name:'root',children:[2,3]},{name:'a'},{name:'b'}],
    buffers:[{uri,byteLength:length}],bufferViews:views,
    accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3,min:[0,0,0],max:[1,1,0]},
      {bufferView:1,componentType:5126,type:'VEC2',count:3},{bufferView:2,componentType:5123,type:'VEC4',count:3},
      {bufferView:3,componentType:5126,type:'VEC4',count:3},{bufferView:4,componentType:5126,type:'MAT4',count:3}],
    meshes:[{primitives:Array.from({length:primitives},()=>({attributes:{POSITION:0,TEXCOORD_0:1,JOINTS_0:2,WEIGHTS_0:3}}))}],
    skins:[{joints:[3,1,2],inverseBindMatrices:4}]};
  const built={modelId:'toy',gltf:'models/'+uri.replace('.bin','.gltf'),gltfSHA256:sha(JSON.stringify(document)),
    buffers:[{uri,byteLength:length,SHA256:sha(binary)}],meshIndex:0,skinIndex:0,boneNodes:[1,2,3],
    sourceLOD0SHA256:'e'.repeat(64),skinProof:{status:'unverified',runtimeInputs:'stored-gpu-soft52'}};
  const modelId='npc_'+sha('toymeshes.group.creature').slice(0,32);
  const skeleton={format:'elbera-original-npc-skeleton-v1',modelId,source:{...sourceHash},bones:[{name:'root'},{name:'a'},{name:'b'}],
    sourceSkin:{format:'elbera-original-npc-skin-inputs-v1',stream:'stored-gpu-soft52',
      sourceLOD0SHA256:built.sourceLOD0SHA256,builtGLTFSHA256:built.gltfSHA256,builtBuffers:structuredClone(built.buffers),
      meshIndex:0,skinIndex:0,boneNodes:[1,2,3],primitives:Array.from({length:primitives},(_,primitiveIndex)=>
        ({primitiveIndex,bones:structuredClone(boneRows),weights:structuredClone(weights)})),
      scope:'authored fixture: stored GPU inputs, not deformation parity'}};
  const record={modelId,model:{built,source:{...sourceHash}}};
  const parsed={...document,buffers:[{uri:'data:application/octet-stream;base64,'+binary.toString('base64'),byteLength:length}]};
  const loader=new GLTFLoader(),gltf=await loader.parseAsync(JSON.stringify(parsed),'');
  const meshes=[];gltf.scene.traverse(object=>{if(object.isSkinnedMesh)meshes.push(object);});
  return {gltf,document,source:{skeleton},record,meshes,weights,binary,loader,
    apply:()=>applyNpcSourceSkin(gltf,document,{skeleton},record)};
}

test('exact ordered Float32 lanes survive the real loader: repeated bones, near-unit sums, negative zero and zero rows',async()=>{
  const f=await fixture(), mesh=f.meshes[0],old=mesh.geometry;
  const inverses=mesh.skeleton.boneInverses.map(matrix=>matrix.elements.slice());
  const original=new Float32Array(f.weights.flat());
  assert.notDeepEqual(bits(old.attributes.skinWeight.array),bits(original));
  assert.deepEqual(Array.from(old.attributes.skinWeight.array).slice(8),[1,0,0,0]);
  const receipt=f.apply();
  assert.deepEqual(receipt,{status:'stored-gpu-inputs',vertices:3,primitives:1,scope:f.source.skeleton.sourceSkin.scope});
  assert.ok(Object.isFrozen(receipt));assert.notEqual(mesh.geometry,old);
  assert.deepEqual(bits(mesh.geometry.attributes.skinWeight.array),bits(original));
  assert.deepEqual(Array.from(mesh.geometry.attributes.skinIndex.array),[2,2,0,0,1,0,0,0,0,0,0,0]);
  f.gltf.scene.updateMatrixWorld(true);mesh.skeleton.update();
  assert.deepEqual(bits(mesh.geometry.attributes.skinWeight.array),bits(original));
  assert.deepEqual(mesh.skeleton.boneInverses.map(matrix=>matrix.elements),inverses);
  assert.deepEqual(Array.from(old.attributes.skinWeight.array).slice(8),[1,0,0,0]);
});

test('clones are per-actor/per-primitive and disposal is idempotent without touching shared geometry',async()=>{
  const f=await fixture({primitives:2}), previous=f.meshes.map(mesh=>mesh.geometry);
  assert.equal(previous[0],previous[1],'actual loader shares identical primitive geometry');
  const other=new Mesh(previous[0]);let sourceDisposals=0;
  previous[0].addEventListener('dispose',()=>sourceDisposals++);
  f.apply();assert.notEqual(f.meshes[0].geometry,f.meshes[1].geometry);
  assert.equal(other.geometry,previous[0]);
  let cloneDisposals=0;for(const mesh of f.meshes)mesh.geometry.addEventListener('dispose',()=>cloneDisposals++);
  disposeNpcSourceSkin(f.gltf);disposeNpcSourceSkin(f.gltf);
  assert.equal(cloneDisposals,2);assert.equal(sourceDisposals,0);
  f.meshes.forEach((mesh,i)=>assert.equal(mesh.geometry,previous[i]));
});

test('a bad later row rejects all primitives without cloning or partially replacing geometry',async()=>{
  const f=await fixture({primitives:2}),previous=f.meshes.map(mesh=>mesh.geometry);
  f.source.skeleton.sourceSkin.primitives[1].weights[2][3]=.1; // not an exact Float32
  let clones=0;previous[0].clone=()=>{clones++;throw new Error('must not clone');};
  assert.throws(f.apply,/Float32/);assert.equal(clones,0);
  f.meshes.forEach((mesh,i)=>assert.equal(mesh.geometry,previous[i]));
});

test('clone/allocation failure disposes staged clones and keeps every original primitive',async()=>{
  const f=await fixture({primitives:2}),previous=f.meshes.map(mesh=>mesh.geometry);
  const clone=previous[0].clone.bind(previous[0]);let calls=0,disposed=0;
  previous[0].clone=()=>{if(++calls===2)throw new Error('allocation failed');const result=clone();result.addEventListener('dispose',()=>disposed++);return result;};
  assert.throws(f.apply,/allocation failed/);assert.equal(disposed,1);
  f.meshes.forEach((mesh,i)=>assert.equal(mesh.geometry,previous[i]));
  disposeNpcSourceSkin(f.gltf);assert.equal(disposed,1);
});

test('source hash, buffer, joint, parsed node, source ordinal and sentinel mismatches fail closed',async()=>{
  const edits=[
    f=>{f.source.skeleton.source.meshExportSHA256='a'.repeat(64);},
    f=>{f.source.skeleton.sourceSkin.sourceLOD0SHA256='b'.repeat(64);},
    f=>{f.source.skeleton.sourceSkin.builtGLTFSHA256='b'.repeat(64);},
    f=>{f.source.skeleton.sourceSkin.builtBuffers[0].SHA256='b'.repeat(64);},
    f=>{f.source.skeleton.sourceSkin.boneNodes=[2,1,3];},
    f=>{f.document.skins[0].joints=[1,2,3];},
    f=>{f.gltf.parser.associations.get(f.meshes[0].skeleton.bones[0]).nodes=1;},
    f=>{f.source.skeleton.sourceSkin.primitives[0].bones[0][0]=3;},
    f=>{f.source.skeleton.sourceSkin.primitives[0].bones[0][0]=-1;},
    f=>{f.source.skeleton.sourceSkin.primitives[0].weights[0][0]=-1;},
    f=>{f.source.skeleton.sourceSkin.primitives[0].weights[0][0]=Infinity;},
    f=>{f.source.skeleton.sourceSkin.primitives[0].weights[0].pop();},
    f=>{f.document.meshes[0].primitives[0].attributes.WEIGHTS_1=3;},
    f=>{f.document.accessors[3].count=2;},
  ];
  for(const edit of edits){const f=await fixture(),previous=f.meshes[0].geometry;edit(f);assert.throws(f.apply,/Original NPC skin/);assert.equal(f.meshes[0].geometry,previous);}
});

test('optional legacy inputs are untouched, but one-sided declarations and repeat install reject',async()=>{
  const f=await fixture();f.apply();assert.throws(f.apply,/already installed/);
  disposeNpcSourceSkin(f.gltf);
  delete f.source.skeleton.sourceSkin;assert.throws(f.apply,/agreement/);
  delete f.record.model.built.skinProof.runtimeInputs;
  assert.equal(f.apply(),null);
});

test('verified NPC loader installs source inputs after parse and exposes only owned cleanup',async()=>{
  const f=await fixture(),input={built:f.record.model.built,sourceSkin:f.source.skeleton.sourceSkin};
  const generated=spawnSync('python3',['-S','-c',`
import base64,hashlib,json,sys
sys.path.insert(0,sys.argv[1])
from test_export_source_tracks import runtime_fixture
from pack_source_tracks import pack_animation_bundle
c,s=runtime_fixture();data=json.load(sys.stdin)
c['meshRef']=s['meshRef']='ToyMeshes.Group.Creature'
c['modelId']=s['modelId']='npc_'+hashlib.sha256(c['meshRef'].lower().encode()).hexdigest()[:32]
c['animationRef']=s['animationRef']='ToyAnimation.Group.Motions'
s['format']='elbera-original-npc-skeleton-v1'
s['source']={'meshPackageSHA256':'1'*64,'meshExportSHA256':'3'*64,'animationPackageSHA256':c['source']['packageSHA256'],'animationExportSHA256':c['source']['exportSHA256']}
s['sourceSkin']=data['sourceSkin'];s['sourceSkin']['primitives'][0]['weights'][0][3]=-0.0
print(json.dumps({'source':s['source'],'bundle':base64.b64encode(pack_animation_bundle(c,s)).decode()}))
`,fileURLToPath(new URL('../../../tools/anim/',import.meta.url))],{input:JSON.stringify(input),encoding:'utf8',timeout:30000});
  assert.ifError(generated.error);assert.equal(generated.status,0,generated.stderr);
  const packed=JSON.parse(generated.stdout),bundle=Buffer.from(packed.bundle,'base64');
  Object.assign(f.record.model,{source:packed.source,meshRef:'ToyMeshes.Group.Creature',animationRef:'ToyAnimation.Group.Motions',
    bundle:`animation-tracks/runtime/${f.record.modelId}.l2anim`,bundleSHA256:sha(bundle)});
  const fetched=[];const fetcher=async url=>{fetched.push(url);return new Response(url.endsWith('.gltf')?JSON.stringify(f.document):url.endsWith('.bin')?f.binary:bundle);};
  const result=await verifiedNpcSourceModel(f.record,f.loader,fetcher);
  assert.equal(fetched.length,3);assert.equal(result.originalSource.skinReceipt.status,'stored-gpu-inputs');
  let mesh;result.gltf.scene.traverse(object=>{if(object.isSkinnedMesh)mesh=object;});
  assert.deepEqual(bits(mesh.geometry.attributes.skinWeight.array),bits(new Float32Array(f.weights.flat())));
  let disposed=0;mesh.geometry.addEventListener('dispose',()=>disposed++);
  result.originalSource.disposeSkin();result.originalSource.disposeSkin();assert.equal(disposed,1);
});
