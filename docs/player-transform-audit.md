# Player visual transform audit

Elbera Tools audit, 2026-09-26. **The browser now uses exact source scale;
complete native placement remains unresolved.** The former `nativeHeight`
fit had at most 0.115% error and was derived from mesh geometry, not server
collision height. It did not explain the reported floating sitting pose.

## Fresh original-source checks

The strict, declared-property-aware class decoder in
`tools/dat/export_npc_visuals.py` resolved all 14 player classes through
`LineageWarrior.<pawn> → LineageWarrior.LineagePawn → Engine.Pawn → Engine.Actor`.
Every class inherits both `DrawScale=1` and `DrawScale3D=(1,1,1)` from
`Engine.Actor`; no missing field was interpreted as an assumed default.

Original package SHA256 receipts:

- `LineageWarrior.u`: `747b1e7c3045c748c08b03b54893dc2d29cf7103379f19804ccbeb7764224558`
- `Engine.u`: `9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761`
- `Core.u`: `de5f0ee0a773327bce13c96622fd3c654cff7db88b9be065d1232590c140fda0`

Reading the original creation-part mesh exports directly found uniform
`MeshScale=(1.0299999713897705,1.0299999713897705,1.0299999713897705)` for
male Human Fighter, male Elf and male Dark Elf. The other 11 player models
use `(1,1,1)`. Parts of each current creation model agree on scale.
All 97 inspected creation-binding exports have `RotOrigin=(0,49152,0)` and `MeshOrigin=(0,0,Z)`;
Z ranges from 20.5 to 31.5. Tiny float differences between some parts are
preserved in the private receipt. Only **92 parts are present in the current
14 built glTFs**. Five additional `_ah` exports in the creation bindings are
absent from those models; the two counts describe different scopes.

The original Engine instruction verifier passed **51 checks**. Its proved
ordinary-render rule is the per-axis float32 product of actor DrawScale,
actor DrawScale3D, mesh MeshScale and an ordinary render multiplier of 1.
See [native actor evidence](native-actor-evidence.md). That proof is about
local scale; it is not proof of the complete player placement transform.

## Scale correction and retained placement

The previous `build_characters.py`/`Character.load()` path recovered scale
from `round(bindPositionYExtent × 100 × MeshScale.z, 1)` and loaded-model
height. The two extent factors approximately cancelled for these models.

A geometry-only pass through the actual vendored GLTFLoader retained all
mesh, node, skin and animation data while omitting material/image loading.
It reproduced that previous scale fit for all 14 models:

| Model | Original scale | Former height-fit scale | Relative error |
| --- | ---: | ---: | ---: |
| Human Fighter male | 1.0299999714 | 1.0309097714 | +0.0883% |
| Human Mystic male | 1 | 0.9990086348 | −0.0991% |
| Dwarf female | 1 | 1.0011476377 | +0.1148% |

The largest absolute error across the 14 models is about **0.115%**. The
manifest's 46-unit Human Fighter height is therefore not evidence of an
incorrect collision-height fit. The old comment calling this rounded value
“exact scale” is too strong.

`export_player_visuals.py` now supplies exact actor/mesh scale with qualified
class inheritance, original part hashes and current built-model hashes.
`Character.load()` uses `player-transform.js` to apply that per-axis scale
directly. Missing verified scale fails loading; the 1.75 m fallback is
removed. The updated bounds audit measures **zero scale error for all 14
models**, retaining the old height-fit calculation only as a comparison.

After scaling, `Character.load()` still subtracts the bounding-box X/Z
center and minimum Y. That is a geometry-dependent browser adaptation.
The private receipt records the resulting offsets. Native origin values
must not be added on top of this adaptation: actor placement, basis,
skeleton coordinates, heading and grounding require one coherent contract.

## Newly verified native placement evidence

`check_player_transform_native.py` uses the same original Engine hash,
PE mapping and in-memory recovery as [native actor evidence](native-actor-evidence.md).
It verifies **53 instruction anchors and 27 synthetic cases against the
actual import-free origin arithmetic**, rather than another port. The
Core extension adds **15 Engine anchors, 24 Core anchors, 100 matrix-product
cases and 100 point-transform cases** against the surviving original
arithmetic instructions.

- `USubSkeletalMeshInstance::MeshToWorld(float)`, RVA `0x3b5f20`, takes the
  normal branch at `0x3b61fc` when instance field `+0x84` is zero. It builds
  translation from Actor.Location plus PrePivot at Actor `+0x28c`, then
  constructs matrices from Actor.Rotation, mesh RotOrigin and source scale.
  The named original `FNMonsterRaceInfo::SetPrePivot`, RVA `0x1bb9f0`,
  writes the actor vector at `0x1bbbf1`, `0x1bbbfa` and `0x1bbc03`.
  This closes the former declaration-order inference about its identity.
- The operand sequence at erased imports `0x3b643d`, `0x3b6468`,
  `0x3b6493` is consistent with row-vector composition
  `Scale × RotOrigin × ActorRotation × Translation`. The exact imported
  matrix operator binding is absent, so the verifier preserves those
  erasures instead of silently emulating a chosen operator.
- When **both** instance `+0x80` and `+0x84` are zero, `0x3b6764..0x3b684b`
  directly subtracts transformed MeshOrigin from the resulting translation:
  `T[j] = f32(T[j] + f32(-OriginX*M[0,j] - OriginY*M[1,j] - OriginZ*M[2,j]))`.
  The intermediate and final Float32 stores are preserved by the evaluator.
  This is not a world-axis offset or a bounding-box-floor adjustment.
  The instance flags' names and fresh values remain unresolved.
- `UGameEngine::AdjustPawnLocation`, RVA `0x18e300`, compares the incoming
  position with `(Actor.Location.X, Actor.Location.Y,
  Actor.Location.Z − CollisionHeight)`. Named `SetCollisionSize` independently
  establishes the height field `+0x2f4`. Native Actor.Location therefore
  cannot be identified with the browser's terrain-height group origin.
- The ordinary `OnCharInfo` floor branch `0x195c04..0x195d63` sweeps the
  cylinder extent `(radius,radius,height)` from packet Z+height+20 to
  packet Z−10 using the named `ULevel::SingleLineCheck`, then supplies the
  hit position to `SpawnActor`. It also applies the source hit-time
  adjustment: `d=f32(hit.Time*12)`; when `d<1.899999976158142`, the resulting
  Z store adds `2.150000035762787-d`. Other branches, retries, collision
  geometry and walking physics prevent replacing this with an assumed
  universal `terrainZ+height` formula. User collision fields subsequently
  override class defaults through `SetCollisionSize`.
- `OnChangeWaitType`, RVA `0x19bbc0`, calls `AdjustPawnLocation` before its
  state/animation selection. No direct sit-only position adjustment was
  found in this method. That is not proof that every function it calls
  leaves placement unchanged; it does rule out inventing a sit offset from
  this trace.

The private receipt includes decoded range hashes. The entire original
Engine is pinned to
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`.
No original binary, decoded method or proprietary script is redistributed.

## Surviving Core matrix and allocation evidence

Original `Core.dll` SHA256 is
`9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf`,
image base `0x10100000`. It does not require Engine's section recovery.
The original exports independently identify these methods:

| Method | Export stub RVA | Body RVA | Verified behavior |
| --- | --- | --- | --- |
| `FMatrix::operator*(FMatrix)` | `0x2860` | `0x11240` | Standard 4×4 row/column product; one final Float32 store per component |
| `FMatrix::TransformFVector` | `0x2621` | `0x11990` | Row vector `(x,y,z,1)`; translation in matrix row 3; no homogeneous divide |
| `UObject::InitProperties` | `0x119f` | `0x5fb00` | Copy available template bytes after the `0x34`-byte object header, zero the remaining bytes |
| `UObject::StaticAllocateObject` | `0x3e7c` | `0x677c0` | Calls that initialization implementation |

The matrix operator receives the left matrix through ECX, a hidden output
pointer on the stack, then the right matrix by value; it returns with
`ret 0x44`. That ABI fits the erased Engine composition calls. The surviving
Core implementation and the Engine operands together support the candidate
`Scale × RotOrigin × ActorRotation × Translation`, but **do not restore the
erased import target**. An ABI match is not a recovered binding.
The [subsequent raw-file and startup recovery audit](native-engine-recovery-evidence.md)
independently confirms that the shared decoder did not remove these calls.
It recovers additional protector layers, but not their runtime repair targets.

The evaluator executes the actual Core arithmetic with synthetic Float32
inputs and compares it with a separately expressed formula. It includes
noncommuting scale/translation cases. The portable tests also distinguish
final-only Float32 rounding from rounding each addition, row-vector from
column-vector transforms, and affine transform from homogeneous division.
Float64 intermediates in the evaluator are bounded checks, not a claim of
universal x87 extended-precision equivalence. Decoded body hashes are in
the private receipt; for example the matrix product range
`0x11240..0x11488` (exclusive end) hashes to
`b504ddd93f0b7ad7f92beac4c606ca59b90a73bfa0077e6ad04f6136a96b7201`.

The named `ULodMeshInstance` copy constructor and assignment separately
copy instance fields `+0x80` and `+0x84`. The source default constructors
examined do not assign these fields. Native `USubSkeletalMeshInstance`
allocation passes its named class and eight arguments at `0x63720..0x6374c`;
class registration passes the named `ULodMeshInstance` superclass and
instance size `0x144` at `0x54940b..0x54941e`. Both call targets are erased.
Core's initializer demonstrably copies template defaults or zeroes new
bytes, but the original live class-default values and these Engine bindings
remain unresolved. Consequently **the normal-path flag defaults are still
unverified**. No assumed zero flags have been activated in the browser.

## Original positions versus exported positions

The optional `--basis` audit reads original version-5 LOD0 Lineage wedges
or rigid vertex streams directly, checks original lazy-array boundaries,
then reads current glTF POSITION accessors with their actual buffer views
and strides. The layout was compared with the local UEViewer reader;
the **owned UKX data**, not UEViewer-rendered geometry or PSK, supplies the
measured positions. The supported packages use file version 123 and
licensee versions 28/30.

All **92 present parts across all 14 models** have exact position-set
equality after the per-component conversion
`f32(originalX*.01), f32(originalZ*.01), f32(originalY*.01)`.
The negative-Y candidate fails for every upper body. This is a reflection
relative to the raw original coordinates; the world conversion in
`coords.js` is `(x,z,-y)*.01`. UEViewer's PSK Y mirror followed by the
assembler's PSK conversion explains this result. Applying source RotOrigin
as another browser rotation without accounting for that composition would
be unsafe. Set equality proves these bind positions, **not vertex order,
topology, skin weights, bone transforms, animation or final placement**.

The assembler also changes some face/hair root weights to the head within
an authored 15-unit radius and rigidly binds standalone hair rigs. Those
adaptations are separate from the position-set result and still need an
original-native justification. They are not certified by this audit.

For source target points, [legacy skill-effect evidence](native-legacy-skill-effects-evidence.md)
already proves Pawn's selection order: explicit EffectSpawnBoneIdx, then
existing SpineBone, then bone zero, returning the selected bone coordinates'
origin. Native `GetBoneCoords` calls `MeshToWorld(1)` at `0x3b7a80..0x3b7a99`.
Thus a browser bone position cannot be called the original world target
until the same placement/basis chain is closed.

**These findings alone do not justify an origin, heading, grounding,
bone-target or sitting-offset change.** The next correction needs the normal
instance flags, matrix-operator binding, native collision-center placement
and skeleton/export convention verified together. Existing recentering is
retained explicitly; exact local scale is the completed correction.

The ignored local receipt is
`tmp/restart-audit/player-transform-audit.json`; it includes source package,
class-default and mesh-export hashes, per-part transforms, built-model and
buffer hashes, actual loader bounds, runtime ratios and centering offsets.
The reusable Elbera Tools audit reproduces it without a browser, game
server, asset rebuild or account mutation. It requires the supported local
client under `assets/interlude/`, the generated creation bindings and built
player models under `editor/characters/`, Python with Capstone, and Node.js:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/dat/audit_player_transforms.py
PYTHONDONTWRITEBYTECODE=1 python3 tools/ui/check_actor_native.py --check
PYTHONDONTWRITEBYTECODE=1 python3 tools/ui/check_player_transform_native.py --check --basis --output tmp/restart-audit/player-placement-native.json
PYTHONDONTWRITEBYTECODE=1 python3 -S -m unittest discover -s tools/ui -p test_player_transform_native.py
```

For `audit_player_transforms.py`, `--output PATH` selects the receipt
destination; its default is the ignored path above. The new native verifier
prints evidence unless `--output` is supplied. Relative output paths use the current working directory, while
input paths resolve from the repository. `audit_player_bounds.mjs` is the
geometry-only helper, using the actual vendored GLTFLoader with image and
material loading removed from an in-memory copy. These tools contain code,
not client assets or receipt contents. Their private inputs/output are not
a public asset distribution, and the audit is not a complete native
player-transform conformance test.
