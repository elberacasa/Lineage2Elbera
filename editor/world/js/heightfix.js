// Stale-rectangle heightmap correction, shared by the center tile
// (terrain.js), the decimated neighbor meshes (neighbors.js) and the
// offline measurement harness (tools/world/verify_bspfloor.mjs).
//
// Deliberately DEPENDENCY-FREE (no three.js, no DOM): it is pure array
// arithmetic over a heightmap plus two read-only lookups, so the same code
// that runs in the browser can be re-measured from node against the shipped
// assets. Nothing here converts to three.js space — everything is L2 units.
//
// WHAT IT REPAIRS. Some tiles carry STALE heightmap rectangles: sharp
// axis-aligned zones where the .unr heightmap disagrees with geodata by
// meters, while server z, retail spawn z and building props all agree with
// geodata. Retail ground truth there is geodata; everywhere else the smooth
// heightmap wins. Rule: per grid point, when |heightmap - geodata layer
// NEAREST the heightmap| exceeds MESH_GEO_MAX_DEV, take that geodata layer
// (nearest picks the ground, never a roof layer).
//
// HAZARD 1, the roof (verified on 22_22): geodata covers WALKABLE surfaces
// only, so cells under a building have no ground layer at all -- the nearest
// pick lands on an interior floor or the roof (up to +22 m, rendering as
// giant terrain walls swallowing the town). So the pick is accepted only
// within MESH_GEO_MAX_FIX; beyond it the ground comes from the median of
// trustworthy neighbors in a MESH_GEO_FILL_R ring.
//
// HAZARD 2, structure tops: the walkable TOPS of small structures (stalls,
// carts, fences) also parse as accepted picks and render as grass pyramids
// rising through the prop. Accepted picks must belong to a 4-connected
// cluster of at least MESH_GEO_MIN_CLUSTER cells.
//
// HAZARD 3, the PAVEMENT (added 2026-08-08, once the level BSP was decoded).
// A town square is not a stale rectangle at all: it is a stone slab BUILT
// ON TOP of the natural ground, and all three surfaces are correct at once.
// Measured at the Giran square (22_22, L2 82000/148000):
//
//     heightmap.u16 (natural ground, under the slab) ......... -3600.8
//     Giran_floor03/04 BSP slab top (the pavement) .......... -3496.0
//     geodata (walkable, the +~30 geodata-over-surface band) . -3464
//
// The correction saw the 136-unit gap, believed the heightmap stale, and
// lifted the DIRT terrain to -3464 -- 32 units OVER the pavement, hiding
// the floor the player is supposed to be standing on. So: a pick that
// matches a BSP floor (bspfloor.js) is not evidence of a stale heightmap,
// it is the BSP, and the heightmap under it is right. Those cells keep the
// heightmap (state 3), capped below the slab so the pavement stays visible.
//
// Mutates `heights` (Uint16Array gridSize*gridSize, G16 encoding) in place.

// max allowed heightmap-vs-geodata deviation before the geodata layer
// replaces the (stale) heightmap value (L2 units; 1 m)
export const MESH_GEO_MAX_DEV = 100;
// max deviation the correction may APPLY (L2 units; 2 m) -- hazard 1
export const MESH_GEO_MAX_FIX = 200;
// min 4-connected accepted-pick cluster (grid cells) -- hazard 2
export const MESH_GEO_MIN_CLUSTER = 50;
// ring radius (grid cells) for the neighbor-median ground fill
export const MESH_GEO_FILL_R = 4;

// Hazard 3. How far a geodata pick may sit ABOVE / BELOW a BSP floor over
// the same grid point and still be that floor's own geodata.
//
// MEASURED (tools/world/verify_bspfloor.mjs, all 100 tiles, 62 767 candidate
// cells that carry a BSP floor). The signed gap `pick - nearest BSP floor`
// in 4-unit bins:
//     +8:324  +12:250  +16:259  +20:679  +24:985  +28:4715  +32:19523
//     +36:6699  +40:809  +44:377  +48:307  +52:390  +56:251 ... then a
//     ~120-250/bin background out to whole storeys; below zero it is thin
//     (0:186, -4:55, -8:101, then <30 per bin).
// That spike IS the documented geodata-over-drawn-surface band (+26.9..+34.2
// on open ground, one CELL_HEIGHT wide -- geodata.js GEO_ANCHOR_MAX), except
// it is standing over the BSP FLOOR here instead of over the heightmap.
// That is the evidence that the slab, not the terrain, is the surface the
// geodata describes at a town square.
//
// The window is one aCis walker step (MAX_STEP_UP = CELL_IGNORE_HEIGHT =
// CELL_HEIGHT*6 = 48) above and one CELL_HEIGHT (the packed-word quantum)
// below: a geodata layer within one step of a floor is that floor's walking
// layer. It covers the whole spike with margin and stops well inside the
// background. Picks outside it belong to some other surface and are left to
// the existing rules.
export const BSP_FLOOR_MATCH_UP = 48;
export const BSP_FLOOR_MATCH_DOWN = 8;
// Clearance kept between a BSP floor and the terrain under it (L2 units).
// Only bites where the heightmap is ABOVE the floor -- there the terrain
// would poke through the pavement, so it is pushed just under. 8 = the
// geodata CELL_HEIGHT quantum, the smallest step the source data resolves.
export const BSP_FLOOR_CLEAR = 8;

/**
 * @param heights    Uint16Array gridSize*gridSize, G16, MUTATED
 * @param geodata    loaded Geodata (caller skips when null)
 * @param bspFloor   loaded BspFloor, or null (then this is exactly the
 *                   pre-BSP behaviour -- that is how the before/after
 *                   measurement is taken from one build)
 * @returns {fixed, deferred, deferredCells, bspCells} -- fixed = cells
 *   rewritten, deferred = per-cell state array (0 keep heightmap, 1 geodata
 *   pick, 2 ring-filled roof-hazard override, 3 BSP-floored), deferredCells
 *   = count of state-2 cells, bspCells = count of state-3 cells.
 */
export function correctHeightsWithGeodata(
  heights, gridSize, spacing, origin, heightScale, geodata, bspFloor = null,
) {
  const g = gridSize;
  const picks = new Float32Array(g * g);  // geodata candidate z per cell
  const state = new Uint8Array(g * g);    // 0 keep-hm, 1 take-geo, 2 defer,
                                          // 3 bsp-floored
  const floors = new Float32Array(g * g); // matched BSP floor z (state 3)
  const hmAt = (i) => origin[2] + (heights[i] - 32768) * heightScale;
  for (let gy = 0; gy < g; gy++) {
    for (let gx = 0; gx < g; gx++) {
      const i = gy * g + gx;
      const hm = hmAt(i);
      const geo = geodata.heightAt(
        origin[0] + gx * spacing,
        origin[1] + gy * spacing, hm);
      if (geo == null) continue;
      const dev = Math.abs(geo - hm);
      if (dev <= MESH_GEO_MAX_DEV) continue;
      // hazard 3: is this pick the geodata OF A BSP FLOOR? Then the
      // heightmap is the natural ground under it and is not stale.
      const b = bspFloor ? bspFloorFor(bspFloor, gx, gy, geo) : null;
      if (b != null) {
        picks[i] = geo;
        floors[i] = b;
        state[i] = 3;
        continue;
      }
      picks[i] = geo;
      state[i] = dev <= MESH_GEO_MAX_FIX ? 1 : 2;
    }
  }
  // hazard 2: demote small accepted-pick clusters to the ring fill
  const seen = new Uint8Array(g * g);
  for (let i = 0; i < g * g; i++) {
    if (state[i] !== 1 || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    const cluster = [];
    while (stack.length) {
      const c = stack.pop();
      cluster.push(c);
      const cx = c % g, cy = (c / g) | 0;
      if (cx + 1 < g && state[c + 1] === 1 && !seen[c + 1]) {
        seen[c + 1] = 1; stack.push(c + 1);
      }
      if (cx > 0 && state[c - 1] === 1 && !seen[c - 1]) {
        seen[c - 1] = 1; stack.push(c - 1);
      }
      if (cy + 1 < g && state[c + g] === 1 && !seen[c + g]) {
        seen[c + g] = 1; stack.push(c + g);
      }
      if (cy > 0 && state[c - g] === 1 && !seen[c - g]) {
        seen[c - g] = 1; stack.push(c - g);
      }
    }
    if (cluster.length < MESH_GEO_MIN_CLUSTER) {
      for (const c of cluster) state[c] = 2;
    }
  }
  // The ceiling the BSP puts over a rewritten cell: the LOWEST floor the raw
  // heightmap already passes under. Below it the pavement/deck is what the
  // player sees, so no correction — pick, ring median or heightmap — may be
  // drawn through it. Infinity when the BSP floors nothing above the ground
  // here, which is every cell outside a structure.
  const capAt = (gx, gy, hm) => {
    if (!bspFloor) return Infinity;
    let cap = Infinity;
    for (const h of bspFloor.layersAt(gx, gy)) {
      if (h >= hm && h < cap) cap = h;
    }
    return cap === Infinity ? Infinity : cap - BSP_FLOOR_CLEAR;
  };
  // final height of a cell, used both to write it and to feed the ring fill
  const resolved = (i) => {
    const gx = i % g, gy = (i / g) | 0;
    const hm = hmAt(i);
    if (state[i] === 1) return Math.min(picks[i], capAt(gx, gy, hm));
    if (state[i] === 3) return Math.min(hm, capAt(gx, gy, hm));
    return hm;                            // state 0 (and state 2, pre-fill)
  };
  let fixed = 0;
  const R = MESH_GEO_FILL_R;
  for (let gy = 0; gy < g; gy++) {
    for (let gx = 0; gx < g; gx++) {
      const i = gy * g + gx;
      const hm = hmAt(i);
      let z = null;
      if (state[i] === 1 || state[i] === 3) {
        z = resolved(i);
        if (state[i] === 3 && z === hm) z = null;   // heightmap already right
      } else if (state[i] === 2) {
        const ring = [];
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const nx = gx + dx, ny = gy + dy;
            if (nx < 0 || ny < 0 || nx >= g || ny >= g) continue;
            const j = ny * g + nx;
            if (state[j] !== 2) ring.push(resolved(j));
          }
        }
        ring.sort((a, b) => a - b);
        // no trustworthy neighbor at all: keep the heightmap (terrain-like),
        // never the roof pick
        z = ring.length ? ring[ring.length >> 1] : hm;
        z = Math.min(z, capAt(gx, gy, hm));
      }
      if (z != null) {
        heights[i] = Math.round(32768 + (z - origin[2]) / heightScale);
        fixed++;
      }
    }
  }
  let deferredCells = 0, bspCells = 0;
  for (let i = 0; i < state.length; i++) {
    if (state[i] === 2) deferredCells++;
    else if (state[i] === 3) bspCells++;
  }
  return { fixed, deferred: state, deferredCells, bspCells };
}

/** The BSP floor over grid point (gx, gy) that geodata height `geo`
 *  describes, or null. See BSP_FLOOR_MATCH_UP/DOWN. */
export function bspFloorFor(bspFloor, gx, gy, geo) {
  const layers = bspFloor.layersAt(gx, gy);
  let best = null, bestD = Infinity;
  for (const h of layers) {
    const d = geo - h;
    if (d > BSP_FLOOR_MATCH_UP || d < -BSP_FLOOR_MATCH_DOWN) continue;
    if (Math.abs(d) < bestD) { bestD = Math.abs(d); best = h; }
  }
  return best;
}
