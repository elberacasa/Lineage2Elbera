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

// ---------------------------------------------------------------------------
// Approach / stance ops — the GHOST NPC fix, client half.
// ---------------------------------------------------------------------------
//
// MEASURED (gateway/test/repro-ghost-pair.js, against the live aCis with
// GW_TRACE=1): an attack on a mob that is outside physical attack range is
// answered by the server with exactly ONE packet, MoveToPawn(0x60), and
// nothing else — no Attack, no ActionFailed, no SystemMessage. aCis
// PlayerAI.thinkAttack:
//
//     if (_actor.getMove().maybeMoveToPawn(target, physicalAttackRange, shift))
//     { if (shift) { doIdleIntention(); clientActionFailed(); } return; }
//
// and gameclient.attackRequest correctly sends shift = 0, so that branch is
// silent by construction. The gateway used to drop 0x60, which is what made a
// perfectly healthy mob look like a ghost: target_ok came back, every swing
// went out, and the browser was told nothing whatsoever. The same objectIds
// answer every swing once the character is standing next to them.
//
// MoveToPawn is not a refusal. It is the server saying "your character is
// running to that thing" — so the honest fix is to RUN, exactly as retail
// does, not to print an invented apology. There is no retail system message
// on this branch and none is fabricated here.
//
// Two more packets rode the same hole and are handled here:
//   TargetUnselected(0x2a) — the server dropped our target. Leaving it on
//     screen is a second silent swallow: aCis Creature.onAction takes the
//     `player.getTarget() != this` branch and merely RE-targets, so the next
//     swing is consumed as a targeting click.
//   AutoAttackStart/Stop(0x2b/0x2c) — the in-combat stance broadcast.
//
// install() takes the pieces it needs rather than importing main.js, so the
// wiring is one call and no module cycle.
// ctx: { combat, entities, character: () => Character|null, selfId: () => id }
// character and selfId are read through functions because main.js assigns both
// long after the handlers are registered.
export function installCombatFeedback(net, ctx) {
  const { combat, entities, character, selfId } = ctx;
  const state = { approachingId: null, approachDistance: 0, inCombat: new Set() };

  // MoveToPawn.distance is the stop radius in L2 units; the client walks to a
  // point that far short of the pawn. 100 L2 units = 1 m (js/coords.js).
  const L2_TO_M = 0.01;

  net.on('moveToPawn', (msg) => {
    const me = selfId();
    // face the mover at its pawn either way — MoveToPawn is also how aCis
    // rotates a creature toward what it is about to hit
    const mover = msg.id === me ? null : entities.getEntity(msg.id);
    const pawn = entities.getEntity(msg.targetId);
    if (!pawn) return;
    const to = pawn.group.position;
    if (mover) {
      mover.group.rotation.y = Math.atan2(
        to.x - mover.group.position.x, to.z - mover.group.position.z);
      return;
    }
    const ch = character();
    if (msg.id !== me || !ch) return;
    // Our character: the server has already started walking us server-side.
    // Walk the local model to the same place WITHOUT sending a move order —
    // a moveTo here would be a second, competing order the server never asked
    // for (retail sends nothing back on MoveToPawn either).
    state.approachingId = msg.targetId;
    state.approachDistance = msg.distance;
    const from = ch.group.position;
    const dx = to.x - from.x, dz = to.z - from.z;
    const d = Math.hypot(dx, dz);
    const stop = Math.max(0, (msg.distance || 0) * L2_TO_M);
    const goal = to.clone();
    if (d > stop && d > 1e-4) {
      goal.x = from.x + dx / d * (d - stop);
      goal.z = from.z + dz / d * (d - stop);
    }
    ch.setTarget(goal);
  });

  net.on('target_lost', (msg) => {
    if (msg.id !== selfId()) return;
    // the server no longer holds this target; keeping the frame up is what
    // makes the NEXT swing disappear into a re-target
    state.approachingId = null;
    combat.clearTarget();
  });

  net.on('autoAttack', (msg) => {
    if (msg.on) state.inCombat.add(msg.id);
    else state.inCombat.delete(msg.id);
    if (msg.id === selfId()) {
      state.selfInCombat = !!msg.on;
      if (!msg.on) state.approachingId = null;
    }
  });

  net.on('stopMove', (msg) => {
    const ch = character();
    if (msg.id === selfId() && ch) {
      state.approachingId = null;
      ch.clearTarget();
    }
  });

  // -- silence tripwire ----------------------------------------------------
  //
  // The defect this whole block exists for was invisible because nothing was
  // counting. Every outgoing attack op is now paired with whatever came back
  // for it, and a swing that gets NOTHING within SILENCE_MS is recorded as a
  // "silent swing". A silent swing is a bug by definition: aCis answers an
  // attack with a swing (Attack), an approach (MoveToPawn), or a refusal
  // (ActionFailed and/or SystemMessage) — there is no fourth outcome. The
  // counter is asserted at zero by editor/world/verify_ghostnpc.js.
  //
  // It observes net._emit instead of registering handlers, because
  // NetClient.on keeps ONE handler per op and `attack`/`sysMsg`/`actionFailed`
  // already belong to main.js. Nothing is printed to chat: no retail system
  // message exists for the approach branch, so inventing one would be a
  // fidelity regression. The player-visible cure is the character actually
  // running to the mob, which is what retail does with MoveToPawn.
  const SILENCE_MS = 4000;
  // Only ops that ARE an answer to an attack. `status` and `die` are
  // deliberately absent: they stream constantly from every creature in range,
  // so counting them would let ambient traffic mark a silent swing "answered"
  // and hide exactly the defect this counter exists to catch.
  const FEEDBACK_OPS = new Set([
    'attack', 'actionFailed', 'sysMsg', 'moveToPawn', 'target_lost', 'autoAttack',
  ]);
  state.swingsOut = 0;
  state.swingsAnswered = 0;
  state.silentSwings = 0;
  let pending = [];              // {t, id} attacks still waiting for an answer

  const origSend = net.send.bind(net);
  net.send = (op, fields = {}) => {
    const ok = origSend(op, fields);
    if (op === 'attack' && ok) {
      state.swingsOut++;
      pending.push({ t: performance.now(), id: fields.id });
    }
    return ok;
  };

  const origEmit = net._emit.bind(net);
  net._emit = (op, msg) => {
    if (pending.length && FEEDBACK_OPS.has(op)) {
      state.swingsAnswered += pending.length;
      pending = [];
    }
    return origEmit(op, msg);
  };

  state.sweepSilence = () => {
    const now = performance.now();
    const stale = pending.filter((p) => now - p.t > SILENCE_MS);
    if (stale.length) {
      state.silentSwings += stale.length;
      pending = pending.filter((p) => now - p.t <= SILENCE_MS);
      console.warn('[combat] attack with NO server answer at all:',
        stale.map((s) => s.id), '- this is the ghost-NPC defect');
    }
    return state.silentSwings;
  };
  state._sweepTimer = setInterval(state.sweepSilence, 1000);

  // verification handle (editor/world/verify_ghostnpc.js reads this)
  return state;
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
