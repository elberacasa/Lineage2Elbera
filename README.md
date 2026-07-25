# E L B E R A

**Lineage 2 Interlude, rebuilt for the browser.**

A full web-port ecosystem: the retail Interlude client data reverse-engineered
with our own toolchain, converted to web-native formats, and played through a
real aCis server over a WebSocket protocol gateway. The game itself is not
reimplemented — the browser is a renderer and input device for a server that
already works.

> Working name during development: **L2Vzla**. Internal paths, logs and older
> documents still use it; the product and its toolchain are Elbera.

---

## Status at a glance

| Area | State | Proof |
|---|---|---|
| Walkable 3D world in the browser | Working | 100 map tiles converted, `http://127.0.0.1:8083` |
| Character & creature models | Working | 42 glTF models (14 races + 25 monsters + 3 NPCs), all validated and render-verified |
| Real L2 protocol gateway | Working | Full login + game handshake against live aCis; `gateway/test/verify-one.js` PASS |
| Multiplayer | Working | Two clients see each other, move, chat (`verify-two.js`) |
| Combat | Working | Target, attack, damage, death, exp — live against the server (`verify-combat.js`, `verify-observer.js`) |
| Game server | Working | aCis rev 409 + custom mods (offline shops, `.menu`, autoloot), OpenJDK 21 |
| One-command deploy | Working | `deploy/docker-compose.yml` — MariaDB + login + game (verified 2026-07-23) |

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                                BROWSER                                 │
│                                                                        │
│   ElberaClient :8083        ElberaCreate :8082      ElberaPanel :8080  │
│   walkable 3D world         character creator       server config UI   │
│   (three.js + glTF)         (three.js + glTF)       ElberaAssets :8081 │
│                                                     texture browser    │
└──────┬───────────────────────────────────────┬─────────────────────────┘
       │ HTTP: scene.json, glTF, PNG            │ WebSocket JSON :8090
       ▼                                        ▼
 assets/world · editor/characters        ElberaGate (Node.js)
 generated offline by the toolchain      L2 protocol codec — no game logic
       ▲                                        │ TCP · RSA · Blowfish · XOR
       │                                        ▼
 THE ELBERA TOOLCHAIN                   aCis rev 409 (OpenJDK 21)
 ElberaLib · ElberaForge ·              login :2106 · game :7777
 ElberaModeler · ElberaWorld ·          MariaDB :3306 (db l2jdb)
 ElberaDat · ElberaUpscaler ·                ▲
 ElberaView                                  │ docker compose
       ▲                                ElberaDeploy (deploy/)
       │ reads
 assets/interlude — complete retail Interlude client data
 (157 .unr maps · 132 encrypted .dat · textures · animations · meshes)
```

The strategic decision that shapes everything: **do not reimplement the
game.** aCis runs the world — spawns, combat, skills, inventory, clans, the
custom mods. The gateway is a dumb pipe plus a codec; aCis cannot tell it
from a retail client. The heavy asset conversion happens offline; the
runtime only consumes web-native formats (glTF, PNG, JSON).

---

## Quickstart — the full stack

Requires: macOS arm64, python3.9, node, OpenJDK 21
(`/opt/homebrew/opt/openjdk@21`), MariaDB (`brew services`), Google Chrome
(only for the headless verification scripts).

```bash
# 0. Database (once): brew install mariadb, create db l2jdb + user l2j
#    (credentials in db-credentials.txt), install server/aCis_gameserver/build/dist/sql/
brew services start mariadb

# 1. aCis servers (login first, then game)
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export PATH="$JAVA_HOME/bin:$PATH"
cd server/aCis_gameserver/build/dist/login      && ./startLoginServer.sh &
cd ../gameserver                                 && ./startGameServer.sh &

# 2. Protocol gateway (ws://0.0.0.0:8090)
cd gateway && npm install && npm start &

# 3. Web apps (dependency-free Python, from the repo root)
python3 panel/server.py &                 # ElberaPanel  :8080
python3 editor/server.py &                # ElberaAssets :8081
python3 editor/charcreate/server.py &     # ElberaCreate :8082
python3 editor/world/server.py &          # ElberaClient :8083
```

Open **http://127.0.0.1:8083** — click around Talking Island village in
solo mode, or toggle **Online** to enter the live world through the gateway
(account and character are auto-created from a browser `deviceId`; no login
screen).

One-command server stack (alternative to steps 0–1, needs Docker Desktop
and the built `dist/` tree):

```bash
cd deploy && docker compose up -d --build    # MariaDB + login + game
```

Health check, end to end:

```bash
cd gateway && node test/verify-one.js     # login -> enterWorld -> NPCs -> move -> chat
```

---

## The Elbera toolchain

Every tool below was built in this project. Native foundation binaries
(`tools/bin/umodel`, `tools/bin/l2encdec`) are arm64 ports of UEViewer and
open-l2encdec — third-party code we patched and vendored, built once with
`tools/build-tools.sh`; everything layered on top is ours.

| Tool | Location | One-line pitch |
|---|---|---|
| **ElberaLib** | `tools/l2lib/` | The canonical stdlib-only Python library for every Interlude file format |
| **ElberaForge** | `tools/utx/utxedit.py` | Rewrites textures inside encrypted `.utx` packages — the "repack" gap, closed |
| **ElberaView** | `tools/bin/umodel-view` + `tools/src/ground_truth/` | Headless ground-truth renderer: what the retail data actually looks like |
| **ElberaModeler** | `tools/src/char_pipeline/` | `.ukx` skeletal meshes + animations → web glTF (characters, monsters, NPCs) |
| **ElberaWorld** | `tools/world/` | `.unr` map tiles → self-contained web scenes (`scene.json` contract) |
| **ElberaUpscaler** | `tools/upscale/` | Real-ESRGAN 4x HD pipeline for the hand-painted 2004 textures |
| **ElberaDat** | `tools/dat/` | Decoders for the encrypted `.dat` game-data tables |
| **ElberaPanel** | `panel/` (:8080) | Web config UI for the aCis `.properties`, with catalog, defaults and backups |
| **ElberaAssets** | `editor/` (:8081) | Interactive browser/viewer for the client's texture packages |
| **ElberaCreate** | `editor/charcreate/` (:8082) | The character-creation showcase — all 14 race/gender combos in 3D |
| **ElberaClient** | `editor/world/` (:8083) | The walkable world client — solo and online multiplayer |
| **ElberaGate** | `gateway/` (:8090) | WebSocket ⇄ L2-protocol bridge: browser sessions on the real server |
| **ElberaDeploy** | `deploy/` | One-command Docker stack: MariaDB + loginserver + gameserver |

---

### ElberaLib — the format library

The single source of truth for every reverse-engineered format: UE2 package
containers (`.utx`/`.ukx`/`.unr`/`.u`, versions 117 and 123), Lineage2Ver
encryption (protocols 111–414), FCompactIndex, both property-tag variants,
L2's extra material serialization blocks, pixel decoders to RGBA
(DXT1/3/5, RGBA8, RGB8, L8, P8, G16 heightmaps), Shader→diffuse material
resolution, skeletal-mesh material slots, and the `.dat` L2ASM container.
Pure Python 3 stdlib; new code should use it instead of re-parsing.

```bash
# use it
python3 -c "from l2lib import load_package"   # (with tools/l2lib on sys.path)
# verify it — 24 tests, byte-exact cross-checks against umodel
python3 tools/l2lib/tests/run_tests.py        # OK (last run: 55 s, all pass)
```

### ElberaForge — the UTX texture writer

Replaces a texture inside an encrypted Interlude `.utx` in place: regenerates
every mip level (2×2 box filter), re-encodes (DXT1/DXT5/RGBA8/RGB8/L8 in
pure Python), patches only the mip payloads — no table offset moves — and
re-encrypts with l2encdec. Writes a `.bak` first; fails cleanly without
touching the package. Verified pixel-exact against umodel round-trips.

```bash
# use it
python3 tools/utx/utxedit.py list <package.utx>
python3 tools/utx/utxedit.py replace <package.utx> <TextureName> <image.png>
# verify it
python3 tools/utx/utxedit.py list tools/samples/t_aden.utx    # 59 DXT1 exports
```

### ElberaView — the ground-truth renderer

A rendering-enabled UEViewer build (RENDERING re-enabled on macOS arm64,
vendored SDL2) that renders the actual retail meshes, textures and
animations headlessly to PNG via env-var controls (`UMODEL_HIDDEN`,
`UMODEL_AUTOSHOT`, `UMODEL_ANIM`, `UMODEL_YAW`...). Together with the
official NCSoft captures in `tools/reference/track-b/`, it is the oracle
that answers "what should it look like?" without guessing.

```bash
# use it
UMODEL_HIDDEN=1 UMODEL_AUTOSHOT=15 UMODEL_WINSIZE=1024x1024 \
  tools/bin/umodel-view -game=l2 -path=assets/interlude \
  assets/interlude/animations/Fighter.ukx MFighter_m001_u
# batch ground truth for all 14 combos
python3 tools/src/ground_truth/render_ground_truth.py
# verify it — renders land in ./Screenshots/*.tga (inspect visually)
```

### ElberaModeler — the character/monster pipeline

`.ukx` → glTF 2.0 with a zero-remap full-skeleton merge: canonical skeleton
by (parent, name) identity (absorbs retail's duplicated bone names), per-part
skins with their own inverse-bind matrices, name-anchored head re-weighting
for retail's root-weighted face shells, hair-cap meshes that close the
skulls, chargrp.dat-authoritative texture binding with Shader/FinalBlend
resolution. Output: 14 creation characters (6 clips each: idle, walk, run,
sit, dance, attack) + 25 monsters and 3 village NPCs (7 clips: + die,
corpse, special), textures 4x-upscaled by ElberaUpscaler.

```bash
# use it
/usr/bin/python3 tools/src/char_pipeline/build_characters.py [id ...]
/usr/bin/python3 tools/src/char_pipeline/build_monsters.py  [id ...]
# verify it
/usr/bin/python3 tools/src/char_pipeline/validate_gltf.py editor/characters/models/*.gltf
cd tools/src/char_pipeline && node render_check.js human_fighter_m idle 0 /tmp/out.png
```

### ElberaWorld — the map converter

`.unr` tile → `assets/world/<tile>/` web scene: G16 heightmap from
`T_<tile>.utx`, TerrainInfo layer table + painted splat maps, every
StaticMeshActor placement, and `.usx` prop meshes converted to glTF with
materials re-wired to PNGs. Emits the frozen `scene.json` contract.
**100/100 named world tiles converted** (ocean/GM-room/Olympiad/Seven-Signs
tiles intentionally skipped); the companion research toolkit lives in
`tools/maps/` (`unrmap.py`, `tilemap.py` → `assets/world/tile-map.json`).

```bash
# use it
python3 tools/world/convert.py 17_25 22_22 ...     # convert tiles
tools/world/batch_convert.sh                       # resumable full-world batch
# verify it
python3 tools/world/convert.py --check 17_25       # scene.json OK
curl -s http://127.0.0.1:8083/scenes               # 100 tiles (client running)
```

### ElberaUpscaler — the HD pipeline

Vendored `realesrgan-ncnn-vulkan` (`realesrgan-x4plus`, universal macOS
binary — nothing installed system-wide) applied 4x to all 92 character
textures; alpha channels preserved (halo-checked by compositing). LQ
originals kept in `editor/characters/models_lq/` for A/B.

```bash
# use it
tools/upscale/bin/realesrgan-ncnn-vulkan -i <in_dir_or_png> -o <out> \
  -s 4 -m tools/upscale/bin/models -f png
# verify it — 256px source becomes exactly 1024px
sips -g pixelWidth <out.png>
```

### ElberaDat — the .dat decoders

Stdlib decoders for the RSA-encrypted (protocol 413) game-data tables.
`extract_charcreate.py` → `editor/characters/charcreate-data.json`
(chargrp/hairgrp/classinfo, field-verified); `extract_gamedata.py` →
`assets/gamedata/*.json`: npcgrp (6,519), npcname (6,519), armorgrp (1,014),
weapongrp (1,313), etcitemgrp (6,911), itemname (9,238), skillgrp +
skillname (29,812 each), actionname (102), sysstring (2,083) — every parser
asserts exact byte consumption, so schema drift fails loudly.

```bash
# use it
python3 tools/dat/extract_charcreate.py
python3 tools/dat/extract_gamedata.py
# verify it — decrypt + parse the real chargrp.dat
tools/bin/l2encdec -c decode -p 413 -o /tmp/chargrp.dec assets/interlude/system/chargrp.dat
(cd tools/dat && python3 parse_chargrp.py /tmp/chargrp.dec | head)
```

### ElberaPanel — server config UI (:8080)

Dependency-free Python web UI over all 493 catalogued aCis config keys
(354 real + 139 geodata region directives) with Spanish/English labels,
stock-default comparison, dead-key detection, timestamped backups and
automatic source→dist sync. Edits the definitive configs in
`server/aCis_gameserver/config/`, never the generated dist copies.

```bash
python3 panel/server.py          # http://127.0.0.1:8080
# verify: curl -s http://127.0.0.1:8080/api/status
```

### ElberaAssets — texture package browser (:8081)

Interactive `.utx` explorer: package listing, per-texture thumbnails and
full-size views (umodel exports cached on disk), and a Phase-B replace hook
wired to ElberaForge.

```bash
python3 editor/server.py         # http://127.0.0.1:8081
# verify: curl -s http://127.0.0.1:8081/api/config
```

### ElberaCreate — character creator (:8082)

The creation-screen showcase: all 14 race/gender combos rendered from the
frozen `editor/characters/manifest.json` contract, with faces, hairstyles
and colors from the real chargrp/hairgrp data, plus the HD-upscaled
textures.

```bash
python3 editor/charcreate/server.py   # http://127.0.0.1:8082
# verify: cd editor/charcreate && node verify_app.js   (headless Chrome)
```

### ElberaClient — walkable world (:8083)

The game client: three.js world streaming over the converted tiles, point-
click movement with server reconciliation, WASD option, nameplates, chat,
target frame, HP/MP bars, damage floats, death/revive — solo offline, or
online through ElberaGate with real monsters as animated glTF models.

```bash
python3 editor/world/server.py        # http://127.0.0.1:8083
# verify (live stack required):
cd editor/world && node verify_live.js      # two headless clients, real gateway
```

### ElberaGate — the protocol bridge (:8090)

The one genuinely new piece of infrastructure. Node.js, single dependency
(`ws`). Holds one real TCP session per browser: RSA + Blowfish login
handshake (including the scrambled-modulus unscramble and the
backwards-only XOR pass), the game leg's XOR stream cipher, and a JSON-over-
WebSocket contract (the frozen bridge ops: login, enterChar, moveTo, say,
target, attack ⇄ auth_ok, enterWorld, addNpc/addPlayer, move, remove, chat,
status, selfStatus, attack, die, revive, target_ok). Device-id-derived
accounts (`AutoCreateAccounts = True` does the rest), NPC name resolution
from the datapack, and a 400 ms connection governor against aCis's
hardcoded anti-flood filter.

```bash
cd gateway && npm install && npm start     # ws://0.0.0.0:8090
# verify — all PASS against the live aCis:
node test/verify-one.js        # session, NPC stream, move, chat
node test/verify-two.js        # two clients see each other + chat relay
node test/verify-combat.js     # target and kill a Gremlin: attack/status/die/exp
node test/verify-observer.js   # client B watches client A's fight
```

### ElberaDeploy — one-command stack

`deploy/docker-compose.yml`: MariaDB 11.4 (schema auto-installed from the
65 datapack `.sql` files + gameserver registration seed), loginserver and
gameserver on Temurin 21 JRE, configs patched per-environment by the
entrypoints, `EXTERNAL_HOSTNAME` support for production. Multi-arch base
images (arm64 verified 2026-07-23; amd64 untested).

```bash
cd deploy && docker compose up -d --build
# verify: nc -z 127.0.0.1 2106 && nc -z 127.0.0.1 7777
```

---

## Verified achievements

Everything below is proven by a script or artifact in this repo — the
project rule is that visual claims carry a rendered screenshot and binary
claims carry a byte-level cross-check.

- **Real protocol gateway.** The full Interlude login + game handshake
  implemented in JavaScript against the live aCis: RSA with NCSoft's
  scrambled modulus, Blowfish (little-endian variant, unit-verified against
  the real jar via jshell), the backwards-only login XOR pass, and the
  game leg's XOR stream. Live sessions: NPCs, players, movement, chat,
  combat — `gateway/test/verify-*.js` all PASS.
- **100 map tiles converted.** Every named world tile of the Interlude
  world grid as a self-contained web scene with the frozen `scene.json`
  contract; all pass `--check`. The tile↔region naming was reverse-
  engineered and cross-validated against five independent sources
  (`docs/tile-map.md`).
- **42 glTF models.** 14 creation characters + 25 monsters + 3 NPCs,
  structurally validated, numerically diffed against umodel's own glTF
  (positions < 3e-8), and visually inspected on headless renders against
  the ground-truth oracle.
- **Live two-player combat.** Two browsers on the real server: see each
  other, walk, chat, target a Gremlin, kill it, watch the death broadcast
  from a second client, earn exp (`verify-two` / `verify-combat` /
  `verify-observer` / `editor/world/verify_live.js`).
- **The texture repack gap closed.** ElberaForge writes encrypted `.utx`
  packages that the game and umodel read back pixel-exact — previously
  Windows-only territory.
- **The .dat tables decoded.** 10 game-data files, ~93k records total,
  byte-exact parsers with loud-failure assertions.
- **30k texture library.** 386 packages exported to PNG (`assets/library/`)
  plus a 4x Real-ESRGAN HD pass on all 92 character textures.
- **A tuned aCis with custom mods.** Offline shops, `.menu`,
  `.autoloot`, `.expon`/`.expoff`, `.offline` — compiled into the jar,
  plus L2OFF geodata (139 regions) installed.
- **Ground-truth oracle.** A rendering UEViewer build for macOS arm64 that
  renders the retail data itself, cross-checked against official NCSoft
  captures — the reason every visual claim in this repo is verified, not
  guessed.

## Honest limitations

- **The browser client is a renderer, not a game.** All logic lives in
  aCis; the web client implements only the protocol subset listed in the
  gateway contract. No skills, inventory, items or quests in the browser
  yet (roadmap M4).
- **Identity by possession.** The account is a `deviceId` in
  `localStorage` — clearing browser data loses the character. No recovery
  codes yet. The gateway is plaintext WebSocket on localhost; it is not
  hardened for public exposure.
- **Terrain texturing is simplified in places.** `basecolor.png` is a
  preview blend with guessed tiling; exact TerrainLayer matrix math is
  parsed but not interpreted. BSP brush buildings, water volumes,
  emitters/particles and baked lighting are not extracted.
- **Dungeon-interior tiles** (19_16 Pagan Temple, 21_25 Elven Ruins) are
  converted correctly but the flat terrain plane occludes them in the
  client — needs a client-side interior mode.
- **Self-reconciliation is predictive.** The bridge emits move ops for
  your own character under an id the client predicts around; server-side
  pathing can adjust destinations slightly (tests allow ±30 units).
- **`all` chat is radius-limited to 1250 units** by aCis itself — distant
  players need shout (channel 1). `SystemMessage` is decoded shallowly and
  logged, not surfaced in the UI.
- **Monster roster is the starter set** (25 + 3 NPCs); civilian NPCs ship
  idle/special clips only. Prop material matching is by name; retail's
  `dummy_material_N` slots render as untextured white (matches retail).
- **Deploy**: verified on macOS arm64 only; amd64 build untested; a retail
  L2 client logging into the Docker stack from outside was not tested.
- **aCis protocol quirks are load-bearing**: `writeF` is a *double*, the
  anti-flood filter is hardcoded, and several packets are renamed versus
  retail wikis. Any codec work must read the aCis source, not the wiki
  (full list in `gateway/README.md`).

## Roadmap

Milestones M1–M3 of `docs/web-port-architecture.md` are done, and combat
(M4's core) landed ahead of schedule. What remains:

- **M4 — skills & items.** `MagicSkillUse`/`MagicSkillLaunched`, casting
  bar and animations; `ItemList`/`InventoryUpdate` with icons from
  `assets/library/`; loot flow; surface `SystemMessage` (damage numbers,
  exp gains) in the UI instead of the gateway log.
- **M5 — chat & core UI.** All `Say2` channels, inventory/character-sheet
  windows (plain DOM), basic hotbar, `.menu` voice-command passthrough
  (the server mod already exists — the client just sends `Say2`),
  optional WASD refinement, recovery-code export for deviceId accounts.
- **After M5.** KTX2 texture compression, WebGPU evaluation, mobile
  layout, dungeon-interior rendering mode, Seven Signs catacomb tiles
  (16_12/18_10/19_10/20_10), full-library HD upscale (~24–48 h of GPU
  time), public VPS deploy per `docs/README-ADMIN.md` §7.

---

## Repository map

```
assets/interlude/    retail client data (maps, textures, animations, system)
assets/library/      386 packages of exported PNGs (~30k) + manifest
assets/gamedata/     decoded .dat tables as JSON (10 files)
assets/world/        100 converted tiles + tile-map.json
server/              aCis rev 409 source + built dist + geodata staging
gateway/             ElberaGate — WS ⇄ L2 protocol bridge (:8090)
panel/               ElberaPanel — server config UI (:8080)
editor/              ElberaAssets (:8081), charcreate/ ElberaCreate (:8082),
                     world/ ElberaClient (:8083), characters/ glTF manifests
tools/               the toolchain: l2lib, utx, world, upscale, dat, maps,
                     bin/ (umodel, umodel-view, l2encdec), src/char_pipeline
deploy/              ElberaDeploy — docker compose stack
docs/                15 deep-dive documents (start: HANDOFF.md,
                     web-port-architecture.md)
```

**Documentation:** `docs/HANDOFF.md` (continue the project from zero
context) · `docs/web-port-architecture.md` (master plan + milestones) ·
`docs/character-pipeline.md` · `docs/monster-pipeline.md` ·
`docs/map-format.md` · `docs/tile-map.md` · `docs/ground-truth.md` ·
`docs/assets-tooling.md` · `docs/dat-format-notes.md` · per-tool READMEs in
`tools/*/README.md`, `gateway/README.md`, `deploy/README.md` · operations
(runbook ES): `docs/README-ADMIN.md`, `docs/GUIA-JUGADORES.md`.

---

## Resumen en español

**Elbera** lleva Lineage 2 Interlude al navegador sin reescribir el juego:
el servidor aCis real sigue corriendo el mundo (combate, inventario,
clanes, mods propios como tiendas offline y `.menu`), y el navegador es un
cliente 3D que se conecta a través de **ElberaGate**, un puente WebSocket
que habla el protocolo real de L2 (RSA, Blowfish y el cifrado XOR del juego,
implementados en JavaScript y verificados contra el servidor en vivo).

Lo que ya funciona, todo verificado con pruebas en este repositorio:

- **100 mapas del mundo** convertidos a escenas web navegables (cliente en
  el puerto 8083), con nombres de región validados contra cinco fuentes.
- **42 modelos 3D** (14 personajes de creación, 25 monstruos y 3 NPCs) con
  animaciones, exportados del cliente retail y comprobados contra un
  "oráculo" de renders del propio cliente original.
- **Multijugador y combate en vivo**: dos navegadores se ven, caminan,
  chatean y matan un Gremlin contra el servidor real.
- **Herramientas propias** para todo el pipeline: librería de formatos
  (ElberaLib), editor de texturas `.utx` con reempaquetado (ElberaForge),
  conversor de mapas (ElberaWorld), pipeline de modelos (ElberaModeler),
  decodificadores `.dat` (ElberaDat), escalado HD con IA (ElberaUpscaler),
  panel de configuración (ElberaPanel) y despliegue Docker con un comando
  (ElberaDeploy).

Lo que falta: habilidades e inventario en el cliente web (M4), chat
completo y pulido de interfaz (M5), modo de render para mazmorras
interiores y la apertura pública en un VPS. La cuenta web vive en el
navegador (sin pantalla de login): si borras los datos del navegador,
pierdes el acceso a tu personaje.

Para continuar el proyecto desde cero, lee **`docs/HANDOFF.md`**.
