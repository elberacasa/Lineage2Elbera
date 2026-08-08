#!/usr/bin/env node
// verify_bspfloor.mjs -- how much terrain does the stale-rectangle
// correction draw ON TOP OF the decoded BSP floors, and does the hazard-3
// rule in heightfix.js remove it without touching anything else?
//
// Re-runnable measurement, no browser: it imports the REAL client modules
// (editor/world/js/heightfix.js, geodata.js, bspfloor.js -- all three are
// dependency-free on purpose) and runs them over the shipped assets, so
// what is measured here is what the client executes.
//
//   node tools/world/verify_bspfloor.mjs               # all tiles, summary
//   node tools/world/verify_bspfloor.mjs 22_22 --detail
//   node tools/world/verify_bspfloor.mjs --check       # gate, exit 1 on fail
//
// METRICS
//   buried     grid points where the raw heightmap is at or below a BSP
//              floor (pavement visible) and the correction lifts the terrain
//              ABOVE it (pavement hidden). This is the bug, counted.
//   bspCells   grid points the new rule classifies as BSP-floored (state 3).
//   stale      grid points still taken from geodata (state 1) -- the
//              legitimate stale-rectangle repair, which must NOT collapse.
//   deferred   state-2 ring fills -- the roof-hazard guard, likewise.
//   props      retail prop Location.Z oracle: |prop.z - DRAWN SURFACE| where
//              the drawn surface is max(terrain mesh, BSP floor under the
//              prop). Props are placed on the ground the retail client
//              draws; over a slab that ground is the slab, not the mesh.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Geodata } from '../../editor/world/js/geodata.js';
import { BspFloor } from '../../editor/world/js/bspfloor.js';
import {
  correctHeightsWithGeodata, bspFloorFor, BSP_FLOOR_MATCH_UP,
  BSP_FLOOR_MATCH_DOWN,
} from '../../editor/world/js/heightfix.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORLD = path.join(ROOT, 'assets', 'world');

function readU16(file) {
  const b = fs.readFileSync(file);
  const out = new Uint16Array(b.byteLength / 2);
  for (let i = 0; i < out.length; i++) out[i] = b.readUInt16LE(i * 2);
  return out;
}

function toArrayBuffer(b) {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

function loadTile(tile) {
  const dir = path.join(WORLD, tile);
  const scene = JSON.parse(fs.readFileSync(path.join(dir, 'scene.json')));
  if (!scene.geodata) return null;
  const meta = JSON.parse(fs.readFileSync(path.join(dir, scene.geodata)));
  const layer = meta.layers && meta.layers[0];
  if (!layer || layer.encoding !== 'blockstream-v1') return null;
  const geodata = new Geodata(
    meta, toArrayBuffer(fs.readFileSync(path.join(dir, layer.data))));
  const fp = path.join(dir, 'bspfloor.bin');
  const bspFloor = fs.existsSync(fp)
    ? new BspFloor(toArrayBuffer(fs.readFileSync(fp))) : null;
  return {
    tile, scene, geodata, bspFloor,
    raw: readU16(path.join(dir, scene.heightmap)),
  };
}

// terrain z (L2) of grid point i, from a G16 height array
const zAt = (h, i, scene) =>
  scene.origin[2] + (h[i] - 32768) * scene.heightScale;

function measure(t) {
  const { scene, geodata, bspFloor, raw } = t;
  const g = scene.gridSize || 256;
  const spacing = scene.spacing || 128;
  const before = Uint16Array.from(raw);
  const after = Uint16Array.from(raw);
  const rb = correctHeightsWithGeodata(
    before, g, spacing, scene.origin, scene.heightScale, geodata, null);
  const ra = correctHeightsWithGeodata(
    after, g, spacing, scene.origin, scene.heightScale, geodata, bspFloor);

  const out = {
    tile: t.tile, hasBsp: !!bspFloor,
    buried: 0, buriedBy: [], gaps: [],
    beforeFixed: rb.fixed, afterFixed: ra.fixed,
    beforeStale: 0, afterStale: 0,
    beforeDeferred: rb.deferredCells, afterDeferred: ra.deferredCells,
    bspCells: ra.bspCells, changed: 0, changedMax: 0,
  };
  for (let i = 0; i < g * g; i++) {
    if (rb.deferred[i] === 1) out.beforeStale++;
    if (ra.deferred[i] === 1) out.afterStale++;
    if (before[i] !== after[i]) {
      out.changed++;
      out.changedMax = Math.max(out.changedMax,
        Math.abs(zAt(before, i, scene) - zAt(after, i, scene)));
    }
    if (!bspFloor) continue;
    const gx = i % g, gy = (i / g) | 0;
    const layers = bspFloor.layersAt(gx, gy);
    if (!layers.length) continue;
    const z0 = zAt(raw, i, scene);
    const z1 = zAt(before, i, scene);
    // a floor the raw heightmap left visible and the correction covered
    for (const b of layers) {
      if (z0 <= b && z1 > b) {
        out.buried++;
        out.buriedBy.push(z1 - b);
        break;
      }
    }
    // signed gap pick-vs-floor at every cell the correction wanted, for the
    // BSP_FLOOR_MATCH window derivation
    if (rb.deferred[i] !== 0) {
      const geo = geodata.heightAt(
        scene.origin[0] + gx * spacing, scene.origin[1] + gy * spacing, z0);
      if (geo != null) {
        let bestD = Infinity;
        for (const b of layers) {
          if (Math.abs(geo - b) < Math.abs(bestD)) bestD = geo - b;
        }
        if (bestD !== Infinity) out.gaps.push(bestD);
      }
    }
  }
  out.after = after;
  out.before = before;
  return out;
}

// retail prop Location.Z oracle over the cells this change touches
function propOracle(t, m) {
  const { scene, bspFloor } = t;
  const g = scene.gridSize || 256;
  const spacing = scene.spacing || 128;
  const rows = [];
  for (const p of scene.props || []) {
    if (!p.gltf || !p.position) continue;
    const gx = Math.round((p.position[0] - scene.origin[0]) / spacing);
    const gy = Math.round((p.position[1] - scene.origin[1]) / spacing);
    if (gx < 0 || gy < 0 || gx >= g || gy >= g) continue;
    const i = gy * g + gx;
    if (m.before[i] === m.after[i]) continue;      // unaffected cell
    const tb = zAt(m.before, i, scene);
    const ta = zAt(m.after, i, scene);
    // the BSP surface a prop could be RESTING ON: the highest floor at or
    // just below it (a floor above the prop is a deck the prop is under, and
    // taking it would flatter the metric)
    let b = null;
    if (bspFloor) {
      for (const h of bspFloor.layersAt(gx, gy)) {
        if (h <= p.position[2] + 32 && (b == null || h > b)) b = h;
      }
    }
    rows.push({
      z: p.position[2],
      dTerrainBefore: Math.abs(p.position[2] - tb),
      dTerrainAfter: Math.abs(p.position[2] - ta),
      dDrawnBefore: Math.abs(p.position[2] - Math.max(tb, b == null ? -Infinity : b)),
      dDrawnAfter: Math.abs(p.position[2] - Math.max(ta, b == null ? -Infinity : b)),
    });
  }
  return rows;
}

const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};
const pct = (a, q) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const detail = argv.includes('--detail');
  let tiles = argv.filter(a => !a.startsWith('--'));
  if (!tiles.length) {
    tiles = fs.readdirSync(WORLD).filter(
      d => fs.existsSync(path.join(WORLD, d, 'scene.json'))).sort();
  }

  let totBuried = 0, tilesBuried = 0, totBsp = 0, totStaleB = 0, totStaleA = 0;
  let totDefB = 0, totDefA = 0;
  const allGaps = [], allBuriedBy = [], propRows = [];
  const worst = [];
  for (const tile of tiles) {
    const t = loadTile(tile);
    if (!t) { console.log(`${tile}: no geodata, skipped`); continue; }
    const m = measure(t);
    totBuried += m.buried;
    if (m.buried) { tilesBuried++; worst.push([m.buried, tile, m]); }
    totBsp += m.bspCells;
    totStaleB += m.beforeStale; totStaleA += m.afterStale;
    totDefB += m.beforeDeferred; totDefA += m.afterDeferred;
    allGaps.push(...m.gaps);
    allBuriedBy.push(...m.buriedBy);
    propRows.push(...propOracle(t, m));
    if (detail || tiles.length <= 5) {
      console.log(
        `${tile}: buried ${m.buried}  bspCells ${m.bspCells}  `
        + `stale ${m.beforeStale}->${m.afterStale}  `
        + `deferred ${m.beforeDeferred}->${m.afterDeferred}  `
        + `changed ${m.changed} (max ${m.changedMax.toFixed(1)} L2u)`);
    }
  }

  worst.sort((a, b) => b[0] - a[0]);
  console.log('\n== extent of the burial (correction over BSP floors) ==');
  console.log(`tiles measured           : ${tiles.length}`);
  console.log(`tiles with buried floors : ${tilesBuried}`);
  console.log(`grid points buried       : ${totBuried}`);
  if (allBuriedBy.length) {
    console.log(`burial depth (L2u)       : median ${median(allBuriedBy).toFixed(1)}`
      + `  p95 ${pct(allBuriedBy, 0.95).toFixed(1)}`
      + `  max ${Math.max(...allBuriedBy).toFixed(1)}`);
  }
  console.log('worst tiles              : '
    + worst.slice(0, 12).map(w => `${w[1]}=${w[0]}`).join(' '));

  console.log('\n== what the hazard-3 rule does ==');
  console.log(`state 3 (BSP-floored)    : ${totBsp}`);
  console.log(`state 1 (stale repair)   : ${totStaleB} -> ${totStaleA}`);
  console.log(`state 2 (roof guard)     : ${totDefB} -> ${totDefA}`);

  if (allGaps.length) {
    console.log('\n== pick - nearest BSP floor, at cells the correction wanted ==');
    const inBand = allGaps.filter(
      d => d <= BSP_FLOOR_MATCH_UP && d >= -BSP_FLOOR_MATCH_DOWN).length;
    console.log(`samples ${allGaps.length}  p05 ${pct(allGaps, 0.05).toFixed(0)}`
      + `  p25 ${pct(allGaps, 0.25).toFixed(0)}`
      + `  median ${median(allGaps).toFixed(0)}`
      + `  p75 ${pct(allGaps, 0.75).toFixed(0)}`
      + `  p95 ${pct(allGaps, 0.95).toFixed(0)}`);
    const hist = new Map();
    for (const d of allGaps) {
      const k = Math.max(-200, Math.min(400, Math.round(d / 16) * 16));
      hist.set(k, (hist.get(k) || 0) + 1);
    }
    console.log('histogram (16 L2u bins, clamped +-):');
    console.log([...hist.entries()].sort((a, b) => a[0] - b[0])
      .map(([k, v]) => `${k}:${v}`).join(' '));
    console.log(`inside [-${BSP_FLOOR_MATCH_DOWN}, +${BSP_FLOOR_MATCH_UP}]`
      + ` : ${inBand} (${(100 * inBand / allGaps.length).toFixed(1)}%)`);
  }

  if (propRows.length) {
    console.log('\n== retail prop Location.Z over the changed cells ==');
    console.log(`props ${propRows.length}`);
    const f = (k) => median(propRows.map(r => r[k])).toFixed(1);
    const within = (k) => propRows.filter(r => r[k] < 100).length;
    console.log(`median |prop.z - TERRAIN MESH|   before ${f('dTerrainBefore')}`
      + `  after ${f('dTerrainAfter')}`);
    console.log(`median |prop.z - DRAWN SURFACE|  before ${f('dDrawnBefore')}`
      + `  after ${f('dDrawnAfter')}`);
    console.log(`within 100 L2u of the DRAWN surface: `
      + `before ${within('dDrawnBefore')}  after ${within('dDrawnAfter')}`);
    // per-prop verdict: medians are dominated by the architecture pieces
    // (a town tile's props are mostly building parts, whose Location.Z is
    // wherever the piece belongs, not a ground height), so count props that
    // moved closer to / further from the surface they stand on
    const better = propRows.filter(r => r.dDrawnAfter < r.dDrawnBefore - 1).length;
    const worse = propRows.filter(r => r.dDrawnAfter > r.dDrawnBefore + 1).length;
    console.log(`per prop: closer ${better}  further ${worse}  `
      + `unchanged ${propRows.length - better - worse}`);
    const bs = propRows.filter(r => r.dDrawnBefore < 32).length;
    const as = propRows.filter(r => r.dDrawnAfter < 32).length;
    console.log(`resting ON the drawn surface (<32 L2u): before ${bs}  after ${as}`);
  }

  if (check) {
    const fail = [];
    // the whole point: no BSP floor may be buried by the corrected mesh
    for (const [, tile, m] of worst) {
      const t = loadTile(tile);
      const g = t.scene.gridSize || 256;
      let left = 0;
      for (let i = 0; i < g * g; i++) {
        const gx = i % g, gy = (i / g) | 0;
        const layers = t.bspFloor ? t.bspFloor.layersAt(gx, gy) : [];
        if (!layers.length) continue;
        const z0 = zAt(t.raw, i, t.scene), z1 = zAt(m.after, i, t.scene);
        for (const b of layers) if (z0 <= b && z1 > b) { left++; break; }
      }
      if (left) fail.push(`${tile}: ${left} grid points still buried`);
    }
    console.log('');
    for (const f of fail) console.log('FAIL ' + f);
    console.log(fail.length ? 'verify_bspfloor: FAIL' : 'verify_bspfloor: PASS');
    process.exit(fail.length ? 1 : 0);
  }
}

main();
