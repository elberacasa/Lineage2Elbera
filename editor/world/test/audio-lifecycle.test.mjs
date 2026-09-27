// Elbera Tools: real asynchronous playAt lifecycle; no browser or game assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three.module.min.js';
const source=fs.readFileSync(new URL('../js/audio.js',import.meta.url),'utf8');
const AudioEngine=vm.runInNewContext(source.replace(/^import .*;$/gm,'').replace(/^export /gm,'')+'\nAudioEngine;',
  {THREE,L2_TO_M:.01,localStorage:{getItem:()=>null},console});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
 const engine=new AudioEngine(),starts=[],panners=[],gains=[];
 let resolve,loads=0;
 const pending=new Promise(r=>{resolve=r;});
 const node=()=>({connect(other){return other;},disconnect(){}});
 engine.ctx={state:'running',createGain:()=>{const g={...node(),gain:{value:0}};gains.push(g);return g;},
  createBufferSource:()=>({...node(),playbackRate:{value:1},start(){starts.push(this);}})};
 engine.ready=true;engine.buses.sfx=node();
 engine._buffer=()=>{loads++;return pending;};
 engine._panner=(...args)=>{panners.push(args);return node();};
 return {engine,resolve,starts,panners,gains,get loads(){return loads;}};
}
test('cancelled or replaced cast cannot start audio when delayed decoding finishes',async()=>{
 const h=fixture();let current=true;
 h.engine.playAt('Bank.Sound',{x:1,y:2,z:3},{volume:250,radius:30,isCurrent:()=>current});
 assert.equal(h.loads,1);current=false;h.resolve({});await tick();assert.equal(h.starts.length,0);
});
test('retired callers are rejected before loading, while current callers preserve original position/gain',async()=>{
 const h=fixture(),pos={x:1,y:2,z:3};
 h.engine.playAt('Bank.Sound',pos,{isCurrent:()=>false});assert.equal(h.loads,0);
 h.engine.playAt('Bank.Sound',pos,{volume:0,radius:30,isCurrent:()=>true});
 pos.x=900;h.resolve({});await tick();
 assert.equal(h.starts.length,1);assert.deepEqual(h.panners,[[1,2,3,15]]);
 assert.equal(h.gains[0].gain.value,0);
});
