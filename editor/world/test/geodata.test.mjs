import test from 'node:test';
import assert from 'node:assert/strict';
import { Geodata, NavGrid } from '../js/geodata.js';

// Build the documented wire format from explicit layer/flag fixtures. Expected
// permissions and routes below are authored separately, not obtained from the
// production path checker. Heights are 8-unit quanta as in aCis geodata.
function fixture(cells, { blocks = 4, origin = [0, 0] } = {}) {
  const bytes = [];
  const short = n => bytes.push(n & 255, (n >> 8) & 255);
  bytes.push(0x31, 0x47, 0x32, 0x4c); short(0); short(0);
  for (let bx = 0; bx < blocks; bx++) for (let by = 0; by < blocks; by++) {
    bytes.push(2);
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
      const layers = cells(bx * 8 + x, by * 8 + y);
      bytes.push(layers.length);
      for (const [height, flags] of layers) short((height * 2 & 0xfff0) | flags);
    }
  }
  return new Geodata({ origin, cellSize: 16, cells: blocks * 8, blockCells: 8, blocks }, Uint8Array.from(bytes).buffer);
}
function navFor(geo) {
  return new NavGrid((x, y) => x >= geo.origin[0] && y >= geo.origin[1]
    && x < geo.origin[0] + geo.cells * 16 && y < geo.origin[1] + geo.cells * 16 ? geo : null);
}

test('Java-verified Aden lower floor uses its own NSWE, not the roof', () => {
  // Exact installed L2OFF words at 24_18: (146248,6888) and its eastern
  // neighbor. Independently queried with actual l2jserver.jar BlockMultilayer:
  // Java getHeightNearest(...,792)=792 and getNsweNearest(...,792)=15 at both.
  const geo = fixture(x => x === 0 ? [[1384, 2], [792, 15], [-400, 15]]
    : [[1424, 7], [792, 15], [-400, 15]], { blocks: 1, origin: [146240, 6880] });
  assert.equal(geo.passable(146248, 6888, 146264, 6888, 792), true);
  assert.equal(geo.passable(146248, 6888, 146264, 6888, 1384), false);
  assert.equal(navFor(geo)._lineOk({ x: 146248, y: 6888, z: 792 }, { x: 146264, y: 6888, z: 792 }), 792);
});

test('an open roof does not authorize movement through a lower-floor wall', () => {
  const geo = fixture(() => [[160, 15], [0, 14]], { blocks: 1 });
  assert.equal(geo.passable(8, 8, 24, 8, 0), false);
  assert.equal(geo.passable(8, 8, 24, 8, 160), true);
  assert.equal(geo.passable(8, 8, 24, 8), false); // z-less defaults to lowest
  assert.equal(navFor(geo)._lineOk({ x: 8, y: 8, z: 0 }, { x: 24, y: 8 }), null);
});

test('nearest-layer midpoint resolves downward like Java; legal step is strictly below +48', () => {
  const layers = fixture(() => [[80, 15], [0, 15]], { blocks: 1 });
  assert.equal(layers.heightAt(8, 8, 40), 0);
  for (const [rise, expected] of [[40, 40], [48, null], [56, null]]) {
    const geo = fixture(x => [[x === 0 ? 0 : rise, 15]], { blocks: 1 });
    assert.equal(navFor(geo)._lineOk({ x: 8, y: 8, z: 0 }, { x: 24, y: 8 }), expected);
  }
});

test('diagonal traversal checks the intervening orthogonal cell', () => {
  // Java crosses east from (0,0), then south from (1,0). That south edge is
  // closed, even though the start and diagonal destination permit movement.
  const geo = fixture((x, y) => [[0, x === 1 && y === 0 ? 11 : 15]], { blocks: 1 });
  assert.equal(navFor(geo)._lineOk({ x: 8, y: 8, z: 0 }, { x: 24, y: 24 }), null);
});

test('crossed-cell wall checks also work at negative world coordinates', () => {
  const geo = fixture((x, y) => [[0, x === 1 && y === 0 ? 11 : 15]],
    { blocks: 1, origin: [-128, -128] });
  assert.equal(navFor(geo)._lineOk({ x: -120, y: -120, z: 0 }, { x: -104, y: -104 }), null);
});

test('a static passing line does not authorize a blocked rounded intermediate step', () => {
  // Synthetic geometry, not an official map fixture. Coordinates translate
  // the five independently reproduced configured-Java updates at Baulro.
  // Initial whole-line traversal goes west before north; update5 goes north
  // first from the cell whose lower floor forbids that exit. See the read-only
  // tools/world/PlayerNavigationProbe.java for the real server input proof.
  const geo = fixture((x, y) => x === 14 && y === 6 ? [[488, 15]]
    : [[0, x === 14 && y === 7 ? 7 : 15]]);
  const nav = navFor(geo);
  const at = (x, y) => ({ x, y, z: 0 });
  assert.equal(nav._lineOk(at(256, 128), at(0, 0)), 0);
  const updates = [[256, 128], [248, 124], [240, 120], [232, 116], [225, 112]];
  for (let i = 1; i < updates.length; i++)
    assert.equal(nav._lineOk(at(...updates[i - 1]), at(...updates[i])), 0);
  assert.equal(nav._lineOk(at(225, 112), at(217, 108)), null);
  assert.equal(nav._lineOk(at(225, 112), at(0, 0)), null);
});

test('a staircase can climb several legal steps inside a coarse navigation cell', () => {
  const geo = fixture(x => [[x * 8, 15]]);
  assert.equal(navFor(geo)._trans(0, 0, 32, 1, 0), 96);
});

test('visual foot heights normalize once to raw geodata for route planning', () => {
  const geo = fixture(() => [[32, 15]]);
  const route = navFor(geo).findPath(64, 64, 0, 320, 64, 0);
  assert.equal(route.complete, true);
  assert.deepEqual(route.points[0], { x: 64, y: 64, z: 32 });
  assert.deepEqual(route.points.at(-1), { x: 320, y: 64, z: 32 });
});

test('same coarse cell still emits a validated movement segment', () => {
  const geo = fixture(() => [[0, 15]]);
  const route = navFor(geo).findPath(40, 40, 0, 80, 40, 0);
  assert.equal(route.complete, true);
  assert.deepEqual(route.points, [{ x: 40, y: 40, z: 0 }, { x: 80, y: 40, z: 0 }]);
});

test('an enclosed off-center start cannot become a complete one-point route', () => {
  // The clicked point and coarse center are outside the starting 16-unit
  // cell. Its walls forbid leaving, even though center -> click is open.
  const geo = fixture((x, y) => [[0, x === 0 && y === 0 ? 0 : 15]]);
  const nav = navFor(geo);
  const start = { x: 8, y: 8, z: 0 }, goal = { x: 100, y: 8, z: 0 };
  assert.equal(nav._lineOk(start, goal), null);
  assert.equal(nav._lineOk({ x: 64, y: 64, z: 0 }, goal), 0);
  assert.equal(nav.findPath(8, 8, 0, 100, 8, 0), null);
});

test('route reconstruction retains a necessary final center-to-click turn', () => {
  // North is closed at the exact start. The legal route walks east before
  // turning north; replacing its final center by the click erases that turn.
  const geo = fixture((x, y) => [[0, x === 4 && y === 4 ? 7 : 15]]);
  const nav = navFor(geo);
  const start = { x: 64, y: 64, z: 0 }, goal = { x: 130, y: 8, z: 0 };
  assert.equal(nav._lineOk(start, goal), null);
  const route = nav.findPath(start.x, start.y, start.z, goal.x, goal.y, goal.z);
  assert.equal(route?.complete, true);
  assert.deepEqual(route.points[0], start);
  assert.deepEqual(route.points.at(-1), goal);
  assert.ok(route.points.length >= 3);
  for (let i = 1; i < route.points.length; i++) {
    assert.equal(nav._lineOk(route.points[i - 1], route.points[i]), 0);
  }
});

test('an off-center start can use an open neighboring center on its actual floor', () => {
  // Coarse center (64,64) is upstairs; the lower-floor start can leave east.
  // Route planning must not initialize the upstairs node using the start Z.
  const geo = fixture((x, y) => [[x === 4 && y === 4 ? 160 : 0, 15]]);
  const nav = navFor(geo);
  const start = { x: 96, y: 64, z: 0 }, goal = { x: 320, y: 64, z: 0 };
  assert.equal(nav._lineOk(start, { x: 64, y: 64 }), null);
  const route = nav.findPath(start.x, start.y, start.z, goal.x, goal.y, goal.z);
  assert.equal(route?.complete, true);
  assert.deepEqual(route.points[0], start);
  assert.deepEqual(route.points.at(-1), goal);
  assert.ok(route.points.every(p => p.z === 0));
  for (let i = 1; i < route.points.length; i++) {
    assert.equal(nav._lineOk(route.points[i - 1], route.points[i]), 0);
  }
});

test('a partial route preserves the actual start and only emits reachable legs', () => {
  // The full-height east wall divides the loaded fixture; no detour exists.
  const geo = fixture(x => [[0, x === 15 ? 14 : 15]]);
  const nav = navFor(geo);
  const route = nav.findPath(96, 64, 0, 448, 64, 0);
  assert.equal(route?.complete, false);
  assert.deepEqual(route.points[0], { x: 96, y: 64, z: 0 });
  assert.ok(route.points.length >= 2);
  assert.ok(route.points.every(p => p.x < 256 && p.z === 0));
  for (let i = 1; i < route.points.length; i++) {
    assert.equal(nav._lineOk(route.points[i - 1], route.points[i]), 0);
  }
});

test('snapping an unloaded target emits the reachable snapped coordinate', () => {
  const geo = fixture(() => [[0, 15]]);
  const route = navFor(geo).findPath(64, 64, 0, 528, 64, 0);
  assert.equal(route.complete, true);
  assert.deepEqual(route.points.at(-1), { x: 448, y: 64, z: 0 });
});

test('A* revisits a coordinate on a new floor and smoothing preserves the climb', () => {
  // Only legal route: start lower -> east -> south -> west (+40) -> start
  // upper (+40). An (x,y)-only visited set cannot reach the requested floor.
  const nodes = new Map([
    ['1,1', [[80, 0], [0, 1]]],
    ['2,1', [[0, 4]]],
    ['2,2', [[0, 2]]],
    ['1,2', [[40, 8]]],
  ]);
  const geo = fixture((x, y) => {
    const layers = nodes.get(`${x >> 3},${y >> 3}`);
    if (!layers) return [[512, 0]];
    return layers.map(([z, exits]) => {
      let flags = 15;
      if ((x & 7) === 7 && !(exits & 1)) flags &= ~1;
      if ((x & 7) === 0 && !(exits & 2)) flags &= ~2;
      if ((y & 7) === 7 && !(exits & 4)) flags &= ~4;
      if ((y & 7) === 0 && !(exits & 8)) flags &= ~8;
      return [z, flags];
    });
  });
  const nav = navFor(geo);
  assert.equal(nav._lineOk({ x: 192, y: 192, z: 0 }, { x: 192, y: 192, z: 80 }), null);
  const route = nav.findPath(192, 192, 0, 192, 192, 80);
  assert.equal(route?.complete, true);
  // Smoothing can cross each permitted corner diagonally, but cannot erase
  // the lower-floor excursion and replace it with a vertical teleport.
  assert.deepEqual(route.points.map(p => [p.x, p.y, p.z]), [
    [192, 192, 0], [320, 320, 0], [192, 192, 80],
  ]);
});

test('a disconnected floor cannot be reached by replacing the destination height', () => {
  const geo = fixture(() => [[160, 15], [0, 15]], { blocks: 1 });
  const route = navFor(geo).findPath(8, 8, 0, 24, 8, 160);
  assert.ok(!route || !route.complete);
});

test('fine fallback traverses a narrow stair corridor missed by coarse centers', () => {
  // Explicit synthetic16-unit-wide corridor, each rise16. All coarse centers
  // lie outside it; all source floor/NSWE checks still apply to the fallback.
  const floors = new Map([['0,0', 0], ['1,0', 16], ['2,0', 32],
    ['3,0', 48], ['3,1', 64], ['3,2', 80]]);
  const geo = fixture((x, y) => [[floors.get(`${x},${y}`) ?? 512, 15]]);
  const nav = navFor(geo);
  assert.equal(nav._findPath(8, 8, 0, 56, 40, 80), null);
  const route = nav.findPath(8, 8, 0, 56, 40, 80);
  assert.equal(route.complete, true);
  assert.equal(route.fineFallback, true);
  assert.deepEqual(route.points.map(p => [p.x, p.y, p.z]), [
    [8, 8, 0], [24, 8, 16], [40, 8, 32], [56, 8, 48], [56, 24, 64], [56, 40, 80],
  ]);
  for (let i = 1; i < route.points.length; i++)
    assert.equal(nav._lineOk(route.points[i-1], route.points[i]), route.points[i].z);
});

test('fine fallback keeps separate floor states and cannot bypass an exit wall', () => {
  const cells = new Map([
    ['0,0', [[80, 0], [0, 1]]], ['1,0', [[0, 4]]],
    ['1,1', [[0, 2]]], ['0,1', [[40, 8]]],
  ]);
  const geo = fixture((x, y) => cells.get(`${x},${y}`) || [[512, 0]]);
  const nav = navFor(geo);
  const route = nav.findPath(8, 8, 0, 8, 8, 80);
  assert.equal(route?.complete, true);
  assert.equal(route.fineFallback, true);
  assert.deepEqual(route.points.map(p => [p.x, p.y, p.z]), [
    [8, 8, 0], [24, 8, 0], [24, 24, 0], [8, 24, 40], [8, 8, 80],
  ]);
  const closed = fixture((x, y) => x === 1 && y === 1 ? [[0, 0]] : cells.get(`${x},${y}`) || [[512, 0]]);
  assert.ok(!navFor(closed).findPath(8, 8, 0, 8, 8, 80)?.complete);
});

test('fine endpoint cells match integer line checks across float noise at positive and negative borders', () => {
  const floors = new Map([['1,0', 0], ['2,0', 16], ['3,0', 32], ['3,1', 48], ['3,2', 64]]);
  for (const shift of [0, -128]) {
    const geo = fixture((x, y) => [[floors.get(`${x},${y}`) ?? 512, 15]], { origin: [shift, shift] });
    const nav = navFor(geo), sx = shift + 16 - 1e-10, sy = shift + 8;
    const gx = shift + 56, gy = shift + 32 - 1e-10;
    const route = nav.findPath(sx, sy, 0, gx, gy, 64);
    assert.equal(route?.complete, true, `border shift ${shift}`);
    assert.equal(route.fineFallback, true);
    assert.deepEqual(route.points[0], { x: sx, y: sy, z: 0 });
    assert.deepEqual(route.points.at(-1), { x: gx, y: gy, z: 64 });
    for (let i = 1; i < route.points.length; i++)
      assert.equal(nav._lineOk(route.points[i-1], route.points[i]), route.points[i].z);
  }
});

test('fallback retains a valid coarse approach and bounds work to its unfinished tail', () => {
  const nav = new NavGrid(() => ({ heightAt: () => 0 }));
  const original = nav._findPath;
  const calls = [];
  const start = { x: -4000, y: 8, z: 0 }, tail = { x: 8, y: 8, z: 0 }, goal = { x: 40, y: 8, z: 0 };
  const coarse = { points: [start, tail], complete: false, expansions: 50, ms: 1 };
  nav._findPath = (...args) => {
    calls.push(args);
    if (args[6] == null) return coarse;
    return { points: [tail, { x: 24, y: 8, z: 0 }, goal], complete: true, expansions: 3, ms: 1 };
  };
  const route = nav.findPath(start.x, start.y, 0, goal.x, goal.y, 0);
  assert.deepEqual(calls[1], [8, 8, 0, 40, 8, 0, 16]);
  assert.deepEqual(route.points, [start, tail, { x: 24, y: 8, z: 0 }, goal]);
  assert.equal(route.expansions, 53);
  assert.equal(route.fineFallback, true);
  calls.length = 0;
  assert.equal(nav.findPath(start.x, start.y, 0, 10000, 8, 0), coarse);
  assert.equal(calls.length, 1, 'an unbounded distant fine search must not start');
  nav._findPath = original;
});
