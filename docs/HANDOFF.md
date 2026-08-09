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

Verified live on 2026-07-29: `verify_clanwnd.js` 17/17 (mock);
`verify_clanwnd_live.js` 11/11 against real aCis (real Bitz creation chain,
Invite button, accept, oust through the window); `verify-clan.js` PASS;
`mine_classicons.py --check` PASS; `audit_guesses.py --check` 161 literals
/ 0 unjustified; all 100 tiles reconverted after the actor-parser fix
(0 failures — `tools/world/reconvert.log`); `verify_ground` unchanged
(13 pre-existing borderline cells, same before and after the terrain fixes).

The full health check is one command — **`tools/battery.sh`**. As of
2026-08-08 it runs **108 suites in four sections**, and the section it runs
is chosen by flag:

| flag | sections | needs |
|---|---|---|
| *(none)* | mock + solo + gw + live | everything: dev server, gateway, aCis, MariaDB |
| `--client-only` | mock + solo | dev server on 8083 only |
| `--mock-only` | mock (35) | 8083 + the mocks the script starts itself |
| `--solo-only` | solo (26) | 8083 only |
| `--gateway-only` | gw (30) | aCis + gateway |
| `--live-only` | live (17) | aCis + gateway + 8083 |
| `--no-live` | mock + solo + gw | as above, minus the long browser-vs-real-server suites |

Exit 0 only if every suite that ran passed. Run it before claiming anything
still works. Budget time: the gateway half alone takes ~25–40 min —
`verify-shop` scripts a full walk from spawn to the TI town merchant and
needs ~9 min by itself. Per-suite output lands in
`/tmp/elbera_battery/<suite>.log` (override with `BATTERY_LOGDIR`); a FAIL
row prints its log path.

Two flags exist because of specific failures, and both are cheap:

- **`tools/battery.sh --list`** prints the suite table plus the deliberate
  exclusions, and **exits nonzero** if any script on disk is in neither list,
  or if any table row names a file that does not exist. Coverage rotted
  silently once (53 of 111 scripts were named); this is what stops it.
- **`tools/battery.sh --selftest`** proves the harness itself, in ~20 s: that
  a hanging suite is killed at its deadline and reported as a TIMEOUT failure,
  that the reason is written into the suite's log, that a `mock_gateway.js`
  port collision exits 98 with a diagnosis instead of dying silently, and that
  `--list` is clean. It FAILS on the pre-2026-08-08 tree.

**Every suite runs under a hard deadline** (the per-suite `LIMIT` column in
`--list`; `BATTERY_TIMEOUT` overrides all of them). This is not a nicety: in
the sweep before this one two suites sat at 0.0% CPU for 7 and 36 minutes and
the whole run produced **no table at all**. A blown deadline is now a FAIL row
reading `TIMEOUT (>Ns)`, the suite is killed (along with any orphaned headless
Chrome), and the sweep continues. Timeouts are never retried — retrying a hang
only doubles it.

**What the battery still does not cover**, stated so a green run is not
over-read:

- `verify_loadprofile` — an instrument, not a suite; it prints a profile and
  has no pass/fail of its own beyond `--check` against a baseline. Results
  and method: **`docs/load-profile.md`**. Headline, measured 2026-08-09 on
  Giran: cold `worldReady` **15.4 s**, warm **15.8 s** — a fully primed cache
  does NOT make it faster, so network transfer is not the critical path.
  The client's own JS is under 200 ms of that (glTF parse 102 ms, BSP build
  5 ms, terrain+prop instancing 17 ms); `bspfloor.bin`'s new walk raster is
  1 request / 9 ms / 0.9% of bytes, and HTTP/1.0's connection-per-asset is
  worth ~1.7 s serial (~290 ms over six sockets). The per-PHASE breakdown is
  a documented gap: the instrumented reload times out at 900 s.
- `verify_hd_closeup` — an A/B screenshot generator that needs a human eye.
- `verify_skillcast` — needs a SECOND gateway on `:8096`
  (`GATEWAY_PORT=8096 node gateway/src/server.js`); nothing spawns it yet.
- `verify_app` and `verify_terrain` are IN the battery but assert nothing (see
  §5) — they are smoke, not verification.

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
`multisellChoose{listId,entryId,count}` ·
`whDepositItems{items[{objectId,count}]}` ·
`whWithdrawItems{items[{objectId,count}]}` ·
`tradeRequest{name}` · `tradeAnswer{accept}` · `tradeAdd{objectId,count}` ·
`tradeDone{}` · `tradeCancel{}` · `storeManageSell{}` · `storeManageBuy{}` ·
`storeTitle{title}` · `storeSetSell{items[{objectId,count,price}],title?,
packageSale?}` · `storeSetBuy{items[{itemId,count,price}],title?}` ·
`storeStart{}` · `storeStop{}` · `storeBuy{storeId,items[{objectId,count}]}` ·
`storeSell{storeId,items[{objectId,count,price}]}` · `clanInvite{name}` ·
`clanAnswer{accept}` · `clanLeave{}` · `clanOust{name}` ·
`clanCrestRequest{id}` ·
`createChar{name,race,sex,classId,hairStyle,hairColor,face}` (added
2026-08-02; classId authoritative — race derived from it, 9 base classIds;
`login{deviceId,noAutoCreate?}` — the flag suppresses the legacy Human
Fighter auto-create per session, env `GATEWAY_AUTOCREATE` still defaults
ON for the legacy suites) · `respawn{}` (added 2026-08-02; RequestRestartPoint
type 0 = to village; guarded by server-tracked dead state).

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


Server → client: `auth_ok{chars[]}` (entries carry slot,name,race,classId
plus, since 2026-08-02, sex,level,hairStyle,hairColor,face) ·
`charCreateOk{}` / `charCreateFail{reason,code?}` (2026-08-02; reason is a
string — server codes mapped, or gateway-side `invalid_<field>` with no
code) · `enterWorld{char{id,name,race,classId,
x,y,z,heading}}` (exactly once per session) · `addNpc{id,npcId,name,level,
x,y,z,heading}` · `addPlayer{id,name,race,classId,level,x,y,z,heading}` ·
`move{id,tx,ty,tz}` · `remove{id}` · `chat{from,channel,text,target?}` ·
`status{id,hp,maxHp,mp,maxMp}` · `selfStatus{hp,maxHp,mp,maxMp,cp,maxCp,
level,exp,sp}` · `charSheet{str,dex,con,int,wit,men,pAtk,pDef,mAtk,mDef,
accuracy,evasion,critical,runSpeed,walkSpeed,pAtkSpd,mAtkSpd,maxLoad}` ·
`attack{id,targetId,damage,critical,miss}` · `die{id}` (self death also
carries `canRespawn` since 2026-08-02 — the aCis Die packet's toVillage
flag, parsed not discarded) ·
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
`multisellList{listId,items[{entryId,products[{itemId,count,enchant}],
ingredients[{itemId,count,enchant}]}]}` (pages merged, one op per full
list; entryId is 1-based into the server-side prepared list) ·
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
`clanCrest{id,data}` (base64 DDS or null; optional) ·
`whDeposit{whType,adena,items[{objectId,itemId,count,enchant}]}` ·
`whWithdraw{whType,adena,items[{objectId,itemId,count,enchant}]}`.

Shops (added 2026-07-27): merchant dialog (`npc_<id>_Buy <listId>` /
`npc_<id>_Sell` bypasses, validated against the last html — talk first) →
`buyList`/`sellList` → `buy`/`sell` (merchant must be the current target
within 150, else the server silently drops it). A successful BUY answers
with a FULL `itemList` refresh (NOT invUpdate — the update queue is
cleared by ItemList); a SELL arrives as invUpdate + optional npcHtml.
TI castle tax 0% observed; sell-back = referencePrice/2. Multisell
(`npc_<id>_Newbie_Exc_Multisell 003` on TI merchants →
`multisellList`/`multisellChoose`, MultiSellList 0xd0 / MultiSellChoose
0xa7) is bridged (2026-07-28, see gateway README M15). Newbie_ lists
require char level 6..25 (Player.isNewbie) and are inventory-filtered:
only entries whose ingredient you already own are listed.

Warehouse (added 2026-07-28, M16): keeper dialog (`npc_<id>_DepositP` /
`npc_<id>_WithdrawP` private, `npc_<id>_DepositC` / `npc_<id>_WithdrawC`
clan bypasses — talk first, the bypass sets the ACTIVE warehouse) →
`whDeposit` / `whWithdraw` (WarehouseDepositList 0x41 / WarehouseWithdraw
List 0x42, identical layout: `H whType, D playerAdena, H count`, per item
`H type1, D objectId, D itemId, D count, H type2, H custom1, D bodyPart,
H enchant, H custom2, H 0, D objectId(dup), Q augmentation`; whType 1
private / 2 clan / 3 castle / 4 freight; adena = the PLAYER's current
adena) → `whDepositItems` (SendWarehouseDepositList 0x31) /
`whWithdrawItems` (SendWarehouseWithdrawList 0x32), both `D count` + per
item `D objectId, D count` (aCis names them SendWarehouse*, not
RequestWareHouse*). ADENA IS A NORMAL ENTRY (itemId 57) — no special
packet; deposit fee = 30 adena PER ENTRY charged server-side (item + adena
= 60a), and the fee is computed AFTER subtracting the deposited adena.
DepositP temp-disables the inventory for 1.5s (Player.tempInventoryDisable)
— wait ~2s or the deposit is silently dropped. WithdrawP on an empty
warehouse sends only sysMsg NO_ITEM_DEPOSITED_IN_WH (no 0x42). Both
directions answer with invUpdate, not ItemList. objectIds are NOT preserved
for stackables (the deposited adena re-appeared under a new objectId — take
ids from the list you answer). Verified live
(verify-warehouse.js, Wilford 30005 TI): seeded 5000a → deposit 5588 x1 +
500a → adena 4440 → whWithdraw shows both → withdraw back → adena 4940
(fee not refunded) → fresh DepositP list confirms exact restore.

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
`docs/dat-format-notes.md` Part II), `assets/library/manifest.json`,
`assets/gamedata/classicons.json` (tier-5 mined GetClassIconName table —
regenerate with `tools/ui/mine_classicons.py`, guard `--check`).

---

## 5. Known gotchas (each one cost real time — respect them)

> **Read this section as evidence, not as scripture.**
>
> The goal is a 1:1 replica: every value decoded from the binary, the server
> data, or a umodel cross-check. Nothing below is exempt from that, including
> the entries that sound most settled. Several claims in this repository —
> in this file, in `docs/monster-pipeline.md`, in `docs/skillfx-data.md`, in
> the README, and in code comments — turned out to be false when someone
> finally checked, and each had been quietly steering work for months:
>
> | claim | what checking found |
> |---|---|
> | "the unmodified game server" (README) | the server carries our own protocol mods |
> | "town floors are dirt, a retail fact" (below) | the pavement is BSP geometry, buried by our own terrain correction |
> | "the mesh→animation binding is not in this repo" (monster pipeline) | it is a `USkeletalMesh::Animation` reference inside the `.ukx` — 42 creatures were animated from the wrong data, some from a different animal |
> | "`AttachOn` was not recovered" (skill fx) | the ordinals are in `Engine.u`'s enum export |
> | "umodel cannot export VertMesh" (skill fx) | it can; only a `.3d` decoder is missing |
> | "all converted outputs are gitignored" (README) | the decoded `.dat` tables are tracked |
> | the audit's own roll-sign spec for props | an exhaustive sign search found no match for it |
> | "the renderer is losing props" | the renderer never lost one — `tools/world/convert.py` had never *read* 6,782 of them (below) |
> | "this prop is missing — the raycast proves it" | the ray was fired at an actor **origin that lies outside its own mesh** (below) |
> | "curLoad is not forwarded yet" (`js/ui/inventorywnd.js`) | it is — `bridge.js:794` puts it on the charSheet op; comment corrected 2026-08-08 |
> | verify_m5 / verify_targetwnd "passing" | neither suite asserted anything; both printed a summary and exited 0 regardless (fixed 2026-08-08) |
> | "alpha is not coverage" (`js/ui/font.js`) | it is. The old comment measured something real — `LargeFont-e`'s alpha field really does sit at 34 rather than 0 — and inferred from it that alpha could not be coverage *anywhere*. Coverage was taken as `max(R,G,B)` instead, which is 255 only on the white glyph core and 0 on every dark outline step, so the retail font's built-in outline was thrown away: 78.1% of retail coverage mass survived for SmallFont and **26.8%** for LargeFont (`verify_text.js` gate B) |
> | "the battery covers the suites" (`tools/battery.sh`) | it named 53 of the 111 verification scripts on disk. 58 — including **every** `*_live` browser suite, `verify_props`, `verify_feet`, `verify_walksurface`, `verify_bsp`, `verify_pathfinding`, `gateway/test/verify-movement` — were never executed by it (fixed 2026-08-08; `tools/battery.sh --list` now exits nonzero if any script on disk is in neither the run table nor the explicit excluded list, **and** if any table row points at a file that does not exist — one did) |
> | two suites in the battery "passing" | `verify_app` and `verify_terrain` contain no assertion and never call `process.exit` with a failure code. They are screenshot/report generators; in the battery they could only fail by throwing. Left in (they still catch hard breakage via unhandled rejection) but they are **smoke, not verification** |
> | "verify_targetwnd cannot pass while a battery holds 8085/8086" (commit a8d0d9b's message, repeated into this wave's brief) | true when written, false now: the suite leases ephemeral ports from the OS and spawns its own mocks. Only its file header still said 8085/8086. **A commit message is a snapshot, not a standing fact** |
> | "verify_m5 fails with `Cannot read properties of undefined (reading 'click')`" | verify_m5 passes 12/12 standalone against a fresh mock on 8085. The throw is a *symptom of a mock collision*, not a bug in the suite: with the old `mock_gateway.js` a second bind died silently, the page then talked to a mock in another state, ChatWnd's tab strip never came up, and `.find(...).click()` threw on `undefined` |
> | "HANDOFF describes bspfloor.bin's old single-section format" (this wave's brief) | HANDOFF never described `bspfloor.bin` at all. The contract lives in `tools/world/README.md`, and what was stale there was its **size** claim, not its layout |
> | "`special_is_wait_not_spatk` counts FIXED creatures, not broken ones" (this wave's brief) | Half right, and the half it missed is the point. The metric was **blind**, not merely inverted: it tested `retail has a spatk` AND `a distinct 'special' clip shipped` — never *what was in the clip*. `audit_bindings.py --selftest` seeds the exact regression the name describes (special ← a wait pose) and the old expression reads **196 before and 196 after**; the replacement goes **0 → 78**. Of the 196 it last reported, **194 served `spatk01`** — correct creatures. Renamed to `special_serves_wait_not_cast` and judged against the client's own `MagicShotAnimName`, not a name convention (2026-08-09) |
> | the audit's own `dropped_by_slot` — "6 creatures dropped their run clip, 2 their attack clip" | An **artefact of comparing slot NAMES to glTF clip names**. `audit_bindings.py` never opened the manifest's `clips` map, which records which retail sequence each shipped clip carries. retail names the SAME sequence for two slots on these creatures (`portrait_spirit`'s `WalkAnimName` **is** `run`), so the extractor emits it once and `mapAnimations`' run→walk chain plays the right motion. Corrected counts: dropped run **0**, attack **0**, and **4** creatures — all static props — genuinely lose a clip. The data was on disk the whole time (2026-08-09) |
> | "the mock on :8085 DIED mid-run" (`tools/battery.sh`'s own banner, and the 2026-08-08 note behind it) | **False alarm, measured mid-battery 2026-08-09.** The respawn exited 98 with "port 8085 is already in use", which *proves* the original was listening; `ps` showed all three mock PIDs still carrying the battery's own start time, never restarted; the suite that ran under the warning passed. One refused `nc -z` is not death. `check_mocks` now probes 3× and checks for the **process** before restarting, and says "slow accept" rather than "DIED" when the process is alive. The 2026-08-08 claim that "something outside this script killed the 8086/8087 mocks" was most likely this same misfire — no process was ever shown to have exited |
> | "verify_anim's baseline is stale" (this wave's brief) | True, but it was only **two of three** causes. The third: the drift check used `JSON.stringify`, which is **key-order sensitive**, and the baseline has two writers that disagree — `audit_bindings.py --check` writes it `sort_keys=True`, `verify_anim.js` writes it in insertion order. Regenerating from the Python side made every nested count "drift" with **identical numbers on both sides**. Fixed with an order-independent serialiser (2026-08-09) |
> | "register verify_ghostnpc, verify_steps, verify_emotes, verify_text, verify_sky, verify_walksurface" (this wave's brief) | **Five of the six were already registered.** Only `verify_ghostnpc` was unclassified. It belongs in `live`, not `mock`: it spawns its OWN mock on 8087 and refuses to start if the port is bound, and the shared mocks hold 8087 for the whole mock section |
> | "verify-clan waits for a `move` op that is now `teleport`" (this wave's brief) | Already fixed. `gateway/test/verify-clan.js:58-63` handles **both** ops and carries the comment explaining the a8d0d9b split |
>
> The pattern in almost every case was the same and is worth naming: a
> **correct measurement** followed by an **unexamined inference**, written up
> as a single confident fact. The measurement survives; the inference does
> not; and once they are welded into one sentence nobody re-checks either.
>
> So when you write here: state what you measured and where, keep what you
> think it implies in a separate sentence labelled as inference, and say what
> would falsify it. When you read here: if an entry tells you NOT to fix
> something, treat that as the highest-value thing to re-verify — that is
> exactly the shape the town-floor entry had.

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
- **`Engine.dll` is THEMIDA-PACKED — do not try to disassemble it.** Its code
  is ciphertext at rest. Re-verified 2026-08-09 with
  `python3 tools/ui/mine_nameplate.py --check`, which is the standing gate:
  - the PE carries a section literally named **`Themida`**, and **no** section
    flagged TEXT;
  - **`objdump -d` emits 0 instructions for the entire file** — not few, zero;
  - all **10,083** exports resolve into a ~45 KB stub (the 5 nameplate exports
    span **44,935 bytes** of address space), so an export address tells you
    nothing about where the code is;
  - the control: `objdump -d` on **`NWindow.dll`** emits **27** instructions
    over one known paint routine, proving the toolchain works on a plain PE.
  - Entropy is NOT the test (6.56 vs 6.25 bits/byte for NWindow's `.text` —
    too close to conclude anything). The `Themida` section name plus the zero
    instruction count is the test.
  - **Export NAMES are still legitimate evidence** and have been mined
    successfully (`DrawTargetName`, `GetNameColor`, …). **NWindow.dll is
    readable** and has been mined. Only Engine.dll's *code* is unavailable.
  - `mine_nameplate.py --check` FAILS if objdump ever finds an instruction or
    the `Themida` section disappears, so the day this stops being true, the
    documented gaps in `editor/world/js/nameplates.js` get reopened
    automatically instead of staying closed on a stale claim.
- **`assets/world/<tile>/bspfloor.bin` has TWO sections, not one.** Anything
  that reads section 1 and stops is reading ~6% of the file. Written by
  `tools/world/bspfloor.py` (`--check` re-derives and compares byte for byte);
  full contract in `tools/world/README.md`.
  - **Section 1 `BSPF`** — the 128-unit terrain-vertex raster: `u32` magic,
    `u16 gridSize` (256), `u16 maxLayers`, `i32 originX, originY`,
    `i32 spacing` (128), then `gridSize²` records of `u8 count` +
    `count × i16` floor Z, row-major with `gx` fastest (heightmap.u16 order).
  - **Section 2 `WALK`** (added 2026-08-08) — the 16-unit walk raster, present
    only when the tile has geodata: `u32` magic, `i32 fineSpacing` (16),
    `u16 fineCells`, `u16 blockCells` (8), then `(fineCells/blockCells)²`
    block records, `bx` fastest: `u8 type` — 0 EMPTY, 1 UNIFORM
    (`u8 count`, `count × i16`), 2 CELLS (64 × `u8 count`, `count × i16`,
    cell index `(cy%8)*8 + (cx%8)`). A fine cell **is** the geodata cell
    (same origin, `floor()` indexing) and its height is the cell CENTRE.
  - **Measured cost of section 2** (this tree, 100 tiles, `du` on the shipped
    files): the set is **126.5 MiB**, mean **1,295 KiB**/tile, min 128 KiB
    (17_24), max 4,449 KiB (23_18). On Giran 22_22 the file is 1,411,751 B of
    which section 1 is **77,818 B** and section 2 is **1,333,933 B** — an
    **18.1×** growth for that tile. `tools/world/README.md` still carried the
    pre-WALK figures ("~83 KB average, 8.3 MB for the set"); corrected
    2026-08-08. Whether the client should be fetching all of it per tile is
    an open question, not a settled one — see the load profile.

### Rendering / models

- **CHARACTER/monster/weapon** glTF materials are **doubleSided** on purpose
  (hair/foliage use alphaMode MASK, cutoff 0.5) — single-sided culling
  produces invisible faces. This does **not** apply to world props any more:
  since 2026-08-08 `tools/world/convert.py` sets each prop material's
  `alphaMode`/`alphaCutoff`/`doubleSided` from the **retail UE2 material**
  (Shader `AlphaTest`/`AlphaRef`/`OutputBlending`/`TwoSided`, or Texture
  `bMasked`/`bAlphaTexture`/`bTwoSided`) and `Terrain._prepMaterials` no
  longer overrides it. Guessing MASK 0.5 there cut 209 surfaces / 1,131
  placements away completely. See `docs/foundation-audit.md` F3.
- **World prop glTFs are in the proper (x, z, -y) det +1 basis**, not
  umodel's raw det -1 export: `convert.py gltf_to_proper_basis()` negates
  z/tangent-w and reverses the winding, and `Terrain.ueQuaternion` uses
  `yaw +, pitch +, roll -` to match. Re-exporting a prop package with plain
  umodel and dropping it in will render mirrored. Gate:
  `tools/src/char_pipeline/audit_prop_basis.py --check`. Derivation:
  `docs/world-prop-basis.md`.
- **`scene.json` `scale` is in L2 axis order**; the client must apply it as
  three `(sx, sz, sy)` (`Terrain.propScale`). 308 retail `(1,-1,1)` mirrors
  were being flipped upside down instead of sideways.
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
- **Startup cost is GPU-side setup, not fetching or parsing.** Measured
  2026-08-08 on Giran (22_22) with `editor/world/verify_loadprofile.js`
  (re-runnable, `--check`) and `verify_shadercount.js`:

  | | cold (empty cache) | warm (cache primed) |
  |---|---|---|
  | domContentLoaded | 4,215 ms | 17,648 ms |
  | first contentful paint | 6,600 ms | 18,160 ms |
  | world ready / interactive | 158,153 ms | 147,188 ms |
  | first frame after ready | 184,465 ms | 162,652 ms |

  Warm CPU self-time, by source: `getShaderInfoLog` 42.2 s,
  `getProgramInfoLog` 26.9 s, `texSubImage2D` 26.3 s, `vertexAttribPointer`
  14.4 s, `uniformMatrix4fv` 6.7 s — against **glTF parse 324 ms**,
  `js/terrain.js` **44 ms**, `js/geodata.js` 50 ms, `js/bsp*.js` 15 ms.
  Network, warm: 3,090 requests / 152 MB decoded, of which prop glTF+bin is
  **2,680 requests / 112 MB** (the 3×3 neighbourhood, all cache hits,
  5.8 s of resource wall time).

  Counts for the same load: **19** shader programs, 2,427 distinct
  materials, 2,100 geometries, 436 textures, **4,059 InstancedMeshes for
  1,946 placements**, 678 draw calls.

  Three things follow, and the third is the one to be careful about:

  1. Caching buys 7% (158 s → 147 s). Transfer is not the bottleneck.
  2. Extraction and parsing are noise. The renderer's *setup* is everything:
     436 texture uploads and 4,059 InstancedMesh buffer/VAO builds.
  3. **The seconds above are SwiftShader seconds and are NOT the owner's.**
     42 s of `getShaderInfoLog` for *nineteen* programs is 2.2 s per program
     — a software-rasterizer artifact; real hardware compiles these in
     milliseconds. This profile RANKS the phases; it does not predict a real
     client's wall clock, and it cannot confirm or deny a slowdown the owner
     sees on his own GPU. Do not quote these numbers as the client's speed.

  On the wave that prompted this: commit 398286c's own text reports 1891
  placements for 22_22 before its extraction fix; 1,946 are there now, so
  Giran gained **+55 (+2.9%)**. Against 4,059 InstancedMeshes that is a
  proportional ~3% on the dominant cost, not a step change — and program
  count (19) does not scale with prop variety at all, because three.js
  dedupes programs across materials. So the prop wave is a poor candidate
  for a *noticeable* slowdown. Caveat, stated rather than buried: the 1891
  baseline comes from that commit message, not from a file this run read —
  `scene.json` is gitignored, so there is nothing to diff against.
- **CORRECTED 2026-08-08 — the renderer was never losing props, and a
  downward raycast at an actor's origin does NOT prove a prop is missing.**

  What was measured, and still holds: props were genuinely absent in-world
  (the owner's Giran staircase among them). The count is now 163,953
  placements across 100 tiles, independently recounted straight from
  `assets/world/*/scene.json`, up from 157,171 — and every one resolves to
  a drawable primitive.

  What was inferred and was wrong, twice over:

  1. *"The renderer is dropping them."* It is not. Measured live across 6
     tiles, every `scene.json` placement that has a gltf becomes an
     `InstancedMesh` instance — 22_22: 1,891 placements → 7,188 instances,
     exactly `sum(prims × placements)`, with 0 loader warnings. The loss was
     entirely upstream in extraction: `find_prop_start()` scored a re-synced
     parse deeper inside the actor body above the real property list (it can
     parse cleanly, end exactly at the body end, and carry MORE tags while
     missing `StaticMesh`), and `Mover` (553) / `MovableStaticMeshActor`
     (655) were never read at all. The header length was never a mystery —
     docs 3.1 gives the layout, so it is `2*len(cidx(ClassIndex)) + 13`.

  2. *"This raycast proves the prop is not there."* **This is the trap: an
     actor's origin is not inside its own mesh.** The evidence that
     "proved" a phantom prop was a downward ray fired at the actor origin;
     the mesh in question spans 0.54–3.09 m from that origin along local Z,
     so the ray passed beside it and hit nothing. A null result from a ray
     aimed at an origin is evidence about the *origin*, not about the mesh.
     Aim at the mesh's own world-space bounding box, or count instances
     directly. The trap is written up again in `verify_props.js`'s header.

  The lesson, same shape as the town floors: "props are missing" was a
  correct observation; "therefore the renderer is dropping them" was an
  untested inference, and it sent work into the renderer for a bug that was
  in the converter.
- **CORRECTED 2026-08-08 — town floors are NOT dirt.** This entry used to
  read "town floors painted with the base dirt are a retail fact", and it
  was wrong in a way worth understanding, because the mistake is the kind
  this document exists to prevent.

  What it got right, and what is still true: the Interlude TerrainInfo
  layers 1-7 really are ~0 over the Giran squares (verified in T_22_22.utx)
  and layer0's alphamap really is solid white, so the TERRAIN there is
  painted with base INNS_05 dirt. Every one of those measurements holds.

  What it got wrong: it concluded from that what the PLAYER should see. The
  pavement was never in the terrain layers — it is BSP brush geometry
  sitting on a raised slab above the natural ground, and at the time this
  note was written BSP had not been decoded, so the only floor anyone could
  find was the dirt. Measured at the Giran square (x 82000 y 148000):
  raw heightmap -3600.8 (natural ground, under the slab), BSP slab top
  ~-3496 (the stone floor), geodata -3464 (walkable, ~+32 above the slab —
  the same systematic offset documented above). The client's
  `correctHeightsWithGeodata` then lifts the dirt terrain to -3464 and
  buries the pavement it is standing on.

  The lesson, not the fact: a correct measurement plus an unexamined
  assumption about what it implies produces a confident, wrong instruction.
  "The terrain layers paint dirt" was evidence. "So the floor is dirt" was
  an inference, and it silently became a rule telling future work not to
  fix a real defect. State what you measured; keep what it implies
  separate and label it as inference.

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
- **A mock gateway that fails to bind is SILENT, and the suite then talks to
  the wrong mock.** `editor/world/mock_gateway.js:218-219` constructs the
  `WebSocketServer` and unconditionally prints `mock gateway on ws://...` on
  the next line, with no `'error'` listener anywhere in the file. On
  EADDRINUSE it therefore prints the success banner and dies. This is not
  hypothetical: `verify_targetwnd` hard-coded ports 8085/8086 — the same two
  `tools/battery.sh` starts its shared mocks on — so under the battery its
  own `MOCK_LEVEL=40` mock died, the browser connected to the battery's
  level-1 mock instead, and the level-40 phase "failed" for a reason nowhere
  near where anyone was looking. Fixed 2026-08-08 on both sides (the suite
  now leases ephemeral ports and proves the mock is listening before using
  it; the battery kills survivors and waits on each port instead of
  `sleep 2`). **The root cause in `mock_gateway.js` is fixed as of
  2026-08-08**: there is now a `wss.on('error')` that exits **98** with a
  diagnosis on EADDRINUSE, and the `mock gateway on ws://...` banner is
  printed from the `'listening'` event, so it can no longer be emitted by a
  process that never bound. `tools/battery.sh --selftest` re-proves both.

  This is also what `verify_m5`'s reported
  `Cannot read properties of undefined (reading 'click')` was: with the mock
  in the wrong state ChatWnd's tab strip never appeared, so
  `[...querySelectorAll('#chat-tabs .chat-tab')].find(...)` returned
  `undefined` and `.click()` threw. The suite is fine — it passes 12/12
  standalone and in the battery. **Read a `.find(...).<method>()` throw as
  "the thing I was looking for was not there", and go find out why it was
  not there.**
- **A protocol change silently rots every suite that matched on the old op.**
  Commit `a8d0d9b` split one conflated `move` op into `move` / `teleport` /
  `validate`. Two suites kept recording only `move` into their position map
  and then waited for an `admin_teleport` to show up there —
  `gateway/test/verify-clan.js:55` and
  `editor/world/verify_clanwnd_live.js:52`. Neither had failed *loudly*: they
  timed out inside a `waitFor` on a phase called "A teleported near Bitz",
  which reads like a server problem. Both fixed 2026-08-08 (they now record
  `teleport` and `validate` too). When you change an op in `bridge.js`,
  `grep -rn "op === '<old>'" gateway/test editor/world`.
- **Do not read a suite's exit code as evidence it checked anything.** Two of
  the battery's suites printed a JSON summary and exited 0 unconditionally —
  they could only fail by throwing. `verify_m5` was "passing" while pressing
  keys that had been unbound for a wave (bare `KeyC`/`KeyI`, when the retail
  keymap had moved to Alt+T/Alt+V) and reading stack counts out of
  `textContent` when the bitmap font puts them on `__l2text`. When you touch
  a suite, check that it can actually fail. Still true today for `verify_app`
  and `verify_terrain` (they contain no assertion at all), and three suites —
  `verify_text`, `verify_audio_coverage`, `verify_creature_anims` — exit 0
  unless you pass `--check`, which is why the battery now passes it.
- **A `/command` the chat parser does not recognise is SWALLOWED, and that can
  make a product feature unreachable.** `js/chat.js:434-437` answers any
  unmatched `/x` with "Unknown command: /x" and returns — correct behaviour in
  itself (retail parses commands client-side). But `_submit`'s trade rule at
  `js/chat.js:410` only matches `/trade <message>`; bare `/trade` matches
  nothing, so it never reaches `js/main.js:480`, whose `if (text === '/trade')`
  is the retail trade-invite on the current target. That branch is DEAD CODE
  today: measured 2026-08-08 with Aria targeted (`combat.target =
  {id:80001,name:'Aria'}`, entity kind `player`) — typing `/trade` produced the
  chat line "Unknown command: /trade" and no `tradeRequest` op. `verify_tradewnd`
  has been failing on exactly this; the suite is right.
- **Suites can assert values the port has since deliberately DELETED.**
  `verify_skillanim.js` still requires four authored skill sprites — a
  `#ffc060` slash, a `#6fd8ff` bolt, a hit flash, an `#86f0b0` aura. Those were
  invented placeholders; `js/skills.js:300-333` documents their removal in
  favour of the decoded retail tables (`js/skillvfx.js`, which
  `verify_skillvfx` passes on). The suite is now a tripwire holding the port to
  invented colours. Its clip assertions (`spAtk01`, `dance`) are still right and
  still pass. Fix the FX half against `skillvfx.json`, or drop it — do not
  re-add the sprites to make it green.
- **"0.0% CPU with an empty log" is NOT proof of a deadlock.** Several suites
  buffer everything into one `console.log` at the very end.
  `verify_pathfinding` takes **13 minutes** standalone and prints nothing until
  the last second — measured 2026-08-09, it exits cleanly with a full summary.
  It was killed by a 420 s deadline in the sweep before that and read as a
  hang. Its limit is now 2400 s. Before calling a silent suite hung, run it
  alone and let it finish. A genuine hang looks different, and there is one:
  `verify_remoteanim` printed its **complete** JSON summary — its last
  statement — and then never exited, twice out of three runs, with
  `browser.close()` already awaited. 58 of the browser suites have no explicit
  `process.exit(0)`, so any puppeteer handle that outlives `close()` parks the
  process forever.
- **A suite that hangs used to take the whole sweep with it.** Two suites once
  sat at 0.0% CPU for 7 and 36 minutes and the run produced no table at all.
  Every suite in `tools/battery.sh` now has a deadline and a watchdog; a hang
  is a `FAIL ... TIMEOUT (>Ns)` row and the sweep continues. If you add a
  suite, add its row (with a limit ~3x its observed runtime) —
  `tools/battery.sh --list` exits nonzero if you do not.
- **The browser client no longer auto-enters the world on a fresh device.**
  `js/main.js:359-364`: with character creation enabled (the default), the
  client sends `login{noAutoCreate:true}`, so a brand-new deviceId gets
  `auth_ok{chars:[]}` and the creation overlay opens and WAITS. Six live suites
  still boot `http://127.0.0.1:8083/` with no `?cc=0` and a fresh profile or a
  fresh deviceId, so `enterWorld` never arrives and they die on a 120 s wait
  that looks like a server problem: `verify_live.js:25`,
  `verify_abnormal_live.js:14`, `verify_actionwnd_live.js`,
  `verify_minimap_live.js`, `verify_partywnd_live.js`, `verify_questwnd_live.js`
  (and the same shape in `verify_storewnd_live` / `verify_tradewnd_live` /
  `verify_shopwnd_live` / `verify_skilldepth_live`). The suites that PASS are
  exactly the ones with a PINNED deviceId whose character already exists
  (`verify_soulshot`, `verify_equipswap`, `verify_invchatwnd_live`,
  `verify_warehousewnd_live`) or that use `?cc=0` (`verify_clanwnd_live:21`).
  `main.js:359` even says "?cc=0 opts back into the legacy auto-create (kept for
  the older suites)" — these are those suites, never updated.
- **The battery's own mocks can be killed under it by another agent's shell.**
  Measured 2026-08-08: the 8086 and 8087 mocks died partway through a mock
  section and `verify_charcreate`, `verify_charsel` and `verify_selfmodel` all
  went PASS -> FAIL on a 20 s wait; all three passed standalone minutes later.
  `tools/battery.sh` now re-checks all three ports before EVERY mock-section
  suite and prints a loud `!!` block if it had to restart one — treat the row
  under that block as suspect.

---

## 6. Prioritized next tasks

Completed since M4/M5 (details in `git log 3360733..HEAD` and the per-area
READMEs): skills & items with weapon gates and casting polish; chat, char
sheet, hotbar; 55 civilian NPC models (97 total); dungeon interiors with
prop torch lights; the retail-UI port (ElberaSkin — 17 windows at mined
geometry, no-guess audit at 0); NPC dialogs with live `.menu` round-trip;
quests + journal; party; buffs/cooldowns; shop/trade/private stores incl.
the offline-store mod; minimap with retail georeference; geodata heights
(100/100 tiles); water planes; terrain splat blending; HD pilot (17_25 +
22_22, 1,268 textures, `?hd=1`); mods play-tested 8/8 by protocol
(`verify-mods`); clan/pledge protocol (creation through the real
VillageMaster dialog chain, invite/accept, leave, oust, crest —
`verify-clan` PASS); the clan window (C.12 — Alt+N, ClanWnd 256×335, see
`docs/ui-port-handoff.md`; button labels mined from the xdat Button-record
sysstring tails, member-list schema from the binary, class icons tier-5
from NWindow.dll into `assets/gamedata/classicons.json`);
**terrain roof-hazard fix** (geodata has no ground layer under structures,
so the stale-heightmap correction lifted roofs/spires into the render mesh
as giant "cone" walls over towns — capped the correction at 2 m and
neighbor-median fill beyond it; `verify_ground` skips deferred cells);
**actor-parser fix** (`find_prop_start` accepted 4-byte garbage parses and
dropped ~1/3 of every tile's StaticMeshActors — 22_22: 1237→1891 props;
all 100 tiles reconverted, some +1500);

**Beta-playability wave (2026-08-02)** — driven by live/headless playtest
audits, all verified (client battery 23/23 + `verify_charcreate`):
browser **character creation** end-to-end (`createChar`, embedded
`/create/` creator iframe on empty accounts, `noAutoCreate` login flag,
`?cc=0` suite opt-out — `verify-create`/`verify-respawn` live + mock);
**respawn op** (death was a soft-lock; Die packet parsed, restart-to-
village wired to the Respawn button); 8 new animation clips per character
glTF (`castShort/castMid/castLong/magicThrow/spAtk01/spAtk02/die/damage` —
ANIM_CANDIDATES in build_characters.py; `clipForSkill(entry, hitTime)`);
self attack/cast/death animations (local player was never in the
EntityManager); beneficial skills auto-self-target (data-driven:
target routing ONE + anim code D/A); real WASD (streams moveTo legs);
far-click leg splitting + time-correlated actionFailed feedback;
ground drops rendered with labels + click-pickup; flame materials render
additively (were black quads); sysMsg item/skill name resolution
(`sysmsg_paramtypes.json`, mined from aCis call sites); 102 action icons
extracted; UI window cascade + bring-to-front, dock overlap fixes, Esc
(close topmost window else clear target), dev bar collapsed to a corner
widget, unknown slash commands no longer broadcast.

The real remaining backlog, in order:

1. ~~Full world-texture HD pass~~ — **DONE 2026-07-28**: 21,589/21,589
   textures at 4x in `assets/world-hd/` (51 GB, gitignored), zero failures.
   `tools/upscale/batch_world.sh` re-runs it idempotently (missing-only).
   The earlier wholesale failure was the xargs trailing `_` placeholder
   dropped — pinned in the script header.
2. ~~Multisell bridging~~ — **DONE 2026-07-28**: `multisellList` /
   `multisellChoose` bridged and live-verified (verify-multisell.js; the
   Silvia newbie equipment exchange end-to-end — see gateway/README.md M15).
3. **Warehouse + craft/recipes.** Warehouse done (M16, above); craft/recipes
   protocol not started.
4. ~~Clan window~~ — **DONE 2026-07-28**: `editor/world/js/ui/clanwnd.js`
   (Alt+N), mock suite `verify_clanwnd.js` (17/17) in the battery,
   live suite `verify_clanwnd_live.js` (self-seeded fixture).
5. **Server ops backlog** (`docs/README-ADMIN.md` §8): rate balancing after
   playtest, backup automation, VPS migration (§7 of that doc — ports,
   hostnames, player patch, guide placeholders).
6. ~~**Onboarding + movement depth**~~ (from the 2026-08-02 live audit) —
   **DONE 2026-08-07**, commit 25d6bec "Wave 3: geodata pathfinding,
   tutorial bridge, character select". All three items this entry listed as
   missing now exist and are gated: the TutorialShowHtml family is parsed
   and bridged (`gateway/src/gameclient.js:255-274, 881`; suite
   `gateway/test/verify-tutorial.js`, in the battery); click-to-move runs a
   budgeted coarse A* over the geodata NavGrid (`js/geodata.js:296-330`;
   suite `verify_pathfinding.js`, NOT in the battery — see §1); and
   multi-char accounts get a select screen (`verify_charsel.js`, in the
   battery). Left over from the same audit and still open: the Newbie
   Helper dialog itself was only ever a text box, so re-check it end to end
   before assuming the tutorial bridge made it useful.
7. **Later**: Seven Signs catacomb tiles (16_12/18_10/19_10/20_10), KTX2
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
| Model pipeline + output contract | `docs/character-pipeline.md`, `docs/monster-pipeline.md`, `docs/weapon-pipeline.md` |
| .unr/map format lore | `docs/map-format.md`, `docs/tile-map.md` |
| .dat schemas | `docs/dat-format-notes.md` |
| Ground-truth oracle | `docs/ground-truth.md` |
| **Where startup time goes (measured, Giran)** | **`docs/load-profile.md`** |
| Format library (use this for new parsers) | `tools/l2lib/` (+ its README, tests) |
| Server build + custom mods | `server/BUILD-NOTES.md` |
| Ops runbook (ES) | `docs/README-ADMIN.md`, player guide `docs/GUIA-JUGADORES.md` |
| aCis packet sources (the real spec) | `server/aCis_gameserver/java/net/sf/l2j/gameserver/network/{server,client}packets/` |
| Headless verification harnesses | `gateway/test/`, `editor/world/verify_*.js`, `editor/charcreate/verify_app.js`, `tools/src/char_pipeline/render_check.js` |
