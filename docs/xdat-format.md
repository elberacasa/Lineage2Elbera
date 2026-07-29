# Interface.xdat — the client's UI layout, decoded

`assets/interlude/system/Interface.xdat` holds the entire Interlude UI
definition: every window, every control inside it, its size, and the texture
it paints with. It is the ground truth for any claim that the browser client
looks like the retail client.

**It is not encrypted.** Unlike the `.dat` tables (RSA + Lineage2Ver, see
`docs/dat-format-notes.md`), this file is a plain serialized dump of the
client's widget tree. No `l2encdec` pass is needed.

Decoder: `tools/xdat/parse_xdat.py` → `assets/gamedata/interface.json`.
Verify: `python3 tools/xdat/parse_xdat.py --check`.

## Format

```
u32                    window count (140 in the Interlude client)
record*                flat, depth-first stream

record:
  str   type           children only — top-level windows carry no type string
  str   name
  str   "undefined"
  i32 i32
  str   parent         "" for a top-level window
  str   "undefined"
  str   "undefined"
  i32   f0
  i32   f1
  i32   hasSize
  i32 i32              width, height   — PRESENT ONLY when hasSize != 0
  ...                  type-dependent tail (not fully decoded)
  str   stateGroup     "Game", "GamingState", …
  i32   childCount
  record * childCount
```

### Strings

`u8 len` + chars + `NUL`, where **len counts the NUL** (so `len = strlen + 1`).
A lone `0x00` byte is the empty string, with no NUL after it.

Getting this off by one is the single easiest way to lose the whole file: the
header anchor stops matching and the scan returns zero records.

### `hasSize` — the field that looks like corruption

When `hasSize == 0` the width/height pair is **absent**, not zero. The client
computes those sizes at runtime. Read them unconditionally and every record
from that point on is shifted by 8 bytes, which surfaces as plausible-looking
garbage such as `-2147483648` (`0x80000000`) in the width column. Controls
that legitimately do this include `ChatWnd/ChatWndBodyTex` and all five
`ChatWindow` panes.

## How the parser stays honest

The type-dependent tail is not fully reverse-engineered, so the parser does
not guess at it. Instead it anchors on the header shape — three literal
`"undefined"` strings in fixed positions, which no plausible run of int32s
imitates — and treats the bytes from one header to the next as that record's
span. Only fields it actually decoded are emitted.

Current coverage: **1,962 records, 137 of 140 declared top-level windows,
100% byte coverage.** The 3 unmatched windows use a header variant the anchor
does not recognise; they are reported, never invented.

## Dotted references

Strings shaped like `Package.Group.Name` appear throughout the tails. They are
**not all textures**:

- resolves against `assets/library/<Package>/<Name>.png` → a texture reference
- otherwise, if the first component names a record → an intra-UI reference
  (a control pointing at another window, e.g. `ShortcutWnd.ShortcutWndVertical`)

Of 500 distinct dotted references: 431 textures, 69 intra-UI, 0 missing.
Note that umodel flattens texture groups on export, so two references that
differ only in their middle component collapse onto one PNG — 431 references
stage as 393 files. That ambiguity is inherent to the export, not introduced
by the decoder.

## Retail geometry this pins down

Numbers the browser client must match, all read from this file:

| Window | Size | Notes |
|---|---|---|
| `StatusWnd` | 176×84 | left/centre/right strip, CP/HP/MP/EXP bars, level box 22×20 |
| `TargetStatusWnd` | 176×46 | close button, name, pledge crest, HP/MP |
| `ShortcutWnd` | 504×46 | horizontal: **12 slots of 36px**, F-key labels, pages |
| `ShortcutWnd` (vertical) | 46×504 | the rotated variant, same slots |
| `MenuWnd` | 173×46 | four 34×34 buttons: CharInfo, Inventory, Map, SystemMenu |
| `ChatWnd` | 348×187 | head/body/bottom textures, tab control 320×23, edit box 303×16 |

## Gotchas found the hard way

- **The gauge sprites are 8×16 tiles.** Every `ps_*bar` texture is a narrow
  vertical strip the client stretches across the bar. Sizing a gauge to its
  sprite's natural width renders an 8px sliver. Width must come from the
  owning window's geometry.
- **Window chrome is not referenced by the xdat.** `FrameBackLeft/Mid/Right`
  are real L2UI_CH3 art, but the `Frame` control type hardcodes them, so no
  reference appears in the file. `tools/ui/build_uiskin.py` stages them via an
  explicit, documented allowlist (`IMPLICIT`).
- **Font coverage lives in RGB, not alpha.** See `docs/ui-font.md` /
  `tools/ui/build_font.py`: `LargeFont-e`'s background sits at alpha 34, so
  tinting through alpha paints a box around every glyph. Luminance is the
  real coverage — the same class of trap as the `_sp` textures.

## Per-control x/y offsets (24.8 fixed point)

Each record's body begins with three unidentified int32s, then the
**parent-relative coordinates**: `i32` X at `body+12`, `i32` Y at `body+16`,
both **24.8 fixed point** — divide by 256 for pixels. Acceptance test: a pair
decodes only when **both** ints are exactly divisible by 256 (p(false
positive) ≈ 2⁻¹⁶ per record; 1,609 of 1,762 `hasSize == 1` records pass).
Records failing the test emit `x`/`y` = `null` — never guessed. **Negative
values mean far-edge anchoring** (e.g. ChatWnd's input row stays pinned to
the window's bottom edge as it resizes). `hasSize == 0` records carry their
offsets in a bitfield-shaped tail that is still undecoded — full derivation
and remaining unknowns in docs/ui-mined-values.md §4-5.

## Tail fields decoded after the parser (2026-07-28, ClanWnd work)

These were read straight from the binary with the record framing the parser
established; the parser does not emit them yet.

- **Button labels are sysstring ids.** The Button record's tail ends with an
  `i32` that indexes `sysstring-e.dat` — e.g. ClanQuitBtn → 337 'Leave',
  ClanAskJoinBtn → 330 'Invite', ClanTitleManageBtn → 1326 'Edit Crest'.
  Extraction: within one record, the LAST `undefined\x00undefined\x00`
  pair is followed by that dword (records are framed by the
  `F1 D8 FF FF` + type-string header; an in-record `F1 D8 FF FF` also
  precedes the texture list, so naive scans must bound on the NEXT record).
  All 13 ClanWnd buttons decode to semantically exact labels.
- **TextBox static text is inline**, compact-index-prefixed: byte bit7 set
  means that many UTF-16LE chars follow (incl. NUL); clear means that many
  ASCII bytes. ClanWnd's title0..2 store KOREAN text (혈맹명 clan-name,
  혈맹주 clan-master, 본거지 home-base) — NCSoft shipped KR defaults the
  Latin font sheets (chars 32-126) cannot render; title3 stores ASCII
  'LV'. The .uc never rewrites them.
- **ListCtrl columns are an inline schema.** The record carries a schema
  name string (ClanMemberList → "ClanInfo"), then `F1 D8 FF FF`, five
  header dwords (row height is the 4th/5th, both 19 for ClanInfo), a
  column count, then per column: `sysstring id, width, f1, f2, f3`.
  ClanInfo: (50 'Name',127), (537 'Lv',30), (391 'Cls',30), (346 'Status',
  50) — the widths sum to the control's 237px exactly; f3 differs only on
  Lv (1 vs 0), read as the center flag.
