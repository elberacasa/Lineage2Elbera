# Original animation in live browser characters

The live `Character` player now samples original sparse keys for the ordinary,
nonnegative frames of source-resolved wait, sit, stand and cast schedules. It
uses the channel's exact normalized frame, original face-skeleton links and
neutral current-parent coordinates. The browser still supplies mesh skinning,
actor placement and the initial transition. This is a bounded playback
improvement, not full native animation parity.

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
Each actor owns its skeleton links, selected sequence and reversible matrices.
Prepared sampling validates and copies a selected track once, retaining the
same original arithmetic without scanning every key on each animation tick.

## Playback and visible checks

Open the [pawn inspector](../editor/world/test/pawn-original.html), expand
**Replay original sit and stand**, then use **Sit** and **Stand**. The displayed
pose status reports the actual live Character backend, exact sequence/frame
and mapped/reference counts. An ordinary skill replay uses that same backend.
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
model load cannot replace a newer one. Wait segments retain their own sequence
and frame even when AnimEnd installs a successor in the same tick.

Negative frames retain the existing exported browser tween and explicitly report
`native-transition-cache-not-yet-admitted`. Missing or mismatched runtime inputs
also report the source path as unavailable; an exported pose is not labelled as
original sampling. Ordinary movement, attacks and social actions outside these
source-resolved schedules still use the existing exported path.

## Remaining native work

The [negative-frame tween investigation](native-pose-tween-evidence.md) recovers
its separate interpolation helper and incremental cached-pose arithmetic. The
native zero-previous-frame exception policy and complete cache initialization
are not yet admitted for live use. A raw first key and ordinary `sample(0)` are
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
