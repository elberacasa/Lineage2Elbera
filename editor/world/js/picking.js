// Original Interlude Engine.dll: FindMouseTargetObject -> L2SingleLineCheck
// -> L2MultiLineCheck -> UPrimitive::LineCheck. See the reproducible evidence
// in docs/native-picking-evidence.md. Coordinates here are L2 units, Z up.
export const PICK_RANGE = 10000;
export const PICK_EXTENT = Math.fround(0.1);
export const PICK_SHIFT_START = 30;
export const PICK_TIME_BIAS = Math.fround(0.001);
const RADIAL_PARALLEL = 9.99999905104687e-09;
const INSIDE_APPROACH = -Math.fround(0.1);

const finitePoint = p => p && [p.x, p.y, p.z].every(Number.isFinite);

/** Finite cylinder intersection, including native extent and entry bias.
 * `height` is the HALF-height. `center` is the actor origin, never its feet.
 * Returns both the unbiased surface distance (for conservative world
 * occlusion) and native-biased distance. No screen-space or mesh-size bound.
 * JS arithmetic does not reproduce every intermediate x87 float rounding.
 */
export function intersectPawnCylinder(origin, direction, center, radius, height,
  { near = 0, far = PICK_RANGE } = {}) {
  if (!finitePoint(origin) || !finitePoint(direction) || !finitePoint(center)
    || !Number.isFinite(radius) || radius <= 0 || !Number.isFinite(height) || height <= 0
    || !Number.isFinite(near) || !Number.isFinite(far) || near < 0 || far <= near) return null;
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!length) return null;
  const unit = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
  const span = far - near;
  const start = { x: origin.x + unit.x * near - center.x,
    y: origin.y + unit.y * near - center.y, z: origin.z + unit.z * near - center.z };
  const delta = { x: unit.x * span, y: unit.y * span, z: unit.z * span };
  const r = Math.fround(radius) + PICK_EXTENT, h = Math.fround(height) + PICK_EXTENT;
  if (!Number.isFinite(r) || !Number.isFinite(h)) return null;
  const a = delta.x ** 2 + delta.y ** 2;
  const halfB = start.x * delta.x + start.y * delta.y;
  const c = start.x ** 2 + start.y ** 2 - r ** 2;

  // Native starts inside only block a movement farther into the radial
  // interior; moving out (or solely vertically) does not hit that pawn.
  if (c < 0 && start.z > -h && start.z < h) {
    return halfB < INSIDE_APPROACH ? { distance: near, surfaceDistance: near } : null;
  }

  let enter = 0, leave = 1;
  if (delta.z === 0) {
    if (start.z < -h || start.z > h) return null;
  } else {
    const t0 = (-h - start.z) / delta.z, t1 = (h - start.z) / delta.z;
    enter = Math.max(enter, Math.min(t0, t1));
    leave = Math.min(leave, Math.max(t0, t1));
  }
  if (a < RADIAL_PARALLEL) {
    if (c > 0) return null;
  } else {
    const discriminant = halfB ** 2 - a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    enter = Math.max(enter, (-halfB - root) / a);
    leave = Math.min(leave, (-halfB + root) / a);
  }
  if (enter > leave || leave < 0 || enter > 1) return null;
  return {
    surfaceDistance: near + enter * span,
    distance: near + Math.max(0, Math.min(1, enter - PICK_TIME_BIAS)) * span,
  };
}

/** Closest eligible pawn before a world hit. Missing source sizes stay absent.
 * Pawn center/foot placement is provided by the caller; native grounded
 * collision placement remains a separate porting task. `loading` represents
 * missing pawn resources, matching APawn::ShouldTrace's resource gate.
 */
export function pickPawn(origin, direction, pawns, {
  shift = false, selfId = null, worldDistance = Infinity,
} = {}) {
  let best = null;
  for (const pawn of pawns) {
    if (!pawn || pawn.id === selfId || pawn.loading || (pawn.dead && !shift)) continue;
    const hit = intersectPawnCylinder(origin, direction, pawn.center,
      pawn.collisionRadius, pawn.collisionHeight, { near: shift ? PICK_SHIFT_START : 0 });
    // Native collects world and actor hits in one ordered list. Until the
    // native world trace tolerances are ported, its entry bias must not let
    // an actor behind the drawn floor/wall steal that foreground click.
    if (!hit || hit.surfaceDistance >= worldDistance) continue;
    if (!best || hit.distance < best.distance) best = { id: pawn.id, ...hit };
  }
  return best;
}

// These local sidecars are produced by Elbera Tools from explicitly audited
// original StaticMeshActors. Render meshes are never a collision fallback.
// This ports the source triangle surface, not UStaticMesh's nonzero-extent
// sweep, hit bias, collision tree traversal or intermediate native rounding.
export function parseStaticCollision(data, tile) {
  if (data?.format !== 'l2-static-collision-v1' || data.tile !== tile
      || !Array.isArray(data.actors) || data.actors.length > 10000 || !data.meshes) {
    throw new Error('Invalid source collision sidecar');
  }
  const vector = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const flags = ['bStatic', 'bCollideActors', 'bBlockActors', 'bBlockPlayers',
    'bBlockNonZeroExtentTraces'];
  const surfaces = [];
  let total = 0, vertexTotal = 0;
  for (const actor of data.actors) {
    const mesh = data.meshes[actor.mesh];
    // The original mouse trace has nonzero extent (0.1). ActorLineCheck's
    // zero-extent flag belongs to its other branch. Retain its source type
    // validation without requiring a flag this trace does not consult.
    if (actor.traceEligible !== true || flags.some(k => actor.flags?.[k] !== true)
        || typeof actor.flags?.bBlockZeroExtentTraces !== 'boolean'
        || !vector(actor.position) || !vector(actor.rotation) || !vector(actor.scale)
        || actor.scale.some(v => v === 0) || !Array.isArray(mesh?.vertices)
        || !Array.isArray(mesh.indices) || !mesh.vertices.length || !mesh.indices.length
        || mesh.indices.length % 3 || (total += mesh.indices.length) > 3000000
        || (vertexTotal += mesh.vertices.length) > 2000000 || mesh.vertices.some(v => !vector(v))
        || mesh.indices.some(v => !Number.isInteger(v) || v < 0 || v >= mesh.vertices.length)) {
      throw new Error('Unsupported source collision actor');
    }
    // Same L2 placement basis as Terrain.ueQuaternion / propScale, without
    // metre conversion. Native transform rounding remains explicitly unported.
    const [p, y, r] = actor.rotation.map(v => v * Math.PI / 32768);
    const cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
    const cr = Math.cos(r), sr = Math.sin(r);
    const axes = [[cp * cy, cp * sy, sp],
      [sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, -sr * cp],
      [-cr * sp * cy - sr * sy, sr * cy - cr * sp * sy, cr * cp]];
    const vertices = new Float64Array(mesh.vertices.length * 3);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    mesh.vertices.forEach((v, i) => {
      for (let j = 0; j < 3; j++) {
        const value = actor.position[j] + v.reduce((sum, x, k) =>
          sum + x * actor.scale[k] * axes[k][j], 0);
        if (!Number.isFinite(value)) throw new Error('Nonfinite source collision transform');
        vertices[i * 3 + j] = value;
        min[j] = Math.min(min[j], value); max[j] = Math.max(max[j], value);
      }
    });
    surfaces.push({ actor: actor.name, mesh: actor.mesh, vertices,
      indices: Uint32Array.from(mesh.indices), min, max });
  }
  return { tile, surfaces, triangleCount: total / 3 };
}

export async function loadStaticCollision(tile, reference, fetcher = fetch, signal) {
  if (reference == null) return null;
  // Source exports always live beside the ordinary scene, including HD mode.
  if (reference !== 'static-collision.json') throw new Error('Invalid collision sidecar reference');
  const response = await fetcher(`/scenes/${encodeURIComponent(tile)}/${reference}`, { signal });
  if (!response.ok) throw new Error(`static collision: HTTP ${response.status}`);
  return parseStaticCollision(await response.json(), tile);
}

export function pickStaticCollision(origin, direction, collision, { shift = false } = {}) {
  if (!collision || !finitePoint(origin) || !finitePoint(direction)) return null;
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!length) return null;
  const o = [origin.x, origin.y, origin.z];
  const d = [direction.x / length, direction.y / length, direction.z / length];
  const near = shift ? PICK_SHIFT_START : 0;
  let best = null, far = PICK_RANGE;
  for (const surface of collision.surfaces) {
    let enter = near, leave = far;
    for (let k = 0; k < 3; k++) {
      if (d[k] === 0) {
        if (o[k] < surface.min[k] || o[k] > surface.max[k]) leave = -1;
      } else {
        const a = (surface.min[k] - o[k]) / d[k], b = (surface.max[k] - o[k]) / d[k];
        enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
      }
    }
    if (enter > leave) continue;
    const v = surface.vertices, indices = surface.indices;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
      const ex = v[b] - v[a], ey = v[b + 1] - v[a + 1], ez = v[b + 2] - v[a + 2];
      const fx = v[c] - v[a], fy = v[c + 1] - v[a + 1], fz = v[c + 2] - v[a + 2];
      const px = d[1] * fz - d[2] * fy, py = d[2] * fx - d[0] * fz;
      const pz = d[0] * fy - d[1] * fx, det = ex * px + ey * py + ez * pz;
      if (det === 0) continue;
      const tx = o[0] - v[a], ty = o[1] - v[a + 1], tz = o[2] - v[a + 2];
      const u = (tx * px + ty * py + tz * pz) / det;
      if (u < 0 || u > 1) continue;
      const qx = ty * ez - tz * ey, qy = tz * ex - tx * ez, qz = tx * ey - ty * ex;
      const w = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
      if (w < 0 || u + w > 1) continue;
      const distance = (fx * qx + fy * qy + fz * qz) / det;
      if (distance < near || distance > far || !Number.isFinite(distance)) continue;
      far = distance;
      best = { distance, surfaceDistance: distance, actor: surface.actor, mesh: surface.mesh,
        triangle: i / 3, point: { x: o[0] + d[0] * distance,
          y: o[1] + d[1] * distance, z: o[2] + d[2] * distance } };
    }
  }
  return best;
}

/** Readable live evidence for Elbera Tools; absent from the normal client. */
export function installPickingInspection(search) {
  if (new URLSearchParams(search).get('dev') !== '1') return null;
  const panel = document.createElement('output');
  panel.setAttribute('aria-label', 'Elbera Tools world picking');
  panel.style.cssText = 'position:fixed;left:12px;bottom:145px;z-index:10000;max-width:340px;padding:8px;background:#101923e8;color:#eef3f6;font:12px/1.4 monospace;white-space:pre-wrap;pointer-events:none';
  document.body.append(panel);
  return { update(collision, pick, sourceWorld = null) {
    const p = pick?.l2;
    panel.textContent = ['Elbera Tools — World picking',
      collision ? `Collision: ${collision.tile} · ${collision.surfaces.length} actors · ${collision.triangleCount} triangles` : 'Collision: no audited static surfaces loaded',
      sourceWorld ? `Source preparation: ${sourceWorld.preparedActors}/${sourceWorld.staticActors} actors · ${sourceWorld.preparedMeshes}/${sourceWorld.meshes} meshes\n${sourceWorld.savedSlots} saved slots · ${sourceWorld.unpreparedSavedActors} actors awaiting preparation\nCurrent source collision: ${sourceWorld.collisionStatus}` : '',
      pick ? `Pixel: ${pick.pixel.join(', ')} · ${pick.surface || 'no world hit'}` : 'World pick: none',
      pick?.actor ? `${pick.actor} · triangle ${pick.triangle}\n${pick.mesh}` : '',
      p ? `L2: ${p.x}, ${p.y}, ${p.z}` : '',
      'Source triangles; native sweep/bias unported.'].filter(Boolean).join('\n');
  }, destroy() { panel.remove(); } };
}
