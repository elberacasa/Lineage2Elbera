// Elbera Tools: read-only fine-cell route diagnostic, not a movement command.
// Reports configured-geodata results from the actual browser planner. This
// neither sends movement nor claims original-client pathfinding parity.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Geodata, NavGrid } from '../../editor/world/js/geodata.js';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const coordinate = value => {
    const xyz = String(value).split(',').map(Number);
    if (xyz.length !== 3 || !xyz.every(n => Number.isInteger(n) && n >= -0x80000000 && n <= 0x7fffffff))
      throw new Error('Expected integer x,y,z coordinates');
    return { x: xyz[0], y: xyz[1], z: xyz[2] };
  };
  if (process.argv.length !== 4) throw new Error('Usage: node tools/world/inspect_navigation.mjs startX,startY,startZ targetX,targetY,targetZ');
  const start = coordinate(process.argv[2]), target = coordinate(process.argv[3]);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const cache = new Map(), inputs = [], sha = b => createHash('sha256').update(b).digest('hex');
  const nav = new NavGrid((x, y) => {
    const tile = `${20+Math.floor(x/32768)}_${18+Math.floor(y/32768)}`;
    if (cache.has(tile)) return cache.get(tile);
    const directory = path.join(root, 'assets/world', tile), file = path.join(directory, 'geodata.json');
    if (!fs.existsSync(file)) { cache.set(tile, null); return null; }
    const bytes = fs.readFileSync(file), meta = JSON.parse(bytes), layer = meta.layers?.[0];
    if (layer?.encoding !== 'blockstream-v1' || path.basename(layer.data) !== layer.data) throw new Error('Unsupported geodata metadata');
    const binary = fs.readFileSync(path.join(directory, layer.data));
    if (binary.length < 8 || binary.readUInt32LE(0) !== 0x4c324731) throw new Error('Invalid geodata binary');
    const geo = new Geodata(meta, binary.buffer.slice(binary.byteOffset, binary.byteOffset+binary.byteLength));
    cache.set(tile, geo); inputs.push({ tile, metadataSHA256: sha(bytes), binarySHA256: sha(binary) });
    return geo;
  });
  const args = [start.x, start.y, start.z, target.x, target.y, target.z];
  const coarse = nav._findPath(...args);
  const route = nav.findPath(...args);
  console.log(JSON.stringify({ tool: 'Elbera Tools', start, target, inputs, coarse, route,
    limits: ['read-only fine-cell diagnostic; no movement or NPC action sent',
      'static geodata route, not live rounded-step or original-client proof',
      'short cell turns must not be skipped by an arrival tolerance'] }, null, 2));
}
