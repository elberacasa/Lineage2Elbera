// Elbera Tools: original ordinary sit/stand/wait sequence inputs.
// Native source: docs/sitting-animation-audit.md. This does not resolve
// collision placement, exported pose interpolation or special wait types.
import { advanceAnimationChannel, validateAnimationNotifies } from './animnotify-clock.js';

const f=Math.fround;
const finite=v=>typeof v==='number' && Number.isFinite(v) && Number.isFinite(f(v));
const unsupported=reason=>({status:'unsupported',reason});

export function waitSequence(table,modelId,stance,slot,options={}) {
  if (!['sitDown','sitWait','standUp','idle'].includes(slot)) return unsupported('unsupported-wait-slot');
  const model=table?.models?.[modelId], binding=model?.slots?.[slot]?.[stance];
  const source=table?.clips?.[modelId]?.[binding?.clip];
  if (!source?.originalTiming || typeof binding?.seq!=='string' || typeof source.seq!=='string'
      || binding.seq.toLowerCase()!==source.seq.toLowerCase()) return unsupported('missing-original-wait-sequence');
  const storedRate=slot==='sitDown'?model.rates?.sit:slot==='standUp'?model.rates?.stand:
    Object.hasOwn(options,'loopRate')?options.loopRate:1;
  // Original GetSitAnimRate/GetStandAnimRate replace exactly zero with 1.
  const rate=(slot==='sitDown'||slot==='standUp') && storedRate===0?1:storedRate;
  if (!Number.isInteger(source.frames) || source.frames<2 || !finite(source.rate) || source.rate<=0
      || !finite(rate) || rate<=0 || validateAnimationNotifies(source.notifies))
    return unsupported('unsupported-wait-sequence-inputs');
  const loop=slot==='sitWait' || slot==='idle';
  return {status:'ready',slot,clip:binding.clip,seq:binding.seq,frames:source.frames,
    sourceRate:source.rate,sourceEndpoint:f((source.frames-1)/source.rate),
    rate:f(rate),tween:f(loop ? options.initial === true ? 0 : .2 : .1),loop,notifies:source.notifies};
}

export function createWaitSequence(plan) {
  if (plan?.status!=='ready' || !finite(plan.tween) || plan.tween<0) return null;
  const frameRate=f(f(plan.sourceRate/plan.frames)*plan.rate),last=f(1-1/plan.frames);
  const tweenRate=plan.tween>0?f(1/(plan.tween*f(plan.frames))):0;
  if (!(frameRate>0) || !Number.isFinite(frameRate) || (plan.tween>0 && !(tweenRate>0))
      || !Number.isFinite(tweenRate) || last>=1) return null;
  return {plan,frame:plan.tween>0?f(-1/plan.frames):f(plan.loop ? .0001 : .001),frameRate,last,tweenRate};
}

export function advanceWaitSequence(state,delta,advancementBudget=4) {
  if (!state) return unsupported('missing-wait-channel');
  const {plan}=state, previousRate=state.frameRate;
  const result=advanceAnimationChannel({frame:state.frame,rate:state.frameRate,last:state.last,
    tweenRate:state.tweenRate,delta,advancementBudget,loop:plan.loop,notifiesEnabled:true,notifies:plan.notifies});
  if (result.status!=='ready') return result;
  state.frame=result.frame;state.frameRate=result.rate;
  return {...result,done:!plan.loop && previousRate>0 && result.rate===0,
    sampleTime:result.frame<0?0:!plan.loop&&result.frame===state.last?plan.sourceEndpoint:
      Math.max(0,result.frame*plan.frames/plan.sourceRate),
    tweenProgress:Math.min(1,1+Math.min(0,result.frame)*plan.frames)};
}

/** Channel-zero ordinary AnimEnd calls PlayWaiting immediately, then the
 * native channel loop consumes remaining delta with the SAME four-step cap.
 * Each segment must be sampled before installing the next sequence so that
 * its tween starts at the displayed endpoint. EnableChannelNotify is an
 * explicit browser policy; the fresh native allocation default is unknown.
 */
export function advanceWaitPlayback(state,delta) {
  const segments=[];
  let budget=4, remaining=delta;
  for (;;) {
    const step=advanceWaitSequence(state.channel,remaining,budget);
    if (step.status!=='ready') return {...step,segments};
    segments.push({...step,plan:state.channel.plan,changed:state.changed});
    state.changed=false;
    budget-=step.advancements;
    if (!step.done) return {status:'ready',segments};
    const next=createWaitSequence(state.successor);
    if (!next) return {status:'unsupported',reason:'missing-original-wait-successor',segments};
    state.channel=next;state.changed=true;state.successor=null;
    remaining=step.remaining;
    // Installation occurs even with no remaining time, just as the source
    // callback does. The zero-budget step preserves the new tween and records
    // discarded remainder without creating a second four-step allowance.
  }
}
