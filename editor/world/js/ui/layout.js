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

/** Preserve repeated original sibling records without losing them in a Map.
 * Occurrence suffixes are browser layout keys, never original control names. */
export function sourceControls(root, excludeNames = []) {
  const entries = [], excluded = new Set(excludeNames);
  function copy(node, path) {
    const out = { ...node, sourceName: node.name, children: [] };
    const children = (node.children || []).filter(child => !excluded.has(child.name));
    const counts = new Map(), seen = new Map();
    for (const child of children) counts.set(child.name, (counts.get(child.name) || 0) + 1);
    for (const child of children) {
      const occurrence = seen.get(child.name) || 0; seen.set(child.name, occurrence + 1);
      const key = counts.get(child.name) > 1 ? `${child.name}#${occurrence}` : child.name;
      const childPath = `${path}.${key}`, result = copy(child, childPath);
      result.name = key; out.children.push(result); entries.push({ node: result, path: childPath });
    }
    return out;
  }
  return { root: copy(root, root.name), entries };
}
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
// The text colours the UI paints that Interface.xdat does NOT declare, read
// out of NWindow.dll by tools/ui/mine_native_colors.py: a Button's label
// (352 Button records carry no colour, and ButtonHandle.uc exposes no colour
// API -- the value is chosen per draw from the button's enabled state), an
// item slot's stack-count badge (drawn by NCItemWnd's own render, not by any
// declared control), and the fallback a TextBox uses when its own record
// carries no colour. Each entry ships the instruction site it came from;
// `python3 tools/ui/mine_native_colors.py --check` re-reads the DLL and fails
// on drift.
const NATIVE = '/gamedata/native_colors.json';
// The position every retail window opens at, read straight out of the
// client's own assets/interlude/system/WindowsInfo.ini by
// tools/ui/mine_windowsinfo.py. Absolute pixels at 1024x768 (the client does
// not rescale its UI with resolution). Fourteen UI modules used to cite this
// file in a comment beside a typed pair of numbers; they now read it.
const DOCKS = '/gamedata/windowsinfo.json';

let _doc = null;
let _wells = null;
let _shortcut = null;
let _native = null;
let _docks = null;
let _loading = null;
const _index = new Map();       // 'Window/Control' -> node (FLAT, see below)
const _pathIndex = new Map();   // 'Window/Sub/.../Control' -> node (full path)
const _windows = new Map();     // full source path -> Window, null if ambiguous
const _windowAliases = new Map(); // unique Window name -> full source path

function uniqueEntry(index, key, value) {
  if (index.has(key) && index.get(key) !== value) index.set(key, null);
  else if (!index.has(key)) index.set(key, value);
}

function windowPath(name) {
  // A top-level name already is a full path; a nested alias must never
  // shadow it. Otherwise only a globally unique Window name is admitted.
  if (_windows.has(name)) return _windows.get(name) ? name : null;
  const path = _windowAliases.get(name);
  return path && _windows.get(path) ? path : null;
}

function collectWindows(node, path, topLevel = false) {
  if (topLevel || node.type === 'Window') {
    uniqueEntry(_windows, path, node);
    uniqueEntry(_windowAliases, node.name, path);
  }
  for (const c of node.children || []) collectWindows(c, `${path}/${c.name}`);
}

// The xdat reuses control names across sub-windows (ShortcutWnd declares
// PrevBtn per orientation AND per joypad variant; ChatWindow has 5 panes).
// The FLAT index keeps only the LAST record for a bare name — documented
// last-wins, kept for backward compatibility. The path index rejects
// duplicate exact paths: find()/pos()/size()/tex()/grid() accept a slash path
// ('ShortcutWndHorizontal/PrevBtn') to reach a specific one.
function indexTree(winName, node, path) {
  _index.set(`${winName}/${node.name}`, node);      // last wins
  uniqueEntry(_pathIndex, `${winName}/${path}`, node);
  for (const c of node.children || []) indexTree(winName, c, `${path}/${c.name}`);
}

export const Layout = {
  async load() {
    if (_doc) return Layout;
    // Index one parsed tree. Two concurrent responses contain distinct object
    // identities and would otherwise turn valid paths into ambiguity markers.
    if (!_loading) _loading = (async () => {
      _wells = await fetch(WELLS).then(r => (r.ok ? r.json() : null)).catch(() => null);
      _shortcut = await fetch(SHORTCUT).then(r => (r.ok ? r.json() : null)).catch(() => null);
      _native = await fetch(NATIVE).then(r => (r.ok ? r.json() : null)).catch(() => null);
      _docks = await fetch(DOCKS).then(r => (r.ok ? r.json() : null)).catch(() => null);
      _doc = await fetch(SRC).then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (!_doc) { _doc = { windows: [], textures: {} }; return Layout; }
      for (const w of _doc.windows) collectWindows(w, w.name, true);
      for (const [path, w] of _windows) {
        if (!w) continue;
        _index.set(`${path}/`, w);
        uniqueEntry(_pathIndex, `${path}/`, w);
        for (const c of w.children || []) indexTree(path, c, c.name);
      }
      return Layout;
    })();
    return _loading;
  },

  get ready() { return _doc !== null; },

  get windowNames() { return (_doc ? _doc.windows : []).map(w => w.name); },

  window(name) {
    const path = windowPath(name);
    return path ? _windows.get(path) : null;
  },

  /** A control anywhere inside `winName`. A bare name uses the flat
   *  last-wins index; a slash path ('SubWindow/Control') is exact. */
  find(winName, ctrlName) {
    const root = windowPath(winName);
    if (!root) return null;
    if (ctrlName && ctrlName.includes('/')) {
      return _pathIndex.get(`${root}/${ctrlName}`) || null;
    }
    return _index.get(`${root}/${ctrlName}`) || null;
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

  /** The client's own default placement for a window, {x, y} in absolute
   *  1024x768 pixels, from WindowsInfo.ini (see DOCKS above). Null when that
   *  file names no such window — the caller then keeps whatever placement it
   *  can justify, marked AUTHORED at the site. Never guess a dock: retail's
   *  are far from uniform (InventoryWnd 722,127 but MinimapWnd 16,63), so a
   *  plausible-looking pair is exactly the kind of value that reads as
   *  decoded and is not. */
  dock(name) {
    const d = _docks && _docks.docks && _docks.docks[name];
    return (d && d.x != null && d.y != null) ? { x: d.x, y: d.y } : null;
  },

  /** Separate XMLDefaultPositionItemData reset record. This is not the
   * common creation anchor or a WindowsInfo.ini saved coordinate. */
  windowDefault(name) {
    return _docks?.defaults?.[name] || null;
  },

  /** A colour ladder NWindow.dll walks in code: an ordered list of
   *  {maxDiff, color}, the first rung whose maxDiff is >= the value wins, and
   *  a null maxDiff is the open-ended last rung. Today the only ladder is
   *  'conColor', read out of ?execGetTargetNameColor@UUIDATA_TARGET@@ by
   *  tools/ui/mine_native_colors.py. Returns null when the harvest is absent.
   *  Use `Layout.ladder(name, value)` to resolve one; the raw list is here
   *  only for tools that want to show it. */
  ladderRungs(name) {
    const l = _native && _native.ladders && _native.ladders[name];
    return (l && l.rungs) || null;
  },

  /** Resolve a native colour ladder at `value`, or null when the harvest is
   *  absent — the caller's cue to leave the text at its own record colour
   *  rather than to type a substitute. */
  ladder(name, value) {
    const rungs = Layout.ladderRungs(name);
    if (!rungs || value == null) return null;
    for (const r of rungs) {
      if (r.maxDiff == null || value <= r.maxDiff) return r.color;
    }
    return null;
  },

  /** The colour the client's HTML viewer gives a `<font color="NAME">`.
   *  NCHtmlObject::GetMatchedColor knows exactly one name; every other string
   *  it treats as a bare hex number. Null for anything it does not name — the
   *  caller must then either parse it as hex or drop the tag, which is what
   *  the client does. */
  htmlColor(name) {
    const t = _native && _native.htmlNamedColors && _native.htmlNamedColors.names;
    return (t && t[String(name).toUpperCase()]) || null;
  },

  /** A colour NWindow.dll decides in code because no xdat record carries it.
   *  Keys: 'buttonLabel', 'buttonLabelDisabled', 'itemSlotCount',
   *  'textBoxDefault' -- see the NATIVE comment above and
   *  tools/ui/mine_native_colors.py for the instruction site behind each.
   *  Null when the harvest is absent, which is the caller's cue to degrade,
   *  never to substitute a typed colour. */
  native(key) {
    const c = _native && _native.colors && _native.colors[key];
    return (c && c.color) || null;
  },

  /** The colour a piece of TEXT should be painted, resolved the way the
   *  client resolves it: the control's own Interface.xdat record first, and
   *  when that record carries no colour, NCTextBox's field-0x348 initialiser
   *  (#DCDCDC) -- which is exactly the fallback the engine applies.
   *
   *  Prefer this over a literal at every text site. If it returns null both
   *  decodes are missing, and the caller should degrade rather than type a
   *  number. */
  textColor(winName, ctrlName) {
    return Layout.color(winName, ctrlName) || Layout.native('textBoxDefault');
  },

  /** 'left' | 'center' | 'right' from the control's own record, or null when
   *  the record's alignment enum took a value the decoder does not name. */
  align(winName, ctrlName) {
    const n = ctrlName ? Layout.find(winName, ctrlName) : Layout.window(winName);
    return (n && n.align) || null;
  },

  // ---- required lookups: degrade to nothing, never to a typed number -----
  //
  // Callers used to write `Layout.size(W, C) || { w: 239, h: 104 }`. That
  // second operand is a literal nobody decoded, and the audit
  // (tools/audit/unsourced.py) counts it as UNSOURCED whatever number it
  // holds — replacing it with a *better* number would not help. So the
  // guarded form is gone and these four take its place.
  //
  // When the record is missing they return the EMPTY rect and report the
  // miss once, naming the window and control. Painting nothing is the
  // degrade this file's header prescribes: a size we did not decode has no
  // honest value, and zero makes the gap visible instead of dressing it up
  // as retail geometry.
  //
  // No call site reaches the degrade today: `tools/audit/fallback_reach.py
  // --check` resolves 53/53 of the lookups these replaced, and
  // `editor/world/verify_layout_bind.js` re-checks every window/control pair
  // the UI actually asks for. The empty rect is a tripwire, not a design.

  /** {w, h} of a window declared in Interface.xdat; {w:0,h:0} if it is not. */
  windowSize(name) {
    const n = Layout.window(name);
    if (n && n.width != null && n.height != null) return { w: n.width, h: n.height };
    return Layout._degrade(`window ${name}`, { w: 0, h: 0 });
  },

  /** size(), with the empty rect instead of null. */
  sizeOf(winName, ctrlName) {
    return Layout.size(winName, ctrlName)
      || Layout._degrade(`size ${winName}/${ctrlName}`, { w: 0, h: 0 });
  },

  /** pos(), with the parent origin instead of null. */
  posOf(winName, ctrlName) {
    return Layout.pos(winName, ctrlName)
      || Layout._degrade(`pos ${winName}/${ctrlName}`, { x: 0, y: 0 });
  },

  /** autosize(), with a no-op rule instead of null: factors 0 (meaning "do
   *  not auto-size") and zero insets, so the caller's arithmetic is a
   *  no-change. */
  autosizeOf(winName, ctrlName) {
    return Layout.autosize(winName, ctrlName)
      || Layout._degrade(`autosize ${winName}/${ctrlName}`,
        { autosize: [0, 0], insets: [0, 0] });
  },

  /** grid(), with a zero cell instead of null. */
  gridOf(winName, ctrlName) {
    return Layout.grid(winName, ctrlName)
      || Layout._degrade(`grid ${winName}/${ctrlName}`,
        { cellX: 0, cellY: 0, gapX: 0, gapY: 0 });
  },

  _missed: new Set(),
  _degrade(what, empty) {
    if (!Layout._missed.has(what)) {
      Layout._missed.add(what);
      console.warn(`[Layout] no decoded record for ${what} — painting nothing`
        + ' (a typed size would be an invention)');
    }
    return empty;
  },
};
