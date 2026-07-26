// Character: glTF load, animation state machine (idle/walk/run), and
// point-click / WASD locomotion over the terrain.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { L2_TO_M } from './coords.js';

const CHAR_HEIGHT = 1.75;      // meters — fallback normalization (~1.7 charcreate)
const WALK_SPEED = 1.6;        // m/s
const RUN_SPEED = 4.2;         // m/s
const RUN_THRESHOLD = 6;       // click farther than this => run anim
const TURN_RATE = 10;          // rad/s toward heading
const ARRIVE_DIST = 0.15;

export class Character {
  constructor() {
    this.group = new THREE.Group();   // world transform (feet at group origin)
    this.model = null;
    this.mixer = null;
    this.actions = {};                // name -> AnimationAction
    this.current = null;
    this.target = null;               // THREE.Vector3 | null
    this.moveAnim = 'walk';
    this.keys = new Set();
    this.speed = 0;                   // current planar speed (for verification)
  }

  // nativeHeight: true height in L2 world units (frozen M3 manifest
  // contract). When present it is authoritative (exact scale, no guard);
  // when absent, the legacy 1.75 m guarded normalization applies.
  async load(url, nativeHeight = null) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;

    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    if (size.y > 0.001) {
      if (nativeHeight) {
        root.scale.setScalar((nativeHeight * L2_TO_M) / size.y);
      } else {
        const k = CHAR_HEIGHT / size.y;
        if (k < 0.5 || k > 2.5) root.scale.setScalar(k);
      }
    }
    const box2 = new THREE.Box3().setFromObject(root);
    const center = box2.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box2.min.y;
    this.heightM = box2.getSize(new THREE.Vector3()).y;   // final world height

    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });

    this.model = root;
    this.group.add(root);
    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of gltf.animations) {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    this.play('idle');
    return this;
  }

  play(name, fade = 0.25) {
    const next = this.actions[name] || this.actions.idle;
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = next;
  }

  // One-shot emote (socialAction broadcast): play the clip and hold it
  // against the per-frame idle fallback for its own duration; real
  // movement still cancels it, as it should.
  emote(name) {
    const clip = this.actions[name];
    if (!clip) return;
    this.play(name, 0.15);
    this.emoteUntil = performance.now() + clip.getClip().duration * 1000;
  }

  setTarget(point) {
    this.target = point.clone();
    const d = this._planarDist(this.target);
    this.moveAnim = d > RUN_THRESHOLD ? 'run' : 'walk';
  }

  clearTarget() { this.target = null; }

  _planarDist(p) {
    const dx = p.x - this.group.position.x;
    const dz = p.z - this.group.position.z;
    return Math.hypot(dx, dz);
  }

  // moveDir: normalized THREE.Vector3 in world XZ (from WASD), or null
  update(dt, terrain, moveDir = null) {
    if (!this.mixer) return;
    let vx = 0, vz = 0, running = false, moving = false;

    if (moveDir && moveDir.lengthSq() > 0) {
      // WASD overrides click target
      this.target = null;
      vx = moveDir.x * RUN_SPEED; vz = moveDir.z * RUN_SPEED;
      running = true; moving = true;
    } else if (this.target) {
      const d = this._planarDist(this.target);
      if (d <= ARRIVE_DIST) {
        this.target = null;
      } else {
        const speed = this.moveAnim === 'run' ? RUN_SPEED : WALK_SPEED;
        const step = Math.min(speed * dt, d);
        vx = (this.target.x - this.group.position.x) / d * (step / dt);
        vz = (this.target.z - this.group.position.z) / d * (step / dt);
        running = this.moveAnim === 'run';
        moving = true;
      }
    }

    if (moving) {
      const pos = this.group.position;
      pos.x += vx * dt;
      pos.z += vz * dt;
      pos.y = terrain.heightAtWorld(pos.x, pos.z, pos.y);
      // smooth turn toward heading
      const heading = Math.atan2(vx, vz);
      let dy = heading - this.group.rotation.y;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      const maxTurn = TURN_RATE * dt;
      this.group.rotation.y += Math.abs(dy) < maxTurn ? dy : Math.sign(dy) * maxTurn;
      this.play(running ? 'run' : 'walk');
      this.speed = Math.hypot(vx, vz);
    } else if (performance.now() >= (this.emoteUntil || 0)) {
      this.play(this.sitting ? 'sit' : 'idle');
      this.speed = 0;
    } else {
      this.speed = 0;   // emoting: held by emote(), not re-idled
    }

    this.mixer.update(dt);
  }
}
