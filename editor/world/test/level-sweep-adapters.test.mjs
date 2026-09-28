import test from "node:test";
import assert from "node:assert/strict";
import { prepareLevelSweepAdapters } from "../js/level-sweep-adapters.js";
import { collectLevelHits } from "../js/level-query.js";
import { traceTerrainSweep } from "../js/terrain-collision.js";

// Authored synthetic geometry, not game data or a source-state default.
const word = (value) => {
  const v = new DataView(new ArrayBuffer(4));
  v.setFloat32(0, value, true);
  return v.getInt32(0, true);
};
const node = (plane) => ({
  plane,
  front: -1,
  back: -1,
  flags: 0,
  numVertices: 4,
  collisionBound: 0,
  zones: [1, 2],
  leaves: [7, 9],
});
const box = () => ({
  rootOutside: 1,
  nodes: [
    [1, 0, 0, 10],
    [-1, 0, 0, 10],
    [0, 1, 0, 10],
    [0, -1, 0, 10],
    [0, 0, 1, 10],
    [0, 0, -1, 10],
  ].map(node),
  leafHulls: [0, 1, 2, 3, 4, 5, -1, ...[-10, -10, -10, 10, 10, 10].map(word)],
});
const terrain = (height = () => 0) => ({
  width: 4,
  height: 4,
  vertices: Array.from({ length: 16 }, (_, i) => {
    const x = (i % 4) * 128,
      y = Math.floor(i / 4) * 128;
    return [x, y, height(x, y)];
  }),
  inverseCoords: [0, 0, 0, 1 / 128, 0, 0, 0, 1 / 128, 0, 0, 0, 1],
  visibility: Array(16).fill(true),
  edgeTurn: Array(16).fill(false),
  inverted: false,
  deleteMe: false,
  terrainMapPresent: true,
  owner: null,
});
const model = (identity = "model", source = box()) => ({
  identity,
  source,
  numZones: 3,
  zoneActors: [null, "back-zone", "front-zone"],
});
const setup = (extra = {}) =>
  prepareLevelSweepAdapters({
    models: [model()],
    terrains: [{ identity: "terrain", source: terrain() }],
    ...extra,
  });
const bspCall = (extra = {}) => ({
  participant: "model",
  start: [20, 0, 0],
  end: [0, 0, 0],
  extent: [1, 1, 1],
  flags: 4,
  owner: null,
  extraNodeFlags: 0,
  ...extra,
});
const terrainCall = (extra = {}) => ({
  participant: "terrain",
  start: [30, 30, 100],
  end: [30, 30, -100],
  extent: [1, 1, 1],
  flags: 4,
  visibilityBypass: false,
  ...extra,
});
const query = (primitives, extra = {}) => ({
  ...terrainCall(),
  sourceActor: null,
  level: {
    identity: "current",
    model: "model",
    actorHash: null,
    zones: [
      { identity: "front-zone", flags3d8: 4, terrains: ["terrain"] },
      ...Array(63).fill(null),
    ],
  },
  callerLevel: { identity: "caller", model: "model" },
  attachedLevelsEnabled: false,
  attachedLevels: [],
  primitives,
  ...extra,
});

test("explicit participant arrays, identities and complete source data are required", () => {
  for (const value of [
    {},
    { models: [], terrains: Array(1) },
    { models: Array(1), terrains: [] },
    { models: [model(), model()], terrains: [] },
    { models: [], terrains: [{ identity: null }] },
    { models: [], terrains: [], actorHash: null },
    { models: [{ ...model(), zoneActors: [] }], terrains: [] },
  ])
    assert.equal(prepareLevelSweepAdapters(value).status, "unsupported");
  assert.equal(
    prepareLevelSweepAdapters({ models: [], terrains: [] }).status,
    "ready",
  );
});

test("BSP empty, non-adoption and adoption expose distinct actual write sets", () => {
  const empty = model("empty", { rootOutside: 1, nodes: [], leafHulls: [] });
  const p = setup({ models: [model(), empty] }).primitives;
  assert.deepEqual(p.bsp(bspCall({ participant: "empty" })), {
    status: "ready",
    blocked: false,
    writes: {},
  });
  assert.deepEqual(p.bsp(bspCall({ end: [30, 0, 0] })), {
    status: "ready",
    blocked: false,
    writes: { time: 2 },
  });
  const hit = p.bsp(bspCall());
  assert.equal(hit.blocked, true);
  assert.equal(hit.writes.actor, null);
  assert.equal(hit.writes.item, "model");
  assert.deepEqual(Object.keys(hit.writes).sort(), [
    "actor",
    "item",
    "normal",
    "point",
    "time",
  ]);
  const solid = setup({
    models: [model("model", { rootOutside: 0, nodes: [], leafHulls: [] })],
  }).primitives;
  assert.equal(solid.bsp(bspCall()).status, "unsupported");
});

test("BSP adopted Time=1 still writes complete record while returning clear", () => {
  const r = setup().primitives.bsp(
    bspCall({ start: [100, 0, 0], end: [91, 0, 0], extent: [80, 1, 1] }),
  );
  assert.equal(r.blocked, false);
  assert.equal(r.writes.time, 1);
  assert.deepEqual(r.writes.point, [91, 0, 0]);
  assert.equal(r.writes.item, "model");
});

test("terrain distinguishes untouched outer miss, Actor-only miss and accepted writes", () => {
  const hidden = terrain();
  hidden.visibility.fill(false);
  const p = setup({
    terrains: [
      { identity: "terrain", source: terrain() },
      { identity: "hidden", source: hidden },
    ],
  }).primitives;
  assert.deepEqual(
    p.terrain(terrainCall({ start: [500, 30, 100], end: [500, 30, -100] })),
    { status: "ready", blocked: false, writes: {} },
  );
  assert.deepEqual(p.terrain(terrainCall({ participant: "hidden" })), {
    status: "ready",
    blocked: false,
    writes: { actor: null },
  });
  const r = p.terrain(terrainCall());
  assert.equal(r.blocked, true);
  assert.equal(r.writes.actor, "terrain");
  assert.equal(r.writes.material, null);
  assert.deepEqual(Object.keys(r.writes).sort(), [
    "actor",
    "material",
    "normal",
    "point",
    "time",
  ]);
});

test("unsupported caller modes, flags, extents and missing identities stay unsupported", () => {
  const p = setup().primitives;
  for (const extra of [
    { owner: undefined },
    { owner: {} },
    { extraNodeFlags: 1 },
    { extraNodeFlags: undefined },
    { flags: undefined },
    { flags: -1 },
    { participant: "absent" },
    { extent: [0, 0, 0] },
  ])
    assert.equal(p.bsp(bspCall(extra)).status, "unsupported");
  for (const extra of [
    { visibilityBypass: undefined },
    { visibilityBypass: true },
    { flags: 0x1000 },
    { flags: 0x80000 },
    { participant: "absent" },
    { extent: [0, 0, 0] },
  ])
    assert.equal(p.terrain(terrainCall(extra)).status, "unsupported");
  assert.equal(
    p.region({ model: "absent", point: [0, 0, 0], defaultZone: "level" })
      .status,
    "unsupported",
  );
  assert.equal(p.actorHash({ hash: "actual-hash" }).status, "unsupported");
  assert.deepEqual(
    p.bsp(bspCall({ flags: 0x1000 })),
    p.bsp(bspCall()),
    "source trace-flags material branch is zero-extent only",
  );
});

test("region uses the same source tree and preserves explicit default-zone identity", () => {
  const p = setup().primitives;
  assert.equal(
    p.region({ model: "model", point: [0, 0, 0], defaultZone: "caller" }).zone,
    "back-zone",
  );
  assert.equal(
    p.region({ model: "model", point: [10, 0, 0], defaultZone: "caller" }).zone,
    "front-zone",
  );
  const fallback = setup({
    models: [{ ...model(), zoneActors: [null, null, null] }],
  }).primitives;
  const object = {};
  assert.equal(
    fallback.region({ model: "model", point: [20, 0, 0], defaultZone: object })
      .zone,
    object,
  );
});

test("real collector adopts terrain after real BSP miss, with native shortening", () => {
  const p = setup().primitives,
    q = query(p);
  const before = structuredClone(q.level);
  const r = collectLevelHits(q);
  assert.equal(r.status, "ready");
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].actor, "terrain");
  assert.equal(r.hits[0].material, null);
  assert.equal(Object.hasOwn(r.hits[0], "item"), false);
  assert.equal(Object.hasOwn(r.hits[0], "nodeIndex"), false);
  assert.ok(r.scale < 1);
  assert.notDeepEqual(r.end, q.end);
  assert.deepEqual(q.level, before);
});

test("real Time=1 BSP writes survive into subsequent real terrain adoption", () => {
  const p = setup({
    terrains: [{ identity: "terrain", source: terrain((x) => 95 - x) }],
  }).primitives;
  const q = query(p, {
    start: [100, 30, 0],
    end: [91, 30, 0],
    extent: [80, 1, 1],
  });
  // Use Y=0 only for the authored BSP box; expand its Y hull to include30.
  const src = box();
  src.nodes[2].plane[3] = src.nodes[3].plane[3] = 50;
  src.leafHulls[8] = word(-50);
  src.leafHulls[11] = word(50);
  q.primitives = setup({
    models: [model("model", src)],
    terrains: [{ identity: "terrain", source: terrain((x) => 95 - x) }],
  }).primitives;
  const bsp = q.primitives.bsp(
    bspCall({ ...q, participant: "model", owner: null, extraNodeFlags: 0 }),
  );
  assert.equal(bsp.blocked, false);
  assert.equal(bsp.writes.time, 1);
  const r = collectLevelHits(q);
  assert.equal(r.status, "ready");
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].actor, "terrain");
  assert.equal(r.hits[0].item, "model");
  assert.equal(Object.hasOwn(r.hits[0], "nodeIndex"), false);
});

test("real PointRegion rejection preserves the original endpoint for following terrain", () => {
  const src = {
    rootOutside: 1,
    nodes: [{ ...node([0, 0, 1, 10]), collisionBound: -1 }],
    leafHulls: [],
  };
  const low = terrain(),
    high = terrain(() => 20);
  const p = setup({
    models: [model("model", src)],
    terrains: [
      { identity: "high", source: high },
      { identity: "low", source: low },
    ],
  }).primitives;
  const q = query(p, { callerLevel: null });
  q.level.zones[0] = {
    identity: "back-zone",
    flags3d8: 4,
    terrains: ["high", "low"],
  };
  const observed = [],
    wrapped = {
      ...p,
      terrain: (args) => {
        observed.push(args);
        return p.terrain(args);
      },
    };
  const r = collectLevelHits({ ...q, primitives: wrapped });
  assert.equal(r.status, "ready");
  assert.deepEqual(
    r.hits.map((h) => h.actor),
    ["low"],
  );
  assert.deepEqual(observed[1].end, q.end);
  assert.equal(observed[1].initialResult.actor, "high");
  assert.equal(
    observed[1].initialResult.time,
    traceTerrainSweep(high, q.start, q.end, q.extent).hit.time,
  );
});

test("actual actor-hash callback is forwarded after geometry and missing provider cannot clear", () => {
  const calls = [];
  const p = setup({
    actorHash: (args) => {
      calls.push(args);
      return { status: "ready", hits: [] };
    },
  }).primitives;
  const q = query(p, { flags: 5 });
  q.level.actorHash = { actual: true };
  assert.equal(collectLevelHits(q).status, "ready");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].hash, q.level.actorHash);
  assert.equal(calls[0].sourceActor, null);
  assert.equal(calls[0].extra, 0);
  assert.notDeepEqual(calls[0].end, q.end);
  assert.equal(
    collectLevelHits({ ...q, primitives: setup().primitives }).status,
    "unsupported",
  );
});

test("missing source associations reject a collector query after a real primitive result", () => {
  const p = setup().primitives,
    q = query(p);
  q.level.model = "missing-region-model";
  assert.equal(collectLevelHits(q).status, "unsupported");
  q.level.model = "model";
  q.level.zones[0].terrains.push("missing-terrain");
  assert.equal(collectLevelHits(q).status, "unsupported");
});

test("actor callback still runs after capacity; a later unknown provider result rejects", () => {
  const calls = [],
    first = {},
    later = {};
  const p = prepareLevelSweepAdapters({
    models: [],
    terrains: [],
    actorHash: (args) => {
      calls.push(args.hash);
      return args.hash === first
        ? {
            status: "ready",
            hits: Array.from({ length: 64 }, (_, i) => ({
              actor: i + 1,
              time: 0.5,
            })),
          }
        : { status: "unsupported", reason: "unknown later hash" };
    },
  }).primitives;
  const q = query(p, {
    flags: 1,
    callerLevel: null,
    attachedLevelsEnabled: true,
    attachedLevels: [{ identity: "attached", model: null, actorHash: later }],
  });
  q.level.actorHash = first;
  assert.equal(collectLevelHits(q).status, "unsupported");
  assert.deepEqual(calls, [first, later]);
});

test("prepared associations preserve opaque identity and own geometry snapshots", () => {
  const id = {},
    src = box(),
    land = terrain(),
    m = model(id, src),
    t = { identity: {}, source: land };
  const input = { models: [m], terrains: [t] },
    prepared = prepareLevelSweepAdapters(input);
  const call = bspCall({ participant: id }),
    before = prepared.primitives.bsp(call);
  src.nodes[0].plane[3] = 900;
  src.leafHulls.length = 0;
  m.zoneActors[1] = "changed";
  input.models.length = 0;
  land.visibility.fill(false);
  assert.deepEqual(prepared.primitives.bsp(call), before);
  assert.equal(before.writes.item, id);
  assert.equal(
    prepared.primitives.region({
      model: id,
      point: [0, 0, 0],
      defaultZone: "caller",
    }).zone,
    "back-zone",
  );
  assert.equal(
    prepared.primitives.terrain(terrainCall({ participant: t.identity }))
      .blocked,
    true,
  );
});
