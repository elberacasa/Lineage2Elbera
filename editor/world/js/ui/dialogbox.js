// Source Warning/Notice styles from Interface/DialogBox.uc. Geometry and
// signed anchor offsets are decoded by tools/ui/mine_dialogbox.py; do not
// use Layout.pos here (its old fixed-point heuristic loses negative x).
// Other dialog styles, native text wrapping and hover/pressed art selection
// remain separate parity work. No browser confirm() or invented fallback art.
import { Skin } from './skin.js';
import { Font } from './font.js';

// UICommonAPI resolves one original DialogBox script for every requesting
// window. Scope it to the browser UI root so inspection pages stay isolated.
const sharedDialogs = new WeakMap();
export function sharedDialogBox(parent = document.body) {
  if (!sharedDialogs.has(parent)) sharedDialogs.set(parent, new DialogBox({ parent }));
  return sharedDialogs.get(parent);
}

async function loadDialogMetadata() {
  const read = async path => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`DialogBox source unavailable: ${path}`);
    return response.json();
  };
  const [layout, strings] = await Promise.all([
    read('/gamedata/dialogbox.json'), read('/gamedata/sysstring.json'),
  ]);
  return { layout, strings };
}

function validateMetadata({ layout, strings }, type) {
  if (layout?.format !== 'l2-dialogbox-v1'
      || layout.source?.native?.status !== 'verified'
      || !/^#[0-9A-Fa-f]{6}$/.test(layout.source.native.buttonLabelColor)
      || !Array.isArray(strings)) throw new Error('DialogBox source metadata is incomplete');
  const labels = new Map(strings.map(row => [row.id, row.string]));
  const body = layout.body;
  if (!body || ![body.width, body.height].every(Number.isFinite)
      || !(body.width > 0 && body.height > 0) || !Skin.sprite(body.texture)) {
    throw new Error('DialogBox source background is unavailable');
  }
  for (const name of ['DialogText', 'OKButton', 'CancelButton', 'CenterOKButton']) {
    const r = layout.controls?.[name];
    if (!r || ![r.x, r.y, r.width, r.height].every(Number.isFinite)
        || r.width <= 0 || r.height <= 0) throw new Error(`DialogBox missing ${name}`);
    if (name.endsWith('Button') && (!Skin.sprite(r.texture) || !labels.get(r.labelId))) {
      throw new Error(`DialogBox source label or artwork unavailable: ${name}`);
    }
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(layout.controls.DialogText.color) || !Font.ready) {
    throw new Error('DialogBox source text renderer is unavailable');
  }
  if (type === 'number') {
    const pad = layout.numberPad, edit = layout.controls.DialogBoxEdit;
    const reading = layout.controls.DialogReadingText;
    const rect = r => r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k]));
    if (!rect(pad) || !rect(edit) || !rect(reading) || !Skin.sprite(pad.texture)
        || ![pad.dialogWidth, pad.dialogHeight].every(v => Number.isFinite(v) && v > 0)
        || !/^#[0-9A-Fa-f]{6}$/.test(edit.color)
        || ![edit.textInsetX, edit.textInsetY].every(Number.isFinite)) {
      throw new Error('DialogBox source number controls are unavailable');
    }
    if (!edit.texture) {
      const frame = edit.frame;
      if (!frame || !Number.isFinite(frame.capWidth) || frame.capWidth <= 0
          || edit.width < frame.capWidth * 2 || frame.sourceHeight !== edit.height
          || ['left', 'middle', 'right'].some(part => !Skin.sprite(frame[part]))) {
        throw new Error('DialogBox original edit frame is unavailable');
      }
    } else if (!Skin.sprite(edit.texture)) throw new Error('DialogBox original edit texture is unavailable');
    if (!edit.numberColor || edit.numberColor.minimumDigits !== 5 || edit.numberColor.indexSubtract !== 2
        || !Array.isArray(edit.numberColor.colors) || edit.numberColor.colors.length !== 4
        || edit.numberColor.colors.some(color => !/^#[0-9A-Fa-f]{6}$/.test(color))) {
      throw new Error('DialogBox original number colors are unavailable');
    }
    if (pad.native?.reading?.status !== 'verified-english'
        || pad.native.reading.languageType !== 1 || pad.native.reading.groupSize !== 3
        || pad.native.reading.maximumMagnitudeDigits !== 12
        || !Array.isArray(pad.native.reading.labels) || pad.native.reading.labels.length !== 3
        || pad.native.reading.labels.some(label => typeof label !== 'string')
        || !/^#[0-9A-Fa-f]{6}$/.test(reading.color)) {
      throw new Error('DialogBox original English quantity reading is unavailable');
    }
    for (const name of [...Array.from({ length: 10 }, (_, i) => `num${i}`), 'numAll', 'numBS', 'numC']) {
      if (!rect(pad.buttons?.[name]) || !Skin.sprite(pad.buttons[name].texture)) {
        throw new Error(`DialogBox source keypad button unavailable: ${name}`);
      }
    }
  }
  return { layout, labels };
}

// The original numeric edit displays literal comma groups; GetString removes
// those commas. This helper covers the supported nonnegative ASCII input.
export function groupDialogDigits(value) {
  if (typeof value !== 'string' || !/^\d*$/.test(value)) return null;
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ConvertNumToTextNoAdena, native English branch. The exact source label
// whitespace and terminal-unit space are retained; no locale substitution.
export function readDialogDigits(value, labels) {
  if (groupDialogDigits(value) === null) return null;
  if (value.length > 12) return groupDialogDigits(value);
  const digits = value.replace(/^0+/, '');
  if (!digits) return '';
  const parts = [];
  for (let magnitude = Math.floor((digits.length - 1) / 3); magnitude >= 0; magnitude--) {
    const end = digits.length - magnitude * 3;
    const group = digits.slice(Math.max(0, end - 3), end).replace(/^0+/, '');
    if (group) parts.push(group + ' ' + (magnitude ? labels[magnitude - 1] : ''));
  }
  return parts.join(',');
}

export function dialogDigitColor(digits, edit) {
  const scheme = edit.numberColor;
  return scheme && digits.length >= scheme.minimumDigits
    ? scheme.colors[(digits.length - scheme.indexSubtract) % scheme.colors.length] : edit.color;
}

function place(element, rect) {
  Object.assign(element.style, {
    position: 'absolute', left: `${Skin.px(rect.x)}px`, top: `${Skin.px(rect.y)}px`,
    width: `${Skin.px(rect.width)}px`, height: `${Skin.px(rect.height)}px`,
  });
}

// Use the existing bitmap glyph measurements. This is browser wrapping,
// explicitly not evidence of the native NCTextBox line-breaking algorithm.
function writeMessage(element, message, rect) {
  const lines = [];
  for (const paragraph of message.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && Font.measure(next) > rect.width) { lines.push(line); line = word; }
      else line = next;
    }
    lines.push(line);
  }
  for (const line of lines) {
    const row = document.createElement('div');
    row.style.height = `${Skin.px(Font.lineHeight())}px`;
    Font.set(row, line, { color: rect.color });
    element.appendChild(row);
  }
}

export class DialogBox {
  constructor({ parent = document.body, loadMetadata = loadDialogMetadata } = {}) {
    this.parent = parent;
    this._loadMetadata = loadMetadata;
    this._metadata = null;
    this._pending = null;
    this.root = null;
    this.lastError = null;
  }

  get open() { return this.root !== null; }
  get inUse() { return this._pending !== null; }

  /** The context is returned unchanged, so callers can verify the original
   * selection/session before acting. Only explicit Confirm accepts; a reset,
   * missing source or second request never accepts. No network action here. */
  request({ type = 'warning', message, context, owner = null, parameter = 0 } = {}) {
    if (!['warning', 'notice', 'number'].includes(type) || typeof message !== 'string'
        || (type === 'number' && (!Number.isInteger(parameter) || parameter < -0x80000000 || parameter > 0x7fffffff))) {
      return Promise.reject(new TypeError('DialogBox requires a supported source message and parameter'));
    }
    // Original ShowDialog refuses a second use instead of replacing its target.
    if (this._pending) return Promise.resolve({ accepted: false, context, reason: 'busy' });
    const token = { type, message, context, owner, parameter, numberText: '', resolve: null, previousFocus: null };
    const result = new Promise(resolve => { token.resolve = resolve; });
    this._pending = token;
    this.lastError = null;
    // A failed load is retried next time. Identity guards also cover reset
    // while fetching, and reset followed immediately by a new request.
    if (!this._metadata) {
      const loading = Promise.resolve().then(() => this._loadMetadata());
      this._metadata = loading;
      loading.catch(() => { if (this._metadata === loading) this._metadata = null; });
    }
    this._metadata.then(metadata => {
      if (this._pending !== token) return;
      this._present(token, validateMetadata(metadata, type));
    }).catch(error => {
      if (this._pending !== token) return;
      this._metadata = null;
      this.lastError = error;
      console.warn('[DialogBox]', error.message);
      this._finish(token, false, 'unavailable');
    });
    return result;
  }

  _present(token, { layout, labels }) {
    const root = document.createElement('div');
    root.className = 'l2-dialogbox';
    // Browser stacking/input isolation; not a recovered game-world value.
    Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '100000',
      pointerEvents: 'auto' });
    const panel = document.createElement('div');
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', token.message);
    panel.tabIndex = -1;
    Object.assign(panel.style, { position: 'absolute', left: '50%', top: '50%',
      transform: 'translate(-50%, -50%)', width: `${Skin.px(token.type === 'number' ? layout.numberPad.dialogWidth : layout.body.width)}px`,
      height: `${Skin.px(layout.body.height)}px` });
    const body = token.type === 'number' ? document.createElement('div') : panel;
    if (body !== panel) {
      place(body, { x: 0, y: 0, width: layout.body.width, height: layout.body.height });
      panel.appendChild(body);
    }
    Skin.apply(body, layout.body.texture, { stretch: true });
    root.appendChild(panel);
    const text = document.createElement('div');
    text.dataset.control = 'DialogText';
    place(text, layout.controls.DialogText);
    text.style.overflow = 'hidden';
    writeMessage(text, token.message, layout.controls.DialogText);
    body.appendChild(text);
    const buttons = [];
    const names = token.type === 'notice' ? ['CenterOKButton'] : ['OKButton', 'CancelButton'];
    for (const name of names) {
      const rect = layout.controls[name], label = labels.get(rect.labelId);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.control = name;
      button.setAttribute('aria-label', label);
      place(button, rect);
      Object.assign(button.style, { border: '0', padding: '0', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'transparent' });
      Skin.apply(button, rect.texture, { stretch: true });
      Font.set(button, label, { color: layout.source.native.buttonLabelColor });
      button.addEventListener('click', () => this._finish(token, name !== 'CancelButton', 'button'));
      body.appendChild(button);
      buttons.push(button);
    }
    if (token.type === 'number') this._numberPad(token, panel, body, layout, labels, buttons);
    for (const event of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'keyup']) {
      root.addEventListener(event, e => e.stopPropagation());
    }
    root.addEventListener('keydown', e => {
      e.stopPropagation();
      // Browser focus containment only; no unverified Enter/Escape mapping.
      if (e.key === 'Tab') {
        e.preventDefault();
        const i = buttons.indexOf(document.activeElement);
        const next = i < 0 ? (e.shiftKey ? buttons.length - 1 : 0)
          : (i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next].focus();
      }
    });
    token.previousFocus = document.activeElement;
    this.root = root;
    this.parent.appendChild(root);
    (token.input || panel).focus();
  }

  _numberPad(token, panel, body, layout, labels, focusables) {
    const source = layout.numberPad, rect = layout.controls.DialogBoxEdit;
    const pad = document.createElement('div');
    pad.dataset.control = 'NumberPad'; place(pad, source);
    Skin.apply(pad, source.texture, { stretch: true }); panel.appendChild(pad);
    const edit = document.createElement('div'); place(edit, rect);
    if (rect.texture) Skin.apply(edit, rect.texture, { stretch: true });
    else {
      const cap = rect.frame.capWidth;
      for (const [part, x, width] of [['left', 0, cap], ['middle', cap, rect.width - cap * 2],
        ['right', rect.width - cap, cap]]) {
        const slice = document.createElement('div');
        place(slice, { x, y: 0, width, height: rect.height });
        Skin.apply(slice, rect.frame[part], { stretch: true }); edit.appendChild(slice);
      }
    }
    edit.style.overflow = 'hidden'; body.appendChild(edit);
    const glyphs = document.createElement('div');
    glyphs.style.pointerEvents = 'none';
    place(glyphs, { x: rect.textInsetX, y: rect.textInsetY,
      width: rect.width - rect.textInsetX, height: rect.height - rect.textInsetY });
    edit.appendChild(glyphs);
    const input = document.createElement('input');
    input.type = 'text'; input.inputMode = 'numeric'; input.value = '';
    input.dataset.control = 'DialogBoxEdit'; input.setAttribute('aria-label', token.message);
    // Browser editing/caret is an adapter; glyph painting uses the original
    // bitmap font. Native caret, selection and scroll rendering remain open.
    Object.assign(input.style, { position: 'absolute', inset: '0', width: '100%', height: '100%',
      boxSizing: 'border-box', border: '0', outline: 'none',
      padding: `${Skin.px(rect.textInsetY)}px ${Skin.px(rect.textInsetX)}px`, background: 'transparent',
      color: 'transparent', caretColor: rect.color });
    edit.appendChild(input); token.input = input; focusables.unshift(input);
    const reading = document.createElement('div');
    reading.dataset.control = 'DialogReadingText'; place(reading, layout.controls.DialogReadingText);
    reading.style.textAlign = layout.controls.DialogReadingText.align;
    body.appendChild(reading);
    const update = (digits, caretDigits = digits.length) => {
      if (this._pending !== token) return;
      const shown = groupDialogDigits(digits);
      if (shown === null) return;
      token.numberText = digits; input.value = shown;
      Font.set(glyphs, shown, { color: dialogDigitColor(digits, rect) });
      // The native magnitude reading is wired separately from digit grouping.
      this._numberReading(reading, digits, layout, labels);
      let position = 0, seen = 0;
      while (position < shown.length && seen < caretDigits) if (shown[position++] !== ',') seen++;
      input.setSelectionRange?.(position, position);
    };
    input.addEventListener('input', () => {
      const raw = input.value, before = raw.slice(0, input.selectionStart ?? raw.length);
      if (!/^[\d,]*$/.test(raw)) { update(token.numberText); return; }
      update(raw.replaceAll(',', ''), before.replaceAll(',', '').length);
    });
    for (const [name, keyRect] of Object.entries(source.buttons)) {
      const button = document.createElement('button'); button.type = 'button';
      button.dataset.control = name;
      button.setAttribute('aria-label', ({ numAll: 'All', numBS: 'Backspace', numC: 'Clear' })[name] || name.slice(3));
      place(button, keyRect);
      Object.assign(button.style, { padding: '0', border: '0', cursor: 'pointer', backgroundColor: 'transparent' });
      Skin.apply(button, keyRect.texture, { stretch: true }); pad.appendChild(button);
      focusables.push(button);
      button.addEventListener('click', () => {
        if (this._pending !== token) return;
        const start = input.value.slice(0, input.selectionStart ?? input.value.length).replaceAll(',', '').length;
        const end = input.value.slice(0, input.selectionEnd ?? input.value.length).replaceAll(',', '').length;
        const digits = token.numberText;
        if (name === 'numAll') { if (token.parameter >= 0) update(String(token.parameter)); }
        else if (name === 'numC') update('0');
        else if (name === 'numBS') {
          const cut = end > start ? start : Math.max(0, start - 1);
          update(digits.slice(0, cut) + digits.slice(end), cut);
        } else {
          // Native AddString appends to its pre-caret string and preserves
          // the post-caret part. Unlike physical OnChar it does not call the
          // selection-removal helper. Browser selection/focus is an adapter.
          const caret = input.selectionDirection === 'backward' ? start : end;
          update(digits.slice(0, caret) + name.slice(3) + digits.slice(caret), caret + 1);
        }
      });
    }
    update('');
  }

  _numberReading(element, digits, layout, labels) {
    Font.set(element, readDialogDigits(digits, layout.numberPad.native.reading.labels),
      { color: layout.controls.DialogReadingText.color });
  }

  _finish(token, accepted, reason) {
    if (this._pending !== token) return;
    // Hide and release before notifying, like HandleOK/HandleCancel: callbacks
    // may immediately request another source dialog without losing it.
    this._pending = null;
    this.root?.remove();
    this.root = null;
    if (token.previousFocus?.isConnected) token.previousFocus.focus();
    token.resolve({ accepted, context: token.context, reason,
      ...(accepted && token.type === 'number' ? { value: token.numberText } : {}) });
  }

  // Source DoDefaultAction: its initial/default None branch calls Cancel.
  // Exposed independently until the native keyboard dispatch is verified.
  defaultAction() { if (this._pending) this._finish(this._pending, false, 'default'); }
  reset(owner) {
    if (this._pending && (owner === undefined || this._pending.owner === owner)) {
      this._finish(this._pending, false, 'reset');
    }
  }
  dispose() { this.reset(); }
}
