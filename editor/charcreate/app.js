// L2Vzla — Character Creation showcase
// three.js r160 (vendored, see vendor/VERSION)

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ================================================================
 * Built-in fallback data — used when /characters/charcreate-data.json
 * is missing (contract: {"races":[{"id","name","genders","classes":[...],
 *   "appearance":{"faces","hairStyles","hairColors":[]}}]})
 * ================================================================ */

const DEFAULT_DATA = {
  races: [
    {
      id: 'human', name: 'Human', genders: ['male', 'female'],
      classes: [
        { id: 'fighter', name: 'Human Fighter', type: 'fighter' },
        { id: 'mage', name: 'Human Mystic', type: 'mage' },
      ],
      appearance: {
        faces: ['A', 'B', 'C'],
        hairStyles: ['A', 'B', 'C', 'D', 'E', 'F'],
        hairColors: ['#2b2b2e', '#5a3a1e', '#8a5a2a', '#b8843c', '#c9c9c9', '#7a2e1e'],
      },
    },
    {
      id: 'elf', name: 'Elf', genders: ['male', 'female'],
      classes: [
        { id: 'fighter', name: 'Elven Fighter', type: 'fighter' },
        { id: 'mage', name: 'Elven Mystic', type: 'mage' },
      ],
      appearance: {
        faces: ['A', 'B', 'C'],
        hairStyles: ['A', 'B', 'C', 'D', 'E'],
        hairColors: ['#e8e4d8', '#c9c9c9', '#8a8a92', '#b8843c', '#5a3a1e', '#3a5a7a'],
      },
    },
    {
      id: 'darkelf', name: 'Dark Elf', genders: ['male', 'female'],
      classes: [
        { id: 'fighter', name: 'Dark Fighter', type: 'fighter' },
        { id: 'mage', name: 'Dark Mystic', type: 'mage' },
      ],
      appearance: {
        faces: ['A', 'B', 'C'],
        hairStyles: ['A', 'B', 'C', 'D', 'E'],
        hairColors: ['#e8e8ec', '#c9c9c9', '#8a8a92', '#2b2b2e', '#4a3a5a', '#7a2e1e'],
      },
    },
    {
      id: 'orc', name: 'Orc', genders: ['male', 'female'],
      classes: [
        { id: 'fighter', name: 'Orc Fighter', type: 'fighter' },
        { id: 'mage', name: 'Orc Mystic', type: 'mage' },
      ],
      appearance: {
        faces: ['A', 'B', 'C'],
        hairStyles: ['A', 'B', 'C', 'D'],
        hairColors: ['#2b2b2e', '#5a3a1e', '#8a5a2a', '#7a2e1e', '#c9c9c9'],
      },
    },
    {
      id: 'dwarf', name: 'Dwarf', genders: ['male', 'female'],
      classes: [
        { id: 'fighter', name: 'Dwarven Fighter', type: 'fighter' },
      ],
      appearance: {
        faces: ['A', 'B', 'C'],
        hairStyles: ['A', 'B', 'C', 'D'],
        hairColors: ['#5a3a1e', '#8a5a2a', '#b8843c', '#7a2e1e', '#c9c9c9', '#2b2b2e'],
      },
    },
  ],
};

const RACE_ICONS = { human: '⚔', elf: '❈', darkelf: '☾', orc: '⚒', dwarf: '⛏' };

/* ================================================================
 * State
 * ================================================================ */

const state = {
  data: null,          // charcreate data (server or fallback)
  manifest: { models: [] },
  race: 'human',
  gender: 'male',
  classId: 'fighter',
  face: 0,
  hairStyle: 0,
  hairColor: 0,
  name: '',
  modelEntry: null,    // manifest entry currently displayed (null => placeholder)
  usingPlaceholder: true,
  dataSource: 'defaults',
};

/* ================================================================
 * Data loading (frozen contracts, graceful degradation)
 * ================================================================ */

async function loadData() {
  // Location-independent absolute paths: both the standalone charcreate
  // server (:8082) and the world server (:8083, this app under /create/)
  // serve editor/characters/ at /characters/.
  try {
    const res = await fetch('/characters/manifest.json');
    if (res.ok) {
      const m = await res.json();
      if (m && Array.isArray(m.models)) state.manifest = m;
    }
  } catch (e) { /* empty manifest fallback already in state */ }

  try {
    const res = await fetch('/characters/charcreate-data.json');
    if (res.ok) {
      const d = await res.json();
      if (d && Array.isArray(d.races) && d.races.length) {
        state.data = d;
        state.dataSource = 'server';
        return;
      }
    }
  } catch (e) { /* fall through to defaults */ }
  state.data = DEFAULT_DATA;
}

function getRace(id) {
  return state.data.races.find(r => r.id === id) || state.data.races[0];
}

function norm(s) { return String(s || '').toLowerCase().replace(/[\s_-]/g, ''); }

/** Pick the best manifest model for a combo; null if none. */
function pickModelFor(raceId, gender, classId) {
  const models = state.manifest.models || [];
  if (!models.length) return null;
  const race = getRace(raceId);
  const cls = (race.classes || []).find(c => c.id === classId);
  const raceKey = norm(race.name), raceAlt = norm(race.id);
  const genderKey = norm(gender);
  const classKeys = cls ? [norm(cls.name), norm(cls.id), norm(cls.type)] : [];

  const mRace = m => [norm(m.race)].some(r => r === raceKey || r === raceAlt);
  const mGender = m => norm(m.gender) === genderKey;
  const mClass = m => classKeys.includes(norm(m.className));

  return models.find(m => mRace(m) && mGender(m) && mClass(m))
      || models.find(m => mRace(m) && mGender(m))
      || models.find(mRace)
      || null;
}

function pickModel() {
  return pickModelFor(state.race, state.gender, state.classId);
}

/** True when the manifest can show the exact race+gender combo. */
function comboAvailable() {
  const models = state.manifest.models || [];
  const race = getRace(state.race);
  const raceKey = norm(race.name), raceId = norm(race.id), genderKey = norm(state.gender);
  return models.some(m =>
    (norm(m.race) === raceKey || norm(m.race) === raceId) && norm(m.gender) === genderKey);
}

/* ================================================================
 * three.js scene
 * ================================================================ */

const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (e) {
  document.querySelector('#loading .loading-text').textContent =
    'WebGL is not available in this browser — the 3D preview cannot start.';
  document.querySelector('#loading .loading-ring').style.display = 'none';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b0d12, 9, 22);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
camera.position.set(0, 1.6, 4.4);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 1.6;
controls.maxDistance = 9;
controls.maxPolarAngle = Math.PI * 0.55;
controls.enablePan = false;

// --- lighting: neutral true-to-texture base + dramatic accents
// three r160 uses physical light units: spot/point intensities are candela
// (illuminance falls off with d²), ambient/hemisphere/directional are
// distance-independent. Two constraints shape this rig:
//  1. The character must read true to its textures from EVERY angle.
//  2. The exported meshes are all DoubleSide — three.js flips normals toward
//     the camera for double-sided lighting, so directional sources also hit
//     the model's far side. There the neutral key/rim dots go negative and
//     only the warm accents get through — what reads as "drama" on the front
//     becomes a cream wash on the back. Hence the brightness is carried by
//     the direction-independent ambient/hemisphere pair and the warm
//     accents are kept deliberately tiny.
scene.add(new THREE.AmbientLight(0xcfd4de, 1.25));

const hemiLight = new THREE.HemisphereLight(0xbcc8e0, 0x40382e, 0.8);
scene.add(hemiLight);

// neutral key (directional = lux, distance-independent) from camera-right
const keyDir = new THREE.DirectionalLight(0xf2f4f8, 1.6);
keyDir.position.set(3, 5, 4);
keyDir.castShadow = true;
keyDir.shadow.mapSize.set(1024, 1024);
keyDir.shadow.camera.left = keyDir.shadow.camera.bottom = -3;
keyDir.shadow.camera.right = keyDir.shadow.camera.top = 3;
scene.add(keyDir);

// cool rim from behind-left for silhouette separation
const rimLight = new THREE.DirectionalLight(0x7f9be0, 1.6);
rimLight.position.set(-4, 3.5, -4);
scene.add(rimLight);

// warm dramatic spot from above — hint only (~30 cd ≈ 1.2 lux at ~7.4m)
const keyLight = new THREE.SpotLight(0xffe8c0, 30, 30, Math.PI / 5, 0.45, 1.6);
keyLight.position.set(3.5, 6, 3);
scene.add(keyLight);

// gold bounce off the pedestal (~2.5 cd — the dais is <1m away, so the pool
// stays visible while the character only catches ~1 lux of it)
const fillLight = new THREE.PointLight(0xc9a959, 2.5, 10, 1.8);
fillLight.position.set(0, 0.4, 2.4);
scene.add(fillLight);

// --- pedestal + ground
const stage = new THREE.Group();
scene.add(stage);

{
  // stage materials are deliberately dark so the brighter character-grade
  // lighting doesn't wash out the pedestal's moody look
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x161b25, roughness: 0.85, metalness: 0.15 });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xc9a959, roughness: 0.35, metalness: 0.8,
    emissive: 0x37290c, emissiveIntensity: 0.6,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.22, 48), stoneMat);
  base.position.y = 0.11;
  base.receiveShadow = true;
  stage.add(base);

  const trim = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.025, 12, 64), trimMat);
  trim.rotation.x = Math.PI / 2;
  trim.position.y = 0.22;
  stage.add(trim);

  const dais = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.1, 48), stoneMat);
  dais.position.y = 0.27;
  dais.receiveShadow = true;
  stage.add(dais);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(14, 64),
    new THREE.MeshStandardMaterial({ color: 0x0a0c11, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // slow-drifting dust motes for atmosphere
  const moteGeo = new THREE.BufferGeometry();
  const N = 140, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 10;
    pos[i * 3 + 1] = Math.random() * 5;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 10;
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    color: 0xc9a959, size: 0.02, transparent: true, opacity: 0.5,
    depthWrite: false,
  }));
  motes.name = 'motes';
  scene.add(motes);
}

/** Turntable group: the current character model lives inside. */
const turntable = new THREE.Group();
turntable.position.y = 0.32; // on top of the dais
scene.add(turntable);

let mixer = null;           // THREE.AnimationMixer for glTF models
let currentClip = null;     // idle clip currently playing on mixer
let placeholder = null;     // placeholder rig refs
let currentModel = null;    // root object inside turntable
let lastFacingRy = 0;       // measured facing correction applied to currentModel
let userOrbiting = false;
let idleTimer = 0;
let createPulse = 0;        // confirmation animation driver

controls.addEventListener('start', () => { userOrbiting = true; });
controls.addEventListener('end', () => { userOrbiting = false; idleTimer = 0; });

/* ================================================================
 * Placeholder rig — simple humanoid from primitives
 * ================================================================ */

const RACE_BUILD = {
  human:   { h: 1.00, bulk: 1.00, skin: 0xd9a986 },
  elf:     { h: 1.04, bulk: 0.88, skin: 0xe8c39a },
  darkelf: { h: 1.03, bulk: 0.90, skin: 0x8a93b8 },
  orc:     { h: 1.06, bulk: 1.28, skin: 0x7a8a5a },
  dwarf:   { h: 0.78, bulk: 1.30, skin: 0xd9a986 },
};

function buildPlaceholder() {
  const b = RACE_BUILD[state.race] || RACE_BUILD.human;
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: b.skin, roughness: 0.7 });
  const clothColor = state.classId === 'mage' ? 0x3a4a7a : 0x5a4a3a;
  const cloth = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.85 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 0.6 });

  const add = (geo, mat, x, y, z, parent = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  const s = b.h, w = b.bulk;
  // torso
  add(new THREE.CapsuleGeometry(0.16 * w, 0.34 * s, 6, 14), cloth, 0, 1.05 * s, 0);
  // head
  const head = add(new THREE.SphereGeometry(0.13 * s, 20, 16), skin, 0, 1.48 * s, 0);
  // hair cap
  const hair = add(new THREE.SphereGeometry(0.135 * s, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
                   hairMat, 0, 0.015, -0.01, head);
  // eyes
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
  add(new THREE.SphereGeometry(0.016 * s, 8, 8), eyeMat, -0.045 * s, 0.01, 0.115 * s, head);
  add(new THREE.SphereGeometry(0.016 * s, 8, 8), eyeMat, 0.045 * s, 0.01, 0.115 * s, head);
  // ears (elf races get pointed ears)
  if (state.race === 'elf' || state.race === 'darkelf') {
    const earGeo = new THREE.ConeGeometry(0.02 * s, 0.14 * s, 8);
    const earL = add(earGeo, skin, -0.13 * s, 0.02, 0, head);
    earL.rotation.z = Math.PI / 2.3;
    const earR = add(earGeo, skin, 0.13 * s, 0.02, 0, head);
    earR.rotation.z = -Math.PI / 2.3;
  }
  // arms
  const armGeo = new THREE.CapsuleGeometry(0.045 * w, 0.42 * s, 6, 10);
  const armL = add(armGeo, skin, -0.24 * w, 1.08 * s, 0);
  const armR = add(armGeo, skin, 0.24 * w, 1.08 * s, 0);
  armL.rotation.z = 0.12; armR.rotation.z = -0.12;
  // legs
  const legGeo = new THREE.CapsuleGeometry(0.06 * w, 0.5 * s, 6, 10);
  add(legGeo, cloth, -0.09 * w, 0.45 * s, 0);
  add(legGeo, cloth, 0.09 * w, 0.45 * s, 0);
  // mage staff / fighter sword silhouette
  if (state.classId === 'mage') {
    const staff = add(new THREE.CylinderGeometry(0.015, 0.015, 1.1 * s, 8),
                      new THREE.MeshStandardMaterial({ color: 0x4a3a2a }), 0.32 * w, 0.85 * s, 0);
    staff.rotation.z = -0.06;
    add(new THREE.SphereGeometry(0.04, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0x6f87c9, emissive: 0x2a3a6a, emissiveIntensity: 1 }),
        0, 0.58 * s, 0, staff);
  } else {
    const sword = new THREE.Group();
    add(new THREE.BoxGeometry(0.03, 0.55 * s, 0.008),
        new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.85, roughness: 0.3 }), 0, 0.3 * s, 0, sword);
    add(new THREE.BoxGeometry(0.1, 0.02, 0.02),
        new THREE.MeshStandardMaterial({ color: 0xc9a959, metalness: 0.7, roughness: 0.4 }), 0, 0.02, 0, sword);
    sword.position.set(0.3 * w, 0.55 * s, 0);
    sword.rotation.z = -0.15;
    g.add(sword);
  }

  return { group: g, head, hair, hairMat, armL, armR, height: 1.6 * s };
}

/* ================================================================
 * Model management
 * ================================================================ */

const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const modelStatusEl = document.getElementById('model-status');

function setModelStatus(text, isPlaceholder) {
  modelStatusEl.textContent = text;
  modelStatusEl.classList.toggle('placeholder', !!isPlaceholder);
  modelStatusEl.classList.remove('hidden');
}

function disposeModelObject(root) {
  const cached = new Set(faceTexCache.values());
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material])
        .forEach(m => {
          // shared face-swap textures outlive the model — don't dispose them
          if (m.map && !cached.has(m.map)) m.map.dispose();
          m.dispose();
        });
    }
  });
}

function clearModel() {
  if (currentModel) {
    turntable.remove(currentModel);
    disposeModelObject(currentModel);
  }
  currentModel = null;
  mixer = null;
  currentClip = null;
  placeholder = null;
}

function frameModel(root) {
  // normalize scale/centering so any glTF stands on the dais
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  if (size.y > 0.001) {
    const target = 1.7;
    const k = target / size.y;
    if (k < 0.5 || k > 2.5) root.scale.setScalar(k);
  }
  const box2 = new THREE.Box3().setFromObject(root);
  const center = box2.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box2.min.y;
}

let modelLoadGen = 0;       // generation counter: stale async loads are dropped

/* ---------- measured facing ----------
 * A model's idle pose can face any direction around Y (each race/gender's
 * Wait_Hand_* sequence rotates Bip01 differently in the source data). Instead
 * of a per-model correction table, the facing is MEASURED from the model
 * itself, averaged over a full loop of the playing idle clip so no single
 * animated frame (a head-turn, a weight shift) can skew it. Two independent
 * cues:
 *
 *   1. FACE GEOMETRY: the average POSED (skinned) vertex normal of the face
 *      mesh (the `_f` part) points where the character looks. Ground truth
 *      from the mesh, robust even to damaged skeletons.
 *   2. SKELETON LANDMARKS: right axis from the L/R clavicle (or thigh/foot)
 *      positions, forward = up × right, sign confirmed against the foot→toe
 *      direction.
 *
 * On agreement the cues are averaged; on a >90° disagreement the skeleton
 * wins (the head moves independently of the body, so the face cue is the
 * noisier of the two). If neither works, the model is left unrotated. */

function findBoneByName(root, re) {
  let hit = null;
  root.traverse(o => {
    if (!hit && re.test(norm(o.name))) hit = o;
  });
  return hit;
}

/**
 * Forward from the face mesh's average posed normal, or null.
 * Samples the `_f` mesh; for skinned meshes the pose is applied via
 * applyBoneTransform (normals are sampled by offsetting along the normal).
 */
function faceMeshForward(root) {
  let mesh = null;
  root.traverse(o => {
    if (mesh || !o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some(m => partSuffix(m && m.name) === 'f') || partSuffix(o.name) === 'f') mesh = o;
  });
  if (!mesh || !mesh.geometry) return null;
  const pos = mesh.geometry.attributes.position;
  const nrm = mesh.geometry.attributes.normal;
  if (!pos || !nrm || !pos.count) return null;

  if (mesh.isSkinnedMesh && mesh.skeleton) mesh.skeleton.update();
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  const eps = Math.max(1e-6, (mesh.geometry.boundingSphere.radius || 1) * 0.01);

  const acc = new THREE.Vector3();
  const p = new THREE.Vector3(), q = new THREE.Vector3(), n = new THREE.Vector3();
  const step = Math.max(1, Math.floor(pos.count / 300));
  for (let i = 0; i < pos.count; i += step) {
    n.fromBufferAttribute(nrm, i);
    if (mesh.isSkinnedMesh && mesh.applyBoneTransform) {
      p.fromBufferAttribute(pos, i);
      q.copy(p).addScaledVector(n, eps);
      mesh.applyBoneTransform(i, p);
      mesh.applyBoneTransform(i, q);
      n.copy(q).sub(p);
    }
    acc.add(n);
  }
  acc.transformDirection(mesh.matrixWorld);
  acc.y = 0;
  if (acc.lengthSq() < 0.02) return null; // too ambiguous (|acc| <= ~0.14)
  return acc.normalize();
}

/** Forward from skeleton landmarks, or null. */
function skeletonForward(root) {
  const P = o => o.getWorldPosition(new THREE.Vector3());
  const horiz = v => { v.y = 0; return v; };

  // right axis: character's anatomical right (R minus L), shoulders preferred
  let right = null;
  const axisPairs = [
    [/lclavicle|lupperarm/, /rclavicle|rupperarm/],
    [/lthigh|lfoot/, /rthigh|rfoot/],
  ];
  for (const [lRe, rRe] of axisPairs) {
    const l = findBoneByName(root, lRe), r = findBoneByName(root, rRe);
    if (l && r) {
      right = horiz(P(r).sub(P(l)));
      if (right.lengthSq() > 1e-8) break;
    }
    right = null;
  }
  if (!right) return null;
  right.normalize();
  const fwd = new THREE.Vector3(0, 1, 0).cross(right); // up × right = forward

  // sign confirmation: foot→toe direction must agree with forward
  const toeDir = new THREE.Vector3();
  for (const side of ['l', 'r']) {
    const toe = findBoneByName(root, new RegExp(side + 'toe0$'));
    const foot = findBoneByName(root, new RegExp(side + 'foot$'));
    if (toe && foot) toeDir.add(horiz(P(toe).sub(P(foot))));
  }
  if (toeDir.lengthSq() > 1e-8 && toeDir.dot(fwd) < 0) fwd.negate();
  return fwd.normalize();
}

/**
 * Combine the two facing cues into one direction.
 * On agreement the cues are averaged; on a >90° disagreement the SKELETON
 * wins (the face cue is noisier: the head moves independently of the body,
 * e.g. idle head-turns, while the feet/clavicles track the body yaw).
 * Returns null when no cue is available.
 */
function combineCues(face, skel) {
  if (face && skel) {
    if (face.dot(skel) >= 0) return face.add(skel).normalize();
    console.warn('[facing] face geometry contradicts the skeleton — trusting the skeleton');
    return skel;
  }
  return face || skel;
}

/**
 * World-space horizontal forward direction of the posed model (single frame).
 * Returns null when no cue is available.
 */
function measureForward(root) {
  root.updateWorldMatrix(true, true);
  return combineCues(faceMeshForward(root), skeletonForward(root));
}

/**
 * Pose-robust forward: averages both cues over a FULL loop of the playing
 * idle clip, so a head-turn or weight-shift at any single frame can't skew
 * the measurement (head sways average out; the body yaw from Bip01 is
 * constant across the loop). Steps the mixer deterministically and leaves it
 * one frame past the clip start.
 */
function measureForwardLooped(root, mixer, clip) {
  const SAMPLES = 12;
  const dur = (clip && clip.duration) || 1;
  const step = Math.max(dur / SAMPLES, 1 / 240);
  const faceAcc = new THREE.Vector3(), skelAcc = new THREE.Vector3();
  let faceOk = false, skelOk = false;

  mixer.update(1 / 60); // settle off the bind pose
  for (let i = 0; i < SAMPLES; i++) {
    root.updateWorldMatrix(true, true);
    const f = faceMeshForward(root);
    if (f) { faceAcc.add(f); faceOk = true; }
    const s = skeletonForward(root);
    if (s) { skelAcc.add(s); skelOk = true; }
    mixer.update(step);
  }
  root.updateWorldMatrix(true, true);
  const face = faceOk && faceAcc.lengthSq() > 1e-6 ? faceAcc.normalize() : null;
  const skel = skelOk && skelAcc.lengthSq() > 1e-6 ? skelAcc.normalize() : null;
  return combineCues(face, skel);
}

/** Rotate root so the posed model faces +Z; returns the applied ry. */
function faceCamera(root, mixer, clip) {
  const fwd = (mixer && clip) ? measureForwardLooped(root, mixer, clip)
                              : measureForward(root);
  if (!fwd) {
    console.warn('[facing] no facing cue available — leaving model unrotated');
    return 0;
  }
  const ry = -Math.atan2(fwd.x, fwd.z);
  root.rotation.y = ry;
  root.updateWorldMatrix(true, true);
  return ry;
}

async function refreshModel() {
  const gen = ++modelLoadGen;
  clearModel();
  const entry = pickModel();
  state.modelEntry = entry;

  if (entry && entry.gltf) {
    const url = '/characters/' + entry.gltf.replace(/^\/+/, '');
    let gltf = null;
    try {
      gltf = await gltfLoader.loadAsync(url);
    } catch (e) {
      if (gen === modelLoadGen) console.warn('glTF load failed, using placeholder:', e);
    }
    if (gltf) {
      if (gen !== modelLoadGen) {
        // superseded while loading — dispose, never show (ghost-duplicate guard)
        disposeModelObject(gltf.scene);
        return;
      }
      const root = gltf.scene;
      root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });

      if (gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(root);
        const wanted = (entry.animations || []).map(norm);
        currentClip =
          gltf.animations.find(c => wanted.includes(norm(c.name))) ||
          gltf.animations.find(c => /wait|idle|stand/i.test(c.name)) ||
          gltf.animations[0];
        mixer.clipAction(currentClip).play();
      }

      // measure the model's facing averaged over a full idle loop (immune to
      // head-turns at any single frame) and rotate it toward the camera —
      // no per-model constants
      const ry = faceCamera(root, mixer, currentClip);
      frameModel(root); // after rotation, so re-centering uses the final pose
      turntable.add(root);
      currentModel = root;
      state.usingPlaceholder = false;
      lastFacingRy = ry;

      setModelStatus(entry.id || entry.gltf, false);
      applyAppearance();
      return;
    }
  }

  if (gen !== modelLoadGen) return; // superseded before reaching the fallback

  // placeholder path — app is always demo-able
  placeholder = buildPlaceholder();
  turntable.add(placeholder.group);
  currentModel = placeholder.group;
  state.usingPlaceholder = true;
  setModelStatus(
    state.manifest.models.length
      ? 'No model for this combo yet — placeholder rig'
      : 'Preview rig — game models not extracted yet',
    true);
  applyAppearance();
}

/* ================================================================
 * Appearance — texture swaps where data supports it
 * ================================================================ */

function itemLabel(item, i) {
  if (item && typeof item === 'object') return item.name || item.id || String(i + 1);
  return String(item);
}
function itemTexture(item) {
  return (item && typeof item === 'object' && item.texture) ? item.texture : null;
}
function itemColor(item) {
  if (item && typeof item === 'object') return item.color || null;
  if (typeof item === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(item)) return item;
  return null;
}

// glTF material/mesh names follow the game's naming: <Prefix>_m000_<part>
// (e.g. MFighter_m000_f, MMagic_M000_u) — _f face, _u/_l/_g/_b body parts.
// Hair materials use two-letter style suffixes: _ah/_bh (hair style A/B),
// sometimes with different casing (FMagic_M000_M00_bh). Matching is by that
// trailing part suffix, never by substrings like "face".
function partSuffix(name) {
  // strip exporter trailers like ":material_0" before reading the part suffix
  const base = String(name || '').split(':')[0];
  const m = /_([a-z0-9]+)$/i.exec(base);
  return m ? m[1].toLowerCase() : '';
}

/** True when a trailing name suffix belongs to the requested body part. */
function suffixMatchesPart(suffix, part) {
  if (!suffix) return false;
  if (suffix === part) return true;
  // hair: accept the style suffixes _ah, _bh, ... (any single letter + h)
  if (part === 'h' && /^[a-z]h$/.test(suffix)) return true;
  return false;
}

/**
 * Materials for a body part ('f' face, 'h' hair, ...). Tolerant by design:
 * a material matches when its OWN name suffix matches, or (fallback) when
 * the name of a mesh that uses it matches — so the swap keeps working if a
 * rebuilt model renames either side. Unmatched lookups are logged with the
 * names that ARE present, so a naming drift is diagnosable from the console.
 */
function materialsForPart(root, part) {
  const out = [];
  const seen = new Set();
  root.traverse(o => {
    if (!o.isMesh) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (!m || seen.has(m)) return;
      if (suffixMatchesPart(partSuffix(m.name), part) ||
          suffixMatchesPart(partSuffix(o.name), part)) {
        seen.add(m);
        out.push(m);
      }
    });
  });
  if (!out.length) {
    const mats = [], meshes = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      meshes.push(o.name);
      (Array.isArray(o.material) ? o.material : [o.material])
        .forEach(m => { if (m && !mats.includes(m.name)) mats.push(m.name); });
    });
    console.info(`[appearance] no '${part}' materials matched. materials:`,
      mats, 'meshes:', meshes);
  }
  return out;
}

/** Map a game texture ref ('MFighter.MFighter_m000_t00_f') to a served URL. */
function gameTextureUrl(ref) {
  const i = String(ref || '').indexOf('.');
  if (i <= 0 || i === String(ref).length - 1) return null;
  return '/faces/' + encodeURIComponent(ref.slice(0, i)) +
         '/' + encodeURIComponent(ref.slice(i + 1)) + '.png';
}

/** creationAssets entry for the current gender + class type (fighter fallback). */
function creationAssets(race) {
  const byGender = ((race && race.creationAssets) || {})[state.gender] || {};
  const cls = ((race && race.classes) || []).find(c => c.id === state.classId) || {};
  return byGender[cls.type] || byGender.fighter || {};
}

function appearanceOf(race) {
  const a = (race && race.appearance) || {};
  const arr = v => (Array.isArray(v) ? v : []);
  const count = v => (typeof v === 'number' ? v : arr(v).length);

  // Faces: the game's own variants from chargrp.dat (creationAssets.faceTextures),
  // in the original order — Face A/B/C matches what the real client shows.
  const faceTex = arr(creationAssets(race).faceTextures);
  const legacyFaces = arr(a.faces);
  const faces = [];
  for (let i = 0, n = faceTex.length || count(a.faces); i < n; i++) {
    faces.push({
      name: itemLabel(legacyFaces[i], i).length <= 2 ? itemLabel(legacyFaces[i], i)
                                                     : String.fromCharCode(65 + i),
      texture: faceTex[i] ? gameTextureUrl(faceTex[i]) : itemTexture(legacyFaces[i]),
    });
  }

  // Hair styles: counts come from the game data, but only the baked-in style
  // (m000 / painted hair) was exported — later styles stay disabled until the
  // pipeline exports the hair-variant meshes.
  const legacyHair = arr(a.hairStyles);
  const hairStyles = [];
  for (let i = 0, n = count(a.hairStyles); i < n; i++) {
    hairStyles.push({
      name: legacyHair.length ? itemLabel(legacyHair[i], i) : String.fromCharCode(65 + i),
      texture: itemTexture(legacyHair[i]),
      available: i === 0 || !!itemTexture(legacyHair[i]),
    });
  }

  return { faces, hairStyles, hairColors: arr(a.hairColors) };
}

// Manually loaded textures MUST use the glTF UV convention: flipY = false
// (otherwise faces render upside-down/mirrored), sRGB color space, and the
// same REPEAT wrapping the glTF samplers declare.
const faceTexCache = new Map();
function loadFaceTexture(url) {
  let t = faceTexCache.get(url);
  if (!t) {
    t = texLoader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    faceTexCache.set(url, t);
  }
  return t;
}

function applyAppearance() {
  if (!currentModel) return;
  const race = getRace(state.race);
  const app = appearanceOf(race);

  // face texture swap (glTF path only — placeholder has no UVs for it)
  const face = app.faces[state.face];
  if (face && face.texture && !state.usingPlaceholder) {
    const t = loadFaceTexture(face.texture);
    const faceMats = materialsForPart(currentModel, 'f');
    faceMats.forEach(m => { m.map = t; m.needsUpdate = true; });
    console.info(`[appearance] face ${state.face} -> ${face.texture} on`,
      faceMats.map(m => m.name));
  }

  // Hair color tint: only models with a separate hair mesh (_ah/_bh). On
  // models where hair is painted into the face texture there is nothing safe
  // to tint (tinting _f would recolor the whole face).
  const color = itemColor(app.hairColors[state.hairColor]);
  if (color) {
    if (state.usingPlaceholder && placeholder) {
      placeholder.hairMat.color.set(color);
    } else {
      const hairMats = materialsForPart(currentModel, 'h');
      hairMats.forEach(m => { if (m.color) m.color.set(color); });
      console.info(`[appearance] hair color ${color} on`,
        hairMats.map(m => m.name));
    }
  }
}

/* ================================================================
 * UI rendering
 * ================================================================ */

const $ = id => document.getElementById(id);

function renderUI() {
  const race = getRace(state.race);
  if (!race.genders.includes(state.gender)) state.gender = race.genders[0];
  const classes = race.classes || [];
  if (!classes.find(c => c.id === state.classId)) state.classId = classes[0] ? classes[0].id : '';
  const app = appearanceOf(race);
  state.face = Math.min(state.face, Math.max(0, app.faces.length - 1));
  state.hairStyle = Math.min(state.hairStyle, Math.max(0, app.hairStyles.length - 1));
  state.hairColor = Math.min(state.hairColor, Math.max(0, app.hairColors.length - 1));

  // races
  $('race-list').innerHTML = '';
  state.data.races.forEach(r => {
    const b = document.createElement('button');
    b.className = 'race-btn' + (r.id === state.race ? ' selected' : '');
    b.innerHTML = `<span class="race-icon">${RACE_ICONS[r.id] || '✦'}</span>${r.name}`;
    b.onclick = () => { state.race = r.id; renderUI(); refreshModel(); };
    $('race-list').appendChild(b);
  });

  // gender
  $('gender-list').innerHTML = '';
  race.genders.forEach(g => {
    const b = document.createElement('button');
    b.textContent = g === 'male' ? 'Male' : g === 'female' ? 'Female' : g;
    b.className = g === state.gender ? 'selected' : '';
    b.onclick = () => { state.gender = g; renderUI(); refreshModel(); };
    $('gender-list').appendChild(b);
  });

  // classes
  $('class-list').innerHTML = '';
  classes.forEach(c => {
    // a class is showable whenever pickModelFor() finds any model for the
    // combo (race-level models like elf/dwarf serve every class)
    const hasModel = !!pickModelFor(race.id, state.gender, c.id);
    const b = document.createElement('button');
    b.className = 'class-btn' + (c.id === state.classId ? ' selected' : '');
    b.innerHTML = `<span><span class="class-name">${c.name}</span><br>` +
      `<span class="class-type">${c.type || ''}</span></span>` +
      (hasModel ? '' : '<span class="soon-badge">coming soon</span>');
    b.onclick = () => { state.classId = c.id; renderUI(); refreshModel(); };
    $('class-list').appendChild(b);
  });

  // appearance groups (gracefully hidden when empty)
  const fillChips = (elId, groupId, list, key, isSwatch) => {
    const group = $(groupId);
    if (!list.length) { group.classList.add('hidden'); return; }
    group.classList.remove('hidden');
    const el = $(elId);
    el.innerHTML = '';
    list.forEach((item, i) => {
      const unavailable = !!(item && typeof item === 'object' && item.available === false);
      const b = document.createElement('button');
      b.className = 'chip' + (isSwatch ? ' swatch' : '') +
        (i === state[key] ? ' selected' : '') + (unavailable ? ' disabled' : '');
      if (isSwatch) {
        b.style.background = itemColor(item) || '#444';
        b.title = itemLabel(item, i);
      } else {
        b.textContent = itemLabel(item, i);
      }
      if (unavailable) {
        b.disabled = true;
        b.title = 'Not exported yet';
      } else {
        b.onclick = () => { state[key] = i; renderUI(); applyAppearance(); };
      }
      el.appendChild(b);
    });
  };
  fillChips('face-list', 'face-group', app.faces, 'face', false);
  fillChips('hairstyle-list', 'hairstyle-group', app.hairStyles, 'hairStyle', false);
  fillChips('haircolor-list', 'haircolor-group', app.hairColors, 'hairColor', true);

  // combo note
  const note = $('combo-note');
  if (!comboAvailable() && (state.manifest.models || []).length) {
    note.textContent = 'The 3D model for this combination is still being extracted — a preview rig is shown instead.';
    note.classList.remove('hidden');
  } else {
    note.classList.add('hidden');
  }

  validateName();
}

/* ---------- name + create ---------- */

/* Embed mode: inside the world client's iframe (/create/?embed=1) Create
 * posts the protocol fields to the parent window (it speaks createChar to
 * the gateway) instead of showing the summary overlay; the parent relays
 * {type:'cc:fail'} back for inline display. */
const EMBEDDED = window.parent !== window ||
  new URLSearchParams(location.search).has('embed');
if (EMBEDDED) document.body.classList.add('embedded');

// protocol indices: aCis Race ordinals and the base classIds per race+type
// (charcreate-data.json classes carry classId already; these cover the
// built-in DEFAULT_DATA fallback)
const RACE_INDEX = { human: 0, elf: 1, darkelf: 2, orc: 3, dwarf: 4 };
const FALLBACK_CLASS_ID = {
  human: { fighter: 0, mage: 10 },
  elf: { fighter: 18, mage: 25 },
  darkelf: { fighter: 31, mage: 38 },
  orc: { fighter: 44, mage: 49 },
  dwarf: { fighter: 53 },
};
// charCreateFail reasons (gateway README §character creation) -> inline text
const FAIL_TEXT = {
  name_already_exists: 'That name is taken.',
  incorrect_name: 'Invalid name.',
  '16_eng_chars': 'Invalid name (up to 16 characters).',
  too_many_characters: 'This account already has too many characters.',
  creation_failed: 'Creation failed — please try again.',
};

let creating = false; // a cc:create is waiting for the parent's answer
function setCreating(on) {
  creating = on;
  $('create-btn').textContent = on ? 'Creating…' : 'Create Character';
  validateName(); // recomputes the disabled state (blocks re-clicks)
}

window.addEventListener('message', (ev) => {
  if (ev.origin !== location.origin) return;
  const d = ev.data || {};
  if (d.type !== 'cc:fail') return;
  setCreating(false);
  const hint = $('name-hint');
  hint.classList.add('error');
  hint.textContent = FAIL_TEXT[d.reason] || `Creation failed (${d.reason || 'unknown'}).`;
});

const NAME_RE = /^[A-Za-z]{1,16}$/;

function validateName() {
  const input = $('name-input');
  const hint = $('name-hint');
  state.name = input.value.trim();
  const ok = NAME_RE.test(state.name);
  input.classList.toggle('invalid', state.name.length > 0 && !ok);
  hint.classList.toggle('error', state.name.length > 0 && !ok);
  hint.textContent = ok || !state.name
    ? '1–16 letters, no numbers.'
    : 'Letters only, up to 16 characters.';
  $('create-btn').disabled = !ok || creating;
  return ok;
}

$('name-input').addEventListener('input', validateName);

$('create-btn').addEventListener('click', () => {
  if (!validateName() || creating) return;
  createPulse = 1.0;             // drives the confirmation animation
  const race = getRace(state.race);
  const cls = (race.classes || []).find(c => c.id === state.classId) || {};

  if (EMBEDDED) {
    // hand the protocol fields to the parent window (world client); it
    // sends createChar and closes the overlay on charCreateOk
    const classId = typeof cls.classId === 'number'
      ? cls.classId
      : ((FALLBACK_CLASS_ID[state.race] || {})[cls.type] ?? 0);
    setCreating(true);
    window.parent.postMessage({
      type: 'cc:create',
      name: state.name,
      race: RACE_INDEX[state.race] ?? 0,
      sex: state.gender === 'female' ? 1 : 0,
      classId,
      hairStyle: state.hairStyle,
      hairColor: state.hairColor,
      face: state.face,
    }, location.origin);
    return;
  }

  const app = appearanceOf(race);

  $('summary-name').textContent = state.name;
  $('summary-sub').textContent =
    `${race.name} · ${state.gender === 'male' ? 'Male' : 'Female'} · ${cls.name || state.classId}`;
  const rows = [
    ['Class type', cls.type || '—'],
    ['Face', app.faces.length ? itemLabel(app.faces[state.face], state.face) : '—'],
    ['Hair style', app.hairStyles.length ? itemLabel(app.hairStyles[state.hairStyle], state.hairStyle) : '—'],
    ['Hair color', app.hairColors.length ? itemLabel(app.hairColors[state.hairColor], state.hairColor) : '—'],
    ['Model', state.usingPlaceholder ? 'Preview rig' : (state.modelEntry.id || state.modelEntry.gltf)],
    ['Data source', state.dataSource === 'server' ? 'server pipeline' : 'built-in defaults'],
  ];
  if (cls.baseStats) {
    Object.entries(cls.baseStats).slice(0, 4).forEach(([k, v]) => rows.push([k.toUpperCase(), v]));
  }
  $('summary-details').innerHTML =
    rows.map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`).join('');

  setTimeout(() => $('summary-overlay').classList.remove('hidden'), 650);
});

$('summary-close').addEventListener('click', () => {
  $('summary-overlay').classList.add('hidden');
  $('name-input').value = '';
  validateName();
});

/* ================================================================
 * Render loop
 * ================================================================ */

const clock = new THREE.Clock();

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) ||
      canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.elapsedTime;
  resize();

  // slow idle turntable (pauses while the user orbits)
  if (!userOrbiting) {
    idleTimer += dt;
    const speed = createPulse > 0 ? 2.2 * createPulse + 0.12 : 0.12;
    turntable.rotation.y += dt * speed * Math.min(idleTimer, 1.5);
  }

  // confirmation pulse: glow + slight camera push
  if (createPulse > 0) {
    createPulse = Math.max(0, createPulse - dt * 0.55);
    const p = Math.sin(createPulse * Math.PI);
    fillLight.intensity = 2.5 + p * 10;
    keyLight.intensity = 30 + p * 18;
    camera.position.lerp(new THREE.Vector3(0, 1.5, 3.6), dt * 1.2 * p);
  } else {
    fillLight.intensity = 2.5 + Math.sin(t * 1.3) * 0.5;
    keyLight.intensity = 30;
  }

  if (mixer) mixer.update(dt);

  // placeholder bob + arm sway
  if (placeholder) {
    const g = placeholder.group;
    g.position.y = Math.abs(Math.sin(t * 2.0)) * 0.03;
    placeholder.armL.rotation.x = Math.sin(t * 2.0) * 0.12;
    placeholder.armR.rotation.x = -Math.sin(t * 2.0) * 0.12;
    placeholder.head.rotation.y = Math.sin(t * 0.6) * 0.18;
  }

  // drifting motes
  const motes = scene.getObjectByName('motes');
  if (motes) { motes.rotation.y = t * 0.02; motes.position.y = Math.sin(t * 0.3) * 0.15; }

  controls.update();
  renderer.render(scene, camera);
}

/* ================================================================
 * Boot
 * ================================================================ */

(async function boot() {
  await loadData();
  if (!getRace(state.race)) state.race = state.data.races[0].id;
  renderUI();
  await refreshModel();
  document.getElementById('loading').classList.add('hidden');
  animate();
})();

// verification/debug handle — lets headless checks inspect state and freeze
// the view deterministically; harmless in normal use
window.__cc = {
  state,
  turntable, camera, controls,
  get model() { return currentModel; },
  get mixer() { return mixer; },
  get loadGen() { return modelLoadGen; },
  get modelId() { return state.usingPlaceholder ? null : (state.modelEntry && state.modelEntry.id); },
  get facingRy() { return lastFacingRy; },
  /** Measured world-space forward of the current model (should be ~+Z).
   *  Averaged over a full idle loop, same as the correction itself. */
  worldForward() {
    if (!currentModel || state.usingPlaceholder) return null;
    const f = (mixer && currentClip)
      ? measureForwardLooped(currentModel, mixer, currentClip)
      : measureForward(currentModel);
    return f ? { x: f.x, z: f.z } : null;
  },
  /** Deterministic verification pose: frozen turntable, camera at +Z front. */
  poseFront() {
    userOrbiting = true;
    turntable.rotation.y = 0;
    camera.position.set(0, 1.35, 3.6);
    controls.target.set(0, 1.0, 0);
    controls.update();
  },
  freeze() { userOrbiting = true; },
  unfreeze() { userOrbiting = false; },
};
