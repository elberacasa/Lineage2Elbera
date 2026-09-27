// Elbera Tools' authored transport, not an original game format. Header:
// ELBA + u32LE version(1), JSON byte length, Float32 payload byte length.
// Zero-pad JSON to 4 bytes; descriptors {offset,count,width} address payload
// rows. Complete original metadata survives; no keys, flags or sequences drop.

const MODEL = /^[a-z][a-z0-9_]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const fields = [['quaternions', 4], ['positions', 3], ['times', 1]];
const requests = new Map();

function need(condition, label) {
  if (!condition) throw new Error(`Invalid original animation bundle: ${label}.`);
}
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function uint(value) { return Number.isInteger(value) && value >= 0 && value <= 0xffffffff; }
function signedWord(value) { return Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff; }
function exactFloat(value) { return typeof value === 'number' && Number.isFinite(value) && Math.fround(value) === value; }
function finiteMetadata(value) {
  if (typeof value === 'number') need(Number.isFinite(value), 'nonfinite metadata');
  else if (value && typeof value === 'object') Object.values(value).forEach(finiteMetadata);
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  // Do not evaluate lazy array getters while freezing the metadata tree.
  for (const field of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in field) freeze(field.value);
  }
  return Object.freeze(value);
}
function referenceVector(value, width) {
  need(Array.isArray(value) && value.length === width
    && value.every(exactFloat), 'reference pose');
}
function sourcePair(catalog, skeleton) {
  need(record(catalog) && record(skeleton)
    && catalog.format === 'elbera-original-animation-tracks-v1'
    && skeleton.format === 'elbera-original-player-skeleton-v1', 'source formats');
  need(typeof catalog.modelId === 'string' && MODEL.test(catalog.modelId)
    && skeleton.modelId === catalog.modelId, 'model identity');
  need(typeof catalog.animationRef === 'string' && catalog.animationRef.length > 0
    && typeof skeleton.animationRef === 'string'
    && skeleton.animationRef.toLowerCase() === catalog.animationRef.toLowerCase(), 'animation identity');
  for (const [key, other] of [['packageSHA256', 'packageSHA256'], ['exportSHA256', 'animationExportSHA256']]) {
    need(typeof catalog.source?.[key] === 'string' && HASH.test(catalog.source[key])
      && catalog.source[key] === skeleton.source?.[other], 'source fingerprint');
  }
  const bones = catalog.bones, mesh = skeleton.bones, saved = skeleton.animationBones;
  need(Array.isArray(bones) && bones.length > 0 && Array.isArray(mesh) && mesh.length > 0
    && Array.isArray(saved) && saved.length === bones.length
    && Array.isArray(skeleton.trackBindings) && skeleton.trackBindings.length === mesh.length, 'source bones');
  const spellings = new Map(), first = new Map();
  function name(bone) {
    need(record(bone) && typeof bone.name === 'string' && /^[\x20-\x7e]+$/.test(bone.name), 'bone name');
    const key = bone.name.toLowerCase();
    need(!spellings.has(key) || spellings.get(key) === bone.name, 'ambiguous name interning');
    spellings.set(key, bone.name); return key;
  }
  bones.forEach((bone, index) => {
    const key = name(bone);
    need(Number.isInteger(bone.parent) && bone.parent >= 0 && bone.parent < bones.length, 'animation parent');
    // Current source records are name/flags/parent. Preserve all records and
    // compare every field, without treating object key order as identity.
    need(record(saved[index]) && Object.keys(bone).length === Object.keys(saved[index]).length
      && Object.entries(bone).every(([k, v]) => saved[index][k] === v), 'animation bone records');
    if (!first.has(key)) first.set(key, index);
  });
  mesh.forEach((bone, index) => {
    const key = name(bone), parent = bone.parent;
    need(Number.isInteger(parent) && (index === 0 ? parent === 0 : parent >= 0 && parent < index), 'mesh parent');
    referenceVector(bone.orientation, 4); referenceVector(bone.position, 3);
    need(skeleton.trackBindings[index] === (first.get(key) ?? -1), 'first-name bindings');
  });
  need(Array.isArray(catalog.sequences), 'sequences');
}

/** Validate the complete container before exposing any lazy, immutable data. */
export function decodeOriginalAnimationBundle(buffer) {
  need(buffer instanceof ArrayBuffer && buffer.byteLength >= 16, 'header');
  // Own the bytes: later caller mutation/transfer cannot corrupt cached data.
  const bytes = new Uint8Array(buffer.slice(0)), view = new DataView(bytes.buffer);
  need(bytes[0] === 69 && bytes[1] === 76 && bytes[2] === 66 && bytes[3] === 65
    && view.getUint32(4, true) === 1, 'magic/version');
  const jsonLength = view.getUint32(8, true), payloadLength = view.getUint32(12, true);
  const payloadStart = 16 + Math.ceil(jsonLength / 4) * 4;
  need(jsonLength > 0 && payloadLength % 4 === 0
    && payloadStart + payloadLength === bytes.length, 'declared lengths');
  for (let i = 16 + jsonLength; i < payloadStart; i++) need(bytes[i] === 0, 'JSON padding');
  let metadata;
  try { metadata = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes.subarray(16, 16 + jsonLength))); }
  catch { throw new Error('Invalid original animation bundle: UTF-8 JSON.'); }
  need(record(metadata) && metadata.format === 'elbera-original-animation-runtime-v1', 'transport format');
  finiteMetadata(metadata);
  const {catalog, skeleton} = metadata;
  sourcePair(catalog, skeleton);
  let cursor = 0;
  const arrays = [];
  function track(row, allowEmpty = false) {
    need(record(row) && signedWord(row.flags), 'track record');
    const counts = [];
    for (const [key, width] of fields) {
      const descriptor = row[key];
      need(record(descriptor) && Object.keys(descriptor).length === 3
        && uint(descriptor.offset) && uint(descriptor.count) && descriptor.width === width
        && descriptor.offset === cursor, 'array descriptor/order');
      const size = descriptor.count * width * 4;
      need(size <= payloadLength - cursor, 'array bounds');
      counts.push(descriptor.count);
      arrays.push({row, key, width, offset:cursor, count:descriptor.count});
      cursor += size;
    }
    const [q, p, t] = counts;
    need((t > 0 || allowEmpty) && (q === 1 || q === t) && (p === 1 || p === t), 'track cardinality');
    let previous = -Infinity;
    for (let i = 0; i < t; i++) {
      const value = view.getFloat32(payloadStart + row.times.offset + i * 4, true);
      need(Number.isFinite(value), 'nonfinite payload');
      need(value >= 0 && value >= previous, 'key-time order');
      previous = value;
    }
  }
  const names = new Set();
  for (const sequence of catalog.sequences) {
    const movement = sequence?.movement;
    need(record(sequence) && record(movement) && Array.isArray(movement.tracks)
      && movement.tracks.length === catalog.bones.length, 'movement tracks');
    need(typeof sequence.name === 'string' && sequence.name.length > 0
      && !names.has(sequence.name.toLowerCase()), 'sequence name');
    names.add(sequence.name.toLowerCase());
    need(signedWord(sequence.frames) && sequence.frames > 0 && exactFloat(sequence.rate)
      && sequence.rate > 0, 'sequence frames/rate');
    need(signedWord(movement.flags) && signedWord(movement.startBone)
      && exactFloat(movement.duration) && movement.duration > 0, 'movement fields');
    need(Array.isArray(movement.boneIndices) && movement.boneIndices.every(signedWord), 'movement index words');
    referenceVector(movement.rootSpeed, 3);
    movement.tracks.forEach(row => track(row)); track(movement.rootTrack, true);
  }
  need(cursor === payloadLength, 'unreferenced payload bytes');
  for (let offset = payloadStart; offset < bytes.length; offset += 4) {
    need(Number.isFinite(view.getFloat32(offset, true)), 'nonfinite payload');
  }
  for (const {row, key, width, offset, count} of arrays) {
    let cached;
    Object.defineProperty(row, key, {enumerable:true, configurable:false, get() {
      if (!cached) {
        const values = new Array(count);
        for (let i = 0; i < count; i++) {
          const start = payloadStart + offset + i * width * 4;
          values[i] = width === 1 ? view.getFloat32(start, true)
            : Object.freeze(Array.from({length:width}, (_, j) => view.getFloat32(start + j * 4, true)));
        }
        cached = Object.freeze(values);
      }
      return cached;
    }});
  }
  return freeze({catalog, skeleton});
}

/** Source-only shared cache; consumers guard their own actor/session lifetime. */
export function fetchOriginalAnimationBundle(modelId) {
  if (typeof modelId !== 'string' || !MODEL.test(modelId)) {
    return Promise.reject(new Error('Invalid original animation model identity.'));
  }
  if (requests.has(modelId)) return requests.get(modelId);
  const request = (async () => {
    const response = await fetch(`/gamedata/animation-tracks/runtime/${encodeURIComponent(modelId)}.l2anim`, {cache:'no-cache'});
    if (!response.ok) throw new Error(`Original animation bundle HTTP ${response.status}.`);
    const data = decodeOriginalAnimationBundle(await response.arrayBuffer());
    need(data.catalog.modelId === modelId, 'requested model identity');
    return data;
  })();
  requests.set(modelId, request);
  request.catch(() => { if (requests.get(modelId) === request) requests.delete(modelId); });
  return request;
}
