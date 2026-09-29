/** Original Interlude object localization with explicit current metadata.
 *
 * Evidence: tools/ui/check_actor_localization_native.py. The caller supplies
 * linked field order (not package export order), immutable reflection metadata,
 * current object context, configuration replies and the property's ImportText.
 * This does not resolve saved classes or parse INI files. The unquoted string
 * property importer below preserves text values using browser string storage.
 */
const uint = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
const int = (n) => Number.isInteger(n) && n >= -0x80000000 && n <= 0x7fffffff;
const text = (s) =>
  typeof s === "string" && !s.includes("\0") && s.length < 1024;
const unavailable = (reason) => ({ status: "unsupported", reason });

/** UProperty.CopyCompleteValue with qualified UStrProperty.CopySingleValue.
 * Browser strings retain all UTF-16 units, including any embedded NUL tail;
 * native pointer/count/capacity behavior is checked separately by Elbera Tools.
 * Explicit current slots only. Partial overlapping ranges are not admitted.
 */
export function copyStringPropertyValues({
  storage,
  source,
  destinationOffset,
  sourceOffset,
  arrayDim,
  elementSize,
  propertyKind,
} = {}) {
  if (propertyKind !== "StrProperty" || elementSize !== 12 || !int(arrayDim))
    return unavailable("qualified string property layout required");
  if (!(storage instanceof Map) || !(source instanceof Map))
    return unavailable(
      "current source and destination string storage required",
    );
  if (!uint(destinationOffset) || !uint(sourceOffset))
    return unavailable("current string addresses required");
  if (arrayDim <= 0) return { status: "ready", copied: 0 };
  const size = arrayDim * elementSize;
  if (
    size > 0x7fffffff ||
    sourceOffset + size > 0x100000000 ||
    destinationOffset + size > 0x100000000
  )
    return unavailable("string array exceeds bounded storage");
  if (
    source === storage &&
    sourceOffset !== destinationOffset &&
    Math.abs(sourceOffset - destinationOffset) < size
  )
    return unavailable("partially overlapping string arrays are unresolved");
  // Validate the whole admitted operation before mutating caller storage.
  for (const [map, start] of [
    [source, sourceOffset],
    [storage, destinationOffset],
  ]) {
    for (let i = 0; i < arrayDim; i++) {
      const offset = start + i * elementSize;
      if (typeof map.get(offset) !== "string")
        return unavailable("current string slot missing");
    }
    for (const offset of map.keys()) {
      if (!uint(offset) || offset > 0xfffffff4)
        return unavailable("current string address invalid");
      if (
        offset > start - elementSize &&
        offset < start + size &&
        (offset - start) % elementSize !== 0
      )
        return unavailable("string headers overlap");
    }
  }
  for (let i = 0; i < arrayDim; i++)
    storage.set(
      destinationOffset + i * elementSize,
      source.get(sourceOffset + i * elementSize),
    );
  return { status: "ready", copied: arrayDim };
}

/** Localize(section,key,package,null,1): current language, optional lookup. */
export function localizeOptionalText({
  section,
  key,
  packageName,
  environment,
} = {}) {
  if (
    ![section, key, packageName].every(text) ||
    !environment ||
    typeof environment.started !== "boolean"
  )
    return unavailable("localization context missing");
  // The original startup/configuration gate copies the key, even for optional
  // localization. A null provider means known absent GConfig; undefined is unknown.
  if (!environment.started || environment.readConfig === null)
    return { status: "ready", value: key };
  if (
    typeof environment.readConfig !== "function" ||
    !text(environment.language) ||
    !/^[\x00-\x7f]*$/.test(environment.language)
  )
    return unavailable("current language or configuration provider missing");
  let value = "";
  const languages =
    environment.language.toLowerCase() === "int"
      ? [environment.language]
      : [environment.language, "int"];
  for (const language of languages) {
    const filename = `${packageName}.${language}`;
    // Conservatively keep the filename below the original stack-local region;
    // this guard is an admitted input boundary, not an official filename rule.
    if (filename.length >= 256)
      return unavailable("localization filename exceeds bounded storage");
    let reply;
    try {
      reply = environment.readConfig({
        section,
        key,
        filename,
        capacity: 1024,
      });
    } catch {
      return unavailable("configuration lookup failed");
    }
    if (
      reply?.status !== "ready" ||
      typeof reply.found !== "boolean" ||
      (reply.value !== null && !text(reply.value))
    )
      return unavailable("configuration reply missing");
    // null explicitly preserves the supplied buffer; false does not imply it
    // was left untouched. The same buffer is passed to the English fallback.
    if (reply.value !== null) value = reply.value;
    if (reply.found) break;
  }
  return { status: "ready", value };
}

/** Recover the exact package/section/prefix selection of UObject.LoadLocalized. */
export function actorLocalizationContext({ object, classInfo, isEditor } = {}) {
  if (!uint(classInfo?.flags))
    return unavailable("current class flags missing");
  if (!(classInfo.flags & 0x20)) return { status: "ready", skipped: true };
  if (typeof isEditor !== "boolean") return unavailable("editor state missing");
  if (isEditor) return { status: "ready", skipped: true };
  if (!int(object?.index)) return unavailable("current object index missing");
  let packageName,
    section,
    prefix = null;
  if (object.index === -1) {
    packageName = classInfo.outer?.name;
    section = classInfo.name;
  } else {
    if (!uint(object.flags)) return unavailable("current object flags missing");
    if (
      object.flags & 0x100 &&
      (!object.outer || !Object.hasOwn(object.outer, "outer"))
    )
      return unavailable("current outer chain missing");
    if (object.flags & 0x100 && object.outer?.outer != null) {
      packageName = object.outer.outer.name;
      section = object.outer.name;
      prefix = object.name;
    } else {
      packageName = object.outer?.name;
      section = object.name;
    }
  }
  if (![packageName, section].every(text) || (prefix !== null && !text(prefix)))
    return unavailable("current localization names missing");
  return { status: "ready", skipped: false, packageName, section, prefix };
}

/** Walk the current linked reflection graph and dispatch original text imports.
 * field.struct is null for nonstruct properties. A struct is always traversed,
 * even when its own localized flag is clear. Offsets refer to caller storage.
 * Successful earlier imports survive a later unsupported provider/metadata path.
 */
export function loadActorLocalized(input = {}) {
  const context = actorLocalizationContext(input),
    imports = [];
  const finish = (extra) => ({ ...extra, context, imports });
  if (context.status !== "ready") return finish(context);
  if (context.skipped) return finish({ status: "ready" });
  const active = new Set();
  // Original scratch strings use 256 rotating 1024-cell buffers. Reject reuse
  // of an active prefix instead of silently assigning different alias semantics.
  const activeSlots = new Set();
  let nextSlot = 0;
  const slot = () => {
    const at = nextSlot++ & 255;
    if (activeSlots.has(at))
      throw Error("scratch string aliases an active prefix");
    return at;
  };
  const visit = (structure, prefix, base) => {
    if (!structure || active.has(structure))
      throw Error("cyclic or missing current structure");
    const inherited = new Set();
    active.add(structure);
    for (let current = structure; current !== null; current = current.super) {
      if (
        !current ||
        inherited.has(current) ||
        !Object.isFrozen(current) ||
        !Array.isArray(current.fields) ||
        !Object.isFrozen(current.fields)
      )
        throw Error("current linked structure missing, mutable or cyclic");
      inherited.add(current);
      for (const field of current.fields) {
        if (!Object.isFrozen(field) || typeof field?.isProperty !== "boolean")
          throw Error("current field classification missing or mutable");
        if (!field.isProperty) continue;
        if (!int(field.arrayDim))
          throw Error("current array dimension missing");
        for (let index = 0; index < field.arrayDim; index++) {
          const currentSlot = slot();
          if (!text(field.name)) throw Error("current property name missing");
          const key = `${prefix === null ? "" : `${prefix}.`}${field.name}${field.arrayDim > 1 ? `[${index}]` : ""}`;
          if (!text(key))
            throw Error("localization key exceeds bounded storage");
          if (!int(field.elementSize) || !int(field.offset))
            throw Error("current property layout missing");
          const offset = base + field.offset + index * field.elementSize;
          if (!uint(offset))
            throw Error("property address exceeds bounded storage");
          if (field.struct !== null) {
            activeSlots.add(currentSlot);
            visit(field.struct, key, offset);
            activeSlots.delete(currentSlot);
          } else {
            if (!uint(field.propertyFlags))
              throw Error("current property flags missing");
            if (!(field.propertyFlags & 0x8000)) continue;
            slot(); // Localize also obtains a rotating scratch string.
            const result = localizeOptionalText({
              ...context,
              key,
              environment: input.environment,
            });
            if (result.status !== "ready") throw Error(result.reason);
            if (!result.value.length) continue;
            if (field.identity === undefined)
              throw Error("current property identity missing");
            if (typeof input.importText !== "function")
              throw Error("property ImportText provider missing");
            const call = {
              field: field.identity,
              offset,
              text: result.value,
              portFlags: 0,
            };
            // ImportText's returned input pointer is ignored by the original.
            // Provider status reports whether the operation is implemented.
            const reply = input.importText(call);
            imports.push(call);
            if (reply?.status !== "ready")
              throw Error("property ImportText unavailable");
          }
        }
      }
    }
    active.delete(structure);
  };
  try {
    visit(input.classInfo.structure, context.prefix, 0);
    return finish({ status: "ready" });
  } catch (error) {
    return finish(unavailable(error.message || "localization provider failed"));
  }
}

/** UStrProperty.ImportText with port flag 2 clear, as used by localization.
 *
 * The caller must bind the original string-property dispatch and existing
 * storage explicitly. JavaScript strings preserve UTF-16 code units; native
 * heap pointers/capacities are not simulated. Other property types and the
 * quoted token parser require their own implementations.
 */
export function importStringPropertyText({
  storage,
  offset,
  text,
  portFlags,
  propertyKind,
} = {}) {
  if (propertyKind !== "StrProperty")
    return unavailable("original string-property dispatch required");
  if (!uint(portFlags) || portFlags & 2)
    return unavailable("quoted string import is unresolved");
  if (
    !(storage instanceof Map) ||
    !uint(offset) ||
    offset > 0xfffffff4 ||
    !storage.has(offset) ||
    typeof storage.get(offset) !== "string"
  )
    return unavailable("current string storage missing");
  for (const other of storage.keys()) {
    if (
      !uint(other) ||
      other > 0xfffffff4 ||
      (other !== offset && Math.abs(other - offset) < 12)
    )
      return unavailable("overlapping or unresolved string storage");
  }
  if (typeof text !== "string")
    return unavailable("source UTF-16 text missing");
  // Native strlen/copy stops at the first zero WORD. Quotes, whitespace,
  // backslashes and surrogate code units are otherwise copied unchanged.
  const end = text.indexOf("\0");
  const value = end < 0 ? text : text.slice(0, end);
  storage.set(offset, value);
  return { status: "ready", value };
}
