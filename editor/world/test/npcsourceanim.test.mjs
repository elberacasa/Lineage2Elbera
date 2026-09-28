// Elbera Tools: synthetic source transport + actual byte-verifying loader.
// No original files, browser, server account or generated asset dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,webcrypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { originalNpcSourceRecord,verifiedNpcSourceModel } from '../js/npcsourceanim.js';
globalThis.crypto ??= webcrypto;
const sha = bytes=>createHash('sha256').update(bytes).digest('hex');
const generated = spawnSync('python3',['-S','-c',`
import base64,hashlib,json,sys
sys.path.insert(0,sys.argv[1])
from test_export_source_tracks import runtime_fixture
from pack_source_tracks import pack_animation_bundle
c,s=runtime_fixture()
c['meshRef']=s['meshRef']='ToyMeshes.Group.Creature'
c['modelId']=s['modelId']='npc_'+hashlib.sha256(c['meshRef'].lower().encode()).hexdigest()[:32]
c['animationRef']=s['animationRef']='ToyAnimation.Group.Motions'
s['format']='elbera-original-npc-skeleton-v1'
s['source']={'meshPackageSHA256':'c'*64,'meshExportSHA256':'d'*64,
 'animationPackageSHA256':c['source']['packageSHA256'],'animationExportSHA256':c['source']['exportSHA256']}
print(json.dumps({'catalog':c,'skeleton':s,'bundle':base64.b64encode(pack_animation_bundle(c,s)).decode()}))
`,fileURLToPath(new URL('../../../tools/anim/',import.meta.url))],{encoding:'utf8',timeout:30000});
assert.ifError(generated.error); assert.equal(generated.status,0,generated.stderr);
const source=JSON.parse(generated.stdout);
let serial=0;
function fixture() {
  const id=++serial, name=`synthetic_${id}`, bundle=Buffer.from(source.bundle,'base64');
  const binary=new Uint8Array([id,2,3,4]);
  const document={buffers:[{uri:name+'.bin',byteLength:4}],meshes:[{}],
    skins:[{joints:[1,2,3]}],nodes:[{mesh:0,skin:0},{},{},{}]};
  const model={meshRef:source.skeleton.meshRef,animationRef:source.skeleton.animationRef,
    bundle:`animation-tracks/runtime/${source.catalog.modelId}.l2anim`,bundleSHA256:sha(bundle),
    source:{...source.skeleton.source},built:{modelId:name,gltf:`models/${name}.gltf`,
      gltfSHA256:sha(JSON.stringify(document)),buffers:[{uri:name+'.bin',byteLength:4,SHA256:sha(binary)}],
      meshIndex:0,skinIndex:0,boneNodes:[1,2,3],geometryProof:{status:'triangle-position-uv-winding-exact'},skinProof:{status:'unverified'}}};
  const npc={className:'ToyClasses.Creature',meshRef:model.meshRef,animationRef:model.animationRef,
    modelId:source.catalog.modelId,inheritance:['toyclasses.creature','engine.pawn'],
    selectors:{WaitAnimName:{0:{value:'OriginalWait',declaredBy:'toyclasses.creature',status:'source-sequence',sequence:'OriginalWait'}}}};
  const index={format:'elbera-original-npc-animation-runtime-index-v1',edition:'Interlude',npcs:{123:npc},models:{[npc.modelId]:model}};
  const entry={id:name,gltf:model.built.gltf},requests=[];
  const fetcher=async url=>{
    requests.push(url);
    return new Response(url.endsWith('.gltf')?JSON.stringify(document):url.endsWith('.bin')?binary:bundle);
  };
  let parses=0;
  const loader={async parseAsync(text,base){
    const json=JSON.parse(text);
    assert.equal(base,'/characters/monsters/models/');
    assert.ok(json.buffers[0].uri.startsWith('blob:'));
    assert.deepEqual(new Uint8Array(await(await fetch(json.buffers[0].uri)).arrayBuffer()),binary);
    return {scene:{incarnation:++parses},animations:[]};
  }};
  return {model,npc,index,entry,binary,bundle,document,fetcher,loader,requests,
    record:()=>originalNpcSourceRecord(index,123,entry)};
}

test('source records retain per-NPC class selectors when two actors share one source mesh',()=>{
  const f=fixture(), second={...f.npc,className:'ToyClasses.Corpse',inheritance:['toyclasses.corpse','engine.pawn'],
    selectors:{WaitAnimName:{0:{value:'DeathWait'}}}};
  f.index.npcs[124]=second;
  const first=f.record(), other=originalNpcSourceRecord(f.index,124,f.entry);
  assert.equal(first.model,other.model); assert.notEqual(first.npc.selectors,other.npc.selectors);
  assert.equal(other.npc.className,'ToyClasses.Corpse');
  assert.equal(originalNpcSourceRecord(f.index,125,f.entry),null);
  assert.equal(originalNpcSourceRecord(null,123,f.entry),null);
  f.index.sources={'Synthetic.u':'a'.repeat(64)};
  const sources=f.record().sourceFiles;
  f.index.sources['Synthetic.u']='b'.repeat(64);
  assert.equal(sources['Synthetic.u'],'a'.repeat(64));
  assert.equal(Object.isFrozen(sources),true,'runtime admission retains its own source provenance');
});

test('qualified identities, artifact bindings and explicit proof limits cannot be substituted',()=>{
  for(const change of [
    f=>{f.npc.meshRef='Other.Creature';}, f=>{f.npc.animationRef='Other.Animation';},
    f=>{f.npc.className='Other.Class';}, f=>{f.npc.modelId='basename';},
    f=>{f.model.source.meshExportSHA256='missing';},f=>{delete f.model.source.animationPackageSHA256;},
    f=>{f.model.bundle='../elsewhere';},f=>{f.model.built.modelId='wrong';},
    f=>{f.model.built.gltf='../creature.gltf';f.entry.gltf='../creature.gltf';},
    f=>{f.model.built.buffers[0].uri='../outside.bin';},f=>{f.model.built.boneNodes=[1,1,3];},
    f=>{f.model.built.geometryProof.status='legacy-name-match';},
    f=>{delete f.model.built.skinProof;},
  ]){const f=fixture();change(f);assert.throws(f.record);}
});

test('each actor parses fresh scene objects from the exact verified mesh/buffer bytes',async()=>{
  const f=fixture(),record=f.record();
  const a=await verifiedNpcSourceModel(record,f.loader,f.fetcher);
  const b=await verifiedNpcSourceModel(record,f.loader,f.fetcher);
  assert.notEqual(a.gltf.scene,b.gltf.scene);assert.equal(f.requests.length,3);
  assert.equal(a.originalSource.catalog,b.originalSource.catalog);
  assert.equal(a.originalSource.skeleton.format,'elbera-original-npc-skeleton-v1');
  assert.equal(a.originalSource.record.npc,record.npc);
  assert.deepEqual(a.overrides,{});
});

test('changed model, buffer or source bundle bytes fail before parsing and can retry',async()=>{
  for(const suffix of ['.gltf','.bin','.l2anim']) {
    const f=fixture();let parsed=false;
    await assert.rejects(verifiedNpcSourceModel(f.record(),{parseAsync(){parsed=true;}},
      url=>url.endsWith(suffix)?Promise.resolve(new Response('changed bytes')):f.fetcher(url)),/SHA-256/);
    assert.equal(parsed,false);
    assert.ok((await verifiedNpcSourceModel(f.record(),f.loader,f.fetcher)).originalSource);
  }
});

test('valid transport bytes still reject a different index source fingerprint',async()=>{
  const f=fixture();f.model.source.meshPackageSHA256='e'.repeat(64);
  await assert.rejects(verifiedNpcSourceModel(f.record(),f.loader,f.fetcher),/bundle\/index source identities/);
});

test('a newly hashed glTF with different buffers or joints cannot reuse its old geometry binding',async()=>{
  for(const mutate of [f=>{f.document.buffers[0].uri='another.bin';},f=>{f.document.skins[0].joints=[3,2,4];}]) {
    const f=fixture();mutate(f);f.model.built.gltfSHA256=sha(JSON.stringify(f.document));
    await assert.rejects(verifiedNpcSourceModel(f.record(),f.loader,f.fetcher),/glTF/);
  }
});
