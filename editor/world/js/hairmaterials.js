// Elbera Tools: the ordinary Texture / FinalBlend(Texture) hair pass decoded
// by check_hair_selection_native.py. This adapter does not establish actor
// selection, skinning, lighting or sampler parity. The caller binds the source
// graph and image, and retains ownership of the supplied cloned material.
const configured = new WeakSet();

function validateState(state) {
  const alpha = state?.frameBufferBlending === 2;
  if (state?.status !== 'supported-state'
      || !['texture', 'finalblend-texture'].includes(state.kind)
      || ![0, 2].includes(state.frameBufferBlending)
      || state.blend?.enabled !== alpha
      || state.blend?.source !== (alpha ? 5 : 2)
      || state.blend?.destination !== (alpha ? 6 : 1)
      || state.alphaCompare !== 'greater'
      || !Number.isInteger(state.alphaRef) || state.alphaRef < 0 || state.alphaRef > 255
      || !['alphaTest', 'depthWrite', 'depthTest', 'twoSided'].every(key => typeof state[key] === 'boolean')) {
    throw new Error('unsupported original hair render state');
  }
}

export function configureHairMaterial(material, originalMap, image, state, THREE) {
  validateState(state);
  if (configured.has(material)) throw new Error('original hair adapter requires a fresh material');
  if (!originalMap?.isTexture || !image || material.opacity !== 1
      || (material.color && [material.color.r, material.color.g, material.color.b].some(channel => channel !== 1))) {
    throw new Error('unverified original hair map/opacity');
  }
  const texture = originalMap.clone();
  // Do not mutate a shared Texture.Source. Keep the existing sampler, UV
  // transform and color space: source address branches alone do not prove the
  // native resource overrides, mip selection or complete sampling behavior.
  texture.source = new THREE.Source(image);
  texture.needsUpdate = true;
  material.map = texture;
  material.alphaTest = state.alphaTest ? state.alphaRef / 255 : 0;
  material.alphaToCoverage = false;
  material.transparent = state.blend.enabled;
  material.premultipliedAlpha = false;
  material.blending = state.blend.enabled ? THREE.CustomBlending : THREE.NoBlending;
  material.blendEquation = material.blendEquationAlpha = THREE.AddEquation;
  material.blendSrc = material.blendSrcAlpha = state.blend.enabled ? THREE.SrcAlphaFactor : THREE.OneFactor;
  material.blendDst = material.blendDstAlpha = state.blend.enabled ? THREE.OneMinusSrcAlphaFactor : THREE.ZeroFactor;
  material.depthWrite = state.depthWrite;
  material.depthTest = state.depthTest;
  material.side = state.twoSided ? THREE.DoubleSide : THREE.FrontSide;
  material.forceSinglePass = true;
  if (state.alphaTest) {
    const before = material.onBeforeCompile;
    const cacheKey = material.customProgramCacheKey();
    // A separate uniform makes enabled AlphaRef=0 different from disabled
    // alpha testing. Three suppresses USE_ALPHATEST when alphaTest is zero.
    // D3DCMP_GREATER also rejects equality, including fully transparent texels.
    const alphaRef = state.alphaRef / 255;
    material.onBeforeCompile = function (shader, renderer) {
      before.call(this, shader, renderer);
      const tag = '#include <alphatest_fragment>';
      if (shader.fragmentShader.split(tag).length !== 2) {
        throw new Error('unrecognized original hair alpha shader');
      }
      shader.uniforms.elberaHairAlphaRef = { value: alphaRef };
      shader.fragmentShader = 'uniform float elberaHairAlphaRef;\n' + shader.fragmentShader.replace(tag,
        'if (diffuseColor.a <= elberaHairAlphaRef) discard;');
    };
    material.customProgramCacheKey = () => cacheKey + ':original-hair-greater-alpha-v1';
  }
  material.needsUpdate = true;
  configured.add(material);
  return material;
}
