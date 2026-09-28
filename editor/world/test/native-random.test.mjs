// Elbera Tools: authored seeds/objects, exact integer reference and draw order.
// Original instruction correspondence is a separate private-input check.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeRandom,createBrowserRandom} from '../js/native-random.js';
import {selectNotifySound} from '../js/animnotify-clock.js';

const sound = random => ({classPath:'Engine.AnimNotify_Sound',isSound:true,
  sound:'Fixture.Sound',soundInfo:{status:'source-direct',random,volume:250,radius:50}});

test('32-bit generator agrees with independent full-width integer arithmetic over overflow boundaries',()=>{
  for (const seed of [0,1,0x7fffffff,0x80000000,0xffffffff,0x12345678]) {
    const random=createNativeRandom(seed);let reference=BigInt(seed);
    for(let i=0;i<1000;i++) {
      reference=(reference*214013n+2531011n)&0xffffffffn;
      assert.equal(random.nextInt(),Number((reference>>16n)&32767n));
      assert.equal(random.state,Number(reference));assert.equal(random.draws,i+1);
    }
  }
});

test('explicit seeds are required; contexts are independent until deliberately shared',()=>{
  for(const seed of [undefined,null,-1,0x100000000,.5,NaN,Infinity,'1',true]) {
    assert.throws(()=>createNativeRandom(seed),/explicit unsigned 32-bit/);
  }
  const a=createNativeRandom(0),b=createNativeRandom(0);
  assert.equal(a.nextInt(),38);assert.equal(a.nextInt(),7719);
  assert.equal(b.draws,0);assert.equal(b.state,0);assert.equal(b.nextInt(),38);
});

test('browser entropy supplies one uint32 seed without inventing a fallback seed',()=>{
  let calls=0;
  const random=createBrowserRandom({getRandomValues(bytes){calls++;assert.equal(bytes.length,1);bytes[0]=0xffffffff;return bytes;}});
  assert.equal(random.state,0xffffffff);
  random.nextInt();random.nextInt();assert.equal(calls,1);
  assert.equal(createBrowserRandom(null),null);assert.equal(createBrowserRandom({}),null);
});

test('sound gates draw once before signed threshold checks, including always and never thresholds',()=>{
  const random=createNativeRandom(0);
  assert.equal(selectNotifySound(sound(100),random).randomValue,38);
  assert.equal(selectNotifySound(sound(0),random).randomValue,7719);
  const next=selectNotifySound(sound(50),random);
  assert.equal(next.randomValue,21238);assert.equal(next.status,'ready');
  assert.equal(random.draws,3);
  for(const [threshold,expected] of [[-2147483648,'filtered'],[0,'filtered'],[38,'filtered'],[39,'ready'],[100,'ready'],[2147483647,'ready']]) {
    assert.equal(selectNotifySound(sound(threshold),createNativeRandom(0)).status,expected);
  }
});

test('integer modulo bias is retained over the complete native result range',()=>{
  for(const threshold of [30,50]) {
    let played=0;
    for(let value=0;value<=32767;value++) {
      const result=selectNotifySound(sound(threshold),{nextInt:()=>value});
      if(result.status==='ready')played++;
    }
    assert.equal(played,328*threshold); // These thresholds are below remainder68.
    assert.notEqual(played,32768*threshold/100);
  }
});

test('surface/missing properties consume the dispatched base-class draw but never invent direct audio',()=>{
  const random=createNativeRandom(0);
  const surface={...sound(100),sound:null,soundInfo:{...sound(100).soundInfo,status:'source-surface'}};
  assert.equal(selectNotifySound(surface,random).reason,'unported-sound-notify-branch');
  const missing={...sound(100),soundInfo:null};
  assert.equal(selectNotifySound(missing,random).reason,'missing-original-random-threshold');
  assert.equal(random.draws,2);
  assert.equal(selectNotifySound({...sound(100),classPath:'Fixture.SoundChild'},random).reason,'unported-sound-notify-class');
  assert.equal(random.draws,2,'unknown overrides cannot be dispatched as the base method');
});

test('missing contexts/invalid draws reject and original volume zero is retained',()=>{
  assert.equal(selectNotifySound(sound(100),null).reason,'missing-random-context');
  for(const value of [-1,32768,NaN,.5,'38']) {
    assert.equal(selectNotifySound(sound(100),{nextInt:()=>value}).reason,'invalid-native-random-result');
  }
  const zero=sound(100);zero.soundInfo.volume=0;
  const result=selectNotifySound(zero,createNativeRandom(0));
  assert.equal(result.status,'ready');assert.equal(result.volume,0);assert.equal(result.radius,50);
});
