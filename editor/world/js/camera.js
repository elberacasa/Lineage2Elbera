// Third-person follow camera — a port of the retail Interlude camera.
//
// SOURCE. Everything numeric below was decoded from the shipped client in
// assets/interlude/, not invented:
//
//   * `Engine.LineagePlayerController` (class source text recovered from
//     assets/interlude/system/Engine.u, Lineage2Ver111 — decrypt with
//     `tools/bin/l2encdec -c decode -p 111`, the same trick
//     tools/uscript/extract_uscript.py uses on Interface.u/NWindow.u):
//
//       event PlayerCalcView(...)  ->  CalcBehindView(CameraLocation,
//                                                     CameraRotation, 250);
//       function CalcBehindView(out vector CameraLocation, ..., float Dist)
//       {
//           CameraLocation.Z += CameraViewHeightAdjust;
//           ...
//           if( CameraRotation.Pitch < -15000) CameraRotation.Pitch = -15000;
//           else if( CameraRotation.Pitch > 15000) CameraRotation.Pitch = 15000;
//
//           ViewDist = Dist + CurZoomingDist;
//           View = vect(1,0,0) >> CameraRotation;
//           if( Trace( HitLocation, HitNormal,
//                      CameraLocation - (ViewDist + 30) * vector(CameraRotation),
//                      CameraLocation, false ) != None )
//               ViewDist = FMin( (CameraLocation - HitLocation) Dot View, ViewDist );
//           CameraLocation -= (ViewDist - 30) * View;
//       }
//
//   * `assets/interlude/system/user.ini` (Lineage2Ver413 — decrypt with
//     `tools/bin/l2encdec -c decode -p 413`):
//
//       [Engine.PlayerController]
//       DesiredFOV=60.0
//       DefaultFOV=60.0
//
//       [Engine.LineagePlayerController]
//       CameraViewHeightAdjust=0.0
//       bUseAutoTrackingPawn=true
//       AutoTrackingPawnSpeed=0.4
//       MaxZoomingDist=250
//       MinZoomingDist=-200
//       FixedDefaultCameraYaw[0]=0            ; ";2 the normal Follow view"
//       FixedDefaultCameraPitch[0]=-2700.0
//       FixedDefaultCameraDist[0]=230.0
//       FixedDefaultCameraViewHeight[0]=0.0
//
//   * `assets/interlude/system/Option.ini`  ->  [Game] AutoTrackingPawn=True
//     (the in-game "camera tracking" checkbox; OptionWnd.CameraBox in
//     Interface.u reads exactly this key), and GamePlayViewportX/Y=1024/768.
//
// The arithmetic that follows from that source, in L2 units:
//
//   ViewDist  = 250 + CurZoomingDist,  CurZoomingDist in [-200, +250]
//             => ViewDist in [50, 500]
//   boom      = ViewDist - 30          => [20, 470] units
//   default   = FixedDefaultCameraDist[0] 230 (the ini compares it against
//               `CurZoomingDist+250.0`, so it IS a ViewDist)  => boom 200
//   pitch     = 2700 / 65536 * 2pi     = 0.25888 rad below the horizon
//   clamp     = 15000 / 65536 * 2pi    = 1.43815 rad
//
// LOOK-AT POINT. `CameraLocation = ViewTarget.Location` with
// CameraViewHeightAdjust=0, and an Unreal Actor's Location is the CENTRE of
// its collision cylinder — CollisionHeight is the HALF height. aCis agrees
// from the other side: MoveBackwardToLocation.java does
// `_targetZ += player.getCollisionHeight()` to go "from floor level to head
// level", and data/xml/classes/*.xml gives a human fighter height 23 (male)
// / 23.5 (female) against a ~46-unit-tall model. So the retail camera looks
// at the character's MID height, and that is derivable from the model we
// already loaded: H/2. (The previous 0.9*H head-level target was authored.)
//
// WHAT IS STILL AUTHORED, and marked as such at each site: the wheel step,
// the drag sensitivities, and the collision march. Retail's are in native
// code (L2.exe), not in any .u or .ini in this repository.
//
// NOTE ON SMOOTHING. This file used to ease the camera position toward its
// target with `position.lerp(desired, 1-exp(-10*dt))`. That has to go, and not
// only because retail assigns CameraLocation outright: auto-tracking derives
// the yaw from `CameraLocation - OldCameraLocation`, so if OldCameraLocation
// lags the boom by a smoothing step, every yaw the player dials in with a
// right-drag is read back out of that stale vector and cancelled on the next
// frame. Measured on the live client with the smoothing still in: setting
// followCam.yaw to 1.9 rad on an idle character snapped back to the previous
// 0.691 within one frame and stayed there. Unsmoothed, `target - prevCam` is
// exactly the view direction whenever the character has not moved, so
// auto-tracking is the identity then and a chase only when it should be.

import * as THREE from 'three';

const L2 = 0.01;                    // L2 unit -> metre (coords.js L2_TO_M)

// --- retail constants (see the header for the source of each) ---------------
const BASE_DIST = 250 * L2;         // PlayerCalcView -> CalcBehindView(..., 250)
const ZOOM_MIN = -200 * L2;         // MinZoomingDist
const ZOOM_MAX = 250 * L2;          // MaxZoomingDist
const BOOM_MARGIN = 30 * L2;        // the `- 30` / `+ 30` in CalcBehindView
const DEFAULT_VIEWDIST = 230 * L2;  // FixedDefaultCameraDist[0]
const DEFAULT_PITCH = 2700 / 65536 * Math.PI * 2;    // FixedDefaultCameraPitch[0]
const PITCH_CLAMP = 15000 / 65536 * Math.PI * 2;     // the +-15000 clamp
export const FOV_H_DEG = 60;        // DefaultFOV / DesiredFOV, horizontal in UE2

// --- authored: no retail source exists in this repository -------------------
const WHEEL_STEP = 12 * L2;         // AUTHORED zoom step per wheel notch
const DRAG_YAW = 0.005;             // AUTHORED rad per pixel
const DRAG_PITCH = 0.004;           // AUTHORED rad per pixel
const TRACK_EPS = 1e-8;             // AUTHORED numeric guard on the track vector

/**
 * UE2 `FOVAngle` is the HORIZONTAL field of view at the viewport's aspect
 * (the shipped default viewport is 1024x768). three.js PerspectiveCamera.fov
 * is VERTICAL, so a widescreen browser window has to derive one from the
 * other or the framing stops matching retail as soon as the window is not 4:3.
 */
export function verticalFovDeg(aspect, horizontalDeg = FOV_H_DEG) {
  const h = THREE.MathUtils.degToRad(horizontalDeg);
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / aspect));
}

export class FollowCamera {
  constructor(camera, dom) {
    this.camera = camera;
    this._yaw = 0;
    this.pitch = DEFAULT_PITCH;
    this.setScale(1.85);            // replaced by the real model height
    this.zoom = DEFAULT_VIEWDIST - BASE_DIST;   // CurZoomingDist = -20
    this._dragging = false;
    this._last = { x: 0, y: 0 };
    // Previous frame's final camera position — retail keeps exactly this
    // (`OldCameraLocation`) and derives the auto-tracking yaw from it.
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
      // ManuallyCameraYaw / ManuallyCameraPitch. Retail applies them as a
      // delta on OldCameraRotation and clamps the pitch to +-15000.
      this.yaw -= dx * DRAG_YAW;    // the setter raises manualYaw for us
      this.pitch = THREE.MathUtils.clamp(
        this.pitch + dy * DRAG_PITCH, -PITCH_CLAMP, PITCH_CLAMP);
    });
    dom.addEventListener('wheel', e => {
      e.preventDefault();
      // Retail zooms CurZoomingDist between MinZoomingDist and MaxZoomingDist;
      // only the per-notch step is ours.
      this.zoom = THREE.MathUtils.clamp(
        this.zoom + Math.sign(e.deltaY) * WHEEL_STEP, ZOOM_MIN, ZOOM_MAX);
    }, { passive: false });
  }

  // Yaw is ManuallyCameraYaw's target, and retail's rule is that a manual
  // rotation SUPPRESSES auto-tracking for that frame
  // (`if (ManuallyCameraYaw != 0) { CameraRotation.Yaw = OldCameraRotation.Yaw; }`
  // instead of the tracking branch). Writing `.yaw` from outside — the drag
  // handler, a verify script staging a shot — is exactly that manual
  // rotation, so the assignment raises the flag itself. Without this the
  // tracking branch reads the new yaw straight back out of the previous
  // frame's camera position and cancels it: measured live, `followCam.yaw =
  // 1.9` on an idle character was back to the old 0.858 on the next frame.
  get yaw() { return this._yaw; }
  set yaw(v) { this._yaw = v; this.manualYaw = true; }

  // Retail's boom is an ABSOLUTE length in L2 units — it does not scale with
  // the character. Only the look-at height does, and that one is the model's
  // own half height (see the header).
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
    // ViewTarget.Location = centre of the collision cylinder = H/2.
    this.headOffset = H / 2;
  }

  /** Reset to FixedDefaultCamera[0], the retail "normal Follow view". */
  resetToDefaultView() {
    this.pitch = DEFAULT_PITCH;
    this.zoom = DEFAULT_VIEWDIST - BASE_DIST;
  }

  // `dt` is unused: retail's CalcBehindView is frame-rate independent by
  // construction — every term is derived from the current rotation, zoom and
  // view-target position, and nothing is integrated over time. The parameter
  // stays for the call site's signature.
  update(dt, focus, terrain) {
    const target = new THREE.Vector3(focus.x, focus.y + this.headOffset, focus.z);

    // --- auto-tracking yaw (bUseAutoTrackingPawn) --------------------------
    // CalcBehindView, verbatim:
    //     View = vect(1,1,0)*(CameraLocation-OldCameraLocation);
    //     CameraRotation = Vector2Rotator(View);
    // CameraLocation at that point is the VIEW TARGET (the boom has not been
    // subtracted yet) and OldCameraLocation is the previous frame's final
    // camera position, so the vector points from where the camera was to
    // where the character now is. Yawing onto it is what makes the retail
    // camera swing in behind you as you walk. A drag this frame wins, exactly
    // as `if (ManuallyCameraYaw != 0)` does.
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

    // --- collision: shorten the boom, never lift the camera -----------------
    // Retail traces from the view target out to (boom + 30) and clips the
    // boom to the first hit. Lifting the camera to sit on top of the surface
    // (what this file used to do) has no retail equivalent, and it is what
    // let the camera end up under the ground when the height lookup
    // disagreed with the drawn mesh: a lift is only ever as good as the
    // height it lifts to, while a clip cannot put the camera past a surface
    // it never reached. The trace here is a march against the same height
    // router the character walks on — the browser has no BSP raycast per
    // frame, and marching is a conservative approximation of one: it stops at
    // the FIRST sample whose ground is above the boom.
    if (terrain) {
      const STEP = 0.15;                       // AUTHORED march step, metres
      const reach = boom + BOOM_MARGIN;
      for (let s = STEP; s <= reach; s += STEP) {
        const px = target.x - view.x * s;
        const py = target.y - view.y * s;
        const pz = target.z - view.z * s;
        const ground = terrain.heightAtWorld(px, pz, py);
        if (ground != null && py < ground) {
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

    // `CameraLocation -= (ViewDist - 30) * View;` — assigned, not eased. See
    // the NOTE ON SMOOTHING at the top of this file for why the easing that
    // used to be here could not stay.
    this.camera.position.copy(desired);
    this.camera.lookAt(target);

    // OldCameraLocation
    this._prevCam = desired.clone();
  }
}
