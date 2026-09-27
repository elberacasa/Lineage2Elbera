// Elbera Tools: ordinary Interlude quaternion helper, owned body 0x106ae090.
// docs/native-quaternion-evidence.md separates retained instructions from the
// matching comparison copy's math imports. This is not the initial-tween helper.
// Number/Math approximate native x87/CRT; explicit Float32 stores are retained.

const COPY_ABOVE = 0.9999998807907104;
const LINEAR_ABOVE = Math.fround(0.55);
const MIN_SQUARE = Math.fround(0.00001);
const FALLBACK_Z = Math.fround(0.1);

function finite32(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)
      || !Number.isFinite(Math.fround(value))) {
    throw new RangeError('A finite Float32 component is required.');
  }
  return Math.fround(value);
}

function quaternion(value) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== 4) {
    throw new TypeError('Four quaternion components are required.');
  }
  return Array.from(value, finite32);
}

export function originalQuaternionDetails(first, second, alpha) {
  const a = quaternion(first), b = quaternion(second), t = finite32(alpha), f = finite32;
  const dot = f(((a[0] * b[0] + a[1] * b[1]) + a[2] * b[2]) + a[3] * b[3]);
  if (dot > COPY_ABOVE) return { value: a, branch: 'copy', dot };

  let wa, wb, branch;
  if (dot > LINEAR_ABOVE) {
    wa = f(1 - t); wb = t; branch = 'linear';
  } else {
    // The source helper does not clamp or select a hemisphere. Its caller's
    // sign policy is separate; invalid trig domains stay unsupported here.
    const theta = f(Math.acos(dot)), inverseSin = f(1 / Math.sin(theta));
    wa = f(Math.sin((1 - t) * theta) * inverseSin);
    wb = f(Math.sin(theta * t) * inverseSin);
    branch = 'trigonometric';
  }
  const value = a.map((component, i) => f(wa * component + wb * b[i]));
  const square = f(((value[1] * value[1] + value[0] * value[0])
    + value[2] * value[2]) + value[3] * value[3]);
  if (square < MIN_SQUARE) {
    return { value: [0, 0, FALLBACK_Z, 0], branch: branch + '-tiny-fallback', dot };
  }
  const factor = f(1 / f(Math.sqrt(square)));
  return { value: value.map(component => f(component * factor)), branch, dot };
}

export function interpolateOriginalQuaternion(first, second, alpha) {
  return originalQuaternionDetails(first, second, alpha).value;
}
