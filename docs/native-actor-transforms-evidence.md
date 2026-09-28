# Original actor transforms and GMath table recovery

Elbera Tools now recovers the ordinary actor matrices used by the original
static-mesh collision cache. The browser component preserves integer rotation
lookup, per-axis scale, PrePivot, translation, Float32 stores and the source
determinant. It matches **1,400 finite retained-instruction cases**, including
200 using a freshly recovered original-derived sine table.

This is a component milestone. It does not implement the collision tree,
triangle sweep, material callbacks, live actor state or cache lifecycle, and it
does not enable walking. Existing world rendering is unchanged.

## Browser contract

`editor/world/js/actor-transforms.js` exports:

```js
originalActorTransforms({
  arithmeticProfile: "pc53-rne",
  location, prePivot, rotation, drawScale, drawScale3D, sineTable,
});
```

Supply a stable snapshot of the **current source fields**, in native units and
axis order. Serialized map defaults alone do not establish current actor state.
There is no meters conversion, browser-axis swap or generic renderer inverse.

| Input | Original binding | Required representation |
| --- | --- | --- |
| `location` | Actor `+1bc` | Three finite, exactly representable Float32 values |
| `rotation` | Actor `+1c8` | Three signed DWORDs, Pitch / Yaw / Roll |
| `drawScale` | Actor `+27c` | Finite, exactly representable Float32 |
| `drawScale3D` | Actor `+280` | Three finite, exactly representable Float32 values |
| `prePivot` | Actor `+28c` | Three finite, exactly representable Float32 values |
| `sineTable` | Named GMath `+8c` | Array or Float32Array of length 16,384; every consumed entry must be a finite Float32 |

Vectors and rotations are dense ordinary arrays. `arithmeticProfile` explicitly
admits the finite round-to-nearest, ties-to-even / x87 53-bit-significand model.
It is not a runtime detector. Other precision/rounding modes, floating-point
exceptions and extended-exponent edge behavior are outside this component's
claim. No source table is embedded and no host sine function is called.

A ready result contains frozen, flat **row-major** `localToWorld` and
`worldToLocal` arrays (16 Float32 values each), plus the source Float32
`determinant`, scope and arithmetic profile. The source translation occupies
indices 12–14. Preserve signed zero. Do not infer a renderer matrix convention
from storage order alone.

Missing state, sparse actor vectors/rotations, unsupported profiles, zero
inverse scales, missing consumed table entries and nonfinite derived outputs
return `status: "unsupported"` with a reason. Zero scale is excluded because
this API supplies both matrices; it never substitutes an identity inverse.
Inputs are not modified. A ready result proves computation under the supplied
contract, not the provenance of caller-provided values.

### Calculation details that matter

The source indexes its sine table with `(angle >> 2) & 0x3fff`. Cosine adds
`0x4000` with signed DWORD wrap before the shift. Inverse rotation negates the
**integer angle before indexing**. Inverting the already rounded forward
rotation can therefore produce a different answer for low angle bits.

LocalToWorld computes its translation from retained intermediate products.
Those products must not be replaced by the rounded output basis. WorldToLocal
instead composes the original translation, inverse-rotation and scale
constructors in source order. Reciprocal scales have their own Float32 stores;
they are not the reciprocal of a rounded combined scale. Matrix products store
each result once after the four source products. The determinant follows the
original Core method rather than an assumed product of scales.

## Reproducible checks

Portable tests contain authored fixtures only:

```sh
node --test editor/world/test/actor-transforms.test.mjs
python3 -m unittest discover -s tools/ui -p test_gmath_table.py
```

The Python test imports the existing retained-instruction interpreter and needs
Capstone. Twelve browser tests cover indices, wraparound, PrePivot, handedness,
signed zero, untouched inputs and unknown-state rejection. Nine Python tests
cover the sine interpreter's arithmetic, lane handling, rounding, missing
operands and unsupported profiles. These tests do not prove client defaults.

The original-source checker requires Python with Capstone, Node, pinned owned
Engine.dll / Core.dll / Engine.u and explicitly supplied comparison images:

```sh
python3 tools/ui/check_actor_transforms_native.py --check \
  --comparison-engine /local/supplemental/engine.dll \
  --comparison-core /local/supplemental/Core.dll \
  --sine-profile source-sse2-RNE-PC53
```

Omit `--sine-profile` for 1,200 synthetic-table cases. Supplying it recovers the
table afresh in memory and adds 200 cases; it does not trust a saved export.
`--engine`, `--core`, `--engine-package` and `--runtime-module` select explicit
local inputs. Omit `--check` for a full JSON evidence receipt on stdout. Keep
raw local receipts private.

The comparison executes retained instructions in the existing bounded Python
interpreter and compares the actual JavaScript output **bit for bit**, including
signed zero, both matrices and the stored determinant. The 1,400 cases execute
319,200 LocalToWorld, 2,100,000 WorldToLocal/helper and 112,000 determinant
instructions. A separate negative check rejects rounding a LocalToWorld
intermediate before the source translation calculation.

The normal-path interpreter models constructor calls, their ordinary SEH stack
allocation, argument cleanup and forward record copies. Native handlers, unwind
behavior and floating-point exceptions are not executed. DLLs are never loaded
or run. This is retained-code interpretation, not an observed native game run.

## Conditional original sine-table producer

`tools/ui/recover_gmath_table.py` reads the original Core coefficients and
lookup constants, then interprets its GMath constructor and SSE2 sine kernel.
It does not call Python or browser sine. The supported profile requires source
CPU/OS SSE2 admission, masked exceptions, round-to-nearest and x87 precision 53.

```sh
python3 tools/ui/recover_gmath_table.py --check \
  --comparison-core /local/supplemental/Core.dll \
  --profile source-sse2-RNE-PC53
```

This command is read-only and prints a receipt. An explicit
`--output /private/path/gmath.json` creates a **private original-derived asset**
with little-endian Float32 hex words and its source receipt. Output uses
exclusive creation and never silently overwrites an existing file. Do not
commit this generated table or include it in public Elbera Tools bundles.

The source constructor stores 16,384 entries. Under the stated profile:

| Reproducible output | Value |
| --- | --- |
| Float32 table SHA256 | `9893d14bd21e5c4194832659571b30363ddfb08d468ed662a4b6d5ae172262dc` |
| Float64 argument stream SHA256 | `0653dec99703f9589f6bc50ec8d448b59ad9d75e779813171a0ea0363f0f3961` |
| Constructor instructions interpreted | 229,381 |
| SSE2 kernel instructions interpreted | 1,245,123 |

Fourteen exactly matched Core blocks, 28 instruction anchors and two initializer
tables establish the static startup path. Successful CRT attach runs the C
initializers, including SSE CPU/OS probing, before the C++ GMath initializer.
The named constructor calls the named appSin wrapper, whose admission checks
select the SSE2 bridge under the supplied conditions.

**Static ordering does not observe the machine's incoming floating-point
control state.** This tool does not claim the profile is universal at DLL
initialization. The x87 FSIN fallback and other precision/rounding profiles
remain unsupported. The existing [ordinary animation FPU
investigation](native-animation-fpu-evidence.md) covers later application and
renderer behavior; it does not establish this earlier table initializer's
incoming state.

## Source bindings and edition

`actor_transform_source.py` qualifies ten Engine blocks, nine named Core bodies,
66 anchors, eight actor-vtable joins, five normal SEH prologues and three direct
constructor thunks. It reuses the existing package reader and supplemental
comparison tool. Original reflected property order and the retained typed actor
copy bind the input offsets; no field name is inferred from a browser mesh.

Only declared erased Core calls, independently named GMath import operands and
an exactly matched relocated helper are normalized in the main block checks.
The SEH handler operands differ between images; their stack effects are checked
but the exception handlers are outside the interpretation and are not claimed
equivalent. Every normalization and source span hash appears in the receipt.

| Source method | Owned address / slot |
| --- | --- |
| Actor LocalToWorld | `103277b0`, virtual `+148` |
| Actor WorldToLocal | `10328690`, virtual `+150` |
| Translation / scale / inverse-rotation constructors | `10326fb0` / `103274a0` / `10327040` |
| Core matrix multiply / determinant | `10111240` / `10111bb0` |
| GMath constructor / named appSin body | `1014d330` / `1012d720` |
| SSE2 sine kernel | `1018649e` through `10186646` |

The cache consumer calls WorldToLocal before LocalToWorld and stores both plus
the determinant. Its source key uses original object cache indices; a server ID
is not a substitute. Those cache joins document the future integration boundary,
not a browser cache implementation.

| Private input | SHA256 |
| --- | --- |
| Owned Interlude Engine.dll | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Owned Core.dll | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| Owned Engine.u | `9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761` |
| Supplemental Engine.dll | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |
| Supplemental Core.dll | `d83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639` |

A different edition is rejected. Supplemental correspondence qualifies the
stated bindings; it does not authenticate the archive or restore the owned
binary's erased imports.

The next collision work remains source triangle/tree data, original finite
sweeps and callbacks, actor spatial participation, and live cache/lifecycle
integration. These repository tools are not yet included in the existing
standalone release kits. No game assets or new UI screenshots accompany this
arithmetic milestone; the existing README gallery is preserved.
