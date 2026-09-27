// Elbera Tools: native GetSkillSoundData and PlaySkillSound source selection.
// Sound records differ from visual Agent bindings: loader bucket order gives
// last exact-level row, otherwise first level-one row. No other level is used.
// Three DAT layers each hold three phases; a phase plays every populated layer.
const uint32 = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

// Original chargrp body/face arrays joined exactly to the character builder's
// creation bindings, then checked against native named voice-bank stores.
// See check_cast_sound_native.py:model_voice_source and native-cast-sound-evidence.
// This is only the ordinary built player identity; no NPC/transformation guess.
const PLAYER_VOICE_MESH_TYPES = Object.freeze({
  human_fighter_m: 0, human_fighter_f: 1, darkelf_m: 2, darkelf_f: 3,
  dwarf_m: 4, dwarf_f: 5, elf_m: 6, elf_f: 7, human_mystic_m: 8, human_mystic_f: 9,
  orc_fighter_m: 10, orc_fighter_f: 11, orc_mystic_m: 12, orc_mystic_f: 13,
});

export function ordinaryPlayerVoiceMeshType(modelId) {
  return typeof modelId === 'string' && Object.hasOwn(PLAYER_VOICE_MESH_TYPES, modelId)
    ? PLAYER_VOICE_MESH_TYPES[modelId] : null;
}

export function skillSoundBinding(index, skillId, level) {
  if (index?.skillSoundFormat !== 'l2-interlude-skill-sound-v1') return { status: 'missing-source' };
  if (!uint32(skillId) || !uint32(level)) return { status: 'invalid-identity' };
  const rows = Object.hasOwn(index.skillSoundRows || {}, String(skillId)) ? index.skillSoundRows[skillId] : null;
  if (!Array.isArray(rows)) return { status: 'missing-skill' };
  let exact = -1, fallback = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.level === level) exact = i;
    if (fallback < 0 && rows[i]?.level === 1) fallback = i;
  }
  const recordIndex = exact >= 0 ? exact : fallback;
  if (recordIndex < 0) return { status: 'missing-level' };
  return { status: exact >= 0 ? 'exact-level' : 'source-level-one', recordIndex, row: rows[recordIndex] };
}

/** phaseType is the native PlaySkillSound type (1 casting, 2 shot, 3 impact).
 *  A valid empty phase returns []; incomplete source returns null. No gains
 *  are rounded, borrowed from voice fields or replaced when source is zero. */
export function skillSoundPhase(index, skillId, level, phaseType) {
  if (![1, 2, 3].includes(phaseType)) return null;
  const { row } = skillSoundBinding(index, skillId, level);
  if (!Array.isArray(row?.layers) || row.layers.length !== 3) return null;
  const result = [];
  for (let layer = 0; layer < row.layers.length; layer++) {
    const bank = row.layers[layer], sound = bank?.[phaseType - 1];
    if (!Array.isArray(bank) || bank.length !== 3 || !Array.isArray(sound) || sound.length !== 3
        || !Number.isFinite(sound[1]) || !Number.isFinite(sound[2])) return null;
    const [nameIndex, volume, radius] = sound;
    if (nameIndex === null) continue;
    const ref = Number.isInteger(nameIndex) && nameIndex >= 0 && index.names?.[nameIndex];
    if (typeof ref !== 'string' || !ref) return null;
    result.push({ layer, ref, volume, radius });
  }
  return result;
}

/** Separate native voice bank: only ordinary player mesh types 0..13 are
 *  established. Reserved slot 14, absent identity, empty authored references
 *  and incomplete source metadata produce no voice. No impact voice exists. */
export function skillSoundVoice(index, skillId, level, phaseType, meshType) {
  if (![1, 2].includes(phaseType) || !Number.isInteger(meshType) || meshType < 0 || meshType > 13) return null;
  const { row } = skillSoundBinding(index, skillId, level);
  const bank = row?.[phaseType === 1 ? 'castVoice' : 'throwVoice'];
  if (!Array.isArray(bank) || bank.length !== 15
      || !Number.isFinite(row.voiceVolume) || !Number.isFinite(row.voiceRadius)) return null;
  const nameIndex = bank[meshType];
  const ref = Number.isInteger(nameIndex) && nameIndex >= 0 && index.names?.[nameIndex];
  return typeof ref === 'string' && ref
    ? { ref, volume: row.voiceVolume, radius: row.voiceRadius } : null;
}
