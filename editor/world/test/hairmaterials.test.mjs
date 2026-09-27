import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.min.js';
import { configureHairMaterial } from '../js/hairmaterials.js';

const state = (changes = {}) => ({ status: 'supported-state', kind: 'finalblend-texture',
  frameBufferBlending: 2, blend: { enabled: true, source: 5, destination: 6 },
  alphaTest: true, alphaRef: 160, alphaCompare: 'greater', depthWrite: true,
  depthTest: true, twoSided: true, treatAsTwoSided: false, ...changes });

test('keeps sampler/UV/color-space and isolates shared source while applying native pass state', () => {
  const image = { width: 16, height: 16 }, map = new THREE.Texture({ width: 8, height: 8 });
  map.wrapS = THREE.RepeatWrapping; map.wrapT = THREE.ClampToEdgeWrapping;
  map.minFilter = THREE.NearestFilter; map.magFilter = THREE.LinearFilter;
  map.colorSpace = THREE.SRGBColorSpace; map.flipY = false;
  map.offset.set(.25, .5); map.repeat.set(2, 3);
  const originalSource = map.source, material = new THREE.MeshBasicMaterial();
  assert.equal(configureHairMaterial(material, map, image, state(), THREE), material);
  assert.notEqual(material.map, map); assert.notEqual(material.map.source, originalSource);
  assert.equal(map.source, originalSource); assert.equal(material.map.image, image);
  for (const key of ['wrapS', 'wrapT', 'minFilter', 'magFilter', 'colorSpace', 'flipY'])
    assert.equal(material.map[key], map[key]);
  assert.deepEqual(material.map.offset, map.offset); assert.deepEqual(material.map.repeat, map.repeat);
  assert.equal(material.transparent, true); assert.equal(material.blending, THREE.CustomBlending);
  assert.equal(material.blendSrc, THREE.SrcAlphaFactor); assert.equal(material.blendSrcAlpha, THREE.SrcAlphaFactor);
  assert.equal(material.blendDst, THREE.OneMinusSrcAlphaFactor); assert.equal(material.blendDstAlpha, THREE.OneMinusSrcAlphaFactor);
  assert.equal(material.depthWrite, true); assert.equal(material.depthTest, true);
  assert.equal(material.side, THREE.DoubleSide); assert.equal(material.forceSinglePass, true);
  material.map.dispose(); material.dispose(); map.dispose();
});

for (const alphaRef of [0, 1, 3, 5, 127, 150, 160, 200]) {
  test(`enabled native GREATER rejects equality at AlphaRef ${alphaRef}, including zero`, () => {
    const material = new THREE.MeshBasicMaterial(), map = new THREE.Texture({});
    let hookCalls = 0;
    material.onBeforeCompile = function (shader) { ++hookCalls; shader.fragmentShader += '\n// prior hook'; };
    material.customProgramCacheKey = () => 'prior-key';
    configureHairMaterial(material, map, {}, state({ alphaRef }), THREE);
    const shader = { uniforms: {}, fragmentShader: 'void main() {\n#include <alphatest_fragment>\n}' };
    material.onBeforeCompile(shader, {});
    assert.equal(hookCalls, 1); assert.equal(shader.uniforms.elberaHairAlphaRef.value, alphaRef / 255);
    assert.match(shader.fragmentShader, /if \(diffuseColor\.a <= elberaHairAlphaRef\) discard;/);
    assert.doesNotMatch(shader.fragmentShader, /USE_ALPHATEST|alphatest_fragment/);
    assert.match(shader.fragmentShader, /prior hook/);
    assert.equal(material.customProgramCacheKey(), 'prior-key:original-hair-greater-alpha-v1');
    assert.throws(() => material.onBeforeCompile({ uniforms: {}, fragmentShader: 'void main() {}' }), /unrecognized/);
    material.map.dispose(); material.dispose(); map.dispose();
  });
}

test('opaque source state resets blend/depth/culling and never aliases TreatAsTwoSided', () => {
  const material = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: .5, side: THREE.DoubleSide });
  const hook = material.onBeforeCompile, map = new THREE.Texture({});
  configureHairMaterial(material, map, {}, state({ kind: 'texture', frameBufferBlending: 0,
    blend: { enabled: false, source: 2, destination: 1 }, alphaTest: false, alphaRef: 0,
    depthWrite: false, depthTest: false, twoSided: false, treatAsTwoSided: true }), THREE);
  assert.equal(material.alphaTest, 0); assert.equal(material.onBeforeCompile, hook);
  assert.equal(material.transparent, false); assert.equal(material.blending, THREE.NoBlending);
  assert.equal(material.depthWrite, false); assert.equal(material.depthTest, false);
  assert.equal(material.side, THREE.FrontSide);
  material.map.dispose(); material.dispose(); map.dispose();
});

test('rejects unsupported states before cloning or changing the material', () => {
  const bad = [{ status: 'unsupported' }, { alphaRef: -1 }, { alphaRef: 256 }, { alphaRef: .5 },
    { alphaTest: 1 }, { depthTest: undefined }, { alphaCompare: 'greater-equal' },
    { blend: { enabled: true, source: 2, destination: 1 } }, { frameBufferBlending: 5 }];
  const material = new THREE.MeshBasicMaterial(), map = new THREE.Texture({});
  for (const changes of bad) assert.throws(() => configureHairMaterial(material, map, {}, state(changes), THREE), /unsupported/);
  assert.equal(material.map, null);
  assert.throws(() => configureHairMaterial(material, {}, {}, state(), THREE), /unverified/);
  material.opacity = .5;
  assert.throws(() => configureHairMaterial(material, map, {}, state(), THREE), /unverified/);
  assert.equal(material.map, null); material.dispose(); map.dispose();
});

test('rejects prior tint and repeat application instead of chaining stale alpha hooks', () => {
  const material = new THREE.MeshBasicMaterial(), map = new THREE.Texture({});
  material.color.setRGB(.5, 1, 1);
  assert.throws(() => configureHairMaterial(material, map, {}, state(), THREE), /unverified/);
  assert.equal(material.map, null);
  material.color.setRGB(1, 1, 1);
  configureHairMaterial(material, map, {}, state(), THREE);
  const ownedMap = material.map, hook = material.onBeforeCompile;
  for (const next of [state(), state({ alphaTest: false })]) {
    assert.throws(() => configureHairMaterial(material, map, {}, next, THREE), /fresh material/);
    assert.equal(material.map, ownedMap); assert.equal(material.onBeforeCompile, hook);
  }
  ownedMap.dispose(); material.dispose(); map.dispose();
});
