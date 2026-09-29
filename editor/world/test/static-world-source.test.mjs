import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareStaticWorldSource,
  loadStaticWorldSource,
} from "../js/static-world-source.js";
import { sourceWorldFixture } from "./fixtures/static-world.mjs";

function withSavedBooleans() {
  const source = sourceWorldFixture();
  const shared = source.classDefaults[0].collisionBooleans;
  shared.layout[0] = {
    offset: "0x64",
    mask: 3,
    fields: [
      { name: "AuthoredA", mask: 1, propertyFlags: 0 },
      { name: "AuthoredB", mask: 2, propertyFlags: 0 },
    ],
  };
  shared.defaultGroups["0x64"] = { mask: 3, value: 1 };
  const groups = (value) => ({
    ...structuredClone(shared.defaultGroups),
    "0x64": { mask: 3, value },
  });
  const classes = {};
  for (const [name, value] of [
    ["Engine.LevelInfo", 0],
    ["Engine.StaticMeshActor", 1],
    ["Engine.BlockingVolume", 2],
  ])
    classes[name.toLowerCase()] = {
      sourceClass: name,
      actorBooleans: { groups: groups(value) },
    };
  const tags = [
    { name: "AuthoredA", value: false },
    { name: "AuthoredB", value: true },
  ];
  source.actors[0].savedCollisionFlags.tags = structuredClone(tags);
  source.savedActorBooleans = {
    scope: "saved-actor-declared-booleans",
    classes,
    actors: {},
  };
  for (const [ref, identity] of Object.entries(source.savedActorSources)) {
    const value =
      ref === "2"
        ? 2
        : classes[identity.classIdentity.toLowerCase()].actorBooleans.groups[
            "0x64"
          ].value;
    source.savedActorBooleans.actors[ref] = {
      scope: "saved-actor-declared-booleans",
      sourceClass: identity.classIdentity,
      tags: ref === "2" ? structuredClone(tags) : [],
      groups: groups(value),
    };
  }
  return source;
}

test("saved flags survive for every class without constructing missing actors or aliasing live fields", () => {
  const source = withSavedBooleans(),
    before = structuredClone(source);
  const result = prepareStaticWorldSource(source, "Map");
  assert.equal(result.status, "ready", result.reason);
  assert.deepEqual(source, before);
  assert.equal(result.summary.actorsWithSavedBooleans, 4);
  assert.equal(result.actorForReference(3).savedGroups["0x64"].value, 2);
  assert.equal(result.actorForReference(3).prepared, undefined);
  assert.notEqual(
    result.actorForReference(2).savedGroups,
    result.actorForReference(2).prepared.groups,
  );
  assert.equal(
    result.savedSlots[1].savedGroups,
    result.savedSlots[4].savedGroups,
  );
  assert.equal(result.summary.collisionStatus, "unavailable");
  assert.equal(result.summary.unpreparedSavedActors, 2);
  assert.equal(
    prepareStaticWorldSource(sourceWorldFixture(), "Map").summary
      .actorsWithSavedBooleans,
    0,
  );
});

test("saved flag class, completeness, tags and known-bit corruption reject the world bundle", () => {
  for (const change of [
    (s) => delete s.savedActorBooleans.actors[3],
    (s) => (s.savedActorBooleans.actors[9] = s.savedActorBooleans.actors[3]),
    (s) => (s.savedActorBooleans.actors[3].sourceClass = "Engine.Mover"),
    (s) => delete s.savedActorBooleans.classes["engine.blockingvolume"],
    (s) =>
      (s.savedActorBooleans.classes["engine.blockingvolume"].sourceClass =
        "Engine.Mover"),
    (s) => (s.savedActorBooleans.actors[2].groups["0x64"].value = 1),
    (s) => (s.savedActorBooleans.actors[2].groups["0x64"].mask = 7),
    (s) =>
      s.savedActorBooleans.actors[2].tags.push({
        name: "Unconsumed",
        value: true,
      }),
    (s) => (s.savedActorBooleans.actors[2].tags[0].value = 0),
  ]) {
    const source = withSavedBooleans();
    change(source);
    const result = prepareStaticWorldSource(source, "Map");
    assert.equal(result.status, "unsupported");
    assert.equal(result.savedSlots, undefined);
  }
});

test("scene source preparation retains shared resources, null/repeated slots and unimplemented classes", () => {
  const source = sourceWorldFixture(),
    before = structuredClone(source);
  const result = prepareStaticWorldSource(source, "Map");
  assert.equal(result.status, "ready", result.reason);
  assert.deepEqual(source, before);
  assert.deepEqual(
    result.savedSlots.map((v) => v?.identity ?? null),
    ["Map.Level", "Map.Actor2", null, "Map.Volume", "Map.Actor2"],
  );
  assert.equal(result.savedSlots[1], result.savedSlots[4]);
  const a = result.actorForReference(2).prepared,
    b = result.actorForReference(4).prepared;
  assert.equal(a.references.StaticMesh, b.references.StaticMesh);
  assert.equal(a.references.Level, b.references.Level);
  assert.equal(a.references.XLevel, null);
  assert.deepEqual(a.groups["0x2f8"], { mask: 0, value: 0 });
  assert.ok(Object.is(a.transform.prePivot[0], -0));
  assert.deepEqual(
    result.unpreparedActors.map((v) => v.identity),
    ["Map.Level", "Map.Volume"],
  );
  assert.equal(result.summary.staticActors, 2);
  assert.equal(result.summary.preparedActors, 2);
  assert.equal(result.summary.preparedMeshes, 1);
  assert.equal(result.summary.collisionStatus, "unavailable");
  assert.deepEqual(result.savedMode, { "0x554": { mask: 7, value: 0 } });
  assert.equal(result.currentMode, undefined);
});

test("unsupported actor or resource preparation stays explicit without discarding saved slots", () => {
  for (const change of [
    (s) => {
      s.actors[0].savedActorLoading.attachedOverrideCount = 1;
    },
    (s) => {
      s.meshes["Objects.Mesh"].loadTail.fields["0x1dc"].value = 7;
    },
  ]) {
    const source = sourceWorldFixture();
    change(source);
    const result = prepareStaticWorldSource(source, "Map");
    assert.equal(result.status, "ready", result.reason);
    assert.equal(result.savedSlots.length, 5);
    assert.ok(result.summary.preparedActors < result.summary.staticActors);
    assert.ok(result.unpreparedActors.some((v) => v.reference === 2));
    assert.equal(result.summary.collisionStatus, "unavailable");
  }
});

test("source identity or completeness corruption cannot become a prepared world", () => {
  for (const change of [
    (s) => {
      s.tile = "Other";
    },
    (s) => {
      delete s.savedActorSlots[1];
    },
    (s) => {
      s.savedActorSlots[1] = 99;
    },
    (s) => {
      s.savedActorSlots[1] = -1;
    },
    (s) => {
      delete s.savedActorSources[2];
    },
    (s) => {
      s.actors.push(s.actors[0]);
    },
    (s) => {
      s.savedActorSources[2].classIdentity = "Engine.Mover";
    },
    (s) => {
      s.savedActorSources[2].exportSHA256 = "f".repeat(64);
    },
    (s) => {
      s.savedReferenceBindings.Map.references[1] = {
        ...s.savedActorSources[1],
        identity: "Map.Other",
      };
    },
    (s) => {
      s.savedLevelCollisionMode.reference = 2;
    },
    (s) => {
      s.savedLevelCollisionMode.groups["0x554"].value = 2;
    },
    (s) => {
      s.meshes["Objects.Mesh"].exportSHA256 = "f".repeat(64);
    },
    (s) => {
      s.meshes["Objects.Mesh"].sourceExport = "Objects.Other";
    },
    (s) => {
      s.savedLevelCollisionMode.tags = [{ name: "Unknown", value: true }];
    },
    (s) => {
      s.meshes["objects.mesh"] = s.meshes["Objects.Mesh"];
    },
    (s) => {
      s.classDefaults[0].collisionReferences.defaults.Level.reference = 1;
    },
  ]) {
    const source = sourceWorldFixture();
    change(source);
    const result = prepareStaticWorldSource(source, "Map");
    assert.equal(result.status, "unsupported");
    assert.equal(result.savedSlots, undefined);
  }
});

test("optional source loading stays alongside normal scenes and propagates fetch/cancellation failures", async () => {
  let requests = 0;
  const signal = new AbortController().signal;
  const fetcher = async (url, options) => {
    requests++;
    assert.equal(url, "/scenes/Map/static-world-source.json");
    assert.equal(options.signal, signal);
    return { ok: true, json: async () => sourceWorldFixture() };
  };
  assert.equal(await loadStaticWorldSource("Map", null, fetcher, signal), null);
  assert.equal(requests, 0);
  const result = await loadStaticWorldSource(
    "Map",
    "static-world-source.json",
    fetcher,
    signal,
  );
  assert.equal(result.summary.preparedActors, 2);
  await assert.rejects(
    loadStaticWorldSource("Map", "../other", fetcher),
    /reference/,
  );
  await assert.rejects(
    loadStaticWorldSource("Map", "static-world-source.json", async () => ({
      ok: false,
      status: 404,
    })),
    /404/,
  );
  const abort = new DOMException("cancelled", "AbortError");
  await assert.rejects(
    loadStaticWorldSource("Map", "static-world-source.json", async () => {
      throw abort;
    }),
    (e) => e === abort,
  );
  await assert.rejects(
    loadStaticWorldSource("Other", "static-world-source.json", async () => ({
      ok: true,
      json: async () => sourceWorldFixture(),
    })),
    /bundle/,
  );
  assert.equal(requests, 1);
});

import { sourceModelFixture, modelClassFixture } from "./fixtures/model.mjs";
function withBrushModels() {
  const s = withSavedBooleans(),
    classes = s.savedActorBooleans.classes;
  for (const cls of Object.values(classes)) cls.parent = "Engine.Actor";
  classes["core.object"] = { sourceClass: "Core.Object", parent: null };
  classes["engine.actor"] = {
    sourceClass: "Engine.Actor",
    parent: "Core.Object",
  };
  classes["engine.brush"] = {
    sourceClass: "Engine.Brush",
    parent: "Engine.Actor",
  };
  classes["engine.blockingvolume"].parent = "Engine.Brush";
  s.savedBrushModels = {
    scope: "saved-brush-model-resources",
    classLoading: modelClassFixture,
    actors: {
      3: {
        sourceClass: "Engine.BlockingVolume",
        modelRef: 5,
        savedReference: { reference: 5, package: "Map" },
      },
    },
    models: { 5: sourceModelFixture() },
  };
  s.savedActorSources[6] = {
    ...s.savedActorSources[3],
    exportRef: 6,
    identity: "Map.Volume2",
  };
  s.savedActorBooleans.actors[6] = structuredClone(
    s.savedActorBooleans.actors[3],
  );
  s.savedBrushModels.actors[6] = structuredClone(s.savedBrushModels.actors[3]);
  s.savedActorSlots.push(6);
  return s;
}

test("world loader shares prepared Models across saved Brush references while actor lifecycle stays unresolved", () => {
  const s = withBrushModels(),
    before = structuredClone(s),
    r = prepareStaticWorldSource(s, "Map");
  assert.equal(r.status, "ready", r.reason);
  const model = r.modelForReference(5);
  assert.equal(model, r.actorForReference(3).savedBrush);
  assert.equal(model, r.actorForReference(6).savedBrush);
  assert.equal(model.resource.status, "ready");
  assert.deepEqual(
    model.getBounds({ ownerIdentity: null }).bounds,
    model.resource.localBounds,
  );
  assert.deepEqual(model.resource.surfaceNodes, [[1, 3], [], [0, 2]]);
  assert.equal(r.actorForReference(3).prepared, undefined);
  assert.equal(r.summary.savedModels, 1);
  assert.equal(r.summary.preparedModels, 1);
  assert.equal(r.summary.unpreparedSavedActors, 3);
  assert.equal(r.summary.collisionStatus, "unavailable");
  assert.deepEqual(s, before);
  s.savedBrushModels.models[5].identity = "changed";
  assert.equal(model.binding.identity, "Map.Shape");
});

test("missing and corrupt Brush identities or ancestry cannot silently become empty space", () => {
  for (const change of [
    (s) => delete s.savedBrushModels.actors[3],
    (s) => (s.savedBrushModels.actors[2] = s.savedBrushModels.actors[3]),
    (s) => delete s.savedBrushModels.models[5],
    (s) => (s.savedBrushModels.models[5].exportRef = 9),
    (s) => (s.savedBrushModels.actors[3].savedReference.package = "Other"),
    (s) => (s.savedBrushModels.actors[3].modelRef = 7),
    (s) =>
      (s.savedActorBooleans.classes["engine.brush"].parent =
        "Engine.BlockingVolume"),
    (s) => delete s.savedActorBooleans.classes["engine.brush"],
  ]) {
    const s = withBrushModels();
    change(s);
    assert.equal(prepareStaticWorldSource(s, "Map").status, "unsupported");
  }
});

test("unprepared Model resource and explicit null Brush references remain distinguishable", () => {
  const s = withBrushModels();
  s.savedBrushModels.models[5].nodeSurfaces[0] = 99;
  let r = prepareStaticWorldSource(s, "Map");
  assert.equal(r.status, "ready", r.reason);
  assert.equal(r.summary.preparedModels, 0);
  assert.equal(
    r.actorForReference(3).savedBrush.getBounds({ ownerIdentity: null }).status,
    "unsupported",
  );
  s.savedBrushModels.models = {};
  for (const brush of Object.values(s.savedBrushModels.actors)) {
    brush.modelRef = brush.savedReference.reference = 0;
  }
  r = prepareStaticWorldSource(s, "Map");
  assert.equal(r.status, "ready", r.reason);
  assert.equal(r.actorForReference(3).savedBrush, null);
  assert.equal(r.actorForReference(2).savedBrush, undefined);
  assert.equal(r.summary.preparedModels, 0);
});
