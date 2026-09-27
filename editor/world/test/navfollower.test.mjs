// Elbera Tools: portable transport/route-following tests; no original assets,
// credentials, browser, server connection or invented arrival radius.
import test from 'node:test';
import assert from 'node:assert/strict';
import {NavFollower, NAV_FOLLOW_LIMITS} from '../js/navfollower.js';

const speeds = {runSpeed:130, walkSpeed:80, speedMul:1, running:true};
const a={x:8,y:8,z:0}, b={x:24,y:8,z:16}, c={x:24,y:24,z:32};
function harness(lineOk=(from,to)=>to.z) {
  const sent=[],positions=[],completed=[],stopped=[];
  const follower=new NavFollower({lineOk,send:(to,from)=>sent.push({to,from}),
    onPosition:p=>positions.push(p),onComplete:p=>completed.push(p),onStop:r=>stopped.push(r)});
  return {follower,sent,positions,completed,stopped};
}

test('preserves each 16-unit stair corner and advances only from actual exact XY on its floor',()=>{
  const h=harness((from,to)=>from.x===8&&to.y===24?null:to.z);
  assert.equal(h.follower.start([a,b,c],a,speeds,0),true);
  assert.deepEqual(h.sent,[{to:b,from:a}]);
  h.follower.observe(a,20); // order origin, not its destination
  h.follower.update(299);
  assert.equal(h.sent.length,1);
  h.follower.observe({...b,x:23},300); // no one-unit acceptance radius
  assert.equal(h.sent.length,1);
  h.follower.observe(b,301);
  assert.deepEqual(h.sent[1],{to:c,from:b});
  h.follower.observe(c,1000);
  assert.equal(h.follower.status,'complete');
  assert.deepEqual(h.completed,[c]);
});

test('predicted travel only permits a same-destination probe using latest server origin',()=>{
  const h=harness(); h.follower.start([a,b,c],a,speeds,0);
  h.follower.observe({...a,x:12},20);
  h.follower.update(300); // 16/80 seconds + one configured 100ms movement tick
  assert.deepEqual(h.sent[1],{to:b,from:{...a,x:12}});
  assert.equal(h.follower.index,1);
  h.follower.observe({...a,x:20},950);
  h.follower.update(1800);
  assert.deepEqual(h.sent[2],{to:b,from:{...a,x:20}});
  assert.equal(h.completed.length,0);
});

test('rechecks geometry before both a probe and the next waypoint',()=>{
  for (const next of [false,true]) {
    let open=true;
    const h=harness((from,to)=>open?to.z:null);
    h.follower.start([a,b,c],a,speeds,0); h.follower.observe(a,1); open=false;
    if(next) h.follower.observe(b,10); else h.follower.update(900);
    assert.equal(h.sent.length,1);
    assert.equal(h.follower.status,'stopped');
    assert.equal(h.completed.length,0);
  }
});

test('matching XY on another server floor never consumes the waypoint',()=>{
  const h=harness((from,to)=>from.x===to.x&&from.y===to.y&&from.z!==to.z?null:to.z);
  h.follower.start([a,b],a,speeds,0);
  h.follower.observe({...b,z:128},10);
  assert.equal(h.follower.stopReason,'server-arrival-on-different-floor');
  assert.equal(h.completed.length,0);
});

test('missing responses and repeated non-arrival stop under explicit operational limits',()=>{
  const silent=harness(); silent.follower.start([a,b],a,speeds,0);
  silent.follower.update(NAV_FOLLOW_LIMITS.responseTimeoutMs);
  assert.equal(silent.follower.stopReason,'no-server-position-response');
  const stalled=harness(); stalled.follower.start([a,b],a,speeds,0);
  stalled.follower.observe(a,1);
  stalled.follower.update(NAV_FOLLOW_LIMITS.operationTimeoutMs);
  assert.equal(stalled.follower.stopReason,'operational-time-limit');
  assert.equal(stalled.completed.length,0);
});

test('cancelled operations ignore late server events; replacement sends only the new route',()=>{
  const h=harness(); h.follower.start([a,b,c],a,speeds,0);
  h.follower.cancel('teleport'); h.follower.observe(b,1); h.follower.update(5000);
  assert.equal(h.sent.length,1);
  h.follower.start([c,b],c,speeds,6000);
  assert.deepEqual(h.sent[1],{to:b,from:c});
  h.follower.start([a,c],a,speeds,6001);
  assert.deepEqual(h.stopped,['teleport','replaced']);
  assert.deepEqual(h.sent[2],{to:c,from:a});
});

test('rejects incomplete, malformed, floor-mismatched or mismatched-origin inputs without sends',()=>{
  const cases=[[[a],a,speeds],[[a,b],{...a,x:9},speeds],[[a,b],a,{...speeds,running:null}],
    [[a,b],a,{...speeds,walkSpeed:0}],[[a,{...b,z:NaN}],a,speeds],[[a,b],a,{...speeds,speedMul:Infinity}]];
  for(const [points,actual,state] of cases) {
    const h=harness();assert.equal(h.follower.start(points,actual,state,0),false);
    assert.equal(h.sent.length,0);assert.equal(h.follower.status,'stopped');
  }
  const h=harness(()=>null); assert.equal(h.follower.start([a,b],a,speeds,0),false);
  assert.equal(h.sent.length,0);
});

test('owns input/output coordinates so outside mutation cannot change the proven route',()=>{
  const points=[{...a},{...b},{...c}],actual={...a};
  const h=harness(); h.follower.start(points,actual,speeds,0);
  points[1].x=999;actual.x=999;h.sent[0].to.x=999;h.sent[0].from.x=999;
  h.follower.observe(a,1);h.follower.update(900);
  assert.deepEqual(h.sent[1],{to:b,from:a});
});

test('send failure retires the route, and completion cannot be repeated by late samples',()=>{
  for(const send of [()=>{throw Error('offline');},()=>false]) {
    const h=harness();h.follower.send=send;
    assert.equal(h.follower.start([a,b],a,speeds,0),false);
    assert.equal(h.follower.stopReason,'send-failed');
  }
  const done=harness();done.follower.start([a,b],a,speeds,0);
  done.follower.observe(b,1);done.follower.observe(b,2);done.follower.update(900);
  assert.equal(done.completed.length,1);assert.equal(done.sent.length,1);
});

test('an onPosition replacement cannot mark the new command acknowledged with an old sample',()=>{
  const h=harness();h.follower.start([a,b],a,speeds,0);
  h.follower.onPosition=()=>h.follower.start([c,b],c,speeds,10);
  h.follower.observe(b,10);
  assert.equal(h.follower.status,'active');
  assert.deepEqual(h.follower.position,c);
  assert.equal(h.follower.pending.received,false);
  assert.equal(h.completed.length,0);
  assert.equal(h.sent.length,2);
});

test('an old transport failure cannot cancel a synchronously replaced route',()=>{
  const h=harness();let replacement=false;
  h.follower.send=(to,from)=>{
    h.sent.push({to,from});
    if(!replacement){replacement=true;h.follower.start([c,b],c,speeds,1);throw Error('old-send');}
  };
  h.follower.start([a,b],a,speeds,0);
  assert.equal(h.follower.status,'active');
  assert.deepEqual(h.follower.position,c);
  assert.equal(h.sent.length,2);
});
