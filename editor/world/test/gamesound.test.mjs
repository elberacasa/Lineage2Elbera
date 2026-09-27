// Elbera Tools: exercise the actual sound caller with deterministic audio I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { skillSoundPhase, skillSoundVoice } from '../js/skillsound-binding.js';
const source=fs.readFileSync(new URL('../js/gamesound.js',import.meta.url),'utf8');
function fixture() {
  const calls=[],pending=[],cancelled=[];
  let nextTimer=1;
  const data={skillSoundFormat:'l2-interlude-skill-sound-v1',names:['a','b','c'],
    npc:{},weapon:{},skillSoundRows:{7:[{level:1,layers:[
      [[0,0,0],[0,1,2],[0,3,4]],[[1,2.125,17.25],[1,5,6],[null,0,0]],[[2,254,200],[2,7,8],[2,9,10]],
    ]}]}};
  const GameSound=vm.runInNewContext(source.replace(/^import .*;$/gm,'').replace(/^export /gm,'')+'\nGameSound;',{
    audio:{playAt:(ref,pos,opts)=>calls.push([ref,structuredClone(pos),
      {volume:opts.volume,radius:opts.radius,isCurrent:opts.isCurrent}])},skillSoundPhase,skillSoundVoice,
    flyingTime:(_id,level)=>level===1 ? .4 : null,
    setTimeout:(cb,ms)=>{const handle=nextTimer++;pending.push({handle,cb,ms});return handle;},
    clearTimeout:handle=>cancelled.push(handle),
    fetch:async()=>({ok:true,json:async()=>data}),console,
  });
  return {game:new GameSound(),calls,pending,cancelled,data};
}
test('actual GameSound loads full rows and emits every cast layer, including zero and fractional gains',async()=>{
  const h=fixture();assert.equal(await h.game.load(),true);
  assert.equal(h.game.cast(7,{x:1,y:2,z:3},1),true);
  assert.deepEqual(h.calls.map(([ref,,{volume,radius}])=>[ref,{volume,radius}]),[
    ['a',{volume:0,radius:0}],['b',{volume:2.125,radius:17.25}],['c',{volume:254,radius:200}],
  ]);
});
test('actual caller rejects absent identity and a malformed later layer before any sound',async()=>{
  const h=fixture();await h.game.load();
  assert.equal(h.game.cast(7,{x:0,y:0,z:0}),false);assert.equal(h.calls.length,0);
  h.data.skillSoundRows[7][0].layers[2][0][0]=99;
  assert.equal(h.game.cast(7,{x:0,y:0,z:0},1),false);assert.equal(h.calls.length,0);
});
test('existing provisional launch forwards received skill level to both phases',async()=>{
  const h=fixture();await h.game.load();
  h.game.launch(7,{x:2,y:0,z:0},{x:1,y:0,z:0},1);
  assert.deepEqual(h.calls.map(([ref])=>ref),['a','b','c']);
  assert.equal(h.pending.length,1);assert.equal(h.pending[0].ms,400);h.pending[0].cb();
  assert.deepEqual(h.calls.slice(3).map(([ref])=>ref),['a','c']);
});

test('clear retires captured decode guards while a new session receives live guards',async()=>{
  const h=fixture();await h.game.load();
  h.game.cast(7,{x:1,y:2,z:3},1);
  const retired=h.calls.map(([, ,opts])=>opts.isCurrent);
  assert.ok(retired.every(guard=>typeof guard==='function' && guard()));
  h.game.clear();
  h.game.cast(7,{x:4,y:5,z:6},1);
  assert.ok(retired.every(guard=>!guard()),'old async decodes stay retired after new activity');
  assert.ok(h.calls.slice(3).every(([, ,opts])=>opts.isCurrent()));
});

test('clear cancels owned timers and a retained old callback cannot enter the next session',async()=>{
  const h=fixture();await h.game.load();
  h.game.launch(7,{x:1,y:2,z:3},null,1);
  const old=h.pending[0];
  h.game.clear();
  assert.deepEqual(h.cancelled,[old.handle]);
  h.game.launch(7,{x:4,y:5,z:6},null,1);
  const current=h.pending[1],before=h.calls.length;
  old.cb();
  assert.equal(h.calls.length,before,'manually delivered retired callback emits nothing');
  h.game.clear();
  assert.deepEqual(h.cancelled,[old.handle,current.handle],'new timer ownership remains intact');
  current.cb();
  assert.equal(h.calls.length,before);
});

test('delayed impact snapshots a reused position and releases its completed timer',async()=>{
  const h=fixture();await h.game.load();
  const target={x:1,y:2,z:3};
  h.game.launch(7,target,{x:0,y:0,z:0},1);
  target.x=40;target.y=50;target.z=60;
  h.pending[0].cb();
  assert.deepEqual(h.calls.slice(3).map(([,position])=>position),[
    {x:1,y:2,z:3},{x:1,y:2,z:3},
  ]);
  const impactGuards=h.calls.slice(3).map(([, ,opts])=>opts.isCurrent);
  h.game.clear();
  assert.deepEqual(h.cancelled,[],'completed timer is no longer owned');
  assert.ok(impactGuards.every(guard=>!guard()),'impact decodes are also session scoped');
});

test('cast and launch append explicit source voices after layers, sharing their retirement guard',async()=>{
  const h=fixture();await h.game.load();
  const row=h.data.skillSoundRows[7][0];
  row.castVoice=Array(15).fill(null);row.castVoice[13]=1;
  row.throwVoice=Array(15).fill(null);row.throwVoice[13]=2;
  row.voiceVolume=0;row.voiceRadius=0;
  h.game.cast(7,{x:1,y:2,z:3},1,13);
  assert.deepEqual(h.calls.map(([ref])=>ref),['a','b','c','b']);
  assert.equal(h.calls[3][2].volume,0);assert.equal(h.calls[3][2].radius,0);
  assert.equal(h.calls[0][2].isCurrent,h.calls[3][2].isCurrent);
  h.game.launch(7,{x:4,y:5,z:6},{x:1,y:2,z:3},1,13);
  assert.deepEqual(h.calls.slice(4).map(([ref])=>ref),['a','b','c','c']);
  assert.deepEqual(h.calls[7][1],{x:1,y:2,z:3});
  h.pending[0].cb();
  assert.deepEqual(h.calls.slice(8).map(([ref])=>ref),['a','c'],'impact never emits a voice');
  h.game.clear();
  assert.ok(h.calls.every(([, ,opts])=>!opts.isCurrent()));
});

test('a voice can follow empty source layers but absent or invalid mesh identity stays silent',async()=>{
  const h=fixture();await h.game.load();
  const row=h.data.skillSoundRows[7][0];
  row.layers=Array.from({length:3},()=>Array.from({length:3},()=>[null,0,0]));
  row.castVoice=Array(15).fill(0);row.voiceVolume=250;row.voiceRadius=50;
  for(const meshType of [undefined,14,-1,'0'])assert.equal(h.game.cast(7,{x:0,y:0,z:0},1,meshType),false);
  assert.equal(h.calls.length,0);
  assert.equal(h.game.cast(7,{x:0,y:0,z:0},1,0),true);
  assert.deepEqual(h.calls.map(([ref])=>ref),['a']);
});

test('native Agent phases own delayed decode guards and never schedule packet impact timers',async()=>{
  const h=fixture();await h.game.load();let live=true;
  assert.equal(h.game.nativePhase(1,7,{bad:true},null),false);
  const p={x:3,y:4,z:5};
  assert.equal(h.game.nativePhase(1,7,1,p,0,()=>live),true);
  assert.equal(h.game.nativePhase(2,7,1,p,0,()=>live),true);
  assert.equal(h.calls.length,6);assert.equal(h.pending.length,0);
  const guards=h.calls.map(([, ,opts])=>opts.isCurrent);
  assert.ok(guards.every(g=>g()));live=false;assert.ok(guards.every(g=>!g()));
  assert.equal(h.game.nativePhase(2,7,1,p,0,()=>live),false);
  assert.equal(h.calls.length,6);
  live=true;h.game.clear();assert.ok(guards.every(g=>!g()),'session retirement is also required');
  assert.equal(h.game.nativePhase(3,7,1,p,0,()=>true),false);
  assert.equal(h.calls.length,6,'no guessed explosion phase');
});
