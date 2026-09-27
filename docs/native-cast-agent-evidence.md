# Elbera Tools: native casting Agent and exact effect binding

The scheduler's `Agent + 0x74` is **SkillVisualEffect.FlyingTime**. Agent
selection uses the exact skill-level record's **qualified object path**, not
the skill ID. This closes the input-identity gap in the
[ordinary casting equations](native-cast-scheduler-evidence.md).

## Reproduce

```sh
python3 tools/ui/check_cast_agent_native.py --check
python3 tools/ui/check_cast_agent_native.py --json
python3 -m unittest discover -s tools/ui -p test_cast_agent_native.py
```

The verifier checks 67 native instruction anchors, derives the property
layout from original declarations and Core linking rules, decodes the owned
DAT afresh, and joins original qualified package paths. Eight source-free
tests reject leaf aliases, missing exact metadata, duplicate properties,
cyclic outers, and silent reinterpretation of unresolved paths as no Agent.
No binary executes, and no source/binary dump or generated asset is emitted.

| Original input | SHA-256 |
| --- | --- |
| `system/engine.dll` | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| `system/core.dll` | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| `system/Engine.u` | `9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761` |
| `system/skillgrp.dat` | `4e245e914048cee34ada7fb6ed6b499976cbe961ad5bd0a8bfdcf00a1e2288d9` |
| `animations/Skill.usk` | `30b9a60d2a27c12d7fb9826a38772b3932c4ad66ab5f0638e8128813898463f5` |

Paths are relative to private `assets/interlude/`. Engine uses base
`0x10300000`, Core `0x10100000`. The shared reader uses the pinned,
[sentinel-derived Engine recovery](native-skill-animation-evidence.md);
imported call instructions erased by the protector remain a stated limit.

## Why +0x74 is FlyingTime

Engine.u declares seven direct properties of `Engine.SkillVisualEffect`.
The serialized UField next-reference chain, not a guessed source-text order,
connects them. Each property export is read within its own bounds, including
its reflected type and array dimension.

Core's exported `UNameProperty::Link` (RVA `0x719f0`) sets element size 4;
`UArrayProperty::Link` (`0x721d0`) sets size 12; `UFloatProperty::Link`
(`0x71510`) sets size 4. Each aligns the current owning structure size to
four bytes and writes that field offset. `UStruct::Link` at
`0x35ef1`–`0x35efb` advances structure size by offset + element size × count,
then follows the next field at `0x35f01`.

The native `USkillVisualEffect` constructor independently addresses its
first member at `+0x34` (`0xea99d`). Applying the original linking rules gives:

| Original property | Reflected type | Native offset |
| --- | --- | --- |
| Desc | NameProperty | `0x34` |
| CastingActions | ArrayProperty | `0x38` |
| ChannelingActions | ArrayProperty | `0x44` |
| PreshotActions | ArrayProperty | `0x50` |
| ShotActions | ArrayProperty | `0x5c` |
| ExplosionActions | ArrayProperty | `0x68` |
| FlyingTime | FloatProperty | `0x74` |

Generated native assignment `USkillVisualEffect::operator=` (RVA `0xa77f0`)
independently copies the five array starts and then performs a float load
from `+0x74` and store to `+0x74` at `0xa7841`/`0xa7845`. The scheduler reads
that same offset at `0x1ef667`. The conclusion therefore rests on reflected
property identity, native linking rules and actual compiled field accesses.

The original class default stream contains only the terminating None token:
class export offset 249301, length 94, SHA-256
`90dbe4eda5a6b7e9b287b31bbe5c3e19305026bdbe1c0bb6ecd230c06fd02e16`;
validated default stream offset 93, length 1. No FlyingTime override exists.
Core `UObject::InitProperties` zeroes initial property storage after the
`0x34`-byte object prefix; its helper at `0x8420` explicitly writes zero
DWORDs/bytes. The native class constructor adds no float assignment.
An omitted FlyingTime tag therefore retains **0.0**, distinct from an
unresolved source object. Only 16 of the 244 owned Agent objects serialize a
FlyingTime override. Preserve the decoded Float32 value without decimal
rounding when using it in the scheduler.

## DAT field identity and Agent presence

The current decoder historically called skillgrp's second string
`description`. That label is wrong: it is the **skill_visual_effect** source
object reference, not player-facing descriptive text.

This is independently established in both original load paths:

1. `FL2GameData::MSItemDataLoad` opens `Skillgrp.dat` and calls record
   serializer stub `0x366b` at `0x16e319`; `MSItemDataSave` calls the same
   serializer at `0x16f34b`.
2. The serializer body `0x14e890` processes the three consecutive strings
   at record `+0x40`, `+0x44`, `+0x48` (RVA `0x14e93d`–`0x14e956`). They
   follow eight four-byte fields, matching the bounded DAT decoder.
3. The text-column path names `animation`, `skill_visual_effect`, and
   `icon`; the literal `skill_visual_effect` at `0x1089a370` is loaded at
   `0x16e5fd` and its interned name index stored to `+0x44` at `0x16e619`.
4. The binary string reader (`0x14c100`) reads a four-byte byte length,
   then the string. Zero length constructs the zero/None name rather than
   borrowing another skill's object.

`APawn::SetMagicInfo` at `0x1f2840` first calls `FNMagicInfo::Clear(1)`, which
zeros Agent (`0x8e6a9`). It uses supplied skill data or looks up the requested
ID and level. `GetMSData` at `0x1781a0` compares the requested level at
`0x1781f8`, returns only a matching record, and returns null after exhausting
the candidates; it does not choose the first level instead.

The effect path at record `+0x44` is compared with the native `none` name.
That branch goes directly to normal setup at `0x1f2994`, leaving Agent null.
Otherwise, the function attempts to obtain a `USkillVisualEffect`, checks the
returned object's class and stores its pointer. If the first attempt fails,
it tries a second path; a null or invalid second result is stored as null.
The class argument is the exported
`USkillVisualEffect::PrivateStaticClass` at `0x10bdeee0`.

The first erased imported call's surviving arguments match Core's exported
`StaticFindObject(Class, ANY_PACKAGE, name, false)` signature; the second
matches `StaticLoadObject(Class, null, name, null, 0, null)`. Their precise
import targets are erased, so these function names describe the supported
signature/control-flow interpretation, not a recovered live call address.
The source path, class filter, two attempts, result tests and Agent stores
remain directly visible.

When Agent is null, `InitSkillProcess` takes its native cast-style lead
branch at `0x1ef665`. When Agent exists, it reads FlyingTime and applies the
minimum/style rule already documented in the scheduler evidence. A missing
browser export is **not evidence** that the original client takes the
Agent-null branch.

## Measured binding coverage and consequences

Fresh decoding of all 29,812 original skill-level rows gives:

| Result | Rows |
| --- | ---: |
| Empty/None original binding | 17,576 |
| Qualified path resolves to an owned Skill.usk object | 12,094 |
| Nonempty source path absent from that package | 142 |

Of the 12,236 nonempty references, **7,930 rows across 758 skill IDs name an
object whose leaf differs from the skill ID**. Five IDs have level-dependent
paths: 58, 2036, 4032, 4544 and 5008. The 244 owned objects have unique full
paths; 13 are unreferenced by this original skillgrp table.

Examples:

- Skill 21 level 1 points to `Skill.wh.1012`, shared with skill 1012. Looking
  up object `21` loses that explicit source binding.
- Skill 1177 level 1 has an empty binding. A same-ID object exists in
  Skill.usk, but its existence does not authorize selecting it as this cast's
  Agent. Other original legacy-effect paths are a separate investigation.
- Skill 58 changes between `Skill.wh.1011` and `Skill.wh.1217` by level;
  an ID-only binding cannot represent it faithfully.

The 142 unresolved rows name 14 unique paths. The verifier reports them
verbatim. They remain **unresolved source references**, not confirmed native
lookup failures: this static join does not execute the original loader,
package redirects or complete original runtime state.

## Runtime implementation boundary

Preserve the source path with exact ID/level membership. Keep qualified
objects in a separate index, carrying their source fingerprint and exact
FlyingTime, even if their effects contain unsupported emitter types. Agent
presence is independent of whether the browser can draw a supported action.

Lookup must distinguish known None, resolved source object, and unresolved
source reference. Missing exact-level metadata is another unresolved state.
Do not use the skill ID, another level, a display-name match or an existing
same-ID object as a substitute. Apply the native Agent-absent scheduling lead
only to known source None, or to a separately established native load failure.

This evidence does not claim complete particle fidelity, recover all legacy
no-Agent effects, or close native renderer interpolation. It establishes the
ordinary scheduler's effect input and identifies the binding correction that
must precede a truthful runtime integration.

## Implemented binding checkpoint

The export/runtime correction now uses
`format: "l2-interlude-skill-vfx-v2"`. `objects` is keyed by the complete
case-insensitive source path. `bindings[id]` contains the original known
`levels`, a base `path`, and own-property `overrides` for differing levels.
An empty override is preserved. This compression never introduces a record
for an unknown level.

`build_skillanim.py` and `build_skillvfx.py` freshly decrypt the pinned
original DAT on every build/check. VFX builds also parse the pinned Skill.usk
rather than trusting an old binding JSON. All 244 source objects survive in
the runtime index, including objects with no supported drawable action.
The existing leaf/heuristic `skill` table remains only as compatibility data
for diagnostics; runtime selection never reads it.

Browser `castAgentInfo(id, level)` exposes `source-none`,
`resolved-source-object`, `unresolved-source-path`, or
`missing-exact-metadata`. `SkillVfx.has(id, level)` reports a resolved Agent;
`cast/launch(id, anchors, level)` dispatch that object's source actions.
`flyingTime(id, level)` returns the resolved Agent's source value, including
its verified zero default, and null otherwise. No Agent means no FlyingTime
property; it cannot authorize an instant legacy impact sound. A future
scheduler must inspect binding status: known None and a resolved object with
FlyingTime 0 use different native lead branches, and unresolved metadata must
not select the Agent-absent branch.

`skillAnimInfo` now accepts a compressed base only for an explicitly known
source level. The wire message field is `level`; the dispatcher and launch
sound lookup preserve it. Source-backed binding does not upgrade the existing
provisional renderer/phase timing into native fidelity.

Additional checks:

```sh
python3 tools/dat/build_skillanim.py --check
python3 tools/dat/build_skillvfx.py --check
python3 -m unittest discover -s tools/dat -p test_skill_bindings.py
node --test editor/world/test/skillvfx-binding.test.mjs
```

The original-backed export regression compares every one of the 29,812
source rows and all 244 original object fingerprints/FlyingTime values with
the generated index. Runtime tests exercise empty overrides, unknown levels,
missing referenced objects, nondrawable Agents and the actual gateway-shaped
cast/launch dispatch. Generated original data stays local and is not part of
the source-only change.
