// Elbera Tools: bounded ordinary channel-zero, negative-frame GetFrame tween.
// This uses the separate helper at 0x106afd00, NOT ordinary-track interpolation.
// See docs/native-pose-tween-evidence.md for the supplemental named-call boundary.
// Number/Math approximate x87/CRT; only the explicit source stores are Float32.

function f32(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)
      || !Number.isFinite(Math.fround(value))) throw new RangeError('finite Float32 required');
  return Math.fround(value);
}

function vector(value, length) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== length) {
    throw new TypeError(`${length} source components required`);
  }
  return Array.from(value, f32);
}

function pose(value) {
  if (!value || typeof value !== 'object') throw new TypeError('source local pose required');
  return { quaternion: vector(value.quaternion, 4), position: vector(value.position, 3) };
}

function identity(value) {
  // Caller-supplied tokens must already express original FName equality. This
  // function does not create aliases, lowercase strings or choose a sequence.
  if ((Number.isInteger(value) && value >= 0 && value <= 0xffffffff)
      || (typeof value === 'string' && value.length > 0)) return value;
  throw new TypeError('explicit sequence identity required');
}

function hemisphere(target, cached) {
  const difference = target.map((v, i) => f32(v - cached[i]));
  const sum = target.map((v, i) => f32(v + cached[i]));
  const norm = v => f32(((f32(v[1] * v[1]) + f32(v[0] * v[0]))
    + f32(v[2] * v[2])) + f32(v[3] * v[3]));
  const flipped = norm(sum) < norm(difference);
  return { value: flipped ? target.map(v => -v) : target, flipped };
}

function normalizedTween(cached, target, fraction) {
  const dot = f32(((cached[0] * target[0] + cached[1] * target[1])
    + cached[2] * target[2]) + cached[3] * target[3]);
  let value, branch;
  if (dot >= 1) {
    value = cached.slice(); branch = 'copy';
  } else {
    const angle = f32(Math.acos(dot)), reciprocal = f32(1 / Math.sin(angle));
    const a = f32(Math.sin((1 - fraction) * angle) * reciprocal);
    const b = f32(Math.sin(angle * fraction) * reciprocal);
    value = cached.map((v, i) => f32(v * a + target[i] * b));
    branch = 'trigonometric';
  }
  // The caller always invokes Core FQuat::Normalize, including a copied
  // quaternion and fraction zero. The tiny-result tuple is not identity.
  const square = f32(((value[1] * value[1] + value[0] * value[0])
    + value[2] * value[2]) + value[3] * value[3]);
  if (square < Math.fround(1e-5)) {
    return { value: [0, 0, Math.fround(0.1), 0], branch: `${branch}-tiny-fallback` };
  }
  const factor = f32(1 / f32(Math.sqrt(square)));
  return { value: value.map(v => f32(v * factor)), branch };
}

/**
 * Evaluate one mapped bone from explicit source-local cache and first keys.
 * All bones in a channel use the SAME incoming bookkeeping snapshot; commit
 * returned state once after the whole pose. Cache ownership/validity, missing
 * bone reference fallback and subsequent modifiers belong to the caller.
 * Unknown inputs produce unsupported without mutating or inventing a pose.
 */
export function tweenOriginalLocalPose(input) {
  try {
    if (!input || typeof input !== 'object') throw new TypeError('tween input required');
    const frame = f32(input.frame);
    if (!(frame < 0)) throw new RangeError('negative normalized frame required');
    if (!Number.isInteger(input.frames) || input.frames <= 0 || input.frames > 0x7fffffff) {
      throw new RangeError('positive source NumFrames required');
    }
    if (typeof input.cacheValid !== 'boolean') throw new TypeError('explicit cache validity required');
    const sequenceId = identity(input.sequenceId), previousSequenceId = identity(input.previousSequenceId);
    const previousFrame = f32(input.previousFrame), accumulated = f32(input.accumulated);
    if (!input.cacheValid) {
      // Native skips tween bookkeeping and samples the new sequence at frame
      // zero. Tiny source key intervals can select a successor even at zero;
      // require the ordinary sampler result separately from the raw first key.
      const first = pose(input.frameZeroPose);
      return { status: 'ready', mode: 'frame-zero', ...first, fraction: null,
        hemisphereFlipped: false, quaternionBranch: null,
        state: { previousFrame, previousSequenceId, accumulated } };
    }
    const first = pose(input.firstKey), cached = pose(input.cached);
    // The normal Win32/CRT environment masks floating-point exceptions. Keep
    // that source/platform contract explicit for callers: the library also
    // serves evidence tests with an unknown or externally changed control word.
    const masked = input.floatingPointEnvironment === 'win32-default';
    if (previousFrame === 0 && !masked) throw new RangeError('zero previous frame requires explicit masked exception policy');
    const rawIncrement = 1 - frame / previousFrame;
    const increment = masked ? Math.fround(rawIncrement) : f32(rawIncrement);
    if (Number.isNaN(increment)) throw new RangeError('invalid tween fraction');
    const reset = previousSequenceId !== sequenceId || increment < 0 || increment > 1;
    const fraction = reset ? 0 : increment;
    const state = reset
      ? { previousFrame: f32(-1 / input.frames), previousSequenceId: sequenceId, accumulated: 0 }
      : { previousFrame: frame, previousSequenceId,
          accumulated: f32((1 - accumulated) * fraction + accumulated) };
    const adjusted = hemisphere(first.quaternion, cached.quaternion);
    const blended = normalizedTween(cached.quaternion, adjusted.value, fraction);
    return { status: 'ready', mode: 'tween', quaternion: blended.value,
      position: cached.position.map((v, i) => f32(v + f32(f32(first.position[i] - v) * fraction))),
      fraction, hemisphereFlipped: adjusted.flipped, quaternionBranch: blended.branch, state };
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return { status: 'unsupported', reason: error.message };
    }
    throw error;
  }
}
