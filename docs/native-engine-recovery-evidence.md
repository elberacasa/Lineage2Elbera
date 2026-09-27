# Original Engine recovery boundary

Elbera Tools, 2026-09-26. **The shared decoder does not delete the missing
MeshToWorld or LocateEffect calls.** Independent inspection of the owned
raw file reproduces their six NOP bytes exactly. Three additional original
startup transforms and a compressed VM-handler payload are now recovered
in memory. **The runtime import-repair program and exact call targets are
still unverified.** No placement or effect transform changes follow from
this checkpoint.

## Raw input and the earlier assumption

The input is the owned `assets/interlude/system/engine.dll`, SHA256
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`.
This hash pins the inspected copy; it does not independently authenticate
vendor-original distribution provenance. There is only one Engine.dll
under the repository's owned asset inputs.

The PE image base is `0x10300000`. Its first section starts at both file
offset and RVA `0x1000`, with size `0x1a98000`. The existing decoder derives
the dword key `0x7965b551` from a known exported UTF-16 function name and
subtracts it independently from each little-endian dword. It does not
patch calls, run native code, or load a previously reconstructed binary.

The new verifier reads raw words directly, independently performs the
subtraction, compares with the existing recovery, and adds the key back to
require byte-for-byte raw-file equality. It covers these five sites,
including their unaligned word boundaries:

| RVA | Surviving caller context | Recovered bytes |
| --- | --- | --- |
| `0x3b643d`, `0x3b6468`, `0x3b6493` | MeshToWorld matrix composition | Six NOPs each |
| `0x1ec8f2`, `0x1ec902` | LocateEffect rotation/relative-vector helpers | Six NOPs each |

This rules out the shared decoder deleting these calls. It does **not**
establish who replaced them, whether a runtime protector restores them,
or their original import names. Older evidence uses “erased import” as
shorthand for this recovered-code boundary; attribution to a specific
protector repair mechanism is not yet demonstrated.

The raw ordinary import directory contains only `KERNEL32.dll`'s
`CreateFileA` and `ExitProcess`, and `COMCTL32.dll`'s `InitCommonControls`.
The relocation directory is a single empty eight-byte block. Neither
provides a Core import binding for these sites.

## Additional recoverable startup layers

The original PE entry at RVA `0x1a9b014` jumps to `0x1a9e535`. Static
instruction checks bind the following transformations and their ranges;
the verifier applies only those data transformations, without executing
the Windows client or emulating its complete startup environment.

1. The PC-relative base calculation at `0x1a9e53a..0x1a9e540` and byte loop
   at `0x1a9e7ab..0x1a9e7ba` subtract one from each byte in
   `[0x1a9e7bc, 0x1aa57bc)`.
2. Recovered instructions at `0x1a9e98e..0x1a9e9f9` process unaligned dwords
   backward from `0x1aa42c7`, stopping after `0x58c0` bytes. For each dword,
   the operations are subtract `0x4c903eb9`, XOR `0x0afacf0b`, then subtract
   `0x17959be1`, with unsigned 32-bit wrap. The resulting range is
   `[0x1a9ea0b, 0x1aa42cb)`.
3. Instructions at `0x1a9f11c..0x1a9f1aa` process unaligned dwords backward
   from `0x1aa5552` across `0x63a0` bytes: add `0x33efaacb`, subtract
   `0x3fbb16ac`, then add `0x5b4a5ce1`, with unsigned 32-bit wrap. The range
   is `[0x1a9f1b6, 0x1aa5556)`.

The order matters: the ranges overlap. The new layers reveal a native
bitstream decompressor at `0x1aa2887..0x1aa2a34`. Its caller at
`0x1b4c599..0x1b4c5c7` locates a header and 11-byte records, then passes the
following compressed bytes to this routine.

| Recovered framing | Value |
| --- | ---: |
| Header RVA | `0x1aa2c10` |
| Handler records | 150 |
| Compressed payload RVA | `0x1aa3292` |
| Declared and consumed input bytes | 692,566 |
| Declared and produced output bytes | 983,624 |
| Decompressed payload SHA256 | `0684bfb06e55ddc00872d5110680b7eb86e8f59ecc804f32fcde4d82fdc6ec19` |

The loader uses record bytes 0/1 to select 150 unique two-level handler
slots and record dword `+2` as an offset into the allocated payload. All
these offsets fit the recovered payload. Record dword `+6` is not assigned
an invented meaning. A separate optional handler index is registered by
the small function at `0x1b4c73f`. These are VM-handler registrations,
not a recovered table of Core function names.

The decompressor preserves interleaved control bytes, gamma-coded values,
overlapping backreferences, the previous-offset mode and original length
thresholds. Eight source-free tests exercise those behaviors and reject
truncation, impossible references and incorrect output bounds. Exact
input consumption and output size independently agree with the original
header. This validates the bounded payload recovery; it is not proof of
the protected program's runtime behavior.

## The recovered VM program entry

A further bounded trace closes the framing beyond the handler payload.
The original bootstrap jumps at `0x1b4c8d5` to `0x1b4e1e2`, which selects
native thunk `0x1b4dcc3`. That thunk supplies token `0x45599378` and jumps
to the common entry at `0x1b4c8da`. The common entry recomputes the same
PC-relative base and stores table address `0x1b4e176` in VM context `+0x62c`.
It then transfers to the register-saving bridge at `0x1aa2a42`.

That table has a two-dword header followed by eight 12-byte rows and a
`0xffffffff` sentinel. The header identifies the program byte range
`[0x1b4c940, 0x1b4dcc3)`, **4,995 bytes**, SHA256
`ea3033e4d58d690e57956b26579525a79e79b38280bc8425f965fe415cbc690c`.
The eight rows are:

| Token | Bytecode entry RVA | Corresponding native thunk RVA |
| --- | --- | --- |
| `0x45599378` | `0x1b4c940` | `0x1b4dcc3` |
| `0x13b1e9a7` | `0x1b4cb3e` | `0x1b4dd46` |
| `0x495812a0` | `0x1b4ccf1` | `0x1b4ddf6` |
| `0x7d04a982` | `0x1b4d084` | `0x1b4de7e` |
| `0x6735564e` | `0x1b4d381` | `0x1b4df12` |
| `0x7be1f463` | `0x1b4d4da` | `0x1b4dfc7` |
| `0x45afe11d` | `0x1b4d7aa` | `0x1b4e075` |
| `0x4471cd2c` | `0x1b4d903` | `0x1b4e107` |

The bridge stores the program's start/end in context `+0x37c/+0x3d4`,
looks up the supplied token in these rows, and stores the matching bytecode
entry at context `+0x5e8`. It then jumps to context `+0x39c`. Earlier native
setup populates this field with context `+0x7d0`, where it copies exactly
`0x12b` dispatcher bytes from `0x1b4c3e8`, immediately after the compressed
handler payload. Dispatcher SHA256 is
`f1f68d61e259e1c72e8c44bb6f469f0a0aa1666ea672cf450f97c7b10626e24f`.

Static arithmetic in this dispatcher reads the dword at the virtual IP,
cancels paired XORs, masks the low byte, clears bit 7, and dispatches through
the optional-index handler table. The initial selector is 0 and the table
points to decompressed-handler offset 0. This simplification is a static
observation, separate from the conditional handler trace below. None of the
eight entries is identified as import repair.
The third row field matches the corresponding native thunk; it is **not**
assumed to be a return address. The verifier adds 40 original instruction
anchors for this framing and checks every entry's bounds and token uniqueness.

## First handler body: a bounded conditional trace

The Elbera Tools verifier now includes a restricted integer interpreter for
the recovered instructions. It permits explicit registers/memory, arithmetic,
branches, bounded string copies and opaque flags save/restore. It rejects
missing memory, unknown branch flags, native calls, unsupported instructions
and control flow outside the declared payload. It does not run the DLL or
model Windows APIs.

Starting at handler offset 0 with virtual IP `0x1b4c940`, **1,242 original
instructions** decode the first **15 program bytes**. The resulting virtual
IP is `0x1b4c94f`, class is **54**, and variant is **2**. The source handler
table maps that pair to decompressed payload offset `0xe4d08`. A further
**511 instructions** reach the end of its register-bank copy:

| Observed body prefix | Source relationship |
| --- | --- |
| Virtual saved-register-stack marker advances by 24 | Context `+0x3b8`: `0xf0000000` → `0xf0000018` |
| 28 dwords rotate right by six places | Bank rooted at context `+0x74`; scratch bank rooted at `+0x144` |
| Scratch bank copies back to active bank | Payload `0x60b40..0x60b54`, `REP MOVSB` of 112 bytes |
| Explicit stop | Immediately after that copy, at payload `0x60b56`, before returning to dispatch |

The marker initialization is pinned at Engine RVA `0x1aa2ad1`; active-bank
pointer initialization is pinned at `0x1b4c6d0..0x1b4c6d3`. The bridge saves
the native registers into this bank before dispatch. The verifier supplies
**three synthetic register/bank cases**, synthetic allocated addresses and
forward string-copy direction. Those inputs are deliberately not described
as a recovered native process snapshot. Each case traverses the same 1,753
instructions and independently checks the rotation against an ordinary
Python list operation. All observed writes stay within the modeled VM
context and scratch stack; no image writes or native calls occur in this
prefix.

This closes a concrete first-handler behavior, **not the complete handler
or program**. Restoring the saved registers, returning to dispatch, subsequent
operations, initial process state and potential import-repair effects remain
outside the verified slice. A later exploratory continuation reached an
unprovided virtual-register memory read; it is not used as evidence of a
valid second operation. No matrix/import target is inferred from the VM
bookkeeping. Eight additional source-free tests exercise partial registers,
signed/unsigned flags, stack addressing, opaque flags, direction-preserving
overlapping copies and fail-closed boundaries.

## Remaining boundary and reproduction

No plain RVA, VA or first-section-relative reference to the five target
sites occurs in the raw file, the additionally recovered image or the
decompressed payload. This negative search does not exclude encoded,
relative or computed repair records. Beyond the conditional first-handler
prefix, the virtualized program, its API resolution and potential import
restoration remain uninterpreted. No native code is executed.
The named Core matrix operator remains an ABI-compatible candidate, as
described in [the player transform audit](player-transform-audit.md), and
the [LocateEffect helpers](native-locate-effect-evidence.md) remain unbound.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/ui/check_engine_recovery_native.py --check
PYTHONDONTWRITEBYTECODE=1 python3 -S -m unittest discover -s tools/ui -p test_engine_recovery_native.py
```

The native verifier requires the pinned owned Engine.dll and Capstone. It
checks 113 instruction anchors, five independent raw-byte round trips and
three conditional first-handler traces. All 16 portable tests pass.
`--check` prints a concise summary; without it, the tool prints the metadata
report. `--output tmp/restart-audit/engine-recovery-native.json` saves that
report under the ignored local directory and can accompany `--check`.
The report contains only provenance, counts and explicit limits; the tool never writes
decrypted code, payload bytes, a DLL, or public client assets. The portable
tests need neither client assets nor Capstone.
