import assert from "node:assert/strict";
import test from "node:test";
import {
  applyActorBooleanTags,
  collectLevelActorAssignments,
} from "../js/actor-loading.js";

function booleanFixture() {
  return {
    archive: { loading: true, saving: false, persistent: true },
    layout: [
      {
        offset: "0x64",
        mask: 15,
        fields: [
          { name: "ordinary", mask: 1, propertyFlags: 0 },
          { name: "native", mask: 2, propertyFlags: 0x1000 },
          { name: "transient", mask: 4, propertyFlags: 0x2000 },
          { name: "saveExcluded", mask: 8, propertyFlags: 0x20000000 },
        ],
      },
    ],
    words: { "0x64": { mask: 0xfffffff0, value: 0xa5a5a5a0 } },
    tags: ["ordinary", "native", "transient", "saveExcluded"].map((name) => ({
      name,
      value: true,
    })),
  };
}

test("persistent Boolean loading retains unknown bits and skips native/transient tags", () => {
  const input = booleanFixture();
  const before = structuredClone(input);
  const result = applyActorBooleanTags(input);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.groups, {
    "0x64": { mask: 0xfffffff9, value: 0xa5a5a5a9 },
  });
  assert.deepEqual(result.skipped, [1, 2]);
  assert.deepEqual(input, before);
  assert.ok(Object.isFrozen(result.groups["0x64"]));
  assert.ok(Object.isFrozen(result.groups) && Object.isFrozen(result.skipped));
});

test("nonpersistent and saving modes keep their separate source gates", () => {
  const input = booleanFixture();
  input.archive.persistent = false;
  input.archive.saving = true;
  const result = applyActorBooleanTags(input);
  assert.deepEqual(result.skipped, [1, 3]);
  assert.deepEqual(result.groups["0x64"], {
    mask: 0xfffffff5,
    value: 0xa5a5a5a5,
  });
  input.archive.loading = false;
  assert.deepEqual(applyActorBooleanTags(input).groups, input.words);
});

test("repeated admitted tags preserve order, including the high Boolean bit", () => {
  const input = booleanFixture();
  input.layout = [
    {
      offset: "0x64",
      mask: 0x80000000,
      fields: [{ name: "high", mask: 0x80000000, propertyFlags: 0 }],
    },
  ];
  input.words["0x64"] = { mask: 0x7fffffff, value: 0x12345678 };
  input.tags = [
    { name: "high", value: true },
    { name: "high", value: false },
  ];
  assert.deepEqual(applyActorBooleanTags(input).groups["0x64"], {
    mask: 0xffffffff,
    value: 0x12345678,
  });
  input.tags.reverse();
  assert.deepEqual(applyActorBooleanTags(input).groups["0x64"], {
    mask: 0xffffffff,
    value: 0x92345678,
  });
});

test("invalid Boolean inputs never expose partial writes", () => {
  for (const corrupt of [
    (input) => {
      input.layout[0].offset = "0x064";
    },
    (input) => {
      input.layout[0].offset = "0x65";
    },
    (input) => {
      delete input.archive.loading;
    },
    (input) => {
      input.archive.persistent = 1;
    },
    (input) => {
      input.tags.push({ name: "unknown", value: true });
    },
    (input) => {
      input.tags.push({ name: "ordinary", value: 1 });
    },
    (input) => {
      input.layout[0].fields[1].mask = 1;
    },
    (input) => {
      input.layout[0].fields[1].mask = 3;
    },
    (input) => {
      input.layout[0].fields[1].propertyFlags = -1;
    },
    (input) => {
      input.words["0x64"].value |= 1;
    },
    (input) => {
      delete input.tags[1];
    },
    (input) => {
      input.layout[0].mask = 0;
    },
  ]) {
    const input = booleanFixture();
    corrupt(input);
    const result = applyActorBooleanTags(input);
    assert.equal(result.status, "unsupported");
    assert.equal(result.groups, undefined);
  }
});

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
