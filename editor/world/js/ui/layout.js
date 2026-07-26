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

let _doc = null;
const _index = new Map();       // 'Window/Control' -> node

function indexTree(winName, node, path) {
  _index.set(`${winName}/${path}`, node);
  for (const c of node.children || []) indexTree(winName, c, c.name);
}

export const Layout = {
  async load() {
    if (_doc) return Layout;
    _doc = await fetch(SRC).then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (!_doc) { _doc = { windows: [], textures: {} }; return Layout; }
    for (const w of _doc.windows) {
      _index.set(`${w.name}/`, w);
      for (const c of w.children || []) indexTree(w.name, c, c.name);
    }
    return Layout;
  },

  get ready() { return _doc !== null; },

  get windowNames() { return (_doc ? _doc.windows : []).map(w => w.name); },

  window(name) {
    return (_doc ? _doc.windows : []).find(w => w.name === name) || null;
  },

  /** A control anywhere inside `winName`, by its own name. */
  find(winName, ctrlName) {
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
};
