// Elbera Tools: retained Core.appRand integer stream. The original state is
// selected through a CRT state-record accessor; one browser context is an adaptation.
// No seed is inferred from an animation, actor ID, reconnect or clock delta.
const uint32 = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

export function createNativeRandom(seed) {
  if (!uint32(seed)) throw new TypeError('An explicit unsigned 32-bit random seed is required.');
  let state = seed >>> 0, draws = 0;
  return Object.freeze({
    get state() { return state; },
    get draws() { return draws; },
    nextInt() {
      state = (Math.imul(state, 214013) + 2531011) >>> 0;
      draws++;
      return (state >>> 16) & 32767;
    },
  });
}

// Native ordinary Init uses RDTSC low32. A browser cannot read that instruction;
// cryptographic browser entropy is an explicit platform seed adapter, not a
// recovered native seed or a promise of identical cross-client event history.
export function createBrowserRandom(crypto = globalThis.crypto) {
  if (typeof crypto?.getRandomValues !== 'function') return null;
  const seed = new Uint32Array(1);
  crypto.getRandomValues(seed);
  return createNativeRandom(seed[0]);
}
