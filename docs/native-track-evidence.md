# Elbera Tools: ordinary original animation tracks

The browser samples **original sparse local tracks**, without using PSA
resampling or glTF frame times. The inspector now pairs this primitive with
separately verified source-mesh association, reference fallback and neutral
parent-coordinate math. [Live Character playback](original-animation-runtime.md)
also uses this path for admitted nonnegative wait and cast frames. Complete native animation and live hair placement
remain unfinished.

## Reproduce

Portable runtime cases, without client inputs:

```sh
node --test editor/world/test/nativetrack.test.mjs
```

Original instruction and browser differential check, requiring the owner's
pinned Engine.dll, Python with Capstone and Node:

```sh
python3 tools/ui/check_track_native.py --check
```

The source check pins owned Engine SHA-256
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`.
It verifies 15 instruction anchors and six complete ranges. It interprets the
actual retained search, alpha, hemisphere and translation instructions on
synthetic inputs: **382 + 203 + 102 cases**, respectively. Another **59 cases**
compare the actual browser module with those instruction results and the
separate bounded quaternion model. Selection and positions match exactly;
quaternion comparison permits `2e-6` component error for cross-language math.
No native code is executed and no original poses are emitted by this check.

The ordinary sampler is `0x106bb6a0..0x106bbbb7`, SHA-256
`3dd5a42e561e9eaa2a2e90eab0066206820ae25445e967e182bce404d17df784`.
These retained sampling operations need no supplemental binary. The called
quaternion helper has its own [original and supplemental evidence](native-quaternion-evidence.md).

## Supported API

[`sampleOriginalTrack(track, duration, frame)`](../editor/world/js/nativetrack.js)
returns `quaternion`, `position`, `first`, `second`, `alpha`, `wrapped` and
`hemisphereFlipped`. Values remain in original source-local coordinates.
Invalid or unsupported records throw; the function does not invent a reference
pose, normalize missing fields, choose a mesh bone or alter its inputs.

`prepareOriginalTrack(track, duration)` owns an immutable validated copy and
returns `sample(frame)` plus `firstPose()` for raw first keys. Fresh
`sampleOriginalTrack` calls still revalidate caller data. `firstPose()` does not
mean `sample(0)`: the original tiny-interval branch can choose a successor even
at frame zero.

The bounded input shape is explicit `flags: 0`, nonempty time keys starting at
zero and strictly increasing, one quaternion per time, and either one position
or one position per time. Components and derived values must remain finite
Float32. Duration is positive, with last key no later than duration; normalized
frame is in `[0,1]`. Negative-zero times/frame and unsupported shapes are rejected.
Strict time order is the measured source domain, not a claim that native code
validates malformed tracks: its retained search can be tested separately with
repeated times.

## Native sampling rules

| Step | Retained evidence | Implemented rule |
| --- | --- | --- |
| Source time | `0x106da48a..0x106da4cc`; independent `PoseFrame` at `0x106c7489..0x106c74c7` | Caller clamps normalized frame to `[0,1]`, stores Float32, then stores `duration * frame` as Float32. The browser API requires the bounded normalized input. |
| Track selection | `0x106bb6a0..0x106bb76c` | Last key at or before source time; linear search through 30 keys, at most 32 stepping binary-search iterations above 30. Successor wraps to zero after the final key. |
| Alpha | `0x106bb799..0x106bb816` | One key means zero. Ordinary denominator is `abs(f32(nextTime-currentTime))`; closing denominator is `f32(duration-currentTime)`. If denominator is greater than original double `0.00009999999747378752`, use `f32((time-currentTime)/denominator)`; otherwise use one. No alpha clamp is added. |
| Exact key | `0x106bb82b..0x106bb83c`, `0x106bbb4b..0x106bbb6a` | Zero alpha copies the stored quaternion, without normalization. |
| Hemisphere | `0x106bb88f..0x106bb8a4` → `0x106b56d0..0x106b5804` | Ordinary mode adjusts only the closing pair, and only while blending. It may negate the successor; adjacent stored pairs are unchanged. |
| Rotation | `0x106bb94c..0x106bb968` | Current, adjusted successor and alpha feed the separately documented ordinary quaternion helper. This is not the initial-tween helper. |
| Translation | `0x106bb96b..0x106bbb91` | A one-position track stays constant. Otherwise each component is `f32(current + f32(f32(next-current)*alpha))`, preserving all three stores. |

Native key search compares unsigned Float32 **words**, not floating-point
comparisons. Numeric ordering is equivalent only for the admitted finite,
nonnegative domain. The implementation preserves the original 30-key split and
32-iteration bound; it does not generalize this to NaN or signed time inputs.

The hemisphere helper computes Float32 `candidate-reference` and
`candidate+reference` components, rounds each square, adds them in
`((y²+x²)+z²)+w²` order and rounds the final norms. It negates candidate only when
`norm(plus) < norm(minus)`, strictly. Ties are unchanged. Replacing this with
`dot < 0` can lose the original rounding rule; eagerly normalizing endpoints can
also change the original exact-key/copy branches.

## Original data path and measurement

The reusable decoder is
[`original_animation(..., include_tracks=True)`](../tools/anim/build_pawnanim.py).
It retains original reference bones, movement duration/flags/indices, raw
quaternion/position/time arrays and separate root track. It checks every saved
movement endpoint, the outer movement endpoint and complete MeshAnimation
export, including sequence trailers. Existing timing-only callers retain their
`original_sequences` API. No PSA/glTF is used as the source oracle.

[`export_source_tracks.py`](../tools/anim/export_source_tracks.py) writes ignored
private inspection inputs under `assets/gamedata/animation-tracks/`. Original
player packages are Fighter, Magic, Elf, DarkElf, Orc, Shaman and Dwarf;
`build_pawnanim.PAWNS` joins each model to its exact `<prefix>_anim` export.
Package/export/record hashes accompany the retained inputs.

A fresh private audit of all 14 source exports measured 1,367 sequences and
110,512 ordinary tracks: 51,304 constant rotation/position tracks, 44,936 varying
rotations with constant position, and 14,272 tracks varying both. Every quaternion
count equals its time count; all flags are zero. All time arrays start at zero,
have no duplicates and end before movement duration. There are zero negative-dot
adjacent quaternion pairs, but **121 negative-dot closing pairs**. No varying
track ends before source frame `N-1`; this does not prove dense exported samples
preserve native subframe quaternion interpolation. These counts describe these
supplied inputs, not a universal package-format guarantee.

## Browser pose preview

The [Elbera Tools pawn inspector](../editor/world/test/pawn-original.html) now
combines original sparse keys with the **original face-mesh reference skeleton**,
native first-name linkup, reference fallback and neutral current-parent math.
It displays the result through the existing browser character and keeps the
exported animation available as a separate comparison.

Generate both private inputs, start the usual local asset server, and open
`/test/pawn-original.html?model=human_fighter_f&slot=castMid&stance=hand`:

```sh
# One model: original keys and its matching source skeleton sidecar.
python3 tools/anim/export_source_tracks.py human_fighter_f --write
python3 tools/anim/export_source_tracks.py human_fighter_f --skeletons --write

# All 14 ordinary player models; compare existing outputs with fresh decoding.
python3 tools/anim/export_source_tracks.py --write
python3 tools/anim/export_source_tracks.py --skeletons --write
python3 tools/anim/export_source_tracks.py --check
python3 tools/anim/export_source_tracks.py --skeletons --check
```

The paired files are `assets/gamedata/animation-tracks/<model>.json` and
`<model>.skeleton.json`. The sidecar independently joins the exact original
class `Mesh` tag, one unique chargrp face entry and the mesh's stored animation
reference. It preserves the mesh reference bones and their parents, the
animation reference bones, first-name bindings and source fingerprints.
The browser checks that the two inputs identify the same model, package and
animation export, and recomputes the supplied binding table before use.
This does not establish master-mesh selection for transformed or alternate pawns.

Expand **Original sparse animation keys**, choose **Load original keys**, then
**Preview original keys**. Play, pause and scrub use the selected pose source.
The source view includes the full sequence period and closing interval; the
exported comparison clamps at its last stored frame. Cast and sit/stand replays
leave the manual comparison and use the [live Character backend](original-animation-runtime.md),
including admitted nonnegative source poses and explicit transition limits.

### Source association and fallback

There are two distinct associations:

1. **Mesh → animation:** the original rule chooses the first matching interned
   FName, ignoring animation parents and duplicate occurrence counts. The
   same-package name-table gate supports the decoded-name adapter for all 14
   source pairs. See [linkup evidence](native-animation-linkup-evidence.md).
2. **Source mesh → displayed browser bones:** a separate strict name-and-parent
   correspondence admits the loaded export. It preserves loader source names,
   rejects ambiguity and introduces no renamed-finger aliases.

All **14 original face skeletons** pass the current source association. Thirteen
map every bone; male Human Fighter maps **69 of 70**, with one source reference
fallback. Its unmatched `Bip01_R_Finger01` receives the original face mesh's
local quaternion and position; its mapped child still animates. This follows
[GetFrame's later reference/cached-pose selection](native-pose-fallback-evidence.md),
rather than borrowing the duplicate left-finger animation track.

Movement `BoneIndices` is a different serialized list. It is not the lookup
used by this ordinary GetFrame path, so the **15 measured empty lists** are no
longer a reason to reject the preview. Ordinary movement flags, start bone zero
and a complete animation track array remain required; unsupported data fails
explicitly.

### Neutral hierarchy and display basis

The preview explicitly selects **channel zero, base bone zero, root locking
off and no additional modifiers**. Each matched bone uses its sampled local
quaternion/position; unmatched bones use original reference locals. The
[coordinate helper](native-pose-coordinate-evidence.md) builds source records
and composes children with `ApplyPivotWithoutScale(local, currentParent)`.
Reference-cache `ApplyPivot` is a different operation and is not substituted.

The resulting source coordinate matrices are displayed through the measured
glTF geometry basis: swap source Y/Z, scale translations by `0.01`, and change
basis as `B * C * B⁻¹`. This is a browser display adapter, not native actor/world
placement. It retains the complete matrices, including scale/shear, instead of
decomposing them into guessed local quaternions. The existing skeleton's outer
transform is applied once; leaving the preview restores its prior matrix state.

The displayed export deltas now measure the maximum **hierarchy basis component
difference** and **hierarchy translation distance in export units**. They are
not local quaternion error, angular error, world-space displacement or a
native-client visual score. A source-correct association may differ visibly
from an older adapted export. No aggregate numerical matrix-basis accuracy
claim is made by this document.

### Current tool capture and conversion checks

![Elbera Tools showing Human Fighter source hierarchy with 69 animation links and one reference bone](img/elbera-tools-source-hierarchy.jpg)

Actual neutral source preview at 0.677 seconds. The visible difference from the
export includes the original missing-finger rule; the delta is not a native
rendering error score. The stage, camera and lighting are inspection controls.
[Capture provenance](img/README.md).

A fresh local source audit covers all 1,139 face bones across 14 models and their
exact name/parent correspondence to the displayed joints. Seventy actual preview
applications (five CastEnd times per model) produced finite matrices and restored
matrix state and mixer transforms. An independent `B * C * B⁻¹` comparator checks
the display algebra; it does not compare screenshots against a running native
client.

Canonical glTF nodes are assembled from the upper-body part, so they are not a
universal face-reference oracle. Dark Elf male has a different source root and
six Dummy leaf bases; Orc fighter male has a different Weapon_R_Bone reference.
Checking 45 actual inverse-bind records across ten non-hair part skins in those
two models confirms that each part retains its own original reference within
conversion precision. These differences do not justify replacing the inverse
binds. The preview retains them; complete native deformation and equipment/hair
attachment remain separate work.

### Earlier preview and retained capture

The first sparse-key preview directly adapted animation locals into the built
skeleton and admitted 13 models. It rejected the male Human Fighter name mismatch
and empty movement maps. The source-mesh association and fallback above replace
those restrictions; the earlier conservative rejection was not the native rule.

That earlier local-key adapter used position `f32(0.01 * [x,z,y])` and quaternion
`[x,z,y,w]`, with root XYZ negated. Its measured **94,831 translation and 94,831
quaternion first-key comparisons** explained the existing PSA/glTF export path.
They remain useful historical conversion evidence, but are not an oracle for
the new source hierarchy or the original runtime's root quaternion handling.

![Elbera Tools rendering a female Human Fighter from original sparse casting keys](img/elbera-tools-animation-keys.jpg)

Retained capture of the earlier local-key preview at 0.677 seconds. It shows
the browser character, not the official client, and predates the source-face
hierarchy milestone described above.

## Boundaries before live adoption

The neutral preview still uses existing browser geometry, inverse bind matrices,
skinning, grounding and hair adaptations. The source association, local fallback
and base current-parent math are now implemented for inspection; complete native
GetFrame is not. Negative-frame initial tweening, cached-pose transitions,
additional channels, root motion/locking, bone and actor modifiers, actor/world
placement, notify-driven effects and dynamic hair need separate integration.
Ordinary and dynamic hair remain distinct, as described in the
[attachment evidence](native-hair-attachment-evidence.md).

The original reference skeleton and raw tracks can also be inspected without
the rendered character. Original keys, skeleton sidecars and local receipts stay
ignored; they are not included in the public repository or Core 0.1.0 archive.

JavaScript/Python Float64 intermediates approximate native x87. Explicit Float32
stores are preserved, but native precision control, exceptions and original CRT
behavior are not reproduced universally bit-for-bit. Exact block correspondence
with the separately pinned supplemental copy binds selected missing calls; it
does not authenticate that copy or establish owned runtime import restoration.
The browser helpers must not be advertised as complete native skeletal playback.
