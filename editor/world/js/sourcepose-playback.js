// Elbera Tools: source-local pose ownership for the live browser character.
// This owns display matrices and evaluated locals, never animation clocks or
// exported TRS. Root lock, extra channels and modifiers remain admission gaps.
import { createOriginalPoseRig } from './sourcepose.js';
import { tweenOriginalLocalPose } from './nativetween.js';

export function createOriginalPosePlayback(root, {catalog, skeleton}) {
  const rig = createOriginalPoseRig(root, catalog, skeleton), sequences = new Map();
  let selected = null;
  let cached = null;
  let marker = null, cachedStatus = null;
  // This source evaluator begins as a fresh ordinary native mesh instance.
  // Once evaluated, an exported/unsupported gap loses channel-history proof;
  // merely sampling a later positive pose cannot recover that bookkeeping.
  let history = 'fresh';
  // A newly added original channel is AddZeroed(0x70). Ordinary samples do
  // not change these fields. They belong to the channel, not the sequence.
  let channel = { previousFrame:0, previousSequenceId:0, accumulated:0 };
  let status = {status:'idle'};
  return {
    get status() { return {...status}; },
    restore:rig.restore,
    stop({preserveCache=false}={}) {
      rig.restore(); selected=null;
      if (!preserveCache) {
        cached=null; marker=null; cachedStatus=null;
        if (history !== 'fresh') history='unknown';
      }
      status={status:'idle'};
    },
    select(plan) {
      rig.restore(); selected=null;
      try {
        if (typeof plan?.seq !== 'string') throw new Error('missing-original-sequence-identity');
        const key=plan.seq.toLowerCase();
        let source=sequences.get(key);
        if (!source) { source=rig.sequence(plan.seq,{prepared:true}); sequences.set(key,source); }
        if (source.sequence.frames !== plan.frames || source.sequence.rate !== plan.sourceRate) {
          throw new Error('original-sequence-clock-mismatch');
        }
        selected=source;
        status={status:'ready',sequence:source.sequence.name,mode:'ordinary-source-keys'};
      } catch (error) {
        cached=null; marker=null; cachedStatus=null; history='unknown';
        status={status:'unsupported',reason:error.message};
      }
      return this.status;
    },
    apply(frame, {epoch}={}) {
      rig.restore();
      if (!selected) return this.status;
      try {
        if (!Number.isSafeInteger(epoch) || epoch < 0) throw new Error('explicit-source-pose-evaluation-epoch-required');
        if (typeof frame !== 'number' || !Number.isFinite(frame)) throw new Error('finite-source-frame-required');
        frame=Math.fround(frame);
        // Native ordinary GetFrame keys reuse by GTicks + channel-zero frame,
        // not sequence. Our caller supplies a browser update epoch; it is an
        // explicit scheduling adaptation, not a claim to reconstruct GTicks.
        if (cached && marker?.epoch === epoch && marker.frame === frame) {
          rig.display(cached);
          status={...cachedStatus,reused:true,requestedSequence:selected.sequence.name};
          return this.status;
        }
        let samples, nextChannel=channel, fraction=null, mode='ordinary-source-keys';
        if (frame < 0) {
          if (history === 'unknown') throw new Error('native-transition-needs-known-channel-history');
          if (history === 'fresh') {
            // The normal default-template allocation zeroes +1fc. Native
            // invalid-cache sampling uses ordinary frame zero, not raw first
            // keys, and bypasses tween bookkeeping and normalization.
            samples=selected.sample(0); mode='native-frame-zero';
          } else {
            if (!cached) throw new Error('native-transition-needs-evaluated-source-cache');
            if (!rig.mappedCount) throw new Error('native-transition-needs-mapped-source-bone');
            samples=selected.firstPose().map((firstKey,index)=> {
              if (firstKey.reference) return firstKey; // native negative link skips tween
              const result=tweenOriginalLocalPose({cacheValid:true,frame,
                frames:selected.sequence.frames,sequenceId:selected.sequence.name.toLowerCase(),
                ...channel,cached:cached[index],firstKey,
                floatingPointEnvironment:'win32-default'});
              if (result.status !== 'ready') throw new Error(result.reason);
              nextChannel=result.state; fraction=result.fraction;
              return {quaternion:result.quaternion,position:result.position};
            });
            mode='native-cached-tween';
          }
        } else samples=selected.sample(frame);
        rig.display(samples);
        // Commit once after the entire pose is admitted and displayed. Each
        // mapped bone above consumed the same incoming bookkeeping snapshot.
        cached=samples; channel=nextChannel; marker={epoch,frame};
        if (history === 'fresh') history='known';
        status={status:'ready',sequence:selected.sequence.name,frame,
          mode,fraction,mapped:rig.mappedCount,reference:rig.referenceCount,reused:false,history};
        cachedStatus=status;
      } catch (error) {
        rig.restore(); cached=null; marker=null; cachedStatus=null; history='unknown';
        status={status:'unsupported',sequence:selected.sequence.name,frame,reason:error.message};
      }
      return this.status;
    },
  };
}
