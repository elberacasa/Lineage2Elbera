// Authored loader fixture. No client bytes, recovered geometry or live defaults.
export function sourceWorldFixture() {
  const binding = (sourcePackage, exportRef, identity, classIdentity) => ({
    sourcePackage,
    exportRef,
    identity,
    classIdentity,
    exportSHA256: String(exportRef).repeat(64),
  });
  const level = binding("Map", 1, "Map.Level", "Engine.LevelInfo");
  const mesh = binding("Objects", 1, "Objects.Mesh", "Engine.StaticMesh");
  const actor = (exportRef) => ({
    exportRef,
    name: `Actor${exportRef}`,
    exportSHA256: String(exportRef).repeat(64),
    savedStateFrame: {
      scope: "saved-map-state-frame",
      classIdentity: "Engine.StaticMeshActor",
      savedExportFlags: 0x02070001,
      codeOffset: -1,
    },
    savedActorLoading: {
      scope: "saved-actor-loading-inputs",
      fileVersion: 123,
      tags: [{ name: "StaticMesh" }, { name: "Level" }],
      attachedOverrideCount: 0,
    },
    savedTransform: { tags: [] },
    savedCollisionFlags: { tags: [] },
    savedReferences: {
      tags: [
        { name: "StaticMesh", package: "Map", reference: -1 },
        { name: "Level", package: "Map", reference: 1 },
      ],
    },
  });
  const refs = [
    "StaticMesh",
    "Level",
    "XLevel",
    "Owner",
    "Mesh",
    "Brush",
    "AntiPortal",
  ];
  const offsets = ["0x64", "0x74", "0x2e4", "0x2f8"];
  const transforms = [
    "Location",
    "Rotation",
    "DrawScale",
    "DrawScale3D",
    "PrePivot",
  ];
  return {
    format: "l2-static-world-source-v1",
    tile: "Map",
    savedActorSlots: [1, 2, 0, 3, 2],
    savedActorSources: {
      1: level,
      2: binding("Map", 2, "Map.Actor2", "Engine.StaticMeshActor"),
      3: binding("Map", 3, "Map.Volume", "Engine.BlockingVolume"),
      4: binding("Map", 4, "Map.Actor4", "Engine.StaticMeshActor"),
    },
    actors: [actor(2), actor(4)],
    actorClassLoading: {
      sourceClass: "Engine.StaticMeshActor",
      scope: "ordinary-native-registration-and-package",
      mask: 0x428,
      value: 0,
    },
    savedReferenceBindings: {
      Map: {
        exportCount: 4,
        importCount: 1,
        references: { 1: level, "-1": mesh },
      },
    },
    classDefaults: [
      {
        collisionTransforms: {
          layout: transforms.map((name) => ({
            name,
            propertyFlags: 0,
            kind: name === "DrawScale" ? "FloatProperty" : "StructProperty",
            reference:
              name === "DrawScale"
                ? null
                : name === "Rotation"
                  ? "Core.Object.Rotator"
                  : "Core.Object.Vector",
          })),
          defaults: {
            Location: [10, 20, 30],
            Rotation: [0, 0, 0],
            DrawScale: 1,
            DrawScale3D: [1, 1, 1],
            PrePivot: [-0, 0, 0],
          },
        },
        collisionBooleans: {
          layout: offsets.map((offset) => ({ offset, mask: 0, fields: [] })),
          defaultGroups: Object.fromEntries(
            offsets.map((offset) => [offset, { mask: 0, value: 0 }]),
          ),
        },
        collisionReferences: {
          layout: refs.map((name) => ({
            name,
            kind: "ObjectProperty",
            propertyFlags: name === "XLevel" ? 0x2000 : 0,
          })),
          defaults: Object.fromEntries(
            refs.map((name) => [name, { package: "Engine", reference: 0 }]),
          ),
        },
        collisionAttached: {
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
        },
      },
    ],
    levelCollisionDefaults: {
      layout: [
        {
          offset: "0x554",
          mask: 7,
          fields: ["bLonePlayer", "bBegunPlay", "bPlayersOnly"].map(
            (name, i) => ({ name, mask: 1 << i, propertyFlags: 0 }),
          ),
        },
      ],
      defaultGroups: { "0x554": { mask: 7, value: 0 } },
    },
    savedLevelCollisionMode: {
      scope: "saved-level-info-collision-mode",
      reference: 1,
      identity: level.identity,
      tags: [],
      groups: { "0x554": { mask: 7, value: 0 } },
    },
    meshes: {
      "Objects.Mesh": {
        sourceExport: "Objects.Mesh",
        exportSHA256: mesh.exportSHA256,
        sourceClass: "Engine.StaticMesh",
        fileVersion: 123,
        classLoading: {
          sourceClass: "Engine.StaticMesh",
          scope: "ordinary-native-registration",
          mask: 0x408,
          value: 0,
        },
        savedProperties: { savedExportFlags: 0x000f0004, tags: [] },
        savedLocalBounds: { min: [0, 0, 0], max: [10, 10, 0], valid: 1 },
        loadTail: { fields: { "0x1dc": { encoding: "i32", value: 8 } } },
        vertices: [
          [0, 0, 0],
          [10, 0, 0],
          [0, 10, 0],
        ],
        indices: [0, 1, 2],
        materials: [0],
        collisionTree: {
          trianglePlanes: [[0, 0, -1, 0, ...new Array(12).fill(0)]],
          nodes: [
            { links: [0, -1, -1, -1], bounds: [0, 0, 0, 10, 10, 0], valid: 1 },
          ],
        },
      },
    },
  };
}
