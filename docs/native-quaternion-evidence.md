# Ordinary quaternion interpolation: source evidence

Elbera Tools verifies the original ordinary-track quaternion helper and exposes
its branch and Float32-store policy as a portable function. **This is a bounded
arithmetic model, not complete animation parity or bit-exact native math.**
Initial tweening uses a separate helper and is outside this proof.

## Reproduce and use

```sh
# Source-free, standard-library fixtures; no Capstone or original files.
node tools/ui/test_quaternion_native.mjs
python3 -m unittest discover -s tools/ui -p test_quaternion_native.py

# Owned sources only: explicitly reports the five erased calls.
python3 tools/ui/check_quaternion_native.py --check

# Named imports require this explicit, hash-pinned supplemental input.
python3 tools/ui/check_quaternion_native.py --check \
  --comparison-engine /private/path/system/engine.dll
```

Both source-check commands require the pinned owned Engine/Core and Python
`capstone`. Omitting `--check` emits metadata JSON. No command executes native
code, downloads binaries, emits decoded payloads or changes game assets.

The module [check_quaternion_native.py](../tools/ui/check_quaternion_native.py)
can also be imported without private inputs, Capstone or other site packages:

- `interpolate_quaternion(first, second, alpha)` returns four components.
- `interpolation_details(...)` also returns the selected branch and dot product.
- `synthetic_cases()` supplies 210 authored dictionaries with `first`, `second`
  and `alpha`, suitable for independent cross-language comparisons.

The API accepts finite Float32-representable components and fractions. It adds
no input normalization, hemisphere flip, fraction clamp or dot-product clamp.
Invalid math domains and nonfinite results fail explicitly. That rejection is
an API boundary, not an emulation of native exceptions or NaN handling.

## Pinned method and import correspondence

Owned Engine SHA256:
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`.
Supplemental Engine SHA256:
`508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d`.
The supplement is from an unauthenticated third-party archive; see
[its provenance and retrieval checks](supplemental-engine-evidence.md).

The original ordinary-track call stub `0x1030f024` resolves to owned body
`[0x106ae090,0x106ae297)`. The supplement resolves it to
`[0x106ae050,0x106ae257)`. The **complete 519-byte bodies** differ only at five
six-byte sequences: exact NOPs in the owned copy, named IAT calls in the
supplement. No other instruction, constant, branch or address normalization is
needed inside this method. The shifted entry thunk is checked separately.

| Owned call VA | Supplemental call VA | Named Core import |
| --- | --- | --- |
| `0x106ae15b` | `0x106ae11b` | `appAcos(double)` |
| `0x106ae16c` | `0x106ae12c` | `appSin(double)` |
| `0x106ae188` | `0x106ae148` | `appSin(double)` |
| `0x106ae1a0` | `0x106ae160` | `appSin(double)` |
| `0x106ae237` | `0x106ae1f7` | `appSqrt(double)` |

Decorated symbols are `?appAcos@@YANN@Z`, `?appSin@@YANN@Z` and
`?appSqrt@@YANN@Z`. They take and return doubles. The checker also resolves
these named wrappers in owned Core, SHA256
`9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf`:
`0x1012d750→0x1017c7e0`, `0x1012d720→0x1017c430`, and
`0x1012d790→0x1017cb60`. Each loads the stack double and jumps to retained
math code. The complete CRT implementations are not interpreted by this tool.

Owned decoded body SHA256:
`094131c196c85a7656129d56adacdb2ccb938ea209427559c17b71891eccf839`.
Supplemental body SHA256:
`a1d85ac5fa05c01a46500f6f26628f064dcec29488e65e6d5b6e1a71703099c4`.
Without `--comparison-engine`, the checker verifies the owned body, constants
and erased sites but makes **no named-import correspondence claim**.

## Recovered policy and store order

Let `F` mean an explicit Float32 store. Inputs `A[0..3]`, `B[0..3]` and `t`
are Float32. Unmarked products and sums below retain the model's Float64
precision until the next `F`; this approximates the native x87 instructions.
The imported calls receive double arguments. Python `math` supplies the
portable approximation of the named Core math functions.

```text
d = F(((A0*B0 + A1*B1) + A2*B2) + A3*B3)

if d > 0.9999998807907104:
    return A                       // direct copy, no normalization

if d > F(0.55):                    // 0.550000011920929
    wa = F(1-t)
    wb = t
else:
    theta = F(appAcos(d))
    invSin = F(1 / appSin(theta))
    wa = F(appSin((1-t)*theta) * invSin)
    wb = F(appSin(theta*t) * invSin)

q[i] = F(wa*A[i] + wb*B[i])
s = F(((q1*q1 + q0*q0) + q2*q2) + q3*q3)

if s < F(0.00001):                 // 9.999999747378752e-6
    return [0, 0, F(0.1), 0]       // 0.10000000149011612 in component 2

root = F(appSqrt(s))
factor = F(1 / root)
return componentwise F(q * factor)
```

The two interpolation thresholds use **strict greater-than**. Equality with
the upper threshold proceeds to normalized linear blending; equality with
the 0.55 threshold proceeds to the trigonometric branch. The normalization
threshold accepts equality. The tiny-result fallback is the literal tuple
above, not the identity quaternion.

The upper threshold is a source double at `0x108e2140`; the remaining constants
are source floats at `0x108e213c`, `0x108a7494` and `0x1089df54`. Their bytes
match between the owned and supplemental images. In the linear branch `1-t`
is stored as Float32; in the trigonometric branch `(1-t)*theta` goes directly
to a double argument. Angle, reciprocal sine, weights, blended components,
squared magnitude, square root and reciprocal root have separate Float32
stores. Generic host-library slerp/normalization may change both the branch
policy and those rounding points.

## Verification and remaining boundaries

Ten portable tests cover strict thresholds, direct-copy ownership, normalized
linear behavior versus generic slerp, separate normalization stores, the source
fallback, absence of silent hemisphere/fraction changes, and invalid inputs.
They use authored synthetic values only.

With the explicit supplement, a narrowly bounded evaluator consumes the
decoded method's instructions and compares them with the separately expressed
portable formula for **210 cases**: two direct copies, 34 normalized linear,
172 trigonometric and two tiny-result fallbacks. Cases include exact/adjacent
thresholds, opposite endpoints, zero inputs and deterministic random unit
pairs. The evaluator checks saved registers, the empty floating stack and
cdecl cleanup. Entry stack arguments are A, B, fraction and output at
`ESP+4/+8/+12/+16`; plain `ret` leaves argument cleanup to the caller.

These are instruction-model comparisons, not native execution. Native FPU
precision/rounding mode, full CRT behavior, unordered comparisons, overflow
and universal bit equality remain unproved. Hemisphere selection belongs to
the callers. The initial-tween helper at owned `0x106afd00`, compressed-key
decoding/sampling and complete pose/hierarchy evaluation remain separate work.
See [animation timing and exporter limits](native-animation-terminal-evidence.md).
This ordinary helper is one reusable part of an original-key evaluator; it
does not make existing exported glTF animation samples native-exact.
