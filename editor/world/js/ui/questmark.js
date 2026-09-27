// Original ExShowQuestMark -> QuestBtnWnd -> QuestTreeWnd focus flow.
// Elbera Tools source receipt: tools/ui/check_questmark_native.py.
// Original discrete timers/geometry; browser compositing is not native GPU parity.
import { Skin } from './skin.js';
import { WndMgr } from './wndmgr.js';


// NWindow timer records accumulate Float32 seconds, test strictly > period,
// and enqueue at most one callback per record per frame before dispatching any.
export class QuestMarkEffect {
  constructor() { this.timers = []; this.blink = false; this.active = false; this.alpha = 0; this.scale = 50; }
  begin() {
    this.alpha = 0; this.scale = 50; this.rising = true; this.active = true;
    // Native SetTimer appends; repeated BeginEffect does not deduplicate/reset blink.
    for (const [id, ms] of [[0, 500], [1, 10], [2, 50]])
      this.timers.push({ id, period: Math.fround(ms / 1000), elapsed: 0, dead: false });
  }
  advance(delta) {
    delta = Math.fround(delta);
    if (!Number.isFinite(delta) || delta < 0) throw new RangeError('finite nonnegative UI delta required');
    this.timers = this.timers.filter(t => !t.dead);
    const events = [];
    for (const timer of this.timers) {
      const elapsed = Math.fround(timer.elapsed + delta);
      if (!Number.isFinite(elapsed)) throw new RangeError('UI timer overflow');
      timer.elapsed = elapsed;
      if (elapsed > timer.period) {
        timer.elapsed = Math.fround(elapsed - timer.period); events.push(timer.id);
      }
    }
    const kill = id => { const t = this.timers.find(t => t.id === id && !t.dead); if (t) t.dead = true; };
    for (const id of events) {
      if (id === 0) this.blink = !this.blink;
      if (id === 2) this.scale = (this.scale + 5) | 0;
      if (id !== 1) continue;
      if (this.rising) {
        this.alpha += 15;
        if (this.alpha > 255) { this.alpha = 255; this.rising = false; }
      } else {
        this.alpha -= 15;
        if (this.alpha < 0) {
          this.alpha = 0; this.rising = true; this.active = false; kill(1); kill(2);
        }
      }
    }
    return events;
  }
  layers(textures) {
    if (!this.active) return this.blink ? [{ ref: textures[2], x: 0, y: 0, size: 32, alpha: 255, uv: 32 }] : [];
    const size = Math.trunc((this.scale << 7) / 100), offset = 16 - Math.trunc(size / 2);
    // Both constructor slots read the first glow argument, despite XDAT's fifth string.
    return [{ ref: textures[3], x: -48, y: -48, size: 128, alpha: this.alpha & 255, uv: 128 },
      { ref: textures[3], x: offset, y: offset, size, alpha: this.alpha & 255, uv: 128 }];
  }
}

async function loadMetadata() {
  const read = async path => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`quest marker source unavailable: ${path}`);
    return response.json();
  };
  const [layout, strings] = await Promise.all([
    read('/gamedata/questmark.json'), read('/gamedata/sysstring.json'),
  ]);
  return { layout, strings };
}

function validate({ layout, strings }) {
  const b = layout?.button, p = b?.position;
  const label = Array.isArray(strings) && strings.find(r => r.id === layout?.behavior?.labelId)?.string;
  if (layout?.format !== 'l2-questmark-v1' || layout.source?.status !== 'verified'
      || b?.effectType !== 1 || p?.selfAnchor !== 7 || p?.targetAnchor !== 1 || p?.target !== 'ChatWnd'
      || ![b.width, b.height, p.offsetX, p.offsetY].every(Number.isFinite)
      || b.width !== 32 || b.height !== 32 || !Skin.sprite(b.texture) || !label
      || layout.behavior?.effectClock !== 'nwindow-effectbutton-v1'
      || !Array.isArray(b.sourceTextures) || b.sourceTextures.length !== 5
      || b.texture !== b.sourceTextures[0]
      || !b.sourceTextures.slice(0, 4).every(ref => Skin.sprite(ref)))
    throw new Error('original quest marker metadata is incomplete');
  return { button: b, label };
}

export class QuestMark {
  constructor(parent = document.body, { getAnchor = () => null, onOpen = () => {},
    loadMetadata: loader = loadMetadata,
    requestFrame = callback => requestAnimationFrame(callback),
    cancelFrame = id => cancelAnimationFrame(id), now = () => performance.now() } = {}) {
    this.getAnchor = getAnchor; this.onOpen = onOpen; this.loader = loader;
    this.questId = null; this.revision = 0; this.data = null; this.loading = null;
    this.lastError = null; this.disposed = false;
    this.effect = new QuestMarkEffect(); this.pointer = 0;
    this.requestFrame = requestFrame; this.cancelFrame = cancelFrame; this.now = now; this.frameId = null; this.clockRevision = 0;
    const button = document.createElement('button');
    this.root = button; button.id = 'l2-quest-mark'; button.type = 'button';
    button.style.cssText = 'position:fixed;display:none;border:0;padding:0;overflow:visible;cursor:pointer;pointer-events:auto;background-color:transparent;';
    this.layers = [0, 1].map(() => {
      const layer = document.createElement('span');
      layer.style.cssText = 'position:absolute;pointer-events:none;display:none;';
      button.appendChild(layer); return layer;
    });
    for (const name of ['pointerenter', 'pointermove', 'pointerdown', 'pointerup', 'pointerleave', 'pointercancel'])
      button.addEventListener(name, event => {
        event.stopPropagation();
        this.pointer = name === 'pointerleave' || name === 'pointercancel' ? 0 : (event.buttons & 1) ? 1 : 2;
        this._paint();
      });
    button.addEventListener('dblclick', event => event.stopPropagation());
    button.addEventListener('click', event => {
      event.stopPropagation();
      if (this.disposed || !this.data || this.questId === null) return;
      const id = this.questId;
      this.revision++; this.questId = null; delete this.root.dataset.questId;
      this.root.style.display = 'none'; // source hide does not cancel its global timers
      this.onOpen(id);
    });
    parent.appendChild(button);
    this.reposition = () => this.position();
    window.addEventListener('resize', this.reposition);
    this.observer = new MutationObserver(this.reposition);
    this.resizeObserver = new ResizeObserver(this.reposition);
    this.observedAnchor = null;
    // Prewarm source metadata, while admitting no marker without a packet.
    this._load();
  }

  _load() {
    if (this.data) return Promise.resolve(this.data);
    if (!this.loading) {
      this.loading = Promise.resolve().then(() => this.loader()).then(validate).then(data => {
        this.data = data; this.lastError = null; return data;
      }).catch(error => {
        this.loading = null; this.lastError = error;
        console.warn('[QuestBtnWnd]', error.message);
        return null; // missing original input never substitutes another icon
      });
    }
    return this.loading;
  }

  async show(questId) {
    if (!Number.isInteger(questId) || questId < -0x80000000 || questId > 0x7fffffff)
      throw new TypeError('quest marker requires the original signed int32 ID');
    if (this.disposed) return false;
    const revision = ++this.revision;
    this.questId = questId;
    const data = await this._load();
    if (!data || this.disposed || revision !== this.revision) return false;
    this.root.dataset.questId = String(questId);
    this.root.setAttribute('aria-label', data.label);
    this.root.style.width = `${Skin.px(data.button.width)}px`;
    this.root.style.height = `${Skin.px(data.button.height)}px`;
    this.effect.begin(); this._paint(); this._startClock();
    this.position(); WndMgr.raiseEl(this.root);
    return true;
  }

  _paint() {
    if (!this.data || this.disposed) return;
    const textures = this.data.button.sourceTextures;
    Skin.apply(this.root, textures[this.pointer], { stretch: true, content: { w: 32, h: 32 } });
    const paints = this.effect.layers(textures);
    for (let i = 0; i < this.layers.length; i++) {
      const el = this.layers[i], p = paints[i];
      el.style.display = p ? 'block' : 'none';
      if (!p) continue;
      Object.assign(el.style, { left: `${Skin.px(p.x)}px`, top: `${Skin.px(p.y)}px`,
        width: `${Skin.px(p.size)}px`, height: `${Skin.px(p.size)}px`, opacity: String(p.alpha / 255) });
      Skin.apply(el, p.ref, { stretch: true, content: { w: p.uv, h: p.uv } });
    }
  }

  _startClock() {
    if (this.frameId !== null) return;
    this.lastFrameTime = this.now();
    const revision = this.clockRevision;
    const tick = time => {
      if (revision !== this.clockRevision || this.disposed) return;
      this.frameId = null;
      if (this.disposed || !this.effect.timers.length) return;
      this.effect.advance(Math.max(0, (time - this.lastFrameTime) / 1000));
      this.lastFrameTime = time; this._paint();
      this.frameId = this.requestFrame(tick);
    };
    this.frameId = this.requestFrame(tick);
  }

  position() {
    if (this.disposed) return;
    const anchor = this.getAnchor();
    if (anchor !== this.observedAnchor) {
      this.observer.disconnect(); this.resizeObserver.disconnect();
      this.observedAnchor = anchor;
      if (anchor) {
        this.observer.observe(anchor, { attributes: true, attributeFilter: ['style', 'class'] });
        this.resizeObserver.observe(anchor);
      }
    }
    if (!anchor || !this.data || this.questId === null || this.disposed) {
      this.root.style.display = 'none'; return;
    }
    const rect = anchor.getBoundingClientRect(), b = this.data.button;
    // Original own BottomLeft to ChatWnd TopLeft: subtract own height.
    this.root.style.left = `${rect.left + Skin.px(b.position.offsetX)}px`;
    this.root.style.top = `${rect.top + Skin.px(b.position.offsetY - b.height)}px`;
    this.root.style.display = 'block';
  }

  reset() {
    this.revision++; this.questId = null;
    if (this.frameId !== null) this.cancelFrame(this.frameId);
    this.clockRevision++; this.frameId = null; this.effect = new QuestMarkEffect(); this.pointer = 0;
    delete this.root.dataset.questId; this.root.style.display = 'none';
  }

  dispose() {
    this.reset(); this.disposed = true;
    window.removeEventListener('resize', this.reposition);
    this.observer.disconnect(); this.resizeObserver.disconnect(); this.root.remove();
  }
}
