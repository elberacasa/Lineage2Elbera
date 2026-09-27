// Elbera Tools: source-free regressions for bounded native notify semantics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceAnimationChannel, directNotifySound } from '../js/animnotify-clock.js';
const notify=(t,extra={})=>({t,isAttackShot:false,isBoneScale:false,objectRef:1,function:'None',...extra});
const advance=(notifies,extra={})=>advanceAnimationChannel({frame:.125,rate:1,last:.875,delta:.75,
  notifies,notifiesEnabled:true,...extra});

test('original batch arithmetic keeps serialized order and discards a negative remainder below terminal',()=>{
  const result=advance([notify(.25),notify(.5)]);
  assert.equal(result.status,'ready');assert.equal(result.frame,.5);
  assert.deepEqual(result.events.map(e=>e.remaining),[.625,-1.25]);
  assert.equal(result.discarded,-1.25);assert.equal(result.remaining,0);
  const unsorted=advance([notify(.75),notify(.25),notify(.5)],{frame:0,delta:1});
  assert.deepEqual(unsorted.events.map(e=>e.index),[0,1,2]);
  assert.equal(unsorted.frame,.5);
});
test('old bound is exclusive, new inclusive; null objects split time; repeated terminal ticks stay stopped',()=>{
  const result=advance([notify(.125),notify(.5,{objectRef:0})],{delta:.375});
  assert.deepEqual(result.events.map(e=>[e.index,e.dispatch]),[[1,'null']]);
  assert.equal(result.frame,.5);
  const stopped=advance([notify(.875)],{frame:.8,delta:.2});
  assert.equal(stopped.rate,0);assert.equal(stopped.events.length,1);
  assert.equal(advance([notify(.875)],{frame:stopped.frame,rate:0}).events.length,0);
});
test('unsupported filtering, postload script and missing channel policy cannot dispatch a partial batch',()=>{
  for(const rows of [[notify(.25),notify(.5,{isBoneScale:true})],
    [notify(.25,{isAttackShot:true}),notify(.5,{isAttackShot:true})]]) {
    const before=structuredClone(rows), result=advance(rows);
    assert.equal(result.status,'unsupported');assert.equal(result.reason,'unresolved-native-notify-removal');
    assert.equal(result.events,undefined);assert.deepEqual(rows,before);
  }
  assert.equal(advance([notify(.25,{function:'RunScript'})]).status,'unsupported');
  assert.equal(advance([],{notifiesEnabled:undefined}).status,'unsupported');
  assert.equal(advance([notify(.25)],{notifiesEnabled:false}).frame,.875);
});
test('direct sound retains zero volume but rejects unknown probability or imported zero-radius policy',()=>{
  const sound={classPath:'Engine.AnimNotify_Sound',isSound:true,sound:'Bank.Group.Sound',
    soundInfo:{status:'source-direct',volume:0,radius:30,random:100}};
  assert.deepEqual(directNotifySound(sound),{ref:'Bank.Group.Sound',volume:0,radius:30});
  for(const change of [{random:99},{status:'source-surface'},{radius:null},{radius:0},{volume:NaN}]) {
    assert.equal(directNotifySound({...sound,soundInfo:{...sound.soundInfo,...change}}),null);
  }
  assert.equal(directNotifySound({...sound,classPath:'Other.AnimNotify_Sound'}),null);
});

test('finite source values cannot expose nonfinite derived frames or remainders',()=>{
  for (const values of [
    {rate:3e38,delta:2},
    {frame:-.25,tweenRate:3e38,delta:2},
    {frame:0,notifies:[notify(Math.fround(1e-45)),notify(.5)]},
    {frame:1,rate:1e-40,delta:1e-10,loop:true},
  ]) {
    const before=structuredClone(values), result=advance([],values);
    assert.equal(result.status,'unsupported');
    assert.equal(result.reason,'nonfinite-channel-result');
    assert.equal(result.events,undefined,'a rejected batch cannot dispatch partial events');
    assert.deepEqual(values,before);
  }
  const finiteNegative=advance([notify(.25),notify(.5)]);
  assert.equal(finiteNegative.status,'ready');
  assert.equal(finiteNegative.discarded,-1.25,'finite original negative remainders stay intact');
});

test('clock admission rejects missing state and invalid stored endpoint or loop policy',()=>{
  assert.equal(advanceAnimationChannel(null).reason,'missing-channel-clock');
  assert.equal(advance([],{last:1-1e-10}).reason,'invalid-channel-clock');
  assert.equal(advance([],{loop:'false'}).reason,'invalid-channel-loop');
});
