// Authored binary fixtures only. Python is the independent transport writer;
// neither originals, pre-generated catalogs, a server nor a browser are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodeOriginalAnimationBundle, fetchOriginalAnimationBundle } from '../js/sourceanim-data.js';

const generated = spawnSync('python3', ['-S', '-c', `
import base64,json,sys
sys.path.insert(0,sys.argv[1])
from test_export_source_tracks import runtime_fixture
from pack_source_tracks import pack_animation_bundle
c,s=runtime_fixture()
print(json.dumps({'catalog':c,'skeleton':s,'bundle':base64.b64encode(pack_animation_bundle(c,s)).decode()},allow_nan=False))
`, fileURLToPath(new URL('../../../tools/anim/', import.meta.url))],
{encoding:'utf8', timeout:30000, maxBuffer:2*1024*1024});
assert.ifError(generated.error); assert.equal(generated.status,0,generated.stderr);
const fixture = JSON.parse(generated.stdout);
function input() {
  const bytes=Buffer.from(fixture.bundle,'base64');
  return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
}
function rewrite(change, payloadChange = () => {}) {
  const old=input(),view=new DataView(old),size=view.getUint32(8,true),start=16+Math.ceil(size/4)*4;
  const meta=JSON.parse(new TextDecoder().decode(new Uint8Array(old,16,size)));
  change(meta);
  const json=new TextEncoder().encode(JSON.stringify(meta)),payload=new Uint8Array(old.slice(start));
  payloadChange(new DataView(payload.buffer));
  const offset=16+Math.ceil(json.length/4)*4, result=new ArrayBuffer(offset+payload.length),out=new DataView(result);
  new Uint8Array(result).set([69,76,66,65]);out.setUint32(4,1,true);
  out.setUint32(8,json.length,true);out.setUint32(12,payload.length,true);
  new Uint8Array(result).set(json,16);new Uint8Array(result).set(payload,offset);
  return result;
}
function withModel(name) { return rewrite(m=>{m.catalog.modelId=name;m.skeleton.modelId=name;}); }
function words(values) { const b=new ArrayBuffer(values.length*4),v=new DataView(b);values.forEach((n,i)=>v.setFloat32(i*4,n,true));return Array.from(new Uint32Array(b)); }
function npcMetadata(metadata, crossPackage = true) {
  const {catalog,skeleton}=metadata;
  catalog.meshRef=skeleton.meshRef='MeshPackage.Group.Creature';
  catalog.modelId=skeleton.modelId='npc_'+createHash('sha256').update(catalog.meshRef.toLowerCase()).digest('hex').slice(0,32);
  catalog.animationRef=skeleton.animationRef=(crossPackage?'AnimationPackage':'MeshPackage')+'.Group.Animation';
  skeleton.format='elbera-original-npc-skeleton-v1';
  skeleton.source={meshPackageSHA256:(crossPackage?'c':'a').repeat(64),
    animationPackageSHA256:catalog.source.packageSHA256,meshExportSHA256:'d'.repeat(64),
    animationExportSHA256:catalog.source.exportSHA256};
}

test('Python transport round-trips every authored Float32 word and complete original metadata',()=>{
  const {catalog,skeleton}=decodeOriginalAnimationBundle(input());
  assert.deepEqual(catalog,fixture.catalog);assert.deepEqual(skeleton,fixture.skeleton);
  assert.deepEqual(skeleton.trackBindings,[0,-1,1]);
  assert.equal(catalog.sequences[1].movement.flags,17,'transport must not remove unsupported playback modes');
  assert.equal(catalog.sequences[1].movement.tracks[0].flags,-27);
  for(const [index,sequence] of catalog.sequences.entries()) {
    const expected=fixture.catalog.sequences[index].movement;
    for(const [i,track] of [...sequence.movement.tracks,sequence.movement.rootTrack].entries()) {
      const original=[...expected.tracks,expected.rootTrack][i];
      for(const field of ['quaternions','positions','times']) assert.deepEqual(words(track[field].flat()),words(original[field].flat()));
    }
  }
  assert.equal(words(catalog.sequences[0].movement.tracks[0].quaternions[0])[1],0x80000000);
  assert.equal(words(catalog.sequences[0].movement.tracks[0].quaternions[0])[2],1);
});

test('vectors materialize lazily once; shared metadata and source bytes cannot be mutated',()=>{
  const buffer=input(),original=Array.from;let vectorAllocations=0;
  Array.from=function(...args){if(args[0]?.length===3||args[0]?.length===4)vectorAllocations++;return original.apply(this,args);};
  try {
    const bundle=decodeOriginalAnimationBundle(buffer),track=bundle.catalog.sequences[0].movement.tracks[0];
    assert.equal(vectorAllocations,0);
    assert.equal(typeof Object.getOwnPropertyDescriptor(track,'quaternions').get,'function');
    assert.equal(Object.isFrozen(track),true);assert.equal(Object.isFrozen(bundle.skeleton.bones[0].orientation),true);
    new Uint8Array(buffer).fill(0);
    const q=track.quaternions;
    assert.equal(vectorAllocations,3);assert.equal(track.quaternions,q);assert.equal(vectorAllocations,3);
    assert.deepEqual(q,fixture.catalog.sequences[0].movement.tracks[0].quaternions);
    assert.equal(Object.isFrozen(q),true);assert.equal(Object.isFrozen(q[0]),true);
    assert.throws(()=>{q[0][0]=999;},TypeError);assert.throws(()=>{track.flags=999;},TypeError);
    assert.throws(()=>{bundle.skeleton.trackBindings[0]=2;},TypeError);
    assert.equal(vectorAllocations,3,'other tracks and vector fields remain unmaterialized');
  } finally {Array.from=original;}
});

test('rejects malformed headers, UTF-8, padding, truncation and unreferenced bytes',()=>{
  for(const bad of [null,new Uint8Array(input()),new ArrayBuffer(0),input().slice(0,15),input().slice(0,-1)]) {
    assert.throws(()=>decodeOriginalAnimationBundle(bad));
  }
  for(const change of [v=>v.setUint8(0,0),v=>v.setUint32(4,2,true),v=>v.setUint32(8,0xffffffff,true),
    v=>v.setUint32(12,1,true),v=>v.setUint8(16,0xff)]) {
    const b=input();change(new DataView(b));assert.throws(()=>decodeOriginalAnimationBundle(b));
  }
  const extra=new Uint8Array(input().byteLength+4);extra.set(new Uint8Array(input()));
  const extraView=new DataView(extra.buffer);extraView.setUint32(12,extraView.getUint32(12,true)+4,true);
  assert.throws(()=>decodeOriginalAnimationBundle(extra.buffer),/unreferenced/);
  let padded;
  for(let n=1;n<5;n++) {
    padded=rewrite(m=>{m.note='x'.repeat(n);});
    const v=new DataView(padded),end=16+v.getUint32(8,true);
    if(end%4){v.setUint8(end,1);break;}
  }
  assert.throws(()=>decodeOriginalAnimationBundle(padded),/padding/);
});

test('all array descriptors and even unused late payloads validate before exposing a result',()=>{
  const first=m=>m.catalog.sequences[0].movement.tracks[0];
  const bad=[m=>{first(m).quaternions.width=3;},m=>{first(m).quaternions.count=0xffffffff;},
    m=>{first(m).positions.offset=0;},m=>{first(m).times.offset+=1;},
    m=>{first(m).positions.count=2;},m=>{first(m).times.count=2;},
    m=>{first(m).times.count=-1;},m=>{first(m).times.count=.5;},
    m=>{first(m).times.extra='unknown';},m=>{first(m).flags=null;},
    m=>{m.catalog.sequences[1].movement.tracks.pop();},m=>{delete m.catalog.sequences[1].movement.rootTrack;}];
  for(const mutate of bad)assert.throws(()=>decodeOriginalAnimationBundle(rewrite(mutate)));
  for(const word of [0x7f800000,0xff800000,0x7fc01234]){
    assert.throws(()=>decodeOriginalAnimationBundle(rewrite(()=>{},v=>v.setUint32(v.byteLength-4,word,true))),/nonfinite/);
  }
});

test('source-pair identities and first-name bindings cannot be silently substituted',()=>{
  const mutations=[m=>{m.format='other';},m=>{m.skeleton.modelId='other';},
    m=>{m.skeleton.animationRef='Other.Animation';},m=>{m.skeleton.source.packageSHA256='c'.repeat(64);},
    m=>{delete m.catalog.source.exportSHA256;},m=>{m.skeleton.trackBindings[2]=2;},
    m=>{m.skeleton.trackBindings[1]=0;},m=>{m.skeleton.animationBones[2].parent=0;},
    m=>{m.skeleton.bones[1].parent=2;},m=>{m.skeleton.bones[1].orientation[0]=.1;},
    m=>{m.skeleton.bones[2].name='child';}];
  for(const mutate of mutations)assert.throws(()=>decodeOriginalAnimationBundle(rewrite(mutate)));
});

test('NPC bundles retain qualified source identities and independent mesh/animation package fingerprints',()=>{
  for(const crossPackage of [false,true]) {
    const bundle=decodeOriginalAnimationBundle(rewrite(m=>npcMetadata(m,crossPackage)));
    assert.equal(bundle.skeleton.format,'elbera-original-npc-skeleton-v1');
    assert.equal(bundle.catalog.meshRef,'MeshPackage.Group.Creature');
    assert.equal(bundle.skeleton.source.meshPackageSHA256,(crossPackage?'c':'a').repeat(64));
    assert.equal(bundle.catalog.source.packageSHA256,bundle.skeleton.source.animationPackageSHA256);
    assert.deepEqual(bundle.skeleton.trackBindings,[0,-1,1]);
    assert.deepEqual(bundle.catalog.sequences[0].movement.tracks[0].positions,
      fixture.catalog.sequences[0].movement.tracks[0].positions);
    assert.equal(Object.isFrozen(bundle.skeleton.source),true);
  }
  const mixedCase=decodeOriginalAnimationBundle(rewrite(m=>{
    npcMetadata(m);m.skeleton.meshRef=m.skeleton.meshRef.toLowerCase();
    m.skeleton.animationRef=m.skeleton.animationRef.toLowerCase();
  }));
  assert.equal(mixedCase.catalog.meshRef,'MeshPackage.Group.Creature','full source spelling is preserved');
});

test('an NPC filename token cannot authorize missing, unqualified or mismatched source records',()=>{
  const mutations=[m=>{delete m.catalog.meshRef;},m=>{delete m.skeleton.meshRef;},
    m=>{m.skeleton.meshRef='OtherPackage.Group.Creature';},m=>{m.catalog.meshRef=m.skeleton.meshRef='Creature';},
    m=>{m.catalog.meshRef=m.skeleton.meshRef='MeshPackage..Creature';},
    m=>{m.catalog.meshRef=m.skeleton.meshRef='MeshPackage/Group.Creature';},
    m=>{m.catalog.animationRef=m.skeleton.animationRef='Animation';},
    m=>{m.skeleton.animationRef='OtherPackage.Group.Animation';},
    m=>{m.skeleton.source.animationPackageSHA256='e'.repeat(64);},
    m=>{m.skeleton.source.animationExportSHA256='e'.repeat(64);},
    m=>{delete m.skeleton.source.meshPackageSHA256;},m=>{delete m.skeleton.source.meshExportSHA256;},
    m=>{m.skeleton.source.meshPackageSHA256='invalid';},m=>{m.skeleton.source.meshExportSHA256='g'.repeat(64);},
    m=>{m.catalog.modelId=m.skeleton.modelId='npc_short';},m=>{m.skeleton.modelId='npc_'+'e'.repeat(32);},
    m=>{m.skeleton.format='elbera-original-npc-skeleton-v2';},
    m=>{m.skeleton.source.packageSHA256=m.catalog.source.packageSHA256;delete m.skeleton.source.animationPackageSHA256;},
    m=>{m.skeleton.trackBindings[1]=0;}];
  for(const mutate of mutations)assert.throws(()=>decodeOriginalAnimationBundle(rewrite(m=>{npcMetadata(m);mutate(m);})),undefined,mutate.toString());
  // The old player identity contract cannot borrow the new NPC package field.
  assert.throws(()=>decodeOriginalAnimationBundle(rewrite(m=>{
    m.skeleton.source.animationPackageSHA256=m.skeleton.source.packageSHA256;
    delete m.skeleton.source.packageSHA256;
  })),/fingerprint/);
});

test('sequence metadata and original time ordering validate without imposing sampler-only rules',()=>{
  const mutations=[m=>{m.catalog.sequences[1].name=m.catalog.sequences[0].name;},
    m=>{delete m.catalog.sequences[0].rate;},m=>{m.catalog.sequences[0].rate=.1;},
    m=>{m.catalog.sequences[0].frames=0;},m=>{m.catalog.sequences[0].movement.duration=-1;},
    m=>{m.catalog.sequences[0].movement.flags=0x100000000;},
    m=>{m.catalog.sequences[0].movement.rootSpeed.pop();},
    m=>{m.catalog.sequences[0].movement.boneIndices=[true];}];
  for(const mutate of mutations)assert.throws(()=>decodeOriginalAnimationBundle(rewrite(mutate)));
  let timeOffset;
  const bad=rewrite(m=>{timeOffset=m.catalog.sequences[0].movement.tracks[0].times.offset;},
    v=>v.setFloat32(timeOffset+4,-1,true));
  assert.throws(()=>decodeOriginalAnimationBundle(bad),/key-time order/);
  const bundle=decodeOriginalAnimationBundle(input());
  const constant=bundle.catalog.sequences[1].movement.tracks[1];
  assert.equal(constant.quaternions.length,1);assert.equal(constant.times.length,3);
  assert.deepEqual(bundle.catalog.sequences[1].movement.rootTrack.times,[]);
  // The original source decoder allows equal adjacent times. Whether a
  // particular playback primitive admits them is deliberately a later gate.
  const equal=rewrite(m=>{timeOffset=m.catalog.sequences[0].movement.tracks[0].times.offset;},
    v=>v.setFloat32(timeOffset+4,0,true));
  assert.deepEqual(decodeOriginalAnimationBundle(equal).catalog.sequences[0].movement.tracks[0].times,[0,0,2]);
});

test('shared loading coalesces requests and returns immutable source, without actor/session state',async()=>{
  const original=globalThis.fetch;let finish,calls=0;
  globalThis.fetch=async url=>{calls++;assert.equal(url,'/gamedata/animation-tracks/runtime/shared_fixture.l2anim');return new Promise(resolve=>{finish=resolve;});};
  try{
    const a=fetchOriginalAnimationBundle('shared_fixture'),b=fetchOriginalAnimationBundle('shared_fixture');
    assert.equal(a,b);assert.equal(calls,1);
    finish({ok:true,arrayBuffer:async()=>withModel('shared_fixture')});
    const first=await a;assert.equal(await b,first);assert.equal(await fetchOriginalAnimationBundle('shared_fixture'),first);
    assert.equal(calls,1);assert.equal(Object.isFrozen(first.catalog),true);
  }finally{globalThis.fetch=original;}
});

test('network, body, decoder and wrong-model failures evict pending cache entries so retry can succeed',async()=>{
  const original=globalThis.fetch;
  try{
    const failures=[async()=>{throw Error('offline');},async()=>({ok:false,status:503}),
      async()=>({ok:true,arrayBuffer:async()=>{throw Error('body failure');}}),
      async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(16)}),
      async()=>({ok:true,arrayBuffer:async()=>withModel('wrong_model')})];
    for(const [index,failure] of failures.entries()){
      const model=`retry_fixture_${index}`;let calls=0;
      globalThis.fetch=async()=>{calls++;return calls===1?failure():{ok:true,arrayBuffer:async()=>withModel(model)};};
      await assert.rejects(fetchOriginalAnimationBundle(model));
      const value=await fetchOriginalAnimationBundle(model);assert.equal(value.catalog.modelId,model);assert.equal(calls,2);
    }
    let touched=false;globalThis.fetch=async()=>{touched=true;};
    for(const model of ['../private','',null,'UPPER','x/'.repeat(40)])await assert.rejects(fetchOriginalAnimationBundle(model));
    assert.equal(touched,false);
  }finally{globalThis.fetch=original;}
});
