# The unsourced-value inventory

Every numeric and colour literal in the client and the tool chain, classified
by whether anything ties it to a decoded origin.

Produced by `tools/audit/unsourced.py` (re-runnable, `--check`-gated). Three
supporting probes were written to settle specific questions and are listed at
the end. **Nothing in this pass modified a file it did not create.**

Generated 2026-08-08 against the working tree as it stood that morning. Two
things in it were moving while it ran; both are flagged where they matter.

---

## 0. Read this before the table

The recurring failure mode named in `docs/HANDOFF.md` §5 is *a correct
measurement welded to an unexamined inference*. This report tries hard not to
add another one, so it separates three things everywhere:

- **Measured** — what a tool read out of a binary, and which tool.
- **Inferred** — what that implies, labelled, with what would falsify it.
- **Not settled** — said plainly, rather than filled with something plausible.

Two findings below are *negative results*: places where the audit expected to
find invented numbers on screen and proved they were not. Those took as much
work as the positives and they matter just as much, because acting on the
false version would have wasted a wave.

### Counts

| bucket | count | share |
|---|---:|---:|
| BENIGN | 5,438 | 66.4% |
| SOURCED | 291 | 3.6% |
| AUTHORED | 238 | 2.9% |
| **UNSOURCED** | **2,225** | **27.2%** |
| TOTAL | 8,192 | |

UNSOURCED by domain — the ranking dimension that matters:

| domain | UNSOURCED | what a wrong value does |
|---|---:|---|
| tool-pipeline | 979 | bakes into an asset; silent when wrong |
| client-ui | 370 | on screen, in front of the player, always |
| client-world | 349 | on screen while playing |
| tool-parser | 338 | format mechanics; fails loudly |
| tool-test | 157 | assertions |
| client-audio | 32 | audible |

**751 of the 2,225 are in the client** — the part a player experiences
directly. That is the working set for the next wave.

### What the buckets mean, and their honest error bars

`SOURCED` means *a comment attached to this literal cites a decoded origin*.
It is a claim about evidence proximity, **not** a verification that the value
is right. Spot-checking found several SOURCED verdicts resting on a comment
about a neighbouring constant. Treat SOURCED as "someone said where this came
from", and re-check before relying on it.

`AUTHORED` (238) is not absolution. For a 1:1 replica an admitted invention is
still an invention; it is just an honest one. Several of the worst colour
offences below are in this bucket.

`BENIGN` is the bucket that had to be earned. It was tuned until a random
25-sample of client hits contained no false negatives. Two real tuning bugs
were found and fixed during that process, and both are recorded in the source:

- the `%` in a neighbouring `width:100%` was excusing `padding:9px` as integer
  arithmetic — CSS strings are now exempt from that rule;
- the evidence window was originally 14 lines, which let `audio.js` inherit the
  word "retail" from a comment about a different constant three statements
  away. It is now the *attached* comment only: trailing on the line, the
  contiguous block above, or a data table's own header (`chat.js`'s channel
  table would otherwise have read as 15 unsourced colours despite a six-line
  citation directly above it).

---

## 1. Ranked findings

Ranked by what a player would actually see, not by count.

| # | finding | where | uses | status |
|---|---|---|---:|---|
| 1 | The sky is invented; retail's is decodable | `main.js:78-79` | 2 | **true value found** |
| 2 | The UI gold is a colour retail never uses | 12 UI files | 45 | **true value found** |
| 3 | 79% of client colours have no retail counterpart | client-wide | 149 | **quantified** |
| 4 | `Layout.color()` is wired to 650 decoded colours and called twice | client-wide | — | **wiring gap** |
| 5 | `parse_xdat.py`'s type gate discards 58 decodable colours | `parse_xdat.py:444` | 58 | **true value found** |
| 6 | The audio cull distance now truncates every NPC and 176 skill sounds | `audio.js:91` | 1 | **defect, sourced fix** |
| 7 | Character-height fallbacks are in the wrong unit system | 5 files | 9 | **defect, 1 live path** |
| 8 | Two golds one RGB unit apart | `#c9a959`/`#c8a959` | 45 | **proof of hand-authoring** |
| 9 | Head/label anchor multipliers: 1.1, 1.2, 1.25, 2.2 | 4 files | 6 | **unsourced** |
| 10 | Interior lighting rig entirely invented | `main.js:157-161` | 6 | **unsourced** |
| — | *`Layout.*() \|\| {literal}` fallbacks render invented geometry* | — | — | **FALSE — see §3** |
| — | *`RADIUS_UNIT = 25` is the open question* | — | — | **STALE — see §3** |

---

## 2. The top findings in full

### 1. The sky — `main.js:78-79` — TRUE VALUE FOUND

```js
const SKY_ZENITH  = new THREE.Color(0x33415e);   // unsourced
const SKY_HORIZON = new THREE.Color(0x93a5bd);   // unsourced
```

This gradient fills the upper half of the screen on every outdoor tile.
`worldlight.js` replaced the client's invented fog and ambient with the map's
own ZoneInfo values but does not touch the sky, so this is what renders.

**Measured.** `assets/interlude/maps/skylevel.unr` (200,319 bytes, present) is
a complete level: `SkyZoneInfo0`, `NSun0`, `NMoon0..4`, seven textured brushes.
It imports from `L2_Skies` a ColorModifier named **`SkybackgroundColor`**.
Reading that export's `Color` property out of
`assets/interlude/textures/l2_skies.utx` (protocol 121, decoded with the repo's
own `utxedit.decode_121`) gives bytes `(206, 150, 0, 255)`.

FColor serialises B,G,R,A — the same order `docs/ui-mined-native.md` §2
established for the chat colour dwords mined from NWindow.dll. So:

| | current | retail |
|---|---|---|
| sky background | `#33415E` zenith / `#93A5BD` horizon | **`#0096CE`** |

**Why this is a complete decode and not a tint over an unknown.** A
ColorModifier multiplies a material. `SkybackgroundColor`'s material resolves
to the texture `WhiteChip`, and `assets/library/l2_skies/WhiteChip.png` is
32×32 with `getcolors()` returning exactly one entry: all 1,024 pixels are
`(255,255,255,255)`. White × colour = the colour. There is no residual
unknown in this one.

**Corroboration for the byte order**, kept separate from the measurement: under
B,G,R,A the background reads as sky blue and `HazeRing_Final` — the glow ring
around the sun — reads as warm yellow `#FFE495`. Under R,G,B,A they would be
orange and cyan respectively, which is backwards for both.

The rest of the dome is also available and unextracted: `Cloud_Final`
`#FFC097` over the `Cloud` texture, `HazeRing_Final` `#FFE495` over `HazeRing`,
`StarField_Final01/02`, `Sun01`, `Default_Moon`, `Flare01..06`,
`TexUPanSpeed`/`TexVPanSpeed` `0.2` on the SkyZoneInfo, and a nine-element
`LensFlare` array with its own offsets and scales. Those tint non-flat
textures, so their rendered result is texture × colour — **not** settled to a
single value here.

Reproduce: `python3 tools/audit/probe_sky.py --check`.

### 2. The UI gold — 45 sites — TRUE VALUE FOUND

`#c9a959` (35 uses) and `#c8a959` (10 uses) are the client's button-label,
header and highlight gold, across `clanwnd`, `tradewnd`, `shopwnd`,
`storewnd`, `warehousewnd`, `multisellwnd`, `questwnd`, `inventorywnd`,
`entities.js` and `main.js`.

**Measured.** Neither appears anywhere in either decoded colour source:

- `assets/gamedata/interface.json` — 708 control colours decoded from
  `Interface.xdat`, 22 distinct values;
- `assets/uscript/**/*.uc` — 132 literal RGB triples, 39 distinct values,
  harvested by `tools/audit/uscript_colors.py`.

Retail's tan/gold is unambiguous and heavily repeated:

| source | value |
|---|---|
| `Interface.xdat`, 121 controls | `#B09B79` (176, 155, 121) |
| `DetailStatusWnd.uc:361` `PledgeNameColor` | (176, 155, 121) |
| `SSQMainBoard.uc` ×6 `infNodeItem.t_color` | (176, 155, 121) |
| `ClanWnd.uc:1187` `Gold` | (176, 153, 121) |
| `ClanDrawerWnd.uc:1429` `DarkYellow` | (175, 152, 120) |
| `TargetStatusWnd.uc` `PledgeNameColor` | (176, 152, 121) |
| **client** | **`#C9A959` (201, 169, 89)** |

Distance from `#C9A959` to the nearest retail colour is 43 in RGB. Retail's is
a muted tan; the client's is a saturated yellow-gold. **The client already uses
`#B09B79` correctly in 8 places** — so it disagrees with itself, which is the
strongest evidence that the gold was typed rather than decoded.

Reproduce: `python3 tools/audit/uscript_colors.py --hex '#B09B79'`.

### 3. Client colours against the retail palette — QUANTIFIED

Union of both oracles = 52 distinct retail colours. Against the client's
189 six-digit hex uses:

| | distinct | uses |
|---|---:|---:|
| in the retail palette | 12 | 40 (21%) |
| **not in it** | **48** | **149 (79%)** |

Worst offenders, with nearest retail neighbour and RGB distance:

| uses | client | nearest retail | dist |
|---:|---|---|---:|
| 35 | `#C9A959` | `#B09B79` | 43 |
| 12 | `#E8DCC0` | `#DCDCDC` | 30 |
| 10 | `#C8A959` | `#B09B79` | 42 |
| 9 | `#E8E8E8` | `#F0F0F0` | 14 |
| 9 | `#8A93A5` | `#A0A0A0` | 26 |
| 7 | `#E8E0D0` | `#DCDCDC` | 17 |
| 7 | `#5A5344` | `#4A5C68` | 40 |
| 4 | `#C8B98A` | `#E4CA7F` | 35 |
| 2 | `#D8D8D8` | `#DCDCDC` | **7** |

The last one is worth a second's attention: `#D8D8D8` is 7 units from
`#DCDCDC`, the single most common colour in the entire retail UI (310 xdat
controls). It is almost certainly a mistyping of it.

### 4. `Layout.color()` — the wiring gap

This is the pattern `docs/HANDOFF.md` warns about by name: *"data was already
correctly extracted and simply never wired up."*

| | count |
|---|---:|
| control colours decoded and shipped in `interface.json` | 650 |
| `Layout.color()` call sites in the whole client | **2** |
| hard-coded hex colours in `editor/world/js/ui/` alone | 164 |

The two call sites are `detailstatuswnd.js:303` and `shortcutwnd.js:460`.
`Layout.align()` has 1 call site; `Layout.textId()` has 2. The read side of the
decode exists, is correct, and is essentially unused.

### 5. `parse_xdat.py`'s type gate discards 58 colours — TRUE VALUES FOUND

`tools/xdat/parse_xdat.py:444` attempts the colour decode only for
`rec["type"] == "TextBox"`. Running the module's own `parse_text_block` over
every record instead:

| type | records | with a decodable colour |
|---|---:|---:|
| TextBox | 658 | 650 *(emitted today)* |
| EditBox | 53 | 25 *(discarded)* |
| ItemWindow | 37 | 33 *(discarded)* |

The 25 EditBox colours all read `#FFFFFF` — the retail text-input colour, which
the client currently paints `#e6eaf2` (`chat.js:325`) among others.

**Not settled, and I am not going to pretend otherwise:** the 33 ItemWindow
records all decode to the identical `#FFD8F1`, a pink. Perfect uniformity
across 33 records and an implausible colour together suggest the signature is
matching something that is not a colour in ItemWindow's tail, even though the
alpha==255 acceptance test passes. **Do not adopt the ItemWindow values.** The
EditBox result is corroborated by its plausibility and its variety of textIds;
the ItemWindow result is not corroborated by anything.

**Buttons carry no colour at all** — no Button record matched. So finding #2's
true value does *not* come from the xdat for button labels specifically; it
comes from the `.uc` sources and from the xdat's overwhelming use of `#B09B79`
for the same role. That distinction is deliberate: the measurement is "retail's
tan is #B09B79 in 121 controls and 31 script assignments"; the inference is
"button labels use it too", and that inference is *not* proven here.

### 6. `CULL_DISTANCE_M` now truncates real audio — `audio.js:91` — DEFECT

```js
const CULL_DISTANCE_M = 120;
...
const cull = Math.min(CULL_DISTANCE_M, maxDistance);
if (d2 > cull * cull) return;
```

Unsourced, and it became wrong when `RADIUS_UNIT` was corrected from 25 to 50
(see §3). Audible range is now `radius × 50 × 0.01` metres:

| table | radius | audible | culled at |
|---|---:|---:|---:|
| `npcgrp.json` — **all 6,519 records** | 250 | 125 m | 120 m |
| `skillsoundgrp` — 15 records | 800 | 400 m | 120 m |
| `skillsoundgrp` — 11 records | 600 | 300 m | 120 m |
| `skillsoundgrp` — 150 records | 250 | 125 m | 120 m |

Every NPC sound in the game now has its outer 5 m silently removed, and 176
skill-sound entries lose up to 70% of their reach.

**The sourced fix is to delete the constant, not to raise it.** Under the
linear model that `audio.js`'s own header derives from ALAudio.dll, gain is
`1 - d/(R×50)` and reaches exactly zero at `maxDistance`. `maxDistance` is
therefore already the exact inaudibility cutoff; `Math.min` with a second
number can only truncate it. Cull at `maxDistance` and the constant disappears.

### 7. Character-height fallbacks are in the wrong unit system — DEFECT

`editor/characters/scale-report.json` is authoritative: `anchorHumanMale:
46.0` L2 units, `worldToMeters: 0.01`. So a rendered human is **0.46** units
tall in scene space, and `character.js:214`'s authoritative path computes
exactly that (`nativeHeight * L2_TO_M`).

But five files carry fallbacks in a different unit system:

| site | value | correct |
|---|---|---|
| `character.js:9` `CHAR_HEIGHT` | 1.75 | ~0.46 |
| `camera.js:123` `setScale(1.85)` | 1.85 | ~0.46 |
| `main.js:403,409` `heightM \|\| 1.75` | 1.75 | ~0.46 |
| `entities.js:478,480,577` `\|\| 1.75` | 1.75 | ~0.46 |
| `skills.js:350,352` `\|\| 1.7` | 1.7 | ~0.46 |

Three different numbers for one quantity, all ~3.8× too large.
`entities.js:201` uses `0.46` for its placeholder capsule — the correct
magnitude — which again shows the codebase disagreeing with itself.

**How live is it?** Mostly dead: `heightM` is set from the measured bounding
box after load, and 14/14 characters plus 494/495 monsters carry
`nativeHeight`. **One path is live**: `Evilate_m00` in
`editor/characters/monsters/manifest.json` has no `nativeHeight` (and no
animations — it looks like a failed build), so it takes the `CHAR_HEIGHT =
1.75` normalisation, whose `k < 0.5 || k > 2.5` guard will fire and scale it to
roughly 4× its correct size.

### 8. Two golds one RGB unit apart

`#c9a959` (201,169,89) is used for text; `#c8a959` (200,169,89) for outlines.
One unit apart in R. No decode produces two values one unit apart for the same
design intent — this is two people typing the same remembered colour, and it is
the cleanest single proof in the repo that the palette was hand-authored.

### 9. Head and label anchor multipliers

`heightM × 1.1` (eye/head position, `main.js:403,409`, `entities.js:577`),
`× 1.2` (`entities.js:478`), `× 1.25` (`entities.js:232`), `× 2.2`
(torch, `main.js:2099`). Four different multipliers for "somewhere above the
head", none sourced. Retail's own anchor is the mesh's head bone, which the
character pipeline already resolves — `docs/character-pipeline.md` and the
face-shell re-anchoring note in HANDOFF §5 both show the bone is available.

### 10. Interior lighting rig — `main.js:157-161`

```js
scene.fog = new THREE.Fog(0x0a0806, 6, 220);
ambient.color.setHex(0x6a5138); ambient.intensity = 1.15;
hemi.color.setHex(0x5a4630); hemi.groundColor.setHex(0x1a140e); hemi.intensity = 1.7;
torch = new THREE.PointLight(0xffb070, 0, 60, 1.3);  // intensity 3.2 when interior
```

Eleven unsourced values governing how every dungeon looks. `worldlight.js` did
this job properly for outdoors — same actors (`ZoneInfo`, `NMovableSunLight`)
exist in the dungeon tiles, and `light_extract.py` already runs on all 100.
The outdoor path reads `light.json`; the interior path ignores it entirely and
substitutes this rig.

Note the same file's outdoor fog `new THREE.Fog(SKY_HORIZON, 60, 420)` — 60 m
to 420 m, against the Engine.ZoneInfo defaults of 3,000–8,000 L2 units = 30–80
m that `worldlight.js` decoded. That one is harmless because `worldlight.apply()`
overwrites it on tile load, but it is the pre-load frame the player sees first.

---

## 3. Two claims that did not survive checking

Both of these were expected findings. Reporting them as findings would have
sent the next wave after nothing.

### The `Layout.*() || {literal}` fallbacks are dead — NOT a defect

`tools/ui/audit_guesses.py` exempts this shape as "a defensive fallback for
missing data". That exemption is only valid when the lookup succeeds — if
`Layout.size()` returns null, the literal is what renders. Nobody had checked
which case each site was in, and the shape accounts for roughly 60 apparent
UNSOURCED literals in prime UI real estate.

`tools/audit/fallback_reach.py` resolves each site against the shipped
`interface.json` using `Layout`'s own indexing rules (flat last-wins for a bare
name, path index for a slashed one), including dynamic control names:

> **53 guarded lookups: 0 LIVE, 53 DEAD.**

Every one resolves. `ChatWnd` really is 348×187 in the xdat; `ShopWnd/TopList`
really is 239×139; the grid fallback `{cellX:32, cellY:32, gapX:5, gapY:3}` is
exactly the decoded `InventoryItem` grid. The literals are unreachable. The
same holds for `?? 0.296875` in `terrain.js:73` and `neighbors.js:222/305/340`
— all 100 `scene.json` files carry `heightScale: 0.296875`.

They should still be replaced by citations rather than numbers, but that is
hygiene, not a rendering defect. **Ranked out of the top 20 deliberately.**

Getting here took two corrections to my own probe, both recorded in its source:
a type gate (it was feeding `Layout.grid` the names of OK/Cancel buttons and
calling the misses failures) and a proximity window (a whole-file scan blamed
`statuswnd.js:179` for a control name that site never receives). Both produced
confident false positives first.

### `RADIUS_UNIT = 25` — STALE PREMISE, already solved

The brief presents this as the open question, citing `audio.js`'s own header:
*"RADIUS_UNIT IS THE ONE UNSOURCED CONSTANT IN THIS FILE."*

**Both halves of that are now false.**

The constant is `50`, not `25`, and it is decoded. Another agent solved it in
the working tree while this audit ran. The mechanism: ALAudio.dll (the shipped
OpenAL driver, an unpacked PE) imports two float globals from Core.dll —
`?GAudioMaxRadiusMultiplier@@3MA` at .data rva 0x1352EC = **50.0f** and
`?GAudioDefaultRadius@@3MA` at 0x1352F0 = **80.0f** — and dereferences the
multiplier against the source radius at nine call sites, writing
`clamp(volume × (R×M − d) / (R×M), 0, 1)` to `AL_GAIN`. That is linear falloff
to zero at `R×50`, not the inverse-square curve the file used to apply.

I did not take this on trust. `python3 tools/audio/verify_falloff.py` re-reads
both globals from the DLLs and re-checks the client against them: **12 checks,
0 failed.** It stands.

The *other* half — "the one unsourced constant in this file" — was false when
written and is still false. `unsourced.py` finds **16** in `audio.js`: the
mixer defaults `{master 0.7, music 0.35, sfx 0.8, ambient 0.45, ui 0.6}`, the
`0.02` gain smoothing, the `2.0`/`0.05` music crossfade, the `radius = 50` and
`radius = 80` call-site defaults, and `CULL_DISTANCE_M = 120` — which finding
#6 shows is not merely unsourced but now actively wrong.

`VOLUME_SCALE = 1/255` remains genuinely open, and the header says so
correctly: ALAudio has a second gain path scaling a byte by 0.04 and another
running it through a log curve, and which one consumes SoundVolume is not
proven. **That is the real open audio question, not RADIUS_UNIT.**

---

## 4. The tool chain

979 UNSOURCED in `tool-pipeline` is the largest bucket and the least urgent,
because most of it is format mechanics that fail loudly. Two caveats:

- `tools/world/convert.py` (157) and `tools/src/char_pipeline/assemble.py` (57)
  are **not** parsers — they bake values into shipped assets, where a wrong
  number is silent and permanent. These deserve the same treatment the UI got.
- `tools/utx/utxedit.py` (114), `tools/l2lib/ue2package.py` (67) and
  `tools/l2lib/textures.py` (51) are dominated by UE2 format constants
  (`TEXF_DXT3 = 7`, `SUPPORTED_VERSION = 117`, DXT block arithmetic). Those are
  fixed by the format and effectively sourced; they are UNSOURCED only because
  no comment says so. Fixing them means adding citations, not changing values.

---

## 5. Reproducing all of it

```bash
python3 tools/audit/unsourced.py                  # counts + top files
python3 tools/audit/unsourced.py --rank 40        # top 40 by visual impact
python3 tools/audit/unsourced.py --list UNSOURCED --file js/audio.js
python3 tools/audit/unsourced.py --json out.json  # machine-readable
python3 tools/audit/unsourced.py --check          # regression gate, exit 1 on growth

python3 tools/audit/probe_sky.py --check          # the sky colour (finding 1)
python3 tools/audit/uscript_colors.py             # retail palette (findings 2, 3)
python3 tools/audit/probe_xdat_colors.py --check  # the type gate (finding 5)
python3 tools/audit/fallback_reach.py --check     # fallback reachability (§3)
```

`unsourced.py --check` compares against
`tools/audit/unsourced_baseline.json` (122 files, 2,225 UNSOURCED) and exits
non-zero if any file's count grows, so the bucket can only shrink. Verified
both ways: it reports `main.js: 102 -> 107` on an injected regression and
exits 0 clean.

`probe_sky.py --check` pins `SkybackgroundColor == #0096CE` **and** re-verifies
that `WhiteChip` is still a flat white texture — because if that ever stops
being true, the decode stops being complete and the value stops being usable.

---

## 6. Suggested order of work

None of this was applied — these files have other owners.

1. **Sky** (`main.js:78-79`) — biggest visible surface, exact value in hand.
2. **Gold** — one find-and-replace of `#c9a959`/`#c8a959` → `#B09B79` fixes 45
   sites; the client already uses the right value in 8 places.
3. **`CULL_DISTANCE_M`** (`audio.js:91`) — delete it, cull at `maxDistance`.
   Currently truncating every NPC sound in the game.
4. **Wire up `Layout.color()`** — 650 decoded colours, 2 call sites. Widen
   `parse_xdat.py`'s type gate to EditBox first (+25 colours); leave ItemWindow
   alone until someone corroborates `#FFD8F1`.
5. **Interior lighting** — `light.json` already exists for all 100 tiles.
6. **Character-height fallbacks** — unify on `nativeHeight × L2_TO_M`; give
   `Evilate_m00` a height or drop it.
7. **`convert.py` / `assemble.py`** — the silent asset-baking pipelines.
