# What is still NOT retail — a ranked, measured inventory

**Measured 2026-08-09 against the working tree at `0d9873d`.** Read-only audit; nothing
outside `tools/audit/` and this directory was touched.

Reproduce every number in this file with:

```
python3 tools/audit/retail_gaps.py --detail      # the inventory
python3 tools/audit/retail_gaps.py --check       # gate (baseline in tools/audit/)
python3 tools/audit/retail_gaps.py --selftest    # prove each metric can move
python3 tools/audit/retail_gaps.py --prove       # working tree vs git HEAD
```

`tools/audit/retail_gaps_baseline.json` was recorded at `0d9873d` with the working tree in
the state described above. `--check` deliberately fails when a gap SHRINKS as well as when
it grows, so closing any item below forces a re-record — the alternative is a baseline
that quietly outlives the thing it measured.

**The tree moved under this audit.** Two other lanes were writing while it ran: HEAD
advanced from `a53aab3` to `0d9873d` and `editor/world/js/{nameplates,labels,entities}.js`
were modified mid-measurement. `unsourced_total` read 2117, then 2126, then 2127 over
forty minutes. Where a number here differs from a re-run by a few units, that is why —
the method is reproducible, the tree is not frozen. Item 3 below is a live example.

---

## 0. The two tools that were the starting point, and what they actually say

### `tools/audit/unsourced.py` — RED, and the task's framing of it is wrong

| bucket | count | share |
|---|---:|---:|
| BENIGN | 7,269 | 69.3% |
| SOURCED | 725 | 6.9% |
| AUTHORED | 362 | 3.5% |
| **UNSOURCED** | **2,127** | **20.3%** |
| TOTAL | 10,482 | |

`--check` exits **1**. Task #52 says "19 files regressed across lanes". The true count is
**25**, and the shape is not what "regressed" implies:

| | files | literals |
|---|---:|---:|
| **NEW files never in the baseline** | 14 | 253 |
| **existing files that grew** | 11 | +27 |

90% of the growth is new tool-chain code, not decay in shipped code. Attribution by the
commit that last touched each file:

| commit | lane | files | literals |
|---|---|---:|---:|
| `1ef4db8` | item tooltips | mine_itemtooltip.py, ui/tooltip.js | 104 |
| `ec6f0e7` | armor/shields | decode_attach.py, build_armor.py, armor.js | 49 |
| `af6e568` + `053d0db` | sky/lightmaps/battery | sky.py, lightmap.py, bsplight.py, bsp.py, keepalive_server.py, sky.js, bsp.js, audit_bindings.py | 100 |
| `fcf1bad` | skill taxonomy | export_skillclass.py, parse_skillsoundgrp.py, build_skillvfx.py, skillvfx.js | 38 |
| `314ad1e` | cast animations | audit_castanim.py, build_pawnanim.py, castanim.js, character.js, entities.js | 12 |
| `65b3508` / `c71dc15` | combat / labels | combat.js, worldlight.js | 4 |

Where the 2,127 live, by domain: **tool-pipeline 1,180 · client-world 423 ·
tool-parser 348 · tool-test 156 · client-ui 10.** By role: other 1,860 · colour 75 ·
physics 58 · geometry 53 · scale 39 · opacity 14 · timing 12 · tolerance 4 · font 2.

**Inference, stated separately from the measurement:** the client-facing UI lane is
effectively closed (10 literals, all in `ui/tooltip.js`, all `.uc` line references). The
remaining bucket is overwhelmingly extraction code, where an unsourced literal is a
struct offset, not something a player sees. Closing it has low visual return. That is why
the rest of this document does not rank by literal count.

### `tools/ui/audit_guesses.py` — PASS, and its green is much narrower than it reads

`118 retail-pixel literals, 0 unjustified. CHECK PASS.` True, and it can only ever see
`Skin.px(<number>)` inside `editor/world/js/ui/*.js` (no recursion, and `0/1/2/3` are
skipped as trivial). Measured, in the very same directory it audits:

* **62 raw `"<N>px"` string literals** it does not match;
* **85 hex colour literals** it does not match;
* **`editor/world/style.css` — 119 px values and 73 hex colours — audited by nothing at
  all.** `unsourced.py`'s roots are `editor/world/js` and `tools`; neither tool opens a
  `.css` file. `style.css`'s own header acknowledges this and classifies its contents by
  hand.

Not a vacuous gate — it evaluates 118 real assertions — but a green from it is a
statement about one construct in one directory, not about the UI.

---

## 1. THE RANKING

Ordered by what a player notices, not by cost.

---

### 1. There is no time of day, and the world's light is invented — while retail's exact answer sits on disk, encrypted, never opened

**Category: decoded-but-unwired + render surface. Metric `timeenv_unread` = 4,
`daynight_unbridged` = 3, `authored_light_rig` = 4.**

`assets/interlude/system/timeenv0.int … timeenv3.int` are Lineage2Ver111-encrypted INI
files. `tools/bin/l2encdec -c decode -p 111` opens all four (verified — they decrypt
cleanly to 13–14 KB of plain text). **No file anywhere in the repository names them.**

Each carries, for one `EnvType` and for 25 hourly keyframes:

```
[SunColor] [SunScale] [MoonColor] [MoonScale] [SkyBoxColor] [HazeringColor]
[CloudColor1] [CloudColor2] [CloudColor3]
[TerrainAmbient] [ActorAmbient] [StaticMeshAmbient] [BSPAmbient]
[HSVTerrainLight] [HSVActorLight] [HSVStaticMeshLight] [HSVBSPLight]
```

Verbatim from `timeenv0.int`:

```
[SkyBoxColor]  COLOR1=(T=0,R=40,G=49,B=70) … COLOR13=(T=12,R=66,G=124,B=176) …
[TerrainAmbient] COLOR1=(T=0,R=51,G=98,B=122) … COLOR13=(T=12,R=120,G=120,B=120) …
[BSPAmbient]   COLOR1=(T=0,R=64,G=88,B=111) … COLOR21=(T=20,R=131,G=114,B=90) …
[HSVBSPLight]  Light1=( T=0, Hue=138, Sat=182, Bri=0 ) … Light11=( T=10, Hue=1, Sat=255, Bri=180 )
[SunColor]     Color1=(T=6,R=255,G=122,B=23) … Color5=(T=24,R=162,G=65,B=0)
[MoonScale]    Scale1=(T=0,S=4.5) … Scale5=(T=6,S=4.5)
```

What the client does instead, `editor/world/js/main.js:247-251`:

```js
scene.add(new THREE.AmbientLight(0xcfd4de, 0.55));
scene.add(new THREE.HemisphereLight(0xbcc8e0, 0x40382e, 0.85));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
```

plus an interior branch that types `0x6a5138 / 0x5a4630 / 0x1a140e` and a torch
`0xffb070`. Four constructors, eight authored colours, four authored intensities — for
quantities retail states per hour, per render class, four ways. **`HemisphereLight` has
no counterpart in the client at all.**

This single file family also closes gaps three other places in the tree left open and
labelled unsourced:

* `tools/world/bsplight.py` KNOWN GAPS 1 — "what selects a lightmap variant at runtime is
  still NOT sourced". A sheet carries **8** variants; `HSVBSPLight` supplies a per-hour
  HSV modulation of BSP light. That is a candidate the gap never had.
* `editor/world/js/sky.js` — "nothing in skylevel.unr … says what fades [the starfields]".
  `SkyBoxColor` + `CloudColor1..3` + `MoonScale` are exactly that curve.
* `editor/world/js/worldlight.js` — "intensity NOT taken; `LightBrightness` 70.0 has no
  sourced conversion". The `HSV*Light` blocks carry `Bri` per hour in the same engine
  units (0…450), which is the second data point a conversion needs.

And there is no clock to index them with: aCis ships `ClientSetTime`, `SunRise` and
`SunSet` as server packets (`server/aCis_gameserver/.../serverpackets/`), and **none of
the three names appears anywhere in `gateway/src` or `editor/world/js`.**

> **NEXT ACTION** — `tools/world/timeenv.py`: decrypt the four files with the existing
> `l2encdec -p 111` path, emit `assets/gamedata/timeenv.json` (envType → section →
> `[{t, r, g, b}]` / `{t, hue, sat, bri}`), with `--check` re-deriving from the DLL-side
> encrypted originals. Then bridge `ClientSetTime` (one opcode) so `worldlight.js` has an
> hour, and replace `main.js`'s four light constructors with interpolated lookups.
> **Falsifiable:** if `EnvType` does not select per-zone environment, the four files would
> not differ; check that `timeenv1/2/3` differ from `timeenv0` before assuming the
> mapping.

---

### 2. `js/sky.js` is a finished, sourced sky renderer that nothing imports

**Category: decoded-but-unwired. Metric `sky_module_unwired` = 1.**

333 lines. It builds the cloud sheet, both starfields and the sun/moon/lens-flare rig from
`assets/world/sky/sky.json`, which `tools/world/sky.py --check` re-derives from
`skylevel.unr` and `l2_skies.utx`. It reasons carefully about additive vs alpha blending
from measured texture statistics. Its own header says:

> "main.js is not owned by this pass, so nothing here is called yet."

Measured: `importers_of('sky.js')` = **0**; the control `importers_of('coords.js')` = **15**,
so the detector works. Only `editor/world/sky-preview.html` mounts it — a preview page is
not the client. The player therefore sees a flat `#0096CE` background plus a haze band and
**no cloud, no stars, no sun, no moon**, while the code to draw all four is on disk and
gated.

Task #30 describes this as "still unreproduced". That is now **false**: it is reproduced
and disconnected, which is a different and much cheaper problem.

> **NEXT ACTION** — three lines in `main.js` (`SkyLayers.load()`, `scene.add(sky.group)`,
> parent to camera), plus a gate in `verify_sky.js --live` that asserts the cloud and
> starfield meshes exist in the live scene graph at `:8083`. Leave `animate()` off: its
> pan-rate units are a documented open question and a wrong rate is a visible lie.

---

### 3. Nameplates were red on 98.5% of NPCs — found here, and already fixed in a concurrent lane

**Category: wired to the wrong source. Metric `nameplate_red_permille`: 985 at `HEAD`, 0
in the working tree.**

`js/nameplates.js` `colourFor()` ran every NPC plate through `native_colors.json`'s
`conColor` ladder on `(viewerLevel − targetLevel)`. That ladder's only evidence is
NWindow.dll's `?execGetTargetNameColor@UUIDATA_TARGET@@` — the **target window's** data
provider. Its first rung is `#FF0000` for anything ≥9 levels above the viewer.

Measured against the aCis datapack (`data/xml/npcs`, 6,496 NPCs carrying a level):

| viewer level | on the red rung |
|---|---|
| 1 | **6,397 / 6,496 = 98.5%** |
| 20 | 5,867 / 6,496 = 90.3% |
| 40 | 5,016 / 6,496 = 77.2% |

**A concurrent lane fixed this while this audit was running** (uncommitted at measurement
time, now in `0d9873d`), with a sharper measurement than the one above:
`GetTargetNameColor` has exactly **one** call site in all 229 decompiled `.uc` files —
`Interface/TargetStatusWnd.uc:193/266`, feeding `SetNameWithColor` on the target window's
name control, never a plate. `NAME_COLOR` is now `#DCDCDC`, decoded from two
`?execSetName@…` sites in NWindow.dll.

This item is kept because it is the **proof that the method in this document works**: the
brief predicted it should surface, and it did, from data alone. `retail_gaps.py --prove`
runs the metric against `editor/world/js` at HEAD and the working tree and shows
`985 → 0`, which is the required both-directions demonstration on a real fix rather than a
synthetic one.

> **NEXT ACTION** — none for the colour. Do carry the same question to
> `ui/targetstatuswnd.js`: `TargetStatusWnd.uc:245-266` reaches `SetNameWithColor` only for
> attackable NPCs and not for `IsAllWhiteID` classes, so even the target window leaves
> merchants and other players at the default. Verify our target window honours that gate.

---

### 4. Every torch, brazier and lamp in the world is faked from a material-name regex — 91 real point lights per tile go undecoded

**Category: decoded-but-unwired (partially decoded, never extracted).**

`tools/world/convert.py:812-816` states it plainly:

> "NOT decoded by either path, and therefore still an open item: the 91 `Light`
> point-light actors per map (1,704 on 23_23), the `NSun` billboard, and the per-zone
> `AmbientVector` list — light_extract.py takes the terrain zone only. The client still
> invents torch lights from a material-name regex (`FLAME_MAT_RE` in terrain.js)."

Independently confirmed by an export census of `assets/interlude/maps/22_22.unr`
(Giran, 7,074 exports): **`Light` × 91**, `ZoneInfo` × 17, `NSun` × 1, `NMoon` × 1,
`SkyZoneInfo` × 1. `light.json` for that tile carries five keys — `ambient`, `fog`, `sun`,
`tile`, `zoneInfoIndex` — i.e. **one** sun and **one** zone's ambient out of 17.

Consequence a player sees: interiors and night-lit town corners are lit by a warm point
light that follows the camera (`main.js` `torch`), plus lights guessed from texture names,
instead of the fixed lamps the level designer placed.

> **NEXT ACTION** — extend `light_extract.py` to emit every `Light` actor
> (`Location`, `LightBrightness`, `LightHue/Saturation`, `LightRadius`, `LightEffect`) and
> the **per-zone** `AmbientVector` list keyed by `zoneInfoIndex` (already carried in
> `light.json` and read by nobody). Gate: `verify_torches.js` must assert the count of
> point lights in the live scene equals the count in `light.json`, and must go red when
> `FLAME_MAT_RE` is the only source.

---

### 5. Doors, lifts and drawbridges are static geometry — 553 `Mover` actors are converted as props

**Category: render surface.**

`convert.py:654` counts **553 `Mover` actors across the 100 converted maps** (10 in
22_22 alone) and folds them into `STATIC_MESH_ACTOR_CLASSES` — they render at keyframe 0
and never move. A `Mover` in UE2 carries `KeyPos[]/KeyRot[]`, `MoveTime`, `StayOpenTime`
and a trigger. None of it is extracted.

Player impact: castle gates, clan-hall doors and dungeon lifts are visible but frozen.
Ranked here rather than higher because Interlude towns have few interactive movers, but
it is the only item on this list that makes the world look *inert*.

> **NEXT ACTION** — a `movers` array in `scene.json` (new key; the contract is frozen for
> existing keys, so add, don't change) carrying keyframes and times, plus a client
> animator. Gate: `verify_props.js` asserts every mover in `scene.json` has ≥2 keyframes.

---

### 6. 106 of the 137 decoded retail windows have no surface at all — including the one the player sees every time they die

**Category: UI surface. Metrics `xdat_windows_unbuilt` = 106, `windowsinfo_docks_unused` = 35.**

`parse_xdat.py` recovered 137 windows and 1,962 controls into `interface.json`. The client
names **31**. The complement includes windows whose geometry is fully decoded:

| window | decoded | what the player loses |
|---|---|---|
| `RestartMenuWnd` | 128×128, 5 controls | **the death screen.** The client draws `#death-overlay` / `.death-box` instead: `border-radius: 10px`, `font: 14px -apple-system, "Segoe UI"`, `#e6eaf2` — an authored web panel |
| `ZoneTitleWnd` | 500×200, 3 controls | the zone name that fades in when you cross a border. `TTFontInfo.ini`'s **only enabled font** is literally `Font1=zonetitle / Tahoma / weight 700 / size 20 / Italic=False` — decoded, and the window that uses it does not exist |
| `SystemMsgWnd` | 348×125 | on-screen system messages |
| `OnScreenMessageWnd1..8` | 800×60 @ (50,150) | the big centre-screen announcements |
| `SkillTrainListWnd` / `SkillTrainInfoWnd` | 256×401 | learning skills from a trainer |
| `RecipeBookWnd` + 5 siblings | 256×401 | craft — matches the "craft/recipes not started" backlog item, and `recipe-c.dat` (23 KB) is in `system/` unreferenced |
| `PetStatusWnd` / `SummonedStatusWnd` | 176×46 | pet and summon HP |
| `ItemEnchantWnd` | 256×401 | enchanting |
| `HennaInfoWnd` / `HennaListWnd` | | dyes |
| `MacroListWnd` / `MacroEditWnd` | 256×401 @ (0,−56) | macros |
| `PartyMatchWnd` + 4 | 550×486 @ (0,76) | party matching |
| `TutorialViewerWnd` / `TutorialBtnWnd` | 310×401 | the tutorial the gateway already bridges (`verify-tutorial.js` PASS) has no viewer |
| `GametipWnd` | 6 controls | loading-screen tips |
| `DefaultInfoWnd` | 600×280 @ (0,48) | |
| `BoardWnd`, `PetitionWnd`, `DeliverWnd`, `SiegeInfoWnd`, `UnionWnd`, `CalculatorWnd`, `RefineryWnd` | | community board, petitions, mail, siege, alliance, calculator, augmenting |

The remainder are GM, Olympiad, Manor, EventMatch, Replay and Fishing — correctly out of
scope for a beta.

`windowsinfo.json` carries the retail opening position for **35** windows that do not
exist, mined and unusable.

**On the 31 that DO exist:** every one resolves its geometry from decoded data. Measured
per module — `Layout.window()` / `Layout.dock()` / `Layout.size()` / `Skin.content()`
appear in all 24 window modules; `npcdialog.js` + `npchtml.js` read `npchtml.json` (the
native `NCNPCHtmlViewer` rect); `tooltip.js` is a transcription of `Tooltip.uc` plus
NWindow.dll immediates. **No ported window is a CSS box.** What *is* authored is the
chrome around them — see item 9.

> **NEXT ACTION** — build `RestartMenuWnd` first: it is 5 controls, the geometry is
> decoded, the respawn op is already bridged, and it is the only window on this list every
> single player is guaranteed to see. Then `ZoneTitleWnd` (3 controls, and its font spec
> is already decoded). Gate each against `:8083`, not a preview page.

---

### 7. 100 character voice clips are extracted, staged, referenced by a decoded table, and can never play

**Category: decoded-but-unwired. Metric `skill_voices_unplayed` = 100.**

`skillsoundgrp.dat`'s `voice_cast[15]` and `voice_throw[15]` columns — per race and
gender — were decoded on 2026-08-09 into `assets/gamedata/skillsoundgrp.json`.
**362** records carry a cast voice, **404** a throw voice, over **100 distinct clips**
(`chrsound.m_hmagician_white`, `chrsound.f_elf_element`, …). All **100/100** are staged in
`assets/audio/manifest.json` under `assets/audio/sfx/chrsound*`.

`grep -rn voice_cast editor gateway` → **nothing**. Not the client, not the gateway, and
not `build_skillvfx.py` or `build_skillanim.py` either. This is the 94-footstep-sounds
shape, exactly, in data decoded eight days ago.

> **NEXT ACTION** — `gamesound.js` already has the cast phase (`spell_sounds[0]`,
> `MagicSkillUse`) and the client already knows the player's race and sex (`selfInfo`).
> Add a `voice` bank keyed by the `VOICE_SLOTS` order `parse_skillsoundgrp.py:108`
> documents, played at the same moment as the cast sound. Gate: extend
> `verify_skillphase.js` to assert a race-correct voice clip fires for a skill that has
> one and none for a skill that does not.

---

### 8. 50 shipped client data files and 198 decompiled `.uc` files are named nowhere

**Category: unmined. Metrics `system_files_unread` = 50, `uc_files_unread` = 198.**

> **A methodology note this audit had to earn.** The first version of the metric searched
> `.md` files too, and writing *this report* — a document about the unread files — dropped
> the count from 48 to 20 by merely naming them. The corpus is now code only
> (`.js/.py/.sh/.html/.json`), with `audit_report/` excluded outright, and the count rose
> to its true 50. Naming a file in a sentence is not reading it; a metric that cannot tell
> those apart can be closed by writing about it.

Both counts are **upper bounds on the gap and lower bounds on what is read**: a tool can
compose a filename at runtime (`creature_anim_table.py` builds `'<Package>.int'`, which is
why `LineageNpc.int` and `lineagemonster2.int` appear in the raw list yet *are* read).
Every entry below was checked by hand.

Genuinely unread, ranked by what they would change:

| file | size | what it holds |
|---|---:|---|
| `timeenv0..3.int` | 13–14 KB ea | item 1 above |
| `soulshot.int` | 1.7 KB | the shot effect mesh per **grade** (`None/D/C/B/A/S`) × 7 slots (`OnSticks`, `OnBooks`, `Atk`, `AtkCr`, `AtkDarkCr`, `SpiritOnSticks`, `SpiritOnBooks`) plus 8 weapon classes. `shots.json` carries only name/grade/kind — the visual is not sourced |
| `recipe-c.dat` | 23 KB | the craft recipe book |
| `raiddata-e.dat` | 29 KB | raid boss data |
| `optiondata_client-e.dat` | 96 KB | the OptionWnd's own option table |
| `huntingzone-e.dat` | 5.7 KB | hunting-zone names and level bands (the minimap/radar labels) |
| `ZoneName-e.dat` | 6 KB | **zone names** — the text `ZoneTitleWnd` would display |
| `staticobject-e.dat` | 2.5 KB | named static objects |
| `variationeffectgrp-e.dat` | | the augmentation/variation visual effects — the block `ui/tooltip.js` records as "RefineryOp1/2 are on the wire but the gateway drops them" |
| `entereventgrp.dat`, `logongrp.dat`, `hennagrp-e.dat` | small | login/event/dye tables |
| `TTFontInfo.ini` | 795 B | the `zonetitle` font spec, item 6 |
| `hair.int` | 111 KB | hair/accessory localized properties |
| `cloak.int` | 454 B | cloak cloth-sim constants (`SstK`, `Gravity`, `CollisionPlaneDist1`, …) |
| `helmetgrp.dat`, `hairgrp.dat`, `hairaccessarygrp.dat`, `hairaccessorylocgrp.dat` | small | helmet and hair attachment tables |
| `castlename-e.dat`, `servername-e.dat`, `commandname-e.dat`, `symbolname-e.dat` | small | name tables |
| `Localization.ini`, `chatfilter.ini`, `obscene-e.dat` | small | chat filtering |

The 198 unread `.uc` files are the same opportunity one level up. `Tooltip.uc` sat unread
in this tree until 2026-08-09 and turned out to hold the *entire* item-tooltip contract;
`OptionWnd.uc` is read and `AbnormalStatusWnd.uc` is read, but `RestartMenuWnd`'s,
`SkillTrainListWnd`'s and `RecipeBookWnd`'s scripts have never been opened — and each one
is the client's own answer for a window in item 6.

> **NEXT ACTION** — before building any window from item 6, read its `.uc` first. That is
> the cheapest lesson this project has learned twice. Start with
> `Interface/RestartMenuWnd.uc`.

---

### 9. The chrome around the retail UI is a web design — and the file's own rule has a counter-example

**Category: UI surface, unaudited.**

`editor/world/style.css`: 117 rules, **119 px literals, 73 hex colours, 18
`border-radius`, 7 `box-shadow`, 4 `linear-gradient`, 4 `transition`, and 15 uses of
`#c9a959`** — a gold `docs/HANDOFF.md` records as one **retail never uses**. Scanned by
neither audit tool.

The file's header is honest about most of this (dev shell, hover affordances, brand gold)
and ends with a rule: *"If a rule in this file starts positioning a RETAIL window, move
it."* Measured counter-example: `#death-overlay` / `.death-box` **is** a retail window —
`RestartMenuWnd`, 128×128, decoded, 5 controls — rendered as a rounded translucent box in
`-apple-system, "Segoe UI"`. `#cast-bar` and `.hp-bar-fill` are in the same position:
game-facing surfaces styled as web widgets while the server already sends `SetupGauge`
(`gameclient.js:747`).

> **NEXT ACTION** — teach `unsourced.py` to scan `*.css` (its span-scanner already handles
> comments; CSS needs only a third `spans_css`), so the 192 literals enter the same
> ledger. Then move the game-facing ids out of `style.css` behind `Skin`/`Layout` as their
> windows get built.

---

### 10. Verification: three suites cannot fail, one asserts against a preview page, and 122 of 125 cannot prove they go red

**Category: vacuous gates (task #46). Metric `suites_without_failpath` = 3.**

Across 98 `editor/world/verify_*.js` and 27 `gateway/test/verify*.js`:

* **Cannot exit non-zero at all** — `verify_app.js`, `verify_terrain.js`,
  `verify_hd_closeup.js`. All three are already accounted for in the repo, which the first
  draft of this section got wrong and is corrected here: HANDOFF §1 line 108 calls
  `verify_hd_closeup` "an A/B screenshot generator that needs a human eye" and
  `tools/battery.sh:248` lists it as a deliberate exclusion; `verify_app` and
  `verify_terrain` are IN the battery (`battery.sh:126,146`) and HANDOFF says outright
  they "assert nothing … smoke, not verification". So the finding is not "three hidden
  vacuous gates" — it is that **two of them run inside the battery and contribute a green
  row**, which is the part worth changing.
  *(Note on method: a naive scan reports `verify_app` as having a failure path because it
  **explains** in a comment why it avoids `process.exit()`. The metric strips comments
  first — a comment is evidence, not code.)*
* **`verify_npcdialog.js` still runs against `editor/world/npchtml-preview.html`** — its
  own header says so. This is the exact defect the brief describes as found last wave.
  `verify_npcdialog_live.js` exists alongside it, so the live assertion is *available*;
  what is missing is the preview suite saying it is not a client gate.
* **122 of 125 suites have no `--selftest` / `--prove` mode.** The three that do —
  `verify_anim.js`, `verify_tooltip.js`, `verify_loadprofile.js` (plus
  `verify_npcdialog.js --prove`) — are the only ones that have ever demonstrated they can
  go red. That is 2.4% of the battery.

**What I could NOT verify, and why it is not claimed here:** whether a given suite passes
*over an empty set*. I built a static detector for "all assertions live inside a loop with
no non-empty guard" and it produced 80 flags of which the hand-checked sample was mostly
false — different suites use different assertion vocabularies (`gate()`, `t()`, `step()`,
`failed.push()`), and a regex that catches all of them catches too much. Reporting those
80 would have repeated this project's signature failure: a real measurement welded to an
unexamined inference. **The decisive test is empirical** — run each suite with its
fixtures emptied and require it to go red — and it needs write access to
`editor/world/verify_shots/`, which this lane does not have.

> **NEXT ACTION** — one `--selftest` convention, adopted suite by suite, highest-traffic
> first: re-run the gates with the page's own data source monkey-patched to `[]` and
> REQUIRE red. `verify_tooltip.js` already demonstrates the pattern. Until a suite has
> one, treat its green as smoke.

---

### 11. Smaller unwired fields, all confirmed by name-level search of the runtime

**Category: decoded-but-unwired.**

| data | field | state |
|---|---|---|
| `assets/world/<tile>/audio.json` | `forcePlay`, `priority`, `musicId` | decoded per music volume; `worldaudio.js` picks `songs[0]` and documents that choice as unsourced — `priority`/`forcePlay` are retail's own tiebreak, sitting unread |
| `assets/world/<tile>/light.json` | `zoneInfoIndex` | written, never read; it is the key the per-zone ambient list (item 4) would join on |
| `assets/gamedata/skillclass.json` | `targetRules`, `aoe`, `kw`, `stLv`, 22 target-enum names (`AREA_CORPSE_MOB`, `FRONT_AURA`, `BEHIND_AURA`, …) | decoded in `fcf1bad`; the runtime reads the summary fields only |
| `assets/gamedata/skillsoundgrp.json` | `shot_sounds` (111 records), `exp_sounds` (4) | separate columns from `spell_sounds[1]/[2]`; no consumer names them, in the client or in any builder |
| `assets/gamedata/itemtip.json` | `sxd`, `sxid` | unread |

> **NEXT ACTION** — take these with the lane that owns each area rather than as a batch;
> each is a one-line read once someone is already in the file.

---

## 2. What was checked and found NOT to be a gap

Recorded so nobody spends a wave on it.

* **World particle emitters.** Hypothesis: the `.unr` maps carry `Emitter` actors for
  torch flames and waterfalls that we drop. **False.** An export census of 22_22 (7,074
  exports) finds **zero** emitter classes — the flame effects are `StaticMeshActor`s with
  additive materials, which the client already renders. Skill effects have a real UE2
  emitter player (`skillvfx.js`: 714 SpriteEmitter + 408 MeshEmitter + 13 VertMesh + 11
  Beam, with class defaults recovered from `Engine.u`).
* **Weather packets.** aCis Interlude ships no rain/snow packet. Weather in this client
  generation is environment-driven — which routes back to `EnvType` in item 1, not to the
  protocol.
* **Water.** `terrain.js` sources the plane, height, texture and pan rate
  (`FX_E_T fx_e_waterpan PanRate 0.7`) from the map's `WaterVolume` brushes. Whether
  retail adds a second layer is **not established either way** here, so no gap is claimed.
* **Fonts.** `largefont.gly` / `smallfont.gly` / `LargeFont-r.gly` / `SmallFont-r.gly`
  show as unreferenced; the client correctly uses the `-e` (English) variants. Not a gap.
* **`etcitemgrp.json`, `lineageeffect.json`, `skillfx.json`, `skillname.json`,
  `skillvisualeffect.json`** have no runtime reader — all five are build-time
  intermediates consumed by `tools/dat/*`. Not a gap.
* **`LineageNpc.int`, `lineagemonster2.int`** appear unreferenced to a literal-string
  search but are read by `creature_anim_table.py`, which composes the filename. Not a gap
  — and the reason the `system_files_unread` metric is documented as an upper bound.

---

## 3. Counts per category

| category | metric | count |
|---|---|---:|
| Unsourced literals | `unsourced_total` | 2,127 |
| … files above baseline | `unsourced_regressed_files` | 25 (14 new files / 11 grown) |
| Decoded, unwired: env tables | `timeenv_unread` | 4 |
| Decoded, unwired: clock | `daynight_unbridged` | 3 |
| Decoded, unwired: sky renderer | `sky_module_unwired` | 1 module, 333 lines |
| Decoded, unwired: voice audio | `skill_voices_unplayed` | 100 clips |
| Wired to the wrong source | `nameplate_red_permille` | 985 → 0 (fixed in flight) |
| Authored render rig | `authored_light_rig` | 4 light constructors |
| UI surfaces never built | `xdat_windows_unbuilt` | 106 of 137 |
| Mined docks with no window | `windowsinfo_docks_unused` | 35 |
| Client scripts never read | `uc_files_unread` | 198 of 229 |
| Client data never opened | `system_files_unread` | 50 (hand-verified subset in §1.8) |
| Gates that cannot fail | `suites_without_failpath` | 3 of 125 |
| Gates that can prove they go red | — | 3 of 125 |
| Client CSS audited by nothing | — | 119 px + 73 colours |

---

## 4. What this audit could not establish

1. **Whether any specific gate passes over an empty input set.** Static detection was
   attempted and abandoned as unreliable (§1.10). Needs execution with emptied fixtures.
2. **Whether the 31 built windows are pixel-correct.** This audit establishes only that
   each resolves geometry from decoded data. Correct *source* is not correct *result* —
   that needs pixel comparison against a retail capture, which this repo does not have.
3. **The `EnvType` → zone mapping** for `timeenv0..3`. The files decrypt and their
   sections are read; which zones select which file is not established.
4. **Whether `HSVBSPLight` actually selects among the 8 lightmap variants.** It is a
   candidate for `bsplight.py` KNOWN GAPS 1 with the right shape and cardinality
   (per-hour modulation vs 8 stored variants) — it is *not* a proof, and should be tested
   by comparing the 8 measured per-variant means against the HSV curve before anyone
   wires it.
5. **Whether `HemisphereLight` should simply be deleted.** It has no retail counterpart,
   but removing it changes every outdoor frame's exposure, and nothing here measures what
   `TerrainAmbient` + `SunColor` alone look like. Decide it with a before/after capture,
   not by reasoning.

*(A sixth item was here in the first draft — "is `verify_hd_closeup`'s missing failure
path a defect?" — and was withdrawn: HANDOFF and `battery.sh` both already answer it. It
is left recorded because the failure it nearly repeated is this project's signature one:
a correct measurement, an unchecked inference, written as one sentence.)*
