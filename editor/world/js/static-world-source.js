/** Prepare original static actors and mesh resources for the scene loader.
 * Saved array membership remains separate from current collision population.
 * Unimplemented actor classes stay in the saved slots; they are never clear space.
 */
import {
  prepareFreshStaticActor,
  resolvePackageReference,
  applyActorBooleanTags,
  prepareSourceModel,
  prepareSourcePolys,
} from "./actor-loading.js";
import { prepareFreshStaticMeshTree } from "./static-mesh-tree.js";
import { prepareModelBounds } from "./actor-primitive-bounds.js";

const freeze = Object.freeze;
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function dense(v) {
  if (!Array.isArray(v)) return false;
  for (let i = 0; i < v.length; i++) if (!Object.hasOwn(v, i)) return false;
  return true;
}
const sourceKey = (v) => `${v.sourcePackage.toLowerCase()}:${v.exportRef}`;
const validBinding = (v) =>
  record(v) &&
  typeof v.identity === "string" &&
  v.identity.length > 0 &&
  typeof v.sourcePackage === "string" &&
  v.sourcePackage.length > 0 &&
  Number.isSafeInteger(v.exportRef) &&
  v.exportRef > 0 &&
  typeof v.classIdentity === "string" &&
  v.classIdentity.length > 0 &&
  typeof v.exportSHA256 === "string" &&
  /^[a-f0-9]{64}$/.test(v.exportSHA256);
const sameBinding = (a, b) =>
  [
    "identity",
    "sourcePackage",
    "exportRef",
    "classIdentity",
    "exportSHA256",
  ].every((key) => a[key] === b[key]);

/** Shared by the real scene loader and original-record verifier.
 * Resources that fail preparation remain explicit records. Source identities
 * include their package/export and class; equal display names never merge them.
 */
export function prepareSourceStaticActors(input) {
  const fail = (reason) => freeze({ status: "unsupported", reason });
  if (
    !record(input?.geometry) ||
    !record(input.bindings) ||
    !dense(input.actors) ||
    !record(input.actorDefaults)
  )
    return fail("source actor and resource records required");
  const objects = new Map(),
    resources = new Map(),
    meshSources = new Map(),
    actors = new Map();
  let factoryCalls = 0;
  function intern(binding) {
    if (!validBinding(binding)) throw Error("invalid source export identity");
    const key = sourceKey(binding),
      previous = objects.get(key);
    if (previous) {
      if (!sameBinding(previous.binding, binding))
        throw Error("conflicting source export identity");
      return previous;
    }
    const object = {
      identity: binding.identity,
      binding: freeze({ ...binding }),
    };
    if (binding.classIdentity === "Engine.StaticMesh") {
      const name = binding.identity.toLowerCase(),
        source = meshSources.get(name);
      if (
        source?.sourceExport?.toLowerCase() !== name ||
        source.exportSHA256 !== binding.exportSHA256
      )
        throw Error("source mesh binding differs from resource export");
      object.resource = resources.get(name);
      if (!object.resource) throw Error("missing source mesh resource");
    }
    objects.set(key, object);
    return object;
  }
  try {
    for (const [name, source] of Object.entries(input.geometry)) {
      const key = name.toLowerCase();
      if (resources.has(key)) throw Error("duplicate source mesh identity");
      resources.set(key, prepareFreshStaticMeshTree(source));
      meshSources.set(key, source);
    }
    for (const table of Object.values(input.bindings)) {
      if (!record(table?.references))
        throw Error("source reference table required");
      for (const binding of Object.values(table.references)) intern(binding);
    }
    const resolveReference = (pkg, ref) => {
      const table = input.bindings[pkg];
      const resolve = (reference) => {
        const binding = table?.references[reference];
        if (!binding) return fail("unresolved source package reference");
        factoryCalls++;
        return { status: "ready", value: objects.get(sourceKey(binding)) };
      };
      return resolvePackageReference(
        table && {
          exportCount: table.exportCount,
          importCount: table.importCount,
          createExport: (index, flags) =>
            flags === 0 ? resolve(index + 1) : fail("unsupported export flags"),
          createImport: (index) => resolve(-1 - index),
        },
        ref,
      );
    };
    const defaults = input.actorDefaults.collisionReferences?.defaults;
    if (!record(defaults)) throw Error("source reference defaults required");
    const resolvedReferenceDefaults = {};
    for (const [name, source] of Object.entries(defaults)) {
      const resolved = resolveReference(source.package, source.reference);
      if (resolved.status !== "ready")
        throw Error("unresolved source reference default");
      resolvedReferenceDefaults[name] = resolved.value;
    }
    for (const source of input.actors) {
      if (
        !Number.isSafeInteger(source?.exportRef) ||
        source.exportRef <= 0 ||
        actors.has(source.exportRef)
      )
        throw Error("duplicate or invalid source actor export");
      let prepared = prepareFreshStaticActor({
        defaults: input.actorDefaults,
        source,
        classLoading: input.classLoading,
        resolvedReferenceDefaults,
        resolveReference,
      });
      if (
        prepared.status === "ready" &&
        prepared.references.StaticMesh?.resource?.status !== "ready"
      )
        prepared = fail("actor mesh resource is not prepared");
      actors.set(source.exportRef, prepared);
    }
    for (const object of objects.values()) freeze(object);
    return freeze({
      status: "ready",
      scope: "prepared-source-static-actors",
      actors,
      resources,
      objects,
      factoryCalls,
    });
  } catch (error) {
    return fail(error.message);
  }
}

/** Load all retained static inputs, without claiming the level is playable. */
export function prepareStaticWorldSource(data, tile) {
  const fail = (reason) => freeze({ status: "unsupported", reason });
  if (
    data?.format !== "l2-static-world-source-v1" ||
    data.tile !== tile ||
    !dense(data.savedActorSlots) ||
    !record(data.savedActorSources) ||
    !dense(data.classDefaults)
  )
    return fail("invalid source world bundle");
  const prepared = prepareSourceStaticActors({
    geometry: data.meshes,
    bindings: data.savedReferenceBindings,
    actors: data.actors,
    actorDefaults: data.classDefaults.at(-1),
    classLoading: data.actorClassLoading,
  });
  if (prepared.status !== "ready") return prepared;
  const byRef = new Map(),
    savedSlots = [],
    missing = new Map(),
    models = new Map(),
    polys = new Map();
  try {
    const brushes = data.savedBrushModels;
    if (brushes !== undefined) {
      if (
        brushes?.scope !== "saved-brush-model-resources" ||
        !record(brushes.models) ||
        !record(brushes.actors)
      )
        throw Error("invalid saved Brush Model bundle");
      if (brushes.polys !== undefined) {
        if (!record(brushes.polys))
          throw Error("invalid saved Polys resource bundle");
        for (const [key, source] of Object.entries(brushes.polys)) {
          const ref = Number(key);
          if (
            String(ref) !== key ||
            !validBinding(source) ||
            source.exportRef !== ref ||
            source.sourcePackage !== data.tile ||
            source.classIdentity !== "Engine.Polys"
          )
            throw Error("invalid saved Polys identity");
          polys.set(
            ref,
            freeze({
              identity: source.identity,
              binding: freeze(
                Object.fromEntries(
                  [
                    "identity",
                    "sourcePackage",
                    "exportRef",
                    "classIdentity",
                    "exportSHA256",
                  ].map((name) => [name, source[name]]),
                ),
              ),
              resource: prepareSourcePolys(source, brushes.polysClassLoading),
            }),
          );
        }
      }
      const usedPolys = new Set();
      for (const [key, source] of Object.entries(brushes.models)) {
        const ref = Number(key);
        if (
          String(ref) !== key ||
          !validBinding(source) ||
          source.exportRef !== ref ||
          source.sourcePackage !== data.tile ||
          source.classIdentity !== "Engine.Model" ||
          polys.has(ref)
        )
          throw Error("invalid saved Model identity");
        const resource = prepareSourceModel(source, brushes.classLoading);
        let polygonResource;
        if (brushes.polys !== undefined) {
          const ref = source.polysReference;
          if (
            !Number.isSafeInteger(ref) ||
            ref < 0 ||
            (ref !== 0 && !polys.has(ref))
          )
            throw Error(
              "Model Polys reference differs from loaded resource set",
            );
          polygonResource = ref === 0 ? null : polys.get(ref);
          if (ref !== 0) usedPolys.add(ref);
        }
        const binding = freeze(
          Object.fromEntries(
            [
              "identity",
              "sourcePackage",
              "exportRef",
              "classIdentity",
              "exportSHA256",
            ].map((name) => [name, source[name]]),
          ),
        );
        models.set(
          ref,
          freeze({
            identity: source.identity,
            binding,
            resource,
            polys: polygonResource,
            getBounds(input) {
              if (resource.status !== "ready") return resource;
              return prepareModelBounds({
                ...input,
                localBounds: resource.localBounds,
              });
            },
          }),
        );
      }
      if ([...polys.keys()].some((ref) => !usedPolys.has(ref)))
        throw Error("saved Polys has no Model reference");
      for (const [key, brush] of Object.entries(brushes.actors)) {
        if (
          !record(brush) ||
          !Object.hasOwn(data.savedActorSources, key) ||
          brush.sourceClass !== data.savedActorSources[key]?.classIdentity ||
          brush.modelRef !== brush.savedReference?.reference ||
          !Number.isSafeInteger(brush.modelRef) ||
          brush.modelRef < 0 ||
          (brush.modelRef !== 0 &&
            (brush.savedReference.package !== data.tile ||
              !models.has(brush.modelRef)))
        )
          throw Error("saved Brush reference differs from Model resources");
      }
      const classes = data.savedActorBooleans?.classes;
      if (!record(classes)) throw Error("Brush class ancestry required");
      for (const [key, source] of Object.entries(data.savedActorSources)) {
        let name = source.classIdentity.toLowerCase(),
          isBrush = false;
        const seen = new Set();
        while (name) {
          const cls = classes[name];
          if (
            seen.has(name) ||
            cls?.sourceClass?.toLowerCase() !== name ||
            (cls.parent !== null && typeof cls.parent !== "string")
          )
            throw Error("invalid Brush class ancestry");
          seen.add(name);
          isBrush ||= name === "engine.brush";
          name = cls.parent?.toLowerCase();
        }
        if (isBrush !== Object.hasOwn(brushes.actors, key))
          throw Error("saved Brush actor set differs from class ancestry");
      }
      const used = new Set(
        Object.values(brushes.actors).map((brush) => brush.modelRef),
      );
      if ([...models.keys()].some((ref) => !used.has(ref)))
        throw Error("saved Model has no Brush reference");
    }
    const booleans = data.savedActorBooleans;
    const booleanLayout = data.classDefaults.at(-1)?.collisionBooleans?.layout;
    if (
      booleans !== undefined &&
      (booleans?.scope !== "saved-actor-declared-booleans" ||
        !dense(booleanLayout) ||
        !record(booleans.classes) ||
        !record(booleans.actors) ||
        Object.keys(booleans.actors).length !==
          Object.keys(data.savedActorSources).length)
    )
      throw Error("invalid saved actor Boolean bundle");
    for (const [key, source] of Object.entries(data.savedActorSources)) {
      const ref = Number(key);
      if (
        !Number.isSafeInteger(ref) ||
        String(ref) !== key ||
        ref <= 0 ||
        !validBinding(source) ||
        source.exportRef !== ref ||
        source.sourcePackage !== tile
      )
        throw Error("invalid saved actor identity");
      const existing = prepared.objects.get(sourceKey(source));
      if (existing && !sameBinding(existing.binding, source))
        throw Error("saved actor binding differs");
      let savedGroups;
      if (booleans !== undefined) {
        const saved = booleans.actors[key];
        const defaults = booleans.classes[source.classIdentity.toLowerCase()];
        if (
          saved?.scope !== "saved-actor-declared-booleans" ||
          saved.sourceClass !== source.classIdentity ||
          defaults?.sourceClass?.toLowerCase() !==
            source.classIdentity.toLowerCase()
        )
          throw Error("saved actor Boolean class differs from source");
        const loaded = applyActorBooleanTags({
          layout: booleanLayout,
          words: defaults.actorBooleans?.groups,
          tags: saved.tags,
          archive: { loading: true, saving: false, persistent: true },
        });
        if (
          loaded.status !== "ready" ||
          !record(saved.groups) ||
          Object.keys(saved.groups).length !== booleanLayout.length
        )
          throw Error("saved actor Boolean tags cannot be verified");
        for (const { offset } of booleanLayout) {
          const actual = loaded.groups[offset],
            expected = saved.groups[offset];
          if (
            !expected ||
            actual.mask !== expected.mask ||
            actual.value !== expected.value
          )
            throw Error("saved actor Boolean groups differ from retained tags");
        }
        savedGroups = loaded.groups;
      }
      byRef.set(
        ref,
        freeze({
          identity: source.identity,
          source,
          // Kept separate from constructed/PostLoad state, especially for movers
          // and volumes whose subclass lifecycle is not prepared here.
          savedGroups,
          savedBrush:
            brushes?.actors[key] === undefined
              ? undefined
              : brushes.actors[key].modelRef === 0
                ? null
                : models.get(brushes.actors[key].modelRef),
          prepared: prepared.actors.get(ref),
        }),
      );
    }
    for (const source of data.actors) {
      const bound = byRef.get(source.exportRef);
      if (
        bound?.source.classIdentity !== "Engine.StaticMeshActor" ||
        bound.source.exportSHA256 !== source.exportSHA256
      )
        throw Error("static actor does not match saved export");
    }
    for (const ref of data.savedActorSlots) {
      if (ref === 0) {
        savedSlots.push(null);
        continue;
      }
      const actor = byRef.get(ref);
      if (!actor) throw Error("saved actor slot has no source identity");
      savedSlots.push(actor);
      if (actor.prepared?.status !== "ready")
        missing.set(
          ref,
          freeze({
            reference: ref,
            identity: actor.identity,
            sourceClass: actor.source.classIdentity,
            reason:
              actor.prepared?.reason ??
              "actor class preparation is not implemented",
          }),
        );
    }
    const mode = data.savedLevelCollisionMode,
      defaults = data.levelCollisionDefaults;
    if (
      mode?.scope !== "saved-level-info-collision-mode" ||
      mode.reference !== data.savedActorSlots[0] ||
      byRef.get(mode.reference)?.source.classIdentity !== "Engine.LevelInfo" ||
      byRef.get(mode.reference)?.identity !== mode.identity
    )
      throw Error("saved LevelInfo identity does not match first actor");
    const savedMode = applyActorBooleanTags({
      layout: defaults?.layout,
      words: defaults?.defaultGroups,
      tags: mode.tags,
      archive: { loading: true, saving: false, persistent: true },
    });
    if (savedMode.status !== "ready")
      throw Error("saved LevelInfo mode cannot be prepared");
    const modeWord = savedMode.groups["0x554"],
      recorded = mode.groups?.["0x554"];
    if (
      modeWord?.mask !== 7 ||
      recorded?.mask !== 7 ||
      recorded.value !== modeWord.value
    )
      throw Error("saved LevelInfo mode differs from retained bits");
    const summary = freeze({
      tile,
      savedSlots: savedSlots.length,
      staticActors: prepared.actors.size,
      preparedActors: [...prepared.actors.values()].filter(
        (v) => v.status === "ready",
      ).length,
      meshes: prepared.resources.size,
      preparedMeshes: [...prepared.resources.values()].filter(
        (v) => v.status === "ready",
      ).length,
      unpreparedSavedActors: missing.size,
      actorsWithSavedBooleans: [...byRef.values()].filter(
        (v) => v.savedGroups !== undefined,
      ).length,
      savedModels: models.size,
      preparedModels: [...models.values()].filter(
        (model) => model.resource.status === "ready",
      ).length,
      savedPolys: polys.size,
      preparedPolysHeaders: [...polys.values()].filter(
        (poly) => poly.resource.status === "ready",
      ).length,
      collisionStatus: "unavailable",
      reason:
        "current level startup, actor providers and world query integration are unfinished",
    });
    return freeze({
      status: "ready",
      scope: "prepared-static-world-source",
      summary,
      savedSlots: freeze(savedSlots),
      savedMode: savedMode.groups,
      unpreparedActors: freeze([...missing.values()]),
      actorForReference: (ref) => byRef.get(ref),
      modelForReference: (ref) => models.get(ref),
      polysForReference: (ref) => polys.get(ref),
    });
  } catch (error) {
    return fail(error.message);
  }
}

export async function loadStaticWorldSource(
  tile,
  reference,
  fetcher = fetch,
  signal,
) {
  if (reference == null) return null;
  if (reference !== "static-world-source.json")
    throw Error("invalid source world reference");
  const response = await fetcher(
    `/scenes/${encodeURIComponent(tile)}/${reference}`,
    { signal },
  );
  if (!response.ok) throw Error(`source world: HTTP ${response.status}`);
  const prepared = prepareStaticWorldSource(await response.json(), tile);
  if (prepared.status !== "ready") throw Error(prepared.reason);
  return prepared;
}
