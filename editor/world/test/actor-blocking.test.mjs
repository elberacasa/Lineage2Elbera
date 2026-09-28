// Synthetic state only. The separate native checker supplies original evidence.
import test from "node:test";
import assert from "node:assert/strict";
import {
  actorIsBlockedBy,
  isActorBasedOn,
  isActorBrush,
  isActorEncroacher,
  selectMoveActorBlockingHit,
} from "../js/actor-blocking.js";

const actor = (identity, fields = {}) => ({
  identity,
  bits74: 0,
  collisionBits: 0,
  primitive38: null,
  primitive278: null,
  physicsByte34: 0,
  ...fields,
});
const generic = { getPlayerPawn: () => null, isAProjectile: () => false };
const value = (result) => {
  assert.equal(result.status, "ready", result.reason);
  return result.value;
};

test("base traversal includes self, follows Base and preserves direction", () => {
  const bases = new Map([
    ["child", "parent"],
    ["parent", "root"],
    ["root", null],
  ]);
  const based = (a, b) =>
    isActorBasedOn({ actor: a, base: b, baseOf: (id) => bases.get(id) });
  assert.equal(value(based("child", "root")), 1);
  assert.equal(value(based("root", "child")), 0);
  assert.equal(value(based("root", null)), 0);
  assert.equal(value(isActorBasedOn({ actor: null, base: null })), 0);
  assert.equal(value(isActorBasedOn({ actor: "self", base: "self" })), 1);
});

test("unknown and cyclic consumed base links stay unsupported", () => {
  assert.equal(isActorBasedOn({ actor: "a", base: "b" }).status, "unsupported");
  assert.equal(
    isActorBasedOn({ actor: "a", base: "b", baseOf: () => undefined }).status,
    "unsupported",
  );
  assert.equal(
    isActorBasedOn({ actor: "a", base: "b", baseOf: () => "a" }).status,
    "unsupported",
  );
});

test("the early bits74 branch reads only the mover's consumed flag", () => {
  assert.equal(
    value(
      actorIsBlockedBy({ actor: { collisionBits: 2 }, other: { bits74: 2 } }),
    ),
    1,
  );
  assert.equal(
    value(
      actorIsBlockedBy({ actor: { collisionBits: 4 }, other: { bits74: 2 } }),
    ),
    0,
  );
});

test("brush and encroacher helpers retain source gates and conditional dispatch", () => {
  assert.equal(value(isActorBrush({ actor: { primitive278: null } })), 0);
  assert.equal(value(isActorEncroacher({ actor: { collisionBits: 0 } })), 0);
  const calls = [];
  const a = actor("a", {
    primitive278: "brush",
    primitive38: "primitive",
    collisionBits: 1,
  });
  const helpers = {
    isABrush: (id) => {
      calls.push(["brush", id]);
      return 0xffffffff;
    },
    isAMover: (id) => {
      calls.push(["mover", id]);
      return 0x80000000;
    },
  };
  assert.equal(value(isActorBrush({ actor: a, helpers })), 1);
  delete a.physicsByte34;
  assert.equal(value(isActorEncroacher({ actor: a, helpers })), 1);
  assert.deepEqual(calls, [
    ["brush", "a"],
    ["mover", "a"],
  ]);
});

test("physics bytes 13 and 14 retain their distinct class-predicate behavior", () => {
  const a = actor("a", { collisionBits: 1, physicsByte34: 14 });
  assert.equal(value(isActorEncroacher({ actor: a })), 1);
  a.physicsByte34 = 13;
  assert.equal(isActorEncroacher({ actor: a }).status, "unsupported");
  assert.equal(
    value(
      isActorEncroacher({ actor: a, helpers: { isKConstraint: () => false } }),
    ),
    1,
  );
  assert.equal(
    value(
      isActorEncroacher({ actor: a, helpers: { isKConstraint: () => true } }),
    ),
    0,
  );
  a.physicsByte34 = 12;
  assert.equal(value(isActorEncroacher({ actor: a })), 0);
  a.physicsByte34 = 256;
  assert.equal(isActorEncroacher({ actor: a }).status, "unsupported");
});

test("either encroacher can trigger the counterpart's bits74 exclusion", () => {
  const enc = actor("enc", { collisionBits: 1, physicsByte34: 14 });
  const excluded = actor("excluded", { bits74: 0x40 });
  assert.equal(value(actorIsBlockedBy({ actor: enc, other: excluded })), 0);
  assert.equal(value(actorIsBlockedBy({ actor: excluded, other: enc })), 0);
});

test("ordinary actors require both directional blocking bits", () => {
  const a = actor("a", { collisionBits: 4 }),
    b = actor("b", { collisionBits: 4 });
  assert.equal(
    value(actorIsBlockedBy({ actor: a, other: b, helpers: generic })),
    1,
  );
  a.collisionBits = 0;
  assert.equal(
    value(actorIsBlockedBy({ actor: a, other: b, helpers: generic })),
    0,
  );
  a.collisionBits = 4;
  b.collisionBits = 0;
  assert.equal(
    value(actorIsBlockedBy({ actor: a, other: b, helpers: generic })),
    0,
  );
});

test("player and projectile classification select bit 3 and short-circuit calls", () => {
  const a = actor("a", { collisionBits: 4 }),
    b = actor("b", { collisionBits: 8 });
  const calls = [];
  const helpers = {
    getPlayerPawn: (id) => {
      calls.push(["player", id]);
      return id === "a" ? "pawn" : null;
    },
    isAProjectile: (id) => {
      calls.push(["projectile", id]);
      return false;
    },
  };
  assert.equal(value(actorIsBlockedBy({ actor: a, other: b, helpers })), 1);
  assert.deepEqual(calls, [
    ["player", "a"],
    ["player", "b"],
    ["projectile", "b"],
  ]);
  assert.equal(
    value(
      actorIsBlockedBy({
        actor: a,
        other: b,
        helpers: {
          getPlayerPawn: () => null,
          isAProjectile: (id) => id === "a",
        },
      }),
    ),
    1,
  );
});

test("brush branches use counterpart bit 1 and omit projectile classification", () => {
  const brush = actor("brush", { primitive278: "primitive", collisionBits: 4 });
  const other = actor("other", { collisionBits: 2 });
  const helpers = { isABrush: () => true, getPlayerPawn: () => null };
  assert.equal(
    value(actorIsBlockedBy({ actor: other, other: brush, helpers })),
    1,
  );
  assert.equal(value(actorIsBlockedBy({ actor: brush, other, helpers })), 1);
  other.collisionBits = 0;
  assert.equal(value(actorIsBlockedBy({ actor: brush, other, helpers })), 0);
});

test("repeated source class calls are not cached", () => {
  const calls = [],
    answers = [1, 0];
  const a = actor("a", { collisionBits: 2 });
  const b = actor("b", { collisionBits: 5, physicsByte34: 13 });
  const result = actorIsBlockedBy({
    actor: a,
    other: b,
    helpers: {
      isKConstraint: (id) => {
        calls.push(["constraint", id]);
        return answers.shift();
      },
      getPlayerPawn: (id) => {
        calls.push(["player", id]);
        return null;
      },
    },
  });
  assert.equal(value(result), 1);
  assert.deepEqual(calls, [
    ["constraint", "b"],
    ["constraint", "b"],
    ["player", "a"],
  ]);
});

test("brush-branch collision flags are read after the player callback", () => {
  for (const swapped of [false, true]) {
    const brush = actor("brush", {
      primitive278: "primitive",
      collisionBits: 4,
    });
    const other = actor("other", { collisionBits: 2 });
    const result = actorIsBlockedBy({
      actor: swapped ? brush : other,
      other: swapped ? other : brush,
      helpers: {
        isABrush: () => true,
        getPlayerPawn: () => {
          brush.collisionBits = 0;
          return null;
        },
      },
    });
    assert.equal(value(result), 0);
  }
});

test("missing consumed state and invalid predicate values stay unknown", () => {
  const a = actor("a", { collisionBits: 4 }),
    b = actor("b", { collisionBits: 4 });
  for (const helpers of [
    {},
    { getPlayerPawn: () => undefined },
    { getPlayerPawn: () => false },
    { getPlayerPawn: () => null, isAProjectile: () => -1 },
  ]) {
    assert.equal(
      actorIsBlockedBy({ actor: a, other: b, helpers }).status,
      "unsupported",
    );
  }
  assert.equal(
    actorIsBlockedBy({ actor: {}, other: {} }).status,
    "unsupported",
  );
  assert.equal(
    actorIsBlockedBy({ actor: { collisionBits: -1 }, other: { bits74: 2 } })
      .status,
    "unsupported",
  );
  assert.throws(
    () =>
      actorIsBlockedBy({
        actor: a,
        other: b,
        helpers: {
          getPlayerPawn: () => {
            throw new Error("provider failure");
          },
        },
      }),
    /provider failure/,
  );
});

test("selection gates do not require unconsumed inputs", () => {
  const skipped = selectMoveActorBlockingHit({ actor: { collisionBits: 1 } });
  assert.equal(skipped.status, "ready");
  assert.equal(skipped.selected, null);
  assert.equal(skipped.passedBaseChecks, false);
  assert.equal(
    selectMoveActorBlockingHit({ actor: { collisionBits: 2 }, hits: [] })
      .status,
    "ready",
  );
});

test("selection checks base relationships in source order and returns the exact first blocking record", () => {
  const hits = Object.freeze([
    Object.freeze({ actor: "parent", time: 0.1 }),
    Object.freeze({ actor: "child", time: 0.2 }),
    Object.freeze({ actor: "nonblock", time: 0.3 }),
    Object.freeze({ actor: "block", time: 0.4, material: "original" }),
    null, // Not consumed after the selected record.
  ]);
  const calls = [];
  const result = selectMoveActorBlockingHit({
    actor: { identity: "mover", collisionBits: 2 },
    hits,
    arg3: 1,
    helpers: {
      isBasedOn: (a, b) => {
        calls.push(["based", a, b]);
        return b === "parent" || a === "child";
      },
      isBlockedBy: (a, b) => {
        calls.push(["blocked", a, b]);
        return b === "block";
      },
    },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.selected, hits[3]);
  assert.equal(result.passedBaseChecks, true);
  assert.deepEqual(calls, [
    ["based", "mover", "parent"],
    ["based", "mover", "child"],
    ["based", "child", "mover"],
    ["based", "mover", "nonblock"],
    ["based", "nonblock", "mover"],
    ["blocked", "mover", "nonblock"],
    ["based", "mover", "block"],
    ["based", "block", "mover"],
    ["blocked", "mover", "block"],
  ]);
});

test("zero arg3 skips only mover-on-candidate exclusion; scan flag survives a nonblocking result", () => {
  const calls = [];
  const result = selectMoveActorBlockingHit({
    actor: { identity: "mover", collisionBits: 2 },
    arg3: 0,
    hits: [{ actor: "candidate" }],
    helpers: {
      isBasedOn: (a, b) => {
        calls.push([a, b]);
        return false;
      },
      isBlockedBy: () => false,
    },
  });
  assert.deepEqual(calls, [["candidate", "mover"]]);
  assert.equal(result.selected, null);
  assert.equal(result.passedBaseChecks, true);
});

test("missing selection providers or actors cannot establish a clear route", () => {
  const input = {
    actor: { identity: "mover", collisionBits: 2 },
    hits: [{ actor: "candidate" }],
    arg3: 0,
  };
  assert.equal(selectMoveActorBlockingHit(input).status, "unsupported");
  assert.equal(
    selectMoveActorBlockingHit({ ...input, hits: null }).status,
    "unsupported",
  );
  assert.equal(
    selectMoveActorBlockingHit({ ...input, hits: [{ actor: null }] }).status,
    "unsupported",
  );
  assert.equal(
    selectMoveActorBlockingHit({ ...input, arg3: undefined }).status,
    "unsupported",
  );
});

test("absent top-level inputs have explicit unsupported results", () => {
  for (const fn of [
    actorIsBlockedBy,
    isActorBasedOn,
    isActorBrush,
    isActorEncroacher,
    selectMoveActorBlockingHit,
  ]) {
    assert.equal(fn().status, "unsupported");
    assert.equal(fn(null).status, "unsupported");
  }
});
