// ElberaSkin runtime — the window manager.
//
// Sourced from NWindow.u's UIAPI_WINDOW, the retail base window class (see
// docs/ui-reverse-engineering.md §2-3). Three facts drive this module:
//
//  1. MOVEMENT IS UNIVERSAL. Move/MoveTo/MoveEx are native methods on every
//     window; there is no per-window "draggable" flag to honour. So moving
//     is registered here for all windows rather than opted into.
//
//  2. LAYOUT RESET IS A PER-WINDOW CALLBACK. Windows implement
//     OnDefaultPosition(), and the client calls it on each of them. It
//     restores internal state, not just coordinates -- ChatWnd re-merges its
//     tabs, ShortcutWnd collapses expansions and resets its page. So reset
//     here means "position + ask the window to restore itself".
//
//  3. Z-ORDER AND FOCUS are part of the same contract (SetAlwaysOnTop,
//     SetFocus), so clicking a window raises it.
//
// Positions persist per window name, which retail also does (natively -- the
// exact storage location is still unidentified, see the doc's open questions).

import { Skin } from './skin.js';

const STORE = 'l2vzla.wndpos';
// AUTHORED stacking base: z-index is a browser concept, not a client one.
// 12 sits above the canvas and the HUD layers style.css assigns below it.
const BASE_Z = 12;

let _z = BASE_Z;
const _windows = new Map();     // name -> {win, el, onDefault}

function loadPositions() {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}'); }
  catch { return {}; }
}

function savePosition(name, left, top) {
  const all = loadPositions();
  all[name] = { left, top };
  try { localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* ignore */ }
}

export const WndMgr = {
  /**
   * @param {string} name    window name, matching the xdat where possible
   * @param {object} win     must expose .root; may expose
   *                         .onDefaultPosition() and .place()
   * @param {object} opts    {handle} element to drag by (default: whole window)
   */
  register(name, win, { handle = null } = {}) {
    const el = win.root;
    _windows.set(name, { win, el });
    el.style.zIndex = String(++_z);

    // restore a stored position
    const saved = loadPositions()[name];
    if (saved) {
      el.style.left = `${saved.left}px`;
      el.style.top = `${saved.top}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }

    WndMgr.makeMovable(name, handle || el);
    el.addEventListener('pointerdown', () => WndMgr.raise(name), true);

    // bring-to-front ON OPEN: same SetFocus/SetAlwaysOnTop contract as the
    // click raise — a window that becomes visible is the one the player is
    // looking at, so it goes above the stack it was buried under
    let lastDisplay = el.style.display;
    new MutationObserver(() => {
      const d = el.style.display;
      if (d === lastDisplay) return;
      lastDisplay = d;
      if (d !== 'none') WndMgr.raise(name);
    }).observe(el, { attributes: true, attributeFilter: ['style'] });
    return win;
  },

  /** Raise an UNREGISTERED element (the ask popups, which are not WndMgr
   *  windows) above every registered window — invites must be topmost. */
  raiseEl(el) {
    el.style.zIndex = String(++_z);
  },

  /**
   * Retail Esc: close the topmost OPEN window. Only closable windows are
   * eligible (their frame carries FrameCloseBtn — window.js); HUD fixtures
   * like StatusWnd/ChatWnd/ShortcutWnd are not windows the player closes.
   * Mirrors the close button's click exactly: hide + the onClose hook (so
   * Trade cancels, the NPC dialog sends its close, etc.).
   * @returns {boolean} whether a window was closed
   */
  closeTopmost() {
    let top = null;
    for (const [, w] of _windows) {
      if (w.el.style.display === 'none') continue;
      const lw = w.win.win || w.win;   // wrapper -> its L2Window frame
      if (!lw || !lw.closeBtn) continue;
      if (!top || +w.el.style.zIndex > +top.el.style.zIndex) top = w;
    }
    if (!top) return false;
    const lw = top.win.win || top.win;
    lw.hide();
    if (lw.onClose) lw.onClose();
    return true;
  },

  /** Retail: every window can be dragged anywhere on screen. */
  makeMovable(name, handle) {
    const el = _windows.get(name).el;
    handle.style.pointerEvents = 'auto';
    let from = null;

    handle.addEventListener('pointerdown', (e) => {
      // left button only, and never start a drag from an interactive child
      // (buttons, the resize grip) that has claimed the event
      if (e.button !== 0 || e.defaultPrevented) return;
      const r = el.getBoundingClientRect();
      from = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener('pointermove', (e) => {
      if (!from) return;
      const r = el.getBoundingClientRect();
      // keep the window reachable: clamp so it cannot be lost off-screen
      const left = Math.max(0, Math.min(window.innerWidth - r.width,
                                        e.clientX - from.dx));
      const top = Math.max(0, Math.min(window.innerHeight - r.height,
                                       e.clientY - from.dy));
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    });

    const end = () => {
      if (!from) return;
      from = null;
      const r = el.getBoundingClientRect();
      savePosition(name, Math.round(r.left), Math.round(r.top));
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  },

  /** UIAPI_WINDOW.SetFocus / SetAlwaysOnTop — clicking a window raises it. */
  raise(name) {
    const w = _windows.get(name);
    if (w) w.el.style.zIndex = String(++_z);
  },

  /** UIAPI_WINDOW.SetAlpha(control, alpha, seconds). */
  setAlpha(name, alpha, seconds = 0) {
    const w = _windows.get(name);
    if (!w) return;
    w.el.style.transition = seconds ? `opacity ${seconds}s` : '';
    w.el.style.opacity = String(Math.max(0, Math.min(1, alpha)));
  },

  /**
   * The retail interface reset. Clears stored positions, puts every window
   * back where it starts, and asks each one to restore its own state via
   * OnDefaultPosition() — which is what the retail callback actually does.
   */
  resetAll() {
    try { localStorage.removeItem(STORE); } catch { /* ignore */ }
    _z = BASE_Z;
    for (const [name, w] of _windows) {
      w.el.style.left = w.el.style.top = '';
      w.el.style.right = w.el.style.bottom = '';
      w.el.style.zIndex = String(++_z);
      if (typeof w.win.place === 'function') w.win.place();
      if (typeof w.win.onDefaultPosition === 'function') w.win.onDefaultPosition();
    }
    return _windows.size;
  },

  get names() { return [..._windows.keys()]; },

  /** Alt+Enter is the reset players know; bind it once at startup. */
  bindResetKey(target = window) {
    target.addEventListener('keydown', (e) => {
      if (e.altKey && e.code === 'Enter') {
        WndMgr.resetAll();
        e.preventDefault();
      }
    });
  },
};

// re-clamp on resize so a window parked at an edge stays reachable
window.addEventListener('resize', () => {
  for (const [, w] of _windows) {
    const r = w.el.getBoundingClientRect();
    // AUTHORED 40px: the width of window edge that must stay on screen
    // after a viewport resize. Retail clamps to the desktop, which is a
    // different rule in a different coordinate space.
    if (r.left > window.innerWidth - 40) {
      w.el.style.left = `${Math.max(0, window.innerWidth - r.width)}px`;
    }
    // AUTHORED 40px, as above.
    if (r.top > window.innerHeight - 40) {
      w.el.style.top = `${Math.max(0, window.innerHeight - r.height)}px`;
    }
  }
});

void Skin;   // keeps the module's dependency explicit for future px() use
