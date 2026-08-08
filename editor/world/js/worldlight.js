// The tile's own sun, ambient and fog.
//
// `assets/world/<tile>/light.json` is written by tools/world/light_extract.py
// from the map's NMovableSunLight and ZoneInfo actors. Before this, the rig was
// invented: a hand-picked sun direction, intensity, ambient colour and fog
// range, none of which came from the game (docs/foundation-audit.md F4).
//
// WHAT IS TAKEN FROM RETAIL, and what deliberately is not:
//
//   direction  TAKEN. A UE Rotator converts exactly, and it is the visually
//              dominant term — it sets where every shadow falls. Two distinct
//              sun setups exist across the 100 tiles (62 at pitch -48.6/yaw
//              139.1, 38 at -60/90), so this is authored per region and a
//              single constant could not have been right anywhere but by luck.
//   fog range  TAKEN. DistanceFogEnd is in L2 units and converts with L2_TO_M.
//   colours    TAKEN. AmbientVector is 0..1 RGB and DistanceFogColor is RGBA
//              bytes; both are colours in any renderer.
//
//   intensity  NOT taken. UE2's LightBrightness (70.0 on every tile) is in the
//              engine's own light units and there is no sourced conversion to
//              three.js intensity. Inventing a scale factor to "use" the value
//              would be exactly the kind of guess this pass exists to remove,
//              so the client's existing intensities stand and are marked as
//              the client's own choice. If a conversion is ever derived, it
//              belongs here.
//
// Absent fields are absent because the property equalled its UE2 class default
// and the packed stream omitted it. light_extract.py emits null rather than
// substituting a default it cannot read, so every fallback below is visibly
// the client's, not retail's.

import * as THREE from 'three';
import { L2_TO_M } from './coords.js';

// Fog: retail gives an end distance but rarely a start. Retail's own default
// start is not in the stream, so the near plane stays the client's existing
// value rather than a fabricated fraction of the end.
const CLIENT_FOG_START_M = 60;

export class WorldLight {
  constructor(scene, sun, ambient) {
    this.scene = scene;
    this.sun = sun;             // THREE.DirectionalLight
    this.ambient = ambient;     // THREE.AmbientLight
    this.tile = null;
    this.data = null;
    // The client's own rig, kept so an interior or a tile with no light.json
    // restores exactly what it had before.
    this.fallback = {
      dir: sun ? sun.userData.dir.clone() : new THREE.Vector3(0.5, 1, 0.35).normalize(),
      ambientColor: ambient ? ambient.color.clone() : new THREE.Color(0xcfd4de),
      fog: scene.fog ? scene.fog.clone() : null,
    };
  }

  // Direction of travel of the light, in three space. The rotator gives the
  // direction the light POINTS; three's DirectionalLight shines from its
  // position toward its target, so the caller places it opposite this.
  get direction() {
    const d = this.data && this.data.sun && this.data.sun.direction_l2;
    if (!d) return this.fallback.dir;
    // same axis map as coords.l2ToThree, without its metre scale: a direction
    // has no length to convert
    return new THREE.Vector3(d[0], d[2], -d[1]).normalize();
  }

  async load(tile, baseUrl = '/scenes') {
    if (this.tile === tile) return;
    this.tile = tile;
    this.data = null;
    try {
      const res = await fetch(`${baseUrl}/${tile}/light.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (this.tile !== tile) return;   // a newer tile landed mid-fetch
      this.data = data;
    } catch (err) {
      // Tiles converted before light_extract.py ran simply keep the client rig.
      console.warn(`[worldlight] ${tile}: ${err.message}`);
    }
    this.apply();
  }

  apply() {
    const d = this.data;

    if (this.ambient) {
      const v = d && d.ambient && d.ambient.vector;
      if (v) this.ambient.color.setRGB(v[0], v[1], v[2]);
      else this.ambient.color.copy(this.fallback.ambientColor);
    }

    if (this.scene.fog) {
      const fog = d && d.fog;
      const c = fog && fog.color;
      if (c) this.scene.fog.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
      else if (this.fallback.fog) this.scene.fog.color.copy(this.fallback.fog.color);

      if (fog && fog.enabled && fog.end != null) {
        this.scene.fog.far = fog.end * L2_TO_M;
        this.scene.fog.near = fog.start != null ? fog.start * L2_TO_M : CLIENT_FOG_START_M;
      } else if (this.fallback.fog) {
        this.scene.fog.near = this.fallback.fog.near;
        this.scene.fog.far = this.fallback.fog.far;
      }
    }
  }

  // for verification
  get summary() {
    const s = this.data && this.data.sun;
    return {
      tile: this.tile,
      sourced: !!this.data,
      pitch: s ? s.pitch_deg : null,
      yaw: s ? s.yaw_deg : null,
      fogFar: this.scene.fog ? this.scene.fog.far : null,
    };
  }
}
