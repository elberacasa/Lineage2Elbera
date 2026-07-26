# Spawn tables — where every NPC comes from, decoded

**Status: research only. No code in this repository was changed to produce
this document.** All analysis ran from throwaway scripts outside the repo.

Companion docs: [npc-visual-data.md](npc-visual-data.md) (how big each NPC is),
[geodata-format.md](geodata-format.md), [tile-map.md](tile-map.md).

---

## 1. Why this matters

Populating towns and hunting grounds correctly is not a matter of asking the
server what is nearby — the client already does that. It matters because
**69% of spawns have no fixed position at all**, and the ~31% that do are exact
to the unit. A port that treats all spawns alike will place town NPCs
approximately and wandering monsters deterministically, which is backwards on
both counts.

---

## 2. Location and shape

`server/.../data/xml/spawnlist/*.xml` — **102 files, named by world tile**
(`16_12.xml`, `20_17.xml`, …), the same `X_Y` grid the client already uses.

**30,137 `<npc>` entries** in total.

```
<territory name="…" minZ="…" maxZ="…">     polygon, in <node x= y=/> vertices
<npcmaker name="…" territory="…" maximumNpcs="N">
    <ai type="…"> <set name= val=/> … </ai>
    <npc id="…" total="…" respawn="…" [pos="x;y;z;heading"] [respawnRand=…]
                [dbName=…] [dbSaving=…]>
        <ai> … </ai>
        <privates> <private id= weight= respawn=/> … </privates>
    </npc>
```

| element | count | attributes |
|---|---|---|
| `node` | 42,528 | `x`, `y` |
| `npc` | 30,137 | `id`, `total`, `respawn`, `respawnRand`, `dbName`, `dbSaving`, `pos` |
| `set` | 29,571 | `name`, `val` |
| `ai` | 17,073 | `type` |
| `npcmaker` | 10,072 | `name`, `territory`, `maximumNpcs`, `event`, `spawnTime`, `ban` |
| `territory` | 9,434 | `name`, `minZ`, `maxZ` |
| `privates` / `private` | 1,124 / 3,159 | `id`, `weight`, `respawn` |

---

## 3. The two spawn modes — the key distinction

| mode | count | share | placement |
|---|---|---|---|
| **Fixed** — `pos="x;y;z;heading"` | 9,286 | **30.8%** | exact, to the world unit |
| **Territory** — no `pos` | 20,851 | **69.2%** | random point inside the polygon, Z between `minZ`/`maxZ` |

**Fixed spawns are reproducible client-side.** Town folk, merchants, guards,
gatekeepers — anything that stands in one place — carries an exact position and
heading. These can be placed offline, at authoring time, and will match retail
exactly.

**Territory spawns are not reproducible and must not be guessed.** The server
picks a random point in the polygon at spawn time. Any client-side attempt to
pre-place them will disagree with the server on every restart. They must come
over the wire (`addNpc`), which the bridge already does.

`heading` follows the convention already established for props: **65536 =
360°**. The distribution corroborates it — the four most common values are
`0`, `32768` (180°), `16384` (90°), `49152` (270°), i.e. the cardinal
directions, out of 993 distinct headings.

### Territory geometry

9,434 territories, each a polygon of `<node x y>` vertices plus a Z band.
Z-band thickness: **min 33, median 200, max 66,065** world units. The median of
200 is a thin slab (a flat field); the extremes are vertical shafts and
multi-level dungeons. Combined with the geodata's multilayer heights
([geodata-format.md](geodata-format.md) §5), the band is what disambiguates
which floor a spawn belongs to.

---

## 4. Respawn timing

`respawn` is a human-readable duration string, not a number:

| format | count |
|---|---|
| `Nsec` | 22,049 |
| `Nhour` | 4,303 |
| `Nmin` | 3,692 |
| `no` | 93 |

`no` means never respawns. `respawnRand` adds jitter. A parser must handle all
four forms — treating the value as an integer silently yields 0.

---

## 5. Minions

**1,124 `<privates>` groups containing 3,159 `<private>` members.** A private
is a minion spawned alongside its parent, with its own `id`, `respawn` and a
`weight` (selection probability within the group). This is how raid bosses get
their escorts.

For the port these arrive as ordinary `addNpc` entities; the structure matters
only if the client ever wants to render a leader/escort relationship.

---

## 6. Spawner AI — 53 distinct types

`<ai type>` on an `npcmaker` selects the spawner's behaviour. The distribution
is heavily skewed:

| type | count | meaning |
|---|---|---|
| `default_maker` | 7,605 | plain respawning spawner |
| `random_spawn_treasurebox` | 909 | treasure chests |
| `maker_instant_spawn_random` | 439 | |
| `random_spawn` | 372 | |
| `event_maker` | 231 | seasonal/event spawns |
| `on_day_night_spawn` | 98 | **day/night dependent** |
| `royal_rush_maker` | 68 | |
| `manage_teleport_dungeon` | 54 | Dimensional Rift rooms |

`on_day_night_spawn` is worth flagging: some NPCs exist only at certain
in-game times, so a "complete" spawn list is time-dependent. `npcmaker` also
carries `event` (2,220), `spawnTime` (333) and `ban` (64) attributes gating
when a spawner is active.

---

## 7. Tile coverage — and a confirmed gap

Spawn files are per tile, so they align directly with the converted scenes:

- converted world tiles: **100**
- spawn tiles: **102**
- spawn tiles that have a converted scene: **98**
- spawn tiles with **no** scene: **`16_12`, `18_10`, `19_10`, `20_10`**

Those four are **exactly** the Seven Signs catacomb tiles listed as outstanding
in HANDOFF §6. Two independent sources agreeing is a useful confirmation that
the world conversion gap is precisely those tiles and nothing else.

Busiest tiles by spawn count: `25_15` (1,609), `19_23` (1,066), `24_16`
(1,031), `25_17` (928), `20_17` (890), `22_13` (763).

---

## 8. Implementation sketch (nothing implemented)

1. **Export the fixed spawns only**, per tile, into something like
   `assets/world/<tile>/spawns.json`: `{npcId, x, y, z, heading}`. These are
   authoritative and static — 9,286 of them.
2. **Do not pre-place territory spawns.** Render them only from `addNpc`.
   Optionally use the territory polygon to pre-warm model loading for the
   npcIds a tile can produce.
3. **Combine with [npc-visual-data.md](npc-visual-data.md)**: each spawn's
   npcId gives mesh + `radius`/`height`, so scale and footprint come from the
   same join.
4. **Verify** by comparing a tile's fixed-spawn set against what the live
   server actually sends on entering that tile. Town tiles are the best test:
   near-100% fixed spawns.

---

## 9. Open questions

- **Which `type` values are Folk vs Monster per spawn.** The spawn file gives
  only npcId; the type lives in the NPC XML (`Folk`, `Monster`, `Merchant`…).
  A join is needed to answer "which of these stand still".
- **`dbName` / `dbSaving`** — some spawns persist state to the database
  (raid boss respawn times). Not traced.
- **`weight` semantics on `<private>`** — presumed a selection probability
  within the minion group; not confirmed against the server code.
- **How `maximumNpcs` interacts with per-`<npc>` `total`.** A maker caps the
  live population; the relationship when the sum of `total` exceeds
  `maximumNpcs` is unverified.
- **Day/night and event gating** — 98 `on_day_night_spawn` makers plus 2,220
  `event` attributes mean the spawn set varies with time and season.

---

## 10. Running list — worth mining later

Accumulated while working through geodata, NPC data and spawns. None of these
have been investigated; recorded so they are not lost.

| # | Target | Why it matters | Where to look |
|---|---|---|---|
| 1 | **Full skill parameter schema** | `hitTime`, `reuseDelay`, `mpConsume`, `castRange`, `effectRange`, `target`, `skillType`, `power` — needed for skills to actually work | `data/xml/skills/*.xml` |
| 2 | **`npcgrp.property_list`** | undecoded ints (e.g. `[4416, 13]`) in an otherwise byte-exact table; may carry render flags | `npcgrp.dat` |
| 3 | **Item stats** — `armorgrp` / `weapongrp` | equipping, paperdoll rendering, weapon meshes | `assets/gamedata/*.json` |
| 4 | **Animation binding** | npcgrp mesh → `.ukx` animation sets; `AnimRate` caveat in HANDOFF §5 | `.ukx`, monster pipeline |
| 5 | **`ItemWindow` cell layout** | retires the last authored UI offsets | `execAddItem@UUIAPI_ITEMWINDOW`, `NWindow.dll` |
| 6 | **`hasSize == 0` xdat tail** | unblocks StatusWnd gauge + TargetStatusWnd offsets | `Interface.xdat` |
| 7 | **Default keybindings** | still entirely unsourced; current binds are ours | `Window.dll`, `assets/uscript/` |
| 8 | **Con-colour sign convention** | table is exact, direction is inference | live test |
| 9 | **Doors and dynamic geodata** | `IGeoObject`, `BlockComplexDynamic` — geodata mutates at runtime | `geoengine/` |
| 10 | **Diagonal movement + `CELL_IGNORE_HEIGHT`** | how tall a ledge is walkable | `GeoEngine.canMove` |
| 11 | **Sound tables** | `npcgrp` carries attack/defense/damage sound sets, unused | `npcgrp.json` |
| 12 | **CJK/Cyrillic fonts** | `-r` variant: 256 glyphs, 2 pages, different record shape | `*.gly` |
| 13 | **Multisell / shop lists** | merchant inventories for NPC dialog windows | `data/xml/multisell` |
| 14 | **`textures_second` selection rule** | usually empty; unknown when populated | `npcgrp.dat` |
