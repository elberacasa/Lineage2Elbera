// Phase C — DetailStatusWnd, the retail character-status window (Alt+T).
//
// WHAT THIS REPLACES
// ------------------
// js/charsheet.js used to be an AUTHORED web panel: a fixed 300px div with
// border-radius, an rgba background, two HTML <table>s of stats and a list of
// equipped gear. It never touched L2Window or Layout, so it inherited none of
// the retail chrome, and the gear list is a feature the retail window does not
// have at all. The whole window is in the mined data and was simply unused.
//
// WHERE EVERY NUMBER AND EVERY WORD COMES FROM
// --------------------------------------------
//   Interface.xdat      DetailStatusWnd, 256x335, background
//                       L2UI_CH3.PlayerStatusWnd.myinfo_back (measured
//                       content 256x335 = exactly the window, so L2Window
//                       draws it 1:1 instead of nine-slicing it). All 65
//                       child rects are read through Layout.pos/size — the
//                       decode is complete here, unlike InventoryWnd's
//                       paperdoll, so no art-mining tier is needed.
//   Interface.xdat      the LABELS. The .uc never SetText()s txtHead* —
//   (text block)        each record stores a sysstring id and a text colour
//                       in its tail (tools/xdat/parse_xdat.py
//                       parse_text_block, read via Layout.textId/color).
//                       94 -> 'P. Atk.', 104 -> 'STR', 430 -> 'Clan',
//                       1432 -> 'Status', 709 -> 'Eval. Score' ... every id
//                       resolves in sysstring-e.dat.
//   DetailStatusWnd.uc  the model. Bars are 85px wide and 12px tall
//                       (NSTATUS_SMALLBARSIZE / NSTATUS_BARHEIGHT, uc:3-4)
//                       and are RESIZED, not clipped —
//                       SetWindowSize(tex, 85*value/max, 12). Text: txtHP
//                       "HP/MaxHP", txtExp "<rate>%", txtWeight "<pct>%",
//                       txtLvName "Level ClassName", txtPVP "duels / pks",
//                       txtPledge = clan name or GetSystemString(431)
//                       'No Clan', and the pledge textbox MOVES from x=68
//                       to x=88 when a crest is present. The weight bar
//                       swaps ps_weightbar1..4 at 50 / 66.66 / 80 percent.
//   sysstring-e.dat     the label text, and the class name for txtLvName:
//                       classId -> sysstring id by the two-block rule mined
//                       and cross-checked in tools/ui/mine_classnames.py
//                       (89/89 against aCis's own ClassId enum).
//   gateway contract    charSheet{str..men, pAtk, pDef, mAtk, mDef, accuracy,
//                       evasion, critical, runSpeed, speedMul, pAtkSpd,
//                       mAtkSpd, curLoad, maxLoad}, selfStatus{hp, maxHp, mp,
//                       maxMp, cp, maxCp, level, exp, sp, name},
//                       clanInfo{id, name}.
//
// DEVIATIONS, all backend-absent — these boxes exist, are positioned from the
// xdat and are left EMPTY rather than filled with a plausible number:
//   txtRank              GetUserRankString(info.nUserRank) — nUserRank is not
//                        in the contract.
//   txtCriminalRate      karma; txtPVP duel/pk counts; txtSociality eval
//   txtPVP               score; txtRemainSulffrage recommendations left —
//   txtSociality         none of the four are bridged (UserInfo carries them;
//   txtRemainSulffrage   the gateway does not forward them yet).
//   texPledgeCrest       crest bitmaps are not served, so the crest is never
//                        drawn and txtPledge stays at the uc's no-crest x=68.
//   texHero              bHero / bNobless are not in the contract, so neither
//                        myinfo_heroicon nor myinfo_nobleicon is drawn.
//   txtName2             the nickname half of the name line; the contract
//                        carries no nickname, which is exactly the uc's own
//                        `Len(NickName) == 0` branch — txtName1 gets the
//                        name and txtName2 is cleared. Not a deviation so
//                        much as the branch retail also takes.
//   txtGmMoving          a GM-only box sharing txtMovingSpeed's rect.

import { Skin } from './skin.js';
import { Font } from './font.js';
import { Layout } from './layout.js';
import { L2Window } from './window.js';
import { WndMgr } from './wndmgr.js';
import { sysStringMeta } from '../gamedata.js';
import { loadExpTable, expFraction } from './statuswnd.js';

const WND = 'DetailStatusWnd';

// SOURCED — DetailStatusWnd.uc:3-4.
const BAR_W = 85;        // NSTATUS_SMALLBARSIZE
const BAR_H = 12;        // NSTATUS_BARHEIGHT

// SOURCED — uc HandleUpdateUserInfo: with no crest the pledge name is moved
// to rectWnd.nX + 68, with one to + 88 (the xdat's own txtPledge x).
const PLEDGE_X_NO_CREST = 68;

// SOURCED — uc: GetSystemString(431) is the clanless pledge name.
const SYS_NO_CLAN = 431;

// SOURCED — uc UpdateWeightBar: the fill texture is chosen by percentage.
const WEIGHT_BARS = [
  { max: 50, tex: 'L2UI_CH3.PlayerStatusWnd.ps_weightbar1' },
  { max: 66.66, tex: 'L2UI_CH3.PlayerStatusWnd.ps_weightbar2' },
  { max: 80, tex: 'L2UI_CH3.PlayerStatusWnd.ps_weightbar3' },
  { max: Infinity, tex: 'L2UI_CH3.PlayerStatusWnd.ps_weightbar4' },
];

// The five gauges, in the order the window declares them. Each names its own
// texture in the xdat; none has a back plate, because myinfo_back paints the
// empty channel already (which is why the mined width is 0 — the uc sets it).
const BARS = ['texHP', 'texMP', 'texExp', 'texCP', 'texWeight'];

// Every static label: control -> nothing but its own name. The TEXT and the
// COLOUR both come out of the control's own record; this list only says which
// controls are labels rather than value boxes.
const LABELS = [
  'txtHeadPledge', 'txtLvHead', 'txtHeadRank',
  'txtHeadFight', 'txtHeadPhysicalAttack', 'txtHeadPhysicalDefense',
  'txtHeadHitRate', 'txtHeadCriticalRate', 'txtHeadPhysicalAttackSpeed',
  'txtHeadMagicalAttack', 'txtHeadMagicDefense', 'txtHeadPhysicalAvoid',
  'txtHeadMovingSpeed', 'txtHeadMagicCastingSpeed',
  'txtHeadBasic', 'txtHeadSTR', 'txtHeadDEX', 'txtHeadCON',
  'txtHeadINT', 'txtHeadWIT', 'txtHeadMEN',
  'txtHeadSocial', 'txtHeadCriminalRate', 'txtHeadPVP',
  'txtHeadSociality', 'txtHeadRemainSulffrage',
];

// Value boxes fed straight from the contract. The KEY is the charSheet field;
// the uc writes each of these with a bare string(value).
const VALUES = [
  ['txtPhysicalAttack', 'pAtk'],
  ['txtPhysicalDefense', 'pDef'],
  ['txtHitRate', 'accuracy'],
  ['txtCriticalRate', 'critical'],
  ['txtPhysicalAttackSpeed', 'pAtkSpd'],
  ['txtMagicalAttack', 'mAtk'],
  ['txtMagicDefense', 'mDef'],
  ['txtPhysicalAvoid', 'evasion'],
  ['txtMagicCastingSpeed', 'mAtkSpd'],
  ['txtSTR', 'str'], ['txtDEX', 'dex'], ['txtCON', 'con'],
  ['txtINT', 'int'], ['txtWIT', 'wit'], ['txtMEN', 'men'],
];

// Boxes the retail window fills from UserInfo fields the bridge does not
// forward. They are POSITIONED (so the window is not silently missing rows)
// and left blank — see the DEVIATIONS list in the header.
const UNBRIDGED = ['txtRank', 'txtCriminalRate', 'txtPVP',
                   'txtSociality', 'txtRemainSulffrage'];

let _classNames = null;
function classNames() {
  if (!_classNames) {
    _classNames = fetch('/ui/classnames.json')
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _classNames;
}

export class DetailStatusWnd {
  /**
   * @param {object} o
   *  getSelf()  -> the selfStatus payload {hp,maxHp,mp,maxMp,cp,maxCp,
   *                level,exp,sp}. REQUIRED.
   *  getSheet() -> the charSheet payload. REQUIRED.
   *  getChar()  -> the enterWorld char {name, classId}. OPTIONAL — the
   *                selfStatus payload carries neither, so without this the
   *                name line and the class half of the level line stay
   *                EMPTY rather than showing something invented.
   *  getClan()  -> the clanInfo payload {id, name}. OPTIONAL — without it
   *                the pledge line shows sysstring 431 'No Clan', which is
   *                the client's own clanless text, not a placeholder.
   * All four are plain properties, so a caller that only learns the name
   * later (main.js sets `selfName` on enterWorld) can assign
   * `wnd.getChar = () => ({name: selfName, classId})` after construction.
   */
  constructor(parent = document.body,
              { getSelf, getSheet, getChar, getClan } = {}) {
    this.getSelf = getSelf || (() => null);
    this.getSheet = getSheet || (() => null);
    this.getChar = getChar || (() => null);
    this.getClan = getClan || (() => null);
    this._strings = null;
    this._classes = null;

    const def = Layout.window(WND);          // kept for def.children below
    const wndSize = Layout.windowSize(WND);
    this.w = wndSize.w;
    this.h = wndSize.h;

    // The window record's own texture IS a full-window interior, so L2Window
    // draws it 1:1 (its `ownFits` path) exactly as ClanWnd/ActionWnd do.
    // Title: the window's own 'Status' head string (sysstring 1432, the id
    // txtHeadRank carries) is the in-body column head, not the frame caption;
    // the xdat stores no caption for this window, so the frame is titled from
    // the same string the client uses for the concept. AUTHORED choice of
    // WHICH mined string, not of the words.
    this.wnd = new L2Window({
      title: 'Status', width: this.w, height: this.h, winName: WND,
    });
    this.wnd.root.id = 'l2-detailstatuswnd';
    // Verification handle. main.js does not publish this window on
    // window.__world (it builds it through js/charsheet.js), so
    // verify_detailstatuswnd.js reaches it through its own root. Same role as
    // the __world hooks in main.js; nothing in the client reads it.
    this.wnd.root.__wnd = this;
    parent.appendChild(this.wnd.root);
    this.body = this.wnd.body;

    this.el = {};        // control name -> element
    this.bars = {};      // gauge name -> element

    // Build in the xdat's OWN child order, not in a convenient one. The
    // client draws children in declaration order, and this window relies on
    // it: texHP/texMP/texExp/texCP/texWeight are declared BEFORE
    // txtHP..txtSP, so the readouts paint on top of the bars they sit on.
    // Building the text first put the 85px-wide bars over their own numbers
    // and the HP/MP/CP figures vanished.
    for (const c of (def && def.children) || []) {
      if (c.type === 'Texture' && BARS.includes(c.name)) this._bar(c.name);
      else if (c.type === 'TextBox') this._box(c.name);
    }

    // WndMgr.register restores a stored position if the player has moved this
    // window before; only dock at the xdat's own spot when it has not.
    const placed = this.wnd.root.style.left;
    WndMgr.register(WND, this);
    if (!placed && !this.wnd.root.style.left) this.onDefaultPosition();
    loadExpTable();
    this._loadStrings();
    this.clear();
  }

  /** WndMgr drags and raises `.root`. */
  get root() { return this.wnd.root; }

  async _loadStrings() {
    // sysstring.json is a LIST of {id, string}; index it once (same as ClanWnd)
    const [doc, c] = await Promise.all([sysStringMeta(), classNames()]);
    if (Array.isArray(doc)) {
      this._strings = {};
      for (const r of doc) this._strings[r.id] = r.string;
    }
    this._classes = c;
    if (this.visible) this.render();
  }

  /** sysstring text for an id, or null while the table is still loading. */
  _sys(id) {
    if (id == null || !this._strings) return null;
    return this._strings[id] ?? null;
  }

  /** One TextBox, placed and coloured entirely from its own record. */
  _box(name) {
    const pos = Layout.pos(WND, name);
    if (!pos) return null;                    // undecoded: draw nothing
    const size = Layout.size(WND, name);
    const el = document.createElement('div');
    el.dataset.ctrl = name;
    el.style.cssText = 'position:absolute;white-space:nowrap;'
      + `left:${Skin.px(pos.x)}px;top:${Skin.px(pos.y)}px;`;
    // Width/height are declared on the value boxes only (the labels size
    // themselves to their text). Alignment inside that box is the record's
    // own field, never chosen here: the six gauge readouts are 'center' (the
    // same centring NCStatusBarCtrl does natively), the combat/social values
    // 'right', the head labels 'left'. Getting this from the data mattered —
    // right-aligning the basic stats put txtCON's number 8px outside the
    // window and walked txtSTR's into the 'DEX' label.
    if (size && size.w) {
      const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' };
      el.style.width = `${Skin.px(size.w)}px`;
      el.style.height = `${Skin.px(size.h)}px`;
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = JUSTIFY[Layout.align(WND, name)] || 'flex-start';
    }
    this.body.appendChild(el);
    this.el[name] = el;
    return el;
  }

  /** One gauge. SOURCED (uc): a plain texture resized to 85*v/max by 12,
   *  NOT a clipped fill over a back plate — myinfo_back already paints the
   *  empty channel, which is why these records carry width 0. */
  _bar(name) {
    const pos = Layout.pos(WND, name);
    const tex = Layout.tex0(WND, name);
    if (!pos || !tex) return null;
    const el = document.createElement('div');
    el.dataset.ctrl = name;
    el.style.cssText = 'position:absolute;overflow:hidden;'
      + `left:${Skin.px(pos.x)}px;top:${Skin.px(pos.y)}px;`
      + `width:0px;height:${Skin.px(BAR_H)}px;`;
    // The bar art is an 8x12 tile the client stretches over the bar's width,
    // the same idiom Skin.gauge documents for StatusWnd.
    Skin.apply(el, tex, { stretch: true });
    this.body.appendChild(el);
    this.bars[name] = { el, tex };
    return el;
  }

  _setBar(name, frac) {
    const b = this.bars[name];
    if (!b) return;
    const f = Math.max(0, Math.min(1, frac || 0));
    // SOURCED (uc UpdateHPBar &c): Size = 85 when full, else 85*value/max.
    b.el.style.width = `${Skin.px(Math.round(BAR_W * f))}px`;
  }

  _text(name, value, color) {
    const el = this.el[name];
    if (!el) return;
    if (value == null || value === '') { el.replaceChildren(); return; }
    Font.set(el, String(value), {
      color: color || Layout.color(WND, name) || undefined,
    });
  }

  /** Static labels: text from the record's sysstring id, colour from the
   *  record's own colour dword. Nothing here is typed by hand. */
  _renderLabels() {
    for (const name of LABELS) {
      const txt = this._sys(Layout.textId(WND, name));
      if (txt) this._text(name, txt);
    }
  }

  render() {
    const s = this.getSheet() || {};
    const self = this.getSelf() || {};
    const chr = this.getChar() || {};
    const clan = this.getClan() || null;

    this._renderLabels();

    // --- name line (uc: no nickname -> txtName1 = Name, txtName2 = "") ---
    this._text('txtName1', chr.name || self.name || null);
    this._text('txtName2', null);

    // --- level line: "Level ClassName" (uc txtLvName) --------------------
    const classId = chr.classId ?? self.classId;
    const cls = this._classes && classId != null
      ? (this._classes.classes[String(classId)] || {}).name : null;
    this._text('txtLvName',
      self.level != null ? [self.level, cls].filter(Boolean).join(' ') : null);

    // --- clan (uc: name, or sysstring 431 'No Clan'; no crest -> x=68) ---
    const pledge = this.el.txtPledge;
    if (pledge) {
      const inClan = !!(clan && clan.id && clan.name);
      // SOURCED (uc): the crest branch is the only thing that moves this box,
      // and crests are not served, so it always takes the no-crest x.
      pledge.style.left = `${Skin.px(PLEDGE_X_NO_CREST)}px`;
      this._text('txtPledge', inClan ? clan.name : this._sys(SYS_NO_CLAN),
        // SOURCED (uc): PledgeNameColor is (176,155,121) in a clan and pure
        // white when clanless.
        inClan ? '#B09B79' : '#FFFFFF');
    }

    // --- gauges + their readouts (uc HandleUpdateUserInfo) ---------------
    const frac = (v, m) => (m ? v / m : 0);
    this._setBar('texHP', frac(self.hp, self.maxHp));
    this._setBar('texMP', frac(self.mp, self.maxMp));
    this._setBar('texCP', frac(self.cp, self.maxCp));
    this._text('txtHP', self.maxHp != null ? `${self.hp ?? 0}/${self.maxHp}` : null);
    this._text('txtMP', self.maxMp != null ? `${self.mp ?? 0}/${self.maxMp}` : null);
    this._text('txtCP', self.maxCp != null ? `${self.cp ?? 0}/${self.maxCp}` : null);

    // exp: the uc feeds the bar an already-percentage rate and prints it with
    // a '%'. The rate is the fraction of the way to the next level, from the
    // same server-exported level table StatusWnd uses.
    const ef = expFraction(self.exp, self.level);
    const e = ef != null ? ef : (self.exp > 0 && self.exp < 1 ? self.exp : null);
    this._setBar('texExp', e || 0);
    this._text('txtExp', e != null ? `${(e * 100).toFixed(2)}%` : null);

    // weight: percentage carried, and the fill texture the uc picks for it
    // wfrac is the fraction; wpct is the same number as a percentage for
    // the label and for the WEIGHT_BARS thresholds, which the uc states in
    // percent. The 100s are the percent<->fraction conversion, nothing else.
    const wfrac = s.maxLoad ? (s.curLoad || 0) / s.maxLoad : null;
    const wpct = wfrac != null ? wfrac * 100 : null;
    this._setBar('texWeight', wfrac != null ? wfrac : 0);
    this._text('txtWeight', wpct != null ? `${wpct.toFixed(2)}%` : null);
    if (wpct != null && this.bars.texWeight) {
      const pick = WEIGHT_BARS.find(b => wpct <= b.max);
      if (pick && Skin.sprite(pick.tex) && pick.tex !== this.bars.texWeight.tex) {
        this.bars.texWeight.tex = pick.tex;
        Skin.apply(this.bars.texWeight.el, pick.tex, { stretch: true });
      }
    }

    this._text('txtSP', self.sp != null ? String(self.sp) : null);

    // --- combat / basic stat values -------------------------------------
    for (const [name, key] of VALUES) {
      this._text(name, s[key] != null ? String(s[key]) : null);
    }
    // SOURCED (uc GetMovingSpeed): MVT_FAST on land is
    // nGroundMaxSpeed * fNonAttackSpeedModifier, i.e. our runSpeed * speedMul.
    this._text('txtMovingSpeed',
      s.runSpeed != null
        ? String(Math.round(s.runSpeed * (s.speedMul ?? 1))) : null);

    // --- boxes with no bridged source stay empty (see DEVIATIONS) --------
    for (const name of UNBRIDGED) this._text(name, null);
  }

  get visible() { return this.wnd.visible; }

  toggle(force) {
    const show = force ?? !this.visible;
    if (show) this.render();
    this.wnd.toggle(show);
    return this;
  }

  show() { this.render(); this.wnd.show(); return this; }
  hide() { this.wnd.hide(); return this; }

  /** WndMgr reset: SOURCED — WindowsInfo.ini [DetailStatusWnd] is absent, so
   *  the dock is the xdat record's own (0, 65). */
  onDefaultPosition() {
    const p = Layout.posOf(WND);
    this.wnd.place({ left: p.x, top: p.y });
  }

  clear() { this.hide(); }
}
