// Elbera Tools: original sparse keys on the existing browser skeleton.
// This is an inspection adapter, not the native GetFrame hierarchy/modifiers.
import { sampleOriginalTrack } from './nativetrack.js';

// Raw package -> mirrored PSA -> this project's glTF. Both intermediate
// conversions are required: applying assemble.py's PSA conversion directly to
// raw package keys reverses Y and W a second time. See the evidence document.
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
        || bone.parent < 0 || bone.parent > index) throw new Error('Invalid original bone hierarchy.');
    const candidates = bone.parent === index ? roots : matched[bone.parent].children;
    const exact = candidates.filter(node => node.isBone
      && (node.userData?.name ?? node.name).toLowerCase() === bone.name.toLowerCase());
    if (exact.length !== 1 || used.has(exact[0])) {
      throw new Error(`Missing or ambiguous export correspondence: bone ${index} (${bone.name}).`);
    }
    matched.push(exact[0]); used.add(exact[0]);
  }
  return matched;
}

export function createOriginalPosePreview(root, catalog, sequenceName) {
  if (catalog?.format !== 'elbera-original-animation-tracks-v1') {
    throw new Error('Unsupported original-track catalog.');
  }
  const sequences = typeof sequenceName === 'string' && catalog.sequences?.filter(
    row => typeof row.name === 'string' && row.name.toLowerCase() === sequenceName.toLowerCase());
  if (sequences?.length !== 1) throw new Error('Original sequence is missing or ambiguous.');
  const sequence = sequences[0], movement = sequence.movement;
  const bones = matchSourceBones(root, catalog.bones);
  if (movement?.flags !== 0 || movement.startBone !== 0
      || !Array.isArray(movement.tracks) || movement.tracks.length !== bones.length
      || !Array.isArray(movement.boneIndices) || movement.boneIndices.length !== bones.length
      || movement.boneIndices.some((value, index) => value !== index)) {
    throw new Error('Only complete, identity-indexed ordinary source tracks are supported.');
  }
  if (!Number.isFinite(sequence.rate) || sequence.rate <= 0
      || !Number.isInteger(sequence.frames) || sequence.frames <= 0) {
    throw new Error('Missing original sequence frame/rate fields.');
  }
  // The conversion is tied to this project's measured PSA/glTF adapter; it
  // does not assert that native actor coordinates or hierarchy are equivalent.
  function poses(frame) {
    return movement.tracks.map((track, index) => {
      const sample = sampleOriginalTrack(track, movement.duration, frame);
      return { ...sample, ...sourcePoseToExport(sample.position, sample.quaternion,
        catalog.bones[index].parent === index) };
    });
  }
  poses(0); // Reject unsupported tracks before the preview can alter a bone.
  return {
    sequence, boneCount: bones.length, duration: sequence.frames / sequence.rate,
    apply(frame) {
      const samples = poses(frame); // All-or-nothing validation before mutation.
      let rotationDelta = 0, positionDelta = 0, wrapped = 0, flipped = 0;
      samples.forEach((sample, index) => {
        const bone = bones[index], current = bone.quaternion.toArray();
        // q and -q describe the same orientation; compare both representations.
        rotationDelta = Math.max(rotationDelta, Math.min(
          ...[1, -1].map(sign => Math.max(...current.map((value, i) => Math.abs(value - sign * sample.rotation[i]))))));
        positionDelta = Math.max(positionDelta, Math.hypot(...bone.position.toArray().map((value, i) => value - sample.translation[i])));
        bone.quaternion.fromArray(sample.rotation); bone.position.fromArray(sample.translation);
        wrapped += Number(sample.wrapped && sample.first !== sample.second);
        flipped += Number(sample.hemisphereFlipped);
      });
      root.updateMatrixWorld(true);
      return { rotationDelta, positionDelta, wrapped, flipped };
    },
  };
}
