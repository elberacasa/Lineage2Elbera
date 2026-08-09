# Overnight session report — 2026-08-08 → 09

Twelve commits, `a53aab3` → `421d0f5` (+ one wave still landing). Everything
below was measured, not asserted; where something could not be sourced it is
listed as a gap rather than filled in.

---

## The headline: three foundation bugs

These were not cosmetic. Each had been silently wrong for a long time, and each
was found by measuring rather than by reading code.

### 1. The geodata cell index was transposed — 148 million cells

Reading a cell inside an 8×8 geodata block used `(y × 8) + x`. The real order is
X outer, Y inner (sourced from aCis `BlockComplex`/`BlockMultilayer`).

**148,671,974 of 419,430,400 cells — 35.4% of the world, 74% of all non-flat
cells — returned a different height than the server.** Nearly a million were off
by 512 units or more. 5.7 million had the wrong *layer count*, so multi-storey
areas read as single-storey.

It survived because **flat blocks are immune** — all 64 cells share one height.
Open ground always looked perfect; only towns broke. Every casual check anyone
ever ran happened to be somewhere flat.

Confirmed against the live server: on the Giran plaza the old index matched 6 of
26 probes with a 128-unit sawtooth across exactly one block — the transpose's own
signature. After: 26 of 26.

### 2. The extractor never read 6,782 prop placements

`convert.py` located each actor's property list by *scanning* offsets and scoring
candidates. A scan that re-syncs deeper into an actor body can parse cleanly, end
in exactly the right place, and carry *more* fields than the real list while
missing the one naming the mesh — so the score preferred it.

**157,171 → 163,953 placements.** Among the dropped: `Giran_V_Plaza_Stair01` —
the staircase in the plaza. It was never in the data. Two whole actor classes
(castle and clan-hall doors) had never been read at all.

The header length was never a mystery; it is derivable, and the derivation now
checks out on all 162,805 actors across 100 tiles.

### 3. The gateway dropped `MoveToPawn`, so out-of-range attacks vanished

"Ghost NPCs" that accepted targeting and swallowed every attack were simply mobs
**out of physical attack range**. aCis handles that by quietly walking you toward
the target — sending `MoveToPawn` and *nothing else*: no error, no message. The
gateway had no case for that opcode, so the reply was discarded.

**Ghost rate 0.941 → 0.0.** Four more combat packets rode the same hole, one
causing an independent second silence (the client kept drawing a target the
server had dropped, so the next swing was consumed as a re-target).

---

## Everything else that landed

| Area | What changed |
|---|---|
| **Stairs / walk surface** | Prop tops now rasterised at 16-unit pitch (geodata's own cell size, so the walkability test is provably the same test). Off-surface points **690 → 145**; props **595 → 63**. Pavement proven unregressed byte-for-byte. |
| **Click marker** | Raycast now includes BSP. Was landing up to 380 units past the click and 105 units *below* the pavement; now 0/7 off-slab. |
| **BSP lightmaps** | Format decoded to the byte on 99/100 tiles. 45,006 records, 907 atlas pages, **68.3% of surfaces lit**. Retail lights BSP *only* from the bake (12 exceptions in 146,550 nodes), so dynamic lighting is gone from BSP. |
| **Font** | The large UI font had **no outline at all** — coverage was read from the wrong channel, discarding 73% of the outline mass. |
| **Footsteps** | There were *none*, ever. 94 sounds extracted a year ago, never referenced. Now driven by the real `AnimNotify` keyframes (1,367/1,367 sequences located), not a timer. |
| **UI colours** | Decoded from `NWindow.dll`: the con-colour ladder (7 colours + 6 thresholds), button label colours, the item badge. The `#c9a959` gold used in 45 places is a colour **retail never uses**. Seven of eight HTML colour names in NPC dialogs **do not exist**. |
| **Emotes** | All twelve played the dance clip — one argument was never passed. Clips were already on disk. |
| **Skill casts** | 235 monsters answered a cast with a pose motionless to three decimal places. Real strike clips existed in 271 animation sets and shipped in zero models. |
| **Movement** | ~9% permanent slowdown fixed (a multiplier was parsed and discarded); walk/run is a state, not a distance guess; teleports jump instead of walking. |
| **Soulshots** | The whole shortcut bar was being **deleted on every relog** — save/load formats disagreed. |
| **Name labels** | Were world-space sprites that grew as you approached. Retail cannot scale them — proven from the export signature, which carries no size term. |
| **Battery** | First trustworthy full run ever: **93/113, no stalls**. Every hang now becomes a bounded failure instead of swallowing the run. |
| **Unsourced literals** | **2,228 → 1,866**, with the UI/audio lane at **zero**. |

---

## Two findings that bound future work

- **`Engine.dll` is Themida-packed.** Zero disassemblable instructions in the
  entire file; all 10,083 exports resolve into a stub. Export *names* remain
  valid evidence, but its code is permanently unreadable. `NWindow.dll` and
  `D3DDrv.dll` are readable and have been mined successfully.
- **A test can be red because the product got more correct.** `verify_skillanim`
  failed only because invented placeholder effects had been deleted as unsourced.
  Always establish whether the suite or the product is wrong.

---

## What is still missing

**Known gaps, documented rather than guessed:**

1. **53 extracted `.unr` tiles were never converted** — including all four
   south/east neighbours of the spawn town (#39). Likely the root of cross-tile
   issues; the biggest single item on this list.
2. **1,866 unsourced literals remain** (#22), 428 in the client. Ranked worklist
   in `editor/world/audit_report/unsourced.md`.
3. **Load-time profile still unanswered** (#25) — three attempts, no numbers yet.
   Suspects: +6,782 props, walk raster (~126 MiB), lightmap atlases (~35 MB), and
   dev servers speaking HTTP/1.0 so every asset costs a new TCP connection (#17).
4. **Sky is one layer deep** (#30) — the background colour is decoded; cloud,
   starfield, sun/moon and lens-flare layers are not.
5. **20 battery suites failing** as of the last full run; nine live-suite failures
   share one harness cause (no stable device id → new account each run → hang at
   character creation) (#36).
6. **Grass vs land footsteps undecoded** — the grass bank is extracted and sits
   unused rather than wired to a guess.
7. **`VOLUME_SCALE`** is the one genuinely open audio constant.
8. **`ClanWnd` column headers** keep a colour retail never uses; the value comes
   from an instance field that could not be traced.
9. **Tile 21_14 lightmaps** and **record field `Q`** — see #33/#34 resolution.
10. **Nameplate font selector and Alt gate** are unrecoverable (Themida), and are
    marked authored rather than dressed up as decoded.

**Longstanding, untouched:** 13 VertMesh + 11 Beam emitters, NPC titles
unrendered, `heart_of_warding` (cannot be built from the data).
