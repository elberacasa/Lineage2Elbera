import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { configureHairMaterial } from '../js/hairmaterials.js';
import { selectHairSource, fetchVerifiedHairBytes, hairGeometryData, HairInspectionSlot } from './hair-inspection.js';

const model = document.querySelector('#model'), style = document.querySelector('#style'), color = document.querySelector('#color');
const status = document.querySelector('#status'), details = document.querySelector('#details'), stage = document.querySelector('#stage');
const reset = document.querySelector('#reset'), backfaces = document.querySelector('#backfaces');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor('#303a44'); stage.appendChild(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, .01, 10000);
camera.up.set(0, 0, 1);
const orbit = new OrbitControls(camera, renderer.domElement);
let catalog, current, radius = 1, center = new THREE.Vector3(), closed = false;
const catalogAbort = new AbortController();
function render() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.render(scene, camera);
}
function resetView() {
  const aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
  const angle = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, aspect));
  camera.near = Math.max(.001, radius / 1000); camera.far = Math.max(100, radius * 100);
  camera.position.copy(center).add(new THREE.Vector3(1.5, -2.5, 1).normalize().multiplyScalar(radius / Math.sin(angle) * 1.1));
  orbit.target.copy(center); orbit.update(); render();
}
function dispose(view) {
  view.group.removeFromParent();
  view.group.traverse(node => {
    node.geometry?.dispose();
    for (const m of Array.isArray(node.material) ? node.material : [node.material]) { m?.map?.dispose(); m?.dispose(); }
  });
  for (const image of view.images) image.close();
  if (current === view) current = null;
}
function addText(tag, text, parent) { const node = document.createElement(tag); node.textContent = text; parent.appendChild(node); return node; }
function describe(view) {
  details.replaceChildren();
  for (const row of view.rows) {
    const card = document.createElement('article'); details.appendChild(card);
    addText('strong', `Hair${row.part.part} · native slot ${row.part.nativeSlot}`, card);
    if (row.part.status === 'source-absent') { addText('p', 'Absent in this source table slot. No substitute mesh.', card); continue; }
    const { part, raw, data } = row, state = part.materialRecord.renderState;
    addText('p', part.mesh, card);
    addText('p', `${raw.stream} stream · ${raw.vertices.length} source vertices · ${data.indices.length / 3} triangles · ${raw.bones.length} bind bones`, card);
    addText('p', part.color.material, card);
    addText('p', `${state.kind} · alpha test ${state.alphaTest ? '> ' + state.alphaRef + '/255' : 'off'} · ${state.twoSided ? 'two-sided' : 'front side'}${backfaces.checked ? ' (backface override on)' : ''}`, card);
    const proof = document.createElement('details'); card.appendChild(proof); addText('summary', 'Source and verified content hashes', proof);
    addText('pre', `Mesh export: ${raw.sourceExportSHA256}\nServed LOD0 JSON: ${part.meshRecord.SHA256}\nMaterial export: ${part.materialRecord.sourceExportSHA256}\nServed PNG: ${part.materialRecord.image.SHA256}\n\nMesh transform (not applied):\n${JSON.stringify(raw.transform, null, 2)}\n\nFirst source vertex/influences:\n${JSON.stringify(raw.vertices[0], null, 2)}\n\nSections:\n${JSON.stringify(raw[raw.stream + 'Sections'], null, 2)}`, proof);
    const link = document.createElement('a'); link.href = part.meshRecord.url; link.textContent = 'Open full original LOD0 data'; link.target = '_blank'; link.rel = 'noopener'; card.appendChild(link);
  }
}
function applySides() {
  if (!current) return;
  current.group.traverse(node => {
    if (node.isMesh) { node.material[0].side = backfaces.checked ? THREE.DoubleSide : node.userData.sourceSide; node.material[0].needsUpdate = true; }
  });
  describe(current); render();
}
const slot = new HairInspectionSlot({
  dispose,
  adopt(view) {
    current = view; scene.add(view.group);
    const box = new THREE.Box3().setFromObject(view.group);
    if (box.isEmpty()) { center.set(0, 0, 0); radius = 1; }
    else { center = box.getCenter(new THREE.Vector3()); radius = Math.max(.001, box.getSize(new THREE.Vector3()).length() / 2); }
    applySides(); resetView();
  },
  status(state, value) {
    reset.disabled = state !== 'ready';
    if (state === 'loading') { details.replaceChildren(); status.textContent = 'Verifying source mesh and texture bytes…'; render(); }
    else if (state === 'error') { status.textContent = `Unavailable: ${value.message}`; render(); }
    else {
      const count = value.rows.filter(row => row.part.status === 'source-present').length;
      status.textContent = count ? `${count} source part(s) displayed. JSON and PNG content hashes verified; static inspection only.` : 'Both source parts are absent in this stored slot.';
    }
  }
});
async function loadView(parts, signal) {
  const view = { group: new THREE.Group(), images: [], rows: [] };
  try {
    for (const part of parts) {
      if (part.status === 'source-absent') { view.rows.push({ part }); continue; }
      const rawBytes = await fetchVerifiedHairBytes(part.meshRecord, fetch, crypto, signal);
      const raw = JSON.parse(new TextDecoder().decode(rawBytes)), data = hairGeometryData(raw, part.meshRecord);
      const png = await fetchVerifiedHairBytes(part.materialRecord.image, fetch, crypto, signal);
      const image = await createImageBitmap(new Blob([png], { type: 'image/png' }), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      view.images.push(image);
      if (image.width !== part.materialRecord.image.width || image.height !== part.materialRecord.image.height) throw new Error('Source image dimensions mismatch');
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
      geometry.setIndex(data.indices);
      for (const g of data.groups) geometry.addGroup(g.start, g.count, g.materialIndex);
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 1 });
      const mesh = new THREE.Mesh(geometry, [material]); view.group.add(mesh);
      const template = new THREE.Texture(); template.flipY = false; template.colorSpace = THREE.SRGBColorSpace;
      try { configureHairMaterial(material, template, image, part.materialRecord.renderState, THREE); }
      finally { template.dispose(); }
      mesh.userData.sourceSide = material.side;
      view.rows.push({ part, raw, data });
    }
    return view;
  } catch (error) { dispose(view); throw error; }
}
function show() {
  slot.replace(signal => loadView(selectHairSource(catalog, model.value, Number(style.value), Number(color.value)), signal));
}
function colorsForModel() {
  return [...new Set(catalog.models[model.value].slots.flatMap(slot => slot.parts.flatMap(part => (part.colors || []).map(row => row.index))))].sort((a, b) => a - b);
}
function selectModel() {
  const previousStyle = style.value, previousColor = color.value;
  style.replaceChildren(); color.replaceChildren();
  for (const row of catalog.models[model.value].slots) style.add(new Option(`${row.index}${row.parts.every(p => p.status === 'source-absent') ? ' — absent' : ''}`, row.index));
  for (const index of colorsForModel()) color.add(new Option(String(index), index));
  if ([...style.options].some(o => o.value === previousStyle)) style.value = previousStyle;
  if ([...color.options].some(o => o.value === previousColor)) color.value = previousColor;
  show();
}
model.addEventListener('change', selectModel); style.addEventListener('change', show); color.addEventListener('change', show);
backfaces.addEventListener('change', applySides); reset.addEventListener('click', resetView); orbit.addEventListener('change', render);
const resize = new ResizeObserver(render); resize.observe(stage);
window.addEventListener('pagehide', () => { closed = true; catalogAbort.abort(); slot.clear(); resize.disconnect(); orbit.dispose(); renderer.dispose(); });
try {
  const response = await fetch('/gamedata/hair.json', { cache: 'no-store', signal: catalogAbort.signal });
  if (!response.ok) throw new Error(`Local hair catalog unavailable (${response.status}); generate it with Elbera Tools first`);
  catalog = await response.json();
  if (closed) throw new Error('Inspection retired');
  if (catalog.format !== 'l2-interlude-player-hair-v1') throw new Error('Unsupported local hair catalog');
  for (const key of Object.keys(catalog.models).sort()) model.add(new Option(key, key));
  if (Object.hasOwn(catalog.models, 'dwarf_m')) model.value = 'dwarf_m';
  model.disabled = style.disabled = color.disabled = false; selectModel();
} catch (error) { if (!closed) status.textContent = error.message; }
