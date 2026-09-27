# Original pose-coordinate arithmetic

Elbera Tools now exposes finite coordinate math for comparing original local
poses and their parent hierarchy. This is a bounded part of native `GetFrame`,
not a complete animation, attachment or world-placement implementation.

## Reproduce

Portable checks use authored inputs and require neither client assets nor
third-party Python modules:

```sh
python3 -S -m unittest discover -s tools/ui -p test_pose_coordinates_native.py
node --test editor/world/test/nativecoords.test.mjs
```

With the owner's pinned originals and Capstone installed:

```sh
python3 tools/ui/check_pose_coordinates_native.py --check \
  --out tmp/restart-audit/pose-coordinates.json
```

The checker reads original binaries in memory. It does not execute or emit
them. Optional `--comparison-engine PATH` and `--comparison-core PATH` accept
only the separately recorded supplemental fingerprints. These inputs establish
exact method/block correspondence, not vendor authenticity or restoration of
the owned Engine's erased imports. Detailed receipts can be written only below
the ignored repository `tmp/` directory.

## API and coordinate record

[nativecoords.js](../editor/world/js/nativecoords.js) uses 12-number records:
`[originXYZ, row0XYZ, row1XYZ, row2XYZ]`, in original source units. It exposes:

| Function | Bounded operation |
| --- | --- |
| `originalQuaternionCoords(quaternion, position)` | Original local quaternion-to-coordinate conversion; no quaternion normalization. |
| `applyOriginalPivot(local, parent)` | Source reference-parent composition. |
| `applyOriginalPivotWithoutScale(local, parent)` | Source current-parent composition, normalizing each parent basis row separately. |
| `originalPivotInverse(record)` | Original determinant/cofactor/reciprocal stores; stored zero determinant is unsupported. |
| `originalPoseHierarchy(localPoses, parents, {mode})` | Complete base hierarchy, with explicit `reference` or `current` mode. Each pose has `quaternion` and `position`. |

The hierarchy helper admits one root at index 0 with parent 0; every other
parent must precede its child. It copies the supplied root record and composes
children in source order. It never mutates input arrays or a Three scene.
Unknown modes, incomplete data, nonnumeric/nonfinite components and overflow
at a required Float32 store fail explicitly. It supplies no fallback pose,
bone matching, coordinate-system conversion or actor origin.

## Retained original arithmetic

The checker reuses the existing
[quaternion-coordinate formula and retained-instruction evaluator](../tools/ui/check_hair_attachment_native.py),
and extends the existing `LinearX87` evaluator only with the required stack,
direct calls and normalization branch. It does not add another general VM.

| Source body | Preferred-base range, exclusive end |
| --- | --- |
| Engine quaternion/position helper | `0x106ae320..0x106ae436` |
| Core `ApplyPivot` | `0x1014d8c0..0x1014d98a` |
| Core `ApplyPivotWithoutScale` | `0x1014d9c0..0x1014daf3` |
| Core `PivotInverse` | `0x1014db40..0x1014dd1a` |
| Core `FVector::GetNormalized` | `0x1010cbb0..0x1010cc41` |
| Core direct vector helper | `0x1010f5b0..0x1010f618` |

For the retained vector helper `V(C,v)`, each component is a row of `C` dotted
with `v`, with only the final Float32 store. `ApplyPivot(C,P)` computes:

```text
origin = f32(P.origin + V(P,C.origin))
row[i] = V(C,P.row[i])
```

`ApplyPivotWithoutScale` changes only the second line to
`row[i] = V(C,N(P.row[i]))`. It does **not** normalize the receiver or final
result. Parent scale still affects translation. Parallel parent rows remain
parallel; there is no orthogonalization. The caller normalizes local copies,
leaving the source records unchanged.

`N` first stores `s = f32((y*y + x*x) + z*z)`. If `s` is below the exact source
**Float64** constant `1e-8`, it returns zero. Otherwise it stores
`r = f32(1/sqrt(s))`, then each `f32(component*r)`. There is no Float32 store
of the square root itself. Rounding the cutoff to Float32 changes a tested
boundary case; omitting the squared-sum or reciprocal store also changes
finite results. `PivotInverse` separately stores its determinant, reciprocal,
each cofactor and each scaled cofactor before transforming the negative origin.

The owned current-hierarchy caller retains the parent-index load, table
addressing, child-as-receiver, parent argument and 12-DWORD result copy. Its
call at `0x106dba22` remains six NOPs in the owned image. An optional 67-byte
comparison block permits only that declared replacement by the named
`ApplyPivotWithoutScale` import. Reference `ApplyPivot`/`PivotInverse` bindings
reuse the earlier [hair attachment comparison](native-hair-attachment-evidence.md).
Complete corresponding Core method bodies match without byte normalization.

## Validation and limits

The original check compares 888 Core formula results against retained
instructions: 223 reference compositions, 223 current compositions, 104
inverses, 115 normalizations and 223 vector operations. All 427 instructions
across those five bodies are covered, including both normalization branches.
An additional 104 quaternion/position cases use the existing retained Engine
evaluator. The browser/Python suite compares 654 authored cases by exact
Float32 bits, including signed zero, with no numerical tolerance. ABI checks
cover stack cleanup, hidden result pointers, preserved registers and source
record preservation. The portable suites contain 11 Python and 8 Node tests.

These are **bounded Float64 approximations of x87 intermediates**, preserving
explicit source Float32 stores. `appSqrt(double)` is a surviving named call
whose positive CRT path contains `FSQRT`; the evaluator uses Python/JavaScript
square root at that boundary. CRT status handling, FPU precision/control-word
behavior and universal native bit parity are not established. NaN, overflow,
exceptions and singular inverse behavior are outside the admitted domain.

The helper supplies only base hierarchy math. Original animation sampling,
track-to-mesh association, root-motion overrides, additional bone/actor
modifiers, world placement and dynamic hair simulation are separate contracts.
It does not prove equivalent Three skinning or justify changing skin weights.
Earlier source-reference comparisons found no gross bind-head discrepancy;
different exported influences establish adaptation, not incorrect appearance.
