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
