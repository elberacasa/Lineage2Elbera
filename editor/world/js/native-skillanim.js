// Elbera Tools: original APawn::SetSkillAnim selector, Engine.dll RVA 0x1ed930.
// tools/ui/check_skillanim_native.py independently derives this table from the
// original binary's branches and exported Get*AnimName pawn getters.
// See docs/native-skill-animation-evidence.md for source hashes and limits.
// These are phase slots in source order, not glTF clip names or timing rules.
const SLOTS = {
  "A": ["castShort", "castEnd", "magicNoTarget"],
  "B": ["castShort", "castEnd", "magicShot"],
  "C": ["castShort", "castEnd", "magicThrow"],
  "D": ["castMid", "castEnd", "magicNoTarget"],
  "E": ["castMid", "castEnd", "magicShot"],
  "F": ["castMid", "castEnd", "magicThrow"],
  "G": ["castLong", "castEnd", "magicNoTarget"],
  "H": ["castLong", "castEnd", "magicShot"],
  "I": ["castLong", "castEnd", "magicThrow"],
  "J": ["castEnd", "magicNoTarget"],
  "K": ["castEnd", "magicShot"],
  "L": ["castEnd", "magicThrow"],
  "M": ["picItem"],
  "N": ["spAtk27"],
  "S": ["spAtk01"],
  "T": ["spAtk02"],
  "U": ["spAtk03"],
  "V": ["spAtk04"],
  "W": ["spAtk05"],
  "X": ["spAtk06"],
  "Y": ["shieldAtk"],
  "Z": ["spAtk28"],
  "MIX01": ["spAtk09", "spAtk17", "spAtk24"],
  "MIX02": ["spAtk07", "spAtk16", "spAtk25"],
  "MIX03": ["spAtk07", "spAtk13", "spAtk20"],
  "MIX04": ["spAtk07", "spAtk12", "spAtk21"],
  "MIX05": ["spAtk08", "spAtk13", "spAtk22"],
  "MIX06": ["spAtk10", "spAtk11", "spAtk18"],
  "MIX07": ["spAtk10", "spAtk11", "spAtk19"],
  "MIX08": ["spAtk07", "spAtk14", "spAtk23"],
  "MIX09": ["spAtk09", "spAtk15", "spAtk26"],
  "MS01": ["atk01", "atk02", "atk03"]
};
for (const phases of Object.values(SLOTS)) Object.freeze(phases);
Object.freeze(SLOTS);

/** Original FName matching ignores case. Unknown/empty codes have no mapping. */
export function nativeSkillSlots(code) {
  if (typeof code !== 'string' || !Object.hasOwn(SLOTS, code.toUpperCase())) return null;
  return SLOTS[code.toUpperCase()];
}
