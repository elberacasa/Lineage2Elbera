# Elbera Tools: native skill animation selection

The original Interlude client selects player animation slots from
`skillgrp.animation`. Cast duration, `is_magic`, and `cast_range` do not select
the slot in `APawn::SetSkillAnim`. This corrects the port's previous universal
`spAtk01` fallback and duration thresholds for magic casts.

This evidence covers slot selection and phase order. It does **not** establish
complete native playback or particle rendering. A separate
[native casting schedule investigation](native-cast-scheduler-evidence.md) now
establishes ordinary phase deadlines and rates. The
[Agent investigation](native-cast-agent-evidence.md) identifies `+0x74` as
FlyingTime and recovers exact skill-level source-path selection. Supported
ordinary player casts now execute all selected phases using source timing and
loop closure. Style 13, single-frame playback, unknown/unrenderable inputs,
NPC scheduling and native notify effects remain outside that bounded path;
the linked scheduler evidence records the runtime checks and remaining limits.

## Reproduce from an owned original client

From the repository root, with Python and `capstone` available:

```sh
python3 tools/ui/check_skillanim_native.py --check
python3 tools/ui/check_skillanim_native.py --json
node --test editor/world/test/native-skillanim.test.mjs
```

The Python verifier reads the local DLLs, derives all 32 selector branches and
their named pawn slots, then compares that result with the browser table. It
does not derive its expected mapping from JavaScript. The Node tests use
synthetic pawn tables, including missing clips and adversarial combinations of
duration, range, and magic flags. They also execute the actual player-cast
caller to reject generic substitutions.

Required private inputs, never distributed by the verifier:

| Input | SHA-256 |
| --- | --- |
| `assets/interlude/system/engine.dll` | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| `assets/interlude/system/core.dll` | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |

Engine's image base is `0x10300000`; Core's is `0x10100000`. Recovery subtracts
`0x7965b551` from aligned little-endian DWORDs in Engine's first section,
`[0x1000, 0x1a99000)`, in memory only. The key is independently derived from
the exported UTF-16 `UTerrainSector::IsTriangleAll` function-name sentinel.
No original binary is executed, modified, or emitted. Export stubs remain
readable and resolve through their original `E9` relative jumps.

## Native control flow

`?SetSkillAnim@APawn@@QAEHHH@Z` has export RVA `0x2fa9`, pointing to body RVA
`0x1ed930`. The examined body range is `[0x1ed930, 0x1ee2e9)`; its recovered
SHA-256 is `5785561a46849a16fe970a9b54b529320e02f84eee2d34114dfc7e486d69c476`.

The original text-table loader identifies the `animation` column, constructs
an `L2FName` at RVA `0x16e5db`, and stores its index in skill-data field `+0x40`
at `0x16e5e3`. SetSkillAnim reads that same field through Pawn's skill-data
pointer `+0x4f4` and compares it with each literal selector name.

On a match, the function reads stance-indexed pawn arrays and writes one to
three phase names at `+0x580`, `+0x584`, and `+0x588`, with a count at `+0x534`.
The verifier resolves each array offset independently through exported
`Get<Slot>AnimName` bodies, whose stance index comes from Pawn `+0x71d`.
For example, `U` at `0x1eddb1` reads the `spAtk03` array at `+0xa8c`, while
`N` at `0x1edcee` reads `spAtk27` at `+0xd8c`.

`GetMagicInfo` at RVA `0x42740` identifies the structure at Pawn `+0x4f0`.
`FNMagicInfo::Clear` initializes its phase index (`+0x10`, Pawn `+0x500`) to
`-1`. `MagicProcess` increments that index at `0x211e51` and reads the indexed
phase name at `0x211f95`. Thus the array order is meaningful: for ordinary
three-phase magic, `castEnd` is between the wind-up and launch slots. Calling
it a verified post-launch recovery phase would be incorrect.

| Selector | Native slots, in order |
| --- | --- |
| A / B / C | `castShort`, `castEnd`, respectively `magicNoTarget` / `magicShot` / `magicThrow` |
| D / E / F | `castMid`, `castEnd`, respectively `magicNoTarget` / `magicShot` / `magicThrow` |
| G / H / I | `castLong`, `castEnd`, respectively `magicNoTarget` / `magicShot` / `magicThrow` |
| J / K / L | `castEnd`, respectively `magicNoTarget` / `magicShot` / `magicThrow` |
| M / N | respectively `picItem` / `spAtk27` |
| S / T / U / V / W / X | respectively `spAtk01` / `spAtk02` / `spAtk03` / `spAtk04` / `spAtk05` / `spAtk06` |
| Y / Z | respectively `shieldAtk` / `spAtk28` |
| Mix01 / Mix02 | respectively `spAtk09, spAtk17, spAtk24` / `spAtk07, spAtk16, spAtk25` |
| Mix03 / Mix04 / Mix05 | respectively `spAtk07, spAtk13, spAtk20` / `spAtk07, spAtk12, spAtk21` / `spAtk08, spAtk13, spAtk22` |
| Mix06 / Mix07 | respectively `spAtk10, spAtk11, spAtk18` / `spAtk10, spAtk11, spAtk19` |
| Mix08 / Mix09 | respectively `spAtk07, spAtk14, spAtk23` / `spAtk09, spAtk15, spAtk26` |
| MS01 | `atk01`, `atk02`, `atk03` |

The original data contains lowercase `t`, `f`, `i`, and `j`. Core's `FName`
constructor (RVA `0x570e0`) calls `appStricmp` at `0x5718c`; equality compares
interned name indices at `0x9d48`. The browser therefore matches these ASCII
selector codes without regard to case.

## Boundaries and remaining work

The protection has replaced imported call instructions with NOPs. Exported
methods, literal references, field writes, and branch bodies survive, but this
is static reconstruction, not a running unpacked client. In particular,
`L2FName`'s constructor forwards its two arguments but its imported base call
is erased; the case-insensitive interpretation uses the surviving name layout
and Core implementation rather than a resolved live import.

The common tail of SetSkillAnim can apply NPC-specific animation data. This
table is used only for player casts; it does not replace that NPC path.
Unknown selector codes and missing pawn slots are left unresolved.

Source slot availability and exported clip availability are different. For
example, the current male human fighter table has `spAtk27` only at the dual
stance, whereas `spAtk05` exists at every exported stance. The export whitelist
had omitted `castEnd`, `magicShot`, `magicNoTarget` and `picItem` despite their
presence in all 14 original animation packages. Those 56 clips are now
[recovered and independently checked](pawn-clip-recovery-evidence.md), including
the pickup slot inventory. Missing first phases must still not promote a later
phase or borrow an unrelated gesture. The separate scheduler evidence now
proves the ordinary calculations and native clearing path; integrating them
with verified renderer timing remains required before claiming full skill
animation parity.

The [original endpoint evidence](native-animation-terminal-evidence.md)
separately proves one-shot clamping at the last normalized frame and a loop's
closing interval back to the first pose. Source frame count/rate define a
one-shot sample span `(N-1)/R` and loop period `N/R`; neither authorizes
advancing native cast phases from a browser clip-end callback. Direct source
inspection found no early-tail tracks in the 114 male human fighter sequences.
Exact subframe quaternion interpolation, other exports and full runtime phase
advancement remain unverified. Recovering source clips and endpoints does not
by itself establish pose or rendering parity.
