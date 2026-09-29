# Elbera Tools Core

A small standalone Python toolkit from [ELBERA](https://github.com/elberacasa/Lineage2Elbera).
Use it to inspect your own Interlude packages, decode texture pixels, recover
embedded script text and inspect UI layout records. This download contains
source code and synthetic tests, not a client, server or game assets.

The [0.2.0 preview](https://github.com/elberacasa/Lineage2Elbera/releases/tag/elbera-tools-core-v0.2.0-preview)
and current source builds include the bounded file-123 class-prefix
reader, its authored fixtures and source-evidence guide. It locates supported
default-property streams without guessing their start. Unsupported bytecode
fails explicitly; native class construction and gameplay are outside its scope.
The existing published 0.1.0 ZIP retains its original contents.

Current source builds also include bounded Polys decoding and four synthetic
framing cases. The property-declaration reader includes eleven authored cases,
covering the conditional two-byte replication word and class/structure child
links. The property-layout helper adds seven portable cases: **23 selected files
and 58 portable checks** in total. It requires original field order and explicit
parent/nested sizes, or a complete decoded structure graph from which to resolve
them. Full class linking and current runtime values remain outside its scope. For
file-123 packages, Polys uses the original licensee-version cutoff of 22,
separate from the BSP surface cutoff of 21. The reader cannot consume bytes
from a neighboring export. These fixtures require no game files. Previously
published ZIPs, including the 18-file/36-check 0.2.0 preview, remain unchanged.

## Start here

Extract the ZIP, enter its `elbera-tools-core-<version>` directory, then run:

```sh
python3 tools/release/smoke_core.py
python3 tools/xdat/parse_xdat.py --help
python3 tools/uscript/extract_uscript.py --help
```

Python 3.10 or newer is recommended. The portable smoke suite and the included
Python library use only the standard library. No browser, Node, database,
application checkout or client files are needed for those checks. Tests use
synthetic bytes; passing them is not proof of complete original-client parity.

## Included tools

| Component | Use | Required inputs |
| --- | --- | --- |
| `tools/l2lib/` | Package/container readers, compact integers, DAT record readers, texture decoders and PNG writer | Your supported package/data bytes; encrypted formats may need the external decoder below |
| `tools/utx/utxedit.py` | List textures; conservatively replace same-format, same-size mip data with backup | Your UTX and replacement image; this older editor supports a narrower package subset than l2lib |
| `tools/uscript/extract_uscript.py` | Read bounded original TextBuffer exports without borrowing bytes from a neighboring export | Your pinned `Interface.u` and `NWindow.u` under `assets/interlude/system/`, plus l2encdec |
| `tools/xdat/parse_xdat.py` | Inspect supported shared controls, signed positions, anchors and window records | Your `Interface.xdat`; full `--check` also requires matching exported `assets/library/` textures; decoded SysString labels are optional |

Example commands after supplying your own files:

```sh
python3 tools/utx/utxedit.py list /path/to/your/package.utx
python3 tools/xdat/parse_xdat.py --src /path/to/Interface.xdat --out /path/to/local-layout.json
python3 tools/uscript/extract_uscript.py --check
```

The XDAT command above writes a local layout with unresolved texture references
when the exported library is absent. Its `--check` mode requires that library
and includes guards for the supported Interlude layout; it will fail without
those matching textures. It is not generic certification for every client
version. Read the tool's help before emitting decoded local data.
The UTX `replace` command intentionally changes the supplied package and
creates a backup. Work on a copy you own.

For the library, place `tools` on your Python import path, then import `l2lib`.
See `tools/l2lib/README.md` for its API and format notes. Its larger repository
integration corpus is not included in this Core release.

## External decoder and boundaries

Unencrypted input and l2lib's protocol 121 package path are pure Python.
Other encryption protocols, including the script extractor's 111 and DAT 413,
require a separately built `l2encdec` executable at `tools/bin/l2encdec`.
The UTX editor also needs it to re-encrypt **protocol 121** when replacing a
texture; pure-Python 121 reading does not imply pure-Python encrypted writing.
It is not bundled. The upstream
[open-l2encdec project](https://github.com/ritsuwastaken/open-l2encdec) has its
own license and build requirements. No third-party binaries, vendored code,
Python packages or game files are included in this archive.

The full ELBERA repository contains additional native evidence checkers,
converters, browser inspections and controlled playtest tools. They require
their own dependencies and often pinned originals or local converted assets;
this Core download does not advertise them as standalone commands.

`MANIFEST.json` records every included source path, size and SHA256 plus the
repository revision. File hashes identify the actual snapshot, including
reviewed working-tree changes if packaged before a commit. The source license
is in `LICENSE`; the public/history boundary is described in
`docs/public-release-boundary.md`. Neither grants rights to game content.

## Reproduce a source release

From the complete ELBERA source repository:

```sh
python3 -m unittest discover -s tools/release -p 'test_build_core.py'
python3 tools/release/build_core.py --check
python3 tools/release/build_core.py --version 0.1.0 --output tmp/releases/elbera-tools-core-0.1.0.zip
```

The builder uses an explicit source-file allowlist, rejects missing files and
symlinks, records hashes, and runs the portable suite from a fresh isolated
extraction before writing. It refuses to overwrite an existing archive.
ZIP member times and ordering are fixed; matching source bytes, revision,
version and Python/zlib toolchain produce matching output. Build receipts and
release ZIPs stay local until the maintainer explicitly publishes them.
