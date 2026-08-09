// ElberaSkin runtime — the retail NPC dialog window (NpcHtmlMessage).
//
// Retail NpcHtmlMessage renders as a framed window with the server-sent
// HTML: the client supplies the chrome, the server the content. The xdat
// has NO NpcHtmlWnd (checked: only BoardWnd 646x530 for the BBS and
// HelpHtmlWnd 310x311 for help pages — neither is the NPC dialog), so the
// frame is L2Window chrome + the measured body panel (MEASURED:
// L2UI_ch3.NpcWnd.Npc1_back, content 310x381). Width 360 is AUTHORED
// (retail dialogs size to content; no mined width exists), height is
// content-driven and capped with scroll (AUTHORED).
//
// HTML handling: the server HTML subset L2 actually uses —
//   <a action="bypass -h CMD">      -> clickable link, sends bypass{CMD}
//   <button value="T" action="bypass -h CMD"> -> L2-styled button
//   <font color="...">              -> inline color (hex or named subset)
//   <br>, <center>, <p>, <table>, <tr>, <td>, <b>, <i>, <u>, <title>
//   <img src="...">                 -> only refs that map to client data
// Everything else is stripped HARD: no <script>, no event attributes, no
// external loads (img only via Skin.sprite() or /gamedata/icons allowlist).
// bypass commands are taken only from action="bypass -h ..." attributes —
// javascript: URLs and unknown actions are dropped.

import { L2Window } from './window.js';
import { Skin } from './skin.js';
import { Font } from './font.js';
import { WndMgr } from './wndmgr.js';
import { Layout } from './layout.js';

// AUTHORED dialog geometry (no NpcHtmlWnd in the xdat): width 360,
// content height capped before scrolling.
const DIALOG_W = 360;
const DIALOG_MAX_H = 420;

// `<font color="...">` — resolved exactly the way the client resolves it.
//
// This used to be an eight-entry table of typed colours (LEVEL/BROWN/WHITE/
// RED/GREEN/BLUE/YELLOW/ORANGE). Seven of those eight names DO NOT EXIST in
// the client: NCHtmlObject::GetMatchedColor (NWindow.dll 0x100825d0) is the
// NPC-dialog parser's whole name table, and it compares against exactly one
// wide string, L"LEVEL" (0x1024dd44 — referenced once in the image), returning
// the immediate at 0x10082653. Every other name it concatenates after
// L"0xff" (0x1024dd38) and hands to the numeric parser — i.e. it is only ever
// treated as a bare hex colour, never as a name.
//
// So: the one real name comes from Layout.htmlColor() (decoded by
// tools/ui/mine_native_colors.py section 5, --check re-reads the DLL), a
// 6/8-digit hex string is taken as written, and anything else is DROPPED
// rather than given an invented colour — the text still renders, at the
// element's inherited colour, which is the honest degrade for a tag whose
// value the client would have parsed to something we have not decoded.
const SAFE_COLOR = /^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

function safeColor(raw) {
  if (!raw) return null;
  if (SAFE_COLOR.test(raw)) return raw.startsWith('#') ? raw : '#' + raw;
  return Layout.htmlColor(raw);
}

export class NpcDialog {
  constructor(parent = document.body, { onBypass, onClose } = {}) {
    this.onBypass = onBypass || (() => {});
    this.onClose = onClose || (() => {});
    this.open = false;

    const win = new L2Window({
      title: 'Dialog', width: DIALOG_W, height: DIALOG_MAX_H, closable: true,
      winName: null,   // no NpcHtmlWnd in the xdat -> measured npc1 panel
    });
    win.root.id = 'l2-npcdialog';
    win.root.style.zIndex = '14';
    this.win = win;
    this.root = win.root;
    win.onClose = () => this.close();

    this.body = document.createElement('div');
    this.body.className = 'npc-dialog-body';
    // AUTHORED: the 4px body inset (retail panels pad inside their border;
    // no NpcHtmlWnd exists in the xdat to state it).
    this.body.style.cssText = `position:absolute;left:${Skin.px(4)}px;`
      + `top:${Skin.px(4)}px;width:${Skin.px(DIALOG_W - 8)}px;`
      + `max-height:${Skin.px(DIALOG_MAX_H - 8)}px;overflow-y:auto;`
      + 'pointer-events:auto;';
    win.body.style.height = 'auto';
    win.body.appendChild(this.body);

    win.body.addEventListener('click', (e) => {
      const link = e.target.closest('[data-bypass]');
      if (link) {
        e.preventDefault();
        this.onBypass(link.dataset.bypass);
      }
    });

    parent.appendChild(win.root);
    WndMgr.register('NpcHtmlWnd', this, { handle: win.bar });
    this.onDefaultPosition();
  }

  // -- sanitizing renderer ---------------------------------------------------

  _sanitize(htmlText) {
    // <br1> is L2's nonstandard break tag; the HTML parser treats it as an
    // OPEN unknown element and swallows everything after it into the br1
    // node. Normalize it to <br> (void) before parsing.
    const doc = new DOMParser().parseFromString(
      String(htmlText).replace(/<br1>/g, '<br>'), 'text/html');
    const out = document.createElement('div');
    out.className = 'npc-dialog-content';
    for (const node of doc.body.childNodes) {
      const el = this._renderNode(node);
      if (el) out.appendChild(el);
    }
    return out;
  }

  _renderNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const tag = node.tagName.toLowerCase();

    // hard strip: anything executable or structural-junk
    if (['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta',
         'head', 'form', 'input', 'select', 'textarea'].includes(tag)) {
      return null;
    }

    if (tag === 'title') {
      const el = document.createElement('div');
      el.className = 'npc-dialog-title';
      this._appendChildren(el, node);
      return el;
    }
    if (tag === 'br') return document.createElement('br');
    if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      const url = this._mapImage(src);
      if (!url) return null;
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      const w = node.getAttribute('width'), h = node.getAttribute('height');
      if (w && /^\d{1,4}$/.test(w)) img.style.width = w + 'px';
      if (h && /^\d{1,4}$/.test(h)) img.style.height = h + 'px';
      return img;
    }
    if (tag === 'a') {
      const cmd = this._bypassCmd(node.getAttribute('action'));
      if (!cmd) return null;   // javascript:/external links die here
      const el = document.createElement('span');
      el.className = 'npc-link';
      el.dataset.bypass = cmd;
      this._appendChildren(el, node);
      return el;
    }
    if (tag === 'button') {
      const cmd = this._bypassCmd(node.getAttribute('action'));
      const el = document.createElement('button');
      el.className = 'npc-btn';
      el.type = 'button';
      if (cmd) el.dataset.bypass = cmd;
      else el.disabled = true;
      const label = node.getAttribute('value') || node.textContent.trim() || 'OK';
      // an NPC-HTML <button> is a button: no xdat record carries a Button
      // colour, NCButton chooses it per draw. SOURCED NWindow.dll 0x100035a8
      // (the literal here used to be #e6dcc0 -- two units off the decoded
      // #E6DCBE, i.e. remembered rather than read).
      Font.set(el, label, { color: Layout.native('buttonLabel') });
      return el;
    }
    if (tag === 'font') {
      const el = document.createElement('span');
      const c = safeColor(node.getAttribute('color'));
      if (c) el.style.color = c;
      this._appendChildren(el, node);
      return el;
    }
    if (['b', 'i', 'u', 'strong', 'em', 'span', 'center', 'p', 'div',
         'table', 'tbody', 'thead', 'tr', 'td', 'th', 'ul', 'ol', 'li',
         'html', 'body'].includes(tag)) {
      let el;
      if (tag === 'table') {
        el = document.createElement('table');
        const w = node.getAttribute('width');
        if (w && /^\d{1,3}(%|px)?$/.test(w)) el.style.width = /%$/.test(w) ? w : w + 'px';
        el.className = 'npc-table';
      } else if (tag === 'center') {
        el = document.createElement('div');
        el.style.textAlign = 'center';
      } else if (tag === 'p' || tag === 'div') {
        el = document.createElement('div');
      } else if (tag === 'td' || tag === 'th') {
        el = document.createElement(tag);
        const align = node.getAttribute('align');
        if (align && /^(left|center|right)$/.test(align)) el.style.textAlign = align;
        const width = node.getAttribute('width');
        if (width && /^\d{1,3}(%|px)?$/.test(width)) {
          el.style.width = /%$/.test(width) ? width : width + 'px';
        }
      } else {
        el = document.createElement(tag);
      }
      this._appendChildren(el, node);
      return el;
    }
    return null;
  }

  _appendChildren(el, node) {
    for (const child of node.childNodes) {
      const c = this._renderNode(child);
      if (c) el.appendChild(c);
    }
  }

  // action="bypass -h CMD" -> "CMD" (frozen contract: the raw string
  // after 'bypass -h '). Voice-command menus use action="bypass CMD"
  // (no -h) — the same raw string form aCis RequestBypassToServer takes.
  _bypassCmd(action) {
    if (!action) return null;
    let m = String(action).match(/^bypass -h\s+(.+)$/);
    if (m) return m[1];
    m = String(action).match(/^bypass\s+(.+)$/);
    return m ? m[1] : null;
  }

  // img src -> a URL we are willing to load. Client texture refs map via
  // the skin manifest (Skin.sprite); /gamedata/icons/<file>.png is the only
  // allowed local path shape. Everything else (http, //, .., other paths)
  // is skipped — no external loads, no traversal.
  _mapImage(src) {
    if (!src) return null;
    if (Skin.sprite(src)) return Skin.url(src);
    if (/^icons\/[\w.-]+\.png$/.test(src)) return '/gamedata/' + src;
    return null;
  }

  // -- flow --------------------------------------------------------------------

  /** A fresh npcHtml replaces the current page (retail behavior). */
  showHtml(html) {
    this.body.replaceChildren(this._sanitize(html));
    if (!this.open) {
      this.open = true;
      this.win.show();
    }
    // content-driven height up to the cap (AUTHORED)
    const contentH = Math.min(this.body.scrollHeight + 8, DIALOG_MAX_H);
    this.win.body.style.height = `${Skin.px(contentH)}px`;
  }

  close() {
    if (this.open) {
      this.open = false;
      this.win.hide();
      this.onClose();
    }
  }

  onDefaultPosition() {
    const el = this.root;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    // AUTHORED: retail dialogs open roughly center-left of the screen
    el.style.left = `calc(38% - ${Skin.px(DIALOG_W) / 2}px)`;
    el.style.top = '20%';
  }

  place(o = {}) {
    const el = this.root;
    if (o.left != null) el.style.left = `${o.left}px`;
    if (o.top != null) el.style.top = `${o.top}px`;
    if (o.right != null) el.style.right = `${o.right}px`;
    if (o.bottom != null) el.style.bottom = `${o.bottom}px`;
    return this;
  }
}
