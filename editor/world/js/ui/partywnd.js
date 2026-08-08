// Phase C.9 — PartyWnd, the retail party window.
//
// Structure and behaviour come from the client, not from guesswork:
//
//   WindowsInfo.ini   [PartyWnd] width=176 height=368 posX=0 posY=92 —
//                     the decrypted retail file (assets/interlude/system):
//                     window size AND default dock (SOURCED). 368 = 46x8.
//                     (posY is DEVIATED to 480 here — it collides with the
//                     sourced MinimapWnd dock; see DOCK below.)
//   PartyWnd.uc       the member model: NPARTYSTATUS_HEIGHT = 46 per
//                     member row (uc:5), max 8 members (uc:6); the window
//                     RESIZES to 46 x count (ResizeWnd, uc:252) and HIDES
//                     when the party is empty (uc:271-274). Rows carry a
//                     centered name, the leader crown
//                     (L2UI_CH3.PartyWnd.party_leadericon, uc:393, anchored
//                     -(nameWidth/2)-18 left of the name, uc:398) and
//                     CP/HP/MP bars. Left-click member -> RequestAction
//                     (target, uc:644), right-click -> RequestAssist.
//   gateway/README    the port's contract: party{members[...]} is a FULL
//   M9                snapshot on every composition change (never merge
//                     deltas; the bridge re-inserts self first);
//                     partyMemberStatus{id,hp,...} is the frequent in-place
//                     bar update; partyAsk{from} incoming invite;
//                     partyInvite{name}/partyAnswer/partyLeave/partyKick
//                     out. No CP and no class icons in the contract — rows
//                     show HP+MP only, no invented data.
//
// Row internals are AUTHORED: the xdat has NO PartyStatusWnd record (the
// PartyWnd children list stops at PartyStatusWnd0 with no size), so only
// the 46px row height and the leader-icon anchor math are sourced.
//
// Invite flow: partyAsk renders an AUTHORED prompt (retail uses the
// DialogBox system dialog — the port has no dialog framework yet) with
// Accept/Refuse -> partyAnswer{1/0}. aCis request expiry just yields a
// stale answer server-side — nothing to clean up client-side.
//
// Kick: PartyWnd.uc has NO kick UI at all (dismiss lives outside this
// window in retail). The per-row kick button (leader only, never on
// self) is AUTHORED and IMMEDIATE — DEVIATION: no confirm dialog.
//
// Invite button: retail invites via target + action id 7, but aCis logs
// 'Unhandled action type 7' for it — party invite ONLY routes through
// RequestJoinParty, so the button sends partyInvite{name} with the
// current target's name, never the action. Because an empty party HIDES
// the window (retail), that button would be unreachable exactly when it
// is needed most; DEVIATION: with an empty party the window stays
// visible while a target is selected, showing just the invite row.

import { Skin } from './skin.js';
import { Font } from './font.js';
import { L2Window } from './window.js';
import { WndMgr } from './wndmgr.js';
import { Layout } from './layout.js';

const WND_W = 176;    // WindowsInfo.ini [PartyWnd] width
const ROW_H = 46;     // NPARTYSTATUS_HEIGHT, PartyWnd.uc:5
const MAX_MEMBERS = 8;  // NPARTYSTATUS_MAXCOUNT, PartyWnd.uc:6
// DEVIATION: the sourced posY=92 collides with the sourced MinimapWnd
// dock (16,63) + its 334x433 window as rendered (413 body + 20 titlebar,
// so the map covers y 63..496) — the pair is unreadable in the port.
// posX=0 stays sourced; posY drops below the map (63 + 433 + a 4px gap,
// the gap itself AUTHORED).
const DOCK = { left: 0, top: 500 };   // WindowsInfo.ini [PartyWnd] posX; posY deviated (above)

// retail member-row art (PlayerStatusWnd gauges reused for the bars)
const HP_FILL = 'L2UI_CH3.PlayerStatusWnd.ps_HPbar';
const HP_BACK = 'L2UI_CH3.PlayerStatusWnd.ps_hpbar_back';
const MP_FILL = 'L2UI_CH3.PlayerStatusWnd.ps_mpbar';
const MP_BACK = 'L2UI_CH3.PlayerStatusWnd.ps_mpbar_back';
const CROWN = 'L2UI_CH3.PartyWnd.party_leadericon';   // PartyWnd.uc:393

// PartyWnd declares only Buttons and the PartyStatusWnd0 sub-window -- it has
// NO TextBox record at all, so nothing in Interface.xdat governs a member
// row's text. The row colours below are AUTHORED and say so individually.

export class PartyWnd {
  constructor(parent = document.body,
              { onInvite, onAnswer, onKick, onLeave, onTargetMember,
                getTarget, getSelfId } = {}) {
    this.onInvite = onInvite || (() => {});
    this.onAnswer = onAnswer || (() => {});
    this.onKick = onKick || (() => {});
    this.onLeave = onLeave || (() => {});
    this.onTargetMember = onTargetMember || (() => {});
    this.getTarget = getTarget || (() => null);
    this.getSelfId = getSelfId || (() => null);
    this.members = [];          // last full snapshot
    this._rows = new Map();     // id -> {root, hpSet, mpSet, data}

    // frameless HUD window (the xdat PartyWnd has no chrome textures —
    // same family as ShortcutWnd): a bare draggable root + WndMgr
    const root = document.createElement('div');
    root.id = 'l2-partywnd';
    root.style.cssText = `position:fixed;z-index:12;display:none;`
      + `width:${Skin.px(WND_W)}px;pointer-events:auto;`;
    this.root = root;
    parent.appendChild(root);

    // left gutter: SOURCED — the .uc's click handler ignores X < +13
    // (uc:651), so the 13px strip is NOT member area and doubles as the
    // drag zone (rows claim their own presses; see _rebuild)
    const gutter = document.createElement('div');
    gutter.style.cssText = `position:absolute;left:0;top:0;bottom:0;`
      + `width:${Skin.px(13)}px;cursor:move;`;
    root.appendChild(gutter);
    this.gutter = gutter;

    this.rowsEl = document.createElement('div');
    root.appendChild(this.rowsEl);

    // --- footer: invite row (always present while the window shows).
    // AUTHORED geometry: no xdat record exists for this strip (it is the
    // port's own addition, see the header DEVIATION).
    const foot = document.createElement('div');
    foot.style.cssText = 'position:relative;display:flex;gap:6px;'
      + `padding:${Skin.px(4)}px ${Skin.px(4)}px ${Skin.px(4)}px ${Skin.px(15)}px;`;
    this.inviteBtn = this._smallBtn('Invite', () => {
      const t = this.getTarget();
      if (t && t.name) this.onInvite(t.name);
    });
    foot.appendChild(this.inviteBtn);
    this.leaveBtn = this._smallBtn('Leave', () => this.onLeave());
    foot.appendChild(this.leaveBtn);
    this.footEl = foot;
    root.appendChild(foot);

    // --- the partyAsk prompt (AUTHORED — no DialogBox in the port) ---
    this._buildAsk(parent);

    this.place(DOCK);
  }

  _smallBtn(label, onClick) {
    const b = document.createElement('div');
    const art = Skin.content('L2UI_CH3.Button.SmallButton1');
    const w = art ? art.w : 49, h = art ? art.h : 23;   // measured 49x23
    b.style.cssText = `width:${Skin.px(w)}px;height:${Skin.px(h)}px;`
      + 'display:flex;align-items:center;justify-content:center;cursor:pointer;';
    Skin.apply(b, 'L2UI_CH3.Button.SmallButton1', { stretch: true });
    // AUTHORED labels (retail's are system strings, not extracted)
    // PartyWnd/btnBuff and btnCompact are real Button records; Button records
    // carry no xdat colour, so NCButton's own choice governs.
    // SOURCED NWindow.dll 0x100035a8.
    Font.set(b, label, { color: Layout.native('buttonLabel') });
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  _buildAsk(parent) {
    // AUTHORED prompt window: retail uses the DialogBox system dialog,
    // which the port does not have — a small L2Window stands in (220x80
    // and the 8px insets are ours, there is nothing to mine)
    const win = new L2Window({
      title: 'Party', width: 220, height: 80, closable: false,
    });
    win.root.id = 'l2-partyask';
    const text = document.createElement('div');
    text.style.cssText = `position:absolute;left:${Skin.px(8)}px;`
      + `top:${Skin.px(8)}px;right:${Skin.px(8)}px;`;   // AUTHORED (above)
    win.body.appendChild(text);
    const row = document.createElement('div');
    // AUTHORED insets (the _buildAsk comment above covers this whole block)
    row.style.cssText = `position:absolute;bottom:${Skin.px(8)}px;`
      + `left:${Skin.px(8)}px;display:flex;gap:8px;`;
    const yes = this._smallBtn('Accept', () => this._answer(1));
    const no = this._smallBtn('Refuse', () => this._answer(0));
    row.appendChild(yes);
    row.appendChild(no);
    win.body.appendChild(row);
    parent.appendChild(win.root);
    this.askWin = win;
    this.askText = text;
  }

  showAsk(from) {
    this.askFrom = from;
    // AUTHORED prompt TEXT (retail: sysmsg-driven DialogBox content); the
    // COLOUR is DialogBox/DialogText's own record, the control retail would
    // have put this prompt in
    Font.set(this.askText, `${from || '?'} invites you to a party.`,
             { color: Layout.textColor('DialogBox', 'DialogText') });
    this.askWin.place({ left: window.innerWidth / 2 - 110, top: 200 });
    // an incoming invite must be topmost — above every WndMgr window
    WndMgr.raiseEl(this.askWin.root);
    this.askWin.show();
  }

  _answer(accept) {
    this.askWin.hide();
    this.askFrom = null;
    this.onAnswer(accept);
  }

  /** FULL snapshot replace (gateway/README M9: never merge deltas). */
  setMembers(members) {
    this.members = (members || []).slice(0, MAX_MEMBERS);
    this._rebuild();
    this._refreshVisibility();
    return this;
  }

  /** partyMemberStatus: frequent — update the bars IN PLACE (M9). */
  updateMember(m) {
    const row = this._rows.get(m.id);
    if (!row) return;
    row.data.hp = m.hp; row.data.maxHp = m.maxHp;
    row.data.mp = m.mp; row.data.maxMp = m.maxMp;
    row.hpSet(m.maxHp ? m.hp / m.maxHp : 0);
    row.mpSet(m.maxMp ? m.mp / m.maxMp : 0);
  }

  /** target changed — the invite row follows it (see header DEVIATION). */
  refreshInvite() {
    this._refreshInviteBtn();
    this._refreshVisibility();
  }

  _targetIsPlayer() {
    const t = this.getTarget();
    return !!(t && t.name && t.kind === 'player');
  }

  _refreshInviteBtn() {
    const t = this.getTarget();
    const armed = this._targetIsPlayer();
    Font.set(this.inviteBtn, armed ? 'Invite' : 'Invite', { color: Layout.native('buttonLabel') });
    this.inviteBtn.style.opacity = armed ? '1' : '0.45';
    this.inviteBtn.style.cursor = armed ? 'pointer' : 'default';
    this.inviteBtn.title = armed ? `Invite ${t.name} to a party`
      : 'Target a player first';
  }

  _refreshVisibility() {
    const hasParty = this.members.length > 0;
    // empty party: retail HIDES; the port shows just the invite row while
    // a PLAYER is targeted (aCis can't route the action-7 invite — header)
    const inviteReachable = !hasParty && this._targetIsPlayer();
    this.root.style.display = (hasParty || inviteReachable) ? 'block' : 'none';
    this.leaveBtn.style.display = hasParty ? 'flex' : 'none';
    // retail ResizeWnd (uc:252): height follows 46 x count (+ invite row)
    const rows = this.members.length;
    this.rowsEl.style.height = `${Skin.px(ROW_H * rows)}px`;
  }

  _rebuild() {
    this.rowsEl.replaceChildren();
    this._rows.clear();
    const selfId = this.getSelfId();
    const selfLeader = !!this.members.find(m => m.id === selfId && m.leader);

    this.members.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'l2-party-row';
      row.dataset.memberId = m.id;
      // row internals AUTHORED (no xdat PartyStatusWnd record — header)
      row.style.cssText = `position:relative;height:${Skin.px(ROW_H)}px;`
        + `margin-left:${Skin.px(13)}px;cursor:pointer;`;
      // left-click member -> target them (PartyWnd.uc OnLButtonDown);
      // the press is claimed so the window drag can't eat the click
      row.addEventListener('pointerdown', (e) => e.stopPropagation());
      row.addEventListener('click', () => this.onTargetMember(m.id));

      const name = document.createElement('div');
      name.style.cssText = 'position:absolute;left:0;right:0;top:1px;'
        + 'display:flex;justify-content:center;pointer-events:none;';
      // AUTHORED: PartyWnd carries no TextBox record (see the header note),
      // so no decoded value governs a member row's name.
      Font.set(name, m.name || `#${m.id}`, { color: '#e8e8e8' });
      row.appendChild(name);

      if (m.leader && Skin.sprite(CROWN)) {
        const crown = document.createElement('div');
        const cs = Skin.content(CROWN) || { w: 16, h: 16 };
        // SOURCED: PartyWnd.uc:398 anchors the crown -(nameWidth/2)-18
        // left of the centered name (the 18 is uc:194/398), y=8
        const nw = Font.measure(m.name || '');
        const cx = (WND_W - 13) / 2 - nw / 2 - 18;
        crown.style.cssText = `position:absolute;top:${Skin.px(8)}px;`
          + `left:${Skin.px(Math.max(0, cx))}px;width:${Skin.px(cs.w)}px;`
          + `height:${Skin.px(cs.h)}px;pointer-events:none;`;
        Skin.apply(crown, CROWN);
        crown.title = 'Party leader';
        row.appendChild(crown);
      } else if (m.leader) {
        // AUTHORED fallback if the crown art ever fails to stage
        const mark = document.createElement('div');
        mark.style.cssText = 'position:absolute;top:1px;left:2px;pointer-events:none;';
        // AUTHORED: retail marks the leader with a crown TEXTURE, not a
        // coloured letter, so no colour record exists for this at all.
        Font.set(mark, 'L', { color: '#ffd24a' });
        row.appendChild(mark);
      }

      // bar stack: AUTHORED offsets inside the 46px row (the xdat carries
      // no PartyStatusWnd layout — only the row height is sourced)
      const hpRow = document.createElement('div');
      hpRow.style.cssText = `position:absolute;left:${Skin.px(2)}px;`
        + `top:${Skin.px(18)}px;`;
      const mpRow = document.createElement('div');
      mpRow.style.cssText = `position:absolute;left:${Skin.px(2)}px;`
        + `top:${Skin.px(31)}px;`;
      row.appendChild(hpRow);
      row.appendChild(mpRow);
      // bar width: row width minus insets — AUTHORED (no mined row layout)
      const barW = WND_W - 13 - 8;
      const barH = (Skin.content(HP_BACK) || { h: 12 }).h;  // MEASURED 12
      const hpSet = Skin.gauge(hpRow, HP_FILL, HP_BACK, { width: barW, height: barH });
      const mpSet = Skin.gauge(mpRow, MP_FILL, MP_BACK, { width: barW, height: barH });
      hpSet(m.maxHp ? m.hp / m.maxHp : 0);
      mpSet(m.maxMp ? m.mp / m.maxMp : 0);

      // kick: leader only, never self; AUTHORED (no kick UI in the .uc)
      if (selfLeader && m.id !== selfId) {
        const kick = document.createElement('div');
        kick.className = 'l2-party-kick';
        kick.style.cssText = `position:absolute;right:${Skin.px(2)}px;`
          + 'top:1px;cursor:pointer;';
        // AUTHORED: no PartyWnd record governs a per-row control.
        // 'x' not U+00D7: the -e font sheets cover code points 32..126 only,
        // so the multiplication sign rendered as a blank advance.
        Font.set(kick, 'x', { color: '#d86a6a' });
        kick.title = `Dismiss ${m.name} (no confirm — DEVIATION)`;
        kick.addEventListener('pointerdown', (e) => e.stopPropagation());
        kick.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onKick(m.name);
        });
        row.appendChild(kick);
      }

      if (m.level != null) row.title = `${m.name} — Lv ${m.level}`;

      this.rowsEl.appendChild(row);
      this._rows.set(m.id, { root: row, hpSet, mpSet, data: { ...m } });
    });
    this._refreshInviteBtn();
  }

  place(o = {}) {
    const el = this.root;
    if (o.left != null) el.style.left = `${Skin.px(o.left)}px`;
    if (o.top != null) el.style.top = `${Skin.px(o.top)}px`;
    if (o.right != null) el.style.right = `${o.right}px`;
    if (o.bottom != null) el.style.bottom = `${o.bottom}px`;
    return this;
  }

  /** WndMgr reset: the DOCK above (sourced posX, deviated posY). */
  onDefaultPosition() {
    this.place(DOCK);
  }
}
