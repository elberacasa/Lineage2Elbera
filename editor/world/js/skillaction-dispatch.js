// Elbera Tools: pure original Agent action dispatch, without scene mutation.
// Evidence: docs/native-pawn-notify-evidence.md. This models Notify arguments
// and source order only, not returned actor classification, lifetime or geometry.
const FORMAT = 'l2-skill-action-records-v1';
const int32 = value => Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
const uint32 = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const own = (value, key) => Object.hasOwn(value, key);

function invalid(reason) {
  return { status: 'unsupported', reason, actions: [], calls: [] };
}

function validAction(action, index) {
  if (!action || typeof action !== 'object' || Array.isArray(action)
      || action.sourceIndex !== index || !int32(action.actionRef)
      || !int32(action.stage) || typeof action.stageSerialized !== 'boolean'
      || (!action.stageSerialized && action.stage !== 0)
      || (own(action, 'g') && !uint32(action.g))
      || (own(action, 'f') && !uint32(action.f))) return false;
  if (action.actionStatus === 'source-null')
    return action.actionRef === 0 && action.actionPath === null && !own(action, 'f');
  if (action.actionStatus === 'resolved-locate-effect')
    return action.actionRef > 0 && typeof action.actionPath === 'string' && action.actionPath.length > 0;
  return action.actionStatus === 'unsupported-action-reference' && action.actionRef !== 0
    && (action.actionPath === null || typeof action.actionPath === 'string');
}

/** Plan original c/h/p/s action callbacks using opaque actor references.
 *  Null mainTarget means absent; duplicate/null associated entries are retained.
 *  stageShot is already incremented by Finalize; pending must be explicitly 1/2.
 *  Every source action remains in diagnostics. Resolved actions without an f
 *  renderer index still have symbolic calls. Selected unsupported references
 *  produce an explicit plan status; callers must not claim complete dispatch.
 *  Source arrays must be explicit, including [] for proven empty defaults.
 */
export function selectSkillActions(input) {
  if (!input || typeof input !== 'object') return invalid('missing-input');
  const { entry, phase, caster, mainTarget, associatedActors, stageShot, pending } = input;
  if (entry?.actionFormat !== FORMAT) return invalid('unverified-action-format');
  if (!['c', 'h', 'p', 's'].includes(phase)) return invalid('unproven-phase');
  const source = entry[phase];
  if (!Array.isArray(source)) return invalid('missing-source-array');
  // Validate the entire source array before returning any dispatchable calls.
  for (let i = 0; i < source.length; i++)
    if (!validAction(source[i], i)) return invalid('invalid-source-action');
  if (phase !== 'p' && (caster === undefined || caster === null || mainTarget === undefined))
    return invalid('missing-actor-input');
  if (phase === 's' && (!int32(stageShot) || stageShot < 1 || ![1, 2].includes(pending)))
    return invalid('invalid-shot-state');
  if (phase === 's' && (!Array.isArray(associatedActors)
      || Array.from(associatedActors).some(actor => actor === undefined)))
    return invalid('missing-associated-actors');

  const actions = [], calls = [];
  let unsupported = false;
  for (const action of source) {
    const diagnostic = { sourceIndex: action.sourceIndex, action, selected: false, reason: null, callCount: 0 };
    actions.push(diagnostic);
    if (phase === 'p') { diagnostic.reason = 'native-preshot-no-op'; continue; }
    // TriggerShot rejects the null Action before consulting SpecificStage
    // (original RVA 0x1ed469/0x1ed46b, then 0x1ed471).
    if (action.actionStatus === 'source-null') { diagnostic.reason = 'source-null'; continue; }
    if (phase === 's' && action.stage !== stageShot && !(action.stage === 0 && pending === 2)) {
      diagnostic.reason = 'stage-mismatch'; continue;
    }
    diagnostic.selected = true;
    if (action.actionStatus === 'unsupported-action-reference') {
      diagnostic.reason = 'unsupported-action-reference'; unsupported = true; continue;
    }
    const append = (target, targetSource, associatedIndex = null) => {
      calls.push({ sourceIndex: action.sourceIndex, action, caster, target, targetSource, associatedIndex });
      diagnostic.callCount++;
    };
    if (phase !== 's') append(mainTarget, 'main');
    else if (((action.g ?? 0) & 2) && associatedActors.length) {
      associatedActors.forEach((actor, index) => append(actor, 'associated', index));
    } else if (mainTarget !== null) append(mainTarget, 'main');
    else associatedActors.forEach((actor, index) => append(actor, 'associated', index));
    if (!diagnostic.callCount) diagnostic.reason = 'no-target';
  }
  return { status: phase === 'p' ? 'native-no-op' : unsupported ? 'unsupported-action-reference' : 'ready',
           reason: null, phase, actions, calls };
}
