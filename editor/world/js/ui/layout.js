// ElberaSkin runtime — the retail widget tree, as decoded from Interface.xdat.
//
// tools/xdat/parse_xdat.py turns the client's own UI definition into
// assets/gamedata/interface.json: 137 windows, 1,962 controls, their sizes
// and the texture each one paints with. This module is the client's read
// side of that file.
//
// Use it so window geometry is never typed by hand:
//
//   const w = Layout.window('StatusWnd');        // {width:176, height:84,...}
//   Layout.find('StatusWnd', 'HPBar');           // the control node
//   Layout.tex('StatusWnd', 'HPBar');            // its texture refs
//
// A missing lookup returns null and is the caller's cue to degrade, not to
// substitute an invented number.

const SRC = '/gamedata/interface.json';
// Rects measured out of the shipped background art by tools/ui/mine_invslots.py
// (tier 3) and cross-checked against the xdat anchors it does have. Needed
// because parse_xdat.py recovers only 1 of InventoryWnd's 15 EquipItem_*
// records; see that tool's docstring.
const WELLS = '/ui/invslots.json';
// ShortcutWnd's background placement, measured out of shortcut_back /
// shortcut_backv by tools/ui/mine_shortcutslots.py and reconciled against the
// xdat's own twelve slot records. Needed because the xdat says where the SLOTS
// are but not where the ART goes, and the art is 492px inside a 504px window.
const SHORTCUT = '/ui/shortcutslots.json';

let _doc = null;
let _wells = null;
let _shortcut = null;
const _index = new Map();       // 'Window/Control' -> node (FLAT, see below)
const _pathIndex = new Map();   // 'Window/Sub/.../Control' -> node (full path)

// The xdat reuses control names across sub-windows (ShortcutWnd declares
// PrevBtn per orientation AND per joypad variant; ChatWindow has 5 panes).
// The FLAT index keeps only the LAST record for a bare name — documented
// last-wins, kept for backward compatibility. The path index keeps every
// record: find()/pos()/size()/tex()/grid() accept a slash path
// ('ShortcutWndHorizontal/PrevBtn') to reach a specific one.
function indexTree(winName, node, path) {
  _index.set(`${winName}/${node.name}`, node);      // last wins
  _pathIndex.set(`${winName}/${path}`, node);       // every record
  for (const c of node.children || []) indexTree(winName, c, `${path}/${c.name}`);
}

export const Layout = {
  async load() {
    if (_doc) return Layout;
    _wells = await fetch(WELLS).then(r => (r.ok ? r.json() : null)).catch(() => null);
    _shortcut = await fetch(SHORTCUT).then(r => (r.ok ? r.json() : null)).catch(() => null);
    _doc = await fetch(SRC).then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (!_doc) { _doc = { windows: [], textures: {} }; return Layout; }
    for (const w of _doc.windows) {
      _index.set(`${w.name}/`, w);
      _pathIndex.set(`${w.name}/`, w);
      for (const c of w.children || []) indexTree(w.name, c, c.name);
    }
    return Layout;
  },

  get ready() { return _doc !== null; },

  get windowNames() { return (_doc ? _doc.windows : []).map(w => w.name); },

  window(name) {
    return (_doc ? _doc.windows : []).find(w => w.name === name) || null;
  },

  /** A control anywhere inside `winName`. A bare name uses the flat
   *  last-wins index; a slash path ('SubWindow/Control') is exact. */
  find(winName, ctrlName) {
    if (ctrlName && ctrlName.includes('/')) {
      return _pathIndex.get(`${winName}/${ctrlName}`) || null;
    }
    return _index.get(`${winName}/${ctrlName}`) || null;
  },

  /** {w, h} in retail pixels, or null when the xdat left the size implicit
   *  (hasSize == 0 — the client computes those at runtime). */
  size(winName, ctrlName) {
    const n = ctrlName ? Layout.find(winName, ctrlName) : Layout.window(winName);
    if (!n || n.width == null || n.height == null) return null;
    return { w: n.width, h: n.height };
  },

  /** {x, y} in retail pixels, parent-relative (negative = far-edge
   *  anchored, docs/ui-mined-values.md §1), or null when the record's
   *  coordinates failed the decode acceptance test (never guessed). */
  pos(winName, ctrlName) {
    const n = ctrlName ? Layout.find(winName, ctrlName) : Layout.window(winName);
    if (!n || n.x == null || n.y == null) return null;
    return { x: n.x, y: n.y };
  },

  /** ItemWindow grid params (docs/ui-mined-native.md §1b): {rows,
   *  capacity, cellX, cellY, gapX, gapY} in retail pixels — the pitch is
   *  cell + gap (37x35 for every standard grid). Null when the record
   *  carries no grid block. */
  grid(winName, ctrlName) {
    const n = ctrlName ? Layout.find(winName, ctrlName) : Layout.window(winName);
    return (n && n.grid) || null;
  },

  /** hasSize==0 auto-size block (docs/xdat-tail-has0.md): {autosize:
   *  [f1, f2], insets: [A, B]} or null. Width rule when f1 != 0:
   *  width = parent.width + A; height rule likewise for f2/B. */
  autosize(winName, ctrlName) {
    const n = ctrlName ? Layout.find(winName, ctrlName) : Layout.window(winName);
    if (!n || !n.autosize) return null;
    return { autosize: n.autosize, insets: n.insets };
  },

  /** Ordered texture references a control paints with (normal, then the
   *  pressed/alternate states the client swaps in). */
  tex(winName, ctrlName) {
    const n = ctrlName ? Layout.find(winName, ctrlName) : Layout.window(winName);
    return (n && n.textures) || [];
  },

  /** First texture reference, the one drawn in the resting state. */
  tex0(winName, ctrlName) {
    return Layout.tex(winName, ctrlName)[0] || null;
  },

  /** Slot wells measured out of a window's own background art, in BODY
   *  pixels (see tools/ui/mine_invslots.py). Null when that window has no
   *  harvest — the caller's cue to degrade, never to substitute a number. */
  wells(winName) {
    return (_wells && _wells.window === winName) ? _wells : null;
  },

  /** ShortcutWnd art placement for one orientation sub-window, measured by
   *  tools/ui/mine_shortcutslots.py: {texture, artWidth/Height,
   *  artOffsetX/Y, slotOrigins[12], slotShort, slot, well, wellInset,
   *  iconCell, iconInset}. Null when the harvest is absent — the caller's
   *  cue to degrade, never to substitute a number. */
  shortcutArt(subName) {
    return (_shortcut && _shortcut.orientations
      && _shortcut.orientations[subName]) || null;
  },

  /** The system-string id a control's record carries (its label text lives in
   *  sysstring.json, not in the .uc), or null when it has none. */
  textId(winName, ctrlName) {
    const n = ctrlName ? Layout.find(winName, ctrlName) : Layout.window(winName);
    return (n && n.textId != null) ? n.textId : null;
  },

  /** The '#RRGGBB' the control's record stores for its text, or null. */
  color(winName, ctrlName) {
    const n = ctrlName ? Layout.find(winName, ctrlName) : Layout.window(winName);
    return (n && n.color) || null;
  },

  /** 'left' | 'center' | 'right' from the control's own record, or null when
   *  the record's alignment enum took a value the decoder does not name. */
  align(winName, ctrlName) {
    const n = ctrlName ? Layout.find(winName, ctrlName) : Layout.window(winName);
    return (n && n.align) || null;
  },
};
