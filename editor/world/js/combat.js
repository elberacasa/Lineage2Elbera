// M3 combat UI: target frame (top-center), floating damage numbers,
// overhead HP bars for engaged entities, self status bar (bottom),
// death overlay. Pure DOM overlays; world positions are projected to
// screen each frame via the shared camera.

import * as THREE from 'three';

// Authored UI constants with NO retail or server source — neither aCis nor any
// decoded client table carries them. Left as they were rather than tuned by
// feel; see the report's open questions for what evidence would settle them.
const HP_BAR_TTL = 8;           // s an engaged entity keeps its overhead bar
const FLOAT_TTL_MS = 1300;      // ms a damage number stays on screen

export class CombatUI {
  constructor() {
    this.target = null;         // {id, name, hp, maxHp, dead}
    this.hp = new Map();        // entity id -> {hp, maxHp, dead, lastHit}
    this.self = null;           // last selfStatus
    this.floats = [];           // active damage floats {el, world, t}
    this.bars = new Map();      // entity id -> {el, fill, world:Vector3}
    this.targetId = null;

    this.el = {
      overlays: document.getElementById('overlays'),
      floats: document.getElementById('damage-floats'),
      deathOverlay: document.getElementById('death-overlay'),
    };
    this._v = new THREE.Vector3();
    // The retail TargetStatusWnd drives the target display (assigned in
    // boot); falls back to no-op when unavailable.
    this.targetWnd = null;
  }

  // -- targeting ---------------------------------------------------------

  setTarget(id, name, opts = {}) {
    this.targetId = id;
    const hp = this.hp.get(id) || {};
    this.target = { id, name, hp: hp.hp, maxHp: hp.maxHp, dead: !!hp.dead };
    if (this.targetWnd) this.targetWnd.setTarget(id, name, opts);
  }

  setTargetColor(diff) {
    if (this.targetWnd) this.targetWnd.setColor(diff);
  }

  clearTarget() {
    this.targetId = null;
    this.target = null;
    if (this.targetWnd) this.targetWnd.hide();
  }

  // -- status ops --------------------------------------------------------

  updateStatus(id, hp, maxHp, mp, maxMp) {
    const cur = this.hp.get(id) || {};
    this.hp.set(id, { ...cur, hp, maxHp, lastHit: performance.now() / 1000 });
    if (this.targetId === id && this.target) {
      this.target.hp = hp; this.target.maxHp = maxHp;
      if (this.targetWnd) this.targetWnd.updateStatus(hp, maxHp, mp, maxMp);
    }
    this._ensureBar(id);
  }

  // Phase C.1: the player status readout moved to the retail StatusWnd
  // (js/ui/statuswnd.js). CombatUI keeps the authoritative `self` payload and
  // owns the death overlay; rendering is the window's job. main.js forwards
  // the same payload to it.
  updateSelf(s) {
    this.self = s;
    if ((s.hp ?? 1) <= 0) this.showDeathOverlay();
    else this.el.deathOverlay.classList.remove('visible');
  }

  // -- combat events ------------------------------------------------------

  // A blow. `msg` is the gateway's attack op.
  //
  // TIMING: aCis broadcasts ONE Attack packet at the START of a swing carrying
  // every hit's damage, and applies those hits later — CreatureAttack schedules
  // them at timeAtk/2 for a melee weapon, timeAtk for a bow, timeAtk/4 and
  // timeAtk/2 for the two halves of a dual wield (timeAtk =
  // Formulas.calculateTimeBetweenAttacks = max(100, 500000/pAtkSpd)). The
  // target's HP, its StatusUpdate, and the "you hit for N" system message all
  // move at that later moment. Drawing the number the instant the packet
  // arrives put it a whole half-swing before the health bar moved, and made a
  // dual wield's two numbers land on top of each other instead of one after the
  // other. `hitDelay` is that offset, computed by the bridge from the packet's
  // own attacker (gateway/src/bridge.js hitDelays); null when the attacker was
  // never described to us, and then the blow shows immediately as before.
  damage(worldPos, msg = {}) {
    const delay = msg.hitDelay > 0 ? msg.hitDelay : 0;
    const at = worldPos.clone();
    if (!delay) { this._spawnFloat(at, msg); return; }
    setTimeout(() => this._spawnFloat(at, msg), delay);
  }

  // The `shield` flag deliberately gets no extra visual here: aCis's own
  // feedback for a successful block is SystemMessage 111
  // (SHIELD_DEFENCE_SUCCESSFULL, Formulas.calcShldUse), sent to the defender
  // and already rendered by the chat window, and a PERFECT block arrives as
  // damage 0. Anything else would be an invented effect.
  _spawnFloat(worldPos, { damage, critical, miss }) {
    const el = document.createElement('div');
    el.className = 'dmg-float' + (critical ? ' crit' : '') + (miss ? ' miss' : '');
    el.textContent = miss ? 'miss' : String(damage);
    this.el.floats.appendChild(el);
    this.floats.push({ el, world: worldPos, t0: performance.now() });
    setTimeout(() => {
      el.remove();
      this.floats = this.floats.filter(f => f.el !== el);
    }, FLOAT_TTL_MS);
  }

  markDead(id) {
    const cur = this.hp.get(id);
    if (cur) { cur.dead = true; cur.hp = 0; }
    if (this.targetId === id && this.target) {
      this.target.dead = true; this.target.hp = 0;
      if (this.targetWnd) this.targetWnd.updateStatus(0, this.target.maxHp, 0, 0);
    }
    this._removeBar(id);
  }

  markRevived(id) {
    const cur = this.hp.get(id);
    if (cur) cur.dead = false;
  }

  showDeathOverlay() {
    this.el.deathOverlay.classList.add('visible');
  }

  // -- overhead HP bars ---------------------------------------------------

  _ensureBar(id) {
    if (this.bars.has(id)) return;
    const el = document.createElement('div');
    el.className = 'hp-bar';
    const fill = document.createElement('div');
    fill.className = 'hp-bar-fill';
    el.appendChild(fill);
    this.el.overlays.appendChild(el);
    this.bars.set(id, { el, fill });
  }

  _removeBar(id) {
    const bar = this.bars.get(id);
    if (bar) { bar.el.remove(); this.bars.delete(id); }
  }

  clear() {
    this.clearTarget();
    this.hp.clear();
    for (const id of [...this.bars.keys()]) this._removeBar(id);
    this.el.deathOverlay.classList.remove('visible');
  }

  // -- per-frame projection -------------------------------------------------

  update(getEntityPos) {
    const now = performance.now() / 1000;
    // overhead bars above engaged entities
    for (const [id, bar] of this.bars) {
      const info = this.hp.get(id);
      const pos = getEntityPos(id);
      const expired = info && (now - info.lastHit > HP_BAR_TTL) && info.hp >= info.maxHp;
      if (!pos || !info || info.dead || expired) { this._removeBar(id); continue; }
      const p = project(pos, this._v);
      if (!p) { bar.el.style.display = 'none'; continue; }
      bar.el.style.display = 'block';
      bar.el.style.transform = `translate(${p.x - 25}px, ${p.y}px)`;
      bar.fill.style.width = Math.max(0, info.hp / info.maxHp * 100) + '%';
    }
    // damage floats (CSS animates the rise; we only anchor them)
    for (const f of this.floats) {
      const p = project(f.world, this._v);
      if (p) f.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      else f.el.style.display = 'none';
    }
  }
}

let _cam = null, _canvas = null;
export function bindProjection(camera, canvas) { _cam = camera; _canvas = canvas; }

function project(worldPos, v) {
  if (!_cam) return null;
  v.copy(worldPos).project(_cam);
  if (v.z > 1) return null;
  return {
    x: (v.x + 1) / 2 * _canvas.clientWidth,
    y: (-v.y + 1) / 2 * _canvas.clientHeight,
  };
}
