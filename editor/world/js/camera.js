// Third-person follow camera — partial Interlude port.
//
// Elbera Tools evidence: docs/native-camera-evidence.md. The active original
// Draw path calls native ALineagePlayerController camera methods; Engine.u's
// similarly named script is a comparison, not the runtime authority.
//
// Recovered native ordinary-branch inputs include base distance250, initial
// zoom-20, initial pitch-2700 and margin30 (L2 units/rotation units). Original
// INI selects volume=false, hit-check=true, zoom limits-200/+250 and FOV60.
// Its camera collision sweeps an extent(0.1,0.1,5), not a walking-floor ray.
// The native pitch bounds also differ from the script's symmetric15000.
//
// Still provisional here: model-half-height focus, walking-height obstruction,
// input transfer, full native tracking/camera modes and projection-axis mapping.
// Actor.Location must come from native actor placement, not model bounds.
// Do not tune these approximations into purported original behavior. The new
// BSP primary-ray library is separately scoped and not this camera's sweep.

import * as THREE from 'three';

const L2 = 0.01;                    // L2 unit -> metre (coords.js L2_TO_M)

// Original scalar inputs; full native branch behavior is not yet ported.
const BASE_DIST = 250 * L2;         // PlayerCalcView -> CalcBehindView(..., 250)
const ZOOM_MIN = -200 * L2;         // MinZoomingDist
const ZOOM_MAX = 250 * L2;          // MaxZoomingDist
const BOOM_MARGIN = 30 * L2;        // the `- 30` / `+ 30` in CalcBehindView
const DEFAULT_VIEWDIST = 230 * L2;  // FixedDefaultCameraDist[0]
const DEFAULT_PITCH = 2700 / 65536 * Math.PI * 2;    // FixedDefaultCameraPitch[0]
const PITCH_CLAMP = 15000 / 65536 * Math.PI * 2;     // legacy script clamp; native bounds differ
export const FOV_H_DEG = 60;        // Source DefaultFOV / DesiredFOV; axis interpretation pending.

// --- authored: original native input transfer is not fully ported -----------
const WHEEL_STEP = 12 * L2;         // AUTHORED zoom step per wheel notch
const DRAG_YAW = 0.005;             // AUTHORED rad per pixel
const DRAG_PITCH = 0.004;           // AUTHORED rad per pixel
const TRACK_EPS = 1e-8;             // AUTHORED numeric guard on the track vector

/**
 * Existing browser horizontal-FOV interpretation. The source INI proves 60,
 * but the native projection-axis mapping is a separate unresolved audit.
 * Three.js takes a vertical angle, so keep this conversion explicit until
 * the original projection setup is recovered.
 */
export function verticalFovDeg(aspect, horizontalDeg = FOV_H_DEG) {
  const h = THREE.MathUtils.degToRad(horizontalDeg);
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / aspect));
}

// Engine.dll UInput::Exec, 0x105b4f23..41 / 0x105b5099..bb. Native input
// truncates this command's requested angular delta, then checks abs >100.
// Rotation uses 65536 units per turn. This is neither accumulated movement
// nor a pixel threshold, and the native pitch clamp happens after the check.
export function tutorialRotationInput(yawRadians, pitchRadians) {
  const units = 65536 / (Math.PI * 2);
  return [yawRadians, pitchRadians].some(delta => Number.isFinite(delta)
    && Math.abs(Math.trunc(delta * units)) > 100);
}

export class FollowCamera {
  constructor(camera, dom, { onTutorialInput = () => {}, onFrame = null } = {}) {
    this.camera = camera;
    this.onTutorialInput = onTutorialInput;
    this.onFrame = onFrame; // Optional Elbera Tools observation; never changes camera rules.
    this._yaw = 0;
    this.pitch = DEFAULT_PITCH;
    this.setScale(1.85);            // replaced by the real model height
    this.zoom = DEFAULT_VIEWDIST - BASE_DIST;   // CurZoomingDist = -20
    this._dragging = false;
    this._last = { x: 0, y: 0 };
    // Previous final camera position, following the stored script's tracking
    // relationship. Complete native tracking behavior remains unported.
    this._prevCam = null;
    // bUseAutoTrackingPawn / Option.ini [Game] AutoTrackingPawn=True
    this.autoTrack = true;

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
      // Legacy script-based manual delta and symmetric pitch clamp. The
      // active native bounds and input transfer remain separate port work.
      const yawDelta = -dx * DRAG_YAW;
      const pitchDelta = dy * DRAG_PITCH;
      this.yaw += yawDelta;    // the setter raises manualYaw for us
      this.pitch = THREE.MathUtils.clamp(
        this.pitch + pitchDelta, -PITCH_CLAMP, PITCH_CLAMP);
      if (tutorialRotationInput(yawDelta, pitchDelta)) this.onTutorialInput(2);
    });
    dom.addEventListener('wheel', e => {
      e.preventDefault();
      // The limits are source configuration; wheel-to-zoom transfer is still
      // browser compatibility behavior.
      this.zoom = THREE.MathUtils.clamp(
        this.zoom + Math.sign(e.deltaY) * WHEEL_STEP, ZOOM_MIN, ZOOM_MAX);
      // Original ZOOMINPRESS/ZOOMOUTPRESS send bit4 after the command's
      // clamp, even when already at its limit. A zero wheel event is no input.
      if (Number.isFinite(e.deltaY) && e.deltaY !== 0) this.onTutorialInput(4);
    }, { passive: false });
  }

  // A manual yaw write suppresses this browser tracking branch for one
  // frame, preserving the input instead of cancelling it against _prevCam.
  // The stored script supplies the comparison; native parity is not implied.
  get yaw() { return this._yaw; }
  set yaw(v) { this._yaw = v; this.manualYaw = true; }

  // The requested boom is an absolute length in L2 units. The separate
  // model-half-height focus below remains a browser compatibility rule.
  get boom() { return Math.max(0, BASE_DIST + this.zoom - BOOM_MARGIN); }
  get minDist() { return BASE_DIST + ZOOM_MIN - BOOM_MARGIN; }   // 0.20 m
  get maxDist() { return BASE_DIST + ZOOM_MAX - BOOM_MARGIN; }   // 4.70 m
  get defaultDist() { return DEFAULT_VIEWDIST - BOOM_MARGIN; }   // 2.00 m
  // Back-compat with the callers/tests that set `dist` directly.
  get dist() { return this.boom; }
  set dist(d) {
    this.zoom = THREE.MathUtils.clamp(d + BOOM_MARGIN - BASE_DIST, ZOOM_MIN, ZOOM_MAX);
  }

  /** H = the loaded model's true world height, metres. */
  setScale(H) {
    if (!(H > 0.01)) H = 1.85;
    this.charH = H;
    // Provisional visual focus, not recovered native ViewTarget.Location.
    this.headOffset = H / 2;
  }

  /** Apply the source slot-0 pitch and distance. Native transitions are not
   * reproduced here. World entry also uses this without claiming user input. */
  resetToDefaultView() {
    this.pitch = DEFAULT_PITCH;
    this.zoom = DEFAULT_VIEWDIST - BASE_DIST;
  }

  // This browser branch does not integrate dt. Native camera transition and
  // tracking behavior remain separate from this compatibility implementation.
  update(dt, focus, terrain) {
    const target = new THREE.Vector3(focus.x, focus.y + this.headOffset, focus.z);

    // --- auto-tracking yaw (bUseAutoTrackingPawn) --------------------------
    // Legacy script-derived relationship: yaw toward the current focus from
    // the previous final camera position. This uses the provisional browser
    // focus and does not implement all native tracking states.
    if (this.autoTrack && !this.manualYaw && this._prevCam) {
      const tx = target.x - this._prevCam.x;
      const tz = target.z - this._prevCam.z;     // vect(1,1,0): planar only
      // _yaw, not yaw: tracking is not a manual rotation.
      if (tx * tx + tz * tz > TRACK_EPS) this._yaw = Math.atan2(tx, tz);
    }
    this.manualYaw = false;

    // --- boom --------------------------------------------------------------
    const sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
    // View = vect(1,0,0) >> CameraRotation, i.e. the direction the camera
    // looks; the camera sits `boom` back along it.
    const view = new THREE.Vector3(
      Math.sin(this.yaw) * cp, -sp, Math.cos(this.yaw) * cp);

    let boom = this.boom;
    let obstruction = null;

    // --- collision: shorten the boom, never lift the camera -----------------
    // Legacy browser approximation, NOT the native Trace(false). Original
    // trace reaches ViewDist+30 (= requested boom+60), then assigns the
    // signed min(projectedHit,ViewDist)-30. This shorter, clamped height march
    // can confuse another walk layer with an obstruction and collapse to
    // zero. It remains explicit while original BSP/static trace semantics
    // are recovered; rendered building triangles are not a valid replacement.
    if (terrain) {
      const STEP = 0.15;                       // AUTHORED march step, metres
      const reach = boom + BOOM_MARGIN;
      for (let s = STEP; s <= reach; s += STEP) {
        const px = target.x - view.x * s;
        const py = target.y - view.y * s;
        const pz = target.z - view.z * s;
        const ground = terrain.heightAtWorld(px, pz, py);
        if (ground != null && py < ground) {
          if (this.onFrame) obstruction = { kind: 'walking-height', distance: s,
            point: [px, py, pz], floorY: ground };
          boom = Math.max(0, s - BOOM_MARGIN);
          break;
        }
      }
    }

    const desired = new THREE.Vector3(
      target.x - view.x * boom,
      target.y - view.y * boom,
      target.z - view.z * boom,
    );

    // Direct assignment retains the current browser tracking relationship.
    // This alone does not prove all native smoothing/transition behavior.
    this.camera.position.copy(desired);
    this.camera.lookAt(target);

    // OldCameraLocation
    this._prevCam = desired.clone();
    this.onFrame?.({ target: target.toArray(), position: desired.toArray(),
      requestedBoom: this.boom, actualBoom: boom, yaw: this.yaw, pitch: this.pitch,
      obstruction });
  }
}
