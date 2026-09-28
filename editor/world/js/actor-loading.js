/** Original actor Boolean loading and ULevel.PostLoad world assignment.
 * Inputs describe current object registries, class ancestry and outer identities.
 * Saved exports alone do not establish those inputs. No class-name guessing or
 * missing-reference fallback. See docs/native-static-actor-bounds-evidence.md.
 */
const scope = "original-level-actor-assignment";
const freeze = Object.freeze;
const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
function dense(value) {
  if (!Array.isArray(value) || value.length > 0x7fffffff) return false;
  for (let i = 0; i < value.length; i++)
    if (!Object.hasOwn(value, i)) return false;
  return true;
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
      if (
        flags & 0x1000 ||
        (flags & 0x2000 && archive.persistent) ||
        (flags & 0x20000000 && archive.saving)
      ) {
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
