// Bounded original-class animation corrections. Original names come from
// npcgrp -> qualified UClass ancestry -> localized .int array elements.
// See tools/anim/build_npc_variants.py and docs/npc-animation-variants.md.
const FORMAT = 'l2-interlude-npc-animations-v1';
const BASE = '/characters/monsters/';
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (a, b) => typeof a === 'string' && typeof b === 'string'
  && a.toLowerCase() === b.toLowerCase();

export function originalNpcAnimationRecord(catalog, npcId, entry) {
  if (catalog?.format !== FORMAT || catalog.edition !== 'Interlude'
      || !digest(catalog.sourceSHA256) || !catalog.npcs || !catalog.models) {
    throw new Error('invalid original NPC animation catalog');
  }
  const npc = catalog.npcs?.[String(npcId)];
  if (!npc) return null; // Explicitly outside this bounded correction catalog.
  const model = catalog.models?.[String(entry.id).toLowerCase()];
  if (!same(npc.meshId, entry.id) || !same(npc.meshName?.split('.').at(-1), entry.id)
      || !model || model.gltf !== entry.gltf
      || !/^models\/[a-zA-Z0-9_]+\.gltf$/.test(model.gltf)
      || !/^models\/[a-zA-Z0-9_]+\.bin$/.test(model.buffer)
      || !['gltfSHA256', 'bufferSHA256', 'meshPackageSHA256',
        'animationPackageSHA256', 'pskSHA256', 'psaSHA256'].every(key => digest(model[key]))
      || model.boneMapping !== 'complete-positional-PSA-PSK-agreement'
      || !Array.isArray(npc.inheritance) || !same(npc.inheritance[0], npc.className)) {
    throw new Error(`original NPC ${npcId} animation model/provenance mismatch`);
  }
  const overrides = {};
  for (const [slot, source] of Object.entries(npc.overrides || {})) {
    const property = { idle: 'WaitAnimName', social: 'NpcSocialAnimName' }[slot];
    const field = npc.fields?.[property]?.['0'];
    if (!property || source.property !== property || source.index !== 0
        || !field || field.value !== source.value || field.declaredBy !== source.declaredBy
        || !npc.inheritance.includes(source.declaredBy)
        || !same(source.value, source.sequence) || source.clip !== `native:${source.sequence}`
        || model.clips?.[source.clip] !== source.sequence) {
      throw new Error(`original NPC ${npcId} ${slot} animation is not source-bound`);
    }
    overrides[slot] = source.clip;
  }
  if (!Object.keys(overrides).length) throw new Error(`original NPC ${npcId} has no animation overrides`);
  return { model, overrides };
}

async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
}

async function responseBytes(url, fetcher) {
  const response = await fetcher(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`original NPC animation resource ${url}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

// Fetch once per model/hash, while parsing a fresh scene per entity. The loader
// consumes THESE verified bytes (including its geometry buffer), not another
// network request which could race an asset rebuild.
const resources = new Map();
export async function verifiedNpcAnimationModel(record, loader, fetcher = fetch) {
  const { model, overrides } = record;
  const key = JSON.stringify(model); // Include expected provenance, not hashes alone.
  let pending = resources.get(key);
  if (!pending) {
    pending = (async () => {
      const [jsonBytes, binary] = await Promise.all([
        responseBytes(BASE + model.gltf, fetcher), responseBytes(BASE + model.buffer, fetcher),
      ]);
      if (await sha256(jsonBytes) !== model.gltfSHA256
          || await sha256(binary) !== model.bufferSHA256) {
        throw new Error('original NPC animation model SHA-256 mismatch');
      }
      const json = JSON.parse(new TextDecoder().decode(jsonBytes));
      const directory = model.gltf.slice(0, model.gltf.lastIndexOf('/') + 1);
      if (json.buffers?.length !== 1 || directory + json.buffers[0].uri !== model.buffer
          || json.buffers[0].byteLength !== binary.byteLength) {
        throw new Error('original NPC animation buffer reference mismatch');
      }
      const native = json.extras?.originalNpcAnimations;
      if (native?.psaSHA256 !== model.psaSHA256 || native?.pskSHA256 !== model.pskSHA256
          || native?.meshPackageSHA256 !== model.meshPackageSHA256
          || native?.animationPackageSHA256 !== model.animationPackageSHA256
          || native?.boneMapping !== model.boneMapping) {
        throw new Error('original NPC animation export provenance mismatch');
      }
      for (const [clip, sequence] of Object.entries(model.clips || {})) {
        if (native.clips?.[clip] !== sequence || json.animations?.filter(a => a.name === clip).length !== 1) {
          throw new Error(`original NPC animation clip missing or ambiguous: ${clip}`);
        }
      }
      return { json, binary, directory };
    })().catch(error => { resources.delete(key); throw error; });
    resources.set(key, pending);
  }
  const { json, binary, directory } = await pending;
  const bufferURL = URL.createObjectURL(new Blob([binary]));
  try {
    const document = { ...json, buffers: [{ ...json.buffers[0], uri: bufferURL }] };
    const gltf = await loader.parseAsync(JSON.stringify(document), BASE + directory);
    for (const clip of Object.values(overrides)) {
      if (gltf.animations.filter(a => a.name === clip).length !== 1) {
        throw new Error(`original NPC animation loader did not preserve ${clip}`);
      }
    }
    return { gltf, overrides };
  } finally {
    URL.revokeObjectURL(bufferURL);
  }
}

let catalogPending;
async function catalog() {
  if (!catalogPending) catalogPending = fetch('/gamedata/npcanimations.json', { cache: 'no-cache' })
    .then(response => {
      if (!response.ok) throw new Error(`original NPC animations: HTTP ${response.status}`);
      return response.json();
    }).catch(error => { catalogPending = null; throw error; });
  return catalogPending;
}

export async function loadNpcAnimationModel(npcId, entry, loader) {
  const record = originalNpcAnimationRecord(await catalog(), npcId, entry);
  if (record) return verifiedNpcAnimationModel(record, loader);
  return { gltf: await loader.loadAsync(BASE + entry.gltf), overrides: {} };
}
