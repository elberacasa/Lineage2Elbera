# L2Vzla M2 — WebSocket Gateway

Protocol bridge between browser WebSocket clients and the real aCis (rev 409,
Interlude) login/game servers. Each browser WS connection gets its own L2
session: account auto-created from a persistent `deviceId`, character
auto-created on first login (Human Fighter), then a live two-way stream of
world state and actions.

## Run

```bash
cd gateway
npm install          # only dep: ws
npm start            # ws://0.0.0.0:8090
```

Env: `GATEWAY_PORT` (8090), `L2_LOGIN_HOST` (127.0.0.1), `L2_LOGIN_PORT`
(2106), `L2_SERVER_ID` (1).

Requires the local aCis servers (started with nohup from
`server/aCis_gameserver/build/dist/{login,gameserver}`, JAVA_HOME
`/opt/homebrew/opt/openjdk@21`, ports 2106/7777, MariaDB `l2jdb`).

## Verify (live, scripted)

```bash
node test/verify-one.js [deviceId]   # login -> enterChar -> enterWorld + NPC stream -> moveTo -> say
node test/verify-two.js [suffix]     # two clients: addPlayer both ways + movement + chat relay
node test/verify-combat.js [deviceId] # target a Gremlin, kill it: target_ok/attack/status/die/remove/exp
node test/verify-observer.js [suffix] # client B watches client A fight: attack + die broadcasts
node test/smoke-protocol.js          # same as verify-one but without the WS layer (raw protocol)
```

All suites PASS against the live server (see task report for log excerpts).
Note: the movement destination the server broadcasts can differ a few units
from the requested target (server-side pathing adjustment); verify-two
allows ±30.

## M3: combat ops (added to the frozen contract)

Client -> server:
- `{"op":"target","id":N}` -> Action(0x04), plain click (target/interact).
- `{"op":"attack","id":N}` -> AttackRequest(0x0a), ctrl+click (force attack;
  starts auto-attack server-side, one request is enough while in range).

Server -> client:
- `{"op":"status","id":N,"hp":N,"maxHp":N,"mp":N,"maxMp":N}` — merged view of
  StatusUpdate(0x0e) attributes for non-self objects (sent on target select
  and on every hp/mp change of a targeted creature).
- `{"op":"selfStatus","hp":N,"maxHp":N,"mp":N,"maxMp":N,"cp":N,"maxCp":N,"level":N,"exp":N,"sp":N}`
  — seeded from UserInfo(0x04), updated by self StatusUpdate attributes
  (LEVEL 1, EXP 2, CUR_HP 9, MAX_HP 10, CUR_MP 11, MAX_MP 12, SP 13,
  CUR_CP 33, MAX_CP 34). Fires on login, hp/cp changes, exp/SP gains, level ups.
- `{"op":"attack","id":N,"targetId":N,"damage":N,"critical":false,"miss":false}`
  — one op per hit from Attack(0x05). Flags: MISS 0x80, CRIT 0x20
  (SHLD 0x40 and SS 0x10 currently not forwarded). Misses arrive with
  `damage: 0, miss: true`.
- `{"op":"die","id":N}` — Die(0x06). Corpse decay arrives later as the
  regular `{"op":"remove","id":N}` (DeleteObject 0x12).
- `{"op":"revive","id":N}` — Revive(0x07).
- `{"op":"target_ok","id":N}` — MyTargetSelected(0xa6), confirms your target.

Also: `enterWorld.char` now includes `id` (own objectId, for self-reconcile).
`enterWorld` fires exactly once per session; later UserInfo re-sends
(level up etc.) only update `selfStatus`.

SystemMessage(0x64) is decoded shallowly (id + typed params: 0 TEXT, 1
NUMBER, 2 NPC_NAME, 3 ITEM_NAME, 4 SKILL_NAME, 5 CASTLE_NAME, 6 ITEM_NUMBER,
7 ZONE_NAME-loc) and written to the gateway log only — it is NOT part of the
frozen contract. Example evidence: `sysmsg id=95 params=145,10` ("You have
earned 145 exp and 10 SP").


## Frozen bridge contract (WS JSON)

Client -> server:
- `{"op":"login","deviceId":"<persistent browser id>"}`
- `{"op":"enterChar","slot":0}`
- `{"op":"moveTo","x":0,"y":0,"z":0}`
- `{"op":"say","channel":0,"text":".."}`

Server -> client:
- `{"op":"auth_ok","chars":[{"slot":0,"name":"..","race":0,"classId":0}]}`
- `{"op":"enterWorld","char":{"name":"..","race":0,"classId":0,"x":0,"y":0,"z":0,"heading":0}}`
- `{"op":"addNpc","id":1,"npcId":1001,"name":"..","x":0,"y":0,"z":0,"heading":0}`
- `{"op":"addPlayer","id":2,"name":"..","race":0,"classId":0,"x":0,"y":0,"z":0,"heading":0}`
- `{"op":"move","id":1,"tx":0,"ty":0,"tz":0}` (also emitted on TeleportToLocation / ValidateLocation)
- `{"op":"remove","id":1}`
- `{"op":"chat","from":"..","channel":0,"text":".."}`

`id` is the L2 objectId. `race`/`classId` are aCis conventions (Human
Fighter = race 0, classId 0). `addNpc.name` falls back to the datapack NPC
name table (parsed from `dist/gameserver/data/xml/npcs/*.xml`) when the
server sends an empty server-side name.

## Integration notes (from the M2 web-client bring-up, verified live)

- **Self id is not exposed.** `enterWorld.char` has no `id`, and
  `addPlayer` is never emitted for the own character (aCis sends UserInfo,
  not CharInfo, for self). `move`/`teleport`/`validate` ops for the own
  character ARE emitted, but with an objectId the client never learns, so a
  client cannot reliably match them. The web client works around this with
  client-side prediction and by ignoring `move` ops with unknown ids.
  RECOMMENDATION: include `id` in `enterWorld.char` (the bridge already
  knows it from UserInfo) so clients can reconcile server-adjusted
  destinations and teleports for their own character.
- **'all' chat is radius-limited.** aCis `ChatAll` only broadcasts
  CreatureSay to players within **1250 L2 units (12.5 m)** of the speaker
  (`chathandlers/ChatAll.java`). Two clients farther apart will see each
  other's `say` ops silently dropped by the game server — this is aCis
  behavior, not a bridge bug. `GlobalChatTime = 0` locally, so no flood
  delay. Use channel 1 (shout) if you need wider reach in tests.
- **Heading convention (confirmed against live traffic):**
  `heading = atan2(dy, dx) * 65536 / (2*pi)` mod 65536 — i.e. the heading
  angle is measured CCW from the +X axis toward +Y, matching aCis
  `MathUtil.calculateHeadingFrom`. Verified with two independent walks
  (exact match, including a diagonal).
- **Indoor z is geodata z.** Server z includes walkable building floors
  (the TI spawn is INSIDE the lighthouse; the floor is ~3 m above the bare
  terrain height). Clients that clamp entities to a terrain heightmap must
  take `max(terrainHeight, serverZ)` or characters sink under indoor
  floors.

## Protocol notes (aCis 409 — trust the source, not the wiki)

Framing: every packet = 2-byte LE length (inclusive of the header) + body.
All integers little-endian; strings UTF-16LE NUL-terminated.

### GOTCHAS discovered while building this (all verified live)

- **`writeF` is a DOUBLE (8 bytes), not a float.** aCis 409's
  `commons/mmocore/SendablePacket.writeF(double)` uses `putDouble`. This
  affects CharSelectInfo, UserInfo, CharInfo, NpcInfo (HP/MP, speed
  multipliers, collision radius/height). Parsers written from retail L2J
  docs will desync mid-packet.
- **Login Init decryption: the XOR pass is only invertible BACKWARDS.**
  `NewCrypt.encXORPass` (server side) walks forward `ecx += plain; cipher =
  plain ^ ecx`. The correct inverse (`decXORPass` in `src/crypt.js`) walks
  from the tail down to offset 4: `edx ^= ecx; ecx -= edx`, seeded with the
  key stored at `size-8`. A forward inverse does not exist (the function is
  not injective in that direction).
- **RSA modulus is scrambled** (`ScrambledKeyPair`): unscramble by applying
  the same 4 steps in REVERSE order (4,3,2,1). Auth block: raw RSA
  (RSA/ECB/NoPadding, publicEncrypt) of a 128-byte buffer with the login at
  `0x5E` (14 bytes) and password at `0x6C` (16 bytes), zero elsewhere.
- **Login blowfish**: first server packet (Init) uses the static key
  `6b 60 cb 5b 82 ce 90 b1 cc 2b 6c 55 6c 6c 6c 6c` + XOR pass; everything
  after uses the dynamic 16-byte key from Init + 4-byte XOR checksum,
  padded to a multiple of 8. The Blowfish variant is LITTLE-endian word
  assembly (see `src/blowfish.js`, ported 1:1 from the Java engine —
  verified against `jshell` with the real jar).
- **Game crypt is an XOR stream, not Blowfish** (`GameCrypt`): key = 8 bytes
  from VersionCheck + static tail `c8 27 93 01 a1 6c 31 97`; bytes 8-11 of
  the key are a LE counter incremented by each packet's size; first packet
  each direction (SendProtocolVersion / VersionCheck) goes PLAINTEXT.
- **Hardcoded anti-flood on BOTH servers** (`commons/network/IPv4Filter`,
  used by loginserver `SelectorHelper` and gameserver): >3 rapid
  connections/second from one IP → rejected without any packet, and every
  retry refreshes a 300s in-memory ban. The gateway paces ALL outbound L2
  connections through a 400ms governor (`src/governor.js`) and retries the
  login flow with backoff (`src/bridge.js`). `EnableFloodProtection = False`
  was also set in `dist/login/config/loginserver.properties` (that's the
  *other*, configurable filter, `FloodProtectedListener`).
- **Movement**: client `MoveBackwardToLocation` (0x01) needs
  `moveMovement = 1` (mouse); 0 (keyboard) is rejected with ActionFailed.
  The server adjusts the destination slightly (pathing), so the broadcast
  `MoveToLocation` target is authoritative.
- **EnterWorld flow**: SendProtocolVersion(0x00, v746) -> VersionCheck ->
  AuthLogin(0x08, note order: S account, D playOk2, D playOk1, D loginOk1,
  D loginOk2) -> CharSelectInfo(0x13) -> [RequestCharacterCreate(0x0b) ->
  CharCreateOk(0x19) -> CharSelectInfo] -> RequestGameStart(0x0d, slot) ->
  CharSelected(0x15) -> EnterWorld(0x03) -> flood of packets incl.
  UserInfo(0x04).
- aCis renames vs retail: client move = MoveBackwardToLocation, server
  broadcast move = MoveToLocation, protocol version client packet =
  SendProtocolVersion, char list = CharSelectInfo, chat = Say2 (client) /
  CreatureSay (server, 0x4a).

### Packet ids used

Login (C→S): AuthGameGuard 0x07, RequestAuthLogin 0x00, RequestServerList
0x05, RequestServerLogin 0x02.
Login (S→C): Init 0x00, LoginFail 0x01, LoginOk 0x03, ServerList 0x04,
PlayFail 0x06, PlayOk 0x07, GGAuth 0x0b.
Game (C→S): SendProtocolVersion 0x00 (v746), AuthLogin 0x08,
RequestCharacterCreate 0x0b, RequestGameStart 0x0d, EnterWorld 0x03,
MoveBackwardToLocation 0x01, Action 0x04, AttackRequest 0x0a, Say2 0x38,
ValidatePosition 0x48.
Game (S→C, decoded): VersionCheck 0x00, CharSelectInfo 0x13,
CharSelected 0x15, CharCreateOk 0x19, CharCreateFail 0x1a, UserInfo 0x04,
CharInfo 0x03, NpcInfo 0x16, MoveToLocation 0x01, DeleteObject 0x12,
CreatureSay 0x4a, TeleportToLocation 0x28, ValidateLocation 0x61,
Attack 0x05, Die 0x06, Revive 0x07, StatusUpdate 0x0e,
MyTargetSelected 0xa6, SystemMessage 0x64 (log only).

## Files

- `src/blowfish.js` + `src/tables.js` — Blowfish engine, tables extracted
  from the aCis Java source (unit-verified against the real jar via jshell).
- `src/crypt.js` — checksums, XOR pass, LoginCrypt, GameCrypt, RSA helpers.
- `src/l2io.js` — LE packet reader/writer, stream framer.
- `src/loginclient.js` — full login-server flow.
- `src/gameclient.js` — game session + packet decoders.
- `src/governor.js` — outbound connection pacing (anti-flood).
- `src/bridge.js` — WS contract mapping, deviceId→account/char derivation,
  auto-create, retries.
- `src/npcnames.js` — npcId→name from the datapack XML.
- `src/server.js` — WS entry point.
