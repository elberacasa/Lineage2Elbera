# The Interlude UI, reverse-engineered

How the retail client's user interface is actually built, and which file
answers which question. Written for anyone continuing the browser port: if
you are about to hand-author a UI number, read this first — the client almost
certainly states it somewhere.

Companion documents: [xdat-format.md](xdat-format.md) (the layout file, byte
level) and [HANDOFF.md](HANDOFF.md) §5 (project-wide gotchas).

---

## 1. The UI is three layers, not one

Early work treated `Interface.xdat` as *the* UI definition. It is only the
first third.

| Layer | File | Answers | Decoder |
|---|---|---|---|
| **Layout** | `system/Interface.xdat` | what a window *contains* — controls, sizes, textures | `tools/xdat/parse_xdat.py` |
| **Logic** | `system/Interface.u` | how a window *behaves* — 142 classes, one per window | `tools/uscript/extract_uscript.py` |
| **Framework** | `system/NWindow.u` | what a window *can do* — `UIScript` + 28 `UIAPI_*` classes | same |
| **Art** | `systextures/l2ui.utx`, `L2UI_CH3.utx` | the pixels | `umodel` → `tools/ui/build_uiskin.py` |
| **Text** | `L2Font*.utx` + `system/*.gly` | the glyphs | `tools/ui/build_font.py` |

Both `.u` files are `Lineage2Ver111`-encrypted UE2 packages. They decrypt
with the existing `tools/bin/l2encdec -p 111` and parse with the existing
`tools/l2lib` — no new format work was required.

### The find that matters

UE2 `.u` packages store each class's **original source text** in a
`TextBuffer` export, next to the compiled bytecode. So recovering the UI
logic is not disassembly — it is the source NCSoft compiled, Korean comments
included. 142 + 91 classes, ~1.3 MB, recovered in full.

```bash
python3 tools/uscript/extract_uscript.py     # -> assets/uscript/ (gitignored)
```

**Consequence for the port:** every window we build has an authoritative
behavioural reference. `ShortcutWnd.uc` (705 lines) settles how the shortcut
bar pages and rotates; `InventoryWnd.uc` settles what may be dragged where.
Stop guessing; go read the class.

### Gotcha: do not truncate at the first non-ASCII byte

The source is an `FString` ending at a NUL. The comments are Korean
(EUC-KR), so cutting at the first byte ≥ 0x80 — the obvious way to find "the
end of the text" — silently truncates almost every file to a few lines. An
early attempt recovered 180 KB this way instead of 1.2 MB, and the loss looks
plausible enough to miss.

---

## 2. `UIAPI_WINDOW` — the contract every window gets

`NWindow.u` defines the framework. `UIAPI_WINDOW` is the base window class,
and its methods are `native` (implemented in `NWindow.dll` / `Window.dll`),
which means **they apply to every window unconditionally**. Grouped:

| Group | Methods |
|---|---|
| Visibility | `ShowWindow`, `HideWindow`, `IsShowWindow`, `Clear` |
| **Movement** | `Move(dx,dy,secs)`, `MoveTo(x,y)`, `MoveEx(x,y)`, `MoveShake(...)` |
| **Minimise** | `Iconize(control, texture, tooltip)`, `IsMinimizedWindow` |
| Sizing | `SetWindowSize`, `SetWindowSizeRel`, `SetWindowSizeRel43`, `SetFrameSize`, `SetResizeFrameSize`, `GetRect` |
| **Transparency** | `SetAlpha(control, alpha, secs)` — animatable |
| Z-order / focus | `SetAlwaysOnTop`, `SetFocus`, `IsFocused`, `SetTabOrder` |
| Enablement | `EnableWindow`, `DisableWindow`, `IsEnableWindow` |
| Anchoring | `SetAnchor(control, anchorWnd, relativePoint, anchorPoint, dx, dy)`, `ClearAnchor` |
| Tooltips | `SetTooltipType`, `SetTooltipText`, `GetTooltipText` |
| Titles | `SetWindowTitle(index)`, `SetWindowTitleByText(text)` |
| Timers | `SetUITimer(id, delayMs)`, `KillUITimer(id)` |
| Misc | `NotifyAlarm` |

There are 28 sibling classes, one per control type — `UIAPI_BUTTON`,
`UIAPI_TEXTBOX`, `UIAPI_ITEMWINDOW`, `UIAPI_SHORTCUTITEMWINDOW`,
`UIAPI_STATUSBARCTRL`, `UIAPI_MINIMAPCTRL`, `UIAPI_RADAR`, and so on. They
line up almost 1:1 with the 35 control types decoded from the xdat.

### Implications for `editor/world/js/ui/window.js`

Our `L2Window` currently implements **drag + close** and nothing else. To be
a replica it needs, at minimum: **minimise-to-icon**, **per-window alpha**,
**always-on-top / focus and z-order**, **anchors**, and **tooltips**. These
are not per-window features to add later — in retail they are properties of
the window base class, so every window has them for free.

---

## 3. Window movement and layout reset

**Every window is movable.** Movement is native and unconditional; there is
no per-window "draggable" flag to honour. Script-level `SetDraggable` appears
in exactly one class (`EventMatchObserverWnd`, which locks observer panels
during a match) — it is the exception that proves the rule.

**Layout reset is a per-window callback, not a global reposition.** Windows
implement `OnDefaultPosition()`, and the client calls it on each of them when
the player resets the interface. It restores internal state, not just
coordinates:

- `ChatWnd.OnDefaultPosition()` merges the Trade / Party / Clan / Ally tabs
  back into one tab group and re-selects the first
- `ShortcutWnd.OnDefaultPosition()` collapses both expansions, returns to the
  vertical orientation, and resets the page number

So the browser port needs the same shape: an `onDefaultPosition()` hook on
the base window, overridden per window, driven by one global reset command —
not a loop that moves everything to a stored coordinate.

---

## 4. Item drag-and-drop is a separate system

`DragSrcName` is **not** window dragging — it identifies the *source control*
of an item drag. `InventoryWnd.uc` branches on it in `OnDropItem` to decide
what a drop means: reorder within the bag, equip, unequip, or transfer to a
pet, keyed on source names such as `InventoryItem`, `QuestItem`, `EquipItem*`
and `PetInvenWnd`.

This is the specification for the inventory and shortcut-bar work: slot
reordering and equip-by-drag are retail behaviour, not additions.

---

## 5. Open questions

Honest list of what this research did **not** settle.

- **Default window positions.** The xdat gives sizes but no screen
  coordinates. A promising lead — a `-9999` / `-10001` sentinel at tail offset
  `+44`, present in 1,560 of 1,962 records — was tested and **rejected**: no
  top-level window carries a plausible x/y pair there. Position is either in a
  tail slot not yet mapped, or computed natively at runtime.
- **Where moved positions persist.** There is no script-level save/load API,
  so the native layer writes it somewhere not yet located.
- **Default keybindings.** `Option.ini` is stripped in this client copy and
  `Lineage2us.ini` has no `[Engine.Input]` section. Alt+Enter is reported by
  players to reset the interface, consistent with §3, but the binding itself
  is not sourced from a file yet.
- **Anchors in practice.** `SetAnchor` supports named points
  (e.g. `CenterCenter`) but is used in only 13 classes, mostly the teaser
  slideshow. It is a special-case tool, not the general layout mechanism.
- **The xdat type-dependent tail** remains partly undecoded — see
  [xdat-format.md](xdat-format.md).

---

## 6. Method, for the next format

What worked, in order:

1. **Check whether it is even encrypted.** `Interface.xdat` is plaintext; a
   whole class of effort was avoided by looking at the first 128 bytes.
2. **Reuse the existing decoders.** Both `.u` packages fell to
   `l2encdec -p 111` + `l2lib` with zero new code.
3. **Look for source before writing a disassembler.** UE2 keeps script text
   in `TextBuffer` exports.
4. **Anchor on invariants, not offsets.** The xdat parser locks onto three
   literal `"undefined"` strings rather than assuming a fixed record stride,
   which is why it survives records of varying length.
5. **Test the hypothesis and publish the negative.** The `+44` sentinel looked
   convincing and was wrong; recording that is what stops the next person
   spending a day on it.

## 7. Legal

`assets/uscript/` is NCSoft's own source, recovered from a legally obtained
client for interoperability. It is **gitignored and must never be committed**,
like every other extracted asset in this project. Use it as reference to write
original code; do not transcribe it.
