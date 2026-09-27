import * as THREE from 'three';

const number = n => Number.isFinite(n) ? n.toFixed(3) : 'unknown';
const vector = v => v?.map(number).join(', ') || 'unknown';
const l2 = v => v && [v[0] * 100, -v[2] * 100, v[1] * 100];

// Browser measurements, not native collision or proof that a camera is inside
// a body. AABB containment only identifies a candidate for visual inspection.
function measureActor(actor, cameraPosition) {
  if (!actor?.group) return null;
  const group = actor.group, bounds = new THREE.Box3();
  let sourceMatrixBones = 0;
  group.updateMatrixWorld(true);
  group.traverse(mesh => {
    if (mesh.isBone && mesh.matrixAutoUpdate === false) sourceMatrixBones++;
    if (!mesh.isMesh) return;
    for (let parent = mesh; parent; parent = parent.parent) if (!parent.visible) return;
    mesh.skeleton?.update();
    bounds.union(new THREE.Box3().setFromObject(mesh, true));
  });
  return { name: actor.name || actor.modelId || 'player', id: actor.id ?? null,
    appearance: actor.lastAppearance ? { ...actor.lastAppearance } : null,
    position: l2(group.position.toArray()),
    scale: group.getWorldScale(new THREE.Vector3()).toArray(),
    meshScales: group.children.filter(child => !child.isSprite).map(child =>
      child.getWorldScale(new THREE.Vector3()).toArray()),
    clip: actor.current?.getClip?.().name || null, time: actor.current?.time ?? null,
    pose: actor.originalPose?.status ?? actor.lastOriginalPose ?? null, sourceMatrixBones,
    cameraBoundsDistance: bounds.isEmpty() ? null : bounds.distanceToPoint(cameraPosition) };
}

/** Visible, local-only diagnostic. No network sends, staging, or game rules. */
export function installCameraInspection(search, readState) {
  if (new URLSearchParams(search).get('dev') !== '1') return null;
  const panel = document.createElement('details');
  panel.setAttribute('aria-label', 'Elbera Tools camera inspection');
  panel.style.cssText = 'position:fixed;right:12px;top:94px;z-index:10000;width:310px;max-width:calc(100vw - 24px);padding:8px;background:#101923ed;color:#eef3f6;font:11px/1.4 monospace';
  const title = document.createElement('summary');
  title.textContent = 'Elbera Tools — Camera inspection';
  const output = document.createElement('pre');
  output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0;max-height:260px;overflow:auto';
  output.setAttribute('aria-label', 'Camera measurements');
  const measure = document.createElement('button');
  measure.textContent = 'Measure player and target bodies';
  const bodies = document.createElement('pre');
  bodies.style.cssText = output.style.cssText;
  bodies.setAttribute('aria-label', 'Body measurements');
  panel.append(title, output, measure, bodies);
  document.body.append(panel);
  let frame = null, wasShortened = false;
  const events = [];
  function invalidate() {
    if (frame) bodies.textContent = '';
    frame = null;
    wasShortened = false;
  }
  function currentState() {
    const state = readState();
    if (!state.followCameraActive) invalidate();
    return state;
  }
  function record(kind, data = {}) {
    events.push({ at: new Date().toISOString(), kind, ...data });
    if (events.length > 12) events.shift();
  }
  function refresh() {
    const state = currentState();
    if (!panel.open) return;
    output.textContent = [
      `Tile: ${state.tile || 'loading'} · ${state.online ? 'Online' : 'Offline'}`,
      `Follow camera: ${state.followCameraActive ? 'active' : 'inactive'}`,
      `Player L2: ${vector(l2(state.character?.group.position.toArray()))}`,
      `Target: ${state.target?.name || 'none'}`,
      `Boom m: requested ${number(frame?.requestedBoom)} · actual ${number(frame?.actualBoom)}`,
      `Camera L2: ${vector(l2(frame?.position))}`,
      `Focus L2: ${vector(l2(frame?.target))}`,
      `Yaw/pitch rad: ${number(frame?.yaw)} / ${number(frame?.pitch)}`,
      `Obstruction: ${JSON.stringify(frame?.obstruction ?? null)}`,
      'Recent receipts / boom changes (browser observations):',
      ...events.map(row => JSON.stringify(row)),
    ].join('\n');
  }
  measure.addEventListener('click', () => {
    const state = currentState();
    if (!state.followCameraActive) { bodies.textContent = 'Follow camera inactive; no current body measurement.'; return; }
    if (!frame) { bodies.textContent = 'No follow-camera frame available.'; return; }
    const position = new THREE.Vector3().fromArray(frame.position);
    bodies.textContent = JSON.stringify({ at: new Date().toISOString(),
      note: 'Metres to current drawn AABB; zero is not proof of mesh penetration. Scales are dimensionless.',
      camera: frame,
      player: measureActor(state.character, position),
      target: measureActor(state.target, position) }, null, 2);
  });
  panel.addEventListener('toggle', refresh);
  const timer = setInterval(refresh, 250);
  return {
    record,
    capture(sample) {
      if (!sample || !currentState().followCameraActive) { invalidate(); return; }
      frame = sample;
      const shortened = sample.actualBoom < sample.requestedBoom;
      if (shortened !== wasShortened) {
        record(shortened ? 'boom-shortened' : 'boom-restored', sample);
        wasShortened = shortened;
      }
    },
    destroy() { clearInterval(timer); panel.remove(); },
  };
}
