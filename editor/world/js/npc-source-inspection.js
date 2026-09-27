// Elbera Tools: manual original NPC pose inspection, independent of game state.
// Time means a chosen point in frames/rate, not a native endpoint, clock, tween,
// stance or notify schedule. Source weight inputs and full skinning are separate.
import { createOriginalPoseRig } from './sourcepose.js';

const SCOPE = 'manual-original-source-inspection';
const same = (a,b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const hashes = ['meshPackageSHA256','animationPackageSHA256','meshExportSHA256','animationExportSHA256'];

export function createNpcSourceInspection(scene, {catalog,skeleton,record,skinReceipt}={}) {
  if (skeleton?.format !== 'elbera-original-npc-skeleton-v1'
      || record?.modelId !== catalog?.modelId
      || !same(record?.model?.meshRef,skeleton.meshRef)
      || !same(record?.model?.animationRef,skeleton.animationRef)
      || !hashes.every(key => record?.model?.source?.[key] === skeleton.source?.[key])
      || record?.model?.built?.skinProof?.status !== 'unverified') {
    throw new Error('Original NPC inspection source/index identities do not match.');
  }
  const rig = createOriginalPoseRig(scene,catalog,skeleton);
  if (!Array.isArray(catalog.sequences)) throw new Error('Original NPC sequences are missing.');
  const names = new Set();
  const sequences = Object.freeze(catalog.sequences.map(row => {
    if (typeof row.name !== 'string' || !row.name || names.has(row.name.toLowerCase())
        || !Number.isSafeInteger(row.frames) || row.frames <= 0
        || !Number.isFinite(row.rate) || row.rate <= 0) {
      throw new Error('Original NPC sequence timing is missing or ambiguous.');
    }
    names.add(row.name.toLowerCase());
    return Object.freeze({name:row.name,frames:row.frames,rate:row.rate,duration:row.frames/row.rate});
  }));
  let selected=null, disposed=false;
  const common = {scope:SCOPE,skinWeights:skinReceipt?.status ?? 'unverified',modelId:catalog.modelId,
    meshRef:skeleton.meshRef,animationRef:skeleton.animationRef};
  let state={...common,status:'idle'};
  const describe = () => selected ? {sequence:selected.sequence.name,frames:selected.sequence.frames,
    rate:selected.sequence.rate,duration:selected.duration} : {};
  const result = () => ({...state});
  function fail(error) {
    rig.restore();
    state={...common,...describe(),status:disposed?'disposed':'unsupported',reason:error.message};
    return result();
  }
  function apply(frame) {
    if (disposed) return fail(new Error('Original NPC inspection is disposed.'));
    try {
      if (!selected) throw new Error('Select an explicit original sequence first.');
      if (typeof frame !== 'number' || !Number.isFinite(frame) || frame<0 || frame>1 || Object.is(frame,-0)) {
        throw new Error('Source inspection frame must be between zero and one.');
      }
      frame=Math.fround(frame);
      rig.restore();
      const measured=rig.display(selected.sample(frame));
      state={...common,...describe(),status:'ready',frame,time:frame*selected.duration,
        mapped:rig.mappedCount,reference:rig.referenceCount,
        basisDelta:measured.basisDelta,positionDelta:measured.positionDelta};
      return result();
    } catch(error) { return fail(error); }
  }
  return {
    sequences,
    get status() { return result(); },
    select(name) {
      rig.restore();selected=null;
      if (disposed) return fail(new Error('Original NPC inspection is disposed.'));
      try {
        selected=rig.sequence(name,{prepared:true});
        state={...common,...describe(),status:'selected'};
        return result();
      } catch(error) { return fail(error); }
    },
    applyFrame:apply,
    applyTime(seconds) {
      if (disposed) return fail(new Error('Original NPC inspection is disposed.'));
      if (!selected) return fail(new Error('Select an explicit original sequence first.'));
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds<0
          || seconds>selected.duration || Object.is(seconds,-0)) {
        return fail(new Error('Source inspection time is outside the frames/rate interval.'));
      }
      return apply(seconds/selected.duration);
    },
    restore() {
      rig.restore();state={...common,...describe(),status:disposed?'disposed':'restored'};
      return result();
    },
    dispose() {
      rig.restore();selected=null;disposed=true;state={...common,status:'disposed'};
      return result();
    },
  };
}
