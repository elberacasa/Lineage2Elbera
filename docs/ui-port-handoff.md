# UI Port — Handoff

Continue the retail-UI port from zero context. Describes the repository as of
**2026-07-26**, macOS arm64, python3, node, OpenJDK 21.

This document covers **only the UI port** (Phase A/B/C below). For the project
as a whole read [HANDOFF.md](HANDOFF.md) first, then this.

**Read order:** [HANDOFF.md](HANDOFF.md) → this file →
[ui-reverse-engineering.md](ui-reverse-engineering.md) (how the client's UI is
built) → [xdat-format.md](xdat-format.md) (the layout file, byte level).

---

## 0. The one rule

**Nothing in the UI may be invented.** Every number, colour, texture and
behaviour must come from a source that outranks human judgement. The evidence
hierarchy, in order — always use the highest tier that can answer:

| Tier | Source | Answers | Access |
|---|---|---|---|
| 1 | `Interface.xdat`, `*.gly` | window/control sizes, texture refs, glyph metrics | `Layout.*`, `font.json` |
| 2 | `Interface.u`, `NWindow.u` (UnrealScript) | behaviour, categorisation, event flow | `assets/uscript/` |
| 3 | the art itself | geometry the code never states | `Skin.content()` |
| 4 | aCis XML + live packets | gameplay values | `assets/gamedata/*.json` |
| 5 | `NWindow.dll` / `Window.dll` | constants hardcoded in C++ | `objdump` (see §6) |
| 6 | retail client capture | only when 1–5 are silent | manual |

This is enforced mechanically:

```bash
python3 tools/ui/audit_guesses.py --check    # currently PASS
```

It scans `editor/world/js/ui/*.js` for retail-pixel literals and fails unless
each is derived or carries a marker: `SOURCED` (tier 2), `MEASURED` (tier 3),
`AUTHORED` (ours, with a stated reason), `DEVIATION` (knowing departure).

**Current state: 15 literals, 0 unjustified.** Keep it at 0.

---

## 1. What exists

### 1.1 Build-plane tools (all have `--check`)

| Tool | Output | Verified state |
|---|---|---|
| `tools/xdat/parse_xdat.py` | `assets/gamedata/interface.json` | 1,962 records, **137/140** windows, **100% byte coverage**, 431 textures + 69 intra-UI refs, 0 missing |
| `tools/ui/build_uiskin.py` | `editor/world/ui/skin/` + `skin.json` | 436 sprites, **measured content rects on 416** |
| `tools/ui/build_font.py` | `editor/world/ui/font/` + `font.json` | SmallFont lineHeight 13, LargeFont 14, both 1024×128, chars 32–126 |
| `tools/ui/mine_atlas.py` | `editor/world/ui/atlas/<tex>/` | guillotine-splits an atlas into islands + montage |
| `tools/ui/audit_guesses.py` | report | 15 literals, 0 unjustified |
| `tools/uscript/extract_uscript.py` | `assets/uscript/` | **142** Interface + **91** NWindow classes, ~1.3 MB of original source |
| `tools/dat/export_playerlevels.py` | `assets/gamedata/playerlevels.json` | levels 1–81 |
| `tools/dat/export_skilltypes.py` | `assets/gamedata/skilltypes.json` | 2,654 skills: **1820 ACTIVE / 32 TOGGLE / 802 PASSIVE** |
| `tools/dev/seed_test_char.py` | DB writes + backup | seeds level/skills/gear for testing |

Regenerate everything:

```bash
python3 tools/xdat/parse_xdat.py
python3 tools/ui/build_uiskin.py          # --hd for the 4x Real-ESRGAN pass (NOT yet run)
python3 tools/ui/build_font.py
python3 tools/uscript/extract_uscript.py
python3 tools/dat/export_playerlevels.py
python3 tools/dat/export_skilltypes.py
```

All outputs are **gitignored** (`assets/uscript/`, `editor/world/ui/skin|font|atlas/`)
— they are NCSoft assets/code, reference only, never committed.

### 1.2 Runtime (`editor/world/js/ui/`)

| Module | Responsibility |
|---|---|
| `skin.js` | sprite lookup, `content()` measured rects, `apply()` (auto-crops padding), `hstrip()`, `nine()`, `gauge()`, `Skin.scale` |
| `font.js` | bitmap text from the retail glyph sheets, tinting, optional HUD drop shadow |
| `layout.js` | read side of `interface.json` — `window()`, `find()`, `size()`, `tex()` |
| `window.js` | `L2Window`: 3-part titlebar, hover-swap close button, drag |
| `wndmgr.js` | movement + clamping + persistence, z-order/raise, `setAlpha`, **Alt+Enter** reset |
| `statuswnd.js` | Phase C.1 — StatusWnd |
| `skillwnd.js` | Phase C.3 — MagicSkillWnd, plus `skillType()` used by other modules |

### 1.3 Windows delivered

**C.1 StatusWnd** (176×84) — 3-band background, level box, name, CP/HP/MP/EXP
gauges from the real `ps_*bar` art, HP readout, low-HP `ps_hpbarwarn` swap,
**width-resizable with fixed height** via the `ps_sizecontrol1` grip
(persisted), click-to-self-target using the client's own 13/10 px insets.

**C.3 MagicSkillWnd** (256×335) — two panes (Active+Toggle | Passive) exactly
as `MagicSkillWnd.uc` routes them, 189×23 tab strip, 34px icon cells (7 columns
in the 239px pane). Passives are not castable, not draggable, and rejected by
the shortcut bar. Disabled skills render inert. Toggles are marked.

**C.5 MenuWnd + SystemMenuWnd** (173×46 / 172×295) — the L2 menu bar
(bottom-right) and system menu (centered), decoded from `MenuWnd.uc` /
`SystemMenuWnd.uc` + Interface.xdat geometry. Menu buttons: Stat→CharSheet,
Inv→Inventory, Map→disabled (no minimap), Menu→SystemMenuWnd. System rows:
Option→settings panel, Restart→`location.reload()`, Quit→disconnect;
BBS/Macro/Help/Petition disabled (no backend).

**Retail Alt+ keymap (delivered)** — evidence: 5 independent L2 references
(pmfun.com/list/key, maxcheaters topic 7183, l2topzone, onlinegamecommands,
legacy-lineage2) + `SystemMenuWnd.uc:122-123`: Alt+K SkillWnd, Alt+T
Character Status, Alt+V & Tab Inventory, Alt+X SystemMenuWnd, Alt+C
ActionWnd, Alt+Enter layout reset (pre-existing). Alt+B/R/U unbound.
Never fires while typing in chat.

**C.6 ActionWnd** (256×335) — the retail actions window, three sections
(Basic 17 / Party 7 / Social 12) filtered from `actionname.json` categories
1/2/3 into the xdat's three ItemWindows (`ActionBasicItem` /
`ActionPartyItem` / `ActionSocialItem`, mined positions + 37×35 grid).
Categories 0/4/5 (special/pet/servitor) stay out — they belong to the pet
UIs. Click sends the `action` op (gateway routes ids 2..13 to
RequestSocialAction, the rest to RequestActionUse); right-click/drag assigns
an ACTION slot on the shortcut bar. Action icons were never mined (only
`action102.png` exists), so cells are text-labelled with the icon layered
in when the png resolves. `socialAction` broadcasts emote the local
character (`dance` clip); `changeWait` drives the sit/stand pose.

### 1.4 Changes to pre-existing code

- `gateway/src/bridge.js` — `skillList` now forwards `passive` + `disabled`
  (the parser in `gameclient.js` already read them; the bridge dropped them).
  **This extends the frozen contract in HANDOFF §4.1 — update it.**
- `editor/world/index.html` — `#self-status` removed; `#hud` is now `.dev-bar`
- `editor/world/style.css` — `#self-status` rules retired; dev-bar + hint styles
- `editor/world/js/combat.js` — `updateSelf()` no longer paints; keeps `self`
  and the death overlay only
- `editor/world/js/hotbar.js` — refuses passive skills
- `editor/world/js/main.js` — loads skin/font/layout/exp/skilltypes before any
  window is built; wires StatusWnd + SkillWnd; F9 dev bar; K skill window

### 1.5 Verification

```bash
# needs editor/world/server.py on :8083
cd editor/world
node verify_ui.js                                   # skin foundation
node verify_statuswnd.js                            # C.1 — 14/14
node verify_skillwnd.js <deviceId>                  # C.3 — 9/9, LIVE server
```

`verify_skillwnd.js` adopts a device id via `localStorage` before boot, so it
logs in as a real character. All three currently **PASS**.

---

## 2. What needs improving — ranked

### 2.1 Window body background — **do this first**

`L2Window` draws a titlebar and nothing else; every window body is transparent,
so content floats over the 3D scene. This is the single biggest visual gap and
fixing it improves **every** window at once, present and future.

Evidence available: `L2UI_CH3/npc1_back.png` is a flat panel, content
**310×381**, a **2px border** (dark outline at x=0, highlight at x=1), interior
alpha ≈ 221. Suitable for `Skin.nine(el, ref, 2)`. Confirm it is the right art
for each window rather than assuming one panel fits all.

### 2.2 The two invented bars must become one ShortcutWnd

`#skill-bar` (10 slots) and `#hotbar` (10 slots, Digit1-0) are **both invented**.
Retail has one `ShortcutWnd`: horizontal **504×46**, vertical 46×504, **12 slots
of 36px**, F-key labels, page prev/next, expand/reduce, joypad and rotate modes.
Art `shortcut_back` measures **492×46** of content in a 512×64 export.

`EShortCutItemType` is `{NONE, ITEM, SKILL, ACTION, MACRO, RECIPE}` — the bar
legitimately holds potions, actions, macros and recipes. The current hotbar
supports only skill+item.

`assets/uscript/Interface/ShortcutWnd.uc` (705 lines) is the behavioural spec.

### 2.3 Windows not yet built

`TargetStatusWnd` (176×46, art and behaviour already researched — see §4),
`ChatWnd` (348×187), `InventoryWnd`, `MenuWnd` (173×46, four 34×34 buttons),
`MinimapWnd`, `RadarWnd`, `SystemMenuWnd`, `DetailStatusWnd`.

### 2.4 Behaviour not implemented

- Skills do not cast from the new window; no cooldown display
- Toggle skills have no on/off state
- `weaponsAllowed` is not enforced (real values: DAGGER, DUAL, DUALFIST, BOW,
  POLE, SWORD, BLUNT, BIGBLUNT, BIGSWORD, SHIELD)
- Item drag-and-drop semantics from `InventoryWnd.uc` (`DragSrcName` →
  equip / unequip / reorder / pet transfer) are not implemented
- `L2Window` is missing most of the `UIAPI_WINDOW` contract: `Iconize`
  (minimise to icon), `IsMinimizedWindow`, `SetAlwaysOnTop`, `SetFocus`,
  anchors, tooltips

### 2.5 Invented UI still on screen

The `left-click: walk · WASD: run …` help strip (`#help`) has no retail
equivalent. The dev bar is deliberate and toggled with F9 (persisted).

### 2.6 The 7 remaining AUTHORED numbers

All labelled and audit-clean, but they are guesses: `INSET = 4` and the gauge
row offsets in `statuswnd.js`, the tab/pane/footer offsets in `skillwnd.js`,
the close-button gap in `window.js`. **Tier 5 can retire these** — see §6.

---

## 3. Gotchas — each cost real time

### Formats

- **`Interface.xdat` is NOT encrypted.** Plain serialised widget tree.
- **String length includes the NUL** (`len = strlen + 1`). Off by one and the
  header anchor stops matching; the scan returns zero records.
- **`hasSize == 0` means the width/height pair is ABSENT, not zero.** Read it
  unconditionally and every later record shifts 8 bytes, producing
  plausible-looking garbage such as `0x80000000` in the width column.
- **UE2 `.u` packages store original source** in `TextBuffer` exports. Do **not**
  truncate at the first non-ASCII byte — the comments are Korean (EUC-KR) and
  doing so cuts ~1.2 MB down to ~180 KB, which looks plausible.
- **umodel pads every export to a power of two.** The PNG size is not the art
  size (`icon_back` is 34×34 inside 64×64; `FrameBackLeft` 16×20 inside 16×32;
  `ps_hpbar_back` 8×12 inside 8×16). **533 of 583** textured controls are
  affected. Always use `Skin.content()`.
- **Font coverage is RGB LUMINANCE, not alpha.** `LargeFont-e`'s background sits
  at alpha 34, so tinting through alpha paints a box around every glyph. Same
  family of trap as the `_sp` textures in HANDOFF §5.
- **umodel flattens texture groups by leaf name**, so 431 references stage as
  393 files. Two refs differing only in their middle component collapse.

### Layout / rendering

- **The retail UI does not scale with resolution.** Of 142 window classes only
  **2** use `SetWindowSizeRel` (both full-screen overlays); 28 position
  absolutely. `Skin.scale` therefore defaults to **1 = pixel-perfect**;
  `?uiScale=N` is an explicit deviation for readability.
- **Gauge sprites are narrow tiles** (every `ps_*bar` is 8×16) meant to stretch
  horizontally. `Skin.gauge()` requires an explicit width for this reason.
- **Do not clobber a caller's positioning.** An early `Skin.gauge()` set
  `position: relative` unconditionally, dropping absolutely-placed rows back
  into normal flow — the symptom was a cumulative one-row drift per gauge.
- **`place()` must tolerate a no-arg call** — `WndMgr.resetAll()` does exactly
  that.

### Server / testing

- **Seeding requires the character to be OFFLINE.** aCis holds it in memory and
  writes it back on logout, silently overwriting DB edits.
  `seed_test_char.py` refuses while online.
- **New item rows need a gameserver restart.** `IdFactory` learns which object
  ids are taken by scanning tables *at startup*; ids inserted underneath a
  running server are not registered and could be handed out twice.
- **There may be no `*_loop.sh` watchdog running.** HANDOFF §2.2 assumes killing
  the java process makes a loop respawn it — that was **not** true in this
  session (both servers were started by a plain shell wrapper). Check
  `pgrep -fl GameServer_loop.sh` before killing anything, or you take the
  server down.
- **`pgrep -f "…GameServer"` matches the shell wrapper too.** Confirm with
  `ps -o comm=` that you found a `java` process, not `/bin/bash`.
- Account names are **SHA-256 of the device id** (`deriveCredentials` in
  `gateway/src/bridge.js`), so a device id cannot be recovered from an account.
  To test as a specific character you need its device id.

---

## 4. Research already done — don't repeat it

### The client's UI is three layers

`Interface.xdat` (layout) + `Interface.u` (logic, 142 classes, one per window)
+ `NWindow.u` (framework: `UIScript`, `UIDataManager`, `UIEventManager`, and
**28 `UIAPI_*` control classes**). Both `.u` files decrypt with
`l2encdec -p 111` and parse with the existing `tools/l2lib`.

**Before building any window, read its class in `assets/uscript/Interface/`.**

### Established facts

- **Window movement is universal and native** — `Move`/`MoveTo`/`MoveEx` are on
  the base class; there is no per-window draggable flag. Script-level
  `SetDraggable` appears in exactly one class.
- **Layout reset is a per-window callback.** Windows implement
  `OnDefaultPosition()`; it restores internal state, not just position
  (`ChatWnd` re-merges its tabs, `ShortcutWnd` collapses expansions and resets
  its page). Wired to Alt+Enter in `wndmgr.js`.
- **`SkillList` (0x58)** carries per skill: `passive`, level, id, `disabled` —
  matching the client's `ESkillCategory` and `Lock`.
- **`ESkillCategory` is only `{SKILL_Active, SKILL_Passive}`** — retail has two
  panes; toggles live with actives.
- **`ClassId(race, type, tier, name, parent)`** — 9 base / 18 first / 31 second
  / 31 third, chained by parent (Duelist ← Gladiator ← Warrior ← Human Fighter).
- **`StatusWnd.uc`**: clicking the window self-targets, accepted only between
  `rect.nX + 13` and `rect.nX + width − 10`; name is left-aligned; the EXP gauge
  is driven by `SetPointExp(curExp, level)` — absolute exp, fraction derived
  client-side from the level table.
- **`TargetStatusWnd.uc`** (researched, not built): name centred and coloured by
  level difference; MP bar shown/hidden per target type; pledge crest, alliance
  crest and name fields hidden for NPCs; close button; expand mode swaps
  `BackTex`→`BackExpTex` and reveals the `NpcInfo` tree.

### Con-colour table — extracted from `NWindow.dll`

| levelDiff | colour |
|---|---|
| ≤ −9 | `#FF0000` |
| −8 … −6 | `#FF9191` |
| −5 … −3 | `#FAFE91` |
| −2 … 2 | `#DCDCDC` |
| 3 … 5 | `#A2FFAB` |
| 6 … 8 | `#A2A8FC` |
| ≥ 9 | `#0000FF` |

**Unconfirmed:** the sign convention (`player − target` vs `target − player`).
Red at the most negative implies `player − target`, but that is inference.
Settle it with a live test before shipping.

---

## 5. Open questions

- **Default window positions.** The xdat gives sizes but no screen coordinates.
  A `-9999`/`-10001` sentinel at tail offset `+44` (1,560 of 1,962 records)
  looked promising and was **tested and rejected** — no top-level window carries
  a plausible x/y pair there. Don't spend a day on it again.
- **Where moved positions persist.** No script-level save/load API exists; the
  native layer writes it somewhere not yet located.
- **Default keybindings.** `Option.ini` is stripped in this client copy and
  `Lineage2us.ini` has no `[Engine.Input]`. Alt+Enter as the reset is player
  knowledge, not yet sourced from a file. Current bindings (F9 dev bar, K skill
  window, I inventory, C sheet) are **ours**, not retail.
- **3 of 140 xdat top-level windows** don't match the header anchor. Reported,
  never invented. None are HUD windows.
- **~~The xdat type-dependent tail~~ → RESOLVED.** Per-control x/y is decoded
  for both record shapes: `hasSize == 1` (24.8 fixed point at body+12/+16,
  [ui-mined-values.md](ui-mined-values.md)) and `hasSize == 0` (plain ints at
  body+30/+34 behind an auto-size block, [xdat-tail-has0.md](xdat-tail-has0.md)).
  StatusWnd gauges, TargetStatusWnd bars/name and ChatWnd panes are all
  decoded; `parse_xdat.py --check` guards the layouts.
- **~~ItemWindow/shortcut cell pitch~~ → RESOLVED**
  ([ui-mined-native.md](ui-mined-native.md) §1): pitch is data-driven —
  cell+gap from the xdat grid params: **37×35** for every grid (cell 32,
  gap 5/3); shortcut bar **pitch 37** with +5px separators after slots 4
  and 8 (all 12 slot positions are in the xdat as nested records).
  Slot art 34×34, icon 32×32 (1px inset), hardcoded in NCItemWnd's render.
- **~~Chat channel colors~~ → RESOLVED**
  ([ui-mined-native.md](ui-mined-native.md) §2): exact per-say-type table
  from the switch at 0x10141760 in NWindow.dll (SHOUT #FF7200, TELL #FF00FF,
  PARTY #00FF00, CLAN #7D77FF, TRADE #EAA5F5, ALLIANCE #77FF99,
  petition/announce #80FFFF, commander #FF9695, partyroom #FFF8B2,
  critical #7B7DF2, default incl. ALL/HERO #DCDCDC).
- **`StatusWndCenterTex` names no texture at all** — the middle band currently
  stretches the left cap (`DEVIATION`, flagged in source). Its rect is now
  decoded (x=28, auto-width 144 — bands tile 176 exactly), only the texture
  itself is missing.
- **Engine.dll is Themida-packed** — its code section is ciphertext, so
  static disassembly of anything living only there (e.g. `?Say2@UNetworkHandler`)
  is out of reach without unpacking. Everything mined so far lives in
  NWindow.dll.
- **CJK/Cyrillic fonts** unhandled: the `-r` variant declares 256 glyphs over
  2 pages with a different record layout. Only the Latin `-e` fonts are parsed.
- **HD upscale never run.** `build_uiskin.py --hd` exists (same Real-ESRGAN pass
  as the character textures) but sprites are staged at 1×.

---

## 6. Tier 5 — the DLLs are open, use them

`NWindow.dll` is PE32 / `coff-i386`, image base `0x10000000`, sections
`.text 0x10001000`, `.rdata 0x1022c000`, `.data 0x1034c000`.

It exports **803 native thunks** with MSVC-mangled names following UE2's
`exec<FunctionName>` convention, e.g.
`?execGetTargetNameColor@UUIDATA_TARGET@@…`. So any native behaviour is
reachable by name → address → disassembly:

```bash
cd assets/interlude/system
objdump -x NWindow.dll | grep execAddItem@UUIAPI_ITEMWINDOW   # -> ordinal + RVA
objdump -d --start-address=0x<VA> --stop-address=0x<VA+0x120> NWindow.dll
```

Note the names are **not** referenced as pointers from `.rdata`, so searching
for a string xref finds nothing — go through the **export table** instead.

**Highest-value targets:**
- ~~`execAddItem@UUIAPI_ITEMWINDOW`~~ — done: pitch is data-driven, not in
  this thunk; full chain and values in [ui-mined-native.md](ui-mined-native.md) §1
- ~~the `StatusBar` thunks~~ — gauge offsets came from the xdat tail instead:
  [xdat-tail-has0.md](xdat-tail-has0.md) §4
- `Window.dll` — window drag/minimise/anchor behaviour

---

## 7. Test character

`seed_test_char.py` populates a character so the windows have something to show.

```bash
python3 tools/dev/seed_test_char.py <charName> --level 40 --gm        # dry run
python3 tools/dev/seed_test_char.py <charName> --level 40 --gm --apply
```

Everything written comes from server data: exp from `playerLevels.xml`, skills
from `data/xml/classes/<class>.xml` (`minLvl` filtered, highest level per id),
item ids validated against `assets/gamedata/itemname.json`. Rows are backed up
to `server/seed-backups/` first. `--gm` sets access level 7, enabling
`//set`, `//skill`, `//give` in chat.

The character must be **offline**, and the **gameserver must be restarted**
afterwards so `IdFactory` registers the new item object ids (§3).

---

## 8. Suggested order

1. **Window body background** (§2.1) — unblocks every window
2. **Confirm the con-colour sign convention** live, then finish
   `TargetStatusWnd` (§2.3); research is already done
3. **`ShortcutWnd`** (§2.2) — the biggest correctness win: deletes two invented
   bars and gets 12 slots, F-keys, pages and all five slot types
4. **`ChatWnd`**, then `InventoryWnd` (drag semantics from `InventoryWnd.uc`)
5. **Tier 5 mining** (§6) to retire the last 7 authored numbers
6. **Skill behaviour**: casting, cooldowns, toggle state, `weaponsAllowed`

Keep `audit_guesses.py --check` at PASS, and add a `verify_*.js` per window with
a screenshot inspected by eye. That is the house rule — follow it.
