# Research index — mined game data, reviewed

Index and verification record for the read-only mining work. **No code in this
repository was changed to produce any of it**; every document below is a set of
values for an implementer to consume.

Reviewed and re-verified **2026-07-26**. Two errors were found in the original
drafts and corrected — see §3.

---

## 1. The documents

| Document | Subject | Headline finding |
|---|---|---|
| [ui-mined-values.md](ui-mined-values.md) | per-control x/y offsets from `Interface.xdat` | coordinates **are** in the file, at `body+12` in 24.8 fixed point |
| [geodata-format.md](geodata-format.md) | collision, height, obstacles | format fully specified, parser validated byte-exact |
| [npc-visual-data.md](npc-visual-data.md) | mob size, scale, collision | 32% of meshes reused at different sizes; `height` is a **half**-height |
| [spawn-tables.md](spawn-tables.md) | where NPCs come from | **69% of spawns have no fixed position** |

Supporting docs from the earlier build work:
[ui-port-handoff.md](ui-port-handoff.md) · [ui-reverse-engineering.md](ui-reverse-engineering.md) ·
[xdat-format.md](xdat-format.md)

---

## 2. Verification record

Every published numeric claim was re-derived in a separate pass. Results:

| Claim | Verified |
|---|---|
| aCis NPCs / with radius+height | 6,496 / 6,496 ✓ |
| npc XML files | 16 ✓ |
| npcgrp records | 6,519 ✓ |
| spawn tile files | 102 ✓ |
| `<npc>` spawn entries | 30,137 ✓ |
| fixed-position spawns | 9,286 ✓ |
| territory spawns | 20,851 ✓ |
| skills typed (ACTIVE/TOGGLE/PASSIVE) | 2,654 (1820/32/802) ✓ |
| xdat top-level windows | 137 ✓ |
| xdat texture refs resolved | 431 ✓ |
| geodata regions | **139** — corrected, see §3 |
| every published x/y coordinate | **17 / 17** ✓ |
| geodata parse to exact EOF | 3 / 3 regions ✓ |

### Strength of the x/y decode

The acceptance test (both int32s divisible by 256) is not a soft heuristic:

- chance probability of a false positive: `(1/256)² = 1/65,536`
- expected accidental hits across 1,962 records: **≈ 0.03**
- actual hits at `body+12`: **1,735**
- ratio: **≈ 58,000× chance**

Combined with four independent structural checks (MenuWnd's bands tiling to
exactly 173; its buttons at a constant 37px pitch; `189×23 at x=12` appearing
in two unrelated windows; TargetStatusWnd's pledge rows landing outside the
collapsed window exactly where expand mode puts them), the decode is sound.

---

## 3. Errors found in review — and fixed

Recorded rather than quietly patched, because the next reader should know the
drafts were not right first time.

**1. Geodata region count: 142 → 139.**
The original figure came from `ls | wc -l`, which counted three non-data files
(a readme, a bug list, an image) alongside the `.dat` regions. It also
contradicted the 139 already recorded in HANDOFF §1 — a conflict I should have
caught at the time. *Corrected in `geodata-format.md`.*

**2. Geodata `MAX_LAYERS`: 125 → 127.**
Stated as 125 in both the prose and the pseudocode. The server defines
`MAX_LAYERS = Byte.MAX_VALUE`, which is **127**. Real data tops out at 5
layers, so no parse would have failed — the error would have sat there
undetected until a file used 126. *Corrected in `geodata-format.md`.*

### One claim upgraded

**NPC height as a half-height: inference → sourced.** The 2× rule was
originally published as an empirical correlation (median exactly 2.00 across
1,711 npcIds) with an explicit caveat that it was not read from a definition.
Review found the server's own code doubles it — `2 * getCollisionHeight()` in
`GeoEngine` line-of-sight and in `AdminGeoEngine`. The claim is now sourced,
and the corresponding open question is closed. *Updated in
`npc-visual-data.md`.*

---

## 4. Confidence levels

Not everything mined is equally certain. Read this before implementing.

### Solid — implement directly

- **Geodata format** — parser consumes 3 regions to the exact byte; constants
  read from server source
- **NSWE flags, cell encoding, coordinate transforms** — from server definitions
- **NPC `radius`/`height`** — 100% coverage, read from XML
- **`height` is a half-height** — server code doubles it
- **Spawn schema, fixed/territory split, respawn formats** — counted directly
- **x/y at `body+12`** — 58,000× chance, 17/17 re-verified
- **Skill types ACTIVE/TOGGLE/PASSIVE** — from server XML, spot-checked against
  known toggles (Fake Death, Silent Move, Fist Fury, Relax)

### Derived — sound, but verify visually

- **`renderScale = (2 × height) / mesh.nativeHeight`.** The doubling is
  sourced; what remains empirical is whether each *mesh* was authored at
  exactly 2× its cylinder. 80% fall within 1.9–2.1; the 20% spread is authoring
  variance. Check a few known monsters before trusting it across the bestiary.
- **Negative Y = bottom-anchored.** Strongly implied by `ChatWnd`'s values and
  consistent with `SetAnchor` existing, but not read from a definition.

### Unresolved — do not guess

- **`hasSize == 0` records (200)** carry x/y somewhere not yet found
- **Shortcut slot pitch** — only slot 1 is declared; the rest are runtime
- **Whether x/y are parent- or window-relative.** Both `StatusWndLeftTex` and
  `MenuWndBackTexLeft` start at x=12 rather than 0, so a uniform 12px offset
  may exist that no single window can distinguish from a real coordinate
- **Diagonal movement and `CELL_IGNORE_HEIGHT`** (step-vs-wall tolerance)
- **Con-colour sign convention** — table exact, direction inferred

---

## 5. Cross-validations worth knowing

Independent sources agreeing, which is the strongest evidence available:

1. **Geodata ↔ world tiles.** A geodata region spans 256 blocks × 8 cells × 16
   units = **32,768 units** = `TILE_SIZE`, and `WORLD_X_MIN = (16-20) × 32768`
   reproduces the client's existing `tileNameFor()` formula. Same coordinate
   system, no alignment step.
2. **Spawn tiles ↔ converted scenes.** 98 of 102 spawn tiles have a scene; the
   four that don't (`16_12`, `18_10`, `19_10`, `20_10`) are **exactly** the
   Seven Signs catacomb tiles listed as outstanding in HANDOFF §6.
3. **Heading convention.** The four most common spawn headings are `0`,
   `32768`, `16384`, `49152` — the cardinals under 65536 = 360°, matching the
   prop rotator convention already documented.
4. **Tab geometry.** `189×23 at x=12` in both `MagicSkillWnd` and
   `InventoryWnd`.

---

## 6. Mining backlog

Maintained in [spawn-tables.md](spawn-tables.md) §10 — 14 items with why each
matters and where to look. Top of the list:

1. **Full skill parameter schema** (`hitTime`, `reuseDelay`, `mpConsume`,
   `castRange`, `effectRange`, `target`, `skillType`, `power`) — what "skills
   must work perfectly" actually requires
2. **`hasSize == 0` xdat tail** — unblocks StatusWnd gauge and TargetStatusWnd
   offsets
3. **`execAddItem@UUIAPI_ITEMWINDOW`** in `NWindow.dll` — the ItemWindow cell
   pitch, settling both the shortcut bar and the item grids
4. **`npcgrp.property_list`** — undecoded ints in an otherwise byte-exact table

---

## 7. Method

The rule that produced this work, and that should govern what follows:

> Never author a value when a lower-numbered evidence tier can state it.

| Tier | Source | Reached? |
|---|---|---|
| 1 | client data (`Interface.xdat`, `*.gly`, `*.dat`) | yes |
| 2 | client code (`Interface.u`, `NWindow.u` UnrealScript) | yes |
| 3 | the art itself (measured content rects) | yes |
| 4 | server data + live protocol (aCis XML, packets) | yes |
| 5 | native DLLs (`NWindow.dll`, `Window.dll`) | yes — 803 exported thunks |
| 6 | empirical (retail capture) | not needed so far |

Two habits that paid off and should continue:

- **Publish negative results.** The rejected `+44` sentinel hypothesis is
  recorded in `ui-port-handoff.md` §5 so nobody re-derives a dead end — even
  though the conclusion drawn from it ("x/y unavailable") later turned out to
  be wrong, which is itself recorded in `ui-mined-values.md` §1.
- **Make every claim carry its acceptance test.** Byte-exact consumption for
  binary formats; a falsifiable structural check for inferred layout; a stated
  probability for statistical claims.
