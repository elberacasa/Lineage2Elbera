# Native mining (NWindow.dll) — ItemWindow pitch + chat channel colors

**Status: decoded, with disassembly evidence.** Both values come from
`assets/interlude/system/NWindow.dll` (PE32, image base 0x10000000,
objdump workflow: [ui-port-handoff.md](ui-port-handoff.md) §6). All
addresses below are VAs; every snippet can be re-run with
`objdump -d --start-address=0x<addr> NWindow.dll`.

Companion docs: [ui-mined-values.md](ui-mined-values.md) (xdat x/y),
[xdat-tail-has0.md](xdat-tail-has0.md) (the hasSize==0 records).

---

## 1. ItemWindow cell pitch — data-driven, 37×35 everywhere

**Answer: the pitch is not a constant. It is a per-control parameter set,
read from the xdat, and every grid control in the client uses
pitch = (cell + gap) = (32+5, 32+3) = 37×35.** The shortcut bar is
pitch 37 with a +5px separator after every 4th slot.

### 1a. Native evidence — NCItemWnd grid layout

`UUIAPI_ITEMWINDOW::execAddItem` (export, 0x1010bee0) forwards through
`UItemWindowHandle::execAddItem` (export, 0x1012e440) into the native
control `NCItemWnd` (RTTI `.?AVNCItemWnd@@` at 0x1034c6bc; RTTI walk:
TypeDescriptor 0x1034c6b4 → vtable 0x1023bb94, slot +0x204 →
`NCItemWnd::AddItem` at 0x1002fd80).

NCItemWnd's layout fields (ctor at 0x10031b70 sets defaults,
ctor-param variants at 0x10031e20 / 0x10032020 assign from arguments):

| field | meaning | default |
|---|---|---|
| this+0x258 | grid columns | 5 |
| this+0x25c | grid rows | 5 |
| this+0x26c | cell X | 32 (0x20, at 0x10031bab-0x10031bb6) |
| this+0x270 | cell Y | 32 |
| this+0x274 | gap X | param |
| this+0x278 | gap Y | param |

The render (`NCItemWnd` vtable slot 99, 0x10030d90) advances the grid by
**cell + gap**:

```
10030f3b:  movl 0x274(%esi),%edx      ; gapX
10030f41:  addl 0x26c(%esi),%edx      ; + cellX  -> column pitch
10030f47:  addl %edx,-0x20(%ebp)      ; x += cellX + gapX
10030e88:  movl 0x278(%esi),%eax      ; gapY
10030e8e:  addl 0x270(%esi),%eax      ; + cellY  -> row pitch
10030e94:  addl %eax,-0x24(%ebp)      ; y += cellY + gapY
```

and columns are taken by `idivl` against this+0x258 (0x10030ee0-0x10030ee9).
The slot visuals are hardcoded: **34×34 slot art drawn at (x−1, y−1),
32×32 icon at (x, y)** — 1px inset (0x1003115d-0x1003116d push 0x22/0x22
slot, 0x101827a3/0x101827c9 push 0x22 slot + 0x20 icon). The icon-cell
fields this+0x22c/0x230 are initialised to 34/34 in the InitWindow path
(0x1002e7c3-0x1002e7d7, `movl $0x22,%eax`).

### 1b. Data evidence — the xdat carries (cols, rows, cap, cell, gap)

Every `ItemWindow` record in `Interface.xdat` carries, immediately after
the `-9999` sentinel of its tail, **seven ints**:
`cols, rows, capacity, cellX, cellY, gapX, gapY` — matching the ctor
argument order above. Extraction over all 37 ItemWindow records:

- **all 31 grids** (InventoryItem, QuestItem 6×4 cap 250; SkillItem/
  PItemWnd 6×8 cap 80; Shop/Trade/Warehouse 6×3..4; RecipeBook 6×8; …):
  **cell 32×32, gap (5,3) → pitch 37×35**
- `HennaItem`: cell 24×24, gap (0,3) → pitch 24×27
- drag boxes (`ItemDragBox1-3`, `ItemRefined`, `ItemUnrefine`):
  cell 36×36, gap (0,0) → pitch 36

This replaces the port's authored 34px grid pitch.

### 1c. Shortcut bar — exact slot positions, from the xdat

Contrary to [ui-mined-values.md](ui-mined-values.md) §3 ("only Shortcut1
exists in the xdat"), **all 12 slots are declared**, as nested variant
records inside each `Shortcut1`'s span (header: `[type][name][parentName]
[-1,-1][parent]["undefined"]["undefined"][5 ints][x24.8][y24.8]`).
Positions (identical in both orientations):

```
slot  1   2   3   4  |  5    6    7    8  |  9    10   11   12
pos  32  69  106 143 | 185  222  259  296 | 338  375  412  449
step  +37 +37 +37    | +42 +37  +37  +37 | +42  +37  +37  +37
```

**Slot pitch = 37** (36px slot + 1px), with a **+5px separator after
slots 4 and 8** (42px steps), grouping the bar 4|4|4. First slot at
(32,5) horizontal / (5,32) vertical, bar 504×46: last slot ends at
449+36=485, 19px right margin. This replaces the authored 39=36+3
derivation.

---

## 2. Chat channel colors — exact table from NWindow.dll

### Evidence chain

1. `ChatWnd.uc:390-407` — `HandleChatmessage` parses `Type`, `Msg`,
   `ColorR/G/B`, `SysType` from the EV_ChatMessage (540) param.
2. `NCChatWnd::AddChatMessage` (0x101392c0, args
   `msg=ebp+8, color=ebp+0xC, type=ebp+0x10, systype=ebp+0x14`) builds
   exactly that param — wide-string keys `ColorR`(0x1027c6e8)/
   `ColorG`(0x1027c6d8)/`ColorB`(0x1027c6c8)/`Msg`(0x1027c6f8)/
   `SysType`(0x1027c828) — and posts event 0x21C at 0x1013944d. The debug
   string `NCChatWnd::AddChatMessage` (0x1027c7f4) is referenced at
   0x101394b3. Color bytes: R at ebp+0xE, G at +0xD, B at +0xC
   (0x1013939b-0x101393fd) → **color dword = 0xAARRGGBB little-endian
   (bytes B,G,R,A)** — confirmed against the con-color constants
   0xFFFF9191/0xFFFAFE91/0xFFA2FFAB at 0x1012a9e3-0x1012aa07 =
   #FF9191/#FAFE91/#A2FFAB (ui-port-handoff §4).
3. Its caller is the chat dispatcher at 0x1013df30 (switch on type:
   0x12/6/7/0xE/0xF/0x10), which receives the color from the
   **say-type switch at 0x10141760** — a native L2ParamStack sink
   (type = 2nd stack param at 0x101417e1). Inline constants per case:

### The table (#RRGGBB)

| say type | id | color dword (LE bytes B,G,R,A) | **#RRGGBB** | evidence (push site) |
|---|---|---|---|---|
| ALL | 0 | — | **#DCDCDC** (default) | 0x1014191a |
| SHOUT `!` | 1 | 0xFFFF7200 | **#FF7200** (255,114,0) | 0x101417ea |
| TELL `"` | 2 | 0xFFFF00FF | **#FF00FF** (255,0,255) | 0x1014182c |
| PARTY `#` | 3 | 0xFF00FF00 | **#00FF00** (0,255,0) | 0x101417fa |
| CLAN `@` | 4 | 0xFF7D77FF | **#7D77FF** (125,119,255) | 0x10141813 |
| GM | 5 | — | **#DCDCDC** (default) | 0x1014191a |
| PETITION_PLAYER `^` | 6 | 0xFF80FFFF | **#80FFFF** (128,255,255) | 0x10141891 |
| PETITION_GM `&` | 7 | 0xFF80FFFF | **#80FFFF** | 0x101418a1 |
| TRADE `+` | 8 | 0xFFEAA5F5 | **#EAA5F5** (234,165,245) | 0x1014185f |
| ALLIANCE `$` | 9 | 0xFF77FF99 | **#77FF99** (119,255,153) | 0x10141878 |
| ANNOUNCEMENT | 10 | 0xFF80FFFF | **#80FFFF** (big-text path) | 0x101418b8 |
| BOAT / L2FRIEND / MSNCHAT | 11–13 | — | **#DCDCDC** (default) | 0x1014191a |
| PARTYMATCH_ROOM | 14 | — | dispatcher-internal (0x1013dfda) | — |
| PARTYROOM_COMMANDER | 15 | 0xFFFF9695 | **#FF9695** (255,150,149) | 0x101418e3 |
| PARTYROOM_ALL | 16 | 0xFFFFF8B2 | **#FFF8B2** (255,248,178) | 0x101418f1 |
| HERO_VOICE `%` | 17 | — | **#DCDCDC** (default, no case!) | 0x1014191a |
| CRITICAL_ANNOUNCE | 18 | 0xFF7B7DF2 | **#7B7DF2** (123,125,242) | 0x10141908 |

Verify any row:
`objdump -d --start-address=<site-0x10> --stop-address=<site+0x20> NWindow.dll`.

### Notes

- **Say-type numbering matches aCis `SayType.java` and
  `gateway/README.md` exactly** (0..18 as above; 15=PARTYROOM_COMMANDER,
  16=PARTYROOM_ALL, 17=HERO_VOICE). The switch has cases for
  1,2,3,4,6,7,8,9,0xA,0xF,0x10,0x12 — everything else falls through to
  the default grey **#DCDCDC** (pushed at 0x1014191a, systype 0).
- **HERO_VOICE has no dedicated case in this build** — it renders in the
  default grey. Report data, not expectation.
- The beige **#B09B79** (0xFFB09B79, ×99 sites) is the *system/notification
  message* color used by the msgHelper paths (e.g. 0x10170650 switch),
  not a say channel. System messages (`CHAT_SYSTEM`, type 5) take the
  `#DCDCDC` default with a `SysType` id.
- Engine.dll's `?Say2@UNetworkHandler@@` / `?OnSay2@UGameEngine@@`
  exist (export table) but Engine.dll is **Themida-packed** — its code
  section is ciphertext and statically unreadable. Not needed: the color
  assignment is entirely on the NWindow.dll side (0x10141760 →
  0x1013df30 → 0x101392c0 → EV_ChatMessage).

---

## 3. What was ruled out

- A static per-type color table in `.rdata`/`.data` — scanned for runs of
  ≥3 consecutive 0xFFxxxxxx dwords: none. Colors are inline immediates.
- `ColorR`/`MsgColorR` as narrow strings — absent in all four DLLs; the
  param keys are UTF-16LE wide strings in NWindow.dll only.
- Pitch as a hardcoded constant — the only hardcoded dimensions are the
  34px slot art and 32px icon; the grid pitch is always `cell+gap` from
  the control's parameters.
