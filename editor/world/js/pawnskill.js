// Elbera Tools: bounded original Pawn pending-event lifecycle.
// docs/native-pawn-notify-evidence.md. This produces ordered dispatch plans;
// effect geometry, returned actor bookkeeping and native sound stopping are separate.
import { selectSkillActions } from './skillaction-dispatch.js';

const SHOT = 'Engine.AnimNotify_AttackShot';
const ascii = value => typeof value === 'string' && /^[\x20-\x7e]+$/.test(value);
const unsupported = reason => ({status:'unsupported', reason});

/** Recover the selected source object independently of numeric shotFallback.
 *  A miss leaves LastShotName unchanged; a zero-time hit writes it. Only
 *  exact-class records from one verified model package are admitted here. */
export function lastShotObject(schedule, modelSource) {
  if (schedule?.status !== 'ready' || !Array.isArray(schedule.phases)
      || !ascii(modelSource?.package) || !/^[a-f0-9]{64}$/.test(modelSource.packageSHA256 || ''))
    return unsupported('missing-model-source');
  const prefix=modelSource.package.replace(/\.[^.]+$/, '') + '.';
  for (const phase of schedule.phases) {
    if (!Array.isArray(phase.notifies)) return unsupported('missing-notifies');
    for (const note of phase.notifies) if (note.isAttackShot) {
      if (note.classPath !== SHOT || !ascii(note.objectPath)
          || !note.objectPath.startsWith(prefix) || !(note.objectRef > 0))
        return unsupported('unverified-shot-identity');
    }
  }
  let selected=null;
  for (let i=schedule.phases.length-1;i>=0;i--) {
    if (i === schedule.flexIndex) continue;
    const phase=schedule.phases[i], note=phase.notifies.findLast(n=>n.isAttackShot);
    if (!note) continue;
    selected=note.objectPath;
    if (Math.fround(Math.fround(note.t)*phase.scanDuration)>0) break;
  }
  return {status:'ready', objectPath:selected,
    identity:'exact-class-within-model-source-path-equivalence'};
}

export function createPawnSkill({schedule, agent, caster, mainTarget, modelSource, skillId, level} = {}) {
  const identity=lastShotObject(schedule,modelSource);
  if (identity.status !== 'ready') return identity;
  if (agent?.status !== 'resolved-source-object' || !agent.entry
      || !Number.isInteger(schedule.style) || schedule.style === 12
      || !caster || !mainTarget || !Number.isInteger(skillId) || skillId<=0
      || !Number.isInteger(level) || level<=0) return unsupported('unsupported-agent-input');
  // Validate all source dispatch arrays before adopting the cast.
  for (const phase of ['c','h','p','s']) {
    const plan=selectSkillActions({entry:agent.entry,phase,caster,mainTarget,
      associatedActors:[],stageShot:1,pending:2});
    if (!['ready','native-no-op'].includes(plan.status)) return unsupported('unverified-agent-actions');
    if (phase !== 'p' && plan.actions.some(a=>a.action.actionStatus==='unsupported-action-reference'))
      return unsupported('unverified-agent-actions');
  }
  return {status:'ready', active:true, skillId,level,entry:agent.entry,caster,
    actionTarget:mainTarget,mainTarget,associatedActors:[],magicType:schedule.style,
    lastShot:identity.objectPath,stageShot:0,stagePreshot:0,
    pending:0,preshot:0,channeling:0,completion:null};
}

/** MagicSkillLaunched only associates targets. Incoming level is deliberately
 *  not compared. It neither releases a shot nor waits/retries one. */
export function associatePawnSkill(state,{skillId,target}) {
  if (!state?.active || state.skillId!==skillId || state.mainTarget===null || !target) return false;
  // Original count/element-size append path has no value comparison; the
  // incoming actor is written after allocation. Preserve order and duplicates.
  state.associatedActors.push(target);
  return true;
}

export function cancelPawnSkill(state) {
  if (!state) return;
  state.active=false;state.actionTarget=null;state.mainTarget=null;
  state.associatedActors=[];state.pending=state.preshot=state.channeling=0;
}

/** Called after old-channel events, before phase completion is exposed to the
 *  renderer. activeTime is the PRE-addition native value, never a timer deadline.
 *  Current action target and MagicInfo.mainTarget are distinct native fields.
 *  Completion's erased name-comparison polarity remains explicitly unresolved.
 */
export function consumePawnSkillTick(state,{events,activeTime,complete=false,actionTargetPresent=true}) {
  if (!state?.active) return {status:'inactive',dispatches:[]};
  if (!Array.isArray(events) || !Number.isFinite(activeTime) || activeTime<0)
    return unsupported('invalid-pawn-tick');
  for (const event of events) {
    if (event.dispatch!=='object' || !actionTargetPresent || state.actionTarget===null) continue;
    const note=event.notify;
    if (note?.classPath==='Engine.AnimNotify_Channeling') state.channeling=1;
    else if (note?.classPath==='Engine.AnimNotify_AttackPreShot') state.preshot=1;
    else if (note?.classPath===SHOT) {
      if (state.lastShot!==null && note.objectPath===state.lastShot) state.pending=2;
      else if ([8,9,10].includes(state.magicType)) state.pending=1;
    }
  }
  const dispatches=[];
  const dispatch=phase=>{
    const plan=selectSkillActions({entry:state.entry,phase,caster:state.caster,
      mainTarget:state.mainTarget,associatedActors:state.associatedActors,
      stageShot:state.stageShot,pending:state.pending});
    dispatches.push({phase,plan,stageShot:state.stageShot,stagePreshot:state.stagePreshot,
      pending:state.pending,soundType:phase==='c'?1:phase==='s'?2:null});
  };
  if (activeTime===0) {
    state.pending=state.preshot=0;
    dispatch('c');
  } else {
    if (state.channeling) {dispatch('h');state.channeling=0;}
    if (state.preshot) {state.stagePreshot++;dispatch('p');state.preshot=0;}
    if (state.pending) {
      state.stageShot++;dispatch('s');
      if (state.pending===2) {
        // Clear(0) leaves Agent/identity/stages/LastShotName and action5 intact.
        state.mainTarget=null;state.associatedActors=[];
        state.preshot=state.channeling=0;
      }
      state.pending=0;
    }
  }
  if (complete) {
    state.completion='unresolved-completion-shot-comparison';
    cancelPawnSkill(state);
  }
  if (dispatches.some(d=>!['ready','native-no-op'].includes(d.plan.status))) {
    cancelPawnSkill(state);
    return unsupported('unverified-agent-actions');
  }
  return {status:'ready',dispatches,completion:state.completion};
}
