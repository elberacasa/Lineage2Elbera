# Elbera Tools: ordinary animation floating-point environment

The ordinary tween can admit a zero previous frame under the explicit
`floatingPointEnvironment: 'win32-default'` contract. This combines documented
Windows/CRT masked exceptions with retained Interlude startup and renderer
instructions that preserve those masks. It is **not** a claim that every
possible injected library, debugger configuration or modified process has the
same floating-point environment.

The numerical reset is described in [the local-pose tween evidence](native-pose-tween-evidence.md).
The cache and evaluation lifetime is a separate rule in
[the pose-cache evidence](native-pose-cache-evidence.md). This document does not
choose when a browser should evaluate or commit a pose.

## Reproduce

Requires the owner's pinned Interlude files and Python with Capstone. Nothing
executes, patches or writes an original binary; the report contains fingerprints,
selected instruction checks and arithmetic results.

```sh
python3 tools/ui/check_animation_fpu_native.py --check
```

Portable tests need neither original files nor Capstone:

```sh
python3 -m unittest discover -s tools/ui -p test_animation_fpu_native.py
```

The checked result is **90 instruction anchors, 9 fingerprinted slices, 6
complete linear instruction spans (15,883 instructions), 64 exception-mask
combinations and 65,536 control-word patterns**. Five portable tests check the
bit mapping, preservation and rejected inputs. Bit tests are instruction-backed
arithmetic, not emulation of every CRT branch or an execution of native code.

All VAs below are preferred-base virtual addresses. The PE reader maps sections
properly; they are not assumed to be file offsets.

| Owned input | SHA-256 |
| --- | --- |
| `L2.exe` | `001414e69ed8f53a01fc7c79d3f6c854c86a4581bf9992aaefa3ec78e426544c` |
| `Core.dll` | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| `D3DDrv.dll` | `05622ddea5d96aec5618bc1ae064af9d27d83178f78d9631b5448377502e1323` |
| `engine.dll` | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |

This check needs no supplemental Engine. The retained owned Engine instructions
use the [previously documented in-memory recovery](native-engine-recovery-evidence.md).
It does not resolve other six-NOP import sites.

## Platform contract, rather than a guessed reset call

Microsoft documents the default Windows FP environment with exceptions disabled,
so exceptional computations produce NaN/infinity rather than a trap. The MSVC
process-initialization contract also specifies masked exceptions and nearest
rounding. These are the external platform assumptions of `win32-default`, not
values decoded from a game asset. See [Windows floating-point exceptions](https://learn.microsoft.com/en-us/windows/win32/debug/floating-point-exceptions)
and [the default MSVC floating-point environment](https://learn.microsoft.com/en-us/cpp/build/reference/fp-specify-floating-point-behavior#the-default-floating-point-environment).

Microsoft's [control-word documentation](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/controlfp-s)
also defines the masked update and constants: `_MCW_PC=0x30000`,
`_PC_53=0x10000`, and `_MCW_EM=0x8001f`. The retained binary independently contains
that mask/update mapping. This does not depend on identifying a CRT routine
solely from a familiar prologue.

An `FNINIT` exists at owned Core `101a4a4e`, in the body beginning `101a4a46`;
L2 has another at `10940e06`, body `10940dfe`. No relative direct call/jump or
literal function pointer to either body was found in the respective mapped
file-backed sections. That bounded census cannot exclude indirect/encoded
references. **Neither routine is asserted to run during startup.**

## Retained startup and main-thread path

L2's PE entry `109224da` calls `10929346`, then jumps to `109222fa`. The CRT path
passes `1` at `1092243e` to `10928684`. Its conditional initialization callback
slot `1095fa78` contains `10921cef`; that callback conditionally calls
`1092634a`, then clears pending exceptions with `FNCLEX`.

The helper passes `new=0x10000`, `mask=0x30000`, null output pointer to
`10933c98`. The downstream routine at `10941467` reads the x87 control word and
merges the API bits as `(old & ~mask) | (new & mask)` at `1094150f..10941517`.
The reverse mapper at `10940b1b` reconstructs the hardware bits before `FLDCW`
at `10941533`. In particular, hardware divide-by-zero mask `0x4` maps to API
`0x8` and back. No exception-mask bit is selected by `0x30000`.

Thus this startup path sets 53-bit precision while preserving incoming exception
masks. It cannot justify inventing masks for a deliberately altered initial
control word. Under the documented normal process default, the masks remain set.
The portable projection makes no assertion about reserved control-word bits.

The same executable reaches its WinMain body through `1092246c → 109014a6 →
10915ef0`; its `1091605c` IAT call binds the named `Core.appInit`. Later,
`10916861` directly calls the loop at `10911450`. The loop constructor records
`GetCurrentThreadId` and `GetCurrentThread` at `10910b3f/10910b48`, and the loop
repeatedly calls `10910d00` via `10901735`. That step calls the engine's virtual
slot `+0x68` at `10910dcd`. Owned `UGameEngine` vtable `1087b844 + 0x68` points
to the named Tick stub `10313d8b → 105972d0`. There is no thread handoff on this
specific chain. This check does not certify the complete transitive path from
Tick through every renderer/plugin callback to every GetFrame invocation.

## Normal Direct3D creation preserves the word

Named `UD3DRenderDevice.Init` calls the imported `Direct3DCreate9` with SDK value
32 at `1001bf78..1001bf7a` and stores the returned interface at `+0x4790`.
Both named `SetRes` overloads use that interface's `CreateDevice` slot `+0x40`.
Their ordinary behavior-flags paths execute `OR EAX,2` at `1001dc26` and
`1001ed36`, then pass the result at `1001dc9b` / `1001eda9`.

The [Microsoft SDK interface/constant declaration](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/shared/d3d9.h)
identifies this bit as `D3DCREATE_FPU_PRESERVE` and the argument order. Microsoft
states that the calling thread's control word remains untouched with this flag.
See [Direct3D control-word handling](https://learn.microsoft.com/en-us/windows/win32/dxtecharts/top-issues-for-windows-titles#manipulation-of-the-floating-point-control-word).

The alternative source branch is bound through the imported `Core.GL2NVPerfHUD`;
it passes literal `0x40` instead. The ordinary branch is explicitly the zero
PerfHUD path. We do not use that diagnostic branch to establish the normal
masked policy, nor claim the device call resets masks on the ordinary path.

## Later control-word writes and limits

The checker completely decodes these bounded linear ranges and finds no direct
`FLDCW`, `FNINIT`, `FLDENV`, `FRSTOR`, `FXRSTOR`, `XRSTOR` or `LDMXCSR`:

| Source span | Range, end exclusive |
| --- | --- |
| `UGameEngine.Tick` and trailing cleanup | `105972d0..10598a50` |
| `USkeletalMeshInstance.UpdateAnimation` | `106ba8d0..106bb0e0` |
| `USkeletalMeshInstance.GetFrame` and trailing cleanup | `106d9a70..106dd010` |
| `USkeletalMeshInstance.Render` and trailing cleanup | `106dd010..106e00b0` |
| L2 main-loop step, normal body | `10910d00..10911158` |
| `Core.appEnableFastMath`, normal body | `10177f50..10177f90` |

The last body has no calls/jumps either; its name is not proof of an active
floating-point mode change. Linear ranges may include cleanup/unnamed code and
are not a complete control-flow graph of all transitive callees.

Actual later `FLDCW` writes were also inspected. The named network Tick's
`10421990..104219a8` sequence saves the incoming word, copies it, ORs only
`0xc00` (rounding), uses that temporary word for `FISTP`, and restores the saved
word. It does not clear exception masks. This is a checked example of the
compiler's conversion sequences, **not** a claim that every control-word write
in every DLL was exhaustively classified. External callbacks and deliberately
modified process environments remain outside the admission contract.

For a finite negative current tween frame and previous `+0` or `-0`, the masked
division produces a signed infinity. The retained tween fraction-range branches
then choose reset: fraction zero, previous frame `-1/NumFrames`, current sequence
identity and accumulated fraction zero. The caller must explicitly select the
normal Windows contract; an unknown environment remains unsupported. This closes
that reset case, not exact transcendental/x87 intermediate parity or the broader
pose-cache lifecycle.
