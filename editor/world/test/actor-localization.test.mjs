import assert from "node:assert/strict";
import test from "node:test";
import {
  actorLocalizationContext,
  localizeOptionalText,
  loadActorLocalized,
  importStringPropertyText,
} from "../js/actor-localization.js";

const freeze = (value) => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const field = (identity, changes = {}) => ({
  identity,
  name: identity,
  isProperty: true,
  arrayDim: 1,
  elementSize: 12,
  offset: 0,
  propertyFlags: 0x8000,
  struct: null,
  ...changes,
});
const fixture = (fields = [field("Caption")]) => ({
  object: {
    index: 1,
    flags: 0,
    name: "Placed",
    outer: { name: "Map", outer: null },
  },
  classInfo: {
    flags: 0x32,
    name: "Class",
    outer: { name: "Engine" },
    structure: freeze({ fields, super: null }),
  },
  isEditor: false,
  environment: {
    started: true,
    language: "es",
    readConfig: () => ({ status: "ready", found: true, value: "text" }),
  },
  importText: () => ({ status: "ready" }),
});

test("class/editor gates consume no object or localization providers", () => {
  assert.deepEqual(loadActorLocalized({ classInfo: { flags: 0 } }), {
    status: "ready",
    context: { status: "ready", skipped: true },
    imports: [],
  });
  assert.equal(
    loadActorLocalized({ classInfo: { flags: 0x20 }, isEditor: true }).status,
    "ready",
  );
  assert.equal(
    loadActorLocalized({ classInfo: { flags: 0x20 } }).status,
    "unsupported",
  );
});

test("class defaults, ordinary instances and nested flagged objects select distinct names", () => {
  const row = fixture();
  const context = () => actorLocalizationContext(row);
  assert.equal(context().packageName, "Map");
  row.object.index = -1;
  assert.deepEqual(context(), {
    status: "ready",
    skipped: false,
    packageName: "Engine",
    section: "Class",
    prefix: null,
  });
  row.object.index = 1;
  row.object.flags = 0x100;
  row.object.outer.outer = { name: "OuterPackage" };
  row.object.name = "";
  assert.deepEqual(context(), {
    status: "ready",
    skipped: false,
    packageName: "OuterPackage",
    section: "Map",
    prefix: "",
  });
  assert.equal(loadActorLocalized(row).imports[0].text, "text");
  delete row.object.outer.outer;
  assert.equal(context().status, "unsupported");
});

test("optional lookup distinguishes absent, unknown, missing and empty configuration", () => {
  const args = { section: "Section", key: "Key", packageName: "Package" };
  for (const environment of [
    { started: false },
    { started: true, readConfig: null },
  ])
    assert.deepEqual(localizeOptionalText({ ...args, environment }), {
      status: "ready",
      value: "Key",
    });
  assert.equal(
    localizeOptionalText({ ...args, environment: { started: true } }).status,
    "unsupported",
  );
  const calls = [];
  const environment = {
    started: true,
    language: "es",
    readConfig: (call) => {
      calls.push(call);
      return {
        status: "ready",
        found: false,
        value: calls.length === 1 ? "partial" : null,
      };
    },
  };
  assert.equal(localizeOptionalText({ ...args, environment }).value, "partial");
  assert.deepEqual(
    calls.map((call) => call.filename),
    ["Package.es", "Package.int"],
  );
  calls.length = 0;
  environment.readConfig = (call) => {
    calls.push(call);
    return { status: "ready", found: true, value: "" };
  };
  assert.equal(localizeOptionalText({ ...args, environment }).value, "");
  assert.equal(calls.length, 1);
});

test("English language matching is case insensitive without changing the first filename", () => {
  const row = fixture(),
    calls = [];
  row.environment.language = "INT";
  row.environment.readConfig = (call) => {
    calls.push(call);
    return { status: "ready", found: false, value: null };
  };
  assert.equal(loadActorLocalized(row).imports.length, 0);
  assert.deepEqual(
    calls.map((call) => call.filename),
    ["Map.INT"],
  );
});

test("unmarked structures recurse; filtered fields and nonpositive dimensions are skipped", () => {
  const row = fixture([
      { isProperty: false },
      field("Negative", { arrayDim: -1 }),
      field("Zero", { arrayDim: 0 }),
      field("Nest", {
        offset: 20,
        propertyFlags: 0,
        arrayDim: 2,
        elementSize: 40,
        struct: { fields: [field("Child", { offset: 4 })], super: null },
      }),
    ]),
    calls = [];
  row.environment.readConfig = (call) => {
    calls.push(call);
    return { status: "ready", found: true, value: call.key };
  };
  const result = loadActorLocalized(row);
  assert.equal(result.status, "ready");
  assert.deepEqual(
    result.imports.map(({ offset, text, portFlags }) => [
      offset,
      text,
      portFlags,
    ]),
    [
      [24, "Nest[0].Child", 0],
      [64, "Nest[1].Child", 0],
    ],
  );
});

test("earlier imports remain reported when a later provider is unavailable", () => {
  const row = fixture([
    field("First"),
    field("Second", { offset: 12 }),
    field("Later", { offset: 24 }),
  ]);
  row.importText = ({ field }) =>
    field === "Second" ? { status: "unsupported" } : { status: "ready" };
  const result = loadActorLocalized(row);
  assert.equal(result.status, "unsupported");
  assert.deepEqual(
    result.imports.map((call) => call.field),
    ["First", "Second"],
  );
});

test("unknown or mutable linked metadata is not treated as empty", () => {
  for (const structure of [
    undefined,
    { fields: [], super: null },
    freeze({ fields: [] }),
    freeze({ fields: [field("Missing", { struct: undefined })], super: null }),
  ]) {
    const row = fixture();
    row.classInfo.structure = structure;
    assert.equal(loadActorLocalized(row).status, "unsupported");
  }
  const cyclic = { fields: [] };
  cyclic.super = cyclic;
  Object.freeze(cyclic.fields);
  Object.freeze(cyclic);
  const row = fixture();
  row.classInfo.structure = cyclic;
  assert.equal(loadActorLocalized(row).status, "unsupported");
});

test("oversized strings and unknown configuration replies fail before text import", () => {
  for (const reply of [
    undefined,
    { status: "ready", found: false },
    { status: "ready", found: true, value: "a\0b" },
    { status: "ready", found: true, value: "x".repeat(1024) },
  ]) {
    const row = fixture();
    row.environment.readConfig = () => reply;
    assert.equal(loadActorLocalized(row).status, "unsupported");
  }
  const row = fixture([field("x".repeat(1024))]);
  assert.equal(loadActorLocalized(row).status, "unsupported");
});

test("sequential ring reuse works but overwriting an active nested prefix is explicit", () => {
  const sequential = loadActorLocalized(
    fixture([field("Many", { arrayDim: 300 })]),
  );
  assert.equal(sequential.status, "ready");
  assert.equal(sequential.imports.length, 300);
  const nested = loadActorLocalized(
    fixture([
      field("Nest", {
        struct: {
          fields: [field("Many", { arrayDim: 300 })],
          super: null,
        },
      }),
    ]),
  );
  assert.equal(nested.status, "unsupported");
  assert.match(nested.reason, /active prefix/);
  assert.equal(nested.imports.length, 127);
});

test("configuration and text import failures preserve a useful unsupported result", () => {
  for (const provider of ["readConfig", "importText"]) {
    const row = fixture();
    if (provider === "readConfig")
      row.environment.readConfig = () => {
        throw Error("failed");
      };
    else
      row.importText = () => {
        throw Error("failed");
      };
    assert.equal(loadActorLocalized(row).status, "unsupported");
  }
});

test("string ImportText preserves literal text and UTF-16 units through the first terminator", () => {
  for (const [text, value] of [
    ['  "quoted" \\ literal  ', '  "quoted" \\ literal  '],
    ["Café / 水 / 🌊", "Café / 水 / 🌊"],
    ["first\0ignored", "first"],
    ["\0ignored", ""],
    ["", ""],
    ["\ud800", "\ud800"],
    ["\udfff", "\udfff"],
  ]) {
    for (const portFlags of [0, 1, 4, 0xfffffffd]) {
      const storage = new Map([
        [16, "old"],
        [28, "neighbor"],
      ]);
      assert.deepEqual(
        importStringPropertyText({
          storage,
          offset: 16,
          text,
          portFlags,
          propertyKind: "StrProperty",
        }),
        { status: "ready", value },
      );
      assert.deepEqual(
        [...storage],
        [
          [16, value],
          [28, "neighbor"],
        ],
      );
    }
  }
});

test("unsupported string dispatch, quoted mode and missing storage leave values intact", () => {
  const storage = new Map([[16, "old"]]);
  const valid = {
    storage,
    offset: 16,
    text: "new",
    portFlags: 0,
    propertyKind: "StrProperty",
  };
  for (const changes of [
    { propertyKind: "IntProperty" },
    { propertyKind: undefined },
    { portFlags: 2 },
    { portFlags: 3 },
    { portFlags: -1 },
    { offset: 17 },
    { text: undefined },
    { storage: new Map([[16, undefined]]) },
    {
      storage: new Map([
        [16, "old"],
        [20, "overlap"],
      ]),
    },
    {
      storage: new Map([
        [16, "old"],
        ["unknown", "unresolved"],
      ]),
    },
  ]) {
    assert.equal(
      importStringPropertyText({ ...valid, ...changes }).status,
      "unsupported",
    );
    assert.equal(storage.get(16), "old");
  }
});

test("joined localization writes known strings and preserves them on missing or empty translations", () => {
  for (const [found, value, expected] of [
    [false, null, "old"],
    [true, "", "old"],
    [true, "new", "new"],
  ]) {
    const row = fixture(),
      storage = new Map([[0, "old"]]);
    row.environment.readConfig = () => ({ status: "ready", found, value });
    row.importText = (call) =>
      importStringPropertyText({
        ...call,
        storage,
        propertyKind: "StrProperty",
      });
    assert.equal(loadActorLocalized(row).status, "ready");
    assert.equal(storage.get(0), expected);
  }
  const row = fixture([
    field("First"),
    field("MissingStorage", { offset: 12 }),
  ]);
  const storage = new Map([[0, "old"]]);
  row.importText = (call) =>
    importStringPropertyText({ ...call, storage, propertyKind: "StrProperty" });
  assert.equal(loadActorLocalized(row).status, "unsupported");
  assert.equal(storage.get(0), "text");
  assert.equal(storage.has(12), false);
});
