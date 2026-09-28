/** Original actor property loading and ULevel.PostLoad world assignment.
 * Inputs describe current object registries, class ancestry and outer identities.
 * Saved exports alone do not establish those inputs. No class-name guessing or
 * missing-reference fallback. See docs/native-static-actor-bounds-evidence.md.
 */
const scope = "original-level-actor-assignment";
const freeze = Object.freeze;
const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const sint = (value) =>
  Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
const propertySkipped = (flags, archive) =>
  !!(
    flags & 0x1000 ||
    (flags & 0x2000 && archive.persistent) ||
    (flags & 0x20000000 && archive.saving)
  );
function dense(value) {
  if (!Array.isArray(value) || value.length > 0x7fffffff) return false;
  for (let i = 0; i < value.length; i++)
    if (!Object.hasOwn(value, i)) return false;
  return true;
}

/** Copy decoded dimension-one transform defaults, then admit tags in source
 * order. Vector/Rotator components retain their Float32/int32 representation;
 * no renderer axis conversion, combined scale or trigonometry belongs here.
 * This consumes validated archive values, not raw tagged or binary archives.
 */
export function applyActorTransformTags(input) {
  const resultScope = "original-actor-transform-loading";
  const fields = new Map(),
    values = new Map(),
    skipped = [];
  const finite = (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    Object.is(Math.fround(value), value);
  const kinds = new Map([
    ["Location", ["StructProperty", "Core.Object.Vector"]],
    ["Rotation", ["StructProperty", "Core.Object.Rotator"]],
    ["DrawScale", ["FloatProperty", null]],
    ["DrawScale3D", ["StructProperty", "Core.Object.Vector"]],
    ["PrePivot", ["StructProperty", "Core.Object.Vector"]],
  ]);
  try {
    const require = (condition, reason) => {
      if (!condition) throw Error(reason);
    };
    const archive = input?.archive;
    require(archive?.loading === true &&
      archive.saving === false &&
      typeof archive.persistent ===
        "boolean", "explicit loading archive required");
    require(dense(input.layout) &&
      dense(input.tags), "dense declarations and tags required");
    const copy = (field, value) => {
      if (field.kind === "FloatProperty") {
        require(finite(value), "finite Float32 default or tag required");
        return value;
      }
      require(dense(value) &&
        value.length === 3 &&
        value.every(
          field.reference === "Core.Object.Rotator" ? sint : finite,
        ), "three original Vector or Rotator components required");
      return freeze([...value]);
    };
    for (const field of input.layout) {
      const type = kinds.get(field?.name);
      require(type &&
        field.kind === type[0] &&
        field.reference === type[1] &&
        uint(field.propertyFlags) &&
        !fields.has(
          field.name,
        ), "unique original transform declarations required");
      require(input.defaults &&
        Object.hasOwn(
          input.defaults,
          field.name,
        ), "explicit source transform defaults required");
      fields.set(field.name, field);
      values.set(field.name, copy(field, input.defaults[field.name]));
    }
    require(fields.size ===
      kinds.size, "all five transform declarations required");
    for (let index = 0; index < input.tags.length; index++) {
      const tag = input.tags[index],
        field = fields.get(tag?.name);
      require(field, "declared transform tag required");
      if (propertySkipped(field.propertyFlags, archive)) {
        skipped.push(index);
        continue;
      }
      values.set(field.name, copy(field, tag.value));
    }
    return freeze({
      status: "ready",
      scope: resultScope,
      values: freeze(Object.fromEntries(values)),
      skipped: freeze(skipped),
    });
  } catch (error) {
    return freeze({
      status: "unsupported",
      scope: resultScope,
      reason: error.message,
    });
  }
}

/** Join the consumed StaticMeshActor property families using one persistent
 * archive mode and the same object resolver. No partial actor escapes failure.
 * This is a property initialization boundary; native object headers, PostLoad,
 * level assignment and gameplay writes remain separate lifecycle operations.
 * Inputs must stay stable. The resolver must not inspect or mutate an actor
 * being deserialized: cross-family archive interleaving is outside this entry.
 */
export function prepareStaticActorProperties(input) {
  const resultScope = "original-static-actor-properties";
  const archive = { loading: true, saving: false, persistent: true };
  const defaults = input?.defaults;
  const source = input?.source;
  const groups = defaults?.collisionBooleans?.layout;
  const referencesLayout = defaults?.collisionReferences?.layout;
  const groupOffsets = dense(groups)
    ? groups.map((group) => group?.offset)
    : null;
  const referenceNames = dense(referencesLayout)
    ? referencesLayout.map((field) => field?.name)
    : null;
  if (
    !dense(groupOffsets) ||
    groupOffsets.length !== 4 ||
    !["0x64", "0x74", "0x2e4", "0x2f8"].every((key) =>
      groupOffsets.includes(key),
    ) ||
    !dense(referenceNames) ||
    referenceNames.length !== 7 ||
    ![
      "StaticMesh",
      "Owner",
      "Level",
      "XLevel",
      "Mesh",
      "Brush",
      "AntiPortal",
    ].every((key) => referenceNames.includes(key))
  ) {
    return freeze({
      status: "unsupported",
      scope: resultScope,
      reason: "all consumed Boolean groups and reference declarations required",
    });
  }
  const transform = applyActorTransformTags({
    archive,
    layout: defaults?.collisionTransforms?.layout,
    defaults: defaults?.collisionTransforms?.defaults,
    tags: source?.savedTransform?.tags,
  });
  if (transform.status !== "ready")
    return freeze({ ...transform, scope: resultScope });
  const booleans = applyActorBooleanTags({
    archive,
    layout: defaults?.collisionBooleans?.layout,
    words: defaults?.collisionBooleans?.defaultGroups,
    tags: source?.savedCollisionFlags?.tags,
  });
  if (booleans.status !== "ready")
    return freeze({ ...booleans, scope: resultScope });
  const references = applyActorReferenceTags({
    archive,
    layout: defaults?.collisionReferences?.layout,
    defaults: input?.resolvedReferenceDefaults,
    tags: source?.savedReferences?.tags,
    resolveReference: input?.resolveReference,
  });
  if (references.status !== "ready")
    return freeze({ ...references, scope: resultScope });
  const values = transform.values;
  return freeze({
    status: "ready",
    scope: resultScope,
    transform: freeze({
      location: values.Location,
      rotation: values.Rotation,
      drawScale: values.DrawScale,
      drawScale3D: values.DrawScale3D,
      prePivot: values.PrePivot,
    }),
    groups: booleans.groups,
    references: references.references,
    skipped: freeze({
      transforms: transform.skipped,
      booleans: booleans.skipped,
      references: references.skipped,
    }),
  });
}

/** Apply already validated Boolean tags to supplied actor words in tag order.
 * Layout comes from linked declarations; words retain an explicit known-bit
 * mask. The original property gate precedes each write. This is not a generic
 * archive decoder, default constructor, or proof of a live actor's state.
 */
export function applyActorBooleanTags(input) {
  const groups = {};
  const skipped = [];
  const resultScope = "original-actor-boolean-loading";
  try {
    const require = (condition, reason) => {
      if (!condition) throw Error(reason);
    };
    const archive = input?.archive;
    require(archive &&
      ["loading", "saving", "persistent"].every(
        (name) => typeof archive[name] === "boolean",
      ), "explicit archive modes required");
    require(dense(input.layout) &&
      dense(input.tags), "dense layout and tags required");
    const fields = new Map();
    for (const group of input.layout) {
      const offset = Number.parseInt(group?.offset, 16);
      require(typeof group?.offset === "string" &&
        uint(offset) &&
        offset % 4 === 0 &&
        group.offset === `0x${offset.toString(16)}` &&
        !Object.hasOwn(
          groups,
          group.offset,
        ), "unique source word offsets required");
      require(dense(group.fields), "dense declared fields required");
      const word = input.words?.[group.offset];
      require(word &&
        Object.hasOwn(input.words, group.offset) &&
        uint(word.mask) &&
        uint(word.value) &&
        (word.value & ~word.mask) >>> 0 ===
          0, "explicit known word bits required");
      groups[group.offset] = { mask: word.mask, value: word.value };
      let declaredMask = 0;
      for (const field of group.fields) {
        require(typeof field?.name === "string" &&
          field.name.length &&
          !fields.has(field.name), "unique declared field names required");
        require(uint(field.mask) &&
          field.mask !== 0 &&
          (field.mask & (field.mask - 1)) === 0 &&
          !(declaredMask & field.mask) &&
          uint(
            field.propertyFlags,
          ), "source Boolean masks and property flags required");
        declaredMask = (declaredMask | field.mask) >>> 0;
        fields.set(field.name, { ...field, offset: group.offset });
      }
      require(group.mask ===
        declaredMask, "declared group mask differs from fields");
    }
    for (let index = 0; index < input.tags.length; index++) {
      const tag = input.tags[index];
      const field = fields.get(tag?.name);
      require(field &&
        typeof tag.value ===
          "boolean", "validated declared Boolean tags required");
      const flags = field.propertyFlags;
      if (propertySkipped(flags, archive)) {
        skipped.push(index);
        continue;
      }
      if (!archive.loading) continue;
      const word = groups[field.offset];
      word.value =
        (tag.value ? word.value | field.mask : word.value & ~field.mask) >>> 0;
      word.mask = (word.mask | field.mask) >>> 0;
    }
    for (const word of Object.values(groups)) freeze(word);
    return freeze({
      status: "ready",
      scope: resultScope,
      groups: freeze(groups),
      skipped: freeze(skipped),
    });
  } catch (error) {
    // Do not expose partially applied output after a later unsupported tag.
    return freeze({
      status: "unsupported",
      scope: resultScope,
      reason: error.message,
    });
  }
}

/** ULinkerLoad.IndexToObject: signed package index to the selected object
 * factory. Factories own construction/cache state; saved names alone are not
 * current objects. Counts and synchronous replies must remain stable.
 */
export function resolvePackageReference(linker, reference) {
  const resultScope = "original-package-reference";
  const fail = (reason) =>
    freeze({ status: "unsupported", scope: resultScope, reason });
  if (!sint(reference)) return fail("signed source package index required");
  if (reference === 0)
    return freeze({ status: "ready", scope: resultScope, value: null });
  const imported = reference < 0;
  const index = imported ? -1 - reference : reference - 1;
  const count = linker?.[imported ? "importCount" : "exportCount"];
  if (!sint(count) || count < 0 || index >= count)
    return fail("source package reference outside selected table");
  const method = imported ? "createImport" : "createExport";
  if (typeof linker[method] !== "function")
    return fail("current object factory required");
  const reply = imported ? linker[method](index) : linker[method](index, 0);
  if (
    reply?.status !== "ready" ||
    !Object.hasOwn(reply, "value") ||
    reply.value === undefined
  )
    return fail("unresolved current object factory response");
  return freeze({ status: "ready", scope: resultScope, value: reply.value });
}

/** Copy dimension-one ordinary reference defaults, then apply tagged loading.
 * The caller supplies resolved default identities and a package-index resolver.
 * Transient fields remain at their incoming defaults during persistent loading;
 * the separate Level.PostLoad assignment writes XLevel later. Skipped payloads
 * do not trigger resolution. Unknown output is never replaced with null.
 */
export function applyActorReferenceTags(input) {
  const resultScope = "original-actor-reference-loading";
  const references = new Map(),
    fields = new Map(),
    skipped = [];
  try {
    const require = (condition, reason) => {
      if (!condition) throw Error(reason);
    };
    const archive = input?.archive;
    require(archive?.loading === true &&
      archive.saving === false &&
      typeof archive.persistent ===
        "boolean", "explicit loading archive required");
    require(dense(input.layout) &&
      dense(input.tags), "dense declarations and tags required");
    for (const field of input.layout) {
      require(typeof field?.name === "string" &&
        field.name.length &&
        !fields.has(field.name) &&
        field.kind === "ObjectProperty" &&
        uint(
          field.propertyFlags,
        ), "unique source object-reference declarations required");
      // UObjectProperty.CopyCompleteValue can duplicate subobjects with this
      // flag. The seven decoded collision references have it clear.
      require(!(
        field.propertyFlags & 0x400000
      ), "subobject duplication requires its original copy path");
      require(input.defaults &&
        Object.hasOwn(input.defaults, field.name) &&
        input.defaults[field.name] !==
          undefined, "resolved reference defaults required");
      fields.set(field.name, field);
      references.set(field.name, input.defaults[field.name]);
    }
    for (let index = 0; index < input.tags.length; index++) {
      const tag = input.tags[index],
        field = fields.get(tag?.name);
      require(field, "declared reference tag required");
      if (propertySkipped(field.propertyFlags, archive)) {
        skipped.push(index);
        continue;
      }
      require(sint(tag.reference) &&
        tag.package !== undefined &&
        typeof input.resolveReference ===
          "function", "decoded reference and current resolver required");
      const reply = input.resolveReference(tag.package, tag.reference);
      require(reply?.status === "ready" &&
        Object.hasOwn(reply, "value") &&
        reply.value !== undefined, "unresolved loaded reference");
      references.set(field.name, reply.value);
    }
    return freeze({
      status: "ready",
      scope: resultScope,
      references: freeze(Object.fromEntries(references)),
      skipped: freeze(skipped),
    });
  } catch (error) {
    // Factories may already have created objects; these are not rolled back.
    // Do not expose a partially loaded actor as an admitted result.
    return freeze({
      status: "unsupported",
      scope: resultScope,
      reason: error.message,
    });
  }
}

/** Collect the ordered XLevel/tag writes from both original registry passes.
 * The caller supplies stable synchronous state and applies each returned write
 * to the corresponding actor. Nulls and repeated identities retain source order.
 * This covers the assignment loops after UObject.PostLoad, not the whole method.
 */
export function collectLevelActorAssignments(input) {
  const assignments = [];
  const result = (status, reason) =>
    freeze({
      status,
      scope,
      assignments: freeze([...assignments]),
      ...(reason ? { reason } : {}),
    });
  const require = (condition, reason) => {
    if (!condition) throw Error(reason);
  };
  try {
    require(input?.level?.identity != null, "current level identity required");
    require(dense(input.registry) &&
      dense(input.buffer), "dense current object lists required");
    require(input.objects instanceof Map &&
      input.classParents instanceof
        Map, "current object and class identity maps required");
    require(input.actorClass != null &&
      input.playerControllerClass != null &&
      input.actorClass !==
        input.playerControllerClass, "distinct source class identities required");
    function isA(object, target) {
      let cls = object.classIdentity;
      const visited = new Set();
      for (;;) {
        require(cls !== undefined, "unresolved current class or parent");
        if (cls === null) return false;
        if (cls === target) return true;
        require(!visited.has(cls), "cyclic current class ancestry");
        visited.add(cls);
        require(input.classParents.has(cls), "missing current class parent");
        cls = input.classParents.get(cls);
      }
    }
    for (const [source, list] of [
      ["registry", input.registry],
      ["buffer", input.buffer],
    ]) {
      for (let index = 0; index < list.length; index++) {
        const identity = list[index];
        require(identity !== undefined, "unresolved object-list slot");
        if (identity === null) continue;
        const object = input.objects.get(identity);
        require(object &&
          typeof object === "object", "unresolved registered object");
        if (!isA(object, input.actorClass)) continue;
        require(object.outerIdentity !== undefined &&
          input.level.outerIdentity !==
            undefined, "explicit current object and level outer identities required");
        if (object.outerIdentity !== input.level.outerIdentity) continue;
        if (isA(object, input.playerControllerClass)) {
          require(uint(
            object.playerControllerFlags5ac,
          ), "current PlayerController flags5ac required");
          if (object.playerControllerFlags5ac & 0x100) continue;
        }
        assignments.push(
          freeze({
            source,
            index,
            identity,
            writes: freeze({
              xLevelIdentity: input.level.identity,
              collisionTag: 0,
            }),
          }),
        );
      }
    }
    return result("ready");
  } catch (error) {
    return result("unsupported", error.message);
  }
}
