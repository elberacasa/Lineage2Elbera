/** Authored resource inputs; no original game bytes or values. */
export function sourceModelFixture() {
  return {
    scope: "saved-model-resource",
    fileVersion: 123,
    licenseeVersion: 21,
    sourcePackage: "Map",
    exportRef: 5,
    identity: "Map.Shape",
    classIdentity: "Engine.Model",
    exportSHA256: "c".repeat(64),
    savedExportFlags: 0,
    localBounds: { min: [-0, -2, -3], max: [4, 5, 6], valid: 7 },
    nodeSurfaces: [2, 0, 2, 0],
    surfaceCount: 3,
    emptyRenderArrays: ["0xe4", "0x10c", "0xf0"].map((nativeField) => ({
      nativeField,
      count: 0,
    })),
  };
}
export const modelClassFixture = Object.freeze({
  sourceClass: "Engine.Model",
  scope: "ordinary-native-registration",
  mask: 0x408,
  value: 0,
});
