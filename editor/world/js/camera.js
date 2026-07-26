// Smooth orbit-follow camera: wheel zoom, right-drag orbit, gentle
// terrain collision (never dips below the surface).
//
// All distance/height parameters are CHARACTER-RELATIVE (multiples of the
// loaded model's world height) so framing stays consistent across races
// at true L2 scale (dwarf 0.34 m vs orc 0.52 m) — see setScale().

import * as THREE from 'three';

const REF_H = 1.85;           // reference height the retail tuning was made at
const MIN_PITCH = 0.05, MAX_PITCH = 1.45;

export class FollowCamera {
  constructor(camera, dom) {
    this.camera = camera;
    this.yaw = 0;               // behind the character (models face +Z)
    // retail-L2 feel: far-ish chase cam behind a narrow FOV (35 deg),
    // slight downward pitch; character sits lower-center, horizon high
    this.pitch = 0.35;
    this.setScale(REF_H);
    this.dist = this.defaultDist;
    this._dragging = false;
    this._last = { x: 0, y: 0 };

    dom.addEventListener('contextmenu', e => e.preventDefault());
    dom.addEventListener('pointerdown', e => {
      if (e.button === 2 || e.button === 1) {
        this._dragging = true;
        this._last = { x: e.clientX, y: e.clientY };
        dom.setPointerCapture(e.pointerId);
      }
    });
    dom.addEventListener('pointerup', e => {
      if (e.button === 2 || e.button === 1) this._dragging = false;
    });
    dom.addEventListener('pointermove', e => {
      if (!this._dragging) return;
      const dx = e.clientX - this._last.x;
      const dy = e.clientY - this._last.y;
      this._last = { x: e.clientX, y: e.clientY };
      this.yaw -= dx * 0.005;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, MIN_PITCH, MAX_PITCH);
    });
    dom.addEventListener('wheel', e => {
      e.preventDefault();
      this.dist = THREE.MathUtils.clamp(
        this.dist * Math.exp(e.deltaY * 0.001), this.minDist, this.maxDist);
    }, { passive: false });
  }

  // Derive every length parameter from the character's world height H.
  // Ratios are fixed against the retail tuning (H_ref = 1.85 m):
  //   default 14 m / 1.85 = 7.6 H   (same relative framing as before)
  //   min     ~2.4 H                (close-up: character fills ~half the
  //                                  frame at FOV 35: H/(2*d*tan17.5) = .5)
  //   max     80 m / 1.85 = 43 H
  setScale(H) {
    if (!(H > 0.01)) H = REF_H;
    this.charH = H;
    this.minDist = 2.4 * H;
    this.maxDist = 43 * H;
    this.defaultDist = 7.6 * H;
    this.headOffset = 0.9 * H;
    this.groundClearance = 0.3 * H;
    // reframe on (re)scale
    this.dist = this.defaultDist;
  }

  update(dt, focus, terrain) {
    const target = new THREE.Vector3(
      focus.x, focus.y + this.headOffset, focus.z);

    const sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
    const desired = new THREE.Vector3(
      target.x - Math.sin(this.yaw) * cp * this.dist,
      target.y + sp * this.dist,
      target.z - Math.cos(this.yaw) * cp * this.dist,
    );

    // gentle terrain collision: lift the camera above the surface
    if (terrain) {
      const ground = terrain.heightAtWorld(desired.x, desired.z, desired.y)
        + this.groundClearance;
      if (desired.y < ground) desired.y = ground;
    }

    // critically-damped-ish smoothing
    const k = 1 - Math.exp(-10 * dt);
    this.camera.position.lerp(desired, k);
    this.camera.lookAt(target);
  }
}
