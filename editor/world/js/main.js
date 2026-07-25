// L2Vzla walkable-world demo (M1 + M2 online mode) — main glue.

import * as THREE from 'three';
import { Terrain } from './terrain.js';
import { Character } from './character.js';
import { FollowCamera } from './camera.js';
import { l2ToThree, threeToL2, l2HeadingToThreeYaw } from './coords.js';
import { NetClient, gatewayUrl, deviceId } from './net.js';
import { EntityManager } from './entities.js';
import { ChatBox } from './chat.js';
import { CombatUI, bindProjection } from './combat.js';
import { SkillBar, SkillFx } from './skills.js';
import { Inventory } from './inventory.js';
import { skillMeta, skillInfo, sysMsgMeta, renderSysMsg } from './gamedata.js';
import { CharSheet } from './charsheet.js';
import { Hotbar } from './hotbar.js';

const canvas = document.getElementById('view');
const statusEl = document.getElementById('status');
const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const scenePicker = document.getElementById('scene-picker');
const charPicker = document.getElementById('char-picker');
const onlineToggle = document.getElementById('online-toggle');

// --- renderer / scene ----------------------------------------------------

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();

// sky: gradient dome (zenith -> horizon), fog matched to the horizon band
const SKY_ZENITH = new THREE.Color(0x33415e);
const SKY_HORIZON = new THREE.Color(0x93a5bd);
scene.fog = new THREE.Fog(SKY_HORIZON.getHex(), 60, 420);

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1500, 24, 12),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: SKY_ZENITH },
      uHorizon: { value: SKY_HORIZON },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uZenith; uniform vec3 uHorizon;
      varying vec3 vDir;
      void main() {
        float t = smoothstep(-0.05, 0.45, vDir.y);
        gl_FragColor = vec4(mix(uHorizon, uZenith, t), 1.0);
      }`,
  }),
);
scene.add(sky);

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000);   // retail-L2 narrow FOV
const followCam = new FollowCamera(camera, canvas);

// lighting rig consistent with the charcreate look (neutral base carried
// by hemisphere/ambient, warm key), scaled up for outdoors
scene.add(new THREE.AmbientLight(0xcfd4de, 0.55));
scene.add(new THREE.HemisphereLight(0xbcc8e0, 0x40382e, 0.85));

const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -45;
sun.shadow.camera.right = sun.shadow.camera.top = 45;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 400;
sun.shadow.bias = -0.0005;
const SUN_DIR = new THREE.Vector3(0.5, 1.0, 0.35).normalize();
scene.add(sun, sun.target);

// M5 interior (dungeon) rendering mode: dark warm ambience, no sky, no
// sun; a warm point light travels with the player (torch feel)
const ambient = scene.children.find(o => o.isAmbientLight);
const hemi = scene.children.find(o => o.isHemisphereLight);
const OUTDOOR = {
  fog: scene.fog.clone(),
  ambient: { color: ambient.color.getHex(), intensity: ambient.intensity },
  hemi: { sky: hemi.color.getHex(), ground: hemi.groundColor.getHex(), intensity: hemi.intensity },
  sun: sun.intensity,
};
const torch = new THREE.PointLight(0xffb070, 0, 60, 1.3);
scene.add(torch);

function applyInteriorMode(interior) {
  sky.visible = !interior;
  sun.intensity = interior ? 0 : OUTDOOR.sun;
  sun.castShadow = !interior;
  torch.intensity = interior ? 3.2 : 0;
  if (interior) {
    scene.fog = new THREE.Fog(0x0a0806, 6, 220);
    ambient.color.setHex(0x6a5138); ambient.intensity = 1.15;
    hemi.color.setHex(0x5a4630); hemi.groundColor.setHex(0x1a140e); hemi.intensity = 1.7;
  } else {
    scene.fog = OUTDOOR.fog.clone();
    ambient.color.setHex(OUTDOOR.ambient.color); ambient.intensity = OUTDOOR.ambient.intensity;
    hemi.color.setHex(OUTDOOR.hemi.sky); hemi.groundColor.setHex(OUTDOOR.hemi.ground);
    hemi.intensity = OUTDOOR.hemi.intensity;
  }
}

// --- state -----------------------------------------------------------------

let terrain = null;
let character = null;
let manifest = [];
let availableScenes = [];
let currentTile = null;
const keys = new Set();
const clock = new THREE.Clock();

// prop draw distance (meters); instanced prop clusters beyond this hide.
// '?propDist=N' overrides; 0 = unlimited.
const PROP_DRAW_DIST = Number(new URLSearchParams(location.search).get('propDist') ?? 300);
let propDistTimer = 0;

// --- M2 online state --------------------------------------------------------

const net = new NetClient();
const entities = new EntityManager(scene, manifest);
let online = false;
let selfId = null;          // server object id of our own character
let selfName = '';
let npcNamesPromise = null; // lazy /gamedata/npcname.json fetch

const chat = new ChatBox(
  document.getElementById('chat'),
  document.getElementById('chat-log'),
  document.getElementById('chat-input'),
  {
    onSend: ({ channel = 0, text, target }) => {
      if (!text) return;
      if (online && net.send('say', { channel, text, ...(target ? { target } : {}) })) return;
      chat.addSystem('not connected — message not sent');
    },
  },
);

// --- M3 combat ---------------------------------------------------------------

const combat = new CombatUI();
bindProjection(camera, canvas);

// head position (for HP bars / damage floats) of an entity, or null
const _headPos = new THREE.Vector3();
function entityHeadPos(id) {
  const e = entities.getEntity(id);
  if (!e) return null;
  _headPos.copy(e.group.position);
  _headPos.y += (e.heightM || 1.75) * 1.1;
  return _headPos;
}

function clickEntity(id) {
  const e = entities.getEntity(id);
  if (!e) return;
  if (e.dead) {
    // M4 loot UX: click a corpse -> loot op (F key does the same)
    if (online) net.send(LOOT_OP, { id });
    return;
  }
  if (combat.targetId === id) {
    // already targeted: second click attacks
    if (online) net.send('attack', { id });
  } else {
    combat.setTarget(id, e.name || `#${id}`);
    if (online) net.send('target', { id });
  }
}

document.getElementById('respawn-btn').addEventListener('click', () => {
  console.log('respawn requested (no respawn op in the M3 bridge contract yet)');
  chat.addSystem('respawn: not supported by the gateway yet (no op in contract)');
});

// --- M4 skills & items ---------------------------------------------------------

// loot UX: clicking a corpse sends Action (the `target` op) — in L2,
// Action on a corpse/drop walks there and picks it up. No separate op
// exists in the bridge contract (confirmed in gateway/src/bridge.js).
const LOOT_OP = 'target';

const skillFx = new SkillFx(scene);
const skillBar = new SkillBar(
  document.getElementById('skill-bar'),
  document.getElementById('cast-bar'),
  document.getElementById('cast-fill'),
  document.getElementById('cast-name'),
  {
    onCast: (skillId) => {
      if (!online) return false;
      net.send('useSkill', {
        skillId,
        ...(combat.targetId != null ? { targetId: combat.targetId } : {}),
      });
    },
  },
);
const inventory = new Inventory(
  document.getElementById('inventory-panel'),
  document.getElementById('inventory-grid'),
  document.getElementById('loot-toasts'),
  { onUse: (objectId) => { if (online) net.send('useItem', { objectId }); } },
);

// --- M5: char sheet, hotbar, settings ----------------------------------------

let charSheetData = null;
const sheetPanel = new CharSheet(
  document.getElementById('charsheet-panel'),
  {
    getSelf: () => combat.self,
    getSheet: () => charSheetData,
    getEquipped: () => [...inventory.items.values()].filter(it => it.equipped),
  },
);
net.on('charSheet', (msg) => {
  charSheetData = msg;
  if (document.getElementById('charsheet-panel').classList.contains('visible')) {
    sheetPanel.render();
  }
});

const hotbar = new Hotbar(document.getElementById('hotbar'), {
  getCharName: () => selfName || 'default',
  onTrigger: ({ type, id }) => {
    if (!online) return;
    if (type === 'skill') skillBar.castSkill(id);
    else net.send('useItem', { objectId: id });
  },
});
skillBar.onAssign = (data) => hotbar.assignFirstFree(data);
inventory.onAssign = (data) => hotbar.assignFirstFree(data);

// settings / account panel
const settingsPanel = document.getElementById('settings-panel');
settingsPanel.querySelector('.inv-close').addEventListener('click', () => {
  settingsPanel.classList.remove('visible');
});
document.getElementById('settings-btn').addEventListener('click', () => {
  document.getElementById('deviceid-text').textContent = deviceId();
  settingsPanel.classList.toggle('visible');
});
document.getElementById('deviceid-copy').addEventListener('click', async (e) => {
  const id = deviceId();
  try {
    await navigator.clipboard.writeText(id);
    e.target.textContent = 'Copied!';
  } catch {
    e.target.textContent = id.slice(0, 8) + '…';
  }
  setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
});

net.on('skillList', (msg) => skillBar.populate(msg.skills || []));
net.on('itemList', (msg) => inventory.setItems(msg.items || []));
net.on('invUpdate', (msg) => inventory.applyUpdate(msg.updated || []));
net.on('skillCast', (msg) => {
  entities.skillFlash(msg.casterId);
  if (msg.casterId === selfId) {
    skillMeta().then(meta => {
      const info = skillInfo(meta, msg.skillId);
      skillBar.startCastBar(msg.skillId, msg.level, msg.hitTime, info.name);
    });
  }
});
net.on('skillLaunch', (msg) => {
  skillBar.finishCast(msg.skillId);
  entities.skillFlash(msg.casterId);
  const pos = entityHeadPos(msg.targetId);
  if (pos) {
    const hue = (msg.skillId * 47 % 360) / 360;
    skillFx.flash(pos, new THREE.Color().setHSL(hue, 0.8, 0.6).getHex());
  }
});

// L2 world tile name for absolute L2 coords: tiles span 32768 units,
// name = (20 + x/32768)_(18 + y/32768) (validated against tile-map.json,
// e.g. 17_24 -> origin [-98304, 196608]).
function tileNameFor(l2x, l2y) {
  return `${20 + Math.floor(l2x / 32768)}_${18 + Math.floor(l2y / 32768)}`;
}

function npcNames() {
  if (!npcNamesPromise) {
    npcNamesPromise = fetch('/gamedata/npcname.json')
      .then(r => r.json())
      .catch(() => ({}));
  }
  return npcNamesPromise;
}

function setOnline(on) {
  online = on;
  if (on) {
    chat.addSystem(`connecting to ${gatewayUrl()}…`);
    setStatus('online: connecting…');
    net.connect();
  } else {
    net.disconnect();
    entities.clear();
    combat.clear();
    skillBar.clear();
    inventory.clear();
    skillFx.clear();
    hotbar.clear();
    sheetPanel.clear();
    charSheetData = null;
    selfId = null;
    selfName = '';
    chat.addSystem('offline mode (solo)');
    setStatus('solo');
  }
}

net.on('open', () => {
  setStatus('online: logging in…');
  chat.addSystem('connected, logging in…');
});
net.on('close', () => {
  if (!online) return;
  setStatus('online: disconnected');
  chat.addSystem('connection lost');
  entities.clear();
  selfId = null;
});
net.on('error', () => {
  chat.addSystem(`cannot reach gateway (${net.url}) — is it running?`);
  setStatus('online: gateway unreachable');
});
net.on('auth_ok', (msg) => {
  const chars = msg.chars || [];
  chat.addSystem(`logged in (${chars.length} character${chars.length === 1 ? '' : 's'})`);
  setStatus('online: entering world…');
  const slot = chars.length ? (chars[0].slot ?? 0) : 0;
  net.send('enterChar', { slot });
});
net.on('enterWorld', async (msg) => {
  const c = msg.char || {};
  selfId = c.id ?? selfId;
  selfName = c.name || selfName;
  const tile = tileNameFor(c.x || 0, c.y || 0);
  if (availableScenes.includes(tile) && tile !== currentTile) {
    scenePicker.value = tile;
    await loadScene(tile);
  }
  if (character && terrain) {
    l2ToThree(c.x || 0, c.y || 0, c.z || 0, character.group.position);
    // indoors the walkable floor is a prop above the heightmap; the
    // server z (geodata) is authoritative there — take the max
    character.group.position.y = Math.max(
      terrain.heightAtWorld(character.group.position.x, character.group.position.z),
      (c.z || 0) * 0.01);
    character.group.rotation.y = l2HeadingToThreeYaw(c.heading);
    character.clearTarget();
  }
  setStatus(`online: ${selfName} @ ${currentTile}`);
  chat.addSystem(`entered world as ${selfName} (${currentTile})`);
  hotbar.load();
});
net.on('addPlayer', (msg) => {
  // contract ambiguity: server may also announce our own char via addPlayer
  if (selfName && msg.name === selfName) { selfId = msg.id; return; }
  entities.addPlayer(msg, terrain);
});
net.on('addNpc', (msg) => {
  entities.addNpc(msg, terrain);
  // name enrichment: fill placeholders from gamedata once loaded
  if (!msg.name) {
    npcNames().then(map => {
      if (map[String(msg.npcId)]) entities.setNpcName(msg.id, map[String(msg.npcId)]);
    });
  }
});
net.on('move', (msg) => {
  if (msg.id === selfId && character) {
    // Self-reconcile policy (WASD is strictly cosmetic, no ops are sent):
    // - while a click-walk target is active, the server broadcast is a
    //   walk order -> adopt it as our target (server-adjusted destination)
    // - if the server position disagrees by > 5 m (teleport/enterWorld),
    //   snap to it
    // - otherwise (ValidateLocation drift from cosmetic WASD) ignore it
    const p = l2ToThree(msg.tx || 0, msg.ty || 0, msg.tz || 0);
    const d = p.distanceTo(character.group.position);
    if (character.target) character.setTarget(p);
    else if (d > 5) {
      character.group.position.copy(p);
      character.clearTarget();
    }
    return;
  }
  entities.move(msg);
});
net.on('remove', (msg) => {
  if (combat.targetId === msg.id) combat.clearTarget();
  entities.remove(msg.id);
});
net.on('chat', (msg) => chat.addChat(msg.from ?? '?', msg.channel, msg.text ?? '', msg.target));
net.on('sysMsg', (msg) => {
  sysMsgMeta().then(meta =>
    chat.addSysMsg(renderSysMsg(meta, msg.id, msg.params || []), msg.id, msg.params || []));
});

// --- M3 combat ops ------------------------------------------------------------
net.on('target_ok', (msg) => {
  const e = entities.getEntity(msg.id);
  combat.setTarget(msg.id, (e && e.name) || `#${msg.id}`);
});
net.on('status', (msg) => combat.updateStatus(msg.id, msg.hp, msg.maxHp));
net.on('selfStatus', (msg) => combat.updateSelf(msg));
net.on('attack', (msg) => {
  entities.attackFlash(msg.id);
  // damage float over the victim (self hits are unknowable: no self id in M2)
  const pos = entityHeadPos(msg.targetId);
  if (pos) combat.damage(pos, msg);
});
net.on('die', (msg) => {
  entities.die(msg.id);
  combat.markDead(msg.id);
});
net.on('revive', (msg) => {
  entities.revive(msg.id);
  combat.markRevived(msg.id);
});

onlineToggle.addEventListener('change', () => setOnline(onlineToggle.checked));

// verification hook
window.__world = {
  scene, camera, renderer,
  get terrain() { return terrain; },
  get character() { return character; },
  net: {
    get connected() { return net.connected; },
    get online() { return online; },
    get selfId() { return selfId; },
    get url() { return net.url; },
    get log() { return net.log; },
  },
  entities,
  chat,
  combat,
  skillBar,
  inventory,
  hotbar,
  get charSheet() { return charSheetData; },
  followCam,   // exposed for verification/camera staging
  // verification helper: world position -> screen px
  project(v) {
    const ndc = v.clone().project(camera);
    return {
      x: (ndc.x + 1) / 2 * canvas.clientWidth,
      y: (-ndc.y + 1) / 2 * canvas.clientHeight,
      behind: ndc.z > 1,
    };
  },
  // verification helper: same as a terrain click, minus the raycast
  walkTo(v) {
    if (!character) return;
    character.setTarget(v);
    if (online) net.send('moveTo', threeToL2(v));
  },
  ready: false,
};

function setStatus(msg) { statusEl.textContent = msg; }
function setLoading(msg) { loadingText.textContent = msg; }

// --- loading ---------------------------------------------------------------

async function loadScene(tile) {
  setLoading(`loading scene ${tile}…`);
  loadingEl.classList.remove('hidden');

  if (terrain) { scene.remove(terrain.group); terrain = null; }

  const baseUrl = `/scenes/${encodeURIComponent(tile)}/`;
  const def = await (await fetch(baseUrl + 'scene.json')).json();
  const t = new Terrain(def, baseUrl);
  await t.load();
  terrain = t;
  scene.add(t.group);
  currentTile = tile;
  applyInteriorMode(!!t.interior);

  if (character) {
    let c;
    if (t.interior && t.spawnL2) {
      // dungeons: spawn inside the densest prop cluster, not tile center
      c = l2ToThree(t.spawnL2[0], t.spawnL2[1], 0);
    } else {
      c = t.center();
    }
    c.y = t.heightAtWorld(c.x, c.z);
    character.group.position.copy(c);
    character.clearTarget();
  }
  sun.position.copy(SUN_DIR).multiplyScalar(150).add(character ? character.group.position : t.center());
  setStatus(`scene: ${tile} (${def.gridSize}x${def.gridSize})`);
  loadingEl.classList.add('hidden');
}

async function loadCharacter(id) {
  setLoading(`loading ${id}…`);
  loadingEl.classList.remove('hidden');

  const entry = manifest.find(m => m.id === id) || manifest[0];
  const url = `/characters/${entry.gltf}`;
  const old = character;
  const ch = new Character();
  await ch.load(url, entry.nativeHeight || null);

  if (old) {
    ch.group.position.copy(old.group.position);
    ch.group.rotation.y = old.group.rotation.y;
    scene.remove(old.group);
  } else if (terrain) {
    const c = terrain.center();
    c.y = terrain.heightAtWorld(c.x, c.z);
    ch.group.position.copy(c);
  }
  character = ch;
  scene.add(ch.group);
  // camera parameters are character-relative (true L2 scale)
  followCam.setScale(ch.heightM || 1.75);
  camera.near = Math.max(0.02, (ch.heightM || 1.75) * 0.1);
  camera.updateProjectionMatrix();
  sun.position.copy(SUN_DIR).multiplyScalar(150).add(ch.group.position);
  sun.target.position.copy(ch.group.position);

  setStatus(`character: ${id}`);
  loadingEl.classList.add('hidden');
  window.__world.ready = true;
}

// --- input ------------------------------------------------------------------

// left-click = walk here (raycast onto terrain). Right/middle drag is the
// camera, handled inside FollowCamera.
let downPos = null;
canvas.addEventListener('pointerdown', e => {
  if (e.button === 0) downPos = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', e => {
  if (e.button !== 0 || !downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > 5 || !terrain || !character) return;

  const ndc = new THREE.Vector2(
    (e.clientX / canvas.clientWidth) * 2 - 1,
    -(e.clientY / canvas.clientHeight) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);

  // M3: entity picking first (target/attack), terrain walk otherwise.
  // Raycast against entity meshes; fall back to a screen-space nearest
  // pick (skinned meshes raycast against bind pose, small monsters are
  // hard to hit) — L2 has generous click boxes anyway.
  if (online && entities.entities.size) {
    const groups = [...entities.entities.values()].map(en => en.group);
    const hitE = ray.intersectObjects(groups, true)[0];
    if (hitE) {
      let o = hitE.object;
      while (o && o.userData.entityId == null) o = o.parent;
      if (o) { clickEntity(o.userData.entityId); return; }
    }
    let best = null, bestD = 40;   // px pick radius
    const v = new THREE.Vector3();
    for (const [id, en] of entities.entities) {
      if (en.dead) continue;
      v.copy(en.group.position);
      v.y += en.kind === 'npc' ? 0.6 : 1.0;
      v.project(camera);
      if (v.z > 1) continue;
      const px = (v.x + 1) / 2 * canvas.clientWidth;
      const py = (-v.y + 1) / 2 * canvas.clientHeight;
      const d = Math.hypot(px - e.clientX, py - e.clientY);
      if (d < bestD) { bestD = d; best = id; }
    }
    if (best != null) { clickEntity(best); return; }
  }

  const hit = terrain.mesh ? ray.intersectObject(terrain.mesh, false)[0] : null;
  if (hit) {
    character.setTarget(hit.point);
    if (online) net.send('moveTo', threeToL2(hit.point));
  }
});

window.addEventListener('keydown', e => {
  if (chat.isTyping) return;   // chat input handles its own keys
  if (e.code === 'Enter') {
    if (online) { chat.open(); e.preventDefault(); }
    return;
  }
  if (e.code === 'F1') {
    // attack current target (L2-style)
    if (online && combat.targetId != null) {
      const t = entities.getEntity(combat.targetId);
      if (t && !t.dead) net.send('attack', { id: combat.targetId });
    }
    e.preventDefault();
    return;
  }
  if (e.code === 'KeyF') {
    // loot current target corpse
    if (online && combat.targetId != null) {
      const t = entities.getEntity(combat.targetId);
      if (t && t.dead) net.send(LOOT_OP, { id: combat.targetId });
    }
    return;
  }
  if (e.code === 'KeyI') {
    inventory.toggle();
    return;
  }
  if (/^Digit[0-9]$/.test(e.code)) {
    // number keys drive the M5 hotbar (skills AND items); the skill
    // palette above is click-to-cast
    hotbar.trigger((Number(e.code[5]) + 9) % 10);
    return;
  }
  if (e.code === 'KeyC') {
    sheetPanel.toggle();
    return;
  }
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) keys.add(e.code);
});
window.addEventListener('keyup', e => keys.delete(e.code));

function wasdDir() {
  if (!keys.size) return null;
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  if (!f && !r) return null;
  // camera-relative: forward = away from camera (followCam.yaw direction)
  const yaw = followCam.yaw;
  const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
  return fwd.multiplyScalar(f).add(right.multiplyScalar(-r)).normalize();
}

// --- main loop ----------------------------------------------------------------

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (character && terrain) {
    character.update(dt, terrain, wasdDir());
    entities.update(dt, terrain);
    combat.update(entityHeadPos);
    skillFx.update();
    // interior torch light follows the player
    if (terrain.interior) {
      torch.position.copy(character.group.position);
      torch.position.y += (character.heightM || 1.75) * 2.2;
    }
    // prop draw distance, reevaluated at 2 Hz
    propDistTimer += dt;
    if (PROP_DRAW_DIST && propDistTimer > 0.5) {
      propDistTimer = 0;
      terrain.setPropDrawDistance(PROP_DRAW_DIST, character.group.position);
    }
    // shadow frustum follows the character
    sun.position.copy(SUN_DIR).multiplyScalar(150).add(character.group.position);
    sun.target.position.copy(character.group.position);
    followCam.update(dt, character.group.position, terrain);
    sky.position.copy(camera.position);
  }
  renderer.render(scene, camera);
});

// --- boot ----------------------------------------------------------------------

(async function boot() {
  try {
    const [scenes, mf] = await Promise.all([
      fetch('/scenes').then(r => r.json()),
      fetch('/characters/manifest.json').then(r => r.json()).catch(() => ({ models: [] })),
    ]);
    manifest = mf.models || [];
    availableScenes = scenes;
    entities.manifest = manifest;

    scenePicker.innerHTML = scenes.length
      ? scenes.map(s => `<option value="${s}">${s}</option>`).join('')
      : '<option value="">(no scenes)</option>';
    charPicker.innerHTML = manifest
      .map(m => `<option value="${m.id}">${m.className} (${m.gender})</option>`).join('');

    const defaultChar = manifest.find(m => m.id === 'human_fighter_m') || manifest[0];
    if (defaultChar) charPicker.value = defaultChar.id;

    scenePicker.addEventListener('change', () => loadScene(scenePicker.value));
    charPicker.addEventListener('change', () => loadCharacter(charPicker.value));

    if (scenes.length) await loadScene(scenes[0]);
    if (defaultChar) await loadCharacter(defaultChar.id);
    if (!scenes.length) {
      setLoading('no scene packages in assets/world/ yet');
      setStatus('no scenes');
    }
  } catch (e) {
    console.error(e);
    setLoading('boot failed: ' + e.message);
  }
})();
