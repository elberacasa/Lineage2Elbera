# Elbera — Handoff Document

Read this to continue the project with zero prior context. It describes the
repository **as it exists on 2026-07-25**, on macOS arm64 (Apple Silicon),
python3.9, node, OpenJDK 21. Everything below was verified against the live
repo on that date; where something was verified earlier and not re-run, the
date says so.

Product name: **Elbera** (development name: L2Vzla — paths, logs and older
docs still use it). Root: `/Users/alejandroberacasa/l2vzla`.

**Read order after this file:** `README.md` (product + toolchain) →
`docs/web-port-architecture.md` (master plan, milestones M1–M5) →
`gateway/README.md` (protocol contract + crypto gotchas) → the per-area
deep dives listed at the bottom.

---

## 1. What is running, and how to prove it

At handoff, the full stack was up with these listeners (PIDs vary; the loop
scripts auto-restart the Java processes):

| Component | Port | Process | Health check |
|---|---|---|---|
| MariaDB (Homebrew) | 3306 | `mariadbd` | `mariadb -u l2j -pl2jpass l2jdb -e "SELECT 1"` |
| aCis loginserver | 2106 (+9014 internal) | `java net.sf.l2j.loginserver.LoginServer` | `nc -z 127.0.0.1 2106` |
| aCis gameserver | 7777 | `java net.sf.l2j.gameserver.GameServer` | `nc -z 127.0.0.1 7777`; log shows `Loaded N voiced command handlers.` |
| ElberaGate (gateway) | 8090 | `node src/server.js` (cwd `gateway/`) | `cd gateway && node test/verify-one.js` → PASS |
| ElberaPanel | 8080 | `python3 panel/server.py` | `curl -s http://127.0.0.1:8080/api/status` |
| ElberaAssets | 8081 | `python3 editor/server.py` | `curl -s http://127.0.0.1:8081/api/config` |
| ElberaCreate | 8082 | `python3 editor/charcreate/server.py` | `curl -s http://127.0.0.1:8082/api/manifest` |
| ElberaClient | 8083 | `python3 editor/world/server.py` | `curl -s http://127.0.0.1:8083/scenes` → 100 tiles |
| (dev only) mock gateway | 8085 | `node editor/world/mock_gateway.js` | client offline-UI testing without aCis |

Database: `l2jdb` on `127.0.0.1:3306`, user `l2j` / password `l2jpass`
(also in `db-credentials.txt`), 65 tables. `AutoCreateAccounts = True`.

Verified live on 2026-07-28: all four web apps return 200; `/scenes`
returns 100 tiles; 100/100 tiles carry extracted geodata
(`assets/world/<tile>/geodata.json`); `gateway/test/verify-one.js` PASS;
l2lib test suite 24/24 OK; `tools/world/convert.py --check 17_23` OK;
glTF validation OK; ElberaForge `list` matches umodel; ElberaDat decrypts +
parses chargrp; ElberaUpscaler produces exact 4x output.

The full health check is one command — **`tools/battery.sh`** (38 suites:
22 client UI/world suites against the mock gateway, then 16 live-protocol
suites against the real aCis; `--client-only` / `--gateway-only` to run a
subset; exit 0 only if everything passes). Run it before claiming anything
still works. Budget time for it: the gateway half alone takes ~25–40 min —
`verify-shop` scripts a full walk from spawn to the TI town merchant and
needs ~9 min by itself.

---

## 2. Start / stop everything

### 2.1 Full bring-up (from nothing)

```bash
# Database
brew services start mariadb

# aCis — login first, then game. JAVA_HOME is mandatory.
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export PATH="$JAVA_HOME/bin:$PATH"
cd /Users/alejandroberacasa/l2vzla/server/aCis_gameserver/build/dist/login
./startLoginServer.sh &
cd /Users/alejandroberacasa/l2vzla/server/aCis_gameserver/build/dist/gameserver
./startGameServer.sh &

# Gateway (repo root as base)
cd /Users/alejandroberacasa/l2vzla/gateway && npm install && npm start &

# Web apps (cwd-independent; logs conventionally next to each app)
cd /Users/alejandroberacasa/l2vzla
nohup python3 panel/server.py              > panel/panel.log 2>&1 &
nohup python3 editor/server.py             > editor/editor.log 2>&1 &
nohup python3 editor/charcreate/server.py  > editor/charcreate/charcreate.log 2>&1 &
nohup python3 editor/world/server.py       > editor/world/world.log 2>&1 &
```

Notes:

- The `start*.sh` scripts launch `*_loop.sh` auto-restart loops; gameserver
  exit code 2 = scheduled reboot. Gameserver heap is `-Xmx2G` — do not lower.
- Gateway env overrides: `GATEWAY_PORT` (8090), `L2_LOGIN_HOST`,
  `L2_LOGIN_PORT` (2106), `L2_SERVER_ID` (1).
- Log locations: `dist/login/log/stdout.log`,
  `dist/gameserver/log/stdout.log` (rotated per restart), `gateway/gateway.log`,
  and the per-app logs above.

### 2.2 Shutdown

Kill the loop scripts **before** the Java processes or they respawn.
Gameserver before loginserver. Avoid `kill -9` (loses unsaved world state).

```bash
pkill -f GameServer_loop.sh;   pkill -f net.sf.l2j.gameserver.GameServer
pkill -f LoginServer_loop.sh;  pkill -f net.sf.l2j.loginserver.LoginServer
pkill -f "node src/server.js"          # gateway
pkill -f "panel/server.py"; pkill -f "editor/server.py"
pkill -f "charcreate/server.py"; pkill -f "world/server.py"
```

In-game alternative (GM char): `//server shutdown <seconds>` /
`//server restart <seconds>` / `//server abort`.

### 2.3 Docker alternative (ElberaDeploy)

```bash
cd deploy && docker compose up -d --build    # MariaDB + login + game
docker compose down -v                        # tears down INCLUDING the db volume
```

Verified 2026-07-23 (arm64): 65 tables, login on 2106, game on 7777,
registration OK. Not verified: amd64 build; a retail L2 client logging in
from outside the Docker network (needs `EXTERNAL_HOSTNAME`). Note the
host's local MariaDB occupies 3306 — the compose stack does not publish it.

---

## 3. Regeneration recipes (if generated assets are wiped)

Order matters: native tools → texture library → models/tiles → data tables.
Everything is re-runnable and idempotent.

```bash
# 0. Native binaries (only if tools/bin/ is missing; needs Xcode CLT + curl)
tools/build-tools.sh          # builds umodel, umodel-view, l2encdec, vendored SDL2

# 1. Texture library assets/library/ (per package, ~386 packages)
tools/bin/umodel -game=l2 -png -export -out="$(pwd)/assets/library" \
  assets/interlude/systextures/<Package>.utx
#    (-out MUST be absolute; output lands in <out>/<Package>/...)

# 2. Character models -> editor/characters/ (manifest merged, not clobbered)
/usr/bin/python3 tools/src/char_pipeline/build_characters.py        # all 14
#    then the HD pass (LQ backup + in-place 4x):
mkdir -p editor/characters/models_lq && cp editor/characters/models/*.png editor/characters/models_lq/
tools/upscale/bin/realesrgan-ncnn-vulkan -i editor/characters/models \
  -o /tmp/hd_out -s 4 -m tools/upscale/bin/models -f png && cp /tmp/hd_out/*.png editor/characters/models/

# 3. Monster/NPC models -> editor/characters/monsters/
/usr/bin/python3 tools/src/char_pipeline/build_monsters.py          # all 28

# 4. World tiles -> assets/world/<tile>/ (100 tiles)
python3 tools/world/convert.py 17_25 22_22           # single tiles...
tools/world/batch_convert.sh                          # ...or resumable full batch
python3 tools/maps/tilemap.py                         # regenerate assets/world/tile-map.json

# 5. Game-data tables -> assets/gamedata/*.json and charcreate data
python3 tools/dat/extract_gamedata.py
python3 tools/dat/extract_charcreate.py               # editor/characters/charcreate-data.json

# 6. Ground-truth reference renders (only if tools/reference/ is wiped)
python3 tools/src/ground_truth/render_ground_truth.py
```

If the aCis `build/dist/` tree is wiped (`ant clean` does this):

```bash
cd server && export JAVA_HOME=/opt/homebrew/opt/openjdk@21
(cd aCis_gameserver && ant) && (cd aCis_datapack && ant)
rsync -a aCis_datapack/build/gameserver/data/ aCis_gameserver/build/dist/gameserver/data/
cp aCis_gameserver/build/dist/gameserver/data/serverNames.xml \
   aCis_gameserver/build/dist/login/serverNames.xml
cp geodata-staging/geodata/*_conv.dat aCis_gameserver/build/dist/gameserver/data/geodata/
```

---

## 4. Frozen contracts — do not break these

### 4.1 Bridge WebSocket ops (browser ⇄ ElberaGate, JSON)

Client → server: `login{deviceId}` · `enterChar{slot}` · `moveTo{x,y,z}` ·
`say{channel,text,target?}` · `target{id}` · `attack{id}` · `useSkill{skillId,
targetId?}` · `useItem{objectId}` · `talk{id}` · `bypass{command}` ·
`action{actionId}` · `questAbort{id}` · `partyInvite{name}` ·
`partyAnswer{accept}` · `partyLeave{}` · `partyKick{name}` ·
`buy{items[{itemId,count}]}` · `sell{items[{objectId,count}]}` ·
`tradeRequest{name}` · `tradeAnswer{accept}` · `tradeAdd{objectId,count}` ·
`tradeDone{}` · `tradeCancel{}` · `storeManageSell{}` · `storeManageBuy{}` ·
`storeTitle{title}` · `storeSetSell{items[{objectId,count,price}],title?,
packageSale?}` · `storeSetBuy{items[{itemId,count,price}],title?}` ·
`storeStart{}` · `storeStop{}` · `storeBuy{storeId,items[{objectId,count}]}` ·
`storeSell{storeId,items[{objectId,count,price}]}` · `clanInvite{name}` ·
`clanAnswer{accept}` · `clanLeave{}` · `clanOust{name}` ·
`clanCrestRequest{id}`.

Actions (fixed 2026-07-27): `action{actionId}` takes actionname-e.dat UI
ids; SOCIAL-map keys are remapped to aCis social ids and sent via
RequestSocialAction (12→2 Greeting, 13→3 Victory, 14→4 Advance, 25→5 No,
24→6 Yes, 26→7 Bow, 29→8 Unaware, 30→9 Waiting, 31→10 Laugh, 33→11
Applaud, 34→12 Dance, 35→13 Sorrow); everything else goes verbatim to
RequestActionUse (0 Sit/Stand, 1 Walk/Run, 10/28/61 stores, manufactures).
Non-social actionname ids 2..13 (Attack 2, Exchange 3, ...) are NOT
socials — they hit RequestActionUse (aCis warns "Unhandled action type";
their real packets are AttackRequest/TradeRequest/party packets).
`/sit` via Say2 does nothing in aCis — RequestActionUse is canonical.


Server → client: `auth_ok{chars[]}` · `enterWorld{char{id,name,race,classId,
x,y,z,heading}}` (exactly once per session) · `addNpc{id,npcId,name,level,
x,y,z,heading}` · `addPlayer{id,name,race,classId,level,x,y,z,heading}` ·
`move{id,tx,ty,tz}` · `remove{id}` · `chat{from,channel,text,target?}` ·
`status{id,hp,maxHp,mp,maxMp}` · `selfStatus{hp,maxHp,mp,maxMp,cp,maxCp,
level,exp,sp}` · `charSheet{str,dex,con,int,wit,men,pAtk,pDef,mAtk,mDef,
accuracy,evasion,critical,runSpeed,walkSpeed,pAtkSpd,mAtkSpd,maxLoad}` ·
`attack{id,targetId,damage,critical,miss}` · `die{id}` ·
`revive{id}` · `target_ok{id,color}` · `skillList{skills[{id,level,passive,
disabled}]}` and
`itemList{items[{objectId,itemId,count,slot,equipped,enchant}]}` (both
queued and flushed right after `enterWorld`) · `skillCast{casterId,targetId,
skillId,level,hitTime}` · `skillLaunch{casterId,targetId,skillId,level}` ·
`invUpdate{updated[{change,objectId,itemId,count,slot,equipped,enchant}]}`
(change: add/modify/remove/unchanged) · `addDrop{id,itemId,count,x,y,z}` ·
`sysMsg{id,params[]}` · `npcHtml{html}` · `actionFailed{}` ·
`socialAction{id,actionId}` · `changeWait{id,waitType}` ·
`changeMove{id,running}` · `questList{quests[{id,name,progress}]}` ·
`partyAsk{from}` · `party{members[{id,name,classId,level,hp,maxHp,mp,
maxMp,leader}]}` · `partyMemberStatus{id,hp,maxHp,mp,maxMp}` ·
`buffs{effects[{skillId,level,duration}]}` ·
`skillCoolTime{skills[{id,level,reuse,remaining}]}` ·
`buyList{listId,money,items[{itemId,count,price}]}` ·
`sellList{money,items[{objectId,itemId,count,price,enchant}]}` ·
`tradeAsk{from}` · `tradeStart{partnerId,partner,items[]}` ·
`tradeOwn{items[{objectId,itemId,count}]}` ·
`tradeOther{items[{objectId,itemId,count}]}` · `tradeEnd{reason}` ·
`storeMsgSell{packageSale,adena,items[{objectId,itemId,count,enchant,price,
slot,storePrice}],sellables[...]}` · `storeMsgBuy{adena,items[{itemId,
enchant,count,price,slot,storePrice}],buyables[...]}` ·
`playerStore{id,type,title,adena,items[...]}` · `storeState{open,type?}` ·
`clanInfo{id,name,leaderName,level,crestId?,allyId?,allyName?}` (id 0 = no
clan) · `clanMembers{members[{id,name,level,classId,online}]}` (id = online
objectId, 0 when offline) · `clanAsk{from,clanName}` ·
`clanCrest{id,data}` (base64 DDS or null; optional).

Shops (added 2026-07-27): merchant dialog (`npc_<id>_Buy <listId>` /
`npc_<id>_Sell` bypasses, validated against the last html — talk first) →
`buyList`/`sellList` → `buy`/`sell` (merchant must be the current target
within 150, else the server silently drops it). A successful BUY answers
with a FULL `itemList` refresh (NOT invUpdate — the update queue is
cleared by ItemList); a SELL arrives as invUpdate + optional npcHtml.
TI castle tax 0% observed; sell-back = referencePrice/2. Multisell
(`npc_<id>_Newbie_Exc_Multisell`, opcode 0xd0) present on TI merchants,
not bridged.

Quests (added 2026-07-26): `questList` = QuestList(0x80, `H count` + per
quest `D questId, D flags`), queued after enterWorld like the other lists
and re-sent on every change (no separate update packet exists in this
rev). `name` comes from a gateway-side map mined from the aCis quest Java
sources — the client needs no datapack files. `progress` is the raw
QuestState flags dword: `((1 << cond) - 1) | 0x80000000` while started
(bit31 + cond mask; accept → 0x80000001 = -2147483647, cond 2 →
0x80000003 = -2147483645). The Tutorial chain (id -1, "feature") is
filtered by isRealQuest and never appears. `questAbort{id}` →
RequestQuestAbort(0x64). Accept/advance rides the normal dialog ops
(talk + `npc_<id>_Quest` + `Quest <Script> <event.htm>` bypasses).

Party (added 2026-07-27): `partyInvite{name}` → RequestJoinParty(0x29,
name-based, lootRule 0) · `partyAnswer{accept}` → 0x2a · `partyLeave{}` →
0x2b · `partyKick{name}` → 0x2c. Server side: `partyAsk{from}` (AskJoinParty
0x39) · `party{...}` full snapshot rebuilt on every PartySmallWindow
All/Add/Delete/DeleteAll (packets exclude the receiver; the bridge
re-inserts self — documented choice, no incremental ops) ·
`partyMemberStatus` on PartySmallWindowUpdate(0x52). Change-leader
(0xd0:4) not exposed.

Buffs & cooldowns (added 2026-07-27): `buffs` = AbnormalStatusUpdate
(0x7f) FULL SNAPSHOT of self effects each time (duration in SECONDS,
-1 = toggle) · `skillCoolTime` = SkillCoolTime(0xc1, reuse+remaining in
SECONDS) — sent by aCis ONLY at login/subclass/augment/item-skill equip,
never per cast, and only for reuses > 30s · per-cast cooldown rides the
additive `skillCast.reuse` field (MagicSkillUse reuseDelay, MILLISECONDS).
Applied reuse = skillReuse × 333/atkSpd unless staticReuse. `targetBuffs`
does not exist in this rev.

Trade (added 2026-07-27): `tradeRequest{name}` → TradeRequest(0x15,
**objectId-based** in this rev — the bridge resolves the name via its
visible-players map; server requires `knows(target)`, request expires 15s)
· `tradeAnswer{accept}` → AnswerTradeRequest(0x44, D 1/0) ·
`tradeAdd{objectId,count}` → AddTradeItem(0x16, D tradeId **read but
unused** — send 0, D objectId, D count) · `tradeDone{}` → TradeDone(0x17,
D 1) · `tradeCancel{}` → TradeDone(0x17, D 0, cancels for BOTH sides).
Server side: `tradeAsk{from}` (SendTradeRequest 0x5e, D senderId → name) ·
`tradeStart{partnerId,partner,items[]}` (TradeStart 0x1e, D partnerId +
H count + trade entries — items = own **tradable** inventory snapshot,
`getAvailableItems(allowAdena, !nonTradeable, !storeBuy)`) · `tradeOwn` /
`tradeOther` (TradeOwnAdd 0x20 / TradeOtherAdd 0x21, per-add, H count is
always 1 → forwarded as one-item lists) · `tradeEnd{reason}` (SendTradeDone
0x22: 1 done / 0 cancel). CONFIRM IS TWO-PHASE (TradeList.confirm): the
first `tradeDone` only marks that side (TradePressOwnOk 0x75 /
TradePressOtherOk 0x7c, both empty, decoded but log-only — NOT contract
ops); the exchange runs on the second confirm. REFUSE = only sysMsg 119
(S1_DENIED_TRADE_REQUEST) at the requestor, no tradeStart/tradeEnd. Cancel
= `tradeEnd{cancel}` at both, items never move. Done = `tradeEnd{done}` +
invUpdate on both sides. Quirk: starter equipment is is_tradable=false —
only the Tutorial Guide (5588) is tradable on a fresh char.
TradeItemUpdate/TradeUpdate (0x74) exists (trade-window inventory refresh,
leading H available-flag 2/3) but is not bridged. Live proof:
`gateway/test/verify-trade.js` PASS (refuse / cancel / two-phase done with
real item movement).

Private stores (added 2026-07-27): **SetPrivateStoreListSell(0x74) /
ListBuy(0x91) IS the store start** in aCis (sitDown + OperateType.SELL/BUY
+ broadcast) — `storeStart{}` is a documented no-op. `storeManageSell/Buy{}`
→ 0x73/0x90 · `storeTitle{title}` → 0x77/0x94 (set BEFORE the list: the
title survives TradeList.clear() and then rides the store-open broadcast;
the msg packet alone only echoes to the owner) · `storeStop{}` →
QuitSell(0x76)/QuitBuy(0x93), both just set OperateType.NONE ·
`storeBuy{storeId,items}` → RequestPrivateStoreBuy(0x79, price MUST match
the store price — bridge fills it from the last playerStore seen for that
storeId) · `storeSell{storeId,items}` → RequestPrivateStoreSell(0x96,
itemId/enchant resolved the same way). Server side: `storeMsgSell` /
`storeMsgBuy` (manage views 0x9a/0xb7, with additive sellables/buyables) ·
`playerStore{id,type,title,items}` (observer views 0x9b/0xb8; title folded
in from the 0x9c/0xb9 broadcast seen at store open) · `storeState{open,
type?}` derived from the UserInfo operateType field (transitions only;
covers sell-out auto-close). Quirks verified live: after a close the
player STAYS SITTING and re-listing is silently refused until a stand-up
(`action{actionId:0}`); a stopped store answers clicks with nothing and
buys fail silently; `.offline` accepts a sell store — the trader stays
visible and keeps serving playerStore views. Live proof:
`gateway/test/verify-store.js` PASS (manage/set/title, observer buy with
exact item+adena movement, stop, offline persistence).

Clan / pledge (added 2026-07-28): `clanInvite{name}` →
RequestJoinPledge(0x24, D targetId, D pledgeType — **objectId-based**,
resolved via the visible-players map like tradeRequest; no distance check)
· `clanAnswer{accept}` → 0x25 · `clanLeave{}` → 0x26 (leader CANNOT
withdraw; DaysBeforeJoinAClan = 1-day re-join penalty) · `clanOust{name}`
→ 0x27 (SP_DISMISS) · `clanCrestRequest{id}` → RequestPledgeCrest(0x68).
Server side: `clanInfo{...}` built from the PledgeShowMemberListAll(0x53)
header merged with PledgeShowInfoUpdate(0x88, no name/leader — merged
locally), queued after enterWorld (EnterWorld sends 0x53 BEFORE UserInfo)
and re-emitted on change; `clanInfo{id:0}` = left/ousted/dissolved ·
`clanMembers{...}` FULL snapshot rebuilt on 0x53/0x54/0x55/0x56/0x82 (same
choice as party; keyed by NAME — Delete is name-based and `id` is the
online objectId, 0 for offline members; `rank` unavailable — power grade
lives in PledgeReceivePowerInfo, not bridged) · `clanAsk{from,clanName}`
(AskJoinPledge 0x32) · `clanCrest{id,data}` (PledgeCrest 0x6c, raw DDS
bytes base64, null when empty — OPTIONAL). Sub-pledge lists
(pledgeType != 0), PledgeStatusChanged(0xcd) and JoinPledge(0x33) are
decoded but not contract ops. **Clan creation is real-dialog verified**:
talk to Grand Master Bitz (30026, TI village; **Roien is NOT in the Clan
feature script's talk list in this datapack**) → `npc_<obj>_Quest Clan` →
`Quest Clan 9000-02.htm` → `npc_<obj>_create_clan <Name>` (level ≥ 10,
name alphanumeric 2..16). Quirks verified live: **Appearing(0x30) must
answer every self teleport** or `_isTeleporting` makes denyAiAction reject
all interacts with a bare ActionFailed (bridge sends it automatically now);
**Request lock leak** — Request.onRequestResponse clears only the
responder, the inviter stays busy until the 15s REQUEST_TIMEOUT (re-invite
too soon = silent WAITING_FOR_ANOTHER_REPLY drop). Live proof:
`gateway/test/verify-clan.js` PASS (creation chain, invite/accept with
2-member snapshots both sides, leave, oust, crest decode).

NPC dialog (added 2026-07-26): `talk{id}` sends Action(0x04); aCis routes by
Creature.onAction — first Action only targets, second Action INTERACTS for
non-attackable NPCs (dialog opens) but ATTACKS for attackable ones
(isAttackableWithoutForceBy or ctrl). The bridge sends Action twice (400ms
apart) when `id` isn't the current target. Use `attack{id}` for monsters —
there is no packet-level talk-vs-attack distinction, aCis decides by
attackability. `bypass{command}` forwards the raw string to
RequestBypassToServer(0x21): dialog hrefs arrive as `bypass -h <cmd>`
(e.g. `npc_<objectId>_Quest`) and the `.menu` buttons as
`bypass voiced_<cmd>` — send `<cmd>` verbatim. `npcHtml{html}` is the full
NpcHtmlMessage(0x0f) body (villager dialogs, `.menu`, teleporters, shops).
`actionFailed{}` = ActionFailed(0x25).

Level semantics (added 2026-07-26, additive): aCis 409's NpcInfo/CharInfo
packets carry NO level field — `addNpc.level` comes from the datapack NPC
template (same XML NpcData loads; "Lv N" title prefix wins if ShowNpcLevel
is ever enabled) · `addPlayer.level` is `null` (unavailable in-protocol) ·
`target_ok.color` is the aCis MyTargetSelected color = viewer level −
target level for attackable targets (retail con-color basis), 0 otherwise.

Loot: no dedicated op — `target{id}` on a corpse or drop sends Action(0x04),
which aCis routes to pickup (`.autoloot` mod bypasses this server-side).
`SystemMessage` IS in the contract as `sysMsg`.
Skill/item display metadata: `assets/gamedata/skillmeta.json` (2,694),
`itemmeta.json` (9,238), icons `assets/gamedata/icons/` (2,777) — generator
`tools/dat/build_meta.py --check` must pass (11,901 refs, 0 missing).
Full field semantics and packet ids: `gateway/README.md`.

### 4.2 `assets/world/<tile>/scene.json`

Shape and world mapping in `tools/world/README.md` (FROZEN section):
`tile, origin[3], gridSize 256, spacing 128, heightScale 0.296875,
heightmap, heights, layers[{name,diffuse,splat}], water, props[{mesh,gltf,
position,rotation,scale}]`. `rotation` is the raw UE2 Rotator (65536 =
360°); UE2 units = glTF units; handedness conversion is the client's job.
Validate: `python3 tools/world/convert.py --check <tile>`.

### 4.3 Model manifests

`editor/characters/manifest.json` — `{"models":[{id,race,gender,className,
gltf,animations[]}]}` (14 entries; glTF + external .bin + PNGs per part).
`editor/characters/monsters/manifest.json` — `{"models":[{id,gltf,
animations[]}]}` (28 entries; ids MUST stay the exact mesh object names,
e.g. `gremlin_m00` — the client maps npcId → mesh name → manifest id).
Animation clips are keyword-matched by the client: characters ship
idle/walk/run/sit/dance/attack; monsters add die/corpse/special.

### 4.4 Other frozen data

`editor/characters/charcreate-data.json` (schema in
`docs/dat-format-notes.md` §8), `assets/world/tile-map.json` (world
transform in `docs/tile-map.md`), `assets/gamedata/*.json` (schemas in
`docs/dat-format-notes.md` Part II), `assets/library/manifest.json`.

---

## 5. Known gotchas (each one cost real time — respect them)

### Protocol / crypto (details: gateway/README.md)

- **aCis `writeF` is a DOUBLE (8 bytes), not a float.** Parsers written
  from retail L2J docs desync mid-packet (CharSelectInfo, UserInfo,
  CharInfo, NpcInfo).
- **Login Init XOR pass is only invertible BACKWARDS** (`decXORPass` walks
  from the tail; no forward inverse exists).
- **RSA modulus is scrambled** — unscramble applying the 4 steps in
  reverse; auth block is raw RSA of a 128-byte buffer (login @0x5E,
  password @0x6C).
- **Game crypt is an XOR stream, not Blowfish**; first packet each
  direction goes plaintext; key bytes 8–11 are a LE size counter.
- **Hardcoded anti-flood on both servers** (`IPv4Filter`): >3 rapid
  connections/s from one IP → silent reject + 300 s ban that every retry
  refreshes. All outbound L2 connections go through the 400 ms governor
  (`gateway/src/governor.js`). Never bypass it in tests.
- **Movement needs `moveMovement = 1`** (mouse); keyboard movement is
  rejected with ActionFailed. Server pathing adjusts destinations slightly —
  the broadcast `MoveToLocation` target is authoritative (tests allow ±30).
- **Heading**: `atan2(dy,dx) * 65536 / (2π)` mod 65536 (CCW from +X).
- **Indoor z is geodata z** — clamp entities with
  `max(terrainHeight, serverZ)` or they sink under building floors.
- aCis renames retail packets (MoveBackwardToLocation, CharSelectInfo,
  CreatureSay...). **Read the aCis source, never the wiki.**

### File formats

- **FCompactIndex**: first byte bit7=sign, **bit6**=continue; continuation
  bytes **bit7**=continue. Getting this wrong desyncs every table.
- **`_sp` textures are DXT3 with diffuse in RGB + specular mask in alpha.**
  The `assets/library/` `_sp` exports show the near-black mask — never bind
  them as baseColor; decode the diffuse RGB with l2lib instead.
- **Protocol 121 XOR key derives from the file name** — never rename
  encrypted `.utx` files.
- **`umodel -out` needs an absolute path** (relative resolves against $HOME).
- `.dat` UNICODE lengths are byte counts, NOT NUL-terminated; files end
  with the `\x0cSafePackage\x00` trailer.
- umodel cannot export G16 heightmaps — decode them with l2lib
  (`00 40 80 10` marker).

### Rendering / models

- glTF materials are **doubleSided** on purpose (hair/foliage use alphaMode
  MASK, cutoff 0.5) — single-sided culling produces invisible faces.
- The charcreate app light rig renders every model **dark navy** (physical
  light units) — it is an app lighting matter, verified independent of the
  model files; do not "fix" the textures.
- **Face shells were re-anchored to the head bone** (retail weights them to
  the root; any lean opens a neck gap). Deliberate deviation — do not
  "restore retail".
- Any app-side `FACING_FIX` table must be re-measured against current
  builds; never carry old values across pipeline changes.
- `.psa` `Time` fields are garbage (all 1.0) — frame times come from
  `AnimRate`.
- Elf/darkelf/dwarf mystics looking identical to fighters is a **retail
  fact** (chargrp has 14 records), not a bug.
- Dungeon tiles 19_16/21_25: all props are below the flat terrain plane —
  correct conversion; the client needs an interior mode, not a converter fix.

### Repo / process hygiene

- **Manifest files are shared, append-merged state** (`editor/characters/
  manifest.json`, `monsters/manifest.json`). Builders merge single-id
  rebuilds idempotently. **Never revert or regenerate them wholesale**
  (you would destroy other models' entries), never hand-edit, and do not
  run two builders concurrently — mid-write races corrupt the JSON.
  Serialize rebuilds; if corrupted, rebuild ids one at a time.
- **Config source of truth is `server/aCis_gameserver/config/`**; dist
  configs are ant-generated copies. Edit source, sync to dist, restart
  (aCis does not hot-reload). `ant clean` wipes `build/dist` — after every
  rebuild re-merge datapack data, serverNames.xml and geodata (§3).
- Parallel agents work in this repo — before overwriting generated files,
  check mtimes; prefer merging over replacing.
- Killing only the Java process respawns it (loop scripts) — §2.2.

---

## 6. Prioritized next tasks

Completed since M4/M5 (details in `git log 3360733..HEAD` and the per-area
READMEs): skills & items with weapon gates and casting polish; chat, char
sheet, hotbar; 55 civilian NPC models (97 total); dungeon interiors with
prop torch lights; the retail-UI port (ElberaSkin — 16 windows at mined
geometry, no-guess audit at 0); NPC dialogs with live `.menu` round-trip;
quests + journal; party; buffs/cooldowns; shop/trade/private stores incl.
the offline-store mod; minimap with retail georeference; geodata heights
(100/100 tiles); water planes; terrain splat blending; HD pilot (17_25 +
22_22, 1,268 textures, `?hd=1`); mods play-tested 8/8 by protocol
(`verify-mods`); clan/pledge protocol (creation through the real
VillageMaster dialog chain, invite/accept, leave, oust, crest —
`verify-clan` PASS, client window shelved by product decision).

The real remaining backlog, in order:

1. ~~Full world-texture HD pass~~ — **DONE 2026-07-28**: 21,589/21,589
   textures at 4x in `assets/world-hd/` (51 GB, gitignored), zero failures.
   `tools/upscale/batch_world.sh` re-runs it idempotently (missing-only).
   The earlier wholesale failure was the xargs trailing `_` placeholder
   dropped — pinned in the script header.
2. **Multisell bridging.** TI merchants genuinely use it (newbie equipment
   exchange; MultiSellList is opcode 0xd0 — notes in gateway/README.md);
   not bridged, so those merchant options are dead ends in the web client.
3. **Warehouse + craft/recipes.** Protocol not started.
4. **Clan window (shelved, ready to resume).** Only the client UI is
   missing; the gateway contract ops are done and live-verified.
5. **Server ops backlog** (`docs/README-ADMIN.md` §8): rate balancing after
   playtest, backup automation, VPS migration (§7 of that doc — ports,
   hostnames, player patch, guide placeholders).
6. **Later**: Seven Signs catacomb tiles (16_12/18_10/19_10/20_10), KTX2
   compression, WebGPU eval, mobile layout.

Verification discipline for anything new: protocol claims need a live
`gateway/test/verify-*.js`-style PASS; visual claims need a headless-Chrome
screenshot inspected with ReadMediaFile; binary-format claims need a
byte-level cross-check against umodel/l2encdec. UI geometry claims must
keep `python3 tools/ui/audit_guesses.py --check` at 0 unjustified. The full
gate is `tools/battery.sh`. This is the house rule — follow it.

---

## 7. Key locations

| What | Where |
|---|---|
| Master plan + milestones | `docs/web-port-architecture.md` |
| **Mined game data (reviewed) — start here for values** | **`docs/research-index.md`** |
| **UI port — continue from zero context** | **`docs/ui-port-handoff.md`** |
| How the client's UI is built (3 layers, RE method) | `docs/ui-reverse-engineering.md` |
| `Interface.xdat` layout file, byte level | `docs/xdat-format.md` |
| Protocol contract + crypto gotchas | `gateway/README.md` |
| scene.json contract | `tools/world/README.md` |
| Model pipeline + output contract | `docs/character-pipeline.md`, `docs/monster-pipeline.md` |
| .unr/map format lore | `docs/map-format.md`, `docs/tile-map.md` |
| .dat schemas | `docs/dat-format-notes.md` |
| Ground-truth oracle | `docs/ground-truth.md` |
| Format library (use this for new parsers) | `tools/l2lib/` (+ its README, tests) |
| Server build + custom mods | `server/BUILD-NOTES.md` |
| Ops runbook (ES) | `docs/README-ADMIN.md`, player guide `docs/GUIA-JUGADORES.md` |
| aCis packet sources (the real spec) | `server/aCis_gameserver/java/net/sf/l2j/gameserver/network/{server,client}packets/` |
| Headless verification harnesses | `gateway/test/`, `editor/world/verify_*.js`, `editor/charcreate/verify_app.js`, `tools/src/char_pipeline/render_check.js` |
