// Alt+T, the character status window.
//
// This file used to BE the window: an authored 300px web panel
// (#charsheet-panel in style.css) with border-radius, an rgba background,
// two HTML <table>s and a list of equipped gear. It never referenced
// L2Window or Layout, so it inherited none of the retail chrome, and the
// gear list is something the retail window does not have.
//
// The real window was in the mined data all along and unused:
// Interface.xdat carries DetailStatusWnd (256x335, background
// L2UI_CH3.PlayerStatusWnd.myinfo_back) with all 65 of its controls
// decoded. js/ui/detailstatuswnd.js builds it.
//
// What is left here is the ADAPTER, so the call sites do not have to change:
// main.js constructs `new CharSheet(panelEl, {getSelf, getSheet, getEquipped})`
// and elsewhere asks `panelEl.classList.contains('visible')` before calling
// render(). Both keep working — the legacy element is kept in the DOM,
// permanently empty and never shown, purely as the flag main.js reads.
//
// The cleaner wiring (drop the element, pass getClan, call
// sheetPanel.visible) is specified in the handoff report; it needs an edit in
// main.js, which this worker does not own.

import { DetailStatusWnd } from './ui/detailstatuswnd.js';

export class CharSheet {
  /**
   * @param {HTMLElement} panelEl  the legacy #charsheet-panel; kept only so
   *                               main.js's `.classList.contains('visible')`
   *                               probe still answers correctly.
   * @param {object} o  getSelf() -> selfStatus (+ name/classId),
   *                    getSheet() -> charSheet payload,
   *                    getClan() -> clanInfo payload (optional; without it
   *                    the window shows sysstring 431 'No Clan', which is
   *                    the client's own clanless text).
   */
  constructor(panelEl, { getSelf, getSheet, getChar, getClan } = {}) {
    this.panel = panelEl || null;
    if (this.panel) {
      // never render the authored panel again
      this.panel.replaceChildren();
      this.panel.classList.remove('visible');
    }
    this.sources = { getSelf, getSheet, getChar, getClan };
    this.wnd = null;
  }

  /** Built on first use, NOT in the constructor.
   *
   *  main.js constructs CharSheet at module scope, which runs before boot()
   *  awaits Skin.load() / Layout.load(). A retail window built at that moment
   *  would read an empty skin manifest and an empty layout and silently fall
   *  back on every size — the frame would exist and be wrong. Alt+T cannot
   *  fire before boot completes, so deferring costs nothing. */
  _ensure() {
    if (!this.wnd) {
      this.wnd = new DetailStatusWnd(document.body, this.sources);
      // the retail frame's close button must keep the legacy flag in sync
      this.wnd.wnd.onClose = () => this._syncFlag();
    }
    return this.wnd;
  }

  _syncFlag() {
    if (this.panel) {
      this.panel.classList.toggle('visible', !!this.wnd && this.wnd.visible);
    }
  }

  /** Late-bound sources: main.js only learns the character's name and class
   *  on enterWorld, and its clan a few packets later. Assigning them here
   *  reaches the window whether or not it has been built yet. */
  setSources(more) {
    Object.assign(this.sources, more);
    if (this.wnd) Object.assign(this.wnd, more);
    if (this.wnd && this.wnd.visible) this.wnd.render();
    return this;
  }

  get visible() { return !!this.wnd && this.wnd.visible; }

  toggle(force) {
    this._ensure().toggle(force);
    this._syncFlag();
    return this;
  }

  render() { if (this.wnd) this.wnd.render(); }

  clear() {
    if (this.wnd) this.wnd.clear();
    this._syncFlag();
  }
}
