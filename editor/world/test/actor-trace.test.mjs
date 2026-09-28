// Authored component state; these fixtures do not establish live actor defaults.
import test from "node:test";
import assert from "node:assert/strict";
import {
  actorShouldTrace,
  pawnShouldTrace,
  isActorOwnedBy,
} from "../js/actor-blocking.js";
import {
  createActorOctree,
  updateActorOctree,
  queryActorOctree,
} from "../js/actor-octree.js";
import { prepareGenericPrimitiveBounds } from "../js/actor-primitive-bounds.js";
import { traceActorCylinder } from "../js/cylinder-collision.js";

const actor = (fields = {}) => ({
  identity: "candidate",
  levelIdentity: null,
  bits74: 0,
  flags2e4: 0,
  collisionBits: 0,
  primitive38: null,
  primitive104: null,
  drawTypeByte35: 0,
  controllerIdentity: null,
  flags678: 0,
  ...fields,
});
const source = (fields = {}) => ({
  identity: "source",
  bits74: 0,
  flags64: 0,
  ...fields,
});
const value = (r) => {
  assert.equal(r.status, "ready", r.reason);
  return r.value;
};
const loader = { checkLoadingResource: () => 0 };
const ordinary = (fields, flags, extra = {}) =>
  actorShouldTrace({ actor: actor(fields), source: null, flags, ...extra });
const pawn = (fields, flags, extra = {}) =>
  pawnShouldTrace({
    actor: actor(fields),
    source: null,
    flags,
    helpers: loader,
    ...extra,
  });

test("ordinary level and source gates precede trace category selection", () => {
  const calls = [];
  const a = actor({ levelIdentity: "level" });
  assert.equal(
    value(
      actorShouldTrace({
        actor: a,
        flags: 0x100,
        helpers: {
          getLevelInfo: (id) => {
            calls.push(id);
            return "level-info";
          },
        },
      }),
    ),
    0,
  ); // source is not consumed on this branch
  assert.deepEqual(calls, ["level"]);
  assert.equal(
    value(ordinary({}, 0x10, { source: source({ bits74: 0x10 }) })),
    0,
  );
  assert.equal(
    value(
      ordinary({ bits74: 0x10 }, 0x10, {
        source: source(),
        helpers: { isPawn: () => 0 },
      }),
    ),
    0,
  );
  assert.equal(
    value(
      ordinary({ bits74: 0x10 }, 0x10, {
        source: source(),
        helpers: { isPawn: () => 0x80000000 },
      }),
    ),
    1,
  );
});

test("ordinary LevelInfo identity bypasses the first level-specific gate", () => {
  const a = actor({ levelIdentity: "level", flags2e4: 0, bits74: 4 });
  assert.equal(
    value(
      actorShouldTrace({
        actor: a,
        flags: 0x8100,
        source: null,
        helpers: { getLevelInfo: () => a.identity },
      }),
    ),
    1,
  );
  assert.equal(
    value(
      actorShouldTrace({
        actor: a,
        flags: 0x8100,
        helpers: { getLevelInfo: () => "another" },
      }),
    ),
    0,
  );
});

test("ordinary categories preserve priority and original DWORD results", () => {
  assert.equal(value(ordinary({ bits74: 2 }, 0x86)), 128);
  assert.equal(value(ordinary({}, 0x86)), 0);
  assert.equal(value(ordinary({}, 0x10)), 1);
  assert.equal(value(ordinary({ flags2e4: 2 }, 0x100)), 1);
  assert.equal(value(ordinary({ bits74: 4 }, 0x8000)), 1);
  assert.equal(
    value(ordinary({ bits74: 0, primitive38: "p", drawTypeByte35: 8 }, 0xa000)),
    0,
  );
  assert.equal(
    value(ordinary({ primitive38: "p", drawTypeByte35: 8 }, 0x2100)),
    1,
  );
  assert.equal(
    value(ordinary({ primitive104: "p", drawTypeByte35: 2 }, 0x2000)),
    1,
  );
});

test("ordinary dynamic flags retain projectile/blocking precedence and direction", () => {
  for (const [collisionBits, result] of [
    [0, 0],
    [4, 0],
    [8, 0],
    [12, 1],
    [16, 1],
  ])
    assert.equal(value(ordinary({ collisionBits }, 0x30)), result);
  const calls = [];
  assert.equal(
    value(
      ordinary({}, 0x50, {
        source: source(),
        helpers: {
          isBlockedBy: (a, b) => {
            calls.push([a, b]);
            return 128;
          },
        },
      }),
    ),
    1,
  );
  assert.deepEqual(calls, [["source", "candidate"]]);
  assert.equal(value(ordinary({}, 0x50)), 0);
  assert.equal(value(ordinary({ collisionBits: 12 }, 0x70)), 1); // no blocking helper consumed
});

test("pawn self and controller rejection precede flags and loading", () => {
  assert.equal(
    value(
      pawnShouldTrace({
        actor: { identity: "same" },
        source: { identity: "same" },
      }),
    ),
    0,
  );
  assert.equal(
    value(
      pawnShouldTrace({
        actor: { identity: "a", controllerIdentity: "s" },
        source: { identity: "s" },
      }),
    ),
    0,
  );
  assert.equal(
    value(
      pawn({ controllerIdentity: "controller" }, 1, {
        helpers: {
          readController: (id) => {
            assert.equal(id, "controller");
            return { flags41c: 1 };
          },
        },
      }),
    ),
    0,
  );
  assert.equal(value(pawn({ controllerIdentity: "controller" }, 0x10001)), 1);
});

test("pawn source gate precedes the resource-loader call", () => {
  assert.equal(
    value(
      pawn({ flags678: 8 }, 1, { source: source({ flags64: 2 }), helpers: {} }),
    ),
    0,
  );
  const calls = [];
  assert.equal(
    value(
      pawn({}, 1, {
        helpers: {
          checkLoadingResource: (...args) => {
            calls.push(args);
            return 128;
          },
        },
      }),
    ),
    0,
  );
  assert.deepEqual(calls, [["candidate", 1]]);
});

test("pawn reads flags after loading and applies class filtering before categories", () => {
  const a = actor({ flags678: 0 });
  assert.equal(
    value(
      pawnShouldTrace({
        actor: a,
        source: null,
        flags: 0x86,
        helpers: {
          checkLoadingResource: () => {
            a.flags678 = 2;
            return 0;
          },
        },
      }),
    ),
    0x86,
  );
  assert.equal(
    value(
      pawn({ bits74: 0x14 }, 0x8000, {
        source: source(),
        helpers: { ...loader, isPawn: () => 0 },
      }),
    ),
    0,
  );
  assert.equal(
    value(
      pawn({ bits74: 0x14 }, 0x8000, {
        source: source(),
        helpers: { ...loader, isPawn: () => 1 },
      }),
    ),
    1,
  );
});

test("pawn world-category branch and draw-type exception differ from ordinary actors", () => {
  assert.equal(value(pawn({}, 0x86)), 0);
  assert.equal(value(pawn({ flags678: 2 }, 0x86)), 0x86);
  assert.equal(value(pawn({ flags678: 2 }, 1)), 0);
  assert.equal(value(pawn({}, 1)), 1);
  assert.equal(value(pawn({ primitive38: "p", drawTypeByte35: 8 }, 0x2000)), 1);
  assert.equal(
    value(pawn({ primitive104: "p", drawTypeByte35: 2 }, 0x2000)),
    0,
  );
  assert.equal(value(pawn({ primitive38: "p", drawTypeByte35: 8 }, 0x2100)), 0);
});

test("missing consumed state never becomes a false result or an assumed category", () => {
  for (const r of [
    actorShouldTrace(),
    pawnShouldTrace(),
    ordinary({}, 0x10, { source: undefined }),
    ordinary({ levelIdentity: "level" }, 1),
    ordinary({ levelIdentity: "level" }, 1, {
      helpers: { getLevelInfo: () => null },
    }),
    pawn({}, 1, { helpers: {} }),
    pawn({ controllerIdentity: "c" }, 1),
    pawn({ flags678: undefined }, 1),
    pawn({}, -1),
    pawn({}, 2 ** 32),
    ordinary({ primitive38: "p", drawTypeByte35: 256 }, 0x2000),
    pawn({}, 1, { helpers: { checkLoadingResource: () => undefined } }),
  ])
    assert.equal(r.status, "unsupported");
});

test("unconsumed pawn source fields are not replaced by generic actor gates", () => {
  assert.equal(
    value(pawn({}, 1, { source: { identity: "source", flags64: 0 } })),
    1,
  );
  assert.equal(value(pawn({ flags678: undefined }, 0x8000)), 0);
  assert.equal(value(ordinary({ collisionBits: undefined }, 0x10)), 1);
});

function queryFixture() {
  const profile = { arithmeticProfile: "pc53-rne" };
  const { tree } = createActorOctree({
    ...profile,
    volume: { center: [0, 0, 0], halfExtent: 360448 },
  });
  const actors = new Map([
    ["front", actor({ identity: "front", location: [-10, 0, 0] })],
    ["back", actor({ identity: "back", location: [10, 0, 0] })],
  ]);
  for (const a of actors.values()) {
    Object.assign(a, {
      flags2f8: 0x41,
      tag1b0: 0,
      skins: [],
      collisionRadius: 3,
      collisionHeight: 6,
    });
    const admitted = updateActorOctree(tree, {
      ...a,
      flags64: 0,
      flags74: 0,
      level: null,
      getPrimitive: () => ({ status: "ready", primitiveIdentity: a.identity }),
      getPrimitiveBounds: () =>
        prepareGenericPrimitiveBounds({ ...profile, ...a }),
    });
    assert.equal(admitted.status, "ready", admitted.reason);
    Object.assign(a, admitted.writes);
  }
  const lines = [];
  const input = {
    start: [-30, 0, 0],
    end: [30, 0, 0],
    extent: [1, 1, 1],
    flags: 0x401,
    extra: 0,
    sourceActor: null,
    currentTag: 0,
    maskedZeroDivision: true,
    readActor: (id) => ({ status: "ready", actor: actors.get(id) }),
    isOwnedBy: (a, b) =>
      isActorOwnedBy({ actor: a, owner: b, ownerOf: () => null }),
    shouldTrace: (id, sourceActor, flags) => {
      assert.equal(sourceActor, null);
      return pawnShouldTrace({
        actor: actors.get(id),
        source: null,
        flags,
        helpers: loader,
      });
    },
    getPrimitive: (id) => ({ status: "ready", primitiveIdentity: id }),
    lineCheck: (id, request) => {
      lines.push(id);
      const r = traceActorCylinder({ ...request, actor: actors.get(id) });
      return { ...r, writes: r.result };
    },
  };
  return { tree, actors, input, lines };
}

test("actual tree filtering joins native cylinder bounds and hits across successive queries", () => {
  const { tree, actors, input, lines } = queryFixture();
  let r = queryActorOctree(tree, input);
  assert.equal(r.status, "ready", r.reason);
  assert.deepEqual(
    r.hits.map((h) => h.actor),
    ["front"],
  );
  assert.deepEqual(lines, ["front", "back"]);
  for (const w of r.writes.actorTags) actors.get(w.identity).tag1b0 = w.tag1b0;
  actors.get("front").controllerIdentity = "controller";
  lines.length = 0;
  r = queryActorOctree(tree, {
    ...input,
    currentTag: r.writes.currentTag,
    shouldTrace: (id, sourceActor, flags) =>
      pawnShouldTrace({
        actor: actors.get(id),
        source: null,
        flags,
        helpers: { ...loader, readController: () => ({ flags41c: 1 }) },
      }),
  });
  assert.equal(r.status, "ready", r.reason);
  assert.deepEqual(
    r.hits.map((h) => h.actor),
    ["back"],
  );
  assert.deepEqual(lines, ["back"]);
  assert.deepEqual(r.writes.actorTags, [
    { identity: "front", tag1b0: 2 },
    { identity: "back", tag1b0: 2 },
  ]);
});

test("actual tree cannot call unknown resource loading a clear collision query", () => {
  const { tree, actors, input, lines } = queryFixture();
  const r = queryActorOctree(tree, {
    ...input,
    shouldTrace: (id, sourceActor, flags) =>
      pawnShouldTrace({ actor: actors.get(id), source: null, flags }),
  });
  assert.equal(r.status, "unsupported");
  assert.deepEqual(lines, []);
  assert.deepEqual(r.writes.actorTags, [{ identity: "front", tag1b0: 1 }]);
});
