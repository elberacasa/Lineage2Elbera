// L2Vzla walkable-world demo (M1 + M2 online mode) — main glue.

import * as THREE from 'three';
import { Terrain, WATER_SCROLL } from './terrain.js';
import { NeighborTiles } from './neighbors.js';
import { Character } from './character.js';
import { FollowCamera } from './camera.js';
import { l2ToThree, threeToL2, l2HeadingToThreeYaw } from './coords.js';
import { NavGrid } from './geodata.js';
import { NetClient, gatewayUrl, deviceId } from './net.js';
import { EntityManager, pickModelId } from './entities.js';
import { ChatBox } from './chat.js';
import { CombatUI, bindProjection } from './combat.js';
import { SkillBar, SkillFx } from './skills.js';
import { InventoryWnd } from './ui/inventorywnd.js';
import { ShortcutWnd } from './ui/shortcutwnd.js';
import { skillMeta, skillInfo, itemMeta, itemInfo, sysMsgMeta, renderSysMsg, sysMsgColor, skillAnimMeta, skillAnimInfo, skillAnimLoaded, shotMeta, isShot } from './gamedata.js';
import { isBeneficialAnim } from './skillfx_anim.js';
import { audio } from './audio.js';
import { gameSound } from './gamesound.js';
import { worldAudio } from './worldaudio.js';
import { loadEquipment } from './equipment.js';
import { WorldLight } from './worldlight.js';
import { L2Window } from './ui/window.js';
import { UI_WINDOW_SOUND } from './gamesound.js';

// Window open/close sounds. Injected rather than imported: js/ui/** must not
// depend on the 3D engine (audio.js imports three, and verify_ui.js loads the
// UI modules on a page with no importmap), so main.js — which already owns
// both sides — supplies the hook.
L2Window.soundHook = (winName, i) => {
  const pair = UI_WINDOW_SOUND[winName] || UI_WINDOW_SOUND._default;
  if (pair && pair[i]) audio.play2D(pair[i], { bus: 'ui' });
};
import { CharSheet } from './charsheet.js';
import { MenuWnd, SystemMenuWnd } from './ui/menuwnd.js';
import { TargetStatusWnd } from './ui/targetstatuswnd.js';
import { NpcDialog } from './ui/npcdialog.js';
import { Skin } from './ui/skin.js';
import { Font } from './ui/font.js';
import { Layout } from './ui/layout.js';
import { StatusWnd, loadExpTable } from './ui/statuswnd.js';
import { WndMgr } from './ui/wndmgr.js';
import { SkillWnd, loadSkillTypes, skillType } from './ui/skillwnd.js';
import { ActionWnd } from './ui/actionwnd.js';
import { MinimapWnd } from './ui/minimapwnd.js';
import { QuestWnd, questCond, questStarted } from './ui/questwnd.js';
import { PartyWnd } from './ui/partywnd.js';
import { ClanWnd } from './ui/clanwnd.js';
import { AbnormalWnd } from './ui/abnormalwnd.js';
import { ShopWnd } from './ui/shopwnd.js';
import { TradeWnd } from './ui/tradewnd.js';
import { StoreWnd } from './ui/storewnd.js';
import { MultiSellWnd } from './ui/multisellwnd.js';
import { WarehouseWnd } from './ui/warehousewnd.js';
import { WeaponGate } from './weapongate.js';

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
// Client-chosen fallback direction, used only where the map supplies none
// (interiors, or a tile converted before light_extract.py ran). The real sun
// angle comes from the tile's NMovableSunLight — see worldlight.js.
const SUN_DIR = new THREE.Vector3(0.5, 1.0, 0.35).normalize();
sun.userData.dir = SUN_DIR.clone();
scene.add(sun, sun.target);
const worldLight = new WorldLight(scene, sun, scene.children.find(o => o.isAmbientLight));

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
let selfModelId = null;      // manifest id of the currently loaded self model
let availableScenes = [];
let currentTile = null;
let neighbors = null;   // NeighborTiles, created once availableScenes is known
let pendingSceneSwitch = null;   // deferred boundary crossing (see main loop)
let sceneLoading = false;        // loadScene in flight: suppresses detection
const keys = new Set();
const clock = new THREE.Clock();

// 8 surrounding tiles rendered cheap (js/neighbors.js) so the world doesn't
// end in void at the border. '?neighbors=0' disables (perf baseline/debug).
const NEIGHBORS_ENABLED = new URLSearchParams(location.search).get('neighbors') !== '0';

// Height router: the one ground-truth entry point for movement/camera code.
// Routes a three.js world (x, z) to the tile it falls in — the center tile's
// full Terrain, or the covering NeighborTile when the character has crossed
// a boundary (so walking across stays grounded before AND after the switch).
const heightRouter = {
  get geodata() { return terrain ? terrain.geodata : null; },
  get interior() { return terrain ? !!terrain.interior : false; },
  heightAtWorld(x, z, currentZ = null) {
    if (!terrain) return 0;
    const entry = neighbors && neighbors.entryAt(x, z);
    if (entry) {
      entry.ensureGeodata();   // lazy; heightmap answers until it lands
      return entry.heightAtWorld(x, z, currentZ);
    }
    return terrain.heightAtWorld(x, z, currentZ);
  },
};

// prop draw distance (meters); instanced prop clusters beyond this hide.
// '?propDist=N' overrides; 0 = unlimited.
const PROP_DRAW_DIST = Number(new URLSearchParams(location.search).get('propDist') ?? 300);

// HD texture set (pilot: tiles 17_25 / 22_22 only). '?hd=1' enables, '?hd=0'
// disables; the choice persists in localStorage. HD swaps the scene base URL
// to /scenes-hd/<tile>/ (server falls back to the LQ file when a tile has no
// HD copy), so splat maps and blending are untouched — only diffuse
// resolution changes.
const HD_KEY = 'l2vzla.hd';
const HD_PARAM = new URLSearchParams(location.search).get('hd');
if (HD_PARAM === '1' || HD_PARAM === '0') {
  try { localStorage.setItem(HD_KEY, HD_PARAM); } catch { /* ignore */ }
}
const HD_ENABLED = (() => {
  if (HD_PARAM === '1') return true;
  if (HD_PARAM === '0') return false;
  try { return localStorage.getItem(HD_KEY) === '1'; } catch { return false; }
})();
let propDistTimer = 0;

// --- M2 online state --------------------------------------------------------

const net = new NetClient();
// Character creation milestone: the browser drives createChar itself from
// an empty auth_ok, so suppress the gateway's legacy first-login auto-create
// for this session (gateway default for other clients is unchanged).
// net.js sends the login op internally on connect — inject the flag here.
// ?cc=0 opts back into the legacy auto-create (kept for the older suites).
const CC_ENABLED = new URLSearchParams(location.search).get('cc') !== '0';
if (CC_ENABLED) {
  const rawSend = net.send.bind(net);
  net.send = (op, fields = {}) =>
    rawSend(op, op === 'login' ? { noAutoCreate: true, ...fields } : fields);
}
const entities = new EntityManager(scene, manifest);
let online = false;
let selfId = null;          // server object id of our own character
let selfName = '';
let npcNamesPromise = null; // lazy /gamedata/npcname.json fetch

// --- Phase C.1: the retail player status window ------------------------------
// Built from Interface.xdat geometry + the client's own art once the skin
// has loaded (see boot()). Null until then; every call site guards.
let statusWnd = null;
let skillWnd = null;
let actionWnd = null;
let minimapWnd = null;
let questWnd = null;
let partyWnd = null;
let clanWnd = null;
let abnormalWnd = null;
let shopWnd = null;
let tradeWnd = null;
let storeWnd = null;
let multiSellWnd = null;
let warehouseWnd = null;
// M13 own-store state: sitting tracked from changeWait (the sit/stand
// toggle is server-side); storeOpen from storeState (open sits the seller,
// close leaves them SITTING — the aCis re-list quirk, gateway README M13)
let selfSitting = false;
let selfStoreOpen = false;
let menuWnd = null;
let systemMenuWnd = null;

// Dev controls have no retail equivalent, so the bar is not part of the
// retail view. But it carries the Online toggle, which is the only way into
// the game -- hiding it behind an undiscoverable key locks the user out. So:
// ` (Backquote) toggles the FULL bar, ?dev=1 forces it open, the choice
// PERSISTS across reloads, and the first-run default is a collapsed corner
// widget holding just Online + settings — the full-width strip (style.css
// #hud left:0;right:0) covered the retail StatusWnd/TargetStatusWnd docks
// at the top center. An explicit dismissal (stored '0') still hides it
// entirely. Backquote is AUTHORED-but-honest: no retail binding uses it
// (nothing in the xdat/uscript keymaps references it, checked), and it
// frees F9, which IS retail — shortcut slot 9 (F1..F12 trigger the bar's
// slots).
const hudEl = document.getElementById('hud');
const DEV_KEY = 'l2vzla.devbar';
// dev-only controls hidden in the collapsed (mini) state; the Online label
// and the settings button stay reachable
const devOnlyEls = [
  hudEl.querySelector('.brand'),
  scenePicker.parentElement,
  charPicker.parentElement,
  statusEl,
];
function setDevBar(on) {
  hudEl.classList.toggle('dev-visible', on);
  for (const el of devOnlyEls) el.style.display = on ? '' : 'none';
  try { localStorage.setItem(DEV_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}
{
  const forced = new URLSearchParams(location.search).get('dev') === '1';
  let stored = null;
  try { stored = localStorage.getItem(DEV_KEY); } catch { /* ignore */ }
  hudEl.classList.toggle('dev-visible', forced || stored !== '0');
  hudEl.style.right = 'auto';   // hug the corner, never the top-center docks
  if (!forced && stored !== '1') {
    for (const el of devOnlyEls) el.style.display = 'none';   // mini default
  }
  if (stored === null) showDevHint();
}

// The help strip is AUTHORED — no retail equivalent. Dismissible via its
// close button; the dismissal persists per browser.
{
  const helpEl = document.getElementById('help');
  let helpOff = false;
  try { helpOff = localStorage.getItem('l2vzla.helptext') === '0'; } catch { /* ignore */ }
  if (helpOff) helpEl.classList.add('hidden');
  document.getElementById('help-close').addEventListener('click', () => {
    helpEl.classList.add('hidden');
    try { localStorage.setItem('l2vzla.helptext', '0'); } catch { /* ignore */ }
  });
}

// One-time nudge so the dev-bar key is discoverable instead of tribal
// knowledge.
function showDevHint() {
  const tip = document.createElement('div');
  tip.id = 'dev-hint';
  tip.textContent = '` — show / hide the dev bar (not part of the retail UI)';
  document.body.appendChild(tip);
  setTimeout(() => tip.classList.add('fade'), 4000);
  setTimeout(() => tip.remove(), 5200);
}

// ChatWnd is constructed in boot() — its chrome needs Layout/Skin/Font
// resident first. Handlers below reference `chat` but only run afterwards.
let chat = null;
function makeChat() {
  chat = new ChatBox(
    document.getElementById('chat'),
    document.getElementById('chat-log'),
    document.getElementById('chat-input'),
    {
      onSend: ({ channel = 0, text, target, gmCommand }) => {
        // "//<cmd>" from chat.js: an aCis admin command, which travels as a
        // bypass, not as chat. The server replies with its own GM panel HTML.
        if (gmCommand) {
          if (online) net.send('bypass', { command: gmCommand });
          else chat.addSystem('GM commands need the server — tick Online.');
          return;
        }
        if (!text) return;
        // '/trade' with no message body (chat.js parses '/trade <msg>' as
        // channel 8) invites the CURRENT PLAYER target, like the retail
        // trade action — aCis TradeRequest is name-based (M12)
        if (text === '/trade') {
          const t = combat.target;
          const e = t && t.id !== selfId ? entities.getEntity(t.id) : null;
          if (online && e && e.kind === 'player' && t.name) {
            net.send('tradeRequest', { name: t.name });
          } else {
            chat.addSystem('Target a player first');
          }
          return;
        }
        if (online && net.send('say', { channel, text, ...(target ? { target } : {}) })) return;
        chat.addSystem('not connected — message not sent');
      },
    },
  );
}

// --- M3 combat ---------------------------------------------------------------

const combat = new CombatUI();
bindProjection(camera, canvas);

// head position (for HP bars / damage floats) of an entity, or null
const _headPos = new THREE.Vector3();
// Shots the server has confirmed as automatic, by ITEM id. The shortcut bar
// marks by inventory objectId, so the mapping is recomputed rather than stored:
// a stack can be split or consumed and its object ids change under us.
// Last right-hand item id seen on a charSheet. null until the first one, so
// logging in wearing a sword does not play an equip sound for gear you were
// already holding.
let lastRhand = null;
// scratch for the drop sound's world position (audio.playAt snapshots it)
const _dropSndPos = new THREE.Vector3();
const activeShotItems = new Set();
function refreshShotMarks() {
  if (!shortcutWnd) return;
  const oids = new Set();
  for (const itemId of activeShotItems) {
    for (const oid of inventory.objectIdsForItem(itemId)) oids.add(oid);
  }
  shortcutWnd.setActiveShots(oids);
}

function entityHeadPos(id) {
  // the local player is not in the EntityManager (main.js keeps it as a
  // separate Character) — resolve self the same way skills.js entityPos does
  if (id === selfId && character) {
    _headPos.copy(character.group.position);
    _headPos.y += (character.heightM || 1.75) * 1.1;
    return _headPos;
  }
  const e = entities.getEntity(id);
  if (!e) return null;
  _headPos.copy(e.group.position);
  _headPos.y += (e.heightM || 1.75) * 1.1;
  return _headPos;
}

function clickEntity(id) {
  const e = entities.getEntity(id);
  if (!e) return;
  // ground drop: a single click walks there and picks it up (Action on a
  // drop — the bridge routes target{id} to pickup server-side)
  if (e.kind === 'drop') {
    if (online) net.send(LOOT_OP, { id });
    return;
  }
  if (e.dead) {
    // M4 loot UX: click a corpse -> loot op (F key does the same)
    if (online) net.send(LOOT_OP, { id });
    return;
  }
  if (combat.targetId === id) {
    // already targeted: second click interacts — attackable targets keep
    // the combat path; non-attackable NPCs (server type != Monster, from
    // the aCis XMLs via /gamedata/npcgrp.json) open the dialog instead
    if (!online) return;
    if (e.kind === 'npc' && e.npcType && e.npcType !== 'Monster') {
      net.send('talk', { id });
    } else if (e.kind === 'player') {
      // M13: a second click on a player sends Action (the talk op) — aCis
      // Player.onAction opens the private store when the target runs one
      // (playerStore arrives), follows otherwise. Retail never attacks a
      // player without ctrl; 'attack' stays for monsters/NPCs.
      net.send('talk', { id });
    } else {
      notePlayerAction('attack');
      net.send('attack', { id });
    }
  } else {
    combat.setTarget(id, e.name || `#${id}`,
      { kind: e.kind, level: e.level ?? null, color: e.kind === 'npc' && e.level != null && combat.self
        ? (combat.self.level ?? 1) - e.level : null });
    if (online) net.send('target', { id });
  }
}

document.getElementById('respawn-btn').addEventListener('click', () => {
  // respawn{} -> RequestRestartPoint(to village). The gateway guards the
  // dead state server-side and answers with revive + selfStatus + a
  // teleport-style move op (handled in the revive/move handlers below).
  if (online) net.send('respawn', {});
});

// --- M4 skills & items ---------------------------------------------------------

// loot UX: clicking a corpse sends Action (the `target` op) — in L2,
// Action on a corpse/drop walks there and picks it up. No separate op
// exists in the bridge contract (confirmed in gateway/src/bridge.js).
const LOOT_OP = 'target';

const skillFx = new SkillFx(scene);
// Weapon-dependent skill gating (aCis weaponsAllowed; js/weapongate.js):
// grays + blocks skills whose weapon condition doesn't match the equipped
// weapon, refreshed from every itemList/invUpdate (weapon swap re-enables
// instantly) and consulted again at cast time.
const weaponGate = new WeaponGate();
function refreshWeaponGate() {
  if (!inventory) return;
  weaponGate.update([...inventory.items.values()]);
  if (skillWnd) skillWnd.setWeaponGate(weaponGate);
  if (shortcutWnd) shortcutWnd.setWeaponGate(weaponGate);
}
const skillBar = new SkillBar(
  document.getElementById('skill-bar'),
  document.getElementById('cast-bar'),
  document.getElementById('cast-fill'),
  document.getElementById('cast-name'),
  {
    onCast: (skillId) => {
      if (!online) return false;
      // weapon condition mismatch: send nothing (retail behavior — the
      // server would answer ActionFailed + sysMsg 113 S1_CANNOT_BE_USED)
      if (weaponGate.loaded && !weaponGate.allows(skillId)) return false;
      // aCis target routing (skillweapons.json targets): SELF skills cast on
      // the caster even while a mob is targeted — no targetId is sent, so
      // the bridge never re-targets for them
      const selfTarget = weaponGate.loaded && weaponGate.targetType(skillId) === 'SELF';
      let targetId = !selfTarget && combat.targetId != null ? combat.targetId : null;
      // Retail auto-targets SELF when a beneficial ONE-target skill is cast
      // with nothing targeted — without it aCis answers a bare actionFailed
      // (no sysMsg), which reads as "skills don't cast". Beneficial comes
      // from the DATA: skillweapons target routing + the skillgrp anim
      // code (skillfx_anim.isBeneficialAnim) — no per-skill list.
      if (targetId == null && selfId != null && weaponGate.loaded
          && weaponGate.targetType(skillId) === 'ONE') {
        const meta = skillAnimLoaded();
        const entry = meta && skillAnimInfo(meta, skillId,
          (skillBar.skills.get(skillId) || {}).level || 1);
        if (entry && isBeneficialAnim(entry.anim)) targetId = selfId;
      }
      notePlayerAction('cast');
      net.send('useSkill', {
        skillId,
        ...(targetId != null ? { targetId } : {}),
      });
    },
  },
);
// loot toasts (kept from the retired panel): shown on invUpdate 'add'
function lootToast(text) {
  const host = document.getElementById('loot-toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'loot-toast';
  el.textContent = text;
  host.appendChild(el);
  setTimeout(() => el.classList.add('show'), 16);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 2600);
}

let inventory = null;   // InventoryWnd, constructed in boot (needs skin/layout)
let npcDialog = null;     // NpcDialog, constructed in boot (needs skin/layout)

// --- M5: char sheet, shortcut bar, settings -----------------------------------

let charSheetData = null;
const sheetPanel = new CharSheet(
  document.getElementById('charsheet-panel'),
  {
    getSelf: () => combat.self,
    getSheet: () => charSheetData,
    getEquipped: () => [...inventory.items.values()].filter(it => it.equipped),
  },
);
net.on('npcHtml', (msg) => {
  if (npcDialog) npcDialog.showHtml(msg.html || '');
});
net.on('charSheet', (msg) => {
  charSheetData = msg;
  // aCis re-sends UserInfo on every stat change, so this is also how a haste
  // buff, a slow, or a weight penalty reaches locomotion
  if (character) character.setSpeeds(msg);
  // ...and how an equip/unequip reaches the hand: the paperdoll rides the same
  // UserInfo, so swapping a weapon in a shop updates the model with no extra op
  if (character && msg.paperdoll) {
    // UserInfo re-sends constantly, so the equip sound must fire on an actual
    // change of weapon, not on every packet.
    const rh = msg.paperdoll.rhand;
    if (rh !== lastRhand) {
      if (lastRhand !== null && rh) gameSound.equip(rh);
      lastRhand = rh;
    }
    character.setWeapon(rh);
    character.setOffhand(msg.paperdoll.lhand);  // shields, dual-wield second blade
    gameSound.setWeapon(rh);                    // impact sounds follow the weapon
  }
  if (document.getElementById('charsheet-panel').classList.contains('visible')) {
    sheetPanel.render();
  }
});

// The retail shortcut bar (replaces BOTH invented bars: the M4 palette and
// the M5 hotbar). Skills/items assign from the SkillWnd or inventory by
// drag&drop or right-click; F1..F12 (and Digit1-0 as an AUTHORED alias,
// see the keymap) trigger the current page's slots.
let shortcutWnd = null;
skillBar.onAssign = (data) => shortcutWnd && shortcutWnd.assignFirstFree(data);

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

net.on('skillList', (msg) => {
  const all = msg.skills || [];
  if (skillWnd) skillWnd.setSkills(all);
  // The shortcut bar may only hold castable skills — passives are not usable
  // (MagicSkillWnd.uc keeps them in a separate pane for exactly this reason).
  skillBar.register(all.filter(
    s => skillType(s.id, s.passive) !== 'PASSIVE' && !s.disabled));
});
net.on('itemList', async (msg) => {
  await inventory.setItems(msg.items || []);
  refreshWeaponGate();
  refreshShotMarks();   // object ids change when a stack splits or is consumed
  // aCis answers shop transactions with a FULL ItemList (no InventoryUpdate)
  if (shopWnd) shopWnd.onInvUpdate();
  if (storeWnd) storeWnd.onInvUpdate();
  if (multiSellWnd) multiSellWnd.onInvUpdate();
  if (warehouseWnd) warehouseWnd.onInvUpdate();
});
net.on('questList', (msg) => {
  if (questWnd) questWnd.setQuests(msg.quests || []);
});
// M9 party ops: full snapshot replace + in-place status + incoming invite
net.on('party', (msg) => {
  if (partyWnd) partyWnd.setMembers(msg.members || []);
});
net.on('partyMemberStatus', (msg) => {
  if (partyWnd) partyWnd.updateMember(msg);
});
net.on('partyAsk', (msg) => {
  if (partyWnd) partyWnd.showAsk(msg.from);
});
// M14 clan ops: clanInfo/clanMembers are full snapshots (queued after
// enterWorld, re-emitted on every change); clanAsk is the incoming invite.
net.on('clanInfo', (msg) => {
  if (clanWnd) clanWnd.setClan(msg);
});
net.on('clanMembers', (msg) => {
  if (clanWnd) clanWnd.setMembers(msg.members || []);
});
net.on('clanAsk', (msg) => {
  if (clanWnd) clanWnd.showAsk(msg.from, msg.clanName);
});
// Buff strip: `buffs` is a full snapshot, `buffUpdate` the packet-level
// delta — the client takes both (frozen ops, gateway landing in parallel).
// `targetBuffs` is tolerated and stored only: TargetStatusWnd.uc has NO
// buff area in Interlude (checked), so there is nothing retail to render.
// Effects with duration -1 are live toggles (gateway M10) — they drive the
// active-toggle markers in the skill window and on the shortcut bar.
function syncToggleMarks() {
  const ids = abnormalWnd ? abnormalWnd.toggleIds() : new Set();
  if (skillWnd) skillWnd.setActiveToggles(ids);
  if (shortcutWnd) shortcutWnd.setActiveToggles(ids);
}
net.on('buffs', (msg) => {
  if (abnormalWnd) abnormalWnd.setEffects(msg.effects || []);
  syncToggleMarks();
});
net.on('buffUpdate', (msg) => {
  if (abnormalWnd) abnormalWnd.applyUpdate(msg.add || [], msg.remove || []);
  syncToggleMarks();
});
net.on('targetBuffs', () => {});
net.on('skillCoolTime', (msg) => {
  for (const s of msg.skills || []) {
    // SkillCoolTime(0xc1): reuse + remaining in SECONDS (gateway M10) —
    // the sweep drains remaining/reuse, so both are converted
    const total = (s.reuse || 0) * 1000;
    const left = (s.remaining != null ? s.remaining : s.reuse || 0) * 1000;
    skillBar.setReuse(s.id, total, left);
  }
});
// Shop: the server opens the window by sending the list (merchant bypass
// flows through the dialog's 'bypass' op; nothing client-side to open)
net.on('buyList', (msg) => {
  if (shopWnd) shopWnd.openBuy(msg.items || []);
});
net.on('sellList', (msg) => {
  if (shopWnd) shopWnd.openSell(msg.items || []);
});
// M15 multisell: the merchant bypass drives it server-side (nothing
// client-side to open); multisellList opens/fills the window — a re-sent
// list replaces the content. Retail HIDES the inventory when the window
// shows (MultiSellWnd.uc:289-303); close sends nothing (no close packet).
net.on('multisellList', (msg) => {
  if (!multiSellWnd) return;
  if (inventory) inventory.toggle(false);
  multiSellWnd.openList(msg.listId, msg.items || []);
});
// M16 warehouse: the keeper's DepositP/WithdrawP bypass drives the server
// (through the dialog's 'bypass' op; nothing client-side to open) — the
// whDeposit/whWithdraw lists open the window. Retail HIDES the inventory
// when it shows (WarehouseWnd.uc:351-354). An EMPTY warehouse answers
// WithdrawP with sysMsg 282 only — no op, no window. Results arrive ONLY
// via invUpdate (server truth — failures are sysMsg lines in chat).
net.on('whDeposit', (msg) => {
  if (!warehouseWnd) return;
  if (inventory) inventory.toggle(false);
  warehouseWnd.openDeposit(msg);
});
net.on('whWithdraw', (msg) => {
  if (!warehouseWnd) return;
  if (inventory) inventory.toggle(false);
  warehouseWnd.openWithdraw(msg);
});
// M12 trade: tradeStart opens the window (and retail HIDES the inventory/
// shop windows, TradeWnd.uc:184-199); tradeOwn/tradeOther are the ONLY
// pane truth; tradeEnd closes. Refuse surfaces only as sysMsg 119 in chat.
net.on('tradeAsk', (msg) => {
  if (tradeWnd) tradeWnd.showAsk(msg.from);
});
net.on('tradeStart', (msg) => {
  if (inventory) inventory.toggle(false);
  if (shopWnd) shopWnd.hide();
  if (tradeWnd) tradeWnd.start(msg);
});
net.on('tradeOwn', (msg) => {
  if (tradeWnd) tradeWnd.addOwn(msg.items || []);
});
net.on('tradeOther', (msg) => {
  if (tradeWnd) tradeWnd.addOther(msg.items || []);
});
net.on('tradeEnd', (msg) => {
  if (tradeWnd) tradeWnd.end(msg.reason);
});
// M13 private stores: storeMsgSell/storeMsgBuy open the MANAGE views,
// playerStore opens the OBSERVER view (someone's store), storeState tracks
// my own store's lifecycle. Retail HIDES the inventory when the store
// window opens (PrivateShopWnd.uc:870-873). Results (item/adena movement)
// arrive ONLY via invUpdate — failures are sysMsg lines in chat.
net.on('storeMsgSell', (msg) => {
  if (inventory) inventory.toggle(false);
  if (storeWnd) storeWnd.openManageSell(msg);
});
net.on('storeMsgBuy', (msg) => {
  if (inventory) inventory.toggle(false);
  if (storeWnd) storeWnd.openManageBuy(msg);
});
net.on('playerStore', (msg) => {
  if (inventory) inventory.toggle(false);
  if (storeWnd) storeWnd.openObserver(msg);
});
net.on('storeState', (msg) => {
  selfStoreOpen = !!msg.open;
  // opening the store sits the seller down server-side (SetPrivateStoreList*
  // does sitDown()); closing leaves them sitting — tracked for the
  // stand-first quirk in requestStoreManage
  if (msg.open) selfSitting = true;
  if (storeWnd) storeWnd.setStoreState(msg);
});
/** M13 DECISION: the 'Private Store - Sell/Buy' actions (actionname ids
 *  10/28) do NOT ride action{actionId} -> RequestActionUse (the native aCis
 *  path works, but the manage answer then arrives unprompted); the
 *  deterministic bridge ops storeManageSell{}/storeManageBuy{} drive the
 *  same packets, and storeMsgSell/storeMsgBuy open the window either way. */
function requestStoreManage(kind) {
  const manage = () => net.send(kind === 'sell' ? 'storeManageSell' : 'storeManageBuy', {});
  // aCis quirk (gateway README M13): after a store closes the player stays
  // SITTING and canOpenPrivateStore silently refuses — stand up first
  // (action 0 is the server-side sit/stand toggle)
  if (selfSitting && !selfStoreOpen) {
    net.send('action', { actionId: 0 });
    setTimeout(manage, 600);
  } else {
    manage();
  }
}
function useAction(id) {
  if (!online) return;
  if (id === 10) { requestStoreManage('sell'); return; }
  if (id === 28) { requestStoreManage('buy'); return; }
  // retail actionId 2 (Attack, actionname.json) must NOT ride
  // RequestActionUse — aCis warns and drops it. Attack the current target
  // through the combat path instead (same op as the second click).
  if (id === 2) {
    if (combat.targetId != null) {
      notePlayerAction('attack');
      net.send('attack', { id: combat.targetId });
    } else {
      chat.addSystem('Target something first');
    }
    return;
  }
  net.send('action', { actionId: id });
}
net.on('invUpdate', async (msg) => {
  await inventory.applyUpdate(msg.updated || []);
  refreshWeaponGate();
  if (shopWnd) shopWnd.onInvUpdate();
  if (storeWnd) storeWnd.onInvUpdate();
  if (multiSellWnd) multiSellWnd.onInvUpdate();
  if (warehouseWnd) warehouseWnd.onInvUpdate();
  for (const u of msg.updated || []) {
    if (u.change === 'add' || u.change === 1) {
      itemMeta().then(meta =>
        lootToast(`Looted: ${itemInfo(meta, u.itemId).name}${u.count > 1 ? ' ×' + u.count : ''}`));
    }
  }
});
net.on('skillCast', (msg) => {
  entities.skillFlash(msg.casterId);
  const castPos = entityHeadPos(msg.casterId);
  if (castPos) gameSound.cast(msg.skillId, castPos);
  if (msg.casterId === selfId) {
    // per-cast reuse: aCis sends NO SkillCoolTime on cast — the reuse
    // delay rides inside MagicSkillUse itself (ms, gateway M10 bridge)
    if (msg.reuse > 0) skillBar.setReuse(msg.skillId, msg.reuse);
    skillMeta().then(meta => {
      const info = skillInfo(meta, msg.skillId);
      skillBar.startCastBar(msg.skillId, msg.level, msg.hitTime, info.name);
    });
  }
});
net.on('skillLaunch', (msg) => {
  skillBar.finishCast(msg.skillId);
  entities.skillFlash(msg.casterId);
  // No colour is computed here any more. This used to hash the skill id into a
  // hue (skillId * 47 % 360) — an invented value standing in for the retail
  // effect. skillvfx.js now drives the visuals from the decoded effect tables,
  // and a skill with no sourced effect renders nothing rather than a made-up
  // colour.
  const pos = entityHeadPos(msg.targetId);
  if (pos) gameSound.launch(msg.skillId, pos);
});
// Social action broadcast (gateway op socialAction{id, actionId}, decoded
// from gameclient 0x2d). Other entities flash their 'special' clip; when
// it's us, dance on the local character model ('dance' exists on all 14
// models; play() falls back to idle if a clip is ever absent).
// ExAutoSoulShot — the server confirming a shot toggle. It answers only on
// success (RequestAutoSoulShot returns silently when the item is missing or
// the player is dead/trading), so this, not the click, is the truth.
net.on('autoShotState', (msg) => {
  if (msg.enabled) activeShotItems.add(msg.itemId);
  else activeShotItems.delete(msg.itemId);
  refreshShotMarks();
  itemMeta().then(meta => {
    chat.addSystem(`${itemInfo(meta, msg.itemId).name}: `
      + (msg.enabled ? 'automatic use enabled' : 'automatic use disabled'));
  });
});
net.on('socialAction', (msg) => {
  entities.socialFlash(msg.id);
  if (msg.id === selfId && character) character.emote('dance');
});
// ChangeWaitType broadcast (gateway op changeWait{id, waitType}): sit/stand
// toggle state — waitType 0 = sitting, 1 = standing (aCis ChangeWaitType).
net.on('changeWait', (msg) => {
  if (msg.id === selfId) {
    selfSitting = msg.waitType === 0;
    if (character) character.sitting = selfSitting;
  }
  entities.setWaitType(msg.id, msg.waitType);
});
// ChangeMoveType broadcast (walk/run toggle) — authoritative for remotes.
net.on('changeMove', (msg) => entities.setMoveMode(msg.id, msg.running));
// ActionFailed (0x25) is the server's routine "no" — and it is REASON-LESS.
// During a cast it is the abort signal (PlayerCast.stop() fires
// clientActionFailed when CreatureCast.interrupt cancels the cast), so the
// casting bar cancels. It is also the ONLY answer a rejected move/attack
// gets (MoveBackwardToLocation refuses >9900-unit moves, attacks without
// line of sight never swing), so a failure that time-correlates with a
// player-initiated move/attack/cast surfaces ONE honest chat line. The
// correlation guard matters: an UNSOLICITED actionFailed arrives right
// after every enterWorld and must stay silent. Wording stays generic on
// purpose — the op carries no reason.
const ACTION_FEEDBACK_MS = 1500;   // correlation window after a player op
const ACTION_FEEDBACK_LINE = {
  move: "Can't reach that.",
  attack: 'Cannot see target.',
  cast: 'Casting failed.',
};
let lastPlayerAction = null;       // {t, kind} of the last initiated op
let lastActionFeedbackAt = 0;      // spam guard (WASD streams move orders)
function notePlayerAction(kind) {
  lastPlayerAction = { t: performance.now(), kind };
}
net.on('actionFailed', () => {
  skillBar.cancelCast();
  const now = performance.now();
  if (!lastPlayerAction || now - lastPlayerAction.t > ACTION_FEEDBACK_MS) return;
  if (now - lastActionFeedbackAt < 2000) return;
  lastActionFeedbackAt = now;
  chat.addSystem(ACTION_FEEDBACK_LINE[lastPlayerAction.kind] || "Can't do that.");
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
    closeCharCreate();
    closeCharSelect();
    entities.clear();
    combat.clear();
    skillBar.clear();
    if (inventory) inventory.toggle(false);
    if (storeWnd) storeWnd.hide();
    selfSitting = false;
    selfStoreOpen = false;
    skillFx.clear();
    if (shortcutWnd) { shortcutWnd.data = {}; shortcutWnd.render(); }
    sheetPanel.clear();
    if (statusWnd) statusWnd.clear();
    if (skillWnd) skillWnd.clear();
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
  gameSound.clear();     // entity -> creature sound bindings die with the world
  selfId = null;
  // Until this was set, `online` stayed true after a drop: the world emptied,
  // every send silently no-opped, and nothing said why. The toggle now reflects
  // reality, so a player can see the state and reconnect.
  online = false;
  if (onlineToggle) onlineToggle.checked = false;
});
net.on('error', () => {
  chat.addSystem(`cannot reach gateway (${net.url}) — is it running?`);
  setStatus('online: gateway unreachable');
});

// --- character creation overlay -------------------------------------------
// An account with no characters (auth_ok{chars:[]}) opens the charcreate
// app (/create/, served by this same world server) in a fullscreen iframe
// instead of enterChar. The iframe posts cc:create with the protocol
// fields; charCreateOk closes the overlay and the refreshed auth_ok (now
// 1 char) drives the normal enterChar path below; charCreateFail is
// relayed back into the iframe for inline display.
let ccOverlay = null;

function openCharCreate() {
  if (ccOverlay) return;
  setStatus('online: create your character…');
  chat.addSystem('no characters on this account — create one to enter');
  const el = document.createElement('div');
  el.id = 'charcreate-overlay';
  Object.assign(el.style, {
    position: 'fixed', inset: '0', zIndex: 40,
    background: 'rgba(6,7,10,.92)',   // dimmed, above every window
  });
  const frame = document.createElement('iframe');
  frame.src = '/create/?embed=1';
  Object.assign(frame.style, { width: '100%', height: '100%', border: '0' });
  el.appendChild(frame);
  document.body.appendChild(el);
  ccOverlay = el;
}

function closeCharCreate() {
  if (ccOverlay) { ccOverlay.remove(); ccOverlay = null; }
}

window.addEventListener('message', (ev) => {
  if (ev.origin !== location.origin) return;
  const d = ev.data || {};
  if (d.type !== 'cc:create' || !ccOverlay) return;
  net.send('createChar', {
    name: String(d.name || ''),
    race: d.race | 0, sex: d.sex | 0, classId: d.classId | 0,
    hairStyle: d.hairStyle | 0, hairColor: d.hairColor | 0, face: d.face | 0,
  });
});

net.on('charCreateOk', () => {
  closeCharCreate();
  chat.addSystem('character created — entering world…');
  setStatus('online: entering world…');
});
net.on('charCreateFail', (msg) => {
  chat.addSystem(`character creation failed: ${msg.reason || 'unknown'}`);
  const frame = ccOverlay && ccOverlay.querySelector('iframe');
  if (frame && frame.contentWindow) {
    frame.contentWindow.postMessage(
      { type: 'cc:fail', reason: msg.reason || 'creation_failed' }, location.origin);
  }
});

// --- character select overlay ----------------------------------------------
// A multi-char account (auth_ok with >= 2 chars) gets a retail-style char
// select: a fullscreen dimmed overlay (same inline-style pattern as the
// char-create overlay above) listing each character for click-to-enter,
// plus a "＋ Create new character" button (closes this, opens the
// char-create overlay) and a dismiss back to offline. Legacy paths are
// untouched: 1 char auto-enters, 0 chars opens char-create, and ?cc=0
// (CC_ENABLED false) always auto-enters the first char — the older suites
// depend on all three. A refreshed auth_ok during the session (after a
// successful createChar on a multi-char account) re-opens the select
// overlay with the updated list instead of auto-entering.
// Class display names come from the shipped creator data
// (/characters/charcreate-data.json, classId -> name) — no new table.
let csOverlay = null;
let csClassNamesPromise = null;   // lazy {classId: displayName} map

function csClassNames() {
  if (!csClassNamesPromise) {
    csClassNamesPromise = fetch('/characters/charcreate-data.json')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const map = {};
        for (const race of (d && d.races) || [])
          for (const c of race.classes || []) map[c.classId] = c.name;
        return map;
      })
      .catch(() => ({}));
  }
  return csClassNamesPromise;
}

function closeCharSelect() {
  if (csOverlay) { csOverlay.remove(); csOverlay = null; }
}

async function openCharSelect(chars) {
  closeCharSelect();
  setStatus('online: select a character…');
  const classNames = await csClassNames();
  if (csOverlay || !online) return;   // raced auth_ok, or went offline mid-fetch
  const el = document.createElement('div');
  el.id = 'charsel-overlay';
  Object.assign(el.style, {
    position: 'fixed', inset: '0', zIndex: 40,
    background: 'rgba(6,7,10,.92)',   // dimmed, above every window
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'system-ui, sans-serif', color: '#d8d3c3',
  });
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    minWidth: '360px', padding: '24px 28px',
    background: '#14161c', border: '1px solid #3a3f4d', borderRadius: '6px',
  });
  const title = document.createElement('div');
  title.textContent = 'Select Character';
  Object.assign(title.style, {
    fontSize: '18px', letterSpacing: '.08em', textAlign: 'center',
    color: '#c9a959', marginBottom: '16px',
  });
  panel.appendChild(title);
  for (const c of chars) {
    const row = document.createElement('button');
    row.className = 'charsel-row';
    const race = c.race || '';
    const cls = classNames[c.classId] || `Class #${c.classId}`;
    row.innerHTML =
      `<span style="font-size:15px;color:#e8e3d3"></span>` +
      `<span style="font-size:12px;color:#8b93a7;margin-left:12px"></span>`;
    row.children[0].textContent = c.name || '?';
    row.children[1].textContent = `Lv ${c.level ?? 1}  ${race} ${cls}`.trim();
    Object.assign(row.style, {
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      width: '100%', margin: '4px 0', padding: '10px 14px', cursor: 'pointer',
      background: '#1c1f27', border: '1px solid #3a3f4d', borderRadius: '4px',
    });
    row.addEventListener('click', () => {
      closeCharSelect();
      chat.addSystem(`entering world as ${c.name}…`);
      setStatus('online: entering world…');
      net.send('enterChar', { slot: c.slot ?? 0 });
    });
    panel.appendChild(row);
  }
  const mkBtn = (label) => {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, {
      display: 'block', width: '100%', margin: '10px 0 0', padding: '9px 0',
      cursor: 'pointer', background: '#232833', border: '1px solid #4a5163',
      borderRadius: '4px', color: '#d8d3c3', fontSize: '13px',
    });
    return b;
  };
  const createBtn = mkBtn('＋ Create new character');
  createBtn.id = 'charsel-create';
  createBtn.addEventListener('click', () => { closeCharSelect(); openCharCreate(); });
  const dismissBtn = mkBtn('Back (offline)');
  dismissBtn.id = 'charsel-dismiss';
  dismissBtn.addEventListener('click', () => {
    closeCharSelect();
    onlineToggle.checked = false;
    setOnline(false);
  });
  panel.appendChild(createBtn);
  panel.appendChild(dismissBtn);
  el.appendChild(panel);
  document.body.appendChild(el);
  csOverlay = el;
}

net.on('auth_ok', (msg) => {
  const chars = msg.chars || [];
  if (!chars.length) { openCharCreate(); return; }   // fresh account: create first
  closeCharCreate();   // refreshed auth_ok after a successful createChar
  chat.addSystem(`logged in (${chars.length} character${chars.length === 1 ? '' : 's'})`);
  // multi-char account (cc enabled): char-select overlay; it also re-opens
  // with the updated list when a refreshed auth_ok arrives mid-session
  // (char #2+ created from the select screen's create button)
  if (CC_ENABLED && chars.length >= 2) { openCharSelect(chars); return; }
  closeCharSelect();
  setStatus('online: entering world…');
  net.send('enterChar', { slot: chars[0].slot ?? 0 });
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
  // The boot model is always human_fighter_m: re-pick the self model for
  // the char actually entered (race/classId/sex ride enterWorld since
  // 2026-08-03) and reload when it differs. loadCharacter preserves the
  // old model's position/heading; the server-authoritative position block
  // below then re-applies both, so movement/animation continue untouched.
  // NOTE (follow-up): hairStyle/hairColor/face variants are NOT applied —
  // the Character loader has no per-appearance mesh support yet.
  if (manifest.length) {
    const wantId = pickModelId(manifest, c.race, c.classId, c.sex);
    if (wantId && wantId !== selfModelId) await loadCharacter(wantId);
  }
  if (character && terrain) {
    l2ToThree(c.x || 0, c.y || 0, c.z || 0, character.group.position);
    // server z is authoritative: the geodata layer NEAREST to it (bridges
    // keep their floor; without geodata the older max() rule applies
    const p = character.group.position;
    p.y = terrain.geodata
      ? terrain.heightAtWorld(p.x, p.z, (c.z || 0) * 0.01)
      : Math.max(terrain.heightAtWorld(p.x, p.z), (c.z || 0) * 0.01);
    character.group.rotation.y = l2HeadingToThreeYaw(c.heading);
    character.clearTarget();
    pendingGoal = null;   // server-placed spawn: no click route survives it
  }
  if (statusWnd) statusWnd.setName(selfName);
  setStatus(`online: ${selfName} @ ${currentTile}`);
  chat.addSystem(`entered world as ${selfName} (${currentTile})`);
  if (shortcutWnd) shortcutWnd.load(selfName);
});
net.on('addPlayer', (msg) => {
  // contract ambiguity: server may also announce our own char via addPlayer
  if (selfName && msg.name === selfName) { selfId = msg.id; return; }
  entities.addPlayer(msg, terrain);
});
net.on('addNpc', (msg) => {
  entities.addNpc(msg, terrain);
  // bind this entity to its creature's sound bank and warm the buffers now —
  // the first blow must not wait on a fetch
  gameSound.trackNpc(msg.id, msg.npcId);
  // name enrichment: fill placeholders from gamedata once loaded
  // Name + nameplate colour from the retail table. A row is either a bare
  // name string (the common case: default green, no title) or
  // [name, nickcolor, nick?] — server.py trims it to keep the map small.
  npcNames().then(map => {
    const row = map[String(msg.npcId)];
    if (!row) return;
    const name = Array.isArray(row) ? row[0] : row;
    const rgba = Array.isArray(row) ? row[1] : null;
    // RRGGBBAA -> #RRGGBB; the alpha is FF on every row in the table
    const color = rgba && rgba.length >= 6 ? `#${rgba.slice(0, 6).toLowerCase()}` : null;
    // Even when the server supplied a name, the colour still has to land —
    // that is what marks a raid boss.
    entities.setNpcName(msg.id, msg.name || name, color);
  });
});
// Ground drops (aCis SpawnItem/DropItem): nameplate + marker via
// entities.addDrop; clicking one sends target{id} (clickEntity), which the
// server routes to pickup. Despawn rides the shared 'remove' op.
net.on('addDrop', (msg) => {
  itemMeta().then(meta => entities.addDrop(msg, itemInfo(meta, msg.itemId).name, terrain));
  // weapongrp carries a drop_sound per item; it lands where the item lands.
  // The entity itself is created inside the async branch above, so the
  // position comes from the message rather than from a lookup that would
  // still return null here.
  if (msg.x != null) {
    gameSound.drop(msg.itemId, l2ToThree(msg.x, msg.y, msg.z, _dropSndPos));
  }
});
net.on('move', (msg) => {
  if (msg.id === selfId && character) {
    // Self-reconcile policy (click-walk and streamed WASD legs both ride
    // the moveTo op):
    // - while a walk target is active, the server broadcast is a
    //   walk order -> adopt it as our target (server-adjusted destination)
    // - if the server position disagrees by > 5 m (teleport/respawn/
    //   enterWorld), snap to it
    // - otherwise (ValidateLocation drift) ignore it
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
  gameSound.forget(msg.id);
});
net.on('chat', (msg) => chat.addChat(msg.from ?? '?', msg.channel, msg.text ?? '', msg.target));
net.on('sysMsg', (msg) => {
  // cast interruption signals (aCis CreatureCast): 27 CASTING_INTERRUPTED,
  // 748 DIST_TOO_FAR_CASTING_STOPPED — the casting bar cancels on either
  if (msg.id === 27 || msg.id === 748) skillBar.cancelCast();
  // skillmeta rides along so SKILL_NAME params render as names, not raw
  // ids ("You use Wind Strike." — gamedata.js SKILL_PARAM_MSGS)
  Promise.all([sysMsgMeta(), skillMeta()]).then(([meta, skills]) =>
    chat.addSysMsg(renderSysMsg(meta, msg.id, msg.params || [], skills), msg.id, msg.params || [],
      sysMsgColor(meta, msg.id)));
});

// --- M3 combat ops ------------------------------------------------------------
net.on('target_ok', (msg) => {
  const e = entities.getEntity(msg.id);
  // target_ok.color is the raw aCis MyTargetSelected color:
  // viewerLevel - targetLevel for attackable targets, 0 otherwise
  // (gateway/README.md). Used directly as the con-color diff.
  const color = typeof msg.color === 'number' ? msg.color
    : (e && e.level != null && combat.self ? (combat.self.level ?? 1) - e.level : null);
  combat.setTarget(msg.id, (e && e.name) || (msg.id === selfId && selfName) || `#${msg.id}`,
    { kind: e ? e.kind : 'npc', level: e ? e.level ?? null : null, color });
});
net.on('status', (msg) => combat.updateStatus(msg.id, msg.hp, msg.maxHp, msg.mp, msg.maxMp));
net.on('selfStatus', (msg) => {
  combat.updateSelf(msg);
  if (statusWnd) statusWnd.update({ ...msg, name: selfName });
});
net.on('attack', (msg) => {
  entities.attackFlash(msg.id);
  // damage float over the victim (self included: the op carries targetId)
  const pos = entityHeadPos(msg.targetId);
  if (pos) combat.damage(pos, msg);
  // the blow: impact on the victim + its cry, and our weapon when we swung it
  if (pos) gameSound.attack(msg, pos, selfId);
  // the attacker's own swing (npcgrp attack_sound), at the attacker — a
  // separate bank from the impact, and it belongs at the other end of the blow
  const swingPos = entityHeadPos(msg.id);
  if (swingPos) gameSound.swing(msg.id, swingPos);
  // soulshot: the SS bit rides the blow (Attack.HITFLAG_SS) — there is no
  // separate packet, so this is the only moment a shot is observable
  if (msg.soulshot) {
    gameSound.shot(entityHeadPos(msg.id), msg.id === selfId);
    const shotPos = entityHeadPos(msg.id);
    if (shotPos) skillFx.flash(shotPos, 0xfff2a8);   // retail shot glint
  }
  // rebuilt models carry a 'damage' flinch clip; oneShot no-ops without it
  if (msg.targetId === selfId && character) character.oneShot('damage');
});
net.on('die', (msg) => {
  const deathPos = entityHeadPos(msg.id);
  if (deathPos) gameSound.die(msg.id, deathPos);   // before the entity is torn down
  entities.die(msg.id);
  combat.markDead(msg.id);
  if (msg.id === selfId && character) {
    // a corpse keeps no walk order: a leftover click target would make
    // Character.update's moving branch override the death clip every frame
    // (and the model would keep sliding while dead)
    character.clearTarget();
    moveQueue.length = 0;
    pendingGoal = null;
    wasdLeg = null;
  }
});
net.on('revive', (msg) => {
  entities.revive(msg.id);
  combat.markRevived(msg.id);
  if (msg.id === selfId && character) {
    // self respawn: clear the death overlay NOW (the selfStatus hp>0 right
    // behind confirms it) and free the model — the respawn teleport arrives
    // as a regular move op, and a leftover walk target would adopt it as a
    // walk order instead of snapping to the new position
    document.getElementById('death-overlay').classList.remove('visible');
    character.clearTarget();
    moveQueue.length = 0;
    pendingGoal = null;
    wasdLeg = null;
  }
});

onlineToggle.addEventListener('change', () => setOnline(onlineToggle.checked));

// verification hook
window.__world = {
  scene, camera, renderer,
  hd: HD_ENABLED,
  audio, gameSound, worldAudio, worldLight,
  // verification hook: verify_resilience.js drives a scene load whose fetch is
  // made to fail, to prove one bad request cannot strand the client
  loadScene: (tile, opts) => loadScene(tile, opts),
  get terrain() { return terrain; },
  get character() { return character; },
  get selfModelId() { return selfModelId; },
  get neighbors() { return neighbors; },
  get currentTile() { return currentTile; },
  // neighbor-aware ground height (the walking router): answers across the
  // whole 3x3 window, not just the center tile
  heightAt(x, z, currentZ = null) { return heightRouter.heightAtWorld(x, z, currentZ); },
  net: {
    get connected() { return net.connected; },
    get online() { return online; },
    get selfId() { return selfId; },
    get url() { return net.url; },
    get log() { return net.log; },
    // verification helper: raw op send (walkTo is the movement equivalent)
    sendOp: (op, fields = {}) => net.send(op, fields),
    // verification helper: simulate an INBOUND op through the normal
    // dispatch + log (fixtures the mock does not implement, e.g. respawn)
    inject: (msg) => { net._log('in', msg); net._emit(msg.op, msg); },
  },
  // character-creation overlay state (verification)
  charCreate: { get open() { return !!ccOverlay; } },
  // character-select overlay state (verification)
  charSelect: { get open() { return !!csOverlay; } },
  entities,
  get chat() { return chat; },
  combat,
  skillBar,
  get weaponGate() { return weaponGate; },
  get inventory() { return inventory; },
  get shortcutWnd() { return shortcutWnd; },
  get targetWnd() { return combat.targetWnd; },
  get npcDialog() { return npcDialog; },
  get charSheet() { return charSheetData; },
  get statusWnd() { return statusWnd; },
  get skillWnd() { return skillWnd; },
  get actionWnd() { return actionWnd; },
  get minimapWnd() { return minimapWnd; },
  get questWnd() { return questWnd; },
  questCond, questStarted,   // verification: aCis flags-dword math
  get partyWnd() { return partyWnd; },
  get clanWnd() { return clanWnd; },
  get abnormalWnd() { return abnormalWnd; },
  get shopWnd() { return shopWnd; },
  get multiSellWnd() { return multiSellWnd; },
  get tradeWnd() { return tradeWnd; },
  get storeWnd() { return storeWnd; },
  get warehouseWnd() { return warehouseWnd; },
  get menuWnd() { return menuWnd; },
  get systemMenuWnd() { return systemMenuWnd; },
  wndMgr: WndMgr,
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
    walkToServer(v);
  },
  // click-to-move internals (verification, read-only): the queued legs and
  // the geodata A* (findPath over the loaded tiles; NavGrid for synthetic
  // unit tests, pendingGoal = the click a re-path is still chasing)
  get moveQueue() { return moveQueue; },
  nav: {
    findPath: (sx, sy, sz, gx, gy, gz) => nav.findPath(sx, sy, sz, gx, gy, gz),
    NavGrid,
    get pendingGoal() { return pendingGoal; },
  },
  ready: false,
};

function setStatus(msg) { statusEl.textContent = msg; }
function setLoading(msg) { loadingText.textContent = msg; }

// --- loading ---------------------------------------------------------------

// keepCharPos: boundary crossings re-center the 3x3 window WITHOUT moving
// the character (the default scene-picker/enterWorld path still spawns at
// the tile center / dungeon spawn cluster).
async function loadScene(tile, { keepCharPos = false } = {}) {
  setLoading(`loading scene ${tile}…`);
  loadingEl.classList.remove('hidden');
  sceneLoading = true;
  pendingSceneSwitch = null;   // an explicit load supersedes a queued crossing
  const prevTile = currentTile;
  try {
    // Build the replacement BEFORE retiring what is on screen. This used to
    // dispose the old terrain first, so any failure below — a 502 crossing a
    // border, a dropped connection — left the world with nothing to stand on
    // and nothing to fall back to. Holding both for the duration of one load
    // costs a little memory and is the difference between a hiccup and a dead
    // session.
    const baseUrl = `${HD_ENABLED ? '/scenes-hd' : '/scenes'}/${encodeURIComponent(tile)}/`;
    const res = await fetch(baseUrl + 'scene.json');
    // fetch only rejects on network failure; an HTTP error still resolves, and
    // .json() on an error body throws something that tells you nothing.
    if (!res.ok) throw new Error(`scene.json: HTTP ${res.status}`);
    const def = await res.json();
    const t = new Terrain(def, baseUrl);
    await t.load();

    if (terrain) { scene.remove(terrain.group); terrain.dispose(); }
    terrain = t;
    scene.add(t.group);
    currentTile = tile;
    applyInteriorMode(!!t.interior);
    // the tile's own soundscape: MusicVolume zones + placed ambient emitters.
    // Always from /scenes — audio.json has no HD variant. Not awaited: the
    // world must not block on it, and it degrades to silence on its own.
    worldAudio.load(tile);
    worldLight.load(tile);   // the tile's own sun angle, ambient and fog

    // the 3x3 window of cheap neighbor tiles shifts with the new center
    // (dungeons have no surface neighborhood — interiors skip it entirely)
    if (!neighbors) neighbors = new NeighborTiles(scene, availableScenes);
    if (NEIGHBORS_ENABLED && !t.interior) await neighbors.setCenter(tile, t);
    else await neighbors.disposeAll();

    if (character) {
      if (keepCharPos) {
        const p = character.group.position;
        p.y = heightRouter.heightAtWorld(p.x, p.z, p.y);
      } else {
        let c;
        if (t.interior && t.spawnL2) {
          // dungeons: spawn inside the densest prop cluster, not tile center
          c = l2ToThree(t.spawnL2[0], t.spawnL2[1], 0);
        } else {
          c = t.center();
        }
        // The spawn z hint must be LOCAL: the previous tile's y is
        // meaningless here (outside every geodata layer's reach the
        // walking rule keeps it, parking the character at the old
        // altitude — measured: 19_16 dungeon spawn floated 2.12m over the
        // real floor and popped down on the first step). Outdoor: the
        // mesh height already in c; interior: the prop-derived floorY,
        // which selects the real dungeon-floor layer, not the dummy plane.
        c.y = t.heightAtWorld(c.x, c.z, t.interior ? t.floorY : c.y);
        character.group.position.copy(c);
      }
      character.clearTarget();
      // a teleport-style load (picker/enterWorld) drops the click goal; a
      // boundary crossing (keepCharPos) keeps it so repathPending resumes
      // the route on the new tile's geodata
      if (!keepCharPos) pendingGoal = null;
    }
    sun.position.copy(worldLight.direction).multiplyScalar(-150).add(character ? character.group.position : t.center());
    setStatus(`scene: ${tile} (${def.gridSize}x${def.gridSize})`);
    loadingEl.classList.add('hidden');
  } catch (err) {
    // There was no catch here at all, and terrain is nulled above BEFORE the
    // fetch. So a single failed request — a 502 while crossing a tile border,
    // a dropped connection — left the world with no terrain and the #loading
    // overlay still up. That overlay is opaque and covers the viewport, and it
    // swallows clicks, so the client was permanently dead with no way back
    // short of a reload. One transient error should not end the session.
    console.error(`[scene] ${tile}:`, err);
    setStatus(`scene ${tile} failed to load`);
    loadingEl.classList.add('hidden');
    if (chat) chat.addSystem(`Could not load ${tile}. Staying where you were.`);
    // Nothing was replaced if the failure happened before the new terrain was
    // adopted, so let the boundary watcher retry the crossing later rather
    // than pinning us to a tile we never managed to load.
    currentTile = terrain ? currentTile : prevTile;
  } finally {
    sceneLoading = false;
  }
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
  selfModelId = entry.id;
  scene.add(ch.group);
  // camera parameters are character-relative (true L2 scale)
  followCam.setScale(ch.heightM || 1.75);
  camera.near = Math.max(0.02, (ch.heightM || 1.75) * 0.1);
  camera.updateProjectionMatrix();
  sun.position.copy(worldLight.direction).multiplyScalar(-150).add(ch.group.position);
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
      v.y += en.kind === 'player' ? 1.0 : en.kind === 'drop' ? 0.25 : 0.6;
      v.project(camera);
      if (v.z > 1) continue;
      const px = (v.x + 1) / 2 * canvas.clientWidth;
      const py = (-v.y + 1) / 2 * canvas.clientHeight;
      const d = Math.hypot(px - e.clientX, py - e.clientY);
      if (d < bestD) { bestD = d; best = id; }
    }
    if (best != null) { clickEntity(best); return; }
  }

  // click-to-move: center terrain + the cheap neighbor meshes, so a click
  // across the border walks there (entity picking above still wins)
  const walkTargets = terrain.mesh ? [terrain.mesh] : [];
  if (neighbors) walkTargets.push(...neighbors.meshes());
  const hit = walkTargets.length ? ray.intersectObjects(walkTargets, false)[0] : null;
  if (hit && !character.dead) walkToServer(hit.point);
});

window.addEventListener('keydown', e => {
  // F1..F12 trigger the shortcut bar's current page (retail behavior —
  // wins over the old F1-attack binding; double-click still attacks).
  // This guard runs BEFORE chat.isTyping on purpose: browsers reserve
  // several F-keys (F1 help, F5 reload, F11 fullscreen, F12 devtools) and
  // losing the page to F5 mid-sentence is worse than losing the key —
  // preventDefault ALWAYS; the bar itself fires only when not typing.
  if (/^F([1-9]|1[0-2])$/.test(e.code)) {
    if (!chat.isTyping && shortcutWnd) shortcutWnd.triggerF(Number(e.code.slice(1)) - 1);
    e.preventDefault();   // browsers reserve F-keys (help, reload, devtools)
    return;
  }
  if (chat.isTyping) return;   // chat input handles its own keys
  if (e.code === 'Escape') {
    // retail order: Esc closes the topmost open window first (WndMgr tracks
    // visibility + the z-stack); only with no window open does it clear the
    // target. (Chat's own Esc closes the input inside chat.js — its keydown
    // stops propagation, so it never reaches this handler.)
    if (!WndMgr.closeTopmost() && combat.targetId != null) combat.clearTarget();
    return;
  }
  if (e.code === 'Enter') {
    if (online) { chat.open(); e.preventDefault(); }
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
  if (e.code === 'Backquote') {
    // dev bar toggle — AUTHORED key (no retail binding; F9 is retail slot 9
    // and must reach the shortcut bar above)
    setDevBar(!hudEl.classList.contains('dev-visible'));
    e.preventDefault();
    return;
  }
  // Retail Alt+ keymap. Evidence: 5 independent L2 references
  // (pmfun.com/list/key, maxcheaters topic 7183, l2topzone,
  // onlinegamecommands, legacy-lineage2) agree on the set, and
  // SystemMenuWnd.uc:122-123 internally confirms the Alt+ pattern for B/R.
  // chat.isTyping returned above, so Alt+letter never fires while typing.
  if (e.altKey) {
    switch (e.code) {
      case 'KeyK': if (skillWnd) skillWnd.toggle(); break;   // SkillWnd
      case 'KeyT': sheetPanel.toggle(); break;               // retail "Character Status" (our CharSheet)
      case 'KeyV': inventory.toggle(); break;                // InventoryWnd
      case 'KeyX': if (systemMenuWnd) systemMenuWnd.toggle(); break;  // SystemMenuWnd
      case 'KeyC': if (actionWnd) actionWnd.toggle(); break; // ActionWnd
      case 'KeyU': if (questWnd) questWnd.toggle(); break;   // QuestTreeWnd (quest journal)
      // ClanWnd: the same 5-reference set puts the clan window on Alt+N
      case 'KeyN': if (clanWnd) clanWnd.toggle(); break;
      // Alt+B / Alt+R: BBS / Macro windows — not built; unbound.
      default: return;
    }
    e.preventDefault();   // browsers reserve several Alt combos
    return;
  }
  // retail Tab also opens the inventory (5 refs); safe here because
  // chat.isTyping returned earlier, so chat focus is untouched
  if (e.code === 'Tab') {
    inventory.toggle();
    e.preventDefault();
    return;
  }
  if (/^Digit[0-9]$/.test(e.code)) {
    // AUTHORED convenience alias: Digit1..0 trigger shortcut slots 1..10 —
    // retail itself is F-key only, but browsers eat some F-keys and the
    // old invented hotbar trained this habit (documented in the keymap).
    if (shortcutWnd) shortcutWnd.triggerF((Number(e.code[5]) + 9) % 10);
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

// --- movement orders (click-to-move + WASD) ----------------------------------
// The mouse-mode moveTo op is the ONLY server-accepted movement path
// (keyboard movement packets are rejected), so every movement input funnels
// through walkToServer -> net.send('moveTo'). Server echo reconciliation
// lives in the net.on('move') self branch.
//
// Far-click routing: aCis MoveBackwardToLocation has NO pathing — a
// straight hop into geometry stalls with a bare actionFailed (the classic
// case: training hall -> TI village against the aqueduct near
// (-77800, 251000)). Clicks route over the coarse nav grid + A* in
// js/geodata.js (NavGrid): the grid spans the center tile + whatever
// neighbor geodata has loaded, so a path STOPS at the edge of loaded
// ground; when the queue drains short of the click, repathPending re-paths
// (neighbor geodata lands lazily via preloadNear, the scene switch lands
// on border crossing) until the goal is reached or a few re-paths make no
// progress. No route at all -> the old straight <=2000-unit legs (the
// server refusal then surfaces the 'Can't reach that.' line as before).
const MOVE_LEG_M = 20;          // 2000 L2 units per leg
const moveQueue = [];           // pending legs (THREE.Vector3)

const nav = new NavGrid((x, y) => {   // world L2 coords -> loaded Geodata
  const t = tileNameFor(x, y);
  if (terrain && t === currentTile) return terrain.geodata;
  const e = neighbors && neighbors.tiles.get(t);
  return e ? e.geodata : null;
});
let pendingGoal = null;       // clicked destination (THREE.Vector3) until reached
let repathDist = Infinity;    // goal distance at the last re-path
let repathStalls = 0;         // consecutive re-paths without progress
let repathAfter = 0;          // re-path cadence floor (performance.now ms)
const REPATH_ARRIVE_M = 2;    // click-goal tolerance
const REPATH_MAX_STALLS = 3;  // give up after this many re-paths without progress
const REPATH_MIN_MS = 400;

function walkToServer(dest, { pathfinding = true } = {}) {
  moveQueue.length = 0;         // a new order supersedes legs in flight
  pendingGoal = pathfinding ? dest.clone() : null;
  repathDist = Infinity;
  repathStalls = 0;
  repathAfter = 0;
  if (!pathfinding || !planNavLegs(dest)) straightLegs(dest);
  pumpMoveQueue();
}

// Straight <=MOVE_LEG_M legs along the clicked direction — the pre-nav
// behavior, kept as the fallback when the nav grid has no route (no
// geodata under the start, unwalkable click, zero A* progress).
function straightLegs(dest) {
  const from = character.group.position;
  const dx = dest.x - from.x, dz = dest.z - from.z;
  const steps = Math.ceil(Math.hypot(dx, dz) / MOVE_LEG_M);
  for (let i = 1; i < steps; i++) {
    moveQueue.push(new THREE.Vector3(
      from.x + dx * i / steps, dest.y, from.z + dz * i / steps));
  }
  moveQueue.push(dest.clone());
}

// A* route from the character to dest, queued as <=MOVE_LEG_M legs (the
// server-side 9900-unit cap and the echo reconciliation are untouched).
// false when the nav grid found no route at all (caller falls back).
function planNavLegs(dest) {
  const from = character.group.position;
  const s = threeToL2(from), d = threeToL2(dest);
  const route = nav.findPath(s.x, s.y, s.z, d.x, d.y, d.z);
  if (!route || route.points.length < 2) return false;
  let prev = from;
  for (let i = 1; i < route.points.length; i++) {
    const wp = l2ToThree(route.points[i].x, route.points[i].y, route.points[i].z);
    const dx = wp.x - prev.x, dz = wp.z - prev.z;
    const steps = Math.ceil(Math.hypot(dx, dz) / MOVE_LEG_M);
    for (let k = 1; k <= steps; k++) {
      moveQueue.push(new THREE.Vector3(
        prev.x + dx * k / steps, wp.y, prev.z + dz * k / steps));
    }
    prev = wp;
  }
  return true;
}

// The queue drained short of the clicked goal: re-path — the path had
// stopped at the edge of loaded geodata, and more may have loaded since
// (preloadNear on approach, the scene switch on border crossing). A few
// re-paths with no progress means a genuinely unreachable click: fall back
// to the straight legs, so an online refusal still surfaces the loud
// 'Can't reach that.' (the pre-nav behavior).
function repathPending() {
  if (!pendingGoal || character.dead || sceneLoading) return;
  const p = character.group.position;
  const d = Math.hypot(pendingGoal.x - p.x, pendingGoal.z - p.z);
  if (d < REPATH_ARRIVE_M) { pendingGoal = null; return; }
  const now = performance.now();
  if (now < repathAfter) return;
  repathAfter = now + REPATH_MIN_MS;
  if (d > repathDist - 0.5 && ++repathStalls > REPATH_MAX_STALLS) {
    const goal = pendingGoal;
    pendingGoal = null;
    straightLegs(goal);
  } else {
    if (d <= repathDist - 0.5) repathStalls = 0;
    repathDist = d;
    planNavLegs(pendingGoal);
  }
  pumpMoveQueue();
}

// The Z we DRAW and the Z we SEND are two different surfaces, and conflating
// them is what made the server refuse moves.
//
// Since the ground-height fix, the height router returns the drawn terrain
// height: geodata picks the walkable LEVEL and the heightfield supplies its Z,
// so feet touch what is rendered. But aCis validates movement against geodata,
// which sits ~30 L2 units above that surface, so sending the rendered Z asks
// the server to walk to a point below its own floor — it answers ActionFailed,
// and the client honestly reports "Can't reach that."
//
// So: render at the anchored height, send the raw geodata height. When there is
// no geodata under the point (no coverage, or offline) the rendered Z is still
// the best answer available and goes out unchanged.
function serverDest(p) {
  const l2 = threeToL2(p);
  const geo = terrain && terrain.geodata;
  if (geo) {
    const z = geo.heightAt(l2.x, l2.y, l2.z);
    if (z != null) l2.z = Math.round(z);
  }
  return l2;
}

function pumpMoveQueue() {
  if (!moveQueue.length) return;
  const leg = moveQueue.shift();
  character.setTarget(leg);
  if (online) {
    notePlayerAction('move');
    net.send('moveTo', serverDest(leg));
  }
}

// WASD honesty: a held key STREAMS real move orders — short moveTo legs in
// the camera-relative direction, re-sent as the character closes in or the
// held heading turns. Key-up simply stops the stream (the character walks
// out the last leg, which the server did receive). Offline (solo) keeps the
// old cosmetic local move.
const WASD_LEG_M = 8;           // leg length (~one move order ahead)
const WASD_RESEND_M = 2.5;      // re-stream when this close to the leg end
const WASD_TURN_RAD = 0.5;      // ...or when the held direction turned this far
const WASD_MIN_MS = 250;        // streamed-op cadence floor
let wasdLeg = null;             // {dest, dir, t} of the last streamed leg

function streamWasdMove(dir) {
  const now = performance.now();
  const pos = character.group.position;
  const due = !wasdLeg
    || Math.hypot(wasdLeg.dest.x - pos.x, wasdLeg.dest.z - pos.z) < WASD_RESEND_M
    || wasdLeg.dir.angleTo(dir) > WASD_TURN_RAD;
  if (!due || now - (wasdLeg ? wasdLeg.t : 0) < WASD_MIN_MS) return;
  const dest = pos.clone().addScaledVector(dir, WASD_LEG_M);
  dest.y = heightRouter.heightAtWorld(dest.x, dest.z, pos.y);
  // streamed WASD legs keep the straight-leg path (no nav detour): a held
  // key means "walk THIS heading", and each 8 m leg re-plans 4x a second
  walkToServer(dest, { pathfinding: false });
  wasdLeg = { dest, dir: dir.clone(), t: now };
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
  // deferred boundary crossing (set at the bottom of the previous frame —
  // loadScene nulls `terrain` synchronously, so it must not run mid-block)
  if (pendingSceneSwitch && !sceneLoading) {
    const t = pendingSceneSwitch;
    pendingSceneSwitch = null;
    scenePicker.value = t;
    loadScene(t, { keepCharPos: true });
  }
  if (character && terrain) {
    // WASD: online it streams real moveTo legs (server-authoritative);
    // offline it stays the old cosmetic local move. Dead/sitting stream
    // nothing, and online the cosmetic move is off entirely — the model
    // follows only server-backed targets.
    const moveDir = wasdDir();
    if (online && moveDir && !character.dead && !selfSitting) {
      streamWasdMove(moveDir);
    } else {
      wasdLeg = null;
    }
    character.update(dt, heightRouter, online ? null : moveDir);
    if (!character.target) {
      if (moveQueue.length) pumpMoveQueue();   // leg arrived: send the next
      else repathPending();                    // queue drained: re-path the click
    }
    entities.update(dt, heightRouter);
    // boundary crossing: the entered tile becomes the full-quality center
    // (the 3x3 neighbor window shifts inside loadScene). Interiors never
    // trigger this — a dungeon's extent is its own business. The switch is
    // DEFERRED to the top of the next frame: loadScene nulls `terrain`
    // synchronously, and the rest of this block still reads it.
    if (!terrain.interior && !sceneLoading) {
      const p = character.group.position;
      const l2 = threeToL2(p);
      const tName = tileNameFor(l2.x, l2.y);
      if (tName !== currentTile && availableScenes.includes(tName)) {
        pendingSceneSwitch = tName;
      } else if (neighbors) {
        neighbors.preloadNear(p.x, p.z);   // lazy geodata on approach
      }
    }
    combat.update(entityHeadPos);
    skillFx.update();
    // zone music + ambient emitters follow the character's body, not the
    // camera: standing inside a town's MusicVolume is what starts its theme
    worldAudio.update(dt, character.group.position);
    // interior torch light follows the player
    if (terrain.interior) {
      torch.position.copy(character.group.position);
      torch.position.y += (character.heightM || 1.75) * 2.2;
      // fire-prop lights: subtle flicker (cheap, authored)
      const ft = clock.elapsedTime;
      for (const l of terrain.fireLights) {
        l.intensity = l.userData.baseIntensity
          * (0.88 + 0.16 * Math.sin(ft * 11 + l.userData.phase)
             * Math.sin(ft * 5.3 + l.userData.phase * 2));
      }
    }
    // water uv drift (retail TexPanner feel; plane/height are sourced)
    if (terrain.waterTex) {
      const t = clock.elapsedTime;
      terrain.waterTex.offset.set((t * WATER_SCROLL[0]) % 1,
                                  (t * WATER_SCROLL[1]) % 1);
    }
    // prop draw distance, reevaluated at 2 Hz
    propDistTimer += dt;
    if (PROP_DRAW_DIST && propDistTimer > 0.5) {
      propDistTimer = 0;
      terrain.setPropDrawDistance(PROP_DRAW_DIST, character.group.position);
    }
    // shadow frustum follows the character
    sun.position.copy(worldLight.direction).multiplyScalar(-150).add(character.group.position);
    sun.target.position.copy(character.group.position);
    followCam.update(dt, character.group.position, heightRouter);
    sky.position.copy(camera.position);
    if (minimapWnd) minimapWnd.tick(character, entities);
    if (abnormalWnd) abnormalWnd.tick();
    // cooldown sweeps (skillBar.reuse is fed by skillCoolTime + the cast lock)
    if (shortcutWnd) shortcutWnd.tickCooldowns(skillBar);
    if (skillWnd) skillWnd.tickCooldowns(skillBar);
  }
  // the ear rides the camera, not the character: the panner has to agree with
  // what is on screen or sounds pan the wrong way whenever the camera orbits
  audio.setListener(camera);
  renderer.render(scene, camera);
});

// --- boot ----------------------------------------------------------------------

// Last-resort backstop. The loading overlay is opaque and swallows clicks, so
// any path that raises it and then throws before lowering it kills the session.
// loadScene now catches its own failures; this covers the ones nobody
// anticipated, which are exactly the ones that would otherwise strand a player.
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandled]', e.reason);
  if (loadingEl && !loadingEl.classList.contains('hidden')) {
    loadingEl.classList.add('hidden');
    setStatus('something failed to load — see the console');
  }
});

(async function boot() {
  try {
    // The retail skin must be resident before any window is constructed.
    // skillAnimMeta prefetches so the cast-time beneficial check (onCast)
    // has the anim codes synchronously.
    // audio.init()/gameSound.load() resolve false when assets/audio is absent
    // (it is gitignored and regenerated by tools/audio/build_audio.py) — the
    // client then runs silent instead of failing to boot
    await Promise.all([Skin.load(), Font.load(), Layout.load(),
                       loadExpTable(), loadSkillTypes(), weaponGate.load(),
                       skillAnimMeta(), shotMeta(), loadEquipment(),
                       audio.init(), gameSound.load()]);
    makeChat();
    statusWnd = new StatusWnd(document.body);
    statusWnd.show();     // retail keeps it on screen; gauges fill on selfStatus

    // Every retail window is movable and participates in the interface
    // reset (Alt+Enter) — see docs/ui-reverse-engineering.md §2-3.
    WndMgr.register('StatusWnd', statusWnd);

    // Phase C.3: the retail skill window (K). Two panes, Active+Toggle vs
    // Passive, exactly as MagicSkillWnd.uc routes them.
    skillWnd = new SkillWnd(document.body, {
      onCast: (id) => { if (online) skillBar.castSkill(id); },
    });
    skillWnd.onAssign = (data) => shortcutWnd && shortcutWnd.assignFirstFree(data);
    skillWnd.place({ right: 12, top: 60 });
    WndMgr.register('MagicSkillWnd', skillWnd, { handle: skillWnd.win.bar });
    WndMgr.bindResetKey();

    // Phase C.5: the retail actions window (Alt+C). Three sections
    // (Basic/Party/Social) straight from actionname.json categories.
    actionWnd = new ActionWnd(document.body, {
      onUse: (id) => useAction(id),
    });
    actionWnd.onAssign = (data) => shortcutWnd && shortcutWnd.assignFirstFree(data);
    actionWnd.setActions();
    actionWnd.place(actionWnd.defaultPlace);
    WndMgr.register('ActionWnd', actionWnd, { handle: actionWnd.win.bar });

    // Phase C.7: the retail map window (MenuWnd's Map button). Markers
    // feed from the live scene every frame (throttled inside tick()).
    minimapWnd = new MinimapWnd(document.body);
    minimapWnd.setMeta();
    minimapWnd.place(minimapWnd.defaultPlace);
    WndMgr.register('MinimapWnd', minimapWnd, { handle: minimapWnd.win.bar });

    // Phase C.8: the retail quest journal (Alt+U). Filled by the bridge's
    // questList pushes (enterWorld + every server-side state change).
    questWnd = new QuestWnd(document.body, {
      onAbort: (id) => { if (online) net.send('questAbort', { id }); },
    });
    questWnd.place(questWnd.defaultPlace);
    WndMgr.register('QuestTreeWnd', questWnd, { handle: questWnd.win.bar });

    // Phase C.9: the retail party window (WindowsInfo.ini dock 0,92).
    // Frameless HUD strip: full-snapshot member rows + invite/leave/kick.
    partyWnd = new PartyWnd(document.body, {
      onInvite: (name) => { if (online) net.send('partyInvite', { name }); },
      onAnswer: (accept) => { if (online) net.send('partyAnswer', { accept }); },
      onKick: (name) => { if (online) net.send('partyKick', { name }); },
      onLeave: () => { if (online) net.send('partyLeave'); },
      onTargetMember: (id) => { if (online) net.send('target', { id }); },
      getTarget: () => {
        const t = combat.target;
        if (!t) return null;
        // kind drives the invite-row visibility (players only — NPCs and
        // monsters can't be partied); self can't invite itself either
        const e = t.id === selfId ? null : entities.getEntity(t.id);
        return { name: t.name, kind: e && e.kind };
      },
      getSelfId: () => selfId,
    });
    WndMgr.register('PartyWnd', partyWnd, { handle: partyWnd.gutter });

    // Phase C.12: the retail clan window (Alt+N). Full-snapshot clan info +
    // member list from the M14 bridge ops; invite/leave/oust ride the
    // contract ops, everything else renders disabled (no backend).
    clanWnd = new ClanWnd(document.body, {
      onLeave: () => { if (online) net.send('clanLeave'); },
      onInvite: (name) => { if (online) net.send('clanInvite', { name }); },
      onOust: (name) => { if (online) net.send('clanOust', { name }); },
      onAnswer: (accept) => { if (online) net.send('clanAnswer', { accept }); },
      getTarget: () => {
        const t = combat.target;
        if (!t) return null;
        const e = t.id === selfId ? null : entities.getEntity(t.id);
        return { name: t.name, kind: e && e.kind };
      },
      getSelfName: () => selfName,
    });
    clanWnd.place(clanWnd.defaultPlace);
    WndMgr.register('ClanWnd', clanWnd, { handle: clanWnd.win.bar });

    // Phase C.10: the retail buff strip (WindowsInfo.ini dock 348,583).
    abnormalWnd = new AbnormalWnd(document.body);
    WndMgr.register('AbnormalStatusWnd', abnormalWnd, { handle: abnormalWnd.root });

    // Phase C.11: the NPC shop. buyList/sellList open it; results arrive
    // ONLY via invUpdate (server truth — failures are sysMsg in chat).
    shopWnd = new ShopWnd(document.body, {
      onBuy: (items) => { if (online) net.send('buy', { items }); },
      onSell: (items) => { if (online) net.send('sell', { items }); },
      getAdena: () => {
        if (!inventory) return 0;
        const a = [...inventory.items.values()].find(i => i.itemId === 57);
        return a ? a.count : 0;
      },
    });
    shopWnd.place(shopWnd.defaultPlace);
    WndMgr.register('ShopWnd', shopWnd, { handle: shopWnd.win.bar });

    // M15: the NPC multisell (item exchange). multisellList opens it (the
    // merchant bypass drives that server-side); multisellChoose is the
    // only outbound op; results arrive ONLY via invUpdate/itemList
    // (server truth — failures are sysMsg lines in chat).
    multiSellWnd = new MultiSellWnd(document.body, {
      onChoose: (listId, entryId, count) => {
        if (online) net.send('multisellChoose', { listId, entryId, count });
      },
      getOwned: (itemId) => {
        if (!inventory) return 0;
        // equipped gear does not count (aCis inventoryOnly skips it)
        let n = 0;
        for (const i of inventory.items.values()) {
          if (i.itemId === itemId && !i.equipped) n += i.count;
        }
        return n;
      },
    });
    multiSellWnd.place(multiSellWnd.defaultPlace);
    WndMgr.register('MultiSellWnd', multiSellWnd, { handle: multiSellWnd.win.bar });

    // M16: the warehouse keeper window (WarehouseWnd). whDeposit/whWithdraw
    // open it (the keeper's DepositP/WithdrawP bypass drives that
    // server-side); whDepositItems/whWithdrawItems are the only outbound
    // ops; results arrive ONLY via invUpdate (server truth — failures are
    // sysMsg lines in chat).
    warehouseWnd = new WarehouseWnd(document.body, {
      onDeposit: (items) => { if (online) net.send('whDepositItems', { items }); },
      onWithdraw: (items) => { if (online) net.send('whWithdrawItems', { items }); },
      getAdena: () => {
        if (!inventory) return 0;
        const a = [...inventory.items.values()].find(i => i.itemId === 57);
        return a ? a.count : 0;
      },
    });
    warehouseWnd.place(warehouseWnd.defaultPlace);
    WndMgr.register('WarehouseWnd', warehouseWnd, { handle: warehouseWnd.win.bar });

    // Phase C.12: player-to-player trade. '/trade' with a player targeted
    // invites; tradeStart opens the window, tradeOwn/tradeOther are the
    // ONLY pane truth (server-authoritative), tradeEnd closes.
    tradeWnd = new TradeWnd(document.body, {
      onAdd: (objectId, count) => { if (online) net.send('tradeAdd', { objectId, count }); },
      onDone: () => { if (online) net.send('tradeDone', {}); },
      onCancel: () => { if (online) net.send('tradeCancel', {}); },
      onAnswer: (accept) => { if (online) net.send('tradeAnswer', { accept }); },
    });
    tradeWnd.place(tradeWnd.defaultPlace);
    WndMgr.register('TradeWnd', tradeWnd, { handle: tradeWnd.win.bar });

    // Phase C.13: the private store (PrivateShopWnd). Manage views open
    // from storeMsgSell/storeMsgBuy (requested via the ActionWnd private-
    // store actions — bridge ops, see requestStoreManage); the observer
    // view opens from playerStore when clicking someone's store. The OK
    // button sends storeSetSell/storeSetBuy — that IS the store start
    // (M13: storeStart is a no-op, never sent).
    storeWnd = new StoreWnd(document.body, {
      onSetSell: (items, title) => {
        if (online) net.send('storeSetSell', { items, ...(title ? { title } : {}) });
      },
      onSetBuy: (items, title) => {
        if (online) net.send('storeSetBuy', { items, ...(title ? { title } : {}) });
      },
      onStop: () => { if (online) net.send('storeStop', {}); },
      onBuy: (storeId, items) => { if (online) net.send('storeBuy', { storeId, items }); },
      onSell: (storeId, items) => { if (online) net.send('storeSell', { storeId, items }); },
      getAdena: () => {
        if (!inventory) return 0;
        const a = [...inventory.items.values()].find(i => i.itemId === 57);
        return a ? a.count : 0;
      },
    });
    storeWnd.place(storeWnd.defaultPlace);
    WndMgr.register('PrivateShopWnd', storeWnd, { handle: storeWnd.win.bar });
    // the invite row follows the current target (target + invite flow)
    const _combatSetTarget = combat.setTarget.bind(combat);
    combat.setTarget = (id, name, opts) => {
      _combatSetTarget(id, name, opts);
      if (partyWnd) partyWnd.refreshInvite();
      if (clanWnd) clanWnd.refreshInvite();
    };
    const _combatClearTarget = combat.clearTarget.bind(combat);
    combat.clearTarget = () => {
      _combatClearTarget();
      if (partyWnd) partyWnd.refreshInvite();
      if (clanWnd) clanWnd.refreshInvite();
    };
    // StatusWnd.uc OnLButtonDown: clicking the window targets yourself
    statusWnd.onSelfTargetClick(() => {
      if (online && selfId != null) net.send('target', { id: selfId });
    });

    // MenuWnd (bottom-right, retail default) + SystemMenuWnd (centered).
    // Button behavior mirrors MenuWnd.uc / SystemMenuWnd.uc; rows with no
    // backend are disabled inside the window (see js/ui/menuwnd.js).
    systemMenuWnd = new SystemMenuWnd(document.body, {
      onAction: (id) => {
        if (id === 'btnOption') settingsPanel.classList.toggle('visible');
        else if (id === 'btnRestart') location.reload();   // clean re-login
        else if (id === 'btnQuit') {
          // Quit = disconnect: go offline (no protocol quit op exists)
          onlineToggle.checked = false;
          setOnline(false);
          systemMenuWnd.toggle(false);
        }
      },
    });
    menuWnd = new MenuWnd(document.body, {
      onAction: (id) => {
        if (id === 'BtnCharInfo') sheetPanel.toggle();
        else if (id === 'BtnInventory') inventory.toggle();
        else if (id === 'BtnMap' && minimapWnd) minimapWnd.toggle();
        else if (id === 'BtnSystemMenu') systemMenuWnd.toggle();
      },
    });

    inventory = new InventoryWnd(document.body, {
      onUse: (oid) => { if (online) net.send('useItem', { objectId: oid }); },
      onDestroy: (oid) => { if (online) net.send('destroyItem', { objectId: oid, count: 1 }); },
      onCrystallize: (oid) => { if (online) net.send('crystallizeItem', { objectId: oid, count: 1 }); },
      onAssign: (data) => shortcutWnd && shortcutWnd.assignFirstFree(data),
      getItems: () => inventory ? [...inventory.items.values()] : [],
      getCharSheet: () => charSheetData,
    });

    combat.targetWnd = new TargetStatusWnd(document.body);
    npcDialog = new NpcDialog(document.body, {
      onBypass: (command) => { if (online) net.send('bypass', { command }); },
    });

    shortcutWnd = new ShortcutWnd(document.body, {
      onUseSkill: (id) => { if (online) skillBar.castSkill(id); },
      onUseItem: (oid) => {
        if (!online) return;
        // A shot is not "used" by clicking it — the click toggles automatic
        // use, which is a different packet entirely (RequestAutoSoulShot vs
        // UseItem). Retail behaves the same way; sending UseItem here would
        // burn a single shot and never turn automation on.
        const it = inventory.items.get(oid);
        if (it && isShot(it.itemId)) {
          net.send('autoShot', { itemId: it.itemId, enable: !activeShotItems.has(it.itemId) });
          return;
        }
        net.send('useItem', { objectId: oid });
      },
      onUseAction: (id) => useAction(id),
      onNote: (text) => chat.addSystem(text),
    });
    // the lock button blocks dragging (Option.ini default: unlocked)
    shortcutWnd.root.addEventListener('pointerdown', (e) => {
      if (shortcutWnd.locked) e.stopImmediatePropagation();
    }, true);

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
