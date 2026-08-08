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
| `tools/dat/dump_emitter_classes.py` | printed (nothing on disk) — the *evidence* for §4b | `system/Engine.u`: the emitter classes' `.uc` ScriptText **and** their class-default property streams |
| `tools/dat/build_skillmesh.py` | `assets/gamedata/skillmesh.json` + `skillmesh.bin` (§4d) | the umodel `.pskx` exports under `assets/library/<pkg>/StaticMesh/` + `LineageEffectsStaticmeshes.usx` for material packages |

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

### 4b. Engine.u still ships the emitter classes — source AND defaults (2026-08-08)

Everything above about "what a field means" and "what an absent field
defaults to" used to be inferred from value counts across the data. It
does not have to be. `system/Engine.u` carries, for every emitter class:

- the **UnrealScript source**, in a `TextBuffer` export named `ScriptText`
  hanging off the `Class` export, and
- the **class-default property stream**, at the tail of the `Class`
  export body.

`tools/dat/dump_emitter_classes.py` prints both (`--check` asserts the
15 defaults and 8 zero-value flags the rest of the pipeline relies on).
The defaults are located by searching for the one offset at which a
packed property stream parses cleanly **and ends exactly on the last
byte of the export body** — a self-checking parse, since a wrong offset
desyncs within a few properties.

What that gives us, as retail bytes rather than inference:

| Class | Default | Consequence |
|---|---|---|
| `ParticleEmitter.MaxParticles` | 10 | |
| `ParticleEmitter.LifetimeRange` | 4.0 | |
| `ParticleEmitter.Opacity` | 1.0 | |
| `ParticleEmitter.RespawnDeadParticles` | **true** | confirms the omission-rule reading |
| `ParticleEmitter.AutomaticInitialSpawning` | **true** | idem |
| `ParticleEmitter.UseRegularSizeScale` | **true** | `false` (1047×) = honour the authored `SizeScale` RelativeTimes |
| `ParticleEmitter.CoordinateSystem` | 1 = `PTCS_Relative` | particles follow the emitter — which is what the client already did |
| `ParticleEmitter.DrawStyle` | **3 = `PTDS_Translucent`** | the 812 emitters that omit DrawStyle are NOT `PTDS_Regular`; and 0 really is authored 31× |
| `ParticleEmitter.SpinCCWorCW` | (0.5, 0.5, 0.5) | a coin flip per axis |
| `ParticleEmitter.StartSizeRange` | **100** | a sprite quad is 100 uu = 1 m by default |
| `MeshEmitter.StartSizeRange` | **1.0** | **a mesh particle's size is a SCALE, not a length** |
| `MeshEmitter.UseMeshBlendMode` | **true** | `false` (1182×) = use the emitter's `DrawStyle` instead of the mesh material's |
| `VertMeshEmitter` | same two + `RenderTwoSided` true | |

and, absent from every default stream (so: the zero value):
`UseParticleColor`, `MeshEmitter.RenderTwoSided`, `UseColorScale`,
`UseSizeScale`, `UniformSize`, `FadeIn`, `FadeOut`, `SpinParticles` —
every one of which the value-count inference had already called `false`.
Nothing contradicted; several things now *proved*.

Two decoded fields the earlier pass dropped entirely and this one added
to `lineageeffect.json`: **`SizeScale`** (`array<ParticleTimeScale>
{RelativeTime, RelativeSize}`, the size-over-life curve, gated on
`UseSizeScale`) and **`SizeScaleRepeats`**. They matter: 559 of the 724
bound SpriteEmitters and 311 of the 413 bound MeshEmitters set
`UseSizeScale`, and 549 / 295 of those carry a curve that is not flat —
so before this, every one of them held its `StartSize` for its whole
life.

### 4c. What a MeshEmitter specifies (2026-08-08)

From the recovered declaration:

```unrealscript
class MeshEmitter extends ParticleEmitter native;
    var (Mesh) staticmesh  StaticMesh;
    var (Mesh) bool        UseMeshBlendMode;   // default TRUE
    var (Mesh) bool        RenderTwoSided;     // zero value -> FALSE
    var (Mesh) bool        UseParticleColor;   // zero value -> FALSE
    var transient vector   MeshExtent;
```

**Four authored fields, and nothing else.** Lifetime, spawn mode,
start location, velocity, acceleration, size, spin, colour and fade are
all inherited `ParticleEmitter` and mean exactly what they mean on a
sprite. So the mesh path is not a second particle system — it is the
same simulation with a different primitive, which is how
`skillvfx.js` implements it (one `Particles` base class, two draw
subclasses).

**Size is a scale.** Proved twice: `MeshEmitter` overrides
`StartSizeRange` from 100 to 1.0 in its class defaults (§4b), and
mesh-bbox × StartSize over the 391 bound mesh emitters with staged
geometry gives a median extent of **51 uu** and a p90 of **205 uu** —
half a metre to two metres, right for a ~50 uu character. Read as world
units the same numbers give a median of 0.26 uu = 2.6 mm.

**The spin components are not the identity map.** `StartSpinRange` and
`SpinsPerSecondRange` are rangevectors in **revolutions** (max 5.0 over
the whole table; stops at 0.25 / 0.75 only read as quarter turns), and
their X/Y/Z components map to **yaw / pitch / roll**, i.e. rotation
about UE **+Z / +Y / +X**. Established against geometry, not assumed: of
the 132 emitters whose mesh is an unambiguous disc of revolution and
whose spin is on exactly one component, **118 are flat in Z and spin on
component X**, and 10 are flat in X and spin on component Z — 128 of 132
spin about their own **normal** under that map, versus 8 of 132 under
the identity. The retail anchor agrees: `wh_heal_ca`'s
`magiccirclewhite01` is a 435 × 435 × 15 uu disc spinning on component X
at 0.07 rev/s — the slowly turning white magic circle under every
healer, which only turns in its own plane under this map and would
tumble edge-over-edge under the identity. And `windknifeball00`, the
Wind Strike bolt (256 uu long on X), spins on component **Z** at 2 rev/s
= about its own flight axis.

**Mesh particles are NOT tinted — a sourced decision.**
`UseParticleColor` is false by default and set on only 5 of the 413
bound mesh emitters. The falsifying case is `el_prominence_fl`:
Prominence is a fire skill, its `spirit_fire00` mesh is textured with
`fx_m_t0066` whose bright pixels average **(204, 113, 70)** orange, and
the emitter carries `ColorMultiplierRange (0.269, 1.0, 1.0)` — applying
that multiplier turns the fire core **(55, 113, 70)**, dark green. So the
mesh's own retail texture is the colour, and `r`/`m` are emitted for a
MeshEmitter only when `UseParticleColor` is set.

**The one thing NOT recovered here:** whether the native renderer still
applies the `Opacity × FadeIn/FadeOut` *alpha* envelope when
`UseParticleColor` is false. The client applies it — 377 of the 413
bound mesh emitters set `FadeOut` explicitly and 290 set `Opacity`, and
without it a mesh particle pops out of existence at the end of its
lifetime — but that is a choice, recorded here, not a decoded fact. It
can only change transparency, never colour.

### 4d. skillmesh.json / skillmesh.bin — the geometry

`tools/dat/build_skillmesh.py` decodes the umodel `.pskx` exports of the
**108 distinct static meshes** the 408 drawable bound MeshEmitters name
(all `LineageEffectsStaticmeshes`) into one index + one blob:

- `skillmesh.json` (12 KB): interned texture table (80 paths) + per-mesh
  `{v0, nv, s:[{i0, n, t}]}` — vertex range and one submesh range per
  material slot, plus `texa` (does the PNG carry an alpha channel).
- `skillmesh.bin` (255 KB): `[positions f32×3][uvs f32×2][indices u16]`,
  10 562 vertices / 8 393 triangles for the whole set.

Positions are converted to the client's proper basis exactly as the
character pipeline does — umodel's psk exporter mirrors on Y
(`ExportPsk.cpp MIRROR_MESH`), so psk `(px, py, pz)` is UE
`(px, -py, pz)` and the emitted point is `(px, pz, py) × 0.01`, with the
wedge triple reversed to `(w0, w2, w1)` to undo the winding flip that
mirror causes. Material packages come from the `.usx` (the psk `MATT`
chunk carries only the object name); the builder asserts the psk slot
names match the `.usx` `Materials` array element for element, so a
per-face `MatIndex` can never select the wrong texture silently.

That basis is **proved, not asserted**: `--check` re-exports one mesh
through umodel's *own* glTF exporter and compares. umodel's glTF map is
`(x, y, z) → (x, z, y)`, determinant −1; ours is `(x, z, −y)`,
determinant +1; the two differ by exactly `diag(1, 1, −1)`. Result on
`windknifeball00`: **95/96 vertices are negate-Z of umodel's export and
87/90 triangles match with the same winding, 0 reversed** — the same
relationship `build_weapons.py` verified for the static character path.
(The stragglers are duplicate-position wedges that the rounding key
collapses.)

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
**VertMesh** objects (`animations/LineageEffectMeshes.ukx`); they appear
in entries' `missing` lists (7 distinct meshes, 21 skill references:
`swirl`, `magic2`, `water00`, `Water01`, `linetail60frm[_red]`,
`selfblaster`). **Correction (2026-08-08): umodel exports them fine** —
`umodel -export -game=l2 LineageEffectMeshes.ukx swirl` writes
`swirl_d.3d` + `swirl_a.3d`. What is missing is a `.3d` decoder, not an
exporter; see §8 "What is NOT reproduced".

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
`assets/gamedata/skillvfx.json`, **357 KB** — small enough to ship,
against 14 MB of source tables. Strings are interned exactly as
`tools/audio/build_audio.py` does for its sound bindings: one `tex`
table of texture paths, one `fxn` table of effect-class names, and every
record holds indices.

```jsonc
{"tex": ["LineageEffectsTextures/fx_m_t0000.png", ...],   // 127
 "texa": [0, 1, ...],                                     // PNG has alpha?
 "msh": ["windknifeball00", ...],                         // 108 mesh names
 "fxn": ["el_wind_strike_ca", ...],                       // 237 classes
 "fx":  [{"e": [ /* packed sprite AND mesh emitters */ ],
          "skip": {"VertMeshEmitter": 1}}],               // what was dropped
 "skill": {"1177": {"b": 1,                // 1 = explicit, 2 = name-convention
                    "f": 0.4,              // FlyingTime
                    "c": [{"f": 61, "g": 4, "o": [0,0,-1]}],   // casting
                    "s": [...], "x": [...], "h": [...]}}}      // shot/expl/chan
```
Action `g` is a bitmask: 1 `bSpawnOnTarget`, 2 `bOnMultiTarget`,
4 `bSizeScale`, 8 `bUseCharacterRotation`, 16 `bAbsolute`, 32 offset is
in world uu (i.e. `bRelativeToCylinder` explicitly false). Emitter keys
are short because they repeat: `t` texture, `n` MaxParticles, `l`
lifetime, `z`/`zy`/`zz` StartSize X/Y/Z, `zs`/`zr` SizeScale curve +
repeats (**only when `UseSizeScale` is set**), `o` Opacity, `r`
ColorScale ramp (**only when `UseColorScale` is set**), `m`
ColorMultiplier, `v` velocity, `a` acceleration, `d` DrawStyle,
`fi`/`fo` fade times, `u` texture subdivisions, `sp` SpinParticles with
`q0`/`qs`/`qw` StartSpin / SpinsPerSecond / SpinCCWorCW,
`sh`/`sl`/`sr`/`so` start-location shape/box/sphere/offset. A **missing
key means the engine default**, which the client applies — nothing is
defaulted into the file. A **MeshEmitter** additionally carries `k: 1`,
`g` (index into `msh`), `ts` RenderTwoSided, `mb` UseMeshBlendMode and
`pc` UseParticleColor, and has no `t`: its texture comes from the mesh's
own material via `skillmesh.json`.

`editor/world/js/skillvfx.js` plays them. One `Particles` base class runs
the shared UE2 `ParticleEmitter` simulation and two subclasses draw it:
sprites as camera-facing **instanced quads** (not `gl_POINTS` — 1560
emitters size X and Y independently, e.g. `el_wind_strike_fl`'s 8×80 uu
streaks, which a square point cannot express), meshes as instanced
copies of the static-mesh submeshes loaded by
`editor/world/js/skillmesh.js`. It reads the ring of inbound net
messages once per frame rather than registering a handler, because
`NetClient` keeps one handler per op and `window.__world.net` is a
read-only facade — so no edit to `main.js` is needed.

**Blending and coverage are sourced, not chosen.** `DrawStyle`'s class
default is `PTDS_Translucent` (3), read from `ParticleEmitter`'s default
stream (§4b), so the 812 emitters that omit it are translucent — and the
art is glow sprites on black (`fx_m_t0000` is a 4×4 grid, exactly the
`TextureUSubdivisions/VSubdivisions` the data states), so
Regular/AlphaBlend/Translucent/Brighten all draw additively; only
`PTDS_Modulated`/`PTDS_Darken` differ.

Per-texture coverage is now read from the files rather than assumed. The
earlier claim that "umodel exports every `LineageEffectsTextures` PNG as
RGB with no alpha channel" is **wrong**: 33 of the 127 sprite textures
and 10 of the 80 mesh textures are PNG colour type 6 (RGBA), and on
`fx_m_t0054`, `fx_m_t0035`, `fx_m_t0071`, `fx_m_t0099` the RGB is bright
everywhere while the SHAPE lives entirely in alpha — 0.0 % of pixels
have a dark RGB and 60–90 % have alpha < 8. Luminance-as-coverage paints
those as solid rectangles. The index therefore carries `texa` (from each
file's IHDR colour type) and the shader uses alpha where there is one,
luminance where there is not.

One arithmetic bug fixed while doing it: `THREE.AdditiveBlending` is
`(SRC_ALPHA, ONE)`, so the fragment's contribution is `rgb × a`. The
shader multiplied `Opacity` into *both* terms, squaring it and dimming
every emitter with an authored `Opacity` (813 of them) by that value a
second time.

### Coverage (honest numbers, 2026-08-08)

| Bucket | Count |
|---|---|
| Skills known to `skillfx.json` | 2695 |
| Bound to a retail effect | **290** (244 explicit Skill.usk + 46 name-convention) |
| …of those, actually DRAW ≥1 emitter | **290** |
| **Render NOTHING — no binding in any retail table** | **2405** |
| Of the 798 *active* (castable) skills: drawing | 129 |
| Of the 798 *active* skills: no sourced effect | 665 |

Emitters on the 237 bound classes — **1122 of 1161 rendered, 39
dropped**:

| Emitter class | On bound classes | Rendered | Dropped |
|---|---|---|---|
| SpriteEmitter | 724 | **714** | 10 (texture never staged) |
| MeshEmitter | 413 | **408** | 5 (`StaticMesh` left at its None default) |
| VertMeshEmitter | 13 | 0 | 13 |
| BeamEmitter | 11 | 0 | 11 |

(The previous pass rendered 714 and dropped 447. The six skills listed
then as "bound but nothing drawable" — 1111, 2003, 2166, 323, 3632,
4380 — were mesh-only classes and now draw.)

### What is NOT reproduced, and why

- **VertMeshEmitter (13 emitters, 7 distinct meshes:** `swirl` ×6,
  `water00` ×2, `Water01`, `magic2`, `selfblaster`,
  `linetail60frm[_red]`**)** — the older claim that "umodel cannot
  export VertMesh at all" is **false**: `umodel -export
  LineageEffectMeshes.ukx swirl` writes `swirl_d.3d` + `swirl_a.3d`,
  the classic Unreal vertex-mesh pair. The layout checks out
  arithmetically on `swirl` (48-byte `FJSDataHeader` + `NumPolys`=128 ×
  16-byte `FJSMeshTri` = 2096 bytes exactly; 4-byte `FJSAnivHeader`
  `NumFrames`=31 / `FrameSize`=456 = 114 verts × 4-byte packed
  `FMeshVert` = 14 140 bytes exactly). What is still missing is a `.3d`
  decoder **and** the mesh's `Scale`/`Origin`, which live in the `.ukx`
  body rather than the `.3d` file. Scoped follow-up, not a dead end.
- **BeamEmitter (11) / RibbonEmitter** — the parameters ARE decodable
  now that `Engine.u`'s `BeamEmitter` declaration is recovered
  (`BeamDistanceRange`, `BeamEndPoints`, `DetermineEndPointBy`,
  low/high-frequency noise, branching), but the tessellation that turns
  them into vertices is native code. Not approximated.
- **Bone/hand attachment** — `EAM_RH/LH/BoneSpecified` is decoded, but
  attaching to a character bone needs a skeleton lookup in
  `character.js`, which this worker does not own. Everything anchors to
  the actor root + offset instead. `bUseCharacterRotation` IS now
  applied (the effect spawns in the actor's rotation frame).
- Emitter behaviour beyond the listed fields (`VelocityLossRange` — 309
  sprites / 79 meshes, `RevolutionsPerSecond`, `CoordinateSystem` other
  than the `PTCS_Relative` default — 77 emitters, subdivision animation)
  is decoded into `lineageeffect.json` but not yet played.
- **Projectile orientation is a rendering decision, not data.** No field
  states the flying actor's rotation, so the travelling instance is
  yawed to put its local UE +X along the flight vector. It only became
  visible with the mesh path (`windknifeball00` is 256 uu long on X and
  spins about that axis), and an unrotated bolt flies sideways.

## 9. What's portable to the web vs. what needs research

Portable today (decoded, verified): cast-anim selection rules + clip
names; full per-skill effect binding (244 explicit + 47 convention);
effect class → texture/mesh/color/opacity/particle-count/lifetime/size;
all 242 textures as PNG; 108 static meshes as pskx (+ props) AND as
browser geometry (`skillmesh.bin`); all
sounds as verified uax refs (uax → wav/ogg conversion already covered by
the sound pipeline); projectile flight times; attach/offset/delay spawn
parameters.

Needs particle-system research / tooling: beam/ribbon tessellation
(parameters decodable, geometry native); a `.3d` decoder plus the
VertMesh `Scale`/`Origin` out of the `.ukx` body (7 meshes, 13
emitters); the remaining decoded-but-unplayed emitter behaviour
(`VelocityLossRange`, `RevolutionsPerSecond`, non-default
`CoordinateSystem`, subdivision animation — the raw property streams are
all in `lineageeffect.json` for exactly this work); the native
letter→`SpAtkNN` switch and the native fallback
effect-naming code path (both live in compiled DLL code, no data
presence); conversion of the 630 unbound event/numbered effect classes
if the world renderer ever needs them.
