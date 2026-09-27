// Elbera Tools: ordinary source-bound face selection. Hair selectors are not
// yet admitted. A received unsupported index stays explicit; no face-0 alias.
let catalogPromise = null;
export function loadAppearance() {
  if (!catalogPromise) catalogPromise = fetch('/gamedata/appearance.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(`Appearance metadata HTTP ${r.status}`); return r.json(); })
    .catch(error => { catalogPromise = null; throw error; });
  return catalogPromise;
}

const fields = ['face', 'hairStyle', 'hairColor'];
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const unsupportedHair = snapshot => fields.slice(1).filter(k => own(snapshot, k));
export function facePlan(catalog, modelId, face) {
  if (!Number.isInteger(face) || face < 0) return { status: 'unsupported', reason: 'invalid face index' };
  if (catalog?.format !== 'l2-interlude-player-appearance-v1') return { status: 'unsupported', reason: 'missing source face catalog' };
  const model = own(catalog.models || {}, modelId) ? catalog.models[modelId] : null;
  if (!model || !Array.isArray(model.faces) || !model.nodeName || !model.materialName) return { status: 'unsupported', reason: 'model has no source face binding' };
  const choices = model.faces.filter(f => f.index === face);
  if (choices.length !== 1) return { status: 'unsupported', reason: 'face index absent or ambiguous in source' };
  const selected = choices[0];
  if (!/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(selected.texture)
      || selected.url !== `/faces/${selected.texture.replace('.', '/')}.png`)
    return { status: 'unsupported', reason: 'unbound face texture URL' };
  return { status: 'ready', face, texture: selected.texture, url: selected.url,
    nodeName: model.nodeName, materialName: model.materialName };
}

// Dependencies make lifecycle testing independent of WebGL, image decoding and
// private assets. Texture images may be shared; each applied material/texture
// instance is owned here, and only those instances are disposed.
export class PlayerAppearance {
  constructor({ getModel, loadCatalog = loadAppearance, loadTexture, onResult = () => {} }) {
    this.getModel = getModel; this.loadCatalog = loadCatalog;
    this.loadTexture = loadTexture; this.onResult = onResult;
    this.wanted = {}; this.revision = 0; this.owned = null; this.request = null;
  }
  set(snapshot = {}) {
    for (const key of fields) if (own(snapshot, key)) this.wanted[key] = snapshot[key];
    return this.refresh();
  }
  cancel() {
    ++this.revision; this.wanted = {}; this.request = null;
    this.release();
    const result = { status: 'cancelled' }; this.onResult(result); return result;
  }
  release() {
    if (!this.owned) return;
    const { node, original, material, texture } = this.owned;
    if (node.material === material) node.material = original;
    material.dispose(); texture.dispose(); this.owned = null;
  }
  refresh() {
    const { model, modelId } = this.getModel();
    if (this.owned && this.owned.model !== model) this.release();
    const snapshot = { ...this.wanted };
    // Identical UserInfo snapshots must share an in-flight image request.
    const same = this.request && this.request.model === model && this.request.modelId === modelId
      && fields.every(k => own(snapshot, k) === own(this.request.snapshot, k)
        && Object.is(snapshot[k], this.request.snapshot[k]));
    if (same) return this.request.promise;
    const revision = ++this.revision;
    const current = () => revision === this.revision && this.getModel().model === model
      && this.getModel().modelId === modelId;
    const finish = result => {
      const value = { ...result, unsupported: unsupportedHair(snapshot) };
      if (current()) this.onResult(value);
      return value;
    };
    const request = { model, modelId, snapshot, promise: null };
    this.request = request;
    request.promise = (async () => {
      if (!own(snapshot, 'face')) return finish({ status: 'pending', reason: 'no received face index' });
      if (!model) return finish({ status: 'pending', face: snapshot.face, reason: 'model not loaded' });
      finish({ status: 'pending', face: snapshot.face });
      const catalog = await this.loadCatalog();
      if (!current()) return { status: 'cancelled' };
      const plan = facePlan(catalog, modelId, snapshot.face);
      if (plan.status !== 'ready') return finish({ ...plan, face: snapshot.face });
      const matches = [];
      model.traverse(node => { if (node.name === plan.nodeName) matches.push(node); });
      const node = matches.length === 1 ? matches[0] : null;
      if (!node?.isMesh || Array.isArray(node.material) || node.material?.name !== plan.materialName || !node.material?.map)
        return finish({ status: 'unsupported', face: snapshot.face, reason: 'loaded face mesh/material differs from source binding' });
      const sourceTexture = await this.loadTexture(plan.url);
      if (!current()) return { status: 'cancelled' };
      if (!sourceTexture?.source) throw new Error('face texture has no decoded source image');
      // A model change or material replacement while the image was pending
      // cannot turn a source-qualified binding into a generic face fallback.
      if (node.material?.name !== plan.materialName || !node.material?.map)
        return finish({ status: 'unsupported', face: snapshot.face, reason: 'face material changed during image load' });
      this.release();
      const original = node.material;
      const material = original.clone(), texture = original.map.clone();
      // Keep the actual built face sampler, UV transform and color space.
      // Replace only its image; do not tint or borrow another source variant.
      texture.source = sourceTexture.source;
      texture.needsUpdate = true;
      material.map = texture; material.needsUpdate = true;
      node.material = material;
      this.owned = { model, node, original, material, texture };
      return finish({ status: 'ready', face: plan.face, texture: plan.texture });
    })().catch(error => {
      if (!current()) return { status: 'cancelled' };
      this.request = null; // An explicit later snapshot may retry a failed load.
      return finish({ status: 'error', face: snapshot.face, reason: String(error?.message || error) });
    });
    return request.promise;
  }
}
