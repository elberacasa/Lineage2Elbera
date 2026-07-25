// M4: L2-style skill bar + casting bar + skill visual effects.
//
// SkillBar: slots populated from skillList + skillmeta (fallback names/
// icons while metadata is absent). Click or number key (1..9,0) casts on
// the current target; the slot is disabled while a cast of that skill is
// in flight (until skillLaunch, or a 3 s safety timeout).
// CastingBar: shown while the local player has a skillCast in flight,
// filling over hitTime; a new cast restarts it.

import { skillMeta, skillInfo } from './gamedata.js';

const MAX_SLOTS = 10;

export class SkillBar {
  constructor(rootEl, castBarEl, castFillEl, castNameEl, { onCast } = {}) {
    this.root = rootEl;
    this.castBar = castBarEl;
    this.castFill = castFillEl;
    this.castName = castNameEl;
    this.onCast = onCast || (() => {});
    this.slots = [];
    this.skills = new Map();   // skillId -> {slot el, level, cooling}
    this.cast = null;          // {skillId, t0, hitTime, raf}
  }

  async populate(skills) {
    const meta = await skillMeta();
    this.root.innerHTML = '';
    this.slots = [];
    this.skills.clear();
    skills.slice(0, MAX_SLOTS).forEach((s, i) => {
      const info = skillInfo(meta, s.id);
      const el = document.createElement('div');
      el.className = 'skill-slot';
      el.title = `${info.name} (Lv ${s.level}) [${(i + 1) % 10}]`;
      el.innerHTML = (info.icon
        ? `<img src="${info.icon}" alt="">`
        : '<div class="icon-fallback">?</div>')
        + `<span class="slot-key">${(i + 1) % 10}</span>`;
      el.addEventListener('click', () => this.castSkill(s.id));
      // M5: hotbar assign — drag, or right-click for first free slot
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-l2vzla',
          JSON.stringify({ type: 'skill', id: s.id }));
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.onAssign) this.onAssign({ type: 'skill', id: s.id });
      });
      this.root.appendChild(el);
      this.slots.push({ id: s.id, el });
      this.skills.set(s.id, { el, level: s.level, cooling: false });
    });
    this.root.classList.toggle('visible', skills.length > 0);
  }

  byIndex(i) { return this.slots[i] && this.slots[i].id; }

  castSkill(skillId) {
    const s = this.skills.get(skillId);
    if (!s || s.cooling) return false;
    if (this.onCast(skillId) === false) return false;
    s.cooling = true;
    s.el.classList.add('cooling');
    // safety: never leave a slot stuck if skillLaunch never comes
    clearTimeout(s.timer);
    s.timer = setTimeout(() => this.finishCast(skillId), 3000);
    return true;
  }

  finishCast(skillId) {
    const s = this.skills.get(skillId);
    if (!s) return;
    s.cooling = false;
    s.el.classList.remove('cooling');
  }

  // casting bar for the local player's in-flight cast
  startCastBar(skillId, level, hitTime, name) {
    this.stopCastBar();
    this.cast = { t0: performance.now(), hitTime: Math.max(100, hitTime || 1000) };
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

  clear() {
    this.root.innerHTML = '';
    this.root.classList.remove('visible');
    this.skills.clear();
    this.stopCastBar();
  }
}

// skill launch flash: small additive sprite that pops and fades
export class SkillFx {
  constructor(scene) {
    this.scene = scene;
    this.fx = [];
    this.tex = makeGlowTexture();
  }

  flash(worldPos, color = 0x80c0ff, size = 0.6) {
    const mat = new THREE.SpriteMaterial({
      map: this.tex, color, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    s.position.copy(worldPos);
    s.scale.setScalar(size * 0.4);
    this.scene.add(s);
    this.fx.push({ s, t0: performance.now(), size });
  }

  update() {
    const now = performance.now();
    for (const f of [...this.fx]) {
      const t = (now - f.t0) / 450;
      if (t >= 1) {
        this.scene.remove(f.s);
        f.s.material.dispose();
        this.fx.splice(this.fx.indexOf(f), 1);
        continue;
      }
      f.s.scale.setScalar(f.size * (0.4 + 1.8 * t));
      f.s.material.opacity = 0.95 * (1 - t);
    }
  }

  clear() {
    for (const f of this.fx) { this.scene.remove(f.s); f.s.material.dispose(); }
    this.fx = [];
  }
}

import * as THREE from 'three';

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
