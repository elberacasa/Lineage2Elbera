# Public source and local data

ELBERA publishes its own source, tests, build tools and evidence documentation.
Client originals, decoded game data, converted assets, local server snapshots
and raw playtest receipts belong in the operator's local workspace. A fresh
source checkout is not a ready-to-play game distribution.

## September 2026 source cleanup

The previous public `main` at `72c83048dc8fe78d176c814c1f174ddae6ed09de`
already contained generated game outputs. A commit-range audit also found one
intermediate generated `editor/world/ui/skin.json` change in unpublished
development history. That history is not part of the public milestone.
The cleanup removes 683 tracked paths from the current source tree, with no
deletion or alteration of their working files. The local before/after audit
checked every SHA256; 139,260,882 bytes in the current workspace were preserved.

| Removed from the current source tree | Local regeneration or purpose |
| --- | --- |
| `assets/gamedata/` decoded JSON catalogs, `skillmesh.bin`, projector PNG | Original-client data decoders and exporters under `tools/` |
| `editor/characters/` generated manifests, animation/scale catalogs and weapon glTF/buffer/PNG files | Character, armor and weapon build pipelines |
| `editor/world/ui/*.json` | Original UI/font/skin/layout miners |
| Raw `sky_shots`, `ui_color_shots_*`, `ui_geom_shots*`, `audit_report` and `verify_*.json` | Local historical inspection output, not portable fixtures |
| `gateway/test/capture-skills.json`, `road-to-town.json` | Captured session/route data; synthetic test code stays public |
| Generated `tools/anim/*.json`, map references, character-pipeline baselines, scale screenshot and batch-failure receipt | Private source-derived catalogs and local audit output |
| `panel/config-catalog.json`, `config-defaults.json`, `editor/settings.json` | Local configuration snapshots and machine paths |

The removed types are 80 JSON files, 239 PNGs, 181 buffers, 180 glTFs, two raw audit
Markdown reports and one batch receipt. Package manifests/lockfiles, authored
source tests and the evidence documents remain. No original `.uc` script
exports, original client directory, live server checkout or new `tmp/` receipts
were tracked in this audit.

The two authored `tools/audit/*_baseline.json` records stay public: they retain
source-review approvals and aggregate counts needed by those regression
checks. They contain no extracted client payload and do not certify native
fidelity.

This is a current-tree cleanup, **not a history purge**. Prior commits and
existing clones can still contain the earlier outputs. No history was
rewritten, and removal does not transfer or clear third-party rights. The old
claim that the repository had never contained game assets was incorrect.
Any later history cleanup requires its own coordinated migration.

For publication, a separate milestone branch uses the reviewed final source
tree with the existing public `main` commit as its parent. It does not merge
or push the unpublished development branch. The local development history is
preserved separately; the intermediate generated catalog therefore stays
local. Audit the milestone's reachable new blobs before pushing, and build
the Core archive from that publication revision so its manifest is publicly
reproducible. Existing public history is not rewritten by this approach.

## Screenshots and reproducibility

Selected rendered presentation screenshots under `docs/img/` remain, including
the new tool/UI examples the owner requested. Captions must identify replay
versus live play and avoid implying unsupported native fidelity. Original
input images, raw diagnostic dumps, login information and account receipts are
not release attachments. A screenshot is evidence of that displayed result,
not proof that every map, quest or interface works.

The [repository tool catalog](https://github.com/elberacasa/Lineage2Elbera/blob/main/tools/README.md) distinguishes
portable synthetic checks, checks requiring owned originals, and controlled
live tests. Asset-dependent tests cannot certify a clean checkout merely by
skipping missing input. Follow each command's explicit input requirements.

## Separate Elbera Tools download

[Elbera Tools Core](https://github.com/elberacasa/Lineage2Elbera/blob/main/tools/release/CORE-README.md) is a deliberately small
standalone Python source kit from the same repository. Its explicit allowlist
includes l2lib, the UTX editor, script extractor, XDAT decoder and portable
tests. It excludes original data, generated catalogs, server/app code, third-
party binaries, source packages and screenshots. Its builder smoke-tests the
actual archive in an isolated temporary directory, without the browser app or
private files. The full native-verification/conversion collection remains in
the repository with its separate input/dependency requirements.

Do not create a release by archiving an entire working checkout. Use the
allowlisted builder and inspect its manifest. Publication is a separate step;
the builder never uploads, pushes, creates a release or contacts a server.
