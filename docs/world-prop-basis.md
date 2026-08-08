# World prop coordinate basis, rotation and scale — the derivation

Written 2026-08-08 while applying `docs/foundation-audit.md` F1 + F2.
Everything here is derived from the vendored reference oracle
(`tools/src/UEViewer`) or measured; nothing is asserted from memory.

## The two bases

| map | matrix | det |
| --- | --- | --- |
| umodel glTF export, `Exporters/ExportGLTF.cpp:59` `Exchange(pos[1],pos[2]); pos.Scale(0.01f)` | `(x,y,z)_UE -> (x, z, y) * 0.01` | **-1** |
| the client, `editor/world/js/coords.js:17` `l2ToThree` | `(x,y,z)_L2 -> (x, z, -y) * 0.01` | **+1** |

They differ by `S = diag(1, 1, -1)`. Shipping umodel's file unchanged and
placing it with `l2ToThree` therefore drew every prop as its own mirror
image about its pivot. Proved byte-for-byte by
`tools/src/char_pipeline/audit_prop_basis.py`, which uses umodel's own psk
exporter as the oracle (psk = UE space with one documented Y mirror,
`Exporters/ExportPsk.cpp:21 #define MIRROR_MESH 1`).

`tools/src/char_pipeline/assemble.py:363-382` already documented and applied
the same correction on the character path. The world path now matches it.

Call the proper map `M`:

```
M = [ 1  0  0 ]        M(x, y, z) = (x, z, -y)      det M = +1
    [ 0  0  1 ]
    [ 0 -1  0 ]
```

## The mesh fix (F1, `convert.py gltf_to_proper_basis`)

`p_umodel = S·M·v_UE`, so the correction is a plain `S` on the vertex data:

* `POSITION.z`, `NORMAL.z`, `TANGENT.z` negated;
* `TANGENT.w` negated — with `S` orthogonal and symmetric,
  `cross(S n, S t) = det(S)·S cross(n, t) = -S cross(n, t)`, so the stored
  bitangent `B = cross(n,t)·w` is preserved only if `w` flips too;
* every triangle's index order reversed. The correction is det +1, and
  umodel relied on the reflection to land on glTF's CCW front face
  (glTF 2.0 §3.7.2.1). Measured before the fix by `winding_check.py` on the
  shipped `Giran_V_Plaza_Wall04`: 0/28 faces inverted, i.e. the *reflected*
  data was already CCW, so the corrected data must be reversed to stay CCW;
* POSITION accessor `min.z` / `max.z` swapped and negated.

The pass tags `asset.extras.basis = "l2ToThree(x,z,-y) det+1"` and is
idempotent. It refuses to run on a glTF whose nodes carry a local transform
(umodel's static-mesh exports never do) rather than silently mis-handling it.

## The rotation fix (F1 part 2, `Terrain.ueQuaternion`)

Because `det M = +1`, the placement rotation is just `R_three = M R_ue Mᵀ`,
which preserves every angle and only relabels axes. **The old comment in
terrain.js calling the basis map "a reflection" was wrong; the reflection
was in the mesh data.**

`R_ue` — the UE2 `FRotationMatrix`, whose rows are the actor's local axes in
world space — is reproduced term for term by the oracle
(`Unreal/UnrealMesh/UnMathTools.h:6 RotatorToAxis` composing
`Core/Math3D.cpp:252 Euler2Vecs`, then the four sign flips at
`UnMathTools.h:14-19`):

```
X: (  cP cY,             cP sY,             sP    )
Y: (  sR sP cY - cR sY,  sR sP sY + cR cY, -sR cP )
Z: (-(cR sP cY + sR sY), cY sR - cR sP sY,  cR cP )
```

Conjugating that by `M` and matching against products of axis-angle
quaternions over 40 random rotators gives **exactly one** combination, with
a maximum matrix-element error of 6.7e-16:

```
yaw   -> about (0, 1, 0) by  +yaw
pitch -> about (0, 0, 1) by  +pitch
roll  -> about (1, 0, 0) by  -roll
composed  qYaw · qPitch · qRoll
```

Only the **yaw** sign changed relative to the pre-fix client. Pitch and roll
were already correct.

### Correction to `docs/foundation-audit.md` F1

The audit's fix specification says roll becomes `+roll about (1,0,0)`,
derived from "UE roll is right-handed about `+X_L2`". That is wrong: with
pitch = yaw = 0 the matrix above gives local `Y = (0, cR, -sR)`, i.e. `Y`
tilting toward `-Z`, which is a right-handed rotation about **`-X_L2`** —
`-roll` in the client basis. The exhaustive sign search finds no match at
all for the audit's combination. Everything else in F1 (the mesh reflection,
the yaw sign, the winding reversal, the tangent handling) is confirmed.

10,101 of the 157,171 placements carry a non-zero roll, so this is not a
theoretical distinction.

## The scale fix (F2)

`scene.json` stores `scale` in **L2 axis order** (`DrawScale * DrawScale3D`,
`convert_props`). Conjugating a diagonal scale by `M` gives

```
M · diag(sx, sy, sz) · Mᵀ = diag(sx, sz, sy)
```

because `M` sends L2 y to three -z and L2 z to three y. The client applied
`(sx, sy, sz)` with no remap. Measured over all 100 tiles (157,171
placements):

| condition | placements |
| --- | --- |
| `scale.y != scale.z` (the swap changes the result) | 3,025 |
| exactly `(1, -1, 1)` — retail mirrors the prop in Y | 308 (were being flipped upside down instead) |
| exactly `(-1, 1, 1)` | 1,431 (X is common to both bases; unaffected) |
| negative determinant overall | 1,849 |

Both call sites now go through `Terrain.propScale()`.

**Still open (not part of this change):** those 1,849 negative-determinant
placements flip triangle winding at draw time and three.js does not
compensate, so they are lit from the wrong side unless their material is
double-sided. That needs per-instance normal correction or a `material.side`
override and is a separate task.

## Measured effect of F1 + F2 together

Distance moved by each placement's mesh centroid between the old pipeline
and the corrected one (`scale`-aware, rotation-aware):

| tile | moved > 0.5 m | > 2 m | worst |
| --- | --- | --- | --- |
| 22_22 (Giran) | 385 | 136 | 68.8 m (`Giran_V_Elevation02`) |
| 23_24 | 547 | 352 | 38.3 m (`Innadrile_Sideblock02_fence02`) |
| 21_16 | 548 | 221 | 42.9 m (`rune_main01`) |
| 23_22 | 322 | 206 | 20.1 m (`SSQ_Room01_Wall01`) |

(The audit's F1-only table reported 559 / 437 / 36.6 m for 23_24; the small
differences are the F2 scale swap being included here and the centroid being
taken from the POSITION accessor bounding boxes rather than the vertex mean.)

## What this does NOT touch

`bsp.gltf` — the BSP building geometry. Its Points are already **world**
coordinates and `bsp.js` applies no placement transform (only the global
`L2_TO_M` scale on the group), so none of the above applies to it.
`tools/world/bsp.py --check` and `editor/world/verify_bsp.js` still pass.
