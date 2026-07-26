# Geodata — collision, height and obstacles, decoded

**Status: research only. No code in this repository was changed to produce
this document.** All analysis ran from throwaway scripts outside the repo.

Companion docs: [ui-mined-values.md](ui-mined-values.md),
[ui-port-handoff.md](ui-port-handoff.md), [tile-map.md](tile-map.md).

---

## 1. Why this matters

The browser client currently derives ground height from the converted terrain
heightmap and clamps it with the server's Z (`max(terrainHeight, serverZ)` —
see HANDOFF §5 "Indoor z is geodata z"). That means the client has **no model
of obstacles at all**: no walls, no walkable-edge rules, no multi-level floors,
no bridges-over-ground.

Everything the server knows about where you may stand and walk lives in
`server/.../data/geodata/*_conv.dat` — **139 regions installed** (the directory holds 142 entries; 3 are notes/an image, not data). This matches the figure already recorded in HANDOFF §1. Until the
client reads the same data it cannot be a replica: it will let you walk through
walls the server rejects, and disagree about the floor whenever geometry
stacks.

This document specifies that format completely, validated byte-exact.

---

## 2. Verification

The parser derived below was run against three installed regions and
**consumed every file to the exact byte, with the expected 65,536 blocks each**:

| region | file size | consumed | blocks (flat / complex / multilayer) |
|---|---|---|---|
| `16_11_conv.dat` | 1,986,306 | 1,986,306 ✓ | 57,865 / 4,493 / 3,178 |
| `22_22_conv.dat` | 5,964,848 | 5,964,848 ✓ | 26,699 / 34,495 / 4,342 |
| `17_25_conv.dat` | 2,705,152 | 2,705,152 ✓ | 51,018 / 11,453 / 3,065 |

Exact-consumption is the acceptance test: any misread field desynchronises the
stream and the block count or the final offset will not land.

---

## 3. Constants

From the server's own definitions (`GeoStructure`, `World`):

| constant | value | meaning |
|---|---|---|
| `CELL_SIZE` | **16** | world units per geodata cell (X/Y) |
| `CELL_HEIGHT` | **8** | world units per height step |
| `CELL_IGNORE_HEIGHT` | 48 | `CELL_HEIGHT * 6` |
| `BLOCK_CELLS_X/Y` | 8 × 8 | = 64 cells per block |
| `REGION_BLOCKS_X/Y` | 256 × 256 | = 65,536 blocks per region |
| region span | **2048 cells = 32,768 units** | equals `TILE_SIZE` |
| `TILE_X_MIN..MAX` | 16 … 26 | |
| `TILE_Y_MIN..MAX` | 10 … 25 | |
| `WORLD_X_MIN` | `(16-20) * 32768` = −131,072 | |
| `WORLD_Y_MIN` | `(10-18) * 32768` = −262,144 | |

**Cross-check:** a region spans exactly one 32,768-unit tile, and
`WORLD_X_MIN`/`WORLD_Y_MIN` reproduce the client's existing `tileNameFor()`
formula (`20 + x/32768`, `18 + y/32768`). The geodata grid and the converted
world tiles are the same coordinate system — no extra alignment step needed.

### Coordinate transforms

```
geoX  = (worldX - WORLD_X_MIN) >> 4          # floor divide by CELL_SIZE
geoY  = (worldY - WORLD_Y_MIN) >> 4
worldX = (geoX << 4) + WORLD_X_MIN + 8       # +8 = centre of the cell
worldY = (geoY << 4) + WORLD_Y_MIN + 8
```

Note the `+ 8` on the way back: a cell's world position is its **centre**, not
its corner. Getting this wrong offsets everything by half a cell (8 units).

---

## 4. File format — L2OFF (`*_conv.dat`)

Two geodata flavours exist. The installed files are the **L2OFF** variant
(`%d_%d_conv.dat`); the other is L2J (`%d_%d.l2j`) and differs in field widths.
Everything below is L2OFF. **All integers little-endian.**

```
header      18 bytes, skipped
block[256][256]        iterated X outer, Y inner
```

Each block begins with an **int16 type**:

| type | meaning | payload |
|---|---|---|
| `0` | FLAT | `int16 height`, then `int16` skipped (4 bytes total) |
| `0x40` | COMPLEX | 64 × `int16` cell (128 bytes) — one per cell, row-major 8×8 |
| anything else | MULTILAYER | per cell: `int16 layerCount`, then `layerCount × int16` |

A FLAT block is one height for all 64 cells and is **fully walkable in every
direction** (`nswe = 0x0F`). Its second int16 is read and discarded.

Multilayer layer counts observed: 1–5 across the sampled regions. The server
accepts **1..127** (`MAX_LAYERS = Byte.MAX_VALUE`) and rejects anything outside
that range.

### Cell encoding — the 16-bit word

Both COMPLEX and MULTILAYER cells use the same packed word:

```
nswe   =  data & 0x000F                      # low nibble: walkable directions
height = (int16)(data & 0xFFF0) >> 1         # signed, arithmetic shift
```

The height mask keeps the top 12 bits, then an **arithmetic** shift right by 1
preserves sign. Use a signed 16-bit interpretation before shifting or negative
heights (below sea level, dungeons) come out wrong.

### NSWE — direction flags

| bit | value | direction |
|---|---|---|
| 0 | `0x01` | **E**ast |
| 1 | `0x02` | **W**est |
| 2 | `0x04` | **S**outh |
| 3 | `0x08` | **N**orth |
| — | `0x0F` | all (fully open) |
| — | `0x00` | fully blocked |

A set bit means movement **out of this cell in that direction is allowed**.
This is a per-cell exit mask, not a wall description — a wall appears as cells
whose facing bits are cleared on both sides.

---

## 5. Height selection

For COMPLEX blocks there is exactly one height per cell.

For MULTILAYER, a cell has several stacked surfaces (a bridge over a road, the
floors of a tower). The server picks by **nearest height to the query Z**:
iterate the cell's layers, compute `abs(layerHeight - worldZ)`, take the
minimum. That is `getHeightNearest(geoX, geoY, worldZ)`.

The consequence for the port: **height is a function of (x, y, z)**, not just
(x, y). A client that looks up ground height without passing the character's
current Z will pick the wrong floor in every multi-level structure.

FLAT blocks return their single height regardless of Z.

---

## 6. What the client should do

Suggested shape for the implementer — **not implemented, no code was written**:

1. **Convert per tile, offline.** For each of the 100 converted world tiles,
   emit a companion geodata payload beside `scene.json`. Reuse the existing
   asset conventions (gitignored, regenerable).
2. **Do not ship raw regions.** A full region is 2–6 MB and covers 2048×2048
   cells. For a browser, consider: (a) flatten FLAT/COMPLEX into a single
   height+nswe raster (2048×2048×3 bytes ≈ 12 MB raw, but compresses hard and
   most blocks are FLAT), or (b) keep the block structure and stream 8×8 blocks
   on demand. Measure before choosing.
3. **Replace `heightAtWorld(x, z)` with `heightAt(x, z, currentY)`** so
   multilayer resolves correctly — this is the single most important change.
4. **Gate movement on NSWE** before sending `moveTo`, so the client stops at
   walls instead of being silently corrected by the server. The server remains
   authoritative; this only removes the rubber-banding.
5. **Verify** by sampling: for N random points in a tile, the client's
   computed height must equal the server's. The server can be queried through
   the existing admin/GM path, or compared offline against this parser.

---

## 7. Reproducing the parse

Pseudocode; the validated implementation lived in a scratch script.

```
open region file, little-endian
skip 18 bytes
for ix in 0..255:            # X outer
  for iy in 0..255:          # Y inner
    type = int16
    if type == 0:            # FLAT
       height = int16; skip int16
    elif type == 0x40:       # COMPLEX
       cells = 64 x int16
    else:                    # MULTILAYER
       for cell in 0..63:
          n = int16                       # 1..127 (MAX_LAYERS)
          layers = n x int16
assert offset == filesize    # the acceptance test
```

Per cell word: `nswe = w & 0x0F`, `height = int16(w & 0xFFF0) >> 1`.

---

## 8. Open questions

- **Which regions map to which converted tiles.** 142 geodata regions are
  installed; the client has 100 converted tiles. The naming is the same
  `X_Y` grid, so the intersection should be direct, but it has not been
  enumerated here.
- **Diagonal movement.** NSWE encodes four cardinal exits. How the server
  treats diagonal steps (both component bits required, or something else) is in
  `canMove`'s stepping loop and was not fully traced.
- **`CELL_IGNORE_HEIGHT` (48)** — a tolerance used when deciding whether a
  height difference blocks movement (steps vs walls). The exact rule was not
  traced; it governs how tall a ledge you can walk up.
- **Doors and dynamic geometry.** `IGeoObject`, `BlockComplexDynamic` and
  `BlockMultilayerDynamic` exist — geodata is mutated at runtime for doors and
  similar. A static client-side copy will disagree while a door is open.

---

## 9. Next mining targets (read-only, ranked)

Beyond geodata, for full-world fidelity:

1. **NPC visual data** — `npcgrp.dat` carries mesh, texture set and **scale**
   per npcId; aCis npc XMLs carry `collision_radius` / `collision_height`.
   Together these settle "mob skins and positioning". The project already
   decodes `npcgrp.json`; the scale/collision fields specifically have not been
   documented.
2. **Spawn tables** — exact spawn coordinates, heading and respawn delay from
   the aCis spawn XMLs, so populated towns match.
3. **Full skill parameter schema** — `hitTime`, `reuseDelay`, `mpConsume`,
   `castRange`, `effectRange`, `target`, `skillType`, `power`, plus the
   `operateType` / `weaponsAllowed` already documented. This is what "skills
   must work perfectly" needs.
4. **Animation binding** — how npcgrp mesh names map to `.ukx` animation sets,
   and the `AnimRate` caveat already noted in HANDOFF §5.
5. **Item stats** — `armorgrp` / `weapongrp` fields for equipping and paperdoll
   rendering.
