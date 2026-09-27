// Elbera Tools: ordinary source poses in the live browser character.
// This owns display matrices, not animation clocks. Negative-frame tweening,
// root lock, extra channels and modifiers remain explicit admission gaps.
import { createOriginalPoseRig } from './sourcepose.js';

export function createOriginalPosePlayback(root, {catalog, skeleton}) {
  const rig = createOriginalPoseRig(root, catalog, skeleton), sequences = new Map();
  let selected = null;
  let status = {status:'idle'};
  return {
    get status() { return {...status}; },
    restore:rig.restore,
    stop() { rig.restore(); selected=null; status={status:'idle'}; },
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
      } catch (error) { status={status:'unsupported',reason:error.message}; }
      return this.status;
    },
    apply(frame) {
      rig.restore();
      if (!selected) return this.status;
      try {
        if (frame < 0) throw new Error('native-transition-cache-not-yet-admitted');
        rig.display(selected.sample(frame));
        status={status:'ready',sequence:selected.sequence.name,frame,
          mode:'ordinary-source-keys',mapped:rig.mappedCount,reference:rig.referenceCount};
      } catch (error) {
        rig.restore(); status={status:'unsupported',sequence:selected.sequence.name,reason:error.message};
      }
      return this.status;
    },
  };
}
