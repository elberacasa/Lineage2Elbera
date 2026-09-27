# Elbera Tools: original gauge state and remaining browser gap

`SetupGauge` is an independent original-client feature. The browser currently
parses and forwards its packet but has no `gauge` handler. Its existing fixed
bottom cast bar is a separate approximation driven by `MagicSkillUse`. Seeing
that bar during Common Craft does not establish support for the original gauge.
No runtime behavior was changed for this investigation.

## Reproduce and scope

```sh
python3 tools/ui/check_gauge_native.py --check
python3 tools/ui/check_gauge_native.py
```

The checker reads the owner's original `assets/interlude/system/engine.dll`,
SHA256 `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`,
image base `0x10300000`. It reuses the documented in-memory recovery in
[native-engine-recovery-evidence.md](native-engine-recovery-evidence.md), verifies
14 state/draw bodies, 193 instruction anchors and 20 exact range hashes. It neither
executes the DLL nor exports its contents. Five finite equation examples check
the interpretation of explicit Float32 stores; they are **not** an x87 emulator
or a native renderer differential test. A separate bounded evaluator now
compares **60 draw-argument cases against 263 actual decoded instructions**.
It intercepts only the named bitmap dimension getters and `UCanvas::DrawTile`;
dimensions and the already transformed canvas point are explicit test inputs.
The comparisons now also capture the four color-plane arguments, including the
original alpha value **128**. Separate checks read seven original texture records,
original class defaults/reflection, and surviving D3D named imports.
No erased helper is substituted. Float64 intermediates approximate x87 extended
precision; the original Float32 and Float64 stores are preserved.

Addresses below are virtual addresses for this exact build. Several helper call
sites are six NOPs in the recovered copy; actual runtime restoration and their
bindings remain unverified. No imported loader or vector helper is identified
solely from a plausible call shape.

## Independent countdown state

The named `UGameEngine::OnSetupGaugePacket` body at `0x10492690` checks for a
local viewport controller/Pawn, obtains its user record, and reads three values.
Its branch at `0x1049270b..0x10492762` selects one of four separate
`FL2ResueOrCast` objects and calls the named `Reset(int,int)`:

| Packet ordinal | Configured server name | User-record offset | Native drawing selector / texture |
| --- | --- | --- | --- |
| 0 | BLUE | `+0x1e0` | 2 / `L2UI_CH3.Etc.Minibar_Magic` |
| 1 | RED | `+0x1d4` | 1 / `L2UI_CH3.Etc.Minibar_Arrow` |
| 2 | CYAN | `+0x1ec` | 0 / `L2UI_CH3.etc.Minibar_water` |
| 3 | GREEN | `+0x1f8` | 3 / `L2UI_CH3.Etc.Minibar_Food` |

Other ordinals select no object. No skill ID, level, name, or 410 ms threshold
appears in this handler. The four active flags are independent.

The original exported spelling is `FL2ResueOrCast`. `Reset` at `0x10358730`
sets active to 1, total to `f32(maxTime)`, and elapsed to
`f32(total - time)`. The subtraction uses the original integer `time` through
`FISUB`, rather than first rounding that integer to Float32.
`UGameEngine::Tick` at `0x105974d0..0x1059751f` multiplies its delta by the
original double constant 1000, stores Float32 milliseconds, and calls `Add` on
all four objects. `Add` at `0x103587a0` advances active elapsed time with a
Float32 store and disables the object when elapsed reaches or exceeds total.
`Disable` at `0x10358760` clears the active flag directly.

`GetLength(width)` at `0x10358770` computes
`f32(f32(total - elapsed) * width / total)`. Thus time 250, maxTime 1000 starts
at one quarter width; time/maxTime 500/500 starts full and decreases. The draw
caller truncates the returned length toward zero. These methods contain no
general clamp or minimum-duration guard. Zero/invalid total, exceptional x87
values and the exact first frame of a zero-time packet are not established by
the finite examples and must not be replaced with an invented default duration.

## Drawing context: attached to the local actor

The named `FDynamicActor::Render` body starts at `0x1065aae0`. It saves its
dynamic actor at `0x1065ab09`, loads the viewport controller's Pawn at
`0x1065d2b9..0x1065d2c5`, and requires that Pawn to equal the rendered actor at
`0x1065d73b..0x1065d743`. It then checks the four active flags. This is a local
actor rendering path, not a fixed screen HUD window or a remote-actor cast bar.

The position calculation starts with actor XYZ fields at
`0x1065d39f..0x1065d3d7` and subsequently applies additional offsets and
view-related calculations. For each active gauge the caller supplies a world
vector, nominal full width **96**, height argument **2**, integer remaining
length and the drawing selector above. The caller invokes virtual slot `+0xe8`;
the original `UCanvas` vtable binds that slot to the named `DrawDepthBar`
(`0x10557fc0`). Its call at `0x105582ef` invokes the named
`FSceneNode::Project` on the passed vector. This establishes an actor-attached,
projected depth bar. It does **not** establish a fixed CSS size/position or an
exact head/bone anchor.

`DrawDepthBar` directly references the four textures above at
`0x10558029/0x10558095/0x10558101/0x10558162`, plus
`L2UI_CH3.etc.Minibar_Back21`, `Minibar_Back22`, and `Minibar_Back23` at
`0x105581c8/0x1055821a/0x1055826c`. Their references are verified; texture
extraction, complete projection, effective GPU state, depth/occlusion, the full world anchor
and all visibility conditions remain unported. The next sections close the
bounded rectangle/UV call arguments and record the surviving stacking arithmetic.
Do not substitute a guessed feet-plus-height anchor or authored gradient.

## Exact rectangle and texture-span arguments

The argument slice `0x1055846a..0x10558784` ends at the fourth draw call. The
original `UCanvas` virtual slot `+0x70` is the named `DrawTile`; the original
`UTexture` slots `+0x78/+0x7c` are `UBitmapMaterial::MaterialUSize/MaterialVSize`.
Those accessors read the original width/height fields `+0x580/+0x584`.

Let `(X,Y,Z)` be the already prepared point from the preceding code: X/Y come
from its canvas transform, while the store at `0x1055837c` preserves the
projected Z. Let `W` be the nominal full width, `H` the height argument, `L` the
unsigned integer remaining length, and `U21/U23` the two end textures' original
widths. The literal adjustment at `0x10558382` gives `x = f32(X - 44)`.
If the final boolean argument is true **and** drawing selector is 2 (BLUE),
`0x1055846a..0x1055847e` additionally gives `y = f32(Y - 5)`; otherwise `y=Y`.
The caller derives this boolean from Pawn field `+0x718` being non-null. This
note does not assign that field a semantic identity without a separate binding.

The four calls occur in this exact order:

| Texture | Destination X | Destination Y | Destination width | Destination height |
| --- | --- | --- | --- | --- |
| Back21 | `x-1` | `y-1` | `U21` | `H+2` |
| Back22 | `x-1+U21` | `y-1` | `W+2-U21-U23` | `H+2` |
| Back23 | `x-1+W+2-U23` | `y-1` | `U23` | `H+2` |
| Selected fill | `x` | `y` | `L` | `H` |

Every call passes UV origin `(0,0)` and the **full** corresponding material
width and height as its UV spans. Thus the fill's full texture is stretched to
the remaining length; the source call does not shorten its UV span to crop the
right end. The original actor caller uses `W=96` and `H=2`. The checker preserves
the exact source stores and call argument order, including all four selectors,
the conditional BLUE offset, zero/partial/full length, and offscreen/fractional
input coordinates. These are primitive arguments, not a claim of identical GPU
sampling, clipping or blending. Negative/overflow integer and nonfinite inputs
are outside these finite comparisons.

There is a misleading nearby material setup: `0x105583a6` names the original
`UFinalBlend::PrivateStaticClass`, and `0x105583d3..0x10558422` configures the
object cached at `0x10c49afc`. But the four captured calls pass the **texture
objects**, not that cached FinalBlend. `UCanvas::DrawTile` separately consults
Canvas byte `+0x5c` at `0x10554a3e` and builds its own material state. Therefore
the nearby FinalBlend flags alone do not establish the effective gauge blend,
alpha-test or depth state. The next section follows the material actually passed
to the drawing primitive; the unused nearby FinalBlend is not that evidence.

## Original material and alpha, with a conditional renderer boundary

This extension also pins the owner's original files:

| Source | SHA256 |
| --- | --- |
| `D3DDrv.dll` | `05622ddea5d96aec5618bc1ae064af9d27d83178f78d9631b5448377502e1323` |
| `Engine.u` | `9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761` |
| `L2UI_CH3.utx` | `3cf853b9672a39811c5b956eca79459272e5e355435a6e5753a597503bea2f44` |

The texture package is read in place, with exact qualified outer chains and
bounded export receipts. All seven references resolve uniquely to `Texture`
exports with explicit `bAlphaTexture=True` and Format ordinal 7. Back21/22/23
have USize/UClamp **8** and VSize/VClamp **8**; the four fills have USize/UClamp
**8** and VSize/VClamp **4**. No pixels are emitted by this checker. Missing
properties such as bMasked are not silently assigned values by this check.
These actual dimensions make the three background widths **8, 82, 8** for the
original W=96 call. They are not the similarly named dialog textures.

`DrawDepthBar` sets a white FColor at `0x10558422`, calls the named
`FColor::Plane` at `0x10558430`, then **overwrites plane A with float 128.0** at
`0x10558435..0x1055843b` from literal `0x108b9a88`. The bounded instruction
comparison captures `(1,1,1,128)` in all four calls. This alpha is intentionally
not a normalized 0–1 value at this interface. The named FColor constructor and
Plane method also establish the fourth channel's byte/storage relationship.

In `UCanvas::DrawTile`, the retained texture-class walk at
`0x1040b4c0..0x1040b4e1` compares against the named UTexture class and follows
superclasses. Canvas Style selects an optional FinalBlend at
`0x10554a9b..0x10554b64`; **Style 1 bypasses that wrapper**. The original
Canvas default stream uniquely supplies Style=1, and its original Reset source
sets Style to Default.Style. This establishes the default/reset branch, not
that every later gauge call necessarily observes Style 1. The check does not
replace a full draw-order/state proof with that assumption.

The non-editor branch `0x10554ba3..0x10554c47` obtains the cached object whose
allocation requests the named **UL2ColorModifier** class `0x10c6d178` and sets:

| Member | Actual write / original identity |
| --- | --- |
| Material | `+0x578 =` selected texture/material |
| AlphaBlend | `+0x580` bit 2 enabled |
| AlphaOp | `+0x584 = 2`, original enum `P_SELECTARG2` |
| ColorOp | `+0x585 = 1`, original enum `P_SELECTARG1` |
| Color.A | `+0x57f = trunc(drawPlane.A)` = **128** |

The original reflected NEXT chain is Color, RenderTwoSided, AlphaBlend, AlphaOp,
ColorOp, followed by the enum. Typed native copy stores at
`0x1034c66c..0x1034c6b2` independently match the color/packed bool/byte layout.
The uniquely validated class defaults supply white Color and both booleans true.
The checker records the default-stream hashes and boundaries; it does not execute
the allocation calls or claim their erased import targets are restored.

This wrapper is consumed by retained D3D code. The original PE import descriptors
bind `0x100dd3d8` to `UL2ColorModifier::StaticClass`, `0x100dd130` to
`UObject::IsA`, and `0x100dd388` to FColor's DWORD conversion. The branch at
`0x100111d6..0x10011227` recognizes this exact class and transfers the blend bit,
two-sided bit, color and both operation values into modifier state. This is
stronger than identifying a helper solely by its argument shape.

The retained simple-material path at `0x1000d25a..0x1000d34c` reads that state,
installs factor color, enables the requested blend flag and selects alpha-test
reference zero for this AlphaOp. Its helper at `0x10007e86..0x10007f34`, **when
the base pass already has blend factors 5/6 and its alpha-blend flag enabled**,
sets stage alpha operation 4 and color operation 2. Therefore copying raw
P_SELECTARG2 directly into a new renderer would also skip native specialization.
The checker pins these writes and predicates; it does not emulate the complete
material compiler, assert that conditional pass state universally holds, or
certify GPU sampling/depth equivalence. In particular, alpha byte 128 is a proved
material input, not permission to set an arbitrary CSS opacity on an otherwise
unproved gauge rendering path.

This advances the next implementation boundary: extract these seven exact
original assets, preserve their full U/V spans and the source alpha input, and
finish Canvas state plus world-to-canvas placement before adoption. An opaque
fill or alpha 255 would already contradict the captured source arguments.

## World placement and ordering boundary

The actor anchor starts with Location plus the actor's vector at `+0x28c`, then
depends on collision-height/mesh and state-specific paths at
`0x1065d3e2..0x1065d5e0`. One bound-related helper at `0x1065d4d7` remains six
NOPs. The code also calls named `FSceneNode::Deproject` twice, with plane inputs
`(0,0,0,1)` and `(0,-1,0,1)`, subtracts the returned vectors, and invokes another
unbound helper at `0x1065d830`. A compatible vector-normalization ABI is not an
identified import. The primitive proof does not replace either helper.

After that helper, let `v` mean its actual vector output and `D` the integer
already obtained by the preceding distance/conversion calls. The retained
arithmetic offsets the initial gauge anchor by `v * f32((D/1000)*6)`.
Drawing order is CYAN, RED, BLUE, GREEN. After drawing CYAN and after drawing
RED, it multiplies the **same retained vector** in place by
`f32((D/1000)*3)` and adds it to the current anchor. If both CYAN and RED are
active the second increment therefore uses the already scaled vector; this
must not be silently replaced with evenly spaced CSS rows. BLUE does not
advance the anchor before GREEN. These steps are pinned, but their inputs,
exceptional values and full placement are not yet a browser rendering contract.

The projected point in the rectangle table also depends on the original
`FCanvasUtil` transform. `FSceneNode::Project` itself survives, but transform
construction includes unbound matrix operations, so the checker accepts the
result as an explicit input. The exact seven actor-gauge texture references are
not present in the current skin atlas; its differently qualified dialog
`minibar_*` entries are not substitutes. Source extraction and the remaining
placement and remaining effective material-state bindings are needed before
default runtime adoption. Specifically, FCanvasUtil's matrix-composition calls
at `0x106831de/0x10683305` and its following transform helper at `0x10683379`
remain six NOPs in the recovered copy. Plausible multiplication/inverse ABIs do
not identify them, so this checkpoint does not substitute Three.js projection.

## Current configured server and browser

These contracts describe this repository's **aCis server**, separately from the
original client evidence:

- `server/aCis_gameserver/java/net/sf/l2j/gameserver/network/serverpackets/SetupGauge.java`
  writes `C 0x6d`, then `D color`, `D time`, `D maxTime`. Its two-argument
  constructor sets maxTime equal to time; the three-argument form preserves both.
- `CreatureCast.java` sends BLUE only for its `_hitTime > 410` path.
  `PlayerCast.java` also has a BLUE send without that guard. The threshold is
  therefore neither a universal server gauge rule nor a proved native UI rule.
- `CreatureAttack.java` sends RED; `WaterTaskManager.java` sends CYAN including
  zero on exit; `Player.java` sends GREEN with separate current/max feed values
  and zero on stop. They cannot be reconstructed from skill-cast packets alone.
- `server/aCis_datapack/data/xml/skills/1300-1399.xml` gives Common Craft 1322
  a static hitTime of 500 ms. In the ordinary cast path this produces both a
  500 ms skill-cast event and a BLUE 500/500 gauge, explaining the visible overlap.

`gateway/src/gameclient.js` decodes all three fields; `gateway/src/bridge.js`
forwards `{op:'gauge', color, time, maxTime}` with color names. That forwarding
callback currently lacks the current-game/entered/closed guards used for other
transient messages. It should receive those guards before a future UI consumer
is enabled, so a retired connection cannot replace current-session gauges.

`editor/world/js/main.js` instead starts `SkillBar.startCastBar` from the local
`skillCast` event. `skills.js` applies an authored 410 ms cutoff and increases
width as `elapsed / hitTime`; it does not consume maxTime or the other colors.
`index.html`/`style.css` place that authored 160-by-7 bar near the bottom center.
The native countdown direction, independently keyed state and actor-attached
texture rendering are therefore still missing, even when Common Craft's
duration happens to match.

The next implementation should start with session-owned state for the exact
packet values and finish the original draw placement/material path before
replacing the current visual. Adding an empty handler or reusing the existing
bar merely to remove the unhandled-operation warning would conceal this gap.
