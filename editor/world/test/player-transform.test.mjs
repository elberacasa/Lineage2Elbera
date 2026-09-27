// Elbera Tools: source-free exact player scale and trusted-build admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playerVisualScale } from '../js/player-transform.js';
const identity={modelId:'fixture',gltf:'models/fixture.gltf'};
const record=()=>({format:'l2-interlude-player-visual-v1',status:'source-verified',modelId:'fixture',
  browserAxisOrder:'native-x-z-y',scaleApplication:'unbaked-source-scale',
  drawScale:2,drawScale3D:[3,5,7],meshScale:[11,13,17],sourceSHA256:'a'.repeat(64),nativeProofSHA256:'b'.repeat(64),
  built:{gltf:identity.gltf,gltfSHA256:'c'.repeat(64)}});
test('original per-axis scale is multiplied once and mapped to browser axes without height fitting',()=>{
 assert.deepEqual(playerVisualScale(record(),identity),{x:66,y:238,z:130});
 const r=record();r.drawScale=1;r.drawScale3D=[1,1,1];r.meshScale=[1.0299999713897705,1,1];
 assert.deepEqual(playerVisualScale(r,identity),{x:1.0299999713897705,y:1,z:1});
 r.drawScale=0;assert.deepEqual(playerVisualScale(r,identity),{x:0,y:0,z:0});
});
test('Float32 stores occur between products, with no decimal rounding',()=>{
 const r=record();r.drawScale=1.3;r.drawScale3D=[.7,.8,.9];r.meshScale=[1.03,1.04,1.05];
 const f=Math.fround,expected=r.drawScale3D.map((v,i)=>f(f(f(r.drawScale)*f(v))*f(r.meshScale[i])));
 assert.deepEqual(playerVisualScale(r,identity),{x:expected[0],y:expected[2],z:expected[1]});
});
test('unknown model, mismatched path, absent source and malformed or overflowing values stay unresolved',()=>{
 for(const id of [{}, {...identity,modelId:'other'}, {...identity,gltf:'other.gltf'}])assert.equal(playerVisualScale(record(),id),null);
 for(const change of [r=>{delete r.format;},r=>{r.status='unresolved';},r=>{r.scaleApplication='height-fit';},
  r=>{r.browserAxisOrder='unknown';},r=>{delete r.browserAxisOrder;},
  r=>{r.sourceSHA256='';},r=>{r.built.gltfSHA256='';},
  r=>{r.drawScale=Infinity;},r=>{r.drawScale=1e40;},r=>{r.drawScale3D=[1,2];},
  r=>{r.meshScale[1]=NaN;},r=>{r.drawScale=1e30;r.drawScale3D=[1e30,1e30,1e30];}]){
   const r=record();change(r);assert.equal(playerVisualScale(r,identity),null);
 }
});

test('actual Character loader applies source axes directly and rejects mismatched asset paths before loading',async()=>{
 const fs=await import('node:fs'),vm=await import('node:vm');
 const THREE=await import('../vendor/three.module.min.js');
 const text=fs.readFileSync(new URL('../js/character.js',import.meta.url),'utf8');
 const r=record(),loads=[];
 const entry={id:identity.modelId,gltf:identity.gltf,visualScale:r};
 const Character=vm.runInNewContext(text.replace(/^import .*;$/gm,'').replace(/^export /gm,'')+'\nCharacter;',{
   THREE,playerVisualScale,pawnAnim:async()=>null,L2_TO_M:.01,detachArmor:()=>{},performance:{now:()=>1},
   fetch:async()=>({ok:true,json:async()=>({models:[entry]})}),
   GLTFLoader:class{setRequestHeader(){return this;}async loadAsync(url){
     loads.push(url);const scene=new THREE.Group();scene.add(new THREE.Mesh(new THREE.BoxGeometry(2,3,4),new THREE.MeshBasicMaterial()));
     return{scene,animations:[]};
   }},
 });
 const ch=new Character();await ch.load('/characters/'+identity.gltf);
 assert.deepEqual(ch.model.scale.toArray(),[66,238,130]);
 assert.equal(ch.heightM,714,'actual source product, not silhouette fit');
 await assert.rejects(new Character().load('/wrong/'+identity.gltf),/Missing verified player scale/);
 assert.equal(loads.length,1);
 delete entry.visualScale;
 await assert.rejects(new Character().load('/characters/'+identity.gltf),/Missing verified player scale/);
 assert.equal(loads.length,1,'no fabricated fallback and no asset request');
});
