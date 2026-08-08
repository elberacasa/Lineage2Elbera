// Retail skill visual effects: a UE2 SpriteEmitter player.
//
// DATA: /gamedata/skillvfx.json (tools/dat/build_skillvfx.py), a join of the
// decoded Skill.usk binding table with the LineageEffect.u emitter definitions.
// Every number this module uses comes out of that file; there is no authored
// colour, size or timing anywhere below. Skills the retail data does not bind
// render NOTHING — that is deliberate (a documented gap beats a plausible guess).
//
// WHAT IS REPRODUCED
//   SpriteEmitter only: camera-facing textured quads with the retail texture,
//   texture-atlas subdivision, ColorScale ramp (gated on UseColorScale),
//   ColorMultiplierRange tint, Opacity + FadeIn/FadeOut envelope, LifetimeRange,
//   StartSizeRange, StartLocation box/sphere shape, StartVelocityRange,
//   Acceleration, spin, and the burst-vs-stream spawn mode.
//   714 of the 1161 emitters on bound effect classes are SpriteEmitters.
//
// WHAT IS NOT, AND WHY (these render nothing rather than a substitute):
//   MeshEmitter    413  needs LineageEffectsStaticmeshes geometry; the client
//                       has no .pskx loader yet.
//   VertMeshEmitter 13  UE2 VertMesh — umodel cannot export it at all.
//   BeamEmitter     11  procedural beam geometry with undecoded segment params.
//   (10 more sprites name a texture that was never staged.)
//
// BLENDING comes from the textures themselves, not from taste: umodel exports
// every LineageEffectsTextures PNG as RGB with NO alpha channel, and the atlases
// are glow sprites on a black field (fx_m_t0000 is a 4x4 grid, exactly the
// TextureUSubdivisions/VSubdivisions the data states). Black-on-additive is what
// that art is drawn for, so PTDS_Regular/AlphaBlend/Translucent/Brighten all draw
// additively with the texture's own luminance as coverage; only PTDS_Modulated
// and PTDS_Darken differ. Enum ordinals are read from Engine.u's
// EParticleDrawStyle export, not assumed.
//
// UNITS: the tables are in UE units (1 uu = 1 cm) with Z up; the scene is metres
// with Y up. Conversion is coords.js's L2_TO_M and the same (x, z, -y) axis map.

import * as THREE from 'three';
import { L2_TO_M } from './coords.js';

const UU = L2_TO_M;                    // 0.01 — UE units -> metres

// EParticleDrawStyle (Engine.u Enum export, ordinals 0..6):
// Regular, AlphaBlend, Modulated, Translucent, AlphaModulate…, Darken, Brighten
const DS_MODULATED = 2, DS_DARKEN = 5;

let _index = null;                     // the parsed skillvfx.json
let _indexPromise = null;
const _texCache = new Map();

export function vfxIndex() {
  if (!_indexPromise) {
    _indexPromise = fetch('/gamedata/skillvfx.json')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { _index = j; return j; })
      .catch(() => null);
  }
  return _indexPromise;
}

function texture(path) {
  if (!_texCache.has(path)) {
    const t = new THREE.TextureLoader().load('/faces/' + path);
    t.colorSpace = THREE.SRGBColorSpace;
    _texCache.set(path, t);
  }
  return _texCache.get(path);
}

function lerp(a, b, t) { return a + (b - a) * t; }
function rand(range) {                 // [min, max] -> uniform sample
  return range ? lerp(range[0], range[1], Math.random()) : 0;
}

// UE (x, y, z) offset -> three (x, z, -y), scaled from UE units to metres.
function ueToThree(v, out, scale = UU) {
  return out.set(v[0] * scale, v[2] * scale, -v[1] * scale);
}

// --------------------------------------------------------------------------
// one SpriteEmitter instance
// --------------------------------------------------------------------------

// Camera-facing instanced quads, NOT gl_POINTS: a UE2 SpriteEmitter sizes X and
// Y independently unless UniformSize is set, and 474 of the sprite emitters on
// bound classes rely on that -- el_wind_strike_fl's streaks are 8 x 80 uu, i.e.
// 8 cm wide and 80 cm long. Square points cannot express that shape at all.
const VERT = `
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec3 iColor;
attribute float iAlpha;
attribute float iRot;
attribute vec2 iCell;
varying vec3 vColor; varying float vAlpha; varying vec2 vUv; varying vec2 vCell;
void main() {
  vColor = iColor; vAlpha = iAlpha; vCell = iCell; vUv = position.xy + 0.5;
  float s = sin(iRot), c = cos(iRot);
  vec2 corner = vec2(position.x * c - position.y * s,
                     position.x * s + position.y * c) * iSize;
  // billboard: the modelView basis vectors are the camera's right/up in the
  // group's local space, so the quad always faces the viewer
  vec3 right = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
  vec3 up    = vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]);
  vec3 p = iPos + right * corner.x + up * corner.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = `
uniform sampler2D uMap; uniform vec2 uCellSize; uniform float uModulate;
varying vec3 vColor; varying float vAlpha; varying vec2 vUv; varying vec2 vCell;
void main() {
  vec3 tex = texture2D(uMap, (vCell + vUv) * uCellSize).rgb;
  // umodel exports every LineageEffectsTextures PNG as RGB with NO alpha
  // channel and the art is glow-on-black, so luminance IS the coverage.
  float cover = max(max(tex.r, tex.g), tex.b);
  if (uModulate > 0.5) { gl_FragColor = vec4(mix(vec3(1.0), tex * vColor, vAlpha), 1.0); return; }
  gl_FragColor = vec4(tex * vColor * vAlpha, cover * vAlpha);
}`;

class Emitter {
  constructor(def, index, scene) {
    this.d = def;
    this.scene = scene;
    // AutomaticInitialSpawning (default true; `au:0` means the retail data
    // turned it OFF, which 3586 of 3709 emitters do) decides only whether the
    // pool is FILLED AT ONCE at t=0. Either way the emitter then trickles
    // particles in at InitialParticlesPerSecond -- which is the whole point of
    // that field being authored on 3612 emitters. Spawning everything instantly
    // instead stacks every particle on one spot and the effect collapses into a
    // single glint, which is what this looked like before.
    this.initialBurst = def.au !== 0;
    this.respawn = def.rs !== 0;                    // RespawnDeadParticles
    this.max = Math.min(def.n || 16, 200);          // MaxParticles (capped for the browser)
    this.pps = def.pps || 0;
    this.emitted = 0;                               // total ever spawned
    this.stopped = false;                           // projectile arrived: stop emitting
    this.life = def.l || [1, 1];
    this.spawnAcc = 0;
    this.spawned = 0;
    this.time = 0;
    // longest a particle can live, used to retire the whole instance
    this.maxLife = this.life[1] + (def.dl ? def.dl[1] : 0);

    const n = this.max;
    const g = new THREE.InstancedBufferGeometry();
    // unit quad centred on the origin; the vertex shader billboards it
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.instanceCount = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n * 2);
    this.alpha = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.cell = new Float32Array(n * 2);
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.pos, 3));
    g.setAttribute('iColor', new THREE.InstancedBufferAttribute(this.col, 3));
    g.setAttribute('iSize', new THREE.InstancedBufferAttribute(this.size, 2));
    g.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(this.alpha, 1));
    g.setAttribute('iRot', new THREE.InstancedBufferAttribute(this.rot, 1));
    g.setAttribute('iCell', new THREE.InstancedBufferAttribute(this.cell, 2));

    const sub = def.u || [1, 1];
    const modulated = def.d === DS_MODULATED || def.d === DS_DARKEN;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture(index.tex[def.t]) },
        uCellSize: { value: new THREE.Vector2(1 / sub[0], 1 / sub[1]) },
        uModulate: { value: modulated ? 1 : 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: modulated ? THREE.MultiplyBlending : THREE.AdditiveBlending,
    });
    this.points = new THREE.Mesh(g, mat);
    this.points.frustumCulled = false;
    this.points.userData.skillFx = { source: 'skillvfx.json' };

    // particle state (plain arrays; these never leave the CPU)
    this.p = [];
    for (let i = 0; i < n; i++) {
      this.p.push({ alive: false, age: 0, life: 1, delay: 0,
                    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
                    sx: 1, sy: 1, rot: 0, spin: 0, cu: 0, cv: 0 });
    }
  }

  _emit(p) {
    const d = this.d;
    p.alive = true;
    p.age = 0;
    p.life = rand(this.life) || 1;
    p.delay = d.dl ? rand(d.dl) : 0;

    // StartLocation: box (StartLocationRange) or sphere (SphereRadiusRange),
    // plus the constant StartLocationOffset. Shape ordinal from
    // EParticleStartLocationShape (Engine.u): 0 Box, 1 Sphere, 2 Polar, 3 All.
    let ox = 0, oy = 0, oz = 0;
    if (d.sh === 1 && d.sr) {
      const r = rand(d.sr);
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      ox = r * Math.sin(ph) * Math.cos(th);
      oy = r * Math.sin(ph) * Math.sin(th);
      oz = r * Math.cos(ph);
    } else if (d.sl) {
      ox = rand(d.sl[0]); oy = rand(d.sl[1]); oz = rand(d.sl[2]);
    }
    if (d.so) { ox += d.so[0]; oy += d.so[1]; oz += d.so[2]; }
    // UE (x,y,z) -> three (x,z,-y)
    p.x = ox * UU; p.y = oz * UU; p.z = -oy * UU;

    if (d.v) {
      p.vx = rand(d.v[0]) * UU; p.vy = rand(d.v[2]) * UU; p.vz = -rand(d.v[1]) * UU;
    } else { p.vx = p.vy = p.vz = 0; }

    // StartSizeRange X (and Y when UniformSize is not set) in UE units
    const sx = d.z ? rand(d.z) : 1;
    p.sx = sx * UU;
    p.sy = (d.zy ? rand(d.zy) : sx) * UU;
    p.rot = d.sp ? Math.random() * Math.PI * 2 : 0;
    p.spin = d.sp ? (Math.random() * 2 - 1) * Math.PI : 0;

    const sub = d.u || [1, 1];
    if (d.ru || sub[0] * sub[1] > 1) {
      const cellIdx = Math.floor(Math.random() * sub[0] * sub[1]);
      p.cu = cellIdx % sub[0];
      p.cv = Math.floor(cellIdx / sub[0]);
    } else { p.cu = p.cv = 0; }
  }

  /** Colour at normalised age t, straight from the retail ColorScale ramp
   *  (only when UseColorScale was set) times ColorMultiplierRange. */
  _color(t, out) {
    const d = this.d;
    let r = 1, g = 1, b = 1, a = 1;
    if (d.r) {
      let u = d.rr ? (t * d.rr) % 1 : t;          // ColorScaleRepeats
      const ramp = d.r;
      let i = 0;
      while (i < ramp.length - 1 && ramp[i + 1][0] < u) i++;
      const s0 = ramp[i], s1 = ramp[Math.min(i + 1, ramp.length - 1)];
      const span = s1[0] - s0[0];
      const f = span > 0 ? Math.min(1, Math.max(0, (u - s0[0]) / span)) : 0;
      const c0 = s0[1], c1 = s1[1];
      r = lerp((c0 >> 16 & 255), (c1 >> 16 & 255), f) / 255;
      g = lerp((c0 >> 8 & 255), (c1 >> 8 & 255), f) / 255;
      b = lerp((c0 & 255), (c1 & 255), f) / 255;
      a = lerp(s0[2], s1[2], f) / 255;
    }
    if (d.m) { r *= d.m[0]; g *= d.m[1]; b *= d.m[2]; }
    out[0] = r; out[1] = g; out[2] = b;
    return a;
  }

  /** Opacity x FadeIn/FadeOut envelope, all decoded values. */
  _alpha(t) {
    const d = this.d;
    let a = d.o != null ? d.o : 1;
    if (d.fi != null && d.fi > 0 && t < d.fi) a *= t / d.fi;
    if (d.fo != null && d.fo < 1 && t > d.fo) a *= Math.max(0, (1 - t) / (1 - d.fo));
    return a;
  }

  update(dt) {
    this.time += dt;
    const d = this.d;

    // spawn. `budget` is how many more particles this emitter may ever emit:
    // with RespawnDeadParticles off it stops for good after MaxParticles.
    const budget = () => (this.respawn ? Infinity : this.max - this.emitted);
    const take = (p) => { this._emit(p); this.emitted++; };
    if (!this.stopped) {
      if (this.initialBurst && this.time === dt) {          // first frame only
        for (const p of this.p) { if (budget() <= 0) break; if (!p.alive) take(p); }
      }
      if (this.pps > 0) {
        this.spawnAcc += dt * this.pps;
        while (this.spawnAcc >= 1 && budget() > 0) {
          this.spawnAcc -= 1;
          const p = this.p.find(q => !q.alive);
          if (!p) break;
          take(p);
        }
      }
    }

    const c = [0, 0, 0];
    let live = 0;
    for (let i = 0; i < this.p.length; i++) {
      const p = this.p[i];
      if (!p.alive) { this.alpha[i] = 0; continue; }
      p.age += dt;
      if (p.age < p.delay) { this.alpha[i] = 0; live++; continue; }
      const t = (p.age - p.delay) / p.life;
      if (t >= 1) {
        p.alive = false;
        this.alpha[i] = 0;
        continue;
      }
      live++;
      if (d.a) {                                   // Acceleration (UE axes)
        p.vx += d.a[0] * UU * dt;
        p.vy += d.a[2] * UU * dt;
        p.vz += -d.a[1] * UU * dt;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.spin * dt;

      const rampAlpha = this._color(t, c);
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
      this.size[i * 2] = p.sx; this.size[i * 2 + 1] = p.sy;
      this.alpha[i] = this._alpha(t) * rampAlpha;
      this.rot[i] = p.rot;
      this.cell[i * 2] = p.cu; this.cell[i * 2 + 1] = p.cv;
    }

    const g = this.points.geometry;
    for (const a of ['iPos', 'iColor', 'iSize', 'iAlpha', 'iRot', 'iCell']) {
      g.getAttribute(a).needsUpdate = true;
    }
    // finished once nothing is alive and nothing more may be emitted
    const mayEmit = !this.stopped && (this.respawn || this.emitted < this.max);
    return live > 0 || mayEmit;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

// --------------------------------------------------------------------------
// one spawned effect class, anchored to a caster / target / travelling point
// --------------------------------------------------------------------------

class Instance {
  constructor(fx, index, scene, anchor, action) {
    this.group = new THREE.Group();
    this.anchor = anchor;                 // {pos(): Vector3, scale?: number}
    this.action = action || {};
    this.emitters = fx.e.map(def => new Emitter(def, index, scene));
    for (const e of this.emitters) this.group.add(e.points);
    this.done = false;
    scene.add(this.group);
    this.scene = scene;
    this._place();
  }

  _place() {
    const p = this.anchor.pos();
    if (!p) return;
    const a = this.action;
    // An UE Actor's Location is the CENTRE of its collision cylinder, but the
    // client's entity/character groups sit at the FEET. Every offset below is
    // measured from that centre, so lift to it first.
    const half = (this.anchor.half || 0.85);
    this.group.position.set(p.x, p.y + half, p.z);
    if (a.o) {
      // bRelativeToCylinder defaults TRUE — it is serialised only as false, on
      // exactly the 30 actions carrying large world-unit offsets — so a plain
      // offset is a FRACTION of the collision half-height. That is why the
      // commonest offset in the whole table, (0, 0, -1) on 201 cast auras,
      // means "one half-height down from centre" = exactly at the feet.
      const worldUnits = (a.g || 0) & 32;
      const tmp = new THREE.Vector3();
      if (worldUnits) ueToThree(a.o, tmp);
      else tmp.set(a.o[0] * half, a.o[2] * half, -a.o[1] * half);
      this.group.position.add(tmp);
    }
  }

  update(dt) {
    this._place();
    let alive = false;
    for (const e of this.emitters) if (e.update(dt)) alive = true;
    if (!alive) this.done = true;
    return !this.done;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const e of this.emitters) e.dispose();
  }
}

// --------------------------------------------------------------------------
// the player
// --------------------------------------------------------------------------

export class SkillVfx {
  constructor(scene) {
    this.scene = scene;
    this.live = [];
    this.pending = [];          // [{at, fn}] delayed phases (flight time, SpawnDelay)
    this.last = performance.now();
    vfxIndex();
  }

  /** Does the retail data bind this skill at all? */
  has(skillId) {
    return !!(_index && _index.skill[String(skillId)]);
  }

  /** Spawn one phase. anchors: {caster, target} each {pos(): Vector3|null}. */
  _phase(entry, key, anchors, delay = 0) {
    const acts = entry[key];
    if (!acts) return;
    for (const a of acts) {
      const fx = _index.fx[a.f];
      if (!fx || !fx.e.length) continue;             // nothing drawable: draw nothing
      const onTarget = (a.g || 0) & 1;
      const anchor = onTarget ? anchors.target : anchors.caster;
      if (!anchor || !anchor.pos()) continue;
      const wait = delay + (a.d || 0);               // + SkillAction SpawnDelay
      const make = () => this.live.push(new Instance(fx, _index, this.scene, anchor, a));
      if (wait > 0) this.pending.push({ at: performance.now() + wait * 1000, fn: make });
      else make();
    }
  }

  /** Cast start (gateway skillCast): the CastingActions phase, on the caster. */
  cast(skillId, anchors) {
    const e = _index && _index.skill[String(skillId)];
    if (!e) return false;
    this._phase(e, 'c', anchors);
    this._phase(e, 'h', anchors);
    return true;
  }

  /** Launch (gateway skillLaunch): ShotActions now, ExplosionActions after
   *  FlyingTime. A shot action that is NOT bSpawnOnTarget on a skill with a
   *  FlyingTime is the travelling projectile — it is lerped caster -> target
   *  over exactly that many seconds. */
  launch(skillId, anchors) {
    const e = _index && _index.skill[String(skillId)];
    if (!e) return false;
    const fly = e.f || 0;
    const shots = e.s || [];
    for (const a of shots) {
      const fx = _index.fx[a.f];
      if (!fx || !fx.e.length) continue;
      const onTarget = (a.g || 0) & 1;
      if (!onTarget && fly > 0 && anchors.caster.pos() && anchors.target.pos()) {
        const from = anchors.caster.pos().clone(); from.y += 1.0;
        const to = anchors.target.pos().clone(); to.y += 1.0;
        const t0 = performance.now();
        const cur = from.clone();
        const moving = { pos: () => cur };
        const inst = new Instance(fx, _index, this.scene, moving, a);
        inst.travel = () => {
          const t = Math.min(1, (performance.now() - t0) / (fly * 1000));
          cur.lerpVectors(from, to, t);
          // on arrival the trail stops emitting; the particles already in the
          // air keep living out their LifetimeRange, as they do in retail
          if (t >= 1) for (const e of inst.emitters) e.stopped = true;
          return t < 1;
        };
        this.live.push(inst);
      } else {
        const anchor = onTarget ? anchors.target : anchors.caster;
        if (!anchor || !anchor.pos()) continue;
        const wait = a.d || 0;
        const make = () => this.live.push(
          new Instance(fx, _index, this.scene, anchor, a));
        if (wait > 0) this.pending.push({ at: performance.now() + wait * 1000, fn: make });
        else make();
      }
    }
    this._phase(e, 'x', anchors, fly);
    return true;
  }

  update() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (now >= this.pending[i].at) { this.pending[i].fn(); this.pending.splice(i, 1); }
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      const inst = this.live[i];
      if (inst.travel) inst.travel();
      if (!inst.update(dt)) { inst.dispose(); this.live.splice(i, 1); }
    }
  }

  clear() {
    for (const i of this.live) i.dispose();
    this.live.length = 0;
    this.pending.length = 0;
  }
}
