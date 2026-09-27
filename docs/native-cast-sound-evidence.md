# Elbera Tools: original casting sound dispatch

The original sound table contains **three layers of three phases**, not three
banks of random alternatives. Native sound lookup also has its own level-1
fallback and duplicate ordering; it must not reuse visual Agent lookup rules.
Animation `AnimNotify_Sound` objects form a separate timed sound path.

## Reproduce

```sh
python3 tools/ui/check_cast_sound_native.py --check
python3 tools/ui/check_cast_sound_native.py --json
python3 -m unittest discover -s tools/ui -p test_cast_sound_native.py
python3 -m unittest discover -s tools/anim -p test_pawnanim_source.py
python3 tools/anim/build_pawnanim.py --check
```

The native verifier checks 131 original instruction anchors, freshly parses all
1,398 sound records and verifies named voice stores and original Sound-notify
defaults. Its five synthetic tests need no game assets. The ordinary model join
also requires original `chargrp.dat` and the locally built character-creation
metadata. Original DLL bytes are
decoded only in memory; the tool neither runs nor emits original code. Output
is provenance and recovered rules, not the private sound catalog.

| Private input under `assets/interlude/system/` | SHA-256 |
| --- | --- |
| `engine.dll` | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| `Engine.u` | `9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761` |
| `skillsoundgrp.dat` | `14c9df542ccb0b342f1fd091b7177438cdf3705fb43581d0fc69b6c9ceeb14f5` |
| `chargrp.dat` | `2bb52de25ef3558f51e458c0095efcd9c509dfd5b5695a269f268b5f235fbc0f` |

Engine image base is `0x10300000`; addresses below are RVAs. The shared recovery
method and erased-import limitations are described in the
[scheduler evidence](native-cast-scheduler-evidence.md). The JSON report records
exclusive byte ranges and their hashes.

## Sound data layout and record choice

`FL2GameData::SkillSndDataLoad` (`0x173370`) processes binary records in file
order. Its serializer (`0x14ec30`) reads ID and level, then loops layer index
`i=0..2`. Each iteration reads three references followed by six interleaved
floats. The independent named text loader establishes their meaning:

| Phase / `PlaySkillSound` type | Reference array | Volume array | Radius array | Original text field |
| --- | --- | --- | --- | --- |
| Cast / 1 | `+0x08+i*4` | `+0x2c+i*4` | `+0x38+i*4` | `spelleffect_sound_%d` |
| Shot / 2 | `+0x14+i*4` | `+0x44+i*4` | `+0x50+i*4` | `shoteffect_sound_%d` |
| Explosion / 3 | `+0x20+i*4` | `+0x5c+i*4` | `+0x68+i*4` | `expeffect_sound_%d` |

Thus the older parser's `spell_sounds`, `shot_sounds` and `exp_sounds` labels
actually identify serialized layers 0, 1 and 2. Within each array, index 0/1/2
means cast/shot/explosion. Taking only the first labeled group retained the
first layer's phases but omitted later layers. This conclusion now comes from
the original serializer, text loader and consumer; sound-name suffixes and
value correlations are not the proof.

The remaining fields are two 15-reference voice arrays at `+0x74` and `+0xb0`,
then voice volume/radius at `+0xec/+0xf0`. Empty references and zero values are
source data and must remain intact.

`GetSkillSoundData` (`0x178280`) searches an ID's collected records for the
first exact level, remembering the last level-1 candidate otherwise. The
collection order matters: multimap insertion (`0x15a500`) prepends each entry;
rehash (`0x15a3f0`) traverses entries in ascending insertion order and prepends
them again; collection (`0x158ba0`) follows that reverse-order chain. The
effective rule over the original serialized rows is therefore:

- Return the **last exact ID/level row**.
- If none exists, return the **first level-1 row** for that ID.
- If neither exists, return no sound record.

The local file contains 11 duplicate ID/level keys. Deduplicating it before
applying this rule can change behavior. Unknown requested skill levels remain
unsupported for animation/visual selection even when this separate sound
lookup can find its original level-1 fallback.

## Native events, layers, voices and cleanup

`APawn::PlaySkillSound` (`0x1ee5a0`) loops all three layers of the selected phase.
It skips empty/unloadable references; it does not randomly choose a layer. For
each playable reference it passes authored volume divided by 255, authored
radius unchanged, and pitch 1 to the audio subsystem. Those caller operations
do not prove every audio driver's later gain/filter behavior or other callers'
units.

The Agent path calls type 1 after `TriggerCasting` actions (`0x1ed10b`), type 2
after `TriggerShot` actions (`0x1ed5e4`), and type 3 in `TriggerExplosion`
(`0x1ec5e4`). Shot finalization is driven by native notify/pending state, not
by the arrival of `MagicSkillLaunched`; see the
[scheduler](native-cast-scheduler-evidence.md#advancement-shot-dispatch-and-cancellation).
Explosion dispatch is conditional on its native target/effect path. A raw
FlyingTime timeout at packet launch is not equivalent evidence.

The legacy `APawn::SkillEffectInit` (`0x1f2ed0`) also contains a type-1 call
at `0x1fa6ad`; its tail requires a non-null effect actor before passing the
casting pawn as receiver/first argument and the effect as audio owner.
`APawn::SkillEffectShot` (`0x1fe660`) similarly contains a conditional type-2
call at `0x20ceb2`, using its effect local at `ebp+0x68`. These calls prove
legacy sound dispatch exists. They do not establish that every skill reaches
those tails or successfully produces an effect owner; per-skill native branch
coverage remains necessary before replacing those conditions with browser
events.

Types 1 and 2 additionally select the matching voice bank. User-to-pawn setup
calls exported `User::GetMeshType` (`0x180bb0`) and stores its result at pawn
`+0x698` (`0x18fe91/0x18fe9c`). `PlaySkillSound` reads that value, or a linked
pawn's value through `+0x718`, and indexes the selected 15-entry bank. All 28
named text-loader stores independently establish this order:

| Index | Source voice model | Current ordinary browser model |
| --- | --- | --- |
| 0 | mfighter | human_fighter_m |
| 1 | ffighter | human_fighter_f |
| 2 | mdarkelf | darkelf_m |
| 3 | fdarkelf | darkelf_f |
| 4 | mdwarf | dwarf_m |
| 5 | fdwarf | dwarf_f |
| 6 | melf | elf_m |
| 7 | felf | elf_f |
| 8 | mmagic | human_mystic_m |
| 9 | fmagic | human_mystic_f |
| 10 | morc | orc_fighter_m |
| 11 | forc | orc_fighter_f |
| 12 | mshaman | orc_mystic_m |
| 13 | fshaman | orc_mystic_f |

The verifier pins `GetMeshType`'s race/class/gender switch tables and all ordinary
return values. For the browser mapping it freshly parses original `chargrp.dat`
and joins each record's **complete body and face mesh arrays** to the creation
bindings used by `build_characters.py`. Each matched source pawn class also
agrees with the native named voice store. The match must be unique and cover all
14 records; model-id spellings or inferred race names do not select a voice.
The receipt retains source, builder and creation-metadata hashes.

Slot 14 is serialized and retained but is not selected by the examined ordinary
player `GetMeshType` returns. Linked-pawn/transformation cases require separate
runtime coverage.

The pure browser `skillSoundVoice(index,id,level,phaseType,meshType)` uses the
same exact/fallback sound row as the three effect layers. Phase 1 selects
`castVoice`, phase 2 selects `throwVoice`, and phase 3 has no voice. It preserves
voice volume/radius, including zero. Empty exact rows remain empty; unavailable
or invalid identity emits no voice. `GameSound._play`, `cast` and `launch`
accept an optional final `meshType` argument and append the voice after all
three layers, sharing their session-retirement guard. This adds source selection
without certifying all current callers' event timing or native audio ownership.

Sound position comes from the `PlaySkillSound` receiver's Location; its second
actor argument supplies audio ownership. Agent cast/shot use the casting pawn.
Agent explosion uses the stored **TargetActor** as receiver and the last spawned
effect as audio owner. Exported `ANProjectile::SetTargetActor` (`0x42df0`) writes
projectile `+0x4e4`; Agent shot copies caster `+0x520` there at `0x1ed4e2/0x1ed4e8`,
and explosion reads it at `0x1ec5e8`. Legacy explosion instead uses the
projectile's Owner cast to Pawn. These conditional receiver/ownership rules do
not certify the browser's complete projectile placement or effect lifecycle.

`StopSpellSound` (`0x1eec60`) looks up the current record and stops **all three
cast-layer references**, passing the current pawn and each loaded sound to
audio vtable `+0x88`. This is narrower than stopping every sound associated
with the actor. Browser guards against pending asynchronous audio loads must
be described as browser lifecycle safeguards, not invented native timing.

## Separate animation Sound notifies

`UAnimNotify_Sound::Notify` (`0x3be900`) takes mesh-instance and actor arguments.
Original reflected fields place Sound, Volume, Radius and Random at
`+0x38/+0x3c/+0x40/+0x44`; source types are object, float, int and int. A common
gate compares a signed integer remainder modulo 100 with Random and returns
when the remainder is greater than or equal to Random. The imported RNG body
is erased. **Random 100 always passes** for any signed remainder; no random
selection needs to be invented for that case.

With a non-null Sound, the ordinary direct branch plays that exact reference at
the actor's Location, dividing Volume by 255. It passes nonzero Radius directly;
zero Radius reads an imported global. Another global-controlled branch scales
nonzero Radius by 1000. This audit does not identify those protector-erased
globals or claim complete editor/alternate-mode behavior.

With null Sound, the function follows separate pawn/foot-surface logic and uses
its eight three-element walk/run banks. That branch must not be treated as a
direct named sound. The existing footsteps module's surface proxies are not
validated by extracting the banks or by this direct-notify proof.

Original `Engine.AnimNotify_Sound` has a unique typed default stream: Volume
1.0 and Random 100. Its class export starts at 2558678, length 110; defaults
start at relative offset 95. Radius has no explicit override in that stream;
the exporter does not invent a value for an absent radius.

The [pawn metadata exporter](pawn-animation-timing-evidence.md) now retains
`isSound`, exact `objectName`/qualified `objectPath`, the existing full `sound`
reference and `soundInfo` with source volume, radius, Random and field owners.
Status distinguishes `source-direct`, `source-surface` and unresolved source
properties. Original class-default provenance is stored once at
`source.notifySoundDefaults`; null notify objects retain null identity and
false class predicates. Subclass defaults are not guessed.

The rebuilt original sequence table contains 2,189 direct and 336 surface Sound
entries. Other sequences contain authored probability values besides 100 and
must remain unsupported until their RNG semantics are implemented. The audited
exported ordinary cast/magic/special-attack/pickup aliases contained 770 direct
Sound entries, all with Radius 30 and inherited Random 100; their authored
volumes are preserved. These are metadata counts, not an audio parity claim.

## Original grouped references and existing audio exports

```sh
python3 tools/audio/build_audio.py --manifest
python3 tools/audio/sound_reference_aliases.py --check
python3 -m unittest discover -s tools/audio -p test_sound_reference_aliases.py
```

These commands require locally supplied original UAX banks and existing audio
outputs; they do not transcode or copy audio. The alias tool traverses serialized
Sound-export Package outers and preserves every group. It maps the qualified
reference only when both the original export and existing output have a unique
package/basename identity. Different source groups with the same basename remain
unresolved. Existing flat manifest keys are retained for older consumers; they
are not evidence for resolving those ambiguous grouped names.

The fresh audit reads 25 banks, 5,143 original Sound exports and 5,128 existing
outputs. It verifies 5,113 qualified references and rejects 30 ambiguous source
identities. Of 195 distinct references used by the 770 audited ordinary direct
notify entries, 193 resolve. The two unresolved references occur in dwarf male
`castLong`: the original Heltor Silenos wait sounds also share their basenames
with a different source group. No substitute is selected.

Manifest `soundReferences` contains only the report format, counts and canonical
report SHA-256. Detailed original encrypted/decrypted package hashes,
Sound-export identities/hashes, matched output hashes and unresolved references
remain in the ignored `tmp/restart-audit/sound-reference-aliases.json` receipt
(override with `--output`). `--check` recomputes that evidence, verifies its
summary/digest and checks every runtime alias. The digest uses UTF-8 JSON with
sorted keys, compact separators and ASCII escapes, preserving array order; the
supplemental pawn-notify coverage field is outside that digest. The game does
not load the detailed audit receipt. This establishes source
identity and exact export-filename mapping, **not codec/content parity** with
the original waveforms. The lossy audio conversion was not rerun by this audit.

Compressed/audio-driver behavior, foot-surface selection, probabilistic
notifies, AttackItem/AttackVoice and native effect lifecycle remain separate
checks. A resolved reference does not prove browser playback or audibility.
