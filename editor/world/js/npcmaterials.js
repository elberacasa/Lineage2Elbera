// Original NPC texture slots and the audited ghost Shader's blend state.
// Unsupported material graphs remain explicit, including the gold pig TexEnvMap.
const FORMAT = 'l2-interlude-npc-materials-v1';
const STATUS = 'diffuse-slot-and-brighten-verified';
const ANGEL_STATUS = 'wing-alpha-and-blend-verified-partial';
const BASE = '/characters/monsters/';
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (a, b) => typeof a === 'string' && typeof b === 'string'
  && a.toLowerCase() === b.toLowerCase();

export function originalNpcMaterialRecord(catalog, npcId, entry) {
  const proof = catalog?.proof;
  if (catalog?.format !== FORMAT || catalog.edition !== 'Interlude'
      || proof?.format !== 'l2-interlude-npc-material-proof-v1'
      || proof.edition !== 'Interlude' || !digest(proof.shaderScriptSHA256)
      || !Number.isInteger(proof.instructionChecks) || proof.instructionChecks < 51
      || !digest(catalog.npcgrpSHA256) || !digest(proof.engineSHA256) || !digest(proof.d3dSHA256)
      || proof.binding !== 'npc-primary-texture-index-to-actor-skins') {
    throw new Error('invalid original NPC material catalog');
  }
  const npc = catalog.npcs?.[String(npcId)];
  if (!npc) return null;
  if (npc.status === 'unresolved' && npc.unresolved?.length) return { unresolved: npc.unresolved };
  const model = catalog.models?.[String(entry.id).toLowerCase()];
  const state = proof.brighten;
  const angel = npc.status === ANGEL_STATUS;
  if ((!angel && npc.status !== STATUS) || npc.unresolved?.length || !same(npc.meshId, entry.id)
      || !same(model?.meshName, npc.meshName) || model?.gltf !== entry.gltf
      || !/^models\/[a-zA-Z0-9_]+\.gltf$/.test(model.gltf)
      || !/^models\/[a-zA-Z0-9_]+\.bin$/.test(model.buffer)
      || !['gltfSHA256', 'bufferSHA256', 'sourcePackageSHA256', 'sourceExportSHA256', 'pskSHA256']
        .every(key => digest(model[key]))
      || model.geometryProof !== 'original-PSK-conversion-byte-prefix-and-mesh-skin-node-equality'
      || state?.outputBlending !== 5 || state.srcBlend !== 2 || state.dstBlend !== 4
      || state.depthWrite !== false || state.twoSidedCullMode !== 1 || state.fogOverrideARGB !== 0
      || !Array.isArray(npc.materials) || !npc.materials.length
      || npc.materials.length !== npc.originalTextures?.length
      || npc.materials.length !== model.textureSlots?.length
      || npc.materials.length !== model.materialTextureIndices?.length
      || !model.materialTextureIndices?.every((value, index) => value === index)) {
    throw new Error(`original NPC ${npcId} material binding/provenance mismatch`);
  }
  let images, alphaRef;
  if (angel) {
    const correction = npc.corrections?.[0];
    const final = catalog.materials?.[correction?.material];
    const shader = catalog.materials?.[correction?.shader];
    const diffuse = catalog.materials?.[correction?.diffuse];
    const p = final?.properties, sp = shader?.properties, native = proof.finalBlendAlpha;
    if (!same(npc.meshName, 'LineageMonsters.angel_m00') || npc.materials.length !== 2
        || npc.corrections?.length !== 1 || correction.kind !== 'finalblend-alpha' || correction.textureIndex !== 1
        || correction.material !== npc.materials[1] || final?.class !== 'FinalBlend' || !digest(final.exportSHA256)
        || !same(`${final.package}.${final.object}`, npc.originalTextures[1])
        || Object.keys(p || {}).sort().join() !== 'AlphaRef,AlphaTest,FrameBufferBlending,Material,TreatAsTwoSided,TwoSided'
        || p.FrameBufferBlending?.raw !== '02' || p.AlphaTest !== true || p.TwoSided !== true
        || p.TreatAsTwoSided !== true || p.AlphaRef?.raw !== 'a0' || correction.alphaRef !== 160
        || p.Material?.reference !== correction.shader || shader?.class !== 'Shader' || !digest(shader.exportSHA256)
        || Object.keys(sp || {}).sort().join() !== 'Diffuse,Opacity,Specular,SpecularityMask'
        || sp.Diffuse?.reference !== correction.diffuse || sp.Opacity?.reference !== correction.diffuse
        || diffuse?.class !== 'Texture' || !digest(diffuse.exportSHA256)
        || !digest(diffuse.image?.sha256) || !digest(diffuse.image?.rgbaSHA256)
        || !/^\/characters\/monsters\/models\/npc-materials\/[a-f0-9]{64}\.png$/.test(diffuse.image.url)
        || proof.instructionChecks < 86 || native?.frameBufferBlending !== 2 || native.srcBlend !== 5 || native.dstBlend !== 6
        || native.alphaCompare !== 5 || native.depthWrite !== true || native.depthTest !== true
        || native.twoSidedCullMode !== 1 || !digest(native.scriptSHA256) || !digest(native.packageSHA256)
        || native.classDefaults?.defaultsBoundary !== 'unique-validated-candidate'
        || !digest(native.classDefaults.defaultsSHA256) || !Array.isArray(npc.limitations) || !npc.limitations.length) {
      throw new Error(`original NPC ${npcId} Angel alpha state is not source-bound`);
    }
    images = [null, diffuse.image];
    alphaRef = correction.alphaRef;
  } else images = npc.materials.map((key, index) => {
    const shader = catalog.materials?.[key];
    const props = shader?.properties;
    const diffuse = catalog.materials?.[props?.Diffuse?.reference];
    if (shader?.class !== 'Shader' || !props || !digest(shader.exportSHA256)
        || !same(`${shader.package}.${shader.object}`, npc.originalTextures[index])
        || Object.keys(props).some(name => !['Diffuse', 'SpecularityMask', 'OutputBlending', 'TwoSided'].includes(name))
        || props.OutputBlending?.raw !== '05' || props.TwoSided !== true
        || props.SpecularityMask?.reference !== props.Diffuse?.reference
        || diffuse?.class !== 'Texture' || !digest(diffuse.exportSHA256)
        || !digest(diffuse.image?.sha256) || !digest(diffuse.image?.rgbaSHA256)
        || !/^\/characters\/monsters\/models\/npc-materials\/[a-f0-9]{64}\.png$/.test(diffuse.image.url)) {
      throw new Error(`original NPC ${npcId} material slot ${index} is not source-bound`);
    }
    return diffuse.image;
  });
  if (!Array.isArray(model.bindings) || !model.bindings.length
      || model.bindings.some(binding => ![binding.meshIndex, binding.primitiveIndex,
        binding.materialIndex, binding.textureIndex, binding.sourceSection].every(value => Number.isInteger(value) && value >= 0)
        || binding.textureIndex < 0 || binding.textureIndex >= images.length
        || model.materialTextureIndices[binding.sourceSection] !== binding.textureIndex)) {
    throw new Error('invalid original material primitive bindings');
  }
  return { model, images, state, kind: angel ? 'finalblend-alpha' : 'brighten', alphaRef,
    status: npc.status, limitations: npc.limitations || [] };
}

export function configureAngelWingMaterial(material, originalMap, image, alphaRef, THREE) {
  if (!originalMap || material.alphaTest !== 0 || material.opacity !== 1 || alphaRef !== 160) {
    throw new Error('unverified Angel wing alpha input');
  }
  const texture = originalMap.clone();
  texture.source = new THREE.Source(image);
  texture.needsUpdate = true;
  material.map = texture;
  material.alphaTest = alphaRef / 255;
  material.transparent = true;
  material.premultipliedAlpha = false;
  material.blending = THREE.CustomBlending;
  material.blendEquation = material.blendEquationAlpha = THREE.AddEquation;
  material.blendSrc = material.blendSrcAlpha = THREE.SrcAlphaFactor;
  material.blendDst = material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  material.depthWrite = material.depthTest = true;
  material.side = THREE.DoubleSide;
  material.forceSinglePass = true;
  const before = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    before.call(this, shader, renderer);
    const tag = '#include <alphatest_fragment>';
    const chunk = THREE.ShaderChunk.alphatest_fragment;
    // Native D3DCMP_GREATER rejects equality. Three's ordinary alphaTest uses
    // LESS for discard and would incorrectly keep exactly AlphaRef/255.
    if (!shader.fragmentShader.includes(tag) || !chunk.includes('diffuseColor.a < alphaTest')) {
      throw new Error('unrecognized Angel alpha shader');
    }
    shader.fragmentShader = shader.fragmentShader.replace(tag,
      chunk.replace('diffuseColor.a < alphaTest', 'diffuseColor.a <= alphaTest'));
  };
  material.customProgramCacheKey = () => cacheKey + ':original-angel-greater-alpha-v1';
  material.needsUpdate = true;
  return material;
}

export function configureBrightenMaterial(material, originalMap, image, THREE) {
  if (!originalMap || material.alphaTest !== 0 || material.opacity !== 1) {
    throw new Error('unverified base opacity/alpha-test material');
  }
  const texture = originalMap.clone();
  // Texture.clone shares Source. Detach it before replacement so this NPC
  // cannot repaint another entity that still uses the mesh's original map.
  texture.source = new THREE.Source(image);
  texture.needsUpdate = true;
  material.map = texture;
  material.transparent = true;
  material.premultipliedAlpha = false;
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneMinusSrcColorFactor;
  material.blendEquationAlpha = THREE.AddEquation;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  // Original D3DCULL_NONE draws each triangle once. Three's default two-pass
  // transparent DoubleSide rendering would brighten the surface twice.
  material.forceSinglePass = true;
  const before = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    before.call(this, shader, renderer);
    const original = '#include <fog_fragment>';
    if (!shader.fragmentShader.includes(original)) throw new Error('unrecognized ghost fog shader');
    shader.fragmentShader = shader.fragmentShader.replace(original,
      THREE.ShaderChunk.fog_fragment.replace(/\bfogColor\b/g, 'vec3(0.0)'));
  };
  material.customProgramCacheKey = () => cacheKey + ':original-brighten-black-fog-v1';
  material.needsUpdate = true;
  return material;
}

async function hash(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
}
async function bytes(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`original NPC material resource: HTTP ${response.status}`);
  return response.arrayBuffer();
}

export async function verifyLoadedMaterialModel(gltf, model, sourceBytes) {
  if (await hash(sourceBytes) !== model.gltfSHA256) throw new Error('original material model SHA-256 mismatch');
  const expected = JSON.parse(new TextDecoder().decode(sourceBytes));
  const actual = gltf.parser.json;
  // GLTFLoader._markDefs annotates its parsed source in place. Derive only
  // those exact annotations from the verified skin/node references; do not
  // strip arbitrary fields or accept a marker on an unrelated node/mesh.
  for (const skin of expected.skins || []) {
    for (const joint of skin.joints) expected.nodes[joint].isBone = true;
  }
  for (const node of expected.nodes || []) {
    if (node.mesh !== undefined && node.skin !== undefined) expected.meshes[node.mesh].isSkinnedMesh = true;
  }
  // Animation supplements can replace this URI with a verified blob. Compare
  // every other parsed field, then hash the ACTUAL already loaded buffer.
  if (actual.buffers?.length !== 1 || expected.buffers?.length !== 1
      || actual.buffers[0].byteLength !== expected.buffers[0].byteLength
      || JSON.stringify({ ...actual, buffers: expected.buffers }) !== JSON.stringify(expected)
      || await hash(await gltf.parser.getDependency('buffer', 0)) !== model.bufferSHA256) {
    throw new Error('loaded model differs from source-proven material geometry');
  }
  for (const binding of model.bindings) {
    if (expected.meshes?.[binding.meshIndex]?.primitives?.[binding.primitiveIndex]?.material !== binding.materialIndex) {
      throw new Error('loaded primitive material index differs from original binding');
    }
  }
}

const resources = new Map();
async function imageFor(record, THREE) {
  const key = record.url + ':' + record.sha256;
  if (!resources.has(key)) resources.set(key, (async () => {
    const data = await bytes(record.url);
    if (await hash(data) !== record.sha256) throw new Error('original material texture SHA-256 mismatch');
    const url = URL.createObjectURL(new Blob([data], { type: 'image/png' }));
    try {
      const texture = await new THREE.TextureLoader().loadAsync(url);
      const image = texture.image;
      texture.dispose();
      return image;
    } finally { URL.revokeObjectURL(url); }
  })().catch(error => { resources.delete(key); throw error; }));
  return resources.get(key);
}

let pending;
async function catalog() {
  if (!pending) pending = fetch('/gamedata/npcmaterials.json', { cache: 'no-cache' })
    .then(response => {
      if (!response.ok) throw new Error(`original NPC materials: HTTP ${response.status}`);
      return response.json();
    }).catch(error => { pending = null; throw error; });
  return pending;
}

export async function applyOriginalNpcMaterials(npcId, entry, gltf, THREE) {
  const record = originalNpcMaterialRecord(await catalog(), npcId, entry);
  if (!record) return;
  if (record.unresolved) {
    gltf.scene.userData.originalMaterialGap = record.unresolved;
    console.warn(`NPC ${npcId} original material unresolved: ${record.unresolved.join('; ')}`);
    return;
  }
  await verifyLoadedMaterialModel(gltf, record.model, await bytes(BASE + record.model.gltf));
  const images = await Promise.all(record.images.map(image => image ? imageFor(image, THREE) : null));
  const replacements = [];
  const found = new Set();
  gltf.scene.traverse(object => {
    if (!object.isMesh) return;
    const association = gltf.parser.associations.get(object);
    const index = record.model.bindings.findIndex(binding => binding.meshIndex === association?.meshes
      && binding.primitiveIndex === association?.primitives);
    if (index < 0 || found.has(index) || Array.isArray(object.material)) {
      throw new Error('loaded mesh primitive association is absent or ambiguous');
    }
    const binding = record.model.bindings[index];
    if (gltf.parser.associations.get(object.material)?.materials !== binding.materialIndex) {
      throw new Error('loaded material association differs from original slot');
    }
    found.add(index);
    const image = images[binding.textureIndex];
    if (image) replacements.push([object, record.kind === 'finalblend-alpha'
      ? configureAngelWingMaterial(object.material.clone(), object.material.map, image, record.alphaRef, THREE)
      : configureBrightenMaterial(object.material.clone(), object.material.map, image, THREE)]);
  });
  if (found.size !== record.model.bindings.length) throw new Error('not all original material slots were found');
  for (const [object, material] of replacements) object.material = material;
  gltf.scene.userData.originalMaterialStatus = record.status;
  gltf.scene.userData.originalMaterialLimitations = record.limitations;
}
