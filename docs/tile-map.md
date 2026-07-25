# Interlude tile map — the definitive tile ↔ region reference

Machine-readable output: **`assets/world/tile-map.json`** (all 153 world-grid
tiles of `assets/interlude/maps/`). Generator: `tools/maps/tilemap.py`
(re-run: `python3 tools/maps/tilemap.py`).

World transform (validated in `docs/map-format.md` §6):

```
tile (tx,ty) covers world rect  X ∈ [(tx-20)*32768, (tx-19)*32768)
                                Y ∈ [(ty-18)*32768, (ty-17)*32768)
tile index of (x,y)            tx = floor(x/32768)+20,  ty = floor(y/32768)+18
North = -Y, South = +Y (Dwarven lands y≈-180k north; Talking Island y≈+240k south).
```

## How tiles were named (multi-source fusion)

Each tile carries a `confidence` and the list of `sources` that named it:

1. **`spawnlist`** — `server/aCis_datapack/data/xml/spawnlist/<tile>.xml`.
   Each file is keyed by tile and its header comment names the region
   (`Gludin Area / * Orc Barracks` …). Every territory polygon node was
   verified to fall inside the file-name tile's world rect: **only 8 of
   ~52,000 nodes spill across a border** (0.015%, polygons clipped at tile
   edges) — the spawnlist grid and the client map grid are the same grid.
2. **`teleports`** — `data/xml/teleports.xml` + `instantTeleports.xml`: ~300
   unique named destinations with retail world coords, converted to tile
   indices (full dump: `/tmp` report of the generator run).
3. **`zones`** — `data/xml/zones/*.xml`: zone-name comments
   (`talking_island_town_peace_zone1`, `giran_pvp_battle`, `aden_castle` …)
   located by polygon centroid.
4. **`castles`** — castle artifact/tower coords per castle name.
5. **`terrain`** — G16 heightmaps extracted with `tools/maps/unrmap.py` from
   `T_<tile>.utx` for **every** map tile: constant-16384 = flat ocean/stub,
   relief = land. Used to classify tiles no game data names.

Two extra conventions embedded in the data itself confirm the grid:

- Spawnlist territory names embed the tile index — e.g. territory
  `gludio15_1621_01` lives in `16_21.xml` and its nodes fall in tile 16_21's
  rect (holds for all files except Seven Signs dungeon interiors, whose
  territory names embed the *surface* tile, e.g. `ssq06_2122_*` in `18_10`).
- Retail zone names embed the tile index too: `20_24_beres_01`,
  `20_21_cruma_tower` in `NoSummonFriendZone.xml`.

## World grid (map tiles only; `·` = no .unr, `~~~` = flat ocean)

```
ty\tx | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26
------------------------------------------------------------------
  10 |  · | GM |OLY |SSQ |SSQ |SSQ |  · |  · |~~~ |~~~ |~~~ |  ·
  11 |  · |OLY |OLY |~~~ |off |off |  · |  · |Dwf |Dwf |Dwf |???
  12 |  · |SSQ |~~~ |~~~ |  · |  · |  · |  · |Dwf |Dwf |Dwf |???
  13 |  · |  · |  · |~~~ |Orc |Orc |~~~ |Sch |Sch |??? |  · |  ·
  14 |  · |  · |  · |Orc |Orc |Orc |Sch |Sch |Sch |God |God |God
  15 |  · |  · |  · |~~~ |Orc |Orc |Run |Run |God |God |God |~~~
  16 |  · |  · |  · |  · |Run |Run |Run |Run |God |God |God |~~~
  17 |  · |  · |  · |~~~ |OLY |Run |Run |Ore |Ade |Ade |Ade |  ·
  18 |  · |  · |~~~ |~~~ | DE | DE |Ore |Ore |Ade |Ade |Ade |  ·
  19 |  · |~~~ |~~~ | DE | DE |Elf |Elf |Ore |Ade |Ade |Ade |  ·
  20 |~~~ |??? |Glu | DE |Gld |Elf |Elf |Ore |Hnt |Hnt |Hnt |  ·
  21 |~~~ |Glu |Glu |Gld |Gld |Dio |Dio |Gir |Gir |Gir |Gir |  ·
  22 |~~~ |~~~ |Glu |Gld |Gld |Dio |Gir |Gir |Gir |??? |  · |  ·
  23 |~~~ |~~~ |Glu |Glu |Gld |Dio |Gir |Hei |Hei |??? |  · |  ·
  24 |~~~ | TI | TI |Glu |Gld |(1) |Gir |Hei |Hei |??? |  · |  ·
  25 |~~~ | TI | TI |~~~ |~~~ |~~~ | TI |Hei |Hei |??? |  · |  ·
  26 |~~~ |~~~ |~~~ |~~~ |  · |  · |  · |~~~ |~~~ |~~~ |  · |  ·
```

Legend: TI Talking Island · Glu Gludin · Gld Gludio · Gir Giran · Ade Aden ·
Dio Dion · DE Dark Elven · Elf Elven · Orc Orc · Dwf Dwarven · Run Rune ·
Ore Oren · Hei Heine/Innadril · Hnt Hunters · God Goddard · Sch Schuttgart ·
SSQ Seven Signs interiors · GM GM room · OLY Olympiad stadiums · off
off-world stub · ??? unnamed terrain with relief · (1) south Dion coast
(retail `beres` zone).

Note several tiles are **off-world utility tiles**, not geography: 16_10 (GM
room), 16_11/17_10/17_11/19_17 (Olympiad stadium instances), 16_12/18_10/
19_10/20_10 (Seven Signs dimensional rift / catacomb interiors, stored at
y≈-250k). Their flat heightmaps match: interiors have no terrain.

## Famous locations — verified claims (≥2 independent sources each)

| Place | Tile(s) | Evidence |
|---|---|---|
| **Talking Island Village** | **17_25** | teleport "Talking Island Village" (−84141,244623)→17_25; spawnlist 17_25 header "Talking Island Village / Harbor / Einhovant's School of Magic / Cedric's Training Hall"; 4 `talking_island_town_peace_zone` polygons centered (−84k,243k); heightmap relief (PNG inspected) |
| **Talking Island (whole island)** | **16_24, 16_25, 17_24, 17_25** | teleports: Elven Ruins (−112367,234703), Obelisk of Victory (−99843,237583), Singing Waterfall (−111728,244330)→16_25; "TI Western Territory (Northern)" (−106696,214691)→16_24. Spawnlist 16_24/16_25 headers "Talking Island". Heightmaps: relief in exactly these 4 tiles; all 8 neighbors (15_24,15_25,16_23,16_26,17_26,18_25,18_26,15_2x) dead-flat ocean. Elven Ruins dungeon interior = **21_25** (spawnlist note "mobs in 21_25" + noble teleport 49315,248452) |
| **Gludin Village** | **17_22** | teleports "The Village of Gludin" (−80826,149775), "Village Square" (−82445,150788), "Gludin Arena" (−87328,142266)→17_22; spawnlist 17_22 header "Gludin Village / Gludin Harbor / Gludin Arena"; zones `gludin_pvp`, `gludin_town_peace*` |
| **Giran** | **22_22** (town), castle 23_22 | teleports "The Town of Giran" (83314,148012), "Giran Town Square" (81749,149171), "Giran Arena" (73579,142709)→22_22; spawnlist 22_22 header "Town of Giran / Giran Arena / Breka's Stronghold"; **community: MaxCheaters L2Editor + teleport threads both call Giran "map 22_22"** (see below); `giran_castle` zone + "Front of the Giran Castle" (107954,145841)→23_22 |
| **Aden** | **24_18** (town + castle) | teleports "Town of Aden" (144635,26664), "Aden Town Square" (147450,28081), "Front of the Aden Castle" (147428,20161)→24_18; spawnlist 24_18 header "Town of Aden / Aden Castle / Plains of Glory / War-Torn Plains"; castles.xml Aden artifact + `aden_castle` zone |
| **Dion** | **20_22** | teleports "The Town of Dion"/"Dion Town Square" (19025,145245), "Front of the Dion Castle" (19888,153395)→20_22; spawnlist 20_22 header "Town of Dion / Dion Castle / Floran Agricultural Area / Dion Hills"; `dion_castle` zone |
| **Gludio** | **19_21** | teleports "The Town of Gludio" (−12787,122779), "Gludio Town Square" (−14393,123671)→19_21; spawnlist 19_21 header "Town of Gludio / Gludio Castle / Evil Hunting Grounds / Maille Lizardman Barracks"; castles.xml Gludio artifact, `gludio_castle` zone |
| **Dark Elf Village** | **20_18** | teleport "Dark Elf Village" (9716,15502)→20_18; spawnlist 20_18 header "Dark Elven Village / Shilen Temple / Shilen's Garden"; zones `darkelf_town_peace_zone`, `darkelf_start_peace_1` |
| **Elven Village** | **21_19** | teleport "Elven Village" (46890,51531)→21_19; spawnlist 21_19 header "Elven Village / Shadow of the Mother Tree"; zones `mother_tree_town`, `mother_tree_start_zone` |
| **Orc Village** | **18_14** | teleport "Orc Village" (−45186,−112459)→18_14; spawnlist 18_14 header "Orc Village / Pa'agrio Temple / Valley of Heroes"; zones `orc_start_peace`, `orc_town_peace1` |
| **Dwarven Village** | **23_12** | teleport "Dwarven Village" (115120,−178224)→23_12; spawnlist 23_12 header "Dwarven Village / Frozen Valley / Strip Mine / Mining Zone Passage"; zone `dwarf_start` |
| **Execution Grounds** | **21_22** | teleports "Execution Ground" (37566,148224) + "Execution Grounds" (41985,147314)→21_22; spawnlist 21_22 header "Execution Grounds / Tanor Canyon / Catacomb of the Heretic (entrance only, mobs in 18_10)" — the 18_10 interior file's territory embed `ssq06_2122` closes the loop |
| **Dragon Valley** | **22_21 (west) + 23_21 (east)** | teleports "Dragon Valley" (73024,118485)→22_21, "The Center of Dragon Valley" (122824,110836)→23_21; spawnlist headers "Dragon Valey (west) / Deathpass" and "Dragon Valley (east) / Gordon Flower Garden"; l2hub C4 groups Dragon Valley under Giran Territory |

Other tiles of interest (all high-confidence in the JSON): Cruma Tower 20_21,
Oren 22_19, Hunters Village 23_20, Heine 23_24, Rune 21_16, Goddard 24_16,
Schuttgart 22_13, Antharas' Lair 24_21, Coliseum 24_19, Ivory Tower 22_18,
Wasteland 18_23, Forgotten Temple 18_23, Ant Nest 19_23, Sea of Spores 21_18,
Blazing Swamp 24_17, Tower of Insolence 23_18, Primeval Island 20_17.

## Community cross-check (source c)

- MaxCheaters, *L2Editor* thread: "I am editing Giran map (22_22)"
  (maxcheaters.com/topic/217389-l2editor/) and *Teleport Critical Error*:
  "Is it just map 22_22? Is giran map 22_22?"
  (maxcheaters.com/topic/234697-teleport-critical-error/) — community tooling
  uses the same tile name for Giran as our coordinate math.
- L2J GeoEngine loader logs name geodata files by the same grid
  ("Loading: data/geodata/16_25.l2j"), i.e. the community geodata convention
  equals the client map-tile convention; our own
  `server/aCis_gameserver/.../geodata/<tile>_conv.dat` files follow it and
  must line up with the spawn coordinates above or the server would not work.
- [L2Hub C4 database](https://l2hub.info/c4/locs) territory→location grouping
  matches the spawnlist headers 1:1 (e.g. Talking Island = Village, Harbor,
  Cedric's Training Hall, Einhovant's School of Magic, Elven Ruins, Obelisk
  of Victory; Gludin Territory = Village, Harbor, Orc Barracks, Fellmere,
  Wasteland, Langk Lizardmen…).

## Corrections to earlier repo docs

- `docs/map-format.md` called tile **16_10** "Talking Island village area".
  Wrong: 16_10's rect is X∈[−131072,−98304], Y∈[−262144,−229376] — the far
  north-west off-world strip. aCis zones place `gm_room*`, `gm_prison` there;
  its heightmap is a constant 16384 (flat interior stub). **16_10 is the GM
  room tile.** Talking Island village is **17_25** (verified above).
- `docs/web-port-architecture.md` §M1 suggests TI village is in the
  `15_20`/`15_21` region — those are flat ocean tiles west of the island.
  The M1 starting tile should be **17_25** (village) with neighbors
  16_24/16_25/17_24.

## Regenerating

```
python3 tools/maps/tilemap.py     # rewrites assets/world/tile-map.json
```

Heightmap inputs for pass 2 come from `tools/maps/out/<tile>.heightmap.u16`
(produced by `tools/maps/unrmap.py terrain <tile>`); tiles without one keep
their game-data name only.
