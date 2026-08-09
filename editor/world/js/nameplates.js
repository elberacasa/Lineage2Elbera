// Overhead nameplates — the SCREEN-SPACE layer retail actually draws.
//
// WHAT THE CLIENT DOES, and how that was established
// --------------------------------------------------
// The name over a pawn is not a world object in Interlude. Engine.dll exports
//
//   ?DrawTargetName@UCanvas@@UAEXPAVFLevelSceneNode@@PAVFRenderInterface@@
//        VFVector@@KPAUUser@@W4TargetRenderType@@W4L2FontType@@K@Z
//   ?DrawTargetOptionName@UCanvas@@UAEXPAVFLevelSceneNode@@PAVFRenderInterface@@
//        VFVector@@KPAUUser@@W4TargetRenderType@@W4L2FontType@@@Z
//
// (read off Engine.dll's own export directory — RVA 0x1c5ef9d, 10,083 names;
// `tools/ui/mine_nameplate.py --check` re-reads them). Three facts follow from
// those signatures alone, without executing anything:
//
//   * it is a **UCanvas** method. UCanvas is UE2's 2D screen-space drawing
//     context; its sibling on the same class is
//     `?DrawNormalText@UCanvas@@UAEKHHK PBG ... W4L2FontType@@ ...@Z`, whose
//     first two arguments are `int, int` — integer SCREEN pixels.
//   * the world position enters as ONE `FVector` (the anchor to project), and
//   * the only size-ish argument is `L2FontType`, a font SELECTOR. There is no
//     scale, no extent, no distance-dependent term anywhere in the signature.
//
// So a retail nameplate is: project one world point, then blit a bitmap-font
// string at a fixed pixel size. `Engine/Canvas.uc:68  var font m_L2Font[3];`
// is the script-side view of the same three fonts.
//
// That kills the model this port used until 2026-08: labels.js built a
// world-space THREE.Sprite scaled by `0.0055 * worldScale`, so a name grew as
// the camera approached and a single Adena two metres away wrote
// "Adena (46)" across a third of the frame.
//
// WHAT COULD NOT BE DECODED  (documented gap, not a guess)
// --------------------------------------------------------
// The BODY of DrawTargetName is unreadable. Engine.dll is Themida-packed: it
// carries a section literally named `Themida`, objdump flags all four sections
// DATA and emits ZERO instructions for the whole file (the same objdump reads
// NWindow.dll's .text normally, 27 instructions over one known paint), and all
// 10,083 exports resolve into a 45 KB stub window at 0x10302b0d-0x1030da94
// rather than into a 26 MB code section. NWindow.dll — which IS plain PE32 and
// is where every other native constant in this port came from — does not
// import these symbols, so there is no second call site to read. Every one of
// those measurements is re-run by `tools/ui/mine_nameplate.py --check`.
// Consequently:
//
//   * WHICH of the three L2FontType values a nameplate uses is UNKNOWN.
//   * The Alt gate on ground-item names is UNKNOWN: it is not in Interface.u,
//     NWindow.u, Engine.u, GamePlay.u, l2.ini, user.ini, Option.ini,
//     Interface.xdat, sysstring-e.dat, systemmsg-e.dat or gametip-e.dat.
//     (All searched; the only "Alt+" strings in the client name WINDOWS —
//     Alt+X, Alt+T, Alt+V ... — never item names.)
//
// Both are marked AUTHORED at their sites below with that reason.
//
// WHAT IS SOURCED
// ---------------
//   draw distance   assets/interlude/system/l2.ini (Lineage2Ver413, decoded
//                   with tools/bin/l2encdec) — `[CharacterDisplay] Name=true
//                   Dist=1000`. The client's own shipped config carries a
//                   section whose two keys are exactly "should names draw"
//                   and "out to what distance". Units are L2 world units, the
//                   only unit any other number in that file uses.
//   the six name
//   category gates  Option.ini [Game] MyName / NPCName / GroupName /
//                   PledgeMemberName / PartyMemberName / OtherPCName, bound to
//                   OptionWnd.NameBox0..5 in
//                   assets/uscript/Interface/OptionWnd.uc:579-614.
//   the drop-name
//   gate            Option.ini [Game] HideDropItem, bound to
//                   OptionWnd.DropItemBox in OptionWnd.uc:675 / 1132.
//   the glyphs      SmallFont-e / LargeFont-e via ui/font.js — the client's
//                   own bitmap sheets, not a browser font.
//   name colour     #DCDCDC, decoded — see NAME_COLOR below.
//   title colour    npcname.dat nickcolor — see entities.js titleFor().
//
// THE COLOUR RULE, and the bug it replaces  (2026-08)
// ---------------------------------------------------
// The owner reported "names on top of npcs in retail arent red". They were
// red here because this module ran EVERY npc nameplate through the conColor
// ladder — the seven-rung level-difference tint from
// ?execGetTargetNameColor@UUIDATA_TARGET@@ — whose first rung is #FF0000 for
// anything 9+ levels above the viewer. That ladder is real and correctly
// decoded. It is simply not what paints a floating name.
//
// The decisive measurement: GetTargetNameColor has EXACTLY ONE call site in
// all 229 decompiled uscript files (assets/uscript/{Interface,NWindow}) —
//
//     Interface/TargetStatusWnd.uc:193
//         TargetNameColor = class'UIDATA_TARGET'.static
//                           .GetTargetNameColor(m_TargetLevel);
//     Interface/TargetStatusWnd.uc:266
//         class'UIAPI_NAMECTRL'.static.SetNameWithColor(
//             "TargetStatusWnd.UserName", Name, NCT_Normal, TA_Center,
//             TargetNameColor);
//
// — the TARGET WINDOW's name control. Never a nameplate. `grep -rn
// GetTargetNameColor assets/uscript` returns those two lines and nothing
// else; verify_nameplate_color.js re-runs that grep so the claim cannot rot.
//
// It is narrower still even inside that window. TargetStatusWnd.uc:245-266
// reaches SetNameWithColor only for
//     (bNpc && !bPet && bCanBeAttacked) || self || own pet || IsHPShowableNPC
// and NOT IsAllWhiteID(classID) (:617-635, seven event ids). Every other
// target — non-attackable NPCs (traders, gatekeepers, guards), other PCs
// (:293), static objects (:205) — takes plain SetName, i.e. the default.
//
// So: no floating name is con-tinted, and even the target window leaves
// merchants and other players at the default colour.

// The client's declared name colour. DECODED, two independent sites, both in
// NWindow.dll (plain PE32; file offset == RVA, asserted by the checker):
//
//   0x10130058  ?execSetName@UNameCtrlHandle@@   68 dc dc dc ff  push 0xffdcdcdc
//   0x10118eb3  ?execSetName@UUIAPI_NAMECTRL@@   68 dc dc dc ff  push 0xffdcdcdc
//
// Both push it as the colour argument to the same shared setter
// (call dword ptr [0x1022c3e4]) that execSetNameWithColor feeds with the
// script-supplied colour instead. In other words: this is literally the value
// the client uses when script does not name a colour, which is the majority
// of every name it draws. AARRGGBB 0xFFDCDCDC -> opaque #DCDCDC.
//
// Cross-checks that it is the client's text default rather than a one-off:
// native_colors.json already carries #DCDCDC twice from unrelated sites —
// `textBoxDefault` (0x10052aca) and `itemSlotCount` — and it is also the
// conColor ladder's own centre rung (maxDiff 2), i.e. the colour retail shows
// for a same-level target.
//
// HONEST LIMIT: this is the NCNameCtrl/UIAPI_NAMECTRL default, and a floating
// plate is drawn by UCanvas::DrawTargetName, not by a NameCtrl. Applying it to
// the plate is an INFERENCE from a decoded value — flagged as such — not a
// second measurement. It is the only name colour this client declares
// anywhere, and the alternative in the tree was a ladder proven to belong to a
// different widget.
export const NAME_COLOR = '#dcdcdc';

// WHAT COULD NOT BE SOURCED — the per-class floating-name tint.
// -------------------------------------------------------------
// Retail does distinguish PK / flagged / clan / party / GM players by name
// colour. That choice is made by the caller of
//   ?DrawTargetName@UCanvas@@...VFVector@@ K PAUUser@@ W4TargetRenderType@@
//                                          ^ the colour DWORD
// (the argument after the FVector anchor is the colour: the sibling
// ?Draw3DCoordText@UCanvas@@ has the same FVector,K,<text> shape, and
// ?DrawNormalText@UCanvas@@UAEKHHK<text> passes int X, int Y, colour). The
// per-User getters that would supply it — ?GetNameColor@User@@QAEK_N@Z and
// ?GetNickColor@User@@QAEKXZ — are exported by engine.dll, which is
// Themida-packed: objdump -h reports all four sections DATA plus a section
// named `Themida`, and objdump -d emits zero instructions for the whole 30 MB
// file. NWindow.dll does not import either symbol, so there is no second call
// site. TargetRenderType's enum members are not in any .u or .dll string
// table either, so even the LIST of classes the engine distinguishes is not
// recoverable here.
//
// Therefore these classes are drawn at NAME_COLOR and are listed as UNSOURCED
// rather than guessed: PK players, flagged/PvP players, clan members, party
// members, GMs, and ground-drop names. Nothing in this repo may invent a hex
// for them.
//
// This module owns no policy of its own: labels.js decides what a plate says
// and this one decides where on screen it lands.

import { Font } from './ui/font.js';
import { L2_TO_M } from './coords.js';

// SOURCED l2.ini [CharacterDisplay] Dist=1000 — L2 world units. Measured from
// the PLAYER, not the camera: the section is named CharacterDisplay and its
// companion key is the name toggle, so the distance is the one between the
// character and what it is looking at. Converted through the port's single
// world-scale constant so it tracks any future scale correction.
export const NAME_DIST_L2 = 1000;
const NAME_DIST_M = NAME_DIST_L2 * L2_TO_M;

// AUTHORED font choice. DrawTargetName takes an L2FontType and the call site
// is inside the encrypted engine.dll (see the header), so which of the three
// fonts it passes cannot be read. 'small' is the client's 13px body face and
// the one ui/font.js already ships tuned; 'large' would be legible too. This
// is the single undecoded number in the plate's geometry, and it is a FONT
// NAME rather than a pixel count precisely so no pixel gets invented.
export const PLATE_FONT = 'small';

// SOURCED Option.ini [Game], the six name checkboxes plus the drop one, at the
// values the client ships. OptionWnd.uc:579-614 and :675 bind each of these to
// a checkbox; `GroupName` is the master that enables the other three PC rows.
export const options = {
  MyName: true,
  NPCName: true,
  GroupName: true,
  PledgeMemberName: true,
  PartyMemberName: true,
  OtherPCName: true,
  HideDropItem: false,
};

// AUTHORED gate. Retail shows ground-item names while Alt is held; that
// behaviour is not recoverable from any file this client ships (see header),
// so it is implemented as a HOLD — press and release, no toggle — and flagged
// here rather than presented as decoded. Everything else about a drop plate
// (its text, its font, its distance cut) is sourced.
let _alt = false;

const plates = new Map();       // anchor Object3D -> {el, key, orphan}
const anchors = new Set();
let _container = null;
let _running = false;

function container() {
  if (_container && _container.isConnected) return _container;
  let el = document.getElementById('nameplates');
  if (!el) {
    el = document.createElement('div');
    el.id = 'nameplates';
    // Same layer as #overlays (style.css:113) so plates sit with the HP bars,
    // over the 3D canvas and under every retail window.
    el.style.cssText = 'position:fixed;inset:0;z-index:11;pointer-events:none;';
    document.body.appendChild(el);
  }
  _container = el;
  return el;
}

/** The nearest ancestor (or self) that an EntityManager tagged, plus the
 *  entity record itself when the manager still holds it. */
function ownerOf(anchor) {
  const w = typeof window !== 'undefined' && window.__world;
  let n = anchor;
  while (n) {
    const id = n.userData && n.userData.entityId;
    if (id != null) {
      const mgr = w && w.entities;
      const e = mgr && mgr.entities ? mgr.entities.get(id) : null;
      return { id, entity: e || null };
    }
    n = n.parent;
  }
  return { id: null, entity: null };
}

/** Root of the anchor's chain — used to notice a detached entity. */
function rootOf(anchor) {
  let n = anchor;
  while (n.parent) n = n.parent;
  return n;
}

function chainVisible(anchor) {
  let n = anchor;
  while (n) {
    if (n.visible === false) return false;
    n = n.parent;
  }
  return true;
}

/** Which Option.ini gate governs this plate. Party/pledge membership is not
 *  bridged, so a remote PC falls to OtherPCName — the row retail also uses for
 *  a stranger. GroupName is the master switch OptionWnd.uc enforces. */
function gateFor(kind) {
  if (kind === 'drop') return !options.HideDropItem;
  if (kind === 'npc') return options.NPCName;
  if (kind === 'player') return options.GroupName && options.OtherPCName;
  return true;
}

/** Colour of the NAME line.
 *
 *  There is no per-class branch here on purpose, and removing the one that
 *  used to be here is this wave's fix. See the header: the conColor ladder
 *  belongs to TargetStatusWnd's name control, and every other selection the
 *  engine makes is inside Themida-packed code. NAME_COLOR is the only name
 *  colour this client declares, so it is the only one drawn.
 *
 *  `spec.color` is honoured when a caller genuinely has a decoded colour for
 *  that entity; entities.js passes NAME_COLOR for all four classes today.
 */
function colourFor(spec) {
  return spec.color || NAME_COLOR;
}

function plateFor(anchor) {
  let p = plates.get(anchor);
  if (!p) {
    const el = document.createElement('div');
    el.className = 'nameplate';
    // No plate, no padding, no border-radius: the retail name is bare text
    // over the scene. The glyph sheets carry their own dark outline
    // (ui/font.js tintedSheet), which is what makes it readable.
    // line-height:0 / font-size:0 so the box is EXACTLY the glyph canvas: an
    // inline box would add the browser's own leading and the plate would no
    // longer measure the retail text height.
    el.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap;'
      + 'pointer-events:none;will-change:transform;line-height:0;font-size:0;'
      // The title stacks UNDER the name and both centre on the anchor, so the
      // plate is a two-row column. text-align keeps a short title centred
      // beneath a long name.
      + 'display:flex;flex-direction:column;align-items:center;';
    const nameEl = document.createElement('div');
    nameEl.className = 'nameplate-name';
    nameEl.style.cssText = 'line-height:0;font-size:0;';
    const titleEl = document.createElement('div');
    titleEl.className = 'nameplate-title';
    titleEl.style.cssText = 'line-height:0;font-size:0;display:none;';
    el.appendChild(nameEl);
    el.appendChild(titleEl);
    container().appendChild(el);
    p = { el, nameEl, titleEl, key: null, orphan: 0 };
    plates.set(anchor, p);
  }
  return p;
}

function drop(anchor) {
  const p = plates.get(anchor);
  if (p) { p.el.remove(); plates.delete(anchor); }
  anchors.delete(anchor);
}

const _v = { x: 0, y: 0, z: 0 };

/** One pass: project every live anchor and lay its plate over the scene. */
function update() {
  const w = typeof window !== 'undefined' && window.__world;
  if (!w || !w.camera || !w.renderer) return;
  const cam = w.camera;
  const canvas = w.renderer.domElement;
  const cw = canvas.clientWidth, chh = canvas.clientHeight;

  // The viewer for the distance cut: the player's own model when there is
  // one, the camera otherwise (free-fly / pre-spawn).
  const self = w.character && w.character.group ? w.character.group.position : null;
  const from = self || cam.position;

  for (const anchor of [...anchors]) {
    const spec = anchor.userData && anchor.userData.nameplate;
    if (!spec) { drop(anchor); continue; }
    // setLabel() detaches the old anchor from its group: that is the retire
    // signal and it is immediate.
    if (!anchor.parent) { drop(anchor); continue; }

    const p = plateFor(anchor);
    // An entity whose group left the scene is gone, but a freshly built one
    // is legitimately unparented for the rest of its constructor — so a plate
    // is only retired after the chain has failed to reach the scene twice.
    if (rootOf(anchor) !== w.scene) {
      p.el.style.display = 'none';
      if (++p.orphan > 1) drop(anchor);
      continue;
    }
    p.orphan = 0;
    const { entity } = ownerOf(anchor);
    const kind = (entity && entity.kind) || spec.kind || null;

    let show = chainVisible(anchor) && gateFor(kind);
    if (show && kind === 'drop' && !_alt) show = false;

    anchor.updateWorldMatrix(true, false);
    const m = anchor.matrixWorld.elements;
    const wx = m[12], wy = m[13], wz = m[14];

    if (show) {
      const dx = wx - from.x, dy = wy - from.y, dz = wz - from.z;
      if (dx * dx + dy * dy + dz * dz > NAME_DIST_M * NAME_DIST_M) show = false;
    }

    if (show) {
      _v.x = wx; _v.y = wy; _v.z = wz;
      const q = project(_v, cam, cw, chh);
      if (!q) show = false;
      else {
        const color = colourFor(spec);
        // The TITLE line: npcname.dat's `nick`, in that row's nickcolor.
        // Retail draws it under the name (?DrawTargetOptionName@UCanvas@@ is
        // the sibling entry point, same FVector anchor, same font selector).
        const title = spec.title || '';
        const tcolor = spec.titleColor || color;
        const key = `${spec.text}|${color}|${title}|${tcolor}`;
        if (p.key !== key && Font.ready) {
          Font.set(p.nameEl, spec.text, { font: PLATE_FONT, color });
          if (title) {
            Font.set(p.titleEl, title, { font: PLATE_FONT, color: tcolor });
            p.titleEl.style.display = 'block';
          } else {
            p.titleEl.style.display = 'none';
          }
          // Font.set stamps its cache key on the element it writes, which is
          // now the inner .nameplate-name row. Mirror the plate's identity
          // back onto the OUTER element: `.nameplate.__l2text` is the handle
          // verify_nameplates.js uses to tell one plate from another, and
          // moving the text into a child silently emptied it (that suite's
          // fixed-size / Alt / draw-distance gates all went to "0 plates").
          p.el.__l2text = p.nameEl.__l2text;
          p.key = key;
        }
        // Centre on the anchor, sitting just above it: the same anchoring the
        // sprite used (center 0.5, bottom), now in screen space where it
        // cannot change size.
        p.el.style.transform =
          `translate(${Math.round(q.x)}px, ${Math.round(q.y)}px) translate(-50%, -100%)`;
      }
    }
    p.el.style.display = show ? 'block' : 'none';
  }
}

function project(v, cam, cw, ch) {
  // three's Vector3.project without allocating: world -> NDC -> pixels.
  const e = cam.matrixWorldInverse.elements, pm = cam.projectionMatrix.elements;
  const x = v.x, y = v.y, z = v.z;
  const vx = e[0] * x + e[4] * y + e[8] * z + e[12];
  const vy = e[1] * x + e[5] * y + e[9] * z + e[13];
  const vz = e[2] * x + e[6] * y + e[10] * z + e[14];
  const cwp = pm[3] * vx + pm[7] * vy + pm[11] * vz + pm[15];
  if (cwp === 0) return null;
  const ndcx = (pm[0] * vx + pm[4] * vy + pm[8] * vz + pm[12]) / cwp;
  const ndcy = (pm[1] * vx + pm[5] * vy + pm[9] * vz + pm[13]) / cwp;
  const ndcz = (pm[2] * vx + pm[6] * vy + pm[10] * vz + pm[14]) / cwp;
  if (ndcz > 1 || ndcz < -1) return null;      // behind the eye / past far
  return { x: (ndcx + 1) / 2 * cw, y: (-ndcy + 1) / 2 * ch };
}

function loop() {
  if (!_running) return;
  try { update(); } catch (e) { /* one bad frame must not stop the layer */ }
  requestAnimationFrame(loop);
}

function bindAlt() {
  if (typeof window === 'undefined') return;
  const sync = (e) => { _alt = !!e.altKey; };
  // keydown/keyup carry altKey for every key, so the flag stays right even if
  // the Alt press itself is swallowed by the browser's menu handling.
  window.addEventListener('keydown', sync, true);
  window.addEventListener('keyup', sync, true);
  window.addEventListener('blur', () => { _alt = false; });
}

export const Nameplates = {
  /** Add an anchor. `anchor.userData.nameplate` must hold {text, color}. */
  register(anchor) {
    anchors.add(anchor);
    if (!_running && typeof requestAnimationFrame === 'function') {
      _running = true;
      bindAlt();
      requestAnimationFrame(loop);
    }
  },
  unregister(anchor) { drop(anchor); },

  // -- verification surface ------------------------------------------------
  get altHeld() { return _alt; },
  set altHeld(v) { _alt = !!v; },
  get count() { return anchors.size; },
  get shown() {
    let n = 0;
    for (const p of plates.values()) if (p.el.style.display !== 'none') n++;
    return n;
  },
  options,
  distL2: NAME_DIST_L2,
  distM: NAME_DIST_M,
  font: PLATE_FONT,
  nameColor: NAME_COLOR,

  /** Per-plate colour report, for verify_nameplate_color.js.
   *
   *  Reads the colour the layer RESOLVED for each live anchor — not the one
   *  entities.js asked for — so a ladder creeping back into colourFor() would
   *  show up here even if the caller still passed NAME_COLOR.
   */
  probe() {
    const out = [];
    for (const anchor of anchors) {
      const spec = anchor.userData && anchor.userData.nameplate;
      if (!spec) continue;
      const p = plates.get(anchor);
      const { entity } = ownerOf(anchor);
      out.push({
        kind: (entity && entity.kind) || spec.kind || null,
        name: spec.text,
        color: colourFor(spec),
        title: spec.title || null,
        titleColor: spec.titleColor || null,
        level: (entity && entity.level) ?? null,
        npcId: (entity && entity.npcId) ?? null,
        shown: !!(p && p.el.style.display !== 'none'),
      });
    }
    return out;
  },
  /** Run one projection pass now (tests should not race the rAF loop). */
  tick() { update(); },
};

if (typeof window !== 'undefined') window.__nameplates = Nameplates;
