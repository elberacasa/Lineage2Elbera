// Overhead name labels — the ANCHOR half. nameplates.js draws them.
//
// Until 2026-08 this file built a world-space THREE.Sprite whose scale was
// `0.0055 * worldScale` metres per canvas pixel, so every name grew as the
// camera approached it. That is not what Interlude does: the retail name is a
// UCanvas draw — one projected world point plus a fixed-size bitmap-font
// string — and the evidence for that (Engine.dll's export signatures, plus
// what is NOT recoverable because Engine.dll is Themida-packed) is written out
// in full at the top of nameplates.js.
//
// What survives here is the contract entities.js already codes against:
// `makeLabel()` returns an Object3D you parent to the entity group and move
// with `.position.y`, and `.visible` still hides it. The object is now an
// empty anchor: it has no geometry, no material and no texture, so a name
// costs one matrix instead of a canvas, a THREE.CanvasTexture and a
// SpriteMaterial. The screen-space plate is created and destroyed by
// nameplates.js from the anchor's own registration.

import * as THREE from 'three';
import { Nameplates } from './nameplates.js';
// Ground drops render their own mesh (drops.js). It is pulled in here purely
// because main.js — which this wave does not own — has no import for it, and
// labels.js is already on the client's module graph. Move the import to
// main.js when that file is next touched.
import './drops.js';

/** An overhead-name anchor.
 *
 *  @param text        what the plate says.
 *  @param color       the caller's colour. nameplates.js overrides it only
 *                     when the client itself has a better source for that
 *                     entity (an npcgrp nickcolor, or the conColor ladder) —
 *                     never with a typed substitute.
 *  @param worldScale  ACCEPTED AND IGNORED. It used to convert canvas pixels
 *                     to metres, which is the whole defect: a retail name has
 *                     no world size. Kept in the signature so entities.js —
 *                     which this lane does not own — needs no edit; drop the
 *                     parameter there and it can go.
 */
export function makeLabel(text, color = '#ffffff', worldScale = 1) {
  const anchor = new THREE.Object3D();
  anchor.name = 'nameplate-anchor';
  anchor.userData.nameplate = { text: String(text), color, worldScale };
  Nameplates.register(anchor);
  return anchor;
}

export { Nameplates };
