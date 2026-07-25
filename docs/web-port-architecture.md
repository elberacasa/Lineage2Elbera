# L2Vzla Web Port — Architecture Master Plan

**Goal:** port Lineage 2 Interlude to the browser — first a playable
single-player client, then an online web MMO (characters per-PC, no login
screen) — running against the project's own aCis server.

**Date:** July 2026. **Status:** plan, grounded in components already proven
in this repo (each claim below names the file/command that proves it).

This is not a design in a vacuum. Everything in this document builds on
machinery that already exists on this machine:

| Proven component | Where | Evidence |
|---|---|---|
| Full Interlude client data | `assets/interlude/` | `textures/`, `animations/`, `staticmeshes/`, `systextures/`, `system/` (132 encrypted .dat), `maps/` (157 `.unr`, e.g. `15_20.unr`) |
| Native arm64 package readers | `tools/bin/umodel`, `tools/bin/l2encdec` | umodel reads encrypted L2 packages with `-game=l2`; l2encdec decodes protocols 111–414 (`docs/assets-tooling.md`) |
| .utx read + write | `tools/utx/utxedit.py` | texture editor round-trips .utx packages |
| .dat decryption + decoders | `tools/dat/l2dat.py`, `extract_charcreate.py`, `parse_chargrp.py` | chargrp/hairgrp/classinfo decoded byte-by-byte (`docs/dat-format-notes.md`) |
| Character .ukx → glTF pipeline | `tools/src/char_pipeline/` | **14 models exported, structurally validated, rendered headlessly with three.js** (`docs/character-pipeline.md`, `editor/characters/manifest.json`); 6 anims each (idle, walk, run, sit, dance, attack) |
| 30k exported textures | `assets/library/` | 386 folders of PNGs exported via umodel |
| Real L2 server running | `server/` (aCis rev 409) | builds clean with OpenJDK 21, login 2106 / game 7777, `AutoCreateAccounts = True` (`server/BUILD-NOTES.md`, `loginserver.properties:41`) |
| Geodata available | `server/geodata-staging/` | L2OFF-format Interlude geodata staged for the geoengine |
| Docker deploy | `deploy/docker-compose.yml` | mariadb + loginserver + gameserver services, login published on 2106 |
| Web tooling experience | `editor/` (8081), `panel/` (8080), charcreate app (8082) | dependency-free Python servers + three.js rendering already in use |

The strategic conclusion this document argues for: **do not reimplement the
game. The game already runs.** The web client is a *renderer + input device*
for aCis; the one genuinely new piece of infrastructure is a **WebSocket
gateway** that speaks the real L2 protocol on one side and browser-safe
WebSocket on the other.

---

## 1. Client engine (three.js)

### 1.1 Why three.js and not something else

- The character pipeline **already targets it**: 14 glTF models render
  correctly in headless Chrome with three.js today
  (`tools/src/char_pipeline/render_check.js`). glTF is three.js's native
  format; our contract (`editor/characters/models/*.gltf` + `.bin` + PNG) is
  exactly what `GLTFLoader` eats.
- WebGL2 via three.js is sufficient for Interlude-era content: ~2k-triangle
  characters, 256–1024px textures, UE2-era static meshes. Nothing here needs
  WebGPU on day one.
- The team already has three.js + CDP verification tooling working, which
  sets the verification pattern for everything below: **every visual claim
  gets a rendered screenshot inspected with ReadMediaFile** (the same rule
  the character pipeline follows).

### 1.2 Renderer architecture

```
web-client/
├── core/
│   ├── engine.js        # renderer, scene graph, main loop, stats
│   ├── assets.js        # loader + cache (glTF, PNG→texture, scene chunks)
│   └── culling.js       # tile-based LOD + frustum culling
├── world/
│   ├── terrain.js       # streamed terrain tiles (heightmap meshes)
│   ├── props.js         # static mesh instances per tile
│   ├── water.js         # simple animated planes (Interlude water is flat)
│   └── skydome.js       # per-region sky + fog settings
├── actors/
│   ├── character.js     # glTF skinned mesh + AnimationMixer
│   ├── npc.js           # same path as character (LineageNpcs*.ukx → glTF)
│   └── nameplate.js     # HTML/CSS overlay projected from 3D
├── net/
│   ├── gateway.js       # WebSocket client (M2+)
│   └── protocol.js      # packet encode/decode (mirrors gateway spec)
├── ui/
│   ├── hud.js           # HP/MP bars, target frame, hotbar
│   ├── chat.js
│   └── windows/         # inventory, character sheet, map — plain DOM
└── main.js
```

**World streaming.** L2's world is already tiled: `assets/interlude/maps/`
contains 157 `.unr` files named `<X>_<Y>.unr` (e.g. `15_20.unr`) — one per
16k×16k-game-unit world tile, exactly the grid the original client streams.
The web client adopts the same grid:

- The client tracks the active tile from the player position, loads the 3×3
  neighborhood around it, unloads tiles outside the 5×5 neighborhood.
- Each tile is converted **offline** (see 1.3) into a self-contained scene
  chunk: terrain mesh + prop instances + tile-local texture atlas. At runtime
  a chunk is a single `fetch()` of a JSON/binary bundle, not 500 separate
  asset requests.
- L2's open world has no interior occlusion culling worth porting; the win
  comes from **tile-granularity frustum culling + distance LOD**, both of
  which fall out of the tile grid for free:
  - LOD0: full prop set, loaded for the 3×3 neighborhood.
  - LOD1 (one ring out): terrain only + large props (buildings, trees above
    a size threshold), half-rate texture resolution.
  - Beyond that: nothing. Fog (per-region, from the .unr ZoneInfo) hides the
    pop, exactly as the original client does.

**Draw calls.** Interlude tiles carry hundreds of small static meshes
(fences, crates, grass). Naively that is hundreds of draw calls per tile —
fine on a 2004 GPU with DirectX 8, marginal in WebGL. The offline converter
(1.3) must therefore **merge static geometry per material per tile** into a
handful of vertex buffers, keeping only interactive/large props as separate
nodes. Target: <100 draw calls visible at any time. This is the single most
important performance decision in the renderer.

**Characters/NPCs.** The proven 14-model pipeline extends mechanically:
`LineageNpcs*.ukx`, `LineageMonsters*.ukx`, `LineageWeapons.ukx` export
through the same umodel → glTF path (`docs/character-pipeline.md` §1 lists
these packages; only their binding tables differ — npcgrp.dat instead of
chargrp.dat, and `tools/dat/` already knows how to parse that family of
files). Each world actor is one `SkinnedMesh` + one `AnimationMixer`, with
an animation name→glTF clip map mirroring the manifest.json contract.

### 1.3 Offline asset pipeline (build-time, not runtime)

All heavy conversion happens offline, reusing the verified tools. Runtime
only consumes web-native formats (glTF, PNG/KTX2, JSON).

```
assets/interlude/                     tools/                      web-client/public/
─────────────────────                 ────────────────────────    ─────────────────
maps/15_20.unr  ──►  tools/src/map_pipeline/unr_to_scene.py  ──►  world/tiles/15_20.json(+bin)
  (UE2 terrain +      - umodel exports terrain heightmap +        world/atlas/15_20_*.png
   static meshes)      static meshes (umodel -game=l2 reads .unr
                       packages the same way it reads .ukx)
                     - merges static geometry per material
                     - emits prop instance list (mesh id, transform)
                     - textures from assets/library/ (already PNG)

geodata (L2OFF) ──►  tools/src/map_pipeline/geo_to_grid.py   ──►  world/nav/15_20.nav.json
  server/geodata-      - decode L2OFF cells → walkable/z-blocked
  staging/geodata/       grid + height layers per tile
                     - the SAME files feed aCis's geoengine, so
                       client prediction and server validation
                       agree by construction

animations/*.ukx ──► tools/src/char_pipeline/ (PROVEN)       ──►  models/<id>.gltf/.bin/.png
system/*.dat     ──► tools/dat/l2dat.py + table decoders     ──►  data/*.json (npc names,
                      (chargrp done; npcgrp/armorgrp/weapongrp/       item icons, skill info…)
                       skillgrp/etc. — same container, known
                       community schemas per docs/dat-format-notes.md §3)
```

Key points:

- **Terrain is the one remaining format unknown**, and it is assumed
  extractable (map tables are being cracked in parallel; umodel already
  opens the .unr packages — `umodel -game=l2 -list maps/15_20.unr` shows
  their contents). Worst-case fallback: hand-decoded UE2 `TerrainInfo`
  from the package, using the same stdlib-binary-reader style as
  `tools/dat/l2dat.py`. This is risk R3 in §4.
- **Geodata → client walkability** is a first-class citizen, not an
  afterthought: client-side movement prediction needs the same ground truth
  the server enforces, or players rubber-band constantly. Both sides read
  from the L2OFF files in `server/geodata-staging/`.
- Everything is re-runnable and stdlib-only where possible, matching the
  project's existing tooling style (`tools/dat/extract_charcreate.py` is
  the template).

### 1.4 Input and camera

L2's native scheme is point-click-to-move with a WASD-free, mouse-driven
camera (left-drag rotate, wheel zoom, right-click context). Options:

- **(a) Point-click (recommended for M1–M3):** raycast click → terrain,
  pathfind on the client nav grid (A* over the geodata-derived grid), send
  the same *move-to-location* intent the real client sends (`MoveToLocation`
  in the protocol). Lowest divergence from server expectations — aCis
  validates destination reachability with its geoengine, so a click-driven
  client behaves identically to a retail client. Camera: orbit-follow at
  Interlude's default pitch, wheel zoom — 20 lines of three.js.
- **(b) WASD:** feels modern but fights the protocol: L2's movement model is
  destination-based server-authoritative, not velocity-based. WASD means
  synthesizing a stream of micro-destinations (what L2Walker-style bots do)
  or accepting visible correction stutter. Deferred to M5+ as an optional
  toggle; if done, it must still emit move-to-destination packets.

Recommendation: **point-click first**; it is both more faithful and less
code. Add WASD only after movement sync is stable.

### 1.5 UI layer

Plain DOM/CSS over the WebGL canvas — no in-canvas UI framework. L2's UI is
windows (inventory, skills, chat, map): DOM is better at text, scrolling and
IME input than any WebGL UI, and the project already ships polished DOM UIs
(panel on 8080, charcreate on 8082). Nameplates and target frames are
absolutely-positioned divs updated from the 3D projection each frame. Icons
come from the exported texture library (`assets/library/` already has every
icon PNG).

---

## 2. Networking — the WebSocket gateway

### 2.1 The problem

Browsers cannot open raw TCP sockets. aCis speaks the retail L2 protocol:
length-prefixed TCP packets, Blowfish-encrypted game traffic plus an RSA
key exchange at login (login server on **2106**, game server on **7777** —
`server/BUILD-NOTES.md` §3). Something must sit between the browser and
aCis.

### 2.2 Options, evaluated honestly

**(a) Gateway translating the real L2 protocol — RECOMMENDED.**
A process that holds one real TCP connection per browser session to the
login/game servers, terminating the L2 crypto itself, and relays
de/serialized packets over a single WebSocket to the browser.

- *What we reuse:* **everything**. Spawns, combat formulas, skills,
  inventory, shops, clans, the custom mods this project already built
  (offline shops, `.menu`, autoloot — `server/BUILD-NOTES.md` "Custom
  mods"), the MariaDB schema, the docker deploy. aCis cannot tell the
  gateway from a retail client.
- *What it costs:* we must implement the client half of the Interlude
  protocol: packet framing (2-byte LE length), Blowfish with the
  session key exchange (`AuthLogin`/`GGAuth`/`ProtocolVersion` handshake),
  RSA on the login leg, and per-packet structs. This is real work but it is
  *known* work: the exact formats are readable in the aCis source
  (`server/aCis_gameserver/java/net/sf/l2j/gameserver/network/serverpackets/`
  and `clientpackets/`, plus `net/sf/l2j/loginserver/`), and crypto constants
  are of the same family `tools/bin/l2encdec` already handles.
- *Bandwidth:* the browser receives decoded-but-verbose packet JSON or a
  compact binary mirror of the L2 structs. L2 Interlude traffic is tiny by
  modern standards (a few KB/s per player in the field); WebSocket can carry
  the raw struct bytes 1:1, so the gateway is a **dumb pipe plus a codec**
  — no game logic in the gateway, which keeps it honest and small.

**(b) Custom protocol against aCis internals.**
A Java plugin/socket inside aCis that exports game state as JSON events to
browsers, bypassing the L2 protocol entirely.

- *Avoids* packet reverse engineering almost entirely.
- *But* it forks aCis: every game feature the web client needs (movement,
  targeting, combat feedback, item tooltips…) becomes a new custom message
  the Java side must emit. You end up maintaining a second, parallel
  protocol that drifts out of sync with the real one, and every aCis update
  or custom mod must remember to feed it. It also can't be tested against
  the retail client as a reference. More total code, spread across two
  runtimes, with worse debuggability.

**(c) Reimplement server logic in JS — REJECTED.**
Rewriting L2's game simulation (spawn engine, AI, skill effects, geoengine,
clans, siege, the DB layer) in JavaScript is a multi-year re-creation of
what aCis already is — and this project's aCis has custom mods and a tuned
config. Insane at any team size; rejected without further analysis.

**Decision: (a).** The gateway is the only option where the hard part
(the game) stays solved.

### 2.3 Gateway design

```
 browser (web-client)            gateway (Node, new: web-gateway/)        aCis
─────────────────────            ──────────────────────────────────      ─────────────
 three.js client          WS     per-session:                            login :2106
 protocol.js            ◄════►   - TCP client to 2106/7777        TCP    game  :7777
 (encode/decode structs)  JSON/  - L2 framing + Blowfish + RSA   ◄════►  (unmodified)
                          bin    - NO game logic; codec only
```

- **Language: Node.js.** The same runtime the web tooling already uses
  (render_check.js), native crypto module covers Blowfish/RSA, and the
  packet struct definitions can be **shared as one JS module** between
  gateway and browser client (write the codec once, run it on both sides —
  gateway decodes L2→plain structs, browser renders them; browser encodes
  actions, gateway encrypts→TCP). One codec, zero drift.
- **Wire format browser⇄gateway:** start with the L2 packet structs as
  binary over the WebSocket (length-prefixed, unencrypted) — the codec is
  then identical on both ends. JSON only for the few non-L2 control
  messages (session bootstrap, errors).
- **Session model — characters per-PC, no login screen** (owner's
  requirement):
  1. First visit: the client generates a random 128-bit ID, stores it in
     `localStorage` (`l2vzla.deviceId`). This ID *is* the account.
  2. On connect, the client sends the deviceId over the WebSocket. The
     gateway derives credentials deterministically (e.g. account =
     `web_<sha256(deviceId)[:12]>`, password = another derived hash) and
     performs the login-server handshake. **`AutoCreateAccounts = True` is
     already set** in aCis (`loginserver.properties:41`), so the account is
     created transparently on first login — zero signup UX.
  3. If the account has no character, the client shows the character
     creator (the existing 8082 app, promoted into the web client) and
     issues `CharCreate`; otherwise it auto-selects the single character
     and enters the world. From the player's perspective: open URL → you
     are in the game.
  4. Multi-character-per-account stays possible later via the standard
     char-select packets; the "one character per PC" default is a UI
     choice, not a protocol limitation.
- **Security notes (be honest):** deviceId-in-localStorage is identity by
  possession — clearing browser data loses the character. Acceptable for a
  community project; document it in the player guide. An optional "export
  recovery code" (the raw deviceId) is a 10-line addition later. The gateway
  must rate-limit and cap sessions per IP exactly like the login server
  already does; it adds no new attack surface to aCis beyond what any
  client has, since it sends well-formed protocol only.
- **Deployment:** the gateway becomes a fourth service in
  `deploy/docker-compose.yml` (node:22-alpine, publishes e.g. 8083/ws),
  connecting to `loginserver:2106` / `gameserver:7777` on the internal
  network. Locally it runs as a plain `node` process next to the other
  tools.

### 2.4 Protocol implementation plan (the codec)

Ordered by what M2/M3 need (aCis source file names given — read these, they
are the spec):

1. Login leg (2106): `Init` (RSA + Blowfish session key), `AuthGameGuard`,
   `RequestAuthLogin`, `LoginOk`, `RequestServerList`, `ServerList`,
   `RequestServerLogin`, `PlayOk`.
   (aCis: `loginserver/network/serverpackets/*`, `clientpackets/*`.)
2. Game leg (7777): `SendProtocolVersion` (C), `AuthLogin` (C), blowfish
   re-key, `CharSelectInfo` (S), `CharSelected` (S), `EnterWorld` (C),
   `UserInfo` (S), `CharInfo` (S), `AbstractNpcInfo`/`NpcInfo` (S),
   `MoveBackwardToLocation` (C, retail's "MoveToLocation" click-to-move
   request), `MoveToLocation` (S, movement broadcast), `ValidatePosition`
   (C), `StopMove` (S), `ActionFailed` (S). Names verified against
   `gameserver/network/{server,client}packets/*.java` in this repo — aCis
   renames a few retail packets, always check the source, not the wiki.
3. M4+: `Attack`, `AttackRequest`, `Die`, `Revive`, `SystemMessage`,
   `MagicSkillUse`/`MagicSkillLaunched`, `InventoryUpdate`, `ItemList`.
4. M5+: `Say2`, `CreatureSay`, social actions, `CharInfo` deltas.

Write the codec with a packet-definition DSL (name → field list) so aCis's
`writeD/writeS/...` sequences translate almost line-by-line. Test strategy:
**record real traffic** — point the gateway at the local aCis, connect with
a retail-compatible bot or a logged session, capture packet hex, and replay
it through the decoder in unit tests. The aCis source makes every field
known, so this is verification, not blind reversing.

---

## 3. Milestone roadmap

Estimates assume one focused developer using this repo's existing tools;
they are order-of-magnitude, not commitments.

### M1 — Walkable terrain + own character, no server (≈2–3 weeks)

- `unr_to_scene.py` v1: terrain heightmap + merged statics + textures for
  **one** starting tile (Talking Island village area: `15_20`/`15_21`
  region maps exist in `assets/interlude/maps/`).
- three.js scene: skydome, fog, orbit-follow camera, point-click movement
  on the nav grid with A*, character glTF from the existing manifest
  playing idle/walk/run (all proven assets).
- **Exit criteria:** open the page, click around the village, character
  walks with correct ground height and animations; screenshot-verified.
- De-risks: map conversion (R3), draw-call strategy (R4), input/camera.

### M2 — Gateway connects; see the world standing still (≈3–4 weeks)

- `web-gateway/` Node service: TCP to 2106/7777, full login+game handshake,
  Blowfish+RSA codec, WebSocket relay.
- Browser: session bootstrap from deviceId, auto account create/login,
  char creator reuse → `CharCreate` or auto-select → `EnterWorld`.
- Render `NpcInfo`/`CharInfo` for everything in range as static glTF
  figures at protocol coordinates (UE2↔glTF axis conversion is already
  solved in the character pipeline).
- **Exit criteria:** two browsers logged in see each other and nearby NPCs
  standing in the correct spots; server logs show normal client sessions.
- De-risks: packet crypto (R1), protocol completeness for login (R2).

### M3 — Movement sync (≈2 weeks)

- Click → `MoveBackwardToLocation` (client→server); remote entities
  interpolate along `MoveToLocation` broadcasts; `ValidatePosition`
  reconciliation with soft correction (never hard-snap unless > N units off).
- Walkability prediction from the nav grid so clicks on walls/water fail
  client-side exactly as server-side.
- **Exit criteria:** player roams a town + field smoothly; a second client
  sees matching paths without rubber-banding; server-side geo checks pass.

### M4 — Combat basics (≈3 weeks)

- Target frame, `AttackRequest`/auto-attack loop, damage via
  `SystemMessage`/`StatusUpdate`, `Die`/`Revive` flow, HP/MP bars.
- Basic monster AI observation only (server drives it; client just renders
  `MoveToPawn`/attack anims).
- **Exit criteria:** kill a fox outside the starting village, loot a drop,
  die, respawn in town — all through the web client.

### M5 — Chat & core UI (≈2–3 weeks)

- `Say2` chat (all channels), inventory (`ItemList`/`InventoryUpdate`) with
  icons from `assets/library/`, character sheet, basic hotbar, `.menu`
  voice command passthrough (the server mod already exists — the web
  client just sends `Say2` with `.menu`).
- Optional WASD toggle once movement is proven.
- **Exit criteria:** a new player can play the first hours of L2
  (create → quest NPC dialogue via `RequestBypassToServer` HTML windows →
  fight → chat) entirely in the browser.

Total: roughly **3–4 months** of focused work to M5, with M2 (the gateway)
as the critical path.

### Top 5 technical risks

1. **R1 — Packet crypto handshake.** Blowfish key exchange + RSA on the
   login leg must match aCis exactly or nothing connects. *Mitigation:*
   aCis source is in-tree (`loginserver/network/...`), the crypto setup is
   ~200 lines, and we can diff our handshake against aCis's own logs. M2
   starts here deliberately.
2. **R2 — Protocol completeness drift.** Interlude has ~200 packet types;
   a forgotten field shows up as silent misbehavior, not errors.
   *Mitigation:* codec generated from packet-definition tables mirroring
   aCis writeX order; recorded-traffic unit tests; strict-mode decoder that
   logs leftover bytes per packet.
3. **R3 — Map/terrain extraction.** .unr terrain decoding is the least
   proven link (assumed extractable; umodel lists the packages).
   *Mitigation:* M1 does exactly one tile first; fallback is a hand-written
   `TerrainInfo` reader in the `l2dat.py` style; worst case, flat ground +
   props still yields a playable M1.
4. **R4 — Browser draw calls / perf.** An unmerged L2 town can exceed
   1,000 draw calls and kill WebGL. *Mitigation:* per-material static
   merging in the offline converter (§1.2), <100-call budget enforced by a
   render_check-style CI screenshot+stats run.
5. **R5 — Geodata client/server sync.** If the client nav grid and aCis's
   geoengine disagree, movement rubber-bands. *Mitigation:* both sides
   derive from the same L2OFF files in `server/geodata-staging/`; M3
   includes a debug overlay rendering the grid against the terrain to spot
   mismatches visually.

---

## 4. What to build next, concretely

In order, starting this week:

1. **Map probe (1–2 days).** Run
   `tools/bin/umodel -game=l2 -list assets/interlude/maps/15_20.unr` and a
   glTF export attempt of its terrain/statics; record exactly what umodel
   can and cannot emit for .unr. This converts R3 from an assumption into a
   fact and sizes `unr_to_scene.py`.
2. **M1 scaffold (week 1–2).** `web-client/` with the three.js scene,
   orbit camera, point-click on a temporary flat plane, and one existing
   character glTF walking — every piece already proven except the terrain.
   Verify with the established headless-Chrome screenshot loop.
3. **Gateway handshake spike (parallel, week 1–3).** `web-gateway/` Node
   service that does *only* the login-server handshake against the local
   aCis (Init → AuthLogin → LoginOk → ServerList → PlayOk → game
   `ProtocolVersion`/`AuthLogin`), printing decoded packets. This is R1+R2
   burned down before M1 even finishes, and it unblocks the critical path.
4. **Codec tables (continuous).** Start the packet-definition module with
   the §2.4 step-1/2 packets, transcribed from aCis sources with
   recorded-traffic tests.
5. **Then** M1 terrain conversion → M2 EnterWorld, per the roadmap.

Explicitly *not* next: WASD, WebGPU, KTX2 compression, mobile layout —
all wait until M5.

---

## 5. Resumen para la comunidad (ES)

**Qué estamos haciendo:** llevar Lineage 2 Interlude al navegador. Primero
una versión jugable en solitario y después un MMO web completo, sin pantalla
de login: cada PC tiene su personaje automáticamente.

**Lo que ya funciona hoy** (no es teoría, está probado en este proyecto):

- Tenemos el cliente Interlude completo y sabemos leerlo: texturas (30 mil
  ya exportadas), mapas (157 archivos), modelos y animaciones.
- Los 14 modelos de razas ya se ven en el navegador con three.js, con sus
  armaduras y animaciones correctas (caminar, correr, atacar, bailar…).
- Tenemos un servidor L2 real (aCis) corriendo en local y en Docker, con el
  juego completo funcionando: combate, inventario, tiendas, clanes.
- Ya hay apps web hechas: panel de configuración, editor de assets y el
  creador de personajes.

**La idea clave:** no vamos a reescribir el juego. El servidor ya existe y
funciona. El navegador no puede hablar el protocolo de red de L2
directamente, así que construiremos un **puente (gateway) WebSocket** que
traduce entre el navegador y el servidor real. Todo el juego —monstruos,
misiones, economía— sigue corriendo en aCis sin tocarlo.

**Cómo se verá el juego:** mapa del mundo real de L2 cargado por zonas
(como hacía el cliente original), tu personaje en 3D moviéndose con clic,
cámara giratoria con zoom, interfaz estilo L2 (barras de vida, chat,
inventario) hecha con tecnología web normal.

**Sin registro ni contraseñas:** al entrar por primera vez, el navegador
crea tu cuenta automáticamente a partir de un identificador guardado en tu
PC. Abres la página y ya estás dentro. Ojo: si borras los datos del
navegador pierdes el acceso a tu personaje (más adelante habrá código de
recuperación).

**El camino (hitos):**

1. **M1** — Caminar por un mapa real con tu personaje (sin servidor).
2. **M2** — Conexión al servidor: ver NPCs y otros jugadores.
3. **M3** — Movimiento sincronizado entre jugadores.
4. **M4** — Combate básico: pegar, morir, lootear.
5. **M5** — Chat, inventario e interfaz completa.

Estimamos unos 3–4 meses de trabajo hasta M5. Los mayores riesgos son la
criptografía del protocolo, la extracción del terreno de los mapas y el
rendimiento del navegador en ciudades — los atacamos primero, no al final.

**Lo próximo que se construye:** esta semana, la prueba de extracción de un
mapa y el primer apretón de manos de red entre el gateway y el servidor.
