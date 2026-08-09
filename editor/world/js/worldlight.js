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
// the blue sky-horizon colour). 81 of the 100 tiles omit start and 77 omit
// colour, so this is the fog most of the world actually renders with.
//
// A fourth default is settled the same way but by counting the MAPS rather
// than the class stream: bDistanceFog defaults to FALSE. Across every
// ZoneInfo of all 100 maps it is True 429 times and absent 391 times and
// False zero times, and UE2 only serialises what differs from the default.
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
        // bDistanceFog absent. This used to say the ZoneInfo default was
        // "NOT readable", and to fire on 3 tiles (17_20, 22_24, 25_21).
        // Both halves are now settled and neither is true any more:
        //
        //   * the default IS readable, from the map data rather than from
        //     the class: across every ZoneInfo of all 100 maps, 429 carry
        //     bDistanceFog = True and 391 omit it, and NOT ONE carries
        //     False. UE2 serialises a property only when it differs from
        //     the class default, so a default of True could not produce 429
        //     explicit Trues -- the default is False, and absent means the
        //     zone genuinely draws no distance fog.
        //   * those 3 tiles were never fog-less. light_extract.py read
        //     ZoneInfo[0] only, and on exactly those maps actor 0 is a zone
        //     that omits bDistanceFog while a later ZoneInfo on the SAME map
        //     sets it True. It now picks the zone that turns fog on
        //     (tools/world/light_extract.py `_fog_zone`), so all 100 tiles
        //     arrive here with fog.enabled true and this branch is dead for
        //     every shipped tile. `light_extract.py --check` fails if any
        //     tile ever loses its fog again.
        //
        // The branch is kept for a tile that has no ZoneInfo at all. It is
        // the ONLY remaining consumer of main.js's unsourced 60 m / 420 m
        // initial fog; nothing on disk reaches it.
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
