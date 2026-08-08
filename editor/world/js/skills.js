// M4/M5: casting bar + per-skill cooldown state + skill visual effects.
// The retail shortcut UI lives in js/ui/shortcutwnd.js; the invented
// 10-slot palette that used to render here is deleted. What remains is
// what other UI needs: castSkill() (cooldown gate), finishCast(), and the
// casting bar that fills over hitTime.

export class SkillBar {
  constructor(rootEl, castBarEl, castFillEl, castNameEl, { onCast } = {}) {
    // rootEl is legacy (the deleted palette container); may be null
    this.castBar = castBarEl;
    this.castFill = castFillEl;
    this.castName = castNameEl;
    this.onCast = onCast || (() => {});
    this.skills = new Map();   // skillId -> {level, cooling, timer}
    this.cast = null;          // {skillId, t0, hitTime, raf}
    this.reuse = new Map();    // skillId -> {t0, total} ms (sweep overlays)
  }

  /** Server-authoritative reuse (skillCoolTime op — total/left in ms
   *  after the caller's unit conversion) or the cast lock's own hitTime;
   *  the windows sweep their overlays off this. */
  setReuse(skillId, ms, leftMs = ms) {
    if (!(ms > 0)) return;
    this.reuse.set(skillId, { t0: performance.now() - (ms - leftMs), total: ms });
  }

  /** {frac, left} for an active cooldown, else null. */
  reuseLeft(skillId, now = performance.now()) {
    const r = this.reuse.get(skillId);
    if (!r) return null;
    const left = r.total - (now - r.t0);
    if (left <= 0) { this.reuse.delete(skillId); return null; }
    return { frac: left / r.total, left };
  }

  register(skills) {
    this.skills.clear();
    for (const s of skills) this.skills.set(s.id, { level: s.level, cooling: false, timer: null });
  }

  castSkill(skillId) {
    const s = this.skills.get(skillId);
    if (s && s.cooling) return false;
    if (this.onCast(skillId) === false) return false;
    if (s) {
      s.cooling = true;
      // safety: never leave a skill stuck if skillLaunch never comes
      clearTimeout(s.timer);
      s.timer = setTimeout(() => this.finishCast(skillId), 3000);
    }
    return true;
  }

  finishCast(skillId) {
    const s = this.skills.get(skillId);
    if (!s) return;
    s.cooling = false;
  }

  // casting bar for the local player's in-flight cast
  startCastBar(skillId, level, hitTime, name) {
    this.stopCastBar();
    this.cast = { skillId, t0: performance.now(), hitTime: Math.max(100, hitTime || 1000) };
    // the cast lock also sweeps — but only when no longer server reuse is
    // already tracked (MagicSkillUse carries the real reuseDelay in ms;
    // aCis sends no SkillCoolTime on cast, so that op wins when present)
    const existing = this.reuseLeft(skillId);
    if (!existing || existing.left < this.cast.hitTime) {
      this.setReuse(skillId, this.cast.hitTime);
    }
    this.castName.textContent = name || `Skill #${skillId}`;
    this.castBar.classList.add('visible');
    const tick = () => {
      if (!this.cast) return;
      const f = Math.min(1, (performance.now() - this.cast.t0) / this.cast.hitTime);
      this.castFill.style.width = (f * 100).toFixed(1) + '%';
      if (f < 1) this.cast.raf = requestAnimationFrame(tick);
      else this.stopCastBar();
    };
    tick();
  }

  stopCastBar() {
    if (this.cast && this.cast.raf) cancelAnimationFrame(this.cast.raf);
    this.cast = null;
    this.castBar.classList.remove('visible');
  }

  /** Server aborted the in-flight cast (ActionFailed from PlayerCast.stop
   *  after CreatureCast.interrupt, sysMsg 27/748): the bar cancels and the
   *  skill unlocks — no skillLaunch will follow. */
  cancelCast() {
    const id = this.cast && this.cast.skillId;
    this.stopCastBar();
    if (id != null) this.finishCast(id);
  }

  clear() {
    this.skills.clear();
    this.stopCastBar();
  }
}

// skill launch flash: small additive sprite that pops and fades
let _activeFx = null;   // the live SkillFx (registered at construction)

/** The SkillFx instance main.js created — for modules that must spawn an
 *  effect without going through main.js's handlers (e.g. entities.js
 *  covering SELF-target skillLaunches, which main.js's entityHeadPos
 *  cannot resolve). */
export function activeSkillFx() { return _activeFx; }

export class SkillFx {
  constructor(scene) {
    this.scene = scene;
    this.fx = [];
    this.tex = makeGlowTexture();
    this.vfx = new SkillVfx(scene);      // the retail effect player
    this._seen = new WeakSet();          // skill messages already turned into FX
    _activeFx = this;
  }

  /** Drive the retail effects off the net message ring, once per frame.
   *
   *  The obvious hook — registering our own net.on('skillCast') — is not
   *  available: NetClient keeps ONE handler per op (net.js `handlers[op] = fn`,
   *  so we would displace main.js's), and window.__world.net is a read-only
   *  facade that never exposes the handler map anyway. What it does expose is
   *  `log`, the ring of every inbound message (capped at 200, entries pushed as
   *  fresh objects). So we poll it: each frame, walk the tail and spawn effects
   *  for any skillCast/skillLaunch not seen before. Identity via WeakSet means
   *  ring rotation cannot cause a replay, and the worst-case latency is one
   *  frame. This keeps every skill visual inside files this worker owns —
   *  main.js needs no edit.
   */
  _pump() {
    const w = typeof window !== 'undefined' && window.__world;
    if (!w || !w.net || !w.net.log) return;
    const log = w.net.log;
    for (let i = Math.max(0, log.length - 24); i < log.length; i++) {
      const m = log[i];
      if (!m || m.dir !== 'in') continue;
      if (m.op !== 'skillCast' && m.op !== 'skillLaunch') continue;
      if (this._seen.has(m)) continue;
      this._seen.add(m);
      // half = the actor's collision half-height, which is where UE measures
      // effect offsets from (see skillvfx.js Instance._place)
      const anchors = {
        caster: { pos: () => entityPos(m.casterId), half: entityHalf(m.casterId) },
        // a self-target skill names the caster; entityPos resolves the local
        // player too, so this covers both without special-casing
        target: { pos: () => entityPos(m.targetId) || entityPos(m.casterId),
                  half: entityHalf(m.targetId) || entityHalf(m.casterId) },
      };
      try {
        if (m.op === 'skillCast') this.vfx.cast(m.skillId, anchors);
        else this.vfx.launch(m.skillId, anchors);
      } catch (e) { /* a broken visual must never stall the frame loop */ }
    }
  }

  // main.js's skillLaunch handler still calls this with a hash-derived colour
  // (`hue = skillId * 47 % 360`). That colour is DEAD: any skillLaunch is
  // already being drawn from the retail tables by _pump(), so a flash() that
  // lands while a launch is in the log tail draws nothing — and a skill the
  // retail data does not bind draws nothing either, rather than a stand-in hue.
  //
  // The other caller (main.js's soulshot glint, `flash(shotPos, 0xfff2a8)`)
  // passes its own colour with no skillLaunch in flight, and still renders.
  flash(worldPos, color = 0x80c0ff, size = 0.6) {
    const w = typeof window !== 'undefined' && window.__world;
    if (w && lastSkillMsg(w.net.log, { op: 'skillLaunch' })) return;
    this._pop(worldPos, color, size);
  }

  _tag(obj, kind, skillId) {
    obj.userData.skillFx = { kind, skillId, source: 'soulshot-glint' };
  }

  _pop(worldPos, color, size = 0.6, skillId = null, kind = 'pop') {
    const mat = new THREE.SpriteMaterial({
      map: this.tex, color, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    s.position.copy(worldPos);
    s.scale.setScalar(size * 0.4);
    this._tag(s, kind, skillId);
    this.scene.add(s);
    this.fx.push({ s, t0: performance.now(), size, mode: 'pop' });
  }

  update() {
    this._pump();             // net-log -> retail effects
    this.vfx.update();        // retail effect player
    const now = performance.now();
    for (const f of [...this.fx]) {
      // only the 'pop' glint survives here (main.js's soulshot flash)
      const t = (now - f.t0) / 450;
      if (t >= 1) { this._remove(f); continue; }
      f.s.scale.setScalar(f.size * (0.4 + 1.8 * t));
      f.s.material.opacity = 0.95 * (1 - t);
    }
  }

  _remove(f) {
    this.scene.remove(f.s);
    f.s.material.dispose();
    if (f.s.geometry) f.s.geometry.dispose();
    this.fx.splice(this.fx.indexOf(f), 1);
  }

  clear() {
    for (const f of [...this.fx]) this._remove(f);
    this.vfx.clear();
  }
}

import * as THREE from 'three';
import { SkillVfx } from './skillvfx.js';
import { lastSkillMsg } from './skillfx_anim.js';

// world position of any entity, including the local player (self is not in
// the EntityManager — main.js keeps it as a separate Character)
function entityPos(id) {
  const w = typeof window !== 'undefined' && window.__world;
  if (!w) return null;
  if (w.net.selfId === id && w.character) return w.character.group.position;
  const e = w.entities && w.entities.getEntity(id);
  return e ? e.group.position : null;
}

// Half of the actor's rendered height — UE measures effect offsets from the
// centre of the collision cylinder, the client's groups sit at the feet.
function entityHalf(id) {
  const w = typeof window !== 'undefined' && window.__world;
  if (!w) return null;
  if (w.net.selfId === id && w.character) return (w.character.heightM || 1.7) / 2;
  const e = w.entities && w.entities.getEntity(id);
  return e ? (e.heightM || 1.7) / 2 : null;
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
