# Original NPC GPU influence inputs

The original Interlude files contain both a lazy influence table and a stored
52-byte GPU vertex stream. They differ slightly. The browser's optional source
skin path now preserves the latter's four Float32 weight lanes, their order and
repeated bones. This establishes input fidelity, **not complete native skinning**.

The [Elbera verifier](../tools/ui/check_npc_skin_native.py) reads originals in
memory and requires an explicitly supplied supplemental Engine for bounded
import correspondence. It never executes a DLL or changes a model:

```sh
python3 tools/ui/check_npc_skin_native.py \
  --comparison-engine /path/to/pinned/supplemental/engine.dll --check
```

Omit `--check` for the detailed local receipt. This is an original-input check;
the portable exporter and actual-loader fixtures are documented in the
[NPC source guide](original-npc-animation-runtime.md).

## Source domain

| Input | SHA-256 |
| --- | --- |
| Owned `Engine.dll` | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| Supplemental `Engine.dll` | `508974c711f207402719e92737e211a2f029c95c2f68fc0e1c31fcbb9dbb232d` |
| Original `LineageMonsters.ukx` | `157715304bfb1f289ce6bf202e5651f3809f57d5b061239db0c6a2a817c9a9c9` |

The supplemental archive is unauthenticated. Exact compared blocks qualify
specific imported identities; they do not restore protected owned imports or
establish whole-build equivalence. The checker rejects other input hashes.

Fresh Gremlin and Fox LOD0 reads retain 1,324 and 422 complete records. Both
store GPU-stream flag 1. The full soft52 payload hashes are respectively
`49d1c6384c12d64d9e2cab2822b9693101b3b657df72f6ec2614e2181997c506`
and `c3fcdd2b5c22297276f70641d081e52cfb11b7d35838b58d54b9fd7eb1dd766c`.
These are source record hashes, not hashes of normalized or exported weights.

## Retained native chain

The check verifies 78 serializer and 55 consumer instruction anchors:

1. `USkeletalMesh::Serialize` passes mesh `+0x218` to the LOD array reader.
   Its elements are `0x174` bytes. The element reader handles lazy influences
   and wedges separately from flag `+0x168` and the array at `+0x1c`.
2. The soft array reader uses a 52-byte stride. Its element reader transfers
   eight four-byte fields, four single-byte lanes, then four four-byte fields.
   Independently bounded original bytes reproduce every decoded record.
   Missing scalar helper targets remain explicit in the receipt.
3. The LOD constructor embeds `FGPUSkinVertexStream` at `+0xb4`. For the admitted
   licensee version, the loading branch sets LOD `+0xc4` to the LOD itself.
   Consequently stream `+0x10` points to that LOD. The relevant constructor,
   `LicenseeVer`/`ByteOrderSerialize` and `IsLoading` blocks compare exactly
   under the listed call correspondences.
4. The ordinary render gate requires non-editor mode, `GL2GPUSkinning` or
   `GL2Shader`, the LOD GPU flag, a nonempty smooth-section array, and a zero
   material-exclusion local. Its 86 bytes match with only three explicitly
   identified data-import operands changed. Other actor-special paths remain
   separate; this is not a claim that every native draw uses this gate.
5. The selected render path passes the current LOD's stream to the render
   interface. `GetStreamData` reads data at LOD `+0x1c`, count at `+0x20`, and
   passes `count * 52` bytes to the retained copy helper. No weight arithmetic
   occurs in this stream method. The helper's copy entry/loop is checked; the
   tool does not emulate every optimized branch or claim a restored import.
6. `RecalcSkinningStream` rejects section palettes above 70 bones. Original
   diagnostics explicitly distinguish GPU-stream presence and its flag. The
   browser source-input exporter uses that bound and rejects unsupported data.
   The CPU path instead reads the separate encoded stream and packed points;
   it is not certified by carrying the GPU records.

## Conversion and browser boundary

The old UEViewer path chooses the nonempty lazy arrays, quantizes weights into
four byte lanes, merges repeated bones and repairs the byte sum. PSK export
unpacks these bytes; the glTF assembler normalizes again. A fresh local export
reproduces all 1,746 current glTF vertices. The inherited 582/215 mismatch counts
are comparisons to the stored GPU records, not unexplained corruption.

`--npc-skin` uses exact per-section POSITION/UV correspondence and verified bone
paths to carry source lanes inside the existing private ELBA bundle. It does
not rewrite the converted glTF. The browser validates the bundle/model join,
then installs actor-owned attributes after GLTFLoader's normalization step.
Source sentinel lanes remain recorded and use a valid browser joint with zero
contribution. Repeated lanes and nonunit weight sums are not repaired.

Native shader arithmetic, inverse-bind construction, CPU deformation, actor
placement, lighting and full animation state remain unverified. The inspection
page reports active source input preservation separately from these gaps.
Original files, generated bundles and detailed local receipts stay private.
