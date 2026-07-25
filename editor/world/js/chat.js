// M2+M5 chat box: bottom-left log + Enter-to-type input.
// Enter opens/focuses the input, Enter sends, Esc closes.
// M5: channel-colored lines (L2 colors), filter tabs
// (All/Shout/Whisper/Trade/System), whisper/shout/trade input prefixes
// (/w <name> <text>, /shout <text>, /trade <text>), real sysmsg text.

// L2 Say2 channel ids -> display name + line class (L2 colors)
const CHANNELS = {
  0: { name: 'all', cls: 'ch-all' },
  1: { name: 'shout', cls: 'ch-shout' },
  2: { name: 'tell', cls: 'ch-tell' },
  3: { name: 'party', cls: 'ch-party' },
  4: { name: 'clan', cls: 'ch-clan' },
  8: { name: 'trade', cls: 'ch-trade' },
  15: { name: 'hero', cls: 'ch-hero' },
};
const TABS = [
  ['all', 'All'], ['shout', 'Shout'], ['whisper', 'Whisper'],
  ['trade', 'Trade'], ['system', 'System'],
];
const TAB_CHANNELS = { shout: [1], whisper: [2], trade: [8], system: [] };

export class ChatBox {
  constructor(rootEl, logEl, inputEl, { onSend } = {}) {
    this.root = rootEl;
    this.log = logEl;
    this.input = inputEl;
    this.onSend = onSend || (() => {});
    this.lines = [];              // verification hook data
    this.maxLines = 60;
    this.filter = 'all';

    this._buildTabs();

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

  _buildTabs() {
    const bar = document.createElement('div');
    bar.id = 'chat-tabs';
    for (const [key, label] of TABS) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.tab = key;
      b.className = key === 'all' ? 'active' : '';
      b.addEventListener('click', () => {
        this.filter = key;
        for (const x of bar.children) x.classList.toggle('active', x === b);
        this._applyFilter();
      });
      bar.appendChild(b);
    }
    this.root.insertBefore(bar, this.log);
  }

  _applyFilter() {
    for (const line of this.log.children) {
      const ch = line.dataset.channel;
      const sys = line.dataset.system === '1';
      let show;
      if (this.filter === 'all') show = true;
      else if (this.filter === 'system') show = sys;
      else show = !sys && (TAB_CHANNELS[this.filter] || []).includes(Number(ch));
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
    this.onSend({ channel: 0, text });
  }

  get isTyping() { return document.activeElement === this.input; }

  open() {
    this.root.classList.add('open');
    this.input.focus();
  }

  close() {
    this.root.classList.remove('open');
    this.input.blur();
  }

  _append(html, cls = '', { channel = '', system = false } = {}) {
    const div = document.createElement('div');
    div.className = ('line ' + cls).trim();
    div.dataset.channel = channel;
    div.dataset.system = system ? '1' : '0';
    div.innerHTML = html;
    this.log.appendChild(div);
    while (this.log.children.length > this.maxLines) this.log.firstChild.remove();
    this.log.classList.add('has-lines');
    this._applyFilter();
    this.log.scrollTop = this.log.scrollHeight;
  }

  static esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    }[c]));
  }

  addChat(from, channel, text, target) {
    const c = CHANNELS[channel] || { name: String(channel ?? 'all'), cls: 'ch-all' };
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
      c.cls, { channel });
    this.lines.push({
      kind: 'chat', from: String(who), channel: c.name, channelId: channel, text: String(text),
    });
  }

  addSystem(text) {
    this._append(ChatBox.esc(text), 'system', { system: true });
    this.lines.push({ kind: 'system', text: String(text) });
  }

  // M5: pre-rendered sysmsg text (real lookup happens in gamedata.js)
  addSysMsg(text, id, params = []) {
    this._append(ChatBox.esc(text), 'sysmsg', { system: true });
    this.lines.push({ kind: 'sysmsg', id, params, text: String(text) });
  }
}
