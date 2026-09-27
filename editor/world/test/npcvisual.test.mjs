import test from 'node:test';
import assert from 'node:assert/strict';
import { npcVisualScale } from '../js/npcvisual.js';

function fixture() {
  return { format: 'l2-interlude-npc-visuals-v1',
    provenance: { edition: 'Interlude', sourceSHA256: 'a'.repeat(64) },
    npcs: { 7001: { mesh: 'Source.Model', drawScale: 2, drawScale3D: [1, 3, 5] } },
    meshes: { 'source.model': { meshScale: [7, 11, 13], lodMeshVersion: 3,
      sourceSHA256: 'b'.repeat(64), exportSHA256: 'c'.repeat(64) } } };
}

test('original per-axis scale converts coordinate axes without fitting collision height', () => {
  const source = fixture();
  source.npcs[7001].collisionHeight = 99999;
  assert.deepEqual(npcVisualScale(source, 7001, 'model'), { x: 14, y: 130, z: 66 });
});

test('unresolved class, mismatched mesh and missing native inputs have no invented scale', () => {
  const source = fixture();
  assert.equal(npcVisualScale(source, 7002, 'Model'), null);
  assert.equal(npcVisualScale(source, 7001, 'Other'), null);
  delete source.npcs[7001].drawScale3D;
  assert.equal(npcVisualScale(source, 7001, 'Model'), null);
});

test('unsupported old serialization and nonfinite transformed values reject', () => {
  const source = fixture();
  source.meshes['source.model'].lodMeshVersion = 1;
  assert.equal(npcVisualScale(source, 7001, 'Model'), null);
  source.meshes['source.model'].lodMeshVersion = 3;
  source.npcs[7001].drawScale = 1e100;
  assert.equal(npcVisualScale(source, 7001, 'Model'), null);
  source.npcs[7001].drawScale = 1e30;
  source.meshes['source.model'].meshScale = [1e30, 1, 1];
  assert.equal(npcVisualScale(source, 7001, 'Model'), null);
});

test('source zero and mirrored axes remain source values rather than truthy defaults', () => {
  const source = fixture();
  source.npcs[7001].drawScale = 0;
  assert.deepEqual(npcVisualScale(source, 7001, 'Model'), { x: 0, y: 0, z: 0 });
  source.npcs[7001].drawScale = 1;
  source.npcs[7001].drawScale3D[0] = -1;
  assert.deepEqual(npcVisualScale(source, 7001, 'Model'), { x: -7, y: 65, z: 33 });
});
