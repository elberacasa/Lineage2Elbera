# ELBERA

[![Source checks](https://github.com/elberacasa/Lineage2Elbera/actions/workflows/source-checks.yml/badge.svg)](https://github.com/elberacasa/Lineage2Elbera/actions/workflows/source-checks.yml)

**Lineage II Interlude in the browser — with reusable tools for studying and converting the original client.**

ELBERA is the browser-client project developed in this `l2vzla` repository. The
long-term goal is the full Interlude experience: world, characters, combat,
progression, effects and interface, without a game-client installation for players.

Today it is a working development prototype with connected gameplay and a growing
body of original-client evidence. It is not a finished port or a public game
service. A small, repeatable beginner playtest is the next milestone toward the
full game.

[Current coverage](docs/PORT-COVERAGE.md) ·
[Development plan](docs/WEB-PORT-PLAN.md) ·
[Elbera Tools](tools/README.md) ·
[Public/private boundary](docs/public-release-boundary.md)

## Showcase

These are **offline Elbera Tools inspections**, rendered by the browser client.
They demonstrate inspectable assets and UI behavior; they are not screenshots of
live crafting or proof that every original-client behavior has been reproduced.

| Original face selection | Recipe and shortcut inspection |
| --- | --- |
| ![Elbera Tools player face inspection](docs/img/elbera-tools-faces.png) | ![Elbera Tools recipe and shortcut inspection](docs/img/elbera-tools-recipes.png) |
| Explicit original face indices, with source mesh and texture checks. | Original recipe metadata and browser controls, using clearly labeled replay state. |

![Elbera Tools original hair geometry and color inspection](docs/img/elbera-tools-hair.jpg)

**Original hair inspection:** exact source mesh/color choices, including distinct
alpha rules for the two hair parts. This is a static source view; animated body
attachment and native sampling remain unfinished. [Build and inspection guide](docs/hair-asset-pipeline.md).

With locally generated assets, the [inspection index](editor/world/test/index.html)
provides hair, face and animation viewers, world diagnostics, quest journals, inventory
dialogs, merchants, recipes and other focused tools.

## What works today

Recent work combines ordinary gameplay checks with targeted source verification.
The distinction matters: a connected feature, a recovered rule and a verified
end-to-end scenario are different achievements.

| Area | Current evidence |
| --- | --- |
| Character entry and progression | Ordinary browser creation, selection, entry and reconnect have been exercised. A Dwarf starter character holds its received club and has progressed through normal combat. |
| Quests and navigation | Letters of Love was completed through ordinary server interactions; its reward survived reconnect and appeared in the browser inventory. The journal correctly removes the completed zero-stage entry. [Playtest](docs/quest-completion-playtest.md). |
| Merchant interaction | A real browser purchase and use of a healing potion changed the server-owned inventory and currency. Shared quantity dialogs and selected shop layout rules are traced to original sources. [Playtest](docs/shop-playtest.md). |
| Player appearance | Original face indices reach self and remote actors. Creation choices now use the original sex-specific lists, without invented hair-color tints. All 162 referenced hair meshes and 648 material references have a separate source export; animated hair selection remains unfinished. [Face evidence](docs/native-face-selection-evidence.md) · [Hair pipeline](docs/hair-asset-pipeline.md). |
| Recipes and shortcuts | Recipe books, manufacture details and recipe shortcuts are connected. Opening the live empty Common Craft book is verified; successful recipe learning and crafting remain separate, unverified journeys. [Evidence](docs/native-recipe-evidence.md). |
| World and animation foundations | Source terrain coordinates, selected collision geometry, floor-aware navigation, original animation slots and bounded timing rules have reproducible checks. These establish specific behaviors, not complete map or renderer fidelity. |

Inventory, skills, NPC dialogs, warehouse, trade, private stores, party and basic
clan features also have browser and gateway implementations. See the
[coverage inventory](docs/PORT-COVERAGE.md) for their actual boundaries rather
than treating implementation presence as completion.

## Architecture

```text
Original Interlude inputs (private)
        │
        └── Elbera Tools ──► generated assets and metadata (private)
                                      │ HTTP
                                      ▼
                              Browser client
                           Three.js + DOM interface
                                      │ WebSocket
                                      ▼
                               Node.js gateway
                                      │ L2 TCP protocol
                                      ▼
                           aCis emulator + database
```

The browser renders the world and sends player intentions. The gateway translates
between browser messages and the configured Interlude server protocol. The server
owns gameplay results, inventory and progression. Asset conversion runs separately
from play.

The current server target is **aCis**, an emulator with local configuration and
changes. It is not the original NCSoft server and is not an authority for original
client presentation. Original packages, scripts, data tables and retained native
instructions are used to establish client rules. Tests against aCis establish
interoperability with that configured server.

## Elbera Tools

The research and conversion tools are useful separately from the browser game.
They preserve source identities, record the inputs behind a result and expose
unsupported cases instead of silently choosing replacements.

| Start here | Purpose |
| --- | --- |
| [Tool catalog](tools/README.md) | Commands, prerequisites, evidence links and known limits. |
| [l2lib](tools/l2lib/README.md) | Unreal Engine 2 package, DAT and texture readers used by the pipelines. |
| [World tools](tools/world/) | Terrain conversion, source collision exports, qualified prop checks and navigation inspection. |
| [Data and animation tools](tools/dat/) · [animation tools](tools/anim/) | Source metadata, appearance, model identity and original sequence recovery. |
| [Original hair pipeline](docs/hair-asset-pipeline.md) | Raw LOD0 meshes, unmodified skin weights, original material graphs and source/built geometry comparisons. |
| [UI and native checks](tools/ui/) | Reproducible evidence for layouts, packet fields, dialogs, animation rules and other bounded client behavior. |
| [Playtest client](tools/playtest/README.md) | Controlled journeys and private receipts using an explicitly selected existing character; includes read-only catalog queries. |

[Elbera Tools Core](tools/release/CORE-README.md) is the separate, source-only
Python subset: package/texture readers, the texture editor, ScriptText extraction
and XDAT decoding. It uses an explicit file allowlist and isolated checks; it does
not package the browser game or original client content.

[Download Core 0.1.0 (prerelease)](https://github.com/elberacasa/Lineage2Elbera/releases/tag/elbera-tools-core-v0.1.0),
or build the archive locally:

```sh
python3 tools/release/build_core.py --version 0.1.0 --output tmp/releases/elbera-tools-core-0.1.0.zip
```

Original-data operations require your own matching inputs, and some encrypted
formats need a separately built decoder. The [Core guide](tools/release/CORE-README.md)
and [release boundary](docs/public-release-boundary.md) define the supported scope.

## Getting started

### Read and test the public source

Use a current Node.js release and Python 3. The gateway dependencies are installed
from its lockfile. These examples run focused automated checks without logging
into a game server:

```sh
npm ci --prefix gateway
node --test gateway/test/*.test.js
node --test editor/world/test/geodata.test.mjs editor/world/test/net-lifecycle.test.mjs
```

Browse the test inventory with `bash tools/battery.sh --list`. Inventory listing is
not a full test run. Some suites require original files, generated outputs or a
live server; use the [tool catalog](tools/README.md) to choose the appropriate
check. A skipped original-data check is not evidence of source compatibility.

GitHub's **Source checks** workflow runs portable protocol/lifecycle fixtures and
builds the Core toolkit in isolation. It requires no client assets or game server;
its green status does not certify native rendering or live gameplay.

### Run a private development instance

The public source alone does **not** contain everything needed to render or host
the game. You need your own matching Interlude inputs, locally generated assets
and metadata, and a separately configured emulator/database for Online play.
Native checks may require additional Python packages and converter binaries; each
tool documents its prerequisites.

Once those inputs and the login/game servers are ready, run these in separate
terminals from the repository root:

```sh
# Protocol gateway — defaults to localhost login server on port 2106
npm start --prefix gateway

# Browser client and offline inspection pages — port 8083
python3 editor/world/server.py
```

Open `http://127.0.0.1:8083/` for the world, `/create/` for character creation,
or `/test/index.html` for Elbera Tools. Offline inspection does not establish an
Online session. Some tools use simulated state and label it accordingly.

See the [gateway contract](gateway/README.md) for connection settings and protocol
operations. Existing [deployment scripts](deploy/) depend on private server/build
inputs; they are development helpers, not a production hosting guarantee. Keep
identities, credentials, databases and playtest receipts outside tracked files.

## Known limitations

- **World fidelity:** camera collision, native BSP sweeps, lighting, materials and
  map transitions remain incomplete. Exported or rendered maps are not the same
  as verified playable routes.
- **Characters and effects:** face selection has bounded source checks; hair
  selection, full skinning/material parity, effect placement and some animation
  and sound paths remain unfinished.
- **Interface and gameplay:** the browser includes approximations and incomplete
  flows. Native actor gauges, macros, pets, advanced clan systems, siege,
  Olympiad, fishing and other systems still need substantial work.
- **Progression coverage:** a verified beginner journey does not establish all
  classes, quests, crafting outcomes, multiplayer interactions or restart
  persistence. Offline replay never proves a server result.
- **Operations:** broad performance, long-session recovery, capacity and public
  hosting are not certified. The current milestone is a controlled private test.

The [coverage inventory](docs/PORT-COVERAGE.md) records specific remaining work and
links to source evidence. Unknown native behavior remains explicit; a plausible
visual substitute is not considered a faithful implementation.

## Roadmap

1. **Trustworthy foundations:** close world-coordinate, collision, camera,
   appearance and animation gaps with reproducible source checks.
2. **Repeatable beginner journey:** validate creation, movement, combat, quests,
   loot, equipment, shops, death, reconnect and persistence through normal play.
3. **Small private playtest:** document clean setup and recovery, exercise multiple
   browsers, and measure performance and failure handling.
4. **Full Interlude coverage:** extend those standards across classes, maps,
   progression, effects, dialogs and remaining game systems.

The [working plan](docs/WEB-PORT-PLAN.md) defines acceptance criteria. There is no
release-date promise or completion percentage derived from asset/test counts.

## Repository map

```text
editor/world/       Browser world, UI, pure runtime helpers and inspections
editor/charcreate/  Character creator and preview
editor/characters/ Local generated character models and manifests
gateway/           WebSocket ↔ Interlude protocol bridge and packet tests
tools/             Elbera Tools: readers, exporters, verifiers and playtests
panel/             Development configuration interface
deploy/            Local deployment helpers
docs/              Coverage, plans, evidence, playtests and curated screenshots
assets/            Local original inputs and generated data
```

## Contributing

A useful change identifies the original input/build, states the behavior being
ported and adds a focused way to reproduce the result. Keep protocol tests,
original-source checks, offline previews and live gameplay receipts distinct.
Record unresolved behavior instead of widening a passing claim.

Do not submit original client files, generated game assets, decompiled source,
credentials, databases or private account logs. See the
[public/private boundary](docs/public-release-boundary.md) before packaging or
publishing. Older repository history contains legacy generated outputs; the
current source-only boundary does not remove that history.

## License and attribution

ELBERA's own code is covered by the [MIT license](LICENSE), subject to the scope
and third-party notices there. Dependencies and external projects retain their
own licenses. Lineage II and its original client content belong to their
respective owners; this project's license does not grant rights to that content.

This is an independent fan and research project, not an NCSoft product or an
endorsed service. Curated screenshots illustrate development and inspection
results; they do not constitute a redistributable game-asset package.

## En español

ELBERA busca llevar Lineage II Interlude completo al navegador. Hoy es un
prototipo en desarrollo, con recorridos reales de juego comprobados y herramientas
para investigar los datos originales. Aún faltan sistemas y detalles de fidelidad;
una vista previa no demuestra que una función esté terminada.

El código y Elbera Tools se comparten por separado de los archivos originales,
los recursos generados y los datos privados del servidor. Consulta la
[cobertura actual](docs/PORT-COVERAGE.md), el [plan](docs/WEB-PORT-PLAN.md) y el
[catálogo de herramientas](tools/README.md) para empezar.
