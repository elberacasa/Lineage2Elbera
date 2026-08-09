// Retail skill visual effects: a UE2 SpriteEmitter player.
//
// DATA: /gamedata/skillvfx.json (tools/dat/build_skillvfx.py), a join of the
// decoded Skill.usk binding table with the LineageEffect.u emitter definitions.
// Every number this module uses comes out of that file; there is no authored
// colour, size or timing anywhere below. Skills the retail data does not bind
// render NOTHING — that is deliberate (a documented gap beats a plausible guess).
//
// WHAT IS REPRODUCED
//   SpriteEmitter: camera-facing textured quads with the retail texture,
//   texture-atlas subdivision, ColorScale ramp (gated on UseColorScale),
//   ColorMultiplierRange tint, Opacity + FadeIn/FadeOut envelope, LifetimeRange,
//   StartSizeRange, the SizeScale size-over-life curve, StartLocation box/sphere
//   shape, StartVelocityRange, Acceleration, StartSpin/SpinsPerSecond, and the
//   burst-vs-stream spawn mode.  714 emitters.
//   MeshEmitter: the SAME particle with a LineageEffectsStaticmeshes static mesh
//   in place of the quad (geometry via skillmesh.js), scaled per axis by
//   StartSizeRange x SizeScale and oriented by the particle rotator.  408
//   emitters — this is the bolt of Wind Strike, the magic circles under every
//   caster, and most of what a skill actually looks like.
//
// WHAT IS NOT, AND WHY (these render nothing rather than a substitute):
//   VertMeshEmitter 13  UE2 VertMesh in LineageEffectMeshes.ukx. The asset
//                       names ARE decoded (magic2, Water01, water00, swirl,
//                       selfblaster, linetail60frm, linetail60frm_red); umodel
//                       exports them as Unreal .3d vertex-animation pairs, but
//                       no tool in this repo decodes .3d yet.
//   BeamEmitter     11  procedural beam geometry: the parameters are declared in
//                       Engine.u but the noise/branching tessellation is native.
//   (10 sprites + 5 mesh emitters have NOTHING TO DRAW IN RETAIL EITHER, and
//    the older claim here -- "10 sprites name a texture that was never staged"
//    -- was wrong. Their Texture / StaticMesh property is absent from the
//    packed stream, i.e. it equals the class default, and ParticleEmitter's
//    default Texture is "S_Emitter", the UnrealEd editor billboard. Verified
//    with tools/dat/dump_emitter_classes.py --defaults, 2026-08-09.)
//
// WHERE AN EFFECT ATTACHES (added 2026-08-09; every effect used to hang off
// the actor's collision centre and track it for life). Skill.usk's AttachOn is
// EAttachMethod and 443 of the 524 actions carry one:
//   EAM_Trail (401)  attached to the actor and follows it -- the cast auras
//   EAM_None   (79)  NOT attached: spawned once and left where it was. Every
//                    `_fl` flying class and the impact bursts are in here.
//   EAM_RH/LH  (23)  the weapon hand / the shield hand. `at_shield_slam_ca`
//                    and `at_shield_stun_ca` are the two LH cases and both
//                    are shield skills; the RH set is swords and daggers.
//   3 / 4      (22)  a named AttachBoneName / alias (e_bone, soulshot1,
//                    Bip01 R Finger1, Bone09, ...).
//
// BLENDING comes from the data and the textures, not from taste. EParticleDrawStyle
// ordinals are read from Engine.u's Enum export and its CLASS DEFAULT is
// PTDS_Translucent (3), read from ParticleEmitter's default property stream — so
// the 812 emitters that omit DrawStyle are translucent, not "regular". The
// LineageEffectsTextures art is glow sprites on a black field (fx_m_t0000 is a
// 4x4 grid, exactly the TextureUSubdivisions/VSubdivisions the data states), so
// PTDS_Regular/AlphaBlend/Translucent/Brighten all draw additively; only
// PTDS_Modulated and PTDS_Darken differ.
//
// COVERAGE per texture is sourced, not assumed: 33 of the 127 sprite textures (and
// 10 of the 80 mesh textures) are exported by umodel as RGBA, and on several of
// them — fx_m_t0054, fx_m_t0035, fx_m_t0071, fx_m_t0099 — the RGB is bright
// everywhere and the SHAPE lives entirely in the alpha channel (0.0% of pixels
// have a dark RGB, 60-90% have alpha < 8). Luminance-as-coverage paints those as
// solid rectangles. So the shader uses alpha where the PNG has one (`texa` in the
// index, from the file's IHDR colour type) and luminance where it does not.
//
// UNITS: the tables are in UE units (1 uu = 1 cm) with Z up; the scene is metres
// with Y up. Conversion is coords.js's L2_TO_M and the same (x, z, -y) axis map.

import * as THREE from 'three';
import { L2_TO_M } from './coords.js';
import { meshIndex, meshParts } from './skillmesh.js';

const UU = L2_TO_M;                    // 0.01 — UE units -> metres
const TAU = Math.PI * 2;               // spin fields are in REVOLUTIONS

// EParticleDrawStyle (Engine.u Enum export, ordinals 0..6):
// Regular, AlphaBlend, Modulated, Translucent, AlphaModulate…, Darken, Brighten
const DS_MODULATED = 2, DS_DARKEN = 5;

// Reusable scratch objects for the mesh path (no per-particle allocation).
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);

// EAttachMethod, ordinals straight out of Engine.u's Enum export -- and that
// Enum's OUTER is the Class export of SkillAction_LocateEffect itself, the
// very class whose AttachOn ByteProperty uses it, so the association is read,
// not inferred from a property name. 0 is the class default (the class's
// default-property stream authors only bRelativeToCylinder=true).
const EAM_NONE = 0, EAM_RH = 1, EAM_LH = 2;
const EAM_BONE = 3, EAM_ALIAS = 4, EAM_TRAIL = 5;

// EAM_RH / EAM_LH -> the pawn's RightHandBone / LeftHandBone. The names are
// NOT invented here: they are the sockets js/equipment.js already hangs a
// weapon on, decoded from engine.dll's APawn::GetRHandBoneName /
// GetLHandBoneName and present on all 14 shipped character glTFs.
// EAM_RF / EAM_LF (6, 7) are deliberately absent: no action in the whole
// 524-action table uses them, so there is nothing to check a foot-bone name
// against and a guess would be worse than the fallback.
const HAND_SOCKET = { [EAM_RH]: 'Weapon_R_Bone', [EAM_LH]: 'Weapon_L_Bone' };

let _index = null;                     // the parsed skillvfx.json
let _indexPromise = null;
const _texCache = new Map();

/** Skill.usk FlyingTime in seconds, 0 when the skill has none. Exported for
 *  js/gamesound.js, whose explosion sound lands with the projectile. */
export function flyingTime(skillId) {
  const e = _index && _index.skill[String(skillId)];
  return (e && e.f) || 0;
}

/** The Object3D an anchor's position belongs to, so a bone can be found under
 *  it. `anchor.node(name)` is the supported path; when a caller does not
 *  supply one we fall back to an IDENTITY search: js/skills.js's entityPos()
 *  returns `group.position` itself, the same Vector3 instance the entity
 *  holds, so `g.position === pos` identifies the actor exactly (no distance
 *  test, no ambiguity). Returns null when the actor cannot be found, and the
 *  caller then keeps the un-attached placement rather than inventing one. */
function anchorNode(anchor, name) {
  if (!name) return null;
  if (typeof anchor.node === 'function') return anchor.node(name) || null;
  const w = typeof window !== 'undefined' && window.__world;
  if (!w) return null;
  const p = anchor.pos();
  if (!p) return null;
  const roots = [];
  if (w.character && w.character.group) roots.push(w.character.group);
  const em = w.entities && w.entities.entities;
  if (em && typeof em.values === 'function') {
    for (const e of em.values()) if (e && e.group) roots.push(e.group);
  }
  for (const g of roots) {
    if (g.position === p) return g.getObjectByName(name) || null;
  }
  return null;
}

export function vfxIndex() {
  if (!_indexPromise) {
    _indexPromise = Promise.all([
      fetch('/gamedata/skillvfx.json').then(r => (r.ok ? r.json() : null)),
      meshIndex(),                     // geometry for the MeshEmitter path
    ]).then(([j]) => { _index = j; return j; })
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
uniform float uHasAlpha;
varying vec3 vColor; varying float vAlpha; varying vec2 vUv; varying vec2 vCell;
void main() {
  vec4 tex = texture2D(uMap, (vCell + vUv) * uCellSize);
  // Coverage: the alpha channel when umodel's PNG export has one, otherwise the
  // luminance — the RGB-only atlases are glow-on-black. uHasAlpha comes from the
  // file's IHDR colour type via the index, so it is read, not guessed.
  float cover = mix(max(max(tex.r, tex.g), tex.b), tex.a, uHasAlpha);
  if (uModulate > 0.5) {
    gl_FragColor = vec4(mix(vec3(1.0), tex.rgb * vColor, vAlpha), 1.0);
    return;
  }
  // AdditiveBlending is (SRC_ALPHA, ONE), so the contribution is rgb * a.
  // Opacity must therefore appear ONCE, in the alpha term only -- multiplying
  // it into rgb as well squared it and dimmed every emitter that authored an
  // Opacity below 1 (813 of them) by that value a second time.
  gl_FragColor = vec4(tex.rgb * vColor, cover * vAlpha);
}`;

// ---- MeshEmitter: the same particle, drawn as a static mesh ---------------
// Instanced copies of one LineageEffectsStaticmeshes submesh. Per instance:
// position, a per-axis scale (StartSizeRange x SizeScale, in UE axis order
// permuted to three's) and the particle rotator as a quaternion.
const MESH_VERT = `
attribute vec3 iPos;
attribute vec3 iScale;
attribute vec4 iQuat;
attribute vec3 iColor;
attribute float iAlpha;
varying vec3 vColor; varying float vAlpha; varying vec2 vUv;
vec3 qrot(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
void main() {
  vColor = iColor; vAlpha = iAlpha; vUv = uv;
  vec3 p = qrot(iQuat, position * iScale) + iPos;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const MESH_FRAG = `
uniform sampler2D uMap; uniform float uModulate; uniform float uHasAlpha;
varying vec3 vColor; varying float vAlpha; varying vec2 vUv;
void main() {
  // The sprite path's texture cache leaves three's default flipY = true, so the
  // psk UVs (emitted unchanged by the builder, as the character pipeline does)
  // are sampled with V flipped back here rather than duplicating every texture.
  vec4 tex = texture2D(uMap, vec2(vUv.x, 1.0 - vUv.y));
  float cover = mix(max(max(tex.r, tex.g), tex.b), tex.a, uHasAlpha);
  if (uModulate > 0.5) {
    gl_FragColor = vec4(mix(vec3(1.0), tex.rgb * vColor, vAlpha), 1.0);
    return;
  }
  // AdditiveBlending is (SRC_ALPHA, ONE), so the contribution is rgb * a.
  // Opacity must therefore appear ONCE, in the alpha term only -- multiplying
  // it into rgb as well squared it and dimmed every emitter that authored an
  // Opacity below 1 (813 of them) by that value a second time.
  gl_FragColor = vec4(tex.rgb * vColor, cover * vAlpha);
}`;

// Shared UE2 ParticleEmitter simulation: spawn mode, LifetimeRange,
// StartLocation shape, StartVelocityRange + Acceleration, StartSizeRange x the
// SizeScale curve, the particle rotator, the ColorScale ramp and the fade
// envelope. Every one of those is a ParticleEmitter field (Engine.u), so a
// SpriteEmitter and a MeshEmitter run EXACTLY this simulation and differ only in
// what they draw — which is why the two subclasses below carry no physics.
class Particles {
  constructor(def) {
    this.d = def;
    // AutomaticInitialSpawning (class default true; `au:0` means the retail data
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
    this.time = 0;
    this.objects = [];                              // THREE objects to add to the group
    // longest a particle can live, used to retire the whole instance
    this.maxLife = this.life[1] + (def.dl ? def.dl[1] : 0);

    // particle state (plain arrays; these never leave the CPU)
    this.p = [];
    for (let i = 0; i < this.max; i++) {
      this.p.push({ alive: false, age: 0, life: 1, delay: 0,
                    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
                    sx: 1, sy: 1, sz: 1, cu: 0, cv: 0,
                    r0: [0, 0, 0], rs: [0, 0, 0] });
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

    // StartSizeRange. On a sprite it is a size in UE units (X, and Y when
    // UniformSize is off); on a mesh it is a per-axis SCALE, so the subclass
    // decides the unit factor. Z only ever matters for a mesh.
    const k = this.sizeUnit;
    const sx = d.z ? rand(d.z) : 1;
    p.sx = sx * k;
    p.sy = (d.zy ? rand(d.zy) : sx) * k;
    p.sz = (d.zz ? rand(d.zz) : sx) * k;

    // The particle rotator. StartSpinRange / SpinsPerSecondRange are in
    // REVOLUTIONS and revolutions/second (max 5.0 across the whole table, with
    // 0.25 / 0.75 quarter-turn stops that only read as revolutions).
    // SpinCCWorCW is a per-axis probability, class default (0.5, 0.5, 0.5) —
    // i.e. a coin flip — and is applied here as the chance of REVERSING the
    // authored direction. Which way round the engine reads 0.0 vs 1.0 is not
    // recovered; it can only mirror a spin, never change its rate.
    const cw = d.qw;
    for (let a = 0; a < 3; a++) {
      p.r0[a] = d.sp && d.q0 ? rand(d.q0[a]) : 0;
      let w = d.sp && d.qs ? rand(d.qs[a]) : 0;
      const pFlip = cw ? cw[a] : 0.5;
      if (w && Math.random() < pFlip) w = -w;
      p.rs[a] = w;
    }

    const sub = d.u || [1, 1];
    if (d.ru || sub[0] * sub[1] > 1) {
      const cellIdx = Math.floor(Math.random() * sub[0] * sub[1]);
      p.cu = cellIdx % sub[0];
      p.cv = Math.floor(cellIdx / sub[0]);
    } else { p.cu = p.cv = 0; }
  }

  /** SizeScale: the retail size-over-life curve, gated on UseSizeScale.
   *  1.0 when the emitter has none, so StartSize stands unchanged. */
  _sizeScale(t) {
    const c = this.d.zs;
    if (!c) return 1;
    const u = this.d.zr ? (t * this.d.zr) % 1 : t;   // SizeScaleRepeats
    let i = 0;
    while (i < c.length - 1 && c[i + 1][0] < u) i++;
    const s0 = c[i], s1 = c[Math.min(i + 1, c.length - 1)];
    const span = s1[0] - s0[0];
    const f = span > 0 ? Math.min(1, Math.max(0, (u - s0[0]) / span)) : 0;
    return lerp(s0[1], s1[1], f);
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

      const rampAlpha = this._color(t, c);
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
      this.alpha[i] = this._alpha(t) * rampAlpha;
      this._write(i, p, t, p.age - p.delay);
    }

    this._flush();
    // finished once nothing is alive and nothing more may be emitted
    const mayEmit = !this.stopped && (this.respawn || this.emitted < this.max);
    return live > 0 || mayEmit;
  }
}

// ---- SpriteEmitter -------------------------------------------------------

class SpriteFx extends Particles {
  constructor(def, index) {
    super(def);
    this.sizeUnit = UU;                     // StartSizeRange is in UE units here
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
        uHasAlpha: { value: (index.texa && index.texa[def.t]) ? 1 : 0 },
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
    this.objects = [this.points];
  }

  _write(i, p, t, age) {
    const s = this._sizeScale(t);
    this.size[i * 2] = p.sx * s;
    this.size[i * 2 + 1] = p.sy * s;
    // A sprite's rotator is a single screen-space roll and the data uses only
    // the X component for it (523 sprite emitters hold Y = Z = 0).
    this.rot[i] = (p.r0[0] + p.rs[0] * age) * TAU;
    this.cell[i * 2] = p.cu; this.cell[i * 2 + 1] = p.cv;
  }

  _flush() {
    const g = this.points.geometry;
    for (const a of ['iPos', 'iColor', 'iSize', 'iAlpha', 'iRot', 'iCell']) {
      g.getAttribute(a).needsUpdate = true;
    }
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

// ---- MeshEmitter ---------------------------------------------------------
//
// One instanced draw per material submesh of the static mesh. The rotator
// component -> axis map is the one thing here that is NOT the identity, and it
// was settled against the geometry rather than assumed: of the 132 emitters
// whose mesh is an unambiguous disc of revolution and whose spin is on exactly
// one component, 118 are flat in Z and spin on component X, and 10 are flat in
// X and spin on component Z — i.e. 128 of 132 spin about their own NORMAL under
//     X -> yaw   (about UE +Z)   Y -> pitch (about UE +Y)   Z -> roll (about UE +X)
// and only 8 of 132 do under the identity map. The retail anchor is the same:
// wh_heal_ca's magiccirclewhite01 is a 435 x 435 x 15 UU disc with spin on X at
// 0.07 rev/s — the slowly turning white magic circle under every healer — which
// only turns in its own plane under this map, and would tumble edge over edge
// under the identity. windknifeball00, the Wind Strike bolt (256 UU long on X),
// spins on component Z at 2 rev/s = about its own flight axis.
class MeshFx extends Particles {
  constructor(def, index) {
    super(def);
    this.sizeUnit = 1;                      // StartSizeRange is a mesh SCALE here
    const n = this.max;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    this.scale = new Float32Array(n * 3);
    this.quat = new Float32Array(n * 4);
    const parts = meshParts(index.msh ? index.msh[def.g] : null) || [];
    const modulated = def.d === DS_MODULATED || def.d === DS_DARKEN;
    for (const part of parts) {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', part.geometry.getAttribute('position'));
      g.setAttribute('uv', part.geometry.getAttribute('uv'));
      g.setIndex(part.geometry.getIndex());
      g.instanceCount = n;
      g.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.pos, 3));
      g.setAttribute('iColor', new THREE.InstancedBufferAttribute(this.col, 3));
      g.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(this.alpha, 1));
      g.setAttribute('iScale', new THREE.InstancedBufferAttribute(this.scale, 3));
      g.setAttribute('iQuat', new THREE.InstancedBufferAttribute(this.quat, 4));
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: texture(part.tex) },
          uModulate: { value: modulated ? 1 : 0 },
          uHasAlpha: { value: part.texAlpha ? 1 : 0 },
        },
        vertexShader: MESH_VERT,
        fragmentShader: MESH_FRAG,
        transparent: true,
        depthWrite: false,
        // RenderTwoSided is true on 1143 of the 1232 mesh emitters (its zero
        // value is false, per MeshEmitter's class defaults in Engine.u).
        side: def.ts ? THREE.DoubleSide : THREE.FrontSide,
        blending: modulated ? THREE.MultiplyBlending : THREE.AdditiveBlending,
      });
      const obj = new THREE.Mesh(g, mat);
      obj.frustumCulled = false;
      obj.userData.skillFx = { source: 'skillmesh.json', mesh: index.msh[def.g] };
      this.objects.push(obj);
    }
  }

  _write(i, p, t, age) {
    const s = this._sizeScale(t);
    // geometry is in three space (three.x = ue.x, three.y = ue.z, three.z = ue.y),
    // so a UE (X, Y, Z) scale is applied as (X, Z, Y).
    this.scale[i * 3] = p.sx * s;
    this.scale[i * 3 + 1] = p.sz * s;
    this.scale[i * 3 + 2] = p.sy * s;
    // rotator -> three: yaw about +Y, pitch about -Z, roll about +X, composed
    // yaw * pitch * roll as UE's FRotationMatrix does.
    _q.setFromAxisAngle(AX_Y, (p.r0[0] + p.rs[0] * age) * TAU);
    _q2.setFromAxisAngle(AX_Z, -(p.r0[1] + p.rs[1] * age) * TAU);
    _q.multiply(_q2);
    _q2.setFromAxisAngle(AX_X, (p.r0[2] + p.rs[2] * age) * TAU);
    _q.multiply(_q2);
    this.quat[i * 4] = _q.x; this.quat[i * 4 + 1] = _q.y;
    this.quat[i * 4 + 2] = _q.z; this.quat[i * 4 + 3] = _q.w;
  }

  _flush() {
    for (const o of this.objects) {
      for (const a of ['iPos', 'iColor', 'iAlpha', 'iScale', 'iQuat']) {
        o.geometry.getAttribute(a).needsUpdate = true;
      }
    }
  }

  dispose() {
    for (const o of this.objects) {
      // position/uv/index are the SHARED attributes of skillmesh.js's cached
      // geometry — every emitter drawing this mesh points at the same objects,
      // and three's geometry disposal frees the GPU buffer of every attribute
      // it still holds. Drop the references first so only the per-instance
      // attributes, which really do belong to this emitter, are released.
      o.geometry.deleteAttribute('position');
      o.geometry.deleteAttribute('uv');
      o.geometry.setIndex(null);
      o.geometry.dispose();
      o.material.dispose();
    }
  }
}

/** One packed emitter record -> the right player, or null when nothing is
 *  drawable (a mesh whose geometry index was never staged). */
function makeEmitter(def, index) {
  if (def.k === 1) {
    const fx = new MeshFx(def, index);
    return fx.objects.length ? fx : null;
  }
  return new SpriteFx(def, index);
}

// --------------------------------------------------------------------------
// one spawned effect class, anchored to a caster / target / travelling point
// --------------------------------------------------------------------------

class Instance {
  constructor(fx, index, scene, anchor, action) {
    this.group = new THREE.Group();
    this.anchor = anchor;                 // {pos(): Vector3, scale?: number}
    this.action = action || {};
    this.emitters = fx.e.map(def => makeEmitter(def, index)).filter(Boolean);
    for (const e of this.emitters) for (const o of e.objects) this.group.add(o);
    this.done = false;
    // AttachOn (EAttachMethod). Absent = 0 = EAM_None, the class default.
    this.attach = this.action.at || EAM_NONE;
    // The bone/alias node for EAM_RH/LH/BoneSpecified/AliasSpecified, resolved
    // once. null when the actor or the bone is not found -- in that case the
    // effect keeps the cylinder-centre placement, which is what every effect
    // used to get unconditionally.
    const boneName = this.attach === EAM_RH || this.attach === EAM_LH
      ? HAND_SOCKET[this.attach]
      : (this.attach === EAM_BONE || this.attach === EAM_ALIAS
         ? this.action.b : null);
    this.bone = boneName ? anchorNode(anchor, boneName) : null;
    this.boneName = boneName || null;
    scene.add(this.group);
    this.scene = scene;
    this._place();
  }

  /** Does this effect keep tracking its actor after it is spawned?
   *
   *  EAM_None means NOT attached, and the table proves the distinction is
   *  load-bearing: every `_fl` (flying) class in Skill.usk -- el_wind_strike_fl,
   *  el_flame_strike_fl, el_aqua_swirl_fl, el_twister_fl, el_prominence_fl --
   *  and the impact bursts are the actions that omit AttachOn, while the 401
   *  cast auras and target effects that clearly do follow their actor are
   *  EAM_Trail. Before this the renderer re-placed EVERYTHING every frame, so
   *  a fireball's burst slid along with a running target.
   *
   *  The one EAM_None effect that still moves is the travelling projectile,
   *  and it moves because `launch()` gives it a synthetic moving anchor of its
   *  own -- the engine drives that point, the actor does not. */
  get follows() {
    return this.attach !== EAM_NONE || !!this.travel;
  }

  _place() {
    const p = this.anchor.pos();
    if (!p) return;
    const a = this.action;
    // Attached to a bone: the bone's WORLD position replaces the whole
    // cylinder-centre construction below -- UE parents the effect to the bone,
    // so there is no half-height to add and no feet-vs-centre correction.
    if (this.bone) {
      this.bone.getWorldPosition(this.group.position);
      const rotB = this.travelYaw !== undefined ? this.travelYaw
        : (((a.g || 0) & 8) && this.anchor.yaw && this.anchor.yaw() != null
           ? this.anchor.yaw() - Math.PI / 2 : null);
      if (rotB !== null) this.group.rotation.y = rotB;
      if (a.o) {
        // bRelativeToCylinder is still the actor's cylinder even when the
        // effect hangs off a bone -- it is a property of the ACTION, and the
        // half-height is the actor's, so the same rule applies.
        const half = (this.anchor.half || 0.85);
        const tmp = new THREE.Vector3();
        if ((a.g || 0) & 32) ueToThree(a.o, tmp);
        else tmp.set(a.o[0] * half, a.o[2] * half, -a.o[1] * half);
        if (rotB !== null) tmp.applyAxisAngle(AX_Y, rotB);
        this.group.position.add(tmp);
      }
      return;
    }
    // An UE Actor's Location is the CENTRE of its collision cylinder, but the
    // client's entity/character groups sit at the FEET. Every offset below is
    // measured from that centre, so lift to it first.
    const half = (this.anchor.half || 0.85);
    this.group.position.set(p.x, p.y + half, p.z);
    // bUseCharacterRotation (flag 8): the effect is spawned in the ACTOR's
    // rotation frame, not the world's. An effect's local forward is UE +X,
    // which maps to three +X, while an actor's forward is (sin yaw, cos yaw)
    // (coords.l2HeadingToThreeYaw, 0 = +Z_three) — so the group yaw that maps
    // one onto the other is (actor yaw - pi/2). Only visible now that mesh
    // particles are real geometry: el_wind_strike_pr's windblowin00 disc is
    // held one half-height in FRONT of the caster, and without this it hangs
    // off toward world +X instead.
    const rot = this.travelYaw !== undefined ? this.travelYaw
      : (((a.g || 0) & 8) && this.anchor.yaw && this.anchor.yaw() != null
         ? this.anchor.yaw() - Math.PI / 2 : null);
    if (rot !== null) this.group.rotation.y = rot;
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
      // the offset is in the SAME frame the effect was spawned in
      if (rot !== null) tmp.applyAxisAngle(AX_Y, rot);
      this.group.position.add(tmp);
    }
  }

  update(dt) {
    if (this.follows) this._place();
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
        // The projectile actor's own rotation is native (no data field states
        // it), but the direction is not in doubt: the effect's local forward is
        // UE +X and the bolt has to point where it is going. Rotating +X onto
        // the flight vector is yaw = atan2(-dz, dx). This only became visible
        // with the mesh path — windknifeball00 is 256 UU long on X and spins
        // about that same axis, so an unrotated bolt flies sideways.
        {
          const dx = to.x - from.x, dz = to.z - from.z;
          if (dx || dz) inst.travelYaw = Math.atan2(-dz, dx);
          inst._place();
        }
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
