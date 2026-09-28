// Elbera Tools: finite UPrimitive::LineCheck actor cylinder, original L2 XYZ.
// Retained Engine10645e0f..106465a7 plus qualified supplemental Core calls.
// check_cylinder_collision_native.py compares actual instructions to this module.
// This is a primitive, not actor admission, collision-hash ordering or placement.
const f = Math.fround;
const scope = 'native-actor-cylinder';
const unsupported = reason => ({ status: 'unsupported', scope, reason });
const vector = value => Array.isArray(value) && value.length === 3
  && Array.from(value).every(x => typeof x === 'number' && Number.isFinite(x) && Number.isFinite(f(x)))
  ? value.map(f) : null;
const finite = values => values.every(Number.isFinite);

/** ActorLineCheck10523e88..96 invokes 103048d6→104419f0 with (Time0,Next0).
 * This factory is ONLY that actor-hash scratch constructor. MultiLineCheck's
 * separate 64-slot buffer initializes Material alone. Opaque pointer zero is
 * represented by null; vectors are owned afresh by each result.
 */
export function createActorHashResult() {
  return { next: null, actor: null, point: [0, 0, 0], normal: [0, 0, 0],
    item: 0, time: 0, nodeIndex: -1, material: null };
}

function normal(value, safe) {
  const squared = f((value[0] * value[0] + value[1] * value[1]) + value[2] * value[2]);
  if (!Number.isFinite(squared)) return null;
  // SafeNormal stores sqrt as float before reciprocal; Normalize does not.
  if (safe ? squared <= 1e-8 : squared < 1e-8) return safe ? [0, 0, 0] : [...value];
  const root = safe ? f(Math.sqrt(squared)) : Math.sqrt(squared);
  const scale = f(1 / root), result = value.map(x => f(x * scale));
  return finite([scale, ...result]) ? result : null;
}

/** Explicit initial result is retained wherever the native primitive does not
 * write. In particular, a touching hit may preserve Normal, and a miss may
 * update Normal during cap clipping. Only `hit` authorizes result adoption.
 * Omitted result fields remain unknown/omitted until written, including Normal
 * at an exact touch. `actor:null` follows native's early clear return. Identity/materials
 * are opaque caller-owned references; no skin, center or normal is fabricated.
 * Finite arithmetic approximates x87 intermediates with binary64; explicit
 * Float32 stores and qualified SafeNormal/Normalize differences are retained.
 */
export function traceActorCylinder({ start, end, extent, actor, initialResult } = {}) {
  if (!initialResult || typeof initialResult !== 'object' || Array.isArray(initialResult)
      || (Object.hasOwn(initialResult, 'normal') && !vector(initialResult.normal)))
    return unsupported('invalid-initial-result');
  const result = { ...initialResult, time: 1 };
  if (Object.hasOwn(initialResult, 'normal')) result.normal = vector(initialResult.normal);
  if (Array.isArray(initialResult.point)) result.point = [...initialResult.point];
  const done = hit => ({ status: 'ready', scope, hit, result });
  if (actor === null) return done(false);
  start = vector(start); end = vector(end); extent = vector(extent);
  const center = vector(actor?.location);
  if (!start || !end || !extent || !center || extent.some(x => x < 0)
      || actor.identity === undefined || actor.identity === null
      || !Array.isArray(actor.skins)
      || Array.from(actor.skins).some(x => x === undefined)
      || ![actor.collisionRadius, actor.collisionHeight].every(x => typeof x === 'number'
        && Number.isFinite(x) && x >= 0 && Number.isFinite(f(x))))
    return unsupported('invalid-explicit-cylinder-input');
  const radius = f(f(actor.collisionRadius) + extent[0]);
  const radiusY = f(f(actor.collisionRadius) + extent[1]);
  const height = f(f(actor.collisionHeight) + extent[2]);
  const expanded = [radius, radiusY, height];
  const lower = center.map((x, i) => f(x - expanded[i]));
  const upper = center.map((x, i) => f(x + expanded[i]));
  if (!finite([...expanded, ...lower, ...upper])) return unsupported('nonfinite-cylinder-bounds');
  for (let i = 0; i < 3; i++) {
    if ((start[i] > upper[i] && end[i] > upper[i]) || (start[i] < lower[i] && end[i] < lower[i]))
      return done(false);
  }
  let enter = 0, leave = 1;
  const z = start[2], endZ = end[2], low = lower[2], high = upper[2];
  if (z > high && endZ <= high) {
    const t = f((high - z) / (endZ - z));
    if (t > enter) { enter = Math.max(enter, t); result.normal = [0, 0, 1]; }
  } else if (z < high && endZ > high) leave = Math.min(leave, f((high - z) / (endZ - z)));
  if (z < low && endZ >= low) {
    const t = f((low - z) / (endZ - z));
    if (t > enter) { enter = Math.max(enter, t); result.normal = [0, 0, -1]; }
  } else if (z > low && endZ < low) leave = Math.min(leave, f((low - z) / (endZ - z)));
  if (leave <= enter) return done(false);
  const x = f(start[0] - center[0]), y = f(start[1] - center[1]);
  const dx = f(end[0] - start[0]), dy = f(end[1] - start[1]);
  const a = f(dx * dx + dy * dy), b = f(2 * (x * dx + y * dy));
  const c = f((x * x + y * y) - f(radius * radius));
  const discriminant = f(b * b - (4 * a) * c);
  if (!finite([x, y, dx, dy, a, b, c, discriminant])) return unsupported('nonfinite-cylinder-quadratic');
  if (c <= 0 && low < z && z < high) {
    const inward = f((dx * x + dy * y) + f(f(endZ - z) * 0) * f(z - center[2]));
    if (!Number.isFinite(inward)) return unsupported('nonfinite-inside-approach');
    if (inward >= -0.10000000149011612) return done(false);
    const n = normal([x, y, f(f(z - center[2]) * 0)], true);
    if (!n) return unsupported('nonfinite-inside-normal');
    Object.assign(result, { time: 0, point: [...start], normal: n, actor: actor.identity,
      item: 0, material: actor.skins.length ? actor.skins[0] : null });
    return done(true);
  }
  if (discriminant < 0) return done(false);
  if (a < 9.99999905104687e-9) {
    if (c > 0) return done(false);
  } else {
    const root = f(Math.sqrt(discriminant)), reciprocal = f(0.5 / a);
    leave = Math.min(leave, f((root - b) * reciprocal));
    const t = f(-(root + b) * reciprocal);
    if (!finite([root, reciprocal, leave, t])) return unsupported('nonfinite-cylinder-roots');
    if (t > enter) {
      enter = t;
      const nx = f(f(f(dx * t) + start[0]) - center[0]);
      const ny = f(f(f(dy * t) + start[1]) - center[1]);
      const n = normal([nx, ny, 0], false);
      if (!n) return unsupported('nonfinite-cylinder-normal');
      result.normal = n;
    }
    if (leave <= enter) return done(false);
  }
  const time = f(Math.max(0, Math.min(1, f(enter - 0.0010000000474974513))));
  const delta = [dx, dy, f(endZ - z)];
  const point = start.map((x, i) => f(f(delta[i] * time) + x));
  if (!finite([time, ...point])) return unsupported('nonfinite-cylinder-hit');
  Object.assign(result, { time, point, actor: actor.identity, item: 0 });
  return done(true);
}
