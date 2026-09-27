# Elbera Tools NPC Source

A standalone source-analysis kit from
[ELBERA](https://github.com/elberacasa/Lineage2Elbera). Recover qualified NPC
animation references, preserve original sparse keys and inspect bounded native
evidence using your own Interlude inputs. The ZIP contains Python source,
authored synthetic tests and this guide. It contains no game files, converted
models, browser application or graphical inspector.

This is a separate profile. **Elbera Tools Core 0.1.0 is unchanged.**

## Start without game files

Extract the ZIP and enter `elbera-tools-npc-source-<version>`:

```sh
python3 tools/release/smoke_npc_source.py
python3 tools/anim/export_source_tracks.py --help
python3 tools/ui/check_npc_skin_native.py --help
```

Python 3.10 or newer is recommended. The default smoke uses only the standard
library: it checks the manifest, four command help pages, source-only imports
and five synthetic test suites. No client, server, database, Node or application
checkout is needed. These tests verify implementation boundaries; they do not
certify original-game parity.

Optional synthetic PE correspondence tests require a separate environment:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-native.txt
.venv/bin/python tools/release/smoke_npc_source.py --native-fixtures
```

Both Capstone's module and installed distribution must be **5.0.7**. The same
dependency is needed for the two native evidence commands below. It is not
bundled; Capstone retains its own license. Synthetic PE tests do not execute
DLLs or require originals.

## Supply your own private inputs

The current commands resolve inputs relative to the extracted kit. They do not
offer an arbitrary client-root switch. Preserve this directory structure:

| Location | Used for |
| --- | --- |
| `assets/interlude/system/` | Original DAT tables, class packages and corresponding `.int` files; the native checks also require pinned `engine.dll` and `Core.dll` (preserve that case) |
| `assets/interlude/animations/` | Original skeletal mesh and animation packages reached through qualified references |
| `tools/bin/l2encdec` | Separately acquired/built decoder for encrypted class text and DAT inputs |
| `editor/characters/monsters/manifest.json` and its referenced glTF/buffer files | Existing converted geometry, needed only for runtime bundle export and optional selector diagnostics |

Supply the matching original dataset, including dependencies reached through
the selected classes. Copying only `npcgrp.dat` is insufficient. The supported
commands do not require browser code, textures, UEViewer, NumPy or Pillow.
The runtime exporter does require **matching converted model data**: it checks
source triangle positions, UVs, winding and bone paths before emitting a
bundle. This kit does not create those models or bypass that check.

The external decoder is not included. The
[open-l2encdec project](https://github.com/ritsuwastaken/open-l2encdec) has its
own license and build requirements. Pure-Python protocol 121 package reading
does not remove the decoder requirement for the other encrypted inputs.

## Four supported command paths

**Recover selectors.** This follows original NPC class inheritance, the class
mesh reference and its serialized animation reference. Names retain package
and group qualification; converted aliases are diagnostics, not authority.

```sh
python3 tools/anim/build_npc_variants.py --selectors-only --npc 20001 20091 --output /path/to/private/npcselectors.json
python3 tools/anim/build_npc_variants.py --selectors-only --npc 20001 20091 --output /path/to/private/npcselectors.json --check
```

The first command writes the requested JSON. The second freshly decodes and
compares it without repairing anything. **Always use `--selectors-only` in
this kit.** The older model-conversion mode and its external conversion stack
are intentionally excluded. Internal support modules are not additional
advertised standalone commands.

**Pack source inputs.** The default is read-only; add `--write` only to emit
your local outputs, then `--check` to compare fresh bytes:

```sh
python3 tools/anim/export_source_tracks.py --npc 20001 20091 --runtime --npc-skin
python3 tools/anim/export_source_tracks.py --npc 20001 20091 --runtime --npc-skin --write
python3 tools/anim/export_source_tracks.py --npc 20001 20091 --runtime --npc-skin --check
```

For the checked Gremlin and Fox inputs this preserves all eight sequences per
model, including one-frame poses. Keys are not resampled. The optional
`--npc-skin` retains stored GPU soft52 influence lanes without merging,
quantizing or normalizing them. It does not prove native shader, CPU skinning,
inverse-bind or final deformation equivalence.

Outputs are private `assets/gamedata/animation-tracks/runtime/*.l2anim` files
and `assets/gamedata/npc-animation-runtime.json`. A write replaces the index
with the **selected NPC set**, not an automatic union. Each model file is
replaced atomically; the hash-bearing index is adopted last. There is no
transactional rollback of the whole output set. The ELBA header, JSON schema
and packing are authored transport, not an original client format.

**Check original initial-animation inputs.**

```sh
.venv/bin/python tools/ui/check_npc_animation_native.py --comparison-engine /path/to/supplemental/engine.dll --comparison-core /path/to/supplemental/core.dll --check
```

**Check conditional GPU stream inputs.**

```sh
.venv/bin/python tools/ui/check_npc_skin_native.py --comparison-engine /path/to/supplemental/engine.dll --check
```

These are pinned-build evidence checks, not general compatibility tests. They
read owned originals and require explicitly supplied, fingerprinted supplemental
binaries for erased-call correspondence. They neither execute DLLs nor restore
them in place. A mismatch fails; a different client is not silently accepted.
Supplemental archive provenance is limited, and structural agreement is not
publisher authentication. See [the input and release boundary](docs/source-boundary.md).

Initial-state checks do not authorize unconditional live NPC playback. The
browser's original-source inspection, timing, modifiers and full rendering
remain separate layers. The project's
[NPC source guide](https://github.com/elberacasa/Lineage2Elbera/blob/main/docs/original-npc-animation-runtime.md)
describes its graphical inspector; that application is **not included here**.

## Reproduce the archive

Run these only from the complete ELBERA **source repository**, not this ZIP;
the release builder and its packaging tests are repository maintenance tools:

```sh
python3 -m unittest discover -s tools/release -p 'test_build_npc_source.py'
python3 tools/release/build_npc_source.py --check
python3 tools/release/build_npc_source.py --version 0.1.0 --output tmp/releases/elbera-tools-npc-source-0.1.0.zip
```

Add `--native-fixtures` using the pinned environment to run the optional PE
suite in the fresh extraction too. Every build uses an explicit file allowlist,
rejects symlinks/missing/binary sources and smoke-tests an isolated extraction
before writing. Existing ZIPs are never overwritten. Matching source bytes,
revision, source state, version and Python/zlib toolchain yield matching ZIP
bytes. `MANIFEST.json` records exact source paths, hashes and sizes.

`sourceState: working-tree-candidate` identifies prospective source packaged
before a clean commit. Its revision is the checkout's parent snapshot, not a
claim that the current bytes were committed there. A reviewed release must be
rebuilt from the final clean source commit. `committed-source` identifies a
clean checkout, not permission to publish. No command uploads or releases.
