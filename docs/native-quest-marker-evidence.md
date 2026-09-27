# Elbera Tools: original quest-update marker

`python3 tools/ui/check_questmark_native.py --check` rereads the original client
and checks 106 instruction anchors, named native consumers, original embedded
UnrealScript, and the exact XDAT record boundaries. `--emit` additionally writes
the ignored `assets/gamedata/questmark.json` consumed by the browser. It emits
provenance and the required layout references, never decrypted native code.

The source build pins are:

| Input | SHA-256 |
|---|---|
| Engine.dll | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| NWindow.dll | `af6c3437f3ccf1b26af8b066e0bbd791c7909c94bd3c7d9e3c68c5edcfe059a7` |
| Interface.u | `5da491d8234863a94bfa1959bcb0be2cd5cdf81110003785436eecc04c86decd` |
| Interface.xdat | `a7969a86d3b676d95cfd42cfd6cd0742c07d7941250dbb63a2ba6d937961c1f4` |

Engine uses its existing in-memory recovery, with the limitations described in
[the recovery evidence](native-engine-recovery-evidence.md). Native addresses
below are virtual addresses; Engine base is `0x10300000`, NWindow `0x10000000`.

The packet dispatcher compares opcode `0xfe` at `0x10421be0`, indexes the signed
extended word with stride `0x104`, and dispatches from `0x10a67610`. Slot `0x1a`
is `0x10a69078`: registration at `0x10839135` binds the stub `0x1030cde7`, next to
the original `ExShowQuestMarkPacket` literal. That stub reaches `0x1041cb90`,
whose parser format is `d`. The parsed signed quest ID is passed through the
parameter stack to UGameEngine virtual slot `0x49c`, independently bound by the
exported `OnShowQuestMark` symbol. Its body at `0x10489fc0` forwards to console
slot `0x3bc`, which the original NWindow vtable maps to `0x10153b50`.

NWindow constructs `QuestID=<value>` and emits event 1520 at `0x10153bc9`.
Freshly decoded `Interface.u` contains `QuestBtnWnd`: it registers that event,
shows the window/button, and calls `BeginEffect` with the supplied ID. The
native `execBeginEffect` reaches `0x100051e0`, storing the ID at button `+0x34c`.
Repeated markers replace that one stored value; the source does not maintain
a queue of all changed quests.

The quest button's original XDAT effect type is 1. Native
`XMLEffectButtonData::Serialize` at `0x100db3c0` reads type `+0x88`, followed by
five texture strings. Its creation method forwards the type and textures to
`NCEffectButton` at `0x100075a0`; type becomes button `+0x348`. The native
`OnLButtonUp` case for type 1 at `0x100066a9` opens MainWnd tab 4, then emits
event 730 with the stored ID. The source MainWnd script labels that tab with
system string 118. `QuestBtnWnd.OnClickButton` hides the marker.

`QuestTreeWnd.HandleQuestSetCurrentID` receives event 730. For a positive ID it
expands `root.<ID>` and the last child chapter, then refreshes target guidance.
The browser performs the same ID/last-chapter selection in its existing journal
window. It sends no quest bypass, action request, or tutorial response.

XDAT records 106171 and 106518 supply a 32×32 marker. Its own BottomLeft is
anchored to ChatWnd TopLeft with offset `(42,-5)`; the child button is at `(0,0)`.
The [shared native layout proof](native-layout-evidence.md) independently binds
these anchor enums and subtract-own/add-target arithmetic. Thus browser top-left
is `(chat.left + 42, chat.top - 5 - 32)` in source UI pixels, using the port's
existing UI scale. Missing source layout/art or a missing chat anchor draws no
substitute. Record SHA-256 is
`89d38ca40b6bf8a6107ab291904f82bf791f7793f1d45b74c6cc38cdd07ed8a7`.
Original `SystemMsgWnd.ChangeAnchorEffectButton` preserves those offsets while
switching the target to SystemMsgWnd when that separate window is shown, and
back to ChatWnd when hidden. The current browser implements the ChatWnd branch;
this does not claim support for the separate SystemMsgWnd anchor branch.

The browser now implements the original ordinary pointer textures, discrete glow
clock, two paint rectangles, and subsequent blinking highlight. It preserves the
full source UV extent rather than cropping to the nontransparent texture bounds.
The containing MainWnd tab UI and quest target guidance remain unported. Native
GPU composition/gamma, inherited render-context alpha/dimming, and special native
capture/keyboard state 3 have not been established as pixel-identical to the DOM.
These limits are separate from the recovered frame selection and timer rules.
The gateway drops
transient markers from pre-entry, retired, or closed sessions; the browser
retires pending source loading on session reset. These are browser connection
lifecycle rules, not new quest progression rules.


## Discrete effect clock and native paint

The source `NCEffectButton` vtable `0x10230a44` maps timer slot `+0x94` to
`0x10004fd0` and paint slot `+0x18c` to `0x10005aa0`. Original diagnostic strings
independently name OnTimer, StartEffect, and OnPaint. XML creation at
`0x100dbc7e` supplies a 500 ms blink period. StartEffect at `0x10005124` resets
scale to 50 percent and alpha to zero, sets rising/active, then registers IDs
`0xf0e0f0`, `0xf0e0f1`, `0xf0e0f2` with periods 500, 10, and 50 ms respectively.
It does not reset the blink flag or remove existing timers.

TimerCheck `0x1014b160` stores `float32(elapsed + float32(deltaSeconds))`, converts
the unsigned period to seconds and stores that as Float32, then fires only when
elapsed **strictly exceeds** the period. It subtracts exactly one period. The
console loop `0x1016a6ea–0x1016a7a6` visits each timer once per frame, first
collecting all ready callbacks in insertion order, then dispatching message
`0x113`. There is no within-frame catch-up loop. Consequently the effect's wall
clock length depends on the client's update cadence; a CSS duration would not
reproduce the native behavior.

SetTimer appends a 20-byte record at `0x101505a2`; it does not replace the same
ID. KillTimer at `0x1014b652` marks only the first live matching ID/receiver,
removed on the following timer scan. Already collected callbacks still run.
The browser preserves repeated BeginEffect registrations and callback ordering.
Clicking hides the marker while its clock continues, as the original global
timer scan does; session reset/disposal explicitly retires the browser clock and
queued callbacks so they cannot affect a new connection.

OnTimer increments alpha by 15 while rising. At exactly 255 it remains rising;
the next increment clamps to 255 and starts falling. Falling subtracts 15;
exactly zero remains active, and the following negative value clamps to zero,
marks opacity/size timers dead, and disables the glow. Each size callback adds
5 percentage points. Blink callbacks independently toggle their flag.

OnPaint first calls base NCButton paint. Ordinary state 0 uses the source normal
texture, state 1 the pressed texture, and state 2 the hover texture. The native
mouse-move bit-1 test at `0x10005745–0x10005751` chooses pressed versus hover while
inside; outside ordinary hit testing clears state. When glow is active, paint
adds two layers with alpha's low byte:

| Layer | Source texture | Rectangle in original UI pixels | Source UV |
|---|---|---|---|
| Fixed | first glow string | `(-48,-48,128,128)` | `(0,0,128,128)` |
| Growing | first glow string again | side `trunc((scale << 7)/100)`; x/y `16-trunc(side/2)` | `(0,0,128,128)` |

The repeated first-glow reference is an actual constructor rule, not a typo in
the port: `0x10007613` loads argument `+0x18`, and both loads into fields `+0x350`
and `+0x354` reuse that same argument. XDAT retains the distinct fifth texture
`glowbtn2`, but this constructor does not consume it for the second layer. The
renderer therefore must not substitute it based on appearance. When glow is
inactive and blink is set, a fully opaque 32×32 hover texture overlays the base.

The paint helper passes a clipping boolean, not a blend-mode boolean. Glow
rectangles use false and can extend outside the 32×32 button. Named original
`UCanvas::DrawTexture` resolves to Engine VA `0x10544b50`; its clipping branch is
at `0x10544b6d`, and its byte alpha becomes the draw color alpha at `0x10544d47`.
DOM opacity expresses the recovered source alpha but does not certify the
original material blending/filtering pipeline. No authored CSS easing or fade
period is used.

The verifier also pins four native code ranges and executes seven finite
TimerCheck arithmetic/boundary cases directly from disassembled instructions.
Its interpreter retains Float32 stores; Python double approximates extended
intermediates, so these cases do not claim universal x87 equivalence. Portable
Node tests separately cover equal-boundary non-firing, stalled-frame remainder,
source callback order, strict opacity endpoints, size callbacks already queued
at cancellation, repeated markers, full-UV geometry, pointer states, and stale
frame retirement across session reset.

Source-free checks:

```sh
python3 -m unittest discover -s tools/ui -p test_questmark_native.py
node --test gateway/test/questmark-packets.test.js editor/world/test/questmark.test.mjs editor/world/test/quest-confirmation.test.mjs
```

`/test/quest-journal.html` has an explicitly labeled marker replay and diagnostic
chat anchor. It uses the original art/text with simulated progress, and never
connects to the game server.
