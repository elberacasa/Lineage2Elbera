// Elbera Tools: original linkup, sparse keys and neutral current hierarchy.
// Source-space arithmetic is separate from this measured glTF display adapter.
import { sampleOriginalTrack } from './nativetrack.js';
import { originalPoseHierarchy } from './nativecoords.js';

// Raw package -> mirrored PSA -> this project's glTF local-pose conversion.
// Kept as an independently measured comparison; hierarchy rendering below uses
// complete source coordinates without quaternion decomposition.
export function sourcePoseToExport(position, quaternion, rootBone) {
  const [x, y, z] = position, [qx, qy, qz, qw] = quaternion;
  const sign = rootBone ? -1 : 1;
  return {
    translation: [x, z, y].map(value => Math.fround(value * 0.01)),
    rotation: [sign * qx, sign * qz, sign * qy, qw],
  };
}

export function matchSourceBones(root, sourceBones) {
  if (!Array.isArray(sourceBones) || !sourceBones.length) {
    throw new Error('Original bone records are missing.');
  }
  const roots = [];
  root.traverse(object => {
    if (object.isBone && !object.parent?.isBone) roots.push(object);
  });
  const matched = [], used = new Set();
  for (let index = 0; index < sourceBones.length; index++) {
    const bone = sourceBones[index];
    if (typeof bone.name !== 'string' || !bone.name || !Number.isInteger(bone.parent)
        || (index === 0 ? bone.parent !== 0 : bone.parent < 0 || bone.parent >= index)) {
      throw new Error('Invalid original bone hierarchy.');
    }
    const candidates = index === 0 ? roots : matched[bone.parent].children;
    const exact = candidates.filter(node => node.isBone
      && (node.userData?.name ?? node.name).toLowerCase() === bone.name.toLowerCase());
    if (exact.length !== 1 || used.has(exact[0])) {
      throw new Error(`Missing or ambiguous export correspondence: bone ${index} (${bone.name}).`);
    }
    matched.push(exact[0]); used.add(exact[0]);
  }
  return matched;
}

function sourceLinkup(catalog, skeleton) {
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (skeleton?.format !== 'elbera-original-player-skeleton-v1'
      || typeof catalog.modelId !== 'string' || skeleton.modelId !== catalog.modelId
      || typeof catalog.animationRef !== 'string'
      || skeleton.animationRef?.toLowerCase() !== catalog.animationRef.toLowerCase()
      || !hash(catalog.source?.packageSHA256) || !hash(catalog.source?.exportSHA256)
      || skeleton.source?.packageSHA256 !== catalog.source.packageSHA256
      || skeleton.source?.animationExportSHA256 !== catalog.source.exportSHA256) {
    throw new Error('Original mesh and animation source identities do not match.');
  }
  if (!Array.isArray(catalog.bones) || !catalog.bones.length
      || !Array.isArray(skeleton.animationBones) || skeleton.animationBones.length !== catalog.bones.length
      || !Array.isArray(skeleton.bones) || !skeleton.bones.length
      || !Array.isArray(skeleton.trackBindings) || skeleton.trackBindings.length !== skeleton.bones.length) {
    throw new Error('Incomplete original mesh/animation binding records.');
  }
  // Source exports currently use ASCII names. Do not silently approximate
  // FName interning for Unicode or case-variant spellings without evidence.
  const spellings = new Map(), first = new Map();
  function name(value) {
    if (typeof value !== 'string' || !/^[\x20-\x7e]+$/.test(value)) throw new Error('Unsupported original bone name.');
    const key = value.toLowerCase();
    if (spellings.has(key) && spellings.get(key) !== value) throw new Error('Ambiguous original name interning.');
    spellings.set(key, value); return key;
  }
  catalog.bones.forEach((bone, index) => {
    const saved = skeleton.animationBones[index];
    if (saved?.name !== bone.name || saved?.parent !== bone.parent) throw new Error('Original animation bone records differ.');
    const key = name(bone.name);
    if (!first.has(key)) first.set(key, index); // Native ascending first match.
  });
  return skeleton.bones.map((bone, index) => {
    const binding = first.get(name(bone.name)) ?? -1;
    if (skeleton.trackBindings[index] !== binding) throw new Error('Original first-name track binding differs.');
    return binding;
  });
}

// Source FCoords -> measured glTF geometry basis B*C*B^-1. This is a display
// adapter, not native actor placement. Matrix records preserve scale/shear.
function displayMatrix(record, template) {
  const order = [0, 2, 1], rows = [];
  for (const row of order) {
    rows.push(...order.map(column => record[3 + row * 3 + column]), record[row] * 0.01);
  }
  return template.clone().set(...rows, 0, 0, 0, 1);
}

export function createOriginalPosePreview(root, catalog, sequenceName, skeleton) {
  if (catalog?.format !== 'elbera-original-animation-tracks-v1') {
    throw new Error('Unsupported original-track catalog.');
  }
  const bindings = sourceLinkup(catalog, skeleton);
  const sequences = typeof sequenceName === 'string' && catalog.sequences?.filter(
    row => typeof row.name === 'string' && row.name.toLowerCase() === sequenceName.toLowerCase());
  if (sequences?.length !== 1) throw new Error('Original sequence is missing or ambiguous.');
  const sequence = sequences[0], movement = sequence.movement;
  const bones = matchSourceBones(root, skeleton.bones), parents = skeleton.bones.map(bone => bone.parent);
  if (movement?.flags !== 0 || movement.startBone !== 0
      || !Array.isArray(movement.tracks) || movement.tracks.length !== catalog.bones.length) {
    throw new Error('Only complete ordinary source tracks are supported.');
  }
  // Native GetFrame indexes tracks through mesh linkup, not the serialized
  // movement BoneIndices list. Empty lists and source-order swaps are admitted.
  if (!Number.isFinite(sequence.rate) || sequence.rate <= 0
      || !Number.isInteger(sequence.frames) || sequence.frames <= 0) {
    throw new Error('Missing original sequence frame/rate fields.');
  }
  const referencePoses = skeleton.bones.map(bone => ({position:bone.position, quaternion:bone.orientation}));
  originalPoseHierarchy(referencePoses, parents, {mode:'reference'}); // Validate all original reference records.
  function poses(frame) {
    if (!Number.isFinite(frame) || frame < 0 || frame > 1 || Object.is(frame,-0)) throw new Error('Invalid source frame.');
    const samples = bindings.map((binding, index) => binding < 0 ? {...referencePoses[index], reference:true}
      : sampleOriginalTrack(movement.tracks[binding], movement.duration, frame));
    const coordinates = originalPoseHierarchy(samples, parents, {mode:'current'});
    const absolute = coordinates.map(record => displayMatrix(record, bones[0].matrix));
    const local = absolute.map((matrix, index) => {
      if (!index) return matrix.clone();
      const parent = absolute[parents[index]];
      if (!Number.isFinite(parent.determinant()) || parent.determinant() === 0) throw new Error('Singular source parent cannot be displayed.');
      return parent.clone().invert().multiply(matrix);
    });
    if (local.some(matrix => matrix.elements.some(value => !Number.isFinite(value)))) {
      throw new Error('Nonfinite source display matrix.');
    }
    return {samples, coordinates, absolute, local};
  }
  poses(0); // Complete validation before the preview can alter a bone.
  let saved = null;
  function restore() {
    if (!saved) return;
    bones.forEach((bone, index) => {
      bone.matrix.copy(saved[index].matrix); bone.matrixAutoUpdate = saved[index].auto;
    });
    saved = null; root.updateMatrixWorld(true);
  }
  return {
    sequence, boneCount:bones.length, mappedCount:bindings.filter(index=>index>=0).length,
    referenceCount:bindings.filter(index=>index<0).length, duration:sequence.frames / sequence.rate,
    restore,
    apply(frame) {
      const result = poses(frame); // All-or-nothing validation before mutation.
      restore(); root.updateMatrixWorld(true);
      const outerInverse = bones[0].parent.matrixWorld.clone();
      if (!Number.isFinite(outerInverse.determinant()) || outerInverse.determinant() === 0) throw new Error('Singular display parent.');
      outerInverse.invert();
      let basisDelta = 0, positionDelta = 0, wrapped = 0, flipped = 0;
      saved = bones.map(bone=>({matrix:bone.matrix.clone(),auto:bone.matrixAutoUpdate}));
      result.samples.forEach((sample, index) => {
        const bone = bones[index], current = outerInverse.clone().multiply(bone.matrixWorld).elements;
        const target = result.absolute[index].elements;
        for (const i of [0,1,2,4,5,6,8,9,10]) basisDelta = Math.max(basisDelta,Math.abs(current[i]-target[i]));
        positionDelta = Math.max(positionDelta,Math.hypot(...[12,13,14].map(i=>current[i]-target[i])));
        bone.matrix.copy(result.local[index]); bone.matrixAutoUpdate = false;
        wrapped += Number(!!sample.wrapped && sample.first !== sample.second);
        flipped += Number(!!sample.hemisphereFlipped);
      });
      root.updateMatrixWorld(true);
      return {basisDelta, positionDelta, wrapped, flipped, coordinates:result.coordinates};
    },
  };
}
