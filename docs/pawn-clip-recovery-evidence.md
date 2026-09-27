# Elbera Tools — original pawn clip recovery

The Interlude source contains four pawn animation slots that the browser's
export whitelists omitted: `castEnd`, `magicShot`, `magicNoTarget` and
`picItem`. The original `lineagewarrior.int` supplies their sequence names;
these are not alternative gestures selected by similarity. All 14 player
pawns have all four sequences in their original animation exports. This
checkpoint appends the four clips to **all 14 player models**. Human Fighter
male was validated first; the remaining 13 then passed the same unchanged
source, skeleton and key checks in individual sequential operations.

## Reproduce

Source-free regression tests:

```sh
python3 -m unittest discover -s tools/anim -p test_recover_pawn_clips.py
```

With the privately held Interlude client in `assets/interlude`, the existing
character model, and `tools/bin/umodel`, run from the repository root:

```sh
# Dry run: export temporary source references, verify, write no model files.
python3 tools/anim/recover_pawn_clips.py human_fighter_m \
  --report tmp/restart-audit/pawn-clips/human_fighter_m-verified.json

# Explicit local adoption; preserved originals stay in ignored audit storage.
python3 tools/anim/recover_pawn_clips.py human_fighter_m --write \
  --report tmp/restart-audit/pawn-clips/human_fighter_m-recovered.json

# Run AFTER recovery finishes, so metadata reads the resulting manifest.
python3 tools/anim/build_pawnanim.py
python3 tools/anim/build_pawnanim.py --check
python3 tools/src/char_pipeline/validate_gltf.py \
  editor/characters/models/human_fighter_m.gltf
node editor/world/verify_castanim.js --check
```

The tool accepts one explicit model ID per invocation. It has no all-model
write mode. Repeating it validates existing clips without appending copies.
Generated models, source exports and receipts remain private. The locally
modified `editor/characters/manifest.json` and `pawnanim.json` are generated
data and must be excluded from source-only publication decisions.

## Source identity and decoding

| Input | SHA-256 |
| --- | --- |
| `system/lineagewarrior.int` | `8d951cbccd010a849f05df827d7065ec5f9372245953e71f3e88344cf8189485` |
| `animations/Fighter.ukx` | `8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c` |
| `animations/Magic.ukx` | `26443ed7a5b972010c614f74ac8b625e3ae2dbbaa12f7d0a0fa9302622326fa2` |
| `animations/Elf.ukx` | `c522c829f9fde7ec2e8bfcb3a59061faf7e5ada607847cf02ca03f88c52006d3` |
| `animations/DarkElf.ukx` | `977ff856c180f78d91a541a5de85ca13b64ee5b0fbbb11d852f9a2a02fb9048d` |
| `animations/Orc.ukx` | `95876b32a7c5a80a580d62297111e8f378a86eecafeab0429b7a56a43e04f9a5` |
| `animations/Shaman.ukx` | `103cd8166f7f0f31e8294b11d52cb2cc0eae9c9fda0a1572174ae93be5d41adc` |
| `animations/Dwarf.ukx` | `600b189af6001a2cdc59e9c675c3682e76f977ad616d1a3d6d1052095472124e` |
| Fresh `MFighter_anim.psa` | `32dcba12662cf97ec68a04258ba9238152c51a75ce2f4c3349baf620b886cbb7` |
| Local `umodel` executable | `404bc44de029825b452052a4f3a6ad510e0c3e45d45ad6229c9c79398266d3fb` |

`read_warrior_int` decrypts the version 111 localization file. Recovery
requires each exact slot to name the same existing PSA sequence at all six
decoded weapon stance indices. Original spelling is preserved in metadata;
lookup uses the case-insensitive name semantics established by the native
selector verifier. See [the selector evidence](native-skill-animation-evidence.md).

The PSA reader bounds every chunk and record. It rejects duplicate sequence
names, unsupported sizes, nonpositive rates, invalid frame counts, gaps in
`FirstRawFrame`, inconsistent bone/key counts and trailing unaccounted keys.

**PSA parent fields are insufficient evidence.** This umodel build emits
parent `-1` for its first `BONENAMES` entry and `0` for every later entry.
Recovery therefore reads the original UKX `MeshAnimation` export directly:
after the UObject properties, version `1`, then the compact-count
`RefBones` array, each entry contains compact name index, int32 flags and
int32 parent index. Ordered PSA names must match this original array.
Those original names **and parents** must match an entire original PSK
reference skeleton, with a complete, unambiguous structural permutation to
the current glTF skeleton. Existing glTF node names, bind positions,
rotations, parent links and every skin's joint array must match the recovered
source skeleton. The animation emitter's partial name fallback is excluded.

This matters for the original MFighter data: the animation and several
body parts call bone 27 `Bip01_L_Finger01`, although its actual parent is
`Bip01_R_Finger0`. The upper-body reference names it `Bip01_R_Finger01`.
The verified full hierarchy maps that original track to the right finger;
bare-name matching would select the wrong side.

## Measured Human Fighter result

| Browser clip | Original sequence | Frames | Source rate | Output channels |
| --- | --- | ---: | ---: | ---: |
| `castEnd` | `CastEnd_MFighter` | 4 | 30 | 140 |
| `magicShot` | `Magicshot_MFighter` | 46 | 30 | 140 |
| `magicNoTarget` | `MagicNotarget_MFighter` | 46 | 30 | 140 |
| `picItem` | `PicItem_MFighter` | 7 | 12 | 140 |

All 7,210 original per-frame bone keys are independently indexed from raw
PSA records and compared to emitted Float32 translation/quaternion tracks.
The check includes the existing coordinate conversion, root conjugation,
timestamps `frame / source rate`, every bone channel and lossless collapse
of byte-constant tracks. Corrupt keys, missing channels or timestamps fail.

The recovery preserves all 2,653,184 previous binary bytes, existing nodes,
mesh/material data, accessors and animation records. It appends 82,232 bytes.
The binary SHA changes from
`ab1a3fb468d2e788180d37d5a7a34cbc971fc6873e844db08f639840152588ba`
to `b3008ad1acd32da12a2ec25b3410a791f045d417b6b7e1e0481d7a96631320ba`.
The dry-run receipt includes every reference PSK hash and input/output
hashes, making a different local source or preexisting model visible.

## All-player recovery checkpoint

The same command was applied individually to the remaining 13 models. Every
model passed without changing or bypassing a gate. All 56 clips now have
source-derived slot metadata and real glTF animation records. Metadata was
regenerated after the final model write, then compared to a fresh original
source derivation. A subsequent dry run for each model found no missing
clips, made no writes and verified the same output binary hash.

| Model | Source bones | Verified source keys | Appended bytes |
| --- | ---: | ---: | ---: |
| `human_fighter_m` | 70 | 7,210 | 82,232 |
| `human_fighter_f` | 76 | 8,056 | 93,656 |
| `human_mystic_m` | 86 | 8,686 | 99,740 |
| `human_mystic_f` | 90 | 9,000 | 112,164 |
| `elf_m` | 66 | 6,666 | 71,164 |
| `elf_f` | 70 | 6,930 | 109,196 |
| `darkelf_m` | 82 | 8,118 | 92,812 |
| `darkelf_f` | 84 | 8,316 | 119,364 |
| `orc_fighter_m` | 76 | 7,676 | 82,856 |
| `orc_fighter_f` | 78 | 8,268 | 74,456 |
| `orc_mystic_m` | 90 | 9,090 | 84,744 |
| `orc_mystic_f` | 109 | 11,009 | 118,140 |
| `dwarf_m` | 76 | 7,676 | 81,132 |
| `dwarf_f` | 86 | 8,514 | 126,652 |

Totals: **115,215 source bone keys**, **9,112 output channels** and
**1,348,308 appended bytes**, with **36,589,280 previous binary bytes
preserved**. All 14 resulting glTFs pass structural validation. The legacy
cast verifier reports 53 successful checks and no failures, including
14/14 build coverage for each of these four slots.

Private receipts, before-files and logs are under
`tmp/restart-audit/pawn-clips/`. `<model>-recovered.json` records each write;
`<model>-verified.json` records the subsequent no-change verification.
`all-recovery-summary.json` retains aggregate counts and each model's
before/after hashes. `all-idempotence-status.json`,
`all-structural-validation.log` and `verify-castanim-all.log` retain the
cross-model check results. `all-before-after-preservation.json` records an
independent comparison against every saved before-file: old binary prefixes,
old glTF content and manifest fields are unchanged except the four new clip
IDs and appended animation storage. These local generated records are
excluded from the public source artifact.

Eight synthetic regression tests exercise the real append path, duplicate
finger hierarchy, root conversion, unchanged old data, idempotence,
corruption rejection, missing source slots and both exporter whitelists.
The original-source rederivation and structural glTF checks pass. The
legacy cast check now reports actual per-model source/build coverage; it
rejects exported clips with stale missing-slot metadata instead of asserting
that all models must remain incomplete.

## Limits

This proves source sequence selection, full skeleton binding and emitted
key data for the selected build. It does not establish native runtime
phase scheduling, cast-speed calculations, interruption behavior, NPC
overrides, interpolation between source keys or complete visual parity.
Original `NumFrames / Rate` and glTF's final key time
`(NumFrames - 1) / Rate` are distinct; recovery preserves existing sampling
and makes no new timing rule. Availability of a phase clip does not mean
the browser plays the entire original phase sequence.
