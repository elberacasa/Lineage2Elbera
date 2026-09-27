// Elbera Tools: exact original skill-level metadata. No level interpolation,
// nearest-level lookup or substitution from the legacy id-only catalog.
const FORMAT = 'l2-skilltext-v1';
const fields = ['name', 'desc', 'enchantName', 'enchantDesc', 'iconRef'];
const key = value => /^[1-9]\d*$/.test(value) && Number(value) <= 0xffffffff;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Attach validated level records without changing legacy id-only fields. */
export function mergeSkillText(legacy, data) {
  if (data?.format !== FORMAT || !data.skills || !data.provenance) {
    throw new Error('Unsupported or missing exact skill text');
  }
  const p = data.provenance;
  for (const [file, count] of [['skillname-e.dat', p.nameRecordCount], ['skillgrp.dat', p.iconRecordCount]]) {
    const source = p.sources?.[file];
    if (!source || !hash(source.sha256) || !hash(source.decodedSHA256)
        || source.records !== count || !Number.isSafeInteger(count) || count <= 0) {
      throw new Error(`Invalid skill text provenance: ${file}`);
    }
  }
  const result = { ...(legacy || {}) };
  let count = 0, names = 0, icons = 0;
  for (const [id, levels] of Object.entries(data.skills)) {
    if (!key(id) || !levels || Array.isArray(levels) || !Object.keys(levels).length) {
      throw new Error(`Invalid skill text id: ${id}`);
    }
    for (const [level, row] of Object.entries(levels)) {
      if (!key(level) || !row || typeof row.hasText !== 'boolean' || typeof row.hasIconRecord !== 'boolean'
          || fields.some(f => row[f] !== null && typeof row[f] !== 'string')
          || (row.hasText && fields.slice(0, 4).some(f => typeof row[f] !== 'string'))
          || (!row.hasText && fields.slice(0, 4).some(f => row[f] !== null))
          || (row.icon !== null && (typeof row.icon !== 'string' || !/^icons\/[a-z0-9_]+\.png$/.test(row.icon)))
          || (row.hasIconRecord && (typeof row.iconRef !== 'string'
              || !Number.isSafeInteger(row.hp) || row.hp < 0 || row.hp > 0xffffffff
              || !Number.isSafeInteger(row.mp) || row.mp < 0 || row.mp > 0xffffffff
              || !Number.isSafeInteger(row.operateType) || row.operateType < 0 || row.operateType > 0xffffffff
              || !Number.isSafeInteger(row.isMagic) || row.isMagic < 0 || row.isMagic > 0xffffffff
              || !Number.isSafeInteger(row.range) || row.range < -0x80000000 || row.range > 0x7fffffff))
          || (!row.hasIconRecord && ['icon', 'iconRef', 'hp', 'mp', 'range', 'operateType', 'isMagic'].some(f => row[f] !== null))) {
        throw new Error(`Invalid skill text level: ${id}/${level}`);
      }
      count++; names += Number(row.hasText); icons += Number(row.hasIconRecord);
    }
    result[id] = { ...(result[id] || {}), byLevel: levels };
  }
  if (count !== p.recordCount || names !== p.nameRecordCount || icons !== p.iconRecordCount
      || Object.keys(data.skills).length !== p.skillCount) {
    throw new Error('Skill text provenance counts disagree');
  }
  Object.defineProperty(result, 'skillTextProvenance', { value: p });
  return result;
}

export function exactSkillText(meta, id, level) {
  return key(String(id)) && key(String(level)) ? meta?.[String(id)]?.byLevel?.[String(level)] ?? null : null;
}

/** NWindow GetOperateType (VA 0x101b5880), using this exact group record. */
export function skillDisplayTypeId(row) {
  if (!row?.hasIconRecord || !Number.isSafeInteger(row.isMagic) || row.isMagic < 0
      || !Number.isSafeInteger(row.operateType) || row.operateType < 0) return null;
  if (row.isMagic === 0) return row.operateType === 2 ? 312 : 311;
  return row.isMagic === 3 ? 1500 : 313;
}
