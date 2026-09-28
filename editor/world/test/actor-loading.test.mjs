import assert from "node:assert/strict";
import test from "node:test";
import { collectLevelActorAssignments } from "../js/actor-loading.js";

function fixture() {
  return {
    level: { identity: "level", outerIdentity: "map" },
    actorClass: "Actor",
    playerControllerClass: "PlayerController",
    classParents: new Map([
      ["StaticMeshActor", "Actor"],
      ["PlayerController", "Controller"],
      ["Controller", "Actor"],
      ["Actor", "Object"],
      ["Object", null],
      ["Other", "Object"],
      ["CustomController", "PlayerController"],
    ]),
    objects: new Map([
      [
        "prop",
        {
          classIdentity: "StaticMeshActor",
          outerIdentity: "map",
          collisionTag: 123,
        },
      ],
      ["foreign", { classIdentity: "StaticMeshActor", outerIdentity: "other" }],
      ["other", { classIdentity: "Other" }],
      [
        "controller",
        {
          classIdentity: "PlayerController",
          outerIdentity: "map",
          playerControllerFlags5ac: 0,
        },
      ],
      [
        "excluded",
        {
          classIdentity: "CustomController",
          outerIdentity: "map",
          playerControllerFlags5ac: 0x80000100,
        },
      ],
      ["classless", { classIdentity: null }],
    ]),
    registry: [
      "prop",
      null,
      "foreign",
      "other",
      "controller",
      "excluded",
      "prop",
    ],
    buffer: ["excluded", "classless", null, "controller", "prop"],
  };
}

test("both source lists retain call order and repeated identities with only the two recovered writes", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = collectLevelActorAssignments(input);
  assert.equal(result.status, "ready");
  assert.deepEqual(
    result.assignments.map(({ source, index, identity }) => [
      source,
      index,
      identity,
    ]),
    [
      ["registry", 0, "prop"],
      ["registry", 4, "controller"],
      ["registry", 6, "prop"],
      ["buffer", 3, "controller"],
      ["buffer", 4, "prop"],
    ],
  );
  for (const item of result.assignments) {
    assert.deepEqual(item.writes, { xLevelIdentity: "level", collisionTag: 0 });
    assert.ok(Object.isFrozen(item) && Object.isFrozen(item.writes));
  }
  assert.ok(Object.isFrozen(result.assignments));
  assert.deepEqual(input, before);
});

test("only PlayerController mask0x100 excludes an otherwise matching actor", () => {
  for (const flags of [0, 1, 0x100, 0x200, 0xfffffeff, 0xffffffff]) {
    const input = fixture();
    input.registry = ["controller"];
    input.buffer = [];
    input.objects.get("controller").playerControllerFlags5ac = flags;
    const result = collectLevelActorAssignments(input);
    assert.equal(result.status, "ready");
    assert.equal(result.assignments.length, flags & 0x100 ? 0 : 1);
  }
});

test("unconsumed controller flags and outer identities are never required", () => {
  const input = fixture();
  input.registry = ["other", "foreign", "prop"];
  input.buffer = [];
  input.objects.get("foreign").classIdentity = "PlayerController";
  assert.equal(collectLevelActorAssignments(input).status, "ready");
  input.registry = [];
  input.level = { identity: "empty-level" };
  assert.equal(collectLevelActorAssignments(input).status, "ready");
});

test("explicit null outers compare equally but undefined never becomes null", () => {
  const input = fixture();
  input.registry = ["prop"];
  input.buffer = [];
  input.level.outerIdentity = null;
  input.objects.get("prop").outerIdentity = null;
  assert.equal(collectLevelActorAssignments(input).assignments.length, 1);
  delete input.objects.get("prop").outerIdentity;
  assert.equal(collectLevelActorAssignments(input).status, "unsupported");
});

test("unknown or cyclic ancestry stays unresolved, with previously recovered writes retained", () => {
  for (const change of [
    (input) => input.classParents.delete("Other"),
    (input) => input.classParents.set("Other", "Other"),
    (input) => (input.objects.get("other").classIdentity = undefined),
  ]) {
    const input = fixture();
    input.registry = ["prop", "other"];
    input.buffer = [];
    change(input);
    const result = collectLevelActorAssignments(input);
    assert.equal(result.status, "unsupported");
    assert.equal(result.assignments.length, 1);
  }
});

test("missing lists, slots, records and consumed flags are rejected", () => {
  for (const change of [
    (input) => delete input.registry,
    (input) => (input.registry = new Array(2)),
    (input) => (input.registry = [undefined]),
    (input) => input.objects.delete("prop"),
    (input) => delete input.objects.get("controller").playerControllerFlags5ac,
    (input) => (input.objects.get("controller").playerControllerFlags5ac = -1),
    (input) => (input.actorClass = input.playerControllerClass),
  ]) {
    const input = fixture();
    change(input);
    assert.equal(collectLevelActorAssignments(input).status, "unsupported");
  }
  assert.equal(collectLevelActorAssignments().status, "unsupported");
});
