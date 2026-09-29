import assert from "node:assert/strict";
import test from "node:test";
import {
  readKnownFlagBits,
  writeKnownFlagBits,
  populateLevelActorCollision,
  applyActorBooleanTags,
  applyActorReferenceTags,
  applyActorTransformTags,
  prepareStaticActorProperties,
  freshObjectLoadingFlags,
  postLoadStaticActor,
  postLoadBrushActor,
  prepareFreshStaticActor,
  collectLevelActorAssignments,
  resolvePackageReference,
} from "../js/actor-loading.js";

test("known flag reads require consumed bits and masked writes retain unknown padding", () => {
  assert.equal(
    readKnownFlagBits({ mask: 0x80000001, value: 0x80000001 }, 0x80000000),
    0x80000000,
  );
  assert.equal(readKnownFlagBits({ mask: 1, value: 0 }, 1), 0);
  assert.equal(readKnownFlagBits({ mask: 1, value: 0 }, 2), undefined);
  assert.equal(readKnownFlagBits({ mask: 0, value: 1 }, 0), undefined);
  assert.equal(readKnownFlagBits(undefined, 0), undefined);
  assert.equal(readKnownFlagBits(0xffffffff, 0xffffffff), 0xffffffff);
  assert.deepEqual(
    writeKnownFlagBits({ mask: 0x80000001, value: 0x80000001 }, 0x100, 0),
    { mask: 0x80000101, value: 0x80000001 },
  );
  assert.deepEqual(writeKnownFlagBits({ mask: 0, value: 0 }, 0x100, 0x100), {
    mask: 0x100,
    value: 0x100,
  });
  assert.equal(writeKnownFlagBits(0xffffffff, 0x100, 0), 0xfffffeff);
  assert.equal(writeKnownFlagBits(0, 1, 2), undefined);
});

test("fresh level population preserves slots, duplicates and callback-visible flag changes", () => {
  const fields = new Map([
      ["a", { mask: 1, value: 1 }],
      ["b", { mask: 1, value: 0 }],
    ]),
    seen = [];
  const actors = [null, "a", "b", "a", null];
  const result = populateLevelActorCollision({
    freshHash: true,
    actors,
    readActorFlags: (id) => fields.get(id),
    addActor: (id) => {
      seen.push(id);
      fields.set("b", { mask: 1, value: 1 });
      return { status: "ready" };
    },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.completedSlots, 5);
  assert.deepEqual(result.calls, [
    { index: 1, identity: "a" },
    { index: 2, identity: "b" },
    { index: 3, identity: "a" },
  ]);
  assert.deepEqual(seen, ["a", "b", "a"]);
  assert.deepEqual(actors, [null, "a", "b", "a", null]);
  assert.ok(Object.isFrozen(result.calls) && Object.isFrozen(result.calls[0]));
});

test("population failures keep completed admission effects and never report missing actors as clear", () => {
  for (const failure of ["flags", "reply", "throw"]) {
    const seen = [];
    const result = populateLevelActorCollision({
      freshHash: true,
      actors: ["first", null, "second", "later"],
      readActorFlags: (id) =>
        id === "second" && failure === "flags"
          ? { mask: 0, value: 0 }
          : { mask: 1, value: 1 },
      addActor: (id) => {
        seen.push(id);
        if (id === "second") {
          if (failure === "throw") throw Error("provider");
          return { status: "unsupported" };
        }
        return { status: "ready" };
      },
    });
    assert.equal(result.status, "unsupported");
    assert.equal(result.completedSlots, 2);
    assert.deepEqual(
      seen,
      failure === "flags" ? ["first"] : ["first", "second"],
    );
    assert.equal(result.calls.length, seen.length);
  }
  for (const actors of [[undefined], new Array(1)])
    assert.equal(
      populateLevelActorCollision({
        freshHash: true,
        actors,
        readActorFlags: () => 1,
        addActor: () => ({ status: "ready" }),
      }).status,
      "unsupported",
    );
  assert.equal(
    populateLevelActorCollision({
      freshHash: false,
      actors: [],
      readActorFlags: () => 1,
      addActor: () => ({ status: "ready" }),
    }).status,
    "unsupported",
  );
});

function transformFixture() {
  return {
    archive: { loading: true, saving: false, persistent: true },
    layout: [
      "Location",
      "Rotation",
      "DrawScale",
      "DrawScale3D",
      "PrePivot",
    ].map((name) => ({
      name,
      kind: name === "DrawScale" ? "FloatProperty" : "StructProperty",
      reference:
        name === "DrawScale"
          ? null
          : name === "Rotation"
            ? "Core.Object.Rotator"
            : "Core.Object.Vector",
      propertyFlags: 3,
    })),
    defaults: {
      Location: [1, -0, 3],
      Rotation: [-2147483648, 0, 2147483647],
      DrawScale: 2,
      DrawScale3D: [1, -2, 3],
      PrePivot: [0, 0, 0],
    },
    tags: [
      { name: "DrawScale", value: 3 },
      { name: "PrePivot", value: [-0, 4, 5] },
      { name: "DrawScale", value: -2 },
    ],
  };
}

test("transform loading preserves original components, repeated tags and copied defaults", () => {
  const input = transformFixture(),
    before = structuredClone(input);
  const result = applyActorTransformTags(input);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.values, {
    ...input.defaults,
    DrawScale: -2,
    PrePivot: [-0, 4, 5],
  });
  assert.deepEqual(result.skipped, []);
  assert.notEqual(result.values.Location, input.defaults.Location);
  assert.ok(Object.isFrozen(result.values.PrePivot));
  input.tags[1].value[1] = 999;
  assert.equal(result.values.PrePivot[1], 4);
  input.tags[1].value[1] = 4;
  assert.deepEqual(input, before);
});

test("transform property gate skips payload access and preserves persistent defaults", () => {
  const input = transformFixture();
  input.layout[2].propertyFlags |= 0x1000;
  input.layout[4].propertyFlags |= 0x2000;
  for (const tag of input.tags) delete tag.value;
  const result = applyActorTransformTags(input);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.values, input.defaults);
  assert.deepEqual(result.skipped, [0, 1, 2]);
  input.archive.persistent = false;
  assert.equal(applyActorTransformTags(input).status, "unsupported");
});

test("invalid transform inputs never yield partially loaded fields", () => {
  for (const corrupt of [
    (input) => input.tags.push({ name: "Location", value: [Infinity, 0, 0] }),
    (input) => input.tags.push({ name: "Rotation", value: [0, 0, 2147483648] }),
    (input) => (input.defaults.Location[0] = 0.1),
    (input) => delete input.defaults.Location[1],
    (input) => delete input.defaults.PrePivot,
    (input) => input.layout.pop(),
    (input) => (input.layout[0].reference = "Vector"),
    (input) => (input.layout[0].propertyFlags = -1),
    (input) => input.tags.push({ name: "Velocity", value: [0, 0, 0] }),
    (input) => (input.archive.loading = false),
  ]) {
    const input = transformFixture();
    corrupt(input);
    const result = applyActorTransformTags(input);
    assert.equal(result.status, "unsupported");
    assert.equal(result.values, undefined);
  }
});

function propertiesFixture() {
  const transforms = transformFixture(),
    references = referenceFixture(),
    booleans = booleanFixture();
  for (const name of ["Owner", "Mesh", "Brush", "AntiPortal"]) {
    references.layout.push({ name, kind: "ObjectProperty", propertyFlags: 3 });
    references.defaults[name] = null;
  }
  for (const offset of ["0x74", "0x2e4", "0x2f8"]) {
    booleans.layout.push({ offset, mask: 0, fields: [] });
    booleans.words[offset] = { mask: 0, value: 0 };
  }
  return {
    defaults: {
      collisionTransforms: {
        layout: transforms.layout,
        defaults: transforms.defaults,
      },
      collisionBooleans: {
        layout: booleans.layout,
        defaultGroups: booleans.words,
      },
      collisionReferences: { layout: references.layout },
    },
    source: {
      savedTransform: { tags: transforms.tags },
      savedCollisionFlags: { tags: booleans.tags },
      savedReferences: { tags: references.tags },
    },
    resolvedReferenceDefaults: references.defaults,
    resolveReference: references.resolveReference,
    mesh: references.mesh,
    level: references.level,
  };
}

function freshFixture() {
  const input = propertiesFixture();
  input.classLoading = {
    sourceClass: "Engine.StaticMeshActor",
    scope: "ordinary-native-registration-and-package",
    mask: 0x428,
    value: 0,
  };
  input.source.savedStateFrame = {
    scope: "saved-map-state-frame",
    classIdentity: "Engine.StaticMeshActor",
    savedExportFlags: 0x02070001,
    codeOffset: -1,
  };
  input.source.savedActorLoading = {
    scope: "saved-actor-loading-inputs",
    fileVersion: 123,
    tags: [{ name: "Rotation" }],
    attachedOverrideCount: 0,
  };
  input.defaults.collisionAttached = {
    layout: {
      name: "Attached",
      kind: "ArrayProperty",
      propertyFlags: 0x400002,
    },
    inner: {
      kind: "ObjectProperty",
      reference: "Engine.Actor",
      propertyFlags: 0,
    },
    defaultCount: 0,
    defaultOrigin: "zero-initialized-class-default",
  };
  return input;
}

test("fresh actor flags pass through loading stages rather than retaining saved flags", () => {
  const result = freshObjectLoadingFlags(0x02070001, 0);
  assert.deepEqual(result.flags, {
    created: 0x03070201,
    allocated: 0x03070201,
    serializing: 0x03078001,
    serialized: 0x43070001,
    beforePostLoad: 0x42070001,
  });
  assert.equal(freshObjectLoadingFlags(0, 8).flags.allocated, 0x01004200);
  for (const args of [
    [undefined, 0],
    [-1, 0],
    [0, 0x400],
    [0, undefined],
  ])
    assert.equal(freshObjectLoadingFlags(...args).status, "unsupported");
  assert.ok(Object.isFrozen(result.flags));
});

test("fresh actor preparation joins loaded properties, empty attachments and PostLoad writes", () => {
  const input = freshFixture(),
    result = prepareFreshStaticActor(input);
  assert.equal(result.status, "ready");
  assert.equal(result.scope, "original-fresh-static-actor");
  assert.deepEqual(result.postLoadWrites, {
    objectFlags: 0x62070001,
    swayRotationOrig: [-2147483648, 0, 2147483647],
    flags5c: { mask: 0x40, value: 0x40 },
  });
  assert.deepEqual(result.attached, []);
  assert.equal(result.references.StaticMesh, input.mesh);
  assert.deepEqual(result.groups, prepareStaticActorProperties(input).groups);
  // PostLoad reads Brush (+0x278); skeletal Mesh (+0x104) is not this branch.
  input.resolvedReferenceDefaults.Mesh = { identity: "skeletal-mesh" };
  const withMesh = prepareFreshStaticActor(input);
  assert.equal(withMesh.status, "ready");
  assert.equal(withMesh.references.Mesh, input.resolvedReferenceDefaults.Mesh);
  assert.ok(
    Object.isFrozen(result.attached) &&
      Object.isFrozen(result.postLoadWrites.swayRotationOrig),
  );
  input.source.savedStateFrame.savedExportFlags = 0;
  input.defaults.collisionTransforms.defaults.Rotation[0] = 123;
  assert.equal(result.postLoadWrites.objectFlags, 0x62070001);
  assert.equal(result.postLoadWrites.swayRotationOrig[0], -2147483648);
});

test("fresh actor admission rejects unknown lifecycle state before exposing properties", () => {
  for (const corrupt of [
    (input) => delete input.classLoading,
    (input) => (input.classLoading.mask = 0x408),
    (input) => (input.classLoading.value = 0x20),
    (input) => (input.classLoading.value = 0x400),
    (input) => (input.source.savedStateFrame.classIdentity = "Engine.Actor"),
    (input) => (input.source.savedStateFrame.codeOffset = 0),
    (input) => (input.source.savedActorLoading.fileVersion = 120),
    (input) => (input.source.savedActorLoading.tags = new Array(1)),
    (input) =>
      input.source.savedActorLoading.tags.push({ name: "oBjEcTfLaGs" }),
    (input) => input.source.savedActorLoading.tags.push({ name: "Attached" }),
    (input) => input.source.savedActorLoading.tags.push({ name: "aTtAcHeD" }),
    (input) => (input.source.savedActorLoading.attachedOverrideCount = 1),
    (input) => (input.defaults.collisionAttached.defaultOrigin = "assumed"),
    (input) => (input.defaults.collisionAttached.defaultCount = 1),
    (input) => (input.defaults.collisionAttached.layout.propertyFlags = 2),
    (input) =>
      (input.defaults.collisionAttached.inner.propertyFlags = 0x400000),
    (input) =>
      (input.resolvedReferenceDefaults.Brush = {
        identity: "unresolved-brush",
      }),
    (input) => (input.source.savedStateFrame.savedExportFlags |= 0x100),
  ]) {
    const input = freshFixture();
    corrupt(input);
    const result = prepareFreshStaticActor(input);
    assert.equal(result.status, "unsupported");
    assert.equal(result.transform, undefined);
    assert.equal(result.postLoadWrites, undefined);
  }
});

test("PostLoad retains known flag bits and does not invent unknown bits", () => {
  const input = {
    objectFlags: 0x42070001,
    classFlags: 0,
    brushReference: null,
    attachedCount: 0,
    rotation: [1, -2, 3],
    flags5c: { mask: 0x80000001, value: 0x80000000 },
  };
  const before = structuredClone(input),
    result = postLoadStaticActor(input);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.writes.flags5c, {
    mask: 0x80000041,
    value: 0x80000040,
  });
  assert.deepEqual(result.writes.swayRotationOrig, input.rotation);
  assert.deepEqual(input, before);
});

test("unsupported PostLoad branches retain only writes reached before the missing state", () => {
  const input = {
    objectFlags: 1,
    classFlags: 0,
    brushReference: null,
    attachedCount: 0,
    rotation: [1, 2, 3],
    flags5c: { mask: 0, value: 0 },
  };
  for (const extra of [
    { objectFlags: 0x100 },
    { classFlags: 0x20 },
    { brushReference: {} },
    { attachedCount: undefined },
    { attachedCount: 1 },
    { rotation: [0, 0, 2147483648] },
    { flags5c: { mask: 0, value: 1 } },
  ]) {
    const result = postLoadStaticActor({ ...input, ...extra });
    assert.equal(result.status, "unsupported");
    assert.deepEqual(result.writes, {
      objectFlags: ((extra.objectFlags ?? 1) | 0x20000000) >>> 0,
      ...(extra.flags5c ? { swayRotationOrig: [1, 2, 3] } : {}),
    });
  }
  assert.deepEqual(postLoadStaticActor().writes, {});
});

test("joined properties retain mesh identity, transform operands and known Boolean bits", () => {
  const input = propertiesFixture(),
    result = prepareStaticActorProperties(input);
  assert.equal(result.status, "ready");
  assert.equal(result.references.StaticMesh, input.mesh);
  assert.equal(result.references.Level, input.level);
  assert.equal(result.references.XLevel, null);
  assert.deepEqual(result.transform, {
    location: [1, -0, 3],
    rotation: [-2147483648, 0, 2147483647],
    drawScale: -2,
    drawScale3D: [1, -2, 3],
    prePivot: [-0, 4, 5],
  });
  assert.deepEqual(
    result.groups,
    applyActorBooleanTags({
      ...booleanFixture(),
      layout: input.defaults.collisionBooleans.layout,
      words: input.defaults.collisionBooleans.defaultGroups,
    }).groups,
  );
  assert.deepEqual(result.skipped.references, [2]);
  assert.equal(result.objectFlags, undefined);
});

test("joined loading rejects incomplete input before resolving objects", () => {
  for (const corrupt of [
    (input) => (input.defaults.collisionBooleans.layout = {}),
    (input) => (input.defaults.collisionReferences.layout = {}),
    (input) => delete input.defaults.collisionBooleans,
    (input) => input.defaults.collisionReferences.layout.pop(),
    (input) =>
      input.source.savedTransform.tags.push({ name: "DrawScale", value: NaN }),
    (input) =>
      input.source.savedCollisionFlags.tags.push({
        name: "undeclared",
        value: true,
      }),
  ]) {
    const input = propertiesFixture();
    corrupt(input);
    let calls = 0;
    input.resolveReference = () => {
      calls++;
      throw Error("must not resolve after earlier invalid fields");
    };
    const result = prepareStaticActorProperties(input);
    assert.equal(result.status, "unsupported");
    assert.equal(result.references, undefined);
    assert.equal(result.transform, undefined);
    assert.equal(calls, 0);
  }
});

function referenceFixture() {
  const mesh = { identity: "Objects.Home.Box" },
    level = { identity: "Map.LevelInfo" };
  const linker = {
    exportCount: 1,
    importCount: 1,
    createExport(index, flags) {
      assert.equal(index, 0);
      assert.equal(flags, 0);
      return { status: "ready", value: level };
    },
    createImport(index) {
      assert.equal(index, 0);
      return { status: "ready", value: mesh };
    },
  };
  return {
    archive: { loading: true, saving: false, persistent: true },
    layout: [
      { name: "StaticMesh", kind: "ObjectProperty", propertyFlags: 3 },
      { name: "Level", kind: "ObjectProperty", propertyFlags: 2 },
      { name: "XLevel", kind: "ObjectProperty", propertyFlags: 0x2002 },
    ],
    defaults: { StaticMesh: null, Level: null, XLevel: null },
    tags: [
      { name: "StaticMesh", package: "Map", reference: -1 },
      { name: "Level", package: "Map", reference: 1 },
      // An excluded transient payload must not try to resolve anything.
      { name: "XLevel" },
    ],
    resolveReference(pkg, ref) {
      assert.equal(pkg, "Map");
      return resolvePackageReference(linker, ref);
    },
    mesh,
    level,
    linker,
  };
}

test("reference loading preserves object identity and skips transient saved values", () => {
  const input = referenceFixture();
  const result = applyActorReferenceTags(input);
  assert.equal(result.status, "ready");
  assert.equal(result.references.StaticMesh, input.mesh);
  assert.equal(result.references.Level, input.level);
  assert.equal(result.references.XLevel, null);
  assert.deepEqual(result.skipped, [2]);
  assert.deepEqual(input.defaults, {
    StaticMesh: null,
    Level: null,
    XLevel: null,
  });
  assert.ok(Object.isFrozen(result.references));
  assert.equal(Object.isFrozen(input.mesh), false);
});

test("signed indices select only the consumed table and retain null factory replies", () => {
  assert.equal(resolvePackageReference(undefined, 0).value, null);
  const calls = [];
  const linker = {
    exportCount: 0x7fffffff,
    importCount: 0x7fffffff,
    createExport(index, flags) {
      calls.push(["export", index, flags]);
      return { status: "ready", value: null };
    },
    createImport(index) {
      calls.push(["import", index]);
      return { status: "ready", value: "object" };
    },
  };
  assert.equal(resolvePackageReference(linker, 0x7fffffff).value, null);
  assert.equal(resolvePackageReference(linker, -0x7fffffff).value, "object");
  assert.deepEqual(calls, [
    ["export", 0x7ffffffe, 0],
    ["import", 0x7ffffffe],
  ]);
  delete linker.importCount;
  assert.equal(resolvePackageReference(linker, 1).status, "ready");
});

test("bad package indices and unknown replies cannot become null references", () => {
  const linker = referenceFixture().linker;
  for (const ref of [2, -2, -0x80000000, 0x80000000, 0.5, NaN, undefined])
    assert.equal(resolvePackageReference(linker, ref).status, "unsupported");
  for (const reply of [
    undefined,
    { status: "unsupported" },
    { status: "ready" },
    { status: "ready", value: undefined },
  ]) {
    linker.createImport = () => reply;
    const result = resolvePackageReference(linker, -1);
    assert.equal(result.status, "unsupported");
    assert.equal(Object.hasOwn(result, "value"), false);
  }
});

test("repeated reference tags preserve order and nonpersistent transient writes", () => {
  const input = referenceFixture();
  input.archive.persistent = false;
  input.tags[2] = { name: "XLevel", package: "Map", reference: 1 };
  input.tags.push({ name: "StaticMesh", package: "Map", reference: 0 });
  const result = applyActorReferenceTags(input);
  assert.equal(result.status, "ready");
  assert.equal(result.references.StaticMesh, null);
  assert.equal(result.references.XLevel, input.level);
  assert.deepEqual(result.skipped, []);
});

test("unresolved reference loading does not expose a partial actor", () => {
  for (const change of [
    (input) => delete input.defaults.Level,
    (input) => (input.layout[0].propertyFlags |= 0x400000),
    (input) => input.layout.push(input.layout[0]),
    (input) => (input.layout[0].kind = "IntProperty"),
    (input) => (input.archive.loading = false),
    (input) => (input.archive.saving = true),
    (input) => input.tags.push({ name: "unknown" }),
    (input) =>
      input.tags.push({ name: "StaticMesh", package: "Map", reference: 2 }),
    (input) => delete input.tags[1],
  ]) {
    const input = referenceFixture();
    change(input);
    const result = applyActorReferenceTags(input);
    assert.equal(result.status, "unsupported");
    assert.equal(Object.hasOwn(result, "references"), false);
  }
});

test("persistent reference loading composes with the later Level.PostLoad assignment", () => {
  const input = referenceFixture();
  const loaded = applyActorReferenceTags(input);
  const world = { identity: "current-world" },
    actor = { ...loaded.references };
  assert.equal(actor.XLevel, null);
  const writes = collectLevelActorAssignments({
    level: { identity: world, outerIdentity: "Map" },
    registry: [actor],
    buffer: [],
    objects: new Map([
      [actor, { classIdentity: "StaticMeshActor", outerIdentity: "Map" }],
    ]),
    classParents: new Map([
      ["StaticMeshActor", "Actor"],
      ["Actor", null],
    ]),
    actorClass: "Actor",
    playerControllerClass: "PlayerController",
  });
  assert.equal(writes.status, "ready");
  for (const write of writes.assignments)
    write.identity.XLevel = write.writes.xLevelIdentity;
  assert.equal(actor.XLevel, world);
  assert.equal(actor.Level, input.level);
  assert.equal(actor.StaticMesh, input.mesh);
});

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

// Independent native instruction comparisons live in check_static_actor_bounds_native.
// These authored cases cover rejection, aliasing and public API behavior.
import { postLoadModel, prepareSourceModel } from "../js/actor-loading.js";
import { sourceModelFixture, modelClassFixture } from "./fixtures/model.mjs";

test("Model PostLoad appends in node order and preserves existing duplicate entries", () => {
  const input = {
    objectFlags: 4,
    nodeSurfaces: [1, 0, 1],
    surfaceNodes: [[7], [0, 0], []],
  };
  const before = structuredClone(input),
    result = postLoadModel(input);
  assert.equal(result.status, "ready", result.reason);
  assert.deepEqual(result.writes, {
    objectFlags: 0x20000004,
    surfaceNodes: [[7, 1], [0, 0, 0, 2], []],
  });
  assert.deepEqual(input, before);
  assert.ok(Object.isFrozen(result.writes.surfaceNodes[1]));
  assert.deepEqual(
    postLoadModel({ ...input, ...result.writes }).writes.surfaceNodes,
    [[7, 1, 1], [0, 0, 0, 2, 0, 2], []],
  );
});

test("Model source preparation owns bounds, creates per-surface arrays and retains loading stages", () => {
  const source = sourceModelFixture(),
    result = prepareSourceModel(source, modelClassFixture);
  assert.equal(result.status, "ready", result.reason);
  assert.deepEqual(result.surfaceNodes, [[1, 3], [], [0, 2]]);
  assert.equal(
    result.objectFlags,
    (result.loadingFlags.beforePostLoad | 0x20000000) >>> 0,
  );
  source.localBounds.max[0] = 99;
  assert.equal(result.localBounds.max[0], 4);
  assert.ok(Object.is(result.localBounds.min[0], -0));
  assert.equal(result.localBounds.valid, 7);
  assert.ok(Object.isFrozen(result.localBounds.min));
});

test("unknown Model lifecycle branches and malformed resource inputs stay unsupported", () => {
  for (const change of [
    (s) => (s.fileVersion = 122),
    (s) => (s.licenseeVersion = 8),
    (s) => (s.surfaceCount = -1),
    (s) => (s.nodeSurfaces[0] = 3),
    (s) => delete s.nodeSurfaces[0],
    (s) => (s.localBounds.max[1] = Infinity),
    (s) => delete s.localBounds.min[0],
    (s) => (s.emptyRenderArrays[0].count = 1),
    (s) => s.emptyRenderArrays.reverse(),
    (s) => delete s.savedExportFlags,
  ]) {
    const source = sourceModelFixture();
    change(source);
    assert.equal(
      prepareSourceModel(source, modelClassFixture).status,
      "unsupported",
    );
  }
  for (const cls of [
    { ...modelClassFixture, mask: 8 },
    { ...modelClassFixture, value: 0x400 },
  ])
    assert.equal(
      prepareSourceModel(sourceModelFixture(), cls).status,
      "unsupported",
    );
  for (const input of [
    { objectFlags: 0x100, nodeSurfaces: [], surfaceNodes: [] },
    { objectFlags: 0, nodeSurfaces: [-1], surfaceNodes: [[]] },
    { objectFlags: 0, nodeSurfaces: [0], surfaceNodes: [Array(1)] },
  ]) {
    const result = postLoadModel(input);
    assert.equal(result.status, "unsupported");
    assert.equal(result.writes, undefined);
  }
});

function brushPostLoadFixture() {
  return {
    objectFlags: 0x42070001,
    classFlags: 0x12,
    brushReference: "model",
    attachedCount: 0,
    rotation: [-2147483648, 0, 2147483647],
    flags5c: { mask: 0x80000001, value: 0x80000000 },
    objects: new Map([
      ["model", { objectFlags: 0x20000000, polysReference: "polys" }],
      ["polys", { objectFlags: 0xffffffff }],
    ]),
  };
}

test("brush PostLoad returns ordered shared-header writes without changing its inputs", () => {
  const input = brushPostLoadFixture(),
    before = structuredClone(input);
  const result = postLoadBrushActor(input);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.writes, {
    objectFlags: 0x62070001,
    resourceFlags: [
      { identity: "model", objectFlags: 0x20000001 },
      { identity: "polys", objectFlags: 0xffffffff },
    ],
    swayRotationOrig: [-2147483648, 0, 2147483647],
    flags5c: { mask: 0x80000041, value: 0x80000040 },
  });
  assert.deepEqual(input, before);
  assert.ok(Object.isFrozen(result.writes.resourceFlags));
  assert.ok(result.writes.resourceFlags.every(Object.isFrozen));
  assert.equal(postLoadStaticActor(input).status, "unsupported");
});

test("brush PostLoad distinguishes null references and retains repeated writes to aliased headers", () => {
  const input = brushPostLoadFixture();
  input.brushReference = null;
  delete input.objects;
  assert.deepEqual(postLoadBrushActor(input).writes.resourceFlags, []);
  input.brushReference = "model";
  input.objects = new Map([
    ["model", { objectFlags: 0x80000000, polysReference: null }],
  ]);
  assert.deepEqual(postLoadBrushActor(input).writes.resourceFlags, [
    { identity: "model", objectFlags: 0x80000001 },
  ]);
  input.objects.get("model").polysReference = "model";
  const result = postLoadBrushActor(input);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.writes.resourceFlags, [
    { identity: "model", objectFlags: 0x80000001 },
    { identity: "model", objectFlags: 0x80000001 },
  ]);
});

test("brush PostLoad stops before missing or unsupported work while retaining earlier writes", () => {
  for (const [mutate, count, sway] of [
    [(input) => (input.objectFlags = 0x100), 0, false],
    [(input) => (input.classFlags = 0x32), 0, false],
    [(input) => delete input.classFlags, 0, false],
    [(input) => delete input.brushReference, 0, false],
    [(input) => delete input.objects, 0, false],
    [(input) => input.objects.delete("model"), 0, false],
    [(input) => (input.objects.get("model").objectFlags = -1), 0, false],
    [(input) => delete input.objects.get("model").polysReference, 1, false],
    [(input) => input.objects.delete("polys"), 1, false],
    [
      (input) => (input.objects.get("polys").objectFlags = 0x100000000),
      1,
      false,
    ],
    [(input) => (input.attachedCount = 1), 2, false],
    [(input) => (input.rotation = [0, 0, 2147483648]), 2, false],
    [(input) => (input.flags5c = { mask: 0, value: 1 }), 2, true],
  ]) {
    const input = brushPostLoadFixture();
    mutate(input);
    const result = postLoadBrushActor(input);
    assert.equal(result.status, "unsupported");
    assert.equal(
      result.writes.objectFlags,
      (input.objectFlags | 0x20000000) >>> 0,
    );
    assert.equal(result.writes.resourceFlags.length, count);
    assert.equal(Object.hasOwn(result.writes, "swayRotationOrig"), sway);
    assert.equal(result.writes.flags5c, undefined);
  }
  assert.deepEqual(postLoadBrushActor().writes, { resourceFlags: [] });
});
