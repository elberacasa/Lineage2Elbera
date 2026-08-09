// ElberaSkin runtime — ChatWnd, retail geometry + the port's chat behavior.
//
// Layout (tier 1, docs/ui-mined-values.md §3): ChatWnd 348x187,
// ChatWndHeadTex 348x18 at (0,0), ChatTabCtrl 320x23 at (23,-23),
// ChatEditBox 303x16 at (39,-6), LanguageTexture 15x15 at (24,-5),
// ChatFilterBtn/MessengerBtn/PartyMatchingBtn 15x15 at x=5.
// NEGATIVE y = far-edge anchoring (§1): the control's BOTTOM edge sits at
// windowHeight + y — ChatEditBox (-6, h16) => bottom 181, ChatTabCtrl
// (-23, h23) => bottom 164, ChatWndBottomTex (h18) -46 => divider at
// 123-141, ChatWndBottomTex1 (h46) 0 => bottom chrome 141-187. That decode
// puts every control inside the window and matches retail exactly; the
// doc's low-confidence flag on BottomTex1's y=0 resolves to "flush with
// the bottom edge" under this anchoring (confirmed against the render).
//
// The body texture was MISSING until 2026-08: _buildAll painted the head
// strip and both bottom bands but never ChatWndBodyTex, so the chat log had
// no background at all and the lines sat straight on the 3D scene. Its rect
// is fully mined: x=0 y=18, autosize [1,1] insets [0,-82] => 348x105, i.e.
// exactly the band between the head strip and the divider.
//
// Behavior spec: ChatWnd.uc (assets/uscript/Interface) — the tab model is
// CHAT_WINDOW_NORMAL/TRADE/PARTY/CLAN/ALLY with CHAT_WINDOW_COUNT = 5.
// CHAT_WINDOW_SYSTEM = 5 is NOT a sixth tab: the .uc comments it as a spare
// filter slot ("CheckFilter를 좀 더 간편하게 짜기위해"), its filter row is all
// zeros, and the geometry agrees — ChatTabCtrl is 320 wide and the tab
// sprite is 64, so the strip holds exactly five. The port used to draw six.
// MergeTab on OnDefaultPosition folds Trade/Party/Clan/Ally back into
// NORMAL. The per-tab filters below are transcribed from
// SetDefaultFilterValue, not approximated.
//
// COLORS: evidence chain (docs task): ChatWnd.uc:401-407 parses ColorR/G/B
// FROM THE MESSAGE — chat line colors are assigned by the native layer,
// and the per-say-type table lives only in NWindow.dll (tier 5, not mined
// yet). Until it is, channel colors below are AUTHORED; sysmsg colors ARE
// sourced per message from systemmsg-e.dat (assets/gamedata/systemmsg.json).

import { Layout } from './ui/layout.js';
import { Skin } from './ui/skin.js';
import { Font } from './ui/font.js';
import { WndMgr } from './ui/wndmgr.js';

const WND = 'ChatWnd';

// Channel colors: the DLL-mined table (docs/ui-mined-native.md §2, inline
// constants at the say-type switch 0x10141760 in NWindow.dll). This
// replaces the AUTHORED set. Note the corrected say-type ids: 15 =
// PARTYROOM_COMMANDER, 16 = PARTYROOM_ALL, 17 = HERO_VOICE (gateway/README
// agrees; an older comment had 15=HERO). HERO_VOICE has no dedicated case
// in this build — it renders in the default grey #DCDCDC.
const CHANNELS = {
  0: { name: 'all', color: '#DCDCDC' },
  1: { name: 'shout', color: '#FF7200' },
  2: { name: 'tell', color: '#FF00FF' },
  3: { name: 'party', color: '#00FF00' },
  4: { name: 'clan', color: '#7D77FF' },
  6: { name: 'petition', color: '#80FFFF' },
  7: { name: 'petitiongm', color: '#80FFFF' },
  8: { name: 'trade', color: '#EAA5F5' },
  9: { name: 'alliance', color: '#77FF99' },
  10: { name: 'announce', color: '#80FFFF' },
  15: { name: 'commander', color: '#FF9695' },
  16: { name: 'partyroom', color: '#FFF8B2' },
  17: { name: 'hero', color: '#DCDCDC' },
  18: { name: 'critical', color: '#7B7DF2' },
};
// Say type 0 IS the default arm of that switch, so the fallback for an
// unknown channel is CHANNELS[0]'s own colour rather than a second copy of it.
const DEFAULT_CHAT_COLOR = CHANNELS[0].color;
// name -> say type, inverted from the table above so a command handler never
// types a say-type id (NWindow.dll say-type switch 0x10141760, ids per
// gateway/README).
const SAY = Object.fromEntries(
  Object.entries(CHANNELS).map(([id, c]) => [c.name, Number(id)]));

// ChatWnd.uc CheckFilter maps each say type to one filter flag:
//   bNormal->0  bShout->1  bWhisper->2  bParty->3  bClan->4  bTrade->8
//   bAlly->9  bHero->17  bUnion->15,16
// and announces (10, 18) plus pet chat return true unconditionally, in every
// tab. bSystem gates the sysmsg lines and is 1 in ALL FIVE tabs — the port
// used to hide system lines everywhere but "All".
const ALWAYS = [10, 18];              // CHAT_ANNOUNCE, CHAT_CRITICAL_ANNOUNCE
const FLAG_CHANNEL = {
  bNormal: [0], bShout: [1], bWhisper: [2], bParty: [3], bClan: [4],
  // say-type ids, transcribed from ChatWnd.uc CheckFilter (uc:640-696)
  bTrade: [SAY.trade], bAlly: [SAY.alliance], bHero: [SAY.hero],
  bUnion: [SAY.commander, SAY.partyroom],
};

// Transcribed verbatim from ChatWnd.uc SetDefaultFilterValue (uc:698-777),
// in the CHAT_WINDOW_* constant order. `system` is bSystem.
const TABS = [
  ['all', 'All', {
    system: 1, bNormal: 1, bShout: 1, bClan: 1, bParty: 1, bTrade: 0,
    bWhisper: 1, bAlly: 0, bHero: 0, bUnion: 1,
  }],
  ['trade', 'Trade', {
    system: 1, bNormal: 0, bShout: 1, bClan: 0, bParty: 0, bTrade: 1,
    bWhisper: 1, bAlly: 0, bHero: 0, bUnion: 0,
  }],
  ['party', 'Party', {
    system: 1, bNormal: 0, bShout: 1, bClan: 0, bParty: 1, bTrade: 0,
    bWhisper: 1, bAlly: 0, bHero: 0, bUnion: 0,
  }],
  ['clan', 'Clan', {
    system: 1, bNormal: 0, bShout: 1, bClan: 1, bParty: 0, bTrade: 0,
    bWhisper: 1, bAlly: 0, bHero: 0, bUnion: 0,
  }],
  ['alliance', 'Alliance', {
    system: 1, bNormal: 0, bShout: 1, bClan: 0, bParty: 0, bTrade: 0,
    bWhisper: 1, bAlly: 1, bHero: 0, bUnion: 0,
  }],
];

/** The channel ids a tab shows, expanded from its filter row. */
function visibleChannels(filter) {
  const out = new Set(ALWAYS);
  for (const [flag, chans] of Object.entries(FLAG_CHANNEL)) {
    if (filter[flag]) for (const c of chans) out.add(c);
  }
  return out;
}

export class ChatBox {
  constructor(rootEl, logEl, inputEl, { onSend } = {}) {
    this.onSend = onSend || (() => {});
    this.lines = [];
    // AUTHORED scrollback depth. ChatWnd.uc keeps its history in the native
    // NCHtmlObject and never states a line cap, and no xdat record carries
    // one, so this is the port's own ring size — a memory bound, not a
    // retail number.
    this.maxLines = 60;
    this.filter = 'all';

    const def = Layout.window(WND);
    // Fallback = the mined ChatWnd rect itself (Interface.xdat, tier 1,
    // docs/ui-mined-values.md §3: 348x187), cross-checked against
    // WindowsInfo.ini, whose only 348x187 section is section [6].
    this.w = def && def.width ? def.width : 348;
    this.h = def && def.height ? def.height : 187;

    const root = rootEl || document.createElement('div');
    root.id = 'chat';
    root.innerHTML = '';
    // DEVIATION: the log is browser text, not a Font.canvas blit like every
    // other string in this port, because a chat line has to wrap, scroll and
    // be selectable and the bitmap path does none of those. What is NOT
    // invented is its SIZE: the em box is the client's own SmallFont-e.gly
    // cell height, and line-height 1 because that cell already carries the
    // font's leading. 13 is that cell height, read from the .gly by
    // tools/ui/build_font.py; it is only reached if the sheet has not loaded.
    const lh = Font.lineHeight('small') || 13;
    root.style.cssText = `position:fixed;width:${Skin.px(this.w)}px;`
      + `height:${Skin.px(this.h)}px;z-index:11;pointer-events:none;`
      + `font:${Skin.px(lh)}px/1 -apple-system, "Segoe UI", sans-serif;`;
    this.root = root;
    this._logEl = logEl;
    this._inputEl = inputEl;
    if (!rootEl) document.body.appendChild(root);

    this._buildAll();
    if (!rootEl) document.body.appendChild(root);
    WndMgr.register('ChatWnd', this);
    this.onDefaultPosition();
  }

  _buildAll() {
    const root = this.root;
    const WND = 'ChatWnd';
    const headTex = Layout.tex0(WND, 'ChatWndHeadTex');
    const headSize = Layout.size(WND, 'ChatWndHeadTex');
    if (headTex && headSize) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:0;top:0;width:${Skin.px(headSize.w)}px;`
        + `height:${Skin.px(headSize.h)}px;pointer-events:auto;`;
      Skin.apply(el, headTex, { content: headSize, stretch: true });
      root.appendChild(el);
      this.headEl = el;
    }
    // BODY: the log's background. hasSize==0 with autosize [1,1] and insets
    // [0,-82] => width = 348+0, height = 187-82 = 105, at the mined (0,18).
    // The art (Chatting_Back3) is a 348x15 semi-transparent tile, so it
    // REPEATS down the band rather than stretching.
    const bodyTex = Layout.tex0(WND, 'ChatWndBodyTex');
    const bodyPos = Layout.pos(WND, 'ChatWndBodyTex');
    const bodyAuto = Layout.autosize(WND, 'ChatWndBodyTex');
    if (bodyTex && bodyPos && bodyAuto) {
      const bw = this.w + bodyAuto.insets[0];
      const bh = this.h + bodyAuto.insets[1];
      const el = document.createElement('div');
      el.id = 'chat-body';
      el.style.cssText = `position:absolute;left:${Skin.px(bodyPos.x)}px;`
        + `top:${Skin.px(bodyPos.y)}px;width:${Skin.px(bw)}px;`
        + `height:${Skin.px(bh)}px;pointer-events:none;`;
      Skin.apply(el, bodyTex, { content: Skin.content(bodyTex) });
      root.appendChild(el);
      this.bodyEl = el;
      this.bodyRect = { x: bodyPos.x, y: bodyPos.y, w: bw, h: bh };
    }

    // bottom chrome: BottomTex1 covers the bottom strip (flush, y=0 under
    // far-edge anchoring); BottomTex is the divider above it
    const bt1Tex = Layout.tex0(WND, 'ChatWndBottomTex1');
    const bt1Size = Layout.size(WND, 'ChatWndBottomTex1');
    if (bt1Tex && bt1Size) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:0;`
        + `top:${Skin.px(this.h - bt1Size.h)}px;width:${Skin.px(bt1Size.w)}px;`
        + `height:${Skin.px(bt1Size.h)}px;pointer-events:none;`;
      Skin.apply(el, bt1Tex, { content: bt1Size, stretch: true });
      root.appendChild(el);
    }
    const btTex = Layout.tex0(WND, 'ChatWndBottomTex');
    const btSize = Layout.size(WND, 'ChatWndBottomTex');
    if (btTex && btSize) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:0;`
        + `top:${Skin.px(this.h + (-46) - btSize.h)}px;width:${Skin.px(btSize.w)}px;`
        + `height:${Skin.px(btSize.h)}px;pointer-events:none;`;
      Skin.apply(el, btTex, { content: btSize, stretch: true });
      root.appendChild(el);
    }

    this._buildChrome();
  }

  _buildChrome() {
    const root = this.root;
    const WND = 'ChatWnd';
    const logEl = this._logEl, inputEl = this._inputEl;
    // The log lives ON the body texture, inset by that sprite's own frame.
    // MEASURED from Chatting_Back3: columns 0-1 and 346-347 are the frame
    // (opaque black + highlight), the interior starts at 2. The body rect
    // itself is mined (autosize above), so nothing here is eyeballed.
    const BODY_FRAME = 2;
    const b = this.bodyRect || { x: 0, y: 18, w: this.w, h: this.h - 46 - 18 - 18 };
    this.log = document.createElement('div');
    this.log.id = 'chat-log';
    this.log.style.cssText = `position:absolute;`
      + `left:${Skin.px(b.x + BODY_FRAME)}px;top:${Skin.px(b.y + BODY_FRAME)}px;`
      + `width:${Skin.px(b.w - BODY_FRAME * 2)}px;`
      + `height:${Skin.px(b.h - BODY_FRAME * 2)}px;overflow-y:auto;`
      + 'pointer-events:auto;';
    root.appendChild(this.log);
    if (logEl && logEl !== this.log) logEl.remove();

    // --- tab strip at its mined rect (23,-23 => bottom edge 164) ----------
    // ChatTabCtrl is 320 wide and its sprites (Chatting_Tab2 unselected,
    // Chatting_Tab1 selected) are 64 — five tabs, exactly filling the strip,
    // which is CHAT_WINDOW_COUNT.
    const tabPos = Layout.pos(WND, 'ChatTabCtrl');
    const tabSize = Layout.size(WND, 'ChatTabCtrl');
    const tabTex = Layout.tex(WND, 'ChatTabCtrl').filter(r => Skin.sprite(r));
    const tabArt = tabTex[0] ? Skin.content(tabTex[0]) : null;
    this.tabs = document.createElement('div');
    this.tabs.id = 'chat-tabs';
    this.tabs.style.cssText = 'position:absolute;display:flex;pointer-events:auto;';
    if (tabPos && tabSize) {
      this.tabs.style.left = `${Skin.px(tabPos.x)}px`;
      this.tabs.style.top = `${Skin.px(this.h + tabPos.y - tabSize.h)}px`;
      this.tabs.style.width = `${Skin.px(tabSize.w)}px`;
      this.tabs.style.height = `${Skin.px(tabSize.h)}px`;
    }
    // TabBackgroundTexture: the plate behind the strip, same rect
    const tabBackTex = Layout.tex0(WND, 'TabBackgroundTexture');
    const tabBackPos = Layout.pos(WND, 'TabBackgroundTexture');
    const tabBackSize = Layout.size(WND, 'TabBackgroundTexture');
    if (tabBackTex && Skin.sprite(tabBackTex) && tabBackPos && tabBackSize) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:${Skin.px(tabBackPos.x)}px;`
        + `top:${Skin.px(this.h + tabBackPos.y - tabBackSize.h)}px;`
        + `width:${Skin.px(tabBackSize.w)}px;height:${Skin.px(tabBackSize.h)}px;`
        + 'pointer-events:none;';
      Skin.apply(el, tabBackTex, { stretch: true });
      root.appendChild(el);
    }
    root.appendChild(this.tabs);
    this.tabTex = tabTex;
    for (const [key, label] of TABS) {
      const t = document.createElement('div');
      t.dataset.tab = key;
      t.className = 'chat-tab' + (key === 'all' ? ' active' : '');
      // each tab is one sprite wide (64), which is how the strip's 320 is
      // divided — no flex share, no invented width
      t.style.cssText = 'position:relative;display:flex;align-items:center;'
        + 'justify-content:center;cursor:pointer;'
        + (tabArt ? `width:${Skin.px(tabArt.w)}px;height:${Skin.px(tabArt.h)}px;`
                  : 'flex:1;');
      t.addEventListener('click', () => {
        this.filter = key;
        this._paintTabs();
        this._applyFilter();
      });
      this.tabs.appendChild(t);
      // A tab's label is a BUTTON label: NCTabButton shares NCButton's paint
      // (both vtables carry 0x10005e00 at slot 99, which calls 0x100034b0),
      // so it takes the same IsEnableWindow()-driven colour. Retail marks the
      // SELECTED tab with a different TEXTURE, not a different text colour --
      // the Skin.apply above already does that. SOURCED NWindow.dll 0x100035a8.
      Font.set(t, label, { color: Layout.native('buttonLabel') });
    }
    this._paintTabs();

    // --- side buttons at x=5, far-edge anchored ----------------------------
    for (const [ctrl, note] of [
      ['ChatFilterBtn', 'Chat filter: ChatFilterWnd not built'],
      ['MessengerBtn', 'Messenger: not bridged'],
      ['PartyMatchingBtn', 'Party matching: not bridged'],
    ]) {
      const pos = Layout.pos(WND, ctrl);
      const size = Layout.size(WND, ctrl);
      const tex = Layout.tex(WND, ctrl).filter(r => Skin.sprite(r));
      if (!pos || !size) continue;
      const el = document.createElement('div');
      // AUTHORED-disabled: these open windows the port has not built
      el.className = 'chat-side-btn disabled';
      el.title = note;
      el.style.cssText = `position:absolute;left:${Skin.px(pos.x)}px;`
        + `top:${Skin.px(this.h + pos.y - size.h)}px;width:${Skin.px(size.w)}px;`
        + `height:${Skin.px(size.h)}px;`;
      if (tex[0]) Skin.apply(el, tex[0]);
      root.appendChild(el);
    }

    // --- language texture + edit box at their mined rects ------------------
    const langPos = Layout.pos(WND, 'LanguageTexture');
    const langSize = Layout.size(WND, 'LanguageTexture');
    const langTex = Layout.tex0(WND, 'LanguageTexture');
    if (langPos && langTex) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:${Skin.px(langPos.x)}px;`
        + `top:${Skin.px(this.h + langPos.y - langSize.h)}px;`
        + `width:${Skin.px(langSize.w)}px;height:${Skin.px(langSize.h)}px;`
        + 'pointer-events:none;';
      Skin.apply(el, langTex);
      root.appendChild(el);
    }
    const editPos = Layout.pos(WND, 'ChatEditBox');
    const editSize = Layout.size(WND, 'ChatEditBox');
    this.input = document.createElement('input');
    this.input.id = 'chat-input';
    this.input.type = 'text';
    // aCis Say2.java:81 drops the packet outright when the text is empty or
    // longer than 100 characters, so anything past 100 was silently lost.
    this.input.maxLength = 100;
    this.input.placeholder = 'say… (Enter to send, Esc to close)';
    // ChatEditBox carries NO texture in the xdat: its well is painted by
    // ChatWndBottomTex1, which the window already draws. So the box is
    // transparent — the hand-rolled dark panel + border used to sit on top
    // of that art and hide it.
    this.input.style.cssText = `position:absolute;`
      + `left:${Skin.px(editPos ? editPos.x : 39)}px;`
      + `top:${Skin.px(editPos ? this.h + editPos.y - editSize.h : this.h - 22)}px;`
      + `width:${Skin.px(editSize ? editSize.w : 303)}px;`
      + `height:${Skin.px(editSize ? editSize.h : 16)}px;`
      + 'display:none;pointer-events:auto;box-sizing:border-box;'
      // The text colour is the one NCTextBox falls back to when its own xdat
      // record carries none — field 0x348's initialiser, mined out of
      // NWindow.dll at 0x10052aca. ChatEditBox is exactly such a record.
      + `background:transparent;color:${Layout.native('textBoxDefault')};border:0;`
      + 'font:inherit;outline:none;padding:0;';
    if (inputEl && inputEl !== this.input) inputEl.remove();
    root.appendChild(this.input);

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text) this._submit(text);
        this.input.value = '';
        this.close();
      } else if (e.key === 'Escape') {
        this.input.value = '';
        this.close();
      }
    });
  }

  // -- placement --------------------------------------------------------------

  /** WndMgr reset: retail docks the chat at the bottom-left, tabs merged
   *  (ChatWnd.uc OnDefaultPosition MergeTab of all tabs into NORMAL). */
  onDefaultPosition() {
    const el = this.root;
    el.style.right = 'auto';
    el.style.top = 'auto';
    // AUTHORED dock inset. WindowsInfo.ini carries an (x, y) for 39 windows
    // and ChatWnd is not one of them — the only 348x187 section it has,
    // section [6], records the SIZE and no position (see
    // assets/gamedata/windowsinfo.json, whose numeric sections are
    // deliberately left unmapped). So the gutter is the port's own.
    el.style.left = '8px';      // AUTHORED gutter, see above
    el.style.bottom = '8px';    // AUTHORED gutter, see above
    this.filter = 'all';
    this._paintTabs();
    this._applyFilter();
  }

  place(o = {}) {
    const el = this.root;
    if (o.left != null) el.style.left = `${o.left}px`;
    if (o.top != null) el.style.top = `${o.top}px`;
    if (o.right != null) el.style.right = `${o.right}px`;
    if (o.bottom != null) el.style.bottom = `${o.bottom}px`;
    return this;
  }

  // -- behavior ----------------------------------------------------------------

  /** Paint the strip: Chatting_Tab1 on the selected tab, Chatting_Tab2 on
   *  the rest (the xdat lists them in that [unselected, selected] order). */
  _paintTabs() {
    if (!this.tabs) return;
    for (const t of this.tabs.children) {
      const on = t.dataset.tab === this.filter;
      t.classList.toggle('active', on);
      const ref = this.tabTex[on ? 1 : 0] || this.tabTex[0];
      if (ref) Skin.apply(t, ref, { content: Skin.content(ref) });
      const label = (TABS.find(x => x[0] === t.dataset.tab) || [, ''])[1];
      // same as _paintTabs: the tab ART carries the selected state, not the
      // label colour (NWindow.dll NCTabButton -> NCButton paint 0x100034b0)
      Font.set(t, label, { color: Layout.native('buttonLabel') });
    }
  }

  /** ChatWnd.uc CheckFilter, per the current tab's filter row. */
  _applyFilter() {
    const tab = TABS.find(t => t[0] === this.filter) || TABS[0];
    const shown = visibleChannels(tab[2]);
    for (const line of this.log.children) {
      const ch = Number(line.dataset.channel);
      const sys = line.dataset.system === '1';
      // bSystem is 1 in every retail tab, so system lines follow the tab's
      // own flag rather than being confined to "All"
      line.style.display = (sys ? !!tab[2].system : shown.has(ch)) ? '' : 'none';
    }
  }

  // parse input prefixes into a say op payload
  _submit(text) {
    // Say types come from SAY, the inverse of the DLL-mined CHANNELS table —
    // never from a typed id.
    const m = text.match(/^\/(w|whisper|tell)\s+(\S+)\s+([\s\S]+)$/i);
    if (m) return this.onSend({ channel: SAY.tell, target: m[2], text: m[3] });
    const s = text.match(/^\/(shout)\s+([\s\S]+)$/i);
    if (s) return this.onSend({ channel: SAY.shout, text: s[2] });
    const t = text.match(/^\/(trade)\s+([\s\S]+)$/i);
    if (t) return this.onSend({ channel: SAY.trade, text: t[2] });
    // BARE '/trade' IS A DIFFERENT COMMAND from '/trade <msg>' above: with no
    // message body it is the trade INVITE against the current target, which
    // main.js's onSend handles (it maps to the name-based aCis TradeRequest).
    // It must be forwarded explicitly. The regex on the line above requires
    // `\s+` plus at least one character, so bare '/trade' fell through to the
    // generic unknown-command guard at the bottom of this method, which
    // printed "Unknown command: /trade" and RETURNED — making main.js's
    // `if (text === '/trade')` branch unreachable dead code, and taking
    // verify_tradewnd / verify_tradewnd_live down with it (2026-08-09).
    if (/^\/trade$/i.test(text)) return this.onSend({ channel: 0, text: '/trade' });
    // DEV BACKDOOR: the mock gateway's fixture commands (mock_gateway.js
    // say-handler) are recognized ops of this port — the verify suites
    // drive scenario fixtures by typing them. Not "unknown": they go out.
    if (/^\/(die|revive|partyask|clanask|tradeask|storeoffline|skilldepth|equipsword|equipdagger|interrupt)$/i.test(text)) {
      return this.onSend({ channel: 0, text });
    }
    // GM commands. Typing "//admin" in the retail client runs an admin
    // command; in aCis those do NOT arrive through Say2 — this Say2 routes
    // only "." voiced commands (Say2.java:101) — they arrive through
    // RequestBypassToServer with an "admin_" prefix
    // (RequestBypassToServer.java:51). So the translation is client-side,
    // exactly as it is in the retail client, and it is one line:
    //   //admin      -> bypass admin_admin
    //   //spawn 20001 -> bypass admin_spawn 20001
    // The server answers with its own NpcHtmlMessage, which this client
    // already renders, so the whole retail GM panel works with no new UI.
    // A non-GM account gets aCis's own refusal; nothing is gated here.
    const gm = text.match(/^\/\/(\S.*)$/);
    if (gm) return this.onSend({ gmCommand: `admin_${gm[1].trim()}` });

    // an unrecognized /command must NEVER go out as public chat (retail
    // parses commands client-side and swallows unknown ones) — local note
    const cmd = text.match(/^\/(\S+)/);
    if (cmd) {
      this.addSystem(`Unknown command: /${cmd[1]}`);
      return;
    }
    this.onSend({ channel: 0, text });
  }

  get isTyping() { return document.activeElement === this.input; }

  open() {
    this.input.style.display = 'block';
    this.input.focus();
  }

  close() {
    this.input.style.display = 'none';
    this.input.blur();
  }

  _append(html, cls = '', { channel = '', system = false, color = null } = {}) {
    const div = document.createElement('div');
    div.className = ('line ' + cls).trim();
    div.dataset.channel = channel;
    div.dataset.system = system ? '1' : '0';
    if (color) div.style.color = color;
    div.innerHTML = html;
    this.log.appendChild(div);
    while (this.log.children.length > this.maxLines) this.log.firstChild.remove();
    this._applyFilter();
    this.log.scrollTop = this.log.scrollHeight;
  }

  static esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    }[c]));
  }

  addChat(from, channel, text, target) {
    const c = CHANNELS[channel]
      || { name: String(channel ?? 'all'), color: DEFAULT_CHAT_COLOR };
    // TELL wire convention (aCis ChatTell): the packet's name is the other
    // party; your own echo arrives as "->targetName"
    let who = from;
    if (channel === 2) {
      who = String(from).startsWith('->')
        ? `me -> ${target || String(from).slice(2)}`
        : `${from} whispers`;
    }
    this._append(
      `<span class="from">[${c.name}] ${ChatBox.esc(who)}:</span> ${ChatBox.esc(text)}`,
      '', { channel, color: c.color });
    this.lines.push({
      kind: 'chat', from: String(who), channel: c.name, channelId: channel, text: String(text),
    });
  }

  addSystem(text) {
    this._append(ChatBox.esc(text), 'system', { system: true });
    this.lines.push({ kind: 'system', text: String(text) });
  }

  // sysmsg: text already rendered; color from systemmsg-e.dat when known
  addSysMsg(text, id, params = [], color = null) {
    this._append(ChatBox.esc(text), 'sysmsg', { system: true, color });
    this.lines.push({ kind: 'sysmsg', id, params, text: String(text) });
  }
}
