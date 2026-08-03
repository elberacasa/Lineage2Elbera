// Phase C.7 — MinimapWnd, the retail map window (+ MinimapWnd_Expand).
//
// Structure and behaviour come from the client and the mapping research,
// not from guesswork:
//
//   docs/minimap-mapping.md  the mapping spec: georeference formula
//                            (verified 3 ways, residuals <= 15 px), window
//                            behaviour (§4), imagery provenance (§1).
//   assets/gamedata/         TRACKED manifest: georeference constants
//   minimap.json             (X0/Y0/S — read, never retyped), per-tile
//                            worldRect + crop files, 6 self-test anchors.
//   Interface.xdat           MinimapWnd 334x413, MinimapCtrl 328x328 at
//                            (3,51), MapBack frame, ExpandButton (250,385),
//                            TargetButton (170,385). MinimapWnd_Expand
//                            autosizes to the screen, map capped 1016x934.
//   MinimapWnd.uc            the map control is NATIVE: script only feeds
//                            it coords (AddTarget/AdjustMapView). Zoom is
//                            native and undocumented -> fixed zoom here.
//
// Map imagery: /minimap/tiles/<tx>_<ty>.png (256x256 crops, each covering
// exactly its tile's 32768^2 world rect — docs §3) served from
// assets/world/minimap/ (gitignored; build_minimap.py stages it).
// The small window composes the 3x3 neighbourhood around the player's
// tile so the viewport is covered up to the tile borders, and pans to
// keep the player centered (MinimapWnd.uc EV_MinimapChangeOnTick:
// "re-center on player"). The expand window shows the assembled
// worldmap.png fit into the capped viewport, projecting with the
// manifest georeference formula.
//
// Markers: retail's native control owned all marker art/colours — the
// script exposes NONE (MinimapWnd.uc only passes world Vectors), so the
// markers here are AUTHORED: white heading arrow for self, yellow dots
// for players, grey dots for NPCs/monsters.
//
// Deliberately omitted (no backend in the web port — same pattern as the
// disabled SystemMenu rows): CursedComboBox/Pursuit (cursed-weapon
// tracker), OpenGuideWnd (guide), txtGameTime/texSun/texMoon (no game-
// clock op in the bridge), txtVarCurLoc (no zone-title op), btnReduce
// (only appears when zoomed past default; zoom is fixed). TargetButton
// renders disabled (quest-target backend absent). TownMapWnd is 100%
// server-driven (ShowTownMap) and RadarWnd is a separate always-on
// window — both skipped this round (docs §4).

import { Skin } from './skin.js';
import { Font } from './font.js';
import { Layout } from './layout.js';
import { L2Window } from './window.js';
import { L2_TO_M } from '../coords.js';

const WND = 'MinimapWnd';

let _meta = null;
/** The tracked minimap manifest (georeference, tiles, anchors). */
export function minimapMeta() {
  if (!_meta) {
    _meta = fetch('/gamedata/minimap.json')
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _meta;
}

export class MinimapWnd {
  constructor(parent = document.body) {
    const def = Layout.window(WND);
    this.w = def && def.width ? def.width : 334;
    this.h = def && def.height ? def.height : 413;
    this.meta = null;
    this.currentTile = null;    // '<tx>_<ty>' the composition centers on
    this.span = 0;              // world units per tile edge, from the manifest
    this.crop = 0;              // tile crop edge in image px, from the manifest
    this._lastTick = 0;
    this._dots = [];

    const win = new L2Window({
      title: 'Map', width: this.w, height: this.h, closable: true,
      back: 'none',   // MapBack goes on via its MEASURED content rect below
    });
    win.root.id = 'l2-minimapwnd';
    this.win = win;
    this.root = win.root;

    // MapBack frame: window texture from the xdat, painted through the
    // measured content rect (334x393 of art in a padded export)
    const back = document.createElement('div');
    back.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    Skin.apply(back, 'L2UI_CH3.Minimap.MapBack', { stretch: true });
    win.body.appendChild(back);

    // --- the map viewport (the xdat's native MinimapCtrl rect) ---
    const viewPos = Layout.pos(WND, 'Minimap') ?? { x: 3, y: 51 };
    const viewSize = Layout.size(WND, 'Minimap') || { w: 328, h: 328 };
    this.view = viewSize;
    const view = document.createElement('div');
    view.className = 'l2-minimap-view';
    view.style.cssText = 'position:absolute;overflow:hidden;'
      + `left:${Skin.px(viewPos.x)}px;top:${Skin.px(viewPos.y)}px;`
      + `width:${Skin.px(viewSize.w)}px;height:${Skin.px(viewSize.h)}px;`;
    win.body.appendChild(view);
    this.viewEl = view;

    this.mapLayer = document.createElement('div');   // tile crops
    this.mapLayer.style.cssText = 'position:absolute;left:0;top:0;';
    view.appendChild(this.mapLayer);
    this.markLayer = document.createElement('div');  // dots + self arrow
    this.markLayer.style.cssText = 'position:absolute;left:0;top:0;';
    view.appendChild(this.markLayer);

    // AUTHORED self marker: the native control's arrow art was never
    // exported; a CSS triangle stands in (white, dark outline via shadow)
    const arrow = document.createElement('div');
    arrow.className = 'l2-minimap-self';
    arrow.style.cssText = 'position:absolute;width:0;height:0;'
      + 'border-left:5px solid transparent;border-right:5px solid transparent;'
      + 'border-bottom:9px solid #ffffff;'
      + 'filter:drop-shadow(0 0 2px #000);transform-origin:50% 60%;';
    this.selfEl = arrow;

    // --- footer buttons at their mined rects ---
    // ExpandButton opens the world map (MinimapWnd_Expand).
    this._footerBtn('ExpandButton', 'Expand', () => this.showExpand(true));
    // TargetButton centers on the quest target — no quest backend, so it
    // renders disabled (same AUTHORED pattern as the SystemMenu rows).
    const t = this._footerBtn('TargetButton', 'Target', null);
    if (t) {
      t.style.opacity = '0.45';
      t.style.cursor = 'default';
      t.title = 'Quest target: no quest backend in the web port';
    }

    // --- the expand overlay (MinimapWnd_Expand) ---
    this._buildExpand(parent);

    parent.appendChild(win.root);
    // SOURCED dock: WindowsInfo.ini [MinimapWnd] posX=16 posY=63 — absolute
    // retail px at 1024x768 (Skin.px applies the uiScale; no proportional
    // rescale).
    this.defaultPlace = { left: 16, top: 63 };
  }

  _footerBtn(ctrlName, label, onClick) {
    const pos = Layout.pos(WND, ctrlName);
    const size = Layout.size(WND, ctrlName) || { w: 76, h: 23 };
    if (!pos) return null;
    const tex = Layout.tex(WND, ctrlName).filter(r => Skin.sprite(r));
    const b = document.createElement('div');
    b.className = 'l2-minimap-btn';
    b.dataset.id = ctrlName;
    b.style.cssText = `position:absolute;left:${Skin.px(pos.x)}px;`
      + `top:${Skin.px(pos.y)}px;width:${Skin.px(size.w)}px;`
      + `height:${Skin.px(size.h)}px;cursor:pointer;display:flex;`
      + 'align-items:center;justify-content:center;';
    if (tex[0]) Skin.apply(b, tex[0], { stretch: true });
    if (tex[1] && onClick) {
      b.addEventListener('mousedown', () => Skin.apply(b, tex[1], { stretch: true }));
      b.addEventListener('mouseup', () => Skin.apply(b, tex[0], { stretch: true }));
    }
    // AUTHORED English label (retail uses system strings, not extracted)
    Font.set(b, label, { color: '#c9a959' });
    if (onClick) b.addEventListener('click', onClick);
    this.win.body.appendChild(b);
    return b;
  }

  _buildExpand(parent) {
    const ov = document.createElement('div');
    ov.id = 'l2-minimap-expand';
    ov.style.cssText = 'position:fixed;inset:0;display:none;z-index:30;'
      + 'pointer-events:auto;background:rgba(0,0,0,0.35);';
    ov.addEventListener('click', (e) => {
      if (e.target === ov) this.showExpand(false);
    });
    parent.appendChild(ov);
    this.expandEl = ov;
  }

  async setMeta() {
    this.meta = await minimapMeta();
    if (this.meta) {
      const anyTile = Object.values(this.meta.tiles || {})[0];
      if (anyTile) {
        // world units per tile edge + crop edge in px — READ, not retyped
        this.span = anyTile.worldRect[2] - anyTile.worldRect[0];
        this.crop = anyTile.size[0];
      }
    }
    return this;
  }

  /** Tile name '<tx>_<ty>' for an L2 world point. The +20/+18 grid origin
   *  is SOURCED from the same validated formula main.js uses for scene
   *  tiles (tile-map.json: 17_24 -> origin [-98304, 196608]). */
  tileOf(x, y) {
    return `${20 + Math.floor(x / this.span)}_${18 + Math.floor(y / this.span)}`;
  }

  /** Composition px for a world point, current tile at the CENTER of the
   *  3x3 neighbourhood (hence the +crop: the center tile's origin sits at
   *  (crop, crop) in composition space). Each crop covers exactly its
   *  tile's world rect (docs §3), so the projection is linear. */
  projectTile(x, y) {
    const [tx0, ty0] = this.currentTile.split('_').map(Number);
    return {
      x: (x / this.span - (tx0 - 20) + 1) * this.crop,
      y: (y / this.span - (ty0 - 18) + 1) * this.crop,
    };
  }

  /** Worldmap px via the manifest georeference (the verified formula —
   *  constants read from minimap.json, never retyped). */
  projectWorld(x, y) {
    const g = this.meta.worldmap.georeference;
    return { x: (x - g.X0) / g.S, y: (y - g.Y0) / g.S };
  }

  /** Rebuild the 3x3 tile crops around `tileName` (missing neighbours
   *  degrade to the dark frame — off-map tiles are not staged). */
  _rebuildTiles(tileName) {
    this.currentTile = tileName;
    this.mapLayer.replaceChildren();
    const [tx0, ty0] = tileName.split('_').map(Number);
    for (let dty = -1; dty <= 1; dty++) {
      for (let dtx = -1; dtx <= 1; dtx++) {
        const name = `${tx0 + dtx}_${ty0 + dty}`;
        const entry = this.meta.tiles[name];
        if (!entry) continue;
        const img = document.createElement('img');
        img.className = 'l2-minimap-tile';
        img.dataset.tile = name;
        img.src = `/minimap/${entry.file}`;
        img.style.cssText = `position:absolute;`
          + `left:${Skin.px((dtx + 1) * this.crop)}px;`
          + `top:${Skin.px((dty + 1) * this.crop)}px;`
          + `width:${Skin.px(this.crop)}px;height:${Skin.px(this.crop)}px;`;
        img.draggable = false;
        img.addEventListener('error', () => img.remove());
        this.mapLayer.appendChild(img);
      }
    }
  }

  _dot(color) {
    // AUTHORED 4px round marker (no retail marker art was exported)
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;width:${Skin.px(4)}px;`
      + `height:${Skin.px(4)}px;border-radius:50%;background:${color};`
      + 'box-shadow:0 0 2px #000;';
    return d;
  }

  /** Per-frame hook from the main loop. Throttled: 10 Hz is an AUTHORED
   *  refresh for a map (retail re-centers on tick; the interval is native
   *  and unknown). Tile swaps rebuild immediately. */
  tick(character, entities) {
    if (!this.visible || !this.meta || !this.span || !character) return;
    const now = performance.now();
    const l2x = character.group.position.x / L2_TO_M;   // coords.js L2_TO_M
    const l2y = -character.group.position.z / L2_TO_M;
    const tile = this.tileOf(l2x, l2y);
    if (tile !== this.currentTile) this._rebuildTiles(tile);
    if (now - this._lastTick < 100) return;   // AUTHORED throttle (above)
    this._lastTick = now;

    const p = this.projectTile(l2x, l2y);
    // remember the frame for the expand overlay's static markers
    this._lastSelf = { x: l2x, y: l2y, yaw: character.group.rotation.y };
    this._lastEnts = entities.snapshot();
    // pan so the player sits at the viewport center
    const ox = this.view.w / 2 - p.x;
    const oy = this.view.h / 2 - p.y;
    for (const layer of [this.mapLayer, this.markLayer]) {
      layer.style.left = `${Skin.px(ox)}px`;
      layer.style.top = `${Skin.px(oy)}px`;
    }

    // entity dots (players vs NPCs — AUTHORED colours, see header)
    this.markLayer.replaceChildren();
    this._dots = [];
    for (const e of this._lastEnts) {
      const ex = e.pos[0] / L2_TO_M;
      const ey = -e.pos[2] / L2_TO_M;
      const ep = this.projectTile(ex, ey);
      const dot = this._dot(e.kind === 'player' ? '#ffd24a' : '#d8d8d8');
      dot.style.left = `${Skin.px(ep.x - 2)}px`;
      dot.style.top = `${Skin.px(ep.y - 2)}px`;
      dot.title = e.name || '';
      dot.dataset.entId = e.id;
      this.markLayer.appendChild(dot);
      this._dots.push(dot);
    }

    // self arrow: CSS rotate(yaw) — three yaw 0 faces +Z_three = -Y_L2
    // (coords.js), which is map-up; rotation stays identical in map space
    this.selfEl.style.left = `${Skin.px(p.x - 5)}px`;
    this.selfEl.style.top = `${Skin.px(p.y - 6)}px`;
    this.selfEl.style.transform = `rotate(${character.group.rotation.y}rad)`;
    this.markLayer.appendChild(this.selfEl);
  }

  // --- MinimapWnd_Expand -------------------------------------------------

  showExpand(on) {
    const ov = this.expandEl;
    if (!on) {
      ov.style.display = 'none';
      // restore the small window the expand hid (only if it hid it)
      if (this._expandHidSelf) {
        this._expandHidSelf = false;
        this.win.show();
      }
      return;
    }
    if (!this.meta || !this.meta.worldmap) return;
    ov.replaceChildren();

    // MinimapWnd_Expand: map sized (screenW - 3%) x (screenH - 90), capped
    // 1016x934 (N_MAX_MINI_MAP_RES buffer, docs §4). Css px here — the
    // xdat's autosize is screen-relative, not retail-px.
    const cap = { w: 1016, h: 934 };
    const vw = Math.min(cap.w, Math.floor(window.innerWidth * 0.97));
    const vh = Math.min(cap.h, window.innerHeight - 90);
    const [iw, ih] = this.meta.worldmap.size;
    const fit = Math.min(vw / iw, vh / ih);
    const mw = Math.floor(iw * fit), mh = Math.floor(ih * fit);

    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:50%;top:50%;'
      + `width:${mw}px;height:${mh}px;transform:translate(-50%,-50%);`;
    Skin.nine(box, 'L2UI_CH3.Minimap.MapWnd_back_max', 2);
    ov.appendChild(box);

    const img = document.createElement('img');
    img.src = `/minimap/${this.meta.worldmap.file}`;
    img.style.cssText = `position:absolute;left:0;top:0;`
      + `width:${mw}px;height:${mh}px;`;
    img.draggable = false;
    box.appendChild(img);

    // markers through the verified georeference, scaled to the fit (from
    // the last tick frame — the overlay is a static snapshot)
    if (this._lastSelf) {
      const p = this.projectWorld(this._lastSelf.x, this._lastSelf.y);
      const self = document.createElement('div');
      self.style.cssText = this.selfEl.style.cssText;
      self.style.left = `${p.x * fit - 5}px`;
      self.style.top = `${p.y * fit - 6}px`;
      self.style.transform = `rotate(${this._lastSelf.yaw}rad)`;
      box.appendChild(self);
    }
    for (const e of this._lastEnts || []) {
      const p = this.projectWorld(e.pos[0] / L2_TO_M, -e.pos[2] / L2_TO_M);
      const dot = this._dot(e.kind === 'player' ? '#ffd24a' : '#d8d8d8');
      dot.style.left = `${p.x * fit - 2}px`;
      dot.style.top = `${p.y * fit - 2}px`;
      box.appendChild(dot);
    }

    // same button art/label idiom as the footer (AUTHORED 'Collapse' —
    // retail's label is a system string, not extracted)
    const close = document.createElement('div');
    close.className = 'l2-minimap-btn';
    close.style.cssText = 'position:absolute;right:8px;bottom:8px;'
      + `width:${Skin.px(76)}px;height:${Skin.px(23)}px;cursor:pointer;`
      + 'display:flex;align-items:center;justify-content:center;';
    Skin.apply(close, 'L2UI_CH3.Button.Btn1_Normal', { stretch: true });
    Font.set(close, 'Collapse', { color: '#c9a959' });   // AUTHORED label
    close.addEventListener('click', () => this.showExpand(false));
    box.appendChild(close);

    // close X, top-right: AUTHORED affordance (MinimapWnd_Expand carries
    // no chrome) reusing the shared frame art; the 4px inset matches the
    // window frame's close inset (window.js — its SIZE is measured from
    // the art, only the gap is ours)
    const xBtn = document.createElement('div');
    xBtn.className = 'l2-expand-close';
    const xArt = Skin.content('L2UI_CH3.FrameCtrl.FrameCloseBtn');
    xBtn.style.cssText = `position:absolute;right:${Skin.px(4)}px;`
      + `top:${Skin.px(4)}px;width:${Skin.px(xArt ? xArt.w : 15)}px;`
      + `height:${Skin.px(xArt ? xArt.h : 15)}px;cursor:pointer;`;
    Skin.apply(xBtn, 'L2UI_CH3.FrameCtrl.FrameCloseBtn');
    xBtn.addEventListener('mouseenter',
      () => Skin.apply(xBtn, 'L2UI_CH3.FrameCtrl.FrameCloseOnBtn'));
    xBtn.addEventListener('mouseleave',
      () => Skin.apply(xBtn, 'L2UI_CH3.FrameCtrl.FrameCloseBtn'));
    xBtn.addEventListener('click', () => this.showExpand(false));
    box.appendChild(xBtn);

    // the small map hides while the world map is up (restored on close)
    this._expandHidSelf = true;
    this.win.hide();

    ov.style.display = 'block';
  }

  place(o = {}) { this.win.place(o); return this; }
  show() { this.win.show(); return this; }
  // collapse the expand overlay FIRST: closing it restores the small
  // window it hid, and a hide() must end with the window hidden
  hide() { this.showExpand(false); this.win.hide(); return this; }
  get visible() { return this.win.visible; }
  toggle(force) { this.win.toggle(force); return this; }

  onDefaultPosition() {
    this.place(this.defaultPlace);
  }
}
