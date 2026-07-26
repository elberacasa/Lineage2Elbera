# The retail UI font as a web bitmap font (ui-font.md)

Source of truth: `tools/ui/build_font.py` (run it with `--check` to verify
without writing). Runtime side: `editor/world/js/ui/font.js`.

## What the client ships

Interlude draws its UI with two bitmap fonts, **SmallFont** and **LargeFont**.
Each font = a glyph sheet texture (in the `L2Font-e` packages, staged from
`assets/library/`) plus a metrics file (`assets/interlude/system/*.gly`).

The `.gly` layout (reverse-engineered in build_font.py, verified against the
actual sheet dimensions):

```
u32 texWidth
u32 texHeight
u32 pages
u32 firstChar
u32 charCount
(u32 x, u32 width, u32 y, u32 height) * charCount
<20 byte trailer>
```

Verification the builder asserts on every run: every glyph box must lie
inside the sheet, and the declared texture size must equal the real PNG size.

## Coverage lives in RGB luminance, NOT in alpha

The gotcha that matters most (also cross-linked from `docs/xdat-format.md`):

**`LargeFont-e`'s background sits at alpha ~34**, not at alpha 0. The sheet
is a clean *intensity map* — black field, white glyphs — so the alpha
channel cannot be trusted for coverage: tinting or masking through alpha
paints a visible box around every glyph. Use the RGB **luminance** as the
glyph mask (the runtime tints the sheet by multiplying a color into it —
`editor/world/js/ui/font.js` `tintedSheet()`). Same trap family as the `_sp`
texture variants in the xdat notes.

## Variants: -e Latin vs -r CJK/Cyrillic

- **`-e` (Latin):** `firstChar=32`, `charCount=95` — printable ASCII on a
  single 1024×128 page. This is what the western client renders with, and
  the only variant the builder handles.
- **`-r` (Cyrillic, 256 glyphs over 2 pages) and the CJK sheets** use a
  different record layout. They are **reported and skipped**, never guessed
  at — wiring them up means extending `parse_gly` for the multi-page layout
  and re-verifying against those sheets.

## What build_font.py outputs

- `editor/world/ui/font/<sheet>.png` — staged glyph sheets (SmallFont-e,
  LargeFont-e).
- `editor/world/ui/font.json` — per font: `sheet`, `texWidth/texHeight`,
  `lineHeight`, `firstChar`, and compact `[x, y, w, h]` glyph boxes in
  code-point order.

`lineHeight` is the tallest glyph box in the font, computed from the
metrics — **13 for SmallFont, 14 for LargeFont** (see font.json). The
runtime uses it for line pitch; it is measured, not chosen.
