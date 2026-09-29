import { initializeClassDefaultProperties } from "./actor-loading.js";

const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const dense = (value) =>
  Array.isArray(value) &&
  Array.from({ length: value.length }, (_, i) => i in value).every(Boolean);
const bytesOf = (value) => {
  if (!dense(value) || value.some((byte) => !uint(byte) || byte > 255))
    throw Error("complete byte storage required");
  return Uint8Array.from(value);
};
const requireValue = (condition, reason) => {
  if (!condition) throw Error(reason);
};
const kinds = new Map([
  ["ByteProperty", 1],
  ["IntProperty", 2],
  ["BoolProperty", 3],
  ["FloatProperty", 4],
  ["ObjectProperty", 5],
  ["ClassProperty", 5],
  ["NameProperty", 6],
  ["ArrayProperty", 9],
  ["StructProperty", 10],
  ["StrProperty", 13],
]);
const indirect = new Set([
  "ObjectProperty",
  "ClassProperty",
  "NameProperty",
  "ArrayProperty",
  "StrProperty",
]);

/** Load the admitted original file-123 class-default stream.
 * Linked layouts, current name identities and resolved references are explicit
 * inputs. This initializes a body from its parent, performs specialized copies,
 * then reads packed property tags using the original matching-type paths.
 * Scalar bytes retain their bits; native pointers/headers are projected into
 * separate values. This does not bind a live class, localize/configure it, run
 * script, or admit mismatched-type compatibility conversions.
 */
export function loadClassDefaultProperties({
  layout,
  structures,
  parent = null,
  payload,
  resolveName,
  resolveReference,
  archiveFlags1c,
} = {}) {
  const scope = "original-class-default-tag-loading";
  try {
    requireValue(
      layout?.status === "ready" &&
        uint(layout.propertiesSize) &&
        layout.propertiesSize >= 0x34 &&
        layout.propertiesSize <= 0x7fffffff,
      "qualified current class layout required",
    );
    requireValue(
      structures instanceof Map &&
        typeof resolveName === "function" &&
        typeof resolveReference === "function" &&
        uint(archiveFlags1c),
      "current structure, name, reference and archive providers required",
    );
    const size = layout.propertiesSize,
      defaultSize = parent?.size ?? 0;
    requireValue(
      layout.parentSize === defaultSize,
      "known parent size must match initialized parent storage",
    );
    requireValue(
      parent === null ||
        (parent.status === "ready" &&
          parent.scope === scope &&
          uint(defaultSize) &&
          defaultSize >= 0x34 &&
          defaultSize <= size),
      "initialized parent default storage required",
    );
    const bytes = new Uint8Array(size),
      values = new Map(parent?.values ?? []),
      slots = new Map(),
      applied = [];
    if (parent) {
      requireValue(
        parent.bytes.length === defaultSize,
        "complete parent bytes required",
      );
      bytes.set(bytesOf(parent.bytes));
    }
    const structure = (field) => {
      const result = structures.get(field.reference);
      requireValue(
        result?.status === "ready" &&
          uint(result.nameId) &&
          result.propertiesSize === field.elementSize,
        "current nested structure layout and name identity required",
      );
      return result;
    };
    const fieldsOf = (owner) => {
      requireValue(
        dense(owner.fields),
        "complete current property fields required",
      );
      const identities = new Set();
      for (const field of owner.fields)
        requireValue(
          kinds.has(field?.kind) &&
            uint(field.nameId) &&
            field.nameId !== 0 &&
            uint(field.offset) &&
            uint(field.elementSize) &&
            field.elementSize > 0 &&
            uint(field.arrayDim) &&
            field.arrayDim > 0 &&
            uint(field.propertyFlags) &&
            field.offset + field.elementSize * field.arrayDim <=
              owner.propertiesSize,
          "qualified current property metadata required",
        );
      for (const field of owner.fields) {
        requireValue(
          typeof field.identity === "string" && !identities.has(field.identity),
          "unique property identities required",
        );
        identities.add(field.identity);
      }
      requireValue(
        dense(owner.lists?.["0x70"]) &&
          owner.lists["0x70"].length === owner.fields.length &&
          owner.lists["0x70"].every(
            (id, index) => id === owner.fields[index].identity,
          ),
        "complete ordered property lookup list required",
      );
      return owner.fields;
    };
    const walk = (owner, base, ancestors = new Set()) => {
      requireValue(!ancestors.has(owner), "cyclic nested value layout");
      const path = new Set(ancestors).add(owner);
      for (const field of fieldsOf(owner))
        for (let index = 0; index < field.arrayDim; index++) {
          const offset = base + field.offset + field.elementSize * index;
          if (offset < 0x34) {
            requireValue(
              base === 0 && offset + field.elementSize <= 0x34,
              "property crosses native header boundary",
            );
            continue;
          }
          requireValue(
            offset >= 0x34 && offset + field.elementSize <= size,
            "property outside object body",
          );
          if (field.kind === "StructProperty")
            walk(structure(field), offset, path);
          else if (indirect.has(field.kind)) {
            requireValue(
              !slots.has(offset),
              "overlapping indirect property slots",
            );
            slots.set(offset, field.kind);
            if (offset < defaultSize)
              requireValue(
                values.has(offset) && values.get(offset) !== undefined,
                "unknown inherited property value",
              );
            else
              values.set(
                offset,
                field.kind === "NameProperty"
                  ? 0
                  : field.kind === "StrProperty"
                    ? ""
                    : field.kind === "ArrayProperty"
                      ? Object.freeze([])
                      : null,
              );
            bytes.fill(0, offset, offset + field.elementSize);
          }
        }
    };
    walk(layout, 0);
    const fields = new Map(
      layout.fields.map((field) => [field.identity, field]),
    );
    const specialized = layout.fields
      .filter((field) => field.propertyFlags & 0x400000)
      .map((field) => field.identity);
    requireValue(
      dense(layout.lists?.["0x78"]) &&
        layout.lists["0x78"].length === specialized.length &&
        layout.lists["0x78"].every((id, index) => id === specialized[index]),
      "complete specialized-copy list required",
    );
    const copied = initializeClassDefaultProperties({
      size,
      defaultSize,
      fields: layout.lists["0x78"].map((id) => fields.get(id)),
      defaults: values,
      instancingObject: null,
    });
    requireValue(copied.status === "ready", copied.reason);
    for (const [offset, value] of copied.values) values.set(offset, value);
    const input = bytesOf(payload);
    let cursor = 0;
    const take = (count) => {
      requireValue(
        uint(count) && cursor + count <= input.length,
        "truncated property archive",
      );
      const result = input.slice(cursor, cursor + count);
      cursor += count;
      return result;
    };
    const number = (count) => {
      const data = take(count);
      return data.reduce(
        (value, byte, index) => value + byte * 2 ** (index * 8),
        0,
      );
    };
    const compact = () => {
      const first = number(1);
      let value = first & 63,
        more = first & 64,
        shift = 6,
        count = 1;
      while (more) {
        requireValue(count < 5, "compact index exceeds admitted width");
        const byte = number(1);
        value += (byte & 127) * 2 ** shift;
        shift += 7;
        more = byte & 128;
        count++;
      }
      requireValue(value <= 0x7fffffff, "compact index outside signed profile");
      return first & 128 ? -value : value;
    };
    const name = () => {
      const value = resolveName(compact());
      requireValue(uint(value), "unresolved current name identity");
      return value;
    };
    const serializable = (field) =>
      !(field.propertyFlags & 0x1000) &&
      (!(field.propertyFlags & 0x2000) || archiveFlags1c === 0);
    const write = (offset, data) => {
      requireValue(
        offset >= 0x34 && offset + data.length <= size,
        "property write outside object body",
      );
      bytes.set(data, offset);
    };
    const scalar = (field, offset) => {
      if (field.kind === "ByteProperty") {
        requireValue(field.elementSize === 1, "byte stride mismatch");
        write(offset, take(1));
      } else if (
        field.kind === "IntProperty" ||
        field.kind === "FloatProperty"
      ) {
        requireValue(field.elementSize === 4, "scalar stride mismatch");
        write(offset, take(4));
      } else if (
        field.kind === "ObjectProperty" ||
        field.kind === "ClassProperty"
      ) {
        requireValue(field.elementSize === 4, "reference stride mismatch");
        const value = resolveReference(compact());
        requireValue(
          value !== undefined,
          "unresolved current object reference",
        );
        values.set(offset, value);
      } else if (field.kind === "NameProperty") {
        requireValue(field.elementSize === 4, "name stride mismatch");
        values.set(offset, name());
      } else if (field.kind === "StrProperty") {
        requireValue(field.elementSize === 12, "string header stride mismatch");
        const count = compact(),
          length = Math.abs(count),
          width = count < 0 ? 2 : 1;
        requireValue(
          length <= 0x3fffffff && length * width <= input.length - cursor,
          "string exceeds admitted storage",
        );
        const units = Array.from({ length }, () => number(width));
        if (length > 1)
          requireValue(
            units.at(-1) === 0,
            "unterminated string outside admitted profile",
          );
        let text = "";
        if (length > 1)
          for (let index = 0; index < length - 1; index++)
            text += String.fromCharCode(units[index]);
        values.set(offset, text);
      } else if (field.kind === "StructProperty") {
        const nested = structure(field);
        if ([0x57, 0x58, 0x5a].includes(nested.nameId)) {
          for (const member of fieldsOf(nested))
            if (serializable(member))
              for (let index = 0; index < member.arrayDim; index++)
                scalar(
                  member,
                  offset + member.offset + member.elementSize * index,
                );
        } else tagged(nested, offset);
      } else throw Error("property serializer branch remains unsupported");
    };
    const tagged = (owner, base) => {
      const all = new Map(
        fieldsOf(owner).map((field) => [field.identity, field]),
      );
      requireValue(
        dense(owner.lists?.["0x70"]),
        "current property lookup list required",
      );
      const candidates = owner.lists["0x70"].map((id) => {
        const field = all.get(id);
        requireValue(field, "unknown property-list identity");
        return field;
      });
      while (true) {
        const nameId = name();
        if (nameId === 0) return;
        const info = number(1),
          type = info & 15,
          selector = (info >> 4) & 7;
        const structNameId = type === 10 ? name() : undefined;
        const length =
          selector < 5
            ? [1, 2, 4, 12, 16][selector]
            : number(selector === 5 ? 1 : selector === 6 ? 2 : 4);
        let index = 0;
        if (type !== 3 && info & 128) {
          const byte = number(1);
          index =
            byte < 128
              ? byte
              : byte & 64
                ? (byte & 63) * 2 ** 24 +
                  number(1) * 2 ** 16 +
                  number(1) * 256 +
                  number(1)
                : (byte & 127) * 256 + number(1);
        }
        const field = candidates.find((field) => field.nameId === nameId);
        requireValue(
          field &&
            kinds.get(field.kind) === type &&
            index < field.arrayDim &&
            serializable(field),
          "unmatched or rejected tag requires its original compatibility branch",
        );
        if (type === 10)
          requireValue(
            structure(field).nameId === structNameId,
            "structure tag identity mismatch",
          );
        const offset = base + field.offset + index * field.elementSize,
          start = cursor;
        requireValue(
          offset >= 0x34 && offset + field.elementSize <= size,
          "tag targets native header or outside object body",
        );
        applied.push(Object.freeze({ field: field.identity, offset, cursor }));
        if (type === 3) {
          requireValue(
            field.elementSize === 4 &&
              uint(field.boolMask) &&
              field.boolMask > 0 &&
              (field.boolMask & (field.boolMask - 1)) === 0,
            "qualified Boolean storage mask required",
          );
          const view = new DataView(bytes.buffer),
            prior = view.getUint32(offset, true);
          view.setUint32(
            offset,
            info & 128
              ? (prior | field.boolMask) >>> 0
              : (prior & ~field.boolMask) >>> 0,
            true,
          );
        } else {
          scalar(field, offset);
          requireValue(
            cursor - start === length,
            "tag payload length differs from admitted serializer",
          );
        }
      }
    };
    tagged(layout, 0);
    requireValue(
      cursor === input.length,
      "bytes remain after class-default terminator",
    );
    return Object.freeze({
      status: "ready",
      scope,
      size,
      bytes: Object.freeze([...bytes]),
      values: Object.freeze([...values].map(Object.freeze)),
      applied: Object.freeze(applied),
      consumed: cursor,
    });
  } catch (error) {
    return Object.freeze({
      status: "unsupported",
      scope,
      reason: String(error.message ?? error),
    });
  }
}
