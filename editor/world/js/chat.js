// M2 chat box: bottom-left log + Enter-to-type input.
// Enter opens/focuses the input, Enter sends, Esc closes.
// System messages (connect/disconnect/enter world) render in green.

// L2 chat channel ids -> display names (numeric per the real gateway)
const CHANNEL_NAMES = {
  0: 'all', 1: 'shout', 2: 'tell', 3: 'party', 4: 'clan',
  5: 'gm', 6: 'petition', 7: 'trade', 8: 'alliance', 17: 'partyroom',
};

export class ChatBox {
  constructor(rootEl, logEl, inputEl, { onSend } = {}) {
    this.root = rootEl;
    this.log = logEl;
    this.input = inputEl;
    this.onSend = onSend || (() => {});
    this.lines = [];              // verification hook data
    this.maxLines = 60;

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text) this.onSend(text);
        this.input.value = '';
        this.close();
      } else if (e.key === 'Escape') {
        this.input.value = '';
        this.close();
      }
    });
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

  _append(html, cls = '') {
    const div = document.createElement('div');
    div.className = ('line ' + cls).trim();
    div.innerHTML = html;
    this.log.appendChild(div);
    while (this.log.children.length > this.maxLines) this.log.firstChild.remove();
    this.log.classList.add('has-lines');
    this.log.scrollTop = this.log.scrollHeight;
  }

  static esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    }[c]));
  }

  addChat(from, channel, text) {
    const ch = channel == null ? 'all'
      : (CHANNEL_NAMES[channel] || String(channel));
    this._append(
      `<span class="from">[${ChatBox.esc(ch)}] ${ChatBox.esc(from)}:</span> ${ChatBox.esc(text)}`,
      ch === 'shout' ? 'shout' : '');
    this.lines.push({ kind: 'chat', from: String(from), channel: ch, text: String(text) });
  }

  addSystem(text) {
    this._append(ChatBox.esc(text), 'system');
    this.lines.push({ kind: 'system', text: String(text) });
  }
}
