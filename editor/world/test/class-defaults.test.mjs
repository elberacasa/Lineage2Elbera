import assert from "node:assert/strict";
import test from "node:test";
import { loadClassDefaultProperties } from "../js/class-defaults.js";
import {
  defaultLoadingFixture,
  runDefaultLoadingFixture,
} from "./class-default-fixture.mjs";

const view = (result) => new DataView(Uint8Array.from(result.bytes).buffer);

test("saved tags preserve exact bits, Boolean neighbors and nested serializer order", () => {
  const f = defaultLoadingFixture(),
    result = loadClassDefaultProperties({
      ...f.providers,
      layout: f.base,
      payload: f.payload,
    });
  assert.equal(result.status, "ready");
  assert.equal(result.consumed, f.payload.length);
  assert.equal(view(result).getUint32(0x34, true), 0x01020304);
  assert.equal(view(result).getUint32(0x38, true), 1);
  assert.equal(view(result).getUint32(0x3c, true), 0x80000000);
  assert.deepEqual(
    [0x54, 0x58, 0x5c].map((offset) => view(result).getFloat32(offset, true)),
    [1, 2, 3],
  );
  assert.equal(view(result).getUint32(0x60, true), 99);
  const values = new Map(result.values);
  assert.equal(values.get(0x40), "A\0\ud800B");
  assert.strictEqual(values.get(0x4c), f.reference);
  assert.equal(values.get(0x50), 400);
  assert.deepEqual(values.get(0x64), []);
  assert.deepEqual(
    result.applied.map((row) => row.field),
    [
      "Counter",
      "Enabled",
      "Secondary",
      "Weight",
      "Title",
      "Reference",
      "Name",
      "Vector",
      "Nested",
      "NestedCounter",
    ],
  );
  assert.ok(Object.isFrozen(result.bytes) && Object.isFrozen(result.values));
});

test("child initialization preserves parent storage, clears new fields and applies overrides", () => {
  const f = defaultLoadingFixture();
  const parent = loadClassDefaultProperties({
    ...f.providers,
    layout: f.base,
    payload: f.payload,
  });
  const before = structuredClone(parent);
  const child = loadClassDefaultProperties({
    ...f.providers,
    layout: f.child,
    parent,
    payload: f.childPayload,
  });
  assert.equal(child.status, "ready");
  assert.deepEqual(parent, before);
  assert.equal(view(parent).getUint32(0x34, true), 0x01020304);
  assert.equal(view(child).getUint32(0x34, true), 9);
  const pv = new Map(parent.values),
    cv = new Map(child.values);
  assert.equal(cv.get(0x70), "tail");
  assert.equal(cv.get(0x40), pv.get(0x40));
  assert.strictEqual(cv.get(0x4c), pv.get(0x4c));
  assert.notStrictEqual(cv.get(0x64), pv.get(0x64));
  assert.equal(Object.isFrozen(f.reference), false);
});

test("all inspector parent/payload paths retain explicit pre-localization state", () => {
  for (const parent of ["none", "partial", "full"])
    for (const payload of ["empty", "filled"]) {
      const run = runDefaultLoadingFixture(parent, payload);
      assert.equal(run.result.status, "ready");
      if (run.parent) assert.equal(run.parent.status, "ready");
      assert.equal(
        new Map(run.result.values).get(0x70),
        payload === "filled" ? "tail" : "",
      );
      assert.equal(
        view(run.result).getUint32(0x34, true),
        payload === "filled" ? 9 : 0,
      );
    }
});

test("malformed, unresolved and unsupported inputs leave parent and source data intact", () => {
  const variants = [
    (input) => (input.payload = input.payload.slice(0, -1)),
    (input) => input.payload.push(1),
    (input) => (input.payload[1] = 0x24),
    (input) => (input.payload[1] = 0xa2),
    (input) => (input.payload[0] = 63),
    (input) => (input.payload = [14, 0x5d, 2, 2, 65, 0]),
    (input) =>
      (input.payload = [14, 0x5d, 6, 0x40, 0x80, 0x80, 0x80, 0x80, 0, 0]),
    (input) => (input.payload = [14, 0x5d, 3, 2, 65, 66, 0]),
    (input) => (input.resolveName = () => undefined),
    (input) =>
      (input.resolveName = () => {
        throw Error("unavailable");
      }),
    (input) => (input.payload = [6, 5, 2, 0]),
    (input) => (input.payload = [11, 0x5a, 10, 1, 0, 0]),
    (input) => (input.layout.fields[0].propertyFlags = 0x1000),
    (input) => input.layout.lists["0x78"].pop(),
    (input) => input.layout.lists["0x70"].reverse(),
    (input) => (input.layout.fields[0].nameId = undefined),
    (input) => (input.layout.fields[0].offset = 0x80),
    (input) => (input.layout.fields[0].arrayDim = 0),
    (input) => (input.layout.parentSize = 0),
    (input) => (input.parent = null),
    (input) => (input.structures = new Map()),
    (input) => delete input.archiveFlags1c,
  ];
  for (const corrupt of variants) {
    const f = defaultLoadingFixture();
    const parent = loadClassDefaultProperties({
      ...f.providers,
      layout: f.base,
      payload: f.payload,
    });
    const snapshot = structuredClone(parent);
    const input = {
      ...f.providers,
      layout: f.child,
      parent,
      payload: [...f.childPayload],
    };
    corrupt(input);
    const bytes = [...input.payload];
    const result = loadClassDefaultProperties(input);
    assert.equal(result.status, "unsupported", String(corrupt));
    assert.equal(result.bytes, undefined);
    assert.deepEqual(parent, snapshot);
    assert.deepEqual(input.payload, bytes);
  }
});
