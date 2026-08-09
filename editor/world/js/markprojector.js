// markprojector.js — the move-destination marker, and why there isn't one.
//
// THE SHORT VERSION. Retail Interlude draws NOTHING on the ground when you
// click to move. This module's default `show()` is a no-op. That is the fix,
// not an omission.
//
// THE LONG VERSION, because this repo previously drew one and had a paragraph
// of decoded values in front of it.
//
// The decal this client used to drop on every click was built out of
// `Engine.MarkProjector`: its texture (Engine.Gui021), its blending
// (PB_AlphaBlend on both ops), its terrain-only projection flags and its 10 s
// SetTimer are all correctly decoded from assets/interlude/system/Engine.u.
// What was never checked was the sentence those measurements were welded to —
// "this is the thing retail spawns where you clicked". It is not:
//
//   * `Spawn(class'MarkProjector', ...)` appears exactly ONCE in all 21
//     shipped script packages — LineageWarrior/WarfarePawn.PostBeginPlay —
//     and it is commented out:
//         //Mark = Spawn(class'MarkProjector',Self,'',Location);
//     Note `Location`: the PAWN's position. Even alive, it was never aimed at
//     a picked point.
//   * `bAttachMark`, the flag `UpdateMarkProjector()` needs before it does
//     anything, is never assigned true anywhere in the client. The only
//     assignment that exists is `bAttachMark=false`, inside the block that
//     flag guards.
//   * `Pawn.Mark` is only READ, in `Destroyed()`, behind `if (Mark != None)`.
//   * 157 of 157 .unr place zero of them (control: 170,892 StaticMeshActor
//     hits in the same scan, so the zero is a measurement).
//   * engine.dll exports one MarkProjector native, execUpdateDesireLocation,
//     whose only caller in the client is that same dead script path.
//
// The class is a repurposed ShadowProjector — its commented-out imports are
// Sun.tga and GRADIENT_Fade.tga and its commented-out locals are
// ShadowLocation / BoundingSphere / LightDirection — that NCSoft disabled.
//
// Regenerate every claim above:  python3 tools/dat/export_markprojector.py
//                                       --evidence [--scan-maps]
// It lands in assets/gamedata/markprojector/markprojector.json, which
// verify_markprojector.js asserts against.
//
// WHAT REMAINS UNKNOWABLE HERE. Even taking the class at face value, its
// on-ground FOOTPRINT is not computable in this repository: UE2 builds the
// projector frustum from FOV / MaxTraceDistance / DrawScale inside native
// UnProjector.cpp, which we do not have, and engine.dll is Themida-packed.
// That is precisely why the old runtime constant was a number picked to look
// right. It is not recovered here and it is not guessed here.
//
// THE ESCAPE HATCH. `?markprojector=authored` re-enables the old decal so the
// two states can be photographed from one build (shot_markprojector.js). It
// is AUTHORED in full — every geometric value below is a guess — and it is
// off unless that flag is present.

import * as THREE from 'three';

// Decoded from Engine.u by tools/dat/export_markprojector.py. Mirrored here
// only so the runtime can be read without opening the JSON; the JSON is the
// source of truth and verify_markprojector.js asserts these agree with it.
export const MARKPROJECTOR = {
  texture: 'Engine.Gui021',            // #exec Texture Import gui021.tga
  textureSize: 256,                    // 256x256 RGBA8, Mips=Off, MASKED=1
  png: '/gamedata/markprojector/gui021.png',
  clamp: true,                         // UCLAMPMODE=CLAMP VCLAMPMODE=CLAMP
  materialBlendingOp: 2,               // PB_AlphaBlend
  frameBufferBlendingOp: 2,            // PB_AlphaBlend — alpha, not additive
  fov: 1,                              // UpdateMarkProjector(): FOV = 1
  drawScale: 0.10,                     // UpdateMarkProjector(): SetDrawScale
  lifetimeS: 10,                       // SetTimer(10, false) -> DetachProjector
  terrainOnly: true,                   // bProjectBSP/StaticMesh/Particles/Actor False
  // NOT RECOVERABLE: the world-unit footprint the three values above produce.
  footprintWorldUnits: null,
  // The finding. Kept as data so nothing downstream has to re-argue it.
  instantiatedByClient: false,
};

// AUTHORED — every one of these. They exist only to render the escape-hatch
// reconstruction under ?markprojector=authored, and no retail measurement
// backs any of them. Do not promote them into the default path.
const AUTHORED_DIAMETER_M = 0.55;   // AUTHORED — footprint is not recoverable
const AUTHORED_LIFT_M = 0.02;       // AUTHORED — z-fight guard; a projector needs none
const AUTHORED_RENDER_ORDER = 2;    // AUTHORED — draw-order nudge, not a client value

/** True only when the URL explicitly asks for the authored reconstruction. */
export function authoredEnabled(search) {
  const s = search !== undefined
    ? search
    : (typeof location !== 'undefined' ? location.search : '');
  return /(^|[?&])markprojector=authored(&|$)/.test(s || '');
}

/**
 * The move-destination marker.
 *
 * Default behaviour is retail behaviour: show() draws nothing and update()
 * has nothing to do. Constructing it is still worthwhile — it keeps one named
 * place for the question "what does the client do here?" and it keeps the
 * ?markprojector=authored comparison alive.
 */
export class ClickMark {
  /**
   * @param {THREE.Scene} scene
   * @param {{authored?: boolean}} [opts] - authored defaults to the URL flag
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.authored = opts.authored !== undefined ? opts.authored : authoredEnabled();
    this.mesh = null;
    this.until = 0;
  }

  /**
   * Called with the point the player asked for.
   * @param {{x:number,y:number,z:number}} p - three.js-space destination
   * @param {(x:number,z:number,y:number)=>number} [heightAt] - ground sampler
   */
  show(p, heightAt) {
    if (!this.authored) return;          // retail: no decal
    if (!this.mesh) this.mesh = this._build();
    const y = heightAt ? heightAt(p.x, p.z, p.y) : p.y;
    this.mesh.position.set(p.x, y + AUTHORED_LIFT_M, p.z);
    this.mesh.visible = true;
    this.until = performance.now() + MARKPROJECTOR.lifetimeS * 1000;
  }

  /** Per-frame: retires the authored decal on MarkProjector's own timer. */
  update() {
    if (this.authored && this.mesh && this.mesh.visible
        && performance.now() >= this.until) {
      this.mesh.visible = false;         // Timer() -> DetachProjector(true)
    }
  }

  /** Verification hook: null whenever nothing is drawn, which is always. */
  get debug() {
    if (!this.mesh || !this.mesh.visible) return null;
    return {
      authored: true,
      pos: this.mesh.position.toArray(),
      msLeft: Math.max(0, this.until - performance.now()),
    };
  }

  _build() {
    const tex = new THREE.TextureLoader().load(MARKPROJECTOR.png);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;   // UCLAMPMODE/VCLAMPMODE
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(AUTHORED_DIAMETER_M, AUTHORED_DIAMETER_M),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,        // PB_AlphaBlend on both ops
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        toneMapped: false,
      }));
    m.rotation.x = -Math.PI / 2;  // flat on the ground
    m.renderOrder = AUTHORED_RENDER_ORDER;
    m.frustumCulled = false;
    this.scene.add(m);
    return m;
  }
}
