// Original questname-e.dat, exported by tools/dat/export_quests.py.
// This table supplies journal content, never server progress or rewards.
// Original NWindow AddQuestID 0x1016ac70: bit31 selects bitmap encoding;
// otherwise the value is a stage count. Only bits0..29 produce journal
// events, in ascending order; every event except the last is completed.
export function questStages(progress) {
  const flags = progress >>> 0;
  const stages = [];
  for (let bit = 0; bit < 30; bit++) {
    if (flags & 0x80000000 ? (flags & (1 << bit)) : bit < flags)
      stages.push({ level: bit + 1, completed: true });
  }
  if (stages.length) stages.at(-1).completed = false;
  return stages;
}

export function indexQuests(data) {
  if (data?.format !== 'l2-interlude-quests-v1' || data.provenance?.edition !== 'Interlude'
      || !Array.isArray(data.records)) throw new Error('invalid original quest table');
  const stages = new Map(), quests = new Map();
  for (const row of data.records) {
    if (!Number.isInteger(row.id) || !Number.isInteger(row.level)
        || !['title', 'journal', 'description'].every(key => typeof row[key] === 'string')
        || !Array.isArray(row.itemIds) || !Array.isArray(row.itemCounts)
        || row.itemIds.length !== row.itemCounts.length)
      throw new Error('invalid original quest record');
    const key = `${row.id}:${row.level}`;
    if (stages.has(key)) throw new Error(`duplicate quest journal ${key}`);
    stages.set(key, row);
    if (!quests.has(row.id)) quests.set(row.id, []);
    quests.get(row.id).push(row);
  }
  if (stages.size !== data.provenance.recordCount || quests.size !== data.provenance.questCount)
    throw new Error('quest table count does not match provenance');
  return {
    provenance: data.provenance,
    stage(id, level) { return stages.get(`${id}:${level}`) || null; },
    title(id) { return stages.get(`${id}:1`)?.title || null; },
  };
}

let pending;
export function questMeta() {
  if (!pending) pending = fetch('/gamedata/quests.json').then(response => {
    if (!response.ok) throw new Error(`original quest journal: HTTP ${response.status}`);
    return response.json();
  }).then(indexQuests).catch(error => {
    pending = null; // a later retry can recover a missing private build output
    throw error;
  });
  return pending;
}
