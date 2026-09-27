// Elbera Tools: restore verified stored GPU influence lanes after GLTFLoader's
// normalization. This is input fidelity, not native shader/CPU/IBM equivalence.
import { BufferAttribute } from '../vendor/three.module.min.js';

const owners = new WeakMap();
const need = (value, reason) => { if (!value) throw new Error(`Original NPC skin: ${reason}.`); };
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const equal = (a,b) => Array.isArray(a) && Array.isArray(b)
  && a.length === b.length && a.every((v,i)=>v === b[i]);
const sourceFields = ['meshPackageSHA256','animationPackageSHA256','meshExportSHA256','animationExportSHA256'];

export function disposeNpcSourceSkin(gltf) {
  const owned = owners.get(gltf);
  if (!owned) return;
  owners.delete(gltf);
  for (const {mesh,previous,geometry} of owned) {
    if (mesh.geometry === geometry) mesh.geometry = previous;
    geometry.dispose();
  }
}

// Caller has already verified the model, buffer and bundle bytes. Recheck their
// joins here before using parser associations to bind the actor's actual skin.
export function applyNpcSourceSkin(gltf, document, originalSource, record) {
  const {skeleton} = originalSource, built = record?.model?.built;
  const input = skeleton?.sourceSkin, marker = built?.skinProof?.runtimeInputs;
  if (input === undefined && marker === undefined) return null;
  need(input?.format === 'elbera-original-npc-skin-inputs-v1'
    && input.stream === 'stored-gpu-soft52' && marker === input.stream, 'input format/record agreement');
  need(!owners.has(gltf), 'skin inputs already installed');
  need(skeleton.format === 'elbera-original-npc-skeleton-v1'
    && skeleton.modelId === record.modelId
    && sourceFields.every(key=>hash(skeleton.source?.[key]) && skeleton.source[key] === record.model.source?.[key]), 'source identity');
  need(hash(input.sourceLOD0SHA256) && input.sourceLOD0SHA256 === built.sourceLOD0SHA256
    && hash(input.builtGLTFSHA256) && input.builtGLTFSHA256 === built.gltfSHA256, 'source/model fingerprints');
  need(Array.isArray(input.builtBuffers) && input.builtBuffers.length === built.buffers?.length
    && input.builtBuffers.every((row,i)=>hash(row.SHA256) && row.SHA256 === built.buffers[i].SHA256
      && row.uri === built.buffers[i].uri && row.byteLength === built.buffers[i].byteLength)
    && document.buffers?.length === built.buffers.length
    && document.buffers.every((row,i)=>row.uri === built.buffers[i].uri && row.byteLength === built.buffers[i].byteLength), 'buffer identities');
  need(Number.isInteger(input.meshIndex) && input.meshIndex >= 0 && input.meshIndex === built.meshIndex
    && Number.isInteger(input.skinIndex) && input.skinIndex >= 0 && input.skinIndex === built.skinIndex
    && equal(input.boneNodes,built.boneNodes), 'mesh/skin source binding');
  const primitives = document.meshes?.[input.meshIndex]?.primitives;
  const joints = document.skins?.[input.skinIndex]?.joints;
  need(Array.isArray(joints) && joints.length > 0 && joints.length <= 65536
    && joints.length === skeleton.bones?.length && joints.length === input.boneNodes.length
    && new Set(joints).size === joints.length && new Set(input.boneNodes).size === joints.length
    && joints.every(node=>Number.isInteger(node) && node >= 0 && document.nodes?.[node] && input.boneNodes.includes(node)), 'joint node identities');
  const sourceToJoint = input.boneNodes.map(node=>joints.indexOf(node));
  const targetNodes = document.nodes.flatMap((node,i)=>node.mesh === input.meshIndex && node.skin === input.skinIndex ? [i] : []);
  need(targetNodes.length === 1, 'ambiguous mesh instance');
  need(Array.isArray(primitives) && primitives.length > 0 && Array.isArray(input.primitives)
    && input.primitives.length === primitives.length && typeof input.scope === 'string' && input.scope.length > 0, 'primitive coverage/scope');
  const associations = gltf?.parser?.associations, meshes = [];
  need(associations instanceof Map && typeof gltf?.scene?.traverse === 'function', 'GLTFLoader associations');
  gltf.scene.traverse(object=>{ if (object.isSkinnedMesh) meshes.push(object); });
  need(meshes.length === primitives.length, 'parsed primitive coverage');
  const plans = [], seen = new Set();
  for (const mesh of meshes) {
    const binding = associations.get(mesh), pi = binding?.primitives;
    need(binding?.meshes === input.meshIndex && Number.isInteger(pi) && pi >= 0
      && pi < primitives.length && !seen.has(pi), 'parsed mesh/primitive identity');
    seen.add(pi);
    let node = mesh;
    while (node && associations.get(node)?.nodes === undefined) node = node.parent;
    need(associations.get(node)?.nodes === targetNodes[0], 'parsed mesh node identity');
    need(mesh.skeleton?.bones.length === joints.length && mesh.skeleton.bones.every((bone,i)=>
      bone.isBone && associations.get(bone)?.nodes === joints[i]), 'parsed skeleton joint order');
    const primitive = primitives[pi], attributes = primitive.attributes;
    need(attributes && (primitive.mode === undefined || primitive.mode === 4)
      && !primitive.targets && !Object.keys(attributes).some(key=>/^(JOINTS|WEIGHTS)_[1-9][0-9]*$/.test(key)), 'four-lane triangle primitive required');
    const rows = input.primitives[pi];
    need(rows?.primitiveIndex === pi && Array.isArray(rows.bones) && Array.isArray(rows.weights), 'source primitive identity');
    const count = rows.weights.length, geometry = mesh.geometry;
    need(count > 0 && rows.bones.length === count && geometry?.isBufferGeometry
      && Object.keys(geometry.morphAttributes).length === 0, 'vertex rows/geometry');
    for (const [semantic,name,width,type] of [
      ['POSITION','position',3,'VEC3'],['TEXCOORD_0','uv',2,'VEC2'],
      ['JOINTS_0','skinIndex',4,'VEC4'],['WEIGHTS_0','skinWeight',4,'VEC4'],
    ]) {
      const accessor = document.accessors?.[attributes[semantic]], attr = geometry.attributes[name];
      need(accessor?.count === count && accessor.type === type && attr?.count === count
        && attr.itemSize === width, `attribute cardinality ${semantic}`);
    }
    const weights = new Float32Array(count*4), indices = new Uint16Array(count*4);
    for (let v=0;v<count;v++) {
      need(Array.isArray(rows.bones[v]) && rows.bones[v].length === 4
        && Array.isArray(rows.weights[v]) && rows.weights[v].length === 4, 'four source lanes');
      for (let lane=0;lane<4;lane++) {
        const bone = rows.bones[v][lane], weight = rows.weights[v][lane];
        need(typeof weight === 'number' && Number.isFinite(weight) && weight >= 0
          && Object.is(Math.fround(weight),weight), 'exact finite Float32 weight');
        need(Number.isInteger(bone) && (bone === -1 ? weight === 0 : bone >= 0 && bone < joints.length), 'source bone ordinal/sentinel');
        const offset = v*4+lane;
        weights[offset] = weight;
        indices[offset] = bone === -1 ? 0 : sourceToJoint[bone];
      }
    }
    plans.push({mesh,previous:geometry,weights,indices});
  }
  // Stage all clones first: a later invalid row/allocation cannot leave a
  // partially changed actor. Never dispose the parser's shared geometry.
  const prepared = [];
  try {
    for (const plan of plans) {
      const geometry = plan.previous.clone();
      prepared.push({...plan,geometry});
      geometry.setAttribute('skinWeight',new BufferAttribute(plan.weights,4,false));
      geometry.setAttribute('skinIndex',new BufferAttribute(plan.indices,4,false));
    }
  } catch (error) { for (const {geometry} of prepared) geometry.dispose(); throw error; }
  for (const {mesh,geometry} of prepared) mesh.geometry = geometry;
  owners.set(gltf,prepared);
  return Object.freeze({status:'stored-gpu-inputs',vertices:plans.reduce((n,p)=>n+p.weights.length/4,0),
    primitives:plans.length,scope:input.scope});
}
