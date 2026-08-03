# L2Vzla M2 — WebSocket Gateway

Protocol bridge between browser WebSocket clients and the real aCis (rev 409,
Interlude) login/game servers. Each browser WS connection gets its own L2
session: account auto-created from a persistent `deviceId`, then a live
two-way stream of world state and actions. Characters are created by the
client via the `createChar` op; a legacy auto-create (Human Fighter on first
login) stays ON by default for older scripts — `GATEWAY_AUTOCREATE=0`
disables it.

## Run

```bash
cd gateway
npm install          # only dep: ws
npm start            # ws://0.0.0.0:8090
```

Env: `GATEWAY_PORT` (8090), `L2_LOGIN_HOST` (127.0.0.1), `L2_LOGIN_PORT`
(2106), `L2_SERVER_ID` (1), `GATEWAY_AUTOCREATE` (default `1`; set `0` to
disable the legacy first-login auto-create — see §character creation).

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
node test/verify-shop.js [suffix]     # merchant flow: buy list, buy (itemList refresh), sell back
node test/verify-multisell.js [suffix] # multisell: Newbie_Exc_Multisell 003 list, choose, exact deduction
node test/verify-warehouse.js [suffix] # warehouse: Wilford TI, deposit item+adena (fee), withdraw back, exact
node test/verify-trade.js [suffix]    # player trade: ask/refuse, accept+cancel, two-phase confirm + item move
node test/verify-store.js [suffix]    # private store: manage/set/title, observer playerStore, buy, stop, .offline
node test/verify-clan.js [suffix]     # clan: real creation dialog chain, invite/accept, leave, oust, crest
node test/smoke-protocol.js          # same as verify-one but without the WS layer (raw protocol)
node test/verify-respawn.js [port]   # respawn: Die-packet unit test + mock e2e /die -> respawn{} -> revive
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
  regular `{"op":"remove","id":N}` (DeleteObject 0x12). For a SELF death
  (`id` == `enterWorld.char.id`) the op carries an extra
  `"canRespawn":true` field (aCis always allows the "to village" restart
  point) — the client shows its Respawn button off that.
- `{"op":"revive","id":N}` — Revive(0x07).
- `{"op":"target_ok","id":N}` — MyTargetSelected(0xa6), confirms your target.

Respawn (death -> back to town). Client -> server:
- `{"op":"respawn"}` (no fields) -> RequestRestartPoint(0x6d) with
  requestType 0. Gateway-guarded: only forwarded while the self player is
  dead (aCis silently drops the packet for a living player).

The aCis rev 409 layout (serverpackets/Die.java, now fully parsed by the
gateway): `C 0x06, D objectId, D toVillage, D toClanHall, D toCastle,
D toSiegeHQ, D sweepable, D fixedRes` — toVillage is hardcoded 1
("to nearest village"); clanhall/castle/siegeHQ depend on the clan and any
active siege; sweepable is the Monster blue-glow flag; fixedRes is the GM
allowFixedRes flag. RequestRestartPoint (clientpackets/
RequestRestartPoint.java) reads a single `D requestType`: 1 clanhall,
2 castle, 3 siege flag, 4 fixed (GM/festival only), 27 jail (forced
server-side when jailed) — anything else, including 0, falls through to
the regular TOWN restart point. There is NO dedicated response packet:
the server answers with doRevive() (Revive 0x07 + StatusUpdate hp/cp ->
existing `revive` + `selfStatus` ops) followed by teleportTo
(TeleportToLocation -> existing `move` op; the bridge auto-answers with
Appearing 0x30 like any teleport). Siege-ATTACKER respawns are delayed by
Config.ATTACKERS_RESPAWN_DELAY server-side.

Also: `enterWorld.char` now includes `id` (own objectId, for self-reconcile).
`enterWorld` fires exactly once per session; later UserInfo re-sends
(level up etc.) only update `selfStatus`.

SystemMessage(0x64) is shallow-decoded into the contract op
`{"op":"sysMsg","id":N,"params":[...]}` (param types: 0 TEXT, 1 NUMBER,
2 NPC_NAME, 3 ITEM_NAME, 4 SKILL_NAME, 5 CASTLE_NAME, 6 ITEM_NUMBER,
7 ZONE_NAME-loc). Example: `{"op":"sysMsg","id":95,"params":[145,10]}` =
"You have earned 145 exp and 10 SP".

## M16: warehouse protocol (added 2026-07-28)

Flow (verified live, test/verify-warehouse.js, Warehouse Keeper Wilford
30005, TI town): talk -> keeper html with `bypass -h npc_<id>_DepositP` /
`npc_<id>_WithdrawP` (private) and `npc_<id>_DepositC` / `npc_<id>_WithdrawC`
(clan) links -> follow the REAL DepositP link -> `whDeposit` (own inventory,
deposit-eligible) -> `whDepositItems` -> `invUpdate` -> follow WithdrawP ->
`whWithdraw` (warehouse contents) -> `whWithdrawItems` -> `invUpdate`. The
bypass sets the ACTIVE warehouse server-side (Player.setActiveWarehouse) —
talk + bypass first, the keeper must stay the current folk within
interaction range.

Server -> client:
- `{"op":"whDeposit","whType":N,"adena":N,"items":[{"objectId":N,"itemId":N,"count":N,"enchant":N}]}`
  — WarehouseDepositList(0x41): `H whType, D playerAdena, H count`, per item
  `H type1, D objectId, D itemId, D count, H type2, H custom1, D bodyPart,
  H enchant, H custom2, H 0, D objectId(dup), Q augmentation`. Own-inventory
  items eligible to deposit (getAvailableItems + isDepositable: equipped and
  no-deposit items excluded).
- `{"op":"whWithdraw",...}` — WarehouseWithdrawList(0x42): IDENTICAL layout;
  items are the ACTIVE warehouse's contents. whType: 1 private, 2 clan,
  3 castle, 4 freight. Both carry the PLAYER's current adena.
- WithdrawP on an EMPTY warehouse sends no 0x42 — just sysMsg
  NO_ITEM_DEPOSITED_IN_WH.

Client -> server:
- `{"op":"whDepositItems","items":[{"objectId":N,"count":N}]}` ->
  SendWarehouseDepositList(0x31): `D count`, per item `D objectId, D count`.
  aCis names the client packets SendWarehouseDepositList/SendWarehouse
  WithdrawList (not RequestWareHouse*). FEE: 30 adena PER ENTRY, charged by
  the server (depositing an item + adena = 2 entries = 60a). DepositP
  temp-disables the inventory for 1.5s (Player.tempInventoryDisable) — a
  deposit sent in that window is silently dropped; wait ~2s after the
  bypass.
- `{"op":"whWithdrawItems","items":[{"objectId":N,"count":N}]}` ->
  SendWarehouseWithdrawList(0x32): same layout, objectIds from the
  `whWithdraw` list.
- ADENA IS A NORMAL ITEM (itemId 57): deposit/withdraw adena by including
  its entry (objectId from the whDeposit/whWithdraw list, itemId 57) in the
  same packet — there is NO special adena packet in this rev. The fee is
  charged from what remains after the adena deposit (SendWarehouseDeposit
  List: currentAdena -= deposited adena, then currentAdena < fee -> fail).
- Both directions answer with `invUpdate` (item remove/modify + adena
  modify), not ItemList.
- objectIds are NOT preserved across the transfer for stackable items: the
  deposited 500 adena re-appeared in the whWithdraw list under a NEW
  objectId (split stack); the non-stackable item kept its own. Always take
  objectIds from the list you are answering.

Live-verified numbers (test/verify-warehouse.js): char seeded offline to
5000 adena -> whDeposit{whType 1, adena 5000, 3 items} -> deposit Tutorial
Guide (5588) x1 + 500 adena -> invUpdate `{modify 57->4440, remove 5588}`
(5000-500-60 fee) -> whWithdraw{whType 1, adena 4440}: 5588 x1 (same
objectId) + adena x500 (NEW objectId) -> withdraw both back -> invUpdate
`{add 5588, modify 57->4940}` (the 60a fee is NOT refunded) -> fresh
DepositP list confirms adena 4940 and 5588 count 1 restored.

## M15: multisell / newbie equipment exchange (added 2026-07-28)

Flow (verified live, test/verify-multisell.js, Trader Silvia TI): talk ->
merchant html -> buy the exchange ingredients from her regular shop ->
follow the REAL `bypass -h npc_<id>_Newbie_Exc_Multisell 003` link ->
`multisellList` -> `multisellChoose` -> `invUpdate` (product added,
ingredient removed, adena deducted exactly).

Server -> client:
- `{"op":"multisellList","listId":N,"items":[{"entryId":N,"products":[{"itemId":N,"count":N,"enchant":N}],"ingredients":[{"itemId":N,"count":N,"enchant":N}]}]}`
  — MultiSellList(0xd0): `D listId, D page, D finished, D pageSize, D count`,
  per entry `D entryId, D 0, D 0, C stackable, H products, H ingredients`;
  per product `H itemId, D bodyPart, H type2, D count, H enchant, D 0, D 0`;
  per ingredient `H itemId, H type2, D count, H enchant, D 0, D 0`.
  Products on top, ingredients below — exactly as written.
- PAGES ARE MERGED (MultisellData.PAGE_SIZE = 40): the server sends one
  0xd0 per page (`page` 1-based, `finished` on the last); the game client
  accumulates and emits ONE `multisellList` op per full list. List 003 has
  127 XML entries = 4 pages when unfiltered.
- `entryId` is 1-based into the server-side PREPARED list
  (PreparedListContainer), NOT the XML entry number — pass it back verbatim
  in `multisellChoose`.
- `listId` is the Java String.hashCode of the XML file name (`"003"` ->
  47667), not the file number.
- Newbie_Exc_Multisell is sent with inventoryOnly=true: the prepared list
  contains ONLY entries whose ingredients include an unequipped
  weapon/armor/jewelry the player OWNS. On a fresh char the list is EMPTY
  until you buy an ingredient (e.g. the 37a Magic Ring from Silvia's own
  Buy 13 list).
- Newbie_ lists additionally require Player.isNewbie(true): base class AND
  char level 6..25 — a level-1 char gets `exchangelvlimit.htm` instead of
  the list.

Client -> server:
- `{"op":"multisellChoose","listId":N,"entryId":N,"count":N}` ->
  MultiSellChoose(0xa7): `D listId, D entryId, D amount` (aCis names the
  client packet `MultiSellChoose`, not RequestMultiSellChoose). Server
  validates against the stored prepared list (listId must match the last
  list sent; a mismatch nukes it), the npc must be the current folk within
  interaction range (talk/bypass first), amount 1..9999, and non-stackable
  products force amount 1. Failures are SILENT (server drops the prepared
  list) or a sysMsg (NOT_ENOUGH_ITEMS etc.).
- Success arrives as `invUpdate`: product `add`, ingredient(s) `remove`,
  adena `modify` (exact, list 003 applies no tax) + sysMsg EARNED_ITEM_S1
  and SUCCESSFULLY_TRADED_WITH_NPC.

Live-verified numbers (test/verify-multisell.js): char seeded offline to
level 6 + 20000 adena (farming 557a would take ~15 gremlin kills; the seed
waits for characters.online=0 because GameClient.CleanupTask delays the
logout save 15s when the char is IN COMBAT — a fixed 5s sleep gets
overwritten). Bought Magic Ring (116, 37a) + Necklace of Magic (118, 75a)
-> multisellList with exactly 2 entries, cross-checked against
data/xml/multisell/003.xml: `875 <- [116x1, 57x557]`, `906 <- [118x1,
57x1115]` -> chose the 116 entry -> invUpdate `{add 875 x1, remove 116,
modify 57 -557}` (20000-112-557 = 19331).

## M14: clan / pledge protocol (added 2026-07-28)

Flow (verified live, test/verify-clan.js): clan creation through the REAL
VillageMaster dialog chain -> clanInvite -> clanAsk -> clanAnswer ->
clanInfo + clanMembers on both -> clanLeave -> clanInfo{id:0} + empty
members -> re-invite a third char -> clanOust -> same clear.

**Clan creation is 100% protocol** (no DB seeding): the chain, validated
against data/html + scripting/script/feature/Clan.java and verified live:

1. `talk{id}` to a VillageMaster that is in the Clan feature script's talk
   list — Grand Master **Bitz (30026)**, TI village (-83326, 242964, -3718).
   **Roien (30008), the spawn-point Grand Master, is NOT in the list** in
   this datapack (Clan.java addTalkId), so he can never create clans here;
   Bitz is the closest listed master, 19k units from the spawn (the test
   travels via `admin_teleport`, accesslevel 7 — creation itself is pure
   dialog protocol).
2. `bypass{command:"npc_<objId>_Quest Clan"}` -> 9000-01.htm "[Clan
   management]".
3. `bypass{command:"Quest Clan 9000-02.htm"}` -> 9000-02.htm "[Create a
   Clan]" form (`npc_%objectId%_create_clan $name` link, which authorizes
   the next bypass in Player.validateBypass via _validBypass2 prefix).
4. `bypass{command:"npc_<objId>_create_clan <Name>"}` ->
   VillageMaster.onBypassFeedback -> ClanTable.createClan: level >= 10, no
   clan, no create-penalty, alphanumeric 2..16 chars, unique name. Leader
   gets PledgeShowMemberListAll + UserInfo + sysMsg CLAN_CREATED. New clans
   start at level 0 in this rev.

Client -> server:
- `{"op":"clanInvite","name":".."}` -> RequestJoinPledge(0x24): `D targetId,
  D pledgeType` (0 = main clan). **objectId-based in this rev** (unlike
  party, which is name-based) — the bridge resolves the name through its
  visible-players map, like tradeRequest. Needs SP_INVITE privilege (the
  leader has it); NO distance check server-side.
- `{"op":"clanAnswer","accept":0|1}` -> RequestAnswerJoinPledge(0x25): `D`.
- `{"op":"clanLeave"}` -> RequestWithdrawPledge(0x26): empty. The clan
  LEADER cannot withdraw (CLAN_LEADER_CANNOT_WITHDRAW); dissolve
  (RequestDismissPledge) is commented out of this rev's packet handler.
  Leaving sets a re-join penalty (DaysBeforeJoinAClan = 1 day here).
- `{"op":"clanOust","name":".."}` -> RequestOustPledgeMember(0x27): `S name`
  (needs SP_DISMISS; target must not be in combat; sets the same penalty
  plus a clan-side accept-new-member penalty).
- `{"op":"clanCrestRequest","id":N}` -> RequestPledgeCrest(0x68): `D crestId`.

Server -> client:
- `{"op":"clanInfo","id":N,"name":"..","leaderName":"..","level":N,"crestId":N?,"allyId":N?,"allyName":".."?}`
  — clan identity, built from the PledgeShowMemberListAll(0x53) header
  merged with PledgeShowInfoUpdate(0x88, carries crest/level/ally but NO
  name/leader). crestId/allyId/allyName are omitted when 0. Emitted on
  login (EnterWorld sends 0x53 BEFORE UserInfo — queued and flushed after
  enterWorld like the other lists) and on every info change. After leaving
  / being ousted / dissolution: `clanInfo{id:0}`.
- `{"op":"clanMembers","members":[{"id":N,"name":"..","level":N,"classId":N,"online":bool}]}`
  — FULL snapshot on every composition/status change (same design choice
  as M9 party — no incremental ops), rebuilt from PledgeShowMemberListAll/
  Add(0x55)/Update(0x54)/Delete(0x56)/DeleteAll(0x82). `id` is the ONLINE
  objectId — **0 for offline members** (these packets never carry an
  offline member's id). `rank` is not available (power grade lives in
  PledgeReceivePowerInfo, not bridged).
- `{"op":"clanAsk","from":"..","clanName":".."}` — AskJoinPledge(0x32):
  `D requestorObjId, S pledgeName`; the id is resolved to a name via the
  visible-players map.
- `{"op":"clanCrest","id":N,"data":"<base64>"|null}` — PledgeCrest(0x6c):
  `D crestId, D length, B data`. The bytes are a raw **DDS file**
  (CrestCache stores .dds; PLEDGE crests are exactly 256 bytes per
  enums/CrestType.java). OPTIONAL op — the web client may skip DDS
  decoding. `data` is null when the crest has no data.

Member entry layouts (verified against source):
- All(0x53): `D subFlag, D clanId, D pledgeType, S pledgeName, S leaderName,
  D crestId, D level, D castleId, D clanHallId, D rank, D reputation,
  D dissolution, D 0, D allyId, S allyName, D allyCrestId, D atWar, D count`,
  per member `S name, D level, D classId, D sex, D race, D onlineObjId,
  D hasSponsor`. Sub-pledge lists (pledgeType != 0) are NOT bridged.
- Update(0x54): `S name, D level, D classId, D sex, D race, D onlineObjId,
  D pledgeType, D hasSponsor` (also broadcast when a clanmate logs in/out).
- Add(0x55): same minus hasSponsor. Delete(0x56): `S name` (name-based —
  the bridge keys the snapshot by name). DeleteAll(0x82): empty static.
- PledgeInfo(0x83, only answers RequestPledgeInfo 0x66): `D clanId, S name,
  S allyName` — merged when it matches. PledgeStatusChanged(0xcd) and
  JoinPledge(0x33) are decoded but log-only.

Quirks verified live:
- **Appearing(0x30) is MANDATORY after any self teleport** (gatekeeper,
  SoE, admin_teleport): aCis keeps `_isTeleporting` until the client
  answers TeleportToLocation with Appearing (clientpackets/Appearing.java
  -> onTeleported), and while set `denyAiAction()` rejects every
  interact/attack with a bare ActionFailed. The bridge now sends Appearing
  automatically on every self teleport.
- **Request lock leak** (model/actor/container/player/Request.java):
  onRequestResponse clears the RESPONDER's state but never the requestor's
  (`clear()` nulls `_partner` before the null check) — the INVITER stays
  "processing request" until the 15s REQUEST_TIMEOUT task fires. A second
  clanInvite/tradeRequest within 15s of the first answer is dropped
  server-side with WAITING_FOR_ANOTHER_REPLY. verify-clan waits out the
  15s before re-inviting.
- The clanAsk prompt expires after 15s (same Request timer).

## M13: private stores (added 2026-07-27)

Flow (verified live, test/verify-store.js): storeManageSell -> storeMsgSell
-> storeSetSell (title rides along) -> storeState{open} -> observer clicks
the sitting player (talk) -> playerStore -> storeBuy -> item + adena move
(exact amounts) -> storeStop / auto-close on sell-out -> storeState{!open}.

**There is NO separate start packet in aCis**: SetPrivateStoreListSell/Buy
IS the store start (clientpackets: `sitDown()` + `setOperateType(SELL/BUY)`
+ `broadcastUserInfo` + title broadcast). `storeStart{}` is a documented
no-op.

Client -> server:
- `{"op":"storeManageSell"}` -> RequestPrivateStoreManageSell(0x73, empty).
- `{"op":"storeManageBuy"}` -> RequestPrivateStoreManageBuy(0x90, empty).
- `{"op":"storeTitle","title":".."}` -> SetPrivateStoreMsgSell(0x77) /
  SetPrivateStoreMsgBuy(0x94): `S title` (max 29 chars server-side), routed
  by the last manage/set type. **Set the title BEFORE storeSetSell/Buy**:
  the title rides the TradeList and survives its `clear()`, so the
  store-open PrivateStoreMsg* broadcast then carries it to observers.
  (SetPrivateStoreMsg* itself only echoes to the owner — no re-broadcast.)
- `{"op":"storeSetSell","items":[{"objectId":N,"count":N,"price":N}],"title":".."?,"packageSale":bool?}`
  -> SetPrivateStoreListSell(0x74): `D packageSale, D count`, per item
  `D objectId, D count, D price`. Opens the store on success.
- `{"op":"storeSetBuy","items":[{"itemId":N,"count":N,"price":N}],"title":".."?}`
  -> SetPrivateStoreListBuy(0x91): `D count`, per item (16 bytes)
  `D itemId, H enchant, H 0, D count, D price`. Opens the buy-store.
  Quirk (verify-mods): canPassBuyProcess requires OWNING a reference item
  of the listed type.
- `{"op":"storeStart"}` — no-op (see above; kept in the contract for
  clients that model open explicitly).
- `{"op":"storeStop"}` -> RequestPrivateStoreQuitSell(0x76) /
  QuitBuy(0x93), picked by the current store type. Both are empty and just
  do `setOperateType(NONE)` + broadcastUserInfo — either closes any store.
- `{"op":"storeBuy","storeId":N,"items":[{"objectId":N,"count":N}]}` ->
  RequestPrivateStoreBuy(0x79, buy FROM a sell-store): `D storePlayerId,
  D count`, per item `D objectId, D count, D price`. **The price MUST match
  the store price** (TradeList.privateStoreBuy validates objectId+price) —
  the bridge fills it from the last playerStore list it saw for storeId,
  so click the store (talk) before buying. Buyer must be within 150
  (Npc.INTERACTION_DISTANCE) of the store.
- `{"op":"storeSell","storeId":N,"items":[{"objectId":N,"count":N,"price":N}]}`
  -> RequestPrivateStoreSell(0x96, sell INTO a buy-store): `D storePlayerId,
  D count`, per item (20 bytes) `D objectId, D itemId, H enchant, H 0,
  D count, D price`. itemId/enchant are resolved from the last playerStore
  list (the observer view of a buy-store carries the VIEWER's own items).

Server -> client:
- `{"op":"storeMsgSell","packageSale":bool,"adena":N,"items":[{objectId,itemId,count,enchant,price,slot,storePrice}],"sellables":[...]}`
  — PrivateStoreManageListSell(0x9a): `D objectId, D packageSale, D adena,
  D sellableCount` per item `D type2, D objectId, D itemId, D count, H 0,
  H enchant, H 0, D bodyPart, D price`, then `D storeCount` + same entry +
  `D referencePrice`. `items` = current store contents (storePrice =
  referencePrice); `sellables` (additive) = what can be listed.
- `{"op":"storeMsgBuy","adena":N,"items":[{itemId,enchant,count,price,slot,storePrice}],"buyables":[...]}`
  — PrivateStoreManageListBuy(0xb7): `D objectId, D adena, D buyableCount`
  per item `D itemId, H enchant, D count, D refPrice, H 0, D bodyPart,
  H type2`, then `D storeCount` + same entry + `D price, D refPrice`.
  `buyables` (additive) = owned reference items.
- `{"op":"playerStore","id":N,"type":"sell|buy","title":"..","adena":N,"items":[...]}`
  — what an observer sees clicking someone's store. Sell:
  PrivateStoreListSell(0x9b): `D storePlayerId, D packageSale, D viewerAdena,
  D count`, per item the manage-sell entry + `D price, D referencePrice`
  (items get `price` and `storePrice`). Buy: PrivateStoreListBuy(0xb8):
  `D storePlayerId, D viewerAdena, D count`, per item `D objectId, D itemId,
  H enchant, D count, D refPrice, H 0, D bodyPart, H type2, D price,
  D quantity` (objectIds are the VIEWER's own matching items — use them
  verbatim in storeSell). `title` is folded in from the PrivateStoreMsgSell
  (0x9c)/MsgBuy(0xb9) broadcast (`D objectId, S title`) seen when the store
  opened — observers out of range at open time get `title: ""`.
- `{"op":"storeState","open":bool,"type":"sell|buy"?}` — own store state,
  derived from the UserInfo operateType field (writeC after mountType):
  1 SELL / 8 PACKAGE_SELL -> 'sell', 3 BUY -> 'buy' are OPEN; 2/4 are the
  manage views (store not visible to observers); 0 NONE. Emitted on
  transitions only — covers storeSet*, storeStop and the auto-close when a
  store sells out (OperateType.NONE + broadcastUserInfo).

Quirks verified live:
- **After a store closes (storeStop or sell-out) the player stays
  SITTING**, and canOpenPrivateStore silently refuses to open a store
  while sitting-and-not-in-store-mode (Player.java:2361, no sysMsg).
  Stand up first (`action{actionId:0}` toggles) before re-listing.
- Buying the last item of a sell-store auto-closes it:
  storeState{open:false} arrives at the owner.
- A stopped store answers clicks with NOTHING (no playerStore; the target
  just follows) and storeBuy/storeSell fail silently server-side.
- `.offline` works with a sell store too (mod checks isInStoreMode):
  A disconnects, the offline trader stays visible and the store keeps
  serving playerStore views to observers (re-proven through the new ops).
- Prices/money verified exact live: guide listed @10, B 39->29, A 0->10.

## M12: player-to-player trade (added 2026-07-27)

Flow (verified live, test/verify-trade.js): tradeRequest -> tradeAsk ->
tradeAnswer -> tradeStart on both -> tradeAdd -> tradeOwn/tradeOther ->
BOTH tradeDone (two-phase) -> tradeEnd{done} + item movement via invUpdate.

Client -> server:
- `{"op":"tradeRequest","name":".."}` -> TradeRequest(0x15): `D objectId`.
  **aCis is objectId-based, not name-based** — the bridge resolves the name
  through its visible-players map (CharInfo). Server-side prerequisites
  (clientpackets/TradeRequest.java): the requestor must KNOW the target
  (`player.knows(target)`), target must not be busy/in a transaction, and
  the request EXPIRES after 15s (Player.REQUEST_TIMEOUT). Requestor gets
  sysMsg 118 (REQUEST_S1_FOR_TRADE).
- `{"op":"tradeAnswer","accept":0|1}` -> AnswerTradeRequest(0x44): `D`
  (1 accept, 0 refuse).
- `{"op":"tradeAdd","objectId":N,"count":N}` -> AddTradeItem(0x16):
  `D tradeId, D objectId, D count`. **tradeId is read but UNUSED in this
  rev** (@SuppressWarnings) — the bridge sends 0. Only items from the
  tradeStart snapshot are accepted (not equipped, tradable, not quest).
- `{"op":"tradeDone"}` -> TradeDone(0x17): `D 1` = confirm. **TWO-PHASE
  (TradeList.confirm)**: the first confirm only marks that side —
  confirmer gets TradePressOwnOk(0x75, empty), partner gets
  TradePressOtherOk(0x7c, empty) + sysMsg 121; NO tradeEnd yet. The
  exchange runs when BOTH have confirmed. Also confirms are locked: no
  tradeAdd after either side confirmed.
- `{"op":"tradeCancel"}` -> TradeDone(0x17): `D 0` — cancels the trade for
  BOTH parties (Player.cancelActiveTrade).

Server -> client:
- `{"op":"tradeAsk","from":".."}` — SendTradeRequest(0x5e): `D senderId`;
  the bridge resolves the id to a name via the visible-players map.
- `{"op":"tradeStart","partnerId":N,"partner":"..","items":[{objectId,itemId,count,slot,enchant}]}`
  — TradeStart(0x1e): `D partnerId, H count`, per item `H type1,
  D objectId, D itemId, D count, H type2, H custom1, D bodyPart, H enchant,
  H custom2, H 0`. `items` is the receiver's OWN tradable-inventory
  snapshot — `getAvailableItems(allowAdena=true, allowNonTradeable=false,
  allowStoreBuy=false)`: equipped items, is_tradable=false items and quest
  items are EXCLUDED. Quirk: aCis starter equipment (Dagger 10, Squire's
  set) is is_tradable=false — a fresh char can only offer the Tutorial
  Guide (5588).
- `{"op":"tradeOwn","items":[{objectId,itemId,count,slot,enchant}]}` —
  TradeOwnAdd(0x20): `H count` (always 1 in this rev) + the trade entry
  layout above. Sent to the offerer when its own offer changes.
- `{"op":"tradeOther","items":[...]}` — TradeOtherAdd(0x21): same layout,
  sent to the partner. (The frozen contract allows a `name?` field; not
  populated — the gateway has no item-name table.)
- `{"op":"tradeEnd","reason":"done|cancel"}` — SendTradeDone(0x22):
  `D value` (1 = exchange done, 0 = cancelled/failed). Sent to BOTH
  parties on confirm-complete (done) and on tradeCancel/disconnect
  (cancel).

Quirks verified live:
- REFUSE path: the requestor gets ONLY sysMsg 119 (S1_DENIED_TRADE_REQUEST)
  — no tradeStart, no tradeEnd anywhere.
- CANCEL path: both sides get tradeEnd{cancel}; offered items never leave
  the inventory (no invUpdate).
- DONE path: both sides get tradeEnd{done} + sysMsg 123 (TRADE_SUCCESSFUL)
  and the transfer arrives as regular invUpdate (remove at the offerer,
  add at the partner).
- TradePressOwnOk(0x75)/TradePressOtherOk(0x7c) are decoded but log-only —
  NOT contract ops.
- TradeItemUpdate/TradeUpdate (S->C 0x74, trade-window own-inventory
  refresh; per item a leading `H` available-flag 2/3, then the trade entry
  layout) is NOT bridged — the contract needs only tradeOwn/tradeOther.

## M11: NPC shops / merchants (added 2026-07-27)

Flow (verified live against Trader Silvia, TI town): talk -> merchant html
with `bypass -h npc_<objectId>_Buy <listId>` / `npc_<objectId>_Sell` links
-> BuyList/SellList -> RequestBuyItem/RequestSellItem. The bypass is
validated against the last html sent (validateBypass) — you MUST open the
dialog first.

Server -> client:
- `{"op":"buyList","listId":N,"money":N,"items":[{"itemId":N,"count":N,"price":N}]}`
  — BuyList(0x11): `D money, D listId, H count`, per item `H type1,
  D itemId, D itemId(dup), D count, H type2, H 0, D bodyPart, H 0,0,0,
  D price(taxed)`. count 0 = unlimited stock.
- `{"op":"sellList","money":N,"items":[{"objectId":N,"itemId":N,"count":N,"price":N,"enchant":N}]}`
  — SellList(0x10): `D money, D 0, H count`, per item `H type1,
  D objectId, D itemId, D count, H type2, H custom1, D bodyPart,
  H enchant, H custom2, H 0, D price` (price = referencePrice/2).

Client -> server:
- `{"op":"buy","items":[{"itemId":N,"count":N}]}` -> RequestBuyItem(0x1f):
  `D listId, D count`, per item `D itemId, D count`. Uses the last
  BuyList's listId. **The merchant must be the CURRENT target**
  (target{id} first) and within 150 (Npc.INTERACTION_DISTANCE) — else the
  server silently drops it.
- `{"op":"sell","items":[{"objectId":N,"count":N}]}` -> RequestSellItem
  (0x1e): `D listId(0), D count`, per item `D objectId, D itemId, D count`
  (bridge resolves itemId from its inventory map).

Responses (verified live, important):
- A successful BUY answers with a FULL **ItemList(0x1b)** refresh (the op
  `itemList`), NOT InventoryUpdate — RequestBuyItem line ~194 sends
  ItemList, which also CLEARS the pending update queue. Assert purchases
  via `itemList` (item present + adena count decreased).
- A successful SELL queues inventory changes flushed as **invUpdate**
  (remove + adena modify) + an optional merchant "-sold.htm" NpcHtmlMessage.
- Buy/sell failures are silent OR a sysMsg (279 = not enough adena).
- Prices verified against datapack buyLists.xml (list 13 item 116 = 37a
  exact). TI town castle tax = 0% observed (77->40 exact). Sell-back rate
  = referencePrice/2 (Magic Ring: buy 37, sell 16).
- Multisell: TI merchants DO use it (`npc_<id>_Newbie_Exc_Multisell 003`
  on Silvia = newbie equipment exchange; MultiSellList is opcode 0xd0
  double). Bridged in M15.

## M10: abnormal status (buffs) + skill cooldowns (added 2026-07-27)

Server -> client:
- `{"op":"buffs","effects":[{"skillId":N,"level":N,"duration":N}]}` —
  AbnormalStatusUpdate(0x7f): `H count`, per effect `D skillId, H level,
  D duration`. SEMANTICS (verified in EffectList.updateEffectIcons): the
  packet is rebuilt with ALL current effects on every add/remove — it is a
  FULL SNAPSHOT each time, so removal = effect absent from the next
  snapshot (no explicit remove flag). `duration` is in SECONDS;
  -1 = toggle/infinite. Fires on login (EnterWorld) and on every effect
  add/fade.
- `{"op":"skillCoolTime","skills":[{"id":N,"level":N,"reuse":N,"remaining":N}]}`
  — SkillCoolTime(0xc1): `D count`, per skill `D skillId, D level,
  D reuse, D remaining` — both in SECONDS (packet divides by 1000).
  IMPORTANT (verified in source): aCis 409 sends this packet ONLY at login
  (EnterWorld), subclass change, augmentation and item-skill equip —
  NOT on every cast. It also only contains reuses > 30s
  (PlayerCast: `addTimeStamp` only when reuseDelay > 30000).
- Per-cast cooldown: the EXISTING `skillCast` op now also carries
  `reuse` (additive) — MagicSkillUse(0x48)'s reuseDelay field in
  MILLISECONDS, present on every cast. Use it for shortcut cooldown
  overlays.
- `targetBuffs` — SKIPPED: ExAbnormalStatusUpdateFromTarget does not exist
  in this rev. Party members' buffs exist as PartySpelled (not bridged).
- Reuse formula (verified live): applied reuse = skillReuseDelay ×
  (333 / atkSpd) when the skill is not staticReuse. Evidence: Battle Roar
  (600000ms) lands as reuse 480s (600000 × 333/416 pAtkSpd); Self Heal
  (10000ms) shows reuse 15633ms in skillCast (10000 × 333/213 mAtkSpd).
  skillCast.hitTime and buff durations are NOT scaled (1199s for a 1200s
  buff, tick rounding).

Verified live (test/verify-buffs.js): Might cast -> buffs
`[{1068, lvl1, 1199s}]` -> Battle Roar -> login SkillCoolTime
`[{121, reuse 480, remaining 476}]` -> Herb of Power (120s) present ->
absent after expiry while Might persists.

## M9: party protocol / PartyWnd (added 2026-07-27)

Client -> server:
- `{"op":"partyInvite","name":".."}` -> RequestJoinParty(0x29): `S name,
  D lootRule`. Name-based (retail invites by name, not objectId). The
  bridge sends lootRule 0 (ITEM_LOOTER; enum: 0 ITEM_LOOTER,
  1 ITEM_RANDOM, 2 ITEM_RANDOM_SPOIL, 3 ITEM_ORDER, 4 ITEM_ORDER_SPOIL).
- `{"op":"partyAnswer","accept":0|1}` -> RequestAnswerJoinParty(0x2a): `D`
  (1 accept, 0 refuse).
- `{"op":"partyLeave"}` -> RequestWithdrawParty(0x2b): empty.
- `{"op":"partyKick","name":".."}` -> RequestOustPartyMember(0x2c): `S name`
  (leader only). Change-leader exists as 0xd0:4 RequestChangePartyLeader —
  not exposed yet.

Server -> client:
- `{"op":"partyAsk","from":".."}` — AskJoinParty(0x39): `S requestorName,
  D lootRule` (lootRule not forwarded in the op).
- `{"op":"party","members":[{"id":N,"name":"..","classId":N,"level":N,"hp":N,"maxHp":N,"mp":N,"maxMp":N,"leader":bool}]}`
  — FULL snapshot on every composition change. Design choice (documented):
  no incremental add/remove ops — the bridge rebuilds the snapshot on
  PartySmallWindowAll(0x4e)/Add(0x4f)/Delete(0x51)/DeleteAll(0x50) so the
  client never merges deltas. Note the packets EXCLUDE the receiver; the
  bridge re-inserts self (first entry) from its local state.
- `{"op":"partyMemberStatus","id":N,"hp":N,"maxHp":N,"mp":N,"maxMp":N}` —
  PartySmallWindowUpdate(0x52): member status flow (hp/mp/cp/level
  changes + regen ticks). Frequent; the client should update in place, not
  re-render the whole window.
- JoinParty(0x3a, result code to the requestor) is decoded but only logged.

Member entry layouts (verified against source):
- All(0x4e): `D leaderId, D lootRule, D count`, per member:
  `D objectId, S name, D cp, D maxCp, D hp, D maxHp, D mp, D maxMp,
  D level, D classId, D 0, D race`.
- Add(0x4f): `D leaderId, D lootRule` + same member minus race
  (two trailing D 0).
- Update(0x52): `D objectId, S name, D cp, D maxCp, D hp, D maxHp, D mp,
  D maxMp, D level, D classId`.
- Delete(0x51): `D objectId, S name`. DeleteAll(0x50): empty.

Verified live (test/verify-party.js): invite -> partyAsk(from) -> refuse
(no party) -> accept (both snapshots, 2 members, leader flag on inviter) ->
melee damage visible cross-client as partyMemberStatus (hp 126->114) ->
kick (both empty) -> re-invite + leave (both empty).

## M8: quest protocol / QuestWnd (added 2026-07-26)

Server -> client:
- `{"op":"questList","quests":[{"id":N,"name":"..","progress":N}]}` —
  QuestList(0x80): `H count`, per quest `D questId, D flags`. Sent after
  enterWorld (queued with skillList/itemList) and on every server re-send
  (quest state changes). `name` comes from a gateway-side lookup mined from
  the aCis quest Java sources (scripting/quest/QNNN_*.java `super(id,
  "Name")` — the client needs NO datapack files). `progress` is the raw
  QuestState flags dword, UNINTERPRETED: per
  `QuestState.calculateFlags`, while a quest is started
  `flags = ((1 << cond) - 1) | 0x80000000` — bit31 = started/active, low
  bits = cond mask. Live evidence: accept → `-2147483647` (0x80000001,
  cond 1); advance → `-2147483645` (0x80000003, cond 2).
- There is NO separate quest-update packet in this rev — QuestList re-send
  covers updates. `questUpdate` therefore does not exist (documented).

Client -> server:
- `{"op":"questAbort","id":N}` -> RequestQuestAbort(0x64): `D questId`.

Notes:
- The Tutorial chain does NOT appear in questList: it is quest id -1, a
  "feature" script, filtered out by `QuestList.getAllQuests` via
  `isRealQuest()` (id > 0). Fresh chars get an EMPTY questList — expected.
- Quest accept/advance goes through the normal dialog ops: talk to the NPC,
  follow `npc_<objectId>_Quest`, then the `Quest <ScriptName> <event.htm>`
  bypass links (verified end-to-end on Q006 "Step into the Future": Roxxy
  accept -> Baulro advance -> abort).
- `RequestQuestList` (0x63) exists but is unnecessary: the server pushes
  QuestList on EnterWorld and on every change.

## M7: character actions / ActionWnd (added 2026-07-26)

Client -> server:
- `{"op":"action","actionId":N}` — character action, ctrl/shift always
  false. `actionId` is an actionname-e.dat UI id
  (assets/gamedata/actionname.json). Routing (fixed 2026-07-27):
  - If `actionId` is a SOCIAL-map key -> **RequestSocialAction(0x1b)** with
    the mapped aCis social id:
    12→2 Greeting, 13→3 Victory, 14→4 Advance, 25→5 No, 24→6 Yes,
    26→7 Bow, 29→8 Unaware, 30→9 Waiting, 31→10 Laugh, 33→11 Applaud,
    34→12 Dance, 35→13 Sorrow.
  - Everything else -> **RequestActionUse(0x45)** verbatim; handled ids in
    this rev's switch: 0 Sit/Stand, 1 Walk/Run, 10 Private Store Sell,
    28 Private Store Buy, 37 Dwarven Manufacture, 51 General Manufacture,
    61 Package Sell, 15-27/38/52-54 pet/summon actions, 1000+ specials.
  Non-social actionname ids 2..13 (Attack 2, Exchange 3, Next Target 4,
  Pick Up 5, Assist 6, Invite 7, Leave Party 8, Dismiss 9, Party
  Matching 11) are NOT socials: they hit RequestActionUse, where aCis just
  logs "Unhandled action type" — those actions live behind their own
  protocol packets (AttackRequest, TradeRequest, party packets) and many
  already have bridge ops (`attack`, party ops TBD).
  aCis carries NO social names (RequestSocialAction relays the number);
  the id->name convention is retail socialname-e.dat (verified against
  source — the gameserver only enforces ids 2..13).
  Gotcha: back-to-back socials within ~2s are silently ignored (the player
  intention stays non-IDLE while an emote plays + FloodProtector.SOCIAL).

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
- `{"op":"login","deviceId":"<persistent browser id>"}` — optional
  `"noAutoCreate":true` skips the legacy first-login auto-create for THIS
  session (fresh account gets `auth_ok{chars:[]}` and the client drives
  `createChar`); default behavior unchanged.
- `{"op":"enterChar","slot":0}`
- `{"op":"createChar","name":"..","race":3,"sex":1,"classId":49,"hairStyle":0,"hairColor":0,"face":0}`
  — character creation (see §character creation below; only valid at the
  char-select stage, before `enterChar`)
- `{"op":"moveTo","x":0,"y":0,"z":0}`
- `{"op":"say","channel":0,"text":".."}`
- `{"op":"destroyItem","objectId":0,"count":1}` — inventory TrashButton
  (aCis RequestDestroyItem 0x59, D objectId + D count)
- `{"op":"crystallizeItem","objectId":0,"count":1}` — inventory
  CrystallizeButton (aCis RequestCrystallizeItem 0x72, D objectId + D count)

Server -> client:
- `{"op":"auth_ok","chars":[{"slot":0,"name":"..","race":0,"classId":0,"sex":0,"level":1,"hairStyle":0,"hairColor":0,"face":0}]}`
  — sent on login AND again after every successful `createChar` (aCis
  answers CharCreateOk with a fresh CharSelectInfo). `chars` is empty when
  the account has no characters and `GATEWAY_AUTOCREATE=0`.
- `{"op":"charCreateOk"}` — character created; the refreshed `auth_ok`
  follows immediately.
- `{"op":"charCreateFail","reason":"name_already_exists","code":2}` —
  `reason` is either a server code mapped to a string (`creation_failed`,
  `too_many_characters`, `name_already_exists`, `16_eng_chars`,
  `incorrect_name`, with the numeric `code` alongside) or a gateway-side
  validation failure (`invalid_name`, `invalid_sex`, `invalid_classId`,
  `invalid_hairStyle`, `invalid_hairColor`, `invalid_face`, `not_ready`,
  `create_in_progress`) — gateway-side failures carry NO `code` and never
  reach aCis.
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

## Character creation (createChar)

`createChar` maps to aCis RequestCharacterCreate(0x0b). The gateway
validates EVERY field before forwarding, because the server side of this
packet has two traps (verified in
`clientpackets/RequestCharacterCreate.java`, rev 409):

- **sex is NOT validated server-side.** `Sex.VALUES[sex]` throws an
  ArrayIndexOutOfBounds for sex >= 2 and NO CharCreateFail is sent — the
  client would hang forever. The gateway rejects sex outside {0, 1} with
  `charCreateFail{reason:"invalid_sex"}` and never forwards it.
- **race is decorative.** The server only range-checks it (0..4); the actual
  race comes from the class template. The gateway therefore treats classId
  as AUTHORITATIVE and derives race from it; the client-sent `race` field is
  ignored (send the matching race anyway for forward-compat).

Validation rules (mirror the server, plus the sex clamp): name
`^[A-Za-z0-9]{1,16}$`; sex 0..1; classId one of the 9 base ids — 0, 10
(human / race 0), 18, 25 (elf / 1), 31, 38 (dark elf / 2), 44, 49 (orc / 3),
53 (dwarf / 4); hairStyle 0..4 male, 0..6 female; hairColor 0..3; face 0..2.
Any violation → `charCreateFail{reason:"invalid_<field>"}` with no server
round-trip. Valid requests that aCis itself rejects (name taken, ≥7 chars,
NPC-name collision) come back as `charCreateFail` with the numeric server
`code`. Success → `charCreateOk` + a refreshed `auth_ok`.

**Legacy auto-create**: historically the gateway auto-created a Human
Fighter when the char list was empty, and every `test/verify-*.js` suite
logs in with a fresh deviceId and immediately `enterChar` slot 0 — they all
rely on it. It therefore stays ON by default. Set `GATEWAY_AUTOCREATE=0` to
turn it off globally, or send `login{noAutoCreate:true}` to skip it for one
session: the client then receives `auth_ok{chars:[]}` on first login and
drives `createChar` itself. Browser-driven `createChar` works either way.


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
RequestMagicSkillUse 0x2f, UseItem 0x14, ValidatePosition 0x48,
TradeRequest 0x15, AddTradeItem 0x16, TradeDone 0x17, AnswerTradeRequest
0x44, RequestPrivateStoreManageSell 0x73, SetPrivateStoreListSell 0x74,
RequestPrivateStoreQuitSell 0x76, SetPrivateStoreMsgSell 0x77,
RequestPrivateStoreBuy 0x79, RequestPrivateStoreManageBuy 0x90,
SetPrivateStoreListBuy 0x91, RequestPrivateStoreQuitBuy 0x93,
SetPrivateStoreMsgBuy 0x94, RequestPrivateStoreSell 0x96,
RequestJoinPledge 0x24, RequestAnswerJoinPledge 0x25,
RequestWithdrawPledge 0x26, RequestOustPledgeMember 0x27,
RequestPledgeCrest 0x68, Appearing 0x30, RequestRestartPoint 0x6d.
Game (S→C, decoded): VersionCheck 0x00, CharSelectInfo 0x13,
CharSelected 0x15, CharCreateOk 0x19, CharCreateFail 0x1a, UserInfo 0x04,
CharInfo 0x03, NpcInfo 0x16, MoveToLocation 0x01, DeleteObject 0x12,
CreatureSay 0x4a, TeleportToLocation 0x28, ValidateLocation 0x61,
Attack 0x05, Die 0x06, Revive 0x07, StatusUpdate 0x0e,
MyTargetSelected 0xa6, SystemMessage 0x64, SkillList 0x58,
MagicSkillUse 0x48, MagicSkillLaunched 0x76, ItemList 0x1b,
InventoryUpdate 0x27, SpawnItem 0x0b, DropItem 0x0c, SendTradeRequest 0x5e,
TradeStart 0x1e, TradeOwnAdd 0x20, TradeOtherAdd 0x21, SendTradeDone 0x22,
TradePressOwnOk 0x75, TradePressOtherOk 0x7c, PrivateStoreManageListSell
0x9a, PrivateStoreListSell 0x9b, PrivateStoreMsgSell 0x9c,
PrivateStoreManageListBuy 0xb7, PrivateStoreListBuy 0xb8,
PrivateStoreMsgBuy 0xb9, AskJoinPledge 0x32, JoinPledge 0x33,
PledgeShowMemberListAll 0x53, PledgeShowMemberListUpdate 0x54,
PledgeShowMemberListAdd 0x55, PledgeShowMemberListDelete 0x56,
PledgeCrest 0x6c, PledgeShowMemberListDeleteAll 0x82, PledgeInfo 0x83,
PledgeShowInfoUpdate 0x88, PledgeStatusChanged 0xcd.

## Files

- `src/blowfish.js` + `src/tables.js` — Blowfish engine, tables extracted
  from the aCis Java source (unit-verified against the real jar via jshell).
- `src/crypt.js` — checksums, XOR pass, LoginCrypt, GameCrypt, RSA helpers.
- `src/l2io.js` — LE packet reader/writer, stream framer.
- `src/loginclient.js` — full login-server flow.
- `src/gameclient.js` — game session + packet decoders.
- `src/governor.js` — outbound connection pacing (anti-flood).
- `src/bridge.js` — WS contract mapping, deviceId→account/char derivation,
  createChar validation, legacy auto-create (GATEWAY_AUTOCREATE), retries.
- `src/npcnames.js` — npcId→name from the datapack XML.
- `src/server.js` — WS entry point.
