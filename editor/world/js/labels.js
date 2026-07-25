// Overhead name labels: canvas-drawn text on a billboard sprite.

import * as THREE from 'three';

export function makeLabel(text, color = '#ffffff', worldScale = 1) {
  const pad = 8, fontSize = 26;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `${fontSize}px -apple-system, "Segoe UI", sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = fontSize + pad * 2;
  canvas.width = w * 2;             // 2x for crispness
  canvas.height = h * 2;
  ctx.scale(2, 2);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  // soft dark plate behind the text
  ctx.fillStyle = 'rgba(8,10,14,0.55)';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 6);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, pad, h / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  }));
  const scale = 0.0055 * worldScale;   // canvas px -> meters
  sprite.scale.set(w * scale, h * scale, 1);
  sprite.center.set(0.5, 0);        // anchor at bottom-center: position = top of head
  return sprite;
}
