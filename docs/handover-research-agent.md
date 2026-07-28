# Handover — everything the research agent added

One place to see what was contributed, what was found, and where to pick it up.
Written for the agent doing the implementation work.

**Date:** 2026-07-26. **Scope:** retail-UI port foundation + game-data mining.

> Attribution note: `editor/world/js/ui/menuwnd.js` and the C.5 / keymap
> sections of `ui-port-handoff.md` are **yours**, not mine. Everything listed
> below is what I added.

---

## 1. Start here

If you read nothing else, read these two:

- **[research-index.md](research-index.md)** — every mined value, its
  confidence level, and the verification record. Tells you what is safe to
  implement directly and what must not be guessed.
- **[ui-port-handoff.md](ui-port-handoff.md)** — the state of the UI port:
  what is built, what needs improving, the gotchas, the suggested order.

---

## 2. Documents I wrote

### The UI port

| Doc | What it gives you |
|---|---|
| [ui-port-handoff.md](ui-port-handoff.md) | Continue the port from zero context: tools, runtime modules, windows delivered, ranked improvements, gotchas, open questions |
| [ui-reverse-engineering.md](ui-reverse-engineering.md) | How the client's UI is actually built — three layers (layout / logic / framework), the `UIAPI_WINDOW` contract, movement + layout-reset semantics |
| [xdat-format.md](xdat-format.md) | `Interface.xdat` at byte level: record shape, string encoding, the `hasSize` trap |
| [ui-mined-values.md](ui-mined-values.md) | **Exact per-control x/y offsets.** Complete layouts for MenuWnd, MagicSkillWnd, InventoryWnd, ShortcutWnd (6 modes), ChatWnd |

### Game data

| Doc | What it gives you |
|---|---|
| [research-index.md](research-index.md) | Index + verification record + confidence tiers + mining backlog |
| [geodata-format.md](geodata-format.md) | Collision/height/obstacles: full format, validated byte-exact on 3 regions |
| [npc-visual-data.md](npc-visual-data.md) | Mob sizing: where scale lives, the render-scale rule, collision radius |
| [spawn-tables.md](spawn-tables.md) | Spawn schema, fixed vs territory split, respawn formats, minions, AI types. **§10 is the 14-item mining backlog** |

---

## 3. Tools I wrote — all have `--check`

| Tool | Produces |
|---|---|
| `tools/xdat/parse_xdat.py` | `assets/gamedata/interface.json` — 1,962 controls, 137/140 windows, 100% byte coverage |
| `tools/ui/build_uiskin.py` | staged UI sprites + `skin.json` with **measured content rects** |
| `tools/ui/build_font.py` | retail bitmap fonts + metrics |
| `tools/ui/mine_atlas.py` | splits an unreferenced atlas into sprite islands + montage |
| `tools/ui/audit_guesses.py` | **the no-guess gate** — fails if any UI number is unjustified |
| `tools/uscript/extract_uscript.py` | `assets/uscript/` — 142 + 91 UnrealScript classes, ~1.3 MB |
| `tools/dat/export_playerlevels.py` | `playerlevels.json` — level→exp table |
| `tools/dat/export_skilltypes.py` | `skilltypes.json` — ACTIVE/TOGGLE/PASSIVE |
| `tools/dev/seed_test_char.py` | seeds a test character (level, skills, gear) safely |

All outputs are gitignored — NCSoft assets/code, regenerable, never committed.

---

## 4. Client code I wrote

**Runtime** (`editor/world/js/ui/`): `skin.js`, `font.js`, `layout.js`,
`window.js`, `wndmgr.js`, `statuswnd.js`, `skillwnd.js`.

**Windows delivered:** StatusWnd (C.1), MagicSkillWnd (C.3).

**Harnesses:** `verify_ui.js`, `verify_statuswnd.js` (14/14),
`verify_skillwnd.js` (9/9, live server), plus `ui-preview.html`.

**Modified:** `gateway/src/bridge.js` (skillList now forwards `passive` +
`disabled`), `index.html`, `style.css`, `js/combat.js`, `js/hotbar.js`,
`js/main.js`, `.gitignore`, `docs/HANDOFF.md` (pointers only).

> ⚠ `gateway/src/bridge.js` change **extends the frozen contract in
> HANDOFF §4.1** — that section still needs updating.

---

## 5. The findings that change how you build

**1. The UI does not scale with resolution.** Only 2 of 142 window classes use
`SetWindowSizeRel`. Pixel-perfect means `Skin.scale = 1`; anything higher is a
deliberate deviation. → [ui-port-handoff.md](ui-port-handoff.md)

**2. Every sprite export is power-of-two padded.** `icon_back` is 34×34 art in
a 64×64 file; **533 of 583** textured controls are affected. The file size is
not the art size — use the measured content rect. This silently corrupted three
of my own numbers before I caught it.

**3. Per-control x/y IS in the xdat**, at `body+12` in 24.8 fixed point
(÷256). 1,735 records decode; 58,000× more than chance would produce; 17/17
published coordinates re-verified. Negative Y means bottom-anchored.
→ [ui-mined-values.md](ui-mined-values.md)

**4. Window logic is fully recoverable.** UE2 `.u` packages store the original
UnrealScript source. Before building any window, read its class in
`assets/uscript/Interface/`. Movement is native and universal; layout reset is
a per-window `OnDefaultPosition()` callback that restores *state*, not just
position. → [ui-reverse-engineering.md](ui-reverse-engineering.md)

**5. `NWindow.dll` exports 803 native thunks** with mangled names, so any
native constant is reachable by name → address → disassembly. Already used to
extract the target con-colour table. → [ui-port-handoff.md](ui-port-handoff.md) §6

**6. The client has no obstacle model at all.** 139 geodata regions are
installed and unused. Height is a function of **(x, y, z)** — a lookup without
the character's current Z picks the wrong floor in every multi-level structure.
→ [geodata-format.md](geodata-format.md)

**7. 32% of NPC meshes are reused at different sizes.** `death_blader_m00` is
shared by 34 npcIds from height 40.5 to 141.0. Render every mesh at native size
and bosses come out the size of the trash mob they were modelled from.
`renderScale = (2 × height) / mesh.nativeHeight`, applied **per npcId**.
→ [npc-visual-data.md](npc-visual-data.md)

**8. 69% of spawns have no fixed position.** The ~31% that are fixed can be
placed offline and will match retail exactly; territory spawns are randomised
server-side and must only come from `addNpc`.
→ [spawn-tables.md](spawn-tables.md)

**9. Skill classification is real data, not guesswork.** `SkillList` (0x58)
carries `passive` + `disabled` per skill; `operateType` in the server XML gives
ACTIVE 1820 / TOGGLE 32 / PASSIVE 802. Retail's skill window has exactly two
panes — passive separated, toggles with actives.

---

## 6. The rule I worked to

> Never author a value when a lower-numbered evidence tier can state it.

| Tier | Source |
|---|---|
| 1 | client data (`Interface.xdat`, `*.gly`, `*.dat`) |
| 2 | client code (recovered UnrealScript) |
| 3 | the art itself (measured content rects) |
| 4 | server data + live protocol |
| 5 | native DLLs |
| 6 | empirical capture (last resort) |

Enforced by `python3 tools/ui/audit_guesses.py --check`. Markers: `SOURCED`
(tier 2), `MEASURED` (tier 3), `AUTHORED` (ours, with a reason), `DEVIATION`.
It was at **15 literals / 0 unjustified** when I handed over — please keep it
at 0.

---

## 7. Where I'd pick it up

1. **Window body background** — `L2Window` is a titlebar over transparency.
   Fixing it improves every window at once. Art evidence in
   [ui-port-handoff.md](ui-port-handoff.md) §2.1.
2. **Apply the mined offsets** — three `AUTHORED` constants in your code have
   known real values ([ui-mined-values.md](ui-mined-values.md) §2), and
   InventoryWnd + ShortcutWnd have complete layouts ready to build from.
3. **ShortcutWnd** — collapses the two invented bars into the real 12-slot bar.
4. **Skill parameter schema** — backlog item #1; what "skills must work
   perfectly" actually needs.

---

## 8. Honest caveats

- **Two errors in my first drafts**, found in review and corrected: geodata
  region count (142 → **139**) and `MAX_LAYERS` (125 → **127**). Both logged in
  [research-index.md](research-index.md) §3.
- **The render-scale rule is partly empirical.** The doubling is sourced from
  server code; whether each *mesh* was authored at exactly 2× its cylinder is
  not — 80% fall within 1.9–2.1. Verify visually before trusting it across the
  bestiary.
- **Do not guess these:** `hasSize == 0` records (200 of them) hide their x/y
  elsewhere; the shortcut slot pitch is runtime-generated; whether x/y is
  parent- or window-relative is unconfirmed (a uniform 12px offset may exist);
  the con-colour sign convention is inferred.
- **Keybindings I introduced are mine, not retail** — F9, K, I, C were
  unsourced when I added them. (F9 was later freed for retail shortcut
  slot 9; the dev bar moved to Backquote, also unsourced.)

Full confidence breakdown: [research-index.md](research-index.md) §4.
