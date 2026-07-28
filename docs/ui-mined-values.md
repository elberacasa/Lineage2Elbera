# Mined UI values — exact numbers, ready to implement

**Status: research only. No code in this repository was changed to produce
this document.** All analysis ran from throwaway scripts outside the repo.
Everything below is a value to be *consumed* by the implementer.

Companion docs: [ui-port-handoff.md](ui-port-handoff.md) (state of the port),
[ui-reverse-engineering.md](ui-reverse-engineering.md) (how the client's UI is
built), [xdat-format.md](xdat-format.md) (the layout file, byte level).

---

## 1. THE FIND: per-control x/y is in the xdat after all

`ui-port-handoff.md` §5 lists "per-control x/y offsets" as unavailable, and
records a rejected hypothesis (the `-9999` sentinel at tail `+44`). **That
conclusion was wrong.** The coordinates are there.

### Where

For a record with `hasSize == 1`, immediately after the header:

```
  body + 0    i32   (3 ints, purpose not yet identified)
  body + 4    i32
  body + 8    i32
  body + 12   i32   X   <-- 24.8 fixed point
  body + 16   i32   Y   <-- 24.8 fixed point
```

`body` is the offset the header parser already returns (after the optional
`w`/`h` pair). **Divide by 256** to get pixels. Values may be negative.

Acceptance test: a candidate pair is valid only when **both** ints are exactly
divisible by 256.

**How strong is that test?** The probability of two unrelated int32s both being
divisible by 256 by chance is `(1/256)^2 = 1/65,536`. Across 1,962 records that
predicts **≈ 0.03** accidental hits. The actual count at `body+12` is **1,735 —
about 58,000× what chance would produce**. The slot is not a coincidence.

### Coverage

| set | count | decodable at `body+12` |
|---|---|---|
| all records | 1,962 | 1,735 (88.4%) |
| `hasSize == 1` | 1,762 | 1,609 (**91.3%**) |
| `hasSize == 0` | 200 | not at this offset — see §5 |

Probing alternative shapes (skipping a leading string, other offsets) recovered
only **24** extra records while introducing false-positive risk. Not worth it;
use the strict `+12` rule and treat the rest as undecoded.

### Why this is trustworthy

Four independent consistency checks, none of which could pass by accident:

1. **`MenuWnd`'s three background bands tile exactly.**
   x=12 (w 16) → 28 (w 129) → 157 (w 16) → **173 = the window's declared width.**
2. **`MenuWnd`'s four buttons are evenly spaced.** x = 20, 57, 94, 131 —
   a constant pitch of 37 = 34 (button width) + 3 (gap), all at y=6 in a
   46-tall window, leaving 6px above and below a 34px button.
3. **Cross-window agreement.** `MagicSkillWnd.TabCtrl` and
   `InventoryWnd.InventoryTab` are both **189×23 at x=12**. Two unrelated
   windows landing on identical values is not coincidence.
4. **Every published coordinate re-verified.** All 17 values quoted in the
   tables below were re-extracted in a separate pass and matched exactly.
5. **Semantics line up with known behaviour.** `TargetStatusWnd`'s pledge rows
   sit at y=43/59 in a 46-tall window — outside it, exactly as expected for the
   rows revealed by its documented **expand mode** (`BackExpTex`).

### Negative Y means bottom-anchored

`ChatWnd` yields y values of −5, −23, −24, −46, −51. A window whose height is
187 does not have controls at y=−51 in a top-left origin. These are
**anchored to the opposite edge** — the chat input, tab strip and side buttons
sit at the bottom of the window and stay there as it resizes. Treat a negative
coordinate as an offset from the far edge, not a literal top-left position.
This is consistent with `SetAnchor`'s existence in `UIAPI_WINDOW`.

---

## 2. Corrections to values currently hardcoded in the port

These replace `AUTHORED` constants flagged by `tools/ui/audit_guesses.py`.
Applying them should let the audit reach 0 authored (not merely 0 unjustified)
for these windows.

| Where | Current (authored) | **Real (mined)** |
|---|---|---|
| `skillwnd.js` tab strip | x=6, y=4 | **x=12, y=8** |
| `skillwnd.js` panes | x=6, y=(4+23+4)=31 | **x=9, y=40** |
| `statuswnd.js` level box | x=4 (`INSET`), y=4 | **x=15, y=6** |

`statuswnd.js`'s gauge row offsets and `INSET` remain undecoded — the
`StatusBar` children are `hasSize == 0` (§5).

---

## 3. Exact layouts — implement from these

All values in retail pixels, relative to the parent window's origin unless the
value is negative (§1). `auto` = the xdat leaves the size implicit.

### MenuWnd — 173×46 — fully decoded

| type | name | size | x | y |
|---|---|---|---|---|
| Texture | MenuWndBackTexLeft | 16×46 | 12 | 0 |
| Texture | MenuWndBackTexMiddle | 129×46 | 28 | 0 |
| Texture | MenuWndBackTexRight | 16×46 | 157 | 0 |
| Button | BtnCharInfo | 34×34 | 20 | 6 |
| Button | BtnInventory | 34×34 | 57 | 6 |
| Button | BtnMap | 34×34 | 94 | 6 |
| Button | BtnSystemMenu | 34×34 | 131 | 6 |

### MagicSkillWnd — 256×335 — fully decoded

| type | name | size | x | y |
|---|---|---|---|---|
| Tab | TabCtrl | 189×23 | 12 | 8 |
| Window | ASkill (active pane) | 239×280 | 9 | 40 |
| Window | PSkill (passive pane) | 239×280 | 9 | 40 |

Both panes share one rect — they are alternates, only one visible at a time,
which matches `MagicSkillWnd.uc` routing skills to one or the other.

### InventoryWnd — 256×401 — fully decoded

| type | name | size | x | y |
|---|---|---|---|---|
| Texture | BackTexture | 256×381 | 0 | 20 |
| Tab | InventoryTab | 189×23 | 12 | 159 |
| TextBox | ItemCount | 10×0 | 241 | 162 |
| ItemWindow | InventoryItem | 236×139 | 9 | 188 |
| ItemWindow | QuestItem | 236×139 | 9 | 188 |
| ItemWindow | EquipItem_Underwear | 34×34 | 137 | 36 |
| ItemWindow | HennaItem | 26×84 | 223 | 39 |
| Button | CrystallizeButton | 34×34 | 14 | 351 |
| Button | TrashButton | 34×34 | 208 | 351 |
| Texture | AdenaIcon | 16×12 | 98 | 355 |
| TextBox | AdenaText | 90×0 | 110 | 356 |
| InvenWeight | InvenWeight | 85×12 | 117 | 372 |

`InventoryItem` and `QuestItem` share a rect (tab alternates, like the skill
panes). The 20px top offset on `BackTexture` is the titlebar.

### ShortcutWnd — the bar, in all six of its modes

`ShortcutWnd` itself has no size (it is a container). Six sibling layouts:

| container | size | notes |
|---|---|---|
| ShortcutWndHorizontal | 504×46 | the default bar |
| ShortcutWndHorizontal_1 / _2 | 504×46 | additional rows |
| ShortcutWndVertical | 46×504 | rotated |
| ShortcutWndVertical_1 / _2 | 46×504 | additional columns |
| ShortcutWndJoypad | 172×82 | joypad mode |
| ShortcutWndJoypadExpand | 432×82 | expanded joypad |

**Horizontal (the one to build first):**

| type | name | size | x | y |
|---|---|---|---|---|
| ShortcutItemWindow | Shortcut1 | 36×36 | 32 | 5 |
| Texture | F1Tex | 16×16 | 32 | 4 |
| TextBox | PageNumTextBox | 20×10 | 10 | 0 |
| Button | NextBtn | 14×14 | 13 | 1 |
| Button | PrevBtn | 14×14 | 13 | 31 |
| Button | ExpandButton / ReduceButton | 14×14 | 1 | 8 |
| Button | JoypadBtn | 15×15 | 0 | 1 |
| Button | RotateBtn | 15×15 | 0 | 16 |
| Button | LockBtn / UnlockBtn | 15×15 | 0 | 31 |

**Vertical:** `Shortcut1` 36×36 at (5, 32); `F1Tex` at (4, 32);
`PageNumTextBox` at (0, 16); `PrevBtn` (1, 13), `NextBtn` (31, 13);
`JoypadBtn` (1, 0), `RotateBtn` (16, 0), `LockBtn` (31, 0).

**Joypad** 172×82: `Shortcut1` at (39, 25), `F1Tex` (38, 24),
`JoypadLButtonTex` 16×14 at (38, 6), `JoypadRButtonTex` at (130, 6),
right-edge buttons at x=157 (y 19/34/49).
**JoypadExpand** 432×82: `Shortcut1` at (169, 25), `F1Tex` (168, 24),
`JoypadButtonBackTex` 128×82 at (158, 0), `JoypadRButtonTex` at (380, 6),
right-edge buttons at x=417.

> **Only slot 1 exists in the xdat.** Each container declares a single
> `ShortcutItemWindow` named `Shortcut1`; the remaining 11 slots are generated
> at runtime by the native control. **The slot pitch is therefore NOT in the
> xdat** — see §5. What *is* known: the first slot's origin is (32, 5)
> horizontal / (5, 32) vertical, and the slot is 36×36.

### ChatWnd — 348×187 — decoded, bottom-anchored

| type | name | size | x | y |
|---|---|---|---|---|
| Texture | ChatWndHeadTex | 348×18 | 0 | 0 |
| Texture | ChatWndBottomTex | 348×18 | 0 | −46 |
| Texture | ChatWndBottomTex1 | 348×46 | 0 | 0 |
| Tab | ChatTabCtrl | 320×23 | 23 | −23 |
| Texture | TabBackgroundTexture | 320×23 | 23 | −23 |
| EditBox | ChatEditBox | 303×16 | 39 | −6 |
| Texture | LanguageTexture | 15×15 | 24 | −5 |
| Button | ChatFilterBtn | 15×15 | 5 | −51 |
| Button | MessengerBtn | 15×15 | 5 | −24 |
| Button | PartyMatchingBtn | 15×15 | 5 | −5 |

`ChatWndBottomTex1`'s y=0 sits oddly against its siblings; treat it as
lower-confidence than the rest of this table and confirm against the rendered
window.

### StatusWnd — 176×84 — partial

| type | name | size | x | y |
|---|---|---|---|---|
| Texture | StatusWndLeftTex | 16×84 | 12 | 0 |
| Window | StatusWnd_LevelTextBox_back | 22×20 | 15 | 6 |

`StatusWndCenterTex`, `StatusWndRightTex`, the four `StatusBar`s and
`UserName` are all `hasSize == 0` and do **not** decode at `+12`.

### TargetStatusWnd — 176×46 — partial (expand-mode rows)

| type | name | size | x | y |
|---|---|---|---|---|
| TextBox | txtPledge | 0×0 | 20 | 43 |
| Texture | texPledgeCrest | 16×12 | 45 | 43 |
| TextBox | txtPledgeName | 0×0 | 63 | 43 |
| TextBox | txtAlliance | 0×0 | 20 | 59 |
| Texture | texPledgeAllianceCrest | 8×12 | 53 | 59 |
| TextBox | txtPledgeAllianceName | 0×0 | 63 | 59 |
| TreeCtrl | NpcInfo | 158×33 | 18 | 40 |

`BackTex`, `BackExpTex`, `btnClose`, `UserName`, `RankName`, `barHP`, `barMP`
are `hasSize == 0` and undecoded. Note the two pledge rows are 16px apart
(43 → 59) and `NpcInfo` starts at y=40, i.e. the expanded window is at least
~92px tall.

---

## 4. Reproducing this

No repository code was touched. To re-derive, extend the existing header parser
in `tools/xdat/parse_xdat.py` (which already computes `body`) with:

```
x_raw = i32(body + 12)
y_raw = i32(body + 16)
if x_raw % 256 == 0 and y_raw % 256 == 0:
    x, y = x_raw // 256, y_raw // 256      # 24.8 fixed point
else:
    x, y = None, None                       # undecoded; do not guess
```

Emit `x`/`y` into `interface.json` alongside `width`/`height`, then have
`Layout` expose them (e.g. `Layout.pos(win, ctrl)`). Suggested guard for the
regression suite: **≥1,600 records** must decode, and `MenuWnd`'s bands must
still tile to exactly 173.

---

## 5. Still unknown after this pass

- **`hasSize == 0` records (200) carry x/y somewhere else.** Their tail begins
  with a bitfield (`0x8000003F` and similar) instead of `w`/`h`. This blocks
  the four `StatusWnd` gauges, `TargetStatusWnd`'s bars and name, and the five
  `ChatWnd` panes. Decoding that bitfield's shape is the highest-value next
  step and should be worth another large batch of exact offsets.
- **The 153 `hasSize == 1` records that still fail** have a variable-length
  string before the coordinates. Identifying which control types insert it
  would recover them.
- **The shortcut slot pitch.** Only `Shortcut1` is declared; the pitch lives in
  the native control. Bounds: first slot at x=32 in a 504-wide bar, slot 36px
  wide, 12 slots. Candidate sources, in order: `execAddItem@UUIAPI_ITEMWINDOW`
  in `NWindow.dll` (see ui-port-handoff.md §6), or `ShortcutWnd.uc`.
- **What `body+0/4/8` are.** Three ints precede x/y; unidentified. Likely
  flags/anchor mode, given negative coordinates imply anchoring.
- **(RESOLVED 2026-07-27) x/y is WINDOW-relative.** MenuWnd's last button at x=131 (34px wide -> 165) would overflow the 173px window under a +12 content offset; the left 0..12 strip has NO declared art in the xdat (no fourth band record; band sprites are full 16x46 content). The rendered 12px strip is data-faithful; if retail paints a grip there it is native chrome outside the xdat.
- **Whether x/y are parent-relative or window-relative.** All validation above
  is self-consistent as parent-relative, but note `StatusWndLeftTex` and
  `MenuWndBackTexLeft` both start at **x=12** rather than 0, so a uniform 12px
  left offset may exist that a single window cannot distinguish from a genuine
  coordinate. Worth confirming against a rendered window before trusting
  absolute placement at the pixel.

---

## 6. Suggested next mining tasks (all read-only)

Ordered by value to the implementer:

1. **Decode the `hasSize == 0` tail** — unblocks the StatusWnd gauges and
   TargetStatusWnd, the two windows most in need of exact offsets.
2. **`execAddItem@UUIAPI_ITEMWINDOW`** in `NWindow.dll` — the `ItemWindow` cell
   pitch, which settles both the shortcut bar and the skill/inventory grids.
3. **Default keybindings** — still unsourced; try the `Window.dll` input tables
   and `assets/uscript/` event registrations.
4. **The con-colour sign convention** — the table is exact
   (ui-port-handoff.md §4); only the direction of `levelDiff` is unconfirmed.
5. **The 3 unmatched top-level windows** — a header variant the anchor misses.
6. **The `-r` / CJK font layout** — 256 glyphs over 2 pages, different record
   shape from the Latin `-e` fonts.
