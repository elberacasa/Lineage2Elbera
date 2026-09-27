// Elbera Tools: manually driven existing-character gateway session.
// Operational time/iteration limits below are harness bounds, not game rules.
const objectId = n => Number.isInteger(n) && n > 0 && n <= 0x7fffffff;
const signedDword = n => Number.isInteger(n) && n >= -0x80000000 && n <= 0x7fffffff;
const point = p => p && ['x', 'y', 'z'].every(k => Number.isInteger(p[k]) && p[k] >= -0x80000000 && p[k] <= 0x7fffffff);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const HENNA_EVENTS = new Set(['hennaInfo', 'hennaEquipList', 'hennaItemInfo', 'hennaUnequipList', 'hennaUnequipInfo']);
const RECIPE_EVENTS = new Set(['recipeBook', 'recipeMakeInfo', 'storageMaxCount']);
const WORLD_EVENTS = new Set(['addNpc', 'addDrop', 'remove', 'move', 'moveToPawn', 'validate', 'stopMove', 'teleport',
  'selfStatus', 'charSheet', 'changeMove', 'skillList', 'npcHtml', 'questList', 'itemList', 'invUpdate',
  'attack', 'status', 'die', 'revive', 'skillCast', 'skillLaunch', 'skillCoolTime', 'sysMsg', 'actionFailed',
  'target_ok', 'changeWait', 'acquireSkillList', 'acquireSkillInfo', 'acquireSkillDone', 'hennaInfo', 'storageMaxCount']);

function hennaQueries(catalog) {
  if (catalog?.format !== 'l2-interlude-henna-v1' || !Array.isArray(catalog.records)
      || !catalog.records.every(row => objectId(row?.symbolId))) return null;
  const symbols = new Set(catalog.records.map(row => row.symbolId));
  if (symbols.size !== catalog.records.length) return null;
  const extra = catalog.native?.listRequestExtraDword;
  return { symbols, byMode: extra?.status === 'verified-caller-return-address' ? { ...extra.byMode } : {} };
}

function recipeIndices(catalog) {
  if (catalog?.format !== 'l2-interlude-recipes-v1' || !Array.isArray(catalog.records)
      || !catalog.records.every(row => objectId(row?.index))) return null;
  const indices = new Set(catalog.records.map(row => row.index));
  return indices.size === catalog.records.length ? indices : null;
}

export function readIdentity(value) {
  if (!value || typeof value.deviceId !== 'string' || !value.deviceId.trim())
    throw new Error('Identity file must contain a nonempty existing deviceId');
  return { deviceId: value.deviceId };
}

export function htmlBypasses(html) {
  const decode = text => text.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (all, code) => {
    const names = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
    if (code[0] !== '#') return names[code.toLowerCase()] ?? all;
    const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
  });
  return [...String(html).matchAll(/\baction\s*=\s*(["'])(.*?)\1/gi)]
    .map(match => decode(match[2]).match(/^bypass(?:\s+-h)?\s+(.+)$/i)?.[1])
    .filter(value => value != null);
}

export class PlaySession {
  constructor({ character, send, emit, close, nav, actionIds, hennaCatalog = null, recipeCatalog = null, now = Date.now, sleep = pause,
                commandTimeoutMs = 90000 }) {
    if (!character) throw new Error('An exact existing character name is required');
    Object.assign(this, { character, send, emit, close, nav, actionIds, now, sleep, commandTimeoutMs });
    this.hennaQueries = hennaQueries(hennaCatalog);
    this.recipeIndices = recipeIndices(recipeCatalog);
    this.phase = 'new';
    this.closed = false;
    this.busy = false;
    this.entryEvents = [];
    this.state = { me: null, pos: null, stats: {}, sheet: {}, skills: [], npcs: new Map(),
      drops: new Map(), dead: new Set(), html: null, targetId: null, positionUpdates: 0 };
  }

  begin(identity) {
    if (this.phase !== 'new') throw new Error('Session already started');
    this.phase = 'auth';
    // Login and identity are deliberately absent from receipts/stdout.
    this.send({ op: 'login', ...readIdentity(identity), noAutoCreate: true });
  }

  stop(reason = 'operator-quit') {
    if (this.closed) return;
    this.closed = true; this.phase = 'closed';
    this.entryEvents.length = 0;
    this.emit('session-end', { reason }); this.close();
  }

  accept(m) {
    if (this.closed || !m || typeof m.op !== 'string') return;
    const s = this.state;
    if (m.op === 'auth_ok') {
      if (this.phase !== 'auth') return;
      const matches = (m.chars || []).filter(c => c.name === this.character);
      if (matches.length !== 1 || !Number.isInteger(matches[0].slot) || matches[0].slot < 0) {
        this.stop('requested-character-absent-or-ambiguous'); return;
      }
      this.phase = 'enter';
      this.dispatch({ op: 'enterChar', slot: matches[0].slot });
      return;
    }
    if (m.op === 'enterWorld') {
      if (this.phase !== 'enter' || m.char?.name !== this.character || !objectId(m.char.id) || !point(m.char)) {
        this.stop('unexpected-world-entry'); return;
      }
      s.me = { ...m.char }; s.pos = { x: m.char.x, y: m.char.y, z: m.char.z };
      this.phase = 'world';
    } else if (this.phase !== 'world') {
      if (['error', 'auth_fail', 'login_fail'].includes(m.op)) this.stop('gateway-login-refused');
      else if (this.phase === 'enter' && WORLD_EVENTS.has(m.op)) {
        // The server can send nearby objects before the selected character's
        // first UserInfo. Retain actual events, but expose/apply none until
        // the exact requested character enters. This is a tool memory bound.
        if (this.entryEvents.length >= 2048) this.stop('world-entry-event-limit');
        else this.entryEvents.push(m);
      }
      return;
    }
    if (m.op === 'selfStatus') Object.assign(s.stats, m);
    else if (m.op === 'charSheet') Object.assign(s.sheet, m);
    else if (m.op === 'changeMove' && m.id === s.me?.id) s.sheet.running = m.running;
    else if (m.op === 'skillList') s.skills = (m.skills || []).map(skill => ({ ...skill }));
    else if (m.op === 'addNpc' && objectId(m.id)) {
      s.npcs.set(m.id, { ...m });
      if (m.dead) s.dead.add(m.id); else s.dead.delete(m.id);
    }
    else if (m.op === 'addDrop' && objectId(m.id)) s.drops.set(m.id, { ...m });
    else if (m.op === 'remove') { s.npcs.delete(m.id); s.drops.delete(m.id); s.dead.delete(m.id); }
    else if (m.op === 'die') s.dead.add(m.id);
    else if (m.op === 'revive') {
      s.dead.delete(m.id);
      if (s.npcs.has(m.id)) s.npcs.get(m.id).dead = false;
    }
    else if (m.op === 'target_ok') s.targetId = m.id;
    else if (m.op === 'npcHtml') s.html = { ...m, bypasses: htmlBypasses(m.html) };
    if (['move', 'moveToPawn', 'validate', 'stopMove', 'teleport'].includes(m.op) && point(m)) {
      const actual = { x: m.x, y: m.y, z: m.z }; // move.tx/ty/tz are destinations, not arrival evidence.
      if (m.id === s.me?.id) { s.pos = actual; s.positionUpdates++; }
      else if (s.npcs.has(m.id)) Object.assign(s.npcs.get(m.id), actual);
    }
    if (['enterWorld', 'selfStatus', 'charSheet', 'skillList', 'npcHtml', 'questList', 'itemList', 'invUpdate',
      'attack', 'status', 'die', 'revive', 'skillCast', 'skillLaunch', 'skillCoolTime', 'sysMsg', 'actionFailed',
      'target_ok', 'changeWait', 'changeMove', 'acquireSkillList', 'acquireSkillInfo', 'acquireSkillDone',
      'playSound', 'questMark', 'addDrop', 'remove'].includes(m.op) || HENNA_EVENTS.has(m.op) || RECIPE_EVENTS.has(m.op)
      || (['move', 'moveToPawn', 'validate', 'stopMove', 'teleport'].includes(m.op) && m.id === s.me?.id))
      this.emit('server', m);
    if (m.op === 'enterWorld') {
      const pending = this.entryEvents;
      this.entryEvents = [];
      for (const event of pending) this.accept(event);
    }
  }

  dispatch(command) {
    if (this.closed) throw new Error('Session is closed');
    this.send(command); this.emit('command', command);
  }

  visible() {
    const s = this.state;
    return [...s.npcs.values()].map(n => ({ ...n, dead: s.dead.has(n.id) || !!n.dead,
      distance: point(n) && s.pos ? Math.round(Math.hypot(n.x - s.pos.x, n.y - s.pos.y)) : null }))
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }

  route(goal) {
    if (!point(goal)) throw new Error('Goal must contain integer server x/y/z');
    const a = this.state.pos;
    const path = this.nav.findPath(a.x, a.y, a.z, goal.x, goal.y, goal.z);
    this.emit('route', { goal, path }); return path;
  }

  async waitFor(test, milliseconds, deadline) {
    const end = Math.min(deadline, this.now() + milliseconds);
    while (true) {
      if (this.closed) throw new Error('Session is closed');
      if (this.state.dead.has(this.state.me?.id)) throw new Error('Character died during movement');
      if (test()) return;
      if (this.now() >= end) throw new Error('No confirmed server movement before timeout');
      await this.sleep(100);
    }
  }

  async walk(goal) {
    const path = this.route(goal);
    if (!path?.complete || path.points.length < 2
        || path.points.at(-1).x !== goal.x || path.points.at(-1).y !== goal.y)
      throw new Error('No complete geodata-supported route to the requested XY; no move sent');
    const deadline = this.now() + this.commandTimeoutMs;
    let legs = 0;
    for (const target of path.points.slice(1)) {
      while (true) {
        if (this.closed || this.state.dead.has(this.state.me.id)) throw new Error('Movement stopped: closed session or dead character');
        if (++legs > 100 || this.now() >= deadline) throw new Error('Manual movement command reached its operational limit');
        const a = { ...this.state.pos }, distance = Math.hypot(target.x - a.x, target.y - a.y);
        if (distance === 0) {
          if (this.nav._lineOk(a, target) == null) throw new Error('Nearby goal is on an unconfirmed floor');
          break;
        }
        const fraction = Math.min(1, 600 / distance);
        const x = Math.round(a.x + (target.x - a.x) * fraction), y = Math.round(a.y + (target.y - a.y) * fraction);
        // Every sent segment is rechecked from the latest server-stated floor.
        const z = this.nav._lineOk(a, { x, y, ...(fraction === 1 ? { z: target.z } : {}) });
        if (z == null) throw new Error('Actual server position cannot reach the planned segment');
        const sheet = this.state.sheet;
        if (![true, false, 0, 1].includes(sheet.running)) throw new Error('Missing server movement stance');
        const speed = (sheet.running ? sheet.runSpeed : sheet.walkSpeed) * sheet.speedMul;
        if (!(speed > 0) || !Number.isFinite(speed)) throw new Error('Missing server movement speed/stance');
        const mark = this.state.positionUpdates;
        this.dispatch({ op: 'moveTo', x, y, z });
        await this.waitFor(() => this.state.positionUpdates > mark, 8000, deadline);
        const arrival = this.now() + Math.ceil(Math.hypot(x - a.x, y - a.y) / speed * 1000) + 700;
        await this.waitFor(() => this.now() >= arrival, arrival - this.now() + 100, deadline);
        const probe = this.state.positionUpdates;
        if (this.nav._lineOk(this.state.pos, { x, y, z }) == null) throw new Error('Arrival probe is not supported from the latest server floor');
        this.dispatch({ op: 'moveTo', x, y, z });
        await this.waitFor(() => this.state.positionUpdates > probe, 8000, deadline);
        if (this.state.pos.x === a.x && this.state.pos.y === a.y && this.state.pos.z === a.z)
          throw new Error('No actual server movement progress');
      }
    }
    this.emit('walk-ended', { position: this.state.pos, goal, operationalToleranceXY: 0 });
  }

  async command(c) {
    if (c?.op === 'quit') { this.stop(); return; }
    const readOnly = c?.op === 'status' || c?.op === 'visible';
    if (this.busy && !readOnly) throw new Error('Previous command is still pending; this command was discarded, not queued');
    if (readOnly) return this.runCommand(c);
    this.busy = true;
    try { return await this.runCommand(c); }
    finally { this.busy = false; }
  }

  async runCommand(c) {
    if (this.closed || this.phase !== 'world') throw new Error('Character has not entered the world');
    const s = this.state;
    if (c?.op === 'status') return this.emit('status', { position: s.pos, stats: s.stats, sheet: s.sheet,
      skills: s.skills, targetId: s.targetId, drops: [...s.drops.values()], bypasses: s.html?.bypasses || [] });
    if (c?.op === 'visible') return this.emit('visible', { npcs: this.visible() });
    if (c?.op === 'recipeBook') {
      if (c.bookType !== 0 && c.bookType !== 1) throw new Error('Recipe bookType must be 0 or 1');
      return this.dispatch({ op: 'recipeBookOpen', bookType: c.bookType });
    }
    if (c?.op === 'recipeInfo') {
      if (!this.recipeIndices) throw new Error('Original recipe catalog is unavailable or invalid');
      if (!objectId(c.index) || !this.recipeIndices.has(c.index))
        throw new Error('Recipe index is absent from the supplied original recipe catalog');
      return this.dispatch({ op: 'recipeMakeInfo', recipeId: c.index });
    }
    if (c?.op === 'hennaList' || c?.op === 'hennaInfo') {
      if (c.mode !== 'equip' && c.mode !== 'unequip') throw new Error('Henna query mode must be equip or unequip');
      const catalog = this.hennaQueries;
      if (!catalog) throw new Error('Original henna catalog is unavailable or invalid');
      if (c.op === 'hennaList') {
        const unknown = catalog.byMode[c.mode];
        if (!signedDword(unknown)) throw new Error('Verified source henna list request word is unavailable');
        return this.dispatch({ op: c.mode === 'equip' ? 'hennaEquipList' : 'hennaUnequipList', unknown });
      }
      if (!objectId(c.symbolId) || !catalog.symbols.has(c.symbolId))
        throw new Error('Symbol id is absent from the supplied original henna catalog');
      return this.dispatch({ op: c.mode === 'equip' ? 'hennaItemInfo' : 'hennaUnequipInfo', symbolId: c.symbolId });
    }
    if (c?.op === 'path') return this.route(c.goal);
    if (c?.op === 'walk' || c?.op === 'move') return this.walk(c.goal);
    if (c?.op === 'talk') {
      const matches = c.id != null ? [s.npcs.get(c.id)].filter(Boolean)
        : [...s.npcs.values()].filter(n => n.npcId === c.npcId);
      if (matches.length !== 1 || s.dead.has(matches[0].id)) throw new Error('Select one currently visible live NPC by object id');
      return this.dispatch({ op: 'talk', id: matches[0].id });
    }
    if (c?.op === 'bypass') {
      if (!Number.isInteger(c.index) || c.index < 0 || !s.html?.bypasses[c.index]) throw new Error('No actual HTML bypass at that index');
      return this.dispatch({ op: 'bypass', command: s.html.bypasses[c.index] });
    }
    if (c?.op === 'target' || c?.op === 'attack') {
      if (!objectId(c.id) || !(s.npcs.has(c.id) || (c.op === 'target' && s.drops.has(c.id)))) throw new Error('Object is not currently visible');
      if (c.op === 'attack' && (s.dead.has(c.id) || s.npcs.get(c.id)?.dead || s.dead.has(s.me.id))) throw new Error('Cannot attack a dead object or while dead');
      return this.dispatch({ op: c.op, id: c.id });
    }
    if (c?.op === 'useSkill') {
      if (!s.skills.some(k => k.id === c.skillId && !k.passive && !k.disabled) || s.dead.has(s.me.id)) throw new Error('Skill is not currently granted and enabled');
      const targetId = c.targetId;
      if (targetId != null && (!objectId(targetId) || (targetId !== s.me.id && (!s.npcs.has(targetId) || s.dead.has(targetId)))))
        throw new Error('Skill target is not a currently visible live object or self');
      return this.dispatch({ op: 'useSkill', skillId: c.skillId, ...(targetId != null ? { targetId } : {}) });
    }
    if (c?.op === 'action') {
      if (!this.actionIds.has(c.actionId)) throw new Error('Action id is absent from the supplied original action catalog');
      return this.dispatch({ op: 'action', actionId: c.actionId });
    }
    throw new Error('Unsupported manual command');
  }
}
