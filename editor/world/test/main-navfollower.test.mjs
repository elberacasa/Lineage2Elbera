// Elbera Tools: actual main.js navigation glue with synthetic geometry, time,
// transport and rendered body. No browser, credentials or live game mutations.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {NavFollower} from '../js/navfollower.js';
import * as THREE from '../vendor/three.module.min.js';

const source=fs.readFileSync(new URL('../js/main.js',import.meta.url),'utf8');
function section(first,last) {
  const start=source.indexOf(first),end=source.indexOf(last,start);
  assert.ok(start>=0&&end>start,`main source boundary: ${first}`);
  return source.slice(start,end);
}
const setup=section('let selfServerPosition = null;','// --- Phase C.1');
const navigation=section('// The narrow fallback is a configured-server interoperability path.','// WASD honesty:');
const handlers=[
  section("net.on('move',",'// TeleportToLocation'),
  section("net.on('teleport',",'// ValidateLocation'),
  section("net.on('validate',","net.on('remove',"),
  section("net.on('changeWait',",'// ChangeMoveType'),
  section("net.on('die',","net.on('revive',"),
  section("net.on('skillCast',",'// Native model/voice identity'),
].join('\n');
const a={x:8,y:8,z:0},b={x:24,y:8,z:16},c={x:24,y:24,z:32};
const plain=value=>JSON.parse(JSON.stringify(value));
function harness({actual=a,drawn=a}={}) {
  let now=0,nextTimer=0;
  const sent=[],finds=[],placed=[],timers=new Map(),events=new Map(),warnings=[];
  const toThree=(x,y,z)=>new THREE.Vector3(x*.01,z*.01,-y*.01);
  const char={group:{position:toThree(drawn.x,drawn.y,drawn.z)},target:null,dead:false,
    clearTarget(){this.target=null;},setTarget(p){this.target=p.clone();},setWaitType(){}};
  const ctx={NavFollower,THREE,console:{warn:(...m)=>warnings.push(m)},performance:{now:()=>now},
    setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,at:now+ms});return id;},
    clearTimeout:id=>timers.delete(id),character:char,online:true,selfId:7,selfSitting:false,
    sceneLoading:false,wasdLeg:null,terrain:null,heightRouter:{},cameraInspection:null,MOVE_LEG_M:20,moveQueue:[],
    charSheetData:{runSpeed:130,walkSpeed:80,speedMul:1,running:true},
    l2ToThree:toThree,
    // Deliberately retain inverse-transform float noise: main must round XY.
    threeToL2:p=>({x:p.x/.01,y:-p.z/.01,z:p.y/.01}),
    placeSelfAtServerPos(x,y,z){placed.push({x,y,z});char.group.position.copy(toThree(x,y,z));},
    clickMark:{show(){}},notePlayerAction(){},entityHeadPos:()=>null,gameSound:{},
    combat:{markDead(){}},entities:{move(){},place(){},setWaitType(){},die(){},skillFlash(){}},
    skillFx:{prepareCast:()=>({})},skillBar:{cast:null,startCastBar(){}},onlineGeneration:1,
    net:{on:(op,fn)=>events.set(op,fn),send:(op,fields)=>{sent.push({op,...fields});return true;}},
    nav:{_lineOk:(from,to)=>to.z??from.z,findPath(...args){finds.push(args);return ctx.route(...args);}},
    route:(x,y,z,gx,gy,gz)=>({complete:true,fineFallback:true,
      points:[{x,y,z},{...b},{x:gx,y:gy,z:gz}]})};
  vm.runInNewContext(setup+'\n'+navigation+'\n'+handlers+`\n
    globalThis.api={walkToServer,pumpMoveQueue,repathPending,cancelFineNavigation,
      setActual:p=>{selfServerPosition=p;},getActual:()=>selfServerPosition,
      getSync:()=>fineNavSync,getFollower:()=>fineNavFollower,
      queue:moveQueue,getGoal:()=>pendingGoal};`,ctx);
  ctx.api.setActual(actual);
  return {ctx,char,sent,finds,placed,timers,warnings,api:ctx.api,
    click(goal=c){ctx.api.walkToServer(toThree(goal.x,goal.y,goal.z));},
    emit(op,msg){events.get(op)({id:7,...msg});},
    advance(value,{fire=true}={}){now=value;if(fire)for(const [id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn();}}};
}

test('matching actual start begins directly and preserves every raw narrow waypoint',()=>{
  const h=harness();h.click();
  assert.equal(h.api.getSync(),null);assert.equal(h.api.getFollower().active,true);
  assert.deepEqual(plain(h.sent),[{op:'moveTo',...b,ox:a.x,oy:a.y,oz:a.z}]);
  h.emit('move',{...a,tx:b.x,ty:b.y,tz:b.z});
  assert.equal(h.sent.length,1,'order destination is not an arrival');
  h.emit('move',{...b,tx:b.x,ty:b.y,tz:b.z});
  assert.deepEqual(plain(h.sent[1]),{op:'moveTo',...c,ox:b.x,oy:b.y,oz:b.z});
});

test('stale actual origin refreshes once and only matching probe XY admits actual-origin replanning',()=>{
  const stale={x:-100,y:8,z:0},h=harness({actual:stale});h.click();
  assert.deepEqual(plain(h.sent[0]),{op:'moveTo',...a,ox:stale.x,oy:stale.y,oz:stale.z});
  assert.ok(h.api.getSync());assert.equal(h.api.getFollower().active,false);
  const real={x:10,y:8,z:0};
  h.emit('move',{...real,tx:999,ty:999,tz:0});
  h.emit('validate',real);
  assert.equal(h.finds.length,1);assert.ok(h.api.getSync());assert.equal(h.sent.length,1);
  h.emit('move',{...real,tx:a.x,ty:a.y,tz:0});
  assert.equal(h.api.getSync(),null);assert.equal(h.timers.size,0);
  assert.deepEqual(h.finds[1].slice(0,3),[real.x,real.y,real.z]);
  assert.deepEqual(plain(h.sent[1]),{op:'moveTo',...b,ox:real.x,oy:real.y,oz:real.z});
  assert.deepEqual(h.placed,[real]);
});

test('missing cached origin never substitutes the rendered body as packet origin',()=>{
  const h=harness({actual:null});h.click();
  assert.equal(h.sent.length,0);assert.equal(h.api.getSync(),null);
  assert.equal(h.api.getFollower().active,false);assert.equal(h.api.getGoal(),null);
});

test('rounds transformed start and goal XY before route planning',()=>{
  const h=harness({drawn:{...a,x:7.9999999999,y:8.0000000001}});
  h.click({...c,x:24.0000000001,y:23.9999999999});
  assert.deepEqual(h.finds[0],[8,8,0,24,24,32]);
  assert.equal(h.api.getSync(),null);
});

test('unmatched or late responses time out without pumping a queued legacy move',()=>{
  for(const fire of [false,true]) {
    const h=harness({actual:{...a,x:-100}});h.click();
    h.api.queue.push(new THREE.Vector3(100,0,100));h.api.pumpMoveQueue();h.api.repathPending();
    assert.equal(h.sent.length,1);
    h.advance(8000,{fire});
    h.emit('move',{...a,tx:a.x,ty:a.y,tz:0});
    h.api.pumpMoveQueue();h.api.repathPending();
    assert.equal(h.api.getSync(),null);assert.equal(h.api.getFollower().active,false);
    assert.equal(h.sent.length,1);assert.equal(h.finds.length,1);assert.equal(h.api.queue.length,0);
  }
});

test('failed refreshed planning cannot fall through to a straight movement order',()=>{
  const h=harness({actual:{...a,x:-100}});h.click();h.ctx.route=()=>null;
  h.emit('move',{...a,tx:a.x,ty:a.y,tz:0});
  h.api.pumpMoveQueue();h.api.repathPending();
  assert.equal(h.sent.length,1);assert.equal(h.api.getGoal(),null);
  assert.equal(h.char.target,null);assert.equal(h.api.getSync(),null);
});

test('new actions and real sit/death/teleport handlers retire the pending refresh',()=>{
  for(const interrupt of [
    h=>h.ctx.net.send('attack',{id:99}),h=>h.ctx.net.send('moveTo',{...c}),
    h=>h.emit('changeWait',{waitType:0}),h=>h.emit('die',{}),
    h=>h.emit('teleport',{...c}),h=>h.api.cancelFineNavigation('session-reset')]) {
    const h=harness({actual:{...a,x:-100}});h.click();interrupt(h);
    const sends=h.sent.length;
    assert.equal(h.api.getSync(),null);assert.equal(h.timers.size,0);
    h.advance(9000);h.api.pumpMoveQueue();h.api.repathPending();
    assert.equal(h.sent.length,sends);assert.equal(h.api.getFollower().active,false);
  }
});

test('an old refresh timer cannot cancel a replacement request',()=>{
  const h=harness({actual:{...a,x:-100}});h.click();
  const old=[...h.timers.values()][0].fn;
  h.advance(1);h.click({...c,x:40});const current=h.api.getSync();old();
  assert.equal(h.api.getSync(),current);assert.equal(h.timers.size,1);
});

test('authoritative item-triggered self casting retires both a refresh and an active route before its next probe',()=>{
  for(const actual of [a,{...a,x:-100}]) {
    const h=harness({actual});h.click();
    h.ctx.net.send('useItem',{objectId:123});
    assert.ok(h.api.getSync()||h.api.getFollower().active,'ordinary item use alone has no invented cast semantics');
    h.ctx.skillFx.prepareCast=()=>{
      assert.equal(h.api.getSync(),null);assert.equal(h.api.getFollower().active,false);
      return {};
    };
    h.emit('skillCast',{casterId:7,skillId:1,level:1,hitTime:10000,reuse:0});
    assert.equal(h.timers.size,0);assert.equal(h.char.target,null);
    const sends=h.sent.length;
    h.advance(10000);h.api.getFollower().update(10000);h.api.pumpMoveQueue();h.api.repathPending();
    h.emit('move',{...a,tx:a.x,ty:a.y,tz:0});
    assert.equal(h.sent.length,sends,'neither queued probes nor a late refresh can move during the cast');
  }
});

test('another actor casting cannot cancel the player narrow route',()=>{
  const h=harness();h.click();
  h.emit('skillCast',{casterId:8,skillId:1,level:1,hitTime:1000,reuse:0});
  assert.equal(h.api.getFollower().active,true);assert.equal(h.sent.length,1);
});
