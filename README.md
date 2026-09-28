<div align="center">

# E L B E R A

### Lineage II Interlude. In your browser.

**Porting the original game-client experience to the web.**<br>
A browser client, an Interlude protocol gateway, and Elbera Tools for the L2 community.

[![Source checks](https://github.com/elberacasa/Lineage2Elbera/actions/workflows/source-checks.yml/badge.svg)](https://github.com/elberacasa/Lineage2Elbera/actions/workflows/source-checks.yml)
[![Elbera Tools Core](https://img.shields.io/badge/Elbera_Tools_Core-v0.1.0_prerelease-b49a61?style=flat-square)](https://github.com/elberacasa/Lineage2Elbera/releases/tag/elbera-tools-core-v0.1.0)
[![Elbera Tools NPC Source](https://img.shields.io/badge/NPC_Source-v0.1.0_prerelease-b49a61?style=flat-square)](https://github.com/elberacasa/Lineage2Elbera/releases/tag/elbera-tools-npc-source-v0.1.0)
[![License: MIT](https://img.shields.io/badge/Code-MIT-506b83?style=flat-square)](LICENSE)

[The game](#the-game) · [Elbera Tools](#elbera-tools) · [Recent progress](#recent-progress) · [Get started](#get-started) · [Roadmap](#roadmap) · [Español](#en-español)

</div>

![ELBERA browser client: an equipped character in Giran with inventory, status, skills and action windows](docs/img/hero-armor-shield-giran.jpg)

<p align="center"><em>From the project's development gallery: Giran, equipped armor and shield, and the browser interface in one frame.</em><br>
<a href="docs/SHOWCASE.md">Explore the game gallery</a> · <a href="docs/img/README.md">Capture history and context</a></p>

## The game

ELBERA brings Lineage II Interlude to the web: its world, characters, skills,
animations, effects, progression and interface, with no installed game client
for players. This repository, developed locally as `l2vzla`, contains the
browser client and the tools being built to make that possible.

The browser already connects through **ElberaGate** to an aCis server for
movement, combat, inventory, NPC interaction and other gameplay systems.
Recent checks include a completed quest with its reward preserved after
reconnect, an actual merchant purchase, and original appearance and UI data
recovered from the client.

**Status: active development.** The next delivery is a small invited playtest;
the goal remains the full Interlude client. World fidelity, animation, effects,
interface details and whole gameplay systems still need work. The
[coverage inventory](docs/PORT-COVERAGE.md) records what is implemented,
source-verified and tested through normal play.

| Talking Island | Giran |
| --- | --- |
| ![Talking Island shoreline and stone terrace in the browser](docs/img/world-talking-island.jpg) | ![Giran's plaza and architecture rendered in the browser](docs/img/world-giran.jpg) |
| Coastal terrain, water and map geometry. | Town architecture, stonework and public spaces. |

*These retained game captures show earlier development builds. New tool captures
appear below; current feature status is recorded in the coverage inventory.
The [full gallery](docs/SHOWCASE.md) also preserves character creation, combat,
multiplayer, NPCs, dungeons and interface views.*

## Recent progress

**September 2026** — work now follows original inputs through decoding,
browser behavior and focused verification.

| Area | What advanced | Follow the work |
| --- | --- | --- |
| **Character appearance** | Original face indices, five male / seven female creation hairstyles, four source color choices, and corrected default hair mesh/material selection. | [Appearance](docs/native-face-selection-evidence.md) · [Hair pipeline](docs/hair-asset-pipeline.md) |
| **Hair and material inspection** | All **162** base-table meshes exported with original LOD0 geometry and weights; **648** material references retain their source identities. The inspector shows rigid and soft-rig parts in a static view. | [Inspecting original hair](docs/hair-asset-pipeline.md#browser-inspection) |
| **Native transform research** | Ordinary and dynamic hair paths distinguished; retained coordinate arithmetic checked. A separately pinned comparison copy identifies missing imports within exactly matched code blocks. | [Attachment evidence](docs/native-hair-attachment-evidence.md) · [Comparison scope](docs/supplemental-engine-evidence.md) |
| **Original animation and skeletons** | All **1,367** player sequences and **14** original face skeletons have lossless runtime bundles. Live wait, sit, stand and cast schedules use original keys, fresh-instance initialization and transitions from evaluated source poses. | [Live playback guide](docs/original-animation-runtime.md) · [Cache evidence](docs/native-pose-cache-evidence.md) · [Fresh instances](docs/native-pose-allocation-evidence.md) |
| **NPC animation recovery** | All **16** original Gremlin and Fox sequences and **34 events** are inspectable. A bounded live path plays their initial Wait/AtkWait from original keys and sound events on Talking Island, including starter Gremlin **18342**. Normal Online entry now waits for the correct map and verified model; no manual map selection is needed. Unported transitions retire that path. Original GPU weight lanes are preserved for **1,746 vertices**; complete skinning, movement and combat animation remain unfinished. | [NPC source inspector](docs/original-npc-animation-runtime.md) · [Skin input evidence](docs/native-npc-skin-evidence.md) · [Native state evidence](docs/native-npc-animation-evidence.md) |
| **Original BSP collision** | A composed world BSP extent sweep now includes oriented hulls, bevels and original hit adjustment. Its Elbera inspector uses the same module with portable fixtures or local source exports; camera and walking integration remain unfinished. | [Sweep evidence](docs/native-camera-evidence.md#world-bsp-extent-sweep) · [Level.Model source binding](docs/bsp-collision-source.md) |
| **Terrain, actors and level queries** | BSP, terrain and zone lookup now join through the original level collection rules. **116 diagnostic queries across Talking Island and Giran** match retained client instructions with explicit saved-state conditions. Original actor-cylinder arithmetic is also available; live actor participation and gameplay collision remain unfinished. | [Combined sweeps](docs/native-level-sweep-adapters-evidence.md) · [Terrain-zone sources](docs/native-terrain-zone-inputs.md) · [Cylinders](docs/native-cylinder-collision-evidence.md) |
| **Static actor transforms** | Original actor matrices match **1,400 retained-code cases**. Elbera Tools recovers the **16,384-entry** rotation table under an explicit source SSE2 profile. Current actor/cache and live movement integration remain unfinished. | [Transforms and table recovery](docs/native-actor-transforms-evidence.md) |
| **Static sweep preparation** | **800 original-instruction comparisons** preserve source corner rounding and exact-zero direction handling. Original collision records round-trip byte for byte across two map packages. | [Collision records and source preparation](docs/native-static-sweep-evidence.md) |
| **Static triangle collision** | **5,200 browser comparisons** preserve original mesh-cache values, plane construction, negative-scale winding and triangle clipping; **500** compose the stages. | [Triangle source checks](docs/native-static-triangle-evidence.md) |
| **Static mesh traversal and hits** | **2,600 browser comparisons**, including **400 joined collision cases**, preserve original traversal order, repeated-triangle tags, material response handling and final hit adjustment. Live cache/actor integration and walking remain unfinished. | [Mesh source checks](docs/native-static-mesh-evidence.md) |
| **Movement recovery** | Original actor blocking and ordered hit selection match **6,600 retained-code cases**. Query padding and selected-hit backoff match another **735 cases**. Live actor queries, callbacks, floor/step/ledge response and movement-to-wait animation remain in progress. | [Actor blocking](docs/native-actor-blocking-evidence.md) · [Movement arithmetic](docs/native-moveactor-arithmetic-evidence.md) · [Stopping evidence](docs/native-grounding-evidence.md#stopmove-retire-a-canceled-route-without-inventing-a-teleport) |
| **Original sound selection** | Recovered the original integer generator and signed sound gate. Player and admitted NPC events share one browser context, preserving draw order through mute and delayed loading. Browser seed/storage policy and unported native consumers remain explicit limits. | [Native sound evidence and verifier](docs/native-cast-sound-evidence.md#sound-notify-integer-rng-and-seed-boundary) |
| **Quest progression** | *Letters of Love* completed through server interactions; the reward survived reconnect and appeared in the browser inventory. | [Quest playtest](docs/quest-completion-playtest.md) |
| **Shops and original dialogs** | A browser purchase and potion use changed server-owned inventory and currency. Quantity and confirmation dialogs use recovered client rules. | [Shop playtest](docs/shop-playtest.md) |
| **Recipes and shortcuts** | Recipe books, manufacture details and source-index shortcuts are connected; the live empty Common Craft book was checked. Successful crafting remains a separate test. | [Recipe evidence](docs/native-recipe-evidence.md) |
| **Community tooling** | Separate Core and NPC Source kits, portable checks, source provenance, updated guides and actual inspection screenshots. | [Core](https://github.com/elberacasa/Lineage2Elbera/releases/tag/elbera-tools-core-v0.1.0) · [NPC Source](https://github.com/elberacasa/Lineage2Elbera/releases/tag/elbera-tools-npc-source-v0.1.0) · [Tool catalog](tools/README.md) |

The latest appearance milestone is [PR #5](https://github.com/elberacasa/Lineage2Elbera/pull/5).
The newest animation comparison includes male Human Fighter's **69 matched
bones plus one original reference pose**, without inventing a finger alias.
The same source-pose path now drives admitted frames and cached transitions in
the live Character player. Fresh instances follow the recovered original
frame-zero path. After an exported-only animation interrupts source playback,
transition history remains unknown. Existing browser skinning and hair
adaptations remain in use; actor modifiers and animated hair attachment are
still unfinished.
[See what runs today and how to reproduce it](docs/original-animation-runtime.md).

## Elbera Tools

**Built for the port. Useful to the community.**

Read packages, decode original tables and textures, inspect models and UI,
and reproduce the evidence behind a conversion. Each tool documents its inputs,
supported scope and unresolved cases.

| Original faces | Recipes and shortcuts |
| --- | --- |
| ![Elbera Tools face inspector showing the original mesh and texture references](docs/img/elbera-tools-faces.png) | ![Elbera Tools recipe inspector with manufacture details and shortcut drawers](docs/img/elbera-tools-recipes.png) |
| Inspect source face indices through the browser's character loader. | Exercise the actual recipe windows with explicitly supplied replay state. |
| **Hair geometry and colors** | **Soft-rig source inspection** |
| ![Elbera Tools original hair inspector with separate source material states](docs/img/elbera-tools-hair.jpg) | ![Elbera Tools Dark Elf hair inspection showing a separate soft-rig part](docs/img/elbera-tools-hair-soft.jpg) |
| Browse original mesh/color choices and material alpha rules. | Examine original bones and weights; this view is static. |

*Direct browser captures, September 26–27, 2026. These tools run offline;
recipe fixtures do not grant items, and a static asset view does not verify
animation. [Capture details](docs/img/README.md).*

<details>
<summary><strong>New: original BSP collision inspector</strong></summary>

![Elbera Tools BSP inspector showing a blocked synthetic extent sweep, candidate bounds and the adjusted hit](docs/img/elbera-tools-bsp-sweep.jpg)

Inspect the original collision component independently of rendered geometry.
The page displays explicit query inputs, traversed nodes, tested hulls and an
adjusted hit; changing an input clears stale results. The pictured fixture is
synthetic and needs no client assets. Local original exports can be inspected
without uploading them. Terrain, actors and native movement response remain
outside this world BSP component.
[Source evidence and reproduction](docs/native-camera-evidence.md#world-bsp-extent-sweep)
· [Standalone inspector guide](tools/release/BSP-README.md).

</details>

<details>
<summary><strong>New: original animation and source-skeleton preview</strong></summary>

<p align="center">
  <img src="docs/img/elbera-tools-source-hierarchy.jpg" width="600" alt="Elbera Tools Human Fighter animation preview with 69 original links and one reference bone">
</p>

Human Fighter's original missing-bone behavior is now visible in the inspector,
with recovered parent transforms and a comparison against the existing export.
This is a neutral source-pose view, with full gameplay animation still in progress.
[Reproduce this view](docs/native-track-evidence.md#browser-pose-preview).

</details>

<details>
<summary><strong>Live Character playback: original wait and cast poses</strong></summary>

<p align="center">
  <img src="docs/img/elbera-tools-live-animation.jpg" width="600" alt="Elbera Tools live Character replay showing original Human Fighter waiting with 69 mapped bones and one reference bone">
</p>

The sit/stand replay reaches original waiting through the game's Character
player. The visible status reports the original sequence and normalized frame;
the current inspector also retains the last evaluated cached transition.
Unobserved playback history and other native animation paths remain unfinished.
[Reproduce this view and read the playback limits](docs/original-animation-runtime.md).

</details>

<details>
<summary><strong>New: inspect original cached transitions</strong></summary>

![Elbera Tools live Character inspector retaining the last original cached transition into Human Fighter waiting](docs/img/elbera-tools-cached-transition.jpg)

The latest replay shows both the current original pose and the last evaluated
transition, including its exact negative frame and incremental fraction.
Fresh-frame initialization and known source history are checked separately;
unresolved audio references stay visible. This is an offline inspection of
the gameplay component, with existing browser skinning and inspection lighting.
[Trace the cache and initialization evidence](docs/native-pose-cache-evidence.md).

</details>

<details>
<summary><strong>New: original NPC tracks, frame by frame</strong></summary>

![Elbera Tools Gremlin source-track inspector showing original combat-wait keys, preserved GPU weight lanes and rendering limits](docs/img/elbera-tools-npc-source.jpg)

Inspect every recovered Gremlin and Young Fox sequence, play its source timeline,
scrub normalized frames and restore the converted model. The tool keeps original
class and animation identities visible. Expand **Original notifies** to inspect
each sequence's ordered events and raw sound fields. Gremlin and Fox retain every stored
GPU weight lane through import, including repeated bones. Native shader math,
inverse binds, effects and gameplay state transitions still need integration.
[Reproduce the view and its source checks](docs/original-npc-animation-runtime.md).

</details>

<details>
<summary><strong>Live NPC playback: original waiting and sound events</strong></summary>

![Elbera Tools online NPC event inspector showing starter Gremlin 18342 playing an original Wait and a retired movement transition](docs/img/elbera-tools-live-npc-events.jpg)

Real server NPCs now reach a bounded original waiting path. The inspector shows
the current source frame, dispatched events and sound-gate results; it also
preserves the last observation when an unsupported transition retires playback.
This capture is from Talking Island, with **Online** enabled. Walking, combat,
full rendering and native random-history parity remain unfinished.
[Reproduce the live check](docs/original-npc-animation-runtime.md#live-world-check).

</details>

### Download the standalone toolkits

Two source-only prereleases run independently of the browser project. Each ZIP
has an explicit file manifest and portable checks; neither contains game assets.

| Toolkit | Included | Start here |
| --- | --- | --- |
| **[Core 0.1.0](https://github.com/elberacasa/Lineage2Elbera/releases/tag/elbera-tools-core-v0.1.0)** | Python package/texture library, UTX editor, embedded-script extractor and XDAT decoder. | [Core guide](tools/release/CORE-README.md) |
| **[NPC Source 0.1.0](https://github.com/elberacasa/Lineage2Elbera/releases/tag/elbera-tools-npc-source-v0.1.0)** | Qualified NPC selectors, original sparse-key bundles, optional GPU weights, and the bounded initial-animation/GPU evidence checks. | [NPC Source guide](tools/release/NPC-SOURCE-README.md) |

NPC Source includes 43 text files and a hash manifest. Its portable checks need
only Python; the optional native-analysis checks require pinned Capstone and
your own matching client inputs. Runtime bundle export also requires your
matching converted model data. It supplies inspection data; the graphical
inspectors shown above remain part of the full repository.

Core 0.1.0 retains its original contents. Each kit documents its supported
commands and limits; neither includes every tool in the repository.

[Complete tool catalog](tools/README.md) ·
[Reproduce Core](tools/release/CORE-README.md#reproduce-a-source-release) ·
[Reproduce NPC Source](tools/release/NPC-SOURCE-README.md#reproduce-the-archive)

### The ELBERA toolchain

The project's component names remain mapped to the existing source structure.

| Component | Role | Source |
| --- | --- | --- |
| **ElberaClient** | World rendering, gameplay interface and browser inspections | [Browser client](editor/world/) |
| **ElberaCreate** | Character creation and preview | [Character creator](editor/charcreate/) |
| **ElberaGate** | WebSocket ↔ Interlude login/game protocol | [Gateway and contract](gateway/README.md) |
| **ElberaLib** | Supported package, DAT and texture readers | [Format library](tools/l2lib/README.md) |
| **ElberaWorld** | Terrain, BSP, props and navigation tooling | [World pipeline](tools/world/) |
| **ElberaModeler** | Character, equipment and model conversion | [Character pipeline](tools/src/char_pipeline/) |
| **ElberaDat** | Original table decoding and metadata exports | [Data tools](tools/dat/) |
| **ElberaForge** | Supported UTX texture inspection and replacement | [Texture editor guide](tools/utx/README.md) |
| **ElberaSkin** | Original interface records, art and browser controls | [XDAT tools](tools/xdat/) · [UI tools](tools/ui/) |
| **ElberaPanel** | Local server configuration interface | [Panel](panel/) |
| **ElberaEdge / ElberaDeploy** | Existing proxy and development deployment helpers | [Deployment](deploy/) |

Animation, sound, effects, native evidence and playtest tools are indexed in the
[full catalog](tools/README.md). Original-data commands require locally supplied
inputs; deployment helpers still depend on a configured private server.

## How it fits together

```mermaid
flowchart TB
    subgraph Build["Asset preparation · offline"]
        direction LR
        Original["Original Interlude files<br/>private inputs"] --> Tools["Elbera Tools"]
        Tools --> Assets["Web assets and metadata<br/>generated locally"]
    end
    subgraph Play["Game session"]
        direction LR
        Client["ElberaClient<br/>Three.js + DOM interface"]
        Gateway["ElberaGate<br/>Node.js"]
        Server["aCis server + database"]
        Client <-->|WebSocket| Gateway
        Gateway <-->|Interlude TCP protocol| Server
    end
    Build -->|Web assets over HTTP| Play
```

The browser renders the game and sends player intentions. The server owns
gameplay outcomes, inventory and progression; the gateway connects the two.
Asset conversion is separate from the running game.

**Original data is the rule.** Geometry, values, UI behavior and animation rules
must be decoded, extracted or traced to their original Interlude sources.
Unknowns remain explicit. aCis is the current interoperability target, with local
configuration and changes; it is not the original NCSoft server or an authority
for original client presentation.

<details>
<summary><strong>Inside the engineering: protocol, formats, UI and rendering</strong></summary>

- **Protocol bridge.** Browsers use WebSockets; Interlude uses its login and game
  TCP protocols. The gateway handles those sessions and exposes the browser
  contract. [Protocol documentation](gateway/README.md).
- **Format recovery.** Package boundaries, compressed records, material chains
  and texture formats are decoded into inspectable data.
  [Format library](tools/l2lib/README.md) · [DAT notes](docs/dat-format-notes.md).
- **Interface recovery.** XDAT records, original scripts, textures and retained
  native instructions establish window geometry and behavior.
  [Layout evidence](docs/native-layout-evidence.md).
- **Rendering checks.** Original mesh/material identities, coordinate arithmetic
  and actual converted geometry are compared separately. A screenshot is one
  observation, not a substitute for those checks.
  [Player transforms](docs/player-transform-audit.md) ·
  [Original pose preview](docs/native-track-evidence.md#browser-pose-preview) ·
  [Reference fallback](docs/native-pose-fallback-evidence.md) ·
  [Hair pipeline](docs/hair-asset-pipeline.md).

</details>

## Get started

### Explore the public source

Node.js and Python 3 are used throughout the project. The public checks below
need no game server or original client assets:

```sh
npm ci --prefix gateway
node --test gateway/test/*.test.js
node --test editor/world/test/geodata.test.mjs editor/world/test/net-lifecycle.test.mjs
```

List the broader test inventory with `bash tools/battery.sh --list`.
Individual source and live-server suites have additional prerequisites.
The **Source checks** badge covers the portable workflow; it is not a full
gameplay or visual certification.

### Run a local development instance

Rendering requires your own matching Interlude inputs and locally generated
assets. Online play also requires the configured login/game servers and database.
The public checkout does not bundle those inputs.

With those prepared, run each service in its own terminal:

```sh
# Protocol gateway
npm start --prefix gateway

# Browser client, character creator and Elbera Tools pages
python3 editor/world/server.py
```

Open **http://127.0.0.1:8083/** and select **Online** in the top-left corner
to connect to the game. Use **/create/** for character creation and
**/test/index.html** for the Elbera Tools inspection hub.

[Gateway setup](gateway/README.md) · [Tool prerequisites](tools/README.md) ·
[Private-input boundary](docs/public-release-boundary.md)

## Roadmap

| Stage | Next acceptance target |
| --- | --- |
| **World and character fidelity** | Verified terrain, floors, collision, camera, materials, equipment, animation and effect placement. |
| **Repeatable beginner journey** | Creation → movement → combat → quest → loot/equip → shop → death/respawn, with reconnect and persistence checked through normal play. |
| **Small invited test server** | Reproducible setup and recovery, multiple browsers, measured performance and session failure handling. |
| **Full Interlude client** | Remaining regions, classes, skills/effects/audio, progression, crafting, pets, social systems, fishing, transport, siege and every original dialog/menu. |

A test server is a milestone within the full port. The
[development plan](docs/WEB-PORT-PLAN.md) defines the acceptance gates.

<details>
<summary><strong>Current gaps and verification boundaries</strong></summary>

World collision and transitions, native lighting/materials, animated appearance,
effect placement, some animation/audio paths and interface details are incomplete.
Pets, macros, advanced clan systems, siege, Olympiad, fishing and other systems
still need substantial work. Long-session stability, capacity and public hosting
also require measurement.

A working quest or shop scenario does not establish every class, quest, crafting
outcome or multiplayer interaction. Read the
[full coverage inventory](docs/PORT-COVERAGE.md) for feature-specific evidence
and remaining tasks.

</details>

## Documentation and contributing

| Looking for | Start here |
| --- | --- |
| Current behavior and gaps | [Coverage inventory](docs/PORT-COVERAGE.md) |
| Delivery order and acceptance | [Development plan](docs/WEB-PORT-PLAN.md) |
| Commands and reusable tools | [Elbera Tools catalog](tools/README.md) |
| Character and world conversion | [Characters](docs/character-pipeline.md) · [Monsters](docs/monster-pipeline.md) · [Weapons](docs/weapon-pipeline.md) · [Map format](docs/map-format.md) |
| UI, animation and native investigations | [Evidence documents](docs/) |
| Development images | [Game gallery](docs/SHOWCASE.md) · [Capture provenance](docs/img/README.md) |
| Packaging and publication | [Public/private boundary](docs/public-release-boundary.md) |

A useful contribution identifies its source/build, explains the behavior changed,
and provides a focused way to reproduce the result. Keep portable tests, original
source checks, offline inspections and live gameplay results distinguishable.

Original client files, generated assets, decompiled source, credentials, databases
and private playtest receipts stay out of public changes. Earlier repository
history contains legacy generated outputs; the current source boundary does not
erase that history.

<details>
<summary><strong>Repository map</strong></summary>

```text
editor/world/       Browser world, UI and inspection pages
editor/charcreate/  Character creator
editor/characters/ Local generated character models
gateway/           Interlude protocol bridge
tools/             Elbera Tools and verification utilities
panel/             Local configuration interface
deploy/            Development deployment helpers
docs/              Guides, evidence, playtests and screenshots
assets/            Local original inputs and generated data
```

</details>

## License and attribution

The project's own code is covered by the [MIT license](LICENSE), subject to its
scope and third-party notices. External components retain their own licenses.
Lineage II and its original content belong to their respective owners; the source
license does not grant rights to game content.

ELBERA is an independent fan and research project, unaffiliated with NCSoft.

## En español

**Lineage II Interlude completo, desde el navegador.** ELBERA reúne el cliente web,
el puente de protocolo ElberaGate y las herramientas de la comunidad **Elbera
Tools**. El trabajo parte de los archivos y comportamientos originales: se
descifran, se decodifican y se verifican; los datos desconocidos no se inventan.

Ya hay recorridos de juego comprobados, nuevas herramientas de inspección y
descargas independientes de Elbera Tools Core y NPC Source. El próximo hito es un
servidor de pruebas pequeño; la meta sigue siendo portar el cliente completo,
con sus mapas, habilidades, animaciones, efectos, progresión e interfaz.

[Estado actual](docs/PORT-COVERAGE.md) · [Plan](docs/WEB-PORT-PLAN.md) ·
[Herramientas](tools/README.md) ·
[Descargar Core](https://github.com/elberacasa/Lineage2Elbera/releases/tag/elbera-tools-core-v0.1.0) ·
[Descargar NPC Source](https://github.com/elberacasa/Lineage2Elbera/releases/tag/elbera-tools-npc-source-v0.1.0)
