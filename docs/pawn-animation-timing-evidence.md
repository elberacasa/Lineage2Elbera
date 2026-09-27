# Elbera Tools: original pawn sequence and notify inputs

`tools/anim/build_pawnanim.py` now traverses the original MeshAnimation exports
to their declared endpoints. Production extraction no longer scans for records
using exported PSA headers as an oracle. This supplies original inputs for the
[native cast scheduler](native-cast-scheduler-evidence.md); it does not itself
implement scheduling, notify dispatch or native pose interpolation.

## Reproduce

```sh
python3 -m unittest discover -s tools/anim -p test_pawnanim_source.py
python3 tools/anim/build_pawnanim.py
python3 tools/anim/build_pawnanim.py --check
```

Eight synthetic tests need no game files. The ninth test requires the privately
held seven player packages and existing `tools/anim/psa` exports. It independently
compares every sequence name, frame count, rate and ordered notify tuple with
the older PSA-guided original-byte reader. It does not compare the exporter
with its own JSON. The build additionally needs the original `Engine.u`,
`lineagewarrior.int` and current character manifest. No browser or login is used.
The generated `editor/characters/pawnanim.json` contains original client data;
keep it outside source-only publication decisions.

## Source and boundaries

All seven packages have file version 123 and MeshAnimation version 1. Elf has
licensee version 28; the others have version 30. Both use the original absolute
movement/chunk endpoints and the same sequence trailer. The corresponding
serializer descriptions are in the local UEViewer revision
`a0bfb468d42be831b126632fd8a0ae6b3614f981`,
`Unreal/UnrealMesh/UnAnim2.cpp::SerializeLineageMoves` and
`Unreal/UnrealMesh/UnMesh2.h::FMeshAnimSeq/FLineageUnk4`. This is independent
format implementation evidence, not an oracle for native gameplay semantics.

The reader consumes every declared compressed track array, movement chunk,
sequence trailer and full export. It rejects unsupported versions, invalid
counts/references, incomplete exports, duplicate sequence names and nonfinite
timing fields. Source frames and rates must be positive in this bounded parser;
it does not invent a zero-duration replacement for unsupported data.

The [separate original endpoint verifier](native-animation-terminal-evidence.md)
independently parses the male human fighter's compressed tracks and identifies
the native frame/rate fields and endpoint rules. Its 114 source sequences agree
with this extraction. The all-player regression uses a different record-finding
strategy and independently exported headers across all 14 models.

| Original input under `assets/interlude/` | SHA-256 |
| --- | --- |
| `system/lineagewarrior.int` | `8d951cbccd010a849f05df827d7065ec5f9372245953e71f3e88344cf8189485` |
| `system/Engine.u` | `9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761` |
| `animations/Fighter.ukx` | `8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c` |
| `animations/Magic.ukx` | `26443ed7a5b972010c614f74ac8b625e3ae2dbbaa12f7d0a0fa9302622326fa2` |
| `animations/Elf.ukx` | `c522c829f9fde7ec2e8bfcb3a59061faf7e5ada607847cf02ca03f88c52006d3` |
| `animations/DarkElf.ukx` | `977ff856c180f78d91a541a5de85ca13b64ee5b0fbbb11d852f9a2a02fb9048d` |
| `animations/Orc.ukx` | `95876b32a7c5a80a580d62297111e8f378a86eecafeab0429b7a56a43e04f9a5` |
| `animations/Shaman.ukx` | `103cd8166f7f0f31e8294b11d52cb2cc0eae9c9fda0a1572174ae93be5d41adc` |
| `animations/Dwarf.ukx` | `600b189af6001a2cdc59e9c675c3682e76f977ad616d1a3d6d1052095472124e` |

## Runtime data contract

The format marker is `l2-interlude-pawn-animation-v2`. Existing `models.slots`,
`models.unshipped` and `clips[model][clip]` remain available. Each clip record
has `originalTiming:true`, original integer `frames`, exact decoded Float32
`rate`, and `notifies` in serialized array order. Each notify includes:

- `index`, exact decoded Float32 `t`, original `function` and `objectRef`;
- qualified `classPath`, existing short `kind`, and boolean `isAttackShot`,
  `isBoneScale` and `isSound` classifications;
- original `objectName` and qualified `objectPath`, both null for null objects;
- a source object fingerprint where an object exists; sound references retain
  their full package/group/object path when serialized.

`isAttackShot` follows qualified class identity or serialized superclass links
to `Engine.AnimNotify_AttackShot`. Other known AnimNotify subclasses are false;
unknown ancestry fails extraction instead of being guessed. Null-object records
are retained with `classPath:null`, `kind:null` and `isAttackShot:false`.
The native reverse search needs source array order, not sorted time order.

`sequences[model][lowercaseOriginalName]` contains every original sequence,
including those without a browser clip. A present record with `notifies:[]`
is verified empty source, distinct from a missing record. `models[model].slotSource`
keeps each authored slot's `seq`, `clip` and status: `source-none`,
`source-sequence` or `missing-source-sequence`. An absent slot is still absent.
Browser-clip availability must be checked separately before animation playback.

Sound entries additionally carry `soundInfo` with original `volume`, `radius`,
`random`, per-field provenance and a direct/surface/unresolved status. The
original base Sound class's unique defaults are stored at
`source.notifySoundDefaults`. Missing radius or unverified subclass defaults
remain unresolved. See [native sound evidence](native-cast-sound-evidence.md)
for exact fields, event timing and probability limits.

Package, MeshAnimation export, sequence record and notify object fingerprints
make the input identities reviewable. `dur=frames/rate`, `sec=t*dur` and the
legacy `u=t*frames/(frames-1)` are unrounded derived conveniences. The planner
must use original `frames`, `rate`, `t` and `isAttackShot`, never `u` or the
exported glTF duration. Original endpoints and scheduler deadlines are separate.

## Measured result and limits

All 14 models yielded 1,367 sequences and 3,744 notify entries, including 497
AttackShot entries and 368 sequences with empty notify arrays. There are 151
sequences whose original notify order is not chronological. The two null-object
Elf hand-attack entries at index 6 have source times 1.860465168952942 (male)
and 1.7391303777694702 (female). They are preserved, not clamped or discarded;
all matching AttackShot notify times lie within `[0,1]`. These observations
supersede the old six-decimal rounding, sorting and null-record omission.

All 1,815 authored slot/stance entries resolve to source sequences in this
snapshot. The current manifest maps 1,148 clip aliases; counts do not prove
every native stance, action, transition, pose or effect is implemented. The
[ordinary player scheduler](native-cast-scheduler-evidence.md#bounded-browser-integration)
now consumes these inputs. Complete native tween/interpolation parity,
multishot/late-target behavior and full effect lifecycle remain separate work.

## Exported loop inputs

```sh
python3 tools/anim/check_cast_loop_inputs.py --source
python3 -m unittest discover -s tools/anim -p test_cast_loop_inputs.py
```

This separate Elbera Tools check verifies existing `castEnd` exports without
modifying them. Without `--source`, it reports only sampling shape against the
private timing table. With `--source`, it freshly extracts original PSA/PSK
data using the supplied umodel, checks complete skeleton correspondence and
packed output keys with the independent recovery verifier, and compares the
source .int binding and original UKX frames/rate. The public tool includes no
original data. `--output` selects the private receipt; its default is ignored
`tmp/restart-audit/cast-loop-inputs.json`.

All 14 local `castEnd` sequences have four source frames at rate 30. Their
188 dense channels retain exact Float32 `i / rate` times; 2,090 byte-constant
channels use the exporter's lossless two-key form at zero and the final-frame
time. Female dwarf has 17 dense and 155 constant channels. Requiring every
track to contain four keys incorrectly rejected these valid exports. Runtime
loop closure now admits both proven forms and appends the existing first pose
at `frames / rate`, preserving every original exported key. These counts and
key comparisons do not certify native subframe interpolation or MS01's
separate `atk02` loops.
