# Minimap / radar mapping spec — retail imagery, georeference, window behavior

Audience: the client workstream building MinimapWnd/RadarWnd. This document is
the mapping spec; `assets/gamedata/minimap.json` is the machine-readable
manifest; `tools/maps/build_minimap.py` regenerates everything.

## 1. Where the retail minimap imagery lives

| Asset | Location | What it is |
|---|---|---|
| **World map** | `L2Font-e.utx`: `int_worldmap1..6` (6× 1024×1024) | THE Interlude world map (parchment style, English labels baked in). Staged assembled as `assets/world/minimap/worldmap.png` (2048×3072). |
| Town maps (starting villages) | `town_map.utx`: `town_map_{talking,elf,darkelf,orc,dwarf}_t00` (512×512) + `icon_i00` (player marker) | Detailed zoomed map shown by TownMapWnd / "zoom to town". |
| Town maps (Giran area) | `T_Giran.utx`: `22_21_map`, `23_21_map`, `24_21_map` (512×512) | The only per-tile `_map` textures in the whole client — Giran got a detailed town map, no other region did. |
| UI chrome | `L2UI_CH3.utx` group `Minimap.*` (`MapBack`, `MapShadow`, `Map_Sun/Moon`, `MapButton_Zoom*`, `cursedmapicon*`, `minimap_party`, `mapicon_mark*`, `mapinfo_back`, `MapWnd_back_max`) | Frames, buttons, markers. Already extracted in `assets/library/L2UI_CH3/` (lowercase names). |

The world map lives in the **font package** because the zone/town labels are
baked into the bitmap and are therefore localized: `L2Font.utx` carries
`ch4_worldmap1..6` (Chronicle 4 world, no Goddard), `l2font-r.utx` the RU
variant. `L2Font-e` = Interlude English — the correct one for us.

**Dead ends ruled out:**
- `l2zonename.utx` (204 textures named `<tx>_<ty>`, 128×128) is NOT terrain
  imagery — flat color-blob region masks per tile (zone-type overlays).
- `sek.utx` `aden_map`/`elmore_map` (2048²) — legacy C1-era sketch maps with a
  compass rose; not referenced by any Interlude window.
- Per-tile map textures inside tile packages (`T_*`) — only the 3 Giran ones
  exist; not a general mechanism.
- `MinimapBack`/`Minimap_back` in l2ui.utx, `mapback` in L2UI_CH3 — window
  background chrome, not geography.

## 2. World-map georeference (verified)

Assembled layout (terrain and labels continue across seams):

```
[ int_worldmap1  int_worldmap2 ]     rows    0..1023
[ int_worldmap3  int_worldmap4 ]     rows 1024..2047
[ int_worldmap5  int_worldmap6 ]     rows 2048..3071
```

Projection over the assembled 2048×3072 image:

```
px = (x - X0) / S        X0 = -127750
py = (y - Y0) / S        Y0 = -250000
                         S  = 196.3 world-units / pixel  (1 map tile = 166.9 px)
inverse: x = X0 + px*S,  y = Y0 + py*S
```

- Covered world rect: x ∈ [-127750, 274122], y ∈ [-250000, 353137] —
  all 100 converted tiles (tx 16..26, ty 11..25) are covered; tiles 16_21,
  16_24, 16_25 lose a ~17 px ocean strip at the west edge (manifest flags
  them `clipped`, strip filled with parchment).
- Uncertainty (honest): X0 ±1500, Y0 ±2000 units, S ±1 → worst-case ~15 px
  (~0.09 tile) at the map edges; ~±3 px near Talking Island.

### Evidence

Three independent methods agree:

1. **TI-island coastline correlation.** Land mask from the G16 heightmaps of
   tiles 16_24/16_25/17_24/17_25 (`tools/maps/out/*.heightmap.u16`, sea = flat
   ocean floor) cross-correlated (FFT) against the image land mask
   (luminance < 140, median-filtered to kill baked-in text): best fit
   s=195.8, corner of tile 16_24 at px (-15, 2278) → X0=-128135,
   Y0=-249424. Robust to coastline threshold choice.
2. **Global coastline fit.** Same method over all 50 available heightmap
   tiles (west ocean 15_2x, TI, SE coast 22_26..24_26, east 26_1x, north
   ocean 23_10..25_10), balanced land/sea accuracy: best at
   X0=-127750, Y0=-250000, s=196.3.
3. **Town icons.** 14 towns with aCis-verified teleport coords
   (docs/tile-map.md) measured on the image: residuals ≤ ±15 px with no
   scale/offset trend beyond icon-shape noise.

### Cross-checks (the required ones)

Projected with the formula above and inspected on the image
(red-circle verification renders):

- **Talking Island Village** teleport (-84141, 244623) → px (222.2, 2519.7):
  lands ON the "Talking Island Village" icon in tile 17_25. The three TI map
  signboards (aCis staticObjects) project onto the same icon cluster.
- **Elven Ruins** (-112367, 234703) → (78.4, 2469.2): on the ruins tower.
- **Obelisk of Victory** (-99843, 237583) → (142.2, 2483.9): on the obelisk.
- **Town of Giran** (83314, 148012) → (1075.2, 2027.6): on the Giran city
  icon (tile 22_22 — the community's "Giran = map 22_22" ✓).
- **Town of Aden** (144635, 26664) → (1387.6, 1409.4) and **Dwarven Village**
  (115120, -178224) → (1237.2, 365.6): on their icons.

## 3. Staged assets + manifest

`python3 tools/maps/build_minimap.py` produces:

- `assets/world/minimap/worldmap.png` — 2048×3072 assembled world map (gitignored).
- `assets/world/minimap/tiles/<tx>_<ty>.png` — 100 uniform 256×256 per-tile
  crops (gitignored). A tile image covers exactly the tile's world rect
  (32768² units); manifest carries the float `srcPxRect` for precision work.
- `assets/world/minimap/towns/*.png` — 8 town maps (5 starting villages +
  3 Giran) (gitignored).
- `assets/gamedata/minimap.json` — TRACKED manifest: georeference constants,
  piece layout, covered rect, 6 `anchors` (world→px pairs for client-side
  self-tests), per-tile entries, town maps with signboard pairs.

### Town maps georeference — weak evidence, use with care

The only town-map georeference is aCis `staticObjects.xml`: map signboards
store `(world x,y) → town-map pixel (mapX,mapY)` (3 per starting village,
embedded in the manifest under `townMaps.<name>.signboards`). The retail flow
is server-driven: `ShowTownMap("town_map."+texture, mapX, mapY)` → client
pins `UserTex` (town_map.icon_i00) at that pixel — so the SERVER owns the
projection. Fitting the 3 TI signboards suggests the TI town map is drawn
rotated (map X ≈ -worldY, ~16.6 u/px); the dwarven triple is not even
uniform-scale consistent. Treat aCis mapX/mapY as hand-tuned approximations:
fine for placing the player marker via linear interpolation between
signboards, not as an exact affine.

## 4. Window behavioral spec (xdat + uscript)

Geometry from `assets/gamedata/interface.json` (Layout-decoded), behavior
from `assets/uscript/Interface/{MinimapWnd,MinimapWnd_Expand,RadarWnd,TownMapWnd}.uc`.
The map control itself is NATIVE (`MinimapCtrl` / `Radar`): scripts only feed
it events and coords; projection/zoom happen in native code.

### MinimapWnd (334×413, background `L2UI_CH3.Minimap.MapBack`)

- `Minimap` [MinimapCtrl] at (3,51), 328×328 viewport.
- Header strip: `CursedComboBox` (6,27, 180×19) + `Pursuit` (193,25, 47×21) —
  cursed-weapon tracker (Zariche 8190 / Akamanah 8689): list via
  `MiniMapAPI.RequestCursedWeaponList`, locations drawn with
  `DrawGridIcon` (`L2UI_CH3.MiniMap.cursedmapicon00/01/02`, `_drop` variants,
  offset 0,-12, tooltip = name); two weapons at the same spot merge into one
  icon (`IsOverlapped`).
- Footer buttons: `TargetButton` (170,385) centers on quest target
  (`GetQuestLocation` → `AdjustMapView`), `ExpandButton` (250,385) opens
  MinimapWnd_Expand. (PartyLoc/MyLoc buttons exist in script but are not in
  the small window's xdat — only in Expand.)
- `btnReduce` (24×24, textures MapButton_ZoomOut1/2) — shown/hidden by the
  native control via EV_MinimapShowReduceBtn/HideReduceBtn (appears when the
  view is zoomed past the default; clicking zooms back out —
  `RequestReduceBtn`).
- Info labels: `txtVarSSQType` (SSQ state text, system strings 973-976:
  sets via `SetSSQStatus`), `txtVarCurLoc` (current zone name, refreshed on
  EV_BeginShowZoneTitleWnd), `txtGameTime` + `texSun`/`texMoon`
  (EV_MinimapUpdateGameTime; sun 06:00-24:00, moon otherwise).
- Targets/markers: EV_MinimapAddTarget/DeleteTarget/DeleteAllTarget (world
  Vector), quest markers toggled by `SetShowQuest`.
- On show/hide plays `interfacesound.Interface.map_open_01` / `map_close_01`.
- EV_MinimapChangeOnTick → re-center on player
  (`AdjustMapView(playerPos, zoomToTownMap=true)`).

### MinimapWnd_Expand (full-screen world map)

- Root window autosizes to the screen; `Minimap` [MinimapCtrl] sized to
  (screenW - 3%) × (screenH - 90), capped at 1016×934
  (`N_MAX_MINI_MAP_RES_X/Y = 1024`, header buffer 90). Recomputed on
  EV_ResolutionChanged.
- Same cursed-weapon/SSQ/location/game-time logic as the small window plus
  `MyLocButton`, `PartyLocButton` (cycles party members:
  `GetPartyMemberLocation(i)` → `AdjustMapView`), `TargetButton`,
  `CollapseButton` (back to small window).

### RadarContainerWnd + RadarWnd (the always-on radar)

- `RadarContainerWnd` 102×102 at (0,0) containing the native `Radar` control.
- `RadarWnd` (16×16) holds 9 zone-icon slots (icon1..9, 16×16); the script
  only shows icon6 (SSQ zone) — the rest are commented out in retail.
- EV_SetRadarZoneCode (param ZoneCode) → tints the radar for 2 s
  (`SetRadarColor(color, 2.f)`) and shows a fading zone banner ("movingtext"
  window, sysstrings 1284-1290):

  | ZoneCode | Meaning | Color (R,G,B) |
  |---|---|---|
  | 15 | Ordinary Field | grey (30,30,30) |
  | 12 | Peace Zone | blue (0,0,50) |
  | 11 | Siege Warfare Zone | orange (60,30,0) |
  | 9 | Buff Zone | red (50,0,0) — code says red although the comment claims green |
  | 8 | DeBuff Zone | red (50,0,0) |
  | 13 | SSQ Zone | grey + icon6 shown |
  | 14 | PVP Zone | green (0,50,0) |

- Banner animation: fade-in +3 alpha/tick to 255, then fade-out -2 alpha/tick
  while drifting down 1px/tick, then hidden.

### TownMapWnd (334×354 — server-driven town zoom)

- `BackTex` (0,21) 334×333 `L2UI.MinimapWnd.MinimapBack`; `ContainerWnd`
  (3,21) 328×328 with `TownMapTex` (the town map, set by texture NAME from
  the server) and `UserTex` (32×32, `town_map.icon_i00`, anchored at the
  server-sent pixel).
- Entirely driven by EV_ShowTownMap(TownMapName, UserPosX, UserPosY) — see
  §3 for the projection caveat. In aCis this comes from map signboards
  (`StaticObject.setMap`, `ShowTownMap` packet).

### Native API surface used (for the port)

`UIAPI_MINIMAPCTRL`: AddTarget / DeleteTarget / DeleteAllTarget /
AdjustMapView(loc[, zoomToTownMap][, bool]) / SetShowQuest / SetSSQStatus /
RequestReduceBtn / DrawGridIcon(ctrl, icon, bgIcon, loc, refresh, ox, oy,
tooltip) / DeleteAllCursedWeaponIcon / IsOverlapped.
`MiniMapAPI`: RequestCursedWeaponList / RequestCursedWeaponLocation.
Events: EV_ShowMinimap, EV_MinimapAddTarget/DeleteTarget/DeleteAllTarget,
EV_MinimapShowQuest/HideQuest, EV_MinimapChangeOnTick,
EV_MinimapCursedWeaponList/Location, EV_MinimapShowReduceBtn/HideReduceBtn,
EV_MinimapUpdateGameTime, EV_PartyMemberChanged, EV_BeginShowZoneTitleWnd,
EV_ResolutionChanged, EV_SetRadarZoneCode, EV_ShowTownMap.

Zoom: level handling is native (not visible in script/xdat). What is known:
the small viewport is 328×328, Expand caps at ~1016×934, `AdjustMapView(...,
zoomToTownMap=true)` switches to the town map when one exists for the
current town (starting villages + Giran), and btnReduce/ZoomOut appears when
zoomed in. At 1:1 the world map gives 196 u/px (a 328px viewport ≈ 2 tiles).

## 5. Regenerating

```
python3 tools/maps/build_minimap.py     # worldmap + tiles + towns + manifest
```

Inputs are the already-extracted library PNGs (regenerate those with
umodel from the .utx if ever needed: L2Font-e.utx, town_map.utx, T_Giran.utx).
