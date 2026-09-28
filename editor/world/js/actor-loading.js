/** Original ULevel.PostLoad actor-world assignment.
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
