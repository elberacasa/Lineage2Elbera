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
// Behavior spec: ChatWnd.uc — tab model (CHAT_WINDOW_NORMAL/TRADE/PARTY/
// CLAN/ALLY + SYSTEM), MergeTab on OnDefaultPosition, and the
// SetDefaultFilterValue defaults (each tab shows its own type + shout +
// whisper + system; NORMAL shows everything but trade/ally/hero).
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
const DEFAULT_CHAT_COLOR = '#DCDCDC';

// Retail tabs and their default-visible channel sets (ChatWnd.uc
// SetDefaultFilterValue): own type + shout(1) + whisper(2) + system.
const TABS = [
  ['all', 'All', null],                       // NORMAL: everything
  ['trade', 'Trade', [8, 1, 2]],
  ['party', 'Party', [3, 1, 2]],
  ['clan', 'Clan', [4, 1, 2]],
  ['alliance', 'Alliance', [7, 1, 2]],        // no alliance traffic bridged yet
  ['system', 'System', []],
];

export class ChatBox {
  constructor(rootEl, logEl, inputEl, { onSend } = {}) {
    this.onSend = onSend || (() => {});
    this.lines = [];
    this.maxLines = 60;
    this.filter = 'all';

    const def = Layout.window(WND);
    this.w = def && def.width ? def.width : 348;
    this.h = def && def.height ? def.height : 187;

    const root = rootEl || document.createElement('div');
    root.id = 'chat';
    root.innerHTML = '';
    root.style.cssText = `position:fixed;width:${Skin.px(this.w)}px;`
      + `height:${Skin.px(this.h)}px;z-index:11;pointer-events:none;`
      + 'font:12px/1.45 -apple-system, "Segoe UI", sans-serif;';
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
    const headSize = Layout.size(WND, 'ChatWndHeadTex');
    const logTop = headSize ? headSize.h : 18;
    // divider TOP: BottomTex (h18) sits at far-edge y=-46 => bottom edge
    // 141, top edge 123 (the header's decode). The log ends above it.
    const logBottom = this.h - 46 - 18;
    this.log = document.createElement('div');
    this.log.id = 'chat-log';
    this.log.style.cssText = `position:absolute;left:${Skin.px(4)}px;`
      + `top:${Skin.px(logTop)}px;width:${Skin.px(this.w - 8)}px;`
      + `height:${Skin.px(logBottom - logTop)}px;overflow-y:auto;`
      + 'pointer-events:auto;';
    root.appendChild(this.log);
    if (logEl && logEl !== this.log) logEl.remove();

    // --- tab strip at its mined rect (23,-23 => bottom edge 164) ----------
    const tabPos = Layout.pos(WND, 'ChatTabCtrl');
    const tabSize = Layout.size(WND, 'ChatTabCtrl');
    this.tabs = document.createElement('div');
    this.tabs.id = 'chat-tabs';
    this.tabs.style.cssText = 'position:absolute;display:flex;pointer-events:auto;';
    if (tabPos && tabSize) {
      this.tabs.style.left = `${Skin.px(tabPos.x)}px`;
      this.tabs.style.top = `${Skin.px(this.h + tabPos.y - tabSize.h)}px`;
      this.tabs.style.width = `${Skin.px(tabSize.w)}px`;
      this.tabs.style.height = `${Skin.px(tabSize.h)}px`;
    }
    root.appendChild(this.tabs);
    for (const [key, label] of TABS) {
      const b = document.createElement('button');
      b.dataset.tab = key;
      b.className = key === 'all' ? 'active' : '';
      b.addEventListener('click', () => {
        this.filter = key;
        for (const x of this.tabs.children) x.classList.toggle('active', x === b);
        this._applyFilter();
      });
      this.tabs.appendChild(b);
      Font.set(b, label, { color: key === 'all' ? '#c9a959' : '#8a93a5' });
    }

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
    this.input.maxLength = 200;
    this.input.placeholder = 'say… (Enter to send, Esc to close)';
    this.input.style.cssText = `position:absolute;`
      + `left:${Skin.px(editPos ? editPos.x : 39)}px;`
      + `top:${Skin.px(editPos ? this.h + editPos.y - editSize.h : this.h - 22)}px;`
      + `width:${Skin.px(editSize ? editSize.w : 303)}px;`
      + `height:${Skin.px(editSize ? editSize.h : 16)}px;`
      + 'display:none;pointer-events:auto;box-sizing:border-box;'
      + 'background:rgba(16,19,26,.92);color:#e6eaf2;border:1px solid #333a48;'
      + 'border-radius:2px;font:inherit;outline:none;padding:0 4px;';
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
    el.style.left = '8px';
    el.style.bottom = '8px';
    this.filter = 'all';
    for (const x of this.tabs.children) x.classList.toggle('active', x.dataset.tab === 'all');
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

  _applyFilter() {
    const tab = TABS.find(t => t[0] === this.filter) || TABS[0];
    for (const line of this.log.children) {
      const ch = Number(line.dataset.channel);
      const sys = line.dataset.system === '1';
      let show;
      if (this.filter === 'all') show = true;
      else if (this.filter === 'system') show = sys;
      else show = !sys && tab[2].includes(ch);
      line.style.display = show ? '' : 'none';
    }
  }

  // parse input prefixes into a say op payload
  _submit(text) {
    const m = text.match(/^\/(w|whisper|tell)\s+(\S+)\s+([\s\S]+)$/i);
    if (m) return this.onSend({ channel: 2, target: m[2], text: m[3] });
    const s = text.match(/^\/(shout)\s+([\s\S]+)$/i);
    if (s) return this.onSend({ channel: 1, text: s[2] });
    const t = text.match(/^\/(trade)\s+([\s\S]+)$/i);
    if (t) return this.onSend({ channel: 8, text: t[2] });
    // DEV BACKDOOR: the mock gateway's fixture commands (mock_gateway.js
    // say-handler) are recognized ops of this port — the verify suites
    // drive scenario fixtures by typing them. Not "unknown": they go out.
    if (/^\/(die|revive|partyask|clanask|tradeask|storeoffline|skilldepth|equipsword|equipdagger|interrupt)$/i.test(text)) {
      return this.onSend({ channel: 0, text });
    }
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
