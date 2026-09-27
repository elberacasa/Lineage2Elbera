# Elbera Tools: original behind-view camera evidence

The stored camera script and the active native camera are distinct evidence.
The original DLL contains native `ALineagePlayerController::PlayerCalcView`
and `CalcBehindView` overrides; the ordinary draw path dispatches to those
overrides. Its hit-check branch uses a nonzero extent `(0.1, 0.1, 5)`, whereas
the stored script omits Extent and its `Trace` decoder supplies zero. Do not
adopt the script's zero-extent settings as the shipped native camera rule.
Both examined paths use collision queries rather than walking-height queries.
The selected native override is pinned below; browser trace parity remains
unverified.

```sh
python3 tools/ui/check_camera_native.py --check
python3 -m unittest discover -s tools/ui -p test_camera_native.py
```

The first command freshly extracts bounded TextBuffer source from the owner's
original Engine.u, decrypts user.ini and l2.ini only into temporary storage,
and decodes the original Engine/Core DLLs in memory without executing them. The second is a
portable eight-case check of the derived equations and flag arithmetic; it
requires no original assets and is not a native execution test. Nothing here
redistributes game source, binary dumps or artwork.

## Pinned inputs

| Input | SHA256 |
|---|---|
| Engine.u | `9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761` |
| user.ini | `18d53de7a88f5363173a6c309e4fc4fd808da9715242e200d6484bbff2e511b0` |
| l2.ini | `377ff9e4a08d3657781d218e192dcdf1fba34348812e213d8613d6c609cf177c` |
| engine.dll | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| core.dll | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |

The recovered LineagePlayerController source hash is
`4b32e90aecb29ac9cf539a453b392d9ddbea0b71768c2564f2b0e87c5b9bb073`.
The verifier pins three complete normalized function/event bodies, 12 selected
script statements, 37 trace instructions and seven trace code ranges. The
native override adds 64 Engine and nine Core instruction anchors, six ranges,
three virtual-slot bindings and five original reflected property records.
Two complete normalized GameInfo login bodies also have pinned hashes.
Running without `--check` emits those hashes and source addresses. Engine's
image base is `0x10300000`; recovery limits are described in
[the Engine recovery evidence](native-engine-recovery-evidence.md).

## Active native override and configured extent

`UGameEngine::Draw` (`0x1058ee50`) calls the viewport controller's virtual
slot `+0x36c` at `0x1058ef06..0c`. The original
ALineagePlayerController vtable at `0x1086f26c` binds that slot to its named
native `PlayerCalcView` (`0x1056e740`). When neither special-camera bit is
set and ViewTarget differs from the controller itself, that function calls
slot `+0x38c` at `0x1056e7a5..af`; the same vtable binds it to native
`CalcBehindView` (`0x1056ea50`). This is direct virtual dispatch, not an
assumption that the stored UnrealScript event supplies those calculations.

The supplied l2.ini selects `Engine.LineagePlayerController` through
`Engine.Engine.DefaultPlayerController`. Original GameInfo `Login` and the
ordinary, non-administrator `L2NetLogin` branch load that configured class
when PlayerControllerClass has not been overridden, then spawn it. Native
`ULevel::SpawnPlayActor` calls the corresponding named event wrapper and
passes the returned controller to `APlayerController::SetPlayer` at
`0x105c80d8`. That method writes this controller into `UPlayer +0x3c` at
`0x1052f460`; Draw reads the same pointer at `0x1058eebd`. The native
controller constructor installs the verified vtable at `0x103d97f2`.
This closes the supplied ordinary configuration-to-viewport path, without
claiming every custom GameInfo, administrator, or later override uses it.

The packed configuration identities have independent structural evidence.
Fresh Engine.u property records link, in order, `CheatFlyYaw` (Int),
`bUseAutoTrackingPawn`, `bUseVolumeCamera`, `bUseHitCheckCamera` (three Bools),
and `AutoTrackingPawnSpeed` (Float). Each is a scalar config property. Core's
named `UBoolProperty::Link` at `0x10173250` retains the preceding Bool's
offset and doubles its mask, or aligns a new four-byte word with mask 1.
The native typed controller copy at `0x103d98ce..0x103d9921` copies the
Int at `+0x854`, masks 1, 2 and 4 at `+0x858`, and the following Float at
`+0x85c`. Together these establish **bit 2 = volume, bit 4 = hit-check**.
The pinned user.ini enables hit-check and disables volume. Runtime commands
or later configuration may change them; this is the shipped ordinary branch.

Native `CalcBehindView` tests volume bit 2 at `0x1056f041`, dispatching to
the named `CalcVolumeCamera` through slot `+0x388` if enabled. Otherwise
bit 4 at `0x1056f06f` selects the examined hit-check branch. At
`0x1056f15a..0x1056f1b5`, it constructs and passes the by-value extent
`(Float32(0.1), Float32(0.1), 5.0)`. These are **extent components**, not a
full box width/height. The constants are stored at `0x1089df54` and
`0x1089139c`. It directly passes flags `0x86` to ordinary
`ULevel::SingleLineCheck` through slot `+0xe4` at `0x1056f1dc`.
It does not pass through `execTrace`'s optional-argument decoder.

The selected native scalar arithmetic agrees with portions of the script:
it stores `D = Float32(CurZoomingDist + 250)`, uses a stored `D + 30` for
trace reach, conditionally takes the smaller of the hit's projected distance
and D, and subtracts 30 for final camera displacement. The retained minimum
helper is thunk `0x10303ddc` to body `0x104a4970`; its finite comparison and
return branches are visible. The zero-old-camera initialization explicitly
stores zoom −20 (constant `0x108bcf20`) and pitch −2700. The ordinary manual
pitch branch at `0x1056f017..0x1056f02f` clamps to **−15000/+16384**,
differing from the script's symmetric ±15000. Those are verified source
differences, not changes already made to browser behavior.

The native branch obtains its trace direction and its projection/final
displacement direction through separate rotation-related calls. Three sites
at `0x1056f08b`, `0x1056f09e` and `0x1056f11d` are six NOPs in this recovered
copy. The surrounding arithmetic and extent arguments survive; actual restored
import bindings and exact equality of those direction constructions remain
unverified. The verifier does not silently equate them merely because the
script uses one forward vector. It also does not certify camera shake,
tracking interpolation, cached branches, special/volume/disabled-hit-check
modes, input behavior, or the full nonzero-extent collision primitives.

In particular, the native configured branch requires the **nonzero-extent**
BSP and actor paths. Filtering source actor data to only
`bBlockZeroExtentTraces` is appropriate for a zero-ray diagnostic, not this
branch. The source BSP primary ray below remains useful and deliberately
separate from the camera replacement.

## Stored script equations (not the active native override)

`PlayerCalcView` starts from `ViewTarget.Location`, adds
`CameraViewHeightAdjust`, and calls `CalcBehindView` with distance 250 for the
behind-view pawn. The shipped user.ini selects `bUseVolumeCamera=false` and
height adjustment 0. It also contains zoom limits −200/+250, fixed camera
slot 0 distance 230 and pitch −2700, automatic tracking enabled, and FOV 60.
These are pinned configuration values, not proof of every later override,
native initialization step or the horizontal/vertical FOV interpretation.

For this source branch, let `D = 250 + CurZoomingDist`, `C` be that actor-based
camera origin, and `V` the unit forward vector from camera rotation:

- Trace from `C` to `C − (D + 30) V`.
- If it returns an actor, replace `D` with the smaller of its current value
  and `(C − HitLocation) dot V`.
- Set the final camera location to `C − (D − 30) V`.

Thus the configured slot-0 example traces 260 L2 units and ends 200 units
behind its origin if unobstructed. The trace extends **60 units beyond the
final unobstructed camera**, not 30. A hit at projected distance 100 gives a
70-unit boom. A hit at 250 leaves the 200-unit boom unchanged. A hit at 15
produces a **signed −15-unit boom**: this branch contains no clamp to zero.
The reference arithmetic tests intentionally preserve that distinction.

The source also caches the previous final camera when target position, manual
inputs, default-camera movement state and zoom have not changed. It clamps
pitch to ±15000 Unreal rotation units and tracks yaw from the planar vector
between current origin and previous camera. Special/fixed/volume camera modes,
native input transfer and default-camera transitions are separate behaviors.

No examined camera statement derives Actor.Location from rendered model bounds.
The old browser assertion that half the rendered model height must equal this
origin is unsupported. Actor placement, collision-cylinder dimensions and mesh
origin/scale require their own evidence; adjusting a camera pivot by visual
height is not a source-backed substitute.

## Stored script's native Trace path and participation

Actor's original declaration identifies `Trace` as native 277 and declares
optional `Extent` after `bTraceActors`. The source camera explicitly passes
false and omits Extent. The surviving native decoder initializes the latter
to `(0,0,0)` at `0x106a8a38..48`.

| Original function | Body address | Relevant evidence |
|---|---:|---|
| AActor::execTrace | `0x106a88f0` | Boolean category flags, zero extent and level dispatch |
| ULevel::SingleLineCheck | `0x105c2da0` | Ordinary wrapper, first eligible result, `0x400` flag |
| ULevel::MultiLineCheck | `0x105c5920` | BSP, terrain, collision hash and adjacent levels |
| UModel::LineCheck | `0x10749210` | Native level BSP primitive |
| ATerrainInfo::LineCheck | `0x10722670` | Native terrain primitive |
| FCollisionHash::ActorLineCheck | `0x10523900` | Actor extent/flags/source checks and primitive dispatch |
| AActor::ShouldTrace | `0x1052fe70` | Static category branch |

The level virtual slots `+0xe4/+0xf4` bind the ordinary functions above. These
are **not** the mouse's `L2SingleLineCheck/L2MultiLineCheck` wrappers. The boolean
arithmetic at `0x106a8af2..0x106a8b05` selects base flags `0x86` for false and
`0xbf` for true. A material-output-address branch additionally applies `0x1000`;
the single wrapper adds `0x400`. Consequently false does not mean that all
static scene actors are ignored.

The world-model bit 4 selects UModel's `LineCheck` virtual slot `+0x6c`.
The terrain path iterates eligible zone terrain entries and calls the named
ATerrainInfo method at `0x105c62f6`; camera flags do not have the `0x100`
exclusion used there. The actor-hash category test at `0x105c64d1` accepts
`0x4009b`, which intersects the camera's static bit `0x80`. `AActor::ShouldTrace`
returns that category for `bStatic`; ordinary nonstatic actors require `0x10`,
which this camera path does not request. This is a selected ordinary actor
branch, not proof for every subclass override or dynamic object category.

The zero-extent actor path tests `bBlockZeroExtentTraces` (`+0x2f8`, bit `0x20`)
at `0x10523a5e`. The mouse's nonzero extent path instead tests bit `0x40`.
It then dispatches `ShouldTrace`, `GetPrimitive` and the primitive's `LineCheck`.
The imported extent predicate at `0x10523945` is six NOPs in the recovered
copy; the separate surviving paths and field identities are established, but
the actual restored import binding remains unverified. Hit sorting similarly
retains its comparator and call arguments while its imported call is absent.
Do not present the incomplete recovered executable as a fully runnable oracle.

## Browser replacement boundary

A trace-provider interface can expose the stored script boom equations
without continuing to call the walking-floor sampler. The provider must keep
missing collision data distinct from a verified unobstructed segment.

The existing audited static-collision sidecar supplies original collision
triangles and source actor flags. Its mouse-admitted actor subset can be
restricted further to `bBlockZeroExtentTraces=true` for a comparison with the
stored script's zero-extent branch. This is not the native hit-check branch.
Its additional mouse admission gates may omit valid camera actors; they do not
justify adding actors whose source camera flag is false. Generic triangle
rays still leave native primitive sidedness, inside-solid handling, time bias,
material rules and full filter parity unresolved.

The rendered BSP glTF is **not** a native BSP collision representation.
`tools/world/bsp.py` omits invisible/portal/fake-backdrop polygons, sky-zone and
world-box geometry, selected duplicate water and missing-texture faces. It
also does not retain the native BSP solid/node traversal semantics. A ray
against that rendering can both miss collision and introduce false blockers.
A faithful replacement needs the original UModel collision fields and the
primitive selected by the active native extent, rather than visible triangles.
The zero-extent algorithm's primary-only result is described below for isolated
comparison; the nonzero extent and complete collision wrapper are not certified
by this checkpoint.

## Primary BSP tree traversal

```sh
python3 tools/ui/check_bsp_camera_native.py --check
node --test editor/world/test/bsp-collision.test.mjs
```

The new native check pins the call from `UModel::LineCheck` through thunk
`0x10302c5c` to the recursive helper at `0x10745bd0`. It verifies 35 instruction
anchors and four code ranges. Four finite cases interpret the **actual decoded,
call-free plane-distance and split-point x87 instructions** and compare their
stored results with `editor/world/js/bsp-collision.js`. The cases include an
oblique plane and original-scale world coordinates. This is stronger than two
copies of a formula agreeing, but remains a bounded Float64 approximation of
x87 intermediates, not full original executable or bitwise parity.

For the no-owner, zero-extent world path with ExtraNodeFlags 0, the helper's
primary collision consumes these source fields:

| Field | Native location |
|---|---|
| Nodes | UModel `+0x64`, runtime node stride 120 bytes |
| RootOutside | UModel `+0x124` |
| Plane X/Y/Z/W | Node `+0x00/+0x04/+0x08/+0x0c` |
| Back / front child index | Node `+0x20/+0x24` |
| Number of vertices | Node byte `+0x56` |
| Node flags | Node byte `+0x57` |

The node defines a solid partition exactly when its vertex count is positive
and `(flags & 0x21) == 0` for this path. These are **node** flags; the runtime
does not substitute render surface flags or require a material/visible polygon.
Children −1 terminate a branch. The initial node and previous-hit-node indices
are both 0, and the initial outside state is the original RootOutside value.

For each node, the helper stores Float32 plane distances
`dot(plane.xyz, point) − plane.w` for the segment start and end. In order:

1. If both distances are strictly greater than the original Float32 −0.001,
   traverse front with `outside OR solid`.
2. Otherwise, if both are strictly less than Float32 +0.001, traverse back
   with `outside AND NOT solid`.
3. Otherwise split at the plane, visit the start side first, and only if that
   side is clear continue into the far side. The split fraction and coordinate
   arithmetic preserve the helper's intervening Float32 stores.

The ordering matters because the epsilon bands overlap. A segment wholly
within the band can take the front branch even with slightly negative plane
distances. Starting in a solid terminal region reports the segment start;
there is no invented escape rule. A clear terminal region continues the saved
far segment. Only continuing into that far side changes the previous-hit-node
index. At a solid terminal the helper returns the segment start and that
previous node's raw plane normal/index.

An empty model is handled by the enclosing UModel function, which returns
RootOutside without writing a hit record (`0x107498d4`). The module therefore
returns a clear result only for empty RootOutside 1. Empty RootOutside 0 is
explicitly unsupported: the original reports blocked but supplies no new hit
point/normal to reproduce. It must not silently become a miss.

`prepareBspPrimary(source)` validates and freezes a minimal snapshot of the
source fields. It rejects malformed links and cycles across every front/back
component, including unreachable nodes. `traceBspPrimary(prepared, start, end)`
takes original L2 XYZ arrays and returns either `status: 'ready'` with a
primary hit or `hit: null`, or `status: 'unsupported'` with a reason. Missing
source, nonfinite derived arithmetic and the computational visit guard never
become a clear ray. Preparation should be reused for repeated queries; the
traversal itself uses explicit stacks so deep original trees do not exhaust
the JavaScript call stack. Validation is structural, not an authenticity or
source-hash gate.

Thirteen source-free JS tests cover half-spaces, starting inside, empty models,
RootOutside, solid-node flags, epsilon order, near-side priority, malformed and
unreachable cycles, immutable preparation, finite overflow, bounded work and a
12,000-node chain. The staged original 17_25 export also validates with 1,819
nodes and RootOutside 0. A synthetic world-space segment was queried as a
structural smoke check; it is not a captured original-client camera comparison.

This module is deliberately **primary-only and not the default world camera**.
The enclosing UModel wrapper computes hit time and applies a subtraction of
`0.5 / <erased-call result>`, then clamps it to 0..1 and recomputes location.
The call shape is consistent with segment length, but its actual restored
import at `0x1074940c` is unverified, so this module does not invent that
binding or apply the adjustment. It also omits wrapper normal reorientation,
material-node resolution, owner transforms, complete trace ordering, terrain,
static actors and adjacent-level aggregation. The primary hit is suitable for
an explicitly labeled Elbera comparison while those boundaries are closed;
it is not a complete native-camera collision claim.

## Nonzero extent: retained hull and one-plane slice

The next executable slice is available in the same module and verifier. It
does **not** enable the camera or expose a complete box-sweep hit query.
The nonzero branch at `0x107496b0` initializes the result time to 2, constructs
a sweep state through `0x103121d9 → 0x10746310`, and calls traversal through
`0x103051cd → 0x10748160`. The constructor retains start, end and their
difference; the shared constructor stores the supplied extent at
`+0x4c/+0x50/+0x54`. The original extent-equality import before the branch
remains one of the recovered-copy limits described above.

The traversal tests convex leaf hulls. `decodeBspLeafHull(source, nodeIndex)`
implements the framing read by helper `0x10745580`:

- Node `+0x4c` is an integer offset into UModel's LeafHulls array (`+0xc0`).
  Offset −1 means no saved hull for that node.
- Read signed DWORD plane references until sentinel −1. The native helper
  has capacity for 64 planes; the bounded decoder rejects a stream that has
  not reached its sentinel at that capacity.
- Each referenced node index is `word & 0xbfffffff`. Bit `0x40000000` selects
  an additional native plane operation. Its call at `0x10745650` is six NOPs
  in the recovered copy, so the decoder preserves
  `requiresNativePlaneOperation` and does not fabricate the resulting plane.
- The six DWORDs after the sentinel are reinterpreted as Float32 minimum XYZ
  and maximum XYZ, not numeric integer coordinates. Truncated, nonfinite,
  inverted, or invalid-reference records are rejected.

Reading the staged original 17_25 data with this decoder gives 291 hull
records, 1,617 plane references, 525 flagged plane operations and a maximum
of 12 planes per hull; all 291 records validate. An independent raw-word read
produced the same counts. The receipt remains private at
`tmp/restart-audit/bsp-sweep/hull-framing.json`. These counts validate framing,
not collision results, and show that ignoring the unresolved operation would
affect real supplied geometry.

`clipBspSweepPlane({plane,start,end,extent,enter,exit,normal})` implements the
**complete retained single-plane interval helper** at `0x10746460`. All inputs
use original L2 coordinates; plane and interval state are explicit. Its result
has scope `bsp-sweep-plane-interval` and a `continues` predicate, never a world
`hit`. The first hull clip starts with entry −1, the current result time as
exit, and zero normal; later clips carry the updated interval and normal.

For a supplied, already oriented plane, let S/E be its stored Float32 signed
distances to start/end. Let R be the stored sum of the absolute, individually
Float32-stored normal-component × extent-component products. The retained
equations are:

1. Store `A = Float32(S − R)` and retain `D = S − E` for division/comparison.
   If `E < S`, `A >= −R`, and `A < 0`, replace A with zero. This is the native
   near-start exception; it is not a general clamp of entry time to zero.
2. For `D < −Float32(0.00001)`, lower exit to `Float32(A / D)` only if smaller.
3. For `D > Float32(0.00001)`, raise entry to that time only if larger, and
   then copy this plane's normal. Equal entry times preserve the previous normal.
4. Otherwise reject only when both S and E are strictly greater than R.
   Finally, the interval continues only while exit is strictly greater than entry.

The native code computes a ratio even in the parallel branch where it is
unused. The JS slice avoids evaluating that unused division; this preserves
the observed finite-state outcome and does not claim CPU exception behavior.
Nonfinite required derived values remain unsupported, never a clear collision.

The extended original checker pins 37 additional instructions and seven code
ranges. Its small, call-rejecting evaluator interprets the **whole original
133-instruction plane helper**, including x87 comparison/status branches and
bitwise absolute values. Across 108 deterministic cases, every retained
instruction is exercised and its predicate, entry, exit and normal agree
exactly with the JS slice. Cases cover inward/outward motion, the near-start
exception, parallel and exact epsilon boundaries, entry ties, closed intervals,
oblique planes and original-scale coordinates. Float64 still approximates
x87 extended intermediates; this is not a universal numerical parity claim.
The JS suite now contains 33 tests covering the primary ray, hull framing,
plane clipping, branch/candidate traversal, bounds planes, final interval/time and bevel-admission slices, including
malformed records, deep/cyclic trees, budgets and unsupported arithmetic.

### Flagged-plane investigation: compatible operation is not a binding

At `0x10745647..0x1074566b`, the original code passes a hidden output pointer
and the current plane as `this`, then copies all four DWORDs from the returned
pointer. The six bytes at `0x10745650` reconstruct as NOPs directly from the
encoded original DWORDs using the verified key. This is not an operation
deleted by the evidence checker; actual runtime import restoration is still
unverified (see [Engine recovery evidence](native-engine-recovery-evidence.md)).

The pinned Core DLL exports `FPlane::Flip() const` with a compatible ABI at
`0x1010d780`: it reads the hidden output pointer, negates X/Y/Z/W, and returns
with `ret 4` at `0x1010d7a2`. The checker pins that export, six instructions
and its complete body hash
`96f66fdcc588cbe0005298a7cfe87f66d04e3ab899d7a050906c127d0be7a9f8`.
Core SHA256 is
`9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf`.
This supports **Flip as a candidate**, not proof that the unresolved Engine
call targets it. No runtime code negates or ignores flagged hull planes.
Of the 291 staged 17_25 hulls, 254 contain at least one flagged plane, so a
blanket unflagged-only collision implementation would omit substantial data.

### Retained candidate traversal and world bounds planes

`selectBspSweepBranches({plane,start,end,extent})` implements the retained
no-owner block `0x10748206..0x10748327`. Native tree admission first stores
each extent component multiplied by `Float32(1.1)` (the original double at
`0x108ceb98` contains that exact Float32 value). It then stores each normal
component × inflated component, takes absolute values and stores their sum R.
S/E are the original Float32 signed start/end distances. It admits the back
branch when `S <= R || E <= R`, and the front branch when
`S >= -R || E >= -R`. Front goes first when `E <= S`, including equality;
otherwise back goes first. This is distinct from the uninflated extent used
by the actual single-plane clipping helper.

`collectBspSweepHulls(source,start,end,extent,{maxVisits})` reproduces the
no-owner tree walk through the leaf test at `0x10748424`, returning only
`scope: "bsp-sweep-hull-candidates"`. Front propagates `outside || solid`;
back propagates `outside && !solid`, where the retained source predicate is
nonzero vertex count and neither node flag 1 nor 32. A terminal branch is a
candidate only when outside is false and the previous node's collision-bound
offset is not −1. Both admitted branches are visited in source order;
repeated references are not deduplicated. Native recursion through
`0x103051cd` at `0x10748374` is replaced by an explicit JS stack. Graph cycles,
invalid offsets, nonfinite arithmetic and exhausted computational budgets
return unsupported without a partial candidate list. Saved plane orientation
is not consumed or silently assumed by this operation. An empty list is
candidate-selection evidence, not an overall world trace result.

`bspSweepBoundsPlanes({min,max})` reproduces the six additional no-owner
planes built at `0x107484b7..0x107485e9`. The source double at `0x108bcba0` is
0.1; each resulting W is stored as Float32. For the convention
`N dot P - W`, the original order is:

| Normal | W before Float32 store |
| --- | --- |
| `(0,0,-1)` | `0.1 - minZ` |
| `(0,0,1)` | `maxZ + 0.1` |
| `(-1,0,0)` | `0.1 - minX` |
| `(1,0,0)` | `maxX - 0.1` |
| `(0,-1,0)` | `0.1 - minY` |
| `(0,1,0)` | `maxY - 0.1` |

The asymmetric positive-axis terms are present in the retained instructions;
they have not been replaced with a generic expanded-box formula. These six
planes supplement the saved hull planes and do not replace later bevel tests.

The expanded checker pins three more Engine ranges and 21 Engine anchors.
It interprets the original branch arithmetic for 103 cases, the original
candidate traversal for 94 synthetic trees/directions, and bounds construction
for 27 min/max pairs. The tree interpreter models only the verified recursive
call and stops immediately before each candidate's hull test; the tree's
admission code does not read the result time changed by that omitted test.
It exercises 185 retained tree instructions. The bounds interpreter captures
each clip-call argument and supplies success solely to inspect all six planes;
it does not claim those synthetic calls accepted an actual hull. All selected
fields, candidate order/counts and plane values agree exactly with JS within
the stated finite Float64/x87 approximation. Existing 108 complete plane-helper
comparisons continue to pass.

Read-only staging checks produce all 1,746 additional planes for the 291
original 17_25 hulls. The previously recorded merchant ray, with extent
`(Float32(0.1),Float32(0.1),5)`, visits 20 nodes and selects no BSP leaf hulls.
The private receipt is
`tmp/restart-audit/bsp-sweep/candidates-and-bounds.json`. This does not exclude
the separately recorded nearby static actor or certify actor origin, terrain,
adjacent levels, the trace wrapper or final camera behavior.

To complete the world box sweep, the remaining work is explicit: verify the
flagged-plane operation and owner-transform bindings; implement and verify the
edge/bevel planes after `0x10748815` (including unresolved vector-returning
calls at `0x1074897c`, `0x10748b64` and `0x10748d27`);
then combine them with the independently verified final interval/time slices
below. The adjustment still depends on an unresolved metric-returning call at
`0x107463e3`. These pieces must be resolved before treating `continues` as a
world collision result or using this slice as the default camera trace.

### Final interval admission and explicit-metric time adjustment

The follow-up static import investigation did not bind `0x10745650`.
Independent raw DWORD reconstruction still produces six NOPs, and the
ordinary Engine PE import table has no Core imports (see the linked recovery
evidence). A scoped filename census under the owned `assets` and `tools`
directories found only the already pinned Engine build, not an independent
unprotected comparison build. No protector/native DLL was executed. The
Core `Flip` candidate remains unadmitted; these new operations do not consume
or repair flagged hull planes.

The retained block `0x10748e10..0x10748e83` is now checked independently by
`adoptBspSweepInterval({enter,exit,normal})`. It accepts exactly when:

```
enter > -1 && exit > enter && exit > 0
```

All comparisons are strict. An accepted negative entry remains negative at
this stage; no `[0,1]` clamp or normal normalization is inserted. Native code
writes entry to result `+0x24`, copies all three normal DWORDs, copies the
source owner/model references, and sets its found-result field `+0x5fc` to 1.
Rejected fixtures leave the prior result record untouched. The JS operation
returns only an interval-adoption result, never a world hit; its input must
already represent the completed native hull/bevel tests, which are not yet
available end to end.

The nonzero-extent wrapper's intact time block is
`0x1074973c..0x107497a7`. It is reached only after the found-result flag is
set. Both calls at `0x10749782` and `0x10749796` target the retained
`0x10307743` E9 stub, which directly resolves to `0x103704b0`. That complete
helper body implements a finite Float32 clamp. Unlike the erased plane call,
this target binding survives in the original instructions.

`adjustBspSweepTime({time,nativeMetric})` reproduces the following stores;
`f32` means a Float32 store, and the divisions/subtraction use the stated
Float64 approximation of native x87 intermediates:

```
lower   = f32(f32(0.1) / nativeMetric)
upper   = f32(4 / nativeMetric)
backoff = clamp(f32(0.1), lower, upper)
time    = clamp(f32(time - backoff), 0, 1)
```

The source double at `0x108a01b0` contains exactly `Float32(0.1)`, while
`0x108a42e0` contains `4.0`. Both clamp helpers return a stored Float32.
The metric is an **explicit supplied Float32**, originating from the still
unbound call at `0x107463e3` and its store at state `+0x5f8`. The JS API does
not rename it length, calculate it from endpoints, or accept missing/zero/
negative/nonfinite inputs. This narrow positive-finite arithmetic domain is
not a claim about the unresolved callee's complete domain. Hit-position
construction, material selection and overall trace aggregation remain outside
this slice.

The checker pins 17 further instruction anchors and three complete ranges:

| Range | SHA256 |
| --- | --- |
| `0x10748e10..0x10748e85` | `980b731cb4bb0f8b1823cbc5b3164985384f24759af28d36dc7bc4dfcae73264` |
| `0x1074973c..0x107497a7` | `9001150b3ec2c9f3e63dd0b416b757c523bf3de0438dc6c30d842557d6496c7d` |
| `0x103704b0..0x103704e6` | `b70b787f404c9dea5d3a4cec672683404a3d63b72c4a1e4f532abda3e90cba8b` |

It interprets all retained admission instructions for 106 synthetic intervals
and the time block plus both actual clamp bodies for 144 supplied metric/time
pairs. The fixtures include strict-boundary ties, negative entry, each clamp
branch, and source Float32 rounding. All outputs agree with the separate JS
implementation. Four added portable tests cover boundaries, preserved result
normal, explicit metric requirements and overflow refusal. No runtime
camera/main/world integration or private source asset was changed.

Reproduce with:

```sh
python3 tools/ui/check_bsp_camera_native.py --check
node --test editor/world/test/bsp-collision.test.mjs
```

### Retained bevel-pair admission

`selectBspSweepBevelAxes({planeA,planeB})` closes the next call-free boundary.
It requires **already oriented**, finite Float32 planes; it neither accepts raw
LeafHulls references nor substitutes the unbound flagged-plane operation.
It returns only `scope: "bsp-sweep-bevel-axis-selection"`, never a bevel plane
or a hit. Original plane W does not participate in this admission step.

The classifier at `0x1074566e..0x107456e6` records two bits per normal axis:
negative/positive X use 1/2, Y use 4/8, Z use 16/32. Exact zero, including
negative zero, contributes neither bit. For each pair the source considers
X, then Y, then Z. An axis advances to the later vector helpers only when:

1. OR-ing the two masks includes both signs on that axis.
2. The stored Float32 dot product of the two cross-with-axis vectors is
   **strictly greater than Float32(0.001)**, from original constant
   `0x108d7100`. Equality does not advance.

For normal `(x,y,z)`, the three intermediate vectors are `(0,-z,y)`,
`(z,0,-x)` and `(-y,x,0)`. Native code stores their components and then the
dot product. This is not a normalization or an assumption about unit normals.
Opposite axis signs alone are insufficient: exactly opposed axis-aligned
planes have projected dot zero and request no bevel on that axis.

The enclosing loops visit saved plane `i` in increasing order and each earlier
plane `j < i` in increasing order. A later clipping failure can terminate the
hull, so this selector does not claim that every admitted axis is eventually
executed. The subsequent intersection helper and three vector-returning calls
remain unbound; their outputs are not fabricated from this test.

The native verifier adds 20 anchors and these four exact ranges:

| Range | SHA256 |
| --- | --- |
| `0x1074566e..0x107456e6` | `ea13aa713e1df69e2ac2eb3331479bf96331753befc35e1e9c61b09ac41acb66` |
| `0x10748856..0x10748914` | `cfa6cbd9f5f289482718dc3f276ae4c1c63fceac0fa2c89531fb5d14f5ed37fc` |
| `0x10748a4a..0x10748afa` | `165914c054c09340cb87ed1e8f309f973c03a1dfd429962c494053dbd77c4b5a` |
| `0x10748c2a..0x10748cc2` | `2e6bf7317eb0520536c521778cb04365aee77269177aec48c7ad4e81c8687154` |

It interprets all **184 retained instructions** across 787 plane-pair cases:
every nonzero −1/0/+1 normal pair, each axis's adjacent Float32 values around
the strict threshold, and 96 deterministic oblique cases. Masks, admitted axes
and stored dots agree with the independent JS implementation. No call is
intercepted or supplied an invented return value in these four blocks. The
usual Float64 approximation of x87 extended intermediates remains explicit.
Four additional portable tests cover sign gates, strict thresholds, axis
order, source immutability, unknown orientation and arithmetic overflow.

A read-only check of the previously staged source records shows why later
bevel work cannot be omitted. For each unique hull offset, only records with
**no flagged references** were admitted to this count; each raw node plane is
then its unchanged no-owner input:

| Tile | Total hulls | Unflagged hulls | Pairs checked | Pairs admitting an axis | Admitted axes | Hulls admitting an axis |
| --- | --- | --- | --- | --- | --- | --- |
| 17_25 | 291 | 37 | 523 | 134 | 136 | 32 |
| 22_22 | 832 | 89 | 1,229 | 30 | 34 | 14 |

These counts are structural admission checks, not observed collisions or a
promise that every pair survives earlier clipping. They use the ignored
`tmp/restart-audit/bsp-<tile>-source/bsp-collision.json` records, enumerating
`decodeBspLeafHull` once per distinct `collisionBound` and the new selector for
each `j < i` pair. The flagged-plane binding, native metric and complete bevel
construction remain required before default camera adoption. No world asset
or camera behavior changed in this checkpoint.
