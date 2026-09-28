// Elbera Tools: bounded original Gremlin/Fox initial channel-zero loop.
// Selection/rate: check_npc_animation_native.py and its evidence document.
// Constructor/callback/setup conditions are explicit port-owned inputs below;
// packet combat=0 is never a substitute for those fields. This adapter owns no
// actor, pose interpolation, audio, transport, resource loading or retirement.
import {createWaitSequence, advanceWaitSequence} from './waitanim.js';
import {validateAnimationNotifies} from './animnotify-clock.js';

const f = Math.fround;
const unsupported = reason => ({status:'unsupported', reason});
const finite = value => typeof value === 'number' && Number.isFinite(value) && Number.isFinite(f(value));
const byte = value => Number.isInteger(value) && value >= 0 && value <= 255;
const dword = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
const same = (a,b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const list = (value,length,predicate) => {
  if (!Array.isArray(value) || value.length !== length) return false;
  for (let index=0;index<length;index++) {
    if (!Object.hasOwn(value,index) || !predicate(value[index],index,value)) return false;
  }
  return true;
};
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// Source fingerprints, not a generated catalog schema or a legacy clip alias,
// constrain this initial implementation. Other editions/classes need evidence.
export const NPC_WAIT_SOURCES = Object.freeze({
  'animations/LineageMonsters.ukx':'157715304bfb1f289ce6bf202e5651f3809f57d5b061239db0c6a2a817c9a9c9',
  'system/Core.u':'de5f0ee0a773327bce13c96622fd3c654cff7db88b9be065d1232590c140fda0',
  'system/Engine.int':'4f178abee824ebb092aab5012ad4096469d6aaa26e426041bb1954360c7aaa3f',
  'system/Engine.u':'9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761',
  'system/LineageMonster.int':'2f026530e5b7f3d6ba43bbc208252cc665c965cec4d16a1a84d11e48192eb432',
  'system/LineageMonster.u':'f06ac53f7df24bd13d6e7a0d25d9e3ca4e4502af2437518e49d96a053987d7b6',
  'system/LineageWarrior.u':'747b1e7c3045c748c08b03b54893dc2d29cf7103379f19804ccbeb7764224558',
  'system/core.int':'432a472b6e0cf9a31008a0468670f1e30871f3965f71465a2796951b72a40d27',
  'system/lineagewarrior.int':'8d951cbccd010a849f05df827d7065ec5f9372245953e71f3e88344cf8189485',
  'system/npcgrp.dat':'f551a0f9a0d6765bd783d8f55b1847ba2d5e17acb9a50ae4268c11e1f13d3e8c',
});
const profiles = {
  20001: {className:'LineageMonster.gremlin', mesh:'LineageMonsters.gremlin_m00', animation:'LineageMonsters.gremlin_anim',
    meshHash:'8c302df3acd9879591b6b7b268a8fbda4127ee39e2d6a6c9ef0cc7b78fc6dc98',
    animationHash:'e673bb720d186514c483b0538087b9f1da62c8fe1c3d4fd03276b1918156020c', attackWaitFrames:41},
  20091: {className:'LineageMonster.fox', mesh:'LineageMonsters.Fox_m00', animation:'LineageMonsters.Fox_anim',
    meshHash:'a58417c328da0c45095cccbc52b3d2d5c427d490681cdbc20501377c11769176',
    animationHash:'c6c8d78a20c6d21401bcb241e4b8208e12ceda579dbfbf7c432f622eb48f3a25', attackWaitFrames:31},
};
// Independently decoded npcgrp row 18342 shares this exact class/mesh chain.
// Its differing final DWORD (FL2NpcData +dc) is not the packet-created User
// type field (+8=1). Do not generalize this to a display-name/mesh-only alias.
profiles[18342] = profiles[20001];
function deeplyFrozen(value, seen=new Set()) {
  if (!value || typeof value !== 'object') return true;
  if (seen.has(value)) return false;
  seen.add(value);
  const result = Object.isFrozen(value) && Object.values(value).every(child=>deeplyFrozen(child,seen));
  seen.delete(value);
  return result;
}
function owned(value) {
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(Array.isArray(value) ? value.map(owned)
    : Object.fromEntries(Object.entries(value).map(([key,child])=>[key,owned(child)])));
}

/** These fields describe state installed/tracked by the port, not assertions
 * about a remote native process. The checked fresh normal constructors supply
 * the zeros/None values; supported startup callbacks preserve them.
 * - userItemBankMode/fallbackItem: User +94/+d0; empty equipment + original
 *   item-map key-0 miss selects CurWeaponType +71d = 0.
 * - lobby/ride/fishing: Pawn +17ec/+714/+720; abnormalStates is the actual
 *   +165c collection (an incoming zero mask does not empty it).
 * - swim names: source slot-0 +10ec/+112c None makes the Physics/water branch
 *   irrelevant without assigning invented Physics or water-state values.
 * - damage/spine: Pawn +73c/+748, independent of packet combat.
 * - channel: one ordinary channel0, base bone0, mode0, notify-disable +44=0.
 * - rootLock/referenceOverride: instance +218/+20c; modifierCounts are the
 *   four source arrays' counts +194/+1a0/+1ac/+1b8.
 * Missing state is unsupported. Later mutations must retire this initial loop;
 * this helper does not re-admit an actor from a newer superficially empty packet.
 */
function startupReason(input) {
  if (!input || typeof input !== 'object') return 'missing-startup-inputs';
  for (const key of ['userItemBankMode','userFallbackItem','curWeaponType',
    'channelBaseBone','channelSpecialMode','channelNotifyDisabled','rootLock','referenceOverride']) {
    if (!Object.hasOwn(input,key) || input[key] !== 0) return `unsupported-startup-${key}`;
  }
  for (const key of ['lobby','ride','fishing','damageAct','spineRotation']) {
    if (!Object.hasOwn(input,key) || input[key] !== false) return `unsupported-startup-${key}`;
  }
  if (!Object.hasOwn(input,'abnormalStates') || !list(input.abnormalStates,0,()=>true)) return 'unsupported-startup-abnormalStates';
  if (!Object.hasOwn(input,'swimWait') || !Object.hasOwn(input,'swimAttackWait')
    || !same(input.swimWait,'None') || !same(input.swimAttackWait,'None')) return 'unsupported-startup-swim-sequence';
  if (!Object.hasOwn(input,'channelCount') || input.channelCount !== 1) return 'unsupported-startup-channelCount';
  if (!Object.hasOwn(input,'modifierCounts') || !list(input.modifierCounts,4,value=>value===0)) return 'unsupported-startup-modifiers';
  return null;
}
function rawReason(raw) {
  if (!raw || typeof raw !== 'object' || !deeplyFrozen(raw)) return 'immutable-original-npc-snapshot-required';
  if (!['npcId','waitType','dead','combat','running','rhand','chest','lhand','speedMul','summonAnimationRaw','npcInfoTail']
    .every(key=>Object.hasOwn(raw,key))) return 'complete-original-npc-snapshot-required';
  if (!Number.isInteger(raw.npcId) || !Object.hasOwn(profiles,raw.npcId)) return 'unsupported-original-npc';
  if (raw.waitType !== 1 || raw.dead !== false || !byte(raw.combat) || !byte(raw.running)) return 'unsupported-initial-wait-state';
  if (![raw.rhand,raw.chest,raw.lhand].every(value=>value===0)) return 'unsupported-initial-equipment';
  if (![0,2].includes(raw.summonAnimationRaw)) return 'unsupported-original-spawn-mode';
  if (!finite(raw.speedMul) || !(f(raw.speedMul)>0)) return 'unsupported-original-wait-rate';
  const tail=raw.npcInfoTail, ext=tail?.extension;
  if (!list(tail?.prefix,3,dword) || !list(ext?.dwords,5,dword) || !list(ext?.bytes,2,byte)
    || !list(ext?.doubles,2,value=>typeof value==='number' && Number.isFinite(value))
    || !list(ext?.finalDwords,2,dword)) return 'complete-original-npc-tail-required';
  // Post-OnNpcInfo assignments can affect subsequent ticks. Preserve all raw
  // fields; reject the nonzero known effect inputs rather than interpreting
  // every opaque tail word as an abnormal-state flag or a neutral sentinel.
  if (ext.dwords[0] !== 0 || ext.bytes.some(value=>value!==0)) return 'unsupported-incoming-npc-effect';
  return null;
}

/** originalSource is the qualified, hash-verified npcsourceanim loader result.
 * This adds the bounded native class/selector domain; it does not replace that
 * loader's built-geometry/bundle verification or the pose rig's full admission.
 * sources is the existing runtime index.sources, preserved by the caller.
 */
export function planInitialNpcWait(raw, originalSource, startupInputs, sources) {
  const rawError=rawReason(raw), stateError=startupReason(startupInputs);
  if (rawError || stateError) return unsupported(rawError || stateError);
  if (!sources || !Object.entries(NPC_WAIT_SOURCES).every(([key,value])=>Object.hasOwn(sources,key)
    && sources[key]===value)) return unsupported('unverified-original-npc-sources');
  const profile=profiles[raw.npcId], record=originalSource?.record;
  const npc=record?.npc, model=record?.model, catalog=originalSource?.catalog, skeleton=originalSource?.skeleton;
  const ancestry=[profile.className,'LineageWarrior.LineagePawn','Engine.Pawn','Engine.Actor','Core.Object'];
  if (record?.npcId!==raw.npcId || !same(npc?.className,profile.className)
    || !list(npc?.inheritance,ancestry.length,(_,index)=>same(npc.inheritance[index],ancestry[index]))
    || !same(npc?.meshRef,profile.mesh) || !same(npc?.animationRef,profile.animation)
    || !same(model?.meshRef,profile.mesh) || !same(model?.animationRef,profile.animation)
    || !/^npc_[a-f0-9]{32}$/.test(record?.modelId) || npc?.modelId!==record.modelId
    || catalog?.modelId!==record.modelId || !same(catalog?.meshRef,profile.mesh)
    || !same(catalog?.animationRef,profile.animation)) return unsupported('unverified-original-npc-identity');
  const hashes={meshExportSHA256:profile.meshHash, animationExportSHA256:profile.animationHash,
    meshPackageSHA256:NPC_WAIT_SOURCES['animations/LineageMonsters.ukx'],
    animationPackageSHA256:NPC_WAIT_SOURCES['animations/LineageMonsters.ukx']};
  if (catalog.format!=='elbera-original-animation-tracks-v1' || skeleton?.format!=='elbera-original-npc-skeleton-v1'
    || !Object.entries(hashes).every(([key,value])=>model.source?.[key]===value && skeleton.source?.[key]===value)
    || catalog.source?.exportSHA256!==profile.animationHash
    || catalog.source?.packageSHA256!==hashes.animationPackageSHA256
    || catalog.source?.notifyClassPackage?.SHA256!==NPC_WAIT_SOURCES['system/Engine.u']) return unsupported('unverified-original-npc-bundle');
  const selector=raw.combat===0?'WaitAnimName':'AtkWaitAnimName';
  const binding=npc.selectors?.[selector]?.['0'];
  const expected=raw.combat===0?{name:'Wait',frames:61}:{name:'atkwait',frames:profile.attackWaitFrames};
  const matches=Array.isArray(catalog.sequences) ? catalog.sequences.filter(row=>same(row?.name,binding?.sequence)) : [];
  if (binding?.status!=='source-sequence' || !same(binding.declaredBy,profile.className)
    || !same(binding.value,expected.name) || !same(binding.sequence,expected.name)
    || binding.frames!==expected.frames || binding.rate!==30 || matches.length!==1) return unsupported('missing-original-npc-wait-selector');
  const sequence=matches[0];
  if (sequence.frames!==binding.frames || sequence.rate!==binding.rate
    || !hash(sequence.source?.SHA256) || sequence.movement?.flags!==0 || sequence.movement?.startBone!==0
    || validateAnimationNotifies(sequence.notifies)) return unsupported('unsupported-original-npc-wait-sequence');
  // No script/BoneScale/AttackShot behavior is introduced by the initial wait
  // adapter. Original Wait/AtkWait here contain Sound objects only; empty and
  // null-object source arrays retain their distinct native clock behavior.
  if (sequence.notifies.some(notify=>notify.isAttackShot || notify.isBoneScale
    || (notify.objectRef!==0 && (notify.classPath!=='Engine.AnimNotify_Sound' || notify.isSound!==true)))) {
    return unsupported('unsupported-original-npc-wait-notify');
  }
  const plan=owned({status:'ready',kind:'original-npc-initial-wait',npcId:raw.npcId,
    modelId:record.modelId,selector,stance:0,slot:raw.combat===0?'idle':'combatIdle',
    // clip is the exact source sequence identity, never an exported clip alias.
    clip:sequence.name,seq:sequence.name,frames:sequence.frames,sourceRate:sequence.rate,
    sourceEndpoint:f((sequence.frames-1)/sequence.rate),rate:f(raw.speedMul),tween:0,loop:true,
    notifies:sequence.notifies});
  if (!createWaitSequence(plan)) return unsupported('unsupported-original-npc-clock');
  plans.add(plan);
  return plan;
}

const plans=new WeakSet(), states=new WeakMap();
export function createInitialNpcWait(plan) {
  if (!plans.has(plan)) return null;
  const channel=createWaitSequence(plan);
  const state=Object.freeze({plan,get frame(){return channel.frame;}});
  states.set(state,channel);
  return state;
}
export function advanceInitialNpcWait(state,delta) {
  const channel=states.get(state);
  if (!channel) return unsupported('missing-original-npc-wait-channel');
  // Q0 starts at Float32(.0001). Positive ordinary GetFrame overwrites mapped
  // q/p and reference-fallback rows even if an earlier shadow sampled .001.
  // It does NOT reconstruct tween bookkeeping: negative transitions are outside
  // this loop. Existing clock owns crossings, source order and the four-step cap.
  return advanceWaitSequence(channel,delta);
}
