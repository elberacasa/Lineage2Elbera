# Supplemental archived Engine evidence

Elbera Tools, 2026-09-27. A separately retrieved, unpacked Engine copy supplies
named Core imports in a structurally matching player-placement method. This is
**supplemental, hash-pinned evidence from an unauthenticated third-party archive**.
It is not proof that the archive is an untouched NCSoft distribution, or that
every method is equivalent to the owned client. No downloaded binary was run,
installed, or copied over the project's client inputs.

## Retrieval and provenance

The candidate is member `system/engine.dll` in
[Interlude.7z on Internet Archive](https://archive.org/details/interlude.-7z).
The [download URL](https://archive.org/download/interlude.-7z/Interlude.7z)
redirected to `https://dn710604.ca.archive.org/0/items/interlude.-7z/Interlude.7z`.
The archive is 2,454,899,368 bytes. Its metadata reports MD5
`a63d940804fdf06d5c7faf9cdaa53572` and SHA1
`7bb96a05e5efd80a4e2b4d67a02444c4b1e988b1`; these are **archive metadata values**,
not hashes independently calculated over a complete download. Other indexed
uploads report those same hashes and do not count as independent copies.

Only the 7z header/tail and compressed folder containing the relevant system
libraries were downloaded. Each range response was required to be HTTP 206
with the exact Content-Range and byte count. A local sparse placeholder was
explicitly named `SPARSE-NOT-FULL`; it is not a complete archive. The folder was
decoded with `py7zr` without executing any extracted code.

| Retrieved record | Independently checked value |
| --- | --- |
| Solid folder index | 2 |
| Compressed inclusive byte range | `2448045692–2454879113` |
| Compressed size | 6,833,422 bytes |
| Compressed SHA256 | `476c6e7b6bdde3bb5753aaabfbbc3428055af44e90d175993363def9a960f965` |
| 7z start-header CRC32 | `3cb5b959`, recalculated over bytes 12–31 |
| Next-header inclusive range | `2454899328–2454899367` |
| Next-header CRC32 | `9bd3d67a`, recalculated |
| Engine member size / CRC32 | 30,704,468 bytes / `9712445a` |
| Engine member SHA256 | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |
| Core member size / CRC32 | 1,372,180 bytes / `e725dfd4` |
| Core member SHA256 | `d83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639` |

Both member CRCs were independently recalculated with `zlib.crc32` and compared
with the 7z member records. This verifies consistency with this archive, not
vendor authenticity. The 7z Engine member timestamp is August 2015 and its PE
timestamp is September 2007. It has reconstructed import/relocation sections.
Those facts preclude calling it an untouched 2007 installer just because the
upload description calls it official. Timestamps themselves are not authenticators.

A separate older mirror also supplied a protected Engine with a different
hash and 10,061 exports. Its edition/build correspondence was not established
and it is not used by this proof. The useful supplemental Engine has 10,083
exports and 1,098 named/ordinal import entries; this count alone is not a
version-equivalence test.

## What the complete method comparison proves

The owned Engine remains SHA256
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`, decoded only
in memory using the existing word transform. Its missing calls were already
verified to be present as NOPs in the decoded original bytes; the shared decoder
does not delete them. See [the recovery boundary](native-engine-recovery-evidence.md).

The new [PE reader](../tools/ui/supplemental_pe.py) maps every RVA through the
image's actual section table. The supplemental image's raw offsets differ from
its RVAs; reading it with the old original-specific direct-offset assumptions
would produce incorrect results. It rejects out-of-file reads, invalid export
ordinals, unterminated imports and unsupported input hashes. Exported BSS
addresses may be recorded but never read as invented zero bytes.

The named `USubSkeletalMeshInstance::MeshToWorld(float)` body is 2,379 bytes,
including its final `ret 8`. It begins at owned VA `0x106b5f20` and supplemental
VA `0x106b5ee0`. The verifier visits every supplemental instruction and compares
all bytes. It accepts only these individually checked differences:

- 25 six-byte named IAT calls in the supplement replace exactly six NOPs in
  the owned image. Each call resolves through the supplemental import table.
- 10 relative calls have different encoded displacements but target the same
  absolute thunk VA, with identical five-byte thunk contents.
- One explicitly pinned pushed exception-handler address differs by `0x40`.
  Its first ten bytes match. This compares the handler entry only; complete
  exception/unwind behavior is outside this claim.

There are **no unexplained geometry, arithmetic, register, or branch-byte
differences in this complete method body**. Normalizing only those checked
differences reproduces the owned method SHA256
`fa2354338aa0a33d670d0d1ff78a488ec53df55782d001ce0158a1b5ef8fc2f3`.
The unmodified supplemental body SHA256 is
`8e140732ae4142c3ffcba563388f6533393b9d39342b19be030f681049a8950d`.

The three composition calls previously unbound in the owned method now have
this supplemental correspondence:

| Owned call VA | Supplemental call VA | Named Core import |
| --- | --- | --- |
| `0x106b643d` | `0x106b63fd` | `FMatrix::operator*(FMatrix)` |
| `0x106b6468` | `0x106b6428` | `FMatrix::operator*(FMatrix)` |
| `0x106b6493` | `0x106b6453` | `FMatrix::operator*(FMatrix)` |

The exact decorated symbol is `??DFMatrix@@QBE?AV0@V0@@Z`. This is evidence for
the binding in the structurally matching supplemental method. It does not
recover the owned protector's import-repair table or prove who supplied the
supplement's imports.

## Companion Core comparison

The supplemental Core differs from the owned Core
`9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` at only
13 file bytes: `0x77a54..0x77a59`, `0x77a85..0x77a8a`, and `0x1373b0`.
Their meaning is not needed or inferred. The verifier separately resolves and
compares all bytes of the relevant named bodies through their final returns:

| Named Core body | VA in both copies | Bytes compared |
| --- | --- | ---: |
| `FMatrix::operator*` | `0x10111240` | 584 |
| `FMatrix` destructor | `0x101111e0` | 1 |
| `FCoords::Matrix` | `0x1014df30` | 244 |
| `FCoords::ApplyPivot` | `0x1014d8c0` | 202 |
| `FCoords::PivotInverse` | `0x1014db40` | 474 |

All five are exactly equal. This allows existing owned-Core arithmetic evidence
to be joined to these supplemental import bindings without assuming whole-file
identity. Ordinary hair/cache method comparisons are documented separately in
[the hair attachment evidence](native-hair-attachment-evidence.md).

## Reproduction and remaining limits

Supply the two privately retained archive members explicitly; no download or
binary execution occurs in this command:

```sh
python3 tools/ui/check_supplemental_engine.py \
  --engine /private/path/system/engine.dll \
  --core /private/path/system/Core.dll --check
node tools/ui/test_supplemental_pe.mjs
```

Both commands require Python `capstone`; the portable suite is source-free,
not dependency-free. The first also requires the repository's pinned owned
Engine/Core. Omitting `--check` emits a metadata-only comparison receipt. The
second runs eight synthetic tests for address mapping, IAT resolution, malformed
bounds and changed-call/method rejection, without original binaries.

Private retrieval receipts retain exact URLs, range hashes, member/header CRCs
and archive metadata. Downloaded DLLs, sparse archive, disassembly and receipts
stay under ignored `tmp/restart-audit/source-candidates/`. They are not release
artifacts. No full-build equivalence, native execution, complete skinning or
world placement implementation follows automatically from this checkpoint.
Each further formerly missing call needs its own bounded source correspondence.
