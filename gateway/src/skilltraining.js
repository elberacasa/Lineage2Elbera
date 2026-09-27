'use strict';

// AcquireSkillList/Info wire contracts for the connected Interlude server.
// Native consumer names maxLevel and itemConsume; keep their wire values.
// Unknown requirement fields remain uninterpreted.
// Trainer costs and eligibility remain authoritative server state.
function countedRows(reader, width, kind) {
  const count = reader.readD();
  // Reject before allocation/emission. This is a transport-size check,
  // not an invented gameplay limit on the number of learnable skills.
  if (count < 0 || count * width !== reader.remaining()) {
    throw new RangeError(`invalid ${kind} row count or packet length`);
  }
  return count;
}

function readAcquireSkillList(reader) {
  const type = reader.readD();
  const count = countedRows(reader, 20, 'AcquireSkillList');
  const skills = [];
  for (let i = 0; i < count; i++) skills.push({
    id: reader.readD(), level: reader.readD(), maxLevel: reader.readD(),
    cost: reader.readD(), itemConsume: reader.readD(),
  });
  return { type, skills };
}

function readAcquireSkillInfo(reader) {
  const id = reader.readD(), level = reader.readD(), cost = reader.readD(), type = reader.readD();
  const count = countedRows(reader, 16, 'AcquireSkillInfo');
  const requirements = [];
  for (let i = 0; i < count; i++) requirements.push({
    type: reader.readD(), itemId: reader.readD(), count: reader.readD(), unknown: reader.readD(),
  });
  return { id, level, cost, type, requirements };
}

function validSkillTrainingRequest({ id, level, type }) {
  // Original SkillTrainListWnd/InfoWnd distinguish normal0, fishing1 and
  // clan2. Enchant3 is a separate native request, never this opcode.
  const positiveInt32 = v => Number.isInteger(v) && v > 0 && v <= 0x7fffffff;
  return positiveInt32(id) && positiveInt32(level)
    && Number.isInteger(type) && type >= 0 && type <= 2;
}

module.exports = { readAcquireSkillList, readAcquireSkillInfo, validSkillTrainingRequest };
