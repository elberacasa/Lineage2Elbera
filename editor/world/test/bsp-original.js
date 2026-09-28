import { prepareBspSweep, traceBspSweep, collectBspSweepHulls, decodeBspLeafHull } from '../js/bsp-collision.js';

const $ = id => document.getElementById(id);
const floatWord = x => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, x, true); return b.getInt32(0, true); };
const fixture = () => ({ rootOutside: 1,
  nodes: [[1, 0, 0, 10], [-1, 0, 0, 10], [0, 1, 0, 10], [0, -1, 0, 10], [0, 0, 1, 10], [0, 0, -1, 10]]
    .map(plane => ({ plane, front: -1, back: -1, flags: 0, numVertices: 4, collisionBound: 0 })),
  leafHulls: [0, 1, 2, 3, 4, 5, -1, ...[-10, -10, -10, 10, 10, 10].map(floatWord)] });
let model = null, sourceIdentity = null, display = null, generation = 0;
const triplet = text => {
  const parts = text.split(',').map(x => x.trim());
  if (parts.length !== 3 || parts.some(x => !x || !Number.isFinite(Number(x)))) throw new Error('Enter three finite coordinates separated by commas.');
  return parts.map(Number);
};
const format = values => values?.map(x => Object.is(x, -0) ? '-0' : String(x)).join(', ') ?? '—';
function setModel(source, name, identity) {
  const ready = prepareBspSweep(source);
  if (ready.status !== 'ready') throw new Error(`Source unavailable: ${ready.reason}`);
  model = ready.model; sourceIdentity = identity;
  $('source-name').textContent = name;
  $('source-identity').textContent = identity;
  $('source-error').textContent = '';
}
function clear(message) {
  display = null;
  $('result-status').textContent = 'Unknown'; $('result-status').dataset.state = 'unknown';
  $('result-description').textContent = message;
  for (const id of ['nodes', 'hulls', 'planes', 'location', 'normal', 'time']) $(id).textContent = '—';
  $('receipt').textContent = '';
  draw();
}
function run() {
  if (!model) { clear('Load a valid source model first.'); return; }
  try {
    const start = triplet($('start').value), end = triplet($('end').value), extent = triplet($('extent').value);
    const result = traceBspSweep(model, start, end, extent);
    if (result.status !== 'ready') { clear(`No collision decision: ${result.reason}`); return; }
    const candidates = collectBspSweepHulls(model, start, end, extent).candidates;
    const unique = [...new Map(candidates.map(c => [c.collisionBound, c])).values()];
    const bounds = unique.map(c => decodeBspLeafHull(model, c.nodeIndex).hull);
    display = { start: start.map(Math.fround), end: end.map(Math.fround), extent: extent.map(Math.fround), result, bounds };
    $('result-status').textContent = result.blocked ? 'BSP blocked' : 'BSP clear';
    $('result-status').dataset.state = result.blocked ? 'blocked' : 'clear';
    $('result-description').textContent = result.blocked ? 'The world BSP component reports an obstruction along this extent sweep.' : 'The world BSP component reports no blocking result for this extent sweep.';
    $('nodes').textContent = result.visited; $('hulls').textContent = result.candidates; $('planes').textContent = result.clippedPlanes;
    $('location').textContent = format(result.hit?.point); $('normal').textContent = format(result.hit?.normal);
    $('time').textContent = result.hit ? `${result.hit.time} adjusted / ${result.hit.rawTime} raw` : 'No adopted hit record';
    $('receipt').textContent = JSON.stringify({ source: sourceIdentity, input: { start, end, extent },
      storedInput: { start: display.start, end: display.end, extent: display.extent }, result }, null, 2);
    draw();
  } catch (error) { clear(error.message); }
}
function restore() {
  generation++;
  setModel(fixture(), 'Synthetic box', 'Portable fixture · no original game assets.');
  $('source-file').value = ''; $('start').value = '20, 0, 0'; $('end').value = '0, 0, 0'; $('extent').value = '1, 1, 1';
  run();
}
$('source-file').addEventListener('change', async event => {
  const token = ++generation, file = event.target.files[0];
  if (!file) return;
  model = null; clear('Reading source…');
  try {
    if (file.size > 64 * 1024 * 1024) throw new Error('This inspector accepts source files up to 64 MiB.');
    const source = JSON.parse(await file.text());
    if (token !== generation) return;
    if (source.format !== 'l2-bsp-collision-source-v1') throw new Error('Expected an Elbera Tools BSP source export.');
    const identity = `${source.source?.model?.qualified ?? 'Unidentified model'} · Source SHA-256: ${source.source?.originalSHA256 ?? 'unavailable'}`;
    setModel(source, file.name, identity);
    // A new source is never queried with stale synthetic/world coordinates.
    for (const id of ['start', 'end', 'extent']) $(id).value = '';
    clear('Source loaded. Enter explicit start, end and half extent to inspect it.');
  } catch (error) {
    if (token !== generation) return;
    model = null; sourceIdentity = null; $('source-name').textContent = 'Source unavailable';
    $('source-identity').textContent = ''; $('source-error').textContent = error.message; clear('No source model is active.');
  }
});
$('fixture').addEventListener('click', restore);
$('query').addEventListener('submit', event => { event.preventDefault(); run(); });
$('query').addEventListener('input', () => clear('Inputs changed. Run the sweep to refresh the result.'));
$('projection').addEventListener('change', draw);
function draw() {
  const canvas = $('plot'), rect = canvas.getBoundingClientRect(), ratio = devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
  const w = rect.width, h = rect.height;
  if (!display || w < 1 || h < 1) return;
  const axes = $('projection').value.split(',').map(Number);
  const { start, end, extent, result, bounds } = display;
  // Frame around the query; enormous world bounds are clipped diagnostically.
  const lo = axes.map(i => Math.min(start[i], end[i]) - extent[i]);
  const hi = axes.map(i => Math.max(start[i], end[i]) + extent[i]);
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], 1);
  const scale = Math.min((w - 100) / span, (h - 90) / span);
  const middle = lo.map((x, i) => x / 2 + hi[i] / 2);
  const project = p => [w / 2 + (p[axes[0]] - middle[0]) * scale, h / 2 - (p[axes[1]] - middle[1]) * scale];
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  ctx.lineWidth = 1; ctx.strokeStyle = '#ebc78c60';
  for (const b of bounds) {
    const a = project(b.min), z = project(b.max);
    ctx.strokeRect(a[0], z[1], z[0] - a[0], a[1] - z[1]);
  }
  const a = project(start), b = project(end), hit = result.hit && project(result.hit.point);
  ctx.strokeStyle = '#a9b9c6'; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
  for (const p of [a, b]) ctx.strokeRect(p[0] - extent[axes[0]] * scale, p[1] - extent[axes[1]] * scale, 2 * extent[axes[0]] * scale, 2 * extent[axes[1]] * scale);
  ctx.setLineDash([]); ctx.strokeStyle = '#85dec8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...(hit ?? b)); ctx.stroke();
  const marker = (p, color, label) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(...p, 4, 0, Math.PI * 2); ctx.fill(); ctx.font = '12px system-ui'; ctx.fillText(label, p[0] + 9, p[1] - 10); };
  marker(a, '#85dec8', 'Start'); marker(b, '#a9b9c6', 'End'); if (hit) marker(hit, '#ffa396', 'Hit');
  ctx.restore(); ctx.fillStyle = '#a9b9c6'; ctx.font = '11px ui-monospace,monospace';
  ctx.fillText(`${'XYZ'[axes[0]]} → / ${'XYZ'[axes[1]]} ↑ · original units`, 14, h - 15);
}
new ResizeObserver(draw).observe($('plot'));
restore();
