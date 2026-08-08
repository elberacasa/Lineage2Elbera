# Skill FX — decoded skill-presentation data (Interlude)

Where the retail client keeps everything about how a skill **looks and
sounds**, what we decoded from it, and what each piece maps to on disk.
Hard rule throughout: every visual in `skillfx.json` comes from decoded
retail data and verified files — nothing is authored. Where the data
stops, the entry says `missing`, never a substitute.

## Pipeline (all re-runnable, all with `--check`)

| Tool | Output | Source |
|---|---|---|
| `tools/dat/parse_skillsoundgrp.py` | `assets/gamedata/skillsoundgrp.json` | `system/skillsoundgrp.dat` (413) |
| `tools/dat/parse_skillfx.py` | `assets/gamedata/lineageeffect.json`, `assets/gamedata/skillvisualeffect.json` | `system/LineageEffect.u`, `animations/Skill.usk` (both Lineage2Ver111, decoded by `tools/l2lib`) |
| `tools/dat/build_skillfx.py` | `assets/gamedata/skillfx.json` (+ static-mesh export into `assets/library/`) | all of the above + `skillgrp.json`, `skillname.json`, `assets/library/manifest.json` |
| `tools/dat/build_skillanim.py` (pre-existing) | `assets/gamedata/skillanim.json` | skillgrp + skillsoundgrp join for the cast-time lookup |
| `tools/dat/build_skillvfx.py` | `assets/gamedata/skillvfx.json` (the browser index, §8) | lineageeffect + skillvisualeffect + skillfx |

## 1. skillsoundgrp.dat — sounds (1398 records)

Fully decoded before this task; see the header of
`tools/dat/parse_skillsoundgrp.py`. Per (skill_id, skill_level): 3 spell
sounds (cast / shot / explosion) with volume+radius, rarely-used
shot/exp triples, and 2×15 per-race/gender voice refs (`chrsound.*`).
**No animation names, no effect refs** — every string in the file parses
as a `SkillSound.*`/`chrsound.*` sound reference. Sounds verify against
the `.uax` packages in `assets/interlude/sounds/` (object-level check in
`build_skillfx.py`; 3 refs are dangling in the retail data itself:
`SkillSound2.antaras_creak`, `SkillSound4.doublewind_explotion`,
`SkillSound.fiend_wind_explotion`).

## 2. skillgrp.dat — the cast-animation selector (29812 records)

skillgrp's `animation` UNICODE field is the retail cast-anim selector:
single letters are native-code categories (`S` melee strike, `t`
dagger/bow precision, `V` dagger crit, `U` sonic/AoE, `Y` shield, `M`
polearm, `D` beneficial magic, `E` elemental nuke, `C` debuff, `X`
self-buff, `L` taunt/aura, `N` dance, `W` song, `i` summon...),
`Mix01`–`Mix09`/`MS01` are literal names, `''` = passive. The
letter→clip switch itself lives in native code (`APawn::SetSkillType`)
and is **not** in any data file.

What IS in data, cross-checked against `animations/Fighter.ukx`
(MeshAnimation name table) and `Engine.u`'s embedded `Pawn.uc` source:

- Physical skills play `SpAtk01`–`SpAtk28` / `Atk01`–`Atk03` per weapon
  (`SpAtk01_1HS_MFighter` etc. — present in the ukx). Which `SpAtkNN`
  each letter picks is native: **not recovered**.
- Magic casts play `CastShort` / `CastMid` / `CastLong` chosen by cast
  duration — the Pawn.uc Korean comments label them 1초미만 (<1s),
  2-5초, 5초이상 (5s+) — then `MagicThrow`/`Magicshot` at the shot.
  `build_skillfx.py` derives `castClip` from skillgrp `hit_time` with
  those thresholds (raw `hitTime` included so consumers can re-derive).
- Dances (`N`) play `Social_dance` exactly.
- All of these clips exist in the retail ukx but are **not** in the
  editor's shipped glTF sets (only idle/walk/run/sit/attack/dance,
  `editor/characters/manifest.json`) — clip conversion is a character
  pipeline matter, out of scope here.

## 3. Skill.usk — the explicit skill→effect binding (244 skills)

`assets/interlude/animations/Skill.usk` (UE2 package, Lineage2Ver111,
123/28) holds 244 `SkillVisualEffect` objects **named by skill id**
(`"110"`, `"1177"`, plus 5 variants `"4641_a"`, `"4641_b"`,
`"1217_sec"`, `"1031_sec"`, `"1012_sec"`) and 524
`SkillAction_LocateEffect` objects (both classes are defined in
`Engine.u`). Property streams use the UE1-style "packed" encoding
(`tools/l2lib/ue2package.py` §property tags); `TArray<struct>` data is a
compact count followed by **one full packed property stream per
element** (verified byte-exact on every array).

- `SkillVisualEffect`: `Desc` (Korean designer comment, e.g. 1040 →
  실드 "Shield"), `FlyingTime` (projectile seconds), and five action
  arrays: `CastingActions`, `ChannelingActions`, `PreshotActions`,
  `ShotActions`, `ExplosionActions` — each a list of
  `SkillActionInfo {Action, SpecificStage}`.
- `SkillAction_LocateEffect`: `EffectClass` → `LineageEffect.<class>`,
  `AttachOn` (byte, EAttachMethod — enum values not recovered, kept
  raw), `AttachBoneName`, `offset` (Vector), `SpawnDelay`, `bAbsolute`,
  `bUseCharacterRotation`, `bRelativeToCylinder`, `bSpawnOnTarget`,
  `bSizeScale`, `bOnMultiTarget`.

**Gotcha:** the LocateEffect object names are NOT unique
(`SkillAction_LocateEffect3` ×25) — `Action` refs are export indices and
must be resolved by index, never by name. (Getting this wrong silently
scrambles every binding; the parser asserts plausible anchors.)

Coverage: 239 numeric ids + 5 variants. Of the 2694 skills in
skillname: 236 explicit (129 of them "active" skills with a cast
animation; the rest passive/stance-type rows that still carry an
effect). This is the ONLY explicit per-skill effect table in the
client — `MobSkillAnimgrp.dat` (5463 records: npc id, skill id, anim
name like `spatk02`, mob name) covers mob cast animations, not effects;
`variationeffectgrp-e.dat` is augmentation (weapon variation) FX.

### 3a. Field semantics — how each one was CONFIRMED (2026-08-07)

The earlier pass recorded these fields but left their meaning open
("EAttachMethod enum not recovered", offsets kept raw). All of the
following is now pinned to evidence, not inference from names.

**The default-omission rule.** UE1/2 packed property streams omit any
value equal to the class default. So a boolean that appears with only
ONE value tells you the default is the other one. This single rule
settles every flag below, and it is falsifiable — if a flag ever shows
both values the reading is wrong. Counts over all 3709 emitters / 524
actions:

| Property | Serialised as | ⇒ default | Consequence |
|---|---|---|---|
| `UseColorScale` | true ×1563, never false | **false** | the 2141 emitters holding a `ColorScale` but no flag have their ramp **ignored by the engine** |
| `AutomaticInitialSpawning` | false ×3586, never true | **true** | `false` = no instant pool fill; particles still trickle in at `InitialParticlesPerSecond` |
| `RespawnDeadParticles` | false ×3026, never true | **true** | `false` = emit `MaxParticles` total, then stop |
| `FadeIn` / `FadeOut` | true only | **false** | fade envelope applies only where stated |
| `UniformSize` | true ×2149, never false | **false** | 1560 emitters size X and Y independently |
| `bRelativeToCylinder` | false ×31, never true | **true** | offsets are FRACTIONS of the collision half-height |

**`AttachOn` is EAttachMethod** — read out of `Engine.u`'s `Enum`
export (not guessed from the name table, whose order is arbitrary):
`[EAM_None, EAM_RH, EAM_LH, EAM_BoneSpecified, EAM_AliasSpecified,
EAM_Trail, EAM_RF, EAM_LF]` = ordinals 0–7. **Confirmed against the
data**: values 3 and 4 carry an `AttachBoneName` in 21 of 21 cases,
value 5 in 1 of 401 — exactly what `BoneSpecified`/`AliasSpecified`
vs. a non-bone method predicts. `EParticleDrawStyle` came from the same
export: `[Regular, AlphaBlend, Modulated, Translucent,
AlphaModulate_MightNotFogCorrectly, Darken, Brighten]` = 0–6.

**`offset` units.** Two regimes, and they separate perfectly:
every action explicitly flagged `bRelativeToCylinder=false` (30 of them)
carries a large offset (−20.5, −70, −81, ±280 uu), and **no** small
offset is ever so flagged. With the default being *true*, a plain
offset is a fraction of the collision half-height — which is why the
single commonest value in the whole table, `(0, 0, −1)` on 201 cast
auras, means "one half-height below centre" = **at the caster's feet**,
where retail cast auras appear. (UE measures from the cylinder CENTRE;
the client's entity groups sit at the feet, so the renderer lifts by a
half-height before applying the offset.)

**Phase comes from the ARRAY, never the name suffix.** `wh_heal_ta`
sits in `ShotActions` while `el_wind_strike_ta` sits in
`ExplosionActions`, so the `_ta` suffix predicts nothing on its own.
`PreshotActions` is empty across all 244 objects; the live arrays are
casting 241, shot 159, explosion 17, channeling 3.

**Anchor skills, confirmed end to end** (each matches its well-known
retail appearance):

| Skill | Casting | Shot | Explosion | Reading |
|---|---|---|---|---|
| 1177 Wind Strike | `el_wind_strike_ca` at the feet + `el_wind_strike_pr` (`bUseCharacterRotation`) | `el_wind_strike_fl`, `FlyingTime` 0.4 s | `el_wind_strike_ta` `bSpawnOnTarget` | cast aura, charge held in front, bolt flies 0.4 s, burst on the target |
| 1011 Heal | `wh_heal_ca` at the feet | `wh_heal_ta` `bSpawnOnTarget`+`bOnMultiTarget` | — | aura under the caster, burst on the healed target, no projectile |
| 1040 Shield (self-buff) | `wh_heal_ca` — the SHARED white-magic cast aura | `wh_shield_ta` on target | — | same cast aura as Heal, different target effect: the tables really do reuse `_ca` classes across a family |
| 1085 Acumen | `su_empower_ca` | `su_acumen_ta` | — | support-family aura + target effect |

The Shield/Heal pair is the useful confirmation: two different skills
sharing one `_ca` class but differing in `_ta` is exactly the retail
behaviour (every white-magic buff opens with the same aura), and it
rules out any "one effect per skill" misreading.

**Two decoder bugs found and fixed while confirming the above:**
- `ColorScale` elements are `{RelativeTime, Color}`; the parser read
  `c.get("Time")` and so dropped **every** ramp time — all 10032 stops
  came out `t: null`, reducing each ramp to an unordered colour set.
- `skillfx.json`'s `colors` union ignored `UseColorScale`, so it listed
  colours from 2141 emitters the engine never tints with.

## 4. LineageEffect.u — the effect classes (864 classes, 3709 emitters)

`system/LineageEffect.u` (Lineage2Ver111, 123/30). 864 classes:
`at_power_strike_cs`, `el_wind_strike_ta`, `wh_heal_ca`, ... plus
event/world effects (`teleport_*`, `aden_*`, `Quest_NPC_001`,
numbered `e_uNNN`/`m_uNNN`/`w_uNNN`/`s_uNNN` families). Each class owns
emitter subobjects (2411 SpriteEmitter, 1232 MeshEmitter, 36
VertMeshEmitter, 29 BeamEmitter, 1 RibbonEmitter). Decoded per emitter
into `lineageeffect.json`: `texture` / `mesh` refs (resolved to
`Package.Object`), `colors` (the `ColorScale` ramp: `[{t, "#rrggbbaa"}]`
— these ARE the retail colors), `opacity`, `maxParticles`, `lifetime`,
`startSize`, `particlesPerSecond`, `autoSpawning`, `drawStyle`,
`velocity`, `spin`.

Naming convention: `<prefix>_<family>_<suffix>` — prefix = magic family
(`at` attack, `el` elemental, `wh` white magic, `bl` black, `su`
support, `mo` motion/self, `ph` song/dance, `sp` special, `dw` dwarf,
`it` item, `mb`/`mu`/`bo` monster, ...), suffix = presentation slot
(`ca` cast aura, `cs` cast shot, `co` channeling, `fl`/`pr`/`ra`/`sp`
projectile, `ta`/`to`/`tc` target). Suffix→phase mapping verified
against the Skill.usk explicit bindings.

**Fallback binding (name-convention):** 126 skills' sanitized display
name matches an effect-class family; prefixes never collide within a
family (verified across all 864 classes), so the match is unambiguous.
79 of the 126 also have explicit Skill.usk entries (which win). The
remaining 47 (43 of them clan-buff duplicates like 4344 "Shield"
reusing `wh_shield_*`, plus Power Strike → `at_power_strike_cs`) are
emitted with `"binding": "name-convention"` so the client can weigh
them. The native fallback code path itself is not in any data file
(no name literals exist in the DLLs — the names are constructed at
runtime), hence the explicit flag.

**Unbound classes:** 630 of 864 classes (mostly the numbered
`e_u`/`m_u`/`w_u`/`s_u` families and event effects) are referenced by
neither Skill.usk nor any name match, and carry no cross-references
from other emitters. Their trigger is native/event code — present in
`lineageeffect.json` as decoded data, not bound to skills.

## 5. skillfx.json — the consumable map (2694 skills)

```jsonc
"1177": {
  "name": "Wind Strike",
  "anim": {"code": "E", "magic": 1, "range": 600, "hitTime": 4.0,
           "castClip": "CastMid"},        // omitted for physical (native SpAtkNN)
  "snd": {"cast": {"ref": "SkillSound.wind_strike_cast",
                   "file": "assets/interlude/sounds/skillsound.uax"}, ...},
  "effects": {
    "binding": "explicit",               // | "name-convention" | null
    "phases": {"casting": ["el_wind_strike_ca", "el_wind_strike_pr"],
               "shot": ["el_wind_strike_fl"],
               "explosion": ["el_wind_strike_ta"]},
    "flyingTime": 0.4,                   // when Skill.usk states it
    "textures": ["LineageEffectsTextures/fx_m_t0000.png", ...], // library-relative, EXIST
    "meshes": ["LineageEffectsStaticmeshes/StaticMesh/windblowin00.pskx", ...],
    "colors": ["#ffffffff", ...]         // union of emitter ColorScale colors
  },
  "missing": ["effect-binding" | "sound:<ref>" | "mesh:<ref>" | "texture:<ref>"]
}
```

Every `snd.file` is verified to contain the referenced Sound object;
every texture/mesh path is verified on disk (`--check` re-verifies all
of them + JSON freshness). Full spawn parameters (attach, offsets,
delays, per-emitter particle params) stay in
`skillvisualeffect.json` / `lineageeffect.json` — join on the class
names when needed.

## 6. Asset inventory (deliverable 2)

**Textures — 242/242 resolve.** All distinct texture refs from the 3709
emitters were already exported in `assets/library/`
(`LineageEffectsTextures/` 484 `fx_m_t*` PNGs, `LineageEffectsTextures2/`,
`FX_E_T/`, `fx_m_t/`). Zero exports needed; `manifest.json` coverage
verified object-by-object.

**Static meshes — 211 of 225 resolve.** Distinct refs:
`LineageEffectsStaticmeshes` 198, `LineageEffectMeshes` 14, `FX_E_S` 11,
`fx_m_s` 2. `build_skillfx.py` exports the meshes used by bound skills
via `umodel -export` into `assets/library/<Package>/StaticMesh/*.pskx`
(+ `.props.txt`) — currently 108 pskx, all from
`LineageEffectsStaticmeshes.usx` (the FX_E_S/fx_m_s meshes belong to
unbound event classes). The 14 `LineageEffectMeshes.*` refs are UE2
**VertMesh** objects (`animations/LineageEffectMeshes.ukx`) which umodel
cannot export — they appear in entries' `missing` lists (7 distinct
meshes, 21 skill references: `swirl`, `magic2`, `water00`, `Water01`,
`linetail60frm[_red]`, `selfblaster`). Converting VertMesh is follow-up
tooling.

**Sounds — all but 3 refs resolve** (see §1).

## 7. The four anchor skills, end to end

| Skill | Anim | Sounds | Effect binding | Assets |
|---|---|---|---|---|
| 3 Power Strike | `S`, physical (SpAtkNN native) | `power_strike_cast`/`_shot` ✓ | **name-convention**: `at_power_strike_cs` (casting) | 1 texture, 2 meshes ✓ |
| 1216 Self Heal | `D`, CastLong (hit 5.0s) | `heal_cast`/`heal_shot` ✓ | **none** — `missing: ["effect-binding"]` (`wh_heal_*` exists but no data binds it; NOT substituted) | — |
| 1177 Wind Strike | `E`, CastMid (hit 4.0s) | `wind_strike_cast`/`_shot`/`_explotion` ✓ | **explicit** (Skill.usk): ca+pr casting, fl shot (fly 0.4s), ta explosion | 4 textures, 4 meshes ✓ |
| 1040 Shield | `D`, magic | `shield_cast`(l1) etc. | **explicit**: casting `wh_heal_ca` (shared cast aura), shot `wh_shield_ta` | textures+meshes ✓ |

## 8. skillvfx.json — the browser index, and the renderer

`tools/dat/build_skillvfx.py` (`--check`) joins §3+§4 into
`assets/gamedata/skillvfx.json`, **199 KB** — small enough to ship,
against 14 MB of source tables. Strings are interned exactly as
`tools/audio/build_audio.py` does for its sound bindings: one `tex`
table of texture paths, one `fxn` table of effect-class names, and every
record holds indices.

```jsonc
{"tex": ["LineageEffectsTextures/fx_m_t0000.png", ...],   // 127
 "fxn": ["el_wind_strike_ca", ...],                       // 237 classes
 "fx":  [{"e": [ /* packed sprite emitters */ ],
          "skip": {"MeshEmitter": 2}}],                   // what was dropped
 "skill": {"1177": {"b": 1,                // 1 = explicit, 2 = name-convention
                    "f": 0.4,              // FlyingTime
                    "c": [{"f": 61, "g": 4, "o": [0,0,-1]}],   // casting
                    "s": [...], "x": [...], "h": [...]}}}      // shot/expl/chan
```
Action `g` is a bitmask: 1 `bSpawnOnTarget`, 2 `bOnMultiTarget`,
4 `bSizeScale`, 8 `bUseCharacterRotation`, 16 `bAbsolute`, 32 offset is
in world uu (i.e. `bRelativeToCylinder` explicitly false). Emitter keys
are short because they repeat: `t` texture, `n` MaxParticles, `l`
lifetime, `z`/`zy` StartSize X/Y, `o` Opacity, `r` ColorScale ramp
(**only when `UseColorScale` is set**), `m` ColorMultiplier, `v`
velocity, `a` acceleration, `d` DrawStyle, `fi`/`fo` fade times, `u`
texture subdivisions, `sh`/`sl`/`sr`/`so` start-location shape/box/
sphere/offset. A **missing key means the engine default**, which the
client applies — nothing is defaulted into the file.

`editor/world/js/skillvfx.js` plays them: a UE2 SpriteEmitter subset on
camera-facing **instanced quads** (not `gl_POINTS` — 1560 emitters size
X and Y independently, e.g. `el_wind_strike_fl`'s 8×80 uu streaks, which
a square point cannot express). It reads the ring of inbound net
messages once per frame rather than registering a handler, because
`NetClient` keeps one handler per op and `window.__world.net` is a
read-only facade — so no edit to `main.js` is needed.

**Blending is sourced, not chosen.** umodel exports every
`LineageEffectsTextures` PNG as **RGB with no alpha channel**, and the
art is glow sprites on black — `fx_m_t0000` is a 4×4 grid, exactly the
`TextureUSubdivisions/VSubdivisions` the data states for it. So
luminance is the coverage and the additive path is what that art is
drawn for; only `PTDS_Modulated`/`PTDS_Darken` differ.

### Coverage (honest numbers)

| Bucket | Count |
|---|---|
| Skills known to `skillfx.json` | 2695 |
| Bound to a retail effect | **290** (244 explicit Skill.usk + 46 name-convention) |
| …of those, actually DRAW ≥1 sprite emitter | **284** |
| …bound but nothing drawable (mesh/beam-only classes) | 6 (1111, 2003, 2166, 323, 3632, 4380) |
| **Render NOTHING — no binding in any retail table** | **2405** |
| Of the 798 *active* (castable) skills: drawing | 129 |
| Of the 798 *active* skills: no sourced effect | 665 |

Emitters on the 237 bound classes: **714 SpriteEmitters rendered**,
**447 dropped** — 413 MeshEmitter, 13 VertMeshEmitter, 11 BeamEmitter,
10 sprites whose texture was never staged.

### What is NOT reproduced, and why

- **MeshEmitter (413)** — needs the `LineageEffectsStaticmeshes`
  geometry; the client has no `.pskx` loader. This is the biggest gap
  and it is visible: Wind Strike's bulk (`windknifewave00`,
  `windknifeball00`) is mesh, so what renders is its sprite trail, not
  the full retail bolt.
- **VertMeshEmitter (13)** — UE2 VertMesh, which umodel cannot export
  at all (§6).
- **BeamEmitter (11) / RibbonEmitter** — procedural beam geometry whose
  segment parameters are not decoded.
- **Bone/hand attachment** — `EAM_RH/LH/BoneSpecified` is decoded, but
  attaching to a character bone needs a skeleton lookup in
  `character.js`, which this worker does not own. Everything anchors to
  the actor root + offset instead.
- Emitter behaviour beyond the listed fields (`VelocityLossRange`,
  `SizeScale` curves, `RevolutionsPerSecond`, subdivision animation) is
  decoded into `lineageeffect.json` but not yet played.

## 9. What's portable to the web vs. what needs research

Portable today (decoded, verified): cast-anim selection rules + clip
names; full per-skill effect binding (244 explicit + 47 convention);
effect class → texture/mesh/color/opacity/particle-count/lifetime/size;
all 242 textures as PNG; 108 static meshes as pskx (+ props); all
sounds as verified uax refs (uax → wav/ogg conversion already covered by
the sound pipeline); projectile flight times; attach/offset/delay spawn
parameters.

Needs particle-system research / tooling: UE2 emitter *behavior*
porting (beam/ribbon/vertex emitters, color-over-life already decoded
but blend modes/`DrawStyle` semantics, velocity/size ramps beyond the
headline fields — the raw property streams are all in
`lineageeffect.json` for exactly this work); VertMesh conversion (14
meshes); the native letter→`SpAtkNN` switch and the native fallback
effect-naming code path (both live in compiled DLL code, no data
presence); conversion of the 630 unbound event/numbered effect classes
if the world renderer ever needs them.
