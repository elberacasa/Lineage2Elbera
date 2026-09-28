# Elbera Tools BSP Inspector

A standalone source kit from [ELBERA](https://github.com/elberacasa/Lineage2Elbera)
for inspecting the world BSP component of a collision query. It includes the
same query module, inspector page and portable tests used in the repository.
The default box is an authored synthetic fixture, not original game geometry.

**No game files, generated maps, native DLLs, accounts or server software are
included.** This kit does not enable native gameplay movement or camera collision.

## Open the inspector

Extract the ZIP and enter `elbera-tools-bsp-inspector-<version>`. Serve that
directory locally with Python 3:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open [the local tool index](http://127.0.0.1:8000/editor/world/test/index.html)
in a current browser. Use HTTP because browsers restrict ES modules opened
directly through `file:` URLs. No npm install, external JavaScript, application
checkout or game-server connection is required.

The inspector starts with a synthetic box. Enter start, end and half extent
as three comma-separated numbers. Results distinguish an obstruction, a clear
world-BSP query and unsupported input. The drawing is a diagnostic projection;
its boxes represent hull bounds, not the full convex geometry.

## Use your own source export

Choose a local `l2-bsp-collision-source-v1` JSON file using the page's file picker.
The file is read in the browser and is not uploaded. It can remain outside the
folder served by the local HTTP server. Enter explicit query coordinates after
loading it; synthetic coordinates are deliberately cleared.

The original-input exporter is a separate tool in the full ELBERA repository:
[export_bsp_collision.py](https://github.com/elberacasa/Lineage2Elbera/blob/main/tools/world/export_bsp_collision.py).
It and its decoding/native-verification dependencies are **not included** in
this inspector-only kit. Supply your own matching original inputs when using
that exporter. Do not treat an arbitrary JSON file or displayed fingerprint
as authenticated original data.

## Check the extracted kit

The optional verification command needs Python 3 and Node.js **22 or newer**:

```sh
python3 tools/release/smoke_bsp.py
```

It verifies every manifest hash, checks that the two HTML pages and browser
module imports resolve within the kit, checks JavaScript syntax, and runs the
complete portable BSP test suite. No client files, Python
packages or browser automation are required. Tests use authored fixtures;
passing them does not certify original-game parity or visual browser behavior.

## Scope and limits

The nonzero extent path follows the recovered world BSP traversal, hull bounds,
plane orientation, bevel construction and wrapper timing for the admitted
no-owner / ExtraNodeFlags=0 domain. The separate primary zero-extent helper has
its own narrower scope. Stored Float32 boundaries are retained; JavaScript
Float64 intermediates approximate original x87 arithmetic.

Terrain, static/dynamic actor aggregation, transformed brushes, adjacent levels,
MoveActor behavior, stepping and complete movement/camera integration are
outside this kit. A clear BSP result does not establish that the full world
query is clear. Unsupported arithmetic or data remains an explicit unknown.

Original-input evidence and the qualified supplemental-binary provenance limits
are documented in the repository's
[native camera/BSP evidence](https://github.com/elberacasa/Lineage2Elbera/blob/main/docs/native-camera-evidence.md).
Those verifiers and source inputs are not bundled. Source export fingerprints
identify supplied bytes; they do not authenticate ownership or provenance.

## Contents and release identity

| File | Purpose |
| --- | --- |
| `editor/world/js/bsp-collision.js` | Pure BSP query implementation |
| `editor/world/test/bsp-collision.test.mjs` | Portable synthetic tests |
| `editor/world/test/bsp-original.html` and `bsp-original.js` | Browser inspector |
| `editor/world/test/index.html` | Kit-specific index with one working tool link |
| `tools/release/smoke_bsp.py` | Manifest, dependency and test checks |
| `package.json` | Explicit JavaScript module mode; no dependencies or install scripts |

`MANIFEST.json` records the source revision, source path and SHA-256 of every
included file. `committed-source` means the builder observed a clean checkout;
`working-tree-candidate` means the archive contains working-tree bytes alongside
the recorded HEAD revision. The hashes identify those actual bytes. The archive
uses an explicit allowlist and deterministic member metadata; it does not sweep
adjacent project folders into the package.

The project source license is included as `LICENSE` at the extracted root. Original game
content remains separate; see the repository's
[public release boundary](https://github.com/elberacasa/Lineage2Elbera/blob/main/docs/public-release-boundary.md).
Core and NPC Source are separate profiles and are unchanged by this kit.
