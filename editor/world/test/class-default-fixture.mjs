// Elbera Tools authored data only. No original game values or package payloads.
import { loadClassDefaultProperties } from "../js/class-defaults.js";

const field = (identity, kind, offset, nameId, extra = {}) => ({
  identity,
  name: identity,
  kind,
  offset,
  nameId,
  arrayDim: 1,
  elementSize:
    kind === "ByteProperty"
      ? 1
      : ["StrProperty", "ArrayProperty"].includes(kind)
        ? 12
        : 4,
  propertyFlags:
    kind === "StrProperty" || kind === "ArrayProperty" ? 0x400000 : 0,
  ...extra,
});
const layout = (identity, size, fields, nameId = 200) => ({
  status: "ready",
  identity,
  propertiesSize: size,
  parentSize: 0,
  nameId,
  fields,
  lists: {
    "0x70": fields.map((f) => f.identity),
    "0x78": fields
      .filter((f) => f.propertyFlags & 0x400000)
      .map((f) => f.identity),
  },
});

export function defaultLoadingFixture() {
  const vector = layout(
    "Example.Vector",
    12,
    [
      field("X", "FloatProperty", 0, 101),
      field("Y", "FloatProperty", 4, 102),
      field("Z", "FloatProperty", 8, 103),
    ],
    0x57,
  );
  const nested = layout(
    "Example.Nested",
    4,
    [field("NestedCounter", "IntProperty", 0, 113)],
    0x180,
  );
  const fields = [
    field("Counter", "IntProperty", 0x34, 1010),
    field("Enabled", "BoolProperty", 0x38, 1011, { boolMask: 1 }),
    field("Secondary", "BoolProperty", 0x38, 1012, { boolMask: 8 }),
    field("Weight", "FloatProperty", 0x3c, 1013),
    field("Title", "StrProperty", 0x40, 1014),
    field("Reference", "ObjectProperty", 0x4c, 1015),
    field("Name", "NameProperty", 0x50, 1016),
    field("Vector", "StructProperty", 0x54, 1017, {
      elementSize: 12,
      reference: vector.identity,
    }),
    field("Nested", "StructProperty", 0x60, 1018, {
      elementSize: 4,
      reference: nested.identity,
    }),
    field("Array", "ArrayProperty", 0x64, 1019, {
      inner: { arrayDim: 1, elementSize: 4, propertyFlags: 0 },
    }),
  ];
  const base = layout("Example.Parent", 0x70, fields);
  const child = layout("Example.Child", 0x7c, [
    field("Tail", "StrProperty", 0x70, 1020),
    ...fields,
  ]);
  child.parentSize = base.propertiesSize;
  const names = {
    0: 0,
    1: 1010,
    2: 1011,
    3: 1012,
    4: 1013,
    5: 1014,
    6: 1015,
    7: 1016,
    8: 400,
    9: 1017,
    10: 0x57,
    11: 1018,
    12: 0x180,
    13: 113,
    14: 1020,
  };
  const reference = { identity: "ExampleObject" };
  const payload = [
    1,
    0x22,
    4,
    3,
    2,
    1, // Int: 0x01020304
    2,
    0x83,
    3,
    0x03, // Two independently packed Boolean masks.
    4,
    0x24,
    0,
    0,
    0,
    128, // Float: negative-zero bits retained.
    5,
    0x5d,
    11,
    0x85,
    65,
    0,
    0,
    0,
    0,
    216,
    66,
    0,
    0,
    0, // A, NUL, lone surrogate, B, terminator.
    6,
    0x05,
    0x81, // Object reference -1.
    7,
    0x06,
    8, // Saved name index 8, supplied current identity 400.
    9,
    0x3a,
    10,
    0,
    0,
    128,
    63,
    0,
    0,
    0,
    64,
    0,
    0,
    64,
    64, // Binary Vector (1,2,3).
    11,
    0x5a,
    12,
    7,
    13,
    0x22,
    99,
    0,
    0,
    0,
    0, // Nested tagged structure.
    0,
  ];
  const childPayload = [
    1, 0x22, 9, 0, 0, 0, 14, 0x5d, 6, 5, 116, 97, 105, 108, 0, 0,
  ];
  const providers = {
    structures: new Map([
      [vector.identity, vector],
      [nested.identity, nested],
    ]),
    resolveName: (index) => names[index],
    resolveReference: (index) =>
      index === 0 ? null : index === -1 ? reference : undefined,
    archiveFlags1c: 0,
  };
  return { base, child, payload, childPayload, providers, reference };
}

export function runDefaultLoadingFixture(
  parentMode = "partial",
  payloadMode = "filled",
) {
  const fixture = defaultLoadingFixture(),
    filled = payloadMode === "filled";
  let parent = null;
  if (parentMode !== "none")
    parent = loadClassDefaultProperties({
      ...fixture.providers,
      layout:
        parentMode === "full"
          ? { ...fixture.child, parentSize: 0 }
          : fixture.base,
      payload: filled
        ? parentMode === "full"
          ? [...fixture.payload.slice(0, -1), ...fixture.childPayload]
          : fixture.payload
        : [0],
    });
  const result = loadClassDefaultProperties({
    ...fixture.providers,
    layout: { ...fixture.child, parentSize: parent?.size ?? 0 },
    parent,
    payload: filled ? fixture.childPayload : [0],
  });
  return { parent, result };
}
