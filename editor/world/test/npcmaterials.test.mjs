import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three.module.min.js';
import { configureAngelWingMaterial, configureBrightenMaterial, originalNpcMaterialRecord, verifyLoadedMaterialModel } from '../js/npcmaterials.js';
globalThis.crypto ??= webcrypto;
const hash = value => createHash('sha256').update(value).digest('hex');

function fixture() {
  const buffer = new Uint8Array([1, 2, 3, 4]);
  const json = { buffers: [{ uri: 'mesh.bin', byteLength: 4 }],
    meshes: [{ primitives: [{ material: 0 }] }], nodes: [{ mesh: 0 }] };
  const bytes = new TextEncoder().encode(JSON.stringify(json));
  const model = { meshName: 'NPC.Mesh', gltf: 'models/mesh.gltf', buffer: 'models/mesh.bin',
    gltfSHA256: hash(bytes), bufferSHA256: hash(buffer), sourcePackageSHA256: hash('pkg'),
    sourceExportSHA256: hash('mesh'), pskSHA256: hash('psk'),
    geometryProof: 'original-PSK-conversion-byte-prefix-and-mesh-skin-node-equality',
    textureSlots: [['Source', 'base']], materialTextureIndices: [0],
    bindings: [{ meshIndex: 0, primitiveIndex: 0, materialIndex: 0, textureIndex: 0, sourceSection: 0 }] };
  const proof = { format: 'l2-interlude-npc-material-proof-v1', edition: 'Interlude',
    instructionChecks: 51, shaderScriptSHA256: hash('Shader'), engineSHA256: hash('engine'), d3dSHA256: hash('d3d'),
    binding: 'npc-primary-texture-index-to-actor-skins',
    brighten: { outputBlending: 5, srcBlend: 2, dstBlend: 4, depthWrite: false, twoSidedCullMode: 1, fogOverrideARGB: 0 } };
  const catalog = { format: 'l2-interlude-npc-materials-v1', edition: 'Interlude', proof, npcgrpSHA256: hash('dat'),
    models: { mesh: model }, npcs: { 1: { meshId: 'mesh', meshName: model.meshName,
      status: 'diffuse-slot-and-brighten-verified', unresolved: [], originalTextures: ['P.Ghost'], materials: ['p:shader'] },
    2: { status: 'unresolved', unresolved: ['TexEnvMap specular'] } },
    materials: {
      'p:shader': { package: 'P', object: 'Ghost', class: 'Shader', exportSHA256: hash('shader'), properties: {
        Diffuse: { reference: 'p:texture' }, SpecularityMask: { reference: 'p:texture' },
        OutputBlending: { raw: '05' }, TwoSided: true } },
      'p:texture': { class: 'Texture', exportSHA256: hash('texture'), image: {
        url: `/characters/monsters/models/npc-materials/${hash('image')}.png`, sha256: hash('png'), rgbaSHA256: hash('rgba') } },
    } };
  const gltf = { parser: { json, getDependency: async () => buffer } };
  return { catalog, model, json, bytes, buffer, gltf, entry: { id: 'mesh', gltf: model.gltf } };
}

test('original NPC ID controls its material variant; unsupported graph remains explicit', () => {
  const f = fixture();
  assert.equal(originalNpcMaterialRecord(f.catalog, 1, f.entry).images.length, 1);
  assert.equal(originalNpcMaterialRecord(f.catalog, 3, f.entry), null);
  assert.deepEqual(originalNpcMaterialRecord(f.catalog, 2, f.entry), { unresolved: ['TexEnvMap specular'] });
});

test('rejects guessed blend modes, extra shader behavior, mismatched model and slot order', () => {
  for (const mutate of [
    f => { f.catalog.proof.brighten.srcBlend = 5; },
    f => { delete f.catalog.proof.shaderScriptSHA256; },
    f => { f.catalog.proof.brighten.depthWrite = true; },
    f => { f.catalog.proof.brighten.fogOverrideARGB = 255; },
    f => { f.catalog.npcs[1].meshName = 'Other.Mesh'; },
    f => { f.catalog.npcs[1].originalTextures[0] = 'P.Other'; },
    f => { f.model.materialTextureIndices = [1]; },
    f => { f.model.bindings[0].textureIndex = -1; },
    f => { f.catalog.materials['p:shader'].properties.Specular = { reference: 'envmap' }; },
    f => { f.catalog.materials['p:shader'].properties.TwoSided = false; },
    f => { f.catalog.materials['p:texture'].image.sha256 = 'unknown'; },
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => originalNpcMaterialRecord(f.catalog, 1, f.entry));
  }
});

test('actual loaded model/buffer must match the source-proven primitive association', async () => {
  const f = fixture();
  await verifyLoadedMaterialModel(f.gltf, f.model, f.bytes);
  f.gltf.parser.json = { ...f.json, buffers: [{ ...f.json.buffers[0], uri: 'blob:verified-animation-buffer' }] };
  await verifyLoadedMaterialModel(f.gltf, f.model, f.bytes);
  f.gltf.parser.getDependency = async () => new Uint8Array([1, 2, 3, 9]);
  await assert.rejects(verifyLoadedMaterialModel(f.gltf, f.model, f.bytes), /loaded model differs/);
});

test('model reordering and stale source bytes cannot silently repaint another section', async () => {
  const f = fixture();
  await assert.rejects(verifyLoadedMaterialModel(f.gltf, f.model, new TextEncoder().encode('{}')), /SHA-256 mismatch/);
  f.model.bindings[0].materialIndex = 1;
  await assert.rejects(verifyLoadedMaterialModel(f.gltf, f.model, f.bytes), /material index differs/);
});

test('actual GLTFLoader skin annotations pass, while unrelated marker changes fail', async () => {
  const three = new URL('../vendor/three.module.min.js', import.meta.url).href;
  const moduleURL = (source, name) => 'data:text/javascript;base64,' + Buffer.from(source + `\n//# sourceURL=${name}\n`).toString('base64');
  const utils = moduleURL((await readFile(new URL('../vendor/addons/utils/BufferGeometryUtils.js', import.meta.url), 'utf8'))
    .replace("from 'three'", `from '${three}'`), 'BufferGeometryUtils-test.js');
  const loaderSource = (await readFile(new URL('../vendor/addons/loaders/GLTFLoader.js', import.meta.url), 'utf8'))
    .replace("from 'three'", `from '${three}'`)
    .replace("from '../utils/BufferGeometryUtils.js'", `from '${utils}'`);
  const { GLTFLoader } = await import(moduleURL(loaderSource, 'GLTFLoader-test.js'));
  // A real loader parse, with no image or network dependency.
  globalThis.ProgressEvent ??= class ProgressEvent { constructor(type, fields) { this.type = type; Object.assign(this, fields); } };
  const buffer = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const source = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1, 2] }],
    nodes: [{ mesh: 0, skin: 0 }, {}, {}], skins: [{ joints: [1] }],
    buffers: [{ uri: 'data:application/octet-stream;base64,' + Buffer.from(buffer.buffer).toString('base64'), byteLength: buffer.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: buffer.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { componentType: 5126, count: 3, type: 'VEC4' }, { componentType: 5123, count: 3, type: 'VEC4' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, WEIGHTS_0: 1, JOINTS_0: 2 }, material: 0 }] }], materials: [{}] };
  const bytes = new TextEncoder().encode(JSON.stringify(source));
  const gltf = await new GLTFLoader().parseAsync(new TextDecoder().decode(bytes), '');
  const model = { gltfSHA256: hash(bytes), bufferSHA256: hash(new Uint8Array(buffer.buffer)),
    bindings: [{ meshIndex: 0, primitiveIndex: 0, materialIndex: 0 }] };
  assert.equal(gltf.parser.json.nodes[1].isBone, true);
  assert.equal(gltf.parser.json.meshes[0].isSkinnedMesh, true);
  await verifyLoadedMaterialModel(gltf, model, bytes);
  gltf.parser.json.nodes[2].isBone = true;
  await assert.rejects(verifyLoadedMaterialModel(gltf, model, bytes), /loaded model differs/);
});

test('brighten equation uses original factors, one draw, depth-write off and black fog', () => {
  const originalImage = { original: true };
  const replacementImage = { ghost: true };
  const originalMap = new THREE.Texture(originalImage);
  originalMap.flipY = false;
  originalMap.colorSpace = THREE.SRGBColorSpace;
  const original = new THREE.MeshStandardMaterial({ map: originalMap });
  const material = configureBrightenMaterial(original.clone(), originalMap, replacementImage, THREE);
  assert.equal(material.blending, THREE.CustomBlending);
  assert.equal(material.blendSrc, THREE.OneFactor);
  assert.equal(material.blendDst, THREE.OneMinusSrcColorFactor);
  assert.equal(material.blendDstAlpha, THREE.OneMinusSrcAlphaFactor);
  assert.equal(material.depthWrite, false);
  assert.equal(material.side, THREE.DoubleSide);
  assert.equal(material.forceSinglePass, true);
  assert.equal(material.map.image, replacementImage);
  assert.equal(originalMap.image, originalImage); // Texture.clone normally shares Source.
  assert.notEqual(material.map.source, originalMap.source);
  assert.equal(material.map.flipY, false);
  assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(original.transparent, false);
  const shader = { fragmentShader: '#include <fog_fragment>' };
  material.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('vec3(0.0)'));
  assert.ok(!shader.fragmentShader.includes('fogColor'));
});

function angelFixture() {
  const f = fixture();
  f.entry.id = 'angel_m00';
  f.model.meshName = 'LineageMonsters.angel_m00';
  f.model.textureSlots.push(['Source', 'wing']);
  f.model.materialTextureIndices.push(1);
  f.model.bindings.push({ meshIndex: 0, primitiveIndex: 1, materialIndex: 1, textureIndex: 1, sourceSection: 1 });
  f.catalog.models.angel_m00 = f.model;
  f.catalog.npcs[1] = { meshId: f.entry.id, meshName: f.model.meshName,
    status: 'wing-alpha-and-blend-verified-partial', unresolved: [],
    limitations: ['Original specular still unresolved.'],
    originalTextures: ['Source.body', 'P.Wing'], materials: ['unchanged-body', 'final'],
    corrections: [{ kind: 'finalblend-alpha', textureIndex: 1, material: 'final', shader: 'shader', diffuse: 'p:texture', alphaRef: 160 }] };
  f.catalog.materials.final = { class: 'FinalBlend', package: 'P', object: 'Wing', exportSHA256: hash('final'),
    properties: { FrameBufferBlending: { raw: '02' }, AlphaTest: true, TwoSided: true, TreatAsTwoSided: true,
      AlphaRef: { raw: 'a0' }, Material: { reference: 'shader' } } };
  f.catalog.materials.shader = { class: 'Shader', exportSHA256: hash('shader'), properties: {
    Diffuse: { reference: 'p:texture' }, Opacity: { reference: 'p:texture' },
    Specular: { reference: 'unimplemented-env' }, SpecularityMask: { reference: 'mask' } } };
  f.catalog.proof.finalBlendAlpha = { frameBufferBlending: 2, srcBlend: 5, dstBlend: 6, alphaCompare: 5,
    depthWrite: true, depthTest: true, twoSidedCullMode: 1, scriptSHA256: hash('script'), packageSHA256: hash('pkg'),
    classDefaults: { defaultsBoundary: 'unique-validated-candidate', defaultsSHA256: hash('defaults') } };
  f.catalog.proof.instructionChecks = 86;
  return f;
}

test('Angel correction binds only the wing and rejects guessed cutoff, channel, depth or slot', () => {
  const f = angelFixture();
  const record = originalNpcMaterialRecord(f.catalog, 1, f.entry);
  assert.equal(record.images[0], null); // Body remains unchanged and explicitly outside this correction.
  assert.equal(record.images[1], f.catalog.materials['p:texture'].image);
  assert.equal(record.alphaRef, 160);
  assert.equal(record.kind, 'finalblend-alpha');
  for (const modify of [
    f => { f.catalog.npcs[1].corrections[0].textureIndex = 0; },
    f => { f.catalog.npcs[1].corrections[0].alphaRef = 128; },
    f => { f.catalog.materials.final.properties.AlphaRef.raw = '80'; },
    f => { f.catalog.materials.shader.properties.Opacity.reference = 'different-channel'; },
    f => { f.catalog.proof.finalBlendAlpha.alphaCompare = 7; },
    f => { f.catalog.proof.finalBlendAlpha.depthWrite = false; },
    f => { f.catalog.proof.finalBlendAlpha.classDefaults.defaultsBoundary = 'ambiguous'; },
    f => { delete f.catalog.npcs[1].limitations; },
  ]) {
    const changed = angelFixture(); modify(changed);
    assert.throws(() => originalNpcMaterialRecord(changed.catalog, 1, changed.entry), /not source-bound/);
  }
});

test('Angel alpha keeps native reference160, rejects equality, and leaves base texture untouched', () => {
  const sourceImage = { original: true }, wingImage = { wing: true };
  const map = new THREE.Texture(sourceImage);
  const original = new THREE.MeshStandardMaterial({ map });
  const material = configureAngelWingMaterial(original.clone(), map, wingImage, 160, THREE);
  assert.equal(original.alphaTest, 0);
  assert.equal(map.image, sourceImage);
  assert.equal(material.map.image, wingImage);
  assert.equal(material.alphaTest, 160 / 255);
  assert.equal(material.blendSrc, THREE.SrcAlphaFactor);
  assert.equal(material.blendDst, THREE.OneMinusSrcAlphaFactor);
  assert.equal(material.blendSrcAlpha, THREE.SrcAlphaFactor);
  assert.equal(material.depthWrite, true);
  assert.equal(material.depthTest, true);
  assert.equal(material.forceSinglePass, true);
  const shader = { fragmentShader: '#include <alphatest_fragment>' };
  material.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('diffuseColor.a <= alphaTest'));
  assert.ok(!shader.fragmentShader.includes('diffuseColor.a < alphaTest'));
  assert.throws(() => configureAngelWingMaterial(original.clone(), map, wingImage, 128, THREE));
});
