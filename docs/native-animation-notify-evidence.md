# Elbera Tools: original skeletal notify clock

This evidence covers the owner's Interlude `USkeletalMeshInstance::UpdateAnimation`
and the source notify array it consumes. It is a static proof for this exact build,
not a run of the original client. The supported portable model has an explicitly
enabled channel, finite positive ordinary playback, immutable callback state, and
**no batch that requires native class filtering**. The removal and channel-default
limits below are intentional admission boundaries.

Reproduce the pinned original-code checks:

```sh
python3 tools/ui/check_anim_notify_native.py --check
python3 tools/ui/check_anim_notify_native.py --json
```

Run portable tests without client files or Capstone:

```sh
python3 -m unittest discover -s tools/ui -p test_anim_notify_native.py -v
```

The verifier checks 91 Engine instruction anchors, 16 complete decoded ranges,
named Core methods and five Core anchors, 90 comparisons executed through the
actual native comparison/branch instructions, and six executions of the native
remainder arithmetic. The 23 portable tests cover ties, source order, endpoints,
null records, negative remainders, loop/tween budget sharing and rejected gaps.
No decoded code, source animation values, poses or client files are distributed.

## Provenance and source record

| Input | SHA-256 |
| --- | --- |
| `assets/interlude/system/engine.dll` | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| `assets/interlude/system/core.dll` | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |

Engine PE base is `0x10300000`; all addresses below are RVAs unless explicitly
marked VA. The shared decoder derives the DWORD subtraction key from the original
`UTerrainSector::IsTriangleAll` sentinel and follows exported E9 stubs. See
[terrain evidence](native-terrain-evidence.md) for that recovery method. Several
imported calls are erased NOPs; their limitations are not hidden by the verifier.

The named skeletal getters bind sequence `+0x1c/+0x20` to a notify array/count.
Its 12-byte memory record is Float32 time at `+0`, function FName at `+4`, object
reference at `+8` (`0x3b3cc0`, `0x3b3cf0`, `0x3b3d20`). The serializer at
`0x2e54c0` writes time, name, then object for archive version >= 112; the older
branch clears the object. The array reader `0x2e60e0` increments its index and
reads each record in serialization order. Neither this reader nor the crossing
loop sorts by time.

`UMeshAnimation::PostLoad` (`0x3b1910`) also calls the source-named
`FMeshAnimSeq::UpdateOldNotifies` (`0x2e5cd0`). Its legacy function branch creates
an `Engine.AnimNotify_Script`, copies the function into its `+0x38` field, replaces
the notify object and clears the record's function name. The class constant and
stores are pinned; the imported FName comparison/construction/allocation bodies
are erased. Thus a raw null object **with a named function cannot be classified
as no callback**. The runtime admission used here requires function `None` or an
independently resolved post-load Script object. A null object with function None
still participates in time splitting, but the dispatch loop skips its callback.

## Ordinary casting gates

`MagicProcess` calls Pawn `PlayAnim` on channel 0, with source sequence, computed
rate/tween, loop iff phase equals the flexible index, and final Pawn flag 1
(`0x211f78`–`0x211fa6`). Pawn forwards the first five arguments to skeletal
`PlayAnim` (`0x3a7de3`–`0x3a7e0a`). The sixth flag updates Pawn `+0x710/+0x70c`;
it does not enable channel notify dispatch.

Positive skeletal PlayAnim sets channel `+0x34` to `bool(notifyCount)` in both
one-shot and new-loop setup (`0x3b3193`, `0x3b3442`). The N=1 special case clears
it. UpdateAnimation also requires actor `+0x104` non-null, channel `+0x44 == 0`,
a valid current sequence, and the ordinary active-channel checks. There is no
Role comparison in this notify branch.

The named `EnableChannelNotify(channel, enable)` method (`0x3b4380`) stores
`channel.+0x44 = !enable`. **The fresh-channel default is not proved**: the array
allocator call in `0x3b2700` is erased. The verifier pins Core `Add` and
`AddZeroed`, but the push arguments alone do not prove which was called. A port
must carry an explicit supported channel-enabled input; this proof does not
authorize enabling every channel unconditionally.

## Batch contract for the supported branch

For one ordinary positive-rate advancement, retain Float32 `oldFrame`, advance
to `candidateEnd = f32(oldFrame + rate * f32(delta))`, then:

1. Collect every source index satisfying **`oldFrame < f32(t) <= candidateEnd`**.
   Keep serialized index order, including equal times. Do not clamp non-shot
   times to `[0,1]`; original records can lie outside that range.
2. Examine the complete batch before changing playback state. Native attempts
   to filter a second/subsequent AttackShot-class object and every BoneScale
   object. Reject this batch as unsupported when either is present, because of
   the aliased removal boundary below. Class predicates must come from original
   ancestry, not a guessed display name.
3. Initialize `currentFrame=candidateEnd`, `remaining=f32(delta)`. For every
   admitted index, in source order, store:

   ```text
   remaining = f32((currentFrame - f32(t)) * remaining
                   / (currentFrame - oldFrame))
   currentFrame = f32(t)
   ```

   `oldFrame` stays unchanged throughout the batch. The first expression has
   Float64 intermediates in the portable evaluator; native x87 intermediate
   bit parity is not claimed. Both original Float32 stores are retained.
4. Expose that current frame before invoking the object's virtual Notify at
   slot `+0x68`, with `(meshInstance, actor)`; mesh `+0x1c0` receives the channel
   number first. Null objects execute the same arithmetic but no callback.
5. Run the existing endpoint logic **after the entire batch**, against the
   last stored notify frame, not the pre-notify candidate endpoint.

The source implementation is `0x3bab4b`–`0x3bad5f`. Comparison instructions are
executed independently by `native_crossing`; the actual call-free x87 slice
`0x3bacc6`–`0x3bacd7` is executed by `native_split_delta`. Portable reference
functions are `dispatch_batch` and `advance_channel` in the verifier.

This differs from an ideal “earliest event, advance remainder, repeat” loop.
Stable synthetic fixture: `old=.125`, `candidateEnd=.875`, `delta=.75`, ordinary
notify times `[.25,.5]`. Both callbacks run; their remainders are `.625` and
`-1.25`; final frame is `.5`. With `AnimLast=.875`, the source exits that channel
and discards the remainder. Equal-time callbacks are both retained and zero the
remainder. Do not sort, clamp negative remainders, restore `candidateEnd`, or
deduplicate ordinary callbacks under a native parity claim.

## Endpoints, loops and advancement cap

Endpoint handling begins at `0x3bad5f`:

- If `currentFrame < AnimLast`, exit the channel update. A notify batch does
  not cause an automatic remainder replay here.
- A non-loop reaches/clamps to `AnimLast` and zeros its rate after the batch.
  Thus a notify beyond the endpoint, even above 1, can dispatch on an overshoot
  before the clamp. The endpoint remainder uses the already modified frame and
  delta, not the original candidate values.
- For loops with `AnimLast <= currentFrame < 1`, consume the remaining delta
  without wrapping. At `currentFrame >= 1`, compute
  `f32(remaining*(currentFrame-1)/(currentFrame-oldFrame))`, reset frame to zero,
  and revisit channel advancement while remaining delta is positive. A notify
  exactly at 1 makes this later endpoint remainder zero. On the next cycle a
  time-zero notify is excluded by the strict lower crossing boundary.
- Positive initial tween crossing uses the same remaining-time loop. The
  counter is reset per channel, incremented before each advancement, and an
  attempted fifth advancement exits (`0x3baab6`–`0x3baac2`). Tween and loop
  crossings share the four-step cap. **A whole notify batch consumes one step,
  regardless of callback count.** Excess remaining time is discarded.

The separate [terminal/tween proof](native-animation-terminal-evidence.md)
establishes the source normalized rates, initial epsilon and tween arithmetic.

## Aliased removal and callback limits

The class filter does not call a plain remove-by-index. It passes the address of
the current candidate-array element (`0x3bac4b/0x3bac7a`) to helper `0x3016a0`.
That helper repeatedly dereferences the supplied pointer (`0x3016b8`) while
removing matches. Its wrapper's imported removal call at `0x25717` is erased.

Named Core `FArray::Remove` (`0x523c0`) moves trailing elements **in place** via
named `appMemmove`, decreases count, then conditionally reallocates. If this is
the erased target, the argument aliases changing data: a removal can consume
the complete remaining tail. Core Add's initial capacity is 33; at that small
capacity Remove keeps a non-empty buffer in place. The optional
`small-in-place-alias` diagnostic models precisely that conditional domain.
It is **not an admission of the unresolved Engine-to-Core import identity**.
The default portable model rejects all batches requiring removal. In particular,
“keep first AttackShot, drop later AttackShots, retain all unrelated records” is
not a proven replacement.

The dispatch loop snapshots candidate indices and sequence pointer, but re-reads
channel frame for each callback. There is no generation check or sequence
reselection between callbacks: it increments the local index immediately after
Notify returns (`0x3bad38`) and continues. Outer advancement checks active state
again only if control returns to `0x3baa7c`. Mesh status is set/read through named
methods, with bit-2 handling at the outer exit; that is not a proof of general
recursive-update or arbitrary destruction safety. The portable clock excludes
callbacks that replace/free the channel, sequence arrays or actor. Browser
lifecycle guards remain a separate safety obligation.

Pawn pending-action handling, Sound selection/volume, particle dispatch and
general quaternion interpolation are separate proof scopes. These boundaries
must remain visible when integrating the clock.

## Browser integration checkpoint

`editor/world/js/animnotify-clock.js` implements the bounded no-removal clock;
`castplayback.js` uses it for ordinary Character casts. The browser explicitly
sets the enabled-channel input for these casts. This is a declared browser
policy, not a recovered fresh native channel default. Missing source fields,
legacy named functions and removal-dependent batches remain unsupported.
The clock returns an entire validated event batch before presentation callbacks;
these callbacks are observational/direct-audio only. Pawn pending skill state,
LastShotName comparisons and native effect dispatch are not thereby implemented.

`check_anim_notify_runtime.py --check` compares actual JavaScript results and
input immutability with the independent reference, whose comparison/remainder
operations are checked against the original instruction slices above. Optional
`--source-coverage` freshly reads original pawn metadata: all1,008 A–L magic
selector/model/stance combinations have complete phase sources without filtering
potential. Of the larger2,688 theoretical matrix,1,743 have complete slots and
177 combinations contain a sequence with possible duplicate-Shot removal.
These are source-slot coverage counts, not complete skill or playable coverage.

The Elbera pawn inspector displays serialized event order and offers direct
Sound playback using verified fields and exact source references. Source null
records appear in the log without executing a callback. Sound decoding is
asynchronous in browsers; cancelled/replaced/session-retired actors cannot start
newly decoded audio. Already playing sounds are not stopped by this safeguard.
