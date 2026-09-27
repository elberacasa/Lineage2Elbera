// Original Interface.u: TutorialViewerWnd / TutorialBtnWnd / SystemMsgWnd.
// Geometry and art come from Interface.xdat through Layout. Native evidence
// is recorded in docs/native-tutorial-quest-evidence.md.
// HTML rendering is shared with the existing native HTML-control port.
import { NpcDialog } from './npcdialog.js';
import { Skin } from './skin.js';
import { Layout } from './layout.js';
import { WndMgr } from './wndmgr.js';

const VIEWER = 'TutorialViewerWnd';
const QUESTION = 'TutorialBtnWnd';

// Original Engine.dll UInput::Exec command branches. These numbers do not
// imply that every browser input is equivalent: report only after the actual
// action, and preserve the source branch conditions documented with the proof.
export const TUTORIAL_INPUT_BITS = Object.freeze({
  PLAYERPAWNMOVETO: 1,
  CAMERAPITCH: 2,
  CAMERAYAW: 2,
  ZOOMINPRESS: 4,
  ZOOMOUTPRESS: 4,
  DEFAULTCAMERA: 8,
  FIXEDDEFAULTCAMERA: 8,
  TURNBACK: 16,
});

// TutorialViewerWnd.uc:28-33. These are original script values, not a
// viewport-dependent approximation. The source adds 32 + 8 to HTML height.
export function tutorialWindowHeight(contentHeight) {
  return Math.max(256, Math.min(contentHeight, 680 - 8)) + 32 + 8;
}

// NWindow.dll:0x10144c50 replaces the armed mask. 0x10144c20 tests an
// occurring event against it, sends only an enabled event and XOR-clears it.
// Callers may report ONLY event bits whose input mapping has native evidence.
// Receiving a mask never reports an event or advances the tutorial itself.
export class TutorialEvents {
  constructor(onEvent = () => {}) { this.onEvent = onEvent; this.mask = 0; }
  arm(mask) { this.mask = mask >>> 0; }
  occurred(bit) {
    const value = bit >>> 0;
    if (!value || (value & (value - 1)) !== 0 || !(this.mask & value)) return false;
    this.onEvent(value);
    this.mask = (this.mask ^ value) >>> 0;
    return true;
  }
  reset() { this.mask = 0; }
}

function viewerSpec() {
  const window = Layout.window(VIEWER);
  const html = Layout.find(VIEWER, 'HtmlTutorialViewer');
  const top = Layout.find(VIEWER, 'texTutorialViewerBack1');
  if (!window || !html || !top) throw new Error('missing original tutorial layout');
  return {
    width: window.width, height: window.height, titleBarHeight: top.y,
    background: null, title: null,
    frame: { x: html.x, y: html.y, width: html.width, height: html.height },
    dock: null,
  };
}

export class TutorialWnd extends NpcDialog {
  constructor(parent = document.body, { onLink = () => {}, onQuestion = () => {},
    getAnchor = () => null } = {}) {
    super(parent, { onBypass: onLink, windowSpec: viewerSpec(),
      windowName: VIEWER, rootId: 'l2-tutorialwnd' });
    this.onQuestion = onQuestion;
    this.getAnchor = getAnchor;
    this.markId = null;
    this.backgrounds = new Map();
    for (const name of ['texTutorialViewerBack1', 'texTutorialViewerBack2', 'texTutorialViewerBack3']) {
      const node = Layout.find(VIEWER, name);
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;pointer-events:none;'
        + `left:${Skin.px(node.x)}px;top:${Skin.px(node.y - this.spec.titleBarHeight)}px;`
        + `width:${Skin.px(node.width)}px;height:${Skin.px(node.height)}px;`;
      Skin.apply(el, Layout.tex0(VIEWER, name), { stretch: true });
      this.win.backdrop.appendChild(el);
      this.backgrounds.set(name, el);
    }

    const def = Layout.find(QUESTION, 'btnTutorial');
    if (!def) throw new Error('missing original tutorial question button');
    const button = document.createElement('button');
    button.id = 'l2-tutorial-question';
    button.type = 'button';
    button.setAttribute('aria-label', 'Tutorial');
    button.style.cssText = 'position:fixed;display:none;border:0;padding:0;cursor:pointer;pointer-events:auto;'
      + `width:${Skin.px(def.width)}px;height:${Skin.px(def.height)}px;`;
    this.questionButton = button;
    this.questionTextures = Layout.tex(QUESTION, 'btnTutorial');
    const paint = index => Skin.apply(button, this.questionTextures[index]);
    paint(0);
    button.addEventListener('mouseenter', () => paint(2));
    button.addEventListener('mouseleave', () => paint(0));
    button.addEventListener('pointerdown', e => { e.stopPropagation(); paint(1); });
    button.addEventListener('pointerup', () => paint(2));
    button.addEventListener('click', e => {
      e.stopPropagation();
      if (this.markId == null) return;
      const markId = this.markId;
      this.markId = null;
      button.style.display = 'none';
      // Native BeginEffect stores QuestionID at +0x34c; the type-0 effect
      // button sends that exact value on release (0x1000670d..0x1000671a).
      this.onQuestion(markId);
    });
    parent.appendChild(button);
    this._positionQuestion = () => this.positionQuestion();
    window.addEventListener('resize', this._positionQuestion);
    this._clampViewer = () => this.clampToViewport();
    window.addEventListener('resize', this._clampViewer);
    this.anchorObserver = new MutationObserver(this._positionQuestion);
    this.anchorResizeObserver = new ResizeObserver(this._positionQuestion);
    this.observedAnchor = null;
    // The native effect's complete paint/timing rule is not recovered yet;
    // the original resting/hover/pressed art is shown without an invented pulse.
  }

  // `link <target>` belongs to the tutorial HTML controller. Return the
  // target exactly once, without translating it into an NPC bypass.
  _bypass(attrs) {
    const match = /^link\s+(.+)$/i.exec(String(attrs?.ACTION || ''));
    return match ? match[1] : null;
  }

  showHtml(html) {
    super.showHtml(html);
    const h = tutorialWindowHeight(this.body.scrollHeight / Skin.scale);
    const width = this.spec.width;
    this.win.body.style.height = `${Skin.px(h - this.spec.titleBarHeight)}px`;
    this.view.style.width = `${Skin.px(width - 15)}px`;
    this.view.style.height = `${Skin.px(h - 32 - 9)}px`;
    this.backgrounds.get('texTutorialViewerBack2').style.height = `${Skin.px(h - 32 - 9)}px`;
    this.backgrounds.get('texTutorialViewerBack3').style.top = `${Skin.px(h - 9 - this.spec.titleBarHeight)}px`;
    this.root.dataset.tutorialHeight = String(h);
    this.root.dataset.tutorialHtml = String(html || '');
    WndMgr.raise(VIEWER);
    this._syncThumb();
    this.clampToViewport();
  }

  // Browser presentation constraint, matching WndMgr's drag clamp. The
  // original 1024-wide desktop position can lie outside a smaller browser.
  // Keep source dimensions and content, but make the window reachable.
  clampToViewport() {
    if (!this.open) return;
    const rect = this.root.getBoundingClientRect();
    this.place({
      left: Math.max(0, Math.min(window.innerWidth - rect.width, rect.left)),
      top: Math.max(0, Math.min(window.innerHeight - rect.height, rect.top)),
    });
  }

  closeHtml() { this.close(); }

  showQuestion(markId) {
    if (!Number.isInteger(markId)) throw new Error('invalid tutorial question ID');
    this.markId = markId;
    this.questionButton.dataset.markId = String(markId);
    this.positionQuestion();
    WndMgr.raiseEl(this.questionButton);
  }

  positionQuestion() {
    const anchor = this.getAnchor();
    if (anchor !== this.observedAnchor) {
      this.anchorObserver.disconnect();
      this.anchorResizeObserver.disconnect();
      this.observedAnchor = anchor;
      if (anchor) {
        this.anchorObserver.observe(anchor, { attributes: true, attributeFilter: ['style', 'class'] });
        this.anchorResizeObserver.observe(anchor);
      }
    }
    if (!anchor || this.markId == null) { this.questionButton.style.display = 'none'; return; }
    const rect = anchor.getBoundingClientRect();
    // SystemMsgWnd.uc:45: relative window TopLeft, our BottomLeft, (5,-5).
    // Native SetAnchor reverses the two script point arguments into its
    // stored own/relative slots (0x10114b91..0x10114b99); position update
    // subtracts our point and adds the relative point (0x1005c787..c7c5).
    this.questionButton.style.left = `${rect.left + Skin.px(5)}px`;
    const height = Layout.size(QUESTION, 'btnTutorial').h;
    this.questionButton.style.top = `${rect.top - Skin.px(height + 5)}px`;
    this.questionButton.style.display = 'block';
  }

  onDefaultPosition() {
    const dock = Layout.dock(VIEWER);
    if (dock) this.place({ left: Skin.px(dock.x), top: Skin.px(dock.y) });
    this.clampToViewport();
  }

  reset() {
    this.closeHtml();
    this.markId = null;
    this.questionButton.style.display = 'none';
  }

  dispose() {
    this.reset();
    window.removeEventListener('resize', this._positionQuestion);
    window.removeEventListener('resize', this._clampViewer);
    this.anchorObserver.disconnect();
    this.anchorResizeObserver.disconnect();
    this.questionButton.remove();
    this.root.remove();
  }
}
