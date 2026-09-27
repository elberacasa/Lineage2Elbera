// Geometry and height queries share the same triangles. The compatibility
// helpers keep their prior B–C diagonal. SourceTerrainSurface additionally
// uses the original bitmap rules when their exact engine evidence is present.
const NATIVE_ENGINE_SHA256 = '07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0';
const NATIVE_CORE_SHA256 = '9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf';

export function gridVertexCoordinate(index, size, stretchLast = false) {
  return stretchLast && index === size - 1 ? size : index;
}

// Convert a coordinate to a cell and fraction, including the doubled final
// interval used by the current tile-seam workaround. Keep clamping explicit:
// callers outside a loaded tile retain the old edge-height fallback.
export function gridCellCoordinate(value, size, stretchLast = false) {
  const end = stretchLast ? size : size - 1;
  const coordinate = Math.max(0, Math.min(value, end));
  const cell = Math.min(Math.floor(coordinate), size - 2);
  const width = stretchLast && cell === size - 2 ? 2 : 1;
  return [cell, (coordinate - cell) / width];
}

export function sampleGridHeight(size, x, y, readHeight, stretchLast = false) {
  const [cx, tx] = gridCellCoordinate(x, size, stretchLast);
  const [cy, ty] = gridCellCoordinate(y, size, stretchLast);
  const a = cy * size + cx, b = a + 1, c = a + size, d = c + 1;
  // Barycentric weights for A-B-C / B-D-C. Bilinear interpolation gives a
  // different surface whenever the four corners are not coplanar.
  if (tx + ty <= 1) {
    return readHeight(a) * (1 - tx - ty) + readHeight(b) * tx + readHeight(c) * ty;
  }
  return readHeight(b) * (1 - ty) + readHeight(d) * (tx + ty - 1) + readHeight(c) * (1 - tx);
}

export function gridTriangleIndices(size) {
  const indices = new Uint32Array((size - 1) ** 2 * 6);
  let k = 0;
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const a = y * size + x, b = a + 1, c = a + size, d = c + 1;
      // L2 Y becomes negative three.js Z, so this winding faces upward.
      indices[k++] = a; indices[k++] = b; indices[k++] = c;
      indices[k++] = b; indices[k++] = d; indices[k++] = c;
    }
  }
  return indices;
}

// The original grid ends at sample 255, not the nominal tile boundary at
// 256. Additional edge vertices are real samples from the adjacent maps.
// Recovered UpdateVTGroup / Set*Edge code confirms these separate samples.
// Missing edges remain absent here; native initialization instead temporarily
// copies the preceding Z. Saved FCoords prove the native height transform
// separately; streaming remains partial. See docs/native-terrain-evidence.md.
export class SourceTerrainSurface {
  constructor(def, heights, edges, topology = null) {
    this.size = def.gridSize;
    this.origin = def.origin;
    this.spacing = def.spacing;
    this.heightScale = def.heightScale;
    this.heights = heights;
    const g = this.size;
    const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
    const originMatches = (value, expected) => Array.isArray(value) && value.length === 3
      && value.every((v, i) => Number.isFinite(v) && v === expected[i]);
    if (!Number.isInteger(g) || g < 2 || heights.length !== g * g
        || !/^\d+_\d+$/.test(def.tile) || !Number.isFinite(def.spacing) || def.spacing <= 0) {
      throw new Error('invalid source terrain grid');
    }
    if (edges.format !== 'l2-terrain-edges-v1' || edges.tile !== def.tile
        || edges.gridSize !== g || edges.spacing !== def.spacing
        || !originMatches(edges.origin, def.origin)) {
      throw new Error('terrain edges do not match scene coordinates');
    }
    for (const side of ['east', 'south']) {
      if (edges[side] !== null && (!Array.isArray(edges[side])
          || edges[side].length !== g || !edges[side].every(Number.isFinite))) {
        throw new Error(`invalid terrain ${side} edge`);
      }
    }
    if (edges.southeast !== null && !Number.isFinite(edges.southeast)) {
      throw new Error('invalid terrain southeast sample');
    }
    this.edges = edges;
    const center = edges.provenance?.center;
    if (!center || center.tile !== def.tile || center.spacing !== def.spacing
        || center.heightScale !== def.heightScale || !Number.isFinite(center.heightScale) || center.heightScale <= 0
        || !originMatches(center.origin, def.origin)
        || !digest(center.rawMapSHA256) || !digest(center.extractedHeightSHA256)) {
      throw new Error('terrain edge source metadata differs from scene');
    }
    const [tileX, tileY] = def.tile.split('_').map(Number);
    for (const [side, dx, dy] of [['east', 1, 0], ['south', 0, 1], ['southeast', 1, 1]]) {
      const meta = edges.provenance[side];
      if (edges[side] === null) {
        if (meta !== null) throw new Error(`missing terrain ${side} source/value mismatch`);
        continue;
      }
      if (!meta || meta.tile !== `${tileX + dx}_${tileY + dy}`
          || !originMatches(meta.origin, [def.origin[0] + dx * g * def.spacing,
            def.origin[1] + dy * g * def.spacing, meta.origin?.[2]])
          || meta.spacing !== def.spacing || !Number.isFinite(meta.heightScale) || meta.heightScale <= 0
          || !digest(meta.rawMapSHA256) || !digest(meta.extractedHeightSHA256)
          || !digest(meta.edgeValuesSHA256)) {
        throw new Error(`invalid terrain ${side} source provenance`);
      }
    }
    this.heightTransform = center.heightTransform ?? null;
    for (const meta of Object.values(edges.provenance)) {
      const transform = meta?.heightTransform;
      if (transform == null) continue;
      const axes = [[meta.spacing, 0, 0], [0, meta.spacing, 0], [0, 0, Math.fround(meta.heightScale)]];
      const proof = transform.verification;
      if (g !== 256 || transform.method !== 'native-fcoords-v1'
          || transform.sourceSHA256 !== meta.rawMapSHA256
          || transform.engineSHA256 !== NATIVE_ENGINE_SHA256 || transform.coreSHA256 !== NATIVE_CORE_SHA256
          || !Array.isArray(transform.origin) || transform.origin.length !== 3
          || !transform.origin.every(v => Number.isFinite(v) && Math.fround(v) === v)
          || JSON.stringify(transform.axes) !== JSON.stringify(axes)
          || !digest(transform.coordsSHA256) || !digest(proof?.boundsSHA256)
          || proof.method !== 'native-sector-four-corners-v1' || proof.sectors !== 256 || proof.boundsMatched !== 1536
          || [0, 1].some(i => [0, 255, 256].some(sample =>
            Math.fround((sample - transform.origin[i]) * meta.spacing) !== meta.origin[i] + sample * meta.spacing))) {
        throw new Error('invalid native terrain height transform proof');
      }
    }
    this.eastStart = edges.east ? g * g : -1;
    this.southStart = edges.south ? g * g + (edges.east ? g : 0) : -1;
    this.cornerIndex = edges.east && edges.south && edges.southeast !== null
      ? g * g + 2 * g : -1;
    this.vertexCount = g * g + (edges.east ? g : 0) + (edges.south ? g : 0)
      + (this.cornerIndex >= 0 ? 1 : 0);
    this.visibility = null;
    this.edgeTurn = null;
    const c = topology?.conventions;
    const native = c?.status === 'native-topology-verified';
    if (c?.status === 'visibility-verified' || native) {
      const words = topology.bitmaps?.visibility?.words;
      const orig = topology.bitmaps?.visibilityOrig?.words;
      const proof = topology.verification;
      const validWords = value => Array.isArray(value) && value.length === Math.ceil(g * g / 32)
        && value.every(v => Number.isInteger(v) && v >= 0 && v <= 0xffffffff);
      if (topology.format !== 'ue2-terrain-topology-v1' || topology.gridSize !== g
          || c.indexOrder !== 'row-major' || c.visibleBit !== 1
          || c.bitmapVariant !== 'visibility'
          || c.bitSetDiagonal !== (native ? 'b-c' : null)
          || c.boundary !== (native ? 'postload-visible' : null)
          || proof?.[native ? 'currentPassed' : 'passed'] !== true
          || !Array.isArray(proof.errors) || proof.errors.length !== 0
          || proof.sourceSHA256 !== center.rawMapSHA256
          || topology.provenance?.sourceSHA256 !== center.rawMapSHA256
          || proof.method !== 'native-sector-quad-table-v1'
          || proof.expectedQuads !== (g - 1) ** 2
          || proof.coveredQuads !== (g - 1) ** 2
          || proof.missingQuads !== 0 || proof.duplicateQuads !== 0
          || proof.visibilityMismatches !== 0 || (!native && proof.origVisibilityMismatches !== 0)
          || !digest(proof.visibilityWordsSHA256) || !digest(proof.origVisibilityWordsSHA256)
          || !validWords(words) || !validWords(orig)) {
        throw new Error('invalid native-sector visibility proof');
      }
      this.visibility = words;
      if (native) {
        const engine = topology.nativeEngine;
        const turns = topology.bitmaps?.edgeTurn?.words;
        const turnsOrig = topology.bitmaps?.edgeTurnOrig?.words;
        if (g !== 256 || engine?.method !== 'interlude-native-terrain-v1'
            || engine.sourceFile !== 'engine.dll' || engine.sourceSHA256 !== NATIVE_ENGINE_SHA256
            || engine.postLoadOrig !== 'copy-current' || engine.outerVisibility !== 'visible'
            || engine.bitSetDiagonal !== 'b-c' || engine.bitClearDiagonal !== 'a-d'
            || !validWords(turns) || !digest(proof.edgeTurnWordsSHA256)
            || (turnsOrig !== undefined && (!validWords(turnsOrig) || !digest(proof.origEdgeTurnWordsSHA256)))) {
          throw new Error('invalid native terrain topology proof');
        }
        // Native PostLoad overwrites Orig from current, including maps whose
        // serialized Orig variant differs. Preserve both input arrays.
        this.edgeTurn = turns;
      }
    }
  }

  indexAt(x, y) {
    const g = this.size;
    if (x < 0 || y < 0 || x > g || y > g) return -1;
    if (x < g && y < g) return y * g + x;
    if (x === g && y < g) return this.eastStart < 0 ? -1 : this.eastStart + y;
    if (y === g && x < g) return this.southStart < 0 ? -1 : this.southStart + x;
    return this.cornerIndex;
  }

  heightAtVertex(x, y) {
    const g = this.size;
    if (this.indexAt(x, y) < 0) return null;
    if (x < g && y < g) return this.worldHeight(this.heights[y * g + x]);
    if (x === g && y < g) return this.edges.east[y];
    if (y === g && x < g) return this.edges.south[x];
    return this.edges.southeast;
  }

  worldHeight(raw) {
    if (this.heightTransform) {
      // Core TransformPointBy retains intermediate precision and stores the
      // resulting native vertex as float32. The original saved coordinates
      // already contain their own float32 rounding; do not recalculate bias.
      return Math.fround((raw - this.heightTransform.origin[2]) * this.heightTransform.axes[2][2]);
    }
    return this.origin[2] + (raw - 32768) * this.heightScale;
  }

  quadVisible(x, y) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return false;
    if ([this.indexAt(x, y), this.indexAt(x + 1, y), this.indexAt(x, y + 1), this.indexAt(x + 1, y + 1)].some(i => i < 0)) return false;
    // Native PostLoad marks x255 and y255 visible. A visibility-only sidecar
    // retains the earlier boundary policy without claiming native proof.
    if (this.visibility && x < this.size - 1 && y < this.size - 1) {
      const bit = y * this.size + x;
      return ((this.visibility[bit >>> 5] >>> (bit & 31)) & 1) === 1;
    }
    return true;
  }

  usesBCDiagonal(x, y) {
    if (!this.edgeTurn) return true; // compatibility for visibility-only data
    const bit = y * this.size + x;
    return ((this.edgeTurn[bit >>> 5] >>> (bit & 31)) & 1) === 1;
  }

  sample(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > this.size || y > this.size) return null;
    // At a shared edge, an adjacent visible quad may provide the point even
    // when the quad on the other side is hidden or has no neighbor data.
    const xs = [Math.min(Math.floor(x), this.size - 1)];
    const ys = [Math.min(Math.floor(y), this.size - 1)];
    if (Number.isInteger(x) && x > 0) xs.push(x - 1);
    if (Number.isInteger(y) && y > 0) ys.push(y - 1);
    for (const cy of ys) for (const cx of xs) {
      if (!this.quadVisible(cx, cy)) continue;
      const tx = x - cx, ty = y - cy;
      const a = this.heightAtVertex(cx, cy), b = this.heightAtVertex(cx + 1, cy);
      const c = this.heightAtVertex(cx, cy + 1), d = this.heightAtVertex(cx + 1, cy + 1);
      if (!this.usesBCDiagonal(cx, cy)) {
        return tx >= ty ? a * (1 - tx) + b * (tx - ty) + d * ty
          : a * (1 - ty) + d * tx + c * (ty - tx);
      }
      return tx + ty <= 1 ? a * (1 - tx - ty) + b * tx + c * ty
        : b * (1 - ty) + d * (tx + ty - 1) + c * (1 - tx);
    }
    return null;
  }

  meshData() {
    const g = this.size, positions = new Float32Array(this.vertexCount * 3);
    const uv = new Float32Array(this.vertexCount * 2), indices = [];
    for (let y = 0; y <= g; y++) for (let x = 0; x <= g; x++) {
      const i = this.indexAt(x, y);
      if (i < 0) continue;
      // Exact source X/Y and decoded source Z; only the axis/unit conversion.
      positions[i * 3] = (this.origin[0] + x * this.spacing) * 0.01;
      positions[i * 3 + 1] = this.heightAtVertex(x, y) * 0.01;
      positions[i * 3 + 2] = -(this.origin[1] + y * this.spacing) * 0.01;
      uv[i * 2] = x / (g - 1); uv[i * 2 + 1] = y / (g - 1);
    }
    for (let y = 0; y < g; y++) for (let x = 0; x < g; x++) {
      if (!this.quadVisible(x, y)) continue;
      const a = this.indexAt(x, y), b = this.indexAt(x + 1, y);
      const c = this.indexAt(x, y + 1), d = this.indexAt(x + 1, y + 1);
      if (this.usesBCDiagonal(x, y)) indices.push(a, b, c, b, d, c);
      else indices.push(a, d, c, a, b, d);
    }
    return { positions, uv, indices: new Uint32Array(indices) };
  }
}

export async function loadSourceTerrainSurface(baseUrl, def, heights) {
  if (!def.terrainEdges) return null;
  const read = async file => {
    const response = await fetch(baseUrl + file, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    return response.json();
  };
  const [edges, topology] = await Promise.all([
    read(def.terrainEdges), def.topology ? read(def.topology) : null,
  ]);
  const surface = new SourceTerrainSurface(def, heights, edges, topology);
  const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(v => v.toString(16).padStart(2, '0')).join('');
  const encoded = new ArrayBuffer(heights.length * 2), heightView = new DataView(encoded);
  for (let i = 0; i < heights.length; i++) heightView.setUint16(i * 2, heights[i], true);
  if (await hash(encoded) !== edges.provenance?.center?.extractedHeightSHA256) {
    throw new Error('heightmap differs from the original source recorded by terrain edges');
  }
  for (const meta of Object.values(edges.provenance)) {
    const transform = meta?.heightTransform;
    if (!transform) continue;
    const values = [...transform.origin, ...transform.axes.flat()];
    const buffer = new ArrayBuffer(48), view = new DataView(buffer);
    values.forEach((value, i) => view.setFloat32(i * 4, value, true));
    if (await hash(buffer) !== transform.coordsSHA256) {
      throw new Error('terrain height coordinates differ from the native source digest');
    }
  }
  for (const side of ['east', 'south', 'southeast']) {
    if (edges[side] === null) continue;
    const values = side === 'southeast' ? [edges[side]] : edges[side];
    const buffer = new ArrayBuffer(values.length * 8), view = new DataView(buffer);
    values.forEach((value, i) => view.setFloat64(i * 8, value, true));
    if (await hash(buffer) !== edges.provenance[side].edgeValuesSHA256) {
      throw new Error(`terrain ${side} values differ from the source edge digest`);
    }
  }
  if (surface.visibility) {
    const fields = [['visibility', 'visibilityWordsSHA256'], ['visibilityOrig', 'origVisibilityWordsSHA256']];
    if (surface.edgeTurn) {
      fields.push(['edgeTurn', 'edgeTurnWordsSHA256']);
      if (topology.bitmaps.edgeTurnOrig) fields.push(['edgeTurnOrig', 'origEdgeTurnWordsSHA256']);
    }
    for (const [name, digest] of fields) {
      const words = topology.bitmaps?.[name]?.words;
      if (!Array.isArray(words) || !words.every(v => Number.isInteger(v) && v >= 0 && v <= 0xffffffff)) {
        throw new Error(`invalid terrain ${name} words`);
      }
      const buffer = new ArrayBuffer(words.length * 4), view = new DataView(buffer);
      words.forEach((word, i) => view.setUint32(i * 4, word, true));
      if (await hash(buffer) !== topology.verification?.[digest]) {
        const kind = name.startsWith('visibility') ? 'visibility' : 'edge-turn';
        throw new Error(`terrain ${kind} words differ from the source proof`);
      }
    }
  }
  return surface;
}
