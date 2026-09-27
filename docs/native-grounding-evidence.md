# Original position-correction and grounding evidence

Elbera Tools. This audit separates received server positions, the native
collision cylinder's center, and the browser's visual group origin. They
are different quantities. It does not authorize a constant sit offset.

## ChangeWaitType correction intentionally excludes the local player

`OnChangeWaitType` calls `AdjustPawnLocation` before comparing the old and
new wait states. Equal states suppress animation restart; they do not
suppress that earlier correction call.

The named original `AdjustPawnLocation` method, RVA `0x18e300`, has these
early exits:

- No pawn or no controller.
- Controller `+0x41c` bit 0 set.
- A displacement-helper result is at or below the source double 200.
- Controller `+0x424` nonzero.
- Pawn.Controller equals the first viewport's actor/controller.

The last comparison is explicit at `0x18e3ae`–`0x18e3c1`. Named
`AActor::execGetViewport` independently returns the same first-viewport
pointer from the Engine `+0x54 → +0x38 → first entry` chain. The original
`Engine.Player` declares its Actor as a PlayerController;
`UViewport::LockOnActor` writes the Actor.Location fields through viewport
`+0x3c`, and `OnUserInfo` uses that same actor field for the self player.
The correction therefore returns for the local viewport's player. A
browser implementation must not apply this method's remote correction
to the local player just because a ChangeWaitType packet has coordinates.

The displacement helper at `0x18e384` is six erased import bytes. The
surviving comparison does **not** distinguish distance from squared distance.
The audit preserves the 200 constant without inventing a 200-unit snap
radius. The unnamed controller/state gates also remain explicit limits.

## The ordinary remote branch uses an extent sweep

Before the displacement helper, the method subtracts incoming XYZ from
`(Actor.Location.X, Actor.Location.Y, Actor.Location.Z − CollisionHeight)`.
The cylinder-center origin is independently established by the named
`SetCollisionSize` and `GetCylinderExtent` methods; it is not the browser's
current visual-feet origin.

After admission, the ordinary branch supplies these original inputs to
the level's named `SingleLineCheck` virtual method:

| Input | Original value |
| --- | --- |
| Start | packet X/Y, packet Z + CollisionHeight + 20 |
| End | packet X/Y, packet Z − 30 |
| Extent | CollisionRadius, CollisionRadius, CollisionHeight |
| Trace flags | `0x86`, preserved without guessing every category |
| Source actor | The corrected pawn |

Pawn field `+0x778` equal to 1 or 2, or byte `+0x34` equal to 4, takes a
separate direct-position branch. Their full semantic admission is not
implemented by this audit.

When returned hit Z is exactly zero, the ordinary path expands the sweep
by adding 30 to start Z and subtracting 30 from end Z. It permits up to 30
attempts. The exhausted branch restores packet XYZ in the result. The
subsequent native code computes `d = Float32(hit.Time × 12)` and, if
`d < 1.899999976158142`, adds `2.150000035762787 − d` to hit Z with a
Float32 store. Finally it calls the level's named `FarMoveActor` with the
result and three zero flags. This small hit adjustment is conditional;
it is not a universal terrain offset or a sitting correction.

The trace geometry, complete flags and `FarMoveActor` collision behavior
remain separate work. A raycast or height lookup at one XY point cannot
stand in for the recovered cylinder sweep.

## Self-player initial placement is a different path

The ordinary initial `OnUserInfo` branch starts its trace at packet
Z + received collision height + 20 and initially ends at packet Z − 10.
It supplies the received radius/radius/height extent to `SingleLineCheck`,
applies the same conditional hit-time adjustment, then calls the named
`GameInfo.eventSpawnPlayerPawn` with the resulting position. There are
retries and additional branches. This differs from the later remote
correction's initial packet Z − 30 endpoint.

This proves why incoming packet Z, native pawn center and rendered foot
height cannot be substituted for one another. It does not yet provide a
complete initial-spawn solver or close the mesh-origin, bone-basis and
pose-placement issues in the [player transform audit](player-transform-audit.md).

## Current browser differences and safe scope

The gateway decoder and bridge now preserve ChangeWaitType XYZ, including
repeated wait states with changed coordinates. Relocating an actor still requires the appropriate
source policy above. Dropping these fields does not explain local sitting
float, because this original correction excludes the local player.

`terrain.heightAtWorld` samples the rendered terrain triangle, then uses
geodata to select a level and a BSP/prop walk raster to choose a visible
surface. The raster is quantized and the selection's `[24,40]` surface band
and 64-unit association bound are measured compatibility rules. They are
not recovered native cylinder-collision rules. Interior floor selection
has additional approximations. The browser currently places its visual
group on that selected surface; original placement instead positions a
collision center and then applies the actor/mesh transform.

Elbera Tools' world inspector now measures actual triangle/BSP intersections,
selected browser surface, group origin and skinned pose vertices at the same
position. Open `/?dev=1&inspect=1&checkpoint=current`, connect Online, then
use **Measure body and surface geometry**. This mode does not stage or move
the player. Measurement is on demand, not a per-frame whole-world query.

At the current Human Fighter Talking Island checkpoint, standing yielded a
lowest-body-minus-terrain difference of about +0.0018 L2 units; sitting yielded
about −1.6636 L2 units. The body's lowest vertex moves horizontally with the
pose, so the probe separately intersects geometry below it and below the actor
origin. This disproves a universal upward ground gap at that checkpoint; it
does not establish native pose, shadow, collision or mesh-transform parity.
The probe labels transparent surfaces and excludes hidden ancestors and
downward-facing triangles. It measures geometric surfaces, not alpha-tested
pixels or native collision eligibility. Private screenshots remain local.

## MoveToPawn: keep a reached visual position out of the target's center

The original `0x60` dispatch selects decoder RVA `0x1248f0`, whose format is
six DWORDs. Its ordinary target-user branch calls the named `OnMoveToPawn`
through GameEngine virtual slot `0xfc`. The configured server's
`MoveToPawn.java` writes mover ID, target ID, distance and mover XYZ in that
order; the gateway preserves all six. That field-order comparison is server
interoperability evidence, not proof of all native movement behavior.

Native `OnMoveToPawn` RVA `0x18ebb0` converts the signed distance to Float32
at Pawn `+0x6c4`. The local viewport pawn calls `AController::MoveToward`
without applying the packet-position correction. The remote branch calls
`AdjustPawnLocation`, then `AddMoveToward`. Pawn `moveToward` calls the named
`ReachedDestination`; a true result clears acceleration and returns arrived.
The target-Pawn candidate in that predicate reads `+0x6c4`, adds another
field at `+0x152c`, and performs horizontal and height/collision checks.
Its protected type/vector helpers remain erased. This is **not** a complete
proof of the browser's simpler planar-distance predicate or native arrival
timing, including equality at the boundary.

The browser compatibility handler previously initialized its destination
to the target's center and shortened the destination only when outside
the received distance. Inside/equal therefore incorrectly chose the center.
It now clears the old visual walk target and keeps the current position in
that case; outside keeps the existing distance projection. It does not
send an arrival claim, change packet origins, add a stop-distance constant,
or implement the native collision solver. Remote facing is unchanged.

The local Katerina inspection reproduced this exact defect: a received
distance of 150 with mover/target planar separation about 94.05 still sent
the visual player into the NPC's center. A camera-height collision then
collapsed the two-metre camera boom to zero. This observation ties that
recorded obstruction to the approach defect; it does not certify the
camera's height-march approximation or rule out other camera obstructions.
After the bounded fix, the same approach receipt kept the player at
`(-84138, 240470)` while Katerina remained at `(-84204, 240403)`; requested
and actual camera boom both remained two metres. Actor and mesh scales
were unchanged between the two observations. The private before/after
receipts are `tmp/restart-audit/camera-before-fix.txt` and
`tmp/restart-audit/camera-after-approach-fix.txt`. Their AABB distance of zero
in the earlier frame is only containment evidence, not an exact skinned
triangle penetration test.

Portable handler regressions cover inside/equal/coincident positions,
outside projection, zero-distance approach, remote isolation and the
existing self-stop callback order:

```sh
node --test editor/world/test/combat-approach.test.mjs
```

## Reproduce

The checker verifies named methods, native call slots, 94 instruction
anchors and four cases executing the original trace-seed arithmetic. It
keeps detailed hashes in an ignored receipt and never emits original code.
Original Interlude binaries/packages and Capstone are private prerequisites;
no browser, login, server or asset regeneration is required.

```sh
python3 tools/ui/check_grounding_native.py --check --output tmp/restart-audit/grounding/evidence.json
python3 -m unittest discover -s tools/ui -p test_grounding_native.py
```

The portable cases test input precision and rejection; they do not create
synthetic collision results and call them original world evidence.
