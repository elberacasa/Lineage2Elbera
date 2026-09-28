// Finite original ULevel::MoveActor query padding / selected-hit backoff.
// See docs/native-moveactor-arithmetic-evidence.md. No actor filters, collision
// query, membership updates, callbacks, floor response or physics are run here.
const f = Math.fround;
const owned = new WeakMap();
const scope = "finite-moveactor-arithmetic";
const unsupported = (reason) =>
  Object.freeze({ status: "unsupported", scope, reason });
const vector = (value) =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every(
    (v) => typeof v === "number" && Number.isFinite(v) && Object.is(f(v), v),
  );
const finite = (values) => values.every(Number.isFinite);
const frozen = (values) => Object.freeze(values);

/** Exact finite Float32 start/Delta; excludes the native nearly-zero branch.
 * Supplies MultiLineCheck start/end only. Flags, source/caller identities,
 * extent, actor filters and original linked-list selection remain caller work.
 */
export function prepareMoveActorSweep(input) {
  if (!input || typeof input !== "object")
    return unsupported("source-float32-vectors-required");
  let { start, delta } = input;
  if (!vector(start) || !vector(delta))
    return unsupported("source-float32-vectors-required");
  if (delta.every((v) => Math.abs(v) < 0.0001))
    return unsupported("delta-nearly-zero");
  start = [...start];
  delta = [...delta];
  // Core Size: binary64 squared-sum argument to sqrt, then a Float32 result.
  const length = f(
    Math.sqrt(delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2]),
  );
  if (!Number.isFinite(length) || length <= 0)
    return unsupported("unsupported-derived-length");
  // Original vector division stores the reciprocal before multiplying.
  const reciprocal = f(1 / length);
  const direction = delta.map((v) => f(v * reciprocal));
  const padding = direction.map((v) => f(2 * v));
  const extendedDelta = delta.map((v, i) => f(padding[i] + v));
  const end = start.map((v, i) => f(v + extendedDelta[i]));
  if (
    !finite([reciprocal, ...direction, ...padding, ...extendedDelta, ...end])
  ) {
    return unsupported("nonfinite-derived-query");
  }
  const prepared = Object.freeze({
    status: "ready",
    scope,
    length,
    delta: frozen(delta),
    direction: frozen(direction),
    extendedDelta: frozen(extendedDelta),
    query: Object.freeze({ start: frozen(start), end: frozen(end) }),
  });
  owned.set(prepared, { padding: frozen(padding) });
  return prepared;
}

/** Consume an actual selected hit, or the source Time=1 no-hit record.
 * Only zero arg4 is admitted. Does not initialize or copy a FCheckResult.
 * hitWrites is sparse: this slice writes Time only in its t<1 branch. All
 * other caller result fields must remain exactly as supplied by the query.
 * preCallbackLocation and returnPredicate do not certify later actor effects.
 */
export function finishMoveActorSweep(prepared, selectedHit, options) {
  const state = owned.get(prepared);
  if (!state) return unsupported("owned-preparation-required");
  if (!options || !Number.isInteger(options.arg4) || options.arg4 !== 0) {
    return unsupported("only-explicit-zero-arg4");
  }
  const t = selectedHit?.time;
  if (
    typeof t !== "number" ||
    !Number.isFinite(t) ||
    !Object.is(f(t), t) ||
    t < 0 ||
    t > 1
  ) {
    return unsupported("source-hit-time-required");
  }
  let adjustedDelta = [...prepared.delta],
    time = t;
  const hitWrites = {};
  if (t < 1) {
    // No intermediate Float32 store between 2+length and multiplication.
    const travel = f((2 + prepared.length) * t);
    if (!Number.isFinite(travel))
      return unsupported("nonfinite-derived-travel");
    if (travel <= 2) {
      adjustedDelta = [0, 0, 0];
      time = 0;
    } else {
      adjustedDelta = prepared.extendedDelta.map((v, i) =>
        f(f(v * t) - state.padding[i]),
      );
      // No intermediate Float32 store between subtraction and division.
      time = f((travel - 2) / prepared.length);
    }
    hitWrites.time = time;
  }
  const preCallbackLocation = prepared.query.start.map((v, i) =>
    f(v + adjustedDelta[i]),
  );
  if (!finite([time, ...adjustedDelta, ...preCallbackLocation]))
    return unsupported("nonfinite-derived-result");
  return Object.freeze({
    status: "ready",
    scope,
    adjustedDelta: frozen(adjustedDelta),
    preCallbackLocation: frozen(preCallbackLocation),
    hitWrites: Object.freeze(hitWrites),
    returnPredicate: time > 0,
  });
}
