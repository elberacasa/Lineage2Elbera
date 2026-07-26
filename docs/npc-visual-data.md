# NPC visual data — size, scale and collision, decoded

**Status: research only. No code in this repository was changed to produce
this document.** All analysis ran from throwaway scripts outside the repo.

Companion docs: [geodata-format.md](geodata-format.md),
[monster-pipeline.md](monster-pipeline.md), [ui-mined-values.md](ui-mined-values.md).

---

## 1. The headline finding

**The same mesh is reused by many npcIds at different sizes, and the only
record of how big each one should be is the server's collision height.**

`death_blader_m00` is shared by **34 npcIds** whose collision heights run from
**40.5 to 141.0** — a 3.5× visual range. `drop_gourd_m00` is shared by 12
npcIds from 10.5 to 40.0. Across the board, **173 of 548 meshes (32%) are
reused with differing heights**.

A client that renders every mesh at its native size therefore draws a large
share of the bestiary at the wrong size — and draws bosses at the size of the
trash mob they were modelled from. This is not a subtle inaccuracy; for the
worst cases it is a 3× error.

---

## 2. Where NPC size is NOT stored

`npcgrp.dat` — the client's own NPC table, 6,519 records — carries the visual
identity but **no body scale and no collision volume**:

| field | content |
|---|---|
| `class_name`, `mesh_name` | e.g. `LineageMonsters.gremlin_m00` |
| `textures`, `textures_second` | texture sets |
| `npc_speed` | movement speed multiplier |
| `attack_sound`, `defense_sound`, `damage_sound` | sound sets |
| `deco_effect` | decorative effects, each with **its own** `scale` |
| `attack_effect`, `sound_vol`, `sound_radius`, `sound_random` | |
| `property_list`, `quest_be`, `class_lim`, 3 unknown fields | |

The existing parser (`tools/dat/extract_gamedata.py`) asserts exact byte
consumption, so the format is fully accounted for — the absence is real, not a
parser gap. **The `scale` that appears in `deco_effect` belongs to the effect,
not the NPC body; do not use it for the model.**

---

## 3. Where NPC size IS stored

The server's NPC definitions: `server/.../data/xml/npcs/*.xml` (16 files).

**6,496 NPCs, 100% of them carry both `radius` and `height`.**

```xml
<npc id="12077" name="Wolf" …>
  <set name="radius" val="13.0"/>
  <set name="height" val="11.5"/>
  <set name="level"  val="15"/>
  <set name="type"   val="Pet"/>
  …
```

| field | range | distinct values |
|---|---|---|
| `radius` | 0.0 … 300.0 | 86 |
| `height` | 0.0 … 335.0 | 246 |

NPC types present: Monster 2,655 · Folk 1,015 · Servitor 764 · SiegeGuard 305 ·
RaidBoss 213 · Trainer 181 · Merchant 174 · Guard 157 · (others).

These are the collision cylinder — the server uses them for hit detection,
targeting and pathing — and they are the authoritative statement of how large
each NPC is in the world.

---

## 4. The scale rule

Comparing each built glTF's `nativeHeight` (from
`editor/characters/monsters/manifest.json`) against the server's `height`, over
the **1,711 npcIds** that map to one of the 83 built meshes:

```
meshNativeHeight / serverHeight   min 0.30   max 2.95   median 2.00   stdev 0.25
```

Histogram peak is **exactly 2.0**, and **80% (1,364 / 1,711) fall within
1.9–2.1**. So:

> **`serverHeight` is a HALF-height. Visual height = 2 × `height`.**

**This is confirmed by the server's own code, not merely by the distribution.**
aCis computes `2 * getCollisionHeight()` wherever it needs a creature's full
height — in `GeoEngine` line-of-sight (`creature.getCollisionHeight() * 2 *
Config.PART_OF_CHARACTER_HEIGHT / 100`) and in `AdminGeoEngine`
(`(int) (2 * player.getCollisionHeight())`). The empirical median of exactly
2.00 and the server's own doubling agree.

Which gives the render rule:

```
renderScale = (2 * npc.height) / mesh.nativeHeight
```

Apply per **npcId**, not per mesh — that is what makes the reused-mesh bosses
come out right.

### The 20% that don't fit

Honest caveat: one fifth sit outside 1.9–2.1, and they split into two kinds:

- **Ratio 2.6–2.95** (dryad, wererat, werewolf …) — meshes taller than 2× their
  cylinder. Plausibly deliberate: ears, wings and headgear extend past the
  collision volume. Using the rule still sizes the *body* correctly.
- **Ratio 0.30–0.63** (pixy, pig_ball …) — these are the **scaled-up reuses**:
  a boss whose cylinder is far larger than the base mesh. These are exactly the
  cases the rule is needed for; the low ratio is the signal, not an error.

The rule is sound in both directions, and the doubling itself is sourced from
server code (above). What remains empirical is only the *mesh* side: whether
each model was authored at exactly 2× its cylinder. The 20% spread above is
that authoring variance, so a visual check against a few known monsters is
still worthwhile before trusting it blindly across the bestiary.

---

## 5. What `radius` is for

`radius` (86 distinct values, 0–300) is the collision cylinder's horizontal
extent. Useful in the client for:

- **click/target boxes** — the current client uses a fixed 40px screen-space
  pick radius (`main.js`); `radius` gives the real per-NPC footprint
- **nameplate placement** — the label anchor should clear `2 × height`, not a
  hardcoded `heightM * 1.1`
- **spacing / not standing inside a mob**
- **melee range checks** — the server adds both parties' radii

---

## 6. Implementation sketch (nothing implemented)

1. **Export** `npcId → {radius, height, type, level}` from the aCis XMLs into
   `assets/gamedata/npcsize.json`, the same way `playerlevels.json` and
   `skilltypes.json` were done. Source of truth is the server, so browser and
   server agree.
2. **Scale at spawn**: `scale = (2 * height) / manifest.nativeHeight`, applied
   to the entity's model root.
3. **Anchor nameplates and HP bars at `2 * height`** in world units rather than
   a model-derived guess.
4. **Use `radius`** for pick boxes and spacing.
5. **Verify**: render N known NPCs and compare against the ground-truth oracle
   (`docs/ground-truth.md`) or official captures. The pig_ball / pixy /
   death_blader families are the highest-signal test cases because the reuse
   spread is largest there.

---

## 7. Open questions

- ~~**Unit of `height`.**~~ **RESOLVED** — the server doubles it
  (`2 * getCollisionHeight()` in `GeoEngine` and `AdminGeoEngine`), so it is
  formally a half-height. Remaining variance is mesh authoring, not units.
- **The 4,785 NPCs with no built mesh.** Only 83 meshes exist so far; 1,711
  npcIds map to them. The remaining NPCs still have collision data but no
  model, so the scale rule cannot be checked for them yet.
- **`npcgrp.property_list`** (e.g. `[4416, 13]`) is undecoded and may carry
  render flags. Worth a pass — it is one of the few unexplained fields left in
  a table that otherwise parses byte-exact.
- **Servitors/pets vs monsters.** 764 Servitor entries share meshes with
  monsters; whether they use the same scale relationship was not separated out.
- **Texture sets.** `textures_second` exists and is usually empty; when it is
  populated the selection rule is unknown.

---

## 8. Reproducing

Read-only; the scripts lived outside the repo.

```
NPC XMLs:  server/.../data/xml/npcs/*.xml
           regex <npc id= name=> … <set name= val=>  ->  radius, height, type, level
npcgrp:    assets/gamedata/npcgrp.json      npc_id -> mesh_name (strip package prefix)
meshes:    editor/characters/monsters/manifest.json   id -> nativeHeight
join:      npc_id -> mesh -> nativeHeight, compare against 2 * height
```

Guard for a regression suite: **≥ 1,700 npcIds must join to a mesh**, and the
median `nativeHeight / height` ratio must stay within **1.9–2.1**.
