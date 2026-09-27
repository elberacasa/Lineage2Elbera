// Elbera Tools static source-hair inspection. No actor attachment or skinning.
const HASH = /^[a-f0-9]{64}$/;
const finiteArray = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
const integer = n => Number.isInteger(n) && n >= 0;

export function selectHairSource(catalog, modelId, styleIndex, colorIndex) {
  if (catalog?.format !== 'l2-interlude-player-hair-v1') throw new Error('Unsupported hair catalog');
  const model = Object.hasOwn(catalog.models || {}, modelId) && catalog.models[modelId];
  const slots = model?.slots?.filter(slot => slot.index === styleIndex);
  if (slots?.length !== 1 || !integer(colorIndex)) throw new Error('Unknown source model/style/color');
  if (!model.slots.some(slot => slot.parts?.some(part => part.colors?.some(color => color.index === colorIndex)))) {
    throw new Error('Unknown source model/style/color');
  }
  const parts = slots[0].parts;
  if (!Array.isArray(parts) || parts.length !== 2 || new Set(parts.map(p => p.part)).size !== 2) {
    throw new Error('Ambiguous source hair parts');
  }
  return parts.map(part => {
    if (![1, 2].includes(part.part) || part.nativeSlot !== (part.part === 1 ? 5 : 4)) throw new Error('Invalid source hair slot');
    if (part.status === 'source-absent') return { ...part };
    if (part.status !== 'source-present') throw new Error('Unresolved source hair part');
    const colors = part.colors?.filter(color => color.index === colorIndex);
    const mesh = catalog.meshes?.[part.mesh];
    const material = colors?.length === 1 && catalog.materials?.[colors[0].material];
    if (!mesh || !material || !HASH.test(mesh.sourceExportSHA256 || '') || !HASH.test(material.sourceExportSHA256 || '')) {
      throw new Error('Unresolved source mesh/material identity');
    }
    return { ...part, color: colors[0], meshRecord: mesh, materialRecord: material };
  });
}

export async function fetchVerifiedHairBytes(record, fetcher = fetch, cryptoApi = globalThis.crypto, signal) {
  if (!HASH.test(record?.SHA256 || '') || !/^\/characters\/hair\/(meshes|textures)\/[a-f0-9]{64}\.(json|png)$/.test(record?.url || '')) {
    throw new Error('Unverified hair asset identity');
  }
  const response = await fetcher(record.url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`Hair asset unavailable (${response.status})`);
  const bytes = await response.arrayBuffer();
  const digest = new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes));
  const hash = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== record.SHA256) throw new Error('Hair asset content hash mismatch');
  return bytes;
}

export function hairGeometryData(raw, record) {
  if (raw?.format !== 'l2-interlude-hair-lod0-v1' || record?.format !== raw.format
      || !HASH.test(record.sourceExportSHA256 || '') || raw.sourceExportSHA256 !== record.sourceExportSHA256
      || !HASH.test(record.sourceLOD0?.SHA256 || '') || raw.sourceLOD0?.SHA256 !== record.sourceLOD0.SHA256
      || raw.stream !== record.sourceStream || !['rigid', 'soft'].includes(raw.stream)
      || !Array.isArray(raw.vertices) || raw.vertices.length !== record.vertices || !raw.vertices.length
      || !Array.isArray(raw.bones) || raw.bones.length !== record.bones) throw new Error('Unverified source LOD0 identity');
  const positions = [], uvs = [], normals = [];
  for (const vertex of raw.vertices) {
    if (!finiteArray(vertex.position, 3) || !finiteArray(vertex.uv, 2) || !finiteArray(vertex.normal, 3)
        || !Array.isArray(vertex.sourceInfluences) || !vertex.sourceInfluences.length
        || vertex.sourceInfluences.some(pair => !finiteArray(pair, 2) || !integer(pair[0]) || pair[0] >= raw.bones.length || pair[1] < 0)) {
      throw new Error('Malformed source LOD0 vertex');
    }
    // Exact source coordinates, UVs and array order. No axis reflection, scale,
    // bone transforms, weight normalization or synthesized geometry.
    positions.push(...vertex.position); uvs.push(...vertex.uv); normals.push(...vertex.normal);
  }
  const indices = raw[raw.stream + 'Indices'], sections = raw[raw.stream + 'Sections'];
  if (!Array.isArray(indices) || indices.length % 3 || !indices.length
      || indices.some(i => !integer(i) || i >= raw.vertices.length) || !Array.isArray(sections) || !sections.length) {
    throw new Error('Malformed source LOD0 indices');
  }
  // Current original hair corpus binds exactly texture slot 0. Reject a future
  // multi-texture graph instead of painting the selected texture over it.
  if (raw.materialSlots?.length !== 1 || raw.materialSlots[0].textureIndex !== 0
      || raw.materialSlots[0].polyFlags !== 0) throw new Error('Unsupported source material slots');
  const used = new Set();
  const groups = sections.map(section => {
    if (section.material !== 0 || !integer(section.firstFace) || !integer(section.numFaces)
        || section.numFaces === 0 || (section.firstFace + section.numFaces) * 3 > indices.length) {
      throw new Error('Malformed source LOD0 section');
    }
    for (let i = section.firstFace; i < section.firstFace + section.numFaces; i++) {
      if (used.has(i)) throw new Error('Overlapping source LOD0 sections');
      used.add(i);
    }
    return { start: section.firstFace * 3, count: section.numFaces * 3, materialIndex: 0 };
  });
  if (used.size * 3 !== indices.length) throw new Error('Incomplete source LOD0 section coverage');
  return { positions, uvs, normals, indices: indices.slice(), groups, raw };
}

// Retire all prior resources immediately. An older asynchronous load can only
// dispose its own result; it can never replace the current view or its status.
export class HairInspectionSlot {
  constructor({ adopt, dispose, status }) { Object.assign(this, { adopt, dispose, status }); this.revision = 0; this.value = null; }
  clear() {
    this.revision++; this.abort?.abort();
    if (this.value) this.dispose(this.value);
    this.value = null;
  }
  async replace(load) {
    this.clear();
    const revision = this.revision, abort = this.abort = new AbortController();
    this.status('loading');
    try {
      const value = await load(abort.signal);
      if (revision !== this.revision) { this.dispose(value); return false; }
      this.value = value; this.adopt(value); this.status('ready', value); return true;
    } catch (error) {
      if (revision === this.revision) {
        if (this.value) { this.dispose(this.value); this.value = null; }
        this.status('error', error);
      }
      return false;
    }
  }
}
