# NPC Source: input and release boundary

The archive allowlist contains authored Python source, synthetic tests, guides
and the source license. It excludes original client binaries/packages, decrypted
scripts, generated catalogs and animation bundles, converted models/buffers,
textures, accounts, credentials, playtest receipts and screenshots. Supplying
your own inputs does not make them part of a future source release.

The included `LICENSE` applies to authored project code. It does not grant
rights to game content. Capstone and l2encdec are external dependencies with
their own licenses; neither package nor executable is bundled. The larger
repository's existing-history policy is described in its
[public release boundary](https://github.com/elberacasa/Lineage2Elbera/blob/main/docs/public-release-boundary.md).

## Pinned native inputs

The native verifiers check these complete file fingerprints before using the
relevant instruction bodies. They never execute a client binary.

| Input | SHA256 |
| --- | --- |
| Owned Interlude Engine | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Owned Core | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| Explicit supplemental Engine | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |
| Explicit supplemental Core | `d83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639` |

The supplemental copy is archived material with limited provenance. Named
imports are used only under bounded byte/relocation correspondence with the
owned build; that is not authentication as an untouched NCSoft distribution.
Package/export fingerprints and qualified class, mesh and animation references
are recorded by fresh source extraction. Full references are mandatory even
when a generated model token or legacy filename happens to match.

## What the checks establish

- Selector recovery preserves declared/inherited source fields and resolves
  serialized animation references. It does not infer an animation from an NPC
  nickname or matching filename.
- Runtime export verifies the admitted model's triangle positions, UVs,
  winding and source-bone association. It does not certify material, placement,
  inverse-bind or skinning parity.
- Optional GPU soft52 data preserves the conditional native stream's exact
  stored influence inputs. The native CPU branch, shader evaluation and final
  rendered skin remain separate proof obligations.
- Initial-animation evidence establishes bounded packet/selector/allocation
  inputs and original spawn-event lookups. It does not prove every live actor
  has the required neutral state, nor admit every NPC/event/modifier.
- Portable tests use authored synthetic data. Original-input checks require
  the owner's local corpus and are never replaced by a passing synthetic test.

Detailed, versioned evidence remains in the repository:
[NPC animation](https://github.com/elberacasa/Lineage2Elbera/blob/main/docs/native-npc-animation-evidence.md),
[NPC skin inputs](https://github.com/elberacasa/Lineage2Elbera/blob/main/docs/native-npc-skin-evidence.md),
[supplemental Engine](https://github.com/elberacasa/Lineage2Elbera/blob/main/docs/supplemental-engine-evidence.md).

The standalone guide is [README.md](../README.md). Rebuild only from the
repository's explicit release profile. Do not archive an input-populated
working directory or redistribute the generated private outputs as tool source.
