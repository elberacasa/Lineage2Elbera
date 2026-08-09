// Phase C.12 — ClanWnd, the retail clan window (Alt+N).
//
// Structure and behaviour come from the client, not from guesswork:
//
//   Interface.xdat    ClanWnd 256x335, back L2UI_CH3.BloodHoodWnd.bloodhood_back
//                     (measured 256x335 of content = the whole body). Every
//                     control rect below is read via Layout.* — verified
//                     against the binary (e.g. ClanQuitBtn x=170 y=253
//                     76x23). The button LABELS are not in the .uc — they are
//                     a sysstring id at each Button record's tail, mined from
//                     the binary (ClanQuitBtn -> 337 'Leave', ClanAskJoinBtn
//                     -> 330 'Invite', ...). The ListCtrl carries an inline
//                     "ClanInfo" schema: header (100,6,1,19,19), 4 columns —
//                     Name(sysid 50) 127px, Lv(537) 30px, Cls(391) 30px,
//                     Status(346) 50px = the 237px width exactly.
//   ClanWnd.uc        the model: AddToList colours (self bright white
//                     255,255,255, others 170,170,170 — uc:1175-1288),
//                     class icon via GetClassIconName at 11x11 (uc:1292-1293),
//                     online icon BloodHood_Logon/Logoff at 31x11
//                     (uc:1294-1295, 1302-1308), ClanCurrentNum "(on/total)"
//                     (uc:1317), combobox entry "<group> - <clanName>"
//                     (uc:1594, group names sysstring 1399/1400-1405/1452).
//                     ClanQuitBtn disabled for the clan master (uc:879);
//                     every button disabled while clanless (uc:659-672).
//   NWindow.dll       GetClassIconName is a native thunk: 16 icon refs +
//                     the classId->icon map mined into classicons.json by
//                     tools/ui/mine_classicons.py (tier 5).
//   gateway/README    the port's contract: clanInfo{id,name,leaderName,
//   M14               level,crestId?,allyId?,allyName?} (id 0 = no clan),
//                     clanMembers{members[{id,name,level,classId,online}]}
//                     (id = online objectId, 0 offline; MAIN CLAN ONLY —
//                     sub-pledges are decoded but not bridged), clanAsk
//                     {from,clanName} in; clanInvite{name}/clanAnswer/
//                     clanLeave/clanOust{name} out.
//
// Static field labels (title0..3): the xdat stores them as inline KOREAN
// text (혈맹명 clan-name, 혈맹주 clan-master, 본거지 home-base, LV) which
// the Latin-only retail font sheets (chars 32-126) cannot render. The port
// shows AUTHORED English translations of the mined Korean.
//
// DEVIATIONS (all backend-absent): sub-pledge combobox has a single entry
// (the bridge models the main clan only) and does not drop down;
// ClanAgitText shows 'None' (sysstr 27 — Clear()'s default, uc:938) and
// ClanStatusText stays empty (uc:939) because agit/castle/war state are not
// in the contract; buttons without a backend render DISABLED (Member Info,
// Privileges, Community, Clan Info, Penalty, War Info, Declare/End War,
// Edit Privileges, Edit Crest); InviteClanPopWnd is skipped (pledgeType is
// always 0 in the contract); oust rides a per-row x (leader only) exactly
// like PartyWnd's kick — retail's Banish lives in the ClanMemberInfoWnd
// drawer, which has no contract data to show.
// HeroBtn is never shown: NoblessMenuValidate (uc:262-283) only swaps it in
// for clanless hero/nobless chars, flags not in the contract.

import { Skin } from './skin.js';
import { Font } from './font.js';
import { Layout } from './layout.js';
import { L2Window } from './window.js';
import { WndMgr } from './wndmgr.js';
import { sysStringMeta, classIcons } from '../gamedata.js';

const WND = 'ClanWnd';

// Member row colours: SOURCED — ClanWnd.uc AddToList (uc:1175-1189).
// Member-row name tints. No xdat record governs a ListCtrl row, but the
// window's own uscript does: ClanWnd.uc:1178-1180 sets White = (170,170,170)
// and :1175-1177 BrightWhite = (255,255,255), and :1269 assigns BrightWhite
// to a row's LVDataList[0].TextColor. SOURCED, from the .uc oracle rather
// than from Interface.xdat -- both values are also in the xdat's 22.
const COLOR_NAME = '#aaaaaa';        // ClanWnd.uc:1178-1180 White
const COLOR_SELF = '#ffffff';        // ClanWnd.uc:1175-1177 BrightWhite

// ListCtrl "ClanInfo" schema, mined from the xdat record (see header):
// header dwords (100,6,1,19,19) then per column (sysid, width, ...).
const ROW_H = 19;                    // SOURCED: schema row height
// Each id is a sysstring key; each width is the column width the same
// ListCtrl schema record carries. Both are decoded, neither is chosen.
const COLUMNS = [
  { sysid: 50, w: 127 },             // sysstring 'Name'
  { sysid: 537, w: 30 },             // sysstring 'Lv'
  { sysid: 391, w: 30 },             // sysstring 'Cls'
  { sysid: 346, w: 50 },             // sysstring 'Status'
];
const ICON_CLASS = { w: 11, h: 11 }; // SOURCED: uc:1292-1293 nTextureWidth/Height
const ICON_ONLINE = { w: 31, h: 11 }; // SOURCED: uc:1294-1295
const ICON_ON = 'L2UI_CH3.BloodHoodWnd.BloodHood_Logon';    // uc:1302
const ICON_OFF = 'L2UI_CH3.BloodHoodWnd.BloodHood_Logoff';  // uc:1308

// Button labels: sysstring ids mined from each Button record's tail (xdat
// binary; the .uc never SetText()s them). English text resolves through
// sysstring.json at runtime; the mined string is the offline fallback.
const BUTTONS = [
  { id: 'ClanMemInfoBtn', sysid: 1322, fallback: 'Member Info', role: null },
  { id: 'ClanMemAuthBtn', sysid: 1323, fallback: 'Privileges', role: null },
  { id: 'ClanBoardBtn', sysid: 387, fallback: 'Community', role: null },
  { id: 'ClanInfoBtn', sysid: 201, fallback: 'Clan Info', role: null },
  { id: 'ClanPenaltyBtn', sysid: 1207, fallback: 'Penalty', role: null },
  { id: 'ClanQuitBtn', sysid: 337, fallback: 'Leave', role: 'leave' },
  { id: 'ClanWarInfoBtn', sysid: 1324, fallback: 'War Info', role: null },
  { id: 'ClanWarDeclareBtn', sysid: 1205, fallback: 'Declare War', role: null },
  { id: 'ClanWarCancleBtn', sysid: 1206, fallback: 'End War', role: null },
  { id: 'ClanAskJoinBtn', sysid: 330, fallback: 'Invite', role: 'invite' },
  { id: 'ClanAuthEditBtn', sysid: 1325, fallback: 'Edit Privileges', role: null },
  { id: 'ClanTitleManageBtn', sysid: 1326, fallback: 'Edit Crest', role: null },
];

const SYS_AGIT_NONE = 27;            // uc:938 Clear() default
const SYS_GROUP_MAIN = 1399;         // sysstring id, ClanWnd.uc:1594 combobox group name

export class ClanWnd {
  constructor(parent = document.body,
              { onLeave, onInvite, onOust, onAnswer, getTarget, getSelfName } = {}) {
    this.onLeave = onLeave || (() => {});
    this.onInvite = onInvite || (() => {});
    this.onOust = onOust || (() => {});
    this.onAnswer = onAnswer || (() => {});
    this.getTarget = getTarget || (() => null);
    this.getSelfName = getSelfName || (() => '');

    this.clan = null;                // clanInfo payload
    this.members = [];               // clanMembers payload
    this.selected = null;            // member name (ListCtrl selection)
    this._strings = null;            // sysstring.json (id -> text)
    this._icons = null;              // classicons.json

    const def = Layout.windowSize(WND);
    this.w = def.w;
    this.h = def.h;

    const win = new L2Window({
      title: 'Clan', width: this.w, height: this.h, closable: true,
      back: 'none',   // bloodhood_back paints the body (measured 256x335)
    });
    win.root.id = 'l2-clanwnd';
    this.win = win;
    this.root = win.root;

    const back = document.createElement('div');
    back.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    Skin.apply(back, 'L2UI_CH3.BloodHoodWnd.bloodhood_back', { stretch: true });
    win.body.appendChild(back);

    // --- static field labels + value fields (rects from the xdat) ---
    this._text('title0', 'Name');       // AUTHORED English (inline 혈맹명)
    this._text('title1', 'Master');     // AUTHORED English (inline 혈맹주)
    this._text('title2', 'Base');       // AUTHORED English (inline 본거지)
    this._text('title3', 'LV');         // inline text IS Latin 'LV'
    this.nameEl = this._text('ClanNameText', '');
    this.masterEl = this._text('ClanMasterNameText', '');
    this.agitEl = this._text('ClanAgitText', '');
    this.statusEl = this._text('ClanStatusText', '');
    this.levelEl = this._text('ClanLevelText', '');
    this.countEl = this._text('ClanCurrentNum', '');

    // --- group combobox: one entry, no dropdown (DEVIATION — see header) ---
    const cbPos = Layout.posOf(WND, 'ComboboxMainClanWnd');
    const cbSize = Layout.sizeOf(WND, 'ComboboxMainClanWnd');
    this.comboEl = document.createElement('div');
    this.comboEl.style.cssText = 'position:absolute;display:flex;'
      + 'align-items:center;pointer-events:none;'
      + `left:${Skin.px(cbPos.x)}px;top:${Skin.px(cbPos.y)}px;`
      + `width:${Skin.px(cbSize.w)}px;height:${Skin.px(cbSize.h)}px;`;
    win.body.appendChild(this.comboEl);

    // --- member list: header row + scrollable rows over the ListCtrl rect ---
    const listPos = Layout.posOf(WND, 'ClanMemberList');
    const listSize = Layout.sizeOf(WND, 'ClanMemberList');
    const listEl = document.createElement('div');
    listEl.style.cssText = 'position:absolute;pointer-events:auto;'
      + `left:${Skin.px(listPos.x)}px;top:${Skin.px(listPos.y)}px;`
      + `width:${Skin.px(listSize.w)}px;height:${Skin.px(listSize.h)}px;`;
    win.body.appendChild(listEl);
    this.headerEl = document.createElement('div');
    this.headerEl.style.cssText = `display:flex;height:${Skin.px(ROW_H)}px;`
      + 'align-items:center;';
    listEl.appendChild(this.headerEl);
    this.rowsEl = document.createElement('div');
    this.rowsEl.style.cssText = 'overflow-y:auto;overflow-x:hidden;'
      + `height:${Skin.px(listSize.h - ROW_H)}px;`;
    listEl.appendChild(this.rowsEl);

    // --- the 13 mined buttons ---
    this._btns = new Map();
    for (const b of BUTTONS) {
      const pos = Layout.pos(WND, b.id);
      const size = Layout.sizeOf(WND, b.id);
      if (!pos) continue;
      const el = document.createElement('div');
      el.dataset.btn = b.id;
      el.style.cssText = `position:absolute;left:${Skin.px(pos.x)}px;`
        + `top:${Skin.px(pos.y)}px;width:${Skin.px(size.w)}px;`
        + `height:${Skin.px(size.h)}px;display:flex;align-items:center;`
        + 'justify-content:center;';
      const tex = Layout.tex(WND, b.id).filter(r => Skin.sprite(r));
      if (tex[0]) Skin.apply(el, tex[0], { stretch: true });
      // BUTTONS are real ClanWnd Button records; Button records carry no
      // colour in the xdat, so NCButton's own choice governs.
      // SOURCED NWindow.dll 0x100035a8.
      Font.set(el, this._str(b.sysid, b.fallback), { color: Layout.native('buttonLabel') });
      if (b.role === 'leave') {
        el.addEventListener('click', () => {
          if (this._leaveEnabled()) this.onLeave();
        });
      } else if (b.role === 'invite') {
        el.addEventListener('click', () => {
          const t = this.getTarget();
          if (this._inviteEnabled() && t && t.name) this.onInvite(t.name);
        });
      }
      this._btns.set(b.id, el);
      win.body.appendChild(el);
    }

    // --- the clanAsk prompt (AUTHORED — retail uses DialogBox, see party) ---
    this._buildAsk(parent);

    sysStringMeta().then(doc => {
      if (!doc) return;
      this._strings = {};
      for (const r of doc) this._strings[r.id] = r.string;
      this._refreshLabels();
    });
    classIcons().then(doc => { this._icons = doc || null; this._render(); });

    parent.appendChild(win.root);
    // AUTHORED: WindowsInfo.ini has no [ClanWnd] and the xdat's (0,65) is
    // a bare default every top-level record carries. Bottom-right cell of
    // the toggle-window 2x2 tile (see skillwnd.js for the reasoning).
    this.defaultPlace = { right: 276, top: 424 };
    this._render();
  }

  // Default colour: NCTextBox's own field-0x348 initialiser, decoded from
  // NWindow.dll (Layout.native('textBoxDefault')). Callers that name a
  // control with its own xdat colour pass Layout.textColor() instead.
  _text(ctrl, initial, color = Layout.native('textBoxDefault')) {
    const pos = Layout.posOf(WND, ctrl);
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;pointer-events:none;'
      + `left:${Skin.px(pos.x)}px;top:${Skin.px(pos.y)}px;`;
    this.win.body.appendChild(el);
    if (initial) Font.set(el, initial, { color });
    return el;
  }

  _str(sysid, fallback) {
    return (this._strings && this._strings[sysid]) || fallback;
  }

  _refreshLabels() {
    for (const b of BUTTONS) {
      const el = this._btns.get(b.id);
      if (el) Font.set(el, this._str(b.sysid, b.fallback), { color: Layout.native('buttonLabel') });
    }
    this._render();
  }

  /** clanInfo op (id 0 = no clan). */
  setClan(info) {
    this.clan = info && info.id ? info : null;
    if (!this.clan) this.selected = null;
    this._render();
    return this;
  }

  /** clanMembers op — FULL snapshot keyed by name (gateway M14). */
  setMembers(members) {
    this.members = members || [];
    if (this.selected && !this.members.some(m => m.name === this.selected)) {
      this.selected = null;
    }
    this._render();
    return this;
  }

  _inClan() { return !!this.clan; }
  _isLeader() {
    return !!(this.clan && this.clan.leaderName
              && this.clan.leaderName === this.getSelfName());
  }

  // uc:879 — the clan master cannot leave (aCis rejects it server-side too:
  // RequestWithdrawPledge, "leader cannot withdraw").
  _leaveEnabled() { return this._inClan() && !this._isLeader(); }

  // uc:670 disables invite while clanless; uc:895-896 wants the Join auth,
  // which is NOT in the contract — DEVIATION: any member may click, the
  // server enforces the privilege (silent refuse is the aCis answer).
  _inviteEnabled() {
    if (!this._inClan()) return false;
    const t = this.getTarget();
    return !!(t && t.name && t.kind === 'player' && t.name !== this.getSelfName());
  }

  _render() {
    const clan = this.clan;
    // value fields (ClanAgitText/ClanStatusText: contract carries no agit,
    // castle or war state — Clear()'s defaults, uc:938-939)
    // each value field takes its OWN record's colour. All five are #AF9878
    // in Interface.xdat -- the port painted them #dcdcdc, which is the
    // colour of the title0..3 LABELS beside them, not of the values.
    Font.set(this.nameEl, clan ? clan.name || '' : '',
             { color: Layout.textColor(WND, 'ClanNameText') });
    Font.set(this.masterEl, clan ? clan.leaderName || '' : '',
             { color: Layout.textColor(WND, 'ClanMasterNameText') });
    Font.set(this.agitEl, clan ? this._str(SYS_AGIT_NONE, 'None') : '',
             { color: Layout.textColor(WND, 'ClanAgitText') });
    Font.set(this.statusEl, '',
             { color: Layout.textColor(WND, 'ClanStatusText') });
    Font.set(this.levelEl, clan && clan.level != null ? String(clan.level) : '',
             { color: Layout.textColor(WND, 'ClanLevelText') });

    // combobox: "<group> - <clan name>" (uc:1594), one entry (DEVIATION)
    this.comboEl.replaceChildren();
    if (clan) {
      const entry = document.createElement('div');
      // ComboboxMainClanWnd is a real record that carries no colour, so the
      // engine default applies (NCTextBox field 0x348, NWindow.dll 0x10052aca)
      Font.set(entry, `${this._str(SYS_GROUP_MAIN, 'Main Clan')} - ${clan.name || ''}`,
               { color: Layout.textColor(WND, 'ComboboxMainClanWnd') });
      this.comboEl.appendChild(entry);
    }

    // "(online/total)" — uc:1317
    const online = this.members.filter(m => m.online || m.id > 0).length;
    Font.set(this.countEl, clan ? `(${online}/${this.members.length})` : '',
             { color: Layout.textColor(WND, 'ClanCurrentNum') });

    // column header (the schema's mined sysids)
    this.headerEl.replaceChildren();
    for (const c of COLUMNS) {
      const cell = document.createElement('div');
      cell.style.cssText = `width:${Skin.px(c.w)}px;flex:none;`
        + 'display:flex;justify-content:center;pointer-events:none;';
      // AUTHORED: these are ClanMemberList's COLUMN headers. The xdat
      // declares ClanMemberList as a ListCtrl with no colour, and NCListCtrl
      // takes its header colour from an instance field rather than an inline
      // constant (its paint at 0x10035670 contains no colour immediate), so
      // nothing decodable governs this. NOTE: #c9a959 appears in NEITHER
      // Interface.xdat's 22 colours NOR NWindow.dll's immediates -- it is a
      // standing defect, left in place only because inventing a replacement
      // would be worse. Fix needs NCListCtrl's header field decoded.
      Font.set(cell, this._str(c.sysid, ''), { color: '#c9a959' });
      this.headerEl.appendChild(cell);
    }

    // member rows
    this.rowsEl.replaceChildren();
    const selfName = this.getSelfName();
    const leader = this._isLeader();
    for (const m of this.members) {
      const row = document.createElement('div');
      row.dataset.member = m.name;
      // SOURCED: schema row height 19; selection tint AUTHORED (native
      // ListCtrl owns the highlight — same stand-in as the quest rows)
      row.style.cssText = `display:flex;height:${Skin.px(ROW_H)}px;`
        + 'align-items:center;cursor:pointer;'
        + (this.selected === m.name ? 'background:rgba(200,170,90,0.25);' : '');
      row.addEventListener('click', () => {
        this.selected = this.selected === m.name ? null : m.name;
        this._render();
      });

      const nameColor = m.name === selfName ? COLOR_SELF : COLOR_NAME;
      // name rides left (the schema's flags differ only on the Lv column —
      // 1,1,1 vs 1,1,0 — read as its center flag; tier 6 confirms names
      // are left-aligned); the icon cells stay centered
      const nameCell = this._cell(COLUMNS[0].w, m.name, nameColor, true);
      row.appendChild(nameCell);
      row.appendChild(this._cell(COLUMNS[1].w, String(m.level ?? ''), nameColor));

      // class icon — GetClassIconName table mined from NWindow.dll
      const clsCell = document.createElement('div');
      clsCell.style.cssText = `width:${Skin.px(COLUMNS[2].w)}px;flex:none;`
        + 'display:flex;justify-content:center;pointer-events:none;';
      const iconRef = this._iconRef(m.classId);
      if (iconRef && Skin.sprite(iconRef)) {
        const ic = document.createElement('div');
        ic.style.cssText = `width:${Skin.px(ICON_CLASS.w)}px;`
          + `height:${Skin.px(ICON_CLASS.h)}px;`;
        // SOURCED 11x11 draw size (uc:1292-1293); the RGB exports measure
        // empty on alpha so the size comes from the .uc, not Skin.content()
        Skin.apply(ic, iconRef, { content: { w: ICON_CLASS.w, h: ICON_CLASS.h } });
        clsCell.appendChild(ic);
      }
      row.appendChild(clsCell);

      // online state icon — BloodHood_Logon/Logoff (uc:1302/1308)
      const stCell = document.createElement('div');
      stCell.style.cssText = `width:${Skin.px(COLUMNS[3].w)}px;flex:none;`
        + 'display:flex;justify-content:center;pointer-events:none;';
      const on = m.online || m.id > 0;
      const stRef = on ? ICON_ON : ICON_OFF;
      if (Skin.sprite(stRef)) {
        const ic = document.createElement('div');
        ic.style.cssText = `width:${Skin.px(ICON_ONLINE.w)}px;`
          + `height:${Skin.px(ICON_ONLINE.h)}px;`;
        Skin.apply(ic, stRef, { content: { w: ICON_ONLINE.w, h: ICON_ONLINE.h } });
        stCell.appendChild(ic);
      }
      row.appendChild(stCell);

      // oust: leader only, never self, never the leader row (aCis refuses
      // those anyway) — per-row x like PartyWnd's kick (DEVIATION: retail
      // banishes from the ClanMemberInfoWnd drawer; no confirm here)
      if (leader && m.name !== selfName && m.name !== clan.leaderName) {
        const kick = document.createElement('div');
        kick.style.cssText = 'position:absolute;right:0;cursor:pointer;';
        // AUTHORED: retail banishes from the ClanMemberInfoWnd drawer, so no
        // record governs a per-row control that retail does not have.
        // 'x' not U+00D7: the -e font sheets cover code points 32..126 only,
        // so the multiplication sign rendered as a blank advance.
        Font.set(kick, 'x', { color: '#d86a6a' });
        kick.title = `Dismiss ${m.name} (no confirm — DEVIATION)`;
        kick.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onOust(m.name);
        });
        row.style.position = 'relative';
        row.appendChild(kick);
      }

      this.rowsEl.appendChild(row);
    }

    // button states (uc:659-672 clanless => all disabled; uc:879 master quit)
    for (const b of BUTTONS) {
      const el = this._btns.get(b.id);
      if (!el) continue;
      let enabled = false;
      if (b.role === 'leave') enabled = this._leaveEnabled();
      else if (b.role === 'invite') enabled = this._inviteEnabled();
      // the rest have no backend — retail-disabled look
      el.style.opacity = enabled ? '1' : '0.45';
      el.style.cursor = enabled ? 'pointer' : 'default';
    }
  }

  _cell(w, text, color, left = false) {
    const cell = document.createElement('div');
    cell.style.cssText = `width:${Skin.px(w)}px;flex:none;display:flex;`
      + `justify-content:${left ? 'flex-start' : 'center'};pointer-events:none;`;
    Font.set(cell, text, { color });
    return cell;
  }

  _iconRef(classId) {
    if (!this._icons || classId == null) return null;
    const idx = this._icons.classes[String(classId)];
    return idx != null ? this._icons.icons[idx] : null;
  }

  // --- clanAsk prompt (AUTHORED, same stand-in as PartyWnd's partyAsk) ---
  _buildAsk(parent) {
    // AUTHORED prompt window (220x80, 8px insets — nothing to mine; retail
    // uses the DialogBox system dialog the port does not have)
    const win = new L2Window({ title: 'Clan', width: 220, height: 80, closable: false });
    win.root.id = 'l2-clanask';
    const text = document.createElement('div');
    text.style.cssText = `position:absolute;left:${Skin.px(8)}px;`
      + `top:${Skin.px(8)}px;right:${Skin.px(8)}px;`;
    win.body.appendChild(text);
    const row = document.createElement('div');
    // AUTHORED insets (the _buildAsk comment above covers this whole block)
    row.style.cssText = `position:absolute;bottom:${Skin.px(8)}px;`
      + `left:${Skin.px(8)}px;display:flex;gap:8px;`;
    const mk = (label, accept) => {
      const b = document.createElement('div');
      // Size comes from the button art's own content rect. No art, no
      // button: a typed 49x23 would be a second, unverified copy of a
      // measurement the sprite already carries.
      const art = Skin.content('L2UI_CH3.Button.SmallButton1');
      if (!art) return null;
      const w = art.w, h = art.h;
      b.style.cssText = `width:${Skin.px(w)}px;height:${Skin.px(h)}px;`
        + 'display:flex;align-items:center;justify-content:center;cursor:pointer;';
      Skin.apply(b, 'L2UI_CH3.Button.SmallButton1', { stretch: true });
      // AUTHORED labels (retail's dialog buttons are system strings)
      Font.set(b, label, { color: Layout.native('buttonLabel') });
      b.addEventListener('click', () => { win.hide(); this.onAnswer(accept); });
      return b;
    };
    row.appendChild(mk('Accept', 1));
    row.appendChild(mk('Refuse', 0));
    win.body.appendChild(row);
    parent.appendChild(win.root);
    this.askWin = win;
    this.askText = text;
  }

  showAsk(from, clanName) {
    // AUTHORED prompt text (retail: sysmsg-driven DialogBox content)
    Font.set(this.askText,
             `${from || '?'} invites you to join ${clanName || 'the clan'}.`,
             { color: Layout.textColor('DialogBox', 'DialogText') });
    this.askWin.place({ left: window.innerWidth / 2 - 110, top: 200 });
    // an incoming invite must be topmost — above every WndMgr window
    WndMgr.raiseEl(this.askWin.root);
    this.askWin.show();
  }

  /** target changed — the Invite button arms on player targets. */
  refreshInvite() { this._render(); }

  place(o = {}) { this.win.place(o); return this; }
  show() { this.win.show(); return this; }
  hide() { this.win.hide(); return this; }
  get visible() { return this.win.visible; }
  toggle(force) { this.win.toggle(force); return this; }

  onDefaultPosition() {
    this.place(this.defaultPlace);
  }
}
