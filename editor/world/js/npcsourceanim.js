// Elbera Tools: original NPC source poses and verified browser mesh admission.
// The index is generated from private originals; it is not a native format.
// This module establishes asset identity, not NPC state/rate/modifier parity.
import { decodeOriginalAnimationBundle } from './sourceanim-data.js';

const FORMAT = 'elbera-original-npc-animation-runtime-index-v1';
const BASE = '/characters/monsters/';
const MODEL = /^npc_[a-f0-9]{32}$/;
const REF = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (a,b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const sourceFields = ['meshPackageSHA256','animationPackageSHA256','meshExportSHA256','animationExportSHA256'];
const need = (value, reason) => { if (!value) throw new Error(`Original NPC source admission: ${reason}.`); };

export function originalNpcSourceRecord(index, npcId, entry) {
  if (index === null) return null; // No generated source index on this installation.
  need(index?.format === FORMAT && index.edition === 'Interlude' && index.npcs && index.models, 'index format');
  need(Number.isInteger(npcId) && npcId > 0, 'NPC identity');
  const npc = index.npcs[String(npcId)];
  if (!npc) return null; // Explicitly outside this source collection.
  const model = index.models[npc.modelId];
  need(MODEL.test(npc.modelId) && model && REF.test(npc.className)
    && REF.test(npc.meshRef) && REF.test(npc.animationRef)
    && same(npc.meshRef,model.meshRef) && same(npc.animationRef,model.animationRef), 'qualified source identities');
  need(Array.isArray(npc.inheritance) && same(npc.inheritance[0],npc.className)
    && npc.inheritance.every(value => REF.test(value)) && npc.selectors, 'class selector provenance');
  need(sourceFields.every(key => hash(model.source?.[key])), 'source fingerprints');
  need(model.bundle === `animation-tracks/runtime/${npc.modelId}.l2anim` && hash(model.bundleSHA256), 'bundle location/fingerprint');
  const built = model.built;
  need(built && same(built.modelId,entry?.id) && built.gltf === entry.gltf
    && /^models\/[A-Za-z0-9_-]+\.gltf$/.test(built.gltf) && hash(built.gltfSHA256), 'browser model binding');
  need(Array.isArray(built.buffers) && built.buffers.length > 0
    && built.buffers.every(row => /^[A-Za-z0-9_-]+\.bin$/.test(row.uri)
      && hash(row.SHA256) && Number.isSafeInteger(row.byteLength) && row.byteLength > 0)
    && new Set(built.buffers.map(row=>row.uri)).size === built.buffers.length, 'browser buffer bindings');
  need(built.geometryProof?.status === 'triangle-position-uv-winding-exact'
    && built.skinProof?.status === 'unverified', 'geometry proof or explicit skinning limit');
  need(Number.isInteger(built.meshIndex) && built.meshIndex >= 0
    && Number.isInteger(built.skinIndex) && built.skinIndex >= 0
    && Array.isArray(built.boneNodes) && built.boneNodes.length > 0
    && built.boneNodes.every(value => Number.isInteger(value) && value >= 0)
    && new Set(built.boneNodes).size === built.boneNodes.length, 'browser skeleton binding');
  return { npcId, npc, model, modelId:npc.modelId };
}

async function digest(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
    .map(value=>value.toString(16).padStart(2,'0')).join('');
}
async function bytes(url, fetcher) {
  const response = await fetcher(url,{cache:'no-cache'});
  need(response.ok, `resource HTTP ${response.status}: ${url}`);
  return response.arrayBuffer();
}

const resources = new Map();
export async function verifiedNpcSourceModel(record, loader, fetcher=fetch) {
  const {model,modelId} = record, built = model.built;
  // Expected provenance is part of cache identity, including the built mesh.
  // Immutable source data is shared; each parse below creates an actor's scene.
  const key = JSON.stringify({modelId,model});
  let pending = resources.get(key);
  if (!pending) {
    pending = (async()=>{
      const directory = built.gltf.slice(0,built.gltf.lastIndexOf('/')+1);
      const [jsonBytes,bundleBytes,...buffers] = await Promise.all([
        bytes(BASE+built.gltf,fetcher),bytes('/gamedata/'+model.bundle,fetcher),
        ...built.buffers.map(row=>bytes(BASE+directory+row.uri,fetcher)),
      ]);
      need(await digest(jsonBytes) === built.gltfSHA256 && await digest(bundleBytes) === model.bundleSHA256,
        'model/bundle SHA-256 mismatch');
      for (let i=0;i<buffers.length;i++) need(buffers[i].byteLength === built.buffers[i].byteLength
        && await digest(buffers[i]) === built.buffers[i].SHA256,'buffer size/SHA-256 mismatch');
      const document = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(jsonBytes));
      need(document.buffers?.length === buffers.length && document.buffers.every((row,i)=>
        row.uri === built.buffers[i].uri && row.byteLength === buffers[i].byteLength),'glTF buffer references');
      need(document.meshes?.[built.meshIndex] && document.skins?.[built.skinIndex]
        && document.nodes?.some(node=>node.mesh === built.meshIndex && node.skin === built.skinIndex), 'glTF mesh/skin binding');
      const joints = document.skins[built.skinIndex].joints;
      need(joints?.length === built.boneNodes.length && new Set(joints).size === joints.length
        && joints.every(value=>built.boneNodes.includes(value)),'glTF bone identities');
      const source = decodeOriginalAnimationBundle(bundleBytes);
      need(source.skeleton.format === 'elbera-original-npc-skeleton-v1'
        && source.catalog.modelId === modelId
        && same(source.catalog.meshRef,model.meshRef) && same(source.catalog.animationRef,model.animationRef)
        && sourceFields.every(name=>source.skeleton.source[name] === model.source[name])
        && source.skeleton.bones.length === joints.length,'bundle/index source identities');
      return {document,buffers,directory,source};
    })().catch(error=>{ resources.delete(key); throw error; });
    resources.set(key,pending);
  }
  const {document,buffers,directory,source} = await pending;
  const urls = buffers.map(buffer=>URL.createObjectURL(new Blob([buffer])));
  try {
    // Consume the exact verified bytes; do not ask GLTFLoader to refetch a
    // mutable model/buffer after validating a different response.
    const parsed = {...document,buffers:document.buffers.map((row,i)=>({...row,uri:urls[i]}))};
    const gltf = await loader.parseAsync(JSON.stringify(parsed),BASE+directory);
    return {gltf,overrides:{},originalSource:{...source,record}};
  } finally { urls.forEach(url=>URL.revokeObjectURL(url)); }
}

let indexPending;
export async function fetchNpcSourceIndex() {
  if (!indexPending) indexPending = fetch('/gamedata/npc-animation-runtime.json',{cache:'no-cache'})
    .then(response=>{
      if (response.status === 404) return null;
      need(response.ok,`index HTTP ${response.status}`);
      return response.json();
    }).catch(error=>{indexPending=null;throw error;});
  return indexPending;
}

export async function loadNpcSourceAnimationModel(npcId, entry, loader) {
  const record = originalNpcSourceRecord(await fetchNpcSourceIndex(),npcId,entry);
  return record ? verifiedNpcSourceModel(record,loader) : null;
}
