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
// substituting a default it cannot read — and the defaults are now READ, from
// the engine package itself (below), so the fog fallbacks are retail's.

import * as THREE from 'three';
import { L2_TO_M } from './coords.js';

// ZoneInfo's own defaultproperties, decoded from the packed stream at the tail
// of the Engine.ZoneInfo UClass export in assets/interlude/system/Engine.u
// (Lineage2Ver111; `tools/bin/l2encdec -c decode -p 111`). The stream is
// identified by the parse that consumes the class body EXACTLY and whose every
// property name is a real UProperty export — one candidate offset satisfies
// both, and it decodes to a coherent ZoneInfo block:
//
//   KillZ -10000, AmbientSaturation 255, DistanceFogColor (128,128,128,0),
//   DistanceFogStart 3000, DistanceFogEnd 8000, DistanceFogBlendTime 1,
//   TexUPanSpeed 1, TexVPanSpeed 1, bStatic, bNoDelete, bSunAffect,
//   Texture S_ZoneInfo
//
// Confirmed against the data rather than taken on trust: UE2 serialises an
// actor property only when it DIFFERS from the class default, so these three
// values must never appear in a map. Across all 100 extracted tiles the
// serialised sets are
//   start  {0, 100, 120, 200, 300, 500, 1000, 1500, 6000, 8000}
//   end    {3000, 5000, 7000, 9000, 10000, 12000, 13000, 15000, 18000,
//           20000, 25000, 30000}
//   color  22 distinct values, incl. (105,105,105) and (147,147,147)
// and none of them contains 3000, 8000 or (128,128,128) respectively —
// 3 for 3, which is what these being the defaults predicts.
//
// These replace the client's own invented fallbacks (a 60 m near plane and
// the blue sky-horizon colour). 72 of the 100 tiles omit both start and
// colour, so this is the fog most of the world actually renders with.
const FOG_START_L2 = 3000;                     // Engine.ZoneInfo default
const FOG_END_L2 = 8000;                       // Engine.ZoneInfo default
const FOG_COLOR_DEFAULT = [128, 128, 128];     // Engine.ZoneInfo default, RGB

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
      if (fog && fog.enabled) {
        // Every absent field means "equal to the ZoneInfo class default", and
        // the defaults are sourced (above), so each one is filled in rather
        // than falling back to the client's rig.
        const c = fog.color || FOG_COLOR_DEFAULT;
        // DistanceFogColor is 8-bit RGBA. Every other 8-bit colour in this
        // client enters three through a hex/byte constructor, which tags it
        // sRGB; bare setRGB() would instead plant the byte in the LINEAR
        // working space and render it far too light (128 came out as 0xbc).
        this.scene.fog.color.setRGB(
          c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
        this.scene.fog.near = (fog.start != null ? fog.start : FOG_START_L2) * L2_TO_M;
        this.scene.fog.far = (fog.end != null ? fog.end : FOG_END_L2) * L2_TO_M;
      } else if (this.fallback.fog) {
        // bDistanceFog absent or false. Whether the ZoneInfo default is
        // "off" was NOT readable from the part of the defaults stream that
        // decoded, so this deliberately keeps the client's own rig rather
        // than asserting retail draws no fog here. Affects 3 tiles
        // (17_20, 22_24, 25_21), all of which DO carry a fog colour.
        const c = fog && fog.color;
        if (c) this.scene.fog.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
        else this.scene.fog.color.copy(this.fallback.fog.color);
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
