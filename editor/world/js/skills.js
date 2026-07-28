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
    this.arcTex = makeArcTexture();
    _activeFx = this;
  }

  // main.js's skillLaunch handler calls this with the target head position.
  // When the net log tail is a skillLaunch (it always is here — NetClient
  // logs before emitting) and skillanim.json resolves the skill, the
  // per-skill signature from the DATA replaces the generic hue flash;
  // anything unresolvable keeps the old behavior.
  flash(worldPos, color = 0x80c0ff, size = 0.6) {
    const w = typeof window !== 'undefined' && window.__world;
    const msg = w ? lastSkillMsg(w.net.log, { op: 'skillLaunch' }) : null;
    if (msg) {
      skillAnimMeta().then(meta => {
        const entry = skillAnimInfo(meta, msg.skillId, msg.level || 1);
        if (entry) this.skillEffect(msg, entry, worldPos);
        else this._pop(worldPos, color, size);
      });
      return;
    }
    this._pop(worldPos, color, size);
  }

  // Per-skill visual signature (see js/skillfx_anim.js for the data rules):
  // projectile skills travel caster -> target and pop a hit flash; self/
  // aura skills ring at the target; melee skills slash-arc; ranged magic
  // without a hit sound gets the colored glow. Colors are AUTHORED per
  // sound family (effectColor) — the dats name no effect textures.
  skillEffect(msg, entry, targetPos) {
    const family = classifySkill(entry);
    const color = effectColor(entry);
    const caster = entityPos(msg.casterId);
    const feet = entityPos(msg.targetId) || targetPos;   // ground anchor
    switch (family) {
      case 'projectile':
        this._projectile(caster || targetPos, targetPos, color, msg.skillId);
        break;
      case 'aura':
        this._ring(feet, color, msg.skillId);
        break;
      case 'melee':
        this._slash(targetPos, color, msg.skillId);
        break;
      case 'glow':
        this._pop(targetPos, color, 0.8, msg.skillId);
        break;
      default:
        this._pop(targetPos, color, 0.6, msg.skillId);
    }
  }

  _tag(obj, kind, skillId) {
    obj.userData.skillFx = { kind, skillId, source: 'skillanim.json' };
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

  // AUTHORED projectile: glowing bolt sprite lerped caster -> target over
  // ~350 ms, then a hit flash at the target. (Retail bolts are engine
  // particle effects in LineageEffect.u — not data; this is simple geometry.)
  _projectile(from, to, color, skillId) {
    const mat = new THREE.SpriteMaterial({
      map: this.tex, color, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    const a = from.clone(); a.y += 1.0;        // caster chest height
    const b = to.clone();
    s.position.copy(a);
    s.scale.setScalar(0.5);
    this._tag(s, 'projectile', skillId);
    this.scene.add(s);
    this.fx.push({ s, t0: performance.now(), mode: 'projectile', a, b, color, skillId });
  }

  // AUTHORED aura: flat expanding ring at the target's feet + a soft pop.
  _ring(pos, color, skillId) {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.44, 40), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, pos.y + 0.05, pos.z);
    this._tag(ring, 'aura', skillId);
    this.scene.add(ring);
    this.fx.push({ s: ring, t0: performance.now(), mode: 'ring' });
    const head = pos.clone(); head.y += 1.2;
    this._pop(head, color, 0.7, skillId, 'aura-glow');
  }

  // AUTHORED melee slash: crescent sprite that sweeps and fades at the
  // target (crescent = canvas-drawn, no retail texture is shipped/served).
  _slash(pos, color, skillId) {
    const mat = new THREE.SpriteMaterial({
      map: this.arcTex, color, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, rotation: -0.6,
    });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.setScalar(0.3);
    this._tag(s, 'slash', skillId);
    this.scene.add(s);
    this.fx.push({ s, t0: performance.now(), mode: 'slash', size: 1.6 });
    this._pop(pos, color, 0.5, skillId, 'slash-hit');
  }

  update() {
    const now = performance.now();
    for (const f of [...this.fx]) {
      if (f.mode === 'projectile') {
        const t = (now - f.t0) / 350;
        if (t >= 1) {
          this._remove(f);
          this._pop(f.b, f.color, 0.8, f.skillId, 'hit');   // hit flash
          continue;
        }
        f.s.position.lerpVectors(f.a, f.b, t);
        f.s.scale.setScalar(0.5 + 0.15 * Math.sin(t * Math.PI));
        continue;
      }
      if (f.mode === 'ring') {
        const t = (now - f.t0) / 900;
        if (t >= 1) { this._remove(f); continue; }
        f.s.scale.setScalar(0.4 + 2.8 * t);
        f.s.material.opacity = 0.85 * (1 - t);
        continue;
      }
      if (f.mode === 'slash') {
        const t = (now - f.t0) / 400;
        if (t >= 1) { this._remove(f); continue; }
        f.s.scale.setScalar(f.size * (0.3 + 1.1 * t));
        f.s.material.rotation = -0.6 + 1.4 * t;
        f.s.material.opacity = 0.95 * (1 - t * t);
        continue;
      }
      // 'pop'
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
  }
}

import * as THREE from 'three';
import { skillAnimMeta, skillAnimInfo } from './gamedata.js';
import { classifySkill, effectColor, lastSkillMsg } from './skillfx_anim.js';

// world position of any entity, including the local player (self is not in
// the EntityManager — main.js keeps it as a separate Character)
function entityPos(id) {
  const w = typeof window !== 'undefined' && window.__world;
  if (!w) return null;
  if (w.net.selfId === id && w.character) return w.character.group.position;
  const e = w.entities && w.entities.getEntity(id);
  return e ? e.group.position : null;
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

// AUTHORED crescent for the melee slash (no retail slash texture is served)
function makeArcTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineCap = 'round';
  ctx.lineWidth = 7;
  ctx.shadowColor = 'rgba(255,255,255,.9)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(32, 32, 22, -Math.PI * 0.75, Math.PI * 0.25);
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}
