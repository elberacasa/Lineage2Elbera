# The unsourced-value inventory

Every numeric and colour literal in the client and the tool chain, classified
by whether anything ties it to a decoded origin.

Produced by `tools/audit/unsourced.py` (re-runnable, `--check`-gated).

**Revision 2, 2026-08-08 (UI/audio lane).** Revision 1 was an inventory: it
measured the problem and applied nothing. This revision applies it to one
lane — `editor/world/js/ui/**`, `js/audio.js`, `js/worldaudio.js`,
`js/gamesound.js`, `style.css`, `tools/ui/**`, `tools/audit/**` — and reports
what moved, what was decoded on the way, and what was left AUTHORED and why.

The tree was being edited by other agents throughout. Numbers below say which
part of a change is this lane's and which is not; where they cannot be
separated, they say so.

---

## 0. Counts

| bucket | rev 1 | now | Δ |
|---|---:|---:|---:|
| BENIGN | 5,438 | 6,000 | |
| SOURCED | 291 | 472 | |
| AUTHORED | 238 | 352 | |
| **UNSOURCED** | **2,225** | **1,866** | **−359** |
| TOTAL | 8,192 | 8,690 | |

Measured against the working tree at the start of this session (which had
already moved past rev 1): **2,228 → 1,866**.

### By domain

| domain | session start | now | note |
|---|---:|---:|---|
| client-ui | 294 | **24** | the 24 are `chat.js` (15) and `labels.js` (9), which are not this lane |
| client-audio | 32 | **0** | |
| client-world | 351 | 404 | **grew**: another agent's `main.js` (112→166) and `bspfloor.js`; nothing here touched it |
| tool-pipeline | 979 | 944 | `tools/ui/**` went 99 → 0; the rest is other lanes |
| tool-parser | 338 | 338 | untouched |
| tool-test | 157 | 156 | |

### This lane

| | start | now |
|---|---:|---:|
| `editor/world/js/ui/**` | 294 | **0** |
| `js/audio.js` + `worldaudio.js` + `gamesound.js` | 32 | **0** |
| `tools/ui/**` | 99 | **0** |
| **lane total** | **404** | **0** |

Its 404 literals are now 296 SOURCED, 1,015 BENIGN and 234 AUTHORED.

### Disclosure: 24 of the 359 came from the classifier, not from the code

`tools/audit/unsourced.py` was changed in four ways (each documented at its
site in that file). To separate the two effects, the NEW tool was run against
the OLD tree: **2,232 → 2,208**. So 24 literals repo-wide, in files nobody
touched, moved bucket because the classifier changed. The other ~340 are code
and comments. The four changes:

1. **`.dll` / `.ini` / `.uc` are citations.** The extension list already
   accepted `.dat`, `.utx`, `.unr`. A comment naming `Core.dll` or
   `WindowsInfo.ini` or `InventoryWnd.uc` is exactly as much of a citation,
   and those three were silently not counted.
2. **A `SPEC:` marker.** Three tools here are format readers — a hand-rolled
   PNG decoder, a PE export walker, a `.psa` chunk walker. Their constants are
   not decoded from the Lineage client and are not ours either: a published
   standard fixes them. SOURCED would be a lie and AUTHORED a worse one. The
   marker fires only on the literal string `SPEC:` and the convention is that
   it *names* the standard, so every use is greppable and checkable. No
   marker, no exemption.
3. **Three narrow BENIGN rules**, each anchored to the construct that makes
   the number structural: the CSS `left:50% + translate(-50%,-50%)` centring
   idiom, a 4-byte RGBA stride over a buffer, and `×100`/`÷100` on a line that
   mentions percent. A bare 50 or 4 elsewhere is still counted.
4. **`--write-baseline` can no longer forgive silently.** It now prints every
   file whose count went *up* and records it in an `_absorbed` block in
   `unsourced_baseline.json` with the date and each `was -> now`; `--check`
   prints a note when that block is non-empty. See §5.

---

## 1. What was decoded on the way

Four values that were typed are now read out of the client's own files. Each
ships a `--check` that re-reads the binary and fails on drift.

### 1.1 The target-name con-colour ladder — 13 literals — DECODED

`targetstatuswnd.js` held seven hex colours and six thresholds as a
hand-written `if` chain. All thirteen are in the client, and the function is
named by the export table:

    ?execGetTargetNameColor@UUIDATA_TARGET@@QAEXAAUFFrame@@QAX@Z  ->  0x1012a950

Its body evaluates one script int and runs a flat compare ladder over it, five
rungs of exactly

    83 F8 <imm8>   cmp eax,<threshold>
    7F 07          jg   +7
    B8 <imm32>     mov  eax,<AARRGGBB>
    EB <rel8>      jmp  out

at `0x1012a9d2`, closing with a branchless pair at `0x1012a9fe`:

    33 C9 / 83 F8 08 / 0F 9F C1 / 83 E9 01 / 81 E1 00A2A7FD / 81 C1 FF0000FF

so `<=8` yields `base+mask = 0xFFA2A8FC` and `>8` yields `base = 0xFF0000FF`.

| diff | colour |
|---|---|
| ≤ −9 | `#FF0000` |
| ≤ −6 | `#FF9191` |
| ≤ −3 | `#FAFE91` |
| ≤ 2 | `#DCDCDC` |
| ≤ 5 | `#A2FFAB` |
| ≤ 8 | `#A2A8FC` |
| else | `#0000FF` |

**Measured**: the thirteen values, read as bytes by
`tools/ui/mine_native_colors.py` section 4, which also re-resolves the
function's RVA through the PE export directory so a rebuilt DLL cannot
silently move it. **Not decoded here**: which way round the argument runs.
That is settled elsewhere (the gateway's `target_ok.color` and `verify-level`)
and the tool says so rather than implying it.

The values happen to equal what the file already had — this is a *negative*
result on fidelity and a positive one on provenance. The point is that they
are now READ: `conColor()` is one line, `Layout.ladder('conColor', diff)`.

### 1.2 `<font color="LEVEL">` — 7 literals removed, 1 decoded, and a fidelity fix

`npcdialog.js` carried an eight-name colour table: LEVEL, BROWN, WHITE, RED,
GREEN, BLUE, YELLOW, ORANGE.

**Seven of those eight names do not exist in the client.**
`NCHtmlObject::GetMatchedColor` (`0x100825d0`) is the NPC-dialog parser's
entire name table. It compares its argument against exactly one wide string,
`L"LEVEL"` at `0x1024dd44` — referenced once in the whole image — and returns
the immediate at `0x10082653`. Every other name it concatenates after
`L"0xff"` (`0x1024dd38`) and hands to the numeric parser, i.e. treats as a
bare hex colour.

| | client had | retail |
|---|---|---|
| `LEVEL` | `#c8b98a` | **`#FFCC00`** |
| `BROWN`/`WHITE`/`RED`/`GREEN`/`BLUE`/`YELLOW`/`ORANGE` | seven typed colours | **no such names** |

The table is gone. `safeColor()` now takes hex as written, resolves `LEVEL`
through `Layout.htmlColor()`, and **drops** anything else rather than giving
it an invented colour — the text still renders, at its inherited colour.

### 1.3 `WindowsInfo.ini` — 55 sections that had never been read

The client ships `assets/interlude/system/WindowsInfo.ini`: the position every
retail window opens at, in absolute 1024×768 pixels, and for six of them the
size as well. **Fourteen files under `js/ui/` cited it in a comment** — several
next to a typed pair of numbers, and three next to the words *"AUTHORED dock
(WindowsInfo.ini not mined for this window)"* while the window in question had
a section all along (`MultiSellWnd` is at 220,189).

`tools/ui/mine_windowsinfo.py` reads it into `assets/gamedata/windowsinfo.json`
and `Layout.dock(name)` serves it. The gate is a cross-check, not a
re-statement: the six sections carrying `width`/`height` must equal the size
`parse_xdat.py` independently recovered from `Interface.xdat` for the same
window name. **6/6 agree exactly.** Two unrelated client files agreeing on six
sizes is what says the ini parse is reading the right fields.

Now read rather than typed: `MinimapWnd`, `InventoryWnd`, `AbnormalStatusWnd`,
`MultiSellWnd`, `ShortcutWndHorizontal`/`Vertical`, `TargetStatusWnd`,
`PartyWnd` (posX), `StatusWnd` (see below).

**Deliberately NOT mapped**: eight sections named by bare number, `[1]`..`[8]`.
`[6]` is 348×187, exactly ChatWnd's size in the xdat, so they are plainly
window ids — but *which* id is which window is not decoded, so they ship under
their literal names and nothing maps them. A wrong mapping would dock a window
at another window's corner and look deliberate.

### 1.4 Two deviations are now DERIVED instead of typed

- `statuswnd.js` deviates from retail's posX=444 because the sourced
  `TargetStatusWnd` dock overlaps it by 69px. The deviated value used to be the
  literal `513`. It is now `Layout.dock('TargetStatusWnd').x +
  Layout.size('TargetStatusWnd').w` — both operands read, the *decision* to
  abut being the only authored part. If either decode goes missing it falls
  back to retail's own 444, not to a number of ours.
- `partywnd.js` deviates on posY to clear the minimap. `500` is now
  `MinimapWnd.dock.y + MinimapWnd.height + titlebar + MAP_GAP`, with only
  `MAP_GAP = 4` left AUTHORED and marked.

---

## 2. Defects found and fixed

### 2.1 `CULL_DISTANCE_M` was truncating every NPC sound in the game

Rev 1 finding #6, now applied. The constant is **deleted**, not raised.

Under the linear model `audio.js` derives from ALAudio.dll — gain =
`1 − d/(R×50)` — the gain reaches exactly zero at `maxDistance`, so
`maxDistance` *is* the inaudibility cutoff and `Math.min` with a second number
could only truncate it. All 6,519 `npcgrp` records carry `sound_radius` 250
(= 125 m audible) and were being cut at 120 m; 176 `skillsoundgrp` entries
reach 300–400 m and were losing up to 70% of their range.

### 2.2 `playAt`'s default radius was `RADIUS_UNIT`'s number, not a radius

`playAt(..., radius = 50)`. 50 is `GAudioMaxRadiusMultiplier`. The driver's
default radius is a *different* Core.dll global, `GAudioDefaultRadius = 80`,
which the file already exports as `DEFAULT_RADIUS` and which `ambientStart`
already used. Both defaults are now that constant.

### 2.3 `gamesound.js` claimed nothing in it was authored. Four things were.

Its header read *"Nothing here is authored — every sound name, volume and
radius comes out of the client's own tables."* Checked against
`assets/audio/bindings.json`:

| bank | records | carry `v` | carry `r` |
|---|---:|---:|---:|
| npc | 6,495 | 6,495 | 6,495 |
| skill | 1,368 | 1,368 | 1,368 |
| **weapon** | **1,311** | **0** | **0** |

So the five `rec.v \|\| 250` / `rec.r \|\| 250` fallbacks on the npc and skill
paths were unreachable and are gone; the two weapon calls were **live** typed
values and are now marked AUTHORED at the site. The header carries a dated
correction.

### 2.4 HANDOVER: `weapongrp.json` has a `drop_radius` that never reaches the client

`weapongrp.json` carries `drop_radius` per weapon (7 on the first record).
`tools/audio/build_audio.py` reads `item_sound`, `drop_sound` and
`equip_sound` from the same records and **never reads `drop_radius`**, so
`bindings.json` ships no `r` for a weapon and `gamesound.js:drop()` uses a
typed 30. That file has another owner; the value is on disk and the fix is one
line in the emitter plus `radius: rec.r` at the call site. Marked at the call
site with this note.

---

## 3. The method: bind, don't retype

Rev 1's finding #4 was that `Layout.color()` was wired to 650 decoded colours
and called twice. The structural cause was a shape:

    const size = Layout.size(WND, 'ItemList') || { w: 240, h: 314 };

`fallback_reach.py` had proved all 53 such sites DEAD (the lookup always
resolves), which made them harmless — but a literal replaced by a better
literal is still a literal, and the audit counts it either way.

**The shape is now extinct.** `layout.js` gained four accessors that degrade to
*nothing* instead of to a number — `sizeOf`, `posOf`, `gridOf`, `autosizeOf`,
`windowSize` — each returning the empty rect and logging the missing
window/control once. Painting nothing is the honest answer for a decode we do
not have; a typed size would be an invention, and the file's own header
forbids one.

Three harvests that existed but had no reader now have one: `Layout.dock`,
`Layout.ladder` / `ladderRungs`, `Layout.htmlColor`.

`tools/audit/layout_bind.py` is the gate:

- **GATE A** — no `Layout.*(...) || {literal}` anywhere. 0 today; **60 on the
  pre-fix tree, exit 1** (verified by running it against a `git archive` of
  HEAD).
- **GATE B** — every window/control pair the UI asks for resolves against the
  shipped `interface.json`, using `fallback_reach.py`'s own index and resolver
  rather than a second copy. 68 resolve, 9 dynamic/unresolvable.
- **GATE C** — every `Layout.dock` / `native` / `ladder` key names a real entry
  in the harvest. A typo in one of those names is otherwise silent.

Other bindings applied the same way:

- `shortcutwnd.js`'s `SLOT_X` / `SLOT_Y` / `SLOT` / `SLOT_Y0` / `SLOT_V_X0`
  (16 literals) deleted; the row reads `Layout.shortcutArt()` and draws no
  slots if that harvest is missing.
- `minimapwnd.js`'s `+20/+18` tile-grid origin is now *solved* from
  `minimap.json`: for every tile, `tx − worldRect.x/span` is the origin index.
  It is asserted across all 100 tiles and warns if the manifest disagrees with
  itself.
- `inventorywnd.js`'s item-count badge → `Layout.native('itemSlotCount')`;
  adena → `Layout.textColor(WND, 'AdenaText')`; tab labels →
  `Layout.native('buttonLabel')` for **both** tabs, because the InventoryTab
  record carries no colour and NCTabButton shares NCButton's slot-99 paint —
  retail marks the selected tab with a different *texture*, which the same
  line already swaps.
- `clanwnd.js`'s `_text()` default `#dcdcdc` → `Layout.native('textBoxDefault')`.
- Button sizes in `clanwnd.js` / `tradewnd.js` now read the button art's own
  content rect instead of a typed 49×23, and return null if the art is absent.

---

## 4. What was left AUTHORED, and why

234 in this lane. Not absolution — for a 1:1 replica an admitted invention is
still an invention — but every one now says so at its own site. The families:

| what | where | why nothing decodes it |
|---|---|---|
| Slot-cell **text labels** (font 8px, `#d8cba6`, line-height, max-height) | `actionwnd.js`, `shortcutwnd.js` | retail drew action **icons** in these cells and never any text; no record, texture or instruction governs a label here |
| Item-cell **selection outline** `#c8a959` (10 sites) | shop/store/trade/warehouse/multisell | no ItemWindow record carries a colour, NCItemWnd's render holds exactly one colour immediate (the badge), and no xdat control names a selection texture. **Lead, not a conclusion:** `L2UI_CH3.iconselect1/2` exist in the extracted library and are referenced by nothing we have decoded — if someone ties them to item selection this outline should become that art, not another colour |
| Minimap **self arrow** and **entity dots** | `minimapwnd.js` | the native control's marker art was never exported |
| Skill-window **toggle dot** | `skillwnd.js` | MagicSkillWnd.uc keeps toggles in their own pane; retail has no such marker |
| **Bar boxes** (TargetStatusWnd HP/MP height, radius, plate, border) | `targetstatuswnd.js` | BarCtrl renders natively; the xdat gives position and autosize but names no texture and no height |
| The **count/price prompt** | `storewnd.js` | retail opens `DIALOG_NumberPad`, which the xdat does not describe |
| The **audio mixer** (master .7 / music .35 / sfx .8 / ambient .45 / ui .6) | `audio.js` | retail has four sliders and no `ui` or `ambient` bus at all. The shipped `Option.ini` is one player's **saved** state (`SoundVolume=0.0`), not a factory default — reading it as one would mute the game |
| Per-source **volume** defaults (250) | `audio.js`, `gamesound.js`, `worldaudio.js` | Core.dll/ALAudio.dll export `GAudioMaxRadiusMultiplier` and `GAudioDefaultRadius` and **no** default volume; the tables that would supply one always carry their own |
| WebAudio artefact constants (0.02 smoothing, 0.05 crossfade tail) | `audio.js` | browser-side, no client counterpart |
| `HYSTERESIS 1.15`, `UPDATE_HZ 4` | `worldaudio.js` | retail's emitter culling is inside the engine and was not decoded |
| **Docks with no ini section** (ActionWnd, ClanWnd, ShopWnd, PrivateShopWnd, TradeWnd, WarehouseWnd, MagicSkillWnd, QuestTreeWnd, MenuWnd, SystemMenuWnd, NpcDialog) | various | `WindowsInfo.ini` has no section for them. `QuestListWnd` exists but is the separate 600×326 GM window — deliberately not borrowed |
| **Measurement thresholds** in the image miners (`MIN_RUN`, ±3px slop, saturation > 24, run widths) | `tools/ui/mine_invslots.py`, `mine_shortcutslots.py` | these are the acceptance window of an instrument, not values read from the client; each is justified against a decoded quantity and the miners' `--check` gates prove they were wide enough and no wider |
| Regression tripwires (`decoded >= 1600`, `ok < 13000`, `checked < 3`) | various tools | floors on a decode's output, not decoded quantities |
| The `--hd` 4× upscale | `tools/ui/build_uiskin.py` | nothing in the client asks for an upscale at all |
| **The whole of `style.css`** | — | it is the dev shell (HUD, help, online toggle, settings, spinner) plus hover affordances retail draws with a texture swap. A header block at the top of the file states this; `#c9a959` there is a brand gold for scaffolding, not a claim about retail |

`VOLUME_SCALE = 1/255` remains the genuinely open audio constant, unchanged and
still correctly described as open in `audio.js`'s header.

---

## 5. The gate

```bash
python3 tools/audit/unsourced.py --check      # per-file, can only shrink
python3 tools/audit/layout_bind.py --check    # the binding gate (§3)
python3 tools/ui/mine_windowsinfo.py --check  # the docks, vs Interface.xdat
python3 tools/ui/mine_native_colors.py --check
python3 tools/audit/fallback_reach.py --check # now vacuous by design: 0 sites
```

All five pass. Each was proved to FAIL on the pre-fix tree, not merely to pass
on the post-fix one:

| gate | pre-fix | now |
|---|---|---|
| `layout_bind --check` | **exit 1**, 60 guarded sites | exit 0 |
| `mine_windowsinfo --check` | **exit 1** (no output file) | exit 0 |
| `mine_native_colors --check` | **exit 1** on the pre-pass JSON (no `ladders`, no `htmlNamedColors`) | exit 0 |
| `unsourced --check` (new tool + new baseline) | **exit 1** on a `git archive` of HEAD | exit 0 |
| `unsourced --check` (injected `= 1337` in `skin.js`) | **exit 1**, `skin.js: 0 -> 1` | exit 0 restored |

### What the rebaseline absorbed — stated, not hidden

The baseline was re-recorded at the end of this pass (88 files, 1,866). Five
files had **grown** since the last baseline, all outside this lane and all
being edited concurrently by other agents. `--write-baseline` printed them and
wrote them into `_absorbed` in `tools/audit/unsourced_baseline.json`:

| file | was | now |
|---|---:|---:|
| `editor/world/js/main.js` | 112 | 166 |
| `tools/world/bspfloor.py` | 26 | 81 |
| `tools/dev/measure_http.py` | 0 | 17 |
| `editor/world/js/bspfloor.js` | 1 | 3 |
| `editor/world/js/character.js` | 5 | 6 |

129 literals absorbed. `--check` now prints a note whenever that block is
non-empty, so the forgiveness is visible to whoever runs it next.

The two tools the brief named as blocking the gate —
`tools/anim/creature_anim_table.py` and `tools/audio/build_stepnotify.py` —
were **annotated only** (comments; no behaviour changed) and are at 0.

---

## 6. Verified in the browser

`editor/world/verify_*.js` against the mock gateway on :8085, after the change:

PASS — `verify_ui`, `verify_statuswnd` (including *"StatusWnd dock (513,0;
DEVIATION from sourced 444)"*, now derived), `verify_skillwnd`,
`verify_shortcutwnd`, `verify_detailstatuswnd` (27/27), `verify_inventorywnd`,
`verify_minimap` (Giran resolves to 22_22 through the solved grid origin),
`verify_partywnd`, `verify_abnormal`, `verify_multisellwnd`, `verify_dialog`,
`verify_clanwnd`, `verify_questwnd`, `verify_shopwnd`, `verify_storewnd`,
`verify_warehousewnd`, `verify_actionwnd`, `verify_audio` (13/13),
`verify_audio_coverage` (13/13).

**PRE-EXISTING FAILURES, not caused by this lane** — both reproduce identically
with the pre-change file restored from `git show HEAD:`:

- `verify_tradewnd` — times out at `verify_tradewnd.js:70`, waiting for the
  `tradeRequest` op after `/trade` is typed into chat. The path runs through
  `chat.js` / `main.js`, both modified in the working tree by other agents.
- `verify_targetwnd` — `aimAt(70001): entity never projected on screen`.

Several suites are **flaky against a dead mock**: `mock_gateway.js` exited
mid-run more than once and every suite then failed at its first wait. Confirm
the mock is up before believing a failure.

---

## 7. Still open, ranked

1. **`main.js` — 166 UNSOURCED, the largest client file and growing.** Includes
   rev 1's finding #1 (the sky: `#0096CE` is decoded and in hand, task #19) and
   #10 (the interior lighting rig, 11 values, while `light.json` exists for all
   100 tiles).
2. `chat.js` (15) and `labels.js` (9) — the last client-ui literals; another
   lane.
3. `tools/world/convert.py` (156) and `tools/src/char_pipeline/assemble.py`
   (57) — they bake values into shipped assets, where a wrong number is silent
   and permanent.
4. Rev 1 finding #7, character-height fallbacks in the wrong unit system, with
   one live path (`Evilate_m00`) — untouched, other lane.
5. `parse_xdat.py`'s type gate still discards 25 decodable EditBox colours
   (rev 1 finding #5). The 33 ItemWindow `#FFD8F1` values remain uncorroborated
   and must not be adopted.
6. `weapongrp.drop_radius` → `bindings.json` (§2.4).
7. `L2UI_CH3.iconselect1/2` — extracted, referenced by nothing. If they are the
   item-selection art, ten AUTHORED outlines become sourced.
