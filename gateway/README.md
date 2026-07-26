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
node test/verify-m4.js [deviceId]    # skills+items: skillList/itemList, self-cast, nuke kill, manual loot
node test/verify-m5.js [suffix]      # chat channels (TELL target, SHOUT), charSheet, .menu passthrough
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

SystemMessage(0x64) is shallow-decoded into the contract op
`{"op":"sysMsg","id":N,"params":[...]}` (param types: 0 TEXT, 1 NUMBER,
2 NPC_NAME, 3 ITEM_NAME, 4 SKILL_NAME, 5 CASTLE_NAME, 6 ITEM_NUMBER,
7 ZONE_NAME-loc). Example: `{"op":"sysMsg","id":95,"params":[145,10]}` =
"You have earned 145 exp and 10 SP".

## M7: character actions / ActionWnd (added 2026-07-26)

Client -> server:
- `{"op":"action","actionId":N}` — character action, ctrl/shift always false.
  Routing (aCis reality, two different packets share the op):
  - ids 2..13 -> **RequestSocialAction(0x1b)**, social emotes:
    2 Greeting, 3 Victory, 4 Advance, 5 No, 6 Yes, 7 Bow, 8 Unaware,
    9 Waiting, 10 Laugh, 11 Applaud, 12 Dance, 13 Sorrow.
  - anything else -> **RequestActionUse(0x45)** verbatim; handled ids in
    this rev's switch: 0 Sit/Stand, 1 Walk/Run, 10 Private Store Sell,
    28 Private Store Buy, 37 Dwarven Manufacture, 51 General Manufacture,
    61 Package Sell, 15-27/38/52-54 pet/summon actions, 1000+ specials.
  actionname-e.dat ids (assets/gamedata/actionname.json, schema
  {tag,id,type,category,category2,name,icon,desc,cmd}) ALIGN with
  RequestActionUse ids (0 sitstand, 1 walkrun, 10 sell, 28 buy, 37/51
  manufactures) — but NOT for socials: UI action 12 Greeting (cmd
  `socialhello`) must be sent as social id 2. Mapping:
  12→2, 13→3, 14→4, 25→5, 24→6, 26→7, 29→8, 30→9, 31→10, 33→11, 34→12, 35→13.

Server -> client (additive):
- `{"op":"socialAction","id":N,"actionId":N}` — SocialAction(0x2d) broadcast.
- `{"op":"changeWait","id":N,"waitType":N}` — ChangeWaitType(0x2f):
  0 sitting, 1 standing, 2 start fake death, 3 stop fake death.
- `{"op":"changeMove","id":N,"running":N}` — ChangeMoveType(0x2e):
  0 walking, 1 running.

Canonical path note: `/sit` via Say2 does NOTHING in aCis (no voiced/user
command for it; Say2 only routes `.`-prefixed voiced commands and
RequestUserCommand has no sit handler). RequestActionUse is THE path.
Verified live: broadcasts observed by BOTH the actor and an observer.

## M6: NPC dialog ops (added 2026-07-26 to the frozen contract)

Server -> client:
- `{"op":"npcHtml","html":"..."}` — full NpcHtmlMessage(0x0f) body
  (D objectId, S html, D itemId in this rev). Arrives for villager dialogs,
  `.menu`, teleporters, shop lists — send whenever the server sends it.
- `{"op":"actionFailed"}` — ActionFailed(0x25), no payload: a talk/action
  was rejected.

Client -> server:
- `{"op":"talk","id":N}` — talk/interact with an NPC. Semantics (aCis
  Creature.onAction): the FIRST Action(0x04) only sets the target; a second
  Action on the current target INTERACTS (dialog) for non-attackable NPCs,
  but ATTACKS for attackable ones (isAttackableWithoutForceBy, or ctrl via
  AttackRequest). The bridge sends Action twice (400ms apart) when `id` is
  not the current target. There is NO packet-level talk-vs-attack flag —
  aCis decides by attackability: on attackable NPCs `talk` swings the
  weapon, so use the existing `attack{id}` op for monsters and `talk` for
  villagers/folks.
- `{"op":"bypass","command":".."}` — RequestBypassToServer(0x21) with the
  raw command string. Dialog hrefs arrive as `bypass -h <cmd>` (send `<cmd>`
  verbatim, e.g. `npc_268451849_Quest`); the `.menu` mod buttons use
  `bypass voiced_<cmd>` (e.g. `voiced_menu autoloot`). Governor-paced like
  everything else.

Verified live (test/verify-dialog.js): talk to Roien -> real dialog html ->
followed its own `npc_..._Quest` bypass -> quest page; `.menu` -> mod menu
html -> `voiced_menu autoloot` bypass -> menu refreshed. Note: the Newbie
Helper shows link-less tutorial-chain html for fresh chars (Tutorial quest
behavior server-side, not a bridge issue).

## M5: chat channels & character sheet (added to the frozen contract)

### Chat channels (SayType ordinals, enums/SayType.java)

The `channel` field in `chat` / `say` is the aCis SayType ordinal:

| id | channel | client prefix |
|---:|---|---|
| 0 | ALL | (plain) |
| 1 | SHOUT | `!` |
| 2 | TELL (whisper) | `"name` |
| 3 | PARTY | `#` |
| 4 | CLAN | `@` |
| 5 | GM | |
| 6 | PETITION_PLAYER | |
| 7 | PETITION_GM | |
| 8 | TRADE | `+` |
| 9 | ALLIANCE | `$` |
| 10 | ANNOUNCEMENT | |
| 11 | BOAT | |
| 12 | L2FRIEND | |
| 13 | MSNCHAT | |
| 14 | PARTYMATCH_ROOM | |
| 15 | PARTYROOM_COMMANDER | |
| 16 | PARTYROOM_ALL | |
| 17 | HERO_VOICE | `%` |
| 18 | CRITICAL_ANNOUNCE | |

- C→S `{"op":"say","channel":N,"text":"..","target":".."?}` — Say2(0x38).
  When channel is TELL(2) and `target` is present, the packet appends
  `S target` (clientpackets/Say2.java reads it only for TELL).
- S→C `chat` on TELL includes `target` = the other party's name. Wire
  detail (chathandlers/ChatTell.java): the receiver's packet carries the
  sender name (so `from == target == sender`); the sender's own echo
  carries `"->targetName"`, which the bridge strips into `target`.

### charSheet

### Level fields (TargetStatusWnd support, 2026-07-26, additive)

- `addNpc` gains `level` — **aCis 409's NpcInfo packet carries NO level
  field** (verified byte-level against AbstractNpcInfo.java and a live
  packet dump). The bridge fills it from the datapack NPC template XML
  (`data/xml/npcs/*.xml`, the same data NpcData loads; Gremlin 18342 = 1).
  If `Config.ShowNpcLevel` is ever enabled, the live "Lv N" title prefix
  (AbstractNpcInfo.java:106) takes precedence.
- `addPlayer` gains `level: null` — aCis 409's CharInfo has no level field
  either; player levels are unavailable in-protocol. Clients must tolerate
  null (hide level or show "??" for players).
- `target_ok` gains `color` — the raw MyTargetSelected color: for
  attackable targets it is **viewer level − target level** (Player.java
  setTarget), i.e. the retail con-color basis (negative = target higher
  level); 0 for non-attackable.

### charSheet

`{"op":"charSheet","str":N,"dex":N,"con":N,"int":N,"wit":N,"men":N,"pAtk":N,"pDef":N,"mAtk":N,"mDef":N,"accuracy":N,"evasion":N,"critical":N,"runSpeed":N,"walkSpeed":N,"pAtkSpd":N,"mAtkSpd":N,"maxLoad":N}`

Decoded from UserInfo(0x04) (field order verified against
serverpackets/UserInfo.java; remember writeF = 8-byte double). Sent right
after enterWorld and again on every UserInfo re-send (stat changes).
`maxLoad` = weight limit. Live human fighter lvl 1 values match the
datapack template exactly: str=40 dex=30 con=43 int=21 wit=11 men=25,
runSpeed=115 walkSpeed=80 (classes/humanFighter.xml).

### .menu / voice commands passthrough

`{"op":"say","channel":0,"text":".menu"}` reaches the server mod
(Say2 → VoicedCommandHandler). The response is an **NpcHtmlMessage(0x0f)**
HTML window (data/html/mods/menu.htm) — NOT a chat/sysMsg. The gateway
decodes 0x0f and logs it (`html window (1457 chars): <html><body>
<title>L2Vzla - Menu del jugador</title>...`); it is deliberately not a
contract op (the web client renders its own menu). Toggle responses from
`.autoloot`/`.expon`/`.expoff` arrive as `sysMsg` (SystemMessage.sendString,
id 1 with a TEXT param).

## M4: skills & items ops (added to the frozen contract)

Server -> client:
- `{"op":"skillList","skills":[{"id":N,"level":N}]}` — SkillList(0x58), sent
  once right after enterWorld (server sends it BEFORE UserInfo during
  EnterWorld; the bridge queues and flushes after enterWorld to keep the
  contract order).
- `{"op":"skillCast","casterId":N,"targetId":N,"skillId":N,"level":N,"hitTime":N}`
  — MagicSkillUse(0x48), cast start (hitTime in ms).
- `{"op":"skillLaunch","casterId":N,"targetId":N,"skillId":N,"level":N}` —
  MagicSkillLaunched(0x76). The packet carries a target list; the bridge
  emits one op per target.
- `{"op":"itemList","items":[{"objectId":N,"itemId":N,"count":N,"slot":N,"equipped":N,"enchant":N}]}`
  — ItemList(0x1b), once right after enterWorld. `slot` = bodyPart.
- `{"op":"invUpdate","updated":[{"change":"add|modify|remove|unchanged","objectId":N,"itemId":N,"count":N,"slot":N,"equipped":N,"enchant":N}]}`
  — InventoryUpdate(0x27). change maps aCis ItemState ordinals
  (0 UNCHANGED, 1 ADDED, 2 MODIFIED, 3 REMOVED).
- `{"op":"addDrop","id":N,"itemId":N,"count":N,"x":N,"y":N,"z":N}` —
  SpawnItem(0x0b) / DropItem(0x0c): a lootable item on the ground.
- `{"op":"sysMsg","id":N,"params":[...]}` — SystemMessage(0x64), see above.

Client -> server:
- `{"op":"useSkill","skillId":N,"targetId":N?}` — RequestMagicSkillUse(0x2f),
  ctrl/shift false. The server casts on the CURRENT target; if `targetId` is
  given and differs, the bridge sends Action(0x04) first, then the skill
  400ms later. TARGET_SELF skills need no targetId.
- `{"op":"useItem","objectId":N}` — UseItem(0x14), ctrl false.

### Loot flow (verified live)

- This server has global **AutoLoot = True** (config/server.properties), so
  most kill loot goes straight to inventory: you only see `invUpdate` +
  `sysMsg` (earned item) events.
- With autoloot off (per-player `.autoloot` voice command toggles it), drops
  spawn on the ground as `addDrop`. **To loot manually: `{"op":"target","id":<dropId>}`**
  — Action on an ItemInstance walks the player there and picks it up
  (`PlayerAI.thinkPickUp`); pickup arrives as `remove` + `invUpdate`
  (add/modify) + `sysMsg`. There is no sweep packet in aCis 409.
- Gotcha: herb drops fire instant `skillCast` events (skills 2278-2284)
  when consumed on pickup — expected server behavior, not a parse bug.

### M4 packet notes

- SkillList(0x58): D count, per skill D passive, D level, D id, C disabled.
- MagicSkillUse(0x48): after caster xyz comes D success-flag; only when 1 an
  extra H follows, then target xyz — parse carefully.
- Item entry (ItemList/InventoryUpdate share layout after the leading Hs):
  H type1, D objectId, D itemId, D count, H type2, H custom1, H equipped,
  D bodyPart, H enchant, H custom2, D augmentation, D manaLeft.
- ItemList(0x1b) starts H showWindow, H count; InventoryUpdate(0x27) starts
  H count and each entry leads with H ItemState-ordinal.



## Frozen bridge contract (WS JSON)

Client -> server:
- `{"op":"login","deviceId":"<persistent browser id>"}`
- `{"op":"enterChar","slot":0}`
- `{"op":"moveTo","x":0,"y":0,"z":0}`
- `{"op":"say","channel":0,"text":".."}`
- `{"op":"destroyItem","objectId":0,"count":1}` — inventory TrashButton
  (aCis RequestDestroyItem 0x59, D objectId + D count)
- `{"op":"crystallizeItem","objectId":0,"count":1}` — inventory
  CrystallizeButton (aCis RequestCrystallizeItem 0x72, D objectId + D count)

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
RequestMagicSkillUse 0x2f, UseItem 0x14, ValidatePosition 0x48.
Game (S→C, decoded): VersionCheck 0x00, CharSelectInfo 0x13,
CharSelected 0x15, CharCreateOk 0x19, CharCreateFail 0x1a, UserInfo 0x04,
CharInfo 0x03, NpcInfo 0x16, MoveToLocation 0x01, DeleteObject 0x12,
CreatureSay 0x4a, TeleportToLocation 0x28, ValidateLocation 0x61,
Attack 0x05, Die 0x06, Revive 0x07, StatusUpdate 0x0e,
MyTargetSelected 0xa6, SystemMessage 0x64, SkillList 0x58,
MagicSkillUse 0x48, MagicSkillLaunched 0x76, ItemList 0x1b,
InventoryUpdate 0x27, SpawnItem 0x0b, DropItem 0x0c.

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
