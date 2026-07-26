# xdat `hasSize == 0` tail — decoded

**Status: decoded, implemented in `tools/xdat/parse_xdat.py` (guarded).**
177 of 200 records decode; the three consumer windows (StatusWnd,
TargetStatusWnd, ChatWnd) decode in full. Companion docs:
[ui-mined-values.md](ui-mined-values.md) (the `hasSize == 1` coordinates),
[xdat-format.md](xdat-format.md) (header layout).

---

## 1. The find

The `hasSize == 0` tail does **not** begin with a bitfield — reading it as
aligned int32s was the original mistake. It begins with a **flag byte and two
floats**, and the x/y pair lives 18 bytes later than in `hasSize == 1`
records, as **plain pixel ints** (not 24.8 fixed point):

```
body+0    u8    0                       (flag, always 0)
body+1    f32   f1                      auto-size-to-parent: WIDTH toggle
body+5    f32   f2                      auto-size-to-parent: HEIGHT toggle
body+9    i32   A                       right inset  (used when f1 != 0)
body+13   i32   B                       bottom inset (used when f2 != 0)
body+17   i32   C, D, E                 small enums (1..9), same triple as
                                        hasSize==1's body+0/4/8
body+29   u8    0                       (flag, always 0)
body+30   i32   X                       <-- pixels, parent-relative
body+34   i32   Y                       <-- pixels, parent-relative
body+38   i32   m1, m2                  enum pair, each in {-1, 0, 1}
body+46   i32   0
body+50   str   "undefined"
body+61   i32   -9999                   (the known sentinel)
```

The trailing `-1/-1, 0, "undefined", -9999` block is the same block
`hasSize == 1` records carry at `body+20` (there as 24.8 fixed-point floats
`-1.0, -1.0, 0.0`) — `hasSize == 0` records simply insert an 18-byte
auto-size block (`u8, f32, f32, i32 A, i32 B, u8`) and store x/y as raw
ints.

## 2. Acceptance test (why this is not a guess)

A record decodes only when **every** field of the signature matches: two
zero bytes, both floats in [0,1], C/D/E in 1..9, both enum ints in
{-1,0,1}, a zero int, a literal `"undefined"` string at +50 and `-9999` at
+61. The `"undefined"` + sentinel + three fixed ints alone are the anchor
strength the `hasSize == 1` work relied on (that parser anchors on the same
string triple); the chance of 177 accidental matches is nil.

Structural consistency checks that could not pass by accident:

1. **StatusWnd's four StatusBars stack in order.** x=16 for all four;
   y = **27, 41, 55, 69** (CP→HP→MP→EXP) — constant 14px pitch, last bar
   ends at 69+12=81 inside the 176×84 window.
2. **ChatWnd's five panes share one rect.** NormalChat/PartyChat/ClanChat/
   TradeChat/AllyChat all decode to (0,0) with insets A=-5, B=-46 — tab
   alternates covering 343×141 of the 348×187 window, and 187−46 = 141 is
   exactly where `ChatWndBottomTex` (y=−46, already decoded) begins.
3. **TargetStatusWnd's bars sit under the name.** barHP y=26, barMP y=33
   (7px pitch, inside the 46-tall window); BackTex and BackExpTex share
   (12,0) — the expand-mode alternates, matching `TargetStatusWnd.uc`'s
   documented swap.
4. **StatusWndCenterTex starts exactly where the left band ends**:
   x=28 = 12 (left band x) + 16 (its width), and its insets A=-32, f1=1
   give width 176−32=144: 12+16+144+4 = 176, the window's width.
5. **Regression guards all green**: `parse_xdat.py --check` — 1,786 total
   coords (guard ≥1,600), MenuWnd bands tile exact 173, 177/200 hasSize==0
   records (guard ≥170), bars-stack and panes-tile guards.

## 3. The auto-size rule (f1, f2, A, B)

Evidence points to: **when f1 ≠ 0, width = parent.w + A; when f2 ≠ 0,
height = parent.h + B.** These records are `hasSize == 0` precisely because
their size derives from the parent at layout time.

| record | f1 f2 | A B | derived size | check |
|---|---|---|---|---|
| StatusWnd StatusBars | 1 1 | −26 −72 | 150×12 | 12-tall bars at 14 pitch → 2px gaps ✓ |
| StatusWndCenterTex | 1 1 | −32 0 | 144×84 | bands tile 176 exactly ✓ |
| ChatWnd panes | 1 1 | −5 −46 | 343×141 | ends at the bottom band ✓ |
| ChatWndBodyTex | 1 1 | 0 −82 | 348×105 | — |
| TargetStatusWnd barHP/barMP | 1 **0** | −26 6 | 150×(texture) | f2=0 → height from the gauge texture (~7px = the 7px pitch ✓) |
| UserName (both wnds) | 1 **0** | −33 14 | 143×(font) | f2=0 → height from the font ✓ |

f2=0.0 marks exactly the controls whose height comes from content
(font/gauge texture), which is why their B looks different. This rule sizes
every decoded consumer control; it is documented as *evidence-backed
interpretation*, not emitted into interface.json (x/y only).

## 4. Decoded values for the consumers

### StatusWnd — 176×84

| name | type | x | y | auto-size |
|---|---|---|---|---|
| StatusWndCenterTex | Texture | 28 | 0 | 144×84 |
| CPBar | StatusBar | 16 | 27 | 150×12 |
| HPBar | StatusBar | 16 | 41 | 150×12 |
| MPBar | StatusBar | 16 | 55 | 150×12 |
| EXPBar | StatusBar | 16 | 69 | 150×12 |
| UserName | NameCtrl | 12 | 9 | 143×font |

### TargetStatusWnd — 176×46

| name | type | x | y | auto-size |
|---|---|---|---|---|
| BackTex | Window | 12 | 0 | 164×46 |
| BackExpTex | Window | 12 | 0 | 164×46 (alternate) |
| UserName | NameCtrl | 12 | 9 | 143×font |
| RankName | NameCtrl | 12 | 27 | 143×font |
| barHP | BarCtrl | 16 | 26 | 150×texture |
| barMP | BarCtrl | 16 | 33 | 150×texture |

### ChatWnd — 348×187

| name | type | x | y | auto-size |
|---|---|---|---|---|
| ChatWndBodyTex | Texture | 0 | 18 | 348×105 |
| NormalChat | ChatWindow | 0 | 0 | 343×141 |
| PartyChat | ChatWindow | 0 | 0 | 343×141 (alternate) |
| ClanChat | ChatWindow | 0 | 0 | 343×141 (alternate) |
| TradeChat | ChatWindow | 0 | 0 | 343×141 (alternate) |
| AllyChat | ChatWindow | 0 | 0 | 343×141 (alternate) |

## 5. Undecoded remainder (23 of 200)

- **21 frame/slide records** (`Main_Frame*`, `OutsideFrame*`,
  `Slide_Island*`, ...): at body+29 they carry `0x0F` and the signature
  desyncs — a variant layout with extra fields (likely 9-slice frame
  parameters). Left undecoded rather than guessed.
- **`BackTex2` / `BackTex6`** (EventMatch observer): f1=0.5 then desync.

## 6. Reproduce

```
python3 tools/xdat/parse_xdat.py --check
```

guards: ≥1,600 total coords, MenuWnd tiling exact 173, ≥170 of 200
hasSize==0 records, StatusWnd bars = [27,41,55,69] at x=16, ChatWnd panes
all at (0,0). The decoder is `parse_has0_tail()` in
`tools/xdat/parse_xdat.py`.
