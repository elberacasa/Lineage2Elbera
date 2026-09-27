# Elbera Tools: exact skill-level text

The legacy `skillmeta.json` selects the lowest available name, description and
icon for each skill ID. Those choices can belong to different levels and cannot
answer a level-specific tooltip query. The new private `skilltext.json` joins
the original `skillname-e.dat` and `skillgrp.dat` only by the exact pair
`(skill_id, skill_level)`.

## Reproduce locally

```sh
python3 tools/dat/build_meta.py --skills-only
python3 tools/dat/build_meta.py --check-skills
python3 -m unittest discover -s tools/dat -p test_skilltext.py
node --test editor/world/test/skilltext.test.mjs
python3 tools/ui/check_skilltext_native.py --check
```

The first command writes only the ignored skill-text artifact and stages its
referenced local icon images. It does not change the tracked legacy skill or
item catalogs. The second decrypts and parses the original files again and
compares every resulting record with the generated artifact. The reusable code
and synthetic tests contain no original descriptions or image data.

Inputs for this inspected Interlude build:

| Original file | SHA-256 | Records |
| --- | --- | ---: |
| `skillname-e.dat` | `84745297ef0add25d2291b568382ff9c76f2d58a438bedbf11841dba82dd972b` | 29,812 |
| `skillgrp.dat` | `4e245e914048cee34ada7fb6ed6b499976cbe961ad5bd0a8bfdcf00a1e2288d9` | 29,812 |

Both tables have unique exact keys. Their union contains 2,694 skill IDs.
Descriptions for skill 3 at levels 1, 2 and 3 differ in the original records;
this is a concrete regression against the previous lowest-level collapse.
The artifact records both raw and decoded SHA-256 values, per-source record
counts and output counts. Counts establish parser coverage, not complete
client behavior.

## Format and runtime contract

`skilltext.json` has format `l2-skilltext-v1`, a provenance object, and a `skills`
map indexed first by ID and then by level. Every row preserves the exact name,
description, enchant name, enchant description, original icon reference and
staged icon path. `hasText` and `hasIconRecord` distinguish an absent join side
from an original empty field. Missing fields stay null. The original HP cost,
MP cost and signed cast range are preserved as `hp`, `mp` and `range`.
Raw `operateType` and `isMagic` come from that exact group record as well.

`skillMeta()` loads this artifact alongside the legacy catalog and merges exact
rows in memory. Two-argument `skillInfo(meta, id)` remains compatible with
existing ID-only callers. `skillInfo(meta, id, level)` uses only that exact row
and returns `exactLevel` and `hasText` flags. An unknown level has a diagnostic
name, no icon or description, and null costs/range. No nearest-level lookup,
clamping, interpolation or level-one substitution occurs. Missing exact data
is retried on a later metadata request.

The skill grid supplies the learned level for icon lookup. Its tooltip uses
the requested level's original prose, costs and range. Trainer callers use the
same API; server training packets remain responsible for eligibility and SP.
`info.displayTypeId` selects the original system-string ID from the exact raw
type fields (311 active, 312 passive, 313 magic, 1500 song/dance), or null when
that exact group record is unavailable.
Original missing image references remain recorded instead of being replaced
by another icon. This local build has nine such unstaged-art references.

## Source behavior and limits

`UIDATA_SKILL.uc` declares level parameters for GetName, GetIconName and
GetDescription. `MagicSkillWnd.uc` carries Level, Name, Description, EnchantName
and IconName into its item record. `Tooltip.uc` queries costs and range using
the exact level and displays Description independently from AdditionalName.

An independent native review traced NWindow's GetDescription at VA
`0x10129570` through `0x10164990` to `0x101b5670`. It returns a description
field after an ID/level lookup, without appending enchant text in the getter.
GetEnchantName (`0x10129690`) and GetEnchantSkillLevel (`0x101297b0`) are
separate getters. This does not establish every preprocessing rule in the
native loader: the exporter therefore preserves both original description
fields separately and does not invent a concatenation or enchant-level formula.

The new native verifier reads Engine's original named-column loader: the
`operate_type` literal at VA `0x1089a424` leads to a record `+0x20` write at
`0x1046e55d`; `is_magic` at `0x1089a40c` leads to `+0x3c` at `0x1046e571`.
NWindow GetOperateType (`0x101b5880`) forwards the requested ID and level to
`0x101b5360`, whose cache checks both values. It reads those same two fields:
zero `is_magic` yields passive only when `operate_type == 2`; nonzero magic
yields song/dance only for value 3, otherwise magic. Label operands resolve
through the independently verified GetSystemString stride/base to IDs
311/312/313/1500. The verifier tests the actual browser helper against all 16
combinations of the four inspected field values.

The old `SkillClass.num` API clamps out-of-range requests and its exporter drops
enchanted rows; its display-type label also uses the first level. These APIs
remain for unrelated callers, but this tooltip's costs and label now use exact
original records. Full enchant presentation still needs separate native
verification. This work does not change combat equations, cast timing, server
skill availability or rewards.

The decoder rejects duplicate keys, malformed string terminators, invalid
Unicode byte lengths, impossible record counts, truncated payloads and unknown
trailing bytes. The runtime validates the format, keys, source hashes, field
types and record counts before accepting exact data.
