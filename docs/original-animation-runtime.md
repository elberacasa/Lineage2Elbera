# Original animation in live browser characters

The live `Character` player samples original sparse keys for ordinary wait,
sit, stand and cast schedules, and uses recovered native tween arithmetic for
transitions from a known evaluated source pose. It uses the channel's exact
normalized frame, original face-skeleton links and neutral current-parent
coordinates. The browser still supplies mesh skinning and actor placement;
fresh instances use proved frame-zero initialization, while transitions after
unobserved playback history remain unsupported. This is
a bounded playback improvement, not full native animation parity.

## Generate private runtime data

Elbera Tools decodes the original packages and skeleton inputs together:

```sh
# Inspect without writing; optionally select one model.
python3 tools/anim/export_source_tracks.py human_fighter_m --runtime
# Build all fourteen models, then compare with a fresh original decode.
python3 tools/anim/export_source_tracks.py --runtime --write
python3 tools/anim/export_source_tracks.py --runtime --check
```

Outputs stay under ignored `assets/gamedata/animation-tracks/runtime/` as
`<model>.l2anim`. The existing asset server exposes them at
`/gamedata/animation-tracks/runtime/`. Supply the same local original packages,
class defaults and chargrp inputs as the [skeleton exporter](native-track-evidence.md#browser-pose-preview).
No downloaded executable is run, and no client input or generated bundle is
part of the public source release.

All **1,367 sequences** remain, including unsupported modes; transport does not
filter to the animations currently played. The original corpus retains
1,867,119 quaternion rows, 545,923 position rows and 1,867,119 time values. The
fourteen bundles total **76,603,596 bytes**, compared with 220,075,349 bytes for
the earlier track JSON alone. This reduces serialized size without key removal,
resampling or changed floating-point values. It is not a browser memory or
network-compression benchmark.

## Authored transport and ownership

`.l2anim` is an **Elbera transport**, not a newly discovered native file format.
The sixteen-byte header is ASCII `ELBA`, little-endian uint32 version `1`, UTF-8
JSON byte length and Float32 payload byte length. JSON is zero-padded to four
bytes. Track arrays become `{offset,count,width}` descriptors into the ordered
little-endian payload; original catalog, skeleton and provenance metadata remain.

The decoder owns its bytes and validates lengths, source identities, bindings,
descriptor coverage, cardinalities and finite values before exposing a result.
Track rows materialize lazily and become immutable. Loading shares one catalog
per model, coalesces concurrent requests and evicts failed requests for retry.
Each actor owns its skeleton links, selected sequence, evaluated local q/p cache,
channel tween bookkeeping and reversible matrices.
The source evaluator is a fresh instance until its first source evaluation;
selecting or displaying an exported comparison does not invent native cache
contents for that previously unused evaluator. After source evaluation begins,
leaving it for exported playback loses the continuity proof.
Prepared sampling validates and copies a selected track once, retaining the
same original arithmetic without scanning every key on each animation tick.

## Playback and visible checks

Open the [pawn inspector](../editor/world/test/pawn-original.html), expand
**Replay original sit and stand**, then use **Sit** and **Stand**. The displayed
pose status reports the actual live Character backend, exact sequence/frame
and mapped/reference counts. It also retains the last observed cached transition
so short negative-frame intervals remain inspectable after playback advances.
An ordinary skill replay uses that same backend and preserves a preceding live
source pose as its transition source.
Replay timing inputs are supplied test data; the inspector neither casts a
server skill nor grants one.

In the world, enable **Online** and enter an existing character. With `?dev=1`,
**Elbera Tools — Camera inspection → Measure player and target bodies** also
reports the current pose backend and number of source-driven bone matrices.
These are browser observations, not a native rendering comparison.

A source sequence must match the clock's original identity, frame count and
AnimRate. Positive frames use original sparse interpolation and the measured
matrix display adapter. Source matrices restore before mixer work, cancellation,
movement, a one-shot, normal completion or model replacement. An older overlapping
model load cannot replace a newer one. Wait events retain their segment identity
when AnimEnd installs a successor in the same tick, while source pose evaluation
uses the final channel. Advancing an old segment to its endpoint does not itself
render that pose or make it the source of the next transition. The original
endpoint branch calls `NotifyAnimEnd` separately from `GetFrame`; callbacks that
explicitly query bones require their own evaluation handling.

Negative frames with known evaluated source locals use `native-cached-tween`:
the raw destination first keys, incremental cached q/p interpolation, the separate
native quaternion helper and unconditional Core normalization. Every mapped bone
uses the same incoming channel bookkeeping; the browser commits once after the
whole pose is admitted and displayed. Missing links retain source reference q/p
without tween normalization. Ordinary positive samples and sequence changes do
not reset previous tween frame, name or accumulator.

The [cache evidence](native-pose-cache-evidence.md) establishes fresh channel
bookkeeping and successful local-pose validity. The
[normal Windows/CRT contract](native-animation-fpu-evidence.md) admits the first
zero-previous-frame reset. Deliberately altered native control words remain
outside that contract. No exported Three position or quaternion seeds the cache.

The [fresh allocation evidence](native-pose-allocation-evidence.md) also closes
the normal default-template instance's initial validity flag. A fresh negative
evaluation samples ordinary frame zero, preserving zero channel bookkeeping.
The next negative evaluation uses that cached pose and the masked zero-previous
reset; these are distinct evaluations, not a combined initialization shortcut.
Copies, reused native instances and custom templates are outside this contract.

The live adapter requires an explicit browser update epoch and Float32 frame.
Repeated evaluations with the same key reuse cached locals even if the requested
sequence changed, matching the original key's omission of sequence identity.
A changed frame can evaluate again within an epoch. The epoch substitutes for
native `GTicks`; it is a scheduling adaptation. Reapplying browser display
matrices and committing only successful supported poses are also adapter policies,
not claims about original renderer scheduling or its earlier marker stores.

Exported playback gaps after a source evaluation report
`native-transition-needs-known-channel-history` for later negative frames and
retain the exported browser tween. Missing or mismatched runtime inputs also
report the source path as unavailable. Ordinary movement, attacks and social
actions outside these schedules still use the exported path. Later positive
source evaluations can render known local q/p again, but cannot repair unknown
previous tween frame/name/accumulator. A new actor/model gets its own fresh
source evaluator; a gap is never silently relabelled as a fresh native instance.

## Remaining native work

Reused/custom native instance defaults, complete invalidation paths and playback
through currently exported movement/attack/social states remain unfinished.
A raw first key and ordinary `sample(0)` are
different operations: the original tiny-interval branch can select a successor
at frame zero. The rig exposes both without substituting one for the other.

Additional channels, root lock, bone modifiers, native weighted deformation,
rigid sections, animated hair, attachment/actor transforms and effect anchors
remain open. Host math still approximates x87/CRT within the documented
[quaternion](native-quaternion-evidence.md) and
[coordinate](native-pose-coordinate-evidence.md) boundaries.

## Verification

```sh
python3 -m unittest discover -s tools/anim -p test_export_source_tracks.py
node --test editor/world/test/sourceanim-data.test.mjs \
  editor/world/test/nativetrack.test.mjs editor/world/test/sourcepose.test.mjs \
  editor/world/test/sourcepose-playback.test.mjs
```

Portable fixtures cover exact Float32 bits (including signed zero), corrupt
containers, immutable ownership, shared-load retry, and real Three mixer
restoration through the actual Character class. Private checks independently
redecode every bundle and compare every decoded field with the original
catalogs and skeletons. Passing these checks does not establish visual parity
with the original client.
