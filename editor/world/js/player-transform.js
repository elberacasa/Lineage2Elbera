// Elbera Tools: original ordinary per-axis player visual scale.
// Native actor/mesh products are proved in docs/native-actor-evidence.md.
// Trusted build admission uses model identity + actual loader path; offline
// export_player_visuals.py --check binds the record to current glTF/buffer hashes.
// This does not change native MeshOrigin, centering, grounding or skeleton poses.
// Axis order describes scale components only, not a position-conversion basis.
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const scalar = value => typeof value === 'number' && Number.isFinite(value) && Number.isFinite(Math.fround(value));
const vector = value => Array.isArray(value) && value.length === 3 && value.every(scalar);

export function playerVisualScale(record, { modelId, gltf } = {}) {
  if (record?.format !== 'l2-interlude-player-visual-v1' || record.status !== 'source-verified'
      || typeof modelId !== 'string' || !modelId || record.modelId !== modelId
      || typeof gltf !== 'string' || !gltf || record.built?.gltf !== gltf
      || !digest(record.sourceSHA256) || !digest(record.nativeProofSHA256)
      || !digest(record.built.gltfSHA256)
      || record.browserAxisOrder !== 'native-x-z-y'
      || record.scaleApplication !== 'unbaked-source-scale'
      || !scalar(record.drawScale) || !vector(record.drawScale3D) || !vector(record.meshScale)) return null;
  const f = Math.fround;
  const axes = record.drawScale3D.map((v, i) => f(f(f(f(record.drawScale) * f(v)) * f(record.meshScale[i])) * 1));
  if (!axes.every(Number.isFinite)) return null;
  return { x: axes[0], y: axes[2], z: axes[1] };
}
