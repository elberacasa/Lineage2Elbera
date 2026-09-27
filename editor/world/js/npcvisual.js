// Original actor/mesh scales, independent of the collision cylinder.
// Engine.dll ordinary skeletal Render -> MeshToWorld(1.0) multiplies each
// axis by Actor.DrawScale, Actor.DrawScale3D and ULodMesh.MeshScale, storing
// float32 after each stage. See docs/native-actor-evidence.md.
const FORMAT = 'l2-interlude-npc-visuals-v1';
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const vector = value => Array.isArray(value) && value.length === 3
  && value.every(v => Number.isFinite(v) && Number.isFinite(Math.fround(v)));

export function npcVisualScale(catalog, npcId, expectedMesh) {
  if (catalog?.format !== FORMAT || catalog.provenance?.edition !== 'Interlude'
      || !digest(catalog.provenance.sourceSHA256)) return null;
  const npc = catalog.npcs?.[String(npcId)];
  if (!npc || typeof npc.mesh !== 'string'
      || npc.mesh.split('.').at(-1).toLowerCase() !== String(expectedMesh).toLowerCase()
      || !Number.isFinite(npc.drawScale) || !Number.isFinite(Math.fround(npc.drawScale))
      || !vector(npc.drawScale3D)) return null;
  const mesh = catalog.meshes?.[npc.mesh.toLowerCase()];
  if (!mesh || !digest(mesh.sourceSHA256) || !digest(mesh.exportSHA256)
      || !Number.isInteger(mesh.lodMeshVersion) || mesh.lodMeshVersion < 2
      || !vector(mesh.meshScale)) return null;
  // The glTF conversion already changes (L2 X,Y,Z) to (X,Z,-Y)*0.01.
  // A scale has no translation or handedness sign, so only Y/Z are swapped.
  const f = Math.fround;
  const axes = npc.drawScale3D.map((v, i) => f(f(f(npc.drawScale) * f(v)) * f(mesh.meshScale[i])));
  if (!axes.every(Number.isFinite)) return null;
  return { x: axes[0], y: axes[2], z: axes[1] };
}

let pending = null;
export function npcVisualMeta() {
  if (!pending) pending = fetch('/gamedata/npcvisual.json', { cache: 'no-cache' })
    .then(response => {
      if (!response.ok) throw new Error(`original NPC visuals: HTTP ${response.status}`);
      return response.json();
    }).catch(error => { pending = null; throw error; });
  return pending;
}
