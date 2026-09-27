# Original Interlude mouse picking

This recovery uses the owner's original `assets/interlude/system/engine.dll`
and `NWindow.dll`, not another port or an emulator as the behavior oracle.
It establishes the ordinary skeletal-pawn cylinder, range, nearest-hit ordering,
and several eligibility rules. It does **not** establish full native collision
placement, every actor category, or complete visual/physics parity.

Reproduce without executing the original binaries:

```sh
python3 tools/ui/check_picking_native.py --check
node --test editor/world/test/picking.test.mjs gateway/test/collision-packets.test.js
```

The checker pins both source SHA-256 values, resolves original exports and
vtable entries, checks the relevant native instructions and constants, and
reports the original packet format strings. Its decoder is shared with
`check_tutorial_quest_native.py`; Engine's protected section is decoded only in
memory. Full local disassembly stays under ignored `tmp/restart-audit/`.
Nothing requires committing retail binaries, extracted scripts, or packet captures.

## Trace and primitive

Addresses below are virtual addresses for this build; Engine's image base is
`0x10300000`.

| Original function | Body address | Recovered behavior |
|---|---:|---|
| `UGameEngine::FindMouseTargetObject` | `0x1058daf0` | Camera-derived segment and world/actor query |
| `ULevel::L2SingleLineCheck` | `0x105c2af0` | Calls multi-hit query, takes first eligible result |
| `ULevel::L2MultiLineCheck` | `0x105c4a70` | Includes level BSP, terrain, actor collision structure and loaded adjacent levels |
| `FCollisionHash::ActorLineCheck` | `0x10523900` | Applies actor/source filters, calls `ShouldTrace`, `GetPrimitive`, then primitive `LineCheck` |
| `APawn::ShouldTrace` | `0x10617740` | Self/controller, dead-state, loading-resource and trace-category filters |
| `AActor::GetCylinderExtent` | `0x1033e620` | Returns `(CollisionRadius, CollisionRadius, CollisionHeight)` |
| `UPrimitive::LineCheck` | `0x10645de0` | Finite cylinder intersection around `AActor.Location` |

`ULevel` vtable slots `+0x10c/+0x110` resolve to the two L2 line-check exports.
The collision-hash path calls actor vtable `+0x160` (`ShouldTrace`), `+0x164`
(`GetPrimitive`), and primitive vtable `+0x6c` (`LineCheck`). The original
`USkeletalMesh`, `ULodMesh`, `UMesh`, and `UPrimitive` vtables all use
`UPrimitive::LineCheck` for the last slot. This is direct evidence for the
ordinary skeletal-pawn cylinder, not an inference from generic Unreal behavior.
Static mesh primitives have a separate implementation, so the result does not
license assigning cylinders to every prop or dropped item.

The world query sorts results by `FCheckResult.Time` at offset `+0x24`.
The comparator body is `0x105bce50`: earlier time sorts before later time.
Consequently an entity does not win merely because an entity was hit somewhere
along the ray. Buildings and terrain participate in the same ordering.

## Source values and filters

`FindMouseTargetObject` constructs a segment ending 10000 L2 units along the
camera ray. Each trace extent component is the float value
`0.10000000149011612`. Normal tracing begins at the ray origin with flags
`0x200bf`. Holding Shift starts 30 units along the same ray and uses `0x300bf`.
The byte tested at `UInput+0xedc` is key index `0x10`: `KeyDown` indexes its
state table from `+0xecc`. The single-hit wrapper adds flag `0x400`.

`APawn::ShouldTrace` excludes the source pawn and its controller. It also
rejects pawns for which `FNActorResourceLoader::CheckLoadingResource` reports
pending resources. The ordinary flags exclude dead pawns: branch
`0x1061776a..0x10617783` rejects controller `+0x41c` mask 1 unless trace flag
`0x10000` is set. `UGameEngine::OnDie` sets that same bit at `0x10490be9`.
The original `Engine.u` Controller source declares `bDead` in this flag group.
Shift sets `0x10000`, so dead pawns can participate in that query.

The primitive expands the actor cylinder by the trace extent and clips both
the vertical slab and radial quadratic. Its returned entry time is clamped
after subtracting `0.0010000000474974513`. The special inside-cylinder path
only returns a hit for radial inward travel with dot product below
`-0.10000000149011612`; outward or purely vertical travel is not blocked by
that pawn. The radial parallel threshold is `9.99999905104687e-09` applied to
the squared horizontal segment delta. These are recovered constants, not
new tuning knobs.

The original console is also consulted before setting the hover actor
(`FindMouseTargetObject` around `0x1058dfcf`; console slot `+0x7c` resolves to
`NWindow` function `0x10141740`). The complete UI/visibility/category filters
have not been ported. A browser nameplate is not a substitute for these rules.

## Packet dimensions and vertical origin

The original NpcInfo, CharInfo and UserInfo readers contain four consecutive
wire doubles. The final two are stored at native `User+0x1cc/+0x1d0`, then
passed as radius/half-height to `AActor::SetCollisionSize`:

| Packet callback | Native size call |
|---|---:|
| `UGameEngine::OnNpcInfo` | `0x10495539` |
| `UGameEngine::OnCharInfo` | `0x1049620c` |
| `UGameEngine::OnUserInfo` | `0x10497494` |

`SetCollisionSize` writes these floats directly to actor `+0x2f0/+0x2f4`;
`GetCylinderExtent` reads those same fields. The gateway previously discarded
the two doubles. It now forwards `collisionRadius` and `collisionHeight`
without inventing or deriving them from rendered model size. The byte order
and double offsets are independently covered with synthetic packets built
from the original reader format strings. Existing protocol dead-state bytes
are also retained instead of being discarded.

**The packet Z is not the actor's cylinder center.**
`UGameEngine::AdjustPawnLocation` (`0x1048e300`) first subtracts
`CollisionHeight` from `AActor.Location.z`, then compares that base location
against the incoming position. For ordinary grounded placement, it performs
a downward trace from incoming Z + half-height + 20 to incoming Z - 30 using
the pawn's cylinder extent. It places the actor using the trace result and
additional floor/slope compensation. Spawn callbacks similarly trace before
constructing the pawn. Special movement states and fallback branches differ.

The browser currently stores grounded visual feet in each entity group. The
implemented cylinder center is therefore **provisionally** those displayed
feet plus the packet half-height. This restores the correct base-versus-center
relationship; it does not claim to port all original collision-placement
tolerances or to prove every visual mesh's pivot matches native placement.

Visual size is independent of the collision bound. The original
`USkeletalMeshInstance::MeshToWorld` delegates to
`USubSkeletalMeshInstance::MeshToWorld` at `0x106b5f20`. Its scaling sequences
at `0x106b604a` and `0x106b6356` multiply actor scalar/axis scale with mesh axis
scale and the method's float argument. They do not fit mesh height to twice
the collision height. Correcting that existing browser scaling is separate
from this targeting change.

## Browser change and explicit remaining differences

`editor/world/js/picking.js` implements the finite-cylinder geometry and
recovered constants in L2 coordinates. `main.js` supplies the browser's
rendered entity positions, the camera ray, and actual terrain/BSP hit distance.
The fixed 40-pixel fallback and model-height-derived hidden pick cylinder are
removed. Missing/invalid dimensions and missing model resources do not receive
fabricated bounds. Updated NpcInfo/CharInfo dimensions refresh existing entities.

The implementation keeps an unbiased cylinder entry distance to reject any
pawn behind a foreground drawn surface before applying the native actor time
bias. This is deliberately conservative while the native world trace's own
extent, endpoint shortening and hit-bias rules remain unported. The world
query still uses Three.js mesh intersections, and JS double arithmetic is not
bit-identical to intermediate x87/float arithmetic. No full native collision
parity is claimed by the focused regression tests.

Dropped items retain their existing actual mesh hit as an explicit exception;
their current marker is authored and their native primitive remains unresolved.
Their nameplate does not enlarge the hit area. Prop collision, pawn special
states, complete category/visibility filtering, native floor placement, and
the original action dispatched after a target hit remain separate work.

## Audited static collision surfaces (Elbera Tools)

The ordinary mouse trace includes static actors. `AStaticMeshActor` inherits
`AActor::ShouldTrace` and `GetPrimitive` through vtable slots `+160/+164`.
The static branch at `0x1052ff5a..0x1052ff62` requires trace mask `0x80`, which
is present in both ordinary and Shift mouse flags. `UStaticMesh` has its own
`LineCheck` at `0x107032d0`: it selects actor cylinder collision, an optional
simple CollisionModel, or the source collision triangle tree. Consequently,
putting every displayed prop into a raycast would be unjustified.

`tools/world/export_static_collision.py` reads selected original
`StaticMeshActor` exports using the existing derived actor header and exact
end-of-export property framing. It resolves inherited, declared-field-checked
class defaults using the shared `OriginalClasses` parser. It admits only the
strict supported domain: static/colliding/blocking actors with both extent
trace flags enabled, no cylinder override or nonzero PrePivot, explicit
placement, source file version 123 with validated ordinary or saved-end lazy
collision arrays, null simple CollisionModel, and
all collision-referenced materials explicitly enabling collision. Unreferenced
disabled material slots do not add geometry and no longer reject the mesh. Unsupported inputs fail instead of
substituting the render mesh. Missing ordinary zero-valued actor properties
retain the original class default semantics; no per-actor guessed dimension is
introduced. Rotation and scale use the existing world placement basis; exact
native transform rounding remains unported.

The native source chain is checked by `verify_static_mesh()` in the existing
picking verifier. `UStaticMesh::Serialize` selects its legacy ordinary arrays
below licensee 17 (`0x106f7c53`) and copies collision records at stride `0x54`.
The named `FStaticMeshCollisionTriangle` serializer at `0x10366720` stores 16
floats followed by four compact indices at `+40/+44/+48/+4c`. The first three
are consumed as vertex indices by the actual box/triangle checker at
`0x10701c72`, `0x10701d32`, `0x10701df4`, using the original vertex stream
`+78` with stride 24; the fourth supplies material lookup. Both native tree
queries begin at node zero (`0x10703496`, `0x10703504`). The extractor validates
node framing/indices and requires every emitted triangle to be reachable
from that root. The compact-index import itself remains protected/unbound;
its serialization interpretation is additionally checked against the complete
original array framing and the independent UEViewer format reader, not an
assertion that the protected import has been recovered.

The first local activation covered original map `17_25` actors
`StaticMeshActor140` and `StaticMeshActor141`:

| Original mesh | Collision triangles | Render triangles | Collision-only faces |
|---|---:|---:|---:|
| `sp_lighthouse.sp_lighthouse001` | 1,268 | 1,268 | 0 |
| `sp_lighthouse.sp_lighthouse002` | 2,878 | 2,846 | 32 |

All 32 additional faces are nondegenerate. Every rendered triangle is also
present in these collision arrays. Both meshes have null simple CollisionModel
and every source material explicitly enables collision. The map actors have
no collision overrides; `Engine.StaticMeshActor` supplies static/collide/block
flags and `Engine.Actor` supplies both trace-extent flags. The private sidecar
records the map/package hashes, class-default/export hashes, offsets, source
versions, and named native addresses. It contains original-derived geometry
and is ignored with the rest of `assets/world`; it is not a public artifact.

Reproduce from the owner's local original inputs:

```sh
python3 tools/ui/check_picking_native.py --check
python3 -m unittest discover -s tools/world -p test_static_collision.py
python3 tools/world/export_static_collision.py 17_25 --actor StaticMeshActor140 --actor StaticMeshActor141
# Optional: emit the private sidecar and update only this existing scene reference.
python3 tools/world/export_static_collision.py 17_25 --actor StaticMeshActor140 --actor StaticMeshActor141 --emit
node --test editor/world/test/picking.test.mjs editor/world/test/scene-loading.test.mjs
```

The browser loads only a declared `staticCollision` sidecar and attaches it
atomically with its scene. A missing/malformed declared sidecar preserves the
previous scene; superseded loads cannot install collision data. Source
triangles join terrain/BSP and pawn nearest-hit ordering. No displayed-mesh
fallback is used. `__world.staticCollision` reports current coverage;
`__world.lastWorldPick` records the pixel, selected surface/actor/triangle and
L2 destination for live diagnosis. With `?dev=1`, the non-interactive
**Elbera Tools — World picking** DOM output displays that same coverage and
last-hit evidence for browser inspection. It is absent from the normal client.
These describe the world hit before any
nearer pawn action or server route decision.

The initial sidecar is about 521 KB; a local Node measurement parsed it in
3.27 ms and completed 1,000 warm ray queries in 18.1 ms total (not a browser
benchmark). At lighthouse login XY `(-79080,240456)`, a vertical source ray
hits `sp_lighthouse002` at Z `-3480.980224609375`; the underlying terrain is
`-3519.114501953125`. This establishes a real geometry distinction, not proof
of the earlier screen click's exact camera ray. Browser interaction is checked
separately. Other props/maps, adjacent-level static collision, native
0.1-unit extent sweep, collision-tree numerical behavior, and hit shortening/
bias remain outside this implementation. This change adds source collision
surfaces, not full native collision parity or a new navigation rule.

Live browser check on26September2026 used ordinary clicks from the existing
character at the lighthouse door. Pixel(627,620) selected actor141, triangle1034,
at L2(-79039,240206,-3464); the character moved onto the stairs.
Pixel(589,590) then selected actor141, triangle713, at
L2(-79096,240248,-3471), and the character moved to the lower landing.
Both receipts came from the visible Elbera Tools panel at the normal app
viewport after removing the temporary narrow-viewport override. These are
world-surface destinations, not an assertion of exact server arrival Z or
which fine-navigation waypoints ran. Source mesh height and server geodata
remain distinct inputs. Browser error capture was empty. Private screenshots
`lighthouse-source-stair-pick.png` and `lighthouse-source-landing-pick.png`
remain under ignored `tmp/restart-audit/`.

### First expanded 17_25 activation and its decoder boundary

The initial expanded census found **986 StaticMeshActors / 193 fully qualified
mesh references**. That local sidecar admitted **81 actors / 36 meshes**, with
20,383 unique and 27,044 placed collision triangles. Selection is explicit:
`--all-supported` includes only the current source audit's passed rows; an
explicit `--actor` selection still fails if any requested actor is unsupported.
The sidecar records the selection census and input fingerprints.

```sh
# Read-only: detailed reasons, source fingerprints, passed names and collapsed legacy references.
python3 tools/world/export_static_collision.py 17_25 --audit > tmp/restart-audit/static-collision-17_25-audit-v2.json
# Dry-run the passed selection, then explicitly activate that selection locally.
python3 tools/world/export_static_collision.py 17_25 --all-supported
python3 tools/world/export_static_collision.py 17_25 --all-supported --emit
```

The additional two actors beyond the original strict 79 are
`StaticMeshActor778/388`, using `speaking_magic_s.SI_Magic_Startroom01`.
Its disabled material slot 7 is **not referenced by any collision triangle**:
the source has 1,090 collision faces versus 1,094 render faces. Requiring all
material slots to collide incorrectly rejected these valid collision arrays.
The corrected gate requires explicit collision enablement only for referenced
slots. It still rejects unknown/disabled referenced slots; no render face is
added to compensate for missing collision.

At that checkpoint, every remaining **905 actor** referenced a mesh with licensee version ≥17:
157 qualified meshes across versions 18, 19, 20, 22, 23, 25, 28 and 31. The
original `UStaticMesh::Serialize` branches to lazy collision arrays at
`0x106f7c53`; decoding/validating their saved-end offsets and loading behavior
was the next concrete source extension, completed in the read-only checkpoint
below. No guessed header skip was used. Overlapping actor
restrictions also remained: 62 lack an explicit Rotation; 57 disable zero-extent
traces, and 32 of those also disable nonzero traces and collide/block flags.
These were conservative admission reasons, not a claim that all 57 would be
excluded by the native nonzero mouse trace. Their source/default semantics must
be resolved before widening the domain; the follow-up below resolves both. There are no unresolved qualified mesh
references, nonzero PrePivots, or cylinder overrides in this tile's audit.

Local Node measurements for the expanded sidecar: **2,388,710 bytes**, JSON
parse 5.0 ms, world transformation 9.5 ms, and 1,000 vertical queries distributed
across admitted actor bounds in 10.8 ms total. This is a CPU measurement, not a
browser/network startup benchmark. It does not justify adding a BVH now. No
runtime algorithm, other map, original file, or terrain sample was changed by
this expansion. Backup of the previous two-actor sidecar is under ignored
`tmp/restart-audit/static-collision-before-expansion`.

### Initial rendering diagnosis: original groups were being flattened

The subsequent bounded repair is recorded in
[qualified prop identity evidence](native-prop-identity-evidence.md). The
following observations describe the retained legacy exports before adoption.

The collision audit preserves each original import/export outer chain. The
older visual converter retains only package and leaf name, collapsing distinct
objects. The audit's `flattenedReferenceCollisions` field reproduces three
collisions in `17_25`; these are **not** three interchangeable naming aliases:

| Current private render file | Distinct original references and map actors |
|---|---|
| `assets/world/17_25/props/O_Cart01.gltf` | `V_Obj_S.Etc.O_Cart01`: actor 18; `V_Obj_S.Speaking_Town_S.O_Cart01`: actor 1137 |
| `assets/world/17_25/props/O_Tank02.gltf` | `V_Obj_S.H_Wares.O_Tank02`: actors 1161, 3039, 3327, 3326; `V_Obj_S.Speaking_Town_S.O_Tank02`: actors 131, 308 |
| `assets/world/17_25/props/O_Tank03.gltf` | `V_Obj_S.H_Wares.O_Tank03`: actor 313; `V_Obj_S.Speaking_Town_S.O_Tank03`: actors 1159, 1538 |

Actor numbers above abbreviate the original `StaticMeshActor` names. The
current Cart has 210 triangles matching the Etc geometry; the Speaking_Town
source has 246 and differs. The current Tank03 has 124 triangles matching
H_Wares; Speaking_Town has 122 and differs. Those comparisons use unordered
triangle position multisets with 0.01 L2-unit quantization, not exact float
identity. Tank02 source exports also differ (96 versus 69 vertex/normal
records), but this checkpoint does **not** attribute its current geometry or
claim a wrong shape solely from those counts.

The fix must span `tools/world/convert.py`'s `prop_objref` (preserve qualified
outer/group identity), `index_export_tree` (stop indexing solely by basename),
and `convert_props` (qualified needed/cache keys, filenames, scene mesh IDs,
and correctly paired glTF/buffer/texture references). The vendored UEViewer
exporter supports `-groups`; use that or export exact object identities, then
validate the exported object against the requested qualified source. Merely
adding groups to `prop_objref` while leaving basename lookup would retain the
wrong asset selection. Keep legacy leaf fields where other consumers still
need them, and migrate source identities explicitly.

A bounded next migration should regenerate these affected props in a private
staging directory, compare source geometry/material identity, update only their
scene references, verify related buffer/texture links, and then replace them
with backups. A read-only qualified-reference census across all maps should
precede broader regeneration. This checkpoint changes **collision identity
only**; existing render assets and their consumers are not silently rewritten.

### Cross-map qualified-reference census

Reproduce without geometry export or changes to any scene:

```sh
python3 tools/world/export_static_collision.py all --references-only \
  > tmp/restart-audit/world-qualified-reference-census.json
```

The supplied100 existing scene tiles contain162,805 original StaticMeshActor
records. Their resolved outer chains expose23 package/leaf collision groups
on9 tiles, involving157 actor references. These are potential collisions in
the legacy naming scheme, not157 independently proven wrong shapes, and not
a count of repairs still needed after subsequent selective adoption.

| Tile | Colliding package/leaf keys | Involved actor references |
|---|---:|---:|
|17_25|3|11|
|18_21|5|16|
|19_21|3|18|
|19_22|1|4|
|20_22|3|20|
|20_23|3|37|
|21_21|2|8|
|22_19|2|36|
|23_24|1|7|

All100 map files loaded, but60 actor references remain unresolved by this
strict parser:34 have no usable mesh reference and26 have bytes after the
recognized actor property stream. The report preserves the individual reason,
map source hash and qualified collision membership. It scans StaticMeshActor
only, not Mover/MovableStaticMeshActor or material-name collisions. A zero
collision count is therefore not a general mesh-fidelity certificate.

### Validated lazy collision arrays: decoder only

The exporter now supports the original file-123 collision arrays selected by
licensee ≥17. This checkpoint changed the decoder and verifier only: **the
expanded sidecar was not emitted or adopted**. Actor flags, explicit placement,
material participation, simple-model rejection, collision indices and root-zero
reachability gates remain in force.

The surviving `UStaticMesh::Serialize` branch calls two lazy-array wrappers:
triangle field `+148`, stub `0x1030ac90` → body `0x106f6930`, and node field
`+160`, stub `0x10308c6a` → body `0x106f6c10`. Their source save branches do:

1. Obtain the archive's current absolute position and serialize a four-byte
   placeholder there.
2. Serialize the ordinary collision array through the same helper used by
   the older layout.
3. Obtain the final position, seek back to the placeholder, write that final
   position as an int32, then seek to the final position again.

This is source-derived framing, not a guessed four-byte skip. The triangle
sequence is at `0x106f6a43..0x106f6aa5`; its integer helper
`0x1030599d` → `0x10330040` passes size 4. The original Core
`ULinkerLoad` FArchive vtable binds `+28` to named `Tell`, `+3c` to named `Seek`,
and `+40` to named `AttachLazyLoader`. `AttachLazyLoader` body `0x10149c20`
retains the archive and stores the payload's current `Tell` position at lazy
object `+8` (`0x10149c68..0x10149c74`). Core SHA-256 is
`9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf`.

Each saved array therefore consists of:

| Part | Serialized representation |
|---|---|
| Lazy prefix | int32 absolute end offset in the decoded package |
| Array count | compact index |
| Triangle element | 16 Float32 plane values, then four compact vertex/material indices |
| Node element | four compact face/child indices, six Float32 bounds, one bounds-valid byte |

Triangles and nodes have separate prefixes/counts. The serializers remain the
named functions at `0x10366720` and `0x10366940`; in-memory strides `0x54/0x2c`
must not be mistaken for fixed on-disk record lengths. The decoder uses bounded
views of the original export and each saved payload. Both payloads must finish
**exactly** at their saved ends. An offset into another export, a short/long
boundary, truncated header/count/element, or leftover payload bytes fails.
Later mesh fields are left at the exact cursor position; they are not claimed
as decoded by this collision extractor.

Independent first sample `speakingfighter_s.SI_Fighter_torchlight`
(file123/licensee18) validates:

| Array | Prefix offset | Count | Saved and decoded end |
|---|---:|---:|---:|
| Triangles | `0x2046e8` | 246 | `0x208ac4` |
| Nodes | `0x208ac4` | 453 | `0x20c11b` |

Every node is reachable and every collision face represented. A further sample
from each supplied licensee version 19, 20, 22, 23, 25, 28 and 31 also matched
both saved ends exactly before implementation. One useful adversarial source
case is `speaking_tree_s.tree.splandforest1`: 119 collision triangles versus
511 render triangles. The decoder retains those 119; substituting its render
mesh would introduce 392 non-collision faces.

The complete read-only `17_25` audit now decodes all **193 source meshes**:
36 ordinary and 157 lazy. All arrays passed, with no mesh-level errors.
Unchanged actor/material gates admit **868 actors / 179 meshes**, containing
64,535 unique and 131,152 placed collision triangles. The remaining 118 actors
still fail the explicit-rotation or collision/trace-flag restrictions; those
restrictions were not relaxed. The dry-run output would be 7,701,503 JSON bytes
at this checkpoint. This size is not a browser performance measurement.

```sh
python3 -m unittest discover -s tools/world -p test_static_collision.py
python3 tools/ui/check_picking_native.py --check
python3 tools/world/export_static_collision.py 17_25 --audit
python3 tools/world/export_static_collision.py 17_25 --all-supported
```

All 13 portable collision tests and native checks pass. The added native proof
checks 28 instructions, three named archive vtable bindings, seven direct
stub targets and four complete source ranges. The full private audit and
independent probe are under `tmp/restart-audit/`; no original mesh/binary is
published by this evidence.

Limits remain explicit. Six-NOP recovered Engine import sites do not prove
the erased `Ver`/`LicenseeVer`/`IsLoading` call identities. The branch's stored
format is established by surviving control flow, named archive/element methods,
and complete original payload framing. The compact-index import is not newly
recovered. Native lazy paging/cache lifetime, full mesh serialization, actor
transform rounding and nonzero-extent collision sweep behavior remain separate
from this offline geometry decoder.

### Local adoption and online regression

After the full audit and portable/native checks passed, explicit local
`--all-supported --emit` adopted868actors and131,152placed triangles. A backup
of the81actor sidecar and scene remains under ignored
`tmp/restart-audit/static-collision-before-lazy/`. The scene's parsed contents
were unchanged by this collision update, preserving the separate11prop repairs.

The7,701,504-byte file (including its final newline) parsed in20.6ms and
transformed in40.4ms in one local Node sample.1,000vertical queries distributed
over admitted actor bounds took44.4ms total, with935hits. This is a bounded CPU
sample, not browser loading latency or worst-case ray performance; it does not
currently justify adding a separate acceleration structure.

Ordinary browser Online login loaded the868actor/131,152triangle diagnostic.
A visible landing click at pixel(286,465) selected StaticMeshActor141,
triangle712, source`sp_lighthouse.sp_lighthouse002`, at rounded L2 hit
(-79075,240270,-3471). Subsequent rendering showed the character move along
the landing. These are source hit coordinates, not a captured server-arrival
packet. No browser warnings/errors were captured. This is a regression of the
known lighthouse route with the expanded set loaded; it does not individually
playtest every newly admitted actor or all native sweep semantics.

### Elbera Tools: original Rotation defaults and nonzero trace admission

This follow-up changes the source exporter only; it does not emit or adopt a
sidecar. Re-running the read-only commands above now admits **954 of 986 actors**
in `17_25`, referencing 189 of its 193 decoded meshes, with 66,464 unique and
142,897 placed collision triangles. There are no mesh-level decoding failures.
The increase from 868 is exactly **61 omitted-Rotation actors and 25 actors that
disable only zero-extent traces**. These are source-backed participation and
transform-property corrections, not visual or full native collision parity.

**Rotation is an inherited source default, not a missing transform.** The exact
`Engine.StaticMeshActor -> Engine.Actor -> Core.Object` class chain is checked.
`Engine.Actor.Rotation` is a single `StructProperty` referencing the qualified
`Core.Object.Rotator`, with flags `0x3`. Neither Actor nor StaticMeshActor's
unique validated tagged-default stream contains a Rotation override. The
source `Engine.u` SHA256 is
`9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761`;
`Core.u` is
`de5f0ee0a773327bce13c96622fd3c654cff7db88b9be065d1232590c140fda0`.

The pinned Core DLL establishes how that absent tag is initialized:

- Named `UClass::Serialize`, body VA `0x101351c0`, prepares the class's raw
  default buffer at `+0x4f4`, then calls the named `GetDefaultObject` and
  `InitClassDefaultObject` stubs at `0x1013532a` and `0x10135331`.
- `InitClassDefaultObject` at `0x1015fe10` takes the superclass at `+0x34` and
  invokes named `UObject::InitProperties` at `0x1015fe81`. That method copies
  available parent default bytes, then zeroes the remainder after the UObject
  header. Its `0x1015fb8a` call reaches the call-free zero-fill helper
  `0x10108420` (`xor eax,eax`, `rep stosd`, `rep stosb`). Parent copying is at
  `0x1015fbff`.
- Back in `UClass::Serialize`, `0x10135336..348` passes that buffer and its
  superclass to vtable `+0x88`, independently bound to named
  `UStruct::SerializeTaggedProperties`. The default buffer is initialized
  before the serialized tags are read. This path does not invoke AActor's
  instance constructor to choose the default Rotation.

Thus the original class-default Rotation is `(Pitch=0,Yaw=0,Roll=0)`. The
exporter records `rotationSource: inherited-class-default` for omitted map
tags; explicit map Rotators remain exact signed int32 triples with
`rotationSource: map-property`. Missing or malformed source metadata still
rejects an actor. Examples newly admitted through this path include
`StaticMeshActor122` (`Gludio_Port_S.gl_p_gate`) and `StaticMeshActor86/576`
(`speaking_tree_s.tree.splandforest1`). Of the original 62 omitted tags, one
belongs to the still-excluded noncolliding set.

**The original mouse trace is nonzero.** `FindMouseTargetObject` loads
`0.10000000149011612` from `0x1089df54` at `0x1058db8a`, as already traced
above. Original serialized Actor field links preserve the contiguous collision
Bool order: `bCollideActors`, `bCollideWorld`, `bBlockActors`, `bBlockPlayers`,
`bProjTarget`, `bBlockZeroExtentTraces`, `bBlockNonZeroExtentTraces`.
`AActor::SetCollision` binds bits `1/4/8` at `Actor+0x2f8`; original
`UBoolProperty::Link` (`0x10173250`) reuses the preceding Bool offset and
doubles its mask. This independently binds the zero/nonzero bits to `0x20/0x40`.

`FCollisionHash::ActorLineCheck` has separate paths. The line traversal tests
`0x20` at `0x10523a5e`; the box traversal expands bounds by the passed extent
at `0x10523d5f` and `0x10523db5`, then tests `0x40` at `0x10523eab`.
`AActor::ShouldTrace` handles static actors through the requested `0x80` trace
category at `0x1052ff5a..577`. Requiring the zero-extent flag as well rejected
25 original lamp actors unnecessarily; e.g. `StaticMeshActor300/155/232`,
`V_Obj_S.Speaking_Town_S.O_LoadLamp01`. The exporter now preserves that flag in
its record without requiring it for this mouse path.

The remaining **32 actors all explicitly disable `bCollideActors` and
`bBlockNonZeroExtentTraces`**, also disabling `bBlockActors/bBlockPlayers`.
They reference the original flame and interior sign/decoration meshes listed
in the private audit. They remain excluded. This change does not remove the
conservative block-actor/player gates for other maps, admit dynamic actors,
or alter cylinder, material, source-array, or transform gates. Malformed,
wrong-struct, nonzero-array-index and duplicate relevant actor tags fail closed.

The added verifier checks 33 instruction anchors, five complete Core source
ranges, named method/vtable bindings and original field/default fingerprints.
All **19 portable collision tests** pass. The detailed before/after receipts
are ignored local artifacts:
`tmp/restart-audit/static-collision-17_25-audit-defaults.json` and
`tmp/restart-audit/static-collision-admission-comparison.json`.

Limits: the Engine instance-constructor import at Rotation's field and the
extent-predicate import at `0x10523945` remain six NOPs in this recovered copy.
The claims above use the independently surviving class-default construction,
declared fields and separate extent-expanded trace path; they do not claim
those missing call targets were restored. Native per-instance constructor
execution, trace-hash lifecycle, extent sweep, hit bias and placement rounding
are not implemented or certified by this export. A browser zero-width ray
still differs from the original 0.1-unit sweep.

### Browser integration and backed-up adoption

The954actor sidecar was subsequently adopted locally with the previous868actor
file and scene backed up under `tmp/restart-audit/static-collision-before-defaults/`.
Scene bytes stayed identical. The new sidecar is7,992,953bytes on disk and its
SHA256 is `3a71064fd946d3d1c22e78c7ccafd1bfffc8b4cd7a8b30742648a74a46aee4e1`.

Browser verification caught an additional integration mismatch: the runtime
parser still required the zero-extent flag to be true, rejecting the newly
admitted source actors and preventing the scene from loading. The parser now
requires the actual nonzero flag and accepts either Boolean zero flag; missing,
string and numeric flag values still reject. Portable regression cases cover
both branches and malformed flags; an explicitly local-input integration test
parses the generated sidecar and checks actor/triangle counts. This check skips
when private inputs are absent rather than pretending source data exists.

After that runtime correction, ordinary Online login rendered the merchant
interior with the954actor/142,897triangle diagnostic. A visible floor click at
pixel(343,463) selected terrain/BSP hit(-84138,240470,-3747), followed by visible
player movement. No new captured warnings/errors occurred during that click.
The earlier parser failure remains recorded, not suppressed. Screenshot:
`tmp/restart-audit/world-collision-defaults-live.png`. This is a scene-loading
and ordinary-floor regression, not individual traversal of all newly admitted
actors, proof of exact server arrival, or a native extent-sweep implementation.

### Dwarf starting region: source admission and browser hit

An ordinary Dwarf entry exposed that `23_12` had no `staticCollision` scene
reference. The existing exporter was used without new runtime rules:

```sh
python3 tools/world/export_static_collision.py 23_12 --all-supported --emit
```

All789 original StaticMeshActors and121 qualified source meshes passed the
existing material, array, transform and collision-admission gates:46,904 unique
triangles become149,497 placed triangles. There were no exclusions or flattened
reference collisions. The5,545,606-byte private sidecar has SHA256
`559a6e7b86d547b8180c4855b537c1b1a7aed5ceca850368436dc2dd08d31f54`.
The scene gained only its `staticCollision` reference; hashes showed all653
other existing region files unchanged. Backups, source audits and actual JS
parser checks are under `tmp/restart-audit/static-collision-23_12-stage`.

After reload and ordinary Online entry, the visible Elbera Tools world-picking
inspector reported789 actors/149,497 triangles. Clicking the visible stone
support at viewport pixel(749,201) selected `source-static-collision`,
`StaticMeshActor120`, triangle267, qualified mesh
`Schtgart_Dwarf_startpoint_s.Dwarf_startpoint_support01`, at rounded L2 position
(107867,-172855,-527). Screenshot: `tmp/restart-audit/dwarf-static-pick.png`.
Earlier ordinary ground clicks still selected terrain/BSP. This verifies source
static geometry participates in this region's live picking, not a complete
movement/camera collision port, all platform traversal, or exact server arrival.
The original0.1-unit extent, hit bias and transform rounding remain open.
